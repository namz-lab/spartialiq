<script setup lang="ts">
/**
 * The cashier's counter.
 *
 * ONE STATE ON SCREEN AT A TIME, because a counter has a queue in front of it:
 *   no session     open the till — or, if every drawer is held, who holds each and whom to ask
 *   session open   take a payment, with the day's receipts beside it — suspend, or cash up
 *   suspended      the drawer is still yours; resume to take payments or count it
 *   abandoned      a supervisor found the session left; it is counted under supervision
 *   count declared read-only, waiting on somebody else
 *
 * A session from an earlier business day takes no payments (the server refuses them): the screen
 * says so and offers only the cash-up.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *  - No running total of the day's takings. The server does not send it to the session's own
 *    cashier while the till is open (`totals_withheld`): the drawer is counted first and compared
 *    after. The receipts are listed, because the cashier issued them.
 *  - No receipt number field and no date field. Both are issued by the server.
 *  - No "edit receipt". A receipt is cancelled with a reason and issued again.
 *
 * The total shown while lines are keyed is a preview in exact integer arithmetic
 * (`cashMath.ts`); the figure on the receipt is the one the database computed.
 */
import { computed, nextTick, reactive, ref, watch, type Component } from 'vue'
import {
  AlertTriangle, Banknote, Check, CreditCard, FileText, Landmark, Lock, Pause, Play,
  Plus, Printer, Search, ShieldAlert, Smartphone, Trash2, UserRound, X,
} from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { cashApi } from '../../api/cashApi'
import { ratesApi } from '../../api/ratesApi'
import { formatMoney, formatDate, formatDateTime, type Currency } from '../../composables/useMoney'
import { centsToText, lineCents, toCents } from '../../composables/cashMath'
import {
  CASH_METHODS, chargeIn, receiptableIn,
  type CashDesk, type CashMethod, type CashReceipt, type CashierSessionDetail,
} from '../../models/cashTypes'
import type { RatesAccount, RatesBill } from '../../models/ratesTypes'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinancePromptDialog from '../FinancePromptDialog.vue'
import CashSessionReceipts from './CashSessionReceipts.vue'

const props = defineProps<{ desk: CashDesk }>()
const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'print', receiptId: string): void
}>()

const store = useFinanceStore()
const prompt = useFinancePrompt()

const session = computed<CashierSessionDetail | null>(() => props.desk.my_session)
const canOperate = computed(() => store.can('finance.cash.session.operate'))
const canReceipt = computed(() => store.can('finance.cash.receipt.record'))
const canCancel = computed(() => store.can('finance.cash.receipt.cancel'))
const canRates = computed(() => canReceipt.value && store.can('finance.rates.receipt.record'))

const busy = ref(false)
const error = ref<string | null>(null)
const CURRENCIES: Currency[] = ['USD', 'ZWG']

// ── Opening the till ──────────────────────────────────────────────────────────────────────────

/** Policy the Council has not decided (D29). Until it does, an unassigned point may be opened. */
const assignmentRequired = computed(() => props.desk.policy?.require_assignment.value === true)

/** Free drawers this cashier may open: assigned ones first, and only those when assignment is required. */
const freePoints = computed(() => props.desk.cash_points
  .filter((p) => p.status === 'active' && !p.open_session_id && (!assignmentRequired.value || p.assigned_to_me))
  .sort((a, b) => Number(Boolean(b.assigned_to_me)) - Number(Boolean(a.assigned_to_me)) || a.code.localeCompare(b.code)))

/** Drawers held by somebody: named, so the cashier knows whom to ask rather than guessing. */
const heldPoints = computed(() => props.desk.cash_points.filter((p) => p.status === 'active' && p.open_session_id))
const HELD_STATE: Record<string, string> = { open: 'open', suspended: 'suspended', abandoned: 'found abandoned, waiting for a supervised count' }
function heldLine(p: (typeof heldPoints.value)[number]): string {
  const since = p.held_since ? ` since ${formatDateTime(p.held_since)}` : ''
  const stale = p.held_stale ? ' — from an earlier business day' : ''
  return `${p.name} is held by ${p.held_by_name ?? 'another cashier'} (${HELD_STATE[p.held_state ?? 'open'] ?? p.held_state}${since})${stale}.`
}
const opening = reactive({ cash_point_id: '', financial_year_id: '', float_usd: '', float_zwg: '' })
watch(freePoints, (points) => {
  if (!points.some((p) => p.id === opening.cash_point_id)) opening.cash_point_id = points[0]?.id ?? ''
}, { immediate: true })
watch(() => props.desk.financial_years, (years) => {
  if (!years.some((y) => y.id === opening.financial_year_id)) opening.financial_year_id = years.length === 1 ? years[0].id : ''
}, { immediate: true })

/** Why a till cannot be opened right now, as a sentence — or null when it can. */
const blocker = computed<string | null>(() => {
  const r = props.desk.readiness
  if (r.cash_points === 0) {
    return 'No cash point has been set up. The counters, and the ledger account each one keeps its takings in, are entered by the accountant or the Director of Finance (Council decision D22).'
  }
  if (!r.year_open_today) return 'No open financial year contains today, so takings could not be dated. The Director of Finance opens the year.'
  if (!r.period_open_today) return 'The accounting period that contains today is not open, so today\'s takings could never be posted. The accountant opens the period.'
  if (freePoints.value.length === 0) {
    const someFree = props.desk.cash_points.some((p) => p.status === 'active' && !p.open_session_id)
    if (assignmentRequired.value && someFree) {
      return 'None of the free cash points is assigned to you. A cash supervisor assigns cashiers to drawers.'
    }
    return 'Every cash point is held by another cashier. One drawer has one cashier at a time, and a drawer is freed only when it is counted. If a drawer has been left, a cash supervisor can find the session abandoned and count it with a witness.'
  }
  return null
})

const floatValid = (text: string) => text.trim() === '' || toCents(text) !== null

async function openTill(): Promise<void> {
  if (!opening.cash_point_id || busy.value) return
  if (!floatValid(opening.float_usd) || !floatValid(opening.float_zwg)) {
    error.value = 'A float is an amount such as 50.00, or left blank for none.'
    return
  }
  busy.value = true
  error.value = null
  try {
    const floats = [
      ...(opening.float_usd.trim() ? [{ currency: 'USD' as Currency, amount: opening.float_usd.trim() }] : []),
      ...(opening.float_zwg.trim() ? [{ currency: 'ZWG' as Currency, amount: opening.float_zwg.trim() }] : []),
    ]
    await cashApi.openSession({
      cash_point_id: opening.cash_point_id,
      ...(opening.financial_year_id ? { financial_year_id: opening.financial_year_id } : {}),
      floats,
    })
    opening.float_usd = ''
    opening.float_zwg = ''
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The till could not be opened.')
  } finally {
    busy.value = false
  }
}

// ── Taking a payment ──────────────────────────────────────────────────────────────────────────

type Kind = 'sundry' | 'rates'
interface DraftLine { key: number; income_code_id: string; quantity: string; unit_amount: string }

let lineSeq = 0
const newLine = (): DraftLine => ({ key: ++lineSeq, income_code_id: '', quantity: '1', unit_amount: '' })

