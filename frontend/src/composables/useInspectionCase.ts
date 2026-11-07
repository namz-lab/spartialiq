// ─── useInspectionCase ─────────────────────────────────────────────
// Active building-inspection case file shared across the Inspector
// Workspace sections. Mirrors the planner's usePlannerCase pattern:
// provide at the workspace, inject in every section.
//
// Persistence tiers:
//   Tier 1 — dmApi stage_inspection is the official record (Option A).
//   Tier 2 — reactive in-memory state for the active sheet.
//   Tier 3 — localStorage draft cache only. Never treat it as the official
//            inspection result, occupation, or referral.
// ───────────────────────────────────────────────────────────────────

import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'
import {
  dmApi,
  type OccupationCertificate,
  type PermitApplication,
  type StageInspection,
} from '@/services/developmentManagementService'

// ── Pre-construction verification (the Inspector's first checks) ────
export interface PreConstructionCheck {
  approvedPlanOnSite:    boolean
  developmentPermitHeld: boolean
  permitWithinValidity:  boolean   // 12-month commencement window
  cadastralPegsIntact:   boolean
  buildingLinesRespected:boolean
  orientationCorrect:    boolean
  notes:                 string
  verifiedAt:            string | null
  verifiedBy:            string
}

export type Verdict = 'pass' | 'fail' | 'rework' | 'pending'

export interface StageChecklistRow {
  itemCode: string
  itemLabel: string
  result: Verdict
  measurement: string   // e.g. "230 mm wall" / "trench 720 mm deep"
  notes: string
}

export interface InspectionCase {
  permitId: string | null
  permit:   PermitApplication | null

  preConstruction: PreConstructionCheck

  stages: Record<number, {
    stageNumber: number
    inspectionId: string | null
    verdict: Verdict
    inspectedAt: string | null
    inspectorName: string
    measurements: string
    photosTaken: number
    flagsRaised: number
    checklist: StageChecklistRow[]
    annexure12Stamp: { signed: boolean; signedAt: string | null }
  }>

  certificate: {
    issued:    boolean
    issuedAt:  string | null
    certNo:    string
    partial:   boolean
    conditions: string
  }

  lastEditedAt: string
}

/**
 * Fail-closed result for case-file writes. The caller may only report success
 * when `ok` is true — a rejected request means the record was not written.
 */
export type RecordResult = { ok: true } | { ok: false; error: string }

export interface InspectionCaseContext {
  current:        Ref<InspectionCase | null>
  /**
   * The issued Certificate of Occupation, or null when none has been issued.
   *
   * Held here, not per section: the case band, the case file and the
   * certificates desk were each fetching it, which meant three requests per
   * permit AND a band that still said "no certificate" after one was issued,
   * because its watcher only fires when the permit id changes.
   */
  certificate:    Ref<OccupationCertificate | null>
  /** False until the certificate has actually been read for this permit. */
  certificateLoaded: Ref<boolean>
  /** Re-read the certificate after issuing one. */
  refreshCertificate: () => Promise<void>
  preConstructionPassed: ComputedRef<boolean>
  stagesCompleted:       ComputedRef<number>
  readyForCertificate:   ComputedRef<boolean>
  loadPermit:     (permitId: string) => Promise<void>
  setStageVerdict: (stageNumber: number, verdict: Verdict, notes?: string) => Promise<void>
  recordPreConstruction: (inspectorName: string) => Promise<RecordResult>
  save:           () => void
  clear:          () => void
  syncPending:    ComputedRef<boolean>
}

const INSPECTION_CASE_KEY: InjectionKey<InspectionCaseContext> = Symbol('InspectionCase')

const CASE_DRAFT_PREFIX = 'inspector_case_'
const STORAGE_KEY = (permitId: string | null) =>
  permitId ? `${CASE_DRAFT_PREFIX}${permitId}` : `${CASE_DRAFT_PREFIX}new_draft`
const SAVE_DEBOUNCE_MS = 800

/**
 * The case drafts this device is holding.
 *
 * Exported so the settings page can report and clear them without knowing the
 * key format — this module owns that, and a second copy of the prefix is
 * exactly how a "clear cache" button ends up clearing nothing.
 */
export function cachedCaseDraftKeys(): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(CASE_DRAFT_PREFIX)) keys.push(k)
    }
  } catch {
    return []
  }
  return keys
}

/**
 * Drop every cached draft, and answer how many went.
 *
 * Safe by construction: a draft is a local convenience, never the record. Every
 * verdict, checklist mark and photograph in it was already written to the
 * server before the console showed it as saved, so clearing costs the inspector
 * a re-fetch and nothing else.
 */
export function clearCachedCaseDrafts(): number {
  const keys = cachedCaseDraftKeys()
  for (const k of keys) {
    try { localStorage.removeItem(k) } catch { /* leave the rest to try */ }
  }
  return keys.length
}

