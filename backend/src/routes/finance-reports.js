/**
 * Financial reports and their exports.
 *
 * Every report carries the council identity, the reporting period, the generation time, the
 * currency treatment and the filters applied — the specification requires all five on any report
 * (§3.9), and an exported file that does not say what it covers will be quoted out of context
 * sooner or later.
 *
 * TWO RULES THIS MODULE ENFORCES
 *
 * 1. NO TOTAL CROSSES A CURRENCY. Every report groups by currency and every export has a currency
 *    column. Where a report would otherwise invite a grand total, it states instead that USD and
 *    ZWG are not combined. This is not caution for its own sake: without a Council-approved rate
 *    source and rule (decision D4) a combined figure would be a fabrication.
 *
 * 2. EXPORTING RESTRICTED DATA TAKES ITS OWN PERMISSION. `finance.report.export` produces a report
 *    with no counterparty identity. Including supplier or beneficiary names needs
 *    `finance.report.export_restricted` as well, which is the "explicit permission for exports
 *    containing restricted data" of §2.3. The file itself says which it is.
 *
 * THE PERIOD DIMENSION (workstream W2)
 *
 * The nine original reports are each a single annual slice, so the council's statutory cadence —
 * monthly management accounts, a quarterly return to the parent Ministry, an annual
 * budget-execution statement — could not be produced at all. The ten reports added here close
 * that, and three rules govern them:
 *
 * a. PERIOD BUCKETS COME FROM ONE PLACE. `periodList()` in src/lib/financePeriods.js generates
 *    both the column headers and the SQL bucket boundaries from the same array, so the heading on
 *    a column and the dates its figures were selected by cannot disagree. Buckets are generated
 *    from the council's OWN financial-year start date, so a July–June year gets Q1 = Jul–Sep.
 *
 * b. A PERIOD WITH NO ACTIVITY KEEPS ITS COLUMN AND REPORTS ZERO. It is never omitted, never
 *    interpolated and never carried forward. A month in which the council spent nothing is a fact
 *    a director needs to be shown, not a gap to be tidied away.
 *
 * c. THE BUDGET IS NOT PHASED BY PERIOD, AND THESE REPORTS DO NOT PRETEND IT IS. There is no
 *    monthly phasing anywhere in the schema: `finance.budget_line` carries an amount and no date
 *    (migration 188_finance_foundation.sql). So the period columns are ACTUALS, the budget column
 *    is the annual revised allocation, and the cover says which is which. Dividing an annual
 *    allocation by twelve to produce a "monthly budget" would be a figure the Council never
 *    approved.
 *
 * This file is also where a statutory vocabulary is deliberately NOT used. `finance.transaction`
 * is a register of imported actuals and not a book of account, so what the year-end report is
 * called is a BUDGET-EXECUTION STATEMENT. It is not a financial statement, a balance sheet or a
 * trial balance, and there is no report here that claims to be one.
 */

const { requirePermission, departmentScope, hasPermission, financeSetting } = require('../middleware/financePermissions')
const { buildXlsx, buildCsv } = require('../lib/spreadsheet-write')
const { buildPdf } = require('../lib/report-pdf')
const { dateText } = require('../lib/finance')
const { distributionPlan, PERIODICITIES, assertPeriodKey } = require('../lib/financePeriods')

const uuid = { type: 'string', format: 'uuid' }
const ok = (reply, data) => reply.send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/**
 * The reports, and the name each one is known by. One source: the catalogue the report picker
 * reads and the title printed on a PDF cover come from here, so a council cannot be handed a file
 * headed something other than what it asked for.
 */
const REPORT_NAMES = {
  budget_vs_actual: 'Budget versus actual',
  revenue_performance: 'Revenue performance',
  expenditure_performance: 'Expenditure performance',
  departmental_summary: 'Departmental summary',
  project_performance: 'Project performance',
  year_on_year: 'Year-on-year comparison',
  budget_revisions: 'Budget revisions and approvals',
  transaction_register: 'Transaction register',
  import_reconciliation: 'Import reconciliation',

  // Workstream W2 — management accounts and statutory returns.
  management_accounts: 'Management accounts',
  quarterly_return: 'Quarterly return to the parent Ministry',
  budget_execution_statement: 'Budget execution statement',
  variance_report: 'Variance report with explanations',
  revenue_by_source: 'Revenue by source',
  capital_vs_recurrent: 'Capital and recurrent expenditure',
  funding_source: 'Expenditure and revenue by funding source',
  programme_performance: 'Programme and activity performance',
  commitments_register: 'Commitments register',
  ward_finance: 'Ward finance',
}

const REPORTS = Object.keys(REPORT_NAMES)

/**
 * The reports that take a period dimension, and the periodicities each one offers.
 *
 * Read by the catalogue (so the picker renders a periodicity control only where one means
 * something) and by `buildReport()` (so a periodicity on a report with no period dimension is
 * ignored rather than quietly changing the figures). The quarterly return offers one periodicity
 * because the Ministry's return is quarterly: a "monthly quarterly return" is not a thing.
 */
const REPORT_PERIODS = {
  management_accounts: PERIODICITIES,
  quarterly_return: ['quarterly'],
}

/**
 * Which dimensional filters each report actually applies.
 *
 * THIS IS THE ONLY COPY OF THIS KNOWLEDGE, and it lives here because this is the file whose
 * `buildReport()` honours it. It is published through the catalogue as `accepts`, so the report
 * picker renders a control only where the control narrows something. Until 2026-11-10 the screen
 * kept its own transcription of this table and the two could drift: a filter added to a report
 * here would have gone on being offered — or not offered — by a screen that had not been edited.
 *
 * A filter absent from a report's list is not sent by the screen and is ignored by the builder, so
 * it cannot reach an export's "Filters applied" line without having narrowed anything.
 */
const REPORT_FILTERS = {
  budget_vs_actual: ['department_id'],
  revenue_performance: ['department_id'],
  expenditure_performance: ['department_id'],
  departmental_summary: ['department_id'],
  project_performance: ['department_id'],
  year_on_year: ['department_id'],
  budget_revisions: ['department_id'],
  transaction_register: ['department_id', 'dates'],
  import_reconciliation: [],

  management_accounts: ['department_id', 'account_id', 'kind', 'currency'],
  quarterly_return: ['department_id', 'account_id', 'kind', 'currency'],
  budget_execution_statement: ['department_id', 'account_id', 'kind', 'currency'],
  variance_report: ['department_id', 'account_id', 'kind', 'currency'],
  revenue_by_source: ['department_id', 'currency'],
  capital_vs_recurrent: ['department_id', 'expenditure_class', 'currency'],
  funding_source: ['department_id', 'kind', 'currency'],
  programme_performance: ['department_id', 'programme_id', 'kind', 'currency'],
  commitments_register: ['department_id', 'currency'],
  ward_finance: ['department_id', 'ward_code', 'currency'],
}

/** What each report is for, in one sentence, shown beside it in the picker. */
const REPORT_DESCRIPTIONS = {
  budget_vs_actual: 'One row per budget line with all seven §6.1 measures. A line listing, not a grouped summary.',
  revenue_performance: 'Revenue budget and collections per department. For revenue by account, use Revenue by source.',
  expenditure_performance: 'Expenditure budget and actuals per department.',
  departmental_summary: 'Both revenue and expenditure per department, per currency.',
  project_performance: 'Allocation against spend per project. Project figures span financial years and are not confined to one.',
  year_on_year: 'Two financial years side by side. A line present in only one year is still listed.',
  budget_revisions: 'Every budget revision with its reason, state, requester and approver.',
  transaction_register: 'Imported actuals with their source system and reference.',
  import_reconciliation: 'Each import batch against the control totals the council declared for it.',

  management_accounts: 'The council\'s management account: actuals bucketed by period against the annual revised allocation, per department and account. The budget is not phased by period and is shown as an annual figure.',
  quarterly_return: 'The year-to-date quarterly form of the management account, for the return to the parent Ministry. Cumulative by construction, so the columns must not be added together.',
  budget_execution_statement: 'The year-end statement: original, adjustments, revised, actual, commitments, variance and execution per vote and account. A budget-execution statement, not a financial statement.',
  variance_report: 'Variance per budget line with the authorised explanation joined on. A line whose variance has no explanation is listed as unexplained, which is the point of the report.',
  revenue_by_source: 'Revenue budget, collections and variance per revenue account, with the Council\'s revenue class.',
  capital_vs_recurrent: 'Expenditure split by the capital or recurrent class the Council set on the account. An unclassified account is reported in its own row.',
  funding_source: 'Budget lines grouped by the funding source account recorded on the line, with that account\'s revenue class.',
  programme_performance: 'Budget and actuals by programme and then activity, for a programme-based presentation of the budget.',
  commitments_register: 'Every commitment against a budget line with its outstanding balance and status.',
  ward_finance: 'Revenue and expenditure per ward, with money that carries no geography reported as a labelled "unlocated" row rather than folded into a ward.',
}

/** The formats a report can be downloaded in. JSON is the on-screen shape, not a download. */
const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf']

/**
 * One component of an export filename, reduced to ASCII letters, digits and hyphens.
 *
 * The filename goes into a `content-disposition` header, and an HTTP header value may not carry a
 * non-ASCII byte. A financial year label is free text the Council types, and councils do write an
 * en dash, an em dash and a slash in one ("2026/27 — transitional"). Before this, such a label was
 * interpolated straight into the header and Node refused the response with ERR_INVALID_CHAR, so
 * EVERY export of that year — all nine original reports as well — failed with a 500 and no
 * explanation. A slash would also have made the browser treat part of the label as a directory.
 *
 * The label is reduced rather than rejected: the file is for filing and the report's own cover
 * carries the year's exact label, so nothing is lost by spelling it plainly here.
 */
function filenamePart(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^ -~]+/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, 80).replace(/-+$/, '') || 'report'
}

/** A filename a council can file: no spaces, dated, and it says what it is. */
function exportFilename(report, yearLabel, format, restricted) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `vungu-rdc-${filenamePart(report)}-${filenamePart(yearLabel)}${restricted ? '-RESTRICTED' : ''}-${stamp}.${format}`
}

