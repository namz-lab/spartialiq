/**
 * The finance API client.
 *
 * One module, mirroring the backend's eight route files, so a screen never builds a URL by hand.
 * Every call returns the envelope's `data`, or throws the axios error for the caller to render.
 *
 * WHAT THIS CLIENT DOES NOT DO
 * It does not decide what the person may do. Each endpoint re-checks the permission server-side,
 * so a request issued from a hidden menu gets the same 403 as one from a visible button. The
 * permission list from `identity()` is used to EXPLAIN why something is unavailable, not to secure
 * it — `src/modules/finance/stores/finance.ts` says more about that distinction.
 */

import api from '../../../services/api'
import type {
  Account, Activity, AuditEvent, BudgetLinePerformance, BudgetRevision, Commitment,
  Currency, Department, DepartmentPerformance, FinanceAccessDetail,
  FinanceDocument, FinanceIdentity, FinanceProject, FinanceUserList,
  FinanceTransaction, FinancialYear, ImportBatch, ImportDataset, ImportException,
  ImportReconciliation, ImportUploadResult, ImportValidationResult, Money, Programme,
  ProjectAllocation, ProjectTrace, PublicOverview, PublicYear, Publication, PublicationDataset,
  ReportDefinition, ReportResult, VarianceExplanation,
  AttentionFeed, OverviewSeriesResult, Periodicity,
  TransactionDetail, TransactionQuery, TransactionRegisterPage,
} from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

export interface BudgetLineQuery {
  financial_year_id?: string
  department_id?: string
  account_id?: string
  programme_id?: string
  status?: string
  kind?: 'revenue' | 'expenditure'
  q?: string
  /** Exact ward code filter (GIS-finance M2; free-text codes, not yet a register reference). */
  ward_code?: string
  limit?: number
  offset?: number
  sort?: 'code' | 'description' | 'original_amount' | 'execution'
  direction?: 'asc' | 'desc'
}

/**
 * Everything a report can be asked for. One type for the JSON run and the file export, because a
 * screen and the file downloaded from it are built by one backend function and must be asked the
 * same question — see `buildReport()` in the backend's finance-reports.js.
 */
export interface ReportRunParams {
  report: string
  financial_year_id?: string
  compare_financial_year_id?: string
  department_id?: string
  programme_id?: string
  account_id?: string
  ward_code?: string
  kind?: 'revenue' | 'expenditure'
  expenditure_class?: 'recurrent' | 'capital'
  currency?: Currency
  /** Only sent for a report whose catalogue entry declares `periods` (W2). */
  periodicity?: Periodicity
  /** Year-to-date column set rather than discrete periods. */
  accumulated?: boolean
  from?: string
  to?: string
  include_restricted?: boolean
}

export type ActualsBasis = 'transaction_ward_code' | 'budget_line_ward_code'
export type WardDimension = 'total' | 'department' | 'programme'

export interface WardPerformanceRow {
  authority_id: string
  financial_year_id: string
  currency: Currency
  ward_code: string
  unlocated_reason: 'unlocated' | 'unallocated_remainder' | null
  ward_status: 'linked' | 'unlinked' | null
  /** Decision D11: the basis of the council's ward membership ('interim' means provisional). */
  ward_register_basis?: string | null

  original_revenue: string | null
  adjustments_revenue: string | null
  revenue_budget: string | null
  revenue_actual: string | null
  revenue_actual_via_line: string | null
  revenue_variance: string | null
  revenue_collection_percentage: number | null

  original_expenditure: string | null
  adjustments_expenditure: string | null
  expenditure_budget: string | null
  expenditure_actual: string | null
  expenditure_actual_via_line: string | null
  open_commitments: string | null
  available_excluding_commitments: string | null
  available_including_commitments: string | null
  expenditure_variance: string | null
  expenditure_execution_percentage: number | null

  split_coverage_amount: string | null
  unallocated_remainder_amount: string | null
  attribution_exception_rows: number
  attributed_lines: number
  allocation_rows: number
  transaction_rows: number
}

/** One row of the department/programme breakdown behind a ward. Never summed in the client. */
export interface WardDimensionRow {
  currency: Currency
  ward_code: string | null
  unlocated_reason: string | null
  ward_status: 'linked' | 'unlinked' | null
  account_kind: 'revenue' | 'expenditure'
  dimension_id: string | null
  department_code: string | null
  department_name: string | null
  programme_code: string | null
  programme_name: string | null
  original_amount: string | null
  approved_adjustments: string | null
  budget_amount: string | null
  actual_amount: string | null
  actual_amount_via_line: string | null
  open_commitments: string | null
  available_excluding_commitments: string | null
  available_including_commitments: string | null
  variance: string | null
  execution_percentage: number | null
  attributed_lines: number
  allocation_rows: number
  transaction_rows: number
}

/** The ward's PROJECT measures, at the same grain, from finance.v_project_performance. */
export interface WardProjectSummary {
  ward_code: string
  currency: Currency
  project_count: number
  located_project_count: number
  approved_budget: string | null
  allocated_total: string | null
  actual_spend: string | null
  spend_ahead_of_progress_count: number
  progress_not_recorded_count: number
}

export interface UnlocatedRow {
  financial_year_id: string | null
  currency: Currency
  dataset: 'budget' | 'transactions' | 'projects'
  unlocated_rows: number
  unlocated_amount: string | null
}

export interface WardMapQuery {
  financial_year_id?: string
  currency?: Currency
  department_id?: string
  programme_id?: string
  account_kind?: 'revenue' | 'expenditure'
  dimension?: WardDimension
  actuals_basis?: ActualsBasis
}

