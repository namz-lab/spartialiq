<script setup lang="ts">
/**
 * One creditor's statement of account in one book: brought forward, each entry on the payable
 * control accounts with the server's running balance, carried forward, and the documents still
 * open. It is the same server read as a debtor's statement, asked for `kind=payable`. Every figure is
 * the server's, as sent; a payment is prepared from Accounts Payable, not here.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, FileText, Printer } from 'lucide-vue-next'
import { accountingApi, type PartyStatement } from '../../../api/accountingApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { AgeingBucket, Bal } from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import DateRange from '../kit/DateRange.vue'
import '../kit/statement.css'
import '../kit/print.css'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'

const COUNCIL = 'Vungu Rural District Council'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const partyId = computed(() => (typeof route.params.partyId === 'string' ? route.params.partyId : ''))
const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const book = computed<Currency>(() => {
  const b = q('book')
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})
const from = ref(q('from'))
const to = ref(q('to'))

const result = ref<PartyStatement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

/** Only the latest request may touch the page: a slow earlier answer is dropped. */
let reqId = 0
const active = (): boolean => route.name === 'acc-creditor'
async function load(): Promise<void> {
  if (!active()) return
  const seq = ++reqId
  if (!partyId.value) { loading.value = false; return }
  error.value = null
  loading.value = true
  try {
    const res = await accountingApi.partyStatement(partyId.value, {
      currency: book.value, kind: 'payable',
      ...(q('from') ? { from: q('from') } : {}), ...(q('to') ? { to: q('to') } : {}),
    })
    if (seq !== reqId) return
    result.value = res
  } catch (err) {
    if (seq !== reqId) return
    result.value = null
    error.value = messageOf(err, 'The statement could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
onMounted(() => { void load() })
watch(() => [book.value, q('from'), q('to'), partyId.value].join('|'), () => {
  if (!active()) return
  from.value = q('from'); to.value = q('to'); void load()
})

function go(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}
const apply = (): void => go({ from: from.value, to: to.value })
const clearRange = (): void => { from.value = ''; to.value = ''; apply() }
const setBook = (c: Currency): void => go({ book: c })

const cur = computed<Currency>(() => result.value?.currency ?? book.value)
const money = (v: string): string => formatMoney(v, cur.value, { bare: true })
const isZero = (v: string): boolean => Number(v) === 0
const balText = (b: Bal): string => `${money(b.amount)} ${b.side}`
const typeLabel = (t: string): string => VOUCHER_TYPE_LABEL[t] ?? t

const AGE: Partial<Record<AgeingBucket, string>> = {
  current: 'Current', '31_60': '31 to 60 days', '61_90': '61 to 90 days', '91_180': '91 to 180 days',
  '181_365': '181 to 365 days', over_365: 'Over 365 days', unallocated: 'Paid beyond the document',
}
const ageLabel = (b: AgeingBucket): string => AGE[b] ?? b

function print(): void { window.print() }
</script>

<template>
  <section class="cw-pagehead no-print">
    <span class="cw-pagehead-icon"><FileText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ result ? result.party.name : 'Creditor' }}</h2>
      <p>The creditor's statement of account in one book, with the documents still unpaid and how old they are.
        <RouterLink class="cw-link" :to="{ name: 'acc-payable' }">Back to Accounts Payable</RouterLink></p>
    </div>
  </section>

  <section class="cw-card cs-toolbar no-print" aria-label="Book and dates">
    <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
    <form class="cs-range" @submit.prevent="apply">
      <DateRange v-model:from="from" v-model:to="to" />
      <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
      <button v-if="q('from') || q('to')" type="button" class="cw-btn" @click="clearRange">Clear dates</button>
    </form>
    <div class="cs-actions"><button type="button" class="cw-btn" :disabled="!result" @click="print"><Printer :size="16" aria-hidden="true" /> Print statement</button></div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

  <CwSkeleton v-if="loading && !result" label="the creditor statement" />

  <template v-else-if="result">
    <header class="print-only cs-print">
      <h1>{{ COUNCIL }}</h1>
      <h2>Creditor statement of account</h2>
    </header>
    <section class="cw-card cs-party" aria-label="Creditor">
      <dl>
        <div><dt>Creditor</dt><dd>{{ result.party.name }}</dd></div>
        <div v-if="result.party.reference"><dt>Account</dt><dd>{{ result.party.reference }}</dd></div>
        <div v-if="result.party.address_text"><dt>Address</dt><dd>{{ result.party.address_text }}</dd></div>
        <div><dt>As at</dt><dd>{{ formatDate(result.as_at) }}</dd></div>
        <div><dt>Book</dt><dd>{{ result.currency }}</dd></div>
      </dl>
    </section>

    <section class="cw-card" aria-label="Unpaid documents">
      <div class="cw-card-body cw-table-wrap">
        <h3 class="cs-h">Unpaid documents</h3>
        <p v-if="!result.open_items.length" class="cw-empty"><strong>Nothing is unpaid in the {{ result.currency }} book.</strong>The council owes this creditor nothing in this book. Choose the other book to check.</p>
        <table v-else class="cw-table st-table cs-table">
          <thead><tr>
            <th>Dated</th><th>Voucher</th><th class="st-num">Raised</th><th class="st-num">Paid</th><th class="st-num">Unpaid</th><th class="st-num">Days</th><th>Age</th>
          </tr></thead>
          <tbody>
            <tr v-for="(i, n) in result.open_items" :key="`${i.voucher_id}|${i.ledger_account_id ?? n}`">
              <td>{{ formatDate(i.posting_date) }}</td>
              <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: i.voucher_id } }">{{ i.voucher_no }}</RouterLink>
                <div class="cw-hint">{{ typeLabel(i.voucher_type) }}</div></td>
              <td class="st-num">{{ money(i.billed_amount) }}</td>
              <td class="st-num">{{ money(i.settled_amount) }}</td>
              <td class="st-num"><strong>{{ money(i.outstanding_amount) }}</strong></td>
              <td class="st-num">{{ i.days_outstanding }}</td>
              <td>{{ ageLabel(i.ageing_bucket) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="cw-card" aria-label="Statement entries">
      <div class="cw-card-body cw-table-wrap">
        <h3 class="cs-h">Entries</h3>
        <table class="cw-table st-table cs-table">
          <caption class="cs-caption">{{ result.currency }} book, as at {{ formatDate(result.as_at) }}. A credit balance is what the council owes.</caption>
          <thead><tr>
            <th>Date</th><th>Voucher</th><th>Narration</th><th class="st-num">Debit</th><th class="st-num">Credit</th><th class="st-num">Balance</th>
          </tr></thead>
          <tbody>
            <tr class="st-bf"><td colspan="5">Brought forward</td><td class="st-num">{{ balText(result.brought_forward) }}</td></tr>
            <tr v-if="!result.entries.length"><td colspan="6" class="cw-hint">No entries in this book{{ q('from') || q('to') ? ' for these dates' : '' }}.</td></tr>
            <tr v-for="e in result.entries" :key="e.id">
              <td>{{ formatDate(e.posting_date) }}</td>
              <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: e.voucher_id } }">{{ e.voucher_no }}</RouterLink>
                <div class="cw-hint">{{ typeLabel(e.voucher_type) }}</div></td>
              <td>{{ e.narration ?? '' }}</td>
              <td class="st-num">{{ isZero(e.debit) ? '' : money(e.debit) }}</td>
              <td class="st-num">{{ isZero(e.credit) ? '' : money(e.credit) }}</td>
              <td class="st-num">{{ balText(e.balance) }}</td>
            </tr>
            <tr class="st-total"><td colspan="5">Carried forward</td><td class="st-num">{{ balText(result.carried_forward) }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.cs-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.cs-range { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.cs-actions { display: flex; gap: 8px; margin-left: auto; }
.cs-party { padding: 14px 16px; margin-bottom: 12px; }
.cs-party dl { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 0; }
.cs-party dt { font-size: 12px; color: var(--cw-ink-3); }
.cs-party dd { margin: 0; font-weight: 600; }
.cs-h { margin: 12px 0 8px; font-size: 15px; }
.cs-caption { text-align: left; font-size: 12.5px; color: var(--cw-ink-3); caption-side: top; padding: 6px 0; }
.cs-table { min-width: 640px; }
.cs-print h1 { font-size: 20px; margin: 0; }
.cs-print h2 { font-size: 16px; margin: 0 0 8px; }
</style>
