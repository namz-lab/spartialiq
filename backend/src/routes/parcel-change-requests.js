/**
 * Stand boundary changes as proposals to the Survey Section (migration 229).
 *
 * A stand is a parcel of the register (land.parcel) and a boundary changes only under an approved Survey Section import
 * (land.parcel_guard). An officer who wants a new stand, a split, a merge or a boundary correction DRAWS it as a proposal; the Survey Section
 * accepts it, surveys it, and the survey import closes it. Nothing here changes a boundary in the register.
 *
 *   GET    /api/parcel-change-requests              ?mine=1  ?status=draft,submitted,...   list (newest first)
 *   GET    /api/parcel-change-requests/:id          the proposal: parents and items as GeoJSON, and what is wrong with it now
 *   POST   /api/parcel-change-requests              draft a proposal { kind, reason, parent_ids, items: [{ role, label, parent_parcel_id?, geometry }] }
 *   PUT    /api/parcel-change-requests/:id          change a draft or returned proposal (the same body)
 *   POST   /api/parcel-change-requests/:id/submit   check it, open the survey task, send it to the Survey Section
 *   POST   /api/parcel-change-requests/:id/withdraw the drafter takes it back (the survey task is cancelled)
 *   POST   /api/parcel-change-requests/:id/accept | return | reject   { note }   the Survey Section decides; never the drafter
 *
 * Kinds: split (one parent, 2+ children), merge (2+ parents, one child), new (one parent revised, 1+ children cut from it), reshape (one parent revised).
 * Geometry is GeoJSON in WGS 84. The checks are land.change_request_problems(); a draft may have problems, a submission may not.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { GMS } = require('../services/gms/roles')

const DRAFTERS = ['planner', 'gis_officer', 'gis_head', 'gis_data', 'admin']
const DECIDERS = [...new Set([...GMS.importSurvey, 'admin'])]
const READERS = [...new Set([...DRAFTERS, ...DECIDERS, 'surveyor', 'eo', 'planning_clerk'])]
const KINDS = new Set(['new', 'split', 'merge', 'reshape'])
const EDITABLE = new Set(['draft', 'returned'])
const TASK_TYPE = { split: 'subdivision', new: 'new_stand', merge: 'consolidation', reshape: 'boundary_correction' }
const MAX_ITEMS = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isStr = (v, max = 4096) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const isPolygon = (g) => g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates)

/** The proposal as the caller sent it, or an error string. */
function parseBody(b) {
  if (!b || !KINDS.has(b.kind)) return { error: 'kind must be new, split, merge or reshape' }
  const parentIds = Array.isArray(b.parent_ids) ? [...new Set(b.parent_ids.map(String))] : []
  if (!parentIds.length || parentIds.length > MAX_ITEMS) return { error: 'parent_ids must name the stands affected' }
  const items = Array.isArray(b.items) ? b.items : []
  if (!items.length || items.length > MAX_ITEMS) return { error: `items must hold 1 to ${MAX_ITEMS} proposed boundaries` }
  for (const [i, it] of items.entries()) {
    if (it.role !== 'child' && it.role !== 'revised') return { error: `items[${i}].role must be child or revised` }
    if (!isPolygon(it.geometry)) return { error: `items[${i}].geometry must be a GeoJSON Polygon or MultiPolygon` }
    if (it.role === 'revised' && !parentIds.includes(String(it.parent_parcel_id))) return { error: `items[${i}] revises a stand that is not in parent_ids` }
  }
  if (b.reason != null && !isStr(b.reason, 4096)) return { error: 'reason must be text' }
  return { kind: b.kind, reason: b.reason || null, parentIds, items }
}

