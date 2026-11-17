/**
 * The general ledger, as the API returns it.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `types.ts`
 * The ledger is a different bounded context from budget reporting, not a few more interfaces on the
 * same one. `types.ts` describes a register of figures some other system originated — a
 * `FinanceTransaction` carries `source_system`, `source_ref` and an import batch, and its amount is
 * SIGNED. A ledger entry is a figure this system originated, it carries explicit `debit` and
 * `credit` columns of which one is zero, and it can never be amended. Putting both vocabularies in
 * one file would invite a screen to treat a ledger line as a transaction, which is the single
 * mistake that would make the book of account wrong. The two are related by the council's own
 * numbering and are reconciled during the parallel run; they are not merged.
 *
 * MONEY IS A STRING HERE, AS IT IS IN THE BACKEND. The API sends decimal strings ('125000.00')
 * because a JavaScript number is a binary float and a council's trial balance is not something to
 * be approximately right about. Nothing in this module or in the screens that consume it parses an
 * amount into a number except to draw a bar, and nothing adds two amounts together at all — every
 * total, balance, subtotal and difference these types carry was computed in SQL over NUMERIC
 * (migration 203). `Money` is re-exported from `types.ts` rather than redefined, so there is one
 * definition of what an amount is across the module.
 *
 * CURRENCY IS NEVER IMPLICIT AND NEVER SUMMED. There are TWO SETS OF BOOKS, one per currency, each
 * self-balancing (design decision 1). A voucher carries exactly one currency and all its lines
 * share it; the trial balance is one per currency and there is no combined figure in any type
 * below. Adding one would need a Council-approved conversion basis, which does not exist
 * (decision D4). Where a type could have carried a grand total it carries an array keyed by
 * currency instead — see `TrialBalanceBook`, `StatementBook` and `AgeingBucketTotal`.
 *
 * `null` IS NOT `0`. A nullable amount or date means "not recorded", which is a different fact from
 * nil, and the screens render it as such.
 *
 * THE INVARIANTS ARE NOT IN THIS FILE, AND THAT IS THE POINT. A voucher that does not balance,
 * a voucher spanning two currencies, and an amendment to a posted line are refused by the DATABASE
 * (migration 203: a deferred constraint trigger, a single currency column on the header, and a
 * revoked privilege plus a refusing trigger). These types describe what comes back; they are not
 * the control, and a screen must never present them as one. The UI explains; the server decides.
 */

import type { Currency, Money } from './types'

export type { Currency, Money }

// ── The chart of accounts ──────────────────────────────────────────────────────────────────────

/** The five roots of a double-entry chart. Council data, never inferred from the code range. */
export type LedgerRootType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/** Which statement an account appears on. DERIVED in the database, so it cannot contradict the root. */
export type LedgerReportType = 'balance_sheet' | 'performance'

/**
 * The behaviour the ledger's own machinery reads off an account.
 *
 * `receivable` is what the ageing view finds its bills in and `accumulated_surplus` is where the
 * year-end closing transfers the surplus, so those two are not decoration: an account left without
 * them is invisible to the feature that needs it.
 */
export type LedgerAccountType =
  | 'receivable' | 'payable' | 'bank' | 'cash' | 'accumulated_surplus'
  | 'current_surplus' | 'tax' | 'fixed_asset' | 'inventory' | 'provision' | 'other'

/**
 * One account on the GL chart.
 *
 * CURRENCY-NEUTRAL, deliberately. One chart serves both books and the entry's own currency decides
 * which book it falls in, so there is no `currency` field here and its absence is a design decision
 * rather than an omission. Two parallel charts would drift within a year.
 */
export interface LedgerAccount {
  id: string
  code: string
  name: string
  root_type: LedgerRootType
  report_type: LedgerReportType
  /** `null` where the council has not classified the account's behaviour. */
  account_type: LedgerAccountType | null
  parent_id: string | null
  parent_code?: string | null
  /** A heading in the chart. Nothing posts to a heading, and `is_postable` is false with it. */
  is_group: boolean
  is_postable: boolean
  status: 'active' | 'inactive'
  notes?: string | null
  created_at?: string
}