const kind = ref<Kind>('sundry')
const currency = ref<Currency>('USD')
const method = ref<CashMethod>('cash')
const payer = ref('')
const reference = ref('')
const depositAccount = ref('')
const lines = ref<DraftLine[]>([newLine()])
const payerEl = ref<HTMLInputElement | null>(null)

const codesForCurrency = computed(() => props.desk.income_codes.filter((c) => receiptableIn(c, currency.value)))
const codeById = computed(() => new Map(props.desk.income_codes.map((c) => [c.id, c])))
const isPhysical = computed(() => CASH_METHODS.find((m) => m.value === method.value)?.physical ?? true)

/** One glyph per tender, as the mockup's method tiles carry. */
const METHOD_ICONS: Record<CashMethod, Component> = {
  cash: Banknote, mobile_money: Smartphone, card: CreditCard, bank_transfer: Landmark, cheque: FileText,
}

/** The unit amount a line will be charged: the Council's, where it is fixed. */
function unitOf(line: DraftLine): string {
  const code = codeById.value.get(line.income_code_id)
  if (code?.pricing === 'fixed') return chargeIn(code, currency.value) ?? ''
  return line.unit_amount
}
function isFixed(line: DraftLine): boolean {
  return codeById.value.get(line.income_code_id)?.pricing === 'fixed'
}
function lineTotal(line: DraftLine): bigint | null {
  if (!line.income_code_id) return null
  return lineCents(line.quantity, unitOf(line))
}

// A code that cannot be charged in the newly chosen currency is cleared, not silently kept.
watch(currency, () => {
  for (const line of lines.value) {
    const code = codeById.value.get(line.income_code_id)
    if (code && !receiptableIn(code, currency.value)) line.income_code_id = ''
  }
  selectedBills.value = new Set()
  if (ratesAccount.value) void loadBills(ratesAccount.value)
})
watch(() => props.desk.bank_accounts, (banks) => {
  if (!banks.some((b) => b.id === depositAccount.value)) depositAccount.value = banks.length === 1 ? banks[0].id : ''
}, { immediate: true })

// Rates: find the ratepayer, tick the bills being paid.
const ratesQuery = ref('')
const ratesResults = ref<RatesAccount[]>([])
const ratesSearching = ref(false)
const ratesSearched = ref(false)
const ratesAccount = ref<RatesAccount | null>(null)
const bills = ref<RatesBill[]>([])
const selectedBills = ref<Set<string>>(new Set())
const ratesAmount = ref('')

async function searchRates(): Promise<void> {
  const q = ratesQuery.value.trim()
  if (q.length < 2) return
  ratesSearching.value = true
  error.value = null
  try {
    const page = await ratesApi.accounts({ q, status: 'active', limit: 8 })
    ratesResults.value = page.accounts
    ratesSearched.value = true
  } catch (err) {
    error.value = messageOf(err, 'The rates accounts could not be searched.')
  } finally {
    ratesSearching.value = false
  }
}

async function loadBills(account: RatesAccount): Promise<void> {
  try {
    const page = await ratesApi.bills({
      rates_account_id: account.id, currency: currency.value, status: 'posted', limit: 100,
    })
    bills.value = page.bills.filter((b) => (toCents(b.open_amount) ?? 0n) > 0n)
  } catch (err) {
    bills.value = []
    error.value = messageOf(err, 'This ratepayer\'s bills could not be read.')
  }
}

async function chooseRatesAccount(account: RatesAccount): Promise<void> {
  ratesAccount.value = account
  ratesResults.value = []
  selectedBills.value = new Set()
  ratesAmount.value = ''
  await loadBills(account)
}

function toggleBill(bill: RatesBill): void {
  const next = new Set(selectedBills.value)
  if (next.has(bill.id)) next.delete(bill.id)
  else next.add(bill.id)
  selectedBills.value = next
  // The amount follows the ticked bills until the cashier types a different one (a part payment).
  const sum = bills.value.filter((b) => next.has(b.id)).reduce((t, b) => t + (toCents(b.open_amount) ?? 0n), 0n)
  ratesAmount.value = sum > 0n ? centsToText(sum) : ''
}

/**
 * How a rates payment is spread over the ticked bills: oldest first, each up to what it has open,
 * and whatever is left stays on the ratepayer's account as a credit — which the server records as
 * the unallocated remainder. Integer cents throughout.
 */
function allocationsFor(amountCents: bigint): { rates_bill_id: string; amount: string }[] {
  let left = amountCents
  const out: { rates_bill_id: string; amount: string }[] = []
  const ticked = bills.value.filter((b) => selectedBills.value.has(b.id))
    .sort((a, b) => a.period_from.localeCompare(b.period_from))
  for (const bill of ticked) {
    if (left <= 0n) break
    const open = toCents(bill.open_amount) ?? 0n
    const part = open < left ? open : left
    if (part > 0n) out.push({ rates_bill_id: bill.id, amount: centsToText(part) })
    left -= part
  }
  return out
}

const previewCents = computed<bigint | null>(() => {
  if (kind.value === 'rates') return toCents(ratesAmount.value)
  let total = 0n
  for (const line of lines.value) {
    const amount = lineTotal(line)
    if (amount === null) return null
    total += amount
  }
  return total
})

/** How many things are in the basket — what the settlement panel counts off. */
const itemCount = computed(() => (kind.value === 'rates'
  ? selectedBills.value.size
  : lines.value.filter((l) => l.income_code_id).length))
const itemWord = computed(() => `${itemCount.value} item${itemCount.value === 1 ? '' : 's'}`)

const problem = computed<string | null>(() => {
  if (!isPhysical.value) {
    if (!depositAccount.value) return 'Choose the bank or wallet account this payment was made into.'
    if (reference.value.trim().length < 3) return 'Enter the transaction reference from the bank, card machine or wallet.'
  }
  if (kind.value === 'rates') {
    if (!ratesAccount.value) return 'Find the ratepayer first.'
    if (!previewCents.value) return 'Enter the amount received.'
    return null
  }
  if (payer.value.trim().length < 2) return 'Enter who is paying.'
  if (lines.value.some((l) => !l.income_code_id)) return 'Choose what each line is for.'
  if (!previewCents.value) return 'Enter an amount for each line.'
  return null
})

const issued = ref<CashReceipt | null>(null)
const attempted = ref(false)

function resetPayment(): void {
  payer.value = ''
  reference.value = ''
  lines.value = [newLine()]
  ratesAccount.value = null
  ratesQuery.value = ''
  ratesResults.value = []
  ratesSearched.value = false
  bills.value = []
  selectedBills.value = new Set()
  ratesAmount.value = ''
  attempted.value = false
}

