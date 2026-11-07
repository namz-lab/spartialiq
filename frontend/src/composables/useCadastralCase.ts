// ─── useCadastralCase ──────────────────────────────────────────────
// Active Surveyor case file shared across the Surveyor Workspace
// sections. Mirrors usePlannerCase / useInspectionCase / useHealthCase:
// provide at the workspace, inject in every section.
//
// Persistence:
//   Tier 1 — dmApi for the existing permit/plan endpoints we already host.
//   Tier 2 — reactive in-memory state for the active sheet.
//   Tier 3 — localStorage for surveyor-only records (stand register,
//            beacons, layouts, servitudes, benchmarks, encroachments,
//            setting-out records). Debounced 800 ms.
// ───────────────────────────────────────────────────────────────────

import {
  ref, provide, inject, onScopeDispose, getCurrentScope,
  type InjectionKey, type Ref,
} from 'vue'

// ── Cadastral stand register ──────────────────────────────────────
export interface StandRecord {
  id: string
  stand_number: string
  suburb_ward: string
  title_deed_no: string
  area_sqm: number
  coordinates: string        // e.g. "Lo31: 123456.78 E, 987654.32 S" or "WGS84: -19.45, 29.83"
  diagram_sg_no: string      // Surveyor-General diagram approval number
  servitudes: string[]       // referenced ServitudeRecord ids
  pegs_intact: boolean
  last_pegged_at: string | null   // ISO
  notes: string
  created_at: string         // ISO
}

// ── Beacon (peg) register ─────────────────────────────────────────
export interface BeaconRecord {
  id: string
  stand_id: string
  corner_label: string       // e.g. "NE", "SW", "Bcn 1"
  beacon_type: 'iron_peg' | 'concrete_beacon' | 'survey_nail' | 'witness_beacon'
  easting: number | null
  northing: number | null
  status: 'intact' | 'missing' | 'damaged' | 'replaced'
  recorded_at: string        // ISO
  recorded_by: string
  notes: string
}

// ── Layout project register ───────────────────────────────────────
export interface LayoutProject {
  id: string
  layout_name: string
  parent_property: string
  ward: string
  parent_area_ha: number
  stands_planned: number
  status: 'pre_survey' | 'designed' | 'verified' | 'approved' | 'pegging' | 'completed'
  designer: string
  approved_by_dpp_at: string | null
  notes: string
  created_at: string
}

// ── Servitude register ────────────────────────────────────────────
export interface ServitudeRecord {
  id: string
  servitude_no: string
  servitude_type: 'water' | 'sewer' | 'electricity' | 'road' | 'access' | 'pipeline' | 'other'
  affecting_stand: string
  in_favour_of: string       // e.g. 'ZESA', 'ZINWA', 'neighbour stand 4521'
  width_m: number | null
  description: string
  registered_at: string      // ISO
  notes: string
}

// ── Benchmark register ────────────────────────────────────────────
export interface BenchmarkRecord {
  id: string
  bm_no: string
  location_description: string
  easting: number | null
  northing: number | null
  elevation_m: number | null
  reference_system: string   // e.g. 'Lo31', 'WGS84/UTM-36S'
  established_at: string     // ISO
  established_by: string
  notes: string
}

// ── Encroachment / boundary dispute case ──────────────────────────
export interface EncroachmentCase {
  id: string
  case_ref: string
  affected_stand: string
  ward: string
  encroacher_name: string
  encroachment_type: 'over_boundary' | 'on_servitude' | 'on_road_reserve'
                   | 'on_public_open_space' | 'on_council_land' | 'illegal_subdivision'
  area_encroached_sqm: number | null
  surveyed_at: string        // ISO
  surveyor_name: string
  evidence_summary: string
  status: 'documented' | 'reported' | 'enforcement_filed' | 'court' | 'resolved' | 'withdrawn'
  resolution_notes: string
  resolved_at: string | null
}

// ── Setting-out / construction-stage record ───────────────────────
export interface SettingOutRecord {
  id: string
  permit_application_id: string | null
  stand_number: string
  inspected_at: string       // ISO
  surveyor_name: string
  inside_boundaries: boolean
  building_lines_ok: boolean
  matches_site_plan: boolean
  levels_correct: boolean
  pegs_intact: boolean
  verdict: 'pass' | 'fail' | 'conditional'
  deviations_noted: string
}

