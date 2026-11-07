<script setup lang="ts">
// Licence clearance — the EHO's certification a shop, liquor, hawker or food
// licence cannot be granted without.
//
// A clearance is a decision about a premises, so the decision screen puts the
// premises' latest inspection beside it. Clearing without a recent inspection
// is allowed — there are genuine cases — but it is never done without the
// screen saying so, and the inspection the decision rests on is linked to it.
//
// Online only: a clearance is decided at a desk, and a licence office acting on
// a clearance the council never recorded is the failure this register exists
// to prevent.

import { computed, onMounted, ref } from 'vue'
import jsPDF from 'jspdf'
import { useHealthCase, isServerId } from '@/composables/useHealthCase'
import {
  ehoOpsApi, LICENCE_LABELS, INSPECTION_SCOPE_LABELS,
  type LicenceClearance, type LicenceType, type ClearanceStatus,
} from '@/services/environmentalHealthOps'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { daysSince, fmtDate, fmtDateTime, humanise } from '@/environment-officer/console'
import { isPersonName, isZwPhone, sanitizePhone } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Stamp, Plus, Search, RefreshCw, CloudOff, AlertTriangle, ClipboardCheck, Printer, Inbox, CheckCircle2,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()
const { prefs } = useEhoPreferences()

const items = ref<LicenceClearance[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
async function load() {
  loading.value = true
  loadError.value = null
  try {
    items.value = await ehoOpsApi.listClearances({ limit: 500 })
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Clearances could not be loaded.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filter = ref<'pending' | 'decided' | 'all'>('pending')
const typeFilter = ref<'' | LicenceType>('')
const search = ref('')
const pendingCount = computed(() => items.value.filter(c => c.status === 'pending').length)
const shown = computed(() => {
  let arr = items.value
  if (filter.value === 'pending') arr = arr.filter(c => c.status === 'pending')
  else if (filter.value === 'decided') arr = arr.filter(c => c.status !== 'pending')
  if (typeFilter.value) arr = arr.filter(c => c.licenceType === typeFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) arr = arr.filter(c => `${c.reference} ${c.applicantName} ${c.tradingName ?? ''} ${c.standNumber ?? ''} ${c.premisesName ?? ''}`.toLowerCase().includes(q))
  // Oldest waiting first: an applicant who has waited longest is served first.
  return [...arr].sort((a, b) => filter.value === 'pending'
    ? +new Date(a.receivedAt) - +new Date(b.receivedAt)
    : +new Date(b.receivedAt) - +new Date(a.receivedAt))
})
const TONE: Record<ClearanceStatus, 'info' | 'positive' | 'warning' | 'negative' | 'neutral'> =
  { pending: 'info', cleared: 'positive', conditional: 'warning', refused: 'negative', withdrawn: 'neutral' }
const LICENCE_TYPES = Object.keys(LICENCE_LABELS) as LicenceType[]

// ── Receive ─────────────────────────────────────────────────────────
const recvOpen = ref(false)
const saving = ref(false)
const blankRecv = () => ({
  licenceType: 'shop' as LicenceType, applicantName: '', applicantContact: '', tradingName: '',
  premisesId: '', standNumber: '', suburbWard: '', notes: '',
})
const recv = ref(blankRecv())
const syncedPremises = computed(() => hc.registry.value.filter(p => isServerId(p.id)).sort((a, b) => a.name.localeCompare(b.name)))
function pickPremises() {
  const p = hc.registry.value.find(r => r.id === recv.value.premisesId)
  if (!p) return
  recv.value.standNumber = p.stand_number
  recv.value.suburbWard = p.suburb_ward
  if (!recv.value.tradingName) recv.value.tradingName = p.name
  if (!recv.value.applicantName) recv.value.applicantName = p.operator_name
  if (!recv.value.applicantContact) recv.value.applicantContact = p.operator_contact
}

async function submitRecv() {
  const f = recv.value
  if (!isPersonName(f.applicantName)) return fb.showToast('Enter the applicant’s name.', 'warning')
  if (f.applicantContact.trim() && !isZwPhone(f.applicantContact)) return fb.showToast('Contact must be a Zimbabwe mobile number.', 'warning')
  if (!f.premisesId && !f.standNumber.trim()) return fb.showToast('Link a registered premises or give the stand number.', 'warning')
  saving.value = true
  try {
    const c = await ehoOpsApi.createClearance({
      licenceType: f.licenceType, applicantName: f.applicantName.trim(),
      applicantContact: f.applicantContact.trim() ? sanitizePhone(f.applicantContact) : null,
      tradingName: f.tradingName.trim() || null, premisesId: f.premisesId || null,
      standNumber: f.standNumber.trim() || null, suburbWard: f.suburbWard.trim() || null, notes: f.notes.trim() || null,
    })
    items.value = [c, ...items.value]
    recvOpen.value = false
    fb.showToast(`${c.reference} received. It waits in the queue for your decision.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The application could not be recorded.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Decide ──────────────────────────────────────────────────────────
const openId = ref<string | null>(null)
const current = computed(() => items.value.find(c => c.id === openId.value) ?? null)

const evidence = computed(() => {
  const c = current.value
  if (!c?.premisesId) return null
  const list = hc.inspections.value.filter(i => i.premisesId === c.premisesId)
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt))
  const latest = list[0] ?? null
  const age = latest ? daysSince(latest.inspectedAt) : null
  return { latest, recent: !!latest && (age ?? Infinity) <= prefs.value.inspectionCycleDays, age }
})

/** Licences run to the end of the licensing year. */
function endOfYear() { return `${new Date().getFullYear()}-12-31` }
const decision = ref({ status: 'cleared' as Exclude<ClearanceStatus, 'pending'>, conditions: '', refusalReason: '', validUntil: endOfYear(), decidedByName: '' })
function openDecide(c: LicenceClearance) {
  openId.value = c.id
  decision.value = {
    status: c.status === 'pending' ? 'cleared' : (c.status as Exclude<ClearanceStatus, 'pending'>),
    conditions: c.conditions ?? '', refusalReason: c.refusalReason ?? '',
    validUntil: c.validUntil ? String(c.validUntil).slice(0, 10) : endOfYear(),
    decidedByName: c.decidedByName || auth.userName || '',
  }
}

async function submitDecision() {
  const c = current.value
  if (!c) return
  const d = decision.value
  if (!isPersonName(d.decidedByName)) return fb.showToast('Enter the deciding officer’s name.', 'warning')
  if (d.status === 'conditional' && d.conditions.trim().length < 5) return fb.showToast('State the conditions of the clearance.', 'warning')
  if (d.status === 'refused' && d.refusalReason.trim().length < 5) return fb.showToast('A refusal must give its grounds — the applicant is entitled to them.', 'warning')
  if ((d.status === 'cleared' || d.status === 'conditional') && evidence.value && !evidence.value.recent) {
    const ok = await fb.confirmAction('No recent inspection',
      evidence.value.latest
        ? `The latest inspection of this premises was ${evidence.value.age} days ago. Clear the licence without a current inspection?`
        : 'This premises has never been inspected. Clear the licence without an inspection?',
      { confirmLabel: 'Clear anyway', danger: true })
    if (!ok) return
  }
  saving.value = true
  try {
    const latest = evidence.value?.latest
    const updated = await ehoOpsApi.decideClearance(c.id, {
      status: d.status,
      conditions: d.status === 'conditional' ? d.conditions.trim() : undefined,
      refusalReason: d.status === 'refused' ? d.refusalReason.trim() : undefined,
      validUntil: d.status === 'cleared' || d.status === 'conditional' ? d.validUntil : undefined,
      inspectionId: latest && isServerId(latest.id) ? latest.id : undefined,
      decidedByName: d.decidedByName.trim(),
    })
    items.value = items.value.map(x => (x.id === c.id ? updated : x))
    fb.showToast(`${updated.reference} ${humanise(updated.status).toLowerCase()}.`, 'success')
    if (updated.status === 'cleared' || updated.status === 'conditional') {
      const print = await fb.confirmAction('Clearance recorded', 'Print the health clearance certificate for the licensing office?', { confirmLabel: 'Print' })
      if (print) printCertificate(updated)
    }
    openId.value = null
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The decision could not be saved. The application is still pending.'), 'error')
  } finally {
    saving.value = false
  }
}

function printCertificate(c: LicenceClearance) {
  const doc = new jsPDF()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
  doc.text('VUNGU RURAL DISTRICT COUNCIL', 105, 20, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text('Department of Environmental Health', 105, 26, { align: 'center' })
  doc.line(14, 30, 196, 30)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('HEALTH CLEARANCE FOR LICENSING', 105, 40, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const rows: [string, string][] = [
    ['Reference', c.reference],
    ['Licence applied for', LICENCE_LABELS[c.licenceType]],
    ['Applicant', c.applicantName],
    ['Trading as', c.tradingName || '—'],
    ['Premises', [c.premisesName, c.standNumber && `Stand ${c.standNumber}`, c.suburbWard].filter(Boolean).join(' · ') || '—'],
    ['Decision', c.status === 'conditional' ? 'Cleared subject to conditions' : 'Cleared'],
    ['Valid until', fmtDate(c.validUntil)],
    ['Inspection relied on', c.inspectionReference ? `${c.inspectionReference} (${humanise(c.inspectionVerdict)})` : 'None recorded'],
    ['Decided', `${fmtDateTime(c.decidedAt)} by ${c.decidedByName || '—'}`],
  ]
  let y = 54
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold'); doc.text(k, 14, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(v, 120)
    doc.text(lines, 70, y)
    y += 7 * lines.length
  }
  if (c.conditions) {
    y += 3
    doc.setFont('helvetica', 'bold'); doc.text('Conditions', 14, y)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(c.conditions, 182)
    doc.text(lines, 14, y + 6); y += 8 + lines.length * 5
  }
  y += 16
  doc.line(14, y, 90, y)
  doc.setFontSize(8)
  doc.text('Environmental Health Officer', 14, y + 5)
  doc.text('This clearance certifies health fitness only. It is not itself a licence.', 105, 285, { align: 'center' })
  doc.save(`${c.reference}-clearance.pdf`)
}
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Shop Licences Act · Liquor Act · by-laws</span>
        <h2 class="ins-title">Licence clearance</h2>
        <p class="ins-lede">A licence is not granted until the premises is cleared as fit. Oldest applications are shown first.</p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload" @click="load">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" /><span class="ent-sr-only">Reload</span>
        </button>
        <UiButton variant="primary" @click="recv = blankRecv(); recvOpen = true"><template #icon><Plus :size="15" /></template>Receive application</UiButton>
      </div>
    </header>

    <div class="el-tools">
      <div class="ins-chips" role="group" aria-label="Show">
        <button type="button" class="ins-chip" :aria-pressed="filter === 'pending'" @click="filter = 'pending'">Awaiting decision<span class="ins-chip-n">{{ pendingCount }}</span></button>
        <button type="button" class="ins-chip" :aria-pressed="filter === 'decided'" @click="filter = 'decided'">Decided</button>
        <button type="button" class="ins-chip" :aria-pressed="filter === 'all'" @click="filter = 'all'">All</button>
        <select v-model="typeFilter" class="ins-input el-select" aria-label="Licence type">
          <option value="">Any licence</option>
          <option v-for="t in LICENCE_TYPES" :key="t" :value="t">{{ LICENCE_LABELS[t] }}</option>
        </select>
      </div>
      <label class="ins-search el-search"><Search :size="15" aria-hidden="true" /><span class="ent-sr-only">Search</span>
        <input v-model="search" type="search" placeholder="Applicant, trading name, stand, reference" /></label>
    </div>

    <section class="ins-card" aria-label="Clearance applications">
      <ul v-if="loading && !items.length" class="ins-rows" aria-busy="true">
        <li v-for="i in 4" :key="i" class="ins-row"><span class="ins-skel" style="width:55%" /></li>
      </ul>
      <div v-else-if="loadError" class="ins-card-body">
        <p class="ins-banner t-negative"><CloudOff :size="16" aria-hidden="true" /><span><strong>{{ loadError }}</strong> Retry when the connection returns.</span></p>
      </div>
      <div v-else-if="!shown.length" class="el-empty">
        <Inbox :size="22" aria-hidden="true" />
        <p v-if="filter === 'pending'"><strong>Nothing waiting.</strong> Applications appear here when the licensing office refers them.</p>
        <p v-else>No applications match.</p>
      </div>
      <ul v-else class="ins-rows">
        <li v-for="c in shown" :key="c.id">
          <button type="button" class="el-row" @click="openDecide(c)">
            <Stamp :size="16" class="el-icon" aria-hidden="true" />
            <span class="ins-row-main">
              <span class="ins-row-title">{{ c.tradingName || c.applicantName }}</span>
              <span class="ins-row-meta">
                <span class="ins-mono">{{ c.reference }}</span> · {{ LICENCE_LABELS[c.licenceType] }} · {{ c.applicantName }}
                <template v-if="c.standNumber"> · Stand {{ c.standNumber }}</template>
              </span>
            </span>
            <UiStatusBadge :tone="TONE[c.status]" :label="humanise(c.status)" />
            <span class="el-age">
              <template v-if="c.status === 'pending'">{{ daysSince(c.receivedAt) }}d waiting</template>
              <template v-else>{{ fmtDate(c.decidedAt) }}</template>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Receive -->
    <UiSheet :open="recvOpen" title="Receive application" subtitle="Referred for health clearance" width="38rem" @update:open="recvOpen = $event">
      <form id="el-recv" class="ins-form" @submit.prevent="submitRecv">
        <label class="ins-field full"><span class="ins-label">Licence applied for</span>
          <select v-model="recv.licenceType" class="ins-input">
            <option v-for="t in LICENCE_TYPES" :key="t" :value="t">{{ LICENCE_LABELS[t] }}</option>
          </select></label>
        <label class="ins-field full"><span class="ins-label">Registered premises</span>
          <select v-model="recv.premisesId" class="ins-input" @change="pickPremises">
            <option value="">Not on the register yet</option>
            <option v-for="p in syncedPremises" :key="p.id" :value="p.id">{{ p.name }} · Stand {{ p.stand_number }}</option>
          </select>
          <span class="ins-hint">Link the premises so its inspections inform the decision.</span></label>
        <label class="ins-field"><span class="ins-label">Applicant</span><input v-model="recv.applicantName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Phone</span><input v-model="recv.applicantContact" class="ins-input" inputmode="tel" /></label>
        <label class="ins-field full"><span class="ins-label">Trading name</span><input v-model="recv.tradingName" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Stand</span><input v-model="recv.standNumber" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Ward / suburb</span><input v-model="recv.suburbWard" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Notes</span><textarea v-model="recv.notes" class="ins-input" rows="2" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="recvOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="el-recv" :loading="saving">Receive</UiButton>
      </template>
    </UiSheet>

    <!-- Decide -->
    <UiSheet :open="!!current" :title="current?.tradingName || current?.applicantName || ''"
             :subtitle="current ? `${current.reference} · ${LICENCE_LABELS[current.licenceType]}` : ''"
             width="40rem" @update:open="v => { if (!v) openId = null }">
      <div v-if="current" class="el-decide">
        <dl class="ins-dl">
          <div><dt>Applicant</dt><dd>{{ current.applicantName }}<template v-if="current.applicantContact"> · {{ current.applicantContact }}</template></dd></div>
          <div><dt>Premises</dt><dd>{{ current.premisesName || 'Not registered' }}<template v-if="current.standNumber"> · Stand {{ current.standNumber }}</template></dd></div>
          <div><dt>Received</dt><dd>{{ fmtDate(current.receivedAt) }}</dd></div>
          <div v-if="current.status !== 'pending'"><dt>Decided</dt><dd>{{ fmtDateTime(current.decidedAt) }} · {{ current.decidedByName }}</dd></div>
        </dl>

        <!-- Evidence -->
        <div v-if="!current.premisesId" class="ins-banner t-warning">
          <AlertTriangle :size="16" aria-hidden="true" />
          <div><strong>Not linked to a registered premises.</strong>
            <p>There is no inspection history to rely on. Register and inspect the premises before clearing it.</p></div>
        </div>
        <div v-else-if="evidence && evidence.latest" class="ins-banner" :class="evidence.recent ? (evidence.latest.verdict === 'pass' ? 't-positive' : 't-warning') : 't-warning'">
          <ClipboardCheck :size="16" aria-hidden="true" />
          <div>
            <strong>Latest inspection: {{ humanise(evidence.latest.verdict) }} · {{ evidence.age }} days ago</strong>
            <p>{{ INSPECTION_SCOPE_LABELS[evidence.latest.scope] }} · {{ evidence.latest.inspectorName }} — {{ evidence.latest.findings }}</p>
            <p v-if="!evidence.recent">Older than the {{ prefs.inspectionCycleDays }}-day cycle.</p>
          </div>
        </div>
        <div v-else-if="evidence" class="ins-banner t-warning">
          <AlertTriangle :size="16" aria-hidden="true" />
          <div><strong>This premises has never been inspected.</strong><p>Inspect it before deciding.</p></div>
        </div>
        <UiButton v-if="current.premisesId && !evidence?.recent" size="sm" @click="nav.go('inspections', { premises: current.premisesId })">
          <template #icon><ClipboardCheck :size="14" /></template>Inspect the premises first
        </UiButton>

        <form id="el-decide" class="ins-form" @submit.prevent="submitDecision">
          <div class="ins-field full"><span class="ins-label">Decision</span>
            <div class="ins-seg el-seg" role="radiogroup" aria-label="Decision">
              <button type="button" role="radio" class="t-positive" :aria-checked="decision.status === 'cleared'" @click="decision.status = 'cleared'">Clear</button>
              <button type="button" role="radio" :aria-checked="decision.status === 'conditional'" @click="decision.status = 'conditional'">Conditions</button>
              <button type="button" role="radio" class="t-negative" :aria-checked="decision.status === 'refused'" @click="decision.status = 'refused'">Refuse</button>
              <button type="button" role="radio" :aria-checked="decision.status === 'withdrawn'" @click="decision.status = 'withdrawn'">Withdrawn</button>
            </div></div>
          <label v-if="decision.status === 'conditional'" class="ins-field full"><span class="ins-label">Conditions</span>
            <textarea v-model="decision.conditions" class="ins-input" rows="3" placeholder="Install a grease trap before trading; provide hot water to the staff basin…" /></label>
          <label v-if="decision.status === 'refused'" class="ins-field full"><span class="ins-label">Grounds for refusal</span>
            <textarea v-model="decision.refusalReason" class="ins-input" rows="3" /></label>
          <label v-if="decision.status === 'cleared' || decision.status === 'conditional'" class="ins-field"><span class="ins-label">Valid until</span>
            <input v-model="decision.validUntil" type="date" class="ins-input" /></label>
          <label class="ins-field"><span class="ins-label">Deciding officer</span>
            <input v-model="decision.decidedByName" class="ins-input" autocomplete="name" /></label>
        </form>
      </div>
      <template #footer>
        <UiButton v-if="current && (current.status === 'cleared' || current.status === 'conditional')" size="sm" variant="ghost" @click="printCertificate(current)">
          <template #icon><Printer :size="14" /></template>Certificate</UiButton>
        <UiButton variant="ghost" @click="openId = null">Close</UiButton>
        <UiButton variant="primary" type="submit" form="el-decide" :loading="saving">
          <template #icon><CheckCircle2 :size="15" /></template>{{ current?.status === 'pending' ? 'Record decision' : 'Revise decision' }}</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.el-tools { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s3); flex-wrap:wrap; }
.el-search { flex:0 1 22rem; }
.el-select { width:auto; min-height:28px; padding:0 var(--ent-s2); font-size:var(--ent-fs-xs); border-radius:var(--ent-r-pill); }
.el-empty { display:flex; flex-direction:column; align-items:center; gap:var(--ent-s2); padding:var(--ent-s6); text-align:center; color:var(--ent-text-3); }
.el-empty p { margin:0; font-size:var(--ent-fs-sm); }
.el-empty strong { color:var(--ent-text); }

.el-row { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line);
  background:transparent; text-align:left; cursor:pointer; font-family:var(--ent-font);
  transition:background-color var(--ent-dur) var(--ent-ease); }
li:first-child > .el-row { border-top:0; }
.el-row:hover { background:var(--ent-surface-2); }
.el-row:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.el-icon { color:var(--ent-text-3); flex-shrink:0; }
.el-age { flex-shrink:0; min-width:6rem; text-align:right; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; color:var(--ent-text-2); }

.el-decide { display:flex; flex-direction:column; gap:var(--ent-s4); }
.el-decide > .ui-btn { align-self:flex-start; }
.el-seg { flex-wrap:wrap; }

@media (max-width: 767px) {
  .el-row { flex-wrap:wrap; }
  .el-age { min-width:0; text-align:left; }
  .el-search { flex:1 1 100%; }
}
</style>
