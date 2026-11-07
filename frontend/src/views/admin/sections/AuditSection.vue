<script setup lang="ts">
// Audit trail — every change to the council record, and who made it.
//
// This is the section the whole console is built around. Under the Regional,
// Town and Country Planning Act a determination, a permit and an enforcement
// order all have to be attributable to an officer, and until migration 124
// this system recorded none of them: the middleware wrote to a table that the
// migration declaring it could never create. The trail starts from the day
// that was fixed, and the empty-state below says so rather than letting a
// short history read as a quiet system.
//
// THE FILTERS ARE IN THE URL
// Every one of them. An IT admin's work ends in "send me that" more often than
// any other role's, and a filtered trail that cannot be linked has to be
// described in prose instead — which is how the wrong rows get looked at.
//
// PAGINATION, NOT INFINITE SCROLL
// The trail is unbounded and grows with every mutation in the council. An
// admin answering "what happened to permit 0900" needs to know there are 340
// matches and to reach the last one, not to scroll toward it.

import { computed, onMounted, ref, watch } from 'vue'
import { useAdminNav, useAdminPreferences } from '@/admin/useAdminConsole'
import {
  listAudit, listAuditEventTypes, exportAudit, errorMessage,
  type AuditEvent, type AuditEventType, type Severity,
} from '@/services/adminConsole'
import { asLabel, daysAgoIso, formatWhen, timeAgo } from '@/admin/console'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import {
  Search, Download, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, ScrollText,
} from 'lucide-vue-next'

const nav = useAdminNav()
const { prefs } = useAdminPreferences()

