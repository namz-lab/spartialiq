/**
 * Unit dashboards (src/routes/units.js) and the Chief Executive's ward drill-down, through the real routes and
 * the real authentication middleware.
 *
 * What it pins down:
 *   - access: the Chief Executive opens every unit; each unit head opens only their own and is refused (403)
 *     on any other; other staff roles and anonymous callers are refused (403 / 401).
 *   - the list: a head is offered one unit, the Chief Executive five.
 *   - a unit's shape: head, establishment with vacancies, sections that obey the honesty rule, and the
 *     unit's own measures only (no measure of another unit leaks into its maps).
 *   - a unit with no ward measure (internal audit) says so.
 *   - the ward profile groups every measure by unit and is the Chief Executive's alone.
 *   - the ward table: every ward a row, totals that tie out, a missing figure is null and never zero, a unit's table carries its own measures only.
 *
 * It asserts structure, not figures, so it holds whichever demonstration data is loaded. Test users and their
 * sessions are created here and removed in afterAll (same pattern as executive-overview.test.js).
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { unitRoutes } = require('../units')
const { spatialEngineRoutes } = require('../spatial-engine')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')
const { UNITS, canSeeUnit, unitOfRole } = require('../../config/units')

const HEADS = { eo: 'planning', finance_admin: 'finance', engineer: 'engineering', hr_social_officer: 'social_admin', auditor: 'audit' }
const ROLES = ['accounting_officer', ...Object.keys(HEADS), 'planner', 'admin']
const people = Object.fromEntries(ROLES.map((role) => [role, { id: randomUUID(), role }]))
const sessions = []
let app

const as = (role) => ({ authorization: `Bearer ${people[role].token}` })
const get = (url, role) => app.inject({ method: 'GET', url, headers: role ? as(role) : {} })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(unitRoutes, { prefix: '/api' })
  await app.register(spatialEngineRoutes, { prefix: '/api' })
  await app.ready()

  for (const p of Object.values(people)) {
    p.email = `jesttest-unit-${p.id}@example.test`
    await dbContext.systemOf(app.pg).query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest Unit Head', 'Jest Unit Head', $3, true, 'active',
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

describe('the unit access rule', () => {
  test('is the same in the config and in the routes: five units, each headed by its role', () => {
    expect(UNITS.map((u) => u.key).sort()).toEqual(['audit', 'engineering', 'finance', 'planning', 'social_admin'])
    for (const [role, key] of Object.entries(HEADS)) expect(unitOfRole(role)).toBe(key)
    expect(canSeeUnit({ role: 'accounting_officer' }, 'audit')).toBe(true)
    expect(canSeeUnit({ role: 'engineer' }, 'planning')).toBe(false)
    expect(canSeeUnit({ role: 'planner' }, 'planning')).toBe(false)
    expect(canSeeUnit(null, 'planning')).toBe(false)
  })
})

describe('GET /api/units', () => {
  test('refuses an anonymous caller', async () => {
    expect((await get('/api/units')).statusCode).toBe(401)
  })

  test.each(['planner', 'admin'])('refuses the %s role', async (role) => {
    expect((await get('/api/units', role)).statusCode).toBe(403)
  })

  test('offers the Chief Executive all five units', async () => {
    const res = await get('/api/units', 'accounting_officer')
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((u) => u.key).sort()).toEqual(['audit', 'engineering', 'finance', 'planning', 'social_admin'])
  })

  test.each(Object.entries(HEADS))('offers the %s role only its own unit', async (role, key) => {
    const res = await get('/api/units', role)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((u) => u.key)).toEqual([key])
  })
})

describe('GET /api/units/:key', () => {
  test('refuses an unknown unit', async () => {
    expect((await get('/api/units/nonsense', 'accounting_officer')).statusCode).toBe(404)
  })

  test.each(Object.entries(HEADS))('%s opens its own unit (%s) and no other', async (role, key) => {
    expect((await get(`/api/units/${key}`, role)).statusCode).toBe(200)
    for (const other of UNITS.map((u) => u.key).filter((k) => k !== key)) {
      expect((await get(`/api/units/${other}`, role)).statusCode).toBe(403)
      expect((await get(`/api/units/${other}/maps`, role)).statusCode).toBe(403)
    }
  })

  test('the Chief Executive opens every unit, each with an establishment', async () => {
    for (const unit of UNITS) {
      const res = await get(`/api/units/${unit.key}`, 'accounting_officer')
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data.unit.key).toBe(unit.key)
      expect(Array.isArray(data.establishment.posts)).toBe(true)
      expect(data.establishment.vacant).toBe(data.establishment.posts.filter((p) => p.vacant).length)
      // A vacancy never carries a name.
      for (const post of data.establishment.posts) if (post.vacant) expect(post.holder_name).toBeNull()
    }
  })

  test('never reports a section as not loaded without saying why', async () => {
    const problems = []
    for (const unit of UNITS) {
      const { data } = (await get(`/api/units/${unit.key}`, 'accounting_officer')).json()
      for (const [name, s] of Object.entries(data.sections)) {
        if (s.loaded === false && !s.note) problems.push(`${unit.key}/${name}`)
      }
    }
    expect(problems).toEqual([])
  })

  test('human resources is never loaded: there are no staff tables', async () => {
    const { data } = (await get('/api/units/social_admin', 'accounting_officer')).json()
    expect(data.sections.hr.loaded).toBe(false)
  })

  test('internal audit has no ward measure and says so', async () => {
    const { data } = (await get('/api/units/audit', 'accounting_officer')).json()
    expect(data.maps.has_measures).toBe(false)
    expect(data.maps.measures).toEqual([])
  })
})

describe('unit maps', () => {
  test('a unit lists only its own measures', async () => {
    for (const unit of UNITS) {
      const { data } = (await get(`/api/units/${unit.key}/maps`, 'accounting_officer')).json()
      for (const m of data.measures) expect(m.unit_key).toBe(unit.key)
    }
  })

  test('engineering has the water-point and road measures', async () => {
    const { data } = (await get('/api/units/engineering/maps', 'engineer')).json()
    expect(data.measures.map((m) => m.measure_key)).toEqual(expect.arrayContaining(['water_points_working', 'road_density']))
  })

  test("a head cannot read another unit's measure through their own unit", async () => {
    const res = await get('/api/units/engineering/maps/parcel_density', 'engineer')
    expect(res.statusCode).toBe(404)
  })

  test('a unit measure map carries the classes and the ward register state', async () => {
    const res = await get('/api/units/engineering/maps/water_points_working', 'engineer')
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.measure.key).toBe('water_points_working')
    expect(data).toHaveProperty('ward_register')
    expect(Array.isArray(data.features)).toBe(true)
  })

  test('a bad measure key is a 400', async () => {
    expect((await get('/api/units/engineering/maps/Bad-Key', 'engineer')).statusCode).toBe(400)
  })
})

describe('GET /api/executive/wards/:code', () => {
  test.each(['engineer', 'planner', 'admin'])('refuses the %s role', async (role) => {
    expect((await get('/api/executive/wards/ZEC23-VUNGU-01', role)).statusCode).toBe(403)
  })

  test('refuses a malformed ward code', async () => {
    expect((await get('/api/executive/wards/bad%20code', 'accounting_officer')).statusCode).toBe(400)
  })

  test('says a ward that is not the council\'s is not found', async () => {
    expect((await get('/api/executive/wards/NO-SUCH-WARD', 'accounting_officer')).statusCode).toBe(404)
  })

  test('groups every measure of a real ward by its unit', async () => {
    const { rows } = await dbContext.systemOf(app.pg).query(
      `SELECT ward_code FROM admin.authority_ward WHERE authority_id = 1 AND (valid_to IS NULL OR valid_to >= CURRENT_DATE) ORDER BY ward_code LIMIT 1`)
    if (rows.length === 0) return // no wards loaded in this database: nothing to profile
    const res = await get(`/api/executive/wards/${rows[0].ward_code}`, 'accounting_officer')
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.ward.ward_code).toBe(rows[0].ward_code)
    for (const [unitKey, entries] of Object.entries(data.units)) {
      for (const e of entries) {
        expect(e.unit_key ?? 'other').toBe(unitKey)
        // A ward with no figure is null and says no_data; it is never shown as 0.
        if (e.reliability === 'no_data') expect(e.value).toBeNull()
      }
    }
  })
})

describe('a new unit head belongs to the council', () => {
  test.each(['engineer', 'hr_social_officer'])('an account created with the %s role and no authority gets the council\'s', async (role) => {
    const sys = dbContext.systemOf(app.pg)
    const id = randomUUID()
    try {
      await sys.query(
        `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash)
         VALUES ($1, $2, 'Jest No Authority', 'Jest No Authority', $3, true, 'active', 'x')`,
        [id, `jesttest-noauth-${id}@example.test`, role])
      const { rows } = await sys.query('SELECT authority_id FROM users WHERE id = $1', [id])
      expect(rows[0].authority_id).not.toBeNull()
    } finally {
      await sys.query('DELETE FROM users WHERE id = $1', [id])
    }
  })
})

describe('the ward table', () => {
  const sum = (rows, k) => rows.reduce((a, r) => a + r.counts[k], 0)

  test('is for the Chief Executive: every ward a row, every measure a column, and the counts add up to their totals', async () => {
    const res = await get('/api/executive/ward-table', 'accounting_officer')
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.rows.length).toBeGreaterThan(0)
    expect(d.measures.length).toBeGreaterThan(0)
    for (const c of d.counts) {
      // the wards plus what lies in no ward make the register's own total
      expect(sum(d.rows, c.key) + d.not_in_a_ward[c.key]).toBe(d.totals[c.key])
      expect(d.not_in_a_ward[c.key]).toBeGreaterThanOrEqual(0)
    }
    for (const r of d.rows) for (const m of d.measures) expect(r.measures).toHaveProperty(m.key)
  })

  test('a figure a ward does not have is null with its reason, never zero', async () => {
    const d = (await get('/api/executive/ward-table', 'accounting_officer')).json().data
    const cells = d.rows.flatMap((r) => Object.values(r.measures))
    for (const c of cells.filter((x) => x.reliability !== 'ok')) expect(c.value).toBeNull()
    for (const c of cells.filter((x) => x.reliability === 'ok')) expect(typeof c.value).toBe('number')
  })

  test('the stands measure counts stands only, so the farm parcels are not read as a gap', async () => {
    const d = (await get('/api/executive/ward-table', 'accounting_officer')).json().data
    expect(d.measures.find((m) => m.key === 'parcel_account_coverage').label).toBe('Stands with a rates account')
  })

  test('a table for a unit carries its own measures only, and no register counts unless it is planning', async () => {
    const eng = (await get('/api/units/engineering/ward-table', 'engineer')).json().data
    const own = (await get('/api/units/engineering/maps', 'engineer')).json().data.measures.map((m) => m.measure_key).sort()
    expect(eng.measures.map((m) => m.key).sort()).toEqual(own)
    expect(eng.counts).toEqual([])
    const planning = (await get('/api/units/planning/ward-table', 'eo')).json().data
    expect(planning.counts.length).toBeGreaterThan(0)
  })

  test('is refused to the head of another unit, other staff and anonymous callers', async () => {
    expect((await get('/api/units/planning/ward-table', 'engineer')).statusCode).toBe(403)
    expect((await get('/api/executive/ward-table', 'planner')).statusCode).toBe(403)
    expect((await get('/api/executive/ward-table', 'engineer')).statusCode).toBe(403)
    expect((await get('/api/executive/ward-table')).statusCode).toBe(401)
  })
})
