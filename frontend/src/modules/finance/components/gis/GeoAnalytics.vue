<script setup lang="ts">
/**
 * Geographic financial intelligence: the questions a finance manager asks of the map, answered
 * from `GET /finance/property/analytics`, with the ward table and charts behind each answer.
 * Every figure is a string from SQL; the ranking here only orders them.
 */
import { computed } from 'vue'
import { Trophy, TrendingDown, MapPin, Receipt, PlugZap, Building, Landmark, CircleAlert } from 'lucide-vue-next'
import BarChart from '../../workspaces/shared/BarChart.vue'
import DonutChart from '../../workspaces/shared/DonutChart.vue'
import { formatMoney } from '../../composables/useMoney'
import { STATUS_COLOURS, STATUS_LABELS, type PropertyAnalytics, type PropertyLayers, type FinancialStatus } from '../../api/propertyApi'

const props = defineProps<{ analytics: PropertyAnalytics | null; layers?: PropertyLayers | null; mode?: string }>()
const emit = defineEmits<{ ward: [code: string] }>()

const money = (v: string | number | null | undefined) => formatMoney(v === null || v === undefined ? null : String(v), 'USD', { whole: true })
const wards = computed(() => (props.analytics?.by_ward ?? []).filter((w) => w.ward_code))
/** Two registers can name different wards alike; the code then tells them apart. */
const wardLabel = (w: { ward_name: string | null; ward_code: string | null }) => {
  const same = wards.value.filter((x) => x.ward_name === w.ward_name).length > 1
  return `Ward ${w.ward_name ?? '?'}${same && !String(w.ward_code).startsWith('ZEC23') ? ` (${w.ward_code})` : ''}`
}
const billed = computed(() => wards.value.filter((w) => Number(w.usd_billed) > 0))
const top = <T,>(rows: T[], f: (r: T) => number, dir = -1) => [...rows].sort((a, b) => dir * (f(a) - f(b)))[0]
const mostRevenue = computed(() => top(billed.value, (w) => Number(w.usd_paid)))
const mostDebt = computed(() => top(billed.value, (w) => Number(w.usd_outstanding)))
const lowestRate = computed(() => top(billed.value.filter((w) => w.usd_collection_rate !== null), (w) => Number(w.usd_collection_rate), 1))
const mostOverdue = computed(() => top(billed.value, (w) => w.overdue))
const suburbs = computed(() => (props.analytics?.by_township ?? []).filter((s) => !s.township.startsWith('Rural')))
const suburbDebt = computed(() => top(suburbs.value, (s) => Number(s.usd_outstanding)))
const t = computed(() => props.analytics?.totals)
const usdProjects = computed(() => (props.analytics?.projects_by_ward ?? []).filter((p) => p.currency === 'USD'))
const projectsTotal = computed(() => usdProjects.value.filter((p) => p.ward_code.startsWith('ZEC23') || !['unlocated', 'outside'].includes(p.ward_code)).reduce((s, p) => s + Number(p.approved_budget), 0))
const projectsUnlocated = computed(() => usdProjects.value.filter((p) => p.ward_code === 'unlocated').reduce((s, p) => s + p.projects, 0))
const biggestProject = computed(() => [...(props.layers?.projects.features ?? [])].sort((a, b) => Number(b.properties.approved_budget) - Number(a.properties.approved_budget))[0]?.properties)

const chartWards = computed(() => [...billed.value].sort((a, b) => Number(b.usd_billed) - Number(a.usd_billed)).slice(0, 10))
const statusSegments = computed(() => {
  const by: Partial<Record<FinancialStatus, number>> = {}
  for (const s of props.analytics?.statuses ?? []) if (s.parcel_kind === 'stand' || s.financial_status !== 'no_account') by[s.financial_status] = (by[s.financial_status] ?? 0) + s.n
  return (Object.keys(by) as FinancialStatus[]).filter((k) => k !== 'unallocated' && k !== 'no_account')
    .map((k) => ({ label: STATUS_LABELS[k], value: by[k] ?? 0, shown: String(by[k] ?? 0), colour: STATUS_COLOURS[k] }))
})
const accountsN = computed(() => statusSegments.value.reduce((s, x) => s + x.value, 0))
</script>

