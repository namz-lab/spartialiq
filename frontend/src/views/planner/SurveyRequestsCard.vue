<script setup lang="ts">
// Survey & cadastral review — the planner→surveyor statutory connection.
// Before operations like subdivision/consolidation can proceed, the planner
// instructs the council surveyor (pegging / verification / layout check);
// the surveyor executes the survey in the Survey Task Manager and submits a
// report (findings + recommendation) which appears here against the case.
//
// Presentation only below the API line: the statutory rule lives in
// `surveyRequired` / `surveyAccepted` / `needsSurveyGate` and is emitted
// unchanged to Step 2 via `gate-change`. Nothing here re-derives it.
import { computed, inject, onMounted, ref, watch } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { PLANNER_SHELL_KEY } from '@/composables/usePlannerShell'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  surveyorApi, type SurveyTask, type SurveyFinding, type SurveyTaskType,
  type SurveyTaskStatus,
} from '@/services/surveyor'
import {
  Send, AlertTriangle, ClipboardCheck, RefreshCw, MapPin, CheckCircle2,
  RotateCcw, FileText,
} from 'lucide-vue-next'

const { current } = usePlannerCase()
const fb = useUiFeedback()
// Optional: this card also renders outside <PlannerShell> (statutory drawer),
// so inject rather than usePlannerShell() — which throws when unprovided.
const shell = inject(PLANNER_SHELL_KEY, undefined)

// Step 2 uses this to hard-gate due-diligence completion: survey-dependent
// tracks (subdivision/consolidation) cannot proceed to committee until the
// planner has ACCEPTED a surveyor report — the actual municipal sequence.
const emit = defineEmits<{ (e: 'gate-change', v: { required: boolean; satisfied: boolean }): void }>()

const tasks = ref<Array<SurveyTask & { findings: SurveyFinding[] | null }>>([])
const loading = ref(false)
const submitting = ref(false)
const reviewing = ref(false)
const loadError = ref('')
const typeSelect = ref<HTMLSelectElement | null>(null)

const TASK_TYPES: Array<{ value: SurveyTaskType; label: string }> = [
  { value: 'verification', label: 'Verification survey (TPD / site-plan check)' },
  { value: 'pegging', label: 'Pegging — peg the stand / subdivision' },
  { value: 'setting_out', label: 'Setting-out (Stage 1 construction)' },
  { value: 'layout', label: 'Layout survey / implementation check' },
  { value: 'beacon_check', label: 'Beacon check / relocation' },
  { value: 'encroachment', label: 'Encroachment investigation' },
  { value: 'general', label: 'General survey task' },
]

const form = ref({
  task_type: 'verification' as SurveyTaskType,
  instructions: '',
  priority: 'normal',
  due_date: '',
})

const permitId = computed(() => current.value?.permitId ?? null)

// Subdivision / consolidation cannot lawfully be finalised without a survey
// (RTCP Act s.40 + Land Survey Act diagram requirements). The gate clears
// only when the planner has accepted a surveyor report on this case.
const surveyRequired = computed(() => {
  const dt = current.value?.proposal?.devType
  return dt === 'subdivision' || dt === 'consolidation'
})
const surveyAccepted = computed(() => tasks.value.some(t => t.status === 'accepted'))
const needsSurveyGate = computed(() => surveyRequired.value && !surveyAccepted.value)

watch([surveyRequired, surveyAccepted], () => {
  emit('gate-change', { required: surveyRequired.value, satisfied: surveyAccepted.value })
}, { immediate: true })

// ── Presentation maps ──────────────────────────────────────────────────────
type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

