<script setup lang="ts">
/**
 * Take a payment against a customer's outstanding bills, in four steps:
 *   1 Find Customer      search by name or account, or by a bill number (Scan / Ref)
 *   2 Select & Allocate  tick the bills, adjust the amount, choose how they pay
 *   3 Confirm Payment    amount received and change, with the receipt as it will print
 *   4 Issue Receipt      issued by the server; print, save as PDF, next customer
 *
 * The bills are the council's rates bills (`finance.rates_bill`), the only charges billed to an
 * account today; a service with no bill (a licence, a hall hire) is receipted on Issue Receipt.
 * The receipt is issued by `POST /finance/cash/receipts/rates`, which allocates it in the ledger.
 * Totals here are a preview in integer cents; the receipt carries the database's figures.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  CreditCard, Users, Search, X, Landmark, Phone, Mail, MapPin, SquareCheckBig, Layers, FileText,
  ReceiptText, ChevronLeft, Printer, Download, Check, AlertTriangle, CircleCheck, UserPlus, MapPinned,
} from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import { centsToText, toCents } from '../../../composables/cashMath'
import type { CashMethod, CashReceipt } from '../../../models/cashTypes'
import type { RatesAccount, RatesStatement } from '../../../models/ratesTypes'
import { periodLabel, useCashier } from '../useCashier'
import { tenderNarration, viewOfPrintable, type ReceiptView } from '../receipt'
import StepTracker from '../components/StepTracker.vue'
import MethodTiles from '../components/MethodTiles.vue'
import TillNotice from '../components/TillNotice.vue'
import ReceiptDocument from '../components/ReceiptDocument.vue'
import ReceiptOutput from '../components/ReceiptOutput.vue'

type StatementBill = RatesStatement['bills'][number]

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const { state, session, canTakePayment, loadDesk, loadQueue } = useCashier()

const error = ref<string | null>(null)
const busy = ref(false)
const canRates = computed(() => store.can('finance.cash.receipt.record') && store.can('finance.rates.receipt.record'))

// ── Step 1: find the customer ─────────────────────────────────────────────────────────────────
const mode = ref<'search' | 'ref'>('search')
const q = ref('')
const results = ref<RatesAccount[]>([])
const searching = ref(false)
const searched = ref(false)
const statement = ref<RatesStatement | null>(null)
const loadingStatement = ref(false)
const searchEl = ref<HTMLInputElement | null>(null)
/** A bill named on Scan / Ref, ticked once its account is open. */
let preselectBill: string | null = null

async function search(): Promise<void> {
  const text = q.value.trim()
  if (text.length < 2) return
  searching.value = true
  error.value = null
  try {
    if (mode.value === 'ref') {
      const page = await ratesApi.bills({ q: text, status: 'posted', limit: 5 })
      const bill = page.bills.find((b) => b.bill_no.toLowerCase() === text.toLowerCase()) ?? page.bills[0]
      if (bill) {
        preselectBill = bill.id
        await openAccount(bill.rates_account_id)
        results.value = []
      } else {
        const accounts = await ratesApi.accounts({ q: text, limit: 8 })
        results.value = accounts.accounts
      }
    } else {
      results.value = (await ratesApi.accounts({ q: text, limit: 8 })).accounts
    }
    searched.value = true
  } catch (err) {
    error.value = messageOf(err, 'The customer could not be searched.')
  } finally {
    searching.value = false
  }
}

function clearSearch(): void {
  q.value = ''
  results.value = []
  searched.value = false
  void nextTick(() => searchEl.value?.focus())
}

async function openAccount(id: string): Promise<void> {
  loadingStatement.value = true
  error.value = null
  try {
    statement.value = await ratesApi.statement(id)
    results.value = []
    q.value = statement.value.account.party_name
    const currencies = [...new Set(openBillsAll.value.map((b) => b.currency))]
    currency.value = currencies.includes(currency.value) ? currency.value : (currencies[0] ?? 'USD')
    selected.value = new Set(preselectBill && openBills.value.some((b) => b.id === preselectBill) ? [preselectBill] : [])
    preselectBill = null
    amountEdited.value = false
    syncAmount()
  } catch (err) {
    error.value = messageOf(err, 'The customer\'s account could not be read.')
  } finally {
    loadingStatement.value = false
  }
}

function changeCustomer(): void {
  statement.value = null
  selected.value = new Set()
  amount.value = ''
  clearSearch()
}

const account = computed(() => statement.value?.account ?? null)

