// test/finance-spatial-allocation.test.js
// The explicit multi-area split table and the ward roll-ups (migrations 198–199).
//
// The rules this file pins, all of them from the GIS–finance assessment §6.1/§6.2:
//   * all-or-nothing attribution: a line with approved allocations contributes ONLY through
//     them (plus an unallocated remainder); its ward_code is not also counted;
//   * the approved split total can never exceed the canonical revised amount (no double
//     counting), and withdrawing a split frees the cap again;
//   * currencies stay separate and pinned to the subject's own currency;
//   * the approver is never the requester, decided rows are immutable, a closed year accepts
//     no new allocations, and an approved split may be revoked (withdrawn) but not edited;
//   * ward linkage is reported honestly ('linked' / 'unlinked'), and the unlocated register
//     counts what the map cannot place rather than dropping it;
//   * RLS: another council's session sees none of this council's allocations or ward rows.
//
// Needs the migration chain through 199. Self-contained otherwise; removes everything it
// creates (a fictional authority, two fixture wards, finance fixtures and two fixture users).

require('dotenv').config()
const { Pool } = require('pg')
// Refuses a database that is not obviously disposable: this suite writes real finance
// rows, and .env points DATABASE_URL at the live development database (audit MAJOR-7).
const { assertDisposableDatabase } = require('./helpers/disposableDatabase')

const MARK = `SPA-${require('node:crypto').randomBytes(3).toString('hex').toUpperCase()}`

