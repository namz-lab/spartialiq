<script setup lang="ts">
/**
 * The trial balance at a date, one table per book, side by side from 1100 px and stacked below.
 * There is no combined figure: each book carries its own totals and its own "in balance" verdict,
 * all of which the server computed. The date, the before/after-closing choice and the nil-accounts
 * switch live in the route query, so Back and refresh keep them.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CheckCircle2, Download, Printer, Scale } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { ClosingMode, Currency, TrialBalanceResult, TrialBalanceRow } from '../../../models/ledgerTypes'
import { csvName, saveBlob } from '../kit/csv'
import '../kit/statement.css'
import '../kit/print.css'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const result = ref<TrialBalanceResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const exporting = ref(false)
const exportError = ref<string | null>(null)

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}

/** Today as the council's calendar date, from the LOCAL clock (toISOString would give UTC). */
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
const asAt = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(q('as_at')) ? q('as_at') : defaultAsAt.value))
const closing = computed<ClosingMode>(() => (q('closing') === 'before' ? 'before' : 'after'))
const includeNil = computed(() => q('nil') === '1')

const params = computed(() => ({
  financial_year_id: store.selectedYearId as string,
  as_at: asAt.value,
  closing: closing.value,
  include_nil: includeNil.value,
}))

/** The Before/After control only means something once a book's year has been closed. */
const anyClosed = computed(() => !!result.value?.closed.some((c) => c.closed))

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  if (!store.selectedYearId) { result.value = null; loading.value = false; return }
  loading.value = true
  error.value = null
  try {
    const r = await ledgerApi.trialBalance(params.value)
    if (seq === reqId) result.value = r
  } catch (err) {
    if (seq === reqId) error.value = messageOf(err, 'The trial balance could not be loaded.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
watch(() => [store.selectedYearId, route.query.as_at, route.query.closing, route.query.nil], load, { immediate: true })

function setQuery(over: Record<string, string | undefined>): void {
  const query = { ...route.query, ...over }
  for (const k of Object.keys(query)) if (query[k] === undefined || query[k] === '') delete query[k]
  void router.replace({ query })
}
const onDate = (e: Event) => setQuery({ as_at: (e.target as HTMLInputElement).value })
const onClosing = (e: Event) => setQuery({ closing: (e.target as HTMLSelectElement).value === 'before' ? 'before' : undefined })
const onNil = (e: Event) => setQuery({ nil: (e.target as HTMLInputElement).checked ? '1' : undefined })

const rowsOf = (c: Currency): TrialBalanceRow[] => (result.value?.accounts ?? []).filter((r) => r.currency === c)
const bookOf = (c: Currency) => result.value?.books.find((b) => b.currency === c)
const currencies = computed<Currency[]>(() => result.value?.currencies ?? [])
const nothing = computed(() => !!result.value && currencies.value.length === 0)

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
  if (exporting.value || loading.value) return
  exporting.value = true
  exportError.value = null
  try {
    saveBlob(await ledgerApi.trialBalanceCsv(params.value), csvName(['trial-balance', asAt.value]))
  } catch (err) {
    exportError.value = await exportMessage(err)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Scale :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Trial Balance</h2>
      <p>One trial balance for each currency. Each must balance on its own, and the two are never added together.</p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The trial balance is drawn for one financial year at a time.</p>
  </section>

  <template v-else>
    <form class="cw-card tb-filters no-print" aria-label="Trial balance options" @submit.prevent>
      <div class="cw-field">
        <label class="cw-label" for="tb-asat">As at</label>
        <input id="tb-asat" class="cw-input" type="date" :value="asAt" :min="store.selectedYear?.start_date" :max="store.selectedYear?.end_date" @change="onDate" />
      </div>
      <div v-if="anyClosed" class="cw-field">
        <label class="cw-label" for="tb-closing">Closing vouchers</label>
        <select id="tb-closing" class="cw-select" :value="closing" @change="onClosing">
          <option value="after">After closing</option>
          <option value="before">Before closing</option>
        </select>
      </div>
      <label class="tb-nil"><input type="checkbox" :checked="includeNil" @change="onNil" /> Show accounts with a nil balance</label>
      <div class="tb-actions">
        <button type="button" class="cw-btn" :aria-disabled="exporting || loading ? 'true' : undefined" @click="exportCsv"><Download :size="16" aria-hidden="true" /> Export CSV</button>
        <button type="button" class="cw-btn" @click="printPage"><Printer :size="16" aria-hidden="true" /> Print</button>
      </div>
    </form>

    <p v-if="exportError" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ exportError }}</p>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading && !result" label="the trial balance" />

    <section v-else-if="nothing" class="cw-card">
      <p class="cw-empty"><strong>Nothing has been posted as at {{ formatDate(asAt) }}.</strong>Post a journal, or choose a later date, and the balances appear here.</p>
    </section>

    <template v-else-if="result">
      <p class="cw-hint tb-asline">As at {{ formatDate(result.as_at) }}<template v-if="anyClosed">, {{ result.closing === 'before' ? 'before' : 'after' }} the closing vouchers</template>.</p>
      <div class="tb-books">
        <section v-for="c in currencies" :key="c" class="cw-card tb-book" :aria-label="`${c} book`">
          <div class="cw-card-head"><h3>{{ c }} book</h3></div>
          <p v-if="bookOf(c)?.balances" class="cw-banner-msg cw-banner-msg--pos"><CheckCircle2 :size="18" aria-hidden="true" />In balance</p>
          <p v-else-if="bookOf(c)" class="cw-banner-msg cw-banner-msg--neg"><AlertTriangle :size="18" aria-hidden="true" />Out of balance by {{ formatMoney(bookOf(c)!.difference, c, { bare: true }) }}</p>
          <div class="cw-card-body cw-table-wrap">
            <table class="st-table">
              <caption class="sr-only">Trial balance, {{ c }} book</caption>
              <thead><tr><th>Account</th><th class="st-num" aria-label="Debit">Dr</th><th class="st-num" aria-label="Credit">Cr</th></tr></thead>
              <tbody>
                <tr v-for="r in rowsOf(c)" :key="r.ledger_account_id ?? 'unclosed'">
                  <th scope="row">
                    <template v-if="r.ledger_account_id">
                      <RouterLink class="cw-link" :to="{ name: 'acc-account', params: { id: r.ledger_account_id }, query: { book: c, to: asAt } }">{{ r.account_code }} {{ r.account_name }}</RouterLink>
                    </template>
                    <template v-else>
                      <span>{{ r.account_name }}</span>
                      <div class="cw-hint">Revenue and expenditure of an earlier year that has not been closed. Close that year in <RouterLink class="cw-link" :to="{ name: 'acc-close' }">Period Close</RouterLink>.</div>
                    </template>
                  </th>
                  <td class="st-num">{{ Number(r.debit_balance) === 0 ? '—' : formatMoney(r.debit_balance, c, { bare: true }) }}</td>
                  <td class="st-num">{{ Number(r.credit_balance) === 0 ? '—' : formatMoney(r.credit_balance, c, { bare: true }) }}</td>
                </tr>
              </tbody>
              <tfoot v-if="bookOf(c)">
                <tr class="st-total"><th scope="row">Total {{ c }}</th><td class="st-num">{{ formatMoney(bookOf(c)!.debit_total, c, { bare: true }) }}</td><td class="st-num">{{ formatMoney(bookOf(c)!.credit_total, c, { bare: true }) }}</td></tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
      <p v-if="result.note" class="cw-hint">{{ result.note }}</p>
    </template>
  </template>
</template>

<style scoped>
.tb-filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.tb-nil { display: flex; align-items: center; gap: 6px; font-size: 13.5px; }
.tb-actions { display: flex; gap: 8px; margin-left: auto; }
.tb-asline { margin: 4px 0 8px; }
.tb-books { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
@media (min-width: 1100px) { .tb-books { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
</style>
