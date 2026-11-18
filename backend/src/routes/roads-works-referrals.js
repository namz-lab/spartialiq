/**
 * The Department of Roads and Works in the planning workflow (migration 253).
 *
 *   GET  /api/roads-works/referrals?state=open|answered|all   the cases circulated to Engineering
 *   POST /api/roads-works/referrals/:cid/reply                the department's reply, with its assessment
 *   GET  /api/roads-works/council-roads?q=                   council roads, to name the road an access is onto
 *   GET  /api/permit-applications/:id/engineering-assessment the assessment, for the planner and the EO
 *
 * The reply answers the circulation (application_consultation, body_name 'engineering') the planner sent, and records:
 *   1. the infrastructure-cost test, Regional, Town and Country Planning Act s.26(5): additional or premature council
 *      spending on roads, parking, drainage, sewerage or water, its estimate, and the condition that recovers it;
 *   2. for a subdivision, its roads, s.41: reserves adequate, the widest reserve (over 24 m, s.41(3) applies), new road length;
 *   3. an access onto a council road, which the council allows as road authority under the Roads Act.
 *
 * Who replies: the District Engineer and the Civil Engineering Technician. The Foreman reads. The reply and the assessment
 * are written in one transaction and logged on the case. Every query runs on the request's council (row-level security).
 */
const { requireRole } = require('../middleware/jwtAuth')

const REPLIERS = ['engineer', 'civil_technician']
const READERS = [...REPLIERS, 'roads_foreman']
const CASE_READERS = ['eo', 'planner', 'planning_clerk', 'admin', 'accounting_officer', ...READERS]
const RESPONSES = ['no_objection', 'conditional_approval', 'objection']
const FINAL = ['approved', 'approved_with_conditions', 'refused', 'withdrawn']
const SUBDIVISION = ['subdivision', 'consolidation']
// The referrals Roads and Works answers. In a rural district council roads, traffic, stormwater, and water and sewer are
// all the department's, so a referral to any of them comes to this desk (older cases may carry those names, or
// "Engineering: …").
const ENGINEERING_BODIES = ['engineering', 'roads and works', 'roads_and_works', 'traffic', 'water_sewer']
const ENGINEERING = `(lower(c.body_name) IN (${ENGINEERING_BODIES.map((b) => `'${b}'`).join(', ')}) OR lower(c.body_name) LIKE 'engineering%')`
/** Is this referral one for Roads and Works to answer? */
const isEngineeringBody = (name) => typeof name === 'string' && (ENGINEERING_BODIES.includes(name.trim().toLowerCase()) || name.trim().toLowerCase().startsWith('engineering'))

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const bool = (v) => (v === true || v === false ? v : null)
const amount = (v, max) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : undefined))

/** Check a reply against the law and the case; returns the problems found, in words for the officer. */
function problems(b, permit) {
  const out = []
  if (!RESPONSES.includes(b.response_status)) out.push('Say whether Roads and Works has no objection, has conditions, or objects.')
  const cost = b.cost || {}
  const heads = ['roads', 'parking', 'drainage', 'sewerage', 'water']
  const answered = heads.filter((h) => typeof cost[h] === 'boolean')
  if (answered.length !== heads.length) out.push("Answer each head of the infrastructure-cost test (s.26(5)): roads, parking, drainage, sewerage and water.")
  const anyCost = heads.some((h) => cost[h] === true)
  if (anyCost && !(text(cost.condition, 4000) && text(cost.condition, 4000).length >= 10)) {
    out.push('A cost to the council needs the condition that recovers it (s.26(5)): write the condition.')
  }
  if (amount(cost.estimated_cost, 1e12) === undefined) out.push('The estimated cost is an amount of 0 or more.')
  if (b.response_status === 'conditional_approval' && !anyCost && !text(b.notes, 8000) && !(b.access && text(b.access.conditions, 4000))) {
    out.push('A reply with conditions says what the conditions are.')
  }
  if (b.response_status === 'objection' && !text(b.notes, 8000)) out.push('An objection gives its reasons.')
  const sub = b.subdivision || {}
  if (SUBDIVISION.includes(permit.development_type)) {
    if (typeof sub.road_reserves_adequate !== 'boolean') out.push("For a subdivision, say whether the layout's road reserves are adequate (s.41).")
    if (amount(sub.widest_road_reserve_m, 200) === undefined || amount(sub.new_road_length_m, 1e6) === undefined) out.push('Road widths and lengths are numbers of metres.')
  }
  const access = b.access || {}
  if (typeof access.approved === 'boolean' && !isUuid(access.road_asset_id)) out.push('Name the council road the access is onto.')
  return out
}

