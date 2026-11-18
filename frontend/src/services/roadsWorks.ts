// The Department of Roads and Works in the planning workflow (backend src/routes/roads-works-referrals.js, migration 253):
// the cases circulated to Engineering, the department's reply with its assessment, and the assessment as the EO reads it.
import api from './api'

export type EngineeringResponse = 'no_objection' | 'conditional_approval' | 'objection'

export interface EngineeringReferral {
  id: string
  permit_app_id: string
  circulated_at: string | null
  response_due_at: string | null
  response_status: string
  response_received_at: string | null
  response_notes: string | null
  blocking: boolean | null
  priority: string | null
  overdue: boolean
  tpd_reference: string | null
  dev_register_no: string | null
  applicant_name: string
  stand_number: string | null
  suburb_ward: string | null
  development_type: string
  description: string | null
  case_status: string
  statutory_due_date: string | null
  near_state_road: boolean | null
  assessed: boolean
}

export interface CouncilRoad { id: string; asset_code: string; name: string | null; council_class: string | null; ward: string | null; length_m: number | null }

/** The infrastructure-cost test, Regional, Town and Country Planning Act s.26(5). */
export interface CostTest {
  roads: boolean | null; parking: boolean | null; drainage: boolean | null; sewerage: boolean | null; water: boolean | null
  estimated_cost?: number | null; currency?: 'USD' | 'ZWG'; condition?: string
}

export interface EngineeringReply {
  response_status: EngineeringResponse
  notes?: string
  cost: CostTest
  /** s.41: a subdivision's roads. */
  subdivision?: { road_reserves_adequate: boolean | null; widest_road_reserve_m?: number | null; new_road_length_m?: number | null }
  /** Roads Act: an access onto a council road. */
  access?: { road_asset_id?: string | null; approved?: boolean | null; conditions?: string }
}

export interface EngineeringAssessment {
  cost_roads: boolean | null; cost_parking: boolean | null; cost_drainage: boolean | null; cost_sewerage: boolean | null; cost_water: boolean | null
  estimated_cost: string | null; cost_currency: string | null; cost_condition: string | null
  road_reserves_adequate: boolean | null; widest_road_reserve_m: string | null; new_road_length_m: string | null
  access_approved: boolean | null; access_conditions: string | null
  access_road_code: string | null; access_road_name: string | null; access_road_class: string | null
  response_status: string; response_notes: string | null; response_received_at: string | null
  assessed_role: string | null; updated_at: string
}

export const roadsWorksApi = {
  async referrals(state: 'open' | 'answered' | 'all' = 'open'): Promise<{ referrals: EngineeringReferral[]; can_reply: boolean }> {
    return (await api.get('/roads-works/referrals', { params: { state } })).data.data
  },
  async councilRoads(q: string): Promise<CouncilRoad[]> {
    return (await api.get('/roads-works/council-roads', { params: { q } })).data.data
  },
  async reply(consultationId: string, body: EngineeringReply): Promise<{ flags: string[] }> {
    return (await api.post(`/roads-works/referrals/${encodeURIComponent(consultationId)}/reply`, body)).data.data
  },
  async assessment(permitId: string): Promise<EngineeringAssessment | null> {
    return (await api.get(`/permit-applications/${encodeURIComponent(permitId)}/engineering-assessment`)).data.data
  },
}

// ── The field survey, recorded in the registers (backend src/routes/roads-works-registers.js, migration 254) ──────────
export type SurveyRegister = 'road' | 'structure' | 'water_point' | 'council_asset'

export interface SurveyWords {
  surface: string[]; condition: string[]; building_condition: string[]; drainage: string[]
  council_class: string[]; structure_type: string[]; operational: string[]; pump_type: string[]
}

export interface RegisterSummary {
  roads: number; roads_surveyed: number; structures: number
  water_points: number; water_points_known: number; council_assets: number; council_assets_located: number
  wards: string[]
  can_write: Record<SurveyRegister, boolean>
  words: SurveyWords
}

export interface SurveyRoad {
  id: string; asset_code: string; name: string | null; hierarchy: string | null; council_class: string | null; ward: string | null
  length_m: number | null; surface: string | null; condition: string | null; width_m: number | null; drainage: string | null
  data_quality: string; surveyed_on: string | null
}
export interface SurveyStructure {
  id: string; structure_type: string; name: string | null; condition: string | null; span_m: number | null; ward: string | null
  surveyed_on: string | null; road_asset_id: string | null; road_code: string | null; road_name: string | null; lng: number | null; lat: number | null
}
export interface SurveyWaterPoint {
  id: string; asset_code: string; asset_type: string; name: string | null; ward: string | null; operational: string | null
  pump_type: string | null; yield_note: string | null; last_repaired_on: string | null; caretaker: string | null
  surveyed_on: string | null; lng: number | null; lat: number | null
}
export interface SurveyCouncilAsset {
  id: string; asset_code: string | null; name: string | null; asset_class: string | null; department: string | null
  condition: string | null; ward: string | null; surveyed_on: string | null; lng: number | null; lat: number | null
}
export interface SurveyLogLine {
  id: string; register: SurveyRegister; record_id: string; surveyed_on: string
  before: Record<string, unknown>; after: Record<string, unknown>; photo_ref: string | null; notes: string | null
  recorded_role: string | null; recorded_by_name: string | null; created_at: string
}
export interface Paged<T> { items: T[]; total: number; limit: number; offset: number }
export type ListFilter = { q?: string; ward?: string; state?: string; limit?: number; offset?: number }
/** Every entry names the day surveyed; a photo number and notes go in the log. */
export type SurveyEntry = { surveyed_on: string; photo_ref?: string; notes?: string } & Record<string, string | number | null | undefined>

export const surveyApi = {
  async summary(): Promise<RegisterSummary> { return (await api.get('/roads-works/registers')).data.data },
  async roads(f: ListFilter): Promise<Paged<SurveyRoad>> { return (await api.get('/roads-works/roads', { params: f })).data.data },
  async saveRoad(id: string, e: SurveyEntry): Promise<SurveyRoad> { return (await api.patch(`/roads-works/roads/${encodeURIComponent(id)}`, e)).data.data },
  async structures(): Promise<{ items: SurveyStructure[] }> { return (await api.get('/roads-works/structures')).data.data },
  async addStructure(e: SurveyEntry): Promise<SurveyStructure> { return (await api.post('/roads-works/structures', e)).data.data },
  async saveStructure(id: string, e: SurveyEntry): Promise<SurveyStructure> { return (await api.patch(`/roads-works/structures/${encodeURIComponent(id)}`, e)).data.data },
  async waterPoints(f: ListFilter): Promise<Paged<SurveyWaterPoint>> { return (await api.get('/roads-works/water-points', { params: f })).data.data },
  async saveWaterPoint(id: string, e: SurveyEntry): Promise<SurveyWaterPoint> { return (await api.patch(`/roads-works/water-points/${encodeURIComponent(id)}`, e)).data.data },
  async councilAssets(): Promise<{ items: SurveyCouncilAsset[] }> { return (await api.get('/roads-works/council-assets')).data.data },
  async saveCouncilAsset(id: string, e: SurveyEntry): Promise<SurveyCouncilAsset> { return (await api.patch(`/roads-works/council-assets/${encodeURIComponent(id)}`, e)).data.data },
  async log(register: SurveyRegister, recordId: string): Promise<SurveyLogLine[]> {
    return (await api.get('/roads-works/survey-log', { params: { register, record_id: recordId } })).data.data.items
  },
}
