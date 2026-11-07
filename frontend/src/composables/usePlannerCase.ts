// ─── usePlannerCase ──────────────────────────────────────────────────
// Single source of truth for the active planner case file. Provided at
// <StatutoryShell> and injected by every step component. The four lock
// selectors drive <StepLockGate> wrappers in the shell.
//
// Persistence tiers:
//   Tier 1 — dmApi for fields the backend knows about (permit CRUD,
//            consultations, objections, status transitions).
//   Tier 2 — in-memory reactive state for everything else (due diligence
//            checks, committee report drafts, 5-test gating, notices).
//   Tier 3 — localStorage cache, debounced 800ms after every mutation,
//            so a refresh doesn't lose drafts. Also feeds the cross-tab
//            concurrent-edit reload on window focus.
// ─────────────────────────────────────────────────────────────────────

import { caseRef } from '@/composables/useApplicationPipeline'
import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'
import type { PlanningCondition } from './useConditionLibrary'
import { dmApi, isConflictError, type PermitApplication } from '@/services/developmentManagementService'
import type { StandSeed } from './featureToStandSeed'
import type { ZoningSnapshot } from '@/services/developmentControl'

// DM Handbook application types — must match the backend's VALID_TYPES on
// POST /api/permit-applications. These describe what the applicant is asking
// for (the application), not the zoning (which lives in land-use categories).
export type DevType =
  | 'new_building' | 'alteration' | 'extension' | 'change_of_use'
  | 'subdivision' | 'consolidation' | 'rezoning' | 'other'

export type Classification =
  | 'routine_26_1' | 'special_consent_26_3' | 'preliminary'
  | 'change_of_use' | 'building_ops' | 'mining'

export type CheckResult = 'pass' | 'fail' | 'na' | null

export interface Referral {
  department: string; contactedAt: string; response: string
  outcome: 'pending' | 'no_objection' | 'objection' | 'conditional'
}

export interface ObjectionRow {
  id: string; objector: string; grounds: string; receivedAt: string
  officerView: string; resolvedAt: string | null
}

export interface CaseFile {
  registrationNo: string
  fileRef: string
  permitId: string | null
  // Backend permit status (drives the shared cross-role ApplicationPipeline).
  status?: string
  applicant: { name: string; idNumber: string; phone: string; email: string }
  property:  { standNo: string; ward: string; description: string; titleDeedNo: string; centroid?: [number, number]; parcelFid?: number }
  proposal:  { devType: DevType; description: string; estimatedCost: number
               plinthArea: number; floors: number; parkingBays: number }
  intake:    { feePaid: boolean; feeReceiptNo: string; feeAmount: number
               copiesSubmitted: number; titleDeedAttached: boolean
               bondholderConsent: boolean
               proofOfFunding: boolean; justification: string }
  classification: Classification
  applicationDate:  string
  acknowledgedDate: string | null
  expiryDate:       string | null
  dueDiligence: {
    fileChecks:        Record<string, { result: CheckResult; notes: string }>
    compatibility:     Record<string, { result: CheckResult; notes: string }>
    statutoryChecks:   Record<string, { result: CheckResult; notes: string }>
    titleDeedConflict: { hasConflict: boolean; deedFileName: string
                         bondholderConsentReceived: boolean }
    referrals:   Referral[]
    completedAt: string | null
    zoningAssessment?: ZoningSnapshot
  }
  committeeReport: {
    siteContext: string; policyAnalysis: string; publicResponseNotes: string
    recommendation: 'approve' | 'approve_modified' | 'refuse' | 'defer'
    recommendationReasons: string
    tabledAt: string | null; resolutionAt: string | null; resolutionText: string
  }
  permit: {
    permitNo: string
    useClass: '' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'
    permittedDescription: string
    conditions: PlanningCondition[]
    /** Officer-authored discretionary notes ONLY. The statutory Annexure 7
     *  clauses are derived from the rule set (planner/permit/permitRules.ts),
     *  never stored as free text — see that module for why. */
    annexure7Notes: string
    issueDate: string | null
    issuingOfficer: string
    // ── Decision record (permit-issuance workspace) ───────────────────────
    // The Act treats these as distinct events; collapsing them into a single
    // issueDate made the appeal window and the implementation window wrongly
    // share an origin.
    /** When the authorised decision was made (`YYYY-MM-DD`). */
    decisionDate: string | null
    /** When the applicant was formally notified (`YYYY-MM-DD`). */
    notificationDate: string | null
    /** The office exercising the decision power — a committee resolution or a
     *  named delegated authority. Recorded, never inferred. */
    decisionAuthority: string
    /** Implementation (commencement) window in months. Explicit and editable,
     *  NOT a hard-coded universal 12. */
    implementationPeriodMonths: number
    /** Version of the generated permit document, mirrored from the server once
     *  a generated_document row exists for permits. */
    documentVersion: number | null
  }
  /** Optimistic-lock counter last read from the server (migration 097). Sent as
   *  `expectedRevision` on every write; the server bumps it on success. */
  revision: number
  notices: {
    ackSentAt: string | null
    ackReturnedAt: string | null
    publicNotice: { newspaper: string; publishedAt: string
                    abuttingOwners: string[]; proofUploadedAt: string | null } | null
    objections: ObjectionRow[]
    outcomeLetterSentAt: string | null
  }
  lastEditedAt: string
}

