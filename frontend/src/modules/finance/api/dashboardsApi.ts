/**
 * The first-screen reads of seven finance workspaces (backend `src/routes/finance-dashboards.js`)
 * and the internal audit plan (`src/routes/finance-internal-audit.js`, migration 210).
 *
 * Every amount is a decimal string from Postgres, one row per currency (decision D4). Nothing here
 * is added up in the browser.
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'

const unwrap = <T>(r: { data?: { data?: T } & T }): T => (r.data?.data ?? r.data) as T
const yearParams = (id?: string | null) => (id ? { financial_year_id: id } : {})

export interface DashYear { id: string; label: string; start_date: string; end_date: string; status: string; reporting_currency: Currency }
export interface DashAlert { tone: 'neg' | 'warn' | 'info'; key: string; text: string }
export interface Amount { currency: Currency; amount: string }

export interface ManagerDashboard {
  users: { total: number; active: number }
  roles: number
  pending: { key: string; label: string; n: number }[]
  pending_total: number
  alerts: DashAlert[]
  activity: { week: string; actions: number; people: number }[]
  health: {
    database: { ok: boolean; ms: number }
    imports: { last_commit: string | null; open_batches: number }
    audit_trail: { last_event: string | null }
    uptime_seconds: number
    started_at: string
  }
  recent: { at: string; who: string; text: string; event: string }[]
}

export interface OfficerDashboard {
  year: DashYear
  pending_payments: (Amount & { n: number })[]
  debtors: (Amount & { n: number })[]
  journals: { n: number; mine: number }
  banks: { currency: Currency; balance: string }[]
  cash_flow: { day: string; currency: Currency; inflow: string; outflow: string }[]
  tasks: { key: string; text: string; n: number }[]
  recent: {
    id: string; posting_date: string; voucher_no: string; voucher_type: string; status: string; currency: Currency
    description: string; amount: string | null; cash_effect: string
  }[]
}

export interface AuditDashboard {
  year: DashYear
  plan: {
    total: number; completed: number; in_progress: number; not_started: number
    completed_pct: string | null; in_progress_pct: string | null; not_started_pct: string | null
  }
  findings: { open: number; high: number; medium: number; low: number; overdue: number }
  compliance: { due: number; on_time: number; pct: string | null }
  recent: { id: string; title: string; area: string; phase: string; status: string; updated_at: string }[]
  upcoming: { kind: 'engagement' | 'finding'; id: string; text: string; date: string }[]
  refusals_7d: number
}

export interface RevenueDashboard {
  year: DashYear
  billed: (Amount & { bills: number })[]
  collected: Amount[]
  collection_rate: { currency: Currency; billed: string; received: string; rate: string | null }[]
  arrears: (Amount & { accounts: number })[]
  ageing: (Amount & { bucket: '0_30' | '31_60' | '61_90' | 'over_90'; items: number })[]
  trend: { month: string; currency: Currency; billed: string; collected: string }[]
  streams: (Amount & { name: string; share: string | null })[]
}

export interface ExecutiveDashboard {
  year: DashYear
  totals: { currency: Currency; account_kind: 'revenue' | 'expenditure'; budget: string; actual: string; execution: string | null }[]
  prior: { currency: Currency; account_kind: 'revenue' | 'expenditure'; actual: string }[]
  departments: { currency: Currency; code: string; name: string; budget: string; actual: string; utilisation: string | null }[]
  projects: { in_progress: number; completed: number; on_track: number; active: number; on_track_pct: string | null }
  high_risks: number
  compliance: { due: number; on_time: number; pct: string | null }
}

export type PublicationState = 'published' | 'pending' | 'approved' | 'rejected' | 'withdrawn'
export interface PublisherDashboard {
  states: Record<PublicationState, number>
  this_month: Record<PublicationState, number>
  recent: {
    id: string; dataset: string; version: number; state: PublicationState; reporting_period_label: string | null
    published_at: string | null; created_at: string; year_label: string | null
  }[]
  documents: { public: number; internal: number; private: number }
}

export interface DepartmentDashboard {
  year: DashYear
  departments: { id: string; code: string; name: string }[]
  unscoped: boolean
  totals: {
    currency: Currency; budget: string; actual: string; committed: string; available: string
    actual_pct: string | null; committed_pct: string | null; available_pct: string | null; utilised_pct: string | null
  }[]
  top_items: { budget_line_id: string; currency: Currency; code: string; description: string; actual: string; budget: string }[]
  tasks: { key: string; query?: Record<string, string>; text: string; n: number }[]
}

export type EngagementStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled'
export type EngagementPhase = 'planning' | 'fieldwork' | 'reporting' | 'follow_up'
export interface AuditEngagement {
  id: string; financial_year_id: string | null; title: string; area: string; phase: EngagementPhase; status: EngagementStatus
  planned_start: string | null; planned_end: string | null; lead_user_id: string | null; lead_name: string | null
  notes: string | null; completed_at: string | null; created_at: string; updated_at: string; findings: number; open_findings: number
}
export type FindingRisk = 'high' | 'medium' | 'low'
export interface AuditFinding {
  id: string; engagement_id: string; engagement_title: string; area: string; title: string; detail: string | null
  risk: FindingRisk; status: 'open' | 'closed'; action: string | null; action_owner: string | null; due_date: string | null
  closed_at: string | null; closure_note: string | null; closed_by_name: string | null; created_at: string; updated_at: string
  overdue: boolean
}
export interface EngagementBody {
  title?: string; area?: string; financial_year_id?: string | null; phase?: EngagementPhase; status?: EngagementStatus
  planned_start?: string | null; planned_end?: string | null; lead_user_id?: string | null; notes?: string | null
}
export interface FindingBody {
  engagement_id?: string; title?: string; detail?: string | null; risk?: FindingRisk
  action?: string | null; action_owner?: string | null; due_date?: string | null
}

export const dashboardsApi = {
  async manager(): Promise<ManagerDashboard> { return unwrap(await api.get('/finance/dashboards/manager')) },
  async officer(year?: string | null): Promise<OfficerDashboard> { return unwrap(await api.get('/finance/dashboards/officer', { params: yearParams(year) })) },
  async audit(year?: string | null): Promise<AuditDashboard> { return unwrap(await api.get('/finance/dashboards/audit', { params: yearParams(year) })) },
  async revenue(year?: string | null): Promise<RevenueDashboard> { return unwrap(await api.get('/finance/dashboards/revenue', { params: yearParams(year) })) },
  async executive(year?: string | null): Promise<ExecutiveDashboard> { return unwrap(await api.get('/finance/dashboards/executive', { params: yearParams(year) })) },
  async publisher(): Promise<PublisherDashboard> { return unwrap(await api.get('/finance/dashboards/publisher')) },
  async department(year?: string | null): Promise<DepartmentDashboard> { return unwrap(await api.get('/finance/dashboards/department', { params: yearParams(year) })) },
}

export const internalAuditApi = {
  async auditors(): Promise<{ id: string; name: string; role: string }[]> { return unwrap(await api.get('/finance/internal-audit/auditors')) },
  async engagements(params?: { financial_year_id?: string; status?: EngagementStatus }): Promise<AuditEngagement[]> {
    return unwrap(await api.get('/finance/internal-audit/engagements', { params }))
  },
  async createEngagement(body: EngagementBody): Promise<AuditEngagement> { return unwrap(await api.post('/finance/internal-audit/engagements', body)) },
  async updateEngagement(id: string, body: EngagementBody): Promise<AuditEngagement> { return unwrap(await api.patch(`/finance/internal-audit/engagements/${id}`, body)) },
  async findings(params?: { engagement_id?: string; risk?: FindingRisk; status?: 'open' | 'closed' | 'overdue' }): Promise<AuditFinding[]> {
    return unwrap(await api.get('/finance/internal-audit/findings', { params }))
  },
  async createFinding(body: FindingBody): Promise<AuditFinding> { return unwrap(await api.post('/finance/internal-audit/findings', body)) },
  async updateFinding(id: string, body: FindingBody): Promise<AuditFinding> { return unwrap(await api.patch(`/finance/internal-audit/findings/${id}`, body)) },
  async closeFinding(id: string, note: string): Promise<AuditFinding> {
    return unwrap(await api.patch(`/finance/internal-audit/findings/${id}`, { close: true, closure_note: note }))
  },
}
