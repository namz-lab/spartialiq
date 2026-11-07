/**
 * Stands service — typed wrapper over /api/stands.
 *
 * The list endpoint emits GeoJSON directly so MapLibre can consume it
 * with `addSource({ type: 'geojson', data })`. We expose the same shape.
 */

import api from './api'

export type StandStatus = 'available' | 'reserved' | 'allocated' | 'withdrawn'

export interface StandProperties {
  id:           string
  standNumber:  string
  ward:         string
  zoneId:       string | null
  zoneType:     string | null
  useScale:     string | null
  areaSqm:      number | null
  frontageM:    number | null
  depthM:       number | null
  priceUsd:     number | null
  status:       StandStatus
  description:  string | null
  centroid:     [number, number]
}

export interface StandFeature {
  type: 'Feature'
  id:   string
  geometry: GeoJSON.Polygon
  properties: StandProperties
}

export interface StandsCollection {
  type: 'FeatureCollection'
  features: StandFeature[]
}

export interface StandFilters {
  ward?:     string
  zoneType?: string
  q?:        string
  /** [minLng, minLat, maxLng, maxLat] */
  bbox?:     [number, number, number, number]
  /** Comma-separated list — defaults to 'available'. */
  status?:   StandStatus[] | StandStatus
}

export interface StandDetail extends StandProperties {
  reservedUntil: string | null
  allocatedAt:   string | null
  geometry:      GeoJSON.Polygon
  zone: {
    id: string
    name: string
    zoneType: string | null
    scaleCategory: string | null
    authority: string | null
    description: string | null
  } | null
  /** Pre-computed planning-assistant suggestion. */
  suggestedPlan: SuggestedPlan | null
}

export interface SuggestedPlan {
  found: boolean
  reason?: string
  stand?: {
    id: string
    standNumber: string
    ward: string
    areaSqm: number
    frontageM: number | null
  }
  zone?: {
    id: string
    name: string
    zoneType: string | null
    scaleCategory: string | null
    authority: string | null
    description: string | null
  }
  template?: PlanningTemplate | null
  permittedUses?: PermittedUseRow[]
  flags?: PlanningFlag[]
}

export interface PlanningTemplate {
  id:          string
  purpose:     string
  displayName: string
  description: string
  envelope: {
    minAreaSqm:         number | null
    maxAreaSqm:         number | null
    minFrontageM:       number | null
    maxPlotCoveragePct: number | null
    maxFloorAreaRatio:  number | null
    maxHeightM:         number | null
    maxStoreys:         number | null
    setbackFrontM:      number | null
    setbackRearM:       number | null
    setbackSideM:       number | null
  }
  maxBuildableFootprintSqm: number | null
  extras: Record<string, unknown>
  sourceCitation: string | null
}

export interface PermittedUseRow {
  groupCode: string
  groupName: string
  decision:  'permitted' | 'special_consent' | 'prohibited' | 'unknown'
  conditions: string | null
}

export interface PlanningFlag {
  severity: 'info' | 'warning' | 'error'
  code:     string
  message:  string
}

function buildQuery(filters: StandFilters | undefined): URLSearchParams {
  const qs = new URLSearchParams()
  if (!filters) return qs
  if (filters.ward)     qs.set('ward',     filters.ward)
  if (filters.zoneType) qs.set('zoneType', filters.zoneType)
  if (filters.q)        qs.set('q',        filters.q)
  if (filters.bbox && filters.bbox.length === 4) qs.set('bbox', filters.bbox.join(','))
  if (filters.status) {
    const s = Array.isArray(filters.status) ? filters.status.join(',') : filters.status
    qs.set('status', s)
  }
  return qs
}

export const standsService = {
  /** List stands as a GeoJSON FeatureCollection (default: status=available). */
  async list(filters?: StandFilters): Promise<StandsCollection> {
    const qs = buildQuery(filters)
    const url = `/stands${qs.toString() ? `?${qs.toString()}` : ''}`
    const response = await api.get<StandsCollection>(url)
    return response.data
  },

  async get(id: string): Promise<StandDetail> {
    const response = await api.get<{ success: boolean; data: StandDetail }>(`/stands/${id}`)
    return response.data.data
  },

  async reserve(id: string) {
    const response = await api.post(`/stands/${id}/reserve`)
    return response.data
  },

  async release(id: string) {
    const response = await api.post(`/stands/${id}/release`)
    return response.data
  },

  async create(payload: {
    standNumber: string
    ward: string
    zoneId?: string
    zoneType?: string
    useScale?: string
    frontageM?: number
    depthM?: number
    priceUsd?: number
    description?: string
    geometry: GeoJSON.Polygon
  }) {
    const response = await api.post<{ success: boolean; data: Pick<StandProperties, 'id' | 'standNumber' | 'ward' | 'status'> & { area_sqm: number } }>('/stands', payload)
    return response.data
  },

  async update(id: string, payload: Partial<Omit<StandProperties, 'id' | 'centroid' | 'areaSqm'>> & { geometry?: GeoJSON.Polygon }) {
    const response = await api.put<{ success: boolean; data: Pick<StandProperties, 'id' | 'standNumber' | 'ward' | 'status'> }>(`/stands/${id}`, payload)
    return response.data
  },

  async withdraw(id: string) {
    const response = await api.delete<{ success: boolean; data: Pick<StandProperties, 'id' | 'standNumber' | 'status'> }>(`/stands/${id}`)
    return response.data
  },
}
