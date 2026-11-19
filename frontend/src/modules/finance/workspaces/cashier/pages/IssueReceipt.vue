<script setup lang="ts">
/**
 * Receipt a service that has no bill: one or more items from the council's income list (a dog
 * licence, a day's hall hire, a market stall fee). A fixed charge is the council's and cannot be
 * changed here; a variable one is entered. Issued by `POST /finance/cash/receipts`.
 *
 * A PLANNING FEE NAMES ITS APPLICATION (migration 246). When a service is a planning fee (its income
 * code carries a planning fee kind), the cashier finds the planning application it pays for and the
 * receipt goes to `POST /finance/cash/receipts/planning`: the fee is linked to the application, and an
 * application fee marks it paid. Planning fees go on a receipt of their own, so the link is exact.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { FileText, Plus, Trash2, User, CreditCard, ReceiptText, Printer, Download, X, Check, AlertTriangle, CircleCheck, Landmark, Search } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { centsToText, lineCents, toCents } from '../../../composables/cashMath'
import { chargeIn, planningFeeLabel, receiptableIn, type CashMethod, type CashReceipt, type PlanningApplicationHit } from '../../../models/cashTypes'
import { useCashier } from '../useCashier'
import { tenderNarration, viewOfPrintable, type ReceiptView } from '../receipt'
import MethodTiles from '../components/MethodTiles.vue'
import TillNotice from '../components/TillNotice.vue'
import ReceiptDocument from '../components/ReceiptDocument.vue'
import ReceiptOutput from '../components/ReceiptOutput.vue'
import PersonPicker from '@/components/shared/PersonPicker.vue'
import type { Person } from '@/services/persons'

interface Line { key: number; income_code_id: string; quantity: string; unit_amount: string }

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const { state, session, canTakePayment, loadDesk, loadQueue } = useCashier()

let seq = 0
const newLine = (): Line => ({ key: ++seq, income_code_id: '', quantity: '1', unit_amount: '' })

const payer = ref(typeof route.query.name === 'string' ? route.query.name : '')
const currency = ref<Currency>('USD')
const lines = ref<Line[]>([newLine()])
const method = ref<CashMethod>('cash')
const reference = ref('')
const depositAccount = ref('')
const tendered = ref('')
const attempted = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const payerEl = ref<HTMLInputElement | null>(null)
// Who paid, in the council's register of persons (migration 256). Optional: a walk-in paying a sundry charge need not be
// registered. Choosing someone fills "Received from" with their name if it is still empty.
const payerPerson = ref<Person | null>(null)
watch(payerPerson, (p) => { if (p && payer.value.trim().length < 2) payer.value = p.display_name })

const canReceipt = computed(() => store.can('finance.cash.receipt.record'))
const codes = computed(() => (state.desk?.income_codes ?? []).filter((c) => receiptableIn(c, currency.value)))
const codeById = computed(() => new Map((state.desk?.income_codes ?? []).map((c) => [c.id, c])))
const isCash = computed(() => method.value === 'cash')

watch(() => state.desk?.bank_accounts, (banks) => {
  if (banks && !banks.some((b) => b.id === depositAccount.value)) depositAccount.value = banks.length === 1 ? banks[0].id : ''
}, { immediate: true })
watch(currency, () => {
  for (const l of lines.value) {
    const c = codeById.value.get(l.income_code_id)
    if (c && !receiptableIn(c, currency.value)) l.income_code_id = ''
  }
})

const fixed = (l: Line) => codeById.value.get(l.income_code_id)?.pricing === 'fixed'
function unitOf(l: Line): string {
  const c = codeById.value.get(l.income_code_id)
  return c?.pricing === 'fixed' ? chargeIn(c, currency.value) ?? '' : l.unit_amount
}
const lineTotal = (l: Line) => (l.income_code_id ? lineCents(l.quantity, unitOf(l)) : null)
const totalCents = computed<bigint | null>(() => {
  let t = 0n
  for (const l of lines.value) {
    const v = lineTotal(l)
    if (v === null) return null
    t += v
  }
  return t
})
// ── A planning fee names its application (migration 246) ─────────────────────────────────────
const kindOf = (l: Line) => codeById.value.get(l.income_code_id)?.planning_fee_kind ?? null
const isPlanning = computed(() => lines.value.some((l) => kindOf(l)))
const mixed = computed(() => isPlanning.value && lines.value.some((l) => l.income_code_id && !kindOf(l)))
const paysApplicationFee = computed(() => lines.value.some((l) => kindOf(l) === 'application'))
const application = ref<PlanningApplicationHit | null>(null)
const appQuery = ref('')
const appHits = ref<PlanningApplicationHit[]>([])
const appSearching = ref(false)
const appSearched = ref(false)
let appTimer: ReturnType<typeof setTimeout> | undefined
watch(appQuery, (q) => {
  clearTimeout(appTimer)
  appSearched.value = false
  if (q.trim().length < 2) { appHits.value = []; return }
  appTimer = setTimeout(async () => {
    appSearching.value = true
    try {
      appHits.value = (await cashApi.planningApplications(q.trim())).applications
    } catch (err) {
      error.value = messageOf(err, 'The applications could not be searched.')
    } finally {
      appSearching.value = false
      appSearched.value = true
    }
  }, 250)
})
function chooseApplication(a: PlanningApplicationHit): void {
  application.value = a
  appQuery.value = ''
  appHits.value = []
  if (payer.value.trim().length < 2 && a.applicant_name) payer.value = a.applicant_name
}
const appLabel = (a: PlanningApplicationHit) => a.tpd_reference || a.dev_register_no || (a.stand_number ? `Stand ${a.stand_number}` : 'Application')
const issuedApplication = ref<PlanningApplicationHit | null>(null)

const tenderedCents = computed(() => (isCash.value ? toCents(tendered.value.replace(/,/g, '')) : totalCents.value))
const changeCents = computed(() => (isCash.value && tenderedCents.value !== null && totalCents.value !== null ? tenderedCents.value - totalCents.value : null))
watch(totalCents, (t) => { if (t !== null && (!tendered.value || attempted.value === false)) tendered.value = centsToText(t) })

const problem = computed<string | null>(() => {
  if (payer.value.trim().length < 2) return 'Enter who is paying.'
  if (lines.value.some((l) => !l.income_code_id)) return 'Choose what each line is for.'
  if (!totalCents.value) return 'Enter an amount for each line.'
  if (mixed.value) return 'A planning fee goes on a receipt of its own. Take the other services on a separate receipt.'
  if (isPlanning.value && !application.value) return 'Find the planning application this fee is for.'
  if (!isCash.value) {
    if (!depositAccount.value) return 'Choose the bank or wallet account this payment was made into.'
    if (reference.value.trim().length < 3) return 'Enter the transaction reference.'
  } else if (tenderedCents.value === null || (changeCents.value ?? -1n) < 0n) {
    return 'The amount received is less than the total.'
  }
  return null
})

const issued = ref<CashReceipt | null>(null)
const issuedView = ref<ReceiptView | null>(null)
const docEl = ref<HTMLElement | null>(null)
const output = ref<InstanceType<typeof ReceiptOutput> | null>(null)
const ticketId = computed(() => (typeof route.query.ticket === 'string' ? route.query.ticket : null))

async function issue(): Promise<void> {
  attempted.value = true
  if (problem.value || !session.value || busy.value) return
  busy.value = true
  error.value = null
  const tenderedText = isCash.value && tenderedCents.value !== null ? centsToText(tenderedCents.value) : null
  const changeText = changeCents.value !== null && changeCents.value >= 0n ? centsToText(changeCents.value) : null
  try {
    const body = {
      session_id: session.value.id,
      payer_name: payer.value.trim(),
      ...(payerPerson.value ? { payer_person_id: payerPerson.value.id } : {}),
      currency: currency.value,
      method: method.value,
      lines: lines.value.map((l) => ({
        income_code_id: l.income_code_id,
        ...(l.quantity.trim() && l.quantity.trim() !== '1' ? { quantity: l.quantity.trim() } : {}),
        ...(fixed(l) ? {} : { unit_amount: l.unit_amount.trim() }),
      })),
      ...(isCash.value ? {} : { deposit_account_id: depositAccount.value, method_reference: reference.value.trim() }),
      ...(tenderedText && changeText ? { narration: tenderNarration(tenderedText, changeText) } : {}),
    }
    let receipt: CashReceipt
    if (isPlanning.value && application.value) {
      const planned = await cashApi.issuePlanningReceipt({ ...body, permit_application_id: application.value.id })
      receipt = planned.receipt
      issuedApplication.value = planned.application
    } else {
      receipt = (await cashApi.issueReceipt(body)).receipt
      issuedApplication.value = null
    }
    const result = { receipt }
    issued.value = result.receipt
    const printable = (await cashApi.receipt(result.receipt.id)).receipt
    issuedView.value = viewOfPrintable(printable, { customer_type: 'Walk-in' })
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

function next(): void {
  issued.value = null
  issuedView.value = null
  issuedApplication.value = null
  application.value = null
  payer.value = ''
  payerPerson.value = null
  lines.value = [newLine()]
  reference.value = ''
  tendered.value = ''
  attempted.value = false
  void router.replace({ name: 'cashier-issue' })
  void nextTick(() => payerEl.value?.focus())
}

onMounted(() => { void nextTick(() => payerEl.value?.focus()) })
const money = (c: bigint | null) => formatMoney(c === null ? null : centsToText(c), currency.value)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileText :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Issue Receipt</h2>
      <p>Receipt a service that has no bill — a licence, a hire, a fee from the council's income list.</p>
    </div>
    <RouterLink :to="{ name: 'cashier-pay' }" class="cw-btn cw-btn--outline">Paying a bill? Take Payment</RouterLink>
  </section>

  <TillNotice />
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <div v-if="issued && issuedView" class="ir-done">
    <p class="cw-banner-msg cw-banner-msg--pos" role="status"><CircleCheck :size="20" aria-hidden="true" />Receipt {{ issued.receipt_no }} issued.</p>
    <p v-if="issuedApplication" class="cw-banner-msg cw-banner-msg--pos" role="status" data-testid="ir-app-paid">
      <Landmark :size="20" aria-hidden="true" />
      Recorded against planning application {{ appLabel(issuedApplication) }}{{ issuedApplication.fee_paid ? ': its application fee is now paid.' : '.' }}
    </p>
    <div ref="docEl" class="cw-card" style="overflow: hidden"><ReceiptDocument :view="issuedView" /></div>
    <div class="ir-buttons">
      <RouterLink :to="{ name: 'cashier-dashboard' }" class="cw-btn">Dashboard</RouterLink>
      <button type="button" class="cw-btn cw-btn--outline" @click="output?.print(issuedView)"><Printer :size="20" aria-hidden="true" /> Print Receipt</button>
      <button type="button" class="cw-btn cw-btn--outline" @click="savePdf"><Download :size="20" aria-hidden="true" /> Download PDF</button>
      <button type="button" class="cw-btn cw-btn--primary" @click="next"><FileText :size="20" aria-hidden="true" /> Next Receipt</button>
    </div>
  </div>

  <div v-else class="ir-grid">
    <div class="ir-col">
      <section class="cw-card" aria-labelledby="ir-c">
        <div class="cw-card-head"><h3 id="ir-c"><User :size="26" class="cw-head-icon" aria-hidden="true" /> Customer</h3></div>
        <div class="cw-card-body ir-stack">
          <label class="cw-field">
            <span class="cw-label">Received from <span class="req">*</span></span>
            <input ref="payerEl" v-model="payer" class="cw-input" autocomplete="off" maxlength="160" :class="{ 'is-invalid': attempted && payer.trim().length < 2 }" />
          </label>
          <details class="ir-person" :open="!!payerPerson" data-testid="ir-payer-person">
            <summary class="cw-label">{{ payerPerson ? 'Payer in the register' : 'Find or register the payer (optional)' }}</summary>
            <PersonPicker v-model="payerPerson" role="payer" />
          </details>
          <div class="cw-field">
            <span class="cw-label">Currency</span>
            <div class="cw-seg" role="group" aria-label="Currency">
              <button type="button" :aria-pressed="currency === 'USD'" @click="currency = 'USD'">USD</button>
              <button type="button" :aria-pressed="currency === 'ZWG'" @click="currency = 'ZWG'">ZWG</button>
            </div>
          </div>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ir-s">
        <div class="cw-card-head">
          <h3 id="ir-s"><ReceiptText :size="26" class="cw-head-icon" aria-hidden="true" /> Services</h3>
          <span class="cw-spacer" />
          <button type="button" class="cw-btn cw-btn--small" @click="lines.push(newLine())"><Plus :size="16" aria-hidden="true" /> Add line</button>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!codes.length" class="cw-empty"><strong>No service can be charged in {{ currency }}.</strong>The council's income list is kept by the accountant.</p>
          <table v-else class="cw-table">
            <thead><tr><th>Service</th><th class="r">Qty</th><th class="r">Unit amount</th><th class="r">Amount</th><th><span class="sr-only">Remove</span></th></tr></thead>
            <tbody>
              <tr v-for="l in lines" :key="l.key">
                <td style="min-width: 220px">
                  <select v-model="l.income_code_id" class="cw-select" :aria-label="'Service'" :class="{ 'is-invalid': attempted && !l.income_code_id }">
                    <option value="" disabled>Choose a service</option>
                    <option v-for="c in codes" :key="c.id" :value="c.id">{{ c.name }}{{ c.planning_fee_kind ? ' · planning fee' : '' }}</option>
                  </select>
                </td>
                <td class="r" style="width: 96px"><input v-model="l.quantity" class="cw-input num" inputmode="decimal" aria-label="Quantity" style="text-align: right" /></td>
                <td class="r" style="width: 150px">
                  <span v-if="fixed(l)" class="num">{{ formatMoney(unitOf(l), currency) }}</span>
                  <input v-else v-model="l.unit_amount" class="cw-input num" inputmode="decimal" aria-label="Unit amount" placeholder="0.00" style="text-align: right" :disabled="!l.income_code_id" />
                </td>
                <td class="amt">{{ lineTotal(l) === null ? '—' : money(lineTotal(l)) }}</td>
                <td><button type="button" class="cw-icon-btn" aria-label="Remove line" :disabled="lines.length === 1" @click="lines = lines.filter((x) => x.key !== l.key)"><Trash2 :size="18" /></button></td>
              </tr>
            </tbody>
            <tfoot><tr><th colspan="3">Total</th><td colspan="2">{{ money(totalCents) }}</td></tr></tfoot>
          </table>
          <p v-if="mixed" class="cw-banner-msg cw-banner-msg--neg" role="alert" style="margin-top: 12px">
            <AlertTriangle :size="18" aria-hidden="true" />A planning fee goes on a receipt of its own. Take the other services on a separate receipt.
          </p>
        </div>
      </section>

      <!-- Migration 246: a planning fee is linked to the application it pays for. -->
      <section v-if="isPlanning" class="cw-card" aria-labelledby="ir-a" data-testid="ir-application">
        <div class="cw-card-head"><h3 id="ir-a"><Landmark :size="26" class="cw-head-icon" aria-hidden="true" /> Planning application</h3></div>
        <div class="cw-card-body ir-stack">
          <div v-if="application" class="ir-app">
            <div>
              <strong>{{ appLabel(application) }}</strong>
              <span class="ir-app-sub">
                {{ application.applicant_name || 'Applicant not named' }}<template v-if="application.stand_number"> · Stand {{ application.stand_number }}</template>
                · {{ application.status.replace(/_/g, ' ') }}
              </span>
              <span v-if="paysApplicationFee && application.fee_paid" class="ir-app-warn" role="alert">
                <AlertTriangle :size="16" aria-hidden="true" /> Its application fee is already paid. Check before taking it again.
              </span>
            </div>
            <button type="button" class="cw-btn cw-btn--small" @click="application = null">Change</button>
          </div>
          <template v-else>
            <label class="cw-field">
              <span class="cw-label">Find the application <span class="req">*</span></span>
              <span class="ir-search">
                <Search :size="16" aria-hidden="true" />
                <input v-model="appQuery" class="cw-input" autocomplete="off" maxlength="80"
                       placeholder="Reference, register number, stand or applicant"
                       :class="{ 'is-invalid': attempted && !application }" />
              </span>
            </label>
            <p v-if="appSearching" class="cw-muted">Searching…</p>
            <ul v-else-if="appHits.length" class="ir-hits" aria-label="Matching applications">
              <li v-for="a in appHits" :key="a.id">
                <button type="button" class="ir-hit" @click="chooseApplication(a)">
                  <strong>{{ appLabel(a) }}</strong>
                  <span>{{ a.applicant_name || 'Applicant not named' }}<template v-if="a.stand_number"> · Stand {{ a.stand_number }}</template></span>
                  <span class="ir-hit-tag" :class="{ 'is-paid': a.fee_paid }">{{ a.fee_paid ? 'Application fee paid' : 'Application fee not paid' }}</span>
                </button>
              </li>
            </ul>
            <p v-else-if="appSearched" class="cw-muted">No application matches. Check the reference with the planning clerk.</p>
          </template>
          <p class="cw-muted ir-kinds">
            Paying for: {{ [...new Set(lines.map(kindOf).filter(Boolean))].map(planningFeeLabel).join(', ') }}
          </p>
        </div>
      </section>
    </div>

    <div class="ir-col">
      <section class="cw-card" aria-labelledby="ir-m">
        <div class="cw-card-head"><h3 id="ir-m"><CreditCard :size="26" class="cw-head-icon" aria-hidden="true" /> Payment Method</h3></div>
        <div class="cw-card-body ir-stack">
          <MethodTiles v-model="method" />
          <template v-if="!isCash">
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
          <div v-else class="ir-tender">
            <label class="cw-field">
              <span class="cw-label">Amount Received <span class="req">*</span></span>
              <input v-model="tendered" class="cw-input num" inputmode="decimal" autocomplete="off" />
            </label>
            <div class="cw-field">
              <span class="cw-label">Change</span>
              <output class="ir-change num" :class="{ 'is-neg': (changeCents ?? 0n) < 0n }">{{ changeCents === null ? '—' : money(changeCents < 0n ? -changeCents : changeCents) }}</output>
            </div>
          </div>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ir-p">
        <div class="cw-card-head"><h3 id="ir-p"><ReceiptText :size="26" class="cw-head-icon" aria-hidden="true" /> Payment Summary</h3></div>
        <div class="cw-card-body">
          <dl class="cw-kv">
            <div><dt>Customer</dt><dd>{{ payer || '—' }}</dd></div>
            <div><dt>Items</dt><dd>{{ lines.filter((l) => l.income_code_id).length }}</dd></div>
            <div><dt>Payment Amount</dt><dd class="cw-accent" style="font-size: 18px; font-weight: 800">{{ money(totalCents) }}</dd></div>
          </dl>
        </div>
      </section>

      <p v-if="attempted && problem" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ problem }}</p>
      <div class="ir-buttons">
        <RouterLink :to="{ name: 'cashier-dashboard' }" class="cw-btn cw-btn--lg"><X :size="20" aria-hidden="true" /> Cancel</RouterLink>
        <button type="button" class="cw-btn cw-btn--primary cw-btn--lg" :disabled="busy || !canTakePayment || !canReceipt" @click="issue">
          <Check :size="20" aria-hidden="true" /> {{ busy ? 'Issuing…' : 'Issue Receipt' }}
        </button>
      </div>
    </div>
  </div>
  <ReceiptOutput ref="output" />
</template>

<style scoped>
.ir-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr); gap: 18px; align-items: start; }
.ir-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.ir-stack { display: flex; flex-direction: column; gap: 14px; }
.ir-person > summary { cursor: pointer; margin-bottom: 8px; }
.ir-tender { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ir-change { display: flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 8px; background: var(--cw-pos-soft); color: var(--cw-pos); font-size: 17px; font-weight: 800; }
.ir-change.is-neg { background: var(--cw-neg-soft); color: var(--cw-neg); }
.ir-buttons { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.ir-done { display: flex; flex-direction: column; gap: 16px; max-width: 900px; }
.ir-app { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.ir-app > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ir-app-sub { color: var(--cw-text-2, inherit); font-size: 14px; }
.ir-app-warn { display: inline-flex; align-items: center; gap: 6px; color: var(--cw-neg); font-size: 14px; font-weight: 600; }
.ir-search { position: relative; display: flex; align-items: center; }
.ir-search svg { position: absolute; left: 10px; opacity: 0.6; }
.ir-search input { padding-left: 32px; width: 100%; }
.ir-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ir-hit { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'ref tag' 'who tag'; gap: 2px 12px; text-align: left; padding: 10px 12px; border: 1px solid var(--cw-line, #d0d5dd); border-radius: 8px; background: var(--cw-surface, #fff); cursor: pointer; font: inherit; color: inherit; }
.ir-hit:hover, .ir-hit:focus-visible { border-color: var(--cw-accent, #1a73e8); }
.ir-hit strong { grid-area: ref; }
.ir-hit > span:not(.ir-hit-tag) { grid-area: who; font-size: 14px; opacity: 0.8; }
.ir-hit-tag { grid-area: tag; align-self: center; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--cw-neg-soft); color: var(--cw-neg); white-space: nowrap; }
.ir-hit-tag.is-paid { background: var(--cw-pos-soft); color: var(--cw-pos); }
.ir-kinds { margin: 0; font-size: 14px; }
.cw-muted { margin: 0; color: var(--cw-text-2, #5b6472); font-size: 14px; }
@media (max-width: 1023px) { .ir-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
