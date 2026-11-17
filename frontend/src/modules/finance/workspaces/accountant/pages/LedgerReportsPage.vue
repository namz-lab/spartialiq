<script setup lang="ts">
/**
 * Two reports drawn from the posted ledger: the general ledger in detail (one book, accounts paged)
 * and the journal listing (vouchers with their lines, totals per currency). Each card keeps its own
 * filters and offset in the route query under its own prefix (`gl_`, `jl_`), so the two never
 * collide and changing a filter returns only that report to its first page. Figures are shown as
 * the server sent them. The CSV is the same request without paging.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, ClipboardList, Download, Printer } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import { useFinanceNav } from '../../../shell/useFinanceNav'
import type { Currency } from '../../../models/types'
import type {
  Bal, GeneralLedgerReport, GeneralLedgerReportQuery, JournalListing, JournalListingQuery,
  LedgerRootType, VoucherStatus, VoucherType,
} from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import DateRange from '../kit/DateRange.vue'
import Pager from '../kit/Pager.vue'
import { csvName, saveBlob } from '../kit/csv'
import '../kit/statement.css'
import '../kit/print.css'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'

const GL_LIMIT = 25
const JL_LIMIT = 50
const ROOTS: LedgerRootType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']
const STATUSES: VoucherStatus[] = ['draft', 'posted', 'cancelled']

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const nav = useFinanceNav()
const catalogue = computed(() => nav.resolve('reports'))

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
function go(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}

/** Today as the council's calendar date, from the LOCAL clock (toISOString would give UTC). */
function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** A date in the query counts only when it lies inside the selected year; otherwise the default is used. */
const inYear = (v: string): boolean => {
  const y = store.selectedYear
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !!y && v >= y.start_date && v <= y.end_date
}
const defaultFrom = computed(() => store.selectedYear?.start_date ?? '')
const defaultTo = computed(() => {
  const y = store.selectedYear
  if (!y) return ''
  const today = localToday()
  let at = today < y.end_date ? today : y.end_date
  if (at < y.start_date) at = y.start_date
  return at
})
const dateOf = (key: string, fallback: string): string => (inYear(q(key)) ? q(key) : fallback)

// ---- General ledger ----
const glBook = computed<Currency>(() => {
  const b = q('gl_book')
  return b === 'USD' || b === 'ZWG' ? b : (store.selectedYear?.reporting_currency ?? 'USD')
})
const glFrom = computed(() => dateOf('gl_from', defaultFrom.value))
const glTo = computed(() => dateOf('gl_to', defaultTo.value))
const glRoot = computed<LedgerRootType | ''>(() => (ROOTS.includes(q('gl_root') as LedgerRootType) ? (q('gl_root') as LedgerRootType) : ''))
const glAFrom = computed(() => q('gl_afrom').trim())
const glATo = computed(() => q('gl_ato').trim())
const glOffset = computed(() => Math.max(0, Number(q('gl_offset')) || 0))

const dGlFrom = ref(''); const dGlTo = ref(''); const dGlRoot = ref(''); const dGlAFrom = ref(''); const dGlATo = ref('')
function syncGl(): void {
  dGlFrom.value = glFrom.value; dGlTo.value = glTo.value; dGlRoot.value = glRoot.value
  dGlAFrom.value = glAFrom.value; dGlATo.value = glATo.value
}

function glFilters(): GeneralLedgerReportQuery {
  const p: GeneralLedgerReportQuery = {
    financial_year_id: store.selectedYearId as string, currency: glBook.value, from: glFrom.value, to: glTo.value,
  }
  if (glRoot.value) p.root_type = glRoot.value
  if (glAFrom.value) p.account_from = glAFrom.value
  if (glATo.value) p.account_to = glATo.value
  return p
}

