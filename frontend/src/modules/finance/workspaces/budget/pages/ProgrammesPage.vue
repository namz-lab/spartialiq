<script setup lang="ts">
/**
 * Programmes and cost centres (votes): budget against spending for each, in each currency, from
 * the dashboard read. Performance & KPIs uses the same figures as execution rates.
 */
import { computed } from 'vue'
import { Network, Gauge, AlertTriangle } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import { useBudget } from '../useBudget'

const route = useRoute()
const store = useFinanceStore()
const { state } = useBudget()
const kpi = computed(() => route.name === 'bud-kpis')
const d = computed(() => state.dashboard)
const currencies = computed(() => [...new Set((d.value?.departments ?? []).map((x) => x.currency))])
const strip = (n: string) => n.replace(/\s*\(demo\)\s*$/i, '')
const pct = (v: string | null) => (v === null ? '—' : `${v}%`)
const width = (v: string | null) => `${Math.min(100, Math.max(0, Number(v ?? 0)))}%`
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="kpi ? Gauge : Network" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ kpi ? 'Performance & KPIs' : 'Programme / Cost Centres' }}</h2>
      <p>{{ kpi ? 'How far each vote has spent its budget, and where the year stands.' : 'Budget and spending for every programme and every vote (department).' }} {{ store.selectedYear?.label }}</p>
    </div>
  </section>

  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}</p>
  <div v-if="!d" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="kpi">
    <div class="cw-tiles">
      <div v-for="t in d.totals" :key="t.currency" class="cw-tile cw-tile--violet">
        <div>
          <p class="cw-tile-label">Overall utilisation ({{ t.currency }})</p>
          <p class="cw-tile-value num">{{ pct(t.utilised_pct) }}</p>
          <p class="cw-tile-sub">Spent {{ pct(t.actual_pct) }} · committed {{ pct(t.committed_pct) }}</p>
        </div>
      </div>
      <div class="cw-tile cw-tile--green"><div><p class="cw-tile-label">Lines approved</p><p class="cw-tile-value num">{{ d.workflow.approved }}</p>
        <p class="cw-tile-sub">of {{ d.workflow.approved + d.workflow.draft + d.workflow.submitted + d.workflow.returned }} budget lines</p></div></div>
      <div class="cw-tile cw-tile--amber"><div><p class="cw-tile-label">Revisions awaiting approval</p><p class="cw-tile-value num">{{ d.revisions_awaiting }}</p></div></div>
    </div>
    <section v-for="c in currencies" :key="c" class="cw-card">
      <div class="cw-card-head"><h3>Execution by vote ({{ c }})</h3></div>
      <div class="cw-card-body">
        <ul class="kp-bars">
          <li v-for="v in d.departments.filter((x) => x.currency === c)" :key="v.code">
            <span class="kp-name">{{ v.code }} – {{ strip(v.name) }}</span>
            <span class="kp-track" role="progressbar" :aria-valuenow="Number(v.utilisation ?? 0)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${strip(v.name)} ${pct(v.utilisation)}`">
              <span :style="{ width: width(v.utilisation) }" :class="Number(v.utilisation ?? 0) > 100 ? 'is-over' : ''" />
            </span>
            <strong class="num">{{ pct(v.utilisation) }}</strong>
          </li>
        </ul>
      </div>
    </section>
  </template>

  <template v-else>
    <section v-for="c in currencies" :key="`p-${c}`" class="cw-card">
      <div class="cw-card-head"><h3>Programmes ({{ c }})</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>Programme</th><th class="r">Budget</th><th class="r">Actual</th></tr></thead>
          <tbody><tr v-for="p in d.programmes.filter((x) => x.currency === c)" :key="p.code"><td>{{ p.code }} – {{ strip(p.name) }}</td><td class="amt">{{ formatMoney(p.budget, c) }}</td><td class="r num">{{ formatMoney(p.actual, c) }}</td></tr></tbody>
        </table>
      </div>
    </section>
    <section v-for="c in currencies" :key="`d-${c}`" class="cw-card">
      <div class="cw-card-head"><h3>Votes / cost centres ({{ c }})</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>Vote</th><th class="r">Budget</th><th class="r">Actual</th><th class="r">Committed</th><th class="r">Variance</th><th class="r">Utilisation</th></tr></thead>
          <tbody>
            <tr v-for="v in d.departments.filter((x) => x.currency === c)" :key="v.code">
              <td>{{ v.code }} – {{ strip(v.name) }}</td><td class="amt">{{ formatMoney(v.budget, c) }}</td><td class="r num">{{ formatMoney(v.actual, c) }}</td>
              <td class="r num">{{ formatMoney(v.committed, c) }}</td><td class="r num">{{ formatMoney(v.variance, c) }} ({{ pct(v.variance_pct) }})</td><td class="r">{{ pct(v.utilisation) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.kp-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.kp-bars li { display: grid; grid-template-columns: minmax(160px, 280px) 1fr 70px; align-items: center; gap: 14px; }
.kp-track { height: 14px; border-radius: 7px; background: #e9eef5; overflow: hidden; }
.kp-track span { display: block; height: 100%; background: #1e9e4a; border-radius: 7px; }
.kp-track span.is-over { background: #d32f2f; }
.kp-bars strong { text-align: right; }
@media (max-width: 640px) { .kp-bars li { grid-template-columns: 1fr 60px; } .kp-track { grid-column: 1 / -1; grid-row: 2; } }
</style>
