/**
 * The staff transaction register: the council's own view of every imported actual.
 *
 * Tables and views: finance.transaction, finance.account, finance.department, finance.programme,
 * finance.activity, finance.budget_line, finance.project_transaction, finance.project,
 * finance.import_batch, finance.document, finance.v_budget_line_performance (migration 188).
 *
 * WHY THIS FILE EXISTS AT ALL
 * `finance.transaction.view` has been a granted permission since migration 188 (`188:1065`, held
 * by finance_admin, finance_officer, finance_committee and auditor) with no endpoint behind it, and
 * src/middleware/auditLog.js:92 has carried the rule `{ match: '/finance/transactions', event:
 * 'FIN_TRANSACTION', severity: 'high' }` for a route that did not exist. Meanwhile
 * src/routes/finance-public.js:372 lets any ratepayer page through the published register. So the
 * public could browse the council's transactions and the council's own Director of Finance could
 * not. That is audit GAP-1, a blocker, and this closes it.
 *
 * WHY A REGISTER AND NOT A REPORT (design decision A1)
 * A register browses: it filters, paginates and states its total. A report builds an artefact and
 * states its cut-off. Conflating the two is how `transaction_register` in
 * src/routes/finance-reports.js:330 acquired a silent `LIMIT 100000` — a figure that is wrong above
 * that row count and says nothing about it. This route paginates with a hard maximum of 200 rows a
 * page and reports `total` for the whole filtered set, so a page is never mistaken for the set.
 *
 * WHAT `reversals=exclude` MEANS, AND WHY IT IS THE DEFAULT
 * A correction in this system is never an edit in place (migration 188:614): it is a reversal row
 * carrying the signed opposite of the row it corrects (`reverses_id`), and a replacement row
 * carrying the right figure. All three stay in the register for good. So the register contains, for
 * one corrected payment: the original (+100), its reversal (−100), and the replacement (+120).
 *
 * AMOUNTS ARE SIGNED, which is the fact the whole design turns on. A reversal is a NEGATIVE amount,
 * not a positive one with a flag, which is why migration 188:794 can say of
 * finance.v_budget_line_performance that "a plain SUM is already net of corrections". It is
 * observable on this council's own data: budget line DD-L02 carries nine postings of 38 000 and one
 * reversal of −38 000, and the view reports an actual of 304 000.
 *
 *   `exclude` (default) drops BOTH halves of every cancelled pair — the reversal row and the row it
 *             reverses — and keeps everything else. What is left is the live register: each
 *             transaction that still stands, once. Because a reversal is the exact signed opposite
 *             of its target, the SQL total over this set is IDENTICAL to the total over `all`, over
 *             a different number of rows; the pair contributed nothing but two rows a reader has to
 *             cancel mentally. That is the point: the figure is unchanged and the rows now support
 *             it. Dropping the reversal alone — the obvious reading of "exclude reversals" — would
 *             keep the +100 whose −100 had gone and OVERSTATE the total by the corrected amount.
 *             That is the specific mistake this mode exists to make impossible, and the unit test
 *             pins both halves of it.
 *   `only`    keeps exactly the complement — the reversal rows and the rows they reverse, and
 *             nothing else. This is the corrections audit: a total near zero is the expected
 *             result, and a total that is NOT near zero means a reversal does not match what it
 *             reverses, which is a fault worth finding.
 *   `all`     keeps every row. Honest, and the only mode in which a hand-count of the rows on
 *             screen reconciles to the source system row for row.
 *
 * The two non-trivial fragments are exact complements of each other, so `exclude` and `only`
 * partition `all` — no row is in both, and none is in neither. `reversalFilter()` below is exported
 * and unit-tested for precisely that (test/finance-transaction-register.test.js).
 *
 * Every response ECHOES the mode it used, because a total over a register of corrections cannot be
 * read without knowing which of the three produced it. The frontend states it in words beside the
 * figures rather than leaving it to a dropdown the reader may not have looked at.
 *
 * TOTALS ARE PER CURRENCY AND PER ACCOUNT KIND, COMPUTED IN SQL (decisions A5 / D4)
 * `sum()` runs over NUMERIC in Postgres and arrives as a decimal string; no amount is parsed into a
 * JavaScript number anywhere in this file. The grouping is `currency, account_kind`, so there is no
 * row that adds USD to ZWG and none that adds revenue to expenditure. The council has approved no
 * conversion basis (decision D4) and a combined figure would be invented. The totals describe the
 * WHOLE filtered set, not the page on screen.
 *
 * COUNTERPARTY COLUMNS ARE PRESENT OR ABSENT, NEVER BLANK (decision A2)
 * `counterparty_ref` and `counterparty_name` are selected only for a caller holding
 * `finance.transaction.view_counterparty`, the same way src/routes/finance-projects.js:172 does it.
 * They are left out of the SELECT list rather than nulled, so a blank supplier cell can never be
 * read as "no supplier was recorded". `counterparty_visible` says which of the two happened and the
 * screen explains the absence in a sentence.
 *
 * DEPARTMENT SCOPE IS NAMED, NOT SILENT (decision A7)
 * `departmentScope` confines a departmental head to their own votes. The response returns
 * `scope_applied` — null for a caller who is not confined, the department CODES otherwise — so a
 * narrowed total is never presented as a council-wide one. Codes rather than ids because the field
 * exists to be READ: it is the sentence that tells someone which votes a figure covers, and a
 * uuid tells them nothing. src/routes/finance-overview.js names the scope the same way, so the two
 * `scope_applied` fields carry the same kind of value.
 *
 * TWO THINGS THIS MODULE DELIBERATELY DOES NOT DO
 *
 * 1. It does not write. A transaction arrives through the import pipeline
 *    (src/routes/finance-imports.js) with its batch, its file hash and its source reference, or it
 *    does not arrive. There is no POST, PATCH or DELETE here, because a register an officer can
 *    type into is not a register.
 * 2. It returns no field the frontend contract does not declare. The row shape is exactly
 *    `FinanceTransaction` in src/modules/finance/models/types.ts:433, plus the two counterparty
 *    columns when permitted. Extra columns would be dead weight that the next reader has to decide
 *    whether to trust.
 */

