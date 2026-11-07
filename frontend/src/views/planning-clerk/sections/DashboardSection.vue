<script setup lang="ts">
// The clerk's day, on one screen.
//
// WHAT THIS REPLACED
// The old dashboard built itself from six separate reads of the whole permit
// table — five hundred rows each — and then counted them in the browser. That
// is most of a megabyte, on a rural link, to show eight numbers. It is now one
// request to /planning-clerk/overview, counted in the database.
//
// It also added up fee receipts held in localStorage and presented the total
// as "fees collected", which was a number that existed on one machine.
//
// WHAT IS ON IT
// Three things, in the order a clerk needs them:
//   1. What is late. If anything is past a statutory date, that is the
//      morning's work and nothing else on the screen matters as much.
//   2. Today: what came in, what was taken at the counter, what went out.
//   3. The desks, as a way in.
// There are no vanity totals. "412 applications on the register" is true and
// changes nothing anybody does today.

import { computed, onActivated, onMounted } from 'vue'
import { useClerkNav, useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { asLabel, formatMoney, formatWhen } from '@/planning-clerk/console'
import type { SectionKey } from '@/planning-clerk/console'
import { num } from '@/services/planningClerk'
import UiButton from '@/components/ui/UiButton.vue'
import {
  AlertTriangle, CheckCircle2, FileInput, Mail, FileX, FolderInput,
  Receipt as ReceiptIcon, Inbox, Eye, Megaphone, Send, BookOpen,
  Search, AlarmClock, FolderOpen, RefreshCw, Clock,
} from 'lucide-vue-next'

const nav = useClerkNav()
const { prefs } = useClerkPreferences()
const overview = useClerkOverview()

// Counters are refreshed by the shell on every section change. The deadline
// list is this screen's own, and it is judged against the clock, so it is
// re-read on arrival as well as on mount.
onMounted(() => { void overview.refreshDeadlines(prefs.value.deadlineHorizonDays) })
onActivated(() => { void overview.refreshDeadlines(prefs.value.deadlineHorizonDays, true) })

const d = computed(() => overview.data.value)

/** Anything past a statutory date, whichever register it is in. */
const late = computed(() => {
  const o = d.value
  if (!o) return []
  return [
    {
      key: 'ack', n: num(o.acknowledgements.overdue), icon: Mail,
      label: 'acknowledgement letter', section: 'acknowledgements' as SectionKey,
      rule: 'Two weeks from receipt (target five working days)',
    },
    {
      key: 'ref', n: num(o.refusals.overdue), icon: FileX,
      label: 'refusal letter', section: 'refusals' as SectionKey,
      rule: 'Seven days from the Council resolution',
    },
    {
      key: 'files', n: num(o.movements.files_overdue), icon: FolderInput,
      label: 'paper file', section: 'movements' as SectionKey,
      rule: 'Past the date it was promised back',
    },
  ].filter((row) => row.n > 0)
})

const determinationSoon = computed(() => num(d.value?.acknowledgements.determination_soon))

/** The next few deadlines, as a preview of the board. */
const nextUp = computed(() => overview.deadlines.value.slice(0, 5))

const today = computed(() => {
  const o = d.value
  return {
    received: num(o?.permits.received_today),
    unpaid: num(o?.permits.unpaid),
    corrIn: num(o?.correspondence.in_today),
    corrOut: num(o?.correspondence.out_today),
    inspections: num(o?.inspections.today),
    receipts: num(o?.fees.today_count),
    usd: num(o?.fees.today_usd),
    zwg: num(o?.fees.today_zwg),
    inNotice: num(o?.permits.in_notice),
    approved: num(o?.permits.approved),
    windows: num(o?.certificates.objection_windows_open),
    filesOut: num(o?.movements.files_out),
  }
})

const DESKS: { key: SectionKey; label: string; hint: string; icon: typeof Search }[] = [
  { key: 'search', label: 'Find a file', icon: Search,
    hint: 'Somebody is at the counter asking about theirs' },
  { key: 'receipt', label: 'Take an application', icon: FileInput,
    hint: 'Checklist, fee, acknowledgement — in one pass' },
  { key: 'fees', label: 'Receipt a payment', icon: ReceiptIcon,
    hint: 'Counter cashbook, in either currency' },
  { key: 'correspondence', label: 'Log post', icon: Inbox,
    hint: 'Letters, email, calls and counter visits' },
  { key: 'notices', label: 'File a notice certificate', icon: Megaphone,
    hint: 'Newspaper proof and the neighbours served' },
  { key: 'dispatch', label: 'Issue a permit', icon: Send,
    hint: 'Hand over the instrument, keep the proof' },
  { key: 'public_inspection', label: 'Public inspection', icon: Eye,
    hint: 'Register inspections, copies and searches' },
  { key: 'register', label: 'Development Register', icon: BookOpen,
    hint: 'Every application the council holds' },
]

const asOf = computed(() => formatWhen(d.value?.as_of))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Front counter</span>
        <h2 class="ins-title">Today at the counter</h2>
        <p class="ins-lede">
          What is late, what came in, and what was taken. Counted in the
          database as of {{ asOf }}.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" variant="ghost" :disabled="overview.loading.value"
                  @click="overview.refresh()">
          <template #icon>
            <RefreshCw :size="14" :class="{ 'ins-spin': overview.loading.value }" />
          </template>
          Refresh
        </UiButton>
      </div>
    </header>

    <p v-if="overview.error.value" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" />
      <span>{{ overview.error.value }}</span>
    </p>

    <div v-else-if="overview.loading.value && !d" class="clk-dash-load" aria-busy="true">
      <span v-for="n in 5" :key="n" class="ins-skel" />
      <span class="ent-sr-only">Reading today’s counters</span>
    </div>

    <template v-else-if="d">
      <!-- ── 1. What is late ──────────────────────────────────────────── -->
      <section v-if="late.length" class="ins-card clk-late">
        <header class="ins-card-head">
          <h3>
            <AlertTriangle :size="15" aria-hidden="true" />
            Past a statutory date
          </h3>
        </header>
        <ul class="ins-rows">
          <li v-for="row in late" :key="row.key" class="ins-row">
            <span class="clk-late-icon">
              <component :is="row.icon" :size="15" aria-hidden="true" />
            </span>
            <div class="ins-row-main">
              <span class="ins-row-title">
                {{ row.n }} {{ row.label }}{{ row.n === 1 ? '' : 's' }} overdue
              </span>
              <span class="ins-row-meta">{{ row.rule }}</span>
            </div>
            <UiButton size="sm" variant="primary" @click="nav.go(row.section)">Work it</UiButton>
          </li>
        </ul>
      </section>

      <p v-else class="ins-banner t-positive" role="status">
        <CheckCircle2 :size="15" aria-hidden="true" />
        <span>
          Nothing is past a statutory date. Every letter is inside its window
          and every file is back or in date.
        </span>
      </p>

      <p v-if="determinationSoon" class="ins-banner t-warning" role="status">
        <Clock :size="15" aria-hidden="true" />
        <span>
          <strong>{{ determinationSoon }} application{{ determinationSoon === 1 ? '' : 's' }}
            within a fortnight of the three-month date.</strong>
          Undetermined by then, they are deemed refused and can be appealed on
          that ground alone.
          <button type="button" class="clk-dash-link" @click="nav.go('deadlines')">
            Open the deadline board
          </button>
        </span>
      </p>

      <!-- ── 2. Today ─────────────────────────────────────────────────── -->
      <section class="ins-kpis" aria-label="Today at the counter">
        <button type="button" class="clk-kpi" @click="nav.go('register')">
          <span class="clk-kpi-label"><FileInput :size="13" aria-hidden="true" /> Received today</span>
          <strong class="clk-kpi-value">{{ today.received }}</strong>
          <span class="clk-kpi-note">{{ today.unpaid }} on the register still unpaid</span>
        </button>

        <button type="button" class="clk-kpi" @click="nav.go('fees')">
          <span class="clk-kpi-label"><ReceiptIcon :size="13" aria-hidden="true" /> Taken today</span>
          <strong class="clk-kpi-value clk-kpi-money">
            {{ formatMoney(today.usd, 'USD') }}
          </strong>
          <span class="clk-kpi-note">
            {{ formatMoney(today.zwg, 'ZWG') }} · {{ today.receipts }} receipt{{ today.receipts === 1 ? '' : 's' }}
          </span>
        </button>

        <button type="button" class="clk-kpi" @click="nav.go('correspondence')">
          <span class="clk-kpi-label"><Inbox :size="13" aria-hidden="true" /> Post today</span>
          <strong class="clk-kpi-value">{{ today.corrIn + today.corrOut }}</strong>
          <span class="clk-kpi-note">{{ today.corrIn }} in · {{ today.corrOut }} out</span>
        </button>

        <button type="button" class="clk-kpi" @click="nav.go('public_inspection')">
          <span class="clk-kpi-label"><Eye :size="13" aria-hidden="true" /> Public inspections</span>
          <strong class="clk-kpi-value">{{ today.inspections }}</strong>
          <span class="clk-kpi-note">Register inspections, copies and searches</span>
        </button>
      </section>

      <div class="clk-dash-split">
        <!-- Next deadlines, as a preview of the board rather than a copy. -->
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>
              <AlarmClock :size="15" aria-hidden="true" />
              Next due
            </h3>
            <UiButton size="sm" variant="ghost" @click="nav.go('deadlines')">
              All deadlines
            </UiButton>
          </header>
          <ul v-if="nextUp.length" class="ins-rows">
            <li v-for="row in nextUp" :key="`${row.kind}:${row.id}`" class="ins-row">
              <div class="ins-row-main">
                <span class="ins-row-title ins-mono">
                  {{ row.tpd_reference || row.reference || '—' }}
                </span>
                <span class="ins-row-meta">{{ row.rule }}</span>
              </div>
              <span class="clk-dash-due" :class="{ late: row.overdue }">
                {{ row.overdue
                   ? `${Math.abs(row.days_left)}d over`
                   : row.days_left === 0 ? 'Today' : `${row.days_left}d` }}
              </span>
            </li>
          </ul>
          <p v-else class="ins-card-body clk-dash-none">
            Nothing due inside {{ prefs.deadlineHorizonDays }} days.
          </p>
        </section>

        <!-- What arrived today, so the clerk can check their own morning. -->
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>
              <FileInput :size="15" aria-hidden="true" />
              Received today
            </h3>
            <UiButton size="sm" variant="ghost" @click="nav.go('receipt')">Receipt desk</UiButton>
          </header>
          <ul v-if="d.received_today_list.length" class="ins-rows">
            <li v-for="p in d.received_today_list" :key="p.id" class="ins-row">
              <div class="ins-row-main">
                <span class="ins-row-title ins-mono">
                  {{ p.tpd_reference || p.dev_register_no || 'Unreferenced' }}
                </span>
                <span class="ins-row-meta">
                  {{ p.applicant_name }} · Stand {{ p.stand_number || '—' }}
                  · {{ asLabel(p.status) }}
                </span>
              </div>
              <UiButton size="sm" variant="secondary" @click="nav.openFile(p.id); nav.go('search')">
                <template #icon><FolderOpen :size="13" /></template>
                Open
              </UiButton>
            </li>
          </ul>
          <p v-else class="ins-card-body clk-dash-none">
            Nothing has come over the counter today yet.
          </p>
        </section>
      </div>

      <!-- Standing state: true all day, acted on rarely, so it reads as a
           line of facts rather than as four more tiles. -->
      <p class="clk-dash-state">
        <span>{{ today.inNotice }} in notice or circulation</span>
        <span>{{ today.windows }} objection period{{ today.windows === 1 ? '' : 's' }} open</span>
        <span>{{ today.approved }} approved permit{{ today.approved === 1 ? '' : 's' }} on the register</span>
        <span>{{ today.filesOut }} paper file{{ today.filesOut === 1 ? '' : 's' }} signed out</span>
      </p>

      <!-- ── 3. The desks ─────────────────────────────────────────────── -->
      <section class="ins-card">
        <header class="ins-card-head">
          <h3>Desks</h3>
        </header>
        <div class="ins-card-body">
          <ul class="clk-desks">
            <li v-for="desk in DESKS" :key="desk.key">
              <button type="button" class="clk-desk" @click="nav.go(desk.key)">
                <component :is="desk.icon" :size="16" aria-hidden="true" />
                <span class="clk-desk-text">
                  <strong>{{ desk.label }}</strong>
                  <small>{{ desk.hint }}</small>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.clk-dash-load { display:flex; flex-direction:column; gap:var(--ent-s3); }
.clk-dash-load .ins-skel:nth-child(even) { width:74%; }

.clk-late { border-color:var(--ent-tone-negative-line); }
.clk-late .ins-card-head { background:var(--ent-tone-negative-bg);
  border-bottom-color:var(--ent-tone-negative-line);
  border-radius:var(--ent-r-md) var(--ent-r-md) 0 0; }
.clk-late .ins-card-head h3 { color:var(--ent-tone-negative-fg); }
.clk-late-icon { display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; flex-shrink:0; border-radius:var(--ent-r);
  color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }

.clk-dash-link { font:inherit; color:var(--ent-accent); background:none; border:0;
  padding:0; margin-left:var(--ent-s1); cursor:pointer; text-decoration:underline; }
.clk-dash-link:focus-visible { outline:none; box-shadow:var(--ent-focus-ring);
  border-radius:var(--ent-r-sm); }

/* KPI tiles are buttons: every number on this screen is a way into the
   section that explains it, and a figure a clerk cannot open is a figure
   they have to go and find by hand. */
.clk-kpi { display:flex; flex-direction:column; gap:var(--ent-s1); text-align:left;
  padding:var(--ent-s3) var(--ent-s4); font-family:var(--ent-font);
  background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); cursor:pointer;
  transition:border-color var(--ent-dur) var(--ent-ease), box-shadow var(--ent-dur) var(--ent-ease); }