export interface WardMapData {
  financial_year: { id: string; label: string; status: string } | null
  currencies: Currency[]
  wards: WardPerformanceRow[]
  ward_dimensions: WardDimensionRow[]
  projects_by_ward: WardProjectSummary[]
  unlocated: UnlocatedRow[]
  /** Decision D11: false means the council's wards are not linked, so no polygon can be shaded. */
  ward_register_linked: boolean
  ward_register_bases: string[]
  /** null means "not confined"; an array names the departments actually applied (audit M4-4). */
  department_scope: string[] | null
  dimension: WardDimension
  actuals_basis: ActualsBasis
  actuals_basis_columns: string[] | null
  filters: { department_id: string | null; programme_id: string | null; account_kind: string | null }
  sources: string[]
  data_as_at?: string | null
  generated_at: string
}

/** A project feature on the capital map. Properties are the whole v_project_performance row. */
export interface ProjectMapProperties extends FinanceProject {
  physical_progress_percent: number | null
  progress_recorded_at?: string | null
  spend_vs_progress_gap_points: number | null
  spend_ahead_of_progress: boolean | null
  department_name?: string | null
  department_code?: string | null
  description?: string | null
  location_text?: string | null
  start_date?: string | null
  end_date?: string | null
  longitude: number | null
  latitude: number | null
  ward_status: 'linked' | 'unlinked' | null
}

export interface ProjectMapFeature {
  type: 'Feature'
  geometry: Record<string, unknown> | null
  properties: ProjectMapProperties
}

export interface UnlocatedProject {
  project_id: string
  reference: string
  name: string
  status: string
  currency: Currency
  approved_budget: string | null
  allocated_total: string | null
  actual_spend: string | null
  execution_percentage: number | null
  physical_progress_percent: number | null
  ward_code: string | null
  department_code: string | null
  department_name: string | null
  location_text: string | null
  reason: 'no_location' | 'no_ward_or_location'
}

/**
 * The reply from recording (or clearing) physical progress.
 *
 * `recorded` is false when the figure was cleared, and `performance` is the view's own recomputation
 * — including `spend_ahead_of_progress`, which stays NULL when the comparison could not be made.
 * NULL there means NOT COMPARED; it never means "within tolerance".
 */
export interface ProjectProgressResult {
  project: {
    id: string
    reference: string
    physical_progress_percent: number | null
    progress_evidence_document_id: string | null
    progress_recorded_at: string | null
    progress_recorded_by: string | null
  }
  performance: {
    execution_percentage: number | null
    physical_progress_percent: number | null
    spend_vs_progress_gap_points: number | null
    spend_ahead_of_progress: boolean | null
    spend_ahead_of_progress_threshold_points: number | null
  } | null
  recorded: boolean
  note: string
}

export interface ProjectMapQuery {
  financial_year_id?: string
  currency?: Currency
  status?: string
  department_id?: string
  ward_code?: string
  bbox?: string
  exceptions_only?: boolean
  limit?: number
  offset?: number
}

export interface ProjectMapData {
  financial_year: { id: string; label: string; status: string } | null
  currencies: Currency[]
  features: { type: 'FeatureCollection'; features: ProjectMapFeature[] }
  unlocated_projects: UnlocatedProject[]
  unlocated: UnlocatedRow[]
  ward_register_linked: boolean
  ward_register_bases: string[]
  department_scope: string[] | null
  bbox: [number, number, number, number] | null
  limit: number
  offset: number
  actuals_basis: 'project_transaction'
  progress_decision: 'D12'
  sources: string[]
  data_as_at?: string | null
  generated_at: string
}

/**
 * A recorded spatial allocation (migration 198): money on a budget line or project attributed to
 * a ward by a stated methodology. The APPROVED row is what the ward views attribute; a draft does
 * not move a single figure, which is why the register is a first-class screen and not a form.
 */
export type SpatialAllocationStatus = 'draft' | 'approved' | 'rejected' | 'withdrawn'

export interface SpatialAllocation {
  id: string
  authority_id: number
  subject_kind: 'budget_line' | 'project'
  subject_id: string
  target_kind: 'ward'
  target_code: string
  amount: string
  currency: Currency
  share: string | null
  methodology: string
  evidence_document_id: string | null
  status: SpatialAllocationStatus
  requested_by: string
  requested_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  updated_at: string
  /**
   * How the target code relates to the council's register: 'linked', 'unlinked', or
   * 'ward_register_empty' while decision D11 is open. Server-derived, never inferred here.
   */
  target_status?: 'linked' | 'unlinked' | 'ward_register_empty' | null
}

export interface SpatialAllocationQuery {
  subject_kind?: 'budget_line' | 'project'
  subject_id?: string
  status?: SpatialAllocationStatus
  limit?: number
  offset?: number
}

export interface SpatialAllocationInput {
  subject_kind: 'budget_line' | 'project'
  subject_id: string
  target_code: string
  amount: string
  currency?: Currency
  share?: number
  methodology: string
  evidence_document_id?: string
}

/**
 * A public ward row. Every measure is NULL unless its dataset has a live publication, so a blank
 * figure means "not published" or "no figure", never zero (audit MAJOR-2).
 */
export interface PublicWardMapRow {
  ward_code: string
  ward_status: 'linked' | 'unlinked' | null
  currency: Currency
  ward_register_basis: string | null
  revenue_budget: string | null
  revenue_actual: string | null
  revenue_variance: string | null
  revenue_collection_percentage: number | null
  expenditure_budget: string | null
  expenditure_actual: string | null
  expenditure_execution_percentage: number | null
}

