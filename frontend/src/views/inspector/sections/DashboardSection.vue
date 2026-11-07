<script setup lang="ts">
// Building Inspector work centre — "What do I need to inspect today?"
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiFeedback from '@/components/UiFeedback.vue'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useInspectorQueue } from '@/composables/useInspectorQueue'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useInspectorWorkload } from '@/composables/useInspectorWorkload'
import type { InspectorQueueRow, InspectorQueueBucket } from '@/services/developmentManagementService'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { useAuthStore } from '@/stores/auth'
import { mergeQuery } from '@/inspector/consoleRoute'
import {
  CalendarDays, ClipboardCheck, ShieldAlert, BadgeCheck, Send,
  RefreshCw, AlertTriangle, Clock, MapPin, WifiOff,
} from 'lucide-vue-next'

const emit = defineEmits<{
  'open-section': [key: 'preconstruction'|'stages'|'referrals'|'enforcement'|'certificates'|'reports'|'reference'|'bookings'|'casefile']
  'open-row': [row: InspectorQueueRow]
}>()

const fb = useUiFeedback()
const { refreshWorkload } = useInspectorWorkload()
const ic = useInspectionCase()
const router = useRouter()
const route = useRoute()
const {
  rows, total, summary, loading, error, stale, query,
  pageStart, pageEnd, hasMore, hasPrev,
  refresh, setQuery, setBucket, nextPage, prevPage,
} = useInspectorQueue()

const search = ref('')
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

/** Debounced server-side search — the register is no longer a client-side filter. */
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void setQuery({ search: search.value || undefined }) }, 300)
}

/** A KPI tile opens the exact server query it counted. Clicking it again clears it. */
async function openBucket(bucket: InspectorQueueBucket) {
  await setBucket(query.value.bucket === bucket ? undefined : bucket)
  if (error.value) fb.showToast(error.value, 'error')
}

function onOnline() { online.value = true }
function onOffline() { online.value = false }

onMounted(() => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})

// The queue is the section an inspector leaves open between site visits, and
// it is judged against the clock (overdue, scheduled today). Kept alive, it
// would otherwise still be showing the 07:00 queue at noon. useStaleRefresh
// owns the first load as well as the re-reads.
const { refreshNow } = useStaleRefresh(async () => {
  await refresh()
  void refreshWorkload()
  if (error.value) fb.showToast(error.value, 'error')
})
onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})

// The rows shown are exactly the server's page — no client-side re-filtering, or
// the count on a KPI tile would stop matching the list beneath it.
const registerRows = computed(() => rows.value)

const columns = [
  { key: 'reference',      label: 'Reference',   mono: true, sortable: true },
  { key: 'stand_number',   label: 'Stand',       sortable: true },
  { key: 'suburb_ward',    label: 'Ward' },
  { key: 'applicant_name', label: 'Applicant' },
  { key: 'stage_number',   label: 'Stage' },
  { key: 'effective_scheduled_at', label: 'Scheduled', sortable: true },
  { key: 'permit_status',  label: 'Permit status', sortable: true },
  { key: 'result',         label: 'Last result' },
  { key: 'nextAction',     label: 'Next action' },
]

function referenceOf(row: InspectorQueueRow): string {
  return row.dev_register_no || row.tpd_reference || row.permit_app_id.slice(0, 8).toUpperCase()
}

function nextActionOf(row: InspectorQueueRow): string {
  if (row.has_occupation_certificate) return 'View certificate'
  if (row.result === 'fail' || row.result === 'reinspection_required') return 'Schedule follow-up'
  if (!row.stage_inspection_id) return 'Open stage inspection'
  if (row.inspected_at) return 'View result'
  if (row.is_overdue) return 'Overdue — attend site'
  return 'Continue inspection'
}

