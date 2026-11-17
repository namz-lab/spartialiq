<script setup lang="ts">
/**
 * The cashbook: one bank or cash account at a time, its ledger in one book, and three documents
 * that raise a draft voucher against it (Payment, Receipt, Transfer). Head figures are the server's,
 * shown as sent. The account chosen lives in the route query as `account`; the ledger beneath owns
 * `book`, `from`, `to` and `offset`.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Landmark } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { CashAccountRow, LedgerAccount } from '../../../models/ledgerTypes'
import AccountLedgerPage from './AccountLedgerPage.vue'
import GuidedJournalDialog from '../kit/GuidedJournalDialog.vue'
import { useLedgerLists } from '../kit/useLedgerLists'

const PREPARE = 'finance.ledger.voucher.prepare'
const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const { periods, loadPeriods, error: listError } = useLedgerLists()

const rows = ref<CashAccountRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  const year = store.selectedYearId
  if (!year) { loading.value = false; rows.value = []; return }
  loading.value = true
  error.value = null
  try {
    const res = await ledgerApi.cashAccounts(year)
    if (seq !== reqId) return
    rows.value = res.accounts
  } catch (err) {
    if (seq !== reqId) return
    rows.value = []
    error.value = messageOf(err, 'The bank and cash accounts could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
  await loadYearPeriods(seq, year)
}

/** The periods of the selected year, read afresh on every load: a period closed elsewhere must not read as open. */
const periodsState = ref<'loading' | 'ready' | 'failed'>('loading')
const periodsError = ref<string | null>(null)
async function loadYearPeriods(seq: number, year: string): Promise<void> {
  if (!store.can(PREPARE)) return
  periodsState.value = 'loading'
  periodsError.value = null
  const ok = await loadPeriods(year)
  if (seq !== reqId) return
  if (ok) periodsState.value = 'ready'
  else { periodsState.value = 'failed'; periodsError.value = listError.value ?? 'The accounting periods could not be read.' }
}
watch(() => store.selectedYearId, () => { void load() }, { immediate: true })

const choices = computed(() => {
  const seen = new Map<string, CashAccountRow>()
  for (const r of rows.value) if (!seen.has(r.id)) seen.set(r.id, r)
  return [...seen.values()]
})
const selectedId = computed(() => {
  const q = route.query.account
  const wanted = typeof q === 'string' ? q : ''
  return choices.value.some(c => c.id === wanted) ? wanted : (choices.value[0]?.id ?? '')
})
function choose(id: string): void {
  void router.replace({ query: { ...route.query, account: id, offset: undefined } })
}
const book = computed(() => {
  const b = route.query.book
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})
const row = computed(() => rows.value.find(r => r.id === selectedId.value && r.currency === book.value) ?? null)
const account = computed(() => choices.value.find(c => c.id === selectedId.value) ?? null)
const money = (v: string | null): string => formatMoney(v, book.value)

const canPrepare = computed(() => store.can(PREPARE))
const periodOk = computed(() => periodsState.value === 'ready' && periods.value.some(p => p.status === 'open'))
const documents = ref<'payment' | 'receipt' | 'transfer' | null>(null)
const openerBtn = ref<HTMLElement | null>(null)
function openDoc(kind: 'payment' | 'receipt' | 'transfer', e: Event): void {
  openerBtn.value = e.currentTarget as HTMLElement
  documents.value = kind
}
async function closeDoc(): Promise<void> {
  documents.value = null
  await nextTick()
}

