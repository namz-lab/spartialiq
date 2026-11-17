<script setup lang="ts">
/**
 * The chief executive's dashboard (`GET /finance/dashboards/executive`, with the quarterly series from
 * `GET /finance/overview/series`): revenue and spending this year against budget, how much of the
 * spending budget is used, how many active projects are on track, quarter by quarter performance,
 * key indicators and each department's utilisation. Reporting currency first; nothing is added
 * across currencies.
 */
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Coins, Wallet, Gauge, CircleCheckBig, ChartColumn, Key, Building2, BookOpen, Receipt, FileText, Scale, Landmark, Hourglass,
  FolderKanban, CircleCheck, ShieldAlert, ShieldCheck, AlertTriangle,
} from 'lucide-vue-next'
import BarChart from '../../shared/BarChart.vue'
import { byCurrency, pctText } from '../../shared/useDashboard'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { financeApi } from '../../../api/financeApi'
import { ledgerApi } from '../../../api/ledgerApi'
import type { OverviewSeriesResult } from '../../../models/types'
import type { AgeingBucketTotal, AgeingReconciliation, CashAccountRow } from '../../../models/ledgerTypes'
import { useFinanceStore } from '../../../stores/finance'
import { executiveDash } from '../dashboard'

const store = useFinanceStore()
const { state, load } = executiveDash
const d = computed(() => state.data)
const ccy = computed<Currency>(() => d.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency = ccy.value) => formatMoney(v, c)
const kind = (k: 'revenue' | 'expenditure') => byCurrency((d.value?.totals ?? []).filter((t) => t.account_kind === k), ccy.value)
const revenue = computed(() => kind('revenue'))
const spend = computed(() => kind('expenditure'))
const prior = (k: string, c: string) => d.value?.prior.find((p) => p.account_kind === k && p.currency === c)?.actual

// Quarter by quarter, from the overview series (the same rows the Executive Overview draws).
const series = ref<OverviewSeriesResult | null>(null)
watch(() => d.value?.year.id, async (id) => {
  if (!id) return
  try { series.value = await financeApi.overviewSeries({ financial_year_id: id, periodicity: 'quarterly' }) } catch { series.value = null }
}, { immediate: true })
const points = (k: string) => series.value?.series.find((s) => s.currency === ccy.value && s.account_kind === k)?.points ?? []
const quarters = computed(() => (series.value?.periods ?? []).map((p, i) => `Q${i + 1}`))
const qRevenue = computed(() => points('revenue').map((p) => Number(p.actual)))
const qSpend = computed(() => points('expenditure').map((p) => Number(p.actual)))

const depts = computed(() => (d.value?.departments ?? []).filter((x) => x.currency === ccy.value).slice(0, 6))
const shortName = (n: string) => n.replace(/\s*\(demo\)\s*$/i, '')
// Read-only links: this workspace acts on nothing.
const READ = [
  { label: 'Financial Position', icon: Scale, to: 'exe-position' },
  { label: 'Payments and Vouchers', icon: Receipt, to: 'exe-payments' },
  { label: 'Reports & Briefs', icon: FileText, to: 'exe-reports' },
  { label: 'Audit Trail', icon: ShieldCheck, to: 'exe-trail' },
]

