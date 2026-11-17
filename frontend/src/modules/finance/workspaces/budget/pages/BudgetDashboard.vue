<script setup lang="ts">
/**
 * The budget officer's dashboard, from `GET /finance/budgeting/dashboard` for the year chosen in
 * the banner. Spending lines only, approved or published. Figures are shown in the year's
 * reporting currency; the other currency is listed beneath and never added to it (decision D4).
 * Chart bar heights are drawn from the server's figures; no total is computed here.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Calculator, Coins, HandHeart, ChartPie, ChartColumn, Bell, CircleAlert, TriangleAlert, Info,
  ChevronRight, ArrowRight, Scale, Zap, CirclePlus, ArrowLeftRight, ClipboardPen, SlidersHorizontal,
  CalendarDays, Layers, FilePen, Hourglass, Undo2, BadgeCheck, AlertTriangle,
} from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { reportingFirst, useBudget } from '../useBudget'

const store = useFinanceStore()
const { state, loadDashboard } = useBudget()

const d = computed(() => state.data)
const reporting = computed<Currency>(() => d.value?.year.reporting_currency ?? 'USD')
const totals = computed(() => reportingFirst(d.value?.totals, reporting.value))
const main = computed(() => totals.value[0] ?? null)
const ccy = computed<Currency>(() => main.value?.currency ?? reporting.value)
const money = (v: string | null | undefined, c: Currency = ccy.value) => formatMoney(v, c)
const bare = (v: string | null | undefined) => formatMoney(v, null, { bare: true })
const pct = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)

// ── Budget vs actual by programme (reporting currency) ───────────────────────────────────────
const programmes = computed(() => (d.value?.programmes ?? []).filter((p) => p.currency === ccy.value))
const otherProgrammeCurrencies = computed(() => [...new Set((d.value?.programmes ?? []).map((p) => p.currency))].filter((c) => c !== ccy.value))
const chartMax = computed(() => {
  const top = Math.max(1, ...programmes.value.flatMap((p) => [Number(p.budget), Number(p.actual)]))
  const step = 10 ** Math.floor(Math.log10(top))
  return Math.ceil(top / step) * step
})
const ticks = computed(() => [0, 1, 2, 3, 4, 5].map((i) => (chartMax.value / 5) * i))
const H = 150
const barH = (v: string) => (Number(v) / chartMax.value) * H
const tickLabel = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })}m` : v >= 1e3 ? `${(v / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 0 })}k` : String(v))
const shortName = (n: string) => n.replace(/\s*\(demo\)\s*$/i, '')
/** A programme name on two lines of at most ~13 characters, so neighbouring labels never meet. */
function labelLines(n: string): [string, string] {
  const words = shortName(n).split(' ')
  let first = ''
  while (words.length && (first + ' ' + words[0]).trim().length <= 13) first = `${first} ${words.shift()}`.trim()
  if (!first) first = words.shift() ?? ''
  const rest = words.join(' ')
  return [first, rest.length > 14 ? `${rest.slice(0, 13)}…` : rest]
}

// ── Donut: spent, committed, available ───────────────────────────────────────────────────────
const R = 62
const C = 2 * Math.PI * R
const segments = computed(() => {
  const m = main.value
  if (!m) return []
  const parts = [
    { label: 'Expenditure', value: Number(m.actual_pct ?? 0), shown: m.actual_pct, colour: '#1e9e4a' },
    { label: 'Committed', value: Number(m.committed_pct ?? 0), shown: m.committed_pct, colour: '#7ba6dd' },
    { label: 'Available', value: Math.max(0, Number(m.available_pct ?? 0)), shown: m.available_pct, colour: '#d6dce4' },
  ]
  let offset = 0
  return parts.map((p) => {
    const len = (Math.min(100, p.value) / 100) * C
    const seg = { ...p, dash: `${len} ${C - len}`, offset: -offset }
    offset += len
    return seg
  })
})

// ── Votes ────────────────────────────────────────────────────────────────────────────────────
const votes = computed(() => (d.value?.departments ?? []).filter((x) => x.currency === ccy.value))
const top5 = computed(() => votes.value.slice(0, 5))
const variance = computed(() => [...votes.value].sort((a, b) => Number(a.variance_pct ?? 0) - Number(b.variance_pct ?? 0)).slice(0, 5))
const utilTone = (u: string | null) => {
  const n = Number(u ?? 0)
  if (n > 100) return 'is-over'
  if (n >= 75) return 'is-good'
  return 'is-mid'
}

