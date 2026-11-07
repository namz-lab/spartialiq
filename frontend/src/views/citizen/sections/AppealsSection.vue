<script setup lang="ts">
// Appeals Tracking — lodge an appeal against a refused application within
// one month (s.38) of the refusal letter and track it to a decision. Layout matches
// the Stitch "Appeals Tracking" design: a featured appeal card (summary /
// progress timeline / documents) plus an "Other appeals" list (table on
// desktop, cards on mobile). Persisted locally via useCitizenCase.

import { ref, computed, onMounted, watch } from 'vue'
import { useCitizenCase, type AppealRecord } from '@/composables/useCitizenCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import { dmApi } from '@/services/developmentManagementService'
import { appealDeadline, daysUntil } from '@/statutory/periods'
import { documentFileError } from '@/utils/citizenValidation'
import { downloadCitizenPdf } from '@/views/citizen/citizenDocuments'
import {
  Gavel, Plus, Clock, Check, CalendarCheck, Hourglass, FileText, Upload,
  Search, Printer, ChevronDown,
} from 'lucide-vue-next'

const cc = useCitizenCase()
const fb = useUiFeedback()

// Appeals are the backend's system of record — load the citizen's own on mount.
onMounted(() => { cc.refreshAppeals() })

const refusedCases = computed(() =>
  cc.applications.value.filter(p => {
    if (p.status !== 'refused') return false
    const left = appealDaysLeft(p)
    return left == null || left >= 0
  }))

const newAppealOpen = ref(false)
const submitting = ref(false)
const newAppeal = ref<{ permit_application_id: string; grounds: string }>({
  permit_application_id: '', grounds: '',
})

async function fileAppeal() {
  if (!newAppeal.value.permit_application_id || newAppeal.value.grounds.trim().length < 40) {
    fb.showToast('Pick the refused case and state the grounds in at least 40 characters.', 'warning')
    return
  }
  const chosen = refusedCases.value.find(p => p.id === newAppeal.value.permit_application_id)
  if (!chosen) {
    fb.showToast('That case is outside the one-month appeal window (s.38).', 'warning')
    return
  }
  submitting.value = true
  try {
    await cc.fileAppeal({
      permit_application_id: newAppeal.value.permit_application_id,
      grounds: newAppeal.value.grounds.trim(),
    })
    fb.showToast('Appeal lodged with the council.', 'success')
    // Only clear the form on success — a failed submit keeps what was typed.
    newAppealOpen.value = false
    newAppeal.value = { permit_application_id: '', grounds: '' }
  } catch (err) {
    fb.showToast(fb.parseApiError(err, 'Could not lodge the appeal. Please try again.'), 'error')
  } finally {
    submitting.value = false
  }
}

// Appeal status is advanced only by council staff — the citizen view is
// read-only on status (no self-advancement).