async function issue(): Promise<void> {
  attempted.value = true
  if (problem.value || !session.value || busy.value) return
  busy.value = true
  error.value = null
  const common = {
    session_id: session.value.id, currency: currency.value, method: method.value,
    ...(isPhysical.value ? {} : { deposit_account_id: depositAccount.value }),
    ...(reference.value.trim() ? { method_reference: reference.value.trim() } : {}),
  }
  try {
    const result = kind.value === 'rates'
      ? await cashApi.issueRatesReceipt({
        ...common, rates_account_id: ratesAccount.value!.id, amount: ratesAmount.value.trim(),
        allocations: allocationsFor(previewCents.value ?? 0n),
      })
      : await cashApi.issueReceipt({
        ...common, payer_name: payer.value.trim(),
        lines: lines.value.map((l) => ({
          income_code_id: l.income_code_id,
          ...(l.quantity.trim() && l.quantity.trim() !== '1' ? { quantity: l.quantity.trim() } : {}),
          ...(isFixed(l) ? {} : { unit_amount: l.unit_amount.trim() }),
        })),
      })
    issued.value = result.receipt
    resetPayment()
    emit('changed')
    await nextTick()
    payerEl.value?.focus()
  } catch (err) {
    error.value = messageOf(err, 'The receipt could not be issued.')
  } finally {
    busy.value = false
  }
}

async function cancelReceipt(receipt: CashReceipt): Promise<void> {
  const reason = await prompt.ask({
    title: `Cancel receipt ${receipt.receipt_no}`,
    message: `${formatMoney(receipt.amount, receipt.currency)} from ${receipt.payer_name}. The receipt stays on the record as cancelled, with your reason, and its number is not used again.`,
    label: 'Why is it being cancelled?', kind: 'textarea', minLength: 5, submitLabel: 'Cancel receipt', danger: true,
  })
  if (!reason) return
  busy.value = true
  error.value = null
  try {
    await cashApi.cancelReceipt(receipt.id, reason)
    if (issued.value?.id === receipt.id) issued.value = null
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The receipt could not be cancelled.')
  } finally {
    busy.value = false
  }
}

// ── Cashing up ────────────────────────────────────────────────────────────────────────────────

const cashingUp = ref(false)
const counted = reactive<Record<Currency, { total: string; explanation: string }>>({
  USD: { total: '', explanation: '' }, ZWG: { total: '', explanation: '' },
})
/** Set once the server has refused a count for an unexplained difference. */
const needsExplanation = ref(false)

function startCashUp(): void {
  cashingUp.value = true
  needsExplanation.value = false
  error.value = null
  for (const c of CURRENCIES) { counted[c].total = ''; counted[c].explanation = '' }
}

async function declareCount(): Promise<void> {
  if (!session.value || busy.value) return
  const counts = CURRENCIES.filter((c) => counted[c].total.trim() !== '').map((c) => ({
    currency: c, declared_total: counted[c].total.trim(),
    ...(counted[c].explanation.trim() ? { explanation: counted[c].explanation.trim() } : {}),
  }))
  if (counts.some((c) => toCents(c.declared_total) === null)) {
    error.value = 'A count is an amount such as 412.50.'
    return
  }
  busy.value = true
  error.value = null
  try {
    await cashApi.closeSession(session.value.id, counts)
    cashingUp.value = false
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The count could not be declared.')
    if (/explained in writing|count has not been declared/.test(error.value)) needsExplanation.value = true
  } finally {
    busy.value = false
  }
}

/** A session from an earlier day: the server takes no more payments in it, so it is only counted. */
const isStale = computed(() => Boolean(session.value && session.value.business_date < props.desk.today))

async function suspendTill(): Promise<void> {
  // Reversible by the same cashier and moves no money, so it needs no confirmation.
  if (!session.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await cashApi.suspendSession(session.value.id)
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The session could not be suspended.')
  } finally {
    busy.value = false
  }
}

async function resumeTill(): Promise<void> {
  if (!session.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await cashApi.resumeSession(session.value.id)
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, 'The session could not be resumed.')
  } finally {
    busy.value = false
  }
}

const liveReceipts = computed(() => session.value?.receipts ?? [])
const varianceTone = (variance: string | null) => {
  const cents = variance === null ? null : toCents(variance.replace('-', ''))
  if (cents === null || cents === 0n) return ''
  return variance!.startsWith('-') ? 'is-short' : 'is-over'
}
</script>

