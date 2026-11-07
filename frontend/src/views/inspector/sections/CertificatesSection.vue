<script setup lang="ts">
// Certificates of Occupation — Annexure 13.
//
// No building may be occupied without a certificate signed by the building
// inspector (By-Laws Sec 46). It follows a final joint inspection with the
// Environmental Health Officer and the plumbing inspector, and every
// construction stage must have passed on its LATEST attempt.
//
// The server enforces the stage gate. This screen shows the whole readiness
// picture before the inspector gets that far — stages, open enforcement on the
// stand, integrity flags and the joint inspection — and records the joint
// inspection in the certificate's notes, because it is a site fact the council
// must be able to show later, not an assumption.
import { computed, ref, watch } from 'vue'
import jsPDF from 'jspdf'
import {
  BadgeCheck, Award, CheckCircle2, AlertTriangle, XCircle, Printer, Stamp, ShieldAlert, Flag, Users,
} from 'lucide-vue-next'
import {
  dmApi, type StageInspection, type EnforcementOrder, type StageInspectionFlag,
} from '@/services/developmentManagementService'
import { issueOccupationCertificateOfficial } from '@/inspector/officialActions'
import { officialEnforcementOpen } from '@/inspector/architecture'
import { stageTimeline } from '@/inspector/caseFile'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import InspectorCasePicker from '@/components/inspector/InspectorCasePicker.vue'

const emit = defineEmits<{ 'open-section': [key: 'stages' | 'enforcement'] }>()

const fb = useUiFeedback()
const ic = useInspectionCase()
const auth = useAuthStore()

const permit = computed(() => ic.current.value?.permit ?? null)
const stages = ref<StageInspection[]>([])
// One source of truth for "has this building been certified", shared with the
// case band and the case file.
const certificate = ic.certificate
const orders = ref<EnforcementOrder[]>([])
const flags = ref<StageInspectionFlag[]>([])
const loading = ref(false)
const stagesError = ref(false)
// A failed enforcement or integrity read is not "nothing outstanding". Falling
// to an empty list here empties `blockers`, and the screen then offers to issue
// a certificate of occupation for a building that may be under an open
// stop-work order — the one document where an unread register must never be
// presented as a clear one.
const ordersError = ref(false)
const flagsError = ref(false)

async function load(permitId: string) {
  loading.value = true
  stagesError.value = false
  ordersError.value = false
  flagsError.value = false
  const p = permit.value
  const [s, o, f] = await Promise.allSettled([
    dmApi.listStageInspections(permitId),
    dmApi.listEnforcement(),
    dmApi.listFlagsForPermit(permitId),
  ])
  if (ic.current.value?.permitId !== permitId) return
  stages.value = s.status === 'fulfilled' ? s.value : []
  stagesError.value = s.status === 'rejected'
  orders.value = o.status === 'fulfilled'
    ? o.value.filter(x => x.permit_application_id === permitId || (!!p && x.stand_number === p.stand_number))
    : []
  ordersError.value = o.status === 'rejected'
  flags.value = f.status === 'fulfilled' ? f.value : []
  flagsError.value = f.status === 'rejected'
  loading.value = false
  resetForm()
}
watch(() => ic.current.value?.permitId, id => { if (id) void load(id) }, { immediate: true })

const construction = computed(() => stageTimeline(stages.value).filter(s => s.n <= 8))
const stagesReady = computed(() => !stagesError.value && construction.value.every(s => s.state === 'passed' || s.state === 'conditional'))
const passedCount = computed(() => construction.value.filter(s => s.state === 'passed' || s.state === 'conditional').length)
const openOrders = computed(() => orders.value.filter(o => officialEnforcementOpen(o.status)))
const openFlags = computed(() => flags.value.filter(f => f.status === 'open' || f.status === 'under_review'))

// ── Issue form ─────────────────────────────────────────────────────────
const form = ref({
  certificateNo: '', occupant: '', use: '', floorArea: '' as string,
  ehoName: '', ehoAttended: false, plumbName: '', plumbAttended: false, jointDate: '',
  conditions: '',
})
const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

function resetForm() {
  const p = permit.value
  form.value = {
    certificateNo: p ? `OC/${new Date().getFullYear()}/${p.stand_number}`.slice(0, 40) : '',
    occupant: p?.applicant_name ?? '',
    use: p ? p.development_type.replace(/_/g, ' ') : '',
    floorArea: p?.plinth_area ? String(p.plinth_area) : '',
    ehoName: '', ehoAttended: false, plumbName: '', plumbAttended: false, jointDate: todayIso,
    conditions: '',
  }
}

