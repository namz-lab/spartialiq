/**
 * What the Act asks of an APPROVAL, beyond the committee (working workflow, sections 4 and 5; services/eoWorkflow.js):
 *   - the questions every application raises (State road, aerodrome, neighbouring authority, agricultural subdivision, title conflict, adverse use)
 *     are answered yes or no;
 *   - each "yes" that needs another body has been referred to it, and they have replied or had their month;
 *   - public notice is complete where s.26(3) requires it;
 *   - each objection is considered, put to the applicant, and the applicant's 14 days to comment are over or used;
 * and the lane shows the dates to work to and the copies due after a subdivision. A refusal does not wait for these.
 * The decision authority is not what is under test, so an administrator's written override stands in for it.
 */
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { systemOf } = require('../../lib/dbContext')
const { loginAs } = require('../../../test/helpers/auth')
const { answerChecks } = require('../../../test/helpers/statutoryChecks')

describe('the statutory gates on an approval', () => {
  let app, eo, planner, admin
  const permits = []
  const as = (t) => ({ authorization: `Bearer ${t}` })

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
        await c.query('DELETE FROM spatial_planning.case_referral WHERE permit_app_id = $1', [id])
        await c.query('DELETE FROM spatial_planning.public_notice WHERE permit_app_id = $1', [id])
        await c.query('DELETE FROM spatial_planning.application_objection WHERE permit_app_id = $1', [id])
        await c.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
        await c.query('DELETE FROM spatial_planning.generated_document WHERE permit_app_id = $1', [id]).catch(() => {})
        await c.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
      }
    } finally { c.release() }
    await app.close()
  }, 30000)

  async function permit({ development_type = 'new_building', answered = true, answers = {} } = {}) {
    const created = await app.inject({ method: 'POST', url: '/api/permit-applications', headers: as(planner), payload: { applicant_name: 'Gate Test', development_type } })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id
    permits.push(id)
    let rev = created.json().data.revision
    for (const status of ['acknowledged', 'under_review']) {
      const r = await app.inject({ method: 'PATCH', url: `/api/permit-applications/${id}/status`, headers: as(planner), payload: { status, expectedRevision: rev } })
      expect(r.statusCode).toBe(200)
      rev = r.json().data.revision
    }
    expect((await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/direction-check`, headers: as(eo) })).statusCode).toBe(200)
    if (answered) await answerChecks(app, eo, id, answers)
    return id
  }
  const approve = (id, decision = 'approve') => app.inject({
    method: 'POST', url: `/api/permit-applications/${id}/eo-decision`, headers: as(admin),
    payload: { decision, override: true, override_reason: 'Test: the statutory gates are under test, not the authority.', plan_note: 'Test application with no parcel of the register.', notes: 'Reasons for the test.' },
  })
  const refer = (id, statutory_key, body) => app.inject({
    method: 'POST', url: '/api/eo-workflow/referrals', headers: as(eo),
    payload: { permit_app_id: id, kind: 'statutory', tier: 'mandatory', statutory_key, body, question: 'Please comment on this application (s.26(2)(c)).' },
  })
  const sys = async (sql, params) => { const c = await systemOf(app.pg).connect(); try { return await c.query(sql, params) } finally { c.release() } }

  test('an approval waits for every statutory question to be answered; a refusal does not', async () => {
    const id = await permit({ answered: false })
    const blocked = await approve(id)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('statutory_checks_required')
    expect(blocked.json().unanswered).toEqual(expect.arrayContaining(['road_within_200m', 'aviation_olz', 'title_condition_conflict']))
    const lane = (await app.inject({ method: 'GET', url: `/api/eo-workflow/lane/${id}`, headers: as(eo) })).json().data
    expect(lane.checks_unanswered.length).toBe(5)
    expect(lane.checks.map((c) => c.key)).not.toContain('agricultural_subdivision')   // asked of subdivisions only
    const refused = await approve(id, 'refuse')
    expect(refused.statusCode).toBe(200)
  }, 60000)

  test('a "yes" to the State road question needs the roads minister to have been referred to, and heard or given a month', async () => {
    const id = await permit({ answers: { road_within_200m: true } })
    const notSent = await approve(id)
    expect(notSent.statusCode).toBe(409)
    expect(notSent.json().error).toBe('statutory_referral_pending')
    expect(notSent.json().waiting[0].why).toBe('not sent')

    const sent = await refer(id, 'road', 'The minister responsible for roads')
    expect(sent.statusCode).toBe(201)
    const awaiting = await approve(id)
    expect(awaiting.statusCode).toBe(409)
    expect(awaiting.json().waiting[0].why).toMatch(/awaiting reply/)

    // their month passes with no answer: the council may go on
    await sys(`UPDATE spatial_planning.case_referral SET sent_on = CURRENT_DATE - 40 WHERE permit_app_id = $1`, [id])
    const ok = await approve(id)
    expect(ok.statusCode).toBe(200)
  }, 60000)

  test('a statutory referral must belong to a case and carry a known category', async () => {
    const noCase = await app.inject({ method: 'POST', url: '/api/eo-workflow/referrals', headers: as(eo), payload: { topic: 'x', kind: 'statutory', body: 'Roads', question: 'Q', statutory_key: 'road' } })
    expect(noCase.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'POST', url: '/api/eo-workflow/referrals', headers: as(eo), payload: { topic: 'x', kind: 'statutory', body: 'Roads', question: 'Q', statutory_key: 'moon' } })
    expect(unknown.statusCode).toBe(400)
  })

  test('public notice is required where the proposal has an adverse impact, and must be complete', async () => {
    const id = await permit({ answers: { adverse_or_nonconforming: true } })
    const none = await approve(id)
    expect(none.statusCode).toBe(409)
    expect(none.json().error).toBe('public_notice_incomplete')
    await sys(`INSERT INTO spatial_planning.public_notice (permit_app_id, advert_verified, abutting_owners_verified, site_notice_verified, objection_period_closed)
               VALUES ($1, true, true, true, false)`, [id])
    const open = await approve(id)
    expect(open.statusCode).toBe(409)
    expect(open.json().missing).toEqual(['the objection period is not closed'])
    await sys(`UPDATE spatial_planning.public_notice SET objection_period_closed = true WHERE permit_app_id = $1`, [id])
    const done = await approve(id)
    expect(done.statusCode).toBe(200)
  }, 60000)

  test('an objection is considered, put to the applicant, and the applicant has 14 days to comment', async () => {
    const id = await permit()
    const objection = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/objections`, headers: as(eo), payload: { objector_name: 'Mrs Moyo', grounds_detail: 'Loss of light' } })
    expect(objection.statusCode).toBe(201)
    const oid = objection.json().data.id

    const unconsidered = await approve(id)
    expect(unconsidered.statusCode).toBe(409)
    expect(unconsidered.json().error).toBe('objections_open')
    expect(unconsidered.json().problems.join(' ')).toMatch(/has not been considered/)

    expect((await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/consideration`, headers: as(eo), payload: { sustained: false, consideration_notes: 'Not sustained.' } })).statusCode).toBe(200)
    const notPut = await approve(id)
    expect(notPut.json().problems.join(' ')).toMatch(/not been put to the applicant/)

    // the applicant cannot comment before the objection is put to them
    const early = await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/applicant-comment`, headers: as(eo), payload: { comment: 'Too early.' } })
    expect(early.statusCode).toBe(409)

    const put = await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/put-to-applicant`, headers: as(eo) })
    expect(put.statusCode).toBe(200)
    expect(put.json().data.comment_due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const waiting = await approve(id)
    expect(waiting.statusCode).toBe(409)
    expect(waiting.json().problems.join(' ')).toMatch(/has until \d{4}-\d{2}-\d{2} to comment/)

    // the applicant comments: the 14 days need not run out
    expect((await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/applicant-comment`, headers: as(eo), payload: { comment: 'The roof line is lower than the neighbour\'s.' } })).statusCode).toBe(200)
    const ok = await approve(id)
    expect(ok.statusCode).toBe(200)
  }, 90000)

  test('with no comment, the 14 days running out is enough', async () => {
    const id = await permit()
    const oid = (await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/objections`, headers: as(eo), payload: { objector_name: 'Mr Ncube' } })).json().data.id
    await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/consideration`, headers: as(eo), payload: { sustained: false } })
    await app.inject({ method: 'PATCH', url: `/api/objections/${oid}/put-to-applicant`, headers: as(eo) })
    await sys(`UPDATE spatial_planning.application_objection SET put_to_applicant_on = CURRENT_DATE - 15 WHERE id = $1`, [oid])
    const ok = await approve(id)
    expect(ok.statusCode).toBe(200)
  }, 60000)

  test('the lane gives the dates to work to, and the copies due after a subdivision', async () => {
    const id = await permit()
    await sys(`UPDATE spatial_planning.permit_application SET acknowledged_at = DATE '2026-11-30' WHERE id = $1`, [id])
    const lane = (await app.inject({ method: 'GET', url: `/api/eo-workflow/lane/${id}`, headers: as(eo) })).json().data
    expect(lane.milestones).toEqual({ ask_extension_by: '2027-01-28', resolve_by: '2027-02-13', deemed_on: '2027-02-28' })

    const sub = await permit({ development_type: 'subdivision' })
    const subLane = (await app.inject({ method: 'GET', url: `/api/eo-workflow/lane/${sub}`, headers: as(eo) })).json().data
    expect(subLane.copies_due.map((c) => c.key)).toEqual(['surveyor_general', 'registrar'])
    expect(subLane.checks.map((c) => c.key)).toContain('agricultural_subdivision')
    expect(subLane.copies_due.every((c) => c.recorded === false)).toBe(true)
    const sg = await refer(sub, 'surveyor_general', 'The Surveyor-General')
    expect(sg.statusCode).toBe(201)
    const after = (await app.inject({ method: 'GET', url: `/api/eo-workflow/lane/${sub}`, headers: as(eo) })).json().data
    expect(after.copies_due.find((c) => c.key === 'surveyor_general').recorded).toBe(true)
  }, 60000)
})
