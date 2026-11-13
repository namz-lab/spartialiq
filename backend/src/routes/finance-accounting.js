/**
 * The accountant's dashboard: one read that draws the Accounting workspace's first screen.
 *
 * Design: docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md (frontend repository),
 * Accounting workspace. Everything here READS. Every act it leads to (verify a cash-up, post a
 * voucher, post a deposit, commit a billing run, close a period) is a route that already exists
 * and keeps its own permission and its own database refusal.
 *
 * THE SAME RULES AS THE REST OF THE LEDGER
 *  1. No money arithmetic in JavaScript. Every figure is computed by Postgres and sent as text.
 *  2. Nothing is totalled across currencies. Every money figure is one row per currency (D4).
 *  3. Only posted entries count (finance.ledger_entry holds nothing else). A counter receipt in a
 *     session that has not been verified is not yet a collection, and is counted as work instead.
 *
 * WHAT IS NOT HERE, AND WHY
 * Payables, the cashbook and bank reconciliation, and the fixed-asset register are deferred
 * workstreams (see the `incomplete` list on /finance/ledger/statements/position). The creditor
 * ageing below reads whatever has been posted to payable accounts, and says when there are none.
 */

const { requirePermission } = require('../middleware/financePermissions')

const ok = (reply, data) => reply.code(200).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

/** The four columns a dashboard shows, from the ledger's finer buckets. */
const BUCKET_GROUP = `CASE
    WHEN %s <= 30 THEN 'current'
    WHEN %s <= 60 THEN '31_60'
    WHEN %s <= 90 THEN '61_90'
    ELSE 'over_90' END`
const bucket = (days) => BUCKET_GROUP.replace(/%s/g, days)

/**
 * What is owed to creditors, per voucher that raised it, net of what has been paid against it.
 * The mirror of finance.v_debtor_ageing over accounts typed `payable`: a credit raises, a debit
 * acting on it (against_voucher_id, or a reversal) settles.
 */
const CREDITOR_OPEN = `
  WITH payable AS (
    SELECT e.currency, e.party_id, e.voucher_id, e.voucher_no, COALESCE(v.document_date, e.posting_date) AS posting_date, e.debit, e.credit,
           COALESCE(e.against_voucher_id, v.reverses_voucher_id) AS acts_on
      FROM finance.ledger_entry e
      JOIN finance.voucher v ON v.id = e.voucher_id
     WHERE EXISTS (SELECT 1 FROM finance.ledger_account la WHERE la.id = e.ledger_account_id AND la.account_type = 'payable')
  ), raised AS (
    SELECT currency, party_id, voucher_id, voucher_no, posting_date, sum(credit) AS raised
      FROM payable WHERE acts_on IS NULL AND credit > 0
     GROUP BY currency, party_id, voucher_id, voucher_no, posting_date
  ), settled AS (
    SELECT acts_on AS voucher_id, sum(debit - credit) AS settled FROM payable WHERE acts_on IS NOT NULL GROUP BY acts_on
  )
  SELECT r.currency, r.party_id, p.name AS party_name, r.voucher_id, r.voucher_no, r.posting_date,
         (r.raised - COALESCE(s.settled, 0))::numeric(18,2) AS outstanding,
         (CURRENT_DATE - r.posting_date) AS days
    FROM raised r
    LEFT JOIN settled s ON s.voucher_id = r.voucher_id
    LEFT JOIN finance.party p ON p.id = r.party_id
   WHERE r.raised - COALESCE(s.settled, 0) <> 0`

