/**
 * The Department of Roads and Works records its field survey in its registers (migration 254, the sheets in
 * docs/manuals/roads-works-field-survey.md).
 *
 *   GET   /api/roads-works/registers                 how much of each register has been surveyed
 *   GET   /api/roads-works/roads?q=&ward=&state=     council roads (state: unsurveyed | surveyed | all), 50 a page
 *   PATCH /api/roads-works/roads/:id                 a road's survey: surface, condition, class, width, drainage, name
 *   GET   /api/roads-works/structures                bridges, culverts and drifts
 *   POST  /api/roads-works/structures                a structure found on the survey, with its GPS point
 *   PATCH /api/roads-works/structures/:id            its condition, span, name
 *   GET   /api/roads-works/water-points?q=&ward=&state=
 *   PATCH /api/roads-works/water-points/:id          working or not, pump, yield, last repaired, caretaker
 *   GET   /api/roads-works/council-assets
 *   PATCH /api/roads-works/council-assets/:id        condition, the department using it, its GPS point
 *   GET   /api/roads-works/survey-log?register=&record_id=   what was recorded, by whom, and what it was before
 *
 * Who writes: roads and structures, the District Engineer, the Civil Engineering Technician and the Foreman; water points,
 * the District Engineer, the Civil Engineering Technician and the Water and Sanitation Technician; council buildings, the
 * District Engineer and the Civil Engineering Technician. The whole department and the Chief Executive read.
 *
 * Every entry names the day it was surveyed, and is written with its log line (the fields before and after) in one
 * transaction. A road with both surface and condition surveyed stops being "unverified". Every query runs on the
 * request's council (row-level security).
 */
const { requireRole } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')

const DEPT = ['engineer', 'civil_technician', 'roads_foreman', 'water_technician']
const READERS = ['accounting_officer', ...DEPT]
const ROAD_WRITERS = ['engineer', 'civil_technician', 'roads_foreman']
const WATER_WRITERS = ['engineer', 'civil_technician', 'water_technician']
const ASSET_WRITERS = ['engineer', 'civil_technician']

const WORDS = {
  surface: ['earth', 'gravel', 'bitumen', 'concrete', 'paving'],
  condition: ['good', 'fair', 'poor', 'very_poor', 'impassable'],
  building_condition: ['good', 'fair', 'poor', 'very_poor'],
  drainage: ['none', 'side_drains', 'lined_drains', 'blocked'],
  council_class: ['feeder', 'access', 'service', 'track', 'path', 'unclassified'],
  structure_type: ['bridge', 'culvert', 'causeway', 'footbridge', 'other'],
  operational: ['working', 'broken', 'seasonal', 'unknown', 'decommissioned'],
  pump_type: ['hand_pump', 'motorised', 'solar', 'none'],
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const today = () => new Date().toISOString().slice(0, 10)
const has = (b, k) => Object.prototype.hasOwnProperty.call(b, k)

/**
 * Read the fields a survey entry may set, from the body. Returns { set, problems }: `set` holds only the fields the body
 * names (a field left out is left alone; null or '' clears it).
 */
function readFields(b, spec) {
  const set = {}
  const problems = []
  for (const [key, rule] of Object.entries(spec)) {
    if (!has(b, key)) continue
    const v = b[key]
    if (v === null || v === '') { set[key] = null; continue }
    if (rule.words) {
      if (!rule.words.includes(v)) problems.push(`${rule.label} is one of: ${rule.words.join(', ').replace(/_/g, ' ')}.`)
      else set[key] = v
    } else if (rule.number) {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0 || n > rule.number) problems.push(`${rule.label} is a number of metres, more than 0 and at most ${rule.number}.`)
      else set[key] = n
    } else if (rule.date) {
      if (!isDate(v) || v > today()) problems.push(`${rule.label} is a date, not in the future.`)
      else set[key] = v
    } else if (typeof v !== 'string' || v.trim().length > rule.text) problems.push(`${rule.label} is text of at most ${rule.text} characters.`)
    else set[key] = v.trim() || null
  }
  return { set, problems }
}

/** The common part of every entry: the day surveyed (required), and a photo number and notes for the log. */
function readEntry(b) {
  const problems = []
  if (!isDate(b.surveyed_on) || b.surveyed_on > today()) problems.push('Give the day the survey was done (not in the future).')
  const photo = typeof b.photo_ref === 'string' && b.photo_ref.trim() ? b.photo_ref.trim().slice(0, 60) : null
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 4000) : null
  return { surveyed_on: b.surveyed_on, photo, notes, problems }
}

