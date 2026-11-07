// ─── useCitizenCase ────────────────────────────────────────────────
// Active citizen / applicant case file shared across the Citizen
// Portal sections. Mirrors the other operator-workspace composables:
// provide at the shell, inject in each section.
//
// Persistence:
//   Tier 1 — dmApi for the canonical permit records (when the citizen
//            has already submitted and the backend has assigned a case).
//   Tier 2 — reactive in-memory state for the application currently
//            being filled in (multi-step TPD wizard).
//   Tier 3 — localStorage for citizen-only drafts, document staging
//            and appeal filings.
// ───────────────────────────────────────────────────────────────────

import {
  ref, computed, provide, inject, onScopeDispose, getCurrentScope,
  type ComputedRef, type InjectionKey, type Ref,
} from 'vue'
import {
  dmApi, type PermitApplication, type DevType,
  type Appeal, type AppealStatus,
} from '@/services/developmentManagementService'
import { parseOptionalNumber, toPermitDevType } from '@/utils/citizenValidation'

// ── Submit options for payment gating ────────────────────────────
export interface SubmitOpts {
  payIntent?: { phone: string; walletCcy: 'USD' | 'ZWG' }
}

// ── Shared application lifecycle (used by every portal) ──────────
export type LifecycleStatus =
  | 'draft' | 'submitted' | 'received' | 'incomplete' | 'complete'
  | 'acknowledged' | 'due_diligence' | 'gis_mapping' | 'technical_circulation'
  | 'public_notice' | 'objection_response' | 'committee_report'
  | 'committee_review' | 'council_decision' | 'permit_drafting'
  | 'permit_issued' | 'refused' | 'appealed'
  | 'under_construction' | 'inspection_required' | 'inspection_failed'
  | 'final_inspection' | 'occupation_certificate_issued'
  | 'lapsed' | 'enforcement'

export interface LifecycleStage {
  key: LifecycleStatus
  label: string
  actor: 'citizen' | 'clerk' | 'planner' | 'gis' | 'committee' | 'council'
       | 'inspector' | 'eho' | 'surveyor' | 'town_clerk' | 'court'
  citizenAction: string
  description: string
}

