<script setup lang="ts">
/**
 * Financial Statements: financial position, financial performance, and cash receipts and payments.
 * One book at a time, never a combined figure. Every figure is shown as the server sent it. The
 * tab, the book, the dates and the performance options live in the route query, so Back and
 * refresh keep them. A response that arrives after the person has moved on is thrown away.
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CheckCircle2, Download, FileText, Printer } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type {
  CashStatement, Currency, LedgerRootType, PerformanceStatement, Periodicity, PositionStatement, StatementSection,
} from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import DateRange from '../kit/DateRange.vue'
import { csvName, saveBlob } from '../kit/csv'
import '../kit/statement.css'
import '../kit/print.css'

type Statement = 'position' | 'performance' | 'cash'
const TABS: { key: Statement; label: string }[] = [
  { key: 'position', label: 'Financial position' },
  { key: 'performance', label: 'Financial performance' },
  { key: 'cash', label: 'Cash receipts and payments' },
]
const PERIODICITIES: { key: Periodicity; label: string }[] = [
  { key: 'monthly', label: 'Monthly' }, { key: 'quarterly', label: 'Quarterly' },
  { key: 'half_yearly', label: 'Half-yearly' }, { key: 'yearly', label: 'Yearly' },
]
const TITLES: Record<LedgerRootType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Net assets and equity', revenue: 'Revenue', expense: 'Expenditure',
}

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const position = ref<PositionStatement | null>(null)
const performance = ref<PerformanceStatement | null>(null)
const cash = ref<CashStatement | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const exporting = ref(false)
const exportError = ref<string | null>(null)

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Today as the council's calendar date, from the LOCAL clock. */
function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** The earlier of today and the year end, and never before the year start. */
const defaultAsAt = computed(() => {
  const y = store.selectedYear
  const today = localToday()
  if (!y) return today
  let at = today < y.end_date ? today : y.end_date
  if (at < y.start_date) at = y.start_date
  return at
})

const statement = computed<Statement>(() => {
  const s = q('statement')
  return s === 'performance' || s === 'cash' ? s : 'position'
})
const book = computed<Currency>(() => {
  const b = q('book')
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency === 'ZWG' ? 'ZWG' : 'USD'
})
/** A date from the address counts only when it falls inside the selected year, so a year switch never asks for another year's date. */
const inYear = (d: string): boolean => {
  const y = store.selectedYear
  return DATE.test(d) && (!y || (d >= y.start_date && d <= y.end_date))
}
const asAt = computed(() => (inYear(q('as_at')) ? q('as_at') : defaultAsAt.value))
const from = computed(() => (inYear(q('from')) ? q('from') : store.selectedYear?.start_date ?? ''))
const to = computed(() => (inYear(q('to')) ? q('to') : defaultAsAt.value))
const periodicity = computed<Periodicity | ''>(() => PERIODICITIES.find((p) => p.key === q('periodicity'))?.key ?? '')
const accumulated = computed(() => q('accumulated') === '1')
const compare = computed(() => q('compare') === '1')

