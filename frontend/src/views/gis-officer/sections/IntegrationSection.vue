<script setup lang="ts">
// ERP integration console (GMS 5.9): health, the outbox event log with
// payload viewer, retry and cancel, and the reconciliation queues. gis_analyst
// reads; gis_head / gis_data / gis_dev operate (the API enforces the same).
import { ref, computed, onMounted, watch } from 'vue'
import { RefreshCw, Play } from 'lucide-vue-next'
import UiKpi from '@/components/ui/UiKpi.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { useAuthStore } from '@/stores/auth'
import {
  gmsApi, GMS_CAN, RECON_LABEL,
  type IntegrationStatus, type OutboxEvent, type EventStatus, type ReconItem, type ReconKind,
  type SurveyProImports, type SurveyProRun, type SurveyProRunDetail, type SurveyProRunStatus,
} from '@/services/gms'

const auth = useAuthStore()
const canOperate = computed(() => !!auth.user && GMS_CAN.integration.includes(auth.user.role))

const tab = ref<'events' | 'reconciliation' | 'surveypro'>('events')
const health = ref<IntegrationStatus | null>(null)
const message = ref('')
const error = ref('')

// ── Events ────────────────────────────────────────────────────────────
const eventStatus = ref<EventStatus | ''>('failed')
const events = ref<OutboxEvent[]>([])
const eventsLoading = ref(false)
const selected = ref<OutboxEvent | null>(null)
const busyId = ref('')

const EVENT_TONE: Record<EventStatus, 'neutral' | 'info' | 'positive' | 'negative'> = {
  pending: 'info', sent: 'info', acknowledged: 'positive', failed: 'negative', cancelled: 'neutral',
}
const eventColumns = [
  { key: 'occurred_at', label: 'When', sortable: true },
  { key: 'type', label: 'Event', sortable: true },
  { key: 'status', label: 'Status' },
  { key: 'attempts', label: 'Tries', align: 'right', mono: true, hideOnMobile: true },
  { key: 'last_error', label: 'Last error', hideOnMobile: true },
]

// ── Reconciliation ────────────────────────────────────────────────────
const reconKind = ref<ReconKind | ''>('')
const recon = ref<ReconItem[]>([])
const reconLoading = ref(false)
const running = ref(false)
const drafts = ref<Record<number, { assign: string; note: string }>>({})
const draft = (id: number) => (drafts.value[id] ??= { assign: '', note: '' })

// ── The SurveyPro importer ────────────────────────────────────────────────────────────────────────────────────────────────────────
const sp = ref<SurveyProImports | null>(null)
const spLoading = ref(false)
const spDetail = ref<SurveyProRunDetail | null>(null)
const spBusy = ref<'' | 'dry' | 'apply'>('')
const SP_TONE: Record<SurveyProRunStatus, 'neutral' | 'info' | 'positive' | 'warning' | 'negative'> = { running: 'info', ok: 'positive', attention: 'warning', failed: 'negative' }
const SP_LABEL: Record<SurveyProRunStatus, string> = { running: 'running', ok: 'ok', attention: 'needs a look', failed: 'failed' }
const spColumns = [
  { key: 'started_at', label: 'When', sortable: true },
  { key: 'trigger', label: 'Started by', hideOnMobile: true },
  { key: 'status', label: 'Result' },
  { key: 'totals', label: 'What it did' },
]
const spSummary = (r: SurveyProRun) => {
  const t = r.totals || {}
  const bits = [t.imported && `${t.imported} imported`, t.statuses && `${t.statuses} job status${t.statuses === 1 ? '' : 'es'}`, t.errors && `${t.errors} refused`, t.diverged && `${t.diverged} diverged`].filter(Boolean)
  const what = bits.length ? bits.join(', ') : 'nothing to do'
  return r.applied ? what : `${what} (dry run)`
}
const SP_READ_ERROR = 'The SurveyPro importer could not be read.'
async function loadSp() {
  spLoading.value = true
  try {
    sp.value = await gmsApi.surveyproImports()
    if (error.value === SP_READ_ERROR) error.value = ''      // read again: the earlier failure is over
  } catch (e) { fail(e, SP_READ_ERROR) } finally { spLoading.value = false }
}
async function openSp(row: SurveyProRun) {
  try { spDetail.value = await gmsApi.surveyproRun(row.id) } catch (e) { fail(e, 'That run could not be opened.') }
}
async function runSp(apply: boolean) {
  spBusy.value = apply ? 'apply' : 'dry'; error.value = ''; message.value = ''
  try {
    const r = await gmsApi.runSurveyproImport(apply)
    message.value = `${apply ? 'Imported' : 'Dry run'}: ${SP_LABEL[r.status]}. ${spSummary({ ...(r as any), totals: r.totals })}.`
    await loadSp()
  } catch (e: any) {
    if (e?.response?.status === 409) error.value = 'The importer is running already; try again in a moment.'
    else fail(e, 'The importer could not be run.')
  } finally { spBusy.value = '' }
}

