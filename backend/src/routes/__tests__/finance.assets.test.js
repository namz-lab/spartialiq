/**
 * The asset register end to end: categories, registering, a depreciation run and its approval, the
 * cap at the depreciable amount, the register against the ledger, and a disposal.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.assets.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `FA${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10) }

describe('the asset register', () => {
  let app
  let sys
  const as = {}
  const made = {}
  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const balance = async (account) => (await sys.query(
    'SELECT COALESCE(sum(debit) - sum(credit), 0)::text AS net FROM finance.ledger_entry WHERE ledger_account_id = $1', [account])).rows[0].net
  const asset = async (id) => (await call('GET', `/finance/assets?q=${TAG}`, as.auditor)).json().data.assets.find((a) => a.id === id)
  const run = (period, who = as.officer) => call('POST', '/finance/assets/runs', who, { ledger_period_id: period, currency: 'USD' })

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    for (const [k, email] of Object.entries({
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test', officer: 'demo.finance-officer@vungu.test',
      auditor: 'demo.auditor@vungu.test',
    })) as[k] = await loginAs(app, email, PASSWORD)
    const year = await call('POST', '/finance/financial-years', as.director,
      { label: `${TAG} Asset year`, start_date: day(-100), end_date: day(260), reporting_currency: 'USD' })
    if (year.statusCode !== 201) throw new Error(year.body)
    made.yearId = year.json().data.id
    await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)
    await call('POST', '/finance/ledger/periods', as.director, { financial_year_id: made.yearId, periodicity: 'monthly' })
    const { rows: periods } = await sys.query(
      `SELECT id, from_date::text, to_date::text FROM finance.ledger_period WHERE financial_year_id = $1 AND to_date <= CURRENT_DATE + 31 ORDER BY period_no`, [made.yearId])
    made.periods = periods
    const account = async (code, name, root, type) => (await call('POST', '/finance/ledger/accounts', as.director,
      { code: `${TAG}-${code}`, name, root_type: root, ...(type ? { account_type: type } : {}) })).json().data.id
    made.cost = await account('1500', 'Asset test vehicles', 'asset', 'fixed_asset')
    made.accum = await account('1510', 'Asset test accumulated depreciation', 'asset')
    made.land = await account('1400', 'Asset test land', 'asset', 'fixed_asset')
    made.expense = await account('5600', 'Asset test depreciation', 'expense')
    made.bank = await account('1100', 'Asset test bank', 'asset', 'bank')
    made.gain = await account('4900', 'Asset test disposal gains and losses', 'revenue')
    made.equity = await account('3000', 'Asset test equity', 'equity')
    // The vehicle's cost reaches the ledger by the document that bought it: here, a journal.
    const j = await call('POST', '/finance/ledger/vouchers', as.accountant, {
      voucher_no: `${TAG}-BUY`, voucher_type: 'journal', currency: 'USD', financial_year_id: made.yearId, posting_date: made.periods[0].from_date,
      lines: [{ ledger_account_id: made.cost, debit: '12000.00' }, { ledger_account_id: made.equity, credit: '12000.00' }],
    })
    await call('POST', `/finance/ledger/vouchers/${j.json().data.voucher.id}/post`, as.director, { expected_version: j.json().data.voucher.version })
  })

  afterAll(async () => {
    if (!app) return
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      await client.query('DELETE FROM finance.depreciation_charge WHERE run_id IN (SELECT id FROM finance.depreciation_run WHERE financial_year_id = $1)', [made.yearId])
      await client.query('DELETE FROM finance.depreciation_run WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.fixed_asset WHERE name LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.asset_category WHERE code LIKE $1', [`${TAG}%`])
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

  test('categories: a depreciated category must be complete; land is not depreciated', async () => {
    const incomplete = await call('POST', '/finance/assets/categories', as.officer,
      { code: `${TAG}-VEH`, name: `${TAG} Vehicles`, asset_account_id: made.cost, method: 'straight_line' })
    expect(incomplete.json().error).toBe('category_incomplete')
    expect((await call('POST', '/finance/assets/categories', as.auditor, { code: 'X', name: 'Xy', asset_account_id: made.cost, method: 'none' })).statusCode).toBe(403)
    const veh = await call('POST', '/finance/assets/categories', as.officer, {
      code: `${TAG}-VEH`, name: `${TAG} Vehicles`, asset_account_id: made.cost, accumulated_account_id: made.accum,
      expense_account_id: made.expense, method: 'straight_line', useful_life_months: 5, residual_pct: 10,
    })
    expect(veh.statusCode).toBe(201)
    made.vehicles = veh.json().data.id
    made.landCat = (await call('POST', '/finance/assets/categories', as.officer,
      { code: `${TAG}-LAND`, name: `${TAG} Land`, asset_account_id: made.land, method: 'none' })).json().data.id
  })

  test('registering posts nothing, and takes the category\'s residual percentage', async () => {
    const before = await balance(made.cost)
    const res = await call('POST', '/finance/assets', as.officer, {
      name: `${TAG} Toyota Hilux`, category_id: made.vehicles, currency: 'USD', cost: '12000.00',
      acquired_on: made.periods[0].from_date, serial_no: 'AFB 1234', custodian: 'Works',
    })
    expect(res.statusCode).toBe(201)
    made.hilux = res.json().data.id
    expect(res.json().data.asset_no).toMatch(/^FA-\d{7}$/)
    expect(await balance(made.cost)).toBe(before)
    expect(await asset(made.hilux)).toMatchObject({ cost: '12000.00', residual_value: '1200.00', carrying_amount: '12000.00', status: 'in_use', useful_life_months: 5 })
    made.plot = (await call('POST', '/finance/assets', as.officer,
      { name: `${TAG} Depot stand`, category_id: made.landCat, currency: 'USD', cost: '30000.00', acquired_on: made.periods[0].from_date })).json().data.id
    expect((await asset(made.plot)).status).toBe('not_depreciated')
    expect((await call('POST', '/finance/assets', as.officer,
      { name: `${TAG} Bad`, category_id: made.vehicles, currency: 'USD', cost: '100.00', residual_value: '100.00', acquired_on: day(-5) })).json().error).toBe('bad_residual')
  })

  test('a run is a draft until somebody else approves it; land is left out; a second run for the period is refused', async () => {
    const first = await run(made.periods[0].id)
    expect(first.statusCode).toBe(201)
    made.run = first.json().data.id
    // (12000 − 1200) ÷ 5 months = 2160.00 a month.
    const charges = (await call('GET', `/finance/assets/runs/${made.run}`, as.auditor)).json().data.charges
    expect(charges).toEqual([expect.objectContaining({ amount: '2160.00' })])
    expect(await balance(made.accum)).toBe('0')
    expect(await asset(made.hilux)).toMatchObject({ charged: '0.00', charged_in_draft: '2160.00', carrying_amount: '12000.00' })
    expect((await run(made.periods[0].id)).json().error).toBe('already_run')

    expect((await call('POST', `/finance/assets/runs/${made.run}/approve`, as.officer)).statusCode).toBe(403)
    const own = await run(made.periods[1].id, as.accountant)
    expect((await call('POST', `/finance/assets/runs/${own.json().data.id}/approve`, as.accountant)).json().error).toBe('separation_of_duties')
    expect((await call('DELETE', `/finance/assets/runs/${own.json().data.id}`, as.accountant)).statusCode).toBe(200)

    expect((await call('POST', `/finance/assets/runs/${made.run}/approve`, as.accountant)).statusCode).toBe(200)
    expect(await balance(made.accum)).toBe('-2160.00')
    expect(await balance(made.expense)).toBe('2160.00')
    expect(await asset(made.hilux)).toMatchObject({ charged: '2160.00', accumulated: '2160.00', carrying_amount: '9840.00' })
    // Charged on these figures: they are frozen. Where it is kept can still be changed.
    expect((await call('PATCH', `/finance/assets/${made.hilux}`, as.officer, { cost: '15000.00' })).statusCode).toBe(409)
    expect((await call('PATCH', `/finance/assets/${made.hilux}`, as.officer, { location: 'Depot B' })).statusCode).toBe(200)
  })

  test('the register is shown against the ledger, per category', async () => {
    const { comparison } = (await call('GET', '/finance/assets/categories', as.auditor)).json().data
    expect(comparison.find((c) => c.category_id === made.vehicles)).toMatchObject({
      register_cost: '12000.00', ledger_cost: '12000.00', register_accumulated: '2160.00', ledger_accumulated: '2160.00', agrees: true,
    })
    // The stand was registered and never bought through this ledger: the difference is shown.
    expect(comparison.find((c) => c.category_id === made.landCat)).toMatchObject({ register_cost: '30000.00', ledger_cost: '0.00', cost_difference: '30000.00', agrees: false })
  })

  test('a disposal removes cost and depreciation, takes the proceeds, and posts the difference', async () => {
    const body = { disposed_on: made.periods[1].from_date, proceeds: '9000.00', proceeds_account_id: made.bank, note: 'Sold at auction, lot 14' }
    expect((await call('POST', `/finance/assets/${made.hilux}/dispose`, as.officer, body)).json().message).toMatch(/loss of 840\.00/)
    const res = await call('POST', `/finance/assets/${made.hilux}/dispose`, as.officer, { ...body, gain_loss_account_id: made.gain })
    expect(res.statusCode).toBe(201)
    expect((await asset(made.hilux)).status).toBe('disposal_awaiting_approval')
    // Not depreciated further while a disposal stands.
    expect((await run(made.periods[1].id)).json().message).toMatch(/no asset in USD has depreciation to charge/)
    expect((await call('POST', `/finance/assets/${made.hilux}/disposal/approve`, as.officer)).statusCode).toBe(403)
    expect((await call('POST', `/finance/assets/${made.hilux}/disposal/approve`, as.director)).statusCode).toBe(200)

    expect(await balance(made.cost)).toBe('0.00')
    expect(await balance(made.accum)).toBe('0.00')
    expect(await balance(made.bank)).toBe('9000.00')
    expect(await balance(made.gain)).toBe('840.00')
    expect(await asset(made.hilux)).toMatchObject({ status: 'disposed', disposal_proceeds: '9000.00' })
    expect((await call('POST', `/finance/assets/${made.hilux}/dispose`, as.officer, { ...body, gain_loss_account_id: made.gain })).statusCode).toBe(409)
  })

  test('depreciation never goes past the depreciable amount: the last month takes what remains', async () => {
    const res = await call('POST', '/finance/assets', as.officer, {
      name: `${TAG} Generator`, category_id: made.vehicles, currency: 'USD', cost: '1000.00', residual_value: '0.00',
      accumulated_opening: '900.00', acquired_on: made.periods[0].from_date, useful_life_months: 3,
    })
    const id = res.json().data.id
    const r = await run(made.periods[1].id)
    expect(r.statusCode).toBe(201)
    // A month is 333.33; only 100.00 is left.
    expect((await call('GET', `/finance/assets/runs/${r.json().data.id}`, as.auditor)).json().data.charges).toEqual([expect.objectContaining({ amount: '100.00' })])
    await call('POST', `/finance/assets/runs/${r.json().data.id}/approve`, as.accountant)
    expect(await asset(id)).toMatchObject({ carrying_amount: '0.00', status: 'fully_depreciated' })
    if (made.periods[2]) expect((await run(made.periods[2].id)).statusCode).toBe(409)
  })
})
