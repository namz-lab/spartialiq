/**
 * The Chief Executive's overview (src/routes/executive-overview.js), through the real route and the
 * real authentication middleware.
 *
 * What it pins down:
 *   - access: the accounting officer reads it; any other role is refused (403) and an anonymous
 *     caller is not let in (401). The IT administrator is deliberately refused.
 *   - shape: one section per Executive Arm department.
 *   - the honesty rule: a section that says `loaded: false` always carries a `note`, so an empty
 *     register can never read as "nothing to report"; and human resources, which has no tables in
 *     the system, is always not loaded.
 *
 * It asserts structure, not figures, so it holds whichever demonstration data is loaded. Test users
 * and their sessions are created here and removed in afterAll (same pattern as soft-delete.test.js).
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { executiveOverviewRoutes } = require('../executive-overview')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const ROLES = ['accounting_officer', 'planner', 'admin', 'finance_officer']
const people = Object.fromEntries(ROLES.map((role) => [role, { id: randomUUID(), role }]))
const sessions = []
let app

const headersOf = (role) => ({ authorization: `Bearer ${people[role].token}` })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(executiveOverviewRoutes, { prefix: '/api' })
  await app.ready()

  for (const p of Object.values(people)) {
    p.email = `jesttest-exec-${p.id}@example.test`
    await dbContext.systemOf(app.pg).query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest Executive', 'Jest Executive', $3, true, 'active',
               '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.email, p.role],
    )
    const { accessToken, sid } = await createSession(app, { id: p.id, role: p.role, email: p.email }, null)
    p.token = accessToken
    sessions.push(sid)
  }
}, 60000)

afterAll(async () => {
  const sys = dbContext.systemOf(app.pg)
  for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await sys.query('DELETE FROM users WHERE id = $1', [p.id])
  await app.close()
}, 60000)

describe('GET /api/executive/overview', () => {
  test('refuses an anonymous caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview' })
    expect(res.statusCode).toBe(401)
  })

  test.each(['planner', 'admin', 'finance_officer'])('refuses the %s role', async (role) => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf(role) })
    expect(res.statusCode).toBe(403)
  })

  test('gives the accounting officer one section per Executive Arm department', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    expect(res.statusCode).toBe(200)
    const { success, data } = res.json()
    expect(success).toBe(true)
    expect(Object.keys(data).sort()).toEqual(
      ['as_of', 'audit', 'engineering', 'hr', 'land', 'planning', 'social_services'],
    )
    expect(Number.isNaN(Date.parse(data.as_of))).toBe(false)
  })

  test("the engineering section separates the council's roads from the national ones and says whether they are verified", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    const eng = res.json().data.engineering
    if (!eng.loaded) return
    for (const k of ['roads', 'road_km', 'roads_unverified', 'national_roads', 'national_road_km']) expect(typeof eng[k]).toBe('number')
    expect(eng.roads_unverified).toBeLessThanOrEqual(eng.roads)
    // The national roads must really be read: a query that failed quietly would leave them at 0.
    const { rows: [db] } = await dbContext.systemOf(app.pg).query(
      "SELECT count(*)::int AS n FROM basemap.road WHERE road_authority IS NOT NULL AND road_authority <> 'VUNGU'")
    expect(eng.national_roads).toBe(db.n)
  })

  test('never reports a section as not loaded without saying why', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    const { as_of: _asOf, ...sections } = res.json().data
    // Collected, not asserted one by one: jest's expect takes no message, and the list says which section.
    const problems = []
    for (const [name, s] of Object.entries(sections)) {
      if (typeof s.loaded !== 'boolean') problems.push(`${name}.loaded is not a boolean`)
      if (s.loaded === false && typeof s.note !== 'string') problems.push(`${name} is not loaded but has no note`)
    }
    expect(problems).toEqual([])
  })

  test('carries no arrears figure (decision D13)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    expect(JSON.stringify(res.json().data).toLowerCase()).not.toContain('arrear')
  })

  test('says human resources is not in the system', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    expect(res.json().data.hr).toEqual({ loaded: false, note: 'Staff and payroll are not yet in the system.' })
  })
})

describe('the land section', () => {
  test('reports stands and farm parcels apart, so the farms are not read as a gap in the rates accounts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/overview', headers: headersOf('accounting_officer') })
    const land = res.json().data.land
    expect(land.stands + land.farms).toBe(land.parcels)
    expect(land.stands_with_account).toBeLessThanOrEqual(land.stands)
    expect(land.farms_with_account).toBeLessThanOrEqual(land.farms)
    expect(land.stands_with_account + land.farms_with_account).toBe(land.parcels_with_account)
  })
})

describe('GET /api/executive/master-plan', () => {
  test('refuses an anonymous caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/executive/master-plan' })).statusCode).toBe(401)
  })

  test.each(['planner', 'admin', 'finance_officer'])('refuses the %s role', async (role) => {
    expect((await app.inject({ method: 'GET', url: '/api/executive/master-plan', headers: headersOf(role) })).statusCode).toBe(403)
  })

  test('gives the accounting officer the plan, its adoption, zones and coverage, and nothing can be written to it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/executive/master-plan', headers: headersOf('accounting_officer') })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.plan.title).toMatch(/Vungu/)
    expect(d.adoption.steps.length).toBeGreaterThan(0)
    expect(d.zones.length).toBeGreaterThan(0)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const w = await app.inject({ method, url: '/api/executive/master-plan', headers: headersOf('accounting_officer'), payload: {} })
      expect([404, 405]).toContain(w.statusCode)
    }
  })
})
