/**
 * The first screen of seven finance workspaces, one read each:
 *
 *   GET /finance/dashboards/manager     Finance Management (finance administrator)
 *   GET /finance/dashboards/officer     Finance Operations (finance officer)
 *   GET /finance/dashboards/audit       Internal Audit (auditor)
 *   GET /finance/dashboards/revenue     Revenue and Rates (revenue officer)
 *   GET /finance/dashboards/executive   Executive Finance (chief executive, accounting officer)
 *   GET /finance/dashboards/publisher   Publication (publisher)
 *   GET /finance/dashboards/department  Department Finance (head of department)
 *
 * Design: docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md (frontend repository).
 *
 * THE SAME RULES AS THE REST OF FINANCE
 *  1. These routes only READ. Every act a dashboard leads to is an existing route with its own
 *     permission and its own database refusal.
 *  2. No money arithmetic in JavaScript: Postgres computes every figure and sends it as text.
 *  3. Nothing is totalled across currencies (decision D4). Every money figure is one row per
 *     currency and the screen chooses which to show first.
 *  4. Spending figures come from finance.v_budget_line_performance, the view every budget report
 *     uses, so a dashboard and a report cannot disagree.
 *
 * Each route is guarded by a permission that its role holds (see migration 188's grants), never
 * by the workspace: the workspace list on /finance/me is a convenience, the permission is the
 * control.
 */

const { requirePermission, requireAnyPermission, departmentScope } = require('../middleware/financePermissions')
const { FINANCE_ROLES } = require('../config/permissions')
const { systemOf } = require('../lib/dbContext')

const ok = (reply, data) => reply.code(200).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

const pct = (part, whole) => `CASE WHEN COALESCE(sum(${whole}), 0) > 0 THEN round(sum(${part}) * 100 / sum(${whole}), 1)::text END`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Admin-trail entries in words. The trail stores the route; the dashboard says what it did. */
const NOUN = {
  finance_financial_year: 'Financial year', finance_account: 'Account', finance_department: 'Department',
  finance_programme: 'Programme', finance_activity: 'Activity', finance_setting: 'Finance setting',
  finance_column_mapping: 'Import mapping', finance_user_access: 'Finance access', finance_permission_grant: 'Permission grant',
  finance_ledger: 'Ledger account', finance_ledger_period: 'Accounting period', finance_ledger_year: 'Year-end close',
  user: 'User', setting: 'System setting', invite: 'Invitation', finance_audit_engagement: 'Internal audit record',
}
function describe(row) {
  const noun = NOUN[row.entity_type] || 'Finance record'
  const path = String(row.path || '')
  let verb = { POST: 'created', PATCH: 'updated', PUT: 'set', DELETE: 'removed' }[row.method] || 'changed'
  if (/\/reopen$/.test(path)) verb = 'reopened'
  else if (/\/open$/.test(path)) verb = 'opened'
  else if (/\/close$/.test(path)) verb = 'closed'
  else if (/\/bulk$/.test(path)) verb = 'imported in bulk'
  else if (/\/access$/.test(path)) verb = 'changed'
  return `${noun} ${verb}`
}