<template>
  <div class="ga" :aria-busy="!analytics">
    <div class="ga-qs">
      <article class="ga-q"><Trophy :size="18" aria-hidden="true" class="pos" />
        <div><h4>Which ward generates the most revenue?</h4>
          <p v-if="mostRevenue"><button type="button" class="ga-ward" @click="emit('ward', mostRevenue.ward_code!)">Ward {{ mostRevenue.ward_name }}</button>: {{ money(mostRevenue.usd_paid) }} collected of {{ money(mostRevenue.usd_billed) }} billed.</p><p v-else>—</p></div></article>
      <article class="ga-q"><CircleAlert :size="18" aria-hidden="true" class="neg" />
        <div><h4>Which suburb carries the highest debt?</h4>
          <p v-if="suburbDebt">{{ suburbDebt.township }}: {{ money(suburbDebt.usd_outstanding) }} outstanding across {{ suburbDebt.owing }} propert{{ suburbDebt.owing === 1 ? 'y' : 'ies' }}.</p><p v-else>—</p></div></article>
      <article class="ga-q"><MapPin :size="18" aria-hidden="true" />
        <div><h4>How many allocated stands are not fully paid?</h4>
          <p><strong>{{ t?.allocated_not_paid_up ?? '—' }}</strong> of {{ t?.allocated ?? '—' }} allocated stands.</p></div></article>
      <article class="ga-q"><PlugZap :size="18" aria-hidden="true" class="violet" />
        <div><h4>Which properties have not been billed?</h4>
          <p><strong>{{ (t?.not_billed ?? 0) + (t?.allocated_no_account ?? 0) }}</strong>: {{ t?.allocated_no_account ?? 0 }} allocated with no account, {{ t?.not_billed ?? 0 }} with an account and no bill.</p></div></article>
      <article class="ga-q"><TrendingDown :size="18" aria-hidden="true" class="neg" />
        <div><h4>Which ward has the lowest collection rate?</h4>
          <p v-if="lowestRate"><button type="button" class="ga-ward" @click="emit('ward', lowestRate.ward_code!)">Ward {{ lowestRate.ward_name }}</button>: {{ lowestRate.usd_collection_rate }}% collected.</p><p v-else>—</p></div></article>
      <article class="ga-q"><Receipt :size="18" aria-hidden="true" />
        <div><h4>Where are overdue accounts concentrated?</h4>
          <p v-if="mostOverdue && mostOverdue.overdue"><button type="button" class="ga-ward" @click="emit('ward', mostOverdue.ward_code!)">Ward {{ mostOverdue.ward_name }}</button>: {{ mostOverdue.overdue }} overdue accounts, {{ money(mostOverdue.usd_overdue) }} overdue.</p><p v-else>No overdue accounts.</p></div></article>
      <article class="ga-q"><Building :size="18" aria-hidden="true" class="teal" />
        <div><h4>Where are the major infrastructure investments?</h4>
          <p v-if="biggestProject">{{ biggestProject.name }}: {{ money(biggestProject.approved_budget) }}. {{ money(projectsTotal) }} approved for projects located in Vungu RDC<template v-if="projectsUnlocated">; {{ projectsUnlocated }} more have no location yet</template>.</p><p v-else>No located project.</p></div></article>
      <article class="ga-q"><Landmark :size="18" aria-hidden="true" />
        <div><h4>Stand purchase balances</h4>
          <p>Not in the ledger. Purchase-price instalments are not billed until the Council approves a land-sales billing rule; offer prices are shown on each stand.</p></div></article>
    </div>

    <div class="ga-charts">
      <section class="ga-card">
        <h4>Billed, collected and outstanding by ward <small>USD</small></h4>
        <BarChart v-if="chartWards.length" :labels="chartWards.map((w) => wardLabel(w))" :height="190" unit="USD"
          :series="[
            { name: 'Collected', colour: '#2a66a8', values: chartWards.map((w) => Number(w.usd_paid)) },
            { name: 'Outstanding', colour: '#e2684f', values: chartWards.map((w) => Number(w.usd_outstanding)) },
          ]" label="Revenue collected and outstanding by ward" />
      </section>
      <section class="ga-card">
        <h4>Accounts by financial status</h4>
        <DonutChart v-if="statusSegments.length" :segments="statusSegments" :centre="String(accountsN)" sub="properties" label="Properties by financial status" />
      </section>
    </div>

    <section class="ga-card">
      <h4>Ward financial performance</h4>
      <div class="ga-table-wrap">
        <table class="ga-table">
          <thead><tr><th>Ward</th><th class="n">Properties</th><th class="n">Accounts</th><th class="n">Billed</th><th class="n">Collected</th><th class="n">Rate</th><th class="n">Outstanding</th><th class="n">Overdue</th><th class="n">Unbilled</th></tr></thead>
          <tbody>
            <tr v-for="w in wards" :key="w.ward_code!" @click="emit('ward', w.ward_code!)">
              <td>{{ wardLabel(w) }}</td><td class="n">{{ w.parcels }}</td><td class="n">{{ w.accounts }}</td>
              <td class="n">{{ money(w.usd_billed) }}</td><td class="n">{{ money(w.usd_paid) }}</td>
              <td class="n">{{ w.usd_collection_rate ? `${w.usd_collection_rate}%` : '—' }}</td>
              <td class="n neg">{{ Number(w.usd_outstanding) > 0 ? money(w.usd_outstanding) : '—' }}</td>
              <td class="n">{{ w.overdue || '—' }}</td><td class="n">{{ w.not_billed + w.allocated_no_account || '—' }}</td>
            </tr>
          </tbody>
          <tfoot v-if="t"><tr><td>Council</td><td class="n">{{ t.parcels }}</td><td class="n">{{ t.accounts }}</td><td class="n">{{ money(t.usd_billed) }}</td><td class="n">{{ money(t.usd_paid) }}</td>
            <td class="n">{{ t.usd_collection_rate ? `${t.usd_collection_rate}%` : '—' }}</td><td class="n neg">{{ money(t.usd_outstanding) }}</td><td class="n">{{ t.overdue }}</td><td class="n">{{ t.not_billed + t.allocated_no_account }}</td></tr></tfoot>
        </table>
      </div>
      <p class="ga-basis">{{ analytics?.basis }}</p>
    </section>
  </div>
