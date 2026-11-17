<script setup lang="ts">
/**
 * A two-line draft voucher raised from a document (a Payment, a Receipt, a Transfer, and later a
 * credit note or a tax payment). The account the person is working in is fixed on one side; the
 * counter account is chosen. The voucher is saved as a DRAFT with no number of ours: the server
 * numbers it and somebody other than the preparer posts it.
 *
 * The server's refusal is shown as sent. The only checks made here are the ones that save a round
 * trip and can be said in words: the amount is readable, positive and, with `against.max`, not
 * more than may be applied. Amounts are compared in exact integer cents.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { AlertTriangle, CircleCheck, Info } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { CreatableVoucherType, LedgerAccount, PartyType, VoucherLineBody } from '../../../models/ledgerTypes'
import CwDialog from '../../shared/CwDialog.vue'
import AccountPicker from './AccountPicker.vue'
import PartyPicker from './PartyPicker.vue'
import { useLedgerLists } from './useLedgerLists'
import { parseAmount } from './journalMath'
import { centsToText } from '../../../composables/cashMath'

const props = defineProps<{
  title: string
  lead: string
  currency: Currency
  fixed: { ledger_account_id: string; side: 'debit' | 'credit'; label: string }
  counter: { label: string; filter: (a: LedgerAccount) => boolean; partyTypes?: PartyType[] }
  voucherType?: CreatableVoucherType
  against?: { voucher_id: string; voucher_no: string; max?: string }
  /** Which line carries party_id and against_voucher_id: the counter line (default) or the fixed one. */
  partyOn?: 'fixed' | 'counter'
  /** A party chosen in advance (a statement is for one party): shown read-only, not pickable. */
  party?: { id: string; name: string }
  /** The button that opened the dialog, to take focus back on close. */
  opener?: HTMLElement | null
}>()
const emit = defineEmits<{
  (e: 'saved', voucher: { id: string; voucher_no: string }): void
  (e: 'close'): void
  /** True while a save is in flight, so a host does not unmount the dialog under it. */
  (e: 'busy', busy: boolean): void
  /** A save was refused or failed; the message is the one the dialog shows. */
  (e: 'failed', message: string): void
}>()

const store = useFinanceStore()
const { accounts, parties, periods, loadAccounts, loadParties, loadPeriods, periodFor, error: listError } = useLedgerLists()

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const date = ref(localToday())
function onDate(): void { dateTouched = true }
const amount = ref('')
const counterId = ref('')
const partyId = ref(props.party?.id ?? '')
const reference = ref('')
const narration = ref('')
const busy = ref(false)
watch(busy, v => emit('busy', v))
const refusal = ref<string | null>(null)
const problems = ref<string[]>([])
/** The closed-period sentence is already said by the banner above; the list does not repeat it (S2). */
const shownProblems = computed(() => problems.value.filter(p => !p.startsWith('No accounting period is open')))
const amountInvalid = computed(() => {
  const a = readAmount(amount.value)
  return problems.value.some(p => ('say' in a && p === a.say) || p.startsWith('More than the') || p.startsWith('The most that can'))
})
const saved = ref<{ id: string; voucher_no: string } | null>(null)

const closeBtn = ref<HTMLButtonElement | null>(null)
let dateTouched = false

const counterAccounts = computed(() => accounts.value.filter(a => a.is_postable && !a.is_group && props.counter.filter(a)))
const counterAccount = computed(() => accounts.value.find(a => a.id === counterId.value) ?? null)
const needsParty = computed(() => !!props.against || counterAccount.value?.account_type === 'receivable' || counterAccount.value?.account_type === 'payable')
const filterFn = (a: LedgerAccount): boolean => a.is_postable && !a.is_group && props.counter.filter(a)

const period = computed(() => periodFor(date.value))
const periodsFailed = ref(false)
const periodOpen = computed(() => !periodsFailed.value && period.value?.status === 'open')

