<script setup lang="ts">
/**
 * The revenue officer's dashboard (`GET /finance/dashboards/revenue`): rates billed and money
 * collected this year, the rates collection rate (rates received against rates billed, like with
 * like), arrears and their age, six months of billing against collection, and where the money came
 * from. Reporting currency first; the other currency is listed beneath, never added in.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Coins, Wallet, Percent, TriangleAlert, ChartColumn, Layers, Clock, Zap, FilePlus, HandCoins, SlidersHorizontal, UserSearch,
  AlertTriangle, House, Wrench, Store, CircleDollarSign,
} from 'lucide-vue-next'
import BarChart from '../../shared/BarChart.vue'
import { byCurrency, pctText } from '../../shared/useDashboard'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { revenueDash } from '../dashboard'

const store = useFinanceStore()
const { state, load } = revenueDash
const d = computed(() => state.data)
const ccy = computed<Currency>(() => d.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency = ccy.value) => formatMoney(v, c)

const billed = computed(() => byCurrency(d.value?.billed, ccy.value))
const collected = computed(() => byCurrency(d.value?.collected, ccy.value))
const rate = computed(() => byCurrency(d.value?.collection_rate, ccy.value))
const arrears = computed(() => byCurrency(d.value?.arrears, ccy.value))
const trend = computed(() => (d.value?.trend ?? []).filter((r) => r.currency === ccy.value))
const months = computed(() => trend.value.map((r) => new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })))
const streams = computed(() => (d.value?.streams ?? []).filter((s) => s.currency === ccy.value).slice(0, 5))
const otherStreams = computed(() => [...new Set((d.value?.streams ?? []).map((s) => s.currency))].filter((c) => c !== ccy.value))
const streamIcon = (n: string) => (/rate/i.test(n) ? House : /licen|trad|market/i.test(n) ? Store : /service|water|refuse|sewer/i.test(n) ? Wrench : CircleDollarSign)

const BUCKETS: { key: '0_30' | '31_60' | '61_90' | 'over_90'; label: string; cls: string }[] = [
  { key: '0_30', label: '0 – 30 days', cls: 'dx-accent' }, { key: '31_60', label: '31 – 60 days', cls: 'dx-warn' },
  { key: '61_90', label: '61 – 90 days', cls: 'dx-warn' }, { key: 'over_90', label: '> 90 days', cls: 'dx-neg' },
]
const ageing = (bucket: string) => (d.value?.ageing ?? []).filter((a) => a.bucket === bucket)
const QUICK = [
  { label: 'Raise Bill', icon: FilePlus, to: 'rev-billing' },
  { label: 'Record Collection', icon: HandCoins, to: 'rev-collections' },
  { label: 'Apply Adjustment', icon: SlidersHorizontal, to: 'rev-adjust' },
  { label: 'Customer Lookup', icon: UserSearch, to: 'rev-accounts' },
]
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load(store.selectedYearId)">Retry</button></p>
  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <div class="cw-tiles dx-tiles">
      <RouterLink :to="{ name: 'rev-billing' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Coins :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Total Billed (YTD)</p><p class="cw-tile-value num">{{ money(billed[0]?.amount ?? '0', billed[0]?.currency ?? ccy) }}</p>
          <p v-for="b in billed.slice(1)" :key="b.currency" class="cw-tile-value-2 num">{{ money(b.amount, b.currency) }}</p>
          <p class="cw-tile-sub">{{ billed.reduce((n, b) => n + b.bills, 0) }} rates bills</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'rev-collections' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><Wallet :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Total Collected (YTD)</p><p class="cw-tile-value num">{{ money(collected[0]?.amount ?? '0', collected[0]?.currency ?? ccy) }}</p>
          <p v-for="c in collected.slice(1)" :key="c.currency" class="cw-tile-value-2 num">{{ money(c.amount, c.currency) }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'rev-collections' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><Percent :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Collection Rate</p><p class="cw-tile-value num">{{ pctText(rate[0]?.rate) }}</p>
          <p class="cw-tile-sub">rates received of rates billed{{ rate[0] ? ` (${rate[0].currency})` : '' }}</p></div>
      </RouterLink>
      <RouterLink :to="{ name: 'rev-arrears' }" class="cw-tile cw-tile--red">
        <span class="cw-tile-icon"><TriangleAlert :size="32" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Outstanding Arrears</p><p class="cw-tile-value num">{{ money(arrears[0]?.amount ?? '0', arrears[0]?.currency ?? ccy) }}</p>
          <p v-for="a in arrears.slice(1)" :key="a.currency" class="cw-tile-value-2 num">{{ money(a.amount, a.currency) }}</p>
          <p class="cw-tile-sub">{{ arrears[0]?.accounts ?? 0 }} accounts</p></div>
      </RouterLink>
    </div>

    <div class="dx-row dx-row--wide-left">
      <section class="cw-card" aria-labelledby="rv-tr">
        <div class="cw-card-head"><h3 id="rv-tr"><ChartColumn :size="24" class="cw-head-icon" aria-hidden="true" /> Revenue Collection Trend ({{ ccy }})</h3></div>
        <div class="cw-card-body">
          <BarChart :labels="months" :unit="ccy" :series="[
            { name: 'Billed', colour: '#1f5aa8', values: trend.map((r) => Number(r.billed)) },
            { name: 'Collected', colour: '#2e9e44', values: trend.map((r) => Number(r.collected)) },
          ]" :label="`Rates billed and revenue collected by month, ${ccy}`" />
          <p class="dx-note">Billed: rates bills issued. Collected: rates receipts and counter receipts.</p>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="rv-st">
        <div class="cw-card-head"><h3 id="rv-st"><Layers :size="24" class="cw-head-icon" aria-hidden="true" /> Top Revenue Streams (YTD)</h3></div>
        <div class="cw-card-body">
          <p v-if="!streams.length" class="cw-empty">Nothing collected in {{ ccy }} this year.</p>
          <ul v-else class="dx-list">
            <li v-for="s in streams" :key="s.name"><div class="dx-item">
              <component :is="streamIcon(s.name)" :size="19" class="dx-accent" aria-hidden="true" />
              <span class="dx-grow">{{ s.name }}</span><span class="dx-val">{{ money(s.amount) }}</span><span class="dx-when" style="min-width: 52px; text-align: right">{{ pctText(s.share) }}</span>
            </div></li>
          </ul>
          <p v-if="otherStreams.length" class="dx-note">Also collected in {{ otherStreams.join(', ') }}; shown on Revenue Reports.</p>
        </div>
      </section>
    </div>

    <div class="dx-row dx-row--wide-right">
      <section class="cw-card" aria-labelledby="rv-ar">
        <div class="cw-card-head"><h3 id="rv-ar"><Clock :size="24" class="cw-head-icon" aria-hidden="true" /> Arrears Summary</h3><span class="cw-spacer" />
          <RouterLink :to="{ name: 'rev-arrears' }" class="cw-link">Arrears</RouterLink></div>
        <div class="cw-card-body">
          <ul class="dx-ageing">
            <li v-for="b in BUCKETS" :key="b.key"><Clock :size="18" :class="b.cls" aria-hidden="true" /><span>{{ b.label }}</span>
              <strong v-if="!ageing(b.key).length">{{ money('0') }}</strong>
              <strong v-for="a in ageing(b.key)" :key="a.currency">{{ money(a.amount, a.currency) }}</strong></li>
          </ul>
        </div>
      </section>
      <section class="cw-card" aria-labelledby="rv-qa">
        <div class="cw-card-head"><h3 id="rv-qa"><Zap :size="24" class="cw-head-icon" aria-hidden="true" /> Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="dx-quick">
            <RouterLink v-for="q in QUICK" :key="q.label" :to="{ name: q.to }" class="cw-action dx-qa">
              <component :is="q.icon" :size="26" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>
    </div>
  </template>
</template>