function findCase(permitId: string) {
  return cc.applications.value.find(p => p.id === permitId)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

/** Days left to appeal: one calendar month from the decision (s.38(1)(a)); negative once it has passed. */
function appealDaysLeft(p: ReturnType<typeof findCase>): number | null {
  if (!p?.updated_at) return null
  return daysUntil(appealDeadline(new Date(p.updated_at).toISOString()))
}

// ── Presentation helpers ──────────────────────────────────────────────
const STATUS_META: Record<AppealRecord['status'], { label: string; cls: string }> = {
  lodged:            { label: 'Lodged',            cls: 'pill-blue' },
  acknowledged:      { label: 'Acknowledged',      cls: 'pill-blue' },
  hearing_scheduled: { label: 'Hearing scheduled', cls: 'pill-amber' },
  decided:           { label: 'Decided',           cls: 'pill-green' },
  withdrawn:         { label: 'Withdrawn',         cls: 'pill-gray' },
}
const STATUS_RANK: Record<AppealRecord['status'], number> = {
  lodged: 1, acknowledged: 2, hearing_scheduled: 3, decided: 4, withdrawn: 4,
}
const DECISION_LABEL: Record<NonNullable<AppealRecord['decision']>, string> = {
  upheld: 'Upheld — the refusal is set aside',
  dismissed: 'Dismissed — the refusal stands',
  remitted: 'Remitted — returned to Council for re-determination',
}

function appealRef(a: AppealRecord) {
  return ('APP-' + a.id.replace(/[^a-z0-9]/gi, '')).slice(0, 14).toUpperCase()
}
function appealTitle(a: AppealRecord) {
  const c = findCase(a.permit_application_id)
  if (c) return `Appeal — Stand ${c.stand_number}, ${c.suburb_ward}`
  return 'Planning decision appeal'
}

interface Step { label: string; date: string; detail?: string; state: 'done' | 'current' | 'pending' }
function progressSteps(a: AppealRecord): Step[] {
  const r = STATUS_RANK[a.status]
  const st = (threshold: number): Step['state'] =>
    r >= threshold ? 'done' : (r === threshold - 1 ? 'current' : 'pending')
  return [
    { label: 'Appeal lodged',     date: fmtDate(a.lodged_at),   state: st(1) },
    { label: 'Acknowledged',      date: r >= 2 ? 'Completed' : 'Pending', state: st(2) },
    { label: 'Hearing scheduled', date: a.hearing_date ? fmtDate(a.hearing_date) : 'Date set by the Court', state: st(3) },
    { label: a.status === 'decided' ? 'Decision issued' : 'Decision pending',
      date: a.decided_at ? fmtDate(a.decided_at) : 'Awaiting the Court', state: st(4) },
  ]
}

// Featured = selected, else most recent.
const selectedId = ref<string | null>(null)
const sortedAppeals = computed(() =>
  [...cc.appeals.value].sort((a, b) => new Date(b.lodged_at).getTime() - new Date(a.lodged_at).getTime()))
const featured = computed<AppealRecord | null>(() =>
  sortedAppeals.value.find(a => a.id === selectedId.value) ?? sortedAppeals.value[0] ?? null)
const others = computed(() => sortedAppeals.value.filter(a => a.id !== featured.value?.id))

const search = ref('')
const filteredOthers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return others.value
  return others.value.filter(a =>
    appealRef(a).toLowerCase().includes(q) || a.grounds.toLowerCase().includes(q))
})

// ── Evidence + record ─────────────────────────────────────────────────
// Evidence is a permit document (doc_type appeal_evidence) on the refused
// case — the backend has no appeal-scoped attachment table.
const evidenceInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const evidence = ref<Record<string, string[]>>({})
function evidenceFor(a: AppealRecord) { return evidence.value[a.permit_application_id] ?? [] }
async function loadEvidence(permitId: string) {
  try {
    const docs = await dmApi.listPermitDocuments(permitId)
    evidence.value = {
      ...evidence.value,
      [permitId]: docs.filter(d => d.doc_type === 'appeal_evidence').map(d => d.file_name),
    }
  } catch { /* list stays empty; upload still works */ }
}
watch(() => featured.value?.permit_application_id, id => { if (id) loadEvidence(id) }, { immediate: true })
async function uploadEvidence(a: AppealRecord, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const err = documentFileError(file)
  if (err) { fb.showToast(err, 'warning'); return }
  uploading.value = true
  try {
    await dmApi.uploadPermitDocument(a.permit_application_id, file, 'appeal_evidence')
    await loadEvidence(a.permit_application_id)
    fb.showToast(`${file.name} added to the case file.`, 'success')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Upload failed. Try again.'), 'error')
  } finally {
    uploading.value = false
  }
}
function downloadAppeal(a: AppealRecord) {
  const c = findCase(a.permit_application_id)
  downloadCitizenPdf(`vungu-appeal-${appealRef(a)}.pdf`, 'Planning appeal record', [
    `Appeal reference: ${appealRef(a)}`,
    `Application: ${c?.dev_register_no || a.permit_application_id}`,
    `Property: ${c ? `Stand ${c.stand_number}, ${c.suburb_ward}` : '—'}`,
    `Status: ${STATUS_META[a.status].label}`,
    `Lodged: ${fmtDate(a.lodged_at)}`,
    `Hearing: ${a.hearing_date ? fmtDate(a.hearing_date) : 'Not yet set by the Court'}`,
    ...(a.decision ? [`Outcome: ${DECISION_LABEL[a.decision]}`] : []),
    '',
    'Grounds of appeal',
    a.grounds || '—',
  ])
}

