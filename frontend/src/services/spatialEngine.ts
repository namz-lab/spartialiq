// The spatial engine's ward measures for the Chief Executive's maps (GET /api/executive/maps, accounting_officer only).
// The server computes the values and the classification; the map only draws what it is told, so the colours, the
// legend and the ranked list cannot disagree. See backend/src/routes/spatial-engine.js.
import api from './api'

export interface WardRegisterState {
  linked: boolean
  wards: number
  /** 'interim' while the Council has not confirmed its ward list (decision D11). */
  basis: string | null
  instrument_ref: string | null
}

export interface MeasureInfo {
  measure_key: string
  label: string
  description: string
  unit: string
  kind: 'share' | 'density' | 'rate'
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral'
  ramp: 'sequential' | 'diverging'
  owner_dept: string
  source_note: string
}

export interface MapsIndex {
  ward_register: WardRegisterState
  run: { id: string; computed_at: string; wards: number; ward_register_basis: string | null } | null
  measures: MeasureInfo[]
}

export type Reliability = 'ok' | 'small_base' | 'no_data'

export interface WardProperties {
  ward_code: string
  name: string
  /** The value to colour by: null for no data and for a small base. */
  value: number | null
  /** The computed value even when it is not classified (small base). */
  raw_value: number | null
  numerator: number | null
  denominator: number | null
  reliability: Reliability
  rank: number | null
  /** 0-based class, or null when the ward is not classified. */
  class_index: number | null
}

export interface WardFeature {
  type: 'Feature'
  geometry: GeoJSON.Geometry
  properties: WardProperties
}

export interface WardMap {
  measure: {
    key: string; label: string; description: string; unit: string; kind: MeasureInfo['kind']
    direction: MeasureInfo['direction']; ramp: MeasureInfo['ramp']; owner_dept: string; source_note: string
    min_denominator: number | null
  }
  ward_register: WardRegisterState
  /** 'ward_register_empty' (no wards linked) or 'not_computed' (the engine has not run); null when there is a map. */
  reason: 'ward_register_empty' | 'not_computed' | null
  classes: { method: 'quantile' | 'fixed'; breaks: number[]; classes: number } | null
  ranked?: number
  run: { computed_at: string; unlocated: number | null; facts: number | null } | null
  type?: 'FeatureCollection'
  features: WardFeature[]
}

export const spatialEngineApi = {
  async index(): Promise<MapsIndex> {
    const res = await api.get<{ success: boolean; data: MapsIndex }>('/executive/maps')
    return res.data.data
  },
  async map(measureKey: string): Promise<WardMap> {
    const res = await api.get<{ success: boolean; data: WardMap }>(`/executive/maps/${encodeURIComponent(measureKey)}`)
    return res.data.data
  },
}
