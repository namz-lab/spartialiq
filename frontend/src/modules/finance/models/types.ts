/**
 * The finance domain, as the API returns it.
 *
 * MONEY IS A STRING HERE, AS IT IS IN THE BACKEND. The API sends decimal strings ('125000.00')
 * because a JavaScript number is a binary float and a council's expenditure total is not something
 * to be approximately right about. Nothing in this module parses an amount into a number except to
 * draw a bar on a chart, and nothing adds two amounts together at all — every total this UI shows
 * was computed in SQL over NUMERIC. See `useMoney` for the formatting rules.
 *
 * CURRENCY IS NEVER IMPLICIT. Every amount-bearing type carries its own `currency`, and every
 * aggregate the API returns is already grouped by it. There is no combined figure anywhere, and
 * adding one would need a Council-approved conversion basis that does not yet exist (decision D4
 * in docs/finance/COUNCIL-DECISIONS.md).
 */

/** The two currencies this system stores. Adding one is a backend migration. */
import type { WorkspaceKey } from '../shell/workspaces'

export type Currency = 'USD' | 'ZWG'

/** A decimal string, as the API sends it. Never parsed for arithmetic. */
export type Money = string

export type FinancialYearStatus = 'draft' | 'open' | 'closed' | 'archived'
export type AccountKind = 'revenue' | 'expenditure'
export type BudgetLineStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'published'
export type RevisionState = 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'
export type ImportDataset = 'budget' | 'actuals' | 'commitments' | 'projects'
export type ImportStatus =
  | 'uploaded' | 'mapped' | 'validating' | 'validated'
  | 'committing' | 'committed' | 'failed' | 'cancelled' | 'superseded'
export type PublicationDataset = 'budget' | 'revenue' | 'expenditure' | 'projects' | 'documents' | 'reports'
export type PublicationState = 'pending' | 'approved' | 'rejected' | 'published' | 'withdrawn'
export type ProjectStatus =
  | 'proposed' | 'awaiting_approval' | 'approved' | 'in_progress'
  | 'suspended' | 'completed' | 'cancelled'
export type LinkedSubjectKind =
  | 'development_application' | 'planning_project' | 'survey_project'
  | 'council_asset' | 'service_desk_ticket' | 'environmental_review' | 'other'

export interface FinancePermission {
  code: string
  label: string
  category: string
  is_approval: boolean
  is_publication: boolean
  is_restricted: boolean
  /** The sentence the catalogue carries, shown where an action is unavailable. */
  description: string | null
}

/** What this person may do, as the backend sees it. The UI uses it to explain, not to enforce. */
export interface FinanceIdentity {
  user_id: string
  role: string
  authority_id: number | null
  permissions: string[]
  department_scope: Array<{ id: string; code: string; name: string }>
  catalogue: FinancePermission[]
  /**
   * The role workspaces this person may open, decided by the server's workspace catalogue, in
   * catalogue order. Absent from a server that predates the catalogue, so read with `?? []`.
   */
  workspaces?: WorkspaceKey[]
  /** Where they land: their primary role's workspace if they hold it, else the first they hold. */
  home_workspace?: WorkspaceKey | null
}

/** A staff account as the finance access screen sees it. `null` is not a finance role. */
export interface FinanceAccessUser {
  id: string
  email: string
  name: string
  role: string
  department: string | null
  job_title: string | null
  active: boolean
  status: string | null
  override_count: number
  scope_count: number
}

export interface FinanceAccessOverride {
  permission_code: string
  effect: 'grant' | 'deny'
  reason: string | null
  granted_by: string | null
  granted_at: string
  expires_at: string | null
}

/** The role's defaults, this person's adjustments, and the permissions that result. */
export interface FinanceAccessDetail {
  user: Pick<FinanceAccessUser, 'id' | 'email' | 'name' | 'role' | 'department' | 'job_title' | 'active' | 'status'>
  role_permissions: string[]
  overrides: FinanceAccessOverride[]
  department_scope: Array<{ id: string; code: string; name: string }>
  permissions: string[]
}

