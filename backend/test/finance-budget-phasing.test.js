/**
 * Budget phasing: how a profile's recorded percentages become a report's budget columns.
 *
 * TWO HALVES, AND THEY ARE TESTED DIFFERENTLY ON PURPOSE.
 *
 * The first half is `distributionPlan()` (src/lib/financePeriods.js), which decides which profile
 * periodicities may serve a report and which of a profile's periods fall inside each report
 * column. It is pure, so it is tested with no database and no HTTP, like
 * test/finance-periods.test.js. These tests always run.
 *
 * The second half is the management account itself: a line with a profile gets a per-period budget
 * and variance, a line with NO profile gets neither and is never given an even twelfth. That is a
 * statement about a SQL query and cannot be demonstrated without data, so it runs against the
 * disposable acceptance database and SKIPS, loudly, when that database is not there. It never
 * touches vungu_dev: those rows would appear on the running application's screens.
 *
 * The total-100 rule is NOT tested here. It is a deferred constraint trigger, and proving it needs
 * the route bypassed and a real COMMIT — scripts/verify-budget-phasing.js does that, in the shape
 * scripts/verify-ledger-invariants.js established.
 */
const { distributionPlan, periodList } = require('../src/lib/financePeriods')

const JULY_JUNE = { start: '2026-07-01', end: '2027-06-30' }

describe('distributionPlan — a profile\'s periods are the council\'s own, not the calendar\'s', () => {
  test('a quarterly report on a July-June year phases Jul-Sep as q1', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly' })
    expect(plan.periods[0]).toMatchObject({
      key: 'q1', from_date: '2026-07-01', to_date: '2026-09-30', label: 'Jul-Sep 2026',
    })
    // The percentage recorded against 'q1' is the one that lands on July to September.
    expect(plan.keysByPeriod.q1).toContain('q1')
    expect(plan.keysByPeriod.q1).not.toContain('q2')
    // And nothing in this plan is a calendar quarter of 2026.
    expect(plan.periods.map((p) => p.from_date)).not.toContain('2026-01-01')
  })

  test('the keys a profile must hold are this year\'s keys at that periodicity', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly' })
    expect(plan.expectedKeys.quarterly).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(plan.expectedKeys.monthly).toEqual(
      periodList({ ...JULY_JUNE, periodicity: 'monthly' }).map((p) => p.key))
    // A nine-month transitional year has three quarters, so a four-quarter profile is not its
    // profile and the caller rejects it on this list.
    const short = distributionPlan({ start: '2026-07-01', end: '2027-03-31', periodicity: 'quarterly' })
    expect(short.expectedKeys.quarterly).toEqual(['q1', 'q2', 'q3'])
  })
})

