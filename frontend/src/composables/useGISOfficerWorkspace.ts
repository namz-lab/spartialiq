// ─── useGISOfficerWorkspace ─────────────────────────────────────────
// Active GIS Officer workspace state shared across the GIS Officer
// Portal sections. Mirrors useInspectionCase / useHealthCase /
// useCadastralCase patterns: provide at the shell, inject in every
// section.
//
// Persistence:
//   Tier 1 — dmApi for canonical permits + enforcement records
//            (read-only from this side).
//   Tier 2 — reactive in-memory state for the active layer / map request.
//   Tier 3 — localStorage for GIS-officer-only records:
//            map requests, data layer registry, data-quality checks.
// ───────────────────────────────────────────────────────────────────

import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'

// ── Map request register ─────────────────────────────────────────
export type MapRequestType =
  | 'site_context'       // EO planner needs site-context map for committee
  | 'abutting_owners'    // EO planner needs abutting-property notification list
  | 'enforcement'        // Building inspector needs enforcement location map
  | 'committee_bundle'   // Committee meeting maps
  | 'zoning_extract'     // Citizen / developer needs zoning extract
  | 'environmental'      // Environmental constraints check
  | 'other'

export interface MapRequest {
  id: string
  request_type: MapRequestType
  permit_application_id: string | null
  stand_number: string
  requested_by: string
  requested_at: string         // ISO
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  delivered_at: string | null  // ISO
  output_url: string
  notes: string
}

// ── Data layer registry ─────────────────────────────────────────
export type LayerCategory =
  | 'cadastral' | 'roads' | 'sewer' | 'water' | 'electricity'
  | 'land_use' | 'zoning' | 'permits' | 'enforcement' | 'wetlands'
  | 'watercourses' | 'sensitive_areas' | 'servitudes' | 'other'

export interface DataLayerRecord {
  id: string
  layer_name: string
  category: LayerCategory
  description: string
  feature_count: number
  last_updated_at: string      // ISO
  updated_by: string
  source: string               // e.g. 'Surveyor pegs · in-house', 'ZINWA shapefile 2024'
  coordinate_system: string    // e.g. 'Lo31', 'WGS84'
  is_public: boolean
  metadata_url: string
  notes: string
}

// ── Data quality check log ──────────────────────────────────────
export type QualityCheckType =
  | 'metadata' | 'completeness' | 'staleness' | 'coordinate_system'
  | 'topology' | 'attribute' | 'backup' | 'other'

export interface DataQualityCheck {
  id: string
  layer_id: string
  check_type: QualityCheckType
  checked_at: string
  checked_by: string
  result: 'pass' | 'warn' | 'fail'
  finding: string
  remediation: string
  resolved_at: string | null
}

// ── Case context ─────────────────────────────────────────────────
export interface GISOfficerWorkspaceContext {
  mapRequests: Ref<MapRequest[]>
  layers:      Ref<DataLayerRecord[]>
  qualityLog:  Ref<DataQualityCheck[]>
  pendingRequests: ComputedRef<MapRequest[]>
  staleLayers: ComputedRef<DataLayerRecord[]>
  dataQualityScore: ComputedRef<number>  // 0-100
  addRequest:     (r: Omit<MapRequest, 'id'>) => MapRequest
  updateRequest:  (id: string, patch: Partial<MapRequest>) => void
  upsertLayer:    (l: Omit<DataLayerRecord, 'id'> & { id?: string }) => DataLayerRecord
  removeLayer:    (id: string) => void
  logQuality:     (c: Omit<DataQualityCheck, 'id'>) => DataQualityCheck
  resolveQuality: (id: string) => void
  save:           () => void
}

const GIS_OFFICER_KEY: InjectionKey<GISOfficerWorkspaceContext> = Symbol('GISOfficerWorkspace')

const STORAGE_REQUESTS = 'gis_map_requests_v1'
const STORAGE_LAYERS   = 'gis_data_layers_v1'
const STORAGE_QUALITY  = 'gis_data_quality_v1'
const SAVE_DEBOUNCE_MS = 800

