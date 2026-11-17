<script setup lang="ts">
/**
 * The bills register: every rates bill issued, searchable by bill, account, ratepayer or stand,
 * with what each still has open. Totals come from the server per currency and status, over the
 * whole filtered set, so the figure at the foot is never the sum of one page or of two currencies.
 *
 * Read only (`GET /finance/rates/bills`, finance.rates.view). Bills are raised by a billing run and
 * posted by somebody else; a correction is a credit note in the ledger, never an edit here.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { FileStack, Download, AlertTriangle, Search } from 'lucide-vue-next'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import type { DocumentTotal, RatesBill, VoucherStatus } from '../../../models/ratesTypes'
import { downloadCsv, readAll, toCsv } from '../kit'

const PAGE = 50
const store = useFinanceStore()
const filters = reactive({ q: '', status: '' as VoucherStatus | '', currency: '' as Currency | '', thisYear: true })
const offset = ref(0)
const bills = ref<RatesBill[]>([])
const totals = ref<DocumentTotal[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const yearId = computed(() => store.selectedYearId ?? null)
const params = () => ({
  q: filters.q.trim() || undefined,
  status: filters.status || undefined,
  currency: filters.currency || undefined,
  financial_year_id: filters.thisYear && yearId.value ? yearId.value : undefined,
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const r = await ratesApi.bills({ ...params(), limit: PAGE, offset: offset.value })
    bills.value = r.bills
    totals.value = r.totals
    total.value = r.total
  } catch (err) {
    error.value = messageOf(err, 'The bills could not be read.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

let timer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.q, () => { clearTimeout(timer); timer = setTimeout(() => { offset.value = 0; void load() }, 300) })
watch(() => [filters.status, filters.currency, filters.thisYear, yearId.value], () => { offset.value = 0; void load() })

function page(dir: 1 | -1): void {
  const next = offset.value + dir * PAGE
  if (next < 0 || next >= total.value) return
  offset.value = next
  void load()
}

const STATUS: Record<VoucherStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'cw-pill--warn' },
  posted: { label: 'Issued', tone: 'cw-pill--pos' },
  cancelled: { label: 'Cancelled', tone: 'cw-pill--mute' },
}

async function exportCsv(): Promise<void> {
  exporting.value = true
  error.value = null
  notice.value = null
  try {
    const all = await readAll(async (limit, off) => {
      const r = await ratesApi.bills({ ...params(), limit, offset: off })
      return { rows: r.bills, total: r.total }
    })
    const head = ['Bill No', 'Account No', 'Ratepayer', 'Stand No', 'Ward', 'Period from', 'Period to', 'Issued', 'Due',
      'Rateable value', 'Rate in the dollar', 'Currency', 'Amount', 'Open', 'Status']
    const rows = all.rows.map((b) => [b.bill_no, b.account_no, b.party_name, b.stand_no, b.ward_code, b.period_from, b.period_to,
      b.issued_on, b.due_on, b.rateable_value, b.rate_in_dollar, b.currency, b.amount, b.open_amount, STATUS[b.voucher_status].label])
    downloadCsv('rates-bills.csv', toCsv(head, rows))
    if (all.truncated) notice.value = `The export holds the first ${all.rows.length} of ${all.total} bills. Narrow the list to export the rest.`
  } catch (err) {
    error.value = messageOf(err, 'The bills could not be exported.')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileStack :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Bills Register</h2>
      <p>Every rates bill issued, what it charged and what is still open on it.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--info" role="status">{{ notice }}</p>

  <section class="cw-card" aria-labelledby="br-h">
    <div class="cw-card-head">
      <h3 id="br-h">Bills</h3>
      <span class="cw-spacer" />
      <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="!total || exporting" @click="exportCsv">
        <Download :size="16" aria-hidden="true" /> {{ exporting ? 'Exporting' : 'Export CSV' }}
      </button>
    </div>
    <div class="cw-card-body">
      <form class="br-filters" role="search" @submit.prevent="load">
        <label class="cw-field br-grow"><span class="cw-label">Search</span>
          <span class="br-search"><Search :size="16" aria-hidden="true" />
            <input v-model="filters.q" class="cw-input" type="search" placeholder="Bill, account, ratepayer or stand number" /></span>
        </label>
        <label class="cw-field"><span class="cw-label">Status</span>
          <select v-model="filters.status" class="cw-input">
            <option value="">Any</option><option value="posted">Issued</option><option value="draft">Draft</option><option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label class="cw-field"><span class="cw-label">Currency</span>
          <select v-model="filters.currency" class="cw-input"><option value="">Both</option><option>USD</option><option>ZWG</option></select>
        </label>
        <label v-if="yearId" class="cw-check br-check"><input v-model="filters.thisYear" type="checkbox" /> Selected financial year only</label>
      </form>

      <div class="cw-table-wrap">
        <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!bills.length" class="cw-empty">No bill matches.</p>
        <table v-else class="cw-table">
          <thead>
            <tr><th>Bill</th><th>Account</th><th>Ratepayer</th><th>Stand</th><th>Period</th><th>Due</th>
              <th class="r">Amount</th><th class="r">Open</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in bills" :key="b.id">
              <td class="num">{{ b.bill_no }}</td>
              <td class="num"><RouterLink class="cw-link" :to="{ name: 'rev-statement', params: { id: b.rates_account_id } }">{{ b.account_no }}</RouterLink></td>
              <td>{{ b.party_name }}</td><td>{{ b.stand_no ?? '—' }}</td>
              <td>{{ formatDate(b.period_from) }} to {{ formatDate(b.period_to) }}</td>
              <td>{{ formatDate(b.due_on) }}</td>
              <td class="r num">{{ formatMoney(b.amount, b.currency) }}</td>
              <td class="r num">{{ b.voucher_status === 'cancelled' ? '—' : formatMoney(b.open_amount, b.currency) }}</td>
              <td><span class="cw-pill" :class="STATUS[b.voucher_status].tone">{{ STATUS[b.voucher_status].label }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="total > PAGE" class="br-pager" aria-label="Pages">
        <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="offset === 0 || loading" @click="page(-1)">Previous</button>
        <span class="cw-hint">{{ offset + 1 }} to {{ Math.min(offset + PAGE, total) }} of {{ total }}</span>
        <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="offset + PAGE >= total || loading" @click="page(1)">Next</button>
      </nav>

      <table v-if="totals.length" class="cw-table br-totals" aria-label="Totals over every matching bill">
        <thead><tr><th>Currency</th><th>Status</th><th class="r">Bills</th><th class="r">Amount</th></tr></thead>
        <tbody>
          <tr v-for="t in totals" :key="t.currency + t.voucher_status">
            <td>{{ t.currency }}</td><td>{{ STATUS[t.voucher_status].label }}</td>
            <td class="r num">{{ t.bills ?? '—' }}</td><td class="r num">{{ formatMoney(t.amount, t.currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.br-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 14px; }
.br-filters .cw-field { min-width: 140px; }
.br-grow { flex: 1 1 260px; }
.br-check { align-self: center; }
.br-search { position: relative; display: flex; align-items: center; }
.br-search svg { position: absolute; left: 10px; color: var(--cw-ink-2); }
.br-search input { padding-left: 32px; }
.br-pager { display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 12px; }
.br-totals { margin-top: 18px; max-width: 560px; }
</style>