const { requirePermission, departmentScope, hasPermission } = require('../middleware/financePermissions')
const { dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

const REVERSAL_MODES = ['exclude', 'only', 'all']

/**
 * Is there a row in the register that reverses this one? Written once, because `exclude` and `only`
 * must agree about it exactly or a row would fall into both modes or into neither.
 *
 * A soft-deleted reversal does not count: a withdrawn correction leaves the original standing.
 */
const REVERSED_BY_SOMETHING = `EXISTS (
        SELECT 1 FROM finance.transaction rev
         WHERE rev.reverses_id = t.id AND rev.deleted_at IS NULL)`

/**
 * The WHERE fragment for one reversal mode. PURE: it takes no caller value and interpolates none,
 * so it is a constant string per mode and safe to concatenate into SQL (house rule 4 — the mode
 * itself is whitelisted by the Fastify enum and again here).
 *
 * `t` must be the alias of finance.transaction in the surrounding query.
 */
function reversalFilter(mode) {
  if (mode === 'all') return 'TRUE'
  if (mode === 'only') return `(t.reverses_id IS NOT NULL OR ${REVERSED_BY_SOMETHING})`
  // 'exclude', and anything unrecognised: the safe default is the live register.
  return `(t.reverses_id IS NULL AND NOT ${REVERSED_BY_SOMETHING})`
}

/**
 * Sortable columns, by the key the client is allowed to send. A sort key is never interpolated from
 * the query: it is looked up here, and an absent key falls back to the transaction date (house
 * rule 4). The tie-break on `t.id` is what makes pagination stable — without it two pages can show
 * the same row or skip one when several transactions share a date.
 */
const SORT_COLUMNS = {
  txn_date: 't.txn_date',
  amount: 't.amount',
  account_code: 'a.code',
  department_code: 'd.code',
}

/** The ORDER BY clause for a sort key and a direction, both whitelisted. PURE. */
function orderBy(sort, direction) {
  const column = SORT_COLUMNS[sort] || SORT_COLUMNS.txn_date
  const dir = direction === 'asc' ? 'ASC' : 'DESC'
  return `${column} ${dir}, t.id`
}

/**
 * The row shape, which is `FinanceTransaction` and nothing more.
 * `txn_date` is a DATE column and is returned as text (house rule 6), so a timezone cannot move a
 * transaction to the previous day on its way to the browser.
 */
function transactionColumns(showCounterparty) {
  return `t.id, ${dateText('t', 'txn_date')}, t.amount, t.currency, t.description, t.reference,
          t.record_type, t.source_system, t.source_ref, t.import_batch_id,
          a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
          d.code AS department_code, d.name AS department_name
          ${showCounterparty ? ', t.counterparty_ref, t.counterparty_name' : ''}`
}

async function financeTransactionRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.transaction.view') }

  /**
   * The departments this answer was confined to, named rather than identified.
   *
   * `departmentScope()` returns department ids, or null for "not confined"
   * (src/middleware/financePermissions.js:89-101). `scope_applied` publishes the CODES, because
   * the field is read by a person deciding whether a total is council-wide. Kept identical to
   * `scopeApplied()` in src/routes/finance-overview.js on purpose.
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

  /**
   * The register. One page of transactions, the total for the filtered set, and that set's totals
   * grouped by currency and kind.
   */
  fastify.get('/finance/transactions', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          department_id: uuid,
          account_id: uuid,
          programme_id: uuid,
          activity_id: uuid,
          budget_line_id: uuid,
          project_id: uuid,
          ward_code: { type: 'string', maxLength: 24 },
          kind: { type: 'string', enum: ['revenue', 'expenditure'] },
          expenditure_class: { type: 'string', enum: ['recurrent', 'capital'] },
          revenue_class: { type: 'string', enum: ['internally_generated', 'grant', 'transfer', 'other'] },
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          from: isoDate,
          to: isoDate,
          q: { type: 'string', maxLength: 200 },
          source_system: { type: 'string', maxLength: 120 },
          import_batch_id: uuid,
          reversals: { type: 'string', enum: REVERSAL_MODES, default: 'exclude' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: Object.keys(SORT_COLUMNS), default: 'txn_date' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const mode = REVERSAL_MODES.includes(q.reversals) ? q.reversals : 'exclude'
    const scope = await departmentScope(fastify, request)
    const showCounterparty = await hasPermission(fastify, request, 'finance.transaction.view_counterparty')

    // One WHERE clause, three queries. The page, the count and the totals must describe the SAME
    // set or the totals belong to a different question than the rows above them.
    const where = `
      WHERE t.financial_year_id = $1
        AND t.deleted_at IS NULL
        AND ($2::uuid IS NULL OR t.department_id = $2::uuid)
        AND ($3::uuid IS NULL OR t.account_id = $3::uuid)
        AND ($4::uuid IS NULL OR t.programme_id = $4::uuid)
        AND ($5::uuid IS NULL OR t.activity_id = $5::uuid)
        AND ($6::uuid IS NULL OR t.budget_line_id = $6::uuid)
        AND ($7::uuid IS NULL OR EXISTS (
              SELECT 1 FROM finance.project_transaction pt
               WHERE pt.transaction_id = t.id AND pt.project_id = $7::uuid
                 AND pt.deleted_at IS NULL))
        AND ($8::text IS NULL OR t.ward_code = $8::text)
        AND ($9::text IS NULL OR a.kind = $9::text)
        AND ($10::text IS NULL OR a.expenditure_class = $10::text)
        AND ($11::text IS NULL OR a.revenue_class = $11::text)
        AND ($12::text IS NULL OR t.currency = $12::text)
        AND ($13::date IS NULL OR t.txn_date >= $13::date)
        AND ($14::date IS NULL OR t.txn_date <= $14::date)
        AND ($15::text IS NULL OR t.description ILIKE $15::text OR t.reference ILIKE $15::text)
        AND ($16::text IS NULL OR t.source_system = $16::text)
        AND ($17::uuid IS NULL OR t.import_batch_id = $17::uuid)
        AND ($18::uuid[] IS NULL OR t.department_id = ANY($18::uuid[]))
        AND ${reversalFilter(mode)}`

    const from = `
      FROM finance.transaction t
      JOIN finance.account a ON a.id = t.account_id
      JOIN finance.department d ON d.id = t.department_id`

    const params = [
      q.financial_year_id, q.department_id || null, q.account_id || null, q.programme_id || null,
      q.activity_id || null, q.budget_line_id || null, q.project_id || null, q.ward_code || null,
      q.kind || null, q.expenditure_class || null, q.revenue_class || null, q.currency || null,
      q.from || null, q.to || null, q.q ? `%${q.q.trim()}%` : null, q.source_system || null,
      q.import_batch_id || null, scope,
    ]

    const [page, count, totals] = await Promise.all([
      pg.query(
        `SELECT ${transactionColumns(showCounterparty)} ${from} ${where}
          ORDER BY ${orderBy(q.sort, q.direction)}
          LIMIT $19 OFFSET $20`, [...params, q.limit, q.offset],
      ),
      pg.query(`SELECT count(*)::int AS total ${from} ${where}`, params),
      // Grouped by currency AND kind, summed in NUMERIC, cast to text so the decimal string
      // arrives intact. Nothing here adds two currencies or two kinds together (A5).
      pg.query(
        `SELECT t.currency::text AS currency,
                a.kind           AS account_kind,
                count(*)::int    AS "rows",
                sum(t.amount)::text AS amount
           ${from} ${where}
          GROUP BY t.currency, a.kind
          ORDER BY t.currency, a.kind`, params,
      ),
    ])

    return ok(reply, {
      transactions: page.rows,
      total: count.rows[0].total,
      limit: q.limit,
      offset: q.offset,
      totals: totals.rows,
      counterparty_visible: showCounterparty,
      scope_applied: await scopeApplied(scope),
      reversals: mode,
    })
  })

  /**
   * One transaction, and everything a director needs to judge it.
   *
   * The reversal pair is given in BOTH directions. "Is this figure still live?" is answered by
   * `reversed_by`; "what did this correct?" is answered by `reverses`. A director holding one row
   * of a correction needs the other end of the pair without paging through the register for it.
   *
   * The import batch carries the original filename and the SHA-256 of the preserved upload
   * (migration 188:302), which is the provenance the whole register rests on: without it an
   * amount is an assertion, and with it the figure can be traced to a file that can be re-read.
   */
  fastify.get('/finance/transactions/:id', {
    ...canView,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const showCounterparty = await hasPermission(fastify, request, 'finance.transaction.view_counterparty')
    const { rows } = await pg.query(
      `SELECT ${transactionColumns(showCounterparty)},
              t.department_id, t.budget_line_id, t.reverses_id
         FROM finance.transaction t
         JOIN finance.account a ON a.id = t.account_id
         JOIN finance.department d ON d.id = t.department_id
        WHERE t.id = $1 AND t.deleted_at IS NULL`, [request.params.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No transaction with that reference.')

    // Scope is checked on the single record too. A departmental head who follows a link to another
    // vote's transaction is refused in words rather than shown it, which is what the register's own
    // filter already promised them (A7).
    const scope = await departmentScope(fastify, request)
    if (scope && !scope.includes(rows[0].department_id)) {
      return fail(reply, 403, 'forbidden',
        'That transaction belongs to a department your access does not cover.')
    }

    const { department_id: _departmentId, budget_line_id: budgetLineId, reverses_id: reversesId, ...transaction } = rows[0]

    const [line, project, documents, batch, reverses, reversedBy] = await Promise.all([
      budgetLineId
        ? pg.query(
          `SELECT p.budget_line_id AS id, p.code, p.description, p.currency,
                  p.revised_amount, p.actual_amount
             FROM finance.v_budget_line_performance p
            WHERE p.budget_line_id = $1`, [budgetLineId],
        )
        : { rows: [] },
      // A transaction may be apportioned across several projects; the register's detail view names
      // the one it belongs to most directly, so a direct association outranks an apportioned share.
      pg.query(
        `SELECT pr.id AS project_id, pr.reference, pr.name
           FROM finance.project_transaction pt
           JOIN finance.project pr ON pr.id = pt.project_id AND pr.deleted_at IS NULL
          WHERE pt.transaction_id = $1 AND pt.deleted_at IS NULL
          ORDER BY (pt.association = 'direct') DESC, pt.created_at
          LIMIT 1`, [request.params.id],
      ),
      pg.query(
        `SELECT d.id, 'transaction'::text AS subject_kind, d.subject_id, d.filename, d.mime_type,
                d.size_bytes, d.checksum, d.document_type, d.visibility, d.uploaded_at,
                COALESCE(u.full_name, u.name) AS uploaded_by_name
           FROM finance.document d
           LEFT JOIN public.users u ON u.id = d.uploaded_by
          WHERE d.subject_kind = 'transaction' AND d.subject_id = $1::text AND d.deleted_at IS NULL
          ORDER BY d.uploaded_at DESC`, [request.params.id],
      ),
      pg.query(
        `SELECT b.id, b.dataset, b.original_filename, b.file_hash, b.committed_at,
                b.reconciliation_status
           FROM finance.import_batch b
           JOIN finance.transaction t ON t.import_batch_id = b.id
          WHERE t.id = $1 AND b.deleted_at IS NULL`, [request.params.id],
      ),
      reversesId
        ? pg.query(
          `SELECT t.id, ${dateText('t', 'txn_date')}, t.amount, t.reference
             FROM finance.transaction t WHERE t.id = $1 AND t.deleted_at IS NULL`, [reversesId],
        )
        : { rows: [] },
      pg.query(
        `SELECT t.id, ${dateText('t', 'txn_date')}, t.amount, t.reference
           FROM finance.transaction t
          WHERE t.reverses_id = $1 AND t.deleted_at IS NULL
          ORDER BY t.txn_date, t.id
          LIMIT 1`, [request.params.id],
      ),
    ])

    return ok(reply, {
      transaction,
      budget_line: line.rows[0] ?? null,
      project: project.rows[0] ?? null,
      documents: documents.rows,
      import_batch: batch.rows[0] ?? null,
      reversal: {
        reverses: reverses.rows[0] ?? null,
        reversed_by: reversedBy.rows[0] ?? null,
      },
      counterparty_visible: showCounterparty,
    })
  })
}

module.exports = {
  financeTransactionRoutes,
  // Exported for test/finance-transaction-register.test.js, which exercises them with no database:
  // the reversal partition and the sort whitelist are where a quiet mistake becomes a wrong total.
  reversalFilter,
  orderBy,
  SORT_COLUMNS,
  REVERSAL_MODES,
}