const rows = ref<AuditEvent[]>([])
const total = ref(0)
const offset = ref(0)
const eventTypes = ref<AuditEventType[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const exporting = ref(false)
const exportNote = ref<string | null>(null)
const open = ref<AuditEvent | null>(null)

const PAGE = 50

// Filters live in the URL; these read them. `windowDays` is the admin's own
// preference and is NOT in the URL: it is how far back this device opens on,
// not part of what a shared link means.
const q = computed(() => nav.param('q'))
const severity = computed(() => nav.param('severity') as Severity | '')
const eventName = computed(() => nav.param('event'))
const entityId = computed(() => nav.param('entity'))

const windowDays = computed(() => prefs.value.auditWindowDays)

const SEVERITIES: Array<{ id: Severity | ''; label: string }> = [
  { id: '', label: 'Any severity' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
]

const columns = [
  { key: 'occurred_at', label: 'When', width: '11rem' },
  { key: 'actor_email', label: 'Officer', width: '15rem' },
  { key: 'event', label: 'Change', width: '10rem' },
  { key: 'severity', label: 'Severity', width: '7rem' },
  { key: 'path', label: 'Where', hideOnMobile: true },
  { key: 'status', label: 'Result', width: '6rem', align: 'right' },
]

function query() {
  return {
    from: daysAgoIso(windowDays.value),
    q: q.value || undefined,
    severity: severity.value || undefined,
    event: eventName.value || undefined,
    entityId: entityId.value || undefined,
    limit: PAGE,
    offset: offset.value,
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await listAudit(query())
    rows.value = result.data
    total.value = result.meta.total
  } catch (err) {
    // The list is cleared rather than left stale: a filter that failed to
    // apply must not leave the previous filter's rows on screen under the new
    // filter's heading.
    rows.value = []
    total.value = 0
    error.value = errorMessage(err, 'The audit trail could not be read.')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  try { eventTypes.value = await listAuditEventTypes() } catch { eventTypes.value = [] }
})

// Any filter change returns to the first page: staying on page 7 of a result
// set that now has two pages shows an empty screen and looks like a failure.
watch([q, severity, eventName, entityId, windowDays], () => {
  offset.value = 0
  void load()
})

function page(direction: -1 | 1) {
  const next = offset.value + direction * PAGE
  if (next < 0 || next >= total.value) return
  offset.value = next
  void load()
}

const showing = computed(() => {
  if (!total.value) return 'No matching entries'
  const first = offset.value + 1
  const last = Math.min(offset.value + rows.value.length, total.value)
  return `${first}–${last} of ${total.value.toLocaleString()}`
})

const severityTone: Record<Severity, 'neutral' | 'info' | 'warning' | 'negative'> = {
  low: 'neutral', medium: 'info', high: 'warning', critical: 'negative',
}

/** A 2xx is what was meant to happen; anything else is worth the reader's eye. */
function statusTone(status: number | null) {
  if (status === null) return 'neutral'
  if (status < 300) return 'positive'
  if (status < 500) return 'warning'
  return 'negative'
}

async function download() {
  exporting.value = true
  exportNote.value = null
  try {
    const { blob, rows: n, capped } = await exportAudit({ ...query(), limit: undefined, offset: undefined })
    // An object URL rather than a data: URI — an export of tens of thousands
    // of rows exceeds what a data URI can carry in several browsers.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vungu-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    exportNote.value = capped
      ? `Exported the first ${n.toLocaleString()} entries — the export is capped. Narrow the filters to reach the rest.`
      : `Exported ${n.toLocaleString()} entr${n === 1 ? 'y' : 'ies'}.`
  } catch (err) {
    exportNote.value = errorMessage(err, 'The export could not be produced.')
  } finally {
    exporting.value = false
  }
}

const emptyMessage = computed(() => {
  if (error.value) return 'The trail could not be read.'
  if (q.value || severity.value || eventName.value || entityId.value) {
    return 'No entry matches these filters.'
  }
  return `Nothing recorded in the last ${windowDays.value} day${windowDays.value === 1 ? '' : 's'}.`
})
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Security &amp; audit</span>
        <h2 class="ins-title">Audit trail</h2>
        <p class="ins-lede">
          Every change an identified officer made to the council record, with the
          result the server returned. Read-only and append-only: nothing here can
          be edited or removed from this console.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="au-btn" :disabled="exporting" @click="download">
          <Download :size="14" aria-hidden="true" />
          {{ exporting ? 'Preparing…' : 'Export CSV' }}
        </button>
        <button type="button" class="au-btn" :disabled="loading" @click="load">
          <RefreshCw :size="14" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          Refresh
        </button>
      </div>
    </header>

    <!-- ── Filters ────────────────────────────────────────────────────── -->
    <div class="au-filters">
      <label class="ins-search au-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the audit trail</span>
        <input type="search" :value="q" placeholder="Officer, path or record reference"
               @input="nav.setParam('q', ($event.target as HTMLInputElement).value)" />
      </label>

      <label class="au-select">
        <span class="ent-sr-only">Severity</span>
        <select class="ins-input" :value="severity"
                @change="nav.setParam('severity', ($event.target as HTMLSelectElement).value)">
          <option v-for="s in SEVERITIES" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </label>

      <label class="au-select">
        <span class="ent-sr-only">Kind of change</span>
        <select class="ins-input" :value="eventName"
                @change="nav.setParam('event', ($event.target as HTMLSelectElement).value)">
          <option value="">Any change</option>
          <!-- Only kinds that actually occur are offered, so the filter can
               never produce a guaranteed-empty result. -->
          <option v-for="t in eventTypes" :key="t.event" :value="t.event">
            {{ t.event }} ({{ t.n.toLocaleString() }})
          </option>
        </select>
      </label>

      <p class="au-window">
        Last {{ windowDays }} day{{ windowDays === 1 ? '' : 's' }} ·
        <button type="button" class="au-link" @click="nav.go('preferences')">change</button>
      </p>
    </div>

    <p v-if="entityId" class="au-scoped">
      Showing only changes to record <code class="ins-mono">{{ entityId }}</code>.
      <button type="button" class="au-link" @click="nav.setParam('entity', null)">Clear</button>
    </p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>{{ error }}</strong>
        <p>An empty list below would not mean “nothing happened”. Retry before drawing a conclusion.</p>
      </div>
      <button type="button" class="au-btn" @click="load">Retry</button>
    </div>

    <p v-if="exportNote" class="au-note" role="status">{{ exportNote }}</p>

    <!-- ── The trail ──────────────────────────────────────────────────── -->
    <section class="ins-card">
      <div class="ins-card-head">
        <h3><ScrollText :size="15" aria-hidden="true" /> Entries <span class="ins-count">{{ showing }}</span></h3>
        <div class="au-pager">
          <button type="button" class="ins-iconbtn" :disabled="offset === 0 || loading" @click="page(-1)">
            <ChevronLeft :size="15" aria-hidden="true" /><span class="ent-sr-only">Previous page</span>
          </button>
          <button type="button" class="ins-iconbtn"
                  :disabled="offset + rows.length >= total || loading" @click="page(1)">
            <ChevronRight :size="15" aria-hidden="true" /><span class="ent-sr-only">Next page</span>
          </button>
        </div>
      </div>

      <UiDataTable
        :columns="columns" :rows="rows" row-key="id" :loading="loading"
        :empty-message="emptyMessage" clickable dense
        mobile-primary="event" mobile-secondary="actor_email" mobile-status="severity"
        @row-click="open = $event"
      >
        <template #cell-occurred_at="{ row }">
          <span :title="formatWhen(row.occurred_at)">{{ timeAgo(row.occurred_at) }}</span>
        </template>
        <template #cell-actor_email="{ row }">
          <span class="au-actor">
            <strong>{{ row.actor_email ?? 'Unknown' }}</strong>
            <small>{{ row.actor_role ?? '—' }}</small>
          </span>
        </template>
        <template #cell-severity="{ row }">
          <UiStatusBadge :tone="severityTone[row.severity as Severity]" :label="asLabel(row.severity)" />
        </template>
        <template #cell-path="{ row }">
          <span class="ins-mono au-path" :title="row.path ?? ''">{{ row.method }} {{ row.path }}</span>
        </template>
        <template #cell-status="{ row }">
          <UiStatusBadge :tone="statusTone(row.status)" :label="String(row.status ?? '—')" :dot="false" />
        </template>
      </UiDataTable>
    </section>

    <!-- ── One entry in full ──────────────────────────────────────────── -->
    <UiSheet :open="open !== null" title="Audit entry"
             :subtitle="open ? formatWhen(open.occurred_at) : ''" width="34rem"
             @close="open = null" @update:open="open = $event ? open : null">
      <dl v-if="open" class="ins-dl">
        <div><dt>Officer</dt><dd>{{ open.actor_email ?? 'Unknown' }}</dd></div>
        <div><dt>Role at the time</dt><dd>{{ open.actor_role ?? '—' }}</dd></div>
        <div><dt>Change</dt><dd>{{ open.event }}</dd></div>
        <div><dt>Severity</dt><dd>{{ open.severity }}</dd></div>
        <div><dt>Request</dt><dd class="ins-mono">{{ open.method }} {{ open.path }}</dd></div>
        <div><dt>Result</dt><dd>{{ open.status }}</dd></div>
        <div><dt>Took</dt><dd>{{ open.duration_ms === null ? '—' : `${open.duration_ms} ms` }}</dd></div>
        <div><dt>Record</dt>
          <dd class="ins-mono">{{ open.entity_type ?? '—' }} {{ open.entity_id ?? '' }}</dd></div>
        <div><dt>From</dt><dd class="ins-mono">{{ open.ip ?? '—' }}</dd></div>
        <div><dt>Recorded</dt><dd>{{ formatWhen(open.occurred_at) }}</dd></div>
      </dl>

      <template v-if="open?.entity_id">
        <button type="button" class="au-btn au-related"
                @click="nav.setParam('entity', open!.entity_id); open = null">
          Show every change to this record
        </button>
      </template>
    </UiSheet>
  </div>
</template>

<style scoped>
.au-filters { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.au-search { flex:1; min-width:16rem; }
.au-select { display:inline-flex; min-width:11rem; }
.au-select select { width:100%; }
.au-window { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); white-space:nowrap; }

.au-link { font-family:var(--ent-font); font-size:inherit; color:var(--ent-accent);
  background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; }
.au-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:2px; }

.au-scoped { margin:0; padding:var(--ent-s2) var(--ent-s3);
  font-size:var(--ent-fs-sm); color:var(--ent-accent);
  background:var(--ent-accent-soft); border:1px solid var(--ent-accent-line);
  border-radius:var(--ent-r); }

.au-note { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }

.au-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r); cursor:pointer;
  transition:background-color var(--ent-dur) var(--ent-ease); }
.au-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.au-btn:disabled { opacity:0.55; cursor:not-allowed; }
.au-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.au-related { margin-top:var(--ent-s4); }

.au-pager { display:inline-flex; gap:var(--ent-s1); }

.au-actor { display:block; min-width:0; }
.au-actor strong { display:block; font-weight:var(--ent-fw-medium); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.au-actor small { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

/* Narrow enough that the Result column still fits beside an open rail at
   1366px, which is the council's standard laptop. The full path is in the
   row's title and in the detail sheet. */
.au-path { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:18rem; }

@media (max-width: 767px) {
  .au-search { min-width:100%; }
  .au-select { flex:1; min-width:9rem; }
}
</style>
