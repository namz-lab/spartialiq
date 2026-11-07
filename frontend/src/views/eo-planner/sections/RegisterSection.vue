<script setup lang="ts">
// The development register — every application the council has received.
//
// This is the section the console did not have, and its absence was the reason
// every other section carried its own picker: there was no one place to find a
// file. Searching, filtering and paging are all done by the server, so the
// register works the same on the four-hundredth application as on the fourth,
// and a rural connection is not asked to carry the whole register to filter it
// in the browser.
//
// Opening a row opens the case for the WHOLE console (the case bar, and every
// casework section with it), so the next step — intake, assessment, notice,
// determination — is one click away with the file already open.

import { computed, ref, watch } from 'vue'
import {
  dmApi, type PermitApplication, type PermitStatus, type DevType, type PermitEvent,
  type PermitDocument,
} from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useEoNav } from '@/eo-planner/useEoNav'
import { useEoCase } from '@/eo-planner/useEoCase'
import { useEoPreferences } from '@/eo-planner/useEoPreferences'
import { caseClock, nextStepFor } from '@/eo-planner/console'
import { fmtDate, fmtDateTime, humanise } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import {
  Library, Search, RefreshCw, Download, ChevronLeft, ChevronRight, Clock,
  FolderOpen, FileText, History, AlertTriangle, ArrowRight,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const nav = useEoNav()
const eoCase = useEoCase()
const { prefs } = useEoPreferences()
const { isMobile } = useBreakpoint()

// ── Filters ───────────────────────────────────────────────────────────
// The search term lives in ?q= so a register a colleague was sent survives the
// link. Status and type do not: they are how one officer is reading the list
// this minute, not what they are pointing at.
const search = ref(nav.param('q') ?? '')
const status = ref<'' | PermitStatus>('')
const devType = ref<'' | DevType>('')
const PAGE = 25
const offset = ref(0)

const STATUSES: PermitStatus[] = [
  'pending_payment', 'registered', 'acknowledged', 'circulation', 'objection_period',
  'under_review', 'awaiting_eo_decision', 'deferred', 'approved',
  'approved_with_conditions', 'refused', 'appealed', 'withdrawn',
]
const DEV_TYPES: DevType[] = [
  'new_building', 'alteration', 'extension', 'change_of_use',
  'subdivision', 'consolidation', 'rezoning', 'other',
]

const rows = ref<PermitApplication[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const r = await dmApi.listPermits({
      search: search.value.trim() || undefined,
      status: status.value || undefined,
      development_type: devType.value || undefined,
      limit: PAGE,
      offset: offset.value,
    })
    rows.value = r.data ?? []
    total.value = Number(r.total ?? rows.value.length)
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Could not read the register.')
    rows.value = []
  } finally {
    loading.value = false
  }
}

const { refreshNow } = useStaleRefresh(load)

// Typing filters the server-side list, but not on every keystroke: a district
// register over a rural link is one request per pause, not one per letter.
let debounce: ReturnType<typeof setTimeout> | null = null
watch(search, (q) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    offset.value = 0
    nav.setParam('q', q.trim() || null)
    void refreshNow()
  }, 350)
})
watch([status, devType], () => { offset.value = 0; void refreshNow() })
watch(offset, () => { void refreshNow() })

const showing = computed(() => {
  if (!total.value) return 'No applications'
  const from = offset.value + 1
  const to = Math.min(offset.value + rows.value.length, total.value)
  return `${from}–${to} of ${total.value}`
})
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + rows.value.length < total.value)

function clockOf(p: PermitApplication) {
  return caseClock(p.acknowledged_at ?? p.received_at ?? null, prefs.value.clockWarningDays)
}

function caseRef(p: PermitApplication): string {
  return p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase()
}

// ── Opening a case ────────────────────────────────────────────────────
const detailOpen = ref(false)
const events = ref<PermitEvent[]>([])
const documents = ref<PermitDocument[]>([])
const detailLoading = ref(false)

async function openRow(p: PermitApplication) {
  eoCase.open(p.id)
  detailOpen.value = true
  detailLoading.value = true
  events.value = []
  documents.value = []
  try {
    const [ev, docs] = await Promise.all([
      dmApi.listEvents(p.id).catch(() => [] as PermitEvent[]),
      dmApi.listPermitDocuments(p.id).catch(() => [] as PermitDocument[]),
    ])
    events.value = ev
    documents.value = docs
  } finally {
    detailLoading.value = false
  }
}

