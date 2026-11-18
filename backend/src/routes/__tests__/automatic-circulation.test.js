/**
 * Circulation is automatic (migration 255, development-management.js).
 *
 *   - acknowledging a case circulates it to the departments its kind of development needs, blocking where the rule says,
 *     and moves it into circulation; correcting its type adds what the new type needs; nothing is duplicated;
 *   - a hand-picked circulation is refused; a site inspection (a task that is not circulation) is still made;
 *   - the rules can be read, and applied to a case acknowledged before this (only what it lacks, only while it is open).
 *
 * Cases are made for the test and removed afterwards, with the user and session.
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
let app, sys, sid, applied = true
const cases = []

const call = (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${planner.token}` } })
const newCase = async (type, status) => {
  const id = (await sys.query(
    `INSERT INTO spatial_planning.permit_application (applicant_name, development_type, status, authority_id)
     VALUES ('Jest Circulation', $1, $2, 1) RETURNING id`, [type, status])).rows[0].id
  cases.push(id)
  return id
}
const referrals = async (id) => (await sys.query(
  `SELECT body_name, blocking, task_type, response_due_at - circulated_at AS days
     FROM spatial_planning.application_consultation WHERE permit_app_id = $1 ORDER BY body_name`, [id])).rows
const status = async (id) => (await sys.query('SELECT status FROM spatial_planning.permit_application WHERE id = $1', [id])).rows[0].status

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(developmentManagementRoutes, { prefix: '/api' })
  await app.ready()
  sys = dbContext.systemOf(app.pg)
  applied = (await sys.query(`SELECT to_regclass('spatial_planning.circulation_rule') IS NOT NULL AS ok`)).rows[0].ok
  if (!applied) return
  planner.email = `jesttest-circ-${planner.id}@example.test`
  await sys.query(
    `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
     VALUES ($1, $2, 'Jest Circ', 'Jest Circ', 'planner', true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)`,
    [planner.id, planner.email])
  const s = await createSession(app, { id: planner.id, role: 'planner', email: planner.email }, null)
  planner.token = s.accessToken
  sid = s.sid
}, 60000)

afterAll(async () => {
  for (const id of cases) {
    await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
    await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
  }
  if (sid) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  await sys.query('DELETE FROM users WHERE id = $1', [planner.id])
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!applied) return console.warn('migration 255 not applied: skipped'); await fn() })

maybe('acknowledging a change of use circulates it by the rules and moves it into circulation', async () => {
  const id = await newCase('change_of_use', 'registered')
  await sys.query(`UPDATE spatial_planning.permit_application SET status = 'acknowledged' WHERE id = $1`, [id])
  expect(await status(id)).toBe('circulation')
  const r = await referrals(id)
  expect(r.map((x) => x.body_name)).toEqual(['engineering', 'environmental_health', 'fire'])
  expect(r.find((x) => x.body_name === 'engineering')).toMatchObject({ blocking: true, task_type: 'circulation', days: 14 })
  expect(r.find((x) => x.body_name === 'fire').blocking).toBe(false)
  const events = (await sys.query(`SELECT detail FROM spatial_planning.permit_event WHERE permit_app_id = $1 AND event_type = 'referral_created'`, [id])).rows
  expect(events.length).toBe(3)
  expect(events.every((e) => e.detail.automatic === true)).toBe(true)
})

maybe("correcting an open case's type adds what the new type needs, and nothing twice", async () => {
  const id = await newCase('extension', 'registered')
  await sys.query(`UPDATE spatial_planning.permit_application SET status = 'acknowledged' WHERE id = $1`, [id])
  expect((await referrals(id)).map((x) => x.body_name)).toEqual(['engineering', 'environmental_health'])
  await sys.query(`UPDATE spatial_planning.permit_application SET development_type = 'subdivision' WHERE id = $1`, [id])
  expect((await referrals(id)).map((x) => x.body_name)).toEqual(['electricity', 'engineering', 'environment', 'environmental_health', 'housing', 'survey'])
})

maybe('a hand-picked circulation is refused; a site inspection is still made', async () => {
  const id = await newCase('new_building', 'under_review')
  const manual = await call('POST', `/api/permit-applications/${id}/consultations`, { body_name: 'fire', blocking: true })
  expect(manual.statusCode).toBe(409)
  expect(manual.json().error).toBe('circulation_is_automatic')
  expect((await call('POST', `/api/permit-applications/${id}/consultations`, { body_name: 'engineering', task_type: 'referral' })).statusCode).toBe(409)
  const inspection = await call('POST', `/api/permit-applications/${id}/consultations`,
    { body_name: 'Building Inspector (Development Control Officer)', task_type: 'site_inspection', response_notes: 'Check the setbacks on site.' })
  expect(inspection.statusCode).toBe(201)
})

maybe('the rules can be read, and applied once to a case acknowledged before them', async () => {
  const rules = (await call('GET', '/api/circulation-rules?development_type=subdivision')).json().data
  expect(rules.find((r) => r.body_name === 'survey')).toMatchObject({ blocking: true })
  expect(rules.some((r) => r.body_name === 'engineering' && r.development_type === null)).toBe(true)

  const id = await newCase('new_building', 'under_review')
  const first = await call('POST', `/api/permit-applications/${id}/circulate`)
  expect(first.statusCode).toBe(200)
  expect(first.json().data.made).toBe(3)
  expect(await status(id)).toBe('under_review')
  expect((await call('POST', `/api/permit-applications/${id}/circulate`)).json().data.made).toBe(0)

  const notYet = await newCase('new_building', 'registered')
  const r = await call('POST', `/api/permit-applications/${notYet}/circulate`)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toMatch(/acknowledgement/)
})
