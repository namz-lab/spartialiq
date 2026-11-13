/**
 * The general ledger: the GL chart of accounts, accounting periods, vouchers, the posted ledger,
 * and the statements drawn from it.
 *
 * Tables, views and functions: finance.ledger_account, finance.ledger_period, finance.party,
 * finance.voucher, finance.voucher_line, finance.ledger_entry, finance.v_trial_balance,
 * finance.v_account_balance, finance.v_debtor_ageing, finance.post_voucher(),
 * finance.reverse_voucher(), finance.close_ledger_year() — all migration 203.
 *
 * Design: docs/superpowers/specs/2026-11-10-general-ledger-architecture.md (frontend repo).
 *
 * THIS ROUTE IS NOT WHERE THE RULES LIVE
 * Migration 203 puts the three invariants in the database: a deferred constraint trigger asserting
 * that a voucher's debits equal its credits, one currency per voucher, and a posted ledger line
 * that can never be amended. This module's job is to make the refusals LEGIBLE — a 409 naming the
 * difference instead of a 500 carrying a Postgres message — and nothing here restates the rule it
 * is translating. `finance.post_voucher()` is the only writer of finance.ledger_entry and this
 * route calls it; it does not assemble ledger rows of its own. If this file were deleted the
 * ledger's integrity would be unchanged, which is the point.
 *
 * FOUR THINGS THIS MODULE DOES NOT DO, ON PURPOSE
 *
 * 1. NO MONEY ARITHMETIC IN JAVASCRIPT. Every total, balance and variance here comes out of SQL
 *    over NUMERIC and reaches JSON as a decimal string, untouched. See the header of
 *    src/lib/finance.js for why. There is no `a + b` on an amount anywhere in this file, and the
 *    balance check a caller sees before posting is `finance.voucher_imbalance()` — the same
 *    function the constraint trigger reads, so the preview and the refusal cannot disagree.
 *
 * 2. NO CURRENCY CONVERSION, AND NO TOTAL ACROSS CURRENCIES. There are two books (design decision
 *    1) and the Council has approved no conversion basis (decision D4). Every statement endpoint
 *    returns rows grouped by currency and a `currencies` list; none of them returns a combined
 *    figure, and `finance.exchange_rate_policy` is still read by nothing.
 *
 * 3. NO PERIOD ARITHMETIC OF ITS OWN. `periodList()` from src/lib/financePeriods.js decides what
 *    "Q2" means for a council whose year runs July to June, so a ledger statement and a management
 *    account cannot disagree about which month a posting fell in. The period buckets a statement
 *    reports and the periods a voucher posts into are generated from the same function.
 *
 * 4. NO `finance.transaction` WRITES. The imported-actuals register (migration 188) is a different
 *    record with a different job: it holds what Promun/Pastel says, which is what the parallel run
 *    of decision 3 will reconcile this ledger against. Nothing in this file touches it.
 *
 * WHO MAY DO WHAT
 * `requirePermission` from src/middleware/financePermissions, as everywhere else. The eight
 * `finance.ledger.*` codes are seeded by migration 203. Posting is flagged `is_approval`, so the
 * separation-of-duties assertion over a person's effective permission set (200:194) covers it
 * without knowing it exists. The binding control, though, is per-voucher and in the database:
 * `voucher_prepared_and_posted_differ`. An officer prepares, the Director posts, and neither can do
 * both to the same voucher.
 */

const {
  requirePermission, requireAnyPermission, departmentScope, hasPermission,
} = require('../middleware/financePermissions')
const { parseMoney, normaliseCode, dateText } = require('../lib/finance')
const { periodList, PERIODICITIES } = require('../lib/financePeriods')
const { systemOf } = require('../lib/dbContext')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
// Money arrives as a string so no precision is lost in JSON; a JSON number is accepted and
// normalised, with parseMoney flagging that it was coerced. Expressed as anyOf rather than a union
// `type`, which ajv's strict mode rejects. Same shape as finance-budget.js.
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }

const ROOT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense']
const ACCOUNT_TYPES = ['receivable', 'payable', 'bank', 'cash', 'accumulated_surplus',
  'current_surplus', 'tax', 'fixed_asset', 'inventory', 'provision', 'other']
const VOUCHER_TYPES = ['opening', 'journal', 'rates_bill', 'receipt', 'credit_note',
  'write_off', 'closing', 'reversal', 'supplier_invoice', 'payment', 'depreciation', 'asset_disposal']
// Raised by their own documents (creditors, the asset register), never typed as a journal.
const DOCUMENT_VOUCHER_TYPES = ['reversal', 'supplier_invoice', 'payment', 'depreciation', 'asset_disposal']
const PARTY_TYPES = ['ratepayer', 'debtor', 'supplier', 'employee', 'other']
const PERIOD_STATUSES = ['open', 'closed', 'locked']

/** The root types that sit on each statement. Derived in the database as `report_type`. */
const POSITION_ROOTS = ['asset', 'liability', 'equity']
const PERFORMANCE_ROOTS = ['revenue', 'expense']

/**
 * The ageing buckets, in the order a statement prints them.
 *
 * `unallocated` is last and is not an age: it is a receipt not yet matched to a bill, which
 * finance.v_debtor_ageing reports with a NEGATIVE outstanding figure so a party's ageing total
 * reconciles to its control-account balance. Dropping it would make the two disagree silently.
 */
const AGEING_BUCKETS = ['current', '31_60', '61_90', '91_180', '181_365', 'over_365',
  'settled', 'unallocated']

const AGEING_LABELS = {
  current: 'Not yet 30 days',
  '31_60': '31 to 60 days',
  '61_90': '61 to 90 days',
  '91_180': '91 to 180 days',
  '181_365': '181 to 365 days',
  over_365: 'Over a year',
  settled: 'Settled in full',
  unallocated: 'Received and not yet matched to a bill',
}

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

// ── Pure helpers, exported for test/finance-ledger.test.js ─────────────────────────────────────

/**
 * Sortable columns per listing, by the key a client may send. A sort key is never interpolated from
 * the query: it is looked up here, and an absent key falls back to the first entry. The tie-break
 * on the primary key is what makes pagination stable — without it two pages can repeat a row or
 * skip one when several rows share a sort value.
 */
const SORT_COLUMNS = {
  accounts: { code: 'la.code', name: 'la.name', root_type: 'la.root_type' },
  vouchers: {
    posting_date: 'v.posting_date', voucher_no: 'v.voucher_no',
    voucher_type: 'v.voucher_type', status: 'v.status',
  },
  entries: {
    posting_date: 'e.posting_date', account_code: 'la.code',
    voucher_no: 'e.voucher_no', debit: 'e.debit', credit: 'e.credit',
  },
  parties: { name: 'p.name', reference: 'p.reference', party_type: 'p.party_type' },
}

/** The ORDER BY clause for one listing, with both the key and the direction whitelisted. PURE. */
function orderBy(listing, sort, direction, tieBreak) {
  const columns = SORT_COLUMNS[listing]
  if (!columns) throw new Error(`orderBy: ${JSON.stringify(listing)} is not a known listing`)
  const column = columns[sort] || columns[Object.keys(columns)[0]]
  const dir = direction === 'desc' ? 'DESC' : 'ASC'
  return `${column} ${dir}, ${tieBreak}`
}

/**
 * Which statement a root type belongs on, and which side of it.
 *
 * An asset and an expense are debit-natured: a debit balance is the normal one and is reported
 * positive. A liability, equity and revenue are credit-natured. Getting this wrong is how a
 * statement shows a council's revenue as negative, so it is one function and it is tested.
 */
function naturalSide(rootType) {
  if (rootType === 'asset' || rootType === 'expense') return 'debit'
  if (rootType === 'liability' || rootType === 'equity' || rootType === 'revenue') return 'credit'
  throw new Error(`naturalSide: ${JSON.stringify(rootType)} is not a ledger root type`)
}

/**
 * Group trial-balance rows into statement sections, PER CURRENCY.
 *
 * REGROUPING ONLY. Not one amount is added, parsed or altered: every figure passed in comes out
 * the same decimal string it went in as, and the per-section and per-currency totals come from
 * SQL, which is why this function does not compute any. Its whole job is to put each row under the
 * right heading without ever letting two currencies into one section.
 *
 * `roots` selects the statement: POSITION_ROOTS for a statement of financial position,
 * PERFORMANCE_ROOTS for one of financial performance.
 */
function statementSections(rows, roots) {
  const books = new Map()
  for (const row of rows) {
    if (!roots.includes(row.root_type)) continue
    if (!books.has(row.currency)) {
      books.set(row.currency, new Map(roots.map((r) => [r, []])))
    }
    books.get(row.currency).get(row.root_type).push(row)
  }
  return [...books.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bookCurrency, sections]) => ({
      currency: bookCurrency,
      sections: roots.map((rootType) => ({
        root_type: rootType,
        natural_side: naturalSide(rootType),
        accounts: sections.get(rootType),
      })),
    }))
}

/**
 * Nest a flat chart of accounts by `parent_id`.
 *
 * A row whose parent is not in the set given becomes a root rather than disappearing: a filtered
 * listing must still show every account it matched, and an account silently absent from a chart of
 * accounts is the worst kind of missing.
 */