/** The same account with its children attached, as `accounts({ tree: true })` returns it. */
export interface LedgerAccountNode extends LedgerAccount {
  children: LedgerAccountNode[]
}

export interface LedgerAccountList {
  accounts: LedgerAccount[]
  total: number
  shape: 'flat'
  note: string
}

export interface LedgerAccountTree {
  accounts: LedgerAccountNode[]
  total: number
  shape: 'tree'
  note: string
}

export interface LedgerAccountBody {
  code: string
  name: string
  root_type: LedgerRootType
  account_type?: LedgerAccountType
  parent_id?: string
  is_group?: boolean
  is_postable?: boolean
  notes?: string
}

// ── The party register (the subledger behind a control account) ─────────────────────────────────

export type PartyType = 'ratepayer' | 'debtor' | 'supplier' | 'employee' | 'other'

export interface LedgerParty {
  id: string
  party_type: PartyType
  name: string
  /** The council's own account number for this party, as printed on its statements. */
  reference: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  address_text?: string | null
  status: 'active' | 'inactive'
}

export interface LedgerPartyList {
  parties: LedgerParty[]
  total: number
  limit: number
  offset: number
  /**
   * Why the register is empty, when it is. The ratepayer of record for each parcel is Council
   * decision D19 and `spatial_planning.parcel_owner` holds no rows against 731 parcels, so there is
   * nothing to load it from yet. `null` once there is something in it.
   */
  note: string | null
}

// ── Accounting periods ─────────────────────────────────────────────────────────────────────────

/**
 * `open` accepts postings. `closed` does not and may be reopened. `locked` is final and is what a
 * council sets after the audit.
 */
export type LedgerPeriodStatus = 'open' | 'closed' | 'locked'

export interface LedgerPeriod {
  id: string
  financial_year_id: string
  financial_year_label?: string
  /** The bucket's ordinal. Period 1 of a July–June council is July, not January. */
  period_no: number
  label: string | null
  from_date: string
  to_date: string
  status: LedgerPeriodStatus
  closed_at: string | null
  locked_at: string | null
  closed_by_name?: string | null
  locked_by_name?: string | null
  /** How many posted entries are in it. A period with entries cannot be made to not have them. */
  entry_count: number
  /** The period holds the year's last day. */
  is_final?: boolean
  /** The server's own refusal of a lock or reopen, with its sentence; null when the change is allowed. */
  lock_refusal?: PeriodRefusal | null
  reopen_refusal?: PeriodRefusal | null
}

export interface PeriodRefusal { error: string; message: string }

export interface LedgerPeriodList {
  periods: LedgerPeriod[]
  total: number
}

export interface LedgerPeriodsOpened {
  financial_year: string
  periodicity: string
  opened: Array<Pick<LedgerPeriod, 'id' | 'period_no' | 'label' | 'from_date' | 'to_date' | 'status'>>
  already_present: number
  note: string
}

// ── The voucher: the business document ─────────────────────────────────────────────────────────

export type VoucherType =
  | 'opening' | 'journal' | 'rates_bill' | 'receipt' | 'credit_note'
  | 'write_off' | 'closing' | 'reversal' | 'supplier_invoice' | 'payment'
  | 'depreciation' | 'asset_disposal' | 'payroll'

/**
 * The types raised by their own screen or document, never typed by hand into a journal: rates bill
 * and receipt by Revenue & Billing, closing by Period Close, supplier invoice and payment by
 * Creditors, depreciation and disposal by the Asset Register, and the salaries journal by its own
 * screen (the server refuses each with 400 `system_type`).
 */
export type SystemVoucherType =
  | 'rates_bill' | 'receipt' | 'closing' | 'reversal' | 'supplier_invoice' | 'payment'
  | 'depreciation' | 'asset_disposal' | 'payroll'

/** The types a person may raise by hand, as the shared (console) client types them. */
export type CreatableVoucherType = Exclude<VoucherType, SystemVoucherType>

