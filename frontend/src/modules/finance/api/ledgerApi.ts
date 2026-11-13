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
  VoucherDetail, VoucherList, VoucherPosted, VoucherQuery, VoucherReversed, VoucherLineBody,
  YearClosed, LedgerRootType, LedgerAccountType, AgeingBucket,
} from '../models/ledgerTypes'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

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

  /** Draft only. A posted voucher's lines are frozen by a trigger whatever this is asked to do. */
  async updateVoucher(id: string, body: {
    posting_date?: string; narration?: string | null; reference?: string | null
    lines?: VoucherLineBody[]
  }): Promise<{ updated: string; balance: { debit_total: string; credit_total: string; difference: string }; balances: boolean }> {
    return unwrap(await api.patch(`/finance/ledger/vouchers/${id}`, body))
  },

  /** Discard a draft. A posted voucher is never deleted; it is reversed. */
  async discardVoucher(id: string): Promise<{ discarded: string }> {
    return unwrap(await api.delete(`/finance/ledger/vouchers/${id}`))
  },

  /**
   * Post a voucher to the book of account. The point of no return.
   *
   * Refused when the caller prepared it (separation of duties, a CHECK constraint), when the period
   * is not open, when it does not balance, or when an account is a heading. Every one of those is
   * enforced by the database and merely reported here.
   */
  async postVoucher(id: string): Promise<VoucherPosted> {
    return unwrap(await api.post(`/finance/ledger/vouchers/${id}/post`, {}))
  },

  /**
   * Reverse a posted voucher.
   *
   * The original stays posted and visible — it is not cancelled, flagged or hidden — and the
   * reversal carries the opposite entries, so the net effect on every account is nil. The reason is
   * required and goes on the record.
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
  }): Promise<TrialBalanceResult> {
    return unwrap(await api.get('/finance/ledger/trial-balance', { params }))
  },

  /**
   * The statement of financial position, per currency.
   *
   * Its `incomplete` array names what this statement does NOT contain — payables, a reconciled bank
   * balance, fixed assets — because those workstreams are deferred. A screen must render it
   * prominently: a position statement that silently omits payables is worse than no statement.
   */
  async position(params: {
    financial_year_id: string; currency?: Currency
  }): Promise<PositionStatement> {
    return unwrap(await api.get('/finance/ledger/statements/position', { params }))
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
  }): Promise<PerformanceStatement> {
    return unwrap(await api.get('/finance/ledger/statements/performance', { params }))
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
   * The two books close separately and no rate is applied. `posted_by` is named explicitly rather
   * than guessed, because a closing voucher is an annual act with a signature on it, and it must be
   * somebody other than whoever runs this.
   */
  async closeYear(body: {
    financial_year_id: string
    currency: Currency
    voucher_no: string
    posted_by: string
    posting_date?: string
  }): Promise<YearClosed> {
    return unwrap(await api.post('/finance/ledger/close-year', body))
  },
}

export default ledgerApi
