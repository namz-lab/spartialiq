<script setup lang="ts">
/**
 * The journal editor: one page for a new journal, a copy of an existing voucher (`?from=<id>`) and a
 * draft being changed (`/journals/:id/edit`). Debit and Credit are two ruled columns; the running
 * balance is a guide in exact cents from `journalMath` (the only money sum the browser does) and the
 * server's figures replace it on save. Every refusal below names the line at fault.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookOpenText, AlertTriangle, Plus, X, Scale } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { centsToText } from '../../../composables/cashMath'
import { formatMoney } from '../../../composables/useMoney'
import { balancingAmount, guide, lineState, parseAmount } from '../kit/journalMath'
import { useLedgerLists } from '../kit/useLedgerLists'
import AccountPicker from '../kit/AccountPicker.vue'
import PartyPicker from '../kit/PartyPicker.vue'
import BookSwitch from '../kit/BookSwitch.vue'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'
import type { AccountingCreatableType, VoucherLineBody } from '../../../models/ledgerTypes'
import type { Currency } from '../../../models/types'

interface EdLine {
  key: number
  ledger_account_id: string
  party_id: string
  debit: string
  credit: string
  narration: string
  department_id: string
  project_id: string
  /** Not edited here; carried through so that saving a draft does not erase them. */
  programme_id: string
  activity_id: string
  ward_code: string
  budget_line_id: string
  against_voucher_id: string
}

