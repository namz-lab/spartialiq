// test/finance-cross-tenant.test.js
// The finance published_select policies serve the PUBLIC session, not other councils' staff.
//
// Migration 194 made those policies set-based but session-blind: an authenticated staff
// session of ANY council matched them, so a second council's finance officer saw Vungu's
// published year in their workspace picker and the classifications behind published data.
// Migration 197 added the guard: the published path passes for a session with no authority
// (the public), for platform staff, or for the row's own council — and no one else.
//
// This test builds the smallest fixture that exercises the policy (a published year and a
// department on the Vungu authority, plus a second fictional authority) and reads the tables
// as three different sessions, the way the scoped pool would.
//
// Needs: the migration chain through 197. Self-contained otherwise; removes everything it
// creates.

require('dotenv').config()
const { Pool } = require('pg')
// Refuses a database that is not obviously disposable: this suite writes real finance
// rows, and .env points DATABASE_URL at the live development database (audit MAJOR-7).
const { assertDisposableDatabase } = require('./helpers/disposableDatabase')

const MARK = `XCT-${require('node:crypto').randomBytes(3).toString('hex').toUpperCase()}`

describe('finance published_select across tenants', () => {
  let pool
  let vunguId
  let otherId
  let yearId
  let deptId

  /** Read as a session the way tenantPool scopes one: role + the three settings. */
  async function asSession(authorityId, sql, params = []) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET ROLE vungu_app')
      await client.query(
        "SELECT set_config('app.user_id', '', false), set_config('app.authority_id', $1, false), set_config('app.platform', '', false)",
        [authorityId == null ? '' : String(authorityId)],
      )
      const r = await client.query(sql, params)
      await client.query('ROLLBACK')
      return r.rows
    } finally {
      client.release()
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertDisposableDatabase('a finance test suite') })

    const { rows: [vungu] } = await pool.query(
      `SELECT id FROM public.local_authorities WHERE code = 'VUNGU'`)
    vunguId = vungu.id
    const { rows: [other] } = await pool.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`,
      [`Cross-tenant fixture council ${MARK} (fictional)`, MARK])
    otherId = other.id

    // The system pool bypasses RLS, so the fixtures are inserted directly.
    const { rows: [year] } = await pool.query(
      `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency, notes)
       VALUES ($1, $2, DATE '2031-01-01', DATE '2031-12-31', 'open', 'USD', $3) RETURNING id`,
      [vunguId, `${MARK} 2031`, `${MARK} test fixture`])
    yearId = year.id
    const { rows: [dept] } = await pool.query(
      `INSERT INTO finance.department (authority_id, code, name)
       VALUES ($1, $2, $3) RETURNING id`,
      [vunguId, MARK, `${MARK} fixture vote`])
    deptId = dept.id
    // The publication that makes the year and the vote's classifications public. The CHECK
    // insists a published row carries who approved and who released it; the demo finance
    // admin stands in for both (this fixture tests the policies, not the duty separation).
    const { rows: [actor] } = await pool.query(
      `SELECT id FROM users WHERE email = 'demo.finance-admin@vungu.test'`)
    await pool.query(
      `INSERT INTO finance.publication
         (authority_id, financial_year_id, dataset, version, state, approved_by, published_by, published_at)
       VALUES ($1, $2, 'budget', 1, 'published', $3, $3, now())`,
      [vunguId, yearId, actor.id])
  })

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM finance.publication WHERE financial_year_id = $1', [yearId])
      await pool.query('DELETE FROM finance.department WHERE id = $1', [deptId])
      await pool.query('DELETE FROM finance.financial_year WHERE id = $1', [yearId])
      await pool.query('DELETE FROM public.local_authorities WHERE id = $1', [otherId])
      await pool.end()
    }
  })

  const YEAR_SQL = 'SELECT id FROM finance.financial_year WHERE deleted_at IS NULL'
  const DEPT_SQL = 'SELECT id FROM finance.department WHERE deleted_at IS NULL'

  test('the public session (no authority) still sees the published year and its classifications', async () => {
    expect((await asSession(null, YEAR_SQL)).map((r) => r.id)).toContain(yearId)
    expect((await asSession(null, DEPT_SQL)).map((r) => r.id)).toContain(deptId)
  })

  test("the publishing council's own session still sees them", async () => {
    expect((await asSession(vunguId, YEAR_SQL)).map((r) => r.id)).toContain(yearId)
    expect((await asSession(vunguId, DEPT_SQL)).map((r) => r.id)).toContain(deptId)
  })

  test("another council's staff session sees neither — the published path is not theirs", async () => {
    expect((await asSession(otherId, YEAR_SQL)).map((r) => r.id)).not.toContain(yearId)
    expect((await asSession(otherId, DEPT_SQL)).map((r) => r.id)).not.toContain(deptId)
  })

  test('an unpublished year was never visible to anyone but its own council', async () => {
    const { rows: [draft] } = await pool.query(
      `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, notes)
       VALUES ($1, $2, DATE '2032-01-01', DATE '2032-12-31', 'draft', $3) RETURNING id`,
      [vunguId, `${MARK} 2032 draft`, `${MARK} test fixture`])
    try {
      expect((await asSession(null, YEAR_SQL)).map((r) => r.id)).not.toContain(draft.id)
      expect((await asSession(otherId, YEAR_SQL)).map((r) => r.id)).not.toContain(draft.id)
      expect((await asSession(vunguId, YEAR_SQL)).map((r) => r.id)).toContain(draft.id)
    } finally {
      await pool.query('DELETE FROM finance.financial_year WHERE id = $1', [draft.id])
    }
  })
})
