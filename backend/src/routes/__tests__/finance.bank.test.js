/**
 * Bank reconciliation end to end: import a statement, match it to the cashbook, journal what the
 * cashbook is missing, and complete — with the refusals along the way.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.bank.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')
const { readStatementRows } = require('../finance-bank')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `BK${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10) }
const dmy = (iso) => iso.split('-').reverse().join('/')

describe('reading a statement file', () => {
  const headers = ['Date', 'Details', 'Debit', 'Credit', 'Balance']
  const map = { txn_date: 'Date', description: 'Details', money_out: 'Debit', money_in: 'Credit' }
  test('money out is negative, money in positive, and a balance-only row is skipped', () => {
    const { lines, problems } = readStatementRows(headers, [
      ['01/07/2026', 'Balance brought forward', '', '', '1,000.00'],
      ['02/07/2026', 'Deposit', '', '500.00', '1,500.00'],
      ['03/07/2026', 'Bank charges', '12.50', '', '1,487.50'],
    ], map)
    expect(problems).toEqual([])
    expect(lines.map((l) => [l.line_no, l.txn_date, l.amount])).toEqual([[1, '2026-07-02', '500.00'], [2, '2026-07-03', '-12.50']])
  })
  test('an amount with no date, or an unreadable figure, refuses the file', () => {
    expect(readStatementRows(headers, [['', 'Deposit', '', '5.00', '']], map).problems).toHaveLength(1)
    expect(readStatementRows(headers, [['02/07/2026', 'Deposit', '', 'five', '']], map).problems).toHaveLength(1)
    expect(readStatementRows(headers, [['02/07/2026', 'x', '1.00', '2.00', '']], map).problems[0]).toMatch(/both/)
  })
  test('a single signed amount column', () => {
    const { lines } = readStatementRows(['Date', 'Amount'], [['2026-07-02', '(40.00)'], ['2026-07-03', '15']], { txn_date: 'Date', amount: 'Amount' })
    expect(lines.map((l) => l.amount)).toEqual(['-40.00', '15.00'])
  })
})

describe('bank reconciliation', () => {
  let app
  let sys
  const as = {}
  const made = {}
  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const upload = (token, fields, csv) => {
    const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
    const body = [
      ...Object.entries(fields).map(([n, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="statement.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')
    return app.inject({ method: 'POST', url: '/api/finance/bank/statements',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
  }
  const journal = async (no, date, lines, reference) => {
    const res = await call('POST', '/finance/ledger/vouchers', as.accountant, {
      voucher_no: `${TAG}-${no}`, voucher_type: 'journal', currency: 'USD', financial_year_id: made.yearId, posting_date: date,
      ...(reference ? { reference } : {}), lines,
    })
    expect(res.statusCode).toBe(201)
    expect((await call('POST', `/finance/ledger/vouchers/${res.json().data.voucher.id}/post`, as.director, { expected_version: res.json().data.voucher.version })).statusCode).toBe(200)
  }
  const detail = async () => (await call('GET', `/finance/bank/statements/${made.statement}`, as.auditor)).json().data

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    for (const [k, email] of Object.entries({
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test',
      auditor: 'demo.auditor@vungu.test', cashier: 'demo.cashier@vungu.test',
    })) as[k] = await loginAs(app, email, PASSWORD)
    const year = await call('POST', '/finance/financial-years', as.director,
      { label: `${TAG} Bank year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD' })
    if (year.statusCode !== 201) throw new Error(year.body)
    made.yearId = year.json().data.id
    await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)
    await call('POST', '/finance/ledger/periods', as.director, { financial_year_id: made.yearId, periodicity: 'monthly' })
    const account = async (code, name, root, type) => (await call('POST', '/finance/ledger/accounts', as.director,
      { code: `${TAG}-${code}`, name, root_type: root, ...(type ? { account_type: type } : {}) })).json().data.id
    made.bank = await account('1100', 'Bank test account', 'asset', 'bank')
    made.income = await account('4000', 'Bank test income', 'revenue')
    made.expense = await account('5000', 'Bank test expense', 'expense')
    made.surplus = await account('3000', 'Bank test equity', 'equity')

    const dr = (amount) => ({ ledger_account_id: made.bank, debit: amount })
    const cr = (amount) => ({ ledger_account_id: made.bank, credit: amount })
    await journal('OPEN', day(-30), [dr('1000.00'), { ledger_account_id: made.surplus, credit: '1000.00' }])
    await journal('DEP1', day(-20), [dr('500.00'), { ledger_account_id: made.income, credit: '500.00' }], 'SLIP-881')
    await journal('PAY1', day(-18), [cr('200.00'), { ledger_account_id: made.expense, debit: '200.00' }], 'CHQ-0042')
    // Two receipts of the same amount in the same week: no machine may choose between them.
    await journal('DEP2', day(-15), [dr('75.00'), { ledger_account_id: made.income, credit: '75.00' }])
    await journal('DEP3', day(-14), [dr('75.00'), { ledger_account_id: made.income, credit: '75.00' }])
    // A cheque the bank has not yet paid.
    await journal('PAY2', day(-13), [cr('120.00'), { ledger_account_id: made.expense, debit: '120.00' }], 'CHQ-0043')
  })

  afterAll(async () => {
    if (!app) return
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      const st = 'SELECT id FROM finance.bank_statement WHERE bank_account_id = $1'
      await client.query(`DELETE FROM finance.bank_match_entry WHERE match_id IN (SELECT id FROM finance.bank_match WHERE statement_id IN (${st}))`, [made.bank])
      await client.query(`DELETE FROM finance.bank_statement_line WHERE statement_id IN (${st})`, [made.bank])
      await client.query(`DELETE FROM finance.bank_match WHERE statement_id IN (${st})`, [made.bank])
      await client.query('DELETE FROM finance.bank_statement WHERE bank_account_id = $1', [made.bank])
      await client.query('DELETE FROM finance.ledger_entry WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE financial_year_id = $1)', [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
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

  // Opening 1000.00; +500 −200 +75 +75 −12.50 (charges the cashbook does not have) = 1437.50
  const csv = () => [
    'Date,Details,Reference,Debit,Credit,Balance',
    `${dmy(day(-30))},Balance brought forward,,,,"1,000.00"`,
    `${dmy(day(-19))},Cash deposit SLIP-881,SLIP-881,,500.00,"1,500.00"`,
    `${dmy(day(-16))},Cheque CHQ-0042,CHQ-0042,200.00,,"1,300.00"`,
    `${dmy(day(-14))},Transfer in,,,75.00,"1,375.00"`,
    `${dmy(day(-13))},Transfer in,,,75.00,"1,450.00"`,
    `${dmy(day(-12))},Monthly service fee,,12.50,,"1,437.50"`,
  ].join('\r\n')
  const fields = () => ({ bank_account_id: made.bank, currency: 'USD', opening_balance: '1000.00', closing_balance: '1437.50', statement_ref: 'Statement 7' })

  test('importing: permissions, an account that is not a bank, and unmapped columns', async () => {
    expect((await upload(as.auditor, fields(), csv())).statusCode).toBe(403)
    expect((await upload(as.cashier, fields(), csv())).statusCode).toBe(403)
    expect((await upload(as.accountant, { ...fields(), bank_account_id: made.income }, csv())).json().error).toBe('bad_bank_account')
    const odd = await upload(as.accountant, fields(), 'When,What,Out,In\r\n02/07/2026,x,,5.00')
    expect(odd.statusCode).toBe(409)
    expect(odd.json()).toMatchObject({ error: 'columns_not_mapped', headers: ['When', 'What', 'Out', 'In'] })

    const res = await upload(as.accountant, fields(), csv())
    expect(res.statusCode).toBe(201)
    made.statement = res.json().data.id
    expect(res.json().data).toMatchObject({ lines: 5, summary: { lines_unmatched: 5, file_adds_up: true, cashbook_balance: '1330.00' } })
    expect((await upload(as.accountant, fields(), csv())).json().error).toBe('already_imported')
  })

  test('auto-match takes only what can be one thing; the twin deposits are left for a person', async () => {
    const res = await call('POST', `/finance/bank/statements/${made.statement}/auto-match`, as.accountant)
    expect(res.json().data.matched).toBe(2)
    const d = await detail()
    const unmatched = d.lines.filter((l) => !l.match_id)
    expect(unmatched.map((l) => l.amount)).toEqual(['75.00', '75.00', '-12.50'])
    expect(d.cashbook.map((e) => e.amount).sort()).toEqual(['-120.00', '1000.00', '75.00', '75.00'])
  })

  test('a match must be equal, and an entry is ticked off once', async () => {
    const d = await detail()
    const [in1, in2, fee] = d.lines.filter((l) => !l.match_id)
    const dep = d.cashbook.filter((e) => e.amount === '75.00')
    const unequal = await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [in1.id, fee.id], entry_ids: [dep[0].id] })
    expect(unequal.statusCode).toBe(409)
    expect(unequal.json()).toMatchObject({ error: 'match_not_equal' })
    expect((await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.auditor, { line_ids: [in1.id], entry_ids: [dep[0].id] })).statusCode).toBe(403)

    // Two lines against two entries in one match.
    const both = await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [in1.id, in2.id], entry_ids: dep.map((e) => e.id) })
    expect(both.statusCode).toBe(201)
    const again = await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [fee.id], entry_ids: [dep[0].id] })
    expect(again.json().error).toBe('item_not_available')

    // Undo and redo one at a time.
    expect((await call('DELETE', `/finance/bank/matches/${both.json().data.match_id}`, as.accountant)).statusCode).toBe(200)
    expect((await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [in1.id], entry_ids: [dep[0].id] })).statusCode).toBe(201)
    expect((await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [in2.id], entry_ids: [dep[1].id] })).statusCode).toBe(201)
    made.fee = fee.id
  })

  test('completion is refused while a line is unmatched; the bank charge is journalled, posted by another, then matched', async () => {
    const early = await call('POST', `/finance/bank/statements/${made.statement}/complete`, as.accountant)
    expect(early.json()).toMatchObject({ error: 'lines_unmatched' })

    await journal('FEE', day(-12), [{ ledger_account_id: made.bank, credit: '12.50' }, { ledger_account_id: made.expense, debit: '12.50' }])
    const d = await detail()
    const entry = d.cashbook.find((e) => e.amount === '-12.50')
    expect((await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [made.fee], entry_ids: [entry.id] })).statusCode).toBe(201)

    const s = (await detail()).summary
    // Cashbook 1317.50; the opening journal is not on any statement, and cheque 0043 is unpresented.
    expect(s).toMatchObject({ lines_unmatched: 0, cashbook_balance: '1317.50', unpresented_payments: '120.00', deposits_in_transit: '1000.00', agrees: false })
  })

  test('the opening balance is matched off against nothing only when it nets to nil; otherwise the balances must be explained', async () => {
    const d = await detail()
    const opening = d.cashbook.find((e) => e.amount === '1000.00')
    // A cashbook entry cannot be ticked off against no statement line unless the set nets to nil.
    const alone = await call('POST', `/finance/bank/statements/${made.statement}/matches`, as.accountant, { line_ids: [], entry_ids: [opening.id] })
    expect(alone.json().error).toBe('match_not_equal')
    const refused = await call('POST', `/finance/bank/statements/${made.statement}/complete`, as.accountant)
    expect(refused.json()).toMatchObject({ error: 'balances_disagree' })

    // The opening balance was on the PREVIOUS statement. Import and reconcile that one first.
    const prior = await upload(as.accountant,
      { bank_account_id: made.bank, currency: 'USD', opening_balance: '0.00', closing_balance: '1000.00', statement_ref: 'Statement 6' },
      `Date,Details,Debit,Credit\r\n${dmy(day(-30))},Opening deposit,,"1,000.00"`)
    expect(prior.statusCode).toBe(201)
    const priorId = prior.json().data.id
    expect((await call('POST', `/finance/bank/statements/${priorId}/auto-match`, as.accountant)).json().data.matched).toBe(1)
    expect((await call('POST', `/finance/bank/statements/${priorId}/complete`, as.accountant)).statusCode).toBe(200)

    const s = (await detail()).summary
    expect(s).toMatchObject({ deposits_in_transit: '0.00', unpresented_payments: '120.00', adjusted_cashbook: '1437.50', difference: '0.00', agrees: true })
    const done = await call('POST', `/finance/bank/statements/${made.statement}/complete`, as.accountant)
    expect(done.statusCode).toBe(200)
    expect(done.json().data.summary).toMatchObject({ unpresented_payments: 120 })
  })

  test('a reconciled statement is closed, and the account shows where it stands', async () => {
    const d = await detail()
    const match = d.matched_entries[0].match_id
    expect((await call('DELETE', `/finance/bank/matches/${match}`, as.accountant)).json().error).toBe('statement_closed')
    expect((await call('POST', `/finance/bank/statements/${made.statement}/cancel`, as.accountant, { reason: 'Mistake' })).json().error).toBe('statement_closed')
    const positions = (await call('GET', '/finance/bank/accounts', as.auditor)).json().data.positions
    expect(positions.find((p) => p.id === made.bank)).toMatchObject({
      cashbook_balance: '1317.50', reconciled_to: day(-12), reconciled_balance: '1437.50', unmatched_entries: 1, open_statements: 0,
    })
  })
})