const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const fail = (e: any, fallback: string) => { error.value = e?.response?.data?.message || e?.response?.data?.error || fallback }

async function loadHealth() {
  try { health.value = await gmsApi.status() } catch { health.value = null }
}
async function loadEvents() {
  eventsLoading.value = true
  try { events.value = await gmsApi.events({ status: eventStatus.value || undefined, limit: 200 }) }
  catch (e) { fail(e, 'The event log could not be loaded.') }
  finally { eventsLoading.value = false }
}
async function openEvent(row: OutboxEvent) {
  try { selected.value = await gmsApi.event(row.event_id) } catch (e) { fail(e, 'The event could not be opened.') }
}
async function retry(ev: OutboxEvent) {
  busyId.value = ev.event_id; error.value = ''; message.value = ''
  try {
    const r = await gmsApi.retry(ev.event_id)
    message.value = r?.status === 'acknowledged'
      ? `${ev.type} acknowledged by the ERP.`
      : `${ev.type} still not delivered: ${r?.error || r?.status}.`
    selected.value = null
    await Promise.all([loadEvents(), loadHealth()])
  } catch (e) { fail(e, 'The retry could not be started.') }
  finally { busyId.value = '' }
}
async function cancel(ev: OutboxEvent) {
  if (!window.confirm(`Cancel this ${ev.type} event? The ERP will never receive it.`)) return
  busyId.value = ev.event_id
  try { await gmsApi.cancel(ev.event_id); selected.value = null; await Promise.all([loadEvents(), loadHealth()]) }
  catch (e) { fail(e, 'The event could not be cancelled.') }
  finally { busyId.value = '' }
}

async function loadRecon() {
  reconLoading.value = true
  try { recon.value = await gmsApi.reconciliation({ kind: reconKind.value || undefined }) }
  catch (e) { fail(e, 'The reconciliation queue could not be loaded.') }
  finally { reconLoading.value = false }
}
async function runRecon() {
  running.value = true; error.value = ''; message.value = ''
  try {
    const r = await gmsApi.runReconciliation()
    const found = Object.values(r.counts).reduce((a, b) => a + b, 0)
    message.value = `Reconciliation ran: ${found} open item${found === 1 ? '' : 's'}, ${r.cleared} cleared since the last run.`
    await Promise.all([loadRecon(), loadHealth()])
  } catch (e) { fail(e, 'Reconciliation could not run.') }
  finally { running.value = false }
}
async function assign(item: ReconItem) {
  const to = draft(item.id).assign.trim()
  if (!to) return
  try { Object.assign(item, await gmsApi.assign(item.id, to)); draft(item.id).assign = '' }
  catch (e) { fail(e, 'The item could not be assigned.') }
}
async function resolve(item: ReconItem) {
  const note = draft(item.id).note.trim()
  if (!note) { error.value = 'A resolution needs a note saying what was done.'; return }
  try { await gmsApi.resolve(item.id, note); recon.value = recon.value.filter((r) => r.id !== item.id); await loadHealth() }
  catch (e) { fail(e, 'The item could not be resolved.') }
}

