/**
 * The pure parts of src/routes/finance-rates.js, with no database.
 *
 * What the DATABASE refuses is proven in scripts/verify-rates-invariants.js, with every route
 * bypassed, and the routes are walked end to end in src/routes/__tests__/finance.rates.test.js.
 * These are the places in the route file where a quiet mistake becomes a wrong charge: reading a
 * rate, shaping an allocation, and turning a refusal into the right HTTP answer.
 */
const {
  parseRate, parseOptionalMoney, refusalSummary, validateAllocations, ratesRefusal,
  REFUSAL_REASONS, REASON_CODES,
} = require('../src/routes/finance-rates')

describe('parseRate', () => {
  test('keeps a rate in the dollar to eight places and never rounds it to two', () => {
    // 0.015 rounded to cents is 0.02: a third more rates than the Council resolved.
    expect(parseRate('0.015')).toEqual({ ok: true, value: '0.01500000' })
    expect(parseRate('0.0085')).toEqual({ ok: true, value: '0.00850000' })
    expect(parseRate('0.00000001')).toEqual({ ok: true, value: '0.00000001' })
  })

  test('refuses a JSON number rather than coercing it', () => {
    expect(parseRate(0.015).ok).toBe(false)
    expect(parseRate(null).ok).toBe(false)
    expect(parseRate(undefined).ok).toBe(false)
  })

  test('refuses more than eight places, a negative and anything that is not a number', () => {
    expect(parseRate('0.000000001').ok).toBe(false)
    expect(parseRate('-0.01').ok).toBe(false)
    expect(parseRate('one and a half cents').ok).toBe(false)
    expect(parseRate('').ok).toBe(false)
  })

  test('accepts a nil rate, which is a rate the Council may resolve', () => {
    expect(parseRate('0')).toEqual({ ok: true, value: '0.00000000' })
  })
})

describe('parseOptionalMoney', () => {
  test('not recorded is null, which is not nil', () => {
    expect(parseOptionalMoney(undefined, 'x')).toEqual({ ok: true, value: null })
    expect(parseOptionalMoney(null, 'x')).toEqual({ ok: true, value: null })
    expect(parseOptionalMoney('', 'x')).toEqual({ ok: true, value: null })
    expect(parseOptionalMoney('0', 'x')).toEqual({ ok: true, value: '0.00' })
  })

  test('a recorded charge is a decimal string, and cannot be negative', () => {
    expect(parseOptionalMoney('12', 'x')).toEqual({ ok: true, value: '12.00' })
    expect(parseOptionalMoney('-12', 'The fixed charge')).toEqual({
      ok: false, reason: 'The fixed charge cannot be negative.',
    })
    expect(parseOptionalMoney('abc', 'The minimum charge').ok).toBe(false)
  })
})

describe('refusalSummary', () => {
  test('lists every reason in the order the database decides them, including the empty ones', () => {
    const out = refusalSummary([
      { reason_code: 'no_approved_tariff', properties: 3 },
      { reason_code: 'no_rates_account', properties: 728 },
    ])
    expect(out.map((r) => r.reason_code)).toEqual(REASON_CODES)
    expect(out.find((r) => r.reason_code === 'no_rates_account')).toMatchObject({ properties: 728, waiting_on: 'D19' })
    expect(out.find((r) => r.reason_code === 'no_approved_tariff')).toMatchObject({ properties: 3, waiting_on: 'D18' })
    // A reason nothing is waiting on is shown as 0, not left out.
    expect(out.find((r) => r.reason_code === 'no_rateable_value')).toMatchObject({ properties: 0, waiting_on: 'D17' })
  })

  test('a duplicate bill and a nil charge wait on no Council decision', () => {
    const out = refusalSummary([])
    expect(out.find((r) => r.reason_code === 'already_billed').waiting_on).toBeNull()
    expect(out.find((r) => r.reason_code === 'nil_charge').decision).toBeNull()
  })

  test('the reasons match the CHECK constraint in migration 205 exactly', () => {
    expect([...REASON_CODES].sort()).toEqual([
      'already_billed', 'currency_mismatch', 'nil_charge', 'no_approved_tariff',
      'no_property_category', 'no_rateable_value', 'no_rates_account', 'ratepayer_inactive',
    ])
    expect(REFUSAL_REASONS.every((r) => r.waiting_on === null || /^D1[789]$/.test(r.waiting_on))).toBe(true)
  })
})

