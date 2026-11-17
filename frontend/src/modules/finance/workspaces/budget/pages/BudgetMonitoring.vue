<script setup lang="ts">
/**
 * Budget against actual, line by line, from `GET /finance/budget-lines` (finance.v_budget_line_performance)
 * and the advisory exceptions (`GET /finance/exceptions/budget`).
 *
 * One page, two readings, chosen by route meta `bmKind`:
 *   expenditure  spending lines: original, revised, spent, committed, available, % spent
 *   revenue      revenue estimates: original, revised estimate, collected, still to collect, % collected
 *
 * Every figure is the server's (NUMERIC in Postgres); nothing is added up here. Original and revised
 * are always shown together (specification §3.3). "Available" says which definition the council's
 * settings use, because the API states it. A departmentally scoped person sees only their votes:
 * the server applies the scope to every read on this page.
 *
 * Route meta `bmTitle` / `bmLead` let another workspace (Department Finance) open the same page
 * under its own heading.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChartLine, Landmark, Search, X, AlertTriangle, Info } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { BudgetLinePerformance } from '../../../models/types'

/** The budget-line read also carries the account's class (finance-budget.js joins it). */
export type MonitoredLine = BudgetLinePerformance & { expenditure_class?: 'recurrent' | 'capital' | null; revenue_class?: string | null }

const PAGE = 500
/** Four pages (2,000 lines) is far beyond a district council's budget; past it the page says so. */
const MAX_PAGES = 4

const route = useRoute()
const store = useFinanceStore()
const kind = computed<'expenditure' | 'revenue'>(() => (route.meta.bmKind === 'revenue' ? 'revenue' : 'expenditure'))
const revenue = computed(() => kind.value === 'revenue')
const title = computed(() => String(route.meta.bmTitle ?? (revenue.value ? 'Revenue Estimates' : 'Budget Monitoring')))
const lead = computed(() => String(route.meta.bmLead ?? (revenue.value
  ? 'Each revenue line\'s estimate against what has been collected so far.'
  : 'Every spending line against its budget: spent, committed and still available.')))

const rows = ref<MonitoredLine[]>([])
const total = ref(0)
const includesCommitments = ref(false)
const flags = ref<Map<string, string>>(new Map())
const thresholds = ref<{ warn_execution_percentage: number; flag_execution_percentage: number } | null>(null)
const q = ref('')
const department = ref('')
const lineClass = ref<'' | 'recurrent' | 'capital'>('')
const onlyFlagged = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  const year = store.selectedYearId
  if (!year) { rows.value = []; total.value = 0; return }
  loading.value = true
  error.value = null
  try {
    const base = {
      financial_year_id: year, kind: kind.value, limit: PAGE, sort: 'execution' as const, direction: 'desc' as const,
      ...(q.value.trim() ? { q: q.value.trim() } : {}), ...(department.value ? { department_id: department.value } : {}),
    }
    const [first, exceptions] = await Promise.all([
      financeApi.budgetLines({ ...base, offset: 0 }),
      revenue.value ? Promise.resolve(null) : financeApi.budgetExceptions(year),
    ])
    const all = [...first.lines] as MonitoredLine[]
    for (let page = 1; page < MAX_PAGES && all.length < first.total; page++) {
      const next = await financeApi.budgetLines({ ...base, offset: page * PAGE })
      if (!next.lines.length) break
      all.push(...(next.lines as MonitoredLine[]))
    }
    rows.value = all
    total.value = first.total
    includesCommitments.value = first.available_balance_includes_commitments
    flags.value = new Map((exceptions?.rows ?? []).map((r) => [r.budget_line_id, r.flag]))
    thresholds.value = exceptions?.thresholds ?? null
  } catch (err) {
    error.value = messageOf(err, 'The budget lines could not be read.')
  } finally {
    loading.value = false
  }
}
watch([() => store.selectedYearId, kind, department], load)
onMounted(load)

const shown = computed(() => rows.value
  .filter((r) => !lineClass.value || r.expenditure_class === lineClass.value)
  .filter((r) => !onlyFlagged.value || flags.value.has(r.budget_line_id)))
const truncated = computed(() => total.value > rows.value.length)

