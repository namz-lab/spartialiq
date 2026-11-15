/**
 * The plan's gate on the Executive Officer's determination (src/services/planGates.js): what an approval must say, by what the plan decides. Pure functions.
 */
const { evaluate, describeBasis } = require('../src/services/planGates')

const permit = (over = {}) => ({ id: 'p1', parcel_layer: 'land.parcel', parcel_id: 'P-1', parcel_match: 'matched', plan_instrument_id: 'plan', ...over })
const governing = (over = {}) => ({
  governing: true, decision: 'permitted', decision_authority: 'EO Planning (Vungu matrix)', decision_provisional: false,
  zone: { id: 1, name: 'Medium Density Residential' }, plan: { id: 'plan', title: 'Vungu plan', status: 'unknown', provisional: true },
  land_use: { code: 'A', description: 'Detached dwelling' }, pathway: null, ...over,
})
const basis = (g, over = {}) => ({ permit: permit(), assessment: { land_use_code: 'A', snapshot: { results: [g] } }, governing: g, noticeComplete: false, ...over })
const fields = (r) => r.missing.map((m) => m.field)

describe('plan gates', () => {
  test('a permitted use decided by the EO needs nothing', () => {
    const r = evaluate('approve', basis(governing()), {})
    expect(r).toMatchObject({ gated: false, requirements: [], missing: [], record: [] })
  })

  test('a refusal is never gated, whatever the plan says', () => {
    for (const g of [governing({ decision: 'prohibited' }), governing({ decision: null }), governing({ decision_provisional: true })]) {
      expect(evaluate('refuse', basis(g), {}).gated).toBe(false)
    }
    expect(evaluate('refuse', { permit: permit({ parcel_id: null }), assessment: null, governing: null, noticeComplete: false }, {}).gated).toBe(false)
  })

  test('a prohibited use asks for the reason for departing, and records it when given', () => {
    const b = basis(governing({ decision: 'prohibited' }))
    expect(fields(evaluate('approve', b, {}))).toEqual(['departure_reason'])
    expect(fields(evaluate('approve', b, { departure_reason: 'too short' }))).toEqual(['departure_reason'])   // a reason is a sentence
    const ok = evaluate('approve_with_conditions', b, { departure_reason: 'The surrounding stands already hold dwellings.' })
    expect(ok.missing).toEqual([])
    expect(ok.record).toEqual([{ event: 'plan_departure', detail: expect.objectContaining({ code: 'prohibited_use', reason: 'The surrounding stands already hold dwellings.', decision: 'prohibited', zone: 'Medium Density Residential' }) }])
  })

  test('special consent needs the public notice completed, or a reason', () => {
    const sc = governing({ decision: 'special_consent', pathway: { requires_public_notice: true } })
    expect(fields(evaluate('approve', basis(sc), {}))).toEqual(['departure_reason'])
    expect(evaluate('approve', basis(sc, { noticeComplete: true }), {}).gated).toBe(false)
    // a pathway that needs no notice asks for nothing
    expect(evaluate('approve', basis(governing({ decision: 'special_consent', pathway: { requires_public_notice: false } })), {}).gated).toBe(false)
  })

  test('a rule that is only proposed, or no decision at all, needs the EO\'s acknowledgement', () => {
    const proposed = basis(governing({ decision: 'permitted', decision_authority: 'PROPOSED: best practice, for EO review', decision_provisional: true }))
    expect(fields(evaluate('approve', proposed, {}))).toEqual(['rules_acknowledged'])
    expect(fields(evaluate('approve', proposed, { rules_acknowledged: 'yes' }))).toEqual(['rules_acknowledged'])   // only true counts
    expect(evaluate('approve', proposed, { rules_acknowledged: true }).record.map((e) => e.event)).toEqual(['rules_acknowledged'])
    expect(fields(evaluate('approve', basis(governing({ decision: null, decision_authority: null })), {}))).toEqual(['rules_acknowledged'])
  })

  test('a prohibited proposal needs both the reason and the acknowledgement', () => {
    const b = basis(governing({ decision: 'prohibited', decision_authority: 'PROPOSED: best practice, for EO review', decision_provisional: true }))
    expect(fields(evaluate('approve', b, {}))).toEqual(['departure_reason', 'rules_acknowledged'])
    expect(fields(evaluate('approve', b, { departure_reason: 'A reason of some length.' }))).toEqual(['rules_acknowledged'])
  })

  test('no parcel, or no land use assessed, needs a note saying why the plan was not applied', () => {
    const noParcel = { permit: permit({ parcel_id: null, parcel_layer: null }), assessment: null, governing: null, noticeComplete: false }
    expect(evaluate('approve', noParcel, {}).requirements[0]).toMatchObject({ code: 'no_parcel', field: 'plan_note' })
    const noAssessment = { permit: permit(), assessment: null, governing: null, noticeComplete: false }
    expect(evaluate('approve', noAssessment, {}).requirements[0]).toMatchObject({ code: 'no_assessment', field: 'plan_note' })
    const ok = evaluate('approve', noParcel, { plan_note: 'The land is not in the register yet; surveyed on site.' })
    expect(ok.missing).toEqual([])
    expect(ok.record[0].event).toBe('plan_note')
  })

  test('describeBasis says what the plan decided and by whom, for the screen and the letter', () => {
    const d = describeBasis(basis(governing({ decision: 'prohibited', decision_authority: 'PROPOSED: best practice, for EO review', decision_provisional: true })))
    expect(d).toMatchObject({ assessed: true, decision: 'prohibited', provisional_decision: true, zone: { name: 'Medium Density Residential' }, parcel: { id: 'P-1' } })
  })
})
