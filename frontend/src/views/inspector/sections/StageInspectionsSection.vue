<script setup lang="ts">
// Stage inspection workspace — checklist, evidence, site, referrals,
// follow-up, documents and audit against the selected permit.
import { ref, computed, watch } from 'vue'
import {
  dmApi, isBuildingPlanApproved,
  type ChecklistItem, type StageInspection,
  type StageInspectionPhoto, type StageScoring, type BuildingPlan,
  type PermitDocument, type PermitEvent, type Consultation,
  type FieldEvent, type FieldEventType,
} from '@/services/developmentManagementService'
import {
  useInspectionCase, INSPECTION_STAGES_STATIC, type Verdict,
} from '@/composables/useInspectionCase'
import { imageFileError, isPositiveNumber } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import InspectionEvidenceGallery from '@/components/inspector/InspectionEvidenceGallery.vue'
import InspectionReferralForm from '@/components/inspector/InspectionReferralForm.vue'
import InspectionSiteCard from '@/components/inspector/InspectionSiteCard.vue'
import InspectionGeoVerification from '@/components/inspector/InspectionGeoVerification.vue'
import InspectorCasePicker from '@/components/inspector/InspectorCasePicker.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  captureGps, isGpsFailure, gpsFailureMessage,
} from '@/composables/useInspectionNavigation'
import { checklistComplete, type ItemMark } from '@/composables/useInspectorFieldCapture'
import {
  enqueueEvidence, listEvidence, flushEvidence, discardEvidence,
  EvidenceNotQueuedError, type QueuedEvidence,
} from '@/inspector/evidenceQueue'
import {
  saveChecklistDraft, readChecklistDraft, discardChecklistDraft, type ChecklistDraft,
} from '@/inspector/checklistDraft'
import {
  Building, Stamp, Camera, AlertTriangle, CheckCircle2, XCircle,
  Clock, ChevronRight, Lock, Upload, FileText, RotateCcw,
} from 'lucide-vue-next'

type Mark = ItemMark
type DraftChecklistRow = {
  checklist_item_id: number
  result: Mark
  notes: string
  score: number | null
  photo_id?: string | null
}
type Pane = 'site'|'planning'|'checklist'|'evidence'|'referrals'|'followup'|'documents'|'audit'

const ic = useInspectionCase()
const fb = useUiFeedback()

const activeStage = ref(1)
const pane = ref<Pane>('checklist')
const checklist = ref<ChecklistItem[]>([])
const checklistLoading = ref(false)
const stageInspection = ref<StageInspection | null>(null)

// ── Field activity: assigned -> travelling -> arrived -> started -> completed ──
// An append-only timeline (migration 117). GPS is attached when the device gives
// a fix and omitted entirely when it does not — a fabricated position on an
// official record is worse than an absent one.
const fieldEvents = ref<FieldEvent[]>([])
const fieldBusy = ref<FieldEventType | null>(null)

const FIELD_STEPS: ReadonlyArray<{ type: FieldEventType; label: string; hint: string }> = [
  { type: 'travelling',           label: 'Travelling',  hint: 'On the way to site' },
  { type: 'arrived',              label: 'Arrived',     hint: 'On site, with position if available' },
  { type: 'inspection_started',   label: 'Started',     hint: 'Assessment under way' },
  { type: 'inspection_completed', label: 'Completed',   hint: 'Left site' },
]

function hasFieldEvent(t: FieldEventType): boolean {
  return fieldEvents.value.some(e => e.event_type === t)
}

async function loadFieldEvents(inspectionId: string) {
  try { fieldEvents.value = await dmApi.listFieldEvents(inspectionId) }
  catch { fieldEvents.value = [] }
}

