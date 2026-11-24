/**
 * Housing and Estates (migration 259).
 *
 * The waiting list, interviews, offers, allocations, agreements, cessions, leases, cooperatives,
 * servicing, housing-standards orders, occupation certificates, title requests, repossessions and
 * public announcements — all named to land.parcel and registry.person.
 *
 *   GET    /api/housing/overview
 *   GET    /api/housing/schemes
 *   GET    /api/housing/stands?q=&status=&township=
 *   GET    /api/housing/stands.geojson
 *   GET    /api/housing/stands/:parcelId
 *   GET/POST /api/housing/waiting-list
 *   POST   /api/housing/waiting-list/:id/renew
 *   POST   /api/housing/waiting-list/:id/score
 *   POST   /api/housing/waiting-list/:id/status
 *   GET/POST /api/housing/interviews
 *   POST   /api/housing/allocations
 *   GET    /api/housing/allocations
 *   POST   /api/housing/offers
 *   POST   /api/housing/offers/:id/accept|decline|withdraw
 *   POST   /api/housing/agreements
 *   GET/POST /api/housing/cessions
 *   POST   /api/housing/cessions/:id/decide
 *   GET/POST /api/housing/leases
 *   GET/POST /api/housing/cooperatives
 *   POST   /api/housing/cooperatives/:id/members
 *   PUT    /api/housing/servicing/:parcelId
 *   GET/POST /api/housing/orders
 *   GET/POST /api/housing/overcrowding
 *   GET/POST /api/housing/occupation
 *   GET/POST /api/housing/title
 *   GET/POST /api/housing/repossessions
 *   GET/POST /api/housing/announcements
 *   GET    /api/housing/me                     the signed-in resident's housing files
 *   POST   /api/housing/waiting-list/self      a resident joins the waiting list
 */
const { requireAuth, requireRole } = require('../middleware/jwtAuth')

const STAFF = [
  'housing_officer', 'housing_clerk', 'housing_research', 'housing_area', 'housing_legal', 'housing_committee',
  'admin', 'accounting_officer', 'eo', 'planner', 'hr_social_officer', 'planning_clerk', 'auditor', 'engineer',
]
const HOUSING_POSTS = ['housing_officer', 'housing_clerk', 'housing_research', 'housing_area', 'housing_legal', 'housing_committee']
const ALL_SECTIONS = ['overview', 'map', 'waiting', 'interviews', 'allocations', 'cessions', 'estates', 'standards', 'announce']
const DESKS = {
  housing_officer: {
    title: 'Housing and Estates Officer',
    sections: ALL_SECTIONS,
    can: { waiting: true, interview: true, recommend: true, allocate: true, offer: true, agreement: true, cession_lodge: true, cession_decide: true, lease: true, servicing: true, standards: true, occupation: true, title: true, repossess: true, announce: true, committee: true },
  },
  housing_clerk: {
    title: 'Housing counter',
    sections: ['overview', 'waiting', 'allocations', 'cessions', 'announce'],
    can: { waiting: true, interview: false, recommend: false, allocate: false, offer: true, agreement: false, cession_lodge: true, cession_decide: false, lease: false, servicing: false, standards: false, occupation: false, title: false, repossess: false, announce: true, committee: false },
  },
  housing_research: {
    title: 'Research and allocations',
    sections: ['overview', 'map', 'waiting', 'interviews', 'allocations'],
    can: { waiting: true, interview: true, recommend: true, allocate: false, offer: false, agreement: false, cession_lodge: false, cession_decide: false, lease: false, servicing: false, standards: false, occupation: false, title: false, repossess: false, announce: false, committee: false },
  },
  housing_area: {
    title: 'Area housing officer',
    sections: ['overview', 'map', 'estates', 'standards'],
    can: { waiting: false, interview: false, recommend: false, allocate: false, offer: false, agreement: false, cession_lodge: false, cession_decide: false, lease: true, servicing: true, standards: true, occupation: true, title: false, repossess: false, announce: false, committee: false },
  },
  housing_legal: {
    title: 'Housing legal / conveyancing',
    sections: ['overview', 'cessions', 'allocations'],
    can: { waiting: false, interview: false, recommend: false, allocate: false, offer: false, agreement: true, cession_lodge: true, cession_decide: true, lease: false, servicing: false, standards: false, occupation: false, title: true, repossess: false, announce: false, committee: false },
  },
  housing_committee: {
    title: 'Allocations committee',
    sections: ['overview', 'waiting', 'allocations'],
    can: { waiting: false, interview: false, recommend: true, allocate: false, offer: false, agreement: false, cession_lodge: false, cession_decide: false, lease: false, servicing: false, standards: false, occupation: false, title: false, repossess: false, announce: false, committee: true },
  },
}
function deskOf(role) {
  if (DESKS[role]) return { role, ...DESKS[role] }
  return {
    role,
    title: 'Housing registers (read only)',
    sections: ALL_SECTIONS,
    can: Object.fromEntries(Object.keys(DESKS.housing_officer.can).map((k) => [k, false])),
  }
}
function writers(...actions) {
  const roles = new Set(['admin'])
  for (const [role, desk] of Object.entries(DESKS)) {
    if (actions.some((a) => desk.can[a])) roles.add(role)
  }
  return [...roles]
}
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)
const money = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function fail(reply, status, error, message) {
  return reply.code(status).send({ success: false, error, message })
}
function ok(reply, data, status = 200) {
  return reply.code(status).send({ success: true, data })
}
function refuse(reply, err, fallback) {
  const msg = err?.message || fallback
  if (err?.code === '23505') return fail(reply, 409, 'conflict', msg.includes('already allocated') ? 'That stand is already allocated.' : 'That record is already on file.')
  if (err?.code === '23503') return fail(reply, 404, 'not_found', msg)
  if (err?.code === '23514') return fail(reply, 400, 'invalid', msg)
  return fail(reply, 500, 'failed', fallback)
}

