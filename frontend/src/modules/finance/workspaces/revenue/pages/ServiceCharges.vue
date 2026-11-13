<script setup lang="ts">
/**
 * The council's counter charges (income codes) with their set prices per currency, and what each
 * has brought in this year. Prices are set up by the accountant (Cash Office setup); this page reads
 * them (`GET /finance/cash/desk`, finance.cash.view) and the year's streams from the dashboard.
 */
import { computed, onMounted, ref } from 'vue'
import { Wrench } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import type { IncomeCode } from '../../../models/cashTypes'
import { messageOf } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import { pctText } from '../../shared/useDashboard'
import { revenueDash } from '../dashboard'

const codes = ref<IncomeCode[]>([])
const error = ref<string | null>(null)
const loading = ref(false)
onMounted(async () => {
  loading.value = true
  try { codes.value = (await cashApi.desk()).income_codes } catch (err) { error.value = messageOf(err, 'The service charges could not be read.') } finally { loading.value = false }
})
const streams = computed(() => revenueDash.state.data?.streams ?? [])
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Wrench :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Service Charges</h2><p>What the council charges at the counter, and what each charge has brought in this year.</p></div>
  </section>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-head"><h3>Charges</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!codes.length" class="cw-empty">No counter charges are set up.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Code</th><th>Charge</th><th>Pricing</th><th class="r">USD</th><th class="r">ZWG</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="c in codes" :key="c.id">
            <td class="num">{{ c.code }}</td><td class="dx-wrap">{{ c.name }}</td><td>{{ c.pricing === 'fixed' ? 'Fixed' : 'Set at the counter' }}</td>
            <td class="r num">{{ c.unit_amount_usd ? formatMoney(c.unit_amount_usd, 'USD') : '—' }}</td>
            <td class="r num">{{ c.unit_amount_zwg ? formatMoney(c.unit_amount_zwg, 'ZWG') : '—' }}</td>
            <td><span class="cw-pill" :class="c.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ c.status }}</span></td>
          </tr>
        </tbody>
      </table>
      <p class="dx-note">Prices are changed in the Cash Office setup by whoever holds that duty; a fixed price cannot be varied at the counter.</p>
    </div>
  </section>

  <section class="cw-card">
    <div class="cw-card-head"><h3>Collected this year, by source</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="!streams.length" class="cw-empty">Nothing collected yet.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th>Source</th><th>Currency</th><th class="r">Collected</th><th class="r">Share of currency</th></tr></thead>
        <tbody><tr v-for="s in streams" :key="s.currency + s.name"><td>{{ s.name }}</td><td>{{ s.currency }}</td>
          <td class="r num">{{ formatMoney(s.amount, s.currency) }}</td><td class="r num">{{ pctText(s.share) }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>
