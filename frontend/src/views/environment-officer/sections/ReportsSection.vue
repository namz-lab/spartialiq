<script setup lang="ts">
// Reports — the periodic environmental health return to Council and the
// Ministry of Health and Child Care.
//
// Every figure comes from src/environment-officer/report.ts (pure, tested),
// over server records for the chosen period. It used to be computed by reading
// each premises' localStorage case file on this one workstation, so a report
// run on a colleague's machine — or after clearing the browser — showed a
// district that had done no inspections.
//
// If any source fails to load, the return is not produced. A report with one
// register silently missing reports zero for it, and a zero in a Ministry
// return is a claim.

import { computed, ref, watch } from 'vue'
import { useHealthCase } from '@/composables/useHealthCase'
import { ehoOpsApi } from '@/services/environmentalHealthOps'
import { ehoApi } from '@/services/environmentalHealth'
import { useAuthStore } from '@/stores/auth'
import { buildReport, periodFor, reportCsv, type PeriodKey, type ReportBlock, type ReportInput } from '@/environment-officer/report'
import { councilDoc, signatures, footer } from '@/environment-officer/documents'
import { fmtDateTime, isoDay } from '@/environment-officer/console'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { BarChart3, FileDown, Sheet, RefreshCw, CloudOff, Printer } from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const auth = useAuthStore()

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' }, { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_year', label: 'This year' },
]
const periodKey = ref<PeriodKey>('last_month')
const period = computed(() => periodFor(periodKey.value))

const input = ref<ReportInput | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const generatedAt = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  const from = isoDay(period.value.from)
  const to = isoDay(period.value.to)
  try {
    // Registers are re-read from the server, not from this device's cache: a
    // return must reflect the council's record, including other officers' work.
    const [inspections, notices, programmes, handlers, burials, clearances, outbreaks, samples, complaints] = await Promise.all([
      ehoOpsApi.listInspections({ from, to: `${to}T23:59:59`, limit: 500 }),
      ehoOpsApi.listNotices({ limit: 500 }),
      ehoOpsApi.listProgrammes({ from, to, limit: 500 }),
      ehoOpsApi.listFoodHandlers({ include_revoked: true, limit: 500 }),
      ehoOpsApi.listBurialPermits({ limit: 500 }),
      ehoOpsApi.listClearances({ limit: 500 }),
      ehoApi.listOutbreaks(), ehoApi.listWaterSamples(), ehoApi.listComplaints(),
    ])
    input.value = { inspections, notices, programmes, handlers, burials, clearances, outbreaks, samples, complaints }
    generatedAt.value = new Date().toISOString()
  } catch (err: unknown) {
    input.value = null
    loadError.value = fb.parseApiError(err, 'The report data could not be loaded.')
  } finally {
    loading.value = false
  }
}
watch(periodKey, load, { immediate: true })

const blocks = computed<ReportBlock[]>(() => (input.value ? buildReport(input.value, period.value) : []))
// The pagination ceiling on each list is 500; hitting it means the figure is a floor.
const truncated = computed(() => !!input.value && Object.values(input.value).some(list => list.length >= 500))
const heldLocally = computed(() => hc.pendingCount.value)

function exportPdf() {
  const d = councilDoc('Environmental health return', `${period.value.label} · generated ${fmtDateTime(generatedAt.value)}`)
  d.doc.setFontSize(9)
  for (const b of blocks.value) {
    if (d.y > 250) { d.doc.addPage(); d.y = 20 }
    d.doc.setFont('helvetica', 'bold'); d.doc.setFontSize(10)
    d.doc.text(b.title.toUpperCase(), 14, d.y); d.y += 2
    d.doc.setLineWidth(0.2); d.doc.line(14, d.y, 196, d.y); d.y += 5
    d.doc.setFontSize(9)
    for (const l of b.lines) {
      if (d.y > 280) { d.doc.addPage(); d.y = 20 }
      d.doc.setFont('helvetica', l.emphasis ? 'bold' : 'normal')
      d.doc.text(l.label, l.label.startsWith('—') ? 20 : 14, d.y)
      d.doc.text(String(l.value), 196, d.y, { align: 'right' })
      d.y += 5
    }
    d.y += 4
  }
  signatures(d, `${auth.userName || 'Environmental Health Officer'} — prepared by`, 'District Environmental Health Officer — approved')
  footer(d, 'Figures computed from the council\'s environmental health registers for the period stated.')
  d.doc.save(`eho-return-${period.value.label.replace(/\s+/g, '-')}.pdf`)
}

