/**
 * The Director's cockpit: the year's position period by period, and what needs attention.
 *
 * Specified in the frontend repo at
 * docs/superpowers/specs/2026-11-10-finance-director-capability-design.md §5 (workstream W3,
 * baseline needs N13, N14, GAP-5/6/7). Two read-only endpoints, both behind finance.budget.view,
 * both department-scoped by the same middleware as the rest of the module.
 *
 * ── WHERE THE FIGURES COME FROM ───────────────────────────────────────────────────────────────
 * Nothing here aggregates from scratch where a view already does it. The period series reads
 * finance.budget_line, finance.budget_revision, finance.transaction and finance.commitment
 * directly because no view carries a period dimension; every other figure comes from the NUMERIC
 * views that already exist — finance.v_budget_line_performance (migration 188:796),
 * finance.v_project_performance (migration 202:565) and finance.v_unlocated_finance
 * (migration 199:178). The attention feed's overspent and near-exhausted counts use the CASE
 * expression of /finance/exceptions/budget (finance-budget.js:834-839) unchanged, against the same
 * two council-configured thresholds read in the same order, so the feed and that endpoint cannot
 * disagree about which line is flagged.
 *
 * ── PERIODICITY ───────────────────────────────────────────────────────────────────────────────
 * periodList() from src/lib/financePeriods.js, the same engine the management accounts and the
 * quarterly return use (finance-reports.js:54). Buckets come from the financial year's own
 * start_date, so a July-June council year yields Q1 = Jul-Sep (design A3, checks C6 and C7), and
 * the cockpit and a statutory return cannot disagree about which month a posting fell in.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────────────────────────
 * Every amount is summed in SQL over NUMERIC and leaves as a decimal string. There is no money
 * arithmetic in this file. See the header of src/lib/finance.js.
 *
 * ── CURRENCY ──────────────────────────────────────────────────────────────────────────────────
 * Currency is a grouping key in every query (decision D4, design A5). The series is keyed by
 * (currency, account_kind) and no total spans either. A caller cannot ask for a combined figure
 * because none is computed.
 *
 * ── WHY "BUDGET" IS NOT DIVIDED ACROSS THE PERIODS ────────────────────────────────────────────
 * The Council approves an annual allocation; it does not phase it by month. Spreading one twelfth
 * into each period would be interpolation, which design A4 forbids. So the budget on a period is
 * THE ALLOCATION IN FORCE AT THE CLOSE OF THAT PERIOD: the lines' original amounts plus every
 * approved revision effective on or before the period's to_date. It is a flat figure that steps
 * when a revision is approved, which is what actually happened, and the closing period's budget
 * equals the annual revised figure on finance.v_budget_line_performance. A revision whose
 * effective date falls outside the year is clamped into it so that invariant holds rather than the
 * delta being silently lost.
 *
 * ── WHY THE ACTUALS ARE READ OFF THE TRANSACTION AND NOT OFF THE BUDGET LINE ──────────────────
 * finance.v_budget_line_performance attributes an actual to a line and excludes any transaction
 * whose currency differs from the line's, counting it as a fault instead; a transaction with no
 * budget line is not in that view at all. Both are money the council moved, and a position chart
 * that omitted them would be short by exactly the amount nobody has reconciled. So the series
 * groups transactions by THEIR OWN currency and their account's kind. The consequence is
 * deliberate and is stated on the screen: the series' actual can exceed the view's attributed
 * actual, and the difference is unattributed or cross-currency spend — which the attention feed
 * reports as items of its own.
 *
 * Amounts are signed and a reversal carries the negative of the row it reverses
 * (finance.transaction.reverses_id), so summing nets corrections off and no reversal is
 * special-cased here.
 *
 * A transaction dated outside its own financial year's start and end dates belongs to no period
 * and is therefore absent from the series while present in the annual figures. No trigger forbids
 * such a row — finance.assert_transaction_line_year checks the LINE's year, not the date — so the
 * buckets are left truthful rather than stretched to absorb it.
 *
 * ── WHY COMMITMENTS ARE THE OPEN BALANCE OF WHAT WAS RAISED IN THE PERIOD ─────────────────────
 * Read as a flow, like the actual beside it: commitments still open, dated by committed_on. Their
 * sum across the periods is the year's open-commitment figure, so the series agrees with the
 * figure the overview already shows.
 *
 * ── A PERIOD WITH NOTHING IN IT STILL GETS ITS ROW ────────────────────────────────────────────
 * Design A4, check C9. Every (currency, kind) pair is crossed with every period and the aggregates
 * are LEFT JOINed on, so a month in which nothing was spent returns 0.00 — a recorded nil, which
 * is a fact a director needs — and never disappears from the series.
 *
 * ── ZERO AND NOT-COMPUTED ARE DIFFERENT ANSWERS ───────────────────────────────────────────────
 * Every attention item is returned whatever its count, because "no line is overspent" is an answer
 * and an absent row only says the question was never asked (check C12). An item the server could
 * not compute carries unavailable: true and a reason: a query that failed, a council-wide queue
 * asked for by a department-scoped caller, or a queue whose underlying permission the caller does
 * not hold. The contract's count is not nullable, so an unavailable item carries 0 there and the
 * client must render the reason instead of the number — which is what the frontend's attention
 * feed does, and what its test pins.
 */

