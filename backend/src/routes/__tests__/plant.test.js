/**
 * The plant register (src/routes/plant.js, migration 252), through the real routes and authentication.
 *
 *   - who: the District Engineer, the Civil Engineering Technician and the Foreman read and write; the Chief Executive
 *     reads only; the EO Planning and anonymous callers are refused;
 *   - a day's log is validated (no more than 24 hours, no negative fuel) and moves the hour meter forward, never back;
 *   - the registers' wards and council road classes (migration 252) are filled.
 *
 * A plant item is created for the test and removed afterwards, with its log and the test users and sessions.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { plantRoutes } = require('../plant')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const ROLES = ['engineer', 'civil_technician', 'roads_foreman', 'accounting_officer', 'eo']
const people = Object.fromEntries(ROLES.map((role) => [role, { id: randomUUID(), role }]))
const sessions = []
let app, plantId, applied = true

const call = (method, url, role, payload) => app.inject({ method, url, payload, headers: role ? { authorization: `Bearer ${people[role].token}` } : {} })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(plantRoutes, { prefix: '/api' })
  await app.ready()
  const sys = dbContext.systemOf(app.pg)
  applied = (await sys.query(`SELECT to_regclass('council_ops.plant') IS NOT NULL AS ok`)).rows[0].ok
  if (!applied) return
  for (const p of Object.values(people)) {
    p.email = `jesttest-plant-${p.id}@example.test`
    await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest Plant', 'Jest Plant', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)
       ON CONFLICT (id) DO NOTHING`, [p.id, p.email, p.role])
    const { accessToken, sid } = await createSession(app, { id: p.id, role: p.role, email: p.email }, null)
    p.token = accessToken
    sessions.push(sid)
  }
  plantId = (await sys.query(
    `INSERT INTO council_ops.plant (plant_no, kind, description, hour_meter, next_service_hours, authority_id)
     VALUES ($1, 'grader', 'Jest grader', 100, 150, 1) RETURNING id`, ['JEST-' + randomUUID().slice(0, 8)])).rows[0].id
}, 60000)

afterAll(async () => {
  const sys = dbContext.systemOf(app.pg)
  if (plantId) await sys.query('DELETE FROM council_ops.plant WHERE id = $1', [plantId])
  for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await sys.query('DELETE FROM users WHERE id = $1', [p.id])
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!applied) return console.warn('migration 252 not applied: skipped'); await fn() })

describe('the plant register', () => {
  maybe('Roads and Works reads it and may write; the Chief Executive reads only; others are refused', async () => {
    for (const role of ['engineer', 'civil_technician', 'roads_foreman']) {
      const r = await call('GET', '/api/units/engineering/plant', role)
      expect(r.statusCode).toBe(200)
      expect(r.json().data.can_write).toBe(true)
      expect(r.json().data.plant.some((p) => p.id === plantId)).toBe(true)
    }
    const ceo = await call('GET', '/api/units/engineering/plant', 'accounting_officer')
    expect(ceo.statusCode).toBe(200)
    expect(ceo.json().data.can_write).toBe(false)
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'accounting_officer', { hours: 1 })).statusCode).toBe(403)
    expect((await call('GET', '/api/units/engineering/plant', 'eo')).statusCode).toBe(403)
    expect((await call('GET', '/api/units/engineering/plant')).statusCode).toBe(401)
  })

  maybe('a day is validated, and the hour meter only moves forward', async () => {
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'roads_foreman', { hours: 25 })).statusCode).toBe(400)
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'roads_foreman', { fuel_litres: -1 })).statusCode).toBe(400)
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'roads_foreman', {})).statusCode).toBe(400)
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'roads_foreman', { hours: 8, fuel_litres: 60, hour_meter_end: 160, job: 'Jest grading' })).statusCode).toBe(201)
    expect((await call('POST', `/api/units/engineering/plant/${plantId}/log`, 'roads_foreman', { hours: 1, hour_meter_end: 120 })).statusCode).toBe(201)
    const item = (await call('GET', '/api/units/engineering/plant', 'engineer')).json().data.plant.find((p) => p.id === plantId)
    expect(Number(item.hour_meter)).toBe(160)                   // not back to 120
    expect(item.service_due).toBe(true)                         // 160 is past the 150 the service was due at
    expect(item.days_this_month).toBe(2)
  })

  maybe('a status is one of the register\'s', async () => {
    expect((await call('PATCH', `/api/units/engineering/plant/${plantId}`, 'engineer', { status: 'stolen' })).statusCode).toBe(400)
    const r = await call('PATCH', `/api/units/engineering/plant/${plantId}`, 'engineer', { status: 'under_repair', last_service_on: '2026-11-18' })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.status).toBe('under_repair')
  })
})

describe('the registers\' wards and road classes (migration 252)', () => {
  maybe('every road has a council class, and roads, water points with a location have a ward where one contains them', async () => {
    const sys = dbContext.systemOf(app.pg)
    const r = (await sys.query(`SELECT count(*)::int n, count(council_class)::int classed,
        count(*) FILTER (WHERE ward IS NULL AND geom IS NOT NULL AND council_ops.ward_of(geom, authority_id) IS NOT NULL)::int missed
      FROM council_ops.road_asset`)).rows[0]
    expect(r.classed).toBe(r.n)
    expect(r.missed).toBe(0)
    const w = (await sys.query(`SELECT count(*) FILTER (WHERE ward IS NULL AND geom IS NOT NULL AND council_ops.ward_of(geom, authority_id) IS NOT NULL)::int missed FROM council_ops.wash_asset`)).rows[0]
    expect(w.missed).toBe(0)
  })
})
