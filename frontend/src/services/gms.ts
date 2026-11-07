// src/services/gms.ts
// ---------------------------------------------------------------------------
// Client for the GIS Management System, phase 1: the parcel register and the
// ERP integration console. Backend: src/routes/gms.js and
// src/routes/gms-integration.js (migration 132).
//
// The ERP owns money. Nothing here carries an amount: a parcel shows a status
// band and a link out to the ERP.
// ---------------------------------------------------------------------------
import api from './api'
import type { Role } from './types'

export type StatusBand = 'current' | 'in_arrears' | 'no_account' | 'closed' | 'unknown'
export type AccuracyClass = 'A' | 'B' | 'C' | 'D'

export interface ParcelRow {
  parcel_id: string
  stand_no: string
  township_code: string
  ward_code: string | null
  area_m2: number
  accuracy_class: AccuracyClass
  status: 'current' | 'legacy' | 'retired'
  allocation_status: 'unallocated' | 'allocated'
  sg_ref: string | null
  accounts: number
  status_band: StatusBand
}

export interface ParcelProfile extends Omit<ParcelRow, 'accounts'> {
  ward_name: string | null
  area_ha: number
  source: string
  custodian_dept: string
  valid_from: string
  valid_to: string | null
  source_crs: string
  transform_method: string | null
  transform_accuracy_m: number | null
  geometry: GeoJSON.MultiPolygon
  general_plan_ref: string | null
  general_plan_imported_at: string | null
  accounts: { erp_account_no: string; link_type: string; linked_on: string; status_band: StatusBand; as_at: string | null; erp_url: string | null }[]
  buildings: { building_id: string; use: string | null; storeys: number | null; completion_date: string | null; source: string; accuracy_class: AccuracyClass }[]
  lineage: { parents: LineageLink[]; children: LineageLink[] }
}
interface LineageLink { parcel_id: string; event: string; event_date: string }

export interface Dashboard {
  parcels: number
  parcels_linked: number
  linked_share: number | null
  failed_events: number
  pending_events: number
  open_reconciliation: number
}

export type EventStatus = 'pending' | 'sent' | 'acknowledged' | 'failed' | 'cancelled'
export interface OutboxEvent {
  event_id: string
  type: string
  version: number
  occurred_at: string
  source: string
  idempotency_key: string
  status: EventStatus
  attempts: number
  next_attempt_at: string
  last_error: string | null
  acknowledged_at: string | null
  payload?: Record<string, unknown>
  reply?: unknown
}

export interface IntegrationStatus {
  adapter: string
  last_acknowledged_at: string | null
  last_inbound_at: string | null
  last_reconciliation_at: string | null
  queue_depth: number
  failed: number
  error_rate_24h: number
  reconciliation_open: Record<string, number>
}

export type ReconKind =
  | 'structure_no_account' | 'account_no_parcel' | 'account_on_retired_parcel'
  | 'duplicate_stand_no' | 'area_mismatch' | 'asset_no_erp_number'
export interface ReconItem {
  id: number
  kind: ReconKind
  ref_key: string
  detail: Record<string, any>
  status: 'open' | 'resolved'
  assigned_to: string | null
  resolution_note: string | null
  resolved_by_email: string | null
  resolved_at: string | null
  first_seen_at: string
}

// The SurveyPro importer's schedule and runs (integration console). Councils are named, never addressed: no connection string reaches the browser.
export type SurveyProRunStatus = 'running' | 'ok' | 'attention' | 'failed'
export interface SurveyProRun {
  id: number; started_at: string; finished_at: string | null; trigger: 'schedule' | 'manual' | 'cli'; applied: boolean
  status: SurveyProRunStatus; councils: number; totals: Partial<Record<'statuses' | 'imported' | 'unchanged' | 'diverged' | 'errors' | 'warnings', number>>; error: string | null
}
export interface SurveyProImports {
  scheduled: boolean; interval_minutes: number | null; applies: boolean; councils: string[]; misconfigured: string | null
  last_run: { id: number; started_at: string; status: SurveyProRunStatus } | null; last_ok_at: string | null; runs: SurveyProRun[]
}
export interface SurveyProRunCouncil {
  council: string; failed?: string
  projects?: Array<{ project: number; name: string; failed?: string; imported?: { stand: string; parcel_id: string }[]; diverged?: { stand: string; parcel_id: string }[]
    errors?: { code: string; stand?: string }[]; warnings?: { code: string; stand?: string }[]; status?: { job?: string; from?: string; to?: string; error?: string } | null }>
}
export interface SurveyProRunDetail extends SurveyProRun { report: SurveyProRunCouncil[] }