/** Only the types a person may type. A rates bill, receipt or closing voucher is raised by its own workspace. */
const TYPES: Array<{ id: AccountingCreatableType; label: string }> = [
  { id: 'journal', label: 'Journal' },
  { id: 'opening', label: 'Opening balance' },
  { id: 'credit_note', label: 'Credit note' },
  { id: 'write_off', label: 'Write-off' },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const route = useRoute()
const router = useRouter()
const store = useFinanceStore()
const lists = useLedgerLists()

const editId = computed(() => (route.name === 'acc-journal-edit' ? String(route.params.id) : null))
const fromId = computed(() => (typeof route.query.from === 'string' ? route.query.from : null))

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let serial = 0
const blankLine = (): EdLine => ({ key: ++serial, ledger_account_id: '', party_id: '', debit: '', credit: '', narration: '', department_id: '', project_id: '', programme_id: '', activity_id: '', ward_code: '', budget_line_id: '', against_voucher_id: '' })

const yearId = computed(() => store.selectedYearId)
const form = reactive({ voucher_no: '', voucher_type: 'journal' as AccountingCreatableType, posting_date: today(), reference: '', narration: '' })
const currency = ref<Currency>('USD')
const lines = ref<EdLine[]>([blankLine(), blankLine()])
const showAnalysis = ref(false)

const loading = ref(Boolean(store.selectedYearId))
const loadError = ref<string | null>(null)
const blocked = ref<string | null>(null)
const voucherNo = ref<string | null>(null)
const problems = ref<string[]>([])
const problemsEl = ref<HTMLElement | null>(null)
const saveError = ref<string | null>(null)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const postable = computed(() => lists.accounts.value.filter(a => a.is_postable))
const accountById = (id: string) => lists.accounts.value.find(a => a.id === id)
const isEdit = computed(() => editId.value !== null)

const gd = computed(() => guide(lines.value.map(l => ({ debit: l.debit, credit: l.credit }))))
const hasAmounts = computed(() => gd.value.debit !== '0.00' || gd.value.credit !== '0.00')
const guideFigures = computed(() => `Debits ${gd.value.debit} · Credits ${gd.value.credit} · `)
const guideText = computed(() => {
  const g = gd.value
  if (g.unreadable > 0) return `${g.unreadable} ${g.unreadable === 1 ? 'line' : 'lines'} unreadable`
  if (g.inBalance) return 'In balance'
  if (!hasAmounts.value) return 'No amounts yet'
  return `Out of balance by ${g.difference.replace(/^-/, '')}`
})
// Announced to screen readers only when the result changes and typing has paused, or on a save attempt.
const announced = ref('')
let announceTimer: ReturnType<typeof setTimeout> | undefined
watch(guideText, () => {
  clearTimeout(announceTimer)
  announceTimer = setTimeout(() => { announced.value = `${guideFigures.value}${guideText.value}` }, 900)
})
onBeforeUnmount(() => clearTimeout(announceTimer))
const unbalanced = computed(() => gd.value.unreadable === 0 && hasAmounts.value && !gd.value.inBalance)

const period = computed(() => lists.periodFor(form.posting_date))
const periodText = computed(() => {
  const p = period.value
  if (!p) return 'No period covers this date'
  const m = Number(p.from_date.slice(5, 7))
  const base = `Period ${p.period_no} · ${MONTHS[m - 1] ?? ''} ${p.from_date.slice(0, 4)} · `
  if (p.status === 'open') return `${base}open`
  if (p.status === 'locked') return `${base}locked: nothing can be posted into it`
  return `${base}${p.status}: a draft may be saved but cannot be posted until it is reopened`
})

function fromServer(v: string): string { return parseAmount(v) === 0n ? '' : v }
function fillFrom(d: Awaited<ReturnType<typeof ledgerApi.voucher>>, copy = false): void {
  lines.value = d.lines.map(l => ({
    key: ++serial, ledger_account_id: l.ledger_account_id, party_id: l.party_id ?? '',
    debit: fromServer(l.debit), credit: fromServer(l.credit), narration: l.narration ?? '',
    department_id: l.department_id ?? '', project_id: l.project_id ?? '',
    programme_id: l.programme_id ?? '', activity_id: l.activity_id ?? '', ward_code: l.ward_code ?? '',
    budget_line_id: l.budget_line_id ?? '', against_voucher_id: copy ? '' : (l.against_voucher_id ?? ''),
  }))
  while (lines.value.length < 2) lines.value.push(blankLine())
  form.narration = d.voucher.narration ?? ''
  form.reference = d.voucher.reference ?? ''
  currency.value = d.voucher.currency
  showAnalysis.value = lines.value.some(l => l.department_id || l.project_id)
}

/** Each init takes a number; a slower earlier one (a year changed mid-load) must not write the form. */
let initId = 0
async function init(): Promise<void> {
  const seq = ++initId
  loadError.value = null
  blocked.value = null
  if (!yearId.value) return
  loading.value = true
  try {
    await Promise.all([lists.loadAccounts(), lists.loadParties(), lists.loadPeriods(yearId.value)])
    if (seq !== initId) return
    if (lists.error.value) { loadError.value = lists.error.value; return }
    if (editId.value) {
      const d = await ledgerApi.voucher(editId.value)
      if (seq !== initId) return
      if (d.voucher.status !== 'draft') {
        blocked.value = 'Only a draft can be edited. A posted voucher is corrected by a reversal, never edited.'
        return
      }
      if (d.source) {
        blocked.value = 'This draft was raised from another document and is changed there.'
        return
      }
      if (d.voucher.voucher_type === 'reversal') {
        blocked.value = 'A reversal keeps the reason and the lines it was raised with, so its lines cannot be edited. Cancel it and raise the reversal again to change it.'
        return
      }
      if (d.voucher.prepared_by !== store.identity?.user_id) {
        blocked.value = 'Only the person who prepared this draft may change it. Copy it into a new draft of your own instead.'
        return
      }
      if (d.voucher.voucher_type === 'closing') {
        blocked.value = 'A year-end closing is built from the books, so its lines cannot be edited. Its preparer may cancel it, then raise the closing again from Period Close.'
        return
      }
      voucherNo.value = d.voucher.voucher_no
      form.voucher_type = d.voucher.voucher_type as AccountingCreatableType
      form.posting_date = d.voucher.posting_date.slice(0, 10)
      fillFrom(d)
    } else {
      currency.value = store.selectedYear?.reporting_currency ?? 'USD'
      const t = typeof route.query.type === 'string' ? route.query.type : ''
      if (TYPES.some(x => x.id === t)) form.voucher_type = t as AccountingCreatableType
      if (fromId.value) {
        const d = await ledgerApi.voucher(fromId.value)
        if (seq !== initId) return
        form.voucher_type = 'journal'
        form.posting_date = today()
        fillFrom(d, true)
      }
    }
  } catch (err) {
    if (seq !== initId) return
    loadError.value = messageOf(err, 'The journal could not be loaded.')
  } finally {
    if (seq === initId) loading.value = false
  }
}
onMounted(init)
watch(yearId, init)

function addLine(): void {
  lines.value.push(blankLine())
  const n = lines.value.length
  void nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-line="${n}"] input[role="combobox"]`)?.focus())
}
function removeLine(i: number): void { if (lines.value.length > 2) lines.value.splice(i, 1) }

function balanceHere(i: number): void {
  const l = lines.value[i]
  if (lineState(l) !== 'empty') return
  const b = balancingAmount(lines.value.map(x => ({ debit: x.debit, credit: x.credit })), i)
  if (!b) return
  l[b.side] = b.amount
}
const canBalance = (i: number) => lineState(lines.value[i]) === 'empty' && balancingAmount(lines.value.map(x => ({ debit: x.debit, credit: x.credit })), i) !== null

function onRowKey(e: KeyboardEvent, i: number): void {
  if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); balanceHere(i) }
}
function onNarrationEnter(i: number): void {
  if (i === lines.value.length - 1) addLine()
}

const isBlankLine = (l: EdLine) => !l.ledger_account_id && lineState(l) === 'empty'

function check(): string[] {
  const out: string[] = []
  if (lines.value.filter(l => !isBlankLine(l)).length < 2) out.push('A journal needs at least two lines.')
  lines.value.forEach((l, i) => {
    const n = i + 1
    if (isBlankLine(l)) return
    const st = lineState(l)
    if (st === 'both') out.push(`Line ${n} has both a debit and a credit.`)
    else if (st === 'unreadable') {
      const bad = parseAmount(l.debit) === null && l.debit.trim() !== '' ? l.debit : l.credit
      const hint = bad.replace(/,/g, '').replace(/[^\d.]/g, '').trim()
      out.push(`Line ${n}: write the amount as ${/^\d+(\.\d{1,2})?$/.test(hint) ? hint : '1250.50'}.`)
    } else if (st === 'empty') out.push(`Line ${n} has an account but no amount.`)
    else if (parseAmount(st === 'debit' ? l.debit : l.credit) === 0n) out.push(`Line ${n} has an amount of nil.`)
    if (!l.ledger_account_id) { if (st !== 'empty') out.push(`Line ${n} has an amount but no account.`); return }
    const t = accountById(l.ledger_account_id)?.account_type
    if ((t === 'receivable' || t === 'payable') && !l.party_id) out.push(`Line ${n} is on a control account and needs its party.`)
  })
  return out
}

function bodyLines(): VoucherLineBody[] {
  return lines.value.filter(l => !isBlankLine(l)).map(l => {
    const side = lineState(l) === 'debit' ? 'debit' : 'credit'
    const b: VoucherLineBody = { ledger_account_id: l.ledger_account_id, [side]: centsToText(parseAmount(l[side]) ?? 0n) }
    if (l.party_id) b.party_id = l.party_id
    if (l.department_id) b.department_id = l.department_id
    if (l.project_id) b.project_id = l.project_id
    if (l.programme_id) b.programme_id = l.programme_id
    if (l.activity_id) b.activity_id = l.activity_id
    if (l.ward_code) b.ward_code = l.ward_code
    if (l.budget_line_id) b.budget_line_id = l.budget_line_id
    if (l.against_voucher_id) b.against_voucher_id = l.against_voucher_id
    if (l.narration.trim()) b.narration = l.narration.trim()
    return b
  })
}

async function save(): Promise<void> {
  if (busy.value || !yearId.value) return
  saveError.value = null
  problems.value = check()
  clearTimeout(announceTimer)
  announced.value = `${guideFigures.value}${guideText.value}`
  if (problems.value.length) { await nextTick(); problemsEl.value?.focus({ preventScroll: true }); return }
  busy.value = true
  try {
    let id: string
    let note: string | undefined
    if (editId.value) {
      await ledgerApi.updateVoucher(editId.value, {
        posting_date: form.posting_date, narration: form.narration.trim() || null, reference: form.reference.trim() || null, lines: bodyLines(),
      })
      id = editId.value
    } else {
      const res = await ledgerApi.createVoucher({
        ...(form.voucher_no.trim() ? { voucher_no: form.voucher_no.trim() } : {}),
        voucher_type: form.voucher_type, currency: currency.value, financial_year_id: yearId.value,
        posting_date: form.posting_date,
        ...(form.narration.trim() ? { narration: form.narration.trim() } : {}),
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        lines: bodyLines(),
      })
      id = res.voucher.id
      note = res.note
    }
    await router.replace({ name: 'acc-voucher', params: { id }, state: { note: note ?? null } })
  } catch (err) {
    saveError.value = messageOf(err, 'The draft could not be saved.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><BookOpenText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ isEdit ? 'Edit draft' : 'New journal' }}</h2>
      <p>Prepare a journal for posting. A draft posts nothing; someone other than its preparer posts it.</p>
    </div>
  </section>

  <p v-if="!yearId" class="cw-empty"><strong>Choose a financial year in the banner above.</strong>A journal is prepared in one financial year.</p>

  <template v-else>
    <p v-if="loadError" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ loadError }}
      <button type="button" class="cw-btn cw-btn--small" @click="init">Retry</button>
    </p>
    <p v-else-if="blocked" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ blocked }}
      <router-link v-if="editId" class="cw-btn cw-btn--small" :to="{ name: 'acc-voucher', params: { id: editId } }">Back to the voucher</router-link>
    </p>
    <CwSkeleton v-else-if="loading" label="the journal" />
    <p v-else-if="!postable.length" class="cw-empty">
      <strong>The chart of accounts has no account that can be posted to.</strong>
      Accounts are set up under <router-link :to="{ name: 'acc-ledger' }">General Ledger</router-link>.
    </p>

    <section v-else ref="root" class="cw-card je">
      <form class="cw-card-body je-body" novalidate @submit.prevent="save">
        <div class="je-top">
          <div class="cw-field"><label class="cw-label" for="je-number">Number</label>
            <input v-if="isEdit" id="je-number" class="cw-input" :value="voucherNo ?? ''" readonly />
            <input v-else id="je-number" v-model="form.voucher_no" class="cw-input" type="text" autocomplete="off" placeholder="Issued on save" />
          </div>
          <div class="cw-field"><label class="cw-label" for="je-type">Type</label>
            <select id="je-type" v-model="form.voucher_type" class="cw-select" :disabled="isEdit">
              <option v-for="t in TYPES" :key="t.id" :value="t.id">{{ t.label }}</option>
              <option v-if="!TYPES.some(t => t.id === form.voucher_type)" :value="form.voucher_type">{{ VOUCHER_TYPE_LABEL[form.voucher_type] ?? form.voucher_type }}</option>
            </select>
          </div>
          <div class="cw-field"><label class="cw-label" for="je-date">Date</label>
            <input id="je-date" v-model="form.posting_date" class="cw-input" type="date" required />
          </div>
          <div class="cw-field"><label class="cw-label" for="je-ref">Reference</label>
            <input id="je-ref" v-model="form.reference" class="cw-input" type="text" autocomplete="off" />
          </div>
          <div class="cw-field"><span class="cw-label" id="je-book">Book</span>
            <strong v-if="isEdit">{{ currency }}</strong>
            <BookSwitch v-else v-model="currency" label="Book" />
          </div>
        </div>
        <p v-if="!isEdit" class="je-hint">Rates bills, receipts and year-end closing are raised by Revenue &amp; Billing, the Cash Office and Period Close, so they are not offered here.</p>
        <p class="je-period" data-testid="period" role="status">{{ periodText }}</p>
        <div class="cw-field"><label class="cw-label" for="je-narr">Narration</label>
          <input id="je-narr" v-model="form.narration" class="cw-input" type="text" autocomplete="off" />
        </div>

        <div class="cw-table-wrap">
          <table class="cw-table je-table">
            <caption class="sr-only">Journal lines</caption>
            <thead>
              <tr>
                <th>#</th><th>Account</th><th>Party</th>
                <th v-if="showAnalysis">Department</th>
                <th class="amt">Debit</th><th class="amt">Credit</th><th>Narration</th><th><span class="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in lines" :key="l.key" :data-line="i + 1" @keydown="onRowKey($event, i)">
                <td>{{ i + 1 }}</td>
                <td class="je-cell"><AccountPicker v-model="l.ledger_account_id" :accounts="postable" :label="`Account, line ${i + 1}`" /></td>
                <td class="je-cell"><PartyPicker v-model="l.party_id" :parties="lists.parties.value" :label="`Party, line ${i + 1}`" placeholder="Party" /></td>
                <td v-if="showAnalysis" class="je-cell">
                  <label class="sr-only" :for="`je-dep-${l.key}`">Department, line {{ i + 1 }}</label>
                  <select :id="`je-dep-${l.key}`" v-model="l.department_id" class="cw-select">
                    <option value="">None</option>
                    <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">{{ d.code }} · {{ d.name }}</option>
                  </select>
                </td>
                <td class="amt">
                  <label class="sr-only" :for="`je-dr-${l.key}`">Debit, line {{ i + 1 }}</label>
                  <input :id="`je-dr-${l.key}`" v-model="l.debit" data-field="debit" class="cw-input amt" inputmode="decimal" autocomplete="off" placeholder="0.00"
                    :aria-invalid="lineState(l) === 'unreadable' || lineState(l) === 'both' ? 'true' : undefined" :aria-describedby="problems.length ? 'je-problems' : undefined" />
                </td>
                <td class="amt">
                  <label class="sr-only" :for="`je-cr-${l.key}`">Credit, line {{ i + 1 }}</label>
                  <input :id="`je-cr-${l.key}`" v-model="l.credit" data-field="credit" class="cw-input amt" inputmode="decimal" autocomplete="off" placeholder="0.00"
                    :aria-invalid="lineState(l) === 'unreadable' || lineState(l) === 'both' ? 'true' : undefined" />
                  <button v-if="canBalance(i)" type="button" class="cw-btn cw-btn--small je-bal" :aria-label="`Balance on this line, line ${i + 1}`" @click="balanceHere(i)">
                    <Scale :size="14" aria-hidden="true" /> Balance on this line
                  </button>
                </td>
                <td>
                  <label class="sr-only" :for="`je-nr-${l.key}`">Narration, line {{ i + 1 }}</label>
                  <input :id="`je-nr-${l.key}`" v-model="l.narration" data-field="narration" class="cw-input" autocomplete="off"
                    @keydown.enter.prevent="onNarrationEnter(i)" />
                </td>
                <td>
                  <button v-if="lines.length > 2" type="button" class="cw-btn cw-btn--small" :aria-label="`Remove line ${i + 1}`" @click="removeLine(i)"><X :size="14" aria-hidden="true" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="je-tools">
          <button type="button" class="cw-btn" data-testid="add-line" @click="addLine"><Plus :size="16" aria-hidden="true" /> Add a line</button>
          <label class="je-check"><input v-model="showAnalysis" type="checkbox" /> Show analysis columns (department)</label>
        </div>

        <div class="je-guide" data-testid="guide">
          <span><strong>{{ guideFigures }}</strong><strong>{{ guideText }}</strong></span>
          <span class="sr-only" data-testid="guide-live" aria-live="polite">{{ announced }}</span>
          <small>A guide while you type. The exact figures are computed when the draft is saved.</small>
        </div>
        <p v-if="unbalanced" class="cw-banner-msg"><AlertTriangle :size="18" aria-hidden="true" />This draft does not balance, so it can be saved but not posted.</p>

        <div v-if="problems.length" id="je-problems" ref="problemsEl" tabindex="-1" class="cw-banner-msg cw-banner-msg--neg" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />
          <ul class="je-problems"><li v-for="p in problems" :key="p">{{ p }}</li></ul>
        </div>
        <p v-if="saveError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ saveError }}</p>

        <div class="je-actions">
          <router-link class="cw-btn" :to="isEdit && editId ? { name: 'acc-voucher', params: { id: editId } } : { name: 'acc-journals' }">Cancel</router-link>
          <button type="submit" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined">{{ busy ? 'Saving…' : 'Save draft' }}</button>
        </div>
      </form>
    </section>
  </template>
</template>

<style scoped>
.je-body { display: flex; flex-direction: column; gap: 14px; padding-top: 18px; }
.je-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; align-items: end; }
.je-hint, .je-period { margin: 0; font-size: 13.5px; }
.je-table { min-width: 880px; }
.je-cell { min-width: 190px; }
.je-cell :deep(.cw-label) { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.je-table input.amt { text-align: right; font-variant-numeric: tabular-nums; min-width: 110px; }
.je-bal { margin-top: 4px; white-space: nowrap; }
.je-tools { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.je-check { display: inline-flex; gap: 6px; align-items: center; font-size: 13.5px; }
.je-guide { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
.je-guide small { color: var(--cw-ink-3); }
.je-problems { margin: 0; padding-left: 18px; }
.je-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
</style>