export const APPLICATION_LIFECYCLE: LifecycleStage[] = [
  { key:'draft',                   label:'Draft',                      actor:'citizen',
    citizenAction:'Complete the TPD form and gather documents',
    description:'Application is being prepared by the citizen.' },
  { key:'submitted',               label:'Submitted',                  actor:'clerk',
    citizenAction:'Wait for clerk acknowledgement',
    description:'Application lodged with the Planning Clerk.' },
  { key:'received',                label:'Received',                   actor:'clerk',
    citizenAction:'Confirm fee receipt',
    description:'Clerk has stamped and filed the application.' },
  { key:'incomplete',              label:'Documents outstanding',      actor:'citizen',
    citizenAction:'Supply the missing documents',
    description:'Clerk has flagged documents missing or unsigned.' },
  { key:'complete',                label:'Completeness confirmed',     actor:'clerk',
    citizenAction:'Wait for acknowledgement letter',
    description:'All required documents on file.' },
  { key:'acknowledged',            label:'Acknowledged',               actor:'clerk',
    citizenAction:'No action — the council now has three months to decide',
    description:'Clerk issued acknowledgement; three-month determination clock running (s.26(7)).' },
  { key:'due_diligence',           label:'Due diligence',              actor:'planner',
    citizenAction:'Respond to planner queries if asked',
    description:'EO Planner is checking land rights, layout, conditions.' },
  { key:'gis_mapping',             label:'GIS mapping',                actor:'gis',
    citizenAction:'No action',
    description:'GIS Officer is producing site / abutter maps.' },
  { key:'technical_circulation',   label:'Technical circulation',      actor:'planner',
    citizenAction:'No action',
    description:'Application circulating to Health, Surveyor, utilities for input.' },
  { key:'public_notice',           label:'Public notice period',       actor:'citizen',
    citizenAction:'Publish notice in newspaper, post on site, notify abutting owners',
    description:'Section 26(3) public notification is running.' },
  { key:'objection_response',      label:'Objection response',         actor:'citizen',
    citizenAction:'Respond to objections in writing within 14 days',
    description:'Council has received objections — applicant must respond.' },
  { key:'committee_report',        label:'Committee report drafting',  actor:'planner',
    citizenAction:'No action',
    description:'Officer report being prepared for Works and Planning Committee.' },
  { key:'committee_review',        label:'Committee review',           actor:'committee',
    citizenAction:'Optionally attend if invited',
    description:'Works and Planning Committee is reviewing the application.' },
  { key:'council_decision',        label:'Council decision',           actor:'council',
    citizenAction:'No action',
    description:'Full Council resolving on the recommendation.' },
  { key:'permit_drafting',         label:'Permit drafting',            actor:'planner',
    citizenAction:'No action',
    description:'Approval granted — permit being drafted.' },
  { key:'permit_issued',           label:'Permit issued',              actor:'clerk',
    citizenAction:'Collect permit, settle balance, commence within 12 months',
    description:'Permit is ready to be collected from the Clerk.' },
  { key:'refused',                 label:'Refused',                    actor:'clerk',
    citizenAction:'Decide whether to appeal within one month of notification',
    description:'Application refused; reasons in dispatch letter.' },
  { key:'appealed',                label:'Appealed',                   actor:'court',
    citizenAction:'Engage representation and prepare appeal record',
    description:'Appeal filed; Council is preparing the record.' },
  { key:'under_construction',      label:'Under construction',         actor:'citizen',
    citizenAction:'Request stage inspections in order',
    description:'Works have commenced; nine statutory inspections to follow.' },
  { key:'inspection_required',     label:'Stage inspection due',       actor:'citizen',
    citizenAction:'Notify Inspector ≥ 48 hours before reaching the stage',
    description:'A statutory inspection stage is imminent.' },
  { key:'inspection_failed',       label:'Inspection failed',          actor:'citizen',
    citizenAction:'Rectify defects and request re-inspection',
    description:'Inspector found defects; works cannot proceed.' },
  { key:'final_inspection',        label:'Final joint inspection',     actor:'inspector',
    citizenAction:'Ensure premises ready for joint inspection with EHO + Plumber',
    description:'Stage 9 joint inspection scheduled.' },
  { key:'occupation_certificate_issued', label:'Occupation certificate issued', actor:'inspector',
    citizenAction:'Take occupation; retain certificate for transfer',
    description:'Annexure 13 certificate issued; building may be occupied.' },
  { key:'lapsed',                  label:'Lapsed',                     actor:'clerk',
    citizenAction:'Re-apply if you still wish to build',
    description:'Permit lapsed (works did not commence within 12 months).' },
  { key:'enforcement',             label:'Enforcement',                actor:'inspector',
    citizenAction:'Comply with the order within the period stated',
    description:'Enforcement / prohibition order in force against the property.' },
]

export function lifecycleStage(s: LifecycleStatus): LifecycleStage {
  return APPLICATION_LIFECYCLE.find(x => x.key === s) ?? APPLICATION_LIFECYCLE[0]
}

// ── Citizen draft (multi-step TPD wizard) ────────────────────────
export interface CitizenDraft {
  id: string
  // Step 1 — applicant identity (TPD Part I, Q1–2)
  applicant_name: string
  applicant_id_number: string
  applicant_phone: string
  applicant_email: string
  applicant_address: string                                  // postal/physical address
  applicant_capacity: 'owner' | 'agent' | 'lessee' | ''      // capacity in which applying
  owner_name: string                                         // when applicant is agent/lessee
  owner_phone: string
  // Step 2 — site (TPD Part I, Q3–6)
  stand_number: string
  suburb_ward: string
  title_deed_no: string
  title_deed_type: 'deed_of_transfer' | 'certificate_of_registered_title' | 'deed_of_grant' | ''
  lease_number: string
  site_area_sqm: string                                      // area of site / property
  title_deed_conflict: boolean                               // Q5 — restrictions conflict?
  present_use: string                                        // Q6 — present/last use
  // Step 3 — proposal (TPD Part I/II/III, Q7–14)
  development_type: ApplicationCategory | DevType | ''
  description: string
  works_nature: 'new_building' | 'alteration' | 'addition' | 'change_of_use' | ''  // Q7b
  estimated_cost: string                                     // Q10b — estimated cost of development
  external_floor_area: string                                // Q10a
  new_access: boolean                                        // Q8 — new/altered access?
  new_access_detail: string
  // Part III — multiple residential / commercial / industrial (Q12–14)
  num_floors: string
  total_floor_area: string
  parking_detail: string
  industrial_processes: string
  industrial_effluent: string
  industrial_emissions: string
  industrial_noise: string
  retail_on_site: boolean
  // Step 5 — declarations
  consent_to_publish: boolean
  declaration_signed: boolean
  owner_consent_confirmed: boolean                           // owner consent when applying as agent
  // Document staging
  documents: CitizenDocumentStub[]
  // Bookkeeping
  created_at: string
  updated_at: string
  submitted_at: string | null
  permit_application_id: string | null  // populated once dmApi creates the permit
}