<template>
  <div class="cash-counter">
    <p v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <!-- ── No session ───────────────────────────────────────────────────────────────────────── -->
    <template v-if="!session">
      <div v-if="!canOperate" class="fin-empty" role="status">
        <strong>You do not operate a till.</strong>
        <p>Opening a session and issuing receipts is the cashier's work. The cash-ups, the banking and the till positions are on the other tabs.</p>
      </div>
      <div v-else-if="blocker" class="fin-empty" role="status">
        <strong>A till cannot be opened yet.</strong>
        <p>{{ blocker }}</p>
        <ul v-if="heldPoints.length && freePoints.length === 0" class="cash-held">
          <li v-for="p in heldPoints" :key="p.id">{{ heldLine(p) }}</li>
        </ul>
      </div>
      <form v-else class="ins-card cash-open" @submit.prevent="openTill">
        <div class="ins-card-head">
          <h3><Banknote :size="16" aria-hidden="true" /> Open your till</h3>
          <span class="fin-pill">Not open</span>
        </div>
        <div class="ins-card-body cash-open-body">
          <p class="cash-lede cash-open-lede">
            Today is <strong>{{ formatDate(desk.today) }}</strong>. Everything you receipt in this session is dated today
            and is counted, verified and banked together.
          </p>
          <div class="cash-open-grid">
            <div class="cash-open-main">
              <label class="ins-field">
                <span class="ins-label">Cash point</span>
                <select v-model="opening.cash_point_id" class="ins-input" required>
                  <option v-for="p in freePoints" :key="p.id" :value="p.id">{{ p.name }}<template v-if="p.location"> — {{ p.location }}</template><template v-if="p.assigned_to_me"> (assigned to you)</template></option>
                </select>
                <span v-if="heldPoints.length" class="ins-hint">
                  Not listed, because another cashier holds them: {{ heldPoints.map((p) => `${p.name} (${p.held_by_name})`).join(', ') }}.
                </span>
              </label>
              <label v-if="desk.financial_years.length > 1" class="ins-field">
                <span class="ins-label">Financial year</span>
                <select v-model="opening.financial_year_id" class="ins-input" required>
                  <option value="" disabled>Choose the year these takings belong to</option>
                  <option v-for="y in desk.financial_years" :key="y.id" :value="y.id">{{ y.label }}</option>
                </select>
                <span class="ins-hint">More than one open year contains today, so it is not chosen for you.</span>
              </label>
            </div>
            <fieldset class="cash-floats">
              <legend class="ins-label">Float in the drawer</legend>
              <label class="ins-field">
                <span class="ins-hint">US$</span>
                <input v-model="opening.float_usd" class="ins-input cash-num" inputmode="decimal" placeholder="0.00" autocomplete="off" />
              </label>
              <label class="ins-field">
                <span class="ins-hint">ZWG</span>
                <input v-model="opening.float_zwg" class="ins-input cash-num" inputmode="decimal" placeholder="0.00" autocomplete="off" />
              </label>
              <p class="ins-hint cash-floats-note">The change you start with. It is taken off your count at cash-up, so it is never mistaken for takings.</p>
            </fieldset>
          </div>
        </div>
        <div class="ins-card-foot">
          <span class="cash-foot-note">The drawer is counted before any takings are shown.</span>
          <button type="submit" class="fin-btn primary" :disabled="busy || !opening.cash_point_id || (desk.financial_years.length > 1 && !opening.financial_year_id)">
            {{ busy ? 'Opening…' : 'Open till' }}
          </button>
        </div>
      </form>
    </template>

    <!-- ── Count declared: waiting on somebody else ─────────────────────────────────────────── -->
    <template v-else-if="session.status === 'closed'">
      <section class="ins-card cash-closed">
        <div class="cash-status-band">
          <span class="cash-status-mark" aria-hidden="true"><Lock :size="18" /></span>
          <div class="cash-status-main">
            <span class="cash-status-eyebrow">{{ session.session_no }}</span>
            <h3>{{ session.cash_point_name }} · count declared</h3>
            <span class="cash-status-meta">
              {{ formatDate(session.business_date) }} · {{ session.receipt_count }} receipt{{ session.receipt_count === 1 ? '' : 's' }}
            </span>
          </div>
          <span class="fin-pill tone-warning">Awaiting verification</span>
        </div>
        <div class="cash-closed-body">
          <p v-if="session.closed_by" class="cash-lede">
            Your drawer at <strong>{{ session.cash_point_name }}</strong> was counted under supervision by {{ session.closed_by_name }},
            witnessed by {{ session.witness_name }}, after the session was found abandoned. Somebody who took no part in the count now agrees it.
          </p>
          <p v-else class="cash-lede">
            You declared the count for <strong>{{ session.cash_point_name }}</strong> on {{ formatDate(session.business_date) }}.
            Somebody else now agrees it. Until they do, none of these receipts is in the book of account and the takings cannot be banked.
          </p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <caption>Your count against the receipts, per currency. Currencies are never added together.</caption>
              <thead><tr>
                <th scope="col">Currency</th><th scope="col" class="num">Float</th><th scope="col" class="num">Receipts in the drawer</th>
                <th scope="col" class="num">You counted</th><th scope="col" class="num">Difference</th><th scope="col">Explanation</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in session.counts.filter((x) => x.declared_total !== null)" :key="c.currency">
                  <td class="ccy">{{ c.currency }}</td>
                  <td class="num">{{ formatMoney(c.opening_float, c.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(c.expected_takings, c.currency, { bare: true }) }}</td>
                  <td class="num emphasis">{{ formatMoney(c.declared_total, c.currency, { bare: true }) }}</td>
                  <td class="num" :class="varianceTone(c.variance)">{{ formatMoney(c.variance, c.currency, { bare: true }) }}</td>
                  <td>{{ c.explanation || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </template>

    <!-- ── Suspended: the drawer is still this cashier's ────────────────────────────────────── -->
    <template v-else-if="session.status === 'suspended'">
      <section class="ins-card cash-closed">
        <div class="cash-status-band">
          <span class="cash-status-mark" aria-hidden="true"><Pause :size="18" /></span>
          <div class="cash-status-main">
            <span class="cash-status-eyebrow">{{ session.session_no }}</span>
            <h3>{{ session.cash_point_name }} · suspended</h3>
            <span class="cash-status-meta">
              Suspended {{ formatDateTime(session.suspended_at) }} · {{ session.receipt_count }} receipt{{ session.receipt_count === 1 ? '' : 's' }}
            </span>
          </div>
          <span class="fin-pill">Suspended</span>
        </div>
        <div class="cash-closed-body">
          <p class="cash-lede">
            The drawer is still yours: nobody else can open it, and it takes no payments until you resume.
            To finish for the day, resume and cash up.
          </p>
          <div class="cash-suspended-acts">
            <button type="button" class="fin-btn primary" :disabled="busy" @click="resumeTill"><Play :size="14" aria-hidden="true" /> {{ busy ? 'Resuming…' : 'Resume' }}</button>
          </div>
        </div>
      </section>
    </template>

    <!-- ── Abandoned: a supervisor's finding; counted under supervision, not by the cashier ─── -->
    <template v-else-if="session.status === 'abandoned'">
      <section class="ins-card cash-closed">
        <div class="cash-status-band">
          <span class="cash-status-mark is-alert" aria-hidden="true"><ShieldAlert :size="18" /></span>
          <div class="cash-status-main">
            <span class="cash-status-eyebrow">{{ session.session_no }}</span>
            <h3>{{ session.cash_point_name }} · found abandoned</h3>
            <span class="cash-status-meta">{{ formatDate(session.business_date) }} · {{ session.receipt_count }} receipt{{ session.receipt_count === 1 ? '' : 's' }}</span>
          </div>
          <span class="fin-pill tone-negative">Abandoned</span>
        </div>
        <div class="cash-closed-body">
          <p class="cash-lede">
            Your session was found abandoned by <strong>{{ session.abandoned_by_name }}</strong> on {{ formatDateTime(session.abandoned_at) }}:
            “{{ session.abandon_reason }}”. It takes no payments. A cash supervisor will count the drawer with a witness,
            and somebody else verifies that count. It remains your session in every report.
          </p>
          <p class="ins-hint">You cannot open another till until this drawer has been counted.</p>
        </div>
      </section>
    </template>

    <!-- ── Session open ─────────────────────────────────────────────────────────────────────── -->
    <template v-else>
      <!-- The POS ribbon: the facts the shell's status strip used to carry, plus the one action. -->
      <div class="pos-ribbon">
        <div class="pos-ribbon-main">
          <span class="pos-live"><span class="pos-live-dot" aria-hidden="true" />Counter active</span>
          <div class="pos-ribbon-id">
            <strong>{{ session.cash_point_name }}</strong>
            <span>{{ session.session_no }} · {{ formatDate(session.business_date) }}</span>
          </div>
        </div>
        <div class="pos-ribbon-facts">
          <span class="pos-fact">
            <span class="pos-fact-label">Receipts</span>
            <strong class="pos-fact-value">{{ session.receipt_count }}</strong>
          </span>
          <span class="pos-fact">
            <span class="pos-fact-label">Awaiting verification</span>
            <strong class="pos-fact-value">{{ desk.awaiting_verification }}</strong>
          </span>
          <button v-if="canOperate && !cashingUp && !isStale" type="button" class="fin-btn" :disabled="busy" @click="suspendTill"><Pause :size="13" aria-hidden="true" /> Suspend</button>
          <button v-if="canOperate && !cashingUp" type="button" class="fin-btn" :class="{ primary: isStale }" :disabled="busy" @click="startCashUp">Cash up</button>
        </div>
      </div>

      <p v-if="isStale" class="ins-banner t-warning" role="status">
        <AlertTriangle :size="16" aria-hidden="true" />
        <span><strong>This session belongs to {{ formatDate(session.business_date) }}.</strong> It takes no more payments. Cash it up, then open today's till.</span>
      </p>

      <p v-if="session.return_reason" class="ins-banner t-warning" role="status">
        <AlertTriangle :size="16" aria-hidden="true" />
        <span><strong>Your count was sent back by {{ session.returned_by_name }}.</strong> {{ session.return_reason }}</span>
      </p>

      <!-- Cash up: replaces the payment form, because a till being counted takes no payments. -->
      <div v-if="cashingUp" class="cash-work cash-work--counting">
        <form class="ins-card cash-up" @submit.prevent="declareCount">
          <div class="ins-card-head">
            <h3>Cash up {{ session.session_no }}</h3>
            <span class="fin-pill tone-warning">Blind count</span>
          </div>
          <div class="cash-up-body">
            <div class="cash-up-copy">
              <p class="cash-lede">
                Count everything in the drawer, <strong>including the float</strong>, and enter the total for each currency it holds.
                You are not shown what the receipts add up to first; the difference, if there is one, appears after you declare.
              </p>
              <dl class="cash-up-facts">
                <div><dt>Cash point</dt><dd>{{ session.cash_point_name }}</dd></div>
                <div><dt>Receipts issued</dt><dd>{{ session.receipt_count }}</dd></div>
                <div><dt>Business date</dt><dd>{{ formatDate(session.business_date) }}</dd></div>
              </dl>
            </div>
            <div class="cash-up-counts">
              <div v-for="c in CURRENCIES" :key="c" class="cash-count-block">
                <label class="ins-field">
                  <span class="ins-label">{{ c === 'USD' ? 'US$' : 'ZWG' }} counted</span>
                  <input v-model="counted[c].total" class="ins-input cash-num cash-num-lg" inputmode="decimal" placeholder="Leave blank if none" autocomplete="off" />
                </label>
                <label v-if="needsExplanation && counted[c].total.trim() !== ''" class="ins-field">
                  <span class="ins-label">Explanation of the {{ c }} difference</span>
                  <textarea v-model="counted[c].explanation" class="ins-input" rows="2" placeholder="Required where the count differs from the receipts"></textarea>
                </label>
              </div>
            </div>
          </div>
          <div class="ins-card-foot">
            <button type="button" class="fin-btn" :disabled="busy" @click="cashingUp = false">Back to the counter</button>
            <button type="submit" class="fin-btn primary" :disabled="busy">{{ busy ? 'Declaring…' : 'Declare count' }}</button>
          </div>
        </form>
        <CashSessionReceipts :receipts="liveReceipts" :can-cancel="canCancel" :busy="busy" @print="emit('print', $event)" @cancel="cancelReceipt" />
      </div>

      <CashSessionReceipts v-else-if="isStale" :receipts="liveReceipts" :can-cancel="false" :busy="busy" @print="emit('print', $event)" @cancel="cancelReceipt" />

      <form v-else-if="canReceipt" class="pos-form" @submit.prevent="issue">
        <div v-if="issued" class="cash-issued" role="status" aria-live="polite">
          <Check :size="18" aria-hidden="true" />
          <div>
            <strong>{{ issued.receipt_no }}</strong> issued to {{ issued.payer_name }}
            <span class="cash-issued-amount">{{ formatMoney(issued.amount, issued.currency) }}</span>
          </div>
          <button type="button" class="fin-btn small" @click="emit('print', issued.id)"><Printer :size="13" aria-hidden="true" /> Print</button>
          <button type="button" class="ins-iconbtn" @click="issued = null"><X :size="14" aria-hidden="true" /><span class="sr-only">Dismiss</span></button>
        </div>

        <div class="pos-grid">
          <!-- ── Column 1: who is paying, and what for ───────────────────────────────────── -->
          <section class="pos-card pos-lookup" aria-labelledby="cash-take">
            <header class="pos-card-head">
              <h3 id="cash-take">{{ kind === 'rates' ? 'Ratepayer' : 'Payer & items' }}</h3>
              <div v-if="canRates" class="ins-seg" role="radiogroup" aria-label="What is being paid">
                <button type="button" role="radio" :aria-checked="kind === 'sundry'" @click="kind = 'sundry'">Other income</button>
                <button type="button" role="radio" :aria-checked="kind === 'rates'" @click="kind = 'rates'">Rates</button>
              </div>
            </header>
            <div class="pos-card-body">
              <!-- Other income -->
              <template v-if="kind === 'sundry'">
                <label class="ins-field">
                  <span class="pos-label">Received from</span>
                  <span class="pos-find">
                    <UserRound :size="16" aria-hidden="true" />
                    <input ref="payerEl" v-model="payer" autocomplete="off" placeholder="Name of the person or organisation paying" />
                  </span>
                </label>

                <div v-if="desk.income_codes.length === 0" class="fin-empty" role="status">
                  <strong>The Council's income list is empty.</strong>
                  <p>What a cashier may receipt other than rates — hall hire, market fees, licences — and what each costs is entered by the accountant or the Director of Finance (Council decision D22). Nothing is assumed.</p>
                </div>
                <div v-else class="cash-lines">
                  <div v-for="(line, i) in lines" :key="line.key" class="cash-line">
                    <label class="ins-field cash-line-code">
                      <span class="ins-label">For</span>
                      <select v-model="line.income_code_id" class="ins-input">
                        <option value="" disabled>Choose what is being paid for</option>
                        <option v-for="c in codesForCurrency" :key="c.id" :value="c.id">{{ c.name }}</option>
                      </select>
                    </label>
                    <label class="ins-field cash-line-qty">
                      <span class="ins-label">Qty</span>
                      <input v-model="line.quantity" class="ins-input cash-num" inputmode="decimal" autocomplete="off" />
                    </label>
                    <label class="ins-field cash-line-amt">
                      <span class="ins-label">Each ({{ currency }})</span>
                      <input v-if="isFixed(line)" :value="unitOf(line)" class="ins-input cash-num" disabled :aria-describedby="`cash-fixed-${line.key}`" />
                      <input v-else v-model="line.unit_amount" class="ins-input cash-num" inputmode="decimal" placeholder="0.00" autocomplete="off" />
                      <span v-if="isFixed(line)" :id="`cash-fixed-${line.key}`" class="ins-hint">Set by Council</span>
                    </label>
                    <span class="cash-line-total" aria-label="Line total">{{ lineTotal(line) === null ? '—' : formatMoney(centsToText(lineTotal(line)!), currency, { bare: true }) }}</span>
                    <button type="button" class="ins-iconbtn" :disabled="lines.length === 1" @click="lines.splice(i, 1)">
                      <Trash2 :size="14" aria-hidden="true" /><span class="sr-only">Remove line {{ i + 1 }}</span>
                    </button>
                  </div>
                  <button type="button" class="fin-btn small cash-add" @click="lines.push(newLine())"><Plus :size="13" aria-hidden="true" /> Add another item</button>
                </div>
              </template>

              <!-- Rates -->
              <template v-else>
                <div v-if="!ratesAccount" class="cash-rates-find">
                  <label class="ins-field">
                    <span class="pos-label">Find the ratepayer</span>
                    <span class="cash-search">
                      <input v-model="ratesQuery" class="ins-input" autocomplete="off" placeholder="Account number, name or stand" @keydown.enter.prevent="searchRates" />
                      <button type="button" class="fin-btn" :disabled="ratesSearching || ratesQuery.trim().length < 2" @click="searchRates"><Search :size="14" aria-hidden="true" /> Search</button>
                    </span>
                  </label>
                  <ul v-if="ratesResults.length" class="cash-results">
                    <li v-for="a in ratesResults" :key="a.id">
                      <button type="button" @click="chooseRatesAccount(a)">
                        <strong>{{ a.party_name }}</strong>
                        <span>{{ a.account_no }}<template v-if="a.stand_no"> · Stand {{ a.stand_no }}</template></span>
                      </button>
                    </li>
                  </ul>
                  <p v-else-if="ratesSearched && !ratesSearching" class="ins-hint">No active rates account matches “{{ ratesQuery }}”. A property is billed only once the revenue office has tied it to its ratepayer.</p>
                </div>
                <template v-else>
                  <div class="cash-ratepayer">
                    <div><strong>{{ ratesAccount.party_name }}</strong><span>{{ ratesAccount.account_no }}<template v-if="ratesAccount.stand_no"> · Stand {{ ratesAccount.stand_no }}</template></span></div>
                    <button type="button" class="fin-btn small" @click="ratesAccount = null">Change</button>
                  </div>
                  <div v-if="bills.length" class="fin-table-wrap">
                    <table class="fin-table">
                      <caption>Bills with something still open in {{ currency }}. Tick the ones being paid; the payment settles the oldest first.</caption>
                      <thead><tr><th scope="col"><span class="sr-only">Pay</span></th><th scope="col">Bill</th><th scope="col">Period</th><th scope="col" class="num">Still open</th></tr></thead>
                      <tbody>
                        <tr v-for="b in bills" :key="b.id">
                          <td><input :id="`bill-${b.id}`" type="checkbox" :checked="selectedBills.has(b.id)" @change="toggleBill(b)" /></td>
                          <td><label :for="`bill-${b.id}`">{{ b.bill_no }}</label></td>
                          <td>{{ formatDate(b.period_from) }} – {{ formatDate(b.period_to) }}</td>
                          <td class="num">{{ formatMoney(b.open_amount, b.currency, { bare: true }) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p v-else class="ins-hint">This ratepayer has no posted bill open in {{ currency }}. A payment can still be taken; it stays on their account as a credit.</p>
                </template>
              </template>
            </div>
          </section>

          <!-- ── Column 2: the basket and how it is settled ─────────────────────────────── -->
          <section class="pos-settle" aria-labelledby="cash-settle">
            <div class="pos-basket">
              <div class="pos-basket-head">
                <h3 id="cash-settle">Settlement</h3>
                <span class="pos-count">{{ itemWord }}</span>
              </div>
              <div class="cash-total" aria-live="polite">
                <span>To collect</span>
                <strong>{{ previewCents ? formatMoney(centsToText(previewCents), currency) : `${currency === 'USD' ? 'US$' : 'ZWG'} —` }}</strong>
              </div>
              <div class="pos-basket-foot">
                <span>{{ currency === 'USD' ? 'US$' : 'ZWG' }}</span>
                <span>{{ CASH_METHODS.find((m) => m.value === method)?.label }}</span>
              </div>
            </div>

            <div class="pos-card pos-tender">
              <div class="pos-card-body">
                <div class="pos-field">
                  <span id="cash-ccy" class="pos-label">Currency</span>
                  <div class="ins-seg" role="radiogroup" aria-labelledby="cash-ccy">
                    <button v-for="c in CURRENCIES" :key="c" type="button" role="radio" :aria-checked="currency === c" @click="currency = c">{{ c === 'USD' ? 'US$' : 'ZWG' }}</button>
                  </div>
                </div>

                <div class="pos-field">
                  <span id="cash-method" class="pos-label">Paid by</span>
                  <div class="cash-methods" role="radiogroup" aria-labelledby="cash-method">
                    <button
                      v-for="m in CASH_METHODS" :key="m.value" type="button" role="radio"
                      :aria-checked="method === m.value" class="pos-method" @click="method = m.value"
                    >
                      <component :is="METHOD_ICONS[m.value]" :size="18" aria-hidden="true" />
                      <span>{{ m.label }}</span>
                    </button>
                  </div>
                </div>

                <template v-if="!isPhysical">
                  <label class="ins-field">
                    <span class="pos-label">Paid into</span>
                    <select v-model="depositAccount" class="ins-input">
                      <option value="" disabled>Choose the bank or wallet account</option>
                      <option v-for="b in desk.bank_accounts" :key="b.id" :value="b.id">{{ b.code }} — {{ b.name }}</option>
                    </select>
                    <span v-if="desk.bank_accounts.length === 0" class="ins-hint">No bank account exists in the ledger yet, so only cash and cheques can be taken.</span>
                  </label>
                  <label class="ins-field">
                    <span class="pos-label">Transaction reference</span>
                    <input v-model="reference" class="ins-input" autocomplete="off" placeholder="From the machine, bank or wallet" />
                  </label>
                </template>

                <label v-if="kind === 'rates'" class="ins-field cash-rates-amount">
                  <span class="pos-label">Amount received ({{ currency }})</span>
                  <input v-model="ratesAmount" class="ins-input cash-num cash-num-lg" inputmode="decimal" placeholder="0.00" autocomplete="off" />
                  <span class="ins-hint">Less than the ticked bills is a part payment. More stays on the account as a credit.</span>
                </label>
              </div>
            </div>

            <p v-if="attempted && problem" class="cash-problem" role="alert">{{ problem }}</p>
            <button type="submit" class="pos-issue" :disabled="busy">{{ busy ? 'Issuing…' : 'Issue receipt' }}</button>
            <p class="pos-note">The receipt number and date are issued by the ledger, not keyed here.</p>
          </section>

          <!-- ── Column 3: what this session has issued ─────────────────────────────────── -->
          <aside class="pos-audit">
            <CashSessionReceipts :receipts="liveReceipts" :can-cancel="canCancel" :busy="busy" @print="emit('print', $event)" @cancel="cancelReceipt" />
            <p class="pos-note">A receipt is cancelled with a reason and issued again — it is never edited.</p>
          </aside>
        </div>
      </form>

      <div v-else class="cash-work cash-work--single">
        <CashSessionReceipts :receipts="liveReceipts" :can-cancel="canCancel" :busy="busy" @print="emit('print', $event)" @cancel="cancelReceipt" />
      </div>
    </template>

    <FinancePromptDialog :controller="prompt" />
  </div>
</template>

<style scoped>
/* ── The POS skin ──────────────────────────────────────────────────────────────────────────────
   The counter is a point-of-sale terminal, and it is dressed as one. Rather than restyling each
   child, the enterprise tokens are remapped on the root of this view only: every card, field,
   badge and table underneath inherits navy, teal and a receipt-paper surface. Nothing outside
   `.cash-counter` changes. */
.cash-counter {
  /* Navy settlement panels, paper surfaces, one teal action colour. */
  --ent-canvas:        #f8f9ff;
  --ent-surface:       #ffffff;
  --ent-surface-2:     #eff4ff;
  --ent-surface-sunken:#e5eeff;
  --ent-line:          #dce9ff;
  --ent-line-strong:   #c3d5ec;
  --ent-text:          #0b1c30;
  --ent-text-2:        #43474d;
  --ent-text-3:        #6b7684;
  --ent-accent:        #006398;
  --ent-accent-hover:  #004d77;
  --ent-accent-active: #003c5e;
  --ent-accent-soft:   #cce5ff;
  --ent-accent-line:   #a8cdf0;
  --ent-accent-ring:   rgba(0, 99, 152, 0.3);
  --ent-info:          var(--ent-accent);
  --ent-info-soft:     var(--ent-accent-soft);
  --ent-success:       #0f6b57;
  --ent-success-soft:  #e0f6ef;
  --ent-warning:       #8a5a00;
  --ent-warning-soft:  #fdf2dc;
  --ent-danger:        #ba1a1a;
  --ent-danger-soft:   #ffdad6;
  /* Tone tokens resolve their var() references at :root, so they are restated here. */
  --ent-tone-neutral-bg:  #eff4ff;  --ent-tone-neutral-fg:  #43474d;  --ent-tone-neutral-line:  #dce9ff;
  --ent-tone-info-bg:     #cce5ff;  --ent-tone-info-fg:     #004a75;  --ent-tone-info-line:     #a8cdf0;
  --ent-tone-positive-bg: #e0f6ef;  --ent-tone-positive-fg: #0f6b57;  --ent-tone-positive-line: #b9e3d5;
  --ent-tone-warning-bg:  #fdf2dc;  --ent-tone-warning-fg:  #8a5a00;  --ent-tone-warning-line:  #ecd4a4;
  --ent-tone-negative-bg: #ffdad6;  --ent-tone-negative-fg: #ba1a1a;  --ent-tone-negative-line: #f2b8b5;

  /* The POS solids, kept in one place: the navy settlement panel and its teal highlight. */
  --pos-ink:       #00162d;
  --pos-ink-2:     #0f2b48;
  --pos-ink-muted: #7a93b5;
  --pos-teal:      #89f5e7;

  display: flex; flex-direction: column; gap: var(--ent-s4);
}
.cash-lede { margin: 0; max-width: 68ch; font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh); }
.cash-lede strong { color: var(--ent-text); font-weight: var(--ent-fw-semibold); }

/* ── Opening the till ──────────────────────────────────────────────────────────────────────── */
.cash-open { max-width: 56rem; }
.cash-open-body { display: flex; flex-direction: column; gap: var(--ent-s4); }
.cash-open-lede { padding-left: var(--ent-s3); border-left: 2px solid var(--ent-line-strong); }
.cash-open-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 19rem); gap: var(--ent-s4); align-items: start; }
.cash-open-main { display: flex; flex-direction: column; gap: var(--ent-s4); }
.cash-floats {
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s2) var(--ent-s3);
  margin: 0; padding: var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface-2);
}
.cash-floats legend { padding: 0; margin-bottom: var(--ent-s1); }
.cash-floats-note { grid-column: 1 / -1; }
.cash-foot-note { margin-right: auto; max-width: 42ch; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

/* Figures a cashier reads aloud to a payer: tabular, mono, right-aligned. */
.cash-num { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; text-align: right; }
.cash-num-lg { min-height: 44px; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-semibold); }

