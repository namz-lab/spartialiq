// ─── useHealthCase ─────────────────────────────────────────────────
// Shared state for the Environmental Health Officer console. Mirrors
// usePlannerCase / useInspectionCase: provide at the workspace, inject in
// every section.
//
// What lives here, and why only this:
//   • The five field registers — premises, outbreaks, water samples,
//     nuisance complaints and premises inspections. These are written
//     standing in a premises on a rural connection, so they are
//     offline-first: the row shows at once, the server call follows, and a
//     row the server has not accepted is held and retried (see commit()).
//   • The plan-appraisal draft for the permit being appraised — a working
//     checklist until it is filed as a consultation response.
//   • The console summary counters the dashboard and the rail share.
//
// Office records — certificates, burial permits, licence clearances, field
// programmes — are fetched by the section that owns them, through
// ehoOpsApi, online only. They are issued at a desk, and a document the
// council has not actually recorded must never look issued.
// ───────────────────────────────────────────────────────────────────

import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'
import { ehoApi, type Position } from '@/services/environmentalHealth'
import {
  ehoOpsApi, type EhoSummary, type NewInspection, type PremisesInspection,
} from '@/services/environmentalHealthOps'

// ── Premises register ─────────────────────────────────────────────
export type PremisesType =
  | 'bakery' | 'butchery' | 'restaurant' | 'tea_room' | 'boarding_house'
  | 'hotel' | 'general_dealer' | 'bottle_store' | 'beerhall' | 'creche'
  | 'school' | 'hostel' | 'tuck_shop' | 'supermarket' | 'factory'
  | 'workshop' | 'nightclub' | 'lodge' | 'abattoir' | 'other'

/** Position is optional: a premises registered by phone has none until visited. */
export interface PremisesRecord extends Partial<Position> {
  id: string
  name: string
  type: PremisesType
  stand_number: string
  suburb_ward: string
  operator_name: string
  operator_contact: string
  permit_application_id: string | null
  created_at: string
  last_inspected_at: string | null
  fitness_certificate_no: string | null
  fitness_certificate_expiry: string | null
  notes: string
  /** Register reference (PR-2026-0001), assigned by the server. */
  reference?: string
  /** Written locally but not yet accepted by the server. Retried on load. */
  pendingSync?: boolean
}

// ── Plan appraisal (per Sec 2 of the brief) ───────────────────────
export interface PlanAppraisalCheck {
  // Ventilation
  windowArea10pct:        boolean
  windowsOpenable50pct:   boolean
  airBricksAdequate:      boolean
  crossVentilation:       boolean
  // Sanitation
  waterSupplyConnected:   boolean
  sewerOrSepticTank:      boolean
  wcRatio:                boolean
  genderSeparation:       boolean
  disabledAccess:         boolean
  refuseReceptacle:       boolean
  // Hygiene
  reticulatedWater:       boolean
  washBasinsPiped:        boolean
  imperviousSurfaces:     boolean
  // Floor area & construction
  minFloorAreaMet:        boolean
  wallsCompliant:         boolean
  floorCompliant:         boolean
  roofRainwaterOk:        boolean
  storeroomsRodentProof:  boolean
  // Verdict
  verdict: 'pending' | 'no_objection' | 'objection' | 'conditional'
  notes: string
  reviewedAt: string | null
  reviewedBy: string
  conditions: string
}

// ── Operational inspection of premises ────────────────────────────
// The record type is the server's (migration 122). A row written offline
// carries pendingSync and a local id until the server accepts it.
export type { InspectionVerdict } from '@/services/environmentalHealthOps'
export type InspectionRecord = PremisesInspection & { pendingSync?: boolean }

// ── Outbreak & disease surveillance ───────────────────────────────
export type NotifiableDisease =
  | 'cholera' | 'typhoid' | 'dysentery' | 'food_poisoning'
  | 'measles' | 'tb' | 'covid' | 'other'

export interface OutbreakCase {
  id: string
  disease: NotifiableDisease
  firstReportedAt: string
  suspectedSource: string
  casesCount: number
  ward: string
  status: 'investigating' | 'contained' | 'closed'
  actionsTaken: string
  closedAt: string | null
  /** Officer-recorded catchment radius in metres (migration 121). Drives the
   *  "what is inside this outbreak" query; null until the outbreak is placed. */
  catchmentM?: number | null
  reference?: string
  /** Written locally but not yet accepted by the server. Retried on load. */
  pendingSync?: boolean
}

