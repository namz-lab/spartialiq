/**
 * The cash office end to end, through the real routes and the real database.
 *
 * The Director sets up a counter and the income list; a cashier opens a till, receipts sundry
 * income, cancels one receipt and cashes up short; the accountant returns nothing, verifies, and
 * the session reaches the ledger; the cashier prepares the banking and the accountant posts it.
 * Along the way: what each of the new roles CANNOT do, and what reaches the audit trail.
 *
 * What the database itself refuses, with every route bypassed, is proven separately in
 * scripts/verify-cash-office-invariants.js. This suite proves the routes reach those rules,
 * translate their refusals, and hold the permissions.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.cash.test.js --runInBand
 *
 * IT POSTS TO THE LEDGER AND ISSUES RECEIPTS, BOTH OF WHICH ARE IMMUTABLE. afterAll removes this
 * run's rows by its own financial year with the immutability triggers disabled for one
 * transaction. test/helpers/buildApp.js refuses a database that is not obviously disposable.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `CT${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

function day(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

describe('the cash office', () => {
  let app
  let sys
  const as = {}
  const made = {}

  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const marketLine = (amount) => [{ income_code_id: made.market, unit_amount: amount }]

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)

    const accounts = {
      director: 'demo.finance-admin@vungu.test',
      accountant: 'demo.accountant@vungu.test',
      cashier: 'demo.cashier@vungu.test',
      relief: 'demo.cashier2@vungu.test',
      revenue: 'demo.revenue@vungu.test',
      ceo: 'demo.ceo@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      technicalAdmin: 'demo.admin@vungu.test',
      inspector: 'demo.inspector@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) as[key] = await loginAs(app, email, PASSWORD)

    // A year that contains today, because a till is opened on today's date and nothing else.
    const year = await call('POST', '/finance/financial-years', as.director, {
      label: `${TAG} Cash year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD',
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect((await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)).statusCode).toBe(200)
    expect((await call('POST', '/finance/ledger/periods', as.director,
      { financial_year_id: made.yearId, periodicity: 'monthly' })).statusCode).toBeLessThan(300)

    const account = async (code, name, rootType, accountType) => {
      const res = await call('POST', '/finance/ledger/accounts', as.director,
        { code: `${TAG}-${code}`, name, root_type: rootType, ...(accountType ? { account_type: accountType } : {}) })
      expect(res.statusCode).toBe(201)
      return res.json().data.id
    }
    made.till = await account('1010', 'Cash test till', 'asset', 'cash')
    made.bank = await account('1100', 'Cash test bank', 'asset', 'bank')
    made.hall = await account('4300', 'Cash test hall hire', 'revenue')
    made.marketAcct = await account('4310', 'Cash test market fees', 'revenue')
    made.diff = await account('5900', 'Cash test differences', 'expense')
  })

  afterAll(async () => {
    if (!app) return
    let cleanupError = null
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      const vouchers = 'SELECT id FROM finance.voucher WHERE financial_year_id = $1'
      await client.query('ALTER TABLE finance.ledger_entry DISABLE TRIGGER trg_ledger_entry_immutable')
      await client.query(`DELETE FROM finance.ledger_entry WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('ALTER TABLE finance.ledger_entry ENABLE TRIGGER trg_ledger_entry_immutable')
      await client.query('ALTER TABLE finance.cash_receipt DISABLE TRIGGER trg_cash_receipt_immutable')
      await client.query('ALTER TABLE finance.cash_receipt_line DISABLE TRIGGER trg_cash_receipt_line_immutable')
      await client.query(
        `DELETE FROM finance.cash_receipt_line WHERE cash_receipt_id IN
           (SELECT id FROM finance.cash_receipt WHERE voucher_id IN (${vouchers}))`, [made.yearId])
      await client.query(`DELETE FROM finance.cash_receipt WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('ALTER TABLE finance.cash_receipt ENABLE TRIGGER trg_cash_receipt_immutable')
      await client.query('ALTER TABLE finance.cash_receipt_line ENABLE TRIGGER trg_cash_receipt_line_immutable')
      await client.query(`DELETE FROM finance.bank_deposit WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query(
        `DELETE FROM finance.cashier_session_count WHERE cashier_session_id IN
           (SELECT id FROM finance.cashier_session WHERE financial_year_id = $1)`, [made.yearId])
      // Migration 208: the session history is append-only and a session is never deleted. Both
      // refusals are suspended for this one cleanup transaction, as the receipt triggers are above.
      await client.query('ALTER TABLE finance.cashier_session_event DISABLE TRIGGER trg_cashier_session_event_immutable')
      await client.query('ALTER TABLE finance.cashier_session DISABLE TRIGGER trg_cashier_session_transition')
      await client.query(
        `DELETE FROM finance.cashier_session_event WHERE cashier_session_id IN
           (SELECT id FROM finance.cashier_session WHERE financial_year_id = $1)`, [made.yearId])
      await client.query('DELETE FROM finance.cashier_session WHERE financial_year_id = $1', [made.yearId])
      await client.query('ALTER TABLE finance.cashier_session_event ENABLE TRIGGER trg_cashier_session_event_immutable')
      await client.query('ALTER TABLE finance.cashier_session ENABLE TRIGGER trg_cashier_session_transition')
      await client.query(
        `UPDATE finance.voucher SET status = 'draft', posted_by = NULL, posted_at = NULL
          WHERE financial_year_id = $1 AND status <> 'draft'`, [made.yearId])
      await client.query(`DELETE FROM finance.voucher_line WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.income_code WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.cash_point WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.financial_year WHERE id = $1', [made.yearId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      cleanupError = err
    } finally {
      client.release()
    }
    await app.close()
    if (cleanupError) throw new Error(`[finance.cash] cleanup of ${TAG} failed: ${cleanupError.message}`)
  })

  test('the cash office is closed to anonymous callers and to staff with no finance permission', async () => {
    expect((await call('GET', '/finance/cash/desk')).statusCode).toBe(401)
    expect((await call('GET', '/finance/cash/desk', as.inspector)).statusCode).toBe(403)
    expect((await call('GET', '/finance/cash/sessions', as.inspector)).statusCode).toBe(403)
  })

  test('each new role holds what its desk needs and nothing its job forbids', async () => {
    const permissions = async (token) => new Set((await call('GET', '/finance/me', token)).json().data.permissions)
    const cashier = await permissions(as.cashier)
    expect(cashier.has('finance.cash.receipt.record')).toBe(true)
    expect(cashier.has('finance.rates.receipt.record')).toBe(true)
    for (const code of ['finance.cash.session.verify', 'finance.ledger.voucher.post', 'finance.ledger.view',
      'finance.budget.view', 'finance.cash.setup.manage']) expect(cashier.has(code)).toBe(false)

    const accountant = await permissions(as.accountant)
    for (const code of ['finance.ledger.voucher.prepare', 'finance.ledger.voucher.post',
      'finance.ledger.voucher.reverse', 'finance.cash.session.verify', 'finance.ledger.period.manage']) {
      expect(accountant.has(code)).toBe(true)
    }
    for (const code of ['finance.budget.approve', 'finance.publication.publish', 'finance.cash.receipt.record']) {
      expect(accountant.has(code)).toBe(false)
    }

    const revenue = await permissions(as.revenue)
    expect(revenue.has('finance.rates.bill.prepare')).toBe(true)
    for (const code of ['finance.rates.bill.post', 'finance.rates.tariff.approve', 'finance.ledger.voucher.post']) {
      expect(revenue.has(code)).toBe(false)
    }

    const ceo = await permissions(as.ceo)
    expect(ceo.has('finance.cash.view')).toBe(true)
    expect([...ceo].every((code) => /\.(view|export)$/.test(code))).toBe(true)
  })

  test('only whoever sets the office up can create a cash point or an income code', async () => {
    const point = { code: `${TAG}-MAIN`, name: `${TAG} Main counter`, till_account_id: made.till }
    for (const who of [as.cashier, as.revenue, as.ceo, as.auditor, as.technicalAdmin]) {
      expect((await call('POST', '/finance/cash/points', who, point)).statusCode).toBe(403)
    }
    const wrong = await call('POST', '/finance/cash/points', as.director, { ...point, till_account_id: made.bank })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().error).toBe('account_unsuitable')

    const created = await call('POST', '/finance/cash/points', as.director, point)
    expect(created.statusCode).toBe(201)
    made.pointId = created.json().data.cash_point.id

    const hall = await call('POST', '/finance/cash/income-codes', as.accountant, {
      code: `${TAG}-HALL`, name: `${TAG} Hall hire`, ledger_account_id: made.hall, pricing: 'fixed', unit_amount_usd: '40.00',
    })
    expect(hall.statusCode).toBe(201)
    made.hallCode = hall.json().data.income_code.id
    const market = await call('POST', '/finance/cash/income-codes', as.accountant, {
      code: `${TAG}-MKT`, name: `${TAG} Market fee`, ledger_account_id: made.marketAcct,
    })
    expect(market.statusCode).toBe(201)
    made.market = market.json().data.income_code.id

    const notRevenue = await call('POST', '/finance/cash/income-codes', as.accountant, {
      code: `${TAG}-BAD`, name: `${TAG} Bad`, ledger_account_id: made.diff,
    })
    expect(notRevenue.statusCode).toBe(400)
    expect(notRevenue.json().error).toBe('account_unsuitable')
  })

  test('a cashier opens a till, and cannot open a second or take a receipt in somebody else\'s', async () => {
    expect((await call('POST', '/finance/cash/sessions', as.accountant, { cash_point_id: made.pointId })).statusCode).toBe(403)

    const opened = await call('POST', '/finance/cash/sessions', as.cashier, {
      cash_point_id: made.pointId, financial_year_id: made.yearId, floats: [{ currency: 'USD', amount: '50.00' }],
    })
    expect(opened.statusCode).toBe(201)
    made.sessionId = opened.json().data.session.id
    expect(opened.json().data.session.business_date).toBe(day(0))

    const again = await call('POST', '/finance/cash/sessions', as.cashier, { cash_point_id: made.pointId, financial_year_id: made.yearId })
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('session_already_open')
    const sameDrawer = await call('POST', '/finance/cash/sessions', as.relief, { cash_point_id: made.pointId, financial_year_id: made.yearId })
    expect(sameDrawer.statusCode).toBe(409)

    const intruder = await call('POST', '/finance/cash/receipts', as.relief, {
      session_id: made.sessionId, payer_name: 'T. Moyo', currency: 'USD', method: 'cash', lines: marketLine('5.00'),
    })
    expect(intruder.statusCode).toBe(403)
    expect(intruder.json().error).toBe('not_your_session')
  })

  test('receipts are numbered by the system, hold the Council\'s charge, and keep non-cash out of the till', async () => {
    const receipt = (body, who = as.cashier) => call('POST', '/finance/cash/receipts', who,
      { session_id: made.sessionId, payer_name: 'T. Moyo', currency: 'USD', method: 'cash', ...body })

    // A number supplied by the caller is not an input at all: it is dropped, and one is issued.
    const hall = await receipt({ lines: [{ income_code_id: made.hallCode }], receipt_no: 'MY-OWN-NUMBER' })
    expect(hall.statusCode).toBe(201)
    expect(hall.json().data.receipt.receipt_no).toMatch(/^RC-\d{7}$/)
    expect(hall.json().data.receipt.amount).toBe('40.00')
    const market = await receipt({ lines: marketLine('12.00') })
    expect(market.statusCode).toBe(201)
    const n = (r) => Number(r.json().data.receipt.receipt_no.split('-')[1])
    expect(n(market) - n(hall)).toBe(1)
    made.marketReceipt = market.json().data.receipt.id

    const discount = await receipt({ lines: [{ income_code_id: made.hallCode, unit_amount: '25.00' }] })
    expect(discount.statusCode).toBe(409)
    expect(discount.json().error).toBe('charge_fixed')

    const wallet = await receipt({ method: 'mobile_money', lines: marketLine('30.00') })
    expect(wallet.statusCode).toBe(400)
    expect(wallet.json().error).toBe('account_unsuitable')
    const intoTill = await receipt({ method: 'mobile_money', deposit_account_id: made.till, method_reference: 'ECO-1', lines: marketLine('30.00') })
    expect(intoTill.statusCode).toBe(400)
    const noRef = await receipt({ method: 'mobile_money', deposit_account_id: made.bank, lines: marketLine('30.00') })
    expect(noRef.statusCode).toBe(400)
    expect(noRef.json().error).toBe('reference_required')
    const ok = await receipt({ method: 'mobile_money', deposit_account_id: made.bank, method_reference: 'ECO-778', lines: marketLine('30.00') })
    expect(ok.statusCode).toBe(201)
    // The failed attempts above burned no number.
    expect(n(ok) - n(market)).toBe(1)

    const mistake = await receipt({ lines: marketLine('99.00') })
    expect(mistake.statusCode).toBe(201)
    made.mistake = mistake.json().data.receipt.id
  })

  test('a receipt is cancelled with a reason by its own cashier, and stays on the record', async () => {
    const url = `/finance/cash/receipts/${made.mistake}/cancel`
    expect((await call('POST', url, as.cashier, { reason: 'x' })).statusCode).toBe(400)
    expect((await call('POST', url, as.accountant, { reason: 'not my receipt' })).statusCode).toBe(403)
    const other = await call('POST', url, as.relief, { reason: 'not my receipt' })
    expect(other.statusCode).toBe(403)
    expect(other.json().error).toBe('not_your_session')

    const done = await call('POST', url, as.cashier, { reason: 'keyed twice by mistake' })
    expect(done.statusCode).toBe(200)
    const printed = await call('GET', `/finance/cash/receipts/${made.mistake}`, as.auditor)
    expect(printed.statusCode).toBe(200)
    expect(printed.json().data.receipt.is_cancelled).toBe(true)
    expect(printed.json().data.receipt.cancel_reason).toBe('keyed twice by mistake')
    expect((await call('POST', url, as.cashier, { reason: 'cancel it again' })).statusCode).toBe(409)
  })

  test('the cashier counts blind: an open session does not send its own cashier the totals', async () => {
    const mine = (await call('GET', `/finance/cash/sessions/${made.sessionId}`, as.cashier)).json().data.session
    expect(mine.totals_withheld).toBe(true)
    expect(mine.totals).toEqual([])
    expect(mine.receipts.length).toBe(4)
    const theirs = (await call('GET', `/finance/cash/sessions/${made.sessionId}`, as.accountant)).json().data.session
    expect(theirs.totals_withheld).toBe(false)
    expect(theirs.totals.find((t) => t.method === 'cash').amount).toBe('52.00')
    const desk = (await call('GET', '/finance/cash/desk', as.cashier)).json().data
    expect(desk.my_session.id).toBe(made.sessionId)
    expect(desk.readiness.cash_points).toBeGreaterThan(0)
  })

  test('cashing up: a difference must be explained, and before verification nothing is in the ledger', async () => {
    const url = `/finance/cash/sessions/${made.sessionId}/close`
    expect((await call('POST', url, as.relief, { counts: [{ currency: 'USD', declared_total: '102.00' }] })).statusCode).toBe(403)
    const unexplained = await call('POST', url, as.cashier, { counts: [{ currency: 'USD', declared_total: '100.00' }] })
    expect(unexplained.statusCode).toBe(409)
    expect(unexplained.json().error).toBe('count_incomplete')

    const closed = await call('POST', url, as.cashier, {
      counts: [{ currency: 'USD', declared_total: '100.00', explanation: 'Two dollars short; change given in error' }],
    })
    expect(closed.statusCode).toBe(200)
    const usd = closed.json().data.session.counts.find((c) => c.currency === 'USD')
    expect([usd.opening_float, usd.expected_takings, usd.declared_total, usd.variance]).toEqual(['50.00', '52.00', '100.00', '-2.00'])
    expect(closed.json().data.session.totals_withheld).toBe(false)

    const late = await call('POST', '/finance/cash/receipts', as.cashier, {
      session_id: made.sessionId, payer_name: 'Late Payer', currency: 'USD', method: 'cash', lines: marketLine('5.00'),
    })
    expect(late.statusCode).toBe(409)
    expect(late.json().error).toBe('session_state')

    const { rows } = await sys.query(
      `SELECT count(*)::int AS n FROM finance.ledger_entry WHERE financial_year_id = $1`, [made.yearId])
    expect(rows[0].n).toBe(0)
  })

  test('verification is somebody else\'s, needs somewhere to post a difference, and posts the whole session', async () => {
    const url = `/finance/cash/sessions/${made.sessionId}/verify`
    expect((await call('POST', url, as.cashier, {})).statusCode).toBe(403)
    expect((await call('POST', url, as.revenue, {})).statusCode).toBe(403)
    expect((await call('POST', url, as.ceo, {})).statusCode).toBe(403)

    const nowhere = await call('POST', url, as.accountant, {})
    expect(nowhere.statusCode).toBe(409)
    expect(nowhere.json().error).toBe('difference_account_missing')

    const inUse = await call('PATCH', `/finance/cash/points/${made.pointId}`, as.director, { status: 'inactive' })
    expect(inUse.statusCode).toBe(409)
    expect((await call('PATCH', `/finance/cash/points/${made.pointId}`, as.director, { difference_account_id: made.diff })).statusCode).toBe(200)

    const verified = await call('POST', url, as.accountant, { note: 'counted with the cashier' })
    expect(verified.statusCode).toBe(200)
    expect(verified.json().data.vouchers_posted).toBe(4) // 3 live receipts + 1 difference journal
    expect(verified.json().data.session.status).toBe('verified')

    const balance = async (accountId) => (await sys.query(
      `SELECT COALESCE(sum(debit - credit), 0)::text AS b FROM finance.ledger_entry WHERE ledger_account_id = $1`, [accountId])).rows[0].b
    expect(await balance(made.till)).toBe('50.00')   // 52.00 receipted in cash, 2.00 short
    expect(await balance(made.bank)).toBe('30.00')   // the wallet payment, never in the till
    expect(await balance(made.diff)).toBe('2.00')
    expect(await balance(made.hall)).toBe('-40.00')
    expect(await balance(made.marketAcct)).toBe('-42.00')

    expect((await call('POST', url, as.accountant, {})).statusCode).toBe(409)
  })

  test('the banking: only what the ledger says the till holds, and not posted by whoever prepared it', async () => {
    const deposit = (amount, slip = 'SLIP-0091') => call('POST', '/finance/cash/deposits', as.cashier, {
      cash_point_id: made.pointId, currency: 'USD', amount, bank_account_id: made.bank,
      financial_year_id: made.yearId, slip_reference: slip,
    })
    expect((await call('POST', '/finance/cash/deposits', as.accountant, {
      cash_point_id: made.pointId, currency: 'USD', amount: '1.00', bank_account_id: made.bank, slip_reference: 'SLIP-X',
    })).statusCode).toBe(403)
    const tooMuch = await deposit('60.00')
    expect(tooMuch.statusCode).toBe(409)
    expect(tooMuch.json().error).toBe('nothing_to_bank')

    const made50 = await deposit('50.00')
    expect(made50.statusCode).toBe(201)
    const id = made50.json().data.deposit.id
    expect((await deposit('1.00', 'SLIP-0092')).statusCode).toBe(409)

    expect((await call('POST', `/finance/cash/deposits/${id}/post`, as.cashier)).statusCode).toBe(403)
    const posted = await call('POST', `/finance/cash/deposits/${id}/post`, as.accountant)
    expect(posted.statusCode).toBe(200)
    const { rows } = await sys.query(
      `SELECT COALESCE(sum(debit - credit), 0)::text AS b FROM finance.ledger_entry WHERE ledger_account_id = $1`, [made.till])
    expect(rows[0].b).toBe('0.00')
  })

  test('a count can be sent back for recounting, by the verifier and not by the cashier', async () => {
    const opened = await call('POST', '/finance/cash/sessions', as.relief, { cash_point_id: made.pointId, financial_year_id: made.yearId })
    expect(opened.statusCode).toBe(201)
    const id = opened.json().data.session.id
    expect((await call('POST', '/finance/cash/receipts', as.relief, {
      session_id: id, payer_name: 'R. Dube', currency: 'USD', method: 'cash', lines: marketLine('20.00'),
    })).statusCode).toBe(201)
    expect((await call('POST', `/finance/cash/sessions/${id}/close`, as.relief, {
      counts: [{ currency: 'USD', declared_total: '2.00', explanation: 'mistyped, should read 20.00' }],
    })).statusCode).toBe(200)
    expect((await call('POST', `/finance/cash/sessions/${id}/return`, as.relief, { reason: 'let me recount' })).statusCode).toBe(403)
    const returned = await call('POST', `/finance/cash/sessions/${id}/return`, as.accountant, { reason: 'count reads 2.00; please recount' })
    expect(returned.statusCode).toBe(200)
    expect(returned.json().data.session.status).toBe('open')
    expect((await call('POST', `/finance/cash/sessions/${id}/close`, as.relief, {
      counts: [{ currency: 'USD', declared_total: '20.00' }],
    })).statusCode).toBe(200)
    const verified = await call('POST', `/finance/cash/sessions/${id}/verify`, as.director, {})
    expect(verified.statusCode).toBe(200)
    expect(verified.json().data.vouchers_posted).toBe(1)
  })

  test('the auditor and the accounting officer read every session and receipt and write none', async () => {
    for (const who of [as.auditor, as.ceo]) {
      expect((await call('GET', '/finance/cash/sessions', who)).statusCode).toBe(200)
      expect((await call('GET', `/finance/cash/sessions/${made.sessionId}`, who)).statusCode).toBe(200)
      expect((await call('GET', `/finance/cash/receipts?session_id=${made.sessionId}`, who)).json().data.total).toBe(4)
      expect((await call('GET', '/finance/cash/deposits', who)).statusCode).toBe(200)
      const writes = [
        ['POST', '/finance/cash/sessions', { cash_point_id: made.pointId }],
        ['POST', '/finance/cash/receipts', { session_id: made.sessionId, payer_name: 'X Y', currency: 'USD', method: 'cash', lines: marketLine('1.00') }],
        ['POST', `/finance/cash/receipts/${made.marketReceipt}/cancel`, { reason: 'should not work' }],
        ['POST', `/finance/cash/sessions/${made.sessionId}/verify`, {}],
        ['POST', '/finance/cash/deposits', { cash_point_id: made.pointId, currency: 'USD', amount: '1.00', bank_account_id: made.bank, slip_reference: 'SLIP-X' }],
        ['POST', '/finance/cash/income-codes', { code: 'X', name: 'XX', ledger_account_id: made.hall }],
      ]
      for (const [method, url, body] of writes) expect((await call(method, url, who, body)).statusCode).toBe(403)
    }
  })
})
