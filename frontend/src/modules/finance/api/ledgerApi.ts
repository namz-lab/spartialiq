/**
 * The general ledger API client.
 *
 * WHY THIS IS SEPARATE FROM `financeApi.ts`
 * The ledger is its own bounded context (see the header of `../models/ledgerTypes.ts`): it
 * originates figures rather than restating imported ones, its amounts are debit/credit pairs rather
 * than signed values, and its lines are immutable. One client per context keeps a screen from
 * reaching for `financeApi.transactions()` when it means the book of account, and keeps the two
 * teams working on this module out of one 1000-line file. It mirrors the backend's
 * `src/routes/finance-ledger.js` one-for-one, so a screen never builds a URL by hand.
 *
 * Every call returns the envelope's `data`, or throws the axios error for the caller to render with
 * `messageOf()` from the finance store. The backend's refusals are written to be read — "voucher
 * GL-JV-0007 does not balance: debits 100.00, credits 60.00, difference 40.00" — so they are shown
 * as they arrive rather than replaced with something vaguer.
 *
 * WHAT THIS CLIENT DOES NOT DO
 *
 * 1. IT DOES NOT DECIDE WHAT THE PERSON MAY DO. Every endpoint re-checks its permission
 *    server-side, so a request issued from a hidden control gets the same 403 as one from a visible
 *    button. The permission list is used to EXPLAIN an absence, never to secure it.
 *
 * 2. IT DOES NOT CHECK WHETHER A VOUCHER BALANCES. That is arithmetic on money, and it happens in
 *    SQL over NUMERIC. `voucher()` returns the database's own `draft_balance.difference` so a
 *    screen can say "this does not balance yet" before anyone tries to post; the refusal at posting
 *    comes from a deferred constraint trigger (migration 203) and does not depend on this file or
 *    on the screen having asked. There is no amount arithmetic in this module at all.
 *
 * 3. IT DOES NOT COMBINE CURRENCIES. Nothing here takes a "total" parameter or merges two books.
 *    `trialBalance()` returns one book per currency and `position()`/`performance()` return an
 *    array of books; a caller that wanted one figure across them would have to write the addition
 *    itself, and must not.
 */

import api from '../../../services/api'
import type {
  AccountBalanceResult, Currency, DebtorAgeingResult, LedgerAccountBody, LedgerAccountList,
  LedgerAccountTree, LedgerEntryPage, LedgerEntryQuery, LedgerPartyList, LedgerPeriodList,
  LedgerPeriodStatus, LedgerPeriodsOpened, LedgerParty, LedgerAccount, PartyType, Periodicity,
  PerformanceStatement, PositionStatement, TrialBalanceResult, VoucherBody, VoucherCreated,
  VoucherDetail, VoucherList, VoucherPosted, VoucherQuery, VoucherReversed, VoucherCancelled, VoucherLineBody,
  YearClosed, LedgerRootType, LedgerAccountType, AgeingBucket, ClosingMode, ChartBalances,
  AccountLedgerQuery, AccountLedgerResult, CashAccounts, CashStatement, GeneralLedgerReport,
  GeneralLedgerReportQuery, JournalListing, JournalListingQuery, SalariesJournalBody,
} from '../models/ledgerTypes'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

/**
 * A CSV export: the same endpoint as the JSON read, asked for `format=csv`, returned as a Blob for
 * `saveBlob()` in the accountant kit. The server's text is saved as it arrives, never re-formatted.
 */
