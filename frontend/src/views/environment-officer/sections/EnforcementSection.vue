<script setup lang="ts">
// Enforcement — the Public Health Act notice book.
//
//   abatement          s. 83  abate a nuisance within a period
//   closure            s. 87  premises unfit for occupation, closed until repaired
//   works in default   s. 84  the council does the works and recovers the cost
//   prohibition               a food business ceases trading until re-inspected
//
// This section used to post health notices to the planning enforcement-order
// endpoint, which refuses the env_officer role, requires fields the form never
// sent and rejects the order types it used — every notice failed. Notices now
// have their own register (migration 122), and compliance is established the
// way the Act means it to be: by re-inspection, recorded as an inspection
// linked to the notice.
//
// URL: ?premises=<id> opens the serve form pre-filled from that premises and
// its latest failed inspection (the Inspections and Surveillance "Issue
// notice" buttons land here).

import { computed, onMounted, ref, watch } from 'vue'
import { useHealthCase, isServerId } from '@/composables/useHealthCase'
import {
  ehoOpsApi, NOTICE_LABELS,
  type HealthNotice, type NoticeType, type NoticeStatus, type NoticeEscalation, type ServedMethod,
  type InspectionVerdict,
} from '@/services/environmentalHealthOps'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { councilDoc, block, signatures } from '@/environment-officer/documents'
import { daysUntil, fmtDate, fmtDateTime, humanise, isoDay } from '@/environment-officer/console'
import { isPersonName, isZwPhone, sanitizePhone } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Plus, Search, RefreshCw, CloudOff, FileDown, Scale, CalendarPlus,
  CheckCircle2, XCircle, ClipboardCheck, Printer, Undo2,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()