// ── Case file ─────────────────────────────────────────────────────
export interface CadastralCase {
  standId: string | null
  stand: StandRecord | null
  lastEditedAt: string
}

export interface CadastralCaseContext {
  current: Ref<CadastralCase | null>
  stands: Ref<StandRecord[]>
  beacons: Ref<BeaconRecord[]>
  layouts: Ref<LayoutProject[]>
  servitudes: Ref<ServitudeRecord[]>
  benchmarks: Ref<BenchmarkRecord[]>
  encroachments: Ref<EncroachmentCase[]>
  settingOuts: Ref<SettingOutRecord[]>
  loadStand: (id: string) => void
  upsertStand:      (s: Omit<StandRecord, 'id' | 'created_at'> & { id?: string }) => StandRecord
  removeStand:      (id: string) => void
  addBeacon:        (b: Omit<BeaconRecord, 'id'>) => BeaconRecord
  updateBeacon:     (id: string, patch: Partial<BeaconRecord>) => void
  addLayout:        (l: Omit<LayoutProject, 'id' | 'created_at'>) => LayoutProject
  updateLayout:     (id: string, patch: Partial<LayoutProject>) => void
  addServitude:     (s: Omit<ServitudeRecord, 'id'>) => ServitudeRecord
  addBenchmark:     (b: Omit<BenchmarkRecord, 'id'>) => BenchmarkRecord
  addEncroachment:  (e: Omit<EncroachmentCase, 'id'>) => EncroachmentCase
  updateEncroachment: (id: string, patch: Partial<EncroachmentCase>) => void
  addSettingOut:    (s: Omit<SettingOutRecord, 'id'>) => SettingOutRecord
  save: () => void
  clear: () => void
}

const CAD_KEY: InjectionKey<CadastralCaseContext> = Symbol('CadastralCase')

const STORAGE_STANDS       = 'surveyor_stand_register_v1'
const STORAGE_BEACONS      = 'surveyor_beacons_v1'
const STORAGE_LAYOUTS      = 'surveyor_layouts_v1'
const STORAGE_SERVITUDES   = 'surveyor_servitudes_v1'
const STORAGE_BENCHMARKS   = 'surveyor_benchmarks_v1'
const STORAGE_ENCROACH     = 'surveyor_encroachments_v1'
const STORAGE_SETTING_OUTS = 'surveyor_settingouts_v1'
const STORAGE_CASE = (id: string | null) =>
  id ? `surveyor_case_${id}` : 'surveyor_case_new_draft'
const SAVE_DEBOUNCE_MS = 800

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

export function emptyCadastralCase(): CadastralCase {
  return {
    standId: null,
    stand: null,
    lastEditedAt: new Date().toISOString(),
  }
}

