<script setup lang="ts">
// Inspections — 9-stage construction inspection tracking per approved
// permit. Layout matches the Stitch "Inspection Tracking" design:
// header (ref + location + actions), a stage timeline (approved /
// next-step / locked) and a sidebar with the request form, property
// summary and an activity feed. Requests pre-schedule the Inspector,
// who then attends, scores, and stamps Annexure 12.

import { ref, computed, onMounted, watch } from 'vue'
import { useCitizenCase } from '@/composables/useCitizenCase'
import { permitStatusToLifecycle } from '@/services/citizenPortalService'
import { dmApi, type StageInspection } from '@/services/developmentManagementService'
import { INSPECTION_STAGES_STATIC } from '@/composables/useInspectionCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import { downloadCitizenPdf } from '@/views/citizen/citizenDocuments'
import {
  RefreshCw, CheckCircle2, XCircle, Clock, Lock, Download, Plus,
  MapPin, Fingerprint, Info, User, Calendar,
} from 'lucide-vue-next'

const cc = useCitizenCase()
const fb = useUiFeedback()

const inspByCase = ref<Record<string, StageInspection[]>>({})
const loading = ref(false)
const requestNotes = ref<Record<string, string>>({})
const preferredDate = ref<Record<string, string>>({})
const requestCard = ref<HTMLElement | null>(null)

const constructionCases = computed(() =>
  cc.applications.value.filter(p =>
    p.status === 'approved' || p.status === 'conditionally_approved'))

const selectedCaseId = ref<string | null>(null)
const selectedCase = computed(() =>
  constructionCases.value.find(p => p.id === selectedCaseId.value) ?? constructionCases.value[0] ?? null)

