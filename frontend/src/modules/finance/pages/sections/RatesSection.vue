<script setup lang="ts">
/**
 * Rates billing, debtors and arrears.
 *
 * The six surfaces a rates office works on — billing runs, receipts, arrears, the rates accounts,
 * the valuation roll and the tariff schedule — under one statement that is always on screen: what
 * billing is waiting on.
 *
 * WHY THE READINESS PANEL COMES FIRST AND IS NEVER COLLAPSED
 * On the day this module is deployed, the honest answer to "can we bill?" is no. No property has a
 * ratepayer of record (decision D19), a rateable value (D17) or an approved rate in the dollar
 * (D18). A screen that opened on an empty bills table would let that read as "nothing has been
 * billed yet" rather than "nothing can be", so the three decisions are stated, counted and kept
 * above everything else. Nothing here fills a register with assumed values: the valuation roll and
 * the tariff are Council data and are entered, with their source, by the people who hold them.
 *
 * WHY THE SCREEN ADDS NOTHING UP
 * Every charge, total, open balance and arrears figure on this screen was computed by Postgres
 * over NUMERIC and is shown as it arrived. The browser does no arithmetic on money — a JavaScript
 * number is a binary float — which has two visible consequences, both stated on screen: a receipt
 * form does not show a running "unallocated" figure as amounts are typed (the saved receipt states
 * it), and "settle in full" copies the bill's open amount as text rather than computing one.
 *
 * WHY THREE BUTTONS ARE OFTEN ABSENT
 * Whoever drafts a tariff does not approve it; whoever raises a billing run does not commit it;
 * whoever takes a payment does not post it. Each is a constraint on the record, not on this
 * screen. Where the viewer is the person who prepared the thing, the control is not offered and a
 * sentence says why — the workspace does not put a button on a surface whose only outcome is a
 * refusal.
 *
 * NO FIGURE SPANS TWO CURRENCIES. A run bills one currency, a receipt settles bills in its own,
 * and the arrears are one book per currency. There is no combined total anywhere on this screen
 * (Council decision D4).
 *
 * Off the generic-dashboard anti-reference (PRODUCT.md): no hero metrics, no icon grid. The
 * readiness panel is a ruled list at body weight; everything else is a table, because a rates
 * office reads registers.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle, Check, CheckCircle2, CircleDashed, Info, Plus, RefreshCw, Search, X,
} from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { ratesApi } from '../../api/ratesApi'
import { ledgerApi } from '../../api/ledgerApi'
import { formatDate, formatDateTime, formatMoney } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import type { Currency } from '../../models/types'
import type { LedgerAccount, LedgerParty } from '../../models/ledgerTypes'
import type {
  BillingPreview, BillingRefusal, BillingRun, DocumentTotal, PropertyCategory, RatesAccount,
  RatesArrears, RatesProperty, RatesReadiness, RatesReceipt, RatesStatement,
  RatesTariff, ReceiptMethod,
} from '../../models/ratesTypes'

const store = useFinanceStore()
const prompt = useFinancePrompt()

const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const yearId = computed(() => store.selectedYearId)
const me = computed(() => store.identity?.user_id ?? null)

const canValue = computed(() => store.can('finance.rates.valuation.manage'))
const canDraftTariff = computed(() => store.can('finance.rates.tariff.manage'))
const canApproveTariff = computed(() => store.can('finance.rates.tariff.approve'))
const canKeepAccounts = computed(() => store.can('finance.rates.account.manage'))
const canPrepare = computed(() => store.can('finance.rates.bill.prepare'))
const canCommit = computed(() => store.can('finance.rates.bill.post'))
const canReceipt = computed(() => store.can('finance.rates.receipt.record'))
const canPostVoucher = computed(() => store.can('finance.ledger.voucher.post'))
const canKeepParties = computed(() => store.can('finance.ledger.party.manage'))
const canKeepCategories = computed(() => canValue.value || canDraftTariff.value)

type Tab = 'billing' | 'receipts' | 'arrears' | 'accounts' | 'roll' | 'tariffs'
/** A workspace page opens the screen on one tab (the console opens the first). */
const props = defineProps<{ initialTab?: Tab }>()
const TABS: ReadonlyArray<{ key: Tab; label: string; hint: string }> = [
  { key: 'billing', label: 'Billing runs', hint: 'Preview, raise and commit a period' },
  { key: 'receipts', label: 'Receipts', hint: 'Payments taken and what they settled' },
  { key: 'arrears', label: 'Arrears', hint: 'Who owes, how old, and the control account' },
  { key: 'accounts', label: 'Rates accounts', hint: 'A property and its ratepayer of record' },
  { key: 'roll', label: 'Valuation roll', hint: 'The rateable value of each property' },
  { key: 'tariffs', label: 'Tariffs', hint: 'The rate in the dollar, as resolved' },
]
const tab = ref<Tab>(props.initialTab ?? 'billing')