.clk-kpi:hover { border-color:var(--ent-accent-line); box-shadow:var(--ent-e2); }
.clk-kpi:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.clk-kpi-label { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; color:var(--ent-text-3); }
.clk-kpi-value { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold);
  line-height:var(--ent-lh-tight); color:var(--ent-text);
  font-variant-numeric:tabular-nums; }
.clk-kpi-money { font-family:var(--ent-font-mono); font-size:var(--ent-fs-xl); }
.clk-kpi-note { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.clk-dash-split { display:grid; grid-template-columns:repeat(auto-fit, minmax(21rem, 1fr));
  gap:var(--ent-s4); align-items:start; }
.clk-dash-none { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.clk-dash-due { flex-shrink:0; font-size:var(--ent-fs-xs);
  font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums;
  color:var(--ent-text-2); }
.clk-dash-due.late { color:var(--ent-danger); }

.clk-dash-state { display:flex; flex-wrap:wrap; gap:var(--ent-s2) var(--ent-s5);
  margin:0; padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-surface-2); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md);
  font-size:var(--ent-fs-xs); color:var(--ent-text-2);
  font-variant-numeric:tabular-nums; }

.clk-desks { list-style:none; margin:0; padding:0; display:grid;
  grid-template-columns:repeat(auto-fit, minmax(15rem, 1fr)); gap:var(--ent-s2); }
.clk-desk { display:flex; align-items:flex-start; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3); font-family:var(--ent-font); text-align:left;
  background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; color:var(--ent-text);
  transition:background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease); }
.clk-desk:hover { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.clk-desk:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.clk-desk > svg { flex-shrink:0; margin-top:1px; color:var(--ent-accent); }
.clk-desk-text { min-width:0; }
.clk-desk-text strong { display:block; font-size:var(--ent-fs-sm);
  font-weight:var(--ent-fw-semibold); }
.clk-desk-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs);
  color:var(--ent-text-3); line-height:var(--ent-lh); }

@media (max-width: 767px) {
  .clk-kpi-value { font-size:var(--ent-fs-xl); }
  .clk-kpi-money { font-size:var(--ent-fs-lg); }
}
</style>