function chartTree(accounts) {
  const byId = new Map(accounts.map((a) => [a.id, { ...a, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortByCode = (list) => {
    list.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    for (const node of list) sortByCode(node.children)
    return list
  }
  return sortByCode(roots)
}

/**
 * The accounting periods to open for a financial year, from `periodList()`.
 *
 * The periods a voucher posts into and the buckets a statement reports are generated by the same
 * function, so they cannot disagree about which month a posting fell in (design decision A3 of the
 * director spec, restated by §4 of the ledger spec). `period_no` is the bucket's ordinal, which is
 * what makes a July–June council's period 1 July and not January.
 */
function periodsForYear({ start, end, periodicity = 'monthly' }) {
  return periodList({ start, end, periodicity }).map((bucket, index) => ({
    period_no: index + 1,
    label: bucket.label,
    from_date: bucket.from_date,
    to_date: bucket.to_date,
    key: bucket.key,
  }))
}

/**
 * Validate a voucher's lines before any of them reaches the database.
 *
 * Returns `{ ok: true, lines }` with every amount normalised to a decimal STRING, or
 * `{ ok: false, error, message }`. The balance itself is NOT checked here — that is arithmetic on
 * money and belongs in SQL, where `finance.voucher_imbalance()` does it over NUMERIC. What this
 * does is the shape: at least two lines, each citing an account, each with exactly one side.
 */
function validateVoucherLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: 'no_lines', message: 'A voucher needs lines.' }
  }
  if (lines.length < 2) {
    return {
      ok: false,
      error: 'single_line',
      message: 'A voucher needs at least two lines: a double entry has two sides.',
    }
  }
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const at = `Line ${i + 1}`
    if (!line || !line.ledger_account_id) {
      return { ok: false, error: 'line_without_account', message: `${at} cites no ledger account.` }
    }
    const hasDebit = line.debit !== undefined && line.debit !== null && line.debit !== ''
    const hasCredit = line.credit !== undefined && line.credit !== null && line.credit !== ''
    if (hasDebit === hasCredit) {
      return {
        ok: false,
        error: 'line_needs_one_side',
        message: `${at} must carry either a debit or a credit, and not both. The ledger does not use signed amounts.`,
      }
    }
    const raw = hasDebit ? line.debit : line.credit
    const parsed = parseMoney(raw)
    if (!parsed.ok) {
      return {
        ok: false,
        error: 'line_amount_unreadable',
        message: `${at} has an amount this system cannot read (${parsed.reason}).`,
      }
    }
    if (parsed.value.startsWith('-') || Number(parsed.value) === 0) {
      return {
        ok: false,
        error: 'line_amount_not_positive',
        message: `${at} must be a positive amount. A negative posting is the other side of the entry, not a minus sign.`,
      }
    }
    out.push({
      ledger_account_id: line.ledger_account_id,
      debit: hasDebit ? parsed.value : '0.00',
      credit: hasCredit ? parsed.value : '0.00',
      party_id: line.party_id || null,
      department_id: line.department_id || null,
      programme_id: line.programme_id || null,
      activity_id: line.activity_id || null,
      ward_code: line.ward_code ? normaliseCode(line.ward_code) : null,
      project_id: line.project_id || null,
      budget_line_id: line.budget_line_id || null,
      against_voucher_id: line.against_voucher_id || null,
      narration: line.narration || null,
    })
  }
  return { ok: true, lines: out }
}

/**
 * Turn a refusal raised by migration 203 into an HTTP answer an officer can act on.
 *
 * The database messages are written to be read — `voucher X does not balance: debits 100.00,
 * credits 60.00, difference 40.00` — so they are passed through rather than replaced with
 * something vaguer. What this adds is the status code and a stable `error` key, and it maps the
 * ones that arrive as a bare constraint violation onto the sentence the constraint is about.
 */
function ledgerRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const constraint = err && err.constraint ? err.constraint : ''

  if (constraint === 'voucher_prepared_and_posted_differ' || /must be posted by somebody else/.test(message)) {
    return {
      status: 409, error: 'separation_of_duties',
      message: 'Whoever prepared this voucher cannot post it. Posting must come from someone else.',
    }
  }
  if (/does not balance/.test(message)) {
    return { status: 409, error: 'voucher_does_not_balance', message }
  }
  if (/more than one currency|does not match voucher|cannot settle voucher|denominated in/.test(message)) {
    return { status: 409, error: 'currency_mismatch', message }
  }
  if (/accepts no postings|falls outside period|no accounting period/.test(message)) {
    return { status: 409, error: 'period_not_open', message }
  }
  if (/insert-only/.test(message)) {
    return { status: 409, error: 'ledger_is_immutable', message }
  }
  if (/is a heading and cannot be posted to|is inactive and cannot be posted to/.test(message)) {
    return { status: 400, error: 'account_not_postable', message }
  }
  if (/already been reversed|already .* and cannot be posted again|has already been closed/.test(message)) {
    return { status: 409, error: 'already_done', message }
  }
  if (/written by its document/.test(message)) {
    return { status: 409, error: 'document_voucher', message: `${message}. ${err.hint || ''}`.trim() }
  }
  if (/lines can no longer be changed/.test(message)) {
    return { status: 409, error: 'voucher_posted', message }
  }
  if (/overlaps period/.test(message)) {
    return { status: 409, error: 'periods_overlap', message }
  }
  if (constraint === 'voucher_line_one_side_only') {
    return {
      status: 400, error: 'line_needs_one_side',
      message: 'A voucher line carries either a debit or a credit, never both.',
    }
  }
  if (err && err.code === '23505') {
    return { status: 409, error: 'duplicate', message: 'That voucher number is already in use.' }
  }
  return null
}

// ── The routes ────────────────────────────────────────────────────────────────────────────────