describe('finance.spatial_allocation and the ward roll-ups', () => {
  let pool
  let vunguId
  let authId
  let makerId
  let approverId
  let yearId
  let closedYearId
  let deptId
  let expAccountId
  let revAccountId
  const lines = {}
  let txnNoWard

  const W1 = `${MARK}W1`
  const W2 = `${MARK}W2`

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

  /** Expect the guard trigger to refuse: resolves with the exception message. */
  async function refuse(promise) {
    try {
      await promise
      throw new Error('expected a refusal, the statement succeeded')
    } catch (err) {
      if (err.message === 'expected a refusal, the statement succeeded') throw err
      return err
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: assertDisposableDatabase('a finance test suite') })

    const { rows: [vungu] } = await pool.query(
      `SELECT id FROM public.local_authorities WHERE code = 'VUNGU'`)
    vunguId = vungu.id

    const { rows: [authority] } = await pool.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`,
      [`Spatial allocation fixture council ${MARK} (fictional)`, MARK])
    authId = authority.id

    const { rows: users } = await pool.query(
      `INSERT INTO public.users (email, password_hash, name, role, authority_id)
       VALUES ($1, 'x', $2, 'finance_officer', $3),
              ($4, 'x', $5, 'finance_committee', $3)
       RETURNING id, email`,
      [`${MARK}-maker@vungu.test`, `${MARK} maker`, authId,
       `${MARK}-approver@vungu.test`, `${MARK} approver`])
    makerId = users.find((u) => u.email.endsWith('maker@vungu.test')).id
    approverId = users.find((u) => u.email.endsWith('approver@vungu.test')).id

    // Two wards, linked to the fixture council the way decision D11 will link Vungu's.
    for (const w of [W1, W2]) {
      await pool.query(
        `INSERT INTO admin.ward (ward_code, name, source, geom)
         VALUES ($1, $2, 'test fixture', ST_GeomFromText('MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))', 4326))`,
        [w, `${MARK} ward ${w.slice(-2)}`])
      await pool.query(
        `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, basis, instrument_ref)
         VALUES ($1, $2, DATE '2030-01-01', 'delimitation', $3)`,
        [authId, w, `${MARK} instrument`])
    }

    const year = await pool.query(
      `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency, notes)
       VALUES ($1, $2, DATE '2032-01-01', DATE '2032-12-31', 'open', 'USD', $3) RETURNING id`,
      [authId, `${MARK} 2032`, MARK])
    yearId = year.rows[0].id
    // Born open so the line below can be recorded, closed afterwards: a year's records exist
    // from when it was open, and the allocation guard must refuse anything new once it closes.
    const closedYear = await pool.query(
      `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency, notes)
       VALUES ($1, $2, DATE '2031-01-01', DATE '2031-12-31', 'open', 'USD', $3) RETURNING id`,
      [authId, `${MARK} 2031`, MARK])
    closedYearId = closedYear.rows[0].id

    const dept = await pool.query(
      `INSERT INTO finance.department (authority_id, code, name) VALUES ($1, $2, $3) RETURNING id`,
      [authId, MARK, `${MARK} vote`])
    deptId = dept.rows[0].id

    const accounts = await pool.query(
      `INSERT INTO finance.account (authority_id, code, name, kind, is_postable)
       VALUES ($1, $2, 'expenditure fixture', 'expenditure', true),
              ($1, $3, 'revenue fixture', 'revenue', true)
       RETURNING id, code`, [authId, `${MARK}-E`, `${MARK}-R`])
    expAccountId = accounts.rows.find((a) => a.code.endsWith('-E')).id
    revAccountId = accounts.rows.find((a) => a.code.endsWith('-R')).id

    async function line(code, year, account, currency, amount, ward) {
      const r = await pool.query(
        `INSERT INTO finance.budget_line
           (authority_id, financial_year_id, department_id, account_id, code, description,
            currency, original_amount, status, ward_code, approved_at, approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, now(), $10) RETURNING id`,
        [authId, year, deptId, account, code, `${code} fixture`, currency, amount, ward, approverId])
      return r.rows[0].id
    }
    // L1: USD 1000 expenditure, ward W1 on the line itself — but the approved splits below must
    // OVERRIDE that ward, not add to it (all-or-nothing).
    lines.L1 = await line(`${MARK}-L1`, yearId, expAccountId, 'USD', '1000', W1)
    // L2: USD 500 revenue with no geography at all.
    lines.L2 = await line(`${MARK}-L2`, yearId, revAccountId, 'USD', '500', null)
    // L3: ZWG, ward W1 — a different currency must never fold into the USD rows.
    lines.L3 = await line(`${MARK}-L3`, yearId, expAccountId, 'ZWG', '100000', W1)
    // L4: ward code that is not one of the council's wards — stored, reported unlinked.
    lines.L4 = await line(`${MARK}-L4`, yearId, expAccountId, 'USD', '700', `${MARK}ZZZ`)
    // L5: recorded while its year was open; the year is closed below for the refusal test.
    lines.L5 = await line(`${MARK}-L5`, closedYearId, expAccountId, 'USD', '100', null)
    await pool.query(
      `UPDATE finance.financial_year SET status = 'closed' WHERE id = $1`, [closedYearId])

    const txn = await pool.query(
      `INSERT INTO finance.transaction
         (authority_id, financial_year_id, account_id, department_id, budget_line_id,
          txn_date, amount, currency, source_system, source_ref, ward_code)
       VALUES ($1, $2, $3, $4, $5, DATE '2032-03-01', '200', 'USD', 'test', $6, $7),
              ($1, $2, $8, $4, NULL, DATE '2032-03-02', '50', 'USD', 'test', $9, NULL)
       RETURNING id, source_ref`,
      [authId, yearId, expAccountId, deptId, lines.L1,
       `${MARK}-T1`, W1, revAccountId, `${MARK}-T2`])
    txnNoWard = txn.rows.find((t) => t.source_ref.endsWith('-T2')).id
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query(`DELETE FROM finance.spatial_allocation WHERE authority_id = $1`, [authId])
    // The MAJOR-8 fixtures: a closed year refuses writes, so the year is reopened for the
    // teardown exactly as it was reopened to create them.
    await pool.query(
      `UPDATE finance.financial_year SET status = 'open' WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.project_transaction WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.project_allocation WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.project WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.budget_revision WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.transaction WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.budget_line WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.account WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.department WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM finance.financial_year WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM admin.authority_ward WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM admin.ward WHERE ward_code LIKE $1`, [`${MARK}%`])
    await pool.query(`DELETE FROM public.users WHERE authority_id = $1`, [authId])
    await pool.query(`DELETE FROM public.local_authorities WHERE id = $1`, [authId])
    await pool.end()
  })

  test('a split within the cap is approved by a different person and lands', async () => {
    const { rows } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 600, 'USD', 'committee resolution test', $4) RETURNING id`,
      [authId, lines.L1, W1, makerId])
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [rows[0].id, approverId])
    const { rows: check } = await pool.query(
      `SELECT status, decided_by FROM finance.spatial_allocation WHERE id = $1`, [rows[0].id])
    expect(check[0].status).toBe('approved')
    expect(check[0].decided_by).toBe(approverId)
  })

  test('the currency must be the subject’s own — never converted', async () => {
    const err = await refuse(pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 100, 'ZWG', 'currency refusal test', $4)`,
      [authId, lines.L1, W2, makerId]))
    expect(err.message).toMatch(/must match the line's own currency/)
  })

  test('the target must be one of the council’s current wards once the register is linked', async () => {
    const err = await refuse(pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 100, 'USD', 'ward refusal test', $4)`,
      [authId, lines.L2, `${MARK}NOPE`, makerId]))
    expect(err.message).toMatch(/not one of this council's current wards/)
  })

  test('a closed financial year accepts no new allocations', async () => {
    const err = await refuse(pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 10, 'USD', 'closed year refusal test', $4)`,
      [authId, lines.L5, W1, makerId]))
    expect(err.message).toMatch(/accepts no further financial records/)
  })

  test('the requester may not approve their own split', async () => {
    const { rows } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 100, 'USD', 'self approval refusal test', $4) RETURNING id`,
      [authId, lines.L2, W1, makerId])
    const err = await refuse(pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [rows[0].id, makerId]))
    expect(err.message).toMatch(/spatial_allocation_decider_differs/)
  })

  test('approvals cannot exceed the canonical revised amount', async () => {
    // L1 is USD 1000 with 600 already approved: 500 more must be refused, 400 must land.
    const { rows } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 500, 'USD', 'cap refusal test', $4) RETURNING id`,
      [authId, lines.L1, W2, makerId])
    const err = await refuse(pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [rows[0].id, approverId]))
    expect(err.message).toMatch(/exceed the subject's total/)

    await pool.query(`UPDATE finance.spatial_allocation SET amount=400 WHERE id = $1`, [rows[0].id])
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [rows[0].id, approverId])
    const { rows: total } = await pool.query(
      `SELECT sum(amount) AS approved_total FROM finance.spatial_allocation
        WHERE subject_id = $1 AND status='approved'`, [lines.L1])
    expect(Number(total[0].approved_total)).toBe(1000)
  })

  test('a decided split is immutable, but an approved one can be withdrawn (revoked)', async () => {
    const { rows } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 100, 'USD', 'immutability test', $4) RETURNING id`,
      [authId, lines.L4, W1, makerId])
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [rows[0].id, approverId])
    const err = await refuse(pool.query(
      `UPDATE finance.spatial_allocation SET amount = 1 WHERE id = $1`, [rows[0].id]))
    expect(err.message).toMatch(/immutable/)

    // Revocation frees the amount for re-attribution.
    await pool.query(`UPDATE finance.spatial_allocation SET status='withdrawn' WHERE id = $1`,
      [rows[0].id])
    const { rows: after } = await pool.query(
      `SELECT status FROM finance.spatial_allocation WHERE subject_id = $1 AND target_code = $2`,
      [lines.L4, W1])
    expect(after.map((r) => r.status)).toEqual(['withdrawn'])
  })

  test('all-or-nothing: attribution uses only the approved splits plus the remainder', async () => {
    const { rows } = await pool.query(
      `SELECT ward_code, basis, budget_amount
         FROM finance.v_budget_ward_attribution WHERE budget_line_id = $1 ORDER BY basis, ward_code`,
      [lines.L1])
    // 600 → W1, 400 → W2, 0 remainder, and NO line_ward_code row: the line's own ward_code is
    // overridden by the splits, not added to them.
    expect(rows.filter((r) => r.basis === 'spatial_allocation')).toHaveLength(2)
    expect(rows.find((r) => r.basis === 'unallocated_remainder').budget_amount).toBe('0.00')
    expect(rows.find((r) => r.basis === 'line_ward_code')).toBeUndefined()
    expect(rows.find((r) => r.basis === 'unlocated')).toBeUndefined()
  })

  test('ward roll-ups are per currency, honest about linkage, and never double count', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM finance.v_ward_performance
        WHERE authority_id = $1 AND financial_year_id = $2
        ORDER BY currency, ward_code NULLS LAST, unlocated_reason NULLS LAST`,
      [authId, yearId])

    const usdW1 = rows.find((r) => r.currency === 'USD' && r.ward_code === W1)
    expect(usdW1.ward_status).toBe('linked')
    // 600 of L1's split + L3 is ZWG so it must not appear here.
    expect(Number(usdW1.expenditure_budget)).toBe(600)
    // The USD 200 transaction on L1 carries ward W1 itself.
    expect(Number(usdW1.expenditure_actual)).toBe(200)
    expect(Number(usdW1.expenditure_execution_percentage)).toBeCloseTo(33.33, 1)

    const usdW2 = rows.find((r) => r.currency === 'USD' && r.ward_code === W2)
    expect(Number(usdW2.expenditure_budget)).toBe(400)
    expect(usdW2.expenditure_actual).toBeNull()

    const zwgW1 = rows.find((r) => r.currency === 'ZWG' && r.ward_code === W1)
    expect(Number(zwgW1.expenditure_budget)).toBe(100000)
    expect(zwgW1.revenue_budget).toBeNull()

    // L4's ward code is not in the register: stored, reported, flagged.
    const unlinked = rows.find((r) => r.ward_code === `${MARK}ZZZ`)
    expect(unlinked.ward_status).toBe('unlinked')
    expect(Number(unlinked.expenditure_budget)).toBe(700)

    // The unlocated bucket: L2's revenue budget and the ward-less revenue receipt.
    const unlocated = rows.find((r) => r.ward_code === null && r.unlocated_reason === 'unlocated')
    expect(Number(unlocated.revenue_budget)).toBe(500)
    expect(Number(unlocated.revenue_actual)).toBe(50)
    expect(Number(unlocated.revenue_variance)).toBe(-450)

    // No double counting: the USD expenditure budget across ALL rows equals L1+L4 revised.
    const usdTotal = rows.filter((r) => r.currency === 'USD')
      .reduce((sum, r) => sum + Number(r.expenditure_budget || 0), 0)
    expect(usdTotal).toBe(1000 + 700)
  })

  test('the unlocated register counts what the map cannot place', async () => {
    // Grouped per financial year: the open year holds L2 and the ward-less receipt; the closed
    // year keeps its own history visible (L5) rather than dropping it.
    const { rows } = await pool.query(
      `SELECT * FROM finance.v_unlocated_finance WHERE authority_id = $1 AND financial_year_id = $2`,
      [authId, yearId])
    const budget = rows.find((r) => r.dataset === 'budget' && r.currency === 'USD')
    // L2 only in the open year: L1 is split, L3 is ZWG, L4 has a (unlinked) ward code.
    expect(budget.unlocated_rows).toBe(1)
    expect(Number(budget.unlocated_amount)).toBe(500)
    const txns = rows.find((r) => r.dataset === 'transactions')
    expect(txns.unlocated_rows).toBe(1)
    expect(Number(txns.unlocated_amount)).toBe(50)

    const { rows: closedYearRows } = await pool.query(
      `SELECT unlocated_rows, unlocated_amount FROM finance.v_unlocated_finance
        WHERE authority_id = $1 AND financial_year_id = $2 AND dataset = 'budget'`,
      [authId, closedYearId])
    expect(closedYearRows[0].unlocated_rows).toBe(1)
    expect(Number(closedYearRows[0].unlocated_amount)).toBe(100)
  })

  test('RLS: another council’s session sees none of this council’s geography', async () => {
    const asVungu = await asSession(vunguId, 'SELECT count(*)::int AS n FROM finance.spatial_allocation')
    expect(asVungu[0].n).toBe(0)
    const asVunguWard = await asSession(vunguId,
      'SELECT count(*)::int AS n FROM finance.v_ward_performance WHERE authority_id = $1', [authId])
    expect(asVunguWard[0].n).toBe(0)
    const asOwn = await asSession(authId,
      'SELECT count(*)::int AS n FROM finance.spatial_allocation WHERE authority_id = $1', [authId])
    expect(asOwn[0].n).toBeGreaterThan(0)
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT MAJOR-8 — finance.spatial_allocation joins the closed-year trigger set
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test('MAJOR-8: the closed-year guard is attached to spatial_allocation like every other table', async () => {
    // Iterated rather than asserted on one table, so a table added later and forgotten the same
    // way shows up here instead of in production (the audit's own instruction).
    const { rows } = await pool.query(
      `SELECT t AS table_name,
              EXISTS (SELECT 1 FROM pg_trigger tg
                       WHERE tg.tgrelid = ('finance.' || t)::regclass
                         AND tg.tgname = 'trg_' || t || '_year_open'
                         AND NOT tg.tgisinternal) AS guarded
         FROM unnest(ARRAY['budget_line','budget_revision','transaction','commitment',
                           'import_batch','project_allocation','project_transaction',
                           'spatial_allocation']) AS t`)
    expect(rows.filter((r) => !r.guarded)).toEqual([])
  })

  test('MAJOR-8: a project split is refused when ANY funding year is closed', async () => {
    // The project branch of the 198 guard performed no year check at all — correctly, since a
    // project spans years — and the route's check read subject.year_status, which for a project
    // is always NULL. So a split of a project funded entirely out of a CLOSED year was recorded
    // and approved after the accounts were signed.
    //
    // The allocation has to be created while its year is still open (project_allocation has its
    // own year guard), which is how it would have happened in real life: the funding was recorded
    // during the year, and the geography is being changed afterwards.
    await pool.query(`UPDATE finance.financial_year SET status = 'open' WHERE id = $1`,
      [closedYearId])
    const { rows: [closedProject] } = await pool.query(
      `INSERT INTO finance.project
         (authority_id, reference, name, department_id, currency, approved_budget, status)
       VALUES ($1, $2, $3, $4, 'USD', '100', 'approved') RETURNING id`,
      [authId, `${MARK}-CLOSED`, `${MARK} closed-year project`, deptId])
    await pool.query(
      `INSERT INTO finance.project_allocation
         (authority_id, project_id, budget_line_id, amount, currency, allocation_type)
       VALUES ($1, $2, $3, '100', 'USD', 'original')`,
      [authId, closedProject.id, lines.L5])
    await pool.query(`UPDATE finance.financial_year SET status = 'closed' WHERE id = $1`,
      [closedYearId])

    const err = await refuse(pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'project', $2, $3, 50, 'USD', 'closed year project split', $4)`,
      [authId, closedProject.id, W1, makerId]))
    expect(err.message).toMatch(/accepts no further financial records/)

    // Control: the same project funded out of the OPEN year accepts a split, so the refusal above
    // is about the closed year and not about project splits in general.
    const { rows: [openProject] } = await pool.query(
      `INSERT INTO finance.project
         (authority_id, reference, name, department_id, currency, approved_budget, status)
       VALUES ($1, $2, $3, $4, 'USD', '100', 'approved') RETURNING id`,
      [authId, `${MARK}-OPEN`, `${MARK} open-year project`, deptId])
    await pool.query(
      `INSERT INTO finance.project_allocation
         (authority_id, project_id, budget_line_id, amount, currency, allocation_type)
       VALUES ($1, $2, $3, '100', 'USD', 'original')`,
      [authId, openProject.id, lines.L2])
    const { rows: accepted } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'project', $2, $3, 50, 'USD', 'open year project split', $4) RETURNING id`,
      [authId, openProject.id, W1, makerId])
    expect(accepted[0].id).toBeTruthy()
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT MAJOR-1 — a reduction that would leave the approved splits over the revised total
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  test('MAJOR-1: a reduction revision is REFUSED while approved splits would exceed the revised total', async () => {
    // The failure the audit describes, built exactly: line of 1,000, an approved split of 800,
    // then a −500 reduction approved by a second officer. Every control in migrations 188–199
    // passes, and the ward map then attributes 800 against a 500 line with an unallocated
    // remainder of −300 that nothing flags.
    const { rows: [line] } = await pool.query(
      `INSERT INTO finance.budget_line
         (authority_id, financial_year_id, department_id, account_id, code, description,
          currency, original_amount, status, ward_code, approved_at, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', 1000, 'approved', $7, now(), $8) RETURNING id`,
      [authId, yearId, deptId, expAccountId, `${MARK}-RED`, `${MARK} reduction fixture`,
        W1, approverId])

    const { rows: [split] } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 800, 'USD', 'reduction re-validation fixture', $4)
       RETURNING id`, [authId, line.id, W2, makerId])
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [split.id, approverId])

    const { rows: [revision] } = await pool.query(
      `INSERT INTO finance.budget_revision
         (authority_id, budget_line_id, revision_no, amount_delta, currency, reason, state,
          requested_by, submitted_at)
       VALUES ($1, $2, 1, -500, 'USD', $3, 'submitted', $4, now()) RETURNING id`,
      [authId, line.id, `${MARK} reduction that no longer fits the approved splits`, makerId])

    const err = await refuse(pool.query(
      `UPDATE finance.budget_revision
          SET state='approved', decided_by=$2, decided_at=now() WHERE id = $1`,
      [revision.id, approverId]))
    expect(err.message).toMatch(/approved spatial allocations/)
    expect(err.message).toMatch(/exceed the revised amount/)
    // The message names the splits to withdraw, so the refusal is actionable rather than a wall.
    expect(err.message).toContain(split.id)

    // Nothing moved: the revision is still submitted and the line is still 1,000.
    const { rows: [after] } = await pool.query(
      `SELECT r.state, p.revised_amount
         FROM finance.budget_revision r
         JOIN finance.v_budget_line_performance p ON p.budget_line_id = r.budget_line_id
        WHERE r.id = $1`, [revision.id])
    expect(after.state).toBe('submitted')
    expect(Number(after.revised_amount)).toBe(1000)

    // THE DECISION, demonstrated: withdrawing the split that no longer fits — an audited act by
    // someone holding the deciding permission — unblocks the reduction. Nothing is lost; only the
    // ORDER of the two approved decisions is enforced.
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='withdrawn' WHERE id = $1`, [split.id])
    await pool.query(
      `UPDATE finance.budget_revision
          SET state='approved', decided_by=$2, decided_at=now() WHERE id = $1`,
      [revision.id, approverId])
    const { rows: [reduced] } = await pool.query(
      `SELECT revised_amount FROM finance.v_budget_line_performance WHERE budget_line_id = $1`,
      [line.id])
    expect(Number(reduced.revised_amount)).toBe(500)

    // A split that FITS the reduced line is approvable again straight away.
    const { rows: [fits] } = await pool.query(
      `INSERT INTO finance.spatial_allocation
         (authority_id, subject_kind, subject_id, target_code, amount, currency, methodology, requested_by)
       VALUES ($1, 'budget_line', $2, $3, 500, 'USD', 'split within the reduced total', $4)
       RETURNING id`, [authId, line.id, W2, makerId])
    await pool.query(
      `UPDATE finance.spatial_allocation SET status='approved', decided_by=$2, decided_at=now()
        WHERE id = $1`, [fits.id, approverId])

    // And the OTHER reduction path — editing original_amount directly — is refused by the same
    // rule, so the control does not depend on the officer having used a revision.
    const direct = await refuse(pool.query(
      `UPDATE finance.budget_line SET original_amount = 100 WHERE id = $1`, [line.id]))
    expect(direct.message).toMatch(/exceed the revised amount/)
  })

  test('MAJOR-1: the attribution view reports a negative remainder instead of hiding it', async () => {
    // The trigger above makes this unreachable through any write path, but legacy rows recorded
    // before it existed can carry it. GREATEST(remainder, 0) would have made the fault invisible;
    // it is published as an exception on the row instead.
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'finance' AND table_name = 'v_budget_ward_attribution'
          AND column_name = 'attribution_exception'`)
    expect(rows).toHaveLength(1)
    const { rows: ward } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'finance' AND table_name = 'v_ward_performance'
          AND column_name = 'attribution_exception_rows'`)
    expect(ward).toHaveLength(1)
  })

  test('ward-code noise is normalised to NULL at the door', async () => {
    const { rows } = await pool.query(
      `UPDATE finance.budget_line SET ward_code = '  ' WHERE id = $1 RETURNING ward_code`,
      [lines.L4])
    expect(rows[0].ward_code).toBeNull()
    // and the map now reports L4 as unlocated rather than as a ward called "  "
    const { rows: unlocated } = await pool.query(
      `SELECT unlocated_rows FROM finance.v_unlocated_finance
        WHERE authority_id = $1 AND financial_year_id = $2 AND dataset = 'budget' AND currency = 'USD'`,
      [authId, yearId])
    expect(unlocated[0].unlocated_rows).toBe(2)
  })
})
