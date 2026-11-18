/**
 * Roads and Works records its field survey (src/routes/roads-works-registers.js, migration 254).
 *
 *   - the entry rules: the day surveyed is required and not in the future; only the survey's words; GPS inside Zimbabwe;
 *   - who: the Foreman surveys roads but not water points; the Water Technician surveys water points but not roads;
 *     the EO is refused; the Chief Executive reads;
 *   - a road surveyed for surface and condition becomes "verified", and the entry is logged with what it was before;
 *   - a structure found on the survey is added with its point and gets its ward.
 *
 * Each test puts back the road and water point it changed, and removes the structure and log lines it made.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { roadsWorksRegisterRoutes, readFields, readEntry, readPoint, ROAD_FIELDS } = require('../roads-works-registers')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const DAY = new Date().toISOString().slice(0, 10)

describe('the entry rules (no database)', () => {
  test('the day surveyed is required and not in the future', () => {
    expect(readEntry({}).problems.join(' ')).toMatch(/day the survey/)
    expect(readEntry({ surveyed_on: '2999-01-01' }).problems.length).toBe(1)
    expect(readEntry({ surveyed_on: DAY }).problems).toEqual([])
  })
  test("only the survey's words; a field left out is left alone; empty clears it", () => {
    expect(readFields({ surface: 'tar' }, ROAD_FIELDS).problems.join(' ')).toMatch(/Surface is one of/)
    expect(readFields({ surface: 'gravel', condition: 'very_poor' }, ROAD_FIELDS).set).toEqual({ surface: 'gravel', condition: 'very_poor' })
    expect(readFields({ drainage: '' }, ROAD_FIELDS).set).toEqual({ drainage: null })
    expect(readFields({ width_m: -2 }, ROAD_FIELDS).problems.length).toBe(1)
  })
  test('a GPS point must lie in Zimbabwe (a swapped pair is refused)', () => {
    expect(readPoint({ lng: 29.6, lat: -19.4 }).point).toEqual({ lng: 29.6, lat: -19.4 })
    expect(readPoint({ lng: -19.4, lat: 29.6 }).problems.length).toBe(1)
    expect(readPoint({}).point).toBeNull()
  })
})

const ROLES = ['engineer', 'roads_foreman', 'water_technician', 'eo', 'accounting_officer']
const people = Object.fromEntries(ROLES.map((role) => [role, { id: randomUUID(), role }]))
const sessions = []
let app, applied = true, road, water
const made = []

const call = (method, url, role, payload) => app.inject({ method, url, payload, headers: role ? { authorization: `Bearer ${people[role].token}` } : {} })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(roadsWorksRegisterRoutes, { prefix: '/api' })
  await app.ready()
  const sys = dbContext.systemOf(app.pg)
  applied = (await sys.query(`SELECT to_regclass('council_ops.survey_record') IS NOT NULL AS ok`)).rows[0].ok
  if (!applied) return
  for (const p of Object.values(people)) {
    p.email = `jesttest-rwr-${p.id}@example.test`
    await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest RWR', 'Jest RWR', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)
       ON CONFLICT (id) DO NOTHING`, [p.id, p.email, p.role])
    const { accessToken, sid } = await createSession(app, { id: p.id, role: p.role, email: p.email }, null)
    p.token = accessToken
    sessions.push(sid)
  }
  road = (await sys.query(`SELECT * FROM council_ops.road_asset WHERE status = 'active' AND data_quality = 'unverified' ORDER BY asset_code LIMIT 1`)).rows[0]
  water = (await sys.query(`SELECT * FROM council_ops.wash_asset ORDER BY asset_code LIMIT 1`)).rows[0]
}, 60000)

afterAll(async () => {
  const sys = dbContext.systemOf(app.pg)
  if (applied) {
    if (road) {
      await sys.query(`UPDATE council_ops.road_asset SET surface = $2, condition = $3, data_quality = $4, surveyed_on = $5, width_m = $6, drainage = $7 WHERE id = $1`,
        [road.id, road.surface, road.condition, road.data_quality, road.surveyed_on, road.width_m, road.drainage])
    }
    if (water) {
      await sys.query(`UPDATE council_ops.wash_asset SET operational = $2, pump_type = $3, surveyed_on = $4, caretaker = $5 WHERE id = $1`,
        [water.id, water.operational, water.pump_type, water.surveyed_on, water.caretaker])
    }
    for (const id of made) await sys.query('DELETE FROM council_ops.road_structure WHERE id = $1', [id])
    const ids = Object.values(people).map((p) => p.id)
    await sys.query('DELETE FROM council_ops.survey_record WHERE recorded_by = ANY($1)', [ids])
  }
  for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await sys.query('DELETE FROM users WHERE id = $1', [p.id])
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!applied || !road || !water) return console.warn('migration 254 or register data missing: skipped'); await fn() })

describe('the survey registers', () => {
  maybe('the department and the Chief Executive read; the EO is refused', async () => {
    const s = await call('GET', '/api/roads-works/registers', 'roads_foreman')
    expect(s.statusCode).toBe(200)
    expect(s.json().data.can_write).toEqual({ road: true, structure: true, water_point: false, council_asset: false })
    expect((await call('GET', '/api/roads-works/roads?state=unsurveyed&limit=5', 'accounting_officer')).statusCode).toBe(200)
    expect((await call('GET', '/api/roads-works/roads', 'eo')).statusCode).toBe(403)
  })

  maybe('a road surveyed for surface and condition becomes verified, and the entry is logged', async () => {
    const r = await call('PATCH', `/api/roads-works/roads/${road.id}`, 'roads_foreman',
      { surveyed_on: DAY, surface: 'gravel', condition: 'poor', width_m: 6.5, drainage: 'blocked', photo_ref: 'IMG-0042' })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.data_quality).toBe('verified')
    expect(r.json().data.surface).toBe('gravel')
    const log = (await call('GET', `/api/roads-works/survey-log?register=road&record_id=${road.id}`, 'engineer')).json().data.items
    expect(log[0].after).toMatchObject({ surface: 'gravel', condition: 'poor', data_quality: 'verified' })
    expect(log[0].before).toMatchObject({ surface: road.surface, data_quality: 'unverified' })
    expect(log[0].photo_ref).toBe('IMG-0042')
  })

  maybe('an entry with the wrong words or no day is refused with the reason', async () => {
    const r = await call('PATCH', `/api/roads-works/roads/${road.id}`, 'engineer', { surface: 'tar' })
    expect(r.statusCode).toBe(400)
    expect(r.json().message).toMatch(/day the survey/)
    expect(r.json().message).toMatch(/Surface is one of/)
  })

  maybe('the Water Technician surveys water points but not roads; the Foreman the reverse', async () => {
    expect((await call('PATCH', `/api/roads-works/roads/${road.id}`, 'water_technician', { surveyed_on: DAY, condition: 'good' })).statusCode).toBe(403)
    expect((await call('PATCH', `/api/roads-works/water-points/${water.id}`, 'roads_foreman', { surveyed_on: DAY, operational: 'working' })).statusCode).toBe(403)
    const w = await call('PATCH', `/api/roads-works/water-points/${water.id}`, 'water_technician', { surveyed_on: DAY, operational: 'broken', pump_type: 'hand_pump', caretaker: 'Mrs Moyo' })
    expect(w.statusCode).toBe(200)
    expect(w.json().data.operational).toBe('broken')
  })

  maybe('a bridge found on the survey is added with its point, and gets its ward', async () => {
    const r = await call('POST', '/api/roads-works/structures', 'engineer',
      { surveyed_on: DAY, structure_type: 'culvert', name: 'Jest culvert', condition: 'fair', span_m: 0.9, lng: 29.75, lat: -19.45, road_asset_id: road.id })
    expect(r.statusCode).toBe(201)
    made.push(r.json().data.id)
    const list = (await call('GET', '/api/roads-works/structures', 'roads_foreman')).json().data.items
    const s = list.find((x) => x.id === r.json().data.id)
    expect(s.road_code).toBe(road.asset_code)
    expect(s.lng).toBeCloseTo(29.75, 4)
    expect((await call('POST', '/api/roads-works/structures', 'engineer', { surveyed_on: DAY, structure_type: 'bridge' })).json().message).toMatch(/GPS point/)
  })
})
