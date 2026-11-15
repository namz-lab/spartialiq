/**
 * The gates on a determination (POST /permit-applications/:id/eo-decision), as the EO Planning working workflow sets them
 * (docs/workflows/eo-planning-working-workflow.md; services/eoWorkflow.js):
 *   - a determination rests on a committee resolution that MATCHES it, recorded at a quorate meeting;
 *   - the EO's own (delegated) lane is closed until the council's confirmations are recorded as switches S1 and S3 (and S5 to refuse);
 *   - a subdivision, consolidation or rezoning is decided only when the Minister's instrument is recorded (S2);
 *   - the case has been checked against the ministerial directions (step 5), and none that applies is in force;
 *   - an approval after the deemed-refusal date is refused, counted to any extension the applicant gave in writing;
 *   - a refusal gives written reasons.
 */
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { systemOf } = require('../../lib/dbContext')   // fixtures use the system connection (TENANCY_MODE=strict has no request context)
const { loginAs } = require('../../../test/helpers/auth')

describe('the gates on eo-decision', () => {
  let app, eo, planner, admin
  const permits = []
  const meetings = []
  const members = []
  const directions = []

  const as = (token) => ({ authorization: `Bearer ${token}` })

  async function setSwitch(key, is_on, evidence = 'Council resolution 12/2026, 4 August 2026 (test)') {
    const r = await app.inject({ method: 'PUT', url: `/api/eo-workflow/switches/${key}`, headers: as(admin), payload: { is_on, evidence } })
    expect(r.statusCode).toBe(200)
  }
  async function allSwitchesOff() { for (const k of ['S1', 'S2', 'S3', 'S5']) await setSwitch(k, false, null) }

  beforeAll(async () => {
    app = await buildAppForTest()
    eo = await loginAs(app, 'demo.eo@vungu.test', 'demo1234')
    planner = await loginAs(app, 'demo.planner@vungu.test', 'demo1234')
    admin = await loginAs(app, 'demo.admin@vungu.test', 'demo1234')
    await allSwitchesOff()
  }, 30000)

  afterAll(async () => {
    const c = await systemOf(app.pg).connect()
    try {
      await allSwitchesOff().catch(() => {})
      for (const id of directions) await c.query(`DELETE FROM spatial_planning.ministerial_direction WHERE id = $1`, [id])
      for (const id of meetings) await c.query(`DELETE FROM spatial_planning.committee_meeting WHERE id = $1`, [id])
      for (const id of members) await c.query(`DELETE FROM spatial_planning.committee_member WHERE id = $1`, [id])
      for (const id of permits) {
        await c.query(`DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1`, [id])
        await c.query(`DELETE FROM spatial_planning.permit_application WHERE id = $1`, [id])
      }
    } finally { c.release() }
    await app.close()
  }, 30000)

  // A permit driven to under_review (a lawful from-status for a decision). `checked` records the direction check, as the EO does at step 5.
  async function permitUnderReview({ checked = true, development_type = 'new_building' } = {}) {
    const created = await app.inject({
      method: 'POST', url: '/api/permit-applications', headers: as(planner),
      payload: { applicant_name: 'Committee Test', development_type },
    })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id
    permits.push(id)
    let rev = created.json().data.revision
    for (const step of ['acknowledged', 'under_review']) {
      const r = await app.inject({ method: 'PATCH', url: `/api/permit-applications/${id}/status`, headers: as(planner), payload: { status: step, expectedRevision: rev } })
      expect([200, 201]).toContain(r.statusCode)
      rev = r.json().data.revision
    }
    if (checked) await checkDirections(id)
    return id
  }
  async function checkDirections(id) {
    const r = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/direction-check`, headers: as(eo) })
    expect(r.statusCode).toBe(200)
  }
  const decide = (id, payload, token = eo) => app.inject({
    method: 'POST', url: `/api/permit-applications/${id}/eo-decision`, headers: as(token),
    payload: { plan_note: 'Test application with no parcel of the register.', ...payload },
  })

  // Table the case at a meeting, make the meeting quorate and record the committee's outcome.
  async function resolve(id, outcome, resolution = 'Resolved at the test meeting.') {
    const mtg = await app.inject({ method: 'POST', url: '/api/committee-meetings', headers: as(planner), payload: { title: 'Jest TPC', meeting_date: '2026-08-01', quorum: 2 } })
    expect(mtg.statusCode).toBe(201)
    const meetingId = mtg.json().data.id
    meetings.push(meetingId)
    const item = await app.inject({ method: 'POST', url: `/api/committee-meetings/${meetingId}/agenda`, headers: as(planner), payload: { permit_app_id: id, purpose: 'determination' } })
    expect(item.statusCode).toBe(201)
    const agendaItemId = item.json().data.id
    const early = await app.inject({ method: 'PATCH', url: `/api/agenda-items/${agendaItemId}`, headers: as(eo), payload: { outcome, resolution } })
    expect(early.statusCode).toBe(409)
    expect(early.json().error).toBe('quorum_not_met')
    for (const name of ['Cllr A', 'Cllr B']) {
      const mem = await app.inject({ method: 'POST', url: '/api/committee-members', headers: as(planner), payload: { full_name: name, title: 'Councillor' } })
      expect(mem.statusCode).toBe(201)
      members.push(mem.json().data.id)
      const att = await app.inject({ method: 'POST', url: `/api/committee-meetings/${meetingId}/attendance`, headers: as(planner), payload: { member_id: mem.json().data.id, status: 'present' } })
      expect(att.statusCode).toBe(201)
    }
    const rec = await app.inject({ method: 'PATCH', url: `/api/agenda-items/${agendaItemId}`, headers: as(eo), payload: { outcome, resolution } })
    expect(rec.statusCode).toBe(200)
  }

  test('a decision is blocked without a committee resolution', async () => {
    const id = await permitUnderReview()
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('committee_resolution_required')
  })

  test('a registered case cannot skip acknowledgement on the way to review', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/permit-applications', headers: as(planner), payload: { applicant_name: 'Skip Test', development_type: 'new_building' } })
    expect(created.statusCode).toBe(201)
    permits.push(created.json().data.id)
    const jump = await app.inject({
      method: 'PATCH', url: `/api/permit-applications/${created.json().data.id}/status`, headers: as(planner),
      payload: { status: 'under_review', expectedRevision: created.json().data.revision },
    })
    expect(jump.statusCode).toBe(409)
    expect(jump.json().error).toBe('invalid_transition')
    expect(jump.json().allowed).toContain('acknowledged')
    expect(jump.json().allowed).not.toContain('under_review')
  }, 30000)

  test('a case that was never acknowledged is not decided, because its clock has not started', async () => {
    const id = await permitUnderReview()
    const c = await systemOf(app.pg).connect()
    try { await c.query('UPDATE spatial_planning.permit_application SET acknowledged_at = NULL WHERE id = $1', [id]) } finally { c.release() }
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('not_acknowledged')
  }, 30000)

  test('a decision needs the direction check to have been recorded', async () => {
    const id = await permitUnderReview({ checked: false })
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('direction_check_required')
  }, 30000)

  test('a typed "delegated authority" no longer stands in for a resolution while the switches are off', async () => {
    const id = await permitUnderReview()
    const res = await decide(id, { decision: 'approve', delegated_authority: 'Minor works — decided under delegated authority.' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('delegation_not_open')
    expect(res.json().reasons.join(' ')).toMatch(/S1/)
    expect(res.json().reasons.join(' ')).toMatch(/S3/)
  }, 30000)

  test('with S1 and S3 on, the EO may decide an unopposed case alone; a refusal also needs S5', async () => {
    await setSwitch('S1', true)
    await setSwitch('S3', true)
    try {
      const id = await permitUnderReview()
      const ok = await decide(id, { decision: 'approve', delegated_authority: 'Council resolution 12/2026, delegation to the EO' })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().data.permit.status).toBe('approved')
      expect(ok.json().data.permit.delegation_basis).toMatch(/12\/2026/)

      const id2 = await permitUnderReview()
      const refused = await decide(id2, { decision: 'refuse', notes: 'The use is not permitted in this zone.', delegated_authority: 'Council resolution 12/2026' })
      expect(refused.statusCode).toBe(409)
      expect(refused.json().error).toBe('delegation_not_open')
      expect(refused.json().reasons.join(' ')).toMatch(/S5/)
    } finally { await setSwitch('S1', false, null); await setSwitch('S3', false, null) }
  }, 60000)

  test('a switch cannot be turned on without its written evidence', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/eo-workflow/switches/S1', headers: as(admin), payload: { is_on: true } })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toBe('evidence_required')
    const noRole = await app.inject({ method: 'PUT', url: '/api/eo-workflow/switches/S1', headers: as(eo), payload: { is_on: true, evidence: 'my own say-so' } })
    expect(noRole.statusCode).toBe(403)
  })

  test('quorum gate blocks a resolution until attendance meets quorum; then a matching decision passes', async () => {
    const id = await permitUnderReview()
    await resolve(id, 'approved', 'Approved subject to conditions.')
    const dec = await decide(id, { decision: 'approve' })
    expect(dec.statusCode).toBe(200)
    expect(dec.json().data.permit.status).toBe('approved')
  }, 60000)

  test('a resolution that does not match the decision does not authorise it', async () => {
    const id = await permitUnderReview()
    await resolve(id, 'refused', 'Refused: outside the plan.')
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('resolution_mismatch')
    expect(res.json().resolved).toBe('refused')
  }, 60000)

  test('a refusal gives written reasons', async () => {
    const id = await permitUnderReview()
    await resolve(id, 'refused', 'Refused: outside the plan.')
    const none = await decide(id, { decision: 'refuse', plan_note: undefined, notes: '' })
    expect(none.statusCode).toBe(400)
    expect(none.json().error).toBe('refusal_reasons_required')
    const ok = await decide(id, { decision: 'refuse', notes: 'The proposal is outside the plan for this zone (s.26(6)(b)).' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.permit.status).toBe('refused')
  }, 60000)

  test('a subdivision is not decided until the Minister\'s instrument is recorded (S2)', async () => {
    const id = await permitUnderReview({ development_type: 'subdivision' })
    await resolve(id, 'approved')
    const closed = await decide(id, { decision: 'approve' })
    expect(closed.statusCode).toBe(409)
    expect(closed.json().error).toBe('lane_closed')
    await setSwitch('S2', true, 'S.I. 000 of 2026 (test)')
    try {
      const open = await decide(id, { decision: 'approve' })
      expect(open.statusCode).toBe(200)
    } finally { await setSwitch('S2', false, null) }
  }, 60000)

  test('an in-force ministerial direction that refers the class of case to the Minister stops the decision', async () => {
    const d = await app.inject({
      method: 'POST', url: '/api/eo-workflow/directions', headers: as(eo),
      payload: { reference: 'Direction 3/2026 (test)', section: 's29', received_on: '2026-11-01', summary: 'Applications for new buildings are referred to the Minister.', refers_to_minister: true, applies_to_dev_types: ['new_building'] },
    })
    expect(d.statusCode).toBe(201)
    directions.push(d.json().data.id)
    try {
      const id = await permitUnderReview()
      await resolve(id, 'approved')
      const stopped = await decide(id, { decision: 'approve' })
      expect(stopped.statusCode).toBe(409)
      expect(stopped.json().error).toBe('ministerial_direction_applies')
    } finally {
      await app.inject({ method: 'PATCH', url: `/api/eo-workflow/directions/${d.json().data.id}`, headers: as(eo), payload: { in_force: false } })
    }
  }, 60000)

  test('an approval after the deemed-refusal date is refused; a written extension restores the time', async () => {
    const id = await permitUnderReview()
    await resolve(id, 'approved')
    const c = await systemOf(app.pg).connect()
    try {
      await c.query(`UPDATE spatial_planning.permit_application SET acknowledged_at = CURRENT_DATE - INTERVAL '4 months' WHERE id = $1`, [id])
    } finally { c.release() }
    const late = await decide(id, { decision: 'approve' })
    expect(late.statusCode).toBe(409)
    expect(late.json().error).toBe('deemed_refused')
    // an extension cannot revive a case already deemed refused
    const tooLate = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/extension`, headers: as(eo), payload: { extension_until: '2099-01-01', evidence: 'Letter of the applicant, filed 1 March' } })
    expect(tooLate.statusCode).toBe(409)
    expect(tooLate.json().error).toBe('deemed_refused')
  }, 60000)

  test('an extension needs the applicant\'s writing, and moves the date the clock runs to', async () => {
    const id = await permitUnderReview()
    const c = await systemOf(app.pg).connect()
    try {
      await c.query(`UPDATE spatial_planning.permit_application SET acknowledged_at = CURRENT_DATE - INTERVAL '2 months' WHERE id = $1`, [id])
    } finally { c.release() }
    const bare = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/extension`, headers: as(eo), payload: { extension_until: '2099-01-01' } })
    expect(bare.statusCode).toBe(400)
    expect(bare.json().error).toBe('evidence_required')
    const ok = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/extension`, headers: as(eo), payload: { extension_until: '2099-01-01', evidence: "Applicant's letter of 3 November, file 12" } })
    expect(ok.statusCode).toBe(200)
    const lane = await app.inject({ method: 'GET', url: `/api/eo-workflow/lane/${id}`, headers: as(eo) })
    expect(lane.statusCode).toBe(200)
    expect(String(lane.json().data.deemed_on)).toMatch(/^2099-01-01/)
    expect(lane.json().data.lane).toBe('L2')
  }, 60000)

  test('the referral log records what was sent, and "no reply" is recorded, not assumed', async () => {
    const id = await permitUnderReview()
    const sent = await app.inject({
      method: 'POST', url: '/api/eo-workflow/referrals', headers: as(eo),
      payload: { permit_app_id: id, kind: 'department', tier: 'precautionary', body: 'Department of Spatial Planning and Development', question: 'Is a business centre standard in force for this zone?' },
    })
    expect(sent.statusCode).toBe(201)
    expect(sent.json().data.reply_by).toBeTruthy()
    const open = await app.inject({ method: 'GET', url: `/api/eo-workflow/referrals?permit=${id}&open=1`, headers: as(eo) })
    expect(open.json().data).toHaveLength(1)
    const none = await app.inject({ method: 'PATCH', url: `/api/eo-workflow/referrals/${sent.json().data.id}`, headers: as(eo), payload: { no_reply: true, council_action: 'Proceeded on the Handbook standard.' } })
    expect(none.statusCode).toBe(200)
    expect(none.json().data.no_reply).toBe(true)
    const after = await app.inject({ method: 'GET', url: `/api/eo-workflow/referrals?permit=${id}&open=1`, headers: as(eo) })
    expect(after.json().data).toHaveLength(0)
  }, 30000)
})
