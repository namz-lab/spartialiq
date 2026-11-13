<script setup lang="ts">
/**
 * The Director of Finance's cockpit: what needs attention, where the year has got to, and the
 * position per currency.
 *
 * WHAT CHANGED AND WHY
 * This screen used to be the per-currency figures and a flagged-lines table, and the audit found
 * two things missing: there was no chart anywhere in the finance module (need N14), and there was
 * nowhere that said what needed a decision (GAP-5, GAP-6, GAP-7, need N13). Both are added here.
 * Nothing was taken away: every figure the page showed before — original, adjustments, revised,
 * actual, available, execution, the commitments note, the currency-mismatch warning, the flagged
 * lines and the departmental table — is still on it, in the same words.
 *
 * READING ORDER IS THE DIRECTOR'S ORDER
 * What needs attention, then the lines behind it, then where the year has got to, then the position
 * per currency, then the detail by department. A director arrives with the question "what do I have
 * to do" and only then "how are we doing".
 *
 * HOW THIS STAYS OFF THE GENERIC-SAAS-DASHBOARD ANTI-REFERENCE
 * PRODUCT.md names it as the thing to avoid most strongly — cream, bright blue, a row of hero
 * metric cards, identical icon-and-heading grids — and a cockpit is exactly where that look
 * arrives. The specific refusals:
 *   - NO HERO METRICS. There is not one large standalone number on this page. The figures live in
 *     definition lists and tables at body and table weight, as they already did.
 *   - THE ATTENTION FEED IS SENTENCES, NOT CARDS. Each row is a count in front of a statement,
 *     the same grammar FinanceWorkQueue uses and for the same reason: "4" means nothing without
 *     "budget lines awaiting a decision", and a council officer's question is never "what is the
 *     number" but "what must I do and where". A zero reads as a sentence under "checked and clear".
 *   - THE CHARTS ARE THIN BANDS WITH THEIR TABLES UNDER THEM, not the page's centrepiece. The
 *     accent appears only as the bars and the running-total line, which is a small fraction of any
 *     surface — DESIGN.md's ten-per-cent rule.
 *   - NO ICON GRID. The only icons are the ones this module already uses to carry meaning.
 *
 * WHY THERE ARE TWO BLOCKS AND NOT ONE TOTAL
 * A council that budgets in USD and receives some revenue in ZWG has two sets of books in one
 * year. Adding them needs a Council-approved rate source and conversion rule, which does not yet
 * exist (decision D4), so one figure spanning both would be invented. Two blocks is the honest
 * shape, one chart per currency is the same rule applied to the plots, and the note under them
 * says why.
 *
 * WHY THE WORK QUEUE IS NOT HERE
 * FinanceWorkspace.vue already mounts FinanceWorkQueue above this section on the landing screen
 * (FinanceWorkspace.vue:443). That panel is "what is waiting on YOU"; this feed is "what is wrong
 * with the YEAR", and the counts come from the server rather than from the viewer's own queues. A
 * second queue here would be two mechanisms answering one question, so there is not one.
 *
 * WHY A FAILED READ IS NOT A ZERO, THREE TIMES OVER
 * The series, the feed and the performance roll-up are read separately and fail separately: one
 * endpoint being unavailable leaves the rest of the page intact and says what is missing. Inside
 * the feed, an item the server could not compute arrives with `unavailable: true` and a reason and
 * is listed apart from the items that are genuinely empty — zero and unknown are different facts
 * and a finance console is the last place to conflate them.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatMoney, formatPercentage, formatDate, formatDateTime, currencyName } from '../../composables/useMoney'
import type {
  AttentionItem, BudgetLinePerformance, Currency, DepartmentPerformance,
  OverviewSeries, Periodicity, ReportPeriod,
} from '../../models/types'
import ChartFrame from '../../components/charts/ChartFrame.vue'
import type { ChartColumn, ChartRow, ChartSeries } from '../../components/charts/ChartFrame.vue'
import PeriodBars from '../../components/charts/PeriodBars.vue'
import PeriodLines from '../../components/charts/PeriodLines.vue'
import {
  AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, Info, RefreshCw, TrendingDown, TrendingUp,
} from 'lucide-vue-next'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const rows = ref<DepartmentPerformance[]>([])
const thresholds = ref({ warn_execution_percentage: 90, flag_execution_percentage: 100 })
const includesCommitments = ref(false)
const flagged = ref<Array<BudgetLinePerformance & { flag: string }>>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** The period series, read and failing on its own. */
const series = ref<OverviewSeries[]>([])
const periods = ref<ReportPeriod[]>([])
const seriesError = ref<string | null>(null)
const seriesScope = ref<string[] | null>(null)
const periodicity = ref<Periodicity>('monthly')

