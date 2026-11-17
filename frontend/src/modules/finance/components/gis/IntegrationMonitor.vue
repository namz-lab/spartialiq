<script setup lang="ts">
/**
 * Planning -> Finance synchronisation monitoring: the discovery runs, the events and their outcomes,
 * the exceptions waiting for a person (an allocation that names no allottee, a stand allocated to
 * someone other than its account holder), and the allocations the next run will pick up.
 * "Run discovery" and "Retry" need finance.property.sync; the server decides, this only asks.
 */
import { computed, onMounted, ref } from 'vue'
import { PlugZap, RefreshCw, CircleCheck, CircleAlert, Copy, Clock, Loader2, Play, RotateCcw } from 'lucide-vue-next'
import { formatDate } from '../../composables/useMoney'
import { messageOf } from '../../stores/finance'
import { propertyApi, type IntegrationState, type IntegrationEvent } from '../../api/propertyApi'

const emit = defineEmits<{ changed: [] }>()
const state = ref<IntegrationState | null>(null)
const loading = ref(false)
const running = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const filter = ref<IntegrationEvent['status'] | ''>('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try { state.value = await propertyApi.integration(filter.value || undefined) } catch (e) { error.value = messageOf(e, 'The integration state could not be read.') } finally { loading.value = false }
}
async function run(): Promise<void> {
  running.value = true
  notice.value = null
  error.value = null
  try {
    const { run: r } = await propertyApi.runIntegration()
    notice.value = `Discovery finished: ${r.discovered} new Planning event${r.discovered === 1 ? '' : 's'}, ${r.processed} account${r.processed === 1 ? '' : 's'} opened, ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} refused, ${r.failed} needing attention.`
    await load()
    emit('changed')
  } catch (e) { error.value = messageOf(e, 'The integration run failed.') } finally { running.value = false }
}
async function retry(e: IntegrationEvent): Promise<void> {
  try {
    const r = await propertyApi.retryEvent(e.id)
    notice.value = r.status === 'failed' ? `Still failing: ${r.error}` : `Retried: ${r.outcome}`
    await load()
    emit('changed')
  } catch (err) { error.value = messageOf(err, 'The event could not be retried.') }
}
const count = (s: string) => (state.value?.counts ?? []).filter((c) => c.status === s).reduce((n, c) => n + c.n, 0)
const lastRun = computed(() => state.value?.runs[0] ?? null)
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
onMounted(load)
defineExpose({ load })
</script>

<template>
  <div class="im">
    <div class="im-head">
      <div>
        <h3><PlugZap :size="18" aria-hidden="true" /> Planning integration</h3>
        <p>Finance reads the Planning Module's allocations and opens one customer and one account for each. It never changes a Planning record.</p>
      </div>
      <div class="im-actions">
        <button type="button" class="im-btn" :disabled="loading" @click="load"><RefreshCw :size="15" aria-hidden="true" /> Refresh</button>
        <button v-if="state?.can_sync" type="button" class="im-btn im-btn--primary" :disabled="running" @click="run">
          <Loader2 v-if="running" :size="15" class="spin" aria-hidden="true" /><Play v-else :size="15" aria-hidden="true" /> Run discovery now</button>
      </div>
    </div>
    <p v-if="notice" class="im-msg im-msg--ok" role="status"><CircleCheck :size="16" aria-hidden="true" /> {{ notice }}</p>
    <p v-if="error" class="im-msg im-msg--neg" role="alert"><CircleAlert :size="16" aria-hidden="true" /> {{ error }}</p>

    <div class="im-tiles">
      <div class="im-tile"><span>Last run</span><strong>{{ when(lastRun?.started_at ?? null) }}</strong><small>{{ lastRun ? `${lastRun.run_by_name ?? 'system'} · ${lastRun.discovered} discovered` : 'Never run' }}</small></div>
      <div class="im-tile im-tile--ok"><span>Processed</span><strong>{{ count('processed') }}</strong><small>accounts opened or updated</small></div>
      <div class="im-tile im-tile--neg"><span>Exceptions</span><strong>{{ count('failed') }}</strong><small>need a person</small></div>
      <div class="im-tile"><span>Duplicates refused</span><strong>{{ count('duplicate') }}</strong><small>no second account opened</small></div>
      <div class="im-tile im-tile--warn"><span>Awaiting discovery</span><strong>{{ state?.awaiting_discovery.length ?? 0 }}</strong><small>allocated, no account yet</small></div>
    </div>

    <section v-if="state?.awaiting_discovery.length" class="im-card">
      <h4><Clock :size="15" aria-hidden="true" /> Allocated in Planning, not yet in Finance</h4>
      <table class="im-table"><thead><tr><th>Stand</th><th>Allocation</th><th>Allottee</th><th>Allocated</th></tr></thead>
        <tbody><tr v-for="a in state.awaiting_discovery" :key="a.parcel_id"><td>{{ a.township_code }} {{ a.stand_no }}</td><td>{{ a.allocation_reference ?? 'No allocation record' }}</td><td>{{ a.allottee_name ?? '—' }}</td><td>{{ formatDate(a.allocated_at?.slice(0, 10)) }}</td></tr></tbody></table>
    </section>

    <section v-if="state?.account_without_allocation.length" class="im-card">
      <h4><Copy :size="15" aria-hidden="true" /> Account open, Planning allocation not active</h4>
      <table class="im-table"><thead><tr><th>Stand</th><th>Account</th><th>Holder</th><th>Balance</th></tr></thead>
        <tbody><tr v-for="a in state.account_without_allocation" :key="a.parcel_id"><td>{{ a.township_code }} {{ a.stand_no }}</td><td>{{ a.account_no }}</td><td>{{ a.party_name }}</td><td>USD {{ a.usd_balance }}</td></tr></tbody></table>
    </section>

    <section class="im-card">
      <div class="im-card-head">
        <h4>Integration events</h4>
        <label>Status <select v-model="filter" @change="load"><option value="">All</option><option value="failed">Exceptions</option><option value="processed">Processed</option><option value="duplicate">Duplicates</option><option value="pending">Pending</option></select></label>
      </div>
      <div class="im-scroll">
        <table class="im-table">
          <thead><tr><th>Detected</th><th>Event</th><th>Stand</th><th>Status</th><th>Outcome</th><th /></tr></thead>
          <tbody>
            <tr v-for="e in state?.events ?? []" :key="e.id">
              <td>{{ when(e.detected_at) }}</td><td>{{ e.event_type }}</td><td>{{ e.township_code }} {{ e.stand_no }}</td>
              <td><span class="im-pill" :data-s="e.status">{{ e.status === 'failed' ? 'Exception' : e.status }}</span><small v-if="e.attempts > 1"> ×{{ e.attempts }}</small></td>
              <td class="im-out">{{ e.status === 'failed' ? e.last_error : e.outcome }}</td>
              <td><button v-if="e.status === 'failed' && state?.can_sync" type="button" class="im-btn im-btn--small" @click="retry(e)"><RotateCcw :size="13" aria-hidden="true" /> Retry</button></td>
            </tr>
            <tr v-if="!state?.events.length"><td colspan="6" class="im-empty">No integration event yet. Run discovery to read the Planning Module's allocations.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.im { display: grid; gap: 14px; }
