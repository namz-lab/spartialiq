<script setup lang="ts">
/**
 * The finance officer's dashboard (`GET /finance/dashboards/officer`): payments waiting to be
 * posted, what debtors owe, open journals, the bank balance, this month's money in and out, the
 * officer's work queue and the latest vouchers. Figures in the year's reporting currency first; the
 * other currency is listed beneath and never added to it.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { CreditCard, Users, NotebookPen, Landmark, ChartLine, ListTodo, ArrowLeftRight, ChevronRight, AlertTriangle, CircleDot } from 'lucide-vue-next'
import LineChart from '../../shared/LineChart.vue'
import { byCurrency } from '../../shared/useDashboard'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { officerDash } from '../dashboard'

const store = useFinanceStore()
const { state, load } = officerDash
const d = computed(() => state.data)
const ccy = computed<Currency>(() => d.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency = ccy.value) => formatMoney(v, c)

const payments = computed(() => byCurrency(d.value?.pending_payments, ccy.value))
const debtors = computed(() => byCurrency(d.value?.debtors, ccy.value))
const banks = computed(() => byCurrency(d.value?.banks, ccy.value))
const flowCcy = computed(() => (d.value?.cash_flow.some((r) => r.currency === ccy.value) ? ccy.value : d.value?.cash_flow[0]?.currency ?? ccy.value))
const flow = computed(() => (d.value?.cash_flow ?? []).filter((r) => r.currency === flowCcy.value))
const dayLabels = computed(() => flow.value.map((r) => new Date(`${r.day}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })))

const TASK_ROUTE: Record<string, string> = { journals: 'ofc-journals', reconciliation: 'ofc-reconciliation', receivables: 'ofc-receivables' }
function kind(r: { voucher_type: string; cash_effect: string }): { label: string; cls: string } {
  if (r.voucher_type === 'receipt' || (r.voucher_type !== 'rates_bill' && Number(r.cash_effect) > 0)) return { label: 'Receipt', cls: 'dx-tag--receipt' }
  if (Number(r.cash_effect) < 0) return { label: 'Payment', cls: 'dx-tag--pay' }
  if (r.voucher_type === 'journal') return { label: 'Journal', cls: 'dx-tag--journal' }
  return { label: r.voucher_type.replace('_', ' '), cls: 'dx-tag--other' }
}
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load(store.selectedYearId)">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'ofc-payments' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><CreditCard :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Pending Payments</p>
          <p class="cw-tile-value num">{{ payments.reduce((n, p) => n + p.n, 0) }}</p>
          <p v-for="p in payments" :key="p.currency" class="cw-tile-value-2 num">{{ money(p.amount, p.currency) }}</p>
          <p v-if="!payments.length" class="cw-tile-sub">None waiting to be posted</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'ofc-receivables' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><Users :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Outstanding Debtors</p>
          <p class="cw-tile-value num">{{ debtors[0]?.n ?? 0 }}</p>
          <p v-for="p in debtors" :key="p.currency" class="cw-tile-value-2 num">{{ money(p.amount, p.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'ofc-journals' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><NotebookPen :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Open Journals</p><p class="cw-tile-value num">{{ d.journals.n }}</p>
          <p class="cw-tile-sub">{{ d.journals.mine }} prepared by you</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'ofc-banking' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><Landmark :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Bank Balance</p>
          <p class="cw-tile-value num">{{ money(banks[0]?.balance ?? '0', banks[0]?.currency ?? ccy) }}</p>
          <p v-for="b in banks.slice(1)" :key="b.currency" class="cw-tile-value-2 num">{{ money(b.balance, b.currency) }}</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="of-cf">
        <div class="cw-card-head"><h3 id="of-cf"><ChartLine :size="24" class="cw-head-icon" aria-hidden="true" /> Cash Flow (This Month, {{ flowCcy }})</h3></div>
        <div class="cw-card-body">
          <LineChart :labels="dayLabels" :series="[
            { name: 'Inflow', colour: '#1e9e4a', values: flow.map((r) => Number(r.inflow)) },
            { name: 'Outflow', colour: '#1f5aa8', values: flow.map((r) => Number(r.outflow)) },
          ]" :label="`Money into and out of the banks and tills each day this month, ${flowCcy}`" />
          <p class="dx-note">Posted entries on bank and cash accounts. A counter receipt counts once its cash-up is verified.</p>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="of-tq">
        <div class="cw-card-head"><h3 id="of-tq"><ListTodo :size="24" class="cw-head-icon" aria-hidden="true" /> Task Queue</h3></div>
        <div class="cw-card-body">
          <ul class="dx-list">
            <li v-for="(t, i) in d.tasks" :key="i">
              <RouterLink :to="{ name: TASK_ROUTE[t.key] ?? 'ofc-dashboard' }" class="dx-item">
                <CircleDot :size="18" :class="t.n ? 'dx-warn' : 'dx-ok'" aria-hidden="true" />
                <span class="dx-grow">{{ t.text }}</span><span class="dx-count" :class="{ 'is-zero': !t.n }">{{ t.n }}</span><ChevronRight :size="18" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <section class="cw-card" aria-labelledby="of-rt">
      <div class="cw-card-head"><h3 id="of-rt"><ArrowLeftRight :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Transactions</h3><span class="cw-spacer" />
        <RouterLink :to="{ name: 'ofc-journals' }" class="cw-link">All vouchers</RouterLink></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!d.recent.length" class="cw-empty">No vouchers in this year yet.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Type</th><th>Status</th><th class="r">Amount</th></tr></thead>
          <tbody>
            <tr v-for="r in d.recent" :key="r.id">
              <td>{{ formatDate(r.posting_date) }}</td><td class="num">{{ r.voucher_no }}</td><td class="dx-wrap">{{ r.description || '—' }}</td>
              <td><span class="dx-tag" :class="kind(r).cls">{{ kind(r).label }}</span></td>
              <td><span class="cw-pill" :class="r.status === 'posted' ? 'cw-pill--pos' : r.status === 'draft' ? 'cw-pill--warn' : 'cw-pill--mute'">{{ r.status }}</span></td>
              <td class="r num" :class="{ 'cw-neg': Number(r.cash_effect) < 0 }">{{ Number(r.cash_effect) < 0 ? `(${money(r.amount, r.currency)})` : money(r.amount, r.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>
