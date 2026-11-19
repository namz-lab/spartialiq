/**
 * One register, four levels (migration 257), and the PROTOTYPE Registrar-General service (migration 258).
 *
 *   - the prototype answers whether particulars agree, never what the register holds; a key is needed; each kind of
 *     answer (match, initials only, a surname that differs, no such document, a deceased holder, a stolen or expired
 *     passport) is given;
 *   - the clerk registers Mrs Hlongwane with her ID seen, the Registrar-General agrees: level 3;
 *   - a cashier registers someone at level 0, and may not record an ID as seen nor raise a level;
 *   - an ID the Registrar-General records in a dead man's name cannot verify anyone;
 *   - a copy approved online and a proof of residence make level 2; the original seen at the counter makes level 3;
 *   - a citizen signing up online joins the register at level 0, and the Registrar-General is asked about the ID they gave;
 *   - the history of a person's verification cannot be rewritten.
 *
 * Uses the prototype's fictional people. Everything made here is removed afterwards.
 */
require('dotenv').config()
process.env.RG_MODE = 'prototype'
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { personsRoutes } = require('../persons')
const { registrarGeneralPrototypeRoutes } = require('../registrar-general-prototype')
const { createSession } = require('../../middleware/jwtAuth')
const dbContext = require('../../lib/dbContext')
const assurance = require('../../services/personAssurance')

const KEY = 'rg-prototype-vungu-demo-key'
const HLONGWANE = '08-2345678 K 08'
const KHUMALO = '63-3011223 Q 63'
const MOYO_DECEASED = '63-2222333 B 27'
const NCUBE = '29-7654321 C 29'

const clerk = { id: randomUUID(), role: 'planning_clerk' }
const cashier = { id: randomUUID(), role: 'cashier' }
let app, sys, ready = true
const sessions = []
const persons = []
const users = []

const as = (who) => (method, url, payload) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${who.token}` } })
const rgAsk = (payload, key = KEY) => app.inject({ method: 'POST', url: '/api/rg-prototype/v1/verifications', payload, headers: key ? { 'x-rg-client-key': key } : {} })

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(personsRoutes, { prefix: '/api' })
  await app.register(registrarGeneralPrototypeRoutes, { prefix: '/api' })
  await app.ready()
  sys = dbContext.systemOf(app.pg)
  const st = (await sys.query(`SELECT to_regclass('rg_prototype.population_register') IS NOT NULL AS rg,
                                      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'registry' AND column_name = 'assurance_level') AS levels`)).rows[0]
  ready = st.rg && st.levels
  if (!ready) return
  // The fictional IDs must be free in this database's register, or the cases below would collide with a demonstration.
  const taken = (await sys.query(
    `SELECT value FROM registry.person_identifier WHERE value = ANY($1)`,
    [[HLONGWANE, KHUMALO, MOYO_DECEASED, NCUBE].map((v) => v.replace(/[^A-Za-z0-9]/g, ''))])).rows
  if (taken.length) { ready = false; console.warn('prototype IDs already registered here: skipped', taken); return }
  for (const u of [clerk, cashier]) {
    u.email = `jesttest-assure-${u.id}@example.test`
    await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest Assure', 'Jest Assure', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)`,
      [u.id, u.email, u.role])
    const s = await createSession(app, { id: u.id, role: u.role, email: u.email }, null)
    u.token = s.accessToken
    sessions.push(s.sid)
    users.push(u.id)
  }
}, 60000)

afterAll(async () => {
  if (sys) {
    await sys.query('UPDATE users SET person_id = NULL WHERE id = ANY($1::uuid[])', [users])
    await sys.query('DELETE FROM registry.person WHERE id = ANY($1::uuid[])', [persons])
    for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
    await sys.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users])
  }
  await app.close()
}, 60000)

const maybe = (name, fn) => test(name, async () => { if (!ready) return console.warn('migrations 257/258 not applied here: skipped'); await fn() })