async function financeReportRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.report.view') }
  const canExport = { preHandler: requirePermission(fastify, 'finance.report.export') }

  /**
   * What reports exist, and what each one needs. Drives the report picker without hardcoding it.
   *
   * `periods` is present only on a report that really has a period dimension, so the picker can
   * offer a periodicity control only where one changes the answer. `description` is the sentence
   * shown beside the report's name.
   *
   * `grouped_by` states what the report actually groups by, which is not always what it used to
   * claim: `revenue_performance` was listed as grouped by "revenue source" and groups by
   * DEPARTMENT (its query is the departmental summary with an account-kind filter, `:208-237` of
   * this file before W2). The report is kept and left working because it is bookmarked; the
   * catalogue now describes it correctly and `revenue_by_source` is the report the old label
   * promised.
   */
  fastify.get('/finance/reports', canView, async (request, reply) => {
    const restricted = await hasPermission(fastify, request, 'finance.report.export_restricted')
    const entry = (id, requires, groupedBy, extra = {}) => ({
      id,
      name: REPORT_NAMES[id],
      requires: REPORT_PERIODS[id] ? [...requires, 'periodicity'] : requires,
      grouped_by: groupedBy,
      accepts: REPORT_FILTERS[id] ?? [],
      ...(REPORT_PERIODS[id] ? { periods: REPORT_PERIODS[id] } : {}),
      ...(REPORT_DESCRIPTIONS[id] ? { description: REPORT_DESCRIPTIONS[id] } : {}),
      ...extra,
    })
    return ok(reply, {
      reports: [
        entry('budget_vs_actual', ['financial_year_id'], ['currency', 'department', 'account']),
        entry('revenue_performance', ['financial_year_id'], ['currency', 'department']),
        entry('expenditure_performance', ['financial_year_id'], ['currency', 'department']),
        entry('departmental_summary', ['financial_year_id'], ['currency', 'department']),
        entry('project_performance', [], ['currency', 'project']),
        entry('year_on_year', ['financial_year_id', 'compare_financial_year_id'], ['currency', 'department', 'account']),
        entry('budget_revisions', ['financial_year_id'], []),
        entry('transaction_register', ['financial_year_id'], [],
          { restricted_columns: ['counterparty_ref', 'counterparty_name'] }),
        entry('import_reconciliation', ['financial_year_id'], []),

        // Workstream W2. Each of these is complete with its CSV, XLSX and PDF export; a report
        // that could not be exported would not be listed here at all.
        entry('management_accounts', ['financial_year_id'], ['currency', 'department', 'account', 'period']),
        entry('quarterly_return', ['financial_year_id'], ['currency', 'department', 'account', 'quarter (cumulative)']),
        entry('budget_execution_statement', ['financial_year_id'], ['currency', 'department', 'account']),
        entry('variance_report', ['financial_year_id'], ['currency', 'department', 'account', 'budget line']),
        entry('revenue_by_source', ['financial_year_id'], ['currency', 'revenue account', 'revenue class']),
        entry('capital_vs_recurrent', ['financial_year_id'], ['currency', 'capital/recurrent', 'department']),
        entry('funding_source', ['financial_year_id'], ['currency', 'funding source account', 'revenue/expenditure']),
        entry('programme_performance', ['financial_year_id'], ['currency', 'programme', 'activity', 'department']),
        entry('commitments_register', ['financial_year_id'], []),
        entry('ward_finance', ['financial_year_id'], ['currency', 'ward']),
      ],
      formats: ['json', ...EXPORT_FORMATS],
      can_export_restricted: restricted,
      currency_policy: 'USD and ZWG are reported separately. No report combines them and no exchange rate is applied (Council decision D4).',
    })
  })

  /**
   * The SELECT-list fragment that buckets amounts by reporting period, and the parameters it binds.
   *
   * One aggregate per period, aliased to that period's `key`, so the column the report prints and
   * the dates its figures were selected by come from the same `periodList()` array and cannot
   * disagree. Every boundary is a BOUND PARAMETER — a bucket date is never concatenated into SQL.
   *
   * The only identifier composed into the string is the period key, and `assertPeriodKey()`
   * (src/lib/financePeriods.js) refuses anything that is not one of that module's own generated
   * keys. `amountExpr` and `dateExpr` are written at the call sites below and are not reachable
   * from a request.
   *
   * COALESCE to 0 inside the aggregate is rule A4: a period in which nothing happened reports a
   * recorded nil, not a null and not a missing column. Where the GROUPED ROW ITSELF does not exist
   * on the actuals side, the outer SELECT coalesces again — that too is a real zero, because a
   * budget line with no transactions has had nothing spent on it.
   */
  function periodAggregates(periods, { amountExpr, dateExpr, firstParam }) {
    const params = []
    const fragments = periods.map((period, index) => {
      const fromParam = firstParam + index * 2
      const toParam = fromParam + 1
      params.push(period.from_date, period.to_date)
      return `COALESCE(sum(${amountExpr}) FILTER (
                   WHERE ${dateExpr} >= $${fromParam}::date AND ${dateExpr} <= $${toParam}::date
                 ), 0)::finance.money AS ${assertPeriodKey(period.key)}`
    })
    return { select: fragments.join(',\n                 '), params }
  }

  /** The outer-SELECT projection of the same period columns, coalesced for a missing join side. */
  const periodProjection = (periods, alias) => periods
    .map((p) => `COALESCE(${alias}.${assertPeriodKey(p.key)}, 0)::finance.money AS ${p.key}`)
    .join(',\n                ')

  /** A period's column definition. The header IS the period label — one source, no restating. */
  const periodColumns = (periods) =>
    periods.map((p) => ({ header: p.label, key: p.key, type: 'number' }))

  /**
   * The SELECT-list fragment that turns a phasing profile's recorded percentages into one
   * percentage per REPORT column, and the parameters it binds.
   *
   * `plan.keysByPeriod` (src/lib/financePeriods.js) says which of a profile's own period keys fall
   * inside each report column; this sums the percentages recorded against those keys. It is a SUM
   * OF RECORDED FIGURES and never a division of one — a profile recorded more coarsely than the
   * report is excluded from `usablePeriodicities` upstream rather than split here.
   *
   * The key lists are bound as `text[]` parameters. The only identifier composed into the string
   * is the report column's own key, behind `assertPeriodKey()`, prefixed `p_` so a percentage
   * column cannot collide with the actuals column of the same period.
   */
  function distributionAggregates(periods, plan, { firstParam }) {
    const params = []
    const fragments = periods.map((period, index) => {
      const keysParam = firstParam + index
      params.push(plan.keysByPeriod[period.key] || [])
      return `sum(dp.percentage) FILTER (
                   WHERE dp.period_key = ANY($${keysParam}::text[])
                 ) AS p_${assertPeriodKey(period.key)}`
    })
    return { select: fragments.join(',\n                 '), params }
  }

  /**
   * Which phasing profiles this run may honour, and why the others were left out.
   *
   * A profile is honoured only when ALL of the following hold. Each is a way a profile could
   * otherwise phase a budget line with figures nobody approved:
   *
   *   - it is `active` and not deleted — a draft is a profile being built (migration 204);
   *   - its periodicity can serve this report's periodicity, which rules out a profile recorded
   *     more coarsely than the columns asked for (a quarterly profile cannot produce a monthly
   *     budget without inventing two figures);
   *   - its period keys are exactly the keys this financial year generates at that periodicity,
   *     so a profile built for a twelve-month year cannot phase a nine-month one.
   *
   * The total-100 rule is NOT re-checked here. It is a deferred constraint trigger in the database
   * (migration 204), which is the only place it can be enforced against a row written by psql or
   * an import; re-asserting it in JavaScript would imply the database check was advisory.
   *
   * A profile that is left out is NAMED, with its reason, on the report's cover. A line using it
   * is then reported as having no phasing — which is the truth for this run — rather than silently
   * dropping to zero.
   */
  async function resolvePhasing({ yearId, plan }) {
    const none = { any: false, usableIds: [], usable: [], rejected: [], pending: false }
    if (!yearId) return none
    let rows
    try {
      ({ rows } = await pg.query(
        `SELECT s.distribution_id, s.name, s.periodicity, s.basis, s.status,
                s.period_keys, s.budget_lines_using
           FROM finance.v_budget_distribution_summary s
          WHERE s.financial_year_id = $1 AND s.status = 'active'
          ORDER BY s.name`,
        [yearId],
      ))
    } catch (err) {
      // 42P01 undefined_table: migration 204 has not been applied to this database. The management
      // account is older than the phasing tables and still has to work without them -- a
      // deployment that starts the application before the migration would otherwise serve a 500
      // on every period report. It then behaves exactly as it did before 204, and the cover says
      // the tables are absent, which is a different statement from "no profile has been recorded".
      if (err.code !== '42P01') throw err
      return { ...none, pending: true }
    }
    const usable = []
    const rejected = []
    for (const row of rows) {
      if (!plan.usablePeriodicities.includes(row.periodicity)) {
        rejected.push({
          name: row.name,
          reason: `recorded ${row.periodicity.replace(/_/g, '-')}, which is coarser than the periods this report is run at; splitting it would invent figures the Council did not approve`,
        })
        continue
      }
      const expected = plan.expectedKeys[row.periodicity] || []
      const held = row.period_keys || []
      if (held.length !== expected.length || expected.some((k, i) => held[i] !== k)) {
        rejected.push({
          name: row.name,
          reason: `its periods (${held.join(', ') || 'none'}) are not this financial year's ${row.periodicity.replace(/_/g, '-')} periods (${expected.join(', ')})`,
        })
        continue
      }
      usable.push({ id: row.distribution_id, name: row.name, basis: row.basis })
    }
    return { any: usable.length > 0, usableIds: usable.map((u) => u.id), usable, rejected, pending: false }
  }

  /**
   * Build one report. Shared by the JSON and the export paths so a downloaded file and the screen
   * it was downloaded from cannot disagree.
   */
  async function buildReport({
    report, yearId, compareYearId, departmentId, from, to, scope, includeRestricted,
    periodicity = null, accumulated = false,
    programmeId = null, accountId = null, wardCode = null,
    kind = null, expenditureClass = null, currency = null,
  }) {
    const year = yearId
      ? (await pg.query(
        `SELECT id, label, status, reporting_currency, ${dateText(null, 'start_date', 'end_date')}
           FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`,
        [yearId])).rows[0]
      : null
    if (yearId && !year) return { error: 'unknown_financial_year' }

    const compareYear = compareYearId
      ? (await pg.query(
        `SELECT id, label, status, reporting_currency, ${dateText(null, 'start_date', 'end_date')}
           FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`,
        [compareYearId])).rows[0]
      : null
    if (compareYearId && !compareYear) return { error: 'unknown_comparison_year' }

    const base = { report, financial_year: year, comparison_year: compareYear }

    if (report === 'year_on_year') {
      if (!year || !compareYear) return { error: 'comparison_year_required' }
      if (year.id === compareYear.id) return { error: 'same_financial_year' }

      // FULL OUTER JOIN: a line that exists in only one of the two years is still reported, with a
      // null on the missing side. Currencies are a join key, so a USD line and a ZWG line are two
      // rows and are never netted against each other.
      const { rows } = await pg.query(
        `WITH current_year AS (
           SELECT p.department_id, p.account_id, p.currency,
                  sum(p.revised_amount)::finance.money AS revised_amount,
                  sum(p.actual_amount)::finance.money AS actual_amount
             FROM finance.v_budget_line_performance p
            WHERE p.financial_year_id = $1
              AND ($3::uuid IS NULL OR p.department_id = $3::uuid)
              AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
            GROUP BY p.department_id, p.account_id, p.currency
         ), prior_year AS (
           SELECT p.department_id, p.account_id, p.currency,
                  sum(p.revised_amount)::finance.money AS revised_amount,
                  sum(p.actual_amount)::finance.money AS actual_amount
             FROM finance.v_budget_line_performance p
            WHERE p.financial_year_id = $2
              AND ($3::uuid IS NULL OR p.department_id = $3::uuid)
              AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
            GROUP BY p.department_id, p.account_id, p.currency
         )
         SELECT d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
                COALESCE(c.currency, pr.currency) AS currency,
                pr.revised_amount AS prior_revised_amount,
                c.revised_amount AS current_revised_amount,
                (COALESCE(c.revised_amount, 0) - COALESCE(pr.revised_amount, 0))::finance.money AS revised_change,
                pr.actual_amount AS prior_actual_amount,
                c.actual_amount AS current_actual_amount,
                (COALESCE(c.actual_amount, 0) - COALESCE(pr.actual_amount, 0))::finance.money AS actual_change
           FROM current_year c
           FULL OUTER JOIN prior_year pr
             ON pr.department_id = c.department_id
            AND pr.account_id = c.account_id
            AND pr.currency = c.currency
           JOIN finance.department d ON d.id = COALESCE(c.department_id, pr.department_id)
           JOIN finance.account a ON a.id = COALESCE(c.account_id, pr.account_id)
          ORDER BY d.code, a.code, currency`, [yearId, compareYearId, departmentId, scope],
      )
      return { ...base, columns: [
        { header: 'Department code', key: 'department_code' },
        { header: 'Department', key: 'department_name' },
        { header: 'Account code', key: 'account_code' },
        { header: 'Account', key: 'account_name' },
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Currency', key: 'currency' },
        { header: 'Prior year revised budget', key: 'prior_revised_amount', type: 'number' },
        { header: 'Current year revised budget', key: 'current_revised_amount', type: 'number' },
        { header: 'Change in revised budget', key: 'revised_change', type: 'number' },
        { header: 'Prior year actual', key: 'prior_actual_amount', type: 'number' },
        { header: 'Current year actual', key: 'current_actual_amount', type: 'number' },
        { header: 'Change in actual', key: 'actual_change', type: 'number' },
      ], rows }
    }

    if (report === 'budget_vs_actual') {
      const { rows } = await pg.query(
        `SELECT d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name, p.account_kind,
                p.code AS budget_line_code, p.description, p.currency,
                p.original_amount, p.approved_adjustments, p.revised_amount, p.actual_amount,
                p.open_commitments, p.available_excluding_commitments,
                p.available_including_commitments, p.execution_percentage, p.variance
           FROM finance.v_budget_line_performance p
           JOIN finance.department d ON d.id = p.department_id
           JOIN finance.account a ON a.id = p.account_id
          WHERE p.financial_year_id = $1
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
          ORDER BY d.code, a.code, p.code`, [yearId, departmentId, scope],
      )
      return { ...base, columns: [
        { header: 'Department code', key: 'department_code' },
        { header: 'Department', key: 'department_name' },
        { header: 'Account code', key: 'account_code' },
        { header: 'Account', key: 'account_name' },
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Budget line', key: 'budget_line_code' },
        { header: 'Description', key: 'description' },
        { header: 'Currency', key: 'currency' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Available (incl. commitments)', key: 'available_including_commitments', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
      ], rows }
    }

    if (report === 'departmental_summary' || report === 'revenue_performance' || report === 'expenditure_performance') {
      const kind = report === 'revenue_performance' ? 'revenue'
        : report === 'expenditure_performance' ? 'expenditure' : null
      const { rows } = await pg.query(
        `SELECT d.code AS department_code, d.name AS department_name,
                p.account_kind, p.currency, p.line_count,
                p.original_amount, p.approved_adjustments, p.revised_amount, p.actual_amount,
                p.open_commitments, p.available_excluding_commitments, p.execution_percentage
           FROM finance.v_department_performance p
           JOIN finance.department d ON d.id = p.department_id
          WHERE p.financial_year_id = $1
            AND ($2::text IS NULL OR p.account_kind = $2::text)
            AND ($3::uuid IS NULL OR p.department_id = $3::uuid)
            AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
          ORDER BY d.code, p.account_kind, p.currency`, [yearId, kind, departmentId, scope],
      )
      return { ...base, columns: [
        { header: 'Department code', key: 'department_code' },
        { header: 'Department', key: 'department_name' },
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
      ], rows }
    }

    if (report === 'project_performance') {
      const { rows } = await pg.query(
        `SELECT p.reference, p.name, p.status, p.ward_code, p.currency,
                d.code AS department_code, d.name AS department_name,
                p.approved_budget, p.allocated_original, p.allocated_revisions, p.allocated_total,
                p.actual_spend, p.remaining_allocation, p.execution_percentage,
                p.linked_subject_kind, p.linked_subject_id, p.transaction_rows,
                p.last_transaction_date::text AS last_transaction_date
           FROM finance.v_project_performance p
           LEFT JOIN finance.department d ON d.id = p.department_id
          WHERE ($1::uuid IS NULL OR p.department_id = $1::uuid)
            AND ($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]) OR p.department_id IS NULL)
          ORDER BY p.reference`, [departmentId, scope],
      )
      return { ...base, columns: [
        { header: 'Reference', key: 'reference' },
        { header: 'Project', key: 'name' },
        { header: 'Status', key: 'status' },
        { header: 'Ward', key: 'ward_code' },
        { header: 'Department', key: 'department_name' },
        { header: 'Currency', key: 'currency' },
        { header: 'Approved budget', key: 'approved_budget', type: 'number' },
        { header: 'Allocated (original)', key: 'allocated_original', type: 'number' },
        { header: 'Allocated (revisions)', key: 'allocated_revisions', type: 'number' },
        { header: 'Allocated (total)', key: 'allocated_total', type: 'number' },
        { header: 'Actual spend', key: 'actual_spend', type: 'number' },
        { header: 'Remaining allocation', key: 'remaining_allocation', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
        { header: 'Linked record type', key: 'linked_subject_kind' },
        { header: 'Linked record id', key: 'linked_subject_id' },
        { header: 'Transactions', key: 'transaction_rows', type: 'number' },
        { header: 'Last transaction', key: 'last_transaction_date', type: 'date' },
      ], rows }
    }

    if (report === 'budget_revisions') {
      const { rows } = await pg.query(
        `SELECT l.code AS budget_line_code, l.description, d.code AS department_code, d.name AS department_name,
                r.revision_no, r.amount_delta, r.currency, r.reason, r.state,
                r.effective_date::text AS effective_date, r.requested_at, r.decided_at, r.decision_note,
                COALESCE(ru.full_name, ru.name) AS requested_by,
                COALESCE(du.full_name, du.name) AS decided_by,
                l.original_amount
           FROM finance.budget_revision r
           JOIN finance.budget_line l ON l.id = r.budget_line_id
           JOIN finance.department d ON d.id = l.department_id
           LEFT JOIN public.users ru ON ru.id = r.requested_by
           LEFT JOIN public.users du ON du.id = r.decided_by
          WHERE l.financial_year_id = $1 AND r.deleted_at IS NULL
            AND ($2::uuid IS NULL OR l.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR l.department_id = ANY($3::uuid[]))
          ORDER BY d.code, l.code, r.revision_no`, [yearId, departmentId, scope],
      )
      return { ...base, columns: [
        { header: 'Department', key: 'department_name' },
        { header: 'Budget line', key: 'budget_line_code' },
        { header: 'Description', key: 'description' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Revision no.', key: 'revision_no', type: 'number' },
        { header: 'Change', key: 'amount_delta', type: 'number' },
        { header: 'Currency', key: 'currency' },
        { header: 'Reason', key: 'reason' },
        { header: 'State', key: 'state' },
        { header: 'Effective date', key: 'effective_date', type: 'date' },
        { header: 'Requested by', key: 'requested_by' },
        { header: 'Requested at', key: 'requested_at' },
        { header: 'Decided by', key: 'decided_by' },
        { header: 'Decided at', key: 'decided_at' },
        { header: 'Decision note', key: 'decision_note' },
      ], rows }
    }

    if (report === 'transaction_register') {
      const { rows } = await pg.query(
        `SELECT t.txn_date::text AS txn_date, t.amount, t.currency, t.description, t.reference, t.record_type,
                a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
                d.code AS department_code, d.name AS department_name,
                l.code AS budget_line_code,
                t.source_system, t.source_ref, t.import_batch_id
                ${includeRestricted ? ', t.counterparty_ref, t.counterparty_name' : ''}
           FROM finance.transaction t
           JOIN finance.account a ON a.id = t.account_id
           JOIN finance.department d ON d.id = t.department_id
           LEFT JOIN finance.budget_line l ON l.id = t.budget_line_id
          WHERE t.financial_year_id = $1 AND t.deleted_at IS NULL
            AND ($2::uuid IS NULL OR t.department_id = $2::uuid)
            AND ($3::date IS NULL OR t.txn_date >= $3::date)
            AND ($4::date IS NULL OR t.txn_date <= $4::date)
            AND ($5::uuid[] IS NULL OR t.department_id = ANY($5::uuid[]))
          ORDER BY t.txn_date, t.id
          LIMIT 100000`, [yearId, departmentId, from, to, scope],
      )
      const columns = [
        { header: 'Date', key: 'txn_date', type: 'date' },
        { header: 'Department code', key: 'department_code' },
        { header: 'Department', key: 'department_name' },
        { header: 'Account code', key: 'account_code' },
        { header: 'Account', key: 'account_name' },
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Budget line', key: 'budget_line_code' },
        { header: 'Description', key: 'description' },
        { header: 'Reference', key: 'reference' },
        { header: 'Record type', key: 'record_type' },
        { header: 'Amount', key: 'amount', type: 'number' },
        { header: 'Currency', key: 'currency' },
        { header: 'Source system', key: 'source_system' },
        { header: 'Source reference', key: 'source_ref' },
        { header: 'Import batch', key: 'import_batch_id' },
      ]
      if (includeRestricted) {
        columns.push(
          { header: 'Counterparty reference', key: 'counterparty_ref' },
          { header: 'Counterparty name', key: 'counterparty_name' },
        )
      }
      return { ...base, columns, rows, restricted: includeRestricted }
    }

    if (report === 'import_reconciliation') {
      const { rows } = await pg.query(
        `SELECT b.original_filename, b.dataset, b.file_hash, b.file_size_bytes,
                b.uploaded_at, b.validated_at, b.committed_at, b.status,
                b.rows_total, b.rows_valid, b.rows_rejected,
                b.declared_control_count, b.declared_control_total, b.declared_control_currency,
                b.reconciled_count, b.reconciled_total, b.reconciliation_status, b.error_summary,
                COALESCE(uu.full_name, uu.name) AS uploaded_by,
                COALESCE(cu.full_name, cu.name) AS committed_by
           FROM finance.import_batch b
           LEFT JOIN public.users uu ON uu.id = b.uploaded_by
           LEFT JOIN public.users cu ON cu.id = b.committed_by
          WHERE b.financial_year_id = $1 AND b.deleted_at IS NULL
          ORDER BY b.uploaded_at DESC`, [yearId],
      )
      return { ...base, columns: [
        { header: 'File', key: 'original_filename' },
        { header: 'Dataset', key: 'dataset' },
        { header: 'SHA-256', key: 'file_hash' },
        { header: 'Size (bytes)', key: 'file_size_bytes', type: 'number' },
        { header: 'Status', key: 'status' },
        { header: 'Rows in file', key: 'rows_total', type: 'number' },
        { header: 'Valid rows', key: 'rows_valid', type: 'number' },
        { header: 'Rejected rows', key: 'rows_rejected', type: 'number' },
        { header: 'Council declared count', key: 'declared_control_count', type: 'number' },
        { header: 'Council declared total', key: 'declared_control_total', type: 'number' },
        { header: 'Declared currency', key: 'declared_control_currency' },
        { header: 'Count from file', key: 'reconciled_count', type: 'number' },
        { header: 'Total from file', key: 'reconciled_total', type: 'number' },
        { header: 'Reconciliation', key: 'reconciliation_status' },
        { header: 'Notes', key: 'error_summary' },
        { header: 'Uploaded by', key: 'uploaded_by' },
        { header: 'Uploaded at', key: 'uploaded_at' },
        { header: 'Committed by', key: 'committed_by' },
        { header: 'Committed at', key: 'committed_at' },
      ], rows }
    }

    // ── Workstream W2: management accounts and statutory returns ─────────────────────────────
    //
    // Every one of these reports takes its money from the views that already compute it in
    // NUMERIC — finance.v_budget_line_performance (migration 188:796), v_ward_performance
    // (202:248) — rather than re-deriving a total. Nothing below adds two amounts in JavaScript.
    // Every report carries a currency column and groups by it, so no figure spans USD and ZWG
    // (decision D4 / A5).

    const DEPARTMENT_COLUMNS = [
      { header: 'Department code', key: 'department_code' },
      { header: 'Department', key: 'department_name' },
    ]
    const ACCOUNT_COLUMNS = [
      { header: 'Account code', key: 'account_code' },
      { header: 'Account', key: 'account_name' },
    ]

    if (report === 'management_accounts' || report === 'quarterly_return') {
      // The quarterly return (N33) is the management account (N32) in its cumulative quarterly
      // form: the same grain, the same measures, the same builder. Its periodicity and its
      // accumulation are FIXED rather than offered, because a return to the parent Ministry is
      // quarterly and cumulative by definition and a monthly one would not be that return.
      if (!year) return { error: 'financial_year_required' }
      const isReturn = report === 'quarterly_return'
      const usePeriodicity = isReturn ? 'quarterly' : (periodicity || 'monthly')
      const useAccumulated = isReturn ? true : accumulated === true

      let plan
      try {
        plan = distributionPlan({
          start: year.start_date, end: year.end_date,
          periodicity: usePeriodicity, accumulated: useAccumulated,
        })
      } catch (err) {
        return { error: 'bad_period_range', message: err.message }
      }
      const periods = plan.periods

      // BUDGET PHASING (migration 204). A budget line may carry a profile saying how its annual
      // allocation is expected to fall across the year. Where every line behind a figure carries a
      // usable one, this report shows a per-period BUDGET and a per-period VARIANCE — the figures
      // a management account exists for. Where any line does not, those two columns are blank for
      // that figure and the row says the phasing is not recorded.
      //
      // Blank, never an even twelfth. `budget_line.distribution_id` being NULL means the phasing
      // was never recorded, and that is not the same fact as a Council resolution to spread
      // evenly — the same distinction `physical_progress_percent` draws under decision D12. An
      // even spread is available, as a profile whose periods are equal and whose `basis` says the
      // Council chose it.
      const phasing = await resolvePhasing({ yearId, plan })

      // The period buckets tile [start_date, end_date]. A transaction stamped with this financial
      // year but dated outside those two dates therefore falls in no bucket. It is counted rather
      // than silently lost, so the row says so instead of the period columns quietly failing to
      // add up to the year-to-date figure.
      const buckets = periodAggregates(periods, {
        amountExpr: 't.amount', dateExpr: 't.txn_date', firstParam: 9,
      })
      const idsParam = 9 + buckets.params.length
      const pct = phasing.any
        ? distributionAggregates(periods, plan, { firstParam: idsParam + 1 })
        : { select: '', params: [] }

      // The per-period budget, computed in SQL over NUMERIC: the line's revised allocation times
      // the percentage recorded for that period. Complete-or-NULL at the figure's own grain — one
      // unphased line among ten makes the whole figure blank, because a budget covering nine
      // tenths of a vote wearing the vote's label is worse than no figure at all. The same rule
      // migration 202 applies to the ward measures.
      const phasedBudget = phasing.any
        ? periods.map((p) => `,
                  CASE WHEN count(*) FILTER (WHERE pc.distribution_id IS NULL) = 0
                       THEN sum(p.revised_amount * COALESCE(pc.p_${assertPeriodKey(p.key)}, 0) / 100)::finance.money
                  END AS b_${p.key}`).join('')
        : ''

      const { rows } = await pg.query(
        `WITH ${phasing.any ? `pct AS (
           SELECT dp.distribution_id,
                  ${pct.select}
             FROM finance.budget_distribution_period dp
            WHERE dp.distribution_id = ANY($${idsParam}::uuid[]) AND dp.deleted_at IS NULL
            GROUP BY dp.distribution_id
         ), ` : ''}budget AS (
           SELECT p.department_id, p.account_id, p.currency,
                  count(*)::int                              AS line_count,
                  ${phasing.any
    ? `count(*) FILTER (WHERE pc.distribution_id IS NOT NULL)::int AS phased_lines,
                  count(*) FILTER (WHERE pc.distribution_id IS NULL)::int  AS unphased_lines,`
    : '0::int AS phased_lines, count(*)::int AS unphased_lines,'}
                  sum(p.original_amount)::finance.money      AS original_amount,
                  sum(p.approved_adjustments)::finance.money AS approved_adjustments,
                  sum(p.revised_amount)::finance.money       AS revised_amount,
                  sum(p.open_commitments)::finance.money     AS open_commitments${phasedBudget}
             FROM finance.v_budget_line_performance p
             ${phasing.any
    ? `JOIN finance.budget_line bl ON bl.id = p.budget_line_id AND bl.deleted_at IS NULL
             LEFT JOIN pct pc ON pc.distribution_id = bl.distribution_id`
    : ''}
            WHERE p.financial_year_id = $1
              AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
              AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
              AND ($4::text IS NULL OR p.account_kind = $4::text)
              AND ($5::text IS NULL OR p.currency = $5::text)
              AND ($6::uuid IS NULL OR p.account_id = $6::uuid)
            GROUP BY p.department_id, p.account_id, p.currency
         ), actual AS (
           SELECT t.department_id, t.account_id, t.currency,
                  ${buckets.select},
                  COALESCE(sum(t.amount) FILTER (
                    WHERE t.txn_date >= $7::date AND t.txn_date <= $8::date
                  ), 0)::finance.money AS actual_year_to_date,
                  count(*) FILTER (
                    WHERE t.txn_date < $7::date OR t.txn_date > $8::date
                  )::int AS outside_year_dates_rows
             FROM finance.transaction t
             JOIN finance.account a ON a.id = t.account_id
            WHERE t.financial_year_id = $1 AND t.deleted_at IS NULL
              AND ($2::uuid IS NULL OR t.department_id = $2::uuid)
              AND ($3::uuid[] IS NULL OR t.department_id = ANY($3::uuid[]))
              AND ($4::text IS NULL OR a.kind = $4::text)
              AND ($5::text IS NULL OR t.currency = $5::text)
              AND ($6::uuid IS NULL OR t.account_id = $6::uuid)
            GROUP BY t.department_id, t.account_id, t.currency
         )
         SELECT d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
                COALESCE(b.currency, ac.currency) AS currency,
                -- The annual allocation, always. The per-period budget beside it exists only
                -- where a phasing profile was recorded for every line behind the figure.
                b.revised_amount,
                COALESCE(b.line_count, 0)::int     AS line_count,
                COALESCE(b.phased_lines, 0)::int   AS phased_lines,
                COALESCE(b.unphased_lines, 0)::int AS unphased_lines,
                CASE WHEN b.line_count IS NULL   THEN 'no budget line'
                     WHEN b.unphased_lines = 0   THEN 'phased'
                     WHEN b.phased_lines  = 0    THEN 'not recorded'
                     ELSE 'partly recorded'
                END AS phasing_status,
                ${periodProjection(periods, 'ac')},${phasing.any ? `
                ${periods.map((p) => `b.b_${p.key},
                CASE WHEN b.b_${p.key} IS NULL THEN NULL
                     WHEN a.kind = 'revenue' THEN (COALESCE(ac.${p.key}, 0) - b.b_${p.key})
                     ELSE (b.b_${p.key} - COALESCE(ac.${p.key}, 0))
                END::finance.money AS v_${p.key}`).join(',\n                ')},` : ''}
                COALESCE(ac.actual_year_to_date, 0)::finance.money AS actual_year_to_date,
                -- NULL, not zero, where nothing was budgeted on this account: a variance against
                -- an allocation that does not exist is not a figure.
                CASE WHEN b.revised_amount IS NULL THEN NULL
                     WHEN a.kind = 'revenue'
                     THEN (COALESCE(ac.actual_year_to_date, 0) - b.revised_amount)
                     ELSE (b.revised_amount - COALESCE(ac.actual_year_to_date, 0))
                END::finance.money AS variance,
                CASE WHEN b.revised_amount IS NULL OR b.revised_amount = 0 THEN NULL
                     ELSE round(COALESCE(ac.actual_year_to_date, 0) * 100 / b.revised_amount, 2)
                END AS execution_percentage,
                COALESCE(b.open_commitments, 0)::finance.money AS open_commitments,
                COALESCE(ac.outside_year_dates_rows, 0)::int AS outside_year_dates_rows
           FROM budget b
           FULL OUTER JOIN actual ac
             ON ac.department_id = b.department_id
            AND ac.account_id = b.account_id
            -- Currency is a JOIN KEY, so a USD figure and a ZWG figure are two rows and are
            -- never netted against one another (A5).
            AND ac.currency = b.currency
           JOIN finance.department d ON d.id = COALESCE(b.department_id, ac.department_id)
           JOIN finance.account a    ON a.id = COALESCE(b.account_id, ac.account_id)
          ORDER BY d.code, a.code, COALESCE(b.currency, ac.currency)`,
        [yearId, departmentId, scope, kind, currency, accountId,
          year.start_date, year.end_date, ...buckets.params,
          ...(phasing.any ? [phasing.usableIds, ...pct.params] : [])],
      )

      // Counts for the cover, taken from the rows the report is actually made of rather than from
      // a separate query that could describe a different set.
      const phasedFigures = rows.filter((r) => r.phasing_status === 'phased').length
      const partFigures = rows.filter((r) => r.phasing_status === 'partly recorded').length
      const unphasedFigures = rows.filter((r) => r.phasing_status === 'not recorded').length

      return {
        ...base,
        periodicity: usePeriodicity,
        accumulated: useAccumulated,
        periods,
        phasing: {
          profiles_used: phasing.usable.map((u) => ({ name: u.name, basis: u.basis })),
          profiles_not_used: phasing.rejected,
          figures_phased: phasedFigures,
          figures_partly_phased: partFigures,
          figures_not_phased: unphasedFigures,
        },
        columns: [
          ...DEPARTMENT_COLUMNS, ...ACCOUNT_COLUMNS,
          { header: 'Revenue/expenditure', key: 'account_kind' },
          { header: 'Currency', key: 'currency' },
          { header: 'Revised budget (annual)', key: 'revised_amount', type: 'number' },
          ...(phasing.any ? [
            { header: 'Phasing', key: 'phasing_status' },
            { header: 'Budget lines', key: 'line_count', type: 'number' },
            { header: 'Lines with phasing recorded', key: 'phased_lines', type: 'number' },
            { header: 'Lines with no phasing', key: 'unphased_lines', type: 'number' },
          ] : []),
          // With no phasing anywhere, a period column is the actual and nothing else, and the
          // header is the bare period label — the report is unchanged from before migration 204.
          // With phasing, each period carries actual, budget and variance, and each header says
          // which it is.
          ...(phasing.any
            ? periods.flatMap((p) => [
              { header: `${p.label} actual`, key: p.key, type: 'number' },
              { header: `${p.label} budget`, key: `b_${p.key}`, type: 'number' },
              { header: `${p.label} variance`, key: `v_${p.key}`, type: 'number' },
            ])
            : periodColumns(periods)),
          { header: 'Actual year to date', key: 'actual_year_to_date', type: 'number' },
          { header: 'Variance', key: 'variance', type: 'number' },
          { header: 'Execution %', key: 'execution_percentage', type: 'number' },
          { header: 'Open commitments', key: 'open_commitments', type: 'number' },
          { header: 'Transactions dated outside the year', key: 'outside_year_dates_rows', type: 'number' },
        ],
        rows,
        notes: [
          ['Period columns', useAccumulated
            ? 'CUMULATIVE. Each column runs from the financial year\'s start date to that period\'s end, so the columns overlap and must not be added together. The last column is the whole year.'
            : 'DISCRETE. Each column covers its own period only; the periods tile the financial year exactly, so the columns add up to the year-to-date figure.'],
          ['Budget phasing', phasing.any
            ? `Recorded. ${phasedFigures} figure(s) have a phasing profile on every budget line behind them and carry a per-period budget and variance; ${partFigures} have it on some lines only and ${unphasedFigures} on none. A figure is phased only where EVERY line behind it is: a budget covering part of a vote under the vote's own heading would be worse than a blank.`
            : (phasing.pending
              ? 'NOT AVAILABLE. The budget phasing tables are not present on this database (migration 204 has not been applied), so no line can carry a phasing profile. The budget column is the ANNUAL revised allocation and the period columns are actuals. This is a deployment state, not a statement about what the Council has recorded.'
              : 'NOT RECORDED. No active phasing profile exists for this financial year (finance.budget_distribution, migration 204), so the budget column is the ANNUAL revised allocation and the period columns are actuals. No allocation has been divided across periods and no even twelfth has been assumed.')],
          ...(phasing.any ? [
            ['Profiles applied', phasing.usable
              .map((u) => `${u.name}${u.basis === 'distribute_equally' ? ' (an even spread, recorded as a Council choice)' : ''}`)
              .join('; ')],
          ] : []),
          ...(phasing.rejected.length ? [
            ['Profiles NOT applied', phasing.rejected
              .map((r) => `${r.name} — ${r.reason}`)
              .join('; ')],
          ] : []),
          ['Lines with no phasing', 'A budget line whose phasing has not been recorded keeps its annual allocation and gets NO per-period budget and NO per-period variance. A missing profile is not an instruction to spread the allocation evenly; an even spread is available as a profile the Council records deliberately (decision D20).'],
          ['Empty periods', 'A period in which nothing was recorded keeps its column and reports zero. No figure is interpolated or carried forward.'],
          ['Unbudgeted accounts', 'A row with actuals and no revised budget is an account with no budget line in this year. Its budget, variance and execution are blank — "not recorded" — rather than zero.'],
        ],
      }
    }

    if (report === 'budget_execution_statement') {
      // N34. The year-end statement for the Auditor-General. It is a BUDGET-EXECUTION statement:
      // this system is a register of imported actuals and not a book of account, so it is not a
      // financial statement, a balance sheet or a trial balance and does not claim to be.
      // Commitments are a separate column, never netted into the actual.
      const { rows } = await pg.query(
        `SELECT d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name, p.account_kind,
                a.expenditure_class, a.revenue_class, p.currency,
                count(*)::int                                            AS line_count,
                sum(p.original_amount)::finance.money                    AS original_amount,
                sum(p.approved_adjustments)::finance.money               AS approved_adjustments,
                sum(p.revised_amount)::finance.money                     AS revised_amount,
                sum(p.actual_amount)::finance.money                      AS actual_amount,
                sum(p.open_commitments)::finance.money                   AS open_commitments,
                sum(p.available_excluding_commitments)::finance.money    AS available_excluding_commitments,
                sum(p.available_including_commitments)::finance.money    AS available_including_commitments,
                -- The view's own variance column already carries §6.2's and §6.3's opposite sign
                -- conventions per line, and every line in a group shares one account kind, so
                -- summing it cannot drift from what the consoles show.
                sum(p.variance)::finance.money                           AS variance,
                CASE WHEN sum(p.revised_amount) = 0 THEN NULL
                     ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2)
                END AS execution_percentage
           FROM finance.v_budget_line_performance p
           JOIN finance.department d ON d.id = p.department_id
           JOIN finance.account a    ON a.id = p.account_id
          WHERE p.financial_year_id = $1
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.account_kind = $4::text)
            AND ($5::text IS NULL OR p.currency = $5::text)
            AND ($6::uuid IS NULL OR p.account_id = $6::uuid)
          GROUP BY d.code, d.name, a.code, a.name, p.account_kind,
                   a.expenditure_class, a.revenue_class, p.currency
          ORDER BY p.account_kind, d.code, a.code, p.currency`,
        [yearId, departmentId, scope, kind, currency, accountId],
      )
      return { ...base, columns: [
        ...DEPARTMENT_COLUMNS, ...ACCOUNT_COLUMNS,
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Capital/recurrent', key: 'expenditure_class' },
        { header: 'Revenue class', key: 'revenue_class' },
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Available (incl. commitments)', key: 'available_including_commitments', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
      ], rows, notes: [
        ['What this statement is', 'A statement of budget execution: what the Council approved, what it revised, and what was actually recorded against it. It is NOT a financial statement, a balance sheet, a trial balance or a cash-flow statement. This system is a register of actuals imported from the council\'s accounting records and is not a book of account.'],
        ['Commitments', 'Shown in their own column and never netted into the actual. The two available-balance definitions of §6.1 are both given so a reader can see which one a figure is.'],
        ['Variance sign', 'Revenue variance is actual less revised (§6.2); expenditure variance is revised less actual (§6.3). A positive expenditure variance is an underspend.'],
      ] }
    }

    if (report === 'variance_report') {
      // N5. The authorised explanation text joined on to the line it explains, and a line with no
      // explanation listed AS unexplained — that distinction is the whole report. Unexplained
      // lines sort first, then by the size of the variance, so the director reads the gap first.
      //
      // `finance.variance_explanation` has no state column: there is no draft or rejected
      // explanation to filter out. Its authorisation is in WHO MAY RECORD ONE — the POST at
      // finance-budget.js:721 is permission-guarded — and in `recorded_by` / `recorded_at`, both
      // of which are reported here so a reader can see on whose authority the text stands.
      const { rows } = await pg.query(
        `SELECT d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name, p.account_kind,
                p.code AS budget_line_code, p.description, p.currency,
                p.original_amount, p.approved_adjustments, p.revised_amount, p.actual_amount,
                p.variance,
                CASE WHEN p.revised_amount = 0 THEN NULL
                     ELSE round(abs(p.variance) * 100 / abs(p.revised_amount), 2)
                END AS variance_percentage,
                CASE WHEN e.id IS NULL THEN 'unexplained' ELSE 'explained' END AS explanation_status,
                e.explanation, e.period_label AS explanation_period,
                e.recorded_at AS explanation_recorded_at,
                COALESCE(eu.full_name, eu.name) AS explanation_recorded_by,
                COALESCE(ec.explanation_count, 0)::int AS explanation_count
           FROM finance.v_budget_line_performance p
           JOIN finance.department d ON d.id = p.department_id
           JOIN finance.account a    ON a.id = p.account_id
           -- The most recent explanation on record for this line in this year. Earlier ones are
           -- not overwritten and are counted, so a reader can see that the text they are reading
           -- is the latest of several.
           LEFT JOIN LATERAL (
             SELECT v.id, v.explanation, v.period_label, v.recorded_at, v.recorded_by
               FROM finance.variance_explanation v
              WHERE v.budget_line_id = p.budget_line_id
                AND v.financial_year_id = p.financial_year_id
                AND v.deleted_at IS NULL
              ORDER BY v.recorded_at DESC, v.id
              LIMIT 1
           ) e ON true
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS explanation_count
               FROM finance.variance_explanation v2
              WHERE v2.budget_line_id = p.budget_line_id
                AND v2.financial_year_id = p.financial_year_id
                AND v2.deleted_at IS NULL
           ) ec ON true
           LEFT JOIN public.users eu ON eu.id = e.recorded_by
          WHERE p.financial_year_id = $1
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.account_kind = $4::text)
            AND ($5::text IS NULL OR p.currency = $5::text)
            AND ($6::uuid IS NULL OR p.account_id = $6::uuid)
          ORDER BY (e.id IS NULL) DESC, abs(p.variance) DESC, d.code, p.code`,
        [yearId, departmentId, scope, kind, currency, accountId],
      )
      return { ...base, columns: [
        ...DEPARTMENT_COLUMNS, ...ACCOUNT_COLUMNS,
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Budget line', key: 'budget_line_code' },
        { header: 'Description', key: 'description' },
        { header: 'Currency', key: 'currency' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Variance % of revised', key: 'variance_percentage', type: 'number' },
        { header: 'Explained?', key: 'explanation_status' },
        { header: 'Explanation', key: 'explanation' },
        { header: 'Explanation period', key: 'explanation_period' },
        { header: 'Recorded by', key: 'explanation_recorded_by' },
        { header: 'Recorded at', key: 'explanation_recorded_at' },
        { header: 'Explanations on record', key: 'explanation_count', type: 'number' },
      ], rows, notes: [
        ['Unexplained lines', 'A line whose variance has no explanation on record is listed with "unexplained" in the Explained? column and sorts to the top. An absent explanation is reported, never inferred and never left looking like an explained line with an empty cell.'],
        ['Authority for an explanation', 'finance.variance_explanation carries no approval state. Its authority is the permission required to record one and the officer and time recorded against it, all of which are columns here.'],
        ['Variance %', 'Variance as a proportion of the revised budget, unsigned. Undefined — blank, not zero — where the revised budget is nil.'],
      ] }
    }

    if (report === 'revenue_by_source') {
      // N3. The report `revenue_performance`'s catalogue entry used to promise: revenue grouped by
      // its SOURCE ACCOUNT rather than by department, and with the §6.2 variance that the old
      // report omits. `revenue_performance` is kept and still works; this is the correct one.
      const { rows } = await pg.query(
        `SELECT a.code AS account_code, a.name AS account_name,
                COALESCE(a.revenue_class, 'not recorded') AS revenue_class,
                p.currency,
                count(*)::int                                AS line_count,
                sum(p.original_amount)::finance.money        AS original_amount,
                sum(p.approved_adjustments)::finance.money   AS approved_adjustments,
                sum(p.revised_amount)::finance.money         AS budgeted_revenue,
                sum(p.actual_amount)::finance.money          AS collected_revenue,
                sum(p.variance)::finance.money               AS variance,
                CASE WHEN sum(p.revised_amount) = 0 THEN NULL
                     ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2)
                END AS collection_percentage
           FROM finance.v_budget_line_performance p
           JOIN finance.account a ON a.id = p.account_id
          WHERE p.financial_year_id = $1
            AND p.account_kind = 'revenue'
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.currency = $4::text)
          GROUP BY a.code, a.name, COALESCE(a.revenue_class, 'not recorded'), p.currency
          ORDER BY a.code, p.currency`,
        [yearId, departmentId, scope, currency],
      )
      return { ...base, columns: [
        { header: 'Revenue account code', key: 'account_code' },
        { header: 'Revenue source', key: 'account_name' },
        { header: 'Revenue class', key: 'revenue_class' },
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original estimate', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised estimate', key: 'budgeted_revenue', type: 'number' },
        { header: 'Collected', key: 'collected_revenue', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Collection %', key: 'collection_percentage', type: 'number' },
      ], rows, notes: [
        ['Grouping', 'By revenue ACCOUNT — the source the money comes from. The older "Revenue performance" report groups by department and is kept for continuity.'],
        ['Revenue class', 'Set by Council on the account: internally generated, grant, transfer or other. An account on which Council has set none is reported as "not recorded" in its own row and is not assumed to be any of the four.'],
        ['Variance', 'Actual collections less the revised estimate (§6.2). A negative figure is a shortfall.'],
      ] }
    }

    if (report === 'capital_vs_recurrent') {
      // N23. finance.account.expenditure_class is set by Council per account (migration 188:213)
      // and is NULLABLE. An account with no class is reported in a row of its own, labelled
      // "not classified": folding it into recurrent would turn a gap in the chart of accounts
      // into a capital figure nobody can reconcile.
      const { rows } = await pg.query(
        `SELECT COALESCE(a.expenditure_class, 'not classified') AS expenditure_class,
                d.code AS department_code, d.name AS department_name, p.currency,
                count(*)::int                                          AS line_count,
                sum(p.original_amount)::finance.money                  AS original_amount,
                sum(p.approved_adjustments)::finance.money             AS approved_adjustments,
                sum(p.revised_amount)::finance.money                   AS revised_amount,
                sum(p.actual_amount)::finance.money                    AS actual_amount,
                sum(p.open_commitments)::finance.money                 AS open_commitments,
                sum(p.available_excluding_commitments)::finance.money  AS available_excluding_commitments,
                sum(p.variance)::finance.money                         AS variance,
                CASE WHEN sum(p.revised_amount) = 0 THEN NULL
                     ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2)
                END AS execution_percentage
           FROM finance.v_budget_line_performance p
           JOIN finance.department d ON d.id = p.department_id
           JOIN finance.account a    ON a.id = p.account_id
          WHERE p.financial_year_id = $1
            AND p.account_kind = 'expenditure'
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.currency = $4::text)
            AND ($5::text IS NULL OR a.expenditure_class = $5::text)
          GROUP BY COALESCE(a.expenditure_class, 'not classified'),
                   d.code, d.name, p.currency
          ORDER BY 1, d.code, p.currency`,
        [yearId, departmentId, scope, currency, expenditureClass],
      )
      return { ...base, columns: [
        { header: 'Capital/recurrent', key: 'expenditure_class' },
        ...DEPARTMENT_COLUMNS,
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
      ], rows, notes: [
        ['Scope', 'Expenditure only. Revenue has no capital/recurrent class and is reported by Revenue by source.'],
        ['Unclassified accounts', 'An expenditure account on which Council has set no capital or recurrent class is reported in a row labelled "not classified". It is never folded into recurrent.'],
      ] }
    }

    if (report === 'funding_source') {
      // N24. finance.budget_line.funding_source_account_id (migration 188:403) points at the
      // revenue account the money is expected to come from, and that account's `revenue_class`
      // (188:213) is the internally-generated / grant / transfer / other distinction §3.4 asks
      // for. The column is nullable, so a line with no funding source recorded is a labelled row
      // of its own rather than an omission.
      //
      // Budget lines only. finance.project.funding_source_account_id exists too, but project
      // figures span financial years (v_project_performance.financial_year_ids) and reporting them
      // under a single year's heading is the defect `project_performance` already has; it is not
      // reproduced here. The cover says so.
      const { rows } = await pg.query(
        `SELECT COALESCE(f.code, 'not recorded') AS funding_source_code,
                COALESCE(f.name, 'No funding source recorded on the line') AS funding_source_name,
                COALESCE(f.revenue_class, 'not recorded') AS funding_source_class,
                p.account_kind, p.currency,
                count(*)::int                                          AS line_count,
                sum(p.original_amount)::finance.money                  AS original_amount,
                sum(p.approved_adjustments)::finance.money             AS approved_adjustments,
                sum(p.revised_amount)::finance.money                   AS revised_amount,
                sum(p.actual_amount)::finance.money                    AS actual_amount,
                sum(p.open_commitments)::finance.money                 AS open_commitments,
                sum(p.available_excluding_commitments)::finance.money  AS available_excluding_commitments,
                sum(p.variance)::finance.money                         AS variance,
                CASE WHEN sum(p.revised_amount) = 0 THEN NULL
                     ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2)
                END AS execution_percentage
           FROM finance.v_budget_line_performance p
           JOIN finance.budget_line bl ON bl.id = p.budget_line_id AND bl.deleted_at IS NULL
           LEFT JOIN finance.account f ON f.id = bl.funding_source_account_id
                                      AND f.deleted_at IS NULL
          WHERE p.financial_year_id = $1
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.account_kind = $4::text)
            AND ($5::text IS NULL OR p.currency = $5::text)
          GROUP BY COALESCE(f.code, 'not recorded'),
                   COALESCE(f.name, 'No funding source recorded on the line'),
                   COALESCE(f.revenue_class, 'not recorded'),
                   p.account_kind, p.currency
          ORDER BY 1, p.account_kind, p.currency`,
        [yearId, departmentId, scope, kind, currency],
      )
      return { ...base, columns: [
        { header: 'Funding source code', key: 'funding_source_code' },
        { header: 'Funding source', key: 'funding_source_name' },
        { header: 'Funding source class', key: 'funding_source_class' },
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
      ], rows, notes: [
        ['Source of the grouping', 'The funding source account recorded on the budget line (finance.budget_line.funding_source_account_id). The class shown is that account\'s own revenue class as set by Council.'],
        ['Lines with no funding source', 'Reported together in a row labelled "not recorded". The column is optional in the schema and an unrecorded source is a fact, not a zero.'],
        ['Projects', 'This report covers BUDGET LINES. A project also carries a funding source, but project figures span financial years and cannot honestly be reported under a single year\'s heading; use Project performance for those.'],
      ] }
    }

    if (report === 'programme_performance') {
      // N37 / N4. finance.programme and finance.activity exist (migration 188:168, 188:185) and no
      // report grouped by them. Both columns on a budget line are optional, so a line outside any
      // programme — or inside one with no activity named — is reported in a labelled row.
      const { rows } = await pg.query(
        `SELECT COALESCE(pr.code, 'not recorded') AS programme_code,
                COALESCE(pr.name, 'No programme recorded on the line') AS programme_name,
                COALESCE(av.code, 'not recorded') AS activity_code,
                COALESCE(av.name, 'No activity recorded on the line') AS activity_name,
                d.code AS department_code, d.name AS department_name,
                p.account_kind, p.currency,
                count(*)::int                                          AS line_count,
                sum(p.original_amount)::finance.money                  AS original_amount,
                sum(p.approved_adjustments)::finance.money             AS approved_adjustments,
                sum(p.revised_amount)::finance.money                   AS revised_amount,
                sum(p.actual_amount)::finance.money                    AS actual_amount,
                sum(p.open_commitments)::finance.money                 AS open_commitments,
                sum(p.available_excluding_commitments)::finance.money  AS available_excluding_commitments,
                sum(p.variance)::finance.money                         AS variance,
                CASE WHEN sum(p.revised_amount) = 0 THEN NULL
                     ELSE round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 2)
                END AS execution_percentage
           FROM finance.v_budget_line_performance p
           JOIN finance.department d ON d.id = p.department_id
           LEFT JOIN finance.programme pr ON pr.id = p.programme_id AND pr.deleted_at IS NULL
           LEFT JOIN finance.activity av  ON av.id = p.activity_id  AND av.deleted_at IS NULL
          WHERE p.financial_year_id = $1
            AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR p.account_kind = $4::text)
            AND ($5::text IS NULL OR p.currency = $5::text)
            AND ($6::uuid IS NULL OR p.programme_id = $6::uuid)
          GROUP BY COALESCE(pr.code, 'not recorded'),
                   COALESCE(pr.name, 'No programme recorded on the line'),
                   COALESCE(av.code, 'not recorded'),
                   COALESCE(av.name, 'No activity recorded on the line'),
                   d.code, d.name, p.account_kind, p.currency
          ORDER BY 1, 3, d.code, p.account_kind, p.currency`,
        [yearId, departmentId, scope, kind, currency, programmeId],
      )
      return { ...base, columns: [
        { header: 'Programme code', key: 'programme_code' },
        { header: 'Programme', key: 'programme_name' },
        { header: 'Activity code', key: 'activity_code' },
        { header: 'Activity', key: 'activity_name' },
        ...DEPARTMENT_COLUMNS,
        { header: 'Revenue/expenditure', key: 'account_kind' },
        { header: 'Currency', key: 'currency' },
        { header: 'Budget lines', key: 'line_count', type: 'number' },
        { header: 'Original budget', key: 'original_amount', type: 'number' },
        { header: 'Approved adjustments', key: 'approved_adjustments', type: 'number' },
        { header: 'Revised budget', key: 'revised_amount', type: 'number' },
        { header: 'Actual', key: 'actual_amount', type: 'number' },
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
        { header: 'Variance', key: 'variance', type: 'number' },
        { header: 'Execution %', key: 'execution_percentage', type: 'number' },
      ], rows, notes: [
        ['Grain', 'Programme, then activity, then department, then account kind, then currency. A programme spanning two departments has a row per department rather than one row that hides the split.'],
        ['Lines outside a programme', 'A budget line with no programme, or with a programme and no activity, is reported in a row labelled "not recorded" rather than being dropped from the programme presentation.'],
        ['Decision D3', 'Programme-based budgeting is an open decision. This report presents what the Council has actually recorded against finance.programme and finance.activity; it does not assert a programme structure.'],
      ] }
    }

    if (report === 'commitments_register') {
      // N25. Open commitments were reachable only as a single column on two reports. This is the
      // register: every commitment against a budget line in the year, with its outstanding
      // balance computed in SQL and its status stated so a liquidated or cancelled one is visibly
      // not an encumbrance.
      const { rows } = await pg.query(
        `SELECT c.reference, d.code AS department_code, d.name AS department_name,
                a.code AS account_code, a.name AS account_name,
                l.code AS budget_line_code, l.description AS budget_line_description,
                c.description, ${dateText('c', 'committed_on')}, c.currency, c.status,
                c.amount, c.liquidated_amount,
                (c.amount - c.liquidated_amount)::finance.money AS outstanding_amount,
                c.source_system, c.source_ref
           FROM finance.commitment c
           JOIN finance.budget_line l ON l.id = c.budget_line_id AND l.deleted_at IS NULL
           JOIN finance.department d  ON d.id = l.department_id
           JOIN finance.account a     ON a.id = l.account_id
          WHERE l.financial_year_id = $1 AND c.deleted_at IS NULL
            AND ($2::uuid IS NULL OR l.department_id = $2::uuid)
            AND ($3::uuid[] IS NULL OR l.department_id = ANY($3::uuid[]))
            AND ($4::text IS NULL OR c.currency = $4::text)
          ORDER BY d.code, l.code, c.committed_on, c.reference`,
        [yearId, departmentId, scope, currency],
      )
      return { ...base, columns: [
        { header: 'Reference', key: 'reference' },
        ...DEPARTMENT_COLUMNS, ...ACCOUNT_COLUMNS,
        { header: 'Budget line', key: 'budget_line_code' },
        { header: 'Budget line description', key: 'budget_line_description' },
        { header: 'Commitment description', key: 'description' },
        { header: 'Committed on', key: 'committed_on', type: 'date' },
        { header: 'Status', key: 'status' },
        { header: 'Currency', key: 'currency' },
        { header: 'Committed amount', key: 'amount', type: 'number' },
        { header: 'Liquidated', key: 'liquidated_amount', type: 'number' },
        { header: 'Outstanding', key: 'outstanding_amount', type: 'number' },
        { header: 'Source system', key: 'source_system' },
        { header: 'Source reference', key: 'source_ref' },
      ], rows, notes: [
        ['Outstanding', 'Committed amount less the amount liquidated, computed in SQL over NUMERIC. A liquidated or cancelled commitment is listed with its status so the register reconciles to the open-commitment figures on the other reports.'],
        ['What encumbers a budget', 'Only commitments in state open or partially_liquidated are counted as open commitments by finance.v_budget_line_performance (migration 188:796). This register lists every state.'],
      ] }
    }

    if (report === 'ward_finance') {
      // N28 / N29. finance.v_ward_performance (migration 202:248) already computes the ward
      // figures in NUMERIC and no report used it.
      //
      // "UNLOCATED" IS A ROW, NOT AN OMISSION. Money the system cannot place on the map — a
      // budget line with no ward code, an unallocated remainder of a split — is the view's
      // ward_code IS NULL row. It is labelled and reported, never dropped and never folded into a
      // ward, which is assessment §6.1 rule 4. It is kept even when a single ward is asked for,
      // so a one-ward report cannot be read as if it accounted for the whole vote.
      //
      // DEPARTMENT SCOPE. v_ward_performance has no department dimension, so a departmentally
      // scoped caller is served from finance.v_ward_dimension_performance aggregated to the same
      // grain and the same column names — the substitution finance-spatial.js:502-570 already
      // makes for the same reason.
      const confined = Boolean(scope || departmentId)
      const { rows } = confined
        ? (await pg.query(
          `SELECT w.ward_code,
                  COALESCE(w.ward_code, 'unlocated') AS ward_label,
                  max(w.ward_status) AS ward_status,
                  min(w.unlocated_reason) AS unlocated_reason,
                  w.currency,
                  (sum(w.budget_amount) FILTER (WHERE w.account_kind = 'revenue'))::finance.money
                    AS revenue_budget,
                  (sum(w.actual_amount) FILTER (WHERE w.account_kind = 'revenue'))::finance.money
                    AS revenue_actual,
                  CASE WHEN (sum(w.budget_amount) FILTER (WHERE w.account_kind = 'revenue')) IS NULL
                       THEN NULL
                       ELSE (COALESCE(sum(w.actual_amount) FILTER (WHERE w.account_kind = 'revenue'), 0)
                             - sum(w.budget_amount) FILTER (WHERE w.account_kind = 'revenue'))::finance.money
                  END AS revenue_variance,
                  CASE WHEN COALESCE(sum(w.budget_amount) FILTER (WHERE w.account_kind = 'revenue'), 0) = 0
                       THEN NULL
                       ELSE round(COALESCE(sum(w.actual_amount) FILTER (WHERE w.account_kind = 'revenue'), 0)
                                  * 100 / sum(w.budget_amount) FILTER (WHERE w.account_kind = 'revenue'), 2)
                  END AS revenue_collection_percentage,
                  (sum(w.budget_amount) FILTER (WHERE w.account_kind = 'expenditure'))::finance.money
                    AS expenditure_budget,
                  (sum(w.actual_amount) FILTER (WHERE w.account_kind = 'expenditure'))::finance.money
                    AS expenditure_actual,
                  (sum(w.open_commitments))::finance.money AS open_commitments,
                  -- Complete-or-NULL, as migration 202's header requires: a part figure must not
                  -- wear a total's label, so the variance is reported only where every
                  -- contributing row carries one.
                  CASE WHEN count(*) FILTER (WHERE w.account_kind = 'expenditure') > 0
                        AND count(*) FILTER (WHERE w.account_kind = 'expenditure'
                                               AND w.variance IS NULL) = 0
                       THEN (sum(w.variance) FILTER (WHERE w.account_kind = 'expenditure'))::finance.money
                  END AS expenditure_variance,
                  CASE WHEN COALESCE(sum(w.budget_amount) FILTER (WHERE w.account_kind = 'expenditure'), 0) = 0
                       THEN NULL
                       ELSE round(COALESCE(sum(w.actual_amount) FILTER (WHERE w.account_kind = 'expenditure'), 0)
                                  * 100 / sum(w.budget_amount) FILTER (WHERE w.account_kind = 'expenditure'), 2)
                  END AS expenditure_execution_percentage,
                  (sum(w.split_coverage_amount))::finance.money AS split_coverage_amount,
                  (sum(w.unallocated_remainder_amount))::finance.money AS unallocated_remainder_amount,
                  sum(w.attribution_exception_rows)::int AS attribution_exception_rows,
                  sum(w.attributed_lines)::int AS attributed_lines,
                  sum(w.allocation_rows)::int AS allocation_rows,
                  sum(w.transaction_rows)::int AS transaction_rows
             FROM finance.v_ward_dimension_performance w
            WHERE w.financial_year_id = $1
              AND ($2::uuid IS NULL OR w.department_id = $2::uuid)
              AND ($3::uuid[] IS NULL OR w.department_id = ANY($3::uuid[]))
              AND ($4::text IS NULL OR w.currency = $4::text)
              AND ($5::text IS NULL OR w.ward_code = $5::text OR w.ward_code IS NULL)
            GROUP BY w.ward_code, w.currency
            ORDER BY (w.ward_code IS NULL), w.ward_code, w.currency`,
          [yearId, departmentId, scope, currency, wardCode]))
        : (await pg.query(
          `SELECT w.ward_code,
                  COALESCE(w.ward_code, 'unlocated') AS ward_label,
                  w.ward_status, w.unlocated_reason, w.ward_register_basis, w.currency,
                  w.original_revenue, w.adjustments_revenue,
                  w.revenue_budget, w.revenue_actual, w.revenue_actual_via_line,
                  w.revenue_variance, w.revenue_collection_percentage,
                  w.original_expenditure, w.adjustments_expenditure,
                  w.expenditure_budget, w.expenditure_actual, w.expenditure_actual_via_line,
                  w.open_commitments,
                  w.available_excluding_commitments, w.available_including_commitments,
                  w.expenditure_variance, w.expenditure_execution_percentage,
                  w.split_coverage_amount, w.unallocated_remainder_amount,
                  w.attribution_exception_rows, w.attributed_lines, w.allocation_rows,
                  w.transaction_rows
             FROM finance.v_ward_performance w
            WHERE w.financial_year_id = $1
              AND ($2::text IS NULL OR w.currency = $2::text)
              AND ($3::text IS NULL OR w.ward_code = $3::text OR w.ward_code IS NULL)
            ORDER BY (w.ward_code IS NULL), w.ward_code, w.currency`,
          [yearId, currency, wardCode]))

      const columns = [
        { header: 'Ward', key: 'ward_label' },
        { header: 'Ward code', key: 'ward_code' },
        { header: 'Ward register', key: 'ward_status' },
        ...(confined ? [] : [{ header: 'Ward register basis', key: 'ward_register_basis' }]),
        { header: 'Unlocated reason', key: 'unlocated_reason' },
        { header: 'Currency', key: 'currency' },
        ...(confined ? [] : [
          { header: 'Original revenue estimate', key: 'original_revenue', type: 'number' },
          { header: 'Revenue adjustments', key: 'adjustments_revenue', type: 'number' },
        ]),
        { header: 'Revenue budget', key: 'revenue_budget', type: 'number' },
        { header: 'Revenue actual', key: 'revenue_actual', type: 'number' },
        ...(confined ? [] : [
          { header: 'Revenue actual (via budget line ward)', key: 'revenue_actual_via_line', type: 'number' },
        ]),
        { header: 'Revenue variance', key: 'revenue_variance', type: 'number' },
        { header: 'Collection %', key: 'revenue_collection_percentage', type: 'number' },
        ...(confined ? [] : [
          { header: 'Original expenditure budget', key: 'original_expenditure', type: 'number' },
          { header: 'Expenditure adjustments', key: 'adjustments_expenditure', type: 'number' },
        ]),
        { header: 'Expenditure budget', key: 'expenditure_budget', type: 'number' },
        { header: 'Expenditure actual', key: 'expenditure_actual', type: 'number' },
        ...(confined ? [] : [
          { header: 'Expenditure actual (via budget line ward)', key: 'expenditure_actual_via_line', type: 'number' },
          { header: 'Available (excl. commitments)', key: 'available_excluding_commitments', type: 'number' },
          { header: 'Available (incl. commitments)', key: 'available_including_commitments', type: 'number' },
        ]),
        { header: 'Open commitments', key: 'open_commitments', type: 'number' },
        { header: 'Expenditure variance', key: 'expenditure_variance', type: 'number' },
        { header: 'Execution %', key: 'expenditure_execution_percentage', type: 'number' },
        { header: 'Attributed by approved split', key: 'split_coverage_amount', type: 'number' },
        { header: 'Unallocated remainder', key: 'unallocated_remainder_amount', type: 'number' },
        { header: 'Attribution exceptions', key: 'attribution_exception_rows', type: 'number' },
        { header: 'Lines attributed by ward code', key: 'attributed_lines', type: 'number' },
        { header: 'Split allocation rows', key: 'allocation_rows', type: 'number' },
        { header: 'Transactions', key: 'transaction_rows', type: 'number' },
      ]

      const unlocatedRows = rows.filter((r) => r.ward_code === null).length
      return { ...base, columns, rows, notes: [
        ['Unlocated', unlocatedRows > 0
          ? `Reported as ${unlocatedRows} labelled "unlocated" row(s) at the foot of the table — one per currency. This is money the system cannot place on a ward: a budget line with no ward code, or the remainder of a split that was not allocated. It is never folded into a ward.`
          : 'No unlocated row is present for this year and currency, which means every figure in this report carries a ward. An unlocated row would be shown if there were one.'],
        ['Actuals basis', 'Revenue and expenditure actuals are attributed by the WARD CODE ON THE TRANSACTION. Where the unconfined report is run it also gives the alternative basis — attribution by the budget line\'s ward — in its own column, because the two are different questions and a reader must know which they are reading.'],
        ['Complete-or-NULL', 'A measure is blank rather than partial where not every contributing row carries it (migration 202). A blank is "not computable from complete data", which is not zero.'],
        ['Ward register', 'Decision D11: the Council\'s own ward register is provisional. "unlinked" in the Ward register column means the ward code appears in the finance data but not in the authority\'s ward register, and the figure is reported rather than discarded.'],
        ...(confined ? [['Department scope', 'This report is confined to a department or to the votes your role may read, so it is computed from the ward dimension view. The council-wide form of the report carries further columns (both available-balance definitions and the alternative actuals basis).']] : []),
      ] }
    }

    return { error: 'unknown_report' }
  }

  /** The metadata every report and export carries (specification §3.9). */
  async function reportMeta({ request, report, built, filters, includeRestricted }) {
    const { rows: council } = await pg.query(
      'SELECT authority_name, code, province FROM public.local_authorities WHERE id = $1',
      [request.user.authority_id],
    ).catch(() => ({ rows: [] }))
    const includeCommitments = await financeSetting(fastify, request.user.authority_id,
      'available_balance.include_commitments', false)
    const currencies = [...new Set((built.rows || []).map((r) => r.currency).filter(Boolean))].sort()
    return [
      ['Council', council[0]?.authority_name || 'Vungu Rural District Council'],
      ['Council code', council[0]?.code || 'VUNGU'],
      ['Report', report.replace(/_/g, ' ')],
      ['Financial year', built.financial_year ? `${built.financial_year.label} (${String(built.financial_year.start_date).slice(0, 10)} to ${String(built.financial_year.end_date).slice(0, 10)})` : 'all years'],
      ['Financial year status', built.financial_year?.status || 'n/a'],
      ...(built.comparison_year ? [
        ['Comparison year', `${built.comparison_year.label} (${String(built.comparison_year.start_date).slice(0, 10)} to ${String(built.comparison_year.end_date).slice(0, 10)})`],
        ['Comparison year status', built.comparison_year.status || 'n/a'],
      ] : []),
      ['Currencies present', currencies.length ? currencies.join(', ') : 'none'],
      ['Currency treatment', 'USD and ZWG are reported separately. No exchange rate is applied and no total combines them.'],
      ['Available balance shown', includeCommitments === true ? 'includes open commitments' : 'excludes open commitments'],
      // A period-based report states its periodicity, the buckets it used and the guarantee those
      // buckets carry. The labels come from the same periodList() array that generated the SQL
      // boundaries, so the cover cannot describe a column set the figures were not selected by.
      ...(built.periods ? [
        ['Periodicity', `${String(built.periodicity).replace(/_/g, '-')}${built.accumulated ? ', accumulated (year to date)' : ', discrete periods'}`],
        ['Periods reported', built.periods.map((p) => `${p.label} (${p.from_date} to ${p.to_date})`).join('; ')],
        ['Period basis', `Buckets are generated from this council's own financial-year start date (${built.financial_year.start_date}), not from the calendar year, and they cover the year exactly with no gap and no overlap. A date in the year falls in exactly one bucket.`],
      ] : []),
      // The report's own caveats, from its builder. A report states what its figures are and are
      // not, beside the figures, rather than in documentation nobody exports.
      ...(built.notes || []),
      ['Filters applied', Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') || 'none'],
      ['Rows', String((built.rows || []).length)],
      ['Restricted data included', includeRestricted ? 'YES — supplier/beneficiary identities are present' : 'no'],
      ['Generated at', new Date().toISOString()],
      ['Generated by', `${request.user.email || request.user.id} (${request.user.role})`],
      ['Status', 'Figures are as imported from the council\'s accounting records. This report is not a statutory return and asserts no legal compliance.'],
    ]
  }

  const querySchema = {
    type: 'object', required: ['report'], additionalProperties: false,
    properties: {
      report: { type: 'string', enum: REPORTS },
      financial_year_id: uuid,
      compare_financial_year_id: uuid,
      department_id: uuid,
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
      format: { type: 'string', enum: ['json', ...EXPORT_FORMATS], default: 'json' },
      include_restricted: { type: 'boolean', default: false },
      // W2. A periodicity is accepted only for a report that declares one in the catalogue; it is
      // rejected rather than ignored on any other report, because a parameter that silently does
      // nothing is how a council comes to believe it ran a monthly report when it did not.
      periodicity: { type: 'string', enum: PERIODICITIES },
      accumulated: { type: 'boolean', default: false },
      programme_id: uuid,
      account_id: uuid,
      ward_code: { type: 'string', maxLength: 32 },
      kind: { type: 'string', enum: ['revenue', 'expenditure'] },
      expenditure_class: { type: 'string', enum: ['recurrent', 'capital'] },
      currency: { type: 'string', enum: ['USD', 'ZWG'] },
    },
  }

  /**
   * Everything both routes do before building: the required-parameter checks, the restricted-column
   * permission, and the department scope. One function, so the screen and the file cannot disagree
   * about whether a request was acceptable — the same reason `buildReport()` is shared.
   *
   * Returns { refusal } to be sent, or { params } to pass to buildReport().
   */
  async function resolveRequest(request) {
    const q = request.query
    const needsYear = !['project_performance'].includes(q.report)
    if (needsYear && !q.financial_year_id) {
      return { refusal: [400, 'financial_year_required', 'This report needs financial_year_id.'] }
    }
    if (q.report === 'year_on_year' && !q.compare_financial_year_id) {
      return { refusal: [400, 'comparison_year_required', 'This report needs compare_financial_year_id.'] }
    }
    if (q.periodicity && !REPORT_PERIODS[q.report]) {
      return { refusal: [400, 'report_has_no_periods',
        `${REPORT_NAMES[q.report]} has no period dimension, so a periodicity would change nothing. Remove it, or choose a report the catalogue lists a "periods" set for.`] }
    }
    if (q.periodicity && !REPORT_PERIODS[q.report].includes(q.periodicity)) {
      return { refusal: [400, 'periodicity_not_offered',
        `${REPORT_NAMES[q.report]} is produced at ${REPORT_PERIODS[q.report].join(', ')} only.`] }
    }
    const includeRestricted = q.include_restricted === true
      && await hasPermission(fastify, request, 'finance.report.export_restricted')
    if (q.include_restricted === true && !includeRestricted) {
      return { refusal: [403, 'forbidden',
        'Including supplier and beneficiary identities requires finance.report.export_restricted.',
        { required_permission: 'finance.report.export_restricted' }] }
    }
    return {
      includeRestricted,
      params: {
        report: q.report,
        yearId: q.financial_year_id || null,
        compareYearId: q.compare_financial_year_id || null,
        departmentId: q.department_id || null,
        from: q.from || null,
        to: q.to || null,
        periodicity: q.periodicity || null,
        accumulated: q.accumulated === true,
        programmeId: q.programme_id || null,
        accountId: q.account_id || null,
        wardCode: q.ward_code || null,
        kind: q.kind || null,
        expenditureClass: q.expenditure_class || null,
        currency: q.currency || null,
        scope: await departmentScope(fastify, request),
        includeRestricted,
      },
    }
  }

  fastify.get('/finance/reports/run', { ...canView, schema: { querystring: querySchema } },
    async (request, reply) => {
      const q = request.query
      if (q.format !== 'json') {
        return fail(reply, 400, 'use_export',
          `Use /api/finance/reports/export for ${EXPORT_FORMATS.join(', ')}, which needs the export permission.`)
      }
      const resolved = await resolveRequest(request)
      if (resolved.refusal) return fail(reply, ...resolved.refusal)

      const built = await buildReport(resolved.params)
      if (built.error) {
        return fail(reply, 400, built.error, built.message || 'The report could not be built.')
      }
      const meta = await reportMeta({
        request, report: q.report, built, filters: q, includeRestricted: resolved.includeRestricted,
      })
      // `notes` has been folded into `meta` by reportMeta, and the file and the screen must carry
      // the same provenance block. It is not sent twice.
      const { notes, ...result } = built
      void notes
      return ok(reply, { ...result, meta: Object.fromEntries(meta) })
    })

  /**
   * Download a report as CSV, XLSX or PDF. Needs finance.report.export; including restricted
   * columns needs finance.report.export_restricted on top, and the filename itself carries the
   * word RESTRICTED so a file that leaves the building is recognisable for what it is.
   *
   * All three formats are rendered from the same `built` report and the same `meta`, so the
   * committee's PDF and the finance officer's spreadsheet cannot show different figures.
   */
  fastify.get('/finance/reports/export', { ...canExport, schema: { querystring: querySchema } },
    async (request, reply) => {
      const q = request.query
      const format = q.format === 'json' ? 'csv' : q.format
      const resolved = await resolveRequest(request)
      if (resolved.refusal) return fail(reply, ...resolved.refusal)
      const includeRestricted = resolved.includeRestricted

      const built = await buildReport(resolved.params)
      if (built.error) {
        return fail(reply, 400, built.error, built.message || 'The report could not be built.')
      }
      const meta = await reportMeta({ request, report: q.report, built, filters: q, includeRestricted })
      const filename = exportFilename(q.report, built.comparison_year
        ? `${built.financial_year.label}-vs-${built.comparison_year.label}`
        : built.financial_year?.label || 'all', format, includeRestricted)

      if (format === 'csv') {
        const buf = buildCsv({ columns: built.columns, rows: built.rows, meta })
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .header('x-finance-restricted', includeRestricted ? 'true' : 'false')
          .send(buf)
      }

      if (format === 'pdf') {
        const buf = await buildPdf({
          title: REPORT_NAMES[q.report] || q.report.replace(/_/g, ' '),
          columns: built.columns,
          rows: built.rows,
          meta,
          restricted: includeRestricted,
        })
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .header('x-finance-restricted', includeRestricted ? 'true' : 'false')
          .send(buf)
      }

      const buf = await buildXlsx({
        meta,
        sheets: [{
          name: q.report.replace(/_/g, ' ').slice(0, 31),
          columns: built.columns,
          rows: built.rows,
        }],
      })
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('x-finance-restricted', includeRestricted ? 'true' : 'false')
        .send(buf)
    })

  // ── Audit history ────────────────────────────────────────────────────────────────────────────
  /**
   * The finance audit trail: who did what, when, to which record.
   *
   * Read from `public.admin_audit_event`, which the onResponse hook in src/middleware/auditLog.js
   * writes for every mutating request — including the ones that were REFUSED, which is what makes
   * an unauthorised publication attempt visible here rather than invisible.
   *
   * Read with systemOf() because the audit trail is system data: it must not be filtered by the
   * row-level security of the person reading it, or an officer would see an edited version of
   * their own history.
   */
  fastify.get('/finance/audit', {
    preHandler: requirePermission(fastify, 'finance.audit.view'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          actor_id: uuid,
          event: { type: 'string', maxLength: 48 },
          entity_type: { type: 'string', maxLength: 48 },
          entity_id: { type: 'string', maxLength: 64 },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          status_min: { type: 'integer', minimum: 100, maximum: 599 },
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { systemOf } = require('../lib/dbContext')
    const { rows } = await systemOf(pg).query(
      `SELECT id, occurred_at, actor_id, actor_email, actor_role, event, severity,
              method, path, status, entity_type, entity_id, ip, details
         FROM public.admin_audit_event
        WHERE (event LIKE 'FIN\\_%' OR path LIKE '/api/finance/%' OR path LIKE '/api/public/finance/%')
          AND ($1::uuid IS NULL OR actor_id = $1::uuid)
          AND ($2::text IS NULL OR event = $2::text)
          AND ($3::text IS NULL OR entity_type = $3::text)
          AND ($4::text IS NULL OR entity_id = $4::text)
          AND ($5::text IS NULL OR severity = $5::text)
          AND ($6::int IS NULL OR status >= $6::int)
          AND ($7::date IS NULL OR occurred_at >= $7::date)
          AND ($8::date IS NULL OR occurred_at < ($8::date + 1))
        ORDER BY occurred_at DESC
        LIMIT $9 OFFSET $10`,
      [q.actor_id || null, q.event || null, q.entity_type || null, q.entity_id || null,
        q.severity || null, q.status_min ?? null, q.from || null, q.to || null, q.limit, q.offset],
    )
    return ok(reply, {
      events: rows,
      limit: q.limit,
      offset: q.offset,
      note: 'Refused attempts are recorded too: a 403 on a publication endpoint appears here with its status.',
    })
  })

  fastify.get('/finance/audit/export', {
    preHandler: requirePermission(fastify, 'finance.audit.export'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          format: { type: 'string', enum: EXPORT_FORMATS, default: 'csv' },
        },
      },
    },
  }, async (request, reply) => {
    const { systemOf } = require('../lib/dbContext')
    const q = request.query
    const { rows } = await systemOf(pg).query(
      `SELECT occurred_at, actor_email, actor_role, event, severity, method, path, status,
              entity_type, entity_id, ip::text AS ip
         FROM public.admin_audit_event
        WHERE (event LIKE 'FIN\\_%' OR path LIKE '/api/finance/%')
          AND ($1::date IS NULL OR occurred_at >= $1::date)
          AND ($2::date IS NULL OR occurred_at < ($2::date + 1))
        ORDER BY occurred_at DESC LIMIT 100000`,
      [q.from || null, q.to || null],
    )
    const columns = [
      { header: 'When', key: 'occurred_at' },
      { header: 'Actor', key: 'actor_email' },
      { header: 'Role', key: 'actor_role' },
      { header: 'Event', key: 'event' },
      { header: 'Severity', key: 'severity' },
      { header: 'Method', key: 'method' },
      { header: 'Path', key: 'path' },
      { header: 'HTTP status', key: 'status', type: 'number' },
      { header: 'Entity type', key: 'entity_type' },
      { header: 'Entity id', key: 'entity_id' },
      { header: 'IP', key: 'ip' },
    ]
    const meta = [
      ['Council', 'Vungu Rural District Council'],
      ['Export', 'Finance audit history'],
      ['Period', `${q.from || 'beginning'} to ${q.to || 'now'}`],
      ['Rows', String(rows.length)],
      ['Generated at', new Date().toISOString()],
      ['Generated by', `${request.user.email || request.user.id} (${request.user.role})`],
      ['Note', 'Audit records cannot be edited through the application. A 4xx status is a refused attempt.'],
    ]
    const filename = exportFilename('audit-history', q.from || 'all', q.format, false)
    if (q.format === 'xlsx') {
      const buf = await buildXlsx({ meta, sheets: [{ name: 'Audit history', columns, rows }] })
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buf)
    }
    if (q.format === 'pdf') {
      const buf = await buildPdf({ title: 'Finance audit history', columns, rows, meta })
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .send(buf)
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buildCsv({ columns, rows, meta }))
  })
}

module.exports = { financeReportRoutes, REPORTS }