/** The exception feed, read and failing on its own. */
const attention = ref<AttentionItem[]>([])
const attentionError = ref<string | null>(null)
const attentionAt = ref<string | null>(null)
const attentionScope = ref<string[] | null>(null)
const attentionLoading = ref(false)

const yearId = computed(() => store.selectedYearId)

const PERIODICITY_LABEL: Record<Periodicity, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Full year',
}
/** In the order a council reads them, so the control is not alphabetical by accident. */
const PERIODICITY_CHOICES: Periodicity[] = ['monthly', 'quarterly', 'half_yearly', 'yearly']

async function loadPosition(): Promise<void> {
  if (!yearId.value) { series.value = []; periods.value = []; return }
  seriesError.value = null
  try {
    const result = await financeApi.overviewSeries({
      financial_year_id: yearId.value,
      periodicity: periodicity.value,
    })
    series.value = result.series
    periods.value = result.periods
    seriesScope.value = result.scope_applied
  } catch (err) {
    series.value = []
    periods.value = []
    seriesError.value = messageOf(err, 'The year\'s position period by period could not be read.')
  }
}

async function loadAttention(): Promise<void> {
  if (!yearId.value) { attention.value = []; return }
  attentionError.value = null
  attentionLoading.value = true
  try {
    const feed = await financeApi.overviewAttention({ financial_year_id: yearId.value })
    attention.value = feed.items
    attentionAt.value = feed.generated_at
    attentionScope.value = feed.scope_applied
  } catch (err) {
    attention.value = []
    attentionError.value = messageOf(err, 'What needs attention could not be read.')
  } finally {
    attentionLoading.value = false
  }
}

async function load(): Promise<void> {
  if (!yearId.value) { rows.value = []; flagged.value = []; series.value = []; attention.value = []; return }
  loading.value = true
  error.value = null
  try {
    const performance = await financeApi.performance({ financial_year_id: yearId.value })
    rows.value = performance.rows
    thresholds.value = performance.thresholds
    includesCommitments.value = performance.available_balance_includes_commitments
    if (store.can('finance.actuals.view')) {
      const exceptions = await financeApi.budgetExceptions(yearId.value)
      flagged.value = exceptions.rows
    }
  } catch (err) {
    error.value = messageOf(err, 'The budget position could not be read.')
  } finally {
    loading.value = false
  }
  // Separate awaits: the cockpit must still show the position if the feed is down, and the feed if
  // the series is down.
  await Promise.all([loadPosition(), loadAttention()])
}

onMounted(load)
watch(yearId, load)
watch(periodicity, () => { void loadPosition() })

/** Grouped by currency, then by revenue/expenditure. Nothing is summed across a currency boundary. */
const byCurrency = computed(() => {
  const currencies = [...new Set(rows.value.map((r) => r.currency))].sort() as Currency[]
  return currencies.map((currency) => {
    const within = rows.value.filter((r) => r.currency === currency)
    const side = (kind: 'revenue' | 'expenditure') => {
      const lines = within.filter((r) => r.account_kind === kind)
      if (lines.length === 0) return null
      // These are per-department rows from one currency; the API already computed each figure in
      // NUMERIC, and adding same-currency decimal strings is done on integer cents.
      const add = (pick: (r: DepartmentPerformance) => string) =>
        lines.reduce((acc, r) => acc + BigInt(toCents(pick(r))), 0n)
      const revised = add((r) => r.revised_amount)
      const actual = add((r) => r.actual_amount)
      const commitments = add((r) => r.open_commitments)
      return {
        kind,
        departments: new Set(lines.map((l) => l.department_id)).size,
        original: fromCents(add((r) => r.original_amount)),
        adjustments: fromCents(add((r) => r.approved_adjustments)),
        revised: fromCents(revised),
        actual: fromCents(actual),
        commitments: fromCents(commitments),
        available: fromCents(revised - actual - (includesCommitments.value ? commitments : 0n)),
        execution: revised === 0n ? null : ((Number(actual) / Number(revised)) * 100).toFixed(2),
        currencyFaults: lines.reduce((n, l) => n + Number(l.actual_currency_mismatch_rows || 0), 0),
      }
    }
    return { currency, revenue: side('revenue'), expenditure: side('expenditure'), rows: within }
  })
})