const jointReady = computed(() =>
  form.value.ehoAttended && form.value.ehoName.trim().length > 2
  && form.value.plumbAttended && form.value.plumbName.trim().length > 2
  && !!form.value.jointDate && form.value.jointDate <= todayIso)

const blockers = computed(() => {
  const out: string[] = []
  if (!ic.certificateLoaded.value) out.push('Whether a certificate has already been issued could not be confirmed.')
  if (stagesError.value) out.push('The stage record could not be loaded.')
  else if (!stagesReady.value) out.push(`${8 - passedCount.value} construction stage(s) have not passed on their latest attempt.`)
  if (ordersError.value) out.push('Enforcement on this stand could not be read, so it is unknown whether an order is open.')
  else if (openOrders.value.length) out.push(`${openOrders.value.length} enforcement order(s) are still open on this stand.`)
  if (flagsError.value) out.push('Integrity flags on this case could not be read.')
  if (!jointReady.value) out.push('Record the joint inspection with the EHO and plumbing inspector.')
  if (!form.value.certificateNo.trim()) out.push('Enter a certificate number.')
  return out
})

const issuing = ref(false)
async function issue() {
  const p = permit.value
  if (!p || issuing.value || blockers.value.length) return
  const ok = await fb.confirmAction(
    'Issue Certificate of Occupation?',
    `Certificate ${form.value.certificateNo.trim()} for Stand ${p.stand_number} (${p.applicant_name}). The building may lawfully be occupied from today. This cannot be undone from this console.`,
    { confirmLabel: 'Issue certificate' },
  )
  if (!ok) return

  const notes = [
    `Joint final inspection on ${form.value.jointDate}: Environmental Health Officer ${form.value.ehoName.trim()}; plumbing inspector ${form.value.plumbName.trim()}; building inspector ${auth.userName || auth.userEmail}.`,
    form.value.conditions.trim() ? `Conditions: ${form.value.conditions.trim()}` : '',
    openFlags.value.length ? `Note: ${openFlags.value.length} integrity flag(s) were under review at issue.` : '',
  ].filter(Boolean).join('\n')
  const area = Number(form.value.floorArea)

  issuing.value = true
  try {
    const result = await issueOccupationCertificateOfficial({
      permitId: p.id,
      certificateNo: form.value.certificateNo,
      notes,
      building: {
        occupant_name: form.value.occupant.trim() || undefined,
        building_use: form.value.use.trim() || undefined,
        gross_floor_area_sqm: Number.isFinite(area) && area > 0 ? area : undefined,
      },
      issueCertificate: (id, data) => dmApi.issueCertificate(id, data),
    })
    if (!result.ok) {
      const already = /certificate_already_issued/.test(result.error)
      fb.openMessageBox({
        kind: 'error',
        title: 'Certificate was not issued',
        message: already ? 'A certificate has already been issued for this permit.'
          : `${result.error}${result.missingStages?.length ? ` Outstanding stages: ${result.missingStages.join(', ')}.` : ''}`,
      })
      if (already) { await ic.refreshCertificate(); await load(p.id) }
      return
    }
    fb.showToast('Certificate of Occupation issued.', 'success')
    // Read back what the server recorded rather than assuming what was written.
    await ic.refreshCertificate()
    await load(p.id)
    await ic.loadPermit(p.id)
  } finally {
    issuing.value = false
  }
}

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
const officer = computed(() =>
  certificate.value?.issued_by && certificate.value.issued_by === String(auth.user?.id ?? '')
    ? auth.userName : 'Building Inspector, Vungu RDC')

