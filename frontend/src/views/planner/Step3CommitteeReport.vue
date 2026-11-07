<script setup lang="ts">
import { computed } from 'vue'
import jsPDF from 'jspdf'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { dmApi } from '@/services/developmentManagementService'
import { Download, Gavel } from 'lucide-vue-next'
import CaseAuditTrail from './CaseAuditTrail.vue'
import CommitteeScheduleCard from './CommitteeScheduleCard.vue'
import { delegationCheck } from './caseClock'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()

const ddSummary = computed(() => {
  if (!current.value) return ''
  const dd = current.value.dueDiligence
  const failed: string[] = []
  for (const [k, v] of Object.entries(dd.fileChecks))      if (v.result === 'fail') failed.push(`file/${k}`)
  for (const [k, v] of Object.entries(dd.compatibility))   if (v.result === 'fail') failed.push(`compat/${k}`)
  for (const [k, v] of Object.entries(dd.statutoryChecks)) if (v.result === 'fail') failed.push(`statute/${k}`)
  return failed.length
    ? `${failed.length} non-conformance(s) flagged: ${failed.join(', ')}.`
    : 'All due-diligence checks pass with no flagged non-conformances.'
})

function exportPdf() {
  if (!current.value) return
  const c = current.value
  const doc = new jsPDF()
  let y = 14
  const line = (s: string, bold = false) => {
    if (bold) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal')
    doc.text(s, 14, y); y += 6
  }
  doc.setFontSize(13); line(`Works & Planning Committee Report — ${c.registrationNo}`, true)
  doc.setFontSize(10)
  line(`Applicant: ${c.applicant.name}   ID: ${c.applicant.idNumber}`)
  line(`Stand: ${c.property.standNo}   Ward: ${c.property.ward}`)
  line(`Dev type: ${c.proposal.devType}   Estimated cost: USD ${c.proposal.estimatedCost}`)
  line(`Application: ${c.applicationDate.slice(0,10)}   Ack: ${c.acknowledgedDate?.slice(0,10) ?? '—'}`)
  y += 2
  line('Site context', true)
  doc.text(doc.splitTextToSize(c.committeeReport.siteContext || '—', 180), 14, y); y += 18
  line('Policy & statutory analysis', true)
  doc.text(doc.splitTextToSize(c.committeeReport.policyAnalysis || ddSummary.value, 180), 14, y); y += 22
  line('Public response', true)
  doc.text(doc.splitTextToSize(c.committeeReport.publicResponseNotes || '—', 180), 14, y); y += 18
  line(`Recommendation: ${c.committeeReport.recommendation}`, true)
  doc.text(doc.splitTextToSize(c.committeeReport.recommendationReasons || '—', 180), 14, y); y += 18
  if (c.committeeReport.resolutionAt) {
    line(`Council resolution: ${c.committeeReport.resolutionAt.slice(0,10)}`, true)
    doc.text(doc.splitTextToSize(c.committeeReport.resolutionText || '—', 180), 14, y)
  }
  doc.save(`committee-report-${c.registrationNo}.pdf`)
  fb.showToast('Report exported', 'success')
}

// Committee or delegated route. Computed, shown, never enforced: the officer
// may still take a within-delegation case to committee.
const delegation = computed(() => {
  const c = current.value
  if (!c) return { committee: false, reasons: [] as string[] }
  return delegationCheck({
    devType: c.proposal.devType,
    classification: c.classification,
    recommendation: c.committeeReport.recommendation,
    objectionCount: c.notices.objections.length,
  })
})

// The resolution is recorded on the case file. The determination itself is the
// EO's (POST /eo-decision — PATCH /status 403s approved/refused for a planner),
// so approvals go on to Step 4 and refusals to the refusal draft, both of which
// hand the case up. Only a deferral moves the status here.
async function recordResolution() {
  const c = current.value
  if (!c?.permitId) return
  const rec = c.committeeReport.recommendation
  if (rec === 'refuse' && !c.committeeReport.recommendationReasons.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Reasons required', message: 'A refusal must state its planning reasons.' })
    return
  }
  try {
    if (rec === 'defer') {
      const updated = await dmApi.setPermitStatus(c.permitId, 'deferred', {
        expectedRevision: c.revision,
        notes: c.committeeReport.resolutionText || 'Deferred by committee',
      })
      c.revision = updated.revision ?? c.revision + 1
      c.status = updated.status
    }
    c.committeeReport.resolutionAt = new Date().toISOString()
    save()
    fb.showToast(rec === 'refuse' ? 'Resolution recorded. Draft the refusal under Decision.'
      : rec === 'defer' ? 'Deferral recorded'
      : 'Resolution recorded. Draft the permit under Decision.', 'success')
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not record resolution',
      message: fb.parseApiError(e, 'Server rejected the status update.') })
  }
}
</script>