const selected = computed(() => eoCase.permit.value)
const nextStep = computed(() => nextStepFor(selected.value?.status))

function goNext() {
  const step = nextStep.value
  if (!step || !selected.value) return
  detailOpen.value = false
  nav.go(step.section, { case: selected.value.id })
}

// ── Export ────────────────────────────────────────────────────────────
/**
 * The page on screen, as the officer filtered it. Not the whole register:
 * exporting 400 rows the officer has not seen is how a spreadsheet with
 * someone's telephone number in it ends up on a memory stick.
 */
function exportCsv() {
  const head = ['Register no', 'TPD ref', 'Stand', 'Ward', 'Applicant', 'Type',
    'Status', 'Received', 'Days to determine']
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [head.join(',')]
  for (const p of rows.value) {
    lines.push([
      p.dev_register_no, p.tpd_reference, p.stand_number, p.suburb_ward, p.applicant_name,
      humanise(p.development_type), statusLabel(p.status), fmtDate(p.received_at),
      clockOf(p).daysLeft ?? '',
    ].map(cell).join(','))
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `development-register-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  fb.showToast(`Exported ${rows.value.length} row(s) as shown.`, 'success')
}

function eventLabel(e: PermitEvent): string {
  return humanise(e.event_type)
}
</script>

<template>
  <div class="ins-page rg">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Development register</span>
        <h2 class="ins-title"><Library :size="18" aria-hidden="true" /> Applications</h2>
        <p class="ins-lede">
          Every application on the register. Open one and it stays open across the console —
          intake, assessment, notice, circulation, committee and determination all work the
          file you choose here.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="rg-btn" :disabled="!rows.length" @click="exportCsv">
          <Download :size="14" aria-hidden="true" /> Export as shown
        </button>
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload"
                @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          <span class="ent-sr-only">Reload the register</span>
        </button>
      </div>
    </header>

    <div v-if="loadError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div><strong>The register could not be read.</strong><p>{{ loadError }}</p></div>
      <button type="button" class="rg-btn" @click="refreshNow">Try again</button>
    </div>

    <div class="rg-tools">
      <label class="ins-search rg-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the register</span>
        <input v-model="search" type="search"
               placeholder="Register number, TPD reference, stand, applicant or ward" />
      </label>
      <label class="rg-select">
        <span class="ent-sr-only">Filter by status</span>
        <select v-model="status" class="ins-input">
          <option value="">Any status</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</option>
        </select>
      </label>
      <label class="rg-select">
        <span class="ent-sr-only">Filter by development type</span>
        <select v-model="devType" class="ins-input">
          <option value="">Any type</option>
          <option v-for="t in DEV_TYPES" :key="t" :value="t">{{ humanise(t) }}</option>
        </select>
      </label>
    </div>

    <section class="ins-card">
      <header class="ins-card-head">
        <h3>Register</h3>
        <span class="ins-count">{{ showing }}</span>
      </header>

      <p v-if="loading && !rows.length" class="rg-msg">Reading the register…</p>
      <p v-else-if="!rows.length" class="rg-msg">
        Nothing on the register matches this search. Clear the filters to see every
        application the council has received.
      </p>

      <!-- Desktop: a table, because this is a register and registers are read
           down a column. -->
      <div v-else-if="!isMobile" class="rg-tablewrap">
        <table class="rg-table">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Stand / ward</th>
              <th scope="col">Applicant</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Received</th>
              <th scope="col">Clock</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id"
                :class="{ on: p.id === eoCase.caseId.value }"
                tabindex="0" role="button"
                :aria-label="`Open ${caseRef(p)}`"
                @click="openRow(p)" @keydown.enter="openRow(p)" @keydown.space.prevent="openRow(p)">
              <td class="ins-mono rg-ref">{{ caseRef(p) }}</td>
              <td>{{ p.stand_number }}<small v-if="p.suburb_ward"> · {{ p.suburb_ward }}</small></td>
              <td>{{ p.applicant_name }}</td>
              <td>{{ humanise(p.development_type) }}</td>
              <td><span class="rg-status">{{ statusLabel(p.status) }}</span></td>
              <td>{{ fmtDate(p.received_at) }}</td>
              <td>
                <span class="rg-clock" :class="`t-${clockOf(p).tone}`">
                  <Clock :size="11" aria-hidden="true" /> {{ clockOf(p).label }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Phone: one card per application. A seven-column table at 375px is a
           horizontal scroll nobody reads. -->
      <ul v-else class="ins-rows">
        <li v-for="p in rows" :key="p.id">
          <button type="button" class="ins-row rg-row" :class="{ on: p.id === eoCase.caseId.value }"
                  @click="openRow(p)">
            <span class="ins-row-main">
              <span class="ins-row-title"><span class="ins-mono">{{ caseRef(p) }}</span></span>
              <span class="ins-row-meta">
                Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template>
                · {{ p.applicant_name }}
              </span>
              <span class="ins-row-meta">
                {{ statusLabel(p.status) }} · received {{ fmtDate(p.received_at) }}
              </span>
            </span>
            <span class="rg-clock" :class="`t-${clockOf(p).tone}`">{{ clockOf(p).label }}</span>
          </button>
        </li>
      </ul>

      <footer v-if="rows.length" class="ins-card-foot rg-pager">
        <button type="button" class="rg-btn" :disabled="!canPrev || loading"
                @click="offset = Math.max(0, offset - PAGE)">
          <ChevronLeft :size="14" aria-hidden="true" /> Previous
        </button>
        <span class="rg-pager-count">{{ showing }}</span>
        <button type="button" class="rg-btn" :disabled="!canNext || loading"
                @click="offset = offset + PAGE">
          Next <ChevronRight :size="14" aria-hidden="true" />
        </button>
      </footer>
    </section>

    <!-- Case file -->
    <UiSheet :open="detailOpen && !!selected" :title="selected ? caseRef(selected) : 'Case'"
             :subtitle="selected ? `Stand ${selected.stand_number} · ${selected.applicant_name}` : undefined"
             width="34rem" tall
             @close="detailOpen = false" @update:open="detailOpen = $event">
      <div v-if="selected" class="rg-detail">
        <p class="ins-banner" :class="`t-${eoCase.clock.value.tone === 'ok' ? 'info' : eoCase.clock.value.tone === 'expired' ? 'negative' : 'warning'}`">
          <Clock :size="16" aria-hidden="true" />
          <span>
            <strong>{{ eoCase.clock.value.label }}</strong>
            <template v-if="eoCase.clock.value.tone === 'expired'">
              — the applicant may treat the application as refused and appeal (s.26(7)).
            </template>
          </span>
        </p>

        <dl class="ins-dl">
          <div><dt>Status</dt><dd>{{ statusLabel(selected.status) }}</dd></div>
          <div><dt>Type</dt><dd>{{ humanise(selected.development_type) }}</dd></div>
          <div><dt>Received</dt><dd>{{ fmtDate(selected.received_at) }}</dd></div>
          <div><dt>Acknowledged</dt><dd>{{ fmtDate(selected.acknowledged_at) }}</dd></div>
          <div><dt>Fee</dt><dd>{{ selected.fee_paid ? 'Paid' : 'Not received' }}</dd></div>
          <div><dt>Determined</dt><dd>{{ fmtDate(selected.decision_at) }}</dd></div>
          <div v-if="selected.applicant_phone"><dt>Telephone</dt><dd>{{ selected.applicant_phone }}</dd></div>
          <div v-if="selected.title_deed_no"><dt>Title deed</dt><dd class="ins-mono">{{ selected.title_deed_no }}</dd></div>
        </dl>

        <p v-if="selected.description" class="rg-desc">{{ selected.description }}</p>

        <button v-if="nextStep" type="button" class="rg-btn primary rg-next" @click="goNext">
          <ArrowRight :size="14" aria-hidden="true" /> {{ nextStep.label }}
        </button>

        <section class="rg-block">
          <h4><FileText :size="14" aria-hidden="true" /> Documents <span>{{ documents.length }}</span></h4>
          <p v-if="detailLoading" class="rg-msg-sm">Loading…</p>
          <p v-else-if="!documents.length" class="rg-msg-sm">Nothing has been filed against this case.</p>
          <ul v-else class="rg-docs">
            <li v-for="d in documents" :key="d.id">
              <a v-if="d.storage_url" :href="d.storage_url" target="_blank" rel="noopener">{{ d.file_name }}</a>
              <span v-else>{{ d.file_name }}</span>
              <small>{{ humanise(d.doc_type) }} · {{ fmtDate(d.uploaded_at) }}</small>
            </li>
          </ul>
        </section>

        <section class="rg-block">
          <h4><History :size="14" aria-hidden="true" /> History</h4>
          <p v-if="detailLoading" class="rg-msg-sm">Loading…</p>
          <p v-else-if="!events.length" class="rg-msg-sm">No recorded events yet.</p>
          <ol v-else class="rg-events">
            <li v-for="e in events.slice(0, 20)" :key="e.id">
              <span class="rg-ev-when">{{ fmtDateTime(e.created_at) }}</span>
              <span class="rg-ev-what">{{ eventLabel(e) }}</span>
              <small v-if="e.actor_role">{{ humanise(e.actor_role) }}</small>
            </li>
          </ol>
        </section>

        <p class="ins-hint">
          <FolderOpen :size="12" aria-hidden="true" />
          This case stays open across the console until you close it in the bar above.
        </p>
      </div>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.rg-tools { display:flex; gap:var(--ent-s3); flex-wrap:wrap; align-items:center; }
.rg-search { flex:1; min-width:16rem; }
.rg-select select { min-width:11rem; }

.rg-tablewrap { overflow-x:auto; }
.rg-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.rg-table th { position:sticky; top:0; z-index:1; text-align:left; white-space:nowrap;
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface-2); color:var(--ent-text-3);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.04em;
  text-transform:uppercase; border-bottom:1px solid var(--ent-line); }
.rg-table td { padding:var(--ent-s2) var(--ent-s3); border-top:1px solid var(--ent-line);
  color:var(--ent-text-2); vertical-align:middle; }
.rg-table td small { color:var(--ent-text-3); }
.rg-table tbody tr { cursor:pointer; }
.rg-table tbody tr:hover { background:var(--ent-surface-2); }
.rg-table tbody tr:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.rg-table tbody tr.on { background:var(--ent-accent-soft); }
.rg-ref { font-weight:var(--ent-fw-semibold); color:var(--ent-text); white-space:nowrap; }
.rg-status { white-space:nowrap; }

.rg-clock { display:inline-flex; align-items:center; gap:4px; white-space:nowrap;
  padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.rg-clock.t-caution { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.rg-clock.t-urgent, .rg-clock.t-expired { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }

.rg-row { width:100%; background:none; border:0; text-align:left; cursor:pointer;
  font-family:var(--ent-font); }
.rg-row:hover { background:var(--ent-surface-2); }
.rg-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.rg-row.on { background:var(--ent-accent-soft); }

.rg-pager { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s3); }
.rg-pager-count { font-size:var(--ent-fs-xs); color:var(--ent-text-3); font-variant-numeric:tabular-nums; }

.rg-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; }
.rg-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.rg-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.rg-btn:disabled { opacity:0.55; cursor:not-allowed; }
.rg-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.rg-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.rg-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.rg-msg-sm { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.rg-detail { display:flex; flex-direction:column; gap:var(--ent-s4); }
.rg-desc { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }
.rg-next { align-self:flex-start; }
.rg-block h4 { display:flex; align-items:center; gap:var(--ent-s2); margin:0 0 var(--ent-s2);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.rg-block h4 span { color:var(--ent-text-3); font-weight:var(--ent-fw-normal); }
.rg-docs, .rg-events { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.rg-docs li { display:flex; flex-direction:column; font-size:var(--ent-fs-sm); }
.rg-docs a { color:var(--ent-accent); }
.rg-docs small, .rg-events small { font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.rg-events li { display:grid; grid-template-columns:9.5rem 1fr auto; gap:var(--ent-s2);
  align-items:baseline; font-size:var(--ent-fs-xs); color:var(--ent-text-2);
  padding-bottom:var(--ent-s2); border-bottom:1px solid var(--ent-line); }
.rg-ev-when { color:var(--ent-text-3); font-variant-numeric:tabular-nums; }
.rg-ev-what { color:var(--ent-text); }

@media (max-width: 767px) {
  .rg-select select { min-width:0; width:100%; }
  .rg-events li { grid-template-columns:1fr; }
}
</style>