export interface PlannerCaseContext {
  current:        Ref<CaseFile | null>
  step2Unlocked:  ComputedRef<boolean>
  step3Unlocked:  ComputedRef<boolean>
  step4Unlocked:  ComputedRef<boolean>
  step5Available: ComputedRef<boolean>
  loadFromPermit: (id: string) => Promise<void>
  registerNew:    (draft: Partial<CaseFile>) => Promise<void>
  save:           () => void
  clear:          () => void
  syncPending:    ComputedRef<boolean>
  /** True once a write lost the optimistic lock (another officer saved first).
   *  Consumers must block irreversible actions and prompt for a reload rather
   *  than overwriting the other officer's work. */
  conflict:       Ref<boolean>
  intakeSeed:     Ref<StandSeed | null>
  seedIntake:     (seed: StandSeed) => void
}

const PLANNER_CASE_KEY: InjectionKey<PlannerCaseContext> = Symbol('PlannerCase')

// ── Pure module-scope helpers (no instance-bound state) ──────────────
const STORAGE_KEY = (permitId: string | null) =>
  permitId ? `planner_case_${permitId}` : `planner_case_new_draft`

const RECENT_KEY  = 'planner_recent_cases'
const MAX_RECENT  = 10
const SAVE_DEBOUNCE_MS = 800

// Starting value only — the officer sets the real period per permit, and the
// authoritative default lives in planner/permit/permitRules.ts. Duplicated as a
// literal here solely to keep this composable free of a UI-layer import.
const DEFAULT_IMPLEMENTATION_MONTHS = 12

function writeLocal(c: CaseFile) {
  try { localStorage.setItem(STORAGE_KEY(c.permitId), JSON.stringify(c)) } catch {}
}

function readLocal(permitId: string): CaseFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(permitId))
    return raw ? JSON.parse(raw) as CaseFile : null
  } catch { return null }
}

function pushRecent(c: CaseFile) {
  if (!c.permitId) return
  const permitId = c.permitId
  try {
    const recent: Array<{ permitId: string; label: string; openedAt: string }> =
      JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    const label = `${c.registrationNo} — ${c.applicant.name || c.property.standNo}`
    const filtered = recent.filter(r => r.permitId !== permitId)
    filtered.unshift({ permitId, label, openedAt: new Date().toISOString() })
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)))
  } catch {}
}

// Serialise the planner case file into the backend /case patch (migration 082)
// so the planning record is the shared system-of-record, not just localStorage.
function caseToPatch(c: CaseFile): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    // Optimistic lock (migration 097). Without this the route 400s with
    // `expected_revision_required` and NOTHING is ever persisted.
    expectedRevision:       c.revision,
    estimated_cost:         c.proposal.estimatedCost,
    plinth_area:            c.proposal.plinthArea,
    floors:                 c.proposal.floors,
    parking_bays:           c.proposal.parkingBays,
    classification:         c.classification,
    recommendation:         c.committeeReport.recommendation,
    recommendation_reasons: c.committeeReport.recommendationReasons,
    due_diligence:          c.dueDiligence,
    committee_report:       c.committeeReport,
    permit_conditions:      c.permit.conditions,
  }
  if (c.property.titleDeedNo) patch.title_deed_no = c.property.titleDeedNo
  if (c.dueDiligence.zoningAssessment) patch.zoning_assessment = c.dueDiligence.zoningAssessment
  if (c.expiryDate) patch.statutory_due_date = c.expiryDate.slice(0, 10)
  // GIS: persist the application's map location (centroid is [lng, lat]).
  if (c.property.centroid) { patch.lng = c.property.centroid[0]; patch.lat = c.property.centroid[1] }
  return patch
}