async function refresh() {
  loading.value = true
  try {
    for (const p of constructionCases.value) {
      try {
        inspByCase.value[p.id] = await dmApi.listStageInspections(p.id)
      } catch { inspByCase.value[p.id] = [] }
    }
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
watch(() => cc.applications.value.length, refresh)

function stageStatus(permitId: string, stage: number): 'pending'|'scheduled'|'pass'|'fail'|'rework' {
  const insp = (inspByCase.value[permitId] || []).find(i => i.stage_number === stage)
  if (!insp) return 'pending'
  const r = String(insp.result || '').toLowerCase()
  if (r === 'pass' || r === 'conditional_pass') return 'pass'
  if (r === 'fail' || r === 'reinspection_required') return 'fail'
  if (insp.scheduled_at && !insp.inspected_at) return 'scheduled'
  return 'rework'
}

const minInspectDate = computed(() => new Date().toISOString().slice(0, 10))

async function requestInspection(permitId: string, stageNumber: number) {
  const preferred = preferredDate.value[permitId]
  if (preferred && preferred < minInspectDate.value) {
    fb.showToast('Preferred date cannot be in the past.', 'warning')
    return
  }
  try {
    await dmApi.createStageInspection(permitId, {
      stage_number: stageNumber,
      scheduled_at: preferredDate.value[permitId]
        ? new Date(preferredDate.value[permitId]).toISOString()
        : new Date().toISOString(),
      notes: (requestNotes.value[permitId + ':' + stageNumber] || 'Applicant request — site ready for inspection.'),
    })
    fb.showToast(`Stage ${stageNumber} inspection requested.`, 'success')
    await refresh()
  } catch (err: any) {
    fb.showToast(fb.parseApiError(err, 'Could not request inspection'), 'error')
  }
}

function nextStageNeeded(permitId: string): number | null {
  for (let n = 1; n <= 9; n++) {
    const s = stageStatus(permitId, n)
    if (s !== 'pass') return n
  }
  return null
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

// ── Presentation helpers ──────────────────────────────────────────────
interface StageView { state: 'done' | 'next' | 'scheduled' | 'fail' | 'locked'; label: string; pill: string }
function stageView(permitId: string, n: number): StageView {
  const s = stageStatus(permitId, n)
  const isNext = nextStageNeeded(permitId) === n
  if (s === 'pass')      return { state: 'done',      label: 'Approved',      pill: 'pill-green' }
  if (s === 'fail')      return { state: 'fail',      label: 'Reinspection',  pill: 'pill-red' }
  if (s === 'scheduled') return { state: 'scheduled', label: 'Scheduled',     pill: 'pill-blue' }
  if (isNext)            return { state: 'next',      label: 'Next step',     pill: 'pill-primary' }
  return { state: 'locked', label: '', pill: '' }
}
function inspectionFor(permitId: string, n: number): StageInspection | undefined {
  return (inspByCase.value[permitId] || []).find(i => i.stage_number === n)
}
function inspectorName(insp?: StageInspection): string {
  const any = insp as any
  return any?.inspector_name || any?.inspector_full_name || any?.inspector || 'Building Inspector'
}
const completedCount = computed(() => {
  const id = selectedCase.value?.id
  if (!id) return 0
  return INSPECTION_STAGES_STATIC.filter(s => stageStatus(id, s.n) === 'pass').length
})

interface Activity { dot: 'green' | 'primary' | 'red'; text: string; when: string; by?: string }
const activity = computed<Activity[]>(() => {
  const id = selectedCase.value?.id
  if (!id) return []
  const items: Activity[] = []
  for (const i of (inspByCase.value[id] || [])) {
    if (i.inspected_at) {
      const pass = stageStatus(id, i.stage_number) === 'pass'
      items.push({ dot: pass ? 'green' : 'red', text: `Stage ${i.stage_number} ${pass ? 'approved' : 'returned'}`,
        when: i.inspected_at, by: inspectorName(i) })
    } else if (i.scheduled_at) {
      items.push({ dot: 'primary', text: `Stage ${i.stage_number} scheduled`, when: i.scheduled_at })
    }
  }
  return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 6)
})

function newRequest() { requestCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function downloadReport() {
  const p = selectedCase.value
  if (!p) return
  const refNo = p.dev_register_no || p.id.slice(0, 12)
  const lines: string[] = [
    `Reference: ${refNo}`,
    `Applicant: ${p.applicant_name || '—'}`,
    `Stand: ${p.stand_number || '—'}, ${p.suburb_ward || '—'}`,
    `Stages completed: ${completedCount.value} of 9`,
    '',
    'Stage record',
  ]
  for (const s of INSPECTION_STAGES_STATIC) {
    const view = stageView(p.id, s.n)
    const insp = inspectionFor(p.id, s.n)
    lines.push(`Stage ${s.n} ${s.name}: ${view.label || 'Not requested'}`)
    if (insp?.inspected_at) lines.push(`  Inspected ${fmtDate(insp.inspected_at)} by ${inspectorName(insp)}`)
    else if (insp?.scheduled_at) lines.push(`  Scheduled ${fmtDate(insp.scheduled_at)}`)
    if (insp?.notes) lines.push(`  Notes: ${insp.notes}`)
  }
  downloadCitizenPdf(
    `vungu-inspection-${refNo.replace(/[^\w-]+/g, '_')}.pdf`,
    'Stage inspection record',
    lines,
  )
  fb.showToast('Inspection report downloaded.', 'success')
}
</script>

<template>
  <div class="ins">
    <!-- Header -->
    <header class="ins-header">
      <div class="ins-header-l">
        <div class="ins-title-row">
          <h1>Inspection tracking</h1>
          <span v-if="selectedCase" class="pill pill-blue">{{ permitStatusToLifecycle(selectedCase) }}</span>
          <button class="ins-refresh" @click="refresh" :disabled="loading" title="Refresh">
            <RefreshCw :size="14" :class="{ spin: loading }" />
          </button>
        </div>
        <div v-if="selectedCase" class="ins-meta">
          <span class="ins-meta-i"><Fingerprint :size="16" /><span class="mono">{{ selectedCase.dev_register_no || selectedCase.id.slice(0, 12) }}</span></span>
          <span class="ins-meta-i"><MapPin :size="16" />Stand {{ selectedCase.stand_number }}, {{ selectedCase.suburb_ward }}</span>
        </div>
      </div>
      <div v-if="selectedCase" class="ins-header-actions">
        <button class="ins-btn ghost" @click="downloadReport"><Download :size="16" /> Download report</button>
        <button class="ins-btn primary" @click="newRequest"><Plus :size="16" /> New request</button>
      </div>
    </header>

    <!-- Case selector (multiple construction cases) -->
    <div v-if="constructionCases.length > 1" class="ins-cases">
      <button v-for="p in constructionCases" :key="p.id" type="button"
              class="ins-case" :class="{ active: selectedCase?.id === p.id }" @click="selectedCaseId = p.id">
        <span class="mono">{{ p.dev_register_no || p.id.slice(0, 10) }}</span> · Stand {{ p.stand_number }}
      </button>
    </div>

    <!-- Empty -->
    <div v-if="!selectedCase" class="cp-card ins-empty">
      <p>Inspections open after Council issues a permit and construction starts. Open My applications to check status.</p>
    </div>

    <!-- Detail -->
    <div v-else class="ins-grid">
      <!-- Stages timeline -->
      <div class="cp-card ins-stages-card">
        <div class="cp-card-head between">
          <h2>Inspection stages</h2>
          <span>{{ completedCount }} of 9 stages completed</span>
        </div>
        <ol class="ins-timeline">
          <li v-for="s in INSPECTION_STAGES_STATIC" :key="s.n" :class="stageView(selectedCase.id, s.n).state">
            <span class="ins-node">
              <CheckCircle2 v-if="stageView(selectedCase.id, s.n).state === 'done'" :size="20" />
              <XCircle v-else-if="stageView(selectedCase.id, s.n).state === 'fail'" :size="20" />
              <Clock v-else-if="stageView(selectedCase.id, s.n).state === 'scheduled'" :size="20" />
              <Clock v-else-if="stageView(selectedCase.id, s.n).state === 'next'" :size="20" />
              <Lock v-else :size="16" />
            </span>
            <div class="ins-stage-body">
              <div class="between">
                <h3>Stage {{ s.n }}: {{ s.name }}</h3>
                <span v-if="stageView(selectedCase.id, s.n).label" class="pill" :class="stageView(selectedCase.id, s.n).pill">
                  {{ stageView(selectedCase.id, s.n).label }}
                </span>
              </div>
              <template v-if="stageView(selectedCase.id, s.n).state === 'done'">
                <div class="ins-stage-meta">
                  <span><User :size="14" /> {{ inspectorName(inspectionFor(selectedCase.id, s.n)) }}</span>
                  <span><Calendar :size="14" /> {{ fmtDate(inspectionFor(selectedCase.id, s.n)?.inspected_at) }}</span>
                </div>
              </template>
              <p v-else-if="stageView(selectedCase.id, s.n).state === 'next'" class="ins-stage-note">
                Ready for inspection request. {{ s.desc }}
              </p>
              <p v-else-if="stageView(selectedCase.id, s.n).state === 'scheduled'" class="ins-stage-note">
                Inspection requested — awaiting the Inspector's visit.
              </p>
            </div>
          </li>
        </ol>
      </div>

      <!-- Sidebar -->
      <div class="ins-side">
        <!-- Request inspection -->
        <div ref="requestCard" class="cp-card">
          <div class="cp-card-head"><h2>Request inspection</h2></div>
          <div v-if="nextStageNeeded(selectedCase.id) != null" class="ins-req-body">
            <p class="ins-req-lead">Schedule an official visit for the current stage
              <strong>(Stage {{ nextStageNeeded(selectedCase.id) }}).</strong></p>
            <label class="ins-lbl">Preferred date</label>
            <input type="date" class="ins-input" v-model="preferredDate[selectedCase.id]" :min="minInspectDate" />
            <label class="ins-lbl">Notes for inspector (optional)</label>
            <textarea class="ins-input" rows="3" placeholder="e.g. Site gate code is 1234…"
              v-model="requestNotes[selectedCase.id + ':' + nextStageNeeded(selectedCase.id)]"></textarea>
            <div class="ins-info">
              <Info :size="18" />
              <p>By requesting, you confirm the works are ready to be viewed and site-safety protocols are active.</p>
            </div>
            <button class="ins-btn primary full" @click="requestInspection(selectedCase.id, nextStageNeeded(selectedCase.id)!)">
              Request Stage {{ nextStageNeeded(selectedCase.id) }} inspection
            </button>
          </div>
          <div v-else class="ins-done">
            All 9 stages complete. The Building Inspector will arrange the joint final inspection for the Certificate of Occupation.
          </div>
        </div>

        <!-- Property summary -->
        <div class="cp-card ins-prop">
          <div class="ins-prop-banner">
            <span class="ins-prop-pin"><MapPin :size="16" /></span>
            <span>Stand {{ selectedCase.stand_number }}, {{ selectedCase.suburb_ward }}</span>
          </div>
          <div class="ins-prop-rows">
            <div><span class="k">Owner</span><span class="v">{{ selectedCase.applicant_name || '—' }}</span></div>
            <div><span class="k">Stand</span><span class="v">{{ selectedCase.stand_number }}</span></div>
            <div><span class="k">Ward</span><span class="v">{{ selectedCase.suburb_ward }}</span></div>
          </div>
        </div>

        <!-- Activity -->
        <div class="cp-card ins-activity">
          <div class="cp-card-head"><h2>Inspection activity</h2></div>
          <div v-if="!activity.length" class="ins-act-empty">No inspection activity yet.</div>
          <ul v-else class="ins-act-list">
            <li v-for="(a, i) in activity" :key="i">
              <span class="ins-dot" :class="a.dot"></span>
              <div>
                <p class="ins-act-text">{{ a.text }}</p>
                <p class="ins-act-when">{{ fmtDate(a.when) }}<template v-if="a.by"> · {{ a.by }}</template></p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.ins { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1200px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }

/* Header */
.ins-header { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
.ins-title-row { display:flex; align-items:center; gap:0.6rem; }
.ins-title-row h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); text-transform:capitalize; }
.ins-refresh { background:none; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.3rem; color:var(--cp-muted); cursor:pointer; }
.spin { animation: insspin 0.8s linear infinite; }
@keyframes insspin { to { transform: rotate(360deg); } }
.ins-meta { display:flex; flex-wrap:wrap; gap:1.25rem; margin-top:0.5rem; }
.ins-meta-i { display:inline-flex; align-items:center; gap:0.4rem; font-size:0.82rem; color:var(--cp-text-2); }
.ins-meta-i .mono { text-transform:uppercase; letter-spacing:0.03em; }
.ins-header-actions { display:flex; gap:0.5rem; }

/* Buttons */
.ins-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem;
  padding:0.5rem 0.9rem; border:1px solid transparent; border-radius:var(--cp-radius-sm);
  font-size:0.82rem; font-weight:600; cursor:pointer; }
.ins-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.ins-btn.primary:hover { background:var(--cp-primary-hover); }
.ins-btn.ghost { background:transparent; border-color:var(--cp-border); color:var(--cp-text-2); }
.ins-btn.ghost:hover { background:var(--cp-surface-2); }
.ins-btn.full { width:100%; }

/* Pills */
.pill { display:inline-flex; align-items:center; gap:0.25rem; padding:0.15rem 0.55rem;
  border-radius:var(--cp-radius-pill); font-size:0.64rem; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; }
.pill-blue    { background:var(--cp-blue-bg);  color:var(--cp-blue-fg); }
.pill-green   { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-red     { background:var(--cp-red-bg);   color:var(--cp-red-fg); }
.pill-primary { background:var(--cp-primary-tint); color:var(--cp-primary); }

/* Case selector */
.ins-cases { display:flex; flex-wrap:wrap; gap:0.4rem; }
.ins-case { padding:0.4rem 0.7rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  background:var(--cp-surface); font-size:0.76rem; color:var(--cp-text-2); cursor:pointer; }
.ins-case.active { border-color:var(--cp-primary); background:var(--cp-primary-tint); color:var(--cp-primary); font-weight:600; }

/* Cards */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head.between { justify-content:space-between; }
.cp-card-head h2 { margin:0; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.cp-card-head span { font-size:0.76rem; color:var(--cp-muted); }
.between { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }

.ins-empty { padding:2.5rem 1.5rem; color:var(--cp-text-2); font-size:0.88rem; }
.ins-empty p { margin:0; max-width:48ch; }

/* Grid */
.ins-grid { display:flex; flex-direction:column; gap:1rem; }
.ins-side { display:flex; flex-direction:column; gap:1rem; }

/* Timeline */
.ins-timeline { list-style:none; margin:0; padding:1.25rem; position:relative; display:flex; flex-direction:column; gap:1.5rem; }
.ins-timeline::before { content:''; position:absolute; left:calc(1.25rem + 19px); top:1.75rem; bottom:1.75rem; width:2px; background:var(--cp-border); }
.ins-timeline li { position:relative; display:flex; gap:1rem; }
.ins-node { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center;
  width:40px; height:40px; border-radius:50%; flex-shrink:0; box-shadow:0 0 0 4px var(--cp-surface);
  background:var(--cp-surface-2); color:var(--cp-faint); }
.ins-timeline li.done .ins-node      { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.ins-timeline li.scheduled .ins-node { background:var(--cp-blue-bg); color:var(--cp-blue-fg); }
.ins-timeline li.next .ins-node      { background:var(--cp-primary-tint); color:var(--cp-primary); }
.ins-timeline li.fail .ins-node      { background:var(--cp-red-bg); color:var(--cp-red-fg); }
.ins-timeline li.locked { opacity:0.5; }
.ins-stage-body { flex:1; min-width:0; padding-bottom:0.25rem; }
.ins-stage-body h3 { margin:0; font-size:0.9rem; font-weight:700; color:var(--cp-text); }
.ins-timeline li.next .ins-stage-body h3 { color:var(--cp-primary); }
.ins-timeline li.locked .ins-stage-body h3 { font-weight:500; }
.ins-stage-meta { display:flex; flex-wrap:wrap; gap:1.25rem; margin-top:0.45rem; }
.ins-stage-meta span { display:inline-flex; align-items:center; gap:0.35rem; font-size:0.78rem; color:var(--cp-muted); }
.ins-stage-note { margin:0.45rem 0 0; font-size:0.8rem; color:var(--cp-text-2); font-style:italic; }

/* Request */
.ins-req-body { padding:1.1rem; display:flex; flex-direction:column; gap:0.5rem; }
.ins-req-lead { margin:0 0 0.5rem; font-size:0.82rem; color:var(--cp-text-2); }
.ins-lbl { font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); margin-top:0.3rem; }
.ins-input { padding:0.5rem 0.65rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  font-size:0.82rem; color:var(--cp-text); font-family:inherit; background:var(--cp-surface); resize:vertical; }
.ins-input:focus { outline:2px solid var(--cp-primary); outline-offset:-2px; border-color:var(--cp-primary); }
.ins-info { display:flex; gap:0.6rem; padding:0.75rem; margin:0.5rem 0; border-radius:var(--cp-radius-sm); background:var(--cp-primary-tint); }
.ins-info :deep(svg) { color:var(--cp-primary); flex-shrink:0; }
.ins-info p { margin:0; font-size:0.76rem; color:var(--cp-primary-hover); line-height:1.5; }
.ins-done { padding:1rem 1.1rem; font-size:0.82rem; color:var(--cp-green-fg); background:var(--cp-green-bg); }

/* Property */
.ins-prop-banner { display:flex; align-items:center; gap:0.6rem; padding:1rem 1.1rem;
  background:var(--cp-primary); color:#fff; font-size:0.88rem; font-weight:600; }
.ins-prop-pin { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px;
  border-radius:var(--cp-radius-sm); background:rgba(255,255,255,0.18); }
.ins-prop-rows { padding:0.4rem 1.1rem 0.85rem; }
.ins-prop-rows > div { display:flex; align-items:center; justify-content:space-between; padding:0.6rem 0; border-bottom:1px solid var(--cp-border); }
.ins-prop-rows > div:last-child { border-bottom:0; }
.ins-prop-rows .k { font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.ins-prop-rows .v { font-size:0.84rem; font-weight:500; color:var(--cp-text); }

/* Activity */
.ins-act-empty { padding:1.25rem; text-align:center; color:var(--cp-faint); font-size:0.8rem; }
.ins-act-list { list-style:none; margin:0; padding:1rem 1.1rem; display:flex; flex-direction:column; gap:1rem; }
.ins-act-list li { display:flex; gap:0.7rem; }
.ins-dot { width:8px; height:8px; border-radius:50%; margin-top:6px; flex-shrink:0; }
.ins-dot.green   { background:#16a34a; }
.ins-dot.primary { background:var(--cp-primary); }
.ins-dot.red     { background:var(--cp-red-fg); }
.ins-act-text { margin:0; font-size:0.82rem; font-weight:500; color:var(--cp-text); }
.ins-act-when { margin:0.1rem 0 0; font-size:0.7rem; color:var(--cp-muted); }

/* ── Desktop ──────────────────────────────────────────────────────── */
@media (min-width: 1024px) {
  .ins { padding:1.5rem; }
  .ins-grid { display:grid; grid-template-columns:2fr 1fr; align-items:start; }
}
</style>