.im-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.im-head h3 { margin: 0; font-size: 17px; display: flex; gap: 8px; align-items: center; }
.im-head p { margin: 4px 0 0; color: var(--cw-ink-2); font-size: 13px; max-width: 720px; }
.im-actions { display: flex; gap: 8px; }
.im-btn { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--cw-line-2, #808b99); background: #fff; border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.im-btn:disabled { opacity: 0.6; cursor: default; }
.im-btn--primary { background: var(--cw-accent, #1f5aa8); border-color: var(--cw-accent); color: #fff; }
.im-btn--small { padding: 3px 8px; font-size: 12px; }
.im-msg { margin: 0; display: flex; gap: 8px; align-items: center; padding: 9px 12px; border-radius: 8px; font-size: 13px; }
.im-msg--ok { background: var(--cw-pos-soft); color: var(--cw-pos); }
.im-msg--neg { background: var(--cw-neg-soft); color: var(--cw-neg); }
.im-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.im-tile { background: #fff; border: 1px solid var(--cw-card-line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; }
.im-tile span { font-size: 12px; font-weight: 600; color: var(--cw-ink-2); }
.im-tile strong { font-size: 20px; }
.im-tile small { font-size: 11.5px; color: var(--cw-ink-3); }
.im-tile--ok strong { color: var(--cw-pos); } .im-tile--neg strong { color: var(--cw-neg); } .im-tile--warn strong { color: #d81b9a; }
.im-card { background: #fff; border: 1px solid var(--cw-card-line); border-radius: 10px; padding: 12px 14px; }
.im-card h4 { margin: 0 0 8px; font-size: 14px; display: flex; gap: 6px; align-items: center; }
.im-card-head { display: flex; justify-content: space-between; align-items: center; }
.im-card-head label { font-size: 13px; display: flex; gap: 6px; align-items: center; }
.im-scroll { max-height: 480px; overflow: auto; }
.im-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.im-table th { background: var(--cw-thead); text-align: left; padding: 7px 9px; font-weight: 600; color: var(--cw-ink-2); position: sticky; top: 0; }
.im-table td { padding: 7px 9px; border-bottom: 1px solid var(--cw-line); vertical-align: top; }
.im-out { max-width: 520px; color: var(--cw-ink-2); }
.im-pill { font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 99px; background: var(--cw-info-soft); color: var(--cw-info); text-transform: capitalize; }
.im-pill[data-s='processed'] { background: var(--cw-pos-soft); color: var(--cw-pos); }
.im-pill[data-s='failed'] { background: var(--cw-neg-soft); color: var(--cw-neg); }
.im-pill[data-s='duplicate'] { background: var(--cw-warn-soft); color: var(--cw-warn); }
.im-empty { color: var(--cw-ink-3); text-align: center; padding: 18px; }
.spin { animation: im-spin 1s linear infinite; }
@keyframes im-spin { to { transform: rotate(360deg); } }
@media (max-width: 1100px) { .im-tiles { grid-template-columns: repeat(2, 1fr); } }
</style>