// Map a backend consultation row to the planner's Referral shape so specialist
// responses (no-objection / objection / conditional) surface in the console.
function consultationToReferral(c: {
  body_name?: string; department?: string; created_at?: string; circulated_at?: string | null
  response_notes?: string | null; response?: string | null; response_status?: string
}): Referral {
  const outcomeMap: Record<string, Referral['outcome']> = {
    no_objection: 'no_objection', objection: 'objection',
    conditional_approval: 'conditional', pending: 'pending', no_response: 'pending',
  }
  return {
    department:  c.body_name ?? c.department ?? 'Unknown',
    contactedAt: c.circulated_at ?? c.created_at ?? new Date().toISOString(),
    response:    c.response_notes ?? c.response ?? '',
    outcome:     outcomeMap[c.response_status ?? 'pending'] ?? 'pending',
  }
}

export function emptyCase(): CaseFile {
  return {
    registrationNo: '', fileRef: '', permitId: null, status: 'registered',
    applicant: { name:'', idNumber:'', phone:'', email:'' },
    property:  { standNo:'', ward:'', description:'', titleDeedNo:'' },
    proposal:  { devType:'new_building', description:'', estimatedCost:0,
                 plinthArea:0, floors:1, parkingBays:0 },
    intake:    { feePaid:false, feeReceiptNo:'', feeAmount:0,
                 copiesSubmitted:0, titleDeedAttached:false, bondholderConsent:false,
                 proofOfFunding:false, justification:'' },
    classification: 'routine_26_1',
    applicationDate: new Date().toISOString(),
    acknowledgedDate: null, expiryDate: null,
    dueDiligence: { fileChecks:{}, compatibility:{}, statutoryChecks:{},
                    titleDeedConflict:{ hasConflict:false, deedFileName:'', bondholderConsentReceived:false },
                    referrals: [], completedAt: null },
    committeeReport: { siteContext:'', policyAnalysis:'', publicResponseNotes:'',
                       recommendation:'approve', recommendationReasons:'',
                       tabledAt:null, resolutionAt:null, resolutionText:'' },
    permit: { permitNo:'', useClass:'', permittedDescription:'', conditions:[],
              annexure7Notes:'', issueDate:null, issuingOfficer:'',
              decisionDate:null, notificationDate:null, decisionAuthority:'',
              implementationPeriodMonths: DEFAULT_IMPLEMENTATION_MONTHS,
              documentVersion:null },
    notices: { ackSentAt:null, ackReturnedAt:null, publicNotice:null,
               objections:[], outcomeLetterSentAt:null },
    lastEditedAt: new Date().toISOString(),
    revision: 0,
  }
}