const STATUS: Record<SurveyTaskStatus, { label: string; tone: Tone }> = {
  assigned:    { label: 'Assigned',    tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  submitted:   { label: 'Submitted',   tone: 'warning' },
  accepted:    { label: 'Accepted',    tone: 'positive' },
  returned:    { label: 'Returned',    tone: 'negative' },
  cancelled:   { label: 'Cancelled',   tone: 'neutral' },
}

const recLabel: Record<string, string> = {
  no_objection: 'No objection', objection: 'Objection', approve: 'Approve',
  approve_conditions: 'Approve with conditions', refuse: 'Refuse', refer_back: 'Refer back',
}
const recTone: Record<string, Tone> = {
  no_objection: 'positive', approve: 'positive', approve_conditions: 'positive',
  objection: 'negative', refuse: 'negative', refer_back: 'warning',
}

const PRIORITY_TONE: Record<string, Tone> = {
  low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'negative',
}

// Presentation-only view of the workflow. Not a second state machine — the
// stage is read off the task statuses the backend already returns.
const WORKFLOW = ['Request', 'Assigned', 'In progress', 'Submitted', 'Planner review', 'Accepted']
const STAGE_OF: Record<SurveyTaskStatus, number> = {
  assigned: 2, in_progress: 3, submitted: 5, accepted: 6, returned: 3, cancelled: 1,
}
// The leading (most advanced) live task drives the rail when several exist.
const stage = computed(() => tasks.value
  .filter(t => t.status !== 'cancelled')
  .reduce((max, t) => Math.max(max, STAGE_OF[t.status] ?? 1), tasks.value.length ? 1 : 0))

function typeParts(v: string) {
  const raw = TASK_TYPES.find(t => t.value === v)?.label ?? v
  const m = raw.match(/^(.*?)\s*[(—]\s*(.*?)\)?$/)
  return m ? { title: m[1], sub: m[2] } : { title: raw, sub: '' }
}

function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  const t = new Date(d)
  return isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Derived from the due_date the backend already supplies — no new field.
function isOverdue(t: SurveyTask) {
  if (!t.due_date || t.status === 'accepted' || t.status === 'cancelled') return false
  const due = new Date(t.due_date)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return !isNaN(due.getTime()) && due < today
}

function lastFinding(t: SurveyTask & { findings: SurveyFinding[] | null }) {
  return t.findings?.length ? t.findings[t.findings.length - 1] : null
}

const centroid = computed(() => current.value?.property?.centroid)
function showOnMap() { if (centroid.value && shell) shell.flyTo(centroid.value) }
function focusForm() { typeSelect.value?.focus() }

// ── Data ───────────────────────────────────────────────────────────────────
async function load() {
  if (!permitId.value) { tasks.value = []; return }
  loading.value = true
  loadError.value = ''
  try {
    tasks.value = await surveyorApi.applicationTasks(permitId.value)
  } catch (e: any) {
    // A case that has never had tasks is fine; only surface real errors.
    if (e?.response?.status !== 404) {
      loadError.value = fb.parseApiError(e, 'Could not load survey tasks')
    }
    tasks.value = []
  } finally {
    loading.value = false
  }
}

async function request() {
  if (!permitId.value || !current.value) return
  submitting.value = true
  try {
    await surveyorApi.assignJob({
      permit_app_id: permitId.value,
      task_type: form.value.task_type,
      stand_number: current.value.property.standNo || undefined,
      suburb_ward: current.value.property.ward || undefined,
      instructions: form.value.instructions || undefined,
      priority: form.value.priority,
      due_date: form.value.due_date || undefined,
      lng: current.value.property.centroid?.[0],
      lat: current.value.property.centroid?.[1],
    })
    form.value.instructions = ''
    form.value.due_date = ''
    fb.showToast('Survey task sent to the surveyor queue', 'success')
    await load()
  } catch (e: any) {
    fb.openMessageBox({ kind: 'error', title: 'Could not request survey',
      message: fb.parseApiError(e, 'The server rejected the survey request.') })
  } finally {
    submitting.value = false
  }
}

// Planner review actions on a submitted report — accept closes the loop,
// return sends it back to the surveyor's queue for rework.
async function review(taskId: string, status: 'accepted' | 'returned') {
  reviewing.value = true
  try {
    await surveyorApi.updateJob(taskId, { status })
    fb.showToast(status === 'accepted' ? 'Survey report accepted' : 'Report returned to surveyor', 'success')
    await load()
  } catch (e: any) {
    fb.showToast(fb.parseApiError(e, 'Could not update the survey task'), 'error')
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
watch(permitId, load)
</script>

<template>
  <section class="sc" aria-labelledby="sc-title">
    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <header class="sc-head">
      <ClipboardCheck :size="15" class="sc-head-icon" aria-hidden="true" />
      <div class="sc-head-text">
        <h3 id="sc-title">Survey &amp; cadastral review</h3>
        <p>Planner → Surveyor → Planner coordination</p>
      </div>
      <UiStatusBadge
        :tone="surveyRequired ? (surveyAccepted ? 'positive' : 'warning') : 'neutral'"
        :label="surveyRequired ? (surveyAccepted ? 'Required · satisfied' : 'Required') : 'Not required'"
      />
      <button
        class="sc-refresh" type="button" :disabled="loading"
        aria-label="Refresh survey tasks" @click="load"
      >
        <RefreshCw :size="13" :class="{ spin: loading }" aria-hidden="true" />
      </button>
    </header>

    <!-- ── 1. Statutory requirement ───────────────────────────────────── -->
    <div v-if="needsSurveyGate" class="sc-gate warn" role="status">
      <AlertTriangle :size="15" aria-hidden="true" />
      <div>
        <p class="sc-gate-title">Statutory requirement — case progression blocked</p>
        <p class="sc-gate-body">
          An accepted cadastral survey report is required before this
          {{ current?.proposal.devType }} can proceed
          (<span class="mono">RTCP Act s.40</span>; survey diagrams under the
          <span class="mono">Land Survey Act</span>). Requesting a survey does not
          satisfy the requirement — only a report you have accepted does.
        </p>
      </div>
    </div>
    <div v-else-if="surveyRequired && surveyAccepted" class="sc-gate ok" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" />
      <div>
        <p class="sc-gate-title">Survey requirement satisfied — case may proceed</p>
        <p class="sc-gate-body">
          An accepted survey report is on file
          (<span class="mono">RTCP Act s.40</span>; <span class="mono">Land Survey Act</span>).
        </p>
      </div>
    </div>

    <!-- ── No case ────────────────────────────────────────────────────── -->
    <div v-if="!permitId" class="sc-note">
      <strong>Survey not available.</strong>
      Register the application first — survey tasks attach to the saved case record.
    </div>

    <template v-else>
      <!-- ── Property context ─────────────────────────────────────────── -->
      <div class="sc-context">
        <div class="sc-fact">
          <span class="sc-k">Stand</span>
          <span class="sc-v mono">{{ current?.property.standNo || '—' }}</span>
        </div>
        <div class="sc-fact">
          <span class="sc-k">Ward</span>
          <span class="sc-v mono">{{ current?.property.ward || '—' }}</span>
        </div>
        <div class="sc-fact">
          <span class="sc-k">Application</span>
          <span class="sc-v mono">{{ current?.registrationNo || current?.fileRef || '—' }}</span>
        </div>
        <button
          v-if="centroid && shell" type="button" class="sc-map-btn"
          aria-label="View the survey property on the map" @click="showOnMap"
        >
          <MapPin :size="12" aria-hidden="true" /> View on map
        </button>
      </div>

      <!-- ── 2. Workflow position ─────────────────────────────────────── -->
      <ol class="sc-flow" aria-label="Survey workflow position">
        <li
          v-for="(s, i) in WORKFLOW" :key="s"
          class="sc-flow-step"
          :class="{ done: stage > i + 1, active: stage === i + 1 }"
          :aria-current="stage === i + 1 ? 'step' : undefined"
        >
          <span class="sc-flow-n" aria-hidden="true">{{ i + 1 }}</span>
          <span class="sc-flow-l">{{ s }}</span>
        </li>
      </ol>

      <!-- ── Load error ───────────────────────────────────────────────── -->
      <div v-if="loadError" class="sc-note err" role="alert">
        <span>{{ loadError }}</span>
        <UiButton size="sm" variant="secondary" @click="load">Retry</UiButton>
      </div>

      <!-- ── Loading skeleton (layout-stable) ─────────────────────────── -->
      <div v-if="loading && !tasks.length" class="sc-tasks" aria-busy="true">
        <div v-for="n in 2" :key="n" class="sc-task">
          <div class="sk sk-line w60" /><div class="sk sk-line w35" /><div class="sk sk-line w80" />
        </div>
      </div>

      <!-- ── 3. Task list ─────────────────────────────────────────────── -->
      <ul v-else-if="tasks.length" class="sc-tasks">
        <li v-for="t in tasks" :key="t.id" class="sc-task">
          <div class="sc-task-head">
            <div class="sc-task-name">
              <strong>{{ typeParts(t.task_type).title }}</strong>
              <span v-if="typeParts(t.task_type).sub" class="sc-task-sub">{{ typeParts(t.task_type).sub }}</span>
            </div>
            <UiStatusBadge :tone="STATUS[t.status].tone" :label="STATUS[t.status].label" />
          </div>

          <div class="sc-meta">
            <div class="sc-fact">
              <span class="sc-k">Priority</span>
              <span class="sc-v" :class="`prio-${t.priority}`">
                {{ t.priority }}
                <UiStatusBadge
                  v-if="t.priority === 'high' || t.priority === 'urgent'"
                  :tone="PRIORITY_TONE[t.priority]" :label="t.priority === 'urgent' ? 'Urgent' : 'High'"
                  :dot="false"
                />
              </span>
            </div>
            <div class="sc-fact">
              <span class="sc-k">Due</span>
              <span class="sc-v mono" :class="{ overdue: isOverdue(t) }">
                {{ t.due_date ? fmtDate(t.due_date) : 'Not set' }}
                <template v-if="isOverdue(t)"> · overdue</template>
              </span>
            </div>
            <div class="sc-fact">
              <span class="sc-k">Requested</span>
              <span class="sc-v mono">{{ fmtDate(t.created_at) || '—' }}</span>
            </div>
          </div>

          <div v-if="t.instructions" class="sc-block">
            <span class="sc-k">Instructions</span>
            <p class="sc-body">{{ t.instructions }}</p>
          </div>

          <div v-if="t.findings && t.findings.length" class="sc-block sc-findings">
            <span class="sc-k"><FileText :size="11" aria-hidden="true" /> Survey findings</span>
            <div v-for="f in t.findings" :key="f.id" class="sc-finding">
              <div class="sc-rec">
                <span class="sc-k">Surveyor recommendation</span>
                <UiStatusBadge
                  :tone="f.recommendation ? (recTone[f.recommendation] ?? 'neutral') : 'neutral'"
                  :label="f.recommendation ? recLabel[f.recommendation] : 'Report submitted'"
                />
              </div>
              <p class="sc-body">{{ f.summary }}</p>
              <p v-if="f.conditions" class="sc-cond">
                <span class="sc-k">Conditions</span>{{ f.conditions }}
              </p>
              <p class="sc-stamp mono">Submitted {{ fmtDate(f.submitted_at) }}</p>
            </div>
          </div>

          <!-- Planner review — only a submitted report can be actioned. -->
          <div v-if="t.status === 'submitted'" class="sc-review">
            <div class="sc-review-text">
              <strong>Survey report received</strong>
              <span>Awaiting planner review<template v-if="lastFinding(t)"> · submitted {{ fmtDate(lastFinding(t)!.submitted_at) }}</template></span>
            </div>
            <div class="sc-review-actions">
              <UiButton
                variant="primary" size="sm" :disabled="reviewing"
                aria-label="Accept this survey report" @click="review(t.id, 'accepted')"
              >
                <template #icon><CheckCircle2 :size="13" /></template>
                Accept report
              </UiButton>
              <UiButton
                variant="danger" size="sm" :disabled="reviewing"
                aria-label="Return this survey report to the surveyor for rework"
                @click="review(t.id, 'returned')"
              >
                <template #icon><RotateCcw :size="13" /></template>
                Return for rework
              </UiButton>
            </div>
          </div>
          <p v-else-if="t.status === 'accepted'" class="sc-outcome ok">
            <CheckCircle2 :size="13" aria-hidden="true" />
            <span><strong>Survey report accepted.</strong> Evidence on file for the committee report.</span>
          </p>
          <p v-else-if="t.status === 'returned'" class="sc-outcome bad">
            <RotateCcw :size="13" aria-hidden="true" />
            <span><strong>Returned for rework.</strong> The task is back with the surveyor; the survey requirement is not yet met.</span>
          </p>
        </li>
      </ul>

      <!-- ── Empty ────────────────────────────────────────────────────── -->
      <div v-else-if="!loadError" class="sc-empty">
        <p class="sc-empty-t">No survey tasks</p>
        <p class="sc-empty-b">
          No survey work has been requested for this case.
          <template v-if="surveyRequired">Request a survey to satisfy the current case requirement.</template>
        </p>
        <UiButton size="sm" variant="secondary" @click="focusForm">Request survey</UiButton>
      </div>

      <!-- ── 4. Request form ──────────────────────────────────────────── -->
      <div class="sc-form">
        <h4 class="sc-form-t">Request survey</h4>
        <div class="sc-field">
          <label for="sc-type">Task type</label>
          <select id="sc-type" ref="typeSelect" v-model="form.task_type">
            <option v-for="tt in TASK_TYPES" :key="tt.value" :value="tt.value">{{ tt.label }}</option>
          </select>
        </div>
        <div class="sc-field">
          <label for="sc-instr">Instructions</label>
          <textarea
            id="sc-instr" v-model="form.instructions" rows="2"
            placeholder="What to verify / peg, references, approved layout number…"
          />
        </div>
        <div class="sc-form-row">
          <div class="sc-field">
            <label for="sc-prio">Priority</label>
            <select id="sc-prio" v-model="form.priority">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div class="sc-field">
            <label for="sc-due">Due date</label>
            <input id="sc-due" v-model="form.due_date" type="date" />
          </div>
        </div>
        <UiButton
          variant="primary" size="sm" :loading="submitting"
          aria-label="Send this survey request to the surveyor queue" @click="request"
        >
          <template #icon><Send :size="13" /></template>
          Request survey
        </UiButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Enterprise tokens only — see src/styles/enterprise.css. */
.sc {
  background: var(--ent-surface); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md); padding: var(--ent-s3);
  display: flex; flex-direction: column; gap: var(--ent-s3);
  font-family: var(--ent-font); color: var(--ent-text);
}
.mono { font-family: var(--ent-font-mono); }

/* Header */
.sc-head { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.sc-head-icon { color: var(--ent-text-3); flex-shrink: 0; }
.sc-head-text { flex: 1 1 180px; min-width: 0; }
.sc-head-text h3 {
  margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight);
}
.sc-head-text p { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.sc-refresh {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface);
  color: var(--ent-text-2); cursor: pointer;
}
.sc-refresh:hover:not(:disabled) { background: var(--ent-surface-2); color: var(--ent-text); }
.sc-refresh:disabled { opacity: 0.55; cursor: not-allowed; }
.sc-refresh:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.spin { animation: sc-spin 0.9s linear infinite; }
@keyframes sc-spin { to { transform: rotate(360deg); } }

/* Statutory gate */
.sc-gate {
  display: flex; gap: var(--ent-s2); align-items: flex-start;
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
  border-width: 1px 1px 1px 3px; border-style: solid;
}
.sc-gate.warn { background: var(--ent-warning-soft); border-color: var(--ent-warning); color: var(--ent-warning); }
.sc-gate.ok   { background: var(--ent-success-soft); border-color: var(--ent-success); color: var(--ent-success); }
.sc-gate-title {
  margin: 0; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.sc-gate-body { margin: 2px 0 0; font-size: var(--ent-fs-xs); line-height: var(--ent-lh); color: var(--ent-text); }

/* Notes / errors */
.sc-note {
  display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap;
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
  background: var(--ent-surface-2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
}
.sc-note strong { color: var(--ent-text); }
.sc-note.err { background: var(--ent-danger-soft); border-color: var(--ent-tone-negative-line); color: var(--ent-danger); }
.sc-note.err span { flex: 1 1 160px; }

/* Property context */
.sc-context {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s3);
  background: var(--ent-surface-2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
}
.sc-fact { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.sc-k {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--ent-text-3);
}
.sc-v {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  font-size: var(--ent-fs-sm); color: var(--ent-text); overflow-wrap: anywhere;
}
.sc-v.prio-low, .sc-v.prio-normal { color: var(--ent-text-2); }
.sc-v[class*='prio-'] { text-transform: capitalize; }
.sc-v.overdue { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.sc-map-btn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  min-height: 26px; padding: 0 var(--ent-s2);
  font-size: var(--ent-fs-xs); font-family: var(--ent-font);
  background: var(--ent-surface); color: var(--ent-accent);
  border: 1px solid var(--ent-accent-line); border-radius: var(--ent-r-sm); cursor: pointer;
}
.sc-map-btn:hover { background: var(--ent-accent-soft); }
.sc-map-btn:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

/* Workflow rail */
.sc-flow {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: var(--ent-s1);
}
.sc-flow-step {
  display: flex; align-items: center; gap: 6px;
  padding: 5px var(--ent-s2); border-radius: var(--ent-r-sm);
  border: 1px solid var(--ent-line); background: var(--ent-surface-2);
  font-size: var(--ent-fs-micro); color: var(--ent-text-3); min-width: 0;
}
.sc-flow-n {
  display: inline-flex; align-items: center; justify-content: center;
  width: 15px; height: 15px; flex-shrink: 0; border-radius: 50%;
  background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg);
  font-family: var(--ent-font-mono); font-size: 9px; font-weight: var(--ent-fw-bold);
}
.sc-flow-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-flow-step.done { background: var(--ent-success-soft); border-color: var(--ent-tone-positive-line); color: var(--ent-success); }
.sc-flow-step.done .sc-flow-n { background: var(--ent-success); color: #fff; }
.sc-flow-step.active {
  background: var(--ent-accent-soft); border-color: var(--ent-accent);
  color: var(--ent-accent); font-weight: var(--ent-fw-semibold);
}
.sc-flow-step.active .sc-flow-n { background: var(--ent-accent); color: var(--ent-text-on-accent); }

/* Task rows — hairline-separated, not nested cards */
.sc-tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sc-task {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s3) 0; border-top: 1px solid var(--ent-line);
}
.sc-task:first-child { border-top: none; padding-top: var(--ent-s1); }
.sc-task-head { display: flex; align-items: flex-start; gap: var(--ent-s2); flex-wrap: wrap; }
.sc-task-name { flex: 1 1 160px; min-width: 0; display: flex; flex-direction: column; }
.sc-task-name strong { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); }
.sc-task-sub { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.sc-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: var(--ent-s2); }
.sc-block { display: flex; flex-direction: column; gap: 2px; }
.sc-body {
  margin: 0; font-size: var(--ent-fs-sm); line-height: var(--ent-lh);
  color: var(--ent-text-2); overflow-wrap: anywhere;
}

/* Findings — evidence from another professional */
.sc-findings {
  background: var(--ent-surface-2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3); gap: var(--ent-s2);
}
.sc-finding { display: flex; flex-direction: column; gap: var(--ent-s1); }
.sc-finding + .sc-finding { border-top: 1px solid var(--ent-line); padding-top: var(--ent-s2); }
.sc-rec { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.sc-cond { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-warning); }
.sc-cond .sc-k { display: block; color: var(--ent-text-3); }
.sc-stamp { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

/* Planner review panel */
.sc-review {
  display: flex; flex-wrap: wrap; gap: var(--ent-s2); align-items: center;
  background: var(--ent-warning-soft); border: 1px solid var(--ent-tone-warning-line);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2) var(--ent-s3);
}
.sc-review-text { flex: 1 1 180px; display: flex; flex-direction: column; }
.sc-review-text strong { font-size: var(--ent-fs-sm); color: var(--ent-text); }
.sc-review-text span { font-size: var(--ent-fs-micro); color: var(--ent-text-2); }
.sc-review-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }

.sc-outcome {
  margin: 0; display: flex; align-items: flex-start; gap: 6px;
  font-size: var(--ent-fs-xs); line-height: var(--ent-lh);
  border-radius: var(--ent-r-sm); padding: var(--ent-s2);
}
.sc-outcome span { color: var(--ent-text); }
.sc-outcome.ok  { background: var(--ent-success-soft); color: var(--ent-success); }
.sc-outcome.bad { background: var(--ent-danger-soft); color: var(--ent-danger); }

/* Empty */
.sc-empty {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s2);
  border: 1px dashed var(--ent-line-strong); border-radius: var(--ent-r-sm);
  padding: var(--ent-s3); background: var(--ent-surface-2);
}
.sc-empty-t { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.sc-empty-b { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); max-width: 46ch; }

/* Request form */
.sc-form {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  border-top: 1px solid var(--ent-line); padding-top: var(--ent-s3);
}
.sc-form-t {
  margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--ent-text-3);
}
.sc-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 130px; }
.sc-field label { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-medium); color: var(--ent-text-2); }
.sc-form select, .sc-form textarea, .sc-form input {
  width: 100%; font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong);
  border-radius: var(--ent-r-sm); padding: 0 var(--ent-s2); min-height: var(--ent-control-h-sm);
}
.sc-form textarea { padding: 6px var(--ent-s2); resize: vertical; line-height: var(--ent-lh); }
.sc-form select:focus-visible, .sc-form textarea:focus-visible, .sc-form input:focus-visible {
  outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring);
}
.sc-form-row { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }

/* Skeleton */
.sk { background: var(--ent-surface-2); border-radius: var(--ent-r-sm); }
.sk-line { height: 10px; margin-bottom: 6px; animation: sc-pulse 1.4s ease-in-out infinite; }
.w60 { width: 60%; } .w35 { width: 35%; } .w80 { width: 80%; }
@keyframes sc-pulse { 50% { opacity: 0.45; } }

@media (prefers-reduced-motion: reduce) {
  .spin, .sk-line { animation: none; }
}
</style>