export interface FinanceRoleDefaults {
  name: string
  permissions: string[]
}

export interface FinanceUserList {
  users: FinanceAccessUser[]
  total: number
  limit: number
  offset: number
  roles: FinanceRoleDefaults[]
}

export interface FinancialYear {
  id: string
  label: string
  /** ISO date. The API sends DATE columns as text, so this is the council's date, not an instant. */
  start_date: string
  end_date: string
  status: FinancialYearStatus
  reporting_currency: Currency
  notes: string | null
  opened_at: string | null
  closed_at: string | null
  budget_line_count?: string
  transaction_count?: string
}

export interface Department {
  id: string
  code: string
  name: string
  vote_number: number | null
  status: 'active' | 'inactive'
  head_user_id: string | null
  head_name?: string | null
  head_email?: string | null
}

export interface Programme {
  id: string
  department_id: string
  code: string
  name: string
  description: string | null
  status: 'active' | 'inactive'
}

export interface Activity {
  id: string
  programme_id: string
  code: string
  name: string
  status: 'active' | 'inactive'
}

export interface Account {
  id: string
  code: string
  name: string
  /** Set by the Council per account. NEVER inferred from the numeric range of the code. */
  kind: AccountKind
  revenue_class: 'internally_generated' | 'grant' | 'transfer' | 'other' | null
  expenditure_class: 'recurrent' | 'capital' | null
  parent_id: string | null
  parent_code?: string | null
  is_postable: boolean
  effective_from: string | null
  effective_to: string | null
  status: 'active' | 'inactive'
}

/** One row of finance.v_budget_line_performance: the specification's §6.1 measures. */
export interface BudgetLinePerformance {
  budget_line_id: string
  financial_year_id: string
  department_id: string
  programme_id: string | null
  account_id: string
  ward_code: string | null
  code: string
  description: string
  status: BudgetLineStatus
  currency: Currency
  account_kind: AccountKind
  original_amount: Money
  approved_adjustments: Money
  revised_amount: Money
  actual_amount: Money
  open_commitments: Money
  available_excluding_commitments: Money
  available_including_commitments: Money
  /** Null where the revised budget is zero: undefined, not zero and not infinity (§6.1). */
  execution_percentage: string | null
  variance: Money
  transaction_rows: number
  last_transaction_date: string | null
  /** Rows posted against this line in a DIFFERENT currency. Excluded from the totals, never converted. */
  actual_currency_mismatch_rows: number
  revision_currency_mismatch_rows: number
  commitment_currency_mismatch_rows: number
  department_code?: string
  department_name?: string
  account_code?: string
  account_name?: string
  programme_code?: string | null
  programme_name?: string | null
  /**
   * Who submitted the line for approval, from the base table rather than the performance view.
   * Present so an approver is not offered Approve on their own submission — the route refuses it
   * (`finance-budget.js` POST approve) and so does the specification's §2.3 separation of duties.
   */
  submitted_by?: string | null
  /** Why a submitted line was sent back. The preparer should read it on the row, not in the trail. */
  returned_note?: string | null
}

export interface BudgetRevision {
  id: string
  budget_line_id: string
  revision_no: number
  /** Signed: positive is a supplementary allocation, negative a reduction. */
  amount_delta: Money
  currency: Currency
  reason: string
  state: RevisionState
  effective_date: string | null
  requested_by: string
  requested_at: string
  requested_by_name?: string | null
  decided_by: string | null
  decided_at: string | null
  decided_by_name?: string | null
  decision_note: string | null
  budget_line_code?: string
  budget_line_description?: string
  original_amount?: Money
  department_name?: string
}

export interface Commitment {
  id: string
  budget_line_id: string
  reference: string
  amount: Money
  liquidated_amount: Money
  outstanding_amount?: Money
  currency: Currency
  committed_on: string
  status: 'open' | 'partially_liquidated' | 'liquidated' | 'cancelled'
  description: string | null
  budget_line_code?: string
}