export interface ImportIssue {
  code: string; feature?: number; stand_no?: string; stand_nos?: string[]; reason?: string; overlap_m2?: number; parcel_id?: string; geometry?: GeoJSON.Geometry
  // reconciliation with the council's own survey (boundary_differs, ambiguous_match, overlaps_authority_parcel)
  deviation_m?: number; tolerance_m?: number; parcel_ids?: string[]; parcel_stand_no?: string
  plan_geometry?: GeoJSON.Geometry; register_geometry?: GeoJSON.Geometry
}
export interface ImportOrphan { parcel_id: string; stand_no: string | null; parcel_kind: string; township_code: string | null }
export interface ImportAdoption { idx: number; parcel_id: string; matched_by: 'stand_no' | 'geometry'; deviation_m: number }
export interface ImportResult {
  ok: boolean
  committed: boolean
  report?: {
    source_crs: string; feature_count: number; transform_method: string | null; transform_accuracy_m: number; errors: ImportIssue[]
    // what the plan does to stands the council has already surveyed: new, adopted in place, in conflict, and the council's stands it does not mention
    summary?: { new: number; adopt: number; conflicts: number; orphans: number }
    adopt?: ImportAdoption[]
    orphans?: ImportOrphan[]
  }
  errors?: ImportIssue[]
  parcel_ids?: string[]
  adopted_ids?: string[]
}

/** Lo belts a survey import may arrive in (gis_ops.crs_registry). */
export const SURVEY_CRS = [
  { srid: 922027, code: 'Lo27' },
  { srid: 922029, code: 'Lo29' },
  { srid: 922031, code: 'Lo31' },
  { srid: 922033, code: 'Lo33' },
] as const

/** Mirrors src/services/gms/roles.js in the backend. Screens hide what the API would refuse. */
const HEAD: Role[] = ['gis_head', 'gis_officer']
export const GMS_CAN: Record<'view' | 'importSurvey' | 'integration' | 'integrationView' | 'editLayers' | 'approveQa', Role[]> = {
  view: [...HEAD, 'gis_data', 'gis_dev', 'gis_analyst', 'gis_tech', 'gis_clerk', 'dept_editor', 'dept_viewer'] as Role[],
  importSurvey: [...HEAD, 'gis_data'] as Role[],
  integration: [...HEAD, 'gis_data', 'gis_dev'] as Role[],
  integrationView: [...HEAD, 'gis_data', 'gis_dev', 'gis_analyst'] as Role[],
  editLayers: [...HEAD, 'gis_data', 'gis_analyst', 'gis_tech', 'dept_editor'] as Role[],
  approveQa: [...HEAD, 'gis_data'] as Role[],
}

export const RECON_LABEL: Record<ReconKind, string> = {
  structure_no_account: 'Structure, no ERP account',
  account_no_parcel: 'ERP account, no parcel',
  account_on_retired_parcel: 'Account on a retired parcel',
  duplicate_stand_no: 'Duplicate stand number',
  area_mismatch: 'Area differs from ERP',
  asset_no_erp_number: 'Asset without ERP number',
}

export const BAND_LABEL: Record<StatusBand, string> = {
  current: 'Current', in_arrears: 'In arrears', no_account: 'No account', closed: 'Closed', unknown: 'Not yet reported',
}

// ── Phase 2: layers, features, edit sessions, map support ────────────────

export interface LayerField {
  name: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean'
  required?: boolean
  domain?: (string | number)[]
  personal?: boolean
}
export type LayerGroup = 'Administrative' | 'Land & Cadastre' | 'Planning' | 'Revenue' | 'Infrastructure' | 'Social' | 'Environment' | 'Imagery'
export interface GmsLayer {
  layer_id: string
  title: string
  grp: LayerGroup
  geom_type: 'Point' | 'LineString' | 'Polygon'
  custodian_dept: string
  attributes: LayerField[]
  rules: { point_in_ward?: boolean; network?: boolean; no_overlap?: boolean }
  access_level: 'public' | 'internal' | 'restricted'
  editable: boolean
  can_edit: boolean
  features: number
}

