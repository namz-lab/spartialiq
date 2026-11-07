// src/services/planWorkbench.ts
// ---------------------------------------------------------------------------
// Client for the plan workbench (/api/workbench): onboarding an authority and moving
// its plans from draft to gazetted.
//
// THE RULES LIVE IN THE DATABASE, NOT HERE
// What a sign-off means, which status steps are allowed, what freezes a plan and what a
// gazetting needs are enforced by the database (migration 150). This module holds none of
// that: it sends the request and surfaces the server's own words when a rule refuses it
// (a 409 with `message`). The screen therefore cannot drift from the rules.
import api from './api'

export type PlanStatus = 'unknown' | 'draft' | 'public_notice' | 'approved' | 'gazetted' | 'superseded'

export interface WorkbenchPlan {
  id: string
  title: string
  plan_type: string
  version: number
  status: PlanStatus
  is_template: boolean
  is_default_template: boolean
  authority_id: number | null
  authority_name: string | null
  profile_code: string
  zone_types: number
  land_uses: number
  decisions: number
  gazette_ref: string | null
  effective_from: string | null
  effective_to: string | null
  supersedes_id: string | null
  derived_from_id: string | null
  signoff_current: boolean
  last_signoff: { signer_name: string; signer_role: string | null; comment: string | null; signed_at: string } | null
  frozen: boolean
}

export interface PlanEvent {
  event_type: string
  actor_role: string | null
  actor_email: string | null
  detail: Record<string, unknown>
  at: string
}

export type ReviewStatus = 'unreviewed' | 'in_review' | 'reviewed'

/** One zone's column of the matrix, and where it stands in the council's review. */
export interface ZoneColumn {
  code: string
  name: string
  category: string | null
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  permitted: number
  special_consent: number
  prohibited: number
}

export interface PlanDetail {
  plan: WorkbenchPlan
  next_statuses: PlanStatus[]
  events: PlanEvent[]
  /** Absent from older servers. */
  zone_types?: ZoneColumn[]
}

export type FindingSeverity = 'error' | 'warning' | 'review'
export interface AuditFinding { severity: FindingSeverity; kind: string; zone_code: string | null; group_code: string | null; detail: string }
export interface PlanAudit { errors: number; warnings: number; reviews: number; findings: AuditFinding[] }

export interface ImportResult {
  applied: boolean
  summary: { rows: number; cells: number; inserts: number; updates: number; unchanged: number; undecided: number; errors: number }
  errors: string[]
  coverage: Array<{ zone: string; decided: number; missing: string[] }>
}

export interface AuthorityOption { id: number; code: string; name: string; kind: string }

/** A refusal from a database rule carries a readable `message`; anything else is generic. */
export function refusalMessage(err: unknown, fallback = 'That did not work. Try again.'): string {
  const data = (err as { response?: { status?: number; data?: { message?: string } } })?.response
  if (data?.status === 409 && data.data?.message) return data.data.message
  return fallback
}

export const STATUS_LABEL: Record<PlanStatus, string> = {
  unknown: 'Status not confirmed',
  draft: 'Draft',
  public_notice: 'Public notice',
  approved: 'Approved',
  gazetted: 'Gazetted',
  superseded: 'Superseded',
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  unreviewed: 'Not reviewed',
  in_review: 'In review',
  reviewed: 'Reviewed',
}

/** A cell of the printed matrix: null where nothing is decided. */
export interface GridCell { permission_code: 'P' | 'SC' | 'X'; control_type: string; conditions: string | null }
export interface MatrixGrid {
  zone_types: Array<{ code: string; label: string; order: number | null }>
  /** Land uses down; `cells` runs across the zone types in the same order as `zone_types`. */
  land_uses: Array<{ code: string; description: string; category: string | null; cells: Array<GridCell | null> }>
}

