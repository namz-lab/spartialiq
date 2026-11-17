<script setup lang="ts">
/**
 * The council submission pack: the budget statements a budget officer takes to the finance
 * committee and full council, each previewed on screen (`GET /finance/reports/run`) and exported as
 * PDF, XLSX or CSV (`GET /finance/reports/export`, permission `finance.report.export`).
 *
 * Only reports the server's catalogue lists are offered, so a report the backend does not build is
 * never shown. Each file is the server's own rendering, with its provenance block, the currency
 * treatment and the filters applied: the committee's PDF and the officer's spreadsheet cannot
 * disagree. No restricted columns are ever requested from here.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { FileStack, AlertTriangle, Info, Download, Eye } from 'lucide-vue-next'
import { financeApi, type ReportRunParams } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { ReportDefinition, ReportResult } from '../../../models/types'

/** The pack, in the order a council budget submission is usually read. */
const PACK = [
  'budget_execution_statement', 'budget_vs_actual', 'revenue_by_source', 'capital_vs_recurrent',
  'departmental_summary', 'programme_performance', 'variance_report', 'budget_revisions',
  'commitments_register', 'quarterly_return',
] as const

const store = useFinanceStore()
const catalogue = ref<ReportDefinition[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const busy = ref<string | null>(null)
const preview = ref<{ id: string; result: ReportResult } | null>(null)

const canExport = computed(() => store.can('finance.report.export'))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    catalogue.value = (await financeApi.reportCatalogue()).reports
  } catch (err) {
    error.value = messageOf(err, 'The report catalogue could not be read.')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => store.selectedYearId, () => { preview.value = null })

/** A report the pack can run on the year alone (a comparison year or a date range is the Reports page's). */
const runnable = (r: ReportDefinition) => r.requires.every((x) => x === 'financial_year_id' || x === 'periodicity')
const items = computed(() => PACK
  .map((id) => catalogue.value.find((r) => r.id === id))
  .filter((r): r is ReportDefinition => !!r && runnable(r)))

function params(r: ReportDefinition): ReportRunParams {
  const p: ReportRunParams = { report: r.id, financial_year_id: store.selectedYearId ?? undefined }
  if (r.periods?.length) p.periodicity = r.periods.includes('quarterly') ? 'quarterly' : r.periods[0]
  return p
}

async function show(r: ReportDefinition): Promise<void> {
  if (!store.selectedYearId) return
  if (preview.value?.id === r.id) { preview.value = null; return }
  busy.value = `run:${r.id}`
  error.value = null
  note.value = null
  try {
    preview.value = { id: r.id, result: await financeApi.runReport(params(r)) }
  } catch (err) {
    error.value = messageOf(err, `${r.name} could not be built.`)
  } finally {
    busy.value = null
  }
}

async function download(r: ReportDefinition, format: 'pdf' | 'xlsx' | 'csv'): Promise<void> {
  if (!store.selectedYearId) return
  busy.value = `${format}:${r.id}`
  error.value = null
  note.value = null
  try {
    const file = await financeApi.exportReport({ ...params(r), format })
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    note.value = `${file.filename} downloaded.`
  } catch (err) {
    error.value = messageOf(err, `${r.name} could not be exported.`)
  } finally {
    busy.value = null
  }
}

const PREVIEW_ROWS = 25
const cell = (v: unknown, type?: string): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (type === 'number') return formatMoney(String(v), null, { bare: true })
  return String(v)
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><FileStack :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Council Submission Pack</h2>
      <p>The budget statements for the finance committee and council, for {{ store.selectedYear?.label ?? 'the selected year' }}. Each file carries the council's provenance block and states its currency treatment.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="note" class="cw-banner-msg cw-banner-msg--info" role="status"><Info :size="18" aria-hidden="true" />{{ note }}</p>
  <p v-if="!canExport" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />Your role can read these reports on screen but not export them.</p>
  <p v-if="!store.selectedYearId" class="cw-banner-msg cw-banner-msg--warn"><AlertTriangle :size="18" aria-hidden="true" />Choose a financial year first.</p>

  <section class="cw-card">
    <div class="cw-card-head">
      <h3>Statements</h3><span class="cw-spacer" />
      <RouterLink :to="{ name: 'bud-reports' }" class="cw-link">Every report, with filters</RouterLink>
    </div>
    <div class="cw-card-body">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!items.length && !error" class="cw-empty">The report catalogue lists none of the pack's statements.</p>
      <ol v-else class="sp-list">
        <li v-for="r in items" :key="r.id" class="sp-item">
          <div class="sp-head">
            <div class="sp-text">
              <h4>{{ r.name }}</h4>
              <p v-if="r.description" class="cw-hint">{{ r.description }}</p>
              <p v-if="r.periods?.length" class="cw-hint">Run {{ params(r).periodicity?.replace('_', ' ') }}.</p>
            </div>
            <div class="sp-actions">
              <button type="button" class="cw-btn cw-btn--small" :disabled="!store.selectedYearId || busy !== null" :aria-expanded="preview?.id === r.id" @click="show(r)">
                <Eye :size="16" aria-hidden="true" />{{ preview?.id === r.id ? 'Hide' : busy === `run:${r.id}` ? 'Building…' : 'Preview' }}</button>
              <template v-if="canExport">
                <button v-for="f in (['pdf', 'xlsx', 'csv'] as const)" :key="f" type="button" class="cw-btn cw-btn--small" :disabled="!store.selectedYearId || busy !== null"
                  :aria-label="`Export ${r.name} as ${f.toUpperCase()}`" @click="download(r, f)">
                  <Download :size="16" aria-hidden="true" />{{ busy === `${f}:${r.id}` ? '…' : f.toUpperCase() }}</button>
              </template>
            </div>
          </div>
          <div v-if="preview?.id === r.id" class="sp-preview cw-table-wrap">
            <p v-if="!preview.result.rows.length" class="cw-empty">The report has no rows for this year.</p>
            <table v-else class="cw-table sp-table">
              <caption class="sr-only">{{ r.name }}, first {{ Math.min(PREVIEW_ROWS, preview.result.rows.length) }} rows</caption>
              <thead><tr><th v-for="c in preview.result.columns" :key="c.key" scope="col" :class="{ r: c.type === 'number' }">{{ c.header }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in preview.result.rows.slice(0, PREVIEW_ROWS)" :key="i">
                  <td v-for="c in preview.result.columns" :key="c.key" :class="{ 'r num': c.type === 'number' }">{{ cell(row[c.key], c.type) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="preview.result.rows.length > PREVIEW_ROWS" class="cw-hint">Showing {{ PREVIEW_ROWS }} of {{ preview.result.rows.length }} rows. The export carries them all.</p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.sp-list { list-style: none; margin: 0; padding: 0; }
.sp-item { padding: 12px 0; border-bottom: 1px solid var(--cw-line); }
.sp-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; }
.sp-text { flex: 1 1 320px; min-width: 0; }
.sp-text h4 { margin: 0 0 4px; font-size: 15.5px; }
.sp-text p { margin: 0; }
.sp-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-actions .cw-btn { display: inline-flex; align-items: center; gap: 6px; }
.sp-preview { margin-top: 12px; }
.sp-table td, .sp-table th { white-space: nowrap; font-size: 14px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
