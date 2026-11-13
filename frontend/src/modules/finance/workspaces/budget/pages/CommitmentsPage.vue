<script setup lang="ts">
/**
 * Commitments (encumbrances): money promised against a budget line and not yet spent, from
 * `GET /finance/commitments`. Commitments arrive from the council's purchasing records through
 * Imports; there is no screen that types one in, so a commitment always carries its source.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Layers, AlertTriangle, Info } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import type { Commitment } from '../../../models/types'

const store = useFinanceStore()
const rows = ref<Commitment[]>([])
const status = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!store.selectedYearId) return
  loading.value = true
  error.value = null
  try {
    rows.value = await financeApi.commitments({ financial_year_id: store.selectedYearId, ...(status.value ? { status: status.value } : {}) })
  } catch (err) {
    error.value = messageOf(err, 'The commitments could not be read.')
  } finally {
    loading.value = false
  }
}
watch([() => store.selectedYearId, status], load)
onMounted(load)

const LABEL: Record<string, string> = { open: 'Open', partially_liquidated: 'Partly spent', liquidated: 'Spent', cancelled: 'Cancelled' }
const today = new Date()
const age = (iso: string) => Math.floor((today.getTime() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000)
const openCount = computed(() => rows.value.filter((r) => r.status === 'open' || r.status === 'partially_liquidated').length)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Layers :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Commitments (Encumbrances)</h2>
      <p>Money promised against a budget line by an order or contract, and not yet spent.</p>
    </div>
  </section>

  <p class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />
    Commitments come from the council's purchasing records through the finance office's Imports, with their source reference. There is no form to capture one by hand, so every figure here can be traced to an order.</p>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card">
    <div class="cw-card-head">
      <h3>{{ openCount }} open</h3>
      <span class="cw-spacer" />
      <select v-model="status" class="cw-select" style="width: auto" aria-label="Status">
        <option value="">Every status</option><option value="open">Open</option><option value="partially_liquidated">Partly spent</option>
        <option value="liquidated">Spent</option><option value="cancelled">Cancelled</option>
      </select>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!rows.length" class="cw-empty">No commitments in {{ store.selectedYear?.label }}.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Reference</th><th>Budget line</th><th>Committed on</th><th class="r">Age (days)</th><th class="r">Amount</th><th class="r">Spent</th><th class="r">Outstanding</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.id">
            <td><strong>{{ c.reference }}</strong><div v-if="c.description" class="cw-hint">{{ c.description }}</div></td>
            <td>{{ c.budget_line_code ?? '—' }}</td><td>{{ formatDate(c.committed_on) }}</td>
            <td class="r" :class="{ 'cw-neg': age(c.committed_on) > 90 && c.status !== 'liquidated' }">{{ age(c.committed_on) }}</td>
            <td class="amt">{{ formatMoney(c.amount, c.currency) }}</td>
            <td class="r num">{{ formatMoney(c.liquidated_amount, c.currency) }}</td>
            <td class="r num">{{ formatMoney(c.outstanding_amount ?? null, c.currency) }}</td>
            <td><span class="cw-pill" :class="c.status === 'liquidated' ? 'cw-pill--pos' : c.status === 'cancelled' ? 'cw-pill--mute' : 'cw-pill--warn'">{{ LABEL[c.status] ?? c.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
