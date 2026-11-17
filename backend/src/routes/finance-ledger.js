/**
 * The general ledger: the GL chart of accounts, accounting periods, vouchers, the posted ledger,
 * and the statements drawn from it.
 *
 * Tables, views and functions: finance.ledger_account, finance.ledger_period, finance.party,
 * finance.voucher, finance.voucher_line, finance.ledger_entry, finance.v_trial_balance,
 * finance.v_account_balance, finance.v_debtor_ageing, finance.post_voucher(),
 * finance.reverse_voucher(), finance.close_ledger_year() — all migration 203. The number series a
 * journal draws on (finance.next_document_no), the draft reversal (finance.raise_reversal) and the
 * draft year-end closing (finance.raise_year_closing) are migration 242.
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
const { toCsv } = require('../lib/financeCsv')
const { periodReadiness, outstandingOf, yearFacts } = require('./finance-accounting')

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
  'write_off', 'closing', 'reversal', 'supplier_invoice', 'payment', 'depreciation', 'asset_disposal', 'payroll']
// Raised by their own documents (creditors, the asset register), never typed as a journal. A payroll
// voucher is deliberately NOT here: the salaries journal has no document behind it to withdraw
// through, so its draft is edited and discarded like a journal draft (migration 243, §3).
const DOCUMENT_VOUCHER_TYPES = ['reversal', 'supplier_invoice', 'payment', 'depreciation', 'asset_disposal']
// The vouchers an accountant raises here with no outside document behind them, and the number
// series (finance.next_document_no, migrations 242 and 243) each draws on when no number is typed.
// A receipt, a rates bill and a closing voucher carry a number from elsewhere, so theirs is typed.
const ISSUED_NUMBER_KINDS = {
  journal: 'journal', credit_note: 'credit_note', write_off: 'write_off', opening: 'opening',
}
// The prefixes of every series finance.next_document_no (migrations 242 and 243) issues onto a
// VOUCHER: receipt RC, bank deposit BD, opening OB, supplier invoice SI, payment PV, depreciation
// DP, asset disposal AD, journal JV, credit note CN, write-off WO, year-end closing YC, salaries
// journal SJ. Each number is the prefix, a hyphen and seven digits. (A cashier session, CS, and an
// asset, FA, are numbered too, but never onto a voucher.) A typed voucher number of that shape is
// refused: typed ahead of its series, it would take a number the series has yet to reach, and when
// the series reached it the insert would hit uq_voucher_no, roll the counter back, and draw the
// same number on every later attempt.
const ISSUED_VOUCHER_PREFIXES = ['RC', 'BD', 'OB', 'SI', 'PV', 'DP', 'AD', 'JV', 'CN', 'WO', 'YC', 'SJ']
const ISSUED_VOUCHER_NUMBER = new RegExp(`^(${ISSUED_VOUCHER_PREFIXES.join('|')})-\\d{7}$`, 'i')

/**
 * The refusal for a typed voucher number in the form of an issued one, or null when it may be used.
 * `blankIssues` is true where leaving the number blank has one issued, and the message then says so.
 */
function reservedNumberRefusal(typed, { blankIssues = false } = {}) {
  const no = normaliseCode(typed).toUpperCase()
  if (!ISSUED_VOUCHER_NUMBER.test(no)) return null
  return {
    status: 400, error: 'number_reserved',
    message: `${no} is in the form of a number the ledger issues from its own series, and typing it `
      + 'would block that series when it reaches the same number. '
      + (blankIssues ? 'Leave the number blank to have one issued, or type the number of the document.'
        : 'Type the number of the document instead.'),
  }
}
/**
 * The voucher types raised by a system process, never typed (accounting audit M5, security audit
 * H4), each with what a person calls it and where it is raised. A hand-typed `closing` would make
 * the year read closed and drop out of every 'before' statement; a hand `receipt` would bypass the
 * cash office's gapless series and its cash-up; a hand `rates_bill` would raise a receivable no
 * rates bill stands behind. `opening` stays creatable: the spec (§6.2, §7.2) has an accountant raise
 * opening balances here, numbered OB-.
 */
const SYSTEM_VOUCHER_TYPES = {
  closing: ['year-end closing voucher', 'the year-end close under Period Close'],
  receipt: ['receipt', 'the cash office, or by Rates, when the money is received'],
  rates_bill: ['rates bill', 'a billing run under Rates'],
  reversal: ['reversal', 'reversing a posted voucher'],
  supplier_invoice: ['supplier invoice voucher', 'Creditors when the invoice is captured'],
  payment: ['payment voucher', 'Creditors when the payment is prepared'],
  depreciation: ['depreciation voucher', 'a depreciation run in the Asset Register'],
  asset_disposal: ['asset disposal voucher', 'a disposal in the Asset Register'],
  payroll: ['salaries journal', 'the salaries journal screen, from the month\'s totals'],
}
/** The types a person may raise by hand: journal, opening, credit note, write-off. */
const CREATABLE_VOUCHER_TYPES = VOUCHER_TYPES.filter((t) => !SYSTEM_VOUCHER_TYPES[t])

const withArticle = (noun) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`

/** The refusal for a hand-made voucher of a system type, or null. PURE. */
function systemTypeRefusal(type) {
  const known = SYSTEM_VOUCHER_TYPES[type]
  if (!known) return null
  const [label, where] = known
  const sentence = withArticle(label)
  return {
    status: 400, error: 'system_type',
    message: `${sentence[0].toUpperCase()}${sentence.slice(1)} is raised by ${where}; it cannot be typed.`,
  }
}

/**
 * What each line column names, the table it names it in, and what a person calls it. Every one is
 * checked against the caller's own council before a draft is written (security audit H2); the
 * table names are constants, never taken from the request.
 */
const LINE_REFERENCES = [
  ['ledger_account_id', 'finance.ledger_account', 'ledger account'],
  ['party_id', 'finance.party', 'party'],
  ['against_voucher_id', 'finance.voucher', 'voucher to settle'],
  ['department_id', 'finance.department', 'department'],
  ['programme_id', 'finance.programme', 'programme'],
  ['activity_id', 'finance.activity', 'activity'],
  ['project_id', 'finance.project', 'project'],
  ['budget_line_id', 'finance.budget_line', 'budget line'],
]

/**
 * The first reference of a draft that is not the caller's council's, as a refusal, or null.
 *
 * One query per kind, each naming the authority explicitly rather than trusting row-level security
 * (whose read policy also shows a combination authority's rows to its members). A row that does not
 * exist and a row of another council get the same sentence, so the refusal says nothing about what
 * another council holds (security audit L6). The database holds the same rule
 * (finance.assert_voucher_line_same_authority, migration 242); this is the legible refusal.
 */
async function foreignReference(db, authorityId, lines, financialYearId = null) {
  if (financialYearId) {
    const { rows } = await db.query(
      'SELECT 1 FROM finance.financial_year y WHERE y.id = $1 AND y.authority_id = $2',
      [financialYearId, authorityId],
    )
    if (!rows[0]) {
      return { status: 400, error: 'foreign_reference', message: 'The financial year named is not in this council\'s records.' }
    }
  }
  for (const [column, table, label] of LINE_REFERENCES) {
    const named = lines.map((l) => l[column] || null)
    if (named.every((id) => id === null)) continue
    const { rows } = await db.query(
      `SELECT x.ord::int AS line_no
         FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, ord)
        WHERE x.id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = x.id AND t.authority_id = $2)
        ORDER BY x.ord LIMIT 1`, [named, authorityId],
    )
    if (rows[0]) {
      return {
        status: 400, error: 'foreign_reference',
        message: `Line ${rows[0].line_no} names ${withArticle(label)} that is not in this council's records.`,
      }
    }
  }
  return null
}

/**
 * The document a voucher was raised from, if any: `{ kind, id, label }`. Each table links its
 * voucher by a unique column (migrations 205, 207, 213, 214); a hand-keyed journal is in none. $1 is
 * the voucher, $2 the caller's authority.
 */
const VOUCHER_SOURCE_SQL = `SELECT s.kind, s.id::text AS id, s.label FROM (
           SELECT 1 AS o, 'supplier_invoice' AS kind, d.id, d.invoice_no AS label
             FROM finance.supplier_invoice d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 2, 'supplier_payment', d.id, d.payment_no
             FROM finance.supplier_payment d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 3, 'depreciation_run', d.id, d.run_no
             FROM finance.depreciation_run d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 4, 'asset_disposal', d.id, d.asset_no
             FROM finance.fixed_asset d WHERE d.disposal_voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 5, 'bank_deposit', d.id, d.deposit_no
             FROM finance.bank_deposit d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 6, 'rates_bill', d.id, d.bill_no
             FROM finance.rates_bill d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 7, 'rates_receipt', d.id, d.receipt_no
             FROM finance.rates_receipt d WHERE d.voucher_id = $1 AND d.authority_id = $2
           UNION ALL
           SELECT 8, 'cash_receipt', d.id, d.receipt_no
             FROM finance.cash_receipt d WHERE d.voucher_id = $1 AND d.authority_id = $2
         ) s ORDER BY s.o LIMIT 1`

/** What a person calls each kind of source document. */
const SOURCE_LABELS = {
  supplier_invoice: 'supplier invoice', supplier_payment: 'supplier payment',
  depreciation_run: 'depreciation run', asset_disposal: 'asset disposal', bank_deposit: 'bank deposit',
  rates_bill: 'rates bill', rates_receipt: 'rates receipt', cash_receipt: 'cash receipt',
}

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

/** The most parties the debtor ageing lists per book (currency). The Debtors page says so. */
const AGEING_PARTY_CAP = 200

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

// ── B12: the statements (accounting audit M7, S13, S14) ─────────────────────────────────────

/**
 * The council's own calendar (review m3). A statement's default date is today IN HARARE: the hosted
 * database's clock runs in UTC, two hours behind, and between midnight and two in the morning its
 * CURRENT_DATE is still yesterday.
 */
const COUNCIL_TIME_ZONE = 'Africa/Harare'

/** What the position prints for finance.ledger_balances' row with no account (migration 242). */
const UNCLOSED_SURPLUS_LABEL = 'Surplus or deficit of earlier years not yet closed'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

/** '1993-12-31' → '31 December 1993'. Text only: no Date object, so no time zone. PURE. */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso))
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`longDate: ${JSON.stringify(iso)} is not an ISO date`)
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** 'a', 'a and b', 'a, b and c'. PURE. */
const listed = (items) => (items.length < 2 ? items.join('')
  : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/**
 * The counter-side groups of the cash statement, in the order it prints them, each with the rule
 * that puts an account in it. The first rule that matches wins. There is no "cash" group: a bank or
 * cash account is the cash side of a voucher, never its counter-side (accounting audit S13 b).
 * `counterGroupSql` builds the SQL CASE from this same table and `counterGroupOf` reads it in
 * JavaScript, so the unit tests and the statement cannot disagree.
 */
const COUNTER_GROUPS = [
  { group: 'revenue', label: 'Revenue', column: 'root_type', value: 'revenue' },
  { group: 'expense', label: 'Expenditure', column: 'root_type', value: 'expense' },
  { group: 'receivable', label: 'Debtors', column: 'account_type', value: 'receivable' },
  { group: 'payable', label: 'Creditors', column: 'account_type', value: 'payable' },
  { group: 'tax', label: 'Taxes', column: 'account_type', value: 'tax' },
  { group: 'fixed_asset', label: 'Property, plant and equipment', column: 'account_type', value: 'fixed_asset' },
  { group: 'other_asset', label: 'Other assets', column: 'root_type', value: 'asset' },
  { group: 'liability', label: 'Other liabilities', column: 'root_type', value: 'liability' },
  { group: 'equity', label: 'Net assets and equity', column: null, value: null },
]
const COUNTER_LABELS = Object.fromEntries(COUNTER_GROUPS.map((g) => [g.group, g.label]))

/** The counter-side group of an account. A bank or cash account has none, and is refused. PURE. */
function counterGroupOf(rootType, accountType) {
  if (accountType === 'bank' || accountType === 'cash') {
    throw new Error('counterGroupOf: a bank or cash account is the cash side, not a counter-side')
  }
  const account = { root_type: rootType, account_type: accountType }
  return COUNTER_GROUPS.find((g) => g.column === null || account[g.column] === g.value).group
}

/** The SQL CASE that gives `alias`'s counter-side group. Built only from COUNTER_GROUPS. PURE. */
function counterGroupSql(alias) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error(`counterGroupSql: ${JSON.stringify(alias)} is not an alias`)
  const whens = COUNTER_GROUPS.filter((g) => g.column)
    .map((g) => `WHEN ${alias}.${g.column} = '${g.value}' THEN '${g.group}'`)
  const otherwise = COUNTER_GROUPS.find((g) => !g.column).group
  return `CASE ${whens.join(' ')} ELSE '${otherwise}' END`
}

/**
 * The cash statement's note, in the JSON and in the CSV. A fixed text: it states what the statement
 * is not (accounting audit S13 c) and the three rules it is built on (S13 a and b).
 */
const CASH_STATEMENT_NOTE = 'This is a statement of cash receipts and payments. It is not a cash flow '
  + 'statement under IPSAS 2: it does not classify cash flows as operating, investing or financing. '
  + 'Each book\'s receipts and payments leave out money moved between the council\'s own bank and cash '
  + 'accounts; each account\'s own row keeps those movements. Opening-balance and year-end closing '
  + 'vouchers are not receipts or payments: an opening-balance voucher dated in the range is part of '
  + 'the opening figure. Each voucher that moves cash is analysed by its other lines, grouped by what '
  + 'they are; a group\'s net goes under inflows when the voucher brought cash in and under outflows when '
  + 'it paid cash out, so the inflows add up to the receipts and the outflows to the payments exactly. A '
  + 'line that runs against its voucher, such as tax withheld from a payment or a bank charge taken from '
  + 'a receipt, shows as a negative figure in that column. A voucher with several bank or cash lines is '
  + 'analysed whole, so nothing is apportioned or rounded.'

/**
 * What a statement does not yet contain, as sentences, from facts read from the ledger (accounting
 * audit M7: these were fixed sentences, and false once payables, the bank reconciliation and the
 * asset register existed). PURE: the facts are read by the route.
 *   payableAccounts    the number of creditors (payable) control accounts in the chart
 *   unreconciledBanks  [{ code, name, currency, reconciled_to }] bank accounts with an entry dated
 *                      after the last reconciled statement (reconciled_to null: none ever)
 *   ppeWithoutAssets   books whose fixed-asset accounts carry a balance with no asset registered
 *   asAt, yearLabel    the statement's date and its year
 *   openPeriods        period numbers still open, or null when the statement is not at the year end
 *   statement          'position' (the default) or 'performance': the payables sentence differs
 */
function incompleteSentences({
  statement = 'position', payableAccounts, unreconciledBanks, ppeWithoutAssets, asAt, yearLabel, openPeriods,
}) {
  const out = []
  if (payableAccounts === 0) {
    // Worded for the statement it is printed on (review m6).
    out.push(statement === 'performance'
      ? 'The chart has no creditors (payable) control account, so expenditure is recorded only when it is '
        + 'paid: goods and services received and not yet paid for are missing from this statement.'
      : 'The chart has no creditors (payable) control account, so this statement shows what the '
        + 'council is owed and not what it owes.')
  }
  for (const b of unreconciledBanks) {
    out.push(b.reconciled_to
      ? `The ${b.currency} balance of bank account ${b.code} ${b.name} is reconciled only to `
        + `${longDate(b.reconciled_to)}; later entries are not yet agreed to a bank statement.`
      : `The ${b.currency} balance of bank account ${b.code} ${b.name} has never been reconciled to a bank statement.`)
  }
  for (const book of ppeWithoutAssets) {
    out.push(`The property, plant and equipment accounts carry a balance in the ${book} book, but the `
      + `asset register holds no ${book} asset acquired by ${longDate(asAt)}, so no depreciation has `
      + 'been charged against it.')
  }
  if (openPeriods && openPeriods.length) {
    out.push(openPeriods.length === 1
      ? `Period ${openPeriods[0]} of ${yearLabel} is still open, so these year-end figures may still change.`
      : `Periods ${listed(openPeriods.map(String))} of ${yearLabel} are still open, so these year-end figures may still change.`)
  }
  return out
}

