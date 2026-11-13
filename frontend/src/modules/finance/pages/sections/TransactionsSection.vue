<script setup lang="ts">
/**
 * The staff transaction register (audit GAP-1).
 *
 * `finance.transaction.view` has been a granted permission since migration 188 with no screen
 * behind it, while the public portal could page through published transactions. So a ratepayer
 * could browse the register and the council's own Director of Finance could not. This is that
 * screen.
 *
 * THREE THINGS THIS SURFACE REFUSES TO DO
 *
 * 1. IT NEVER SHOWS A COMBINED TOTAL. The endpoint returns one total per currency AND per account
 *    kind and this screen renders them that way, each labelled with its own currency and side.
 *    The council has approved no conversion basis (decision D4), so a figure spanning USD and ZWG
 *    would be invented. There is no "grand total" control to add, and `formatMoney` is only ever
 *    called with the row's own currency.
 *
 * 2. IT NEVER SHOWS A TOTAL WITHOUT SAYING WHAT PRODUCED IT. Two sentences travel with the
 *    figures: that they cover the whole filtered set rather than the page below, and which
 *    reversal mode built them. A correction in this system is a reversal plus a replacement, both
 *    of which stay in the register, so the same filter yields a different row count under each
 *    mode — and a reader who does not know which mode is on cannot interpret the number. The mode
 *    is stated in words next to the figures, not only in the dropdown that set it.
 *
 * 3. IT NEVER RENDERS A BLANK SUPPLIER. Counterparty identity needs
 *    `finance.transaction.view_counterparty`, and the endpoint leaves those columns out of the
 *    response rather than nulling them (decision A2). When `counterparty_visible` is false this
 *    screen removes the column and says, in a sentence, that the identity is withheld and which
 *    permission carries it. An empty cell would be read as "no supplier was recorded", which is a
 *    different and false statement.
 *
 * NULL IS NOT ZERO. A missing description, reference, record type or ward renders as "not
 *    recorded", never as a blank or a nil (the D12 rule generalised).
 *
 * THE SCREEN EXPLAINS; THE SERVER DECIDES. `store.can()` governs what is offered, and the endpoint
 * re-checks the permission, the department scope and the counterparty gate on every request.
 */
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle, ChevronDown, ChevronRight, FileText, Info, Receipt, RefreshCw, ShieldOff, Undo2, X,
} from 'lucide-vue-next'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import { formatBytes, formatDate, formatDateTime, formatMoney } from '../../composables/useMoney'
import WardPicker from '../../components/WardPicker.vue'
import type {
  ReversalMode, TransactionDetail, TransactionQuery, TransactionRegisterPage,
} from '../../models/types'

const store = useFinanceStore()

const page = ref<TransactionRegisterPage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const detail = ref<TransactionDetail | null>(null)
const openId = ref<string | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

/**
 * The filters, minus the year, which belongs to the workspace and not to this screen.
 *
 * `reversals` opens on `exclude` — the live register, each transaction that still stands counted
 * once — because it is the only mode whose rows and whose total agree with each other without the
 * reader doing arithmetic.
 */
const filters = ref<Omit<TransactionQuery, 'financial_year_id'>>({
  reversals: 'exclude', limit: 50, offset: 0, sort: 'txn_date', direction: 'desc',
})

const yearId = computed(() => store.selectedYearId)
const canView = computed(() => store.can('finance.transaction.view'))

/**
 * What each reversal mode means, in the words shown beside the totals.
 *
 * The mode read here is the one the RESPONSE echoed, not the one in the dropdown: while a request
 * is in flight the two differ, and a figure must never be captioned with a mode that did not
 * produce it.
 */
const REVERSAL_WORDS: Record<ReversalMode, string> = {
  exclude: 'Reversed transactions and the reversals that cancelled them are both left out, so each '
    + 'transaction that still stands is counted once. A correction nets to nil, so this total is '
    + 'the same figure as “every transaction” over fewer rows.',
  only: 'Only corrections are shown — each reversal and the transaction it reverses. A matched set '
    + 'of corrections totals nil; any other figure here is a reversal that does not match what it '
    + 'reverses, which is a fault to investigate rather than a total to publish.',
  all: 'Every transaction is shown, including both halves of every correction. This total counts a '
    + 'corrected amount and its cancellation, which is what the source accounting system holds.',
}

