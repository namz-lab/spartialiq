/**
 * The fixed-asset register (backend `src/routes/finance-assets.js`, migration 214). Amounts are
 * decimal strings from Postgres. Registering posts nothing; a depreciation run and a disposal are
 * drafts until somebody other than whoever raised them approves.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? r.data) as T

export type AssetStatus = 'in_use' | 'fully_depreciated' | 'not_depreciated' | 'disposed' | 'disposal_awaiting_approval'
export interface AssetCategory {
  id: string; code: string; name: string; method: 'straight_line' | 'none'; useful_life_months: number | null; residual_pct: string
  status: 'active' | 'inactive'; asset_account_id: string; asset_account_code: string; asset_account_name: string
  accumulated_account_id: string | null; accumulated_account_code: string | null
  expense_account_id: string | null; expense_account_code: string | null
}
export interface CategoryComparison {
  category_id: string; currency: Currency; assets: number; register_cost: string; ledger_cost: string; cost_difference: string
  register_accumulated: string; ledger_accumulated: string; accumulated_difference: string; agrees: boolean
}
export interface AssetAccount { id: string; code: string; name: string; root_type: string; account_type: string | null }
export interface FixedAsset {
  id: string; asset_no: string; name: string; description: string | null; category_id: string; category_name: string
  method: 'straight_line' | 'none'; currency: Currency; cost: string; residual_value: string; accumulated_opening: string
  useful_life_months: number | null; acquired_on: string; depreciation_start: string; disposed_on: string | null
  serial_no: string | null; location: string | null; custodian: string | null; charged: string; charged_in_draft: string
  accumulated: string; carrying_amount: string; status: AssetStatus; disposal_proceeds: string | null; disposal_note: string | null
  disposal_voucher_no: string | null; disposal_prepared_by: string | null
}
export interface DepreciationRun {
  id: string; run_no: string; currency: Currency; period_no: number; period_label: string | null; period_from: string; period_to: string
  total: string; assets: number; status: 'awaiting_approval' | 'approved' | 'reversed'; prepared_by: string
  prepared_by_name: string | null; approved_by_name: string | null
}
export interface CategoryBody {
  code?: string; name?: string; asset_account_id?: string; accumulated_account_id?: string; expense_account_id?: string
  method?: 'straight_line' | 'none'; useful_life_months?: number; residual_pct?: number
}
export interface AssetBody {
  name: string; category_id: string; currency: Currency; cost: string; residual_value?: string; accumulated_opening?: string
  acquired_on: string; depreciation_start?: string; useful_life_months?: number; serial_no?: string; location?: string; custodian?: string
}

export const assetsApi = {
  async categories(): Promise<{ categories: AssetCategory[]; comparison: CategoryComparison[]; accounts: AssetAccount[] }> {
    return unwrap(await api.get('/finance/assets/categories'))
  },
  async createCategory(body: CategoryBody): Promise<void> { await api.post('/finance/assets/categories', body) },
  /** Changes a category; the code stays as registered. A field left out keeps its value. */
  async updateCategory(id: string, body: Omit<CategoryBody, 'code'> & { status?: 'active' | 'inactive' }): Promise<void> {
    await api.patch(`/finance/assets/categories/${id}`, body)
  },
  async assets(params?: { q?: string; category_id?: string; status?: AssetStatus }): Promise<{
    assets: FixedAsset[]; totals: { currency: Currency; assets: number; cost: string; accumulated: string; carrying_amount: string }[]
  }> { return unwrap(await api.get('/finance/assets', { params })) },
  async register(body: AssetBody): Promise<{ asset_no: string; note: string }> { return unwrap(await api.post('/finance/assets', body)) },
  async update(id: string, body: Partial<AssetBody>): Promise<void> { await api.patch(`/finance/assets/${id}`, body) },
  async runs(financialYearId?: string | null): Promise<DepreciationRun[]> {
    return unwrap<{ runs: DepreciationRun[] }>(await api.get('/finance/assets/runs', { params: financialYearId ? { financial_year_id: financialYearId } : {} })).runs
  },
  async runCharges(id: string): Promise<{ asset_no: string; name: string; category_name: string; amount: string }[]> {
    return unwrap<{ charges: { asset_no: string; name: string; category_name: string; amount: string }[] }>(await api.get(`/finance/assets/runs/${id}`)).charges
  },
  async run(ledgerPeriodId: string, currency: Currency): Promise<{ note: string }> {
    return unwrap(await api.post('/finance/assets/runs', { ledger_period_id: ledgerPeriodId, currency }))
  },
  async approveRun(id: string): Promise<{ note: string }> { return unwrap(await api.post(`/finance/assets/runs/${id}/approve`)) },
  async discardRun(id: string): Promise<void> { await api.delete(`/finance/assets/runs/${id}`) },
  async dispose(id: string, body: { disposed_on: string; proceeds?: string; proceeds_account_id?: string; gain_loss_account_id?: string; note: string }): Promise<{ note: string }> {
    return unwrap(await api.post(`/finance/assets/${id}/dispose`, body))
  },
  async approveDisposal(id: string): Promise<{ note: string }> { return unwrap(await api.post(`/finance/assets/${id}/disposal/approve`)) },
  async withdrawDisposal(id: string): Promise<void> { await api.delete(`/finance/assets/${id}/disposal`) },
}