/** The parameters of the statement on screen. The same object feeds the load and the CSV. */
const params = computed(() => {
  const financial_year_id = store.selectedYearId as string
  if (statement.value === 'cash') return { financial_year_id, from: from.value, to: to.value }
  if (statement.value === 'performance') {
    return {
      financial_year_id, currency: book.value, as_at: asAt.value,
      ...(compare.value ? { compare: 'prior_year' as const } : {}),
      ...(periodicity.value ? { periodicity: periodicity.value } : {}),
      ...(periodicity.value && accumulated.value ? { accumulated: true } : {}),
    }
  }
  return { financial_year_id, currency: book.value, as_at: asAt.value }
})

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  position.value = null
  performance.value = null
  cash.value = null
  error.value = null
  exportError.value = null
  if (!store.selectedYearId) { loading.value = false; return }
  loading.value = true
  const which = statement.value
  const p = params.value
  try {
    if (which === 'position') {
      const r = await ledgerApi.position(p as Parameters<typeof ledgerApi.position>[0])
      if (seq === reqId) position.value = r
    } else if (which === 'performance') {
      const r = await ledgerApi.performance(p as Parameters<typeof ledgerApi.performance>[0])
      if (seq === reqId) performance.value = r
    } else {
      const r = await ledgerApi.cashStatement(p as Parameters<typeof ledgerApi.cashStatement>[0])
      if (seq === reqId) cash.value = r
    }
  } catch (err) {
    if (seq === reqId) error.value = messageOf(err, 'The statement could not be loaded.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
watch(
  () => JSON.stringify([store.selectedYearId, route.query.statement, route.query.book, route.query.as_at, route.query.from,
    route.query.to, route.query.periodicity, route.query.accumulated, route.query.compare]),
  load, { immediate: true },
)

function setQuery(over: Record<string, string | undefined>): void {
  const query = { ...route.query, ...over }
  for (const k of Object.keys(query)) if (query[k] === undefined || query[k] === '') delete query[k]
  void router.replace({ query })
}
const onTab = (s: Statement) => setQuery({ statement: s === 'position' ? undefined : s })
const onBook = (c: Currency) => setQuery({ book: c })
const onAsAt = (e: Event) => setQuery({ as_at: (e.target as HTMLInputElement).value })
const onPeriodicity = (e: Event) => setQuery({ periodicity: (e.target as HTMLSelectElement).value || undefined, accumulated: undefined })
const onAccumulated = (e: Event) => setQuery({ accumulated: (e.target as HTMLInputElement).checked ? '1' : undefined })
const onCompare = (e: Event) => setQuery({ compare: (e.target as HTMLInputElement).checked ? '1' : undefined })

function onTabKey(e: KeyboardEvent): void {
  if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return
  e.preventDefault()
  const i = TABS.findIndex((t) => t.key === statement.value)
  const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]
  onTab(next.key)
}

// ── Position ──
const positionBook = computed(() => position.value?.books.find((b) => b.currency === book.value))
const surplus = computed(() => position.value?.surplus_to_date?.find((s) => s.currency === book.value))
const positionSections = computed<{ root: LedgerRootType; section: StatementSection | null }[]>(() =>
  (['asset', 'liability', 'equity'] as const)
    .map((root) => ({ root, section: positionBook.value?.sections.find((s) => s.root_type === root) ?? null }))
    .filter((s) => s.section || (s.root === 'equity' && surplus.value)))
const check = computed(() => position.value?.check?.find((c) => c.currency === book.value))
const subtotal = (root: LedgerRootType) =>
  position.value?.subtotals.find((s) => s.currency === book.value && s.root_type === root)?.subtotal

// ── Performance ──
const perfBook = computed(() => performance.value?.books.find((b) => b.currency === book.value))
const perfSections = computed(() => (['revenue', 'expense'] as const)
  .map((root) => ({ root, section: perfBook.value?.sections.find((s) => s.root_type === root) ?? null }))
  .filter((s) => s.section))
const periods = computed(() => performance.value?.periods ?? null)
const priorYear = computed(() => performance.value?.prior_year ?? null)
const showPrior = computed(() => !!priorYear.value && compare.value)
const noPrior = computed(() => compare.value && !!performance.value && !priorYear.value)
const periodFigure = (key: string, id: string): string | undefined =>
  performance.value?.period_rows.find((r) => r.currency === book.value && r.key === key && r.ledger_account_id === id)?.balance
const priorFigure = (id: string): string | undefined =>
  performance.value?.prior?.find((r) => r.currency === book.value && r.ledger_account_id === id)?.balance

// ── Cash ──
const cashAccounts = computed(() => cash.value?.accounts.filter((a) => a.currency === book.value) ?? [])
const cashBook = computed(() => cash.value?.books.find((b) => b.currency === book.value))
const cashCounters = computed(() => cash.value?.by_counter.filter((c) => c.currency === book.value) ?? [])
const cashReconcile = computed(() => cash.value?.reconciles.find((r) => r.currency === book.value))

const current = computed(() => (statement.value === 'position' ? position.value : statement.value === 'performance' ? performance.value : cash.value))
const incomplete = computed<string[]>(() => {
  const list = statement.value === 'position' ? position.value?.incomplete : statement.value === 'performance' ? performance.value?.incomplete : undefined
  return list ?? []
})
const note = computed(() => current.value?.note ?? '')
const nothing = computed(() => {
  if (statement.value === 'position') return !!position.value && !positionBook.value?.sections.length && !surplus.value
  if (statement.value === 'performance') return !!performance.value && perfSections.value.length === 0
  return !!cash.value && cashAccounts.value.length === 0 && !cashBook.value
})

const num = (v: string | undefined | null) => (v === undefined || v === null || Number(v) === 0 ? '—' : formatMoney(v, null, { bare: true }))

/** The CSV error arrives as a Blob holding the server's JSON. */
async function exportMessage(err: unknown): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text())
      const m = body?.message ?? body?.error?.message
      if (typeof m === 'string' && m) return m
    } catch { /* fall through */ }
  }
  return 'The export could not be made.'
}
function printPage(): void { window.print() }
async function exportCsv(): Promise<void> {
  exporting.value = true
  exportError.value = null
  const which = statement.value
  const p = params.value
  try {
    const blob = which === 'position' ? await ledgerApi.positionCsv(p as Parameters<typeof ledgerApi.positionCsv>[0])
      : which === 'performance' ? await ledgerApi.performanceCsv(p as Parameters<typeof ledgerApi.performanceCsv>[0])
        : await ledgerApi.cashStatementCsv(p as Parameters<typeof ledgerApi.cashStatementCsv>[0])
    saveBlob(blob, csvName(which === 'cash'
      ? ['cash-receipts-and-payments', from.value, to.value]
      : [`statement-${which}`, book.value, asAt.value]))
  } catch (err) {
    exportError.value = await exportMessage(err)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Financial Statements</h2>
      <p>The statements of financial position and performance, and of cash receipts and payments, one currency at a time.</p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The statements are drawn for one financial year at a time.</p>
  </section>

  <template v-else>
    <div class="cw-seg fs-tabs no-print" role="tablist" aria-label="Statement" @keydown="onTabKey">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab" :id="`fs-tab-${t.key}`" :aria-selected="statement === t.key ? 'true' : 'false'"
        aria-controls="fs-panel" :tabindex="statement === t.key ? 0 : -1" @click="onTab(t.key)">{{ t.label }}</button>
    </div>

    <form class="cw-card fs-filters no-print" aria-label="Statement options" @submit.prevent>
      <div class="cw-field">
        <span class="cw-label">Book</span>
        <BookSwitch :model-value="book" label="Book" @update:model-value="onBook" />
      </div>
      <div v-if="statement !== 'cash'" class="cw-field">
        <label class="cw-label" for="fs-asat">As at</label>
        <input id="fs-asat" class="cw-input" type="date" :value="asAt" :min="store.selectedYear?.start_date" :max="store.selectedYear?.end_date" @change="onAsAt" />
      </div>
      <DateRange v-else :from="from" :to="to" :min="store.selectedYear?.start_date" :max="store.selectedYear?.end_date"
        @update:from="(v: string) => setQuery({ from: v })" @update:to="(v: string) => setQuery({ to: v })" />
      <template v-if="statement === 'performance'">
        <div class="cw-field">
          <label class="cw-label" for="fs-per">Periods</label>
          <select id="fs-per" class="cw-select" :value="periodicity" @change="onPeriodicity">
            <option value="">Whole year</option>
            <option v-for="p in PERIODICITIES" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
        </div>
        <label v-if="periodicity" class="fs-check"><input type="checkbox" :checked="accumulated" @change="onAccumulated" /> Year to date in each period</label>
        <label class="fs-check"><input type="checkbox" :checked="compare" @change="onCompare" /> Compare with {{ compare && priorYear ? priorYear.label : 'the prior year' }}</label>
      </template>
      <div class="fs-actions">
        <button type="button" class="cw-btn" :disabled="exporting || loading" @click="exportCsv"><Download :size="16" aria-hidden="true" /> Export CSV</button>
        <button type="button" class="cw-btn" @click="printPage"><Printer :size="16" aria-hidden="true" /> Print</button>
      </div>
    </form>

    <p v-if="exportError" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ exportError }}</p>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <div id="fs-panel" role="tabpanel" :aria-labelledby="`fs-tab-${statement}`">
      <section v-if="loading" class="cw-card"><div class="cw-card-body" style="padding-top: 16px"><span class="cw-skel" /><span class="cw-skel" /></div></section>

      <template v-else-if="current">
        <div v-if="incomplete.length" class="cw-banner-msg cw-banner-msg--neg fs-incomplete" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />
          <div>
            <strong>This statement is not complete.</strong>
            <ul><li v-for="n in incomplete" :key="n">{{ n }}</li></ul>
          </div>
        </div>

        <section v-if="nothing" class="cw-card">
          <p class="cw-empty"><strong>Nothing has been posted to the {{ book }} book for this statement.</strong>Post a journal, or choose a later date, and the figures appear here.</p>
        </section>

        <!-- Financial position -->
        <section v-else-if="statement === 'position'" class="cw-card" :aria-label="`Financial position, ${book} book`">
          <div class="cw-card-head"><h3>Financial position, {{ book }} book, as at {{ formatDate(asAt) }}</h3></div>
          <p v-if="check?.balances" class="cw-banner-msg cw-banner-msg--pos" role="status"><CheckCircle2 :size="18" aria-hidden="true" />Assets equal liabilities plus equity.</p>
          <p v-else-if="check" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />The statement does not balance: assets {{ formatMoney(check.assets, book, { bare: true }) }}, liabilities {{ formatMoney(check.liabilities, book, { bare: true }) }}, equity and surplus {{ formatMoney(check.equity_and_surplus, book, { bare: true }) }}.</p>
          <div class="cw-card-body cw-table-wrap">
            <table class="st-table">
              <caption class="sr-only">Financial position, {{ book }} book</caption>
              <thead><tr><th>Account</th><th class="st-num">{{ book }}</th></tr></thead>
              <template v-for="s in positionSections" :key="s.root">
                <tbody>
                  <tr class="st-sub"><th colspan="2" scope="colgroup">{{ TITLES[s.root] }}</th></tr>
                  <tr v-for="a in s.section?.accounts ?? []" :key="a.ledger_account_id ?? a.account_name">
                    <td>{{ a.account_code }} {{ a.account_name }}</td>
                    <td class="st-num">{{ formatMoney(a.balance, book, { bare: true }) }}</td>
                  </tr>
                  <tr v-if="subtotal(s.root)" class="st-total"><th scope="row">{{ s.root === 'equity' && surplus ? 'Total equity before surplus to date' : `Total ${TITLES[s.root].toLowerCase()}` }}</th><td class="st-num">{{ formatMoney(subtotal(s.root), book, { bare: true }) }}</td></tr>
                  <tr v-if="s.root === 'equity' && surplus" class="fs-surplus">
                    <td>{{ surplus.side === 'surplus' ? 'Surplus to date' : 'Deficit to date' }}</td>
                    <td class="st-num">{{ formatMoney(surplus.amount, book, { bare: true }) }}</td>
                  </tr>
                  <tr v-if="s.root === 'equity' && surplus && check" class="st-total fs-equity-total"><th scope="row">Equity including surplus to date</th><td class="st-num">{{ formatMoney(check.equity_and_surplus, book, { bare: true }) }}</td></tr>
                </tbody>
              </template>
            </table>
          </div>
        </section>

        <!-- Financial performance -->
        <section v-else-if="statement === 'performance'" class="cw-card" :aria-label="`Financial performance, ${book} book`">
          <div class="cw-card-head"><h3>Financial performance, {{ book }} book, {{ performance?.financial_year.label }} to {{ formatDate(asAt) }}</h3></div>
          <p v-if="noPrior" class="cw-hint fs-hint" role="status">There is no prior year to compare with.</p>
          <div class="cw-card-body cw-table-wrap">
            <table class="st-table">
              <caption class="sr-only">Financial performance, {{ book }} book</caption>
              <thead>
                <tr>
                  <th>Account</th>
                  <th v-for="p in periods ?? []" :key="p.key" class="st-num">{{ p.label }}</th>
                  <th class="st-num">{{ periods ? 'Year' : book }}</th>
                  <th v-if="showPrior" class="st-num">{{ priorYear?.label }}</th>
                </tr>
              </thead>
              <template v-for="s in perfSections" :key="s.root">
                <tbody>
                  <tr class="st-sub"><th :colspan="1 + (periods?.length ?? 0) + 1 + (showPrior ? 1 : 0)" scope="colgroup">{{ TITLES[s.root] }}</th></tr>
                  <tr v-for="a in s.section?.accounts ?? []" :key="a.ledger_account_id ?? a.account_name">
                    <td>{{ a.account_code }} {{ a.account_name }}</td>
                    <td v-for="p in periods ?? []" :key="p.key" class="st-num">{{ num(periodFigure(p.key, a.ledger_account_id ?? '')) }}</td>
                    <td class="st-num">{{ formatMoney(a.balance, book, { bare: true }) }}</td>
                    <td v-if="showPrior" class="st-num">{{ priorFigure(a.ledger_account_id ?? '') === undefined ? '—' : formatMoney(priorFigure(a.ledger_account_id ?? ''), book, { bare: true }) }}</td>
                  </tr>
                </tbody>
              </template>
            </table>
          </div>
          <p v-if="periods && accumulated" class="cw-hint fs-hint">Each period column is the year to date, so the columns overlap and are not added together.</p>
        </section>

        <!-- Cash receipts and payments -->
        <template v-else>
          <section class="cw-card" :aria-label="`Cash receipts and payments, ${book} book`">
            <div class="cw-card-head"><h3>Cash receipts and payments, {{ book }} book, {{ formatDate(cash!.from) }} to {{ formatDate(cash!.to) }}</h3></div>
            <p v-if="cashReconcile && cashReconcile.agrees === false" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />The analysis by counter-side does not agree with the movement in cash: movement {{ formatMoney(cashReconcile.movement, book, { bare: true }) }}, analysed {{ formatMoney(cashReconcile.analysed, book, { bare: true }) }}.</p>
            <p v-else-if="cashReconcile" class="cw-banner-msg cw-banner-msg--pos" role="status"><CheckCircle2 :size="18" aria-hidden="true" />The analysis agrees with the movement in cash.</p>
            <div class="cw-card-body cw-table-wrap">
              <table class="st-table">
                <caption class="sr-only">Cash by account, {{ book }} book</caption>
                <thead><tr><th>Account</th><th class="st-num">Opening</th><th class="st-num">Receipts</th><th class="st-num">Payments</th><th class="st-num">Closing</th></tr></thead>
                <tbody>
                  <tr v-for="a in cashAccounts" :key="a.id">
                    <td>{{ a.code }} {{ a.name }}</td>
                    <td class="st-num">{{ formatMoney(a.opening, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(a.receipts, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(a.payments, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(a.closing, book, { bare: true }) }}</td>
                  </tr>
                </tbody>
                <tfoot v-if="cashBook">
                  <tr class="st-total"><th scope="row">Total {{ book }}</th>
                    <td class="st-num">{{ formatMoney(cashBook.opening, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(cashBook.receipts, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(cashBook.payments, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(cashBook.closing, book, { bare: true }) }}</td></tr>
                </tfoot>
              </table>
            </div>
          </section>
          <section class="cw-card" :aria-label="`Analysis by counter-side, ${book} book`">
            <div class="cw-card-head"><h3>Where the cash came from and went to</h3></div>
            <div class="cw-card-body cw-table-wrap">
              <table class="st-table">
                <caption class="sr-only">Analysis by counter-side, {{ book }} book</caption>
                <thead><tr><th>Counter-side</th><th class="st-num">Inflow</th><th class="st-num">Outflow</th><th class="st-num">Net</th></tr></thead>
                <tbody>
                  <tr v-for="c in cashCounters" :key="c.group">
                    <td>{{ c.label }}</td>
                    <td class="st-num">{{ formatMoney(c.inflow, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(c.outflow, book, { bare: true }) }}</td>
                    <td class="st-num">{{ formatMoney(c.net, book, { bare: true }) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </template>

        <p v-if="note" class="cw-hint fs-note">{{ note }}</p>
      </template>
    </div>
  </template>
</template>

<style scoped>
.fs-tabs { display: flex; flex-wrap: wrap; margin-bottom: 12px; }
.fs-tabs button[aria-selected='true'] { background: #1f5aa8; color: #fff; font-weight: 600; }
.fs-filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.fs-check { display: flex; align-items: center; gap: 6px; font-size: 13.5px; }
.fs-actions { display: flex; gap: 8px; margin-left: auto; }
.fs-incomplete { align-items: flex-start; }
.fs-incomplete ul { margin: 4px 0 0; padding-left: 18px; }
.fs-hint, .fs-note { margin: 8px 16px 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