const REVERSAL_LABELS: Record<ReversalMode, string> = {
  exclude: 'Live register (corrections removed)',
  only: 'Corrections only',
  all: 'Every transaction',
}

const SORT_LABELS: Record<NonNullable<TransactionQuery['sort']>, string> = {
  txn_date: 'Date',
  amount: 'Amount',
  account_code: 'Account code',
  department_code: 'Department code',
}

/** The mode the figures on screen were actually built from. */
const appliedMode = computed<ReversalMode | null>(() => page.value?.reversals ?? null)

const transactions = computed(() => page.value?.transactions ?? [])
const totals = computed(() => page.value?.totals ?? [])
const counterpartyVisible = computed(() => page.value?.counterparty_visible === true)

/** Which votes the response was confined to, as names rather than ids. Null means not confined. */
const scopeNames = computed<string[] | null>(() => {
  const applied = page.value?.scope_applied
  if (!applied || applied.length === 0) return null
  return applied.map((id) => {
    const d = store.departmentById.get(id)
    return d ? `${d.code} ${d.name}` : id
  })
})

const pageCount = computed(() => {
  const limit = filters.value.limit ?? 50
  return Math.max(1, Math.ceil((page.value?.total ?? 0) / limit))
})
const pageNumber = computed(() =>
  Math.floor((filters.value.offset ?? 0) / (filters.value.limit ?? 50)) + 1)

/** Columns in the table, so an expanded row's cell can span all of them. */
const columnCount = computed(() => (counterpartyVisible.value ? 8 : 7))

/** A value that was not recorded is said to be absent, never shown as a blank or a zero. */
const orAbsent = (value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? 'not recorded' : value

const isAbsent = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value === ''

async function load(): Promise<void> {
  if (!yearId.value || !canView.value) { page.value = null; return }
  loading.value = true
  error.value = null
  try {
    page.value = await financeApi.transactions({
      ...filters.value, financial_year_id: yearId.value,
    })
  } catch (err) {
    page.value = null
    error.value = messageOf(err, 'The transaction register could not be read.')
  } finally {
    loading.value = false
  }
}

/** A filter change returns to the first page: page 4 of a different question is a trap. */
function refilter(): void {
  filters.value.offset = 0
  closeDetail()
  void load()
}

function turnPage(delta: number): void {
  const limit = filters.value.limit ?? 50
  filters.value.offset = Math.max(0, (filters.value.offset ?? 0) + delta * limit)
  closeDetail()
  void load()
}

function closeDetail(): void {
  openId.value = null
  detail.value = null
  detailError.value = null
}

async function toggleDetail(id: string): Promise<void> {
  if (openId.value === id) { closeDetail(); return }
  openId.value = id
  detail.value = null
  detailError.value = null
  detailLoading.value = true
  try {
    detail.value = await financeApi.transaction(id)
  } catch (err) {
    detailError.value = messageOf(err, 'That transaction could not be read.')
  } finally {
    detailLoading.value = false
  }
}

const wardFilter = computed<string>({
  get: () => filters.value.ward_code ?? '',
  set: (value: string) => {
    const code = value.trim()
    filters.value.ward_code = code || undefined
    refilter()
  },
})

/** The class filter follows the side: a revenue class on an expenditure filter means nothing. */
watch(() => filters.value.kind, (kind) => {
  if (kind !== 'expenditure') filters.value.expenditure_class = undefined
  if (kind !== 'revenue') filters.value.revenue_class = undefined
})

watch([yearId, canView], load, { immediate: true })

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(() => filters.value.q, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(refilter, 300)
})
</script>

