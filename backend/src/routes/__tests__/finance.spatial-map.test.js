/**
 * The GIS–finance map surface: milestones M4 (revenue/expenditure mapping), M5 (projects and the
 * capital map) and M7 (public transparency map), with the owner's D11/D12 directions and the
 * spatial-integrity defects the production-readiness audit assigned to the database.
 *
 * WHAT THIS FILE PINS, AND WHY EACH ONE EXISTS
 *
 *   D11   migration 201 links the COD-AB wards of a district to the council as PROVISIONAL data.
 *         The test proves the rows land with basis 'interim' and an instrument_ref that says the
 *         list is unconfirmed — and that the map endpoints report that basis, because a surface
 *         that shows ward figures without saying the ward list is provisional overstates them.
 *
 *   D12   physical_progress_percent is NULL-or-recorded, and spend_ahead_of_progress is
 *         TRUE / FALSE / NULL. The NULL cases are the point: "we did not compare these" must not
 *         render as "we compared them and found nothing wrong".
 *
 *   M4-4  THE BLOCKER. /finance/map/wards applied no department scope at all, so a dept_head
 *         confined by finance.user_scope read the whole council's ward aggregates. The test gives
 *         two departments the SAME ward code and asserts the scoped officer sees only their own
 *         department's money while an unscoped officer sees both.
 *
 *   M4-3  Σ over every department/programme row of one (ward, year, currency) equals the matching
 *         finance.v_ward_performance row — so the breakdown and the choropleth cannot disagree.
 *
 *   M4-5  both actuals bases are returned and the payload names the one in use.
 *
 *   M5-1  /finance/map/projects: located projects become features, UNLOCATED projects are listed
 *         by name and never placed, and a bbox changes what is drawn without changing what cannot
 *         be drawn.
 *
 *   M7-2  /public/finance/map/wards: an authenticated council officer holding ZERO finance
 *         permissions (a building_inspector) sees exactly what an anonymous citizen sees. That is
 *         the hole audit BLOCKER-1 found on the other public routes and it must not reopen here.
 *         Publication, not permission, is what makes a measure appear.
 *
 *   D4    no figure is ever summed across USD and ZWG, on any surface this file touches.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *   APP_DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.spatial-map.test.js \
 *       --runInBand --testPathIgnorePatterns=[]
 *
 * Everything created here is tagged and removed in afterAll, including the provisional ward
 * memberships — the suite restores the register to the state it found it in.
 * test/helpers/buildApp.js refuses a database whose name is not obviously disposable.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { systemOf } = require('../../lib/dbContext')
const { tenantPool } = require('../../lib/tenancy')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `SM${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

/** The audit row is written by the onResponse hook, after the reply is sent. */
async function waitForRows(pg, sql, params) {
  let rows = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ({ rows } = await pg.query(sql, params))
    if (rows.length) return rows
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return rows
}

/** The exact instrument_ref prefix migration 201 writes, and the handle a reversal greps for. */
const PROVISIONAL_PREFIX = 'PROVISIONAL-D11-2026-11-09:'
const DISTRICT = 'ZW1704'
const THRESHOLD_KEY = 'project.spend_ahead_of_progress_points'

/** Two fixture wards that LOOK like COD-AB members of the district without colliding with one. */
const WARD_A = `${TAG}-ZWA`
const WARD_B = `${TAG}-ZWB`
/** A ward code no register carries: the honest 'unlinked' case. */
const WARD_UNLINKED = `${TAG}-NONE`

