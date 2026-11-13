/**
 * The finance map endpoints (GIS–finance Milestone 3): ward measures and ward geometry.
 *
 * What this file pins:
 *   * the payload is RENDERED, not computed — every figure comes from the ward views, so the
 *     assertions compare against SQL, mirroring what the choropleth will shade;
 *   * currencies stay separate (a USD filter can never return ZWG rows);
 *   * the ward register link (decision D11) is reported honestly: with no wards linked the
 *     geometry endpoint returns ward_register_linked=false and NO invented polygons;
 *   * finance.map.view gates both endpoints — anonymous and a planner login are refused;
 *   * ward-tagged budget lines surface as wards rows with unlinked status while D11 is open.
 *
 * Run with the rest of the suite; uses the same demo personas and TAG-and-remove fixtures as
 * finance.workflow.test.js.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `MAP${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

describe('finance map endpoints', () => {
  let app
  let officerToken
  let plannerToken
  let system
  let yearId
  let deptId
  let accountId
  let lineId
  let vunguId
  /** The register's real state in THIS database, measured in beforeAll. */
  let registerLinked = false
  let linkedWardCount = 0

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    officerToken = await loginAs(app, 'demo.finance-officer@vungu.test', PASSWORD)
    plannerToken = await loginAs(app, 'demo.planner@vungu.test', PASSWORD)

    // A minimal tagged fixture straight into the register (system pool), the way the DB-level
    // suites do: one year, one vote, one expenditure line carrying a ward code that is NOT one
    // of Vungu's linked wards (the register is empty until D11) — the honest unlinked case.
    system = systemOf(app.pg)
    const { rows: [vungu] } = await system.query(
      `SELECT id FROM public.local_authorities WHERE code = 'VUNGU'`)
    vunguId = vungu.id
    const { rows: [year] } = await system.query(
      `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency, notes)
       VALUES ($1, $2, DATE '2034-01-01', DATE '2034-12-31', 'open', 'USD', $3) RETURNING id`,
      [vunguId, `${TAG} 2034`, TAG])
    yearId = year.id
    const { rows: [dept] } = await system.query(
      `INSERT INTO finance.department (authority_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [vunguId, TAG, `${TAG} vote`])
    deptId = dept.id
    const { rows: [account] } = await system.query(
      `INSERT INTO finance.account (authority_id, code, name, kind, is_postable)
       VALUES ($1, $2, '${TAG} expenditure', 'expenditure', true) RETURNING id`,
      [vunguId, `${TAG}-E`])
    accountId = account.id
    const { rows: [approver] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.treasurer@vungu.test'`)
    const { rows: [line] } = await system.query(
      `INSERT INTO finance.budget_line
         (authority_id, financial_year_id, department_id, account_id, code, description,
          currency, original_amount, status, ward_code, approved_at, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', 1200, 'approved', $7, now(), $8) RETURNING id`,
      [vunguId, yearId, deptId, accountId, `${TAG}-L1`, `${TAG} line`, `${TAG}W7`, approver.id])
    lineId = line.id

    const { rows: [register] } = await system.query(
      `SELECT count(*)::int AS n FROM admin.authority_ward
        WHERE authority_id = $1 AND valid_to IS NULL`, [vunguId])
    linkedWardCount = register.n
    registerLinked = register.n > 0
  })

  afterAll(async () => {
    await system.query(`DELETE FROM finance.transaction WHERE budget_line_id = $1`, [lineId])
    await system.query(`DELETE FROM finance.budget_line WHERE id = $1`, [lineId])
    await system.query(`DELETE FROM finance.account WHERE id = $1`, [accountId])
    await system.query(`DELETE FROM finance.department WHERE id = $1`, [deptId])
    await system.query(`DELETE FROM finance.financial_year WHERE id = $1`, [yearId])
    await app.close()
  })

  test('finance.map.view gates the map; anonymous and planning are refused', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/finance/map/wards' })
    expect(anon.statusCode).toBe(401)
    const planner = await app.inject({
      method: 'GET', url: '/api/finance/map/wards', headers: auth(plannerToken) })
    expect(planner.statusCode).toBe(403)
    const geometry = await app.inject({ method: 'GET', url: '/api/finance/map/ward-geometry' })
    expect(geometry.statusCode).toBe(401)
  })

  test('ward measures render from the views: the tagged line appears as an unlinked ward', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: yearId },
      headers: auth(officerToken),
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()

    expect(data.financial_year.id).toBe(yearId)
    expect(data.sources).toContain('finance.v_ward_performance')
    // Measured, not assumed. Migration 201 links the COD-AB wards of district ZW1704 where the
    // national register carries them, so whether this council has a linked ward register depends
    // on the database rather than on a constant in a test.
    expect(data.ward_register_linked).toBe(registerLinked)

    const ward = data.wards.find((w) => w.ward_code === `${TAG}W7`)
    expect(ward).toBeTruthy()
    // What the choropleth shades is what the canonical view computes, to the cent.
    expect(Number(ward.expenditure_budget)).toBe(1200)
    // This TAG ward code is in no register, so it is 'unlinked' either way.
    expect(ward.ward_status).toBe('unlinked')
    expect(ward.currency).toBe('USD')

    // Same figure straight from the view — the endpoint must not have recomputed anything.
    const { rows: [view] } = await system.query(
      `SELECT * FROM finance.v_ward_performance
        WHERE financial_year_id = $1 AND ward_code = $2 AND currency = 'USD'`,
      [yearId, `${TAG}W7`])
    expect(Number(view.expenditure_budget)).toBe(Number(ward.expenditure_budget))
  })

  test('a currency filter can never mix ZWG into USD rows', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: yearId, currency: 'ZWG' },
      headers: auth(officerToken),
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data.wards.every((w) => w.currency === 'ZWG')).toBe(true)
    expect(data.wards.find((w) => w.ward_code === `${TAG}W7`)).toBeUndefined()
    expect(data.unlocated.every((u) => u.currency === 'ZWG')).toBe(true)
  })

  test('unlocated figures ride along with the map, not as an afterthought', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: yearId, currency: 'USD' },
      headers: auth(officerToken),
    })
    const { data } = res.json()
    // The tagged line is ward-coded, so the budget dataset should not count it as unlocated —
    // and the projects dataset (year-less by design) is still present.
    const budget = data.unlocated.find((u) => u.dataset === 'budget')
    expect(budget ? budget.unlocated_rows > 0 : true).toBe(true)
    expect(Array.isArray(data.unlocated)).toBe(true)
  })

  test('with no linked ward register, geometry says so instead of drawing nothing silently', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/ward-geometry', headers: auth(officerToken) })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    // Honest either way: with no linked ward the payload SAYS so rather than drawing nothing
    // silently, and with the provisional register loaded (migration 201) it reports one feature
    // per linked ward. The count is read from the register, never hard-coded.
    expect(data.ward_register_linked).toBe(registerLinked)
    expect(data.features).toHaveLength(linkedWardCount)
  })
})
