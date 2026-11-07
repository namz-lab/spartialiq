<script setup lang="ts">
// The Development Register — the statutory public-inspection register.
//
// Every application the council holds, with its status, its dates and its
// decision. Read-only here: the clerk maintains the register by receipting
// applications and recording decisions in the sections that own those
// records, and a screen that let the register be edited directly would let
// it disagree with them.
//
// WHAT CHANGED, BESIDES THE STYLING
// The old CSV export carried the applicant's national ID number and phone
// number in every row. This is the register that is OPEN TO PUBLIC
// INSPECTION, and the file it produces is the one handed across a counter or
// emailed to whoever asks. Those two columns are gone. The stand, the
// applicant's name, the development and the decision are the register; a
// national ID number is not, and a council that exports one by accident has
// disclosed it.
//
// The thirteen hardcoded status hexes are also gone. Status maps onto the
// five tones in the token set, so a permit that is "Approved" reads
// identically here, on the dashboard and on the map.

import { computed, onActivated, onMounted, ref } from 'vue'
import {
  planningClerkService, type DevelopmentRegisterRow,
} from '@/services/planningClerkService'
import {
  normalizeStatus, statusLabel, type CanonicalStatus,
} from '@/composables/useApplicationPipeline'
import { useClerkNav } from '@/planning-clerk/useClerkConsole'
import { asLabel, formatDate } from '@/planning-clerk/console'
import type { Tone } from '@/planning-clerk/registerSpec'
import UiButton from '@/components/ui/UiButton.vue'
import {
  BookOpen, Download, RefreshCw, Search, AlertTriangle, Inbox,
  FolderOpen, ShieldCheck, CheckCircle2,
} from 'lucide-vue-next'

const nav = useClerkNav()

const rows = ref<DevelopmentRegisterRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const search = ref(nav.param('q'))
const statusFilter = ref<'all' | CanonicalStatus>(
  (nav.param('status') as CanonicalStatus) || 'all')

const FILTER_STATUSES: CanonicalStatus[] = [
  'pending_payment', 'registered', 'acknowledged', 'circulation', 'objection_period',
  'under_review', 'awaiting_eo_decision', 'deferred',
  'approved', 'approved_with_conditions', 'refused', 'withdrawn', 'appealed',
]

/**
 * Status as one of the five tones, not as its own colour.
 *
 * The taxonomy is in enterprise.css and it means something: positive is a
 * settled favourable outcome, negative a settled unfavourable one, warning is
 * waiting on somebody, info is moving, neutral is dormant. Thirteen bespoke
 * hexes said nothing except that thirteen decisions had been made separately.
 */
const STATUS_TONE: Record<CanonicalStatus, Tone> = {
  pending_payment: 'warning',
  registered: 'neutral',
  acknowledged: 'info',
  circulation: 'info',
  objection_period: 'warning',
  under_review: 'info',
  awaiting_eo_decision: 'info',
  deferred: 'warning',
  approved: 'positive',
  approved_with_conditions: 'positive',
  refused: 'negative',
  withdrawn: 'neutral',
  appealed: 'warning',
}

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    rows.value = await planningClerkService.developmentRegister()
  } catch {
    // Not an empty register: a public-inspection register that renders as
    // "no applications" because a request failed is a statement the council
    // would be making to whoever is standing at the counter.
    loadError.value = 'Could not read the Development Register. Check the connection and try again.'
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
// Judged against the clock (days since received), so re-read on return
// rather than only on the session's first mount.
onActivated(() => { void refresh() })

function setSearch(value: string) {
  search.value = value
  nav.setParam('q', value.trim() || null)
}
function setStatus(next: 'all' | CanonicalStatus) {
  statusFilter.value = next
  nav.setParam('status', next === 'all' ? null : next)
}

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (statusFilter.value !== 'all'
      && normalizeStatus(r.permit.status) !== statusFilter.value) return false
    if (!term) return true
    const p = r.permit
    return [p.dev_register_no, p.tpd_reference, p.stand_number, p.suburb_ward, p.applicant_name]
      .some((v) => (v || '').toLowerCase().includes(term))
  })
})