function printCertificate() {
  const p = permit.value
  const c = certificate.value
  if (!p || !c) return
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  doc.setDrawColor(40); doc.setLineWidth(0.6); doc.rect(12, 12, W - 24, 273)
  doc.setLineWidth(0.2); doc.rect(14, 14, W - 28, 269)

  let y = 30
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('VUNGU RURAL DISTRICT COUNCIL', W / 2, y, { align: 'center' }); y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text('Model Building By-Laws, 1977  ·  Annexure 13', W / 2, y, { align: 'center' }); y += 14
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('CERTIFICATE OF OCCUPATION', W / 2, y, { align: 'center' }); y += 8
  doc.setFont('courier', 'normal'); doc.setFontSize(11)
  doc.text(`No. ${c.certificate_no}`, W / 2, y, { align: 'center' }); y += 16

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  const body = `This is to certify that the building erected on the stand described below has been inspected by the Council and found to comply with the Model Building By-Laws and the approved building plan, and may be occupied for the use stated from ${fmt(c.issued_at)}.`
  const lines = doc.splitTextToSize(body, W - 48)
  doc.text(lines, 24, y); y += lines.length * 6 + 8

  const rows: [string, string][] = [
    ['Stand', `${p.stand_number}${p.suburb_ward ? `, ${p.suburb_ward}` : ''}`],
    ['Owner', p.applicant_name],
    ['Occupant', c.occupant_name || p.applicant_name],
    ['Building use', String(c.building_use || p.development_type.replace(/_/g, ' '))],
    ['Gross floor area', c.gross_floor_area_sqm ? `${c.gross_floor_area_sqm} m²` : '—'],
    ['Development register no', p.dev_register_no || '—'],
    ['Date of issue', fmt(c.issued_at)],
  ]
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold'); doc.text(k, 24, y)
    doc.setFont('helvetica', 'normal'); doc.text(v, 80, y)
    doc.setDrawColor(200); doc.line(24, y + 2, W - 24, y + 2)
    y += 9
  }
  if (c.notes) {
    y += 4
    doc.setFont('helvetica', 'bold'); doc.text('Record', 24, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    const n = doc.splitTextToSize(c.notes, W - 48)
    doc.text(n, 24, y); y += n.length * 5
    doc.setFontSize(11)
  }
  const sy = 250
  doc.setDrawColor(40)
  doc.line(24, sy, 90, sy); doc.line(W - 90, sy, W - 24, sy)
  doc.setFontSize(9)
  doc.text(officer.value || 'Building Inspector', 24, sy + 5)
  doc.text('Issuing officer', 24, sy + 10)
  doc.text('Council stamp', W - 90, sy + 5)
  doc.save(`certificate-of-occupation-${c.certificate_no.replace(/[^\w-]+/g, '-')}.pdf`)
}
</script>

