<script setup lang="ts">
/**
 * The finance audit trail, searched the way an auditor works: by person, date, module, record,
 * severity and outcome (`GET /finance/audit`). Every filter lives in the address, so a search can
 * be bookmarked, put in working papers or opened from another page (`?entity_type=…&entity_id=…`).
 *
 * The server filters by person, module, record, severity, outcome and dates. It does not filter by
 * action (the request method), so the action choice narrows the page on screen and says so.
 * The export (`GET /finance/audit/export`) honours the date range only; the screen says that too.
 * Records cannot be edited through the application: there is no write endpoint.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ShieldCheck, AlertTriangle, Download, ChevronLeft, ChevronRight, Info, Search } from 'lucide-vue-next'
import { auditApi, saveBlob, TRAIL_ACTIONS, TRAIL_MODULES, type TrailEvent, type TrailQuery } from '../../../api/auditApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'

const PAGE = 100
const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const canExport = computed(() => store.can('finance.audit.export'))

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const q = (k: string) => (typeof route.query[k] === 'string' ? String(route.query[k]) : '')

/** The form, edited freely; Search writes it to the address, which is what is read. */
const form = ref(fromAddress())
function fromAddress() {
  return {
    actor: q('actor'), module: q('module'), entity_type: q('entity_type'), entity_id: q('entity_id'),
    severity: q('severity'), outcome: q('outcome'), action: q('action'),
    from: route.query.from === undefined ? daysAgo(30) : q('from'), to: q('to'),
  }
}
const page = computed(() => Math.max(0, Number(q('page') || 0)))

const events = ref<TrailEvent[]>([])
const note = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const exportError = ref<string | null>(null)
const open = ref<string | null>(null)
/** Everyone seen in this visit's searches, so a person can be chosen by name rather than by id. */
const people = ref(new Map<string, { email: string; role: string | null }>())

async function load(): Promise<void> {
  const f = fromAddress()
  form.value = f
  loading.value = true
  error.value = null
  const params: TrailQuery = {
    actor_id: f.actor || undefined, event: f.module || undefined,
    entity_type: f.entity_type || undefined, entity_id: f.entity_id || undefined,
    severity: (f.severity || undefined) as TrailQuery['severity'],
    status_min: f.outcome === 'refused' ? 400 : undefined,
    from: f.from || undefined, to: f.to || undefined, limit: PAGE, offset: page.value * PAGE,
  }
  try {
    const r = await auditApi.trail(params)
    events.value = r.events
    note.value = r.note
    for (const e of r.events) if (e.actor_id && !people.value.has(e.actor_id)) people.value.set(e.actor_id, { email: e.actor_email ?? e.actor_id, role: e.actor_role })
  } catch (err) {
    error.value = messageOf(err, 'The audit trail could not be read.')
    events.value = []
  } finally { loading.value = false }
}
watch(() => route.fullPath, load, { immediate: true })

function search(): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(form.value)) if (v) query[k] = v
  if (!form.value.from) query.from = ''
  void router.replace({ query })
}
function clear(): void { void router.replace({ query: { from: daysAgo(30) } }) }
function go(p: number): void { void router.replace({ query: { ...route.query, page: p ? String(p) : undefined } }) }

const shown = computed(() => (form.value.action ? events.value.filter((e) => e.method === form.value.action) : events.value))
const moduleName = (id: string) => TRAIL_MODULES.find((m) => m.id === id)?.label ?? id
const outcome = (s: number | null) => (s === null ? { text: '—', tone: 'cw-pill--mute' } : s >= 500 ? { text: `Failed (${s})`, tone: 'cw-pill--warn' } : s >= 400 ? { text: `Refused (${s})`, tone: 'cw-pill--neg' } : { text: 'Done', tone: 'cw-pill--pos' })
const sevTone = (s: string) => (s === 'critical' ? 'cw-pill--neg' : s === 'high' ? 'cw-pill--warn' : s === 'medium' ? 'cw-pill--info' : 'cw-pill--mute')

