<script setup lang="ts">
/**
 * Creditors: what the council owes, the supplier invoices that raised it, and the payment vouchers
 * that settle it.
 *
 * A captured invoice and a prepared payment are drafts: nothing reaches the ledger until somebody
 * other than whoever prepared the document approves it. What is owed is read from the ledger, so
 * opening balances brought across at cut-over are paid here the same way as an invoice. The server
 * refuses a duplicate supplier invoice and a payment beyond what is still open.
 */
import { announce } from '../../shared/usePortalAnnouncer'
import BookSwitch from '../kit/BookSwitch.vue'
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { AlertTriangle, CircleCheck, HandCoins, Info, Plus, Trash2, X } from 'lucide-vue-next'
import { payablesApi, type OpenItem, type PayablesSummary, type PaymentMethod, type SupplierInvoice, type SupplierInvoiceDetail, type SupplierPayment } from '../../../api/payablesApi'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { useAccountant } from '../useAccountant'
import type { AgeGroup } from '../../../api/accountingApi'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { LedgerAccount, LedgerParty } from '../../../models/ledgerTypes'

const store = useFinanceStore()
const { state: desk } = useAccountant()
const me = computed(() => store.identity?.user_id ?? null)
const may = (code: string) => store.can(`finance.payables.${code}`)