// Focus in (the date), the Tab trap, Esc and the backdrop (both ignored while busy) and the focus
// return to `opener` are CwDialog's.
onMounted(async () => {
  void loadAccounts()
  void loadParties()
  // The periods are read afresh each time: a period closed elsewhere must not read as open here.
  // A failed reload leaves the earlier list in place; it is not trusted.
  if (store.selectedYearId) periodsFailed.value = !(await loadPeriods(store.selectedYearId))
  if (!dateTouched && !periodsFailed.value) date.value = defaultDate()
})
/** Today when today's period is open, otherwise the end of the latest open period. */
function defaultDate(): string {
  const today = localToday()
  if (periodFor(today)?.status === 'open') return today
  const open = periods.value.filter(p => p.status === 'open').map(p => p.to_date).sort()
  return open.length ? open[open.length - 1] : today
}
function close(): void {
  // A save in flight is not abandoned: its confirmation must not be lost.
  if (busy.value) return
  emit('close')
}

/** The sentence for an amount that cannot be used, or null with its cents. */
function readAmount(text: string): { cents: bigint } | { say: string } {
  const t = text.trim()
  if (t === '') return { say: 'Enter the amount.' }
  const cents = parseAmount(t)
  if (cents === null) {
    if (t.includes(',')) return { say: 'Write the amount without commas, for example 1250.50.' }
    if (t.startsWith('-')) return { say: 'The amount cannot be negative.' }
    if (/^\d+\.\d{3,}$/.test(t)) return { say: 'Give the amount to two decimal places at most.' }
    return { say: 'The amount is not a number that can be read. Write it as 1250.50.' }
  }
  if (cents === 0n) return { say: 'The amount must be more than zero.' }
  return { cents }
}

function check(): string[] {
  const out: string[] = []
  if (periodsFailed.value) out.push('The accounting periods could not be read, so the date cannot be checked. Nothing was saved.')
  else if (!periodOpen.value) out.push('No accounting period is open for this date. Choose a date in an open period.')
  const a = readAmount(amount.value)
  if ('say' in a) out.push(a.say)
  else if (props.against?.max !== undefined) {
    const max = parseAmount(props.against.max)
    if (max === null) out.push(`The most that can be applied to ${props.against.voucher_no} could not be read, so the amount cannot be checked. Nothing was saved.`)
    else if (a.cents > max) {
      out.push(`More than the ${formatMoney(props.against.max, props.currency)} still open on ${props.against.voucher_no}.`)
    }
  }
  if (!counterId.value) out.push(`Choose the ${props.counter.label.toLowerCase()}.`)
  if (needsParty.value && !partyId.value) out.push('Choose the party this is for.')
  return out
}

