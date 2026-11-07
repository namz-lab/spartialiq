<script setup lang="ts">
// Stage inspections across every approved permit, read from the inspector work
// queue (v_inspector_queue: one row per permit with its latest stage). This
// replaced a first-20-permits sample fetched one permit at a time, which left
// every other approved permit off the planner's view.
import { caseRef } from '@/composables/useApplicationPipeline'
import { computed, onMounted, ref } from 'vue'
import { dmApi, type InspectorQueueRow } from '@/services/developmentManagementService'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { ArrowRight, RefreshCw, Search } from 'lucide-vue-next'

const APPROVED = ['approved', 'approved_with_conditions'] as const
const PAGE = 500 // the queue route's own maximum

type Bucket = 'overdue' | 'today' | 'upcoming' | 'unscheduled' | 'followup' | 'completed' | 'all'
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'unscheduled', label: 'Not scheduled' },
  { key: 'followup', label: 'Re-inspection' },
  { key: 'completed', label: 'Inspected' },
  { key: 'all', label: 'All' },
]

const shell = usePlannerShell()
const fb = useUiFeedback()
const rows = ref<InspectorQueueRow[]>([])
const loading = ref(false)
const loaded = ref(false)
const bucket = ref<Bucket>('overdue')
const search = ref('')

async function fetchStatus(status: string): Promise<InspectorQueueRow[]> {
  const first = await dmApi.inspectorWorkQueue({ status, limit: PAGE, offset: 0 })
  const rest: Promise<{ data: InspectorQueueRow[] }>[] = []
  for (let offset = PAGE; offset < first.total; offset += PAGE) {
    rest.push(dmApi.inspectorWorkQueue({ status, limit: PAGE, offset }))
  }
  return [first, ...await Promise.all(rest)].flatMap(p => p.data)
}

