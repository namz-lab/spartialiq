<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import jsPDF from 'jspdf'
import { dmApi } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { devTypeLabel } from '@/composables/useApplicationPipeline'
import { useUiFeedback } from '@/composables/useUiFeedback'
import {
  CheckCircle2, XCircle, MinusCircle, Send, ChevronDown, ChevronRight,
  FileDown, AlertTriangle, CheckCircle, ListChecks,
} from 'lucide-vue-next'
import ZoningAssessmentCard from './ZoningAssessmentCard.vue'
import SurveyRequestsCard from './SurveyRequestsCard.vue'
import { buildZoningEntry, type ZoningApplyPayload } from '@/services/developmentControl'
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS } from './dueDiligenceChecks'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()

// Departments / utilities are typed in by the officer per consultation —
// they're not a fixed list. A future council admin tool can populate a
// suggestions endpoint; until then, free text.

function ensureBuckets() {
  if (!current.value) return
  const dd = current.value.dueDiligence
  for (const [k] of FILE_CHECKS)    if (!dd.fileChecks[k])      dd.fileChecks[k]      = { result: null, notes: '' }
  for (const [k] of COMPAT_CHECKS)  if (!dd.compatibility[k])   dd.compatibility[k]   = { result: null, notes: '' }
  for (const [k] of STATUTE_CHECKS) if (!dd.statutoryChecks[k]) dd.statutoryChecks[k] = { result: null, notes: '' }
}
onMounted(ensureBuckets)

type Bucket = 'fileChecks'|'compatibility'|'statutoryChecks'

function setResult(bucket: Bucket, key: string, value: 'pass'|'fail'|'na') {
  if (!current.value) return
  const existing = current.value.dueDiligence[bucket][key] ?? { result: null, notes: '' }
  current.value.dueDiligence[bucket][key] = { ...existing, result: value }
  save()
}

function updateNotes(bucket: Bucket, key: string, notes: string) {
  if (!current.value) return
  const existing = current.value.dueDiligence[bucket][key] ?? { result: null, notes: '' }
  current.value.dueDiligence[bucket][key] = { ...existing, notes }
  save()
}

function onApplyZoning(payload: ZoningApplyPayload) {
  if (!current.value) return
  const entry = buildZoningEntry(payload)
  current.value.dueDiligence.compatibility.zoning = { result: entry.result, notes: entry.notes }
  current.value.dueDiligence.zoningAssessment = entry.snapshot
  save()
  fb.showToast(`Zoning applied: ${payload.selectedGroupName}`, 'success')
}

// Per-item notes are collapsed by default. Click "Notes" to expand a row.
const expanded = reactive<Record<string, boolean>>({})
const rowKey = (b: Bucket, k: string) => `${b}/${k}`

// ── Live summary ────────────────────────────────────────────────────
type Tally = { pass:number; fail:number; na:number; pending:number }

function tally(bucket: Record<string, { result: string|null }>, expected: number): Tally {
  const t: Tally = { pass:0, fail:0, na:0, pending:0 }
  const seen = new Set<string>()
  for (const [k, v] of Object.entries(bucket)) {
    seen.add(k)
    if      (v.result === 'pass') t.pass++
    else if (v.result === 'fail') t.fail++
    else if (v.result === 'na')   t.na++
    else                          t.pending++
  }
  // Items the user hasn't touched yet count as pending.
  t.pending += Math.max(0, expected - seen.size)
  return t
}

const summary = computed(() => {
  if (!current.value) return null
  const dd = current.value.dueDiligence
  const file   = tally(dd.fileChecks,      FILE_CHECKS.length)
  const compat = tally(dd.compatibility,   COMPAT_CHECKS.length)
  const stat   = tally(dd.statutoryChecks, STATUTE_CHECKS.length)
  const total: Tally = {
    pass:    file.pass    + compat.pass    + stat.pass,
    fail:    file.fail    + compat.fail    + stat.fail,
    na:      file.na      + compat.na      + stat.na,
    pending: file.pending + compat.pending + stat.pending,
  }
  const totalItems = FILE_CHECKS.length + COMPAT_CHECKS.length + STATUTE_CHECKS.length
  const completedItems = totalItems - total.pending
  const percentComplete = Math.round((completedItems / totalItems) * 100)
  let verdict: 'pending'|'pass'|'fail_with_concerns'|'pass_with_concerns'
  if (total.pending > 0)                                verdict = 'pending'
  else if (total.fail >= 3)                             verdict = 'fail_with_concerns'
  else if (total.fail > 0 || dd.titleDeedConflict.hasConflict) verdict = 'pass_with_concerns'
  else                                                  verdict = 'pass'
  return { file, compat, stat, total, totalItems, completedItems, percentComplete, verdict }
})

