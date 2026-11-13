<script setup lang="ts">
/**
 * The book of account: the GL chart, the accounting periods, and the vouchers posted into them.
 *
 * This is the surface the finance department WORKS on. The statements drawn from it are the next
 * section along; nothing here reports, and nothing there writes.
 *
 * WHY THE TOTALS ON THE VOUCHER EDITOR COME FROM THE SERVER
 * A council's trial balance is not something to be approximately right about, and this module adds
 * no amount in the browser — a JavaScript number is a binary float. So the debit and credit totals
 * of a draft, and its imbalance, are computed in SQL over NUMERIC and arrive as decimal strings.
 * The consequence is visible and is stated on screen: the totals refresh when the draft is SAVED,
 * not as the officer types, and the panel says so and marks itself out of date in between. That is
 * a deliberate trade — an exact figure a moment late rather than a convenient figure that is
 * wrong in the last decimal place — and a draft has to be saved before it can be posted anyway.
 *
 * WHY POSTING IS A SEPARATE ACT FROM DRAFTING, AND WHY THE BUTTON IS OFTEN ABSENT
 * Posting is the point of no return: a posted ledger line can never be amended, flagged or hidden
 * (migration 203 revokes UPDATE and DELETE from the application role and refuses them in a trigger
 * for everyone else). So preparing and posting are two acts by two people —
 * `prepared_by <> posted_by`, a CHECK constraint on `finance.voucher`, mirroring how budget
 * approval already works. Where this person prepared the voucher there is NO Post button and a
 * sentence says why, because the workspace does not put a control on a surface whose only outcome
 * is a 403. The screen explains; the database decides.
 *
 * WHY A CORRECTION IS A REVERSAL AND NOT AN EDIT
 * A posted voucher has no Edit control at any width. Correcting it raises a reversal voucher
 * carrying the opposite entries, and BOTH HALVES STAY ON SCREEN — the original is not cancelled,
 * struck through or hidden. That is the same rule the transaction register already follows for
 * `reverses_id`, so the register and the ledger behave alike, and it is what an auditor expects to
 * find.
 *
 * TWO SETS OF BOOKS, AND NO RATE BETWEEN THEM
 * A voucher carries ONE currency for the whole document; there is no per-line currency control,
 * because there is nowhere in the schema to put a second one. Nothing on this screen shows a figure
 * spanning USD and ZWG, and the currency chooser on a new voucher says so.
 *
 * HOW THIS STAYS OFF THE GENERIC-SAAS-DASHBOARD ANTI-REFERENCE (PRODUCT.md)
 * No hero metrics: the balance panel is a definition list at body weight, not a row of large
 * numbers. No icon grid. The accent appears only on the primary action and the out-of-balance
 * marker. The chart of accounts is an indented list that reads like a printed chart, and the
 * voucher editor is a ruled table with a debit and a credit column, which is what a journal is.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle, BookOpen, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronRight, Info,
  Lock, Plus, RefreshCw, Trash2, Undo2, X,
} from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { ledgerApi } from '../../api/ledgerApi'
import { formatDate, formatDateTime, formatMoney } from '../../composables/useMoney'
import { useFinancePrompt } from '../../composables/useFinancePrompt'
import FinancePromptDialog from '../../components/FinancePromptDialog.vue'
import type {
  CreatableVoucherType, Currency, LedgerAccount, LedgerAccountNode, LedgerPeriod,
  LedgerRootType, VoucherDetail, VoucherLineBody, VoucherSummary,
} from '../../models/ledgerTypes'

const store = useFinanceStore()

/** One part only, when a workspace page shows the periods, the chart or the vouchers by itself. */
const props = defineProps<{ only?: 'periods' | 'chart' | 'vouchers' }>()
const shows = (part: 'periods' | 'chart' | 'vouchers') => !props.only || props.only === part
const prompt = useFinancePrompt()

const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)

const yearId = computed(() => store.selectedYearId)
const canManageChart = computed(() => store.can('finance.ledger.account.manage'))
const canManagePeriods = computed(() => store.can('finance.ledger.period.manage'))
const canPrepare = computed(() => store.can('finance.ledger.voucher.prepare'))
const canPost = computed(() => store.can('finance.ledger.voucher.post'))
const canReverse = computed(() => store.can('finance.ledger.voucher.reverse'))
const me = computed(() => store.identity?.user_id ?? null)

/** How each root type is written, and which side of the account is its normal one. */
const ROOT_LABEL: Record<LedgerRootType, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expenditure',
}
const ROOT_SIDE: Record<LedgerRootType, 'debit' | 'credit'> = {
  asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit',
}

const VOUCHER_TYPE_LABEL: Record<string, string> = {
  opening: 'Opening balance', journal: 'Journal', rates_bill: 'Rates bill', receipt: 'Receipt',
  credit_note: 'Credit note', write_off: 'Write-off', closing: 'Year-end closing',
  reversal: 'Reversal',
}

const CREATABLE_TYPES: CreatableVoucherType[] = [
  'journal', 'opening', 'rates_bill', 'receipt', 'credit_note', 'write_off', 'closing',
]

// ── 1. The chart of accounts ──────────────────────────────────────────────────────────────────

const chart = ref<LedgerAccountNode[]>([])
const chartNote = ref<string | null>(null)
const chartLoading = ref(false)
const chartFilter = ref<{ root_type?: LedgerRootType; q?: string; postable_only?: boolean }>({})
const collapsed = ref<Set<string>>(new Set())
const showAccountForm = ref(false)
const accountForm = ref<{
  code: string; name: string; root_type: LedgerRootType
  account_type: string; parent_id: string; is_group: boolean
}>({ code: '', name: '', root_type: 'asset', account_type: '', parent_id: '', is_group: false })

async function loadChart(): Promise<void> {
  chartLoading.value = true
  error.value = null
  try {
    const result = await ledgerApi.accountTree({
      root_type: chartFilter.value.root_type,
      q: chartFilter.value.q || undefined,
      postable_only: chartFilter.value.postable_only === true ? true : undefined,
    })
    chart.value = result.accounts
    chartNote.value = result.note
  } catch (err) {
    error.value = messageOf(err, 'The chart of accounts could not be read.')
  } finally {
    chartLoading.value = false
  }
}

/** Flatten the tree for rendering, carrying the depth, and honouring the collapsed set. */
interface ChartRow { account: LedgerAccountNode; depth: number; hasChildren: boolean }
const chartRows = computed<ChartRow[]>(() => {
  const out: ChartRow[] = []
  const walk = (nodes: LedgerAccountNode[], depth: number): void => {
    for (const account of nodes) {
      const hasChildren = account.children.length > 0
      out.push({ account, depth, hasChildren })
      if (hasChildren && !collapsed.value.has(account.id)) walk(account.children, depth + 1)
    }
  }
  walk(chart.value, 0)
  return out
})