export interface PublicWardMapData {
  council: { name: string }
  financial_year: {
    id: string; label: string; start_date: string; end_date: string
    reporting_currency: Currency
  }
  currencies: Currency[]
  wards: PublicWardMapRow[]
  projects_by_ward: Array<{
    ward_code: string; currency: Currency; project_count: number
    approved_budget: string | null; located_project_count: number
  }>
  unlocated: UnlocatedRow[]
  ward_register_linked: boolean
  ward_register_bases: string[]
  published_datasets: string[]
  available_measures: string[]
  provenance: Record<string, {
    published_at: string; reporting_period_label: string | null
    data_as_at: string | null; version: number
  } | null>
  actuals_basis: ActualsBasis
  sources: string[]
  generated_at: string
  notes: Record<string, string>
}

export interface PublicWardGeometryData {
  ward_register_linked: boolean
  ward_register_bases: string[]
  features: Array<{
    type: 'Feature'
    properties: { ward_code: string; name: string | null; register_basis?: string | null }
    geometry: Record<string, unknown> | null
  }>
  note?: string | null
}

export interface WardGeometryFeature {
  type: 'Feature'
  properties: { ward_code: string; name: string | null }
  geometry: Record<string, unknown> | null
}

export interface WardGeometryData {
  ward_register_linked: boolean
  features: WardGeometryFeature[]
}

export interface BudgetLineListResult {
  lines: BudgetLinePerformance[]
  total: number
  limit: number
  offset: number
  /** Which definition of "available" the figures use. The screen must say so (§6.3). */
  available_balance_includes_commitments: boolean
}