/* ── POS ribbon — the facts the shell strip carries on the other views ─────────────────────── */
.pos-ribbon {
  display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap;
  padding: var(--ent-s2) var(--ent-s3);
  border-radius: var(--ent-r-md); background: var(--ent-surface-2); box-shadow: var(--ent-e1);
}
.pos-ribbon-main { display: flex; align-items: center; gap: var(--ent-s3); flex: 1; min-width: 14rem; }
.pos-live {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  padding: 4px var(--ent-s2); border-radius: var(--ent-r-sm);
  background: var(--ent-surface-sunken); color: var(--ent-text);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap;
}
.pos-live-dot {
  width: 0.5rem; height: 0.5rem; border-radius: var(--ent-r-pill);
  background: var(--ent-success); box-shadow: 0 0 0 3px var(--ent-tone-positive-bg);
}
.pos-ribbon-id { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.pos-ribbon-id strong { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pos-ribbon-id span {
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro);
  font-variant-numeric: tabular-nums; color: var(--ent-text-3);
}
.pos-ribbon-facts { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.pos-fact {
  display: inline-flex; align-items: baseline; gap: var(--ent-s2);
  padding: 4px var(--ent-s2); border-radius: var(--ent-r-sm); background: var(--ent-surface);
}
.pos-fact-label {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.05em; text-transform: uppercase; color: var(--ent-text-3);
}
.pos-fact-value {
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-base);
  font-weight: var(--ent-fw-bold); font-variant-numeric: tabular-nums; color: var(--ent-text);
}

/* ── Count declared ────────────────────────────────────────────────────────────────────────── */
.cash-closed { overflow: hidden; }
.cash-status-band {
  display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap;
  padding: var(--ent-s3) var(--ent-s4);
  background: var(--ent-tone-warning-bg); border-bottom: 1px solid var(--ent-tone-warning-line);
}
.cash-status-mark {
  display: inline-grid; place-items: center; width: 2.25rem; height: 2.25rem; flex-shrink: 0;
  border: 1px solid var(--ent-tone-warning-line); border-radius: var(--ent-r);
  background: var(--ent-surface); color: var(--ent-warning);
}
.cash-status-mark.is-alert { border-color: var(--ent-tone-negative-line, var(--ent-line)); color: var(--ent-danger); }
.cash-suspended-acts { display: flex; gap: var(--ent-s2); }
.cash-held { margin: var(--ent-s2) 0 0; padding-left: 1.2em; text-align: left; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.cash-held li { margin: 2px 0; }
.cash-status-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 12rem; }
.cash-status-eyebrow { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.cash-status-main h3 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.cash-status-meta { font-size: var(--ent-fs-xs); color: var(--ent-text-2); font-variant-numeric: tabular-nums; }
.cash-closed-body { display: flex; flex-direction: column; gap: var(--ent-s4); padding: var(--ent-s4); }

/* ── Working area — cash-up keeps the two-column card layout ───────────────────────────────── */
.cash-work { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: var(--ent-s4); align-items: start; }
.cash-work--single { grid-template-columns: minmax(0, 1fr); }
.cash-work--counting { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); }

/* ── The counter as a POS: 4 / 5 / 3 columns, stacked by its own width ─────────────────────── */
.pos-form { display: flex; flex-direction: column; gap: var(--ent-s3); container-type: inline-size; }
.pos-grid {
  display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 5fr) minmax(0, 3fr);
  gap: var(--ent-s3); align-items: stretch;
}
.pos-card {
  display: flex; flex-direction: column; min-width: 0;
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
  background: var(--ent-surface); box-shadow: var(--ent-e1);
}
.pos-card-head {
  display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap;
  min-height: 44px; padding: var(--ent-s2) var(--ent-s3);
  border-bottom: 1px solid var(--ent-line);
}
.pos-card-head h3 {
  flex: 1; margin: 0; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.pos-card-body { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s3); }