describe('the GIS–finance map surface', () => {
  let app
  let system
  /** A connection scoped to NOBODY: the session published_select was written for. */
  let anonymousPg
  const as = {}
  const made = {
    vunguId: null, yearId: null,
    deptAId: null, deptBId: null, programmeAId: null,
    expAccountId: null, revAccountId: null,
    lineAId: null, lineBId: null, lineZwgId: null, lineUnlinkedId: null,
    projectLocatedId: null, projectUnlocatedId: null,
    publicationIds: [],
    deptHeadUserId: null,
  }

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    system = systemOf(app.pg)
    anonymousPg = tenantPool(systemOf(app.pg), null)

    for (const [key, email] of Object.entries({
      financeOfficer: 'demo.finance-officer@vungu.test',
      financeAdmin: 'demo.finance-admin@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      deptHead: 'demo.dept-head@vungu.test',
      // A real council session holding not one finance permission — the M7 regression case.
      inspector: 'demo.inspector@vungu.test',
      planner: 'demo.planner@vungu.test',
    })) {
      as[key] = await loginAs(app, email, PASSWORD)
    }

    const { rows: [vungu] } = await system.query(
      `SELECT id FROM public.local_authorities WHERE code = 'VUNGU'`)
    made.vunguId = vungu.id
    const { rows: [deptHead] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.dept-head@vungu.test'`)
    made.deptHeadUserId = deptHead.id
    const { rows: [approver] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.treasurer@vungu.test'`)

    // ── Reference geography. parent_pcode is what migration 201 selects on, so these two rows
    // make the migration's real behaviour observable in a database whose national ward register
    // was never imported. This is boundary data, not a finance figure.
    for (const [code, name] of [[WARD_A, 'A'], [WARD_B, 'B']]) {
      await system.query(
        `INSERT INTO admin.ward (ward_code, name, source, parent_pcode, geom)
         VALUES ($1, $2, 'test fixture', $3,
                 ST_GeomFromText('MULTIPOLYGON(((30 -19,30 -18,31 -18,31 -19,30 -19)))', 4326))`,
        [code, `${TAG} ward ${name}`, DISTRICT])
    }

    const { rows: [year] } = await system.query(
      `INSERT INTO finance.financial_year
         (authority_id, label, start_date, end_date, status, reporting_currency, notes)
       VALUES ($1, $2, DATE '2036-01-01', DATE '2036-12-31', 'open', 'USD', $3) RETURNING id`,
      [made.vunguId, `${TAG} 2036`, TAG])
    made.yearId = year.id

    const { rows: depts } = await system.query(
      `INSERT INTO finance.department (authority_id, code, name)
       VALUES ($1, $2, $3), ($1, $4, $5) RETURNING id, code`,
      [made.vunguId, `${TAG}-A`, `${TAG} vote A`, `${TAG}-B`, `${TAG} vote B`])
    made.deptAId = depts.find((d) => d.code.endsWith('-A')).id
    made.deptBId = depts.find((d) => d.code.endsWith('-B')).id

    const { rows: [programme] } = await system.query(
      `INSERT INTO finance.programme (authority_id, department_id, code, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [made.vunguId, made.deptAId, `${TAG}-P1`, `${TAG} programme`])
    made.programmeAId = programme.id

    const { rows: accounts } = await system.query(
      `INSERT INTO finance.account (authority_id, code, name, kind, is_postable)
       VALUES ($1, $2, '${TAG} expenditure', 'expenditure', true),
              ($1, $3, '${TAG} revenue', 'revenue', true)
       RETURNING id, code`, [made.vunguId, `${TAG}-E`, `${TAG}-R`])
    made.expAccountId = accounts.find((a) => a.code.endsWith('-E')).id
    made.revAccountId = accounts.find((a) => a.code.endsWith('-R')).id

    const line = async (code, deptId, accountId, currency, amount, ward, programmeId = null) => {
      const { rows } = await system.query(
        `INSERT INTO finance.budget_line
           (authority_id, financial_year_id, department_id, programme_id, account_id, code,
            description, currency, original_amount, status, ward_code, approved_at, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,'approved',$10, now(), $11) RETURNING id`,
        [made.vunguId, made.yearId, deptId, programmeId, accountId, code, `${code} fixture`,
          currency, amount, ward, approver.id])
      return rows[0].id
    }
    // THE SCOPE FIXTURE: two departments, ONE ward code. An unscoped officer must see 1,500;
    // a dept_head confined to vote A must see 1,000 for the same ward.
    made.lineAId = await line(`${TAG}-LA`, made.deptAId, made.expAccountId, 'USD', '1000', WARD_A,
      made.programmeAId)
    made.lineBId = await line(`${TAG}-LB`, made.deptBId, made.expAccountId, 'USD', '500', WARD_A)
    // Same ward, other currency: must never fold into the USD figure.
    made.lineZwgId = await line(`${TAG}-LZ`, made.deptAId, made.expAccountId, 'ZWG', '90000', WARD_A)
    // A ward code the register does not carry, and a revenue budget with no receipts.
    made.lineUnlinkedId = await line(`${TAG}-LU`, made.deptAId, made.revAccountId, 'USD', '400',
      WARD_UNLINKED)

    // Actuals. One carries the ward code (the transaction_ward_code basis), one does not (so the
    // budget_line_ward_code basis sees money the other basis cannot).
    const { rows: txns } = await system.query(
      `INSERT INTO finance.transaction
         (authority_id, financial_year_id, account_id, department_id, budget_line_id,
          txn_date, amount, currency, source_system, source_ref, ward_code)
       VALUES ($1,$2,$3,$4,$5, DATE '2036-03-01', '800', 'USD', 'test', $6, $7),
              ($1,$2,$3,$8,$9, DATE '2036-03-02', '100', 'USD', 'test', $10, NULL)
       RETURNING id, source_ref`,
      [made.vunguId, made.yearId, made.expAccountId, made.deptAId, made.lineAId, `${TAG}-T1`,
        WARD_A, made.deptBId, made.lineBId, `${TAG}-T2`])
    made.txnWardId = txns.find((t) => t.source_ref.endsWith('-T1')).id

    // ── Projects. One locatable, one that cannot be placed at all.
    const { rows: [located] } = await system.query(
      `INSERT INTO finance.project
         (authority_id, reference, name, department_id, ward_code, currency, approved_budget,
          status, location, location_text, start_date, end_date, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,$5,'USD','1000','approved',
               ST_SetSRID(ST_MakePoint(30.5, -18.5), 4326), $6,
               DATE '2036-01-15', DATE '2036-11-30', now(), $7)
       RETURNING id`,
      [made.vunguId, `${TAG}-P1`, `${TAG} located project`, made.deptAId, WARD_A,
        'Near the fixture ward centre', approver.id])
    made.projectLocatedId = located.id

    const { rows: [unlocatable] } = await system.query(
      `INSERT INTO finance.project
         (authority_id, reference, name, department_id, ward_code, currency, approved_budget,
          status, location, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,NULL,'USD','250','approved', NULL, now(), $5) RETURNING id`,
      [made.vunguId, `${TAG}-P2`, `${TAG} unlocated project`, made.deptAId, approver.id])
    made.projectUnlocatedId = unlocatable.id

    // Funding and spend, so execution_percentage is defined and progress can be compared with it.
    await system.query(
      `INSERT INTO finance.project_allocation
         (authority_id, project_id, budget_line_id, amount, currency, allocation_type)
       VALUES ($1,$2,$3,'1000','USD','original')`,
      [made.vunguId, made.projectLocatedId, made.lineAId])
    await system.query(
      `INSERT INTO finance.project_transaction
         (authority_id, project_id, transaction_id, association, share)
       VALUES ($1,$2,$3,'direct',1)`,
      [made.vunguId, made.projectLocatedId, made.txnWardId])
  })

  afterAll(async () => {
    if (!system) return
    const statements = [
      `DELETE FROM finance.user_scope WHERE user_id = '${made.deptHeadUserId}'`,
      `DELETE FROM finance.publication WHERE financial_year_id = '${made.yearId}'`,
      `DELETE FROM finance.project_transaction WHERE project_id IN
         (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.project_allocation WHERE project_id IN
         (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.spatial_allocation WHERE target_code LIKE '${TAG}%'`,
      `DELETE FROM finance.project WHERE reference LIKE '${TAG}%'`,
      `DELETE FROM finance.transaction WHERE source_ref LIKE '${TAG}%'`,
      `DELETE FROM finance.budget_revision WHERE budget_line_id IN
         (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.programme WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE id = '${made.yearId}'`,
      // Restore the ward register to the state the suite found it in: migration 201 found no
      // ZW1704 wards in this database, so every provisional membership here is this suite's.
      `DELETE FROM admin.authority_ward WHERE instrument_ref LIKE '${PROVISIONAL_PREFIX}%'`,
      `DELETE FROM admin.ward WHERE ward_code LIKE '${TAG}%'`,
      // The threshold row the suite may have replaced; put the migration's value back.
      `INSERT INTO finance.setting (authority_id, key, value)
         VALUES (${made.vunguId}, '${THRESHOLD_KEY}', '15'::jsonb)
         ON CONFLICT (authority_id, key) DO UPDATE SET value = '15'::jsonb`,
    ]
    for (const sql of statements) {
      await system.query(sql).catch(() => {})
    }
    await app.close()
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // D11 — the provisional ward register
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('migration 201 links the district’s wards as PROVISIONAL, and says so in the data', async () => {
    const before = await system.query(
      `SELECT count(*)::int AS n FROM admin.authority_ward
        WHERE authority_id = $1 AND valid_to IS NULL`, [made.vunguId])
    expect(before.rows[0].n).toBe(0)

    // The migration itself, not a re-implementation of it.
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../migrations/201_authority_ward_provisional_register.sql'),
      'utf8')
    await system.query(sql)

    const { rows } = await system.query(
      `SELECT aw.ward_code, aw.basis, aw.instrument_ref, aw.valid_to
         FROM admin.authority_ward aw
         JOIN admin.ward w ON w.ward_code = aw.ward_code
        WHERE aw.authority_id = $1 AND w.parent_pcode = $2
        ORDER BY aw.ward_code`, [made.vunguId, DISTRICT])

    // Exactly what admin.ward actually contains for the district — not a hardcoded 19.
    const { rows: [candidates] } = await system.query(
      `SELECT count(*)::int AS n FROM admin.ward WHERE parent_pcode = $1`, [DISTRICT])
    expect(rows).toHaveLength(candidates.n)
    expect(rows.map((r) => r.ward_code)).toEqual([WARD_A, WARD_B])

    for (const row of rows) {
      // The provisional status is carried IN THE DATA, so a later Council resolution replaces it
      // without any feature code changing.
      expect(row.basis).toBe('interim')
      expect(row.valid_to).toBeNull()
      expect(row.instrument_ref.startsWith(PROVISIONAL_PREFIX)).toBe(true)
      expect(row.instrument_ref).toMatch(/UNCONFIRMED/)
      expect(row.instrument_ref).toMatch(/pending a Council resolution/)
    }

    // Idempotent: a second run links nothing new and duplicates nothing.
    await system.query(sql)
    const { rows: [again] } = await system.query(
      `SELECT count(*)::int AS n FROM admin.authority_ward
        WHERE authority_id = $1 AND valid_to IS NULL`, [made.vunguId])
    expect(again.n).toBe(candidates.n)
  })

  test('the map endpoints report the register as linked AND as provisional', async () => {
    const geometry = await app.inject({
      method: 'GET', url: '/api/finance/map/ward-geometry', headers: auth(as.financeOfficer) })
    expect(geometry.statusCode).toBe(200)
    expect(geometry.json().data.ward_register_linked).toBe(true)
    expect(geometry.json().data.features.map((f) => f.properties.ward_code).sort())
      .toEqual([WARD_A, WARD_B])

    const wards = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId }, headers: auth(as.financeOfficer) })
    const { data } = wards.json()
    expect(data.ward_register_linked).toBe(true)
    // The signal a surface needs to label the list provisional.
    expect(data.ward_register_bases).toEqual(['interim'])
    const wardA = data.wards.find((w) => w.ward_code === WARD_A && w.currency === 'USD')
    expect(wardA.ward_status).toBe('linked')
    expect(wardA.ward_register_basis).toBe('interim')
    // A code the register does not carry stays honestly unlinked.
    const unlinked = data.wards.find((w) => w.ward_code === WARD_UNLINKED)
    expect(unlinked.ward_status).toBe('unlinked')
    expect(unlinked.ward_register_basis).toBeNull()
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // M4-2 / M4-5 — the completed panel and the two actuals bases
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('the ward panel’s added measures come from the view, and NULL is not zero', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeOfficer) })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    const wardA = data.wards.find((w) => w.ward_code === WARD_A)

    // Lines A (1,000) + B (500), both USD expenditure in the same ward. The ZWG line is elsewhere.
    expect(Number(wardA.expenditure_budget)).toBe(1500)
    expect(Number(wardA.original_expenditure)).toBe(1500)
    expect(Number(wardA.adjustments_expenditure)).toBe(0)
    // 600, not 700 - and the difference IS the point of M4-5. available and variance come from
    // the LINES (line A 1,000-800, line B 500-100), while expenditure_actual below is 800 because
    // only one of the two transactions carries a ward code. Two attribution rules, two honest
    // figures, which is exactly why the payload has to name the basis it is showing.
    expect(Number(wardA.available_excluding_commitments)).toBe(600)
    expect(Number(wardA.available_including_commitments)).toBe(600)
    expect(Number(wardA.expenditure_variance)).toBe(600)
    expect(Number(wardA.expenditure_budget) - Number(wardA.expenditure_actual)).toBe(700)
    // No revenue budget in this ward: NULL, not 0, and no collection percentage at all.
    expect(wardA.revenue_budget).toBeNull()
    expect(wardA.revenue_collection_percentage).toBeNull()

    // A ward WITH a revenue budget and no receipts: 0.00 % collected is a fact, and the absence
    // of receipts is still visible as a NULL actual beside it.
    const unlinked = data.wards.find((w) => w.ward_code === WARD_UNLINKED)
    expect(Number(unlinked.revenue_budget)).toBe(400)
    expect(unlinked.revenue_actual).toBeNull()
    expect(Number(unlinked.revenue_collection_percentage)).toBe(0)

    // Figures equal the view to the cent — the endpoint recomputed nothing.
    const { rows: [view] } = await system.query(
      `SELECT * FROM finance.v_ward_performance
        WHERE financial_year_id = $1 AND ward_code = $2 AND currency = 'USD'`,
      [made.yearId, WARD_A])
    for (const column of ['expenditure_budget', 'original_expenditure', 'expenditure_variance',
      'available_excluding_commitments', 'expenditure_actual', 'expenditure_actual_via_line']) {
      expect(String(wardA[column])).toBe(String(view[column]))
    }
  })

  test('field 11 of the ward panel: the ward’s project measures, aggregated in SQL', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeAdmin) })
    const { data } = res.json()
    // Project figures span years, so they are a SEPARATE array at the ward grain rather than
    // columns on v_ward_performance (which would misstate a multi-year project in one year).
    const ward = data.projects_by_ward.find((r) => r.ward_code === WARD_A && r.currency === 'USD')
    expect(ward).toBeTruthy()
    expect(ward.project_count).toBe(1)
    expect(ward.located_project_count).toBe(1)
    expect(Number(ward.approved_budget)).toBe(1000)
    // The panel reads a count, it does not reduce a list.
    expect(ward.progress_not_recorded_count).toBe(1)
    expect(ward.spend_ahead_of_progress_count).toBe(0)
    // The unplaceable project has no ward, so it is in no ward's row.
    expect(data.projects_by_ward.every((r) => r.ward_code !== null)).toBe(true)
    expect(data.sources).toContain('finance.v_project_performance')
  })

  test('both actuals bases are returned, and the payload names the one in use (M4-5)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeOfficer) })
    const { data } = res.json()
    const wardA = data.wards.find((w) => w.ward_code === WARD_A)

    // transaction_ward_code basis: only T1 (800) carries ward A.
    expect(Number(wardA.expenditure_actual)).toBe(800)
    // budget_line_ward_code basis: T1 on line A (800) AND T2 on line B (100), because BOTH lines
    // are tagged to ward A even though T2 carries no ward code of its own. This is the figure the
    // audit warned would otherwise be invisible.
    expect(Number(wardA.expenditure_actual_via_line)).toBe(900)

    expect(data.actuals_basis).toBe('transaction_ward_code')
    expect(data.actuals_basis_columns).toEqual({
      revenue: 'revenue_actual', expenditure: 'expenditure_actual',
    })

    const alternative = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: {
        financial_year_id: made.yearId, currency: 'USD',
        actuals_basis: 'budget_line_ward_code',
      },
      headers: auth(as.financeOfficer) })
    expect(alternative.json().data.actuals_basis).toBe('budget_line_ward_code')
    expect(alternative.json().data.actuals_basis_columns.expenditure)
      .toBe('expenditure_actual_via_line')
  })

  test('a currency is never summed into another, in wards or in unlocated', async () => {
    const usd = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeOfficer) })
    const zwg = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'ZWG' },
      headers: auth(as.financeOfficer) })

    expect(usd.json().data.wards.every((w) => w.currency === 'USD')).toBe(true)
    expect(usd.json().data.unlocated.every((u) => u.currency === 'USD')).toBe(true)
    expect(zwg.json().data.wards.every((w) => w.currency === 'ZWG')).toBe(true)

    // The same ward in two currencies: two rows, two figures, no total anywhere.
    const zwgWardA = zwg.json().data.wards.find((w) => w.ward_code === WARD_A)
    expect(Number(zwgWardA.expenditure_budget)).toBe(90000)
    const usdWardA = usd.json().data.wards.find((w) => w.ward_code === WARD_A)
    expect(Number(usdWardA.expenditure_budget)).toBe(1500)
    // 1,500 + 90,000 appears nowhere.
    const both = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId }, headers: auth(as.financeOfficer) })
    const rowsForWardA = both.json().data.wards.filter((w) => w.ward_code === WARD_A)
    expect(rowsForWardA.map((w) => w.currency).sort()).toEqual(['USD', 'ZWG'])
    expect(rowsForWardA.some((w) => Number(w.expenditure_budget) === 91500)).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // M4-4 — THE BLOCKER: department scope on the ward map
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('BLOCKER: a department-scoped officer sees only their own department’s ward figures', async () => {
    // Before the scope row, the dept_head is council-wide and sees both votes.
    const unscoped = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.deptHead) })
    expect(unscoped.json().data.department_scope).toBeNull()
    expect(Number(unscoped.json().data.wards.find((w) => w.ward_code === WARD_A)
      .expenditure_budget)).toBe(1500)

    // Confine them to vote A.
    await system.query(
      `INSERT INTO finance.user_scope (user_id, department_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [made.deptHeadUserId, made.deptAId])

    const scoped = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.deptHead) })
    expect(scoped.statusCode).toBe(200)
    const scopedData = scoped.json().data
    expect(scopedData.department_scope).toEqual([made.deptAId])

    const wardA = scopedData.wards.find((w) => w.ward_code === WARD_A)
    // Vote A's 1,000 and NOT vote B's 500. This assertion fails on the pre-fix code, which
    // applied no scope at all and returned 1,500 here.
    expect(Number(wardA.expenditure_budget)).toBe(1000)
    // And the actuals follow the same boundary: T1 (800, vote A) only.
    expect(Number(wardA.expenditure_actual)).toBe(800)
    expect(Number(wardA.expenditure_actual_via_line)).toBe(800)

    // The drill-down the ward panel opens must agree with the figure above.
    const drill = await app.inject({
      method: 'GET', url: '/api/finance/budget-lines',
      query: { financial_year_id: made.yearId, ward_code: WARD_A, kind: 'expenditure' },
      headers: auth(as.deptHead) })
    const usdLines = drill.json().data.lines.filter((l) => l.currency === 'USD')
    expect(usdLines.map((l) => l.code)).toEqual([`${TAG}-LA`])

    // An unscoped officer still sees the council-wide figure: scope confines a person, not a view.
    const admin = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeAdmin) })
    expect(admin.json().data.department_scope).toBeNull()
    expect(Number(admin.json().data.wards.find((w) => w.ward_code === WARD_A)
      .expenditure_budget)).toBe(1500)
  })

  test('the dimension filters narrow the same figures, and the breakdown sums to the ward (M4-3)', async () => {
    const byDepartment = await app.inject({
      method: 'GET', url: '/api/finance/map/wards',
      query: {
        financial_year_id: made.yearId, currency: 'USD',
        dimension: 'department', department_id: made.deptBId,
      },
      headers: auth(as.financeAdmin) })
    expect(byDepartment.statusCode).toBe(200)
    const data = byDepartment.json().data
    expect(data.dimension).toBe('department')
    expect(data.filters.department_id).toBe(made.deptBId)
    expect(Number(data.wards.find((w) => w.ward_code === WARD_A).expenditure_budget)).toBe(500)
    // The breakdown is a SEPARATE array, so a choropleth cannot shade one ward twice.
    expect(data.ward_dimensions.length).toBeGreaterThan(0)
    expect(data.ward_dimensions.every((r) => r.dimension_id === made.deptBId)).toBe(true)
    expect(data.sources).toContain('finance.v_ward_dimension_performance')

    // M4-3's acceptance check, in SQL: Σ over every dimension row of one (ward, year, currency)
    // equals the v_ward_performance row exactly.
    const { rows: [summed] } = await system.query(
      `SELECT sum(budget_amount) FILTER (WHERE account_kind = 'expenditure') AS expenditure_budget,
              sum(actual_amount)  FILTER (WHERE account_kind = 'expenditure') AS expenditure_actual,
              sum(budget_amount) FILTER (WHERE account_kind = 'revenue')      AS revenue_budget
         FROM finance.v_ward_dimension_performance
        WHERE financial_year_id = $1 AND currency = 'USD' AND ward_code = $2`,
      [made.yearId, WARD_A])
    const { rows: [ward] } = await system.query(
      `SELECT expenditure_budget, expenditure_actual, revenue_budget
         FROM finance.v_ward_performance
        WHERE financial_year_id = $1 AND currency = 'USD' AND ward_code = $2`,
      [made.yearId, WARD_A])
    expect(String(summed.expenditure_budget)).toBe(String(ward.expenditure_budget))
    expect(String(summed.expenditure_actual)).toBe(String(ward.expenditure_actual))
    expect(summed.revenue_budget).toBe(ward.revenue_budget)
  })

  test('finance.map.view still gates the map, and a planner is refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/finance/map/wards' })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET', url: '/api/finance/map/wards', headers: auth(as.planner) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/finance/map/projects' })).statusCode).toBe(401)
    expect((await app.inject({
      method: 'GET', url: '/api/finance/map/projects', headers: auth(as.planner) })).statusCode).toBe(403)
    // A council officer with no finance permission at all is refused the staff map outright.
    expect((await app.inject({
      method: 'GET', url: '/api/finance/map/projects', headers: auth(as.inspector) })).statusCode).toBe(403)
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // M5-1 / M5-2 — the project layer, and unlocated projects listed rather than placed
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('located projects become features; unlocated ones are listed by name, never placed', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId, currency: 'USD' },
      headers: auth(as.financeOfficer) })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()

    expect(data.features.type).toBe('FeatureCollection')
    const feature = data.features.features.find((f) => f.properties.reference === `${TAG}-P1`)
    expect(feature).toBeTruthy()
    expect(feature.geometry.type).toBe('Point')
    expect(feature.geometry.coordinates).toEqual([30.5, -18.5])
    expect(feature.properties.ward_status).toBe('linked')
    expect(Number(feature.properties.allocated_total)).toBe(1000)
    expect(Number(feature.properties.actual_spend)).toBe(800)
    expect(Number(feature.properties.execution_percentage)).toBe(80)

    // The located project appears ONCE, and never in the unlocated list.
    expect(data.features.features.filter((f) => f.properties.reference === `${TAG}-P1`))
      .toHaveLength(1)
    expect(data.unlocated_projects.find((p) => p.reference === `${TAG}-P1`)).toBeUndefined()

    // The unplaceable project is named, with its reason — not dropped and not placed anywhere.
    const orphan = data.unlocated_projects.find((p) => p.reference === `${TAG}-P2`)
    expect(orphan).toBeTruthy()
    expect(orphan.reason).toBe('no_ward_or_location')
    expect(Number(orphan.approved_budget)).toBe(250)
    expect(data.features.features.find((f) => f.properties.reference === `${TAG}-P2`))
      .toBeUndefined()

    // Provenance, as the ward endpoint carries it.
    expect(data.sources).toContain('finance.v_project_performance')
    expect(data).toHaveProperty('data_as_at')
    expect(data).toHaveProperty('generated_at')
    expect(data.currencies).toEqual(['USD'])
  })

  test('a bbox filters what is drawn, never what cannot be drawn', async () => {
    const far = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId, bbox: '0,0,1,1' },
      headers: auth(as.financeOfficer) })
    expect(far.statusCode).toBe(200)
    expect(far.json().data.features.features
      .find((f) => f.properties.reference === `${TAG}-P1`)).toBeUndefined()
    // Panning away from a ward does not make an unplaceable project placeable.
    expect(far.json().data.unlocated_projects.find((p) => p.reference === `${TAG}-P2`))
      .toBeTruthy()
    expect(far.json().data.bbox).toEqual([0, 0, 1, 1])

    const near = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId, bbox: '30,-19,31,-18' },
      headers: auth(as.financeOfficer) })
    expect(near.json().data.features.features
      .find((f) => f.properties.reference === `${TAG}-P1`)).toBeTruthy()

    for (const bad of ['1,2,3', '30,-19,29,-18', '200,-19,201,-18', 'a,b,c,d']) {
      const res = await app.inject({
        method: 'GET', url: '/api/finance/map/projects',
        query: { bbox: bad }, headers: auth(as.financeOfficer) })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('invalid_bbox')
    }
  })

  test('the project map is department-scoped too', async () => {
    // The scope row from the BLOCKER test above still confines the dept_head to vote A, which
    // owns both fixture projects, so the honest check is the opposite direction: confine them to
    // vote B and the projects disappear.
    await system.query(
      `INSERT INTO finance.user_scope (user_id, department_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`, [made.deptHeadUserId, made.deptAId])
    const withA = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId }, headers: auth(as.deptHead) })
    expect(withA.json().data.department_scope).toEqual([made.deptAId])
    expect(withA.json().data.features.features
      .find((f) => f.properties.reference === `${TAG}-P1`)).toBeTruthy()

    await system.query(
      `UPDATE finance.user_scope SET department_id = $2 WHERE user_id = $1`,
      [made.deptHeadUserId, made.deptBId])
    const withB = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId }, headers: auth(as.deptHead) })
    expect(withB.json().data.department_scope).toEqual([made.deptBId])
    expect(withB.json().data.features.features
      .find((f) => f.properties.reference === `${TAG}-P1`)).toBeUndefined()
    expect(withB.json().data.unlocated_projects.find((p) => p.reference === `${TAG}-P2`))
      .toBeUndefined()

    await system.query(
      `UPDATE finance.user_scope SET department_id = $2 WHERE user_id = $1`,
      [made.deptHeadUserId, made.deptAId])
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // D12 — physical progress and the spend-versus-progress exception
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('with no progress recorded, the exception flag is NULL — not false', async () => {
    const { rows: [row] } = await system.query(
      `SELECT physical_progress_percent, execution_percentage, spend_vs_progress_gap_points,
              spend_ahead_of_progress, spend_ahead_of_progress_threshold_points
         FROM finance.v_project_performance WHERE project_id = $1`, [made.projectLocatedId])
    expect(row.physical_progress_percent).toBeNull()
    // Execution IS defined (80 %): what is missing is the physical side of the comparison.
    expect(Number(row.execution_percentage)).toBe(80)
    expect(row.spend_vs_progress_gap_points).toBeNull()
    // The whole point: not false. "Not compared" and "compared and fine" are different answers.
    expect(row.spend_ahead_of_progress).toBeNull()
    // The threshold is configuration and it IS set, so the NULL above is caused by the missing
    // progress figure and nothing else.
    expect(Number(row.spend_ahead_of_progress_threshold_points)).toBe(15)

    const res = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId }, headers: auth(as.financeOfficer) })
    const feature = res.json().data.features.features
      .find((f) => f.properties.reference === `${TAG}-P1`)
    expect(feature.properties.physical_progress_percent).toBeNull()
    expect(feature.properties.spend_ahead_of_progress).toBeNull()
  })

  test('recording progress turns the flag on above the configured threshold and off below it', async () => {
    const patch = (body) => app.inject({
      method: 'PATCH', url: `/api/finance/projects/${made.projectLocatedId}/progress`,
      headers: auth(as.financeOfficer), payload: body })

    // 80 % spent against 40 % built: a 40-point gap, over the 15-point threshold.
    const flagged = await patch({ physical_progress_percent: 40 })
    expect(flagged.statusCode).toBe(200)
    expect(Number(flagged.json().data.project.physical_progress_percent)).toBe(40)
    expect(flagged.json().data.project.progress_recorded_at).toBeTruthy()
    expect(flagged.json().data.performance.spend_ahead_of_progress).toBe(true)
    expect(Number(flagged.json().data.performance.spend_vs_progress_gap_points)).toBe(40)

    // 80 % spent against 70 % built: a 10-point gap, under the threshold. FALSE, which is a real
    // answer and distinct from NULL.
    const fine = await patch({ physical_progress_percent: 70 })
    expect(fine.json().data.performance.spend_ahead_of_progress).toBe(false)
    expect(Number(fine.json().data.performance.spend_vs_progress_gap_points)).toBe(10)

    // 0 % built is a RECORDED fact and must be flagged, not read as "not recorded".
    const nothingBuilt = await patch({ physical_progress_percent: 0 })
    expect(Number(nothingBuilt.json().data.project.physical_progress_percent)).toBe(0)
    expect(nothingBuilt.json().data.performance.spend_ahead_of_progress).toBe(true)

    // The exceptions filter on the map reads the same flag.
    const exceptions = await app.inject({
      method: 'GET', url: '/api/finance/map/projects',
      query: { financial_year_id: made.yearId, exceptions_only: 'true' },
      headers: auth(as.financeOfficer) })
    expect(exceptions.json().data.features.features
      .map((f) => f.properties.reference)).toContain(`${TAG}-P1`)

    // Clearing it returns the project to "not recorded", and the flag to NULL.
    const cleared = await patch({ physical_progress_percent: null })
    expect(cleared.json().data.project.physical_progress_percent).toBeNull()
    expect(cleared.json().data.project.progress_recorded_at).toBeNull()
    expect(cleared.json().data.performance.spend_ahead_of_progress).toBeNull()
    expect(cleared.json().data.recorded).toBe(false)
  })

  test('the threshold is configuration: without it the flag is NULL, not false', async () => {
    try {
      await app.inject({
        method: 'PATCH', url: `/api/finance/projects/${made.projectLocatedId}/progress`,
        headers: auth(as.financeOfficer), payload: { physical_progress_percent: 10 } })
      await system.query(
        `DELETE FROM finance.setting WHERE authority_id = $1 AND key = $2`,
        [made.vunguId, THRESHOLD_KEY])

      const { rows: [row] } = await system.query(
        `SELECT spend_ahead_of_progress, spend_ahead_of_progress_threshold_points,
                spend_vs_progress_gap_points
           FROM finance.v_project_performance WHERE project_id = $1`, [made.projectLocatedId])
      expect(row.spend_ahead_of_progress_threshold_points).toBeNull()
      // A 70-point gap, and still NULL: no hard-coded fallback judges a council that has not set
      // the policy.
      expect(Number(row.spend_vs_progress_gap_points)).toBe(70)
      expect(row.spend_ahead_of_progress).toBeNull()
    } finally {
      await system.query(
        `INSERT INTO finance.setting (authority_id, key, value) VALUES ($1, $2, '15'::jsonb)
         ON CONFLICT (authority_id, key) DO UPDATE SET value = '15'::jsonb`,
        [made.vunguId, THRESHOLD_KEY])
      await app.inject({
        method: 'PATCH', url: `/api/finance/projects/${made.projectLocatedId}/progress`,
        headers: auth(as.financeOfficer), payload: { physical_progress_percent: null } })
    }
  })

  test('progress is a write: the read-only auditor and out-of-range values are refused', async () => {
    const auditorToken = await loginAs(app, 'demo.auditor@vungu.test', PASSWORD)
    const refused = await app.inject({
      method: 'PATCH', url: `/api/finance/projects/${made.projectLocatedId}/progress`,
      headers: auth(auditorToken), payload: { physical_progress_percent: 50 } })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().required_permission).toBe('finance.project.manage')

    const tooHigh = await app.inject({
      method: 'PATCH', url: `/api/finance/projects/${made.projectLocatedId}/progress`,
      headers: auth(as.financeOfficer), payload: { physical_progress_percent: 101 } })
    expect(tooHigh.statusCode).toBe(400)

    // The database refuses it too, not only the schema.
    await expect(system.query(
      `UPDATE finance.project SET physical_progress_percent = 120 WHERE id = $1`,
      [made.projectLocatedId])).rejects.toThrow(/project_physical_progress_range/)
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // MAJOR-1 — the officer-facing half: a 409 that names the splits to withdraw
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  test('MAJOR-1: the revision route refuses the reduction and names the splits to withdraw', async () => {
    const { rows: [approver] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.treasurer@vungu.test'`)
    const { rows: [line] } = await system.query(
      `INSERT INTO finance.budget_line
         (authority_id, financial_year_id, department_id, account_id, code, description,
          currency, original_amount, status, ward_code, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,'USD','1000','approved',$7, now(), $8) RETURNING id`,
      [made.vunguId, made.yearId, made.deptAId, made.expAccountId, `${TAG}-LRED`,
        `${TAG} reduction fixture`, WARD_B, approver.id])

    // An approved geographic split of 800, through the real routes: recorded by one officer and
    // approved by another, with a methodology, as decision D15's default requires.
    const draft = await app.inject({
      method: 'POST', url: '/api/finance/spatial-allocations', headers: auth(as.financeOfficer),
      payload: {
        subject_kind: 'budget_line', subject_id: line.id, target_code: WARD_B,
        amount: '800.00', currency: 'USD',
        methodology: 'Committee resolution of 2036-02-10, apportioned by surveyed road length.',
      } })
    expect(draft.statusCode).toBe(201)
    const allocationId = draft.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/spatial-allocations/${allocationId}/approve`,
      headers: auth(as.committee), payload: { decision_note: 'Split approved' } })).statusCode)
      .toBe(200)

    const revision = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${line.id}/revisions`,
      headers: auth(as.financeOfficer),
      payload: { amount_delta: '-500.00', reason: 'Reduction following the mid-year review.' } })
    expect(revision.statusCode).toBe(201)
    const revisionId = revision.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${revisionId}/submit`,
      headers: auth(as.financeOfficer) })).statusCode).toBe(200)

    const refused = await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${revisionId}/approve`,
      headers: auth(as.committee), payload: { note: 'Reduce the vote' } })
    expect(refused.statusCode).toBe(409)
    const body = refused.json()
    expect(body.error).toBe('spatial_allocations_exceed_revised')
    // Actionable, not a wall: the officer is told WHICH approved splits no longer fit, where to
    // withdraw them, and what the arithmetic is.
    expect(body.allocation_ids).toEqual([allocationId])
    expect(body.target_codes).toEqual([WARD_B])
    expect(Number(body.approved_split_total)).toBe(800)
    expect(Number(body.revised_after)).toBe(500)
    expect(body.currency).toBe('USD')
    expect(body.withdraw_endpoint).toBe('/api/finance/spatial-allocations/:id/withdraw')

    // Nothing moved.
    const { rows: [unchanged] } = await system.query(
      `SELECT revised_amount FROM finance.v_budget_line_performance WHERE budget_line_id = $1`,
      [line.id])
    expect(Number(unchanged.revised_amount)).toBe(1000)

    // Withdraw the split — an audited revocation by someone holding the deciding permission —
    // and the same reduction is then approved. Only the ORDER of two approved acts is enforced.
    expect((await app.inject({
      method: 'POST', url: `/api/finance/spatial-allocations/${allocationId}/withdraw`,
      headers: auth(as.committee),
      payload: { decision_note: 'Revoked so the vote can be reduced' } })).statusCode).toBe(200)
    const approved = await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${revisionId}/approve`,
      headers: auth(as.committee), payload: { note: 'Reduce the vote' } })
    expect(approved.statusCode).toBe(200)
    const { rows: [reduced] } = await system.query(
      `SELECT revised_amount FROM finance.v_budget_line_performance WHERE budget_line_id = $1`,
      [line.id])
    expect(Number(reduced.revised_amount)).toBe(500)
  })

  test('MAJOR-6: budget-line and project approvals carry a structured before/after', async () => {
    const { rows: [submitter] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.budget-officer@vungu.test'`)
    const { rows: [line] } = await system.query(
      `INSERT INTO finance.budget_line
         (authority_id, financial_year_id, department_id, account_id, code, description,
          currency, original_amount, status, ward_code, submitted_by, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,'USD','4200','submitted',$7,$8, now()) RETURNING id`,
      [made.vunguId, made.yearId, made.deptAId, made.expAccountId, `${TAG}-LAUD`,
        `${TAG} audit fixture`, WARD_B, submitter.id])

    const approved = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${line.id}/approve`,
      headers: auth(as.committee) })
    expect(approved.statusCode).toBe(200)

    const lineEvent = await waitForRows(system,
      `SELECT details FROM public.admin_audit_event
        WHERE path = $1 AND status = 200 ORDER BY occurred_at DESC LIMIT 1`,
      [`/api/finance/budget-lines/${line.id}/approve`])
    expect(lineEvent).toHaveLength(1)
    const lineDetails = lineEvent[0].details
    // The amount APPROVED, recorded at the moment of approval — not reconstructed months later
    // from the line as it stands after any revision (audit MAJOR-6).
    expect(lineDetails.before.status).toBe('submitted')
    expect(Number(lineDetails.before.original_amount)).toBe(4200)
    expect(lineDetails.after.status).toBe('approved')
    expect(Number(lineDetails.after.original_amount)).toBe(4200)
    expect(lineDetails.after.currency).toBe('USD')
    expect(lineDetails.code).toBe(`${TAG}-LAUD`)

    // The same for a project approval.
    const { rows: [creator] } = await system.query(
      `SELECT id FROM public.users WHERE email = 'demo.finance-officer@vungu.test'`)
    const { rows: [project] } = await system.query(
      `INSERT INTO finance.project
         (authority_id, reference, name, department_id, currency, approved_budget, status, created_by)
       VALUES ($1,$2,$3,$4,'USD','7500','awaiting_approval',$5) RETURNING id`,
      [made.vunguId, `${TAG}-PAUD`, `${TAG} audit project`, made.deptAId, creator.id])
    const projectApproved = await app.inject({
      method: 'POST', url: `/api/finance/projects/${project.id}/approve`,
      headers: auth(as.committee) })
    expect(projectApproved.statusCode).toBe(200)

    const projectEvent = await waitForRows(system,
      `SELECT details FROM public.admin_audit_event
        WHERE path = $1 AND status = 200 ORDER BY occurred_at DESC LIMIT 1`,
      [`/api/finance/projects/${project.id}/approve`])
    expect(projectEvent).toHaveLength(1)
    expect(projectEvent[0].details.before.status).toBe('awaiting_approval')
    expect(Number(projectEvent[0].details.before.approved_budget)).toBe(7500)
    expect(projectEvent[0].details.after.status).toBe('approved')
    expect(projectEvent[0].details.after.approved_by).toBeTruthy()

    // And the progress write is audited in the same shape.
    await app.inject({
      method: 'PATCH', url: `/api/finance/projects/${project.id}/progress`,
      headers: auth(as.financeOfficer),
      payload: { physical_progress_percent: 25, note: 'Site visit of 2036-06-01' } })
    const progressEvent = await waitForRows(system,
      `SELECT details FROM public.admin_audit_event
        WHERE path = $1 AND status = 200 ORDER BY occurred_at DESC LIMIT 1`,
      [`/api/finance/projects/${project.id}/progress`])
    expect(progressEvent[0].details.before.physical_progress_percent).toBeNull()
    expect(Number(progressEvent[0].details.after.physical_progress_percent)).toBe(25)
    expect(progressEvent[0].details.note).toBe('Site visit of 2036-06-01')
  })

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // M7-2 — the public ward map
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  describe('the public ward map', () => {
    beforeAll(async () => {
      // Publish the BUDGET dataset only, and mark the lines published, exactly as the publication
      // workflow does. Revenue and expenditure stay UNPUBLISHED so the "no inferred measure"
      // rule is observable.
      // A published publication records BOTH actors (the approver and the publisher) or the table
      // refuses it - separation of duties, asserted in the schema and not only in the route.
      const { rows: [committee] } = await system.query(
        `SELECT id FROM public.users WHERE email = 'demo.treasurer@vungu.test'`)
      const { rows: [publisher] } = await system.query(
        `SELECT id FROM public.users WHERE email = 'demo.publisher@vungu.test'`)
      const { rows: [publication] } = await system.query(
        `INSERT INTO finance.publication
           (authority_id, financial_year_id, dataset, version, state, reporting_period_label,
            data_as_at, approved_by, approved_at, published_by, published_at)
         VALUES ($1, $2, 'budget', 1, 'published', $3, DATE '2036-12-31', $4, now(), $5, now())
         RETURNING id`,
        [made.vunguId, made.yearId, `${TAG} 2036 full year`, committee.id, publisher.id])
      made.publicationIds.push(publication.id)
      await system.query(
        `UPDATE finance.budget_line SET status = 'published' WHERE code LIKE $1`, [`${TAG}%`])
    })

    test('an authenticated council officer with no finance permission sees exactly what a citizen sees', async () => {
      const anonymous = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId } })
      expect(anonymous.statusCode).toBe(200)

      // THE REGRESSION. published_select is a second PERMISSIVE policy OR'd with tenant_select,
      // so before migration 200's connection fix any signed-in Vungu session read the council's
      // unpublished drafts through a public route. A building_inspector holds not one finance
      // permission and is the exact caller that slipped through.
      const insider = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId }, headers: auth(as.inspector) })
      expect(insider.statusCode).toBe(200)

      const strip = (body) => {
        const { generated_at: _ignored, ...rest } = body.data
        return rest
      }
      expect(strip(insider.json())).toEqual(strip(anonymous.json()))

      // And a finance officer, who may read everything internally, gets no more from THIS route.
      const officer = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId }, headers: auth(as.financeOfficer) })
      expect(strip(officer.json())).toEqual(strip(anonymous.json()))
    })

    test('publication, not permission, decides which measures exist', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId, currency: 'USD' } })
      const { data } = res.json()

      expect(data.published_datasets).toContain('budget')
      expect(data.published_datasets).not.toContain('expenditure')
      expect(data.available_measures).toContain('expenditure_budget')
      // D14 permits a ward expenditure map; publication has not released the actuals, so there
      // is no expenditure figure — and absolutely no figure inferred from the published budget.
      expect(data.available_measures).not.toContain('expenditure_actual')

      const wardA = data.wards.find((w) => w.ward_code === WARD_A)
      expect(wardA).toBeTruthy()
      expect(Number(wardA.expenditure_budget)).toBe(1500)
      expect(wardA.expenditure_actual).toBeNull()
      expect(wardA.expenditure_execution_percentage).toBeNull()
      expect(data.provenance.budget.data_as_at).toBe('2036-12-31')
      expect(data.provenance.expenditure).toBeNull()

      // Aggregated per ward only: no record identifier of any kind reaches the public payload.
      const serialised = JSON.stringify({
        wards: data.wards, projects_by_ward: data.projects_by_ward, unlocated: data.unlocated,
      })
      expect(serialised).not.toContain(made.lineAId)
      expect(serialised).not.toContain(made.projectLocatedId)
      expect(serialised).not.toMatch(/counterparty|supplier|beneficiary/i)
      for (const ward of data.wards) {
        expect(Object.keys(ward).some((k) => /budget_line|project_id|transaction/.test(k)))
          .toBe(false)
      }
      expect(data.notes.counterparty).toMatch(/not part of the published record/)
      // The provisional ward list is labelled as such on the public surface too.
      expect(data.ward_register_bases).toEqual(['interim'])
    })

    test('withdrawing the publication empties the same request, with no code change', async () => {
      await system.query(
        `UPDATE finance.publication SET state = 'withdrawn', withdrawn_at = now()
          WHERE id = $1`, [made.publicationIds[0]])
      try {
        const res = await app.inject({
          method: 'GET', url: '/api/public/finance/map/wards',
          query: { financial_year_id: made.yearId } })
        // No live publication covers the year at all, so the reporting period does not exist as
        // far as the public record goes.
        expect(res.statusCode).toBe(404)
      } finally {
        await system.query(
          `UPDATE finance.publication SET state = 'published', withdrawn_at = NULL
            WHERE id = $1`, [made.publicationIds[0]])
      }
    })

    test('a currency filter on the public map cannot mix USD and ZWG', async () => {
      const usd = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId, currency: 'USD' } })
      expect(usd.json().data.wards.every((w) => w.currency === 'USD')).toBe(true)
      const zwg = await app.inject({
        method: 'GET', url: '/api/public/finance/map/wards',
        query: { financial_year_id: made.yearId, currency: 'ZWG' } })
      expect(zwg.json().data.wards.every((w) => w.currency === 'ZWG')).toBe(true)
      expect(Number(zwg.json().data.wards.find((w) => w.ward_code === WARD_A)
        .expenditure_budget)).toBe(90000)
    })

    test('public ward geometry is anonymous, cheap and labelled provisional', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/public/finance/map/ward-geometry',
        query: { financial_year_id: made.yearId } })
      expect(res.statusCode).toBe(200)
      const { data } = res.json()
      expect(data.ward_register_linked).toBe(true)
      expect(data.ward_register_bases).toEqual(['interim'])
      expect(data.features.map((f) => f.properties.ward_code).sort()).toEqual([WARD_A, WARD_B])
      expect(data.features.every((f) => f.properties.register_basis === 'interim')).toBe(true)
      expect(data.note).toMatch(/PROVISIONAL/)
      // No finance figure rides on the geometry.
      expect(JSON.stringify(data)).not.toMatch(/budget|actual|expenditure/i)
    })

    test('an unpublished year is not a quietly empty map', async () => {
      const { rows: [other] } = await system.query(
        `INSERT INTO finance.financial_year
           (authority_id, label, start_date, end_date, status, reporting_currency, notes)
         VALUES ($1, $2, DATE '2037-01-01', DATE '2037-12-31', 'open', 'USD', $3) RETURNING id`,
        [made.vunguId, `${TAG} 2037`, TAG])
      try {
        const res = await app.inject({
          method: 'GET', url: '/api/public/finance/map/wards',
          query: { financial_year_id: other.id } })
        expect(res.statusCode).toBe(404)
        expect(res.json().error).toBe('not_found')
      } finally {
        await system.query(`DELETE FROM finance.financial_year WHERE id = $1`, [other.id])
      }
    })

    test('the anonymous session itself sees only published rows of the ward view', async () => {
      // The route's predicate and the policy are independent; this reads the view directly under
      // a session scoped to nobody, so it is the POLICY that is being asserted.
      const { rows } = await anonymousPg.query(
        `SELECT ward_code, expenditure_budget, expenditure_actual
           FROM finance.v_ward_performance
          WHERE financial_year_id = $1 AND currency = 'USD' AND ward_code = $2`,
        [made.yearId, WARD_A])
      expect(rows).toHaveLength(1)
      // The budget is published; the actuals are not, so they are invisible to this session.
      expect(Number(rows[0].expenditure_budget)).toBe(1500)
      expect(rows[0].expenditure_actual).toBeNull()
    })
  })
})