const statusCounts = computed(() => {
  const acc = new Map<string, number>()
  for (const r of rows.value) {
    const s = normalizeStatus(r.permit.status)
    acc.set(s, (acc.get(s) ?? 0) + 1)
  }
  return acc
})

// ── Export ──────────────────────────────────────────────────────────────

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv() {
  // The register's own columns, and nothing else. The applicant's identity
  // number and telephone are on the file; they are not the register, and this
  // file is the one handed to a member of the public.
  const head = [
    'dev_register_no', 'tpd_reference', 'stand_number', 'suburb_ward',
    'applicant_name', 'development_type', 'status',
    'received_at', 'days_since_received', 'decision_at',
  ]
  const lines = filtered.value.map((r) => {
    const p = r.permit
    return [
      p.dev_register_no, p.tpd_reference, p.stand_number, p.suburb_ward,
      p.applicant_name, p.development_type, statusLabel(p.status),
      p.received_at, r.daysSinceReceived, p.decision_at,
    ].map(esc).join(',')
  })
  const csv = [head.join(','), ...lines].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `development-register-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Registers</span>
        <h2 class="ins-title">Development Register</h2>
        <p class="ins-lede">
          The statutory register, open to public inspection. Read-only here —
          it is maintained by receipting applications and recording decisions
          in the sections that own those records.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="loading" @click="refresh">
          <template #icon><RefreshCw :size="14" :class="{ 'ins-spin': loading }" /></template>
          Refresh
        </UiButton>
        <UiButton size="sm" variant="secondary" :disabled="!filtered.length" @click="exportCsv">
          <template #icon><Download :size="14" /></template>
          CSV
        </UiButton>
      </div>
    </header>

    <p class="ins-banner t-info">
      <ShieldCheck :size="15" aria-hidden="true" />
      <span>
        The export carries the register’s own columns only. Applicants’
        identity numbers and telephone numbers stay on the file — this is the
        list that gets handed across a counter.
      </span>
    </p>

    <p v-if="loadError" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ loadError }}</span>
    </p>

    <div class="clk-reg-controls">
      <label class="ins-search clk-reg-find">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search the register</span>
        <input :value="search" type="search"
               placeholder="Register number, TPD reference, stand, ward or applicant"
               @input="setSearch(($event.target as HTMLInputElement).value)" />
      </label>
      <span class="clk-reg-count">
        {{ filtered.length }} of {{ rows.length }}
      </span>
    </div>

    <div class="ins-chips" role="group" aria-label="Filter by status">
      <button type="button" class="ins-chip" :aria-pressed="statusFilter === 'all'"
              @click="setStatus('all')">
        All<span class="ins-chip-n">{{ rows.length }}</span>
      </button>
      <button v-for="s in FILTER_STATUSES" :key="s" type="button" class="ins-chip"
              :aria-pressed="statusFilter === s" @click="setStatus(s)">
        {{ statusLabel(s) }}<span class="ins-chip-n">{{ statusCounts.get(s) ?? 0 }}</span>
      </button>
    </div>

    <div v-if="loading && !rows.length" class="clk-reg-load" aria-busy="true">
      <span v-for="n in 6" :key="n" class="ins-skel" />
      <span class="ent-sr-only">Reading the register</span>
    </div>

    <section v-else-if="filtered.length" class="ins-card">
      <div class="clk-reg-scroll">
        <table class="clk-reg-table">
          <thead>
            <tr>
              <th scope="col">Register no.</th>
              <th scope="col">TPD reference</th>
              <th scope="col">Stand</th>
              <th class="sec" scope="col">Ward / suburb</th>
              <th scope="col">Applicant</th>
              <th class="sec" scope="col">Development</th>
              <th scope="col">Status</th>
              <th class="sec" scope="col">Received</th>
              <th class="sec" scope="col">Days</th>
              <th><span class="ent-sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.permit.id"
                :class="{ open: nav.permit.value === r.permit.id }">
              <td class="ins-mono">{{ r.permit.dev_register_no || '—' }}</td>
              <td class="ins-mono">{{ r.permit.tpd_reference || '—' }}</td>
              <td class="ins-mono">{{ r.permit.stand_number || '—' }}</td>
              <td class="sec">{{ r.permit.suburb_ward || '—' }}</td>
              <td>{{ r.permit.applicant_name }}</td>
              <td class="sec">{{ asLabel(r.permit.development_type) }}</td>
              <td>
                <span class="clk-reg-chip" :class="`t-${STATUS_TONE[normalizeStatus(r.permit.status)]}`">
                  {{ statusLabel(r.permit.status) }}
                </span>
              </td>
              <td class="sec">{{ formatDate(r.permit.received_at) }}</td>
              <!-- Days on the register, which is the number a clerk is asked
                   about and the one the three-month clock is counted from. -->
              <td class="sec ins-mono clk-reg-days">{{ r.daysSinceReceived }}</td>
              <td class="clk-reg-open">
                <button v-if="nav.permit.value !== r.permit.id" type="button"
                        class="ins-iconbtn clk-reg-openbtn"
                        :title="`Open ${r.permit.tpd_reference || 'this file'}`"
                        @click="nav.openFile(r.permit.id)">
                  <FolderOpen :size="14" aria-hidden="true" />
                  <span class="ent-sr-only">Open this file</span>
                </button>
                <CheckCircle2 v-else :size="14" class="clk-reg-here" aria-hidden="true" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-else class="clk-reg-empty">
      <Inbox :size="22" aria-hidden="true" />
      <p v-if="search || statusFilter !== 'all'">
        No entry in the register matches those filters.
      </p>
      <p v-else>
        <BookOpen :size="14" aria-hidden="true" />
        The register is empty. Applications appear here as they are received.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Tokens only. The thirteen slate, amber, sky, teal and rose hexes this file
   used to carry are gone — status is one of the five tones in the token set. */

.clk-reg-controls { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.clk-reg-find { flex:1; min-width:16rem; }
.clk-reg-count { font-size:var(--ent-fs-xs); color:var(--ent-text-3);
  font-variant-numeric:tabular-nums; white-space:nowrap; }

.clk-reg-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-reg-load .ins-skel:nth-child(even) { width:80%; }

.clk-reg-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.clk-reg-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.clk-reg-table th, .clk-reg-table td {
  padding:var(--ent-s2) var(--ent-s3); text-align:left; vertical-align:top;
  border-bottom:1px solid var(--ent-line); }
.clk-reg-table th {
  position:sticky; top:0; z-index:var(--ent-z-sticky);
  background:var(--ent-surface-2); color:var(--ent-text-3);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap;
  border-bottom:1px solid var(--ent-line-strong); }
.clk-reg-table td { color:var(--ent-text); }
.clk-reg-table tbody tr:hover td { background:var(--ent-surface-2); }
.clk-reg-table tbody tr.open td { background:var(--ent-accent-soft); }

.clk-reg-chip { display:inline-block; padding:1px var(--ent-s2);
  border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); white-space:nowrap;
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); }
.clk-reg-chip.t-info { background:var(--ent-tone-info-bg); color:var(--ent-tone-info-fg); border-color:var(--ent-tone-info-line); }
.clk-reg-chip.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); border-color:var(--ent-tone-positive-line); }
.clk-reg-chip.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); border-color:var(--ent-tone-warning-line); }
.clk-reg-chip.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); border-color:var(--ent-tone-negative-line); }

.clk-reg-days { text-align:right; font-variant-numeric:tabular-nums; }
.clk-reg-open { width:1%; text-align:right; }
.clk-reg-openbtn { width:28px; height:28px; }
.clk-reg-here { color:var(--ent-accent); }

.clk-reg-empty { display:flex; flex-direction:column; align-items:center;
  gap:var(--ent-s3); padding:var(--ent-s7) var(--ent-s4); text-align:center;
  color:var(--ent-text-3); }
.clk-reg-empty p { margin:0; font-size:var(--ent-fs-sm); max-width:40ch;
  line-height:var(--ent-lh); }

@media (max-width: 1023px) {
  .clk-reg-table th.sec, .clk-reg-table td.sec { display:none; }
}
</style>
