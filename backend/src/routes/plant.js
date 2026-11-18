/**
 * The Department of Roads and Works' plant register (migration 252).
 *
 *   GET   /api/units/engineering/plant              the plant, with this month's hours and fuel and the last day worked
 *   POST  /api/units/engineering/plant/:id/log      a day's work: hours, fuel, the road or job, the hour meter at the end
 *   PATCH /api/units/engineering/plant/:id          status, location, last service, the hours the next service is due, notes
 *
 * Who: the District Engineer, the Civil Engineering Technician and the Roads and Works Foreman read and write; the Chief
 * Executive reads. Anyone else is refused. Every query runs on the request-scoped connection, so row-level security keeps
 * it to the caller's council.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { canSeeUnit } = require('../config/units')
const { systemOf } = require('../lib/dbContext')

const WRITERS = ['engineer', 'civil_technician', 'roads_foreman']
const READERS = ['accounting_officer', ...WRITERS]
const STATUSES = ['working', 'under_repair', 'broken_down', 'standby', 'disposed']
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const num = (v, max) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : undefined))
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

async function plantRoutes(fastify) {
  const pg = fastify.pg
  const ownUnit = (request, reply) => {
    if (!canSeeUnit(request.user, 'engineering')) { reply.code(403).send({ success: false, error: 'forbidden', message: 'The plant register is the Department of Roads and Works\'.' }); return false }
    return true
  }

  fastify.get('/units/engineering/plant', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    if (!ownUnit(request, reply)) return
    const { rows } = await pg.query(
      `SELECT p.id, p.plant_no, p.kind, p.description, p.registration, p.serial_no, p.status, p.location,
              p.hour_meter, p.last_service_on, p.next_service_hours, p.notes,
              p.operator_post_id,
              m.hours_this_month, m.fuel_this_month, m.days_this_month, l.last_worked_on, l.last_job
         FROM council_ops.plant p
         LEFT JOIN LATERAL (
           SELECT sum(hours)::float AS hours_this_month, sum(fuel_litres)::float AS fuel_this_month, count(*)::int AS days_this_month
             FROM council_ops.plant_log WHERE plant_id = p.id AND worked_on >= date_trunc('month', current_date)) m ON true
         LEFT JOIN LATERAL (
           SELECT worked_on AS last_worked_on, COALESCE(job, r.name, r.asset_code) AS last_job
             FROM council_ops.plant_log g LEFT JOIN council_ops.road_asset r ON r.id = g.road_asset_id
            WHERE g.plant_id = p.id ORDER BY worked_on DESC, g.created_at DESC LIMIT 1) l ON true
        WHERE p.status <> 'disposed'
        ORDER BY p.kind, p.plant_no`)
    // The organisation chart is a system table: the operators' posts are named from it on the system connection.
    const postIds = [...new Set(rows.map((p) => p.operator_post_id).filter(Boolean))]
    const titles = postIds.length
      ? Object.fromEntries((await systemOf(pg).query('SELECT id, title FROM public.admin_org_position WHERE id = ANY($1)', [postIds])).rows.map((r) => [r.id, r.title]))
      : {}
    for (const p of rows) { p.operator_post = titles[p.operator_post_id] ?? null; delete p.operator_post_id }
    const due = (p) => p.next_service_hours !== null && p.hour_meter !== null && Number(p.hour_meter) >= Number(p.next_service_hours)
    return reply.send({
      success: true,
      data: {
        plant: rows.map((p) => ({ ...p, service_due: due(p) })),
        totals: {
          items: rows.length,
          working: rows.filter((p) => p.status === 'working').length,
          out_of_action: rows.filter((p) => p.status === 'under_repair' || p.status === 'broken_down').length,
          service_due: rows.filter(due).length,
        },
        can_write: WRITERS.includes(request.user.role),
      },
    })
  })

  fastify.post('/units/engineering/plant/:id/log', { preHandler: requireRole(fastify, WRITERS) }, async (request, reply) => {
    if (!ownUnit(request, reply)) return
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const b = request.body || {}
    const hours = num(b.hours, 24)
    const fuel = num(b.fuel_litres, 10000)
    const meter = num(b.hour_meter_end, 1000000)
    if ([hours, fuel, meter].includes(undefined)) {
      return reply.code(400).send({ success: false, error: 'bad_figures', message: 'Hours are 0 to 24 a day; fuel and the hour meter are numbers of 0 or more.' })
    }
    if (hours === null && fuel === null && meter === null) {
      return reply.code(400).send({ success: false, error: 'empty', message: 'Record the hours, the fuel or the hour meter.' })
    }
    const worked = isDate(b.worked_on) ? b.worked_on : null
    const road = isUuid(b.road_asset_id) ? b.road_asset_id : null
    const { rows } = await pg.query(
      `WITH p AS (SELECT id FROM council_ops.plant WHERE id = $1 AND status <> 'disposed'),
            ins AS (
              INSERT INTO council_ops.plant_log (plant_id, worked_on, hours, hour_meter_end, fuel_litres, road_asset_id, job, operator_name, recorded_by)
              SELECT p.id, COALESCE($2::date, current_date), $3, $4, $5, $6, $7, $8, $9 FROM p RETURNING *)
       SELECT * FROM ins`,
      [request.params.id, worked, hours, meter, fuel, road, text(b.job, 500), text(b.operator_name, 120), request.user.id])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    // the hour meter only goes forward
    if (meter !== null) await pg.query(`UPDATE council_ops.plant SET hour_meter = $2, updated_at = now() WHERE id = $1 AND (hour_meter IS NULL OR hour_meter < $2)`, [request.params.id, meter])
    return reply.code(201).send({ success: true, data: rows[0] })
  })

  fastify.patch('/units/engineering/plant/:id', { preHandler: requireRole(fastify, WRITERS) }, async (request, reply) => {
    if (!ownUnit(request, reply)) return
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const b = request.body || {}
    if (b.status !== undefined && !STATUSES.includes(b.status)) return reply.code(400).send({ success: false, error: 'bad_status' })
    if (b.last_service_on !== undefined && b.last_service_on !== null && !isDate(b.last_service_on)) return reply.code(400).send({ success: false, error: 'bad_date' })
    const nextHours = b.next_service_hours === undefined ? undefined : num(b.next_service_hours, 1000000)
    if (nextHours === undefined && b.next_service_hours !== undefined) return reply.code(400).send({ success: false, error: 'bad_figures' })
    const { rows } = await pg.query(
      `UPDATE council_ops.plant SET
          status             = COALESCE($2, status),
          location           = CASE WHEN $3::boolean THEN $4 ELSE location END,
          last_service_on    = CASE WHEN $5::boolean THEN $6::date ELSE last_service_on END,
          next_service_hours = CASE WHEN $7::boolean THEN $8::numeric ELSE next_service_hours END,
          notes              = CASE WHEN $9::boolean THEN $10 ELSE notes END,
          updated_at         = now()
        WHERE id = $1 RETURNING id, status, location, last_service_on, next_service_hours, notes`,
      [request.params.id, b.status ?? null,
        Object.hasOwn(b, 'location'), text(b.location, 200),
        Object.hasOwn(b, 'last_service_on'), b.last_service_on ?? null,
        Object.hasOwn(b, 'next_service_hours'), nextHours ?? null,
        Object.hasOwn(b, 'notes'), text(b.notes, 2000)])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    return reply.send({ success: true, data: rows[0] })
  })
}

module.exports = { plantRoutes, PLANT_WRITERS: WRITERS }