export interface CitizenDocumentStub {
  id: string
  doc_type: CitizenDocType
  filename: string
  size_bytes: number
  uploaded_at: string
  // Upload tracking, set during submitDraft. `uploaded` flips true once the
  // file is attached to the permit; `remote_id` is the backend PermitDocument
  // id; `upload_error` records why an attach failed so the UI can prompt a
  // re-upload. All optional so previously-persisted drafts still parse.
  uploaded?: boolean
  remote_id?: string | null
  upload_error?: 'file_unavailable' | 'upload_failed' | null
}

export type CitizenDocType =
  | 'title_deed' | 'consent_letter' | 'building_plan' | 'engineer_drawing'
  | 'site_plan' | 'agent_authority' | 'company_resolution' | 'identity'
  | 'mining_restoration' | 'industrial_disclosure' | 'other'

export const DOC_TYPE_LABELS: Record<CitizenDocType, string> = {
  title_deed:            'Title deed',
  consent_letter:        'Consent letter (bondholder / lessor / lessee)',
  building_plan:         'Building plan (5 copies)',
  engineer_drawing:      'Engineer drawings (structural / civil)',
  site_plan:             'Site plan',
  agent_authority:       'Agent authority letter',
  company_resolution:    'Company resolution',
  identity:              'ID / passport',
  mining_restoration:    'Mining restoration programme',
  industrial_disclosure: 'Industrial processes disclosure',
  other:                 'Other supporting document',
}

// ── Appeals ──────────────────────────────────────────────────────
// The appeal record IS the backend's Appeal shape (system of record). Lodged
// by the citizen, advanced only by council staff. Re-exported so existing
// `import type { AppealRecord } from '@/composables/useCitizenCase'` keeps
// working.
export type AppealRecord = Appeal
export type { AppealStatus }

export type DocUploadFailure = { filename: string; reason: NonNullable<CitizenDocumentStub['upload_error']> }

/**
 * Thrown by submitDraft when the permit was created but one or more staged
 * documents failed to upload. The application IS submitted — the UI should
 * show a partial-success message and let the citizen re-upload the named
 * files (retryDocumentUploads) rather than treat this as a hard failure.
 */
export class DocumentUploadError extends Error {
  constructor(
    public readonly permit: PermitApplication,
    public readonly failures: DocUploadFailure[],
  ) {
    super(`${failures.length} document(s) could not be uploaded`)
    this.name = 'DocumentUploadError'
  }
}

// ── Case context ─────────────────────────────────────────────────
export interface CitizenCaseContext {
  drafts: Ref<CitizenDraft[]>
  appeals: Ref<AppealRecord[]>
  applications: Ref<PermitApplication[]>
  applicationsLoading: Ref<boolean>
  currentDraftId: Ref<string | null>
  currentDraft: ComputedRef<CitizenDraft | null>
  newDraft: () => CitizenDraft
  selectDraft: (id: string) => void
  removeDraft: (id: string) => void
  stageDocument: (
    draftId: string,
    d: Omit<CitizenDocumentStub, 'id' | 'uploaded_at' | 'uploaded' | 'remote_id' | 'upload_error'>,
    file: File,
  ) => CitizenDocumentStub
  removeDocument: (draftId: string, docId: string) => void
  submitDraft: (draftId: string, opts?: SubmitOpts) => Promise<PermitApplication>
  /** Re-attempt uploading any still-pending staged documents. Returns the
   *  number newly uploaded. Files must still be in memory (same session). */
  retryDocumentUploads: (draftId: string) => Promise<number>
  refreshApplications: () => Promise<void>
  /** Lodge an appeal against a refused permit. POSTs to the backend (system
   *  of record) and prepends the returned record. Async — throws on failure
   *  so the form can keep its state. */
  fileAppeal: (input: { permit_application_id: string; grounds: string }) => Promise<AppealRecord>
  /** Reload the citizen's own appeals from the backend. */
  refreshAppeals: () => Promise<void>
  save: () => void
  clear: () => void
}

const CITIZEN_KEY: InjectionKey<CitizenCaseContext> = Symbol('CitizenCase')