const verdictLabel: Record<'pending'|'pass'|'fail_with_concerns'|'pass_with_concerns', string> = {
  pending:             'Due diligence in progress',
  pass:                'Clear — no non-conformances',
  pass_with_concerns:  'Pass with concerns to disclose',
  fail_with_concerns:  'Material non-conformances flagged',
}

// ── External referrals ──────────────────────────────────────────────
const referralPick = ref<string>('')
const referralResponse = ref('')
async function addReferral() {
  if (!current.value?.permitId || !referralPick.value) return
  try {
    // Send `body_name` (the statutory consultation column); `department` is
    // kept as a tolerated alias. Previously only `department` was sent, which
    // the backend rejected with 400 — referral creation was silently broken.
    const created = await dmApi.createConsultation(current.value.permitId, {
      department: referralPick.value,
      body_name: referralPick.value,
      response_notes: referralResponse.value,
      outcome: 'pending',
    } as any)
    current.value.dueDiligence.referrals.push({
      department: referralPick.value,
      contactedAt: (created as any).circulated_at ?? (created as any).created_at ?? new Date().toISOString(),
      response: referralResponse.value,
      outcome: 'pending',
    })
    referralPick.value = ''
    referralResponse.value = ''
    save()
    fb.showToast('Referral logged', 'success')
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not log referral',
      message: fb.parseApiError(e, 'The server rejected the referral.') })
  }
}

// ── Completion & report generation ──────────────────────────────────
const allChecksDone = computed(() => summary.value?.total.pending === 0)

// Survey gate — subdivision/consolidation cases require an accepted
// surveyor report before due diligence can complete (RTCP Act s.40).
// Populated by SurveyRequestsCard via @gate-change.
const surveyGate = ref({ required: false, satisfied: true })
const surveyGateOk = computed(() => !surveyGate.value.required || surveyGate.value.satisfied)
const canComplete = computed(() => allChecksDone.value && surveyGateOk.value)

function markComplete() {
  if (!current.value) return
  if (!allChecksDone.value) {
    fb.openMessageBox({ kind:'warn', title:'Checks incomplete',
      message:'Every file / compatibility / statutory check must be marked Pass, Fail, or N/A before completion.' })
    return
  }
  if (!surveyGateOk.value) {
    fb.openMessageBox({ kind:'warn', title:'Survey report outstanding',
      message:'This application requires a cadastral survey. Request the survey below and accept the surveyor\'s report before completing due diligence.' })
    return
  }
  current.value.dueDiligence.completedAt = new Date().toISOString()
  save()
  fb.showToast('Due diligence complete — Step 3 unlocked', 'success')
}

function resultLabel(r: string|null): string {
  if (r === 'pass') return 'Pass'
  if (r === 'fail') return 'Fail'
  if (r === 'na')   return 'N/A'
  return 'Pending'
}

