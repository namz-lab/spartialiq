<script setup lang="ts">
/**
 * The finance audit trail.
 *
 * REFUSED ATTEMPTS ARE THE POINT. The hook that writes this trail records any mutating request
 * that is not a 404, so an attempt to publish a dataset without the permission appears here with
 * its 403 — which is what makes the specification's third critical test scenario (§13.1) something
 * an auditor can verify rather than something a developer asserts.
 *
 * THE RECORDS CANNOT BE EDITED THROUGH THE APPLICATION. There is no write endpoint for this table
 * and the application's own database role cannot modify it; it is written by the system plane. The
 * screen says so, and the export repeats it.
 */
import { computed, onMounted, ref } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatDateTime } from '../../composables/useMoney'
import type { AuditEvent } from '../../models/types'
import { AlertTriangle, RefreshCw, Download, Info, ShieldCheck } from 'lucide-vue-next'

const store = useFinanceStore()

const events = ref<AuditEvent[]>([])
const trailNote = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

/**
 * WHY THE DATE RANGE IS NOT EMPTY ON ARRIVAL.
 *
 * Every filter here used to default to blank, which means "everything ever recorded" — not a review
 * set, and on a council with a year of history not a page anyone reads to the end. The role preset
 * supplies a window: thirty days for an auditor, seven for the technical administrator, whose
 * interest in the trail is which grants changed and which requests were refused. The control shows
 * the date, so widening it is one edit away.
 */
function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const filters = ref<{ event: string; severity: string; from: string; to: string; refusedOnly: boolean }>({
  event: '',
  severity: '',
  from: store.rolePreset.defaultFilters.auditDays ? daysAgo(store.rolePreset.defaultFilters.auditDays) : '',
  to: '',
  refusedOnly: false,
})

const canExport = computed(() => store.can('finance.audit.export'))

const EVENTS = [
  { id: '', label: 'All finance events' },
  { id: 'FIN_PUBLICATION', label: 'Publication' },
  { id: 'FIN_REVISION', label: 'Budget revisions' },
  { id: 'FIN_BUDGET', label: 'Budget lines' },
  { id: 'FIN_IMPORT', label: 'Imports' },
  { id: 'FIN_CONFIG', label: 'Configuration' },
  { id: 'FIN_PROJECT', label: 'Projects' },
  { id: 'FIN_TRANSACTION', label: 'Transactions' },
  { id: 'FIN_DOCUMENT', label: 'Documents' },
  { id: 'FIN_PERMISSION', label: 'Permission grants' },
]

const severityTone: Record<string, string> = {
  low: '', medium: 'tone-info', high: 'tone-warning', critical: 'tone-negative',
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await financeApi.audit({
      event: filters.value.event || undefined,
      severity: filters.value.severity || undefined,
      from: filters.value.from || undefined,
      to: filters.value.to || undefined,
      status_min: filters.value.refusedOnly ? 400 : undefined,
      limit: 300,
    })
    events.value = result.events
    trailNote.value = result.note
  } catch (err) {
    error.value = messageOf(err, 'The audit history could not be read.')
  } finally { loading.value = false }
}

onMounted(load)

async function download(format: 'csv' | 'xlsx' | 'pdf'): Promise<void> {
  error.value = null
  try {
    const file = await financeApi.exportAudit({
      from: filters.value.from || undefined, to: filters.value.to || undefined, format,
    })
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (err) {
    error.value = messageOf(err, 'The audit export could not be produced.')
  }
}

const refusals = computed(() => events.value.filter((e) => (e.status ?? 0) >= 400))
</script>

<template>
  <div class="fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>

    <p class="fin-ccy-note">
      <ShieldCheck :size="14" aria-hidden="true" />
      Audit records cannot be edited or deleted through this application. They are written by the
      system, not by the person acting, and every mutating finance request lands here — including
      the ones that were refused.
    </p>

    <div class="fin-bar">
      <select v-model="filters.event" class="ins-input fin-filter" aria-label="Event">
        <option v-for="e in EVENTS" :key="e.id" :value="e.id">{{ e.label }}</option>
      </select>
      <select v-model="filters.severity" class="ins-input fin-filter" aria-label="Severity">
        <option value="">Any severity</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <label class="ins-field fin-date">
        <span class="ins-label">From</span>
        <input v-model="filters.from" class="ins-input" type="date" />
      </label>
      <label class="ins-field fin-date">
        <span class="ins-label">To</span>
        <input v-model="filters.to" class="ins-input" type="date" />
      </label>
      <label class="ins-check">
        <input v-model="filters.refusedOnly" type="checkbox" />
        Refused attempts only
      </label>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Apply
      </button>
      <button v-if="canExport" type="button" class="fin-btn small" @click="download('csv')">
        <Download :size="13" aria-hidden="true" /> CSV
      </button>
      <button v-if="canExport" type="button" class="fin-btn small" @click="download('xlsx')">
        <Download :size="13" aria-hidden="true" /> Excel
      </button>
      <button v-if="canExport" type="button" class="fin-btn small" @click="download('pdf')">
        <Download :size="13" aria-hidden="true" /> PDF
      </button>
    </div>

    <p v-if="refusals.length && !filters.refusedOnly" class="ins-banner t-info" role="status">
      <Info :size="16" aria-hidden="true" />
      <span>
        {{ refusals.length }} of these {{ events.length }} events are refused attempts. A refusal is
        as much a part of the record as a successful action.
      </span>
    </p>

    <p v-if="loading && events.length === 0" class="fin-loading" role="status">Reading the audit history…</p>

    <div v-else-if="events.length === 0" class="fin-empty">
      <strong>No finance events match.</strong>
      <p>
        The trail fills as the finance module is used: configuration changes, imports, approvals,
        publication and refusals.
      </p>
    </div>

    <section v-else class="ins-card">
      <div class="ins-card-head">
        <h3>Finance events <span class="ins-count">{{ events.length }}</span></h3>
      </div>
      <div class="ins-card-body">
        <div class="fin-table-wrap">
          <table class="fin-table">
            <thead>
              <tr>
                <th scope="col">When</th><th scope="col">Who</th><th scope="col">Event</th>
                <th scope="col">Severity</th><th scope="col">Action</th>
                <th scope="col" class="num">Outcome</th><th scope="col">Record</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in events" :key="e.id" :class="{ 'is-refusal': (e.status ?? 0) >= 400 }">
                <td>{{ formatDateTime(e.occurred_at) }}</td>
                <td>{{ e.actor_email ?? '—' }}<br /><small class="fin-sub">{{ e.actor_role }}</small></td>
                <td class="ins-mono">{{ e.event }}</td>
                <td><span class="fin-pill" :class="severityTone[e.severity]">{{ e.severity }}</span></td>
                <td class="ins-mono fin-path">{{ e.method }} {{ e.path }}</td>
                <td class="num">
                  <span class="fin-pill" :class="(e.status ?? 0) >= 400 ? 'tone-negative' : 'tone-positive'">
                    {{ e.status }}{{ (e.status ?? 0) >= 400 ? ' refused' : '' }}
                  </span>
                </td>
                <td>
                  <template v-if="e.entity_type">
                    {{ e.entity_type.replace(/_/g, ' ') }}<br />
                    <small class="ins-mono fin-sub">{{ e.entity_id ?? '—' }}</small>
                  </template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="trailNote" class="fin-sub">{{ trailNote }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-filter { max-width: 13rem; }
.fin-date { max-width: 10rem; }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-path { font-size: 0.85em; word-break: break-all; max-width: 26ch; }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.is-refusal td { background: var(--ent-tone-negative-bg); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }
</style>