// Days before a layer counts as "stale"
const STALE_DAYS = 180

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
function safeWrite(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* no-op */ }
}
function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Seeded reference layers — what every Council GIS officer should
// have on the registry. New installs see a meaningful registry on
// day 1 rather than an empty list.
function seedLayers(): DataLayerRecord[] {
  const now = new Date().toISOString()
  const layers: Omit<DataLayerRecord, 'id'>[] = [
    { layer_name:'Stand boundaries (cadastral)', category:'cadastral',  description:'All registered stands with stand_no, area, owner',
      feature_count:0, last_updated_at:now, updated_by:'in-house surveyor',
      source:'Surveyor pegs · in-house cadastre', coordinate_system:'Lo31',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Road network',                category:'roads',      description:'Public roads, road reserves, ROW widths',
      feature_count:0, last_updated_at:now, updated_by:'engineering',
      source:'Engineering as-built surveys', coordinate_system:'Lo31',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Sewer network',               category:'sewer',      description:'Sewer mains, manholes, treatment',
      feature_count:0, last_updated_at:now, updated_by:'engineering',
      source:'Engineering as-built surveys', coordinate_system:'Lo31',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Water network',               category:'water',      description:'Water mains, valves, reservoirs',
      feature_count:0, last_updated_at:now, updated_by:'engineering',
      source:'ZINWA + Council', coordinate_system:'Lo31',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Electricity network',         category:'electricity',description:'HV / LV lines, transformers',
      feature_count:0, last_updated_at:now, updated_by:'ZESA liaison',
      source:'ZESA shapefile', coordinate_system:'Lo31',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Land use',                    category:'land_use',   description:'Current land-use polygons',
      feature_count:0, last_updated_at:now, updated_by:'planner',
      source:'Local Plan + permit history', coordinate_system:'Lo31',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Zoning',                      category:'zoning',     description:'Zoning classes per Local Plan',
      feature_count:0, last_updated_at:now, updated_by:'planner',
      source:'Local Plan', coordinate_system:'Lo31',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Permits (active)',            category:'permits',    description:'Active permit application locations',
      feature_count:0, last_updated_at:now, updated_by:'auto-sync · dmApi',
      source:'dmApi.permit_applications', coordinate_system:'WGS84',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Enforcement orders',          category:'enforcement',description:'Sec 32 / 34 enforcement locations',
      feature_count:0, last_updated_at:now, updated_by:'auto-sync · dmApi',
      source:'dmApi.enforcement_orders', coordinate_system:'WGS84',
      is_public:false, metadata_url:'', notes:'' },
    { layer_name:'Wetlands',                    category:'wetlands',   description:'EMA-designated wetlands',
      feature_count:0, last_updated_at:now, updated_by:'EMA liaison',
      source:'EMA shapefile', coordinate_system:'WGS84',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Watercourses',                category:'watercourses', description:'Rivers, streams, dam reservoirs',
      feature_count:0, last_updated_at:now, updated_by:'EMA liaison',
      source:'EMA + OSM', coordinate_system:'WGS84',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Sensitive areas',             category:'sensitive_areas', description:'Scenic-beauty areas (RTCP s.22), reserves',
      feature_count:0, last_updated_at:now, updated_by:'planner',
      source:'Council resolutions', coordinate_system:'Lo31',
      is_public:true, metadata_url:'', notes:'' },
    { layer_name:'Servitudes',                  category:'servitudes', description:'Registered servitudes (water, sewer, electricity, road)',
      feature_count:0, last_updated_at:now, updated_by:'surveyor',
      source:'Deeds Office + Surveyor', coordinate_system:'Lo31',
      is_public:false, metadata_url:'', notes:'' },
  ]
  return layers.map(l => ({ ...l, id: uid('lyr_') }))
}

