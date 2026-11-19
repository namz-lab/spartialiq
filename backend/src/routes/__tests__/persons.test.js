/**
 * The council's register of persons (migration 256, persons.js), through the two worked cases of the EO Planning manual:
 *
 *   - the clerk registers Mr B. Phiri at the counter, his ID sighted; the same ID written another way is the same person,
 *     and a second registration is refused with his record;
 *   - Mrs L. Hlongwane shares a phone number with someone already registered: the clerk is shown them first, and registers
 *     her as new only on saying so;
 *   - the objector Mr J. Khumalo is registered and his objection is linked to him; it leaves the "not yet linked" list;
 *   - identity numbers are masked except to the posts that register people, and a malformed one is refused.
 *
 * Everything made here is removed afterwards.
 */
require('dotenv').config()
// These cases are about the register itself; the Registrar-General check has its own suite (person-assurance.test.js).
process.env.RG_MODE = 'off'
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { personsRoutes, maskId, formatId, wellFormed } = require('../persons')
const { developmentManagementRoutes } = require('../development-management')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')

const clerk = { id: randomUUID(), role: 'planning_clerk' }
const planner = { id: randomUUID(), role: 'planner' }
let app, sys, applied = true
const sessions = []
const persons = []
const cases = []

const as = (who) => (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${who.token}` } })
const tag = randomUUID().slice(0, 6)
const PHIRI_ID = `63-${String(Date.now()).slice(-7)} X 27`

beforeAll(async () => {
  app = Fastify({ logger: process.env.JEST_LOG ? { level: "error" } : false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(personsRoutes, { prefix: '/api' })
  await app.register(developmentManagementRoutes, { prefix: '/api' })
  await app.ready()
  sys = dbContext.systemOf(app.pg)
  applied = (await sys.query(`SELECT to_regclass('registry.person') IS NOT NULL AS ok`)).rows[0].ok
  if (!applied) return
  for (const u of [clerk, planner]) {
    u.email = `jesttest-persons-${u.id}@example.test`
    await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest Persons', 'Jest Persons', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)`,
      [u.id, u.email, u.role])
    const s = await createSession(app, { id: u.id, role: u.role, email: u.email }, null)
    u.token = s.accessToken
    sessions.push(s.sid)
  }
}, 60000)

afterAll(async () => {
  if (applied) {
    for (const id of cases) {
      await sys.query('DELETE FROM spatial_planning.application_objection WHERE permit_app_id = $1', [id])
      await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
      await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
    }
    await sys.query('DELETE FROM registry.person WHERE id = ANY($1::uuid[])', [persons])
    for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
    await sys.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[clerk.id, planner.id]])
  }
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!applied) return console.warn('migration 256 not applied: skipped'); await fn() })

test('identity numbers: read however written, shown masked or in full', () => {
  expect(wellFormed('national_id', '63-123456 X 27')).toBe(true)
  expect(wellFormed('national_id', '631234567x27')).toBe(true)
  expect(wellFormed('national_id', '63-12345 X 27')).toBe(false)
  expect(formatId('national_id', '631234567X27')).toBe('63-1234567 X 27')
  expect(maskId('national_id', '631234567X27')).toBe('63-•••••••X27')
})

maybe('Mr Phiri is registered at the counter, his ID seen; the same ID again is the same person', async () => {
  const clerkCall = as(clerk)
  const res = await clerkCall('POST', '/api/persons', {
    title: 'Mr', first_names: 'Bernard', surname: `Phiri${tag}`, phone: `+263 77 ${tag.replace(/\D/g, '1').padEnd(7, '1').slice(0, 7)}`,
    physical_address: 'Stand 1378, Vungu', preferred_channel: 'sms',
    identifiers: [{ kind: 'national_id', value: PHIRI_ID }], verified: true, verified_how: 'National ID card seen at the counter',
  })
  expect(res.statusCode).toBe(201)
  const p = res.json().data.person
  persons.push(p.id)
  expect(p).toMatchObject({ display_name: `Mr Bernard Phiri${tag}`, verified: true, source: 'counter', assurance_level: 3, level_label: 'Original sighted' })
  expect(p.identifiers[0]).toMatchObject({ kind: 'national_id', masked: false })

  const again = await clerkCall('POST', '/api/persons', {
    surname: 'Phiri', identifiers: [{ kind: 'national_id', value: PHIRI_ID.replace(/[-\s]/g, '').toLowerCase() }],
  })
  expect(again.statusCode).toBe(409)
  expect(again.json()).toMatchObject({ error: 'already_registered' })
  expect(again.json().data.persons[0].id).toBe(p.id)

  const found = await clerkCall('GET', `/api/persons/search?q=${encodeURIComponent(PHIRI_ID.replace(/\s/g, ''))}`)
  expect(found.json().data.searched_as).toBe('national_id')
  expect(found.json().data.persons.map((x) => x.id)).toEqual([p.id])
  expect(found.json().data.persons[0].identifiers[0].masked).toBe(true)
})

maybe('the ID is masked to a planner and revealed to the clerk, who is logged', async () => {
  const [id] = persons
  const plannerSees = await as(planner)('GET', `/api/persons/${id}`)
  expect(plannerSees.json().data.person.identifiers[0].value).toMatch(/•/)
  expect((await as(planner)('GET', `/api/persons/${id}?reveal=1`)).statusCode).toBe(403)
  const clerkSees = await as(clerk)('GET', `/api/persons/${id}?reveal=1`)
  expect(clerkSees.json().data.person.identifiers[0].value).toBe(formatId('national_id', PHIRI_ID.replace(/[-\s]/g, '')))
})

