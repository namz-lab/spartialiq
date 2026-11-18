/**
 * The general reply route (PATCH /api/consultations/:cid/response, development-management.js) and Roads and Works.
 *
 * A Roads and Works referral is answered by the department on its own desk, where the reply carries the s.26(5)
 * infrastructure-cost test. The planning office may record only that no reply came in time ('no_response'), or reopen
 * it ('pending'); a finding (no objection, conditions, objection) is refused here. Other departments are unchanged.
 *
 * A case with two referrals is made for the test and removed afterwards, with the user and session.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { developmentManagementRoutes } = require('../development-management')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const planner = { id: randomUUID(), role: 'planner' }
let app, sid, caseId, roadsCid, fireCid

const reply = (cid, response_status) => app.inject({
  method: 'PATCH', url: `/api/consultations/${cid}/response`, payload: { response_status },
  headers: { authorization: `Bearer ${planner.token}` },
})

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(developmentManagementRoutes, { prefix: '/api' })
  await app.ready()
  const sys = dbContext.systemOf(app.pg)
  planner.email = `jesttest-crw-${planner.id}@example.test`
  await sys.query(
    `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
     VALUES ($1, $2, 'Jest CRW', 'Jest CRW', 'planner', true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)`,
    [planner.id, planner.email])
  const s = await createSession(app, { id: planner.id, role: 'planner', email: planner.email }, null)
  planner.token = s.accessToken
  sid = s.sid
  caseId = (await sys.query(`INSERT INTO spatial_planning.permit_application (applicant_name, development_type, status, authority_id)
                              VALUES ('Jest Applicant', 'extension', 'circulation', 1) RETURNING id`)).rows[0].id
  const refer = async (body) => (await sys.query(
    `INSERT INTO spatial_planning.application_consultation (permit_app_id, body_name, circulated_at, response_status, task_status)
     VALUES ($1, $2, current_date, 'pending', 'open') RETURNING id`, [caseId, body])).rows[0].id
  roadsCid = await refer('engineering')
  fireCid = await refer('fire')
}, 60000)

afterAll(async () => {
  const sys = dbContext.systemOf(app.pg)
  if (caseId) {
    await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [caseId])
    await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [caseId])
  }
  if (sid) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  await sys.query('DELETE FROM users WHERE id = $1', [planner.id])
  await app.close()
}, 60000)

test('the planning office cannot record a Roads and Works finding; it is sent to the desk', async () => {
  const r = await reply(roadsCid, 'no_objection')
  expect(r.statusCode).toBe(409)
  expect(r.json().error).toBe('answered_by_roads_and_works')
  expect(r.json().message).toMatch(/s\.26\(5\)/)
})

test('it can record that Roads and Works did not reply in time', async () => {
  const r = await reply(roadsCid, 'no_response')
  expect(r.statusCode).toBe(200)
  expect(r.json().data.response_status).toBe('no_response')
})

test("another department's reply is recorded as before", async () => {
  const r = await reply(fireCid, 'no_objection')
  expect(r.statusCode).toBe(200)
  expect(r.json().data.task_status).toBe('responded')
})