function toCents(decimal: string | null | undefined): string {
  const text = String(decimal ?? '0')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return '0'
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  return `${negative ? '-' : ''}${whole}${`${fraction}00`.slice(0, 2)}`
}
function fromCents(cents: bigint): string {
  const negative = cents < 0n
  const digits = (negative ? -cents : cents).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

function meterClass(execution: string | null): string {
  if (execution === null) return ''
  const value = Number(execution)
  if (value >= thresholds.value.flag_execution_percentage) return 'over'
  if (value >= thresholds.value.warn_execution_percentage) return 'near'
  return ''
}

function openSection(section: string, query: Record<string, string> = {}): void {
  void router.replace({ query: { ...route.query, ...query, section } })
}

const flagLabel: Record<string, string> = {
  over_budget: 'Over the configured threshold',
  nearly_exhausted: 'Nearly exhausted',
  spend_without_budget: 'Spend with no budget',
  currency_mismatch: 'Postings in another currency',
}

// ── The position, as chart rows ───────────────────────────────────────────────────────────────
/**
 * One block per currency and side. The same `rows` array is handed to both charts and to the table
 * inside ChartFrame, which is what makes "the chart and the table are reading the same figures" a
 * property of the code rather than a claim in a comment.
 */
const positionBlocks = computed(() => series.value.map((s) => {
  const chartRows: ChartRow[] = s.points.map((p) => ({
    key: p.period_key,
    label: p.period_label,
    from: p.from_date,
    to: p.to_date,
    values: {
      budget: p.budget,
      actual: p.actual,
      commitments: p.commitments,
      cumulative_actual: p.cumulative_actual,
    },
  }))
  const moved = s.account_kind === 'revenue' ? 'Collected' : 'Spent'
  const columns: ChartColumn[] = [
    {
      key: 'budget',
      label: 'Allocation in force',
      note: 'The approved allocation as it stood at the close of the period — the original amounts plus every revision approved by then. The Council does not phase its budget by month, so this is not one twelfth of the year and nothing here is spread across the periods.',
    },
    {
      key: 'actual',
      label: `${moved} in period`,
      note: 'From the council\'s imported transactions, dated by the day of the transaction and counted in their own currency. Amounts are signed, so a correction nets off the row it reverses.',
    },
    {
      key: 'commitments',
      label: 'Commitments raised',
      note: 'The still-open balance of commitments raised in the period. A commitment is not spending; it is money already promised out of the allocation.',
    },
    { key: 'cumulative_actual', label: `${moved}, running total` },
  ]
  const barSeries: ChartSeries[] = [
    { key: 'actual', name: `${moved} in the period`, role: 'bar' },
    { key: 'commitments', name: 'Commitments raised in the period', role: 'bar-secondary' },
  ]
  const lineSeries: ChartSeries[] = [
    { key: 'cumulative_actual', name: `${moved}, running total`, role: 'line' },
    { key: 'budget', name: 'Allocation in force', role: 'reference' },
  ]
  return {
    id: `${s.currency}-${s.account_kind}`,
    currency: s.currency,
    kind: s.account_kind,
    sideLabel: s.account_kind === 'revenue' ? 'Revenue' : 'Expenditure',
    moved,
    rows: chartRows,
    columns,
    barSeries,
    lineSeries,
  }
}))

// ── The attention feed ────────────────────────────────────────────────────────────────────────
const SEVERITY_WORD: Record<AttentionItem['severity'], string> = {
  act: 'Needs action',
  watch: 'Worth a look',
  info: 'For information',
}
const SEVERITY_ORDER: Record<AttentionItem['severity'], number> = { act: 0, watch: 1, info: 2 }

/** Something is there. Ordered by how much it is asking of the reader. */
const attentionOpen = computed(() => attention.value
  .filter((i) => !i.unavailable && i.count > 0)
  .slice()
  .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]))

/** Checked and empty. A result, stated as a sentence — never hidden (acceptance check C12). */
const attentionClear = computed(() => attention.value.filter((i) => !i.unavailable && i.count === 0))

