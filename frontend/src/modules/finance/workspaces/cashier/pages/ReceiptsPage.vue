<script setup lang="ts">
/**
 * Every receipt, searchable by number, payer or reference: view, reprint (marked COPY), save as
 * PDF, and cancel a service receipt taken in your own open session (rates receipts are cancelled
 * from Rates, where the bills they settled are released with them).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { FileText, Search, X, AlertTriangle, ChevronLeft, ChevronRight, Printer } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import { methodLabel, type CashMethod, type CashReceipt } from '../../../models/cashTypes'
import { timeOf, useCashier } from '../useCashier'
import ReceiptDialog from '../components/ReceiptDialog.vue'
import ReasonDialog from '../../shared/ReasonDialog.vue'

const route = useRoute()
const store = useFinanceStore()
const { state, loadDesk } = useCashier()

const q = ref('')
const localToday = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const date = ref(state.desk?.today ?? localToday())
const mine = ref(true)
const method = ref<CashMethod | ''>('')
const offset = ref(0)
const LIMIT = 25
const rows = ref<CashReceipt[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await cashApi.receipts({
      limit: LIMIT, offset: offset.value,
      ...(q.value.trim() ? { q: q.value.trim() } : {}),
      ...(date.value ? { date: date.value } : {}),
      ...(mine.value ? { mine: true } : {}),
      ...(method.value ? { method: method.value } : {}),
    })
    rows.value = page.receipts
    total.value = page.total
  } catch (err) {
    error.value = messageOf(err, 'The receipts could not be read.')
  } finally {
    loading.value = false
  }
}

watch([date, mine, method], () => { offset.value = 0; void load() })
function search(): void { offset.value = 0; void load() }

const viewing = ref<string | null>(null)
const cancelling = ref<CashReceipt | null>(null)
const cancelError = ref<string | null>(null)
const cancelBusy = ref(false)
const canCancel = computed(() => store.can('finance.cash.receipt.cancel'))

async function cancelReceipt(reason: string): Promise<void> {
  if (!cancelling.value) return
  cancelBusy.value = true
  cancelError.value = null
  try {
    await cashApi.cancelReceipt(cancelling.value.id, reason)
    cancelling.value = null
    await Promise.all([load(), loadDesk()])
  } catch (err) {
    cancelError.value = messageOf(err, 'The receipt could not be cancelled.')
  } finally {
    cancelBusy.value = false
  }
}

onMounted(async () => {
  await load()
  // "Reprint Receipt" from the dashboard: straight to the search, all dates.
  if (route.query.reprint) {
    date.value = ''
    await nextTick()
    searchEl.value?.focus()
  }
})
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileText :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Receipts</h2>
      <p>Find, view and reprint receipts. A receipt is never edited; a mistake is cancelled with a reason.</p>
    </div>
  </section>

  <section class="cw-card">
    <div class="cw-card-body rc-filters" style="padding-top: 20px">
      <form class="cw-search" role="search" style="flex: 2 1 280px" @submit.prevent="search">
        <Search :size="22" aria-hidden="true" />
        <input ref="searchEl" v-model="q" class="cw-input" placeholder="Receipt number, customer or reference" aria-label="Search receipts" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; search()"><X :size="20" /></button>
      </form>
      <label class="cw-field" style="flex: 0 1 190px">
        <span class="cw-label">Date</span>
        <input v-model="date" type="date" class="cw-input" />
      </label>
      <label class="cw-field" style="flex: 0 1 190px">
        <span class="cw-label">Method</span>
        <select v-model="method" class="cw-select">
          <option value="">All methods</option>
          <option value="cash">Cash</option><option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option>
          <option value="cheque">Cheque</option>
        </select>
      </label>
      <label class="rc-mine"><input v-model="mine" type="checkbox" class="cw-check" /> Only receipts I issued</label>
      <button type="button" class="cw-btn" @click="date = ''">All dates</button>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card" aria-label="Receipts">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <div v-if="loading && !rows.length"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!rows.length" class="cw-empty"><strong>No receipts match.</strong>Try another date, or clear the search.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Receipt No.</th><th>Customer</th><th>Service / Bill</th><th class="r">Amount</th><th>Method</th><th>Date</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td><button type="button" class="cw-receipt-no" @click="viewing = r.id">{{ r.receipt_no }}</button></td>
            <td>{{ r.payer_name }}</td>
            <td>{{ r.service ?? '—' }}</td>
            <td class="amt">{{ formatMoney(r.amount, r.currency) }}</td>
            <td><span class="cw-method" :class="`cw-method--${r.method}`">{{ methodLabel(r.method) }}</span><div v-if="r.method_reference" class="cw-hint">{{ r.method_reference }}</div></td>
            <td class="num">{{ formatDate(r.received_on) }} {{ timeOf(r.created_at) }}</td>
            <td>
              <span v-if="r.is_cancelled" class="cw-pill cw-pill--neg" :title="r.cancel_reason ?? ''">Cancelled</span>
              <span v-else-if="r.voucher_status === 'posted'" class="cw-pill cw-pill--pos">Posted</span>
              <span v-else class="cw-pill cw-pill--warn">Awaiting cash-up</span>
            </td>
            <td style="white-space: nowrap">
              <button type="button" class="cw-icon-btn" :aria-label="`Reprint ${r.receipt_no}`" @click="viewing = r.id"><Printer :size="18" /></button>
              <button v-if="canCancel && r.source === 'sundry' && !r.is_cancelled" type="button" class="cw-icon-btn" :aria-label="`Cancel ${r.receipt_no}`" @click="cancelling = r; cancelError = null"><X :size="18" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="total > LIMIT" class="rc-pager">
        <span>{{ offset + 1 }}–{{ Math.min(offset + LIMIT, total) }} of {{ total }}</span>
        <button type="button" class="cw-btn cw-btn--small" :disabled="offset === 0" @click="offset -= LIMIT; load()"><ChevronLeft :size="16" aria-hidden="true" /> Previous</button>
        <button type="button" class="cw-btn cw-btn--small" :disabled="offset + LIMIT >= total" @click="offset += LIMIT; load()">Next <ChevronRight :size="16" aria-hidden="true" /></button>
      </div>
    </div>
  </section>

  <ReceiptDialog v-if="viewing" :receipt-id="viewing" @close="viewing = null" />
  <ReasonDialog
    v-if="cancelling" :title="`Cancel receipt ${cancelling.receipt_no}`"
    :message="`${formatMoney(cancelling.amount, cancelling.currency)} from ${cancelling.payer_name}. It stays on the record as cancelled, with your reason, and its number is not used again. Only a receipt in your own open session can be cancelled here.`"
    label="Why is it being cancelled?" submit-label="Cancel receipt" danger :busy="cancelBusy" :error="cancelError"
    @submit="cancelReceipt" @close="cancelling = null"
  />
</template>

<style scoped>
.rc-filters { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
.rc-mine { display: flex; align-items: center; gap: 8px; min-height: 38px; font-size: 13.5px; }
.rc-pager { display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 14px; color: var(--cw-ink-2); }
</style>
