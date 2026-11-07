// Surveyor service — client for the dedicated /surveyor/* survey workflow
// (backend migration 080 + routes/surveyor.js). All data is real PostGIS-backed
// records; no mock fallbacks.
import api, { unwrapData } from './api'

export type SurveyTaskType =
  | 'verification' | 'setting_out' | 'pegging' | 'layout'
  | 'encroachment' | 'beacon_check' | 'general'
export type SurveyTaskStatus =
  | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'returned' | 'cancelled'
export type SurveyRecommendation =
  | 'no_objection' | 'objection' | 'approve' | 'approve_conditions' | 'refuse' | 'refer_back'

// Row shape from spatial_planning.v_survey_task — the survey task joined with
// the citizen application context (so the surveyor reads the application
// THROUGH the task without a broad permit-read grant).
export interface SurveyTask {
  id: string
  permit_app_id: string | null
  task_type: SurveyTaskType
  stand_number: string | null
  suburb_ward: string | null
  gauss_lo: 25 | 27 | 29 | 31 | 33
  lng: number | null
  lat: number | null
  instructions: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_date: string | null
  status: SurveyTaskStatus
  assigned_by: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
  // joined citizen-application context
  applicant_name: string | null
  applicant_phone: string | null
  applicant_email: string | null
  development_type: string | null
  application_description: string | null
  application_status: string | null
  site_plan_url: string | null
  dev_register_no: string | null
  tpd_reference: string | null
  finding_count: number
}

export interface SurveyFinding {
  id: string
  survey_task_id: string
  summary: string
  recommendation: SurveyRecommendation | null
  conditions: string | null
  notes: string | null
  submitted_by: string | null
  submitted_at: string
  created_at: string
}

export interface SurveyCoordinate {
  id: string
  survey_task_id: string
  label: string | null
  coord_system: 'WGS84' | 'Lo31' | 'Lo29' | 'UTM35S' | 'other'
  easting: number | null
  northing: number | null
  longitude: number | null
  latitude: number | null
  elevation: number | null
  notes: string | null
  recorded_by: string | null
  recorded_at: string
}

export interface SurveyBeacon {
  id: string
  survey_task_id: string
  corner_label: string | null
  beacon_type: 'iron_peg' | 'concrete_beacon' | 'survey_nail' | 'witness_beacon'
  easting: number | null
  northing: number | null
  status: 'intact' | 'missing' | 'damaged' | 'replaced'
  notes: string | null
  recorded_by: string | null
  recorded_at: string
}

export interface SurveyComment {
  id: string
  survey_task_id: string
  author_id: string | null
  author_role: string | null
  audience: 'planner' | 'eo' | 'surveyor' | 'citizen' | 'all'
  body: string
  created_at: string
}

export interface SurveyTaskDetail extends SurveyTask {
  findings: SurveyFinding[]
  coordinates: SurveyCoordinate[]
  beacons: SurveyBeacon[]
  comments: SurveyComment[]
}

// COGO (coordinate geometry) — stateless calculators over Zimbabwe P(Y,X)
// south-oriented cadastral coordinates. Backend: src/routes/surveyorCompute.js.
export interface CogoPoint { y: number; x: number }

export interface CogoAreaResult {
  area: { abs_m2: number; meters_rounded: number; hectares_rounded: number
    display: { hectares?: number; square_meters?: number; unit: string } }
  centroid: CogoPoint
  edges: Array<{ index: number; distance: number; distanceRounded: number
    bearingDeg: number; bearingRoundedDeg: number; directionDMS: string }>
  closure: { perimeter: number; error: number; ratio: number; ratioFormatted: string }
}

// National control-point registry (migration 098).
export interface ControlPoint {
  id: number
  monu_num: string
  monu_name: string
  type: 'PRIM' | 'SEC' | 'TERT' | 'QUART'
  gauss_lo: 25 | 27 | 29 | 31 | 33 | null
  y_gauss: number | null
  x_gauss: number | null
  msl_hgt: number | null
  created_at: string
}

// Cadastral parcel tied to a survey_task (migration 099). Area/closure are
// always server-computed — see src/routes/surveyor.js.
export interface SurveyParcel {
  id: string
  survey_task_id: string
  points: CogoPoint[]
  area_m2: number
  perimeter_m: number
  closure_error_m: number
  closure_ratio: string | null
  status: 'draft' | 'finalized' | 'approved'
  created_by: string | null
  created_at: string
}

// Generated DSG certificate / Report on Survey (migration 100).
export interface SurveyDocument {
  id: string
  survey_task_id: string
  doc_type: 'dsg_certificate' | 'report_on_survey'
  title: string
  content: string
  generated_by: string | null
  created_at: string
}

export const surveyorComputeApi = {
  async polar(payload: { y: number; x: number; distance: number; bearingDeg: number }): Promise<CogoPoint> {
    const r = await api.post('/surveyor/compute/polar', payload)
    return unwrapData<{ point: CogoPoint }>(r).point
  },
  async bearingBearingIntersection(
    p1: { y: number; x: number; bearingDeg: number },
    p2: { y: number; x: number; bearingDeg: number },
  ): Promise<CogoPoint> {
    const r = await api.post('/surveyor/compute/intersections/bearing-bearing', { p1, p2 })
    return unwrapData<{ point: CogoPoint }>(r).point
  },
  async area(points: CogoPoint[]): Promise<CogoAreaResult> {
    const r = await api.post('/surveyor/compute/area', { points })
    return unwrapData<CogoAreaResult>(r)
  },
}

