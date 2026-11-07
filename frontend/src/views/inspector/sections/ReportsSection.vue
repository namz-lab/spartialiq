<script setup lang="ts">
// Reports — the building inspector's periodic return to Council: inspections
// carried out, pass rates by stage and by officer, enforcement activity and
// certificates of occupation for a reporting window.
//
// There is no aggregate endpoint yet, so the figures are built from the permit
// register and each permit's stage record. That used to be ~200 sequential
// requests with swallowed failures, so a report could silently omit permits.
// Now the requests run six at a time with visible progress, and any permit
// whose record could not be read is counted and disclosed on screen and in the
// PDF — the return never overstates its own completeness.
import { computed, onMounted, ref } from 'vue'
import jsPDF from 'jspdf'
import { BarChart3, FileDown, RefreshCw, AlertTriangle, ClipboardCheck, ShieldAlert, BadgeCheck, FilePlus2, Percent, Megaphone } from 'lucide-vue-next'
import {
  dmApi, type PermitApplication, type EnforcementOrder, type OccupationCertificate, type StageInspection,
} from '@/services/developmentManagementService'
import { complaintsApi, isComplaintOpen, type BuildingComplaint } from '@/services/buildingComplaints'
import { officialEnforcementOpen, normalizeEnforcementStatus } from '@/inspector/architecture'
import { INSPECTION_STAGES_STATIC } from '@/composables/useInspectionCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiKpi from '@/components/ui/UiKpi.vue'

const fb = useUiFeedback()

const permits = ref<PermitApplication[]>([])
const enforcement = ref<EnforcementOrder[]>([])
const complaints = ref<BuildingComplaint[]>([])
const complaintsError = ref(false)
const complaintsTruncated = ref(false)
const inspections = ref<StageInspection[]>([])
const certs = ref<OccupationCertificate[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const progress = ref({ done: 0, total: 0 })
const unreadable = ref(0)
/** The permit list endpoint hard-caps at 200 rows server-side. */
const PERMIT_PAGE = 200
const truncated = ref(false)

type ReportWindow = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year'
const reportWindow = ref<ReportWindow>('this_month')
const WINDOWS: ReadonlyArray<{ key: ReportWindow; label: string }> = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' }, { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_year', label: 'This year' },
]

function windowRange(w: ReportWindow): { from: Date; to: Date; label: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const monthLabel = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (w === 'this_month') return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59), label: monthLabel(now) }
  if (w === 'last_month') return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59), label: monthLabel(new Date(y, m - 1, 1)) }
  const q = Math.floor(m / 3)
  if (w === 'this_quarter') return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0, 23, 59, 59), label: `Q${q + 1} ${y}` }
  if (w === 'last_quarter') {
    const start = new Date(y, (q - 1) * 3, 1)
    return { from: start, to: new Date(start.getFullYear(), start.getMonth() + 3, 0, 23, 59, 59), label: `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}` }
  }
  return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59), label: `Year ${y}` }
}
const range = computed(() => windowRange(reportWindow.value))

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