function generateReport() {
  if (!current.value) return
  const c = current.value
  const s = summary.value
  if (!s) return
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  let y = 14
  const lineHeight = 6

  function ensureSpace(needed: number) {
    if (y + needed > doc.internal.pageSize.getHeight() - 14) {
      doc.addPage(); y = 14
    }
  }
  function writeLine(text: string, opts: { bold?: boolean; size?: number; color?: [number,number,number] } = {}) {
    const { bold = false, size = 10, color = [15,23,42] as [number,number,number] } = opts
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lines = doc.splitTextToSize(text, pageW - 28)
    ensureSpace(lines.length * lineHeight)
    doc.text(lines, 14, y); y += lines.length * lineHeight
  }
  function divider() { ensureSpace(4); doc.setDrawColor(226,232,240); doc.line(14, y, pageW - 14, y); y += 4 }

  // ── Header ────────────────────────────────────────────────────
  writeLine('DUE DILIGENCE REPORT', { bold:true, size:14 })
  writeLine(`Section 26 RTCP Act [Ch. 29:12] — Vungu RDC`, { size:9, color:[100,116,139] })
  y += 2; divider()

  // ── Particulars ───────────────────────────────────────────────
  writeLine('Application Particulars', { bold:true, size:11 })
  writeLine(`Registration no:  ${c.registrationNo || '—'}`)
  writeLine(`Applicant:        ${c.applicant.name || '—'}  (ID ${c.applicant.idNumber || '—'})`)
  writeLine(`Stand / ward:     ${c.property.standNo || '—'} — ${c.property.ward || '—'}`)
  writeLine(`Proposal:         ${devTypeLabel(c.proposal.devType)} — ${(c.proposal.description || '—').slice(0,80)}`)
  writeLine(`Estimated cost:   USD ${c.proposal.estimatedCost.toLocaleString()}`)
  writeLine(`Acknowledged:     ${c.acknowledgedDate?.slice(0,10) ?? '—'}    Expiry: ${c.expiryDate?.slice(0,10) ?? '—'}`)
  y += 2; divider()

  // ── Summary verdict ───────────────────────────────────────────
  writeLine('Overall Verdict', { bold:true, size:11 })
  writeLine(verdictLabel[s.verdict], { bold:true, size:11,
    color: s.verdict === 'pass'                ? [22,163,74]
         : s.verdict === 'pass_with_concerns'  ? [180,83,9]
         : s.verdict === 'fail_with_concerns'  ? [220,38,38]
         :                                       [100,116,139] })
  writeLine(`Pass ${s.total.pass}   Fail ${s.total.fail}   N/A ${s.total.na}   Pending ${s.total.pending}   (${s.completedItems}/${s.totalItems} items, ${s.percentComplete}% complete)`)
  y += 2; divider()

  // ── Detail sections ───────────────────────────────────────────
  function renderBucket(title: string, items: ReadonlyArray<readonly [string,string]>, bucket: Bucket) {
    writeLine(title, { bold:true, size:11 })
    for (const [key, label] of items) {
      const row = c.dueDiligence[bucket][key] ?? { result: null, notes: '' }
      const tag = `[${resultLabel(row.result).toUpperCase()}]`
      writeLine(`${tag}  ${label}`, { bold:true, size:9.5 })
      if (row.notes && row.notes.trim()) {
        writeLine(`    ${row.notes.trim()}`, { size:9, color:[71,85,105] })
      }
    }
    y += 2; divider()
  }
  renderBucket('File Checks',         FILE_CHECKS,    'fileChecks')
  renderBucket('Compatibility Checks',COMPAT_CHECKS,  'compatibility')
  renderBucket('Statutory Provisions',STATUTE_CHECKS, 'statutoryChecks')

  // ── Title deed ─────────────────────────────────────────────────
  writeLine('Title Deed Verification', { bold:true, size:11 })
  const td = c.dueDiligence.titleDeedConflict
  if (td.hasConflict) {
    writeLine('Conflict with title-deed conditions identified.', { bold:true, color:[180,83,9] })
    writeLine(`Deed photostat on file: ${td.deedFileName || '— (not yet attached)'}`)
    writeLine(`Bondholder consent received: ${td.bondholderConsentReceived ? 'YES' : 'NO'}`)
  } else {
    writeLine('No conflict with title-deed conditions.')
  }
  y += 2; divider()

  // ── Referrals ─────────────────────────────────────────────────
  writeLine('External Referrals', { bold:true, size:11 })
  if (!c.dueDiligence.referrals.length) {
    writeLine('No external referrals issued.')
  } else {
    for (const r of c.dueDiligence.referrals) {
      writeLine(`• ${r.department}  —  ${r.outcome}  (${new Date(r.contactedAt).toLocaleDateString()})`, { size:9.5 })
      if (r.response && r.response.trim()) {
        writeLine(`    ${r.response.trim()}`, { size:9, color:[71,85,105] })
      }
    }
  }
  y += 2; divider()

  // ── Sign-off ──────────────────────────────────────────────────
  writeLine('Officer Sign-off', { bold:true, size:11 })
  writeLine(`Compiled by: ${c.permit.issuingOfficer || '—'}`)
  writeLine(`Date: ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`)
  writeLine(`Status: ${c.dueDiligence.completedAt
              ? 'Due diligence complete — ' + new Date(c.dueDiligence.completedAt).toLocaleString()
              : 'DRAFT — not yet marked complete'}`,
    { color: c.dueDiligence.completedAt ? [22,163,74] : [180,83,9] })

  doc.save(`due-diligence-${c.registrationNo || c.permitId || 'draft'}.pdf`)
  fb.showToast('Due diligence report exported', 'success')
}
</script>

