<script setup lang="ts">
/**
 * Reports and exports.
 *
 * EVERY REPORT CARRIES ITS PROVENANCE. The specification requires the council identity, the
 * reporting period, the generation time, the currency treatment and the applied filters on any
 * report (§3.9), and an exported file that does not say what it covers will be quoted out of
 * context sooner or later. The metadata block is shown on screen and written into the file.
 *
 * NO REPORT COMBINES CURRENCIES. Each one carries a currency column and groups by it; where a
 * total would otherwise span USD and ZWG, there is no total. The catalogue states the policy and
 * the exported file repeats it.
 *
 * EXPORTING SUPPLIER IDENTITY IS A SEPARATE PERMISSION, and the file that contains it is named
 * RESTRICTED. A finance officer can export a transaction register; including who was paid needs
 * the restricted-export permission on top, which is §2.3's "explicit permission for exports
 * containing restricted data" made literal.
 *
 * THE CONTROLS ARE DRIVEN BY THE CATALOGUE, NOT BY A LIST HELD HERE (workstream W2)
 *
 * `GET /api/finance/reports` says what each report is (`description`) and which periodicities it
 * can be produced at (`periods`). This screen renders a periodicity control ONLY for a report
 * whose entry declares one. A control offered on a report with no period dimension would be worse
 * than missing: an officer would set it, see figures that did not change, and reasonably conclude
 * the figures were monthly when they were annual.
 *
 * For the same reason the dimensional filters are sent ONLY to a report that applies them. The
 * report's own cover prints "Filters applied" from the request, so sending a filter a report
 * ignores would put a line on an exported file claiming a narrowing that never happened.
 * WHICH FILTERS A REPORT TAKES IS THE BACKEND'S ANSWER, not this screen's. The catalogue publishes
 * `accepts` per report from `REPORT_FILTERS` in src/routes/finance-reports.js, the same file whose
 * `buildReport()` honours it, so a filter added to a report there is offered here without this file
 * being touched.
 *
 * WIDE TABLES. A monthly management account is twelve period columns plus eight others. The table
 * scrolls horizontally inside its own region, with the ward or vote column pinned, so a phone can
 * read it; nothing above or below the table scrolls with it, so the provenance block and the
 * RESTRICTED warning stay where they are.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import type { ReportRunParams } from '../../api/financeApi'
import { formatMoney, formatDate } from '../../composables/useMoney'
import type {
  AccountKind, Currency, Periodicity, ReportDefinition, ReportResult,
} from '../../models/types'
import { AlertTriangle, CheckCircle2, Download, PlayCircle, Info, FileSpreadsheet, FileText, EyeOff, CalendarRange } from 'lucide-vue-next'

const store = useFinanceStore()

type ReportFilter =
  | 'department_id' | 'account_id' | 'programme_id' | 'ward_code'
  | 'kind' | 'expenditure_class' | 'currency' | 'dates'

/** How a periodicity is written for a reader. The API's own values are snake_case. */
const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
}

const CURRENCIES: Currency[] = ['USD', 'ZWG']

const catalogue = ref<ReportDefinition[]>([])
const currencyPolicy = ref('')
const canExportRestricted = ref(false)
const chosen = ref<string>('budget_vs_actual')
const departmentId = ref('')
const compareYearId = ref('')
const from = ref('')
const to = ref('')
const includeRestricted = ref(false)

// W2 controls.
const periodicity = ref<Periodicity>('monthly')
const accumulated = ref(false)
const accountId = ref('')
const programmeId = ref('')
const wardCode = ref('')
const kind = ref<AccountKind | ''>('')
const expenditureClass = ref<'recurrent' | 'capital' | ''>('')
const currency = ref<Currency | ''>('')

const result = ref<ReportResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)

const yearId = computed(() => store.selectedYearId)
const canExport = computed(() => store.can('finance.report.export'))
const definition = computed(() => catalogue.value.find((r) => r.id === chosen.value) ?? null)
const needsYear = computed(() => definition.value?.requires.includes('financial_year_id') ?? true)
const needsCompareYear = computed(() => definition.value?.requires.includes('compare_financial_year_id') ?? false)
const comparisonYearOptions = computed(() => store.years.filter((y) => y.id !== yearId.value))