describe('validateAllocations', () => {
  const BILL_A = '11111111-1111-4111-8111-111111111111'
  const BILL_B = '22222222-2222-4222-8222-222222222222'

  test('no allocations is a receipt left wholly unallocated', () => {
    expect(validateAllocations(undefined)).toEqual({ ok: true, allocations: [] })
    expect(validateAllocations([])).toEqual({ ok: true, allocations: [] })
  })

  test('amounts leave as decimal strings, never numbers', () => {
    const out = validateAllocations([
      { rates_bill_id: BILL_A, amount: '1,000.50' }, { rates_bill_id: BILL_B, amount: 12 },
    ])
    expect(out).toEqual({
      ok: true,
      allocations: [{ rates_bill_id: BILL_A, amount: '1000.50' }, { rates_bill_id: BILL_B, amount: '12.00' }],
    })
  })

  test('refuses a bill named twice, a missing bill, and an amount that is nil, negative or unreadable', () => {
    expect(validateAllocations([{ rates_bill_id: BILL_A, amount: '1' }, { rates_bill_id: BILL_A, amount: '1' }]).ok).toBe(false)
    expect(validateAllocations([{ amount: '1' }]).ok).toBe(false)
    expect(validateAllocations([{ rates_bill_id: BILL_A, amount: '0' }]).ok).toBe(false)
    expect(validateAllocations([{ rates_bill_id: BILL_A, amount: '-5' }]).ok).toBe(false)
    expect(validateAllocations([{ rates_bill_id: BILL_A, amount: 'lots' }]).ok).toBe(false)
    expect(validateAllocations('everything').ok).toBe(false)
  })
})

describe('ratesRefusal', () => {
  const raised = (message, extra = {}) => ({ message, code: '23514', ...extra })

  test('an over-allocation is a 409 carrying the database sentence unchanged', () => {
    const message = 'bill RB-00001 has 137.00 still open and this receipt allocates 200.00 to it'
    expect(ratesRefusal(raised(message))).toEqual({ status: 409, error: 'over_allocation', message })
  })

  test('separation of duties, whichever record it is on', () => {
    expect(ratesRefusal(raised('billing run R1 was prepared by this person and must be posted by somebody else')))
      .toMatchObject({ status: 409, error: 'separation_of_duties' })
    expect(ratesRefusal({ message: 'violates check', code: '23514', constraint: 'rates_tariff_drafted_and_approved_differ' }))
      .toMatchObject({ status: 409, error: 'separation_of_duties' })
    // Raised by the ledger underneath, for a single voucher: handed to ledgerRefusal.
    expect(ratesRefusal(raised('voucher RC-1 was prepared by this person and must be posted by somebody else')))
      .toMatchObject({ status: 409, error: 'separation_of_duties' })
  })

  test('a duplicate names what was duplicated, not just "duplicate"', () => {
    const tariff = ratesRefusal({ message: 'dup', code: '23505', constraint: 'uq_rates_tariff_approved' })
    expect(tariff).toMatchObject({ status: 409, error: 'duplicate' })
    expect(tariff.message).toMatch(/Supersede it first/)
    expect(ratesRefusal({ message: 'dup', code: '23505', constraint: 'uq_rates_account_parcel_active' }).message)
      .toMatch(/bill it twice/)
    expect(ratesRefusal({ message: 'dup', code: '23505', constraint: 'uq_rates_receipt_no' }).message)
      .toMatch(/receipt number/)
  })

  test('refusals that are about the request are 400, about the state of the books 409', () => {
    expect(ratesRefusal(raised('account 4100 (Rates revenue) is not a bank or cash account, so money cannot be receipted into it')).status).toBe(400)
    expect(ratesRefusal(raised('the billed period 2027-01-01 to 2027-03-31 is not inside financial year X (a to b)')).status).toBe(400)
    expect(ratesRefusal(raised('bill RB-1 belongs to a different rates account, and a payment settles only the payer\'s own bills')).status).toBe(400)
    expect(ratesRefusal(raised('parcel P1 already has an active rateable value in force from 2026-07-01 to further notice')))
      .toMatchObject({ status: 409, error: 'valuation_overlap' })
    expect(ratesRefusal(raised('billing run R1 is committed and cannot be cancelled'))).toMatchObject({ status: 409, error: 'run_state' })
    expect(ratesRefusal(raised('bill RB-1 is draft and cannot be settled until its billing run is committed')))
      .toMatchObject({ status: 409, error: 'bill_not_settleable' })
    expect(ratesRefusal(raised('voucher V1 no longer agrees with rates bill RB-1: the bill is for 2137.00 and the voucher debits 137.00')))
      .toMatchObject({ status: 409, error: 'voucher_disagrees_with_document' })
    expect(ratesRefusal(raised('accounting period 2 is closed and accepts no postings, so these bills could never be posted')))
      .toMatchObject({ status: 409, error: 'period_not_open' })
  })

  test('an unknown reference is a 400, and an unrecognised failure is not swallowed', () => {
    expect(ratesRefusal({ message: 'fk', code: '23503' })).toMatchObject({ status: 400, error: 'unknown_reference' })
    expect(ratesRefusal(new Error('connection terminated unexpectedly'))).toBeNull()
    expect(ratesRefusal(null)).toBeNull()
  })
})
