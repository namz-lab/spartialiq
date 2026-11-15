/**
 * Stand Number Allocation (H3, migration 105; stands are parcels of the register since migration 228) — end-to-end through the real
 * stands.js handlers against the local DB. The stand under test is a parcel of land.parcel put on offer through the API.
 *
 * Covers: sequential next-number, allocate (register + status flip), the
 * double-allocation guard, revoke (history preserved + stand freed), and the
 * certificate render.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { standsRoutes } = require('../stands')
const { createSession } = require('../../middleware/jwtAuth')
// Production runs dbContext.install + the request store (server.js). Without it
// fastify.pg is the plain pool: superuser, no app.authority_id, and the tenanted
// inserts these routes make fail with a NULL authority — not what production does.
const dbContext = require('../../lib/dbContext')

const TEST_USER_ID = randomUUID()
const TEST_TOWNSHIP = `JT${TEST_USER_ID.slice(0, 6).toUpperCase()}`
const PARCEL_ID = `JEST-${TEST_USER_ID.slice(0, 8)}`
const superPool = new Pool({ connectionString: process.env.DATABASE_URL })
let app, auth, standId, allocId, sid

// Small valid polygon (a ~few-hundred-m² box near Gweru).
const poly = {
  type: 'Polygon',
  coordinates: [[[29.80, -19.45], [29.8005, -19.45], [29.8005, -19.4495], [29.80, -19.4495], [29.80, -19.45]]],
}

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(async (s) => { await standsRoutes(s) }, { prefix: '/api' })
  await app.ready()

  await dbContext.systemOf(app.pg).query(
    `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
     VALUES ($1,$2,'Jest Allocator','Jest Allocator','planner',true,'active','$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 1)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, `jesttest-alloc-${TEST_USER_ID}@example.test`],
  )
  // A real session, not a bare signed token: authenticate() refuses any access
  // token without a `sid` (jwtAuth.js) because a session-less token could never
  // be revoked or timed out.
  const { accessToken, sid: sessionId } = await createSession(
    app,
    { id: TEST_USER_ID, role: 'planner', email: `jesttest-alloc-${TEST_USER_ID}@example.test` },
    null,
  )
  sid = sessionId
  auth = { authorization: `Bearer ${accessToken}` }

  // The register's parcel (a stand's boundary arrives only through the Survey Section import), then the council puts it on offer.
  await superPool.query(
    `INSERT INTO land.parcel (parcel_id, stand_no, township_code, geom_source, source_srid, geom_wgs84, area_m2, source, custodian_dept, status,
                              allocation_status, valid_from, parcel_kind, origin)
     SELECT $1, 'STD-100', $2, g, 4326, g, 500, 'jest', 'Survey Section', 'current', 'unallocated', CURRENT_DATE, 'stand', 'custodian'
       FROM (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) AS g) x`,
    [PARCEL_ID, TEST_TOWNSHIP, JSON.stringify(poly)])
  const created = await app.inject({ method: 'POST', url: `/api/stands/${PARCEL_ID}/offer`, headers: auth, payload: { priceUsd: 1000 } })
  expect(created.statusCode).toBe(201)
  standId = created.json().data.id
}, 30000)

afterAll(async () => {
  await dbContext.systemOf(app.pg).query(`DELETE FROM public.user_session WHERE id = $1`, [sid])
  await dbContext.systemOf(app.pg).query(`DELETE FROM stand_allocation WHERE stand_id = $1`, [standId])
  const c = await superPool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL gms.purge = 'on'")
    await c.query('DELETE FROM land.stand_offer WHERE parcel_id = $1', [PARCEL_ID])
    await c.query('DELETE FROM land.parcel WHERE parcel_id = $1', [PARCEL_ID])
    await c.query('COMMIT')
  } finally { c.release(); await superPool.end() }
  await dbContext.systemOf(app.pg).query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  await app.close()
}, 30000)

test('next-number returns the next sequential number in the township', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/stands/next-number?township=${encodeURIComponent(TEST_TOWNSHIP)}&prefix=STD-`, headers: auth })
  expect(res.statusCode).toBe(200)
  // STD-100 exists → next is 101.
  expect(res.json().data.next_number).toBe(101)
  expect(res.json().data.suggested_stand_number).toBe('STD-101')
})

test('allocate creates a register entry and flips the stand to allocated', async () => {
  const res = await app.inject({
    method: 'POST', url: `/api/stands/${standId}/allocate`, headers: auth,
    payload: { allotteeName: 'Tendai Moyo', purpose: 'residential', conditions: 'Build within 24 months.' },
  })
  expect(res.statusCode).toBe(201)
  allocId = res.json().data.id
  expect(res.json().data.reference_no).toMatch(/^VRDC-STD-\d{4}-\d{6}$/)

  const stand = await dbContext.systemOf(app.pg).query(`SELECT o.status, o.allocated_at, p.allocation_status FROM land.stand_offer o JOIN land.parcel p ON p.parcel_id = o.parcel_id WHERE o.parcel_id = $1`, [standId])
  expect(stand.rows[0].status).toBe('allocated')
  expect(stand.rows[0].allocated_at).not.toBeNull()
  expect(stand.rows[0].allocation_status).toBe('allocated')
})

test('a second allocation of the same stand is rejected', async () => {
  const res = await app.inject({
    method: 'POST', url: `/api/stands/${standId}/allocate`, headers: auth,
    payload: { allotteeName: 'Someone Else' },
  })
  expect(res.statusCode).toBe(409)
})

test('certificate renders HTML with the reference and allottee', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/stand-allocations/${allocId}/certificate`, headers: auth })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toMatch(/text\/html/)
  expect(res.body).toContain('CERTIFICATE OF STAND ALLOCATION')
  expect(res.body).toContain('Tendai Moyo')
})

test('revoke frees the stand and preserves history; re-allocation works', async () => {
  const rev = await app.inject({
    method: 'POST', url: `/api/stands/${standId}/revoke-allocation`, headers: auth,
    payload: { reason: 'Allottee withdrew.' },
  })
  expect(rev.statusCode).toBe(200)

  const stand = await dbContext.systemOf(app.pg).query(`SELECT o.status, p.allocation_status FROM land.stand_offer o JOIN land.parcel p ON p.parcel_id = o.parcel_id WHERE o.parcel_id = $1`, [standId])
  expect(stand.rows[0].status).toBe('available')
  expect(stand.rows[0].allocation_status).toBe('unallocated')

  // History keeps the revoked row (soft), and a fresh allocation can proceed.
  const hist = await app.inject({ method: 'GET', url: `/api/stands/${standId}/allocations`, headers: auth })
  expect(hist.json().data.some(a => a.status === 'revoked')).toBe(true)

  const re = await app.inject({
    method: 'POST', url: `/api/stands/${standId}/allocate`, headers: auth,
    payload: { allotteeName: 'New Allottee' },
  })
  expect(re.statusCode).toBe(201)
}, 30000)

test('creating, merging and splitting stands by geometry are retired: boundaries change only through the survey import', async () => {
  for (const [method, url] of [['POST', '/api/stands'], ['POST', '/api/stands/merge'], ['POST', `/api/stands/${standId}/split`]]) {
    const res = await app.inject({ method, url, headers: auth, payload: { geometry: poly } })
    expect(res.statusCode).toBe(410)
    expect(res.json().error).toBe('boundaries_via_survey_import')
  }
  const put = await app.inject({ method: 'PUT', url: `/api/stands/${standId}`, headers: auth, payload: { geometry: poly } })
  expect(put.statusCode).toBe(410)
})

test('a stand that is not on offer cannot be reserved or allocated, and a second offer is refused', async () => {
  const again = await app.inject({ method: 'POST', url: `/api/stands/${standId}/offer`, headers: auth, payload: {} })
  expect(again.statusCode).toBe(409)
  const none = await app.inject({ method: 'POST', url: '/api/stands/NO-SUCH-PARCEL/offer', headers: auth, payload: {} })
  expect(none.statusCode).toBe(404)
})