// ── Water sample test ─────────────────────────────────────────────
export interface WaterSample {
  id: string
  sourceLabel: string  // e.g. 'Ward 3 borehole', 'Council reservoir'
  sampledAt: string
  ecoliCount: number | null      // CFU per 100 ml
  faecalColiform: number | null  // CFU per 100 ml
  freeChlorine: number | null    // mg/L
  ph: number | null
  result: 'potable' | 'not_potable' | 'borderline' | 'pending'
  actionsTaken: string
  sourceType?: 'borehole' | 'piped_supply' | 'reservoir' | 'well'
             | 'river' | 'dam' | 'spring' | 'other' | null
  reference?: string
  /** Written locally but not yet accepted by the server. Retried on load. */
  pendingSync?: boolean
}

// ── Nuisance / public-health complaint ────────────────────────────
export interface NuisanceComplaint {
  id: string
  receivedAt: string
  complainantName: string
  complainantContact: string
  category: 'smell' | 'smoke' | 'noise' | 'vermin' | 'waste' | 'water' | 'other'
  description: string
  premisesId: string | null
  status: 'open' | 'investigating' | 'abated' | 'closed'
  abatementNoticeRef: string | null
  /** An anonymous report is first-class and never carries contact details —
   *  the complainant has to go on living next to the person they reported. */
  anonymous?: boolean
  reference?: string
  /** Written locally but not yet accepted by the server. Retried on load. */
  pendingSync?: boolean
}

// ── Plan-appraisal draft ───────────────────────────────────────────
/** The plan-appraisal draft for one permit application. */
export interface HealthCase {
  permitId: string
  planAppraisal: PlanAppraisalCheck
  lastEditedAt: string
}

export type SyncState = 'idle' | 'loading' | 'offline'

export interface HealthCaseContext {
  current: Ref<HealthCase | null>
  registry: Ref<PremisesRecord[]>
  outbreaks: Ref<OutbreakCase[]>
  waterSamples: Ref<WaterSample[]>
  complaints: Ref<NuisanceComplaint[]>
  inspections: Ref<InspectionRecord[]>
  planAppraisalPassed: ComputedRef<boolean>
  /** Open (or resume) the appraisal draft for a permit application. */
  openAppraisal: (permitId: string) => void
  upsertPremises: (p: Omit<PremisesRecord, 'id' | 'created_at'> & { id?: string }) => PremisesRecord
  removePremises: (id: string) => void
  /** Record an inspection. Shows at once; syncs, or is held and retried. */
  recordInspection: (i: NewInspection) => InspectionRecord
  addOutbreak:   (o: Omit<OutbreakCase, 'id'>) => OutbreakCase
  updateOutbreak: (id: string, patch: Partial<OutbreakCase>) => void
  addSample:     (s: Omit<WaterSample, 'id'>) => WaterSample
  addComplaint:  (c: Omit<NuisanceComplaint, 'id'>) => NuisanceComplaint
  updateComplaint: (id: string, patch: Partial<NuisanceComplaint>) => void
  save: () => void
  clear: () => void
  /** 'loading' on first hydrate, 'offline' when the server could not be reached. */
  syncState: Ref<SyncState>
  /** Records written locally that the server has not accepted yet. */
  pendingCount: ComputedRef<number>
  /** Re-read the registers from the server and retry anything held locally. */
  refresh: () => Promise<void>
  /** Dashboard + rail counters, from one server request. Null until loaded. */
  summary: Ref<EhoSummary | null>
  refreshSummary: (cycleDays?: number) => Promise<void>
}

const HEALTH_CASE_KEY: InjectionKey<HealthCaseContext> = Symbol('HealthCase')

