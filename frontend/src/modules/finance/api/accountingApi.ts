/**
 * The accountant's dashboard reads (backend `src/routes/finance-accounting.js`). Every amount is a
 * decimal string computed by Postgres and every money figure is one row per currency.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export type AgeGroup = 'current' | '31_60' | '61_90' | 'over_90'

export interface AccountingDashboard {
  year: { id: string; label: string; start_date: string; end_date: string; status: string; prior_year_id: string | null }
  /** Money into and out of the bank and the tills, year to date, posted entries only. */
  flows: { currency: Currency; collections: string; payments: string; collections_change_pct: string | null; payments_change_pct: string | null }[]
  banks: { id: string; code: string; name: string; currency: Currency; balance: string; last_entry: string | null }[]
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
}

export interface CreditorItem {
  currency: Currency; party_id: string | null; party_name: string | null; voucher_id: string; voucher_no: string
  posting_date: string; outstanding: string; days: number; bucket: AgeGroup
}

export const accountingApi = {
  async dashboard(financialYearId?: string | null): Promise<AccountingDashboard> {
    return unwrap(await api.get('/finance/accounting/dashboard', { params: financialYearId ? { financial_year_id: financialYearId } : {} }))
  },
  async creditorAgeing(): Promise<{ items: CreditorItem[]; payables_configured: boolean }> {
    return unwrap(await api.get('/finance/accounting/creditor-ageing'))
  },
}
