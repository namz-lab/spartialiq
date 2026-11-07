<script setup lang="ts">
// Development-control returns for a month, quarter or year: what came in,
// what was decided and how fast, with breakdowns. The same figures go to the
// monthly committee report (Month) and the return to the Ministry (Quarter).
// Calculations live in reportStats.ts; this file only presents them.

import { computed, onMounted, ref, watch } from 'vue'
import jsPDF from 'jspdf'
import { dmApi, type PermitApplication, type EnforcementOrder } from '@/services/developmentManagementService'
import { drawLetterhead } from '@/documents/letterheadPdf'
import { downloadCsv } from '@/composables/useReportBuilder'
import {
  buildReturns, currentPeriod, periodLabel, share, type Period, type PeriodKind,
} from '@/views/planner/reportStats'
import { ACK_DAYS } from '@/views/planner/caseClock'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import { Download, FileDown, RefreshCw, Gauge, ListOrdered } from 'lucide-vue-next'

const fb = useUiFeedback()
const permits = ref<PermitApplication[]>([])
const enforcement = ref<EnforcementOrder[]>([])
const loading = ref(false)
const loaded = ref(false)

async function refresh() {
  loading.value = true
  try {
    const [p, e] = await Promise.all([dmApi.listAllPermits(), dmApi.listEnforcement()])
    permits.value = p
    enforcement.value = e
    loaded.value = true
  } catch (err) {
    fb.showToast(fb.parseApiError(err, 'Could not load report data'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

// ── Period ────────────────────────────────────────────────────────────────
const period = ref<Period>(currentPeriod('quarter'))
const thisYear = new Date().getUTCFullYear()
const years = [thisYear - 3, thisYear - 2, thisYear - 1, thisYear] // no future years
const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'month', label: 'Month' }, { key: 'quarter', label: 'Quarter' }, { key: 'year', label: 'Year' },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
watch(() => period.value.kind, kind => { period.value = { ...currentPeriod(kind), year: period.value.year } })

const r = computed(() => buildReturns(permits.value, enforcement.value, period.value))
const label = computed(() => periodLabel(period.value))
const hasActivity = computed(() => r.value.received || r.value.decided || r.value.enforcementIssued)

const SUMMARY = computed(() => [
  { k: 'Applications received', v: String(r.value.received) },
  { k: 'Applications decided', v: String(r.value.decided) },
  { k: 'Approved, including with conditions', v: String(r.value.approved) },
  { k: 'Refused', v: String(r.value.refused) },
  { k: 'Enforcement orders issued', v: String(r.value.enforcementIssued) },
])
const PERFORMANCE = computed(() => [
  { k: 'Median days, receipt to decision', v: r.value.medianDaysToDecision == null ? '—' : `${r.value.medianDaysToDecision} days`, note: 'Applications decided in the period' },
  { k: 'Decided within the statutory period', v: share(r.value.decidedInTime, r.value.decided), note: 'Three months from acknowledgement (s.26(7)); four for subdivisions (s.40(6)). Receipt stands in where not acknowledged' },
  { k: `Acknowledged within ${ACK_DAYS} days`, v: share(r.value.ackOnTime, r.value.ackDue), note: 'Applications received in the period whose two weeks (s.26(2)(a)) have run' },
  { k: 'Live files past the statutory period today', v: String(r.value.overdueNow), note: 'At risk of deemed refusal; not limited to the period', alert: r.value.overdueNow > 0 },
])

const BREAKDOWNS = computed(() => [
  { title: 'By status today', rows: r.value.byStatus },
  { title: 'By development type', rows: r.value.byType },
  { title: 'By ward', rows: r.value.byWard.slice(0, 12) },
])
const pct = (n: number) => `${Math.min(100, (n / Math.max(1, r.value.received)) * 100)}%`

// ── Exports ───────────────────────────────────────────────────────────────
const slug = computed(() => label.value.toLowerCase().replace(/\s+/g, '-'))

function exportPdf() {
  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  let y = drawLetterhead(doc, { department: 'Planning Department' }) + 8
  const line = (text: string, o: { bold?: boolean; size?: number; right?: string } = {}) => {
    if (y > 280) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size ?? 10)
    doc.text(text, 14, y)
    if (o.right) doc.text(o.right, W - 14, y, { align: 'right' })
    y += 6
  }
  const rule = () => { doc.setDrawColor(210, 214, 220); doc.line(14, y - 2, W - 14, y - 2); y += 3 }

  line(`DEVELOPMENT CONTROL RETURN — ${label.value.toUpperCase()}`, { bold: true, size: 13 })
  line('Regional, Town and Country Planning Act [Chapter 29:12]', { size: 9 })
  y += 2; rule()
  line('Summary', { bold: true, size: 11 })
  for (const s of SUMMARY.value) line(s.k, { right: s.v })
  y += 2; rule()
  line('Performance', { bold: true, size: 11 })
  for (const s of PERFORMANCE.value) line(s.k, { right: s.v })
  for (const b of BREAKDOWNS.value) {
    y += 2; rule()
    line(b.title, { bold: true, size: 11 })
    if (!b.rows.length) line('None')
    for (const [k, v] of b.rows) line(k, { right: String(v) })
  }
  y += 4
  line(`Compiled ${new Date().toLocaleString('en-GB')} from the development register.`, { size: 8 })
  doc.save(`development-control-return-${slug.value}.pdf`)
  fb.showToast('Return exported as PDF', 'success')
}

function exportCsv() {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = [['Section', 'Measure', 'Value']]
  for (const s of SUMMARY.value) rows.push(['Summary', s.k, s.v])
  for (const s of PERFORMANCE.value) rows.push(['Performance', s.k, s.v])
  for (const b of BREAKDOWNS.value) for (const [k, v] of b.rows) rows.push([b.title, k, String(v)])
  downloadCsv(rows.map(r => r.map(q).join(',')).join('\n'), `development-control-return-${slug.value}.csv`)
  fb.showToast('Return exported as CSV', 'success')
}
</script>

<template>
  <div class="rp">
    <header class="rp-head">
      <div>
        <h2>Reports &amp; Returns</h2>
        <p>Development control return for {{ label }}. Month for the committee report, quarter for the Ministry return.</p>
      </div>
      <div class="rp-period">
        <div class="rp-kind" role="radiogroup" aria-label="Reporting period">
          <button v-for="k in KINDS" :key="k.key" type="button" role="radio" :aria-checked="period.kind === k.key"
                  :class="{ active: period.kind === k.key }" @click="period.kind = k.key">{{ k.label }}</button>
        </div>
        <label class="ent-sr-only" for="rp-year">Year</label>
        <select id="rp-year" v-model.number="period.year" class="rp-select">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
        <template v-if="period.kind === 'quarter'">
          <label class="ent-sr-only" for="rp-q">Quarter</label>
          <select id="rp-q" v-model.number="period.index" class="rp-select">
            <option :value="1">Q1 Jan–Mar</option><option :value="2">Q2 Apr–Jun</option>
            <option :value="3">Q3 Jul–Sep</option><option :value="4">Q4 Oct–Dec</option>
          </select>
        </template>
        <template v-else-if="period.kind === 'month'">
          <label class="ent-sr-only" for="rp-m">Month</label>
          <select id="rp-m" v-model.number="period.index" class="rp-select">
            <option v-for="(m, i) in MONTHS" :key="m" :value="i">{{ m }}</option>
          </select>
        </template>
        <UiButton size="sm" variant="ghost" :loading="loading" aria-label="Refresh" @click="refresh">
          <template #icon><RefreshCw :size="13" /></template>
        </UiButton>
      </div>
    </header>

    <p v-if="!loaded && loading" class="rp-muted" aria-live="polite">Loading the register…</p>
    <template v-else>
      <div class="rp-top">
        <UiPanel flush title="Summary" :subtitle="label">
          <template #icon><ListOrdered :size="15" /></template>
          <dl class="rp-dl">
            <div v-for="s in SUMMARY" :key="s.k"><dt>{{ s.k }}</dt><dd>{{ s.v }}</dd></div>
          </dl>
        </UiPanel>

        <UiPanel flush title="Performance" subtitle="How promptly the council decides">
          <template #icon><Gauge :size="15" /></template>
          <dl class="rp-dl">
            <div v-for="s in PERFORMANCE" :key="s.k" :class="{ alert: s.alert }">
              <dt>{{ s.k }}<small>{{ s.note }}</small></dt><dd>{{ s.v }}</dd>
            </div>
          </dl>
        </UiPanel>
      </div>

      <div class="rp-export">
        <UiButton variant="primary" :disabled="!loaded" @click="exportPdf">
          <template #icon><FileDown :size="14" /></template>
          Export return (PDF)
        </UiButton>
        <UiButton :disabled="!loaded" @click="exportCsv">
          <template #icon><Download :size="14" /></template>
          Export figures (CSV)
        </UiButton>
      </div>

      <UiEmptyState v-if="!hasActivity" :message="`No applications received or decided in ${label}.`" />
      <div v-else class="rp-grid">
        <UiPanel v-for="b in BREAKDOWNS" :key="b.title" flush :title="b.title" subtitle="Applications received in the period">
          <UiEmptyState v-if="!b.rows.length" message="None in this period." />
          <ul v-else class="rp-list">
            <li v-for="[k, n] in b.rows" :key="k">
              <span class="rp-key">{{ k }}</span>
              <span class="rp-bar" aria-hidden="true"><span class="rp-fill" :style="{ width: pct(n) }"></span></span>
              <span class="rp-count">{{ n }}</span>
            </li>
          </ul>
        </UiPanel>
      </div>
    </template>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.rp { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); }
.rp-head { display: flex; align-items: flex-start; gap: var(--ent-s3); flex-wrap: wrap; }
.rp-head > div:first-child { flex: 1; min-width: 18rem; }
.rp-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); letter-spacing: -0.01em; }
.rp-head p { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.rp-muted { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

.rp-period { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.rp-kind { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface-2); }
.rp-kind button { all: unset; box-sizing: border-box; cursor: pointer; padding: 0 var(--ent-s3); min-height: calc(var(--ent-control-h) - 6px);
  display: inline-flex; align-items: center; border-radius: calc(var(--ent-r) - 2px); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.rp-kind button:focus-visible { box-shadow: var(--ent-focus-ring); }
.rp-kind button.active { background: var(--ent-surface); color: var(--ent-text); font-weight: var(--ent-fw-semibold); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
.rp-select { height: var(--ent-control-h); padding: 0 var(--ent-s3); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r);
  background: var(--ent-surface); font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text); cursor: pointer; }
.rp-select:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }

.rp-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr)); gap: var(--ent-s3); align-items: start; }
.rp-dl { margin: 0; }
.rp-dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--ent-s3); padding: var(--ent-s2) var(--ent-s4); border-top: 1px solid var(--ent-line); }
.rp-dl > div:first-child { border-top: none; }
.rp-dl dt { font-size: var(--ent-fs-sm); color: var(--ent-text-2); display: flex; flex-direction: column; }
.rp-dl dt small { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.rp-dl dd { margin: 0; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rp-dl > div.alert dd { color: var(--ent-danger); }

.rp-export { display: flex; gap: var(--ent-s2); flex-wrap: wrap; }
.rp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr)); gap: var(--ent-s3); align-items: start; }
.rp-list { list-style: none; margin: 0; padding: 0; }
.rp-list li { display: grid; grid-template-columns: minmax(0, 11rem) 1fr 2.5rem; gap: var(--ent-s3); align-items: center;
  padding: var(--ent-s2) var(--ent-s4); font-size: var(--ent-fs-sm); border-top: 1px solid var(--ent-line); }
.rp-list li:first-child { border-top: none; }
.rp-key { color: var(--ent-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-bar { height: 6px; background: var(--ent-surface-sunken); border-radius: var(--ent-r-pill); overflow: hidden; }
.rp-fill { display: block; height: 100%; background: var(--ent-accent); border-radius: var(--ent-r-pill); }
.rp-count { text-align: right; font-weight: var(--ent-fw-semibold); color: var(--ent-text); font-variant-numeric: tabular-nums; }

@media (max-width: 767px) {
  .rp { padding: var(--ent-s3); }
  .rp-period { width: 100%; }
}
</style>
