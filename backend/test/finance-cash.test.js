/**
 * The cash office's pure helpers, with no database: what reaches SQL as money, lines and counts,
 * and how a database refusal becomes an answer an officer can act on.
 */
const {
  cashRefusal, normaliseLines, normaliseCounts, positiveMoney, nonNegativeMoney,
} = require('../src/routes/finance-cash')

const ID = '11111111-1111-4111-8111-111111111111'

describe('cash office helpers', () => {
  test('a receipt amount is a positive decimal string, and nil or negative is not one', () => {
    expect(positiveMoney('12.5')).toBe('12.50')
    expect(positiveMoney(40)).toBe('40.00')
    expect(positiveMoney('0')).toBeNull()
    expect(positiveMoney('-3')).toBeNull()
    expect(positiveMoney('twelve')).toBeNull()
  })

  test('a float or a count may be nil but never negative', () => {
    expect(nonNegativeMoney('0')).toBe('0.00')
    expect(nonNegativeMoney('50')).toBe('50.00')
    expect(nonNegativeMoney('-0.01')).toBeNull()
  })

  test('a fixed-charge line passes through with no amount, for the database to supply', () => {
    const out = normaliseLines([{ income_code_id: ID }, { income_code_id: ID, unit_amount: '7.5', quantity: '2' }])
    expect(out.ok).toBe(true)
    expect(out.lines[0]).toEqual({ income_code_id: ID })
    expect(out.lines[1]).toEqual({ income_code_id: ID, unit_amount: '7.50', quantity: '2' })
  })

  test('lines are refused when empty, nil, or with a quantity that is not a count', () => {
    expect(normaliseLines([]).ok).toBe(false)
    expect(normaliseLines([{ income_code_id: ID, unit_amount: '0' }]).ok).toBe(false)
    expect(normaliseLines([{ income_code_id: ID, unit_amount: '5', quantity: '0' }]).ok).toBe(false)
    expect(normaliseLines([{ income_code_id: ID, unit_amount: '5', quantity: '1.2345' }]).ok).toBe(false)
    expect(normaliseLines([{ income_code_id: ID, unit_amount: '5', quantity: '-1' }]).ok).toBe(false)
  })

  test('a count names each currency once', () => {
    expect(normaliseCounts([{ currency: 'USD', declared_total: '100' }]).counts).toEqual([{ currency: 'USD', declared_total: '100.00' }])
    expect(normaliseCounts([{ currency: 'USD', declared_total: '1' }, { currency: 'USD', declared_total: '2' }]).ok).toBe(false)
    expect(normaliseCounts([{ currency: 'USD', declared_total: '-1' }]).ok).toBe(false)
    expect(normaliseCounts(undefined).ok).toBe(false)
  })

  test('refusals from the database keep their sentence and gain a status', () => {
    const say = (message, extra = {}) => cashRefusal({ code: '23514', message, ...extra })
    expect(say('session CS-0000001 is your own cash-up and must be verified by somebody else')).toMatchObject({ status: 409, error: 'separation_of_duties' })
    expect(cashRefusal({ code: '23514', constraint: 'cashier_session_verified_by_another', message: 'x' })).toMatchObject({ error: 'separation_of_duties' })
    expect(say('session CS-0000001 belongs to another cashier, and a receipt is taken only in your own session')).toMatchObject({ status: 403, error: 'not_your_session' })
    expect(say('session CS-0000001 is closed and takes no more receipts')).toMatchObject({ status: 409, error: 'session_state' })
    expect(say('the USD count differs from the receipts by -2.00, and a difference is explained in writing before the session can be closed')).toMatchObject({ error: 'count_incomplete' })
    expect(say('session CS-1 has a USD difference of 2.00 and cash point Main has no cash-difference account, so it cannot be posted')).toMatchObject({ error: 'difference_account_missing' })
    expect(say('the charge for Hall hire is USD 40.00 and the counter may not vary it; this receipt says 25.00')).toMatchObject({ error: 'charge_fixed' })
    expect(say('the till of Main holds USD 50.00 in the ledger that is not already on its way to the bank, and this banking is for 60.00')).toMatchObject({ error: 'nothing_to_bank' })
    expect(cashRefusal({ code: '23505', constraint: 'uq_cashier_session_open_cashier', message: 'dup' })).toMatchObject({ status: 409, error: 'duplicate' })
    expect(say('voucher RC-1 was prepared by this person and must be posted by somebody else')).toMatchObject({ error: 'separation_of_duties' })
    expect(cashRefusal(new Error('connection reset'))).toBeNull()
  })
})