/**
 * What the Accounting workspace's journal editor offers. The rest are raised by the system (rates
 * bill and receipt by Revenue & Billing, closing by Period Close); the server refuses them with
 * 400 `system_type`.
 */
export type AccountingCreatableType = 'journal' | 'opening' | 'credit_note' | 'write_off'

export type VoucherStatus = 'draft' | 'posted' | 'cancelled'

/**
 * A voucher as the list returns it.
 *
 * `debit_total` and `credit_total` are the DRAFT's line totals, summed in SQL. They are equal on
 * anything posted, because a voucher that did not balance could not have been posted — the database
 * refuses it, not the screen.
 */
export interface VoucherSummary {
  id: string
  voucher_no: string
  voucher_type: VoucherType
  /** ONE currency for the whole document. There is no per-line currency. */
  currency: Currency
  financial_year_id: string
  posting_date: string
  narration: string | null
  reference: string | null
  status: VoucherStatus
  reverses_voucher_id: string | null
  reverses_voucher_no: string | null
  /** Set when a posted reversal points at this voucher. The original is never hidden. */
  reversed_by_voucher_no: string | null
  is_opening: boolean
  prepared_by: string
  prepared_at: string
  /** `null` until posted. Never the same person as `prepared_by` — a CHECK constraint. */
  posted_by: string | null
  posted_at: string | null
  prepared_by_name: string | null
  posted_by_name: string | null
  line_count: number
  debit_total: Money | null
  credit_total: Money | null
  /** Bumped on every edit of a draft. Post sends the one the poster reviewed. */
  version: number
  /** Set when the voucher was cancelled (a discarded draft keeps its number). */
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  /** The number of a reversal draft waiting to be posted, if one is. */
  pending_reversal_no: string | null
}

/** One double-entry line. Exactly one of `debit`/`credit` is non-zero; the other is '0.00'. */
export interface VoucherLine {
  id: string
  line_no: number
  ledger_account_id: string
  account_code: string
  account_name: string
  root_type: LedgerRootType
  debit: Money
  credit: Money
  party_id: string | null
  party_name: string | null
  department_id: string | null
  department_code: string | null
  programme_id: string | null
  activity_id: string | null
  ward_code: string | null
  project_id: string | null
  budget_line_id: string | null
  /** The voucher this line settles — a receipt line naming the bill it pays. */
  against_voucher_id: string | null
  against_voucher_no: string | null
  narration: string | null
}

/** A posted ledger entry, as the voucher detail shows them. Immutable once written. */
export interface VoucherEntry {
  id: string
  ledger_account_id: string
  account_code: string
  debit: Money
  credit: Money
  posting_date: string
  posted_at: string
  is_reversal: boolean
}

/**
 * Whether a voucher balances, computed in SQL over NUMERIC.
 *
 * `difference` is `debits − credits` as a decimal string. The screen compares it to zero to decide
 * what to SAY; it never adds the two columns itself, and the posting attempt is refused by the
 * database whatever the screen concluded.
 */
export interface VoucherBalance {
  debit_total: Money
  credit_total: Money
  difference: Money
}

export interface VoucherDraftBalance extends VoucherBalance {
  line_count: number
}

export interface VoucherPostedBalance extends VoucherBalance {
  entry_count: number
}

export type VoucherSourceKind =
  | 'supplier_invoice' | 'supplier_payment' | 'depreciation_run' | 'asset_disposal'
  | 'bank_deposit' | 'rates_bill' | 'rates_receipt' | 'cash_receipt'

/** The document a voucher was posted from. */
export interface VoucherSource {
  kind: VoucherSourceKind
  id: string
  label: string
}

export interface VoucherQueues {
  to_post: number
  mine: number
  posted: number
  all: number
  /** Discarded drafts. `all` does not include them. */
  cancelled: number
}