async function financeLedgerRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.ledger.view') }
  const canManageChart = { preHandler: requirePermission(fastify, 'finance.ledger.account.manage') }
  const canManageParties = { preHandler: requirePermission(fastify, 'finance.ledger.party.manage') }
  const canManagePeriods = { preHandler: requirePermission(fastify, 'finance.ledger.period.manage') }
  const canPrepare = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.prepare') }
  const canPost = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.post') }
  const canReverse = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.reverse') }
  const canCloseYear = { preHandler: requirePermission(fastify, 'finance.ledger.close_year') }

  /** Translate a database refusal, or hand it on as a 500 with the log entry it deserves. */
  const refuse = (reply, err, fallback) => {
    const mapped = ledgerRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'ledger_error', fallback)
  }

  /**
   * The rates document a voucher stands behind, if any.
   *
   * A rates bill's amount is a generated column and a receipt's is on the receipt, but each posts
   * through a draft voucher — and a draft's lines are editable here. Replacing them would make the
   * book of account disagree with the document, and discarding the voucher would orphan it. The
   * database refuses the disagreement at posting (migration 206 §6); these two routes refuse it
   * earlier and say where the document is kept.
   */
  const ratesDocumentOf = async (voucherId) => {
    const { rows } = await pg.query(
      `SELECT 'rates bill ' || rb.bill_no AS document FROM finance.rates_bill rb WHERE rb.voucher_id = $1
        UNION ALL
       SELECT 'rates receipt ' || rc.receipt_no FROM finance.rates_receipt rc WHERE rc.voucher_id = $1
        LIMIT 1`, [voucherId],
    )
    return rows[0] ? rows[0].document : null
  }

  // ═══ The GL chart of accounts ═══════════════════════════════════════════════════════════════

  fastify.get('/finance/ledger/accounts', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          root_type: { type: 'string', enum: ROOT_TYPES },
          account_type: { type: 'string', enum: ACCOUNT_TYPES },
          report_type: { type: 'string', enum: ['balance_sheet', 'performance'] },
          status: { type: 'string', enum: ['active', 'inactive'] },
          postable_only: { type: 'boolean', default: false },
          q: { type: 'string', maxLength: 200 },
          tree: { type: 'boolean', default: false },
          sort: { type: 'string', enum: Object.keys(SORT_COLUMNS.accounts), default: 'code' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT la.id, la.code, la.name, la.root_type, la.report_type, la.account_type,
              la.parent_id, la.is_group, la.is_postable, la.status, la.notes,
              parent.code AS parent_code,
              ${dateText('la', 'created_at')}
         FROM finance.ledger_account la
         LEFT JOIN finance.ledger_account parent ON parent.id = la.parent_id
        WHERE la.deleted_at IS NULL
          AND ($1::text IS NULL OR la.root_type = $1::text)
          AND ($2::text IS NULL OR la.account_type = $2::text)
          AND ($3::text IS NULL OR la.report_type = $3::text)
          AND ($4::text IS NULL OR la.status = $4::text)
          AND ($5::boolean IS NOT TRUE OR (la.is_postable AND NOT la.is_group))
          AND ($6::text IS NULL OR la.code ILIKE $6::text OR la.name ILIKE $6::text)
        ORDER BY ${orderBy('accounts', q.sort, q.direction, 'la.id')}`,
      [q.root_type || null, q.account_type || null, q.report_type || null, q.status || null,
        q.postable_only === true, q.q ? `%${q.q.trim()}%` : null],
    )
    return ok(reply, {
      accounts: q.tree ? chartTree(rows) : rows,
      total: rows.length,
      shape: q.tree ? 'tree' : 'flat',
      note: 'The chart is currency-neutral. One chart serves both books, and an entry\'s own '
        + 'currency decides which book it falls in.',
    })
  })

  fastify.post('/finance/ledger/accounts', {
    ...canManageChart,
    schema: {
      body: {
        type: 'object', required: ['code', 'name', 'root_type'], additionalProperties: false,
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 60 },
          name: { type: 'string', minLength: 1, maxLength: 300 },
          root_type: { type: 'string', enum: ROOT_TYPES },
          account_type: { type: 'string', enum: ACCOUNT_TYPES },
          parent_id: uuid,
          is_group: { type: 'boolean', default: false },
          is_postable: { type: 'boolean', default: true },
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    // A heading carries no balance of its own, so it is not postable. Said here as a refusal
    // rather than silently corrected, because an officer who ticked both meant one of them.
    if (b.is_group && b.is_postable !== false) {
      return fail(reply, 400, 'group_cannot_be_postable',
        'A heading in the chart cannot be posted to. Create it as a group with is_postable false, '
        + 'and post to the leaf accounts beneath it.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.ledger_account
           (code, name, root_type, account_type, parent_id, is_group, is_postable, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, code, name, root_type, report_type, account_type, parent_id,
                   is_group, is_postable, status`,
        [normaliseCode(b.code), b.name.trim(), b.root_type, b.account_type || null,
          b.parent_id || null, b.is_group === true, b.is_group === true ? false : b.is_postable !== false,
          b.notes || null, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_code', 'An account with that code already exists.')
      }
      return refuse(reply, err, 'The ledger account could not be created.')
    }
  })

  fastify.patch('/finance/ledger/accounts/:id', {
    ...canManageChart,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          account_type: { type: ['string', 'null'], enum: [...ACCOUNT_TYPES, null] },
          parent_id: { type: ['string', 'null'], format: 'uuid' },
          status: { type: 'string', enum: ['active', 'inactive'] },
          notes: { type: ['string', 'null'], maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    // `code` and `root_type` are deliberately not editable. The code is cited by every entry
    // already posted, and changing a root type would move posted figures between statements
    // without a trace — which is exactly what a reversal exists to avoid.
    try {
      const { rows } = await pg.query(
        `UPDATE finance.ledger_account
            SET name = COALESCE($2, name),
                account_type = CASE WHEN $3::boolean THEN $4::text ELSE account_type END,
                parent_id = CASE WHEN $5::boolean THEN $6::uuid ELSE parent_id END,
                status = COALESCE($7, status),
                notes = CASE WHEN $8::boolean THEN $9::text ELSE notes END,
                updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, code, name, root_type, report_type, account_type, parent_id,
                  is_group, is_postable, status, notes`,
        [request.params.id, b.name ? b.name.trim() : null,
          Object.prototype.hasOwnProperty.call(b, 'account_type'), b.account_type ?? null,
          Object.prototype.hasOwnProperty.call(b, 'parent_id'), b.parent_id ?? null,
          b.status || null,
          Object.prototype.hasOwnProperty.call(b, 'notes'), b.notes ?? null],
      )
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such ledger account.')
      return ok(reply, rows[0])
    } catch (err) {
      return refuse(reply, err, 'The ledger account could not be updated.')
    }
  })

  /**
   * Withdraw a ledger account.
   *
   * A soft delete, and refused outright once anything has been posted to it. The account code is
   * carried on every entry that cites it and the ledger is immutable, so an account with postings
   * can be made inactive but never removed: the alternative is a book of account referring to a
   * code that no longer exists.
   */
  fastify.delete('/finance/ledger/accounts/:id', {
    ...canManageChart,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { rows: posted } = await pg.query(
      'SELECT count(*)::int AS n FROM finance.ledger_entry WHERE ledger_account_id = $1',
      [request.params.id],
    )
    if (posted[0].n > 0) {
      return fail(reply, 409, 'account_has_postings',
        `${posted[0].n} ledger entries are posted to this account, and the ledger is immutable. `
        + 'Set the account inactive instead; it stays on the chart and accepts nothing further.')
    }
    const { rows: children } = await pg.query(
      'SELECT count(*)::int AS n FROM finance.ledger_account WHERE parent_id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (children[0].n > 0) {
      return fail(reply, 409, 'account_has_children',
        `${children[0].n} accounts sit beneath this one. Move or withdraw them first.`)
    }
    const { rows } = await pg.query(
      `UPDATE finance.ledger_account SET deleted_at = now(), deleted_by = $2
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, code`,
      [request.params.id, request.user.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such ledger account.')
    return ok(reply, { withdrawn: rows[0].code })
  })

  // ═══ The party register ═════════════════════════════════════════════════════════════════════

  fastify.get('/finance/ledger/parties', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          party_type: { type: 'string', enum: PARTY_TYPES },
          status: { type: 'string', enum: ['active', 'inactive'] },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: Object.keys(SORT_COLUMNS.parties), default: 'name' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE p.deleted_at IS NULL
        AND ($1::text IS NULL OR p.party_type = $1::text)
        AND ($2::text IS NULL OR p.status = $2::text)
        AND ($3::text IS NULL OR p.name ILIKE $3::text OR p.reference ILIKE $3::text)`
    const params = [q.party_type || null, q.status || null, q.q ? `%${q.q.trim()}%` : null]
    const [page, count] = await Promise.all([
      pg.query(
        `SELECT p.id, p.party_type, p.name, p.reference, p.contact_name, p.contact_phone,
                p.contact_email, p.address_text, p.status
           FROM finance.party p ${where}
          ORDER BY ${orderBy('parties', q.sort, q.direction, 'p.id')}
          LIMIT $4 OFFSET $5`, [...params, q.limit, q.offset],
      ),
      pg.query(`SELECT count(*)::int AS total FROM finance.party p ${where}`, params),
    ])
    return ok(reply, {
      parties: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      note: count.rows[0].total === 0
        ? 'The party register is empty. The ratepayer of record for each parcel is Council '
          + 'decision D19, and spatial_planning.parcel_owner holds no rows against 731 parcels, so '
          + 'there is nothing to load it from yet.'
        : null,
    })
  })

  fastify.post('/finance/ledger/parties', {
    ...canManageParties,
    schema: {
      body: {
        type: 'object', required: ['party_type', 'name'], additionalProperties: false,
        properties: {
          party_type: { type: 'string', enum: PARTY_TYPES },
          name: { type: 'string', minLength: 1, maxLength: 300 },
          reference: { type: 'string', maxLength: 120 },
          contact_name: { type: 'string', maxLength: 200 },
          contact_phone: { type: 'string', maxLength: 60 },
          contact_email: { type: 'string', maxLength: 200 },
          address_text: { type: 'string', maxLength: 1000 },
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.party
           (party_type, name, reference, contact_name, contact_phone, contact_email,
            address_text, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, party_type, name, reference, status`,
        [b.party_type, b.name.trim(), b.reference ? normaliseCode(b.reference) : null,
          b.contact_name || null, b.contact_phone || null, b.contact_email || null,
          b.address_text || null, b.notes || null, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_reference',
          'A party with that account reference already exists.')
      }
      return refuse(reply, err, 'The party could not be created.')
    }
  })

  fastify.patch('/finance/ledger/parties/:id', {
    ...canManageParties,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          contact_name: { type: ['string', 'null'], maxLength: 200 },
          contact_phone: { type: ['string', 'null'], maxLength: 60 },
          contact_email: { type: ['string', 'null'], maxLength: 200 },
          address_text: { type: ['string', 'null'], maxLength: 1000 },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows } = await pg.query(
      `UPDATE finance.party
          SET name = COALESCE($2, name),
              contact_name = CASE WHEN $3::boolean THEN $4::text ELSE contact_name END,
              contact_phone = CASE WHEN $5::boolean THEN $6::text ELSE contact_phone END,
              contact_email = CASE WHEN $7::boolean THEN $8::text ELSE contact_email END,
              address_text = CASE WHEN $9::boolean THEN $10::text ELSE address_text END,
              status = COALESCE($11, status), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, party_type, name, reference, contact_name, contact_phone, contact_email,
                address_text, status`,
      [request.params.id, b.name ? b.name.trim() : null,
        Object.prototype.hasOwnProperty.call(b, 'contact_name'), b.contact_name ?? null,
        Object.prototype.hasOwnProperty.call(b, 'contact_phone'), b.contact_phone ?? null,
        Object.prototype.hasOwnProperty.call(b, 'contact_email'), b.contact_email ?? null,
        Object.prototype.hasOwnProperty.call(b, 'address_text'), b.address_text ?? null,
        b.status || null],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such party.')
    return ok(reply, rows[0])
  })

  // ═══ Accounting periods ═════════════════════════════════════════════════════════════════════

  fastify.get('/finance/ledger/periods', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { financial_year_id: uuid, status: { type: 'string', enum: PERIOD_STATUSES } },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT lp.id, lp.financial_year_id, fy.label AS financial_year_label, lp.period_no, lp.label,
              ${dateText('lp', 'from_date', 'to_date')},
              lp.status, lp.closed_at, lp.locked_at,
              COALESCE(cu.full_name, cu.name) AS closed_by_name,
              COALESCE(lu.full_name, lu.name) AS locked_by_name,
              (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.ledger_period_id = lp.id) AS entry_count
         FROM finance.ledger_period lp
         JOIN finance.financial_year fy ON fy.id = lp.financial_year_id
         LEFT JOIN public.users cu ON cu.id = lp.closed_by
         LEFT JOIN public.users lu ON lu.id = lp.locked_by
        WHERE ($1::uuid IS NULL OR lp.financial_year_id = $1::uuid)
          AND ($2::text IS NULL OR lp.status = $2::text)
        ORDER BY fy.start_date, lp.period_no`,
      [q.financial_year_id || null, q.status || null],
    )
    return ok(reply, { periods: rows, total: rows.length })
  })

  /**
   * Open the accounting periods for a financial year.
   *
   * The buckets come from `periodList()` (src/lib/financePeriods.js), so a July–June council gets
   * period 1 = July and the periods tile the year exactly: no gap, no overlap, the last one clipped
   * to the year end. Generating them by hand is how a posting ends up in a month two reports
   * disagree about.
   *
   * Idempotent on `(financial_year_id, period_no)`: re-running it adds what is missing and leaves
   * an existing period, and its status, alone.
   */
  fastify.post('/finance/ledger/periods', {
    ...canManagePeriods,
    schema: {
      body: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          periodicity: { type: 'string', enum: PERIODICITIES, default: 'monthly' },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: year } = await pg.query(
      `SELECT id, label, ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`,
      [b.financial_year_id],
    )
    if (!year[0]) return fail(reply, 404, 'not_found', 'No such financial year.')

    let buckets
    try {
      buckets = periodsForYear({
        start: year[0].start_date, end: year[0].end_date, periodicity: b.periodicity,
      })
    } catch (err) {
      return fail(reply, 400, 'periods_not_derivable', err.message)
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const created = []
      for (const bucket of buckets) {
        const { rows } = await client.query(
          `INSERT INTO finance.ledger_period
             (financial_year_id, period_no, label, from_date, to_date, status, created_by)
           VALUES ($1,$2,$3,$4,$5,'open',$6)
           ON CONFLICT (financial_year_id, period_no) DO NOTHING
           RETURNING id, period_no, label, ${dateText(null, 'from_date', 'to_date')}, status`,
          [b.financial_year_id, bucket.period_no, bucket.label, bucket.from_date, bucket.to_date,
            request.user.id],
        )
        if (rows[0]) created.push(rows[0])
      }
      await client.query('COMMIT')
      return ok(reply, {
        financial_year: year[0].label,
        periodicity: b.periodicity,
        opened: created,
        already_present: buckets.length - created.length,
        note: 'Periods are generated from the council\'s own financial year start, so a July–June '
          + 'year begins at period 1 = July. They tile the year exactly.',
      }, created.length > 0 ? 201 : 200)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The accounting periods could not be opened.')
    } finally {
      client.release()
    }
  })

  /**
   * Change a period's status.
   *
   * `locked` is final: a locked period is what a council sets after the audit and this route will
   * not take it back out. Reopening a `closed` period is allowed and is audited, because a
   * late-arriving adjustment before the audit is ordinary and refusing it would push the figure
   * into the wrong month instead.
   */
  fastify.patch('/finance/ledger/periods/:id', {
    ...canManagePeriods,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', required: ['status'], additionalProperties: false,
        properties: { status: { type: 'string', enum: PERIOD_STATUSES } },
      },
    },
  }, async (request, reply) => {
    const { rows: current } = await pg.query(
      'SELECT id, period_no, status FROM finance.ledger_period WHERE id = $1', [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such accounting period.')
    if (current[0].status === 'locked' && request.body.status !== 'locked') {
      return fail(reply, 409, 'period_locked',
        `Period ${current[0].period_no} is locked, which is final. A locked period is what a `
        + 'council sets after the audit; an adjustment after it belongs in a later period.')
    }
    const next = request.body.status
    const { rows } = await pg.query(
      `UPDATE finance.ledger_period
          SET status = $2,
              closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
              closed_by = CASE WHEN $2 = 'closed' THEN $3::uuid ELSE NULL END,
              locked_at = CASE WHEN $2 = 'locked' THEN now() ELSE locked_at END,
              locked_by = CASE WHEN $2 = 'locked' THEN $3::uuid ELSE locked_by END
        WHERE id = $1
      RETURNING id, period_no, label, status, ${dateText(null, 'from_date', 'to_date')}`,
      [request.params.id, next, request.user.id],
    )
    return ok(reply, rows[0])
  })

  // ═══ Vouchers ═══════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/ledger/vouchers', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          voucher_type: { type: 'string', enum: VOUCHER_TYPES },
          status: { type: 'string', enum: ['draft', 'posted', 'cancelled'] },
          currency,
          from: isoDate,
          to: isoDate,
          q: { type: 'string', maxLength: 200 },
          party_id: uuid,
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: Object.keys(SORT_COLUMNS.vouchers), default: 'posting_date' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const where = `WHERE ($1::uuid IS NULL OR v.financial_year_id = $1::uuid)
        AND ($2::text IS NULL OR v.voucher_type = $2::text)
        AND ($3::text IS NULL OR v.status = $3::text)
        AND ($4::text IS NULL OR v.currency = $4::text)
        AND ($5::date IS NULL OR v.posting_date >= $5::date)
        AND ($6::date IS NULL OR v.posting_date <= $6::date)
        AND ($7::text IS NULL OR v.voucher_no ILIKE $7::text OR v.narration ILIKE $7::text
             OR v.reference ILIKE $7::text)
        AND ($8::uuid IS NULL OR EXISTS (
              SELECT 1 FROM finance.voucher_line l
               WHERE l.voucher_id = v.id AND l.party_id = $8::uuid))
        AND ($9::uuid[] IS NULL OR EXISTS (
              SELECT 1 FROM finance.voucher_line l
               WHERE l.voucher_id = v.id
                 AND (l.department_id = ANY($9::uuid[]) OR l.department_id IS NULL)))`
    const params = [q.financial_year_id || null, q.voucher_type || null, q.status || null,
      q.currency || null, q.from || null, q.to || null, q.q ? `%${q.q.trim()}%` : null,
      q.party_id || null, scope]

    const [page, count] = await Promise.all([
      pg.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.currency, v.financial_year_id,
                ${dateText('v', 'posting_date')},
                v.narration, v.reference, v.status, v.reverses_voucher_id, v.is_opening,
                v.prepared_by, v.prepared_at, v.posted_by, v.posted_at,
                COALESCE(pu.full_name, pu.name) AS prepared_by_name,
                COALESCE(ou.full_name, ou.name) AS posted_by_name,
                rv.voucher_no AS reverses_voucher_no,
                (SELECT r.voucher_no FROM finance.voucher r
                  WHERE r.reverses_voucher_id = v.id AND r.status = 'posted' LIMIT 1) AS reversed_by_voucher_no,
                (SELECT count(*)::int FROM finance.voucher_line l WHERE l.voucher_id = v.id) AS line_count,
                -- Summed in SQL over NUMERIC and returned as a decimal string. Nothing adds an
                -- amount in JavaScript anywhere in this module.
                (SELECT sum(l.debit)::text FROM finance.voucher_line l WHERE l.voucher_id = v.id) AS debit_total,
                (SELECT sum(l.credit)::text FROM finance.voucher_line l WHERE l.voucher_id = v.id) AS credit_total
           FROM finance.voucher v
           LEFT JOIN public.users pu ON pu.id = v.prepared_by
           LEFT JOIN public.users ou ON ou.id = v.posted_by
           LEFT JOIN finance.voucher rv ON rv.id = v.reverses_voucher_id
           ${where}
          ORDER BY ${orderBy('vouchers', q.sort, q.direction, 'v.id')}
          LIMIT $10 OFFSET $11`, [...params, q.limit, q.offset],
      ),
      pg.query(`SELECT count(*)::int AS total FROM finance.voucher v ${where}`, params),
    ])
    return ok(reply, {
      vouchers: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      scope_applied: scope,
      note: 'A voucher carries one currency and so do its totals. No figure here spans the two books.',
    })
  })

  /** One voucher, its lines, and the ledger entries it produced. */
  fastify.get('/finance/ledger/vouchers/:id', {
    ...canView,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { rows: header } = await pg.query(
      `SELECT v.*, ${dateText('v', 'posting_date')},
              COALESCE(pu.full_name, pu.name) AS prepared_by_name,
              COALESCE(ou.full_name, ou.name) AS posted_by_name,
              rv.voucher_no AS reverses_voucher_no,
              lp.period_no, lp.label AS period_label, lp.status AS period_status,
              fy.label AS financial_year_label
         FROM finance.voucher v
         LEFT JOIN public.users pu ON pu.id = v.prepared_by
         LEFT JOIN public.users ou ON ou.id = v.posted_by
         LEFT JOIN finance.voucher rv ON rv.id = v.reverses_voucher_id
         LEFT JOIN finance.ledger_period lp ON lp.id = v.ledger_period_id
         JOIN finance.financial_year fy ON fy.id = v.financial_year_id
        WHERE v.id = $1`, [request.params.id],
    )
    if (!header[0]) return fail(reply, 404, 'not_found', 'No such voucher.')

    const [lines, entries, reversal, balance] = await Promise.all([
      pg.query(
        `SELECT l.id, l.line_no, l.ledger_account_id, la.code AS account_code, la.name AS account_name,
                la.root_type, l.debit, l.credit, l.party_id, p.name AS party_name,
                l.department_id, d.code AS department_code, l.programme_id, l.activity_id,
                l.ward_code, l.project_id, l.budget_line_id, l.against_voucher_id,
                av.voucher_no AS against_voucher_no, l.narration
           FROM finance.voucher_line l
           JOIN finance.ledger_account la ON la.id = l.ledger_account_id
           LEFT JOIN finance.party p ON p.id = l.party_id
           LEFT JOIN finance.department d ON d.id = l.department_id
           LEFT JOIN finance.voucher av ON av.id = l.against_voucher_id
          WHERE l.voucher_id = $1 ORDER BY l.line_no`, [request.params.id],
      ),
      pg.query(
        `SELECT e.id, e.ledger_account_id, la.code AS account_code, e.debit, e.credit,
                ${dateText('e', 'posting_date')}, e.posted_at, e.is_reversal
           FROM finance.ledger_entry e
           JOIN finance.ledger_account la ON la.id = e.ledger_account_id
          WHERE e.voucher_id = $1 ORDER BY la.code`, [request.params.id],
      ),
      pg.query(
        `SELECT r.id, r.voucher_no, ${dateText('r', 'posting_date')}, r.status, r.narration
           FROM finance.voucher r
          WHERE r.reverses_voucher_id = $1 ORDER BY r.created_at LIMIT 1`, [request.params.id],
      ),
      // The SAME function the deferred constraint trigger reads (migration 203), so what a screen
      // shows before posting and what the database refuses at posting cannot disagree.
      pg.query(
        `SELECT entry_count, debit_total::text AS debit_total, credit_total::text AS credit_total,
                difference::text AS difference
           FROM finance.voucher_imbalance($1)`, [request.params.id],
      ),
      ])

    const { rows: draftBalance } = await pg.query(
      `SELECT count(*)::int AS line_count,
              COALESCE(sum(l.debit), 0)::text AS debit_total,
              COALESCE(sum(l.credit), 0)::text AS credit_total,
              (COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0))::text AS difference
         FROM finance.voucher_line l WHERE l.voucher_id = $1`, [request.params.id],
    )

    return ok(reply, {
      voucher: header[0],
      lines: lines.rows,
      entries: entries.rows,
      reversed_by: reversal.rows[0] ?? null,
      // Two balances, because they answer two questions: what the DRAFT would post, and what the
      // ledger actually holds for this voucher.
      draft_balance: draftBalance[0],
      posted_balance: balance.rows[0],
      balances: draftBalance[0].difference === '0' || Number(draftBalance[0].difference) === 0,
      note: header[0].status === 'posted'
        ? 'Posted. Its ledger entries can never be amended; a correction is a reversal voucher and '
          + 'both halves stay visible.'
        : null,
    })
  })

  /**
   * Create a draft voucher with its lines, in one transaction.
   *
   * A draft posts nothing. It is checked for shape here — two sides, one of debit or credit per
   * line, readable amounts — and for balance by the database at posting, where the arithmetic is
   * done in NUMERIC. The response carries the draft's difference so a screen can say "this does not
   * balance yet" without guessing.
   */
  fastify.post('/finance/ledger/vouchers', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object',
        required: ['voucher_no', 'voucher_type', 'currency', 'financial_year_id', 'posting_date', 'lines'],
        additionalProperties: false,
        properties: {
          voucher_no: { type: 'string', minLength: 1, maxLength: 60 },
          voucher_type: { type: 'string', enum: VOUCHER_TYPES.filter((t) => !DOCUMENT_VOUCHER_TYPES.includes(t)) },
          currency,
          financial_year_id: uuid,
          posting_date: isoDate,
          narration: { type: 'string', maxLength: 2000 },
          reference: { type: 'string', maxLength: 120 },
          is_opening: { type: 'boolean', default: false },
          lines: {
            type: 'array', minItems: 2, maxItems: 2000,
            items: {
              type: 'object', required: ['ledger_account_id'], additionalProperties: false,
              properties: {
                ledger_account_id: uuid,
                debit: money,
                credit: money,
                party_id: uuid,
                department_id: uuid,
                programme_id: uuid,
                activity_id: uuid,
                ward_code: { type: 'string', maxLength: 24 },
                project_id: uuid,
                budget_line_id: uuid,
                against_voucher_id: uuid,
                narration: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    // A reversal is raised by /reverse, never by hand: its lines must mirror an original exactly,
    // and a hand-written one that did not would be a correction nobody could follow.
    const checked = validateVoucherLines(b.lines)
    if (!checked.ok) return fail(reply, 400, checked.error, checked.message)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows: header } = await client.query(
        `INSERT INTO finance.voucher
           (voucher_no, voucher_type, currency, financial_year_id, posting_date,
            narration, reference, is_opening, status, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
         RETURNING id, voucher_no, voucher_type, currency, financial_year_id,
                   ${dateText(null, 'posting_date')}, status, prepared_by, prepared_at`,
        [normaliseCode(b.voucher_no), b.voucher_type, b.currency, b.financial_year_id,
          b.posting_date, b.narration || null, b.reference || null,
          b.is_opening === true || b.voucher_type === 'opening', request.user.id],
      )
      const voucherId = header[0].id
      let lineNo = 0
      for (const line of checked.lines) {
        lineNo += 1
        await client.query(
          `INSERT INTO finance.voucher_line
             (voucher_id, line_no, ledger_account_id, debit, credit, party_id, department_id,
              programme_id, activity_id, ward_code, project_id, budget_line_id,
              against_voucher_id, narration)
           VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [voucherId, lineNo, line.ledger_account_id, line.debit, line.credit, line.party_id,
            line.department_id, line.programme_id, line.activity_id, line.ward_code,
            line.project_id, line.budget_line_id, line.against_voucher_id, line.narration],
        )
      }
      const { rows: balance } = await client.query(
        `SELECT COALESCE(sum(l.debit), 0)::text AS debit_total,
                COALESCE(sum(l.credit), 0)::text AS credit_total,
                (COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0))::text AS difference
           FROM finance.voucher_line l WHERE l.voucher_id = $1`, [voucherId],
      )
      await client.query('COMMIT')
      return ok(reply, {
        voucher: header[0],
        lines: lineNo,
        balance: balance[0],
        balances: Number(balance[0].difference) === 0,
        note: Number(balance[0].difference) === 0
          ? 'The draft balances. It posts nothing until somebody other than you posts it.'
          : `The draft does not balance: debits ${balance[0].debit_total}, credits `
            + `${balance[0].credit_total}. It cannot be posted until it does.`,
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be created.')
    } finally {
      client.release()
    }
  })

  /**
   * Replace a draft voucher's lines, or amend its header.
   *
   * Draft only. A posted voucher's lines are frozen by `trg_voucher_line_draft_only` (migration
   * 203) whatever this route does, and the refusal is translated rather than pre-empted so the two
   * cannot drift apart.
   */
  fastify.patch('/finance/ledger/vouchers/:id', {
    ...canPrepare,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          posting_date: isoDate,
          narration: { type: ['string', 'null'], maxLength: 2000 },
          reference: { type: ['string', 'null'], maxLength: 120 },
          lines: {
            type: 'array', minItems: 2, maxItems: 2000,
            items: {
              type: 'object', required: ['ledger_account_id'], additionalProperties: false,
              properties: {
                ledger_account_id: uuid, debit: money, credit: money, party_id: uuid,
                department_id: uuid, programme_id: uuid, activity_id: uuid,
                ward_code: { type: 'string', maxLength: 24 }, project_id: uuid,
                budget_line_id: uuid, against_voucher_id: uuid,
                narration: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT id, voucher_no, status FROM finance.voucher WHERE id = $1', [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')
    if (current[0].status !== 'draft') {
      return fail(reply, 409, 'voucher_posted',
        `Voucher ${current[0].voucher_no} is ${current[0].status} and can no longer be edited. `
        + 'Correct a posted voucher with a reversal; both halves stay visible.')
    }
    if (b.lines) {
      const document = await ratesDocumentOf(request.params.id)
      if (document) {
        return fail(reply, 409, 'voucher_belongs_to_rates',
          `Voucher ${current[0].voucher_no} is the double entry of ${document}, and its lines are `
          + 'computed from that document. Cancel the billing run or the receipt under Rates and raise it again.')
      }
    }

    let checked = null
    if (b.lines) {
      checked = validateVoucherLines(b.lines)
      if (!checked.ok) return fail(reply, 400, checked.error, checked.message)
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE finance.voucher
            SET posting_date = COALESCE($2::date, posting_date),
                narration = CASE WHEN $3::boolean THEN $4::text ELSE narration END,
                reference = CASE WHEN $5::boolean THEN $6::text ELSE reference END
          WHERE id = $1`,
        [request.params.id, b.posting_date || null,
          Object.prototype.hasOwnProperty.call(b, 'narration'), b.narration ?? null,
          Object.prototype.hasOwnProperty.call(b, 'reference'), b.reference ?? null],
      )
      if (checked) {
        await client.query('DELETE FROM finance.voucher_line WHERE voucher_id = $1', [request.params.id])
        let lineNo = 0
        for (const line of checked.lines) {
          lineNo += 1
          await client.query(
            `INSERT INTO finance.voucher_line
               (voucher_id, line_no, ledger_account_id, debit, credit, party_id, department_id,
                programme_id, activity_id, ward_code, project_id, budget_line_id,
                against_voucher_id, narration)
             VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [request.params.id, lineNo, line.ledger_account_id, line.debit, line.credit,
              line.party_id, line.department_id, line.programme_id, line.activity_id,
              line.ward_code, line.project_id, line.budget_line_id, line.against_voucher_id,
              line.narration],
          )
        }
      }
      const { rows: balance } = await client.query(
        `SELECT COALESCE(sum(l.debit), 0)::text AS debit_total,
                COALESCE(sum(l.credit), 0)::text AS credit_total,
                (COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0))::text AS difference
           FROM finance.voucher_line l WHERE l.voucher_id = $1`, [request.params.id],
      )
      await client.query('COMMIT')
      return ok(reply, { updated: current[0].voucher_no, balance: balance[0],
        balances: Number(balance[0].difference) === 0 })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be updated.')
    } finally {
      client.release()
    }
  })

  /** Discard a draft. A posted voucher cannot be deleted at all; it is reversed. */
  fastify.delete('/finance/ledger/vouchers/:id', {
    ...canPrepare,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { rows: current } = await pg.query(
      'SELECT id, voucher_no, status FROM finance.voucher WHERE id = $1', [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')
    if (current[0].status !== 'draft') {
      return fail(reply, 409, 'voucher_posted',
        `Voucher ${current[0].voucher_no} is ${current[0].status}. A posted voucher is never `
        + 'deleted — it is reversed, and both halves stay on the record.')
    }
    const document = await ratesDocumentOf(request.params.id)
    if (document) {
      return fail(reply, 409, 'voucher_belongs_to_rates',
        `Voucher ${current[0].voucher_no} is the double entry of ${document}. It is withdrawn by `
        + 'cancelling the billing run or the receipt under Rates, which keeps the record of why.')
    }
    await pg.query('DELETE FROM finance.voucher WHERE id = $1 AND status = $2',
      [request.params.id, 'draft'])
    return ok(reply, { discarded: current[0].voucher_no })
  })

  /**
   * Post a voucher to the book of account.
   *
   * Calls `finance.post_voucher()` and nothing else. Every rule — draft status, separation of
   * duties, two lines, an open period containing the posting date, balance — is checked there, in
   * one place, so a second caller cannot post by a different set of rules. This route exists to
   * turn the refusals into readable HTTP.
   *
   * It is the point of no return: once posted, the entries can never be amended.
   */
  fastify.post('/finance/ledger/vouchers/:id/post', {
    ...canPost,
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const { rows: current } = await pg.query(
      'SELECT id, voucher_no, status, prepared_by FROM finance.voucher WHERE id = $1',
      [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')
    // Refused here first so the message names the rule rather than the constraint. The CHECK
    // constraint is what actually holds (acceptance check G7).
    if (current[0].prepared_by === request.user.id) {
      return fail(reply, 409, 'separation_of_duties',
        `You prepared voucher ${current[0].voucher_no}, so posting it is not yours to do. `
        + 'Posting must come from someone else.')
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.post_voucher($1, $2) AS entries', [request.params.id, request.user.id],
      )
      // Force the deferred balance trigger now, inside this transaction, so a refusal arrives as a
      // 409 naming the difference rather than as a failed COMMIT the caller cannot interpret.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      return ok(reply, {
        posted: current[0].voucher_no,
        entries: rows[0].entries,
        note: 'Posted. These ledger entries can never be amended, flagged or hidden. A correction '
          + 'is a reversal voucher, and both halves stay visible.',
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be posted.')
    } finally {
      client.release()
    }
  })

  /**
   * Reverse a posted voucher.
   *
   * `finance.reverse_voucher()` raises a reversal with debit and credit swapped and posts it. The
   * original stays `posted` and visible: it is not cancelled, flagged or hidden, which is the same
   * rule `finance.transaction.reverses_id` already follows. The net effect on every account is nil
   * (acceptance check G6).
   */
  fastify.post('/finance/ledger/vouchers/:id/reverse', {
    ...canReverse,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: {
          reason: { type: 'string', minLength: 10, maxLength: 2000 },
          posting_date: isoDate,
          voucher_no: { type: 'string', minLength: 1, maxLength: 60 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT id, voucher_no, status, prepared_by FROM finance.voucher WHERE id = $1',
      [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')

    // A reversal is itself a posting, so it needs a preparer and a different poster. The person
    // raising it is recorded as the preparer; posting it is the original poster's counterpart act.
    // Where this person prepared the original, they may still raise the reversal — what separation
    // of duties forbids is preparing and posting the SAME voucher, and the reversal is a new one.
    // Read through the system connection: the permission tables are not readable by the
    // application's own database role, and this lookup is the system's, not the caller's.
    const { rows: poster } = await systemOf(pg).query(
      `SELECT u.id FROM public.users u
        WHERE u.id <> $1 AND u.authority_id = (SELECT authority_id FROM public.users WHERE id = $1)
          AND EXISTS (SELECT 1 FROM finance.role_permission rp
                       WHERE rp.role_name = u.role
                         AND rp.permission_code = 'finance.ledger.voucher.post')
        ORDER BY u.id LIMIT 1`, [request.user.id],
    )
    if (!poster[0]) {
      return fail(reply, 409, 'no_second_poster',
        'A reversal is a posting and must be posted by somebody other than whoever raised it. '
        + 'No other person in this council holds finance.ledger.voucher.post, so the reversal '
        + 'cannot be completed. Grant that permission to a second officer first.')
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.reverse_voucher($1, $2, $3, $4, $5, $6) AS id',
        [request.params.id, request.user.id, poster[0].id, b.reason.trim(),
          b.posting_date || null, b.voucher_no ? normaliseCode(b.voucher_no) : null],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      const { rows: created } = await client.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.currency,
                ${dateText('v', 'posting_date')}, v.status, v.reverses_voucher_id
           FROM finance.voucher v WHERE v.id = $1`, [rows[0].id],
      )
      await client.query('COMMIT')
      return ok(reply, {
        reversal: created[0],
        reversed: current[0].voucher_no,
        note: `${current[0].voucher_no} stays posted and visible. The reversal carries the opposite `
          + 'entries, so the net effect on every account is nil, and both halves remain on the '
          + 'record.',
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be reversed.')
    } finally {
      client.release()
    }
  })

  // ═══ The posted ledger, and the statements ══════════════════════════════════════════════════

  /** The general ledger in detail: one row per posted entry. */
  fastify.get('/finance/ledger/entries', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          ledger_account_id: uuid,
          ledger_period_id: uuid,
          party_id: uuid,
          department_id: uuid,
          project_id: uuid,
          ward_code: { type: 'string', maxLength: 24 },
          currency,
          root_type: { type: 'string', enum: ROOT_TYPES },
          voucher_type: { type: 'string', enum: VOUCHER_TYPES },
          from: isoDate,
          to: isoDate,
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: Object.keys(SORT_COLUMNS.entries), default: 'posting_date' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const from = `FROM finance.ledger_entry e
      JOIN finance.ledger_account la ON la.id = e.ledger_account_id`
    const where = `WHERE ($1::uuid IS NULL OR e.financial_year_id = $1::uuid)
        AND ($2::uuid IS NULL OR e.ledger_account_id = $2::uuid)
        AND ($3::uuid IS NULL OR e.ledger_period_id = $3::uuid)
        AND ($4::uuid IS NULL OR e.party_id = $4::uuid)
        AND ($5::uuid IS NULL OR e.department_id = $5::uuid)
        AND ($6::uuid IS NULL OR e.project_id = $6::uuid)
        AND ($7::text IS NULL OR e.ward_code = $7::text)
        AND ($8::text IS NULL OR e.currency = $8::text)
        AND ($9::text IS NULL OR la.root_type = $9::text)
        AND ($10::text IS NULL OR e.voucher_type = $10::text)
        AND ($11::date IS NULL OR e.posting_date >= $11::date)
        AND ($12::date IS NULL OR e.posting_date <= $12::date)
        AND ($13::text IS NULL OR e.narration ILIKE $13::text OR e.voucher_no ILIKE $13::text)
        AND ($14::uuid[] IS NULL OR e.department_id = ANY($14::uuid[]) OR e.department_id IS NULL)`
    const params = [q.financial_year_id || null, q.ledger_account_id || null,
      q.ledger_period_id || null, q.party_id || null, q.department_id || null, q.project_id || null,
      q.ward_code || null, q.currency || null, q.root_type || null, q.voucher_type || null,
      q.from || null, q.to || null, q.q ? `%${q.q.trim()}%` : null, scope]

    const [page, count, totals] = await Promise.all([
      pg.query(
        `SELECT e.id, e.voucher_id, e.voucher_no, e.voucher_type, e.ledger_account_id,
                la.code AS account_code, la.name AS account_name, la.root_type,
                e.debit, e.credit, e.currency, ${dateText('e', 'posting_date')},
                e.party_id, e.department_id, e.programme_id, e.activity_id, e.ward_code,
                e.project_id, e.budget_line_id, e.against_voucher_id, e.is_reversal,
                e.narration, e.posted_at
           ${from} ${where}
          ORDER BY ${orderBy('entries', q.sort, q.direction, 'e.id')}
          LIMIT $15 OFFSET $16`, [...params, q.limit, q.offset],
      ),
      pg.query(`SELECT count(*)::int AS total ${from} ${where}`, params),
      // Grouped by currency, summed in NUMERIC, returned as decimal strings. There is deliberately
      // no row spanning the two currencies (decision D4).
      pg.query(
        `SELECT e.currency::text AS currency, count(*)::int AS "rows",
                sum(e.debit)::text AS debit_total, sum(e.credit)::text AS credit_total
           ${from} ${where}
          GROUP BY e.currency ORDER BY e.currency`, params,
      ),
    ])
    return ok(reply, {
      entries: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      totals: totals.rows,
      scope_applied: scope,
      totals_cover: 'the whole filtered set, not the page shown',
      note: 'One total per currency. There is no combined figure, on any filter.',
    })
  })

  /**
   * The trial balance, one per currency.
   *
   * Each must balance. A non-balancing trial balance is a defect, not a presentation choice, so the
   * response says per currency whether it balances and by how much rather than leaving the reader
   * to add the columns up.
   */
  fastify.get('/finance/ledger/trial-balance', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          root_type: { type: 'string', enum: ROOT_TYPES },
          include_nil: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT tb.currency, tb.ledger_account_id, tb.account_code, tb.account_name,
              tb.root_type, tb.report_type, tb.account_type, tb.entry_count,
              tb.debit_total::text  AS debit_total,
              tb.credit_total::text AS credit_total,
              tb.debit_balance::text  AS debit_balance,
              tb.credit_balance::text AS credit_balance,
              ${dateText('tb', 'first_posting_date', 'last_posting_date')}
         FROM finance.v_trial_balance tb
        WHERE tb.financial_year_id = $1
          AND ($2::text IS NULL OR tb.currency = $2::text)
          AND ($3::text IS NULL OR tb.root_type = $3::text)
          AND ($4::boolean IS TRUE OR tb.debit_balance <> 0 OR tb.credit_balance <> 0)
        ORDER BY tb.currency, tb.account_code`,
      [q.financial_year_id, q.currency || null, q.root_type || null, q.include_nil === true],
    )
    // Summed in SQL, per currency, and never across them.
    const { rows: books } = await pg.query(
      `SELECT tb.currency,
              count(*)::int AS account_count,
              sum(tb.debit_balance)::text  AS debit_total,
              sum(tb.credit_balance)::text AS credit_total,
              (sum(tb.debit_balance) - sum(tb.credit_balance))::text AS difference,
              (sum(tb.debit_balance) = sum(tb.credit_balance)) AS balances
         FROM finance.v_trial_balance tb
        WHERE tb.financial_year_id = $1
          AND ($2::text IS NULL OR tb.currency = $2::text)
        GROUP BY tb.currency ORDER BY tb.currency`,
      [q.financial_year_id, q.currency || null],
    )
    return ok(reply, {
      accounts: rows,
      books,
      currencies: books.map((b) => b.currency),
      note: 'One trial balance per currency, and there is no combined figure: the Council has '
        + 'approved no conversion basis (decision D4). Each book must balance on its own; a '
        + 'difference other than nil is a defect to investigate.',
      unbalanced: books.filter((b) => b.balances !== true).map((b) => b.currency),
    })
  })

  /** The carrying balance of one ledger account, per currency, across every year. */
  fastify.get('/finance/ledger/accounts/:id/balance', {
    ...canView,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { currency, financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const { rows: account } = await pg.query(
      `SELECT id, code, name, root_type, report_type, account_type, is_group, is_postable, status
         FROM finance.ledger_account WHERE id = $1 AND deleted_at IS NULL`, [request.params.id],
    )
    if (!account[0]) return fail(reply, 404, 'not_found', 'No such ledger account.')

    const { rows: lifetime } = await pg.query(
      `SELECT ab.currency, ab.entry_count,
              ab.debit_total::text  AS debit_total,
              ab.credit_total::text AS credit_total,
              ab.net_debit::text    AS net_debit,
              ${dateText('ab', 'last_posting_date')}
         FROM finance.v_account_balance ab
        WHERE ab.ledger_account_id = $1
          AND ($2::text IS NULL OR ab.currency = $2::text)
        ORDER BY ab.currency`, [request.params.id, request.query.currency || null],
    )
    const { rows: byYear } = await pg.query(
      `SELECT tb.financial_year_id, fy.label AS financial_year_label, tb.currency,
              tb.debit_total::text    AS debit_total,
              tb.credit_total::text   AS credit_total,
              tb.debit_balance::text  AS debit_balance,
              tb.credit_balance::text AS credit_balance
         FROM finance.v_trial_balance tb
         JOIN finance.financial_year fy ON fy.id = tb.financial_year_id
        WHERE tb.ledger_account_id = $1
          AND ($2::uuid IS NULL OR tb.financial_year_id = $2::uuid)
          AND ($3::text IS NULL OR tb.currency = $3::text)
        ORDER BY fy.start_date, tb.currency`,
      [request.params.id, request.query.financial_year_id || null, request.query.currency || null],
    )
    return ok(reply, {
      account: account[0],
      natural_side: naturalSide(account[0].root_type),
      balances: lifetime,
      by_financial_year: byYear,
      note: '`net_debit` is signed debit-positive. Which side the balance belongs on is read from '
        + 'the account\'s root type, so an asset carrying a credit balance stays visible as the '
        + 'fact it is rather than being shown as a positive figure.',
    })
  })

  /**
   * The statement of financial position: assets, liabilities and equity, per currency.
   *
   * NOT a complete IPSAS position statement, and the response says so. Creditors are a deferred
   * workstream (spec §7), so there are no payables, and the bank balance is unreconciled because
   * the cashbook and bank reconciliation are deferred too. Those are consequences of the client's
   * scope choice and a statement that did not declare them would be the misleading one.
   */
  fastify.get('/finance/ledger/statements/position', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid, currency },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT tb.currency, tb.ledger_account_id, tb.account_code, tb.account_name,
              tb.root_type, tb.account_type,
              tb.debit_balance::text  AS debit_balance,
              tb.credit_balance::text AS credit_balance,
              CASE WHEN tb.root_type = 'asset' THEN tb.debit_balance - tb.credit_balance
                   ELSE tb.credit_balance - tb.debit_balance END::text AS balance
         FROM finance.v_trial_balance tb
        WHERE tb.financial_year_id = $1
          AND tb.root_type = ANY($2::text[])
          AND ($3::text IS NULL OR tb.currency = $3::text)
        ORDER BY tb.currency, tb.root_type, tb.account_code`,
      [q.financial_year_id, POSITION_ROOTS, q.currency || null],
    )
    const { rows: subtotals } = await pg.query(
      `SELECT tb.currency, tb.root_type,
              sum(CASE WHEN tb.root_type = 'asset' THEN tb.debit_balance - tb.credit_balance
                       ELSE tb.credit_balance - tb.debit_balance END)::text AS subtotal
         FROM finance.v_trial_balance tb
        WHERE tb.financial_year_id = $1
          AND tb.root_type = ANY($2::text[])
          AND ($3::text IS NULL OR tb.currency = $3::text)
        GROUP BY tb.currency, tb.root_type ORDER BY tb.currency, tb.root_type`,
      [q.financial_year_id, POSITION_ROOTS, q.currency || null],
    )
    const { rows: payables } = await pg.query(
      `SELECT count(*)::int AS n FROM finance.ledger_account
        WHERE account_type = 'payable' AND deleted_at IS NULL`,
    )
    return ok(reply, {
      books: statementSections(rows, POSITION_ROOTS),
      subtotals,
      currencies: [...new Set(rows.map((r) => r.currency))].sort(),
      incomplete: [
        payables[0].n === 0
          ? 'No payables. Creditors, purchasing and payments are a deferred workstream, so this '
            + 'statement shows what the council is owed and not what it owes.'
          : null,
        'The bank balance is unreconciled: the cashbook and bank reconciliation are deferred.',
        'There is no fixed-asset register and no depreciation charge.',
      ].filter(Boolean),
      note: 'A statement of financial position per currency. It is NOT a complete IPSAS position '
        + 'statement while the items listed under `incomplete` are outstanding, and it should not '
        + 'be presented as one.',
    })
  })

  /**
   * The statement of financial performance: revenue and expense, per currency, per period.
   *
   * The period columns come from `periodList()`, the same function the accounting periods were
   * generated from, so a ledger statement and a management account cannot disagree about which
   * month a posting fell in. A period with no activity gets its column and reports nil rather than
   * being dropped: a missing month is a fact a director needs to see.
   */
  fastify.get('/finance/ledger/statements/performance', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          periodicity: { type: 'string', enum: PERIODICITIES },
          accumulated: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows: year } = await pg.query(
      `SELECT id, label, ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`, [q.financial_year_id],
    )
    if (!year[0]) return fail(reply, 404, 'not_found', 'No such financial year.')

    // The whole-year figures, which are what the statement's own columns add to.
    const { rows } = await pg.query(
      `SELECT tb.currency, tb.ledger_account_id, tb.account_code, tb.account_name, tb.root_type,
              CASE WHEN tb.root_type = 'revenue' THEN tb.credit_balance - tb.debit_balance
                   ELSE tb.debit_balance - tb.credit_balance END::text AS balance
         FROM finance.v_trial_balance tb
        WHERE tb.financial_year_id = $1
          AND tb.root_type = ANY($2::text[])
          AND ($3::text IS NULL OR tb.currency = $3::text)
        ORDER BY tb.currency, tb.root_type, tb.account_code`,
      [q.financial_year_id, PERFORMANCE_ROOTS, q.currency || null],
    )

    let periods = null
    let periodRows = []
    if (q.periodicity) {
      try {
        periods = periodList({
          start: year[0].start_date, end: year[0].end_date,
          periodicity: q.periodicity, accumulated: q.accumulated === true,
        })
      } catch (err) {
        return fail(reply, 400, 'periods_not_derivable', err.message)
      }
      // One query, with the buckets passed as parameters rather than built into the SQL. The keys
      // are never used as identifiers or aliases, so nothing from the caller reaches the statement
      // text.
      const result = await pg.query(
        `WITH bucket(key, from_date, to_date) AS (
           SELECT * FROM unnest($4::text[], $5::date[], $6::date[])
         )
         SELECT b.key, e.currency::text AS currency, e.ledger_account_id,
                la.code AS account_code, la.root_type,
                sum(CASE WHEN la.root_type = 'revenue' THEN e.credit - e.debit
                         ELSE e.debit - e.credit END)::text AS balance
           FROM bucket b
           JOIN finance.ledger_entry e
             ON e.posting_date BETWEEN b.from_date AND b.to_date
            AND e.financial_year_id = $1
           JOIN finance.ledger_account la ON la.id = e.ledger_account_id
          WHERE la.root_type = ANY($2::text[])
            AND ($3::text IS NULL OR e.currency = $3::text)
          GROUP BY b.key, e.currency, e.ledger_account_id, la.code, la.root_type`,
        [q.financial_year_id, PERFORMANCE_ROOTS, q.currency || null,
          periods.map((p) => p.key), periods.map((p) => p.from_date), periods.map((p) => p.to_date)],
      )
      periodRows = result.rows
    }

    return ok(reply, {
      financial_year: year[0],
      books: statementSections(rows, PERFORMANCE_ROOTS),
      periods,
      period_rows: periodRows,
      accumulated: q.accumulated === true,
      currencies: [...new Set(rows.map((r) => r.currency))].sort(),
      incomplete: ['There is no depreciation charge: fixed assets are a deferred workstream.'],
      note: 'Revenue and expense per currency. A period with no activity still gets its column and '
        + 'reports nil; nothing is interpolated or carried forward. '
        + (q.accumulated === true
          ? 'The buckets are year-to-date and OVERLAP by design, so they must not be added together.'
          : 'The buckets tile the year exactly.'),
    })
  })

  /**
   * Debtor ageing.
   *
   * THIS IS WHAT DECISION D13 SAID COULD NOT EXIST. It can now because the ledger is accrual: a
   * rates bill raises a receivable, a receipt settles it through `against_voucher_id`, and the age
   * runs from the bill's own posting date.
   *
   * A receipt not yet matched to a bill appears in the `unallocated` bucket with a NEGATIVE
   * outstanding figure, so a party's ageing total reconciles to its control-account balance.
   * Leaving it out would make the two disagree silently, which is the usual failure of an ageing
   * report.
   */
  fastify.get('/finance/ledger/debtor-ageing', {
    preHandler: requireAnyPermission(fastify, ['finance.ledger.view', 'finance.report.view']),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          currency,
          party_id: uuid,
          ledger_account_id: uuid,
          bucket: { type: 'string', enum: AGEING_BUCKETS },
          outstanding_only: { type: 'boolean', default: true },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE ($1::text IS NULL OR a.currency = $1::text)
        AND ($2::uuid IS NULL OR a.party_id = $2::uuid)
        AND ($3::uuid IS NULL OR a.ledger_account_id = $3::uuid)
        AND ($4::text IS NULL OR a.ageing_bucket = $4::text)
        AND ($5::boolean IS NOT TRUE OR a.outstanding_amount <> 0)`
    const params = [q.currency || null, q.party_id || null, q.ledger_account_id || null,
      q.bucket || null, q.outstanding_only !== false]

    const [page, byBucket, byParty, count, recon] = await Promise.all([
      pg.query(
        `SELECT a.currency, a.party_id, a.party_name, a.party_reference, a.ledger_account_id,
                a.voucher_id, a.voucher_no, a.voucher_type,
                ${dateText('a', 'posting_date', 'last_settled_on')},
                a.billed_amount::text      AS billed_amount,
                a.settled_amount::text     AS settled_amount,
                a.outstanding_amount::text AS outstanding_amount,
                a.days_outstanding, a.ageing_bucket
           FROM finance.v_debtor_ageing a ${where}
          ORDER BY a.currency, a.days_outstanding DESC, a.voucher_no
          LIMIT $6 OFFSET $7`, [...params, q.limit, q.offset],
      ),
      // Per currency AND per bucket. Never a figure spanning the two currencies.
      pg.query(
        `SELECT a.currency, a.ageing_bucket, count(*)::int AS "rows",
                sum(a.outstanding_amount)::text AS outstanding_amount
           FROM finance.v_debtor_ageing a ${where}
          GROUP BY a.currency, a.ageing_bucket ORDER BY a.currency, a.ageing_bucket`, params,
      ),
      pg.query(
        `SELECT a.currency, a.party_id, a.party_name, a.party_reference,
                count(*)::int AS bill_count,
                sum(a.outstanding_amount)::text AS outstanding_amount,
                max(a.days_outstanding) AS oldest_days
           FROM finance.v_debtor_ageing a ${where}
          GROUP BY a.currency, a.party_id, a.party_name, a.party_reference
          ORDER BY a.currency, sum(a.outstanding_amount) DESC NULLS LAST
          LIMIT 200`, params,
      ),
      pg.query(`SELECT count(*)::int AS total FROM finance.v_debtor_ageing a ${where}`, params),
      /**
       * THE CHECK MOST AGEING REPORTS FAIL, COMPUTED IN SQL.
       *
       * The ageing total per currency against the receivable control account's own balance. Both
       * sides are summed by Postgres over NUMERIC and the comparison is Postgres's too, so nothing
       * about this answer depends on JavaScript arithmetic.
       *
       * Deliberately NOT subject to the caller's filters: it is an integrity statement about the
       * whole book, and a reconciliation narrowed to one bucket or one party would always agree and
       * would mean nothing. `outstanding_only` does not change it either — a settled bill
       * contributes nil.
       */
      pg.query(
        `WITH aged AS (
           SELECT a.currency::text AS currency,
                  count(*)::int AS rows,
                  sum(a.outstanding_amount) AS outstanding
             FROM finance.v_debtor_ageing a
            GROUP BY a.currency
         ), control AS (
           SELECT ab.currency::text AS currency,
                  sum(ab.net_debit) AS balance,
                  count(*)::int AS control_accounts,
                  string_agg(la.code, ', ' ORDER BY la.code) AS control_codes
             FROM finance.v_account_balance ab
             JOIN finance.ledger_account la ON la.id = ab.ledger_account_id
            WHERE la.account_type = 'receivable' AND la.deleted_at IS NULL
            GROUP BY ab.currency
         )
         SELECT COALESCE(aged.currency, control.currency) AS currency,
                COALESCE(aged.rows, 0)                   AS rows,
                COALESCE(aged.outstanding, 0)::text      AS ageing_total,
                COALESCE(control.balance, 0)::text       AS control_balance,
                COALESCE(control.control_accounts, 0)    AS control_accounts,
                control.control_codes,
                (COALESCE(aged.outstanding, 0) - COALESCE(control.balance, 0))::text AS difference,
                (COALESCE(aged.outstanding, 0) = COALESCE(control.balance, 0)) AS agrees
           FROM aged FULL OUTER JOIN control ON control.currency = aged.currency
          ORDER BY 1`,
      ),
    ])

    return ok(reply, {
      bills: page.rows,
      total: count.rows[0].total,
      limit: q.limit,
      offset: q.offset,
      by_bucket: byBucket.rows,
      by_party: byParty.rows,
      reconciliation: recon.rows,
      buckets: AGEING_BUCKETS.map((key) => ({ key, label: AGEING_LABELS[key] })),
      as_at: new Date().toISOString().slice(0, 10),
      note: count.rows[0].total === 0
        ? 'No receivable has been posted. Ageing needs a rates bill, which needs a ratepayer of '
          + 'record (decision D19) and a rateable value (D17) — neither of which this database '
          + 'holds yet.'
        : 'Aged from each bill\'s own posting date, per currency, with no figure spanning the two. '
          + 'An `unallocated` row is a receipt not yet matched to a bill and carries a negative '
          + 'outstanding figure, so a party\'s total reconciles to its control account.',
    })
  })

  /**
   * Year-end closing for one currency's book.
   *
   * Brings every revenue and expense account to nil and transfers the net to accumulated surplus,
   * so the statement of financial performance opens the next year at nil (acceptance check G10).
   * The two books close separately and no rate is applied.
   */
  fastify.post('/finance/ledger/close-year', {
    ...canCloseYear,
    schema: {
      body: {
        type: 'object',
        required: ['financial_year_id', 'currency', 'voucher_no', 'posted_by'],
        additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          voucher_no: { type: 'string', minLength: 1, maxLength: 60 },
          posting_date: isoDate,
          // The closing voucher is a posting like any other, so it needs a second person. Named
          // explicitly rather than guessed, because this is an annual act with a signature on it.
          posted_by: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (b.posted_by === request.user.id) {
      return fail(reply, 409, 'separation_of_duties',
        'A closing voucher is a posting and must be posted by somebody other than whoever raised '
        + 'it. Name a different officer.')
    }
    if (!(await hasPermission(fastify, request, 'finance.ledger.view'))) {
      return fail(reply, 403, 'forbidden', 'Closing the year needs finance.ledger.view as well.')
    }
    // Read through the system connection: the permission tables are not readable by the
    // application's own database role, and this lookup is the system's, not the caller's.
    const { rows: poster } = await systemOf(pg).query(
      `SELECT u.id FROM public.users u
        WHERE u.id = $1
          AND EXISTS (SELECT 1 FROM finance.role_permission rp
                       WHERE rp.role_name = u.role
                         AND rp.permission_code = 'finance.ledger.voucher.post')`, [b.posted_by],
    )
    if (!poster[0]) {
      return fail(reply, 400, 'poster_cannot_post',
        'The person named does not hold finance.ledger.voucher.post, so they cannot post the '
        + 'closing voucher.')
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.close_ledger_year($1, $2, $3, $4, $5, $6) AS id',
        [b.financial_year_id, b.currency, request.user.id, b.posted_by,
          normaliseCode(b.voucher_no), b.posting_date || null],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      const { rows: closing } = await client.query(
        `SELECT v.id, v.voucher_no, v.currency, ${dateText('v', 'posting_date')}, v.status,
                (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries
           FROM finance.voucher v WHERE v.id = $1`, [rows[0].id],
      )
      await client.query('COMMIT')
      return ok(reply, {
        closing_voucher: closing[0],
        note: `The ${b.currency} book is closed. Every revenue and expense account is nil and the `
          + 'net has gone to accumulated surplus, so next year\'s performance statement opens at '
          + 'nil. The other currency\'s book closes separately; no rate was applied.',
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The year could not be closed.')
    } finally {
      client.release()
    }
  })
}

module.exports = {
  financeLedgerRoutes,
  // Exported for test/finance-ledger.test.js, which exercises them with no database. These are the
  // places where a quiet mistake becomes a wrong figure or an unchecked identifier in SQL.
  SORT_COLUMNS,
  orderBy,
  naturalSide,
  statementSections,
  chartTree,
  periodsForYear,
  validateVoucherLines,
  ledgerRefusal,
  AGEING_BUCKETS,
  AGEING_LABELS,
  POSITION_ROOTS,
  PERFORMANCE_ROOTS,
  ROOT_TYPES,
  VOUCHER_TYPES,
}