describe('the Registrar-General prototype', () => {
  maybe('says what it is, and refuses a client without a key', async () => {
    const st = await app.inject({ method: 'GET', url: '/api/rg-prototype/v1/status' })
    expect(st.json()).toMatchObject({ status: 'up' })
    expect(st.json().notice).toMatch(/fictional/)
    expect((await rgAsk({ document_type: 'national_id', document_number: HLONGWANE, surname: 'Hlongwane', purpose: 'demonstration' }, null)).statusCode).toBe(401)
    expect((await rgAsk({ document_type: 'national_id', document_number: HLONGWANE, surname: 'Hlongwane', purpose: 'demonstration' }, 'not-a-real-key')).statusCode).toBe(401)
    const noName = await rgAsk({ document_type: 'national_id', document_number: HLONGWANE, purpose: 'demonstration' })
    expect(noName.statusCode).toBe(400)
    expect(noName.json().message).toMatch(/surname is required/)
  })

  maybe('answers whether particulars agree, and never what the register holds', async () => {
    const full = (await rgAsk({ document_type: 'national_id', document_number: '082345678k08', surname: 'hlongwane', first_names: 'Lindiwe', date_of_birth: '1985-09-03', purpose: 'demonstration' })).json()
    expect(full).toMatchObject({ document_found: true, document_status: 'valid', outcome: 'match', fields: { surname: 'match', first_names: 'match', date_of_birth: 'match' } })
    expect(full.reference).toMatch(/^RGV-\d{4}-\d{6}$/)
    // Nothing of the register's own comes back: no date of birth, place of birth or sex.
    expect(Object.keys(full).sort()).toEqual(['checked_at', 'document_found', 'document_status', 'document_type', 'fields', 'outcome', 'reference'])

    const initials = (await rgAsk({ document_type: 'national_id', document_number: KHUMALO, surname: 'Khumalo', first_names: 'J.', purpose: 'demonstration' })).json()
    expect(initials).toMatchObject({ outcome: 'partial', fields: { first_names: 'partial', date_of_birth: 'not_supplied' } })

    const other = (await rgAsk({ document_type: 'national_id', document_number: KHUMALO, surname: 'Phiri', purpose: 'demonstration' })).json()
    expect(other).toMatchObject({ outcome: 'no_match', fields: { surname: 'no_match' } })

    expect((await rgAsk({ document_type: 'national_id', document_number: '99-9999999 Z 99', surname: 'Nobody', purpose: 'demonstration' })).json())
      .toMatchObject({ document_found: false, outcome: 'not_found', fields: {} })
    expect((await rgAsk({ document_type: 'national_id', document_number: MOYO_DECEASED, surname: 'Moyo', purpose: 'demonstration' })).json())
      .toMatchObject({ document_status: 'holder_deceased' })
    expect((await rgAsk({ document_type: 'passport', document_number: 'FN777888', surname: 'Ncube', purpose: 'demonstration' })).json())
      .toMatchObject({ document_status: 'reported_lost_or_stolen' })
    expect((await rgAsk({ document_type: 'passport', document_number: 'FN654321', surname: 'Hlongwane', purpose: 'demonstration' })).json())
      .toMatchObject({ document_status: 'expired', outcome: 'partial' })
  })
})