/**
 * The periodicities this report declares. Empty means the report has no period dimension, and no
 * periodicity control is rendered for it at all.
 */
const periodOptions = computed<Periodicity[]>(() => definition.value?.periods ?? [])
const hasPeriods = computed(() => periodOptions.value.length > 0)

/**
 * A report offering exactly one periodicity is a fixed-form return: the Ministry's quarterly
 * return is quarterly and cumulative by construction. There is nothing to choose, so the
 * periodicity is STATED rather than offered, and the discrete-or-cumulative form is left to the
 * report to declare on its cover — this screen does not assert which it is.
 */
const periodicityIsFixed = computed(() => periodOptions.value.length === 1)

/**
 * Does the chosen report apply this filter?
 *
 * The answer comes from the catalogue's `accepts`, served by `REPORT_FILTERS` in the backend's
 * finance-reports.js — the file whose `buildReport()` honours it. This screen holds no copy of
 * that table on purpose: it did until 2026-11-10, and the two could drift apart silently.
 * A report not yet in the catalogue, or a catalogue that has not loaded, accepts nothing.
 */
const accepts = (filter: ReportFilter): boolean =>
  (definition.value?.accepts ?? []).includes(filter)

const accountOptions = computed(() => store.accounts
  .filter((a) => (kind.value ? a.kind === kind.value : true))
  .slice()
  .sort((a, b) => a.code.localeCompare(b.code)))

const programmeOptions = computed(() => store.programmes
  .filter((p) => (departmentId.value ? p.department_id === departmentId.value : true)))

/**
 * Changing the report resets every control the new report does not apply.
 *
 * Without this, choosing "Capital and recurrent expenditure" with a revenue filter left over from
 * another report would send a parameter the new report ignores — and the export's "Filters
 * applied" line would then claim a narrowing the figures never had.
 */
watch(chosen, () => {
  result.value = null
  note.value = null
  error.value = null
  if (!accepts('account_id')) accountId.value = ''
  if (!accepts('programme_id')) programmeId.value = ''
  if (!accepts('ward_code')) wardCode.value = ''
  if (!accepts('kind')) kind.value = ''
  if (!accepts('expenditure_class')) expenditureClass.value = ''
  if (!accepts('currency')) currency.value = ''
  if (!accepts('department_id')) departmentId.value = ''
  if (!accepts('dates')) { from.value = ''; to.value = '' }
  if (!hasPeriods.value) accumulated.value = false
  // Keep the periodicity inside what the report offers rather than sending one it would refuse.
  if (hasPeriods.value && !periodOptions.value.includes(periodicity.value)) {
    periodicity.value = periodOptions.value[0]
  }
})

/** An account filter is only meaningful among accounts of the chosen kind. */
watch(kind, () => {
  if (accountId.value && !accountOptions.value.some((a) => a.id === accountId.value)) {
    accountId.value = ''
  }
})

onMounted(async () => {
  try {
    const c = await financeApi.reportCatalogue()
    catalogue.value = c.reports
    currencyPolicy.value = c.currency_policy
    canExportRestricted.value = c.can_export_restricted
  } catch (err) {
    error.value = messageOf(err, 'The report catalogue could not be read.')
  }
})

/**
 * One parameter set for the screen and for the file, so a downloaded report and the report it was
 * downloaded from cannot have been asked different questions. This mirrors the backend building
 * both from one `buildReport()`.
 */