const isCash = (a: LedgerAccount): boolean => a.account_type === 'bank' || a.account_type === 'cash'
const paymentFilter = (a: LedgerAccount): boolean => !isCash(a) && a.account_type !== 'payable'
const receiptFilter = (a: LedgerAccount): boolean => !isCash(a)
const transferFilter = (a: LedgerAccount): boolean => isCash(a) && a.id !== selectedId.value
const fixedFor = (side: 'debit' | 'credit') => ({
  ledger_account_id: selectedId.value, side, label: account.value ? `${account.value.code} ${account.value.name}` : '',
})
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Cashbook</h2>
      <p>Receipts and payments through each bank and cash account, with what has been reconciled.</p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The cashbook is read one financial year at a time.</p>
  </section>

  <template v-else>
    <CwSkeleton v-if="loading" label="the cashbook" />

    <p v-else-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn" @click="load">Retry</button>
    </p>

    <section v-else-if="!choices.length" class="cw-card">
      <p class="cw-empty"><strong>There is no bank or cash account in the chart yet.</strong>
        Bank and cash accounts are set up in the chart of accounts.
        <RouterLink class="cw-link" :to="{ name: 'acc-ledger' }">Open the General Ledger</RouterLink></p>
    </section>

    <template v-else>
      <section class="cw-card cb-head" aria-label="Account and figures">
        <div class="cw-field">
          <label class="cw-label" for="cb-account">Account</label>
          <select id="cb-account" class="cw-input" :value="selectedId" @change="choose(($event.target as HTMLSelectElement).value)">
            <option v-for="c in choices" :key="c.id" :value="c.id">{{ c.code }} {{ c.name }}</option>
          </select>
        </div>
        <dl v-if="row" class="cb-figs">
          <div><dt>Ledger balance</dt><dd>{{ formatMoney(row.balance.amount, row.currency) }} {{ row.balance.side }}</dd></div>
          <div v-if="row.unreconciled">
            <dt>Reconciliation</dt>
            <dd v-if="row.reconciled_to">Reconciled to {{ formatDate(row.reconciled_to) }} at {{ money(row.reconciled_balance) }}</dd>
            <dd v-else>Never reconciled</dd>
          </div>
          <div v-if="row.unreconciled">
            <dt>Not yet reconciled</dt>
            <dd><RouterLink class="cw-link" :to="{ name: 'acc-bank' }">{{ row.unreconciled.entries }} {{ row.unreconciled.entries === 1 ? 'entry' : 'entries' }}</RouterLink></dd>
          </div>
        </dl>
        <p v-else class="cb-say" role="status">This account has no entries in the {{ book }} book.</p>
      </section>

      <AccountLedgerPage :account-id="selectedId" mode="cashbook">
        <template #actions>
          <template v-if="canPrepare && periodOk">
            <button type="button" class="cw-btn" @click="openDoc('payment', $event)">Payment</button>
            <button type="button" class="cw-btn" @click="openDoc('receipt', $event)">Receipt</button>
            <button type="button" class="cw-btn" @click="openDoc('transfer', $event)">Transfer</button>
          </template>
          <p v-else-if="!canPrepare" class="cb-say">{{ store.whyUnavailable(PREPARE) }}</p>
          <p v-else-if="periodsState === 'loading'" class="cb-say" role="status">Reading the accounting periods.</p>
          <p v-else-if="periodsState === 'failed'" class="cb-say" role="alert">{{ periodsError }} <button type="button" class="cw-btn" @click="load">Retry</button></p>
          <p v-else class="cb-say">No accounting period is open in this financial year, so no payment, receipt or transfer can be raised. Periods are opened and closed in Period Close.</p>
        </template>
      </AccountLedgerPage>

      <GuidedJournalDialog :opener="openerBtn" v-if="documents === 'payment'" title="New payment" :currency="book"
        lead="Money paid out of this account for something other than a supplier invoice."
        :fixed="fixedFor('credit')" :counter="{ label: 'Paid for (account)', filter: paymentFilter }" @close="closeDoc">
        <template #lead>Supplier invoices are paid in <RouterLink class="cw-link" :to="{ name: 'acc-payable' }">Accounts Payable</RouterLink>.</template>
      </GuidedJournalDialog>
      <GuidedJournalDialog :opener="openerBtn" v-if="documents === 'receipt'" title="New receipt" :currency="book"
        lead="Money received into this account that did not come through a cash counter."
        :fixed="fixedFor('debit')" :counter="{ label: 'Received for (account)', filter: receiptFilter }" @close="closeDoc">
        <template #lead>Counter takings come through the <RouterLink class="cw-link" :to="{ name: 'acc-cashups' }">Cash Office</RouterLink>.</template>
      </GuidedJournalDialog>
      <GuidedJournalDialog :opener="openerBtn" v-if="documents === 'transfer'" title="New transfer" :currency="book"
        lead="Money moved from this account to another bank or cash account."
        :fixed="fixedFor('credit')" :counter="{ label: 'Transfer to (account)', filter: transferFilter }" @close="closeDoc" />
    </template>
  </template>
</template>

<style scoped>
.cb-head { display: flex; flex-wrap: wrap; gap: 16px 28px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.cb-figs { display: flex; flex-wrap: wrap; gap: 10px 28px; margin: 0; }
.cb-figs dt { font-size: 12px; color: var(--cw-ink-2); }
.cb-figs dd { margin: 2px 0 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.cb-say { margin: 0; color: var(--cw-ink-2); font-size: 13.5px; }
</style>
