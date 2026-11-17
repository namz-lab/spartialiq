<script setup lang="ts">
/**
 * One account's ledger in one book: brought forward, each entry with the server's running balance,
 * period totals and carried forward. Figures are shown as sent, including the running balance, so
 * page 2 continues from page 1. A balance on the side opposite the account's nature is shown on its
 * real side and marked in words.
 *
 * Reused by the Cashbook with `mode="cashbook"`: no page head of its own, a Reconciled column and an
 * `actions` slot in the toolbar. The range lives in the route query (`book`, `from`, `to`, `offset`).
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, BookText, Download, Printer } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { AccountBalanceResult, AccountLedgerQuery, AccountLedgerResult, Bal } from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import DateRange from '../kit/DateRange.vue'
import Pager from '../kit/Pager.vue'
import { csvName, saveBlob } from '../kit/csv'
import '../kit/statement.css'
import '../kit/print.css'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'

const props = defineProps<{ accountId?: string; mode?: 'cashbook' }>()

const LIMIT = 100
const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const id = computed(() => props.accountId ?? (typeof route.params.id === 'string' ? route.params.id : ''))
const cashbook = computed(() => props.mode === 'cashbook')

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const book = computed<Currency>(() => {
  const b = q('book')
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})
const offset = computed(() => Math.max(0, Number(q('offset')) || 0))
const from = ref(q('from'))
const to = ref(q('to'))

const result = ref<AccountLedgerResult | null>(null)
const lifetime = ref<AccountBalanceResult | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const exporting = ref(false)
const exportError = ref<string | null>(null)

function params(): AccountLedgerQuery {
  const p: AccountLedgerQuery = { financial_year_id: store.selectedYearId as string, currency: book.value, limit: LIMIT, offset: offset.value }
  if (q('from')) p.from = q('from')
  if (q('to')) p.to = q('to')
  return p
}

/** Only the latest request may touch the page: a slow earlier answer is dropped. */
let reqId = 0
/** On its own route the page reads only while the address is an account's; embedded it always does. */
const active = (): boolean => cashbook.value || route.name === 'acc-account'
async function load(): Promise<void> {
  if (!active()) return
  const seq = ++reqId
  if (!store.selectedYearId || !id.value) { loading.value = false; return }
  error.value = null
  loading.value = true
  try {
    const [ledger, bal] = await Promise.all([
      ledgerApi.accountLedger(id.value, params()),
      ledgerApi.accountBalance(id.value).catch(() => null),
    ])
    if (seq !== reqId) return
    result.value = ledger
    lifetime.value = bal
  } catch (err) {
    if (seq !== reqId) return
    result.value = null
    error.value = messageOf(err, 'The account could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}

function go(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}

onMounted(() => { void load() })
// Only the keys this page owns, so leaving for a voucher asks the server for nothing.
watch(() => [q('book'), q('from'), q('to'), q('offset')].join('|'), () => {
  if (!active()) return
  from.value = q('from'); to.value = q('to'); void load()
})
watch(() => id.value, () => { void load() })
// A new year starts at the first page.
watch(() => store.selectedYearId, () => {
  if (offset.value) go({ offset: undefined })
  else void load()
})

const account = computed(() => result.value?.account ?? lifetime.value?.account ?? null)
const total = computed(() => result.value?.total ?? 0)
const first = computed(() => offset.value === 0)
const last = computed(() => offset.value + LIMIT >= total.value)

const cur = computed(() => result.value?.currency ?? book.value)
const money = (v: string): string => formatMoney(v, cur.value, { bare: true })
const isZero = (v: string): boolean => Number(v) === 0
const against = (b: Bal): boolean => {
  // A zero balance arrives as 'Dr' whatever the account; it is on no side, so it is never marked.
  if (Number(b.amount) === 0) return false
  const natural = result.value?.natural_side ?? lifetime.value?.natural_side
  if (!natural) return false
  return natural === 'debit' ? b.side === 'Cr' : b.side === 'Dr'
}

/** The lifetime balance in each book: the sign of the server's net debit picks the side. */
const lifetimeRows = computed(() => (lifetime.value?.balances ?? []).map((r) => {
  const credit = r.net_debit.startsWith('-')
  const side: 'Dr' | 'Cr' = credit ? 'Cr' : 'Dr'
  const natural = lifetime.value?.natural_side
  const amount = credit ? r.net_debit.slice(1) : r.net_debit
  return {
    currency: r.currency, amount, side,
    against: Number(amount) !== 0 && (natural === 'debit' ? side === 'Cr' : side === 'Dr'),
  }
}))

function apply(): void { go({ from: from.value, to: to.value, offset: undefined }) }
function clearRange(): void { from.value = ''; to.value = ''; apply() }
function setBook(c: Currency): void { go({ book: c, offset: undefined }) }

async function blobMessage(err: unknown): Promise<string> {
  try {
    const data = (err as { response?: { data?: Blob } }).response?.data
    const text = await data?.text()
    if (text) {
      const parsed = JSON.parse(text) as { message?: string }
      if (parsed.message) return parsed.message
    }
  } catch { /* fall through */ }
  return 'The export could not be made.'
}
async function exportCsv(): Promise<void> {
  if (!account.value || exporting.value) return
  exporting.value = true
  exportError.value = null
  try {
    const blob = await ledgerApi.accountLedgerCsv(id.value, params())
    saveBlob(blob, csvName([account.value.code, book.value, q('from'), q('to')]))
  } catch (err) {
    exportError.value = await blobMessage(err)
  } finally {
    exporting.value = false
  }
}

const reconciledText = (r: boolean | null): string => (r === true ? 'Reconciled' : r === false ? 'Not reconciled' : '—')
function print(): void { window.print() }
</script>

<template>
  <section v-if="!cashbook" class="cw-pagehead">
    <span class="cw-pagehead-icon"><BookText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ account ? `${account.code} ${account.name}` : 'Account' }}</h2>
      <p>The account's postings in one book, with the running balance after each entry.
        <RouterLink class="cw-link" :to="{ name: 'acc-ledger' }">Back to the General Ledger</RouterLink></p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>An account's ledger is read one financial year at a time.</p>
  </section>

  <template v-else>
    <section class="cw-card ac-toolbar no-print" aria-label="Book and dates">
      <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
      <form class="ac-range" @submit.prevent="apply">
        <DateRange v-model:from="from" v-model:to="to" />
        <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
        <button v-if="q('from') || q('to')" type="button" class="cw-btn" @click="clearRange">Clear dates</button>
      </form>
      <div class="ac-actions">
        <slot name="actions" />
        <button type="button" class="cw-btn" :aria-disabled="!account || exporting ? 'true' : undefined" @click="exportCsv"><Download :size="16" aria-hidden="true" /> Export CSV</button>
        <button type="button" class="cw-btn" @click="print"><Printer :size="16" aria-hidden="true" /> Print</button>
      </div>
    </section>

    <p v-if="exportError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ exportError }}</p>

    <section v-if="lifetimeRows.length" class="cw-card ac-life" aria-label="Lifetime balance">
      <span class="ac-life-title">Balance to date, every year</span>
      <span v-for="r in lifetimeRows" :key="r.currency" class="ac-life-item">
        <span :class="{ 'is-contra': r.against }">{{ r.currency }} {{ formatMoney(r.amount, r.currency, { bare: true }) }} {{ r.side }}</span>
        <span v-if="r.against" class="ac-note">against its usual side</span>
      </span>
    </section>

    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading" label="the account ledger" />

    <section v-else-if="result && !result.entries.length && first" class="cw-card">
      <p class="cw-empty"><strong>No entries in this book{{ q('from') || q('to') ? ' for these dates' : '' }}.</strong>
        {{ q('from') || q('to') ? 'Clear the dates or choose the other book.' : 'Posted entries appear here. Choose the other book to see its postings.' }}
        Brought forward {{ money(result.brought_forward.amount) }} {{ result.brought_forward.side }}.</p>
    </section>

    <section v-else-if="result" class="cw-card" aria-label="Account ledger">
      <div class="cw-card-body cw-table-wrap">
        <table class="st-table ac-table">
          <caption class="ac-caption">{{ account?.code }} {{ account?.name }}, {{ result.currency }} book, {{ formatDate(result.from) }} to {{ formatDate(result.to) }}</caption>
          <thead><tr>
            <th>Date</th><th>Voucher</th><th>Narration</th><th class="st-num">Debit</th><th class="st-num">Credit</th><th class="st-num">Balance</th>
            <th v-if="cashbook">Reconciled</th>
          </tr></thead>
          <tbody>
            <tr v-if="first" class="st-bf">
              <th scope="row" colspan="5">Brought forward</th>
              <td class="st-num" :class="{ 'is-contra': against(result.brought_forward) }">{{ money(result.brought_forward.amount) }} {{ result.brought_forward.side }}
                <span v-if="against(result.brought_forward)" class="ac-note">against its usual side</span></td>
              <td v-if="cashbook" />
            </tr>
            <tr v-for="e in result.entries" :key="e.id">
              <th scope="row">{{ formatDate(e.posting_date) }}</th>
              <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: e.voucher_id } }">{{ e.voucher_no }}</RouterLink>
                <div class="cw-hint">{{ VOUCHER_TYPE_LABEL[e.voucher_type] ?? e.voucher_type }}</div></td>
              <td>{{ e.narration ?? '' }}<div v-if="e.party_name" class="cw-hint">{{ e.party_name }}</div></td>
              <td class="st-num">{{ isZero(e.debit) ? '' : money(e.debit) }}</td>
              <td class="st-num">{{ isZero(e.credit) ? '' : money(e.credit) }}</td>
              <td class="st-num" :class="{ 'is-contra': against(e.balance) }">{{ money(e.balance.amount) }} {{ e.balance.side }}
                <span v-if="against(e.balance)" class="ac-note">against its usual side</span></td>
              <td v-if="cashbook">{{ reconciledText(e.reconciled) }}</td>
            </tr>
            <template v-if="last">
              <tr class="st-sub">
                <th scope="row" colspan="3">Period totals</th>
                <td class="st-num">{{ money(result.totals.debit) }}</td><td class="st-num">{{ money(result.totals.credit) }}</td><td />
                <td v-if="cashbook" />
              </tr>
              <tr class="st-total">
                <th scope="row" colspan="5">Carried forward</th>
                <td class="st-num" :class="{ 'is-contra': against(result.carried_forward) }">{{ money(result.carried_forward.amount) }} {{ result.carried_forward.side }}
                  <span v-if="against(result.carried_forward)" class="ac-note">against its usual side</span></td>
                <td v-if="cashbook" />
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="print-page-note">Entries {{ offset + 1 }}–{{ Math.min(offset + LIMIT, total) }} of {{ total }}. Export the CSV for the whole range.</p>
      <div class="cw-card-body"><Pager :total="total" :limit="LIMIT" :offset="offset" @update:offset="(o) => go({ offset: o ? String(o) : undefined })" /></div>
    </section>
  </template>
</template>

<style scoped>
.ac-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.ac-range { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.ac-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.ac-life { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 12px 16px; margin-bottom: 12px; align-items: baseline; font-variant-numeric: tabular-nums; }
.ac-life-title { font-weight: 600; }
.ac-life-item { display: inline-flex; gap: 8px; align-items: baseline; }
.ac-caption { text-align: left; padding: 10px 12px; font-size: 12.5px; color: var(--cw-ink-3); caption-side: top; }
.ac-table { min-width: 720px; }
.is-contra { color: var(--cw-neg); }
.ac-note { display: block; font-size: 11.5px; font-weight: 500; }
.ac-life-item .ac-note { display: inline; }
</style>
