// The Chief Executive's overview (GET /api/executive/overview, accounting_officer only).
// One section per Executive Arm department. A section that has no data says so (`loaded: false`
// with a `note`) instead of reporting zeros; a section whose read failed says `unavailable`.
// Finance is read separately, from the existing executive finance dashboard.
import api from './api'

export interface SectionState {
  /** False when the department's register is empty: show `note`, not zeros. */
  loaded: boolean
  note?: string
  /** True when the read failed; distinct from "nothing there". */
  unavailable?: boolean
}

export interface PlanningSection extends SectionState {
  total?: number
  received_this_month?: number
  in_progress?: number
  /** Past the statutory due date with the clock still running. */
  overdue?: number
  awaiting_decision?: number
  approved_this_year?: number
  refused_this_year?: number
  upcoming_meetings?: number
  open_enforcement_orders?: number
  open_building_complaints?: number
}

export interface LandSection extends SectionState {
  parcels?: number
  parcels_with_account?: number
  /** Stands and farm parcels apart: every stand has a rates account and no farm parcel does, so one combined share reads as a gap that may not be one. */
  stands?: number
  stands_with_account?: number
  farms?: number
  farms_with_account?: number
  /** Stand outlines cut from a block rather than drawn (accuracy_basis 'estimated'). */
  estimated_boundaries?: number
}

export interface EngineeringSection extends SectionState {
  roads?: number
  road_km?: number
  /** Of the council's active roads, how many are map geometry only: not surveyed, no surface or condition. */
  roads_unverified?: number
  /** Roads that are not the council's (RIDA, the Ministry of Transport): shown apart, never added to the council's. */
  national_roads?: number
  national_road_km?: number
  water_points?: number
  /** Water points whose state (working, broken, seasonal) is recorded; the rest are 'unknown', never counted as broken. */
  water_points_state_known?: number
  water_points_working?: number
  /** Dams mapped (basemap.waterbody) and the water they cover, in hectares. */
  dams?: number
  dam_area_ha?: number
  /** False while the council has said its water-point register is incomplete: the figures are what is recorded, not what exists. */
  water_points_register_complete?: boolean
  water_points_expected?: number | null
  water_points_register_note?: string
  council_assets?: number
  fixed_assets?: number
  projects_in_progress?: number
}

export interface SocialServicesSection extends SectionState {
  premises?: number
  certificates_due_or_expired?: number
  open_nuisance_complaints?: number
}

export interface AuditSection extends SectionState {
  engagements?: number
  engagements_open?: number
  findings_open?: number
  findings_high_risk?: number
  actions_overdue?: number
}

export interface ExecutiveOverview {
  as_of: string
  planning: PlanningSection
  land: LandSection
  engineering: EngineeringSection
  social_services: SocialServicesSection
  /** Always `loaded: false` while the system has no staff or payroll data. */
  hr: SectionState
  audit: AuditSection
}

// ── The master plan (GET /api/executive/master-plan, accounting_officer only, read-only) ──
export interface MasterPlanStep { code: string; label: string; done: boolean; stale?: boolean; detail?: string | null }
export interface MasterPlanZone {
  zone: string; polygons: number; hectares: number; share_pct: number; parcels: number
  permitted: number; special_consent: number; prohibited: number; not_decided: number
  /** west, south, east, north */
  bbox: [number, number, number, number]
}
export interface KindCount { kind: string; n: number }
export interface MasterPlan {
  as_of: string
  /** Null when the council has no plan on record. */
  plan: null | {
    id: string; title: string; version: number; status: string; authority: string | null
    revision_label: string | null; revision_date: string | null; map_scale: number | null
    gazette_ref: string | null; effective_from: string | null; in_force: boolean; provisional: boolean
  }
  adoption?: { formal: boolean; steps: MasterPlanStep[]; done: number; of: number }
  decisions?: { uses_in_plan: number; decided: number; proposed: number; affirmed_for_testing: number; tested_on_affirmation: boolean }
  zones?: MasterPlanZone[]
  total_hectares?: number
  coverage?: { parcels: number; zoned: number; unzoned: number }
  applications?: { lodged_under_plan: number; decided: number; in_progress: number; departures: number; proposed_rule_accepted: number; decided_without_the_plan: number }
  held?: { facilities: KindCount[]; land_features: KindCount[]; targeted_farms: { targeted: number; linked: number }; retained_zones: number; railway_lines: number }
}

export const executiveApi = {
  async overview(): Promise<ExecutiveOverview> {
    const res = await api.get<{ success: boolean; data: ExecutiveOverview }>('/executive/overview')
    return res.data.data
  },
  async masterPlan(): Promise<MasterPlan> {
    const res = await api.get<{ success: boolean; data: MasterPlan }>('/executive/master-plan')
    return res.data.data
  },
}