const STORAGE_DRAFTS  = 'citizen_drafts_v1'
// Appeals are no longer cached in localStorage — the backend is the single
// source of truth (loaded via refreshAppeals → dmApi.listAppeals).
const SAVE_DEBOUNCE_MS = 800

function safeRead<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback }
  catch { return fallback }
}
function safeWrite(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* no-op */ }
}
function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function emptyDraft(): CitizenDraft {
  const now = new Date().toISOString()
  return {
    id: uid('drf_'),
    applicant_name: '', applicant_id_number: '',
    applicant_phone: '', applicant_email: '',
    applicant_address: '', applicant_capacity: '',
    owner_name: '', owner_phone: '',
    stand_number: '', suburb_ward: '', title_deed_no: '',
    title_deed_type: '', lease_number: '', site_area_sqm: '',
    title_deed_conflict: false, present_use: '',
    development_type: '', description: '',
    works_nature: '', estimated_cost: '', external_floor_area: '',
    new_access: false, new_access_detail: '',
    num_floors: '', total_floor_area: '', parking_detail: '',
    industrial_processes: '', industrial_effluent: '',
    industrial_emissions: '', industrial_noise: '', retail_on_site: false,
    consent_to_publish: false, declaration_signed: false, owner_consent_confirmed: false,
    documents: [],
    created_at: now, updated_at: now,
    submitted_at: null, permit_application_id: null,
  }
}

/** A stub counts as attached only if it uploaded or its bytes are still in memory. */
export function isAttached(d: CitizenDocumentStub): boolean {
  return !!d.uploaded || !d.upload_error
}

/** Drafts restored from storage never have their file bytes, so any
 *  not-yet-uploaded stub needs re-attaching. */
export function restoreDrafts(raw: CitizenDraft[]): CitizenDraft[] {
  for (const d of raw) {
    for (const doc of d.documents ?? []) {
      if (!doc.uploaded) doc.upload_error = 'file_unavailable'
    }
  }
  return raw
}