export function provideCadastralCase(): CadastralCaseContext {
  const current = ref<CadastralCase | null>(null)
  const stands        = ref<StandRecord[]>(safeRead<StandRecord[]>(STORAGE_STANDS, []))
  const beacons       = ref<BeaconRecord[]>(safeRead<BeaconRecord[]>(STORAGE_BEACONS, []))
  const layouts       = ref<LayoutProject[]>(safeRead<LayoutProject[]>(STORAGE_LAYOUTS, []))
  const servitudes    = ref<ServitudeRecord[]>(safeRead<ServitudeRecord[]>(STORAGE_SERVITUDES, []))
  const benchmarks    = ref<BenchmarkRecord[]>(safeRead<BenchmarkRecord[]>(STORAGE_BENCHMARKS, []))
  const encroachments = ref<EncroachmentCase[]>(safeRead<EncroachmentCase[]>(STORAGE_ENCROACH, []))
  const settingOuts   = ref<SettingOutRecord[]>(safeRead<SettingOutRecord[]>(STORAGE_SETTING_OUTS, []))

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function loadStand(id: string) {
    const reg = stands.value.find(s => s.id === id)
    const cached = safeRead<CadastralCase | null>(STORAGE_CASE(id), null)
    const base: CadastralCase = cached ?? emptyCadastralCase()
    base.standId = id
    base.stand = reg ?? base.stand
    current.value = base
    safeWrite(STORAGE_CASE(id), base)
  }

  function upsertStand(s: Omit<StandRecord, 'id' | 'created_at'> & { id?: string }): StandRecord {
    if (s.id) {
      const idx = stands.value.findIndex(r => r.id === s.id)
      if (idx >= 0) {
        stands.value[idx] = { ...stands.value[idx], ...s } as StandRecord
        safeWrite(STORAGE_STANDS, stands.value)
        return stands.value[idx]
      }
    }
    const rec: StandRecord = {
      ...(s as Omit<StandRecord, 'id' | 'created_at'>),
      id: s.id ?? uid('std_'),
      created_at: new Date().toISOString(),
    }
    stands.value.push(rec)
    safeWrite(STORAGE_STANDS, stands.value)
    return rec
  }

  function removeStand(id: string) {
    stands.value = stands.value.filter(s => s.id !== id)
    safeWrite(STORAGE_STANDS, stands.value)
    beacons.value = beacons.value.filter(b => b.stand_id !== id)
    safeWrite(STORAGE_BEACONS, beacons.value)
    if (current.value?.standId === id) current.value = null
  }

  function addBeacon(b: Omit<BeaconRecord, 'id'>): BeaconRecord {
    const rec: BeaconRecord = { ...b, id: uid('bcn_') }
    beacons.value.push(rec)
    safeWrite(STORAGE_BEACONS, beacons.value)
    const stand = stands.value.find(s => s.id === b.stand_id)
    if (stand && b.status === 'intact') {
      stand.last_pegged_at = b.recorded_at
      safeWrite(STORAGE_STANDS, stands.value)
    }
    return rec
  }
  function updateBeacon(id: string, patch: Partial<BeaconRecord>) {
    const idx = beacons.value.findIndex(b => b.id === id)
    if (idx >= 0) {
      beacons.value[idx] = { ...beacons.value[idx], ...patch }
      safeWrite(STORAGE_BEACONS, beacons.value)
    }
  }

  function addLayout(l: Omit<LayoutProject, 'id' | 'created_at'>): LayoutProject {
    const rec: LayoutProject = { ...l, id: uid('lay_'), created_at: new Date().toISOString() }
    layouts.value.unshift(rec)
    safeWrite(STORAGE_LAYOUTS, layouts.value)
    return rec
  }
  function updateLayout(id: string, patch: Partial<LayoutProject>) {
    const idx = layouts.value.findIndex(l => l.id === id)
    if (idx >= 0) {
      layouts.value[idx] = { ...layouts.value[idx], ...patch }
      safeWrite(STORAGE_LAYOUTS, layouts.value)
    }
  }

  function addServitude(s: Omit<ServitudeRecord, 'id'>): ServitudeRecord {
    const rec: ServitudeRecord = { ...s, id: uid('svt_') }
    servitudes.value.unshift(rec)
    safeWrite(STORAGE_SERVITUDES, servitudes.value)
    return rec
  }

  function addBenchmark(b: Omit<BenchmarkRecord, 'id'>): BenchmarkRecord {
    const rec: BenchmarkRecord = { ...b, id: uid('bm_') }
    benchmarks.value.unshift(rec)
    safeWrite(STORAGE_BENCHMARKS, benchmarks.value)
    return rec
  }

  function addEncroachment(e: Omit<EncroachmentCase, 'id'>): EncroachmentCase {
    const rec: EncroachmentCase = { ...e, id: uid('enc_') }
    encroachments.value.unshift(rec)
    safeWrite(STORAGE_ENCROACH, encroachments.value)
    return rec
  }
  function updateEncroachment(id: string, patch: Partial<EncroachmentCase>) {
    const idx = encroachments.value.findIndex(e => e.id === id)
    if (idx >= 0) {
      encroachments.value[idx] = { ...encroachments.value[idx], ...patch }
      safeWrite(STORAGE_ENCROACH, encroachments.value)
    }
  }

  function addSettingOut(s: Omit<SettingOutRecord, 'id'>): SettingOutRecord {
    const rec: SettingOutRecord = { ...s, id: uid('so_') }
    settingOuts.value.unshift(rec)
    safeWrite(STORAGE_SETTING_OUTS, settingOuts.value)
    return rec
  }

  function save() {
    if (!current.value) return
    current.value.lastEditedAt = new Date().toISOString()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (current.value) safeWrite(STORAGE_CASE(current.value.standId), current.value)
    }, SAVE_DEBOUNCE_MS)
  }
  function clear() { current.value = null }

  const ctx: CadastralCaseContext = {
    current, stands, beacons, layouts, servitudes, benchmarks, encroachments, settingOuts,
    loadStand, upsertStand, removeStand,
    addBeacon, updateBeacon,
    addLayout, updateLayout,
    addServitude,
    addBenchmark,
    addEncroachment, updateEncroachment,
    addSettingOut,
    save, clear,
  }
  provide(CAD_KEY, ctx)

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { if (saveTimer) clearTimeout(saveTimer) })
  }

  return ctx
}