const tone = (r: MonitoredLine): string => {
  const n = Number(r.execution_percentage ?? 0)
  if (revenue.value) return n >= 100 ? 'is-good' : n >= 50 ? 'is-mid' : 'is-low'
  if (thresholds.value && n >= thresholds.value.flag_execution_percentage) return 'is-over'
  if (thresholds.value && n >= thresholds.value.warn_execution_percentage) return 'is-mid'
  return 'is-good'
}
const FLAG: Record<string, string> = {
  over_budget: 'Over budget', nearly_exhausted: 'Nearly exhausted', currency_mismatch: 'Currency fault', spend_without_budget: 'Spending without a budget',
}
const CLASS: Record<string, string> = { recurrent: 'Recurrent', capital: 'Capital' }
const pillTone = (s: string) => (s === 'approved' || s === 'published' ? 'cw-pill--pos' : s === 'returned' ? 'cw-pill--neg' : s === 'submitted' ? 'cw-pill--info' : 'cw-pill--mute')
const isNeg = (v: string | null | undefined) => String(v ?? '').startsWith('-')
/** For revenue, the view's available (revised less actual) is what is still to collect. */
const available = (r: MonitoredLine) => (includesCommitments.value && !revenue.value ? r.available_including_commitments : r.available_excluding_commitments)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="revenue ? Landmark : ChartLine" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ title }}</h2>
      <p>{{ lead }} {{ store.selectedYear?.label ?? '' }}</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-body bm-filters" style="padding-top: 18px">
      <form class="cw-search" role="search" style="flex: 1 1 280px; max-width: 460px" @submit.prevent="load">
        <Search :size="22" aria-hidden="true" />
        <input v-model="q" class="cw-input" placeholder="Line code or description" aria-label="Search budget lines" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear the search" @click="q = ''; load()"><X :size="20" /></button>
      </form>
      <label class="bm-field"><span class="cw-label">Vote</span>
        <select v-model="department" class="cw-select" aria-label="Vote (department)">
          <option value="">Every vote</option>
          <option v-for="dpt in store.departments" :key="dpt.id" :value="dpt.id">{{ dpt.code }} {{ dpt.name }}</option>
        </select>
      </label>
      <label v-if="!revenue" class="bm-field"><span class="cw-label">Class</span>
        <select v-model="lineClass" class="cw-select" aria-label="Recurrent or capital">
          <option value="">Recurrent and capital</option><option value="recurrent">Recurrent</option><option value="capital">Capital</option>
        </select>
      </label>
      <label v-if="!revenue" class="bm-check"><input v-model="onlyFlagged" type="checkbox" class="cw-check" /> Only lines flagged over or near their limit</label>
    </div>
    <div class="cw-card-body">
      <p class="cw-hint bm-basis"><Info :size="16" aria-hidden="true" />
        <template v-if="revenue">Still to collect is the revised estimate less what has been collected. % collected is collected over the revised estimate.</template>
        <template v-else>Available is the revised budget less spending{{ includesCommitments ? ' and open commitments' : '' }}, as the council's finance settings define it.
          <template v-if="thresholds"> Lines are flagged at {{ thresholds.warn_execution_percentage }}% and {{ thresholds.flag_execution_percentage }}% spent.</template></template>
      </p>
      <p v-if="truncated" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />
        Showing the first {{ rows.length }} of {{ total }} lines. Narrow by vote or search to see the rest.</p>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!shown.length" class="cw-empty">{{ revenue ? 'No revenue lines match.' : 'No spending lines match.' }}</p>
      <table v-else class="cw-table bm-table">
        <caption class="sr-only">{{ title }}, {{ shown.length }} lines</caption>
        <thead>
          <tr v-if="revenue"><th scope="col">Line</th><th scope="col">Status</th><th scope="col" class="r">Original estimate</th><th scope="col" class="r">Revised estimate</th>
            <th scope="col" class="r">Collected</th><th scope="col" class="r">Still to collect</th><th scope="col" class="r">% collected</th></tr>
          <tr v-else><th scope="col">Line</th><th scope="col">Status</th><th scope="col" class="r">Original</th><th scope="col" class="r">Revised</th><th scope="col" class="r">Spent</th>
            <th scope="col" class="r">Committed</th><th scope="col" class="r">Available</th><th scope="col" class="r">% spent</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.budget_line_id">
            <td><strong>{{ r.code }}</strong> {{ r.description }}
              <div class="cw-hint">{{ [r.department_name, r.programme_name, r.expenditure_class ? CLASS[r.expenditure_class] : r.revenue_class].filter(Boolean).join(' · ') }}</div></td>
            <td><span class="cw-pill" :class="pillTone(r.status)">{{ r.status }}</span></td>
            <td class="r num">{{ formatMoney(r.original_amount, r.currency) }}</td>
            <td class="amt">{{ formatMoney(r.revised_amount, r.currency) }}</td>
            <td class="r num">{{ formatMoney(r.actual_amount, r.currency) }}</td>
            <td v-if="!revenue" class="r num">{{ formatMoney(r.open_commitments, r.currency) }}</td>
            <td class="r num" :class="{ 'cw-neg': !revenue && isNeg(available(r)) }">{{ formatMoney(available(r), r.currency) }}</td>
            <td class="r">
              <span class="bm-pct" :class="tone(r)">{{ r.execution_percentage === null ? '—' : `${r.execution_percentage}%` }}</span>
              <div v-if="flags.get(r.budget_line_id)" class="cw-hint">{{ FLAG[flags.get(r.budget_line_id)!] ?? flags.get(r.budget_line_id) }}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.bm-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; }
.bm-field { display: flex; flex-direction: column; gap: 4px; min-width: 180px; }
.bm-check { display: flex; align-items: center; gap: 8px; font-size: 15px; min-height: 40px; }
.bm-basis { display: flex; gap: 8px; align-items: flex-start; margin: 0; }
.bm-table td { white-space: nowrap; }
.bm-table td:first-child { white-space: normal; min-width: 260px; }
.bm-pct { display: inline-block; min-width: 64px; padding: 3px 8px; border-radius: 7px; text-align: center; font-weight: 700; }
.bm-pct.is-good { background: var(--cw-pos-soft); color: var(--cw-pos); }
.bm-pct.is-mid { background: #fff4cf; color: #8a6100; }
.bm-pct.is-low { background: #eef1f5; color: var(--cw-ink-2); }
.bm-pct.is-over { background: var(--cw-neg-soft); color: var(--cw-neg); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