/**
 * A reversal of a year-end closing is dated the closing's own day (B11 review N1): every
 * closing-kind posting then touches only the final period, and no other date could be posted
 * anyway. The refusal, or null. `original` is the voucher being reversed. PURE.
 */
function closingReversalDateRefusal(original, requested) {
  if (!original || original.voucher_type !== 'closing' || !requested || requested === original.posting_date) return null
  return {
    status: 400, error: 'bad_date',
    message: `A reversal of the year-end closing ${original.voucher_no} is dated the same day as the closing, `
      + `${original.posting_date}, not ${requested}. Leave the date out, or give ${original.posting_date}.`,
  }
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

  // Migration 242 (B-SOD). Checked first: the same sentence for a row of another council and a row
  // that does not exist, so nothing below can name another council's account or voucher.
  if (/is not in this council's records/.test(message)) {
    return { status: 400, error: 'foreign_reference', message: `${message[0].toUpperCase()}${message.slice(1)}.` }
  }
  if (/raised only by the year-end close/.test(message)) {
    return {
      status: 400, error: 'system_type',
      message: 'A year-end closing voucher is raised by the year-end close under Period Close; it cannot be typed.',
    }
  }
  if (/already has a reversal, .* waiting to be posted/.test(message)) {
    return {
      status: 409, error: 'reversal_pending',
      message: `${message[0].toUpperCase()}${message.slice(1)}. Have it posted from the To post queue, or discard it and raise the reversal again.`,
    }
  }
  if (constraint === 'uq_voucher_one_live_reversal') {
    return {
      status: 409, error: 'reversal_pending',
      message: 'This voucher already has a reversal waiting to be posted. Have it posted, or discard it first.',
    }
  }

  // B11: the year-end close raised as a draft (finance.raise_year_closing, migration 242).
  const sentence = () => `${message[0].toUpperCase()}${message.slice(1)}.`
  if (/^a year-end closing is dated the last day of the year/.test(message)) {
    return { status: 400, error: 'bad_date', message: sentence() }
  }
  // B12: finance.raise_reversal refuses another date for a reversal of a closing (B11 review N1).
  if (/^a reversal of the year-end closing .* is dated the same day as the closing/.test(message)) {
    return { status: 400, error: 'bad_date', message: sentence() }
  }
  if (/must be closed before its year end/.test(message)) {
    return { status: 409, error: 'periods_open', message: sentence() }
  }
  // Its own key (review M9): `period_locked` means a PATCH of a locked period, and only that.
  if (/is locked, so no year-end closing can be posted into it/.test(message)) {
    return {
      status: 409, error: 'final_period_locked',
      message: `${sentence()} A locked period is final: correct this book in the next year.`,
    }
  }
  if (/already has a closing, .* waiting to be posted/.test(message)) {
    return {
      status: 409, error: 'closing_pending',
      message: `${sentence()} Have it posted from the To post queue, or discard it and raise the close again.`,
    }
  }
  if (/has no revenue or expense balance to close/.test(message)) {
    return { status: 409, error: 'nothing_to_close', message: sentence() }
  }
  if (/no postable accumulated-surplus account exists/.test(message)) {
    return {
      status: 409, error: 'no_surplus_account',
      message: 'No postable accumulated-surplus account exists in the chart. Mark the equity account that '
        + 'carries accumulated surplus, then raise the close again.',
    }
  }

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

// ── Period status changes (B11; accounting audit S11, M1; ruling "B11 design") ──────────────────

/**
 * Why a period may not move from its status to `next`, or null. Pure: the route reads the facts
 * (finance-accounting.js yearFacts). The PATCH refuses with it, and the periods list sends what it
 * would answer for a lock and a reopen (`lock_refusal`, `reopen_refusal`), so the page never works
 * the rule out for itself and the two cannot drift.
 *
 *   period                 { period_no, status }
 *   next                   'open' | 'closed' | 'locked'
 *   yearLabel              the financial year's label, for the sentence
 *   isFinal                the period holds the year's last day (the closing voucher posts into it)
 *   unclosedBooks          currencies with a revenue or expense account not nil in the year
 *   standingClosings       [{ currency, voucher_no }] posted closings of the year not reversed
 *   closingReversalPending a draft reversal of one of the year's closings is waiting to be posted
 *
 * The rules: a locked period is final; a lock comes only after a close, so the close and its
 * readiness are on the record first (S11a); the final period is not locked while a book still has
 * revenue or expenditure to close, or the close could never be posted (S11c, M1), nor while a
 * reversal of the closing waits, which could then never post (review M8); and no period of a year
 * with a standing closing is reopened until the closing is reversed (the ruling).
 */
function periodChangeRefusal({
  period, next, yearLabel, isFinal = false, unclosedBooks = [], standingClosings = [], closingReversalPending = false,
}) {
  const name = `Period ${period.period_no}`
  if (period.status === 'locked') {
    return {
      status: 409, error: 'period_locked',
      message: `${name} is locked, which is final. A locked period is what a council sets after the `
        + 'audit; an adjustment after it belongs in a later period.',
    }
  }
  if (next === period.status) {
    return { status: 409, error: 'no_change', message: `${name} is already ${next}.` }
  }
  if (next === 'locked' && period.status !== 'closed') {
    return {
      status: 409, error: 'lock_needs_close',
      message: `${name} is open. Close it first: a period is locked only once it is closed, so what was `
        + 'outstanding when it closed is on the record.',
    }
  }
  if (next === 'locked' && isFinal && unclosedBooks.length) {
    const books = unclosedBooks.join(' and ')
    return {
      status: 409, error: 'year_not_closed',
      message: `${name} is the last of ${yearLabel}, and the ${books} book${unclosedBooks.length === 1 ? ' still has' : 's still have'} `
        + 'revenue or expenditure to close. Close the year first: once the last period is locked, no '
        + 'closing can be posted into it.',
    }
  }
  if (next === 'locked' && isFinal && closingReversalPending) {
    return {
      status: 409, error: 'closing_reversal_pending',
      message: `${name} is the last of ${yearLabel}, and a reversal of its year-end closing is waiting to be `
        + 'posted. Have it posted, or discard it, first: once the last period is locked it could never be posted.',
    }
  }
  if (next === 'open' && standingClosings.length) {
    // One sentence per book. A book with something left after its closing reads as a remainder,
    // not as closed; a book closed twice (a remainder closed after it) names both.
    const books = [...new Set(standingClosings.map((c) => c.currency))]
    const said = books.map((currency) => {
      const nos = standingClosings.filter((c) => c.currency === currency).map((c) => c.voucher_no).join(' and ')
      return unclosedBooks.includes(currency)
        ? `A remainder is left in the ${currency} book of ${yearLabel} after ${nos}.`
        : `The ${currency} book of ${yearLabel} is closed by ${nos}.`
    }).join(' ')
    return {
      status: 409, error: 'year_closed',
      message: `${said} Reverse the year-end closing first.`,
    }
  }
  return null
}

/** What the PATCH would answer for a lock and for a reopen of this period, as `{ error, message }` or null. */
function periodRefusals(facts) {
  const brief = (r) => (r ? { error: r.error, message: r.message } : null)
  return {
    lock_refusal: brief(periodChangeRefusal({ ...facts, next: 'locked' })),
    reopen_refusal: brief(periodChangeRefusal({ ...facts, next: 'open' })),
  }
}

// ── Over-application ──────────────────────────────────────────────────────────────────────────

/**
 * The first open item a draft voucher would take below nil, or null.
 *
 * A line on a receivable or payable control account that names a voucher in against_voucher_id
 * applies to that voucher's open item: on a receivable, credit less debit; on a payable, debit
 * less credit. The open item is what the bill raised for that party in that book (its own debits
 * to receivable, or credits to payable, acting on nothing) less the net of every POSTED entry that
 * acts on it, through against_voucher_id or as part of a reversal of it: the same reading as
 * finance.v_debtor_ageing (migration 211) and finance.v_creditor_open (migration 213). Drafts
 * claim nothing until they are posted. A line naming a voucher that raised nothing for that party
 * in that book is not judged here.
 *
 * Every figure is computed by Postgres. Runs inside the posting transaction: a transaction-scoped
 * advisory lock per open item, taken in a fixed order, makes two postings against the same item
 * wait for each other, and under READ COMMITTED the second reads what the first committed.
 * Every read names the caller's authority explicitly, on top of row-level security.
 * Returns `{ voucher_no, currency, open_amount, applied_amount }` as text.
 */
async function overApplication(client, voucherId, authorityId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('finance.open_item:' || t.id::text, 0))
       FROM (SELECT DISTINCT l.against_voucher_id AS id
               FROM finance.voucher_line l
               JOIN finance.ledger_account la ON la.id = l.ledger_account_id
              WHERE l.voucher_id = $1 AND l.against_voucher_id IS NOT NULL AND l.authority_id = $2
                AND la.account_type IN ('receivable', 'payable')
              ORDER BY 1) t`, [voucherId, authorityId],
  )
  const { rows } = await client.query(
    `WITH applied AS (
       SELECT l.against_voucher_id AS target, v.currency::text AS currency, l.party_id, la.account_type,
              sum(CASE WHEN la.account_type = 'receivable' THEN l.credit - l.debit
                       ELSE l.debit - l.credit END) AS amount
         FROM finance.voucher_line l
         JOIN finance.voucher v ON v.id = l.voucher_id
         JOIN finance.ledger_account la ON la.id = l.ledger_account_id
        WHERE l.voucher_id = $1 AND l.against_voucher_id IS NOT NULL
          AND l.authority_id = $2 AND v.authority_id = $2 AND la.authority_id = $2
          AND la.account_type IN ('receivable', 'payable')
        GROUP BY l.against_voucher_id, v.currency, l.party_id, la.account_type
     ), posted AS (
       SELECT e.voucher_id, e.currency::text AS currency, e.party_id, la.account_type, e.debit, e.credit,
              COALESCE(e.against_voucher_id, ev.reverses_voucher_id) AS acts_on
         FROM finance.ledger_entry e
         JOIN finance.voucher ev ON ev.id = e.voucher_id
         JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE la.account_type IN ('receivable', 'payable') AND e.voucher_id <> $1
          AND e.authority_id = $2 AND la.authority_id = $2
          AND (e.voucher_id IN (SELECT target FROM applied)
               OR e.against_voucher_id IN (SELECT target FROM applied)
               OR ev.reverses_voucher_id IN (SELECT target FROM applied))
     ), open_item AS (
       SELECT a.target, a.currency, a.amount,
              COALESCE(sum(CASE WHEN a.account_type = 'receivable' THEN p.debit ELSE p.credit END)
                         FILTER (WHERE p.voucher_id = a.target AND p.acts_on IS NULL), 0) AS raised,
              COALESCE(sum(CASE WHEN a.account_type = 'receivable' THEN p.credit - p.debit
                                ELSE p.debit - p.credit END)
                         FILTER (WHERE p.acts_on = a.target), 0) AS settled
         FROM applied a
         LEFT JOIN posted p ON p.currency = a.currency AND p.account_type = a.account_type
                           AND NOT p.party_id IS DISTINCT FROM a.party_id
                           AND (p.voucher_id = a.target OR p.acts_on = a.target)
        GROUP BY a.target, a.currency, a.party_id, a.account_type, a.amount
     )
     SELECT tv.voucher_no, o.currency,
            (o.raised - o.settled)::numeric(18,2)::text AS open_amount,
            o.amount::numeric(18,2)::text AS applied_amount
       FROM open_item o
       JOIN finance.voucher tv ON tv.id = o.target AND tv.authority_id = $2
      WHERE o.amount > 0 AND o.raised > 0 AND o.raised - o.settled - o.amount < 0
      ORDER BY tv.voucher_no
      LIMIT 1`, [voucherId, authorityId],
  )
  return rows[0] || null
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
   * Fastify's own refusals (schema, media type, unreadable JSON) in the shape every route here
   * answers in, `{ success: false, error, message }` (review M5). Set as the `errorHandler` of the
   * routes B11 touches; anything else is a fault, logged and answered as one.
   */
  const shapedErrors = (error, request, reply) => {
    if (error.validation) {
      return fail(reply, 400, 'bad_request', `The request is not in the form this action takes: ${error.message}.`)
    }
    const code = typeof error.code === 'string' ? error.code : ''
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || error.statusCode === 415) {
      return fail(reply, 415, 'unsupported_media_type', 'This is sent as JSON, or with no body at all.')
    }
    if (code.startsWith('FST_ERR_CTP_') || error.statusCode === 400) {
      return fail(reply, 400, 'bad_request', 'The body could not be read as JSON. Send JSON, or no body at all.')
    }
    fastify.log.error({ err: error }, 'ledger route')
    return fail(reply, error.statusCode && error.statusCode < 500 ? error.statusCode : 500, 'ledger_error',
      'The ledger could not do that just now.')
  }

  /**
   * Why a draft cannot be changed (`editing`) or discarded through the ledger, or null.
   *
   * A rates bill's amount is a generated column and a receipt's is on the receipt, but each posts
   * through a draft voucher, and so do supplier invoices, payments, depreciation runs, disposals,
   * bank deposits and cash receipts. Replacing the lines would make the book of account disagree
   * with the document, and cancelling the voucher would orphan it. Run on the locked transaction,
   * so the answer holds until the change commits (B10 review carry). A reversal's lines mirror its
   * original and are not edited either; it may be discarded.
   */
  const documentRefusal = async (db, voucher, authorityId, editing) => {
    const { rows } = await db.query(VOUCHER_SOURCE_SQL, [voucher.id, authorityId])
    const source = rows[0]
    if (source && (source.kind === 'rates_bill' || source.kind === 'rates_receipt')) {
      const document = `${SOURCE_LABELS[source.kind]} ${source.label}`
      return {
        status: 409, error: 'voucher_belongs_to_rates',
        message: editing
          ? `Voucher ${voucher.voucher_no} is the double entry of ${document}, and its lines are `
            + 'computed from that document. Cancel the billing run or the receipt under Rates and raise it again.'
          : `Voucher ${voucher.voucher_no} is the double entry of ${document}. It is withdrawn by `
            + 'cancelling the billing run or the receipt under Rates, which keeps the record of why.',
      }
    }
    if (source || (DOCUMENT_VOUCHER_TYPES.includes(voucher.voucher_type) && voucher.voucher_type !== 'reversal')) {
      const document = source ? `${SOURCE_LABELS[source.kind]} ${source.label}`
        : `its ${voucher.voucher_type.replace(/_/g, ' ')} document`
      return {
        status: 409, error: 'document_voucher',
        message: editing
          ? `Voucher ${voucher.voucher_no} is the double entry of ${document}, and its lines are written by `
            + 'that document. Change or discard the document itself, or reverse it once posted.'
          : `Voucher ${voucher.voucher_no} is the double entry of ${document}. It is withdrawn through `
            + 'that document, which keeps the record of why.',
      }
    }
    if (editing && voucher.voucher_type === 'reversal') {
      return {
        status: 409, error: 'reversal_lines',
        message: `Voucher ${voucher.voucher_no} is a reversal, and its lines mirror the voucher it reverses. `
          + 'Discard it and raise the reversal again if it is wrong.',
      }
    }
    return null
  }

  /** The refusal for somebody other than the preparer, in words (accounting M4, security H1). */
  const notPreparer = (voucher, act) => ({
    status: 403, error: 'not_preparer',
    message: `Only the person who prepared voucher ${voucher.voucher_no} may ${act} it. `
      + (act === 'change' ? 'Copy it into a new draft of your own instead.' : 'Ask them to discard it.'),
  })

  /** A draft's line count and totals, summed in SQL and returned as text. */
  const draftTotals = async (db, voucherId) => (await db.query(
    `SELECT count(*)::int AS line_count,
            COALESCE(sum(l.debit), 0)::text AS debit_total,
            COALESCE(sum(l.credit), 0)::text AS credit_total,
            (COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0))::text AS difference
       FROM finance.voucher_line l WHERE l.voucher_id = $1`, [voucherId],
  )).rows[0]

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

  /**
   * The periods, with what a lock and a reopen of each would be told (B11): `is_final` (it holds
   * its year's last day), `lock_refusal` and `reopen_refusal`, each `{ error, message }` or null,
   * from periodChangeRefusal, the PATCH's own rule, over yearFacts, the PATCH's own reads. The page
   * shows them instead of working the rule out (which would need the year's balances).
   */
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
    const authorityId = request.user.authority_id
    const { rows } = await pg.query(
      `SELECT lp.id, lp.financial_year_id, fy.label AS financial_year_label, lp.period_no, lp.label,
              ${dateText('lp', 'from_date', 'to_date')},
              lp.status, lp.closed_at, lp.locked_at,
              COALESCE(cu.full_name, cu.name) AS closed_by_name,
              COALESCE(lu.full_name, lu.name) AS locked_by_name,
              (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.ledger_period_id = lp.id) AS entry_count,
              (lp.to_date >= fy.end_date) AS is_final
         FROM finance.ledger_period lp
         JOIN finance.financial_year fy ON fy.id = lp.financial_year_id
         LEFT JOIN public.users cu ON cu.id = lp.closed_by
         LEFT JOIN public.users lu ON lu.id = lp.locked_by
        WHERE ($1::uuid IS NULL OR lp.financial_year_id = $1::uuid)
          AND ($2::text IS NULL OR lp.status = $2::text)
          AND lp.authority_id = $3
        ORDER BY fy.start_date, lp.period_no`,
      [q.financial_year_id || null, q.status || null, authorityId],
    )
    // The year's facts once per year listed, one query at a time.
    const facts = new Map()
    for (const r of rows) {
      if (!facts.has(r.financial_year_id)) facts.set(r.financial_year_id, await yearFacts(pg, r.financial_year_id, authorityId))
    }
    const periods = rows.map((r) => ({
      ...r,
      ...periodRefusals({
        ...facts.get(r.financial_year_id), period: r, yearLabel: r.financial_year_label, isFinal: r.is_final,
      }),
    }))
    return ok(reply, { periods, total: periods.length })
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
   * Change a period's status: close, reopen or lock.
   *
   * `locked` is final: a locked period is what a council sets after the audit and this route will
   * not take it back out. A period is locked only from `closed`, and locking keeps who closed it and
   * when (accounting audit S11). The final period is not locked while a book of the year still has
   * revenue or expenditure to close. Reopening a `closed` period is allowed, because a late
   * adjustment before the audit is ordinary, unless the year's book is closed: then the closing is
   * reversed first (ruling "B11 design").
   *
   * HISTORY. Every change writes an audit row (admin_audit_event, FIN_LEDGER) with the status it
   * left and the one it reached; a reopen also records who had closed it and when, since the period
   * row clears them. Closing and locking record the readiness checks that were not clear at that
   * moment, `readiness: [{ key, count }]` (spec §6.7: the list informs, the accountant decides).
   */
  fastify.patch('/finance/ledger/periods/:id', {
    ...canManagePeriods,
    errorHandler: shapedErrors,
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: uuid } },
      body: {
        type: 'object', required: ['status'], additionalProperties: false,
        properties: { status: { type: 'string', enum: PERIOD_STATUSES } },
      },
    },
  }, async (request, reply) => {
    const authorityId = request.user.authority_id
    const next = request.body.status

    // What stands in the way, recorded with a close or a lock: read first, outside the transaction
    // below, one query at a time. The list informs and never refuses, so a failed read is recorded
    // as failed and the change goes ahead (review M3).
    let outstanding = null
    let readinessError = false
    if (next !== 'open') {
      try {
        const readiness = await periodReadiness(pg, request.params.id, authorityId)
        if (!readiness) return fail(reply, 404, 'not_found', 'No such accounting period.')
        outstanding = outstandingOf(readiness)
      } catch (err) {
        fastify.log.warn({ err }, 'period readiness for the audit row')
        readinessError = true
      }
    }

    // SERIALISED WITH CLOSING POSTS (review I2). The period row is locked FOR UPDATE before any fact
    // is read, and a reopen also locks the year's final period. Posting a closing, or a reversal of
    // one, takes the final period FOR SHARE (the post route, and finance.validate_ledger_entry), so
    // either this change waits for the posting to commit and then reads the year after it, or the
    // posting waits for this change and then reads the period as it is left. Without it, a lock read
    // "nothing to close" while a reversal of the closing was being posted, and both committed.
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const stop = async (status, error, message) => {
        await client.query('ROLLBACK')
        return fail(reply, status, error, message)
      }
      const { rows: found } = await client.query(
        `SELECT lp.id, lp.period_no, lp.label, lp.status, lp.financial_year_id,
                lp.from_date::text AS from_date, lp.to_date::text AS to_date, lp.closed_at, lp.closed_by,
                fy.label AS year_label, fy.end_date::text AS year_end
           FROM finance.ledger_period lp
           JOIN finance.financial_year fy ON fy.id = lp.financial_year_id
          WHERE lp.id = $1 AND lp.authority_id = $2
            FOR UPDATE OF lp`, [request.params.id, authorityId])
      const current = found[0]
      if (!current) return stop(404, 'not_found', 'No such accounting period.')
      // ISO dates compare as text; a date, not an amount.
      const isFinal = current.to_date >= current.year_end
      if (next === 'open' && !isFinal) {
        await client.query(
          `SELECT lp.id FROM finance.ledger_period lp
            WHERE lp.financial_year_id = $1 AND lp.authority_id = $2 AND lp.to_date >= $3::date
            FOR UPDATE`, [current.financial_year_id, authorityId, current.year_end])
      }
      const facts = await yearFacts(client, current.financial_year_id, authorityId)
      const refusal = periodChangeRefusal({ ...facts, period: current, next, yearLabel: current.year_label, isFinal })
      const about = {
        period_id: current.id, period_no: current.period_no, financial_year_id: current.financial_year_id,
        from: current.status, to: next,
      }
      if (refusal) {
        request.auditDetails = { action: 'period_change_refused', ...about, reason: refusal.error }
        return stop(refusal.status, refusal.error, refusal.message)
      }

      const { rows } = await client.query(
        `UPDATE finance.ledger_period
            SET status = $2,
                closed_at = CASE WHEN $2 = 'closed' THEN now() WHEN $2 = 'locked' THEN closed_at ELSE NULL END,
                closed_by = CASE WHEN $2 = 'closed' THEN $3::uuid WHEN $2 = 'locked' THEN closed_by ELSE NULL END,
                locked_at = CASE WHEN $2 = 'locked' THEN now() ELSE locked_at END,
                locked_by = CASE WHEN $2 = 'locked' THEN $3::uuid ELSE locked_by END
          WHERE id = $1 AND authority_id = $4 AND status = $5
        RETURNING id, period_no, label, status, ${dateText(null, 'from_date', 'to_date')}`,
        [current.id, next, request.user.id, authorityId, current.status],
      )
      if (!rows[0]) {
        return stop(409, 'period_changed', `Period ${current.period_no} changed while this was being done. Read it again.`)
      }
      await client.query('COMMIT')
      request.auditDetails = {
        action: next === 'open' ? 'period_reopened' : next === 'closed' ? 'period_closed' : 'period_locked',
        ...about,
        ...(next === 'open'
          ? { previously_closed_by: current.closed_by, previously_closed_at: current.closed_at }
          : { readiness: outstanding, ...(readinessError ? { readiness_error: true } : {}) }),
      }
      return ok(reply, rows[0])
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The period could not be changed.')
    } finally {
      client.release()
    }
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
          // to_post: drafts somebody else prepared, other than receipts and rates bills (which post
          // with their cash-up or billing run). mine: drafts the caller prepared.
          queue: { type: 'string', enum: ['to_post', 'mine'] },
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
        -- A cancelled voucher (a discarded draft, kept with its number: accounting audit M8) is left
        -- out unless status=cancelled is asked for.
        AND ($3::text IS NOT NULL OR v.status <> 'cancelled')
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
                 AND (l.department_id = ANY($9::uuid[]) OR l.department_id IS NULL)))
        AND ($10::text IS NULL
             OR ($10::text = 'to_post' AND v.status = 'draft' AND v.prepared_by <> $11::uuid
                 AND v.voucher_type NOT IN ('receipt', 'rates_bill'))
             OR ($10::text = 'mine' AND v.status = 'draft' AND v.prepared_by = $11::uuid))
        AND v.authority_id = $12::int`
    const params = [q.financial_year_id || null, q.voucher_type || null, q.status || null,
      q.currency || null, q.from || null, q.to || null, q.q ? `%${q.q.trim()}%` : null,
      q.party_id || null, scope, q.queue || null, request.user.id, request.user.authority_id]

    const [page, count, queues] = await Promise.all([
      pg.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.currency, v.financial_year_id,
                ${dateText('v', 'posting_date')},
                v.narration, v.reference, v.status, v.reverses_voucher_id, v.is_opening,
                v.prepared_by, v.prepared_at, v.posted_by, v.posted_at, v.version,
                v.cancelled_by, v.cancelled_at, v.cancel_reason,
                COALESCE(pu.full_name, pu.name) AS prepared_by_name,
                COALESCE(ou.full_name, ou.name) AS posted_by_name,
                rv.voucher_no AS reverses_voucher_no,
                (SELECT r.voucher_no FROM finance.voucher r
                  WHERE r.reverses_voucher_id = v.id AND r.status = 'posted' LIMIT 1) AS reversed_by_voucher_no,
                (SELECT r.voucher_no FROM finance.voucher r
                  WHERE r.reverses_voucher_id = v.id AND r.status = 'draft' LIMIT 1) AS pending_reversal_no,
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
          LIMIT $13 OFFSET $14`, [...params, q.limit, q.offset],
      ),
      pg.query(`SELECT count(*)::int AS total FROM finance.voucher v ${where}`, params),
      // The tabs' counts: the same year filter and the same confinement to votes, none of the
      // other filters, so each tab says how many it holds before it is opened.
      pg.query(
        `SELECT count(*) FILTER (WHERE v.status = 'draft' AND v.prepared_by <> $2::uuid
                                   AND v.voucher_type NOT IN ('receipt', 'rates_bill'))::int AS to_post,
                count(*) FILTER (WHERE v.status = 'draft' AND v.prepared_by = $2::uuid)::int AS mine,
                count(*) FILTER (WHERE v.status = 'posted')::int AS posted,
                count(*) FILTER (WHERE v.status <> 'cancelled')::int AS "all",
                count(*) FILTER (WHERE v.status = 'cancelled')::int AS cancelled
           FROM finance.voucher v
          WHERE ($1::uuid IS NULL OR v.financial_year_id = $1::uuid)
            AND v.authority_id = $3::int
            AND ($4::uuid[] IS NULL OR EXISTS (
                  SELECT 1 FROM finance.voucher_line l
                   WHERE l.voucher_id = v.id
                     AND (l.department_id = ANY($4::uuid[]) OR l.department_id IS NULL)))`,
        [q.financial_year_id || null, request.user.id, request.user.authority_id, scope],
      ),
    ])
    return ok(reply, {
      vouchers: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      scope_applied: scope,
      queues: queues.rows[0],
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
              COALESCE(cu.full_name, cu.name) AS cancelled_by_name,
              rv.voucher_no AS reverses_voucher_no,
              lp.period_no, lp.label AS period_label, lp.status AS period_status,
              fy.label AS financial_year_label
         FROM finance.voucher v
         LEFT JOIN public.users pu ON pu.id = v.prepared_by
         LEFT JOIN public.users ou ON ou.id = v.posted_by
         LEFT JOIN public.users cu ON cu.id = v.cancelled_by
         LEFT JOIN finance.voucher rv ON rv.id = v.reverses_voucher_id
         LEFT JOIN finance.ledger_period lp ON lp.id = v.ledger_period_id
         JOIN finance.financial_year fy ON fy.id = v.financial_year_id
        WHERE v.id = $1 AND v.authority_id = $2`, [request.params.id, request.user.authority_id],
    )
    if (!header[0]) return fail(reply, 404, 'not_found', 'No such voucher.')

    const [lines, entries, reversal, balance, source] = await Promise.all([
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
          WHERE r.reverses_voucher_id = $1 AND r.status <> 'cancelled'
          ORDER BY r.created_at LIMIT 1`, [request.params.id],
      ),
      // The SAME function the deferred constraint trigger reads (migration 203), so what a screen
      // shows before posting and what the database refuses at posting cannot disagree.
      pg.query(
        `SELECT entry_count, debit_total::text AS debit_total, credit_total::text AS credit_total,
                difference::text AS difference
           FROM finance.voucher_imbalance($1)`, [request.params.id],
      ),
      // The document the voucher was raised from (VOUCHER_SOURCE_SQL); a hand-keyed journal is in none.
      pg.query(VOUCHER_SOURCE_SQL, [request.params.id, request.user.authority_id]),
      ])

    const { rows: draftBalance } = await pg.query(
      `SELECT count(*)::int AS line_count,
              COALESCE(sum(l.debit), 0)::text AS debit_total,
              COALESCE(sum(l.credit), 0)::text AS credit_total,
              (COALESCE(sum(l.debit), 0) - COALESCE(sum(l.credit), 0))::text AS difference
         FROM finance.voucher_line l WHERE l.voucher_id = $1`, [request.params.id],
    )

    // Whether the caller may discard (cancel) this draft: the DELETE route's own rules, so the page
    // can explain rather than offer a refusal (B11, frontend review ask 4). A document's voucher is
    // withdrawn through its document; only the preparer discards; a closing needs voucher.prepare
    // or finance.ledger.close_year, anything else voucher.prepare.
    const v = header[0]
    const sourced = Boolean(source.rows[0])
      || (DOCUMENT_VOUCHER_TYPES.includes(v.voucher_type) && v.voucher_type !== 'reversal')
    const mayPrepare = await hasPermission(fastify, request, 'finance.ledger.voucher.prepare')
    const mayDiscard = v.status === 'draft' && !sourced && v.prepared_by === request.user.id
      && (mayPrepare || (v.voucher_type === 'closing' && await hasPermission(fastify, request, 'finance.ledger.close_year')))

    return ok(reply, {
      voucher: header[0],
      may_discard: mayDiscard,
      lines: lines.rows,
      entries: entries.rows,
      reversed_by: reversal.rows[0] ?? null,
      source: source.rows[0] ?? null,
      // Two balances, because they answer two questions: what the DRAFT would post, and what the
      // ledger actually holds for this voucher.
      draft_balance: draftBalance[0],
      posted_balance: balance.rows[0],
      balances: draftBalance[0].difference === '0' || Number(draftBalance[0].difference) === 0,
      note: header[0].status === 'posted'
        ? 'Posted. Its ledger entries can never be amended; a correction is a reversal voucher and '
          + 'both halves stay visible.'
        : header[0].status === 'cancelled'
          ? 'Cancelled before it was posted. Its number and lines stay on the record; it posts nothing.'
          : null,
    })
  })

  /** One draft line's columns, in the order the two INSERTs below write them. */
  const insertLines = async (db, voucherId, lines) => {
    let lineNo = 0
    for (const line of lines) {
      lineNo += 1
      await db.query(
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
    return lineNo
  }

  /**
   * Create a draft voucher with its lines, in one transaction.
   *
   * A draft posts nothing. It is checked for shape here — two sides, one of debit or credit per
   * line, readable amounts — and for balance by the database at posting, where the arithmetic is
   * done in NUMERIC. The response carries the draft's difference so a screen can say "this does not
   * balance yet" without guessing.
   *
   * WHAT MAY BE TYPED. A journal, opening, credit note or write-off. Every other type is raised by its
   * own process (SYSTEM_VOUCHER_TYPES) and refused with a sentence saying where (accounting M5,
   * security H4). Every year, account, party, settled voucher and analysis dimension named must be
   * the caller's council's (security H2).
   *
   * THE NUMBER. Sent without `voucher_no`, it is numbered from its own series, inside this
   * transaction, so a draft that fails leaves no gap. A typed number is kept as typed.
   */
  fastify.post('/finance/ledger/vouchers', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object',
        required: ['voucher_type', 'currency', 'financial_year_id', 'posting_date', 'lines'],
        additionalProperties: false,
        properties: {
          voucher_no: { type: 'string', minLength: 1, maxLength: 60 },
          // Every type is accepted by the schema so a system type gets a sentence, not a bare 400.
          voucher_type: { type: 'string', enum: VOUCHER_TYPES },
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
    const system = systemTypeRefusal(b.voucher_type)
    if (system) return fail(reply, system.status, system.error, system.message)
    const typedNo = b.voucher_no ? normaliseCode(b.voucher_no) : ''
    const numberKind = ISSUED_NUMBER_KINDS[b.voucher_type]
    const reserved = reservedNumberRefusal(typedNo, { blankIssues: Boolean(numberKind) })
    if (reserved) return fail(reply, reserved.status, reserved.error, reserved.message)
    if (!typedNo && !numberKind) {
      return fail(reply, 400, 'number_required',
        `A ${b.voucher_type.replace(/_/g, ' ')} carries the number of the document that raised it. Type it.`)
    }
    const checked = validateVoucherLines(b.lines)
    if (!checked.ok) return fail(reply, 400, checked.error, checked.message)
    const foreign = await foreignReference(pg, request.user.authority_id, checked.lines, b.financial_year_id)
    if (foreign) return fail(reply, foreign.status, foreign.error, foreign.message)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      let voucherNo = typedNo
      if (!voucherNo) {
        const { rows: issued } = await client.query(
          'SELECT finance.next_document_no(app.authority_id(), $1) AS voucher_no', [numberKind],
        )
        voucherNo = issued[0].voucher_no
      }
      const { rows: header } = await client.query(
        `INSERT INTO finance.voucher
           (voucher_no, voucher_type, currency, financial_year_id, posting_date,
            narration, reference, is_opening, status, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
         RETURNING id, voucher_no, voucher_type, currency, financial_year_id,
                   ${dateText(null, 'posting_date')}, status, prepared_by, prepared_at, version`,
        [voucherNo, b.voucher_type, b.currency, b.financial_year_id,
          b.posting_date, b.narration || null, b.reference || null,
          b.is_opening === true || b.voucher_type === 'opening', request.user.id],
      )
      const voucherId = header[0].id
      const lineNo = await insertLines(client, voucherId, checked.lines)
      const balance = await draftTotals(client, voucherId)
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'voucher_drafted', voucher_id: voucherId, voucher_no: header[0].voucher_no,
        voucher_type: header[0].voucher_type, currency: header[0].currency,
        financial_year_id: header[0].financial_year_id, posting_date: header[0].posting_date,
        version: header[0].version, line_count: balance.line_count,
        debit_total: balance.debit_total, credit_total: balance.credit_total,
      }
      const { line_count: _count, ...totals } = balance
      return ok(reply, {
        voucher: header[0],
        lines: lineNo,
        balance: totals,
        balances: Number(balance.difference) === 0,
        note: Number(balance.difference) === 0
          ? 'The draft balances. It posts nothing until somebody other than you posts it.'
          : `The draft does not balance: debits ${balance.debit_total}, credits `
            + `${balance.credit_total}. It cannot be posted until it does.`,
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be created.')
    } finally {
      client.release()
    }
  })

  /**
   * Raise the month's salaries journal as a DRAFT `payroll` voucher, numbered SJ- from its own
   * series (migration 243). Not a payroll module (decision D21 keeps one deliberately unbuilt):
   * whoever computes the salaries types the month's totals here — gross salaries and the
   * employer's statutory contributions on the debit side, PAYE, NSSA and any other deduction and
   * the net paid from the bank on the credit side — and this route writes the double entry. Each
   * line may carry the vote (department) the salary is charged to, and a statutory body (ZIMRA,
   * NSSA) as its party on a deduction line, so Tax Control and the budget reports read it.
   *
   * The draft is edited and discarded like any journal draft, and it posts nothing until somebody
   * other than its preparer posts it (POST /vouchers/:id/post).
   */
  fastify.post('/finance/ledger/salaries-journal', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object',
        required: ['currency', 'financial_year_id', 'posting_date', 'lines'],
        additionalProperties: false,
        properties: {
          currency,
          financial_year_id: uuid,
          posting_date: isoDate,
          narration: { type: 'string', maxLength: 2000 },
          reference: { type: 'string', maxLength: 120 },
          lines: {
            type: 'array', minItems: 2, maxItems: 200,
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
                budget_line_id: uuid,
                narration: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const checked = validateVoucherLines(b.lines)
    if (!checked.ok) return fail(reply, 400, checked.error, checked.message)
    const foreign = await foreignReference(pg, request.user.authority_id, checked.lines, b.financial_year_id)
    if (foreign) return fail(reply, foreign.status, foreign.error, foreign.message)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows: issued } = await client.query(
        'SELECT finance.next_document_no(app.authority_id(), $1) AS voucher_no', ['payroll'],
      )
      const voucherNo = issued[0].voucher_no
      const { rows: header } = await client.query(
        `INSERT INTO finance.voucher
           (voucher_no, voucher_type, currency, financial_year_id, posting_date,
            narration, reference, is_opening, status, prepared_by)
         VALUES ($1,'payroll',$2,$3,$4,$5,$6,false,'draft',$7)
         RETURNING id, voucher_no, voucher_type, currency, financial_year_id,
                   ${dateText(null, 'posting_date')}, status, prepared_by, prepared_at, version`,
        [voucherNo, b.currency, b.financial_year_id,
          b.posting_date, b.narration || null, b.reference || null, request.user.id],
      )
      const voucherId = header[0].id
      const lineNo = await insertLines(client, voucherId, checked.lines)
      const balance = await draftTotals(client, voucherId)
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'voucher_drafted', voucher_id: voucherId, voucher_no: header[0].voucher_no,
        voucher_type: 'payroll', currency: header[0].currency,
        financial_year_id: header[0].financial_year_id, posting_date: header[0].posting_date,
        version: header[0].version, line_count: balance.line_count,
        debit_total: balance.debit_total, credit_total: balance.credit_total,
      }
      const { line_count: _count, ...totals } = balance
      return ok(reply, {
        voucher: header[0],
        lines: lineNo,
        balance: totals,
        balances: Number(balance.difference) === 0,
        note: Number(balance.difference) === 0
          ? `Salaries journal ${voucherNo} is a balanced draft. It posts nothing until somebody `
            + 'other than you posts it.'
          : `Salaries journal ${voucherNo} does not balance: debits ${balance.debit_total}, credits `
            + `${balance.credit_total}. It cannot be posted until it does.`,
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The salaries journal could not be raised.')
    } finally {
      client.release()
    }
  })

  /**
   * Replace a draft voucher's lines, or amend its header. Its preparer only.
   *
   * Draft only. A posted voucher's lines are frozen by `trg_voucher_line_draft_only` (migration
   * 203) whatever this route does. Everything is judged under the row lock the post route also
   * takes, so an edit and a posting of the same draft serialise. Only the preparer may edit
   * (accounting M4, security H1): otherwise B could rewrite A's draft and post it with A's name on
   * it. Every edit raises `version` by one, so a poster who reviewed the earlier version is refused
   * (security H3).
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
    const authorityId = request.user.authority_id
    let checked = null
    if (b.lines) {
      checked = validateVoucherLines(b.lines)
      if (!checked.ok) return fail(reply, 400, checked.error, checked.message)
      const foreign = await foreignReference(pg, authorityId, checked.lines)
      if (foreign) return fail(reply, foreign.status, foreign.error, foreign.message)
    }
    const has = (key) => Object.prototype.hasOwnProperty.call(b, key)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const stop = async (refusal) => {
        await client.query('ROLLBACK')
        return fail(reply, refusal.status, refusal.error, refusal.message)
      }
      // Under the lock, and confined to the caller's council explicitly: a combination authority's
      // draft is readable by its members but not theirs to edit (security audit L5).
      const { rows: locked } = await client.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.status, v.prepared_by, v.version,
                ${dateText('v', 'posting_date')}, v.narration, v.reference, v.reverses_voucher_id
           FROM finance.voucher v WHERE v.id = $1 AND v.authority_id = $2 FOR UPDATE`,
        [request.params.id, authorityId],
      )
      const current = locked[0]
      if (!current) return stop({ status: 404, error: 'not_found', message: 'No such voucher.' })
      if (current.status === 'cancelled') {
        return stop({ status: 409, error: 'voucher_cancelled',
          message: `Voucher ${current.voucher_no} was cancelled and can no longer be edited. Raise a new draft instead.` })
      }
      if (current.status !== 'draft') {
        return stop({ status: 409, error: 'voucher_posted',
          message: `Voucher ${current.voucher_no} is ${current.status} and can no longer be edited. `
            + 'Correct a posted voucher with a reversal; both halves stay visible.' })
      }
      if (checked) {
        const document = await documentRefusal(client, current, authorityId, true)
        if (document) return stop(document)
      }
      if (current.prepared_by !== request.user.id) {
        request.auditDetails = { action: 'voucher_edit_refused', voucher_id: current.id, voucher_no: current.voucher_no, reason: 'not_preparer' }
        return stop(notPreparer(current, 'change'))
      }
      // A reversal's narration IS the reason it was raised with (finance.raise_reversal), which the
      // audit row and the poster rely on. It is not rewritten (fix round 1, review M-3). Checked
      // after the preparer, so somebody else is told it is not theirs to change (B-SOD review N1).
      if (current.voucher_type === 'reversal' && has('narration')) {
        return stop({ status: 409, error: 'reversal_reason',
          message: `Voucher ${current.voucher_no} is a reversal, and its narration is the reason it was raised with. `
            + 'Discard it and raise the reversal again to give a different reason.' })
      }
      // A year-end closing is computed by the close from the year's balances and dated its last day
      // (accounting audit S10); nothing in it is edited by hand (B11).
      if (current.voucher_type === 'closing') {
        return stop({ status: 409, error: 'closing_voucher',
          message: `Voucher ${current.voucher_no} is a year-end closing, and its lines and date are computed by `
            + 'the close. Discard it and raise the close again if it is wrong.' })
      }
      // B11 review N1: a draft reversal of a year-end closing keeps the closing's own date.
      if (current.voucher_type === 'reversal' && b.posting_date) {
        const { rows: [original] } = await client.query(
          `SELECT o.voucher_no, o.voucher_type, ${dateText('o', 'posting_date')}
             FROM finance.voucher o WHERE o.id = $1 AND o.authority_id = $2`,
          [current.reverses_voucher_id, authorityId])
        const misdated = closingReversalDateRefusal(original, b.posting_date)
        if (misdated) return stop(misdated)
      }

      const before = await draftTotals(client, current.id)
      const { rows: updated } = await client.query(
        `UPDATE finance.voucher
            SET posting_date = COALESCE($2::date, posting_date),
                narration = CASE WHEN $3::boolean THEN $4::text ELSE narration END,
                reference = CASE WHEN $5::boolean THEN $6::text ELSE reference END,
                version = version + 1
          WHERE id = $1 AND status = 'draft'
          RETURNING version, ${dateText(null, 'posting_date')}, narration, reference`,
        [current.id, b.posting_date || null, has('narration'), b.narration ?? null,
          has('reference'), b.reference ?? null],
      )
      if (checked) {
        await client.query('DELETE FROM finance.voucher_line WHERE voucher_id = $1', [current.id])
        await insertLines(client, current.id, checked.lines)
      }
      const after = await draftTotals(client, current.id)
      await client.query('COMMIT')

      // Before and after of each header field that changed, and of the lines' count and totals.
      const changed = ['posting_date', 'narration', 'reference'].filter((k) => current[k] !== updated[0][k])
      request.auditDetails = {
        action: 'voucher_amended', voucher_id: current.id, voucher_no: current.voucher_no,
        version_before: current.version, version_after: updated[0].version,
        before: Object.fromEntries(changed.map((k) => [k, current[k]])),
        after: Object.fromEntries(changed.map((k) => [k, updated[0][k]])),
        lines_replaced: Boolean(checked),
        lines_before: { line_count: before.line_count, debit_total: before.debit_total, credit_total: before.credit_total },
        lines_after: { line_count: after.line_count, debit_total: after.debit_total, credit_total: after.credit_total },
      }
      const { line_count: _count, ...balance } = after
      return ok(reply, {
        updated: current.voucher_no, version: updated[0].version, balance,
        balances: Number(after.difference) === 0,
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be updated.')
    } finally {
      client.release()
    }
  })

  /**
   * Discard a draft: it is CANCELLED, not deleted (accounting audit M8). Its number, its lines and
   * the reason stay on the record, so a numbered series can be accounted for from first to last; it
   * posts nothing and leaves every queue. Its preparer only (accounting M4, security H1).
   *
   * The body is optional: `{ reason }`, 3 to 2000 characters. Without one the record says it was
   * discarded by its preparer before posting. (No body schema: a DELETE commonly carries no body,
   * and a schema would refuse it.)
   */
  fastify.delete('/finance/ledger/vouchers/:id', {
    // B11 ruling: a year-end closing draft is raised under finance.ledger.close_year, so its preparer
    // may discard it with that permission alone. Every other draft still needs voucher.prepare
    // (checked below, once the voucher's type is known).
    preHandler: requireAnyPermission(fastify, ['finance.ledger.voucher.prepare', 'finance.ledger.close_year']),
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    let reason = 'Discarded by its preparer before posting.'
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 2000) {
        return fail(reply, 400, 'bad_reason', 'A reason, when given, is a sentence of 3 to 2000 characters.')
      }
      reason = body.reason.trim()
    }
    const authorityId = request.user.authority_id

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const stop = async (refusal) => {
        await client.query('ROLLBACK')
        return fail(reply, refusal.status, refusal.error, refusal.message)
      }
      // Locked inside the transaction (B10 review carry): a discard racing a posting either lands
      // first or finds the voucher posted, and never answers 200 for a voucher that was posted.
      const { rows: locked } = await client.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.status, v.prepared_by
           FROM finance.voucher v WHERE v.id = $1 AND v.authority_id = $2 FOR UPDATE`,
        [request.params.id, authorityId],
      )
      const current = locked[0]
      if (!current) return stop({ status: 404, error: 'not_found', message: 'No such voucher.' })
      if (current.status === 'cancelled') {
        return stop({ status: 409, error: 'voucher_cancelled', message: `Voucher ${current.voucher_no} was already cancelled.` })
      }
      if (current.status !== 'draft') {
        return stop({ status: 409, error: 'voucher_posted',
          message: `Voucher ${current.voucher_no} is ${current.status}. A posted voucher is never `
            + 'deleted — it is reversed, and both halves stay on the record.' })
      }
      if (current.voucher_type !== 'closing'
          && !(await hasPermission(fastify, request, 'finance.ledger.voucher.prepare'))) {
        return stop({ status: 403, error: 'forbidden',
          message: 'You do not hold the permission this action requires.' })
      }
      const document = await documentRefusal(client, current, authorityId, false)
      if (document) return stop(document)
      if (current.prepared_by !== request.user.id) {
        request.auditDetails = { action: 'voucher_cancel_refused', voucher_id: current.id, voucher_no: current.voucher_no, reason: 'not_preparer' }
        return stop(notPreparer(current, 'discard'))
      }
      const totals = await draftTotals(client, current.id)
      const cancelled = await client.query(
        `UPDATE finance.voucher
            SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
          WHERE id = $1 AND status = 'draft'`, [current.id, request.user.id, reason],
      )
      if (cancelled.rowCount !== 1) {
        return stop({ status: 409, error: 'voucher_posted',
          message: `Voucher ${current.voucher_no} is no longer a draft and was not cancelled.` })
      }
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'voucher_cancelled', voucher_id: current.id, voucher_no: current.voucher_no,
        voucher_type: current.voucher_type, reason, line_count: totals.line_count,
        debit_total: totals.debit_total, credit_total: totals.credit_total,
      }
      return ok(reply, {
        cancelled: current.voucher_no, voucher_id: current.id, status: 'cancelled', cancel_reason: reason,
        note: `${current.voucher_no} is cancelled. Its number and lines stay on the record, and it posts nothing.`,
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The voucher could not be discarded.')
    } finally {
      client.release()
    }
  })

  /**
   * Post a voucher to the book of account.
   *
   * Calls `finance.post_voucher()` for every rule — draft status, separation of duties, two lines,
   * an open period containing the posting date, balance — so a second caller cannot post by a
   * different set of rules. This route adds two checks that need the request: the over-application
   * guard, and the VERSION the poster reviewed (`expected_version`, from GET /vouchers/:id or the
   * list). When it is sent, a draft changed since then is refused, so the second person's review
   * covers what is posted (security audit H3). It is optional by controller ruling: the console
   * posts without it, and the audit row records whether the version was checked.
   *
   * It is the point of no return: once posted, the entries can never be amended.
   */
  fastify.post('/finance/ledger/vouchers/:id/post', {
    ...canPost,
    errorHandler: shapedErrors,
    // The body is OPTIONAL (controller ruling, B-SOD fix round 1): `{ expected_version }` or
    // nothing. The console posts `{}`; the Accounting workspace always sends the version. Checked
    // by hand rather than by a body schema, because a schema refuses a POST that has no body.
    schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } },
  }, async (request, reply) => {
    const authorityId = request.user.authority_id
    // JSON or nothing (B-SOD review N4). Fastify parses text/plain itself, so it is refused here.
    const contentType = request.headers['content-type']
    if (contentType !== undefined && !/^application\/json\s*(;|$)/i.test(contentType)) {
      return fail(reply, 415, 'unsupported_media_type', 'A posting is sent as JSON, or with no body at all.')
    }
    const body = request.body === undefined || request.body === null ? {} : request.body
    if (typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((k) => k !== 'expected_version')) {
      return fail(reply, 400, 'bad_request', 'A posting carries at most expected_version, the version you reviewed.')
    }
    const expected = body.expected_version
    if (expected !== undefined && !(Number.isInteger(expected) && expected >= 1)) {
      return fail(reply, 400, 'bad_version', 'expected_version is the whole number the voucher showed when you opened it.')
    }
    const { rows: current } = await pg.query(
      `SELECT v.id, v.voucher_no, v.voucher_type, v.status, v.prepared_by, v.reverses_voucher_id,
              v.financial_year_id,
              (SELECT o.voucher_type FROM finance.voucher o
                WHERE o.id = v.reverses_voucher_id AND o.authority_id = $2) AS reverses_type
         FROM finance.voucher v WHERE v.id = $1 AND v.authority_id = $2`,
      [request.params.id, authorityId],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')
    // A year-end closing, or the reversal of one, may post into the year's final period once that
    // period is CLOSED (not locked): the period guard (finance.validate_ledger_entry, migration 242)
    // admits it while finance.closing_write is on. Every other voucher stays out of a closed period.
    const closingWrite = current[0].voucher_type === 'closing' || current[0].reverses_type === 'closing'
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
      // Lock the voucher row first (post_voucher takes the same lock), so no edit of its lines can
      // commit between the checks below and the posting. PATCH and DELETE take it too.
      const { rows: locked } = await client.query(
        'SELECT status, version FROM finance.voucher WHERE id = $1 AND authority_id = $2 FOR UPDATE',
        [request.params.id, authorityId],
      )
      if (locked[0] && locked[0].status === 'draft') {
        // Compared only when sent. Sent, a draft changed since the review is refused.
        if (expected !== undefined && locked[0].version !== expected) {
          await client.query('ROLLBACK')
          request.auditDetails = {
            action: 'voucher_post_refused', voucher_id: current[0].id, voucher_no: current[0].voucher_no,
            reason: 'changed_since_review', expected_version: expected, current_version: locked[0].version,
          }
          return fail(reply, 409, 'changed_since_review',
            'The draft was changed after you opened it. Read it again before posting.',
            { current_version: locked[0].version })
        }
        // Over-application (the ruling in the ledger): a credit note, write-off, receipt or payment
        // that names a bill or invoice in against_voucher_id may not take it below nil together
        // with what is already posted against it.
        const over = await overApplication(client, request.params.id, authorityId)
        if (over) {
          await client.query('ROLLBACK')
          return fail(reply, 409, 'over_applied',
            `${over.voucher_no} has ${over.currency} ${over.open_amount} still open; this would apply ${over.currency} ${over.applied_amount}.`)
        }
      }
      if (closingWrite) {
        // Serialised with the period PATCH (review I2): the year's final period is held FOR SHARE
        // until this posting commits, so a lock or reopen of it waits, and then reads the year
        // after this posting. finance.validate_ledger_entry takes the same lock for any writer.
        const { rows: [year] } = await client.query(
          'SELECT fy.label FROM finance.financial_year fy WHERE fy.id = $1 AND fy.authority_id = $2',
          [current[0].financial_year_id, authorityId])
        await client.query(
          `SELECT lp.id FROM finance.ledger_period lp
             JOIN finance.financial_year fy ON fy.id = lp.financial_year_id
            WHERE lp.financial_year_id = $1 AND lp.authority_id = $2 AND lp.to_date >= fy.end_date
            FOR SHARE OF lp`, [current[0].financial_year_id, authorityId])
        // A closing posts only into a year with no open period: one reopened after the closing was
        // raised is closed again first, so nothing can post into the year behind it. Read after the
        // lock, so a reopen that was waiting on it is seen.
        const { rows: [again] } = await client.query(
          `SELECT string_agg(lp.period_no::text, ', ' ORDER BY lp.period_no) AS open_periods
             FROM finance.ledger_period lp
            WHERE lp.financial_year_id = $1 AND lp.authority_id = $2 AND lp.status = 'open'`,
          [current[0].financial_year_id, authorityId])
        if (current[0].voucher_type === 'closing' && again.open_periods) {
          await client.query('ROLLBACK')
          return fail(reply, 409, 'periods_open',
            `Every period of ${year.label} must be closed before its year-end closing is posted; still open: ${again.open_periods}.`)
        }
        await client.query("SELECT set_config('finance.closing_write', 'on', true)")
      }
      const { rows } = await client.query(
        'SELECT finance.post_voucher($1, $2) AS entries', [request.params.id, request.user.id],
      )
      if (closingWrite) await client.query("SELECT set_config('finance.closing_write', 'off', true)")
      // Force the deferred balance trigger now, inside this transaction, so a refusal arrives as a
      // 409 naming the difference rather than as a failed COMMIT the caller cannot interpret.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'voucher_posted', voucher_id: current[0].id, voucher_no: current[0].voucher_no,
        voucher_type: current[0].voucher_type, version: locked[0] ? locked[0].version : null,
        version_checked: expected !== undefined, prepared_by: current[0].prepared_by,
        reverses_voucher_id: current[0].reverses_voucher_id, entries: rows[0].entries,
      }
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
   * Reverse a posted voucher: raise the reversal as a DRAFT.
   *
   * `finance.raise_reversal()` (migration 242) raises a reversal with debit and credit swapped,
   * prepared by the caller, and posts nothing. Somebody else posts it from the To post queue with
   * the ordinary post route, which refuses the preparer (accounting audit M3, security audit C1).
   * Until then the original is untouched. The original stays `posted` and visible once reversed: it
   * is not cancelled, flagged or hidden, and the net effect on every account is nil (acceptance
   * check G6). At most one reversal of a voucher may be live at a time.
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
    // Left blank, the reversal is numbered after its original (`<number>-R`, or -R2, -R3, …).
    const reserved = reservedNumberRefusal(b.voucher_no, { blankIssues: true })
    if (reserved) return fail(reply, reserved.status, reserved.error, reserved.message)
    const { rows: current } = await pg.query(
      `SELECT id, voucher_no, status, voucher_type, ${dateText(null, 'posting_date')}
         FROM finance.voucher WHERE id = $1 AND authority_id = $2`,
      [request.params.id, request.user.authority_id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such voucher.')
    // B11 review N1: a reversal of a year-end closing is dated the closing's own day.
    const misdated = closingReversalDateRefusal(current[0], b.posting_date)
    if (misdated) return fail(reply, misdated.status, misdated.error, misdated.message)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.raise_reversal($1, $2, $3, $4, $5) AS id',
        [request.params.id, request.user.id, b.reason.trim(),
          b.posting_date || null, b.voucher_no ? normaliseCode(b.voucher_no) : null],
      )
      const { rows: created } = await client.query(
        `SELECT v.id, v.voucher_no, v.voucher_type, v.currency,
                ${dateText('v', 'posting_date')}, v.status, v.reverses_voucher_id, v.prepared_by, v.version
           FROM finance.voucher v WHERE v.id = $1`, [rows[0].id],
      )
      const totals = await draftTotals(client, rows[0].id)
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'reversal_drafted', voucher_id: current[0].id, voucher_no: current[0].voucher_no,
        reversal_id: created[0].id, reversal_no: created[0].voucher_no, reason: b.reason.trim(),
        posting_date: created[0].posting_date, line_count: totals.line_count,
        debit_total: totals.debit_total, credit_total: totals.credit_total,
      }
      return ok(reply, {
        reversal: created[0],
        reversed: current[0].voucher_no,
        awaiting_post: true,
        note: `Reversal ${created[0].voucher_no} is a draft. It changes nothing until somebody other `
          + `than you posts it from the To post queue. ${current[0].voucher_no} stays posted and `
          + 'visible; once the reversal is posted the net effect on every account is nil, and both '
          + 'halves remain on the record.',
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
          // Balances as at this date; none, or one past the year end, reads as the year end.
          as_at: isoDate,
          // 'after' counts the year's closing vouchers; 'before' leaves them (and their reversals) out.
          closing: { type: 'string', enum: ['before', 'after'], default: 'after' },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const { rows: yearRows } = await pg.query(
      `SELECT fy.id, LEAST(COALESCE($3::date, fy.end_date), fy.end_date)::text AS as_at
         FROM finance.financial_year fy
        WHERE fy.id = $1 AND fy.authority_id = $2 AND fy.deleted_at IS NULL`,
      [q.financial_year_id, authorityId, q.as_at || null],
    )
    if (!yearRows[0]) return fail(reply, 404, 'not_found', 'No such financial year.')
    const asAt = yearRows[0].as_at

    // Every row comes from finance.ledger_balances (migration 242): balance-sheet accounts carry
    // every earlier year, revenue and expense their own year, and earlier years' surplus not yet
    // closed is one row with no account. `scoped` reads the same entries the function reads, for
    // what the function does not return: the first and last posting dates, and (include_nil) the
    // accounts whose entries net to nil. $1 year, $2 as at, $3 closing, $4 authority.
    const all = `
      WITH y AS (
        SELECT fy.id, fy.authority_id FROM finance.financial_year fy WHERE fy.id = $1 AND fy.authority_id = $4
      ),
      left_out AS (
        SELECT c.id FROM finance.voucher c, y
         WHERE $3::text = 'before' AND c.financial_year_id = y.id AND c.voucher_type = 'closing'
        UNION ALL
        SELECT r.id FROM finance.voucher r JOIN finance.voucher c ON c.id = r.reverses_voucher_id, y
         WHERE $3::text = 'before' AND r.voucher_type = 'reversal'
           AND c.financial_year_id = y.id AND c.voucher_type = 'closing'
      ),
      per_account AS (
        SELECT e.ledger_account_id, e.currency::text AS currency, count(*)::int AS entry_count,
               sum(e.debit) AS debit_total, sum(e.credit) AS credit_total,
               min(e.posting_date) AS first_posting_date, max(e.posting_date) AS last_posting_date
          FROM finance.ledger_entry e
          JOIN finance.ledger_account la ON la.id = e.ledger_account_id
          JOIN y ON e.authority_id = y.authority_id
         WHERE e.posting_date <= $2::date
           AND (la.root_type IN ('asset', 'liability', 'equity') OR e.financial_year_id = y.id)
           AND NOT EXISTS (SELECT 1 FROM left_out x WHERE x.id = e.voucher_id)
         GROUP BY e.ledger_account_id, e.currency
      ),
      lb AS (SELECT * FROM finance.ledger_balances($1, $2::date, $3::text)),
      all_rows AS (
        SELECT lb.currency, lb.ledger_account_id, lb.account_code, lb.account_name, lb.root_type,
               lb.report_type,
               -- The unclosed-surplus row belongs to no account, so it has no account type: the
               -- function's 'unclosed_surplus' marker is not one of the chart's types.
               CASE WHEN lb.ledger_account_id IS NULL THEN NULL ELSE lb.account_type END AS account_type,
               lb.entry_count, lb.debit_total, lb.credit_total,
               lb.net_debit, pa.first_posting_date, pa.last_posting_date, false AS nil
          FROM lb
          LEFT JOIN per_account pa ON pa.ledger_account_id = lb.ledger_account_id AND pa.currency = lb.currency
        UNION ALL
        SELECT pa.currency, pa.ledger_account_id, la.code, la.name, la.root_type, la.report_type,
               la.account_type, pa.entry_count, pa.debit_total, pa.credit_total, 0::numeric,
               pa.first_posting_date, pa.last_posting_date, true
          FROM per_account pa
          JOIN finance.ledger_account la ON la.id = pa.ledger_account_id
         WHERE pa.debit_total = pa.credit_total
      )`
    const base = [q.financial_year_id, asAt, q.closing, authorityId]

    const [accounts, booksResult, closedResult] = await Promise.all([
      pg.query(
        `${all}
         SELECT a.currency, a.ledger_account_id, a.account_code, a.account_name,
                a.root_type, a.report_type, a.account_type, a.entry_count,
                a.debit_total::numeric(18,2)::text AS debit_total,
                a.credit_total::numeric(18,2)::text AS credit_total,
                -- The two columns of a trial balance, derived from the signed balance as
                -- finance.v_trial_balance derives them: an account appears in exactly one.
                (CASE WHEN a.net_debit > 0 THEN a.net_debit ELSE 0 END)::numeric(18,2)::text AS debit_balance,
                (CASE WHEN a.net_debit < 0 THEN -a.net_debit ELSE 0 END)::numeric(18,2)::text AS credit_balance,
                a.first_posting_date::text AS first_posting_date,
                a.last_posting_date::text AS last_posting_date
           FROM all_rows a
          WHERE ($5::text IS NULL OR a.currency = $5::text)
            AND ($6::text IS NULL OR a.root_type = $6::text)
            AND ($7::boolean IS TRUE OR NOT a.nil)
          ORDER BY a.currency, a.account_code NULLS LAST`,
        [...base, q.currency || null, q.root_type || null, q.include_nil === true],
      ),
      // Summed in SQL, per currency, and never across them.
      pg.query(
        `${all}
         SELECT a.currency,
                count(*)::int AS account_count,
                sum(CASE WHEN a.net_debit > 0 THEN a.net_debit ELSE 0 END)::numeric(18,2)::text AS debit_total,
                sum(CASE WHEN a.net_debit < 0 THEN -a.net_debit ELSE 0 END)::numeric(18,2)::text AS credit_total,
                sum(a.net_debit)::numeric(18,2)::text AS difference,
                (sum(a.net_debit) = 0) AS balances
           FROM all_rows a
          WHERE ($5::text IS NULL OR a.currency = $5::text)
          GROUP BY a.currency ORDER BY a.currency`,
        [...base, q.currency || null],
      ),
      // Per book: is the year closed there? Read by finance.year_closed (migration 242).
      pg.query(
        `SELECT c.currency, finance.year_closed($1, c.currency) AS closed
           FROM unnest($2::text[]) AS c(currency) ORDER BY c.currency`,
        [q.financial_year_id, q.currency ? [q.currency] : ['USD', 'ZWG']],
      ),
    ])
    const books = booksResult.rows

    if (q.format === 'csv') {
      const columns = [
        { header: 'Book', key: 'book' }, { header: 'Code', key: 'code' }, { header: 'Account', key: 'account' },
        { header: 'Debit', key: 'debit', type: 'amount' }, { header: 'Credit', key: 'credit', type: 'amount' },
      ]
      const lines = []
      for (const book of books) {
        for (const r of accounts.rows.filter((row) => row.currency === book.currency)) {
          lines.push({ book: r.currency, code: r.account_code, account: r.account_name, debit: r.debit_balance, credit: r.credit_balance })
        }
        lines.push({ book: book.currency, account: 'Totals', debit: book.debit_total, credit: book.credit_total })
      }
      const name = `trial-balance-${asAt}${q.closing === 'before' ? '-before-closing' : ''}.csv`
      return reply.code(200)
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}"`)
        .send(toCsv(columns, lines))
    }

    return ok(reply, {
      accounts: accounts.rows,
      books,
      currencies: books.map((b) => b.currency),
      note: 'One trial balance per currency, and there is no combined figure: the Council has '
        + 'approved no conversion basis (decision D4). Each book must balance on its own; a '
        + 'difference other than nil is a defect to investigate. Balance-sheet accounts include '
        + 'what earlier years brought forward.',
      unbalanced: books.filter((b) => b.balances !== true).map((b) => b.currency),
      as_at: asAt,
      closing: q.closing,
      closed: closedResult.rows,
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

  // ═══ The statements (B12: accounting audit M7, S13, S14) ════════════════════════════════════
  //
  // Every figure below comes from finance.ledger_balances() (migration 242) or from
  // finance.ledger_entry read in SQL, summed over NUMERIC and sent as decimal strings. JavaScript
  // only regroups rows and writes sentences. Every query names the caller's council explicitly, as
  // well as being confined to it by row-level security (B12 item 6): the year is looked up with its
  // authority first, and ledger_balances reads only that year's council.
  //
  // ONE SNAPSHOT PER STATEMENT (review I2). A statement's reads run on one pooled client inside
  // REPEATABLE READ READ ONLY, so its lines, subtotals, check and sentences all see the same committed
  // ledger: a voucher posted mid-request cannot make the printed lines disagree with the printed
  // subtotal. And ledger_balances is read ONCE per year per request, into a MATERIALIZED CTE from
  // which the lines, subtotals, check and the fixed-asset fact are all derived. The cost: the
  // request holds one pooled connection for its length, and a read-only transaction's BEGIN/COMMIT.

  const csvReply = (reply, name, columns, lines) => reply.code(200)
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}"`)
    .send(toCsv(columns, lines))

  /** Run `work(client)` in one read-only REPEATABLE READ snapshot on one pooled client. */
  const inSnapshot = async (work) => {
    const client = await pg.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const out = await work(client)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * The year a statement is of, and its date. The date asked for is capped at the year end; with
   * none it is the year end, or the council's today when that is earlier (in Harare, review m3), and
   * never before the year starts. A date before the year starts is refused rather than read.
   * Returns { year } or { refusal }.
   */
  const statementYear = async (db, yearId, authorityId, asAt) => {
    const { rows } = await db.query(
      `SELECT fy.id, fy.label, fy.start_date::text AS start_date, fy.end_date::text AS end_date,
              LEAST(COALESCE($3::date,
                             GREATEST(fy.start_date, LEAST(fy.end_date, (now() AT TIME ZONE $4::text)::date))),
                    fy.end_date)::text AS as_at,
              ($3::date IS NOT NULL AND $3::date < fy.start_date) AS before_start
         FROM finance.financial_year fy
        WHERE fy.id = $1 AND fy.authority_id = $2 AND fy.deleted_at IS NULL`,
      [yearId, authorityId, asAt || null, COUNCIL_TIME_ZONE],
    )
    if (!rows[0]) return { refusal: [404, 'not_found', 'No such financial year.'] }
    const { before_start: beforeStart, ...year } = rows[0]
    if (beforeStart) {
      return { refusal: [400, 'bad_date', `${asAt} is before ${year.label} starts, on ${year.start_date}.`] }
    }
    return { year }
  }

  /**
   * What a statement as at `asAt` does not yet contain, read from the ledger on the statement's own
   * client and phrased by incompleteSentences() (accounting audit M7). `book` narrows it to one
   * currency, or null for both. `ppeBooks` comes out of the statement's own ledger_balances read.
   */
  const statementGaps = async (db, { year, asAt, authorityId, book, ppeBooks, statement }) => {
    const { rows: [payables] } = await db.query(
      `SELECT count(*)::int AS n FROM finance.ledger_account
        WHERE authority_id = $1 AND account_type = 'payable' AND deleted_at IS NULL`, [authorityId])
    // Each bank account and book with an entry dated after the last statement reconciled by the
    // statement date. Driven from the bank accounts, with an EXISTS that stops at the first such
    // entry on idx_ledger_entry_account_date (review m5). An opening balance is no movement a bank
    // statement will show, so it is left out, as the period readiness check leaves it out.
    const { rows: banks } = await db.query(
      `SELECT la.code, la.name, c.currency, lr.to_date::text AS reconciled_to
         FROM finance.ledger_account la
        CROSS JOIN unnest($3::text[]) AS c(currency)
         LEFT JOIN LATERAL (
           SELECT max(st.to_date) AS to_date FROM finance.bank_statement st
            WHERE st.authority_id = $1 AND st.bank_account_id = la.id AND st.currency::text = c.currency
              AND st.status = 'reconciled' AND st.to_date <= $2::date) lr ON true
        WHERE la.authority_id = $1 AND la.account_type = 'bank'
          AND EXISTS (SELECT 1 FROM finance.ledger_entry e
                       WHERE e.ledger_account_id = la.id AND e.authority_id = $1 AND e.currency::text = c.currency
                         AND e.posting_date <= $2::date
                         AND e.posting_date > COALESCE(lr.to_date, '-infinity'::date)
                         AND e.voucher_type <> 'opening')
        ORDER BY la.code, la.id, c.currency`, [authorityId, asAt, book ? [book] : ['USD', 'ZWG']])
    // Open periods matter only to a statement at the year end.
    let openPeriods = null
    if (asAt === year.end_date) {
      const { rows } = await db.query(
        `SELECT period_no FROM finance.ledger_period
          WHERE financial_year_id = $1 AND authority_id = $2 AND status = 'open' ORDER BY period_no`,
        [year.id, authorityId])
      openPeriods = rows.map((r) => r.period_no)
    }
    return incompleteSentences({
      statement, payableAccounts: payables.n, unreconciledBanks: banks, ppeWithoutAssets: ppeBooks,
      asAt, yearLabel: year.label, openPeriods,
    })
  }

  /**
   * The books whose fixed-asset accounts carry a balance in `alias` (a ledger_balances read) while
   * the register holds no asset of that book acquired by the date and not disposed of by it (review
   * m4). A SQL fragment over constants and the caller's parameters `$date` and `$authority`.
   */
  const ppeBooksSql = (alias, date, authority) => `
    SELECT COALESCE(json_agg(DISTINCT ${alias}.currency ORDER BY ${alias}.currency), '[]'::json)
      FROM ${alias}
     WHERE ${alias}.ledger_account_id IS NOT NULL AND ${alias}.root_type = 'asset' AND ${alias}.account_type = 'fixed_asset'
       AND NOT EXISTS (SELECT 1 FROM finance.fixed_asset fa
                        WHERE fa.authority_id = ${authority} AND fa.currency::text = ${alias}.currency
                          AND fa.acquired_on <= ${date}::date
                          AND (fa.disposed_on IS NULL OR fa.disposed_on > ${date}::date))`

  const statementFormat = { type: 'string', enum: ['json', 'csv'], default: 'json' }
  const SECTION_TITLES = {
    asset: 'Assets', liability: 'Liabilities', equity: 'Net assets/equity', revenue: 'Revenue', expense: 'Expenditure',
  }

  /**
   * The statement of financial position, per currency, as at a date (accounting audit M7).
   *
   * Read from finance.ledger_balances 'after': each balance-sheet account carries every earlier
   * year. Net assets/equity is laid out as
   *   the equity accounts;
   *   the surplus or deficit of earlier years not yet closed (one row with no account, last);
   *   surplus_to_date: the year's own revenue less expenditure to the date, −Σ net_debit, sent while
   *     the book is not closed at the date, or while anything is left after a closing.
   * `check` is computed in SQL for each book: assets − liabilities − (equity + surplus to date) is
   * nil, to the cent, because what ledger_balances returns is a set of whole balanced vouchers.
   * One statement, one ledger_balances read, one snapshot (review I2).
   */
  fastify.get('/finance/ledger/statements/position', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid, currency, as_at: isoDate, format: statementFormat },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const book = q.currency || null

    const read = await inSnapshot(async (db) => {
      const found = await statementYear(db, q.financial_year_id, authorityId, q.as_at)
      if (found.refusal) return found
      const { year } = found
      const asAt = year.as_at
      // $1 year, $2 as at, $3 book or null, $4 the earlier-years label, $5 the position's roots,
      // $6 the year end, $7 the authority.
      const { rows: [figures] } = await db.query(
        `WITH lb AS MATERIALIZED (
           SELECT * FROM finance.ledger_balances($1, $2::date, 'after') b
            WHERE $3::text IS NULL OR b.currency = $3::text
         ),
         per_book AS (
           SELECT lb.currency,
                  COALESCE(sum(lb.net_debit) FILTER (WHERE lb.root_type = 'asset'), 0) AS assets,
                  COALESCE(sum(-lb.net_debit) FILTER (WHERE lb.root_type = 'liability'), 0) AS liabilities,
                  COALESCE(sum(-lb.net_debit) FILTER (WHERE lb.root_type = 'equity'), 0) AS equity,
                  COALESCE(sum(-lb.net_debit) FILTER (WHERE lb.root_type IN ('revenue', 'expense')), 0) AS surplus
             FROM lb GROUP BY lb.currency
         )
         SELECT
           (SELECT COALESCE(json_agg(json_build_object(
                     'currency', lb.currency, 'ledger_account_id', lb.ledger_account_id,
                     'account_code', lb.account_code,
                     'account_name', CASE WHEN lb.ledger_account_id IS NULL THEN $4::text ELSE lb.account_name END,
                     'root_type', lb.root_type,
                     'account_type', CASE WHEN lb.ledger_account_id IS NULL THEN NULL ELSE lb.account_type END,
                     'debit_balance', (CASE WHEN lb.net_debit > 0 THEN lb.net_debit ELSE 0 END)::numeric(18,2)::text,
                     'credit_balance', (CASE WHEN lb.net_debit < 0 THEN -lb.net_debit ELSE 0 END)::numeric(18,2)::text,
                     'balance', (CASE WHEN lb.root_type = 'asset' THEN lb.net_debit ELSE -lb.net_debit END)::numeric(18,2)::text)
                   ORDER BY lb.currency, lb.root_type, lb.account_code NULLS LAST), '[]'::json)
              FROM lb WHERE lb.root_type = ANY($5::text[])) AS rows,
           -- The equity subtotal includes the earlier-years row: the page prints it "before surplus to date".
           (SELECT COALESCE(json_agg(json_build_object('currency', s.currency, 'root_type', s.root_type, 'subtotal', s.subtotal)
                   ORDER BY s.currency, s.root_type), '[]'::json)
              FROM (SELECT lb.currency, lb.root_type,
                           sum(CASE WHEN lb.root_type = 'asset' THEN lb.net_debit ELSE -lb.net_debit END)::numeric(18,2)::text AS subtotal
                      FROM lb WHERE lb.root_type = ANY($5::text[])
                     GROUP BY lb.currency, lb.root_type) s) AS subtotals,
           -- Per book. A book closed at the year end shows no surplus line once it is nil.
           (SELECT COALESCE(json_agg(json_build_object(
                     'currency', p.currency,
                     'assets', p.assets::numeric(18,2)::text,
                     'liabilities', p.liabilities::numeric(18,2)::text,
                     'equity_and_surplus', (p.equity + p.surplus)::numeric(18,2)::text,
                     'difference', (p.assets - p.liabilities - (p.equity + p.surplus))::numeric(18,2)::text,
                     'balances', p.assets - p.liabilities - (p.equity + p.surplus) = 0,
                     'surplus_amount', abs(p.surplus)::numeric(18,2)::text,
                     'surplus_side', CASE WHEN p.surplus < 0 THEN 'deficit' ELSE 'surplus' END,
                     'surplus_shown', p.surplus <> 0 OR NOT ($2::date = $6::date AND finance.year_closed($1, p.currency)))
                   ORDER BY p.currency), '[]'::json)
              FROM per_book p) AS summary,
           (${ppeBooksSql('lb', '$2', '$7')}) AS ppe_books`,
        [year.id, asAt, book, UNCLOSED_SURPLUS_LABEL, POSITION_ROOTS, year.end_date, authorityId],
      )
      const incomplete = await statementGaps(db, {
        year, asAt, authorityId, book, ppeBooks: figures.ppe_books, statement: 'position',
      })
      return { year, asAt, figures, incomplete }
    })
    if (read.refusal) return fail(reply, ...read.refusal)
    const { year, asAt, figures: { rows, subtotals, summary }, incomplete } = read

    const check = summary.map((s) => ({
      currency: s.currency, assets: s.assets, liabilities: s.liabilities,
      equity_and_surplus: s.equity_and_surplus, difference: s.difference, balances: s.balances,
    }))
    const surplusToDate = summary.filter((s) => s.surplus_shown)
      .map((s) => ({ currency: s.currency, amount: s.surplus_amount, side: s.surplus_side }))
    const note = `A statement of financial position per currency as at ${asAt}, with no figure combining `
      + 'currencies: the Council has approved no conversion basis (decision D4). Balance-sheet accounts carry '
      + 'every earlier year. Under net assets/equity, the surplus or deficit of earlier years not yet closed '
      + 'is one line, and the year\'s own surplus or deficit to date is another until the year is closed. '
      + 'It is not yet a complete IPSAS 1 statement: assets and liabilities are not classified as current '
      + 'and non-current, there are no comparative figures, and the items listed as incomplete are outstanding.'

    if (q.format === 'csv') {
      const columns = [
        { header: 'Book', key: 'book' }, { header: 'Section', key: 'section' }, { header: 'Code', key: 'code' },
        { header: 'Account', key: 'account' }, { header: 'Amount', key: 'amount', type: 'amount' },
      ]
      const lines = []
      for (const c of check) {
        for (const root of POSITION_ROOTS) {
          const section = SECTION_TITLES[root]
          for (const r of rows.filter((x) => x.currency === c.currency && x.root_type === root)) {
            lines.push({ book: c.currency, section, code: r.account_code, account: r.account_name, amount: r.balance })
          }
          const sub = subtotals.find((s) => s.currency === c.currency && s.root_type === root)
          const surplus = root === 'equity' && surplusToDate.find((s) => s.currency === c.currency)
          if (sub) {
            lines.push({
              book: c.currency, section, amount: sub.subtotal,
              account: surplus ? 'Total net assets/equity before surplus to date' : `Total ${section.toLowerCase()}`,
            })
          }
          if (surplus) {
            lines.push({ book: c.currency, section, account: surplus.side === 'surplus' ? 'Surplus to date' : 'Deficit to date', amount: surplus.amount })
            lines.push({ book: c.currency, section, account: 'Net assets/equity including surplus to date', amount: c.equity_and_surplus })
          }
        }
        lines.push({ book: c.currency, section: 'Check', account: 'Assets less liabilities less net assets/equity', amount: c.difference })
      }
      for (const sentence of incomplete) lines.push({ section: 'Not yet included', account: sentence })
      lines.push({ section: 'Note', account: note })
      return csvReply(reply, `financial-position-${asAt}.csv`, columns, lines)
    }

    return ok(reply, {
      financial_year: { id: year.id, label: year.label, start_date: year.start_date, end_date: year.end_date },
      as_at: asAt,
      books: statementSections(rows, POSITION_ROOTS),
      subtotals,
      currencies: check.map((c) => c.currency),
      surplus_to_date: surplusToDate,
      check,
      incomplete,
      note,
    })
  })

  /**
   * The statement of financial performance: revenue and expense, per currency, per period.
   *
   * Read from finance.ledger_balances 'before', so a closed year still shows its figures (accounting
   * audit M7, S14). The period columns come from `periodList()`, the same function the accounting
   * periods were generated from, and leave out the same closing vouchers. A period with no activity
   * gets its column and reports nil rather than being dropped.
   *
   * compare=prior_year adds `prior_year` ({ id, label, as_at, whole_year }, or null when there is
   * none) and `prior`, the prior year's balances, also before its closing, matched by
   * ledger_account_id. The prior year is read over the SAME SPAN (review m2): to the same day and
   * month as this statement's date, capped at its own end; when that is short of its year end the
   * label says so ("FY 2025, to 30 June 2025"). An account with figures in the prior year only is
   * listed with nil for this year. Without compare, neither key is sent.
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
          as_at: isoDate,
          compare: { type: 'string', enum: ['prior_year'] },
          format: statementFormat,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const book = q.currency || null
    const comparing = q.compare === 'prior_year'

    let periods = null
    const read = await inSnapshot(async (db) => {
      const found = await statementYear(db, q.financial_year_id, authorityId, q.as_at)
      if (found.refusal) return found
      const { year } = found
      const asAt = year.as_at

      if (q.periodicity) {
        try {
          periods = periodList({
            start: year.start_date, end: year.end_date,
            periodicity: q.periodicity, accumulated: q.accumulated === true,
          })
        } catch (err) {
          return { refusal: [400, 'periods_not_derivable', err.message] }
        }
      }

      // The prior year, read to the same day and month: this date less the whole years between the
      // two years' starts, capped at the prior year's end.
      let prior = null
      if (comparing) {
        const { rows: p } = await db.query(
          `SELECT p.id, p.label, p.end_date::text AS end_date,
                  LEAST(p.end_date,
                        ($2::date - make_interval(years => (extract(year FROM $3::date) - extract(year FROM p.start_date))::int))::date
                  )::text AS as_at
             FROM finance.financial_year p
            WHERE p.authority_id = $1 AND p.deleted_at IS NULL AND p.end_date < $3::date
            ORDER BY p.end_date DESC LIMIT 1`, [authorityId, asAt, year.start_date])
        if (p[0]) {
          const wholeYear = p[0].as_at === p[0].end_date
          prior = {
            id: p[0].id,
            label: wholeYear ? p[0].label : `${p[0].label}, to ${longDate(p[0].as_at)}`,
            as_at: p[0].as_at,
            whole_year: wholeYear,
          }
        }
      }

      // One statement: this year's ledger_balances read once (lb), the prior year's once (pb).
      // $1 year, $2 as at, $3 book or null, $4 prior year or null (ledger_balances of no year returns
      // nothing), $5 the prior year's date or null, $6 the authority. The fixed-asset fact is read from
      // lb although lb is 'before': a closing voucher touches only revenue, expense and the surplus
      // account, so a fixed-asset balance is the same either side of it.
      const natural = (a) => `CASE WHEN ${a}.root_type = 'revenue' THEN -${a}.net_debit ELSE ${a}.net_debit END`
      const { rows: [figures] } = await db.query(
        `WITH lb AS MATERIALIZED (
           SELECT * FROM finance.ledger_balances($1, $2::date, 'before') b
            WHERE $3::text IS NULL OR b.currency = $3::text
         ),
         cur AS (SELECT * FROM lb WHERE lb.root_type IN ('revenue', 'expense')),
         pb AS MATERIALIZED (
           SELECT * FROM finance.ledger_balances($4::uuid, $5::date, 'before') p
            WHERE p.ledger_account_id IS NOT NULL AND p.root_type IN ('revenue', 'expense')
              AND ($3::text IS NULL OR p.currency = $3::text)
         ),
         line AS (
           SELECT c.currency, c.ledger_account_id, c.account_code, c.account_name, c.root_type, c.account_type,
                  (${natural('c')})::numeric(18,2)::text AS balance
             FROM cur c
           UNION ALL
           SELECT p.currency, p.ledger_account_id, p.account_code, p.account_name, p.root_type, p.account_type,
                  '0.00'::text
             FROM pb p
            WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c.ledger_account_id = p.ledger_account_id AND c.currency = p.currency)
         )
         SELECT
           (SELECT COALESCE(json_agg(json_build_object(
                     'currency', l.currency, 'ledger_account_id', l.ledger_account_id, 'account_code', l.account_code,
                     'account_name', l.account_name, 'root_type', l.root_type, 'account_type', l.account_type,
                     'balance', l.balance)
                   ORDER BY l.currency, l.root_type, l.account_code), '[]'::json)
              FROM line l) AS rows,
           (SELECT COALESCE(json_agg(json_build_object('currency', s.currency, 'root_type', s.root_type, 'subtotal', s.subtotal)
                   ORDER BY s.currency, s.root_type), '[]'::json)
              FROM (SELECT c.currency, c.root_type, sum(${natural('c')})::numeric(18,2)::text AS subtotal
                      FROM cur c GROUP BY c.currency, c.root_type) s) AS subtotals,
           (SELECT COALESCE(json_agg(json_build_object('currency', s.currency, 'amount', abs(s.net)::numeric(18,2)::text,
                     'side', CASE WHEN s.net < 0 THEN 'deficit' ELSE 'surplus' END) ORDER BY s.currency), '[]'::json)
              FROM (SELECT c.currency, sum(-c.net_debit) AS net FROM cur c GROUP BY c.currency) s) AS surplus,
           (SELECT COALESCE(json_agg(json_build_object(
                     'currency', p.currency, 'ledger_account_id', p.ledger_account_id,
                     'balance', (${natural('p')})::numeric(18,2)::text)
                   ORDER BY p.currency, p.account_code), '[]'::json)
              FROM pb p) AS prior,
           (${ppeBooksSql('lb', '$2', '$6')}) AS ppe_books`,
        [year.id, asAt, book, prior ? prior.id : null, prior ? prior.as_at : null, authorityId],
      )

      // One query, with the buckets passed as parameters rather than built into the SQL. The keys
      // are never used as identifiers or aliases, so nothing from the caller reaches the statement
      // text. The year's closing vouchers, and their reversals, are left out as 'before' leaves
      // them out, and nothing after the statement's date is read.
      let periodRows = []
      if (periods) {
        periodRows = (await db.query(
          `WITH bucket(key, from_date, to_date) AS (
             SELECT * FROM unnest($4::text[], $5::date[], $6::date[])
           ),
           left_out AS (
             SELECT c.id FROM finance.voucher c
              WHERE c.financial_year_id = $1 AND c.authority_id = $7 AND c.voucher_type = 'closing'
             UNION ALL
             SELECT r.id FROM finance.voucher r JOIN finance.voucher c ON c.id = r.reverses_voucher_id
              WHERE r.voucher_type = 'reversal' AND r.authority_id = $7
                AND c.financial_year_id = $1 AND c.voucher_type = 'closing'
           )
           SELECT b.key, e.currency::text AS currency, e.ledger_account_id,
                  la.code AS account_code, la.root_type,
                  sum(CASE WHEN la.root_type = 'revenue' THEN e.credit - e.debit
                           ELSE e.debit - e.credit END)::numeric(18,2)::text AS balance
             FROM bucket b
             JOIN finance.ledger_entry e
               ON e.posting_date BETWEEN b.from_date AND LEAST(b.to_date, $8::date)
              AND e.financial_year_id = $1 AND e.authority_id = $7
             JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.authority_id = $7
            WHERE la.root_type = ANY($2::text[])
              AND ($3::text IS NULL OR e.currency::text = $3::text)
              AND NOT EXISTS (SELECT 1 FROM left_out x WHERE x.id = e.voucher_id)
            GROUP BY b.key, e.currency, e.ledger_account_id, la.code, la.root_type
            ORDER BY b.key, e.currency, la.code`,
          [year.id, PERFORMANCE_ROOTS, book,
            periods.map((p) => p.key), periods.map((p) => p.from_date), periods.map((p) => p.to_date),
            authorityId, asAt],
        )).rows
      }
      const incomplete = await statementGaps(db, {
        year, asAt, authorityId, book, ppeBooks: figures.ppe_books, statement: 'performance',
      })
      return { year, asAt, prior, figures, periodRows, incomplete }
    })
    if (read.refusal) return fail(reply, ...read.refusal)
    const { year, asAt, prior, figures: { rows, subtotals, surplus, prior: priorRows }, periodRows, incomplete } = read

    const currencies = [...new Set(rows.map((r) => r.currency))].sort()
    const note = `Revenue and expense per currency, from ${year.start_date} to ${asAt}, read before the `
      + 'year-end closing so that a closed year still shows its figures. A period with no activity still '
      + 'gets its column and reports nil; nothing is interpolated or carried forward. '
      + (q.accumulated === true
        ? 'The buckets are year-to-date and OVERLAP by design, so they must not be added together.'
        : 'The buckets tile the year exactly.')
      + (comparing ? ' The prior year is read over the same span, to the same day and month, also before its closing.' : '')

    if (q.format === 'csv') {
      const columns = [
        { header: 'Book', key: 'book' }, { header: 'Section', key: 'section' }, { header: 'Code', key: 'code' },
        { header: 'Account', key: 'account' },
        ...(periods || []).map((p, i) => ({ header: p.label, key: `p${i}`, type: 'amount' })),
        { header: periods ? 'Year' : 'Amount', key: 'amount', type: 'amount' },
        ...(prior ? [{ header: prior.label, key: 'prior', type: 'amount' }] : []),
      ]
      const lines = []
      for (const c of currencies) {
        for (const root of PERFORMANCE_ROOTS) {
          const section = SECTION_TITLES[root]
          for (const r of rows.filter((x) => x.currency === c && x.root_type === root)) {
            const line = { book: c, section, code: r.account_code, account: r.account_name, amount: r.balance }
            for (const [i, p] of (periods || []).entries()) {
              const hit = periodRows.find((x) => x.key === p.key && x.currency === c && x.ledger_account_id === r.ledger_account_id)
              line[`p${i}`] = hit ? hit.balance : '0.00'
            }
            if (prior) {
              const hit = priorRows.find((x) => x.currency === c && x.ledger_account_id === r.ledger_account_id)
              line.prior = hit ? hit.balance : '0.00'
            }
            lines.push(line)
          }
          const sub = subtotals.find((s) => s.currency === c && s.root_type === root)
          if (sub) lines.push({ book: c, section, account: `Total ${section.toLowerCase()}`, amount: sub.subtotal })
        }
        const result = surplus.find((s) => s.currency === c)
        if (result) {
          lines.push({ book: c, section: 'Result', account: result.side === 'surplus' ? 'Surplus' : 'Deficit', amount: result.amount })
        }
      }
      for (const sentence of incomplete) lines.push({ section: 'Not yet included', account: sentence })
      lines.push({ section: 'Note', account: note })
      return csvReply(reply, `financial-performance-${asAt}.csv`, columns, lines)
    }

    return ok(reply, {
      financial_year: { id: year.id, label: year.label, start_date: year.start_date, end_date: year.end_date },
      as_at: asAt,
      books: statementSections(rows, PERFORMANCE_ROOTS),
      subtotals,
      surplus,
      periods,
      period_rows: periodRows,
      accumulated: q.accumulated === true,
      currencies,
      incomplete,
      note,
      ...(comparing ? { prior_year: prior, prior: prior ? priorRows : [] } : {}),
    })
  })

  /**
   * Cash receipts and payments over a range, per currency, with the counter-side analysis
   * (accounting audit S13). Not an IPSAS 2 cash flow statement, and its note says so.
   *
   * A cash account is a ledger account of type bank or cash. Every figure is computed in SQL, in one
   * statement (so one snapshot):
   *   accounts[]  per account and book: opening (every entry before `from`, in any year, plus an
   *               opening-balance voucher dated in the range); receipts and payments (each voucher's
   *               net movement on the account in the range, by its sign, transfers included);
   *               closing (every entry to `to`); agrees (opening + receipts − payments = closing).
   *   books[]     per book: the accounts' opening and closing summed; receipts and payments are each
   *               voucher's net movement across ALL the book's cash accounts, by its sign. A transfer
   *               or a banking between the council's own accounts nets to nil there and is left out
   *               (S13 a), which is why the book's figures are not the accounts' added up.
   *   by_counter  THE RULE (S13 b, review I1): each voucher whose cash lines net to other than nil is
   *               analysed by its non-cash lines, grouped by each line's account group; a group's net
   *               (credit − debit) goes WHOLE under inflow when the voucher's cash net is positive, and
   *               its negative under outflow when it is negative. A voucher balances in one currency,
   *               so its non-cash lines net to exactly its cash net: Σ inflow = the book's receipts and
   *               Σ outflow = its payments, to the cent, with no division, apportionment or rounding,
   *               however many cash lines it has. A line against its voucher's direction (tax withheld
   *               from a payment: Dr creditors 1,000.00 / Cr bank 900.00 / Cr tax 100.00) shows as a
   *               negative figure in that column (creditors outflow 1,000.00, tax outflow −100.00).
   *   reconciles  per book: movement (closing − opening) against analysed (Σ by_counter net), and
   *               agrees when they are equal, Σ inflow = receipts and Σ outflow = payments, the book's
   *               opening + receipts − payments equals its closing, and every account of the book
   *               agrees.
   * Opening-balance and closing vouchers, and reversals of them, are never receipts or payments.
   * (A closing touches no cash account; if one ever did, its figure would show as not agreeing.)
   */
  fastify.get('/finance/ledger/statements/cash', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid, from: isoDate, to: isoDate, format: statementFormat },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const authorityId = request.user.authority_id
    const found = await statementYear(pg, q.financial_year_id, authorityId, q.to)
    if (found.refusal) return fail(reply, ...found.refusal)
    const { year } = found
    const to = year.as_at
    const from = q.from || year.start_date
    // ISO date strings compare as dates; nothing here is money.
    if (from < year.start_date || from > year.end_date) {
      return fail(reply, 400, 'bad_date',
        `The range must start within ${year.label}, from ${year.start_date} to ${year.end_date}; ${from} is not.`)
    }
    if (from > to) return fail(reply, 400, 'bad_date', `The range starts on ${from}, after it ends on ${to}.`)

    // $1 authority, $2 from, $3 to, $4 the counter groups in print order.
    const { rows: [statement] } = await pg.query(
      `WITH cash_account AS (
         SELECT la.id, la.code, la.name FROM finance.ledger_account la
          WHERE la.authority_id = $1 AND la.account_type IN ('bank', 'cash')
       ),
       cash_line AS (
         SELECT e.voucher_id, e.ledger_account_id AS account_id, e.currency::text AS currency, e.posting_date,
                e.debit::numeric - e.credit::numeric AS net,
                CASE WHEN v.voucher_type IN ('opening', 'closing') THEN v.voucher_type
                     WHEN v.voucher_type = 'reversal' AND o.voucher_type IN ('opening', 'closing') THEN o.voucher_type
                END AS set_aside
           FROM finance.ledger_entry e
           JOIN cash_account ca ON ca.id = e.ledger_account_id
           JOIN finance.voucher v ON v.id = e.voucher_id AND v.authority_id = $1
           LEFT JOIN finance.voucher o ON o.id = v.reverses_voucher_id AND o.authority_id = $1
          WHERE e.authority_id = $1 AND e.posting_date <= $3::date
       ),
       moved AS (
         SELECT cl.account_id, cl.currency, cl.voucher_id, sum(cl.net) AS net
           FROM cash_line cl
          WHERE cl.posting_date >= $2::date AND cl.set_aside IS NULL
          GROUP BY cl.account_id, cl.currency, cl.voucher_id
       ),
       account_row AS (
         SELECT b.account_id, b.currency, b.opening, b.closing,
                COALESCE(f.receipts, 0) AS receipts, COALESCE(f.payments, 0) AS payments
           FROM (SELECT cl.account_id, cl.currency,
                        COALESCE(sum(cl.net) FILTER (WHERE cl.posting_date < $2::date OR cl.set_aside = 'opening'), 0) AS opening,
                        sum(cl.net) AS closing
                   FROM cash_line cl GROUP BY cl.account_id, cl.currency) b
           LEFT JOIN (SELECT m.account_id, m.currency,
                             COALESCE(sum(m.net) FILTER (WHERE m.net > 0), 0) AS receipts,
                             COALESCE(sum(-m.net) FILTER (WHERE m.net < 0), 0) AS payments
                        FROM moved m GROUP BY m.account_id, m.currency) f
                  ON f.account_id = b.account_id AND f.currency = b.currency
       ),
       voucher_cash AS (
         SELECT m.voucher_id, m.currency, sum(m.net) AS net FROM moved m GROUP BY m.voucher_id, m.currency
       ),
       book_row AS (
         SELECT a.currency, sum(a.opening) AS opening, sum(a.closing) AS closing
           FROM account_row a GROUP BY a.currency
       ),
       book_flow AS (
         SELECT vc.currency,
                COALESCE(sum(vc.net) FILTER (WHERE vc.net > 0), 0) AS receipts,
                COALESCE(sum(-vc.net) FILTER (WHERE vc.net < 0), 0) AS payments
           FROM voucher_cash vc GROUP BY vc.currency
       ),
       -- Per voucher and group: the net of the voucher's non-cash lines in that group, and the
       -- direction of the voucher's cash.
       voucher_group AS (
         SELECT vc.voucher_id, vc.currency, vc.net AS cash_net, ${counterGroupSql('la')} AS grp,
                sum(e.credit::numeric - e.debit::numeric) AS net
           FROM voucher_cash vc
           JOIN finance.ledger_entry e ON e.voucher_id = vc.voucher_id AND e.authority_id = $1
           JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.authority_id = $1
          WHERE vc.net <> 0
            AND NOT EXISTS (SELECT 1 FROM cash_account ca WHERE ca.id = e.ledger_account_id)
          GROUP BY vc.voucher_id, vc.currency, vc.net, 4
       ),
       counter AS (
         SELECT vg.currency, vg.grp,
                COALESCE(sum(vg.net) FILTER (WHERE vg.cash_net > 0), 0) AS inflow,
                COALESCE(sum(-vg.net) FILTER (WHERE vg.cash_net < 0), 0) AS outflow
           FROM voucher_group vg GROUP BY vg.currency, vg.grp
       ),
       counter_book AS (
         SELECT c.currency, sum(c.inflow) AS inflow, sum(c.outflow) AS outflow FROM counter c GROUP BY c.currency
       )
       SELECT
         (SELECT COALESCE(json_agg(json_build_object(
                   'id', ca.id, 'code', ca.code, 'name', ca.name, 'currency', a.currency,
                   'opening', a.opening::numeric(18,2)::text, 'receipts', a.receipts::numeric(18,2)::text,
                   'payments', a.payments::numeric(18,2)::text, 'closing', a.closing::numeric(18,2)::text,
                   'agrees', a.opening + a.receipts - a.payments = a.closing)
                 ORDER BY a.currency, ca.code, ca.id), '[]'::json)
            FROM account_row a JOIN cash_account ca ON ca.id = a.account_id) AS accounts,
         (SELECT COALESCE(json_agg(json_build_object(
                   'currency', b.currency, 'opening', b.opening::numeric(18,2)::text,
                   'receipts', COALESCE(f.receipts, 0)::numeric(18,2)::text,
                   'payments', COALESCE(f.payments, 0)::numeric(18,2)::text,
                   'closing', b.closing::numeric(18,2)::text)
                 ORDER BY b.currency), '[]'::json)
            FROM book_row b LEFT JOIN book_flow f ON f.currency = b.currency) AS books,
         (SELECT COALESCE(json_agg(json_build_object(
                   'currency', c.currency, 'group', c.grp, 'inflow', c.inflow::numeric(18,2)::text,
                   'outflow', c.outflow::numeric(18,2)::text, 'net', (c.inflow - c.outflow)::numeric(18,2)::text)
                 ORDER BY c.currency, array_position($4::text[], c.grp)), '[]'::json)
            FROM counter c) AS by_counter,
         (SELECT COALESCE(json_agg(json_build_object(
                   'currency', b.currency,
                   'movement', (b.closing - b.opening)::numeric(18,2)::text,
                   'analysed', (COALESCE(k.inflow, 0) - COALESCE(k.outflow, 0))::numeric(18,2)::text,
                   'agrees', b.closing - b.opening = COALESCE(k.inflow, 0) - COALESCE(k.outflow, 0)
                             AND COALESCE(k.inflow, 0) = COALESCE(f.receipts, 0)
                             AND COALESCE(k.outflow, 0) = COALESCE(f.payments, 0)
                             AND b.opening + COALESCE(f.receipts, 0) - COALESCE(f.payments, 0) = b.closing
                             AND NOT EXISTS (SELECT 1 FROM account_row a WHERE a.currency = b.currency
                                               AND a.opening + a.receipts - a.payments <> a.closing))
                 ORDER BY b.currency), '[]'::json)
            FROM book_row b
            LEFT JOIN book_flow f ON f.currency = b.currency
            LEFT JOIN counter_book k ON k.currency = b.currency) AS reconciles`,
      [authorityId, from, to, COUNTER_GROUPS.map((g) => g.group)],
    )
    const byCounter = statement.by_counter.map((c) => ({
      currency: c.currency, group: c.group, label: COUNTER_LABELS[c.group],
      inflow: c.inflow, outflow: c.outflow, net: c.net,
    }))

    if (q.format === 'csv') {
      const columns = [
        { header: 'Book', key: 'book' }, { header: 'Section', key: 'section' }, { header: 'Code', key: 'code' },
        { header: 'Name', key: 'name' },
        ...['Opening', 'Receipts', 'Payments', 'Closing', 'Inflow', 'Outflow', 'Net', 'Movement', 'Analysed']
          .map((h) => ({ header: h, key: h.toLowerCase(), type: 'amount' })),
        { header: 'Agrees', key: 'agrees' },
      ]
      const yesNo = (b) => (b ? 'yes' : 'no')
      const lines = []
      for (const b of statement.books) {
        for (const a of statement.accounts.filter((x) => x.currency === b.currency)) {
          lines.push({ book: b.currency, section: 'Account', code: a.code, name: a.name, opening: a.opening,
            receipts: a.receipts, payments: a.payments, closing: a.closing, agrees: yesNo(a.agrees) })
        }
        lines.push({ book: b.currency, section: 'Book', name: 'Without movements between the council\'s own accounts',
          opening: b.opening, receipts: b.receipts, payments: b.payments, closing: b.closing })
        for (const c of byCounter.filter((x) => x.currency === b.currency)) {
          lines.push({ book: b.currency, section: 'Counter-side', name: c.label, inflow: c.inflow, outflow: c.outflow, net: c.net })
        }
        const r = statement.reconciles.find((x) => x.currency === b.currency)
        if (r) {
          lines.push({ book: b.currency, section: 'Check', name: 'Movement in cash against the analysis',
            movement: r.movement, analysed: r.analysed, agrees: yesNo(r.agrees) })
        }
      }
      lines.push({ section: 'Note', name: CASH_STATEMENT_NOTE })
      return csvReply(reply, `cash-receipts-and-payments-${from}-to-${to}.csv`, columns, lines)
    }

    return ok(reply, {
      from,
      to,
      accounts: statement.accounts,
      books: statement.books,
      by_counter: byCounter,
      reconciles: statement.reconciles,
      note: CASH_STATEMENT_NOTE,
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
        AND ($5::boolean IS NOT TRUE OR a.outstanding_amount <> 0)
        AND a.authority_id = $6`
    // The caller's own council named explicitly, on top of row-level security.
    const authorityId = request.user.authority_id
    const params = [q.currency || null, q.party_id || null, q.ledger_account_id || null,
      q.bucket || null, q.outstanding_only !== false, authorityId]

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
          LIMIT $7 OFFSET $8`, [...params, q.limit, q.offset],
      ),
      // Per currency AND per bucket. Never a figure spanning the two currencies.
      pg.query(
        `SELECT a.currency, a.ageing_bucket, count(*)::int AS "rows",
                sum(a.outstanding_amount)::text AS outstanding_amount
           FROM finance.v_debtor_ageing a ${where}
          GROUP BY a.currency, a.ageing_bucket ORDER BY a.currency, a.ageing_bucket`, params,
      ),
      /**
       * Per party, at most PARTY_CAP per book, each with its own bucket breakdown. One statement,
       * so the parties broken down are exactly the parties listed: the breakdown is aggregated as
       * JSON beside each party row and only split into `by_party_bucket` below (no arithmetic in
       * JavaScript). The rank breaks ties on party_id so the cap cuts the same way every time.
       */
      pg.query(
        `WITH aged AS (
           SELECT a.* FROM finance.v_debtor_ageing a ${where}
         ), per_party AS (
           SELECT a.currency::text AS currency, a.party_id, a.party_name, a.party_reference,
                  count(*)::int AS bill_count,
                  sum(a.outstanding_amount) AS outstanding,
                  max(a.days_outstanding) AS oldest_days
             FROM aged a
            GROUP BY a.currency, a.party_id, a.party_name, a.party_reference
         ), ranked AS (
           SELECT pp.*, row_number() OVER (PARTITION BY pp.currency
                                           ORDER BY pp.outstanding DESC NULLS LAST, pp.party_id NULLS LAST) AS rank
             FROM per_party pp
         ), per_bucket AS (
           SELECT a.currency::text AS currency, a.party_id, a.ageing_bucket,
                  sum(a.outstanding_amount) AS outstanding
             FROM aged a
            GROUP BY a.currency, a.party_id, a.ageing_bucket
         )
         SELECT r.currency, r.party_id, r.party_name, r.party_reference, r.bill_count,
                r.outstanding::numeric(18,2)::text AS outstanding_amount,
                r.oldest_days,
                COALESCE((
                  SELECT json_agg(json_build_object(
                           'currency', b.currency, 'party_id', b.party_id, 'ageing_bucket', b.ageing_bucket,
                           'outstanding_amount', b.outstanding::numeric(18,2)::text) ORDER BY b.ageing_bucket)
                    FROM per_bucket b
                   WHERE b.currency = r.currency AND NOT b.party_id IS DISTINCT FROM r.party_id), '[]'::json) AS buckets
           FROM ranked r
          WHERE r.rank <= $7
          ORDER BY r.currency, r.rank`, [...params, AGEING_PARTY_CAP],
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
            WHERE a.authority_id = $1
            GROUP BY a.currency
         ), control AS (
           SELECT ab.currency::text AS currency,
                  sum(ab.net_debit) AS balance,
                  count(*)::int AS control_accounts,
                  string_agg(la.code, ', ' ORDER BY la.code) AS control_codes
             FROM finance.v_account_balance ab
             JOIN finance.ledger_account la ON la.id = ab.ledger_account_id
            WHERE la.account_type = 'receivable' AND la.deleted_at IS NULL
              AND la.authority_id = $1 AND ab.authority_id = $1
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
          ORDER BY 1`, [authorityId],
      ),
    ])

    return ok(reply, {
      bills: page.rows,
      total: count.rows[0].total,
      limit: q.limit,
      offset: q.offset,
      by_bucket: byBucket.rows,
      by_party: byParty.rows.map(({ buckets, ...party }) => party),
      by_party_bucket: byParty.rows.flatMap((r) => r.buckets),
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
   * Raise the year-end closing of one currency's book, as a DRAFT (ruling "B11 design").
   *
   * `finance.raise_year_closing()` (migration 242) writes a closing voucher prepared by the caller
   * that brings every revenue and expense account of the year to nil and carries the net to
   * accumulated surplus, and posts nothing. Somebody else posts it from the To post queue with the
   * ordinary post route, which refuses its preparer and admits a closing into the year's final
   * period once that period is closed (not locked). Nobody is named as poster any more: the old
   * close posted at once in a named officer's name, who could be of another council (accounting
   * audit M2, security audit C2).
   *
   * Refused: a date other than the year's last day (S10); any period of the year still open; the
   * final period locked; a closing of this book already waiting; nothing left to close. A second
   * close of a book already closed is allowed when a remainder is left, and takes only the
   * remainder (M6). The two books close separately and no rate is applied. Left blank, the number
   * is issued from the YC series.
   */
  fastify.post('/finance/ledger/close-year', {
    ...canCloseYear,
    errorHandler: shapedErrors,
    schema: {
      body: {
        type: 'object',
        required: ['financial_year_id', 'currency'],
        additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency,
          voucher_no: { type: 'string', minLength: 1, maxLength: 60 },
          // Accepted only as the year's last day (S10), so a client may send what it shows.
          posting_date: isoDate,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const authorityId = request.user.authority_id
    // A number typed as spaces is not a number (review M4); leave it out to have one issued.
    const typedNo = b.voucher_no === undefined ? null : normaliseCode(b.voucher_no)
    if (b.voucher_no !== undefined && !typedNo) {
      return fail(reply, 400, 'bad_number',
        'A typed voucher number cannot be blank. Leave it out to have one issued from the YC series.')
    }
    const reserved = reservedNumberRefusal(typedNo, { blankIssues: true })
    if (reserved) return fail(reply, reserved.status, reserved.error, reserved.message)
    if (!(await hasPermission(fastify, request, 'finance.ledger.view'))) {
      return fail(reply, 403, 'forbidden', 'Closing the year needs finance.ledger.view as well.')
    }
    const { rows: year } = await pg.query(
      `SELECT fy.id, fy.label, fy.end_date::text AS end_date FROM finance.financial_year fy
        WHERE fy.id = $1 AND fy.authority_id = $2 AND fy.deleted_at IS NULL`, [b.financial_year_id, authorityId])
    if (!year[0]) return fail(reply, 404, 'not_found', 'No such financial year.')
    // ISO dates compare as text; a date, not an amount.
    if (b.posting_date && b.posting_date !== year[0].end_date) {
      return fail(reply, 400, 'bad_date',
        `A year-end closing is dated the last day of the year, ${year[0].end_date}, not ${b.posting_date}.`)
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.raise_year_closing($1, $2, $3, $4, $5) AS id',
        [b.financial_year_id, b.currency, request.user.id, typedNo, b.posting_date || null],
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      const { rows: closing } = await client.query(
        `SELECT v.id, v.voucher_no, v.currency, ${dateText('v', 'posting_date')}, v.status, v.version,
                (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries
           FROM finance.voucher v WHERE v.id = $1`, [rows[0].id],
      )
      const totals = await draftTotals(client, rows[0].id)
      await client.query('COMMIT')
      const voucher = closing[0]
      request.auditDetails = {
        action: 'closing_drafted', voucher_id: voucher.id, voucher_no: voucher.voucher_no,
        financial_year_id: b.financial_year_id, currency: b.currency, posting_date: voucher.posting_date,
        line_count: totals.line_count, debit_total: totals.debit_total, credit_total: totals.credit_total,
      }
      return ok(reply, {
        closing_voucher: voucher,
        awaiting_post: true,
        note: `Closing voucher ${voucher.voucher_no} is a draft. It changes nothing until somebody other than `
          + 'you posts it from the To post queue. Posted, it brings every revenue and expense account of the '
          + `${b.currency} book to nil and carries the net to accumulated surplus. The other currency's book `
          + 'closes separately; no rate is applied. Next: ask a colleague who may post vouchers to post it '
          + 'from To post. Every period of the year must still be closed when it is posted.',
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The year-end closing could not be raised.')
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
  periodChangeRefusal,
  periodRefusals,
  AGEING_BUCKETS,
  AGEING_LABELS,
  POSITION_ROOTS,
  PERFORMANCE_ROOTS,
  ROOT_TYPES,
  VOUCHER_TYPES,
  ISSUED_VOUCHER_PREFIXES,
  reservedNumberRefusal,
  SYSTEM_VOUCHER_TYPES,
  CREATABLE_VOUCHER_TYPES,
  systemTypeRefusal,
  LINE_REFERENCES,
  UNCLOSED_SURPLUS_LABEL,
  longDate,
  COUNTER_GROUPS,
  counterGroupOf,
  counterGroupSql,
  CASH_STATEMENT_NOTE,
  incompleteSentences,
  closingReversalDateRefusal,
}