export interface VarianceExplanation {
  id: string
  budget_line_id: string | null
  department_id: string | null
  period_label: string | null
  explanation: string
  recorded_at: string
  recorded_by_name?: string | null
}

export interface DepartmentPerformance {
  financial_year_id: string
  department_id: string
  account_kind: AccountKind
  currency: Currency
  line_count: number
  original_amount: Money
  approved_adjustments: Money
  revised_amount: Money
  actual_amount: Money
  open_commitments: Money
  available_excluding_commitments: Money
  available_including_commitments: Money
  execution_percentage: string | null
  actual_currency_mismatch_rows: number
  department_code?: string
  department_name?: string
}

export interface ImportBatch {
  id: string
  financial_year_id: string
  financial_year_label?: string
  dataset: ImportDataset
  original_filename: string
  /** SHA-256 of the preserved source file. The provenance everything downstream rests on. */
  file_hash: string
  file_size_bytes: string
  status: ImportStatus
  rows_total: number
  rows_valid: number
  rows_rejected: number
  declared_control_count: number | null
  declared_control_total: Money | null
  declared_control_currency: Currency | null
  reconciled_count: number | null
  reconciled_total: Money | null
  reconciliation_status: 'not_checked' | 'matched' | 'mismatched' | 'not_declared'
  error_summary: string | null
  uploaded_at: string
  uploaded_by_name?: string | null
  validated_at: string | null
  committed_at: string | null
  committed_by_name?: string | null
  open_exceptions?: string
}

export interface ImportMappingReport {
  id: string | null
  name: string | null
  /** target field → the column of the uploaded file that fed it. */
  resolved: Record<string, string>
  unmatched_targets: string[]
  unused_headers: string[]
  /** Groups that nothing in the file satisfied. The batch cannot be validated until these are mapped. */
  missing_required: string[]
}

export interface ImportUploadResult {
  batch: ImportBatch
  already_existed?: boolean
  file: {
    format: 'csv' | 'xlsx'
    sheet_name: string | null
    delimiter: string | null
    truncated: boolean
    header_row: string[]
    row_count: number
  }
  mapping: ImportMappingReport
  sample_rows: Array<Array<string | number | null>>
}

export interface ImportException {
  id: string
  batch_id: string
  row_number: number
  field: string | null
  error_code: string
  message: string
  raw: unknown
  resolved_at: string | null
  resolution: string | null
  resolution_note: string | null
  resolved_by_name?: string | null
}

export interface ImportValidationResult {
  batch: ImportBatch
  counts: { total: number; valid: number; rejected: number; duplicates: number }
  currencies_in_file: Currency[]
  reconciliation: { status: ImportBatch['reconciliation_status']; notes: string[] }
  exception_summary: Array<{ error_code: string; field: string | null; rows: number; first_row: number }>
  date_order: 'day_first' | 'month_first'
}

export interface ImportReconciliation {
  batch_id: string
  dataset: ImportDataset
  source_file: { filename: string; sha256: string; size_bytes: number; uploaded_at: string }
  declared_by_council: { count: number | null; total: Money | null; currency: Currency | null }
  yielded_by_file: { count: number | null; total: Money | null }
  /** Per currency. Can differ from the file when rows were skipped as duplicates. */
  posted_to_register: Array<{ currency: Currency; rows: number; total: Money }>
  rows_by_status: Array<{ status: string; rows: number }>
  reconciliation_status: ImportBatch['reconciliation_status']
  notes: string | null
}