// ── Step 2: bills and allocation ──────────────────────────────────────────────────────────────
const currency = ref<Currency>('USD')
const selected = ref<Set<string>>(new Set())
const amount = ref('')
const amountEdited = ref(false)

const openBillsAll = computed<StatementBill[]>(() => (statement.value?.bills ?? [])
  .filter((b) => b.voucher_status === 'posted' && (toCents(b.open_amount) ?? 0n) > 0n))
const currencies = computed(() => [...new Set(openBillsAll.value.map((b) => b.currency))])
const openBills = computed(() => openBillsAll.value.filter((b) => b.currency === currency.value)
  .sort((a, b) => a.period_from.localeCompare(b.period_from)))

const selectedBills = computed(() => openBills.value.filter((b) => selected.value.has(b.id)))
const dueCents = computed(() => selectedBills.value.reduce((t, b) => t + (toCents(b.open_amount) ?? 0n), 0n))
const amountCents = computed(() => toCents(amount.value.replace(/,/g, '')))

function syncAmount(): void {
  if (!amountEdited.value) amount.value = dueCents.value > 0n ? centsToText(dueCents.value) : ''
}
function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  syncAmount()
}
function toggleAll(): void {
  selected.value = selected.value.size === openBills.value.length ? new Set() : new Set(openBills.value.map((b) => b.id))
  syncAmount()
}
watch(currency, () => { selected.value = new Set(); amountEdited.value = false; syncAmount() })

/** Oldest bill first, each up to what it has open; any remainder stays on account as credit. */
const allocations = computed(() => {
  let left = amountCents.value ?? 0n
  const out: { bill: StatementBill; cents: bigint }[] = []
  for (const bill of selectedBills.value) {
    if (left <= 0n) break
    const open = toCents(bill.open_amount) ?? 0n
    const part = open < left ? open : left
    if (part > 0n) out.push({ bill, cents: part })
    left -= part
  }
  return out
})
const allocatedCents = computed(() => allocations.value.reduce((t, a) => t + a.cents, 0n))
const balanceNote = computed<{ label: string; value: string; tone: 'pos' | 'warn' }>(() => {
  const amt = amountCents.value ?? 0n
  if (amt > dueCents.value) return { label: 'Held as credit on account', value: centsToText(amt - dueCents.value), tone: 'warn' }
  if (amt < dueCents.value) return { label: 'Left unpaid on selected bills', value: centsToText(dueCents.value - amt), tone: 'warn' }
  return { label: 'Fully allocated', value: '0.00', tone: 'pos' }
})

// Account summary, for the cashier's conversation with the customer. Display only.
const summary = computed(() => {
  const s = statement.value
  if (!s) return null
  const owed = s.balances.find((b) => b.currency === currency.value)?.owed ?? '0.00'
  const today = state.desk?.today ?? new Date().toISOString().slice(0, 10)
  const overdue = s.bills
    .filter((b) => b.currency === currency.value && b.due_on && b.due_on < today)
    .reduce((t, b) => t + (toCents(b.outstanding_amount ?? '0') ?? 0n), 0n)
  const owedCents = toCents(owed) ?? 0n
  const current = owedCents > overdue ? owedCents - overdue : 0n
  const last = s.receipts.find((r) => r.voucher_status !== 'cancelled')
  return { owed, overdue: centsToText(overdue), current: centsToText(current), last }
})

// ── Payment method ────────────────────────────────────────────────────────────────────────────
const method = ref<CashMethod>('cash')
const reference = ref('')
const depositAccount = ref('')
const isCash = computed(() => method.value === 'cash')
watch(() => state.desk?.bank_accounts, (banks) => {
  if (banks && !banks.some((b) => b.id === depositAccount.value)) depositAccount.value = banks.length === 1 ? banks[0].id : ''
}, { immediate: true })

const step2Problem = computed<string | null>(() => {
  if (!account.value) return 'Find the customer first.'
  if (amountCents.value === null || amountCents.value === 0n) return 'Enter the payment amount.'
  if (!isCash.value) {
    if (!depositAccount.value) return 'Choose the bank or wallet account this payment was made into.'
    if (reference.value.trim().length < 3) return 'Enter the transaction reference from the card machine, bank or wallet.'
  }
  return null
})

// ── Step 3: confirm ───────────────────────────────────────────────────────────────────────────
const confirming = ref(false)
const tendered = ref('')
const tenderedCents = computed(() => (isCash.value ? toCents(tendered.value.replace(/,/g, '')) : amountCents.value))
const changeCents = computed(() => {
  if (!isCash.value || tenderedCents.value === null || amountCents.value === null) return null
  return tenderedCents.value - amountCents.value
})
const step3Problem = computed<string | null>(() => {
  if (step2Problem.value) return step2Problem.value
  if (isCash.value) {
    if (tenderedCents.value === null) return 'Enter the amount received from the customer.'
    if ((changeCents.value ?? -1n) < 0n) return 'The amount received is less than the payment amount.'
  }
  return null
})

