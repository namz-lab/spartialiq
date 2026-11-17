<script setup lang="ts">
/**
 * The statements drawn from the book of account: the trial balance, the statement of financial
 * position, the statement of financial performance, and debtor ageing.
 *
 * Nothing on this screen writes. The ledger itself is the section before this one.
 *
 * TWO TRIAL BALANCES, SIDE BY SIDE, AND NO THIRD FIGURE
 * A trial balance must balance, and with two currencies and no Council-approved conversion basis
 * (decision D4) a single balancing trial balance is arithmetically impossible without inventing a
 * rate. So the council keeps two self-balancing sets of books and this screen shows them beside
 * each other, each stating that it balances and by how much it does not. There is deliberately no
 * combined column, no grand total and no "all currencies" option anywhere on this page — not as a
 * default, not behind a toggle. Every figure is rendered with its own currency beside it.
 *
 * `incomplete` IS THE MOST IMPORTANT THING ON THE POSITION STATEMENT
 * Creditors, the cashbook and bank reconciliation, and fixed assets are deferred workstreams. So
 * this statement shows what the council is OWED and not what it OWES, and its bank balance is
 * unreconciled. A position statement that omitted payables without saying so would be the most
 * dangerous screen in this system — a reader would take it for a complete balance sheet — so the
 * backend returns the omissions as sentences and this screen renders them above the figures, in an
 * alert region, never collapsed and never as a footnote. The heading says "not a complete IPSAS
 * statement" for the same reason.
 *
 * A BALANCE IS SHOWN ON ITS OWN SIDE, NOT AS AN ABSOLUTE
 * `natural_side` comes from the account's root type: an asset and an expense are debit-natured, a
 * liability, equity and revenue credit-natured. An asset carrying a credit balance is a fact worth
 * seeing, so it is shown as the negative it is rather than quietly flipped to look tidy.
 *
 * AGEING IS SHOWN WITH ITS RECONCILIATION, BECAUSE THAT IS THE USUAL FAILURE
 * Most ageing reports disagree with the receivable control account and never say so: an unallocated
 * receipt is dropped and the two drift apart. Here an unmatched receipt is its own `unallocated`
 * row carrying a negative outstanding figure, so the ageing total equals the control balance — and
 * this screen puts the two beside each other and states whether they agree, per currency. It is the
 * check the view is designed to pass, so it is shown rather than assumed.
 *
 * `null` IS NOT NIL. A period with no activity reports nil and still gets its column; a date or a
 * party that was never recorded says so.
 *
 * HOW THIS STAYS OFF THE GENERIC-SAAS-DASHBOARD ANTI-REFERENCE (PRODUCT.md)
 * These are statements, so they look like statements: ruled tables with a debit and a credit column,
 * right-aligned tabular figures, section headings in the order a statement prints them, and
 * subtotals at the foot of their own section. No hero metrics, no metric cards, no icon grid. The
 * only accent is the out-of-balance marker, which should never appear.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle, CheckCircle2, FileBarChart, Info, RefreshCw, Scale, Users,
} from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { ledgerApi } from '../../api/ledgerApi'
import { formatDate, formatMoney } from '../../composables/useMoney'
import type {
  AgeingBucket, Currency, DebtorAgeingResult, LedgerRootType, PerformanceStatement,
  Periodicity, PositionStatement, TrialBalanceResult,
} from '../../models/ledgerTypes'

const store = useFinanceStore()

/** The statement a workspace page opens on. */
const props = defineProps<{ initialTab?: 'trial_balance' | 'position' | 'performance' | 'ageing' }>()

type Tab = 'trial_balance' | 'position' | 'performance' | 'ageing'

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'trial_balance', label: 'Trial balance', hint: 'One per currency. Each must balance.' },
  { key: 'position', label: 'Financial position', hint: 'What the council holds and owes.' },
  { key: 'performance', label: 'Financial performance', hint: 'Revenue and expenditure for the year.' },
  { key: 'ageing', label: 'Debtor ageing', hint: 'What is owed, and for how long.' },
]

const tab = ref<Tab>(props.initialTab ?? 'trial_balance')
const error = ref<string | null>(null)
const loading = ref(false)

const yearId = computed(() => store.selectedYearId)
const yearLabel = computed(() => store.selectedYear?.label ?? 'the selected period')

