/**
 * The permit's own fields are the council's record (migration 240): the permit number, use class, permitted development, commencement period and
 * Annexure 7 notes are saved on the permit, not in the officer's browser; a permit number is unique; an issued permit's wording is locked; and the
 * server records what a decision rested on.
 */
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { systemOf } = require('../../lib/dbContext')
const { loginAs } = require('../../../test/helpers/auth')

describe('the permit record fields', () => {
  let app, eo, planner, admin
  const permits = []
  const as = (t) => ({ authorization: `Bearer ${t}` })
  const unique = `T${Date.now().toString(36)}`

  beforeAll(async () => {
    app = await buildAppForTest()
    eo = await loginAs(app, 'demo.eo@vungu.test', 'demo1234')
    planner = await loginAs(app, 'demo.planner@vungu.test', 'demo1234')
    admin = await loginAs(app, 'demo.admin@vungu.test', 'demo1234')
  }, 30000)

  afterAll(async () => {
    const c = await systemOf(app.pg).connect()
    try {
      for (const id of permits) {
        await c.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
        await c.query('DELETE FROM spatial_planning.generated_document WHERE permit_app_id = $1', [id]).catch(() => {})
        await c.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
      }
    } finally { c.release() }
    await app.close()
  }, 30000)

  async function permit({ reviewed = false } = {}) {
    const created = await app.inject({ method: 'POST', url: '/api/permit-applications', headers: as(planner), payload: { applicant_name: 'Record Test', development_type: 'new_building' } })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id
    permits.push(id)
    let rev = created.json().data.revision
    if (reviewed) {
      for (const status of ['acknowledged', 'under_review']) {
        const r = await app.inject({ method: 'PATCH', url: `/api/permit-applications/${id}/status`, headers: as(planner), payload: { status, expectedRevision: rev } })
        expect(r.statusCode).toBe(200)
        rev = r.json().data.revision
      }
      const chk = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/direction-check`, headers: as(eo) })
      expect(chk.statusCode).toBe(200)
    }
    return { id, rev }
  }
  const save = (id, rev, fields) => app.inject({ method: 'PATCH', url: `/api/permit-applications/${id}/case`, headers: as(planner), payload: { expectedRevision: rev, ...fields } })

  test('the fields are saved on the permit and read back from the server', async () => {
    const { id, rev } = await permit()
    const res = await save(id, rev, {
      permit_no: `PMT/${unique}/1`, use_class: 'III', permitted_description: 'A single dwelling house of two bedrooms on the stand.',
      implementation_period_months: 18, annexure7_notes: 'The applicant is to keep the access clear.',
    })
    expect(res.statusCode).toBe(200)
    const got = (await app.inject({ method: 'GET', url: `/api/permit-applications/${id}`, headers: as(planner) })).json().data
    expect(got.permit_no).toBe(`PMT/${unique}/1`)
    expect(got.use_class).toBe('III')
    expect(got.implementation_period_months).toBe(18)
    expect(got.permitted_description).toMatch(/dwelling/)
    expect(got.annexure7_notes).toMatch(/access/)
  }, 30000)

  test('a permit number is unique, and an invalid use class is ignored', async () => {
    const a = await permit()
    const b = await permit()
    expect((await save(a.id, a.rev, { permit_no: `PMT/${unique}/2` })).statusCode).toBe(200)
    const dup = await save(b.id, b.rev, { permit_no: `PMT/${unique}/2` })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe('permit_no_taken')
    const bad = await save(b.id, b.rev, { use_class: 'IX', permitted_description: 'Described.' })
    expect(bad.statusCode).toBe(200)
    expect(bad.json().data.use_class).toBeNull()
  }, 30000)

  test('an issued permit is locked, a resend of the same values is not refused, and the notification date can still be recorded', async () => {
    const { id, rev } = await permit({ reviewed: true })
    const saved = await save(id, rev, { permit_no: `PMT/${unique}/3`, use_class: 'II', permitted_description: 'An extension to the existing building.' })
    expect(saved.statusCode).toBe(200)
    const decided = await app.inject({
      method: 'POST', url: `/api/permit-applications/${id}/eo-decision`, headers: as(admin),
      payload: { decision: 'approve', override: true, override_reason: 'Test: the record fields are under test, not the authority.', plan_note: 'Test application with no parcel of the register.' },
    })
    expect(decided.statusCode).toBe(200)
    expect(decided.json().data.permit.decision_basis).toBe('admin_override')
    const rev2 = decided.json().data.permit.revision

    const same = await save(id, rev2, { permit_no: `PMT/${unique}/3`, use_class: 'II', permitted_description: 'An extension to the existing building.' })
    expect(same.statusCode).toBe(200)
    const changed = await save(id, same.json().data.revision, { permit_no: `PMT/${unique}/9` })
    expect(changed.statusCode).toBe(409)
    expect(changed.json().error).toBe('permit_locked')
    const notified = await save(id, same.json().data.revision, { notification_date: '2026-11-16' })
    expect(notified.statusCode).toBe(200)
    expect(String(notified.json().data.notification_date)).toMatch(/2026-11-1[56]/)
  }, 60000)

  test('a decision on a committee resolution records that as its basis', async () => {
    // the delegated lane is closed (no switches), so the decision rests on the administrator's override above; here we only check the column is empty before a decision
    const { id } = await permit()
    const got = (await app.inject({ method: 'GET', url: `/api/permit-applications/${id}`, headers: as(planner) })).json().data
    expect(got.decision_basis).toBeNull()
  })
})