export function useCadastralCase(): CadastralCaseContext {
  const ctx = inject(CAD_KEY)
  if (!ctx) throw new Error('useCadastralCase() called outside a workspace that provides it (see provideCadastralCase)')
  return ctx
}

export function useOrProvideCadastralCase(): CadastralCaseContext {
  const existing = inject(CAD_KEY, null)
  if (existing) return existing
  return provideCadastralCase()
}

// ── Building-line standards (residential default per the brief) ──
export interface BuildingLineRule { use: string; front: string; rear: string; sides: string }
export const BUILDING_LINES: BuildingLineRule[] = [
  { use: 'Residential (default)', front: '3 m', rear: '2 m', sides: '1 m (0.5 m where no openings)' },
  { use: 'Commercial',           front: 'as per layout', rear: 'as per layout', sides: 'party-wall or as per layout' },
  { use: 'Industrial',           front: '7.5 m', rear: '3 m',  sides: '3 m' },
]

// ── Minimum stand sizes (Minimum Housing Standards) ──────────────
export const MIN_STAND_SIZES = [
  { use: 'Residential', area: '150 m² minimum (Minimum Housing Standards)' },
  { use: 'Residential plinth', area: '50 m² minimum' },
  { use: 'School site', area: 'as per Department of Physical Planning Guidelines' },
  { use: 'Clinic site', area: 'as per Department of Physical Planning Guidelines' },
]

// ── Coordinate systems in use in Zimbabwe ────────────────────────
export const COORD_SYSTEMS = [
  { code: 'Lo31',         description: 'Local rectangular coordinates, central meridian 31° E (Surveyor-General)' },
  { code: 'Lo29',         description: 'Local rectangular coordinates, central meridian 29° E' },
  { code: 'WGS84',        description: 'Geographic latitude / longitude (GPS)' },
  { code: 'UTM-35S',      description: 'Universal Transverse Mercator, zone 35 South' },
  { code: 'UTM-36S',      description: 'Universal Transverse Mercator, zone 36 South' },
] as const

// ── Survey statutes & references ─────────────────────────────────
export interface SurveyStatute { ref: string; title: string; gist: string }
export const SURVEY_STATUTES: SurveyStatute[] = [
  { ref: 'LSA [Ch. 20:12]', title: 'Land Survey Act',
    gist: 'Governs cadastral surveys, beacon placement, diagram submission to the Surveyor-General, and registration of approved diagrams.' },
  { ref: 'DRA [Ch. 20:05]', title: 'Deeds Registries Act',
    gist: 'Registration of title deeds and endorsements; cross-references surveyed diagrams.' },
  { ref: 'RTCP [Ch. 29:12] s. 22', title: 'Scenic-beauty areas',
    gist: 'Areas designated for protection on scenic grounds — surveyor identifies extents on layouts and site plans.' },
  { ref: 'RTCP [Ch. 29:12] s. 32', title: 'Enforcement orders',
    gist: 'Surveyor provides surveyed evidence supporting enforcement orders for encroachments and illegal developments.' },
  { ref: 'RTCP [Ch. 29:12] s. 34', title: 'Prohibition orders',
    gist: 'Surveyor maps the extent of illegal developments for prosecution and demolition applications.' },
  { ref: 'MBL Sec 41', title: 'Building lines & setbacks',
    gist: 'Residential default front 7.5 m / side 3 m / rear 3 m unless varied; Surveyor confirms compliance on site plans.' },
]