function exportCsv() {
  const blob = new Blob([reportCsv(blocks.value, period.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `eho-return-${period.value.label.replace(/\s+/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Council · Ministry of Health and Child Care</span>
        <h2 class="ins-title">Reports</h2>
        <p class="ins-lede">The periodic return, computed from the council's registers for the period — every officer's work, not this device's.</p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Recompute" @click="load">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" /><span class="ent-sr-only">Recompute</span>
        </button>
        <UiButton :disabled="!blocks.length" @click="exportCsv"><template #icon><Sheet :size="15" /></template>CSV</UiButton>
        <UiButton variant="primary" :disabled="!blocks.length" @click="exportPdf"><template #icon><FileDown :size="15" /></template>PDF return</UiButton>
      </div>
    </header>

    <div class="ins-seg er-periods" role="radiogroup" aria-label="Reporting period">
      <button v-for="p in PERIODS" :key="p.key" type="button" role="radio" :aria-checked="periodKey === p.key" @click="periodKey = p.key">{{ p.label }}</button>
    </div>

    <p v-if="loadError" class="ins-banner t-negative">
      <CloudOff :size="16" aria-hidden="true" />
      <span><strong>{{ loadError }}</strong> The return is not produced from partial data — a missing register would report zeros.</span>
    </p>
    <p v-if="heldLocally" class="ins-banner t-warning">
      <CloudOff :size="16" aria-hidden="true" />
      <span>{{ heldLocally }} record{{ heldLocally === 1 ? ' is' : 's are' }} held on this device and not yet on the server, so {{ heldLocally === 1 ? 'it is' : 'they are' }} not counted. Sync before filing.</span>
    </p>
    <p v-if="truncated" class="ins-banner t-warning">
      <BarChart3 :size="16" aria-hidden="true" /><span>At least one register returned its maximum of 500 rows. Some figures may be understated; choose a shorter period.</span>
    </p>

    <div v-if="loading && !blocks.length" class="er-grid" aria-busy="true">
      <div v-for="i in 6" :key="i" class="ins-card er-block"><span class="ins-skel" style="width:40%" /><span class="ins-skel" style="margin-top:12px" /><span class="ins-skel" style="margin-top:8px;width:70%" /></div>
    </div>

    <template v-else-if="blocks.length">
      <p class="er-caption">
        <strong>{{ period.label }}</strong> · computed {{ fmtDateTime(generatedAt) }}
      </p>
      <div class="er-grid" :class="{ 'er-stale': loading }">
        <section v-for="b in blocks" :key="b.title" class="ins-card er-block" :aria-label="b.title">
          <h3>{{ b.title }}</h3>
          <dl>
            <div v-for="(l, i) in b.lines" :key="i" class="er-line" :class="{ sub: l.label.startsWith('—'), em: l.emphasis }">
              <dt>{{ l.label.replace(/^— /, '') }}</dt><dd>{{ l.value }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <p class="ins-hint er-print"><Printer :size="13" aria-hidden="true" /> The PDF return carries signature lines for the preparing and approving officers.</p>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.er-periods { flex-wrap:wrap; align-self:flex-start; }
.er-caption { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.er-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 20rem), 1fr)); gap:var(--ent-s4); align-items:start;
  transition:opacity var(--ent-dur) var(--ent-ease); }
.er-stale { opacity:0.55; }
.er-block { padding:var(--ent-s4); }
.er-block h3 { margin:0 0 var(--ent-s3); font-size:var(--ent-fs-md); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.er-block dl { margin:0; }
.er-line { display:flex; justify-content:space-between; gap:var(--ent-s3); padding:var(--ent-s1) 0;
  border-top:1px solid var(--ent-line); font-size:var(--ent-fs-sm); }
.er-line:first-child { border-top:0; }
.er-line dt { color:var(--ent-text-2); }
.er-line dd { margin:0; font-variant-numeric:tabular-nums; color:var(--ent-text); text-align:right; }
.er-line.sub { border-top:0; padding-top:0; }
.er-line.sub dt { padding-left:var(--ent-s4); color:var(--ent-text-3); font-size:var(--ent-fs-xs); }
.er-line.sub dd { color:var(--ent-text-2); font-size:var(--ent-fs-xs); }
.er-line.em dt, .er-line.em dd { font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.er-line.em dd { font-size:var(--ent-fs-md); }
.er-print { display:flex; align-items:center; gap:var(--ent-s1); }
@media (prefers-reduced-motion: reduce) { .er-grid { transition:none; } }
</style>