const ALERT_ROUTE: Record<string, string> = {
  monitoring: 'bud-monitoring', virements: 'bud-virements', approval: 'bud-approval',
  commitments: 'bud-commitments', projects: 'bud-projects', planning: 'bud-planning',
}
const QUICK = [
  { label: 'New Budget Line', icon: CirclePlus, to: { name: 'bud-planning' } },
  { label: 'Revision or Virement', icon: ArrowLeftRight, to: { name: 'bud-virements' } },
  { label: 'Approval Status', icon: ClipboardPen, to: { name: 'bud-approval' } },
  { label: 'Explain Variances', icon: SlidersHorizontal, to: { name: 'bud-variance' } },
  { label: 'Council Pack', icon: ChartColumn, to: { name: 'bud-submission' } },
]
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="loadDashboard(store.selectedYearId)">Retry</button></p>

  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <!-- ── Figures ──────────────────────────────────────────────────────────────────────── -->
    <div class="cw-tiles bd-tiles">
      <RouterLink :to="{ name: 'bud-planning' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Calculator :size="34" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Approved Budget ({{ d.year.label.split(' (')[0] }})</p>
          <p class="cw-tile-value num">{{ money(main?.budget) }}</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.budget, t.currency) }}</p>
        </div>
      </RouterLink>
      <RouterLink :to="{ name: 'bud-commitments' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><Coins :size="34" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Total Committed</p>
          <p class="cw-tile-value num">{{ money(main?.committed) }}</p>
          <p class="cw-tile-sub is-up">{{ pct(main?.committed_pct) }} of budget</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.committed, t.currency) }} · {{ pct(t.committed_pct) }}</p>
        </div>
      </RouterLink>
      <RouterLink :to="{ name: 'bud-monitoring' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><HandHeart :size="34" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Total Expenditure</p>
          <p class="cw-tile-value num">{{ money(main?.actual) }}</p>
          <p class="cw-tile-sub is-up">{{ pct(main?.actual_pct) }} of budget</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.actual, t.currency) }} · {{ pct(t.actual_pct) }}</p>
        </div>
      </RouterLink>
      <RouterLink :to="{ name: 'bud-monitoring' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><ChartPie :size="34" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Available Budget</p>
          <p class="cw-tile-value num">{{ money(main?.available) }}</p>
          <p class="cw-tile-sub" :class="Number(main?.available_pct ?? 0) < 0 ? 'is-down' : 'is-up'">{{ pct(main?.available_pct) }} remaining</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.available, t.currency) }} · {{ pct(t.available_pct) }}</p>
        </div>
      </RouterLink>
    </div>

    <!-- ── Chart, donut, alerts ─────────────────────────────────────────────────────────── -->
    <div class="bd-row bd-row--1">
      <section class="cw-card" aria-labelledby="bd-ch">
        <div class="cw-card-head">
          <h3 id="bd-ch"><ChartColumn :size="26" class="cw-head-icon" aria-hidden="true" /> Budget vs Actual by Programme</h3>
          <span class="cw-spacer" />
          <span class="bd-legend"><i style="background: #1f5aa8" />Budget <i style="background: #1e9e4a" />Actual (YTD)</span>
        </div>
        <div class="cw-card-body">
          <p v-if="!programmes.length" class="cw-empty">No approved spending lines in {{ ccy }}.</p>
          <svg v-else class="bd-chart" :viewBox="`0 0 ${70 + programmes.length * 96} ${H + 52}`" role="img"
            :aria-label="`Budget and actual spending by programme, ${ccy}`">
            <g v-for="t in ticks" :key="t">
              <line :x1="58" :x2="62 + programmes.length * 96" :y1="H + 6 - (t / chartMax) * H" :y2="H + 6 - (t / chartMax) * H" stroke="#e8edf4" />
              <text :x="52" :y="H + 10 - (t / chartMax) * H" text-anchor="end" font-size="11" fill="#515c6b">{{ tickLabel(t) }}</text>
            </g>
            <g v-for="(p, i) in programmes" :key="p.code" :transform="`translate(${74 + i * 96} 0)`">
              <rect :y="H + 6 - barH(p.budget)" width="30" :height="barH(p.budget)" rx="2" fill="#1f5aa8"><title>{{ shortName(p.name) }} budget {{ money(p.budget) }}</title></rect>
              <rect x="34" :y="H + 6 - barH(p.actual)" width="30" :height="barH(p.actual)" rx="2" fill="#1e9e4a"><title>{{ shortName(p.name) }} actual {{ money(p.actual) }}</title></rect>
              <text x="32" :y="H + 24" text-anchor="middle" font-size="11.5" fill="#1a2430">{{ labelLines(p.name)[0] }}</text>
              <text x="32" :y="H + 38" text-anchor="middle" font-size="11.5" fill="#1a2430">{{ labelLines(p.name)[1] }}</text>
            </g>
          </svg>
          <p v-if="otherProgrammeCurrencies.length" class="cw-hint">{{ otherProgrammeCurrencies.join(', ') }} programmes on Programmes &amp; Votes.</p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="bd-ut">
        <div class="cw-card-head"><h3 id="bd-ut"><ChartPie :size="26" class="cw-head-icon" aria-hidden="true" /> Budget Utilisation (Overall)</h3></div>
        <div class="cw-card-body bd-donut">
          <svg viewBox="0 0 160 160" width="160" height="160" role="img" :aria-label="`${main?.utilised_pct ?? 0} percent utilised`">
            <circle cx="80" cy="80" :r="R" fill="none" stroke="#edf1f6" stroke-width="26" />
            <circle v-for="s in segments" :key="s.label" cx="80" cy="80" :r="R" fill="none" :stroke="s.colour" stroke-width="26"
              :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" transform="rotate(-90 80 80)" />
            <text x="80" y="80" text-anchor="middle" font-size="25" font-weight="800" fill="#1a2430">{{ pct(main?.utilised_pct) }}</text>
            <text x="80" y="100" text-anchor="middle" font-size="13" fill="#515c6b">Utilised</text>
          </svg>
          <dl class="bd-donut-legend">
            <div v-for="s in segments" :key="s.label"><dt><i :style="{ background: s.colour }" />{{ s.label }}</dt><dd>{{ pct(s.shown) }}</dd></div>
          </dl>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="bd-al">
        <div class="cw-card-head">
          <h3 id="bd-al"><Bell :size="26" class="cw-head-icon" aria-hidden="true" /> Alerts &amp; Actions</h3>
          <span class="cw-spacer" />
          <span class="bd-alert-count" :aria-label="`${d.alerts.length} alerts`">{{ d.alerts.length }}</span>
        </div>
        <div class="cw-card-body">
          <p v-if="!d.alerts.length" class="cw-empty">Nothing needs your attention.</p>
          <ul v-else class="bd-alerts">
            <li v-for="(a, i) in d.alerts" :key="i">
              <RouterLink :to="{ name: ALERT_ROUTE[a.key] ?? 'bud-dashboard' }">
                <CircleAlert v-if="a.tone === 'neg'" :size="20" class="bd-neg" aria-hidden="true" />
                <TriangleAlert v-else-if="a.tone === 'warn'" :size="20" class="bd-warn" aria-hidden="true" />
                <Info v-else :size="20" class="bd-info" aria-hidden="true" />
                <span>{{ a.text }}</span><ChevronRight :size="18" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <!-- ── Votes ────────────────────────────────────────────────────────────────────────── -->
    <div class="bd-row bd-row--2">
      <section class="cw-card" aria-labelledby="bd-vt">
        <div class="cw-card-head">
          <h3 id="bd-vt"><Layers :size="26" class="cw-head-icon" aria-hidden="true" /> Budget Performance by Vote (Top 5)</h3>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'bud-programmes' }" class="cw-link">View all votes <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table bd-compact">
            <thead><tr><th>Vote / Department</th><th class="r">Budget ({{ ccy }})</th><th class="r">Actual ({{ ccy }})</th><th class="r">Utilisation</th></tr></thead>
            <tbody>
              <tr v-for="v in top5" :key="v.code">
                <td>{{ v.code }} – {{ shortName(v.name) }}</td><td class="r num">{{ bare(v.budget) }}</td><td class="r num">{{ bare(v.actual) }}</td>
                <td class="r"><span class="bd-pct" :class="utilTone(v.utilisation)">{{ pct(v.utilisation) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="bd-va">
        <div class="cw-card-head">
          <h3 id="bd-va"><Scale :size="26" class="cw-head-icon" aria-hidden="true" /> Budget Variance Analysis</h3>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'bud-monitoring' }" class="cw-link">View All <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table bd-compact">
            <thead><tr><th>Vote / Department</th><th class="r">Budget ({{ ccy }})</th><th class="r">Actual ({{ ccy }})</th><th class="r">Variance ({{ ccy }})</th><th class="r">Variance %</th></tr></thead>
            <tbody>
              <tr v-for="v in variance" :key="v.code">
                <td>{{ shortName(v.name) }}</td><td class="r num">{{ bare(v.budget) }}</td><td class="r num">{{ bare(v.actual) }}</td>
                <td class="r num">{{ v.variance.startsWith('-') ? `(${bare(v.variance.slice(1))})` : bare(v.variance) }}</td>
                <td class="r"><span class="bd-pct" :class="Number(v.variance_pct ?? 0) > 0 ? 'is-over' : 'is-good'">{{ pct(v.variance_pct) }}</span></td>
              </tr>
            </tbody>
          </table>
          <p class="cw-hint" style="margin: 8px 0 0">Variance is actual less budget: a bracketed figure is unspent.</p>
        </div>
      </section>
    </div>

    <!-- ── Actions, calendar, workflow ──────────────────────────────────────────────────── -->
    <div class="bd-row bd-row--3">
      <section class="cw-card" aria-labelledby="bd-qa">
        <div class="cw-card-head"><h3 id="bd-qa"><Zap :size="26" class="cw-head-icon" aria-hidden="true" /> Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="bd-quick">
            <RouterLink v-for="q in QUICK" :key="q.label" :to="q.to" class="cw-action bd-qa">
              <component :is="q.icon" :size="28" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="bd-cal">
        <div class="cw-card-head"><h3 id="bd-cal"><CalendarDays :size="26" class="cw-head-icon" aria-hidden="true" /> Budget Calendar</h3></div>
        <div class="cw-card-body">
          <p v-if="!d.calendar.length" class="cw-empty">No dates ahead in this year.</p>
          <ul v-else class="bd-cal">
            <li v-for="c in d.calendar" :key="c.date + c.text"><span class="bd-date">{{ dayMonth(c.date) }}</span><span class="bd-grow">{{ c.text }}</span>
              <span v-if="c.days_left !== null" class="cw-hint">{{ c.days_left === 0 ? 'today' : `in ${c.days_left} day${c.days_left === 1 ? '' : 's'}` }}</span></li>
          </ul>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="bd-wf">
        <div class="cw-card-head"><h3 id="bd-wf"><Layers :size="26" class="cw-head-icon" aria-hidden="true" /> Budget Workflow Summary</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'bud-preparation' }" class="cw-link">By vote <ArrowRight :size="16" aria-hidden="true" /></RouterLink></div>
        <div class="cw-card-body bd-flow">
          <RouterLink :to="{ name: 'bud-approval', query: { status: 'draft' } }" class="bd-flow-tile is-draft"><FilePen :size="24" aria-hidden="true" /><strong>{{ d.workflow.draft }}</strong><span>Draft Budgets</span></RouterLink>
          <RouterLink :to="{ name: 'bud-approval', query: { status: 'submitted' } }" class="bd-flow-tile is-pending"><Hourglass :size="24" aria-hidden="true" /><strong>{{ d.workflow.submitted }}</strong><span>Pending Approval</span></RouterLink>
          <RouterLink :to="{ name: 'bud-approval', query: { status: 'returned' } }" class="bd-flow-tile is-returned"><Undo2 :size="24" aria-hidden="true" /><strong>{{ d.workflow.returned }}</strong><span>Returned for Revision</span></RouterLink>
          <RouterLink :to="{ name: 'bud-approval', query: { status: 'approved' } }" class="bd-flow-tile is-approved"><BadgeCheck :size="24" aria-hidden="true" /><strong>{{ d.workflow.approved }}</strong><span>Approved</span></RouterLink>
        </div>
      </section>
    </div>
  </template>