export interface VoucherDetail {
  voucher: VoucherSummary & {
    period_no: number | null
    period_label: string | null
    period_status: LedgerPeriodStatus | null
    financial_year_label: string
    cancelled_by_name: string | null
  }
  lines: VoucherLine[]
  /** Empty while the voucher is a draft. One per line once posted. */
  entries: VoucherEntry[]
  reversed_by: {
    id: string; voucher_no: string; posting_date: string
    status: VoucherStatus; narration: string | null
  } | null
  /** The document this voucher was raised from, found server-side; `null` for a hand-keyed journal. */
  source: VoucherSource | null
  /** What the draft WOULD post. */
  draft_balance: VoucherDraftBalance
  /** What the ledger actually holds for this voucher. Nil entries while it is a draft. */
  posted_balance: VoucherPostedBalance
  balances: boolean
  note: string | null
  /** Whether the caller may cancel this draft (a closing draft is also cancelled by a holder of close_year). */
  may_discard?: boolean
}

export interface VoucherLineBody {
  ledger_account_id: string
  /** Send one of these two, never both. A line with both is refused by a CHECK constraint. */
  debit?: Money
  credit?: Money
  party_id?: string
  department_id?: string
  programme_id?: string
  activity_id?: string
  ward_code?: string
  project_id?: string
  budget_line_id?: string
  against_voucher_id?: string
  narration?: string
}

export interface VoucherBody {
  /** Omit to let the server number it. */
  voucher_no?: string
  voucher_type: CreatableVoucherType
  currency: Currency
  financial_year_id: string
  posting_date: string
  narration?: string
  reference?: string
  is_opening?: boolean
  lines: VoucherLineBody[]
}

/**
 * The month's salaries journal, raised by its own screen (type `payroll`, number SJ- issued by the
 * server). Not a payroll module: the lines are the totals whoever computes the salaries types in —
 * gross and the employer's contributions debited, PAYE, NSSA and the net paid credited. A
 * settlement line (`against_voucher_id`) makes no sense here and is left out.
 */
export interface SalariesJournalBody {
  currency: Currency
  financial_year_id: string
  posting_date: string
  narration?: string
  reference?: string
  lines: Omit<VoucherLineBody, 'against_voucher_id'>[]
}

export interface VoucherCreated {
  voucher: Pick<VoucherSummary,
    'id' | 'voucher_no' | 'voucher_type' | 'currency' | 'financial_year_id' | 'posting_date'
    | 'status' | 'prepared_by' | 'prepared_at' | 'version'>
  lines: number
  balance: VoucherBalance
  balances: boolean
  note: string
}

export interface VoucherPosted {
  posted: string
  entries: number
  note: string
}

export interface VoucherReversed {
  reversal: Pick<VoucherSummary,
    'id' | 'voucher_no' | 'voucher_type' | 'currency' | 'posting_date' | 'status' | 'reverses_voucher_id'
    | 'prepared_by' | 'version'>
  reversed: string
  /** Always true: the reversal is a draft that somebody else posts. */
  awaiting_post: boolean
  note: string
}

export interface VoucherCancelled {
  cancelled: string
  voucher_id: string
  status: 'cancelled'
  cancel_reason: string
  note: string
}

export interface VoucherQuery {
  financial_year_id?: string
  voucher_type?: VoucherType
  status?: VoucherStatus
  currency?: Currency
  from?: string
  to?: string
  q?: string
  party_id?: string
  /** `to_post`: drafts the caller did not prepare. `mine`: drafts the caller prepared. */
  queue?: 'to_post' | 'mine'
  limit?: number
  offset?: number
  sort?: 'posting_date' | 'voucher_no' | 'voucher_type' | 'status'
  direction?: 'asc' | 'desc'
}

export interface VoucherList {
  vouchers: VoucherSummary[]
  total: number
  limit: number
  offset: number
  /** `null` means not confined to particular votes. */
  scope_applied: string[] | null
  /** Counted for the same year filter, so the tabs can say how many each holds. */
  queues: VoucherQueues
  note: string
}

// ── The posted ledger ──────────────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string
  voucher_id: string
  voucher_no: string
  voucher_type: VoucherType
  ledger_account_id: string
  account_code: string
  account_name: string
  root_type: LedgerRootType
  debit: Money
  credit: Money
  currency: Currency
  posting_date: string
  party_id: string | null
  department_id: string | null
  programme_id: string | null
  activity_id: string | null
  ward_code: string | null
  project_id: string | null
  budget_line_id: string | null
  against_voucher_id: string | null
  is_reversal: boolean
  narration: string | null
  posted_at: string
}