function readPoint(b) {
  const hasLng = has(b, 'lng') && b.lng !== null && b.lng !== ''
  const hasLat = has(b, 'lat') && b.lat !== null && b.lat !== ''
  if (!hasLng && !hasLat) return { point: null, problems: [] }
  const lng = Number(b.lng)
  const lat = Number(b.lat)
  // Vungu lies near 29.5 E, 19.4 S; a point anywhere in Zimbabwe is accepted, a swapped or mistyped one is not.
  if (!(Number.isFinite(lng) && Number.isFinite(lat) && lng >= 25 && lng <= 34 && lat >= -23 && lat <= -15)) {
    return { point: null, problems: ['The GPS point is a longitude (25 to 34) and a latitude (-23 to -15), in decimal degrees.'] }
  }
  return { point: { lng, lat }, problems: [] }
}

const ROAD_FIELDS = {
  name: { label: 'The road name', text: 200 },
  surface: { label: 'Surface', words: WORDS.surface },
  condition: { label: 'Condition', words: WORDS.condition },
  council_class: { label: 'The council class', words: WORDS.council_class },
  width_m: { label: 'Width', number: 100 },
  drainage: { label: 'Drainage', words: WORDS.drainage },
}
const STRUCTURE_FIELDS = {
  name: { label: 'The name or location', text: 200 },
  structure_type: { label: 'The kind of structure', words: WORDS.structure_type },
  condition: { label: 'Condition', words: WORDS.condition },
  span_m: { label: 'Span or diameter', number: 1000 },
}
const WATER_FIELDS = {
  name: { label: 'The name', text: 200 },
  operational: { label: 'Working', words: WORDS.operational },
  pump_type: { label: 'The pump', words: WORDS.pump_type },
  yield_note: { label: 'The yield', text: 200 },
  last_repaired_on: { label: 'Last repaired', date: true },
  caretaker: { label: 'The caretaker', text: 200 },
}
const ASSET_FIELDS = {
  name: { label: 'The name', text: 200 },
  condition: { label: 'Condition', words: WORDS.building_condition },
  department: { label: 'The department using it', text: 100 },
}

const REGISTERS = {
  road: { table: 'council_ops.road_asset', fields: ROAD_FIELDS, writers: ROAD_WRITERS },
  structure: { table: 'council_ops.road_structure', fields: STRUCTURE_FIELDS, writers: ROAD_WRITERS },
  water_point: { table: 'council_ops.wash_asset', fields: WATER_FIELDS, writers: WATER_WRITERS },
  council_asset: { table: 'council_ops.council_asset', fields: ASSET_FIELDS, writers: ASSET_WRITERS },
}

const bad = (reply, problems) => reply.code(400).send({ success: false, error: 'invalid', message: problems.join(' '), problems })

/**
 * Write one survey entry: lock the record, set the fields, log before and after, in one transaction.
 * `extra(row, set)` may return further SQL assignments (as { sql, value } pairs) that follow from the entry.
 */