function toConfirm(): void {
  attempted.value = true
  if (step2Problem.value) return
  tendered.value = amount.value
  confirming.value = true
  attempted.value = false
  window.scrollTo({ top: 0 })
}

const attempted = ref(false)

// ── Step 4: issue ─────────────────────────────────────────────────────────────────────────────
const issued = ref<CashReceipt | null>(null)
const issuedView = ref<ReceiptView | null>(null)
const docEl = ref<HTMLElement | null>(null)
const output = ref<InstanceType<typeof ReceiptOutput> | null>(null)
const ticketId = computed(() => (typeof route.query.ticket === 'string' ? route.query.ticket : null))

const lineViews = computed(() => {
  const lines = allocations.value.map((a) => ({
    ref: a.bill.bill_no, service: 'Property rates', period: periodLabel(a.bill.period_from), amount: centsToText(a.cents),
  }))
  const credit = (amountCents.value ?? 0n) - allocatedCents.value
  if (credit > 0n) lines.push({ ref: '—', service: 'Credit on account', period: '', amount: centsToText(credit) })
  return lines
})

const previewView = computed<ReceiptView | null>(() => {
  if (!account.value) return null
  return {
    receipt_no: null,
    council_name: 'Vungu Rural District Council',
    issued_at: null,
    cashier_name: session.value?.cashier_name ?? '',
    till: session.value?.cash_point_name ?? '—',
    customer_name: account.value.party_name,
    account_no: account.value.account_no,
    customer_type: 'Ratepayer',
    contact: statement.value?.account.contact_phone ?? null,
    currency: currency.value,
    lines: lineViews.value,
    total: amountCents.value !== null ? centsToText(amountCents.value) : '0.00',
    method: method.value,
    method_reference: isCash.value ? null : reference.value.trim() || null,
    tendered: isCash.value && tenderedCents.value !== null ? centsToText(tenderedCents.value) : null,
    change: changeCents.value !== null && changeCents.value >= 0n ? centsToText(changeCents.value) : null,
  }
})

async function issue(): Promise<void> {
  attempted.value = true
  if (step3Problem.value || !session.value || busy.value || !account.value) return
  busy.value = true
  error.value = null
  const preview = previewView.value!
  try {
    const result = await cashApi.issueRatesReceipt({
      session_id: session.value.id,
      currency: currency.value,
      method: method.value,
      rates_account_id: account.value.id,
      amount: centsToText(amountCents.value!),
      allocations: allocations.value.map((a) => ({ rates_bill_id: a.bill.id, amount: centsToText(a.cents) })),
      ...(isCash.value ? {} : { deposit_account_id: depositAccount.value, method_reference: reference.value.trim() }),
      ...(isCash.value && preview.tendered && preview.change ? { narration: tenderNarration(preview.tendered, preview.change) } : {}),
    })
    issued.value = result.receipt
    let view: ReceiptView = { ...preview, receipt_no: result.receipt.receipt_no, issued_at: result.receipt.created_at, total: result.receipt.amount }
    try {
      const printable = (await cashApi.receipt(result.receipt.id)).receipt
      view = viewOfPrintable(printable, {
        account_no: preview.account_no, customer_type: preview.customer_type, contact: preview.contact,
        lines: preview.lines, tendered: preview.tendered, change: preview.change,
      })
    } catch {
      // The receipt is issued; the preview's lines with the server's number are a faithful copy.
    }
    issuedView.value = view
    if (ticketId.value) {
      await cashApi.serveTicket(ticketId.value, result.receipt.receipt_no).catch(() => undefined)
      void loadQueue()
    }
    void loadDesk()
    window.scrollTo({ top: 0 })
  } catch (err) {
    error.value = messageOf(err, 'The receipt could not be issued.')
  } finally {
    busy.value = false
  }
}

async function savePdf(): Promise<void> {
  if (!docEl.value || !issuedView.value) return
  try {
    await output.value?.pdf(docEl.value, issuedView.value.receipt_no ?? 'receipt')
  } catch (err) {
    error.value = messageOf(err, 'The PDF could not be made.')
  }
}

