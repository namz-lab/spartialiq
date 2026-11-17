/**
 * The salaries journal end to end: the month's totals raised as a DRAFT `payroll` voucher numbered
 * SJ- from its own series (migration 243), posted by somebody other than its preparer, never
 * typed by hand, and the statutory bodies the deductions name then read on Tax Control.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.salaries.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `PY${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10) }

describe('the salaries journal', () => {
  let app
  let sys
  const as = {}
  const made = {}
  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const balance = async (account) => (await sys.query(
    'SELECT COALESCE(sum(debit) - sum(credit), 0)::text AS net FROM finance.ledger_entry WHERE ledger_account_id = $1 AND financial_year_id = $2',
    [account, made.yearId])).rows[0].net

  /** The month the fixture posts: gross 20,000, employer's contributions 1,800; PAYE 4,200, NSSA 2,700 (employee 900 and employer 1,800), net 14,900 from the bank. */
  const month = () => ({
    currency: 'USD', financial_year_id: made.yearId, posting_date: day(-10),
    narration: 'Salaries for the fixture month',
    lines: [
      { ledger_account_id: made.salaries, debit: '20000.00', narration: 'Gross salaries' },
      { ledger_account_id: made.salaries, debit: '1800.00', narration: "Employer's contributions" },
      { ledger_account_id: made.paye, credit: '4200.00', party_id: made.zimra, narration: 'PAYE (ZIMRA)' },
      { ledger_account_id: made.nssa, credit: '2700.00', party_id: made.nssaBody, narration: 'NSSA contributions' },
      { ledger_account_id: made.bank, credit: '14900.00', narration: 'Net pay' },
    ],
  })

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    for (const [k, email] of Object.entries({
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test',
      officer: 'demo.finance-officer@vungu.test', cashier: 'demo.cashier@vungu.test',
    })) as[k] = await loginAs(app, email, PASSWORD)
    const year = await call('POST', '/finance/financial-years', as.director,
      { label: `${TAG} Salaries year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD' })
    if (year.statusCode !== 201) throw new Error(year.body)
    made.yearId = year.json().data.id
    await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)
    await call('POST', '/finance/ledger/periods', as.director, { financial_year_id: made.yearId, periodicity: 'monthly' })
    const account = async (code, name, root, type) => (await call('POST', '/finance/ledger/accounts', as.director,
      { code: `${TAG}-${code}`, name, root_type: root, ...(type ? { account_type: type } : {}) })).json().data.id
    made.bank = await account('1100', 'Salaries test bank', 'asset', 'bank')
    made.salaries = await account('5100', 'Salaries test salaries', 'expense')
    made.paye = await account('2100', 'Salaries test PAYE', 'liability', 'tax')
    made.nssa = await account('2110', 'Salaries test NSSA', 'liability', 'tax')
    const party = async (name) => (await call('POST', '/finance/ledger/parties', as.accountant, { party_type: 'supplier', name: `${TAG} ${name}` })).json().data.id
    made.zimra = await party('ZIMRA')
    made.nssaBody = await party('NSSA')
  })

  afterAll(async () => {
    if (!app) return
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      await client.query('DELETE FROM finance.ledger_entry WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE financial_year_id = $1)', [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.party WHERE id = ANY($1::uuid[])', [[made.zimra, made.nssaBody].filter(Boolean)])
      await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.financial_year WHERE id = $1', [made.yearId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
      await app.close()
    }
  })

  test('the month\'s totals raise a balanced draft, numbered SJ- from its own series, posting nothing', async () => {
    expect((await call('POST', '/finance/ledger/salaries-journal', as.cashier, month())).statusCode).toBe(403)
    // A finance officer holds voucher.prepare and no more: preparing is the gate, as with a journal.
    const res = await call('POST', '/finance/ledger/salaries-journal', as.accountant, month())
    expect(res.statusCode).toBe(201)
    const d = res.json().data
    made.draftId = d.voucher.id
    expect(d.voucher.voucher_type).toBe('payroll')
    expect(d.voucher.voucher_no).toMatch(/^SJ-\d{7}$/)
    expect(d.voucher.status).toBe('draft')
    expect(d.voucher.prepared_by).toBeTruthy()
    expect(d.balances).toBe(true)
    expect(d.balance.difference).toBe('0.00')
    expect(d.note).toContain('somebody other than you posts it')
    const entries = await sys.query('SELECT count(*)::int AS n FROM finance.ledger_entry WHERE financial_year_id = $1', [made.yearId])
    expect(entries.rows[0].n).toBe(0)
  })

  test('a salaries journal cannot be typed by hand as a journal, and its number series is refused when typed', async () => {
    const typed = await call('POST', '/finance/ledger/vouchers', as.accountant, {
      ...month(), voucher_type: 'payroll', voucher_no: 'PAYROLL-1',
    })
    expect(typed.statusCode).toBe(400)
    expect(typed.json().error).toBe('system_type')
    expect(typed.json().message).toContain('salaries journal')
  })

  test('a draft salaries journal may be discarded by its preparer, and the number is spent', async () => {
    const second = await call('POST', '/finance/ledger/salaries-journal', as.accountant, month())
    expect(second.statusCode).toBe(201)
    const discarded = await call('DELETE', `/finance/ledger/vouchers/${second.json().data.voucher.id}`, as.accountant)
    expect(discarded.statusCode).toBe(200)
    const { rows } = await sys.query('SELECT status, voucher_no FROM finance.voucher WHERE id = $1', [second.json().data.voucher.id])
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].voucher_no).toMatch(/^SJ-\d{7}$/)
  })

  test('whoever prepared it cannot post it; the Director posts it and the books take the month', async () => {
    const own = await call('POST', `/finance/ledger/vouchers/${made.draftId}/post`, as.accountant, {})
    expect(own.statusCode).toBe(409)
    expect(own.json().error).toBe('separation_of_duties')

    const posted = await call('POST', `/finance/ledger/vouchers/${made.draftId}/post`, as.director, {})
    expect(posted.statusCode).toBe(200)
    expect(await balance(made.salaries)).toBe('21800.00')
    expect(await balance(made.paye)).toBe('-4200.00')
    expect(await balance(made.nssa)).toBe('-2700.00')
    expect(await balance(made.bank)).toBe('-14900.00')

    // The payroll filter finds it, and the queues see it no more (it is posted).
    const list = await call('GET', `/finance/ledger/vouchers?financial_year_id=${made.yearId}&voucher_type=payroll&status=posted`, as.accountant)
    expect(list.statusCode).toBe(200)
    const mine = list.json().data.vouchers.filter((v) => v.voucher_no.startsWith('SJ-') && v.narration === 'Salaries for the fixture month')
    expect(mine).toHaveLength(1)
    expect(mine[0].posted_by_name).toBeTruthy()
  })

  test('Tax Control reads the statutory bodies the payroll named, and the return is still not produced', async () => {
    const res = await call('GET', `/finance/accounting/tax?financial_year_id=${made.yearId}`, as.accountant)
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.note).toContain('no statutory return')

    const payeRow = d.parties.find((p) => p.party_id === made.zimra && p.ledger_account_id === made.paye)
    expect(payeRow).toMatchObject({ currency: 'USD', net_debit: '-4200.00', amount: '4200.00', side: 'Cr' })
    const nssaRow = d.parties.find((p) => p.party_id === made.nssaBody && p.ledger_account_id === made.nssa)
    expect(nssaRow).toMatchObject({ net_debit: '-2700.00', amount: '2700.00', side: 'Cr' })
    expect(d.parties.some((p) => p.currency === 'ZWG')).toBe(false)

    // The closing balance at each period end: nil before the payroll, the full credit from its period on.
    const closings = d.period_balances.filter((b) => b.ledger_account_id === made.paye && b.currency === 'USD')
    expect(closings.length).toBeGreaterThan(0)
    const firstHeld = closings.find((b) => Number(b.closing) !== 0)
    expect(firstHeld).toMatchObject({ closing: '-4200.00', side: 'Cr' })
    const before = closings.filter((b) => b.period_no < firstHeld.period_no)
    expect(before.every((b) => b.closing === '0.00' || Number(b.closing) === 0)).toBe(true)
  })
})