<template>
  <div class="ins-page oc">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Compliance</span>
        <h2 class="ins-title">Occupation certificates</h2>
        <p class="ins-lede">Annexure 13. Issued after stages 1–8 pass and a joint final inspection with the Environmental Health Officer and plumbing inspector.</p>
      </div>
    </header>

    <div class="ins-split">
      <div class="ins-sticky">
        <InspectorCasePicker heading="Approved permits" />
      </div>

      <div v-if="!permit" class="ins-card oc-none">
        <Award :size="28" aria-hidden="true" />
        <h3>Choose a permit</h3>
        <p>Its readiness for a Certificate of Occupation is checked against the council's stage record.</p>
      </div>

      <div v-else-if="loading && !certificate && !stages.length" class="ins-card oc-skel" aria-busy="true">
        <span v-for="n in 4" :key="n" class="ins-skel" />
      </div>

      <!-- ISSUED -->
      <article v-else-if="certificate" class="ins-card oc-cert">
        <div class="oc-cert-seal" aria-hidden="true"><BadgeCheck :size="30" /></div>
        <p class="oc-cert-eyebrow">Vungu Rural District Council · Annexure 13</p>
        <h3 class="oc-cert-title">Certificate of Occupation</h3>
        <p class="oc-cert-no ins-mono">No. {{ certificate.certificate_no }}</p>
        <p class="oc-cert-body">
          The building on <strong>Stand {{ permit.stand_number }}<template v-if="permit.suburb_ward">, {{ permit.suburb_ward }}</template></strong>,
          owned by <strong>{{ permit.applicant_name }}</strong>, has been inspected and found to comply with the Model
          Building By-Laws and the approved plan, and may be occupied from <strong>{{ fmt(certificate.issued_at) }}</strong>.
        </p>
        <dl class="ins-dl oc-cert-dl">
          <div><dt>Occupant</dt><dd>{{ certificate.occupant_name || permit.applicant_name }}</dd></div>
          <div><dt>Use</dt><dd class="oc-cap">{{ certificate.building_use || permit.development_type.replace(/_/g, ' ') }}</dd></div>
          <div><dt>Floor area</dt><dd>{{ certificate.gross_floor_area_sqm ? `${certificate.gross_floor_area_sqm} m²` : '—' }}</dd></div>
          <div><dt>Issued by</dt><dd>{{ officer }}</dd></div>
        </dl>
        <p v-if="certificate.notes || certificate.conditions" class="oc-cert-notes">{{ certificate.notes || certificate.conditions }}</p>
        <div class="oc-cert-actions">
          <UiButton variant="primary" @click="printCertificate">
            <template #icon><Printer :size="15" /></template>
            Download certificate
          </UiButton>
        </div>
      </article>

      <!-- READINESS + ISSUE -->
      <div v-else class="oc-body">
        <section class="ins-card" aria-labelledby="oc-ready-h">
          <header class="ins-card-head">
            <h3 id="oc-ready-h"><Stamp :size="16" aria-hidden="true" /> Readiness · Stand {{ permit.stand_number }}</h3>
            <UiStatusBadge v-if="!blockers.length" tone="positive" label="Ready to issue" />
            <UiStatusBadge v-else tone="neutral" :label="`${passedCount} of 8 stages`" />
          </header>
          <div class="ins-card-body oc-ready">
            <p v-if="!ic.certificateLoaded.value" class="ins-banner t-negative" role="alert">
              <AlertTriangle :size="16" aria-hidden="true" />
              The certificate register could not be read, so this building's certificate status is unknown — not "none issued". Retry before issuing anything.
            </p>
            <p v-if="stagesError" class="ins-banner t-negative" role="alert">
              <AlertTriangle :size="16" aria-hidden="true" /> The stage record could not be loaded, so readiness is unknown.
            </p>
            <ol v-else class="oc-stages" aria-label="Construction stages">
              <li v-for="s in construction" :key="s.n" :class="s.state">
                <CheckCircle2 v-if="s.state === 'passed' || s.state === 'conditional'" :size="15" aria-hidden="true" />
                <XCircle v-else-if="s.state === 'failed'" :size="15" aria-hidden="true" />
                <span v-else class="oc-dot" aria-hidden="true" />
                <span class="oc-stage-n">{{ s.n }}</span>
                <span class="oc-stage-name">{{ s.name }}</span>
                <span class="ent-sr-only">{{ s.state.replace('_', ' ') }}</span>
              </li>
            </ol>
            <div v-if="!stagesReady && !stagesError" class="oc-inline">
              <span>Stages must pass on their latest attempt before a certificate can issue.</span>
              <UiButton size="sm" variant="ghost" @click="emit('open-section', 'stages')">Go to inspections</UiButton>
            </div>
            <div v-if="openOrders.length" class="ins-banner t-negative">
              <ShieldAlert :size="16" aria-hidden="true" />
              <div><strong>Open enforcement on this stand.</strong>
                <p>{{ openOrders.map(o => o.order_reference).join(', ') }}. Confirm compliance before issuing.</p></div>
              <UiButton size="sm" @click="emit('open-section', 'enforcement')">Enforcement</UiButton>
            </div>
            <div v-if="openFlags.length" class="ins-banner t-warning">
              <Flag :size="16" aria-hidden="true" />
              <div><strong>{{ openFlags.length }} integrity flag(s) under review.</strong>
                <p>They will be noted on the certificate record.</p></div>
            </div>
          </div>
        </section>

        <section class="ins-card" aria-labelledby="oc-joint-h">
          <header class="ins-card-head">
            <h3 id="oc-joint-h"><Users :size="16" aria-hidden="true" /> Joint final inspection</h3>
            <UiStatusBadge :tone="jointReady ? 'positive' : 'neutral'" :label="jointReady ? 'Recorded' : 'Required'" />
          </header>
          <div class="ins-card-body ins-form">
            <label class="ins-check" :class="{ on: form.ehoAttended }">
              <input v-model="form.ehoAttended" type="checkbox" />
              <span><strong>Environmental Health Officer attended</strong><small>Sanitary and drainage sign-off (Public Health Act, Sec 38).</small></span>
            </label>
            <label class="ins-field">
              <span class="ins-label">EHO name</span>
              <input v-model="form.ehoName" class="ins-input" autocomplete="off" />
            </label>
            <label class="ins-check" :class="{ on: form.plumbAttended }">
              <input v-model="form.plumbAttended" type="checkbox" />
              <span><strong>Plumbing inspector attended</strong><small>Water supply and sanitary fittings.</small></span>
            </label>
            <label class="ins-field">
              <span class="ins-label">Plumbing inspector name</span>
              <input v-model="form.plumbName" class="ins-input" autocomplete="off" />
            </label>
            <label class="ins-field">
              <span class="ins-label">Date of joint inspection</span>
              <input v-model="form.jointDate" class="ins-input" type="date" :max="todayIso" />
            </label>
          </div>
        </section>

        <section class="ins-card" aria-labelledby="oc-issue-h">
          <header class="ins-card-head">
            <h3 id="oc-issue-h"><Award :size="16" aria-hidden="true" /> Certificate details</h3>
          </header>
          <div class="ins-card-body ins-form">
            <label class="ins-field">
              <span class="ins-label">Certificate number</span>
              <input v-model="form.certificateNo" class="ins-input ins-mono" maxlength="40" />
            </label>
            <label class="ins-field">
              <span class="ins-label">Occupant</span>
              <input v-model="form.occupant" class="ins-input" />
            </label>
            <label class="ins-field">
              <span class="ins-label">Building use</span>
              <input v-model="form.use" class="ins-input" />
            </label>
            <label class="ins-field">
              <span class="ins-label">Gross floor area (m²)</span>
              <input v-model="form.floorArea" class="ins-input" type="number" min="0" step="0.1" inputmode="decimal" />
            </label>
            <label class="ins-field full">
              <span class="ins-label">Conditions (optional)</span>
              <textarea v-model="form.conditions" class="ins-input" rows="3" placeholder="Any condition attached to occupation"></textarea>
            </label>
          </div>
          <footer class="ins-card-foot oc-foot">
            <ul v-if="blockers.length" class="oc-blockers">
              <li v-for="b in blockers" :key="b"><AlertTriangle :size="13" aria-hidden="true" /> {{ b }}</li>
            </ul>
            <UiButton variant="primary" :loading="issuing" :disabled="blockers.length > 0" @click="issue">
              <template #icon><Stamp :size="15" /></template>
              Issue certificate
            </UiButton>
          </footer>
        </section>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.oc-none { display: flex; flex-direction: column; align-items: center; gap: var(--ent-s2); padding: var(--ent-s8) var(--ent-s5); text-align: center; color: var(--ent-text-3); }