.pos-label {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3);
}
.pos-field { display: flex; flex-direction: column; gap: var(--ent-s2); }

/* The payer field, as the mockup's lookup: an icon inside an inset well. */
.pos-find {
  display: flex; align-items: center; gap: var(--ent-s2);
  padding: 0 var(--ent-s3); min-height: 44px;
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface-2); color: var(--ent-accent);
  transition: border-color var(--ent-dur) var(--ent-ease), box-shadow var(--ent-dur) var(--ent-ease);
}
.pos-find:focus-within { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); background: var(--ent-surface); }
.pos-find input {
  flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
  font-family: var(--ent-font); font-size: var(--ent-fs-base); color: var(--ent-text);
}
.pos-find input::placeholder { color: var(--ent-text-3); }

/* ── Settlement column: the navy basket, the tender tiles, the one action ──────────────────── */
.pos-settle { display: flex; flex-direction: column; gap: var(--ent-s3); min-width: 0; }
.pos-basket {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s3); border-radius: var(--ent-r-md);
  background: var(--pos-ink); color: #ffffff; box-shadow: var(--ent-e2);
}
.pos-basket-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2); }
.pos-basket-head h3 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: #ffffff; }
.pos-count {
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.05em; text-transform: uppercase;
  padding: 2px 8px; border-radius: var(--ent-r-sm); background: var(--pos-ink-2); color: var(--pos-ink-muted);
}
.pos-basket .cash-total { padding: var(--ent-s2) 0; border-top: 1px solid var(--pos-ink-2); }
.pos-basket .cash-total span {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--pos-ink-muted);
}
.pos-basket .cash-total strong {
  font-size: 2.25rem; line-height: 1.1; letter-spacing: -0.03em;
  font-weight: var(--ent-fw-bold); color: #ffffff;
}
.pos-basket-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2);
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro);
  letter-spacing: 0.04em; text-transform: uppercase; color: var(--pos-teal);
}