const ROOT_LABEL: Record<LedgerRootType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expenditure',
}

const PERIODICITY_LABEL: Record<Periodicity, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'The year',
}

// ── Trial balance ─────────────────────────────────────────────────────────────────────────────

const trial = ref<TrialBalanceResult | null>(null)
const includeNil = ref(false)

async function loadTrial(): Promise<void> {
  if (!yearId.value) { trial.value = null; return }
  loading.value = true
  error.value = null
  try {
    trial.value = await ledgerApi.trialBalance({
      financial_year_id: yearId.value, include_nil: includeNil.value || undefined,
    })
  } catch (err) {
    trial.value = null
    error.value = messageOf(err, 'The trial balance could not be read.')
  } finally {
    loading.value = false
  }
}

/** The accounts of one book, in code order. Never two currencies in one list. */
const trialRowsFor = (currency: Currency) =>
  (trial.value?.accounts ?? []).filter((r) => r.currency === currency)

// ── Statement of financial position ───────────────────────────────────────────────────────────

const position = ref<PositionStatement | null>(null)

async function loadPosition(): Promise<void> {
  if (!yearId.value) { position.value = null; return }
  loading.value = true
  error.value = null
  try {
    position.value = await ledgerApi.position({ financial_year_id: yearId.value })
  } catch (err) {
    position.value = null
    error.value = messageOf(err, 'The statement of financial position could not be read.')
  } finally {
    loading.value = false
  }
}

/** One section's subtotal, as the server computed it. Looked up, never added here. */
function subtotalOf(
  statement: PositionStatement | PerformanceStatement | null,
  currency: Currency, rootType: LedgerRootType,
): string | null {
  const found = (statement as PositionStatement | null)?.subtotals?.find(
    (s) => s.currency === currency && s.root_type === rootType,
  )
  return found ? found.subtotal : null
}

// ── Statement of financial performance ────────────────────────────────────────────────────────

const performance = ref<PerformanceStatement | null>(null)
const periodicity = ref<Periodicity | ''>('')
const accumulated = ref(false)

async function loadPerformance(): Promise<void> {
  if (!yearId.value) { performance.value = null; return }
  loading.value = true
  error.value = null
  try {
    performance.value = await ledgerApi.performance({
      financial_year_id: yearId.value,
      periodicity: periodicity.value || undefined,
      accumulated: accumulated.value || undefined,
    })
  } catch (err) {
    performance.value = null
    error.value = messageOf(err, 'The statement of financial performance could not be read.')
  } finally {
    loading.value = false
  }
}

/**
 * One account's figure in one period, or null when the period held no activity.
 *
 * `null` renders as nil WITH its column, never as a dropped column: a month with no activity is a
 * fact a director needs to see, and nothing here interpolates or carries forward.
 */
function periodCell(currency: Currency, accountId: string, key: string): string | null {
  const row = performance.value?.period_rows.find(
    (r) => r.currency === currency && r.ledger_account_id === accountId && r.key === key,
  )
  return row ? row.balance : null
}

// ── Debtor ageing ─────────────────────────────────────────────────────────────────────────────

const ageing = ref<DebtorAgeingResult | null>(null)

async function loadAgeing(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    ageing.value = await ledgerApi.debtorAgeing({ outstanding_only: true, limit: 200 })
  } catch (err) {
    ageing.value = null
    error.value = messageOf(err, 'The debtor ageing could not be read.')
  } finally {
    loading.value = false
  }
}

const ageingCurrencies = computed<Currency[]>(() =>
  [...new Set((ageing.value?.by_bucket ?? []).map((b) => b.currency))].sort())

const bucketOrder = computed<AgeingBucket[]>(() =>
  (ageing.value?.buckets ?? []).map((b) => b.key))

const bucketLabel = (key: AgeingBucket): string =>
  ageing.value?.buckets.find((b) => b.key === key)?.label ?? key

function bucketTotal(currency: Currency, bucket: AgeingBucket) {
  return (ageing.value?.by_bucket ?? []).find(
    (b) => b.currency === currency && b.ageing_bucket === bucket,
  ) ?? null
}