async function save(): Promise<void> {
  if (busy.value || saved.value) return
  refusal.value = null
  problems.value = check()
  if (problems.value.length) return
  const money = centsToText(parseAmount(amount.value) as bigint)
  const counterLine: VoucherLineBody = { ledger_account_id: counterId.value }
  const fixedLine: VoucherLineBody = { ledger_account_id: props.fixed.ledger_account_id }
  if (props.fixed.side === 'credit') { counterLine.debit = money; fixedLine.credit = money }
  else { counterLine.credit = money; fixedLine.debit = money }
  const partyLine = props.partyOn === 'fixed' ? fixedLine : counterLine
  if (needsParty.value && partyId.value) partyLine.party_id = partyId.value
  if (props.against) partyLine.against_voucher_id = props.against.voucher_id
  const lines = props.fixed.side === 'credit' ? [counterLine, fixedLine] : [fixedLine, counterLine]
  busy.value = true
  try {
    const body = {
      voucher_type: props.voucherType ?? 'journal',
      currency: props.currency,
      financial_year_id: store.selectedYearId as string,
      posting_date: date.value,
      lines,
      ...(narration.value.trim() ? { narration: narration.value.trim() } : {}),
      ...(reference.value.trim() ? { reference: reference.value.trim() } : {}),
    }
    const res = await ledgerApi.createVoucher(body)
    saved.value = { id: res.voucher.id, voucher_no: res.voucher.voucher_no }
    emit('saved', saved.value)
    // The Save button is about to go: keep focus inside the dialog.
    await nextTick()
    closeBtn.value?.focus()
  } catch (err) {
    refusal.value = messageOf(err, 'The voucher could not be saved.')
    emit('failed', refusal.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <CwDialog :title="title" :busy="busy" :opener="opener" :backdrop-close="false" @close="close">
    <template v-if="!saved" #describe>
      <p class="gj-lead"><Info :size="16" aria-hidden="true" /><span>{{ lead }} <slot name="lead" /></span></p>
    </template>
        <div role="status" aria-live="polite">
          <p v-if="saved" class="cw-banner-msg"><CircleCheck :size="18" aria-hidden="true" />
            <span><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: saved.id } }">{{ saved.voucher_no }}</RouterLink> saved as a draft. Somebody other than you posts it.</span></p>
        </div>
        <template v-if="!saved">
          <p v-if="!periodOpen && !periodsFailed" class="cw-banner-msg cw-banner-msg--neg" role="status"><AlertTriangle :size="18" aria-hidden="true" />No accounting period is open for this date. Choose a date in an open period.</p>
          <p v-if="listError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ listError }}</p>

          <div class="cw-field"><span class="cw-label">{{ fixed.side === 'credit' ? 'Credited' : 'Debited' }} account</span>
            <strong>{{ fixed.label }}</strong></div>
          <div class="cw-field"><label class="cw-label" for="gj-date">Date</label>
            <input id="gj-date" v-model="date" data-autofocus class="cw-input" type="date" required @input="onDate" /></div>
          <div class="cw-field"><label class="cw-label" for="gj-amount">Amount ({{ currency }})</label>
            <input id="gj-amount" v-model="amount" class="cw-input amt" :aria-describedby="against?.max ? 'gj-amount-hint' : undefined" :aria-invalid="amountInvalid ? 'true' : undefined" inputmode="decimal" autocomplete="off" placeholder="0.00" />
            <span v-if="against?.max" id="gj-amount-hint" class="cw-hint">Up to {{ formatMoney(against.max, currency) }} can be applied to {{ against.voucher_no }}.</span></div>
          <AccountPicker v-model="counterId" :accounts="accounts" :filter="filterFn" :label="counter.label" />
          <div v-if="needsParty && party" class="cw-field"><span class="cw-label">Party</span><strong>{{ party.name }}</strong></div>
          <PartyPicker v-else-if="needsParty" v-model="partyId" :parties="parties" :types="counter.partyTypes" label="Party" />
          <div class="cw-field"><label class="cw-label" for="gj-ref">Reference</label>
            <input id="gj-ref" v-model="reference" class="cw-input" type="text" autocomplete="off" /></div>
          <div class="cw-field"><label class="cw-label" for="gj-narr">Narration</label>
            <input id="gj-narr" v-model="narration" class="cw-input" type="text" autocomplete="off" /></div>

          <ul v-if="shownProblems.length" class="cw-banner-msg cw-banner-msg--neg gj-problems" role="alert">
            <li v-for="p in shownProblems" :key="p">{{ p }}</li>
          </ul>
          <p v-if="refusal" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ refusal }}</p>
        </template>
      <template #footer>
        <button ref="closeBtn" type="button" class="cw-btn" :aria-disabled="busy || undefined" @click="close">{{ saved ? 'Close' : 'Cancel' }}</button>
        <button v-if="!saved" type="button" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined" @click="save">{{ busy ? 'Saving' : 'Save as draft' }}</button>
      </template>
  </CwDialog>
</template>

<style scoped>
.gj-lead { display: flex; gap: 8px; margin: 0; color: var(--cw-ink-2); font-size: 13.5px; }
.gj-lead svg { flex: none; margin-top: 2px; }
.gj-problems { margin: 0; padding-left: 28px; }
</style>