function toggleBranch(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/** Every postable leaf, for the account chooser on a voucher line. */
const postableAccounts = ref<LedgerAccount[]>([])
async function loadPostable(): Promise<void> {
  try {
    const result = await ledgerApi.accounts({ postable_only: true, status: 'active' })
    postableAccounts.value = result.accounts
  } catch {
    // The chooser falls back to empty and the form says so; a failed read is not a fatal page.
    postableAccounts.value = []
  }
}

async function createAccount(): Promise<void> {
  error.value = null; note.value = null
  busy.value = 'account'
  try {
    const created = await ledgerApi.createAccount({
      code: accountForm.value.code.trim(),
      name: accountForm.value.name.trim(),
      root_type: accountForm.value.root_type,
      account_type: accountForm.value.account_type
        ? accountForm.value.account_type as never : undefined,
      parent_id: accountForm.value.parent_id || undefined,
      is_group: accountForm.value.is_group,
      is_postable: !accountForm.value.is_group,
    })
    note.value = `Account ${created.code} added to the chart. It is currency-neutral: it serves both books.`
    showAccountForm.value = false
    accountForm.value = { code: '', name: '', root_type: 'asset', account_type: '', parent_id: '', is_group: false }
    await Promise.all([loadChart(), loadPostable()])
  } catch (err) {
    error.value = messageOf(err, 'The account could not be created.')
  } finally {
    busy.value = null
  }
}

// ── 2. Accounting periods ─────────────────────────────────────────────────────────────────────

const periods = ref<LedgerPeriod[]>([])
const periodsLoading = ref(false)
const periodsOpen = ref(props.only === 'periods')

async function loadPeriods(): Promise<void> {
  if (!yearId.value) { periods.value = []; return }
  periodsLoading.value = true
  try {
    const result = await ledgerApi.periods({ financial_year_id: yearId.value })
    periods.value = result.periods
  } catch (err) {
    error.value = messageOf(err, 'The accounting periods could not be read.')
  } finally {
    periodsLoading.value = false
  }
}

async function openPeriods(): Promise<void> {
  if (!yearId.value) return
  error.value = null; note.value = null
  busy.value = 'periods'
  try {
    const result = await ledgerApi.openPeriods({
      financial_year_id: yearId.value, periodicity: 'monthly',
    })
    note.value = result.opened.length > 0
      ? `Opened ${result.opened.length} accounting period(s). ${result.note}`
      : `Every period of ${result.financial_year} is already open.`
    await loadPeriods()
  } catch (err) {
    error.value = messageOf(err, 'The accounting periods could not be opened.')
  } finally {
    busy.value = null
  }
}

async function setPeriodStatus(period: LedgerPeriod, status: 'open' | 'closed' | 'locked'): Promise<void> {
  error.value = null; note.value = null
  busy.value = period.id
  try {
    await ledgerApi.setPeriodStatus(period.id, status)
    note.value = status === 'locked'
      ? `Period ${period.period_no} is locked. That is final — an adjustment after it belongs in a later period.`
      : `Period ${period.period_no} is now ${status}.`
    await loadPeriods()
  } catch (err) {
    error.value = messageOf(err, 'The period could not be changed.')
  } finally {
    busy.value = null
  }
}

const openPeriodCount = computed(() => periods.value.filter((p) => p.status === 'open').length)

// ── 3. Vouchers ───────────────────────────────────────────────────────────────────────────────

const vouchers = ref<VoucherSummary[]>([])
const voucherTotal = ref(0)
const vouchersLoading = ref(false)
const voucherFilter = ref<{ status?: string; voucher_type?: string; currency?: Currency; q?: string }>({})
const openVoucherId = ref<string | null>(null)
const detail = ref<VoucherDetail | null>(null)
const detailLoading = ref(false)

async function loadVouchers(): Promise<void> {
  if (!yearId.value) { vouchers.value = []; voucherTotal.value = 0; return }
  vouchersLoading.value = true
  error.value = null
  try {
    const result = await ledgerApi.vouchers({
      financial_year_id: yearId.value,
      status: voucherFilter.value.status as never,
      voucher_type: voucherFilter.value.voucher_type as never,
      currency: voucherFilter.value.currency,
      q: voucherFilter.value.q || undefined,
      limit: 50,
      sort: 'posting_date',
      direction: 'desc',
    })
    vouchers.value = result.vouchers
    voucherTotal.value = result.total
  } catch (err) {
    error.value = messageOf(err, 'The voucher register could not be read.')
  } finally {
    vouchersLoading.value = false
  }
}

async function openVoucher(id: string): Promise<void> {
  if (openVoucherId.value === id) { openVoucherId.value = null; detail.value = null; return }
  openVoucherId.value = id
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await ledgerApi.voucher(id)
  } catch (err) {
    error.value = messageOf(err, 'That voucher could not be read.')
  } finally {
    detailLoading.value = false
  }
}

/**
 * Did this person prepare this voucher?
 *
 * Posting it is then not theirs to do: the route refuses it and so does a CHECK constraint on
 * `finance.voucher`. The Post control is therefore not offered, and the refusal is said in words on
 * the row instead — the same thing the Budget screen does for a line the viewer submitted.
 */
const isOwnDraft = (v: VoucherSummary): boolean =>
  me.value !== null && v.prepared_by === me.value

/** Whether a voucher's draft lines balance, read from the server's figure and never recomputed. */
const draftBalances = (v: VoucherSummary): boolean =>
  v.debit_total !== null && v.credit_total !== null && v.debit_total === v.credit_total

async function post(v: VoucherSummary): Promise<void> {
  error.value = null; note.value = null
  busy.value = v.id
  try {
    const result = await ledgerApi.postVoucher(v.id)
    note.value = `${result.posted} posted: ${result.entries} ledger entries. ${result.note}`
    await Promise.all([loadVouchers(), openVoucherId.value === v.id ? openVoucher2(v.id) : Promise.resolve()])
  } catch (err) {
    error.value = messageOf(err, 'The voucher could not be posted.')
  } finally {
    busy.value = null
  }
}

/** Re-read an already-open voucher without toggling it shut. */
async function openVoucher2(id: string): Promise<void> {
  detailLoading.value = true
  try {
    detail.value = await ledgerApi.voucher(id)
  } catch { /* the list above already carries the error */ } finally {
    detailLoading.value = false
  }
}

async function reverse(v: VoucherSummary): Promise<void> {
  error.value = null; note.value = null
  const reason = await prompt.ask({
    title: `Reverse ${v.voucher_no}`,
    message: 'The original stays posted and visible. A reversal carrying the opposite entries is '
      + 'raised and posted beside it, so the net effect on every account is nil and both halves '
      + 'remain on the record. Nothing is amended or hidden.',
    label: 'Reason for the reversal',
    kind: 'textarea',
    minLength: 10,
    submitLabel: 'Raise the reversal',
  })
  if (!reason) return
  busy.value = v.id
  try {
    const result = await ledgerApi.reverseVoucher(v.id, { reason })
    note.value = `${result.reversal.voucher_no} posted against ${result.reversed}. ${result.note}`
    await loadVouchers()
    if (openVoucherId.value === v.id) await openVoucher2(v.id)
  } catch (err) {
    error.value = messageOf(err, 'The voucher could not be reversed.')
  } finally {
    busy.value = null
  }
}