<template>
  <div v-if="current" class="step2">
    <!-- ── Case header ────────────────────────────────────────── -->
    <section class="dd-header">
      <div class="dd-header-top">
        <div class="dd-header-id">
          <h1 class="dd-h1">Stand {{ current.property.standNo || '—' }}<template v-if="current.property.ward">, {{ current.property.ward }}</template></h1>
          <div class="dd-header-tags">
            <span class="dd-ref">{{ current.registrationNo || current.permitId || 'DRAFT' }}</span>
            <span class="dd-devtype">{{ devTypeLabel(current.proposal.devType) }}</span>
          </div>
        </div>
        <div class="dd-header-actions">
          <button class="dd-hbtn ghost" @click="generateReport"><FileDown :size="15" /> Print brief</button>
        </div>
      </div>
      <div class="dd-header-grid">
        <div><label>Applicant</label><p>{{ current.applicant.name || '—' }}</p><span v-if="current.applicant.idNumber">ID {{ current.applicant.idNumber }}</span></div>
        <div><label>Development type</label><p class="dd-cap">{{ devTypeLabel(current.proposal.devType) }}</p></div>
        <div><label>Estimated cost</label><p>USD {{ Number(current.proposal.estimatedCost || 0).toLocaleString() }}</p></div>
      </div>
    </section>

    <!-- ── Summary card ───────────────────────────────────────── -->
    <section v-if="summary" class="dd-summary" :class="'verdict-' + summary.verdict">
      <div class="dd-sum-head">
        <component :is="summary.verdict === 'pass' ? CheckCircle
                      : summary.verdict === 'fail_with_concerns' ? XCircle
                      : summary.verdict === 'pass_with_concerns' ? AlertTriangle
                      : ListChecks" :size="16" />
        <strong>{{ verdictLabel[summary.verdict] }}</strong>
        <span class="dd-sum-pct">{{ summary.percentComplete }}% complete</span>
      </div>
      <div class="dd-sum-bar">
        <div class="dd-sum-fill" :style="{ width: summary.percentComplete + '%' }"></div>
      </div>
      <div class="dd-sum-tallies">
        <span class="dd-pill pass">Pass {{ summary.total.pass }}</span>
        <span class="dd-pill fail">Fail {{ summary.total.fail }}</span>
        <span class="dd-pill na">N/A {{ summary.total.na }}</span>
        <span class="dd-pill pending">Pending {{ summary.total.pending }}</span>
        <span class="dd-sum-meta">{{ summary.completedItems }} / {{ summary.totalItems }} items</span>
      </div>
      <div class="dd-sum-actions">
        <button class="dd-report-btn" @click="generateReport">
          <FileDown :size="13" /> Generate Due Diligence Report (PDF)
        </button>
      </div>
    </section>

    <section class="dd-card">
      <header>File checks</header>
      <table class="dd-table">
        <template v-for="[key, label] in FILE_CHECKS" :key="key">
          <tr>
            <td class="dd-label">{{ label }}</td>
            <td class="dd-actions">
              <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'pass' }"
                      @click="setResult('fileChecks', key, 'pass')"><CheckCircle2 :size="12" /> Pass</button>
              <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'fail' }"
                      @click="setResult('fileChecks', key, 'fail')"><XCircle :size="12" /> Fail</button>
              <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'na' }"
                      @click="setResult('fileChecks', key, 'na')"><MinusCircle :size="12" /> N/A</button>
              <button class="dd-notes-btn" :class="{ active: expanded[rowKey('fileChecks', key)] }"
                      @click="expanded[rowKey('fileChecks', key)] = !expanded[rowKey('fileChecks', key)]">
                <component :is="expanded[rowKey('fileChecks', key)] ? ChevronDown : ChevronRight" :size="11" />
                Notes
              </button>
            </td>
          </tr>
          <tr v-if="expanded[rowKey('fileChecks', key)]" class="dd-notes-row">
            <td colspan="2">
              <textarea
                :value="current.dueDiligence.fileChecks[key]?.notes ?? ''"
                @input="(e) => updateNotes('fileChecks', key, (e.target as HTMLTextAreaElement).value)"
                @change="save"
                rows="2" placeholder="Officer notes (visible in the exported report)…" />
            </td>
          </tr>
        </template>
      </table>
    </section>

    <ZoningAssessmentCard @apply="onApplyZoning" />

    <section class="dd-card">
      <header>Compatibility checks</header>
      <table class="dd-table">
        <template v-for="[key, label] in COMPAT_CHECKS" :key="key">
          <tr>
            <td class="dd-label">{{ label }}</td>
            <td class="dd-actions">
              <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'pass' }"
                      @click="setResult('compatibility', key, 'pass')">Pass</button>
              <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'fail' }"
                      @click="setResult('compatibility', key, 'fail')">Fail</button>
              <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'na' }"
                      @click="setResult('compatibility', key, 'na')">N/A</button>
              <button class="dd-notes-btn" :class="{ active: expanded[rowKey('compatibility', key)] }"
                      @click="expanded[rowKey('compatibility', key)] = !expanded[rowKey('compatibility', key)]">
                <component :is="expanded[rowKey('compatibility', key)] ? ChevronDown : ChevronRight" :size="11" />
                Notes
              </button>
            </td>
          </tr>
          <tr v-if="expanded[rowKey('compatibility', key)]" class="dd-notes-row">
            <td colspan="2">
              <textarea
                :value="current.dueDiligence.compatibility[key]?.notes ?? ''"
                @input="(e) => updateNotes('compatibility', key, (e.target as HTMLTextAreaElement).value)"
                @change="save"
                rows="2" placeholder="Officer notes (visible in the exported report)…" />
            </td>
          </tr>
        </template>
      </table>
    </section>

    <section class="dd-card">
      <header>Statutory provisions</header>
      <table class="dd-table">
        <template v-for="[key, label] in STATUTE_CHECKS" :key="key">
          <tr>
            <td class="dd-label">{{ label }}</td>
            <td class="dd-actions">
              <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'pass' }"
                      @click="setResult('statutoryChecks', key, 'pass')">Compliant</button>
              <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'fail' }"
                      @click="setResult('statutoryChecks', key, 'fail')">Non-compliant</button>
              <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'na' }"
                      @click="setResult('statutoryChecks', key, 'na')">N/A</button>
              <button class="dd-notes-btn" :class="{ active: expanded[rowKey('statutoryChecks', key)] }"
                      @click="expanded[rowKey('statutoryChecks', key)] = !expanded[rowKey('statutoryChecks', key)]">
                <component :is="expanded[rowKey('statutoryChecks', key)] ? ChevronDown : ChevronRight" :size="11" />
                Notes
              </button>
            </td>
          </tr>
          <tr v-if="expanded[rowKey('statutoryChecks', key)]" class="dd-notes-row">
            <td colspan="2">
              <textarea
                :value="current.dueDiligence.statutoryChecks[key]?.notes ?? ''"
                @input="(e) => updateNotes('statutoryChecks', key, (e.target as HTMLTextAreaElement).value)"
                @change="save"
                rows="2" placeholder="Officer notes (visible in the exported report)…" />
            </td>
          </tr>
        </template>
      </table>
    </section>

    <section class="dd-card">
      <header>Title-deed verification</header>
      <label class="dd-check"><input type="checkbox" v-model="current.dueDiligence.titleDeedConflict.hasConflict" @change="save" /> Proposal conflicts with title-deed conditions</label>
      <div v-if="current.dueDiligence.titleDeedConflict.hasConflict" class="dd-conflict">
        <label>Deed photostat filename<input v-model="current.dueDiligence.titleDeedConflict.deedFileName" @change="save" /></label>
        <label class="dd-check"><input type="checkbox" v-model="current.dueDiligence.titleDeedConflict.bondholderConsentReceived" @change="save" /> Bondholder consent received</label>
      </div>
    </section>

    <section class="dd-card">
      <header>External referrals</header>
      <ul class="dd-ref-list">
        <li v-for="(r, i) in current.dueDiligence.referrals" :key="i">
          <strong>{{ r.department }}</strong> — {{ r.outcome }} ({{ new Date(r.contactedAt).toLocaleDateString() }})
        </li>
      </ul>
      <div class="dd-ref-add">
        <input v-model="referralPick" placeholder="Department / utility being referred to" />
        <input v-model="referralResponse" placeholder="Initial response (optional)" />
        <button class="dd-btn ok" :disabled="!referralPick.trim()" @click="addReferral"><Send :size="11" /> Log referral</button>
      </div>
    </section>

    <SurveyRequestsCard @gate-change="surveyGate = $event" />

    <button class="dd-complete" :disabled="!canComplete" @click="markComplete">
      {{ !allChecksDone ? 'Mark every check to enable'
         : !surveyGateOk ? 'Awaiting accepted survey report (required for this application type)'
         : 'Due diligence complete — unlock Step 3' }}
    </button>
  </div>