async function financeAccountingRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.ledger.view') }
  const uuid = { type: 'string', format: 'uuid' }

  /** The year asked for, or the open year containing today. */
  async function yearOf(id) {
    const { rows } = await pg.query(
      `SELECT y.id, y.label, y.start_date::text AS start_date, y.end_date::text AS end_date, y.status,
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

  fastify.get('/finance/accounting/dashboard', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    const me = request.user.id
    try {
      const year = await yearOf(request.query.financial_year_id)
      if (!year) return fail(reply, 404, 'no_year', 'No open financial year contains today. Choose a year.')
      // The year to date, and the same stretch of the year before, for the comparison.
      const asOf = `LEAST(CURRENT_DATE, $3::date)`

      const [
        flows, priorFlows, banks, budget, position, receivables, payables, cashups,
        work, recent, periods, payableAccounts,
      ] = await Promise.all([
        // Money in and out of the bank and the tills, year to date. Openings are balances, not flows.
        pg.query(
          `SELECT e.currency,
                  COALESCE(sum(e.debit), 0)::numeric(18,2)::text AS collections,
                  COALESCE(sum(e.credit), 0)::numeric(18,2)::text AS payments
             FROM finance.ledger_entry e
             JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type IN ('bank', 'cash')
             JOIN finance.voucher v ON v.id = e.voucher_id
            WHERE e.financial_year_id = $1 AND v.voucher_type NOT IN ('opening', 'closing')
              AND e.posting_date BETWEEN $2::date AND ${asOf}
            GROUP BY e.currency ORDER BY e.currency`, [year.id, year.start_date, year.end_date]),
        year.prior_year_id
          ? pg.query(
            `SELECT e.currency, COALESCE(sum(e.debit), 0) AS collections, COALESCE(sum(e.credit), 0) AS payments
               FROM finance.ledger_entry e
               JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type IN ('bank', 'cash')
               JOIN finance.voucher v ON v.id = e.voucher_id
               JOIN finance.financial_year py ON py.id = $1
              WHERE e.financial_year_id = $1 AND v.voucher_type NOT IN ('opening', 'closing')
                AND e.posting_date <= py.start_date + (${asOf} - $2::date)
              GROUP BY e.currency`, [year.prior_year_id, year.start_date, year.end_date])
          : Promise.resolve({ rows: [] }),
        // Every bank account's balance from its first entry, whatever year it was posted in.
        pg.query(
          `SELECT la.id, la.code, la.name, e.currency,
                  COALESCE(sum(e.debit - e.credit), 0)::numeric(18,2)::text AS balance,
                  max(e.posting_date)::text AS last_entry
             FROM finance.ledger_account la
             JOIN finance.ledger_entry e ON e.ledger_account_id = la.id
            WHERE la.deleted_at IS NULL AND la.account_type = 'bank'
            GROUP BY la.id, la.code, la.name, e.currency ORDER BY la.code, e.currency`),
        pg.query(
          `SELECT p.currency,
                  COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                  COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS spent,
                  (COALESCE(sum(p.revised_amount), 0) - COALESCE(sum(p.actual_amount), 0))::numeric(18,2)::text AS remaining,
                  CASE WHEN COALESCE(sum(p.revised_amount), 0) > 0
                       THEN round(sum(p.actual_amount) * 100 / sum(p.revised_amount), 1)::text END AS utilisation
             FROM finance.v_department_performance p
            WHERE p.financial_year_id = $1 AND p.account_kind = 'expenditure'
            GROUP BY p.currency ORDER BY p.currency`, [year.id]),
        pg.query(
          `SELECT tb.currency,
                  COALESCE(sum(tb.debit_balance - tb.credit_balance) FILTER (WHERE tb.root_type = 'asset'), 0)::numeric(18,2)::text AS assets,
                  COALESCE(sum(tb.credit_balance - tb.debit_balance) FILTER (WHERE tb.root_type = 'liability'), 0)::numeric(18,2)::text AS liabilities,
                  (COALESCE(sum(tb.debit_balance - tb.credit_balance) FILTER (WHERE tb.root_type = 'asset'), 0)
                   - COALESCE(sum(tb.credit_balance - tb.debit_balance) FILTER (WHERE tb.root_type = 'liability'), 0))::numeric(18,2)::text AS net_assets
             FROM finance.v_trial_balance tb
            WHERE tb.financial_year_id = $1
            GROUP BY tb.currency ORDER BY tb.currency`, [year.id]),
        pg.query(
          `SELECT a.currency, ${bucket('a.days_outstanding')} AS bucket,
                  count(*)::int AS items, sum(a.outstanding_amount)::numeric(18,2)::text AS amount
             FROM finance.v_debtor_ageing a WHERE a.outstanding_amount > 0
            GROUP BY 1, 2 ORDER BY 1, 2`),
        pg.query(
          `SELECT c.currency, ${bucket('c.days')} AS bucket, count(*)::int AS items, sum(c.outstanding)::numeric(18,2)::text AS amount
             FROM (${CREDITOR_OPEN}) c WHERE c.outstanding > 0 GROUP BY 1, 2 ORDER BY 1, 2`),
        // Counts waiting for a second person. Excludes what the caller counted, closed or witnessed.
        pg.query(
          `SELECT cs.id, cs.session_no, cs.business_date::text AS business_date, cp.code AS cash_point_code,
                  cp.name AS cash_point_name, COALESCE(u.full_name, u.name) AS cashier_name, cs.closed_at,
                  (cs.cashier_id = $1 OR cs.closed_by IS NOT DISTINCT FROM $1 OR cs.witness_id IS NOT DISTINCT FROM $1) AS is_mine,
                  COALESCE(json_agg(json_build_object(
                    'currency', c.currency, 'expected', (c.opening_float + c.expected_takings)::numeric(18,2)::text,
                    'declared', c.declared_total::numeric(18,2)::text, 'variance', c.variance::numeric(18,2)::text)
                    ORDER BY c.currency) FILTER (WHERE c.currency IS NOT NULL), '[]') AS counts
             FROM finance.cashier_session cs
             JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
             JOIN public.users u ON u.id = cs.cashier_id
             LEFT JOIN finance.cashier_session_count c ON c.cashier_session_id = cs.id
            WHERE cs.status = 'closed'
            GROUP BY cs.id, cp.code, cp.name, u.full_name, u.name
            ORDER BY cs.business_date, cs.closed_at`, [me]),
        pg.query(
          `SELECT
             (SELECT count(*)::int FROM finance.voucher WHERE status = 'draft' AND prepared_by <> $1
                 AND voucher_type NOT IN ('receipt', 'rates_bill')) AS vouchers_to_post,
             (SELECT count(*)::int FROM finance.voucher WHERE status = 'draft' AND prepared_by = $1) AS my_drafts,
             (SELECT count(*)::int FROM finance.bank_deposit d JOIN finance.voucher v ON v.id = d.voucher_id
               WHERE v.status = 'draft' AND d.prepared_by <> $1) AS deposits_to_post,
             (SELECT count(*)::int FROM finance.rates_billing_run
               WHERE deleted_at IS NULL AND status NOT IN ('committed', 'cancelled') AND prepared_by <> $1) AS billing_runs_to_commit,
             (SELECT count(*)::int FROM finance.rates_receipt rr JOIN finance.voucher v ON v.id = rr.voucher_id
               WHERE rr.deleted_at IS NULL AND rr.cashier_session_id IS NULL AND v.status = 'draft') AS rates_receipts_to_post`, [me]),
        pg.query(
          `SELECT v.id, v.posting_date::text AS posting_date, v.voucher_no, v.voucher_type, v.currency,
                  COALESCE(v.narration, v.reference, '') AS description,
                  (SELECT sum(l.debit) FROM finance.voucher_line l WHERE l.voucher_id = v.id)::numeric(18,2)::text AS amount,
                  (SELECT COALESCE(sum(e.debit - e.credit), 0) FROM finance.ledger_entry e
                     JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type IN ('bank', 'cash')
                    WHERE e.voucher_id = v.id)::numeric(18,2)::text AS cash_effect
             FROM finance.voucher v
            WHERE v.status = 'posted' AND v.financial_year_id = $1
            ORDER BY v.posted_at DESC NULLS LAST, v.voucher_no DESC LIMIT 8`, [year.id]),
        pg.query(
          `SELECT id, period_no, label, from_date::text AS from_date, to_date::text AS to_date, status,
                  (to_date - CURRENT_DATE) AS days_left
             FROM finance.ledger_period
            WHERE financial_year_id = $1 AND status = 'open' AND from_date <= CURRENT_DATE
            ORDER BY from_date`, [year.id]),
        pg.query(`SELECT count(*)::int AS n FROM finance.ledger_account WHERE account_type = 'payable' AND deleted_at IS NULL`),
      ])

      const prior = new Map(priorFlows.rows.map((r) => [r.currency, r]))
      const pct = async (now, before) => {
        if (before === undefined || before === null || Number(before) === 0) return null
        const { rows } = await pg.query('SELECT round(($1::numeric - $2::numeric) * 100 / $2::numeric, 1)::text AS p', [now, before])
        return rows[0].p
      }
      const flowRows = []
      for (const f of flows.rows) {
        const p = prior.get(f.currency)
        flowRows.push({
          ...f,
          collections_change_pct: p ? await pct(f.collections, p.collections) : null,
          payments_change_pct: p ? await pct(f.payments, p.payments) : null,
        })
      }

      const awaiting = cashups.rows.filter((c) => !c.is_mine)
      const w = work.rows[0]
      const current = periods.rows[periods.rows.length - 1] || null
      const overdueOpen = periods.rows.filter((p) => p.days_left < 0)
      const tasks = [
        awaiting.length && { key: 'cashups', count: awaiting.length, text: `Verify ${awaiting.length} cashier cash-up${awaiting.length === 1 ? '' : 's'}` },
        w.vouchers_to_post && { key: 'vouchers', count: w.vouchers_to_post, text: `Post ${w.vouchers_to_post} journal${w.vouchers_to_post === 1 ? '' : 's'} prepared by others` },
        w.deposits_to_post && { key: 'deposits', count: w.deposits_to_post, text: `Post ${w.deposits_to_post} bank deposit${w.deposits_to_post === 1 ? '' : 's'}` },
        w.billing_runs_to_commit && { key: 'billing', count: w.billing_runs_to_commit, text: `Commit ${w.billing_runs_to_commit} rates billing run${w.billing_runs_to_commit === 1 ? '' : 's'}` },
        w.rates_receipts_to_post && { key: 'rates_receipts', count: w.rates_receipts_to_post, text: `Post ${w.rates_receipts_to_post} rates receipt${w.rates_receipts_to_post === 1 ? '' : 's'}` },
        overdueOpen.length && { key: 'periods', count: overdueOpen.length, text: `Close ${overdueOpen.length} period${overdueOpen.length === 1 ? '' : 's'} that ${overdueOpen.length === 1 ? 'has' : 'have'} ended` },
        w.my_drafts && { key: 'my_drafts', count: w.my_drafts, text: `${w.my_drafts} of your draft voucher${w.my_drafts === 1 ? '' : 's'} await someone else to post` },
      ].filter(Boolean)

      const alerts = []
      for (const r of receivables.rows.filter((x) => x.bucket === 'over_90')) {
        alerts.push({ tone: 'warn', key: 'debtors', text: `${r.items} debtor balance${r.items === 1 ? '' : 's'} over 90 days (${r.currency} ${r.amount})` })
      }
      for (const c of awaiting) {
        for (const n of c.counts.filter((x) => x.variance && Number(x.variance) !== 0)) {
          alerts.push({ tone: 'neg', key: 'cashups', text: `${c.cashier_name}'s count on ${c.business_date} differs by ${n.currency} ${n.variance}` })
        }
      }
      if (current && current.days_left >= 0 && current.days_left <= 7) {
        alerts.push({ tone: 'info', key: 'periods', text: `${current.label} ends in ${current.days_left} day${current.days_left === 1 ? '' : 's'} (${current.to_date})` })
      }
      if (banks.rows.length) alerts.push({ tone: 'info', key: 'bank', text: 'Bank balances are unreconciled: the cashbook and reconciliation are not built yet' })

      return ok(reply, {
        year,
        flows: flowRows,
        banks: banks.rows,
        budget: budget.rows,
        position: position.rows,
        receivables: receivables.rows,
        payables: payables.rows,
        payables_configured: payableAccounts.rows[0].n > 0,
        cashups: awaiting,
        own_cashups: cashups.rows.filter((c) => c.is_mine).length,
        tasks,
        items_requiring_action: tasks.filter((t) => t.key !== 'my_drafts').reduce((n, t) => n + t.count, 0),
        recent: recent.rows,
        current_period: current,
        alerts,
      })
    } catch (err) {
      fastify.log.error({ err }, 'accounting dashboard')
      return fail(reply, 500, 'accounting_error', 'The accounting dashboard could not be read.')
    }
  })

  /** Creditors: every open payable, by party, with its age. Empty until payables are posted. */
  fastify.get('/finance/accounting/creditor-ageing', { ...canView }, async (request, reply) => {
    try {
      const [{ rows }, { rows: accounts }] = await Promise.all([
        pg.query(`SELECT c.currency, c.party_id, c.party_name, c.voucher_id, c.voucher_no,
                         c.posting_date::text AS posting_date, c.outstanding::text AS outstanding, c.days,
                         ${bucket('c.days')} AS bucket
                    FROM (${CREDITOR_OPEN}) c ORDER BY c.currency, c.days DESC`),
        pg.query(`SELECT count(*)::int AS n FROM finance.ledger_account WHERE account_type = 'payable' AND deleted_at IS NULL`),
      ])
      return ok(reply, { items: rows, payables_configured: accounts[0].n > 0 })
    } catch (err) {
      fastify.log.error({ err }, 'creditor ageing')
      return fail(reply, 500, 'accounting_error', 'The creditor ageing could not be read.')
    }
  })
}

module.exports = { financeAccountingRoutes }
