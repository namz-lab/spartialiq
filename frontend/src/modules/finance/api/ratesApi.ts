/**
 * The rates billing API client. Mirrors the backend's `src/routes/finance-rates.js` one for one,
 * so a screen never builds a URL by hand.
 *
 * Separate from `ledgerApi.ts` for the reason that file is separate from `financeApi.ts`: rates is
 * its own bounded context. It raises documents — bills, receipts — whose double entry the ledger
 * posts; it does not post anything itself, and nothing here writes a ledger line.
 *
 * Every call returns the envelope's `data`, or throws the axios error for the caller to render
 * with `messageOf()` from the finance store. The backend's refusals are written to be read — "bill
 * Q1-00012 has 137.00 still open and this receipt allocates 200.00 to it" — so they are shown as
 * they arrive.
 *
 * WHAT THIS CLIENT DOES NOT DO
 * It computes no charge, no total and no balance, and it combines no currencies. What a property
 * would be charged is `billingPreview()`; what is still open on a bill is `open_amount` on the bill.
 * Both come from the database, and the same functions decide the run and the refusal.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'
import type { AgeingBucket } from '../models/ledgerTypes'
import type {
  BillingPeriodQuery, BillingPreview, BillingRefusal, BillingRun, BillingRunBody, DocumentTotal,
  Paged, PropertyCategory, RatesAccount, RatesArrears, RatesBill, RatesProperty, RatesReadiness,
  RatesReceipt, RatesStatement, RatesTariff, ReceiptBody, RefusalCount, RefusalReason, TariffBody,
  Valuation, ValuationBody, VoucherStatus,
} from '../models/ratesTypes'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

interface Page { limit?: number; offset?: number }

export const ratesApi = {
  // ── Readiness ───────────────────────────────────────────────────────────────────────────────

  /** What billing is waiting on, counted, with the Council decision each gap names. */
  async readiness(financialYearId?: string | null): Promise<RatesReadiness> {
    return unwrap(await api.get('/finance/rates/readiness', {
      params: financialYearId ? { financial_year_id: financialYearId } : undefined,
    }))
  },

  // ── Categories, the roll and the properties ─────────────────────────────────────────────────

  async categories(): Promise<{ categories: PropertyCategory[]; note: string | null }> {
    return unwrap(await api.get('/finance/rates/categories'))
  },

  async createCategory(body: { code: string; name: string; description?: string }): Promise<PropertyCategory> {
    return unwrap(await api.post('/finance/rates/categories', body))
  },

  async updateCategory(id: string, body: {
    name?: string; description?: string | null; status?: 'active' | 'inactive'
  }): Promise<PropertyCategory> {
    return unwrap(await api.patch(`/finance/rates/categories/${id}`, body))
  },

  /** Every current property, valued or not. An unvalued property is listed, not dropped. */
  async properties(params?: Page & {
    q?: string; ward_code?: string; has_rateable_value?: boolean; has_rates_account?: boolean
  }): Promise<Paged & { properties: RatesProperty[] }> {
    return unwrap(await api.get('/finance/rates/properties', { params }))
  },

  async valuations(params?: Page & {
    parcel_id?: string; status?: 'draft' | 'active' | 'superseded'
  }): Promise<Paged & { valuations: Valuation[] }> {
    return unwrap(await api.get('/finance/rates/valuations', { params }))
  },

  async createValuation(body: ValuationBody): Promise<Valuation> {
    return unwrap(await api.post('/finance/rates/valuations', body))
  },

  /** An active valuation accepts only an end date, a note or being superseded. */
  async updateValuation(id: string, body: Partial<Omit<ValuationBody, 'parcel_id' | 'status'>> & {
    effective_to?: string | null; status?: 'draft' | 'active' | 'superseded'
  }): Promise<Valuation> {
    return unwrap(await api.patch(`/finance/rates/valuations/${id}`, body))
  },

  async discardValuation(id: string): Promise<{ discarded: string }> {
    return unwrap(await api.delete(`/finance/rates/valuations/${id}`))
  },

  // ── The tariff schedule ─────────────────────────────────────────────────────────────────────

  async tariffs(params?: {
    financial_year_id?: string; status?: 'draft' | 'approved' | 'superseded'
  }): Promise<{ tariffs: RatesTariff[]; note: string | null }> {
    return unwrap(await api.get('/finance/rates/tariffs', { params }))
  },

  /** Always saved as a draft. A draft tariff bills nothing. */
  async draftTariff(body: TariffBody): Promise<{ id: string; status: 'draft'; rate_in_dollar: string; note: string }> {
    return unwrap(await api.post('/finance/rates/tariffs', body))
  },

  async updateTariff(id: string, body: Partial<Omit<TariffBody, 'financial_year_id' | 'property_category_id' | 'currency'>>): Promise<{ id: string; status: string; rate_in_dollar: string }> {
    return unwrap(await api.patch(`/finance/rates/tariffs/${id}`, body))
  },

  async discardTariff(id: string): Promise<{ discarded: string }> {
    return unwrap(await api.delete(`/finance/rates/tariffs/${id}`))
  },

  /** Records the Council resolution. Refused for whoever drafted the tariff. */
  async approveTariff(id: string, body: { resolution_reference: string; resolution_date?: string }): Promise<{ id: string; status: 'approved'; note: string }> {
    return unwrap(await api.post(`/finance/rates/tariffs/${id}/approve`, body))
  },

  async supersedeTariff(id: string, reason: string): Promise<{ id: string; status: 'superseded'; note: string }> {
    return unwrap(await api.post(`/finance/rates/tariffs/${id}/supersede`, { reason }))
  },

  // ── Rates accounts ──────────────────────────────────────────────────────────────────────────

  async accounts(params?: Page & {
    q?: string; status?: 'active' | 'closed'; party_id?: string
  }): Promise<Paged & { accounts: RatesAccount[]; note: string | null }> {
    return unwrap(await api.get('/finance/rates/accounts', { params }))
  },

  /** One ratepayer's statement: bills, receipts and the balance per currency. */
  async statement(id: string): Promise<RatesStatement> {
    return unwrap(await api.get(`/finance/rates/accounts/${id}`))
  },

  async openAccount(body: {
    account_no: string; parcel_id: string; party_id: string
    erp_account_no?: string; opened_on?: string; notes?: string
  }): Promise<Pick<RatesAccount, 'id' | 'account_no' | 'parcel_id' | 'party_id' | 'status' | 'opened_on'>> {
    return unwrap(await api.post('/finance/rates/accounts', body))
  },

  async updateAccount(id: string, body: {
    erp_account_no?: string | null; notes?: string | null; status?: 'closed'; closed_on?: string
  }): Promise<Pick<RatesAccount, 'id' | 'account_no' | 'status' | 'opened_on' | 'closed_on'>> {
    return unwrap(await api.patch(`/finance/rates/accounts/${id}`, body))
  },

  // ── Billing ─────────────────────────────────────────────────────────────────────────────────

  /** What a run for this period would do, decided by the same function the run reads. */
  async billingPreview(params: BillingPeriodQuery & Page & {
    billable?: boolean; reason_code?: RefusalReason
  }): Promise<BillingPreview> {
    return unwrap(await api.get('/finance/rates/billing/preview', { params }))
  },

  async runs(params?: Page & {
    financial_year_id?: string; status?: 'raised' | 'committed' | 'cancelled'
  }): Promise<Paged & { runs: BillingRun[] }> {
    return unwrap(await api.get('/finance/rates/billing/runs', { params }))
  },

  async run(id: string): Promise<{ run: BillingRun; refusals: RefusalCount[] }> {
    return unwrap(await api.get(`/finance/rates/billing/runs/${id}`))
  },

  async runRefusals(id: string, params?: Page & { reason_code?: RefusalReason }): Promise<Paged & { refusals: BillingRefusal[] }> {
    return unwrap(await api.get(`/finance/rates/billing/runs/${id}/refusals`, { params }))
  },

  /** Raises draft bills and refusals. Posts nothing. */
  async raiseRun(body: BillingRunBody): Promise<{ run: BillingRun; note: string }> {
    return unwrap(await api.post('/finance/rates/billing/runs', body))
  },

  /** Posts every bill of the run. Refused for whoever raised it. Cannot be undone, only reversed. */
  async commitRun(id: string): Promise<{ run: BillingRun; bills_posted: number; note: string }> {
    return unwrap(await api.post(`/finance/rates/billing/runs/${id}/commit`))
  },

  async cancelRun(id: string, reason: string): Promise<{ run: BillingRun; drafts_cancelled: number; note: string }> {
    return unwrap(await api.post(`/finance/rates/billing/runs/${id}/cancel`, { reason }))
  },

  // ── Bills and receipts ──────────────────────────────────────────────────────────────────────

  async bills(params?: Page & {
    rates_account_id?: string; billing_run_id?: string; financial_year_id?: string
    currency?: Currency; status?: VoucherStatus; q?: string
  }): Promise<Paged & { bills: RatesBill[]; totals: DocumentTotal[] }> {
    return unwrap(await api.get('/finance/rates/bills', { params }))
  },

  async receipts(params?: Page & {
    rates_account_id?: string; financial_year_id?: string
    currency?: Currency; status?: VoucherStatus; q?: string
  }): Promise<Paged & { receipts: RatesReceipt[]; totals: DocumentTotal[] }> {
    return unwrap(await api.get('/finance/rates/receipts', { params }))
  },

  /** Records a payment as a draft. It reaches the book of account when somebody else posts it. */
  async recordReceipt(body: ReceiptBody): Promise<{
    receipt: Pick<RatesReceipt, 'id' | 'receipt_no' | 'amount' | 'currency' | 'received_on'
      | 'voucher_id' | 'voucher_status' | 'unallocated_amount'>
    note: string
  }> {
    return unwrap(await api.post('/finance/rates/receipts', body))
  },

  async postReceipt(id: string): Promise<{ posted: string; entries: number; note: string }> {
    return unwrap(await api.post(`/finance/rates/receipts/${id}/post`))
  },

  /** A draft receipt is cancelled and kept, never deleted. A posted one is reversed in the ledger. */
  async cancelReceipt(id: string, reason: string): Promise<{ cancelled: string; note: string }> {
    return unwrap(await api.post(`/finance/rates/receipts/${id}/cancel`, { reason }))
  },

  // ── Arrears ─────────────────────────────────────────────────────────────────────────────────

  /** Per currency: the ageing, who owes, and the reconciliation to the receivable control. */
  async arrears(params?: Page & {
    currency?: Currency; ward_code?: string; bucket?: AgeingBucket; q?: string
  }): Promise<RatesArrears> {
    return unwrap(await api.get('/finance/rates/arrears', { params }))
  },
}