// Cash and bank, and debtors by age, in the reporting currency. Each card fails on its own.
const cash = ref<CashAccountRow[] | null>(null)
const cashError = ref(false)
const ageing = ref<{ buckets: AgeingBucketTotal[]; recon: AgeingReconciliation | null; labels: Record<string, string> } | null>(null)
const ageingError = ref(false)
watch([() => d.value?.year.id, ccy], async ([id, c]) => {
  if (!id) return
  cashError.value = false
  ageingError.value = false
  const [a, b] = await Promise.allSettled([ledgerApi.cashAccounts(id), ledgerApi.debtorAgeing({ currency: c, outstanding_only: true, limit: 1 })])
  if (a.status === 'fulfilled') cash.value = a.value.accounts.filter((r) => r.currency === c)
  else { cash.value = null; cashError.value = true }
  if (b.status === 'fulfilled') {
    ageing.value = {
      buckets: b.value.by_bucket.filter((x) => x.currency === c && x.ageing_bucket !== 'settled'),
      recon: b.value.reconciliation.find((r) => r.currency === c) ?? null,
      labels: Object.fromEntries((b.value.buckets ?? []).map((x) => [x.key, x.label])),
    }
  } else { ageing.value = null; ageingError.value = true }
}, { immediate: true })
const BUCKET: Record<string, string> = {
  current: 'Current', '31_60': '31 to 60 days', '61_90': '61 to 90 days', '91_180': '91 to 180 days',
  '181_365': '181 to 365 days', over_365: 'Over 365 days', unallocated: 'Unallocated receipts',
}
const bucketLabel = (k: string) => ageing.value?.labels[k] ?? BUCKET[k] ?? k
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load(store.selectedYearId)">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'exe-revenue' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Coins :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Total Revenue (YTD)</p><p class="cw-tile-value num">{{ money(revenue[0]?.actual ?? '0', revenue[0]?.currency ?? ccy) }}</p>
          <p class="cw-tile-sub is-up">{{ pctText(revenue[0]?.execution) }} of budgeted income</p>
          <p v-if="revenue[0] && prior('revenue', revenue[0].currency)" class="cw-tile-sub">Last year {{ money(prior('revenue', revenue[0].currency), revenue[0].currency) }}</p>
          <p v-for="r in revenue.slice(1)" :key="r.currency" class="cw-tile-value-2 num">{{ money(r.actual, r.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'exe-expenditure' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><Wallet :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Total Expenditure (YTD)</p><p class="cw-tile-value num">{{ money(spend[0]?.actual ?? '0', spend[0]?.currency ?? ccy) }}</p>
          <p v-if="spend[0] && prior('expenditure', spend[0].currency)" class="cw-tile-sub">Last year {{ money(prior('expenditure', spend[0].currency), spend[0].currency) }}</p>
          <p v-for="r in spend.slice(1)" :key="r.currency" class="cw-tile-value-2 num">{{ money(r.actual, r.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'exe-departments' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><Gauge :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Budget Utilisation</p><p class="cw-tile-value num">{{ pctText(spend[0]?.execution) }}</p>
          <p class="cw-tile-sub">of the spending budget ({{ spend[0]?.currency ?? ccy }})</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'exe-projects' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><CircleCheckBig :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Service Delivery</p><p class="cw-tile-value num">{{ pctText(d.projects.on_track_pct) }}</p>
          <p class="cw-tile-sub">{{ d.projects.on_track }} of {{ d.projects.active }} active projects on track</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--3">
      <section class="cw-card" aria-labelledby="ex-fp">
        <div class="cw-card-head"><h3 id="ex-fp"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Financial Performance ({{ ccy }})</h3></div>
        <div class="cw-card-body">
          <p v-if="!quarters.length" class="cw-empty">The quarterly series could not be read.</p>
          <BarChart v-else :labels="quarters" :unit="ccy" :series="[
            { name: 'Revenue', colour: '#1f5aa8', values: qRevenue },
            { name: 'Expenditure', colour: '#2e9e44', values: qSpend },
          ]" :label="`Revenue and expenditure by quarter, ${ccy}`" />
        </div>
      </section>
      <section class="cw-card" aria-labelledby="ex-ki">
        <div class="cw-card-head"><h3 id="ex-ki"><Key :size="24" class="cw-head-icon" aria-hidden="true" /> Key Indicators</h3></div>
        <div class="cw-card-body">
          <ul class="dx-kpis">
            <li><FolderKanban :size="19" class="dx-accent" aria-hidden="true" /><span>Projects in Progress</span><strong>{{ d.projects.in_progress }}</strong></li>
            <li><CircleCheck :size="19" class="dx-ok" aria-hidden="true" /><span>Projects Completed</span><strong>{{ d.projects.completed }}</strong></li>
            <li><ShieldAlert :size="19" class="dx-warn" aria-hidden="true" /><span>High-risk Audit Findings</span><strong>{{ d.high_risks }}</strong></li>
            <li><ShieldCheck :size="19" class="dx-ok" aria-hidden="true" /><span>Audit Compliance</span><strong>{{ pctText(d.compliance.pct) }}</strong></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="ex-dp">
        <div class="cw-card-head"><h3 id="ex-dp"><Building2 :size="24" class="cw-head-icon" aria-hidden="true" /> Department Performance</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'exe-departments' }" class="cw-link">All</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="!depts.length" class="cw-empty">No approved spending lines in {{ ccy }}.</p>
          <ul v-else class="dx-bars">
            <li v-for="x in depts" :key="x.code"><span>{{ shortName(x.name) }}</span>
              <span class="dx-track"><span class="dx-fill" :class="{ 'is-over': Number(x.utilisation ?? 0) > 100 }" :style="{ width: `${Math.min(100, Number(x.utilisation ?? 0))}%` }" /></span>
              <strong>{{ pctText(x.utilisation) }}</strong></li>
          </ul>
          <p class="dx-note">Spent against the revised budget.</p>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--2">
      <section class="cw-card" aria-labelledby="ex-cash">
        <div class="cw-card-head"><h3 id="ex-cash"><Landmark :size="24" class="cw-head-icon" aria-hidden="true" /> Cash and Bank ({{ ccy }})</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'exe-cash' }" class="cw-link">All accounts</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="cashError" class="cw-empty">The cash and bank position could not be read.</p>
          <span v-else-if="cash === null" class="cw-skel" />
          <p v-else-if="!cash.length" class="cw-empty">No {{ ccy }} bank or cash account.</p>
          <ul v-else class="dx-kpis">
            <li v-for="r in cash" :key="r.id"><Landmark :size="19" class="dx-accent" aria-hidden="true" />
              <span>{{ r.name }}<small v-if="r.account_type === 'bank'" class="cw-hint"> · {{ r.reconciled_to ? `reconciled to ${r.reconciled_to}` : 'never reconciled' }}</small></span>
              <strong class="num">{{ money(r.balance.amount, r.currency) }}{{ r.balance.side === 'Cr' && !/^[-+]?0*(\.0*)?$/.test(r.balance.amount) ? ' overdrawn' : '' }}</strong></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="ex-age">
        <div class="cw-card-head"><h3 id="ex-age"><Hourglass :size="24" class="cw-head-icon" aria-hidden="true" /> Debtors by Age ({{ ccy }})</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'exe-ageing' }" class="cw-link">Detail</RouterLink></div>
        <div class="cw-card-body">
          <p v-if="ageingError" class="cw-empty">The debtor ageing could not be read.</p>
          <span v-else-if="ageing === null" class="cw-skel" />
          <p v-else-if="!ageing.buckets.length" class="cw-empty">Nothing is owed in {{ ccy }}.</p>
          <template v-else>
            <ul class="dx-kpis">
              <li v-for="b in ageing.buckets" :key="b.ageing_bucket"><Hourglass :size="19" :class="['91_180', '181_365', 'over_365'].includes(b.ageing_bucket) ? 'dx-warn' : 'dx-accent'" aria-hidden="true" />
                <span>{{ bucketLabel(b.ageing_bucket) }}</span><strong class="num">{{ money(b.outstanding_amount, b.currency) }}</strong></li>
            </ul>
            <p v-if="ageing.recon" class="dx-note" :role="ageing.recon.agrees ? 'status' : 'alert'">{{ ageing.recon.agrees ? 'Agrees with the debtors control account.' : `Differs from the debtors control account by ${money(ageing.recon.difference, ccy)}.` }}</p>
          </template>
        </div>
      </section>
    </div>

    <section class="cw-card" aria-labelledby="ex-ac">
      <div class="cw-card-head"><h3 id="ex-ac"><BookOpen :size="24" class="cw-head-icon" aria-hidden="true" /> Read Further</h3></div>
      <div class="cw-card-body">
        <div class="dx-quick">
          <RouterLink v-for="a in READ" :key="a.label" :to="{ name: a.to }" class="cw-action dx-qa-wide">
            <component :is="a.icon" :size="24" :stroke-width="1.7" aria-hidden="true" /><span>{{ a.label }}</span>
          </RouterLink>
        </div>
        <p class="dx-note">Each opens a record to read. Approvals stay with the committee and the officers whose duty they are.</p>
      </div>
    </section>
  </template>
</template>