</template>

<style scoped>
.ga { display: grid; gap: 14px; }
.ga-qs { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.ga-q { display: flex; gap: 10px; background: #fff; border: 1px solid var(--cw-card-line, #e3e8ee); border-radius: 10px; padding: 11px 12px; }
.ga-q > svg { flex: none; margin-top: 2px; color: var(--cw-accent); }
.ga-q > svg.pos { color: var(--cw-pos); } .ga-q > svg.neg { color: var(--cw-neg); } .ga-q > svg.violet { color: #7b5cc4; } .ga-q > svg.teal { color: #0f766e; }
.ga-q h4 { margin: 0 0 3px; font-size: 13px; font-weight: 650; }
.ga-q p { margin: 0; font-size: 13px; color: var(--cw-ink-2); }
.ga-ward { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: var(--cw-accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.ga-charts { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }
.ga-card { background: #fff; border: 1px solid var(--cw-card-line); border-radius: 10px; padding: 12px 14px; box-shadow: var(--cw-shadow); min-width: 0; }
.ga-card h4 { margin: 0 0 10px; font-size: 14px; }
.ga-card h4 small { color: var(--cw-ink-3); font-weight: 500; }
.ga-legend { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; font-size: 12.5px; }
.ga-legend li { display: flex; gap: 7px; align-items: center; }
.ga-legend i { width: 11px; height: 11px; border-radius: 3px; }
.ga-legend b { margin-left: auto; }
.ga-table-wrap { overflow-x: auto; }
.ga-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ga-table th { background: var(--cw-thead, #f1f4f9); text-align: left; padding: 7px 9px; font-weight: 600; color: var(--cw-ink-2); white-space: nowrap; }
.ga-table td { padding: 7px 9px; border-bottom: 1px solid var(--cw-line); font-variant-numeric: tabular-nums; }
.ga-table tbody tr { cursor: pointer; }
.ga-table tbody tr:hover { background: var(--cw-row-hover); }
.ga-table tfoot td { font-weight: 700; border-top: 2px solid var(--cw-line-2); }
.ga-table .n { text-align: right; }
.ga-table .neg { color: var(--cw-neg); }
.ga-basis { font-size: 12px; color: var(--cw-ink-3); margin: 10px 0 0; }
@media (max-width: 1100px) { .ga-charts { grid-template-columns: 1fr; } }
</style>
