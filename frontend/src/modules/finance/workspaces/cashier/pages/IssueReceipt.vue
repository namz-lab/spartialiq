<script setup lang="ts">
/**
 * Receipt a service that has no bill: one or more items from the council's income list (a dog
 * licence, a day's hall hire, a market stall fee). A fixed charge is the council's and cannot be
 * changed here; a variable one is entered. Issued by `POST /finance/cash/receipts`.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { FileText, Plus, Trash2, User, CreditCard, ReceiptText, Printer, Download, X, Check, AlertTriangle, CircleCheck } from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { centsToText, lineCents, toCents } from '../../../composables/cashMath'
import { chargeIn, receiptableIn, type CashMethod, type CashReceipt } from '../../../models/cashTypes'
import { useCashier } from '../useCashier'
import { tenderNarration, viewOfPrintable, type ReceiptView } from '../receipt'
import MethodTiles from '../components/MethodTiles.vue'
import TillNotice from '../components/TillNotice.vue'
import ReceiptDocument from '../components/ReceiptDocument.vue'
import ReceiptOutput from '../components/ReceiptOutput.vue'

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
const tenderedCents = computed(() => (isCash.value ? toCents(tendered.value.replace(/,/g, '')) : totalCents.value))
const changeCents = computed(() => (isCash.value && tenderedCents.value !== null && totalCents.value !== null ? tenderedCents.value - totalCents.value : null))
watch(totalCents, (t) => { if (t !== null && (!tendered.value || attempted.value === false)) tendered.value = centsToText(t) })

const problem = computed<string | null>(() => {
  if (payer.value.trim().length < 2) return 'Enter who is paying.'
  if (lines.value.some((l) => !l.income_code_id)) return 'Choose what each line is for.'
  if (!totalCents.value) return 'Enter an amount for each line.'
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
    const result = await cashApi.issueReceipt({
      session_id: session.value.id,
      payer_name: payer.value.trim(),
      currency: currency.value,
      method: method.value,
      lines: lines.value.map((l) => ({
        income_code_id: l.income_code_id,
        ...(l.quantity.trim() && l.quantity.trim() !== '1' ? { quantity: l.quantity.trim() } : {}),
        ...(fixed(l) ? {} : { unit_amount: l.unit_amount.trim() }),
      })),
      ...(isCash.value ? {} : { deposit_account_id: depositAccount.value, method_reference: reference.value.trim() }),
      ...(tenderedText && changeText ? { narration: tenderNarration(tenderedText, changeText) } : {}),
    })
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
  payer.value = ''
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
                    <option v-for="c in codes" :key="c.id" :value="c.id">{{ c.name }}</option>
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
.ir-tender { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ir-change { display: flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 8px; background: var(--cw-pos-soft); color: var(--cw-pos); font-size: 17px; font-weight: 800; }
.ir-change.is-neg { background: var(--cw-neg-soft); color: var(--cw-neg); }
.ir-buttons { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.ir-done { display: flex; flex-direction: column; gap: 16px; max-width: 900px; }
@media (max-width: 1023px) { .ir-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