const gl = ref<GeneralLedgerReport | null>(null)
/** The request the displayed answer was made for: labels and formatting follow it, not the current query. */
const glShown = ref<{ book: Currency; from: string; to: string; offset: number }>({ book: 'USD', from: '', to: '', offset: 0 })
const glLoading = ref(false)
const glError = ref<string | null>(null)
const glExporting = ref(false)
const glExportError = ref<string | null>(null)
let glSeq = 0
async function loadGl(): Promise<void> {
  const seq = ++glSeq
  if (!store.selectedYearId) { gl.value = null; glLoading.value = false; return }
  glLoading.value = true
  glError.value = null
  try {
    const asked = glFilters()
    const offset = glOffset.value
    const r = await ledgerApi.generalLedgerReport({ ...asked, limit: GL_LIMIT, offset })
    if (seq === glSeq) { gl.value = r; glShown.value = { book: asked.currency, from: asked.from as string, to: asked.to as string, offset } }
  } catch (err) {
    if (seq === glSeq) { gl.value = null; glError.value = messageOf(err, 'The general ledger could not be loaded.') }
  } finally {
    if (seq === glSeq) glLoading.value = false
  }
}
watch(() => [store.selectedYearId, store.selectedYear?.start_date, q('gl_book'), q('gl_from'), q('gl_to'), q('gl_root'), q('gl_afrom'), q('gl_ato'), q('gl_offset')].join('|'),
  () => { syncGl(); void loadGl() }, { immediate: true })

function applyGl(): void {
  go({
    gl_from: dGlFrom.value, gl_to: dGlTo.value, gl_root: dGlRoot.value || undefined,
    gl_afrom: dGlAFrom.value.trim() || undefined, gl_ato: dGlATo.value.trim() || undefined, gl_offset: undefined,
  })
}
const setGlBook = (c: Currency): void => go({ gl_book: c, gl_offset: undefined })
const setGlOffset = (o: number): void => go({ gl_offset: o ? String(o) : undefined })

// ---- Journal listing ----
const jlFrom = computed(() => dateOf('jl_from', defaultFrom.value))
const jlTo = computed(() => dateOf('jl_to', defaultTo.value))
const jlType = computed<VoucherType | ''>(() => (q('jl_type') in VOUCHER_TYPE_LABEL ? (q('jl_type') as VoucherType) : ''))
const jlStatus = computed<VoucherStatus | ''>(() => (STATUSES.includes(q('jl_status') as VoucherStatus) ? (q('jl_status') as VoucherStatus) : ''))
const jlBook = computed<Currency | ''>(() => (q('jl_book') === 'USD' || q('jl_book') === 'ZWG' ? (q('jl_book') as Currency) : ''))
const jlOffset = computed(() => Math.max(0, Number(q('jl_offset')) || 0))

const dJlFrom = ref(''); const dJlTo = ref(''); const dJlType = ref(''); const dJlStatus = ref(''); const dJlBook = ref('')
function syncJl(): void {
  dJlFrom.value = jlFrom.value; dJlTo.value = jlTo.value; dJlType.value = jlType.value
  dJlStatus.value = jlStatus.value; dJlBook.value = jlBook.value
}

function jlFilters(): JournalListingQuery {
  const p: JournalListingQuery = { financial_year_id: store.selectedYearId as string, from: jlFrom.value, to: jlTo.value }
  if (jlType.value) p.voucher_type = jlType.value
  if (jlStatus.value) p.status = jlStatus.value
  if (jlBook.value) p.currency = jlBook.value
  return p
}

const jl = ref<JournalListing | null>(null)
const jlShown = ref<{ from: string; to: string; type: string; status: string; book: string; offset: number }>({ from: '', to: '', type: '', status: '', book: '', offset: 0 })
const jlLoading = ref(false)
const jlError = ref<string | null>(null)
const jlExporting = ref(false)
const jlExportError = ref<string | null>(null)
let jlSeq = 0
async function loadJl(): Promise<void> {
  const seq = ++jlSeq
  if (!store.selectedYearId) { jl.value = null; jlLoading.value = false; return }
  jlLoading.value = true
  jlError.value = null
  try {
    const asked = jlFilters()
    const offset = jlOffset.value
    const r = await ledgerApi.journalListing({ ...asked, limit: JL_LIMIT, offset })
    if (seq === jlSeq) {
      jl.value = r
      jlShown.value = { from: asked.from as string, to: asked.to as string, type: asked.voucher_type ?? '', status: asked.status ?? '', book: asked.currency ?? '', offset }
    }
  } catch (err) {
    if (seq === jlSeq) { jl.value = null; jlError.value = messageOf(err, 'The journal listing could not be loaded.') }
  } finally {
    if (seq === jlSeq) jlLoading.value = false
  }
}
watch(() => [store.selectedYearId, store.selectedYear?.start_date, q('jl_from'), q('jl_to'), q('jl_type'), q('jl_status'), q('jl_book'), q('jl_offset')].join('|'),
  () => { syncJl(); void loadJl() }, { immediate: true })