async function discard(v: VoucherSummary): Promise<void> {
  error.value = null; note.value = null
  busy.value = v.id
  try {
    await ledgerApi.discardVoucher(v.id)
    note.value = `Draft ${v.voucher_no} discarded. Nothing was posted, so nothing is left behind.`
    if (openVoucherId.value === v.id) { openVoucherId.value = null; detail.value = null }
    await loadVouchers()
  } catch (err) {
    error.value = messageOf(err, 'The draft could not be discarded.')
  } finally {
    busy.value = null
  }
}

// ── 4. The voucher editor ─────────────────────────────────────────────────────────────────────

interface EditorLine {
  ledger_account_id: string
  side: 'debit' | 'credit'
  amount: string
  party_id: string
  narration: string
}

const editorOpen = ref(false)
/** The draft this editor is working on, once saved. Null while it has never been saved. */
const editingId = ref<string | null>(null)
const editorHeader = ref<{
  voucher_no: string; voucher_type: CreatableVoucherType; currency: Currency
  posting_date: string; narration: string; reference: string
}>({
  voucher_no: '', voucher_type: 'journal', currency: 'USD',
  posting_date: new Date().toISOString().slice(0, 10), narration: '', reference: '',
})
const editorLines = ref<EditorLine[]>([
  { ledger_account_id: '', side: 'debit', amount: '', party_id: '', narration: '' },
  { ledger_account_id: '', side: 'credit', amount: '', party_id: '', narration: '' },
])
/**
 * The server's own figures for the saved draft, and whether the lines have changed since.
 *
 * `stale` is the honest half: once a line is edited the panel below no longer describes what is on
 * screen, and it says so rather than showing a figure that is out of date without admitting it.
 */
const savedBalance = ref<{ debit_total: string; credit_total: string; difference: string } | null>(null)
const balanceStale = ref(false)

function resetEditor(): void {
  editingId.value = null
  savedBalance.value = null
  balanceStale.value = false
  editorHeader.value = {
    voucher_no: '', voucher_type: 'journal', currency: 'USD',
    posting_date: new Date().toISOString().slice(0, 10), narration: '', reference: '',
  }
  editorLines.value = [
    { ledger_account_id: '', side: 'debit', amount: '', party_id: '', narration: '' },
    { ledger_account_id: '', side: 'credit', amount: '', party_id: '', narration: '' },
  ]
}

function addLine(): void {
  editorLines.value.push({ ledger_account_id: '', side: 'credit', amount: '', party_id: '', narration: '' })
  balanceStale.value = true
}

function removeLine(index: number): void {
  if (editorLines.value.length <= 2) return
  editorLines.value.splice(index, 1)
  balanceStale.value = true
}

watch(editorLines, () => { if (savedBalance.value) balanceStale.value = true }, { deep: true })

/** The lines as the API wants them: one of debit or credit per line, never both. */
function linesForApi(): VoucherLineBody[] {
  return editorLines.value.map((line) => ({
    ledger_account_id: line.ledger_account_id,
    ...(line.side === 'debit' ? { debit: line.amount.trim() } : { credit: line.amount.trim() }),
    party_id: line.party_id || undefined,
    narration: line.narration.trim() || undefined,
  }))
}

const editorReady = computed(() =>
  editorHeader.value.voucher_no.trim().length > 0
  && editorLines.value.length >= 2
  && editorLines.value.every((l) => l.ledger_account_id && l.amount.trim()))

/**
 * Save the draft, and take the totals from the response.
 *
 * The response's `balance` was computed in SQL over NUMERIC. Nothing in this component adds the
 * amounts, which is why the figures appear on save rather than on keystroke.
 */
async function saveDraft(): Promise<void> {
  if (!yearId.value) return
  error.value = null; note.value = null
  busy.value = 'draft'
  try {
    if (editingId.value) {
      const result = await ledgerApi.updateVoucher(editingId.value, {
        posting_date: editorHeader.value.posting_date,
        narration: editorHeader.value.narration.trim() || null,
        reference: editorHeader.value.reference.trim() || null,
        lines: linesForApi(),
      })
      savedBalance.value = result.balance
    } else {
      const result = await ledgerApi.createVoucher({
        voucher_no: editorHeader.value.voucher_no.trim(),
        voucher_type: editorHeader.value.voucher_type,
        currency: editorHeader.value.currency,
        financial_year_id: yearId.value,
        posting_date: editorHeader.value.posting_date,
        narration: editorHeader.value.narration.trim() || undefined,
        reference: editorHeader.value.reference.trim() || undefined,
        lines: linesForApi(),
      })
      editingId.value = result.voucher.id
      savedBalance.value = result.balance
    }
    balanceStale.value = false
    note.value = savedBalance.value && Number(savedBalance.value.difference) === 0
      ? 'The draft balances and is saved. It posts nothing until somebody other than you posts it.'
      : 'The draft is saved. It does not balance yet, so it cannot be posted.'
    await loadVouchers()
  } catch (err) {
    error.value = messageOf(err, 'The draft could not be saved.')
  } finally {
    busy.value = null
  }
}

/** True only when the server said the saved draft balances, and nothing has changed since. */
const savedAndBalanced = computed(() =>
  savedBalance.value !== null && !balanceStale.value
  && Number(savedBalance.value.difference) === 0)

function startVoucher(): void {
  resetEditor()
  editorOpen.value = true
}

function closeEditor(): void {
  editorOpen.value = false
  resetEditor()
}

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

onMounted(() => {
  void loadChart()
  void loadPostable()
  void loadPeriods()
  void loadVouchers()
})

watch(yearId, () => { void loadPeriods(); void loadVouchers() })
watch([() => chartFilter.value.root_type, () => chartFilter.value.postable_only], () => void loadChart())
watch([() => voucherFilter.value.status, () => voucherFilter.value.voucher_type,
  () => voucherFilter.value.currency], () => void loadVouchers())