export const financeApi = {
  // ── Identity and configuration ───────────────────────────────────────────────────────────────
  async identity(): Promise<FinanceIdentity> {
    return unwrap(await api.get('/finance/me'))
  },

  /** Staff who can be given finance access. Requires finance.users.manage_finance_roles. */
  async financeUsers(q?: string): Promise<FinanceUserList> {
    return unwrap(await api.get('/finance/users', { params: q ? { q } : undefined }))
  },
  async financeUserAccess(id: string): Promise<FinanceAccessDetail> {
    return unwrap(await api.get(`/finance/users/${id}/access`))
  },
  async updateFinanceUserAccess(id: string, body: {
    role?: string
    overrides?: Array<{ permission_code: string; effect: 'grant' | 'deny'; reason?: string | null; expires_at?: string | null }>
    department_ids?: string[]
    reason: string
  }): Promise<FinanceAccessDetail> {
    return unwrap(await api.put(`/finance/users/${id}/access`, body))
  },

  async financialYears(): Promise<FinancialYear[]> {
    return unwrap(await api.get('/finance/financial-years'))
  },
  async createFinancialYear(body: {
    label: string; start_date: string; end_date: string
    reporting_currency?: Currency; notes?: string
  }): Promise<FinancialYear> {
    return unwrap(await api.post('/finance/financial-years', body))
  },
  async updateFinancialYear(id: string, body: Partial<Pick<FinancialYear, 'label' | 'notes' | 'reporting_currency'>>): Promise<FinancialYear> {
    return unwrap(await api.patch(`/finance/financial-years/${id}`, body))
  },
  async openFinancialYear(id: string): Promise<FinancialYear> {
    return unwrap(await api.post(`/finance/financial-years/${id}/open`, {}))
  },
  async closeFinancialYear(id: string, note?: string): Promise<FinancialYear> {
    return unwrap(await api.post(`/finance/financial-years/${id}/close`, note ? { note } : {}))
  },
  /** Reopening a closed period demands a written reason; it is kept on the year and in the trail. */
  async reopenFinancialYear(id: string, reason: string): Promise<FinancialYear> {
    return unwrap(await api.post(`/finance/financial-years/${id}/reopen`, { reason }))
  },

  async departments(): Promise<Department[]> {
    return unwrap(await api.get('/finance/departments'))
  },
  async createDepartment(body: { code: string; name: string; vote_number?: number; head_user_id?: string }): Promise<Department> {
    return unwrap(await api.post('/finance/departments', body))
  },
  async updateDepartment(id: string, body: Partial<Pick<Department, 'name' | 'vote_number' | 'status' | 'head_user_id'>>): Promise<Department> {
    return unwrap(await api.patch(`/finance/departments/${id}`, body))
  },

  /**
   * Withdraw a department.
   *
   * A soft delete: the row is retained with `deleted_at` set, because budget lines, transactions
   * and projects already reference it and a council's history must stay readable. The server
   * refuses it while active records still hang off the vote, which is why the reason comes back as
   * a message rather than this screen deciding.
   */
  async deleteDepartment(id: string): Promise<{
    id: string; deleted?: boolean
    /** Set when the vote still carries records: it was retired, not removed, and this says why. */
    retired_instead_of_deleted?: boolean; reason?: string; status?: string
  }> {
    return unwrap(await api.delete(`/finance/departments/${id}`))
  },

  async programmes(departmentId?: string): Promise<Programme[]> {
    return unwrap(await api.get('/finance/programmes', { params: departmentId ? { department_id: departmentId } : undefined }))
  },
  async createProgramme(body: { code: string; name: string; department_id: string; description?: string }): Promise<Programme> {
    return unwrap(await api.post('/finance/programmes', body))
  },
  async updateProgramme(id: string, body: Partial<Pick<Programme, 'name' | 'description' | 'status'>>): Promise<Programme> {
    return unwrap(await api.patch(`/finance/programmes/${id}`, body))
  },
  async activities(programmeId?: string): Promise<Activity[]> {
    return unwrap(await api.get('/finance/activities', { params: programmeId ? { programme_id: programmeId } : undefined }))
  },
  async createActivity(body: { code: string; name: string; programme_id: string }): Promise<Activity> {
    return unwrap(await api.post('/finance/activities', body))
  },
  async updateActivity(id: string, body: Partial<Pick<Activity, 'name' | 'status'>>): Promise<Activity> {
    return unwrap(await api.patch(`/finance/activities/${id}`, body))
  },

  async accounts(kind?: 'revenue' | 'expenditure'): Promise<Account[]> {
    return unwrap(await api.get('/finance/accounts', { params: kind ? { kind } : undefined }))
  },
  async createAccount(body: {
    code: string; name: string; kind: 'revenue' | 'expenditure'
    revenue_class?: string; expenditure_class?: string; parent_id?: string; is_postable?: boolean
  }): Promise<Account> {
    return unwrap(await api.post('/finance/accounts', body))
  },
  /**
   * Load a chart of accounts in one transaction. `refused` names any account whose classification
   * could not be changed because transactions are already posted against it — a reclassification
   * of history, which needs a decision rather than an edit.
   */
  async loadChartOfAccounts(accounts: Array<Record<string, unknown>>): Promise<{
    created: number; updated: number; refused: Array<{ code: string; reason: string; detail: string }>
  }> {
    return unwrap(await api.post('/finance/accounts/bulk', { accounts }))
  },
  async updateAccount(id: string, body: Partial<Pick<Account, 'name' | 'revenue_class' | 'expenditure_class' | 'is_postable' | 'status'>>): Promise<Account> {
    return unwrap(await api.patch(`/finance/accounts/${id}`, body))
  },

  async settings(): Promise<Array<{ key: string; value: unknown; updated_at: string }>> {
    return unwrap(await api.get('/finance/settings'))
  },
  async setSetting(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    return unwrap(await api.put(`/finance/settings/${encodeURIComponent(key)}`, { value }))
  },

  async createColumnMapping(body: {
    name: string; dataset: ImportDataset; mapping: Record<string, string[]>
    source_system?: string; is_default?: boolean
  }): Promise<{ id: string; name: string; dataset: ImportDataset; mapping: Record<string, string[]>; is_default: boolean }> {
    return unwrap(await api.post('/finance/column-mappings', body))
  },

  async columnMappings(dataset?: ImportDataset) {
    return unwrap<Array<{ id: string; name: string; dataset: ImportDataset; mapping: Record<string, string[]>; is_default: boolean }>>(
      await api.get('/finance/column-mappings', { params: dataset ? { dataset } : undefined }))
  },

  // ── Budget ───────────────────────────────────────────────────────────────────────────────────
  async budgetLines(params: BudgetLineQuery): Promise<BudgetLineListResult> {
    return unwrap(await api.get('/finance/budget-lines', { params }))
  },
  // ── Finance map (GIS-finance M3–M5): render-only reads of the roll-up views ────────────────
  async mapWards(params: WardMapQuery = {}): Promise<WardMapData> {
    return unwrap(await api.get('/finance/map/wards', { params }))
  },
  async mapProjects(params: ProjectMapQuery = {}): Promise<ProjectMapData> {
    return unwrap(await api.get('/finance/map/projects', { params }))
  },
  async mapWardGeometry(): Promise<WardGeometryData> {
    return unwrap(await api.get('/finance/map/ward-geometry'))
  },

  // ── Spatial allocations (M5-7): attribution is recorded, approved and revoked, never computed ─
  async spatialAllocations(params: SpatialAllocationQuery = {}): Promise<{
    allocations: SpatialAllocation[]; limit: number; offset: number
  }> {
    return unwrap(await api.get('/finance/spatial-allocations', { params }))
  },
  async createSpatialAllocation(body: SpatialAllocationInput): Promise<SpatialAllocation> {
    return unwrap(await api.post('/finance/spatial-allocations', body))
  },
  async approveSpatialAllocation(id: string, decisionNote?: string): Promise<SpatialAllocation> {
    return unwrap(await api.post(`/finance/spatial-allocations/${id}/approve`,
      decisionNote ? { decision_note: decisionNote } : {}))
  },
  async rejectSpatialAllocation(id: string, decisionNote: string): Promise<SpatialAllocation> {
    return unwrap(await api.post(`/finance/spatial-allocations/${id}/reject`,
      { decision_note: decisionNote }))
  },
  async withdrawSpatialAllocation(id: string, decisionNote?: string): Promise<SpatialAllocation> {
    return unwrap(await api.post(`/finance/spatial-allocations/${id}/withdraw`,
      decisionNote ? { decision_note: decisionNote } : {}))
  },
  async budgetLine(id: string): Promise<{
    line: BudgetLinePerformance & { financial_year_label: string; financial_year_status: string }
    revisions: BudgetRevision[]
    commitments: Commitment[]
    explanations: VarianceExplanation[]
  }> {
    return unwrap(await api.get(`/finance/budget-lines/${id}`))
  },
  async createBudgetLine(body: {
    financial_year_id: string; department_id: string; account_id: string
    code: string; description: string; currency: Currency; original_amount: Money
    programme_id?: string; activity_id?: string; ward_code?: string
  }): Promise<BudgetLinePerformance> {
    return unwrap(await api.post('/finance/budget-lines', body))
  },
  async updateBudgetLine(id: string, body: { description?: string; original_amount?: Money; programme_id?: string; ward_code?: string }) {
    return unwrap(await api.patch(`/finance/budget-lines/${id}`, body))
  },
  async submitBudgetLine(id: string) {
    return unwrap(await api.post(`/finance/budget-lines/${id}/submit`, {}))
  },
  async returnBudgetLine(id: string, note: string) {
    return unwrap(await api.post(`/finance/budget-lines/${id}/return`, { note }))
  },
  async approveBudgetLine(id: string) {
    return unwrap(await api.post(`/finance/budget-lines/${id}/approve`, {}))
  },

  async revisions(params: { financial_year_id?: string; budget_line_id?: string; state?: string; limit?: number }): Promise<BudgetRevision[]> {
    return unwrap(await api.get('/finance/budget-revisions', { params }))
  },
  async createRevision(budgetLineId: string, body: {
    amount_delta: Money; reason: string; effective_date?: string
  }): Promise<BudgetRevision> {
    return unwrap(await api.post(`/finance/budget-lines/${budgetLineId}/revisions`, body))
  },
  async submitRevision(id: string) {
    return unwrap(await api.post(`/finance/budget-revisions/${id}/submit`, {}))
  },
  async approveRevision(id: string, note?: string) {
    return unwrap(await api.post(`/finance/budget-revisions/${id}/approve`, note ? { note } : {}))
  },
  async rejectRevision(id: string, note: string) {
    return unwrap(await api.post(`/finance/budget-revisions/${id}/reject`, { note }))
  },

  async commitments(params: { financial_year_id?: string; budget_line_id?: string; status?: string }): Promise<Commitment[]> {
    return unwrap(await api.get('/finance/commitments', { params }))
  },
  async explainVariance(body: {
    financial_year_id: string; explanation: string
    budget_line_id?: string; department_id?: string; period_label?: string
  }): Promise<VarianceExplanation> {
    return unwrap(await api.post('/finance/variance-explanations', body))
  },

  async performance(params: { financial_year_id: string; department_id?: string; kind?: 'revenue' | 'expenditure' }): Promise<{
    financial_year: FinancialYear
    rows: DepartmentPerformance[]
    thresholds: { warn_execution_percentage: number; flag_execution_percentage: number }
    available_balance_includes_commitments: boolean
    currencies_present: Currency[]
  }> {
    return unwrap(await api.get('/finance/performance', { params }))
  },
  /** Lines over budget, nearly exhausted, or carrying a currency fault. Advisory, not blocking. */
  async budgetExceptions(financialYearId: string): Promise<{
    rows: Array<BudgetLinePerformance & { flag: string }>
    thresholds: { warn_execution_percentage: number; flag_execution_percentage: number }
    note: string
  }> {
    return unwrap(await api.get('/finance/exceptions/budget', { params: { financial_year_id: financialYearId } }))
  },

  // ── Imports ──────────────────────────────────────────────────────────────────────────────────
  async imports(params: { financial_year_id?: string; dataset?: ImportDataset; status?: string; limit?: number }): Promise<ImportBatch[]> {
    return unwrap(await api.get('/finance/imports', { params }))
  },
  async importBatch(id: string): Promise<{
    batch: ImportBatch & { mapping_name: string | null; mapping: Record<string, string[]> | null }
    exception_summary: Array<{ error_code: string; field: string | null; rows: number; first_row: number }>
  }> {
    return unwrap(await api.get(`/finance/imports/${id}`))
  },
  /**
   * Upload a source file.
   *
   * `idempotencyKey` makes a retried upload the same upload rather than a second batch — so a
   * timeout on a slow connection cannot leave a council with two copies of its expenditure.
   * Generate it once per attempt and reuse it on retry.
   */
  async uploadImport(input: {
    file: File
    dataset: ImportDataset
    financialYearId: string
    idempotencyKey: string
    mappingId?: string
    declaredControlCount?: number
    declaredControlTotal?: string
    declaredControlCurrency?: Currency
    columnOverrides?: Record<string, string>
    onProgress?: (percent: number) => void
  }): Promise<ImportUploadResult> {
    const form = new FormData()
    form.append('dataset', input.dataset)
    form.append('financial_year_id', input.financialYearId)
    form.append('idempotency_key', input.idempotencyKey)
    if (input.mappingId) form.append('mapping_id', input.mappingId)
    if (input.declaredControlCount !== undefined) form.append('declared_control_count', String(input.declaredControlCount))
    if (input.declaredControlTotal) form.append('declared_control_total', input.declaredControlTotal)
    if (input.declaredControlCurrency) form.append('declared_control_currency', input.declaredControlCurrency)
    if (input.columnOverrides) form.append('column_overrides', JSON.stringify(input.columnOverrides))
    form.append('file', input.file, input.file.name)
    const r = await api.post('/finance/imports', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
      onUploadProgress: (e) => {
        if (input.onProgress && e.total) input.onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    return unwrap(r)
  },
  async validateImport(id: string, body?: { column_overrides?: Record<string, string>; date_order?: 'day_first' | 'month_first' }): Promise<ImportValidationResult> {
    return unwrap(await api.post(`/finance/imports/${id}/validate`, body ?? {}, { timeout: 180000 }))
  },
  async importRows(id: string, params?: { status?: string; limit?: number; offset?: number }) {
    return unwrap<Array<{
      row_number: number; status: string
      raw: Record<string, unknown>; normalised: Record<string, unknown>
      issues: Array<{ field: string | null; error_code: string; message: string }>
    }>>(await api.get(`/finance/imports/${id}/rows`, { params }))
  },
  async importExceptions(id: string, params?: { open_only?: boolean; error_code?: string; limit?: number }): Promise<ImportException[]> {
    return unwrap(await api.get(`/finance/imports/${id}/exceptions`, { params }))
  },
  async resolveImportException(batchId: string, exceptionId: string, body: {
    resolution: 'corrected_at_source' | 'mapping_added' | 'row_excluded' | 'accepted_as_is'
    note?: string
  }): Promise<ImportException> {
    return unwrap(await api.patch(`/finance/imports/${batchId}/exceptions/${exceptionId}`, body))
  },
  /** Committing an unreconciled batch needs a stated reason, kept on the batch and in the trail. */
  async commitImport(id: string, body?: { override_reconciliation?: boolean; override_reason?: string }): Promise<{
    batch: ImportBatch; written: number; skipped_as_duplicate: number
    already_committed?: boolean; note?: string
  }> {
    return unwrap(await api.post(`/finance/imports/${id}/commit`, body ?? {}, { timeout: 300000 }))
  },
  async cancelImport(id: string, reason?: string): Promise<ImportBatch> {
    return unwrap(await api.post(`/finance/imports/${id}/cancel`, reason ? { reason } : {}))
  },
  async importReconciliation(id: string): Promise<ImportReconciliation> {
    return unwrap(await api.get(`/finance/imports/${id}/reconciliation`))
  },

  // ── Projects ─────────────────────────────────────────────────────────────────────────────────
  async projects(params?: {
    status?: string; department_id?: string; ward_code?: string
    linked_subject_kind?: string; linked_subject_id?: string; q?: string; limit?: number
  }): Promise<FinanceProject[]> {
    return unwrap(await api.get('/finance/projects', { params }))
  },
  async projectTrace(id: string): Promise<ProjectTrace> {
    return unwrap(await api.get(`/finance/projects/${id}`))
  },
  async createProject(body: Record<string, unknown>): Promise<{ project: FinanceProject }> {
    return unwrap(await api.post('/finance/projects', body))
  },
  async updateProject(id: string, body: Record<string, unknown>) {
    return unwrap(await api.patch(`/finance/projects/${id}`, body))
  },
  /**
   * Record or CLEAR a project's physical completion (decision D12).
   *
   * `physical_progress_percent` is required and `null` is its own meaning: it clears the figure and
   * its evidence, so a number recorded in error can be taken back without inventing a better one.
   * Omitting the key is a 400 from the server, which is why this signature does not make it
   * optional. The reply carries the recomputed `performance` from
   * finance.v_project_performance — the flag is never derived here.
   */
  async recordProjectProgress(id: string, body: {
    physical_progress_percent: number | null
    progress_evidence_document_id?: string | null
    note?: string
  }): Promise<ProjectProgressResult> {
    return unwrap(await api.patch(`/finance/projects/${id}/progress`, body))
  },
  async submitProject(id: string) {
    return unwrap(await api.post(`/finance/projects/${id}/submit`, {}))
  },
  async approveProject(id: string) {
    return unwrap(await api.post(`/finance/projects/${id}/approve`, {}))
  },
  async allocateToProject(id: string, body: {
    budget_line_id: string; amount: Money
    allocation_type?: 'original' | 'revision'; budget_revision_id?: string
    effective_date?: string; note?: string
  }): Promise<ProjectAllocation> {
    return unwrap(await api.post(`/finance/projects/${id}/allocations`, body))
  },
  async associateTransaction(id: string, body: {
    transaction_id: string; association?: 'direct' | 'apportioned'; share?: number; note?: string
  }) {
    return unwrap(await api.post(`/finance/projects/${id}/transactions`, body))
  },
  /**
   * Detach a transaction from a project.
   *
   * It unlinks the association only. The transaction itself stays in the register — it came from
   * the council's accounting system and this module does not delete what it did not record.
   */
  async unlinkProjectTransaction(projectId: string, transactionId: string): Promise<{ unlinked: boolean }> {
    return unwrap(await api.delete(`/finance/projects/${projectId}/transactions/${transactionId}`))
  },

  /**
   * The money attached to a planning or environmental record, found by ITS id.
   *
   * This is the integration entry point: a planner looking at a development application calls it
   * with that application's id. It needs only finance.project.view, which `planner`, `eo` and
   * `env_officer` hold, so the trace works without giving planning staff the finance module.
   */
  async financeForLinkedRecord(kind: string, subjectId: string): Promise<{
    subject: { kind: string; id: string }
    projects: FinanceProject[]
    recent_transactions: FinanceTransaction[]
    counterparty_visible: boolean
  }> {
    return unwrap(await api.get(`/finance/linked/${kind}/${encodeURIComponent(subjectId)}`))
  },

  // ── Publication ──────────────────────────────────────────────────────────────────────────────
  async publications(params?: { financial_year_id?: string; dataset?: PublicationDataset; state?: string }): Promise<Publication[]> {
    return unwrap(await api.get('/finance/publications', { params }))
  },
  async publicationPreview(id: string): Promise<{
    publication: Publication
    summary: Array<Record<string, unknown>>
    withheld_from_public: string[]
    warning?: string
    note: string
  }> {
    return unwrap(await api.get(`/finance/publications/${id}/preview`))
  },
  async requestPublication(body: {
    financial_year_id: string; dataset: PublicationDataset
    import_batch_id?: string; reporting_period_label?: string; data_as_at?: string; notes?: string
  }): Promise<Publication> {
    return unwrap(await api.post('/finance/publications', body))
  },
  async approvePublication(id: string, note?: string): Promise<Publication> {
    return unwrap(await api.post(`/finance/publications/${id}/approve`, note ? { note } : {}))
  },
  async rejectPublication(id: string, note: string): Promise<Publication> {
    return unwrap(await api.post(`/finance/publications/${id}/reject`, { note }))
  },
  async publish(id: string): Promise<{ publication: Publication; superseded: Array<{ id: string; version: number }>; effect: string }> {
    return unwrap(await api.post(`/finance/publications/${id}/publish`, {}))
  },
  async withdrawPublication(id: string, reason: string): Promise<{ publication: Publication; effect: string }> {
    return unwrap(await api.post(`/finance/publications/${id}/withdraw`, { reason }))
  },
  /** Mark approved budget lines published. Separate so releasing a year does not sweep up drafts. */
  async markBudgetLinesPublished(publicationId: string, departmentId?: string): Promise<{ marked: number; note?: string }> {
    return unwrap(await api.post(`/finance/publications/${publicationId}/mark-budget-lines`,
      departmentId ? { department_id: departmentId } : {}))
  },
  async setDocumentVisibility(id: string, visibility: 'private' | 'internal' | 'public', reason?: string) {
    return unwrap(await api.patch(`/finance/documents/${id}/visibility`, { visibility, ...(reason ? { reason } : {}) }))
  },

  // ── Documents ────────────────────────────────────────────────────────────────────────────────
  async documents(params?: { subject_kind?: string; subject_id?: string; visibility?: string }): Promise<{
    documents: FinanceDocument[]; restricted_visible: boolean
  }> {
    return unwrap(await api.get('/finance/documents', { params }))
  },
  async uploadDocument(input: {
    file: File; subjectKind: string; subjectId: string; documentType?: string
    onProgress?: (percent: number) => void
  }): Promise<{ document: FinanceDocument; note: string }> {
    const form = new FormData()
    form.append('subject_kind', input.subjectKind)
    form.append('subject_id', input.subjectId)
    if (input.documentType) form.append('document_type', input.documentType)
    form.append('file', input.file, input.file.name)
    return unwrap(await api.post('/finance/documents', form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      onUploadProgress: (e) => {
        if (input.onProgress && e.total) input.onProgress(Math.round((e.loaded / e.total) * 100))
      },
    }))
  },
  documentDownloadUrl(id: string): string {
    return `/api/finance/documents/${id}/download`
  },
  async withdrawDocument(id: string, reason: string) {
    return unwrap(await api.delete(`/finance/documents/${id}`, { data: { reason } }))
  },

  // ── The transaction register (GAP-1) ─────────────────────────────────────────────────────────
  /**
   * The staff transaction register.
   *
   * `finance.transaction.view` existed as a permission with no endpoint and no screen until this
   * module: the public portal could browse published transactions while the council's own Director
   * of Finance could not browse the register (ROLE-WORKFLOW-COVERAGE GAP-1).
   *
   * Three things in the response are not decoration. `totals` describes the whole filtered set and
   * never combines currencies; `counterparty_visible` is false when the supplier columns are ABSENT
   * rather than empty; and `reversals` echoes which correction mode built the figures, because a
   * reversal and its replacement both live in the register and a total over both double-counts.
   */
  async transactions(params: TransactionQuery): Promise<TransactionRegisterPage> {
    return unwrap(await api.get('/finance/transactions', { params }))
  },
  async transaction(id: string): Promise<TransactionDetail> {
    return unwrap(await api.get(`/finance/transactions/${id}`))
  },

  // ── Reports and audit ────────────────────────────────────────────────────────────────────────
  async reportCatalogue(): Promise<{
    reports: ReportDefinition[]; formats: string[]
    can_export_restricted: boolean; currency_policy: string
  }> {
    return unwrap(await api.get('/finance/reports'))
  },
  async runReport(params: ReportRunParams): Promise<ReportResult> {
    return unwrap(await api.get('/finance/reports/run', { params: { ...params, format: 'json' } }))
  },
  /**
   * Download a report. Returns the blob and the filename the server chose, which carries the word
   * RESTRICTED when supplier identities are in the file.
   */
  async exportReport(
    params: ReportRunParams & { format: 'csv' | 'xlsx' | 'pdf' },
  ): Promise<{ blob: Blob; filename: string; restricted: boolean }> {
    const r = await api.get('/finance/reports/export', { params, responseType: 'blob', timeout: 300000 })
    const disposition = String(r.headers['content-disposition'] || '')
    const match = /filename="([^"]+)"/.exec(disposition)
    return {
      blob: r.data as Blob,
      filename: match ? match[1] : `${params.report}.${params.format}`,
      restricted: String(r.headers['x-finance-restricted']) === 'true',
    }
  },
  async audit(params?: {
    actor_id?: string; event?: string; entity_type?: string; entity_id?: string
    severity?: string; status_min?: number; from?: string; to?: string; limit?: number; offset?: number
  }): Promise<{ events: AuditEvent[]; limit: number; offset: number; note: string }> {
    return unwrap(await api.get('/finance/audit', { params }))
  },
  async exportAudit(params: { from?: string; to?: string; format: 'csv' | 'xlsx' | 'pdf' }): Promise<{ blob: Blob; filename: string }> {
    const r = await api.get('/finance/audit/export', { params, responseType: 'blob', timeout: 300000 })
    const match = /filename="([^"]+)"/.exec(String(r.headers['content-disposition'] || ''))
    return { blob: r.data as Blob, filename: match ? match[1] : `audit.${params.format}` }
  },

  // ── The Director's cockpit ───────────────────────────────────────────────────────────────────
  /**
   * The year's position, period by period. The same rows draw the charts and fill the table
   * beneath them, so a reader who cannot use the chart is not reading a different figure.
   */
  async overviewSeries(params: {
    financial_year_id: string; periodicity?: Periodicity; department_id?: string
  }): Promise<OverviewSeriesResult> {
    return unwrap(await api.get('/finance/overview/series', { params }))
  },
  /**
   * What may need the director's attention.
   *
   * An item with a count of zero is returned and rendered — "no line is overspent" is an answer,
   * where an absent row only says the question was never asked. An item the backend could not
   * compute returns `unavailable` with a reason, which is not the same as zero.
   */
  async overviewAttention(params: { financial_year_id: string; department_id?: string }): Promise<AttentionFeed> {
    return unwrap(await api.get('/finance/overview/attention', { params }))
  },
}