export const controlPointsApi = {
  async list(q?: string): Promise<ControlPoint[]> {
    const r = await api.get('/surveyor/control-points', { params: { q } })
    return unwrapData<ControlPoint[]>(r) ?? []
  },
  async add(payload: {
    monu_num: string; monu_name: string; type?: ControlPoint['type']
    gauss_lo?: number; y_gauss?: number; x_gauss?: number; msl_hgt?: number
  }): Promise<ControlPoint> {
    const r = await api.post('/surveyor/control-points', payload)
    return unwrapData<ControlPoint>(r)
  },
}

export const surveyorApi = {
  async listJobs(params?: { status?: string; ward?: string }): Promise<SurveyTask[]> {
    const r = await api.get('/surveyor/jobs', { params })
    return unwrapData<SurveyTask[]>(r) ?? []
  },
  async getJob(id: string): Promise<SurveyTaskDetail> {
    const r = await api.get(`/surveyor/jobs/${id}`)
    return unwrapData<SurveyTaskDetail>(r)
  },
  // Planner / EO assigns a survey task (the cross-role connection).
  async assignJob(payload: {
    permit_app_id?: string; task_type?: SurveyTaskType; stand_number?: string
    suburb_ward?: string; instructions?: string; priority?: string
    due_date?: string; assigned_to?: string; lng?: number; lat?: number
  }): Promise<SurveyTask> {
    const r = await api.post('/surveyor/jobs', payload)
    return unwrapData<SurveyTask>(r)
  },
  async updateJob(id: string, payload: { status?: SurveyTaskStatus; claim?: boolean; gauss_lo?: number; assigned_to?: string | null }): Promise<SurveyTask> {
    const r = await api.patch(`/surveyor/jobs/${id}`, payload)
    return unwrapData<SurveyTask>(r)
  },
  // Open the job in SurveyPro: VunGIS signs a short-lived, single-use token and returns the URL that carries it. Only the surveyor the job is
  // assigned to may launch it; SurveyPro finds the surveyor by email and checks their appointment with this job's council.
  async launchInSurveyPro(id: string): Promise<{ url: string; expires_at: string; authority_code: string }> {
    const r = await api.post(`/surveyor/jobs/${id}/launch`)
    return unwrapData<{ url: string; expires_at: string; authority_code: string }>(r)
  },
  async submitFinding(id: string, payload: {
    summary: string; recommendation?: SurveyRecommendation; conditions?: string; notes?: string
  }): Promise<SurveyFinding> {
    const r = await api.post(`/surveyor/jobs/${id}/findings`, payload)
    return unwrapData<SurveyFinding>(r)
  },
  async addCoordinate(id: string, payload: Partial<SurveyCoordinate>): Promise<SurveyCoordinate> {
    const r = await api.post(`/surveyor/jobs/${id}/coordinates`, payload)
    return unwrapData<SurveyCoordinate>(r)
  },
  async addBeacon(id: string, payload: Partial<SurveyBeacon>): Promise<SurveyBeacon> {
    const r = await api.post(`/surveyor/jobs/${id}/beacons`, payload)
    return unwrapData<SurveyBeacon>(r)
  },
  async addComment(id: string, payload: { body: string; audience?: SurveyComment['audience'] }): Promise<SurveyComment> {
    const r = await api.post(`/surveyor/jobs/${id}/comments`, payload)
    return unwrapData<SurveyComment>(r)
  },
  async listParcels(id: string): Promise<SurveyParcel[]> {
    const r = await api.get(`/surveyor/jobs/${id}/parcels`)
    return unwrapData<SurveyParcel[]>(r) ?? []
  },
  async addParcel(id: string, points: CogoPoint[]): Promise<SurveyParcel> {
    const r = await api.post(`/surveyor/jobs/${id}/parcels`, { points })
    return unwrapData<SurveyParcel>(r)
  },
  async listJobControlPoints(id: string): Promise<ControlPoint[]> {
    const r = await api.get(`/surveyor/jobs/${id}/control-points`)
    return unwrapData<ControlPoint[]>(r) ?? []
  },
  async attachControlPoint(id: string, controlPointId: number): Promise<void> {
    await api.post(`/surveyor/jobs/${id}/control-points`, { control_point_id: controlPointId })
  },
  async listDocuments(id: string): Promise<SurveyDocument[]> {
    const r = await api.get(`/surveyor/jobs/${id}/documents`)
    return unwrapData<SurveyDocument[]>(r) ?? []
  },
  async addDocument(id: string, payload: { doc_type: SurveyDocument['doc_type']; title: string; content: string }): Promise<SurveyDocument> {
    const r = await api.post(`/surveyor/jobs/${id}/documents`, payload)
    return unwrapData<SurveyDocument>(r)
  },
  // Planner / EO: survey tasks + findings for an application.
  async applicationTasks(permitId: string): Promise<Array<SurveyTask & { findings: SurveyFinding[] | null }>> {
    const r = await api.get(`/permit-applications/${permitId}/survey-tasks`)
    return unwrapData<Array<SurveyTask & { findings: SurveyFinding[] | null }>>(r) ?? []
  },
}