/** One line a Revenue officer can act on without opening the JSON. */
function describe(r: ReconItem): string {
  const d = r.detail
  switch (r.kind) {
    case 'structure_no_account': return `Stand ${d.stand_no}, ${d.township_code} (${d.parcel_id}): ${d.buildings} structure(s), no ERP account`
    case 'account_no_parcel': return `ERP account ${d.erp_account_no} (${d.status_band}) matches no parcel`
    case 'account_on_retired_parcel': return `ERP account ${d.erp_account_no} is linked to retired parcel ${d.parcel_id}`
    case 'duplicate_stand_no': return `Stand ${d.stand_no} in ${d.township_code} appears on ${d.parcel_ids?.length} parcels: ${d.parcel_ids?.join(', ')}`
    default: return r.ref_key
  }
}

onMounted(() => { loadHealth(); loadEvents() })
watch(eventStatus, loadEvents)
watch(reconKind, loadRecon)
watch(tab, (t) => { if (t === 'reconciliation' && !recon.value.length) loadRecon(); if (t === 'surveypro' && !sp.value) loadSp() })
</script>

<template>
  <div class="int">
    <section class="int-kpis" aria-label="Integration health">
      <UiKpi :value="health ? health.queue_depth : '—'" label="Queued for the ERP" />
      <UiKpi :value="health ? health.failed : '—'" label="Failed events" :tone="health?.failed ? 'negative' : 'neutral'" />
      <UiKpi :value="health ? `${Math.round(health.error_rate_24h * 100)} %` : '—'" label="Error rate, 24 h" />
      <UiKpi :value="health ? when(health.last_acknowledged_at) : '—'" label="Last acknowledged" />
    </section>
    <p v-if="health" class="int-meta">
      Adapter <span class="int-mono">{{ health.adapter }}</span> · last inbound {{ when(health.last_inbound_at) }}
      · last reconciliation {{ when(health.last_reconciliation_at) }}
    </p>

    <p v-if="message" class="int-msg" role="status">{{ message }}</p>
    <p v-if="error" class="int-err" role="alert">{{ error }}</p>

    <div class="int-tabs" role="tablist" aria-label="Integration views">
      <button id="tab-events" type="button" role="tab" :aria-selected="tab === 'events'" :class="{ on: tab === 'events' }"
              aria-controls="panel-events" @click="tab = 'events'">Event log</button>
      <button id="tab-recon" type="button" role="tab" :aria-selected="tab === 'reconciliation'" :class="{ on: tab === 'reconciliation' }"
              aria-controls="panel-recon" @click="tab = 'reconciliation'">
        Reconciliation
        <span v-if="health" class="int-count">{{ Object.values(health.reconciliation_open).reduce((a, b) => a + b, 0) }}</span>
      </button>
      <button id="tab-surveypro" type="button" role="tab" :aria-selected="tab === 'surveypro'" :class="{ on: tab === 'surveypro' }"
              aria-controls="panel-surveypro" @click="tab = 'surveypro'">SurveyPro imports</button>
    </div>

    <!-- ── Event log ── -->
    <div v-show="tab === 'events'" id="panel-events" role="tabpanel" aria-labelledby="tab-events" class="int-split">
      <UiPanel title="Outbox" subtitle="Events the GMS has sent, or is trying to send, to the ERP" flush>
        <template #actions>
          <label class="int-inline">
            <span class="ent-sr-only">Status</span>
            <select v-model="eventStatus">
              <option value="">All statuses</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <UiButton size="sm" variant="ghost" @click="loadEvents(); loadHealth()">
            <template #icon><RefreshCw :size="12" aria-hidden="true" /></template>Refresh
          </UiButton>
        </template>
        <UiDataTable :columns="eventColumns" :rows="events" row-key="event_id" :loading="eventsLoading" clickable dense
                     :empty-message="eventStatus === 'failed' ? 'No failed events. Everything sent has been accepted or is queued.' : 'No events.'"
                     mobile-primary="type" mobile-secondary="occurred_at" mobile-status="status"
                     @row-click="openEvent">
          <template #cell-occurred_at="{ value }">{{ when(value) }}</template>
          <template #cell-status="{ value }"><UiStatusBadge :tone="EVENT_TONE[value as EventStatus]" :label="value" /></template>
          <template #cell-last_error="{ value }"><span class="int-err-cell">{{ value || '' }}</span></template>
        </UiDataTable>
      </UiPanel>

      <UiPanel v-if="selected" :title="selected.type" :subtitle="`v${selected.version} · ${selected.status}`">
        <dl class="int-dl">
          <dt>Event ID</dt><dd class="int-mono">{{ selected.event_id }}</dd>
          <dt>Idempotency key</dt><dd class="int-mono">{{ selected.idempotency_key }}</dd>
          <dt>Occurred</dt><dd>{{ when(selected.occurred_at) }}</dd>
          <dt>Tries</dt><dd>{{ selected.attempts }}<span v-if="selected.status === 'pending'"> · next {{ when(selected.next_attempt_at) }}</span></dd>
          <dt v-if="selected.last_error">Last error</dt><dd v-if="selected.last_error">{{ selected.last_error }}</dd>
        </dl>
        <h3 class="int-h3">Payload</h3>
        <pre class="int-pre">{{ JSON.stringify(selected.payload, null, 2) }}</pre>
        <div v-if="canOperate && (selected.status === 'failed' || selected.status === 'pending')" class="int-actions">
          <UiButton variant="primary" size="sm" :loading="busyId === selected.event_id" @click="retry(selected)">Retry now</UiButton>
          <UiButton variant="danger" size="sm" :disabled="busyId === selected.event_id" @click="cancel(selected)">Cancel event</UiButton>
        </div>
      </UiPanel>
    </div>

    <!-- ── The SurveyPro importer ── -->
    <div v-show="tab === 'surveypro'" id="panel-surveypro" role="tabpanel" aria-labelledby="tab-surveypro" class="int-split">
      <UiPanel title="Council survey work from SurveyPro" subtitle="What the councils have had accepted in SurveyPro, brought into the register" flush>
        <template #actions>
          <UiButton size="sm" variant="ghost" @click="loadSp"><template #icon><RefreshCw :size="12" aria-hidden="true" /></template>Refresh</UiButton>
          <UiButton v-if="canOperate" size="sm" variant="ghost" :loading="spBusy === 'dry'" :disabled="!!spBusy" @click="runSp(false)">Dry run</UiButton>
          <UiButton v-if="canOperate" size="sm" variant="primary" :loading="spBusy === 'apply'" :disabled="!!spBusy" @click="runSp(true)">
            <template #icon><Play :size="12" aria-hidden="true" /></template>Import now
          </UiButton>
        </template>
        <p v-if="sp?.misconfigured" class="int-err" role="alert">{{ sp.misconfigured }}</p>
        <p v-if="sp" class="int-meta" style="padding: 0 var(--ent-s3)">
          <template v-if="sp.scheduled">Runs every {{ sp.interval_minutes }} minute{{ sp.interval_minutes === 1 ? '' : 's' }}{{ sp.applies ? '' : ' (dry runs only)' }}.</template>
          <template v-else>Not scheduled: it runs only when someone runs it (set SURVEYPRO_IMPORT_MINUTES on the server to schedule it).</template>
          Councils: {{ sp.councils.length ? sp.councils.join(', ') : 'none configured' }}.
          Last good run: {{ when(sp.last_ok_at) }}.
        </p>
        <UiDataTable :columns="spColumns" :rows="sp?.runs ?? []" row-key="id" :loading="spLoading" clickable dense
                     empty-message="It has not run yet." mobile-primary="started_at" mobile-status="status" @row-click="openSp">
          <template #cell-started_at="{ value }">{{ when(value) }}</template>
          <template #cell-status="{ value }"><UiStatusBadge :tone="SP_TONE[value as SurveyProRunStatus]" :label="SP_LABEL[value as SurveyProRunStatus]" /></template>
          <template #cell-totals="{ row }">{{ spSummary(row as SurveyProRun) }}</template>
        </UiDataTable>
      </UiPanel>

      <UiPanel v-if="spDetail" :title="`Run ${spDetail.id}`" :subtitle="`${spDetail.trigger} · ${spDetail.applied ? 'applied' : 'dry run'} · ${SP_LABEL[spDetail.status]}`">
        <p v-if="spDetail.error" class="int-err">{{ spDetail.error }}</p>
        <p v-if="!spDetail.report.length && !spDetail.error" class="int-note">Nothing was recorded.</p>
        <div v-for="c in spDetail.report" :key="c.council" class="int-recon">
          <h3 class="int-h3">{{ c.council }}</h3>
          <p v-if="c.failed" class="int-err">Could not be read: {{ c.failed }}</p>
          <p v-else-if="!c.projects?.length" class="int-note">Nothing needed doing.</p>
          <ul v-else class="int-recon">
            <li v-for="p in c.projects" :key="p.project" class="int-item">
              <strong>{{ p.name }}</strong> <span class="int-meta">(project {{ p.project }})</span>
              <div v-if="p.failed" class="int-err">{{ p.failed }}</div>
              <div v-if="p.status?.to">Job {{ p.status.from }} → {{ p.status.to }}</div>
              <div v-if="p.status?.error">Job: {{ p.status.error }}</div>
              <div v-for="x in p.imported ?? []" :key="x.parcel_id">+ stand {{ x.stand }} → {{ x.parcel_id }}</div>
              <div v-for="x in p.diverged ?? []" :key="'d' + x.parcel_id" class="int-err">! stand {{ x.stand }} ({{ x.parcel_id }}): the boundary in SurveyPro differs from the register's</div>
              <div v-for="(x, n) in p.errors ?? []" :key="'e' + n" class="int-err">refused: {{ x.code }}{{ x.stand ? ` (stand ${x.stand})` : '' }}</div>
              <div v-for="(x, n) in p.warnings ?? []" :key="'w' + n" class="int-meta">note: {{ x.code }}{{ x.stand ? ` (stand ${x.stand})` : '' }}</div>
            </li>
          </ul>
        </div>
      </UiPanel>
    </div>

    <!-- ── Reconciliation ── -->
    <div v-show="tab === 'reconciliation'" id="panel-recon" role="tabpanel" aria-labelledby="tab-recon">
      <UiPanel title="Open items" subtitle="Where the register and the ERP disagree. Fix at source, then resolve with a note.">
        <template #actions>
          <label class="int-inline">
            <span class="ent-sr-only">Queue</span>
            <select v-model="reconKind">
              <option value="">All queues</option>
              <option v-for="(label, k) in RECON_LABEL" :key="k" :value="k">{{ label }}</option>
            </select>
          </label>
          <UiButton v-if="canOperate" size="sm" :loading="running" @click="runRecon">
            <template #icon><Play :size="12" aria-hidden="true" /></template>Run now
          </UiButton>
        </template>

        <p v-if="reconLoading" class="int-note" role="status">Loading…</p>
        <p v-else-if="!recon.length" class="int-note">No open items{{ reconKind ? ' in this queue' : '' }}. The nightly run adds anything new.</p>
        <ul v-else class="int-recon">
          <li v-for="r in recon" :key="r.id" class="int-item">
            <div class="int-item-head">
              <UiStatusBadge tone="warning" :label="RECON_LABEL[r.kind]" />
              <span class="int-item-text">{{ describe(r) }}</span>
              <span v-if="r.assigned_to" class="int-assigned">Assigned: {{ r.assigned_to }}</span>
            </div>
            <div v-if="canOperate" class="int-item-actions">
              <label class="int-inline">
                <span class="ent-sr-only">Assign item {{ r.id }} to</span>
                <input v-model="draft(r.id).assign" type="text" placeholder="Assign to, e.g. Revenue" @keydown.enter.prevent="assign(r)" />
              </label>
              <UiButton size="sm" variant="ghost" :disabled="!draft(r.id).assign.trim()" @click="assign(r)">Assign</UiButton>
              <label class="int-inline int-grow">
                <span class="ent-sr-only">Resolution note for item {{ r.id }}</span>
                <input v-model="draft(r.id).note" type="text" placeholder="What was done" @keydown.enter.prevent="resolve(r)" />
              </label>
              <UiButton size="sm" :disabled="!draft(r.id).note.trim()" @click="resolve(r)">Resolve</UiButton>
            </div>
          </li>
        </ul>
      </UiPanel>
    </div>
  </div>