function requestParams(): ReportRunParams {
  return {
    report: chosen.value,
    financial_year_id: needsYear.value ? (yearId.value ?? undefined) : undefined,
    compare_financial_year_id: needsCompareYear.value ? (compareYearId.value || undefined) : undefined,
    periodicity: hasPeriods.value ? periodicity.value : undefined,
    accumulated: hasPeriods.value && !periodicityIsFixed.value && accumulated.value ? true : undefined,
    department_id: accepts('department_id') ? (departmentId.value || undefined) : undefined,
    account_id: accepts('account_id') ? (accountId.value || undefined) : undefined,
    programme_id: accepts('programme_id') ? (programmeId.value || undefined) : undefined,
    ward_code: accepts('ward_code') ? (wardCode.value.trim() || undefined) : undefined,
    kind: accepts('kind') ? (kind.value || undefined) : undefined,
    expenditure_class: accepts('expenditure_class') ? (expenditureClass.value || undefined) : undefined,
    currency: accepts('currency') ? (currency.value || undefined) : undefined,
    from: accepts('dates') ? (from.value || undefined) : undefined,
    to: accepts('dates') ? (to.value || undefined) : undefined,
    include_restricted: includeRestricted.value || undefined,
  }
}

/** The checks the server also makes, made here so an officer gets a sentence rather than a 400. */
function refusal(): string | null {
  if (needsYear.value && !yearId.value) return 'This report needs a financial year.'
  if (needsCompareYear.value && !compareYearId.value) return 'This report needs a comparison year.'
  return null
}

async function run(): Promise<void> {
  error.value = null; note.value = null
  const stop = refusal()
  if (stop) { error.value = stop; return }
  loading.value = true
  try {
    result.value = await financeApi.runReport(requestParams())
  } catch (err) {
    error.value = messageOf(err, 'The report could not be built.')
    result.value = null
  } finally { loading.value = false }
}

async function download(format: 'csv' | 'xlsx' | 'pdf'): Promise<void> {
  error.value = null; note.value = null
  const stop = refusal()
  if (stop) { error.value = stop; return }
  loading.value = true
  try {
    const file = await financeApi.exportReport({ ...requestParams(), format })
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked on the next tick: the download has started by then and holding the object URL
    // keeps the whole file in memory.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    note.value = file.restricted
      ? `${file.filename} downloaded. It contains supplier and beneficiary identities and is named RESTRICTED.`
      : `${file.filename} downloaded.`
  } catch (err) {
    error.value = messageOf(err, 'The export could not be produced.')
  } finally { loading.value = false }
}

const isNumeric = (value: unknown): boolean =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)

function renderCell(row: Record<string, unknown>, column: { key: string; type?: string }): string {
  const value = row[column.key]
  if (value === null || value === undefined || value === '') return '—'
  if (column.type === 'date') return formatDate(String(value))
  if (column.type === 'number') {
    return isNumeric(value) ? formatMoney(String(value), null, { bare: true }) : String(value)
  }
  return String(value)
}
</script>

