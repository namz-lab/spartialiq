/**
 * The accountant's dashboard reads (backend `src/routes/finance-accounting.js`). Every amount is a
 * decimal string computed by Postgres and every money figure is one row per currency.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'
import type { Bal, LedgerLine, LedgerRootType, AgeingBucket } from '../models/ledgerTypes'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export type AgeGroup = 'current' | '31_60' | '61_90' | 'over_90'

export interface AccountingDashboard {
  year: { id: string; label: string; start_date: string; end_date: string; status: string; prior_year_id: string | null }
  /** Money into and out of the bank and the tills, year to date, posted entries only. */
  flows: { currency: Currency; collections: string; payments: string; collections_change_pct: string | null; payments_change_pct: string | null }[]
  banks: {
    id: string; code: string; name: string; currency: Currency; balance: string; last_entry: string | null
    /** Latest `to_date` of a reconciled statement; `null` when the account was never reconciled. */
    reconciled_to: string | null
    unreconciled_entries: number
  }[]
  budget: { currency: Currency; budget: string; spent: string; remaining: string; utilisation: string | null }[]
  position: { currency: Currency; assets: string; liabilities: string; net_assets: string }[]
  receivables: { currency: Currency; bucket: AgeGroup; items: number; amount: string }[]
  payables: { currency: Currency; bucket: AgeGroup; items: number; amount: string }[]
  payables_configured: boolean
  cashups: {
    id: string; session_no: string; business_date: string; cash_point_code: string; cash_point_name: string
    cashier_name: string; closed_at: string | null
    counts: { currency: Currency; expected: string; declared: string; variance: string }[]
  }[]
  /** Cash-ups awaiting verification that the caller counted, closed or witnessed: not theirs to verify. */
  own_cashups: number
  tasks: { key: string; count: number; text: string }[]
  items_requiring_action: number
  recent: { id: string; posting_date: string; voucher_no: string; voucher_type: string; currency: Currency; description: string; amount: string; cash_effect: string }[]
  current_period: { id: string; label: string; to_date: string; days_left: number } | null
  alerts: { tone: 'neg' | 'warn' | 'info'; key: string; text: string }[]
  /** Each book's own balance check, from the ledger. */
  books: { currency: Currency; balances: boolean; difference: string }[]
  /** For `current_period`; `null` when there is none. */
  readiness: { ready: boolean; outstanding: number } | null
}

export interface CreditorItem {
  currency: Currency; party_id: string | null; party_name: string | null; voucher_id: string; voucher_no: string
  posting_date: string; outstanding: string; days: number; bucket: AgeGroup
}

export interface PartyStatement {
  party: { id: string; name: string; reference: string | null; party_type: string; address_text?: string | null }
  currency: Currency
  kind: 'receivable' | 'payable'
  brought_forward: Bal
  entries: (LedgerLine & { account_code: string })[]
  carried_forward: Bal
  open_items: {
    voucher_id: string; voucher_no: string; voucher_type: string; posting_date: string
    /** The receivable account the bill was posted to, when the server sends it. */
    ledger_account_id?: string
    billed_amount: string; settled_amount: string; outstanding_amount: string
    days_outstanding: number; ageing_bucket: AgeingBucket
  }[]
  as_at: string
}

export interface ReadinessCheck {
  key: string
  label: string
  count: number
  ok: boolean
  detail: string | null
  /** An accountant route name to go and fix it, or `null`. */
  target: string | null
}

export interface PeriodReadiness {
  period: { id: string; period_no: number; label: string | null; from_date: string; to_date: string; status: 'open' | 'closed' | 'locked' }
  checks: ReadinessCheck[]
  books: { currency: Currency; balances: boolean; difference: string }[]
  ready: boolean
  /** The date the whole-book control checks are measured at. */
  as_at?: string
}