export function provideCitizenCase(): CitizenCaseContext {
  const drafts = ref<CitizenDraft[]>(restoreDrafts(safeRead<CitizenDraft[]>(STORAGE_DRAFTS, [])))
  const appeals = ref<AppealRecord[]>([])
  const applications = ref<PermitApplication[]>([])
  const applicationsLoading = ref(false)
  const currentDraftId = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const currentDraft = computed<CitizenDraft | null>(() =>
    drafts.value.find(d => d.id === currentDraftId.value) ?? null)

  function persistDrafts() { safeWrite(STORAGE_DRAFTS, drafts.value) }

  function newDraft(): CitizenDraft {
    const d = emptyDraft()
    drafts.value.unshift(d)
    persistDrafts()
    currentDraftId.value = d.id
    return d
  }

  function selectDraft(id: string) { currentDraftId.value = id }

  function removeDraft(id: string) {
    drafts.value = drafts.value.filter(d => d.id !== id)
    persistDrafts()
    if (currentDraftId.value === id) currentDraftId.value = null
  }

  // Staged file bytes, keyed by document stub id. In-memory only — File
  // objects can't be JSON-serialised, so localStorage keeps just the metadata
  // stubs. submitDraft uploads these to the permit. A draft staged in one
  // session and submitted in another keeps its stubs but loses the bytes;
  // those surface as upload_error: 'file_unavailable'.
  const stagedFiles = new Map<string, File>()

  function stageDocument(
    draftId: string,
    d: Omit<CitizenDocumentStub, 'id' | 'uploaded_at' | 'uploaded' | 'remote_id' | 'upload_error'>,
    file: File,
  ) {
    const draft = drafts.value.find(x => x.id === draftId)
    if (!draft) throw new Error('Draft not found')
    const stub: CitizenDocumentStub = {
      ...d,
      id: uid('doc_'),
      uploaded_at: new Date().toISOString(),
      uploaded: false,
      remote_id: null,
      upload_error: null,
    }
    stagedFiles.set(stub.id, file)
    // A fresh file of this type replaces any stub whose bytes were lost on reload.
    draft.documents = draft.documents.filter(x => x.doc_type !== d.doc_type || isAttached(x))
    draft.documents.push(stub)
    draft.updated_at = new Date().toISOString()
    persistDrafts()
    return stub
  }

  function removeDocument(draftId: string, docId: string) {
    const draft = drafts.value.find(x => x.id === draftId)
    if (!draft) return
    draft.documents = draft.documents.filter(d => d.id !== docId)
    stagedFiles.delete(docId)
    draft.updated_at = new Date().toISOString()
    persistDrafts()
  }

  // Upload every not-yet-uploaded staged document for a draft to its permit.
  // Best-effort: records per-document outcome on the stub and returns the
  // failures so the caller can surface a partial-success message. Files that
  // succeed are dropped from memory; failures keep their bytes for retry.
  async function uploadDraftDocuments(draft: CitizenDraft): Promise<DocUploadFailure[]> {
    const permitId = draft.permit_application_id
    const failures: DocUploadFailure[] = []
    if (!permitId) return failures
    for (const stub of draft.documents) {
      if (stub.uploaded) continue
      const file = stagedFiles.get(stub.id)
      if (!file) {
        stub.upload_error = 'file_unavailable'
        failures.push({ filename: stub.filename, reason: 'file_unavailable' })
        continue
      }
      try {
        const doc = await dmApi.uploadPermitDocument(permitId, file, stub.doc_type)
        stub.uploaded = true
        stub.remote_id = doc.id
        stub.upload_error = null
        stagedFiles.delete(stub.id)
      } catch {
        stub.upload_error = 'upload_failed'
        failures.push({ filename: stub.filename, reason: 'upload_failed' })
      }
    }
    persistDrafts()
    return failures
  }

  async function retryDocumentUploads(draftId: string): Promise<number> {
    const draft = drafts.value.find(d => d.id === draftId)
    if (!draft) return 0
    const pendingBefore = draft.documents.filter(d => !d.uploaded).length
    await uploadDraftDocuments(draft)
    const pendingAfter = draft.documents.filter(d => !d.uploaded).length
    return pendingBefore - pendingAfter
  }

  async function submitDraft(draftId: string, opts?: SubmitOpts): Promise<PermitApplication> {
    const draft = drafts.value.find(d => d.id === draftId)
    if (!draft) throw new Error('Draft not found')
    if (draft.development_type === '') throw new Error('Development type required')
    const created = await dmApi.createPermit({
      stand_number: draft.stand_number.trim(),
      suburb_ward: draft.suburb_ward.trim(),
      applicant_name: draft.applicant_name.trim(),
      applicant_id_number: draft.applicant_id_number.trim().toUpperCase(),
      applicant_phone: draft.applicant_phone || null,
      applicant_email: draft.applicant_email || null,
      applicant_address: draft.applicant_address || null,
      applicant_capacity: draft.applicant_capacity || null,
      owner_name: draft.owner_name || null,
      owner_phone: draft.owner_phone || null,
      title_deed_no: draft.title_deed_no || null,
      title_deed_type: draft.title_deed_type || null,
      lease_number: draft.lease_number || null,
      site_area_sqm: parseOptionalNumber(draft.site_area_sqm),
      title_deed_conflict: draft.title_deed_conflict,
      present_use: draft.present_use || null,
      // Land-use category stays in classification; backend CHECK needs DevType.
      development_type: toPermitDevType(draft.development_type, draft.works_nature),
      classification: draft.development_type || null,
      description: draft.description || null,
      works_nature: draft.works_nature || null,
      estimated_cost: parseOptionalNumber(draft.estimated_cost),
      external_floor_area: parseOptionalNumber(draft.external_floor_area),
      plinth_area: parseOptionalNumber(draft.external_floor_area || draft.total_floor_area),
      floors: parseOptionalNumber(draft.num_floors),
      new_access: draft.new_access,
      new_access_detail: draft.new_access_detail || null,
      ...(opts?.payIntent ? { pay_intent: opts.payIntent } : {}),
    } as any)
    draft.submitted_at = new Date().toISOString()
    draft.permit_application_id = created.id
    draft.updated_at = draft.submitted_at
    persistDrafts()
    // Now that the permit exists, upload the staged application documents and
    // attach them to it. The application is already submitted; document
    // failures are reported as a partial success (DocumentUploadError) so the
    // citizen can re-upload without re-submitting.
    const failures = await uploadDraftDocuments(draft)
    await refreshApplications()
    if (failures.length) throw new DocumentUploadError(created, failures)
    return created
  }

  async function refreshApplications() {
    applicationsLoading.value = true
    try {
      const r = await dmApi.listPermits({ limit: 200, offset: 0 })
      applications.value = r.data
    } catch {
      // leave existing list in place
    } finally {
      applicationsLoading.value = false
    }
  }

  async function refreshAppeals(): Promise<void> {
    try {
      // No `mine` flag: the register scopes a non-staff caller to their own
      // appeals server-side, so asking for anything else would be ignored.
      appeals.value = await dmApi.listAppeals()
    } catch {
      // Leave the existing list in place; the citizen can retry. The backend
      // remains the source of truth — we never fall back to localStorage.
    }
  }

  // The hearing date is the Court's to set and the council's to record — an
  // appellant lodges grounds, nothing more.
  async function fileAppeal(input: {
    permit_application_id: string; grounds: string
  }): Promise<AppealRecord> {
    const created = await dmApi.createAppeal(input.permit_application_id, {
      grounds: input.grounds,
    })
    appeals.value.unshift(created)
    return created
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      persistDrafts()
    }, SAVE_DEBOUNCE_MS)
  }

  function clear() { currentDraftId.value = null }

  const ctx: CitizenCaseContext = {
    drafts, appeals, applications, applicationsLoading, currentDraftId, currentDraft,
    newDraft, selectDraft, removeDraft,
    stageDocument, removeDocument,
    submitDraft, retryDocumentUploads, refreshApplications,
    fileAppeal, refreshAppeals,
    save, clear,
  }
  provide(CITIZEN_KEY, ctx)

  if (typeof window !== 'undefined' && getCurrentScope()) {
    onScopeDispose(() => { if (saveTimer) clearTimeout(saveTimer) })
  }
  return ctx
}

