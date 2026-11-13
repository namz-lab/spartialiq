<script setup lang="ts">
/**
 * The council's public financial transparency portal.
 *
 * Appendix A of the specification, built for a resident on a modest phone over an intermittent
 * connection — which is most of Vungu district.
 *
 * FOUR THINGS A PUBLIC FINANCE PAGE MUST GET RIGHT, AND HOW THIS ONE DOES
 *
 * 1. SAY WHEN IT WAS PUBLISHED AND WHAT IT COVERS. Every figure here is served with its
 *    publication date, reporting period and data cut-off, and the page shows them beside the
 *    numbers rather than in a footer nobody reads. A council figure quoted without its period is a
 *    figure quoted wrongly.
 *
 * 2. NEVER ADD TWO CURRENCIES. USD and ZWG appear as separate blocks with no combined total, and
 *    the page says why in plain words. The Council has approved no conversion basis, so a single
 *    figure spanning both would be invented.
 *
 * 3. SHOW WHAT WAS ORIGINALLY APPROVED, NOT ONLY WHAT IT BECAME. The budget table carries the
 *    original allocation, the approved adjustments and the revised figure side by side, because
 *    "the budget was 125 000" and "the budget was 100 000 and was raised by 25 000" are different
 *    statements and the second is the true one.
 *
 * 4. PUBLISH NO ONE'S NAME. Supplier and beneficiary identities are not part of the published
 *    record — the view the public API reads does not carry those columns at all — and the page says
 *    so where a reader might otherwise wonder.
 *
 * Nothing here requires a sign-in, and nothing here is fetched that is not published: the database
 * returns an anonymous request only rows a live publication covers.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { financePublicApi } from '../api/financeApi'
import { messageOf } from '../stores/finance'
import {
  formatMoney, formatPercentage, formatDate, formatDateTime, formatBytes, currencyName, toChartValue,
} from '../composables/useMoney'
import type {
  BudgetLinePerformance, Currency, FinanceDocument, FinanceProject, FinanceTransaction,
  PublicOverview, PublicYear,
} from '../models/types'
import './finance.css'
import {
  AlertTriangle, Info, Search, Download, FileText, HardHat, TrendingUp, TrendingDown,
  Wallet, LayoutDashboard, CalendarRange, Map as MapIcon,
} from 'lucide-vue-next'
import PublicFinanceMap from '../components/PublicFinanceMap.vue'
import SiteHeader from '@/components/SiteHeader.vue'
import SiteFooter from '@/components/SiteFooter.vue'

type Panel = 'overview' | 'map' | 'budget' | 'revenue' | 'expenditure' | 'projects' | 'documents'

const PANELS: Array<{ id: Panel; label: string; icon: typeof Wallet }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'revenue', label: 'Revenue', icon: TrendingUp },
  { id: 'expenditure', label: 'Expenditure', icon: TrendingDown },
  { id: 'projects', label: 'Projects', icon: HardHat },
  { id: 'documents', label: 'Documents', icon: FileText },
]

const route = useRoute()
const router = useRouter()

const years = ref<PublicYear[]>([])
const yearId = ref<string | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const overview = ref<PublicOverview | null>(null)
const budget = ref<{ lines: BudgetLinePerformance[]; total: number; note: string } | null>(null)
const revenue = ref<Awaited<ReturnType<typeof financePublicApi.side>> | null>(null)
const expenditure = ref<Awaited<ReturnType<typeof financePublicApi.side>> | null>(null)
const projects = ref<FinanceProject[]>([])
const documents = ref<FinanceDocument[]>([])
const documentsTotal = ref(0)
const documentsLimit = 25
const documentsLoading = ref(false)
const transactions = ref<{ transactions: FinanceTransaction[]; total: number; withheld: string } | null>(null)

const budgetSearch = ref('')
const txnSearch = ref('')
const txnKind = ref<'revenue' | 'expenditure'>('expenditure')

const panel = computed<Panel>(() => {
  const requested = String(route.query.view || 'overview')
  return (PANELS.find((p) => p.id === requested)?.id ?? 'overview')
})
const selectedYear = computed(() => years.value.find((y) => y.id === yearId.value) ?? null)

function openPanel(id: Panel): void {
  void router.replace({ query: { ...route.query, view: id } })
}

async function boot(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    years.value = await financePublicApi.years()
    const requested = String(route.query.year || '')
    yearId.value = years.value.find((y) => y.id === requested)?.id ?? years.value[0]?.id ?? null
    if (yearId.value) await loadYear()
  } catch (err) {
    error.value = messageOf(err, 'The council\'s published financial information could not be loaded.')
  } finally {
    loading.value = false
  }
}

async function loadYear(): Promise<void> {
  if (!yearId.value) return
  loading.value = true
  error.value = null
  try {
    overview.value = await financePublicApi.overview(yearId.value)
    // Each panel loads on demand; the overview is enough to render the landing view on a slow
    // connection without waiting for five more requests.
    await loadPanel()
  } catch (err) {
    error.value = messageOf(err, 'That reporting period could not be loaded.')
  } finally {
    loading.value = false
  }
}

async function loadPanel(): Promise<void> {
  if (!yearId.value) return
  try {
    if (panel.value === 'budget') {
      budget.value = await financePublicApi.budget({
        financial_year_id: yearId.value, q: budgetSearch.value.trim() || undefined, limit: 100,
      })
    } else if (panel.value === 'revenue' && !revenue.value) {
      revenue.value = await financePublicApi.side('revenue', yearId.value)
    } else if (panel.value === 'expenditure' && !expenditure.value) {
      expenditure.value = await financePublicApi.side('expenditure', yearId.value)
    } else if (panel.value === 'projects' && projects.value.length === 0) {
      projects.value = (await financePublicApi.projects({
        financial_year_id: yearId.value, limit: 100,
      })).projects
    } else if (panel.value === 'documents' && documents.value.length === 0) {
      await loadDocuments(0)
    }
  } catch (err) {
    error.value = messageOf(err, 'That information could not be loaded.')
  }
}

/**
 * Documents are paginated. The first request replaces the list; "load more" appends, so a large
 * register does not put every row on the page at once (audit F-07).
 */