const {
  requirePermission, departmentScope, hasPermission, financeSetting,
} = require('../middleware/financePermissions')
const { dateText } = require('../lib/finance')
const { periodList, PERIODICITIES } = require('../lib/financePeriods')

const uuid = { type: 'string', format: 'uuid' }

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

async function financeOverviewRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.budget.view') }

  /**
   * The year, with its dates as the council's own dates rather than as instants. A SQL DATE read
   * through node-postgres becomes local midnight, and in Central Africa Time a July year then
   * appears to start in June; dateText() keeps it the date the database holds.
   */
  async function readYear(financialYearId) {
    const { rows } = await pg.query(
      `SELECT id, label, status, reporting_currency, notes, opened_at, closed_at,
              ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year
        WHERE id = $1 AND deleted_at IS NULL`,
      [financialYearId],
    )
    return rows[0] || null
  }

  /**
   * The departments this answer was confined to, named rather than identified.
   *
   * departmentScope() returns ids, or null for "not confined" (financePermissions.js:80-100).
   * scope_applied is for a reader: the department CODES, so a narrowed figure says in words which
   * votes it covers. null means the figure covers the whole council.
   */
  async function scopeApplied(scope) {
    if (!scope) return null
    const { rows } = await pg.query(
      `SELECT code FROM finance.department
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
        ORDER BY code`,
      [scope],
    )
    return rows.map((r) => r.code)
  }

  // ── The position, period by period ──────────────────────────────────────────────────────────
  fastify.get('/finance/overview/series', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          // The enum comes from the period engine so the route and the engine cannot diverge.
          periodicity: { type: 'string', enum: PERIODICITIES, default: 'monthly' },
          department_id: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const year = await readYear(q.financial_year_id)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')

    const scope = await departmentScope(fastify, request)
    if (q.department_id && scope && !scope.includes(q.department_id)) {
      return fail(reply, 403, 'out_of_scope', 'Your access is limited to your own department(s).')
    }

    let periods
    try {
      periods = periodList({
        start: year.start_date,
        end: year.end_date,
        periodicity: q.periodicity,
        accumulated: false,
      })
    } catch (err) {
      // periodList throws rather than hand back a column set it cannot account for. The year's own
      // dates are the only thing it can be throwing about here.
      return fail(reply, 422, 'no_periods',
        `The financial year's dates cannot be bucketed at ${q.periodicity}: ${err.message}`)
    }

    // The buckets travel into SQL as three parallel arrays and are unnested there. They are bound
    // parameters like any other value; no date and no key is interpolated into the statement.
    const keys = periods.map((p) => p.key)
    const froms = periods.map((p) => p.from_date)
    const tos = periods.map((p) => p.to_date)

    const { rows } = await pg.query(
      `WITH period AS (
         SELECT *
           FROM unnest($2::text[], $3::date[], $4::date[])
                WITH ORDINALITY AS p(period_key, from_date, to_date, ord)
       ),
       -- The year's live budget lines, in scope, with the account kind that decides which side of
       -- the position they sit on. Every status is included, exactly as
       -- finance.v_department_performance includes them, so this series and the departmental table
       -- on the same screen agree.
       line AS (
         SELECT l.id, l.currency, a.kind AS account_kind, l.original_amount
           FROM finance.budget_line l
           JOIN finance.account a ON a.id = l.account_id
          WHERE l.deleted_at IS NULL
            AND l.financial_year_id = $1
            AND ($5::uuid[] IS NULL OR l.department_id = ANY($5::uuid[]))
            AND ($6::uuid IS NULL OR l.department_id = $6::uuid)
       ),
       original AS (
         SELECT currency, account_kind, sum(original_amount) AS amount
           FROM line GROUP BY 1, 2
       ),
       -- An approved revision takes effect on its effective_date, or on the day it was decided
       -- where none was given. Clamped into the year so the closing period's budget equals the
       -- annual revised figure instead of quietly dropping the delta.
       revision AS (
         SELECT l.currency, l.account_kind, r.amount_delta,
                LEAST(GREATEST(COALESCE(r.effective_date, r.decided_at::date, $7::date), $7::date), $8::date)
                  AS effective_on
           FROM finance.budget_revision r
           JOIN line l ON l.id = r.budget_line_id
          WHERE r.deleted_at IS NULL AND r.state = 'approved' AND r.currency = l.currency
       ),
       txn AS (
         SELECT t.currency, a.kind AS account_kind, t.txn_date, t.amount
           FROM finance.transaction t
           JOIN finance.account a ON a.id = t.account_id
          WHERE t.deleted_at IS NULL
            AND t.financial_year_id = $1
            AND ($5::uuid[] IS NULL OR t.department_id = ANY($5::uuid[]))
            AND ($6::uuid IS NULL OR t.department_id = $6::uuid)
       ),
       commitment AS (
         SELECT c.currency, l.account_kind, c.committed_on,
                (c.amount - c.liquidated_amount) AS amount
           FROM finance.commitment c
           JOIN line l ON l.id = c.budget_line_id
          WHERE c.deleted_at IS NULL
            AND c.status IN ('open', 'partially_liquidated')
            AND c.currency = l.currency
       ),
       -- Cumulative by construction: every revision effective on or before the bucket's close.
       budget_cell AS (
         SELECT r.currency, r.account_kind, p.period_key, sum(r.amount_delta) AS amount
           FROM revision r JOIN period p ON r.effective_on <= p.to_date
          GROUP BY 1, 2, 3
       ),
       -- The buckets tile the year exactly, so a transaction lands in one bucket and one only.
       actual_cell AS (
         SELECT t.currency, t.account_kind, p.period_key, sum(t.amount) AS amount
           FROM txn t JOIN period p ON t.txn_date >= p.from_date AND t.txn_date <= p.to_date
          GROUP BY 1, 2, 3
       ),
       commitment_cell AS (
         SELECT c.currency, c.account_kind, p.period_key, sum(c.amount) AS amount
           FROM commitment c
           JOIN period p ON c.committed_on >= p.from_date AND c.committed_on <= p.to_date
          GROUP BY 1, 2, 3
       ),
       -- Every pair that appears anywhere in the year, so a currency with spend and no budget is a
       -- series rather than an omission.
       pair AS (
         SELECT currency, account_kind FROM original
         UNION SELECT currency, account_kind FROM txn
         UNION SELECT currency, account_kind FROM commitment
       ),
       cell AS (
         SELECT pair.currency, pair.account_kind,
                p.period_key, p.from_date, p.to_date, p.ord,
                (COALESCE(o.amount, 0) + COALESCE(b.amount, 0)) AS budget,
                COALESCE(a.amount, 0) AS actual,
                COALESCE(c.amount, 0) AS commitments
           FROM pair
           CROSS JOIN period p
           LEFT JOIN original o
                  ON o.currency = pair.currency AND o.account_kind = pair.account_kind
           LEFT JOIN budget_cell b
                  ON b.currency = pair.currency AND b.account_kind = pair.account_kind
                 AND b.period_key = p.period_key
           LEFT JOIN actual_cell a
                  ON a.currency = pair.currency AND a.account_kind = pair.account_kind
                 AND a.period_key = p.period_key
           LEFT JOIN commitment_cell c
                  ON c.currency = pair.currency AND c.account_kind = pair.account_kind
                 AND c.period_key = p.period_key
       )
       SELECT currency, account_kind, period_key,
              from_date::text AS from_date, to_date::text AS to_date,
              round(budget, 2)::text      AS budget,
              round(actual, 2)::text      AS actual,
              round(commitments, 2)::text AS commitments,
              round(sum(actual) OVER (PARTITION BY currency, account_kind ORDER BY ord
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2)::text
                AS cumulative_actual
         FROM cell
        ORDER BY currency, account_kind, ord`,
      [
        q.financial_year_id, keys, froms, tos,
        scope, q.department_id || null,
        year.start_date, year.end_date,
      ],
    )

    const labelOf = new Map(periods.map((p) => [p.key, p.label]))
    const series = []
    const index = new Map()
    for (const row of rows) {
      const id = `${row.currency}|${row.account_kind}`
      if (!index.has(id)) {
        const entry = { currency: row.currency, account_kind: row.account_kind, points: [] }
        index.set(id, entry)
        series.push(entry)
      }
      index.get(id).points.push({
        period_key: row.period_key,
        period_label: labelOf.get(row.period_key) || row.period_key,
        from_date: row.from_date,
        to_date: row.to_date,
        budget: row.budget,
        actual: row.actual,
        commitments: row.commitments,
        cumulative_actual: row.cumulative_actual,
      })
    }

    return ok(reply, {
      financial_year: year,
      periodicity: q.periodicity,
      periods,
      series,
      scope_applied: await scopeApplied(scope),
    })
  })

  // ── The exception feed ──────────────────────────────────────────────────────────────────────
  fastify.get('/finance/overview/attention', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid, department_id: uuid },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const year = await readYear(q.financial_year_id)
    if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')

    const scope = await departmentScope(fastify, request)
    if (q.department_id && scope && !scope.includes(q.department_id)) {
      return fail(reply, 403, 'out_of_scope', 'Your access is limited to your own department(s).')
    }

    // The same two council-configured thresholds /finance/exceptions/budget reads, in the same
    // order (finance-budget.js:827-828).
    const flagAt = Number(await financeSetting(fastify, request.user.authority_id, 'overspend.flag_execution_percentage', 100)) || 100
    const warnAt = Number(await financeSetting(fastify, request.user.authority_id, 'overspend.warn_execution_percentage', 90)) || 90

    const deptId = q.department_id || null

    // Six reads, each the source of one or more items. Settled rather than awaited together so one
    // failing query makes its own items unavailable with a reason instead of failing the whole feed
    // and leaving the director with nothing.
    const [flags, overCommitted, budgetWork, projectWork, publicationWork, importWork, unlocated] =
      await Promise.allSettled([
        // The CASE is finance-budget.js:834-839 unchanged. Grouped by currency AND kind because
        // exceeding the threshold on a revenue line means more was collected than was budgeted,
        // which is not an overspend and must not be added to one.
        pg.query(
          `SELECT flag, currency, account_kind, count(*)::int AS rows,
                  round(sum(GREATEST(actual_amount - revised_amount, 0)), 2)::text AS excess
             FROM (
               SELECT p.currency, p.account_kind, p.actual_amount, p.revised_amount,
                      CASE
                        WHEN p.actual_currency_mismatch_rows > 0 THEN 'currency_mismatch'
                        WHEN p.execution_percentage IS NULL AND p.actual_amount <> 0 THEN 'spend_without_budget'
                        WHEN p.execution_percentage >= $2 THEN 'over_budget'
                        WHEN p.execution_percentage >= $3 THEN 'nearly_exhausted'
                      END AS flag
                 FROM finance.v_budget_line_performance p
                WHERE p.financial_year_id = $1
                  AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
                  AND ($5::uuid IS NULL OR p.department_id = $5::uuid)
             ) flagged
            WHERE flag IS NOT NULL
            GROUP BY flag, currency, account_kind`,
          [q.financial_year_id, flagAt, warnAt, scope, deptId],
        ),
        // A line can sit under the execution threshold and still have no room left, because its
        // open commitments exceed what the allocation has not yet spent. The two threshold flags
        // above cannot see that: execution is actual over revised and ignores commitments
        // entirely. The view already computes the figure
        // (finance.v_budget_line_performance.available_including_commitments, migration 188:843),
        // and a negative balance needs no threshold to be a finding, so nothing is invented here.
        pg.query(
          `SELECT currency, count(*)::int AS rows,
                  round(sum(-available_including_commitments), 2)::text AS shortfall
             FROM finance.v_budget_line_performance
            WHERE financial_year_id = $1
              AND available_including_commitments < 0
              AND ($2::uuid[] IS NULL OR department_id = ANY($2::uuid[]))
              AND ($3::uuid IS NULL OR department_id = $3::uuid)
            GROUP BY currency`,
          [q.financial_year_id, scope, deptId],
        ),
        // Two handovers and one omission, all on budget tables this caller can already read. One
        // round trip, because all three share the year and the scope.
        pg.query(
          `SELECT
             (SELECT count(*)::int FROM finance.budget_line l
               WHERE l.deleted_at IS NULL AND l.financial_year_id = $1 AND l.status = 'submitted'
                 AND ($2::uuid[] IS NULL OR l.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR l.department_id = $3::uuid)) AS lines_awaiting_decision,
             (SELECT count(*)::int FROM finance.budget_revision r
                JOIN finance.budget_line l ON l.id = r.budget_line_id AND l.deleted_at IS NULL
               WHERE r.deleted_at IS NULL AND r.state = 'submitted'
                 AND l.financial_year_id = $1
                 AND ($2::uuid[] IS NULL OR l.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR l.department_id = $3::uuid)) AS revisions_awaiting_decision,
             (SELECT count(*)::int FROM finance.v_budget_line_performance p
               WHERE p.financial_year_id = $1
                 AND p.variance <> 0
                 AND ($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR p.department_id = $3::uuid)
                 AND NOT EXISTS (
                       SELECT 1 FROM finance.variance_explanation v
                        WHERE v.deleted_at IS NULL
                          AND v.financial_year_id = p.financial_year_id
                          AND v.budget_line_id = p.budget_line_id)) AS variance_unexplained`,
          [q.financial_year_id, scope, deptId],
        ),
        // Decision D12 lives in this query. spend_ahead_of_progress IS TRUE is a finding;
        // physical_progress_percent IS NULL is the absence of a report. They are counted
        // separately because a NULL flag is not a clean bill of health — the comparison was not
        // made at all (migration 202:678-689).
        pg.query(
          `SELECT
             (SELECT count(*)::int FROM finance.v_project_performance p
               WHERE p.status = 'awaiting_approval'
                 AND ($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR p.department_id = $3::uuid)) AS awaiting_approval,
             (SELECT count(*)::int FROM finance.v_project_performance p
               WHERE p.spend_ahead_of_progress IS TRUE
                 AND $1::uuid = ANY(p.financial_year_ids)
                 AND ($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR p.department_id = $3::uuid)) AS spend_ahead,
             (SELECT count(*)::int FROM finance.v_project_performance p
               WHERE p.physical_progress_percent IS NULL
                 AND p.allocated_total <> 0
                 AND $1::uuid = ANY(p.financial_year_ids)
                 AND ($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]))
                 AND ($3::uuid IS NULL OR p.department_id = $3::uuid)) AS progress_unreported`,
          [q.financial_year_id, scope, deptId],
        ),
        // finance.publication has no deleted_at: a publication is withdrawn, not deleted, and the
        // withdrawal is a state. There is no soft-delete clause to apply.
        pg.query(
          `SELECT
             count(*) FILTER (WHERE state = 'pending')::int AS awaiting_approval,
             count(*) FILTER (WHERE state = 'approved' AND published_at IS NULL)::int AS awaiting_release
             FROM finance.publication
            WHERE financial_year_id = $1`,
          [q.financial_year_id],
        ),
        pg.query(
          `SELECT
             (SELECT count(*)::int FROM finance.import_batch b
               WHERE b.deleted_at IS NULL AND b.financial_year_id = $1
                 AND b.status = 'validated') AS awaiting_commit,
             (SELECT count(*)::int FROM finance.import_exception e
                JOIN finance.import_batch b ON b.id = e.batch_id AND b.deleted_at IS NULL
               WHERE e.resolved_at IS NULL AND b.financial_year_id = $1
                 AND b.status NOT IN ('committed', 'cancelled', 'superseded', 'failed'))
               AS unresolved_exceptions`,
          [q.financial_year_id],
        ),
        // Project rows in this view are not year-scoped — a project spans years (migration
        // 199:205) — so they are admitted by dataset rather than by year.
        pg.query(
          `SELECT COALESCE(sum(unlocated_rows), 0)::int AS rows,
                  count(DISTINCT dataset)::int AS datasets
             FROM finance.v_unlocated_finance
            WHERE financial_year_id = $1
               OR (financial_year_id IS NULL AND dataset = 'projects')`,
          [q.financial_year_id],
        ),
      ])

    const canProjects = await hasPermission(fastify, request, 'finance.project.view')
    const canPublications = (await Promise.all([
      hasPermission(fastify, request, 'finance.publication.review'),
      hasPermission(fastify, request, 'finance.publication.approve'),
      hasPermission(fastify, request, 'finance.publication.publish'),
      hasPermission(fastify, request, 'finance.publication.withdraw'),
    ])).some(Boolean)
    const canCommit = await hasPermission(fastify, request, 'finance.import.commit')
    const canResolveExceptions = await hasPermission(fastify, request, 'finance.import.exception.resolve')
    const canMap = await hasPermission(fastify, request, 'finance.map.view')

    /** True when this answer is confined to some departments rather than to the whole council. */
    const confined = Boolean(scope) || Boolean(deptId)
    const items = []

    /**
     * Add one item.
     *
     * blockers is a list of [condition, reason] pairs; the first truthy condition makes the item
     * unavailable with its reason. That is why a failed query, a missing permission and a
     * council-wide queue asked for by a scoped caller read differently on the screen, and why none
     * of the three reads as zero.
     */
    const add = (item, count, blockers = []) => {
      const blocked = blockers.find(([condition]) => condition)
      const base = { ...item }
      if (!Array.isArray(base.amounts) || base.amounts.length === 0) delete base.amounts
      if (blocked) {
        delete base.amounts
        items.push({ ...base, count: 0, unavailable: true, unavailable_reason: blocked[1] })
        return
      }
      items.push({ ...base, count })
    }

    const failed = (settled) => settled.status === 'rejected'
    const flagRows = flags.status === 'fulfilled' ? flags.value.rows : []
    const countFlag = (flag) => flagRows
      .filter((r) => r.flag === flag)
      .reduce((n, r) => n + Number(r.rows), 0)
    /**
     * Per-currency overspend, EXPENDITURE ONLY: the same subtraction on a revenue line is money
     * collected above budget, which is not an overspend and is not added to one.
     */
    const overspendAmounts = () => flagRows
      .filter((r) => r.flag === 'over_budget' && r.account_kind === 'expenditure' && r.excess !== '0.00')
      .map((r) => ({ currency: r.currency, amount: r.excess }))

    const queryFailed = 'This count could not be computed: the query behind it did not complete.'
    const notPermitted = 'You do not hold the permission that reads this queue, so no count is shown.'
    const notNarrowable = 'This queue is council-wide and has no departmental dimension, so it cannot be narrowed to your votes.'

    add({
      id: 'budget_lines_overspent',
      label: "Budget lines past the council's threshold",
      statement: `Execution has reached ${flagAt}% of the revised allocation; on an expenditure line that is an overspend, and on a revenue line it means more was collected than was budgeted.`,
      severity: 'act',
      section: 'budget',
      amounts: overspendAmounts(),
    }, countFlag('over_budget'), [[failed(flags), queryFailed]])

    add({
      id: 'budget_lines_near_exhausted',
      label: 'Budget lines nearly exhausted',
      statement: `Execution is between ${warnAt}% and ${flagAt}% of the revised allocation, so what remains will not carry much more spending.`,
      severity: 'watch',
      section: 'budget',
    }, countFlag('nearly_exhausted'), [[failed(flags), queryFailed]])

    add({
      id: 'budget_spend_without_budget',
      label: 'Spend against lines with no budget',
      statement: 'Money is posted to a line whose revised allocation is zero, so execution is undefined rather than high; either the allocation is missing or the posting is on the wrong line.',
      severity: 'act',
      section: 'budget',
    }, countFlag('spend_without_budget'), [[failed(flags), queryFailed]])

    add({
      id: 'budget_currency_mismatch',
      label: 'Postings in another currency',
      statement: "A transaction is posted against a budget line stated in a different currency. These are excluded from the line's figures and never converted, so the line reads low until they are corrected.",
      severity: 'act',
      section: 'budget',
    }, countFlag('currency_mismatch'), [[failed(flags), queryFailed]])

    const committedRows = overCommitted.status === 'fulfilled' ? overCommitted.value.rows : []

    add({
      id: 'budget_lines_over_committed',
      label: 'Budget lines with no room left once commitments are counted',
      statement: "The revised allocation less what has been spent is smaller than the commitments still open against the line, so the line is already promised more than it holds. Whether the Available figure on this page shows that depends on the Council's available_balance.include_commitments setting; this count does not.",
      severity: 'act',
      section: 'budget',
      amounts: committedRows.map((r) => ({ currency: r.currency, amount: r.shortfall })),
    }, committedRows.reduce((n, r) => n + Number(r.rows), 0), [[failed(overCommitted), queryFailed]])

    const budget = budgetWork.status === 'fulfilled' ? budgetWork.value.rows[0] : null

    add({
      id: 'budget_lines_awaiting_decision',
      label: 'Budget lines awaiting a decision',
      statement: "Submitted and waiting on an approver. Until a line is approved it is not the Council's approved allocation.",
      severity: 'act',
      section: 'budget',
      query: { status: 'submitted' },
    }, budget ? budget.lines_awaiting_decision : 0, [[failed(budgetWork), queryFailed]])

    add({
      id: 'revisions_awaiting_decision',
      label: 'Revisions awaiting a decision',
      statement: 'A supplementary allocation or a reduction, submitted and undecided. The original approved figure stays visible either way.',
      severity: 'act',
      section: 'revisions',
      query: { state: 'submitted' },
    }, budget ? budget.revisions_awaiting_decision : 0, [[failed(budgetWork), queryFailed]])

    add({
      id: 'variance_unexplained',
      label: 'Variances with no recorded explanation',
      statement: "The line's actual differs from its revised allocation and no explanation has been recorded against it. The Council has set no materiality threshold, so every variance other than nil is counted.",
      severity: 'watch',
      section: 'budget',
    }, budget ? budget.variance_unexplained : 0, [[failed(budgetWork), queryFailed]])

    const projects = projectWork.status === 'fulfilled' ? projectWork.value.rows[0] : null

    add({
      id: 'projects_awaiting_approval',
      label: 'Projects awaiting approval',
      statement: 'Submitted for approval. A project spans financial years, so this count is not confined to the selected period, and approving a project allocates nothing to it — allocation is a separate act against a budget line.',
      severity: 'act',
      section: 'projects',
      query: { status: 'awaiting_approval' },
    }, projects ? projects.awaiting_approval : 0, [
      [failed(projectWork), queryFailed],
      [!canProjects, notPermitted],
    ])

    add({
      id: 'projects_spend_ahead_of_progress',
      label: 'Projects where spend runs ahead of delivery',
      statement: "Financial execution exceeds reported physical progress by more than the Council's configured margin. Both figures are the council's own: the money from the project's transactions, the progress from the last report recorded against it.",
      severity: 'act',
      section: 'projects',
    }, projects ? projects.spend_ahead : 0, [
      [failed(projectWork), queryFailed],
      [!canProjects, notPermitted],
    ])

    add({
      id: 'projects_progress_unreported',
      label: 'Projects with money allocated and no progress reported',
      statement: 'No physical progress has ever been recorded, so spend cannot be compared with delivery at all. This is not progress of nil: the comparison above has simply not been made for these projects.',
      severity: 'watch',
      section: 'projects',
    }, projects ? projects.progress_unreported : 0, [
      [failed(projectWork), queryFailed],
      [!canProjects, notPermitted],
    ])

    const publications = publicationWork.status === 'fulfilled' ? publicationWork.value.rows[0] : null

    add({
      id: 'publications_awaiting_approval',
      label: 'Publications awaiting approval',
      statement: 'A dataset prepared for the public portal and not yet approved. Nothing reaches the portal until it is both approved and released, by two different people.',
      severity: 'act',
      section: 'publication',
      query: { state: 'pending' },
    }, publications ? publications.awaiting_approval : 0, [
      [failed(publicationWork), queryFailed],
      [!canPublications, notPermitted],
      [confined, notNarrowable],
    ])

    add({
      id: 'publications_awaiting_release',
      label: 'Publications approved and not released',
      statement: 'Approved for the public portal and waiting on the release itself. The figures are not public until that step is taken.',
      severity: 'act',
      section: 'publication',
      query: { state: 'approved' },
    }, publications ? publications.awaiting_release : 0, [
      [failed(publicationWork), queryFailed],
      [!canPublications, notPermitted],
      [confined, notNarrowable],
    ])

    const imports = importWork.status === 'fulfilled' ? importWork.value.rows[0] : null

    add({
      id: 'imports_awaiting_commit',
      label: 'Import batches validated and awaiting commit',
      statement: "Validated by one officer and waiting on the commit, which is another person's act. Until a batch is committed none of its figures are in the register or on this page.",
      severity: 'act',
      section: 'imports',
      query: { status: 'validated' },
    }, imports ? imports.awaiting_commit : 0, [
      [failed(importWork), queryFailed],
      [!canCommit, notPermitted],
      [confined, notNarrowable],
    ])

    add({
      id: 'import_exceptions_unresolved',
      label: 'Unresolved exceptions on batches not yet committed',
      statement: 'Rows the importer refused rather than coerced. Each one is money or a classification that did not come through, and the batch behind them is still open.',
      severity: 'watch',
      section: 'imports',
    }, imports ? imports.unresolved_exceptions : 0, [
      [failed(importWork), queryFailed],
      [!canResolveExceptions, notPermitted],
      [confined, notNarrowable],
    ])

    const geography = unlocated.status === 'fulfilled' ? unlocated.value.rows[0] : null

    add({
      id: 'finance_without_geography',
      label: 'Records the map cannot place',
      statement: "Budget lines with neither a ward nor an approved split, transactions with no ward code, and projects with neither a ward nor a location. They are reported as an explicit unlocated bucket and never mapped to an invented place. No amount is given because a budgeted figure, a spent figure and a project's approved budget are three different measures, and adding them would say nothing.",
      severity: 'info',
      section: 'map',
    }, geography ? geography.rows : 0, [
      [failed(unlocated), queryFailed],
      [!canMap, notPermitted],
      [confined, notNarrowable],
    ])

    return ok(reply, {
      financial_year_id: year.id,
      generated_at: new Date().toISOString(),
      items,
      scope_applied: await scopeApplied(scope),
    })
  })
}

module.exports = { financeOverviewRoutes }