export interface FinanceProject {
  project_id: string
  reference: string
  name: string
  description?: string | null
  status: ProjectStatus
  department_id: string | null
  department_code?: string | null
  department_name?: string | null
  ward_code: string | null
  currency: Currency
  approved_budget: Money
  allocated_original: Money
  allocated_revisions: Money
  allocated_total: Money
  actual_spend: Money
  remaining_allocation: Money
  execution_percentage: string | null
  transaction_rows: number
  last_transaction_date: string | null
  /** Allocations and spend recorded in a currency other than the project's own. Never added to the
   * totals above; surfaced so a reader can see that the project has money in more than one
   * currency. */
  other_currency_allocations?: Record<string, string>
  other_currency_spend?: Record<string, string>
  allocation_currency_mismatch_rows?: number
  actual_currency_mismatch_rows?: number
  /** The financial years in which this project has an allocation or a linked transaction. */
  financial_year_ids?: string[]
  linked_subject_kind: LinkedSubjectKind | null
  linked_subject_id: string | null
  location_text?: string | null
  start_date?: string | null
  end_date?: string | null
  longitude?: number | null
  latitude?: number | null
  /**
   * Physical delivery as reported by the responsible officer (decision D12, migration 202).
   *
   * `null` means NOT RECORDED and must render as such — never 0 %. A recorded 0 is a different
   * fact: a report was made and nothing has been built. `spend_ahead_of_progress` is `true`,
   * `false` or `null`, where `null` means the comparison could NOT BE MADE (no progress figure, no
   * execution figure, or no council threshold) and never "within tolerance".
   */
  physical_progress_percent?: number | null
  progress_evidence_document_id?: string | null
  progress_recorded_at?: string | null
  spend_vs_progress_gap_points?: number | null
  spend_ahead_of_progress?: boolean | null
  spend_ahead_of_progress_threshold_points?: number | null
}

export interface ProjectAllocation {
  id: string
  project_id: string
  budget_line_id: string
  budget_line_code?: string
  budget_line_description?: string
  financial_year_label?: string
  amount: Money
  currency: Currency
  allocation_type: 'original' | 'revision'
  effective_date: string | null
  note: string | null
  revision_no?: number | null
  revision_reason?: string | null
}

export interface FinanceTransaction {
  id: string
  txn_date: string
  amount: Money
  currency: Currency
  description: string | null
  reference: string | null
  record_type?: string | null
  account_code: string
  account_name: string
  account_kind: AccountKind
  department_code?: string
  department_name?: string
  source_system?: string
  source_ref?: string
  import_batch_id?: string | null
  association?: 'direct' | 'apportioned'
  share?: string
  /** Present ONLY for a caller holding finance.transaction.view_counterparty. Absent, not blank. */
  counterparty_ref?: string
  counterparty_name?: string
}

export interface ProjectTrace {
  project: FinanceProject
  allocations: ProjectAllocation[]
  revisions: BudgetRevision[]
  transactions: FinanceTransaction[]
  documents: FinanceDocument[]
  linked_record: { kind: string; id: string; exists: boolean | 'unknown'; reason?: string } | null
  /** False means the fields are absent from the rows above, not that they were empty. */
  counterparty_visible: boolean
}

export interface FinanceDocument {
  id: string
  subject_kind: string
  subject_id: string
  financial_year_id?: string | null
  filename: string
  mime_type: string
  size_bytes: string
  checksum?: string
  document_type: string | null
  visibility: 'private' | 'internal' | 'public'
  uploaded_at: string
  uploaded_by_name?: string | null
}

export interface Publication {
  id: string
  financial_year_id: string
  financial_year_label?: string
  dataset: PublicationDataset
  version: number
  state: PublicationState
  reporting_period_label: string | null
  data_as_at: string | null
  decision_note: string | null
  withdraw_reason: string | null
  reviewed_at: string | null
  reviewed_by_name?: string | null
  approved_at: string | null
  approved_by_name?: string | null
  published_at: string | null
  published_by_name?: string | null
  withdrawn_at: string | null
  withdrawn_by_name?: string | null
  import_filename?: string | null
  import_file_hash?: string | null
  import_reconciliation_status?: string | null
  created_at?: string
  updated_at?: string
}

export interface AuditEvent {
  id: string
  occurred_at: string
  actor_email: string | null
  actor_role: string | null
  event: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  method: string | null
  path: string | null
  /** A 4xx here is a REFUSED attempt, which is as much a part of the record as a successful one. */
  status: number | null
  entity_type: string | null
  entity_id: string | null
  ip: string | null
}