/** Could not be computed. Listed apart, because unknown is not zero. */
const attentionUnavailable = computed(() => attention.value.filter((i) => i.unavailable))

const attentionTotal = computed(() => attentionOpen.value.reduce((n, i) => n + i.count, 0))

/** One polite live region for the whole feed, rather than one per row. */
const attentionAnnouncement = computed(() => {
  if (attentionError.value) return 'What needs attention could not be read.'
  if (attention.value.length === 0) return 'What needs attention has not been read yet.'
  if (attentionOpen.value.length === 0) return 'Nothing in this period needs attention.'
  return `${attentionTotal.value} item${attentionTotal.value === 1 ? '' : 's'} need attention, across ${attentionOpen.value.length} check${attentionOpen.value.length === 1 ? '' : 's'}.`
})

const seriesCurrencies = computed(() => [...new Set(series.value.map((s) => s.currency))])
</script>

<template>
  <div class="ins-page fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" class="fin-btn small" @click="load">Retry</button>
    </div>

    <div class="fin-section-actions">
      <label class="ins-field fcx-periodicity">
        <span>Period</span>
        <select v-model="periodicity" class="ins-input">
          <option v-for="choice in PERIODICITY_CHOICES" :key="choice" :value="choice">
            {{ PERIODICITY_LABEL[choice] }}
          </option>
        </select>
      </label>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
    </div>

    <p v-if="loading && rows.length === 0" class="fin-loading" role="status">Reading the budget position…</p>

    <div v-else-if="!yearId" class="fin-empty">
      <strong>No financial year is selected.</strong>
      <p>Choose a reporting period above, or create one under Financial years.</p>
    </div>

    <div v-else-if="rows.length === 0" class="fin-empty">
      <strong>No budget has been entered for {{ store.selectedYear?.label }}.</strong>
      <p>
        Once budget lines exist, this page shows the approved and revised budget, the actuals
        imported from the council's accounting records, open commitments and the available
        allocation — each separately for every currency the year is stated in — together with the
        year's movement period by period and a list of what needs a decision.
      </p>
      <p class="fin-setup-links">
        <button type="button" class="fin-btn small" @click="openSection('budget')">Budget</button>
        <button type="button" class="fin-btn small" @click="openSection('imports')">Data imports</button>
      </p>
    </div>

    <template v-else>
      <!-- ── 1. What needs attention ─────────────────────────────────────────────────────── -->
      <section class="ins-card" aria-labelledby="fcx-attention-head">
        <div class="ins-card-head">
          <h2 id="fcx-attention-head">Needs attention</h2>
          <span v-if="attentionOpen.length" class="ins-count">{{ attentionTotal }}</span>
        </div>
        <div class="ins-card-body">
          <p class="sr-only" role="status" aria-live="polite">{{ attentionAnnouncement }}</p>

          <div v-if="attentionError" class="ins-banner t-warning" role="alert">
            <AlertTriangle :size="16" aria-hidden="true" />
            <span>
              {{ attentionError }} Nothing on this list is shown as zero as a result — a count that
              could not be read is not a count of none.
            </span>
            <button type="button" class="fin-btn small" @click="loadAttention">Retry</button>
          </div>

          <p v-else-if="attentionLoading && attention.length === 0" class="fin-loading" role="status">
            Reading what needs attention…
          </p>

          <template v-else>
            <ul v-if="attentionOpen.length" class="fcx-feed">
              <li v-for="item in attentionOpen" :key="item.id" class="fcx-feed-row" :class="`sev-${item.severity}`">
                <p class="fcx-feed-count">
                  <span class="fcx-feed-number">{{ item.count }}</span>
                  <span class="fin-pill" :class="item.severity === 'act' ? 'tone-negative' : item.severity === 'watch' ? 'tone-warning' : ''">
                    {{ SEVERITY_WORD[item.severity] }}
                  </span>
                </p>
                <div class="fcx-feed-text">
                  <h3 class="fcx-feed-label">{{ item.label }}</h3>
                  <p class="fcx-feed-statement">{{ item.statement }}</p>
                  <p v-if="item.amounts && item.amounts.length" class="fcx-feed-amounts">
                    <span v-for="a in item.amounts" :key="a.currency" class="fcx-feed-amount">
                      {{ formatMoney(a.amount, a.currency) }}
                    </span>
                    <span class="fcx-feed-amount-note">
                      stated per currency and never added together.
                    </span>
                  </p>
                </div>
                <button type="button" class="fin-btn small fcx-feed-go"
                        @click="openSection(item.section, item.query ?? {})">
                  Open<span class="sr-only"> {{ item.label }}</span>
                  <ArrowRight :size="13" aria-hidden="true" />
                </button>
              </li>
            </ul>

            <!-- Nothing needing attention is a result, said plainly. Never a blank panel. -->
            <p v-else-if="attention.length" class="fcx-feed-allclear">
              <CheckCircle2 :size="15" aria-hidden="true" />
              <span>
                Nothing in {{ store.selectedYear?.label ?? 'this period' }} needs attention. Every
                check below was run and came back empty.
              </span>
            </p>

            <div v-if="attentionClear.length" class="fcx-clear">
              <p class="fcx-clear-head">Checked and clear</p>
              <ul>
                <li v-for="item in attentionClear" :key="item.id">
                  <strong>{{ item.label }}:</strong> none.
                </li>
              </ul>
            </div>

            <div v-if="attentionUnavailable.length" class="fcx-unavailable">
              <p class="fcx-clear-head">
                <HelpCircle :size="13" aria-hidden="true" />
                Not counted — which is not the same as none
              </p>
              <ul>
                <li v-for="item in attentionUnavailable" :key="item.id">
                  <strong>{{ item.label }}:</strong> {{ item.unavailable_reason }}
                </li>
              </ul>
            </div>

            <p v-if="attentionScope" class="fin-ccy-note">
              <Info :size="14" aria-hidden="true" />
              <span>
                These counts cover your own votes only ({{ attentionScope.join(', ') }}), not the
                whole council.
              </span>
            </p>
            <p v-if="attentionAt" class="fin-asat">Counted at {{ formatDateTime(attentionAt) }}.</p>
          </template>
        </div>
      </section>

      <!-- ── 2. The lines behind the budget items ────────────────────────────────────────── -->
      <section v-if="flagged.length" class="ins-card">
        <div class="ins-card-head">
          <h3>
            <AlertTriangle :size="15" aria-hidden="true" />
            Lines worth a second look
            <span class="ins-count">{{ flagged.length }}</span>
          </h3>
        </div>
        <div class="ins-card-body">
          <p class="fin-ccy-note" style="margin-top: 0">
            Flagged against the council's own thresholds
            ({{ thresholds.warn_execution_percentage }}% warning,
            {{ thresholds.flag_execution_percentage }}% over). These are advisory; nothing is blocked.
          </p>
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Department</th>
                  <th scope="col">Account</th>
                  <th scope="col" class="ccy">Ccy</th>
                  <th scope="col" class="num">Revised</th>
                  <th scope="col" class="num">Actual</th>
                  <th scope="col" class="num">Execution</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in flagged" :key="line.budget_line_id">
                  <td class="ins-mono">{{ line.code }}</td>
                  <td>{{ line.department_name }}</td>
                  <td>{{ line.account_code }} {{ line.account_name }}</td>
                  <td class="ccy">{{ line.currency }}</td>
                  <td class="num">{{ formatMoney(line.revised_amount, line.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(line.actual_amount, line.currency, { bare: true }) }}</td>
                  <td class="num" :class="{ 'undefined-value': line.execution_percentage === null }">
                    {{ formatPercentage(line.execution_percentage) }}
                  </td>
                  <td>
                    <span class="fin-pill" :class="line.flag === 'currency_mismatch' ? 'tone-warning' : 'tone-negative'">
                      {{ flagLabel[line.flag] ?? line.flag }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ── 3. Where the year has got to ────────────────────────────────────────────────── -->
      <section class="ins-card" aria-labelledby="fcx-position-head">
        <div class="ins-card-head">
          <h2 id="fcx-position-head">Where the year has got to</h2>
          <span class="ins-count">{{ PERIODICITY_LABEL[periodicity] }}</span>
        </div>
        <div class="ins-card-body">
          <div v-if="seriesError" class="ins-banner t-warning" role="alert">
            <AlertTriangle :size="16" aria-hidden="true" />
            <span>{{ seriesError }} The figures below this panel are unaffected.</span>
            <button type="button" class="fin-btn small" @click="loadPosition">Retry</button>
          </div>

          <template v-else-if="positionBlocks.length">
            <p class="fcx-position-lede">
              One chart set per currency and side, because no chart may plot two currencies on one
              axis — there is no Council-approved rate to convert them with (decision D4).
              {{ seriesCurrencies.length > 1
                ? `This year is stated in ${seriesCurrencies.join(' and ')}, so each has its own.`
                : `This year is stated in ${seriesCurrencies[0]} only.` }}
              Every period is shown even where nothing moved in it: an empty month is a fact, not a
              gap to close.
            </p>

            <div class="fcx-position-grid">
              <ChartFrame
                v-for="block in positionBlocks"
                :key="block.id"
                :title="`${block.sideLabel}, period by period`"
                :eyebrow="block.sideLabel"
                :currency="block.currency"
                :caption="`What moved in each period, and the running total against the allocation in force. Figures come from the council's imported transactions and its approved allocation; nothing on this chart is converted from another currency.`"
                :rows="block.rows"
                :columns="block.columns"
                :table-caption="`Every figure drawn above, in ${block.currency}. The allocation in force is the approved allocation as it stood at the close of each period.`"
                empty-message="A chart appears here once the year has at least one period with a budget line, a transaction or a commitment in it."
              >
                <PeriodBars
                  :rows="block.rows"
                  :series="block.barSeries"
                  :currency="block.currency"
                  :accessible-name="`Bar chart: ${block.moved.toLowerCase()} and commitments raised in each period, ${block.sideLabel.toLowerCase()}, in ${block.currency}. The same figures are in the table below.`"
                />
                <PeriodLines
                  :rows="block.rows"
                  :series="block.lineSeries"
                  :currency="block.currency"
                  :accessible-name="`Line chart: ${block.moved.toLowerCase()} running total against the allocation in force, ${block.sideLabel.toLowerCase()}, in ${block.currency}. The same figures are in the table below.`"
                />
              </ChartFrame>
            </div>

            <p class="fin-ccy-note">
              <Info :size="14" aria-hidden="true" />
              <span>
                The period figures are counted from the transaction's own currency and date, so they
                include spending that is not yet attributed to a budget line. The departmental
                figures further down attribute spending to lines and exclude anything posted in
                another currency, so the two can differ — and where they do, the difference is on
                the Needs attention list above.
              </span>
            </p>
            <p v-if="seriesScope" class="fin-ccy-note">
              <Info :size="14" aria-hidden="true" />
              <span>These charts cover your own votes only ({{ seriesScope.join(', ') }}), not the whole council.</span>
            </p>
          </template>

          <div v-else class="fin-empty">
            <strong>There is nothing to plot for {{ store.selectedYear?.label }} yet.</strong>
            <p>
              A chart appears here once the year has a budget line, a transaction or a commitment in
              it. The period columns come from the Council's own financial year dates, so a
              July-to-June year starts at July.
            </p>
          </div>
        </div>
      </section>

      <!-- ── 4. The position per currency ────────────────────────────────────────────────── -->
      <section v-for="block in byCurrency" :key="block.currency" class="fin-ccy-group">
        <h2 class="fin-ccy-head">
          {{ block.currency }}
          <small>{{ currencyName(block.currency) }}</small>
        </h2>

        <div class="fin-sides">
          <article v-for="side in [block.revenue, block.expenditure].filter(Boolean)" :key="side!.kind" class="ins-card">
            <div class="ins-card-head">
              <h3>
                <component :is="side!.kind === 'revenue' ? TrendingUp : TrendingDown" :size="15" aria-hidden="true" />
                {{ side!.kind === 'revenue' ? 'Revenue' : 'Expenditure' }}
                <span class="ins-count">{{ side!.departments }} department{{ side!.departments === 1 ? '' : 's' }}</span>
              </h3>
            </div>
            <div class="ins-card-body">
              <dl class="fin-figures">
                <div class="fin-figure">
                  <dt>Original budget</dt>
                  <dd>{{ formatMoney(side!.original, block.currency, { bare: true }) }}</dd>
                </div>
                <div class="fin-figure">
                  <dt>Approved adjustments</dt>
                  <dd>{{ formatMoney(side!.adjustments, block.currency, { bare: true }) }}</dd>
                </div>
                <div class="fin-figure">
                  <dt>Revised budget</dt>
                  <dd>{{ formatMoney(side!.revised, block.currency, { bare: true }) }}</dd>
                </div>
                <div class="fin-figure">
                  <dt>{{ side!.kind === 'revenue' ? 'Collected' : 'Spent' }}</dt>
                  <dd>{{ formatMoney(side!.actual, block.currency, { bare: true }) }}</dd>
                </div>
                <div class="fin-figure" :class="{ 'is-negative': side!.available.startsWith('-') }">
                  <dt>Available</dt>
                  <dd>
                    {{ formatMoney(side!.available, block.currency, { bare: true }) }}
                    <span class="fin-figure-note">
                      {{ includesCommitments ? 'commitments included' : 'commitments excluded' }}
                    </span>
                  </dd>
                </div>
                <div class="fin-figure">
                  <dt>Execution</dt>
                  <dd>
                    {{ formatPercentage(side!.execution) }}
                    <span class="fin-meter" :class="meterClass(side!.execution)" aria-hidden="true">
                      <span :style="{ width: `${Math.min(100, Number(side!.execution ?? 0))}%` }"></span>
                    </span>
                  </dd>
                </div>
              </dl>

              <p v-if="side!.commitments !== '0.00'" class="fin-ccy-note">
                Open commitments: {{ formatMoney(side!.commitments, block.currency) }}.
                The available figure above
                {{ includesCommitments ? 'subtracts them' : 'does not subtract them' }} — the
                Council sets which definition is shown, under Settings.
              </p>

              <p v-if="side!.currencyFaults > 0" class="ins-banner t-warning">
                <AlertTriangle :size="15" aria-hidden="true" />
                <span>
                  {{ side!.currencyFaults }} transaction{{ side!.currencyFaults === 1 ? ' is' : 's are' }}
                  posted against a {{ block.currency }} budget line in a different currency. They are
                  excluded from the figures above and never converted. See Budget for the lines
                  affected.
                </span>
              </p>
            </div>
          </article>
        </div>
      </section>

      <p class="fin-ccy-note">
        <Info :size="14" aria-hidden="true" />
        USD and ZWG figures are reported separately throughout this system and are never added
        together. No exchange rate is applied; doing so needs a Council-approved rate source and
        conversion rule.
      </p>

      <!-- ── 5. The detail by department ─────────────────────────────────────────────────── -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h3>By department <span class="ins-count">{{ rows.length }} row{{ rows.length === 1 ? '' : 's' }}</span></h3>
        </div>
        <div class="ins-card-body">
          <div class="fin-table-wrap">
            <table class="fin-table">
              <caption>
                One row per department, per revenue/expenditure, per currency. A department that
                budgets in two currencies appears twice, and the two are not combined.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Side</th>
                  <th scope="col" class="ccy">Ccy</th>
                  <th scope="col" class="num">Lines</th>
                  <th scope="col" class="num">Original</th>
                  <th scope="col" class="num">Adjustments</th>
                  <th scope="col" class="num">Revised</th>
                  <th scope="col" class="num">Actual</th>
                  <th scope="col" class="num">Available</th>
                  <th scope="col" class="num">Execution</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="`${r.department_id}-${r.account_kind}-${r.currency}`">
                  <td>
                    <span class="ins-mono">{{ r.department_code }}</span>
                    {{ r.department_name }}
                  </td>
                  <td>{{ r.account_kind }}</td>
                  <td class="ccy">{{ r.currency }}</td>
                  <td class="num">{{ r.line_count }}</td>
                  <td class="num">{{ formatMoney(r.original_amount, r.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(r.approved_adjustments, r.currency, { bare: true }) }}</td>
                  <td class="num emphasis">{{ formatMoney(r.revised_amount, r.currency, { bare: true }) }}</td>
                  <td class="num">{{ formatMoney(r.actual_amount, r.currency, { bare: true }) }}</td>
                  <td class="num">
                    {{ formatMoney(includesCommitments ? r.available_including_commitments : r.available_excluding_commitments, r.currency, { bare: true }) }}
                  </td>
                  <td class="num" :class="{ 'undefined-value': r.execution_percentage === null }">
                    {{ formatPercentage(r.execution_percentage) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <p class="fin-asat">
        Figures are as imported from the council's accounting records. The source file, its
        checksum and its reconciliation result are kept with every import; see Data imports.
        <template v-if="store.selectedYear">
          Period: {{ formatDate(store.selectedYear.start_date) }} to {{ formatDate(store.selectedYear.end_date) }}.
        </template>
      </p>
    </template>
  </div>
</template>

<style scoped>
/*
  Every new class here is prefixed `fcx-`. finance.css already owns .fin-bar, .fin-meter,
  .fin-figure and .fin-map (a grid definition-list, not a map), and .ins-bar is a progress meter
  that once silently hid an entire toolbar — so nothing below can collide with any of them.
*/
.fin-section { padding: 0; gap: var(--ent-s4); }
.fin-section-actions { display: flex; justify-content: flex-end; align-items: flex-end; gap: var(--ent-s3); }
.fin-sides { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: var(--ent-s4); }
.fin-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.fin-setup-links { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
.fin-asat { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); line-height: var(--ent-lh); max-width: 80ch; }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }

/* .ins-field already stacks its label over its control; this only stops the select collapsing
   inside the right-aligned action row, where .ins-input is width:100% on a min-width:0 parent. */
.fcx-periodicity { min-width: 11rem; }
.fcx-periodicity > span {
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ent-text-3);
}

/* The feed. A list of sentences with their counts in front of them — deliberately the same
   grammar as FinanceWorkQueue, and deliberately not a row of metric cards. */
.fcx-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.fcx-feed-row {
  display: grid;
  grid-template-columns: minmax(6rem, auto) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--ent-s3);
  padding: var(--ent-s3);
  background: var(--ent-surface-2);
  border-left: 2px solid var(--ent-line-strong);
  border-radius: 0 var(--ent-r-sm) var(--ent-r-sm) 0;
}
.fcx-feed-row.sev-act { border-left-color: var(--ent-danger); }
.fcx-feed-row.sev-watch { border-left-color: var(--ent-warning); }
.fcx-feed-row.sev-info { border-left-color: var(--ent-line-strong); }

.fcx-feed-count { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: var(--ent-s1); }
.fcx-feed-number {
  font-variant-numeric: tabular-nums;
  font-size: var(--ent-fs-lg);
  font-weight: var(--ent-fw-semibold);
  line-height: 1.1;
  color: var(--ent-text);
}
.fcx-feed-text { min-width: 0; }
.fcx-feed-label { margin: 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.fcx-feed-statement {
  margin: var(--ent-s1) 0 0;
  max-width: 76ch;
  font-size: var(--ent-fs-xs);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}
.fcx-feed-amounts {
  margin: var(--ent-s2) 0 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ent-s1) var(--ent-s3);
  font-size: var(--ent-fs-xs);
}
.fcx-feed-amount { font-variant-numeric: tabular-nums; font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.fcx-feed-amount-note { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.fcx-feed-go { align-self: center; white-space: nowrap; }

.fcx-feed-allclear {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--ent-s2);
  max-width: 80ch;
  font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh);
  color: var(--ent-text);
}

.fcx-clear, .fcx-unavailable { margin-top: var(--ent-s3); }
.fcx-clear-head {
  margin: 0 0 var(--ent-s1);
  display: flex;
  align-items: center;
  gap: var(--ent-s1);
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ent-text-3);
}
.fcx-clear ul, .fcx-unavailable ul {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fcx-clear li, .fcx-unavailable li {
  font-size: var(--ent-fs-xs);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
  max-width: 80ch;
}
.fcx-clear li strong, .fcx-unavailable li strong { font-weight: var(--ent-fw-medium); color: var(--ent-text); }
.fcx-unavailable { border-top: 1px solid var(--ent-line); padding-top: var(--ent-s3); }

.fcx-position-lede {
  margin: 0 0 var(--ent-s4);
  max-width: 80ch;
  font-size: var(--ent-fs-sm);
  line-height: var(--ent-lh);
  color: var(--ent-text-2);
}
.fcx-position-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(28rem, 1fr));
  gap: var(--ent-s4);
  margin-bottom: var(--ent-s4);
}

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (max-width: 719px) {
  .fcx-feed-row { grid-template-columns: minmax(0, 1fr); }
  .fcx-feed-count { flex-direction: row; align-items: center; }
  .fcx-feed-go { align-self: flex-start; }
}
</style>
