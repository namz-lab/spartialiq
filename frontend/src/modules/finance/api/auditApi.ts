/**
 * The finance audit trail as the internal auditor reads it.
 *
 *   GET /finance/audit          finance.audit.view    one page of the trail, filtered on the server
 *   GET /finance/audit/export   finance.audit.export  the trail for a date range, as CSV, XLSX or PDF
 *
 * `financeApi.audit()` predates the auditor's workspace and types the row without `actor_id` and
 * `details`, which the server has always sent. The auditor filters by person, so this module types
 * the row as the server sends it. Nothing here writes: the trail has no write endpoint.
 */
import api from '../../../services/api'
import type { AuditEvent } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export interface TrailEvent extends AuditEvent {
  actor_id: string | null
  details: Record<string, unknown> | null
}

export interface TrailQuery {
  actor_id?: string
  event?: string
  entity_type?: string
  entity_id?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  /** 400 reads refused attempts only. */
  status_min?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface TrailPage { events: TrailEvent[]; limit: number; offset: number; note: string }

/** The server's own event codes (backend middleware/auditLog.js), named for a reader. */
export const TRAIL_MODULES: { id: string; label: string }[] = [
  { id: 'FIN_LEDGER_POST', label: 'Ledger postings and year-end' },
  { id: 'FIN_LEDGER', label: 'Ledger and periods' },
  { id: 'FIN_PAYMENT_VOUCHER', label: 'Supplier payments' },
  { id: 'FIN_SUPPLIER_INVOICE', label: 'Supplier invoices' },
  { id: 'FIN_CASH_SESSION', label: 'Cash-ups and sessions' },
  { id: 'FIN_CASH_RECEIPT', label: 'Cash receipts' },
  { id: 'FIN_CASH_DEPOSIT', label: 'Bank deposits' },
  { id: 'FIN_CASH_ASSIGNMENT', label: 'Cash point assignments' },
  { id: 'FIN_CASH', label: 'Cash office' },
  { id: 'FIN_BANK_RECONCILIATION', label: 'Bank reconciliation' },
  { id: 'FIN_BUDGET', label: 'Budget lines' },
  { id: 'FIN_REVISION', label: 'Budget revisions' },
  { id: 'FIN_PROJECT', label: 'Projects' },
  { id: 'FIN_RATES_BILLING', label: 'Rates billing runs' },
  { id: 'FIN_RATES_TARIFF', label: 'Rates tariffs' },
  { id: 'FIN_RATES_RECEIPT', label: 'Rates receipts' },
  { id: 'FIN_RATES', label: 'Rates' },
  { id: 'FIN_ASSET', label: 'Fixed assets' },
  { id: 'FIN_DEPRECIATION', label: 'Depreciation runs' },
  { id: 'FIN_IMPORT', label: 'Imports' },
  { id: 'FIN_MIGRATION', label: 'Data migration' },
  { id: 'FIN_CUTOVER', label: 'Cut-over' },
  { id: 'FIN_TRANSACTION', label: 'Transactions' },
  { id: 'FIN_PUBLICATION', label: 'Publication' },
  { id: 'FIN_DOCUMENT', label: 'Documents' },
  { id: 'FIN_CONFIG', label: 'Configuration' },
  { id: 'FIN_PERMISSION', label: 'Permissions and finance access' },
  { id: 'FIN_INTERNAL_AUDIT', label: 'Internal audit records' },
  { id: 'FINANCE', label: 'Other finance requests' },
]

/** The request method in words. The trail stores the method; a reader wants the act. */
export const TRAIL_ACTIONS: Record<string, string> = { POST: 'Created or acted', PATCH: 'Changed', PUT: 'Set', DELETE: 'Removed', GET: 'Read' }

export const auditApi = {
  async trail(params: TrailQuery): Promise<TrailPage> {
    return unwrap(await api.get('/finance/audit', { params }))
  },
  /** The export honours the date range only (the server's contract); the screen says so. */
  async exportTrail(params: { from?: string; to?: string; format: 'csv' | 'xlsx' | 'pdf' }): Promise<{ blob: Blob; filename: string }> {
    const r = await api.get('/finance/audit/export', { params, responseType: 'blob', timeout: 300000 })
    const match = /filename="([^"]+)"/.exec(String(r.headers['content-disposition'] || ''))
    return { blob: r.data as Blob, filename: match ? match[1] : `audit-history.${params.format}` }
  },
}

/** Hand a server file to the browser. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