async function housingRoutes(fastify) {
  const pg = fastify.pg
  const canRead = { preHandler: requireRole(fastify, STAFF) }
  const write = (...actions) => ({ preHandler: requireRole(fastify, writers(...actions)) })
  const signedIn = { preHandler: requireAuth(fastify) }

  fastify.get('/housing/desk', canRead, async (request, reply) => {
    const desk = deskOf(request.user.role)
    try {
      const { rows: [q] } = await pg.query(`
        SELECT
          (SELECT count(*)::int FROM housing.waiting_list WHERE status IN ('active','invited','interviewed','recommended')) AS waiting,
          (SELECT count(*)::int FROM housing.waiting_list WHERE lapses_on < CURRENT_DATE AND status = 'active') AS due_renewal,
          (SELECT count(*)::int FROM housing.waiting_list WHERE status = 'recommended') AS recommended,
          (SELECT count(*)::int FROM housing.cession WHERE status = 'lodged') AS cessions_lodged,
          (SELECT count(*)::int FROM housing.standard_order WHERE status = 'open') AS orders_open,
          (SELECT count(*)::int FROM housing.allocation WHERE ended_at IS NULL AND deposit_due > 0 AND deposit_receipt_id IS NULL) AS deposits_outstanding
      `)
      return ok(reply, { ...desk, queues: q, posts: HOUSING_POSTS })
    } catch (err) {
      request.log.error({ err }, 'housing desk failed')
      return ok(reply, { ...desk, queues: {}, posts: HOUSING_POSTS })
    }
  })

  fastify.get('/housing/cross/:parcelId', canRead, async (request, reply) => {
    const id = request.params.parcelId
    try {
      const { rows } = await pg.query(
        `SELECT * FROM housing.v_cross_file WHERE parcel_id = $1`, [id])
      if (!rows.length) return fail(reply, 404, 'not_found', 'That stand is not on the housing map.')
      const file = rows[0]
      const { rows: permits } = await pg.query(
        `SELECT id, tpd_reference, dev_register_no, stand_number, applicant_name, development_type, status
           FROM spatial_planning.permit_application
          WHERE parcel_id = $1 OR stand_number = $2
          ORDER BY received_at DESC NULLS LAST LIMIT 20`, [id, file.stand_no])
      const { rows: fees } = await pg.query(
        `SELECT f.fee_kind, f.amount::text AS amount, f.currency, f.received_on::text AS received_on, r.receipt_no
           FROM finance.housing_fee f JOIN finance.cash_receipt r ON r.id = f.cash_receipt_id
          WHERE f.allocation_id = $1 ORDER BY f.received_on DESC LIMIT 20`, [file.allocation_id]).catch(() => ({ rows: [] }))
      return ok(reply, { file, permits, housing_fees: fees })
    } catch (err) {
      request.log.error({ err }, 'housing cross file failed')
      return fail(reply, 500, 'failed', 'The shared stand file could not be read.')
    }
  })

  fastify.get('/housing/dual-ownership', canRead, async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
    if (q.length < 2) return fail(reply, 400, 'invalid', 'Name the person or national identity number to search.')
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    const { rows } = await pg.query(
      `SELECT p.id AS person_id, p.display_name,
              (SELECT json_agg(jsonb_build_object('list_no', w.list_no, 'status', w.status, 'sought', w.sought))
                 FROM housing.waiting_list w WHERE w.person_id = p.id) AS waiting_list,
              (SELECT json_agg(jsonb_build_object('parcel_id', a.parcel_id, 'status', a.status, 'allottee_name', a.allottee_name))
                 FROM housing.allocation a WHERE a.person_id = p.id AND a.ended_at IS NULL) AS allocations
         FROM registry.person p
        WHERE p.display_name ILIKE $1
           OR CAST(p.id AS text) ILIKE $1
        ORDER BY p.display_name
        LIMIT 20`, [like])
    return ok(reply, { matches: rows, dual: rows.some((r) => (r.allocations || []).length > 0) })
  })

  fastify.get('/housing/committee', canRead, async (request, reply) => {
    try {
      const { rows: sittings } = await pg.query(
        `SELECT s.*, (SELECT count(*)::int FROM housing.committee_item i WHERE i.sitting_id = s.id) AS items
           FROM housing.committee_sitting s ORDER BY s.sitting_on DESC LIMIT 50`)
      const { rows: items } = await pg.query(
        `SELECT i.*, w.list_no, w.applicant_name, p.stand_no
           FROM housing.committee_item i
           JOIN housing.waiting_list w ON w.id = i.waiting_list_id
           LEFT JOIN land.parcel p ON p.parcel_id = i.parcel_id
          ORDER BY i.created_at DESC LIMIT 200`)
      return ok(reply, { sittings, items })
    } catch (err) {
      request.log.error({ err }, 'housing committee read failed')
      return ok(reply, { sittings: [], items: [] })
    }
  })

  fastify.post('/housing/committee', write('committee'), async (request, reply) => {
    const b = request.body || {}
    const { rows } = await pg.query(
      `INSERT INTO housing.committee_sitting (sitting_on, minute_ref, scheme_id, notes, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5) RETURNING *`,
      [b.sitting_on || null, text(b.minute_ref, 80), b.scheme_id || null, text(b.notes, 2000), request.user.id])
    return ok(reply, { sitting: rows[0] }, 201)
  })

  fastify.post('/housing/committee/:id/items', write('committee', 'recommend'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.waiting_list_id) || !['allocate', 'defer', 'refuse'].includes(b.recommendation)) {
      return fail(reply, 400, 'invalid', 'Name the waiting-list entry and whether to allocate, defer or refuse.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.committee_item (sitting_id, waiting_list_id, parcel_id, recommendation, decided_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [request.params.id, b.waiting_list_id, b.parcel_id || null, b.recommendation, request.user.id])
      if (b.recommendation === 'allocate') {
        await pg.query(`UPDATE housing.waiting_list SET status = 'recommended', updated_at = now() WHERE id = $1`, [b.waiting_list_id])
      } else if (b.recommendation === 'refuse') {
        await pg.query(`UPDATE housing.waiting_list SET status = 'ineligible', ineligible_reason = 'Refused by allocations committee', updated_at = now() WHERE id = $1`,
          [b.waiting_list_id])
      }
      return ok(reply, { item: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The committee item could not be written.')
    }
  })

  fastify.get('/housing/overview', canRead, async (request, reply) => {
    try {
      const { rows: [k] } = await pg.query(`
        SELECT
          (SELECT count(*)::int FROM housing.waiting_list WHERE status IN ('active','invited','interviewed','recommended')) AS waiting,
          (SELECT count(*)::int FROM housing.waiting_list WHERE status = 'lapsed') AS lapsed,
          (SELECT count(*)::int FROM housing.waiting_list WHERE lapses_on < CURRENT_DATE AND status = 'active') AS due_renewal,
          (SELECT count(*)::int FROM housing.allocation WHERE ended_at IS NULL AND status NOT IN ('cancelled','repossessed')) AS allocated,
          (SELECT count(*)::int FROM housing.v_spatial_stand WHERE map_status = 'vacant' AND township_code IN ('HERTS','LAYOUT')) AS vacant,
          (SELECT count(*)::int FROM housing.offer WHERE accepted_on IS NULL AND declined_on IS NULL AND withdrawn_on IS NULL AND expires_on < CURRENT_DATE) AS offers_expired,
          (SELECT count(*)::int FROM housing.cession WHERE status = 'lodged') AS cessions_open,
          (SELECT count(*)::int FROM housing.lease WHERE status = 'active') AS leases,
          (SELECT count(*)::int FROM housing.standard_order WHERE status = 'open') AS orders_open,
          (SELECT count(*)::int FROM housing.repossession WHERE status = 'noticed') AS repossessions,
          (SELECT count(*)::int FROM housing.scheme WHERE status = 'open') AS schemes
      `)
      const { rows: schemes } = await pg.query(
        `SELECT s.id, s.code, s.name, s.kind, s.status, s.target_stands, s.area_ha::text AS area_ha,
                (SELECT count(*)::int FROM housing.v_spatial_stand v WHERE v.township_code = s.township_code AND v.map_status = 'vacant') AS vacant,
                (SELECT count(*)::int FROM housing.v_spatial_stand v WHERE v.township_code = s.township_code AND v.map_status <> 'vacant') AS taken
           FROM housing.scheme s ORDER BY s.name`)
      const { rows: wards } = await pg.query(
        `SELECT preferred_ward AS ward, count(*)::int AS n
           FROM housing.waiting_list
          WHERE status IN ('active','invited','interviewed','recommended') AND preferred_ward IS NOT NULL
          GROUP BY 1 ORDER BY 1`)
      return ok(reply, { kpis: k, schemes, demand_by_ward: wards })
    } catch (err) {
      request.log.error({ err }, 'housing overview failed')
      return fail(reply, 500, 'overview_failed', 'The housing desk could not be read.')
    }
  })

  fastify.get('/housing/schemes', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT id, code, name, kind, township_code, description, status, area_ha::text AS area_ha,
              target_stands, services_note, opened_on::text AS opened_on
         FROM housing.scheme ORDER BY name`)
    return ok(reply, { schemes: rows })
  })

  fastify.get('/housing/stands', canRead, async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
    const status = typeof request.query.status === 'string' ? request.query.status : ''
    const township = typeof request.query.township === 'string' ? request.query.township : ''
    const limit = Math.min(500, Math.max(1, Number(request.query.limit) || 80))
    const params = []
    const where = ['true']
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`)
      where.push(`(v.stand_no ILIKE $${params.length} OR v.parcel_id ILIKE $${params.length} OR COALESCE(v.allottee_name,'') ILIKE $${params.length})`)
    }
    if (['vacant', 'reserved', 'offered', 'sold', 'occupied', 'leased'].includes(status)) {
      params.push(status)
      where.push(`v.map_status = $${params.length}`)
    }
    if (township) {
      params.push(township)
      where.push(`v.township_code = $${params.length}`)
    }
    const { rows } = await pg.query(
      `SELECT v.parcel_id, v.stand_no, v.township_code, v.ward_code, v.area_m2::text AS area_m2,
              v.lon, v.lat, v.scheme_name, v.map_status, v.allottee_name, v.allocated_on::text AS allocated_on,
              v.water, v.sewer, v.road, v.electricity
         FROM housing.v_spatial_stand v
        WHERE ${where.join(' AND ')}
        ORDER BY v.township_code, v.stand_no
        LIMIT ${limit}`, params)
    return ok(reply, { stands: rows })
  })

  fastify.get('/housing/stands.geojson', canRead, async (request, reply) => {
    const township = typeof request.query.township === 'string' ? request.query.township : ''
    const params = []
    let extra = ''
    if (township) { params.push(township); extra = `AND v.township_code = $1` }
    try {
      const { rows } = await pg.query(
        `SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(jsonb_build_object(
              'type', 'Feature',
              'id', v.parcel_id,
              'geometry', ST_AsGeoJSON(v.geom_wgs84)::jsonb,
              'properties', jsonb_build_object(
                'parcel_id', v.parcel_id, 'stand_no', v.stand_no, 'township', v.township_code,
                'ward', v.ward_code, 'area_m2', v.area_m2, 'status', v.map_status,
                'allottee', v.allottee_name, 'scheme', v.scheme_name,
                'water', v.water, 'sewer', v.sewer, 'road', v.road, 'electricity', v.electricity
              )
            )), '[]'::jsonb)
          ) AS fc
           FROM housing.v_spatial_stand v
          WHERE v.township_code IN ('HERTS','LAYOUT') ${extra}`, params)
      reply.header('content-type', 'application/geo+json')
      return rows[0].fc
    } catch (err) {
      request.log.error({ err }, 'housing geojson failed')
      return fail(reply, 500, 'map_failed', 'The housing map could not be read.')
    }
  })

  fastify.get('/housing/stands/:parcelId', canRead, async (request, reply) => {
    const id = request.params.parcelId
    const { rows } = await pg.query(
      `SELECT v.*, v.area_m2::text AS area_m2 FROM housing.v_spatial_stand v WHERE v.parcel_id = $1`, [id])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That stand is not on the housing map.')
    const stand = rows[0]
    delete stand.geom_wgs84
    const [alloc, orders, occ, lease, permits, cross] = await Promise.all([
      pg.query(`SELECT * FROM housing.allocation WHERE parcel_id = $1 ORDER BY created_at DESC LIMIT 8`, [id]),
      pg.query(`SELECT * FROM housing.standard_order WHERE parcel_id = $1 ORDER BY created_at DESC LIMIT 8`, [id]),
      pg.query(`SELECT * FROM housing.occupation WHERE parcel_id = $1 ORDER BY created_at DESC LIMIT 8`, [id]),
      pg.query(`SELECT * FROM housing.lease WHERE parcel_id = $1 ORDER BY created_at DESC LIMIT 8`, [id]),
      pg.query(
        `SELECT id, tpd_reference, stand_number, applicant_name, development_type, status
           FROM spatial_planning.permit_application
          WHERE parcel_id = $1 OR stand_number = $2 ORDER BY received_at DESC NULLS LAST LIMIT 12`,
        [id, stand.stand_no]),
      pg.query(`SELECT * FROM housing.v_cross_file WHERE parcel_id = $1`, [id]).catch(() => ({ rows: [] })),
    ])
    return ok(reply, {
      stand, allocations: alloc.rows, orders: orders.rows, occupation: occ.rows, leases: lease.rows,
      permits: permits.rows, cross: cross.rows[0] || null,
    })
  })

  fastify.get('/housing/waiting-list', canRead, async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
    const status = typeof request.query.status === 'string' ? request.query.status : ''
    const params = []
    const where = ['true']
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`)
      where.push(`(w.list_no ILIKE $${params.length} OR w.applicant_name ILIKE $${params.length})`)
    }
    if (status) { params.push(status); where.push(`w.status = $${params.length}`) }
    const { rows } = await pg.query(
      `SELECT w.*, s.name AS scheme_name, p.display_name AS person_name
         FROM housing.waiting_list w
         LEFT JOIN housing.scheme s ON s.id = w.preferred_scheme_id
         LEFT JOIN registry.person p ON p.id = w.person_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(w.score, 0) DESC, w.registered_on, w.list_no
        LIMIT 200`, params)
    return ok(reply, { entries: rows })
  })

  fastify.post('/housing/waiting-list', write('waiting'), async (request, reply) => {
    const b = request.body || {}
    const name = text(b.applicant_name, 200)
    const sought = b.sought || 'stand'
    if (!name || name.length < 2) return fail(reply, 400, 'invalid', 'Name the applicant.')
    if (!['stand', 'rental', 'staff', 'cooperative', 'pay_scheme'].includes(sought)) {
      return fail(reply, 400, 'invalid', 'Say what they are seeking.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.waiting_list
           (list_no, person_id, applicant_name, sought, density, preferred_scheme_id, preferred_ward,
            household_size, monthly_income, currency, employer, special_needs, resident, first_time_seeker,
            lapses_on, notes, created_by)
         VALUES (housing.next_no('WL-', 'housing.list_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CURRENT_DATE + interval '1 year', $14, $15)
         RETURNING *`,
        [b.person_id || null, name, sought, b.density || 'any', b.preferred_scheme_id || null,
          b.preferred_ward || null, b.household_size || null, money(b.monthly_income), b.currency || 'USD',
          text(b.employer, 160), text(b.special_needs, 400), b.resident !== false, b.first_time_seeker !== false,
          text(b.notes, 2000), request.user.id])
      await pg.query('SELECT housing.score_entry($1)', [rows[0].id])
      const { rows: scored } = await pg.query('SELECT * FROM housing.waiting_list WHERE id = $1', [rows[0].id])
      return ok(reply, { entry: scored[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The waiting-list entry could not be written.')
    }
  })

  fastify.post('/housing/waiting-list/:id/renew', write('waiting'), async (request, reply) => {
    if (!isUuid(request.params.id)) return fail(reply, 400, 'bad_id', 'That is not a waiting-list entry.')
    const { rows } = await pg.query(
      `UPDATE housing.waiting_list SET renewed_on = CURRENT_DATE, lapses_on = CURRENT_DATE + interval '1 year',
              status = CASE WHEN status = 'lapsed' THEN 'active' ELSE status END, updated_at = now()
        WHERE id = $1 RETURNING *`, [request.params.id])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That waiting-list entry is not on file.')
    return ok(reply, { entry: rows[0] })
  })

  fastify.post('/housing/waiting-list/:id/score', write('interview'), async (request, reply) => {
    if (!isUuid(request.params.id)) return fail(reply, 400, 'bad_id', 'That is not a waiting-list entry.')
    const { rows } = await pg.query('SELECT housing.score_entry($1) AS score', [request.params.id])
    return ok(reply, { score: rows[0].score })
  })

  fastify.post('/housing/waiting-list/:id/status', write('recommend', 'waiting'), async (request, reply) => {
    const status = request.body?.status
    const allowed = ['active', 'invited', 'interviewed', 'recommended', 'lapsed', 'withdrawn', 'ineligible']
    if (!allowed.includes(status)) return fail(reply, 400, 'invalid', 'That is not a waiting-list status Housing can set.')
    const { rows } = await pg.query(
      `UPDATE housing.waiting_list SET status = $2, ineligible_reason = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [request.params.id, status, text(request.body?.ineligible_reason, 400)])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That waiting-list entry is not on file.')
    return ok(reply, { entry: rows[0] })
  })

  fastify.get('/housing/interviews', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT i.*, w.list_no, w.applicant_name
         FROM housing.interview i JOIN housing.waiting_list w ON w.id = i.waiting_list_id
        ORDER BY COALESCE(i.held_on, i.invited_on) DESC NULLS LAST LIMIT 200`)
    return ok(reply, { interviews: rows })
  })

  fastify.post('/housing/interviews', write('interview'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.waiting_list_id)) return fail(reply, 400, 'invalid', 'Name the waiting-list entry being interviewed.')
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.interview
           (waiting_list_id, invited_on, held_on, officer_id, capacity_ok, documents_complete, dual_ownership, recommendation, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [b.waiting_list_id, b.invited_on || null, b.held_on || new Date().toISOString().slice(0, 10),
          request.user.id, !!b.capacity_ok, !!b.documents_complete, !!b.dual_ownership,
          b.recommendation || null, text(b.notes, 2000)])
      if (b.recommendation === 'allocate') {
        await pg.query(`UPDATE housing.waiting_list SET status = 'recommended', updated_at = now() WHERE id = $1`, [b.waiting_list_id])
      } else if (b.recommendation === 'disqualify') {
        await pg.query(`UPDATE housing.waiting_list SET status = 'ineligible', ineligible_reason = $2, updated_at = now() WHERE id = $1`,
          [b.waiting_list_id, text(b.notes, 400) || 'Disqualified at interview.'])
      } else {
        await pg.query(`UPDATE housing.waiting_list SET status = 'interviewed', updated_at = now() WHERE id = $1`, [b.waiting_list_id])
      }
      return ok(reply, { interview: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The interview could not be written.')
    }
  })

  fastify.get('/housing/allocations', canRead, async (request, reply) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : ''
    const params = []
    let where = 'true'
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`)
      where = `(a.allottee_name ILIKE $1 OR a.parcel_id ILIKE $1 OR p.stand_no ILIKE $1)`
    }
    const { rows } = await pg.query(
      `SELECT a.*, p.stand_no, p.township_code, w.list_no
         FROM housing.allocation a
         JOIN land.parcel p ON p.parcel_id = a.parcel_id
         LEFT JOIN housing.waiting_list w ON w.id = a.waiting_list_id
        WHERE ${where}
        ORDER BY a.allocated_on DESC, a.created_at DESC LIMIT 200`, params)
    return ok(reply, { allocations: rows })
  })

  fastify.post('/housing/allocations', write('allocate'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.waiting_list_id) || !b.parcel_id) {
      return fail(reply, 400, 'invalid', 'Name the waiting-list entry and the stand.')
    }
    try {
      const { rows } = await pg.query(
        'SELECT housing.allocate_stand($1,$2,$3,$4,$5,$6,$7) AS id',
        [b.waiting_list_id, b.parcel_id, request.user.id, text(b.committee_minute, 200),
          money(b.purchase_price), money(b.deposit_due), text(b.waiver_reason, 400)])
      const { rows: all } = await pg.query('SELECT * FROM housing.allocation WHERE id = $1', [rows[0].id])
      return ok(reply, { allocation: all[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The stand could not be allocated.')
    }
  })

  fastify.post('/housing/offers', write('offer'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.allocation_id)) return fail(reply, 400, 'invalid', 'Name the allocation this offer is for.')
    const days = Math.min(90, Math.max(7, Number(b.days) || 30))
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.offer (offer_no, allocation_id, expires_on, created_by)
         VALUES (housing.next_no('HO-', 'housing.offer_no_seq'), $1, CURRENT_DATE + $2::int, $3)
         RETURNING *`, [b.allocation_id, days, request.user.id])
      await pg.query(`UPDATE housing.allocation SET status = 'offered', updated_at = now() WHERE id = $1`, [b.allocation_id])
      return ok(reply, { offer: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The offer letter could not be issued.')
    }
  })

  async function closeOffer(request, reply, field, extra = {}) {
    const { rows } = await pg.query(
      `UPDATE housing.offer SET ${field} = CURRENT_DATE${extra.sql || ''} WHERE id = $1 RETURNING *`,
      extra.params ? [request.params.id, ...extra.params] : [request.params.id])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That offer is not on file.')
    return ok(reply, { offer: rows[0] })
  }

  fastify.post('/housing/offers/:id/accept', write('offer'), (req, reply) => closeOffer(req, reply, 'accepted_on'))
  fastify.post('/housing/offers/:id/decline', write('offer'), (req, reply) => closeOffer(req, reply, 'declined_on'))
  fastify.post('/housing/offers/:id/withdraw', write('allocate'), async (request, reply) => {
    const reason = text(request.body?.reason, 400) || 'Offer withdrawn.'
    const { rows } = await pg.query(
      `UPDATE housing.offer SET withdrawn_on = CURRENT_DATE, withdraw_reason = $2 WHERE id = $1 RETURNING *`,
      [request.params.id, reason])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That offer is not on file.')
    await pg.query(
      `UPDATE housing.allocation SET status = 'cancelled', ended_at = now(), ended_reason = $2, updated_at = now()
        WHERE id = $1`, [rows[0].allocation_id, reason])
    return ok(reply, { offer: rows[0] })
  })

  fastify.get('/housing/offers', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT o.*, a.allottee_name, a.parcel_id, p.stand_no
         FROM housing.offer o
         JOIN housing.allocation a ON a.id = o.allocation_id
         JOIN land.parcel p ON p.parcel_id = a.parcel_id
        ORDER BY o.issued_on DESC LIMIT 200`)
    return ok(reply, { offers: rows })
  })

  fastify.post('/housing/agreements', write('agreement'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.allocation_id)) return fail(reply, 400, 'invalid', 'Name the allocation this agreement is for.')
    const { rows: owed } = await pg.query(
      `SELECT deposit_due, deposit_receipt_id FROM housing.allocation WHERE id = $1`, [b.allocation_id])
    if (!owed.length) return fail(reply, 404, 'not_found', 'That allocation is not on file.')
    if (Number(owed[0].deposit_due) > 0 && !owed[0].deposit_receipt_id) {
      return fail(reply, 400, 'invalid', 'The cash office must receipt the stand deposit before Housing signs the agreement of sale.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.agreement (agreement_no, allocation_id, balance_due, created_by)
         VALUES (housing.next_no('AS-', 'housing.agreement_no_seq'), $1, $2, $3) RETURNING *`,
        [b.allocation_id, money(b.balance_due), request.user.id])
      await pg.query(`UPDATE housing.allocation SET status = 'sold', deposit_paid_on = COALESCE(deposit_paid_on, CURRENT_DATE), updated_at = now() WHERE id = $1`,
        [b.allocation_id])
      return ok(reply, { agreement: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The agreement of sale could not be signed.')
    }
  })

  fastify.get('/housing/agreements', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT g.*, a.allottee_name, a.parcel_id FROM housing.agreement g
         JOIN housing.allocation a ON a.id = g.allocation_id ORDER BY g.signed_on DESC LIMIT 200`)
    return ok(reply, { agreements: rows })
  })

  fastify.get('/housing/cessions', canRead, async (_request, reply) => {
    const { rows } = await pg.query(`SELECT * FROM housing.cession ORDER BY lodged_on DESC LIMIT 200`)
    return ok(reply, { cessions: rows })
  })

  fastify.post('/housing/cessions', write('cession_lodge'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.allocation_id) || !text(b.from_name, 200) || !text(b.to_name, 200)) {
      return fail(reply, 400, 'invalid', 'Name the allocation, the cedent and the cessionary.')
    }
    const kind = b.kind || 'ordinary'
    if (!['ordinary', 'deceased_estate', 'court_order'].includes(kind)) {
      return fail(reply, 400, 'invalid', 'A cession is ordinary, a deceased estate or a court order.')
    }
    if (kind === 'ordinary' && !isUuid(b.to_waiting_list_id)) {
      return fail(reply, 400, 'invalid', 'An ordinary cessionary must already be on the waiting list.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.cession
           (cession_no, allocation_id, kind, from_person_id, to_person_id, from_name, to_name,
            to_waiting_list_id, court_ref, letters_of_admin, spouse_consent, notes, created_by)
         VALUES (housing.next_no('CS-', 'housing.cession_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [b.allocation_id, kind, b.from_person_id || null, b.to_person_id || null, text(b.from_name, 200),
          text(b.to_name, 200), b.to_waiting_list_id || null, text(b.court_ref, 80), text(b.letters_of_admin, 80),
          !!b.spouse_consent, text(b.notes, 2000), request.user.id])
      return ok(reply, { cession: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The cession could not be lodged.')
    }
  })

  fastify.post('/housing/cessions/:id/decide', write('cession_decide'), async (request, reply) => {
    const status = request.body?.status
    if (!['approved', 'refused', 'completed'].includes(status)) {
      return fail(reply, 400, 'invalid', 'A cession is approved, refused or completed.')
    }
    const { rows } = await pg.query(
      `UPDATE housing.cession SET status = $2, decided_on = CURRENT_DATE WHERE id = $1 RETURNING *`,
      [request.params.id, status])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That cession is not on file.')
    if (status === 'completed') {
      await pg.query(
        `UPDATE housing.allocation SET allottee_name = $2, person_id = COALESCE($3, person_id), updated_at = now()
          WHERE id = $1`, [rows[0].allocation_id, rows[0].to_name, rows[0].to_person_id])
    }
    return ok(reply, { cession: rows[0] })
  })

  fastify.get('/housing/leases', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT l.*, p.stand_no FROM housing.lease l JOIN land.parcel p ON p.parcel_id = l.parcel_id
        ORDER BY l.start_on DESC LIMIT 200`)
    return ok(reply, { leases: rows })
  })

  fastify.post('/housing/leases', write('lease'), async (request, reply) => {
    const b = request.body || {}
    const name = text(b.tenant_name, 200)
    if (!b.parcel_id || !name) return fail(reply, 400, 'invalid', 'Name the stand and the tenant.')
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.lease
           (lease_no, allocation_id, parcel_id, person_id, tenant_name, kind, rent, currency, end_on, notes, created_by)
         VALUES (housing.next_no('LS-', 'housing.lease_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [b.allocation_id || null, b.parcel_id, b.person_id || null, name, b.kind || 'council_rental',
          money(b.rent), b.currency || 'USD', b.end_on || null, text(b.notes, 2000), request.user.id])
      if (b.allocation_id) {
        await pg.query(`UPDATE housing.allocation SET status = 'leased', updated_at = now() WHERE id = $1`, [b.allocation_id])
      }
      return ok(reply, { lease: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The lease could not be written.')
    }
  })

  fastify.get('/housing/cooperatives', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT c.*, (SELECT count(*)::int FROM housing.cooperative_member m WHERE m.cooperative_id = c.id) AS members
         FROM housing.cooperative c ORDER BY c.name`)
    return ok(reply, { cooperatives: rows })
  })

  fastify.post('/housing/cooperatives', write('lease'), async (request, reply) => {
    const b = request.body || {}
    const name = text(b.name, 200)
    if (!name) return fail(reply, 400, 'invalid', 'Name the cooperative.')
    const { rows } = await pg.query(
      `INSERT INTO housing.cooperative (name, registration_no, scheme_id, contact_name, members_target, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, text(b.registration_no, 80), b.scheme_id || null, text(b.contact_name, 200),
        b.members_target || null, text(b.notes, 2000)])
    return ok(reply, { cooperative: rows[0] }, 201)
  })

  fastify.post('/housing/cooperatives/:id/members', write('lease'), async (request, reply) => {
    const name = text(request.body?.member_name, 200)
    if (!name) return fail(reply, 400, 'invalid', 'Name the member.')
    const { rows } = await pg.query(
      `INSERT INTO housing.cooperative_member (cooperative_id, person_id, member_name, waiting_list_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [request.params.id, request.body?.person_id || null, name, request.body?.waiting_list_id || null])
    return ok(reply, { member: rows[0] }, 201)
  })

  fastify.put('/housing/servicing/:parcelId', write('servicing'), async (request, reply) => {
    const b = request.body || {}
    const { rows } = await pg.query(
      `INSERT INTO housing.servicing (parcel_id, water, sewer, road, electricity, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (parcel_id) DO UPDATE SET
         water = EXCLUDED.water, sewer = EXCLUDED.sewer, road = EXCLUDED.road,
         electricity = EXCLUDED.electricity, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [request.params.parcelId, !!b.water, !!b.sewer, !!b.road, !!b.electricity, text(b.notes, 400), request.user.id])
    return ok(reply, { servicing: rows[0] })
  })

  fastify.get('/housing/orders', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT o.*, p.stand_no FROM housing.standard_order o JOIN land.parcel p ON p.parcel_id = o.parcel_id
        ORDER BY o.served_on DESC LIMIT 200`)
    return ok(reply, { orders: rows })
  })

  fastify.post('/housing/orders', write('standards'), async (request, reply) => {
    const b = request.body || {}
    if (!b.parcel_id || !text(b.reason, 400) || !['repair', 'demolition', 'closure', 'clearance'].includes(b.kind)) {
      return fail(reply, 400, 'invalid', 'Name the stand, the kind of order and the reason.')
    }
    const { rows } = await pg.query(
      `INSERT INTO housing.standard_order (order_no, parcel_id, kind, reason, comply_by, notes, created_by)
       VALUES (housing.next_no('HS-', 'housing.order_no_seq'), $1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.parcel_id, b.kind, text(b.reason, 400), b.comply_by || null, text(b.notes, 2000), request.user.id])
    return ok(reply, { order: rows[0] }, 201)
  })

  fastify.get('/housing/overcrowding', canRead, async (_request, reply) => {
    const { rows } = await pg.query(`SELECT * FROM housing.overcrowding ORDER BY notice_on DESC LIMIT 200`)
    return ok(reply, { notices: rows })
  })

  fastify.post('/housing/overcrowding', write('standards'), async (request, reply) => {
    const b = request.body || {}
    if (!b.parcel_id || !(Number(b.occupants) >= 1)) return fail(reply, 400, 'invalid', 'Name the stand and how many people occupy it.')
    const { rows } = await pg.query(
      `INSERT INTO housing.overcrowding (parcel_id, occupants, rooms, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.parcel_id, Number(b.occupants), b.rooms || null, text(b.notes, 2000), request.user.id])
    return ok(reply, { notice: rows[0] }, 201)
  })

  fastify.get('/housing/occupation', canRead, async (_request, reply) => {
    const { rows } = await pg.query(`SELECT * FROM housing.occupation ORDER BY issued_on DESC LIMIT 200`)
    return ok(reply, { certificates: rows })
  })

  fastify.post('/housing/occupation', write('occupation'), async (request, reply) => {
    const b = request.body || {}
    if (!b.parcel_id) return fail(reply, 400, 'invalid', 'Name the stand.')
    const { rows } = await pg.query(
      `INSERT INTO housing.occupation (certificate_no, parcel_id, allocation_id, kind, notes, created_by)
       VALUES (housing.next_no('OC-', 'housing.occ_no_seq'), $1, $2, $3, $4, $5) RETURNING *`,
      [b.parcel_id, b.allocation_id || null, b.kind || 'occupation', text(b.notes, 2000), request.user.id])
    if (b.allocation_id) {
      await pg.query(`UPDATE housing.allocation SET status = 'occupied', updated_at = now() WHERE id = $1`, [b.allocation_id])
    }
    return ok(reply, { certificate: rows[0] }, 201)
  })

  fastify.get('/housing/title', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT t.*, a.allottee_name, a.parcel_id FROM housing.title_request t
         JOIN housing.allocation a ON a.id = t.allocation_id ORDER BY t.lodged_on DESC LIMIT 200`)
    return ok(reply, { requests: rows })
  })

  fastify.post('/housing/title', write('title'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.allocation_id)) return fail(reply, 400, 'invalid', 'Name the allocation title is being sought for.')
    const { rows: a } = await pg.query(`SELECT parcel_id FROM housing.allocation WHERE id = $1`, [b.allocation_id])
    if (!a.length) return fail(reply, 404, 'not_found', 'That allocation is not on file.')
    const { rows: rates } = await pg.query(
      `SELECT usd_balance FROM finance.v_property_finance WHERE parcel_id = $1`, [a[0].parcel_id]).catch(() => ({ rows: [] }))
    if (rates[0] && Number(rates[0].usd_balance) > 0) {
      return fail(reply, 400, 'invalid', 'Treasurer clearance is required: this stand still has rates outstanding.')
    }
    const { rows } = await pg.query(
      `INSERT INTO housing.title_request (allocation_id, conveyancer, notes, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.allocation_id, text(b.conveyancer, 200), text(b.notes, 2000), request.user.id])
    return ok(reply, { request: rows[0] }, 201)
  })

  fastify.post('/housing/title/:id/status', write('title'), async (request, reply) => {
    const status = request.body?.status
    if (!['lodged', 'at_deeds', 'issued', 'refused'].includes(status)) {
      return fail(reply, 400, 'invalid', 'That is not a title status.')
    }
    const { rows } = await pg.query(
      `UPDATE housing.title_request SET status = $2, deed_ref = COALESCE($3, deed_ref) WHERE id = $1 RETURNING *`,
      [request.params.id, status, text(request.body?.deed_ref, 80)])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That title request is not on file.')
    return ok(reply, { request: rows[0] })
  })

  fastify.get('/housing/repossessions', canRead, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT r.*, a.allottee_name, a.parcel_id FROM housing.repossession r
         JOIN housing.allocation a ON a.id = r.allocation_id ORDER BY r.notice_on DESC LIMIT 200`)
    return ok(reply, { repossessions: rows })
  })

  fastify.post('/housing/repossessions', write('repossess'), async (request, reply) => {
    const b = request.body || {}
    if (!isUuid(b.allocation_id) || !['non_payment', 'non_development', 'fraud', 'other'].includes(b.reason)) {
      return fail(reply, 400, 'invalid', 'Name the allocation and the reason.')
    }
    const { rows } = await pg.query(
      `INSERT INTO housing.repossession (allocation_id, reason, notes, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.allocation_id, b.reason, text(b.notes, 2000), request.user.id])
    return ok(reply, { repossession: rows[0] }, 201)
  })

  fastify.post('/housing/repossessions/:id/complete', write('repossess'), async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE housing.repossession SET status = 'completed', effective_on = CURRENT_DATE WHERE id = $1 RETURNING *`,
      [request.params.id])
    if (!rows.length) return fail(reply, 404, 'not_found', 'That repossession is not on file.')
    await pg.query(
      `UPDATE housing.allocation SET status = 'repossessed', ended_at = now(), ended_reason = 'repossessed', updated_at = now()
        WHERE id = $1`, [rows[0].allocation_id])
    await pg.query(
      `UPDATE housing.waiting_list SET status = 'active', updated_at = now()
        WHERE id = (SELECT waiting_list_id FROM housing.allocation WHERE id = $1)`, [rows[0].allocation_id])
    return ok(reply, { repossession: rows[0] })
  })

  fastify.get('/housing/announcements', canRead, async (_request, reply) => {
    const { rows } = await pg.query(`SELECT * FROM housing.announcement ORDER BY published_on DESC LIMIT 100`)
    return ok(reply, { announcements: rows })
  })

  fastify.post('/housing/announcements', write('announce'), async (request, reply) => {
    const title = text(request.body?.title, 200)
    const body = text(request.body?.body, 4000)
    if (!title || !body) return fail(reply, 400, 'invalid', 'Give the announcement a title and the text that will be read.')
    const { rows } = await pg.query(
      `INSERT INTO housing.announcement (title, body, scheme_id, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [title, body, request.body?.scheme_id || null, request.user.id])
    return ok(reply, { announcement: rows[0] }, 201)
  })

  fastify.get('/housing/me', signedIn, async (request, reply) => {
    const personId = request.user.person_id
    if (!personId) return ok(reply, { waiting_list: [], allocations: [], leases: [] })
    const [w, a, l] = await Promise.all([
      pg.query(`SELECT * FROM housing.waiting_list WHERE person_id = $1 ORDER BY registered_on DESC`, [personId]),
      pg.query(`SELECT * FROM housing.allocation WHERE person_id = $1 ORDER BY allocated_on DESC`, [personId]),
      pg.query(`SELECT * FROM housing.lease WHERE person_id = $1 ORDER BY start_on DESC`, [personId]),
    ])
    return ok(reply, { waiting_list: w.rows, allocations: a.rows, leases: l.rows })
  })

  fastify.post('/housing/waiting-list/self', signedIn, async (request, reply) => {
    if (!['registered', 'viewer', 'public'].includes(request.user.role) && !request.user.person_id) {
      return fail(reply, 400, 'invalid', 'Join the waiting list from a resident account, or at the housing counter.')
    }
    const b = request.body || {}
    const name = text(b.applicant_name, 200) || request.user.name || request.user.full_name
    if (!name) return fail(reply, 400, 'invalid', 'Name the applicant.')
    try {
      const { rows } = await pg.query(
        `INSERT INTO housing.waiting_list
           (list_no, person_id, applicant_name, sought, density, preferred_ward, household_size, resident, notes, lapses_on)
         VALUES (housing.next_no('WL-', 'housing.list_no_seq'), $1, $2, $3, $4, $5, $6, true, $7, CURRENT_DATE + interval '1 year')
         RETURNING *`,
        [request.user.person_id || null, name, b.sought || 'stand', b.density || 'any',
          b.preferred_ward || null, b.household_size || null, text(b.notes, 2000)])
      await pg.query('SELECT housing.score_entry($1)', [rows[0].id])
      return ok(reply, { entry: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The waiting-list application could not be taken.')
    }
  })
}

module.exports = { housingRoutes }