describe('distributionPlan — a finer profile is summed, a coarser one is refused', () => {
  test('a monthly profile can serve a quarterly report, three months to the quarter', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly' })
    expect(plan.usablePeriodicities).toContain('monthly')
    expect(plan.keysByPeriod.q1).toEqual(expect.arrayContaining(['m01', 'm02', 'm03']))
    expect(plan.keysByPeriod.q1).not.toContain('m04')
    expect(plan.keysByPeriod.q2).toEqual(expect.arrayContaining(['m04', 'm05', 'm06']))
  })

  test('a quarterly profile CANNOT serve a monthly report: splitting it would invent figures', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'monthly' })
    expect(plan.usablePeriodicities).toEqual(['monthly'])
    expect(plan.usablePeriodicities).not.toContain('quarterly')
    // No monthly column claims any part of a quarterly profile.
    for (const column of plan.periods) {
      expect(plan.keysByPeriod[column.key].every((k) => k.startsWith('m'))).toBe(true)
    }
  })

  test('a yearly report can use any profile, because every one of them is finer', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'yearly' })
    expect(plan.usablePeriodicities).toEqual(['monthly', 'quarterly', 'half_yearly', 'yearly'])
    // The single yearly column contains every bucket of every periodicity, once each.
    expect(plan.keysByPeriod.y1).toEqual(expect.arrayContaining(['m01', 'm12', 'q1', 'q4', 'h1', 'h2', 'y1']))
  })

  test('every period of a usable profile falls in exactly one report column', () => {
    for (const periodicity of ['monthly', 'quarterly', 'half_yearly', 'yearly']) {
      const plan = distributionPlan({ ...JULY_JUNE, periodicity })
      for (const candidate of plan.usablePeriodicities) {
        const keys = plan.expectedKeys[candidate]
        const placements = keys.map(
          (k) => plan.discrete.filter((c) => (plan.keysByPeriod[c.key] || []).includes(k)).length)
        // No profile period is double-counted, and none is dropped.
        expect(placements).toEqual(keys.map(() => 1))
      }
    }
  })

  test('a monthly profile is refused where the months do not nest inside the quarters', () => {
    // A year starting on the 31st: day clamping makes the monthly walk and the quarterly walk
    // drift apart, so a month straddles a quarter boundary. Summing the months inside a quarter
    // would silently drop the straddling one, so this periodicity is not usable for that run.
    const odd = { start: '2026-01-31', end: '2027-01-30' }
    const monthly = periodList({ ...odd, periodicity: 'monthly' })
    const quarterly = periodList({ ...odd, periodicity: 'quarterly' })
    const straddles = monthly.some(
      (m) => quarterly.filter((q) => m.from_date >= q.from_date && m.to_date <= q.to_date).length !== 1)
    expect(straddles).toBe(true)

    const plan = distributionPlan({ ...odd, periodicity: 'quarterly' })
    expect(plan.usablePeriodicities).toEqual(['quarterly'])
    expect(plan.usablePeriodicities).not.toContain('monthly')
  })
})

describe('distributionPlan — accumulated columns accumulate the percentages too', () => {
  test('a year-to-date column contains every profile period up to its end', () => {
    const plan = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly', accumulated: true })
    expect(plan.periods.every((p) => p.from_date === '2026-07-01')).toBe(true)
    expect(plan.keysByPeriod.q1).toEqual(expect.arrayContaining(['q1']))
    expect(plan.keysByPeriod.q1).not.toContain('q2')
    // To December is the first two quarters, so a 40/30 profile gives a 70 % year-to-date budget.
    expect(plan.keysByPeriod.q2).toEqual(expect.arrayContaining(['q1', 'q2']))
    expect(plan.keysByPeriod.q4).toEqual(expect.arrayContaining(['q1', 'q2', 'q3', 'q4']))
  })

  test('nesting is judged against the DISCRETE columns, which do not overlap', () => {
    // The accumulated columns overlap by construction, so "exactly one" could never hold against
    // them. The usable set must be the same as for the discrete run.
    const running = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly', accumulated: true })
    const discrete = distributionPlan({ ...JULY_JUNE, periodicity: 'quarterly' })
    expect(running.usablePeriodicities).toEqual(discrete.usablePeriodicities)
  })
})

// ── The management account itself ──────────────────────────────────────────────────────────────
//
// Against the DISPOSABLE acceptance database only. test/helpers/disposableDatabase.js exists
// because finance suites once wrote a published US$150,000 budget line into vungu_dev and the
// public transparency portal served it as a council figure.
require('dotenv').config()
const { Client } = require('pg')
const { databaseNameOf, SAFE_DATABASE_NAME } = require('./helpers/disposableDatabase')

const PHASING_URL = process.env.PHASING_TEST_DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/vungu_acceptance_test'

const describeIfDisposable = SAFE_DATABASE_NAME.test(databaseNameOf(PHASING_URL) || '')
  ? describe
  : describe.skip

