/**
 * Roads and Works in the planning workflow (src/routes/roads-works-referrals.js, migration 253).
 *
 *   - the reply's rules, from the law: every head of the s.26(5) infrastructure-cost test answered; a cost found comes
 *     with its condition; a conditional reply says what; an objection gives reasons; a subdivision's road reserves are
 *     assessed (s.41); a reserve over 24 m is flagged (s.41(3)); an access names its council road (Roads Act);
 *   - who: the District Engineer and the Civil Engineering Technician reply; the Foreman reads; the EO reads the assessment;
 *   - the reply answers the circulation, is logged on the case, and is refused once the case is decided.
 *
 * A case and its engineering referral are created for the test and removed afterwards, with the users and sessions.
 */
require('dotenv').config()
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { roadsWorksReferralRoutes, problems } = require('../roads-works-referrals')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const NO_COST = { roads: false, parking: false, drainage: false, sewerage: false, water: false }

describe('the reply rules (no database)', () => {
  const house = { development_type: 'extension' }
  const subdivision = { development_type: 'subdivision' }
  test('every head of the s.26(5) test must be answered', () => {
    expect(problems({ response_status: 'no_objection', cost: { roads: false } }, house).join(' ')).toMatch(/s\.26\(5\)/)
    expect(problems({ response_status: 'no_objection', cost: NO_COST }, house)).toEqual([])
  })
  test('a cost found needs the condition that recovers it', () => {
    const r = problems({ response_status: 'conditional_approval', cost: { ...NO_COST, roads: true } }, house)
    expect(r.join(' ')).toMatch(/condition that recovers it/)
    expect(problems({ response_status: 'conditional_approval', cost: { ...NO_COST, roads: true, condition: 'The applicant pays US$4 000 towards gravelling the access road.' } }, house)).toEqual([])
  })
  test('an objection gives reasons; a conditional reply says what', () => {
    expect(problems({ response_status: 'objection', cost: NO_COST }, house).join(' ')).toMatch(/reasons/)
    expect(problems({ response_status: 'conditional_approval', cost: NO_COST }, house).join(' ')).toMatch(/what the conditions are/)
  })
  test('a subdivision has its road reserves assessed (s.41); a house does not', () => {
    expect(problems({ response_status: 'no_objection', cost: NO_COST }, subdivision).join(' ')).toMatch(/s\.41/)
    expect(problems({ response_status: 'no_objection', cost: NO_COST, subdivision: { road_reserves_adequate: true } }, subdivision)).toEqual([])
  })
  test('an access allowed or refused names its council road', () => {
    expect(problems({ response_status: 'no_objection', cost: NO_COST, access: { approved: true } }, house).join(' ')).toMatch(/council road/)
  })
})

const ROLES = ['engineer', 'civil_technician', 'roads_foreman', 'eo']
const people = Object.fromEntries(ROLES.map((role) => [role, { id: randomUUID(), role }]))
const sessions = []
let app, applied = true, caseId, subId, cid, subCid