<template>
  <div v-if="current" class="step3">
    <section class="r3-card">
      <header>Application particulars</header>
      <dl class="r3-dl">
        <dt>Reg no</dt><dd>{{ current.registrationNo }}</dd>
        <dt>Applicant</dt><dd>{{ current.applicant.name }} ({{ current.applicant.idNumber }})</dd>
        <dt>Stand</dt><dd>{{ current.property.standNo }} — {{ current.property.ward }}</dd>
        <dt>Type</dt><dd>{{ current.proposal.devType }}, USD {{ current.proposal.estimatedCost }}</dd>
        <dt>Ack date</dt><dd>{{ current.acknowledgedDate?.slice(0,10) || '—' }}</dd>
        <dt>Expiry</dt><dd>{{ current.expiryDate?.slice(0,10) || '—' }}</dd>
      </dl>
    </section>

    <section class="r3-card r3-deleg" :class="{ committee: delegation.committee }">
      <header>{{ delegation.committee ? 'Outside delegation — report to committee' : 'Within delegated authority' }}</header>
      <ul v-if="delegation.reasons.length"><li v-for="r in delegation.reasons" :key="r">{{ r }}</li></ul>
      <p v-else>No objections, and the proposal is not a reserved type. You may decide under delegation: record the authority on the Decision tab and skip the agenda.</p>
    </section>

    <!-- Committee agenda scheduling + hearing recording (backend agenda_item). -->
    <CommitteeScheduleCard :permit-id="current.permitId" />

    <!-- Audit trail: who did what, when, why (backend permit_event log). -->
    <CaseAuditTrail :permit-id="current.permitId" />

    <section class="r3-card">
      <header>Site context</header>
      <textarea v-model="current.committeeReport.siteContext" rows="3" @change="save"
        placeholder="Surrounding land uses, existing services, environmental features…" />
    </section>

    <section class="r3-card">
      <header>Policy & statutory analysis</header>
      <p class="r3-prefill">From Step 2: {{ ddSummary }}</p>
      <textarea v-model="current.committeeReport.policyAnalysis" rows="4" @change="save"
        placeholder="Officer's analysis of conformity with the approved Master/Local Plan…" />
    </section>

    <section class="r3-card">
      <header>Public response</header>
      <textarea v-model="current.committeeReport.publicResponseNotes" rows="3" @change="save"
        placeholder="Summary of objections, applicant's response, officer's view…" />
    </section>

    <section class="r3-card">
      <header>Recommendation</header>
      <div class="r3-radios">
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="approve" @change="save" /> Approve</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="approve_modified" @change="save" /> Approve with modifications</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="refuse" @change="save" /> Refuse</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="defer" @change="save" /> Defer</label>
      </div>
      <textarea v-model="current.committeeReport.recommendationReasons" rows="3" @change="save"
        placeholder="Planning reasons (not personal/political) for the recommendation…" />
    </section>

    <section class="r3-card">
      <header>Council resolution</header>
      <label>Tabled at<input type="date" v-model="current.committeeReport.tabledAt" @change="save" /></label>
      <textarea v-model="current.committeeReport.resolutionText" rows="2" @change="save"
        placeholder="Council resolution text…" />
      <button class="r3-resolve" @click="recordResolution"
              :disabled="!!current.committeeReport.resolutionAt">
        <Gavel :size="12" />
        {{ current.committeeReport.resolutionAt
            ? `Resolved on ${current.committeeReport.resolutionAt.slice(0,10)}`
            : 'Record resolution' }}
      </button>
    </section>

    <button class="r3-export" @click="exportPdf"><Download :size="12" /> Export to PDF</button>
  </div>
</template>

<style scoped>
.step3 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }
.r3-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.r3-card > header { padding:0.5rem 0.75rem; font-size:0.8125rem; font-weight:600;
  color:#0f172a; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.r3-card textarea, .r3-card input { width:calc(100% - 1.5rem); margin:0.5rem 0.75rem;
  font-size:0.72rem; padding:0.4rem 0.55rem; border:1px solid #e2e8f0;
  border-radius:0.3rem; background:#fff; outline:none; box-sizing:border-box; }
.r3-deleg ul, .r3-deleg p { margin:0.5rem 0.75rem; font-size:0.75rem; color:var(--ent-text-2); }
.r3-deleg ul { padding-left:1rem; }
.r3-deleg.committee > header { color:var(--ent-accent); }
.r3-dl { display:grid; grid-template-columns:6rem 1fr; gap:0.3rem 0.75rem;
  margin:0.5rem 0.75rem 0.75rem; font-size:0.72rem; }
.r3-dl dt { color:#94a3b8; }
.r3-dl dd { margin:0; color:#0f172a; }
.r3-prefill { margin:0.5rem 0.75rem; padding:0.4rem 0.55rem; font-size:0.7rem;
  background:#eff6ff; color:#1e3a8a; border-radius:0.3rem; }
.r3-radios { display:flex; flex-wrap:wrap; gap:0.6rem;
  padding:0.5rem 0.75rem; font-size:0.72rem; color:#475569; }
.r3-radios label { display:inline-flex; align-items:center; gap:0.3rem; }
.r3-resolve { display:inline-flex; align-items:center; gap:0.3rem;
  margin:0.5rem 0.75rem 0.75rem; padding:0.35rem 0.6rem;
  border:none; border-radius:0.3rem; background:#1d4ed8; color:#fff;
  font-size:0.72rem; font-weight:700; cursor:pointer; }
.r3-resolve:disabled { background:#16a34a; cursor:default; }
.r3-export { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  margin:0 0.75rem; padding:0.5rem; border:1px solid #e2e8f0; background:#fff;
  color:#475569; border-radius:0.375rem; font-size:0.72rem; font-weight:700; cursor:pointer; }

/* Indigo statutory design system polish (--sw-* from StatutoryShell) */
.step3 { padding:1rem; gap:1rem; }
.r3-card { border-radius:var(--sw-radius); box-shadow:var(--sw-shadow); border-color:var(--sw-border-soft); }
.r3-card > header { background:var(--sw-surface-2); border-color:var(--sw-border-soft); }
.r3-prefill { background:var(--sw-primary-tint); color:var(--sw-primary); }
.r3-resolve { background:var(--sw-primary-container); border-radius:var(--sw-radius-sm); }
.r3-resolve:disabled { background:var(--sw-green); }
</style>