function writeLocal(c: InspectionCase) {
  try { localStorage.setItem(STORAGE_KEY(c.permitId), JSON.stringify(c)) } catch {}
}
function readLocal(permitId: string): InspectionCase | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(permitId))
    return raw ? JSON.parse(raw) as InspectionCase : null
  } catch { return null }
}

// The Annexure 14 checklist is NOT defined here.
//
// A hardcoded STAGE_CHECKLIST_TEMPLATES table used to live at this spot and seed
// stages[n].checklist. It was a second source of statutory truth that could drift
// from the register without anyone noticing, and nothing ever read it — the stage
// console fetches the authoritative catalogue from the database instead:
//
//   spatial_planning.checklist_item  ->  dmApi.getInspectionChecklist(stageNumber)
//
// The database ids are what the scoring engine and the write endpoint key on, so
// a client-side list of labels could never have been submitted anyway.

export function emptyInspectionCase(): InspectionCase {
  const stages: InspectionCase['stages'] = {}
  for (let n = 1; n <= 9; n++) {
    stages[n] = {
      stageNumber: n,
      inspectionId: null,
      verdict: 'pending',
      inspectedAt: null,
      inspectorName: '',
      measurements: '',
      photosTaken: 0,
      flagsRaised: 0,
      // Empty by design: the stage console loads the real catalogue from
      // spatial_planning.checklist_item. Seeding labels here would reintroduce a
      // second source of statutory truth.
      checklist: [] as StageChecklistRow[],
      annexure12Stamp: { signed: false, signedAt: null },
    }
  }
  return {
    permitId: null,
    permit: null,
    preConstruction: {
      approvedPlanOnSite: false,
      developmentPermitHeld: false,
      permitWithinValidity: false,
      cadastralPegsIntact: false,
      buildingLinesRespected: false,
      orientationCorrect: false,
      notes: '',
      verifiedAt: null,
      verifiedBy: '',
    },
    stages,
    certificate: {
      issued: false, issuedAt: null, certNo: '',
      partial: false, conditions: '',
    },
    lastEditedAt: new Date().toISOString(),
  }
}

export function provideInspectionCase(): InspectionCaseContext {
  const current = ref<InspectionCase | null>(null)
  const certificate = ref<OccupationCertificate | null>(null)
  const certificateLoaded = ref(false)
  const syncPending = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const preConstructionPassed = computed(() => {
    const p = current.value?.preConstruction
    if (!p) return false
    return p.approvedPlanOnSite && p.developmentPermitHeld
        && p.permitWithinValidity && p.cadastralPegsIntact
        && p.buildingLinesRespected && p.orientationCorrect
  })

  const stagesCompleted = computed(() => {
    const stages = current.value?.stages
    if (!stages) return 0
    let count = 0
    for (let n = 1; n <= 9; n++) {
      if (stages[n]?.verdict === 'pass') count++
    }
    return count
  })

  const readyForCertificate = computed(() => {
    const stages = current.value?.stages
    if (!stages) return false
    for (let n = 1; n <= 8; n++) {
      if (stages[n]?.verdict !== 'pass' && stages[n]?.verdict !== 'rework') return false
    }
    return true
  })

  /**
   * getCertificate returns null only when the server says no certificate has
   * been issued — the normal state of an unfinished building. A failure to
   * reach the server raises instead, and leaves `certificateLoaded` false, so
   * callers can say "not confirmed" rather than "not issued".
   */
  async function refreshCertificate() {
    const permitId = current.value?.permitId
    if (!permitId) { certificate.value = null; certificateLoaded.value = false; return }
    try {
      const got = await dmApi.getCertificate(permitId)
      if (current.value?.permitId !== permitId) return
      certificate.value = got
      certificateLoaded.value = true
    } catch {
      if (current.value?.permitId !== permitId) return
      certificate.value = null
      certificateLoaded.value = false
    }
  }

  async function loadPermit(permitId: string) {
    const cached = readLocal(permitId)
    let base: InspectionCase
    if (cached) {
      base = cached
    } else {
      base = emptyInspectionCase()
      base.permitId = permitId
    }
    try {
      const [permit, inspections] = await Promise.all([
        dmApi.getPermit(permitId),
        dmApi.listStageInspections(permitId),
      ])
      base.permit = permit
      base.permitId = permit.id
      for (const insp of inspections as StageInspection[]) {
        const stageNum = Number((insp as any).stage_number ?? 0)
        if (stageNum < 1 || stageNum > 9) continue
        const stage = base.stages[stageNum]
        stage.inspectionId = (insp as any).id ?? null
        stage.inspectedAt = (insp as any).inspected_at ?? null
        const result = String((insp as any).result || '').toLowerCase()
        stage.verdict = result === 'pass' ? 'pass'
                      : result === 'conditional_pass' ? 'rework'
                      : result === 'fail' || result === 'reinspection_required' ? 'fail'
                      : 'pending'
      }
      // The case file answered — clear any stale offline latch.
      syncPending.value = false
    } catch {
      syncPending.value = true
    }
    current.value = base
    writeLocal(base)
    certificate.value = null
    certificateLoaded.value = false
    await refreshCertificate()
  }

  async function setStageVerdict(stageNumber: number, verdict: Verdict, _notes = '') {
    const c = current.value
    if (!c?.permitId) return
    const stage = c.stages[stageNumber]
    if (!stage) return
    stage.verdict = verdict
    stage.inspectedAt = new Date().toISOString()
    stage.annexure12Stamp.signed = verdict === 'pass'
    stage.annexure12Stamp.signedAt = verdict === 'pass' ? stage.inspectedAt : null
    // The stage console already POSTs the checklist (and computed result)
    // via recordChecklist. Do not POST /checklist again with an empty
    // payload or a missing inspection id.
    save()
  }

  /**
   * Pre-construction verification is written to the permit case file first.
   * Local state is only stamped once the server has accepted the note, so a
   * failed request can never leave a "verified" case behind on the device.
   */
  async function recordPreConstruction(inspectorName: string): Promise<RecordResult> {
    const c = current.value
    if (!c?.permitId) return { ok: false, error: 'Open a permit before recording verification.' }
    try {
      await dmApi.postMessage(c.permitId, {
        body: [
          'Pre-construction verification recorded.',
          `Approved plan on site: ${c.preConstruction.approvedPlanOnSite}`,
          `Development permit held: ${c.preConstruction.developmentPermitHeld}`,
          `Permit within 12-month window: ${c.preConstruction.permitWithinValidity}`,
          `Cadastral pegs intact: ${c.preConstruction.cadastralPegsIntact}`,
          `Building lines respected: ${c.preConstruction.buildingLinesRespected}`,
          `Orientation correct: ${c.preConstruction.orientationCorrect}`,
          c.preConstruction.notes ? `Notes: ${c.preConstruction.notes}` : '',
        ].filter(Boolean).join('\n'),
        message_type: 'internal_note',
        visibility: 'internal',
      })
    } catch (err: unknown) {
      syncPending.value = true
      const message = err instanceof Error
        ? err.message
        : 'Verification was not written to the case file.'
      return { ok: false, error: message }
    }
    // Confirmed by the case file — only now is the verification official.
    c.preConstruction.verifiedAt = new Date().toISOString()
    c.preConstruction.verifiedBy = inspectorName
    syncPending.value = false
    save()
    return { ok: true }
  }

  function save() {
    if (!current.value) return
    current.value.lastEditedAt = new Date().toISOString()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (current.value) writeLocal(current.value)
    }, SAVE_DEBOUNCE_MS)
  }

  function clear() {
    current.value = null
    certificate.value = null
    certificateLoaded.value = false
  }

  const ctx: InspectionCaseContext = {
    current,
    certificate,
    certificateLoaded,
    refreshCertificate,
    preConstructionPassed,
    stagesCompleted,
    readyForCertificate,
    loadPermit,
    setStageVerdict,
    recordPreConstruction,
    save,
    clear,
    syncPending: computed(() => syncPending.value),
  }
  provide(INSPECTION_CASE_KEY, ctx)

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { if (saveTimer) clearTimeout(saveTimer) })
  }

  return ctx
}