</template>

<style scoped>
.bd-tiles .cw-tile { min-height: 116px; padding: 18px 16px; }
.bd-tiles .cw-tile-value { font-size: 21px; white-space: nowrap; }
.bd-tiles .cw-tile > div { min-width: 0; }
.bd-row { display: grid; gap: 16px; align-items: stretch; }
.bd-row--1 { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.05fr); }
.bd-row--2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); }
.bd-row--3 { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1.3fr); }
.bd-row .cw-card-head h3 { font-size: 15.5px; }
.bd-legend { white-space: nowrap; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
.bd-legend i, .bd-donut-legend i { display: inline-block; width: 13px; height: 13px; border-radius: 3px; }
.bd-legend i + * { margin-right: 4px; }
.bd-chart { width: 100%; height: auto; max-height: 240px; }
.bd-donut { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; }
.bd-donut-legend { margin: 0; flex: 1; min-width: 150px; }
.bd-donut-legend > div { display: flex; justify-content: space-between; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--cw-line); font-size: 15px; }
.bd-donut-legend dt { display: flex; align-items: center; gap: 8px; }
.bd-donut-legend i { border-radius: 50%; }
.bd-donut-legend dd { margin: 0; font-weight: 700; }
.bd-alert-count { min-width: 30px; height: 30px; border-radius: 15px; background: #e53935; color: #fff; display: grid; place-items: center; font-weight: 700; }
.bd-alerts { list-style: none; margin: 0; padding: 0; }
.bd-alerts a { display: flex; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--cw-line); color: inherit; text-decoration: none; font-size: 15px; }
.bd-alerts a:hover { background: var(--cw-accent-softer); }
.bd-alerts span { flex: 1; }
.bd-neg { color: #d32f2f; flex: none; }
.bd-warn { color: #ef8a17; flex: none; }
.bd-info { color: #1b5fae; flex: none; }
.bd-compact { font-size: 14.5px; }
.bd-compact td, .bd-compact thead th { padding: 8px 10px; white-space: nowrap; }
.bd-pct { display: inline-block; min-width: 64px; padding: 3px 8px; border-radius: 7px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-pct.is-good { background: var(--cw-pos-soft); color: var(--cw-pos); }
.bd-pct.is-mid { background: #fff4cf; color: #8a6100; }
.bd-pct.is-over { background: var(--cw-neg-soft); color: var(--cw-neg); }
.bd-quick { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.bd-qa { min-height: 68px; font-size: 12.5px; gap: 6px; background: #fff; }
.bd-cal { list-style: none; margin: 0; padding: 0; }
.bd-grow { flex: 1; }
.bd-cal li { display: flex; align-items: center; gap: 14px; padding: 8px 2px; border-bottom: 1px solid var(--cw-line); font-size: 15px; }
.bd-date { min-width: 74px; padding: 4px 10px; border-radius: 7px; background: #e8f0f9; color: var(--cw-accent-ink); font-weight: 700; text-align: center; white-space: nowrap; }
.bd-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.bd-flow-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 104px; padding: 10px 4px; border-radius: 12px; border: 1px solid var(--cw-line); color: var(--cw-ink); text-decoration: none; text-align: center; font-size: 13.5px; }
.bd-flow-tile strong { font-size: 21px; line-height: 1.1; }
.bd-flow-tile.is-draft { background: #f2f4f7; } .bd-flow-tile.is-draft svg { color: #5a6472; }
.bd-flow-tile.is-pending { background: #fdf3e0; } .bd-flow-tile.is-pending svg, .bd-flow-tile.is-pending strong { color: #c27a00; }
.bd-flow-tile.is-returned { background: #fdeaea; } .bd-flow-tile.is-returned svg, .bd-flow-tile.is-returned strong { color: #d32f2f; }
.bd-flow-tile.is-approved { background: #e7f6ec; } .bd-flow-tile.is-approved svg, .bd-flow-tile.is-approved strong { color: #19803f; }
@media (max-width: 1400px) {
  .bd-row--1, .bd-row--3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .bd-row--1 > :first-child, .bd-row--3 > :first-child { grid-column: 1 / -1; }
  .bd-row--2 { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .bd-row--1, .bd-row--3 { grid-template-columns: minmax(0, 1fr); }
  .bd-quick { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .bd-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
