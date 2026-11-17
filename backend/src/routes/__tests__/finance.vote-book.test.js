/**
 * The vote book end to end: the accountant's budget-control read over the same view the budget
 * reports use — per-vote budget, commitments, spending and what remains, the lines over budget,
 * revenue by class, and the lines not yet approved that no control covers.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.vote-book.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `VB${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

describe('the vote book', () => {
  let app
  let sys
  const as = {}
  const made = {}
  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    for (const [k, email] of Object.entries({
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test',
      treasurer: 'demo.treasurer@vungu.test', cashier: 'demo.cashier@vungu.test',
    })) as[k] = await loginAs(app, email, PASSWORD)

    const year = await call('POST', '/finance/financial-years', as.director,
      { label: `${TAG} Vote book year`, start_date: '2033-01-01', end_date: '2033-12-31', reporting_currency: 'USD' })
    if (year.statusCode !== 201) throw new Error(year.body)
    made.yearId = year.json().data.id
    await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)

    for (const [key, code, name, vote] of [
      ['works', `${TAG}-WKS`, 'Works and Roads', 3],
      ['health', `${TAG}-HLT`, 'Health Services', 5],
    ]) {
      const res = await call('POST', '/finance/departments', as.director, { code, name, vote_number: vote })
      if (res.statusCode !== 201) throw new Error(res.body)
      made[key] = res.json().data.id
    }

    const chart = await call('POST', '/finance/accounts/bulk', as.director, { accounts: [
      { code: `${TAG}-1100`, name: 'Property rates', kind: 'revenue', revenue_class: 'internally_generated' },
      { code: `${TAG}-1200`, name: 'Devolution grant', kind: 'revenue', revenue_class: 'grant' },
      { code: `${TAG}-5100`, name: 'Roads maintenance', kind: 'expenditure', expenditure_class: 'recurrent' },
      { code: `${TAG}-5200`, name: 'Clinic operating costs', kind: 'expenditure', expenditure_class: 'recurrent' },
    ] })
    if (chart.statusCode !== 200) throw new Error(chart.body)
    const all = (await call('GET', '/finance/accounts', as.director)).json().data
    const accountId = (suffix) => all.find((a) => a.code === `${TAG}-${suffix}`).id

    const line = async (payload, approve = true) => {
      const res = await call('POST', '/finance/budget-lines', as.director,
        { financial_year_id: made.yearId, currency: 'USD', ...payload })
      if (res.statusCode !== 201) throw new Error(res.body)
      const id = res.json().data.id
      if (!approve) return id
      await call('POST', `/finance/budget-lines/${id}/submit`, as.director)
      const ok = await call('POST', `/finance/budget-lines/${id}/approve`, as.treasurer, {})
      if (ok.statusCode !== 200) throw new Error(ok.body)
      return id
    }
    made.roadsUsd = await line({
      department_id: made.works, account_id: accountId('5100'), code: `${TAG}-WKS-ROADS`,
      description: 'Road rehabilitation and grading', original_amount: '500000.00',
    })
    made.clinicsUsd = await line({
      department_id: made.health, account_id: accountId('5200'), code: `${TAG}-HLT-CLINICS`,
      description: 'Clinic operating costs', original_amount: '200000.00',
    })
    made.ratesUsd = await line({
      department_id: made.works, account_id: accountId('1100'), code: `${TAG}-WKS-RATES`,
      description: 'Property rates collection', original_amount: '800000.00',
    })
    made.grantUsd = await line({
      department_id: made.works, account_id: accountId('1200'), code: `${TAG}-WKS-GRANT`,
      description: 'Devolution grant', original_amount: '500000.00',
    })
    made.roadsZwg = await line({
      department_id: made.works, account_id: accountId('5100'), code: `${TAG}-WKS-ROADS-ZWG`,
      description: 'Road maintenance funded in local currency', currency: 'ZWG', original_amount: '1000000.00',
    })
    // Still a draft: not under control, and the page must say so rather than count it.
    made.draftLine = await line({
      department_id: made.health, account_id: accountId('5200'), code: `${TAG}-HLT-DRAFT`,
      description: 'Not yet through the committee', original_amount: '10000.00',
    }, false)

    const { rows: [authority] } = await sys.query(
      'SELECT authority_id FROM finance.financial_year WHERE id = $1', [made.yearId])
    const officer = (await sys.query("SELECT id FROM public.users WHERE email = 'demo.finance-officer@vungu.test'")).rows[0].id
    const insertTx = async (key, { lineId, accountCode, deptId, date, amount, currency }) => {
      await sys.query(
        `INSERT INTO finance.transaction
           (authority_id, financial_year_id, account_id, department_id, budget_line_id, txn_date,
            amount, currency, description, reference, record_type, source_system, source_ref, posted_at, created_by)
         VALUES ($1,$2,(SELECT id FROM finance.account WHERE code = $3),
                 $4,$5,$6,$7::numeric,$8,$9,$10,'actual','SYNTHETIC_VUNGU',$11,now(),$12)`,
        [authority.authority_id, made.yearId, `${TAG}-${accountCode}`, deptId, lineId, date, amount, currency,
          'Vote book fixture', `${TAG}-${key}`, `${TAG}-${key}`, officer])
    }
    await insertTx('ROADS', { lineId: made.roadsUsd, accountCode: '5100', deptId: made.works, date: '2033-03-15', amount: '400000.00', currency: 'USD' })
    await insertTx('CLINICS', { lineId: made.clinicsUsd, accountCode: '5200', deptId: made.health, date: '2033-04-20', amount: '260000.00', currency: 'USD' })
    await insertTx('RATES', { lineId: made.ratesUsd, accountCode: '1100', deptId: made.works, date: '2033-02-10', amount: '850000.00', currency: 'USD' })
    await insertTx('GRANT', { lineId: made.grantUsd, accountCode: '1200', deptId: made.works, date: '2033-01-25', amount: '300000.00', currency: 'USD' })
    // An open commitment on the roads vote.
    await sys.query(
      `INSERT INTO finance.commitment
         (authority_id, budget_line_id, reference, committed_on, description, amount, liquidated_amount, currency, status, created_by)
       VALUES ($1,$2,$3,'2033-05-02','Grading contract, signed',$4::numeric,0,'USD','open',$5)`,
      [authority.authority_id, made.roadsUsd, `${TAG}-COMMIT`, '50000.00', officer])
  })

  afterAll(async () => {
    if (!app) return
    const pg = sys
    await pg.query(`UPDATE finance.financial_year SET status = 'open' WHERE label LIKE '${TAG}%'`).catch(() => {})
    const statements = [
      `DELETE FROM finance.commitment WHERE reference = '${TAG}-COMMIT'`,
      `DELETE FROM finance.transaction WHERE source_ref LIKE '${TAG}%'`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE label LIKE '${TAG}%'`,
    ]
    for (const statement of statements) await pg.query(statement).catch(() => {})
    await app.close()
  }, 60000)

  test('the read needs the budget permission: the cashier is refused, the accountant reads', async () => {
    expect((await call('GET', `/finance/accounting/vote-book?financial_year_id=${made.yearId}`, as.cashier)).statusCode).toBe(403)
    const res = await call('GET', `/finance/accounting/vote-book?financial_year_id=${made.yearId}`, as.accountant)
    expect(res.statusCode).toBe(200)
    made.read = res.json().data
  })

  test('each vote\'s budget, commitments, spending and what remains, one row per currency', () => {
    const d = made.read
    expect(d.year.id).toBe(made.yearId)

    const usd = d.totals.find((t) => t.currency === 'USD')
    expect(usd).toMatchObject({ budget: '700000.00', committed: '50000.00', actual: '660000.00', available: '-10000.00' })
    const zwg = d.totals.find((t) => t.currency === 'ZWG')
    expect(zwg).toMatchObject({ budget: '1000000.00', committed: '0.00', actual: '0.00', available: '1000000.00' })

    const works = d.votes.find((v) => v.currency === 'USD' && v.code === `${TAG}-WKS`)
    expect(works).toMatchObject({ vote_number: 3, budget: '500000.00', committed: '50000.00', actual: '400000.00', available: '50000.00', variance: '100000.00' })
    const health = d.votes.find((v) => v.currency === 'USD' && v.code === `${TAG}-HLT`)
    expect(health).toMatchObject({ budget: '200000.00', committed: '0.00', actual: '260000.00', available: '-60000.00', variance: '-60000.00' })

    // The two books are never combined: the ZWG vote stands alone.
    expect(d.votes.filter((v) => v.currency === 'ZWG')).toHaveLength(1)
  })

  test('a line spent past its vote is listed with what it is over by', () => {
    const over = made.read.over_budget
    expect(over).toHaveLength(1)
    expect(over[0]).toMatchObject({
      currency: 'USD', department_code: `${TAG}-HLT`, line_code: `${TAG}-HLT-CLINICS`,
      budget: '200000.00', spent: '260000.00', committed: '0.00', over_by: '60000.00',
    })
  })

  test('revenue is summarised apart, by the class the chart gives it', () => {
    const rev = made.read.revenue
    const rates = rev.find((r) => r.currency === 'USD' && r.revenue_class === 'internally_generated')
    expect(rates).toMatchObject({ budget: '800000.00', actual: '850000.00', variance: '50000.00' })
    const grant = rev.find((r) => r.currency === 'USD' && r.revenue_class === 'grant')
    expect(grant).toMatchObject({ budget: '500000.00', actual: '300000.00', variance: '-200000.00' })
  })

  test('a line still in draft is not controlled, and the page says how many there are', () => {
    expect(made.read.lines_not_yet_approved).toBeGreaterThanOrEqual(1)
    const controlled = [...made.read.votes.map((v) => v.actual), ...made.read.over_budget.map((o) => o.line_code)]
    expect(controlled).not.toContain(`${TAG}-HLT-DRAFT`)
  })
})