/**
 * The reconciliation, exactly as the server computed it.
 *
 * Both totals were summed by Postgres over NUMERIC and Postgres did the comparison, so `agrees` is
 * not a claim this screen makes — it is a fact it relays. Nothing here adds or compares an amount.
 */
const reconciliation = computed(() => ageing.value?.reconciliation ?? [])
const reconciliationBroken = computed(() => reconciliation.value.filter((r) => !r.agrees))

/** How many parties owe anything in this book, for the reconciliation row's context. */
const partyCount = (currency: Currency): number =>
  (ageing.value?.by_party ?? []).filter((p) => p.currency === currency).length

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

function load(): void {
  if (tab.value === 'trial_balance') void loadTrial()
  else if (tab.value === 'position') void loadPosition()
  else if (tab.value === 'performance') void loadPerformance()
  else void loadAgeing()
}

onMounted(load)
watch([tab, yearId], load)
watch([includeNil], () => { if (tab.value === 'trial_balance') void loadTrial() })
watch([periodicity, accumulated], () => { if (tab.value === 'performance') void loadPerformance() })
</script>

<template>
  <div class="ins-page fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
      <button type="button" class="fin-btn small" @click="load">Retry</button>
    </div>

    <!-- The standing statement. A reader who took these for a Council-approved set of accounts
         would misread all of them. -->
    <p class="st-preamble">
      <Info :size="15" aria-hidden="true" />
      <span>
        Drawn from the council's own book of account. Kept as
        <strong>two self-balancing sets of books</strong>, one in USD and one in ZWG — the Council
        has approved no conversion basis, so <strong>no figure on this page spans them</strong> and
        there is no combined total anywhere, by design. These are not audited statements.
      </span>
    </p>

    <div class="st-tabs" role="tablist" aria-label="Statements">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab"
              class="st-tab" :class="{ 'is-current': tab === t.key }"
              :aria-selected="tab === t.key" @click="tab = t.key">
        <span class="st-tab-label">{{ t.label }}</span>
        <span class="st-tab-hint">{{ t.hint }}</span>
      </button>
    </div>

    <div v-if="!yearId" class="fin-empty">
      <strong>No financial year is selected.</strong>
      <p>Choose a reporting period above.</p>
    </div>

    <!-- ══ Trial balance ════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="tab === 'trial_balance'">
      <div class="fin-bar">
        <label class="st-check">
          <input v-model="includeNil" type="checkbox" />
          <span>Include accounts whose balance is nil</span>
        </label>
        <button type="button" class="fin-btn small" :disabled="loading" @click="loadTrial">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>

      <p v-if="loading && !trial" class="st-loading" role="status">Reading the trial balance…</p>

      <div v-else-if="trial && trial.books.length === 0" class="fin-empty">
        <strong>Nothing has been posted for {{ yearLabel }}.</strong>
        <p>
          A trial balance is drawn from posted ledger entries. Until a voucher has been posted there
          is nothing to list — and nothing is seeded, because the chart of accounts is a Council
          resolution.
        </p>
      </div>

      <template v-else-if="trial">
        <!-- Whether each book balances, said first, because a trial balance that does not is a
             defect rather than something to present. -->
        <p v-if="trial.unbalanced.length > 0" class="ins-banner t-negative" role="alert">
          <AlertTriangle :size="16" aria-hidden="true" />
          <span>
            The {{ trial.unbalanced.join(' and ') }}
            {{ trial.unbalanced.length === 1 ? 'book does' : 'books do' }} not balance. That is a
            defect in the data, not a presentation choice: every voucher is refused unless its
            debits equal its credits, so an out-of-balance book means something was posted outside
            that control and must be investigated before any figure here is used.
          </span>
        </p>

        <div class="st-books" :class="{ 'is-single': trial.books.length === 1 }">
          <section v-for="book in trial.books" :key="book.currency" class="ins-card st-book"
                   :aria-labelledby="`st-tb-${book.currency}`">
            <div class="ins-card-head">
              <h2 :id="`st-tb-${book.currency}`">
                <Scale :size="15" aria-hidden="true" />
                {{ book.currency }} book
                <span class="ins-count">{{ book.account_count }}</span>
              </h2>
              <span class="st-verdict" :class="book.balances ? 'is-ok' : 'is-off'"
                    :data-test="`balances-${book.currency}`">
                <component :is="book.balances ? CheckCircle2 : AlertTriangle" :size="13" aria-hidden="true" />
                {{ book.balances ? 'Balances' : `Out by ${formatMoney(book.difference, book.currency, { bare: true })}` }}
              </span>
            </div>
            <div class="ins-card-body">
              <div class="fin-table-wrap">
                <table class="fin-table st-tb">
                  <caption class="sr-only">
                    Trial balance of the {{ book.currency }} book for {{ yearLabel }}. Every figure
                    is in {{ book.currency }}; this table carries no other currency.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Root</th>
                      <th scope="col" class="num">Debit</th>
                      <th scope="col" class="num">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in trialRowsFor(book.currency)" :key="row.ledger_account_id ?? 'unclosed-surplus'">
                      <td>
                        <span class="ins-mono st-code">{{ row.account_code }}</span>
                        <br /><small class="st-sub">{{ row.account_name }}</small>
                      </td>
                      <td><small class="st-sub">{{ ROOT_LABEL[row.root_type] }}</small></td>
                      <td class="num">
                        {{ Number(row.debit_balance) === 0 ? '' : formatMoney(row.debit_balance, book.currency, { bare: true }) }}
                      </td>
                      <td class="num">
                        {{ Number(row.credit_balance) === 0 ? '' : formatMoney(row.credit_balance, book.currency, { bare: true }) }}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr class="st-total-row">
                      <th scope="row" colspan="2">Total — {{ book.currency }} only</th>
                      <td class="num emphasis">{{ formatMoney(book.debit_total, book.currency, { bare: true }) }}</td>
                      <td class="num emphasis">{{ formatMoney(book.credit_total, book.currency, { bare: true }) }}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        </div>

        <p class="st-caption">
          <Info :size="14" aria-hidden="true" />
          <span>{{ trial.note }}</span>
        </p>
      </template>
    </template>

    <!-- ══ Statement of financial position ══════════════════════════════════════════════════ -->
    <template v-else-if="tab === 'position'">
      <div class="fin-bar">
        <button type="button" class="fin-btn small" :disabled="loading" @click="loadPosition">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>

      <p v-if="loading && !position" class="st-loading" role="status">
        Reading the statement of financial position…
      </p>

      <template v-else-if="position">
        <!-- WHAT IS MISSING, FIRST AND PROMINENTLY. A reader must not be able to take this for a
             complete balance sheet, so it is an alert region above the figures and never
             collapsible. -->
        <div v-if="position.incomplete.length" class="st-incomplete" role="alert"
             data-test="position-incomplete">
          <h2 class="st-incomplete-head">
            <AlertTriangle :size="16" aria-hidden="true" />
            This is not a complete statement of financial position
          </h2>
          <ul>
            <li v-for="item in position.incomplete" :key="item">{{ item }}</li>
          </ul>
          <p>
            Those are consequences of what the council has asked for so far, not defects in what is
            built — but a statement presented as complete while they stand would mislead. Do not
            put this in front of the Auditor-General as a balance sheet.
          </p>
        </div>

        <div v-if="position.books.length === 0" class="fin-empty">
          <strong>Nothing has been posted for {{ yearLabel }}.</strong>
          <p>A statement of financial position is drawn from posted ledger entries.</p>
        </div>

        <div v-else class="st-books" :class="{ 'is-single': position.books.length === 1 }">
          <section v-for="book in position.books" :key="book.currency" class="ins-card st-book"
                   :aria-labelledby="`st-pos-${book.currency}`">
            <div class="ins-card-head">
              <h2 :id="`st-pos-${book.currency}`">{{ book.currency }} book</h2>
              <span class="st-asat">as at the end of {{ yearLabel }}</span>
            </div>
            <div class="ins-card-body">
              <div v-for="section in book.sections" :key="section.root_type" class="st-section">
                <h3 class="st-section-head">
                  {{ ROOT_LABEL[section.root_type] }}
                  <small>normally {{ section.natural_side }}</small>
                </h3>
                <p v-if="section.accounts.length === 0" class="st-sub st-section-empty">
                  None recorded. That is a fact about the book, not a figure of nil — no account of
                  this kind carries a balance.
                </p>
                <div v-else class="fin-table-wrap">
                  <table class="fin-table">
                    <caption class="sr-only">
                      {{ ROOT_LABEL[section.root_type] }} in the {{ book.currency }} book. Every
                      figure is in {{ book.currency }}.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col" class="num">{{ book.currency }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in section.accounts" :key="row.ledger_account_id ?? row.account_name">
                        <td>
                          <span class="ins-mono st-code">{{ row.account_code }}</span>
                          <br /><small class="st-sub">{{ row.account_name }}</small>
                        </td>
                        <!-- Shown on the account's own natural side, so a credit balance on an
                             asset reads as the negative it is rather than being flipped. -->
                        <td class="num" :class="{ 'st-contra': row.balance.startsWith('-') }">
                          {{ formatMoney(row.balance, book.currency, { bare: true }) }}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr class="st-total-row">
                        <th scope="row">
                          Total {{ ROOT_LABEL[section.root_type].toLowerCase() }} — {{ book.currency }}
                        </th>
                        <td class="num emphasis">
                          {{ formatMoney(subtotalOf(position, book.currency, section.root_type), book.currency, { bare: true }) }}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>

        <p class="st-caption">
          <Info :size="14" aria-hidden="true" /><span>{{ position.note }}</span>
        </p>
      </template>
    </template>

    <!-- ══ Statement of financial performance ═══════════════════════════════════════════════ -->
    <template v-else-if="tab === 'performance'">
      <div class="fin-bar">
        <label class="ins-field st-filter">
          <span class="ins-label">Period columns</span>
          <select v-model="periodicity" class="ins-input">
            <option value="">The year in one column</option>
            <option v-for="(label, key) in PERIODICITY_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label v-if="periodicity" class="st-check">
          <input v-model="accumulated" type="checkbox" />
          <span>Year-to-date columns</span>
        </label>
        <button type="button" class="fin-btn small" :disabled="loading" @click="loadPerformance">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>

      <p v-if="loading && !performance" class="st-loading" role="status">
        Reading the statement of financial performance…
      </p>

      <template v-else-if="performance">
        <div v-if="performance.incomplete.length" class="st-incomplete" role="alert"
             data-test="performance-incomplete">
          <h2 class="st-incomplete-head">
            <AlertTriangle :size="16" aria-hidden="true" />
            This statement is incomplete
          </h2>
          <ul>
            <li v-for="item in performance.incomplete" :key="item">{{ item }}</li>
          </ul>
        </div>

        <p v-if="performance.accumulated" class="st-caption st-warn">
          <AlertTriangle :size="14" aria-hidden="true" />
          <span>
            The columns are year-to-date and therefore <strong>overlap</strong>: each runs from the
            year start. They must not be added together — the last one is already the whole year.
          </span>
        </p>

        <div v-if="performance.books.length === 0" class="fin-empty">
          <strong>No revenue or expenditure has been posted for {{ yearLabel }}.</strong>
          <p>A statement of financial performance is drawn from posted ledger entries.</p>
        </div>

        <section v-for="book in performance.books" :key="book.currency" class="ins-card"
                 :aria-labelledby="`st-perf-${book.currency}`">
          <div class="ins-card-head">
            <h2 :id="`st-perf-${book.currency}`">
              <FileBarChart :size="15" aria-hidden="true" />
              {{ book.currency }} book
            </h2>
            <span class="st-asat">{{ performance.financial_year.label }}</span>
          </div>
          <div class="ins-card-body">
            <div v-for="section in book.sections" :key="section.root_type" class="st-section">
              <h3 class="st-section-head">
                {{ ROOT_LABEL[section.root_type] }}
                <small>normally {{ section.natural_side }}</small>
              </h3>
              <p v-if="section.accounts.length === 0" class="st-sub st-section-empty">
                None recorded in {{ book.currency }} for this year.
              </p>
              <div v-else class="fin-table-wrap">
                <table class="fin-table">
                  <caption class="sr-only">
                    {{ ROOT_LABEL[section.root_type] }} in the {{ book.currency }} book, in
                    {{ book.currency }} only.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th v-for="p in performance.periods ?? []" :key="p.key" scope="col" class="num">
                        {{ p.label }}
                      </th>
                      <th scope="col" class="num">Year ({{ book.currency }})</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in section.accounts" :key="row.ledger_account_id ?? row.account_name">
                      <td>
                        <span class="ins-mono st-code">{{ row.account_code }}</span>
                        <br /><small class="st-sub">{{ row.account_name }}</small>
                      </td>
                      <!-- A period with no activity reports nil and keeps its column. Nothing is
                           interpolated, carried forward or dropped. -->
                      <td v-for="p in performance.periods ?? []" :key="p.key" class="num">
                        <template v-if="periodCell(book.currency, row.ledger_account_id ?? '', p.key) !== null">
                          {{ formatMoney(periodCell(book.currency, row.ledger_account_id ?? '', p.key), book.currency, { bare: true }) }}
                        </template>
                        <span v-else class="st-nil">nil</span>
                      </td>
                      <td class="num emphasis">
                        {{ formatMoney(row.balance, book.currency, { bare: true }) }}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr class="st-total-row">
                      <th scope="row" :colspan="(performance.periods?.length ?? 0) + 1">
                        Total {{ ROOT_LABEL[section.root_type].toLowerCase() }} — {{ book.currency }}
                      </th>
                      <td class="num emphasis">
                        {{ formatMoney(subtotalOf(performance as never, book.currency, section.root_type), book.currency, { bare: true }) }}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </section>

        <p class="st-caption">
          <Info :size="14" aria-hidden="true" /><span>{{ performance.note }}</span>
        </p>
      </template>
    </template>

    <!-- ══ Debtor ageing ════════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="fin-bar">
        <button type="button" class="fin-btn small" :disabled="loading" @click="loadAgeing">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
        <span v-if="ageing" class="st-asat">Aged as at {{ formatDate(ageing.as_at) }}</span>
      </div>

      <p v-if="loading && !ageing" class="st-loading" role="status">Reading the debtor ageing…</p>

      <template v-else-if="ageing">
        <div v-if="ageing.bills.length === 0" class="fin-empty">
          <strong>No receivable is outstanding.</strong>
          <p>{{ ageing.note }}</p>
        </div>

        <template v-else>
          <!-- THE RECONCILIATION, SHOWN RATHER THAN ASSUMED. An ageing report that disagrees with
               its control account is the usual failure, and it fails silently. -->
          <section class="ins-card" aria-labelledby="st-recon-head" data-test="ageing-reconciliation">
            <div class="ins-card-head">
              <h2 id="st-recon-head"><Users :size="15" aria-hidden="true" /> Against the control account</h2>
              <span v-if="reconciliation.length" class="st-verdict"
                    :class="reconciliationBroken.length === 0 ? 'is-ok' : 'is-off'">
                <component :is="reconciliationBroken.length === 0 ? CheckCircle2 : AlertTriangle"
                           :size="13" aria-hidden="true" />
                {{ reconciliationBroken.length === 0 ? 'Reconciles' : 'Does not reconcile' }}
              </span>
            </div>
            <div class="ins-card-body">
              <p class="st-caption">
                <Info :size="14" aria-hidden="true" />
                <span>
                  An ageing report usually disagrees with its receivable control account because an
                  unmatched receipt is dropped from it, and it disagrees <em>silently</em>. Here a
                  receipt not yet matched to a bill is its own <strong>unallocated</strong> row
                  carrying a negative figure, so the two agree — and both totals below were summed
                  in the database, per currency, with the comparison done there too. This check
                  ignores the filters on this page, because a reconciliation narrowed to one bucket
                  would always agree and would mean nothing.
                </span>
              </p>

              <p v-if="reconciliationBroken.length" class="ins-banner t-negative" role="alert">
                <AlertTriangle :size="16" aria-hidden="true" />
                <span>
                  The {{ reconciliationBroken.map((r) => r.currency).join(' and ') }} ageing does not
                  agree with its control account. Until that is explained, no figure on this page
                  should be used: a difference means either a receivable was posted outside the
                  control account or a receipt was allocated to something that is not a bill.
                </span>
              </p>

              <div class="fin-table-wrap">
                <table class="fin-table">
                  <caption class="sr-only">
                    The debtor ageing total against the receivable control account balance, per
                    currency. Each row is one book; no row combines them.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" class="ccy">Book</th>
                      <th scope="col">Receivable control account</th>
                      <th scope="col" class="num">Control balance</th>
                      <th scope="col" class="num">Ageing total</th>
                      <th scope="col" class="num">Difference</th>
                      <th scope="col">Agrees</th>
                      <th scope="col" class="num">Parties</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in reconciliation" :key="r.currency">
                      <td class="ccy">{{ r.currency }}</td>
                      <td>
                        <span v-if="r.control_codes" class="ins-mono st-code">{{ r.control_codes }}</span>
                        <small v-else class="st-sub undefined-value">
                          no receivable control account is classified
                        </small>
                        <br v-if="r.control_accounts > 1" />
                        <small v-if="r.control_accounts > 1" class="st-sub">
                          {{ r.control_accounts }} control accounts, taken together
                        </small>
                      </td>
                      <td class="num">{{ formatMoney(r.control_balance, r.currency, { bare: true }) }}</td>
                      <td class="num">{{ formatMoney(r.ageing_total, r.currency, { bare: true }) }}</td>
                      <td class="num emphasis" :class="{ 'st-contra': !r.agrees }">
                        {{ formatMoney(r.difference, r.currency, { bare: true }) }}
                      </td>
                      <td>
                        <span class="fin-pill" :class="r.agrees ? 'tone-positive' : 'tone-negative'">
                          {{ r.agrees ? 'yes' : 'no' }}
                        </span>
                      </td>
                      <td class="num">{{ partyCount(r.currency) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <!-- Per currency AND per bucket. No row adds the two currencies. -->
          <section class="ins-card" aria-labelledby="st-buckets-head">
            <div class="ins-card-head">
              <h2 id="st-buckets-head">Outstanding by age</h2>
              <span class="st-asat">per currency — never combined</span>
            </div>
            <div class="ins-card-body">
              <div v-for="currency in ageingCurrencies" :key="currency" class="st-section">
                <h3 class="st-section-head">{{ currency }} book</h3>
                <div class="fin-table-wrap">
                  <table class="fin-table">
                    <caption class="sr-only">
                      Outstanding receivables in the {{ currency }} book by age, as at
                      {{ formatDate(ageing.as_at) }}.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Age</th>
                        <th scope="col" class="num">Bills</th>
                        <th scope="col" class="num">Outstanding ({{ currency }})</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="bucket in bucketOrder" :key="bucket">
                        <td>
                          {{ bucketLabel(bucket) }}
                          <small v-if="bucket === 'unallocated'" class="st-sub">
                            — a receipt not yet matched to a bill; it carries a negative figure so
                            the ageing reconciles to the control account
                          </small>
                        </td>
                        <td class="num">{{ bucketTotal(currency, bucket)?.rows ?? 0 }}</td>
                        <td class="num" :class="{ 'st-contra': (bucketTotal(currency, bucket)?.outstanding_amount ?? '0').startsWith('-') }">
                          <template v-if="bucketTotal(currency, bucket)">
                            {{ formatMoney(bucketTotal(currency, bucket)!.outstanding_amount, currency, { bare: true }) }}
                          </template>
                          <span v-else class="st-nil">nil</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section class="ins-card" aria-labelledby="st-bills-head">
            <div class="ins-card-head">
              <h2 id="st-bills-head">Bills <span class="ins-count">{{ ageing.total }}</span></h2>
            </div>
            <div class="ins-card-body">
              <div class="fin-table-wrap">
                <table class="fin-table">
                  <thead>
                    <tr>
                      <th scope="col">Bill</th>
                      <th scope="col">Party</th>
                      <th scope="col">Dated</th>
                      <th scope="col" class="ccy">Ccy</th>
                      <th scope="col" class="num">Billed</th>
                      <th scope="col" class="num">Collected</th>
                      <th scope="col" class="num">Outstanding</th>
                      <th scope="col" class="num">Days</th>
                      <th scope="col">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="bill in ageing.bills" :key="`${bill.voucher_id}-${bill.ageing_bucket}`">
                      <td class="ins-mono">{{ bill.voucher_no }}</td>
                      <td>
                        <span :class="{ 'undefined-value': !bill.party_name }">
                          {{ bill.party_name ?? 'no party recorded' }}
                        </span>
                        <br v-if="bill.party_reference" />
                        <small v-if="bill.party_reference" class="st-sub ins-mono">
                          {{ bill.party_reference }}
                        </small>
                      </td>
                      <td>{{ formatDate(bill.posting_date) }}</td>
                      <td class="ccy">{{ bill.currency }}</td>
                      <td class="num">{{ formatMoney(bill.billed_amount, bill.currency, { bare: true }) }}</td>
                      <td class="num">{{ formatMoney(bill.settled_amount, bill.currency, { bare: true }) }}</td>
                      <td class="num emphasis" :class="{ 'st-contra': bill.outstanding_amount.startsWith('-') }">
                        {{ formatMoney(bill.outstanding_amount, bill.currency, { bare: true }) }}
                      </td>
                      <td class="num">{{ bill.days_outstanding }}</td>
                      <td><span class="fin-pill">{{ bill.ageing_bucket.replace(/_/g, '–') }}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="st-caption">
                <Info :size="14" aria-hidden="true" /><span>{{ ageing.note }}</span>
              </p>
            </div>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Own `st-` prefix. `finance.css` uses `.fin-map` for a grid definition list and `.ins-bar` for a
   progress meter, so nothing here is named for what it looks like. Every value is an --ent-* token;
   there is no colour literal in this file. */
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }

.st-preamble,
.st-caption {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.st-preamble {
  padding: var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong);
  background: var(--ent-surface-2);
  color: var(--ent-text);
  font-size: var(--ent-fs-sm);
}
.st-preamble :deep(svg), .st-caption :deep(svg) { flex: none; margin-top: 2px; }
.st-warn { color: var(--ent-text); }

/* ── The statement chooser: labelled tabs with their one-line purpose, not icon chips ─────── */
.st-tabs { display: flex; flex-wrap: wrap; gap: var(--ent-s2); }
.st-tab {
  flex: 1 1 11rem; text-align: left; cursor: pointer;
  padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line);
  border-bottom-width: 2px;
  background: var(--ent-surface);
  color: var(--ent-text-2);
  display: flex; flex-direction: column; gap: 2px;
}
.st-tab:hover { background: var(--ent-surface-2); }
.st-tab.is-current {
  border-bottom-color: var(--ent-accent);
  background: var(--ent-surface-2);
  color: var(--ent-text);
}
.st-tab-label { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.st-tab-hint { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.st-tab:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }

/* ── Two books, side by side where there is room ──────────────────────────────────────────── */
.st-books { display: grid; gap: var(--ent-s4); grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr)); }
.st-books.is-single { grid-template-columns: 1fr; }
.st-book { min-width: 0; }