.cash-total { display: flex; flex-direction: column; gap: 2px; }
.cash-total span { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.cash-total strong {
  font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-num); font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight); color: var(--ent-text);
}

/* Tender tiles: icon over label, so the method is one glance and one tap. */
.cash-methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr)); gap: var(--ent-s1); }
.pos-method {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  min-height: 56px; padding: var(--ent-s2) var(--ent-s1);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
  background: var(--ent-surface-2); color: var(--ent-text-2);
  font: inherit; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
  cursor: pointer;
  transition: background-color var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.pos-method > svg { color: var(--ent-accent); }
.pos-method:hover { border-color: var(--ent-line-strong); color: var(--ent-text); }
.pos-method:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.pos-method[aria-checked='true'] {
  background: var(--ent-accent); border-color: var(--ent-accent); color: #ffffff;
  box-shadow: var(--ent-e1);
}
.pos-method[aria-checked='true'] > svg { color: #ffffff; }

.cash-problem {
  margin: 0; padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-tone-negative-line); border-radius: var(--ent-r-sm);
  background: var(--ent-tone-negative-bg); font-size: var(--ent-fs-xs); color: var(--ent-tone-negative-fg);
}
.pos-issue {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--ent-s2);
  width: 100%; min-height: 52px; padding: 0 var(--ent-s4);
  border: 1px solid var(--ent-accent); border-radius: var(--ent-r-md);
  background: var(--ent-accent); color: #ffffff;
  font: inherit; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.02em; cursor: pointer; box-shadow: var(--ent-e2);
  transition: filter var(--ent-dur) var(--ent-ease);
}
.pos-issue:hover:not(:disabled) { filter: brightness(0.94); }
.pos-issue:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.pos-issue:disabled { opacity: 0.55; cursor: not-allowed; }
.pos-note { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh); }