export type Edit =
  | { op: 'create'; geometry: GeoJSON.Geometry; attrs: Record<string, unknown>; accuracy_class: AccuracyClass; source: string }
  | { op: 'update'; feature_id: number; base_version: number; geometry?: GeoJSON.Geometry; attrs?: Record<string, unknown>; accuracy_class?: AccuracyClass; source?: string }
  | { op: 'delete'; feature_id: number; base_version: number }

export type SessionStatus = 'open' | 'submitted' | 'approved' | 'rejected' | 'returned' | 'abandoned'
export interface EditSession {
  session_id: string
  layer_id: string
  user_id: string
  user_email: string
  user_name: string | null
  status: SessionStatus
  edits: Edit[]
  title: string | null
  submitted_at: string | null
  decided_by_email: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  updated_at: string
  layer?: GmsLayer
}
export interface SessionRow {
  session_id: string
  layer_id: string
  layer_title: string
  custodian_dept: string
  status: SessionStatus
  title: string | null
  edit_count: number
  submitted_at: string | null
  decided_at: string | null
  decision_note: string | null
  updated_at: string
  user_email: string
  user_name: string | null
}
export interface EditIssue {
  index?: number
  code: string
  field?: string
  problem?: string
  allowed?: unknown[]
  reason?: string
  expected?: string
  feature_id?: number
  with_index?: number | null
  with_feature?: number | null
  overlap_m2?: number
  geometry?: GeoJSON.Geometry
}

export interface FeatureVersion {
  version: number
  action: 'create' | 'update' | 'delete' | 'restore'
  attrs: Record<string, unknown>
  accuracy_class: AccuracyClass
  source: string
  changed_by: string | null
  changed_at: string
  note: string | null
  geometry: GeoJSON.Geometry
}
export interface FeatureDetail {
  feature_id: number
  layer_id: string
  attrs: Record<string, unknown>
  accuracy_class: AccuracyClass
  source: string
  custodian_dept: string
  version: number
  status: 'published' | 'retired'
  geometry: GeoJSON.Geometry
  layer: Pick<GmsLayer, 'layer_id' | 'title' | 'attributes' | 'custodian_dept'>
  versions: FeatureVersion[]
}

export interface CrsEntry { srid: number; code: string; name: string; proj4text: string; is_survey: boolean }
export interface SearchHit {
  kind: 'parcel' | 'account' | 'ward' | 'village' | 'feature' | 'coordinate'
  id: string
  layer_id?: string
  label: string
  detail: string
  center: [number, number]
  bbox?: [number, number, number, number] | null
}

export const ACCURACY_LABEL: Record<AccuracyClass, string> = {
  A: 'A — approved survey', B: 'B — GNSS, sub-metre', C: 'C — handheld GPS, 3–5 m', D: 'D — digitised',
}

/** MapLibre tile template for a GMS layer ('parcels' or a gis_ops layer id). */
export const gmsTileUrl = (layer: string) => `/api/gms/tiles/${encodeURIComponent(layer)}/{z}/{x}/{y}.pbf`
export const dxfUrl = (params: { layer: string; srid: number; township?: string }) => {
  const q = new URLSearchParams({ layer: params.layer, srid: String(params.srid) })
  if (params.township) q.set('township', params.township)
  return `/api/gms/export/dxf?${q}`
}

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data)
// 422 answers carry the validation errors: resolve them rather than throw.
const orIssues = { validateStatus: (s: number) => s === 200 || s === 422 }