export interface ReportDefinition {
  id: string
  name: string
  /** May include 'periodicity' for a period-based report (W2). */
  requires: string[]
  grouped_by: string[]
  restricted_columns?: string[]
  /**
   * The periodicities this report can be run at, if any. Absent or empty means the report has no
   * period dimension and the periodicity control is not offered for it.
   */
  periods?: Periodicity[]
  /** One sentence on what the report is for. Shown beside it in the picker. */
  description?: string
  /**
   * The dimensional filters this report actually applies, published by the backend so the picker
   * offers a control only where it narrows something.
   *
   * It is served from `REPORT_FILTERS` in the backend's finance-reports.js, which is the file whose
   * `buildReport()` honours it. The screen deliberately keeps NO copy: it used to, and a filter
   * added to a report in the backend would have gone on being mis-offered by a screen nobody had
   * edited. Values are 'department_id', 'account_id', 'programme_id', 'ward_code', 'kind',
   * 'expenditure_class', 'currency' and 'dates'.
   */
  accepts?: string[]
}

export interface ReportResult {
  report: string
  financial_year: FinancialYear | null
  comparison_year?: FinancialYear | null
  columns: Array<{ header: string; key: string; type?: 'number' | 'date' }>
  rows: Array<Record<string, unknown>>
  restricted?: boolean
  meta: Record<string, string>
}

// ── The transaction register (W1) ───────────────────────────────────────────────────────────────

/**
 * How the register treats a correction.
 *
 * A correction in this system is a reversal plus a replacement, both of which stay visible
 * (`finance.transaction.reverses_id`, migration 188). That means a naive total over the register
 * double-counts the corrected amount. `exclude` is therefore the default, and every response
 * echoes the mode it used — a figure from this register must never be read without knowing which
 * of the three it was built from.
 */
export type ReversalMode = 'exclude' | 'only' | 'all'

export interface TransactionQuery {
  financial_year_id: string
  department_id?: string
  account_id?: string
  programme_id?: string
  activity_id?: string
  budget_line_id?: string
  project_id?: string
  ward_code?: string
  kind?: AccountKind
  expenditure_class?: 'recurrent' | 'capital'
  revenue_class?: 'internally_generated' | 'grant' | 'transfer' | 'other'
  currency?: Currency
  from?: string
  to?: string
  /** Matches description or the council's own voucher reference. */
  q?: string
  source_system?: string
  import_batch_id?: string
  reversals?: ReversalMode
  limit?: number
  offset?: number
  sort?: 'txn_date' | 'amount' | 'account_code' | 'department_code'
  direction?: 'asc' | 'desc'
}

/** One total per currency AND per kind. There is deliberately no row spanning the two (D4). */
export interface TransactionTotal {
  currency: Currency
  account_kind: AccountKind
  rows: number
  amount: Money
}

export interface TransactionRegisterPage {
  transactions: FinanceTransaction[]
  total: number
  limit: number
  offset: number
  /** Describes the WHOLE filtered set, not the page on screen. The UI must say so. */
  totals: TransactionTotal[]
  /** False means the counterparty fields are absent from the rows, not that they were empty. */
  counterparty_visible: boolean
  /**
   * Null means not confined. Otherwise the department CODES this answer was confined to.
   *
   * Codes, not ids, because the field exists to be read: it is what tells someone whether a total
   * is council-wide or only their own votes, and a uuid tells them nothing. Every endpoint that
   * returns this field returns codes — the register and the cockpit were briefly inconsistent on
   * 2026-11-10 and were aligned on the reader's side.
   */
  scope_applied: string[] | null
  reversals: ReversalMode
}

