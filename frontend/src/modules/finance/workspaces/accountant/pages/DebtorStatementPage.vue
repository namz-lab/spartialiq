<script setup lang="ts">
/**
 * One debtor's statement of account in one book: brought forward, each entry on the receivable
 * control account with the server's running balance, carried forward, and the open items. A credit
 * note or write-off against an open item is raised as a draft through the guided dialog; the open
 * figure moves only when somebody else posts it.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CircleCheck, FileText, Printer } from 'lucide-vue-next'
import { accountingApi, type PartyStatement } from '../../../api/accountingApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { Bal, LedgerAccount } from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import DateRange from '../kit/DateRange.vue'
import GuidedJournalDialog from '../kit/GuidedJournalDialog.vue'
import { useLedgerLists } from '../kit/useLedgerLists'
import '../kit/statement.css'
import '../kit/print.css'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'

const PREPARE = 'finance.ledger.voucher.prepare'
const COUNCIL = 'Vungu Rural District Council'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const { accounts, loadAccounts, error: listError } = useLedgerLists()
/** Whether the chart has been read: the sentence for a bill with no account depends on it. */
const chart = ref<'loading' | 'ready' | 'failed'>('loading')

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
const notice = ref<string | null>(null)

/** Only the latest request may touch the page: a slow earlier answer is dropped. */
let reqId = 0
const active = (): boolean => route.name === 'acc-debtor'
async function load(): Promise<void> {
  if (!active()) return
  const seq = ++reqId
  if (!store.selectedYearId || !partyId.value) { loading.value = false; return }
  error.value = null
  loading.value = true
  try {
    const res = await accountingApi.partyStatement(partyId.value, {
      currency: book.value, ...(q('from') ? { from: q('from') } : {}), ...(q('to') ? { to: q('to') } : {}),
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
onMounted(() => {
  void load()
  void loadAccounts().then(() => { chart.value = listError.value ? 'failed' : 'ready' })
})
watch(() => [book.value, q('from'), q('to'), partyId.value].join('|'), () => {
  // A document raised for another party, book or range must not stay open, and its notice goes.
  closeForChange()
  if (!active()) return
  from.value = q('from'); to.value = q('to'); void load()
})
watch(() => store.selectedYearId, () => { closeForChange(); void load() })

function go(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}
const apply = (): void => go({ from: from.value, to: to.value })
const clearRange = (): void => { from.value = ''; to.value = ''; apply() }
const setBook = (c: Currency): void => go({ book: c })

// Figures and labels both come from the accepted response.
const cur = computed<Currency>(() => result.value?.currency ?? book.value)
const money = (v: string): string => formatMoney(v, cur.value, { bare: true })
const isZero = (v: string): boolean => Number(v) === 0
const balText = (b: Bal): string => `${money(b.amount)} ${b.side}`
const owing = (v: string): boolean => Number(v) > 0
const typeLabel = (t: string): string => VOUCHER_TYPE_LABEL[t] ?? t

type Item = PartyStatement['open_items'][number]
const CHART_FAILED = 'The chart of accounts could not be read, so a credit note or write-off cannot be raised here. Reload the page.'
const CHART_LOADING = 'Loading the chart of accounts…'
const NOT_IN_CHART = 'The receivable account of this bill is not in the active chart (it may be inactive); raise the credit note as a journal.'
/**
 * The receivable account a bill was posted to: the server's own, else the single account code on the
 * bill's entries in this statement. Where it cannot be said for certain, the reason in words.
 */
function receivableOf(item: Item): { account: LedgerAccount } | { say: string } {
  if (chart.value === 'loading') return { say: CHART_LOADING }
  if (chart.value === 'failed') return { say: CHART_FAILED }
  if (item.ledger_account_id) {
    const a = accounts.value.find(x => x.id === item.ledger_account_id)
    return a ? { account: a } : { say: NOT_IN_CHART }
  }
  const codes = [...new Set((result.value?.entries ?? []).filter(e => e.voucher_id === item.voucher_id).map(e => e.account_code))]
  if (codes.length > 1) return { say: 'This bill spans more than one receivable account; raise the credit note as a journal.' }
  if (codes.length === 1) {
    const a = accounts.value.find(x => x.code === codes[0])
    return a ? { account: a } : { say: NOT_IN_CHART }
  }
  if (q('from') || q('to')) return { say: 'Clear the dates to raise a credit note against this bill.' }
  const sole = accounts.value.filter(a => a.account_type === 'receivable' && a.is_postable && !a.is_group)
  return sole.length === 1 ? { account: sole[0] } : { say: 'The receivable account of this bill could not be identified; raise the credit note as a journal.' }
}
const rowKey = (i: Item, n: number): string => (i.ledger_account_id ? `${i.voucher_id}|${i.ledger_account_id}` : `${i.voucher_id}|${n}`)

const canPrepare = computed(() => store.can(PREPARE))
type Doc = { kind: 'credit_note' | 'write_off'; item: Item; account: LedgerAccount; partyName: string }
const doc = ref<Doc | null>(null)
const docBusy = ref(false)
/** A change arrived while a save was in flight: close when its outcome is known. */
const pendingClose = ref(false)
const docName = (d: Doc): string => (d.kind === 'credit_note' ? 'Credit note' : 'Write-off')
function closeForChange(): void {
  notice.value = null
  if (doc.value && docBusy.value) { pendingClose.value = true; return }
  doc.value = null
}
function onBusy(b: boolean): void { docBusy.value = b }
/** A refused save: with a change already waiting, say why in the notice and close. */
function onFailed(message: string): void {
  if (!pendingClose.value || !doc.value) return
  notice.value = `The ${docName(doc.value).toLowerCase()} against ${doc.value.item.voucher_no} for ${doc.value.partyName} was not saved: ${message}`
  pendingClose.value = false
  docBusy.value = false
  doc.value = null
}
const openerBtn = ref<HTMLElement | null>(null)
function openDoc(kind: Doc['kind'], item: Doc['item'], e: Event): void {
  const r = receivableOf(item)
  if (!('account' in r)) return
  openerBtn.value = e.currentTarget as HTMLElement
  docBusy.value = false
  pendingClose.value = false
  doc.value = { kind, item, account: r.account, partyName: result.value?.party.name ?? 'the debtor' }
}
async function closeDoc(): Promise<void> {
  pendingClose.value = false
  docBusy.value = false
  doc.value = null
  await nextTick()
}
function onSaved(v: { id: string; voucher_no: string }): void {
  const d = doc.value
  notice.value = d
    ? `${docName(d)} ${v.voucher_no} saved as a draft for ${d.partyName}. The open figure changes when it is posted.`
    : 'Saved as a draft. The open figure changes when it is posted.'
  if (pendingClose.value) { pendingClose.value = false; docBusy.value = false; doc.value = null }
  void load()
}
const revenueFilter = (a: LedgerAccount): boolean => a.root_type === 'revenue'
const expenseFilter = (a: LedgerAccount): boolean => a.root_type === 'expense'
const raisable = (item: Item): boolean => owing(item.outstanding_amount) && item.ageing_bucket !== 'unallocated' && item.ageing_bucket !== 'settled'

function print(): void { window.print() }
</script>

<template>
  <section class="cw-pagehead no-print">
    <span class="cw-pagehead-icon"><FileText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ result ? result.party.name : 'Debtor' }}</h2>
      <p>The statement of account in one book, with what is still open and how old it is.
        <RouterLink class="cw-link" :to="{ name: 'acc-receivable' }">Back to Debtors</RouterLink></p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>A statement is read once a financial year is chosen.</p>
  </section>

  <template v-else>
    <section class="cw-card ds-toolbar no-print" aria-label="Book and dates">
      <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
      <form class="ds-range" @submit.prevent="apply">
        <DateRange v-model:from="from" v-model:to="to" />
        <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
        <button v-if="q('from') || q('to')" type="button" class="cw-btn" @click="clearRange">Clear dates</button>
      </form>
      <div class="ds-actions"><button type="button" class="cw-btn" :disabled="!result" @click="print"><Printer :size="16" aria-hidden="true" /> Print statement</button></div>
    </section>

    <div role="status" class="no-print"><p v-if="notice" class="cw-banner-msg"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p></div>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading && !result" label="the statement" />

    <template v-else-if="result">
      <header class="print-only ds-print">
        <h1>{{ COUNCIL }}</h1>
        <h2>Statement of account</h2>
      </header>
      <section class="cw-card ds-party" aria-label="Debtor">
        <dl>
          <div><dt>Debtor</dt><dd>{{ result.party.name }}</dd></div>
          <div v-if="result.party.reference"><dt>Account</dt><dd>{{ result.party.reference }}</dd></div>
          <div v-if="result.party.address_text"><dt>Address</dt><dd>{{ result.party.address_text }}</dd></div>
          <div><dt>As at</dt><dd>{{ formatDate(result.as_at) }}</dd></div>
          <div><dt>Book</dt><dd>{{ result.currency }}</dd></div>
        </dl>
      </section>

      <section class="cw-card" aria-label="Open items">
        <div class="cw-card-body cw-table-wrap">
          <h3 class="ds-h">Open items as at {{ formatDate(result.as_at) }}</h3>
          <p v-if="!result.open_items.length" class="cw-empty"><strong>Nothing is open in the {{ result.currency }} book.</strong>This debtor owes nothing in this book. Choose the other book to check.</p>
          <table v-else class="st-table ds-table">
            <thead><tr>
              <th>Date</th><th>Voucher</th><th class="st-num">Billed</th><th class="st-num">Settled</th><th class="st-num">Outstanding</th><th class="st-num">Days</th>
              <th class="no-print"><span class="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              <tr v-for="(i, n) in result.open_items" :key="rowKey(i, n)">
                <td>{{ formatDate(i.posting_date) }}</td>
                <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: i.voucher_id } }">{{ i.voucher_no }}</RouterLink>
                  <div class="cw-hint">{{ typeLabel(i.voucher_type) }}</div></td>
                <td class="st-num">{{ money(i.billed_amount) }}</td>
                <td class="st-num">{{ money(i.settled_amount) }}</td>
                <td class="st-num"><strong>{{ money(i.outstanding_amount) }}</strong>
                  <span v-if="i.ageing_bucket === 'unallocated'" class="cw-hint"> receipt not yet matched</span></td>
                <td class="st-num">{{ i.days_outstanding }}</td>
                <td class="no-print"><div class="ds-row-actions">
                  <template v-if="canPrepare && raisable(i)">
                    <template v-if="'account' in receivableOf(i)">
                    <button type="button" class="cw-btn cw-btn--small" :aria-label="`Credit note against ${i.voucher_no}`" @click="openDoc('credit_note', i, $event)">Credit note</button>
                    <button type="button" class="cw-btn cw-btn--small" :aria-label="`Write-off against ${i.voucher_no}`" @click="openDoc('write_off', i, $event)">Write-off</button>
                    </template>
                    <span v-else class="cw-hint ds-say">{{ (receivableOf(i) as { say: string }).say }}</span>
                  </template>
                </div></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!canPrepare && result.open_items.length" class="cw-hint no-print">{{ store.whyUnavailable(PREPARE) }}</p>
        </div>
      </section>

      <section class="cw-card" aria-label="Statement entries">
        <div class="cw-card-body cw-table-wrap">
          <h3 class="ds-h">Entries</h3>
          <table class="st-table ds-table">
            <caption class="ds-caption">{{ result.currency }} book, as at {{ formatDate(result.as_at) }}</caption>
            <thead><tr>
              <th>Date</th><th>Voucher</th><th>Narration</th><th class="st-num">Debit</th><th class="st-num">Credit</th><th class="st-num">Balance</th>
            </tr></thead>
            <tbody>
              <tr class="st-bf"><th scope="row" colspan="5">Brought forward</th><td class="st-num">{{ balText(result.brought_forward) }}</td></tr>
              <tr v-if="!result.entries.length"><td colspan="6" class="cw-hint">No entries in this book{{ q('from') || q('to') ? ' for these dates' : '' }}.</td></tr>
              <tr v-for="e in result.entries" :key="e.id">
                <th scope="row">{{ formatDate(e.posting_date) }}</th>
                <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: e.voucher_id } }">{{ e.voucher_no }}</RouterLink>
                  <div class="cw-hint">{{ typeLabel(e.voucher_type) }}</div></td>
                <td>{{ e.narration ?? '' }}</td>
                <td class="st-num">{{ isZero(e.debit) ? '' : money(e.debit) }}</td>
                <td class="st-num">{{ isZero(e.credit) ? '' : money(e.credit) }}</td>
                <td class="st-num">{{ balText(e.balance) }}</td>
              </tr>
              <tr class="st-total"><th scope="row" colspan="5">Carried forward</th><td class="st-num">{{ balText(result.carried_forward) }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </template>

  <GuidedJournalDialog
    v-if="doc" :opener="openerBtn" :voucher-type="doc.kind" :currency="cur" party-on="fixed" :party="{ id: result?.party.id ?? '', name: result?.party.name ?? '' }"
    :title="doc.kind === 'credit_note' ? 'Credit note' : 'Write-off'"
    :lead="doc.kind === 'credit_note' ? `Reduces what ${result?.party.name ?? 'the debtor'} owes on ${doc.item.voucher_no}, against a revenue account.` : `Writes off what ${result?.party.name ?? 'the debtor'} owes on ${doc.item.voucher_no}, against an expense account.`"
    :fixed="{ ledger_account_id: doc.account.id, side: 'credit', label: `${doc.account.code} ${doc.account.name}` }"
    :counter="{ label: doc.kind === 'credit_note' ? 'Revenue account' : 'Expense account', filter: doc.kind === 'credit_note' ? revenueFilter : expenseFilter }"
    :against="{ voucher_id: doc.item.voucher_id, voucher_no: doc.item.voucher_no, max: doc.item.outstanding_amount }"
    @saved="onSaved" @busy="onBusy" @failed="onFailed" @close="closeDoc" />
</template>

<style scoped>
.ds-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.ds-range { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.ds-actions { display: flex; gap: 8px; margin-left: auto; }
.ds-party { padding: 14px 16px; margin-bottom: 12px; }
.ds-party dl { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 0; }
.ds-party dt { font-size: 12px; color: var(--cw-ink-3); }
.ds-party dd { margin: 0; font-weight: 600; }
.ds-h { margin: 12px 0 8px; font-size: 15px; }
.ds-caption { text-align: left; font-size: 12.5px; color: var(--cw-ink-3); caption-side: top; padding: 6px 0; }
.ds-table { min-width: 640px; }
.ds-row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ds-print h1 { font-size: 20px; margin: 0; }
.ds-print h2 { font-size: 16px; margin: 0 0 8px; }
</style>
