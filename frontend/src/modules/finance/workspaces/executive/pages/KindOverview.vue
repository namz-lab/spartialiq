<script setup lang="ts">
/**
 * Revenue Overview / Expenditure Overview: the year's totals for one side of the budget, per
 * currency, and every approved line on that side with its budget, actual and execution
 * (`GET /finance/budget-lines`, finance.v_budget_line_performance).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Coins, Wallet, AlertTriangle } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import type { BudgetLinePerformance } from '../../../models/types'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import { pctText } from '../../shared/useDashboard'
import { executiveDash } from '../dashboard'

const route = useRoute()
const store = useFinanceStore()
const kind = computed(() => route.meta.cwKind as 'revenue' | 'expenditure')
const rows = ref<BudgetLinePerformance[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  const year = store.selectedYearId
  if (!year) return
  loading.value = true
  error.value = null
  try {
    rows.value = (await financeApi.budgetLines({ financial_year_id: year, kind: kind.value, limit: 500, sort: 'execution', direction: 'desc' })).lines
      .filter((l) => l.status === 'approved' || l.status === 'published')
  } catch (err) { error.value = messageOf(err, 'The budget lines could not be read.') } finally { loading.value = false }
}
onMounted(load)
watch([() => store.selectedYearId, kind], load)
const totals = computed(() => (executiveDash.state.data?.totals ?? []).filter((t) => t.account_kind === kind.value))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="kind === 'revenue' ? Coins : Wallet" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ kind === 'revenue' ? 'Revenue Overview' : 'Expenditure Overview' }}</h2>
      <p>{{ kind === 'revenue' ? 'Budgeted income against what has come in' : 'The spending budget against what has been spent' }}, {{ store.selectedYear?.label ?? '' }}.</p>
    </div>
  </section>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <div class="cw-tiles dx-tiles">
    <div v-for="t in totals" :key="t.currency" class="cw-tile" :class="kind === 'revenue' ? 'cw-tile--violet' : 'cw-tile--green'">
      <span class="cw-tile-icon"><component :is="kind === 'revenue' ? Coins : Wallet" :size="30" aria-hidden="true" /></span>
      <div><p class="cw-tile-label">{{ t.currency }} actual of budget</p><p class="cw-tile-value num">{{ formatMoney(t.actual, t.currency) }}</p>
        <p class="cw-tile-sub">of {{ formatMoney(t.budget, t.currency) }} · {{ pctText(t.execution) }}</p></div>
    </div>
  </div>

  <section class="cw-card">
    <div class="cw-card-head"><h3>Approved lines</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!rows.length" class="cw-empty">No approved {{ kind }} lines in this year.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Line</th><th>Department</th><th class="r">Budget</th><th class="r">Actual</th><th class="r">Execution</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.budget_line_id">
            <td class="dx-wrap"><strong>{{ r.code }}</strong> {{ r.description }}</td><td>{{ r.department_name ?? '—' }}</td>
            <td class="r num">{{ formatMoney(r.revised_amount, r.currency) }}</td><td class="r num">{{ formatMoney(r.actual_amount, r.currency) }}</td>
            <td class="r"><span class="dx-pct" :class="Number(r.execution_percentage ?? 0) > 100 ? (kind === 'revenue' ? 'is-good' : 'is-over') : Number(r.execution_percentage ?? 0) >= 75 ? 'is-good' : 'is-mid'">{{ pctText(r.execution_percentage) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
