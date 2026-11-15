/**
 * Stands routes — public list/detail + the council's sales workflow (offer, reserve, allocate).
 *
 * A stand is a parcel of the register (land.parcel); the council's sales state is land.stand_offer (migration 228) and
 * public.stands is a compatibility view over both. The id of a stand is its parcel id. A stand's BOUNDARY is not edited here:
 * it changes only through the Survey Section import, so create/merge/split by geometry answer 410.
 *
 *   GET    /api/stands                  → GeoJSON FeatureCollection
 *   GET    /api/stands/identify         → spatial point-in-polygon identify (sold/status + props)
 *   GET    /api/stands/:id              → single stand + zone + plan suggestion
 *   POST   /api/stands/:id/offer        → planner/admin: put a stand of the register on offer
 *   PUT    /api/stands/:id              → planner/admin: change the sales details (price, status, ...)
 *   DELETE /api/stands/:id              → planner/admin: withdraw the offer
 *   POST   /api/stands/:id/reserve      → authenticated: soft-reserve for 30 min
 *   POST   /api/stands/:id/release      → authenticated: release own reservation
 *   POST   /api/stands, /stands/merge, /stands/:id/split   → 410 (boundaries change only through the survey import)
 */

const { requireAuth, requireRole } = require('../middleware/jwtAuth')
const planningAssistant = require('../services/planningAssistant')
const { invalidateTileLayer, emitMapEvent } = require('./tiles')

const RESERVATION_TTL_MIN = 30

const STATUS_VALUES = new Set(['available', 'reserved', 'allocated', 'withdrawn'])
// A list may also ask for the register's stands that are not on offer (no land.stand_offer row).
const LIST_STATUS_VALUES = new Set([...STATUS_VALUES, 'not_offered'])

const isString = (v, max = 255) =>
  typeof v === 'string' && v.length > 0 && v.length <= max