/** A transaction and everything a director needs to judge it, without reading the register. */
export interface TransactionDetail {
  transaction: FinanceTransaction
  budget_line: {
    id: string; code: string; description: string
    revised_amount: Money; actual_amount: Money; currency: Currency
  } | null
  project: { project_id: string; reference: string; name: string } | null
  documents: FinanceDocument[]
  import_batch: Pick<ImportBatch,
    'id' | 'dataset' | 'original_filename' | 'file_hash' | 'committed_at' | 'reconciliation_status'> | null
  /**
   * Was this corrected, and does it correct something? Both directions, because a director asking
   * "is this figure still live" needs the answer from either end of the pair.
   */
  reversal: {
    reverses: { id: string; txn_date: string; amount: Money; reference: string | null } | null
    reversed_by: { id: string; txn_date: string; amount: Money; reference: string | null } | null
  }
  counterparty_visible: boolean
}

// ── Periods, management accounts and statutory returns (W2) ────────────────────────────────────

/**
 * The period a report buckets by.
 *
 * Buckets are generated from the COUNCIL'S OWN financial year start, not from January, so a
 * July–June year yields Q1 = Jul–Sep. The backend's `src/lib/financePeriods.js` is the single
 * place that decides this; see decision A3 in the design spec.
 */
export type Periodicity = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

export interface ReportPeriod {
  from_date: string
  to_date: string
  /** Stable and ordinal: 'm01'…'m12', 'q1'…'q4'. Safe as an object key and as a column key. */
  key: string
  label: string
}

// ── The Director's cockpit (W3) ────────────────────────────────────────────────────────────────

/** One period's position for one currency and kind. Computed in SQL over NUMERIC. */
export interface OverviewSeriesPoint {
  period_key: string
  period_label: string
  from_date: string
  to_date: string
  budget: Money
  actual: Money
  commitments: Money
  /** Actuals from the year start to this period's end. */
  cumulative_actual: Money
}

export interface OverviewSeries {
  currency: Currency
  account_kind: AccountKind
  points: OverviewSeriesPoint[]
}

export interface OverviewSeriesResult {
  financial_year: FinancialYear
  periodicity: Periodicity
  periods: ReportPeriod[]
  series: OverviewSeries[]
  /** Department CODES, or null for not confined. Same meaning as on the register. */
  scope_applied: string[] | null
}

/**
 * One thing that may need the director's attention.
 *
 * A zero count is RENDERED, not hidden. "No line is overspent" is an answer a director needs; an
 * absent row only says the question was never asked.
 */
export interface AttentionItem {
  id: string
  label: string
  /** One sentence. What the count means and what follows from it. */
  statement: string
  count: number
  severity: 'info' | 'watch' | 'act'
  /** The section this item is resolved in, and the filters that show it. */
  section: string
  query?: Record<string, string>
  /** Present where the item has a money dimension. Per currency, never combined. */
  amounts?: Array<{ currency: Currency; amount: Money }>
  /** True where the count could NOT be computed — not the same as a count of zero. */
  unavailable?: boolean
  unavailable_reason?: string | null
}

export interface AttentionFeed {
  financial_year_id: string
  generated_at: string
  items: AttentionItem[]
  /** Department CODES, or null for not confined. Same meaning as on the register. */
  scope_applied: string[] | null
}

// ── The public portal ───────────────────────────────────────────────────────────────────────────

export interface PublicYear {
  id: string
  label: string
  start_date: string
  end_date: string
  reporting_currency: Currency
  published_datasets: PublicationDataset[]
  last_published_at: string
}

export interface PublicProvenance {
  published_at: string
  reporting_period_label: string | null
  data_as_at: string | null
  version: number
}

/** One block per currency. There is no combined figure, by design. */
export interface PublicCurrencySummary {
  currency: Currency
  revenue: {
    budget: { lines: number; original_amount: Money; revised_amount: Money } | null
    actual: { transactions: number; amount: Money; earliest: string; latest: string } | null
  }
  expenditure: {
    budget: { lines: number; original_amount: Money; revised_amount: Money } | null
    actual: { transactions: number; amount: Money; earliest: string; latest: string } | null
  }
}

export interface PublicOverview {
  council: { name: string }
  financial_year: FinancialYear
  summary: PublicCurrencySummary[]
  projects: Array<{ currency: Currency; projects: number; approved_budget: Money }>
  published: Record<string, PublicProvenance | null>
  definitions: Record<string, string>
}