.st-verdict {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold);
}
.st-verdict.is-ok { color: var(--ent-success); }
.st-verdict.is-off { color: var(--ent-danger); }

.st-section { margin-bottom: var(--ent-s4); }
.st-section:last-child { margin-bottom: 0; }
.st-section-head {
  margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-sm);
  font-weight: var(--ent-fw-semibold); color: var(--ent-text);
  display: flex; align-items: baseline; gap: var(--ent-s2);
}
.st-section-head small { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }
.st-section-empty { margin: 0; }

.st-code { font-size: var(--ent-fs-xs); }
.st-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.st-asat { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.st-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.st-filter { max-width: 14rem; }
.st-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.st-nil { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
/* A balance on the wrong side of its account. Shown as the negative it is, never flipped. */
.st-contra { color: var(--ent-danger); }
.st-recon-note { display: block; }

.st-total-row th, .st-total-row td {
  border-top: 2px solid var(--ent-line-strong);
  font-weight: var(--ent-fw-semibold);
}

/* What the position statement does NOT contain. Deliberately the loudest thing on the page: a
   reader must not be able to take it for a complete balance sheet. */
.st-incomplete {
  padding: var(--ent-s3);
  border: 1px solid var(--ent-tone-negative-line);
  border-left-width: 3px;
  background: var(--ent-tone-negative-bg);
  color: var(--ent-tone-negative-fg);
}
.st-incomplete-head {
  margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold);
  display: flex; align-items: center; gap: var(--ent-s2);
}
.st-incomplete ul { margin: 0 0 var(--ent-s2); padding-left: var(--ent-s4); font-size: var(--ent-fs-xs); }
.st-incomplete li { margin-bottom: 4px; }
.st-incomplete p { margin: 0; font-size: var(--ent-fs-xs); }

.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .ins-spin { animation: none; }
}
</style>