/** One total per currency. There is deliberately no row spanning the two books. */
export interface LedgerEntryTotal {
  currency: Currency
  rows: number
  debit_total: Money
  credit_total: Money
}

export interface LedgerEntryPage {
  entries: LedgerEntry[]
  total: number
  limit: number
  offset: number
  totals: LedgerEntryTotal[]
  scope_applied: string[] | null
  /** The words the screen must use about `totals`: they describe the filtered set, not the page. */
  totals_cover: string
  note: string
}

export interface LedgerEntryQuery {
  financial_year_id?: string
  ledger_account_id?: string
  ledger_period_id?: string
  party_id?: string
  department_id?: string
  project_id?: string
  ward_code?: string
  currency?: Currency
  root_type?: LedgerRootType
  voucher_type?: VoucherType
  from?: string
  to?: string
  q?: string
  limit?: number
  offset?: number
  sort?: 'posting_date' | 'account_code' | 'voucher_no' | 'debit' | 'credit'
  direction?: 'asc' | 'desc'
}

// ── The trial balance ──────────────────────────────────────────────────────────────────────────

/**
 * One account's position in one book.
 *
 * `debit_balance` and `credit_balance` are the two columns of a trial balance and an account appears
 * in exactly one of them: the other is '0.00'. That is a presentation the database computes, so two
 * screens cannot disagree about which side an account falls on.
 */
export interface TrialBalanceRow {
  currency: Currency
  /** `null` on the unclosed-surplus row: earlier years' revenue and expenditure not yet closed. */
  ledger_account_id: string | null
  account_code: string | null
  account_name: string
  root_type: LedgerRootType
  report_type: LedgerReportType
  account_type: LedgerAccountType | null
  entry_count: number
  debit_total: Money
  credit_total: Money
  debit_balance: Money
  credit_balance: Money
  first_posting_date: string | null
  last_posting_date: string | null
}

/**
 * One book's trial balance, summed in SQL.
 *
 * `balances` is the whole point: a trial balance that does not balance is a DEFECT, not a
 * presentation choice, and the screen says so rather than printing two columns and leaving the
 * reader to add them up. There is no type here that spans two books.
 */
export interface TrialBalanceBook {
  currency: Currency
  account_count: number
  debit_total: Money
  credit_total: Money
  difference: Money
  balances: boolean
}

export interface TrialBalanceResult {
  accounts: TrialBalanceRow[]
  books: TrialBalanceBook[]
  currencies: Currency[]
  note: string
  /** The currencies whose book does not balance. Empty is the only acceptable value. */
  unbalanced: Currency[]
  as_at: string
  closing: ClosingMode
  /** Per book: has the year been closed there? The Before/After control only matters when one is. */
  closed: { currency: Currency; closed: boolean }[]
}

// ── One account's balance ──────────────────────────────────────────────────────────────────────

/**
 * The carrying balance of an account in one currency, across every financial year.
 *
 * `net_debit` is SIGNED, debit-positive. Which side it belongs on is read from the account's root
 * type rather than presented as an absolute figure, so an asset carrying a credit balance stays
 * visible as the fact it is instead of being quietly shown as positive.
 */
export interface AccountBalanceRow {
  currency: Currency
  entry_count: number
  debit_total: Money
  credit_total: Money
  net_debit: Money
  last_posting_date: string | null
}

export interface AccountBalanceByYear {
  financial_year_id: string
  financial_year_label: string
  currency: Currency
  debit_total: Money
  credit_total: Money
  debit_balance: Money
  credit_balance: Money
}

export interface AccountBalanceResult {
  account: LedgerAccount
  natural_side: 'debit' | 'credit'
  balances: AccountBalanceRow[]
  by_financial_year: AccountBalanceByYear[]
  note: string
}

// ── The statements ─────────────────────────────────────────────────────────────────────────────

