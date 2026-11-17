<script setup lang="ts">
/**
 * The salaries journal: the month's payroll totals as ONE draft `payroll` voucher, numbered SJ- by
 * the server. Not a payroll module (decision D21 keeps one deliberately unbuilt): whoever computes
 * the salaries types the totals — gross and the employer's contributions debited, PAYE, NSSA and
 * the other deductions credited, the net paid taken off the bank — and a second person posts it.
 *
 * The standard legs are named for the Zimbabwean month: ZIMRA takes PAYE, NSSA its contributions.
 * Each leg's account comes from the council's own chart; nothing is preselected, because no
 * account exists until the Council resolves one.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Users, AlertTriangle, Plus, X, Scale } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { centsToText } from '../../../composables/cashMath'
import { balancingAmount, guide, lineState, parseAmount } from '../kit/journalMath'
import { useLedgerLists } from '../kit/useLedgerLists'
import AccountPicker from '../kit/AccountPicker.vue'
import PartyPicker from '../kit/PartyPicker.vue'
import BookSwitch from '../kit/BookSwitch.vue'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'
import type { SalariesJournalBody, VoucherLineBody, VoucherSummary } from '../../../models/ledgerTypes'
import type { Currency } from '../../../models/types'

interface Leg {
  key: number
  /** The name the month's work gives the leg ("Gross salaries", "PAYE", …). */
  label: string
  side: 'debit' | 'credit'
  ledger_account_id: string
  amount: string
  party_id: string
  department_id: string
  /** Whether the label itself may be edited (the standard legs keep theirs). */
  fixedLabel: boolean
}

const PREPARE = 'finance.ledger.voucher.prepare'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const router = useRouter()
const store = useFinanceStore()
const lists = useLedgerLists()

const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let serial = 0
const leg = (label: string, side: 'debit' | 'credit', fixedLabel = true): Leg => (
  { key: ++serial, label, side, ledger_account_id: '', amount: '', party_id: '', department_id: '', fixedLabel }
)

const yearId = computed(() => store.selectedYearId)
const form = reactive({ posting_date: today(), narration: '', reference: '' })
const currency = ref<Currency>('USD')
const legs = ref<Leg[]>([
  leg('Gross salaries', 'debit'),
  leg('PAYE (ZIMRA)', 'credit'),
  leg('NSSA contributions (employee)', 'credit'),
  leg("Employer's contributions", 'debit'),
  leg('Net pay', 'credit'),
])

const loading = ref(Boolean(store.selectedYearId))
const loadError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const busy = ref(false)
const problems = ref<string[]>([])
const problemsEl = ref<HTMLElement | null>(null)
const recent = ref<VoucherSummary[]>([])

const postable = computed(() => lists.accounts.value.filter(a => a.is_postable))
const accountById = (id: string) => lists.accounts.value.find(a => a.id === id)
const canPrepare = computed(() => store.can(PREPARE))

/** The month the posting date falls in, for the narration suggested and the heading shown. */
const monthName = computed(() => {
  const m = Number(form.posting_date.slice(5, 7))
  return MONTHS[m - 1] ?? ''
})
watch(monthName, (m) => {
  if (!form.narration.trim() && m) form.narration = `Salaries for ${m} ${form.posting_date.slice(0, 4)}`
}, { immediate: true })

let initId = 0
async function init(): Promise<void> {
  const seq = ++initId
  loadError.value = null
  if (!yearId.value) return
  loading.value = true
  try {
    const [, recentRes] = await Promise.all([
      Promise.all([lists.loadAccounts(), lists.loadParties(), lists.loadPeriods(yearId.value)]),
      ledgerApi.vouchers({ voucher_type: 'payroll', financial_year_id: yearId.value, limit: 10 }),
    ])
    if (seq !== initId) return
    if (lists.error.value) { loadError.value = lists.error.value; return }
    recent.value = recentRes.vouchers
    currency.value = store.selectedYear?.reporting_currency ?? 'USD'
  } catch (err) {
    if (seq !== initId) return
    loadError.value = messageOf(err, 'The salaries journal could not be opened.')
  } finally {
    if (seq === initId) loading.value = false
  }
}
onMounted(init)
watch(yearId, init)