async function recordFieldEvent(type: FieldEventType) {
  const insp = stageInspection.value
  if (!insp) {
    fb.showToast('Open the stage inspection record before logging field activity.', 'warning')
    return
  }
  fieldBusy.value = type
  try {
    // Only 'arrived' carries a position: it is the event that evidences
    // attendance. The others are timing, and a fix adds nothing.
    const payload: Parameters<typeof dmApi.recordFieldEvent>[1] = { event_type: type }
    if (type === 'arrived') {
      const gps = await captureGps()
      if (isGpsFailure(gps)) {
        fb.showToast(gpsFailureMessage(gps), 'warning')
      } else {
        payload.observed_lat = gps.lat
        payload.observed_lng = gps.lng
        if (gps.accuracyM != null) payload.accuracy_m = gps.accuracyM
      }
    }
    await dmApi.recordFieldEvent(insp.id, payload)
    await loadFieldEvents(insp.id)
    geoKey.value++
    fb.showToast(`${FIELD_STEPS.find(f => f.type === type)?.label} recorded.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The field event was not recorded.'), 'error')
  } finally {
    fieldBusy.value = null
  }
}

function fmtEventTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const results = ref<Record<string, DraftChecklistRow>>({})
const photos = ref<StageInspectionPhoto[]>([])
const scoring = ref<StageScoring | null>(null)
const saving = ref(false)
const plans = ref<BuildingPlan[]>([])
const documents = ref<PermitDocument[]>([])
const events = ref<PermitEvent[]>([])
const consultations = ref<Consultation[]>([])

const permit = computed(() => ic.current.value?.permit ?? null)
const stages = INSPECTION_STAGES_STATIC

/** Bumped after anything that adds geolocated evidence, so the geofence verdict re-reads. */
const geoKey = ref(0)

function stageGuard(n: number): { unlocked: boolean; reason: string } {
  if (!ic.current.value) return { unlocked: false, reason: 'No permit loaded' }
  if (n === 1 && !ic.preConstructionPassed.value) {
    return { unlocked: true, reason: 'Pre-construction not recorded — proceed with care' }
  }
  if (n > 1) {
    const prev = ic.current.value.stages[n - 1]
    if (prev.verdict !== 'pass' && prev.verdict !== 'rework') {
      return { unlocked: false, reason: `Stage ${n - 1} must pass before Stage ${n}` }
    }
  }
  return { unlocked: true, reason: '' }
}

/**
 * Which context panels failed to load. Each of these used to swallow its error
 * into an empty array, so a failed request rendered as "No documents on this
 * permit file" — a statement about the building that we had not earned. An
 * inspector who reads that walks onto site believing there is no approved plan
 * on file. Failure and emptiness are now distinct.
 */
const ctxFailed = ref({ plans: false, documents: false, events: false, consultations: false })

async function loadContext(permitId: string) {
  const [p, docs, ev, cons] = await Promise.allSettled([
    dmApi.listBuildingPlans(permitId),
    dmApi.listPermitDocuments(permitId),
    dmApi.listEvents(permitId),
    dmApi.listConsultations(permitId),
  ])
  if (ic.current.value?.permitId !== permitId) return
  plans.value = p.status === 'fulfilled' ? p.value : []
  documents.value = docs.status === 'fulfilled' ? docs.value : []
  events.value = ev.status === 'fulfilled' ? ev.value : []
  consultations.value = cons.status === 'fulfilled' ? cons.value : []
  ctxFailed.value = {
    plans: p.status === 'rejected',
    documents: docs.status === 'rejected',
    events: ev.status === 'rejected',
    consultations: cons.status === 'rejected',
  }
}

async function pickStage(n: number) {
  const g = stageGuard(n)
  if (!g.unlocked) {
    fb.showToast(g.reason, 'warning')
    return
  }
  activeStage.value = n
  checklist.value = []
  stageInspection.value = null
  photos.value = []
  scoring.value = null
  results.value = {}
  pane.value = 'checklist'

  if (!permit.value) return
  checklistLoading.value = true
  try {
    checklist.value = await dmApi.getInspectionChecklist(n)
    const existing = await dmApi.listStageInspections(permit.value.id)
    const forStage = existing.filter(s => s.stage_number === n)
    stageInspection.value = forStage[forStage.length - 1] || null
    if (stageInspection.value) {
      photos.value = await dmApi.listStagePhotos(stageInspection.value.id)
      scoring.value = await dmApi.getStageScoring(stageInspection.value.id)
      await loadFieldEvents(stageInspection.value.id)
      await refreshPendingEvidence()
    } else {
      fieldEvents.value = []
      pendingEvidence.value = []
    }
    for (const item of checklist.value) {
      results.value[String(item.id)] = {
        checklist_item_id: item.id,
        result: 'not_inspected',
        notes: '',
        score: null,
      }
    }
    if (stageInspection.value) {
      const detail = await dmApi.getStageInspection(stageInspection.value.id)
      for (const row of detail?.checklist ?? []) {
        const key = String(row.checklist_item_id)
        if (!results.value[key]) continue
        const result: Mark = row.result === 'pass' || row.result === 'fail' || row.result === 'na'
          ? row.result : 'not_inspected'
        results.value[key] = {
          checklist_item_id: row.checklist_item_id,
          result,
          notes: row.notes || '',
          score: row.score ?? null,
          photo_id: row.photo_id ?? null,
        }
      }
    }
    // Unsent marks last, on top of the server record. The server holds what was
    // accepted; the draft holds what the inspector has done since and could not
    // send. Neither is silently dropped — the banner says a draft was restored
    // and offers to discard it.
    restoredDraft.value = null
    const draft = readChecklistDraft(permit.value.id, n)
    if (draft) {
      let applied = 0
      for (const row of draft.rows) {
        const key = String(row.checklist_item_id)
        if (!results.value[key]) continue      // the stage's catalogue has changed
        results.value[key] = { ...row }
        applied++
      }
      if (applied) restoredDraft.value = draft
      else discardChecklistDraft(permit.value.id, n)
    }

    await loadContext(permit.value.id)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load stage checklist'), 'error')
  } finally {
    checklistLoading.value = false
  }
}

// ── Unsent checklist custody ────────────────────────────────────────────
// See @/inspector/checklistDraft. The marks are written down as they are made,
// so a lost signal, a reload or the phone reclaiming the page cannot cost the
// inspector a checklist they already walked the building to fill in.
const restoredDraft = ref<ChecklistDraft | null>(null)
const draftHeld = ref(false)

watch(results, () => {
  // Loading writes the server's own rows into `results`; that is not field work
  // and must not be recorded as an unsent draft.
  if (checklistLoading.value) return
  const permitId = permit.value?.id
  if (!permitId) return
  draftHeld.value = saveChecklistDraft(permitId, activeStage.value, Object.values(results.value))
}, { deep: true })

function discardHeldMarks() {
  const permitId = permit.value?.id
  if (!permitId) return
  discardChecklistDraft(permitId, activeStage.value)
  restoredDraft.value = null
  draftHeld.value = false
  void pickStage(activeStage.value)
}

function fmtDraftTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? 'earlier'
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

async function ensureInspectionRecord(): Promise<string | null> {
  if (stageInspection.value) return stageInspection.value.id
  if (!permit.value) return null
  try {
    const created = await dmApi.createStageInspection(permit.value.id, {
      stage_number: activeStage.value,
      scheduled_at: new Date().toISOString(),
    })
    stageInspection.value = created
    const c = ic.current.value
    const st = c?.stages[activeStage.value]
    if (st) {
      st.inspectionId = created.id
      ic.save()
    }
    return created.id
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not open stage inspection record'), 'error')
    return null
  }
}

// Two inputs: `capture` forces the camera on a phone, so a separate input without
// it is the only way to attach a photo already in the gallery. Both live outside
// the tab panels, so capture works from whichever tab is open.
const photoInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)
const photoItemId = ref<string | null>(null)
function triggerPhoto(itemId?: string, fromGallery = false) {
  photoItemId.value = itemId ?? null
  ;(fromGallery ? galleryInput : photoInput).value?.click()
}

async function onPhotoChosen(ev: Event) {
  const files = (ev.target as HTMLInputElement).files
  if (!files?.length) return
  const inspId = await ensureInspectionRecord()
  if (!inspId) return
  saving.value = true
  const gps = await captureGps()
  if (isGpsFailure(gps)) fb.showToast(gpsFailureMessage(gps), 'warning')
  try {
    let uploaded = 0
    for (const file of Array.from(files)) {
      const err = imageFileError(file)
      if (err) { fb.showToast(err, 'warning'); continue }
      const up = await dmApi.uploadStagePhoto(inspId, file, {
        takenAt: new Date().toISOString(),
        caption: photoItemId.value
          ? `Stage ${activeStage.value} · item ${photoItemId.value}`
          : `Stage ${activeStage.value} site photo`,
        lat: isGpsFailure(gps) ? undefined : gps.lat,
        lng: isGpsFailure(gps) ? undefined : gps.lng,
      })
      photos.value.push(up)
      if (photoItemId.value && results.value[photoItemId.value]) {
        results.value[photoItemId.value].photo_id = up.id
      }
      uploaded += 1
    }
    if (uploaded) {
      geoKey.value++
      fb.showToast(`${uploaded} photograph(s) saved to this inspection.`, 'success')
    }
  } catch (err: unknown) {
    // The upload failed. Take custody of the ORIGINAL bytes before saying
    // anything reassuring — a claim of safety we have not earned is worse than
    // the failure itself, because the inspector will drive away from the site.
    const kept: string[] = []
    const lost: string[] = []
    if (inspId) {
      for (const file of Array.from(files)) {
        if (imageFileError(file)) continue
        try {
          await enqueueEvidence({
            inspectionId: inspId,
            file,
            checklistItemId: photoItemId.value,
            caption: photoItemId.value
              ? `Stage ${activeStage.value} · item ${photoItemId.value}`
              : `Stage ${activeStage.value} site photo`,
            takenAt: new Date().toISOString(),
            lng: isGpsFailure(gps) ? null : gps.lng,
            lat: isGpsFailure(gps) ? null : gps.lat,
          })
          kept.push(file.name)
        } catch (queueErr: unknown) {
          lost.push(file.name)
          if (!(queueErr instanceof EvidenceNotQueuedError)) throw queueErr
        }
      }
    }
    await refreshPendingEvidence()

    if (lost.length) {
      fb.showToast(
        `${lost.length} photograph(s) could NOT be saved on this device and are not recorded. Retake them before leaving the site.`,
        'error',
      )
    } else if (kept.length) {
      fb.showToast(
        `Upload failed — ${kept.length} photograph(s) held on this device. Retry from Evidence before you finish the stage.`,
        'warning',
      )
    } else {
      fb.showToast(fb.parseApiError(err, 'Photo upload failed.'), 'error')
    }
  } finally {
    saving.value = false
    photoItemId.value = null
    if (photoInput.value) photoInput.value.value = ''
    if (galleryInput.value) galleryInput.value.value = ''
  }
}

// ── Held evidence ───────────────────────────────────────────────────────
// Captures whose upload failed. The original bytes live in IndexedDB until the
// server accepts them, so this list is the inspector's proof that nothing was
// dropped — and their prompt to retry before the stage is signed off.
const pendingEvidence = ref<QueuedEvidence[]>([])
const retrying = ref(false)

async function refreshPendingEvidence() {
  const inspId = stageInspection.value?.id
  if (!inspId) { pendingEvidence.value = []; return }
  try {
    pendingEvidence.value = await listEvidence(inspId)
  } catch {
    pendingEvidence.value = []
  }
}

async function retryPendingEvidence() {
  const inspId = stageInspection.value?.id
  if (!inspId || retrying.value) return
  retrying.value = true
  try {
    const res = await flushEvidence(inspId, rec =>
      dmApi.uploadStagePhoto(
        inspId,
        new File([rec.blob], rec.fileName, { type: rec.mimeType }),
        {
          caption: rec.caption,
          takenAt: rec.takenAt ?? undefined,
          lat: rec.lat ?? undefined,
          lng: rec.lng ?? undefined,
        },
      ),
    )
    if (res.uploaded) {
      photos.value = await dmApi.listStagePhotos(inspId)
      fb.showToast(`${res.uploaded} held photograph(s) uploaded.`, 'success')
    }
    if (res.failed) {
      fb.showToast(`${res.failed} photograph(s) still held on this device.`, 'warning')
    }
  } finally {
    retrying.value = false
    await refreshPendingEvidence()
  }
}

async function discardHeldEvidence(id: string) {
  await discardEvidence(id)
  await refreshPendingEvidence()
}

const marks = computed(() =>
  checklist.value.map((item) => ({
    result: results.value[String(item.id)]?.result ?? 'not_inspected',
    is_mandatory: item.is_mandatory,
  })))

const completion = computed(() => checklistComplete(marks.value))
const failedItems = computed(() =>
  checklist.value.filter(item => results.value[String(item.id)]?.result === 'fail'))

const groupedChecklist = computed(() => {
  const groups = new Map<string, ChecklistItem[]>()
  for (const item of checklist.value) {
    const key = item.category_label || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return [...groups.entries()]
})

const currentPlan = computed(() => {
  const approved = plans.value.filter(p => isBuildingPlanApproved(p.status))
  if (!approved.length) return plans.value[plans.value.length - 1] ?? null
  return [...approved].sort((a, b) => b.revision - a.revision)[0]
})

async function saveChecklistAndComputeResult() {
  if (!completion.value.ok) {
    fb.showToast(`${completion.value.remaining} item(s) still not inspected. Mark each as Pass, Fail or N/A before submitting.`, 'warning')
    return
  }
  const arr = Object.values(results.value)
    .filter((r): r is DraftChecklistRow & { result: 'pass' | 'fail' | 'na' } => r.result !== 'not_inspected')
  for (const item of arr) {
    if (item.result === 'na') continue
    const score = item.score
    if (typeof score !== 'number' || !Number.isFinite(score) || !isPositiveNumber(String(score), { min: 0, max: 10 })) {
      fb.showToast('Each inspected item that is not N/A needs a score between 0 and 10.', 'warning')
      return
    }
  }
  const inspId = await ensureInspectionRecord()
  if (!inspId) return
  saving.value = true
  try {
    const computed = await dmApi.recordChecklist(inspId, arr)
    // Accepted by the server — and only now does custody end.
    if (permit.value) discardChecklistDraft(permit.value.id, activeStage.value)
    restoredDraft.value = null
    draftHeld.value = false
    scoring.value = computed
    if (computed.computed_result) {
      const verdict: Verdict =
        computed.computed_result === 'pass' ? 'pass'
        : computed.computed_result === 'conditional_pass' ? 'rework'
        : 'fail'
      await ic.setStageVerdict(activeStage.value, verdict)
      fb.showToast(`System computed result: ${computed.computed_result.replace(/_/g, ' ')}`, 'success')
      if (permit.value) await loadContext(permit.value.id)
    }
  } catch (err: unknown) {
    // The marks are already written down — the watcher holds them as they are
    // made. Say which it is, because "could not save" alone sends an inspector
    // back down a trench they never needed to re-walk.
    const held = permit.value
      ? saveChecklistDraft(permit.value.id, activeStage.value, Object.values(results.value))
      : false
    draftHeld.value = held
    fb.showToast(
      held
        ? `${fb.parseApiError(err, 'The checklist could not be sent')} — your marks are held on this device. Retry when you have signal.`
        : `${fb.parseApiError(err, 'Could not save checklist')} — and this device could NOT hold the marks. Do not leave the site until they are sent.`,
      held ? 'warning' : 'error',
    )
  } finally {
    saving.value = false
  }
}

const flagOpen = ref(false)
const flagReason = ref<'work_not_done'|'work_not_to_standard'|'photos_dont_match_site'|'safety_issue_missed'|'measurements_incorrect'|'fraudulent_pass'|'absent_during_inspection'|'other'>('safety_issue_missed')
const flagDesc = ref('')
async function fileFlag() {
  if (!stageInspection.value) {
    fb.showToast('No inspection record to flag yet.', 'warning')
    return
  }
  if (flagDesc.value.trim().length < 20) {
    fb.showToast('Describe the issue in at least 20 characters so the record is usable.', 'warning')
    return
  }
  try {
    await dmApi.flagStageInspection(stageInspection.value.id, flagReason.value, flagDesc.value)
    fb.showToast('Anti-corruption flag filed.', 'success')
    flagOpen.value = false
    flagDesc.value = ''
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not file flag'), 'error')
  }
}

const followUpDate = ref('')
const followUpReason = ref('')
async function scheduleFollowUp() {
  if (!permit.value) return
  if (!followUpDate.value) {
    fb.showToast('Set a target date for the follow-up inspection.', 'warning')
    return
  }
  try {
    const created = await dmApi.createStageInspection(permit.value.id, {
      stage_number: activeStage.value,
      scheduled_at: new Date(followUpDate.value).toISOString(),
      notes: followUpReason.value || `Follow-up of ${stageInspection.value?.id ?? 'previous attempt'}`,
    })
    stageInspection.value = created
    fb.showToast(`Follow-up opened as attempt ${created.attempt ?? 'next'}.`, 'success')
    await pickStage(activeStage.value)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not open follow-up inspection'), 'error')
  }
}

// `immediate` matters more here than it looks. The console keeps sections
// alive, so this one mounts the first time the inspector opens it — which is
// AFTER the queue row already loaded the case. Without immediate the watcher
// has nothing to react to, and the inspector arrives at an empty checklist for
// a permit that is plainly open in the band above it.
watch(() => ic.current.value?.permitId, (id) => {
  if (id) {
    loadContext(id)
    pickStage(activeStage.value || 1)
  }
}, { immediate: true })

function verdictBadge(v: Verdict): { tone: 'positive' | 'negative' | 'warning' | 'neutral'; label: string } {
  if (v === 'pass')   return { tone: 'positive', label: 'Passed' }
  if (v === 'fail')   return { tone: 'negative', label: 'Failed' }
  if (v === 'rework') return { tone: 'warning',  label: 'Conditional pass' }
  return { tone: 'neutral', label: 'No result yet' }
}

const MARKS: ReadonlyArray<{ value: Exclude<Mark, 'not_inspected'>; label: string; tone: string }> = [
  { value: 'pass', label: 'Pass', tone: 't-positive' },
  { value: 'fail', label: 'Fail', tone: 't-negative' },
  { value: 'na',   label: 'N/A',  tone: '' },
]

/** Tap a mark to set it; tap the selected mark again to clear it. */
function setMark(itemId: string, mark: Exclude<Mark, 'not_inspected'>) {
  const row = results.value[itemId]
  if (!row) return
  row.result = row.result === mark ? 'not_inspected' : mark
  if (row.result === 'na' || row.result === 'not_inspected') row.score = null
}

const markedCount = computed(() => marks.value.filter(m => m.result !== 'not_inspected').length)

const activeStageMeta = computed(() => stages[activeStage.value - 1])
const activeStageState = computed(() => ic.current.value?.stages[activeStage.value])

const panes: { id: Pane; label: string }[] = [
  { id: 'site', label: 'Site' },
  { id: 'planning', label: 'Planning / permit' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'evidence', label: 'Photos / evidence' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'documents', label: 'Documents' },
  { id: 'audit', label: 'Audit' },
]

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="si">
    <input ref="photoInput" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png"
           capture="environment" multiple class="ent-sr-only" tabindex="-1" aria-hidden="true" @change="onPhotoChosen" />
    <input ref="galleryInput" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png"
           multiple class="ent-sr-only" tabindex="-1" aria-hidden="true" @change="onPhotoChosen" />

    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Field work</span>
        <h2 class="ins-title">Stage inspection</h2>
        <p class="ins-lede">
          <template v-if="permit">
            <span class="ins-mono">{{ permit.dev_register_no || permit.id.slice(0, 8) }}</span>
            · Stand {{ permit.stand_number }}<template v-if="permit.suburb_ward"> · {{ permit.suburb_ward }}</template>
          </template>
          <template v-else>Nine statutory stages, each assessed against the Annexure 14 checklist.</template>
        </p>
      </div>
      <button v-if="permit" type="button" class="si-btn ghost" @click="ic.clear()">Change permit</button>
    </header>

    <div class="si-body">
      <aside class="si-ladder" :class="{ picking: !permit }" aria-label="Inspection stages">
        <InspectorCasePicker v-if="!permit" heading="Approved permits" />
        <ol v-else>
          <li v-for="s in stages" :key="s.n"
              :class="{ active: activeStage === s.n,
                        locked: !stageGuard(s.n).unlocked,
                        passed: ic.current.value?.stages[s.n]?.verdict === 'pass',
                        failed: ic.current.value?.stages[s.n]?.verdict === 'fail' }"
              :aria-current="activeStage === s.n ? 'step' : undefined"
              :tabindex="stageGuard(s.n).unlocked ? 0 : -1"
              @keydown.enter.prevent="pickStage(s.n)" @keydown.space.prevent="pickStage(s.n)"
              @click="pickStage(s.n)">
            <span class="si-num">{{ s.n }}</span>
            <div class="si-label">
              <strong>{{ s.name }}</strong>
              <span>{{ s.desc }}</span>
            </div>
            <Lock v-if="!stageGuard(s.n).unlocked" :size="11" class="si-icon-lock" />
            <CheckCircle2 v-else-if="ic.current.value?.stages[s.n]?.verdict === 'pass'" :size="13" class="si-icon-pass" />
            <XCircle v-else-if="ic.current.value?.stages[s.n]?.verdict === 'fail'" :size="13" class="si-icon-fail" />
            <ChevronRight v-else :size="13" class="si-icon-arrow" />
          </li>
        </ol>
      </aside>

      <section class="si-pane">
        <div v-if="!permit" class="si-empty">
          <Building :size="22" />
          <h3>Open a permit</h3>
          <p>Each inspection is tied to an approved permit, stand and parcel. Select a permit from the list, or open one from Today.</p>
        </div>

        <template v-else-if="activeStageMeta">
          <div class="si-stage-head">
            <div>
              <h3>{{ permit.dev_register_no || permit.id.slice(0, 8) }} · Stage {{ activeStageMeta.n }} — {{ activeStageMeta.name }}</h3>
              <p>{{ permit.applicant_name }} · Stand {{ permit.stand_number }} · {{ permit.suburb_ward }}
                 · {{ stageInspection ? `Attempt ${stageInspection.attempt}` : 'Not started' }}</p>
            </div>
            <UiStatusBadge :tone="verdictBadge(activeStageState?.verdict ?? 'pending').tone"
                           :label="verdictBadge(activeStageState?.verdict ?? 'pending').label" />
          </div>

          <div v-if="failedItems.length" class="si-fail-banner" role="status">
            <AlertTriangle :size="14" />
            Inspection failed — {{ failedItems.length }} item{{ failedItems.length === 1 ? '' : 's' }} marked FAIL.
            Record the corrective action, evidence and a follow-up before treating this stage as complete.
          </div>

          <!-- Field activity. Each button records one append-only event; 'Arrived'
               additionally attaches a position when the device has a fix. -->
          <section class="si-field" aria-labelledby="si-field-h">
            <h3 id="si-field-h">Field activity</h3>
            <div class="si-field-steps">
              <button
                v-for="step in FIELD_STEPS" :key="step.type"
                type="button"
                class="si-field-btn"
                :class="{ done: hasFieldEvent(step.type) }"
                :disabled="!stageInspection || fieldBusy !== null"
                :title="step.hint"
                @click="recordFieldEvent(step.type)">
                <CheckCircle2 v-if="hasFieldEvent(step.type)" :size="12" aria-hidden="true" />
                <Clock v-else :size="12" aria-hidden="true" />
                <span>{{ fieldBusy === step.type ? 'Recording…' : step.label }}</span>
                <span v-if="hasFieldEvent(step.type)" class="ent-sr-only">recorded</span>
              </button>
            </div>
            <p v-if="!stageInspection" class="si-field-hint">
              Open the stage inspection record before logging field activity.
            </p>
            <ol v-else-if="fieldEvents.length" class="si-field-log">
              <li v-for="e in fieldEvents" :key="e.id">
                <span class="si-field-when">{{ fmtEventTime(e.recorded_at) }}</span>
                <span class="si-field-what">{{ e.event_type.replace(/_/g, ' ') }}</span>
                <span v-if="e.observed_lat != null" class="si-field-pos">
                  {{ Number(e.observed_lat).toFixed(5) }}, {{ Number(e.observed_lng).toFixed(5) }}
                </span>
                <span v-else class="si-field-pos muted">no position recorded</span>
              </li>
            </ol>
            <p v-else class="si-field-hint">No field activity recorded for this attempt yet.</p>
          </section>

          <InspectionGeoVerification :inspection-id="stageInspection?.id ?? null" :refresh-key="geoKey" />

          <div class="si-tabs" role="tablist" aria-label="Inspection sections">
            <button v-for="t in panes" :key="t.id" type="button" role="tab"
                    :id="`si-tab-${t.id}`" aria-controls="si-panel"
                    :aria-selected="pane === t.id" :tabindex="pane === t.id ? 0 : -1"
                    :class="{ active: pane === t.id }"
                    @click="pane = t.id">
              {{ t.label }}
              <span v-if="t.id === 'checklist' && checklist.length" class="si-tab-n">{{ markedCount }}/{{ checklist.length }}</span>
              <span v-else-if="t.id === 'evidence' && (photos.length || pendingEvidence.length)" class="si-tab-n"
                    :class="{ warn: pendingEvidence.length }">{{ photos.length + pendingEvidence.length }}</span>
            </button>
          </div>

          <div id="si-panel" role="tabpanel" :aria-labelledby="`si-tab-${pane}`" class="si-panel">

          <div v-if="pane === 'site'">
            <InspectionSiteCard
              :stand="permit.stand_number"
              :ward="permit.suburb_ward"
              :property="permit.description || permit.development_type"
              :lat="permit.lat"
              :lng="permit.lng"
              :application-ref="permit.dev_register_no || permit.tpd_reference"
            />
          </div>

          <div v-else-if="pane === 'planning'" class="si-ctx">
            <dl>
              <div><dt>Permit status</dt><dd>{{ permit.status.replace(/_/g, ' ') }}</dd></div>
              <div><dt>Approved use</dt><dd>{{ permit.development_type.replace(/_/g, ' ') }}</dd></div>
              <div><dt>Conditions</dt><dd>{{ permit.decision_conditions || 'None recorded on this permit.' }}</dd></div>
              <div v-if="currentPlan">
                <dt>Current approved revision</dt>
                <dd>
                  Rev {{ currentPlan.revision }} {{ currentPlan.revision_label }}
                  · {{ currentPlan.status.replace(/_/g, ' ') }}
                  · {{ fmtDate(currentPlan.appraised_at) }}
                </dd>
              </div>
              <div v-else><dt>Approved plan</dt><dd>No building-plan revision on this permit yet.</dd></div>
            </dl>
            <p v-if="ctxFailed.plans" class="si-ctx-err" role="alert">
              The building plans could not be loaded, so what was approved is unknown. Do not assess the work from memory — retry before inspecting.
            </p>
            <p v-else-if="plans.length > 1" class="si-hint">
              {{ plans.length }} revisions on file. Inspect against the current approved revision only.
            </p>
            <ul class="si-rev">
              <li v-for="p in plans" :key="p.id"
                  :class="{ current: currentPlan?.id === p.id }">
                Rev {{ p.revision }} · {{ p.status.replace(/_/g, ' ') }} · {{ fmtDate(p.created_at) }}
              </li>
            </ul>
          </div>

          <div v-else-if="pane === 'checklist'">
            <div v-if="scoring" class="si-scoring">
              <span><strong>{{ scoring.scored_count }}</strong> / {{ scoring.item_count }} items scored</span>
              <span><Camera :size="11" /> {{ scoring.photo_count }} photos</span>
              <span v-if="scoring.avg_score != null">avg {{ Number(scoring.avg_score).toFixed(1) }}/10</span>
              <span v-if="scoring.computed_result" class="si-computed">
                system computed: <strong>{{ scoring.computed_result.replace(/_/g, ' ') }}</strong>
              </span>
            </div>
            <p class="si-hint">{{ completion.remaining }} item(s) not inspected. The system, not the inspector, computes the overall result.</p>

            <!-- Unsent marks found on this device. Never applied silently: the
                 inspector is told what was restored and can throw it away. -->
            <div v-if="restoredDraft" class="si-draft" role="status">
              <RotateCcw :size="15" aria-hidden="true" />
              <p>
                <strong>{{ restoredDraft.rows.length }} unsent mark(s) restored</strong>
                from this device, last changed {{ fmtDraftTime(restoredDraft.savedAt) }}.
                They are not yet part of the municipal record.
              </p>
              <button class="si-btn ghost" type="button" @click="discardHeldMarks">Discard them</button>
            </div>
            <p v-else-if="draftHeld" class="si-draft-quiet">
              <RotateCcw :size="13" aria-hidden="true" />
              Marks held on this device until the checklist is sent.
            </p>

            <div v-if="checklistLoading" class="si-loading">Loading checklist…</div>
            <div v-else-if="groupedChecklist.length">
              <section v-for="[cat, items] in groupedChecklist" :key="cat" class="si-cat">
                <h4>{{ cat }}</h4>
                <ul class="si-checklist">
                  <li v-for="item in items" :key="item.id"
                      :class="`m-${results[String(item.id)]?.result ?? 'not_inspected'}`">
                    <header>
                      <span class="si-code">{{ item.code }}</span>
                      <span class="si-desc">{{ item.description }}</span>
                      <span v-if="item.is_mandatory" class="si-mand">Mandatory</span>
                    </header>
                    <div class="si-row">
                      <div class="ins-seg si-marks" role="radiogroup" :aria-label="`Result for ${item.code}`">
                        <button v-for="m in MARKS" :key="m.value" type="button" role="radio" :class="m.tone"
                                :aria-checked="results[String(item.id)]?.result === m.value"
                                @click="setMark(String(item.id), m.value)">{{ m.label }}</button>
                      </div>
                      <label>
                        <span>Score (0–10)</span>
                        <input type="number" min="0" max="10" step="0.5"
                          v-model.number="results[String(item.id)].score"
                          :disabled="results[String(item.id)].result === 'na' || results[String(item.id)].result === 'not_inspected'" />
                      </label>
                      <label class="si-notes">
                        <span>Notes / measurement</span>
                        <input v-model="results[String(item.id)].notes"
                          placeholder="e.g. 720 mm trench depth" />
                      </label>
                    </div>
                    <button type="button" class="si-btn ghost si-item-photo" @click="triggerPhoto(String(item.id))">
                      <Camera :size="14" aria-hidden="true" /> {{ results[String(item.id)].photo_id ? 'Replace item photo' : 'Photograph this item' }}
                    </button>
                  </li>
                </ul>
              </section>
            </div>
            <div v-else class="si-empty-list">No checklist items for this stage yet.</div>

            <footer class="si-footer">
              <div class="si-footer-progress">
                <span><strong>{{ markedCount }}</strong> of {{ checklist.length }} marked</span>
                <div class="ins-bar"><span :style="{ '--fill': checklist.length ? markedCount / checklist.length : 0 }" /></div>
              </div>
              <button class="si-btn ghost" type="button" @click="triggerPhoto()" :disabled="saving">
                <Camera :size="14" aria-hidden="true" /> Take photo
                <span v-if="photos.length" class="si-count">{{ photos.length }}</span>
              </button>
              <button class="si-btn ghost" type="button" @click="triggerPhoto(undefined, true)" :disabled="saving">
                <Upload :size="14" aria-hidden="true" /> From gallery
              </button>
              <button class="si-btn red-ghost" type="button" @click="flagOpen = !flagOpen">
                <AlertTriangle :size="14" aria-hidden="true" /> Flag
              </button>
              <button class="si-btn primary" type="button" @click="saveChecklistAndComputeResult"
                      :disabled="saving || !checklist.length || !completion.ok">
                <Stamp :size="13" />
                Save and compute result
              </button>
            </footer>
          </div>

          <div v-else-if="pane === 'evidence'">
            <section v-if="pendingEvidence.length" class="si-held" aria-labelledby="si-held-h">
              <h4 id="si-held-h" class="si-held-h">
                <AlertTriangle :size="14" aria-hidden="true" />
                {{ pendingEvidence.length }} photograph(s) held on this device
              </h4>
              <p class="si-held-note">
                These are not yet part of the municipal record. The original files are
                stored on this device and will upload when you retry.
              </p>
              <ul class="si-held-list">
                <li v-for="p in pendingEvidence" :key="p.id" class="si-held-row">
                  <span class="si-held-name">{{ p.fileName }}</span>
                  <span class="si-held-meta">
                    {{ Math.round(p.bytes / 1024) }} KB · {{ p.status }}
                    <template v-if="p.attempts"> · {{ p.attempts }} attempt(s)</template>
                  </span>
                  <span v-if="p.lastError" class="si-held-err">{{ p.lastError }}</span>
                  <button class="si-btn ghost si-held-drop" type="button"
                          @click="discardHeldEvidence(p.id)">
                    Discard
                  </button>
                </li>
              </ul>
              <button class="si-btn primary" type="button"
                      :disabled="retrying" @click="retryPendingEvidence">
                <Upload :size="13" aria-hidden="true" />
                {{ retrying ? 'Uploading…' : 'Retry upload' }}
              </button>
            </section>

            <InspectionEvidenceGallery :photos="photos" />
            <div class="si-evidence-actions">
              <button class="si-btn primary" type="button" :disabled="saving" @click="triggerPhoto()">
                <Camera :size="14" aria-hidden="true" /> Take photo
              </button>
              <button class="si-btn ghost" type="button" :disabled="saving" @click="triggerPhoto(undefined, true)">
                <Upload :size="14" aria-hidden="true" /> From gallery
              </button>
            </div>
          </div>

          <div v-else-if="pane === 'referrals'">
            <InspectionReferralForm
              :permit-id="permit.id"
              :inspection-ref="stageInspection?.id"
              :stand="permit.stand_number"
              :evidence-count="photos.length"
              @created="consultations.unshift($event)"
            />
            <ul v-if="consultations.length" class="si-ref-list">
              <li v-for="c in consultations" :key="c.id">
                <strong>{{ c.body_name || c.department }}</strong>
                <span>{{ (c.task_status || c.response_status || c.outcome || 'pending').replace(/_/g, ' ') }}</span>
              </li>
            </ul>
            <p v-else-if="ctxFailed.consultations" class="si-ctx-err" role="alert">
              Referrals could not be loaded. This does not mean none exist.
            </p>
            <p v-else class="si-empty-list">No referrals have been created.</p>
          </div>

          <div v-else-if="pane === 'followup'" class="si-ctx">
            <p>A follow-up is a new attempt of this stage, linked to the same permit. Outstanding FAIL items remain on the previous attempt.</p>
            <label>
              <span>Target date</span>
              <input v-model="followUpDate" type="date" />
            </label>
            <label>
              <span>Reason</span>
              <textarea v-model="followUpReason" rows="2" placeholder="Outstanding violations and corrective action required." />
            </label>
            <button class="si-btn primary" type="button" @click="scheduleFollowUp">
              <RotateCcw :size="13" /> Schedule follow-up
            </button>
          </div>

          <div v-else-if="pane === 'documents'">
            <ul v-if="documents.length" class="si-docs">
              <li v-for="d in documents" :key="d.id">
                <FileText :size="12" />
                <span>{{ d.file_name }}</span>
                <span class="si-hint">{{ d.doc_type }} · {{ fmtDate(d.uploaded_at) }}</span>
              </li>
            </ul>
            <p v-else-if="ctxFailed.documents" class="si-ctx-err" role="alert">
              The document list could not be loaded. This is not an empty file — retry, and check the case file before relying on it.
            </p>
            <p v-else class="si-empty-list">No documents on this permit file.</p>
          </div>

          <div v-else-if="pane === 'audit'">
            <ol v-if="events.length" class="si-audit">
              <li v-for="e in events" :key="e.id">
                <strong>{{ e.event_type.replace(/_/g, ' ') }}</strong>
                <span>{{ e.actor_name || e.actor_role || '—' }} · {{ fmtDate(e.created_at) }}</span>
              </li>
            </ol>
            <p v-else-if="ctxFailed.events" class="si-ctx-err" role="alert">
              The audit trail could not be loaded.
            </p>
            <p v-else class="si-empty-list">No audit events recorded for this permit.</p>
          </div>

          </div>

          <div v-if="flagOpen" class="si-flag">
            <h4><AlertTriangle :size="13" /> File flag against this inspection</h4>
            <label>
              <span>Reason</span>
              <select v-model="flagReason">
                <option value="work_not_done">Work not done</option>
                <option value="work_not_to_standard">Work not to standard</option>
                <option value="photos_dont_match_site">Photos don't match site</option>
                <option value="safety_issue_missed">Safety issue missed</option>
                <option value="measurements_incorrect">Measurements incorrect</option>
                <option value="fraudulent_pass">Fraudulent pass</option>
                <option value="absent_during_inspection">Inspector absent during inspection</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              <span>Description</span>
              <textarea v-model="flagDesc" rows="2"
                placeholder="What was observed, when, and which photos support this flag."></textarea>
            </label>
            <div class="si-flag-actions">
              <button class="si-btn ghost" type="button" @click="flagOpen = false">Cancel</button>
              <button class="si-btn primary" type="button" @click="fileFlag">File flag</button>
            </div>
          </div>

          <div v-if="activeStageState?.annexure12Stamp?.signed" class="si-stamp">
            <Stamp :size="14" />
            <div>
              <strong>Annexure 12 stamp applied</strong>
              <span>{{ new Date(activeStageState.annexure12Stamp.signedAt!).toLocaleString('en-GB') }}</span>
            </div>
            <Clock :size="12" />
          </div>
        </template>
      </section>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Migrated onto --ent-* only. No hardcoded amber/red/green hexes, no sub-11px type. */
.si { padding:var(--ent-s5) var(--ent-s6) var(--ent-s7); display:flex; flex-direction:column; gap:var(--ent-s4); min-height:100%; }

.si-body { display:grid; grid-template-columns:18rem minmax(0, 1fr); gap:var(--ent-s4); align-items:start; }

.si-ladder { position:sticky; top:var(--ent-s4); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); padding:var(--ent-s2); max-height:calc(100vh - 10rem); overflow-y:auto; }
.si-ladder.picking { padding:0; background:transparent; border:0; box-shadow:none; overflow:visible; }
.si-ladder ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.si-ladder li { position:relative; display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border:1px solid transparent; border-radius:var(--ent-r);
  cursor:pointer; transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.si-ladder li:hover { background:var(--ent-surface-2); }
.si-ladder li:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.si-ladder li.active { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.si-ladder li.locked { cursor:not-allowed; }
.si-ladder li.locked .si-label, .si-ladder li.locked .si-num { opacity:0.55; }
.si-num { width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  border-radius:var(--ent-r-pill); background:var(--ent-surface-sunken); color:var(--ent-text-2);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-bold); font-variant-numeric:tabular-nums; }
.si-ladder li.active .si-num { background:var(--ent-accent); color:var(--ent-text-on-accent); }
.si-ladder li.passed .si-num { background:var(--ent-success-soft); color:var(--ent-success); }
.si-ladder li.failed .si-num { background:var(--ent-danger-soft); color:var(--ent-danger); }
.si-label { flex:1; min-width:0; }
.si-label strong { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.si-label span { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.si-icon-lock, .si-icon-arrow { color:var(--ent-text-3); flex-shrink:0; }
.si-icon-pass { color:var(--ent-success); flex-shrink:0; }
.si-icon-fail { color:var(--ent-danger); flex-shrink:0; }

.si-pane { background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); box-shadow:var(--ent-e1);
  padding:var(--ent-s4) var(--ent-s5); display:flex; flex-direction:column; gap:var(--ent-s4); min-width:0; }
.si-empty { margin:var(--ent-s7) auto; text-align:center; color:var(--ent-text-3); max-width:26rem; }
.si-empty h3 { margin:var(--ent-s2) 0 var(--ent-s1); font-size:var(--ent-fs-md); color:var(--ent-text); }
.si-empty p { margin:0; font-size:var(--ent-fs-sm); line-height:var(--ent-lh); }

.si-stage-head { display:flex; align-items:flex-start; gap:var(--ent-s3); padding-bottom:var(--ent-s3); border-bottom:1px solid var(--ent-line); }
.si-stage-head > div { flex:1; min-width:0; }
.si-stage-head h3 { margin:0 0 2px; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-bold); color:var(--ent-text); letter-spacing:-0.01em; }
.si-stage-head p { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

.si-fail-banner { display:flex; align-items:flex-start; gap:var(--ent-s2); padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-danger-soft); border:1px solid var(--ent-tone-negative-line); border-radius:var(--ent-r-md);
  color:var(--ent-text); font-size:var(--ent-fs-sm); line-height:var(--ent-lh); }
.si-fail-banner svg { color:var(--ent-danger); flex-shrink:0; margin-top:2px; }

.si-field { display:flex; flex-direction:column; gap:var(--ent-s2); }
.si-field h3 { margin:0; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase; color:var(--ent-text-3); }
.si-field-steps { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:var(--ent-s2); }
.si-field-btn {
  display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s2);
  min-height:44px; padding:0 var(--ent-s3);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r);
  background:var(--ent-surface); color:var(--ent-text); cursor:pointer;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease), transform var(--ent-dur) var(--ent-ease);
}
.si-field-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.si-field-btn:active:not(:disabled) { transform:scale(0.97); }
.si-field-btn:disabled { opacity:.5; cursor:not-allowed; }
.si-field-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
/* Recorded state is carried by the icon and the sr-only word, not colour alone. */
.si-field-btn.done { border-color:var(--ent-tone-positive-line); background:var(--ent-success-soft); color:var(--ent-success); }
.si-field-hint { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.si-field-log { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.si-field-log li { display:grid; grid-template-columns:auto 1fr auto; gap:var(--ent-s2); align-items:baseline; font-size:var(--ent-fs-xs); }
.si-field-when { color:var(--ent-text-3); font-variant-numeric:tabular-nums; }
.si-field-what { text-transform:capitalize; color:var(--ent-text); }
.si-field-pos { font-family:var(--ent-font-mono); color:var(--ent-text-2); }
.si-field-pos.muted { font-family:inherit; color:var(--ent-text-3); font-style:italic; }

.si-tabs { display:flex; gap:var(--ent-s1); border-bottom:1px solid var(--ent-line); overflow-x:auto; scrollbar-width:none; margin:0 calc(-1 * var(--ent-s5)); padding:0 var(--ent-s5); }
.si-tabs::-webkit-scrollbar { display:none; }
.si-tabs button {
  display:inline-flex; align-items:center; gap:var(--ent-s2); flex-shrink:0;
  min-height:40px; padding:0 var(--ent-s3); border:0; background:none; cursor:pointer; white-space:nowrap;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text-2);
  box-shadow:inset 0 -2px 0 transparent; transition:color var(--ent-dur) var(--ent-ease), box-shadow var(--ent-dur) var(--ent-ease);
}
.si-tabs button:hover { color:var(--ent-text); }
.si-tabs button.active { color:var(--ent-accent); box-shadow:inset 0 -2px 0 var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.si-tabs button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.si-tab-n { padding:0 6px; border-radius:var(--ent-r-pill); background:var(--ent-surface-sunken); color:var(--ent-text-2); font-size:var(--ent-fs-micro); font-variant-numeric:tabular-nums; }
.si-tab-n.warn { background:var(--ent-warning-soft); color:var(--ent-warning); }
.si-panel { display:flex; flex-direction:column; gap:var(--ent-s3); min-width:0; }

.si-scoring { display:flex; align-items:center; flex-wrap:wrap; gap:var(--ent-s2) var(--ent-s4); padding:var(--ent-s2) var(--ent-s3);
  font-size:var(--ent-fs-sm); color:var(--ent-text-2); background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r); }
.si-scoring span { display:inline-flex; align-items:center; gap:var(--ent-s1); }
.si-computed { margin-left:auto; text-transform:capitalize; }
.si-hint { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); line-height:var(--ent-lh); }
.si-cat h4 { margin:var(--ent-s3) 0 var(--ent-s2); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); text-transform:uppercase; letter-spacing:0.05em; color:var(--ent-text-3); }

.si-loading, .si-empty-list { padding:var(--ent-s6) var(--ent-s4); text-align:center; color:var(--ent-text-3); font-size:var(--ent-fs-sm); }
.si-ctx-err { margin:0; padding:var(--ent-s3) var(--ent-s4); font-size:var(--ent-fs-sm); line-height:var(--ent-lh);
  color:var(--ent-text); background:var(--ent-danger-soft); border:1px solid var(--ent-tone-negative-line); border-radius:var(--ent-r-md); }
.si-checklist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.si-checklist > li { border:1px solid var(--ent-line); border-radius:var(--ent-r-md); padding:var(--ent-s3) var(--ent-s4);
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease); }
.si-checklist > li.m-pass { border-color:var(--ent-tone-positive-line); box-shadow:inset 3px 0 0 var(--ent-success); }
.si-checklist > li.m-fail { border-color:var(--ent-tone-negative-line); background:var(--ent-danger-soft); box-shadow:inset 3px 0 0 var(--ent-danger); }
.si-checklist > li.m-na { background:var(--ent-surface-2); }
.si-checklist > li > header { display:flex; align-items:flex-start; gap:var(--ent-s2); margin-bottom:var(--ent-s3); }
.si-code { flex-shrink:0; padding:1px var(--ent-s2); border-radius:var(--ent-r-sm); font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); background:var(--ent-accent-soft); }
.si-desc { flex:1; font-size:var(--ent-fs-base); color:var(--ent-text); line-height:var(--ent-lh); }
.si-mand { flex-shrink:0; font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.03em; text-transform:uppercase; color:var(--ent-danger); }
.si-row { display:grid; grid-template-columns:auto 7rem minmax(0, 1fr); gap:var(--ent-s3); align-items:end; }
.si-marks button { min-width:3.5rem; min-height:34px; }
.si-row label { display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.si-row input, .si-ctx input, .si-ctx textarea, .si-flag select, .si-flag textarea {
  min-height:var(--ent-control-h); padding:var(--ent-s2) var(--ent-s3); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r);
  font-size:var(--ent-fs-base); color:var(--ent-text); background:var(--ent-surface); font-family:var(--ent-font);
}
.si-row input:focus, .si-ctx input:focus, .si-ctx textarea:focus, .si-flag select:focus, .si-flag textarea:focus { outline:none; border-color:var(--ent-accent); box-shadow:var(--ent-focus-ring); }
.si-row input:disabled { background:var(--ent-surface-sunken); color:var(--ent-text-3); }
.si-item-photo { margin-top:var(--ent-s2); }

.si-footer { position:sticky; bottom:0; z-index:var(--ent-z-sticky); display:flex; align-items:center; gap:var(--ent-s2); flex-wrap:wrap;
  margin:0 calc(-1 * var(--ent-s5)) calc(-1 * var(--ent-s4)); padding:var(--ent-s3) var(--ent-s5);
  background:var(--ent-map-panel-bg); border-top:1px solid var(--ent-line); border-radius:0 0 var(--ent-r-md) var(--ent-r-md);
  backdrop-filter:blur(6px); }
.si-footer-progress { display:flex; flex-direction:column; gap:var(--ent-s1); min-width:9rem; margin-right:auto; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.si-footer-progress strong { color:var(--ent-text); font-variant-numeric:tabular-nums; }
.si-btn { display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s2); white-space:nowrap;
  min-height:var(--ent-control-h); padding:0 var(--ent-s3); border-radius:var(--ent-r); border:1px solid var(--ent-line-strong);
  background:var(--ent-surface); color:var(--ent-text); font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.si-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.si-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.si-btn.ghost { border-color:transparent; background:transparent; color:var(--ent-text-2); }
.si-btn.ghost:hover:not(:disabled) { background:var(--ent-surface-2); color:var(--ent-text); }
.si-btn.red-ghost { border-color:transparent; background:transparent; color:var(--ent-danger); }
.si-btn.red-ghost:hover:not(:disabled) { background:var(--ent-danger-soft); }
.si-btn.primary { background:var(--ent-accent); color:var(--ent-text-on-accent); border-color:var(--ent-accent); }
.si-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.si-btn:disabled { opacity:0.55; cursor:not-allowed; }
.si-count { padding:0 6px; border-radius:var(--ent-r-pill); background:var(--ent-accent-soft); color:var(--ent-accent); font-size:var(--ent-fs-micro); font-variant-numeric:tabular-nums; }
.si-evidence-actions { display:flex; gap:var(--ent-s2); flex-wrap:wrap; }

.si-ctx { display:flex; flex-direction:column; gap:var(--ent-s3); font-size:var(--ent-fs-sm); color:var(--ent-text); }
.si-ctx p { margin:0; color:var(--ent-text-2); line-height:var(--ent-lh); }
.si-ctx label { display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); max-width:32rem; }
.si-ctx .si-btn { align-self:flex-start; }
.si-ctx dl { margin:0; display:grid; gap:var(--ent-s2); }
.si-ctx dl > div { display:grid; grid-template-columns:11rem minmax(0, 1fr); gap:var(--ent-s3); padding:var(--ent-s2) 0; border-top:1px solid var(--ent-line); }
.si-ctx dl > div:first-child { border-top:0; }
.si-ctx dt { color:var(--ent-text-3); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); text-transform:uppercase; letter-spacing:0.04em; }
.si-ctx dd { margin:0; text-transform:none; }
.si-rev, .si-docs, .si-audit, .si-ref-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s1); }
.si-rev li, .si-docs li, .si-audit li, .si-ref-list li {
  padding:var(--ent-s2) var(--ent-s3); border:1px solid var(--ent-line); border-radius:var(--ent-r); font-size:var(--ent-fs-sm); color:var(--ent-text);
}
.si-rev li.current { border-color:var(--ent-accent-line); background:var(--ent-accent-soft); }
.si-docs li, .si-audit li, .si-ref-list li { display:flex; flex-direction:column; gap:2px; }
.si-audit strong, .si-ref-list strong { text-transform:capitalize; font-weight:var(--ent-fw-semibold); }
.si-audit span, .si-ref-list span { font-size:var(--ent-fs-xs); color:var(--ent-text-2); text-transform:capitalize; }

.si-flag { padding:var(--ent-s4); border:1px solid var(--ent-tone-negative-line); border-radius:var(--ent-r-md);
  background:var(--ent-danger-soft); display:flex; flex-direction:column; gap:var(--ent-s3); }
.si-flag h4 { margin:0; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); color:var(--ent-danger); display:flex; align-items:center; gap:var(--ent-s2); }
.si-flag label { display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); }
.si-flag-actions { display:flex; gap:var(--ent-s2); justify-content:flex-end; }

.si-stamp { display:flex; align-items:center; gap:var(--ent-s3); padding:var(--ent-s3) var(--ent-s4);
  border:1px dashed var(--ent-success); background:var(--ent-success-soft); border-radius:var(--ent-r-md); color:var(--ent-success); }
.si-stamp > div { flex:1; }
.si-stamp strong { display:block; font-size:var(--ent-fs-sm); }
.si-stamp span { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }

/* Restored unsent marks. Same warning tone as held evidence, and for the same
   reason: the work is safe, it is simply not yet the municipal record. */
.si-draft { display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4); border:1px solid var(--ent-tone-warning-line);
  border-radius:var(--ent-r-md); background:var(--ent-warning-soft); }
.si-draft > svg { flex-shrink:0; color:var(--ent-warning); }
.si-draft p { margin:0; flex:1; min-width:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }
.si-draft-quiet { display:flex; align-items:center; gap:var(--ent-s2); margin:0;
  font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
@media (max-width: 767px) {
  .si-draft { flex-direction:column; align-items:stretch; }
}

/* Held evidence — warning, not danger: nothing is lost, but it is not filed yet. */
.si-held { padding:var(--ent-s4); border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r-md);
  background:var(--ent-warning-soft); display:flex; flex-direction:column; gap:var(--ent-s2); }
.si-held-h { margin:0; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); color:var(--ent-text); display:flex; align-items:center; gap:var(--ent-s2); }
.si-held-h svg { color:var(--ent-warning); }
.si-held-note { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.si-held-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s1); }
.si-held-row { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:2px var(--ent-s3);
  padding:var(--ent-s2) var(--ent-s3); border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r); background:var(--ent-surface); }
.si-held-name { font-size:var(--ent-fs-sm); font-family:var(--ent-font-mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.si-held-meta { grid-column:1; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.si-held-err { grid-column:1 / -1; font-size:var(--ent-fs-xs); color:var(--ent-danger); }
.si-held-drop { grid-column:2; grid-row:1 / 3; align-self:center; }
.si-held > .si-btn { align-self:flex-start; }

@media (max-width: 1023px) {
  .si-body { grid-template-columns:minmax(0, 1fr); }
  .si-ladder { position:static; max-height:none; }
  .si-ladder ol { flex-direction:row; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:2px; }
  .si-ladder li { flex:0 0 13rem; scroll-snap-align:start; }
  .si-row { grid-template-columns:auto 7rem; }
  .si-notes { grid-column:1 / -1; }
}
@media (max-width: 767px) {
  .si { padding:var(--ent-s4) var(--ent-s3) var(--ent-s7); }
  .si-pane { padding:var(--ent-s3); }
  .si-tabs { margin:0 calc(-1 * var(--ent-s3)); padding:0 var(--ent-s3); }
  .si-field-steps { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .si-row { grid-template-columns:minmax(0, 1fr); }
  .si-marks button { min-height:44px; }
  .si-footer { margin:0 calc(-1 * var(--ent-s3)) calc(-1 * var(--ent-s3)); padding:var(--ent-s3); }
  /* Two rows on a phone: the progress line, the capture actions, then the one
     action that ends the stage, full width where the thumb is. */
  .si-footer-progress { flex-basis:100%; margin-right:0; }
  .si-footer .si-btn { flex:1 1 auto; min-width:0; }
  .si-footer .si-btn.primary { flex-basis:100%; order:10; min-height:44px; }
  .si-ctx dl > div { grid-template-columns:minmax(0, 1fr); gap:2px; }
}
@media (prefers-reduced-motion: reduce) {
  .si-ladder li, .si-field-btn, .si-tabs button, .si-checklist > li, .si-btn { transition:none; }
  .si-field-btn:active:not(:disabled) { transform:none; }
}
</style>