const CURRENCIES: Currency[] = ['USD', 'ZWG']
const METHODS: ReadonlyArray<{ value: ReceiptMethod; label: string }> = [
  { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'mobile_money', label: 'Mobile money' }, { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' },
]

/**
 * A rate in the dollar, as text, without its trailing zeros. STRING WORK ONLY: the rate is never
 * parsed, so `0.00850000` reads `0.0085` and nothing is rounded.
 */
function rateText(rate: string | null | undefined): string {
  if (!rate) return '—'
  if (!rate.includes('.')) return rate
  const trimmed = rate.replace(/0+$/, '')
  return trimmed.endsWith('.') ? `${trimmed}0` : trimmed
}

const statusTone = (status: string): string =>
  status === 'posted' || status === 'committed' || status === 'approved' || status === 'active'
    ? 'tone-positive'
    : status === 'cancelled' || status === 'superseded' || status === 'closed'
      ? 'tone-negative'
      : 'tone-warning'

async function act<T>(key: string, fallback: string, work: () => Promise<T>): Promise<T | undefined> {
  error.value = null; note.value = null
  busy.value = key
  try {
    return await work()
  } catch (err) {
    error.value = messageOf(err, fallback)
    return undefined
  } finally {
    busy.value = null
  }
}

// ── Readiness ─────────────────────────────────────────────────────────────────────────────────

const readiness = ref<RatesReadiness | null>(null)
const readinessFailed = ref<string | null>(null)

async function loadReadiness(): Promise<void> {
  readinessFailed.value = null
  try {
    readiness.value = await ratesApi.readiness(yearId.value)
  } catch (err) {
    readinessFailed.value = messageOf(err, 'What billing is waiting on could not be read.')
  }
}

// ── Reference lists shared by the forms ───────────────────────────────────────────────────────

const ledgerAccounts = ref<LedgerAccount[]>([])
const categories = ref<PropertyCategory[]>([])
const parties = ref<LedgerParty[]>([])

const receivableAccounts = computed(() => ledgerAccounts.value.filter((a) => a.account_type === 'receivable'))
const bankAccounts = computed(() =>
  ledgerAccounts.value.filter((a) => a.account_type === 'bank' || a.account_type === 'cash'))
const revenueAccounts = computed(() => ledgerAccounts.value.filter((a) => a.root_type === 'revenue'))
const activeCategories = computed(() => categories.value.filter((c) => c.status === 'active'))

async function loadReference(): Promise<void> {
  try {
    const [chart, cats] = await Promise.all([
      store.can('finance.ledger.view')
        ? ledgerApi.accounts({ postable_only: true, status: 'active' })
        : Promise.resolve({ accounts: [] as LedgerAccount[] }),
      ratesApi.categories(),
    ])
    ledgerAccounts.value = chart.accounts
    categories.value = cats.categories
  } catch (err) {
    error.value = messageOf(err, 'The accounts and categories the rates forms use could not be read.')
  }
}

async function loadParties(): Promise<void> {
  if (!store.can('finance.ledger.view')) return
  try {
    parties.value = (await ledgerApi.parties({ status: 'active', limit: 200 })).parties
  } catch (err) {
    error.value = messageOf(err, 'The party register could not be read.')
  }
}

// ── Property search, shared by "open an account" and "record a valuation" ─────────────────────

const propertyQuery = ref('')
const propertyHits = ref<RatesProperty[]>([])
const propertySearched = ref(false)

async function searchProperties(): Promise<void> {
  const q = propertyQuery.value.trim()
  if (!q) { propertyHits.value = []; propertySearched.value = false; return }
  const result = await act('property-search', 'The property register could not be searched.',
    () => ratesApi.properties({ q, limit: 12 }))
  if (result) { propertyHits.value = result.properties; propertySearched.value = true }
}

// ── 1. Billing ────────────────────────────────────────────────────────────────────────────────

const runForm = ref({
  run_reference: '', period_from: '', period_to: '', posting_date: '', due_on: '',
  currency: 'USD' as Currency, receivable_ledger_account_id: '', revenue_ledger_account_id: '',
})
const preview = ref<BillingPreview | null>(null)
/** The period the preview on screen was computed for; raising is offered only while it matches. */
const previewKey = ref('')
const runs = ref<BillingRun[]>([])
const runsLoading = ref(false)
const openRunId = ref<string | null>(null)
const runRefusals = ref<BillingRefusal[]>([])
const runRefusalTotal = ref(0)

const periodKey = computed(() =>
  [yearId.value, runForm.value.period_from, runForm.value.period_to, runForm.value.currency].join('|'))
const periodComplete = computed(() =>
  Boolean(yearId.value && runForm.value.period_from && runForm.value.period_to))
const previewIsCurrent = computed(() => preview.value !== null && previewKey.value === periodKey.value)
const runFormComplete = computed(() => periodComplete.value && Boolean(
  runForm.value.run_reference.trim().length >= 3 && runForm.value.posting_date
  && runForm.value.receivable_ledger_account_id && runForm.value.revenue_ledger_account_id))

async function loadRuns(): Promise<void> {
  runsLoading.value = true
  try {
    runs.value = (await ratesApi.runs({ financial_year_id: yearId.value ?? undefined, limit: 50 })).runs
  } catch (err) {
    error.value = messageOf(err, 'The billing runs could not be read.')
  } finally {
    runsLoading.value = false
  }
}

async function runPreview(): Promise<void> {
  if (!periodComplete.value || !yearId.value) return
  const key = periodKey.value
  const result = await act('preview', 'The billing preview could not be computed.', () =>
    ratesApi.billingPreview({
      financial_year_id: yearId.value as string, period_from: runForm.value.period_from,
      period_to: runForm.value.period_to, currency: runForm.value.currency, billable: true, limit: 25,
    }))
  if (result) { preview.value = result; previewKey.value = key }
}

async function raiseRun(): Promise<void> {
  if (!runFormComplete.value || !yearId.value) return
  const f = runForm.value
  const result = await act('raise', 'The billing run could not be raised.', () => ratesApi.raiseRun({
    run_reference: f.run_reference.trim(), financial_year_id: yearId.value as string,
    period_from: f.period_from, period_to: f.period_to, posting_date: f.posting_date,
    currency: f.currency, receivable_ledger_account_id: f.receivable_ledger_account_id,
    revenue_ledger_account_id: f.revenue_ledger_account_id,
    ...(f.due_on ? { due_on: f.due_on } : {}),
  }))
  if (!result) return
  note.value = `${result.run.run_reference}: ${result.note}`
  preview.value = null
  runForm.value.run_reference = ''
  await Promise.all([loadRuns(), loadReadiness()])
  await showRefusals(result.run)
}

/** Did this person raise this run? Committing it is then not theirs to do. */
const isOwnRun = (run: BillingRun): boolean => me.value !== null && run.prepared_by === me.value

async function commitRun(run: BillingRun): Promise<void> {
  const answer = await prompt.ask({
    title: `Commit billing run ${run.run_reference}`,
    message: `This posts ${run.bills_raised} ${run.bills_raised === 1 ? 'bill' : 'bills'} totalling `
      + `${formatMoney(run.total_billed, run.currency)} to the book of account. Posted bills can `
      + 'never be amended; a bill that is wrong is corrected by reversing it. Type the run reference to confirm.',
    label: 'Run reference', kind: 'text', minLength: 3, submitLabel: 'Commit the run',
  })
  if (answer === null) return
  if (answer.trim().toUpperCase() !== run.run_reference.toUpperCase()) {
    error.value = `That is not the reference of this run (${run.run_reference}). Nothing was committed.`
    return
  }
  const result = await act(run.id, 'The billing run could not be committed.', () => ratesApi.commitRun(run.id))
  if (!result) return
  note.value = `${run.run_reference}: ${result.bills_posted} ${result.bills_posted === 1 ? 'bill' : 'bills'} posted. ${result.note}`
  await Promise.all([loadRuns(), loadArrears()])
}

async function cancelRun(run: BillingRun): Promise<void> {
  const reason = await prompt.ask({
    title: `Cancel billing run ${run.run_reference}`,
    message: 'Its draft bills posted nothing and are withdrawn, and the period can be billed again. The reason is kept on the record.',
    label: 'Reason', kind: 'textarea', minLength: 5, submitLabel: 'Cancel the run', danger: true,
  })
  if (reason === null) return
  const result = await act(run.id, 'The billing run could not be cancelled.', () => ratesApi.cancelRun(run.id, reason))
  if (!result) return
  note.value = `${run.run_reference}: ${result.note}`
  await loadRuns()
}

async function showRefusals(run: BillingRun): Promise<void> {
  if (openRunId.value === run.id) { openRunId.value = null; return }
  const result = await act(`refusals-${run.id}`, 'The refusals of that run could not be read.',
    () => ratesApi.runRefusals(run.id, { limit: 50 }))
  if (!result) return
  openRunId.value = run.id
  runRefusals.value = result.refusals
  runRefusalTotal.value = result.total
}

// ── 2. Receipts ───────────────────────────────────────────────────────────────────────────────

const receipts = ref<RatesReceipt[]>([])
const receiptTotals = ref<DocumentTotal[]>([])
const receiptsLoading = ref(false)
const showReceiptForm = ref(false)
const receiptForm = ref({
  receipt_no: '', rates_account_id: '', amount: '', currency: 'USD' as Currency, received_on: '',
  bank_ledger_account_id: '', receivable_ledger_account_id: '', method: '' as ReceiptMethod | '',
  reference: '',
})
const receiptAccounts = ref<RatesAccount[]>([])
/** The payer's posted bills that still have something open, and what is typed against each. */
const payableBills = ref<RatesStatement['bills']>([])
const allocation = ref<Record<string, string>>({})

async function loadReceipts(): Promise<void> {
  receiptsLoading.value = true
  try {
    const result = await ratesApi.receipts({ financial_year_id: yearId.value ?? undefined, limit: 50 })
    receipts.value = result.receipts
    receiptTotals.value = result.totals
  } catch (err) {
    error.value = messageOf(err, 'The receipts could not be read.')
  } finally {
    receiptsLoading.value = false
  }
}

async function openReceiptForm(): Promise<void> {
  showReceiptForm.value = true
  payableBills.value = []
  allocation.value = {}
  const result = await act('receipt-accounts', 'The rates accounts could not be read.',
    () => ratesApi.accounts({ limit: 200 }))
  if (result) receiptAccounts.value = result.accounts
}

watch(() => [receiptForm.value.rates_account_id, receiptForm.value.currency] as const, async ([accountId, ccy]) => {
  payableBills.value = []
  allocation.value = {}
  if (!accountId || !showReceiptForm.value) return
  try {
    const statement = await ratesApi.statement(accountId)
    // Only bills that are in the book of account, in this receipt's currency, with something
    // open. "Nothing open" is the database's figure compared as text against its own zero.
    payableBills.value = statement.bills.filter((b) =>
      b.voucher_status === 'posted' && b.currency === ccy && !/^-?0+(\.0+)?$/.test(b.open_amount))
  } catch (err) {
    error.value = messageOf(err, 'That account\'s bills could not be read.')
  }
})

const receiptFormComplete = computed(() => {
  const f = receiptForm.value
  return Boolean(yearId.value && f.receipt_no.trim() && f.rates_account_id && /^\d+(\.\d{1,2})?$/.test(f.amount.trim())
    && f.received_on && f.bank_ledger_account_id)
})

async function recordReceipt(): Promise<void> {
  if (!receiptFormComplete.value || !yearId.value) return
  const f = receiptForm.value
  const allocations = Object.entries(allocation.value)
    .map(([rates_bill_id, amount]) => ({ rates_bill_id, amount: amount.trim() }))
    .filter((a) => a.amount !== '')
  const result = await act('receipt', 'The receipt could not be recorded.', () => ratesApi.recordReceipt({
    receipt_no: f.receipt_no.trim(), rates_account_id: f.rates_account_id,
    financial_year_id: yearId.value as string, amount: f.amount.trim(), currency: f.currency,
    received_on: f.received_on, bank_ledger_account_id: f.bank_ledger_account_id,
    ...(f.receivable_ledger_account_id ? { receivable_ledger_account_id: f.receivable_ledger_account_id } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.reference.trim() ? { reference: f.reference.trim() } : {}),
    ...(allocations.length ? { allocations } : {}),
  }))
  if (!result) return
  const r = result.receipt
  note.value = `Receipt ${r.receipt_no} for ${formatMoney(r.amount, r.currency)} recorded; `
    + `${formatMoney(r.unallocated_amount, r.currency)} of it is not allocated to a bill. ${result.note}`
  showReceiptForm.value = false
  receiptForm.value = { ...receiptForm.value, receipt_no: '', amount: '', reference: '', rates_account_id: '' }
  await loadReceipts()
}

const isOwnReceipt = (r: RatesReceipt): boolean => me.value !== null && r.prepared_by === me.value

async function postReceipt(r: RatesReceipt): Promise<void> {
  const result = await act(r.id, 'The receipt could not be posted.', () => ratesApi.postReceipt(r.id))
  if (!result) return
  note.value = `${result.posted}: ${result.note}`
  await Promise.all([loadReceipts(), loadArrears()])
}

async function cancelReceipt(r: RatesReceipt): Promise<void> {
  const reason = await prompt.ask({
    title: `Cancel receipt ${r.receipt_no}`,
    message: 'A receipt is evidence that money was taken, so it is cancelled and kept, with the reason, and its number is not reused.',
    label: 'Reason', kind: 'textarea', minLength: 5, submitLabel: 'Cancel the receipt', danger: true,
  })
  if (reason === null) return
  const result = await act(r.id, 'The receipt could not be cancelled.', () => ratesApi.cancelReceipt(r.id, reason))
  if (!result) return
  note.value = `${result.cancelled}: ${result.note}`
  await loadReceipts()
}

// ── 3. Arrears ────────────────────────────────────────────────────────────────────────────────

const arrears = ref<RatesArrears | null>(null)
const arrearsLoading = ref(false)
const arrearsQuery = ref('')

async function loadArrears(): Promise<void> {
  arrearsLoading.value = true
  try {
    arrears.value = await ratesApi.arrears({ q: arrearsQuery.value.trim() || undefined, limit: 100 })
  } catch (err) {
    error.value = messageOf(err, 'The arrears could not be read.')
  } finally {
    arrearsLoading.value = false
  }
}

// ── 4. Rates accounts ─────────────────────────────────────────────────────────────────────────

const accounts = ref<RatesAccount[]>([])
const accountsTotal = ref(0)
const accountsNote = ref<string | null>(null)
const accountsLoading = ref(false)
const accountsQuery = ref('')
const showAccountForm = ref(false)
const accountForm = ref({ account_no: '', parcel_id: '', party_id: '', erp_account_no: '' })
const partyForm = ref({ name: '', reference: '' })
const statement = ref<RatesStatement | null>(null)

async function loadAccounts(): Promise<void> {
  accountsLoading.value = true
  try {
    const result = await ratesApi.accounts({ q: accountsQuery.value.trim() || undefined, limit: 100 })
    accounts.value = result.accounts
    accountsTotal.value = result.total
    accountsNote.value = result.note
  } catch (err) {
    error.value = messageOf(err, 'The rates accounts could not be read.')
  } finally {
    accountsLoading.value = false
  }
}

async function openAccountForm(): Promise<void> {
  showAccountForm.value = true
  propertyQuery.value = ''; propertyHits.value = []; propertySearched.value = false
  await loadParties()
}

async function addParty(): Promise<void> {
  const name = partyForm.value.name.trim()
  if (!name) return
  const created = await act('party', 'The ratepayer could not be added.', () => ledgerApi.createParty({
    party_type: 'ratepayer', name,
    ...(partyForm.value.reference.trim() ? { reference: partyForm.value.reference.trim() } : {}),
  }))
  if (!created) return
  parties.value = [...parties.value, created]
  accountForm.value.party_id = created.id
  partyForm.value = { name: '', reference: '' }
}

async function openAccount(): Promise<void> {
  const f = accountForm.value
  if (!f.account_no.trim() || !f.parcel_id || !f.party_id) return
  const created = await act('account', 'The rates account could not be opened.', () => ratesApi.openAccount({
    account_no: f.account_no.trim(), parcel_id: f.parcel_id, party_id: f.party_id,
    ...(f.erp_account_no.trim() ? { erp_account_no: f.erp_account_no.trim() } : {}),
  }))
  if (!created) return
  note.value = `Rates account ${created.account_no} opened.`
  showAccountForm.value = false
  accountForm.value = { account_no: '', parcel_id: '', party_id: '', erp_account_no: '' }
  await Promise.all([loadAccounts(), loadReadiness()])
}

async function showStatement(account: RatesAccount): Promise<void> {
  if (statement.value?.account.id === account.id) { statement.value = null; return }
  const result = await act(`statement-${account.id}`, 'That statement could not be read.',
    () => ratesApi.statement(account.id))
  if (result) statement.value = result
}

// ── 5. The valuation roll ─────────────────────────────────────────────────────────────────────

const properties = ref<RatesProperty[]>([])
const propertiesTotal = ref(0)
const rollLoading = ref(false)
const rollFilter = ref<{ q: string; valued: '' | 'yes' | 'no' }>({ q: '', valued: '' })
const rollOffset = ref(0)
const ROLL_PAGE = 50
const showValuationForm = ref(false)
const valuationForm = ref({
  parcel_id: '', property_category_id: '', rateable_value: '', currency: 'USD' as Currency,
  effective_from: '', source: '', source_reference: '', status: 'draft' as 'draft' | 'active',
})
const categoryForm = ref({ code: '', name: '' })

async function loadRoll(): Promise<void> {
  rollLoading.value = true
  try {
    const result = await ratesApi.properties({
      q: rollFilter.value.q.trim() || undefined,
      has_rateable_value: rollFilter.value.valued === '' ? undefined : rollFilter.value.valued === 'yes',
      limit: ROLL_PAGE, offset: rollOffset.value,
    })
    properties.value = result.properties
    propertiesTotal.value = result.total
  } catch (err) {
    error.value = messageOf(err, 'The valuation roll could not be read.')
  } finally {
    rollLoading.value = false
  }
}

function pageRoll(direction: 1 | -1): void {
  rollOffset.value = Math.max(0, rollOffset.value + direction * ROLL_PAGE)
  void loadRoll()
}

function valueProperty(p: RatesProperty): void {
  showValuationForm.value = true
  valuationForm.value = { ...valuationForm.value, parcel_id: p.parcel_id }
}

async function addCategory(): Promise<void> {
  const f = categoryForm.value
  if (!f.code.trim() || !f.name.trim()) return
  const created = await act('category', 'The category could not be created.',
    () => ratesApi.createCategory({ code: f.code.trim(), name: f.name.trim() }))
  if (!created) return
  categories.value = [...categories.value, created].sort((a, b) => a.code.localeCompare(b.code))
  categoryForm.value = { code: '', name: '' }
  await loadReadiness()
}

const valuationFormComplete = computed(() => {
  const f = valuationForm.value
  return Boolean(f.parcel_id && f.property_category_id && /^\d+(\.\d{1,2})?$/.test(f.rateable_value.trim())
    && f.effective_from && f.source.trim().length >= 2)
})

async function recordValuation(): Promise<void> {
  if (!valuationFormComplete.value) return
  const f = valuationForm.value
  const created = await act('valuation', 'The valuation could not be recorded.', () => ratesApi.createValuation({
    parcel_id: f.parcel_id, property_category_id: f.property_category_id,
    rateable_value: f.rateable_value.trim(), currency: f.currency, effective_from: f.effective_from,
    source: f.source.trim(), status: f.status,
    ...(f.source_reference.trim() ? { source_reference: f.source_reference.trim() } : {}),
  }))
  if (!created) return
  note.value = created.status === 'active'
    ? `Rateable value ${formatMoney(created.rateable_value, created.currency)} recorded and in force from ${formatDate(created.effective_from)}.`
    : `Rateable value ${formatMoney(created.rateable_value, created.currency)} saved as a draft. A draft is invisible to a billing run.`
  showValuationForm.value = false
  valuationForm.value = { ...valuationForm.value, parcel_id: '', rateable_value: '' }
  await Promise.all([loadRoll(), loadReadiness()])
}

// ── 6. Tariffs ────────────────────────────────────────────────────────────────────────────────

const tariffs = ref<RatesTariff[]>([])
const tariffsNote = ref<string | null>(null)
const tariffsLoading = ref(false)
const showTariffForm = ref(false)
const tariffForm = ref({
  property_category_id: '', currency: 'USD' as Currency, rate_in_dollar: '',
  fixed_charge: '', minimum_charge: '', revenue_ledger_account_id: '',
})

async function loadTariffs(): Promise<void> {
  tariffsLoading.value = true
  try {
    const result = await ratesApi.tariffs({ financial_year_id: yearId.value ?? undefined })
    tariffs.value = result.tariffs
    tariffsNote.value = result.note
  } catch (err) {
    error.value = messageOf(err, 'The tariff schedule could not be read.')
  } finally {
    tariffsLoading.value = false
  }
}

const tariffFormComplete = computed(() => {
  const f = tariffForm.value
  const money = (v: string) => v.trim() === '' || /^\d+(\.\d{1,2})?$/.test(v.trim())
  return Boolean(yearId.value && f.property_category_id && /^\d+(\.\d{1,8})?$/.test(f.rate_in_dollar.trim())
    && money(f.fixed_charge) && money(f.minimum_charge))
})

async function draftTariff(): Promise<void> {
  if (!tariffFormComplete.value || !yearId.value) return
  const f = tariffForm.value
  const created = await act('tariff', 'The tariff could not be drafted.', () => ratesApi.draftTariff({
    financial_year_id: yearId.value as string, property_category_id: f.property_category_id,
    currency: f.currency, rate_in_dollar: f.rate_in_dollar.trim(),
    // An empty box is "the Council recorded none", which is sent as null and is not nil.
    fixed_charge: f.fixed_charge.trim() || null,
    minimum_charge: f.minimum_charge.trim() || null,
    revenue_ledger_account_id: f.revenue_ledger_account_id || null,
  }))
  if (!created) return
  note.value = created.note
  showTariffForm.value = false
  tariffForm.value = { ...tariffForm.value, rate_in_dollar: '', fixed_charge: '', minimum_charge: '' }
  await loadTariffs()
}

/** Did this person draft this tariff? Approving it is then not theirs to do. */
const isOwnTariff = (t: RatesTariff): boolean => me.value !== null && t.created_by === me.value

async function approveTariff(t: RatesTariff): Promise<void> {
  const reference = await prompt.ask({
    title: `Approve the ${t.category_code} rate of ${rateText(t.rate_in_dollar)} in the dollar`,
    message: 'Approving records that the Council resolved this rate; it does not decide it. Every billing run for this year, category and currency is then computed at it.',
    label: 'Council resolution or minute reference', kind: 'text', minLength: 3,
    initial: t.resolution_reference ?? '', submitLabel: 'Record the resolution',
  })
  if (reference === null) return
  const result = await act(t.id, 'The tariff could not be approved.',
    () => ratesApi.approveTariff(t.id, { resolution_reference: reference }))
  if (!result) return
  note.value = result.note
  await Promise.all([loadTariffs(), loadReadiness()])
}

async function supersedeTariff(t: RatesTariff): Promise<void> {
  const reason = await prompt.ask({
    title: `Supersede the approved ${t.category_code} tariff`,
    message: 'Bills already raised at this rate are unchanged: each carries the rate it was computed at. A replacement tariff is drafted and approved separately.',
    label: 'Reason', kind: 'textarea', minLength: 5, submitLabel: 'Supersede', danger: true,
  })
  if (reason === null) return
  const result = await act(t.id, 'The tariff could not be superseded.', () => ratesApi.supersedeTariff(t.id, reason))
  if (!result) return
  note.value = result.note
  await Promise.all([loadTariffs(), loadReadiness()])
}

async function discardTariff(t: RatesTariff): Promise<void> {
  const result = await act(t.id, 'The draft could not be discarded.', () => ratesApi.discardTariff(t.id))
  if (!result) return
  note.value = 'Draft tariff discarded.'
  await loadTariffs()
}

// ── Loading by tab ────────────────────────────────────────────────────────────────────────────

async function loadTab(which: Tab): Promise<void> {
  if (which === 'billing') await loadRuns()
  else if (which === 'receipts') await loadReceipts()
  else if (which === 'arrears') await loadArrears()
  else if (which === 'accounts') await loadAccounts()
  else if (which === 'roll') await loadRoll()
  else await loadTariffs()
}

watch(tab, (which) => { void loadTab(which) })
watch(yearId, () => {
  preview.value = null
  void loadReadiness()
  void loadTab(tab.value)
})

onMounted(async () => {
  await Promise.all([loadReadiness(), loadReference(), loadTab(tab.value)])
})
</script>

<template>
  <div class="ins-page fin-section">
    <FinancePromptDialog :controller="prompt" />

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <!-- ── What billing is waiting on. Always on screen, never collapsed. ──────────────────── -->
    <section class="ins-card" aria-labelledby="rates-ready-head">
      <div class="ins-card-head">
        <h2 id="rates-ready-head" class="ins-card-title">What rates billing is waiting on</h2>
        <button type="button" class="fin-btn small" @click="loadReadiness">
          <RefreshCw :size="13" aria-hidden="true" /> Refresh
        </button>
      </div>
      <div class="ins-card-body">
        <div v-if="readinessFailed" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="16" aria-hidden="true" /><span>{{ readinessFailed }}</span>
        </div>
        <p v-else-if="!readiness" class="rates-loading" role="status">Reading the registers…</p>
        <template v-else>
          <ul class="rates-blockers">
            <li v-for="b in readiness.blockers" :key="b.decision" class="rates-blocker"
                :class="{ 'is-met': b.met }">
              <component :is="b.met ? Check : CircleDashed" :size="16" aria-hidden="true" class="rates-blocker-mark" />
              <span class="rates-blocker-id">{{ b.decision }}</span>
              <span class="rates-blocker-text">
                <strong>{{ b.statement }}</strong>
                <span>{{ b.detail }}</span>
              </span>
              <span class="fin-pill" :class="b.met ? 'tone-positive' : 'tone-warning'">
                {{ b.met ? 'In place' : b.outstanding !== null ? `${b.outstanding} outstanding` : 'Outstanding' }}
              </span>
            </li>
          </ul>
          <p v-if="readiness.ledger.note" class="rates-caption">
            <Info :size="14" aria-hidden="true" /><span>{{ readiness.ledger.note }}</span>
          </p>
          <p v-if="readiness.ledger.periods && readiness.ledger.periods.open === 0" class="rates-caption">
            <Info :size="14" aria-hidden="true" />
            <span>
              No accounting period is open for {{ store.selectedYear?.label }}, so nothing raised
              here could be posted. Periods are opened under General ledger.
            </span>
          </p>
          <p v-if="readiness.note" class="rates-caption">
            <Info :size="14" aria-hidden="true" /><span>{{ readiness.note }}</span>
          </p>
        </template>
      </div>
    </section>

    <div class="rates-tabs" role="tablist" aria-label="Rates">
      <button v-for="t in TABS" :id="`rates-tab-${t.key}`" :key="t.key" type="button" role="tab"
              class="rates-tab" :class="{ 'is-current': tab === t.key }"
              :aria-selected="tab === t.key" :aria-controls="`rates-panel-${t.key}`" @click="tab = t.key">
        <span class="rates-tab-label">{{ t.label }}</span>
        <span class="rates-tab-hint">{{ t.hint }}</span>
      </button>
    </div>

    <!-- ══ 1. Billing runs ══════════════════════════════════════════════════════════════════ -->
    <section v-if="tab === 'billing'" id="rates-panel-billing" class="ins-card" role="tabpanel"
             aria-labelledby="rates-tab-billing">
      <div class="ins-card-body">
        <div v-if="!yearId" class="fin-empty">
          <strong>No financial year is selected.</strong>
          <p>Choose a reporting period above. A billing run bills one period of one year.</p>
        </div>
        <template v-else>
          <form class="rates-form" @submit.prevent="runPreview">
            <div class="ins-form">
              <div class="ins-field">
                <label class="ins-label" for="rates-run-from">Billed from</label>
                <input id="rates-run-from" v-model="runForm.period_from" class="ins-input" type="date" required />
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-run-to">Billed to</label>
                <input id="rates-run-to" v-model="runForm.period_to" class="ins-input" type="date" required />
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-run-ccy">Book</label>
                <select id="rates-run-ccy" v-model="runForm.currency" class="ins-input">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
                <p class="ins-hint">
                  A run bills one currency. A property valued in the other is refused, not converted.
                </p>
              </div>
            </div>
            <div class="ins-actions">
              <button type="submit" class="fin-btn" :disabled="!periodComplete || busy === 'preview'">
                <Search :size="14" aria-hidden="true" />
                {{ busy === 'preview' ? 'Computing…' : 'Preview this period' }}
              </button>
            </div>
          </form>

          <div v-if="preview && previewIsCurrent" class="rates-preview" aria-live="polite">
            <dl class="rates-facts">
              <div><dt>Properties considered</dt><dd>{{ preview.properties_considered }}</dd></div>
              <div><dt>Would be billed</dt><dd>{{ preview.billable }}</dd></div>
              <div><dt>Would be refused</dt><dd>{{ preview.refused }}</dd></div>
              <div>
                <dt>Would be billed, in {{ preview.currency }}</dt>
                <dd class="rates-money">{{ formatMoney(preview.total_amount, preview.currency) }}</dd>
              </div>
            </dl>
            <p class="rates-caption"><Info :size="14" aria-hidden="true" /><span>{{ preview.note }}</span></p>

            <div class="fin-table-wrap">
              <table class="fin-table">
                <caption class="rates-table-caption">Why properties would not be billed</caption>
                <thead>
                  <tr><th scope="col">Reason</th><th scope="col">Waiting on</th><th scope="col" class="num">Properties</th></tr>
                </thead>
                <tbody>
                  <tr v-for="r in preview.refusals" :key="r.reason_code" :class="{ 'rates-zero': r.properties === 0 }">
                    <td>{{ r.label }}</td>
                    <td>
                      <span v-if="r.waiting_on" :title="r.decision ?? undefined">{{ r.waiting_on }}</span>
                      <span v-else class="rates-sub">not a Council decision</span>
                    </td>
                    <td class="num">{{ r.properties === 0 ? 'none' : r.properties }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="preview.rows.length" class="fin-table-wrap">
              <table class="fin-table">
                <caption class="rates-table-caption">
                  The bills this run would raise<template v-if="preview.billable > preview.rows.length">
                    — the first {{ preview.rows.length }} of {{ preview.billable }}</template>
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Stand</th><th scope="col">Account</th><th scope="col">Ratepayer</th>
                    <th scope="col">Category</th><th scope="col" class="num">Rateable value</th>
                    <th scope="col" class="num">Rate in the dollar</th><th scope="col" class="num">Charge</th>
                    <th scope="col" class="ccy">Ccy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in preview.rows" :key="row.parcel_id">
                    <td>{{ row.stand_no ?? row.parcel_id }}</td>
                    <td class="ins-mono">{{ row.account_no }}</td>
                    <td>{{ row.party_name }}</td>
                    <td>{{ row.category_code }}</td>
                    <td class="num">{{ formatMoney(row.rateable_value, null) }}</td>
                    <td class="num">{{ rateText(row.rate_in_dollar) }}</td>
                    <td class="num emphasis">{{ formatMoney(row.bill_amount, null) }}</td>
                    <td class="ccy">{{ preview.currency }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <form v-if="canPrepare" class="rates-form" @submit.prevent="raiseRun">
              <div class="ins-form">
                <div class="ins-field">
                  <label class="ins-label" for="rates-run-ref">Run reference</label>
                  <input id="rates-run-ref" v-model="runForm.run_reference" class="ins-input" maxlength="40"
                         minlength="3" required />
                  <p class="ins-hint">Each bill is numbered from it: reference-00001, -00002, and so on.</p>
                </div>
                <div class="ins-field">
                  <label class="ins-label" for="rates-run-post">Posting date</label>
                  <input id="rates-run-post" v-model="runForm.posting_date" class="ins-input" type="date" required />
                  <p class="ins-hint">Must fall in an open accounting period. Arrears age from this date.</p>
                </div>
                <div class="ins-field">
                  <label class="ins-label" for="rates-run-due">Due on <span class="rates-sub">(optional)</span></label>
                  <input id="rates-run-due" v-model="runForm.due_on" class="ins-input" type="date" />
                </div>
                <div class="ins-field">
                  <label class="ins-label" for="rates-run-recv">Receivable control account</label>
                  <select id="rates-run-recv" v-model="runForm.receivable_ledger_account_id" class="ins-input" required>
                    <option value="" disabled>Choose…</option>
                    <option v-for="a in receivableAccounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
                  </select>
                  <p v-if="receivableAccounts.length === 0" class="ins-hint">
                    The chart of accounts has no receivable control account. One is added under General ledger.
                  </p>
                </div>
                <div class="ins-field">
                  <label class="ins-label" for="rates-run-rev">Rates revenue account</label>
                  <select id="rates-run-rev" v-model="runForm.revenue_ledger_account_id" class="ins-input" required>
                    <option value="" disabled>Choose…</option>
                    <option v-for="a in revenueAccounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
                  </select>
                  <p class="ins-hint">Revenue is recognised when billed, not when received.</p>
                </div>
              </div>
              <div class="ins-actions">
                <button type="submit" class="fin-btn primary" :disabled="!runFormComplete || busy === 'raise'">
                  <Plus :size="14" aria-hidden="true" />
                  {{ busy === 'raise' ? 'Raising…' : 'Raise the run as drafts' }}
                </button>
                <span class="rates-sub">
                  Raising posts nothing. The run is committed afterwards, by somebody else.
                </span>
              </div>
            </form>
            <p v-else class="rates-absent">
              <Info :size="14" aria-hidden="true" />
              <span>{{ store.whyUnavailable('finance.rates.bill.prepare') }}</span>
            </p>
          </div>

          <h3 class="rates-subhead">Runs for {{ store.selectedYear?.label }}</h3>
          <p v-if="runsLoading" class="rates-loading" role="status">Reading the billing runs…</p>
          <div v-else-if="runs.length === 0" class="fin-empty">
            <strong>No billing run has been raised for this year.</strong>
            <p>Preview a period above to see what a run would bill and what it would refuse.</p>
          </div>
          <div v-else class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Run</th><th scope="col">Period billed</th><th scope="col">Status</th>
                  <th scope="col" class="num">Bills</th><th scope="col" class="num">Refused</th>
                  <th scope="col" class="num">Billed</th><th scope="col" class="ccy">Ccy</th>
                  <th scope="col">Raised by</th><th scope="col"><span class="rates-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="run in runs" :key="run.id">
                  <tr>
                    <td class="ins-mono">{{ run.run_reference }}</td>
                    <td>{{ formatDate(run.period_from) }} – {{ formatDate(run.period_to) }}</td>
                    <td><span class="fin-pill" :class="statusTone(run.status)">{{ run.status }}</span></td>
                    <td class="num">{{ run.bills_raised }}</td>
                    <td class="num">{{ run.properties_refused }}</td>
                    <td class="num">{{ formatMoney(run.total_billed, null) }}</td>
                    <td class="ccy">{{ run.currency }}</td>
                    <td>
                      {{ run.prepared_by_name ?? '—' }}
                      <span class="rates-sub">{{ formatDateTime(run.prepared_at) }}</span>
                    </td>
                    <td class="rates-acts">
                      <button type="button" class="fin-btn small" :aria-expanded="openRunId === run.id"
                              @click="showRefusals(run)">
                        {{ openRunId === run.id ? 'Hide refusals' : 'Refusals' }}
                      </button>
                      <template v-if="run.status === 'raised'">
                        <button v-if="canCommit && !isOwnRun(run) && run.bills_raised > 0" type="button"
                                class="fin-btn small primary" :disabled="busy === run.id" @click="commitRun(run)">
                          Commit
                        </button>
                        <button v-if="canPrepare || canCommit" type="button" class="fin-btn small danger"
                                :disabled="busy === run.id" @click="cancelRun(run)">Cancel</button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="run.status === 'raised' && canCommit && isOwnRun(run)" class="rates-explain">
                    <td colspan="9">
                      You raised this run, so committing it is not yours to do. Committing must come
                      from someone else; that is a constraint on the record, not on this screen.
                    </td>
                  </tr>
                  <tr v-if="run.status === 'cancelled' && run.cancel_reason" class="rates-explain">
                    <td colspan="9">Cancelled: {{ run.cancel_reason }}</td>
                  </tr>
                  <tr v-if="openRunId === run.id" class="rates-detail">
                    <td colspan="9">
                      <p v-if="runRefusals.length === 0" class="rates-sub">This run refused no property.</p>
                      <template v-else>
                        <p class="rates-sub">
                          {{ runRefusalTotal }} {{ runRefusalTotal === 1 ? 'property was' : 'properties were' }}
                          not billed<template v-if="runRefusalTotal > runRefusals.length">
                            — the first {{ runRefusals.length }} are listed</template>.
                          Each names the decision it waits on.
                        </p>
                        <table class="fin-table">
                          <thead>
                            <tr><th scope="col">Stand</th><th scope="col">Ward</th><th scope="col">Waiting on</th><th scope="col">Why it was not billed</th></tr>
                          </thead>
                          <tbody>
                            <tr v-for="x in runRefusals" :key="x.id">
                              <td>{{ x.stand_no ?? x.parcel_id }}</td>
                              <td>{{ x.ward_code ?? '—' }}</td>
                              <td>{{ x.waiting_on ?? '—' }}</td>
                              <td>{{ x.message }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </template>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>

    <!-- ══ 2. Receipts ══════════════════════════════════════════════════════════════════════ -->
    <section v-else-if="tab === 'receipts'" id="rates-panel-receipts" class="ins-card" role="tabpanel"
             aria-labelledby="rates-tab-receipts">
      <div class="ins-card-body">
        <div class="fin-bar">
          <button v-if="canReceipt && yearId" type="button" class="fin-btn primary"
                  @click="showReceiptForm ? (showReceiptForm = false) : openReceiptForm()">
            <component :is="showReceiptForm ? X : Plus" :size="14" aria-hidden="true" />
            {{ showReceiptForm ? 'Close' : 'Record a payment' }}
          </button>
          <button type="button" class="fin-btn small" :disabled="receiptsLoading" @click="loadReceipts">
            <RefreshCw :size="13" aria-hidden="true" /> Refresh
          </button>
        </div>
        <p v-if="!canReceipt" class="rates-absent">
          <Info :size="14" aria-hidden="true" />
          <span>{{ store.whyUnavailable('finance.rates.receipt.record') }}</span>
        </p>

        <form v-if="showReceiptForm" class="rates-form" @submit.prevent="recordReceipt">
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-no">Receipt number</label>
              <input id="rates-rc-no" v-model="receiptForm.receipt_no" class="ins-input" maxlength="60" required />
              <p class="ins-hint">As printed on the receipt given to the ratepayer. A number is never reused.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-acct">Rates account</label>
              <select id="rates-rc-acct" v-model="receiptForm.rates_account_id" class="ins-input" required>
                <option value="" disabled>Choose…</option>
                <option v-for="a in receiptAccounts" :key="a.id" :value="a.id">
                  {{ a.account_no }} — {{ a.party_name }} ({{ a.stand_no ?? a.parcel_id }})
                </option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-ccy">Book</label>
              <select id="rates-rc-ccy" v-model="receiptForm.currency" class="ins-input">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <p class="ins-hint">A payment settles bills in its own currency only.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-amt">Amount received</label>
              <input id="rates-rc-amt" v-model="receiptForm.amount" class="ins-input" inputmode="decimal"
                     pattern="\d+(\.\d{1,2})?" placeholder="0.00" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-date">Received on</label>
              <input id="rates-rc-date" v-model="receiptForm.received_on" class="ins-input" type="date" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-bank">Banked into</label>
              <select id="rates-rc-bank" v-model="receiptForm.bank_ledger_account_id" class="ins-input" required>
                <option value="" disabled>Choose…</option>
                <option v-for="a in bankAccounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-method">Method <span class="rates-sub">(optional)</span></label>
              <select id="rates-rc-method" v-model="receiptForm.method" class="ins-input">
                <option value="">Not recorded</option>
                <option v-for="m in METHODS" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-rc-ref">Bank or transaction reference <span class="rates-sub">(optional)</span></label>
              <input id="rates-rc-ref" v-model="receiptForm.reference" class="ins-input" maxlength="120" />
            </div>
          </div>

          <div v-if="receiptForm.rates_account_id" class="rates-allocate">
            <p v-if="payableBills.length === 0" class="rates-sub">
              This account has no posted {{ receiptForm.currency }} bill with anything open, so the
              whole payment stays on the account as an unallocated credit.
            </p>
            <template v-else>
              <table class="fin-table">
                <caption class="rates-table-caption">Allocate the payment to bills</caption>
                <thead>
                  <tr>
                    <th scope="col">Bill</th><th scope="col">Period</th>
                    <th scope="col" class="num">Still open</th><th scope="col">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="b in payableBills" :key="b.id">
                    <td class="ins-mono">{{ b.bill_no }}</td>
                    <td>{{ formatDate(b.period_from) }} – {{ formatDate(b.period_to) }}</td>
                    <td class="num">{{ formatMoney(b.open_amount, b.currency) }}</td>
                    <td class="rates-alloc-cell">
                      <input v-model="allocation[b.id]" class="ins-input rates-amount" inputmode="decimal"
                             pattern="\d+(\.\d{1,2})?" placeholder="0.00" :aria-label="`Amount allocated to bill ${b.bill_no}`" />
                      <button type="button" class="fin-btn small" @click="allocation[b.id] = b.open_amount">
                        Settle in full
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="rates-caption">
                <Info :size="14" aria-hidden="true" />
                <span>
                  Whatever is not allocated stays on the account as a credit; the saved receipt
                  states that figure. This form does not add the allocations up — money is not
                  computed in the browser — and the database refuses an allocation larger than the
                  bill has open, or allocations larger than the payment.
                </span>
              </p>
            </template>
            <div v-if="payableBills.length === 0" class="ins-field rates-narrow">
              <label class="ins-label" for="rates-rc-recv">Receivable control account for the credit</label>
              <select id="rates-rc-recv" v-model="receiptForm.receivable_ledger_account_id" class="ins-input">
                <option value="">The account this ratepayer's bills use</option>
                <option v-for="a in receivableAccounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
              </select>
            </div>
          </div>

          <div class="ins-actions">
            <button type="button" class="fin-btn" @click="showReceiptForm = false">Cancel</button>
            <button type="submit" class="fin-btn primary" :disabled="!receiptFormComplete || busy === 'receipt'">
              {{ busy === 'receipt' ? 'Recording…' : 'Record as a draft' }}
            </button>
            <span class="rates-sub">It reaches the book of account when somebody else posts it.</span>
          </div>
        </form>

        <p v-if="receiptsLoading" class="rates-loading" role="status">Reading the receipts…</p>
        <div v-else-if="receipts.length === 0" class="fin-empty">
          <strong>No receipt has been recorded for this year.</strong>
          <p>A receipt settles posted bills, so there is nothing to receipt against until a billing run is committed.</p>
        </div>
        <template v-else>
          <ul class="rates-totals" aria-label="Receipts by currency and status">
            <li v-for="t in receiptTotals" :key="`${t.currency}-${t.voucher_status}`">
              <span>{{ t.receipts }} {{ t.voucher_status }}</span>
              <strong class="rates-money">{{ formatMoney(t.amount, t.currency) }}</strong>
            </li>
          </ul>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Receipt</th><th scope="col">Received</th><th scope="col">Account</th>
                  <th scope="col">Ratepayer</th><th scope="col">Status</th>
                  <th scope="col" class="num">Amount</th><th scope="col" class="num">Unallocated</th>
                  <th scope="col" class="ccy">Ccy</th><th scope="col"><span class="rates-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="r in receipts" :key="r.id">
                  <tr>
                    <td class="ins-mono">{{ r.receipt_no }}</td>
                    <td>{{ formatDate(r.received_on) }}</td>
                    <td class="ins-mono">{{ r.account_no }}</td>
                    <td>{{ r.party_name }}</td>
                    <td><span class="fin-pill" :class="statusTone(r.voucher_status)">{{ r.voucher_status }}</span></td>
                    <td class="num">{{ formatMoney(r.amount, null) }}</td>
                    <td class="num">{{ formatMoney(r.unallocated_amount, null) }}</td>
                    <td class="ccy">{{ r.currency }}</td>
                    <td class="rates-acts">
                      <template v-if="r.voucher_status === 'draft'">
                        <button v-if="canPostVoucher && !isOwnReceipt(r)" type="button" class="fin-btn small primary"
                                :disabled="busy === r.id" @click="postReceipt(r)">Post</button>
                        <button v-if="canReceipt" type="button" class="fin-btn small danger"
                                :disabled="busy === r.id" @click="cancelReceipt(r)">Cancel</button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="r.voucher_status === 'draft' && canPostVoucher && isOwnReceipt(r)" class="rates-explain">
                    <td colspan="9">
                      You recorded this receipt, so posting it is not yours to do. Whoever takes a
                      payment does not also put it in the book of account.
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>

    <!-- ══ 3. Arrears ═══════════════════════════════════════════════════════════════════════ -->
    <section v-else-if="tab === 'arrears'" id="rates-panel-arrears" class="ins-card" role="tabpanel"
             aria-labelledby="rates-tab-arrears">
      <div class="ins-card-body">
        <form class="fin-bar" @submit.prevent="loadArrears">
          <label class="ins-search">
            <Search :size="14" aria-hidden="true" />
            <input v-model="arrearsQuery" class="ins-input" type="search"
                   placeholder="Account, ratepayer or stand" aria-label="Search the arrears" />
          </label>
          <button type="submit" class="fin-btn small" :disabled="arrearsLoading">
            <RefreshCw :size="13" aria-hidden="true" /> Refresh
          </button>
        </form>

        <p v-if="arrearsLoading && !arrears" class="rates-loading" role="status">Reading the arrears…</p>
        <template v-else-if="arrears">
          <p class="rates-caption">
            <Info :size="14" aria-hidden="true" />
            <span>As at {{ formatDate(arrears.as_at) }}. {{ arrears.note }}</span>
          </p>

          <div v-if="arrears.books.length === 0" class="fin-empty">
            <strong>Nothing is owed on rates.</strong>
            <p>
              Arrears are drawn from the posted ledger. A run that is raised and not yet committed,
              and a receipt that is recorded and not yet posted, are not in these figures.
            </p>
          </div>

          <div v-for="book in arrears.books" :key="book.currency" class="rates-book">
            <h3 class="rates-subhead">{{ book.currency }} book — by age</h3>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr><th scope="col">Age</th><th scope="col" class="num">Documents</th>
                    <th scope="col" class="num">Outstanding</th><th scope="col" class="ccy">Ccy</th></tr>
                </thead>
                <tbody>
                  <tr v-for="b in book.buckets" :key="b.bucket" :class="{ 'rates-zero': b.documents === 0 }">
                    <td>{{ b.label }}</td>
                    <td class="num">{{ b.documents === 0 ? 'none' : b.documents }}</td>
                    <td class="num">{{ formatMoney(b.outstanding, null) }}</td>
                    <td class="ccy">{{ book.currency }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <template v-if="arrears.accounts.length">
            <h3 class="rates-subhead">Ratepayers with a balance</h3>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr>
                    <th scope="col">Account</th><th scope="col">Ratepayer</th><th scope="col">Stand</th>
                    <th scope="col">Ward</th><th scope="col" class="num">Open bills</th>
                    <th scope="col" class="num">Oldest, days</th><th scope="col" class="num">Owed</th>
                    <th scope="col" class="num">Unallocated credit</th><th scope="col" class="num">Balance</th>
                    <th scope="col" class="ccy">Ccy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="a in arrears.accounts" :key="`${a.rates_account_id}-${a.currency}`">
                    <td class="ins-mono">{{ a.account_no }}</td>
                    <td>{{ a.party_name }}</td>
                    <td>{{ a.stand_no ?? a.parcel_id }}</td>
                    <td>{{ a.ward_code ?? '—' }}</td>
                    <td class="num">{{ a.open_bills }}</td>
                    <td class="num">{{ a.oldest_days ?? '—' }}</td>
                    <td class="num">{{ formatMoney(a.owed, null) }}</td>
                    <td class="num">{{ formatMoney(a.unallocated_credit, null) }}</td>
                    <td class="num emphasis">{{ formatMoney(a.balance, null) }}</td>
                    <td class="ccy">{{ a.currency }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="arrears.total > arrears.accounts.length" class="rates-sub">
              The first {{ arrears.accounts.length }} of {{ arrears.total }}, largest balance first. Search to narrow.
            </p>
          </template>

          <template v-if="arrears.reconciliation.length">
            <h3 class="rates-subhead">Agreement with the receivable control account</h3>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr>
                    <th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Control account</th>
                    <th scope="col" class="num">Ledger debtor ageing</th><th scope="col" class="num">Of which rates</th>
                    <th scope="col" class="num">Other debtors</th><th scope="col" class="num">Difference</th>
                    <th scope="col">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in arrears.reconciliation" :key="r.currency">
                    <td class="ccy">{{ r.currency }}</td>
                    <td class="num">{{ formatMoney(r.control_balance, null) }}</td>
                    <td class="num">{{ formatMoney(r.ledger_ageing, null) }}</td>
                    <td class="num">{{ formatMoney(r.rates_arrears, null) }}</td>
                    <td class="num">{{ formatMoney(r.other_debtors, null) }}</td>
                    <td class="num" :class="{ 'rates-off': !r.reconciles }">{{ formatMoney(r.ledger_difference, null) }}</td>
                    <td>
                      <span class="fin-pill" :class="r.reconciles ? 'tone-positive' : 'tone-negative'">
                        {{ r.reconciles ? 'Agrees' : 'Does not agree' }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="rates-caption">
              <Info :size="14" aria-hidden="true" />
              <span>
                Over the whole control account, not the search above: a reconciliation of a filtered
                slice proves nothing. A difference other than nil means this report has stopped
                agreeing with the book of account and should be treated as a defect, not a rounding.
              </span>
            </p>
          </template>
        </template>
      </div>
    </section>

    <!-- ══ 4. Rates accounts ════════════════════════════════════════════════════════════════ -->
    <section v-else-if="tab === 'accounts'" id="rates-panel-accounts" class="ins-card" role="tabpanel"
             aria-labelledby="rates-tab-accounts">
      <div class="ins-card-body">
        <form class="fin-bar" @submit.prevent="loadAccounts">
          <label class="ins-search">
            <Search :size="14" aria-hidden="true" />
            <input v-model="accountsQuery" class="ins-input" type="search"
                   placeholder="Account number, ratepayer or stand" aria-label="Search rates accounts" />
          </label>
          <button type="submit" class="fin-btn small" :disabled="accountsLoading">Search</button>
          <button v-if="canKeepAccounts" type="button" class="fin-btn primary"
                  @click="showAccountForm ? (showAccountForm = false) : openAccountForm()">
            <component :is="showAccountForm ? X : Plus" :size="14" aria-hidden="true" />
            {{ showAccountForm ? 'Close' : 'Open an account' }}
          </button>
        </form>

        <form v-if="showAccountForm" class="rates-form" @submit.prevent="openAccount">
          <div class="ins-form">
            <div class="ins-field full">
              <label class="ins-label" for="rates-ac-prop">Property</label>
              <div class="rates-inline">
                <input id="rates-ac-prop" v-model="propertyQuery" class="ins-input" type="search"
                       placeholder="Stand number or parcel id" @keydown.enter.prevent="searchProperties" />
                <button type="button" class="fin-btn" :disabled="busy === 'property-search'" @click="searchProperties">Find</button>
              </div>
              <ul v-if="propertyHits.length" class="rates-picks">
                <li v-for="p in propertyHits" :key="p.parcel_id">
                  <label class="rates-pick" :class="{ 'is-taken': p.has_rates_account }">
                    <input v-model="accountForm.parcel_id" type="radio" name="rates-ac-parcel" :value="p.parcel_id"
                           :disabled="p.has_rates_account" />
                    <span>
                      Stand {{ p.stand_no ?? '—' }} <span class="rates-sub">{{ p.parcel_id }}, ward {{ p.ward_code ?? '—' }}</span>
                      <span v-if="p.has_rates_account" class="rates-sub">
                        — already has account {{ p.account_no }} ({{ p.party_name }})
                      </span>
                    </span>
                  </label>
                </li>
              </ul>
              <p v-else-if="propertySearched" class="ins-hint">No current property matches that.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-ac-no">Rates account number</label>
              <input id="rates-ac-no" v-model="accountForm.account_no" class="ins-input" maxlength="60" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-ac-party">Ratepayer of record</label>
              <select id="rates-ac-party" v-model="accountForm.party_id" class="ins-input" required>
                <option value="" disabled>Choose…</option>
                <option v-for="p in parties" :key="p.id" :value="p.id">
                  {{ p.name }}<template v-if="p.reference"> ({{ p.reference }})</template>
                </option>
              </select>
              <p class="ins-hint">
                Entered from the Council's own records. The owner register this would be loaded from
                holds no rows (decision D19), and no ratepayer is inferred.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-ac-erp">Promun/Pastel account number <span class="rates-sub">(optional)</span></label>
              <input id="rates-ac-erp" v-model="accountForm.erp_account_no" class="ins-input" maxlength="60" />
              <p class="ins-hint">Kept so the parallel run can be reconciled account by account.</p>
            </div>
          </div>
          <div v-if="canKeepParties" class="rates-inline rates-newparty">
            <span class="rates-sub">Not in the list?</span>
            <input v-model="partyForm.name" class="ins-input" placeholder="Ratepayer's name" aria-label="New ratepayer's name" maxlength="300" />
            <input v-model="partyForm.reference" class="ins-input rates-narrow" placeholder="Reference (optional)"
                   aria-label="New ratepayer's reference" maxlength="120" />
            <button type="button" class="fin-btn" :disabled="!partyForm.name.trim() || busy === 'party'" @click="addParty">
              Add ratepayer
            </button>
          </div>
          <div class="ins-actions">
            <button type="button" class="fin-btn" @click="showAccountForm = false">Cancel</button>
            <button type="submit" class="fin-btn primary"
                    :disabled="!accountForm.account_no.trim() || !accountForm.parcel_id || !accountForm.party_id || busy === 'account'">
              {{ busy === 'account' ? 'Opening…' : 'Open the account' }}
            </button>
          </div>
        </form>

        <p v-if="accountsLoading" class="rates-loading" role="status">Reading the rates accounts…</p>
        <div v-else-if="accounts.length === 0" class="fin-empty">
          <strong>{{ accountsQuery.trim() ? 'No rates account matches that.' : 'No rates account exists.' }}</strong>
          <p v-if="accountsNote">{{ accountsNote }}</p>
        </div>
        <template v-else>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Account</th><th scope="col">Ratepayer</th><th scope="col">Stand</th>
                  <th scope="col">Ward</th><th scope="col">Opened</th><th scope="col">Status</th>
                  <th scope="col"><span class="rates-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="a in accounts" :key="a.id">
                  <tr>
                    <td class="ins-mono">{{ a.account_no }}</td>
                    <td>{{ a.party_name }}</td>
                    <td>{{ a.stand_no ?? a.parcel_id }}</td>
                    <td>{{ a.ward_code ?? '—' }}</td>
                    <td>{{ formatDate(a.opened_on) }}</td>
                    <td><span class="fin-pill" :class="statusTone(a.status)">{{ a.status }}</span></td>
                    <td class="rates-acts">
                      <button type="button" class="fin-btn small" :aria-expanded="statement?.account.id === a.id"
                              @click="showStatement(a)">
                        {{ statement?.account.id === a.id ? 'Hide statement' : 'Statement' }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="statement && statement.account.id === a.id" class="rates-detail">
                    <td colspan="7">
                      <ul v-if="statement.balances.length" class="rates-totals" aria-label="Balance by currency">
                        <li v-for="b in statement.balances" :key="b.currency">
                          <span>Owed {{ formatMoney(b.owed, b.currency) }}, unallocated credit {{ formatMoney(b.unallocated_credit, b.currency) }}</span>
                          <strong class="rates-money">Balance {{ formatMoney(b.balance, b.currency) }}</strong>
                        </li>
                      </ul>
                      <p v-else class="rates-sub">Nothing is posted to this account yet.</p>
                      <table v-if="statement.bills.length" class="fin-table">
                        <caption class="rates-table-caption">Bills</caption>
                        <thead>
                          <tr><th scope="col">Bill</th><th scope="col">Period</th><th scope="col">Status</th>
                            <th scope="col" class="num">Charge</th><th scope="col" class="num">Outstanding</th>
                            <th scope="col" class="ccy">Ccy</th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="b in statement.bills" :key="b.id">
                            <td class="ins-mono">{{ b.bill_no }}</td>
                            <td>{{ formatDate(b.period_from) }} – {{ formatDate(b.period_to) }}</td>
                            <td><span class="fin-pill" :class="statusTone(b.voucher_status)">{{ b.voucher_status }}</span></td>
                            <td class="num">{{ formatMoney(b.amount, null) }}</td>
                            <td class="num">
                              <template v-if="b.outstanding_amount !== null">{{ formatMoney(b.outstanding_amount, null) }}</template>
                              <span v-else class="undefined-value">not posted</span>
                            </td>
                            <td class="ccy">{{ b.currency }}</td>
                          </tr>
                        </tbody>
                      </table>
                      <table v-if="statement.receipts.length" class="fin-table">
                        <caption class="rates-table-caption">Receipts</caption>
                        <thead>
                          <tr><th scope="col">Receipt</th><th scope="col">Received</th><th scope="col">Status</th>
                            <th scope="col" class="num">Amount</th><th scope="col" class="ccy">Ccy</th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="r in statement.receipts" :key="r.id">
                            <td class="ins-mono">{{ r.receipt_no }}</td>
                            <td>{{ formatDate(r.received_on) }}</td>
                            <td><span class="fin-pill" :class="statusTone(r.voucher_status)">{{ r.voucher_status }}</span></td>
                            <td class="num">{{ formatMoney(r.amount, null) }}</td>
                            <td class="ccy">{{ r.currency }}</td>
                          </tr>
                        </tbody>
                      </table>
                      <p class="rates-sub">{{ statement.note }}</p>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p v-if="accountsTotal > accounts.length" class="rates-sub">
            The first {{ accounts.length }} of {{ accountsTotal }}. Search to narrow.
          </p>
        </template>
      </div>
    </section>

    <!-- ══ 5. The valuation roll ════════════════════════════════════════════════════════════ -->
    <section v-else-if="tab === 'roll'" id="rates-panel-roll" class="ins-card" role="tabpanel"
             aria-labelledby="rates-tab-roll">
      <div class="ins-card-body">
        <h3 class="rates-subhead">Property categories</h3>
        <p v-if="categories.length === 0" class="rates-sub">
          No category is recorded. The categories a council rates by are Council data (decisions D17
          and D18); none is assumed.
        </p>
        <ul v-else class="rates-chips">
          <li v-for="c in categories" :key="c.id" class="fin-pill" :class="c.status === 'active' ? '' : 'tone-negative'">
            <span class="ins-mono">{{ c.code }}</span> {{ c.name }}
          </li>
        </ul>
        <form v-if="canKeepCategories" class="rates-inline" @submit.prevent="addCategory">
          <input v-model="categoryForm.code" class="ins-input rates-narrow" placeholder="Code" aria-label="New category code" maxlength="40" />
          <input v-model="categoryForm.name" class="ins-input" placeholder="Name, as the Council's roll states it" aria-label="New category name" maxlength="200" />
          <button type="submit" class="fin-btn" :disabled="!categoryForm.code.trim() || !categoryForm.name.trim() || busy === 'category'">
            Add category
          </button>
        </form>

        <h3 class="rates-subhead">The roll</h3>
        <form class="fin-bar" @submit.prevent="rollOffset = 0; loadRoll()">
          <label class="ins-search">
            <Search :size="14" aria-hidden="true" />
            <input v-model="rollFilter.q" class="ins-input" type="search"
                   placeholder="Stand, parcel, account or ratepayer" aria-label="Search the valuation roll" />
          </label>
          <select v-model="rollFilter.valued" class="ins-input rates-narrow" aria-label="Whether the property has a rateable value"
                  @change="rollOffset = 0; loadRoll()">
            <option value="">All properties</option>
            <option value="no">No rateable value</option>
            <option value="yes">Has a rateable value</option>
          </select>
          <button type="submit" class="fin-btn small" :disabled="rollLoading">Search</button>
        </form>

        <form v-if="showValuationForm" class="rates-form" @submit.prevent="recordValuation">
          <p class="rates-sub">Recording a rateable value for parcel <span class="ins-mono">{{ valuationForm.parcel_id }}</span>.</p>
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="rates-val-cat">Property category</label>
              <select id="rates-val-cat" v-model="valuationForm.property_category_id" class="ins-input" required>
                <option value="" disabled>Choose…</option>
                <option v-for="c in activeCategories" :key="c.id" :value="c.id">{{ c.code }} — {{ c.name }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-amt">Rateable value</label>
              <input id="rates-val-amt" v-model="valuationForm.rateable_value" class="ins-input" inputmode="decimal"
                     pattern="\d+(\.\d{1,2})?" placeholder="0.00" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-ccy">Currency of the value</label>
              <select id="rates-val-ccy" v-model="valuationForm.currency" class="ins-input">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-from">In force from</label>
              <input id="rates-val-from" v-model="valuationForm.effective_from" class="ins-input" type="date" required />
              <p class="ins-hint">A period is billed on the value in force on its first day.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-src">Source</label>
              <input id="rates-val-src" v-model="valuationForm.source" class="ins-input" maxlength="300" required
                     placeholder="e.g. General valuation roll 2025" />
              <p class="ins-hint">The roll this value came from. A value with no stated source is a number somebody typed.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-ref">Reference in that roll <span class="rates-sub">(optional)</span></label>
              <input id="rates-val-ref" v-model="valuationForm.source_reference" class="ins-input" maxlength="120" />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="rates-val-status">Save as</label>
              <select id="rates-val-status" v-model="valuationForm.status" class="ins-input">
                <option value="draft">Draft — not yet used by billing</option>
                <option value="active">In force</option>
              </select>
              <p class="ins-hint">Once in force, a value is not edited: a new value is a new entry.</p>
            </div>
          </div>
          <div class="ins-actions">
            <button type="button" class="fin-btn" @click="showValuationForm = false">Cancel</button>
            <button type="submit" class="fin-btn primary" :disabled="!valuationFormComplete || busy === 'valuation'">
              {{ busy === 'valuation' ? 'Recording…' : 'Record the value' }}
            </button>
          </div>
        </form>

        <p v-if="rollLoading" class="rates-loading" role="status">Reading the roll…</p>
        <div v-else-if="properties.length === 0" class="fin-empty">
          <strong>No property matches that.</strong>
        </div>
        <template v-else>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Stand</th><th scope="col">Ward</th><th scope="col">Category</th>
                  <th scope="col" class="num">Rateable value</th><th scope="col" class="ccy">Ccy</th>
                  <th scope="col">In force from</th><th scope="col">Source</th><th scope="col">Rates account</th>
                  <th scope="col"><span class="rates-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in properties" :key="p.parcel_id">
                  <td>{{ p.stand_no ?? '—' }} <span class="rates-sub">{{ p.parcel_id }}</span></td>
                  <td>{{ p.ward_code ?? '—' }}</td>
                  <td>{{ p.category_code ?? '—' }}</td>
                  <td class="num">
                    <template v-if="p.has_rateable_value">{{ formatMoney(p.rateable_value, null) }}</template>
                    <span v-else class="undefined-value">not valued</span>
                  </td>
                  <td class="ccy">{{ p.currency ?? '' }}</td>
                  <td>{{ formatDate(p.effective_from) }}</td>
                  <td>{{ p.source ?? '—' }}</td>
                  <td>
                    <template v-if="p.has_rates_account"><span class="ins-mono">{{ p.account_no }}</span> {{ p.party_name }}</template>
                    <span v-else class="undefined-value">no ratepayer of record</span>
                  </td>
                  <td class="rates-acts">
                    <button v-if="canValue && !p.has_rateable_value" type="button" class="fin-btn small" @click="valueProperty(p)">
                      Record a value
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="rates-pager">
            <span class="rates-sub">
              {{ rollOffset + 1 }}–{{ rollOffset + properties.length }} of {{ propertiesTotal }} current properties
            </span>
            <button type="button" class="fin-btn small" :disabled="rollOffset === 0" @click="pageRoll(-1)">Previous</button>
            <button type="button" class="fin-btn small" :disabled="rollOffset + properties.length >= propertiesTotal"
                    @click="pageRoll(1)">Next</button>
          </div>
        </template>
      </div>
    </section>

    <!-- ══ 6. Tariffs ═══════════════════════════════════════════════════════════════════════ -->
    <section v-else id="rates-panel-tariffs" class="ins-card" role="tabpanel" aria-labelledby="rates-tab-tariffs">
      <div class="ins-card-body">
        <div v-if="!yearId" class="fin-empty">
          <strong>No financial year is selected.</strong>
          <p>A rate in the dollar is resolved per year. Choose a reporting period above.</p>
        </div>
        <template v-else>
          <div class="fin-bar">
            <button v-if="canDraftTariff" type="button" class="fin-btn primary" @click="showTariffForm = !showTariffForm">
              <component :is="showTariffForm ? X : Plus" :size="14" aria-hidden="true" />
              {{ showTariffForm ? 'Close' : 'Draft a tariff' }}
            </button>
            <button type="button" class="fin-btn small" :disabled="tariffsLoading" @click="loadTariffs">
              <RefreshCw :size="13" aria-hidden="true" /> Refresh
            </button>
          </div>

          <form v-if="showTariffForm" class="rates-form" @submit.prevent="draftTariff">
            <div class="ins-form">
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-cat">Property category</label>
                <select id="rates-tf-cat" v-model="tariffForm.property_category_id" class="ins-input" required>
                  <option value="" disabled>Choose…</option>
                  <option v-for="c in activeCategories" :key="c.id" :value="c.id">{{ c.code }} — {{ c.name }}</option>
                </select>
                <p v-if="activeCategories.length === 0" class="ins-hint">Categories are added under Valuation roll.</p>
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-ccy">Book</label>
                <select id="rates-tf-ccy" v-model="tariffForm.currency" class="ins-input">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-rate">Rate in the dollar</label>
                <input id="rates-tf-rate" v-model="tariffForm.rate_in_dollar" class="ins-input" inputmode="decimal"
                       pattern="\d+(\.\d{1,8})?" placeholder="0.0085" required />
                <p class="ins-hint">
                  Up to eight decimal places, and never rounded: a cent and a half in the dollar is
                  0.015, and 0.02 would bill a third more than was resolved.
                </p>
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-fixed">Fixed charge <span class="rates-sub">(optional)</span></label>
                <input id="rates-tf-fixed" v-model="tariffForm.fixed_charge" class="ins-input" inputmode="decimal"
                       pattern="\d+(\.\d{1,2})?" />
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-min">Minimum charge <span class="rates-sub">(optional)</span></label>
                <input id="rates-tf-min" v-model="tariffForm.minimum_charge" class="ins-input" inputmode="decimal"
                       pattern="\d+(\.\d{1,2})?" />
                <p class="ins-hint">Left empty means the Council set none, which is not the same as nil.</p>
              </div>
              <div class="ins-field">
                <label class="ins-label" for="rates-tf-rev">Revenue account <span class="rates-sub">(optional)</span></label>
                <select id="rates-tf-rev" v-model="tariffForm.revenue_ledger_account_id" class="ins-input">
                  <option value="">The billing run's own revenue account</option>
                  <option v-for="a in revenueAccounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
                </select>
              </div>
            </div>
            <div class="ins-actions">
              <button type="button" class="fin-btn" @click="showTariffForm = false">Cancel</button>
              <button type="submit" class="fin-btn primary" :disabled="!tariffFormComplete || busy === 'tariff'">
                {{ busy === 'tariff' ? 'Saving…' : 'Save as a draft' }}
              </button>
              <span class="rates-sub">A draft bills nothing until somebody else records the resolution.</span>
            </div>
          </form>

          <p v-if="tariffsLoading" class="rates-loading" role="status">Reading the tariff schedule…</p>
          <div v-else-if="tariffs.length === 0" class="fin-empty">
            <strong>No tariff is recorded for {{ store.selectedYear?.label }}.</strong>
            <p v-if="tariffsNote">{{ tariffsNote }}</p>
          </div>
          <div v-else class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Category</th><th scope="col" class="ccy">Ccy</th>
                  <th scope="col" class="num">Rate in the dollar</th><th scope="col" class="num">Fixed</th>
                  <th scope="col" class="num">Minimum</th><th scope="col">Status</th>
                  <th scope="col">Resolution</th><th scope="col">Drafted by</th><th scope="col">Approved by</th>
                  <th scope="col"><span class="rates-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="t in tariffs" :key="t.id">
                  <tr>
                    <td><span class="ins-mono">{{ t.category_code }}</span> {{ t.category_name }}</td>
                    <td class="ccy">{{ t.currency }}</td>
                    <td class="num emphasis">{{ rateText(t.rate_in_dollar) }}</td>
                    <td class="num">
                      <template v-if="t.fixed_charge !== null">{{ formatMoney(t.fixed_charge, null) }}</template>
                      <span v-else class="undefined-value">none set</span>
                    </td>
                    <td class="num">
                      <template v-if="t.minimum_charge !== null">{{ formatMoney(t.minimum_charge, null) }}</template>
                      <span v-else class="undefined-value">none set</span>
                    </td>
                    <td><span class="fin-pill" :class="statusTone(t.status)">{{ t.status }}</span></td>
                    <td>{{ t.resolution_reference ?? '—' }}</td>
                    <td>{{ t.created_by_name ?? '—' }}</td>
                    <td>
                      {{ t.approved_by_name ?? '—' }}
                      <span v-if="t.approved_at" class="rates-sub">{{ formatDateTime(t.approved_at) }}</span>
                    </td>
                    <td class="rates-acts">
                      <template v-if="t.status === 'draft'">
                        <button v-if="canApproveTariff && !isOwnTariff(t)" type="button" class="fin-btn small primary"
                                :disabled="busy === t.id" @click="approveTariff(t)">Approve</button>
                        <button v-if="canDraftTariff" type="button" class="fin-btn small danger"
                                :disabled="busy === t.id" @click="discardTariff(t)">Discard</button>
                      </template>
                      <button v-else-if="t.status === 'approved' && canApproveTariff" type="button" class="fin-btn small"
                              :disabled="busy === t.id" @click="supersedeTariff(t)">Supersede</button>
                    </td>
                  </tr>
                  <tr v-if="t.status === 'draft' && canApproveTariff && isOwnTariff(t)" class="rates-explain">
                    <td colspan="10">
                      You drafted this tariff, so approving it is not yours to do. Approval records a
                      Council resolution and must come from someone else.
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p v-if="!canApproveTariff && tariffs.some((t) => t.status === 'draft')" class="rates-absent">
            <Info :size="14" aria-hidden="true" />
            <span>{{ store.whyUnavailable('finance.rates.tariff.approve') }}</span>
          </p>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Own `rates-` prefix throughout. `finance.css` already gives `.fin-map` and `.ins-bar` a layout
   that has nothing to do with their names, so a container named for what it looks like would
   inherit someone else's. Nothing here is a colour literal: every value is an --ent-* token. */
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); min-width: 0; }
.fin-section > * { min-width: 0; max-width: 100%; }
.rates-detail .fin-table { display: block; overflow-x: auto; }

.rates-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.rates-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.rates-subhead {
  margin: var(--ent-s4) 0 var(--ent-s2);
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.rates-subhead:first-child { margin-top: 0; }
.rates-money { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }
.rates-off { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.rates-zero td { color: var(--ent-text-3); }
.rates-narrow { max-width: 16rem; }
.rates-amount { max-width: 9rem; text-align: right; font-family: var(--ent-font-mono); }

/* The hidden header label is absolutely positioned, and an absolute box with no positioned
   ancestor escapes its scrolling table: at phone width it sat 447px past the viewport and gave the
   whole page a horizontal scrollbar. Anchoring it to its own header cell keeps it inside. */
.fin-table th:has(> .rates-visually-hidden) { position: relative; }
.rates-visually-hidden {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

.rates-caption, .rates-absent {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.rates-absent {
  padding: var(--ent-s2) var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong); background: var(--ent-surface-2);
}
.rates-caption :deep(svg), .rates-absent :deep(svg) { flex: none; margin-top: 2px; }

/* ── Readiness: a ruled list at body weight, not a row of metric cards ───────────────────── */
.rates-blockers { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.rates-blocker {
  display: flex; align-items: flex-start; gap: var(--ent-s3); flex-wrap: wrap;
  padding: var(--ent-s3) 0; border-bottom: 1px solid var(--ent-line);
}
.rates-blocker:first-child { padding-top: 0; }
.rates-blocker:last-child { border-bottom: 0; padding-bottom: 0; }
.rates-blocker-mark { flex: none; margin-top: 2px; color: var(--ent-text-3); }
.rates-blocker.is-met .rates-blocker-mark { color: var(--ent-success); }
.rates-blocker-id {
  flex: none; min-width: 2.25rem; font-family: var(--ent-font-mono);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.rates-blocker > .fin-pill { flex: none; }
.rates-blocker-text { flex: 1 1 12rem; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--ent-fs-sm); }
.rates-blocker-text strong { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.rates-blocker-text span { color: var(--ent-text-2); font-size: var(--ent-fs-xs); }

/* ── The surface chooser: labelled tabs with their one-line purpose ──────────────────────── */
.rates-tabs { display: flex; flex-wrap: wrap; gap: var(--ent-s2); }
.rates-tab {
  flex: 1 1 10rem; text-align: left; cursor: pointer; font: inherit;
  padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line); border-bottom-width: 2px;
  background: var(--ent-surface); color: var(--ent-text-2);
  display: flex; flex-direction: column; gap: 2px;
}
.rates-tab:hover { background: var(--ent-surface-2); }
.rates-tab.is-current { border-bottom-color: var(--ent-accent); background: var(--ent-surface-2); color: var(--ent-text); }
.rates-tab:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.rates-tab-label { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.rates-tab-hint { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

/* ── Forms ───────────────────────────────────────────────────────────────────────────────── */
.rates-form {
  margin: var(--ent-s3) 0; padding: var(--ent-s3);
  border: 1px solid var(--ent-line); background: var(--ent-surface-2);
  display: flex; flex-direction: column; gap: var(--ent-s3);
}
.rates-form:first-child { margin-top: 0; }
.rates-inline { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.rates-inline > .ins-input { flex: 1 1 12rem; min-width: 8rem; }
.rates-inline > .ins-input.rates-narrow { flex: 0 1 12rem; }
.rates-newparty { padding-top: var(--ent-s2); border-top: 1px solid var(--ent-line); }
.rates-picks { margin: var(--ent-s2) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.rates-pick { display: flex; align-items: baseline; gap: var(--ent-s2); font-size: var(--ent-fs-sm); cursor: pointer; }
.rates-pick.is-taken { color: var(--ent-text-3); cursor: default; }
.rates-allocate { display: flex; flex-direction: column; gap: var(--ent-s2); }
.rates-alloc-cell { display: flex; align-items: center; gap: var(--ent-s2); }

/* ── Preview facts and per-currency totals: definition lists, at body weight ─────────────── */
.rates-preview { display: flex; flex-direction: column; gap: var(--ent-s3); margin-bottom: var(--ent-s4); }
.rates-facts {
  margin: 0; display: grid; gap: var(--ent-s2) var(--ent-s4);
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}
.rates-facts dt { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.rates-facts dd { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.rates-totals {
  margin: var(--ent-s3) 0; padding: 0; list-style: none;
  display: flex; flex-wrap: wrap; gap: var(--ent-s2) var(--ent-s4);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.rates-totals li { display: flex; align-items: baseline; gap: var(--ent-s2); }
.rates-totals strong { color: var(--ent-text); font-weight: var(--ent-fw-semibold); }
.rates-chips { margin: 0 0 var(--ent-s2); padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: var(--ent-s2); }

/* ── Tables ──────────────────────────────────────────────────────────────────────────────── */
.rates-table-caption {
  caption-side: top; text-align: left; padding: 0 0 var(--ent-s2);
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
}
.rates-acts { white-space: nowrap; text-align: right; }
.rates-acts > * + * { margin-left: 4px; }
.rates-explain td {
  padding-top: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
  background: var(--ent-surface-2);
}
.rates-detail > td { background: var(--ent-surface-2); padding: var(--ent-s3); }
.rates-detail .fin-table { margin-top: var(--ent-s2); background: var(--ent-surface); }
.rates-pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--ent-s2); margin-top: var(--ent-s2); }
.rates-book + .rates-book { margin-top: var(--ent-s3); }
</style>