</template>

<style scoped>
.int { display:flex; flex-direction:column; gap:var(--ent-s4); padding:var(--ent-s4); max-width:1400px; }
.int-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:var(--ent-s3); }
.int-meta { margin:calc(var(--ent-s2) * -1) 0 0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.int-mono { font-family:var(--ent-font-mono); }
.int-msg, .int-err { margin:0; padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r-sm); font-size:var(--ent-fs-sm); }
.int-msg { background:var(--ent-info-soft); color:var(--ent-text); }
.int-err { background:var(--ent-danger-soft); color:var(--ent-danger); }
.int-tabs { display:flex; gap:var(--ent-s1); border-bottom:1px solid var(--ent-line); }
.int-tabs button { display:inline-flex; align-items:center; gap:var(--ent-s2); padding:var(--ent-s2) var(--ent-s3);
  background:none; border:0; border-bottom:2px solid transparent; margin-bottom:-1px; cursor:pointer;
  font:inherit; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text-2); }
.int-tabs button.on { color:var(--ent-accent); border-bottom-color:var(--ent-accent); }
.int-tabs button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.int-count { font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); padding:0 var(--ent-s2);
  border-radius:var(--ent-r-pill); background:var(--ent-surface-2); color:var(--ent-text-2); }
.int-split { display:grid; grid-template-columns:minmax(0, 3fr) minmax(300px, 2fr); gap:var(--ent-s4); align-items:start; }
.int-inline { display:inline-flex; }
.int-inline select, .int-inline input { height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font:inherit;
  font-size:var(--ent-fs-sm); color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); min-width:0; }