export function useCitizenCase(): CitizenCaseContext {
  const ctx = inject(CITIZEN_KEY)
  if (!ctx) throw new Error('useCitizenCase() called outside <CitizenPortalView> tree')
  return ctx
}

export function useOrProvideCitizenCase(): CitizenCaseContext {
  const existing = inject(CITIZEN_KEY, null)
  if (existing) return existing
  return provideCitizenCase()
}

// ── Required documents per development type ─────────────────────
export interface RequiredDocSpec { type: CitizenDocType; mandatory: boolean; notes: string }

// Land-use category drives the document checklist. submitDraft maps it,
// with works_nature, onto backend DevType via toPermitDevType().
export type ApplicationCategory =
  | 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'institutional'
  | 'subdivision' | 'change_of_use' | 'advertisement' | 'other'

export const REQUIRED_DOCS_BY_TYPE: Record<ApplicationCategory, RequiredDocSpec[]> = {
  residential: [
    { type: 'title_deed',        mandatory: true,  notes: 'Title deed extract or lease' },
    { type: 'site_plan',         mandatory: true,  notes: 'Scale 1:100–1:500' },
    { type: 'building_plan',     mandatory: true,  notes: '5 copies for circulation' },
    { type: 'identity',          mandatory: true,  notes: 'ID / passport of applicant' },
    { type: 'consent_letter',    mandatory: false, notes: 'If property is bonded or leased' },
    { type: 'agent_authority',   mandatory: false, notes: 'If submitted by an agent' },
  ],
  commercial: [
    { type: 'title_deed',        mandatory: true,  notes: 'Title deed or lease' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
    { type: 'building_plan',     mandatory: true,  notes: '5 copies; architect-stamped' },
    { type: 'engineer_drawing',  mandatory: true,  notes: 'Structural sign-off' },
    { type: 'company_resolution',mandatory: true,  notes: 'If applicant is a company' },
    { type: 'consent_letter',    mandatory: false, notes: '' },
  ],
  industrial: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'building_plan',     mandatory: true,  notes: '' },
    { type: 'engineer_drawing',  mandatory: true,  notes: '' },
    { type: 'industrial_disclosure', mandatory: true, notes: 'Effluent / emissions / processes' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
  ],
  agricultural: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
    { type: 'building_plan',     mandatory: false, notes: 'For permanent structures only' },
  ],
  institutional: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
    { type: 'building_plan',     mandatory: true,  notes: '' },
    { type: 'engineer_drawing',  mandatory: false, notes: '' },
  ],
  subdivision: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'site_plan',         mandatory: true,  notes: 'Proposed subdivision layout' },
    { type: 'consent_letter',    mandatory: false, notes: 'Bondholder consent' },
  ],
  change_of_use: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
    { type: 'consent_letter',    mandatory: false, notes: '' },
  ],
  advertisement: [
    { type: 'site_plan',         mandatory: true,  notes: 'Position, dimensions, illumination' },
    { type: 'consent_letter',    mandatory: false, notes: 'Property owner consent if not owner' },
  ],
  other: [
    { type: 'title_deed',        mandatory: true,  notes: '' },
    { type: 'site_plan',         mandatory: true,  notes: '' },
  ],
}