async function financeDashboardRoutes(fastify) {
  const pg = fastify.pg
  const uuid = { type: 'string', format: 'uuid' }
  const yearQuery = { querystring: { type: 'object', additionalProperties: false, properties: { financial_year_id: uuid } } }

  /** The year asked for, or the open year containing today. */
  async function yearOf(id) {
    const { rows } = await pg.query(
      `SELECT y.id, y.label, y.start_date::text AS start_date, y.end_date::text AS end_date, y.status, y.reporting_currency,
              (SELECT p.id FROM finance.financial_year p
                WHERE p.deleted_at IS NULL AND p.end_date < y.start_date
                ORDER BY p.end_date DESC LIMIT 1) AS prior_year_id
         FROM finance.financial_year y
        WHERE y.deleted_at IS NULL
          AND (($1::uuid IS NOT NULL AND y.id = $1::uuid)
               OR ($1::uuid IS NULL AND y.status = 'open' AND CURRENT_DATE BETWEEN y.start_date AND y.end_date))
        ORDER BY y.start_date DESC LIMIT 1`, [id || null])
    return rows[0] || null
  }
  const noYear = (reply) => fail(reply, 404, 'no_year', 'No open financial year contains today. Choose a year.')

  /** A route wrapper that logs and answers 500 in one place. */
  const guarded = (name, message, handler) => async (request, reply) => {
    try {
      return await handler(request, reply)
    } catch (err) {
      fastify.log.error({ err }, `${name} dashboard`)
      return fail(reply, 500, `${name}_dashboard_error`, message)
    }
  }

  /** Audit compliance: of the findings whose due date has passed, the share closed by that date. */
  const COMPLIANCE = `
    SELECT count(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS due,
           count(*) FILTER (WHERE due_date < CURRENT_DATE AND status = 'closed' AND closed_at::date <= due_date)::int AS on_time,
           CASE WHEN count(*) FILTER (WHERE due_date < CURRENT_DATE) > 0
                THEN round(count(*) FILTER (WHERE due_date < CURRENT_DATE AND status = 'closed' AND closed_at::date <= due_date) * 100.0
                           / count(*) FILTER (WHERE due_date < CURRENT_DATE), 1)::text END AS pct
      FROM finance.audit_finding`

  // ── Finance Management ─────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/manager', {
    preHandler: requirePermission(fastify, 'finance.config.manage'),
  }, guarded('manager', 'The finance administration dashboard could not be read.', async (request, reply) => {
    const started = process.hrtime.bigint()
    await pg.query('SELECT 1')
    const dbMs = Number((process.hrtime.bigint() - started) / 1000000n)

    const [users, roles, approvals, alerts, activity, recent, imports, lastEvent] = await Promise.all([
      // Accounts and role grants are system facts (migration 188 keeps them from the app role).
      systemOf(pg).query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE COALESCE(last_login_at, last_login) >= now() - interval '30 days')::int AS active
           FROM public.users
          WHERE deleted_at IS NULL AND COALESCE(active, true) AND role = ANY($1::text[])`, [FINANCE_ROLES]),
      systemOf(pg).query(`SELECT count(DISTINCT role_name)::int AS n FROM finance.role_permission`),
      pg.query(
        `SELECT
           (SELECT count(*)::int FROM finance.budget_line WHERE deleted_at IS NULL AND status = 'submitted') AS budget_lines,
           (SELECT count(*)::int FROM finance.budget_revision WHERE deleted_at IS NULL AND state = 'submitted') AS revisions,
           (SELECT count(*)::int FROM finance.publication WHERE state = 'pending') AS publications,
           (SELECT count(*)::int FROM finance.project WHERE deleted_at IS NULL AND status = 'awaiting_approval') AS projects,
           (SELECT count(*)::int FROM finance.rates_tariff WHERE deleted_at IS NULL AND status = 'draft') AS tariffs,
           (SELECT count(*)::int FROM finance.spatial_allocation WHERE deleted_at IS NULL AND status = 'draft') AS allocations,
           (SELECT count(*)::int FROM finance.voucher WHERE status = 'draft') AS vouchers`),
      systemOf(pg).query(
        `SELECT
           (SELECT count(*)::int FROM public.admin_audit_event
             WHERE occurred_at >= now() - interval '7 days' AND status >= 500 AND path LIKE '/api/finance%') AS server_errors,
           (SELECT count(*)::int FROM public.admin_audit_event
             WHERE occurred_at >= now() - interval '7 days' AND status = 403 AND path LIKE '/api/finance%') AS refusals,
           (SELECT count(*)::int FROM finance.import_exception WHERE resolved_at IS NULL) AS import_exceptions,
           (SELECT count(*)::int FROM finance.financial_year
             WHERE deleted_at IS NULL AND status = 'open' AND CURRENT_DATE BETWEEN start_date AND end_date) AS open_years,
           (SELECT count(*)::int FROM finance.ledger_period p JOIN finance.financial_year y ON y.id = p.financial_year_id
             WHERE p.status = 'open' AND p.to_date < CURRENT_DATE - 30) AS stale_periods`),
      // Finance actions, week by week for the last five weeks, oldest first.
      systemOf(pg).query(
        `SELECT to_char(w.week, 'YYYY-MM-DD') AS week,
                count(e.id)::int AS actions, count(DISTINCT e.actor_id)::int AS people
           FROM generate_series(date_trunc('week', CURRENT_DATE) - interval '4 weeks', date_trunc('week', CURRENT_DATE), interval '1 week') AS w(week)
           LEFT JOIN public.admin_audit_event e
             ON e.occurred_at >= w.week AND e.occurred_at < w.week + interval '1 week'
            AND e.path LIKE '/api/finance%' AND e.status < 400
          GROUP BY w.week ORDER BY w.week`),
      systemOf(pg).query(
        `SELECT occurred_at, actor_email, method, path, entity_type, event
           FROM public.admin_audit_event
          WHERE event IN ('FIN_PERMISSION', 'FIN_CONFIG', 'USER_MGMT', 'SETTINGS', 'FIN_LEDGER') AND status < 400
            AND method IN ('POST', 'PATCH', 'PUT', 'DELETE')
          ORDER BY occurred_at DESC LIMIT 6`),
      pg.query(
        `SELECT max(committed_at) AS last_commit, count(*) FILTER (WHERE committed_at IS NULL AND deleted_at IS NULL)::int AS open_batches
           FROM finance.import_batch`),
      systemOf(pg).query(`SELECT max(occurred_at) AS at FROM public.admin_audit_event`),
    ])

    const a = approvals.rows[0]
    const pending = [
      { key: 'budget', label: 'Budget lines submitted', n: a.budget_lines },
      { key: 'revisions', label: 'Budget revisions submitted', n: a.revisions },
      { key: 'publication', label: 'Publications awaiting approval', n: a.publications },
      { key: 'projects', label: 'Projects awaiting approval', n: a.projects },
      { key: 'rates', label: 'Rates tariffs in draft', n: a.tariffs },
      { key: 'map', label: 'Ward allocations in draft', n: a.allocations },
      { key: 'vouchers', label: 'Vouchers waiting to be posted', n: a.vouchers },
    ]
    const al = alerts.rows[0]
    const alertList = [
      al.server_errors && { tone: 'neg', key: 'audit', text: `${plural(al.server_errors, 'finance request')} failed on the server in the last 7 days` },
      !al.open_years && { tone: 'neg', key: 'years', text: 'No open financial year contains today' },
      al.import_exceptions && { tone: 'warn', key: 'imports', text: `${plural(al.import_exceptions, 'import exception')} not resolved` },
      al.stale_periods && { tone: 'warn', key: 'years', text: `${plural(al.stale_periods, 'accounting period')} ended over 30 days ago and still open` },
      al.refusals && { tone: 'info', key: 'audit', text: `${plural(al.refusals, 'finance request')} refused for lack of permission in the last 7 days` },
    ].filter(Boolean)

    return ok(reply, {
      users: users.rows[0],
      roles: roles.rows[0].n,
      pending,
      pending_total: pending.reduce((s, p) => s + p.n, 0),
      alerts: alertList,
      activity: activity.rows,
      health: {
        database: { ok: true, ms: dbMs },
        imports: { last_commit: imports.rows[0].last_commit, open_batches: imports.rows[0].open_batches },
        audit_trail: { last_event: lastEvent.rows[0].at },
        uptime_seconds: Math.round(process.uptime()),
        started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
      recent: recent.rows.map((r) => ({ at: r.occurred_at, who: r.actor_email, text: describe(r), event: r.event })),
    })
  }))

  // ── Finance Operations ─────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/officer', {
    preHandler: requirePermission(fastify, 'finance.ledger.view'), schema: yearQuery,
  }, guarded('officer', 'The finance operations dashboard could not be read.', async (request, reply) => {
    const me = request.user.id
    const year = await yearOf(request.query.financial_year_id)
    if (!year) return noYear(reply)
    const CASH = `SELECT 1 FROM finance.ledger_account la WHERE la.id = l.ledger_account_id AND la.account_type IN ('bank', 'cash')`

    const [payments, debtors, journals, banks, flow, work, recent] = await Promise.all([
      // A payment is a journal that takes money out of a bank or till; waiting means still a draft.
      pg.query(
        `SELECT v.currency, count(DISTINCT v.id)::int AS n, COALESCE(sum(l.credit), 0)::numeric(18,2)::text AS amount
           FROM finance.voucher v JOIN finance.voucher_line l ON l.voucher_id = v.id AND l.credit > 0 AND EXISTS (${CASH})
          WHERE v.status = 'draft' GROUP BY v.currency ORDER BY v.currency`),
      pg.query(
        `SELECT currency, count(DISTINCT party_id)::int AS n, sum(outstanding_amount)::numeric(18,2)::text AS amount
           FROM finance.v_debtor_ageing WHERE outstanding_amount > 0 GROUP BY currency ORDER BY currency`),
      pg.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE prepared_by = $1)::int AS mine
           FROM finance.voucher WHERE status = 'draft' AND voucher_type = 'journal'`, [me]),
      pg.query(
        `SELECT e.currency, COALESCE(sum(e.debit - e.credit), 0)::numeric(18,2)::text AS balance
           FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type = 'bank'
          WHERE la.deleted_at IS NULL GROUP BY e.currency ORDER BY e.currency`),
      // Money in and out of the banks and tills, day by day this month.
      pg.query(
        `SELECT d::date::text AS day, c.currency,
                COALESCE(sum(e.debit), 0)::numeric(18,2)::text AS inflow,
                COALESCE(sum(e.credit), 0)::numeric(18,2)::text AS outflow
           FROM generate_series(date_trunc('month', CURRENT_DATE), CURRENT_DATE, interval '1 day') d
           CROSS JOIN (SELECT DISTINCT currency FROM finance.ledger_entry) c
           LEFT JOIN (finance.ledger_entry e
                      JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type IN ('bank', 'cash')
                      JOIN finance.voucher v ON v.id = e.voucher_id AND v.voucher_type NOT IN ('opening', 'closing'))
             ON e.posting_date = d::date AND e.currency = c.currency
          GROUP BY d, c.currency ORDER BY c.currency, d`),
      pg.query(
        `SELECT
           (SELECT count(*)::int FROM finance.voucher WHERE status = 'draft' AND prepared_by = $1) AS my_drafts,
           (SELECT count(*)::int FROM finance.import_exception WHERE resolved_at IS NULL) AS import_exceptions,
           (SELECT count(*)::int FROM finance.import_batch WHERE deleted_at IS NULL AND committed_at IS NULL AND status NOT IN ('cancelled', 'superseded', 'failed')) AS imports_open,
           (SELECT count(*)::int FROM finance.rates_billing_run WHERE deleted_at IS NULL AND status = 'raised') AS billing_runs,
           (SELECT count(DISTINCT party_id)::int FROM finance.v_debtor_ageing WHERE outstanding_amount > 0 AND days_outstanding > 90) AS old_debtors`, [me]),
      pg.query(
        `SELECT v.id, v.posting_date::text AS posting_date, v.voucher_no, v.voucher_type, v.status, v.currency,
                COALESCE(v.narration, v.reference, '') AS description,
                (SELECT sum(l.debit) FROM finance.voucher_line l WHERE l.voucher_id = v.id)::numeric(18,2)::text AS amount,
                (SELECT COALESCE(sum(l.debit - l.credit), 0) FROM finance.voucher_line l WHERE l.voucher_id = v.id AND EXISTS (${CASH}))::numeric(18,2)::text AS cash_effect
           FROM finance.voucher v
          WHERE v.financial_year_id = $1 AND v.voucher_type <> 'opening'
          ORDER BY v.created_at DESC LIMIT 8`, [year.id]),
    ])

    const w = work.rows[0]
    const tasks = [
      { key: 'journals', text: 'My vouchers waiting to be posted', n: w.my_drafts },
      { key: 'reconciliation', text: 'Import exceptions to resolve', n: w.import_exceptions },
      { key: 'reconciliation', text: 'Imports not yet committed', n: w.imports_open },
      { key: 'receivables', text: 'Debtors owing more than 90 days', n: w.old_debtors },
      { key: 'receivables', text: 'Rates billing runs to commit', n: w.billing_runs },
    ]
    return ok(reply, {
      year,
      pending_payments: payments.rows,
      debtors: debtors.rows,
      journals: journals.rows[0],
      banks: banks.rows,
      cash_flow: flow.rows,
      tasks,
      recent: recent.rows,
    })
  }))

  // ── Internal Audit ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/audit', {
    preHandler: requirePermission(fastify, 'finance.audit.view'), schema: yearQuery,
  }, guarded('audit', 'The internal audit dashboard could not be read.', async (request, reply) => {
    const year = await yearOf(request.query.financial_year_id)
    if (!year) return noYear(reply)

    const [plan, findings, compliance, recent, upcoming, refusals] = await Promise.all([
      pg.query(
        `SELECT status, count(*)::int AS n FROM finance.audit_engagement
          WHERE (financial_year_id = $1 OR financial_year_id IS NULL) AND status <> 'cancelled' GROUP BY status`, [year.id]),
      pg.query(
        `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
                count(*) FILTER (WHERE status = 'open' AND risk = 'high')::int AS high,
                count(*) FILTER (WHERE status = 'open' AND risk = 'medium')::int AS medium,
                count(*) FILTER (WHERE status = 'open' AND risk = 'low')::int AS low,
                count(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE)::int AS overdue
           FROM finance.audit_finding`),
      pg.query(COMPLIANCE),
      pg.query(
        `SELECT e.id, e.title, e.area, e.phase, e.status, e.updated_at
           FROM finance.audit_engagement e WHERE e.status <> 'cancelled'
          ORDER BY e.updated_at DESC LIMIT 4`),
      pg.query(
        `SELECT * FROM (
           SELECT 'engagement' AS kind, e.id, e.title AS text, e.planned_start::text AS date
             FROM finance.audit_engagement e
            WHERE e.status = 'not_started' AND e.planned_start >= CURRENT_DATE
           UNION ALL
           SELECT 'finding' AS kind, f.id, 'Action due: ' || f.title AS text, f.due_date::text AS date
             FROM finance.audit_finding f
            WHERE f.status = 'open' AND f.due_date >= CURRENT_DATE) u
          ORDER BY date LIMIT 4`),
      systemOf(pg).query(
        `SELECT count(*)::int AS n FROM public.admin_audit_event
          WHERE occurred_at >= now() - interval '7 days' AND status = 403 AND path LIKE '/api/finance%'`),
    ])

    const n = (s) => plan.rows.find((r) => r.status === s)?.n ?? 0
    const total = n('completed') + n('in_progress') + n('not_started')
    const share = (k) => (total ? (Math.round((n(k) * 1000) / total) / 10).toString() : null)
    return ok(reply, {
      year,
      plan: {
        total, completed: n('completed'), in_progress: n('in_progress'), not_started: n('not_started'),
        completed_pct: share('completed'), in_progress_pct: share('in_progress'), not_started_pct: share('not_started'),
      },
      findings: findings.rows[0],
      compliance: compliance.rows[0],
      recent: recent.rows,
      upcoming: upcoming.rows,
      refusals_7d: refusals.rows[0].n,
    })
  }))

  // ── Revenue and Rates ──────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/revenue', {
    preHandler: requirePermission(fastify, 'finance.rates.view'), schema: yearQuery,
  }, guarded('revenue', 'The revenue dashboard could not be read.', async (request, reply) => {
    const year = await yearOf(request.query.financial_year_id)
    if (!year) return noYear(reply)
    const Y = [year.id, year.start_date, year.end_date]
    // Counter receipts that are not rates: a cash_receipt, unless cancelled. Rates paid at the
    // counter are rates_receipt rows, so the two never overlap.
    const SUNDRY = `FROM finance.cash_receipt r WHERE r.cancelled_at IS NULL AND r.received_on BETWEEN $2::date AND $3::date`

    const [billed, collected, rateCollected, arrears, ageing, trend, streams] = await Promise.all([
      pg.query(
        `SELECT currency, count(*)::int AS bills, sum(amount)::numeric(18,2)::text AS amount
           FROM finance.rates_bill WHERE deleted_at IS NULL AND financial_year_id = $1 GROUP BY currency ORDER BY currency`, [year.id]),
      pg.query(
        `SELECT currency, sum(amount)::numeric(18,2)::text AS amount FROM (
           SELECT currency, amount FROM finance.rates_receipt WHERE deleted_at IS NULL AND financial_year_id = $1
           UNION ALL SELECT r.currency, r.amount ${SUNDRY}) x GROUP BY currency ORDER BY currency`, Y),
      // The collection rate compares like with like: rates received against rates billed.
      pg.query(
        `SELECT b.currency, b.billed::numeric(18,2)::text AS billed, COALESCE(c.received, 0)::numeric(18,2)::text AS received,
                CASE WHEN b.billed > 0 THEN round(COALESCE(c.received, 0) * 100 / b.billed, 1)::text END AS rate
           FROM (SELECT currency, sum(amount) AS billed FROM finance.rates_bill WHERE deleted_at IS NULL AND financial_year_id = $1 GROUP BY currency) b
           LEFT JOIN (SELECT currency, sum(amount) AS received FROM finance.rates_receipt WHERE deleted_at IS NULL AND financial_year_id = $1 GROUP BY currency) c
             ON c.currency = b.currency ORDER BY b.currency`, [year.id]),
      pg.query(
        `SELECT currency, count(DISTINCT rates_account_id)::int AS accounts, sum(outstanding_amount)::numeric(18,2)::text AS amount
           FROM finance.v_rates_arrears WHERE outstanding_amount > 0 GROUP BY currency ORDER BY currency`),
      pg.query(
        `SELECT currency,
                CASE WHEN days_outstanding <= 30 THEN '0_30' WHEN days_outstanding <= 60 THEN '31_60'
                     WHEN days_outstanding <= 90 THEN '61_90' ELSE 'over_90' END AS bucket,
                count(*)::int AS items, sum(outstanding_amount)::numeric(18,2)::text AS amount
           FROM finance.v_rates_arrears WHERE outstanding_amount > 0 GROUP BY 1, 2 ORDER BY 1, 2`),
      // Six months to this one (inside the year), billed against collected.
      pg.query(
        `WITH m AS (
           SELECT generate_series(GREATEST(date_trunc('month', $1::date), date_trunc('month', LEAST(CURRENT_DATE, $2::date)) - interval '5 months'),
                                  date_trunc('month', LEAST(CURRENT_DATE, $2::date)), interval '1 month')::date AS month
         ), cur AS (SELECT DISTINCT currency FROM finance.rates_bill WHERE deleted_at IS NULL
                    UNION SELECT DISTINCT currency FROM finance.rates_receipt WHERE deleted_at IS NULL
                    UNION SELECT DISTINCT currency FROM finance.cash_receipt WHERE cancelled_at IS NULL)
         SELECT to_char(m.month, 'YYYY-MM') AS month, cur.currency,
                (SELECT COALESCE(sum(amount), 0) FROM finance.rates_bill b WHERE b.deleted_at IS NULL AND b.currency = cur.currency
                   AND b.issued_on >= m.month AND b.issued_on < m.month + interval '1 month')::numeric(18,2)::text AS billed,
                ((SELECT COALESCE(sum(amount), 0) FROM finance.rates_receipt r WHERE r.deleted_at IS NULL AND r.currency = cur.currency
                   AND r.received_on >= m.month AND r.received_on < m.month + interval '1 month')
                 + (SELECT COALESCE(sum(amount), 0) FROM finance.cash_receipt r WHERE r.cancelled_at IS NULL AND r.currency = cur.currency
                   AND r.received_on >= m.month AND r.received_on < m.month + interval '1 month'))::numeric(18,2)::text AS collected
           FROM m CROSS JOIN cur ORDER BY cur.currency, m.month`, [year.start_date, year.end_date]),
      // Where the money came from: rates, then each counter income code.
      pg.query(
        `WITH src AS (
           SELECT currency, 'Property rates' AS name, amount FROM finance.rates_receipt WHERE deleted_at IS NULL AND financial_year_id = $1
           UNION ALL
           SELECT r.currency, COALESCE(ic.name, 'Other revenue'), l.amount
             FROM finance.cash_receipt r JOIN finance.cash_receipt_line l ON l.cash_receipt_id = r.id
             LEFT JOIN finance.income_code ic ON ic.id = l.income_code_id
            WHERE r.cancelled_at IS NULL AND r.received_on BETWEEN $2::date AND $3::date)
         SELECT currency, name, sum(amount)::numeric(18,2)::text AS amount,
                round(sum(amount) * 100 / NULLIF(sum(sum(amount)) OVER (PARTITION BY currency), 0), 1)::text AS share
           FROM src GROUP BY currency, name ORDER BY currency, sum(amount) DESC`, Y),
    ])

    return ok(reply, {
      year,
      billed: billed.rows,
      collected: collected.rows,
      collection_rate: rateCollected.rows,
      arrears: arrears.rows,
      ageing: ageing.rows,
      trend: trend.rows,
      streams: streams.rows,
    })
  }))

  // ── Executive Finance ──────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/executive', {
    preHandler: requirePermission(fastify, 'finance.ledger.view'), schema: yearQuery,
  }, guarded('executive', 'The executive dashboard could not be read.', async (request, reply) => {
    const year = await yearOf(request.query.financial_year_id)
    if (!year) return noYear(reply)
    const live = `p.status IN ('approved', 'published')`

    const [totals, prior, departments, projects, findings, compliance] = await Promise.all([
      pg.query(
        `SELECT p.currency, p.account_kind,
                COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                ${pct('p.actual_amount', 'p.revised_amount')} AS execution
           FROM finance.v_budget_line_performance p
          WHERE p.financial_year_id = $1 AND ${live}
          GROUP BY p.currency, p.account_kind ORDER BY p.currency, p.account_kind`, [year.id]),
      year.prior_year_id
        ? pg.query(
          `SELECT p.currency, p.account_kind, COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual
             FROM finance.v_budget_line_performance p
            WHERE p.financial_year_id = $1 AND ${live} GROUP BY p.currency, p.account_kind`, [year.prior_year_id])
        : Promise.resolve({ rows: [] }),
      pg.query(
        `SELECT p.currency, d.code, d.name,
                sum(p.revised_amount)::numeric(18,2)::text AS budget, sum(p.actual_amount)::numeric(18,2)::text AS actual,
                ${pct('p.actual_amount', 'p.revised_amount')} AS utilisation
           FROM finance.v_budget_line_performance p JOIN finance.department d ON d.id = p.department_id
          WHERE p.financial_year_id = $1 AND ${live} AND p.account_kind = 'expenditure'
          GROUP BY p.currency, d.code, d.name ORDER BY p.currency, sum(p.revised_amount) DESC`, [year.id]),
      pg.query(
        `SELECT count(*) FILTER (WHERE status IN ('approved', 'in_progress'))::int AS in_progress,
                count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status = 'in_progress' AND NOT COALESCE(spend_ahead_of_progress, false))::int AS on_track,
                count(*) FILTER (WHERE status = 'in_progress')::int AS active
           FROM finance.v_project_performance`),
      pg.query(`SELECT count(*) FILTER (WHERE status = 'open' AND risk = 'high')::int AS high FROM finance.audit_finding`),
      pg.query(COMPLIANCE),
    ])

    const p = projects.rows[0]
    return ok(reply, {
      year,
      totals: totals.rows,
      prior: prior.rows,
      departments: departments.rows,
      projects: { ...p, on_track_pct: p.active ? (Math.round((p.on_track * 1000) / p.active) / 10).toString() : null },
      high_risks: findings.rows[0].high,
      compliance: compliance.rows[0],
    })
  }))

  // ── Publication ────────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/publisher', {
    preHandler: requireAnyPermission(fastify, ['finance.publication.publish', 'finance.publication.review']),
  }, guarded('publisher', 'The publication dashboard could not be read.', async (request, reply) => {
    const [states, month, recent, documents] = await Promise.all([
      pg.query(`SELECT state, count(*)::int AS n FROM finance.publication GROUP BY state`),
      pg.query(
        `SELECT state, count(*)::int AS n FROM finance.publication
          WHERE COALESCE(updated_at, created_at) >= date_trunc('month', CURRENT_DATE) GROUP BY state`),
      pg.query(
        `SELECT p.id, p.dataset, p.version, p.state, p.reporting_period_label, p.published_at, p.created_at,
                y.label AS year_label
           FROM finance.publication p LEFT JOIN finance.financial_year y ON y.id = p.financial_year_id
          ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC LIMIT 5`),
      pg.query(
        `SELECT visibility, count(*)::int AS n FROM finance.document WHERE deleted_at IS NULL GROUP BY visibility`),
    ])
    const by = (rows) => Object.fromEntries(['published', 'pending', 'approved', 'rejected', 'withdrawn'].map((s) => [s, rows.find((r) => r.state === s)?.n ?? 0]))
    return ok(reply, {
      states: by(states.rows),
      this_month: by(month.rows),
      recent: recent.rows,
      documents: Object.fromEntries(['public', 'internal', 'private'].map((v) => [v, documents.rows.find((r) => r.visibility === v)?.n ?? 0])),
    })
  }))

  // ── Department Finance ─────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/dashboards/department', {
    preHandler: requirePermission(fastify, 'finance.budget.view'), schema: yearQuery,
  }, guarded('department', 'The department dashboard could not be read.', async (request, reply) => {
    const year = await yearOf(request.query.financial_year_id)
    if (!year) return noYear(reply)
    const scope = await departmentScope(fastify, request)
    // A departmental head with no scope recorded sees nothing rather than the whole council.
    const isDepartmental = request.user.role === 'dept_head'
    if (isDepartmental && !scope) {
      return ok(reply, { year, departments: [], unscoped: true, totals: [], top_items: [], tasks: [] })
    }
    const D = [year.id, scope]
    const inScope = `($2::uuid[] IS NULL OR p.department_id = ANY($2::uuid[]))`
    const spend = `p.financial_year_id = $1 AND p.account_kind = 'expenditure' AND ${inScope}`

    const [departments, totals, items, work] = await Promise.all([
      pg.query(
        `SELECT id, code, name FROM finance.department
          WHERE deleted_at IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[])) ORDER BY code`, [scope]),
      pg.query(
        `SELECT p.currency,
                COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                COALESCE(sum(p.open_commitments), 0)::numeric(18,2)::text AS committed,
                COALESCE(sum(p.available_including_commitments), 0)::numeric(18,2)::text AS available,
                ${pct('p.actual_amount', 'p.revised_amount')} AS actual_pct,
                ${pct('p.open_commitments', 'p.revised_amount')} AS committed_pct,
                ${pct('p.available_including_commitments', 'p.revised_amount')} AS available_pct,
                ${pct('p.actual_amount + p.open_commitments', 'p.revised_amount')} AS utilised_pct
           FROM finance.v_budget_line_performance p
          WHERE ${spend} AND p.status IN ('approved', 'published')
          GROUP BY p.currency ORDER BY p.currency`, D),
      pg.query(
        `SELECT p.budget_line_id, p.currency, p.code, p.description, p.actual_amount::numeric(18,2)::text AS actual,
                p.revised_amount::numeric(18,2)::text AS budget
           FROM finance.v_budget_line_performance p
          WHERE ${spend} AND p.status IN ('approved', 'published') AND p.actual_amount > 0
          ORDER BY p.currency, p.actual_amount DESC LIMIT 10`, D),
      pg.query(
        `SELECT
           (SELECT count(*)::int FROM finance.budget_line p WHERE p.deleted_at IS NULL AND p.financial_year_id = $1 AND ${inScope} AND p.status = 'returned') AS returned,
           (SELECT count(*)::int FROM finance.budget_line p WHERE p.deleted_at IS NULL AND p.financial_year_id = $1 AND ${inScope} AND p.status = 'draft') AS drafts,
           (SELECT count(*)::int FROM finance.commitment c JOIN finance.budget_line p ON p.id = c.budget_line_id
             WHERE c.deleted_at IS NULL AND p.financial_year_id = $1 AND ${inScope} AND c.status IN ('open', 'partially_liquidated')) AS commitments,
           (SELECT count(*)::int FROM finance.v_budget_line_performance p
             WHERE ${spend} AND p.status IN ('approved', 'published') AND p.actual_amount > p.revised_amount
               AND NOT EXISTS (SELECT 1 FROM finance.variance_explanation v
                                WHERE v.budget_line_id = p.budget_line_id AND v.deleted_at IS NULL)) AS unexplained,
           (SELECT count(*)::int FROM finance.budget_revision r JOIN finance.budget_line p ON p.id = r.budget_line_id
             WHERE r.deleted_at IS NULL AND p.financial_year_id = $1 AND ${inScope} AND r.state = 'draft') AS revision_drafts`, D),
    ])

    const w = work.rows[0]
    const tasks = [
      { key: 'budget', query: { status: 'returned' }, text: 'Budget lines returned to revise', n: w.returned },
      { key: 'budget', query: { status: 'draft' }, text: 'Draft budget lines to submit', n: w.drafts },
      { key: 'commitments', text: 'Open commitments to review', n: w.commitments },
      { key: 'expenditure', text: 'Overspent lines needing a variance explanation', n: w.unexplained },
      { key: 'revisions', text: 'Draft revisions to submit', n: w.revision_drafts },
    ]
    return ok(reply, { year, departments: departments.rows, unscoped: false, totals: totals.rows, top_items: items.rows, tasks })
  }))
}

module.exports = { financeDashboardRoutes }