let chartTimer: ReturnType<typeof setTimeout> | undefined
watch(() => chartFilter.value.q, () => {
  clearTimeout(chartTimer)
  chartTimer = setTimeout(() => void loadChart(), 300)
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

    <!-- The standing statement about this surface. It is not decoration: a reader who takes the
         ledger for the register, or either for a Council-approved book, would misread everything
         below. -->
    <p class="gl-preamble">
      <Info :size="15" aria-hidden="true" />
      <span>
        This is the council's own book of account: figures originated here, not imported. It is kept
        as <strong>two self-balancing sets of books</strong>, one in USD and one in ZWG, because the
        Council has approved no conversion basis — so no figure on this screen or the next spans
        them. A posted ledger line can never be amended; a correction is a reversal and both halves
        stay visible.
      </span>
    </p>

    <!-- ── Accounting periods ──────────────────────────────────────────────────────────────── -->
    <section v-if="shows('periods')" class="ins-card" aria-labelledby="gl-periods-head">
      <div class="ins-card-head">
        <h2 id="gl-periods-head">
          <CalendarRange :size="15" aria-hidden="true" />
          Accounting periods
          <span v-if="periods.length" class="ins-count">{{ periods.length }}</span>
        </h2>
        <button type="button" class="fin-btn small" :aria-expanded="periodsOpen"
                aria-controls="gl-periods" @click="periodsOpen = !periodsOpen">
          {{ periodsOpen ? 'Hide' : 'Show' }}
        </button>
      </div>
      <div v-if="periodsOpen" id="gl-periods" class="ins-card-body">
        <p v-if="periodsLoading" class="gl-loading" role="status">Reading the accounting periods…</p>

        <div v-else-if="!yearId" class="fin-empty">
          <strong>No financial year is selected.</strong>
          <p>Choose a reporting period above.</p>
        </div>

        <div v-else-if="periods.length === 0" class="fin-empty">
          <strong>No accounting period is open for {{ store.selectedYear?.label }}.</strong>
          <p>
            Nothing can be posted until the periods exist: a posting belongs to the period its date
            falls in, and the database refuses one that falls in none. The periods are generated
            from the council's own financial year start, so a July–June year begins at period 1 =
            July and they tile the year exactly.
          </p>
          <p v-if="canManagePeriods">
            <button type="button" class="fin-btn primary" :disabled="busy === 'periods'"
                    @click="openPeriods">
              <Plus :size="14" aria-hidden="true" />
              {{ busy === 'periods' ? 'Opening…' : 'Open the twelve monthly periods' }}
            </button>
          </p>
          <p v-else class="gl-absent">
            Opening a period needs <code>finance.ledger.period.manage</code>, which your role does
            not hold. {{ store.whyUnavailable('finance.ledger.period.manage') }}
          </p>
        </div>

        <template v-else>
          <ul class="gl-periods">
            <li v-for="p in periods" :key="p.id" class="gl-period" :class="`is-${p.status}`">
              <span class="gl-period-no">{{ p.period_no }}</span>
              <span class="gl-period-dates">
                {{ formatDate(p.from_date) }} – {{ formatDate(p.to_date) }}
              </span>
              <span class="fin-pill"
                    :class="p.status === 'open' ? 'tone-positive' : p.status === 'locked' ? 'tone-negative' : 'tone-warning'">
                <Lock v-if="p.status === 'locked'" :size="10" aria-hidden="true" />
                {{ p.status }}
              </span>
              <span class="gl-period-entries">
                {{ p.entry_count }} {{ p.entry_count === 1 ? 'entry' : 'entries' }}
              </span>
              <span v-if="canManagePeriods && p.status !== 'locked'" class="gl-period-acts">
                <button v-if="p.status === 'open'" type="button" class="fin-btn small"
                        :disabled="busy === p.id" @click="setPeriodStatus(p, 'closed')">Close</button>
                <button v-else type="button" class="fin-btn small"
                        :disabled="busy === p.id" @click="setPeriodStatus(p, 'open')">Reopen</button>
                <button type="button" class="fin-btn small" :disabled="busy === p.id"
                        @click="setPeriodStatus(p, 'locked')">Lock</button>
              </span>
            </li>
          </ul>
          <p class="gl-caption">
            <Info :size="14" aria-hidden="true" />
            <span>
              A posting into anything but an <strong>open</strong> period is refused by the database,
              not only by this screen. <strong>Locked</strong> is final and is what a council sets
              after the audit; this screen will not take it back out.
            </span>
          </p>
        </template>
      </div>
    </section>

    <!-- ── The chart of accounts ───────────────────────────────────────────────────────────── -->
    <section v-if="shows('chart')" class="ins-card" aria-labelledby="gl-chart-head">
      <div class="ins-card-head">
        <h2 id="gl-chart-head">
          <BookOpen :size="15" aria-hidden="true" />
          Chart of accounts
          <span v-if="chartRows.length" class="ins-count">{{ chartRows.length }}</span>
        </h2>
        <span class="gl-asat">Currency-neutral — one chart, two books</span>
      </div>
      <div class="ins-card-body">
        <div class="fin-bar">
          <label class="ins-search">
            <span class="sr-only">Search the chart by code or name</span>
            <input v-model="chartFilter.q" class="ins-input" type="search"
                   placeholder="Search code or name" />
          </label>
          <select v-model="chartFilter.root_type" class="ins-input gl-filter" aria-label="Root type">
            <option :value="undefined">Every root type</option>
            <option v-for="(label, root) in ROOT_LABEL" :key="root" :value="root">{{ label }}</option>
          </select>
          <label class="gl-check">
            <input v-model="chartFilter.postable_only" type="checkbox" />
            <span>Postable accounts only</span>
          </label>
          <button v-if="canManageChart" type="button" class="fin-btn primary"
                  @click="showAccountForm = !showAccountForm">
            <Plus :size="14" aria-hidden="true" /> New account
          </button>
          <button type="button" class="fin-btn small" :disabled="chartLoading" @click="loadChart">
            <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': chartLoading }" /> Refresh
          </button>
        </div>

        <form v-if="showAccountForm && canManageChart" class="gl-form" @submit.prevent="createAccount">
          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="gl-ac-code">Account code</label>
              <input id="gl-ac-code" v-model="accountForm.code" class="ins-input" maxlength="60" required />
              <p class="ins-hint">
                The Council's own code. It is cited by every entry posted to it and cannot be changed
                afterwards.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-ac-name">Name</label>
              <input id="gl-ac-name" v-model="accountForm.name" class="ins-input" maxlength="300" required />
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-ac-root">Root type</label>
              <select id="gl-ac-root" v-model="accountForm.root_type" class="ins-input" required>
                <option v-for="(label, root) in ROOT_LABEL" :key="root" :value="root">{{ label }}</option>
              </select>
              <p class="ins-hint">
                Council data, never inferred from the code range. It decides which statement the
                account appears on and is fixed once set.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-ac-type">Behaviour</label>
              <select id="gl-ac-type" v-model="accountForm.account_type" class="ins-input">
                <option value="">Not classified</option>
                <option value="receivable">Receivable control</option>
                <option value="payable">Payable control</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="accumulated_surplus">Accumulated surplus</option>
                <option value="current_surplus">Current surplus</option>
                <option value="tax">Tax</option>
                <option value="fixed_asset">Fixed asset</option>
                <option value="inventory">Inventory</option>
                <option value="provision">Provision</option>
                <option value="other">Other</option>
              </select>
              <p class="ins-hint">
                Not decoration: debtor ageing finds its bills in the <em>receivable control</em>
                account, and the year-end closing transfers the surplus into
                <em>accumulated surplus</em>. An account left unclassified is invisible to those two.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-ac-parent">Sits beneath</label>
              <select id="gl-ac-parent" v-model="accountForm.parent_id" class="ins-input">
                <option value="">Nothing — a root of the chart</option>
                <option v-for="row in chartRows" :key="row.account.id" :value="row.account.id">
                  {{ row.account.code }} — {{ row.account.name }}
                </option>
              </select>
            </div>
            <div class="ins-field">
              <label class="gl-check">
                <input v-model="accountForm.is_group" type="checkbox" />
                <span>This is a heading, not an account</span>
              </label>
              <p class="ins-hint">
                A heading carries no balance of its own and nothing can be posted to it. The
                database refuses a posting to one.
              </p>
            </div>
          </div>
          <div class="gl-form-foot">
            <button type="button" class="fin-btn" @click="showAccountForm = false">Cancel</button>
            <button type="submit" class="fin-btn primary" :disabled="busy === 'account'">
              {{ busy === 'account' ? 'Adding…' : 'Add to the chart' }}
            </button>
          </div>
        </form>

        <p v-if="chartLoading && chartRows.length === 0" class="gl-loading" role="status">
          Reading the chart of accounts…
        </p>

        <div v-else-if="chartRows.length === 0" class="fin-empty">
          <strong>The chart of accounts is empty.</strong>
          <p>
            Nothing is seeded, on purpose: the chart is a Council resolution, and a
            plausible-looking placeholder in a book of account is worse than an empty table because
            an officer cannot tell it from real data. Nothing can be posted until the chart exists.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table gl-chart">
            <caption class="sr-only">
              The general ledger chart of accounts, nested by heading. It carries no currency: one
              chart serves both the USD and the ZWG book, and an entry's own currency decides which
              book it falls in.
            </caption>
            <thead>
              <tr>
                <th scope="col">Code and name</th>
                <th scope="col">Root type</th>
                <th scope="col">Statement</th>
                <th scope="col">Behaviour</th>
                <th scope="col">Posts to</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in chartRows" :key="row.account.id"
                  :class="{ 'gl-heading-row': row.account.is_group }">
                <td>
                  <span class="gl-indent" :style="{ paddingLeft: `${row.depth * 1.1}rem` }">
                    <button v-if="row.hasChildren" type="button" class="gl-twisty"
                            :aria-expanded="!collapsed.has(row.account.id)"
                            @click="toggleBranch(row.account.id)">
                      <component :is="collapsed.has(row.account.id) ? ChevronRight : ChevronDown"
                                 :size="13" aria-hidden="true" />
                      <span class="sr-only">
                        {{ collapsed.has(row.account.id) ? 'Expand' : 'Collapse' }}
                        {{ row.account.code }}
                      </span>
                    </button>
                    <span v-else class="gl-twisty-spacer" aria-hidden="true"></span>
                    <span class="ins-mono gl-code">{{ row.account.code }}</span>
                    <span class="gl-name">{{ row.account.name }}</span>
                  </span>
                </td>
                <td>
                  <span class="fin-pill">{{ ROOT_LABEL[row.account.root_type] }}</span>
                  <small class="gl-sub">normally {{ ROOT_SIDE[row.account.root_type] }}</small>
                </td>
                <td>
                  <small class="gl-sub">
                    {{ row.account.report_type === 'balance_sheet'
                      ? 'Financial position' : 'Financial performance' }}
                  </small>
                </td>
                <td>
                  <span v-if="row.account.account_type" class="fin-pill tone-info">
                    {{ row.account.account_type.replace(/_/g, ' ') }}
                  </span>
                  <small v-else class="gl-sub undefined-value">not classified</small>
                </td>
                <td>
                  <span v-if="row.account.is_group" class="gl-sub">
                    Heading — nothing posts here
                  </span>
                  <span v-else-if="!row.account.is_postable" class="gl-sub">
                    Not postable
                  </span>
                  <span v-else-if="row.account.status !== 'active'" class="gl-sub">
                    Inactive — accepts nothing further
                  </span>
                  <Check v-else :size="14" aria-hidden="true" class="gl-ok" />
                  <span v-if="!row.account.is_group && row.account.is_postable && row.account.status === 'active'"
                        class="sr-only">Postable</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="chartNote" class="gl-caption">
          <Info :size="14" aria-hidden="true" />
          <span>{{ chartNote }}</span>
        </p>
      </div>
    </section>

    <!-- ── Vouchers ────────────────────────────────────────────────────────────────────────── -->
    <section v-if="shows('vouchers')" class="ins-card" aria-labelledby="gl-vouchers-head">
      <div class="ins-card-head">
        <h2 id="gl-vouchers-head">
          Vouchers
          <span v-if="voucherTotal" class="ins-count">{{ voucherTotal }}</span>
        </h2>
        <span class="gl-asat">{{ store.selectedYear?.label ?? 'no year selected' }}</span>
      </div>
      <div class="ins-card-body">
        <div class="fin-bar">
          <label class="ins-search">
            <span class="sr-only">Search vouchers</span>
            <input v-model="voucherFilter.q" class="ins-input" type="search"
                   placeholder="Search number or narration" @change="loadVouchers" />
          </label>
          <select v-model="voucherFilter.status" class="ins-input gl-filter" aria-label="Status">
            <option :value="undefined">Draft and posted</option>
            <option value="draft">Drafts only</option>
            <option value="posted">Posted only</option>
          </select>
          <select v-model="voucherFilter.voucher_type" class="ins-input gl-filter" aria-label="Voucher type">
            <option :value="undefined">Every type</option>
            <option v-for="(label, type) in VOUCHER_TYPE_LABEL" :key="type" :value="type">{{ label }}</option>
          </select>
          <select v-model="voucherFilter.currency" class="ins-input gl-filter" aria-label="Which book">
            <option :value="undefined">Both books</option>
            <option value="USD">USD book</option>
            <option value="ZWG">ZWG book</option>
          </select>
          <button v-if="canPrepare" type="button" class="fin-btn primary"
                  :disabled="openPeriodCount === 0" @click="startVoucher">
            <Plus :size="14" aria-hidden="true" /> New voucher
          </button>
          <button type="button" class="fin-btn small" :disabled="vouchersLoading" @click="loadVouchers">
            <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': vouchersLoading }" /> Refresh
          </button>
        </div>

        <p v-if="canPrepare && openPeriodCount === 0 && periods.length > 0" class="gl-absent">
          <Info :size="14" aria-hidden="true" />
          <span>
            No accounting period is open, so a voucher could be drafted but not posted. Reopen a
            period above first.
          </span>
        </p>
        <p v-else-if="!canPrepare" class="gl-absent">
          <Info :size="14" aria-hidden="true" />
          <span>
            There is no New voucher control because drafting one needs
            <code>finance.ledger.voucher.prepare</code>, which your role does not hold.
            {{ store.whyUnavailable('finance.ledger.voucher.prepare') }}
          </span>
        </p>

        <!-- ── The editor ─────────────────────────────────────────────────────────────────── -->
        <form v-if="editorOpen && canPrepare" class="gl-editor" @submit.prevent="saveDraft">
          <h3 class="gl-editor-head">
            {{ editingId ? `Draft ${editorHeader.voucher_no}` : 'New voucher' }}
          </h3>

          <div class="ins-form">
            <div class="ins-field">
              <label class="ins-label" for="gl-v-no">Voucher number</label>
              <input id="gl-v-no" v-model="editorHeader.voucher_no" class="ins-input"
                     maxlength="60" required :disabled="!!editingId" />
              <p class="ins-hint">The council's own number, as it appears on the document.</p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-v-type">Type</label>
              <select id="gl-v-type" v-model="editorHeader.voucher_type" class="ins-input"
                      :disabled="!!editingId">
                <option v-for="type in CREATABLE_TYPES" :key="type" :value="type">
                  {{ VOUCHER_TYPE_LABEL[type] }}
                </option>
              </select>
              <p class="ins-hint">
                A reversal is not here: it is raised only by reversing a posted voucher, so its
                lines must mirror an original exactly.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-v-ccy">Book</label>
              <select id="gl-v-ccy" v-model="editorHeader.currency" class="ins-input"
                      :disabled="!!editingId">
                <option value="USD">USD</option>
                <option value="ZWG">ZWG</option>
              </select>
              <p class="ins-hint">
                One currency for the whole voucher. There is no per-line currency, because a journal
                may never span the two books — no conversion basis has been approved.
              </p>
            </div>
            <div class="ins-field">
              <label class="ins-label" for="gl-v-date">Posting date</label>
              <input id="gl-v-date" v-model="editorHeader.posting_date" class="ins-input"
                     type="date" required />
              <p class="ins-hint">
                It decides the accounting period, which must be open. A date in no period is refused.
              </p>
            </div>
            <div class="ins-field full">
              <label class="ins-label" for="gl-v-narr">Narration</label>
              <input id="gl-v-narr" v-model="editorHeader.narration" class="ins-input" maxlength="2000" />
            </div>
          </div>

          <div class="fin-table-wrap">
            <table class="fin-table gl-lines">
              <caption class="sr-only">
                The voucher's double-entry lines. Each line carries either a debit or a credit,
                never both.
              </caption>
              <thead>
                <tr>
                  <th scope="col" class="num">#</th>
                  <th scope="col">Account</th>
                  <th scope="col">Side</th>
                  <th scope="col" class="num">Amount ({{ editorHeader.currency }})</th>
                  <th scope="col">Narration</th>
                  <th scope="col"><span class="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in editorLines" :key="index">
                  <td class="num">{{ index + 1 }}</td>
                  <td>
                    <select v-model="line.ledger_account_id" class="ins-input" required
                            :aria-label="`Account for line ${index + 1}`">
                      <option value="">Choose an account…</option>
                      <option v-for="a in postableAccounts" :key="a.id" :value="a.id">
                        {{ a.code }} — {{ a.name }}
                      </option>
                    </select>
                  </td>
                  <td>
                    <select v-model="line.side" class="ins-input gl-side"
                            :aria-label="`Debit or credit for line ${index + 1}`">
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </td>
                  <td class="num">
                    <input v-model="line.amount" class="ins-input gl-amount" inputmode="decimal"
                           placeholder="0.00" required
                           :aria-label="`Amount for line ${index + 1}`" />
                  </td>
                  <td>
                    <input v-model="line.narration" class="ins-input" maxlength="500"
                           :aria-label="`Narration for line ${index + 1}`" />
                  </td>
                  <td>
                    <button type="button" class="ins-iconbtn" :disabled="editorLines.length <= 2"
                            @click="removeLine(index)">
                      <Trash2 :size="13" aria-hidden="true" />
                      <span class="sr-only">Remove line {{ index + 1 }}</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            <button type="button" class="fin-btn small" @click="addLine">
              <Plus :size="12" aria-hidden="true" /> Add a line
            </button>
          </p>

          <!-- The balance panel. The figures are the DATABASE's, and the panel admits when it is
               out of date rather than showing a stale total as though it were current. -->
          <div class="gl-balance" :class="{ 'is-stale': balanceStale, 'is-off': savedBalance && Number(savedBalance.difference) !== 0 }"
               data-test="draft-balance">
            <dl class="gl-balance-figures">
              <div>
                <dt>Debits</dt>
                <dd>{{ savedBalance ? formatMoney(savedBalance.debit_total, editorHeader.currency) : 'not yet computed' }}</dd>
              </div>
              <div>
                <dt>Credits</dt>
                <dd>{{ savedBalance ? formatMoney(savedBalance.credit_total, editorHeader.currency) : 'not yet computed' }}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd :class="{ 'gl-off': savedBalance && Number(savedBalance.difference) !== 0 }">
                  {{ savedBalance ? formatMoney(savedBalance.difference, editorHeader.currency) : 'not yet computed' }}
                </dd>
              </div>
            </dl>
            <p class="gl-balance-says">
              <template v-if="!savedBalance">
                These totals are computed <strong>in the database, over exact decimals</strong>, and
                never added up in this browser — a binary float would be wrong in the last penny on
                a council-scale figure. Save the draft to compute them.
              </template>
              <template v-else-if="balanceStale">
                <AlertTriangle :size="14" aria-hidden="true" />
                The lines have changed since these figures were computed, so they no longer describe
                what is on screen. Save the draft again.
              </template>
              <template v-else-if="Number(savedBalance.difference) !== 0">
                <AlertTriangle :size="14" aria-hidden="true" />
                This voucher does <strong>not balance</strong>. It cannot be posted until the debits
                equal the credits, and the refusal comes from the database rather than from this
                screen.
              </template>
              <template v-else>
                <CheckCircle2 :size="14" aria-hidden="true" />
                The debits equal the credits. The draft can be posted — by somebody other than
                whoever prepared it.
              </template>
            </p>
          </div>

          <div class="gl-form-foot">
            <button type="button" class="fin-btn" @click="closeEditor">
              {{ editingId ? 'Close' : 'Cancel' }}
            </button>
            <button type="submit" class="fin-btn primary" :disabled="!editorReady || busy === 'draft'">
              {{ busy === 'draft' ? 'Saving…' : editingId ? 'Save and recompute' : 'Save as draft' }}
            </button>
          </div>
          <p v-if="savedAndBalanced" class="gl-caption">
            <Info :size="14" aria-hidden="true" />
            <span>
              Saved and balanced. It is in the register below as a draft; posting it is a separate
              act by a second person, and nothing is in the book of account until then.
            </span>
          </p>
        </form>

        <!-- ── The register ───────────────────────────────────────────────────────────────── -->
        <p v-if="vouchersLoading && vouchers.length === 0" class="gl-loading" role="status">
          Reading the voucher register…
        </p>

        <div v-else-if="!yearId" class="fin-empty">
          <strong>No financial year is selected.</strong>
          <p>Choose a reporting period above.</p>
        </div>

        <div v-else-if="vouchers.length === 0" class="fin-empty">
          <strong>No voucher has been raised for {{ store.selectedYear?.label }}.</strong>
          <p>
            A voucher is the business document — a journal, an opening balance, a rates bill, a
            receipt — and posting it is what writes the ledger. Nothing is in the book of account
            until a voucher has been posted by somebody other than whoever prepared it.
          </p>
        </div>

        <div v-else class="fin-table-wrap">
          <table class="fin-table">
            <caption class="sr-only">
              Vouchers for {{ store.selectedYear?.label }}. Each carries one currency; the debit and
              credit totals are per voucher and no figure spans the two books.
            </caption>
            <thead>
              <tr>
                <th scope="col">Voucher</th>
                <th scope="col">Type</th>
                <th scope="col">Date</th>
                <th scope="col" class="ccy">Book</th>
                <th scope="col" class="num">Debits</th>
                <th scope="col" class="num">Credits</th>
                <th scope="col">State</th>
                <th scope="col">Prepared / posted</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="v in vouchers" :key="v.id">
                <tr :class="{ 'gl-open': openVoucherId === v.id }">
                  <td>
                    <button type="button" class="fin-link ins-mono" @click="openVoucher(v.id)">
                      {{ v.voucher_no }}
                    </button>
                    <br v-if="v.narration" />
                    <small v-if="v.narration" class="gl-sub">{{ v.narration }}</small>
                  </td>
                  <td><small>{{ VOUCHER_TYPE_LABEL[v.voucher_type] ?? v.voucher_type }}</small></td>
                  <td>{{ formatDate(v.posting_date) }}</td>
                  <td class="ccy">{{ v.currency }}</td>
                  <!-- Each figure in the voucher's own currency. There is no column that mixes them. -->
                  <td class="num">{{ formatMoney(v.debit_total, v.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(v.credit_total, v.currency, { bare: true }) }}</td>
                  <td>
                    <span class="fin-pill"
                          :class="v.status === 'posted' ? 'tone-positive' : v.status === 'cancelled' ? 'tone-negative' : 'tone-info'">
                      {{ v.status }}
                    </span>
                    <br v-if="v.status === 'draft' && !draftBalances(v)" />
                    <small v-if="v.status === 'draft' && !draftBalances(v)" class="gl-off">
                      does not balance
                    </small>
                    <br v-if="v.reversed_by_voucher_no" />
                    <small v-if="v.reversed_by_voucher_no" class="gl-sub">
                      reversed by {{ v.reversed_by_voucher_no }}
                    </small>
                    <br v-if="v.reverses_voucher_no" />
                    <small v-if="v.reverses_voucher_no" class="gl-sub">
                      reverses {{ v.reverses_voucher_no }}
                    </small>
                  </td>
                  <td>
                    <small class="gl-sub">{{ v.prepared_by_name ?? 'unknown' }}</small><br />
                    <small class="gl-sub" :class="{ 'undefined-value': !v.posted_by_name }">
                      {{ v.posted_by_name ?? 'not posted' }}
                    </small>
                  </td>
                  <td>
                    <div class="gl-row-acts">
                      <!-- The Post control exists only where it would succeed. Where this person
                           prepared the voucher there is no button and the sentence below says why. -->
                      <button v-if="v.status === 'draft' && canPost && !isOwnDraft(v) && draftBalances(v)"
                              type="button" class="fin-btn small primary" :disabled="busy === v.id"
                              @click="post(v)">
                        <Check :size="12" aria-hidden="true" /> Post
                      </button>
                      <button v-if="v.status === 'posted' && canReverse && !v.reversed_by_voucher_no && v.voucher_type !== 'reversal'"
                              type="button" class="fin-btn small" :disabled="busy === v.id"
                              @click="reverse(v)">
                        <Undo2 :size="12" aria-hidden="true" /> Reverse
                      </button>
                      <button v-if="v.status === 'draft' && canPrepare && isOwnDraft(v)"
                              type="button" class="fin-btn small" :disabled="busy === v.id"
                              @click="discard(v)">
                        <Trash2 :size="12" aria-hidden="true" /> Discard
                      </button>
                    </div>
                    <p v-if="v.status === 'draft' && canPost && isOwnDraft(v)" class="gl-sod">
                      <Info :size="12" aria-hidden="true" />
                      You prepared this voucher, so posting it is not yours to do. Separation of
                      duties is a constraint on the record, not a preference of this screen.
                    </p>
                    <p v-else-if="v.status === 'draft' && !canPost" class="gl-sod">
                      <Info :size="12" aria-hidden="true" />
                      Posting needs <code>finance.ledger.voucher.post</code>, which your role does
                      not hold.
                    </p>
                    <p v-else-if="v.status === 'draft' && !draftBalances(v)" class="gl-sod">
                      <AlertTriangle :size="12" aria-hidden="true" />
                      It does not balance, so there is nothing to post yet.
                    </p>
                    <p v-else-if="v.status === 'posted' && v.voucher_type !== 'reversal' && !v.reversed_by_voucher_no && !canReverse" class="gl-sod">
                      <Info :size="12" aria-hidden="true" />
                      A posted voucher is never edited. Correcting it needs
                      <code>finance.ledger.voucher.reverse</code>.
                    </p>
                  </td>
                </tr>

                <!-- ── One voucher, in full ─────────────────────────────────────────────── -->
                <tr v-if="openVoucherId === v.id" class="gl-detail-row">
                  <td :colspan="9">
                    <p v-if="detailLoading" class="gl-loading" role="status">Reading the voucher…</p>
                    <div v-else-if="detail" class="gl-detail">
                      <div class="gl-detail-head">
                        <h4>
                          {{ detail.voucher.voucher_no }} ·
                          {{ VOUCHER_TYPE_LABEL[detail.voucher.voucher_type] ?? detail.voucher.voucher_type }} ·
                          {{ detail.voucher.currency }} book
                        </h4>
                        <button type="button" class="ins-iconbtn" @click="openVoucher(v.id)">
                          <X :size="14" aria-hidden="true" /><span class="sr-only">Close</span>
                        </button>
                      </div>

                      <dl class="gl-meta">
                        <div><dt>Period</dt>
                          <dd v-if="detail.voucher.period_no">
                            {{ detail.voucher.period_no }} — {{ detail.voucher.period_label }}
                            ({{ detail.voucher.period_status }})
                          </dd>
                          <dd v-else class="undefined-value">not assigned until posted</dd>
                        </div>
                        <div><dt>Prepared</dt>
                          <dd>{{ detail.voucher.prepared_by_name ?? 'unknown' }} ·
                            {{ formatDateTime(detail.voucher.prepared_at) }}</dd>
                        </div>
                        <div><dt>Posted</dt>
                          <dd v-if="detail.voucher.posted_at">
                            {{ detail.voucher.posted_by_name ?? 'unknown' }} ·
                            {{ formatDateTime(detail.voucher.posted_at) }}
                          </dd>
                          <dd v-else class="undefined-value">not posted</dd>
                        </div>
                      </dl>

                      <h5 class="gl-detail-sub">Lines</h5>
                      <div class="fin-table-wrap">
                        <table class="fin-table">
                          <thead>
                            <tr>
                              <th scope="col" class="num">#</th>
                              <th scope="col">Account</th>
                              <th scope="col" class="num">Debit</th>
                              <th scope="col" class="num">Credit</th>
                              <th scope="col">Party</th>
                              <th scope="col">Settles</th>
                              <th scope="col">Narration</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="l in detail.lines" :key="l.id">
                              <td class="num">{{ l.line_no }}</td>
                              <td>
                                <span class="ins-mono">{{ l.account_code }}</span>
                                <br /><small class="gl-sub">{{ l.account_name }}</small>
                              </td>
                              <td class="num">
                                {{ Number(l.debit) === 0 ? '' : formatMoney(l.debit, detail.voucher.currency, { bare: true }) }}
                              </td>
                              <td class="num">
                                {{ Number(l.credit) === 0 ? '' : formatMoney(l.credit, detail.voucher.currency, { bare: true }) }}
                              </td>
                              <td>
                                <small :class="{ 'undefined-value': !l.party_name }">
                                  {{ l.party_name ?? 'none recorded' }}
                                </small>
                              </td>
                              <td>
                                <small v-if="l.against_voucher_no" class="ins-mono">{{ l.against_voucher_no }}</small>
                                <small v-else class="gl-sub">—</small>
                              </td>
                              <td><small class="gl-sub">{{ l.narration ?? '' }}</small></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <dl class="gl-meta gl-meta-balance">
                        <div><dt>Draft debits</dt>
                          <dd>{{ formatMoney(detail.draft_balance.debit_total, detail.voucher.currency) }}</dd></div>
                        <div><dt>Draft credits</dt>
                          <dd>{{ formatMoney(detail.draft_balance.credit_total, detail.voucher.currency) }}</dd></div>
                        <div><dt>In the ledger</dt>
                          <dd>
                            {{ detail.posted_balance.entry_count }} entries ·
                            {{ formatMoney(detail.posted_balance.debit_total, detail.voucher.currency) }}
                            each side
                          </dd></div>
                      </dl>

                      <p v-if="detail.reversed_by" class="gl-caption gl-reversal">
                        <Undo2 :size="14" aria-hidden="true" />
                        <span>
                          Corrected by <strong>{{ detail.reversed_by.voucher_no }}</strong>, posted
                          {{ formatDate(detail.reversed_by.posting_date) }}:
                          {{ detail.reversed_by.narration }}. This voucher is
                          <strong>still posted and still part of the record</strong> — it is not
                          cancelled, struck through or hidden — and the two together net to nil on
                          every account.
                        </span>
                      </p>
                      <p v-else-if="detail.voucher.reverses_voucher_no" class="gl-caption gl-reversal">
                        <Undo2 :size="14" aria-hidden="true" />
                        <span>
                          This is the reversal of
                          <strong>{{ detail.voucher.reverses_voucher_no }}</strong>, which remains
                          posted beside it.
                        </span>
                      </p>
                      <p v-if="detail.note" class="gl-caption">
                        <Info :size="14" aria-hidden="true" /><span>{{ detail.note }}</span>
                      </p>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Own `gl-` prefix throughout. `finance.css` already uses `.fin-map` for a grid definition list
   and `.ins-bar` for a progress meter, so a container named for what it looks like would inherit
   someone else's layout. Nothing here is a colour literal: every value is an --ent-* token. */
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }

.gl-preamble,
.gl-caption,
.gl-absent {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.gl-preamble {
  padding: var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong);
  background: var(--ent-surface-2);
  color: var(--ent-text);
  font-size: var(--ent-fs-sm);
}
.gl-caption { margin-top: var(--ent-s3); }
.gl-absent {
  margin-top: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong); background: var(--ent-surface-2);
}
.gl-preamble :deep(svg), .gl-caption :deep(svg), .gl-absent :deep(svg) { flex: none; margin-top: 2px; }

.gl-filter { max-width: 13rem; }
.gl-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.gl-asat { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.gl-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.gl-ok { color: var(--ent-success); }
.gl-off { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }

.gl-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }

/* ── The chart, as an indented printed chart rather than a card grid ──────────────────────── */
.gl-indent { display: inline-flex; align-items: baseline; gap: 6px; }
.gl-twisty {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--ent-text-2); display: inline-flex; align-items: center;
}
.gl-twisty-spacer { display: inline-block; width: 13px; }
.gl-code { font-size: var(--ent-fs-xs); }
.gl-name { font-size: var(--ent-fs-sm); }
.gl-heading-row .gl-name { font-weight: var(--ent-fw-semibold); }
.gl-heading-row { background: var(--ent-surface-2); }