async function refresh() {
  loading.value = true
  try {
    rows.value = (await Promise.all(APPROVED.map(fetchStatus))).flat()
    loaded.value = true
    // Land on the first bucket that has something in it.
    if (!counts.value[bucket.value]) bucket.value = BUCKETS.find(b => counts.value[b.key])?.key ?? 'all'
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load inspections'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const today = () => new Date().toISOString().slice(0, 10)
function bucketOf(r: InspectorQueueRow): Exclude<Bucket, 'all'> {
  if (r.result === 'reinspection_required' || r.result === 'fail') return 'followup'
  if (r.inspected_at) return 'completed'
  const d = r.effective_scheduled_at?.slice(0, 10)
  if (!d) return 'unscheduled'
  if (r.is_overdue || d < today()) return 'overdue'
  return d === today() ? 'today' : 'upcoming'
}

const counts = computed(() => {
  const c: Record<Bucket, number> = { overdue: 0, today: 0, upcoming: 0, unscheduled: 0, followup: 0, completed: 0, all: rows.value.length }
  for (const r of rows.value) c[bucketOf(r)]++
  return c
})

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value
    .filter(r => bucket.value === 'all' || bucketOf(r) === bucket.value)
    .filter(r => !q || [r.dev_register_no, r.stand_number, r.applicant_name, r.suburb_ward]
      .some(v => (v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => (a.effective_scheduled_at ?? '9').localeCompare(b.effective_scheduled_at ?? '9'))
})

function open(r: InspectorQueueRow) {
  void shell.openCaseForStand(r.permit_app_id, 'inspections')
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Not scheduled'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function stageLabel(r: InspectorQueueRow) {
  if (!r.stage_number) return 'No stage inspection yet'
  return `Stage ${r.stage_number}${r.attempt && r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}`
}
</script>

<template>
  <div class="ins">
    <header class="ins-head">
      <div>
        <h2>Inspections</h2>
        <p>Stage inspections on every approved permit. Open a row to work the case.</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <div class="ins-bar">
      <div class="ins-tabs" role="tablist" aria-label="Inspection status">
        <button v-for="b in BUCKETS" :key="b.key" type="button" role="tab" class="ins-tab"
                :class="{ active: bucket === b.key, alert: b.key === 'overdue' && counts.overdue }"
                :aria-selected="bucket === b.key" @click="bucket = b.key">
          {{ b.label }} <span class="ins-tab-n">{{ counts[b.key] }}</span>
        </button>
      </div>
      <label class="ins-search">
        <Search :size="14" aria-hidden="true" />
        <span class="ent-sr-only">Filter inspections</span>
        <input v-model="search" type="search" name="ins-search" placeholder="Register no, stand, applicant" />
      </label>
    </div>

    <UiPanel flush>
      <p v-if="loading && !loaded" class="ins-loading" aria-live="polite">Loading inspections…</p>
      <UiEmptyState v-else-if="!rows.length"
                    message="No approved permits yet. Determined cases appear here once the EO issues an approval." />
      <UiEmptyState v-else-if="!visible.length"
                    :message="search ? 'No inspection matches that filter.' : 'Nothing in this list.'" />
      <ul v-else class="ins-list">
        <li v-for="r in visible" :key="r.permit_app_id">
          <button type="button" class="ins-row" :class="'b-' + bucketOf(r)" @click="open(r)">
            <span class="ins-ref">{{ caseRef(r) }}</span>
            <span class="ins-title">
              <strong>{{ stageLabel(r) }}</strong>
              <span>{{ r.applicant_name }} · Stand {{ r.stand_number || '—' }}<template v-if="r.suburb_ward"> · {{ r.suburb_ward }}</template></span>
            </span>
            <span class="ins-meta">
              <UiStatusBadge v-if="r.result" :status="r.result" />
              <span v-else-if="!r.inspector_id && r.stage_number" class="ins-flag">No inspector</span>
            </span>
            <span class="ins-date">{{ r.inspected_at ? 'Inspected ' + fmtDate(r.inspected_at) : fmtDate(r.effective_scheduled_at) }}</span>
            <ArrowRight :size="14" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </UiPanel>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ins { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); }
.ins-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.ins-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.ins-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.ins-head :deep(.ui-btn) { margin-left: auto; }

.ins-bar { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.ins-tabs { display: flex; gap: 2px; flex-wrap: wrap; flex: 1; }
.ins-tab { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: var(--ent-s1); cursor: pointer;
  min-height: 2rem; padding: 0 var(--ent-s3); border-radius: var(--ent-r-pill); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.ins-tab:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.ins-tab:focus-visible { box-shadow: var(--ent-focus-ring); }
.ins-tab.active { background: var(--ent-accent-soft); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.ins-tab-n { font-size: var(--ent-fs-micro); font-variant-numeric: tabular-nums; color: var(--ent-text-3); }
.ins-tab.active .ins-tab-n { color: inherit; }
.ins-tab.alert .ins-tab-n { color: var(--ent-danger); font-weight: var(--ent-fw-bold); }
.ins-search { display: inline-flex; align-items: center; gap: var(--ent-s2); height: var(--ent-control-h); padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface); color: var(--ent-text-3); width: 16rem; }
.ins-search:focus-within { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.ins-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text); }

.ins-loading { margin: 0; padding: var(--ent-s5); color: var(--ent-text-3); font-size: var(--ent-fs-sm); }
.ins-list { list-style: none; margin: 0; padding: 0; }
.ins-row {
  display: grid; grid-template-columns: 8rem minmax(0, 1fr) auto 8rem auto;
  gap: var(--ent-s3); align-items: center; width: 100%;
  min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s4);
  text-align: left; background: transparent; border: 0; border-top: 1px solid var(--ent-line);
  color: var(--ent-text); font: inherit; cursor: pointer;
}
.ins-list li:first-child .ins-row { border-top: none; }
.ins-row:hover { background: var(--ent-surface-2); }
.ins-row:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.ins-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.ins-title { display: flex; flex-direction: column; min-width: 0; font-size: var(--ent-fs-sm); }
.ins-title strong { font-weight: var(--ent-fw-semibold); }
.ins-title span { color: var(--ent-text-3); font-size: var(--ent-fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ins-flag { font-size: var(--ent-fs-micro); color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
.ins-date { font-size: var(--ent-fs-xs); color: var(--ent-text-2); white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
.b-overdue .ins-date { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.ins-row > svg { color: var(--ent-text-3); }

@media (max-width: 767px) {
  .ins { padding: var(--ent-s3); }
  .ins-head { flex-direction: column; align-items: stretch; }
  .ins-head :deep(.ui-btn) { margin-left: 0; }
  .ins-search { width: 100%; }
  .ins-tabs { flex-wrap: nowrap; overflow-x: auto; }
  .ins-tab { white-space: nowrap; }
  .ins-row { grid-template-columns: minmax(0, 1fr) auto; }
  .ins-ref, .ins-meta, .ins-row > svg { display: none; }
  .ins-date { grid-column: 2; }
}
</style>