export function provideGISOfficerWorkspace(): GISOfficerWorkspaceContext {
  const mapRequests = ref<MapRequest[]>(safeRead<MapRequest[]>(STORAGE_REQUESTS, []))
  const existingLayers = safeRead<DataLayerRecord[]>(STORAGE_LAYERS, [])
  const layers = ref<DataLayerRecord[]>(existingLayers.length ? existingLayers : seedLayers())
  if (!existingLayers.length) safeWrite(STORAGE_LAYERS, layers.value)
  const qualityLog = ref<DataQualityCheck[]>(safeRead<DataQualityCheck[]>(STORAGE_QUALITY, []))

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const pendingRequests = computed(() =>
    mapRequests.value.filter(r => r.status === 'pending' || r.status === 'in_progress'))

  const staleLayers = computed(() => {
    const cutoff = Date.now() - STALE_DAYS * 86_400_000
    return layers.value.filter(l => new Date(l.last_updated_at).getTime() < cutoff)
  })

  const dataQualityScore = computed(() => {
    if (!layers.value.length) return 100
    const total = layers.value.length
    const stalePenalty   = staleLayers.value.length * 5
    const openFailings   = qualityLog.value.filter(c => c.result === 'fail' && !c.resolved_at).length * 10
    const openWarnings   = qualityLog.value.filter(c => c.result === 'warn' && !c.resolved_at).length * 3
    const score = 100 - Math.round((stalePenalty + openFailings + openWarnings) / Math.max(1, total))
    return Math.max(0, Math.min(100, score))
  })

  function persistRequests() { safeWrite(STORAGE_REQUESTS, mapRequests.value) }
  function persistLayers()   { safeWrite(STORAGE_LAYERS,   layers.value) }
  function persistQuality()  { safeWrite(STORAGE_QUALITY,  qualityLog.value) }

  function addRequest(r: Omit<MapRequest, 'id'>): MapRequest {
    const rec: MapRequest = { ...r, id: uid('mr_') }
    mapRequests.value.unshift(rec)
    persistRequests()
    return rec
  }
  function updateRequest(id: string, patch: Partial<MapRequest>) {
    const idx = mapRequests.value.findIndex(r => r.id === id)
    if (idx >= 0) {
      mapRequests.value[idx] = { ...mapRequests.value[idx], ...patch }
      persistRequests()
    }
  }

  function upsertLayer(l: Omit<DataLayerRecord, 'id'> & { id?: string }): DataLayerRecord {
    if (l.id) {
      const idx = layers.value.findIndex(x => x.id === l.id)
      if (idx >= 0) {
        layers.value[idx] = { ...layers.value[idx], ...l } as DataLayerRecord
        persistLayers()
        return layers.value[idx]
      }
    }
    const rec: DataLayerRecord = { ...(l as Omit<DataLayerRecord, 'id'>), id: l.id ?? uid('lyr_') }
    layers.value.unshift(rec)
    persistLayers()
    return rec
  }

  function removeLayer(id: string) {
    layers.value = layers.value.filter(l => l.id !== id)
    persistLayers()
    qualityLog.value = qualityLog.value.filter(c => c.layer_id !== id)
    persistQuality()
  }

  function logQuality(c: Omit<DataQualityCheck, 'id'>): DataQualityCheck {
    const rec: DataQualityCheck = { ...c, id: uid('qc_') }
    qualityLog.value.unshift(rec)
    persistQuality()
    return rec
  }
  function resolveQuality(id: string) {
    const idx = qualityLog.value.findIndex(c => c.id === id)
    if (idx >= 0) {
      qualityLog.value[idx] = { ...qualityLog.value[idx], resolved_at: new Date().toISOString() }
      persistQuality()
    }
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persistRequests(); persistLayers(); persistQuality()
    }, SAVE_DEBOUNCE_MS)
  }

  const ctx: GISOfficerWorkspaceContext = {
    mapRequests, layers, qualityLog,
    pendingRequests, staleLayers, dataQualityScore,
    addRequest, updateRequest,
    upsertLayer, removeLayer,
    logQuality, resolveQuality,
    save,
  }
  provide(GIS_OFFICER_KEY, ctx)

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { if (saveTimer) clearTimeout(saveTimer) })
  }

  return ctx
}

export function useGISOfficerWorkspace(): GISOfficerWorkspaceContext {
  const ctx = inject(GIS_OFFICER_KEY)
  if (!ctx) throw new Error('useGISOfficerWorkspace() called outside <GISOfficerPortalView> tree')
  return ctx
}

export function useOrProvideGISOfficerWorkspace(): GISOfficerWorkspaceContext {
  const existing = inject(GIS_OFFICER_KEY, null)
  if (existing) return existing
  return provideGISOfficerWorkspace()
}

// ── Static reference: coordinate systems used at Vungu RDC ──────
export const GIS_COORD_SYSTEMS = [
  { code:'Lo31',    description:'Local rectangular coordinates, central meridian 31° E (Surveyor-General)' },
  { code:'Lo29',    description:'Local rectangular coordinates, central meridian 29° E' },
  { code:'WGS84',   description:'Geographic latitude / longitude (GPS / GNSS / OpenStreetMap)' },
  { code:'UTM-36S', description:'Universal Transverse Mercator, zone 36 South' },
] as const

// ── Static reference: layer-category descriptions ───────────────
export const LAYER_CATEGORY_LABELS: Record<LayerCategory, string> = {
  cadastral:        'Cadastral (stands, beacons)',
  roads:            'Roads & road reserves',
  sewer:            'Sewer network',
  water:            'Water network',
  electricity:      'Electricity network',
  land_use:         'Land use',
  zoning:           'Zoning',
  permits:          'Permit locations',
  enforcement:      'Enforcement locations',
  wetlands:         'Wetlands',
  watercourses:     'Watercourses',
  sensitive_areas:  'Sensitive / scenic areas',
  servitudes:       'Servitudes',
  other:            'Other',
}
