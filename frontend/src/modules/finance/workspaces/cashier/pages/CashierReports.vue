<script setup lang="ts">
/**
 * The cashier's own reports: their sessions with each count and variance, and a day's receipts
 * by method, exportable as CSV. Totals per session come from the server once the drawer has been
 * counted; a day's receipts are counted here, not summed (control C7 while a drawer is open).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ChartColumn, Download, AlertTriangle } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf } from '../../../stores/finance'
import { formatMoney, formatDate, formatDateTime } from '../../../composables/useMoney'
import { methodLabel, type CashReceipt, type CashierSession } from '../../../models/cashTypes'
import { timeOf, useCashier } from '../useCashier'

const { state } = useCashier()
const sessions = ref<CashierSession[]>([])
const receipts = ref<CashReceipt[]>([])
const date = ref(state.desk?.today ?? new Date().toISOString().slice(0, 10))
const error = ref<string | null>(null)
const loading = ref(false)

async function loadSessions(): Promise<void> {
  try {
    sessions.value = (await cashApi.sessions({ mine: true, limit: 30 })).sessions
  } catch (err) {
    error.value = messageOf(err, 'Your sessions could not be read.')
  }
}
async function loadReceipts(): Promise<void> {
  loading.value = true
  try {
    receipts.value = (await cashApi.receipts({ mine: true, date: date.value, limit: 200 })).receipts
  } catch (err) {
    error.value = messageOf(err, 'The receipts could not be read.')
  } finally {
    loading.value = false
  }
}
watch(date, loadReceipts)
onMounted(() => { void loadSessions(); void loadReceipts() })

const byMethod = computed(() => {
  const m = new Map<string, { label: string; currency: string; count: number; cancelled: number }>()
  for (const r of receipts.value) {
    const key = `${r.method}|${r.currency}`
    const row = m.get(key) ?? { label: methodLabel(r.method), currency: r.currency, count: 0, cancelled: 0 }
    if (r.is_cancelled) row.cancelled += 1
    else row.count += 1
    m.set(key, row)
  }
  return [...m.values()]
})

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function exportCsv(): void {
  const head = ['Receipt No', 'Date', 'Time', 'Customer', 'Service', 'Currency', 'Amount', 'Method', 'Reference', 'Status']
  const lines = receipts.value.map((r) => [
    r.receipt_no, r.received_on, timeOf(r.created_at), r.payer_name, r.service ?? '', r.currency, r.amount,
    methodLabel(r.method), r.method_reference ?? '', r.is_cancelled ? `Cancelled: ${r.cancel_reason ?? ''}` : r.voucher_status,
  ].map(csvCell).join(','))
  const blob = new Blob([[head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `receipts-${date.value}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

const STATUS: Record<string, string> = { open: 'Open', suspended: 'Suspended', abandoned: 'Found abandoned', closed: 'Awaiting verification', verified: 'Verified' }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ChartColumn :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Reports</h2>
      <p>Your sessions and your receipts, for your own records and the end of the day.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card" aria-labelledby="rp-d">
    <div class="cw-card-head">
      <h3 id="rp-d">Receipts by method</h3>
      <span class="cw-spacer" />
      <label class="cw-field" style="flex-direction: row; align-items: center; gap: 8px"><span class="cw-label">Date</span><input v-model="date" type="date" class="cw-input" style="width: auto" /></label>
      <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="!receipts.length" @click="exportCsv"><Download :size="16" aria-hidden="true" /> Export CSV</button>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!byMethod.length" class="cw-empty">You issued no receipts on {{ formatDate(date) }}.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Method</th><th>Currency</th><th class="r">Receipts</th><th class="r">Cancelled</th></tr></thead>
        <tbody><tr v-for="r in byMethod" :key="r.label + r.currency"><td>{{ r.label }}</td><td>{{ r.currency }}</td><td class="r">{{ r.count }}</td><td class="r">{{ r.cancelled }}</td></tr></tbody>
      </table>
      <p class="cw-hint" style="margin-top: 10px">Amounts by method appear with each session's count below, once the drawer has been counted.</p>
    </div>
  </section>

  <section class="cw-card" aria-labelledby="rp-s">
    <div class="cw-card-head"><h3 id="rp-s">My sessions</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="!sessions.length" class="cw-empty">No sessions yet.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Session</th><th>Business date</th><th>Cash point</th><th>Opened</th><th>Status</th><th class="r">Receipts</th><th>Variance</th></tr></thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td>{{ s.session_no }}</td><td>{{ formatDate(s.business_date) }}</td><td>{{ s.cash_point_name }}</td>
            <td>{{ formatDateTime(s.opened_at) }}</td>
            <td><span class="cw-pill" :class="s.status === 'verified' ? 'cw-pill--pos' : s.status === 'closed' ? 'cw-pill--info' : s.status === 'abandoned' ? 'cw-pill--neg' : 'cw-pill--warn'">{{ STATUS[s.status] ?? s.status }}</span></td>
            <td class="r">{{ s.receipt_count }}</td>
            <td>
              <template v-if="s.counts.some((c) => c.variance !== null)">
                <div v-for="c in s.counts.filter((x) => x.variance !== null)" :key="c.currency" class="num" :class="c.variance === '0.00' ? 'cw-pos' : c.variance?.startsWith('-') ? 'cw-neg' : ''">{{ formatMoney(c.variance, c.currency) }}</div>
              </template>
              <span v-else class="cw-hint">Not counted</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