async function download(format: 'csv' | 'xlsx' | 'pdf'): Promise<void> {
  exportError.value = null
  try {
    const f = await auditApi.exportTrail({ from: form.value.from || undefined, to: form.value.to || undefined, format })
    saveBlob(f.blob, f.filename)
  } catch (err) { exportError.value = messageOf(err, 'The audit export could not be produced.') }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ShieldCheck :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Audit Trail</h2>
      <p>Every finance action, who took it and when, including refused attempts. Records cannot be edited through the application.</p>
    </div>
  </section>

  <form class="cw-card cw-card-body at-filters" role="search" aria-label="Search the audit trail" @submit.prevent="search">
    <label class="cw-field"><span class="cw-label">Person</span>
      <select v-model="form.actor" class="cw-input">
        <option value="">Anyone</option>
        <option v-for="[id, p] in people" :key="id" :value="id">{{ p.email }}{{ p.role ? ` (${p.role})` : '' }}</option>
      </select></label>
    <label class="cw-field"><span class="cw-label">Module</span>
      <select v-model="form.module" class="cw-input">
        <option value="">All finance modules</option>
        <option v-for="m in TRAIL_MODULES" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select></label>
    <label class="cw-field"><span class="cw-label">Action</span>
      <select v-model="form.action" class="cw-input">
        <option value="">Any action</option>
        <option v-for="(l, m) in TRAIL_ACTIONS" :key="m" :value="m">{{ l }}</option>
      </select></label>
    <label class="cw-field"><span class="cw-label">Outcome</span>
      <select v-model="form.outcome" class="cw-input">
        <option value="">Done or refused</option><option value="refused">Refused or failed only</option>
      </select></label>
    <label class="cw-field"><span class="cw-label">Severity</span>
      <select v-model="form.severity" class="cw-input">
        <option value="">Any</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select></label>
    <label class="cw-field"><span class="cw-label">From</span><input v-model="form.from" type="date" class="cw-input" /></label>
    <label class="cw-field"><span class="cw-label">To</span><input v-model="form.to" type="date" class="cw-input" /></label>
    <label class="cw-field"><span class="cw-label">Record type</span><input v-model.trim="form.entity_type" class="cw-input" maxlength="48" placeholder="e.g. finance_voucher" /></label>
    <label class="cw-field"><span class="cw-label">Record id</span><input v-model.trim="form.entity_id" class="cw-input" maxlength="64" /></label>
    <div class="at-acts">
      <button type="submit" class="cw-btn cw-btn--primary" :disabled="loading"><Search :size="17" aria-hidden="true" /> Search</button>
      <button type="button" class="cw-btn" @click="clear">Clear</button>
    </div>
    <p class="cw-hint at-full">A person can be chosen once they appear in a search. The action choice narrows the page shown; the server filters everything else.</p>
  </form>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

  <section class="cw-card" aria-labelledby="at-res">
    <div class="cw-card-head">
      <h3 id="at-res">Results <span class="cw-hint">· page {{ page + 1 }}{{ shown.length ? `, ${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}` : '' }}</span></h3>
      <span class="cw-spacer" />
      <template v-if="canExport">
        <button type="button" class="cw-btn cw-btn--small" @click="download('csv')"><Download :size="15" aria-hidden="true" /> CSV</button>
        <button type="button" class="cw-btn cw-btn--small" @click="download('xlsx')"><Download :size="15" aria-hidden="true" /> Excel</button>
        <button type="button" class="cw-btn cw-btn--small" @click="download('pdf')"><Download :size="15" aria-hidden="true" /> PDF</button>
      </template>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="canExport" class="dx-note"><Info :size="15" aria-hidden="true" /> The export covers the date range ({{ form.from || 'the beginning' }} to {{ form.to || 'today' }}) and every finance event in it; the other filters are not applied to the file.</p>
      <p v-if="exportError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ exportError }}</p>
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!shown.length && !error" class="cw-empty">No finance event matches this search.</p>
      <table v-else-if="shown.length" class="cw-table dx-compact">
        <caption class="sr-only">Audit trail entries, newest first</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Person</th><th scope="col">Module</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Severity</th><th scope="col">Outcome</th><th scope="col"><span class="sr-only">Detail</span></th></tr></thead>
        <tbody>
          <template v-for="e in shown" :key="e.id">
            <tr>
              <td class="at-when">{{ formatDateTime(e.occurred_at) }}</td>
              <td class="dx-wrap">{{ e.actor_email ?? '—' }}<div v-if="e.actor_role" class="cw-hint">{{ e.actor_role }}</div></td>
              <td>{{ moduleName(e.event) }}</td>
              <td>{{ TRAIL_ACTIONS[e.method ?? ''] ?? e.method ?? '—' }}</td>
              <td class="dx-wrap">{{ e.entity_type ?? '—' }}<div v-if="e.entity_id" class="cw-hint at-mono">{{ e.entity_id }}</div></td>
              <td><span class="cw-pill" :class="sevTone(e.severity)">{{ e.severity }}</span></td>
              <td><span class="cw-pill" :class="outcome(e.status).tone">{{ outcome(e.status).text }}</span></td>
              <td><button type="button" class="cw-btn cw-btn--small" :aria-expanded="open === e.id" :aria-controls="`at-d-${e.id}`" @click="open = open === e.id ? null : e.id">{{ open === e.id ? 'Hide' : 'Detail' }}</button></td>
            </tr>
            <tr v-if="open === e.id" :id="`at-d-${e.id}`" class="at-detail">
              <td colspan="8">
                <dl>
                  <dt>Request</dt><dd class="at-mono">{{ e.method }} {{ e.path }}</dd>
                  <dt>From address</dt><dd class="at-mono">{{ e.ip ?? '—' }}</dd>
                  <dt>Entry id</dt><dd class="at-mono">{{ e.id }}</dd>
                  <template v-if="e.details"><dt>Recorded detail</dt><dd><pre>{{ JSON.stringify(e.details, null, 2) }}</pre></dd></template>
                </dl>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <nav class="at-pager" aria-label="Pages of results">
        <button type="button" class="cw-btn cw-btn--small" :disabled="!page || loading" @click="go(page - 1)"><ChevronLeft :size="15" aria-hidden="true" /> Newer</button>
        <button type="button" class="cw-btn cw-btn--small" :disabled="events.length < PAGE || loading" @click="go(page + 1)">Older <ChevronRight :size="15" aria-hidden="true" /></button>
      </nav>
      <p v-if="note" class="dx-note">{{ note }}</p>
    </div>
  </section>
</template>

<style scoped>
.at-filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px 16px; padding-top: 16px; align-items: end; }
.at-acts { display: flex; gap: 8px; }
.at-full { grid-column: 1 / -1; margin: 0; }
.at-when { white-space: nowrap; }
.at-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; word-break: break-all; }
.at-detail td { background: #f6f8fb; }
.at-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 0; }
.at-detail dt { font-weight: 600; }
.at-detail dd { margin: 0; }
.at-detail pre { margin: 0; white-space: pre-wrap; font-size: 12.5px; }
.at-pager { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