export const gmsApi = {
  dashboard: () => data<Dashboard>(api.get('/gms/dashboard')),
  parcels: (params: { q?: string; stand_no?: string; township?: string; account?: string; ward?: string; limit?: number }) =>
    data<ParcelRow[]>(api.get('/parcels', { params })),
  parcel: (id: string) => data<ParcelProfile>(api.get(`/parcels/${encodeURIComponent(id)}`)),

  importGeneralPlan: (body: { sg_ref: string; township_code: string; source_srid: number; features: unknown[]; commit: boolean }) =>
    // 422 carries the validation report: resolve it rather than throw.
    api.post<ImportResult>('/gms/imports/general-plan', body, { validateStatus: (s) => s === 200 || s === 422 })
      .then((r) => r.data),

  status: () => data<IntegrationStatus>(api.get('/integration/status')),
  surveyproImports: () => data<SurveyProImports>(api.get('/integration/surveypro')),
  surveyproRun: (id: number) => data<SurveyProRunDetail>(api.get(`/integration/surveypro/runs/${id}`)),
  /** Run the importer now; a dry run unless apply is true. A 409 means another run is in progress. */
  runSurveyproImport: (apply: boolean) => data<{ id: number; status: SurveyProRunStatus; applied: boolean; totals: SurveyProRun['totals'] }>(api.post('/integration/surveypro/run', { apply })),
  events: (params: { status?: EventStatus; type?: string; limit?: number }) =>
    data<OutboxEvent[]>(api.get('/integration/events', { params })),
  event: (id: string) => data<OutboxEvent>(api.get(`/integration/events/${id}`)),
  retry: (id: string) => data<{ status: EventStatus; error?: string } | null>(api.post(`/integration/events/${id}/retry`)),
  cancel: (id: string) => api.post(`/integration/events/${id}/cancel`),

  reconciliation: (params: { kind?: ReconKind; status?: 'open' | 'resolved' }) =>
    data<ReconItem[]>(api.get('/integration/reconciliation', { params })),
  runReconciliation: () => data<{ counts: Record<string, number>; cleared: number }>(api.post('/integration/reconciliation/run')),
  assign: (id: number, assigned_to: string) => data<ReconItem>(api.post(`/integration/reconciliation/${id}/assign`, { assigned_to })),
  resolve: (id: number, note: string) => data<ReconItem>(api.post(`/integration/reconciliation/${id}/resolve`, { note })),

  layers: () => data<GmsLayer[]>(api.get('/gms/layers')),
  layerFeatures: (id: string, opts: { bbox?: number[]; accuracy?: AccuracyClass[] } = {}) =>
    api.get<GeoJSON.FeatureCollection & { truncated: boolean }>(`/gms/layers/${encodeURIComponent(id)}/features`, {
      params: { bbox: opts.bbox?.join(','), accuracy: opts.accuracy?.join(',') },
    }).then((r) => r.data),
  feature: (id: number) => data<FeatureDetail>(api.get(`/gms/features/${id}`)),
  restore: (id: number, version: number, reason: string) => api.post(`/gms/features/${id}/restore`, { version, reason }),
  crs: () => data<CrsEntry[]>(api.get('/gms/crs')),
  search: (q: string) => data<SearchHit[]>(api.get('/gms/search', { params: { q } })),

  openSession: (layer_id: string) => data<EditSession>(api.post('/gms/edit-sessions', { layer_id })),
  sessions: (scope: 'mine' | 'queue') => data<SessionRow[]>(api.get('/gms/edit-sessions', { params: { scope } })),
  session: (id: string) => data<EditSession>(api.get(`/gms/edit-sessions/${id}`)),
  saveEdits: (id: string, edits: Edit[], title?: string) =>
    data<{ updated_at: string }>(api.put(`/gms/edit-sessions/${id}/edits`, { edits, title })),
  validate: (id: string) => data<{ errors: EditIssue[] }>(api.post(`/gms/edit-sessions/${id}/validate`)),
  submit: (id: string) =>
    api.post<{ success: boolean; errors?: EditIssue[] }>(`/gms/edit-sessions/${id}/submit`, undefined, orIssues).then((r) => r.data),
  approve: (id: string) =>
    api.post<{ success: boolean; errors?: EditIssue[]; error?: string; message?: string }>(
      `/gms/edit-sessions/${id}/approve`, undefined, { validateStatus: (s) => [200, 403, 409, 422].includes(s) },
    ).then((r) => r.data),
  decide: (id: string, action: 'reject' | 'return', reason: string) => api.post(`/gms/edit-sessions/${id}/${action}`, { reason }),
  abandon: (id: string) => api.delete(`/gms/edit-sessions/${id}`),
  split: (geometry: GeoJSON.Geometry, blade: GeoJSON.Geometry) =>
    data<GeoJSON.Geometry[]>(api.post('/gms/geometry/split', { geometry, blade })),
  merge: (geometries: GeoJSON.Geometry[]) => data<GeoJSON.Geometry>(api.post('/gms/geometry/merge', { geometries })),
}