const expanded = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const s = new Set(expanded.value)
  s.has(id) ? s.delete(id) : s.add(id)
  expanded.value = s
}
</script>

<template>
  <div class="ap">
    <!-- Header -->
    <header class="ap-header">
      <div>
        <h1>Appeals tracking</h1>
        <p>Monitor the status and progress of your submitted appeals within the Vungu RDC jurisdiction.</p>
      </div>
      <button class="ap-btn primary" @click="newAppealOpen = !newAppealOpen"><Plus :size="15" /> Lodge appeal</button>
    </header>

    <!-- Refused-case appeal window -->
    <div v-if="refusedCases.length" class="ap-window">
      <Clock :size="16" />
      <div class="ap-window-body">
        <strong>Appeal window open</strong>
        <ul>
          <li v-for="p in refusedCases" :key="p.id" :class="{ urgent: (appealDaysLeft(p) ?? 99) <= 7 }">
            <span class="mono">{{ p.dev_register_no || p.id.slice(0, 12) }}</span>
            · Stand {{ p.stand_number }} ·
            <strong>{{ Math.max(0, appealDaysLeft(p) ?? 0) }} day(s) left to appeal</strong>
          </li>
        </ul>
      </div>
    </div>

    <!-- Lodge form -->
    <section v-if="newAppealOpen" class="ap-form cp-card">
      <div class="cp-card-head"><h2>Lodge new appeal</h2></div>
      <div class="ap-form-body">
        <label class="ap-field"><span>Refused case *</span>
          <select v-model="newAppeal.permit_application_id">
            <option value="">— select —</option>
            <option v-for="p in refusedCases" :key="p.id" :value="p.id">
              {{ p.dev_register_no || p.id.slice(0, 12) }} · Stand {{ p.stand_number }}
            </option>
          </select>
        </label>
        <label class="ap-field"><span>Grounds of appeal *</span>
          <textarea v-model="newAppeal.grounds" rows="4" maxlength="4000"
            placeholder="State why the refusal should be set aside — point-by-point response to each refusal reason (at least 40 characters)."></textarea>
        </label>
        <p class="ap-field-note">
          The Administrative Court sets the hearing date. Council will record it here
          once it is known.
        </p>
        <div class="ap-form-actions">
          <button class="ap-btn ghost" @click="newAppealOpen = false" :disabled="submitting">Cancel</button>
          <button class="ap-btn primary" @click="fileAppeal" :disabled="submitting">
            {{ submitting ? 'Filing…' : 'File appeal' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Empty -->
    <div v-if="!featured" class="cp-card ap-empty">
      <Gavel :size="26" />
      <h3>No appeals on file</h3>
      <p>If an application is refused, you have one month from being notified of the decision to lodge an appeal. Use “Lodge appeal” above to begin.</p>
    </div>

    <template v-else>
      <!-- Featured appeal -->
      <section class="cp-card ap-feature">
        <div class="ap-feature-head">
          <div class="ap-feature-id">
            <span class="ap-gavel"><Gavel :size="18" /></span>
            <div>
              <h3>{{ appealTitle(featured) }}</h3>
              <p class="mono">{{ appealRef(featured) }}</p>
            </div>
          </div>
          <div class="ap-feature-status">
            <span class="pill" :class="STATUS_META[featured.status].cls">{{ STATUS_META[featured.status].label }}</span>
            <span v-if="featured.hearing_date" class="ap-feature-sched">Scheduled for {{ fmtDate(featured.hearing_date) }}</span>
          </div>
        </div>

        <div class="ap-feature-grid">
          <!-- Summary -->
          <div class="ap-col ap-summary">
            <div class="ap-fld"><label>Subject property</label>
              <p>{{ findCase(featured.permit_application_id)
                ? `Stand ${findCase(featured.permit_application_id)!.stand_number}, ${findCase(featured.permit_application_id)!.suburb_ward}`
                : '—' }}</p>
            </div>
            <div class="ap-fld"><label>Appeal type</label><p>Planning decision reversal</p></div>
            <div class="ap-fld"><label>Basis for appeal</label><p class="muted">{{ featured.grounds || '—' }}</p></div>
            <div v-if="featured.decision" class="ap-fld"><label>Outcome</label><p>{{ DECISION_LABEL[featured.decision] }}</p></div>
            <div class="ap-summary-actions">
              <p class="ap-status-note">Status is updated by the council as your appeal is reviewed.</p>
              <button type="button" class="ap-btn ghost icon" title="Download appeal record (PDF)"
                      aria-label="Download appeal record (PDF)" @click="downloadAppeal(featured)">
                <Printer :size="16" />
              </button>
            </div>
          </div>

          <!-- Progress timeline -->
          <div class="ap-col ap-progress">
            <label class="ap-col-label">Appeal progress</label>
            <ol class="ap-timeline">
              <li v-for="(s, i) in progressSteps(featured)" :key="i" :class="s.state">
                <span class="ap-node">
                  <Check v-if="s.state === 'done'" :size="15" />
                  <CalendarCheck v-else-if="s.state === 'current'" :size="15" />
                  <Hourglass v-else :size="13" />
                </span>
                <div class="ap-step">
                  <h4>{{ s.label }}</h4>
                  <p>{{ s.date }}</p>
                  <p v-if="s.detail" class="ap-step-detail">{{ s.detail }}</p>
                </div>
              </li>
            </ol>
          </div>

          <!-- Documents -->
          <div class="ap-col ap-docs">
            <label class="ap-col-label">Supporting evidence</label>
            <div v-if="!evidenceFor(featured).length" class="ap-doc-empty">
              <FileText :size="20" />
              <span>Evidence you upload goes onto the refused application’s case file, where the council prepares the appeal record.</span>
            </div>
            <ul v-else class="ap-evidence">
              <li v-for="f in evidenceFor(featured)" :key="f"><FileText :size="14" /> {{ f }}</li>
            </ul>
            <div class="ap-upload">
              <p>Need to add more evidence?</p>
              <button type="button" class="ap-btn outline full" :disabled="uploading" @click="evidenceInput?.click()">
                <Upload :size="14" /> {{ uploading ? 'Uploading…' : 'Upload evidence' }}
              </button>
              <input ref="evidenceInput" type="file" class="sr-only" tabindex="-1" aria-hidden="true"
                     accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                     @change="uploadEvidence(featured, $event)" />
            </div>
          </div>
        </div>
      </section>

      <!-- Other appeals -->
      <section v-if="others.length" class="ap-others">
        <div class="ap-others-head">
          <h3>Other appeals</h3>
          <div class="ap-search">
            <Search :size="15" />
            <input v-model="search" type="text" placeholder="Search appeals…" />
          </div>
        </div>

        <!-- Desktop table -->
        <div class="cp-card ap-table-wrap">
          <table class="ap-table">
            <thead>
              <tr><th>Reference</th><th>Description</th><th>Status</th><th>Last update</th><th class="right">Actions</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in filteredOthers" :key="a.id">
                <td class="mono strong">{{ appealRef(a) }}</td>
                <td>
                  <p class="ap-td-title">{{ appealTitle(a) }}</p>
                  <p class="ap-td-sub">{{ a.grounds }}</p>
                </td>
                <td><span class="pill" :class="STATUS_META[a.status].cls">{{ STATUS_META[a.status].label }}</span></td>
                <td class="muted">{{ fmtDate(a.decided_at || a.lodged_at) }}</td>
                <td class="right"><button class="ap-link" @click="selectedId = a.id">View details</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile cards -->
        <div class="ap-cards">
          <div v-for="a in filteredOthers" :key="a.id" class="cp-card ap-mcard">
            <div class="between">
              <div class="ap-mcard-ref">
                <span class="ap-col-label">Reference number</span>
                <span class="mono">{{ appealRef(a) }}</span>
              </div>
              <span class="pill" :class="STATUS_META[a.status].cls">{{ STATUS_META[a.status].label }}</span>
            </div>
            <h3 class="ap-mcard-title">{{ appealTitle(a) }}</h3>
            <p class="ap-mcard-desc" :class="{ clamp: !expanded.has(a.id) }">{{ a.grounds }}</p>
            <button class="ap-expand" @click="selectedId = a.id">
              View details <ChevronDown :size="16" />
            </button>
          </div>
        </div>
      </section>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.ap { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:1200px; margin:0 auto; width:100%; }

.ap-header { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap; }
.ap-header h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.ap-header p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); max-width:48rem; }