export interface StatementAccountRow {
  currency: Currency
  /** `null` on the one line that is not an account: the surplus or deficit of earlier years not yet closed. */
  ledger_account_id: string | null
  /** `null` on that same line. Print no code for it. */
  account_code: string | null
  account_name: string
  root_type: LedgerRootType
  account_type?: LedgerAccountType | null
  debit_balance?: Money
  credit_balance?: Money
  /** The figure as the statement presents it: positive on the account's own natural side. */
  balance: Money
}

export interface StatementSection {
  root_type: LedgerRootType
  natural_side: 'debit' | 'credit'
  accounts: StatementAccountRow[]
}

/** One book. A statement is an array of these and never a single set of sections. */
export interface StatementBook {
  currency: Currency
  sections: StatementSection[]
}

export interface StatementSubtotal {
  currency: Currency
  root_type: LedgerRootType
  subtotal: Money
}

/**
 * A statement of financial position, per currency.
 *
 * `incomplete` IS NOT A FOOTNOTE. It names what this statement does not yet contain or could not
 * confirm: for example no payable account set up, no fixed asset account, a bank account with
 * entries after its last reconciliation, or an asset register that disagrees with the ledger. A
 * position statement that silently omitted such a gap would be the most dangerous screen in this
 * system, so the array is rendered prominently and never collapsed.
 */
export interface PositionStatement {
  financial_year?: { id: string; label: string; start_date: string; end_date: string }
  /** The date the statement is drawn to, as the server resolved it. */
  as_at?: string
  books: StatementBook[]
  subtotals: StatementSubtotal[]
  currencies: Currency[]
  incomplete: string[]
  note: string
  /** Revenue less expenditure of the open year, per book. Absent for a closed book. */
  surplus_to_date: SurplusToDate[]
  check: PositionCheck[]
}

export interface SurplusToDate {
  currency: Currency
  /** Absolute; the sign is in `side`. */
  amount: Money
  side: 'surplus' | 'deficit'
}

export interface PositionCheck {
  currency: Currency
  assets: Money
  liabilities: Money
  equity_and_surplus: Money
  /** Assets less liabilities less equity and surplus, as the server worked it out. */
  difference: Money
  balances: boolean
}

export type Periodicity = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export interface StatementPeriod {
  from_date: string
  to_date: string
  /** Stable and ordinal: 'm01'…'m12', 'q1'…'q4'. Generated from the council's own year start. */
  key: string
  label: string
}

/** One account's movement in one period of one book. Absent means no activity, which reads as nil. */
export interface StatementPeriodRow {
  key: string
  currency: Currency
  ledger_account_id: string
  account_code: string
  root_type: LedgerRootType
  balance: Money
}

export interface PerformanceStatement {
  financial_year: { id: string; label: string; start_date: string; end_date: string }
  books: StatementBook[]
  /** `null` when no periodicity was asked for: the statement is then the year in one column. */
  periods: StatementPeriod[] | null
  period_rows: StatementPeriodRow[]
  /** The date the statement is drawn to, as the server resolved it. */
  as_at?: string
  /** Total revenue and total expenditure per book. */
  subtotals?: StatementSubtotal[]
  /** The result per book: an absolute amount and its side. */
  surplus?: PerformanceResult[]
  /** Year-to-date buckets OVERLAP by design and must never be added together. */
  accumulated: boolean
  currencies: Currency[]
  incomplete: string[]
  note: string
  /** Present with `compare: 'prior_year'`: the prior year's balance for each account. */
  prior?: { currency: Currency; ledger_account_id: string; balance: Money }[]
  /** `label` already names a part-year span ("FY 2025, to 30 June 2025"); use it as sent. */
  prior_year?: { id: string; label: string; as_at: string; whole_year: boolean } | null
}

export interface PerformanceResult {
  currency: Currency
  /** Absolute; the sign is in `side`. */
  amount: Money
  side: 'surplus' | 'deficit'
}

// ── Debtor ageing ──────────────────────────────────────────────────────────────────────────────