function applyJl(): void {
  go({
    jl_from: dJlFrom.value, jl_to: dJlTo.value, jl_type: dJlType.value || undefined,
    jl_status: dJlStatus.value || undefined, jl_book: dJlBook.value || undefined, jl_offset: undefined,
  })
}
const setJlOffset = (o: number): void => go({ jl_offset: o ? String(o) : undefined })

// ---- Export and print ----
/** The CSV error arrives as a Blob holding the server's JSON. */
async function blobMessage(err: unknown): Promise<string> {
  try {
    const data = (err as { response?: { data?: Blob } }).response?.data
    const text = await data?.text()
    if (text) {
      const parsed = JSON.parse(text) as { message?: string; error?: { message?: string } }
      const m = parsed.message ?? parsed.error?.message
      if (typeof m === 'string' && m) return m
    }
  } catch { /* fall through */ }
  return 'The export could not be made.'
}
async function exportGl(): Promise<void> {
  if (glExporting.value || !store.selectedYearId) return
  glExporting.value = true
  glExportError.value = null
  try {
    saveBlob(await ledgerApi.generalLedgerReportCsv(glFilters()), csvName(['general-ledger', glBook.value, glFrom.value, glTo.value]))
  } catch (err) {
    glExportError.value = await blobMessage(err)
  } finally {
    glExporting.value = false
  }
}
async function exportJl(): Promise<void> {
  if (jlExporting.value || !store.selectedYearId) return
  jlExporting.value = true
  jlExportError.value = null
  try {
    saveBlob(await ledgerApi.journalListingCsv(jlFilters()), csvName(['journal-listing', jlBook.value, jlFrom.value, jlTo.value]))
  } catch (err) {
    jlExportError.value = await blobMessage(err)
  } finally {
    jlExporting.value = false
  }
}
const printScope = ref<'gl' | 'jl' | ''>('')
async function print(scope: 'gl' | 'jl'): Promise<void> {
  printScope.value = scope
  await nextTick() // the attribute must be in the page before the print dialog reads it
  window.addEventListener('afterprint', () => { printScope.value = '' }, { once: true })
  window.print()
}
const slice = (offset: number, limit: number, total: number): string => (total === 0 ? '0 of 0' : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`)
const glSlice = computed(() => (gl.value ? slice(glShown.value.offset, GL_LIMIT, gl.value.total_accounts) : ''))
const jlSlice = computed(() => (jl.value ? slice(jlShown.value.offset, JL_LIMIT, jl.value.total) : ''))
const typeLabel = (t: string): string => VOUCHER_TYPE_LABEL[t] ?? t

// ---- Display ----
const money = (v: string, c: Currency): string => formatMoney(v, c, { bare: true })
const isZero = (v: string): boolean => Number(v) === 0
const NATURAL: Record<LedgerRootType, 'Dr' | 'Cr'> = { asset: 'Dr', expense: 'Dr', liability: 'Cr', equity: 'Cr', revenue: 'Cr' }
/** A zero balance arrives as 'Dr' whatever the account; it is on no side, so it carries no mark. */
const sideOf = (b: Bal): string => (isZero(b.amount) ? '' : b.side)
const against = (b: Bal, root: LedgerRootType): boolean => !isZero(b.amount) && b.side !== NATURAL[root]
</script>

<template>
<div :data-print="printScope || undefined">
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ClipboardList :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Ledger Reports</h2>
      <p>The general ledger in detail and the listing of journals, drawn from the posted ledger for one financial year.</p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>These reports are drawn for one financial year at a time.</p>
  </section>

  <template v-else>
    <!-- General ledger -->
    <section class="cw-card lr-card lr-gl" aria-labelledby="lr-gl-h">
      <div class="cw-card-head"><h3 id="lr-gl-h">General ledger detail</h3></div>
      <form class="lr-filters no-print" aria-label="General ledger filters" @submit.prevent="applyGl">
        <div class="cw-field"><span class="cw-label">Book</span><BookSwitch :model-value="glBook" label="General ledger book" @update:model-value="setGlBook" /></div>
        <DateRange v-model:from="dGlFrom" v-model:to="dGlTo" :min="store.selectedYear?.start_date" :max="store.selectedYear?.end_date" />
        <div class="cw-field">
          <label class="cw-label" for="gl-root">Account type</label>
          <select id="gl-root" v-model="dGlRoot" class="cw-select">
            <option value="">All types</option>
            <option v-for="r in ROOTS" :key="r" :value="r">{{ r.charAt(0).toUpperCase() + r.slice(1) }}</option>
          </select>
        </div>
        <div class="cw-field"><label class="cw-label" for="gl-afrom">From account code</label><input id="gl-afrom" v-model="dGlAFrom" class="cw-input" type="text" inputmode="numeric" /></div>
        <div class="cw-field"><label class="cw-label" for="gl-ato">To account code</label><input id="gl-ato" v-model="dGlATo" class="cw-input" type="text" inputmode="numeric" /></div>
        <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
        <div class="lr-actions">
          <button type="button" class="cw-btn" :aria-disabled="glExporting || glLoading" @click="exportGl"><Download :size="16" aria-hidden="true" /> Export CSV</button>
          <button type="button" class="cw-btn" @click="print('gl')"><Printer :size="16" aria-hidden="true" /> Print</button>
        </div>
      </form>

      <p v-if="glExportError" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ glExportError }}</p>
      <p v-if="glError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ glError }}
        <button type="button" class="cw-btn cw-btn--small" @click="loadGl">Retry</button></p>

      <div v-if="glLoading && !gl" class="cw-card-body" aria-busy="true" data-test="gl-loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="gl && gl.accounts.length === 0 && !glError" class="cw-empty" data-test="gl-empty">
        <strong>No account has a balance or an entry in these dates.</strong>Widen the dates, clear the account range, or choose the other book.</p>
      <template v-else-if="gl && !glError">
        <p class="cw-hint lr-asline">{{ glShown.book }} book, {{ formatDate(glShown.from) }} to {{ formatDate(glShown.to) }}. Accounts {{ glSlice }}.</p>
        <div class="cw-card-body cw-table-wrap">
          <table v-for="a in gl.accounts" :key="a.account.id" class="cw-table st-table lr-table">
            <caption class="lr-caption">
              <RouterLink class="cw-link" :to="{ name: 'acc-account', params: { id: a.account.id }, query: { book: glShown.book } }">{{ a.account.code }}</RouterLink>
              {{ a.account.name }}
            </caption>
            <thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th class="st-num">Debit</th><th class="st-num">Credit</th><th class="st-num">Balance</th></tr></thead>
            <tbody>
              <tr class="st-bf">
                <td colspan="5">Brought forward</td>
                <td class="st-num" :class="{ 'is-contra': against(a.brought_forward, a.account.root_type) }">{{ money(a.brought_forward.amount, glShown.book) }} {{ sideOf(a.brought_forward) }}
                  <span v-if="against(a.brought_forward, a.account.root_type)" class="lr-note">against its usual side</span></td>
              </tr>
              <tr v-for="e in a.entries" :key="e.id">
                <td>{{ formatDate(e.posting_date) }}</td>
                <td><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: e.voucher_id } }">{{ e.voucher_no }}</RouterLink></td>
                <td>{{ e.narration ?? '' }}<div v-if="e.party_name" class="cw-hint">{{ e.party_name }}</div></td>
                <td class="st-num">{{ isZero(e.debit) ? '' : money(e.debit, glShown.book) }}</td>
                <td class="st-num">{{ isZero(e.credit) ? '' : money(e.credit, glShown.book) }}</td>
                <td class="st-num" :class="{ 'is-contra': against(e.balance, a.account.root_type) }">{{ money(e.balance.amount, glShown.book) }} {{ sideOf(e.balance) }}
                  <span v-if="against(e.balance, a.account.root_type)" class="lr-note">against its usual side</span></td>
              </tr>
              <tr class="st-sub"><td colspan="3">Totals</td><td class="st-num">{{ money(a.totals.debit, glShown.book) }}</td><td class="st-num">{{ money(a.totals.credit, glShown.book) }}</td><td /></tr>
              <tr class="st-total">
                <td colspan="5">Carried forward</td>
                <td class="st-num" :class="{ 'is-contra': against(a.carried_forward, a.account.root_type) }">{{ money(a.carried_forward.amount, glShown.book) }} {{ sideOf(a.carried_forward) }}
                  <span v-if="against(a.carried_forward, a.account.root_type)" class="lr-note">against its usual side</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="cw-card-body"><Pager :total="gl.total_accounts" :limit="GL_LIMIT" :offset="glShown.offset" :disabled="glLoading" @update:offset="setGlOffset" /></div>
      </template>
    </section>

    <!-- Journal listing -->
    <section class="cw-card lr-card lr-jl" aria-labelledby="lr-jl-h">
      <div class="cw-card-head"><h3 id="lr-jl-h">Journal listing</h3></div>
      <form class="lr-filters no-print" aria-label="Journal listing filters" @submit.prevent="applyJl">
        <DateRange v-model:from="dJlFrom" v-model:to="dJlTo" :min="store.selectedYear?.start_date" :max="store.selectedYear?.end_date" />
        <div class="cw-field">
          <label class="cw-label" for="jl-type">Voucher type</label>
          <select id="jl-type" v-model="dJlType" class="cw-select">
            <option value="">All types</option>
            <option v-for="(label, key) in VOUCHER_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div class="cw-field">
          <label class="cw-label" for="jl-status">Status</label>
          <select id="jl-status" v-model="dJlStatus" class="cw-select">
            <option value="">Any status</option>
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s.charAt(0).toUpperCase() + s.slice(1) }}</option>
          </select>
        </div>
        <div class="cw-field">
          <label class="cw-label" for="jl-book">Currency</label>
          <select id="jl-book" v-model="dJlBook" class="cw-select">
            <option value="">Both currencies</option>
            <option value="USD">USD</option>
            <option value="ZWG">ZWG</option>
          </select>
        </div>
        <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
        <div class="lr-actions">
          <button type="button" class="cw-btn" :aria-disabled="jlExporting || jlLoading" @click="exportJl"><Download :size="16" aria-hidden="true" /> Export CSV</button>
          <button type="button" class="cw-btn" @click="print('jl')"><Printer :size="16" aria-hidden="true" /> Print</button>
        </div>
      </form>

      <p v-if="jlExportError" class="cw-banner-msg cw-banner-msg--neg no-print" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ jlExportError }}</p>
      <p v-if="jlError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ jlError }}
        <button type="button" class="cw-btn cw-btn--small" @click="loadJl">Retry</button></p>

      <div v-if="jlLoading && !jl" class="cw-card-body" aria-busy="true" data-test="jl-loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="jl && jl.vouchers.length === 0 && !jlError" class="cw-empty" data-test="jl-empty">
        <strong>No vouchers match these filters.</strong>Widen the dates or clear the type and status.</p>
      <template v-else-if="jl && !jlError">
        <p class="cw-hint lr-asline" data-test="jl-asline">{{ formatDate(jlShown.from) }} to {{ formatDate(jlShown.to) }}; {{ jlShown.book || 'both currencies' }}; {{ jlShown.type ? typeLabel(jlShown.type) : 'all voucher types' }}; {{ jlShown.status || 'any status' }}. Vouchers {{ jlSlice }}.</p>
        <div class="cw-card-body cw-table-wrap">
          <table v-for="v in jl.vouchers" :key="v.id" class="cw-table st-table lr-table">
            <caption class="lr-caption">
              <RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: v.id } }">{{ v.voucher_no }}</RouterLink>
              {{ VOUCHER_TYPE_LABEL[v.voucher_type] ?? v.voucher_type }}, {{ v.currency }}, {{ formatDate(v.posting_date) }}, {{ v.status }}
              <span v-if="v.narration" class="cw-hint"> {{ v.narration }}</span>
              <span v-if="v.reference" class="cw-hint"> Ref {{ v.reference }}</span>
              <span class="cw-hint"> Prepared by {{ v.prepared_by_name ?? 'unknown' }}<template v-if="v.posted_by_name">, posted by {{ v.posted_by_name }}</template></span>
            </caption>
            <thead><tr><th>Line</th><th>Account</th><th>Narration</th><th class="st-num">Debit</th><th class="st-num">Credit</th></tr></thead>
            <tbody>
              <tr v-for="l in v.lines" :key="l.line_no">
                <td>{{ l.line_no }}</td>
                <td>{{ l.account_code }} {{ l.account_name }}<div v-if="l.party_name" class="cw-hint">{{ l.party_name }}</div></td>
                <td>{{ l.narration ?? '' }}</td>
                <td class="st-num">{{ isZero(l.debit) ? '' : money(l.debit, v.currency) }}</td>
                <td class="st-num">{{ isZero(l.credit) ? '' : money(l.credit, v.currency) }}</td>
              </tr>
              <tr class="st-sub"><td colspan="3">Voucher total {{ v.currency }}</td><td class="st-num">{{ money(v.debit_total, v.currency) }}</td><td class="st-num">{{ money(v.credit_total, v.currency) }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table st-table lr-totals" aria-label="Totals by currency">
            <thead><tr><th>Totals for the whole listing</th><th class="st-num">Debit</th><th class="st-num">Credit</th></tr></thead>
            <tbody>
              <tr v-for="t in jl.totals" :key="t.currency" class="st-total" :data-currency="t.currency">
                <th scope="row">{{ t.currency }}</th><td class="st-num">{{ money(t.debit_total, t.currency) }}</td><td class="st-num">{{ money(t.credit_total, t.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="cw-card-body"><Pager :total="jl.total" :limit="JL_LIMIT" :offset="jlShown.offset" :disabled="jlLoading" @update:offset="setJlOffset" /></div>
      </template>
    </section>

    <section class="cw-card lr-card lr-bud no-print" aria-labelledby="lr-bud-h">
      <div class="cw-card-head"><h3 id="lr-bud-h">Budget and management reports</h3></div>
      <p class="lr-more">
        <RouterLink v-if="catalogue.kind === 'route'" class="cw-link" :to="{ name: catalogue.name }">Open the budget and management reports</RouterLink>
        <span v-else data-test="reports-reason">{{ catalogue.reason }}</span>
      </p>
    </section>
  </template>
</div>
</template>

<style scoped>
.lr-card { margin-bottom: 16px; }
.lr-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; }
.lr-filters .cw-field { min-width: 140px; }
.lr-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.lr-asline { padding: 0 16px; margin: 4px 0 8px; }
.lr-table { min-width: 640px; margin-bottom: 18px; }
.lr-caption { text-align: left; padding: 10px 12px; font-size: 13.5px; font-weight: 600; caption-side: top; }
.lr-totals { max-width: 480px; }
.lr-more { padding: 12px 16px 16px; margin: 0; }
.is-contra { color: var(--cw-neg); }
.lr-note { display: block; font-size: 11.5px; font-weight: 500; }
@media print {
  [data-print='gl'] .lr-jl, [data-print='jl'] .lr-gl, .lr-bud { display: none !important; }
}
</style>