function addLeg(): void {
  const added = leg('', 'debit', false)
  legs.value.push(added)
  void nextTick(() => (document.getElementById(`sj-label-${added.key}`) as HTMLInputElement | null)?.focus())
}
function removeLeg(i: number): void { legs.value.splice(i, 1) }

const guideLines = computed(() => legs.value.map(l => (
  { debit: l.side === 'debit' ? l.amount : '', credit: l.side === 'credit' ? l.amount : '' }
)))
const gd = computed(() => guide(guideLines.value))
const hasAmounts = computed(() => gd.value.debit !== '0.00' || gd.value.credit !== '0.00')
const guideFigures = computed(() => `Debits ${gd.value.debit} · Credits ${gd.value.credit} · `)
const guideText = computed(() => {
  const g = gd.value
  if (g.unreadable > 0) return `${g.unreadable} ${g.unreadable === 1 ? 'leg' : 'legs'} unreadable`
  if (g.inBalance) return 'In balance'
  if (!hasAmounts.value) return 'No amounts yet'
  return `Out of balance by ${g.difference.replace(/^-/, '')}`
})
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
  if (!p) return 'No accounting period covers this date'
  const base = `Period ${p.period_no}`
  if (p.status === 'open') return `${base} · open`
  if (p.status === 'locked') return `${base} · locked: nothing can be posted into it`
  return `${base} · ${p.status}: a draft may be saved but cannot be posted until it is reopened`
})

function balanceHere(i: number): void {
  const l = legs.value[i]
  if (l.amount.trim() !== '') return
  const b = balancingAmount(guideLines.value, i)
  if (!b) return
  l.side = b.side
  l.amount = b.amount
}
const canBalance = (i: number) => legs.value[i].amount.trim() === '' && balancingAmount(guideLines.value, i) !== null

const isBlankLeg = (l: Leg) => !l.ledger_account_id && l.amount.trim() === '' && !l.label.trim()

function check(): string[] {
  const out: string[] = []
  const filled = legs.value.filter(l => !isBlankLeg(l))
  if (filled.length < 2) out.push('A salaries journal needs at least two legs: the gross on one side, the deductions and the net pay on the other.')
  filled.forEach((l) => {
    const n = legs.value.indexOf(l) + 1
    const at = `Leg ${n} (${l.label || 'unnamed'})`
    if (!l.label.trim()) out.push(`${at}: name the leg.`)
    if (!l.ledger_account_id) out.push(`${at} cites no account in the chart.`)
    const parsed = parseAmount(l.amount)
    if (l.amount.trim() === '') out.push(`${at} has no amount.`)
    else if (parsed === null) out.push(`${at}: write the amount as 1250.50.`)
    else if (parsed === 0n) out.push(`${at} has an amount of nil.`)
    if (l.ledger_account_id) {
      const t = accountById(l.ledger_account_id)?.account_type
      if ((t === 'receivable' || t === 'payable') && !l.party_id) out.push(`${at} is on a control account and needs its party.`)
    }
  })
  return out
}