.int-grow { flex:1 1 200px; }
.int-grow input { width:100%; }
.int-err-cell { color:var(--ent-text-3); font-size:var(--ent-fs-xs); }
.int-dl { display:grid; grid-template-columns:max-content 1fr; gap:var(--ent-s1) var(--ent-s3); margin:0; font-size:var(--ent-fs-sm); }
.int-dl dt { color:var(--ent-text-3); }
.int-dl dd { margin:0; overflow-wrap:anywhere; }
.int-h3 { margin:var(--ent-s3) 0 var(--ent-s1); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); }
.int-pre { margin:0; max-height:260px; overflow:auto; padding:var(--ent-s2); background:var(--ent-surface-sunken);
  border-radius:var(--ent-r-sm); font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); }
.int-actions { display:flex; gap:var(--ent-s2); margin-top:var(--ent-s3); }
.int-note { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.int-recon { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.int-item { display:flex; flex-direction:column; gap:var(--ent-s2); padding:var(--ent-s3) 0; border-bottom:1px solid var(--ent-line); }
.int-item-head { display:flex; flex-wrap:wrap; align-items:center; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.int-item-text { flex:1 1 280px; min-width:0; }
.int-assigned { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.int-item-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s2); align-items:center; }
@media (max-width: 1023px) { .int-split { grid-template-columns:1fr; } }
</style>
