/**
 * The cash office API client. Mirrors the backend's `src/routes/finance-cash.js` one for one.
 *
 * Every call returns the envelope's `data`, or throws the axios error for the caller to render
 * with `messageOf()`. The backend's refusals are written to be read — "the USD count differs from
 * the receipts by -2.00, and a difference is explained in writing" — so they are shown as they
 * arrive.
 *
 * WHAT THIS CLIENT DOES NOT DO
 * It sends no receipt number (the database issues it), no business date (a till opens on today),
 * and no expected takings (the count is declared first and compared after).
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'
import type {
  BankDeposit, CashAssignment, CashDesk, CashDrawer, CashMethod, CashReceipt, CashierDashboard, CashierSession,
  CashierSessionDetail, HousingAllocationHit, HousingReceiptBody, PaymentChannel, PlanningApplicationHit, PlanningFeeKind, PlanningReceiptBody, PrintableReceipt,
  QueueTicket, RatesCounterReceiptBody, SessionEvent, SessionStatus, SetupAccounts, StaffOption, SundryReceiptBody,
} from '../models/cashTypes'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

interface Page { limit?: number; offset?: number }

export const cashApi = {
  /** Everything the cash office screen needs to draw itself for this person. */
  async desk(): Promise<CashDesk> {
    return unwrap(await api.get('/finance/cash/desk'))
  },

  // ── Setup ───────────────────────────────────────────────────────────────────────────────────

  async setupAccounts(): Promise<SetupAccounts> {
    return unwrap(await api.get('/finance/cash/setup/accounts'))
  },

  async createCashPoint(body: {
    code: string; name: string; location?: string; till_account_id: string; difference_account_id?: string | null
  }): Promise<{ cash_point: { id: string; code: string; name: string } }> {
    return unwrap(await api.post('/finance/cash/points', body))
  },

  async updateCashPoint(id: string, body: {
    name?: string; location?: string; till_account_id?: string
    difference_account_id?: string | null; status?: 'active' | 'inactive'
  }): Promise<unknown> {
    return unwrap(await api.patch(`/finance/cash/points/${id}`, body))
  },

  async createIncomeCode(body: {
    code: string; name: string; ledger_account_id: string; department_id?: string | null
    pricing: 'fixed' | 'variable'; unit_amount_usd?: string | null; unit_amount_zwg?: string | null
    planning_fee_kind?: PlanningFeeKind | null
  }): Promise<unknown> {
    return unwrap(await api.post('/finance/cash/income-codes', body))
  },

  async updateIncomeCode(id: string, body: {
    name?: string; pricing?: 'fixed' | 'variable'; unit_amount_usd?: string | null
    unit_amount_zwg?: string | null; status?: 'active' | 'inactive'; planning_fee_kind?: PlanningFeeKind | null
  }): Promise<unknown> {
    return unwrap(await api.patch(`/finance/cash/income-codes/${id}`, body))
  },

  /** Where each online provider settles (migration 246). Seeded empty: decision D22. */
  async paymentChannels(): Promise<{ channels: PaymentChannel[]; bank_accounts: { id: string; code: string; name: string }[]; drivers: string[] }> {
    return unwrap(await api.get('/finance/cash/payment-channels'))
  },

  async createPaymentChannel(body: { driver: string; name: string; bank_account_id: string; notes?: string }): Promise<unknown> {
    return unwrap(await api.post('/finance/cash/payment-channels', body))
  },

  async updatePaymentChannel(id: string, body: { name?: string; bank_account_id?: string; status?: 'active' | 'inactive'; notes?: string }): Promise<unknown> {
    return unwrap(await api.patch(`/finance/cash/payment-channels/${id}`, body))
  },

  // ── Sessions ────────────────────────────────────────────────────────────────────────────────

  async sessions(params?: Page & { status?: SessionStatus; cash_point_id?: string; mine?: boolean }):
  Promise<{ sessions: CashierSession[]; total: number }> {
    return unwrap(await api.get('/finance/cash/sessions', { params }))
  },

  async session(id: string): Promise<{ session: CashierSessionDetail }> {
    return unwrap(await api.get(`/finance/cash/sessions/${id}`))
  },

  async openSession(body: {
    cash_point_id: string; financial_year_id?: string; floats?: { currency: Currency; amount: string }[]
  }): Promise<{ session: CashierSessionDetail }> {
    return unwrap(await api.post('/finance/cash/sessions', body))
  },

  /** Cash up. The variance comes back in the session's counts; it is not known before. */
  async closeSession(id: string, counts: { currency: Currency; declared_total: string; explanation?: string }[]):
  Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/close`, { counts }))
  },

  async returnSession(id: string, reason: string): Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/return`, { reason }))
  },

  async verifySession(id: string, note?: string):
  Promise<{ session: CashierSessionDetail; vouchers_posted: number; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/verify`, note ? { note } : {}))
  },

  // ── Receipts ────────────────────────────────────────────────────────────────────────────────

  async receipts(params?: Page & { session_id?: string; q?: string; mine?: boolean; date?: string; method?: CashMethod }):
  Promise<{ receipts: CashReceipt[]; total: number }> {
    return unwrap(await api.get('/finance/cash/receipts', { params }))
  },

  async receipt(id: string): Promise<{ receipt: PrintableReceipt }> {
    return unwrap(await api.get(`/finance/cash/receipts/${id}`))
  },

  async issueReceipt(body: SundryReceiptBody): Promise<{ receipt: CashReceipt }> {
    return unwrap(await api.post('/finance/cash/receipts', body))
  },

  /** A planning fee: the application is named, and an application fee marks it paid (migration 246). */
  async issuePlanningReceipt(body: PlanningReceiptBody): Promise<{ receipt: CashReceipt; application: PlanningApplicationHit | null }> {
    return unwrap(await api.post('/finance/cash/receipts/planning', body))
  },

  async planningApplications(q: string): Promise<{ applications: PlanningApplicationHit[] }> {
    return unwrap(await api.get('/finance/cash/planning-applications', { params: { q } }))
  },

  async issueHousingReceipt(body: HousingReceiptBody): Promise<{ receipt: CashReceipt; allocation: HousingAllocationHit | null }> {
    return unwrap(await api.post('/finance/cash/receipts/housing', body))
  },

  async housingAllocations(q: string): Promise<{ allocations: HousingAllocationHit[] }> {
    return unwrap(await api.get('/finance/cash/housing-allocations', { params: { q } }))
  },

  async issueRatesReceipt(body: RatesCounterReceiptBody): Promise<{ receipt: CashReceipt }> {
    return unwrap(await api.post('/finance/cash/receipts/rates', body))
  },

  async cancelReceipt(id: string, reason: string): Promise<{ cancelled: string; note: string }> {
    return unwrap(await api.post(`/finance/cash/receipts/${id}/cancel`, { reason }))
  },

  // ── The session lifecycle (migration 208) ───────────────────────────────────────────────────

  async suspendSession(id: string): Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/suspend`))
  },

  async resumeSession(id: string): Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/resume`))
  },

  /** A supervisor's finding. Freezes the session; the drawer stays held until it is counted. */
  async abandonSession(id: string, reason: string): Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/abandon`, { reason }))
  },

  async supervisedClose(id: string, witnessId: string,
    counts: { currency: Currency; declared_total: string; explanation?: string }[]):
    Promise<{ session: CashierSessionDetail; note: string }> {
    return unwrap(await api.post(`/finance/cash/sessions/${id}/supervised-close`, { witness_id: witnessId, counts }))
  },

  async sessionEvents(id: string): Promise<{ session_no: string; events: SessionEvent[] }> {
    return unwrap(await api.get(`/finance/cash/sessions/${id}/events`))
  },

  async drawers(): Promise<{ drawers: CashDrawer[]; awaiting_verification: number }> {
    return unwrap(await api.get('/finance/cash/drawers'))
  },

  async witnesses(): Promise<{ witnesses: StaffOption[] }> {
    return unwrap(await api.get('/finance/cash/witnesses'))
  },

  async assignments(params?: { cash_point_id?: string; include_ended?: boolean }):
    Promise<{ assignments: CashAssignment[]; operators: StaffOption[] }> {
    return unwrap(await api.get('/finance/cash/assignments', { params }))
  },

  async assign(body: { cash_point_id: string; user_id: string; valid_from?: string; valid_to?: string; note?: string }):
    Promise<{ id: string }> {
    return unwrap(await api.post('/finance/cash/assignments', body))
  },

  async endAssignment(id: string, reason: string): Promise<{ id: string; note: string }> {
    return unwrap(await api.post(`/finance/cash/assignments/${id}/end`, { reason }))
  },

  // ── The cashier's dashboard and service queue (migration 209) ───────────────────────────────

  /** The caller's own day. Money is withheld while their drawer is uncounted (control C7). */
  async dashboard(): Promise<CashierDashboard> {
    return unwrap(await api.get('/finance/cash/dashboard'))
  },

  async queue(): Promise<{ tickets: QueueTicket[]; waiting: number }> {
    return unwrap(await api.get('/finance/cash/queue'))
  },

  async addToQueue(body: { customer_name: string; rates_account_id?: string; service?: string }):
    Promise<{ ticket: QueueTicket }> {
    return unwrap(await api.post('/finance/cash/queue', body))
  },

  async serveTicket(id: string, receiptNo?: string): Promise<{ id: string }> {
    return unwrap(await api.post(`/finance/cash/queue/${id}/serve`, receiptNo ? { receipt_no: receiptNo } : {}))
  },

  async removeTicket(id: string, reason: string): Promise<{ id: string }> {
    return unwrap(await api.post(`/finance/cash/queue/${id}/remove`, { reason }))
  },

  // ── Banking ─────────────────────────────────────────────────────────────────────────────────

  async deposits(params?: Page & { status?: 'draft' | 'posted' }): Promise<{ deposits: BankDeposit[] }> {
    return unwrap(await api.get('/finance/cash/deposits', { params }))
  },

  async prepareDeposit(body: {
    cash_point_id: string; currency: Currency; amount: string; bank_account_id: string
    slip_reference: string; deposited_on?: string; financial_year_id?: string; narration?: string
  }): Promise<{ deposit: BankDeposit; note: string }> {
    return unwrap(await api.post('/finance/cash/deposits', body))
  },

  async postDeposit(id: string): Promise<{ posted: string; note: string }> {
    return unwrap(await api.post(`/finance/cash/deposits/${id}/post`))
  },
}