export function providePlannerCase(): PlannerCaseContext {
  const current = ref<CaseFile | null>(null)
  const syncPending = ref(false)
  const conflict = ref(false)
  const intakeSeed = ref<StandSeed | null>(null)
  function seedIntake(seed: StandSeed) { intakeSeed.value = seed }

  // Per-instance save / retry plumbing. Keeping these inside the
  // factory ensures two simultaneous <StatutoryShell> mounts (rare but
  // possible: split-screen review, tests, HMR) don't share state.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let retryQueue: Array<() => Promise<void>> = []

  async function flushRetryQueue() {
    const pending = retryQueue.slice()
    retryQueue = []
    for (const op of pending) {
      try { await op() } catch { retryQueue.push(op) }
    }
  }

  function queueRetry(op: () => Promise<void>) {
    retryQueue.push(op)
  }

  const step2Unlocked  = computed(() => !!current.value?.permitId)
  const step3Unlocked  = computed(() => !!current.value?.dueDiligence.completedAt)
  const step4Unlocked  = computed(() => {
    const c = current.value
    if (!c?.committeeReport.resolutionAt) return false
    return c.committeeReport.recommendation === 'approve'
        || c.committeeReport.recommendation === 'approve_modified'
  })
  const step5Available = computed(() => true)

  // Performs ONLY the dmApi side-effect for a registration. Idempotent in the
  // sense that on success it patches the same `target` reference with the
  // server-assigned id/registrationNo without clobbering anything the user has
  // typed in the meantime. Safe to enqueue for retry.
  async function persistRegistration(target: CaseFile) {
    const payload: Partial<PermitApplication> = {
      stand_number:        target.property.standNo,
      suburb_ward:         target.property.ward,
      applicant_name:      target.applicant.name,
      applicant_id_number: target.applicant.idNumber,
      applicant_phone:     target.applicant.phone || null,
      applicant_email:     target.applicant.email || null,
      development_type:    target.proposal.devType,
      description:         target.proposal.description || null,
      status:              'registered',
      fee_paid:            target.intake.feePaid,
      // GIS: pin the application on the map at registration (centroid = [lng, lat]).
      ...(target.property.centroid
        ? { lng: target.property.centroid[0], lat: target.property.centroid[1] }
        : {}),
    }
    const created = await dmApi.createPermit(payload)
    target.permitId = created.id
    target.status = created.status ?? 'registered'
    target.revision = created.revision ?? 0
    if (!target.registrationNo) {
      target.registrationNo = caseRef(created)
    }
    target.fileRef = `file/${target.registrationNo}`
    // Persist the rest of the case file (proposal detail, classification, etc.)
    // now that we have a permit id — best-effort; the debounced save() retries.
    try { await dmApi.updateCase(created.id, caseToPatch(target)) } catch { syncPending.value = true }
    writeLocal(target)
    if (current.value === target) syncPending.value = false
  }

  async function registerNew(draft: Partial<CaseFile>) {
    const seed: CaseFile = { ...emptyCase(), ...draft, lastEditedAt: new Date().toISOString() }
    current.value = seed
    if (!seed.permitId) {
      try {
        await persistRegistration(seed)
      } catch {
        // Backend unreachable — keep the case in memory + localStorage,
        // mark sync pending, and queue the dmApi POST (only) for retry.
        // Subsequent retries do NOT re-run registerNew, so they won't
        // clobber whatever the user has typed in the meantime.
        syncPending.value = true
        queueRetry(() => persistRegistration(seed))
      }
    }
    writeLocal(seed)
    pushRecent(seed)
  }

  async function loadFromPermit(id: string) {
    conflict.value = false   // a fresh load resolves any earlier lost-lock state
    const cached = readLocal(id)
    let merged: CaseFile
    let fromServer = false
    try {
      const server = await dmApi.getPermit(id)
      // Prefer the local draft if it's newer than the server copy.
      if (cached && new Date(cached.lastEditedAt) > new Date(server.updated_at)) {
        merged = cached
      } else {
        fromServer = true
        // The planning record now lives on the permit (migration 082):
        // prefer server-stored case fields, falling back to any local draft.
        merged = {
          ...emptyCase(),
          permitId: server.id,
          status: server.status,
          registrationNo: caseRef(server),
          fileRef: `file/${server.dev_register_no || server.id}`,
          applicant: { name: server.applicant_name, idNumber: server.applicant_id_number,
                       phone: server.applicant_phone ?? '', email: server.applicant_email ?? '' },
          property:  { standNo: server.stand_number, ward: server.suburb_ward,
                       description: server.description ?? '', titleDeedNo: server.title_deed_no ?? '',
                       centroid: (server.lng != null && server.lat != null)
                         ? [server.lng, server.lat] as [number, number] : undefined },
          proposal:  { devType: server.development_type,
                       description: server.description ?? '',
                       estimatedCost: server.estimated_cost ?? 0,
                       plinthArea: server.plinth_area ?? 0,
                       floors: server.floors ?? 1,
                       parkingBays: server.parking_bays ?? 0 },
          intake:    { feePaid: server.fee_paid, feeReceiptNo: '', feeAmount: 0,
                       copiesSubmitted: 3, titleDeedAttached: true, bondholderConsent: false,
                       proofOfFunding: false, justification: '' },
          classification: (server.classification ?? 'routine_26_1') as unknown as Classification,
          applicationDate: server.created_at,
          acknowledgedDate: server.received_at,
          expiryDate: server.statutory_due_date ?? null,
          dueDiligence:    (server.due_diligence as CaseFile['dueDiligence'])    ?? cached?.dueDiligence    ?? emptyCase().dueDiligence,
          committeeReport: (server.committee_report as CaseFile['committeeReport']) ?? cached?.committeeReport ?? emptyCase().committeeReport,
          permit: {
            ...(cached?.permit ?? emptyCase().permit),
            conditions: (server.permit_conditions as CaseFile['permit']['conditions']) ?? cached?.permit?.conditions ?? [],
          },
          notices: cached?.notices ?? emptyCase().notices,
          lastEditedAt: server.updated_at,
          revision: server.revision ?? 0,
        }
        // Server-authoritative determination fields override any local draft:
        // the officer's browser is not the record of when a decision was made.
        if (server.decision_at) merged.permit.decisionDate = String(server.decision_at).slice(0, 10)
        if (server.decision_officer) merged.permit.issuingOfficer = server.decision_officer
        if (server.zoning_assessment) {
          merged.dueDiligence.zoningAssessment = server.zoning_assessment as ZoningSnapshot
        }
      }
    } catch {
      if (cached) { merged = cached; syncPending.value = true }
      else throw new Error('Could not load permit')
    }

    // A localStorage draft written before the decision-record fields existed
    // lacks them entirely. Backfill from emptyCase() so every consumer can rely
    // on the shape, and default revision to 0 (the server's column default).
    merged.permit = { ...emptyCase().permit, ...merged.permit }
    merged.revision = merged.revision ?? 0

    // Hydrate referral outcomes from server consultations so specialist
    // findings return to the planner console (closes the referral loop).
    try {
      const consults = await dmApi.listConsultations(id)
      if (Array.isArray(consults) && consults.length) {
        merged.dueDiligence.referrals = consults.map(consultationToReferral)
      }
    } catch { /* keep whatever referrals we already have */ }

    current.value = merged
    // Only persist + bump recents when we actually got a fresh server load.
    // Falling back to a stale cached copy shouldn't refresh the "recently
    // opened" timestamp or rewrite identical bytes to localStorage.
    if (fromServer) {
      writeLocal(merged)
      pushRecent(merged)
    }
  }

  /** Debounced save (800ms). Writes the current case to localStorage and
   *  flushes any pending dmApi retries. The public signature is unchanged
   *  since Task 5; Task 6 layered the persistence behind it. */
  function save() {
    if (!current.value) return
    current.value.lastEditedAt = new Date().toISOString()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      // Cleared on fire: beforeUnload reads a live handle as "unsaved", and a
      // stale one made every refresh after the first save ask to leave.
      saveTimer = null
      const c = current.value
      if (!c) return
      writeLocal(c)
      // Persist the planning record to the backend (system-of-record), not
      // just localStorage. Best-effort with retry so offline edits survive.
      if (c.permitId) {
        const permitId = c.permitId
        syncPending.value = true
        const persist = async () => {
          const updated = await dmApi.updateCase(permitId, caseToPatch(c))
          // Adopt the revision the server just bumped to, so the NEXT save
          // carries a matching expectedRevision instead of 409ing forever.
          if (typeof updated?.revision === 'number') c.revision = updated.revision
          if (current.value === c) syncPending.value = false
        }
        persist().catch((e) => {
          syncPending.value = true
          // A 409 means another officer wrote to this case. Retrying with the
          // same stale revision can only 409 again, and silently re-sending
          // would be exactly the overwrite the lock exists to prevent — so
          // surface it and let the officer reload.
          if (isConflictError(e)) { conflict.value = true; return }
          queueRetry(persist)
        })
      }
      void flushRetryQueue()
    }, SAVE_DEBOUNCE_MS)
  }

  function clear() {
    current.value = null
  }

  // ── Browser-only lifecycle hooks ───────────────────────────────────
  function beforeUnload(e: BeforeUnloadEvent) {
    if (retryQueue.length || saveTimer) {
      e.preventDefault()
      e.returnValue = ''
    }
  }

  function onWindowFocus() {
    const c = current.value
    if (!c?.permitId) return
    const cached = readLocal(c.permitId)
    if (!cached) return
    if (new Date(cached.lastEditedAt) > new Date(c.lastEditedAt)) {
      // Silent reload (spec § 8.4 originally proposed a confirm dialog;
      // simplified to silent overwrite because composables can't import
      // useUiFeedback without circular-dep risk. Worth revisiting once
      // <StatutoryShell> can inject a prompt callback if needed.)
      current.value = cached
    }
  }

  if (typeof window !== 'undefined' && getCurrentScope()) {
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('focus', onWindowFocus)
    onScopeDispose(() => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('focus', onWindowFocus)
    })
  }

  const ctx: PlannerCaseContext = {
    current,
    step2Unlocked, step3Unlocked, step4Unlocked, step5Available,
    loadFromPermit, registerNew, save, clear,
    syncPending: computed(() => syncPending.value),
    conflict,
    intakeSeed,
    seedIntake,
  }
  provide(PLANNER_CASE_KEY, ctx)
  return ctx
}

export function usePlannerCase(): PlannerCaseContext {
  const ctx = inject(PLANNER_CASE_KEY)
  if (!ctx) throw new Error('usePlannerCase() called outside <PlannerShell> or <StatutoryShell>')
  return ctx
}

/**
 * Provides a planner-case context iff one isn't already provided by an
 * ancestor. Use from wrappers that may be mounted standalone OR as a
 * descendant of a larger workspace that already provides the context —
 * lets the workspace + the shell share one case file across sections.
 */
export function useOrProvidePlannerCase(): PlannerCaseContext {
  const existing = inject(PLANNER_CASE_KEY, null)
  if (existing) return existing
  return providePlannerCase()
}