const csv = async (url: string, params: object): Promise<Blob> =>
  (await api.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' })).data as Blob

export interface LedgerAccountQuery {
  root_type?: LedgerRootType
  account_type?: LedgerAccountType
  report_type?: 'balance_sheet' | 'performance'
  status?: 'active' | 'inactive'
  /** Leaves only — what a voucher line may actually cite. */
  postable_only?: boolean
  q?: string
  sort?: 'code' | 'name' | 'root_type'
  direction?: 'asc' | 'desc'
}

export interface LedgerPartyQuery {
  party_type?: PartyType
  status?: 'active' | 'inactive'
  q?: string
  limit?: number
  offset?: number
  sort?: 'name' | 'reference' | 'party_type'
  direction?: 'asc' | 'desc'
}

export interface DebtorAgeingQuery {
  currency?: Currency
  party_id?: string
  ledger_account_id?: string
  bucket?: AgeingBucket
  /** Defaults to true server-side: a settled bill is not a debt. */
  outstanding_only?: boolean
  limit?: number
  offset?: number
}

export const ledgerApi = {
  // ── The chart of accounts ───────────────────────────────────────────────────────────────────

  /** The flat chart, in code order. */
  async accounts(params?: LedgerAccountQuery): Promise<LedgerAccountList> {
    return unwrap(await api.get('/finance/ledger/accounts', { params: { ...params, tree: false } }))
  },

  /**
   * The chart nested by parent.
   *
   * An account whose parent is outside the filtered set comes back as a root rather than
   * disappearing — a filtered chart must still show every account it matched, because an account
   * silently absent from a chart of accounts is the worst kind of missing.
   */
  async accountTree(params?: LedgerAccountQuery): Promise<LedgerAccountTree> {
    return unwrap(await api.get('/finance/ledger/accounts', { params: { ...params, tree: true } }))
  },

  async createAccount(body: LedgerAccountBody): Promise<LedgerAccount> {
    return unwrap(await api.post('/finance/ledger/accounts', body))
  },

  /**
   * Amend an account.
   *
   * `code` and `root_type` are deliberately not accepted: the code is cited by every entry already
   * posted, and moving an account between root types would move posted figures between statements
   * with no trace, which is the thing a reversal exists to avoid.
   */
  async updateAccount(id: string, body: {
    name?: string
    account_type?: LedgerAccountType | null
    parent_id?: string | null
    status?: 'active' | 'inactive'
    notes?: string | null
  }): Promise<LedgerAccount> {
    return unwrap(await api.patch(`/finance/ledger/accounts/${id}`, body))
  },

  /**
   * Withdraw an account.
   *
   * Refused outright once anything has been posted to it, with the count in the message: the ledger
   * is immutable, so an account with postings can be made inactive but never removed.
   */
  async withdrawAccount(id: string): Promise<{ withdrawn: string }> {
    return unwrap(await api.delete(`/finance/ledger/accounts/${id}`))
  },

  /**
   * The whole chart with each account's balance as at a date, one row per account in code order.
   * A heading carries the sum of everything beneath it, summed in SQL.
   */
  async chartBalances(params: {
    financial_year_id: string; as_at?: string; closing?: ClosingMode
  }): Promise<ChartBalances> {
    return unwrap(await api.get('/finance/ledger/chart-balances', { params }))
  },

  /**
   * One account's ledger in one book, with brought-forward, a running balance and carried-forward.
   * Refused with 409 for a heading, which has no entries of its own.
   */
  async accountLedger(id: string, params: AccountLedgerQuery): Promise<AccountLedgerResult> {
    return unwrap(await api.get(`/finance/ledger/accounts/${id}/ledger`, { params }))
  },

  async accountLedgerCsv(id: string, params: AccountLedgerQuery): Promise<Blob> {
    return csv(`/finance/ledger/accounts/${id}/ledger`, params)
  },

  /** The bank and cash accounts with their ledger balance and reconciliation state. */
  async cashAccounts(financialYearId: string): Promise<CashAccounts> {
    return unwrap(await api.get('/finance/ledger/cash-accounts', { params: { financial_year_id: financialYearId } }))
  },

  async accountBalance(id: string, params?: {
    currency?: Currency; financial_year_id?: string
  }): Promise<AccountBalanceResult> {
    return unwrap(await api.get(`/finance/ledger/accounts/${id}/balance`, { params }))
  },

  // ── The party register ──────────────────────────────────────────────────────────────────────

  async parties(params?: LedgerPartyQuery): Promise<LedgerPartyList> {
    return unwrap(await api.get('/finance/ledger/parties', { params }))
  },

  async createParty(body: {
    party_type: PartyType; name: string; reference?: string
    contact_name?: string; contact_phone?: string; contact_email?: string
    address_text?: string; notes?: string
  }): Promise<LedgerParty> {
    return unwrap(await api.post('/finance/ledger/parties', body))
  },

  async updateParty(id: string, body: {
    name?: string; contact_name?: string | null; contact_phone?: string | null
    contact_email?: string | null; address_text?: string | null
    status?: 'active' | 'inactive'
  }): Promise<LedgerParty> {
    return unwrap(await api.patch(`/finance/ledger/parties/${id}`, body))
  },

  // ── Accounting periods ──────────────────────────────────────────────────────────────────────

  async periods(params?: {
    financial_year_id?: string; status?: LedgerPeriodStatus
  }): Promise<LedgerPeriodList> {
    return unwrap(await api.get('/finance/ledger/periods', { params }))
  },

  /**
   * Open the periods for a financial year.
   *
   * The buckets are generated by the backend from the council's OWN financial year start, so a
   * July–June council gets period 1 = July and the periods tile the year exactly. Idempotent:
   * re-running it adds what is missing and leaves an existing period, and its status, alone.
   */
  async openPeriods(body: {
    financial_year_id: string; periodicity?: Periodicity
  }): Promise<LedgerPeriodsOpened> {
    return unwrap(await api.post('/finance/ledger/periods', body))
  },

  /** `locked` is final and the backend will not take it back out. */
  async setPeriodStatus(id: string, status: LedgerPeriodStatus): Promise<{
    id: string; period_no: number; label: string | null
    status: LedgerPeriodStatus; from_date: string; to_date: string
  }> {
    return unwrap(await api.patch(`/finance/ledger/periods/${id}`, { status }))
  },

  // ── Vouchers ────────────────────────────────────────────────────────────────────────────────

  async vouchers(params?: VoucherQuery): Promise<VoucherList> {
    return unwrap(await api.get('/finance/ledger/vouchers', { params }))
  },

  async voucher(id: string): Promise<VoucherDetail> {
    return unwrap(await api.get(`/finance/ledger/vouchers/${id}`))
  },

  /**
   * Create a draft voucher with its lines, in one backend transaction.
   *
   * A draft posts nothing. The response carries the draft's difference so a screen can state
   * plainly that it does not balance yet, without doing the arithmetic.
   */
  async createVoucher(body: VoucherBody): Promise<VoucherCreated> {
    return unwrap(await api.post('/finance/ledger/vouchers', body))
  },

  /**
   * Raise the month's salaries journal as a draft `payroll` voucher, numbered SJ- by the server.
   * Not a hand-typed journal: the screen collects the month's totals and this writes the double
   * entry, which somebody else then posts.
   */
  async createSalariesJournal(body: SalariesJournalBody): Promise<VoucherCreated> {
    return unwrap(await api.post('/finance/ledger/salaries-journal', body))
  },

  /** Draft only. A posted voucher's lines are frozen by a trigger whatever this is asked to do. */
  async updateVoucher(id: string, body: {
    posting_date?: string; narration?: string | null; reference?: string | null
    lines?: VoucherLineBody[]
  }): Promise<{ updated: string; version: number; balance: { debit_total: string; credit_total: string; difference: string }; balances: boolean }> {
    return unwrap(await api.patch(`/finance/ledger/vouchers/${id}`, body))
  },

  /**
   * Cancel a draft. The voucher is NOT deleted: it keeps its number and its lines, is marked
   * cancelled with who cancelled it, when and why, and leaves the default registers. Only the
   * person who prepared it may cancel it (403 `not_preparer` otherwise). The reason is optional
   * (3 to 2000 characters); without one the server records a default sentence. A posted voucher
   * is never cancelled; it is reversed.
   */
  async discardVoucher(id: string, reason?: string): Promise<VoucherCancelled> {
    return unwrap(await api.delete(`/finance/ledger/vouchers/${id}`, reason ? { data: { reason } } : undefined))
  },

  /**
   * Post a voucher to the book of account. The point of no return.
   *
   * Pass the version the poster reviewed (`voucher.version` as read when the page was opened). If
   * the draft was changed since, the server answers 409 `changed_since_review` and posts nothing.
   * The version is optional only so that the old console, which has none, keeps working.
   *
   * Refused when the caller prepared it (separation of duties, a CHECK constraint), when the period
   * is not open, when it does not balance, or when an account is a heading. Every one of those is
   * enforced by the database and merely reported here.
   */
  async postVoucher(id: string, expectedVersion?: number): Promise<VoucherPosted> {
    return unwrap(await api.post(`/finance/ledger/vouchers/${id}/post`,
      expectedVersion === undefined ? {} : { expected_version: expectedVersion }))
  },

  /**
   * Raise a reversal of a posted voucher, as a DRAFT.
   *
   * Nothing is posted by this call. The reversal waits in the To post queue for somebody other than
   * its preparer, and the original stays posted and untouched until then. The reply carries the
   * draft (`reversal`) and `awaiting_post: true`. The reason is required and goes on the record;
   * it cannot be changed afterwards. A second reversal while one is waiting is refused (409
   * `reversal_pending`).
   */
  async reverseVoucher(id: string, body: {
    reason: string; posting_date?: string; voucher_no?: string
  }): Promise<VoucherReversed> {
    return unwrap(await api.post(`/finance/ledger/vouchers/${id}/reverse`, body))
  },

  // ── The posted ledger and the statements ────────────────────────────────────────────────────

  async entries(params?: LedgerEntryQuery): Promise<LedgerEntryPage> {
    return unwrap(await api.get('/finance/ledger/entries', { params }))
  },

  /**
   * The trial balance: one book per currency, each of which must balance on its own.
   *
   * `include_nil` is false by default — an account whose balance is nil is not part of a trial
   * balance — and `unbalanced` names any currency whose book does not balance, which is a defect
   * rather than something to present.
   */
  async trialBalance(params: {
    financial_year_id: string
    currency?: Currency
    root_type?: LedgerRootType
    include_nil?: boolean
    /** Balances as at this date; the server defaults it to the year end. */
    as_at?: string
    /** `after` (the default) counts the closing vouchers; `before` leaves them out. */
    closing?: ClosingMode
  }): Promise<TrialBalanceResult> {
    return unwrap(await api.get('/finance/ledger/trial-balance', { params }))
  },

  async trialBalanceCsv(params: {
    financial_year_id: string
    currency?: Currency
    root_type?: LedgerRootType
    include_nil?: boolean
    as_at?: string
    closing?: ClosingMode
  }): Promise<Blob> {
    return csv('/finance/ledger/trial-balance', params)
  },

  /**
   * The statement of financial position, per currency.
   *
   * Its `incomplete` array names what this statement does NOT contain or could not confirm: no payable
   * account set up, no fixed asset account, a bank account with entries after its last reconciliation,
   * an asset register that disagrees with the ledger. A screen must render it prominently: a position
   * statement that silently omits such a gap is worse than no statement.
   */
  async position(params: {
    financial_year_id: string; currency?: Currency; as_at?: string
  }): Promise<PositionStatement> {
    return unwrap(await api.get('/finance/ledger/statements/position', { params }))
  },

  async positionCsv(params: {
    financial_year_id: string; currency?: Currency; as_at?: string
  }): Promise<Blob> {
    return csv('/finance/ledger/statements/position', params)
  },

  /**
   * The statement of financial performance, per currency and optionally per period.
   *
   * The period buckets come from the same backend library the accounting periods were generated
   * from, so a ledger statement and a management account cannot disagree about which month a
   * posting fell in. `accumulated` buckets are year-to-date and OVERLAP, so they must not be added.
   */
  async performance(params: {
    financial_year_id: string
    currency?: Currency
    periodicity?: Periodicity
    accumulated?: boolean
    as_at?: string
    /** Adds the prior year's balances beside this year's. */
    compare?: 'prior_year'
  }): Promise<PerformanceStatement> {
    return unwrap(await api.get('/finance/ledger/statements/performance', { params }))
  },

  async performanceCsv(params: {
    financial_year_id: string
    currency?: Currency
    periodicity?: Periodicity
    accumulated?: boolean
    as_at?: string
    compare?: 'prior_year'
  }): Promise<Blob> {
    return csv('/finance/ledger/statements/performance', params)
  },

  /**
   * Cash receipts and payments over a range, with the counter-side analysis. It is not an IPSAS 2
   * cash flow statement and says so in its `note`.
   */
  async cashStatement(params: {
    financial_year_id: string; from?: string; to?: string
  }): Promise<CashStatement> {
    return unwrap(await api.get('/finance/ledger/statements/cash', { params }))
  },

  async cashStatementCsv(params: {
    financial_year_id: string; from?: string; to?: string
  }): Promise<Blob> {
    return csv('/finance/ledger/statements/cash', params)
  },

  // ── Ledger reports ──────────────────────────────────────────────────────────────────────────

  /** The general ledger for one book: accounts with a brought-forward balance or an entry in range. */
  async generalLedgerReport(params: GeneralLedgerReportQuery): Promise<GeneralLedgerReport> {
    return unwrap(await api.get('/finance/ledger/reports/general-ledger', { params }))
  },

  async generalLedgerReportCsv(params: GeneralLedgerReportQuery): Promise<Blob> {
    return csv('/finance/ledger/reports/general-ledger', params)
  },

  /** Vouchers with their lines, with debit and credit totals per currency. */
  async journalListing(params: JournalListingQuery): Promise<JournalListing> {
    return unwrap(await api.get('/finance/ledger/reports/journal-listing', { params }))
  },

  async journalListingCsv(params: JournalListingQuery): Promise<Blob> {
    return csv('/finance/ledger/reports/journal-listing', params)
  },

  /**
   * Debtor ageing from the ledger.
   *
   * A receivable debit is a bill; the receivable credits naming it are what was collected; the age
   * runs from the bill's own posting date. An `unallocated` row is a receipt not yet matched to a
   * bill and carries a negative outstanding figure, so a party's total reconciles to its control
   * account — which is the check this view is designed to pass and most ageing reports fail.
   */
  async debtorAgeing(params?: DebtorAgeingQuery): Promise<DebtorAgeingResult> {
    return unwrap(await api.get('/finance/ledger/debtor-ageing', { params }))
  },

  /**
   * Year-end closing for ONE currency's book.
   *
   * The two books close separately and no rate is applied. This raises a draft that someone else
   * posts from the To post queue; nobody is named on the close. `posting_date`, when given, must be
   * the last day of the year or the server answers 400 `bad_date`.
   */
  async closeYear(body: {
    financial_year_id: string
    currency: Currency
    /** Omit to let the server number the closing voucher. */
    voucher_no?: string
    posting_date?: string
  }): Promise<YearClosed> {
    return unwrap(await api.post('/finance/ledger/close-year', body))
  },
}

export default ledgerApi