const STORAGE_REGISTRY_KEY  = 'eho_premises_register_v1'
const STORAGE_OUTBREAKS_KEY = 'eho_outbreaks_v1'
const STORAGE_SAMPLES_KEY   = 'eho_water_samples_v1'
const STORAGE_COMPLAINTS_KEY = 'eho_complaints_v1'
const STORAGE_INSPECTIONS_KEY = 'eho_inspections_v2'
// The key appraisal drafts were always written under, so an officer's
// half-finished appraisal survives this change.
const STORAGE_CASE_KEY = (permitId: string) => `eho_case_${permitId}`
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

/**
 * A row the server has accepted carries its UUID primary key. A row written
 * offline still carries the local `ob_`/`ws_`/`cp_`/`prem_`/`insp_` id, and
 * PATCHing that id would 400 — so an edit to an unsynced row stays local until
 * the create itself lands.
 */
export function isServerId(id: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
}

/**
 * Merge a fresh server list into a cached one.
 *
 * The server is the record, so its list replaces the cache — except for rows
 * still held locally (pendingSync), which have not reached it and would
 * otherwise vanish the moment the connection came back. A held row can carry a
 * SERVER id (an edit that failed); the server's copy of that row is dropped so
 * it does not show twice.
 */
export function mergeHeld<T extends { id: string; pendingSync?: boolean }>(cached: T[], fresh: T[]): T[] {
  const held = cached.filter(r => r.pendingSync)
  const heldIds = new Set(held.map(r => r.id))
  return [...held, ...fresh.filter(r => !heldIds.has(r.id))]
}

export function emptyAppraisal(): PlanAppraisalCheck {
  return {
    windowArea10pct: false, windowsOpenable50pct: false,
    airBricksAdequate: false, crossVentilation: false,
    waterSupplyConnected: false, sewerOrSepticTank: false,
    wcRatio: false, genderSeparation: false, disabledAccess: false,
    refuseReceptacle: false,
    reticulatedWater: false, washBasinsPiped: false, imperviousSurfaces: false,
    minFloorAreaMet: false, wallsCompliant: false, floorCompliant: false,
    roofRainwaterOk: false, storeroomsRodentProof: false,
    verdict: 'pending', notes: '', reviewedAt: null, reviewedBy: '', conditions: '',
  }
}

export function emptyHealthCase(permitId: string): HealthCase {
  return { permitId, planAppraisal: emptyAppraisal(), lastEditedAt: new Date().toISOString() }
}