async function loadDocuments(offset = 0): Promise<void> {
  if (!yearId.value) return
  documentsLoading.value = true
  try {
    const page = await financePublicApi.documents({
      financial_year_id: yearId.value,
      limit: documentsLimit,
      offset,
      sort: 'uploaded_at',
      direction: 'desc',
    })
    documents.value = offset === 0 ? page.documents : [...documents.value, ...page.documents]
    documentsTotal.value = page.total
  } catch (err) {
    error.value = messageOf(err, 'The published documents could not be loaded.')
  } finally {
    documentsLoading.value = false
  }
}

/**
 * One published posting, and the documents the council released with it.
 *
 * The table above answers "what was spent"; this answers "on what, and where is the paper". A
 * resident who can read the invoice behind a line of expenditure does not have to take the line on
 * trust, which is the whole point of publishing a transaction register rather than a summary.
 *
 * Only documents whose visibility is public AND whose dataset has been published are returned —
 * that is the row-level security policy's decision, not this page's — so an empty list means the
 * council has released no paper for this posting, not that the request was filtered here.
 */
const openTransaction = ref<{
  transaction: FinanceTransaction
  documents: FinanceDocument[]
} | null>(null)
const transactionLoading = ref<string | null>(null)

async function showTransaction(id: string): Promise<void> {
  if (openTransaction.value?.transaction.id === id) { openTransaction.value = null; return }
  transactionLoading.value = id
  error.value = null
  try {
    openTransaction.value = await financePublicApi.transaction(id)
  } catch (err) {
    error.value = messageOf(err, 'That transaction could not be loaded.')
  } finally {
    transactionLoading.value = null
  }
}

async function loadTransactions(): Promise<void> {
  if (!yearId.value) return
  try {
    transactions.value = await financePublicApi.transactions({
      financial_year_id: yearId.value, kind: txnKind.value,
      q: txnSearch.value.trim() || undefined, limit: 50,
    })
  } catch (err) {
    error.value = messageOf(err, 'The published transactions could not be loaded.')
  }
}