</template>

<style scoped>
.step2 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }

/* Summary card */
.dd-summary { padding:0.75rem; border-radius:0.5rem; border:1px solid #e2e8f0;
  background:#f8fafc; display:flex; flex-direction:column; gap:0.5rem; }
.dd-summary.verdict-pass               { background:#f0fdf4; border-color:#bbf7d0; }
.dd-summary.verdict-pass_with_concerns { background:#fffbeb; border-color:#fde68a; }
.dd-summary.verdict-fail_with_concerns { background:#fef2f2; border-color:#fecaca; }
.dd-summary.verdict-pending            { background:#f8fafc; border-color:#e2e8f0; }
.dd-sum-head { display:flex; align-items:center; gap:0.4rem; font-size:0.8125rem; color:#0f172a; }
.dd-sum-head strong { flex:1; }
.dd-sum-pct { font-size:0.7rem; color:#64748b; font-weight:600; }
.dd-sum-bar  { height:6px; background:#e2e8f0; border-radius:9999px; overflow:hidden; }
.dd-sum-fill { height:100%; background:#1d4ed8; border-radius:9999px; transition:width 0.3s ease; }
.verdict-pass               .dd-sum-fill { background:#16a34a; }
.verdict-pass_with_concerns .dd-sum-fill { background:#b45309; }
.verdict-fail_with_concerns .dd-sum-fill { background:#dc2626; }
.dd-sum-tallies { display:flex; gap:0.35rem; flex-wrap:wrap; align-items:center; font-size:0.7rem; }
.dd-pill { padding:0.15rem 0.5rem; border-radius:9999px; font-weight:600; }
.dd-pill.pass    { background:#dcfce7; color:#166534; }
.dd-pill.fail    { background:#fee2e2; color:#991b1b; }
.dd-pill.na      { background:#e2e8f0; color:#475569; }
.dd-pill.pending { background:#fef3c7; color:#92400e; }
.dd-sum-meta { margin-left:auto; color:#64748b; }
.dd-sum-actions { display:flex; gap:0.4rem; }
.dd-report-btn { display:inline-flex; align-items:center; gap:0.35rem;
  padding:0.4rem 0.75rem; border:none; border-radius:0.3rem;
  background:#1d4ed8; color:#fff; font-size:0.72rem; font-weight:700; cursor:pointer; }
.dd-report-btn:hover { background:#1e40af; }

/* Cards & tables */
.dd-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.dd-card > header { padding:0.5rem 0.75rem; font-size:0.8125rem; font-weight:600; color:#0f172a;
  border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.dd-table { width:100%; border-collapse:collapse; font-size:0.72rem; }
.dd-table td { padding:0.35rem 0.6rem; border-top:1px solid #f1f5f9; vertical-align:middle; }
.dd-label { color:#475569; }
.dd-actions { display:flex; gap:0.25rem; justify-content:flex-end; flex-wrap:wrap; }
.dd-actions button { display:inline-flex; align-items:center; gap:0.25rem;
  border:1px solid #e2e8f0; background:#fff; color:#475569;
  border-radius:0.3rem; padding:0.2rem 0.5rem; font-size:0.7rem; cursor:pointer; }
.dd-actions button.active { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
.dd-notes-btn { color:#1d4ed8 !important; }
.dd-notes-btn.active { background:#eff6ff !important; color:#1e40af !important; border-color:#bfdbfe !important; }

.dd-notes-row > td { padding:0.25rem 0.6rem 0.5rem; background:#f8fafc; }
.dd-notes-row textarea { width:100%; box-sizing:border-box; font-size:0.7rem;
  padding:0.4rem 0.55rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; outline:none; resize:vertical; font-family:inherit; }

/* Title deed + referrals (unchanged) */
.dd-check { display:flex; align-items:center; gap:0.4rem;
  padding:0.5rem 0.75rem; font-size:0.72rem; color:#475569; }
.dd-conflict { display:flex; flex-direction:column; gap:0.3rem; padding:0 0.75rem 0.75rem; }
.dd-conflict label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.dd-conflict input { font-size:0.72rem; padding:0.3rem 0.45rem;
  border:1px solid #e2e8f0; border-radius:0.3rem; background:#fff; }
.dd-ref-list { list-style:none; padding:0.5rem 0.75rem; margin:0;
  display:flex; flex-direction:column; gap:0.25rem; font-size:0.72rem; color:#475569; }
.dd-ref-add { padding:0.5rem 0.75rem; display:flex; gap:0.3rem; }
.dd-ref-add select, .dd-ref-add input { font-size:0.7rem; padding:0.3rem 0.45rem;
  border:1px solid #e2e8f0; border-radius:0.3rem; background:#fff; }
.dd-ref-add input { flex:1; }
.dd-btn { display:inline-flex; align-items:center; gap:0.2rem;
  background:#16a34a; color:#fff; border:none; border-radius:0.3rem;
  padding:0.3rem 0.55rem; font-size:0.7rem; font-weight:700; cursor:pointer; }
.dd-btn:disabled { opacity:0.5; cursor:not-allowed; }
.dd-complete { margin:0.5rem 0.75rem 0; padding:0.5rem 0.75rem;
  border:none; border-radius:0.375rem; background:#1d4ed8; color:#fff;
  font-size:0.75rem; font-weight:700; cursor:pointer; }
.dd-complete:disabled { background:#94a3b8; cursor:not-allowed; }

/* ── Indigo statutory design system (case header + card upgrades) ── */
.step2 { padding:1rem; gap:1rem; }
.dd-header { background:var(--sw-surface); border:1px solid var(--sw-border-soft); border-radius:var(--sw-radius);
  box-shadow:var(--sw-shadow); padding:1.25rem; }
.dd-header-top { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem;
  padding-bottom:1rem; margin-bottom:1rem; border-bottom:1px solid var(--sw-border-soft); }
.dd-h1 { margin:0 0 0.4rem; font-size:1.2rem; font-weight:700; letter-spacing:-0.01em; color:var(--sw-text); }
.dd-header-tags { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
.dd-ref { font-family:var(--sw-mono); font-size:0.72rem; color:var(--sw-secondary); background:var(--sw-surface-variant); padding:0.1rem 0.45rem; border-radius:var(--sw-radius-sm); }
.dd-devtype { padding:0.1rem 0.5rem; border-radius:9999px; background:var(--sw-secondary-container); color:var(--sw-on-secondary-container); font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; }
.dd-header-actions { display:flex; gap:0.5rem; flex-shrink:0; }
.dd-hbtn { display:inline-flex; align-items:center; gap:0.35rem; padding:0.4rem 0.75rem; border-radius:var(--sw-radius-sm);
  font-size:0.74rem; font-weight:600; cursor:pointer; border:1px solid var(--sw-border-soft); background:var(--sw-surface); color:var(--sw-text); }
.dd-hbtn.ghost:hover { background:var(--sw-surface-2); }
.dd-header-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:1rem; }
.dd-header-grid label { display:block; font-size:0.66rem; color:var(--sw-muted); margin-bottom:0.2rem; }
.dd-header-grid p { margin:0; font-size:0.82rem; color:var(--sw-text); }
.dd-header-grid p.dd-cap { text-transform:capitalize; }
.dd-header-grid span { font-size:0.68rem; color:var(--sw-muted); }

.dd-card, .dd-summary { border-radius:var(--sw-radius); box-shadow:var(--sw-shadow); border-color:var(--sw-border-soft); }
.dd-card > header { background:var(--sw-surface-2); border-color:var(--sw-border-soft); color:var(--sw-text); }
.dd-summary.verdict-pending { background:var(--sw-surface); }
.dd-actions button.active { background:var(--sw-primary-container); border-color:var(--sw-primary-container); }
.dd-report-btn { background:var(--sw-primary-container); }
.dd-report-btn:hover { background:var(--sw-primary); }
.dd-sum-fill { background:var(--sw-primary-container); }
.dd-complete { background:var(--sw-primary-container); border-radius:var(--sw-radius-sm); }
.dd-complete:hover:not(:disabled) { background:var(--sw-primary); }

@media (max-width: 768px) {
  .dd-header-grid { grid-template-columns:1fr; }
  .dd-header-top { flex-direction:column; }
}
</style>