type Tab = 'owed' | 'invoices' | 'payments'
const tab = ref<Tab>('owed')
const summary = ref<PayablesSummary | null>(null)
const items = ref<OpenItem[]>([])
const invoices = ref<SupplierInvoice[]>([])
const payments = ref<SupplierPayment[]>([])
const suppliers = ref<LedgerParty[]>([])
const accounts = ref<LedgerAccount[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
watch(notice, (t) => { if (t) announce(t) })
const busy = ref<string | null>(null)
const today = new Date().toISOString().slice(0, 10)

async function load(): Promise<void> {
  error.value = null
  try {
    [summary.value, items.value, invoices.value, payments.value] = await Promise.all([
      payablesApi.summary(), payablesApi.open(), payablesApi.invoices(), payablesApi.payments(),
    ])
  } catch (err) {
    error.value = messageOf(err, 'The creditors could not be read.')
  }
}
onMounted(async () => {
  await load()
  loading.value = false
  try {
    suppliers.value = (await ledgerApi.parties({ party_type: 'supplier', status: 'active', limit: 200 })).parties
    accounts.value = (await ledgerApi.accounts({ postable_only: true, status: 'active', sort: 'code' })).accounts
  } catch { /* the capture dialogs say when their lists are empty */ }
})

async function act(name: string, work: () => Promise<string | void>, fallback: string): Promise<void> {
  if (busy.value) return
  busy.value = name
  error.value = null
  notice.value = null
  try {
    const said = await work()
    if (said) notice.value = said
    await load()
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = null
  }
}

const AGE: Record<OpenItem['bucket'], string> = { current: '0–30 days', '31_60': '31–60 days', '61_90': '61–90 days', over_90: 'Over 90 days' }
const STATUS: Record<string, { label: string; tone: string }> = {
  awaiting_approval: { label: 'Awaiting approval', tone: 'cw-pill--warn' }, approved: { label: 'Approved', tone: 'cw-pill--pos' },
  reversed: { label: 'Reversed', tone: 'cw-pill--mute' },
}
const METHOD: Record<PaymentMethod, string> = { bank_transfer: 'Bank transfer', cheque: 'Cheque', rtgs: 'RTGS', mobile_money: 'Mobile money', cash: 'Cash', other: 'Other' }

/**
 * The creditors age analysis: the dashboard's own totals per book and age, as the server sent them.
 * Nothing is added up here.
 */
const AGE_COLS: { key: AgeGroup; label: string }[] = [
  { key: 'current', label: '0–30 days' }, { key: '31_60', label: '31–60 days' }, { key: '61_90', label: '61–90 days' }, { key: 'over_90', label: 'Over 90 days' },
]
const ageBooks = computed(() => [...new Set((desk.dashboard?.payables ?? []).map(r => r.currency))])
const ageCell = (c: Currency, b: AgeGroup) => desk.dashboard?.payables.find(r => r.currency === c && r.bucket === b) ?? null

/** Open documents grouped by supplier and currency, for the list and for paying. */
const bySupplier = computed(() => {
  const groups = new Map<string, { key: string; party_id: string; name: string; currency: Currency; items: OpenItem[] }>()
  for (const i of items.value) {
    const key = `${i.party_id}:${i.currency}`
    const g = groups.get(key) ?? { key, party_id: i.party_id, name: i.party_name, currency: i.currency, items: [] }
    g.items.push(i)
    groups.set(key, g)
  }
  return [...groups.values()]
})

// ── Capture a supplier invoice ────────────────────────────────────────────────────────────────
const capturing = ref(false)
const formError = ref<string | null>(null)
const blankLine = () => ({ ledger_account_id: '', description: '', net_amount: '', tax_amount: '' })
const inv = reactive({
  party_id: '', currency: 'USD' as Currency, supplier_ref: '', invoice_date: today, due_date: today, posting_date: today,
  payable_account_id: '', tax_account_id: '', narration: '', lines: [blankLine()],
})
const spendAccounts = computed(() => accounts.value.filter((a) => ['expense', 'asset'].includes(a.root_type) && !['bank', 'cash', 'receivable'].includes(a.account_type ?? '')))
const hasTax = computed(() => inv.lines.some((l) => l.tax_amount.trim() !== '' && Number(l.tax_amount) !== 0))
function openCapture(): void {
  Object.assign(inv, { party_id: '', supplier_ref: '', invoice_date: today, due_date: today, posting_date: today, narration: '', lines: [blankLine()] })
  if (!inv.payable_account_id && summary.value?.payable_accounts.length === 1) inv.payable_account_id = summary.value.payable_accounts[0].id
  if (!inv.tax_account_id && summary.value?.tax_accounts.length === 1) inv.tax_account_id = summary.value.tax_accounts[0].id
  formError.value = null
  capturing.value = true
}
const captureReady = computed(() => !!inv.party_id && !!inv.supplier_ref.trim() && !!inv.payable_account_id && !!store.selectedYearId
  && inv.lines.every((l) => l.ledger_account_id && l.net_amount.trim()) && (!hasTax.value || !!inv.tax_account_id))
async function capture(): Promise<void> {
  if (!captureReady.value || busy.value || !store.selectedYearId) return
  busy.value = 'capture'
  formError.value = null
  try {
    const made = await payablesApi.createInvoice({
      party_id: inv.party_id, currency: inv.currency, financial_year_id: store.selectedYearId, posting_date: inv.posting_date,
      invoice_date: inv.invoice_date, due_date: inv.due_date, supplier_ref: inv.supplier_ref.trim(), payable_account_id: inv.payable_account_id,
      ...(hasTax.value ? { tax_account_id: inv.tax_account_id } : {}), ...(inv.narration.trim() ? { narration: inv.narration.trim() } : {}),
      lines: inv.lines.map((l) => ({
        ledger_account_id: l.ledger_account_id, net_amount: l.net_amount.trim(),
        ...(l.description.trim() ? { description: l.description.trim() } : {}), ...(l.tax_amount.trim() ? { tax_amount: l.tax_amount.trim() } : {}),
      })),
    })
    capturing.value = false
    notice.value = made.note
    tab.value = 'invoices'
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The supplier invoice could not be captured.')
  } finally {
    busy.value = null
  }
}

const viewing = ref<SupplierInvoiceDetail | null>(null)
async function view(id: string): Promise<void> {
  try { viewing.value = await payablesApi.invoice(id) } catch (err) { error.value = messageOf(err, 'The invoice could not be read.') }
}
const approveInvoice = (i: SupplierInvoice) => act(`ai-${i.id}`, async () => (await payablesApi.approveInvoice(i.id)).note, 'The invoice could not be approved.')
const discardInvoice = (i: SupplierInvoice) => act(`di-${i.id}`, () => payablesApi.discardInvoice(i.id), 'The invoice could not be discarded.')

// ── Prepare a payment ─────────────────────────────────────────────────────────────────────────
const paying = ref<{ party_id: string; name: string; currency: Currency; items: OpenItem[] } | null>(null)
const pay = reactive({ payment_date: today, bank_account_id: '', method: 'bank_transfer' as PaymentMethod, reference: '', amounts: {} as Record<string, string> })
function openPay(g: { party_id: string; name: string; currency: Currency; items: OpenItem[] }): void {
  paying.value = { ...g, items: g.items.filter((i) => !i.payable.startsWith('-') && Number(i.payable) !== 0) }
  Object.assign(pay, { payment_date: today, reference: '', amounts: {} })
  if (!pay.bank_account_id && summary.value?.bank_accounts.length === 1) pay.bank_account_id = summary.value.bank_accounts[0].id
  formError.value = null
}
const chosen = computed(() => Object.entries(pay.amounts).filter(([, v]) => v && v.trim() !== ''))
async function preparePayment(): Promise<void> {
  if (!paying.value || !chosen.value.length || busy.value || !store.selectedYearId) return
  busy.value = 'pay'
  formError.value = null
  try {
    const made = await payablesApi.createPayment({
      party_id: paying.value.party_id, currency: paying.value.currency, financial_year_id: store.selectedYearId, payment_date: pay.payment_date,
      bank_account_id: pay.bank_account_id, method: pay.method, ...(pay.reference.trim() ? { reference: pay.reference.trim() } : {}),
      allocations: chosen.value.map(([against_voucher_id, amount]) => ({ against_voucher_id, amount: amount.trim() })),
    })
    paying.value = null
    notice.value = made.note
    tab.value = 'payments'
    await load()
  } catch (err) {
    formError.value = messageOf(err, 'The payment voucher could not be prepared.')
  } finally {
    busy.value = null
  }
}
const approvePayment = (p: SupplierPayment) => act(`ap-${p.id}`, async () => (await payablesApi.approvePayment(p.id)).note, 'The payment could not be approved.')
const discardPayment = (p: SupplierPayment) => act(`dp-${p.id}`, () => payablesApi.discardPayment(p.id), 'The payment could not be discarded.')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><HandCoins :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Accounts Payable</h2>
      <p>What the council owes its suppliers, the invoices that raised it and the payments that settle it.</p>
    </div>
    <button v-if="may('invoice.prepare')" type="button" class="cw-btn cw-btn--primary" @click="openCapture"><Plus :size="18" aria-hidden="true" /> Capture an invoice</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos"><CircleCheck :size="18" aria-hidden="true" />{{ notice }}</p>
  <p v-if="summary && !summary.payable_accounts.length" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />
    <span>The chart of accounts has no payable control account yet, so no supplier invoice can be captured. Add the creditors control account in the
      <RouterLink :to="{ name: 'acc-ledger' }" class="cw-link">General Ledger</RouterLink> and mark it as payable.</span></p>

  <dl v-if="summary" class="ap-owed">
    <div v-for="o in summary.owed" :key="o.currency">
      <dt>Owed in {{ o.currency }} ({{ o.documents }} document{{ o.documents === 1 ? '' : 's' }})</dt>
      <dd>{{ formatMoney(o.outstanding, o.currency) }}</dd>
      <span class="cw-hint">Overdue {{ formatMoney(o.overdue, o.currency) }} · in draft payments {{ formatMoney(o.in_draft_payments, o.currency) }}</span>
    </div>
    <div v-if="!summary.owed.length"><dt>Owed to creditors</dt><dd>Nothing</dd></div>
    <div><dt>Awaiting approval</dt><dd>{{ summary.awaiting_approval.invoices + summary.awaiting_approval.payments }}</dd>
      <span class="cw-hint">{{ summary.awaiting_approval.invoices }} invoice(s), {{ summary.awaiting_approval.payments }} payment(s)</span></div>
  </dl>

  <div class="cw-seg ap-tabs" role="group" aria-label="View">
    <button type="button" :aria-pressed="tab === 'owed'" @click="tab = 'owed'">What is owed</button>
    <button type="button" :aria-pressed="tab === 'invoices'" @click="tab = 'invoices'">Supplier invoices</button>
    <button type="button" :aria-pressed="tab === 'payments'" @click="tab = 'payments'">Payment vouchers</button>
  </div>

  <CwSkeleton v-if="loading" label="accounts payable" />

  <!-- What is owed -->
  <template v-else-if="tab === 'owed'">
    <section v-if="ageBooks.length" class="cw-card" aria-label="Creditors age analysis">
      <div class="cw-card-head"><h3>Age analysis</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <caption class="sr-only">What is owed to creditors, by book and by age</caption>
          <thead><tr><th>Book</th><th v-for="c in AGE_COLS" :key="c.key" class="num">{{ c.label }}</th></tr></thead>
          <tbody>
            <tr v-for="c in ageBooks" :key="c">
              <th scope="row">{{ c }}</th>
              <td v-for="b in AGE_COLS" :key="b.key" class="num">
                <template v-if="ageCell(c, b.key)">{{ formatMoney(ageCell(c, b.key)!.amount, c) }}<div class="cw-hint">{{ ageCell(c, b.key)!.items }} document{{ ageCell(c, b.key)!.items === 1 ? '' : 's' }}</div></template>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="cw-hint">Aged from each document's own date. Open a creditor's name for their statement of account.</p>
      </div>
    </section>
    <section v-if="!bySupplier.length" class="cw-card"><p class="cw-empty"><strong>Nothing is owed to creditors.</strong>An approved supplier invoice appears here until it is paid.</p></section>
    <section v-for="g in bySupplier" :key="g.key" class="cw-card" :aria-label="`${g.name}, ${g.currency}`">
      <div class="cw-card-head">
        <h3><RouterLink class="cw-link" :to="{ name: 'acc-creditor', params: { partyId: g.party_id }, query: { book: g.currency } }">{{ g.name }}</RouterLink><small>{{ g.currency }}</small></h3><span class="cw-spacer" />
        <button v-if="may('payment.prepare')" type="button" class="cw-btn cw-btn--small cw-btn--outline" @click="openPay(g)">Prepare a payment</button>
      </div>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <thead><tr><th>Document</th><th>Dated</th><th>Due</th><th>Age</th><th class="num">Outstanding</th><th class="num">In draft payments</th></tr></thead>
          <tbody>
            <tr v-for="i in g.items" :key="i.voucher_id">
              <td><strong>{{ i.document_ref ?? i.voucher_no }}</strong><div class="cw-hint"><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: i.voucher_id } }">{{ i.voucher_no }}</RouterLink><template v-if="i.voucher_type === 'opening'"> · brought across at cut-over</template></div></td>
              <td>{{ formatDate(i.document_date) }}</td>
              <td>{{ i.due_date ? formatDate(i.due_date) : '—' }}<div v-if="i.due_date && i.days_overdue > 0" class="cw-hint cw-neg">{{ i.days_overdue }} days overdue</div></td>
              <td><span class="cw-pill" :class="i.bucket === 'over_90' ? 'cw-pill--neg' : i.bucket === 'current' ? 'cw-pill--pos' : 'cw-pill--warn'">{{ AGE[i.bucket] }}</span></td>
              <td class="num">{{ formatMoney(i.outstanding, i.currency) }}</td>
              <td class="num">{{ Number(i.pending) ? formatMoney(i.pending, i.currency) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Supplier invoices -->
  <section v-else-if="tab === 'invoices'" class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <p v-if="!invoices.length" class="cw-empty"><strong>No supplier invoice has been captured.</strong></p>
      <table v-else class="cw-table">
        <thead><tr><th>Invoice</th><th>Supplier</th><th>Dated</th><th>Due</th><th class="num">Total</th><th class="num">Outstanding</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="i in invoices" :key="i.id">
            <td><button type="button" class="cw-link" @click="view(i.id)">{{ i.supplier_ref }}</button><div class="cw-hint">{{ i.invoice_no }}</div></td>
            <td><RouterLink class="cw-link" :to="{ name: 'acc-creditor', params: { partyId: i.party_id }, query: { book: i.currency } }">{{ i.party_name }}</RouterLink></td><td>{{ formatDate(i.invoice_date) }}</td><td>{{ formatDate(i.due_date) }}</td>
            <td class="num">{{ formatMoney(i.total, i.currency) }}</td><td class="num">{{ formatMoney(i.outstanding, i.currency) }}</td>
            <td><span class="cw-pill" :class="STATUS[i.status].tone">{{ STATUS[i.status].label }}</span>
              <div class="cw-hint">{{ i.status === 'awaiting_approval' ? `Captured by ${i.prepared_by_name ?? 'somebody'}` : `Approved by ${i.approved_by_name ?? 'somebody'}` }}</div></td>
            <td class="ap-acts">
              <template v-if="i.status === 'awaiting_approval'">
                <button v-if="may('invoice.approve') && i.prepared_by !== me" type="button" class="cw-btn cw-btn--small cw-btn--primary" :disabled="!!busy" @click="approveInvoice(i)">Approve</button>
                <span v-else-if="i.prepared_by === me" class="cw-hint">Somebody else approves</span>
                <button v-if="may('invoice.prepare')" type="button" class="cw-icon-btn" :aria-label="`Discard ${i.supplier_ref}`" :disabled="!!busy" @click="discardInvoice(i)"><Trash2 :size="17" /></button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Payment vouchers -->
  <section v-else class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <p v-if="!payments.length" class="cw-empty"><strong>No payment voucher has been prepared.</strong>Prepare one from What is owed.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Voucher</th><th>Supplier</th><th>Date</th><th>Paid from</th><th>Pays</th><th class="num">Total</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td><strong>{{ p.payment_no }}</strong><div class="cw-hint">{{ METHOD[p.method] }}<template v-if="p.reference"> · {{ p.reference }}</template></div></td>
            <td>{{ p.party_name }}</td><td>{{ formatDate(p.payment_date) }}</td><td>{{ p.bank_code }} {{ p.bank_name }}</td>
            <td><div v-for="a in p.pays" :key="a.voucher_no">{{ a.document_ref ?? a.voucher_no }}: {{ formatMoney(a.amount, p.currency) }}</div></td>
            <td class="num">{{ formatMoney(p.total, p.currency) }}</td>
            <td><span class="cw-pill" :class="STATUS[p.status].tone">{{ STATUS[p.status].label }}</span>
              <div class="cw-hint">{{ p.status === 'awaiting_approval' ? `Prepared by ${p.prepared_by_name ?? 'somebody'}` : `Approved by ${p.approved_by_name ?? 'somebody'}` }}</div></td>
            <td class="ap-acts">
              <template v-if="p.status === 'awaiting_approval'">
                <button v-if="may('payment.approve') && p.prepared_by !== me" type="button" class="cw-btn cw-btn--small cw-btn--primary" :disabled="!!busy" @click="approvePayment(p)">Approve</button>
                <span v-else-if="p.prepared_by === me" class="cw-hint">Somebody else approves</span>
                <button v-if="may('payment.prepare')" type="button" class="cw-icon-btn" :aria-label="`Discard ${p.payment_no}`" :disabled="!!busy" @click="discardPayment(p)"><Trash2 :size="17" /></button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- Capture -->
  <div v-if="capturing && summary" class="cw-dialog-backdrop" @click.self="capturing = false" @keydown.esc="capturing = false">
    <form class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" aria-label="Capture a supplier invoice" @submit.prevent="capture">
      <header><h3>Capture a supplier invoice</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="capturing = false"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <div class="ap-grid">
          <label class="cw-field"><span class="cw-label">Supplier <span class="req">*</span></span>
            <select v-model="inv.party_id" class="cw-select" required><option value="">Choose a supplier</option><option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option></select>
            <span v-if="!suppliers.length" class="cw-hint">No supplier is in the register. Add one under <RouterLink :to="{ name: 'acc-parties', query: { type: 'supplier' } }" class="cw-link">Parties</RouterLink>.</span></label>
          <label class="cw-field"><span class="cw-label">Supplier's invoice number <span class="req">*</span></span><input v-model="inv.supplier_ref" class="cw-input" required /></label>
          <label class="cw-field"><span class="cw-label">Book</span><BookSwitch v-model="inv.currency" label="Book" /></label>
          <label class="cw-field"><span class="cw-label">Invoice date <span class="req">*</span></span><input v-model="inv.invoice_date" type="date" class="cw-input" required :max="inv.posting_date" /></label>
          <label class="cw-field"><span class="cw-label">Due date <span class="req">*</span></span><input v-model="inv.due_date" type="date" class="cw-input" required :min="inv.invoice_date" /></label>
          <label class="cw-field"><span class="cw-label">Posting date <span class="req">*</span></span><input v-model="inv.posting_date" type="date" class="cw-input" required />
            <span class="cw-hint">Decides the accounting period. The invoice still ages from its own date.</span></label>
          <label class="cw-field"><span class="cw-label">Creditors control account <span class="req">*</span></span>
            <select v-model="inv.payable_account_id" class="cw-select" required><option value="">Choose</option><option v-for="a in summary.payable_accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
          <label v-if="hasTax" class="cw-field"><span class="cw-label">Input tax account <span class="req">*</span></span>
            <select v-model="inv.tax_account_id" class="cw-select"><option value="">Choose</option><option v-for="a in summary.tax_accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select>
            <span v-if="!summary.tax_accounts.length" class="cw-hint">No tax account is in the chart. Mark the VAT control account as a tax account.</span></label>
        </div>
        <div class="cw-table-wrap">
          <table class="cw-table">
            <thead><tr><th>Charge to</th><th>Description</th><th>Amount before tax</th><th>Tax</th><th><span class="sr-only">Remove</span></th></tr></thead>
            <tbody>
              <tr v-for="(l, n) in inv.lines" :key="n">
                <td><select v-model="l.ledger_account_id" class="cw-select" required :aria-label="`Account for line ${n + 1}`"><option value="">Choose an account</option><option v-for="a in spendAccounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></td>
                <td><input v-model="l.description" class="cw-input" :aria-label="`Description for line ${n + 1}`" /></td>
                <td><input v-model="l.net_amount" class="cw-input" inputmode="decimal" required :aria-label="`Amount for line ${n + 1}`" /></td>
                <td><input v-model="l.tax_amount" class="cw-input" inputmode="decimal" :aria-label="`Tax for line ${n + 1}`" /></td>
                <td><button v-if="inv.lines.length > 1" type="button" class="cw-icon-btn" :aria-label="`Remove line ${n + 1}`" @click="inv.lines.splice(n, 1)"><X :size="16" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div><button type="button" class="cw-link" @click="inv.lines.push(blankLine())"><Plus :size="15" aria-hidden="true" /> Add a line</button></div>
        <p class="cw-hint">Tax is entered as it is printed on the invoice; it is not worked out here. The invoice is a draft until somebody other than you approves it.</p>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="capturing = false">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !captureReady">{{ busy === 'capture' ? 'Saving…' : 'Capture as a draft' }}</button>
      </footer>
    </form>
  </div>

  <!-- Pay -->
  <div v-if="paying && summary" class="cw-dialog-backdrop" @click.self="paying = null" @keydown.esc="paying = null">
    <form class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" aria-label="Prepare a payment" @submit.prevent="preparePayment">
      <header><h3>Payment to {{ paying.name }}, {{ paying.currency }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="paying = null"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <div class="ap-grid">
          <label class="cw-field"><span class="cw-label">Payment date <span class="req">*</span></span><input v-model="pay.payment_date" type="date" class="cw-input" required /></label>
          <label class="cw-field"><span class="cw-label">Paid from <span class="req">*</span></span>
            <select v-model="pay.bank_account_id" class="cw-select" required><option value="">Choose the bank account</option><option v-for="a in summary.bank_accounts" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option></select></label>
          <label class="cw-field"><span class="cw-label">Method</span><select v-model="pay.method" class="cw-select"><option v-for="m in summary.methods" :key="m" :value="m">{{ METHOD[m] }}</option></select></label>
          <label class="cw-field"><span class="cw-label">Bank or cheque reference</span><input v-model="pay.reference" class="cw-input" />
            <span class="cw-hint">As it will appear on the bank statement, so the reconciliation can match it.</span></label>
        </div>
        <p v-if="!paying.items.length" class="cw-empty"><strong>Nothing is left to pay.</strong>Everything open is already in a draft payment.</p>
        <div v-else class="cw-table-wrap">
          <table class="cw-table">
            <thead><tr><th>Document</th><th>Dated</th><th class="num">Still open</th><th>Pay now</th></tr></thead>
            <tbody>
              <tr v-for="i in paying.items" :key="i.voucher_id">
                <td><strong>{{ i.document_ref ?? i.voucher_no }}</strong></td><td>{{ formatDate(i.document_date) }}</td>
                <td class="num">{{ formatMoney(i.payable, i.currency) }}</td>
                <td class="ap-paynow"><input v-model="pay.amounts[i.voucher_id]" class="cw-input" inputmode="decimal" :aria-label="`Amount to pay on ${i.document_ref ?? i.voucher_no}`" />
                  <button type="button" class="cw-link" @click="pay.amounts[i.voucher_id] = i.payable">In full</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="cw-hint">Nothing is paid in the ledger until somebody other than you approves the voucher.</p>
        <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ formError }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="paying = null">Cancel</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="!!busy || !chosen.length || !pay.bank_account_id">{{ busy === 'pay' ? 'Saving…' : 'Prepare the voucher' }}</button>
      </footer>
    </form>
  </div>

  <!-- One invoice -->
  <div v-if="viewing" class="cw-dialog-backdrop" @click.self="viewing = null" @keydown.esc="viewing = null">
    <div class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" :aria-label="`Invoice ${viewing.invoice.supplier_ref}`">
      <header><h3>{{ viewing.invoice.party_name }}, invoice {{ viewing.invoice.supplier_ref }}</h3><button type="button" class="cw-icon-btn" aria-label="Close" @click="viewing = null"><X :size="20" /></button></header>
      <div class="cw-dialog-body">
        <dl class="cw-kv">
          <div><dt>Our number</dt><dd>{{ viewing.invoice.invoice_no }}</dd></div>
          <div><dt>Dated, due</dt><dd>{{ formatDate(viewing.invoice.invoice_date) }}, {{ formatDate(viewing.invoice.due_date) }}</dd></div>
          <div><dt>Credited to</dt><dd>{{ viewing.invoice.payable_code }} {{ viewing.invoice.payable_name }}</dd></div>
          <div><dt>Voucher</dt><dd><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: viewing.invoice.voucher_id } }">Open the posting</RouterLink></dd></div>
          <div><dt>Before tax, tax</dt><dd>{{ formatMoney(viewing.invoice.net_total, viewing.invoice.currency) }}, {{ formatMoney(viewing.invoice.tax_total, viewing.invoice.currency) }}</dd></div>
          <div><dt>Total</dt><dd>{{ formatMoney(viewing.invoice.total, viewing.invoice.currency) }}</dd></div>
          <div><dt>Outstanding</dt><dd>{{ formatMoney(viewing.invoice.outstanding, viewing.invoice.currency) }}</dd></div>
        </dl>
        <table class="cw-table">
          <thead><tr><th>Charged to</th><th>Description</th><th class="num">Before tax</th><th class="num">Tax</th></tr></thead>
          <tbody><tr v-for="l in viewing.lines" :key="l.line_no"><td>{{ l.account_code }} {{ l.account_name }}</td><td>{{ l.description ?? '—' }}</td>
            <td class="num">{{ formatMoney(l.net_amount, viewing.invoice.currency) }}</td><td class="num">{{ formatMoney(l.tax_amount, viewing.invoice.currency) }}</td></tr></tbody>
        </table>
        <p v-if="viewing.payments.length" class="cw-hint">Payments: <template v-for="(p, n) in viewing.payments" :key="p.id">{{ n ? '; ' : '' }}{{ p.payment_no }} {{ formatMoney(p.amount, viewing.invoice.currency) }} ({{ p.voucher_status === 'posted' ? formatDate(p.payment_date) : 'awaiting approval' }})</template></p>
      </div>
      <footer><button type="button" class="cw-btn" @click="viewing = null">Close</button></footer>
    </div>
  </div>
</template>

<style scoped>
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ap-owed { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 0; }
.ap-owed > div { padding: 12px 14px; border: 1px solid #e3e8ee; border-radius: var(--cw-r); background: var(--cw-surface); }
.ap-owed dt { font-size: 12.5px; color: var(--cw-ink-2); }
.ap-owed dd { margin: 2px 0; font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ap-tabs { max-width: 520px; }
.ap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.ap-acts { white-space: nowrap; }
.ap-acts > * { vertical-align: middle; margin-left: 6px; }
.ap-paynow { display: flex; gap: 8px; align-items: center; min-width: 200px; }
</style>