function newPayment(): void {
  issued.value = null
  issuedView.value = null
  confirming.value = false
  method.value = 'cash'
  reference.value = ''
  tendered.value = ''
  attempted.value = false
  statement.value = null
  selected.value = new Set()
  amount.value = ''
  q.value = ''
  results.value = []
  searched.value = false
  void router.replace({ name: 'cashier-pay' })
  void nextTick(() => searchEl.value?.focus())
}

function cancel(): void {
  if (confirming.value) { confirming.value = false; return }
  void router.push({ name: 'cashier-dashboard' })
}

const step = computed(() => (issued.value ? 4 : confirming.value ? 3 : account.value ? 2 : 1))
/** Set when the payment was started from a property on the finance map. */
const fromParcel = computed(() => (typeof route.query.parcel === 'string' ? route.query.parcel : null))
const walkInName = computed(() => (typeof route.query.name === 'string' ? route.query.name : ''))

onMounted(async () => {
  const acct = typeof route.query.account === 'string' ? route.query.account : null
  const bill = typeof route.query.bill === 'string' ? route.query.bill : null
  if (bill) preselectBill = bill
  if (acct) await openAccount(acct)
  else if (walkInName.value) { q.value = walkInName.value; await search() }
  else void nextTick(() => searchEl.value?.focus())
})

const money = (cents: bigint | null | string) => formatMoney(typeof cents === 'string' ? cents : cents === null ? null : centsToText(cents), currency.value)
</script>

