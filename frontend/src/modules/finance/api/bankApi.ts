/**
 * Bank reconciliation (backend `src/routes/finance-bank.js`, migration 212). Amounts are decimal
 * strings from Postgres, signed from the Council's side: money into the account is positive.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export interface BankPosition {
  id: string; code: string; name: string; currency: Currency; cashbook_balance: string; last_entry: string | null
  unmatched_entries: number; reconciled_to: string | null; reconciled_balance: string | null; open_statements: number
}
export interface BankOverview {
  positions: BankPosition[]
  bank_accounts: { id: string; code: string; name: string }[]
  fields: { key: string; label: string }[]
}
export interface BankSummary {
  lines_total: number; lines_unmatched: number; statement_movement: string; file_difference: string; file_adds_up: boolean
  cashbook_balance: string; deposits_in_transit: string; unpresented_payments: string; adjusted_cashbook: string
  difference: string; agrees: boolean
}
export interface BankStatement {
  id: string; bank_account_id: string; account_code: string; account_name: string; currency: Currency
  statement_ref: string | null; from_date: string; to_date: string; opening_balance: string; closing_balance: string
  original_filename: string | null; status: 'open' | 'reconciled' | 'cancelled'; imported_at: string
  imported_by_name: string | null; reconciled_at: string | null; reconciled_by_name: string | null
  cancel_reason: string | null; lines_total?: number; lines_unmatched?: number
}
export interface BankLine { id: string; line_no: number; txn_date: string; description: string | null; reference: string | null; amount: string; match_id: string | null }
export interface CashbookEntry {
  id: string; voucher_id: string; voucher_no: string; voucher_type: string; posting_date: string; narration: string | null
  reference: string | null; amount: string; party_name: string | null; after_statement?: boolean
  match_id?: string; method?: 'auto' | 'manual'; matched_by_name?: string | null
}
export interface BankStatementDetail {
  statement: BankStatement; summary: BankSummary; lines: BankLine[]; cashbook: CashbookEntry[]; matched_entries: CashbookEntry[]
}
export interface StatementUpload {
  bank_account_id: string; currency: Currency; opening_balance: string; closing_balance: string
  statement_ref?: string; column_map?: Record<string, string>
}

export const bankApi = {
  async overview(): Promise<BankOverview> { return unwrap(await api.get('/finance/bank/accounts')) },
  async statements(): Promise<BankStatement[]> {
    return unwrap<{ statements: BankStatement[] }>(await api.get('/finance/bank/statements')).statements
  },
  async importStatement(file: File, fields: StatementUpload): Promise<{ id: string; lines: number }> {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === '') continue
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    form.append('file', file)
    return unwrap(await api.post('/finance/bank/statements', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }))
  },
  async statement(id: string): Promise<BankStatementDetail> { return unwrap(await api.get(`/finance/bank/statements/${id}`)) },
  async autoMatch(id: string): Promise<{ matched: number; note: string }> { return unwrap(await api.post(`/finance/bank/statements/${id}/auto-match`)) },
  async match(id: string, lineIds: string[], entryIds: string[]): Promise<void> {
    await api.post(`/finance/bank/statements/${id}/matches`, { line_ids: lineIds, entry_ids: entryIds })
  },
  async unmatch(matchId: string): Promise<void> { await api.delete(`/finance/bank/matches/${matchId}`) },
  async complete(id: string): Promise<{ note: string }> { return unwrap(await api.post(`/finance/bank/statements/${id}/complete`)) },
  async cancel(id: string, reason: string): Promise<void> { await api.post(`/finance/bank/statements/${id}/cancel`, { reason }) },
}