describe('one register, four levels', () => {
  maybe('the clerk registers Mrs Hlongwane with her ID seen; the Registrar-General agrees: level 3', async () => {
    const res = await as(clerk)('POST', '/api/persons', {
      title: 'Mrs', first_names: 'Lindiwe', surname: 'Hlongwane', date_of_birth: '1985-09-03', physical_address: 'Stand 1379',
      identifiers: [{ kind: 'national_id', value: HLONGWANE }], verified: true, verified_how: 'National ID card, original',
    })
    expect(res.statusCode).toBe(201)
    const p = res.json().data.person
    persons.push(p.id)
    expect(res.json().data.warning).toBeNull()
    expect(p).toMatchObject({ assurance_level: 3, level_label: 'Original sighted', resident: false, identity_method: 'original_sighted' })
    expect(p.registrar_general).toMatchObject({ outcome: 'match', document_status: 'valid', service: 'prototype', blocks: null })

    const record = (await as(clerk)('GET', `/api/persons/${p.id}`)).json().data
    expect(record.history.map((e) => e.event).sort()).toEqual(['original_sighted', 'registered'])
    expect(record.registrar_general_checks[0].rg_reference).toMatch(/^RGV-/)
  })

  maybe('a cashier registers at level 0, and may not record an ID as seen nor raise a level', async () => {
    const seen = await as(cashier)('POST', '/api/persons', {
      surname: 'Khumalo', first_names: 'Jabulani', identifiers: [{ kind: 'national_id', value: KHUMALO }], verified: true, verified_how: 'ID card',
    })
    expect(seen.statusCode).toBe(403)
    expect(seen.json().message).toMatch(/Only the planning clerk/)
    const made = await as(cashier)('POST', '/api/persons', {
      title: 'Mr', surname: 'Khumalo', first_names: 'Jabulani', date_of_birth: '1962-01-20', physical_address: 'Stand 1380',
      identifiers: [{ kind: 'national_id', value: KHUMALO }],
    })
    expect(made.statusCode).toBe(201)
    const p = made.json().data.person
    persons.push(p.id)
    expect(p).toMatchObject({ assurance_level: 0, level_label: 'Recorded' })
    // the Registrar-General was asked even so: the clerk will see the answer
    expect(p.registrar_general).toMatchObject({ outcome: 'match' })
    expect((await as(cashier)('POST', `/api/persons/${p.id}/assurance`, { step: 'original_sighted', how: 'ID card' })).statusCode).toBe(403)

    // the clerk sees the original, and proves residence with a title deed
    const orig = await as(clerk)('POST', `/api/persons/${p.id}/assurance`, { step: 'original_sighted', how: 'National ID card, original' })
    expect(orig.json().data.person).toMatchObject({ assurance_level: 3, resident: false })
    const res = await as(clerk)('POST', `/api/persons/${p.id}/assurance`, { step: 'residency', evidence: 'title_deed', how: 'Deed 1234/1998, Stand 1380' })
    expect(res.json().data.person).toMatchObject({ assurance_level: 3, resident: true })
    const again = await as(clerk)('POST', `/api/persons/${p.id}/assurance`, { step: 'residency', evidence: 'title_deed', how: 'Deed 1234/1998' })
    expect(again.statusCode).toBe(409)
    expect((await as(clerk)('POST', `/api/persons/${p.id}/assurance`, { step: 'residency', evidence: 'a_hunch', how: 'trust me' })).statusCode).toBe(400)
  })

  maybe("an ID the Registrar-General records in a dead man's name cannot verify anyone", async () => {
    const res = await as(clerk)('POST', '/api/persons', {
      title: 'Mr', first_names: 'Tendai', surname: 'Moyo', identifiers: [{ kind: 'national_id', value: MOYO_DECEASED }],
      verified: true, verified_how: 'National ID card, original',
    })
    expect(res.statusCode).toBe(201)
    persons.push(res.json().data.person.id)
    expect(res.json().data.warning).toMatch(/deceased/)
    expect(res.json().data.person.assurance_level).toBe(0)
    const later = await as(clerk)('POST', `/api/persons/${res.json().data.person.id}/assurance`, { step: 'original_sighted', how: 'ID card' })
    expect(later.statusCode).toBe(409)
    expect(later.json().message).toMatch(/deceased/)
  })

  maybe('a copy approved online and a proof of residence make level 2', async () => {
    const id = (await sys.query(
      `INSERT INTO registry.person (authority_id, surname, first_names, source) VALUES (1, 'Jestlevel', 'Two', 'online') RETURNING id`)).rows[0].id
    persons.push(id)
    const level = async () => (await sys.query('SELECT assurance_level FROM registry.person WHERE id = $1', [id])).rows[0].assurance_level
    await assurance.verifyResidency(sys, id, { method: 'document_review', evidence: 'Rates statement', by: clerk.id, role: 'planning_clerk' })
    expect(await level()).toBe(0) // residence alone is not identity
    await assurance.verifyIdentity(sys, id, { method: 'copy_approved', how: 'Copy of the national ID approved online', by: clerk.id, role: 'planning_clerk' })
    expect(await level()).toBe(2)
  })

  maybe('a citizen signing up online joins the register at level 0, and the Registrar-General is asked', async () => {
    const uid = randomUUID()
    users.push(uid)
    const user = (await sys.query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, national_id)
       VALUES ($1, $2, 'Sibongile Ncube', 'Sibongile Ncube', 'registered', true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', $3)
       RETURNING id, email, full_name AS name, role, phone, national_id, physical_address`,
      [uid, `jesttest-online-${uid}@example.test`, NCUBE])).rows[0]
    const r = await assurance.fromOnlineSignUp(sys, app.pg, user)
    expect(r).toMatchObject({ linked: true, id_already_registered: false })
    persons.push(r.person_id)
    const p = (await sys.query('SELECT source, assurance_level FROM registry.person WHERE id = $1', [r.person_id])).rows[0]
    expect(p).toEqual({ source: 'online', assurance_level: 0 })
    expect((await sys.query('SELECT person_id FROM users WHERE id = $1', [uid])).rows[0].person_id).toBe(r.person_id)
    const c = (await sys.query('SELECT outcome, fields, purpose FROM registry.identity_check WHERE person_id = $1', [r.person_id])).rows[0]
    // "Sibongile" against SIBONGILE THANDEKA: the first name agrees, the second was not given
    expect(c).toMatchObject({ outcome: 'partial', purpose: 'online_verification', fields: { surname: 'match', first_names: 'partial' } })
  })

  maybe('the history of a verification cannot be rewritten', async () => {
    await expect(sys.query(`UPDATE registry.assurance_event SET evidence = 'changed' WHERE person_id = $1`, [persons[0]]))
      .rejects.toThrow(/kept as it was recorded/)
  })
})