const call = (method, url, role, payload) => app.inject({ method, url, payload, headers: role ? { authorization: `Bearer ${people[role].token}` } : {} })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(roadsWorksReferralRoutes, { prefix: '/api' })
  await app.ready()
  const sys = dbContext.systemOf(app.pg)
  applied = (await sys.query(`SELECT to_regclass('spatial_planning.engineering_assessment') IS NOT NULL AS ok`)).rows[0].ok
  if (!applied) return
  for (const p of Object.values(people)) {
    p.email = `jesttest-rw-${p.id}@example.test`
    await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest RW', 'Jest RW', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)
       ON CONFLICT (id) DO NOTHING`, [p.id, p.email, p.role])
    const { accessToken, sid } = await createSession(app, { id: p.id, role: p.role, email: p.email }, null)
    p.token = accessToken
    sessions.push(sid)
  }
  const newCase = async (type) => (await sys.query(
    `INSERT INTO spatial_planning.permit_application (applicant_name, development_type, status, authority_id)
     VALUES ('Jest Applicant', $1, 'circulation', 1) RETURNING id`, [type])).rows[0].id
  const refer = async (pid) => (await sys.query(
    `INSERT INTO spatial_planning.application_consultation (permit_app_id, body_name, circulated_at, response_status, task_status)
     VALUES ($1, 'engineering', current_date, 'pending', 'open') RETURNING id`, [pid])).rows[0].id
  caseId = await newCase('extension'); cid = await refer(caseId)
  subId = await newCase('subdivision'); subCid = await refer(subId)
}, 60000)

afterAll(async () => {
  const sys = dbContext.systemOf(app.pg)
  for (const id of [caseId, subId].filter(Boolean)) {
    await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
    await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
  }
  for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await sys.query('DELETE FROM users WHERE id = $1', [p.id])
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!applied) return console.warn('migration 253 not applied: skipped'); await fn() })

describe('the engineering referral desk', () => {
  maybe('Roads and Works sees the referral; the Foreman reads but cannot reply; the EO cannot open the desk', async () => {
    const list = await call('GET', '/api/roads-works/referrals', 'roads_foreman')
    expect(list.statusCode).toBe(200)
    expect(list.json().data.referrals.some((r) => r.id === cid)).toBe(true)
    expect(list.json().data.can_reply).toBe(false)
    expect((await call('POST', `/api/roads-works/referrals/${cid}/reply`, 'roads_foreman', { response_status: 'no_objection', cost: NO_COST })).statusCode).toBe(403)
    expect((await call('GET', '/api/roads-works/referrals', 'eo')).statusCode).toBe(403)
  })

  maybe('an incomplete reply is refused with the reason', async () => {
    const r = await call('POST', `/api/roads-works/referrals/${cid}/reply`, 'civil_technician', { response_status: 'conditional_approval', cost: { ...NO_COST, drainage: true } })
    expect(r.statusCode).toBe(400)
    expect(r.json().message).toMatch(/s\.26\(5\)/)
  })

  maybe('a full reply answers the circulation, saves the assessment, and the EO reads it', async () => {
    const r = await call('POST', `/api/roads-works/referrals/${cid}/reply`, 'engineer', {
      response_status: 'conditional_approval', notes: 'Stormwater from the extension must not drain onto the road.',
      cost: { ...NO_COST, drainage: true, estimated_cost: 1500, currency: 'USD', condition: 'The applicant builds a soakaway and pays US$1 500 towards the road side drain.' },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.consultation.response_status).toBe('conditional_approval')
    expect(r.json().data.consultation.task_status).toBe('responded')
    const a = await call('GET', `/api/permit-applications/${caseId}/engineering-assessment`, 'eo')
    expect(a.statusCode).toBe(200)
    expect(a.json().data.cost_drainage).toBe(true)
    expect(a.json().data.cost_condition).toMatch(/soakaway/)
    expect((await call('GET', '/api/roads-works/referrals?state=open', 'engineer')).json().data.referrals.some((x) => x.id === cid)).toBe(false)
  })

  maybe('a subdivision reply records its roads, and a reserve over 24 m is flagged (s.41(3))', async () => {
    const r = await call('POST', `/api/roads-works/referrals/${subCid}/reply`, 'engineer', {
      response_status: 'no_objection', cost: NO_COST,
      subdivision: { road_reserves_adequate: true, widest_road_reserve_m: 30, new_road_length_m: 640 },
    })
    expect(r.statusCode).toBe(200)
    expect(Number(r.json().data.assessment.new_road_length_m)).toBe(640)
    expect(r.json().data.flags.join(' ')).toMatch(/24 m/)
  })

  maybe('once the case is decided, its referral is closed', async () => {
    await dbContext.systemOf(app.pg).query(`UPDATE spatial_planning.permit_application SET status = 'refused' WHERE id = $1`, [subId])
    expect((await call('POST', `/api/roads-works/referrals/${subCid}/reply`, 'engineer', { response_status: 'no_objection', cost: NO_COST, subdivision: { road_reserves_adequate: true } })).statusCode).toBe(409)
  })
})

describe('what Roads and Works answers', () => {
  const { isEngineeringBody } = require('../roads-works-referrals')
  test('roads, traffic, and water and sewer referrals are all the department\'s; others are not', () => {
    for (const n of ['engineering', 'Roads and Works', 'traffic', 'water_sewer', 'Engineering: roads and stormwater']) expect(isEngineeringBody(n)).toBe(true)
    for (const n of ['fire', 'environmental_health', 'survey', '', null]) expect(isEngineeringBody(n)).toBe(false)
  })
  maybe('a case near a State road (the Act\'s question, road_within_200m) is marked on the desk', async () => {
    await dbContext.systemOf(app.pg).query(`UPDATE spatial_planning.permit_application SET statutory_checks = '{"road_within_200m": true}'::jsonb WHERE id = $1`, [caseId])
    const all = (await call('GET', '/api/roads-works/referrals?state=all', 'engineer')).json().data.referrals
    expect(all.find((r) => r.id === cid).near_state_road).toBe(true)
    expect(all.find((r) => r.id === subCid).near_state_road).toBeFalsy()
  })
})
