/**
 * Cut-over from the previous accounting package (backend `src/routes/finance-migration.js`,
 * migration 211). Every amount is a decimal string computed by Postgres. The gates (the trial
 * balance balances, open items equal their control account, no unexplained difference at sign-off)
 * are the database's; this client only carries the requests.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'
import type { LedgerAccountType, LedgerRootType } from '../models/ledgerTypes'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export type LoadKind = 'chart' | 'parties' | 'opening_balance' | 'open_items' | 'comparison_balance'
export type BatchStatus = 'uploaded' | 'validated' | 'committed' | 'cancelled' | 'withdrawn'
export type RowStatus = 'ready' | 'problem' | 'set_aside'

export interface MigrationField { key: string; label: string }

export interface MigrationProfiles {
  source_systems: { key: string; label: string }[]
  loads: { key: LoadKind; label: string; fields: MigrationField[]; required: string[][] }[]
  root_types: LedgerRootType[]
  account_types: LedgerAccountType[]
}

export interface Cutover {
  id: string; name: string; source_system: string; source_version: string | null; cutover_date: string
  financial_year_id: string; financial_year_label: string; status: 'preparing' | 'signed_off' | 'abandoned'
  signed_off_at: string | null; signed_off_by_name: string | null; sign_off_note: string | null
  abandoned_at: string | null; abandon_reason: string | null
  created_by: string; created_by_name: string | null; created_at: string
}

export interface CategoryClass { root_type: LedgerRootType | null; account_type: LedgerAccountType | null; suggested?: boolean }

export interface MigrationBatch {
  id: string; cutover_id: string; load_kind: LoadKind; currency: Currency | null
  item_side: 'debtors' | 'creditors' | null; control_account_id: string | null; as_at: string | null
  original_filename: string; file_size_bytes: number; headers: string[]
  column_map: Record<string, string>
  options: { category_map?: Record<string, CategoryClass>; party_kind?: 'customer' | 'supplier'; has_header?: boolean }
  status: BatchStatus; rows_total: number; rows_ready: number; rows_problem: number; rows_set_aside: number
  total_debit: string | null; total_credit: string | null; declared_total: string | null
  uploaded_by: string; uploaded_by_name: string | null; uploaded_at: string
  committed_by: string | null; committed_by_name: string | null; committed_at: string | null
  withdraw_reason: string | null; result: Record<string, string | number> | null
  vouchers_draft: number; vouchers_posted: number; reconciliation_id: string | null
  fields: MigrationField[]; required: string[][]
}

export interface MigrationRow {
  id: string; row_no: number; raw: (string | number | null)[]
  parsed: Record<string, unknown> & { code?: string; name?: string; party_code?: string; maps_to?: string; note?: string; category?: string }
  status: RowStatus
  problems: { field: string; message: string; candidates?: { id: string; name: string; reference: string | null }[] }[]
  decision: Record<string, string>
}

export interface RowDecision {
  action: 'create' | 'map' | 'set_aside' | 'clear'
  root_type?: LedgerRootType; account_type?: LedgerAccountType | ''; new_code?: string; reference?: string
  ledger_account_id?: string; party_id?: string; note?: string
}

export interface ReadinessCheck { check_key: string; passed: boolean; blocking: boolean; detail: string }

export interface ReconciliationSummary {
  id: string; batch_id: string; kind: 'opening' | 'parallel_run'; currency: Currency; as_at: string
  refreshed_at: string; lines: number; differences: number; unexplained: number
}

export interface CutoverDetail {
  cutover: Cutover; batches: MigrationBatch[]; readiness: ReadinessCheck[]
  reconciliations: ReconciliationSummary[]
  opening_period: { period_no: number; label: string | null; status: 'open' | 'closed' | 'locked' } | null
}

export interface ReconciliationLine {
  id: string; ledger_account_id: string | null; account_code: string | null; account_name: string | null
  source_codes: string | null; source_net_debit: string; ledger_net_debit: string; difference: string
  differs: boolean; explanation: string | null; explained_by_name: string | null; explained_at: string | null
}

export interface ReconciliationDetail {
  reconciliation: { id: string; cutover_id: string; kind: 'opening' | 'parallel_run'; currency: Currency; as_at: string; refreshed_at: string; original_filename: string }
  lines: ReconciliationLine[]
  totals: { lines: number; differences: number; unexplained: number; source_net: string; ledger_net: string }
}

export interface UploadFields {
  load_kind: LoadKind; has_header: boolean; currency?: Currency; item_side?: 'debtors' | 'creditors'
  control_account_id?: string; as_at?: string; declared_total?: string; party_kind?: 'customer' | 'supplier'
  party_type?: 'debtor' | 'ratepayer'
}

export const migrationApi = {
  async profiles(): Promise<MigrationProfiles> {
    return unwrap(await api.get('/finance/migration/profiles'))
  },
  async cutovers(): Promise<Cutover[]> {
    return unwrap<{ cutovers: Cutover[] }>(await api.get('/finance/migration/cutovers')).cutovers
  },
  async createCutover(body: { name: string; source_system: string; source_version?: string; cutover_date: string; financial_year_id: string }): Promise<{ id: string }> {
    return unwrap(await api.post('/finance/migration/cutovers', body))
  },
  async cutover(id: string): Promise<CutoverDetail> {
    return unwrap(await api.get(`/finance/migration/cutovers/${id}`))
  },
  async signOff(id: string, note: string): Promise<{ note: string }> {
    return unwrap(await api.post(`/finance/migration/cutovers/${id}/sign-off`, note.trim() ? { note: note.trim() } : {}))
  },
  async abandon(id: string, reason: string): Promise<void> {
    await api.post(`/finance/migration/cutovers/${id}/abandon`, { reason })
  },
  async upload(cutoverId: string, file: File, fields: UploadFields): Promise<MigrationBatch> {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== '') form.append(key, String(value))
    }
    // The file goes last: the server reads the fields before it.
    form.append('file', file)
    return unwrap<{ batch: MigrationBatch }>(await api.post(`/finance/migration/cutovers/${cutoverId}/batches`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
    })).batch
  },
  async batch(id: string): Promise<{ batch: MigrationBatch; sample: { row_no: number; raw: (string | number | null)[] }[]; missing_columns: string[] }> {
    return unwrap(await api.get(`/finance/migration/batches/${id}`))
  },
  async saveMapping(id: string, body: { column_map?: Record<string, string>; category_map?: Record<string, { root_type: string; account_type: string }>; declared_total?: string }): Promise<{ batch: MigrationBatch; missing_columns: string[] }> {
    return unwrap(await api.patch(`/finance/migration/batches/${id}`, body))
  },
  async validate(id: string): Promise<MigrationBatch> {
    return unwrap<{ batch: MigrationBatch }>(await api.post(`/finance/migration/batches/${id}/validate`, undefined, { timeout: 120000 })).batch
  },
  async rows(id: string, params: { status?: RowStatus; limit?: number; offset?: number }): Promise<{ rows: MigrationRow[]; total: number }> {
    return unwrap(await api.get(`/finance/migration/batches/${id}/rows`, { params }))
  },
  async decide(id: string, rowIds: string[], decision: RowDecision): Promise<MigrationBatch> {
    return unwrap<{ batch: MigrationBatch }>(await api.post(`/finance/migration/batches/${id}/decisions`, { row_ids: rowIds, decision }, { timeout: 120000 })).batch
  },
  async commit(id: string): Promise<{ batch: MigrationBatch; note: string }> {
    return unwrap(await api.post(`/finance/migration/batches/${id}/commit`, undefined, { timeout: 300000 }))
  },
  async post(id: string): Promise<{ batch: MigrationBatch; posted: number; note: string }> {
    return unwrap(await api.post(`/finance/migration/batches/${id}/post`, undefined, { timeout: 300000 }))
  },
  async cancel(id: string): Promise<void> {
    await api.post(`/finance/migration/batches/${id}/cancel`)
  },
  async withdraw(id: string, reason: string): Promise<void> {
    await api.post(`/finance/migration/batches/${id}/withdraw`, { reason })
  },
  async reconcile(batchId: string): Promise<{ reconciliation_id: string }> {
    return unwrap(await api.post(`/finance/migration/batches/${batchId}/reconcile`))
  },
  async reconciliation(id: string, onlyDifferences: boolean): Promise<ReconciliationDetail> {
    return unwrap(await api.get(`/finance/migration/reconciliations/${id}`, { params: onlyDifferences ? { only: 'differences' } : {} }))
  },
  async refreshReconciliation(id: string): Promise<void> {
    await api.post(`/finance/migration/reconciliations/${id}/refresh`)
  },
  async explain(lineId: string, explanation: string): Promise<void> {
    await api.patch(`/finance/migration/reconciliation-lines/${lineId}`, { explanation })
  },
  /** The blank file for one load, as the browser's download. */
  async template(kind: LoadKind): Promise<Blob> {
    return (await api.get(`/finance/migration/templates/${kind}`, { responseType: 'blob' })).data as Blob
  },
}
