/**
 * Development applications read the plan (migration 231, routes/development-management.js, services/planGates.js), through the real routes and the real
 * authentication, against the loaded Vungu plan and the register's real stands. What it pins: an application for a real stand number is linked to the parcel
 * and lodged under the plan; the zoning endpoint shows every use with who decided it; the Executive Officer's approval is gated by what the plan decides
 * (a departure or an unagreed rule needs a recorded reason; a refusal never does); what is supplied is written to the case history and the decision letter;
 * and an application that was not linked can be lodged again.
 */
const { buildAppForTest } = require('./helpers/buildApp')
const { systemOf } = require('../src/lib/dbContext')
const { loginAs } = require('./helpers/auth')
const { answerChecks } = require('./helpers/statutoryChecks')
const { answerCirculation } = require('./helpers/circulation')
const { suspendAffirmation } = require('./helpers/proposedCells')

describe('applications and the plan', () => {
  let app, eo, admin, planner, sys, restoreAffirmation
  const permits = []
  let eoStand, proposedStand            // a stand governed by an EO column, and one by a PROPOSED column

  beforeAll(async () => {
    app = await buildAppForTest()
    sys = systemOf(app.pg)
    // the EO's pending decisions may be affirmed for testing; these tests pin the behaviour of a PROPOSED rule, so put the proposals back for the length of the file
    restoreAffirmation = await suspendAffirmation(sys)
    eo = await loginAs(app, 'demo.eo@vungu.test', 'demo1234')
    admin = await loginAs(app, 'demo.admin@vungu.test', 'demo1234')
    planner = await loginAs(app, 'demo.planner@vungu.test', 'demo1234')
    const pick = async (zone) => (await sys.query(
      `SELECT p.stand_no FROM public.parcel_zoning pz
         JOIN land.parcel p ON p.parcel_id = pz.parcel_id AND pz.parcel_layer = 'land.parcel'
         JOIN public.plan_zone_type t ON t.id = pz.plan_zone_type_id
        WHERE pz.is_governing AND p.parcel_kind = 'stand' AND p.status = 'current' AND t.code = $1 AND pz.share_pct > 99
        ORDER BY p.stand_no LIMIT 1`, [zone])).rows[0]?.stand_no
    eoStand = await pick('Medium Density Residential')
    proposedStand = await pick('Economic Corridor [Mixed Business]')
    expect(eoStand).toBeTruthy()
    expect(proposedStand).toBeTruthy()
  }, 60000)

  afterAll(async () => {
    for (const id of permits) {
      await sys.query('DELETE FROM spatial_planning.permit_event WHERE permit_app_id = $1', [id])
      await sys.query('DELETE FROM spatial_planning.generated_document WHERE permit_app_id = $1', [id]).catch(() => {})
      await sys.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [id])
    }
    await restoreAffirmation()
    await app.close()
  }, 30000)

  const auth = (t) => ({ authorization: `Bearer ${t}` })
  async function lodge(standNo, { toReview = true } = {}) {
    const created = await app.inject({ method: 'POST', url: '/api/permit-applications', headers: auth(planner),
      payload: { applicant_name: 'Plan Test', development_type: 'new_building', stand_number: standNo } })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id
    permits.push(id)
    let rev = created.json().data.revision
    if (toReview) {
      for (const step of ['acknowledged', 'under_review']) {
        const r = await app.inject({ method: 'PATCH', url: `/api/permit-applications/${id}/status`, headers: auth(planner), payload: { status: step, expectedRevision: rev } })
        rev = r.json().data.revision
      }
      await answerCirculation(sys, id)   // acknowledging circulated the case (migration 255)
      const chk = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/direction-check`, headers: auth(eo) })
      expect(chk.statusCode).toBe(200)
      await answerChecks(app, eo, id)
    }
    return id
  }
  const assess = (id, use) => app.inject({ method: 'POST', url: `/api/permit-applications/${id}/rule-snapshot`, headers: auth(planner), payload: { land_use_code: use } })
  // These tests pin the PLAN's gate. The authority for a decision is not what they are about, so an administrator's written override stands in for it
  // (the switches the delegated lane needs are shared state, and are tested in committee-gate.test.js).
  const decide = (id, payload) => app.inject({ method: 'POST', url: `/api/permit-applications/${id}/eo-decision`, headers: auth(admin),
    payload: { override: true, override_reason: 'Test: the plan gate is under test, not the decision authority.', ...payload } })
  const events = async (id) => (await sys.query('SELECT event_type, detail FROM spatial_planning.permit_event WHERE permit_app_id = $1 ORDER BY created_at', [id])).rows

  test('an application for a real stand number is linked to the parcel and lodged under the plan', async () => {
    const id = await lodge(eoStand, { toReview: false })
    const { rows: [p] } = await sys.query('SELECT parcel_layer, parcel_id, parcel_match, plan_instrument_id FROM spatial_planning.permit_application WHERE id = $1', [id])
    expect(p).toMatchObject({ parcel_layer: 'land.parcel', parcel_match: 'matched' })
    expect(p.parcel_id).toMatch(/^P-/)
    expect(p.plan_instrument_id).not.toBeNull()
    const { rows: snaps } = await sys.query("SELECT kind FROM spatial_planning.permit_rule_snapshot WHERE permit_id = $1", [id])
    expect(snaps.map((s) => s.kind)).toEqual(['lodgement'])
  })

  test('the zoning endpoint shows the zone and every use of the plan with who decided it', async () => {
    const id = await lodge(proposedStand, { toReview: false })
    const res = await app.inject({ method: 'GET', url: `/api/permit-applications/${id}/zoning`, headers: auth(planner) })
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.parcel).toMatchObject({ stand_no: proposedStand, kind: 'stand' })
    expect(d.plans).toHaveLength(1)
    const plan = d.plans[0]
    expect(plan.plan.provisional).toBe(true)
    expect(plan.governing_zone.name).toBe('Economic Corridor [Mixed Business]')
    expect(plan.uses.length).toBeGreaterThanOrEqual(38)
    const by = (v) => plan.uses.filter((u) => u.decided_by === v).length
    expect(by('proposed')).toBeGreaterThan(0)       // the corridor is a derived proposal
    expect(by('not_decided')).toBeGreaterThan(0)    // the EO's matrix does not address every use
    expect(by('council')).toBe(0)
    expect(plan.uses.filter((u) => u.decided_by === 'proposed').every((u) => /^PROPOSED/.test(u.authority))).toBe(true)
  })

  test('an approval of a permitted use decided by the EO needs nothing, and the letter states the plan basis', async () => {
    const id = await lodge(eoStand)
    expect((await assess(id, 'A')).statusCode).toBe(201)
    const gate = await app.inject({ method: 'GET', url: `/api/permit-applications/${id}/plan-gate?decision=approve`, headers: auth(eo) })
    expect(gate.json().data.requirements).toEqual([])
    expect(gate.json().data.basis).toMatchObject({ decision: 'permitted', provisional_decision: false })
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(200)
    const { rows: [doc] } = await sys.query('SELECT content FROM spatial_planning.generated_document WHERE permit_app_id = $1 ORDER BY created_at DESC LIMIT 1', [id])
    expect(doc.content).toContain('Plan basis')
    expect(doc.content).toContain('Medium Density Residential')
    expect(doc.content).toContain('EO Planning (Vungu matrix)')
  }, 30000)

  test('a prohibited, proposed use needs the reason and the acknowledgement; both are recorded', async () => {
    const id = await lodge(proposedStand)
    expect((await assess(id, 'A')).statusCode).toBe(201)       // a dwelling in the corridor: prohibited, and only proposed
    const first = await decide(id, { decision: 'approve' })
    expect(first.statusCode).toBe(409)
    expect(first.json().error).toBe('plan_requirements')
    expect(first.json().missing.map((m) => m.field).sort()).toEqual(['departure_reason', 'rules_acknowledged'])

    const partial = await decide(id, { decision: 'approve', departure_reason: 'The neighbouring stands already hold dwellings.' })
    expect(partial.json().missing.map((m) => m.field)).toEqual(['rules_acknowledged'])

    const ok = await decide(id, { decision: 'approve', departure_reason: 'The neighbouring stands already hold dwellings.', rules_acknowledged: true })
    expect(ok.statusCode).toBe(200)
    const ev = await events(id)
    const departure = ev.find((e) => e.event_type === 'plan_departure')
    expect(departure.detail).toMatchObject({ code: 'prohibited_use', decision: 'prohibited', reason: 'The neighbouring stands already hold dwellings.' })
    expect(ev.some((e) => e.event_type === 'rules_acknowledged')).toBe(true)
    const { rows: [doc] } = await sys.query('SELECT content FROM spatial_planning.generated_document WHERE permit_app_id = $1 ORDER BY created_at DESC LIMIT 1', [id])
    expect(doc.content).toContain('Reasons recorded for departing from the plan')
    expect(doc.content).toContain('The neighbouring stands already hold dwellings.')
  }, 30000)

  test('special consent without the public notice completed needs a reason', async () => {
    const id = await lodge(eoStand)
    expect((await assess(id, 'A3')).statusCode).toBe(201)       // flats in a medium-density zone: special consent
    const res = await decide(id, { decision: 'approve' })
    expect(res.statusCode).toBe(409)
    expect(res.json().missing.map((m) => m.code)).toContain('special_consent_no_notice')
  }, 30000)

  test('a refusal is never gated, and an application with no assessment needs a note to be approved', async () => {
    const refused = await lodge(proposedStand)
    expect((await decide(refused, { decision: 'refuse', notes: 'Not in keeping with the zone.' })).statusCode).toBe(200)

    const unassessed = await lodge(eoStand)
    const blocked = await decide(unassessed, { decision: 'approve' })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().missing[0]).toMatchObject({ code: 'no_assessment', field: 'plan_note' })
    const ok = await decide(unassessed, { decision: 'approve', plan_note: 'The planner inspected the site; use is incidental.' })
    expect(ok.statusCode).toBe(200)
  }, 30000)

  test('an application that was not linked can be lodged again once its stand number is right', async () => {
    const id = await lodge('NO-SUCH-STAND', { toReview: false })
    expect((await sys.query('SELECT parcel_match FROM spatial_planning.permit_application WHERE id = $1', [id])).rows[0].parcel_match).toBe('unmatched')
    await sys.query('UPDATE spatial_planning.permit_application SET stand_number = $2 WHERE id = $1', [id, eoStand])
    const res = await app.inject({ method: 'POST', url: `/api/permit-applications/${id}/relodge`, headers: auth(planner) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ parcel_layer: 'land.parcel', parcel_match: 'matched' })
    const { rows } = await sys.query("SELECT kind FROM spatial_planning.permit_rule_snapshot WHERE permit_id = $1", [id])
    expect(rows.map((r) => r.kind)).toContain('lodgement')
  })
})
