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
 * Payables, bank reconciliation and the fixed-asset register have their own routes
 * (finance-payables.js, finance-bank.js, finance-assets.js) with their own permissions; this file
 * is the workspace's read layer over the ledger they post into. The creditor ageing below reads
 * whatever has been posted to payable accounts, and says when there are none.
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

/**
 * A balance as a JSON object, built in SQL from a NUMERIC expression: `net_debit` signed
 * debit-positive, `amount` its absolute value, `side` 'Cr' only below nil. The same text as
 * finance-ledger-reads.js. `expr` is SQL written in this file, never a value from the request.
 */
const balSql = (expr) => `json_build_object(
    'net_debit', (${expr})::numeric(18,2)::text,
    'amount', abs(${expr})::numeric(18,2)::text,
    'side', CASE WHEN (${expr}) < 0 THEN 'Cr' ELSE 'Dr' END)`

/** The most entries one statement of account carries. Beyond it the reader narrows the dates. */
const STATEMENT_LINE_CAP = 5000

/**
 * A debtor's open items in one book: $1 party, $2 currency, $3 authority. Straight from
 * finance.v_debtor_ageing, so the statement and the ageing cannot disagree. A settled bill is left
 * out; an unallocated receipt stays, with its negative figure.
 */
const DEBTOR_ITEMS = `
  SELECT a.voucher_id, a.voucher_no, a.voucher_type, a.posting_date::text AS posting_date,
         a.ledger_account_id,
         a.billed_amount::numeric(18,2)::text      AS billed_amount,
         a.settled_amount::numeric(18,2)::text     AS settled_amount,
         a.outstanding_amount::numeric(18,2)::text AS outstanding_amount,
         a.days_outstanding, a.ageing_bucket
    FROM finance.v_debtor_ageing a
   WHERE a.party_id = $1 AND a.currency::text = $2 AND a.authority_id = $3
     AND a.outstanding_amount <> 0
   ORDER BY a.posting_date, a.voucher_no, a.ledger_account_id`

/**
 * A creditor's open items in one book, from finance.v_creditor_open (migration 213), in the same
 * shape as a debtor's: the document date stands as `posting_date` (the date the view ages from),
 * `raised_amount` as `billed_amount`, and the bucket comes from finance.ageing_bucket(), the one
 * definition the debtor ageing uses. A document paid beyond its amount reads `unallocated`.
 */
const CREDITOR_ITEMS = `
  SELECT c.voucher_id, c.voucher_no, c.voucher_type, c.document_date::text AS posting_date,
         c.ledger_account_id,
         c.raised_amount::numeric(18,2)::text      AS billed_amount,
         c.settled_amount::numeric(18,2)::text     AS settled_amount,
         c.outstanding_amount::numeric(18,2)::text AS outstanding_amount,
         c.days_outstanding,
         CASE WHEN c.outstanding_amount < 0 THEN 'unallocated'
              ELSE finance.ageing_bucket(c.days_outstanding) END AS ageing_bucket
    FROM finance.v_creditor_open c
   WHERE c.party_id = $1 AND c.currency::text = $2 AND c.authority_id = $3
     AND c.outstanding_amount <> 0
   ORDER BY c.document_date, c.voucher_no, c.ledger_account_id`

// ── Period readiness (B11; spec §6.7; accounting audit S12) ──────────────────────────────────

/**
 * The readiness checks, in the order the page lists them, with the accountant route each is
 * cleared under. `depreciation_not_run` is listed only when an in-use depreciable asset exists for
 * the period. The last two are the control reconciliations audit S12 asked for: they are about the
 * whole book, not the month, because the debtor ageing and the creditor open items are read as at
 * today (audit S4).
 */
const READINESS_CHECKS = [
  { key: 'draft_vouchers', label: 'Draft vouchers dated in the period', target: 'acc-journals' },
  { key: 'cashups_unverified', label: 'Cash-ups not yet verified', target: 'acc-cashups' },
  { key: 'deposits_unposted', label: 'Bank deposits not posted', target: 'acc-banking' },
  { key: 'payables_awaiting', label: 'Supplier invoices and payments awaiting approval', target: 'acc-payable' },
  { key: 'depreciation_not_run', label: 'Depreciation not run for the period', target: 'acc-assets' },
  { key: 'bank_statements_open', label: 'Bank statements still open', target: 'acc-bank' },
  { key: 'bank_not_reconciled', label: 'Bank accounts with entries no completed reconciliation has matched', target: 'acc-bank' },
  { key: 'debtors_control', label: 'Debtors ageing differs from the receivable control account (whole book, as at today)', target: 'acc-receivable', wholeBook: true },
  { key: 'creditors_control', label: 'Creditor open items differ from the payable control account (whole book, as at today)', target: 'acc-payable', wholeBook: true },
]

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * Assemble the readiness answer from what the database counted. Pure, so the order, the `ok` rule
 * and the wording are unit-tested without Postgres (test/finance-ledger.test.js). No arithmetic on
 * money: every difference arrives as text from SQL and is quoted, never computed.
 *
 *   counts         { draft_vouchers, cashups_unverified, deposits_unposted, payables_awaiting,
 *                    bank_statements_open } (integers)
 *   depreciation   [{ currency, run }] for each book with an in-use depreciable asset; [] = none
 *   unreconciled   [{ code, currency, entries }] bank account books with unmatched entries
 *   debtors        [{ currency, difference }] books whose ageing and control disagree
 *   creditors      [{ currency, difference }] the same for creditors
 *   books          [{ currency, balances, difference }] from finance.ledger_balances
 */
