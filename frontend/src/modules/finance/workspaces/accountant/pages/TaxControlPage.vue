<script setup lang="ts">
/**
 * Tax Control: each account the chart marks as tax — VAT, PAYE, the NSSA contributions — its
 * balance, its debits and credits by period and its closing balance at each period end, in one book
 * at a time, plus the statutory bodies those accounts say the council owes (ZIMRA, NSSA). Every
 * figure is the server's, shown as sent; nothing is added up here. The CSV beside each account is a
 * worksheet of what the ledger holds, for the person who writes the return; the return itself is
 * not produced here. A payment to a statutory body is a draft voucher, Dr the tax account / Cr a
 * bank account, raised through the guided dialog once the bank account has been chosen.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Building2, Download, Receipt } from 'lucide-vue-next'
import { accountingApi, type TaxControl } from '../../../api/accountingApi'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { LedgerAccount } from '../../../models/ledgerTypes'
import type { Currency } from '../../../models/types'
import BookSwitch from '../kit/BookSwitch.vue'
import GuidedJournalDialog from '../kit/GuidedJournalDialog.vue'
import { useLedgerLists } from '../kit/useLedgerLists'
import { csvName, saveBlob } from '../kit/csv'

const PREPARE = 'finance.ledger.voucher.prepare'
const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const { periods, loadPeriods, error: listError } = useLedgerLists()

const data = ref<TaxControl | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  const year = store.selectedYearId
  if (!year) { loading.value = false; data.value = null; error.value = null; return }
  loading.value = true
  error.value = null
  try {
    const res = await accountingApi.tax(year)
    if (seq !== reqId) return
    data.value = res
  } catch (err) {
    if (seq !== reqId) return
    data.value = null
    error.value = messageOf(err, 'The tax accounts could not be read.')
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

const book = computed<Currency>(() => {
  const b = route.query.book
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})
function setBook(c: Currency): void { void router.replace({ query: { ...route.query, book: c } }) }

const accounts = computed(() => data.value?.accounts ?? [])
const dash = '—'
const isNil = (v: string): boolean => Number(v) === 0

function balanceOf(a: TaxControl['accounts'][number]) {
  return a.balances.find(b => b.currency === book.value) ?? null
}
function balanceText(b: { amount: string; side: 'Dr' | 'Cr' }): string {
  const m = formatMoney(b.amount, book.value)
  return isNil(b.amount) ? m : `${m} ${b.side}`
}
function movementOf(accountId: string, periodId: string) {
  return data.value?.movements.find(m => m.ledger_account_id === accountId && m.period_id === periodId && m.currency === book.value) ?? null
}
function closingOf(accountId: string, periodId: string) {
  return periodBalances.value.find(b => b.ledger_account_id === accountId && b.period_id === periodId && b.currency === book.value) ?? null
}
const rowsFor = (accountId: string) => (data.value?.periods ?? []).map(p => {
  const m = movementOf(accountId, p.period_id)
  const c = closingOf(accountId, p.period_id)
  return {
    period: p,
    debit: m && !isNil(m.debit) ? m.debit : null,
    credit: m && !isNil(m.credit) ? m.credit : null,
    closing: c && !isNil(c.closing) ? c : null,
  }
})
const periodName = (p: { period_no: number; label: string | null }): string => p.label || `Period ${p.period_no}`
const linkFor = (accountId: string, p: { from_date: string; to_date: string }) =>
  ({ name: 'acc-account', params: { id: accountId }, query: { book: book.value, from: p.from_date, to: p.to_date } })

/** The statutory bodies the tax accounts name, in the book being read. A credit is owed. */
const statutoryBodies = computed(() => (data.value?.parties ?? []).filter(p => p.currency === book.value))
const periodBalances = computed(() => data.value?.period_balances ?? [])
const accountOf = (id: string) => accounts.value.find(a => a.id === id) ?? null

/** The worksheet: the control account's own ledger for the year, as the server wrote it. */
const exporting = ref<string | null>(null)
const exportError = ref<string | null>(null)
async function exportWorksheet(a: TaxControl['accounts'][number]): Promise<void> {
  if (exporting.value || !store.selectedYearId) return
  exporting.value = a.id
  exportError.value = null
  try {
    const blob = await ledgerApi.accountLedgerCsv(a.id, {
      financial_year_id: store.selectedYearId, currency: book.value,
      from: data.value?.periods[0]?.from_date, to: data.value?.periods.at(-1)?.to_date,
    })
    saveBlob(blob, csvName(['tax-worksheet', a.code, book.value]))
  } catch (err) {
    exportError.value = messageOf(err, 'The worksheet could not be exported.')
  } finally {
    exporting.value = null
  }
}

const canPrepare = computed(() => store.can(PREPARE))
const periodOk = computed(() => periodsState.value === 'ready' && periods.value.some(p => p.status === 'open'))