.mono { font-family:var(--cp-mono); }
.muted { color:var(--cp-muted); }

/* Buttons */
.ap-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem;
  padding:0.5rem 0.9rem; border:1px solid transparent; border-radius:var(--cp-radius-sm);
  font-size:0.82rem; font-weight:600; cursor:pointer; }
.ap-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.ap-btn.primary:hover { background:var(--cp-primary-hover); }
.ap-btn.ghost { background:transparent; border-color:var(--cp-border); color:var(--cp-text-2); }
.ap-btn.ghost:hover { background:var(--cp-surface-2); }
.ap-btn.outline { background:transparent; border-color:var(--cp-primary); color:var(--cp-primary); }
.ap-btn.outline:hover { background:var(--cp-primary); color:var(--cp-on-primary); }
.ap-btn.full { flex:1; }
.ap-btn.icon { width:38px; padding:0; flex-shrink:0; }

/* Pills */
.pill { display:inline-flex; align-items:center; gap:0.25rem; padding:0.2rem 0.6rem;
  border-radius:var(--cp-radius-pill); font-size:0.66rem; font-weight:700; letter-spacing:0.02em; text-transform:uppercase; white-space:nowrap; }
.pill-blue  { background:var(--cp-blue-bg);  color:var(--cp-blue-fg); }
.pill-green { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.pill-amber { background:var(--cp-amber-bg); color:var(--cp-amber-fg); }
.pill-gray  { background:var(--cp-surface-2); color:var(--cp-muted); border:1px solid var(--cp-border); }

/* Cards */
.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; padding:0.85rem 1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head h2 { margin:0; font-size:0.95rem; font-weight:600; color:var(--cp-text); }

/* Appeal window banner */
.ap-window { display:flex; gap:0.7rem; padding:0.85rem 1rem; border-radius:var(--cp-radius);
  background:var(--cp-amber-bg); border:1px solid #fde68a; color:var(--cp-amber-fg); }
.ap-window :deep(svg) { flex-shrink:0; }
.ap-window-body strong { display:block; font-size:0.82rem; }
.ap-window-body ul { list-style:none; margin:0.25rem 0 0; padding:0; font-size:0.78rem; display:flex; flex-direction:column; gap:0.15rem; }
.ap-window-body li.urgent strong { color:var(--cp-red-fg); }

/* Lodge form */
.ap-form-body { padding:1rem; display:flex; flex-direction:column; gap:0.75rem; }
.ap-field-note { margin:0; font-size:0.78rem; color:var(--ent-text-3, #7b8797); line-height:1.5; }
.ap-field { display:flex; flex-direction:column; gap:0.3rem; }
.ap-field > span { font-size:0.74rem; font-weight:600; color:var(--cp-text-2); }
.ap-field select, .ap-field input, .ap-field textarea {
  padding:0.55rem 0.7rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  font-size:0.85rem; color:var(--cp-text); font-family:inherit; background:var(--cp-surface); resize:vertical; }
.ap-field select:focus, .ap-field input:focus, .ap-field textarea:focus { outline:2px solid var(--cp-primary); outline-offset:-2px; border-color:var(--cp-primary); }
.ap-form-actions { display:flex; justify-content:flex-end; gap:0.5rem; }

/* Empty */
.ap-empty { text-align:center; padding:3rem 1.5rem; display:flex; flex-direction:column; align-items:center; gap:0.5rem; }
.ap-empty :deep(svg) { color:var(--cp-faint); }
.ap-empty h3 { margin:0; font-size:1rem; color:var(--cp-text); }
.ap-empty p { margin:0; max-width:32rem; font-size:0.84rem; color:var(--cp-text-2); }

/* Featured appeal */
.ap-feature-head { display:flex; align-items:center; justify-content:space-between; gap:1rem;
  padding:1rem 1.25rem; background:var(--cp-surface-2); border-bottom:1px solid var(--cp-border); }
.ap-feature-id { display:flex; align-items:center; gap:0.75rem; min-width:0; }
.ap-gavel { display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; flex-shrink:0;
  border-radius:var(--cp-radius-sm); background:var(--cp-primary); color:#fff; }
.ap-feature-id h3 { margin:0; font-size:1rem; font-weight:600; color:var(--cp-text); }
.ap-feature-id p { margin:0.1rem 0 0; font-size:0.72rem; color:var(--cp-muted); letter-spacing:0.04em; }
.ap-feature-status { display:flex; flex-direction:column; align-items:flex-end; gap:0.25rem; flex-shrink:0; }
.ap-feature-sched { font-size:0.7rem; color:var(--cp-muted); }

.ap-feature-grid { display:flex; flex-direction:column; }
.ap-col { padding:1.25rem; }
.ap-col + .ap-col { border-top:1px solid var(--cp-border); }
.ap-col-label { display:block; font-size:0.66rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); margin-bottom:1rem; }

.ap-summary { display:flex; flex-direction:column; gap:1rem; }
.ap-fld label { display:block; font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); margin-bottom:0.2rem; }
.ap-fld p { margin:0; font-size:0.85rem; color:var(--cp-text); line-height:1.45; }
.ap-summary-actions { display:flex; align-items:center; gap:0.5rem; margin-top:auto; padding-top:0.5rem; }
.ap-status-note { flex:1; margin:0; font-size:0.72rem; color:#64748b; }

/* Timeline */
.ap-progress { background:var(--cp-surface); }
.ap-timeline { list-style:none; margin:0; padding:0; position:relative; display:flex; flex-direction:column; gap:1.4rem; }
.ap-timeline::before { content:''; position:absolute; left:15px; top:6px; bottom:18px; width:2px; background:var(--cp-border); }
.ap-timeline li { position:relative; display:flex; gap:0.85rem; }
.ap-node { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center;
  width:32px; height:32px; border-radius:50%; flex-shrink:0;
  background:var(--cp-surface-2); color:var(--cp-faint); border:1px solid var(--cp-border); }
.ap-timeline li.done .ap-node { background:var(--cp-primary); color:#fff; border-color:var(--cp-primary); }
.ap-timeline li.current .ap-node { background:var(--cp-primary-tint); color:var(--cp-primary); border:3px solid #fff; box-shadow:0 0 0 1px var(--cp-primary); }
.ap-timeline li.pending { opacity:0.6; }
.ap-step h4 { margin:0; font-size:0.85rem; font-weight:700; color:var(--cp-text); }
.ap-timeline li.current .ap-step h4 { color:var(--cp-primary); }
.ap-step p { margin:0.1rem 0 0; font-size:0.76rem; color:var(--cp-muted); }
.ap-step-detail { color:var(--cp-primary) !important; font-weight:600; }

/* Documents */
.ap-evidence { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.35rem; }
.ap-evidence li { display:flex; align-items:center; gap:0.4rem; font-size:0.8rem; color:var(--cp-text);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ap-docs { display:flex; flex-direction:column; }
.ap-doc-empty { display:flex; flex-direction:column; align-items:center; gap:0.5rem; text-align:center;
  padding:1.5rem 1rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  color:var(--cp-muted); font-size:0.78rem; }
.ap-doc-empty :deep(svg) { color:var(--cp-faint); }
.ap-upload { margin-top:1rem; padding:1rem; border:1px dashed var(--cp-border-strong); border-radius:var(--cp-radius-sm); text-align:center; }
.ap-upload p { margin:0 0 0.6rem; font-size:0.78rem; color:var(--cp-muted); }

/* Other appeals */
.ap-others { display:flex; flex-direction:column; gap:0.75rem; }
.ap-others-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
.ap-others-head h3 { margin:0; font-size:1rem; font-weight:600; color:var(--cp-text); }
.ap-search { display:flex; align-items:center; gap:0.4rem; padding:0.4rem 0.7rem;
  border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); }
.ap-search :deep(svg) { color:var(--cp-faint); }
.ap-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.ap-search input { border:0; outline:none; background:transparent; font-size:0.8rem; color:var(--cp-text); width:11rem; }

/* Table (desktop) */
.ap-table-wrap { display:none; }
.ap-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
.ap-table th, .ap-table td { padding:0.75rem 1rem; text-align:left; border-bottom:1px solid var(--cp-border); vertical-align:middle; }
.ap-table th { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--cp-muted); background:var(--cp-surface-2); }
.ap-table tbody tr:last-child td { border-bottom:0; }
.ap-table tbody tr:hover { background:var(--cp-surface-2); }
.ap-table .right { text-align:right; }
.ap-table .strong { font-weight:700; color:var(--cp-text); }
.ap-td-title { margin:0; font-weight:600; color:var(--cp-text); }
.ap-td-sub { margin:0.1rem 0 0; font-size:0.72rem; color:var(--cp-muted); }
.ap-link { border:0; background:none; color:var(--cp-primary); font-size:0.74rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; cursor:pointer; }
.ap-link:hover { text-decoration:underline; }

/* Cards (mobile) */
.ap-cards { display:flex; flex-direction:column; gap:0.75rem; }
.ap-mcard { padding:1rem; }
.between { display:flex; align-items:flex-start; justify-content:space-between; gap:0.5rem; }
.ap-mcard-ref { display:flex; flex-direction:column; }
.ap-mcard-title { margin:0.65rem 0 0.25rem; font-size:0.95rem; font-weight:600; color:var(--cp-text); }
.ap-mcard-desc { margin:0; font-size:0.8rem; color:var(--cp-text-2); line-height:1.5; }
.ap-mcard-desc.clamp { display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
.ap-expand { margin-top:0.7rem; display:inline-flex; align-items:center; gap:0.25rem; border:0; background:none; padding:0;
  color:var(--cp-primary); font-size:0.8rem; font-weight:600; cursor:pointer; }

/* ── Desktop ──────────────────────────────────────────────────────── */
@media (min-width: 1024px) {
  .ap { padding:1.5rem; }
  .ap-feature-grid { display:grid; grid-template-columns:repeat(3, 1fr); }
  .ap-col + .ap-col { border-top:0; border-left:1px solid var(--cp-border); }
  .ap-table-wrap { display:block; }
  .ap-cards { display:none; }
}
</style>
