/**
 * The spatial engine's API (src/routes/spatial-engine.js), through the real routes and authentication.
 *
 * A second, fictitious council is created for the test so the states that matter can be shown without
 * touching Vungu's data: a council whose ward register is empty (no canvas, a reason, no features), and a
 * council with wards, water points and a computed run (classes disclosed, wards ranked, a small base flagged,
 * a ward with nothing in it "no data"). Each council must see only its own wards. Water points are used, not
 * parcels, because the parcel register refuses deletes and the test must leave nothing behind. Everything
 * created here is removed in afterAll.
 *
 * Access: the chief executive (accounting_officer) reads; the GIS Branch (gis_officer) refreshes; others do not.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { spatialEngineRoutes } = require('../spatial-engine')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const MARK = `jestse-${randomUUID().slice(0, 8)}`
let app
let otherId
const sessions = []
const people = {}
const ids = { wards: [] }

const headersOf = (who) => ({ authorization: `Bearer ${people[who].token}` })
const sys = () => dbContext.systemOf(app.pg)

async function addUser(who, role, authorityId) {
  const id = randomUUID()
  const email = `${MARK}-${who}@example.test`
  await sys().query(
    `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
     VALUES ($1, $2, 'Jest Engine', 'Jest Engine', $3, true, 'active',
             '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', $4)`, [id, email, role, authorityId])
  const { accessToken, sid } = await createSession(app, { id, role, email }, null)
  sessions.push(sid)
  people[who] = { id, token: accessToken }
}

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(spatialEngineRoutes, { prefix: '/api' })
  await app.ready()

  const { rows: [auth] } = await sys().query(
    `INSERT INTO public.local_authorities (authority_name, kind, code) VALUES ($1, 'rural', $2) RETURNING id`,
    [`Jest Engine Council (${MARK}, fictional)`, `JE${MARK.slice(-6).toUpperCase()}`.slice(0, 16)])
  otherId = auth.id

  await addUser('ceo', 'accounting_officer', 1)            // Vungu
  await addUser('planner', 'planner', 1)
  await addUser('otherCeo', 'accounting_officer', otherId) // the fictitious council: no wards yet
  await addUser('otherGis', 'gis_officer', otherId)
}, 90000)

afterAll(async () => {
  const s = sys()
  await s.query('DELETE FROM spatial_engine.ward_value WHERE authority_id = $1', [otherId])
  await s.query('DELETE FROM spatial_engine.run WHERE authority_id = $1', [otherId])
  await s.query('DELETE FROM council_ops.wash_asset WHERE authority_id = $1', [otherId])
  await s.query('DELETE FROM admin.authority_ward WHERE authority_id = $1', [otherId])
  if (ids.wards.length) await s.query('DELETE FROM admin.ward WHERE ward_code = ANY($1)', [ids.wards])
  for (const sid of sessions) await s.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await s.query('DELETE FROM users WHERE id = $1', [p.id])
  await s.query('DELETE FROM public.local_authorities WHERE id = $1', [otherId])
  await app.close()
}, 90000)

describe('access', () => {
  test.each([['/api/executive/maps'], ['/api/executive/maps/parcel_density']])('%s refuses anonymous callers', async (url) => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
  })

  test.each([['planner'], ['otherGis']])("the %s role cannot read the chief executive's maps", async (who) => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/maps', headers: headersOf(who) })
    expect(res.statusCode).toBe(403)
  })

  test('only the GIS Branch and admin can refresh the engine', async () => {
    for (const who of ['ceo', 'planner']) {
      const res = await app.inject({ method: 'POST', url: '/api/spatial-engine/refresh', headers: headersOf(who) })
      expect(res.statusCode).toBe(403)
    }
  })

  test('rejects a malformed or unknown measure', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/executive/maps/Not%20A%20Key', headers: headersOf('ceo') })
    expect(bad.statusCode).toBe(400)
    const none = await app.inject({ method: 'GET', url: '/api/executive/maps/no_such_measure', headers: headersOf('ceo') })
    expect(none.statusCode).toBe(404)
  })
})

describe('a council with no ward register', () => {
  test('lists the measures and says the register is not linked', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/maps', headers: headersOf('otherCeo') })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.ward_register).toMatchObject({ linked: false, wards: 0, basis: null })
    expect(d.run).toBeNull()
    expect(d.measures.map((m) => m.measure_key)).toEqual(
      expect.arrayContaining(['parcel_density', 'parcel_account_coverage', 'water_points_working', 'budget_execution']))
  })

  test('returns no features and a reason, not an empty grey map', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/maps/parcel_density', headers: headersOf('otherCeo') })
    const d = res.json().data
    expect(d.reason).toBe('ward_register_empty')
    expect(d.features).toEqual([])
    expect(d.classes).toBeNull()
  })
})

describe('a council with wards and a computed run', () => {
  let wardCodes

  beforeAll(async () => {
    const s = sys()
    wardCodes = [`ZJS${MARK.slice(-5)}1`, `ZJS${MARK.slice(-5)}2`, `ZJS${MARK.slice(-5)}3`]
    const boxes = [[10, 50], [11, 50], [12, 50]]
    for (const [i, code] of wardCodes.entries()) {
      const [x, y] = boxes[i]
      await s.query(
        `INSERT INTO admin.ward (ward_code, name, source, parent_pcode, geom)
         VALUES ($1, $2, 'jest', 'ZJESTS', ST_Multi(ST_MakeEnvelope($3::float8, $4::float8, $3::float8 + 0.1, $4::float8 + 0.1, 4326)))`, [code, `JS${i + 1}`, x, y])
      await s.query(
        `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, basis, instrument_ref, note)
         VALUES ($1, $2, current_date, 'interim', 'JEST-ENGINE', 'test')`, [otherId, code])
      ids.wards.push(code)
    }
    // Water points for the fictitious council: four in the first ward (three working), one broken in the second,
    // none in the third.
    const points = [[10, 50, 'working'], [10, 50, 'working'], [10, 50, 'working'], [10, 50, 'broken'], [11, 50, 'broken']]
    for (const [i, [x, y, operational]] of points.entries()) {
      await s.query(
        `INSERT INTO council_ops.wash_asset (asset_code, asset_type, name, operational, data_quality, source, geom, authority_id)
         VALUES ($1, 'borehole', $2, $3, 'unverified', 'jest', ST_SetSRID(ST_MakePoint($4::float8 + 0.05, $5::float8 + 0.05), 4326), $6)`,
        [`${MARK}-${i}`, `Test borehole ${i}`, operational, x, y, otherId])
    }
  }, 60000)

  test('the GIS Branch can refresh, and the run is recorded against the interim register', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/spatial-engine/refresh', headers: headersOf('otherGis') })
    expect(res.statusCode).toBe(200)
    const run = res.json().data
    expect(run.status).toBe('completed')
    expect(run.wards).toBe(3)
    expect(run.ward_register_basis).toBe('interim')
    expect(run.detail.water_points_working).toMatchObject({ facts: 5, placed: 5, unlocated: 0 })
  })

  test('the register is linked and says its basis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/maps', headers: headersOf('otherCeo') })
    const d = res.json().data
    expect(d.ward_register).toMatchObject({ linked: true, wards: 3, basis: 'interim' })
    expect(d.run.wards).toBe(3)
  })

  test('a measure comes back as ranked GeoJSON with its classification disclosed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/maps/water_points_working', headers: headersOf('otherCeo') })
    const d = res.json().data
    expect(d.reason).toBeNull()
    expect(d.type).toBe('FeatureCollection')
    expect(d.features).toHaveLength(3)
    expect(d.classes).toMatchObject({ method: 'fixed', breaks: [50, 75, 90] })
    expect(d.run).toMatchObject({ unlocated: 0, facts: 5 })
    const byName = Object.fromEntries(d.features.map((f) => [f.properties.name, f.properties]))
    expect(byName.JS1).toMatchObject({ raw_value: 75, reliability: 'ok', rank: 1, class_index: 2 })
  })

  test('a share over a small base is flagged and left unclassified', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/executive/maps/water_points_working', headers: headersOf('otherCeo') })).json().data
    const js2 = d.features.find((f) => f.properties.name === 'JS2').properties
    expect(js2.reliability).toBe('small_base')     // one water point is not a base for a percentage
    expect(js2.raw_value).toBe(0)                  // the figure is shown in the list...
    expect(js2.value).toBeNull()                   // ...but the map is not coloured by a number it cannot stand behind
    expect(js2.class_index).toBeNull()
    expect(js2.rank).toBeNull()
  })

  test('a ward with nothing in it is no data, never zero', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/executive/maps/water_points_working', headers: headersOf('otherCeo') })).json().data
    const js3 = d.features.find((f) => f.properties.name === 'JS3').properties
    expect(js3.reliability).toBe('no_data')
    expect(js3.raw_value).toBeNull()
  })

  test('a measure with no facts for the council is no data in every ward, not a map of zeros', async () => {
    // The fictitious council owns no parcels, and Vungu's custodian parcels are not in its wards.
    const d = (await app.inject({ method: 'GET', url: '/api/executive/maps/parcel_density', headers: headersOf('otherCeo') })).json().data
    expect(d.features).toHaveLength(3)
    expect(d.features.every((f) => f.properties.reliability === 'no_data' && f.properties.raw_value === null)).toBe(true)
    expect(d.classes).toMatchObject({ breaks: [] })
  })

  test('each council sees only its own wards', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/executive/maps/water_points_working', headers: headersOf('otherCeo') })).json().data
    expect(mine.features.every((f) => wardCodes.includes(f.properties.ward_code))).toBe(true)
    const vungu = (await app.inject({ method: 'GET', url: '/api/executive/maps/water_points_working', headers: headersOf('ceo') })).json().data
    expect(vungu.features.some((f) => wardCodes.includes(f.properties.ward_code))).toBe(false)
    // And Vungu's last run is never the fictitious council's.
    const idx = (await app.inject({ method: 'GET', url: '/api/executive/maps', headers: headersOf('ceo') })).json().data
    expect(idx.run?.wards).not.toBe(3)
  })
})
