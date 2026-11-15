/**
 * Proposals to change stand boundaries — typed wrapper over /api/parcel-change-requests (migration 229).
 *
 * A stand is a parcel of the register, and its boundary changes only under an approved Survey Section import. An officer DRAWS a new stand,
 * a split, a merge or a boundary correction as a proposal; the Survey Section accepts it, surveys it, and the survey import closes it.
 */
import api from './api'

export type ChangeKind = 'new' | 'split' | 'merge' | 'reshape'
export type ChangeStatus = 'draft' | 'submitted' | 'accepted' | 'returned' | 'rejected' | 'withdrawn' | 'applied'
export type DecideAction = 'accept' | 'return' | 'reject'
type Area = GeoJSON.Polygon | GeoJSON.MultiPolygon

export interface ProposalItemInput {
  role: 'child' | 'revised'
  label?: string
  /** for a revised item, the stand whose boundary it replaces */
  parent_parcel_id?: string
  geometry: Area
}

export interface ProposalInput {
  kind: ChangeKind
  reason?: string | null
  parent_ids: string[]
  items: ProposalItemInput[]
}

export interface ProposalProblem { code: string; detail: Record<string, unknown> }

export interface ProposalSummary {
  id: string
  kind: ChangeKind
  status: ChangeStatus
  reason: string | null
  requested_by: string | null
  requested_by_name: string | null
  submitted_at: string | null
  decided_at: string | null
  survey_task_id: string | null
  general_plan_id: number | null
  created_at: string
  stands: string[] | null
  items: number
}

export interface Proposal extends Omit<ProposalSummary, 'stands' | 'items'> {
  decided_by: string | null
  decision_note: string | null
  parents: { parcel_id: string; stand_no: string; township_code: string | null; status: string; area_m2: string; geometry: Area }[]
  items: { seq: number; role: 'child' | 'revised'; label: string | null; parent_parcel_id: string | null; matched_parcel_id: string | null; area_m2: string; geometry: Area }[]
  problems: ProposalProblem[]
}

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: 'New stand', split: 'Split', merge: 'Merge', reshape: 'Boundary correction',
}

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: 'Draft', submitted: 'With the Survey Section', accepted: 'Accepted, awaiting survey',
  returned: 'Returned to you', rejected: 'Rejected', withdrawn: 'Withdrawn', applied: 'Applied to the register',
}

const PROBLEM_TEXT: Record<string, (d: any) => string> = {
  not_found: () => 'The proposal could not be found.',
  wrong_shape: (d) => `A ${d.kind} needs a different number of stands or boundaries (it has ${d.parents} stand(s), ${d.children} new and ${d.revised} revised).`,
  parent_not_current: (d) => `Stand ${d.stand_no} is no longer current.`,
  parent_not_a_stand: (d) => `${d.stand_no} is not a stand.`,
  parent_reserved_or_allocated: (d) => `Stand ${d.stand_no} is reserved or allocated: withdraw the reservation or allocation first.`,
  parent_in_open_request: () => 'Another proposal for this stand is already with the Survey Section.',
  invalid_geometry: (d) => `Boundary ${d.label || d.seq} is not a valid shape (${d.reason}).`,
  items_outside_parents: (d) => `The new boundaries go beyond the stand(s) by about ${d.mismatch_m2} m².`,
  parents_not_covered: (d) => `The new boundaries leave about ${d.mismatch_m2} m² of the stand(s) uncovered.`,
  items_overlap: (d) => `Two of the new boundaries overlap by about ${d.overlap_m2} m².`,
  overlaps_parcel: (d) => `A new boundary overlaps stand ${d.stand_no} by about ${d.overlap_m2} m².`,
  reshape_far_from_parent: () => 'The new boundary is too far from the stand it replaces.',
}

/** A problem in plain words, for the panel. */
export function describeProblem(p: ProposalProblem): string {
  const f = PROBLEM_TEXT[p.code]
  return f ? f(p.detail || {}) : `Problem: ${p.code}`
}

const unwrap = <T>(res: { data: { data: T } }): T => res.data.data

export const parcelChangeApi = {
  async list(params: { mine?: boolean; status?: ChangeStatus[] } = {}): Promise<ProposalSummary[]> {
    const q: Record<string, string> = {}
    if (params.mine) q.mine = '1'
    if (params.status?.length) q.status = params.status.join(',')
    return unwrap(await api.get('/parcel-change-requests', { params: q }))
  },
  async get(id: string): Promise<Proposal> { return unwrap(await api.get(`/parcel-change-requests/${id}`)) },
  async create(body: ProposalInput): Promise<Proposal> { return unwrap(await api.post('/parcel-change-requests', body)) },
  async update(id: string, body: ProposalInput): Promise<Proposal> { return unwrap(await api.put(`/parcel-change-requests/${id}`, body)) },
  async submit(id: string): Promise<Proposal> { return unwrap(await api.post(`/parcel-change-requests/${id}/submit`)) },
  async withdraw(id: string): Promise<Proposal> { return unwrap(await api.post(`/parcel-change-requests/${id}/withdraw`)) },
  async decide(id: string, action: DecideAction, note?: string): Promise<Proposal> {
    return unwrap(await api.post(`/parcel-change-requests/${id}/${action}`, { note }))
  },
  /** Cut a stand by a line: the pieces, west to east. */
  async splitGeometry(geometry: Area, blade: GeoJSON.LineString): Promise<Area[]> {
    return unwrap(await api.post('/parcel-change-requests/helpers/split', { geometry, blade }))
  },
  /** Join adjoining stands into one shape. */
  async mergeGeometries(geometries: Area[]): Promise<Area> {
    return unwrap(await api.post('/parcel-change-requests/helpers/merge', { geometries }))
  },
}

/** The message the server gave for a failed call, else a fallback. */
export function errorMessage(err: any, fallback: string): string {
  const d = err?.response?.data
  if (d?.problems?.length) return d.problems.map((p: ProposalProblem) => describeProblem(p)).join(' ')
  return d?.message ?? fallback
}