<template>
  <div class="fin-section">
    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="16" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <section class="ins-card">
      <div class="ins-card-head"><h3>Choose a report</h3></div>
      <div class="ins-card-body">
        <div class="ins-form">
          <div class="ins-field fin-rp-wide">
            <label class="ins-label" for="rp-report">Report</label>
            <select id="rp-report" v-model="chosen" class="ins-input" aria-describedby="rp-report-about">
              <option v-for="r in catalogue" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
            <div v-if="definition" id="rp-report-about">
              <!-- The catalogue's own sentence on what the report is for, beside the report. -->
              <p v-if="definition.description" class="fin-rp-desc">{{ definition.description }}</p>
              <p class="ins-hint">
                Grouped by {{ definition.grouped_by.length ? definition.grouped_by.join(', ') : 'nothing — one row per record' }}.
              </p>
            </div>
          </div>
          <div v-if="needsCompareYear" class="ins-field">
            <label class="ins-label" for="rp-compare">Compare with</label>
            <select id="rp-compare" v-model="compareYearId" class="ins-input">
              <option value="">Select a prior year</option>
              <option v-for="y in comparisonYearOptions" :key="y.id" :value="y.id">{{ y.label }}</option>
            </select>
            <p class="ins-hint">
              The financial year above is the current year; this is the earlier year to compare it with.
            </p>
          </div>
          <div v-if="accepts('department_id')" class="ins-field">
            <label class="ins-label" for="rp-dept">Department</label>
            <select id="rp-dept" v-model="departmentId" class="ins-input">
              <option value="">All departments</option>
              <option v-for="d in store.departments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option>
            </select>
          </div>
          <div v-if="accepts('kind')" class="ins-field">
            <label class="ins-label" for="rp-kind">Revenue or expenditure</label>
            <select id="rp-kind" v-model="kind" class="ins-input">
              <option value="">Both</option>
              <option value="revenue">Revenue</option>
              <option value="expenditure">Expenditure</option>
            </select>
          </div>
          <div v-if="accepts('account_id')" class="ins-field">
            <label class="ins-label" for="rp-account">Account</label>
            <select id="rp-account" v-model="accountId" class="ins-input">
              <option value="">All accounts</option>
              <option v-for="a in accountOptions" :key="a.id" :value="a.id">{{ a.code }} {{ a.name }}</option>
            </select>
          </div>
          <div v-if="accepts('programme_id')" class="ins-field">
            <label class="ins-label" for="rp-programme">Programme</label>
            <select id="rp-programme" v-model="programmeId" class="ins-input">
              <option value="">All programmes</option>
              <option v-for="p in programmeOptions" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
            </select>
            <p class="ins-hint">
              A budget line recorded against no programme is still reported, in its own row.
            </p>
          </div>
          <div v-if="accepts('expenditure_class')" class="ins-field">
            <label class="ins-label" for="rp-expclass">Capital or recurrent</label>
            <select id="rp-expclass" v-model="expenditureClass" class="ins-input">
              <option value="">Both, and unclassified</option>
              <option value="recurrent">Recurrent</option>
              <option value="capital">Capital</option>
            </select>
            <p class="ins-hint">
              Set by Council on the account. An account with no class set is reported separately,
              never folded into recurrent.
            </p>
          </div>
          <div v-if="accepts('ward_code')" class="ins-field">
            <label class="ins-label" for="rp-ward">Ward code</label>
            <input id="rp-ward" v-model="wardCode" class="ins-input" type="text" maxlength="32"
                   autocomplete="off" placeholder="All wards" />
            <p class="ins-hint">
              The ward code as it appears in the finance data. The unlocated row is reported
              whichever ward is asked for.
            </p>
          </div>
          <div v-if="accepts('currency')" class="ins-field">
            <label class="ins-label" for="rp-currency">Currency</label>
            <select id="rp-currency" v-model="currency" class="ins-input">
              <option value="">Each currency separately</option>
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }} only</option>
            </select>
            <p class="ins-hint">
              A grouping, not a default: every row states its own currency and no figure combines
              USD with ZWG.
            </p>
          </div>
          <div v-if="accepts('dates')" class="ins-field">
            <label class="ins-label" for="rp-from">From</label>
            <input id="rp-from" v-model="from" class="ins-input" type="date" />
          </div>
          <div v-if="accepts('dates')" class="ins-field">
            <label class="ins-label" for="rp-to">To</label>
            <input id="rp-to" v-model="to" class="ins-input" type="date" />
          </div>
        </div>

        <!-- The periodicity control exists only for a report whose catalogue entry declares a
             `periods` set. A report with no period dimension gets no control, because setting one
             and seeing unchanged figures would teach an officer something untrue. -->
        <fieldset v-if="hasPeriods" class="fin-rp-period">
          <legend>
            <CalendarRange :size="14" aria-hidden="true" />
            Reporting periods
          </legend>
          <p v-if="periodicityIsFixed" class="fin-rp-fixed">
            Produced at {{ PERIODICITY_LABELS[periodOptions[0]].toLowerCase() }} periods only. The
            report states its own period set and whether the columns are cumulative on the
            provenance block below.
          </p>
          <div v-else class="fin-rp-seg" role="radiogroup" aria-label="Periodicity">
            <label v-for="p in periodOptions" :key="p" class="fin-rp-seg-item">
              <input v-model="periodicity" type="radio" name="rp-periodicity" :value="p" />
              <span>{{ PERIODICITY_LABELS[p] }}</span>
            </label>
          </div>
          <label v-if="!periodicityIsFixed" class="ins-check fin-rp-mode">
            <input v-model="accumulated" type="checkbox" />
            <span>
              Year to date (accumulated)
              <small class="fin-sub">
                — each column runs from the financial year's start to that period's end, so the
                columns overlap and must not be added together. Unticked, each column covers its
                own period only.
              </small>
            </span>
          </label>
          <p class="fin-rp-note">
            Periods are counted from this council's own financial-year start date, not from the
            calendar year, so a July–June year begins its first quarter in July. A period in which
            nothing was recorded keeps its column and reports zero.
          </p>
        </fieldset>

        <label v-if="definition?.restricted_columns?.length" class="ins-check fin-restricted-toggle">
          <input v-model="includeRestricted" type="checkbox" :disabled="!canExportRestricted" />
          <span>
            Include {{ definition.restricted_columns.join(' and ').replace(/_/g, ' ') }}
            <small v-if="!canExportRestricted" class="fin-sub">
              — needs the restricted-export permission, which your role does not hold
            </small>
            <small v-else class="fin-sub">
              — the exported file will be named RESTRICTED and the export is recorded in the audit trail
            </small>
          </span>
        </label>

        <p v-if="currencyPolicy" class="fin-ccy-note">
          <Info :size="14" aria-hidden="true" /> {{ currencyPolicy }}
        </p>
      </div>
      <div class="ins-card-foot">
        <button type="button" class="fin-btn" :disabled="loading" @click="run">
          <PlayCircle :size="14" aria-hidden="true" /> {{ loading ? 'Building…' : 'Run on screen' }}
        </button>
        <button v-if="canExport" type="button" class="fin-btn" :disabled="loading" @click="download('csv')">
          <Download :size="14" aria-hidden="true" /> CSV
        </button>
        <button v-if="canExport" type="button" class="fin-btn primary" :disabled="loading" @click="download('xlsx')">
          <FileSpreadsheet :size="14" aria-hidden="true" /> Excel
        </button>
        <!-- The committee-pack copy: same figures, with the council identity, year and currency
             rule printed on its cover. -->
        <button v-if="canExport" type="button" class="fin-btn" :disabled="loading" @click="download('pdf')">
          <FileText :size="14" aria-hidden="true" /> PDF
        </button>
        <span v-if="!canExport" class="fin-hint-inline">
          Exporting needs the “Export reports” permission.
        </span>
      </div>
    </section>

    <section v-if="result" class="ins-card">
      <div class="ins-card-head">
        <h3>{{ definition?.name ?? result.report }} <span class="ins-count">{{ result.rows.length }} row(s)</span></h3>
      </div>
      <div class="ins-card-body">
        <dl class="ins-dl fin-report-meta">
          <div v-for="(value, key) in result.meta" :key="key">
            <dt>{{ key }}</dt><dd>{{ value }}</dd>
          </div>
        </dl>

        <p v-if="result.restricted" class="ins-banner t-warning">
          <EyeOff :size="15" aria-hidden="true" />
          <span>
            This report includes supplier and beneficiary identities. It is restricted council
            information and must not be circulated outside the authorised recipients.
          </span>
        </p>

        <div v-if="result.rows.length === 0" class="fin-empty">
          <strong>No rows match.</strong>
          <p>
            The report ran and found nothing for the filters above. That is a result, not a failure:
            check the financial year and the department.
          </p>
        </div>

        <!-- A wide report scrolls inside this region only. The region is focusable and labelled so
             it can be reached and scrolled from the keyboard, which an overflow container is not
             by default. -->
        <div v-else class="fin-table-wrap fin-rp-scroll" tabindex="0" role="region"
             :aria-label="`${definition?.name ?? result.report} figures, ${result.columns.length} columns`">
          <table class="fin-table fin-rp-table">
            <thead>
              <tr>
                <th v-for="c in result.columns" :key="c.key" scope="col" :class="{ num: c.type === 'number' }">
                  {{ c.header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in result.rows.slice(0, 500)" :key="i">
                <td v-for="c in result.columns" :key="c.key"
                    :class="{ num: c.type === 'number', ccy: c.key === 'currency' }">
                  {{ renderCell(row, c) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="result.columns.length > 8 && result.rows.length" class="fin-sub fin-rp-scroll-hint">
          This report has {{ result.columns.length }} columns. The table scrolls sideways; the
          exported file carries all of them.
        </p>

        <p v-if="result.rows.length > 500" class="fin-sub">
          Showing the first 500 of {{ result.rows.length }} rows. Export the report for all of them.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fin-section { display: flex; flex-direction: column; gap: var(--ent-s4); }
.fin-sub { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fin-restricted-toggle { margin-top: var(--ent-s3); align-items: flex-start; }
.fin-report-meta { margin-bottom: var(--ent-s4); padding-bottom: var(--ent-s3); border-bottom: 1px solid var(--ent-line); }
.fin-report-meta dd { font-size: var(--ent-fs-xs); }
.fin-hint-inline { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.fin-ccy-note { display: flex; align-items: flex-start; gap: var(--ent-s2); }

/* The report picker and the sentence that says what the report is for. */
.fin-rp-wide { grid-column: 1 / -1; }
.fin-rp-desc {
  margin: var(--ent-s2) 0 var(--ent-s1);
  max-width: 78ch;
  color: var(--ent-text-2);
  font-size: var(--ent-fs-xs);
  line-height: 1.5;
}

/* The periodicity control. Rendered only for a report that declares a period dimension. */
.fin-rp-period {
  margin-top: var(--ent-s3);
  padding: var(--ent-s3);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm);
  background: var(--ent-surface-2);
}
.fin-rp-period > legend {
  display: flex;
  align-items: center;
  gap: var(--ent-s2);
  padding: 0 var(--ent-s2);
  color: var(--ent-text);
  font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold);
}
.fin-rp-seg { display: flex; flex-wrap: wrap; gap: var(--ent-s2); }
.fin-rp-seg-item {
  display: inline-flex;
  align-items: center;
  gap: var(--ent-s2);
  min-height: 2rem;
  padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-sm);
  background: var(--ent-surface);
  font-size: var(--ent-fs-xs);
  cursor: pointer;
}
/* The checked state carries a border AND a weight change, so it is never colour alone. */
.fin-rp-seg-item:has(input:checked) {
  border-color: var(--ent-accent);
  font-weight: var(--ent-fw-semibold);
}
.fin-rp-seg-item:has(input:focus-visible) {
  outline: var(--ent-focus-ring);
  outline-offset: 2px;
}
.fin-rp-mode { margin-top: var(--ent-s3); align-items: flex-start; }
.fin-rp-fixed,
.fin-rp-note {
  margin: var(--ent-s2) 0 0;
  max-width: 78ch;
  color: var(--ent-text-3);
  font-size: var(--ent-fs-micro);
  line-height: 1.5;
}

/*
 * A wide report at phone width.
 *
 * .fin-table-wrap already scrolls horizontally (pages/finance.css). What is added here is a
 * readable minimum column width so twelve period columns do not compress into unreadable
 * fragments, and a pinned first column so a scrolled-away row can still be identified. The
 * provenance block above and the row-count note below sit outside this region and do not move.
 */
.fin-rp-scroll { overscroll-behavior-x: contain; }
.fin-rp-scroll:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.fin-rp-table th,
.fin-rp-table td { white-space: nowrap; }
.fin-rp-table th:first-child,
.fin-rp-table td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--ent-surface);
  border-right: 1px solid var(--ent-line);
}
.fin-rp-table thead th:first-child { z-index: 2; background: var(--ent-surface-2); }
.fin-rp-table tbody tr:hover td:first-child { background: var(--ent-surface-2); }
.fin-rp-scroll-hint { margin-top: var(--ent-s2); }

@media (max-width: 40rem) {
  .fin-rp-table th,
  .fin-rp-table td { padding-left: var(--ent-s2); padding-right: var(--ent-s2); }
  /* The pinned column is capped so it cannot take the whole viewport on a phone. */
  .fin-rp-table th:first-child,
  .fin-rp-table td:first-child {
    max-width: 7.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fin-rp-seg-item { flex: 1 1 8rem; justify-content: center; }
}
</style>