async function roadsWorksReferralRoutes(fastify) {
  const pg = fastify.pg

  async function logEvent(client, permitId, type, request, detail) {
    await client.query(
      `INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [permitId, type, request.user.id, request.user.role, JSON.stringify(detail)])
  }

  fastify.get('/roads-works/referrals', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    const state = ['open', 'answered', 'all'].includes(request.query?.state) ? request.query.state : 'open'
    const { rows } = await pg.query(
      `SELECT c.id, c.permit_app_id, c.body_name, c.circulated_at, c.response_due_at, c.response_status, c.response_received_at,
              c.response_notes, c.blocking, c.priority, c.task_status, c.assigned_to,
              (c.response_due_at IS NOT NULL AND c.response_due_at < current_date AND c.response_received_at IS NULL) AS overdue,
              p.tpd_reference, p.dev_register_no, p.applicant_name, p.stand_number, p.suburb_ward, p.development_type,
              p.description, p.status AS case_status, p.statutory_due_date,
              -- the Act's question "within 200 m of the centre line of a State road" (saved as road_within_200m)
              COALESCE((p.statutory_checks ->> 'road_within_200m')::boolean, (p.statutory_checks ->> 'state_road')::boolean) AS near_state_road,
              (a.id IS NOT NULL) AS assessed
         FROM spatial_planning.application_consultation c
         JOIN spatial_planning.permit_application p ON p.id = c.permit_app_id
         LEFT JOIN spatial_planning.engineering_assessment a ON a.consultation_id = c.id
        WHERE ${ENGINEERING}
          AND ($1 = 'all'
               OR ($1 = 'open' AND c.response_received_at IS NULL AND COALESCE(c.task_status, 'open') <> 'cancelled' AND p.status <> ALL($2))
               OR ($1 = 'answered' AND c.response_received_at IS NOT NULL))
        ORDER BY c.blocking DESC NULLS LAST, c.response_due_at ASC NULLS LAST, c.circulated_at ASC`, [state, FINAL])
    return reply.send({ success: true, data: { referrals: rows, can_reply: REPLIERS.includes(request.user.role) } })
  })

  fastify.get('/roads-works/council-roads', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    const q = text(request.query?.q, 80)
    const { rows } = await pg.query(
      `SELECT id, asset_code, name, council_class, ward, round(length_m)::int AS length_m
         FROM council_ops.road_asset
        WHERE status = 'active' AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR asset_code ILIKE '%' || $1 || '%' OR ward ILIKE '%' || $1 || '%')
        ORDER BY (name IS NULL), name, asset_code LIMIT 25`, [q])
    return reply.send({ success: true, data: rows })
  })

  fastify.post('/roads-works/referrals/:cid/reply', { preHandler: requireRole(fastify, REPLIERS) }, async (request, reply) => {
    if (!isUuid(request.params.cid)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const b = request.body || {}
    const found = (await pg.query(
      `SELECT c.id, c.permit_app_id, c.response_received_at, p.development_type, p.status
         FROM spatial_planning.application_consultation c JOIN spatial_planning.permit_application p ON p.id = c.permit_app_id
        WHERE c.id = $1 AND ${ENGINEERING}`, [request.params.cid])).rows[0]
    if (!found) return reply.code(404).send({ success: false, error: 'not_found', message: 'No engineering referral with that reference.' })
    if (FINAL.includes(found.status)) return reply.code(409).send({ success: false, error: 'case_closed', message: 'The case has been decided or withdrawn; its referrals are closed.' })
    const issues = problems(b, found)
    if (issues.length) return reply.code(400).send({ success: false, error: 'incomplete_reply', message: issues.join(' '), problems: issues })

    const cost = b.cost || {}
    const sub = SUBDIVISION.includes(found.development_type) ? (b.subdivision || {}) : {}
    const access = b.access || {}
    const result = await pg.transact(async (client) => {
      const assessment = (await client.query(
        `INSERT INTO spatial_planning.engineering_assessment
           (consultation_id, permit_app_id, cost_roads, cost_parking, cost_drainage, cost_sewerage, cost_water, estimated_cost, cost_currency,
            cost_condition, road_reserves_adequate, widest_road_reserve_m, new_road_length_m, access_road_asset_id, access_approved,
            access_conditions, assessed_by, assessed_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (consultation_id) DO UPDATE SET
           cost_roads = EXCLUDED.cost_roads, cost_parking = EXCLUDED.cost_parking, cost_drainage = EXCLUDED.cost_drainage,
           cost_sewerage = EXCLUDED.cost_sewerage, cost_water = EXCLUDED.cost_water, estimated_cost = EXCLUDED.estimated_cost,
           cost_currency = EXCLUDED.cost_currency, cost_condition = EXCLUDED.cost_condition,
           road_reserves_adequate = EXCLUDED.road_reserves_adequate, widest_road_reserve_m = EXCLUDED.widest_road_reserve_m,
           new_road_length_m = EXCLUDED.new_road_length_m, access_road_asset_id = EXCLUDED.access_road_asset_id,
           access_approved = EXCLUDED.access_approved, access_conditions = EXCLUDED.access_conditions,
           assessed_by = EXCLUDED.assessed_by, assessed_role = EXCLUDED.assessed_role, updated_at = now()
         RETURNING *`,
        [found.id, found.permit_app_id, cost.roads, cost.parking, cost.drainage, cost.sewerage, cost.water,
          amount(cost.estimated_cost, 1e12), ['USD', 'ZWG'].includes(cost.currency) ? cost.currency : (amount(cost.estimated_cost, 1e12) ? 'USD' : null),
          text(cost.condition, 4000), bool(sub.road_reserves_adequate), amount(sub.widest_road_reserve_m, 200) || null,
          amount(sub.new_road_length_m, 1e6), isUuid(access.road_asset_id) ? access.road_asset_id : null, bool(access.approved),
          text(access.conditions, 4000), request.user.id, request.user.role])).rows[0]

      const consultation = (await client.query(
        `UPDATE spatial_planning.application_consultation
            SET response_status = $2, response_received_at = COALESCE(response_received_at, current_date),
                response_notes = $3, task_status = 'responded', updated_at = now()
          WHERE id = $1 RETURNING *`, [found.id, b.response_status, text(b.notes, 8000)])).rows[0]

      // A subdivision's new road length goes on its layout too, where the planner drew one.
      if (assessment.new_road_length_m !== null) {
        await client.query(`UPDATE spatial_planning.planning_project SET road_length_m = $2, updated_at = now() WHERE permit_app_id = $1 AND deleted_at IS NULL`,
          [found.permit_app_id, assessment.new_road_length_m])
      }
      await logEvent(client, found.permit_app_id, 'referral_response', request, {
        consultation_id: found.id, body_name: 'engineering', response_status: b.response_status,
        cost_found: [assessment.cost_roads && 'roads', assessment.cost_parking && 'parking', assessment.cost_drainage && 'drainage',
          assessment.cost_sewerage && 'sewerage', assessment.cost_water && 'water'].filter(Boolean),
        access_approved: assessment.access_approved,
      })
      return { consultation, assessment }
    })
    const flags = []
    if (result.assessment.widest_road_reserve_m && Number(result.assessment.widest_road_reserve_m) > 24) {
      flags.push('A road reserve wider than 24 m: only 24 m of it passes to the council free of cost; the excess is land for public purposes or acquired under s.45 (s.41(3)).')
    }
    return reply.send({ success: true, data: { ...result, flags } })
  })

  fastify.get('/permit-applications/:id/engineering-assessment', { preHandler: requireRole(fastify, CASE_READERS) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const { rows } = await pg.query(
      `SELECT a.*, c.response_status, c.response_notes, c.response_received_at, c.blocking,
              r.asset_code AS access_road_code, r.name AS access_road_name, r.council_class AS access_road_class
         FROM spatial_planning.engineering_assessment a
         JOIN spatial_planning.application_consultation c ON c.id = a.consultation_id
         LEFT JOIN council_ops.road_asset r ON r.id = a.access_road_asset_id
        WHERE a.permit_app_id = $1 ORDER BY a.updated_at DESC LIMIT 1`, [request.params.id])
    return reply.send({ success: true, data: rows[0] ?? null })
  })
}

module.exports = { roadsWorksReferralRoutes, problems, REPLIERS, ENGINEERING_BODIES, isEngineeringBody }