export interface YearEnd {
  year: { id: string; label: string; start_date: string; end_date: string; status: string }
  periods_open: number
  books: {
    currency: Currency; closed: boolean; revenue: string; expenditure: string; surplus: string
    side: 'surplus' | 'deficit'; closing_voucher: { id: string; voucher_no: string } | null
    /** True while any revenue or expense account of the book is not nil after the closings so far. */
    to_close: boolean
    /** A closing raised and waiting to be posted by someone other than its preparer. */
    pending_closing: { id: string; voucher_no: string; prepared_by_name: string | null } | null
  }[]
  surplus_account: { id: string; code: string; name: string } | null
  /** Information only: active users who may post a closing the caller raises (never the caller). Nobody is named on the close. */
  posters: { id: string; name: string }[]
}

export interface TaxControl {
  accounts: {
    id: string; code: string; name: string; root_type: LedgerRootType
    balances: (Bal & { currency: Currency })[]
  }[]
  periods: { period_id: string; period_no: number; label: string | null; from_date: string; to_date: string }[]
  movements: { ledger_account_id: string; currency: Currency; period_id: string; debit: string; credit: string }[]
  bank_accounts: { id: string; code: string; name: string }[]
  /** Who the tax accounts say the council owes, per book: ZIMRA on PAYE and VAT, NSSA on its contributions. */
  parties: {
    party_id: string; name: string; party_type: string; ledger_account_id: string
    currency: Currency; net_debit: string; amount: string; side: 'Dr' | 'Cr'
  }[]
  /** Each control account's closing balance at every period end, in the books it holds. */
  period_balances: { ledger_account_id: string; currency: Currency; period_id: string; period_no: number; closing: string; side: 'Dr' | 'Cr' }[]
  note: string
}

/** The vote book: budget control per vote, one row per currency, from the same view the budget reports read. */
export interface VoteBook {
  year: { id: string; label: string; start_date: string; end_date: string; status: string }
  totals: {
    currency: Currency; budget: string; committed: string; actual: string; available: string
    utilisation: string | null; committed_utilisation: string | null
  }[]
  votes: {
    currency: Currency; code: string; name: string; vote_number: number | null
    budget: string; committed: string; actual: string; available: string; variance: string
    utilisation: string | null; committed_utilisation: string | null
  }[]
  over_budget: {
    currency: Currency; department_code: string; department_name: string
    line_code: string; line_description: string | null
    budget: string; spent: string; committed: string; over_by: string
  }[]
  revenue: { currency: Currency; revenue_class: string; budget: string; actual: string; variance: string }[]
  lines_not_yet_approved: number
}

export const accountingApi = {
  async dashboard(financialYearId?: string | null): Promise<AccountingDashboard> {
    return unwrap(await api.get('/finance/accounting/dashboard', { params: financialYearId ? { financial_year_id: financialYearId } : {} }))
  },
  /** A debtor's (or creditor's) statement of account in one book, with its open items. */
  async partyStatement(partyId: string, params: {
    currency: Currency; from?: string; to?: string; kind?: 'receivable' | 'payable'
  }): Promise<PartyStatement> {
    return unwrap(await api.get(`/finance/accounting/party-statement/${partyId}`, { params }))
  },
  async periodReadiness(periodId: string): Promise<PeriodReadiness> {
    return unwrap(await api.get('/finance/accounting/period-readiness', { params: { period_id: periodId } }))
  },
  async yearEnd(financialYearId: string): Promise<YearEnd> {
    return unwrap(await api.get('/finance/accounting/year-end', { params: { financial_year_id: financialYearId } }))
  },
  async tax(financialYearId: string): Promise<TaxControl> {
    return unwrap(await api.get('/finance/accounting/tax', { params: { financial_year_id: financialYearId } }))
  },
  /** The vote book: budget control per vote for the accountant's desk. */
  async voteBook(financialYearId?: string | null): Promise<VoteBook> {
    return unwrap(await api.get('/finance/accounting/vote-book', { params: financialYearId ? { financial_year_id: financialYearId } : {} }))
  },
  async creditorAgeing(): Promise<{ items: CreditorItem[]; payables_configured: boolean }> {
    return unwrap(await api.get('/finance/accounting/creditor-ageing'))
  },
}