maybe('Mrs Hlongwane shares a phone with someone registered: shown them first, registered as new on saying so', async () => {
  const clerkCall = as(clerk)
  const phone = '+263 71 555 0' + tag.replace(/\D/g, '7').padEnd(3, '7').slice(0, 3)
  const first = await clerkCall('POST', '/api/persons', { title: 'Mr', surname: `Moyo${tag}`, phone })
  expect(first.statusCode).toBe(201)
  persons.push(first.json().data.person.id)

  const hers = { title: 'Mrs', first_names: 'Lindiwe', surname: `Hlongwane${tag}`, phone, physical_address: 'Stand 1379, Gweru road' }
  const warned = await clerkCall('POST', '/api/persons', hers)
  expect(warned.statusCode).toBe(409)
  expect(warned.json()).toMatchObject({ error: 'possible_duplicate' })
  expect(warned.json().data.persons[0]).toMatchObject({ match: 'phone' })

  const made = await clerkCall('POST', '/api/persons', { ...hers, confirm_new: true })
  expect(made.statusCode).toBe(201)
  expect(made.json().data.person).toMatchObject({ verified: false, preferred_channel: 'post', assurance_level: 0 })
  persons.push(made.json().data.person.id)
})

maybe('a malformed ID, a verification with no document named, and an individual with no surname are refused', async () => {
  const clerkCall = as(clerk)
  const bad = await clerkCall('POST', '/api/persons', { surname: 'Ncube', identifiers: [{ kind: 'national_id', value: '12-34' }] })
  expect(bad.statusCode).toBe(400)
  expect(bad.json().message).toMatch(/national ID does not read as one/)
  const unsaid = await clerkCall('POST', '/api/persons', { surname: 'Ncube', verified: true })
  expect(unsaid.statusCode).toBe(400)
  expect((await clerkCall('POST', '/api/persons', { first_names: 'Nobody' })).statusCode).toBe(400)
  expect((await as(planner)('GET', '/api/persons/search?q=a')).statusCode).toBe(400)
})

maybe("Mr Khumalo's objection is linked to him, and leaves the list of records not yet linked", async () => {
  const clerkCall = as(clerk)
  const caseId = (await sys.query(
    `INSERT INTO spatial_planning.permit_application (applicant_name, development_type, status, authority_id, stand_number)
     VALUES ($1, 'change_of_use', 'registered', 1, '1379') RETURNING id`, [`Mrs L. Hlongwane${tag}`])).rows[0].id
  cases.push(caseId)
  const hlongwane = persons[2]
  expect((await clerkCall('PUT', `/api/permit-applications/${caseId}/applicant-person`, { person_id: hlongwane })).statusCode).toBe(200)

  const k = await clerkCall('POST', '/api/persons', { title: 'Mr', first_names: 'J.', surname: `Khumalo${tag}`, physical_address: 'Stand 1380' })
  expect(k.statusCode).toBe(201)
  const khumalo = k.json().data.person.id
  persons.push(khumalo)

  const obj = await clerkCall('POST', `/api/permit-applications/${caseId}/objections`, {
    objector_name: `Mr J. Khumalo${tag}`, objector_person_id: khumalo, grounds: ['noise', 'traffic_impact'], grounds_detail: 'No parking.',
  })
  expect(obj.statusCode).toBe(201)
  expect(obj.json().data).toMatchObject({ objector_person_id: khumalo, objector_name: `Mr J. Khumalo${tag}` })

  const record = (await clerkCall('GET', `/api/persons/${khumalo}`)).json().data
  expect(record.person.appears_as).toMatchObject({ objections: 1, applications: 0 })
  expect(record.objections[0]).toMatchObject({ permit_app_id: caseId, stand_number: '1379' })
  expect((await clerkCall('GET', `/api/persons/${hlongwane}`)).json().data.applications.map((a) => a.id)).toEqual([caseId])

  const unlinked = (await clerkCall('GET', '/api/persons/unlinked')).json().data.records
  expect(unlinked.some((r) => r.record_id === caseId || r.name_as_written === `Mr J. Khumalo${tag}`)).toBe(false)

  const nobody = await clerkCall('PUT', `/api/permit-applications/${caseId}/applicant-person`, { person_id: randomUUID() })
  expect(nobody.statusCode).toBe(404)
})

maybe('the counter records that an unverified person\'s ID was seen', async () => {
  const hlongwane = persons[2]
  const clerkCall = as(clerk)
  const noId = await clerkCall('PATCH', `/api/persons/${hlongwane}`, { verified: true, verified_how: 'National ID card' })
  expect(noId.statusCode).toBe(409)
  const ok = await clerkCall('PATCH', `/api/persons/${hlongwane}`, {
    verified: true, verified_how: 'National ID card', identifiers: [{ kind: 'national_id', value: `08-${String(Date.now()).slice(-7)}K08` }],
    preferred_channel: 'sms',
  })
  expect(ok.statusCode).toBe(200)
  expect(ok.json().data.person).toMatchObject({ verified: true, preferred_channel: 'sms', assurance_level: 3 })
})