/**
 * The buckets, in the order a statement prints them.
 *
 * `settled` and `unallocated` are not ages. `unallocated` is a receipt not yet matched to a bill and
 * carries a NEGATIVE `outstanding_amount`, which is what makes a party's ageing total reconcile to
 * its control-account balance. Dropping it would make the two disagree silently, which is the usual
 * failure of an ageing report.
 */
export type AgeingBucket =
  | 'current' | '31_60' | '61_90' | '91_180' | '181_365' | 'over_365'
  | 'settled' | 'unallocated'

export interface AgeingBill {
  currency: Currency
  party_id: string | null
  party_name: string | null
  party_reference: string | null
  ledger_account_id: string
  voucher_id: string
  voucher_no: string
  voucher_type: VoucherType
  posting_date: string
  billed_amount: Money
  settled_amount: Money
  /** Negative on an `unallocated` row: money received and not yet matched to a bill. */
  outstanding_amount: Money
  last_settled_on: string | null
  days_outstanding: number
  ageing_bucket: AgeingBucket
}

/** Per currency AND per bucket. Never a figure spanning the two currencies. */
export interface AgeingBucketTotal {
  currency: Currency
  ageing_bucket: AgeingBucket
  rows: number
  outstanding_amount: Money
}

export interface AgeingPartyTotal {
  currency: Currency
  party_id: string | null
  party_name: string | null
  party_reference: string | null
  bill_count: number
  outstanding_amount: Money
  oldest_days: number
}

/**
 * The check most ageing reports fail, computed in SQL.
 *
 * The ageing total for one book against its receivable control account's own balance, with the
 * difference and whether they agree — and Postgres did the comparison, so the answer does not
 * depend on JavaScript arithmetic. It is deliberately NOT subject to the caller's filters: a
 * reconciliation narrowed to one bucket would always agree and would mean nothing.
 *
 * `agrees: false` is a defect in the data, not a presentation choice.
 */
export interface AgeingReconciliation {
  currency: Currency
  rows: number
  ageing_total: Money
  control_balance: Money
  control_accounts: number
  /** The control account codes this book's receivable sits in, comma-separated. */
  control_codes: string | null
  difference: Money
  agrees: boolean
}

export interface DebtorAgeingResult {
  bills: AgeingBill[]
  total: number
  limit: number
  offset: number
  by_bucket: AgeingBucketTotal[]
  by_party: AgeingPartyTotal[]
  by_party_bucket: { currency: Currency; party_id: string | null; ageing_bucket: AgeingBucket; outstanding_amount: Money }[]
  reconciliation: AgeingReconciliation[]
  buckets: Array<{ key: AgeingBucket; label: string }>
  /** Ageing is measured against this date. It moves, so a printed statement must carry it. */
  as_at: string
  note: string
}

// ── Year-end ───────────────────────────────────────────────────────────────────────────────────

export interface YearClosed {
  closing_voucher: {
    id: string; voucher_no: string; currency: Currency
    posting_date: string; status: VoucherStatus; entries: number; version: number
  }
  /** The closing is a draft: it changes nothing until somebody other than its preparer posts it. */
  awaiting_post: true
  note: string
}

// ── Balances by account, and one account's ledger ──────────────────────────────────────────────

/** Whether a statement counts the closing vouchers: `before` them, or `after`. */
export type ClosingMode = 'before' | 'after'

/** A balance as the ledger shows it: `net_debit` signed, `amount` absolute, `side` where it falls. */
export interface Bal {
  net_debit: Money
  amount: Money
  side: 'Dr' | 'Cr'
}

export interface ChartBalanceRow {
  id: string
  code: string
  name: string
  root_type: LedgerRootType
  report_type: LedgerReportType
  account_type: LedgerAccountType | null
  parent_id: string | null
  is_group: boolean
  is_postable: boolean
  status: 'active' | 'inactive'
  notes: string | null
  /** A heading carries the sum of everything beneath it. Nil balances are omitted. */
  balances: (Bal & { currency: Currency })[]
}

export interface ChartBalances {
  accounts: ChartBalanceRow[]
  currencies: Currency[]
  as_at: string
  closing: ClosingMode
}