export function provideHealthCase(): HealthCaseContext {
  const current = ref<HealthCase | null>(null)
  const registry  = ref<PremisesRecord[]>(safeRead<PremisesRecord[]>(STORAGE_REGISTRY_KEY, []))
  const outbreaks = ref<OutbreakCase[]>(safeRead<OutbreakCase[]>(STORAGE_OUTBREAKS_KEY, []))
  const waterSamples = ref<WaterSample[]>(safeRead<WaterSample[]>(STORAGE_SAMPLES_KEY, []))
  const complaints   = ref<NuisanceComplaint[]>(safeRead<NuisanceComplaint[]>(STORAGE_COMPLAINTS_KEY, []))
  const inspections  = ref<InspectionRecord[]>(safeRead<InspectionRecord[]>(STORAGE_INSPECTIONS_KEY, []))
  const summary = ref<EhoSummary | null>(null)

  // The registers open from the offline cache so the console is usable at
  // once, then hydrate from the server. 'offline' is a visible state, never a
  // silently empty register.
  const syncState = ref<SyncState>('idle')
  const pendingCount = computed(() =>
    registry.value.filter(r => r.pendingSync).length
    + outbreaks.value.filter(r => r.pendingSync).length
    + waterSamples.value.filter(r => r.pendingSync).length
    + complaints.value.filter(r => r.pendingSync).length
    + inspections.value.filter(r => r.pendingSync).length)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const planAppraisalPassed = computed(() => {
    const p = current.value?.planAppraisal
    if (!p) return false
    return p.windowArea10pct && p.windowsOpenable50pct
        && p.airBricksAdequate && p.crossVentilation
        && p.waterSupplyConnected && p.sewerOrSepticTank
        && p.wcRatio && p.genderSeparation && p.disabledAccess && p.refuseReceptacle
        && p.reticulatedWater && p.washBasinsPiped && p.imperviousSurfaces
        && p.minFloorAreaMet && p.wallsCompliant && p.floorCompliant
        && p.roofRainwaterOk && p.storeroomsRodentProof
  })

  // ── Server-backed writes ────────────────────────────────────────
  // Every mutator keeps a synchronous signature. The record appears in the
  // list at once — an officer standing in a premises must never wait on a
  // rural data connection to see what they just wrote — and the server call
  // follows. If it succeeds the local row is replaced by the server's, which
  // is what supplies the register reference (OB-2026-0001) and the row's real
  // id. If it fails the row stays, flagged pendingSync, and is retried on the
  // next refresh. localStorage is the offline cache, not the record.
  function commit<T extends { id: string; pendingSync?: boolean }>(
    list: Ref<T[]>, tempId: string, key: string, call: () => Promise<T>,
  ) {
    call().then((saved) => {
      const i = list.value.findIndex(r => r.id === tempId)
      if (i >= 0) list.value[i] = { ...list.value[i], ...saved, pendingSync: false }
      safeWrite(key, list.value)
      syncState.value = 'idle'
    }).catch(() => {
      const i = list.value.findIndex(r => r.id === tempId)
      if (i >= 0) list.value[i] = { ...list.value[i], pendingSync: true }
      safeWrite(key, list.value)
      syncState.value = 'offline'
    })
  }

  function openAppraisal(permitId: string) {
    const cached = safeRead<Partial<HealthCase> | null>(STORAGE_CASE_KEY(permitId), null)
    // Older drafts carried extra fields; only the checklist is kept, merged
    // over a fresh one so a check added since still has a value.
    current.value = {
      permitId,
      planAppraisal: { ...emptyAppraisal(), ...(cached?.planAppraisal ?? {}) },
      lastEditedAt: cached?.lastEditedAt ?? new Date().toISOString(),
    }
  }

  function upsertPremises(p: Omit<PremisesRecord, 'id' | 'created_at'> & { id?: string }): PremisesRecord {
    if (p.id) {
      const idx = registry.value.findIndex(r => r.id === p.id)
      if (idx >= 0) {
        registry.value[idx] = { ...registry.value[idx], ...p } as PremisesRecord
        safeWrite(STORAGE_REGISTRY_KEY, registry.value)
        const id = p.id
        if (isServerId(id)) {
          commit(registry, id, STORAGE_REGISTRY_KEY, () => ehoApi.updatePremises(id, p))
        }
        return registry.value[idx]
      }
    }
    const rec: PremisesRecord = {
      ...(p as Omit<PremisesRecord, 'id' | 'created_at'>),
      id: p.id ?? uid('prem_'),
      created_at: new Date().toISOString(),
      pendingSync: true,
    }
    registry.value.push(rec)
    safeWrite(STORAGE_REGISTRY_KEY, registry.value)
    const localId = rec.id
    commit(registry, localId, STORAGE_REGISTRY_KEY, async () => {
      const saved = await ehoApi.createPremises(rec)
      repointInspections(localId, saved.id)
      return saved
    })
    return rec
  }

  function removePremises(id: string) {
    registry.value = registry.value.filter(r => r.id !== id)
    safeWrite(STORAGE_REGISTRY_KEY, registry.value)
    // Soft-deletes on the server; a register entry removed as a duplicate must
    // still be explicable when its inspections are audited a year later.
    if (isServerId(id)) ehoApi.deletePremises(id).catch(() => { syncState.value = 'offline' })
  }

  function recordInspection(i: NewInspection): InspectionRecord {
    const prem = registry.value.find(r => r.id === i.premisesId)
    const rec: InspectionRecord = {
      id: uid('insp_'), reference: '', premisesName: prem?.name ?? null,
      inspectedAt: i.inspectedAt || new Date().toISOString(), inspectorName: i.inspectorName,
      premisesId: i.premisesId, scope: i.scope, verdict: i.verdict, findings: i.findings,
      actionRequired: i.actionRequired || null, followUpDate: i.followUpDate || null,
      noticeId: i.noticeId ?? null, createdByName: null,
      lng: i.lng ?? null, lat: i.lat ?? null,
      locationSource: i.locationSource ?? null, locationAccuracyM: i.locationAccuracyM ?? null,
      pendingSync: true,
    }
    inspections.value.unshift(rec)
    safeWrite(STORAGE_INSPECTIONS_KEY, inspections.value)
    // The register's "last inspected" moves at once on screen; the server
    // derives the same value from the inspection row when it lands.
    if (prem && (!prem.last_inspected_at || prem.last_inspected_at < rec.inspectedAt)) {
      prem.last_inspected_at = rec.inspectedAt
      safeWrite(STORAGE_REGISTRY_KEY, registry.value)
    }
    // A premises written offline has no server id yet and the server would
    // refuse an inspection against it. The inspection is held; it is sent
    // once the premises syncs (repointInspections).
    if (isServerId(i.premisesId)) {
      commit(inspections, rec.id, STORAGE_INSPECTIONS_KEY,
        () => ehoOpsApi.createInspection({ ...i, inspectedAt: rec.inspectedAt }))
    }
    return rec
  }

  function addOutbreak(o: Omit<OutbreakCase, 'id'>): OutbreakCase {
    const rec: OutbreakCase = { ...o, id: uid('ob_'), pendingSync: true }
    outbreaks.value.unshift(rec)
    safeWrite(STORAGE_OUTBREAKS_KEY, outbreaks.value)
    commit(outbreaks, rec.id, STORAGE_OUTBREAKS_KEY, () => ehoApi.createOutbreak(rec))
    return rec
  }
  function updateOutbreak(id: string, patch: Partial<OutbreakCase>) {
    const idx = outbreaks.value.findIndex(o => o.id === id)
    if (idx < 0) return
    outbreaks.value[idx] = { ...outbreaks.value[idx], ...patch }
    safeWrite(STORAGE_OUTBREAKS_KEY, outbreaks.value)
    if (isServerId(id)) {
      commit(outbreaks, id, STORAGE_OUTBREAKS_KEY, () => ehoApi.updateOutbreak(id, patch))
    }
  }

  function addSample(s: Omit<WaterSample, 'id'>): WaterSample {
    const rec: WaterSample = { ...s, id: uid('ws_'), pendingSync: true }
    waterSamples.value.unshift(rec)
    safeWrite(STORAGE_SAMPLES_KEY, waterSamples.value)
    commit(waterSamples, rec.id, STORAGE_SAMPLES_KEY, () => ehoApi.createWaterSample(rec))
    return rec
  }

  function addComplaint(c: Omit<NuisanceComplaint, 'id'>): NuisanceComplaint {
    const rec: NuisanceComplaint = { ...c, id: uid('cp_'), pendingSync: true }
    complaints.value.unshift(rec)
    safeWrite(STORAGE_COMPLAINTS_KEY, complaints.value)
    commit(complaints, rec.id, STORAGE_COMPLAINTS_KEY, () => ehoApi.createComplaint(rec))
    return rec
  }
  function updateComplaint(id: string, patch: Partial<NuisanceComplaint>) {
    const idx = complaints.value.findIndex(c => c.id === id)
    if (idx < 0) return
    complaints.value[idx] = { ...complaints.value[idx], ...patch }
    safeWrite(STORAGE_COMPLAINTS_KEY, complaints.value)
    if (isServerId(id)) {
      commit(complaints, id, STORAGE_COMPLAINTS_KEY, () => ehoApi.updateComplaint(id, patch))
    }
  }

  function save() {
    if (!current.value) return
    current.value.lastEditedAt = new Date().toISOString()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (current.value) safeWrite(STORAGE_CASE_KEY(current.value.permitId), current.value)
    }, SAVE_DEBOUNCE_MS)
  }

  function clear() { current.value = null }

  /** Read the registers from the server and retry anything still held locally. */
  async function refresh(): Promise<void> {
    syncState.value = 'loading'
    try {
      const [prem, out, water, comp, insp] = await Promise.all([
        ehoApi.listPremises(), ehoApi.listOutbreaks(),
        ehoApi.listWaterSamples(), ehoApi.listComplaints(),
        ehoOpsApi.listInspections({ limit: 300 }),
      ])
      registry.value     = mergeHeld(registry.value, prem as PremisesRecord[])
      outbreaks.value    = mergeHeld(outbreaks.value, out as OutbreakCase[])
      waterSamples.value = mergeHeld(waterSamples.value, water as WaterSample[])
      complaints.value   = mergeHeld(complaints.value, comp as NuisanceComplaint[])
      inspections.value  = mergeHeld(inspections.value, insp as InspectionRecord[])
      safeWrite(STORAGE_REGISTRY_KEY, registry.value)
      safeWrite(STORAGE_OUTBREAKS_KEY, outbreaks.value)
      safeWrite(STORAGE_SAMPLES_KEY, waterSamples.value)
      safeWrite(STORAGE_COMPLAINTS_KEY, complaints.value)
      safeWrite(STORAGE_INSPECTIONS_KEY, inspections.value)
      syncState.value = 'idle'
      retryHeld()
    } catch {
      // Keep the cached registers on screen. An unreachable server is not an
      // empty district.
      syncState.value = 'offline'
    }
  }

  /**
   * Re-send every row the server has not accepted.
   *
   * A held row with a local id never reached the server and is re-created. A
   * held row with a SERVER id is an edit that failed, and is re-sent as an
   * update from the row as it now stands. Re-creating it — which this used to
   * do — filed the same outbreak twice.
   */
  function retryHeld() {
    for (const r of registry.value.filter(x => x.pendingSync)) {
      if (isServerId(r.id)) {
        commit(registry, r.id, STORAGE_REGISTRY_KEY, () => ehoApi.updatePremises(r.id, r))
      } else {
        const localId = r.id
        commit(registry, localId, STORAGE_REGISTRY_KEY, async () => {
          const saved = await ehoApi.createPremises(r)
          repointInspections(localId, saved.id)
          return saved
        })
      }
    }
    for (const r of outbreaks.value.filter(x => x.pendingSync)) {
      commit(outbreaks, r.id, STORAGE_OUTBREAKS_KEY, () =>
        isServerId(r.id) ? ehoApi.updateOutbreak(r.id, r) : ehoApi.createOutbreak(r))
    }
    // Samples are never edited, so a held sample is always an unsent create.
    for (const r of waterSamples.value.filter(x => x.pendingSync && !isServerId(x.id))) {
      commit(waterSamples, r.id, STORAGE_SAMPLES_KEY, () => ehoApi.createWaterSample(r))
    }
    for (const r of complaints.value.filter(x => x.pendingSync)) {
      commit(complaints, r.id, STORAGE_COMPLAINTS_KEY, () =>
        isServerId(r.id) ? ehoApi.updateComplaint(r.id, r) : ehoApi.createComplaint(r))
    }
    sendHeldInspections()
  }

  /** Inspections are never edited; a held one is an unsent create, sendable once its premises has a server id. */
  function sendHeldInspections() {
    for (const r of inspections.value.filter(x => x.pendingSync && !isServerId(x.id) && isServerId(x.premisesId))) {
      commit(inspections, r.id, STORAGE_INSPECTIONS_KEY, () => ehoOpsApi.createInspection({
        premisesId: r.premisesId, inspectorName: r.inspectorName, scope: r.scope,
        verdict: r.verdict, findings: r.findings, actionRequired: r.actionRequired,
        followUpDate: r.followUpDate, inspectedAt: r.inspectedAt, noticeId: r.noticeId,
        lng: r.lng, lat: r.lat, locationSource: r.locationSource, locationAccuracyM: r.locationAccuracyM,
      }))
    }
  }

  /**
   * An inspection held against a premises created offline points at the
   * premises' local id. When that premises syncs, the inspection is re-pointed
   * at the server id and sent.
   */
  function repointInspections(localId: string, serverId: string) {
    let moved = false
    for (const r of inspections.value) {
      if (r.premisesId === localId) { r.premisesId = serverId; moved = true }
    }
    if (moved) {
      safeWrite(STORAGE_INSPECTIONS_KEY, inspections.value)
      sendHeldInspections()
    }
  }

  async function refreshSummary(cycleDays?: number): Promise<void> {
    try {
      summary.value = await ehoOpsApi.summary(cycleDays)
    } catch {
      // Leave the last counters on screen; the sync pill already says offline.
    }
  }

  const ctx: HealthCaseContext = {
    current, registry, outbreaks, waterSamples, complaints, inspections,
    planAppraisalPassed,
    openAppraisal, upsertPremises, removePremises,
    recordInspection,
    addOutbreak, updateOutbreak,
    addSample,
    addComplaint, updateComplaint,
    save, clear,
    syncState, pendingCount, refresh,
    summary, refreshSummary,
  }
  provide(HEALTH_CASE_KEY, ctx)

  // Hydrate in the background: the cached registers are already on screen.
  if (typeof window !== 'undefined') void refresh()

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { if (saveTimer) clearTimeout(saveTimer) })
  }

  return ctx
}