<template>
  <div class="fin-section">
    <div v-if="!canView" class="fin-empty">
      <strong>The transaction register is not open to your role.</strong>
      <p>
        Browsing the register needs <code>finance.transaction.view</code>, which the Director of
        Finance, finance officers, the finance committee and the auditor hold.
        {{ store.whyUnavailable('finance.transaction.view') }}
      </p>
    </div>

    <template v-else>
      <p v-if="error" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
      </p>

      <!-- ── Filters ───────────────────────────────────────────────────────────────────────── -->
      <div class="fin-bar">
        <label class="ins-search">
          <span class="sr-only">Search description or voucher reference</span>
          <input v-model="filters.q" class="ins-input" type="search"
                 placeholder="Search description or reference" />
        </label>
        <select v-model="filters.department_id" class="ins-input txn-filter"
                aria-label="Department (vote)" @change="refilter">
          <option :value="undefined">All departments</option>
          <option v-for="d in store.departments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
        </select>
        <select v-model="filters.account_id" class="ins-input txn-filter"
                aria-label="Account" @change="refilter">
          <option :value="undefined">All accounts</option>
          <option v-for="a in store.postableAccounts" :key="a.id" :value="a.id">
            {{ a.code }} — {{ a.name }}
          </option>
        </select>
        <select v-model="filters.programme_id" class="ins-input txn-filter"
                aria-label="Programme" @change="refilter">
          <option :value="undefined">All programmes</option>
          <option v-for="p in store.programmes" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
        </select>
        <select v-model="filters.kind" class="ins-input txn-filter"
                aria-label="Revenue or expenditure" @change="refilter">
          <option :value="undefined">Revenue and expenditure</option>
          <option value="revenue">Revenue only</option>
          <option value="expenditure">Expenditure only</option>
        </select>
        <select v-if="filters.kind === 'expenditure'" v-model="filters.expenditure_class"
                class="ins-input txn-filter" aria-label="Capital or recurrent" @change="refilter">
          <option :value="undefined">Capital and recurrent</option>
          <option value="recurrent">Recurrent</option>
          <option value="capital">Capital</option>
        </select>
        <select v-if="filters.kind === 'revenue'" v-model="filters.revenue_class"
                class="ins-input txn-filter" aria-label="Revenue class" @change="refilter">
          <option :value="undefined">Every revenue class</option>
          <option value="internally_generated">Internally generated</option>
          <option value="grant">Grant</option>
          <option value="transfer">Transfer</option>
          <option value="other">Other</option>
        </select>
        <select v-model="filters.currency" class="ins-input txn-filter"
                aria-label="Currency" @change="refilter">
          <option :value="undefined">Both currencies</option>
          <option value="USD">USD only</option>
          <option value="ZWG">ZWG only</option>
        </select>
        <div class="txn-filter txn-filter-ward">
          <WardPicker id="txn-ward-filter" v-model="wardFilter" compact empty-label="Every ward" />
        </div>
        <label class="ins-field txn-date">
          <span class="ins-label">From</span>
          <input v-model="filters.from" class="ins-input" type="date" @change="refilter" />
        </label>
        <label class="ins-field txn-date">
          <span class="ins-label">To</span>
          <input v-model="filters.to" class="ins-input" type="date" @change="refilter" />
        </label>
        <label class="ins-field txn-filter">
          <span class="ins-label">Corrections</span>
          <select v-model="filters.reversals" class="ins-input" @change="refilter">
            <option v-for="(label, mode) in REVERSAL_LABELS" :key="mode" :value="mode">{{ label }}</option>
          </select>
        </label>
        <label class="ins-field txn-filter">
          <span class="ins-label">Order by</span>
          <select v-model="filters.sort" class="ins-input" @change="refilter">
            <option v-for="(label, key) in SORT_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <button type="button" class="fin-btn small" :disabled="loading" @click="load">
          <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
        </button>
      </div>

      <!-- ── What the figures below cover ──────────────────────────────────────────────────── -->
      <section v-if="page && totals.length > 0" class="ins-card" aria-labelledby="txn-totals-head">
        <div class="ins-card-head">
          <h3 id="txn-totals-head">
            Totals for the filtered set <span class="ins-count">{{ page.total }}</span>
          </h3>
          <span class="txn-asat">
            {{ store.selectedYear?.label ?? 'the selected year' }}
          </span>
        </div>
        <div class="ins-card-body">
          <p class="txn-caption">
            <Info :size="14" aria-hidden="true" />
            <span>
              These figures cover <strong>all {{ page.total }} transactions matching the filters
              above</strong>, not the {{ transactions.length }} shown in the table below. One figure
              per currency and per side: revenue is not netted against expenditure and USD is not
              added to ZWG, because the Council has approved no conversion basis.
            </span>
          </p>
          <p v-if="appliedMode" class="txn-caption txn-mode" data-test="reversal-mode">
            <Undo2 :size="14" aria-hidden="true" />
            <span>
              Corrections: <strong>{{ REVERSAL_LABELS[appliedMode] }}</strong>.
              {{ REVERSAL_WORDS[appliedMode] }}
            </span>
          </p>

          <dl class="txn-totals">
            <div v-for="t in totals" :key="`${t.currency}-${t.account_kind}`" class="txn-total">
              <dt>
                {{ t.currency }} · {{ t.account_kind === 'revenue' ? 'Revenue' : 'Expenditure' }}
              </dt>
              <dd>
                <span class="txn-total-figure">{{ formatMoney(t.amount, t.currency) }}</span>
                <span class="txn-total-note">
                  {{ t.rows }} transaction{{ t.rows === 1 ? '' : 's' }} · {{ t.currency }} only
                </span>
              </dd>
            </div>
          </dl>

          <p v-if="scopeNames" class="txn-caption txn-scope" role="note">
            <ShieldOff :size="14" aria-hidden="true" />
            <span>
              Confined to your own votes: {{ scopeNames.join(', ') }}. These are not council-wide
              figures.
            </span>
          </p>

          <p v-if="!counterpartyVisible" class="txn-caption txn-withheld" data-test="counterparty-absent">
            <ShieldOff :size="14" aria-hidden="true" />
            <span>
              Supplier and beneficiary identity is not shown on this register, because that needs
              the <code>finance.transaction.view_counterparty</code> permission, which your role
              does not hold. The columns are <strong>absent from the record you were sent</strong>,
              not empty — so nothing below should be read as “no supplier was recorded”.
            </span>
          </p>
        </div>
      </section>

      <!-- ── The register ──────────────────────────────────────────────────────────────────── -->
      <p v-if="loading && !page" class="txn-loading" role="status">Reading the transaction register…</p>

      <div v-else-if="!yearId" class="fin-empty">
        <strong>No financial year is selected.</strong>
        <p>Choose a reporting period above to read its register.</p>
      </div>

      <div v-else-if="page && transactions.length === 0" class="fin-empty">
        <strong>No transaction matches these filters.</strong>
        <p>
          Transactions reach this register through a committed import batch under Data imports —
          nothing can be keyed in here, because a register an officer can type into is not a
          register.
          <template v-if="filters.reversals === 'only'">
            The filter is set to corrections only, and this period may simply have none.
          </template>
          <template v-else-if="filters.reversals === 'exclude'">
            Corrections are currently left out; choose “Every transaction” to see reversed rows too.
          </template>
        </p>
      </div>

      <section v-else-if="page" class="ins-card">
        <div class="ins-card-head">
          <h3><Receipt :size="15" aria-hidden="true" /> Transactions</h3>
          <span class="txn-asat">
            Showing {{ (filters.offset ?? 0) + 1 }}–{{ (filters.offset ?? 0) + transactions.length }}
            of {{ page.total }}
          </span>
        </div>
        <div class="ins-card-body">
          <div class="fin-table-wrap">
            <table class="fin-table">
              <caption class="sr-only">
                Transactions for {{ store.selectedYear?.label ?? 'the selected year' }}.
                <template v-if="appliedMode">{{ REVERSAL_LABELS[appliedMode] }}.</template>
                Amounts are shown in their own currency and are never added across currencies.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Department / account</th>
                  <th scope="col">Description &amp; reference</th>
                  <th v-if="counterpartyVisible" scope="col">Counterparty</th>
                  <th scope="col" class="num">Amount</th>
                  <th scope="col" class="ccy">Ccy</th>
                  <th scope="col">Source</th>
                  <th scope="col"><span class="sr-only">Detail</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="t in transactions" :key="t.id">
                  <tr :class="{ 'txn-open': openId === t.id }">
                    <td class="ins-mono">{{ formatDate(t.txn_date) }}</td>
                    <td>
                      {{ t.department_name ?? t.department_code ?? 'not recorded' }}<br />
                      <small class="txn-sub">
                        {{ t.account_code }} {{ t.account_name }} · {{ t.account_kind }}
                      </small>
                    </td>
                    <td>
                      <span :class="{ 'undefined-value': isAbsent(t.description) }">
                        {{ orAbsent(t.description) }}
                      </span><br />
                      <small class="txn-sub ins-mono" :class="{ 'undefined-value': isAbsent(t.reference) }">
                        {{ orAbsent(t.reference) }}
                      </small>
                    </td>
                    <td v-if="counterpartyVisible">
                      <span :class="{ 'undefined-value': isAbsent(t.counterparty_name) }">
                        {{ orAbsent(t.counterparty_name) }}
                      </span>
                      <br v-if="t.counterparty_ref" />
                      <small v-if="t.counterparty_ref" class="txn-sub ins-mono">{{ t.counterparty_ref }}</small>
                    </td>
                    <!-- The row's own currency, always. There is no column that mixes them. -->
                    <td class="num emphasis">{{ formatMoney(t.amount, t.currency, { bare: true }) }}</td>
                    <td class="ccy">{{ t.currency }}</td>
                    <td>
                      <small class="txn-sub">{{ orAbsent(t.source_system) }}</small><br />
                      <small class="txn-sub ins-mono">{{ orAbsent(t.source_ref) }}</small>
                    </td>
                    <td>
                      <button type="button" class="fin-btn small" :aria-expanded="openId === t.id"
                              :aria-controls="`txn-detail-${t.id}`" @click="toggleDetail(t.id)">
                        <component :is="openId === t.id ? ChevronDown : ChevronRight" :size="12"
                                   aria-hidden="true" />
                        <span class="sr-only">
                          Detail for {{ orAbsent(t.reference) }} on {{ formatDate(t.txn_date) }}
                        </span>
                        <span aria-hidden="true">Detail</span>
                      </button>
                    </td>
                  </tr>

                  <!-- ── One transaction, expanded in place ───────────────────────────────── -->
                  <tr v-if="openId === t.id" :id="`txn-detail-${t.id}`" class="txn-detail-row">
                    <td :colspan="columnCount">
                      <p v-if="detailLoading" class="txn-loading" role="status">Reading the transaction…</p>
                      <p v-else-if="detailError" class="ins-banner t-negative" role="alert">
                        <AlertTriangle :size="14" aria-hidden="true" /><span>{{ detailError }}</span>
                      </p>
                      <div v-else-if="detail" class="txn-detail">
                        <div class="txn-detail-head">
                          <h4>
                            {{ orAbsent(detail.transaction.reference) }} ·
                            {{ formatMoney(detail.transaction.amount, detail.transaction.currency) }}
                          </h4>
                          <button type="button" class="ins-iconbtn" @click="closeDetail">
                            <X :size="14" aria-hidden="true" /><span class="sr-only">Close detail</span>
                          </button>
                        </div>

                        <!-- The reversal pair: both directions, because either end answers a
                             different question a director asks. -->
                        <h5 class="txn-detail-sub">Corrections</h5>
                        <ul v-if="detail.reversal.reverses || detail.reversal.reversed_by" class="txn-notes">
                          <li v-if="detail.reversal.reverses">
                            <Undo2 :size="13" aria-hidden="true" />
                            <span>
                              This row <strong>is a reversal</strong>. It cancels
                              {{ orAbsent(detail.reversal.reverses.reference) }} of
                              {{ formatMoney(detail.reversal.reverses.amount, detail.transaction.currency) }}
                              dated {{ formatDate(detail.reversal.reverses.txn_date) }}. The pair
                              nets to nil, so the live register omits both.
                            </span>
                          </li>
                          <li v-if="detail.reversal.reversed_by">
                            <Undo2 :size="13" aria-hidden="true" />
                            <span>
                              This row <strong>was reversed</strong> by
                              {{ orAbsent(detail.reversal.reversed_by.reference) }} of
                              {{ formatMoney(detail.reversal.reversed_by.amount, detail.transaction.currency) }}
                              dated {{ formatDate(detail.reversal.reversed_by.txn_date) }}. It no
                              longer stands; look for the replacement posting.
                            </span>
                          </li>
                        </ul>
                        <p v-else class="txn-sub">
                          Not reversed, and not itself a reversal. This figure stands as posted.
                        </p>

                        <!-- Provenance. Without the filename and the hash an amount is an
                             assertion; with them it can be traced back to a file that can be
                             re-read. -->
                        <h5 class="txn-detail-sub">Where this figure came from</h5>
                        <dl v-if="detail.import_batch" class="fin-figures txn-provenance">
                          <div class="fin-figure">
                            <dt>Source file</dt>
                            <dd>{{ detail.import_batch.original_filename }}
                              <span class="fin-figure-note">{{ detail.import_batch.dataset }} dataset</span></dd>
                          </div>
                          <div class="fin-figure">
                            <dt>File hash (SHA-256)</dt>
                            <dd><span class="ins-mono txn-hash">{{ detail.import_batch.file_hash }}</span>
                              <span class="fin-figure-note">the preserved upload this figure was read from</span></dd>
                          </div>
                          <div class="fin-figure">
                            <dt>Committed</dt>
                            <dd :class="{ 'undefined-value': !detail.import_batch.committed_at }">
                              {{ detail.import_batch.committed_at
                                ? formatDateTime(detail.import_batch.committed_at) : 'not recorded' }}</dd>
                          </div>
                          <div class="fin-figure">
                            <dt>Reconciliation</dt>
                            <dd>{{ detail.import_batch.reconciliation_status.replace(/_/g, ' ') }}
                              <span class="fin-figure-note">against the control totals the council declared</span></dd>
                          </div>
                        </dl>
                        <p v-else class="txn-sub">
                          No import batch is recorded against this transaction, so its source file
                          and hash cannot be shown. The source system reference is
                          {{ orAbsent(detail.transaction.source_ref) }}.
                        </p>

                        <h5 class="txn-detail-sub">Against</h5>
                        <dl class="fin-figures">
                          <div class="fin-figure">
                            <dt>Budget line</dt>
                            <dd v-if="detail.budget_line">
                              {{ detail.budget_line.code }}
                              <span class="fin-figure-note">
                                {{ detail.budget_line.description }} · revised
                                {{ formatMoney(detail.budget_line.revised_amount, detail.budget_line.currency) }},
                                actual
                                {{ formatMoney(detail.budget_line.actual_amount, detail.budget_line.currency) }}
                              </span>
                            </dd>
                            <dd v-else class="undefined-value">not recorded</dd>
                          </div>
                          <div class="fin-figure">
                            <dt>Project</dt>
                            <dd v-if="detail.project">
                              {{ detail.project.reference }}
                              <span class="fin-figure-note">{{ detail.project.name }}</span>
                            </dd>
                            <dd v-else class="undefined-value">not linked to a project</dd>
                          </div>
                          <div class="fin-figure">
                            <dt>Record type</dt>
                            <dd :class="{ 'undefined-value': isAbsent(detail.transaction.record_type) }">
                              {{ orAbsent(detail.transaction.record_type) }}</dd>
                          </div>
                        </dl>

                        <h5 class="txn-detail-sub">
                          Documents <span class="ins-count">{{ detail.documents.length }}</span>
                        </h5>
                        <p v-if="detail.documents.length === 0" class="txn-sub">
                          No voucher, invoice or receipt is attached to this transaction.
                        </p>
                        <ul v-else class="txn-notes">
                          <li v-for="doc in detail.documents" :key="doc.id">
                            <FileText :size="13" aria-hidden="true" />
                            <span>
                              {{ doc.filename }}
                              <small class="txn-sub">
                                {{ doc.document_type ?? 'untyped' }} · {{ formatBytes(doc.size_bytes) }}
                                · {{ doc.visibility }} · attached
                                {{ formatDateTime(doc.uploaded_at) }}
                                <template v-if="doc.uploaded_by_name">by {{ doc.uploaded_by_name }}</template>
                              </small>
                            </span>
                          </li>
                        </ul>

                        <p v-if="!detail.counterparty_visible" class="txn-caption txn-withheld">
                          <ShieldOff :size="13" aria-hidden="true" />
                          <span>
                            Supplier and beneficiary identity is withheld here too: it needs
                            <code>finance.transaction.view_counterparty</code>. The fields are
                            absent from this record rather than empty.
                          </span>
                        </p>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-if="pageCount > 1" class="txn-pager">
            <button type="button" class="fin-btn small" :disabled="(filters.offset ?? 0) === 0"
                    @click="turnPage(-1)">Previous</button>
            <span>Page {{ pageNumber }} of {{ pageCount }}</span>
            <button type="button" class="fin-btn small" :disabled="pageNumber >= pageCount"
                    @click="turnPage(1)">Next</button>
          </div>

          <p class="txn-caption">
            <Info :size="14" aria-hidden="true" />
            <span>
              Nothing on this screen writes. A transaction reaches the register through a committed
              import batch, with its source file and hash preserved; a correction is a reversal plus
              a replacement, never an edit to a posted row.
            </span>
          </p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* Own prefix throughout: `fin-map` in finance.css is a definition list and `ins-bar` is a progress
   meter, so a container named for what it looks like would inherit someone else's layout. */
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.txn-filter { max-width: 14rem; }
.txn-filter-ward { max-width: 18rem; }
.txn-date { max-width: 10rem; }
.txn-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.txn-asat { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.txn-loading { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.txn-caption {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  margin: 0 0 var(--ent-s3); font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}
.txn-caption :deep(svg) { flex: none; margin-top: 2px; }
.txn-mode { color: var(--ent-text); }
.txn-withheld, .txn-scope {
  padding: var(--ent-s2) var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong);
  background: var(--ent-surface-2);
  margin-bottom: 0;
}

/* One tile per currency AND kind. There is deliberately no tile that spans them. */
.txn-totals {
  display: grid; gap: var(--ent-s3); margin: 0 0 var(--ent-s3);
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}
.txn-total {
  padding: var(--ent-s3);
  border: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
}
.txn-total dt {
  font-size: var(--ent-fs-micro); text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ent-text-3);
}
.txn-total dd { margin: 4px 0 0; display: flex; flex-direction: column; gap: 2px; }
.txn-total-figure {
  font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-semibold);
  font-variant-numeric: tabular-nums; color: var(--ent-text);
}
.txn-total-note { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

.txn-open > td { background: var(--ent-surface-2); }
.txn-detail-row > td { background: var(--ent-surface-2); padding: var(--ent-s3); }
.txn-detail { display: flex; flex-direction: column; gap: var(--ent-s2); }
.txn-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ent-s3); }
.txn-detail-head h4 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }
.txn-detail-sub {
  margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.txn-provenance { margin-bottom: 0; }
/* A 64-character hash must wrap rather than widen the table past the viewport. */
.txn-hash { word-break: break-all; font-size: var(--ent-fs-micro); }

.txn-notes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--ent-s2); }
.txn-notes li {
  display: flex; align-items: flex-start; gap: var(--ent-s2);
  font-size: var(--ent-fs-xs); color: var(--ent-text);
}
.txn-notes li :deep(svg) { flex: none; margin-top: 2px; }

.txn-pager {
  display: flex; align-items: center; justify-content: center; gap: var(--ent-s3);
  margin: var(--ent-s3) 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2);
}

.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}

/* The spinner on Refresh is decoration; a reader who has asked for less motion gets the label and
   the disabled state, which carry the same information. */
@media (prefers-reduced-motion: reduce) {
  .ins-spin { animation: none; }
}
</style>