onMounted(boot)
watch(yearId, () => {
  revenue.value = null; expenditure.value = null; budget.value = null
  projects.value = []; documents.value = []; documentsTotal.value = 0; transactions.value = null
  openTransaction.value = null
  void router.replace({ query: { ...route.query, year: yearId.value ?? undefined } })
  void loadYear()
})
watch(panel, loadPanel)
watch(txnKind, () => { openTransaction.value = null; void loadTransactions() })

let budgetTimer: ReturnType<typeof setTimeout> | undefined
watch(budgetSearch, () => { clearTimeout(budgetTimer); budgetTimer = setTimeout(loadPanel, 350) })
let txnTimer: ReturnType<typeof setTimeout> | undefined
watch(txnSearch, () => { clearTimeout(txnTimer); txnTimer = setTimeout(loadTransactions, 350) })

/** The widest department figure in a side, for the bar widths. Presentation only. */
function maxOf(rows: Array<{ amount: string }>): number {
  return rows.reduce((max, r) => Math.max(max, Math.abs(toChartValue(r.amount))), 0) || 1
}

/**
 * Allocations or spend recorded in a currency other than the project's own. They are shown beside
 * the project, never folded into its totals: the Council has approved no conversion basis, so
 * adding them would invent a figure.
 */
function otherCurrencyRows(p: FinanceProject): Array<{ label: string; currency: Currency; amount: string }> {
  return [
    ...Object.entries(p.other_currency_allocations ?? {}).map(([currency, amount]) => ({
      label: 'allocated', currency: currency as Currency, amount,
    })),
    ...Object.entries(p.other_currency_spend ?? {}).map(([currency, amount]) => ({
      label: 'spent', currency: currency as Currency, amount,
    })),
  ]
}
const side = computed(() => (panel.value === 'revenue' ? revenue.value : expenditure.value))
</script>

