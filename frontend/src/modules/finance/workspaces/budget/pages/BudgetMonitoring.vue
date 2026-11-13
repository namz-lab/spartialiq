<script setup lang="ts">
/**
 * Every spending line against its budget: revised, spent, committed, available and execution,
 * with the lines the finance settings flag as over or nearly exhausted marked. From
 * `GET /finance/budget-lines` (finance.v_budget_line_performance) and the advisory exceptions.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ChartLine, Search, X, AlertTriangle } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { BudgetLinePerformance } from '../../../models/types'

const store = useFinanceStore()
const rows = ref<BudgetLinePerformance[]>([])
const flags = ref<Map<string, string>>(new Map())
const thresholds = ref<{ warn_execution_percentage: number; flag_execution_percentage: number } | null>(null)
const q = ref('')
const onlyFlagged = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  const year = store.selectedYearId
  if (!year) return
  loading.value = true
  error.value = null
  try {
    const [lines, exceptions] = await Promise.all([
      financeApi.budgetLines({ financial_year_id: year, kind: 'expenditure', limit: 500, sort: 'execution', direction: 'desc', ...(q.value.trim() ? { q: q.value.trim() } : {}) }),
      financeApi.budgetExceptions(year),
    ])
    rows.value = lines.lines
    flags.value = new Map(exceptions.rows.map((r) => [r.budget_line_id, r.flag]))
    thresholds.value = exceptions.thresholds
  } catch (err) {
    error.value = messageOf(err, 'The budget lines could not be read.')
  } finally {
    loading.value = false
  }
}
watch(() => store.selectedYearId, load)
onMounted(load)

const shown = computed(() => (onlyFlagged.value ? rows.value.filter((r) => flags.value.has(r.budget_line_id)) : rows.value))
const tone = (r: BudgetLinePerformance) => {
  const n = Number(r.execution_percentage ?? 0)
  if (thresholds.value && n >= thresholds.value.flag_execution_percentage) return 'is-over'
  if (thresholds.value && n >= thresholds.value.warn_execution_percentage) return 'is-mid'
  return 'is-good'
}
const FLAG: Record<string, string> = { over_budget: 'Over budget', nearly_exhausted: 'Nearly exhausted', currency_mismatch: 'Currency fault' }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ChartLine :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Budget Monitoring</h2>
      <p>Every spending line against its budget for {{ store.selectedYear?.label ?? 'the selected year' }}.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-body bm-filters" style="padding-top: 18px">
      <form class="cw-search" role="search" style="flex: 1 1 300px; max-width: 520px" @submit.prevent="load">
        <Search :size="22" aria-hidden="true" />
        <input v-model="q" class="cw-input" placeholder="Line code or description" aria-label="Search budget lines" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; load()"><X :size="20" /></button>
      </form>
      <label class="bm-check"><input v-model="onlyFlagged" type="checkbox" class="cw-check" /> Only lines flagged over or near their limit</label>
      <span v-if="thresholds" class="cw-hint">Warn at {{ thresholds.warn_execution_percentage }}%, flag at {{ thresholds.flag_execution_percentage }}% (finance settings).</span>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!shown.length" class="cw-empty">No spending lines match.</p>
      <table v-else class="cw-table bm-table">
        <thead><tr><th>Line</th><th>Status</th><th class="r">Revised</th><th class="r">Spent</th><th class="r">Committed</th><th class="r">Available</th><th class="r">Execution</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.budget_line_id">
            <td><strong>{{ r.code }}</strong> {{ r.description }}<div class="cw-hint">{{ [r.department_name, r.programme_name].filter(Boolean).join(' · ') }}</div></td>
            <td><span class="cw-pill" :class="r.status === 'approved' || r.status === 'published' ? 'cw-pill--pos' : r.status === 'returned' ? 'cw-pill--neg' : 'cw-pill--mute'">{{ r.status }}</span></td>
            <td class="amt">{{ formatMoney(r.revised_amount, r.currency) }}</td>
            <td class="r num">{{ formatMoney(r.actual_amount, r.currency) }}</td>
            <td class="r num">{{ formatMoney(r.open_commitments, r.currency) }}</td>
            <td class="r num" :class="{ 'cw-neg': String(r.available_including_commitments).startsWith('-') }">{{ formatMoney(r.available_including_commitments, r.currency) }}</td>
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
.bm-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.bm-check { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.bm-table td { white-space: nowrap; }
.bm-table td:first-child { white-space: normal; min-width: 260px; }
.bm-pct { display: inline-block; min-width: 64px; padding: 3px 8px; border-radius: 7px; text-align: center; font-weight: 700; }
.bm-pct.is-good { background: var(--cw-pos-soft); color: var(--cw-pos); }
.bm-pct.is-mid { background: #fff4cf; color: #8a6100; }
.bm-pct.is-over { background: var(--cw-neg-soft); color: var(--cw-neg); }
</style>
