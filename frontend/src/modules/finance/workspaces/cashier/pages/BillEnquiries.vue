<script setup lang="ts">
/** Look a bill up by number, customer or account, see what is still open on it, and pay it. */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, X, AlertTriangle, CreditCard, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf } from '../../../stores/finance'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import type { RatesBill } from '../../../models/ratesTypes'
import { periodLabel } from '../useCashier'

const router = useRouter()
const q = ref('')
const currency = ref<Currency | ''>('')
const openOnly = ref(true)
const rows = ref<RatesBill[]>([])
const total = ref(0)
const offset = ref(0)
const LIMIT = 50
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await ratesApi.bills({
      status: 'posted', limit: LIMIT, offset: offset.value,
      ...(q.value.trim() ? { q: q.value.trim() } : {}),
      ...(currency.value ? { currency: currency.value } : {}),
    })
    rows.value = openOnly.value ? page.bills.filter((b) => b.open_amount !== '0.00') : page.bills
    total.value = page.total
  } catch (err) {
    error.value = messageOf(err, 'The bills could not be read.')
  } finally {
    loading.value = false
  }
}
watch([currency, openOnly], () => { offset.value = 0; void load() })
onMounted(load)

function pay(b: RatesBill): void {
  void router.push({ name: 'cashier-pay', query: { account: b.rates_account_id, bill: b.id } })
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Search :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Bill Enquiries</h2>
      <p>Answer “what do I owe on this bill?” and take the payment from the same place.</p>
    </div>
  </section>

  <section class="cw-card">
    <div class="cw-card-body be-filters" style="padding-top: 20px">
      <form class="cw-search" role="search" style="flex: 2 1 300px" @submit.prevent="offset = 0; load()">
        <Search :size="22" aria-hidden="true" />
        <input v-model="q" class="cw-input" placeholder="Bill number, customer or account" aria-label="Search bills" />
        <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; load()"><X :size="20" /></button>
      </form>
      <div class="cw-seg" role="group" aria-label="Currency" style="flex: 0 0 auto">
        <button type="button" :aria-pressed="currency === ''" @click="currency = ''">All</button>
        <button type="button" :aria-pressed="currency === 'USD'" @click="currency = 'USD'">USD</button>
        <button type="button" :aria-pressed="currency === 'ZWG'" @click="currency = 'ZWG'">ZWG</button>
      </div>
      <label class="be-check"><input v-model="openOnly" type="checkbox" class="cw-check" /> Only bills with something open</label>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <section class="cw-card" aria-label="Bills">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <div v-if="loading && !rows.length"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!rows.length" class="cw-empty"><strong>No bills match.</strong>Bills are issued by the revenue office's billing runs.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Bill / Invoice</th><th>Customer</th><th>Account</th><th>Service</th><th>Period</th><th>Due</th><th class="r">Amount</th><th class="r">Open</th><th><span class="sr-only">Pay</span></th></tr></thead>
        <tbody>
          <tr v-for="b in rows" :key="b.id">
            <td>{{ b.bill_no }}</td><td>{{ b.party_name }}</td><td>{{ b.account_no }}</td><td>Property rates</td>
            <td>{{ periodLabel(b.period_from) }}</td><td>{{ formatDate(b.due_on) }}</td>
            <td class="amt">{{ formatMoney(b.amount, b.currency) }}</td>
            <td class="amt" :class="{ 'cw-neg': b.open_amount !== '0.00' }">{{ formatMoney(b.open_amount, b.currency) }}</td>
            <td><button v-if="b.open_amount !== '0.00'" type="button" class="cw-btn cw-btn--small cw-btn--outline" @click="pay(b)"><CreditCard :size="15" aria-hidden="true" /> Pay</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="total > LIMIT" class="be-pager">
        <span>{{ offset + 1 }}–{{ Math.min(offset + LIMIT, total) }} of {{ total }}</span>
        <button type="button" class="cw-btn cw-btn--small" :disabled="offset === 0" @click="offset -= LIMIT; load()"><ChevronLeft :size="16" aria-hidden="true" /> Previous</button>
        <button type="button" class="cw-btn cw-btn--small" :disabled="offset + LIMIT >= total" @click="offset += LIMIT; load()">Next <ChevronRight :size="16" aria-hidden="true" /></button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.be-filters { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.be-check { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.be-pager { display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 14px; color: var(--cw-ink-2); }
</style>