<template>
  <!-- ════════ Steps 1 and 2 ═════════════════════════════════════════════════════════════════ -->
  <template v-if="!confirming && !issued">
    <section class="cw-pagehead">
      <span class="cw-pagehead-icon"><CreditCard :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
      <div class="cw-pagehead-text">
        <h2>Take Payment</h2>
        <p>Receive customer payments, allocate to outstanding bills and issue an official receipt.</p>
      </div>
      <StepTracker :current="step" />
    </section>

    <TillNotice />
    <p v-if="!canRates" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />Your role does not take rates payments at the counter. Ask the finance administrator if that has changed.</p>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

    <div class="tp-grid">
      <!-- ── Find customer ──────────────────────────────────────────────────────────────── -->
      <div class="tp-col">
        <section class="cw-card" aria-labelledby="fc-h">
          <div class="cw-card-head"><h3 id="fc-h"><Users :size="28" class="cw-head-icon" aria-hidden="true" /> Find Customer</h3></div>
          <div class="cw-card-body tp-stack">
            <div class="cw-seg" role="group" aria-label="Find by">
              <button type="button" :aria-pressed="mode === 'search'" @click="mode = 'search'">Search Account</button>
              <button type="button" :aria-pressed="mode === 'ref'" @click="mode = 'ref'">Scan / Ref</button>
            </div>
            <form class="cw-search" role="search" @submit.prevent="search">
              <Search :size="22" aria-hidden="true" />
              <input
                ref="searchEl" v-model="q" class="cw-input" autocomplete="off"
                :placeholder="mode === 'search' ? 'Name, account or stand number' : 'Bill number, e.g. RB-0000012'"
                :aria-label="mode === 'search' ? 'Search customer accounts' : 'Bill or reference number'"
              />
              <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear the search" @click="clearSearch"><X :size="20" /></button>
            </form>
            <p v-if="searching || loadingStatement" class="cw-hint" role="status">Searching…</p>

            <ul v-if="results.length" class="tp-results" aria-label="Matching accounts">
              <li v-for="a in results" :key="a.id">
                <button type="button" @click="openAccount(a.id)">
                  <strong>{{ a.party_name }}</strong>
                  <span>{{ a.account_no }}<template v-if="a.stand_no"> · Stand {{ a.stand_no }}</template><template v-if="a.status !== 'active'"> · {{ a.status }}</template></span>
                </button>
              </li>
            </ul>
            <div v-else-if="searched && !account && !searching" class="cw-empty">
              <strong>No account matches “{{ q }}”.</strong>
              A customer paying for a service without a bill is receipted on
              <RouterLink :to="{ name: 'cashier-issue', query: q ? { name: q, ...(route.query.ticket ? { ticket: route.query.ticket } : {}) } : {} }" class="cw-link">Issue Receipt</RouterLink>.
            </div>

            <div v-if="account" class="tp-customer">
              <div class="tp-customer-head">
                <span class="tp-customer-icon"><Landmark :size="34" aria-hidden="true" /></span>
                <div>
                  <strong class="tp-customer-name">{{ account.party_name }}</strong>
                  <span>Account No: {{ account.account_no }}</span>
                  <span>Customer Type: Ratepayer</span>
                  <span class="cw-pill" :class="account.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'" style="align-self: flex-start; margin-top: 6px">{{ account.status === 'active' ? 'Active' : 'Closed' }}</span>
                </div>
              </div>
              <ul class="tp-contact">
                <li v-if="account.contact_phone"><Phone :size="18" aria-hidden="true" />{{ account.contact_phone }}</li>
                <li v-if="account.contact_email"><Mail :size="18" aria-hidden="true" />{{ account.contact_email }}</li>
                <li><MapPin :size="18" aria-hidden="true" />{{ account.address_text || (account.stand_no ? `Stand ${account.stand_no}${account.ward_code ? `, Ward ${account.ward_code}` : ''}` : account.parcel_id) }}</li>
              </ul>
              <button type="button" class="cw-link" @click="changeCustomer"><UserPlus :size="16" aria-hidden="true" /> Change customer</button>
            </div>
          </div>
        </section>

        <section v-if="summary" class="cw-card tp-summary" aria-labelledby="as-h">
          <h3 id="as-h">Account Summary <small v-if="currencies.length > 1">({{ currency }})</small></h3>
          <dl class="cw-kv">
            <div><dt>Total Outstanding</dt><dd class="cw-neg">{{ money(summary.owed) }}</dd></div>
            <div><dt>Overdue Amount</dt><dd class="cw-neg">{{ money(summary.overdue) }}</dd></div>
            <div><dt>Current Amount</dt><dd>{{ money(summary.current) }}</dd></div>
            <div>
              <dt>Last Payment</dt>
              <dd v-if="summary.last">{{ formatMoney(summary.last.amount, summary.last.currency) }}<br /><small style="font-weight: 400">on {{ formatDate(summary.last.received_on) }}</small></dd>
              <dd v-else>None recorded</dd>
            </div>
          </dl>
        </section>
      </div>

      <!-- ── Bills and allocation ───────────────────────────────────────────────────────── -->
      <div class="tp-col">
        <section class="cw-card" aria-labelledby="ob-h">
          <div class="cw-card-head">
            <h3 id="ob-h"><SquareCheckBig :size="28" class="cw-head-icon" aria-hidden="true" /> Outstanding Bills <small>(Select and Allocate)</small></h3>
            <span class="cw-spacer" />
            <div v-if="currencies.length > 1" class="cw-seg" role="group" aria-label="Currency">
              <button v-for="c in currencies" :key="c" type="button" :aria-pressed="currency === c" @click="currency = c">{{ c }}</button>
            </div>
          </div>
          <div class="cw-card-body cw-table-wrap">
            <p v-if="!account" class="cw-empty">Find the customer to see what they owe.</p>
            <p v-else-if="!openBills.length" class="cw-empty"><strong>Nothing outstanding.</strong>This account has no open bills. A payment entered below is held as credit on the account.</p>
            <table v-else class="cw-table">
              <thead>
                <tr>
                  <th><input type="checkbox" class="cw-check" :checked="selected.size === openBills.length" :indeterminate="selected.size > 0 && selected.size < openBills.length" aria-label="Select all bills" @change="toggleAll" /></th>
                  <th>Bill / Invoice</th><th>Service</th><th>Period</th><th class="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="b in openBills" :key="b.id" class="is-clickable" :class="{ 'is-selected': selected.has(b.id) }" @click="toggle(b.id)">
                  <td><input type="checkbox" class="cw-check" :checked="selected.has(b.id)" :aria-label="`Select ${b.bill_no}`" @click.stop @change="toggle(b.id)" /></td>
                  <td>{{ b.bill_no }}<span v-if="b.due_on && b.due_on < (state.desk?.today ?? '')" class="cw-pill cw-pill--neg" style="margin-left: 6px; font-size: 12px">Overdue</span></td>
                  <td>Property rates</td>
                  <td>{{ periodLabel(b.period_from) }}</td>
                  <td class="amt">{{ formatMoney(b.open_amount, b.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="cw-card" aria-labelledby="pa-h">
          <div class="cw-card-head"><h3 id="pa-h"><Layers :size="28" class="cw-head-icon" aria-hidden="true" /> Payment Allocation</h3></div>
          <div class="cw-card-body tp-stack">
            <div class="tp-alloc-row"><span>Selected Bills ({{ selectedBills.length }})</span><strong class="num">{{ money(dueCents) }}</strong></div>
            <label class="tp-alloc-row">
              <span>Payment Amount</span>
              <span class="tp-amount">
                <span>{{ currency }}</span>
                <input
                  v-model="amount" class="cw-input num" inputmode="decimal" autocomplete="off" aria-label="Payment amount"
                  :class="{ 'is-invalid': attempted && (amountCents === null || amountCents === 0n) }"
                  :disabled="!account" @input="amountEdited = true"
                />
              </span>
            </label>
            <div class="tp-alloc-row tp-alloc-note" :class="`is-${balanceNote.tone}`">
              <span>{{ balanceNote.label }}</span><strong class="num">{{ money(balanceNote.value) }}</strong>
            </div>
          </div>
        </section>
      </div>

      <!-- ── Method and summary ─────────────────────────────────────────────────────────── -->
      <div class="tp-col">
        <section class="cw-card" aria-labelledby="pm-h">
          <div class="cw-card-head"><h3 id="pm-h"><CreditCard :size="28" class="cw-head-icon" aria-hidden="true" /> Payment Method</h3></div>
          <div class="cw-card-body tp-stack">
            <MethodTiles v-model="method" />
            <template v-if="!isCash">
              <label class="cw-field">
                <span class="cw-label">Transaction reference <span class="req">*</span></span>
                <input v-model="reference" class="cw-input" autocomplete="off" maxlength="120" :class="{ 'is-invalid': attempted && reference.trim().length < 3 }" placeholder="From the card slip, bank or wallet" />
              </label>
              <label v-if="(state.desk?.bank_accounts.length ?? 0) > 1" class="cw-field">
                <span class="cw-label">Paid into <span class="req">*</span></span>
                <select v-model="depositAccount" class="cw-select">
                  <option value="" disabled>Choose the account</option>
                  <option v-for="b in state.desk?.bank_accounts" :key="b.id" :value="b.id">{{ b.code }} — {{ b.name }}</option>
                </select>
              </label>
              <p v-else-if="state.desk?.bank_accounts.length === 0" class="cw-banner-msg cw-banner-msg--warn">No bank account is set up for non-cash payments. The accountant adds one in the ledger.</p>
            </template>
          </div>
        </section>

        <section class="cw-card" aria-labelledby="ps-h">
          <div class="cw-card-head"><h3 id="ps-h"><ReceiptText :size="28" class="cw-head-icon" aria-hidden="true" /> Payment Summary</h3></div>
          <div class="cw-card-body">
            <dl class="cw-kv">
              <div><dt>Customer</dt><dd>{{ account?.party_name ?? '—' }}</dd></div>
              <div><dt>Account No.</dt><dd>{{ account?.account_no ?? '—' }}</dd></div>
              <div><dt>Bills Selected</dt><dd>{{ selectedBills.length }}</dd></div>
              <div><dt>Total Due</dt><dd>{{ money(dueCents) }}</dd></div>
              <div><dt>Payment Amount</dt><dd class="cw-accent" style="font-size: 18px; font-weight: 800">{{ money(amountCents) }}</dd></div>
            </dl>
          </div>
        </section>

        <p v-if="attempted && step2Problem" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ step2Problem }}</p>
        <div class="tp-buttons">
          <button type="button" class="cw-btn cw-btn--lg" @click="cancel"><X :size="20" aria-hidden="true" /> Cancel</button>
          <button type="button" class="cw-btn cw-btn--primary cw-btn--lg" :disabled="!canTakePayment || !canRates || !account" @click="toConfirm">
            <ReceiptText :size="22" aria-hidden="true" /> Confirm &amp; Issue Receipt
          </button>
        </div>
      </div>
    </div>
  </template>

  <!-- ════════ Steps 3 and 4 ═════════════════════════════════════════════════════════════════ -->
  <div v-else class="cf-grid">
    <div class="tp-col">
      <StepTracker :current="step" />

      <section class="cw-card" aria-labelledby="cs-h">
        <div class="cw-card-head"><h3 id="cs-h"><FileText :size="28" class="cw-head-icon" aria-hidden="true" /> Payment Summary</h3></div>
        <div class="cw-card-body">
          <div class="tp-customer tp-customer--flat">
            <div class="tp-customer-head">
              <span class="tp-customer-icon"><Users :size="32" aria-hidden="true" /></span>
              <div>
                <strong class="tp-customer-name">{{ account?.party_name }}</strong>
                <span>Account No: {{ account?.account_no }}</span>
                <span>Customer Type: Ratepayer</span>
                <span class="cw-pill cw-pill--pos" style="align-self: flex-start; margin-top: 6px">Active</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="sb-h">
        <div class="cw-card-head"><h3 id="sb-h"><Layers :size="24" class="cw-head-icon" aria-hidden="true" /> Selected Bills ({{ allocations.length }})</h3></div>
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table">
            <thead><tr><th>Bill / Invoice</th><th>Service</th><th>Period</th><th class="r">Amount</th></tr></thead>
            <tbody>
              <tr v-for="l in lineViews" :key="l.ref + l.service"><td>{{ l.ref }}</td><td>{{ l.service }}</td><td>{{ l.period }}</td><td class="amt">{{ money(l.amount) }}</td></tr>
            </tbody>
            <tfoot><tr><th colspan="3">Total Due</th><td>{{ money(amountCents) }}</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="pd-h">
        <div class="cw-card-head"><h3 id="pd-h"><CreditCard :size="28" class="cw-head-icon" aria-hidden="true" /> Payment Details</h3></div>
        <div class="cw-card-body tp-stack">
          <span class="cw-label">Payment Method</span>
          <MethodTiles v-model="method" row :class="{ 'is-locked': issued }" />
          <template v-if="!isCash && !issued">
            <label class="cw-field">
              <span class="cw-label">Transaction reference <span class="req">*</span></span>
              <input v-model="reference" class="cw-input" autocomplete="off" maxlength="120" />
            </label>
            <label v-if="(state.desk?.bank_accounts.length ?? 0) > 1" class="cw-field">
              <span class="cw-label">Paid into <span class="req">*</span></span>
              <select v-model="depositAccount" class="cw-select">
                <option value="" disabled>Choose the account</option>
                <option v-for="b in state.desk?.bank_accounts" :key="b.id" :value="b.id">{{ b.code }} — {{ b.name }}</option>
              </select>
            </label>
          </template>
          <div v-if="isCash" class="cf-tender">
            <label class="cw-field">
              <span class="cw-label">Amount Received <span class="req">*</span></span>
              <input v-model="tendered" class="cw-input num" inputmode="decimal" autocomplete="off" :disabled="!!issued" :class="{ 'is-invalid': attempted && step3Problem }" />
            </label>
            <div class="cw-field">
              <span class="cw-label">Change</span>
              <output class="cf-change num" :class="{ 'is-neg': (changeCents ?? 0n) < 0n }">{{ changeCents === null ? '—' : money(changeCents < 0n ? -changeCents : changeCents) }}</output>
            </div>
          </div>
          <p v-if="issued" class="cf-valid"><CircleCheck :size="20" aria-hidden="true" /> Receipt {{ issued.receipt_no }} issued.</p>
          <p v-else-if="!step3Problem" class="cf-valid"><CircleCheck :size="20" aria-hidden="true" /> Payment is valid. Click <strong>Issue Receipt</strong> to complete the transaction.</p>
          <p v-else class="cw-banner-msg cw-banner-msg--warn" role="status">{{ step3Problem }}</p>
          <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
        </div>
      </section>
    </div>

    <div class="tp-col">
      <div ref="docEl" class="cw-card cf-doc">
        <ReceiptDocument v-if="issuedView" :view="issuedView" />
        <ReceiptDocument v-else-if="previewView" :view="previewView" />
      </div>
      <div class="tp-buttons cf-buttons">
        <template v-if="!issued">
          <button type="button" class="cw-btn" @click="confirming = false"><ChevronLeft :size="20" aria-hidden="true" /> Back</button>
          <button type="button" class="cw-btn" @click="router.push({ name: 'cashier-dashboard' })"><X :size="20" aria-hidden="true" /> Cancel</button>
          <button type="button" class="cw-btn cw-btn--outline" disabled title="Available once the receipt is issued"><Printer :size="20" aria-hidden="true" /> Print Receipt</button>
          <button type="button" class="cw-btn cw-btn--outline" disabled title="Available once the receipt is issued"><Download :size="20" aria-hidden="true" /> Download PDF</button>
          <button type="button" class="cw-btn cw-btn--primary" :disabled="busy || !!step3Problem || !canTakePayment" @click="issue">
            <Check :size="20" aria-hidden="true" /> {{ busy ? 'Issuing…' : 'Issue Receipt & Finish' }}
          </button>
        </template>
        <template v-else>
          <RouterLink :to="{ name: 'cashier-dashboard' }" class="cw-btn"><ChevronLeft :size="20" aria-hidden="true" /> Dashboard</RouterLink>
          <button type="button" class="cw-btn cw-btn--outline" @click="issuedView && output?.print(issuedView)"><Printer :size="20" aria-hidden="true" /> Print Receipt</button>
          <button type="button" class="cw-btn cw-btn--outline" @click="savePdf"><Download :size="20" aria-hidden="true" /> Download PDF</button>
          <RouterLink v-if="fromParcel" :to="{ name: 'cashier-gis', query: { parcel: fromParcel } }" class="cw-btn cw-btn--outline"><MapPinned :size="20" aria-hidden="true" /> Back to the property map</RouterLink>
          <button type="button" class="cw-btn cw-btn--primary" @click="newPayment"><CreditCard :size="20" aria-hidden="true" /> Next Payment</button>
        </template>
      </div>
    </div>
    <ReceiptOutput ref="output" />
  </div>
</template>

<style scoped>
.tp-grid { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(360px, 1.35fr) minmax(320px, 1.15fr); gap: 18px; align-items: start; }
.cf-grid { display: grid; grid-template-columns: minmax(380px, 0.95fr) minmax(0, 1.1fr); gap: 20px; align-items: start; }
.tp-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.tp-stack { display: flex; flex-direction: column; gap: 14px; }
.tp-results { list-style: none; margin: 0; padding: 0; border: 1px solid var(--cw-line); border-radius: 12px; overflow: hidden; }
.tp-results li + li { border-top: 1px solid var(--cw-line); }
.tp-results button { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 10px 14px; border: 0; background: #fff; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.tp-results button:hover { background: var(--cw-accent-softer); }
.tp-results span { color: var(--cw-ink-2); font-size: 14px; }
.tp-customer { border: 1px solid var(--cw-line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.tp-customer--flat { background: #f9fbfe; }
.tp-customer-head { display: flex; gap: 14px; }
.tp-customer-head > div { display: flex; flex-direction: column; gap: 2px; color: var(--cw-ink-2); font-size: 15px; }
.tp-customer-icon { width: 60px; height: 60px; border-radius: 14px; background: var(--cw-accent-soft); color: var(--cw-accent); display: grid; place-items: center; flex: none; }
.tp-customer-name { color: var(--cw-ink); font-size: 16px; font-weight: 700; }
.tp-contact { list-style: none; margin: 0; padding: 10px 0 0; border-top: 1px solid var(--cw-line); display: flex; flex-direction: column; gap: 8px; }
.tp-contact li { display: flex; align-items: center; gap: 12px; font-size: 15.5px; }
.tp-contact svg { color: var(--cw-accent); flex: none; }
.tp-summary { padding: 0 0 6px; overflow: hidden; }
.tp-summary h3 { margin: 0; padding: 11px 14px; background: #eaf0f9; font-size: 15px; }
.tp-summary .cw-kv { padding: 0 18px; }
.tp-alloc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border: 1px solid var(--cw-line); border-radius: 8px; font-size: 14px; }
.tp-alloc-row strong { font-size: 15px; }
.tp-amount { display: flex; align-items: center; gap: 8px; border: 1.5px solid var(--cw-line-2); border-radius: 10px; padding: 0 0 0 14px; max-width: 220px; }
.tp-amount span { font-weight: 600; flex: none; }
.tp-col .cw-table td, .tp-col .cw-table th { white-space: nowrap; }
.tp-col .cw-table td, .tp-col .cw-table thead th { padding-left: 10px; padding-right: 10px; }
.tp-amount .cw-input { border: 0; min-height: 38px; text-align: right; font-size: 15px; font-weight: 600; }
.tp-amount .cw-input:focus { box-shadow: none; }
.tp-amount:focus-within { border-color: var(--cw-accent); box-shadow: var(--cw-focus); }
.tp-alloc-note { border: 0; font-weight: 700; }
.tp-alloc-note.is-pos { background: var(--cw-pos-soft); color: var(--cw-pos); }
.tp-alloc-note.is-warn { background: var(--cw-warn-soft); color: var(--cw-warn); }
.tp-buttons { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.cf-buttons { justify-content: flex-end; }
.cf-doc { overflow: hidden; }
.cf-tender { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cf-change { display: flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 8px; background: var(--cw-pos-soft); color: var(--cw-pos); font-size: 17px; font-weight: 800; }
.cf-change.is-neg { background: var(--cw-neg-soft); color: var(--cw-neg); }
.cf-valid { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
.cf-valid svg { color: var(--cw-pos); flex: none; }
.cf-valid strong { color: var(--cw-pos); }
.is-locked { pointer-events: none; opacity: 0.85; }
@media (max-width: 1400px) { .tp-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .tp-grid > .tp-col:last-child { grid-column: 1 / -1; } }
@media (max-width: 1180px) { .cf-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 900px) { .tp-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) { .cf-tender { grid-template-columns: minmax(0, 1fr); } .tp-buttons .cw-btn { flex: 1 1 auto; } }
</style>