export function useInspectionCase(): InspectionCaseContext {
  const ctx = inject(INSPECTION_CASE_KEY)
  if (!ctx) throw new Error('useInspectionCase() called outside <InspectorWorkspaceView> tree')
  return ctx
}

export function tryUseInspectionCase(): InspectionCaseContext | null {
  return inject(INSPECTION_CASE_KEY, null)
}

export function useOrProvideInspectionCase(): InspectionCaseContext {
  const existing = inject(INSPECTION_CASE_KEY, null)
  if (existing) return existing
  return provideInspectionCase()
}

// ── Static reference data the brief mandates the Inspector knows ────
export const INSPECTION_STAGES_STATIC = [
  { n: 1, name: 'Setting Out',                  desc: 'Siting, levels, alignment with pegs and building lines' },
  { n: 2, name: 'Foundation Trenches & Footing', desc: 'Trench depth ≥ 700 mm, width 3× wall thickness, soil check' },
  { n: 3, name: 'Foundation Brickwork to Floor', desc: 'DPC, plinth ≥ 150 mm above ground, mortar quality' },
  { n: 4, name: 'Brickwork at Window Level',    desc: 'Wall thickness, lintels, air bricks, window-sill DPC' },
  { n: 5, name: 'Brickwork to Wall Plate',      desc: 'Ring beam, wall-plate hoop irons, gables, ceiling height ≥ 2 400 mm' },
  { n: 6, name: 'Roof Trusses',                 desc: 'Truss assembly, purlin spacing, roof pitch, overhang ≥ 0.6 m' },
  { n: 7, name: 'Drainage & Sewerage',          desc: 'Pipe diameter, vent pipes, septic tank ≥ 10 m from buildings, air test' },
  { n: 8, name: 'Final Inspection',             desc: 'Electricals, sanitary fittings, accessibility, external finishes' },
  { n: 9, name: 'Certificate of Occupation',    desc: 'Joint inspection with EHO + Plumber → Annexure 13' },
] as const