/** Council wording for each kind of audit finding: what it is, why it matters, what is asked of the council. */
export const FINDING_TEXT: Record<string, { title: string; why: string; ask: string }> = {
  residential_zone_without_dwellings: {
    title: 'A residential zone permits no dwelling',
    why: 'People could not build a house on land the plan calls residential. The column may be shifted against its heading, or entered wrongly.',
    ask: 'Confirm which kinds of dwelling each residential zone permits outright.',
  },
  near_identical_columns: {
    title: 'Two zones decide every use the same way',
    why: 'Two different zones with the same answers for every use suggests one was copied from the other rather than considered.',
    ask: 'Confirm the zones should be treated alike, or write each column on its own.',
  },
  default_fill: {
    title: 'A zone permits almost everything',
    why: 'A column that allows nearly every use, industry included, is usually a placeholder.',
    ask: 'Decide which uses the zone should permit outright, which by consent, and which not at all.',
  },
  no_decision: {
    title: 'Uses with no decision',
    why: 'Where nothing is decided the system answers "not decided", never "allowed", so the applicant gets no clear answer.',
    ask: 'Decide each blank as permitted, special consent or prohibited.',
  },
  sub_class_more_permissive_than_class: {
    title: 'A sub-class is permitted where its class is prohibited',
    why: 'For example a licensed residential building allowed in a zone where residential buildings are not.',
    ask: 'Confirm the exception is intended.',
  },
  special_consent_without_condition: {
    title: 'Special consent without conditions',
    why: 'An officer cannot tell what to assess, and an applicant cannot tell what to expect.',
    ask: 'Agree a standard set of conditions for each class of special consent.',
  },
  sub_class_without_class: {
    title: 'A sub-class whose class is missing',
    why: 'The schedule names a sub-class (such as L1) but the plan has no class above it (L). A use class may be missing.',
    ask: "Check the council's schedule of use classes.",
  },
}

/** The ordinary road a plan travels, for the progress strip. */
export const STATUS_CHAIN: PlanStatus[] = ['draft', 'public_notice', 'approved', 'gazetted']

export const wb = {
  async listPlans(): Promise<WorkbenchPlan[]> {
    const r = await api.get('/workbench/plans')
    return r.data.data
  },
  async getPlan(id: string): Promise<PlanDetail> {
    const r = await api.get(`/workbench/plans/${id}`)
    return r.data.data
  },
  async listAuthorities(): Promise<AuthorityOption[]> {
    const r = await api.get('/authorities')
    return (r.data.data as Array<{ id: number; code: string; name: string; kind: string }>).map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind }))
  },
  async addAuthority(body: { code: string; name: string; kind: 'rural' | 'urban' | 'combination'; type?: string; province?: string; members?: string[] }) {
    const r = await api.post('/workbench/authorities', body)
    return r.data.data as AuthorityOption
  },
  async adopt(body: { authority_id: number; title: string; plan_type?: string; profile?: 'rural' | 'urban'; template_id?: string }) {
    const r = await api.post('/workbench/plans/adopt', body)
    return r.data.data as { id: string }
  },
  async importSheet(id: string, csv: string, apply: boolean): Promise<ImportResult> {
    const r = await api.post(`/workbench/plans/${id}/matrix/import`, { csv, apply })
    return r.data.data
  },
  async signOff(id: string, comment?: string) {
    await api.post(`/workbench/plans/${id}/signoff`, { comment })
  },
  async setStatus(id: string, status: PlanStatus, extra: { gazette_ref?: string; effective_from?: string } = {}) {
    await api.post(`/workbench/plans/${id}/status`, { status, ...extra })
  },
  /** Findings about a plan's matrix to settle before it is trusted. Advisory: nothing is blocked. */
  async audit(id: string): Promise<PlanAudit> {
    const r = await api.get(`/workbench/plans/${id}/audit`)
    return r.data.data
  },
  /** A plan's whole matrix as the council prints it (land uses down, zones across). Follows plan visibility. */
  async matrixGrid(id: string): Promise<MatrixGrid> {
    const r = await api.get('/development-control/matrix/grid', { params: { plan: id } })
    return r.data.data
  },
  /** Record where one zone column stands in review. Marking it reviewed names the reviewer. */
  async reviewZone(id: string, code: string, status: ReviewStatus, reviewer?: string) {
    await api.post(`/workbench/plans/${id}/zone-types/${encodeURIComponent(code)}/review`, { status, reviewer })
  },
  async newVersion(id: string): Promise<{ id: string }> {
    const r = await api.post(`/workbench/plans/${id}/version`)
    return r.data.data
  },
}