async function writeEntry(pg, request, register, id, set, entry, point, extra) {
  const { table } = REGISTERS[register]
  return pg.transact(async (client) => {
    const cols = Object.keys(set)
    const { rows: [row] } = await client.query(`SELECT *, ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat FROM ${table} WHERE id = $1 FOR UPDATE`, [id])
    if (!row) return null
    const values = [id]
    const assigns = cols.map((c) => { values.push(set[c]); return `${c} = $${values.length}` })
    for (const e of (extra ? extra(row, set) : [])) { values.push(e.value); assigns.push(`${e.sql} = $${values.length}`) }
    if (point) {
      values.push(point.lng); const x = values.length
      values.push(point.lat); const y = values.length
      assigns.push(`geom = ST_SetSRID(ST_MakePoint($${x}, $${y}), 4326)`)
    }
    values.push(entry.surveyed_on)
    assigns.push(`surveyed_on = $${values.length}`, 'updated_at = now()')
    const { rows: [after] } = await client.query(`UPDATE ${table} SET ${assigns.join(', ')} WHERE id = $1 RETURNING *`, values)
    const changed = [...cols, ...(point ? ['lng', 'lat'] : []), ...(extra ? extra(row, set).map((e) => e.sql) : [])]
    const before = Object.fromEntries(changed.map((c) => [c, row[c] ?? null]))
    const now = Object.fromEntries(changed.map((c) => [c, c === 'lng' ? point.lng : c === 'lat' ? point.lat : (after[c] ?? null)]))
    await client.query(
      `INSERT INTO council_ops.survey_record (register, record_id, surveyed_on, before, after, photo_ref, notes, recorded_by, recorded_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [register, id, entry.surveyed_on, before, now, entry.photo, entry.notes, request.user.id, request.user.role])
    delete after.geom
    return after
  })
}

const page = (q) => ({
  limit: Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200),
  offset: Math.max(parseInt(q.offset, 10) || 0, 0),
})

async function roadsWorksRegisterRoutes(fastify) {
  const pg = fastify.pg
  const read = { preHandler: requireRole(fastify, READERS) }
  const can = (role, register) => REGISTERS[register].writers.includes(role)

  fastify.get('/roads-works/registers', read, async (request, reply) => {
    const { rows: [r] } = await pg.query(`SELECT
        (SELECT count(*)::int FROM council_ops.road_asset WHERE status = 'active') AS roads,
        (SELECT count(*)::int FROM council_ops.road_asset WHERE status = 'active' AND surveyed_on IS NOT NULL) AS roads_surveyed,
        (SELECT count(*)::int FROM council_ops.road_structure) AS structures,
        (SELECT count(*)::int FROM council_ops.wash_asset WHERE operational IS DISTINCT FROM 'decommissioned') AS water_points,
        (SELECT count(*)::int FROM council_ops.wash_asset WHERE operational IN ('working', 'broken', 'seasonal')) AS water_points_known,
        (SELECT count(*)::int FROM council_ops.council_asset) AS council_assets,
        (SELECT count(*)::int FROM council_ops.council_asset WHERE geom IS NOT NULL) AS council_assets_located`)
    const { rows: wards } = await pg.query(
      `SELECT ward FROM council_ops.road_asset WHERE ward IS NOT NULL UNION SELECT ward FROM council_ops.wash_asset WHERE ward IS NOT NULL ORDER BY 1`)
    const role = request.user.role
    return reply.send({
      success: true,
      data: { ...r, wards: wards.map((w) => w.ward), can_write: Object.fromEntries(Object.keys(REGISTERS).map((k) => [k, can(role, k)])), words: WORDS },
    })
  })

  // ── Roads ──────────────────────────────────────────────────────────────────────────────
  fastify.get('/roads-works/roads', read, async (request, reply) => {
    const q = request.query || {}
    const { limit, offset } = page(q)
    const where = [`r.status = 'active'`]
    const v = []
    if (typeof q.q === 'string' && q.q.trim()) { v.push(`%${q.q.trim()}%`); where.push(`(r.name ILIKE $${v.length} OR r.asset_code ILIKE $${v.length})`) }
    if (typeof q.ward === 'string' && q.ward.trim()) { v.push(q.ward.trim()); where.push(`r.ward = $${v.length}`) }
    if (q.state === 'unsurveyed') where.push('r.surveyed_on IS NULL')
    if (q.state === 'surveyed') where.push('r.surveyed_on IS NOT NULL')
    v.push(limit, offset)
    const { rows } = await pg.query(
      `SELECT r.id, r.asset_code, r.name, r.hierarchy, r.council_class, r.ward, round(r.length_m)::int AS length_m,
              r.surface, r.condition, r.width_m::float, r.drainage, r.data_quality, r.surveyed_on, count(*) OVER ()::int AS total
         FROM council_ops.road_asset r
        WHERE ${where.join(' AND ')}
        ORDER BY r.ward NULLS LAST, r.council_class = 'feeder' DESC, r.length_m DESC NULLS LAST, r.asset_code
        LIMIT $${v.length - 1} OFFSET $${v.length}`, v)
    return reply.send({ success: true, data: { items: rows.map(({ total, ...x }) => x), total: rows[0]?.total ?? 0, limit, offset } })
  })

  fastify.patch('/roads-works/roads/:id', { preHandler: requireRole(fastify, ROAD_WRITERS) }, async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return bad(reply, ['That is not a road in the register.'])
    const b = request.body || {}
    const entry = readEntry(b)
    const { set, problems } = readFields(b, ROAD_FIELDS)
    if (entry.problems.length || problems.length) return bad(reply, [...entry.problems, ...problems])
    // A road surveyed for both surface and condition is field-verified; an authoritative record stays so.
    const verify = (row, s) => {
      const surface = has(s, 'surface') ? s.surface : row.surface
      const condition = has(s, 'condition') ? s.condition : row.condition
      return row.data_quality === 'unverified' && surface && condition ? [{ sql: 'data_quality', value: 'verified' }] : []
    }
    const after = await writeEntry(pg, request, 'road', id, set, entry, null, verify)
    if (!after) return reply.code(404).send({ success: false, error: 'not_found', message: 'That road is not in the register.' })
    return reply.send({ success: true, data: after })
  })

  // ── Bridges, culverts and drifts ───────────────────────────────────────────────────────
  fastify.get('/roads-works/structures', read, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT s.id, s.structure_type, s.name, s.condition, s.span_m::float, s.ward, s.surveyed_on, s.data_quality,
              s.road_asset_id, r.asset_code AS road_code, r.name AS road_name,
              round(ST_X(s.geom)::numeric, 6)::float AS lng, round(ST_Y(s.geom)::numeric, 6)::float AS lat
         FROM council_ops.road_structure s LEFT JOIN council_ops.road_asset r ON r.id = s.road_asset_id
        ORDER BY s.ward NULLS LAST, s.structure_type, s.name`)
    return reply.send({ success: true, data: { items: rows } })
  })

  fastify.post('/roads-works/structures', { preHandler: requireRole(fastify, ROAD_WRITERS) }, async (request, reply) => {
    const b = request.body || {}
    const entry = readEntry(b)
    const { set, problems } = readFields(b, STRUCTURE_FIELDS)
    const { point, problems: where } = readPoint(b)
    const all = [...entry.problems, ...problems, ...where]
    if (!set.structure_type) all.push('Say what kind of structure it is: bridge, culvert, causeway, footbridge or other.')
    if (!point) all.push('Give the GPS point where it stands.')
    if (b.road_asset_id && !isUuid(b.road_asset_id)) all.push('Name the road from the register.')
    if (all.length) return bad(reply, [...new Set(all)])
    const row = await pg.transact(async (client) => {
      const { rows: [s] } = await client.query(
        `INSERT INTO council_ops.road_structure (structure_type, name, road_asset_id, condition, span_m, data_quality, source, surveyed_on, geom)
         VALUES ($1, $2, $3, $4, $5, 'verified', 'Roads and Works field survey', $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
         RETURNING id, structure_type, name, road_asset_id, condition, span_m::float, ward, surveyed_on`,
        [set.structure_type, set.name ?? null, b.road_asset_id || null, set.condition ?? null, set.span_m ?? null, entry.surveyed_on, point.lng, point.lat])
      await client.query(
        `INSERT INTO council_ops.survey_record (register, record_id, surveyed_on, before, after, photo_ref, notes, recorded_by, recorded_role)
         VALUES ('structure', $1, $2, '{}'::jsonb, $3, $4, $5, $6, $7)`,
        [s.id, entry.surveyed_on, { ...set, lng: point.lng, lat: point.lat, road_asset_id: b.road_asset_id || null }, entry.photo, entry.notes, request.user.id, request.user.role])
      return s
    })
    return reply.code(201).send({ success: true, data: row })
  })

  fastify.patch('/roads-works/structures/:id', { preHandler: requireRole(fastify, ROAD_WRITERS) }, async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return bad(reply, ['That is not a structure in the register.'])
    const b = request.body || {}
    const entry = readEntry(b)
    const { set, problems } = readFields(b, STRUCTURE_FIELDS)
    const { point, problems: where } = readPoint(b)
    if (entry.problems.length || problems.length || where.length) return bad(reply, [...entry.problems, ...problems, ...where])
    const after = await writeEntry(pg, request, 'structure', id, set, entry, point)
    if (!after) return reply.code(404).send({ success: false, error: 'not_found', message: 'That structure is not in the register.' })
    return reply.send({ success: true, data: after })
  })

  // ── Water points ───────────────────────────────────────────────────────────────────────
  fastify.get('/roads-works/water-points', read, async (request, reply) => {
    const q = request.query || {}
    const { limit, offset } = page(q)
    const where = [`w.operational IS DISTINCT FROM 'decommissioned'`]
    const v = []
    if (typeof q.q === 'string' && q.q.trim()) { v.push(`%${q.q.trim()}%`); where.push(`(w.name ILIKE $${v.length} OR w.asset_code ILIKE $${v.length})`) }
    if (typeof q.ward === 'string' && q.ward.trim()) { v.push(q.ward.trim()); where.push(`w.ward = $${v.length}`) }
    if (q.state === 'unsurveyed') where.push(`w.operational IS DISTINCT FROM 'working' AND w.operational IS DISTINCT FROM 'broken' AND w.operational IS DISTINCT FROM 'seasonal'`)
    if (q.state === 'broken') where.push(`w.operational = 'broken'`)
    v.push(limit, offset)
    const { rows } = await pg.query(
      `SELECT w.id, w.asset_code, w.asset_type, w.name, w.ward, w.operational, w.pump_type, w.yield_note, w.last_repaired_on,
              w.caretaker, w.surveyed_on, round(ST_X(w.geom)::numeric, 6)::float AS lng, round(ST_Y(w.geom)::numeric, 6)::float AS lat,
              count(*) OVER ()::int AS total
         FROM council_ops.wash_asset w
        WHERE ${where.join(' AND ')}
        ORDER BY w.ward NULLS LAST, w.asset_code
        LIMIT $${v.length - 1} OFFSET $${v.length}`, v)
    return reply.send({ success: true, data: { items: rows.map(({ total, ...x }) => x), total: rows[0]?.total ?? 0, limit, offset } })
  })

  fastify.patch('/roads-works/water-points/:id', { preHandler: requireRole(fastify, WATER_WRITERS) }, async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return bad(reply, ['That is not a water point in the register.'])
    const b = request.body || {}
    const entry = readEntry(b)
    const { set, problems } = readFields(b, WATER_FIELDS)
    if (set.last_repaired_on && entry.surveyed_on && set.last_repaired_on > entry.surveyed_on) problems.push('The last repair cannot be after the day of the survey.')
    if (entry.problems.length || problems.length) return bad(reply, [...entry.problems, ...problems])
    const after = await writeEntry(pg, request, 'water_point', id, set, entry, null)
    if (!after) return reply.code(404).send({ success: false, error: 'not_found', message: 'That water point is not in the register.' })
    return reply.send({ success: true, data: after })
  })

  // ── Council buildings and assets ───────────────────────────────────────────────────────
  fastify.get('/roads-works/council-assets', read, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT a.id, a.asset_code, a.name, a.asset_class, a.department, a.condition, a.ward, a.surveyed_on,
              round(ST_X(ST_PointOnSurface(a.geom))::numeric, 6)::float AS lng, round(ST_Y(ST_PointOnSurface(a.geom))::numeric, 6)::float AS lat
         FROM council_ops.council_asset a ORDER BY a.name`)
    return reply.send({ success: true, data: { items: rows } })
  })

  fastify.patch('/roads-works/council-assets/:id', { preHandler: requireRole(fastify, ASSET_WRITERS) }, async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return bad(reply, ['That is not a council asset in the register.'])
    const b = request.body || {}
    const entry = readEntry(b)
    const { set, problems } = readFields(b, ASSET_FIELDS)
    const { point, problems: where } = readPoint(b)
    if (entry.problems.length || problems.length || where.length) return bad(reply, [...entry.problems, ...problems, ...where])
    const after = await writeEntry(pg, request, 'council_asset', id, set, entry, point)
    if (!after) return reply.code(404).send({ success: false, error: 'not_found', message: 'That asset is not in the register.' })
    return reply.send({ success: true, data: after })
  })

  // ── The survey log ─────────────────────────────────────────────────────────────────────
  fastify.get('/roads-works/survey-log', read, async (request, reply) => {
    const q = request.query || {}
    const where = []
    const v = []
    if (q.register && REGISTERS[q.register]) { v.push(q.register); where.push(`register = $${v.length}`) }
    if (q.record_id) {
      if (!isUuid(q.record_id)) return bad(reply, ['That is not a record in the register.'])
      v.push(q.record_id); where.push(`record_id = $${v.length}`)
    }
    const { rows } = await pg.query(
      `SELECT id, register, record_id, surveyed_on, before, after, photo_ref, notes, recorded_by, recorded_role, created_at
         FROM council_ops.survey_record ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT 100`, v)
    // Users are a system table: the names are read on the system connection.
    const ids = [...new Set(rows.map((r) => r.recorded_by).filter(Boolean))]
    const names = ids.length
      ? Object.fromEntries((await systemOf(pg).query('SELECT id, COALESCE(full_name, name, email) AS n FROM public.users WHERE id = ANY($1)', [ids])).rows.map((r) => [r.id, r.n]))
      : {}
    return reply.send({ success: true, data: { items: rows.map(({ recorded_by, ...r }) => ({ ...r, recorded_by_name: names[recorded_by] ?? null })) } })
  })
}

module.exports = { roadsWorksRegisterRoutes, readFields, readEntry, readPoint, WORDS, ROAD_FIELDS, WATER_FIELDS }