describeIfDisposable('the management account, against a database with phasing recorded', () => {
  jest.setTimeout(60000)

  const AUTHORITY = "(SELECT id FROM public.local_authorities WHERE code = 'VUNGU')"
  let client
  let reachable = false
  let app
  let auth
  let yearId

  /**
   * Everything this suite creates is prefixed PHZ- and is removed again in afterAll.
   *
   * In ONE transaction, which is not a tidiness choice: the total-100 rule is a DEFERRED
   * constraint trigger, and outside a transaction block every statement commits on its own, so the
   * profile row would be checked before the period rows that satisfy it exist. Building a profile
   * is inherently multi-statement, which is exactly why migration 204 made the rule deferred.
   */
  async function seed() {
    await client.query('BEGIN')
    const year = await client.query(
      `INSERT INTO finance.financial_year
         (authority_id, label, start_date, end_date, status, reporting_currency)
       VALUES (${AUTHORITY}, 'PHZ test year (July-June)', '2026-07-01', '2027-06-30', 'open', 'USD')
       RETURNING id`)
    yearId = year.rows[0].id

    const dept = await client.query(
      `INSERT INTO finance.department (authority_id, code, name)
       VALUES (${AUTHORITY}, 'PHZ-D', 'Phasing test department') RETURNING id`)

    const accounts = {}
    for (const code of ['PHZ-5100', 'PHZ-5200', 'PHZ-5300']) {
      const a = await client.query(
        `INSERT INTO finance.account (authority_id, code, name, kind, expenditure_class)
         VALUES (${AUTHORITY}, $1, $1 || ' account', 'expenditure', 'recurrent') RETURNING id`, [code])
      accounts[code] = a.rows[0].id
    }

    // A quarterly profile shaped 40/30/20/10, recorded by the Council.
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    const profile = await client.query(
      `INSERT INTO finance.budget_distribution
         (authority_id, financial_year_id, name, periodicity, basis, status)
       VALUES (${AUTHORITY}, $1, 'PHZ 40/30/20/10', 'quarterly', 'council_profile', 'active')
       RETURNING id`, [yearId])
    const profileId = profile.rows[0].id
    let ordinal = 0
    for (const [key, pct] of [['q1', 40], ['q2', 30], ['q3', 20], ['q4', 10]]) {
      ordinal += 1
      await client.query(
        `INSERT INTO finance.budget_distribution_period
           (authority_id, distribution_id, period_key, period_ordinal, percentage)
         VALUES (${AUTHORITY}, $1, $2, $3, $4)`, [profileId, key, ordinal, pct])
    }

    const line = async (code, accountCode, amount, distribution) => {
      const r = await client.query(
        `INSERT INTO finance.budget_line
           (authority_id, financial_year_id, department_id, account_id, code, description,
            currency, original_amount, status, distribution_id)
         VALUES (${AUTHORITY}, $1, $2, $3, $4, $4 || ' line', 'USD', $5, 'draft', $6)
         RETURNING id`,
        [yearId, dept.rows[0].id, accounts[accountCode], code, amount, distribution])
      return r.rows[0].id
    }

    // PHZ-5100: wholly phased.                      120 000, profile 40/30/20/10
    await line('PHZ-L01', 'PHZ-5100', 120000, profileId)
    // PHZ-5200: NO phasing recorded.                 60 000, distribution_id NULL
    await line('PHZ-L02', 'PHZ-5200', 60000, null)
    // PHZ-5300: two lines, one phased and one not — the "partly recorded" case.
    await line('PHZ-L03', 'PHZ-5300', 40000, profileId)
    await line('PHZ-L04', 'PHZ-5300', 40000, null)

    // The deferred rule is asserted here, inside the seed's own transaction, so a fixture that
    // did not total 100 would fail this suite at its setup rather than somewhere downstream.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query('COMMIT')
  }

  /**
   * Remove anything a previous run left behind, by PREFIX rather than by the id this run holds.
   * It is called before the seed as well as after it: an interrupted run leaves rows, and keying
   * the cleanup to this run's `yearId` would make it a no-op exactly when it is needed.
   */
  async function cleanup() {
    // IN ONE TRANSACTION, and this is the total-100 rule showing its teeth rather than a tidiness
    // choice. Deleting the period rows of an ACTIVE profile statement by statement leaves, for the
    // length of one autocommitted statement, a live profile with no periods — and the deferred
    // trigger refuses it. An active profile and its periods are inseparable, which is the point.
    // Deleting the profile is enough on its own: the periods go with it (ON DELETE CASCADE).
    await client.query('BEGIN')
    try {
      await client.query('DELETE FROM finance.budget_line WHERE code LIKE $1', ['PHZ-%'])
      await client.query('DELETE FROM finance.budget_distribution WHERE name LIKE $1', ['PHZ %'])
      await client.query('DELETE FROM finance.account WHERE code LIKE $1', ['PHZ-%'])
      await client.query('DELETE FROM finance.department WHERE code LIKE $1', ['PHZ-%'])
      await client.query('DELETE FROM finance.financial_year WHERE label LIKE $1', ['PHZ %'])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    }
  }

  beforeAll(async () => {
    client = new Client({ connectionString: PHASING_URL })
    try {
      await client.connect()
      await client.query('SELECT 1 FROM finance.budget_distribution LIMIT 1')
      reachable = true
    } catch {
      reachable = false
      return
    }
    await cleanup()
    await seed()

    const Fastify = require('fastify')
    const fastifyPostgres = require('@fastify/postgres')
    const fastifyCookie = require('@fastify/cookie')
    const { authRoutes } = require('../src/routes/auth')
    const { financeReportRoutes } = require('../src/routes/finance-reports')
    app = Fastify({ logger: false })
    await app.register(fastifyPostgres, { connectionString: PHASING_URL })
    const dbContext = require('../src/lib/dbContext')
    dbContext.install(app)
    app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
    await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
    await app.register(async (scope) => {
      await authRoutes(scope)
      await financeReportRoutes(scope)
    }, { prefix: '/api' })
    await app.ready()

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'demo.finance-admin@vungu.test', password: 'demo1234' },
    })
    const cookie = (login.cookies || []).find((c) => c.name === 'vungu_at')
    // Past the connection probe, a failure is a FAILURE. Turning it into a skip here is how a
    // suite comes to report green while proving nothing, which is worse than being red.
    if (!cookie) {
      throw new Error(
        `[phasing] ${PHASING_URL} is reachable and migrated, but signing in as `
        + `demo.finance-admin@vungu.test failed (${login.statusCode}). `
        + 'Seed its demo users, or point PHASING_TEST_DATABASE_URL at a database that has them.')
    }
    auth = { authorization: `Bearer ${cookie.value}` }
  })

  afterAll(async () => {
    if (app) await app.close()
    if (client) {
      await cleanup().catch(() => {})
      await client.end()
    }
  })

  const run = (query) => app.inject({
    method: 'GET', url: `/api/finance/reports/run?${query}`, headers: auth,
  })

  const rowFor = (data, accountCode) =>
    data.rows.find((r) => r.account_code === accountCode)

  test('the fixture is in place, so the checks below are about real rows', () => {
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(
        `[phasing] SKIPPED: ${PHASING_URL} is not reachable or is not migrated to 204. `
        + 'Prepare it with scripts/prepare-acceptance-db.js, then apply migration 204.')
      return
    }
    expect(yearId).toBeTruthy()
    expect(auth).toBeTruthy()
  })

  test('a phased line gets a real per-period budget, and it is the recorded percentage', async () => {
    if (!reachable) return
    const res = await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    // Jul-Sep, not Jan-Mar: the profile's q1 is the council's own first quarter.
    expect(data.periods[0]).toMatchObject({ key: 'q1', from_date: '2026-07-01', to_date: '2026-09-30' })

    const phased = rowFor(data, 'PHZ-5100')
    expect(phased.phasing_status).toBe('phased')
    expect(phased.revised_amount).toBe('120000.00')
    // 40 % of 120 000, computed in SQL over NUMERIC.
    expect(phased.b_q1).toBe('48000.00')
    expect(phased.b_q2).toBe('36000.00')
    expect(phased.b_q3).toBe('24000.00')
    expect(phased.b_q4).toBe('12000.00')
  })

  // The rule this whole workstream exists to keep.
  test('a line with NO phasing recorded gets NO per-period budget, and no even twelfth', async () => {
    if (!reachable) return
    const res = await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly`)
    const data = res.json().data
    const unphased = rowFor(data, 'PHZ-5200')

    expect(unphased.phasing_status).toBe('not recorded')
    // The annual allocation is still reported: the figure that IS known is not withheld.
    expect(unphased.revised_amount).toBe('60000.00')
    // And the per-period budget is NULL — not 15000.00 (an even quarter) and not 0.
    for (const key of ['b_q1', 'b_q2', 'b_q3', 'b_q4']) {
      expect(unphased[key]).toBeNull()
      expect(unphased[key]).not.toBe('15000.00')
    }
    // No variance either: a variance against a budget that does not exist is not a figure.
    for (const key of ['v_q1', 'v_q2', 'v_q3', 'v_q4']) expect(unphased[key]).toBeNull()
  })

  test('a figure behind both a phased and an unphased line is blank, not partial', async () => {
    if (!reachable) return
    const res = await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly`)
    const mixed = rowFor(res.json().data, 'PHZ-5300')
    expect(mixed.phasing_status).toBe('partly recorded')
    expect(mixed.phased_lines).toBe(1)
    expect(mixed.unphased_lines).toBe(1)
    // 16 000 would be 40 % of the phased line alone, wearing the whole account's heading.
    expect(mixed.b_q1).toBeNull()
  })

  test('the per-period budgets add back up to the annual allocation', async () => {
    if (!reachable) return
    const data = (await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly`)).json().data
    const phased = rowFor(data, 'PHZ-5100')
    const cents = (s) => BigInt(String(s).replace('.', ''))
    const total = ['b_q1', 'b_q2', 'b_q3', 'b_q4'].reduce((a, k) => a + cents(phased[k]), 0n)
    expect(total).toBe(cents(phased.revised_amount))
  })

  test('a quarterly profile is NOT applied to a monthly report, and the cover names it', async () => {
    if (!reachable) return
    const data = (await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=monthly`)).json().data
    // No usable profile at monthly, so the report is the unphased one it has always been.
    expect(data.columns.some((c) => c.key.startsWith('b_'))).toBe(false)
    expect(data.meta['Profiles NOT applied']).toMatch(/PHZ 40\/30\/20\/10/)
    expect(data.meta['Profiles NOT applied']).toMatch(/coarser/)
    expect(data.meta['Budget phasing']).toMatch(/NOT RECORDED|no even twelfth/)
  })

  test('the quarterly return accumulates the percentages as well as the actuals', async () => {
    if (!reachable) return
    const data = (await run(`report=quarterly_return&financial_year_id=${yearId}`)).json().data
    expect(data.accumulated).toBe(true)
    const phased = rowFor(data, 'PHZ-5100')
    // To September is 40 %; to December 40 + 30; to June the whole allocation.
    expect(phased.b_q1).toBe('48000.00')
    expect(phased.b_q2).toBe('84000.00')
    expect(phased.b_q4).toBe('120000.00')
  })

  test('the cover counts the phased, part-phased and unphased figures rather than generalising', async () => {
    if (!reachable) return
    const data = (await run(`report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly`)).json().data
    expect(data.meta['Budget phasing']).toMatch(/1 figure\(s\) have a phasing profile/)
    expect(data.meta['Budget phasing']).toMatch(/1 have it on some lines only and 1 on none/)
    expect(data.meta['Profiles applied']).toMatch(/PHZ 40\/30\/20\/10/)
    expect(data.meta['Lines with no phasing']).toMatch(/not an instruction to spread the allocation evenly/)
  })

  test('a phased report still exports in all three formats', async () => {
    if (!reachable) return
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/finance/reports/export?report=management_accounts&financial_year_id=${yearId}&periodicity=quarterly&format=${format}`,
        headers: auth,
      })
      expect(res.statusCode).toBe(200)
      expect(res.rawPayload.length).toBeGreaterThan(500)
    }
  })
})