const chosenBank = ref<Record<string, string>>({})
const hint = ref<string | null>(null)
const paying = ref<{ taxId: string; bankId: string } | null>(null)
const openerBtn = ref<HTMLElement | null>(null)
function chooseBank(taxId: string, bankId: string): void {
  chosenBank.value = { ...chosenBank.value, [taxId]: bankId }
  hint.value = null
}
function startPayment(taxId: string, e: Event): void {
  const bankId = chosenBank.value[taxId]
  if (!bankId) { hint.value = taxId; return }
  openerBtn.value = e.currentTarget as HTMLElement
  paying.value = { taxId, bankId }
}
async function closePayment(): Promise<void> {
  paying.value = null
  await nextTick()
}
const payTax = computed(() => accounts.value.find(a => a.id === paying.value?.taxId) ?? null)
const payBank = computed(() => data.value?.bank_accounts.find(b => b.id === paying.value?.bankId) ?? null)
const taxOnly = computed(() => (a: LedgerAccount): boolean => a.id === paying.value?.taxId)
watch(() => store.selectedYearId, () => { chosenBank.value = {}; paying.value = null; void load() }, { immediate: true })
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Receipt :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Tax Control</h2>
      <p>The tax control accounts — VAT, PAYE, NSSA — what each holds, what moved in each period, and what the council owes each statutory body.</p>
    </div>
  </section>

  <p class="tx-say tx-standing">This page reads the tax accounts as the ledger holds them. The CSV beside each account is a worksheet for the person who writes the return; the return itself is not produced here.</p>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>Tax accounts are read one financial year at a time.</p>
  </section>

  <template v-else>
    <section v-if="loading" class="cw-card" aria-busy="true" aria-label="Loading the tax accounts">
      <span class="cw-skel"></span><span class="cw-skel"></span><span class="cw-skel"></span>
    </section>

    <p v-else-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn" @click="load">Retry</button>
    </p>

    <section v-else-if="!accounts.length" class="cw-card">
      <p class="cw-empty"><strong>No account in the chart is marked as tax.</strong>
        To mark one, open the account on the General Ledger and set its account type to tax.
        <RouterLink class="cw-link" :to="{ name: 'acc-ledger' }">Open the General Ledger</RouterLink></p>
    </section>

    <template v-else>
      <section class="cw-card tx-bar" aria-label="Book">
        <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
        <p v-if="data?.note" class="tx-say">{{ data.note }}</p>
        <template v-if="canPrepare">
          <p v-if="periodsState === 'loading'" class="tx-say" role="status">Reading the accounting periods.</p>
          <p v-else-if="periodsState === 'failed'" class="tx-say" role="alert">{{ periodsError }} <button type="button" class="cw-btn" @click="load">Retry</button></p>
          <p v-else-if="!periodOk" class="tx-say">No accounting period is open in this financial year, so no payment can be raised. Periods are opened and closed in Period Close.</p>
        </template>
        <p v-else class="tx-say">{{ store.whyUnavailable(PREPARE) }}</p>
      </section>

      <!-- The statutory bodies the tax accounts name -->
      <section class="cw-card tx-acct" aria-labelledby="tx-bodies">
        <header class="tx-head">
          <h3 id="tx-bodies"><Building2 :size="18" aria-hidden="true" /> Statutory bodies, {{ book }} book</h3>
        </header>
        <div v-if="statutoryBodies.length" class="cw-table-wrap">
          <table class="cw-table">
            <caption class="tx-cap">What the tax control accounts say the council owes each statutory body named on their entries, {{ book }} book</caption>
            <thead><tr><th scope="col">Body</th><th scope="col">Control account</th><th scope="col" class="r">Held</th><th scope="col"><span class="sr-only">Statement</span></th></tr></thead>
            <tbody>
              <tr v-for="p in statutoryBodies" :key="`${p.party_id}-${p.ledger_account_id}`">
                <th scope="row">{{ p.name }}<span class="cw-hint">{{ p.party_type }}</span></th>
                <td>
                  <RouterLink v-if="accountOf(p.ledger_account_id)" class="cw-link" :to="{ name: 'acc-account', params: { id: p.ledger_account_id }, query: { book } }">
                    {{ accountOf(p.ledger_account_id)!.code }} {{ accountOf(p.ledger_account_id)!.name }}
                  </RouterLink>
                  <span v-else>—</span>
                </td>
                <td class="amt">{{ formatMoney(p.amount, book) }} {{ p.side }}<span class="cw-hint">{{ p.side === 'Cr' ? ' owed' : ' paid ahead' }}</span></td>
                <td><RouterLink class="cw-link" :to="{ name: 'acc-creditor', params: { partyId: p.party_id }, query: { book } }">Creditor statement</RouterLink></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="cw-empty">No party is named on a tax account's entries in the {{ book }} book. A deduction is named by giving the statutory body (ZIMRA, NSSA) as the party on the salaries journal's leg.</p>
      </section>

      <section v-for="a in accounts" :key="a.id" class="cw-card tx-acct" :aria-label="`${a.code} ${a.name}`">
        <header class="tx-head">
          <h3>{{ a.code }} {{ a.name }}</h3>
          <div class="tx-head-tools">
            <p class="tx-bal">
              <template v-if="balanceOf(a)">Balance {{ balanceText(balanceOf(a)!) }}</template>
              <template v-else>No entries in the {{ book }} book.</template>
            </p>
            <button
              v-if="data!.periods.length" type="button" class="cw-btn cw-btn--small"
              :aria-disabled="exporting === a.id || undefined" @click="exportWorksheet(a)"
            ><Download :size="14" aria-hidden="true" /> {{ exporting === a.id ? 'Exporting…' : 'Worksheet CSV' }}</button>
          </div>
        </header>
        <p v-if="exportError" class="tx-say" role="alert">{{ exportError }}</p>

        <p v-if="!data!.periods.length" class="cw-empty">This financial year has no accounting periods yet.</p>
        <div v-else class="cw-table-wrap">
          <table class="cw-table">
            <caption class="tx-cap">{{ a.name }}, {{ book }} book, by period</caption>
            <thead><tr><th scope="col">Period</th><th scope="col" class="r">Debits ({{ book }})</th><th scope="col" class="r">Credits ({{ book }})</th><th scope="col" class="r">Closing balance</th></tr></thead>
            <tbody>
              <tr v-for="r in rowsFor(a.id)" :key="r.period.period_id">
                <td>{{ periodName(r.period) }}</td>
                <td class="amt">
                  <RouterLink v-if="r.debit !== null" class="cw-link" :to="linkFor(a.id, r.period)">{{ formatMoney(r.debit, book, { bare: true }) }}</RouterLink>
                  <span v-else>{{ dash }}</span>
                </td>
                <td class="amt">
                  <RouterLink v-if="r.credit !== null" class="cw-link" :to="linkFor(a.id, r.period)">{{ formatMoney(r.credit, book, { bare: true }) }}</RouterLink>
                  <span v-else>{{ dash }}</span>
                </td>
                <td class="amt">
                  <template v-if="r.closing">{{ formatMoney(r.closing.closing, book, { bare: true }) }} {{ r.closing.side }}</template>
                  <span v-else>{{ dash }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="canPrepare && periodOk" class="tx-pay">
          <template v-if="data!.bank_accounts.length">
            <div class="cw-field">
              <label class="cw-label" :for="`tx-bank-${a.id}`">Pay from</label>
              <select :id="`tx-bank-${a.id}`" class="cw-input" :value="chosenBank[a.id] ?? ''" @change="chooseBank(a.id, ($event.target as HTMLSelectElement).value)">
                <option value="">Choose a bank account</option>
                <option v-for="b in data!.bank_accounts" :key="b.id" :value="b.id">{{ b.code }} {{ b.name }}</option>
              </select>
            </div>
            <button type="button" class="cw-btn cw-btn--primary" :aria-disabled="!chosenBank[a.id] || undefined" @click="startPayment(a.id, $event)">Record a payment to the tax authority</button>
            <p v-if="hint === a.id" class="tx-say" role="status">Choose the bank account the payment is made from first.</p>
          </template>
          <p v-else class="tx-say">No bank account is set up in the chart, so no payment can be raised. Bank accounts are set up in the chart of accounts.</p>
        </div>
      </section>
    </template>

    <GuidedJournalDialog
      v-if="paying && payTax && payBank" :opener="openerBtn" title="Payment to the tax authority" :currency="book"
      :lead="`Money paid to the tax authority, taken off ${payTax.code} ${payTax.name}.`"
      :fixed="{ ledger_account_id: payBank.id, side: 'credit', label: `${payBank.code} ${payBank.name}` }"
      :counter="{ label: 'Tax account', filter: taxOnly }" @close="closePayment" />
  </template>
</template>

<style scoped>
.tx-say { margin: 0; color: var(--cw-ink-2); font-size: 13.5px; }
.tx-standing { margin-bottom: 12px; }
.tx-bar { display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; padding: 12px 16px; margin-bottom: 12px; }
.tx-acct { padding: 14px 16px; margin-bottom: 12px; }
.tx-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 20px; margin-bottom: 8px; }
.tx-head h3 { margin: 0; font-size: 16px; display: inline-flex; align-items: center; gap: 8px; }
.tx-head-tools { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.tx-bal { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.tx-cap { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.tx-pay { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; margin-top: 12px; }
</style>