.oc-none h3 { margin: 0; font-size: var(--ent-fs-md); color: var(--ent-text); }
.oc-none p { margin: 0; font-size: var(--ent-fs-sm); max-width: 40ch; }
.oc-skel { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s5); }
.oc-skel .ins-skel { height: 40px; }
.oc-body { display: flex; flex-direction: column; gap: var(--ent-s4); min-width: 0; }
.oc-cap { text-transform: capitalize; }

.oc-ready { display: flex; flex-direction: column; gap: var(--ent-s3); }
.oc-stages { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: var(--ent-s2); }
.oc-stages li {
  display: flex; align-items: center; gap: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r); font-size: var(--ent-fs-sm); color: var(--ent-text-2);
}
.oc-stages li.passed, .oc-stages li.conditional { border-color: var(--ent-tone-positive-line); background: var(--ent-success-soft); color: var(--ent-text); }
.oc-stages li.passed svg, .oc-stages li.conditional svg { color: var(--ent-success); }
.oc-stages li.failed { border-color: var(--ent-tone-negative-line); background: var(--ent-danger-soft); }
.oc-stages li.failed svg { color: var(--ent-danger); }
.oc-dot { width: 13px; height: 13px; margin: 0 1px; border: 2px dashed var(--ent-line-strong); border-radius: 50%; flex-shrink: 0; }
.oc-stage-n { font-weight: var(--ent-fw-bold); font-variant-numeric: tabular-nums; }
.oc-stage-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-inline { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.oc-foot { justify-content: space-between; align-items: flex-end; }
.oc-blockers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.oc-blockers li { display: flex; align-items: center; gap: var(--ent-s1); }
.oc-blockers svg { color: var(--ent-warning); flex-shrink: 0; }

.oc-cert { position: relative; padding: var(--ent-s8) var(--ent-s7); text-align: center; border: 1px solid var(--ent-tone-positive-line); box-shadow: var(--ent-e2), inset 0 0 0 6px var(--ent-surface), inset 0 0 0 7px var(--ent-line); }
.oc-cert-seal { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; margin-bottom: var(--ent-s3); border-radius: 50%; color: var(--ent-success); background: var(--ent-success-soft); border: 1px solid var(--ent-tone-positive-line); }
.oc-cert-eyebrow { margin: 0; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ent-text-3); }
.oc-cert-title { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-xl); font-weight: var(--ent-fw-bold); letter-spacing: -0.01em; color: var(--ent-text); }
.oc-cert-no { margin: var(--ent-s1) 0 var(--ent-s5); color: var(--ent-text-2); }
.oc-cert-body { max-width: 60ch; margin: 0 auto var(--ent-s5); font-size: var(--ent-fs-base); line-height: 1.6; color: var(--ent-text); }
.oc-cert-dl { max-width: 40rem; margin: 0 auto; padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); text-align: left; }
.oc-cert-notes { max-width: 40rem; margin: var(--ent-s4) auto 0; padding: var(--ent-s3); text-align: left; font-size: var(--ent-fs-sm); white-space: pre-line; background: var(--ent-surface-2); border-radius: var(--ent-r); }
.oc-cert-actions { margin-top: var(--ent-s5); }

@media (max-width: 767px) {
  .oc-cert { padding: var(--ent-s6) var(--ent-s4); }
  .oc-foot { flex-direction: column; align-items: stretch; }
}
</style>
