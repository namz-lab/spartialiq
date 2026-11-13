<script setup lang="ts">
/**
 * The department's spending month by month: the annual budget in force at each month end, what was
 * spent and committed in the month, and spending to date, per currency, from `GET /finance/overview/series` (scoped by the server to the department).
 */
import { computed, onMounted, watch } from 'vue'
import { Gauge, Info } from 'lucide-vue-next'
import BarChart from '../../shared/BarChart.vue'
import { formatMoney } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { departmentDash, loadMonthly, monthly } from '../dashboard'

const store = useFinanceStore()
const unscoped = computed(() => departmentDash.state.data?.unscoped)
const spend = computed(() => (monthly.value?.series ?? []).filter((s) => s.account_kind === 'expenditure'))
const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
onMounted(() => { if (!unscoped.value) void loadMonthly(store.selectedYearId ?? undefined) })
watch(() => store.selectedYearId, (id) => { if (!unscoped.value) void loadMonthly(id ?? undefined) })
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Gauge :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Performance (KPIs)</h2><p>The department's spending against its budget, month by month.</p></div>
  </section>
  <p v-if="unscoped" class="cw-banner-msg cw-banner-msg--warn"><Info :size="18" aria-hidden="true" />No department is recorded against your account yet.</p>
  <p v-else-if="!spend.length" class="cw-empty">No spending series for this year.</p>
  <section v-for="s in spend" :key="s.currency" class="cw-card">
    <div class="cw-card-head"><h3>{{ s.currency }}</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <BarChart :labels="s.points.map((p) => label(p.from_date))" :unit="s.currency" :series="[
        { name: 'Budget in force', colour: '#1f5aa8', values: s.points.map((p) => Number(p.budget)) },
        { name: 'Spent to date', colour: '#2e9e44', values: s.points.map((p) => Number(p.cumulative_actual)) },
      ]" :label="`Annual budget in force and spending to date at each month end, ${s.currency}`" />
      <table class="cw-table dx-compact" style="margin-top: 12px">
        <thead><tr><th>Month</th><th class="r">Budget in force</th><th class="r">Spent in month</th><th class="r">Committed in month</th><th class="r">Spent to date</th></tr></thead>
        <tbody><tr v-for="p in s.points" :key="p.period_key"><td>{{ label(p.from_date) }}</td><td class="r num">{{ formatMoney(p.budget, s.currency) }}</td>
          <td class="r num">{{ formatMoney(p.actual, s.currency) }}</td><td class="r num">{{ formatMoney(p.commitments, s.currency) }}</td>
          <td class="r num">{{ formatMoney(p.cumulative_actual, s.currency) }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>