/**
 * The public portal's client. Separate from the staff client on purpose: these are the only finance
 * endpoints that answer an unauthenticated request, and keeping them apart makes it obvious when a
 * public page is about to call something that is not public.
 */
export const financePublicApi = {
  async years(): Promise<PublicYear[]> {
    return unwrap(await api.get('/public/finance/years'))
  },
  async overview(financialYearId: string): Promise<PublicOverview> {
    return unwrap(await api.get('/public/finance/overview', { params: { financial_year_id: financialYearId } }))
  },
  async budget(params: {
    financial_year_id: string; kind?: 'revenue' | 'expenditure'; department_id?: string
    q?: string; limit?: number; offset?: number
    sort?: 'code' | 'revised_amount' | 'execution'; direction?: 'asc' | 'desc'
  }): Promise<{ lines: BudgetLinePerformance[]; total: number; limit: number; offset: number; note: string }> {
    return unwrap(await api.get('/public/finance/budget', { params }))
  },
  async side(kind: 'revenue' | 'expenditure', financialYearId: string): Promise<{
    kind: string
    by_department: Array<{ department_code: string; department_name: string; currency: Currency; transactions: number; amount: Money }>
    by_account: Array<{ account_code: string; account_name: string; currency: Currency; transactions: number; amount: Money }>
    by_month: Array<{ month: string; currency: Currency; amount: Money; transactions: number }>
    published: PublicOverview['published'][string]
    note: string
  }> {
    return unwrap(await api.get(`/public/finance/${kind}`, { params: { financial_year_id: financialYearId } }))
  },
  async transactions(params: {
    financial_year_id: string; kind?: 'revenue' | 'expenditure'
    department_code?: string; account_code?: string; from?: string; to?: string; q?: string
    limit?: number; offset?: number; sort?: 'txn_date' | 'amount'; direction?: 'asc' | 'desc'
  }): Promise<{ transactions: FinanceTransaction[]; total: number; limit: number; offset: number; withheld: string }> {
    return unwrap(await api.get('/public/finance/transactions', { params }))
  },
  async transaction(id: string): Promise<{ transaction: FinanceTransaction; documents: FinanceDocument[] }> {
    return unwrap(await api.get(`/public/finance/transactions/${id}`))
  },
  async projects(params?: {
    financial_year_id?: string; status?: string; ward_code?: string; q?: string
    limit?: number; offset?: number
  }): Promise<{
    projects: FinanceProject[]; limit: number; offset: number
  }> {
    return unwrap(await api.get('/public/finance/projects', { params }))
  },

  /**
   * The published ward roll-up for the public transparency map (audit M7-2).
   *
   * The server decides which measures exist: `available_measures` is derived from live
   * publications, so the screen must offer only those and must never infer a figure it was not
   * given. An unpublished dataset returns NULL, not zero.
   */
  async mapWards(params: {
    financial_year_id: string; currency?: Currency
    dataset?: 'budget' | 'revenue' | 'expenditure' | 'projects'
  }): Promise<PublicWardMapData> {
    return unwrap(await api.get('/public/finance/map/wards', { params }))
  },
  /** Ward boundaries for the public map (audit M7-3). Reference geography, not a figure. */
  async mapWardGeometry(params?: { financial_year_id?: string }): Promise<PublicWardGeometryData> {
    return unwrap(await api.get('/public/finance/map/ward-geometry', { params }))
  },
  /**
   * Where a published document is served from.
   *
   * The same path the staff client uses, because it is the same endpoint: it authorises per
   * document rather than per directory, and a document the council has made public is served to a
   * resident with no session at all. It is named here so a public page never has to reach into the
   * staff client to build a link.
   */
  documentDownloadUrl(id: string): string {
    return `/api/finance/documents/${id}/download`
  },

  async documents(params?: {
    financial_year_id?: string
    dataset?: 'budget' | 'revenue' | 'expenditure' | 'projects' | 'reports' | 'documents'
    subject_kind?: string; document_type?: string; q?: string
    limit?: number; offset?: number
    sort?: 'uploaded_at' | 'filename' | 'document_type'; direction?: 'asc' | 'desc'
  }): Promise<{ documents: FinanceDocument[]; total: number; limit: number; offset: number }> {
    return unwrap(await api.get('/public/finance/documents', { params }))
  },
}

export default financeApi