const ALLOC_PURPOSES = new Set([
  'residential', 'commercial', 'industrial', 'institutional', 'agricultural', 'other',
])

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Next allocation reference in the VRDC-STD-YYYY-NNNNNN series (mirrors the
// receipt-number generator in services/paymentDriver.js). Called inside the
// allocate transaction so the MAX+1 read and the insert are atomic.
async function nextAllocationRef(client) {
  const year = new Date().getFullYear()
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(reference_no, '^VRDC-STD-\\d{4}-', ''), '')::INT), 0) + 1 AS n
       FROM stand_allocation
      WHERE reference_no LIKE 'VRDC-STD-' || $1 || '-%'`,
    [String(year)],
  )
  return `VRDC-STD-${year}-${String(rows[0].n).padStart(6, '0')}`
}

function pickStatuses(raw) {
  if (!raw) return ['available']
  const list = String(raw).split(',').map(s => s.trim()).filter(Boolean)
  return list.filter(s => LIST_STATUS_VALUES.has(s))
}

/** Citizen-facing availability label derived from registry status. */
function availabilityLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'available') return { available: true, sold: false, label: 'Available' }
  if (s === 'reserved') return { available: false, sold: false, label: 'Reserved' }
  if (s === 'allocated' || s === 'sold') return { available: false, sold: true, label: 'Sold / allocated' }
  if (s === 'withdrawn') return { available: false, sold: false, label: 'Withdrawn' }
  if (s === 'not_offered') return { available: false, sold: false, label: 'Not on offer' }
  return { available: false, sold: false, label: status || 'Unknown' }
}

async function standsRoutes(fastify) {
  // ── Public: spatial identify (point → stand polygon + sold/status) ──
  // MUST be registered before /stands/:id so "identify" is not parsed as an id.
  fastify.get('/stands/identify', async (request, reply) => {
    try {
      const lng = Number(request.query?.lng ?? request.query?.lon ?? request.query?.x)
      const lat = Number(request.query?.lat ?? request.query?.y)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return reply.code(400).send({
          success: false,
          error: 'lng_lat_required',
          message: 'Provide lng and lat (WGS84) of the map click.',
        })
      }
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        return reply.code(400).send({ success: false, error: 'lng_lat_out_of_range' })
      }

      // Prefer Acua / stand sub-units (smaller polygons) when the click hits one.
      let subunit = null
      try {
        const { rows: su } = await fastify.pg.query(
          `SELECT
             u.id, u.subunit_number, u.estate, u.typology, u.status,
             u.target_area_sqm, u.area_sqm, u.price_usd, u.ward, u.description,
             u.parent_stand_id,
             ST_AsGeoJSON(u.geom)::JSON AS geometry,
             ST_X(ST_Centroid(u.geom)) AS centroid_lng,
             ST_Y(ST_Centroid(u.geom)) AS centroid_lat,
             p.stand_number AS parent_stand_number
           FROM stand_subunit u
           LEFT JOIN stands p ON p.id = u.parent_stand_id
           WHERE u.geom IS NOT NULL
             AND ST_Intersects(u.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           ORDER BY ST_Area(u.geom) ASC
           LIMIT 1`,
          [lng, lat],
        )
        if (su[0]) subunit = su[0]
      } catch (err) {
        request.log.warn({ err }, 'stand_subunit identify skipped')
      }

      // Compatible with both pre- and post-3NF stands columns.
      const { rows } = await fastify.pg.query(
        `SELECT
           s.id, s.stand_number, s.ward, s.zone_id, s.zone_type,
           s.use_scale, s.status, s.area_sqm, s.frontage_m, s.depth_m,
           s.price_usd, s.description, s.reserved_until, s.allocated_at,
           ST_AsGeoJSON(s.geom)::JSON AS geometry,
           ST_X(ST_Centroid(s.geom)) AS centroid_lng,
           ST_Y(ST_Centroid(s.geom)) AS centroid_lat,
           ROUND(ST_Area(s.geom::geography)::numeric, 2) AS area_sqm_calc,
           z.zone AS zone_name
         FROM stands s
         LEFT JOIN proposed_peri_urban_zones z ON z.id::text = s.zone_id::text
         WHERE s.geom IS NOT NULL
           AND ST_Intersects(s.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY ST_Area(s.geom) ASC
         LIMIT 5`,
        [lng, lat],
      )

      if (!rows.length && !subunit) {
        return reply.send({
          success: true,
          data: null,
          message: 'No stand polygon at this location.',
          query: { lng, lat },
        })
      }

      if (subunit) {
        const avail = availabilityLabel(subunit.status)
        const area = subunit.area_sqm != null ? Number(subunit.area_sqm) : Number(subunit.target_area_sqm)
        const subunitPayload = {
          id: subunit.id,
          kind: 'subunit',
          estate: subunit.estate,
          typology: subunit.typology,
          standNumber: subunit.subunit_number,
          parentStandId: subunit.parent_stand_id,
          parentStandNumber: subunit.parent_stand_number || null,
          ward: subunit.ward,
          areaSqm: area,
          targetAreaSqm: Number(subunit.target_area_sqm),
          priceUsd: subunit.price_usd == null ? null : Number(subunit.price_usd),
          status: subunit.status,
          ...avail,
          description: subunit.description,
          geometry: subunit.geometry,
          centroid: [subunit.centroid_lng, subunit.centroid_lat],
        }
        return reply.send({
          success: true,
          data: subunitPayload,
          matches: [subunitPayload],
          query: { lng, lat },
        })
      }

      // Optional allocation join — table may be empty or absent on thin DBs.
      const allocByStand = new Map()
      try {
        const ids = rows.map((r) => r.id)
        const { rows: allocs } = await fastify.pg.query(
          `SELECT DISTINCT ON (stand_id)
             stand_id, reference_no, purpose, allocated_at, allottee_name
           FROM stand_allocation
           WHERE stand_id = ANY($1::text[])
           ORDER BY stand_id, allocated_at DESC NULLS LAST`,
          [ids],
        )
        for (const a of allocs) allocByStand.set(a.stand_id, a)
      } catch (err) {
        request.log.warn({ err }, 'stand_allocation lookup skipped')
      }

      const features = rows.map((r) => {
        const avail = availabilityLabel(r.status)
        const area = r.area_sqm != null ? Number(r.area_sqm) : (r.area_sqm_calc != null ? Number(r.area_sqm_calc) : null)
        const alloc = allocByStand.get(r.id)
        return {
          id: r.id,
          standNumber: r.stand_number,
          ward: r.ward,
          zoneId: r.zone_id,
          zoneType: r.zone_type,
          zoneName: r.zone_name || null,
          useScale: r.use_scale,
          areaSqm: area,
          frontageM: r.frontage_m == null ? null : Number(r.frontage_m),
          depthM: r.depth_m == null ? null : Number(r.depth_m),
          priceUsd: r.price_usd == null ? null : Number(r.price_usd),
          status: r.status,
          ...avail,
          description: r.description,
          reservedUntil: r.reserved_until,
          allocatedAt: r.allocated_at || alloc?.allocated_at || null,
          // Public identify: allottee display name only (no phone/email PII).
          // Full owner dossier remains on staff /api/properties/:standNo/owners.
          allocation: alloc ? {
            referenceNo: alloc.reference_no,
            purpose: alloc.purpose || null,
            allocatedAt: alloc.allocated_at,
            allotteeName: alloc.allottee_name || null,
          } : null,
          geometry: r.geometry,
          centroid: [r.centroid_lng, r.centroid_lat],
        }
      })

      return reply.send({
        success: true,
        data: features[0],
        matches: features,
        query: { lng, lat },
      })
    } catch (err) {
      request.log.error({ err }, 'stands identify failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Public: Acua / stand sub-units as GeoJSON ───────────────────────
  fastify.get('/stands/subunits', async (request, reply) => {
    try {
      const typology = isString(request.query?.typology, 40) ? request.query.typology : 'acua_300'
      const statuses = pickStatuses(request.query?.status)
      const { rows } = await fastify.pg.query(
        `SELECT
           u.id, u.subunit_number, u.estate, u.typology, u.status,
           u.target_area_sqm, u.area_sqm, u.price_usd, u.ward,
           u.parent_stand_id, p.stand_number AS parent_stand_number,
           ST_AsGeoJSON(u.geom)::JSON AS geometry
         FROM stand_subunit u
         LEFT JOIN stands p ON p.id = u.parent_stand_id
         WHERE u.typology = $1 AND u.status = ANY($2::text[])
         ORDER BY u.subunit_number
         LIMIT 500`,
        [typology, statuses],
      )
      return reply.send({
        type: 'FeatureCollection',
        features: rows.map((r) => ({
          type: 'Feature',
          id: r.id,
          geometry: r.geometry,
          properties: {
            subunit_number: r.subunit_number,
            estate: r.estate,
            typology: r.typology,
            status: r.status,
            area_sqm: r.area_sqm != null ? Number(r.area_sqm) : Number(r.target_area_sqm),
            target_area_sqm: Number(r.target_area_sqm),
            price_usd: r.price_usd == null ? null : Number(r.price_usd),
            ward: r.ward,
            parent_stand_number: r.parent_stand_number,
            parent_stand_id: r.parent_stand_id,
          },
        })),
      })
    } catch (err) {
      request.log.error({ err }, 'stands subunits list failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Public: list as GeoJSON ─────────────────────────────────────────
  fastify.get('/stands', async (request, reply) => {
    try {
      const { ward, zoneType, q, bbox } = request.query || {}
      const statuses = pickStatuses(request.query?.status)

      // Defensive parameter binding — never interpolate strings.
      const params = [statuses]
      const where  = ['s.status = ANY($1::text[])']

      if (isString(ward, 64)) {
        params.push(ward)
        where.push(`s.ward = $${params.length}`)
      }
      if (isString(zoneType, 64)) {
        params.push(zoneType)
        where.push(`s.zone_type = $${params.length}`)
      }
      if (isString(q, 64)) {
        params.push(`%${q}%`)
        where.push(`s.stand_number ILIKE $${params.length}`)
      }
      if (isString(bbox, 100)) {
        const parts = bbox.split(',').map(Number)
        if (parts.length === 4 && parts.every(Number.isFinite)) {
          const [minLng, minLat, maxLng, maxLat] = parts
          params.push(minLng, minLat, maxLng, maxLat)
          where.push(
            `s.geom && ST_MakeEnvelope(
               $${params.length - 3}, $${params.length - 2},
               $${params.length - 1}, $${params.length},
               4326)`,
          )
        }
      }

      const sql = `
        SELECT
          s.id, s.stand_number, s.ward, s.zone_id, s.zone_type,
          s.use_scale, s.area_sqm, s.frontage_m, s.depth_m,
          s.price_usd, s.status, s.description,
          ST_AsGeoJSON(s.geom)::JSON     AS geometry,
          ST_X(s.centroid)               AS centroid_lng,
          ST_Y(s.centroid)               AS centroid_lat
        FROM stands s
        WHERE ${where.join(' AND ')}
        ORDER BY s.ward, s.stand_number
        LIMIT 5000`
      const { rows } = await fastify.pg.query(sql, params)

      const features = rows.map(r => ({
        type: 'Feature',
        id: r.id,
        geometry: r.geometry,
        properties: {
          id:           r.id,
          standNumber:  r.stand_number,
          ward:         r.ward,
          zoneId:       r.zone_id,
          zoneType:     r.zone_type,
          useScale:     r.use_scale,
          areaSqm:      r.area_sqm == null ? null : Number(r.area_sqm),
          frontageM:    r.frontage_m == null ? null : Number(r.frontage_m),
          depthM:       r.depth_m == null ? null : Number(r.depth_m),
          priceUsd:     r.price_usd == null ? null : Number(r.price_usd),
          status:       r.status,
          description:  r.description,
          centroid:     [r.centroid_lng, r.centroid_lat],
        },
      }))

      return reply.send({
        type: 'FeatureCollection',
        features,
      })
    } catch (err) {
      request.log.error({ err }, 'list stands failed')
      return reply.code(500).send({
        type: 'FeatureCollection',
        features: [],
        error: 'internal',
      })
    }
  })

  // ── Public: single stand + suggested plan summary ───────────────────
  fastify.get('/stands/:id', async (request, reply) => {
    try {
      const { id } = request.params
      const { rows } = await fastify.pg.query(
        `SELECT
           s.id, s.stand_number, s.ward, s.zone_id, s.zone_type,
           s.use_scale, s.area_sqm, s.frontage_m, s.depth_m,
           s.price_usd, s.status, s.description,
           s.reserved_until, s.allocated_at,
           ST_AsGeoJSON(s.geom)::JSON  AS geometry,
           ST_X(s.centroid)            AS centroid_lng,
           ST_Y(s.centroid)            AS centroid_lat,
           z.zone, z.zone_type AS zone_zone_type,
           z.scale_category, z.authority, z.zone_description
         FROM stands s
         LEFT JOIN proposed_peri_urban_zones z ON z.id = s.zone_id
         WHERE s.id = $1`,
        [id],
      )
      const r = rows[0]
      if (!r) return reply.code(404).send({ success: false, error: 'not_found' })

      // Suggested plan summary (read-only).
      let suggested = null
      try {
        suggested = await planningAssistant.suggestPlan(fastify.pg, { standId: r.id })
      } catch (err) {
        request.log.warn({ err }, 'planning assistant suggest failed')
      }

      return reply.send({
        success: true,
        data: {
          id:           r.id,
          standNumber:  r.stand_number,
          ward:         r.ward,
          zoneId:       r.zone_id,
          zoneType:     r.zone_type,
          useScale:     r.use_scale,
          areaSqm:      r.area_sqm == null ? null : Number(r.area_sqm),
          frontageM:    r.frontage_m == null ? null : Number(r.frontage_m),
          depthM:       r.depth_m == null ? null : Number(r.depth_m),
          priceUsd:     r.price_usd == null ? null : Number(r.price_usd),
          status:       r.status,
          description:  r.description,
          reservedUntil: r.reserved_until,
          allocatedAt:  r.allocated_at,
          geometry:     r.geometry,
          centroid:     [r.centroid_lng, r.centroid_lat],
          zone: r.zone_id ? {
            id:           r.zone_id,
            name:         r.zone,
            zoneType:     r.zone_zone_type,
            scaleCategory: r.scale_category,
            authority:    r.authority,
            description:  r.zone_description,
          } : null,
          suggestedPlan: suggested,
        },
      })
    } catch (err) {
      request.log.error({ err }, 'get stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Auth: reserve a stand (soft, 30 min) ────────────────────────────
  // Idempotent: if the same user re-calls within the TTL, the existing
  // reservation is extended rather than rejected. Only a stand the council has
  // put on offer (a land.stand_offer row) can be reserved.
  fastify.post('/stands/:id/reserve', { preHandler: requireAuth(fastify) }, async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user.id

      const { rows } = await fastify.pg.query(
        `UPDATE land.stand_offer o
            SET status         = 'reserved',
                reserved_by    = $2,
                reserved_at    = NOW(),
                reserved_until = NOW() + ($3 || ' minutes')::INTERVAL,
                updated_at     = NOW()
           FROM land.parcel p
          WHERE p.parcel_id = o.parcel_id AND o.parcel_id = $1
            AND (
              o.status = 'available'
              OR (o.status = 'reserved' AND (o.reserved_by = $2 OR o.reserved_until < NOW()))
            )
          RETURNING o.parcel_id AS id, p.stand_no AS stand_number, o.status, o.reserved_until`,
        [id, userId, RESERVATION_TTL_MIN],
      )
      const row = rows[0]
      if (!row) {
        return reply.code(409).send({
          success: false,
          error:   'unavailable',
          message: 'This stand is no longer available to reserve.',
        })
      }
      return reply.send({ success: true, data: row })
    } catch (err) {
      request.log.error({ err }, 'reserve stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Boundaries are not edited here ────────────────────────────────────
  // A stand is a parcel of the register (land.parcel). Its boundary changes only through the Survey Section's
  // approved import (land.parcel_guard), so creating, re-shaping, merging and splitting stands by geometry are retired.
  const BOUNDARY_GONE = {
    success: false,
    error: 'boundaries_via_survey_import',
    message: 'A stand is a parcel of the register: its boundary changes only through the Survey Section import. '
      + 'Propose the change with POST /api/parcel-change-requests (the Survey Section decides it), put an existing stand on offer with POST /api/stands/:id/offer, or change its sales details with PUT /api/stands/:id.',
  }
  const retired = { preHandler: requireRole(fastify, ['planner', 'gis_officer', 'admin']) }
  fastify.post('/stands', retired, async (_request, reply) => reply.code(410).send(BOUNDARY_GONE))
  fastify.post('/stands/merge', retired, async (_request, reply) => reply.code(410).send(BOUNDARY_GONE))
  fastify.post('/stands/:id/split', retired, async (_request, reply) => reply.code(410).send(BOUNDARY_GONE))

  // ── Planner: put a stand of the register on offer ───────────────────────
  // Body: { useScale?, frontageM?, depthM?, priceUsd?, description? }. The stand's number, ward, area and zone are the register's.
  fastify.post('/stands/:id/offer', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'admin']),
  }, async (request, reply) => {
    try {
      const { id } = request.params
      const { useScale, frontageM, depthM, priceUsd, description } = request.body || {}
      if (priceUsd != null && !(Number(priceUsd) >= 0)) return reply.code(400).send({ success: false, error: 'priceUsd must be zero or more' })
      const { rows: parcel } = await fastify.pg.query(
        `SELECT parcel_id, stand_no FROM land.parcel WHERE parcel_id = $1 AND parcel_kind = 'stand' AND status = 'current'`, [id])
      if (!parcel[0]) return reply.code(404).send({ success: false, error: 'not_found' })
      const { rows } = await fastify.pg.query(
        `INSERT INTO land.stand_offer (parcel_id, use_scale, frontage_m, depth_m, price_usd, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (parcel_id) DO NOTHING
         RETURNING parcel_id AS id, status`,
        [id, useScale || null, frontageM || null, depthM || null, priceUsd ?? null, description || null, request.user.id],
      )
      if (!rows[0]) return reply.code(409).send({ success: false, error: 'already_offered', message: 'This stand already has a sales record; change it with PUT /api/stands/:id.' })
      invalidateTileLayer('stands'); emitMapEvent({ layer: 'stands', action: 'updated' })
      return reply.code(201).send({ success: true, data: { ...rows[0], stand_number: parcel[0].stand_no } })
    } catch (err) {
      request.log.error({ err }, 'offer stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Planner: change a stand's sales details ─────────────────────────────
  fastify.put('/stands/:id', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'admin']),
  }, async (request, reply) => {
    try {
      const { id } = request.params
      const { useScale, frontageM, depthM, priceUsd, description, status, geometry, standNumber, ward, zoneId, zoneType } = request.body || {}
      if (geometry) return reply.code(410).send(BOUNDARY_GONE)

      const sets = ['updated_at = NOW()']
      const params = [id]
      if (useScale != null)     { params.push(useScale);     sets.push(`use_scale = $${params.length}`) }
      if (frontageM != null)    { params.push(frontageM);    sets.push(`frontage_m = $${params.length}`) }
      if (depthM != null)       { params.push(depthM);       sets.push(`depth_m = $${params.length}`) }
      if (priceUsd != null)     { params.push(priceUsd);     sets.push(`price_usd = $${params.length}`) }
      if (description != null)  { params.push(description);  sets.push(`description = $${params.length}`) }
      if (status != null && STATUS_VALUES.has(status)) { params.push(status); sets.push(`status = $${params.length}`) }
      if (sets.length === 1) return reply.code(400).send({ success: false, error: 'no fields to update' })

      const { rows } = await fastify.pg.query(
        `UPDATE land.stand_offer o SET ${sets.join(', ')} FROM land.parcel p
          WHERE p.parcel_id = o.parcel_id AND o.parcel_id = $1
          RETURNING o.parcel_id AS id, p.stand_no AS stand_number, o.status`,
        params,
      )
      if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_offered', message: 'This stand has no sales record: put it on offer first.' })
      invalidateTileLayer('stands'); emitMapEvent({ layer: 'stands', action: 'updated' })
      // The stand's number, ward and zone are the register's, not edited here.
      const ignored = Object.entries({ standNumber, ward, zoneId, zoneType }).filter(([, v]) => v != null).map(([k]) => k)
      return reply.send({ success: true, data: rows[0], ...(ignored.length ? { ignored } : {}) })
    } catch (err) {
      request.log.error({ err }, 'update stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Planner: withdraw a stand's offer ───────────────────────────────────
  fastify.delete('/stands/:id', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'admin']),
  }, async (request, reply) => {
    try {
      const { id } = request.params
      const { rows } = await fastify.pg.query(
        `UPDATE land.stand_offer o SET status = 'withdrawn', updated_at = NOW() FROM land.parcel p
          WHERE p.parcel_id = o.parcel_id AND o.parcel_id = $1 AND o.status != 'allocated'
          RETURNING o.parcel_id AS id, p.stand_no AS stand_number, o.status`,
        [id],
      )
      if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found_or_allocated' })
      invalidateTileLayer('stands'); emitMapEvent({ layer: 'stands', action: 'updated' })
      return reply.send({ success: true, data: rows[0] })
    } catch (err) {
      request.log.error({ err }, 'withdraw stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── Auth: release my reservation ────────────────────────────────────
  fastify.post('/stands/:id/release', { preHandler: requireAuth(fastify) }, async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user.id
      const { rowCount } = await fastify.pg.query(
        `UPDATE land.stand_offer
            SET status         = 'available',
                reserved_by    = NULL,
                reserved_at    = NULL,
                reserved_until = NULL,
                updated_at     = NOW()
          WHERE parcel_id = $1 AND status = 'reserved' AND reserved_by = $2`,
        [id, userId],
      )
      if (rowCount === 0) {
        return reply.code(404).send({ success: false, error: 'not_reserved_by_caller' })
      }
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'release stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ══════════════════════════════════════════════════════════════════════
  // STAND NUMBER ALLOCATION (H3 — migration 105)
  // The numbering authority + auditable allocation register. Allocation is no
  // longer a lossy stamp on `stands`; every allocation is a recorded, reversible
  // register entry with a reference number, authorising officer, and history.
  // ══════════════════════════════════════════════════════════════════════

  const ALLOC_ROLES = ['planner', 'admin']

  // ── Sequential stand-number suggestion for a ward ─────────────────────────
  // Advisory: returns the next free number in the ward's sequence (optionally
  // within a prefix, e.g. "STD-"). Uniqueness is still enforced by the
  // stands UNIQUE(ward, stand_number) constraint at create time.
  fastify.get('/stands/next-number', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'admin']),
  }, async (request, reply) => {
    const ward = request.query?.ward
    const township = request.query?.township
    const prefix = isString(request.query?.prefix, 32) ? String(request.query.prefix) : ''
    if (!isString(ward, 64) && !isString(township, 64)) return reply.code(400).send({ success: false, error: 'ward or township required' })
    try {
      // Largest trailing-integer suffix among the stand numbers that match the prefix; the next number is that + 1.
      // Rows with no trailing digits (m IS NULL) are ignored. A stand's number is unique within its township (the
      // register's rule); a ward may be given instead, where the register's stands carry one.
      const byTownship = isString(township, 64)
      const { rows } = await fastify.pg.query(
        `SELECT COALESCE(MAX((m[1])::int), 0) + 1 AS n
           FROM land.parcel p
           LEFT JOIN admin.ward w ON w.ward_code = p.ward_code,
           LATERAL regexp_match(p.stand_no, '(\\d+)$') AS m
          WHERE p.parcel_kind = 'stand' AND p.status = 'current'
            AND ${byTownship ? 'p.township_code = $1' : 'w.name = $1'}
            AND p.stand_no LIKE $2 || '%' AND m IS NOT NULL`,
        [byTownship ? township : ward, prefix],
      )
      const n = Number(rows[0]?.n) || 1
      return reply.send({
        success: true,
        data: { ...(byTownship ? { township } : { ward }), prefix, next_number: n, suggested_stand_number: `${prefix}${n}` },
      })
    } catch (err) {
      request.log.error({ err }, 'next stand number failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // Estate layouts (RDC Act s86) cannot be allocated until the Minister approves.
  fastify.post('/stands/:id/estate-requirement', {
    preHandler: requireRole(fastify, ALLOC_ROLES),
  }, async (request, reply) => {
    const required = request.body?.required === true
    const { rows } = await fastify.pg.query(
      `UPDATE land.stand_offer o SET requires_minister_approval = $2, updated_at = NOW() FROM land.parcel p
        WHERE p.parcel_id = o.parcel_id AND o.parcel_id = $1
        RETURNING o.parcel_id AS id, p.stand_no AS stand_number, o.requires_minister_approval`,
      [request.params.id, required],
    )
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    return reply.send({ success: true, data: rows[0] })
  })

  // ── Allocate a stand to an allottee ──────────────────────────────────────
  // Body: { allocatedTo?: uuid, allotteeName?: string, purpose?, conditions? }
  // Transactional: creates the register entry and flips the stand to allocated
  // atomically. The partial unique index (migration 105) makes a double
  // allocation impossible even under a race.
  fastify.post('/stands/:id/allocate', {
    preHandler: requireRole(fastify, ALLOC_ROLES),
  }, async (request, reply) => {
    const { id } = request.params
    const b = request.body || {}
    const allocatedTo  = isString(b.allocatedTo, 64) ? b.allocatedTo : null
    const allotteeName = isString(b.allotteeName, 160) ? b.allotteeName : null
    if (!allocatedTo && !allotteeName) {
      return reply.code(400).send({ success: false, error: 'allocatedTo or allotteeName required' })
    }
    const purpose = ALLOC_PURPOSES.has(b.purpose) ? b.purpose : 'residential'
    const conditions = isString(b.conditions, 4096) ? b.conditions : null

    const client = await fastify.pg.connect()
    try {
      await client.query('BEGIN')
      // Lock the stand row; only available/reserved stands can be allocated.
      const standRes = await client.query(
        `SELECT o.parcel_id AS id, p.stand_no AS stand_number, w.name AS ward, o.status
            FROM land.stand_offer o JOIN land.parcel p ON p.parcel_id = o.parcel_id LEFT JOIN admin.ward w ON w.ward_code = p.ward_code
           WHERE o.parcel_id = $1 FOR UPDATE OF o`, [id])
      const stand = standRes.rows[0]
      if (!stand) {
        await client.query('ROLLBACK')
        const known = await fastify.pg.query(`SELECT 1 FROM land.parcel WHERE parcel_id = $1 AND parcel_kind = 'stand'`, [id])
        return known.rows[0]
          ? reply.code(409).send({ success: false, error: 'not_offered', message: 'This stand has not been put on offer.' })
          : reply.code(404).send({ success: false, error: 'not_found' })
      }
      if (!['available', 'reserved'].includes(stand.status)) {
        await client.query('ROLLBACK')
        return reply.code(409).send({
          success: false, error: 'not_allocatable',
          message: `Stand is '${stand.status}' and cannot be allocated.`,
        })
      }

      const flag = await client.query(
        `SELECT requires_minister_approval FROM land.stand_offer WHERE parcel_id = $1`, [id])
      if (flag.rows[0]?.requires_minister_approval) {
        const approvalId = isString(b.estateApprovalId, 64) ? b.estateApprovalId : null
        if (!approvalId) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            success: false, error: 'minister_approval_required',
            message: 'This estate stand cannot be allocated until the Minister has approved the layout (RDC Act s86).',
          })
        }
        const ap = await client.query(
          `SELECT status = 'approved'
              AND objections_close_at IS NOT NULL
              AND objections_close_at < CURRENT_DATE AS ok
             FROM council_ops.estate_development_approval WHERE id = $1`,
          [approvalId],
        )
        if (!ap.rows[0]?.ok) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            success: false, error: 'minister_approval_not_effective',
            message: 'The layout needs the Minister’s approval, and the 21-day objection period must have closed.',
          })
        }
      }

      const referenceNo = await nextAllocationRef(client)
      const allocRes = await client.query(
        `INSERT INTO stand_allocation
           (stand_id, reference_no, allocated_to, allottee_name, purpose, conditions, authorized_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, reference_no, purpose, allocated_at, status`,
        [id, referenceNo, allocatedTo, allotteeName, purpose, conditions, request.user.id],
      )
      await client.query(
        `UPDATE land.stand_offer
            SET status = 'allocated', allocated_to = $2, allocated_at = NOW(),
                reserved_by = NULL, reserved_at = NULL, reserved_until = NULL,
                updated_at = NOW()
          WHERE parcel_id = $1`,
        [id, allocatedTo],
      )
      // The register's own flag follows (a non-boundary update the parcel guard allows).
      await client.query(`UPDATE land.parcel SET allocation_status = 'allocated' WHERE parcel_id = $1`, [id])
      await client.query('COMMIT')
      invalidateTileLayer('stands'); emitMapEvent({ layer: 'stands', action: 'updated' })
      return reply.code(201).send({
        success: true,
        data: { ...allocRes.rows[0], stand_id: id, stand_number: stand.stand_number, ward: stand.ward },
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      // Lost the race for the partial unique index (someone allocated first).
      if (err.code === '23505') return reply.code(409).send({ success: false, error: 'already_allocated' })
      request.log.error({ err }, 'allocate stand failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    } finally {
      client.release()
    }
  })

  // ── Revoke the active allocation (soft: history preserved) ───────────────
  fastify.post('/stands/:id/revoke-allocation', {
    preHandler: requireRole(fastify, ALLOC_ROLES),
  }, async (request, reply) => {
    const { id } = request.params
    const reason = isString(request.body?.reason, 4096) ? request.body.reason : null
    const client = await fastify.pg.connect()
    try {
      await client.query('BEGIN')
      const upd = await client.query(
        `UPDATE stand_allocation
            SET status = 'revoked', revoked_at = NOW(), revoked_by = $2, revoke_reason = $3
          WHERE stand_id = $1 AND status = 'active' AND deleted_at IS NULL
          RETURNING id, reference_no`,
        [id, request.user.id, reason],
      )
      if (!upd.rows[0]) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ success: false, error: 'no_active_allocation' })
      }
      await client.query(
        `UPDATE land.stand_offer SET status = 'available', allocated_to = NULL, allocated_at = NULL, updated_at = NOW()
          WHERE parcel_id = $1`,
        [id],
      )
      await client.query(`UPDATE land.parcel SET allocation_status = 'unallocated' WHERE parcel_id = $1`, [id])
      await client.query('COMMIT')
      invalidateTileLayer('stands'); emitMapEvent({ layer: 'stands', action: 'updated' })
      return reply.send({ success: true, data: upd.rows[0] })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      request.log.error({ err }, 'revoke allocation failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    } finally {
      client.release()
    }
  })

  // ── Allocation history for a stand (active + revoked) ────────────────────
  fastify.get('/stands/:id/allocations', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'planning_clerk', 'eo', 'admin']),
  }, async (request, reply) => {
    const { rows } = await fastify.pg.query(
      `SELECT a.id, a.reference_no, a.allocated_to, a.allottee_name, a.purpose,
              a.conditions, a.status, a.allocated_at, a.revoked_at, a.revoke_reason,
              COALESCE(au.full_name, au.name) AS authorized_by_name,
              COALESCE(al.full_name, al.name) AS allottee_user_name
         FROM stand_allocation a
         LEFT JOIN public.users au ON au.id = a.authorized_by
         LEFT JOIN public.users al ON al.id = a.allocated_to
        WHERE a.stand_id = $1 AND a.deleted_at IS NULL
        ORDER BY a.allocated_at DESC`,
      [request.params.id],
    )
    return reply.send({ success: true, data: rows })
  })

  // ── Allocation certificate (HTML) ────────────────────────────────────────
  fastify.get('/stand-allocations/:aid/certificate', {
    preHandler: requireRole(fastify, ['planner', 'gis_officer', 'planning_clerk', 'eo', 'admin']),
  }, async (request, reply) => {
    const { rows } = await fastify.pg.query(
      `SELECT a.reference_no, a.allottee_name, a.purpose, a.conditions, a.status,
              a.allocated_at, s.stand_number, s.ward,
              ROUND(ST_Area(s.geom::geography)::numeric, 2) AS area_sqm,
              COALESCE(al.full_name, al.name) AS allottee_user_name,
              COALESCE(au.full_name, au.name) AS authorized_by_name
         FROM stand_allocation a
         JOIN stands s ON s.id = a.stand_id
         LEFT JOIN public.users al ON al.id = a.allocated_to
         LEFT JOIN public.users au ON au.id = a.authorized_by
        WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [request.params.aid],
    )
    const r = rows[0]
    if (!r) return reply.code(404).send({ success: false, error: 'not_found' })
    const allottee = r.allottee_name || r.allottee_user_name || '—'
    const dateStr = new Date(r.allocated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const revoked = r.status === 'revoked'
    const html = `<!doctype html><meta charset="utf-8"><title>Stand Allocation ${escapeHtml(r.reference_no)}</title>
<div style="font-family:Georgia,serif;max-width:720px;margin:2rem auto;color:#1a1a1a;line-height:1.6">
  <h1 style="text-align:center;font-size:1.4rem;margin:0">Vungu Rural District Council</h1>
  <p style="text-align:center;margin:.25rem 0 1.5rem;letter-spacing:.05em">CERTIFICATE OF STAND ALLOCATION</p>
  ${revoked ? '<p style="text-align:center;color:#b00020;font-weight:bold">** THIS ALLOCATION HAS BEEN REVOKED **</p>' : ''}
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:.4rem 0;width:40%"><strong>Reference</strong></td><td>${escapeHtml(r.reference_no)}</td></tr>
    <tr><td style="padding:.4rem 0"><strong>Stand number</strong></td><td>${escapeHtml(r.stand_number)}, ${escapeHtml(r.ward)}</td></tr>
    <tr><td style="padding:.4rem 0"><strong>Area</strong></td><td>${escapeHtml(r.area_sqm)} m²</td></tr>
    <tr><td style="padding:.4rem 0"><strong>Allottee</strong></td><td>${escapeHtml(allottee)}</td></tr>
    <tr><td style="padding:.4rem 0"><strong>Purpose</strong></td><td>${escapeHtml(r.purpose)}</td></tr>
    <tr><td style="padding:.4rem 0"><strong>Date of allocation</strong></td><td>${escapeHtml(dateStr)}</td></tr>
    <tr><td style="padding:.4rem 0;vertical-align:top"><strong>Conditions</strong></td><td>${escapeHtml(r.conditions || 'None')}</td></tr>
  </table>
  <p style="margin-top:2.5rem">Authorised by: <strong>${escapeHtml(r.authorized_by_name || '—')}</strong></p>
  <p style="font-size:.8rem;color:#666;margin-top:2rem">This certificate records the allocation of the above stand. It is not a title deed and confers no rights of ownership until a lease or deed of grant is executed by the Council.</p>
</div>`
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })
}

module.exports = { standsRoutes }
