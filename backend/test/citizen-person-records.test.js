/**
 * Records follow the person (src/lib/caseAccess.js): a case the planning office lodged at the counter for a person in
 * the register, and their objection, appear in that person's own portal, but only once the council is sure who they
 * are (assurance level 1). Pinned here:
 *   - at level 0 the account sees neither the case nor the objection, and is told why;
 *   - at level 1 the case is in their list (marked as lodged for them), opens, and its history reads; the objection is
 *     listed under their records;
 *   - another citizen still gets 404 for the case;
 *   - the staff list is unchanged.
 * Everything made here is removed afterwards.
 */
const { randomUUID } = require('node:crypto')
const { buildAppForTest } = require('./helpers/buildApp')
const { systemOf } = require('../src/lib/dbContext')
const { loginAs } = require('./helpers/auth')
const { createSession } = require('../src/middleware/jwtAuth')

describe('records follow the person', () => {
  let app, sys, planner, authorityId, permitId, objectionId, personId
  const resident = { id: randomUUID(), role: 'registered' }
  const stranger = { id: randomUUID(), role: 'registered' }
  const sessions = []

  const as = (who) => (method, url, payload) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${who.token}` } })

  beforeAll(async () => {
    app = await buildAppForTest()
    sys = systemOf(app.pg)
    planner = await loginAs(app, 'demo.planner@vungu.test', 'demo1234')
    authorityId = (await sys.query(`SELECT authority_id FROM users WHERE email = 'demo.planner@vungu.test'`)).rows[0].authority_id

    // The resident: in the register at level 0 (a name as given), with an online account linked to the record.
    personId = (await sys.query(
      `INSERT INTO registry.person (kind, surname, first_names, source, authority_id)
       VALUES ('individual', 'Jesttest', 'Records', 'counter', $1) RETURNING id`, [authorityId])).rows[0].id
    for (const u of [resident, stranger]) {
      u.email = `jesttest-records-${u.id}@example.test`
      await sys.query(
        `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id, person_id)
         VALUES ($1, $2, 'Jest Records', 'Jest Records', $3, true, 'active',
                 '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', $4, $5)`,
        [u.id, u.email, u.role, authorityId, u === resident ? personId : null])
      const s = await createSession(app, { id: u.id, role: u.role, email: u.email }, null)
      u.token = s.accessToken
      sessions.push(s.sid)
    }

    // The planning office lodges a case for them at the counter, and records their objection on it.
    const created = await app.inject({ method: 'POST', url: '/api/permit-applications', headers: { authorization: `Bearer ${planner}` },
      payload: { applicant_name: 'Records Jesttest', development_type: 'new_building', stand_number: 'JESTTEST-REC', applicant_person_id: personId } })
    expect(created.statusCode).toBe(201)
    permitId = created.json().data.id
    objectionId = (await sys.query(
      `INSERT INTO spatial_planning.application_objection (permit_app_id, objector_name, objector_person_id, grounds)
       VALUES ($1, 'Records Jesttest', $2, '["test"]'::jsonb) RETURNING id`, [permitId, personId])).rows[0].id
  }, 60000)

  afterAll(async () => {
    if (sys) {
      if (objectionId) await sys.query('DELETE FROM spatial_planning.application_objection WHERE id = $1', [objectionId])
      if (permitId) {
        await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [permitId])
        await sys.query('DELETE FROM spatial_planning.generated_document WHERE permit_app_id = $1', [permitId]).catch(() => {})
        await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [permitId])
      }
      for (const sid of sessions) await sys.query('DELETE FROM public.user_session WHERE id = $1', [sid])
      await sys.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[resident.id, stranger.id]])
      if (personId) await sys.query('DELETE FROM registry.person WHERE id = $1', [personId])
    }
    if (app) await app.close()
  }, 30000)

  const listIds = async (who) => {
    const res = await as(who)('GET', '/api/permit-applications?limit=200')
    expect(res.statusCode).toBe(200)
    return res.json().data.map((p) => p.id)
  }

  test('at level 0 the resident sees neither the case nor the objection, and is told why', async () => {
    expect(await listIds(resident)).not.toContain(permitId)
    expect((await as(resident)('GET', `/api/permit-applications/${permitId}`)).statusCode).toBe(404)
    const mine = (await as(resident)('GET', '/api/persons/me/records')).json().data
    expect(mine).toMatchObject({ shown: false, reason: 'identity_not_verified', level: 0, objections: [], receipts: [] })
  })

  test('once their identity is verified, the case and the objection are theirs to see', async () => {
    await sys.query(`UPDATE registry.person SET verified_at = now(), identity_method = 'copy_approved', verified_how = 'copy of national ID approved (test)' WHERE id = $1`, [personId])

    const list = (await as(resident)('GET', '/api/permit-applications?limit=200')).json().data
    const row = list.find((p) => p.id === permitId)
    expect(row).toBeTruthy()
    expect(row.lodged_for_you).toBe(true)

    expect((await as(resident)('GET', `/api/permit-applications/${permitId}`)).statusCode).toBe(200)
    expect((await as(resident)('GET', `/api/permit-applications/${permitId}/events`)).statusCode).toBe(200)

    const mine = (await as(resident)('GET', '/api/persons/me/records')).json().data
    expect(mine.shown).toBe(true)
    expect(mine.level).toBe(1)
    expect(mine.objections.map((o) => o.id)).toContain(objectionId)
  })

  test('another citizen still cannot see the case', async () => {
    expect(await listIds(stranger)).not.toContain(permitId)
    expect((await as(stranger)('GET', `/api/permit-applications/${permitId}`)).statusCode).toBe(404)
    expect((await as(stranger)('GET', `/api/permit-applications/${permitId}/events`)).statusCode).toBe(404)
    const theirs = (await as(stranger)('GET', '/api/persons/me/records')).json().data
    expect(theirs).toMatchObject({ shown: false, reason: 'not_in_register' })
  })

  test('the staff list is unchanged and never marks a case as lodged for the officer', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/permit-applications?limit=200&search=Records%20Jesttest',
      headers: { authorization: `Bearer ${planner}` } })).json().data
    const row = list.find((p) => p.id === permitId)
    expect(row).toBeTruthy()
    expect(row.lodged_for_you).toBe(false)
  })
})