async function refresh() {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const [p, e, cx] = await Promise.all([
      dmApi.listPermits({ limit: PERMIT_PAGE, offset: 0 }),
      dmApi.listEnforcement(),
      // Public reports were the half of the workload that never reached a
      // return, because they lived in a paper daybook. A failure here is
      // disclosed rather than counted as zero — an understated return is the
      // thing this section exists to stop.
      complaintsApi.list({ limit: PERMIT_PAGE }).then(r => r.data).catch(() => null),
    ])
    complaints.value = cx ?? []
    complaintsError.value = cx === null
    complaintsTruncated.value = (cx?.length ?? 0) >= PERMIT_PAGE
    truncated.value = p.data.length >= PERMIT_PAGE
    const insp: StageInspection[] = []
    const found: OccupationCertificate[] = []
    let failed = 0
    progress.value = { done: 0, total: p.data.length }
    await pool(p.data, 6, async (pp) => {
      try {
        const [is, c] = await Promise.all([
          dmApi.listStageInspections(pp.id),
          pp.has_occupation_certificate ? dmApi.getCertificate(pp.id) : Promise.resolve(null),
        ])
        insp.push(...is)
        if (c) found.push(c)
      } catch {
        failed += 1
      } finally {
        progress.value.done += 1
      }
    })
    permits.value = p.data
    enforcement.value = e
    inspections.value = insp
    certs.value = found
    unreadable.value = failed
    loaded.value = true
  } catch (err: unknown) {
    error.value = fb.parseApiError(err, 'Report data could not be gathered.')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

function inWindow(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= range.value.from.getTime() && t <= range.value.to.getTime()
}

const isPass = (i: StageInspection) => i.result === 'pass' || i.result === 'conditional_pass'
const isFail = (i: StageInspection) => i.result === 'fail' || i.result === 'reinspection_required'

const stats = computed(() => {
  const insp = inspections.value.filter(i => inWindow(i.inspected_at))
  const decided = insp.filter(i => isPass(i) || isFail(i))
  const passed = decided.filter(isPass).length
  const enf = enforcement.value.filter(o => inWindow(o.issued_at))
  const received = complaints.value.filter(c => inWindow(c.received_at))
  return {
    inspections: insp.length,
    passed,
    failed: decided.length - passed,
    passRate: decided.length ? Math.round((passed / decided.length) * 100) : null,
    reinspections: insp.filter(i => (i.attempt ?? 1) > 1).length,
    enforcement: enf.length,
    enfOpen: enf.filter(o => officialEnforcementOpen(o.status)).length,
    enfComplied: enf.filter(o => normalizeEnforcementStatus(o.status) === 'complied').length,
    backlog: enforcement.value.filter(o => officialEnforcementOpen(o.status) && !inWindow(o.issued_at)).length,
    certs: certs.value.filter(c => inWindow(c.issued_at)).length,
    newPermits: permits.value.filter(p => inWindow(p.received_at || p.created_at)).length,
    complaints: received.length,
    complaintsSubstantiated: received.filter(c => c.status === 'substantiated').length,
    complaintsUnsubstantiated: received.filter(c => c.status === 'unsubstantiated').length,
    // Outstanding at the end of the period, whenever they were received —
    // the backlog Council actually asks about.
    complaintsOpen: complaints.value.filter(isComplaintOpen).length,
  }
})

const byStage = computed(() => INSPECTION_STAGES_STATIC.map(({ n, name }) => {
  const rows = inspections.value.filter(i => i.stage_number === n && inWindow(i.inspected_at))
  const passed = rows.filter(isPass).length
  const failed = rows.filter(isFail).length
  return { n, name, total: rows.length, passed, failed, rate: passed + failed ? Math.round(passed / (passed + failed) * 100) : null }
}))
const stageMax = computed(() => Math.max(1, ...byStage.value.map(s => s.total)))

const byOfficer = computed(() => {
  const m = new Map<string, { total: number; passed: number; failed: number }>()
  for (const i of inspections.value) {
    if (!inWindow(i.inspected_at)) continue
    const k = i.inspector_name?.trim() || 'Not recorded'
    const row = m.get(k) ?? { total: 0, passed: 0, failed: 0 }
    row.total++
    if (isPass(i)) row.passed++
    else if (isFail(i)) row.failed++
    m.set(k, row)
  }
  return [...m.entries()].map(([name, r]) => ({ name, ...r })).sort((a, b) => b.total - a.total)
})

const enfByType = computed(() => {
  const m = new Map<string, number>()
  for (const o of enforcement.value) if (inWindow(o.issued_at)) m.set(o.order_type, (m.get(o.order_type) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
})
const enfMax = computed(() => Math.max(1, ...enfByType.value.map(([, v]) => v)))

const completeness = computed(() => {
  const notes: string[] = []
  if (truncated.value) notes.push(`covers the most recent ${PERMIT_PAGE} permits only`)
  if (unreadable.value) notes.push(`${unreadable.value} permit record(s) could not be read`)
  if (complaintsError.value) notes.push('EXCLUDES public reports, which could not be read')
  else if (complaintsTruncated.value) notes.push(`covers the most recent ${PERMIT_PAGE} public reports only`)
  return notes
})

function exportPdf() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const r = range.value
  const s = stats.value
  let y = 18
  const line = (text: string, x = 14, size = 10, bold = false) => {
    if (y > 280) { doc.addPage(); y = 18 }
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.text(text, x, y); y += size * 0.5 + 1.5
  }
  line('Vungu Rural District Council', 14, 15, true)
  line('Building Inspectorate — periodic return to Council', 14, 12)
  line(`Reporting period: ${r.label} (${r.from.toLocaleDateString('en-GB')} – ${r.to.toLocaleDateString('en-GB')})`)
  line(`Generated ${new Date().toLocaleString('en-GB')}`)
  if (completeness.value.length) line(`INCOMPLETE: this return ${completeness.value.join('; ')}.`, 14, 10, true)
  y += 3
  line('Headline figures', 14, 12, true)
  for (const [k, v] of [
    ['New permits registered', s.newPermits], ['Stage inspections carried out', s.inspections],
    ['Passed (incl. conditional)', s.passed], ['Failed / reinspection required', s.failed],
    ['Pass rate', s.passRate === null ? 'n/a' : `${s.passRate}%`], ['Re-inspections', s.reinspections],
    ['Enforcement orders issued', s.enforcement], ['Of which still open', s.enfOpen],
    ['Of which complied', s.enfComplied], ['Older open orders (backlog)', s.backlog],
    ['Certificates of Occupation issued', s.certs],
    ['Public reports received', s.complaints],
    ['Of which substantiated', s.complaintsSubstantiated],
    ['Of which not borne out', s.complaintsUnsubstantiated],
    ['Public reports outstanding', s.complaintsOpen],
  ] as const) line(`${k}: ${v}`, 18)
  y += 3
  line('Inspections by stage', 14, 12, true)
  for (const st of byStage.value) line(`Stage ${st.n} ${st.name}: ${st.total} inspected · ${st.passed} passed · ${st.failed} failed${st.rate === null ? '' : ` · ${st.rate}%`}`, 18, 9)
  y += 3
  line('Inspections by officer', 14, 12, true)
  if (!byOfficer.value.length) line('No inspections recorded in this period.', 18, 9)
  for (const o of byOfficer.value) line(`${o.name}: ${o.total} inspected · ${o.passed} passed · ${o.failed} failed`, 18, 9)
  y += 3
  line('Enforcement by order type', 14, 12, true)
  if (!enfByType.value.length) line('No enforcement orders issued in this period.', 18, 9)
  for (const [k, v] of enfByType.value) line(`${k.replace(/_/g, ' ')}: ${v}`, 18, 9)
  doc.save(`building-inspectorate-return-${r.label.replace(/\s+/g, '-')}.pdf`)
  fb.showToast('Return downloaded.', 'success')
}
</script>

<template>
  <div class="ins-page rp">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Office</span>
        <h2 class="ins-title">Reports</h2>
        <p class="ins-lede">The periodic return to Council for {{ range.label }}.</p>
      </div>
      <div class="ins-actions">
        <div class="ins-seg" role="radiogroup" aria-label="Reporting period">
          <button v-for="w in WINDOWS" :key="w.key" type="button" role="radio"
                  :aria-checked="reportWindow === w.key" @click="reportWindow = w.key">{{ w.label }}</button>
        </div>
        <button type="button" class="ins-iconbtn" :disabled="loading" @click="refresh">
          <RefreshCw :size="14" :class="{ 'ins-spin': loading }" aria-hidden="true" />
          <span class="ent-sr-only">Reload report data</span>
        </button>
        <UiButton variant="primary" size="sm" :disabled="!loaded || loading" @click="exportPdf">
          <template #icon><FileDown :size="14" /></template>
          Export PDF
        </UiButton>
      </div>
    </header>

    <div v-if="loading" class="ins-card rp-progress" role="status" aria-live="polite">
      <span>Gathering stage records · {{ progress.done }} of {{ progress.total || '…' }} permits</span>
      <div class="ins-bar"><span :style="{ '--fill': progress.total ? progress.done / progress.total : 0.04 }" /></div>
    </div>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div><strong>The report could not be built.</strong><p>{{ error }}</p></div>
      <UiButton size="sm" @click="refresh">Retry</UiButton>
    </div>

    <div v-if="loaded && completeness.length" class="ins-banner t-warning" role="status">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div><strong>Figures are a lower bound.</strong>
        <p>This return {{ completeness.join('; ') }}. The exported PDF says the same.</p></div>
    </div>

    <div class="ins-kpis">
      <UiKpi :value="loaded ? stats.inspections : '—'" label="Stage inspections" tone="info">
        <template #icon><ClipboardCheck :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded && stats.passRate !== null ? `${stats.passRate}%` : '—'" label="Pass rate">
        <template #icon><Percent :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? stats.enforcement : '—'" label="Orders issued" :tone="stats.enfOpen ? 'warning' : 'neutral'">
        <template #icon><ShieldAlert :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? stats.certs : '—'" label="Occupation certificates" tone="positive">
        <template #icon><BadgeCheck :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? stats.newPermits : '—'" label="New permits">
        <template #icon><FilePlus2 :size="17" /></template>
      </UiKpi>
      <UiKpi :value="complaintsError ? '?' : (loaded ? stats.complaints : '—')"
             label="Public reports received"
             :tone="complaintsError ? 'warning' : (stats.complaintsOpen ? 'info' : 'neutral')">
        <template #icon><Megaphone :size="17" /></template>
      </UiKpi>
    </div>

    <div class="rp-grid">
      <section class="ins-card rp-wide" aria-labelledby="rp-stage-h">
        <header class="ins-card-head">
          <h3 id="rp-stage-h"><BarChart3 :size="16" aria-hidden="true" /> Inspections by stage</h3>
          <span class="rp-legend"><i class="pass" /> Passed <i class="fail" /> Failed <i class="open" /> No result</span>
        </header>
        <div class="ent-scroll-x">
          <table class="rp-table">
            <thead><tr><th scope="col">Stage</th><th scope="col" class="rp-bar-col">Distribution</th><th scope="col" class="num">Inspected</th><th scope="col" class="num">Passed</th><th scope="col" class="num">Failed</th><th scope="col" class="num">Pass rate</th></tr></thead>
            <tbody>
              <tr v-for="s in byStage" :key="s.n">
                <th scope="row"><span class="rp-n">{{ s.n }}</span> {{ s.name }}</th>
                <td class="rp-bar-col">
                  <div class="rp-stack" :style="{ width: `${s.total / stageMax * 100}%` }" aria-hidden="true">
                    <span class="pass" :style="{ flex: s.passed }" />
                    <span class="fail" :style="{ flex: s.failed }" />
                    <span class="open" :style="{ flex: s.total - s.passed - s.failed }" />
                  </div>
                </td>
                <td class="num">{{ s.total }}</td>
                <td class="num">{{ s.passed }}</td>
                <td class="num">{{ s.failed }}</td>
                <td class="num">{{ s.rate === null ? '—' : `${s.rate}%` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="ins-card" aria-labelledby="rp-off-h">
        <header class="ins-card-head"><h3 id="rp-off-h">By officer</h3></header>
        <p v-if="!byOfficer.length" class="rp-empty">No inspections recorded in this period.</p>
        <table v-else class="rp-table">
          <thead><tr><th scope="col">Officer</th><th scope="col" class="num">Inspected</th><th scope="col" class="num">Passed</th><th scope="col" class="num">Failed</th></tr></thead>
          <tbody>
            <tr v-for="o in byOfficer" :key="o.name">
              <th scope="row">{{ o.name }}</th><td class="num">{{ o.total }}</td><td class="num">{{ o.passed }}</td><td class="num">{{ o.failed }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="ins-card" aria-labelledby="rp-enf-h">
        <header class="ins-card-head"><h3 id="rp-enf-h">Enforcement</h3></header>
        <div class="ins-card-body">
          <dl class="ins-dl rp-enf-dl">
            <div><dt>Issued</dt><dd>{{ stats.enforcement }}</dd></div>
            <div><dt>Still open</dt><dd>{{ stats.enfOpen }}</dd></div>
            <div><dt>Complied</dt><dd>{{ stats.enfComplied }}</dd></div>
            <div><dt>Older backlog</dt><dd>{{ stats.backlog }}</dd></div>
          </dl>
          <p v-if="!enfByType.length" class="rp-empty rp-flush">No orders issued in this period.</p>
          <ul v-else class="rp-types">
            <li v-for="[k, v] in enfByType" :key="k">
              <span class="rp-type">{{ k.replace(/_/g, ' ') }}</span>
              <span class="rp-hbar" aria-hidden="true"><span :style="{ width: `${v / enfMax * 100}%` }" /></span>
              <strong>{{ v }}</strong>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.rp-progress { display: flex; flex-direction: column; gap: var(--ent-s2); padding: var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.rp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s4); align-items: start; }
.rp-wide { grid-column: 1 / -1; }

.rp-legend { display: inline-flex; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.rp-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: var(--ent-s2); }
.pass { background: var(--ent-success); }
.fail { background: var(--ent-danger); }
.open { background: var(--ent-line-strong); }

.rp-table { width: 100%; border-collapse: collapse; font-size: var(--ent-fs-sm); }
.rp-table th, .rp-table td { height: var(--ent-row-h); padding: 0 var(--ent-s4); text-align: left; border-top: 1px solid var(--ent-line); color: var(--ent-text); }
.rp-table thead th { height: var(--ent-row-h-sm); border-top: 0; background: var(--ent-surface-2); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-3); }
.rp-table tbody th { font-weight: var(--ent-fw-medium); white-space: nowrap; }
.rp-table .num { text-align: right; font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; }
.rp-n { display: inline-block; min-width: 1.25rem; font-weight: var(--ent-fw-bold); color: var(--ent-text-3); }
.rp-bar-col { width: 40%; min-width: 8rem; }
/* Width is set once per reporting window from the row's share of the largest
   stage. It is data, not motion — no transition, so no layout animation. */
.rp-stack { display: flex; height: 10px; min-width: 2px; gap: 1px; border-radius: 2px; overflow: hidden; }
.rp-stack span { min-width: 0; }

.rp-empty { margin: 0; padding: var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.rp-flush { padding: var(--ent-s4) 0 0; }
.rp-enf-dl dd { font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); font-variant-numeric: tabular-nums; }
.rp-types { list-style: none; margin: var(--ent-s4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.rp-types li { display: grid; grid-template-columns: 9rem minmax(0, 1fr) 2rem; align-items: center; gap: var(--ent-s3); font-size: var(--ent-fs-sm); }
.rp-type { text-transform: capitalize; color: var(--ent-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-hbar { height: 8px; border-radius: 2px; background: var(--ent-surface-sunken); overflow: hidden; }
.rp-hbar span { display: block; height: 100%; background: var(--ent-accent); }
.rp-types strong { text-align: right; font-variant-numeric: tabular-nums; }

@media (max-width: 1023px) { .rp-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .ins-actions .ins-seg { overflow-x: auto; max-width: 100%; } }
</style>