async function openRow(row: InspectorQueueRow) {
  // permit_app_id is non-null for every queue row — the view is built from the
  // permit table — so the case always has a real identity to load.
  try { await ic.loadPermit(row.permit_app_id) }
  catch (err: unknown) { fb.showToast(fb.parseApiError(err, 'Could not open permit'), 'error') }

  const section = row.has_occupation_certificate ? 'certificates' : 'stages'
  // Give the opened inspection a stable, shareable URL. Only a real
  // stage_inspection id goes in the path — we never invent one. Path, section
  // and query move in ONE navigation, so the console's own URL sync cannot race
  // it and drop the inspection id, and mergeQuery clears a ?permit= the path
  // now supersedes. It is pushed, so Back returns to the queue.
  if (row.stage_inspection_id && route.params.inspectionId !== row.stage_inspection_id) {
    await router.push({
      name: 'inspector-workspace',
      params: { inspectionId: row.stage_inspection_id },
      query: mergeQuery(route.query, { section, pane: 'console', permitId: null },
        { inspectionId: row.stage_inspection_id }),
    }).catch(() => undefined)
  }

  emit('open-section', section)
  emit('open-row', row)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const auth = useAuthStore()
const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const greeting = computed(() => {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const first = (auth.userName || '').trim().split(/\s+/)[0]
  return first ? `${part}, ${first}` : part
})

function statusLabel(s: string) {
  return s.replace(/_/g, ' ')
}
</script>

<template>
  <div class="ids">
    <header class="ids-head">
      <div class="ids-title">
        <span class="ins-eyebrow">{{ todayLabel }}</span>
        <h2 class="ins-title">{{ greeting }}</h2>
      </div>
      <p class="ids-summary">
        <template v-if="summary">
          {{ summary.today }} due today
          · {{ summary.overdue }} overdue
          · {{ summary.followup }} awaiting follow-up
          · {{ summary.unscheduled }} not yet scheduled
        </template>
        <template v-else-if="loading">Loading the inspection queue…</template>
        <template v-else>Queue counts unavailable.</template>
      </p>
      <button class="ids-refresh" type="button" :disabled="loading" @click="refreshNow">
        <RefreshCw :size="12" :class="{ spin: loading }" />
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <!-- A failed load is never presented as an empty queue. -->
    <div v-if="error" class="ids-error" role="alert">
      <AlertTriangle :size="14" />
      <div>
        <strong>The inspection queue could not be loaded.</strong>
        <span>{{ error }}</span>
        <span v-if="stale" class="ids-staleflag">
          The list below is the last data received and may be out of date.
        </span>
        <span v-else>No queue data is being shown.</span>
      </div>
      <button type="button" class="ids-retry" :disabled="loading" @click="refreshNow">
        <RefreshCw :size="12" :class="{ spin: loading }" /> Retry
      </button>
    </div>

    <p v-if="!online" class="ids-offline" role="status">
      <WifiOff :size="13" /> Offline — showing the last loaded queue. Field drafts stay on this device until you reconnect.
    </p>
    <p v-else-if="ic.syncPending.value" class="ids-offline" role="status">
      <AlertTriangle :size="13" /> Last permit load did not reach the server. Local drafts are still on this workstation.
    </p>

    <div class="ids-kpis" aria-label="Inspection workload">
      <button
        type="button" class="ids-kpi"
        :class="{ active: query.bucket === 'today' }"
        :aria-pressed="query.bucket === 'today'"
        @click="openBucket('today')">
        <CalendarDays :size="14" />
        <strong>{{ summary ? summary.today : '—' }}</strong>
        <span>Due today</span>
      </button>
      <button
        type="button" class="ids-kpi warn"
        :class="{ active: query.bucket === 'overdue' }"
        :aria-pressed="query.bucket === 'overdue'"
        @click="openBucket('overdue')">
        <Clock :size="14" />
        <strong>{{ summary ? summary.overdue : '—' }}</strong>
        <span>Overdue</span>
      </button>
      <button
        type="button" class="ids-kpi danger"
        :class="{ active: query.bucket === 'failed' }"
        :aria-pressed="query.bucket === 'failed'"
        @click="openBucket('failed')">
        <ShieldAlert :size="14" />
        <strong>{{ summary ? summary.failed : '—' }}</strong>
        <span>Failed</span>
      </button>
      <button
        type="button" class="ids-kpi"
        :class="{ active: query.bucket === 'followup' }"
        :aria-pressed="query.bucket === 'followup'"
        @click="openBucket('followup')">
        <Send :size="14" />
        <strong>{{ summary ? summary.followup : '—' }}</strong>
        <span>Follow-ups</span>
      </button>
      <button
        type="button" class="ids-kpi"
        :class="{ active: query.bucket === 'completed' }"
        :aria-pressed="query.bucket === 'completed'"
        @click="openBucket('completed')">
        <BadgeCheck :size="14" />
        <strong>{{ summary ? summary.completed : '—' }}</strong>
        <span>Completed</span>
      </button>
    </div>

    <section class="ids-register" aria-labelledby="ids-reg-title">
      <header>
        <h3 id="ids-reg-title"><ClipboardCheck :size="13" /> Inspection register</h3>
        <label class="ids-search">
          <span class="ent-sr-only">Search inspections</span>
          <input v-model="search" type="search"
                 placeholder="Search reference, stand, ward, applicant…"
                 @input="onSearch" />
        </label>
        <label class="ids-filter">
          <span class="ent-sr-only">Stage</span>
          <select :value="query.stage ?? ''"
                  @change="setQuery({ stage: ($event.target as HTMLSelectElement).value
                    ? Number(($event.target as HTMLSelectElement).value) : undefined })">
            <option value="">All stages</option>
            <option v-for="n in 9" :key="n" :value="n">Stage {{ n }}</option>
          </select>
        </label>
      </header>

      <UiDataTable
        :columns="columns"
        :rows="registerRows"
        row-key="permit_app_id"
        :loading="loading"
        :empty-message="error
          ? 'The queue could not be loaded — this is not an empty work list.'
          : 'No inspections match this filter.'"
        clickable
        dense
        mobile-primary="stand_number"
        mobile-secondary="applicant_name"
        mobile-status="permit_status"
        :mobile-meta="['suburb_ward','stage_number','nextAction']"
        @row-click="openRow"
      >
        <template #cell-reference="{ row }">{{ referenceOf(row) }}</template>
        <template #cell-stage_number="{ row }">
          {{ row.stage_number ? `Stage ${row.stage_number}` : '—' }}
        </template>
        <template #cell-effective_scheduled_at="{ row }">
          <span :class="{ 'ids-overdue': row.is_overdue }">
            {{ fmtDate(row.effective_scheduled_at) }}
            <span v-if="row.is_overdue" class="ent-sr-only">(overdue)</span>
          </span>
        </template>
        <template #cell-permit_status="{ row }">{{ statusLabel(row.permit_status) }}</template>
        <template #cell-result="{ row }">{{ row.result ? statusLabel(row.result) : '—' }}</template>
        <template #cell-nextAction="{ row }">{{ nextActionOf(row) }}</template>
      </UiDataTable>

      <nav class="ids-pager" aria-label="Inspection register pages">
        <p class="ids-count">
          <template v-if="total">Showing {{ pageStart }}–{{ pageEnd }} of {{ total }}</template>
          <template v-else-if="!loading && !error">No matching inspections</template>
        </p>
        <div class="ids-pagebtns">
          <button type="button" :disabled="!hasPrev || loading" @click="prevPage">Previous</button>
          <button type="button" :disabled="!hasMore || loading" @click="nextPage">Next</button>
        </div>
      </nav>
    </section>

    <section class="ids-quick" aria-label="Common actions">
      <button type="button" class="ids-qbtn" @click="emit('open-section','bookings')">
        <CalendarDays :size="16" aria-hidden="true" />
        <div><strong>Bookings</strong><span>Owner requests awaiting a date</span></div>
      </button>
      <button type="button" class="ids-qbtn" @click="emit('open-section','stages')">
        <MapPin :size="16" aria-hidden="true" />
        <div><strong>Stage inspection</strong><span>Checklist, evidence, result</span></div>
      </button>
      <button type="button" class="ids-qbtn" @click="emit('open-section','preconstruction')">
        <ClipboardCheck :size="16" aria-hidden="true" />
        <div><strong>Pre-construction</strong><span>Plan, permit, pegs, building lines</span></div>
      </button>
      <button type="button" class="ids-qbtn" @click="emit('open-section','enforcement')">
        <ShieldAlert :size="16" aria-hidden="true" />
        <div><strong>Enforcement</strong><span>Compliance visits and escalation</span></div>
      </button>
      <button type="button" class="ids-qbtn" @click="emit('open-section','referrals')">
        <Send :size="16" aria-hidden="true" />
        <div><strong>Tasks and referrals</strong><span>Inbound circulation, field referrals</span></div>
      </button>
    </section>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ids { padding:var(--ent-s5) var(--ent-s6) var(--ent-s7); display:flex; flex-direction:column; gap:var(--ent-s4); }
