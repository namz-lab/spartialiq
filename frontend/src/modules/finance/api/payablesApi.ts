/**
 * Creditors (backend `src/routes/finance-payables.js`, migration 213). Amounts are decimal strings
 * from Postgres. A document is a draft until somebody other than its preparer approves it.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export type DocumentStatus = 'awaiting_approval' | 'approved' | 'reversed'
export type PaymentMethod = 'bank_transfer' | 'cheque' | 'rtgs' | 'mobile_money' | 'cash' | 'other'
interface Account { id: string; code: string; name: string }

export interface PayablesSummary {
  owed: { currency: Currency; documents: number; outstanding: string; overdue: string; in_draft_payments: string }[]
  awaiting_approval: { invoices: number; payments: number }
  payable_accounts: Account[]; tax_accounts: Account[]; bank_accounts: Account[]; methods: PaymentMethod[]
}
export interface SupplierInvoice {
  id: string; invoice_no: string; supplier_ref: string; party_id: string; party_name: string; currency: Currency
  invoice_date: string; due_date: string; net_total: string; tax_total: string; total: string; narration: string | null
  status: DocumentStatus; outstanding: string; prepared_by: string; prepared_by_name: string | null
  approved_by_name: string | null; approved_at: string | null; voucher_id: string; posting_date: string
}
export interface SupplierInvoiceDetail {
  invoice: SupplierInvoice & { payable_code: string; payable_name: string }
  lines: { line_no: number; account_code: string; account_name: string; description: string | null; net_amount: string; tax_amount: string }[]
  payments: { id: string; payment_no: string; payment_date: string; amount: string; voucher_status: string }[]
}
export interface OpenItem {
  currency: Currency; party_id: string; party_name: string; party_reference: string | null; voucher_id: string; voucher_no: string
  voucher_type: string; supplier_invoice_id: string | null; document_ref: string | null; document_date: string; due_date: string | null
  raised: string; settled: string; outstanding: string; pending: string; payable: string; days_outstanding: number; days_overdue: number
  payable_code: string; bucket: 'current' | '31_60' | '61_90' | 'over_90'
}
export interface SupplierPayment {
  id: string; payment_no: string; party_id: string; party_name: string; currency: Currency; payment_date: string
  method: PaymentMethod; reference: string | null; total: string; bank_code: string; bank_name: string; status: DocumentStatus
  prepared_by: string; prepared_by_name: string | null; approved_by_name: string | null
  pays: { voucher_no: string; document_ref: string | null; amount: string }[]
}
export interface InvoiceBody {
  party_id: string; currency: Currency; financial_year_id: string; posting_date?: string; invoice_date: string; due_date: string
  supplier_ref: string; payable_account_id: string; tax_account_id?: string; narration?: string
  lines: { ledger_account_id: string; description?: string; net_amount: string; tax_amount?: string }[]
}
export interface PaymentBody {
  party_id: string; currency: Currency; financial_year_id: string; payment_date: string; bank_account_id: string
  method: PaymentMethod; reference?: string; narration?: string; allocations: { against_voucher_id: string; amount: string }[]
}

export const payablesApi = {
  async summary(): Promise<PayablesSummary> { return unwrap(await api.get('/finance/payables/summary')) },
  async invoices(params?: { status?: string; party_id?: string; q?: string }): Promise<SupplierInvoice[]> {
    return unwrap<{ invoices: SupplierInvoice[] }>(await api.get('/finance/payables/invoices', { params })).invoices
  },
  async invoice(id: string): Promise<SupplierInvoiceDetail> { return unwrap(await api.get(`/finance/payables/invoices/${id}`)) },
  async createInvoice(body: InvoiceBody): Promise<{ id: string; note: string }> { return unwrap(await api.post('/finance/payables/invoices', body)) },
  async approveInvoice(id: string): Promise<{ note: string }> { return unwrap(await api.post(`/finance/payables/invoices/${id}/approve`)) },
  async discardInvoice(id: string): Promise<void> { await api.delete(`/finance/payables/invoices/${id}`) },
  async open(params?: { party_id?: string; currency?: Currency }): Promise<OpenItem[]> {
    return unwrap<{ items: OpenItem[] }>(await api.get('/finance/payables/open', { params })).items
  },
  async payments(params?: { party_id?: string; status?: string }): Promise<SupplierPayment[]> {
    return unwrap<{ payments: SupplierPayment[] }>(await api.get('/finance/payables/payments', { params })).payments
  },
  async createPayment(body: PaymentBody): Promise<{ id: string; note: string }> { return unwrap(await api.post('/finance/payables/payments', body)) },
  async approvePayment(id: string): Promise<{ note: string }> { return unwrap(await api.post(`/finance/payables/payments/${id}/approve`)) },
  async discardPayment(id: string): Promise<void> { await api.delete(`/finance/payables/payments/${id}`) },
}
