import api from './api'

export interface OpsSummary {
  roads: number
  wash: number
  livestock: number
  assets: number
}

export interface WashAsset {
  id: string
  asset_code: string | null
  asset_type: string
  name: string | null
  ward: string | null
  capacity: string | null
  operational: string | null
  lng: number | null
  lat: number | null
  data_quality: string
  source: string | null
}

export interface RoadAsset {
  id: string
  asset_code: string | null
  name: string | null
  hierarchy: string | null
  surface: string | null
  condition: string | null
  length_m: number | null
  ward: string | null
  status: string
  data_quality: string
  geometry?: unknown
}

export interface LivestockFacility {
  id: string
  facility_type: string
  name: string | null
  ward: string | null
  lng: number | null
  lat: number | null
  data_quality: string
  source: string | null
}

export interface MasterTheme {
  id: string
  theme: string
  department: string
  category: string
  layerIds: string[]
  layersPresent: string[]
  status: 'live' | 'schema_ready' | 'unavailable' | 'reference_osm' | 'partial'
  note: string
}

export const councilOpsApi = {
  async summary(): Promise<OpsSummary> {
    const r = await api.get('/ops/summary')
    return r.data?.data ?? r.data
  },
  async listRoads(params?: { search?: string; limit?: number }) {
    const r = await api.get('/ops/roads', { params })
    return { data: (r.data?.data ?? []) as RoadAsset[], meta: r.data?.meta }
  },
  async listWash(params?: { type?: string; search?: string; limit?: number }) {
    const r = await api.get('/ops/wash', { params })
    return { data: (r.data?.data ?? []) as WashAsset[], meta: r.data?.meta }
  },
  async listLivestock(params?: { search?: string; limit?: number }) {
    const r = await api.get('/ops/livestock', { params })
    return { data: (r.data?.data ?? []) as LivestockFacility[], meta: r.data?.meta }
  },
  async listAssets() {
    const r = await api.get('/ops/assets')
    return { data: r.data?.data ?? [], meta: r.data?.meta }
  },
  async masterThemes(): Promise<MasterTheme[]> {
    const r = await api.get('/ops/master-themes')
    return r.data?.data ?? []
  },
  async createWash(body: Partial<WashAsset> & { asset_type: string; lng?: number; lat?: number }) {
    const r = await api.post('/ops/wash', body)
    return r.data?.data
  },
  async importGeoJson(register: 'wash' | 'roads' | 'livestock' | 'assets', fc: unknown, dryRun = false) {
    const r = await api.post(`/ops/import/${register}`, fc, { params: { dry_run: dryRun ? 'true' : undefined } })
    return r.data
  },
}