export function useHealthCase(): HealthCaseContext {
  const ctx = inject(HEALTH_CASE_KEY)
  if (!ctx) throw new Error('useHealthCase() called outside <EnvironmentOfficerWorkspaceView> tree')
  return ctx
}

export function useOrProvideHealthCase(): HealthCaseContext {
  const existing = inject(HEALTH_CASE_KEY, null)
  if (existing) return existing
  return provideHealthCase()
}

// ── Minimum floor-area standards per use class (per the brief) ────
export interface FloorAreaStandard {
  use: PremisesType
  label: string
  rule: string
}
export const MIN_FLOOR_AREAS: FloorAreaStandard[] = [
  { use: 'creche',         label: 'Crèche',         rule: '3 m² play / child · 8.3 m² rest · 17 m² per infant' },
  { use: 'bakery',         label: 'Bakery',         rule: '≥ 30 m²; furnace 2 m from door/window; not connected to non-food premises' },
  { use: 'butchery',       label: 'Butchery',       rule: '≥ 30 m²; tiled to 1.8 m; refrigerated room ≥ 6 m³; fly-proof' },
  { use: 'bottle_store',   label: 'Bottle store',   rule: '≥ 20 m²' },
  { use: 'restaurant',     label: 'Eating house',   rule: '≥ 30 m² eating + 14 m² kitchen; mechanical extraction' },
  { use: 'school',         label: 'School',         rule: '60 m² per classroom; 3.75 m² per child in hostel' },
  { use: 'hotel',          label: 'Hotel',          rule: '9 m² single bedroom · 13 m² double' },
  { use: 'general_dealer', label: 'General dealer', rule: '≥ 27 m²' },
  { use: 'beerhall',       label: 'Beerhall',       rule: '≥ 40 m²' },
]