<template>
  <!-- The council website's chrome. Without it this page was a dead end: no link back to the
       rest of the site, and nothing on the site linked here. -->
  <div class="home-view">
  <SiteHeader />
  <main id="main" class="main-stage">
  <div class="pub-finance">
    <header class="pub-head">
      <p class="pub-eyebrow">Vungu Rural District Council</p>
      <h1>Council finances</h1>
      <p class="pub-lede">
        What the council budgeted, what it collected and what it spent — as published by the
        council, with the date of publication and the period covered shown beside every figure.
      </p>
    </header>

    <div v-if="error" class="pub-banner is-negative" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="fin-btn small" @click="boot">Try again</button>
    </div>

    <p v-if="loading && !overview" class="pub-loading" role="status">Loading the council's published figures…</p>

    <div v-else-if="years.length === 0" class="fin-empty pub-empty">
      <strong>The council has not published financial information yet.</strong>
      <p>
        When it does, this page will show the approved budget, revenue collected, expenditure and
        the council's projects for each financial year, with the date each dataset was published.
      </p>
    </div>

    <template v-else>
      <div class="pub-controls">
        <label class="pub-year">
          <span><CalendarRange :size="14" aria-hidden="true" /> Financial year</span>
          <select v-model="yearId" class="ins-input">
            <option v-for="y in years" :key="y.id" :value="y.id">{{ y.label }}</option>
          </select>
        </label>
        <p v-if="selectedYear" class="pub-year-note">
          {{ formatDate(selectedYear.start_date) }} to {{ formatDate(selectedYear.end_date) }}
          · published: {{ selectedYear.published_datasets.join(', ') }}
          · last updated {{ formatDateTime(selectedYear.last_published_at) }}
        </p>
      </div>

      <nav class="pub-tabs" aria-label="Financial information">
        <button v-for="p in PANELS" :key="p.id" type="button" class="pub-tab"
                :class="{ 'is-on': panel === p.id }" :aria-current="panel === p.id ? 'page' : undefined"
                @click="openPanel(p.id)">
          <component :is="p.icon" :size="15" aria-hidden="true" /> {{ p.label }}
        </button>
      </nav>

      <!-- ── Overview ──────────────────────────────────────────────────────────────────────── -->
      <section v-if="panel === 'overview' && overview" class="pub-panel">
        <div v-for="block in overview.summary" :key="block.currency" class="fin-ccy-group">
          <h2 class="fin-ccy-head">
            {{ block.currency }} <small>{{ currencyName(block.currency) }}</small>
          </h2>
          <div class="pub-cards">
            <article v-for="pair in [
              { key: 'revenue', label: 'Revenue', data: block.revenue, verb: 'collected' },
              { key: 'expenditure', label: 'Expenditure', data: block.expenditure, verb: 'spent' },
            ]" :key="pair.key" class="pub-card">
              <h3>{{ pair.label }}</h3>
              <dl>
                <div>
                  <dt>Approved budget</dt>
                  <dd>{{ formatMoney(pair.data.budget?.original_amount ?? null, block.currency) }}</dd>
                </div>
                <div>
                  <dt>Revised budget</dt>
                  <dd>{{ formatMoney(pair.data.budget?.revised_amount ?? null, block.currency) }}</dd>
                </div>
                <div>
                  <dt>Actually {{ pair.verb }}</dt>
                  <dd class="is-emphasis">{{ formatMoney(pair.data.actual?.amount ?? null, block.currency) }}</dd>
                </div>
                <div v-if="pair.data.actual">
                  <dt>Transactions published</dt>
                  <dd>{{ pair.data.actual.transactions }}</dd>
                </div>
              </dl>
              <p v-if="!pair.data.budget && !pair.data.actual" class="pub-none">
                Nothing published for {{ pair.label.toLowerCase() }} in {{ block.currency }}.
              </p>
            </article>
          </div>
        </div>

        <div class="pub-definitions">
          <h2><Info :size="16" aria-hidden="true" /> How to read these figures</h2>
          <dl>
            <div v-for="(text, key) in overview.definitions" :key="key">
              <dt>{{ String(key).replace(/_/g, ' ') }}</dt>
              <dd>{{ text }}</dd>
            </div>
          </dl>
        </div>

        <div class="pub-provenance">
          <h2>When each dataset was published</h2>
          <table class="fin-table">
            <thead>
              <tr><th scope="col">Dataset</th><th scope="col">Published</th><th scope="col">Period</th><th scope="col">Data as at</th><th scope="col" class="num">Version</th></tr>
            </thead>
            <tbody>
              <tr v-for="(p, dataset) in overview.published" :key="dataset">
                <td>{{ String(dataset) }}</td>
                <td>{{ p ? formatDateTime(p.published_at) : 'not published' }}</td>
                <td>{{ p?.reporting_period_label ?? '—' }}</td>
                <td>{{ formatDate(p?.data_as_at ?? null) }}</td>
                <td class="num">{{ p?.version ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── Map ───────────────────────────────────────────────────────────────────────────── -->
      <section v-else-if="panel === 'map'" class="pub-panel">
        <div v-if="yearId" class="pub-map-panel">
          <PublicFinanceMap :financial-year-id="yearId" />
        </div>
      </section>

      <!-- ── Budget ────────────────────────────────────────────────────────────────────────── -->
      <section v-else-if="panel === 'budget'" class="pub-panel">
        <label class="pub-search">
          <Search :size="15" aria-hidden="true" />
          <input v-model="budgetSearch" class="ins-input" type="search"
                 placeholder="Search a budget line or its description" />
        </label>

        <div v-if="!budget || budget.lines.length === 0" class="fin-empty pub-empty">
          <strong>No published budget lines{{ budgetSearch ? ' match that search' : '' }}.</strong>
          <p>
            The council publishes its budget line by line once the budget for the year has been
            approved and released.
          </p>
        </div>

        <template v-else>
          <p class="pub-note">
            {{ budget.total }} published budget line{{ budget.total === 1 ? '' : 's' }}.
            The original approved allocation and the revised figure are both shown: a budget that
            was raised during the year is not the same as a budget that started at the higher figure.
            {{ budget.note }}
          </p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Line</th><th scope="col">Department</th><th scope="col">Account</th>
                  <th scope="col" class="ccy">Ccy</th>
                  <th scope="col" class="num">Originally approved</th>
                  <th scope="col" class="num">Adjustments</th>
                  <th scope="col" class="num">Revised</th>
                  <th scope="col" class="num">Actual</th>
                  <th scope="col" class="num">Available</th>
                  <th scope="col" class="num">Used</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in budget.lines" :key="l.budget_line_id">
                  <td class="ins-mono">{{ l.code }}<br /><small class="pub-sub">{{ l.description }}</small></td>
                  <td>{{ l.department_name }}</td>
                  <td>{{ l.account_code }}<br /><small class="pub-sub">{{ l.account_name }}</small></td>
                  <td class="ccy">{{ l.currency }}</td>
                  <td class="num">{{ formatMoney(l.original_amount, l.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(l.approved_adjustments, l.currency, { bare: true }) }}</td>
                  <td class="num emphasis">{{ formatMoney(l.revised_amount, l.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(l.actual_amount, l.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(l.available_excluding_commitments, l.currency, { bare: true }) }}</td>
                  <td class="num" :class="{ 'undefined-value': l.execution_percentage === null }">
                    {{ formatPercentage(l.execution_percentage) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <!-- ── Revenue / Expenditure ─────────────────────────────────────────────────────────── -->
      <section v-else-if="panel === 'revenue' || panel === 'expenditure'" class="pub-panel">
        <div v-if="!side" class="pub-loading" role="status">Loading…</div>

        <template v-else>
          <p v-if="side.published" class="pub-note">
            Published {{ formatDateTime(side.published.published_at) }}
            <template v-if="side.published.reporting_period_label"> · {{ side.published.reporting_period_label }}</template>
            <template v-if="side.published.data_as_at"> · figures as at {{ formatDate(side.published.data_as_at) }}</template>.
            {{ side.note }}
          </p>

          <div v-if="side.by_department.length === 0" class="fin-empty pub-empty">
            <strong>No {{ panel }} has been published for this year.</strong>
            <p>The council releases these figures once they have been imported, reconciled and approved for publication.</p>
          </div>

          <template v-else>
            <h2 class="pub-sub-head">By department</h2>
            <ul class="pub-bars">
              <li v-for="d in side.by_department" :key="`${d.department_code}-${d.currency}`">
                <div class="pub-bar-label">
                  <span>{{ d.department_name }}</span>
                  <span class="pub-bar-value">{{ formatMoney(d.amount, d.currency) }}</span>
                </div>
                <span class="fin-meter" aria-hidden="true">
                  <span :style="{ width: `${(Math.abs(toChartValue(d.amount)) / maxOf(side.by_department)) * 100}%` }"></span>
                </span>
                <small class="pub-sub">{{ d.transactions }} transaction{{ d.transactions === 1 ? '' : 's' }} · {{ d.currency }}</small>
              </li>
            </ul>

            <h2 class="pub-sub-head">By account</h2>
            <div class="fin-table-wrap">
              <table class="fin-table">
                <thead>
                  <tr><th scope="col">Account</th><th scope="col" class="ccy">Ccy</th>
                      <th scope="col" class="num">Transactions</th><th scope="col" class="num">Amount</th></tr>
                </thead>
                <tbody>
                  <tr v-for="a in side.by_account" :key="`${a.account_code}-${a.currency}`">
                    <td class="ins-mono">{{ a.account_code }}<br /><small class="pub-sub">{{ a.account_name }}</small></td>
                    <td class="ccy">{{ a.currency }}</td>
                    <td class="num">{{ a.transactions }}</td>
                    <td class="num">{{ formatMoney(a.amount, a.currency, { bare: true }) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 class="pub-sub-head">Individual transactions</h2>
            <p class="pub-note">
              The council publishes each transaction's date, account, description, reference and
              amount. It does not publish who was paid: supplier and beneficiary identities are not
              part of the published record.
            </p>
            <div class="pub-txn-controls">
              <div class="ins-seg">
                <button type="button" :class="{ 'is-on': txnKind === 'expenditure' }" @click="txnKind = 'expenditure'">Expenditure</button>
                <button type="button" :class="{ 'is-on': txnKind === 'revenue' }" @click="txnKind = 'revenue'">Revenue</button>
              </div>
              <label class="pub-search">
                <Search :size="15" aria-hidden="true" />
                <input v-model="txnSearch" class="ins-input" type="search" placeholder="Search a description or reference" />
              </label>
              <button type="button" class="fin-btn small" @click="loadTransactions">Show transactions</button>
            </div>

            <div v-if="transactions" class="fin-table-wrap">
              <table class="fin-table">
                <caption>
                  {{ transactions.total }} published transaction{{ transactions.total === 1 ? '' : 's' }}.
                  {{ transactions.withheld }}
                </caption>
                <thead>
                  <tr><th scope="col">Date</th><th scope="col">Department</th><th scope="col">Account</th>
                      <th scope="col">Description</th><th scope="col">Reference</th>
                      <th scope="col" class="ccy">Ccy</th><th scope="col" class="num">Amount</th>
                      <th scope="col"><span class="pub-sr-only">Detail</span></th></tr>
                </thead>
                <tbody>
                  <template v-for="t in transactions.transactions" :key="t.id">
                    <tr>
                      <td>{{ formatDate(t.txn_date) }}</td>
                      <td>{{ t.department_name ?? '—' }}</td>
                      <td class="ins-mono">{{ t.account_code }}<br /><small class="pub-sub">{{ t.account_name }}</small></td>
                      <td>{{ t.description ?? '—' }}</td>
                      <td class="ins-mono">{{ t.reference ?? '—' }}</td>
                      <td class="ccy">{{ t.currency }}</td>
                      <td class="num">{{ formatMoney(t.amount, t.currency, { bare: true }) }}</td>
                      <td>
                        <button type="button" class="fin-btn small"
                                :aria-expanded="openTransaction?.transaction.id === t.id"
                                :disabled="transactionLoading === t.id"
                                @click="showTransaction(t.id)">
                          {{ openTransaction?.transaction.id === t.id ? 'Hide' : 'Detail' }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="openTransaction?.transaction.id === t.id" class="pub-txn-detail">
                      <td colspan="8">
                        <dl class="pub-txn-facts">
                          <div><dt>Date</dt><dd>{{ formatDate(openTransaction.transaction.txn_date) }}</dd></div>
                          <div><dt>Department</dt><dd>{{ openTransaction.transaction.department_name ?? 'Not stated' }}</dd></div>
                          <div>
                            <dt>Account</dt>
                            <dd>
                              {{ openTransaction.transaction.account_code }}
                              {{ openTransaction.transaction.account_name }}
                              ({{ openTransaction.transaction.account_kind }})
                            </dd>
                          </div>
                          <div><dt>Reference</dt><dd>{{ openTransaction.transaction.reference ?? 'None' }}</dd></div>
                          <div>
                            <dt>Amount</dt>
                            <dd>
                              {{ formatMoney(openTransaction.transaction.amount, openTransaction.transaction.currency) }}
                            </dd>
                          </div>
                        </dl>

                        <p v-if="openTransaction.transaction.description" class="pub-note">
                          {{ openTransaction.transaction.description }}
                        </p>

                        <h3 class="pub-doc-head">
                          Documents released with this transaction
                          <span class="ins-count">{{ openTransaction.documents.length }}</span>
                        </h3>
                        <p v-if="openTransaction.documents.length === 0" class="pub-note">
                          The council has released no document for this transaction. Supporting
                          paper is published only where the council has decided to release it, and
                          supplier and beneficiary identities are never part of the published record.
                        </p>
                        <ul v-else class="pub-doc-list">
                          <li v-for="d in openTransaction.documents" :key="d.id">
                            <a :href="financePublicApi.documentDownloadUrl(d.id)" rel="noopener" target="_blank">
                              {{ d.filename }}
                            </a>
                            <small class="pub-sub">
                              {{ (d.document_type ?? 'unclassified').replace(/_/g, ' ') }}
                              · {{ formatBytes(d.size_bytes) }}
                            </small>
                          </li>
                        </ul>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </section>

      <!-- ── Projects ──────────────────────────────────────────────────────────────────────── -->
      <section v-else-if="panel === 'projects'" class="pub-panel">
        <div v-if="projects.length === 0" class="fin-empty pub-empty">
          <strong>No council projects have been published.</strong>
          <p>
            A project appears here once the council has approved it and released the projects
            dataset.
          </p>
        </div>
        <ul v-else class="pub-projects">
          <li v-for="p in projects" :key="p.project_id" class="pub-card">
            <h3>{{ p.name }}</h3>
            <p class="pub-sub ins-mono">{{ p.reference }}<template v-if="p.ward_code"> · ward {{ p.ward_code }}</template></p>
            <p v-if="p.description" class="pub-project-desc">{{ p.description }}</p>
            <dl>
              <div><dt>Status</dt><dd>{{ p.status.replace(/_/g, ' ') }}</dd></div>
              <div><dt>Approved budget</dt><dd>{{ formatMoney(p.approved_budget, p.currency) }}</dd></div>
              <div><dt>Allocated</dt><dd>{{ formatMoney(p.allocated_total, p.currency) }}</dd></div>
              <div><dt>Spent</dt><dd class="is-emphasis">{{ formatMoney(p.actual_spend, p.currency) }}</dd></div>
              <div><dt>Used</dt><dd>{{ formatPercentage(p.execution_percentage) }}</dd></div>
              <div v-if="p.location_text"><dt>Where</dt><dd>{{ p.location_text }}</dd></div>
            </dl>
            <p v-if="otherCurrencyRows(p).length" class="pub-project-note">
              Also recorded in
              <span v-for="row in otherCurrencyRows(p)" :key="`${row.label}-${row.currency}`">
                {{ row.label }} {{ formatMoney(row.amount, row.currency) }}</span>
              — shown separately and never added to the figures above.
            </p>
          </li>
        </ul>
      </section>

      <!-- ── Documents ─────────────────────────────────────────────────────────────────────── -->
      <section v-else-if="panel === 'documents'" class="pub-panel">
        <div v-if="documents.length === 0" class="fin-empty pub-empty">
          <strong>No financial documents have been published.</strong>
          <p>
            Approved budgets, financial statements and reports appear here once the council releases
            them. Each one is released by a deliberate act; nothing becomes public as a side effect.
          </p>
        </div>
        <ul v-else class="pub-docs">
          <li v-for="d in documents" :key="d.id">
            <a :href="financePublicApi.documentDownloadUrl(d.id)" rel="noopener">
              <Download :size="15" aria-hidden="true" /> {{ d.filename }}
            </a>
            <small class="pub-sub">
              {{ d.document_type ?? 'document' }} · published {{ formatDate(d.uploaded_at) }}
            </small>
          </li>
        </ul>
        <div v-if="documentsTotal > 0" class="pub-docs-foot">
          <p class="pub-sub">Showing {{ documents.length }} of {{ documentsTotal }} published documents.</p>
          <button
            v-if="documents.length < documentsTotal"
            type="button"
            class="fin-btn"
            :disabled="documentsLoading"
            @click="loadDocuments(documents.length)"
          >
            {{ documentsLoading ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </section>
    </template>

    <footer class="pub-foot">
      <p>
        Figures are as recorded in the council's accounting records and published by the council.
        Each import keeps its source file and its reconciliation against the council's own control
        totals. USD and ZWG amounts are reported separately and are never added together.
      </p>
      <p>
        This page does not publish supplier or beneficiary identities, personal data, or
        commercially sensitive information.
      </p>
    </footer>
  </div>
  </main>
  <SiteFooter />
  </div>
</template>

<style scoped>
.pub-finance {
  max-width: 76rem; margin: 0 auto;
  padding: var(--ent-s6) var(--ent-s4) var(--ent-s7);
  display: flex; flex-direction: column; gap: var(--ent-s5);
}
.pub-head h1 { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-xl); font-weight: var(--ent-fw-bold); letter-spacing: -0.015em; color: var(--ent-text); }
.pub-eyebrow { margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3); }
.pub-lede { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-base); color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 70ch; }

.pub-banner { display: flex; align-items: center; gap: var(--ent-s2); padding: var(--ent-s3); border-radius: var(--ent-r-sm); font-size: var(--ent-fs-sm); }
.pub-banner.is-negative { border: 1px solid var(--ent-tone-negative-line); background: var(--ent-tone-negative-bg); }
.pub-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.pub-empty { max-width: 70ch; }

.pub-controls { display: flex; align-items: flex-end; gap: var(--ent-s4); flex-wrap: wrap; }
.pub-year { display: flex; flex-direction: column; gap: var(--ent-s1); }
.pub-year > span { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3); }
.pub-year-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.pub-tabs { display: flex; gap: var(--ent-s1); flex-wrap: wrap; border-bottom: 1px solid var(--ent-line); padding-bottom: var(--ent-s2); }
.pub-tab {
  display: inline-flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3); border: 0; border-radius: var(--ent-r-sm);
  background: transparent; font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text-2); cursor: pointer;
}
.pub-tab:hover { background: var(--ent-surface-2); color: var(--ent-text); }
.pub-tab.is-on { background: var(--ent-accent-soft); color: var(--ent-text); font-weight: var(--ent-fw-semibold); }
.pub-tab:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }

.pub-panel { display: flex; flex-direction: column; gap: var(--ent-s4); }
.pub-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: var(--ent-s4); }
.pub-card { padding: var(--ent-s4); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface); }
.pub-card h3 { margin: 0 0 var(--ent-s3); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pub-card dl { margin: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.pub-card dl > div { display: flex; justify-content: space-between; gap: var(--ent-s3); align-items: baseline; }
.pub-card dt { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.pub-card dd { margin: 0; font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; font-size: var(--ent-fs-sm); color: var(--ent-text); text-align: right; }
.pub-card dd.is-emphasis { font-weight: var(--ent-fw-bold); font-size: var(--ent-fs-md); }
.pub-none { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.pub-definitions, .pub-provenance { padding: var(--ent-s4); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface-2); }
.pub-definitions h2, .pub-provenance h2 { margin: 0 0 var(--ent-s3); display: flex; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pub-definitions dl { margin: 0; display: flex; flex-direction: column; gap: var(--ent-s3); }
.pub-definitions dt { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3); }
.pub-definitions dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 80ch; }

.pub-sub-head { margin: var(--ent-s3) 0 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pub-note { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh); max-width: 80ch; }
.pub-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }

.pub-search { display: flex; align-items: center; gap: var(--ent-s2); max-width: 26rem; }
.pub-search .ins-input { flex: 1; }
.pub-txn-controls { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }

.pub-bars { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s3); }
.pub-bars li { display: flex; flex-direction: column; gap: 4px; }
.pub-bar-label { display: flex; justify-content: space-between; gap: var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.pub-bar-value { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }

.pub-projects { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--ent-s4); }
.pub-project-desc { margin: var(--ent-s2) 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); line-height: var(--ent-lh); }
.pub-project-note { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh); }

.pub-docs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s3); }
.pub-docs-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s3); margin-top: var(--ent-s4); flex-wrap: wrap; }
.pub-docs-foot p { margin: 0; }
.pub-docs li { display: flex; flex-direction: column; gap: 2px; }
.pub-docs a { display: inline-flex; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-sm); color: var(--ent-accent); }

/* One published posting, opened in place. A row that expands beneath itself keeps the reader's
   place in a long register, where a dialog would lose it. */
.pub-txn-detail > td { background: var(--ent-surface-2); padding: var(--ent-s4); }
.pub-txn-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--ent-s3); margin: 0 0 var(--ent-s3); }
.pub-txn-facts dt { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3); }
.pub-txn-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.pub-doc-head { display: flex; align-items: baseline; gap: var(--ent-s2); margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.pub-doc-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.pub-doc-list li { display: flex; flex-direction: column; gap: 2px; }
.pub-doc-list a { font-size: var(--ent-fs-sm); color: var(--ent-accent); overflow-wrap: anywhere; }
.pub-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.pub-foot { padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); }
.pub-foot p { margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh); max-width: 80ch; }

@media (max-width: 767px) {
  .pub-finance { padding: var(--ent-s4) var(--ent-s3) var(--ent-s7); gap: var(--ent-s4); }
  .pub-card dl > div { flex-direction: column; gap: 0; }
  .pub-card dd { text-align: left; }
}
</style>