/* ── Periods, as a dense strip ───────────────────────────────────────────────────────────── */
.gl-periods { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.gl-period {
  display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap;
  padding: 6px 0; border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs);
}
.gl-period:last-child { border-bottom: 0; }
.gl-period-no {
  min-width: 1.6rem; text-align: right; font-variant-numeric: tabular-nums;
  color: var(--ent-text-3);
}
.gl-period-dates { min-width: 14rem; }
.gl-period-entries { color: var(--ent-text-3); }
.gl-period-acts { margin-left: auto; display: flex; gap: 4px; }

/* ── The editor ──────────────────────────────────────────────────────────────────────────── */
.gl-form, .gl-editor {
  margin: var(--ent-s3) 0;
  padding: var(--ent-s3);
  border: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
  display: flex; flex-direction: column; gap: var(--ent-s3);
}
.gl-editor-head, .gl-detail-head h4 {
  margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text);
}
.gl-form-foot { display: flex; justify-content: flex-end; gap: var(--ent-s2); }
.gl-side { max-width: 7rem; }
.gl-amount { text-align: right; font-variant-numeric: tabular-nums; max-width: 10rem; }

/* The balance panel is a definition list at body weight, not a hero metric: the figures are
   evidence under the journal, which is what a journal's foot looks like on paper. */