function assembleReadiness(period, { counts, depreciation, unreconciled, debtors, creditors, books, asAt = null }) {
  const detailOf = {
    draft_vouchers: (n) => `${plural(n, 'draft is', 'drafts are')} dated in the period and not posted.`,
    cashups_unverified: (n) => `${plural(n, 'cash-up', 'cash-ups')} of the period ${n === 1 ? 'is' : 'are'} open or awaiting verification.`,
    deposits_unposted: (n) => `${plural(n, 'deposit is', 'deposits are')} dated in the period and not posted.`,
    payables_awaiting: (n) => `${plural(n, 'supplier document is', 'supplier documents are')} dated in the period and awaiting approval.`,
    depreciation_not_run: () => `Not run in ${depreciation.filter((d) => !d.run).map((d) => d.currency).join(' and ')}.`,
    bank_statements_open: (n) => `${plural(n, 'statement covering the period is', 'statements covering the period are')} still open.`,
    bank_not_reconciled: () => unreconciled.map((u) => `${u.code} (${u.currency}): ${plural(u.entries, 'entry', 'entries')}`).join('; '),
    debtors_control: () => debtors.map((d) => `${d.currency}: the ageing less the control is ${d.difference}`).join('; '),
    creditors_control: () => creditors.map((d) => `${d.currency}: the open items less the control is ${d.difference}`).join('; '),
  }
  const countOf = {
    ...counts,
    depreciation_not_run: depreciation.filter((d) => !d.run).length,
    bank_not_reconciled: unreconciled.length,
    debtors_control: debtors.length,
    creditors_control: creditors.length,
  }
  const checks = READINESS_CHECKS
    .filter((c) => c.key !== 'depreciation_not_run' || depreciation.length > 0)
    .map((c) => {
      const count = countOf[c.key]
      return { key: c.key, label: c.label, count, ok: count === 0, detail: count === 0 ? null : detailOf[c.key](count), target: c.target }
    })
  return {
    period,
    checks,
    books,
    ready: checks.every((c) => c.ok) && books.every((b) => b.balances),
    // The day the two whole-book reconciliations were read (review M1): they are not as at the
    // period end, because the ageing views are as at today (audit S4).
    as_at: asAt,
  }
}

/** The checks that were not clear, as the period PATCH writes them into its audit row. */
const WHOLE_BOOK = new Set(READINESS_CHECKS.filter((c) => c.wholeBook).map((c) => c.key))
const outstandingOf = (readiness) => readiness.checks.filter((c) => !c.ok).map(({ key, count }) => (
  WHOLE_BOOK.has(key) ? { key, count, scope: 'whole_book', as_at: readiness.as_at } : { key, count }))

/**
 * Read one period's readiness. `db` is the caller's (scoped) connection; every table read names the
 * caller's authority explicitly as well, so a combination authority's rows never count for a member
 * council (security audit M1). Returns null when the period is not this council's.
 */