function bodyLines(): SalariesJournalBody['lines'] {
  return legs.value.filter(l => !isBlankLeg(l)).map(l => {
    const b: VoucherLineBody = {
      ledger_account_id: l.ledger_account_id,
      [l.side]: centsToText(parseAmount(l.amount) ?? 0n),
    }
    if (l.label.trim()) b.narration = l.label.trim()
    if (l.party_id) b.party_id = l.party_id
    if (l.department_id) b.department_id = l.department_id
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
    const res = await ledgerApi.createSalariesJournal({
      currency: currency.value, financial_year_id: yearId.value, posting_date: form.posting_date,
      ...(form.narration.trim() ? { narration: form.narration.trim() } : {}),
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      lines: bodyLines(),
    })
    await router.replace({ name: 'acc-voucher', params: { id: res.voucher.id }, state: { note: res.note } })
  } catch (err) {
    saveError.value = messageOf(err, 'The salaries journal could not be raised.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Users :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Salaries Journal</h2>
      <p>The month's salaries as one voucher: gross and the employer's contributions debited, the deductions and the net pay credited.</p>
    </div>
  </section>

  <p class="sj-standing">This is not a payroll system: it keeps no employee, no leave and no bank standing order. Whoever computes the salaries types the month's totals here, and the draft it raises posts nothing until somebody other than its preparer posts it.</p>

  <p v-if="!yearId" class="cw-empty"><strong>Choose a financial year in the banner above.</strong>A salaries journal is prepared in one financial year.</p>

  <template v-else>
    <p v-if="loadError" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ loadError }}
      <button type="button" class="cw-btn cw-btn--small" @click="init">Retry</button>
    </p>
    <CwSkeleton v-else-if="loading" label="the salaries journal" />
    <p v-else-if="!postable.length" class="cw-empty">
      <strong>The chart of accounts has no account that can be posted to.</strong>
      Accounts are set up under <RouterLink :to="{ name: 'acc-ledger' }">General Ledger</RouterLink>.
    </p>
    <p v-else-if="!canPrepare" class="cw-banner-msg cw-banner-msg--warn" role="status">
      <AlertTriangle :size="18" aria-hidden="true" />{{ store.whyUnavailable(PREPARE) }}
    </p>

    <section v-else class="cw-card sj">
      <form class="cw-card-body sj-body" novalidate @submit.prevent="save">
        <div class="sj-top">
          <div class="cw-field"><label class="cw-label" for="sj-date">Payroll date</label>
            <input id="sj-date" v-model="form.posting_date" class="cw-input" type="date" required />
          </div>
          <div class="cw-field"><span class="cw-label" id="sj-book">Book</span>
            <BookSwitch v-model="currency" label="Book" />
          </div>
          <div class="cw-field"><label class="cw-label" for="sj-ref">Reference</label>
            <input id="sj-ref" v-model="form.reference" class="cw-input" type="text" autocomplete="off" placeholder="The payroll slip's own number, if any" />
          </div>
          <div class="cw-field"><label class="cw-label" for="sj-narr">Narration</label>
            <input id="sj-narr" v-model="form.narration" class="cw-input" type="text" autocomplete="off" />
          </div>
        </div>
        <p class="sj-period" data-testid="sj-period" role="status">{{ monthName ? `${monthName} payroll · ` : '' }}{{ periodText }}</p>

        <div class="cw-table-wrap">
          <table class="cw-table sj-table">
            <caption class="sr-only">The month's salary legs</caption>
            <thead>
              <tr><th>Leg</th><th>Side</th><th>Account</th><th>Party</th><th>Vote</th><th class="amt">Amount</th><th><span class="sr-only">Remove</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in legs" :key="l.key">
                <td class="sj-cell sj-leg">
                  <label class="sr-only" :for="`sj-label-${l.key}`">Leg name, leg {{ i + 1 }}</label>
                  <input v-if="!l.fixedLabel" :id="`sj-label-${l.key}`" v-model="l.label" class="cw-input" autocomplete="off" placeholder="Leg name (e.g. Pension)" />
                  <span v-else>{{ l.label }}</span>
                </td>
                <td>
                  <label class="sr-only" :for="`sj-side-${l.key}`">Side, leg {{ i + 1 }}</label>
                  <select :id="`sj-side-${l.key}`" v-model="l.side" class="cw-select">
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                </td>
                <td class="sj-cell"><AccountPicker v-model="l.ledger_account_id" :accounts="postable" :label="`Account, leg ${i + 1}`" /></td>
                <td class="sj-cell"><PartyPicker v-model="l.party_id" :parties="lists.parties.value" :label="`Party, leg ${i + 1}`" placeholder="ZIMRA, NSSA…" /></td>
                <td class="sj-cell">
                  <label class="sr-only" :for="`sj-dep-${l.key}`">Vote, leg {{ i + 1 }}</label>
                  <select :id="`sj-dep-${l.key}`" v-model="l.department_id" class="cw-select">
                    <option value="">None</option>
                    <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">{{ d.code }} · {{ d.name }}</option>
                  </select>
                </td>
                <td class="amt">
                  <label class="sr-only" :for="`sj-amt-${l.key}`">Amount, leg {{ i + 1 }}</label>
                  <input :id="`sj-amt-${l.key}`" v-model="l.amount" class="cw-input amt" inputmode="decimal" autocomplete="off" placeholder="0.00"
                    :aria-invalid="l.amount.trim() !== '' && lineState({ debit: l.side === 'debit' ? l.amount : '', credit: l.side === 'credit' ? l.amount : '' }) === 'unreadable' ? 'true' : undefined" />
                  <button v-if="canBalance(i)" type="button" class="cw-btn cw-btn--small sj-bal" :aria-label="`Balance on this leg, leg ${i + 1}`" @click="balanceHere(i)">
                    <Scale :size="14" aria-hidden="true" /> Balance on this leg
                  </button>
                </td>
                <td>
                  <button type="button" class="cw-btn cw-btn--small" :aria-label="`Remove leg ${i + 1}`" @click="removeLeg(i)"><X :size="14" aria-hidden="true" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="sj-tools">
          <button type="button" class="cw-btn" data-testid="sj-add-leg" @click="addLeg"><Plus :size="16" aria-hidden="true" /> Add a leg</button>
          <span class="cw-hint">The standard legs suit the council's month. Add one for a pension, a medical aid or an allowance the month carries.</span>
        </div>

        <div class="sj-guide" data-testid="sj-guide">
          <span><strong>{{ guideFigures }}</strong><strong>{{ guideText }}</strong></span>
          <span class="sr-only" data-testid="sj-guide-live" aria-live="polite">{{ announced }}</span>
          <small>A guide while you type. The exact figures are computed when the draft is saved, and the database refuses a voucher that does not balance.</small>
        </div>
        <p v-if="unbalanced" class="cw-banner-msg"><AlertTriangle :size="18" aria-hidden="true" />This journal does not balance, so it can be saved but not posted. Check the net pay leg first: it is the gross less every deduction.</p>

        <div v-if="problems.length" id="sj-problems" ref="problemsEl" tabindex="-1" class="cw-banner-msg cw-banner-msg--neg" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />
          <ul class="sj-problems"><li v-for="p in problems" :key="p">{{ p }}</li></ul>
        </div>
        <p v-if="saveError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ saveError }}</p>

        <div class="sj-actions">
          <RouterLink class="cw-btn" :to="{ name: 'acc-journals' }">Cancel</RouterLink>
          <button type="submit" class="cw-btn cw-btn--primary" :aria-disabled="busy || undefined">{{ busy ? 'Saving…' : 'Raise the draft' }}</button>
        </div>
      </form>
    </section>

    <section v-if="!loading && !loadError && recent.length" class="cw-card" aria-labelledby="sj-recent">
      <div class="cw-card-head"><h3 id="sj-recent">This year's salaries journals</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <caption class="sr-only">Salaries journals raised this financial year</caption>
          <thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col">Narration</th><th scope="col">Status</th></tr></thead>
          <tbody>
            <tr v-for="v in recent" :key="v.id">
              <th scope="row"><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: v.id } }">{{ v.voucher_no }}</RouterLink></th>
              <td>{{ v.posting_date }}</td>
              <td>{{ v.narration ?? '—' }}</td>
              <td>{{ v.status === 'draft' ? `Draft, waiting to be posted by somebody other than ${v.prepared_by_name ?? 'its preparer'}` : v.status === 'posted' ? 'Posted' : 'Cancelled' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="cw-hint" style="padding: 0 18px 14px">A salaries journal is {{ VOUCHER_TYPE_LABEL.payroll.toLowerCase() }} number SJ-, issued by the ledger's own series.</p>
    </section>
  </template>
</template>

<style scoped>
.sj-standing { margin: 0 0 12px; color: var(--cw-ink-2, #4d5b6b); font-size: 13.5px; }
.sj-body { display: flex; flex-direction: column; gap: 14px; padding-top: 18px; }
.sj-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; align-items: end; }
.sj-period { margin: 0; font-size: 13.5px; }
.sj-table { min-width: 960px; }
.sj-cell { min-width: 170px; }
.sj-leg input { min-width: 210px; }
.sj-table input.amt { text-align: right; font-variant-numeric: tabular-nums; min-width: 110px; }
.sj-bal { margin-top: 4px; white-space: nowrap; }
.sj-tools { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; }
.sj-guide { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
.sj-guide small { color: var(--cw-ink-3); }
.sj-problems { margin: 0; padding-left: 18px; }
.sj-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
</style>