.ids-head { display:flex; align-items:flex-end; gap:var(--ent-s3) var(--ent-s5); flex-wrap:wrap; }
.ids-title { min-width:0; }
.ids-summary { margin:0 0 3px; flex:1; min-width:14rem; font-size:var(--ent-fs-sm); color:var(--ent-text-2); font-variant-numeric:tabular-nums; }
.ids-refresh {
  display:inline-flex; align-items:center; gap:var(--ent-s2); min-height:var(--ent-control-h-sm);
  padding:0 var(--ent-s3); border:1px solid var(--ent-line); border-radius:var(--ent-r);
  background:var(--ent-surface); color:var(--ent-text-2); cursor:pointer; font-family:var(--ent-font); font-size:var(--ent-fs-sm);
  transition:background-color var(--ent-dur) var(--ent-ease);
}
.ids-refresh:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.ids-refresh:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.spin { animation: idspin 0.8s linear infinite; }
@keyframes idspin { to { transform: rotate(360deg); } }

.ids-offline {
  margin:0; display:flex; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s3) var(--ent-s4); background:var(--ent-warning-soft);
  border:1px solid var(--ent-tone-warning-line); border-radius:var(--ent-r-md);
  font-size:var(--ent-fs-sm); color:var(--ent-text);
}
.ids-offline svg { color:var(--ent-warning); flex-shrink:0; }

