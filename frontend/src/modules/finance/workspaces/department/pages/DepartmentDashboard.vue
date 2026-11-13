<script setup lang="ts">
/**
 * A head of department's dashboard (`GET /finance/dashboards/department`, scoped by the server to
 * their department): budget, spent, committed and available, utilisation, the biggest items of
 * spending, their tasks, and budget against actual month by month (`GET /finance/overview/series`).
 * Spending lines only; reporting currency first, the other currency beneath and never added in.
 */
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Wallet, Banknote, ClipboardList, ChartColumnBig, ChartPie, ListOrdered, ListTodo, ChartColumn, ChevronRight, AlertTriangle, Info, CircleDot } from 'lucide-vue-next'
import DonutChart from '../../shared/DonutChart.vue'
import BarChart from '../../shared/BarChart.vue'
import { byCurrency, pctText } from '../../shared/useDashboard'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { departmentDash, loadMonthly, monthly } from '../dashboard'

const store = useFinanceStore()
const { state, load } = departmentDash
const d = computed(() => state.data)
const ccy = computed<Currency>(() => d.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency = ccy.value) => formatMoney(v, c)
const totals = computed(() => byCurrency(d.value?.totals, ccy.value))
const main = computed(() => totals.value[0] ?? null)
const mc = computed<Currency>(() => main.value?.currency ?? ccy.value)
const deptNames = computed(() => (d.value?.departments ?? []).map((x) => x.name.replace(/\s*\(demo\)\s*$/i, '')).join(', '))

watch(() => [d.value?.year.id, d.value?.unscoped] as const, ([id, unscoped]) => { if (!unscoped) void loadMonthly(id) }, { immediate: true })

const segments = computed(() => {
  const m = main.value
  if (!m) return []
  return [
    { label: 'Spent', value: Number(m.actual_pct ?? 0), shown: pctText(m.actual_pct), colour: '#2e9e44' },
    { label: 'Committed', value: Number(m.committed_pct ?? 0), shown: pctText(m.committed_pct), colour: '#1b6fd1' },
    { label: 'Available', value: Math.max(0, Number(m.available_pct ?? 0)), shown: pctText(m.available_pct), colour: '#d6dce4' },
  ]
})
const top = computed(() => (d.value?.top_items ?? []).filter((t) => t.currency === mc.value).slice(0, 4))

// The last five months up to this one. The series' budget is the annual budget in force at each
// period end (not a monthly slice), so it is drawn against spending to date, like with like.
const series = computed(() => monthly.value?.series.find((s) => s.currency === mc.value && s.account_kind === 'expenditure')?.points ?? [])
const recent = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  const upto = series.value.filter((p) => p.from_date <= today)
  return upto.slice(-5)
})
const months = computed(() => recent.value.map((p) => new Date(`${p.from_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })))

const TASK_ROUTE: Record<string, string> = { budget: 'dep-budget', commitments: 'dep-commitments', expenditure: 'dep-expenditure', revisions: 'dep-revisions' }
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load(store.selectedYearId)">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <div v-else-if="d?.unscoped" class="cw-banner-msg cw-banner-msg--warn" role="status">
    <Info :size="18" aria-hidden="true" />
    <span>No department is recorded against your account yet, so there are no votes to show. The finance administrator records which department you head; until then this workspace shows nothing rather than the whole council.</span>
  </div>

  <template v-else-if="d">
    <p v-if="deptNames" class="cw-hint" style="margin: 0">Showing {{ deptNames }}.</p>
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'dep-budget' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Wallet :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Department Budget</p><p class="cw-tile-value num">{{ money(main?.budget ?? '0', mc) }}</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.budget, t.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'dep-expenditure' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><Banknote :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Spent (YTD)</p><p class="cw-tile-value num">{{ money(main?.actual ?? '0', mc) }}</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.actual, t.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'dep-commitments' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><ClipboardList :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Committed</p><p class="cw-tile-value num">{{ money(main?.committed ?? '0', mc) }}</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.committed, t.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'dep-expenditure' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><ChartColumnBig :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Available</p><p class="cw-tile-value num" :class="{ 'cw-neg': String(main?.available ?? '').startsWith('-') }">{{ money(main?.available ?? '0', mc) }}</p>
          <p v-for="t in totals.slice(1)" :key="t.currency" class="cw-tile-value-2 num">{{ money(t.available, t.currency) }}</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="dp-ut">
        <div class="cw-card-head"><h3 id="dp-ut"><ChartPie :size="24" class="cw-head-icon" aria-hidden="true" /> Budget Utilisation</h3></div>
        <div class="cw-card-body">
          <p v-if="!main" class="cw-empty">No approved spending lines in this year.</p>
          <DonutChart v-else :segments="segments" :centre="pctText(main.utilised_pct)" sub="Utilised" :label="`${pctText(main.utilised_pct)} of the department budget spent or committed`" />
        </div>
      </section>
      <section class="cw-card" aria-labelledby="dp-top">
        <div class="cw-card-head"><h3 id="dp-top"><ListOrdered :size="24" class="cw-head-icon" aria-hidden="true" /> Top Expenditure Items</h3></div>
        <div class="cw-card-body">
          <p v-if="!top.length" class="cw-empty">Nothing spent yet in {{ mc }}.</p>
          <ul v-else class="dx-list">
            <li v-for="t in top" :key="t.budget_line_id"><RouterLink :to="{ name: 'dep-expenditure' }" class="dx-item">
              <CircleDot :size="16" class="dx-accent" aria-hidden="true" /><span class="dx-grow">{{ t.description }} <span class="cw-hint">{{ t.code }}</span></span>
              <span class="dx-val">{{ money(t.actual, t.currency) }}</span></RouterLink></li>
          </ul>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="dp-tk">
        <div class="cw-card-head"><h3 id="dp-tk"><ListTodo :size="24" class="cw-head-icon" aria-hidden="true" /> My Approvals &amp; Tasks</h3></div>
        <div class="cw-card-body">
          <ul class="dx-list">
            <li v-for="(t, i) in d.tasks" :key="i"><RouterLink :to="{ name: TASK_ROUTE[t.key] ?? 'dep-dashboard', query: t.query }" class="dx-item">
              <CircleDot :size="16" :class="t.n ? 'dx-warn' : 'dx-ok'" aria-hidden="true" /><span class="dx-grow">{{ t.text }}</span>
              <span class="dx-count" :class="{ 'is-zero': !t.n }">{{ t.n }}</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="dp-bva">
        <div class="cw-card-head"><h3 id="dp-bva"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Budget vs Actual (Monthly, {{ mc }})</h3></div>
        <div class="cw-card-body">
          <p v-if="!recent.length" class="cw-empty">The monthly series could not be read.</p>
          <BarChart v-else :labels="months" :unit="mc" :series="[
            { name: 'Budget in force', colour: '#1f5aa8', values: recent.map((p) => Number(p.budget)) },
            { name: 'Spent to date', colour: '#2e9e44', values: recent.map((p) => Number(p.cumulative_actual)) },
          ]" :label="`Annual budget in force and spending to date at each month end, ${mc}`" />
          <p v-if="recent.length" class="dx-note">At each month end: the year's budget then in force, and everything spent since the year began.</p>
        </div>
      </section>
    </div>
  </template>
</template>
