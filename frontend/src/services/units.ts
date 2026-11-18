// Unit dashboards (GET /api/units...). The Chief Executive opens every unit; a unit head opens only their own, and the
// server refuses the rest (the router guard is a courtesy). The sections share their shapes with the overview, so a
// figure here and the same figure on the Chief Executive's page are the same read.
import api from './api'
import type {
  AuditSection, EngineeringSection, LandSection, PlanningSection, SectionState, SocialServicesSection,
} from './executiveOverview'
import type { MapsIndex, WardMap, WardTable } from './spatialEngine'

export type UnitKey = 'planning' | 'finance' | 'engineering' | 'social_admin' | 'audit'

export const UNIT_KEYS: UnitKey[] = ['finance', 'planning', 'engineering', 'social_admin', 'audit']

export interface UnitDesk { label: string; path: string }

export interface UnitSummary {
  key: UnitKey
  label: string
  /** The officer's post, as the Council names it. */
  post: string
  desks: UnitDesk[]
}

export interface UnitListItem extends UnitSummary {
  head: { title: string; holder_name: string | null; vacant: boolean } | null
  vacancies: number
}

export interface Post {
  id: string
  title: string
  system_role: string | null
  /** The unit's section the post belongs to (migration 249); null for the head and for undivided units. */
  section?: string | null
  reports_to?: string | null
  /** The post's grade on the council's establishment (migration 251). */
  grade?: number | null
  holder_name: string | null
  /** A post that needs a system account, with nobody holding it. */
  vacant: boolean
  /** A post for staff who do not sign in, with no holder recorded: listed, not counted as vacant. */
  holder_not_recorded?: boolean
  is_head: boolean
}

export interface UnitDashboard {
  unit: UnitSummary
  as_of: string
  head: Post | null
  establishment: { posts: Post[]; total: number; vacant: number }
  /** Keyed by section name: planning, land, engineering, social_services, hr, audit. A unit may carry several. */
  sections: {
    planning?: PlanningSection
    land?: LandSection
    engineering?: EngineeringSection
    social_services?: SocialServicesSection
    /** Always `loaded: false` while the system has no staff or payroll data. */
    hr?: SectionState
    audit?: AuditSection
  }
  maps: MapsIndex & { has_measures: boolean }
}

/** One ward across every measure, grouped by the unit that owns each (GET /api/executive/wards/:code). */
export interface WardProfileEntry {
  measure_key: string
  label: string
  unit: string
  kind: 'share' | 'density' | 'rate'
  direction: string
  unit_key: UnitKey | null
  owner_dept: string
  value: number | null
  raw_value: number | null
  numerator: number | null
  denominator: number | null
  reliability: 'ok' | 'small_base' | 'no_data'
  rank: number | null
  ranked: number
}
export interface WardProfile {
  ward: { ward_code: string; name: string; basis: string | null; area_km2: number | null }
  computed_at: string | null
  units: Record<string, WardProfileEntry[]>
}

export const unitsApi = {
  async wardTable(key: string): Promise<WardTable> {
    const res = await api.get<{ success: boolean; data: WardTable }>(`/units/${encodeURIComponent(key)}/ward-table`)
    return res.data.data
  },
  async list(): Promise<UnitListItem[]> {
    const res = await api.get<{ success: boolean; data: UnitListItem[] }>('/units')
    return res.data.data
  },
  async get(key: string): Promise<UnitDashboard> {
    const res = await api.get<{ success: boolean; data: UnitDashboard }>(`/units/${encodeURIComponent(key)}`)
    return res.data.data
  },
  async mapsIndex(key: string): Promise<MapsIndex> {
    const res = await api.get<{ success: boolean; data: MapsIndex }>(`/units/${encodeURIComponent(key)}/maps`)
    return res.data.data
  },
  async map(key: string, measureKey: string): Promise<WardMap> {
    const res = await api.get<{ success: boolean; data: WardMap }>(
      `/units/${encodeURIComponent(key)}/maps/${encodeURIComponent(measureKey)}`)
    return res.data.data
  },
}

// ── The Department of Roads and Works' plant register (backend migration 252) ─────────────────────
export type PlantStatus = 'working' | 'under_repair' | 'broken_down' | 'standby' | 'disposed'
export interface PlantItem {
  id: string
  plant_no: string
  kind: string
  description: string
  registration: string | null
  serial_no: string | null
  status: PlantStatus
  location: string | null
  hour_meter: string | number | null
  last_service_on: string | null
  next_service_hours: string | number | null
  notes: string | null
  operator_post: string | null
  hours_this_month: number | null
  fuel_this_month: number | null
  days_this_month: number
  last_worked_on: string | null
  last_job: string | null
  service_due: boolean
}
export interface PlantRegister {
  plant: PlantItem[]
  totals: { items: number; working: number; out_of_action: number; service_due: number }
  /** The District Engineer, the Civil Engineering Technician and the Foreman may write; the Chief Executive reads. */
  can_write: boolean
}
export interface PlantDay { worked_on?: string; hours?: number | null; fuel_litres?: number | null; hour_meter_end?: number | null; job?: string; operator_name?: string }

export const plantApi = {
  async list(): Promise<PlantRegister> {
    return (await api.get<{ success: boolean; data: PlantRegister }>('/units/engineering/plant')).data.data
  },
  async logDay(id: string, day: PlantDay): Promise<void> {
    await api.post(`/units/engineering/plant/${encodeURIComponent(id)}/log`, day)
  },
  async update(id: string, patch: { status?: PlantStatus; location?: string | null; last_service_on?: string | null; next_service_hours?: number | null; notes?: string | null }): Promise<void> {
    await api.patch(`/units/engineering/plant/${encodeURIComponent(id)}`, patch)
  },
}