.ids-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(9.5rem, 1fr)); gap:var(--ent-s3); }
.ids-kpi {
  position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:var(--ent-s1);
  padding:var(--ent-s3) var(--ent-s4); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); cursor:pointer; color:var(--ent-text); text-align:left;
  font-family:var(--ent-font);
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease), transform var(--ent-dur) var(--ent-ease);
}
.ids-kpi:hover { border-color:var(--ent-line-strong); }
.ids-kpi:active { transform:scale(0.98); }
.ids-kpi:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.ids-kpi svg { color:var(--ent-text-3); }
.ids-kpi strong { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold); line-height:1; letter-spacing:-0.01em; font-variant-numeric:tabular-nums; }
.ids-kpi span { font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.ids-kpi.warn svg { color:var(--ent-warning); }
.ids-kpi.danger svg { color:var(--ent-danger); }
.ids-kpi.danger strong { color:var(--ent-danger); }
/* The selected tile and the register beneath it are the same server query. */
.ids-kpi.active { border-color:var(--ent-accent); background:var(--ent-accent-soft); box-shadow:inset 0 0 0 1px var(--ent-accent); }
.ids-kpi.active svg { color:var(--ent-accent); }

.ids-error {
  display:flex; align-items:flex-start; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4);
  border:1px solid var(--ent-tone-negative-line); border-radius:var(--ent-r-md);
  background:var(--ent-danger-soft); color:var(--ent-text); font-size:var(--ent-fs-sm);
}
.ids-error > svg { color:var(--ent-danger); flex-shrink:0; margin-top:2px; }
.ids-error > div { display:flex; flex-direction:column; gap:2px; flex:1; }
.ids-error strong { font-weight:var(--ent-fw-semibold); }
.ids-error span { color:var(--ent-text-2); }
.ids-staleflag { color:var(--ent-warning); font-weight:var(--ent-fw-medium); }
.ids-retry {
  display:inline-flex; align-items:center; gap:var(--ent-s2); align-self:center;
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r);
  background:var(--ent-surface); cursor:pointer; font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text);
}
.ids-retry:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.ids-overdue { color:var(--ent-danger); font-weight:var(--ent-fw-semibold); }

.ids-pager {
  display:flex; align-items:center; justify-content:space-between;
  gap:var(--ent-s3); padding:var(--ent-s3) var(--ent-s4); flex-wrap:wrap; border-top:1px solid var(--ent-line);
}
.ids-count { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); font-variant-numeric:tabular-nums; }
.ids-pagebtns { display:flex; gap:var(--ent-s2); }
.ids-pagebtns button {
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r);
  background:var(--ent-surface); cursor:pointer; font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text);
}
.ids-pagebtns button:disabled { opacity:.5; cursor:not-allowed; }
.ids-pagebtns button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.ids-register { background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); overflow:hidden; }
.ids-register > header {
  display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap;
  padding:var(--ent-s3) var(--ent-s4); border-bottom:1px solid var(--ent-line);
}
.ids-register h3 { margin:0; flex:1; font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); display:flex; align-items:center; gap:var(--ent-s2); }
.ids-search input, .ids-filter select {
  min-height:var(--ent-control-h); padding:0 var(--ent-s3); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r);
  font-size:var(--ent-fs-base); font-family:var(--ent-font); color:var(--ent-text); background:var(--ent-surface);
}
.ids-search input { width:min(20rem, 100%); }
.ids-search input:focus, .ids-filter select:focus { outline:none; border-color:var(--ent-accent); box-shadow:var(--ent-focus-ring); }

.ids-quick { display:grid; grid-template-columns:repeat(auto-fit, minmax(13rem, 1fr)); gap:var(--ent-s3); }
.ids-qbtn {
  display:flex; align-items:center; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); text-align:left; cursor:pointer; color:var(--ent-text); font-family:var(--ent-font);
  transition:border-color var(--ent-dur) var(--ent-ease), background-color var(--ent-dur) var(--ent-ease);
}
.ids-qbtn:hover { border-color:var(--ent-accent-line); background:var(--ent-accent-soft); }
.ids-qbtn > svg { flex-shrink:0; color:var(--ent-accent); }
.ids-qbtn strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); }
.ids-qbtn span { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.ids-qbtn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

@media (max-width: 767px) {
  .ids { padding:var(--ent-s4) var(--ent-s3) var(--ent-s7); }
  .ids-search, .ids-search input { width:100%; }
}
@media (prefers-reduced-motion: reduce) {
  .spin { animation:none; }
  .ids-kpi, .ids-qbtn, .ids-refresh { transition:none; }
  .ids-kpi:active { transform:none; }
}
</style>