async function periodReadiness(db, periodId, authorityId) {
  const { rows: found } = await db.query(
    `SELECT lp.id, lp.period_no, lp.label, lp.from_date::text AS from_date, lp.to_date::text AS to_date,
            lp.status, lp.financial_year_id
       FROM finance.ledger_period lp
       JOIN finance.financial_year fy ON fy.id = lp.financial_year_id AND fy.authority_id = $2
      WHERE lp.id = $1 AND lp.authority_id = $2`, [periodId, authorityId])
  if (!found[0]) return null
  const { financial_year_id: yearId, ...period } = found[0]

  // One query at a time (review M3): a period close must not take six pooled connections at once.
  const sequence = async (queries) => {
    const out = []
    for (const [sql, params] of queries) out.push(await db.query(sql, params))
    return out
  }
  const [today, counts, depreciation, unreconciled, debtors, creditors, books] = await sequence([
    ['SELECT CURRENT_DATE::text AS d', []],
    [
      `SELECT
         -- Drafts dated in the period, less those counted under their own heading below (bank
         -- deposits, supplier documents) or under the cash-ups (receipts taken at a counter).
         (SELECT count(*)::int FROM finance.voucher v
           WHERE v.authority_id = $1 AND v.financial_year_id = $2 AND v.status = 'draft'
             AND v.posting_date BETWEEN $3::date AND $4::date
             AND NOT EXISTS (SELECT 1 FROM finance.bank_deposit d WHERE d.voucher_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM finance.supplier_invoice d WHERE d.voucher_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM finance.supplier_payment d WHERE d.voucher_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM finance.cash_receipt d WHERE d.voucher_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM finance.rates_receipt d
                              WHERE d.voucher_id = v.id AND d.cashier_session_id IS NOT NULL)) AS draft_vouchers,
         (SELECT count(*)::int FROM finance.cashier_session cs
           WHERE cs.authority_id = $1 AND cs.status IN ('open', 'closed')
             AND cs.business_date BETWEEN $3::date AND $4::date) AS cashups_unverified,
         (SELECT count(*)::int FROM finance.bank_deposit d
            JOIN finance.voucher v ON v.id = d.voucher_id
           WHERE d.authority_id = $1 AND d.cancelled_at IS NULL AND v.status = 'draft'
             AND v.posting_date BETWEEN $3::date AND $4::date) AS deposits_unposted,
         (SELECT count(*)::int FROM (
             SELECT si.voucher_id FROM finance.supplier_invoice si WHERE si.authority_id = $1
             UNION ALL
             SELECT sp.voucher_id FROM finance.supplier_payment sp WHERE sp.authority_id = $1) d
            JOIN finance.voucher v ON v.id = d.voucher_id
           WHERE v.status = 'draft' AND v.posting_date BETWEEN $3::date AND $4::date) AS payables_awaiting,
         (SELECT count(*)::int FROM finance.bank_statement s
           WHERE s.authority_id = $1 AND s.status = 'open'
             AND s.from_date <= $4::date AND s.to_date >= $3::date) AS bank_statements_open`,
      // $1 authority, $2 year, $3 the period's first day, $4 its last.
      [authorityId, yearId, period.from_date, period.to_date]],
    // Each book holding an asset in use that depreciates and had started by the period end, and
    // whether a run for this period stands (a draft run counts as run; its voucher is a draft).
    [
      `SELECT d.currency,
              EXISTS (SELECT 1 FROM finance.depreciation_run r
                       WHERE r.authority_id = $1 AND r.ledger_period_id = $3 AND r.currency::text = d.currency
                         AND finance.voucher_stands(r.voucher_id)) AS run
         FROM (SELECT DISTINCT a.currency::text AS currency FROM finance.v_asset_register a
                WHERE a.authority_id = $1 AND a.method = 'straight_line' AND a.status = 'in_use'
                  AND a.depreciation_start <= $2::date) d
        ORDER BY d.currency`, [authorityId, period.to_date, periodId]],
    // Bank account books with an entry dated in the period that no RECONCILED statement has matched,
    // leaving out openings and a posting reversed within the period (with its reversal).
    [
      `SELECT la.code, e.currency::text AS currency, count(*)::int AS entries
         FROM finance.ledger_entry e
         JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.authority_id = $1 AND la.authority_id = $1 AND la.account_type = 'bank'
          AND e.posting_date BETWEEN $2::date AND $3::date
          -- An opening balance is no movement the bank will show (review M2).
          AND e.voucher_type <> 'opening'
          -- Nor is a posting and its reversal when both fall in the period: they cancel, and a
          -- statement never carries either.
          AND NOT EXISTS (SELECT 1 FROM finance.voucher r
                           WHERE r.reverses_voucher_id = e.voucher_id AND r.status = 'posted'
                             AND r.authority_id = $1 AND r.posting_date BETWEEN $2::date AND $3::date)
          AND NOT EXISTS (SELECT 1 FROM finance.voucher x
                            JOIN finance.voucher o ON o.id = x.reverses_voucher_id
                           WHERE x.id = e.voucher_id AND o.authority_id = $1
                             AND o.posting_date BETWEEN $2::date AND $3::date)
          AND NOT EXISTS (
            SELECT 1 FROM finance.bank_match_entry me
              JOIN finance.bank_match m ON m.id = me.match_id
              JOIN finance.bank_statement st ON st.id = m.statement_id
             WHERE me.ledger_entry_id = e.id AND st.status = 'reconciled' AND st.authority_id = $1)
        GROUP BY la.code, e.currency
        ORDER BY la.code, e.currency`, [authorityId, period.from_date, period.to_date]],
    // The debtor ageing against the receivable control, per book: the same comparison as
    // GET /finance/ledger/debtor-ageing's `reconciliation`, so the two cannot disagree.
    [
      `WITH aged AS (
         SELECT a.currency::text AS currency, sum(a.outstanding_amount) AS total
           FROM finance.v_debtor_ageing a WHERE a.authority_id = $1 GROUP BY a.currency
       ), control AS (
         SELECT ab.currency::text AS currency, sum(ab.net_debit) AS total
           FROM finance.v_account_balance ab
           JOIN finance.ledger_account la ON la.id = ab.ledger_account_id
          WHERE la.account_type = 'receivable' AND la.deleted_at IS NULL
            AND la.authority_id = $1 AND ab.authority_id = $1
          GROUP BY ab.currency
       )
       SELECT COALESCE(aged.currency, control.currency) AS currency,
              (COALESCE(aged.total, 0) - COALESCE(control.total, 0))::numeric(18,2)::text AS difference
         FROM aged FULL OUTER JOIN control ON control.currency = aged.currency
        WHERE COALESCE(aged.total, 0) <> COALESCE(control.total, 0)
        ORDER BY 1`, [authorityId]],
    // The creditor open items against the payable control (a credit balance), per book.
    [
      `WITH open_items AS (
         SELECT c.currency::text AS currency, sum(c.outstanding_amount) AS total
           FROM finance.v_creditor_open c WHERE c.authority_id = $1 GROUP BY c.currency
       ), control AS (
         SELECT ab.currency::text AS currency, -sum(ab.net_debit) AS total
           FROM finance.v_account_balance ab
           JOIN finance.ledger_account la ON la.id = ab.ledger_account_id
          WHERE la.account_type = 'payable' AND la.deleted_at IS NULL
            AND la.authority_id = $1 AND ab.authority_id = $1
          GROUP BY ab.currency
       )
       SELECT COALESCE(open_items.currency, control.currency) AS currency,
              (COALESCE(open_items.total, 0) - COALESCE(control.total, 0))::numeric(18,2)::text AS difference
         FROM open_items FULL OUTER JOIN control ON control.currency = open_items.currency
        WHERE COALESCE(open_items.total, 0) <> COALESCE(control.total, 0)
        ORDER BY 1`, [authorityId]],
    // Each book at the period end, as every statement reads it.
    [
      `SELECT b.currency, (sum(b.net_debit) = 0) AS balances,
              sum(b.net_debit)::numeric(18,2)::text AS difference
         FROM finance.ledger_balances($1, $2::date, 'after') b
        GROUP BY b.currency ORDER BY b.currency`, [yearId, period.to_date]],
  ])

  return assembleReadiness(period, {
    counts: counts.rows[0],
    depreciation: depreciation.rows,
    unreconciled: unreconciled.rows,
    debtors: debtors.rows,
    creditors: creditors.rows,
    books: books.rows,
    asAt: today.rows[0].d,
  })
}