// ── School sanitary ratios ────────────────────────────────────────
export const SCHOOL_SANITARY_RATIOS = {
  wcBoys: '1 WC per 25 boys',
  wcGirls: '1 WC per 20 girls',
  urinals: '1 urinal per 25 boys',
  washBoys: '1 basin per 50 boys',
  washGirls: '1 basin per 30 girls',
} as const

// ── Specialised referral matrix ───────────────────────────────────
export interface ReferralRow { issue: string; refersTo: string; statute: string }
export const SPECIALISED_REFERRALS: ReferralRow[] = [
  { issue: 'Noxious gas emissions',     refersTo: 'Secretary for Health and Child Welfare',
    statute: 'Atmospheric Pollution Prevention Act' },
  { issue: 'Effluent discharge',        refersTo: 'Secretaries for Environment & Tourism / Lands & Water Resources',
    statute: 'Environmental Management Act' },
  { issue: 'Industrial processes',      refersTo: 'Factories Inspectorate',
    statute: 'Factories and Works Act [Ch. 14:08]' },
  { issue: 'Notifiable disease outbreak', refersTo: 'Provincial / National Disease Surveillance',
    statute: 'Public Health Act [Ch. 15:09]' },
  { issue: 'Abattoir / meat inspection', refersTo: 'Veterinary Officer',
    statute: 'Animal Health Act' },
  { issue: 'Liquor premises',           refersTo: 'Liquor Licensing Board',
    statute: 'Liquor Act' },
]

export const HIGH_POLLUTION_INDUSTRIES = [
  'Abattoirs', 'Breweries', 'Chemicals', 'Dairy', 'Fertiliser', 'Foundries',
  'Metal plating', 'Pulp and paper mills', 'Steel manufacture', 'Tanneries',
  'Yeast manufacture',
] as const
