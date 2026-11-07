<script setup lang="ts">
// Technical circulation — the departmental referrals under s.26.
//
// The application goes to health, survey, engineering, fire, traffic, housing,
// electricity, water and sewer, and environment. Each referral is a task with
// a priority and a due date, can be marked blocking (its finding must be
// resolved before determination), can be escalated when it runs late, and
// comes back with a stance and, sometimes, an attachment.
//
// It works on the console's open case. The queue below is only the way in when
// nothing is open — the officer who came here from the register already has
// the file, and asking them to pick it again was the old design.

import { computed, reactive, ref, watch } from 'vue'
import {
  eoPlannerService, ALL_TECH_DEPARTMENTS, type CirculationStatus,
} from '@/services/eoPlannerService'
import { dmApi, type Consultation } from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useEoCase } from '@/eo-planner/useEoCase'
import { useEoWorkload } from '@/eo-planner/useEoWorkload'
import { fmtDate, humanise } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import CaseRequired from './CaseRequired.vue'
import {
  Send, RefreshCw, CheckCircle2, AlertTriangle, Clock, Paperclip, Bell, Loader2,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const eoCase = useEoCase()
const workload = useEoWorkload()

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const TASK_STATUSES = ['open', 'in_progress', 'responded', 'accepted', 'returned', 'cancelled'] as const

// Cases at a stage where circulation is the work: in circulation already, or
// under assessment and not yet sent out.
const queue = computed(() => [...workload.circulation.value, ...workload.review.value])

const { refreshNow } = useStaleRefresh(() => workload.refresh())

// ── The open case's circulation ───────────────────────────────────────
const status = ref<CirculationStatus | null>(null)
const loading = ref(false)
const sending = ref<string | null>(null)
const busy = ref<string | null>(null)

async function loadStatus(id: string | null) {
  status.value = null
  if (!id) return
  loading.value = true
  try {
    status.value = await eoPlannerService.circulationFor(id)
    for (const d of status.value.departments) {
      if (!d.consultation && priDraft[d.name] == null) priDraft[d.name] = 'normal'
    }
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not read the circulation status.'), 'error')
  } finally {
    loading.value = false
  }
}
watch(() => eoCase.caseId.value, id => { void loadStatus(id) }, { immediate: true })

// ── Drafts for departments not yet circulated ─────────────────────────
const noteDraft = reactive<Record<string, string>>({})
const priDraft = reactive<Record<string, string>>({})
const dueDraft = reactive<Record<string, string>>({})
const blockDraft = reactive<Record<string, boolean>>({})

async function circulateOne(dept: string) {
  const id = eoCase.caseId.value
  if (!id) return
  sending.value = dept
  try {
    await eoPlannerService.circulate(id, dept, {
      notes: noteDraft[dept] || undefined,
      priority: (priDraft[dept] as Consultation['priority']) || 'normal',
      response_due_at: dueDraft[dept] || undefined,
      blocking: !!blockDraft[dept],
    })
    fb.showToast(`Circulated to ${humanise(dept).toLowerCase()}.`, 'success')
    noteDraft[dept] = ''
    dueDraft[dept] = ''
    blockDraft[dept] = false
    priDraft[dept] = 'normal'
    await loadStatus(id)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not circulate.'), 'error')
  } finally {
    sending.value = null
  }
}

async function updateTask(c: Consultation, patch: Parameters<typeof dmApi.updateConsultationTask>[1]) {
  const id = eoCase.caseId.value
  if (!id) return
  busy.value = c.id
  try {
    await dmApi.updateConsultationTask(c.id, patch)
    fb.showToast(patch.escalate ? 'Referral escalated.' : 'Referral updated.', 'success')
    await loadStatus(id)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The update did not save.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── Reading a referral ────────────────────────────────────────────────
type Dept = CirculationStatus['departments'][number]

function outcomeTone(o: string): string {
  if (o === 'no_objection') return 'positive'
  if (o === 'objection') return 'negative'
  if (o === 'conditional') return 'warning'
  return 'neutral'
}

function isOverdue(d: Dept): boolean {
  const due = d.consultation?.response_due_at
  if (!due || d.outcome !== 'pending') return false
  return new Date(due) < new Date(new Date().toDateString())
}

/** A blocking referral that has not come back is what actually holds a case. */
const blockingOutstanding = computed(() =>
  (status.value?.departments ?? []).filter(d => d.consultation?.blocking && d.outcome === 'pending'))

const overdueCount = computed(() => (status.value?.departments ?? []).filter(isOverdue).length)

function selVal(e: Event): string { return (e.target as HTMLSelectElement | HTMLInputElement).value }
</script>

<template>
  <div class="ins-page tc">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Section 26 consultation</span>
        <h2 class="ins-title"><Send :size="18" aria-hidden="true" /> Technical circulation</h2>
        <p class="ins-lede">
          Referrals to the departments whose findings the determination rests on. A blocking
          referral is one the case cannot be determined without.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading || workload.loading.value"
                title="Reload" @click="eoCase.caseId.value ? loadStatus(eoCase.caseId.value) : refreshNow()">
          <RefreshCw :size="15" aria-hidden="true"
                     :class="{ 'ins-spin': loading || workload.loading.value }" />
          <span class="ent-sr-only">Reload</span>
        </button>
      </div>
    </header>

    <!-- Way in when nothing is open -->
    <template v-if="!eoCase.caseId.value">
      <section class="ins-card">
        <header class="ins-card-head">
          <h3>In assessment or circulation</h3>
          <span class="ins-count">{{ queue.length }}</span>
        </header>
        <p v-if="!queue.length" class="tc-msg">
          No application is at the circulation stage.
        </p>
        <ul v-else class="ins-rows">
          <li v-for="p in queue" :key="p.id">
            <button type="button" class="ins-row tc-row" @click="eoCase.open(p.id)">
              <span class="ins-row-main">
                <span class="ins-row-title">
                  <span class="ins-mono">{{ p.dev_register_no || p.id.slice(0, 8).toUpperCase() }}</span>
                  · {{ p.applicant_name }}
                </span>
                <span class="ins-row-meta">
                  Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template>
                  · {{ statusLabel(p.status) }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </section>
      <CaseRequired what="The departmental referrals for an application" />
    </template>

    <template v-else>
      <p v-if="loading" class="tc-msg">Reading the referrals…</p>

      <template v-else-if="status">
        <p v-if="blockingOutstanding.length" class="ins-banner t-warning">
          <AlertTriangle :size="16" aria-hidden="true" />
          <span>
            <strong>{{ blockingOutstanding.length }} blocking referral(s) outstanding.</strong>
            {{ blockingOutstanding.map(d => humanise(d.name)).join(', ') }} — the case is not
            ready for determination until these are back.
          </span>
        </p>

        <div class="ins-kpis tc-kpis">
          <div class="tc-kpi">
            <span class="tc-kpi-n">{{ status.departments.filter(d => d.consultation).length }}</span>
            <span class="tc-kpi-l">Circulated</span>
          </div>
          <div class="tc-kpi">
            <span class="tc-kpi-n">{{ status.outstandingCount }}</span>
            <span class="tc-kpi-l">Awaiting a reply</span>
          </div>
          <div class="tc-kpi" :class="{ warn: overdueCount > 0 }">
            <span class="tc-kpi-n">{{ overdueCount }}</span>
            <span class="tc-kpi-l">Past their due date</span>
          </div>
          <div class="tc-kpi">
            <span class="tc-kpi-n">
              {{ status.departments.filter(d => d.outcome === 'objection').length }}
            </span>
            <span class="tc-kpi-l">Objections returned</span>
          </div>
        </div>

        <ul class="tc-depts">
          <li v-for="d in status.departments" :key="d.name" class="tc-dept"
              :class="[`t-${outcomeTone(d.outcome)}`, { overdue: isOverdue(d) }]">
            <header class="tc-dept-head">
              <strong>{{ humanise(d.name) }}</strong>
              <span class="tc-outcome" :class="`t-${outcomeTone(d.outcome)}`">
                <component :is="d.outcome === 'no_objection' ? CheckCircle2
                                : d.outcome === 'pending' ? Clock : AlertTriangle"
                           :size="12" aria-hidden="true" />
                {{ humanise(d.outcome) }}
              </span>
              <span class="tc-when">
                {{ d.respondedAt ? `replied ${fmtDate(d.respondedAt)}` : 'no reply yet' }}
              </span>
            </header>

            <!-- Circulated: the task -->
            <div v-if="d.consultation" class="tc-task">
              <div class="ins-form tc-task-form">
                <label class="ins-field">
                  <span class="ins-label">Priority</span>
                  <select class="ins-input" :value="d.consultation.priority || 'normal'"
                          :disabled="busy === d.consultation.id"
                          @change="updateTask(d.consultation!, { priority: selVal($event) as Consultation['priority'] })">
                    <option v-for="p in PRIORITIES" :key="p" :value="p">{{ humanise(p) }}</option>
                  </select>
                </label>
                <label class="ins-field">
                  <span class="ins-label">Task status</span>
                  <select class="ins-input" :value="d.consultation.task_status || 'open'"
                          :disabled="busy === d.consultation.id"
                          @change="updateTask(d.consultation!, { task_status: selVal($event) as Consultation['task_status'] })">
                    <option v-for="s in TASK_STATUSES" :key="s" :value="s">{{ humanise(s) }}</option>
                  </select>
                </label>
                <label class="ins-field">
                  <span class="ins-label">Response due</span>
                  <input type="date" class="ins-input"
                         :value="(d.consultation.response_due_at || '').slice(0, 10)"
                         :disabled="busy === d.consultation.id"
                         @change="updateTask(d.consultation!, { response_due_at: selVal($event) })" />
                </label>
              </div>

              <div class="tc-chips">
                <button type="button" class="tc-chip" :class="{ on: d.consultation.blocking }"
                        :aria-pressed="!!d.consultation.blocking"
                        :disabled="busy === d.consultation.id"
                        @click="updateTask(d.consultation!, { blocking: !d.consultation.blocking })">
                  {{ d.consultation.blocking ? 'Blocking' : 'Non-blocking' }}
                </button>
                <span v-if="isOverdue(d)" class="tc-flag t-negative">
                  <Clock :size="11" aria-hidden="true" /> Overdue
                </span>
                <span v-if="d.consultation.escalated_at" class="tc-flag t-warning">
                  <Bell :size="11" aria-hidden="true" /> Escalated {{ fmtDate(d.consultation.escalated_at) }}
                </span>
                <button v-else-if="d.outcome === 'pending'" type="button" class="tc-btn"
                        :disabled="busy === d.consultation.id"
                        @click="updateTask(d.consultation!, { escalate: true })">
                  <component :is="busy === d.consultation.id ? Loader2 : Bell" :size="13" aria-hidden="true"
                             :class="{ 'ins-spin': busy === d.consultation.id }" />
                  Escalate
                </button>
                <a v-if="d.consultation.response_document_url" class="tc-attach"
                   :href="d.consultation.response_document_url" target="_blank" rel="noopener">
                  <Paperclip :size="12" aria-hidden="true" /> Response attachment
                </a>
              </div>

              <p v-if="d.consultation.response_notes" class="tc-response">
                {{ d.consultation.response_notes }}
              </p>
            </div>

            <!-- Not circulated yet -->
            <div v-else class="tc-send">
              <div class="ins-form tc-task-form">
                <label class="ins-field full">
                  <span class="ins-label">Cover note</span>
                  <input v-model="noteDraft[d.name]" class="ins-input"
                         placeholder="What this department is being asked to consider" />
                </label>
                <label class="ins-field">
                  <span class="ins-label">Priority</span>
                  <select v-model="priDraft[d.name]" class="ins-input">
                    <option v-for="p in PRIORITIES" :key="p" :value="p">{{ humanise(p) }}</option>
                  </select>
                </label>
                <label class="ins-field">
                  <span class="ins-label">Response due</span>
                  <input v-model="dueDraft[d.name]" type="date" class="ins-input" />
                </label>
              </div>
              <div class="tc-send-actions">
                <label class="tc-blocking">
                  <input v-model="blockDraft[d.name]" type="checkbox" />
                  <span>Blocking — the case cannot be determined without this finding</span>
                </label>
                <button type="button" class="tc-btn primary" :disabled="sending === d.name"
                        @click="circulateOne(d.name)">
                  <component :is="sending === d.name ? Loader2 : Send" :size="14" aria-hidden="true"
                             :class="{ 'ins-spin': sending === d.name }" />
                  {{ sending === d.name ? 'Sending…' : 'Circulate' }}
                </button>
              </div>
            </div>
          </li>
        </ul>

        <p class="ins-hint tc-foot">
          {{ ALL_TECH_DEPARTMENTS.length }} departments are on the standing circulation list.
          A department that has nothing to say still answers — a silent referral is an
          outstanding one.
        </p>
      </template>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.tc-row { width:100%; background:none; border:0; text-align:left; cursor:pointer; font-family:var(--ent-font); }
.tc-row:hover { background:var(--ent-surface-2); }
.tc-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.tc-kpis { grid-template-columns:repeat(auto-fit, minmax(9rem, 1fr)); }
.tc-kpi { display:flex; flex-direction:column; gap:2px; padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.tc-kpi.warn { border-color:var(--ent-tone-warning-line); background:var(--ent-tone-warning-bg); }
.tc-kpi-n { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold); line-height:1.1;
  font-variant-numeric:tabular-nums; color:var(--ent-text); }
.tc-kpi-l { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.tc-depts { list-style:none; margin:0; padding:0; display:grid;
  grid-template-columns:repeat(auto-fit, minmax(22rem, 1fr)); gap:var(--ent-s4); }
.tc-dept { background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); padding:var(--ent-s4);
  border-left:3px solid var(--ent-line-strong); }
.tc-dept.t-positive { border-left-color:var(--ent-success); }
.tc-dept.t-negative { border-left-color:var(--ent-danger); }
.tc-dept.t-warning  { border-left-color:var(--ent-warning); }
.tc-dept.overdue { background:var(--ent-tone-warning-bg); }

.tc-dept-head { display:flex; align-items:baseline; gap:var(--ent-s2); flex-wrap:wrap;
  margin-bottom:var(--ent-s3); }
.tc-dept-head strong { font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); }
.tc-outcome { display:inline-flex; align-items:center; gap:4px; padding:1px 8px;
  border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.tc-outcome.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); }
.tc-outcome.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.tc-outcome.t-warning  { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.tc-when { margin-left:auto; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.tc-task, .tc-send { display:flex; flex-direction:column; gap:var(--ent-s3); }
.tc-task-form { gap:var(--ent-s2) var(--ent-s3); }
.tc-chips { display:flex; align-items:center; gap:var(--ent-s2); flex-wrap:wrap; }
.tc-chip { padding:3px var(--ent-s3); border:1px solid var(--ent-line); background:var(--ent-surface);
  border-radius:var(--ent-r-pill); font-family:var(--ent-font); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); cursor:pointer; }
.tc-chip:hover:not(:disabled) { border-color:var(--ent-line-strong); color:var(--ent-text); }
.tc-chip:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.tc-chip.on { background:var(--ent-tone-negative-bg); border-color:var(--ent-tone-negative-line);
  color:var(--ent-tone-negative-fg); }
.tc-flag { display:inline-flex; align-items:center; gap:4px; padding:1px 8px;
  border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); }
.tc-flag.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.tc-flag.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.tc-attach { display:inline-flex; align-items:center; gap:4px; font-size:var(--ent-fs-xs);
  color:var(--ent-accent); }
.tc-response { margin:0; padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r-sm);
  background:var(--ent-surface-2); font-size:var(--ent-fs-sm); color:var(--ent-text-2);
  line-height:var(--ent-lh); }

.tc-send-actions { display:flex; align-items:center; justify-content:space-between;
  gap:var(--ent-s3); flex-wrap:wrap; }
.tc-blocking { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.tc-blocking input { width:16px; height:16px; accent-color:var(--ent-accent); flex-shrink:0; }

.tc-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; }
.tc-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.tc-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.tc-btn:disabled { opacity:0.55; cursor:not-allowed; }
.tc-btn.primary { min-height:var(--ent-control-h); font-size:var(--ent-fs-sm);
  background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.tc-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.tc-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.tc-foot { max-width:60ch; }
</style>