/**
 * What a year's closing state is, per book, read the one way every caller uses (the period PATCH,
 * the periods list's refusals, and the year-end read's `to_close`), so they cannot drift:
 *   unclosedBooks          currencies with a revenue or expense ACCOUNT not nil in the year (per
 *                          account, after every closing so far): a book that still has something
 *                          to close, whether never closed or a remainder after a closing
 *   standingClosings       [{ currency, voucher_no }] posted closings no posted reversal has undone
 *   closingReversalPending a draft reversal of a closing of this year is waiting to be posted
 * `db` is a pool or a client inside a transaction; every read names the authority.
 */
async function yearFacts(db, yearId, authorityId) {
  const { rows: unclosed } = await db.query(
    `SELECT DISTINCT r.currency FROM (
       SELECT e.currency::text AS currency
         FROM finance.ledger_entry e
         JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.financial_year_id = $1 AND e.authority_id = $2 AND la.root_type IN ('revenue', 'expense')
        GROUP BY e.currency, e.ledger_account_id
       HAVING sum(e.debit) <> sum(e.credit)) r
     ORDER BY 1`, [yearId, authorityId])
  const { rows: standing } = await db.query(
    `SELECT c.currency::text AS currency, c.voucher_no
       FROM finance.voucher c
      WHERE c.financial_year_id = $1 AND c.authority_id = $2 AND c.voucher_type = 'closing'
        AND c.status = 'posted'
        AND NOT EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = c.id AND r.status = 'posted')
      ORDER BY c.currency, c.posted_at, c.voucher_no`, [yearId, authorityId])
  const { rows: [pending] } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM finance.voucher r
         JOIN finance.voucher c ON c.id = r.reverses_voucher_id
        WHERE r.voucher_type = 'reversal' AND r.status = 'draft' AND r.authority_id = $2
          AND c.voucher_type = 'closing' AND c.financial_year_id = $1 AND c.authority_id = $2) AS pending`,
    [yearId, authorityId])
  return {
    unclosedBooks: unclosed.map((r) => r.currency),
    standingClosings: standing,
    closingReversalPending: pending.pending,
  }
}

/**
 * The people who may post a closing voucher raised by `excludeId`: active staff of this council
 * whose effective permissions (role, grant overrides, less deny overrides, expired overrides
 * ignored: finance.resolve_effective_permissions, migration 200) hold finance.ledger.voucher.post.
 * The users table carries no row-level security, so the council is named here (security audit C2).
 */
const POSTERS_SELECT = `
  SELECT u.id, COALESCE(u.full_name, u.name) AS name
    FROM public.users u
   WHERE u.authority_id = $1 AND u.id <> $2
     -- Nor whoever prepared a closing of the year that is waiting: they cannot post it (review M6).
     AND NOT EXISTS (SELECT 1 FROM finance.voucher c
                      WHERE c.financial_year_id = $3 AND c.authority_id = $1 AND c.voucher_type = 'closing'
                        AND c.status = 'draft' AND c.prepared_by = u.id)
     AND COALESCE(u.active, true) AND COALESCE(u.status, 'active') = 'active'
     AND EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(u.id) e
                  WHERE e.permission_code = 'finance.ledger.voucher.post')
   ORDER BY 2, 1`

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
      // Each book as every statement reads it, as at today (or the year end): does it balance?
      const { rows: books } = await pg.query(
        `SELECT b.currency, (sum(b.net_debit) = 0) AS balances, sum(b.net_debit)::numeric(18,2)::text AS difference
           FROM finance.ledger_balances($1, LEAST(CURRENT_DATE, $2::date), 'after') b
          GROUP BY b.currency ORDER BY b.currency`, [year.id, year.end_date])

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
        books,
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

  /**
   * A party's statement of account in ONE book: what it brought forward, its entries on the
   * control accounts of one kind with a running balance, what it carries forward, and its open
   * items as at today.
   *
   *  - `kind=receivable` (default) reads accounts typed `receivable` and open items from
   *    finance.v_debtor_ageing; `kind=payable` reads accounts typed `payable` and open items from
   *    finance.v_creditor_open.
   *  - A control account is a balance-sheet account, so the statement is not bounded by a financial
   *    year. With no `from` nothing is brought forward and the entries start at the first; with no
   *    `to` they run to the last posted.
   *  - The running balance is a window sum over the WHOLE range, ordered posting_date, posted_at, id
   *    (the account ledger's rule), signed debit-positive with its side. There is no paging; a
   *    range holding more than STATEMENT_LINE_CAP entries is refused (413) and the reader is asked
   *    to narrow the dates.
   *  - Open items are the party's in this book and of this kind with something still open (an
   *    unallocated receipt carries a negative figure), aged as at `as_at`, which is today. They do
   *    not follow `from`/`to`.
   *
   * Every figure is NUMERIC text from Postgres. Tenancy: the scoped connection, and every table
   * read names the caller's authority explicitly.
   */
  fastify.get('/finance/accounting/party-statement/:partyId', {
    ...canView,
    schema: {
      params: { type: 'object', required: ['partyId'], properties: { partyId: uuid } },
      querystring: {
        type: 'object', required: ['currency'], additionalProperties: false,
        properties: {
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          kind: { type: 'string', enum: ['receivable', 'payable'], default: 'receivable' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const from = q.from || null
    const to = q.to || null
    // ISO dates compare as text; this is a date, not an amount.
    if (from && to && from > to) {
      return fail(reply, 400, 'bad_range', `The range starts on ${from}, after it ends on ${to}.`)
    }
    try {
      const { rows: found } = await pg.query(
        `SELECT p.id, p.name, p.reference, p.party_type, p.address_text, CURRENT_DATE::text AS as_at
           FROM finance.party p
          WHERE p.id = $1 AND p.authority_id = $2 AND p.deleted_at IS NULL`,
        [request.params.partyId, authorityId],
      )
      if (!found[0]) return fail(reply, 404, 'not_found', 'No such party.')
      const { as_at: asAt, ...party } = found[0]

      // $1 party, $2 currency, $3 authority, $4 account type, $5 from (or null), $6 to (or null).
      const ranged = `
        WITH scope AS (
          SELECT e.id, e.voucher_id, e.voucher_no, e.voucher_type, e.posting_date, e.narration,
                 e.party_id, e.debit, e.credit, e.posted_at, la.code AS account_code
            FROM finance.ledger_entry e
            JOIN finance.ledger_account la ON la.id = e.ledger_account_id
           WHERE e.party_id = $1 AND e.currency::text = $2 AND e.authority_id = $3
             AND la.authority_id = $3 AND la.account_type = $4
        ),
        bf AS (
          SELECT COALESCE(sum(s.debit - s.credit), 0)::numeric AS net
            FROM scope s WHERE $5::date IS NOT NULL AND s.posting_date < $5::date
        ),
        ranged AS (
          SELECT s.*,
                 row_number() OVER w AS seq,
                 (SELECT net FROM bf) + sum(s.debit - s.credit) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
            FROM scope s
           WHERE ($5::date IS NULL OR s.posting_date >= $5::date)
             AND ($6::date IS NULL OR s.posting_date <= $6::date)
          WINDOW w AS (ORDER BY s.posting_date, s.posted_at, s.id)
        )`
      const base = [party.id, q.currency, authorityId, q.kind, from, to]

      const { rows: [summary] } = await pg.query(
        `${ranged}
         SELECT count(*)::int AS total,
                ${balSql('(SELECT net FROM bf)')} AS brought_forward,
                ${balSql('(SELECT net FROM bf) + COALESCE(sum(r.debit - r.credit), 0)')} AS carried_forward
           FROM ranged r`, base,
      )
      if (summary.total > STATEMENT_LINE_CAP) {
        return fail(reply, 413, 'too_large',
          `This statement holds ${summary.total} entries, more than the ${STATEMENT_LINE_CAP} one statement carries. `
          + 'Narrow the dates and read it in parts.')
      }

      const [{ rows: entries }, { rows: openItems }] = await Promise.all([
        pg.query(
          `${ranged}
           SELECT r.id, r.voucher_id, r.voucher_no, r.voucher_type, r.posting_date::text AS posting_date,
                  r.narration, r.party_id, p.name AS party_name,
                  r.debit::numeric(18,2)::text AS debit, r.credit::numeric(18,2)::text AS credit,
                  ${balSql('r.running')} AS balance,
                  NULL::boolean AS reconciled,
                  r.account_code
             FROM ranged r
             LEFT JOIN finance.party p ON p.id = r.party_id
            ORDER BY r.seq`, base,
        ),
        pg.query(q.kind === 'payable' ? CREDITOR_ITEMS : DEBTOR_ITEMS, [party.id, q.currency, authorityId]),
      ])

      return ok(reply, {
        party,
        currency: q.currency,
        kind: q.kind,
        brought_forward: summary.brought_forward,
        entries,
        carried_forward: summary.carried_forward,
        open_items: openItems,
        as_at: asAt,
      })
    } catch (err) {
      fastify.log.error({ err }, 'party statement')
      return fail(reply, 500, 'accounting_error', 'The statement could not be read.')
    }
  })

  /**
   * What stands in the way of closing one accounting period: each check a count from the data and
   * a route to clear it, and each book's balance at the period end. It informs; it does not refuse.
   * Closing a period that is not ready is allowed, and the period PATCH writes what was outstanding
   * into its audit row (spec §6.7).
   */
  fastify.get('/finance/accounting/period-readiness', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['period_id'], additionalProperties: false,
        properties: { period_id: uuid },
      },
    },
  }, async (request, reply) => {
    try {
      const readiness = await periodReadiness(pg, request.query.period_id, request.user.authority_id)
      if (!readiness) return fail(reply, 404, 'not_found', 'No such accounting period.')
      return ok(reply, readiness)
    } catch (err) {
      // The list informs; a failed read says so in words rather than as a server fault (review M3).
      fastify.log.error({ err }, 'period readiness')
      return fail(reply, 503, 'readiness_unavailable',
        'The readiness of the period could not be read just now. Try again; the period can still be closed.')
    }
  })

  /**
   * The year end of one financial year, per book.
   *
   *  - `periods_open`: periods still open. The close is raised only when it is 0.
   *  - Each book (a currency with an entry in the year, or a closing voucher): `closed` when a
   *    posted closing stands (no posted reversal of it) AND no revenue or expense balance is left.
   *    Not closed, the figures are what the next close will transfer: the year's revenue and
   *    expenditure after every closing so far, so a remainder left by a late posting shows as the
   *    remainder (accounting audit M6). Closed, they are the whole year's, before closing.
   *    `surplus` is the absolute amount and `side` says which it is. `closing_voucher` is the
   *    closing that stands, `pending_closing` a closing raised and waiting to be posted.
   *  - `surplus_account`: the account a close credits or debits, this council's.
   *  - `posters`: who may post a closing the caller raises (never the caller): active staff of
   *    this council whose effective permissions hold finance.ledger.voucher.post (security audit
   *    C2). Nobody is named on the close any more; the closing is a draft any of them posts.
   */
  fastify.get('/finance/accounting/year-end', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const authorityId = request.user.authority_id
    const yearId = request.query.financial_year_id
    try {
      const { rows: found } = await pg.query(
        `SELECT fy.id, fy.label, fy.start_date::text AS start_date, fy.end_date::text AS end_date, fy.status
           FROM finance.financial_year fy
          WHERE fy.id = $1 AND fy.authority_id = $2 AND fy.deleted_at IS NULL`, [yearId, authorityId])
      if (!found[0]) return fail(reply, 404, 'not_found', 'No such financial year.')

      const [periods, books, surplus, posters] = await Promise.all([
        pg.query(
          `SELECT count(*) FILTER (WHERE lp.status = 'open')::int AS open
             FROM finance.ledger_period lp
            WHERE lp.financial_year_id = $1 AND lp.authority_id = $2`, [yearId, authorityId]),
        pg.query(
          `WITH before_close AS (
             SELECT b.currency, count(*)::int AS accounts,
                    COALESCE(-sum(b.net_debit) FILTER (WHERE b.root_type = 'revenue'), 0) AS revenue,
                    COALESCE(sum(b.net_debit) FILTER (WHERE b.root_type = 'expense'), 0) AS expenditure
               FROM finance.ledger_balances($1, NULL, 'before') b
              WHERE b.root_type IN ('revenue', 'expense') GROUP BY b.currency
           ), after_close AS (
             SELECT b.currency, count(*)::int AS accounts,
                    COALESCE(-sum(b.net_debit) FILTER (WHERE b.root_type = 'revenue'), 0) AS revenue,
                    COALESCE(sum(b.net_debit) FILTER (WHERE b.root_type = 'expense'), 0) AS expenditure
               FROM finance.ledger_balances($1, NULL, 'after') b
              WHERE b.root_type IN ('revenue', 'expense') GROUP BY b.currency
           ), book AS (
             SELECT e.currency::text AS currency FROM finance.ledger_entry e
              WHERE e.financial_year_id = $1 AND e.authority_id = $2
             UNION
             SELECT c.currency::text FROM finance.voucher c
              WHERE c.financial_year_id = $1 AND c.authority_id = $2 AND c.voucher_type = 'closing'
                AND c.status IN ('draft', 'posted')
           ), standing AS (
             SELECT DISTINCT ON (c.currency) c.currency::text AS currency, c.id, c.voucher_no
               FROM finance.voucher c
              WHERE c.financial_year_id = $1 AND c.authority_id = $2 AND c.voucher_type = 'closing'
                AND c.status = 'posted'
                AND NOT EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = c.id AND r.status = 'posted')
              ORDER BY c.currency, c.posted_at DESC, c.id DESC
           ), pending AS (
             SELECT DISTINCT ON (c.currency) c.currency::text AS currency, c.id, c.voucher_no,
                    COALESCE(u.full_name, u.name) AS prepared_by_name
               FROM finance.voucher c
               LEFT JOIN public.users u ON u.id = c.prepared_by
              WHERE c.financial_year_id = $1 AND c.authority_id = $2 AND c.voucher_type = 'closing'
                AND c.status = 'draft'
              ORDER BY c.currency, c.created_at DESC, c.id DESC
           ), figures AS (
             SELECT k.currency, s.id AS standing_id, s.voucher_no AS standing_no,
                    pd.id AS pending_id, pd.voucher_no AS pending_no, pd.prepared_by_name,
                    (s.id IS NOT NULL AND COALESCE(a.accounts, 0) = 0) AS closed,
                    COALESCE(b.revenue, 0) AS revenue_before, COALESCE(b.expenditure, 0) AS expenditure_before,
                    COALESCE(a.revenue, 0) AS revenue_after, COALESCE(a.expenditure, 0) AS expenditure_after
               FROM book k
               LEFT JOIN before_close b ON b.currency = k.currency
               LEFT JOIN after_close a ON a.currency = k.currency
               LEFT JOIN standing s ON s.currency = k.currency
               LEFT JOIN pending pd ON pd.currency = k.currency
           ), chosen AS (
             SELECT f.*,
                    CASE WHEN f.closed THEN f.revenue_before ELSE f.revenue_after END AS revenue,
                    CASE WHEN f.closed THEN f.expenditure_before ELSE f.expenditure_after END AS expenditure
               FROM figures f
           )
           SELECT c.currency, c.closed,
                  c.revenue::numeric(18,2)::text AS revenue,
                  c.expenditure::numeric(18,2)::text AS expenditure,
                  abs(c.revenue - c.expenditure)::numeric(18,2)::text AS surplus,
                  CASE WHEN c.revenue >= c.expenditure THEN 'surplus' ELSE 'deficit' END AS side,
                  CASE WHEN c.standing_id IS NULL THEN NULL
                       ELSE json_build_object('id', c.standing_id, 'voucher_no', c.standing_no) END AS closing_voucher,
                  CASE WHEN c.pending_id IS NULL THEN NULL
                       ELSE json_build_object('id', c.pending_id, 'voucher_no', c.pending_no,
                                              'prepared_by_name', c.prepared_by_name) END AS pending_closing
             FROM chosen c
            ORDER BY c.currency`, [yearId, authorityId]),
        pg.query(
          `SELECT la.id, la.code, la.name FROM finance.ledger_account la
            WHERE la.authority_id = $1 AND la.account_type = 'accumulated_surplus' AND la.deleted_at IS NULL
              AND la.is_postable AND NOT la.is_group AND la.status = 'active'
            ORDER BY la.code LIMIT 1`, [authorityId]),
        pg.query(POSTERS_SELECT, [authorityId, request.user.id, yearId]),
      ])

      // `to_close`: the lock guard's own per-account test (yearFacts), so the two cannot disagree.
      const facts = await yearFacts(pg, yearId, authorityId)
      return ok(reply, {
        year: found[0],
        periods_open: periods.rows[0].open,
        books: books.rows.map((b) => ({ ...b, to_close: facts.unclosedBooks.includes(b.currency) })),
        surplus_account: surplus.rows[0] || null,
        posters: posters.rows,
      })
    } catch (err) {
      fastify.log.error({ err }, 'year end')
      return fail(reply, 500, 'accounting_error', 'The year-end position could not be read.')
    }
  })

  /**
   * Tax control: every account typed `tax`, its balance per book as at the year end, and its
   * debits and credits per period of the year, plus the bank accounts a payment to the tax
   * authority can be made from. It reads the ledger as it stands and produces no statutory return.
   */
  fastify.get('/finance/accounting/tax', {
    ...canView,
    schema: { querystring: { type: 'object', properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    const authorityId = request.user.authority_id
    try {
      const year = await yearOf(request.query.financial_year_id)
      if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')
      const [accounts, periods, movements, banks, parties, periodBalances] = await Promise.all([
        pg.query(
          `SELECT la.id, la.code, la.name, la.root_type,
                  COALESCE((SELECT json_agg(json_build_object(
                             'currency', b.currency,
                             'net_debit', b.net::numeric(18,2)::text,
                             'amount', abs(b.net)::numeric(18,2)::text,
                             'side', CASE WHEN b.net < 0 THEN 'Cr' ELSE 'Dr' END) ORDER BY b.currency)
                      FROM (SELECT e.currency::text AS currency, sum(e.debit - e.credit) AS net
                              FROM finance.ledger_entry e
                             WHERE e.ledger_account_id = la.id AND e.authority_id = $1 AND e.posting_date <= $2::date
                             GROUP BY e.currency HAVING sum(e.debit - e.credit) <> 0) b), '[]'::json) AS balances
             FROM finance.ledger_account la
            WHERE la.authority_id = $1 AND la.account_type = 'tax' AND la.deleted_at IS NULL AND NOT la.is_group
            ORDER BY la.code, la.id`, [authorityId, year.end_date]),
        pg.query(
          `SELECT p.id AS period_id, p.period_no, p.label, p.from_date::text AS from_date, p.to_date::text AS to_date
             FROM finance.ledger_period p
            WHERE p.financial_year_id = $1 AND p.authority_id = $2
            ORDER BY p.period_no`, [year.id, authorityId]),
        pg.query(
          `SELECT e.ledger_account_id, e.currency::text AS currency, e.ledger_period_id AS period_id,
                  sum(e.debit)::numeric(18,2)::text AS debit, sum(e.credit)::numeric(18,2)::text AS credit
             FROM finance.ledger_entry e
             JOIN finance.ledger_account la ON la.id = e.ledger_account_id
            WHERE e.authority_id = $1 AND e.financial_year_id = $2 AND la.account_type = 'tax'
            GROUP BY e.ledger_account_id, e.currency, e.ledger_period_id`, [authorityId, year.id]),
        pg.query(
          `SELECT la.id, la.code, la.name FROM finance.ledger_account la
            WHERE la.authority_id = $1 AND la.account_type = 'bank' AND la.deleted_at IS NULL
              AND la.is_postable AND NOT la.is_group AND la.status = 'active'
            ORDER BY la.code`, [authorityId]),
        // Who the tax accounts say the council owes: the party named on each control account's
        // entries (ZIMRA on PAYE and VAT, NSSA on its contributions), per book, as at the year's
        // end. A credit balance is owed; a debit is paid ahead.
        pg.query(
          `SELECT p.id AS party_id, p.name, p.party_type, e.ledger_account_id, e.currency::text AS currency,
                  (sum(e.debit) - sum(e.credit))::numeric(18,2)::text AS net_debit,
                  abs(sum(e.debit) - sum(e.credit))::numeric(18,2)::text AS amount,
                  CASE WHEN sum(e.debit) - sum(e.credit) < 0 THEN 'Cr' ELSE 'Dr' END AS side
             FROM finance.ledger_entry e
             JOIN finance.ledger_account la ON la.id = e.ledger_account_id
             JOIN finance.party p ON p.id = e.party_id
            WHERE e.authority_id = $1 AND la.account_type = 'tax' AND e.posting_date <= $2::date
            GROUP BY p.id, p.name, p.party_type, e.ledger_account_id, e.currency
           HAVING sum(e.debit) - sum(e.credit) <> 0
            ORDER BY p.name, e.currency`, [authorityId, year.end_date]),
        // Each control account's closing balance at every period end, in the books it holds. The
        // balance is computed as at the period's own end date, so it stands on entries of every
        // year before it, not only this one's.
        pg.query(
          `SELECT la.id AS ledger_account_id, e.currency::text AS currency, lp.id AS period_id, lp.period_no,
                  COALESCE((SELECT sum(x.debit - x.credit)
                              FROM finance.ledger_entry x
                             WHERE x.ledger_account_id = la.id AND x.currency = e.currency
                               AND x.authority_id = $1 AND x.posting_date <= lp.to_date), 0)::numeric(18,2)::text AS closing,
                  CASE WHEN COALESCE((SELECT sum(x.debit - x.credit)
                                        FROM finance.ledger_entry x
                                       WHERE x.ledger_account_id = la.id AND x.currency = e.currency
                                         AND x.authority_id = $1 AND x.posting_date <= lp.to_date), 0) < 0
                       THEN 'Cr' ELSE 'Dr' END AS side
             FROM finance.ledger_account la
             JOIN LATERAL (SELECT DISTINCT e2.currency FROM finance.ledger_entry e2
                            WHERE e2.ledger_account_id = la.id AND e2.authority_id = $1) e ON true
             CROSS JOIN finance.ledger_period lp
            WHERE la.authority_id = $1 AND la.account_type = 'tax' AND la.deleted_at IS NULL AND NOT la.is_group
              AND lp.financial_year_id = $2 AND lp.authority_id = $1
            ORDER BY la.code, e.currency, lp.period_no`, [authorityId, year.id]),
      ])
      return ok(reply, {
        accounts: accounts.rows,
        periods: periods.rows,
        movements: movements.rows,
        bank_accounts: banks.rows,
        parties: parties.rows,
        period_balances: periodBalances.rows,
        note: 'This page reads the tax accounts as the ledger holds them. It produces no statutory return.',
      })
    } catch (err) {
      fastify.log.error({ err }, 'tax control')
      return fail(reply, 500, 'accounting_error', 'The tax accounts could not be read.')
    }
  })

  /**
   * The vote book: budget control as the accountant reads it at the desk. Every figure comes from
   * finance.v_budget_line_performance — the same view the budget officer's dashboard and every
   * budget report read — so the three cannot disagree. Spending is the EXPENDITURE lines; revenue
   * lines are budgeted income and are summarised apart, by the class the chart gives them
   * (internally generated, grant, transfer). One row per currency throughout (D4); nothing is
   * combined or converted.
   */
  fastify.get('/finance/accounting/vote-book', {
    preHandler: requirePermission(fastify, 'finance.budget.view'),
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    try {
      const year = await yearOf(request.query.financial_year_id)
      if (!year) return fail(reply, 404, 'no_year', 'No open financial year contains today. Choose a year.')
      const live = `p.financial_year_id = $1 AND p.status IN ('approved', 'published')`
      const spend = `${live} AND p.account_kind = 'expenditure'`
      const pct = (part, whole) => `CASE WHEN COALESCE(sum(${whole}), 0) > 0 THEN round(sum(${part}) * 100 / sum(${whole}), 1)::text END`
      const [totals, votes, overLines, revenue, unapproved] = await Promise.all([
        pg.query(
          `SELECT p.currency,
                  COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                  COALESCE(sum(p.open_commitments), 0)::numeric(18,2)::text AS committed,
                  COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                  COALESCE(sum(p.available_including_commitments), 0)::numeric(18,2)::text AS available,
                  ${pct('p.actual_amount', 'p.revised_amount')} AS utilisation,
                  ${pct('p.actual_amount + p.open_commitments', 'p.revised_amount')} AS committed_utilisation
             FROM finance.v_budget_line_performance p WHERE ${spend}
            GROUP BY p.currency ORDER BY p.currency`, [year.id]),
        pg.query(
          `SELECT p.currency, d.code, d.name, d.vote_number,
                  COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                  COALESCE(sum(p.open_commitments), 0)::numeric(18,2)::text AS committed,
                  COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                  COALESCE(sum(p.available_including_commitments), 0)::numeric(18,2)::text AS available,
                  (COALESCE(sum(p.revised_amount), 0) - COALESCE(sum(p.actual_amount), 0))::numeric(18,2)::text AS variance,
                  ${pct('p.actual_amount', 'p.revised_amount')} AS utilisation,
                  ${pct('p.actual_amount + p.open_commitments', 'p.revised_amount')} AS committed_utilisation
             FROM finance.v_budget_line_performance p
             JOIN finance.department d ON d.id = p.department_id
            WHERE ${spend}
            GROUP BY p.currency, d.code, d.name, d.vote_number
            ORDER BY p.currency, sum(p.revised_amount) DESC`, [year.id]),
        pg.query(
          `SELECT p.currency, d.code AS department_code, d.name AS department_name,
                  p.code AS line_code, p.description AS line_description,
                  p.revised_amount::numeric(18,2)::text AS budget,
                  p.actual_amount::numeric(18,2)::text AS spent,
                  p.open_commitments::numeric(18,2)::text AS committed,
                  (p.actual_amount + p.open_commitments - p.revised_amount)::numeric(18,2)::text AS over_by
             FROM finance.v_budget_line_performance p
             JOIN finance.department d ON d.id = p.department_id
            WHERE ${spend} AND p.actual_amount + p.open_commitments > p.revised_amount
            ORDER BY p.currency, (p.actual_amount + p.open_commitments - p.revised_amount) DESC
            LIMIT 100`, [year.id]),
        pg.query(
          `SELECT p.currency,
                  COALESCE(a.revenue_class, 'other') AS revenue_class,
                  COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                  COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                  (COALESCE(sum(p.actual_amount), 0) - COALESCE(sum(p.revised_amount), 0))::numeric(18,2)::text AS variance
             FROM finance.v_budget_line_performance p
             JOIN finance.account a ON a.id = p.account_id
            WHERE ${live} AND p.account_kind = 'revenue'
            GROUP BY p.currency, COALESCE(a.revenue_class, 'other')
            ORDER BY p.currency, sum(p.revised_amount) DESC`, [year.id]),
        // Lines not yet approved or published are not controlled yet; the page says how many, not
        // lists them, so it stays a control read rather than a budget-working document.
        pg.query(
          `SELECT count(*)::int AS n FROM finance.budget_line
            WHERE financial_year_id = $1 AND deleted_at IS NULL AND status NOT IN ('approved', 'published')`, [year.id]),
      ])
      return ok(reply, {
        year,
        totals: totals.rows,
        votes: votes.rows,
        over_budget: overLines.rows,
        revenue: revenue.rows,
        lines_not_yet_approved: unapproved.rows[0].n,
      })
    } catch (err) {
      fastify.log.error({ err }, 'vote book')
      return fail(reply, 500, 'accounting_error', 'The vote book could not be read.')
    }
  })
}

module.exports = {
  financeAccountingRoutes,
  STATEMENT_LINE_CAP,
  // For the period PATCH (finance-ledger.js), which writes what was outstanding into its audit row.
  periodReadiness,
  outstandingOf,
  yearFacts,
  // Exported for test/finance-ledger.test.js (no database).
  READINESS_CHECKS,
  assembleReadiness,
}