.gl-balance {
  padding: var(--ent-s3);
  border: 1px solid var(--ent-line);
  border-left-width: 2px;
  border-left-color: var(--ent-line-strong);
  background: var(--ent-surface);
}
.gl-balance.is-off { border-left-color: var(--ent-danger); }
.gl-balance.is-stale { border-left-color: var(--ent-warning); }
.gl-balance-figures { display: flex; flex-wrap: wrap; gap: var(--ent-s4); margin: 0 0 var(--ent-s2); }
.gl-balance-figures dt { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-3); }
.gl-balance-figures dd { margin: 2px 0 0; font-size: var(--ent-fs-md); font-variant-numeric: tabular-nums; color: var(--ent-text); }
.gl-balance-says {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.gl-balance-says :deep(svg) { flex: none; margin-top: 2px; }

/* ── Voucher rows and the expanded detail ────────────────────────────────────────────────── */
.gl-row-acts { display: flex; gap: 4px; flex-wrap: wrap; min-width: 6rem; }
.gl-sod {
  margin: 4px 0 0; display: flex; align-items: flex-start; gap: 4px;
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); max-width: 22rem;
}
.gl-sod :deep(svg) { flex: none; margin-top: 2px; }
.gl-open > td { background: var(--ent-surface-2); }
.gl-detail-row > td { background: var(--ent-surface-2); padding: var(--ent-s3); }
.gl-detail { display: flex; flex-direction: column; gap: var(--ent-s2); }
.gl-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ent-s3); }
.gl-detail-sub {
  margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-2); text-transform: uppercase; letter-spacing: 0.04em;
}
.gl-meta { display: flex; flex-wrap: wrap; gap: var(--ent-s4); margin: 0; }
.gl-meta dt { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-3); }
.gl-meta dd { margin: 2px 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text); }
.gl-meta-balance dd { font-variant-numeric: tabular-nums; }
.gl-reversal { color: var(--ent-text); }

.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}

/* The refresh spinner is decoration. A reader who has asked for less motion keeps the label and
   the disabled state, which carry the same information. */
@media (prefers-reduced-motion: reduce) {
  .ins-spin { animation: none; }
}
</style>