/* ── Audit column: what this session has issued ────────────────────────────────────────────── */
.pos-audit { display: flex; flex-direction: column; gap: var(--ent-s2); min-width: 0; }
.pos-audit :deep(.cash-receipts-card) { flex: 1; }

/* ── Payment lines and ratepayer search ────────────────────────────────────────────────────── */
.cash-lines { display: flex; flex-direction: column; gap: var(--ent-s2); }
/* One line = a small card: the item first, then quantity, each, line total, remove. */
.cash-line {
  display: grid; grid-template-columns: 4.5rem minmax(0, 1fr) auto auto;
  gap: var(--ent-s2); align-items: end;
  padding: var(--ent-s2); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm); background: var(--ent-surface-2);
}
.cash-line-code { grid-column: 1 / -1; }
.cash-line-total {
  align-self: center; justify-self: end; min-width: 5rem; text-align: right;
  font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.cash-line > .ins-iconbtn { align-self: center; justify-self: end; }
.cash-add { align-self: flex-start; }

.cash-search { display: flex; gap: var(--ent-s2); }
.cash-results { list-style: none; margin: var(--ent-s2) 0 0; padding: 0; border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); overflow: hidden; }
.cash-results li + li { border-top: 1px solid var(--ent-line); }
.cash-results button {
  display: flex; flex-direction: column; gap: 2px; width: 100%; padding: var(--ent-s2) var(--ent-s3);
  border: 0; background: var(--ent-surface); font: inherit; text-align: left; cursor: pointer;
}
.cash-results button:hover { background: var(--ent-surface-2); }
.cash-results button:focus-visible { outline: none; box-shadow: inset var(--ent-focus-ring); }
.cash-results strong { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.cash-results span, .cash-ratepayer span { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.cash-ratepayer {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3);
  padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r-md); background: var(--ent-surface-2);
}
.cash-ratepayer div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cash-ratepayer strong { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.cash-rates-amount { max-width: 16rem; }

/* ── Cashing up ────────────────────────────────────────────────────────────────────────────── */
/* The body stacks on its own width, not the viewport's: this card sits in a column, so at some
   window widths it is already narrow while the page is still wide. */
.cash-up { display: flex; flex-direction: column; container-type: inline-size; }
.cash-up-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 20rem); gap: var(--ent-s5); padding: var(--ent-s4); }
.cash-up-copy { display: flex; flex-direction: column; gap: var(--ent-s3); }
.cash-up-facts {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--ent-s3);
  margin: 0; padding: var(--ent-s3); border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-md); background: var(--ent-surface-2);
}
.cash-up-facts dt { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3); }
.cash-up-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.cash-up-counts { display: flex; flex-direction: column; gap: var(--ent-s3); }
.cash-count-block {
  display: flex; flex-direction: column; gap: var(--ent-s2); padding: var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface-2);
}

/* ── Issued confirmation ───────────────────────────────────────────────────────────────────── */
.cash-issued {
  display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap;
  padding: var(--ent-s3); border: 1px solid var(--ent-tone-positive-line); border-radius: var(--ent-r-md);
  background: var(--ent-tone-positive-bg); font-size: var(--ent-fs-sm); color: var(--ent-text);
  animation: cash-arrive 200ms var(--ent-ease);
}
.cash-issued > svg { color: var(--ent-success); flex-shrink: 0; }
.cash-issued > div { flex: 1; min-width: 10rem; }
.cash-issued-amount { display: block; font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; font-weight: var(--ent-fw-semibold); }

.is-short { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.is-over { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@keyframes cash-arrive { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cash-issued { animation: none; } }

@media (max-width: 1120px) {
  .cash-work, .cash-work--counting { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1023px) {
  .cash-open-grid { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 960px) {
  .pos-grid { grid-template-columns: minmax(0, 4fr) minmax(0, 5fr); }
  .pos-audit { grid-column: 1 / -1; }
}
@container (max-width: 640px) {
  .pos-grid { grid-template-columns: minmax(0, 1fr); }
  .pos-basket .cash-total strong { font-size: 1.875rem; }
  .cash-up-body { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .cash-line { grid-template-columns: 4rem minmax(0, 1fr) auto auto; }
  .cash-line-total { min-width: 0; }
  .cash-floats { grid-template-columns: minmax(0, 1fr); }
}
</style>