async function parcelChangeRequestRoutes(fastify) {
  // The proposal with its parents and items as GeoJSON, and what is wrong with it now.
  async function detail(db, id) {
    const { rows: [r] } = await db.query(
      `SELECT c.id, c.kind, c.status, c.reason, c.requested_by, c.submitted_at, c.decided_by, c.decided_at, c.decision_note,
              c.survey_task_id, c.general_plan_id, c.created_at, c.updated_at,
              COALESCE(u.full_name, u.name) AS requested_by_name
         FROM land.parcel_change_request c LEFT JOIN public.users u ON u.id = c.requested_by WHERE c.id = $1`, [id])
    if (!r) return null
    const { rows: parents } = await db.query(
      `SELECT p.parcel_id, p.stand_no, p.township_code, p.status, round(p.area_m2) AS area_m2, ST_AsGeoJSON(p.geom_wgs84, 7)::json AS geometry
         FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = $1 ORDER BY p.stand_no`, [id])
    const { rows: items } = await db.query(
      `SELECT seq, role, label, parent_parcel_id, matched_parcel_id, round(ST_Area(geom::geography)::numeric, 1) AS area_m2,
              ST_AsGeoJSON(geom, 7)::json AS geometry
         FROM land.parcel_change_item WHERE request_id = $1 ORDER BY seq`, [id])
    const { rows: problems } = await db.query('SELECT code, detail FROM land.change_request_problems($1)', [id])
    return { ...r, parents, items, problems }
  }

  async function writeBody(client, id, p) {
    await client.query('DELETE FROM land.parcel_change_item WHERE request_id = $1', [id])
    await client.query('DELETE FROM land.parcel_change_parent WHERE request_id = $1', [id])
    for (const pid of p.parentIds) {
      const { rowCount } = await client.query(
        `INSERT INTO land.parcel_change_parent (request_id, parcel_id) SELECT $1, parcel_id FROM land.parcel WHERE parcel_id = $2`, [id, pid])
      if (!rowCount) { const e = new Error(`unknown stand ${pid}`); e.code = 'UNKNOWN_PARENT'; throw e }
    }
    for (const [i, it] of p.items.entries()) {
      await client.query(
        `INSERT INTO land.parcel_change_item (request_id, seq, role, label, parent_parcel_id, geom)
         VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)))`,
        [id, i + 1, it.role, it.label || null, it.role === 'revised' ? String(it.parent_parcel_id) : null, JSON.stringify(it.geometry)])
    }
  }

  const bodyError = (reply, err) => {
    if (err.code === 'UNKNOWN_PARENT') return reply.code(422).send({ success: false, error: 'unknown_stand', message: err.message })
    if (err.code === 'XX000' || err.code === '22023' || /geometry|geojson|parse/i.test(err.message || '')) {
      return reply.code(422).send({ success: false, error: 'invalid_geometry', message: err.message })
    }
    return null
  }

  // ── geometry helpers for the editor (results go back into the client's proposal) ──
  // The same two operations as POST /gms/geometry/split and /merge, open to the roles that may draft a proposal.
  fastify.post('/parcel-change-requests/helpers/split', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const { geometry, blade } = request.body || {}
    if (!isPolygon(geometry) || !blade || blade.type !== 'LineString') return reply.code(400).send({ success: false, error: 'geometry_and_blade_required' })
    try {
      const { rows } = await fastify.pg.query(
        `SELECT ST_AsGeoJSON(d.geom, 7)::json AS g
           FROM ST_Dump(ST_Split(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))) d
          ORDER BY ST_XMin(d.geom), ST_YMin(d.geom)`,
        [JSON.stringify(geometry), JSON.stringify(blade)])
      if (rows.length < 2) return reply.code(422).send({ success: false, error: 'blade_does_not_cross', message: 'The line does not cut the stand in two: draw it from one side of the stand to the other.' })
      return reply.send({ success: true, data: rows.map((r) => r.g) })
    } catch {
      return reply.code(422).send({ success: false, error: 'cannot_split' })
    }
  })

  fastify.post('/parcel-change-requests/helpers/merge', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const list = request.body?.geometries
    if (!Array.isArray(list) || list.length < 2 || list.length > MAX_ITEMS || !list.every(isPolygon)) return reply.code(400).send({ success: false, error: 'two_or_more_geometries' })
    try {
      const { rows: [r] } = await fastify.pg.query(
        `SELECT ST_AsGeoJSON(u, 7)::json AS g, ST_NumGeometries(u) AS parts FROM (
           SELECT ST_UnaryUnion(ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(x), 4326))) AS u
             FROM jsonb_array_elements_text($1::jsonb) AS x) q`,
        [JSON.stringify(list.map((g) => JSON.stringify(g)))])
      if (r.parts > 1) return reply.code(422).send({ success: false, error: 'not_adjacent', message: 'The stands do not all touch: only adjoining stands can be merged.' })
      return reply.send({ success: true, data: r.g })
    } catch {
      return reply.code(422).send({ success: false, error: 'cannot_merge' })
    }
  })

  // ── list ───────────────────────────────────────────────────────────────
  fastify.get('/parcel-change-requests', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    const params = []
    const where = []
    if (request.query?.mine) { params.push(request.user.id); where.push(`c.requested_by = $${params.length}`) }
    if (isStr(request.query?.status, 100)) {
      params.push(request.query.status.split(',').map((s) => s.trim()).filter(Boolean))
      where.push(`c.status = ANY($${params.length}::text[])`)
    }
    const { rows } = await fastify.pg.query(
      `SELECT c.id, c.kind, c.status, c.reason, c.requested_by, COALESCE(u.full_name, u.name) AS requested_by_name, c.submitted_at, c.decided_at, c.survey_task_id,
              c.general_plan_id, c.created_at,
              (SELECT array_agg(p.stand_no ORDER BY p.stand_no) FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = c.id) AS stands,
              (SELECT count(*)::int FROM land.parcel_change_item i WHERE i.request_id = c.id) AS items
         FROM land.parcel_change_request c LEFT JOIN public.users u ON u.id = c.requested_by
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.created_at DESC LIMIT 200`, params)
    return reply.send({ success: true, data: rows })
  })

  // ── one ────────────────────────────────────────────────────────────────
  fastify.get('/parcel-change-requests/:id', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    if (!UUID.test(request.params.id)) return reply.code(404).send({ success: false, error: 'not_found' })
    const d = await detail(fastify.pg, request.params.id)
    if (!d) return reply.code(404).send({ success: false, error: 'not_found' })
    return reply.send({ success: true, data: d })
  })

  // ── draft ──────────────────────────────────────────────────────────────
  fastify.post('/parcel-change-requests', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const p = parseBody(request.body)
    if (p.error) return reply.code(400).send({ success: false, error: 'bad_request', message: p.error })
    try {
      const id = await fastify.pg.transact(async (client) => {
        const { rows: [r] } = await client.query(
          `INSERT INTO land.parcel_change_request (kind, reason, requested_by) VALUES ($1, $2, $3) RETURNING id`, [p.kind, p.reason, request.user.id])
        await writeBody(client, r.id, p)
        return r.id
      })
      return reply.code(201).send({ success: true, data: await detail(fastify.pg, id) })
    } catch (err) {
      const handled = bodyError(reply, err)
      if (handled) return handled
      request.log.error({ err }, 'draft change request failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── change a draft ─────────────────────────────────────────────────────
  fastify.put('/parcel-change-requests/:id', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const { id } = request.params
    if (!UUID.test(id)) return reply.code(404).send({ success: false, error: 'not_found' })
    const p = parseBody(request.body)
    if (p.error) return reply.code(400).send({ success: false, error: 'bad_request', message: p.error })
    try {
      const out = await fastify.pg.transact(async (client) => {
        const { rows: [r] } = await client.query('SELECT requested_by, status FROM land.parcel_change_request WHERE id = $1 FOR UPDATE', [id])
        if (!r) return { code: 404 }
        if (r.requested_by !== request.user.id && request.user.role !== 'admin') return { code: 403 }
        if (!EDITABLE.has(r.status)) return { code: 409, status: r.status }
        await client.query(`UPDATE land.parcel_change_request SET kind = $2, reason = $3, status = 'draft' WHERE id = $1`, [id, p.kind, p.reason])
        await writeBody(client, id, p)
        return { code: 200 }
      })
      if (out.code === 404) return reply.code(404).send({ success: false, error: 'not_found' })
      if (out.code === 403) return reply.code(403).send({ success: false, error: 'not_your_proposal' })
      if (out.code === 409) return reply.code(409).send({ success: false, error: 'not_editable', message: `A ${out.status} proposal cannot be changed.` })
      return reply.send({ success: true, data: await detail(fastify.pg, id) })
    } catch (err) {
      const handled = bodyError(reply, err)
      if (handled) return handled
      request.log.error({ err }, 'change request update failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── submit: check it, open the survey task ─────────────────────────────
  fastify.post('/parcel-change-requests/:id/submit', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const { id } = request.params
    if (!UUID.test(id)) return reply.code(404).send({ success: false, error: 'not_found' })
    try {
      const out = await fastify.pg.transact(async (client) => {
        const { rows: [r] } = await client.query('SELECT requested_by, status, kind, reason FROM land.parcel_change_request WHERE id = $1 FOR UPDATE', [id])
        if (!r) return { code: 404 }
        if (r.requested_by !== request.user.id && request.user.role !== 'admin') return { code: 403 }
        if (!EDITABLE.has(r.status)) return { code: 409, status: r.status }
        // the stands it affects are held while it is checked, so two proposals cannot both pass for one stand
        await client.query(
          `SELECT 1 FROM land.parcel p WHERE p.parcel_id IN (SELECT parcel_id FROM land.parcel_change_parent WHERE request_id = $1) ORDER BY p.parcel_id FOR UPDATE`, [id])
        const { rows: problems } = await client.query('SELECT code, detail FROM land.change_request_problems($1)', [id])
        if (problems.length) return { code: 422, problems }
        const { rows: [info] } = await client.query(
          `SELECT string_agg(p.stand_no, ', ' ORDER BY p.stand_no) AS stands, min(p.stand_no) AS first_stand,
                  ST_SetSRID(ST_PointOnSurface(ST_UnaryUnion(ST_Collect(p.geom_wgs84))), 4326) AS point
             FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = $1`, [id])
        const instructions = `Stand change proposal ${id} (${r.kind}) for ${info.stands}. ${r.reason || ''} `
          + 'The proposed boundaries are drawn in the proposal; survey them and import the approved plan against this proposal.'
        const { rows: [task] } = await client.query(
          `INSERT INTO spatial_planning.survey_task (task_type, stand_number, location, instructions, priority, assigned_by)
           VALUES ($1, $2, $3, $4, 'normal', $5) RETURNING id`,
          [TASK_TYPE[r.kind], info.first_stand, info.point, instructions.trim(), request.user.id])
        await client.query(
          `UPDATE land.parcel_change_request SET status = 'submitted', submitted_at = now(), survey_task_id = $2, decided_by = NULL, decided_at = NULL, decision_note = NULL
            WHERE id = $1`, [id, task.id])
        return { code: 200 }
      })
      if (out.code === 404) return reply.code(404).send({ success: false, error: 'not_found' })
      if (out.code === 403) return reply.code(403).send({ success: false, error: 'not_your_proposal' })
      if (out.code === 409) return reply.code(409).send({ success: false, error: 'not_submittable', message: `A ${out.status} proposal cannot be submitted.` })
      if (out.code === 422) return reply.code(422).send({ success: false, error: 'has_problems', problems: out.problems })
      return reply.send({ success: true, data: await detail(fastify.pg, id) })
    } catch (err) {
      request.log.error({ err }, 'submit change request failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── withdraw ───────────────────────────────────────────────────────────
  fastify.post('/parcel-change-requests/:id/withdraw', { preHandler: requireRole(fastify, DRAFTERS) }, async (request, reply) => {
    const { id } = request.params
    if (!UUID.test(id)) return reply.code(404).send({ success: false, error: 'not_found' })
    try {
      const out = await fastify.pg.transact(async (client) => {
        const { rows: [r] } = await client.query('SELECT requested_by, status, survey_task_id FROM land.parcel_change_request WHERE id = $1 FOR UPDATE', [id])
        if (!r) return { code: 404 }
        if (r.requested_by !== request.user.id && request.user.role !== 'admin') return { code: 403 }
        if (['applied', 'withdrawn', 'rejected'].includes(r.status)) return { code: 409, status: r.status }
        await client.query(`UPDATE land.parcel_change_request SET status = 'withdrawn' WHERE id = $1`, [id])
        if (r.survey_task_id) await client.query(`UPDATE spatial_planning.survey_task SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('assigned', 'in_progress')`, [r.survey_task_id])
        return { code: 200 }
      })
      if (out.code === 404) return reply.code(404).send({ success: false, error: 'not_found' })
      if (out.code === 403) return reply.code(403).send({ success: false, error: 'not_your_proposal' })
      if (out.code === 409) return reply.code(409).send({ success: false, error: 'not_withdrawable', message: `A ${out.status} proposal cannot be withdrawn.` })
      return reply.send({ success: true, data: await detail(fastify.pg, id) })
    } catch (err) {
      request.log.error({ err }, 'withdraw change request failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── the Survey Section decides ─────────────────────────────────────────
  for (const [action, to, needsNote] of [['accept', 'accepted', false], ['return', 'returned', true], ['reject', 'rejected', true]]) {
    fastify.post(`/parcel-change-requests/:id/${action}`, { preHandler: requireRole(fastify, DECIDERS) }, async (request, reply) => {
      const { id } = request.params
      if (!UUID.test(id)) return reply.code(404).send({ success: false, error: 'not_found' })
      const note = request.body?.note
      if (needsNote && !isStr(note, 4096)) return reply.code(400).send({ success: false, error: 'note_required', message: `Say why the proposal is ${to}.` })
      try {
        const out = await fastify.pg.transact(async (client) => {
          const { rows: [r] } = await client.query('SELECT requested_by, status, survey_task_id FROM land.parcel_change_request WHERE id = $1 FOR UPDATE', [id])
          if (!r) return { code: 404 }
          // separation of duties: the person who drew it does not decide it
          if (r.requested_by === request.user.id) return { code: 403 }
          if (r.status !== 'submitted') return { code: 409, status: r.status }
          await client.query(
            `UPDATE land.parcel_change_request SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
            [id, to, request.user.id, note || null])
          if (to !== 'accepted' && r.survey_task_id) {
            await client.query(`UPDATE spatial_planning.survey_task SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('assigned', 'in_progress')`, [r.survey_task_id])
          }
          return { code: 200 }
        })
        if (out.code === 404) return reply.code(404).send({ success: false, error: 'not_found' })
        if (out.code === 403) return reply.code(403).send({ success: false, error: 'not_the_drafter', message: 'The person who drew a proposal does not decide it.' })
        if (out.code === 409) return reply.code(409).send({ success: false, error: 'not_submitted', message: `A ${out.status} proposal cannot be ${to}.` })
        return reply.send({ success: true, data: await detail(fastify.pg, id) })
      } catch (err) {
        request.log.error({ err }, `${action} change request failed`)
        return reply.code(500).send({ success: false, error: 'internal' })
      }
    })
  }
}

module.exports = { parcelChangeRequestRoutes }
