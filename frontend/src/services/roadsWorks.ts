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