// ── Load ────────────────────────────────────────────────────────────
const notices = ref<HealthNotice[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    notices.value = await ehoOpsApi.listNotices({ limit: 500 })
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'The notice book could not be loaded.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const OPEN: NoticeStatus[] = ['served', 'extended', 'non_complied']
const isOpen = (n: HealthNotice) => OPEN.includes(n.status)
const isLate = (n: HealthNotice) => (n.status === 'served' || n.status === 'extended') && (daysUntil(n.complianceDue) ?? 1) < 0

const filter = ref<'open' | 'overdue' | 'closed' | 'all'>('open')
const search = ref('')
const stats = computed(() => ({
  open: notices.value.filter(isOpen).length,
  overdue: notices.value.filter(isLate).length,
  closed: notices.value.filter(n => !isOpen(n)).length,
}))
const shown = computed(() => {
  let arr = notices.value
  if (filter.value === 'open') arr = arr.filter(isOpen)
  else if (filter.value === 'overdue') arr = arr.filter(isLate)
  else if (filter.value === 'closed') arr = arr.filter(n => !isOpen(n))
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter(n => `${n.reference} ${n.subjectName} ${n.premisesName ?? ''} ${n.standNumber ?? ''}`.toLowerCase().includes(q))
  return arr
})

function dueLabel(n: HealthNotice) {
  if (!isOpen(n)) return n.closedAt ? `Closed ${fmtDate(n.closedAt)}` : humanise(n.status)
  const d = daysUntil(n.complianceDue) ?? 0
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`
  if (d === 0) return 'Due today'
  return `Due in ${d} day${d === 1 ? '' : 's'}`
}
const STATUS_TONE: Record<NoticeStatus, 'negative' | 'warning' | 'positive' | 'neutral' | 'info'> = {
  served: 'info', extended: 'warning', complied: 'positive', non_complied: 'negative', escalated: 'negative', withdrawn: 'neutral',
}

// ── Serve ───────────────────────────────────────────────────────────
const NOTICE_TYPES = Object.keys(NOTICE_LABELS) as NoticeType[]
const METHODS: { v: ServedMethod; l: string }[] = [
  { v: 'hand', l: 'By hand' }, { v: 'registered_post', l: 'Registered post' },
  { v: 'affixed', l: 'Affixed to premises' }, { v: 'email', l: 'Email' },
]
const DEFAULT_DAYS: Record<NoticeType, number> = { abatement: 14, closure: 30, works_in_default: 14, prohibition: 7 }

const serveOpen = ref(false)
const blankServe = () => ({
  noticeType: 'abatement' as NoticeType, premisesId: '', complaintId: '', inspectionId: '',
  standNumber: '', suburbWard: '', subjectName: '', subjectAddress: '', subjectContact: '',
  nuisanceDescription: '', requiredAction: '', complianceDays: 14, servedMethod: 'hand' as ServedMethod,
  issuedByName: auth.userName || '',
})
const serve = ref(blankServe())
const saving = ref(false)

watch(() => serve.value.noticeType, (t) => { serve.value.complianceDays = DEFAULT_DAYS[t] })

const syncedPremises = computed(() => hc.registry.value.filter(p => isServerId(p.id)))
const openComplaints = computed(() => hc.complaints.value.filter(c => isServerId(c.id) && (c.status === 'open' || c.status === 'investigating')))

/** Pre-fill from a premises and the inspection most likely to ground the notice. */
function prefillFromPremises(id: string) {
  const p = hc.registry.value.find(r => r.id === id)
  if (!p) return
  const grounding = hc.inspections.value
    .filter(i => i.premisesId === id && (i.verdict === 'fail' || i.verdict === 'conditional') && isServerId(i.id))
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt))[0]
  Object.assign(serve.value, {
    premisesId: id, standNumber: p.stand_number, suburbWard: p.suburb_ward,
    subjectName: serve.value.subjectName || p.operator_name,
    subjectContact: serve.value.subjectContact || p.operator_contact,
    subjectAddress: serve.value.subjectAddress || [p.name, p.stand_number && `Stand ${p.stand_number}`, p.suburb_ward].filter(Boolean).join(', '),
    inspectionId: grounding?.id ?? '',
    nuisanceDescription: serve.value.nuisanceDescription || grounding?.findings || '',
    requiredAction: serve.value.requiredAction || grounding?.actionRequired || '',
  })
}
watch(() => serve.value.premisesId, (id) => { if (id) prefillFromPremises(id) })

function openServe(premisesId?: string | null) {
  serve.value = blankServe()
  if (premisesId) prefillFromPremises(premisesId)
  serveOpen.value = true
}
// Arriving from Inspections or Surveillance with a premises: open the form.
// Watched rather than read on mount — the workspace keeps this section alive,
// so it is mounted once — and only while Enforcement is the visible section,
// because Inspections uses the same ?premises= key for its own selection.
watch(() => [nav.section.value, nav.param('premises')] as const, ([section, p]) => {
  if (section !== 'enforcement' || !p) return
  openServe(p)
  nav.setParam('premises', null)
}, { immediate: true })

const groundingInspection = computed(() => hc.inspections.value.find(i => i.id === serve.value.inspectionId) ?? null)

async function submitServe() {
  const f = serve.value
  if (!isPersonName(f.subjectName)) return fb.showToast('Name the owner or occupier the notice binds.', 'warning')
  if (f.subjectContact.trim() && !isZwPhone(f.subjectContact)) return fb.showToast('Contact must be a Zimbabwe mobile number.', 'warning')
  if (f.nuisanceDescription.trim().length < 10) return fb.showToast('Describe the nuisance or breach the notice concerns.', 'warning')
  if (f.requiredAction.trim().length < 5) return fb.showToast('State what must be done to comply.', 'warning')
  const days = Number(f.complianceDays)
  if (!Number.isInteger(days) || days < 1 || days > 180) return fb.showToast('The compliance period must be 1–180 days.', 'warning')
  if (!isPersonName(f.issuedByName)) return fb.showToast('Enter the issuing officer’s name.', 'warning')

  saving.value = true
  try {
    const n = await ehoOpsApi.serveNotice({
      noticeType: f.noticeType,
      premisesId: f.premisesId || null, complaintId: f.complaintId || null, inspectionId: f.inspectionId || null,
      standNumber: f.standNumber, suburbWard: f.suburbWard,
      subjectName: f.subjectName.trim(), subjectAddress: f.subjectAddress.trim(),
      subjectContact: f.subjectContact.trim() ? sanitizePhone(f.subjectContact) : null,
      nuisanceDescription: f.nuisanceDescription.trim(), requiredAction: f.requiredAction.trim(),
      complianceDays: days, servedMethod: f.servedMethod, issuedByName: f.issuedByName.trim(),
    })
    notices.value = [n, ...notices.value]
    serveOpen.value = false
    void hc.refresh()
    const print = await fb.confirmAction('Notice recorded',
      `${n.reference} is on the council record. Print the notice for service now?`, { confirmLabel: 'Print notice' })
    if (print) printNotice(n)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The notice could not be recorded. Nothing was saved.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Detail + outcomes ───────────────────────────────────────────────
const openId = ref<string | null>(null)
const current = computed(() => notices.value.find(n => n.id === openId.value) ?? null)
const linkedInspections = computed(() =>
  hc.inspections.value.filter(i => i.noticeId === openId.value)
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt)))

type Outcome = null | 'reinspect' | 'extend' | 'escalate' | 'withdraw'
const outcome = ref<Outcome>(null)
const outForm = ref({ verdict: 'pass' as InspectionVerdict, findings: '', extendTo: '', escalation: 'prosecution' as NoticeEscalation, notes: '' })
watch(openId, () => { outcome.value = null; outForm.value = { verdict: 'pass', findings: '', extendTo: '', escalation: 'prosecution', notes: '' } })

async function patch(n: HealthNotice, body: Parameters<typeof ehoOpsApi.updateNotice>[1], done: string) {
  saving.value = true
  try {
    const updated = await ehoOpsApi.updateNotice(n.id, body)
    notices.value = notices.value.map(x => (x.id === n.id ? updated : x))
    outcome.value = null
    fb.showToast(done, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The change could not be saved.'), 'error')
  } finally {
    saving.value = false
  }
}

async function recordReinspection() {
  const n = current.value
  if (!n) return
  const f = outForm.value
  if (!n.premisesId) return fb.showToast('This notice is not linked to a registered premises, so there is nothing to re-inspect against.', 'warning')
  if (!f.findings.trim()) return fb.showToast('Record what was found on re-inspection.', 'warning')
  hc.recordInspection({
    premisesId: n.premisesId, noticeId: n.id, inspectorName: auth.userName || n.issuedByName,
    scope: 'general', verdict: f.verdict, findings: f.findings.trim(),
    actionRequired: f.verdict === 'pass' ? null : n.requiredAction,
  })
  if (f.verdict === 'pass') {
    await patch(n, { status: 'complied', outcomeNotes: f.findings.trim() }, 'Re-inspection passed. Notice complied with.')
  } else {
    await patch(n, { status: 'non_complied', outcomeNotes: f.findings.trim() }, 'Re-inspection recorded. Notice not complied with.')
  }
}
function submitExtend() {
  const n = current.value
  if (!n) return
  if (!outForm.value.extendTo || outForm.value.extendTo <= isoDay()) return fb.showToast('Choose a new date after today.', 'warning')
  void patch(n, { status: 'extended', extendedTo: outForm.value.extendTo, outcomeNotes: outForm.value.notes || null }, 'Extension granted.')
}
async function submitEscalate() {
  const n = current.value
  if (!n) return
  const ok = await fb.confirmAction('Escalate notice',
    `Escalate ${n.reference} to ${humanise(outForm.value.escalation).toLowerCase()}? The notice is closed as escalated.`,
    { confirmLabel: 'Escalate', danger: true })
  if (!ok) return
  await patch(n, { status: 'escalated', escalation: outForm.value.escalation, outcomeNotes: outForm.value.notes || null }, 'Notice escalated.')
  if (outForm.value.escalation === 'prosecution') prosecutionDossier(notices.value.find(x => x.id === n.id) ?? n)
}
function submitWithdraw() {
  const n = current.value
  if (!n) return
  if (outForm.value.notes.trim().length < 5) return fb.showToast('A withdrawn notice must say why.', 'warning')
  void patch(n, { status: 'withdrawn', outcomeNotes: outForm.value.notes.trim() }, 'Notice withdrawn.')
}
function reopen(n: HealthNotice) {
  void patch(n, { status: 'served' }, 'Notice reopened.')
}

// ── Documents ───────────────────────────────────────────────────────
function printNotice(n: HealthNotice) {
  const meta = NOTICE_LABELS[n.noticeType]
  const d = councilDoc(meta.label, `Issued under the ${meta.statute} · ${n.reference}`)
  block(d, 'TO', [n.subjectName, n.subjectAddress].filter(Boolean).join('\n'))
  block(d, 'PREMISES', [n.premisesName, n.standNumber && `Stand ${n.standNumber}`, n.suburbWard].filter(Boolean).join(' · '))
  block(d, 'TAKE NOTICE that the Council is satisfied that the following exists', n.nuisanceDescription)
  block(d, 'YOU ARE REQUIRED to', n.requiredAction)
  block(d, 'WITHIN', `${n.complianceDays} days of service of this notice, that is on or before ${fmtDate(n.complianceDue)}.`)
  block(d, 'FAILURE TO COMPLY',
    'is an offence. The Council may execute the works in default and recover the cost from you, and may institute proceedings without further notice.')
  block(d, 'SERVED', `${fmtDateTime(n.servedAt)} · ${humanise(n.servedMethod)}`)
  signatures(d, `${n.issuedByName}, Environmental Health Officer`, 'Received by (name, signature, date)')
  d.doc.save(`${n.reference}.pdf`)
}

function prosecutionDossier(n: HealthNotice) {
  const d = councilDoc('Prosecution dossier', `${NOTICE_LABELS[n.noticeType].statute} · ${n.reference} · prepared ${fmtDateTime(new Date().toISOString())}`)
  block(d, 'ACCUSED', [n.subjectName, n.subjectAddress, n.subjectContact].filter(Boolean).join('\n'))
  block(d, 'PREMISES', [n.premisesName, n.standNumber && `Stand ${n.standNumber}`, n.suburbWard].filter(Boolean).join(' · '))
  block(d, 'NOTICE', `${NOTICE_LABELS[n.noticeType].label}, served ${fmtDateTime(n.servedAt)} (${humanise(n.servedMethod)}) by ${n.issuedByName}.`)
  block(d, 'BREACH', n.nuisanceDescription)
  block(d, 'REQUIRED ACTION', n.requiredAction)
  block(d, 'COMPLIANCE DUE', `${fmtDate(n.complianceDue)}${n.extendedTo ? ' (after extension)' : ''}`)
  const insp = hc.inspections.value.filter(i => i.noticeId === n.id || (n.premisesId && i.premisesId === n.premisesId))
    .sort((a, b) => +new Date(a.inspectedAt) - +new Date(b.inspectedAt))
  block(d, 'INSPECTION RECORD', insp.length
    ? insp.map(i => `${fmtDateTime(i.inspectedAt)} · ${i.reference || 'unsynced'} · ${humanise(i.verdict)} · ${i.inspectorName}\n  ${i.findings}`).join('\n')
    : 'No inspections are linked. Attach contemporaneous notes before filing.')
  block(d, 'OUTCOME', n.outcomeNotes || humanise(n.status))
  block(d, 'EVIDENCE TO ATTACH',
    '• Signed copy of the notice and proof of service\n• Photographs taken at each inspection\n• Laboratory results, where sampling was involved\n• Witness statements, where applicable')
  d.doc.save(`${n.reference}-prosecution.pdf`)
  fb.showToast('Prosecution dossier downloaded.', 'success')
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Public Health Act · ss. 83, 84, 87</span>
        <h2 class="ins-title">Enforcement</h2>
        <p class="ins-lede">The notice book. Compliance is established by re-inspection; a notice closes as complied, escalated or withdrawn, never quietly.</p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload" @click="load">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" /><span class="ent-sr-only">Reload notices</span>
        </button>
        <UiButton variant="primary" @click="openServe()"><template #icon><Plus :size="15" /></template>Serve notice</UiButton>
      </div>
    </header>

    <div class="ee-tools">
      <div class="ins-chips" role="group" aria-label="Show">
        <button type="button" class="ins-chip" :aria-pressed="filter === 'open'" @click="filter = 'open'">Open<span class="ins-chip-n">{{ stats.open }}</span></button>
        <button type="button" class="ins-chip" :aria-pressed="filter === 'overdue'" @click="filter = 'overdue'">Overdue<span class="ins-chip-n">{{ stats.overdue }}</span></button>
        <button type="button" class="ins-chip" :aria-pressed="filter === 'closed'" @click="filter = 'closed'">Closed<span class="ins-chip-n">{{ stats.closed }}</span></button>
        <button type="button" class="ins-chip" :aria-pressed="filter === 'all'" @click="filter = 'all'">All</button>
      </div>
      <label class="ins-search ee-search">
        <Search :size="15" aria-hidden="true" /><span class="ent-sr-only">Search notices</span>
        <input v-model="search" type="search" placeholder="Reference, name, premises, stand" />
      </label>
    </div>

    <section class="ins-card" aria-label="Notices">
      <ul v-if="loading && !notices.length" class="ins-rows" aria-busy="true">
        <li v-for="i in 4" :key="i" class="ins-row"><span class="ins-skel" style="width:65%" /></li>
      </ul>
      <div v-else-if="loadError" class="ins-card-body">
        <p class="ins-banner t-negative"><CloudOff :size="16" aria-hidden="true" />
          <span><strong>{{ loadError }}</strong> This is not an empty notice book — retry when the connection returns.</span></p>
      </div>
      <p v-else-if="!shown.length" class="ee-empty">
        <template v-if="filter === 'overdue'">No notice is past its compliance date.</template>
        <template v-else-if="filter === 'open' && !notices.length">No notices have been served. A notice is usually served from a failed inspection or an investigated complaint.</template>
        <template v-else>No notices match.</template>
      </p>
      <ul v-else class="ins-rows">
        <li v-for="n in shown" :key="n.id">
          <button type="button" class="ee-row" :class="{ late: isLate(n) }" @click="openId = n.id">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ n.subjectName }}<template v-if="n.premisesName"> · {{ n.premisesName }}</template></span>
              <span class="ins-row-meta">
                <span class="ins-mono">{{ n.reference }}</span> · {{ NOTICE_LABELS[n.noticeType].label }}
                · served {{ fmtDate(n.servedAt) }}
                <template v-if="n.reinspections"> · {{ n.reinspections }} re-inspection{{ n.reinspections === 1 ? '' : 's' }}</template>
              </span>
            </span>
            <UiStatusBadge :tone="STATUS_TONE[n.status]" :label="humanise(n.status)" />
            <span class="ee-due" :class="{ late: isLate(n) }">{{ dueLabel(n) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Notice detail -->
    <UiSheet :open="!!current" :title="current ? current.reference : ''"
             :subtitle="current ? `${NOTICE_LABELS[current.noticeType].label} · ${NOTICE_LABELS[current.noticeType].statute}` : ''"
             width="42rem" @update:open="v => { if (!v) openId = null }">
      <div v-if="current" class="ee-detail">
        <div class="ee-status-line">
          <UiStatusBadge :tone="STATUS_TONE[current.status]" :label="humanise(current.status)" />
          <strong :class="{ 'ee-late-text': isLate(current) }">{{ dueLabel(current) }}</strong>
          <span v-if="current.escalation" class="ee-muted">→ {{ humanise(current.escalation) }}</span>
        </div>
        <dl class="ins-dl">
          <div><dt>Served on</dt><dd>{{ current.subjectName }}<template v-if="current.subjectContact"> · {{ current.subjectContact }}</template></dd></div>
          <div><dt>Premises</dt><dd>{{ current.premisesName || '—' }}<template v-if="current.standNumber"> · Stand {{ current.standNumber }}</template></dd></div>
          <div><dt>Served</dt><dd>{{ fmtDateTime(current.servedAt) }} · {{ humanise(current.servedMethod) }}</dd></div>
          <div><dt>Compliance</dt><dd>{{ current.complianceDays }} days · due {{ fmtDate(current.complianceDue) }}</dd></div>
          <div v-if="current.complaintReference"><dt>Answers complaint</dt><dd class="ins-mono">{{ current.complaintReference }}</dd></div>
          <div><dt>Issued by</dt><dd>{{ current.issuedByName }}</dd></div>
        </dl>
        <div class="ee-text"><h4>Nuisance / breach</h4><p>{{ current.nuisanceDescription }}</p></div>
        <div class="ee-text"><h4>Required action</h4><p>{{ current.requiredAction }}</p></div>
        <div v-if="current.outcomeNotes" class="ee-text"><h4>Outcome</h4><p>{{ current.outcomeNotes }}</p></div>

        <div v-if="linkedInspections.length" class="ee-text">
          <h4>Linked inspections</h4>
          <ul class="ee-insp">
            <li v-for="i in linkedInspections" :key="i.id">
              <UiStatusBadge :status="i.verdict === 'conditional' ? 'conditional_pass' : i.verdict" />
              {{ fmtDateTime(i.inspectedAt) }} · {{ i.inspectorName }}<template v-if="i.pendingSync"> · not yet sent</template>
            </li>
          </ul>
        </div>

        <!-- Outcome forms -->
          <form v-if="outcome === 'reinspect'" key="r" class="ins-card ee-out" @submit.prevent="recordReinspection">
            <div class="ins-card-body ins-form">
              <div class="ins-field full"><span class="ins-label">Result on re-inspection</span>
                <div class="ins-seg" role="radiogroup">
                  <button type="button" role="radio" class="t-positive" :aria-checked="outForm.verdict === 'pass'" @click="outForm.verdict = 'pass'">Complied</button>
                  <button type="button" role="radio" class="t-negative" :aria-checked="outForm.verdict === 'fail'" @click="outForm.verdict = 'fail'">Not complied</button>
                </div></div>
              <label class="ins-field full"><span class="ins-label">Findings</span>
                <textarea v-model="outForm.findings" class="ins-input" rows="3" /></label>
            </div>
            <div class="ins-card-foot">
              <UiButton variant="ghost" @click="outcome = null">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :loading="saving">Record re-inspection</UiButton>
            </div>
          </form>
          <form v-else-if="outcome === 'extend'" key="e" class="ins-card ee-out" @submit.prevent="submitExtend">
            <div class="ins-card-body ins-form">
              <label class="ins-field"><span class="ins-label">New compliance date</span>
                <input v-model="outForm.extendTo" type="date" class="ins-input" :min="isoDay()" /></label>
              <label class="ins-field full"><span class="ins-label">Reason</span>
                <textarea v-model="outForm.notes" class="ins-input" rows="2" placeholder="Works under way; materials awaited…" /></label>
            </div>
            <div class="ins-card-foot">
              <UiButton variant="ghost" @click="outcome = null">Cancel</UiButton>
              <UiButton variant="primary" type="submit" :loading="saving">Grant extension</UiButton>
            </div>
          </form>
          <form v-else-if="outcome === 'escalate'" key="x" class="ins-card ee-out" @submit.prevent="submitEscalate">
            <div class="ins-card-body ins-form">
              <div class="ins-field full"><span class="ins-label">Escalate to</span>
                <div class="ins-chips" role="radiogroup">
                  <button v-for="e in (['prosecution', 'works_in_default', 'closure'] as NoticeEscalation[])" :key="e" type="button"
                          class="ins-chip" role="radio" :aria-checked="outForm.escalation === e" :aria-pressed="outForm.escalation === e"
                          @click="outForm.escalation = e">{{ humanise(e) }}</button>
                </div></div>
              <label class="ins-field full"><span class="ins-label">Grounds</span>
                <textarea v-model="outForm.notes" class="ins-input" rows="2" /></label>
            </div>
            <div class="ins-card-foot">
              <UiButton variant="ghost" @click="outcome = null">Cancel</UiButton>
              <UiButton variant="danger" type="submit" :loading="saving">Escalate</UiButton>
            </div>
          </form>
          <form v-else-if="outcome === 'withdraw'" key="w" class="ins-card ee-out" @submit.prevent="submitWithdraw">
            <div class="ins-card-body ins-form">
              <label class="ins-field full"><span class="ins-label">Why the notice is withdrawn</span>
                <textarea v-model="outForm.notes" class="ins-input" rows="2" placeholder="Served on the wrong party; nuisance found not to exist…" /></label>
            </div>
            <div class="ins-card-foot">
              <UiButton variant="ghost" @click="outcome = null">Cancel</UiButton>
              <UiButton variant="danger" type="submit" :loading="saving">Withdraw notice</UiButton>
            </div>
          </form>
      </div>
      <template #footer>
        <template v-if="current">
          <UiButton size="sm" variant="ghost" @click="printNotice(current)"><template #icon><Printer :size="14" /></template>Notice</UiButton>
          <UiButton size="sm" variant="ghost" @click="prosecutionDossier(current)"><template #icon><FileDown :size="14" /></template>Dossier</UiButton>
          <template v-if="isOpen(current) && !outcome">
            <UiButton size="sm" :disabled="!current.premisesId" @click="outcome = 'reinspect'"><template #icon><ClipboardCheck :size="14" /></template>Re-inspect</UiButton>
            <UiButton size="sm" @click="outcome = 'extend'"><template #icon><CalendarPlus :size="14" /></template>Extend</UiButton>
            <UiButton size="sm" @click="outcome = 'escalate'"><template #icon><Scale :size="14" /></template>Escalate</UiButton>
            <UiButton size="sm" variant="ghost" @click="outcome = 'withdraw'"><template #icon><XCircle :size="14" /></template>Withdraw</UiButton>
          </template>
          <UiButton v-else-if="!isOpen(current) && current.status !== 'escalated'" size="sm" variant="ghost" @click="reopen(current)">
            <template #icon><Undo2 :size="14" /></template>Reopen
          </UiButton>
        </template>
      </template>
    </UiSheet>

    <!-- Serve notice -->
    <UiSheet :open="serveOpen" title="Serve notice" subtitle="Public Health Act" width="42rem" @update:open="serveOpen = $event">
      <form id="ee-serve" class="ins-form" @submit.prevent="submitServe">
        <div class="ins-field full"><span class="ins-label">Notice</span>
          <div class="ins-chips" role="radiogroup" aria-label="Notice type">
            <button v-for="t in NOTICE_TYPES" :key="t" type="button" class="ins-chip" role="radio"
                    :aria-checked="serve.noticeType === t" :aria-pressed="serve.noticeType === t" @click="serve.noticeType = t">
              {{ NOTICE_LABELS[t].label }}</button>
          </div>
          <p class="ins-hint">{{ NOTICE_LABELS[serve.noticeType].statute }}</p>
        </div>
        <label class="ins-field"><span class="ins-label">Premises</span>
          <select v-model="serve.premisesId" class="ins-input">
            <option value="">Not a registered premises</option>
            <option v-for="p in syncedPremises" :key="p.id" :value="p.id">{{ p.name }} · Stand {{ p.stand_number }}</option>
          </select></label>
        <label class="ins-field"><span class="ins-label">Answers complaint</span>
          <select v-model="serve.complaintId" class="ins-input">
            <option value="">None</option>
            <option v-for="c in openComplaints" :key="c.id" :value="c.id">{{ c.reference || humanise(c.category) }} · {{ c.description.slice(0, 40) }}</option>
          </select></label>
        <p v-if="groundingInspection" class="ins-banner t-info full-row">
          <ClipboardCheck :size="15" aria-hidden="true" />
          <span>Grounded on the {{ humanise(groundingInspection.verdict).toLowerCase() }} inspection of {{ fmtDate(groundingInspection.inspectedAt) }} — its findings are pre-filled and it will be linked.</span>
        </p>
        <label class="ins-field"><span class="ins-label">Owner / occupier</span>
          <input v-model="serve.subjectName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Phone</span>
          <input v-model="serve.subjectContact" class="ins-input" inputmode="tel" /></label>
        <label class="ins-field full"><span class="ins-label">Address for service</span>
          <input v-model="serve.subjectAddress" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Stand</span><input v-model="serve.standNumber" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Ward / suburb</span><input v-model="serve.suburbWard" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Nuisance or breach</span>
          <textarea v-model="serve.nuisanceDescription" class="ins-input" rows="3" /></label>
        <label class="ins-field full"><span class="ins-label">Required action</span>
          <textarea v-model="serve.requiredAction" class="ins-input" rows="2" /></label>
        <label class="ins-field"><span class="ins-label">Compliance period (days)</span>
          <input v-model.number="serve.complianceDays" type="number" min="1" max="180" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Served</span>
          <select v-model="serve.servedMethod" class="ins-input">
            <option v-for="m in METHODS" :key="m.v" :value="m.v">{{ m.l }}</option>
          </select></label>
        <label class="ins-field full"><span class="ins-label">Issuing officer</span>
          <input v-model="serve.issuedByName" class="ins-input" autocomplete="name" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="serveOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ee-serve" :loading="saving"><template #icon><CheckCircle2 :size="15" /></template>Record notice</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ee-tools { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s3); flex-wrap:wrap; }
.ee-search { flex:0 1 22rem; }
.ee-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.ee-muted { color:var(--ent-text-3); }

.ee-row { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line); border-left:3px solid transparent;
  background:transparent; text-align:left; cursor:pointer; font-family:var(--ent-font);
  transition:background-color var(--ent-dur) var(--ent-ease); }
li:first-child > .ee-row { border-top:0; }
.ee-row:hover { background:var(--ent-surface-2); }
.ee-row:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.ee-row.late { border-left-color:var(--ent-danger); }
.ee-due { flex-shrink:0; min-width:8rem; text-align:right; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; color:var(--ent-text-2); }
.ee-due.late, .ee-late-text { color:var(--ent-danger); }

.ee-detail { display:flex; flex-direction:column; gap:var(--ent-s4); }
.ee-status-line { display:flex; align-items:center; gap:var(--ent-s2); flex-wrap:wrap; font-size:var(--ent-fs-sm); }
.ee-text h4 { margin:0 0 var(--ent-s1); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.04em; text-transform:uppercase; color:var(--ent-text-3); }
.ee-text p { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text); line-height:var(--ent-lh); white-space:pre-line; }
.ee-insp { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.ee-out { box-shadow:none; }
.full-row { grid-column:1 / -1; }

.ee-out { animation:ee-in var(--ent-dur) var(--ent-ease) backwards; }
@keyframes ee-in { from { opacity:0; transform:translateY(4px); } }

@media (max-width: 767px) {
  .ee-row { flex-wrap:wrap; }
  .ee-due { min-width:0; text-align:left; }
  .ee-search { flex:1 1 100%; }
}
@media (prefers-reduced-motion: reduce) { .ee-out { animation:none; } }
</style>