export interface LedgerLine {
  id: string
  voucher_id: string
  voucher_no: string
  voucher_type: VoucherType
  posting_date: string
  narration: string | null
  party_id: string | null
  party_name: string | null
  debit: Money
  credit: Money
  /** The running balance after this line, in this one book. */
  balance: Bal
  /** Non-null only on a bank account: is the entry under a reconciled statement? */
  reconciled: boolean | null
}

export interface AccountLedgerQuery {
  financial_year_id: string
  currency: Currency
  from?: string
  to?: string
  /** At most 500; the server's default is 100. */
  limit?: number
  offset?: number
}

export interface AccountLedgerResult {
  account: LedgerAccount
  natural_side: 'debit' | 'credit'
  currency: Currency
  from: string
  to: string
  brought_forward: Bal
  entries: LedgerLine[]
  totals: { debit: Money; credit: Money }
  carried_forward: Bal
  total: number
  limit: number
  offset: number
}

export interface CashAccountRow {
  id: string
  code: string
  name: string
  account_type: 'bank' | 'cash'
  currency: Currency
  balance: Bal
  last_entry: string | null
  reconciled_to: string | null
  reconciled_balance: Money | null
  /** Bank accounts only; `null` for cash. */
  unreconciled: { entries: number; debit: Money; credit: Money } | null
}

export interface CashAccounts {
  accounts: CashAccountRow[]
}

// ── The cash statement and the ledger reports ──────────────────────────────────────────────────

export interface CashStatementBook {
  currency: Currency
  opening: Money
  receipts: Money
  payments: Money
  closing: Money
}

export type CashCounterGroup =
  | 'revenue' | 'expense' | 'receivable' | 'payable' | 'fixed_asset' | 'tax'
  | 'other_asset' | 'liability' | 'equity'

export interface CashStatement {
  from: string
  to: string
  /** `agrees` is false when the account's opening + receipts - payments is not its closing. */
  accounts: (CashStatementBook & { id: string; code: string; name: string; agrees: boolean })[]
  books: CashStatementBook[]
  by_counter: {
    currency: Currency; group: CashCounterGroup; label: string
    /** Any of the three can be NEGATIVE: a line running against its voucher. Print as sent. */
    inflow: Money; outflow: Money; net: Money
  }[]
  reconciles: { currency: Currency; movement: Money; analysed: Money; agrees: boolean }[]
  /** States that this is a statement of cash receipts and payments, not an IPSAS 2 cash flow statement. */
  note: string
}

export interface GeneralLedgerReportQuery {
  financial_year_id: string
  currency: Currency
  from?: string
  to?: string
  root_type?: LedgerRootType
  account_from?: string
  account_to?: string
  /** Accounts per page, at most 100; the server's default is 25. */
  limit?: number
  offset?: number
}

export interface GeneralLedgerReport {
  accounts: {
    account: { id: string; code: string; name: string; root_type: LedgerRootType }
    brought_forward: Bal
    entries: LedgerLine[]
    totals: { debit: Money; credit: Money }
    carried_forward: Bal
  }[]
  total_accounts: number
  limit: number
  offset: number
}

export interface JournalListingQuery {
  financial_year_id: string
  from?: string
  to?: string
  voucher_type?: VoucherType
  status?: VoucherStatus
  currency?: Currency
  /** At most 200. */
  limit?: number
  offset?: number
}

export interface JournalListingVoucher {
  id: string
  voucher_no: string
  voucher_type: VoucherType
  currency: Currency
  posting_date: string
  status: VoucherStatus
  narration: string | null
  reference: string | null
  prepared_by_name: string | null
  posted_by_name: string | null
  lines: {
    line_no: number
    account_code: string
    account_name: string
    party_name: string | null
    debit: Money
    credit: Money
    narration: string | null
  }[]
  debit_total: Money
  credit_total: Money
}

export interface JournalListing {
  vouchers: JournalListingVoucher[]
  total: number
  totals: { currency: Currency; debit_total: Money; credit_total: Money }[]
}
