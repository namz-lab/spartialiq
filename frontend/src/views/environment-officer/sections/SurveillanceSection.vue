<script setup lang="ts">
// Surveillance — notifiable disease outbreaks, drinking-water quality and the
// nuisance complaint book. All three feed the periodic return to Council and
// the Director of Health Services.
//
// OUTBREAKS carry a catchment question: which food premises, water sources and
// complaints lie within N metres of the cluster (GET /eho/outbreaks/:id/catchment).
// That answer is evidence for the officer's decision, never the decision.
//
// WATER results are suggested from the readings (src/environment-officer/waterQuality.ts)
// so coliforms are never saved as "potable" by a slip — the officer still chooses.
//
// COMPLAINTS may be anonymous, and an anonymous complaint carries no contact
// details at all: the schema refuses them, and so does this form.
//
// URL: ?tab=outbreaks|water|complaints

import { computed, ref, watch } from 'vue'
import {
  useHealthCase,
  type NotifiableDisease, type OutbreakCase, type WaterSample, type NuisanceComplaint,
} from '@/composables/useHealthCase'
import { ehoApi, type CatchmentResult, type Position } from '@/services/environmentalHealth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { classifyWater, type WaterResult } from '@/environment-officer/waterQuality'
import { fmtDate, fmtDateTime, humanise, daysSince, wardLabel } from '@/environment-officer/console'
import { isPersonName, isZwPhone, parseOptionalNumber, sanitizePhone } from '@/utils/citizenValidation'
import { isServerId } from '@/composables/useHealthCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Activity, Droplet, MessageSquareWarning, Plus, Minus, Crosshair, Radar, CloudOff,
  AlertTriangle, CheckCircle2, EyeOff, Info,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()

type Tab = 'outbreaks' | 'water' | 'complaints'
const tab = computed<Tab>(() => {
  const t = nav.param('tab')
  return t === 'water' || t === 'complaints' ? t : 'outbreaks'
})
function setTab(t: Tab) { nav.setParam('tab', t === 'outbreaks' ? null : t) }

const counts = computed(() => ({
  outbreaks: hc.outbreaks.value.filter(o => o.status !== 'closed').length,
  water: hc.waterSamples.value.filter(s => s.result === 'not_potable' && (daysSince(s.sampledAt) ?? 999) <= 90).length,
  complaints: hc.complaints.value.filter(c => c.status === 'open' || c.status === 'investigating').length,
}))

// ── GPS (shared) ────────────────────────────────────────────────────
const locating = ref(false)
function captureGps(): Promise<Partial<Position> | null> {
  if (!('geolocation' in navigator)) {
    fb.showToast('This device cannot report its location.', 'warning')
    return Promise.resolve(null)
  }
  locating.value = true
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(
    p => { locating.value = false; resolve({ lng: p.coords.longitude, lat: p.coords.latitude, locationSource: 'field_gps', locationAccuracyM: Math.round(p.coords.accuracy) }) },
    () => { locating.value = false; fb.showToast('Location unavailable. Saved without a position.', 'warning'); resolve(null) },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
  ))
}

// ══ OUTBREAKS ════════════════════════════════════════════════════════
const DISEASES: NotifiableDisease[] = ['cholera', 'typhoid', 'dysentery', 'food_poisoning', 'measles', 'tb', 'covid', 'other']
const obFilter = ref<'open' | 'all'>('open')
const outbreaks = computed(() =>
  hc.outbreaks.value
    .filter(o => obFilter.value === 'all' || o.status !== 'closed')
    .sort((a, b) => +new Date(b.firstReportedAt) - +new Date(a.firstReportedAt)))

const obOpen = ref(false)
const blankOb = () => ({
  disease: 'cholera' as NotifiableDisease, suspectedSource: '', casesCount: 1, ward: '',
  actionsTaken: '', catchmentM: 500, position: null as Partial<Position> | null,
})
const obForm = ref(blankOb())

function logOutbreak() {
  const f = obForm.value
  if (!f.ward.trim()) return fb.showToast('Which ward is the cluster in?', 'warning')
  if (!f.suspectedSource.trim()) return fb.showToast('Record the suspected source, even if provisional.', 'warning')
  if (!Number.isInteger(Number(f.casesCount)) || Number(f.casesCount) < 1) {
    return fb.showToast('Cases must be a whole number of 1 or more.', 'warning')
  }
  const m = Number(f.catchmentM)
  if (!Number.isInteger(m) || m < 10 || m > 20000) return fb.showToast('Catchment must be 10–20 000 metres.', 'warning')
  hc.addOutbreak({
    disease: f.disease, firstReportedAt: new Date().toISOString(),
    suspectedSource: f.suspectedSource.trim(), casesCount: Number(f.casesCount),
    ward: f.ward.trim(), status: 'investigating', actionsTaken: f.actionsTaken.trim(),
    closedAt: null, catchmentM: m, ...(f.position ?? {}),
  } as Omit<OutbreakCase, 'id'>)
  obOpen.value = false
  obForm.value = blankOb()
  fb.showToast('Outbreak logged. Notify Provincial Disease Surveillance without delay (PHA s. 23).', 'success')
}

function bumpCases(o: OutbreakCase, delta: number) {
  const next = o.casesCount + delta
  if (next < 1) return
  hc.updateOutbreak(o.id, { casesCount: next })
}
function setContained(o: OutbreakCase) {
  hc.updateOutbreak(o.id, { status: 'contained' })
  fb.showToast('Outbreak marked contained.', 'info')
}
async function closeOutbreak(o: OutbreakCase) {
  const ok = await fb.confirmAction('Close outbreak',
    `Close the ${humanise(o.disease).toLowerCase()} outbreak in ${wardLabel(o.ward)}? Close it only once no new cases have presented for the incubation period.`,
    { confirmLabel: 'Close outbreak' })
  if (!ok) return
  hc.updateOutbreak(o.id, { status: 'closed', closedAt: new Date().toISOString() })
  fb.showToast('Outbreak closed.', 'success')
}

// Catchment
const catchFor = ref<OutbreakCase | null>(null)
const catchRadius = ref(500)
const catchData = ref<CatchmentResult | null>(null)
const catchLoading = ref(false)
const catchError = ref<string | null>(null)

async function openCatchment(o: OutbreakCase) {
  catchFor.value = o
  catchRadius.value = o.catchmentM ?? 500
  await runCatchment()
}
async function runCatchment() {
  const o = catchFor.value
  if (!o) return
  catchLoading.value = true
  catchError.value = null
  try {
    catchData.value = await ehoApi.catchment(o.id, catchRadius.value)
  } catch (err: unknown) {
    catchData.value = null
    catchError.value = fb.parseApiError(err, 'The catchment could not be computed.')
  } finally {
    catchLoading.value = false
  }
}

// ══ WATER ════════════════════════════════════════════════════════════
const SOURCE_TYPES = ['borehole', 'piped_supply', 'reservoir', 'well', 'river', 'dam', 'spring', 'other'] as const
const wsOpen = ref(false)
const blankWs = () => ({
  sourceLabel: '', sourceType: 'borehole' as WaterSample['sourceType'],
  ecoli: '', faecal: '', chlorine: '', ph: '',
  result: 'pending' as WaterResult, resultTouched: false,
  actionsTaken: '', position: null as Partial<Position> | null,
})
const wsForm = ref(blankWs())
const readings = computed(() => ({
  ecoliCount: parseOptionalNumber(wsForm.value.ecoli),
  faecalColiform: parseOptionalNumber(wsForm.value.faecal),
  freeChlorine: parseOptionalNumber(wsForm.value.chlorine),
  ph: parseOptionalNumber(wsForm.value.ph),
}))
const suggestion = computed(() => classifyWater(readings.value))
// Follow the suggestion until the officer picks a result themselves.
watch(suggestion, (s) => { if (!wsForm.value.resultTouched) wsForm.value.result = s.result })
const disagrees = computed(() =>
  wsForm.value.resultTouched && wsForm.value.result !== suggestion.value.result
  && !(wsForm.value.result === 'pending'))

function logSample() {
  const f = wsForm.value
  const r = readings.value
  if (!f.sourceLabel.trim()) return fb.showToast('Name the water source.', 'warning')
  for (const [label, v] of [['E. coli', r.ecoliCount], ['Faecal coliform', r.faecalColiform]] as const) {
    if (v != null && (v < 0 || !Number.isInteger(v))) return fb.showToast(`${label} must be a whole number of 0 or more.`, 'warning')
  }
  if (r.freeChlorine != null && r.freeChlorine < 0) return fb.showToast('Free chlorine cannot be negative.', 'warning')
  if (r.ph != null && (r.ph < 0 || r.ph > 14)) return fb.showToast('pH must be between 0 and 14.', 'warning')
  if (f.result === 'not_potable' && !f.actionsTaken.trim()) {
    return fb.showToast('A not-potable source needs the action taken: protected, chlorinated, closed or boil notice.', 'warning')
  }
  hc.addSample({
    sourceLabel: f.sourceLabel.trim(), sourceType: f.sourceType, sampledAt: new Date().toISOString(),
    ...r, result: f.result, actionsTaken: f.actionsTaken.trim(), ...(f.position ?? {}),
  } as Omit<WaterSample, 'id'>)
  wsOpen.value = false
  wsForm.value = blankWs()
  fb.showToast('Water sample recorded.', 'success')
}

const wsFilter = ref<'all' | 'failing'>('all')
const samples = computed(() =>
  hc.waterSamples.value
    .filter(s => wsFilter.value === 'all' || s.result === 'not_potable' || s.result === 'borderline')
    .sort((a, b) => +new Date(b.sampledAt) - +new Date(a.sampledAt)))
const RESULT_TONE: Record<WaterResult, 'positive' | 'negative' | 'warning' | 'neutral'> =
  { potable: 'positive', not_potable: 'negative', borderline: 'warning', pending: 'neutral' }

// ══ COMPLAINTS ═══════════════════════════════════════════════════════
const CATEGORIES: NuisanceComplaint['category'][] = ['smell', 'smoke', 'noise', 'vermin', 'waste', 'water', 'other']
const cpOpen = ref(false)
const blankCp = () => ({
  anonymous: false, complainantName: '', complainantContact: '',
  category: 'waste' as NuisanceComplaint['category'], description: '', premisesId: '',
  position: null as Partial<Position> | null,
})
const cpForm = ref(blankCp())
const cpStatus = ref<'active' | 'all'>('active')

function logComplaint() {
  const f = cpForm.value
  if (f.description.trim().length < 10) return fb.showToast('Describe the nuisance: what, where and since when.', 'warning')
  if (!f.anonymous) {
    if (f.complainantName.trim() && !isPersonName(f.complainantName)) return fb.showToast('Complainant name must be a person’s name.', 'warning')
    if (f.complainantContact.trim() && !isZwPhone(f.complainantContact)) return fb.showToast('Contact must be a Zimbabwe mobile number.', 'warning')
  }
  hc.addComplaint({
    receivedAt: new Date().toISOString(),
    anonymous: f.anonymous,
    complainantName: f.anonymous ? '' : f.complainantName.trim(),
    complainantContact: f.anonymous || !f.complainantContact.trim() ? '' : sanitizePhone(f.complainantContact),
    category: f.category, description: f.description.trim(),
    // Only link a premises the server knows; a local id would be refused.
    premisesId: f.premisesId && isServerId(f.premisesId) ? f.premisesId : null,
    status: 'open', abatementNoticeRef: null, ...(f.position ?? {}),
  } as Omit<NuisanceComplaint, 'id'>)
  cpOpen.value = false
  cpForm.value = blankCp()
  fb.showToast('Complaint registered.', 'success')
}

const complaints = computed(() =>
  hc.complaints.value
    .filter(c => cpStatus.value === 'all' || c.status === 'open' || c.status === 'investigating')
    .sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt)))
const premisesName = (id: string | null) => hc.registry.value.find(p => p.id === id)?.name ?? null

const NEXT_STATUS: Partial<Record<NuisanceComplaint['status'], { to: NuisanceComplaint['status']; label: string }>> = {
  open: { to: 'investigating', label: 'Start investigating' },
  investigating: { to: 'abated', label: 'Mark abated' },
  abated: { to: 'closed', label: 'Close' },
}
async function advance(c: NuisanceComplaint) {
  const step = NEXT_STATUS[c.status]
  if (!step) return
  if (step.to === 'abated') {
    const ok = await fb.confirmAction('Mark nuisance abated',
      'Confirm the nuisance was found abated on inspection. The complaint then awaits closure.', { confirmLabel: 'Mark abated' })
    if (!ok) return
  }
  hc.updateComplaint(c.id, { status: step.to })
  fb.showToast(`Complaint ${humanise(step.to).toLowerCase()}.`, 'info')
}
function noticeFor(c: NuisanceComplaint) {
  nav.go('enforcement', c.premisesId ? { premises: c.premisesId } : {})
}
const COMPLAINT_TONE: Record<NuisanceComplaint['status'], 'negative' | 'warning' | 'positive' | 'neutral'> =
  { open: 'negative', investigating: 'warning', abated: 'positive', closed: 'neutral' }
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Public Health Act · ss. 23, 79</span>
        <h2 class="ins-title">Surveillance</h2>
        <p class="ins-lede">Notifiable disease, drinking-water quality and public-health nuisance — recorded as they are reported, from the field or the office.</p>
      </div>
      <div class="ins-actions">
        <UiButton v-if="tab === 'outbreaks'" variant="primary" @click="obOpen = true"><template #icon><Plus :size="15" /></template>Log outbreak</UiButton>
        <UiButton v-else-if="tab === 'water'" variant="primary" @click="wsOpen = true"><template #icon><Plus :size="15" /></template>Record sample</UiButton>
        <UiButton v-else variant="primary" @click="cpOpen = true"><template #icon><Plus :size="15" /></template>Log complaint</UiButton>
      </div>
    </header>

    <div class="ins-seg" role="tablist" aria-label="Surveillance registers">
      <button type="button" role="tab" :aria-selected="tab === 'outbreaks'" @click="setTab('outbreaks')">
        <Activity :size="14" aria-hidden="true" /> Outbreaks <span v-if="counts.outbreaks" class="es-pill neg">{{ counts.outbreaks }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'water'" @click="setTab('water')">
        <Droplet :size="14" aria-hidden="true" /> Water quality <span v-if="counts.water" class="es-pill neg">{{ counts.water }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'complaints'" @click="setTab('complaints')">
        <MessageSquareWarning :size="14" aria-hidden="true" /> Complaints <span v-if="counts.complaints" class="es-pill">{{ counts.complaints }}</span>
      </button>
    </div>

    <!-- ══ OUTBREAKS ══════════════════════════════════════════════ -->
    <template v-if="tab === 'outbreaks'">
      <div class="ins-chips" role="group" aria-label="Show">
        <button type="button" class="ins-chip" :aria-pressed="obFilter === 'open'" @click="obFilter = 'open'">Open</button>
        <button type="button" class="ins-chip" :aria-pressed="obFilter === 'all'" @click="obFilter = 'all'">All, including closed</button>
      </div>
      <div v-if="!outbreaks.length" class="ins-card es-empty">
        <CheckCircle2 :size="22" aria-hidden="true" />
        <p><strong>No {{ obFilter === 'open' ? 'open ' : '' }}outbreaks.</strong></p>
        <p class="ins-hint">A suspected notifiable condition is logged the moment it is reported — before it is confirmed.</p>
      </div>
      <div v-else class="es-grid">
        <article v-for="o in outbreaks" :key="o.id" class="ins-card es-ob" :class="`s-${o.status}`">
          <div class="ins-card-head">
            <h3><AlertTriangle :size="16" aria-hidden="true" /> {{ humanise(o.disease) }}</h3>
            <UiStatusBadge :tone="o.status === 'investigating' ? 'negative' : o.status === 'contained' ? 'warning' : 'neutral'" :label="humanise(o.status)" />
          </div>
          <div class="ins-card-body es-ob-body">
            <div class="es-cases">
              <button v-if="o.status !== 'closed'" type="button" class="ins-iconbtn" :disabled="o.casesCount <= 1" @click="bumpCases(o, -1)">
                <Minus :size="14" aria-hidden="true" /><span class="ent-sr-only">One fewer case</span>
              </button>
              <span class="es-cases-n" aria-live="polite">{{ o.casesCount }}<small>case{{ o.casesCount === 1 ? '' : 's' }}</small></span>
              <button v-if="o.status !== 'closed'" type="button" class="ins-iconbtn" @click="bumpCases(o, 1)">
                <Plus :size="14" aria-hidden="true" /><span class="ent-sr-only">One more case</span>
              </button>
            </div>
            <dl class="ins-dl">
              <div><dt>Ward</dt><dd>{{ wardLabel(o.ward) }}</dd></div>
              <div><dt>Reported</dt><dd>{{ fmtDate(o.firstReportedAt) }}</dd></div>
              <div><dt>Suspected source</dt><dd>{{ o.suspectedSource }}</dd></div>
              <div><dt>Reference</dt><dd class="ins-mono">{{ o.reference || (o.pendingSync ? 'On sync' : '—') }}</dd></div>
            </dl>
            <p v-if="o.actionsTaken" class="ins-hint es-pre">{{ o.actionsTaken }}</p>
            <p v-if="o.pendingSync" class="es-held"><CloudOff :size="12" aria-hidden="true" /> Held on this device</p>
          </div>
          <div class="ins-card-foot">
            <UiButton size="sm" variant="ghost" :disabled="!isServerId(o.id)" @click="openCatchment(o)">
              <template #icon><Radar :size="14" /></template>Catchment
            </UiButton>
            <UiButton v-if="o.status === 'investigating'" size="sm" @click="setContained(o)">Contained</UiButton>
            <UiButton v-if="o.status !== 'closed'" size="sm" @click="closeOutbreak(o)">Close</UiButton>
          </div>
        </article>
      </div>
    </template>

    <!-- ══ WATER ══════════════════════════════════════════════════ -->
    <section v-else-if="tab === 'water'" class="ins-card" aria-label="Water quality register">
      <div class="ins-card-head">
        <h3><Droplet :size="16" aria-hidden="true" /> Samples</h3>
        <div class="ins-chips">
          <button type="button" class="ins-chip" :aria-pressed="wsFilter === 'all'" @click="wsFilter = 'all'">All</button>
          <button type="button" class="ins-chip" :aria-pressed="wsFilter === 'failing'" @click="wsFilter = 'failing'">Failing or borderline</button>
        </div>
      </div>
      <p v-if="!samples.length" class="es-empty-p">No samples {{ wsFilter === 'failing' ? 'failing' : 'recorded' }}.</p>
      <div v-else class="es-table-wrap">
        <table class="es-table">
          <thead>
            <tr><th scope="col">Source</th><th scope="col">Sampled</th><th scope="col" class="num">E. coli</th>
              <th scope="col" class="num">Faecal</th><th scope="col" class="num">Cl₂ mg/L</th><th scope="col" class="num">pH</th>
              <th scope="col">Result</th><th scope="col">Action</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in samples" :key="s.id">
              <td><strong>{{ s.sourceLabel }}</strong><small>{{ humanise(s.sourceType) }}<template v-if="s.reference"> · {{ s.reference }}</template></small></td>
              <td>{{ fmtDate(s.sampledAt) }}</td>
              <td class="num" :class="{ bad: (s.ecoliCount ?? 0) > 0 }">{{ s.ecoliCount ?? '—' }}</td>
              <td class="num" :class="{ bad: (s.faecalColiform ?? 0) > 0 }">{{ s.faecalColiform ?? '—' }}</td>
              <td class="num">{{ s.freeChlorine ?? '—' }}</td>
              <td class="num">{{ s.ph ?? '—' }}</td>
              <td><UiStatusBadge :tone="RESULT_TONE[s.result]" :label="humanise(s.result)" />
                <CloudOff v-if="s.pendingSync" :size="12" class="es-held-icon" aria-label="Held on this device" /></td>
              <td class="es-action">{{ s.actionsTaken || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ══ COMPLAINTS ═════════════════════════════════════════════ -->
    <section v-else class="ins-card" aria-label="Nuisance complaints">
      <div class="ins-card-head">
        <h3><MessageSquareWarning :size="16" aria-hidden="true" /> Complaint book</h3>
        <div class="ins-chips">
          <button type="button" class="ins-chip" :aria-pressed="cpStatus === 'active'" @click="cpStatus = 'active'">Open</button>
          <button type="button" class="ins-chip" :aria-pressed="cpStatus === 'all'" @click="cpStatus = 'all'">All</button>
        </div>
      </div>
      <p v-if="!complaints.length" class="es-empty-p">No {{ cpStatus === 'active' ? 'open ' : '' }}complaints.</p>
      <ul v-else class="ins-rows">
        <li v-for="c in complaints" :key="c.id" class="ins-row es-cp">
          <div class="ins-row-main">
            <div class="es-cp-head">
              <UiStatusBadge :tone="COMPLAINT_TONE[c.status]" :label="humanise(c.status)" />
              <strong>{{ humanise(c.category) }}</strong>
              <span class="es-muted">{{ fmtDateTime(c.receivedAt) }}</span>
              <span v-if="c.reference" class="ins-mono es-muted">{{ c.reference }}</span>
            </div>
            <p class="es-cp-desc">{{ c.description }}</p>
            <p class="es-muted es-cp-meta">
              <template v-if="c.anonymous"><EyeOff :size="12" aria-hidden="true" /> Anonymous</template>
              <template v-else>{{ c.complainantName || 'Name not given' }}<template v-if="c.complainantContact"> · {{ c.complainantContact }}</template></template>
              <template v-if="premisesName(c.premisesId)"> · {{ premisesName(c.premisesId) }}</template>
              <template v-if="c.pendingSync"> · <CloudOff :size="12" aria-hidden="true" /> held on this device</template>
            </p>
          </div>
          <div class="es-cp-actions">
            <UiButton v-if="NEXT_STATUS[c.status]" size="sm" @click="advance(c)">{{ NEXT_STATUS[c.status]!.label }}</UiButton>
            <UiButton v-if="c.status === 'investigating'" size="sm" variant="ghost" @click="noticeFor(c)">Issue notice</UiButton>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Sheets ─────────────────────────────────────────────────── -->
    <UiSheet :open="obOpen" title="Log outbreak" subtitle="Notifiable condition" width="36rem" @update:open="obOpen = $event">
      <form id="es-ob-form" class="ins-form" @submit.prevent="logOutbreak">
        <label class="ins-field"><span class="ins-label">Condition</span>
          <select v-model="obForm.disease" class="ins-input">
            <option v-for="d in DISEASES" :key="d" :value="d">{{ humanise(d) }}</option>
          </select></label>
        <label class="ins-field"><span class="ins-label">Cases so far</span>
          <input v-model.number="obForm.casesCount" type="number" min="1" step="1" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Ward</span>
          <input v-model="obForm.ward" class="ins-input" placeholder="e.g. 3" /></label>
        <label class="ins-field"><span class="ins-label">Catchment radius (m)</span>
          <input v-model.number="obForm.catchmentM" type="number" min="10" max="20000" step="50" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Suspected source</span>
          <input v-model="obForm.suspectedSource" class="ins-input" placeholder="e.g. Ward 3 borehole; food vendor at the bus stop" /></label>
        <label class="ins-field full"><span class="ins-label">Actions taken</span>
          <textarea v-model="obForm.actionsTaken" class="ins-input" rows="3" placeholder="Containment, chlorination, premises closed, clinic informed…" /></label>
        <div class="ins-field full es-gps">
          <button type="button" class="ins-chip" :disabled="locating" @click="captureGps().then(p => { if (p) obForm.position = p })">
            <Crosshair :size="13" aria-hidden="true" :class="{ 'ins-spin': locating }" />
            {{ obForm.position ? 'Position captured' : 'Place at my position' }}
          </button>
          <span class="ins-hint">A position is what lets the catchment be computed.</span>
        </div>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="obOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="es-ob-form">Log outbreak</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="wsOpen" title="Record water sample" subtitle="Drinking-water quality" width="38rem" @update:open="wsOpen = $event">
      <form id="es-ws-form" class="ins-form" @submit.prevent="logSample">
        <label class="ins-field"><span class="ins-label">Source</span>
          <input v-model="wsForm.sourceLabel" class="ins-input" placeholder="e.g. Ward 3 borehole" /></label>
        <label class="ins-field"><span class="ins-label">Source type</span>
          <select v-model="wsForm.sourceType" class="ins-input">
            <option v-for="t in SOURCE_TYPES" :key="t" :value="t">{{ humanise(t) }}</option>
          </select></label>
        <label class="ins-field"><span class="ins-label">E. coli (CFU/100 ml)</span>
          <input v-model="wsForm.ecoli" inputmode="numeric" class="ins-input" placeholder="0" /></label>
        <label class="ins-field"><span class="ins-label">Faecal coliform (CFU/100 ml)</span>
          <input v-model="wsForm.faecal" inputmode="numeric" class="ins-input" placeholder="0" /></label>
        <label class="ins-field"><span class="ins-label">Free chlorine (mg/L)</span>
          <input v-model="wsForm.chlorine" inputmode="decimal" class="ins-input" placeholder="0.5" /></label>
        <label class="ins-field"><span class="ins-label">pH</span>
          <input v-model="wsForm.ph" inputmode="decimal" class="ins-input" placeholder="7.0" /></label>

        <div class="ins-field full">
          <span class="ins-label">Result</span>
          <div class="ins-seg" role="radiogroup" aria-label="Result">
            <button v-for="r in (['potable', 'borderline', 'not_potable', 'pending'] as WaterResult[])" :key="r" type="button" role="radio"
                    :class="r === 'potable' ? 't-positive' : r === 'not_potable' ? 't-negative' : ''"
                    :aria-checked="wsForm.result === r" @click="wsForm.result = r; wsForm.resultTouched = true">
              {{ humanise(r) }}
            </button>
          </div>
          <p class="ins-banner es-suggest" :class="suggestion.result === 'not_potable' ? 't-negative' : suggestion.result === 'borderline' ? 't-warning' : 't-info'">
            <Info :size="15" aria-hidden="true" />
            <span>Readings suggest <strong>{{ humanise(suggestion.result).toLowerCase() }}</strong>.
              <template v-if="suggestion.reasons.length">{{ suggestion.reasons.join('; ') }}.</template>
              <template v-if="disagrees"> Your selection differs — record why below.</template></span>
          </p>
        </div>
        <label class="ins-field full"><span class="ins-label">Action taken</span>
          <textarea v-model="wsForm.actionsTaken" class="ins-input" rows="2" placeholder="Source protected, hyperchlorinated, closed, boil-water notice issued…" /></label>
        <div class="ins-field full es-gps">
          <button type="button" class="ins-chip" :disabled="locating" @click="captureGps().then(p => { if (p) wsForm.position = p })">
            <Crosshair :size="13" aria-hidden="true" :class="{ 'ins-spin': locating }" />
            {{ wsForm.position ? 'Position captured' : 'Place at my position' }}
          </button>
        </div>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="wsOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="es-ws-form">Record sample</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="cpOpen" title="Log complaint" subtitle="Public-health nuisance" width="36rem" @update:open="cpOpen = $event">
      <form id="es-cp-form" class="ins-form" @submit.prevent="logComplaint">
        <div class="ins-field full">
          <span class="ins-label">Category</span>
          <div class="ins-chips" role="radiogroup" aria-label="Category">
            <button v-for="c in CATEGORIES" :key="c" type="button" class="ins-chip" role="radio"
                    :aria-checked="cpForm.category === c" :aria-pressed="cpForm.category === c" @click="cpForm.category = c">{{ humanise(c) }}</button>
          </div>
        </div>
        <label class="ins-field full"><span class="ins-label">Description</span>
          <textarea v-model="cpForm.description" class="ins-input" rows="3" placeholder="What the nuisance is, where exactly, and since when." /></label>
        <label class="ins-field full"><span class="ins-label">Premises (if known)</span>
          <select v-model="cpForm.premisesId" class="ins-input">
            <option value="">Not linked to a registered premises</option>
            <option v-for="p in hc.registry.value" :key="p.id" :value="p.id">{{ p.name }} · Stand {{ p.stand_number }}</option>
          </select></label>
        <label class="ins-check full" :class="{ on: cpForm.anonymous }">
          <input v-model="cpForm.anonymous" type="checkbox" />
          <span><strong>Anonymous report</strong>
            <small>No name or contact is stored. The complainant has to go on living next to the person they reported.</small></span>
        </label>
        <template v-if="!cpForm.anonymous">
          <label class="ins-field"><span class="ins-label">Complainant name</span>
            <input v-model="cpForm.complainantName" class="ins-input" /></label>
          <label class="ins-field"><span class="ins-label">Phone</span>
            <input v-model="cpForm.complainantContact" class="ins-input" inputmode="tel" /></label>
        </template>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="cpOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="es-cp-form">Log complaint</UiButton>
      </template>
    </UiSheet>

    <UiSheet :open="!!catchFor" :title="catchFor ? `${humanise(catchFor.disease)} catchment` : 'Catchment'"
             :subtitle="catchFor ? wardLabel(catchFor.ward) : ''" width="40rem" @update:open="v => { if (!v) catchFor = null }">
      <div class="es-catch">
        <form class="es-catch-radius" @submit.prevent="runCatchment">
          <label class="ins-field"><span class="ins-label">Radius (m)</span>
            <input v-model.number="catchRadius" type="number" min="10" max="20000" step="50" class="ins-input" /></label>
          <UiButton type="submit" :loading="catchLoading">Recompute</UiButton>
        </form>
        <p v-if="catchError" class="ins-banner t-negative"><CloudOff :size="15" aria-hidden="true" /><span>{{ catchError }}</span></p>
        <template v-else-if="catchData">
          <p v-if="!catchData.positioned" class="ins-banner t-warning">
            <AlertTriangle :size="15" aria-hidden="true" />
            <span>This outbreak has no recorded position, so nothing can be measured from it. Place it from the map, or log positions on new outbreaks.</span>
          </p>
          <template v-else>
            <p class="ins-hint">Within {{ catchData.radiusM }} m. Distances are evidence for a decision, not the decision.</p>
            <div class="es-catch-cols">
              <div>
                <h4>Water sources <span>{{ catchData.waterSamples.length }}</span></h4>
                <ul><li v-for="w in catchData.waterSamples" :key="w.id">
                  <UiStatusBadge :tone="RESULT_TONE[w.result]" :label="humanise(w.result)" />
                  {{ w.sourceLabel }} <small>{{ Math.round(w.distanceM) }} m</small></li>
                  <li v-if="!catchData.waterSamples.length" class="es-muted">None sampled inside</li></ul>
              </div>
              <div>
                <h4>Food premises <span>{{ catchData.premises.length }}</span></h4>
                <ul><li v-for="p in catchData.premises" :key="p.id">
                  <button type="button" class="es-linkbtn" @click="catchFor = null; nav.go('inspections', { premises: p.id })">{{ p.name }}</button>
                  <small>{{ Math.round(p.distanceM) }} m</small></li>
                  <li v-if="!catchData.premises.length" class="es-muted">None registered inside</li></ul>
              </div>
              <div>
                <h4>Complaints <span>{{ catchData.complaints.length }}</span></h4>
                <ul><li v-for="c in catchData.complaints" :key="c.id">{{ humanise(c.category) }} <small>{{ Math.round(c.distanceM) }} m</small></li>
                  <li v-if="!catchData.complaints.length" class="es-muted">None inside</li></ul>
              </div>
            </div>
            <ul v-if="catchData.limitations.length" class="es-limits">
              <li v-for="(l, i) in catchData.limitations" :key="i">{{ l }}</li>
            </ul>
          </template>
        </template>
        <div v-else-if="catchLoading" aria-busy="true"><span class="ins-skel" /><span class="ins-skel" style="margin-top:8px;width:60%" /></div>
      </div>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.es-pill { min-width:1.2rem; padding:0 5px; border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); line-height:1.2rem; color:var(--ent-tone-warning-fg); background:var(--ent-tone-warning-bg); }
.es-pill.neg { color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }

.es-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap:var(--ent-s4); }
.es-ob { display:flex; flex-direction:column; border-top:3px solid var(--ent-line-strong); }
.es-ob.s-investigating { border-top-color:var(--ent-danger); }
.es-ob.s-contained { border-top-color:var(--ent-warning); }
.es-ob-body { flex:1; display:flex; flex-direction:column; gap:var(--ent-s3); }
.es-cases { display:flex; align-items:center; gap:var(--ent-s3); }
.es-cases-n { display:flex; align-items:baseline; gap:var(--ent-s1); font-size:var(--ent-fs-xl); font-weight:var(--ent-fw-bold);
  font-variant-numeric:tabular-nums; color:var(--ent-text); min-width:5rem; justify-content:center; }
.es-cases-n small { font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium); color:var(--ent-text-3); }
.es-pre { margin:0; white-space:pre-line; }
.es-held { display:flex; align-items:center; gap:4px; margin:0; font-size:var(--ent-fs-xs); color:var(--ent-tone-warning-fg); }
.es-held-icon { color:var(--ent-warning); margin-left:4px; vertical-align:middle; }

.es-empty { display:flex; flex-direction:column; align-items:center; gap:var(--ent-s1); padding:var(--ent-s6); text-align:center; color:var(--ent-success); }
.es-empty p { margin:0; }
.es-empty strong { color:var(--ent-text); }
.es-empty-p { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.es-muted { color:var(--ent-text-3); }

.es-table-wrap { overflow-x:auto; }
.es-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.es-table th { position:sticky; top:0; padding:var(--ent-s2) var(--ent-s3); text-align:left; white-space:nowrap;
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase;
  color:var(--ent-text-3); background:var(--ent-surface-2); border-bottom:1px solid var(--ent-line); }
.es-table td { padding:var(--ent-s3); border-bottom:1px solid var(--ent-line); vertical-align:top; color:var(--ent-text); }
.es-table td small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.es-table .num { text-align:right; font-variant-numeric:tabular-nums; }
.es-table td.bad { color:var(--ent-danger); font-weight:var(--ent-fw-bold); }
.es-table tbody tr:hover { background:var(--ent-surface-2); }
.es-action { max-width:18rem; color:var(--ent-text-2); }

.es-cp { align-items:flex-start; flex-wrap:wrap; }
.es-cp-head { display:flex; align-items:center; flex-wrap:wrap; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.es-cp-desc { margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text); line-height:var(--ent-lh); }
.es-cp-meta { display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-xs); }
.es-cp-actions { display:flex; gap:var(--ent-s2); flex-wrap:wrap; }

.es-gps { flex-direction:row; align-items:center; flex-wrap:wrap; gap:var(--ent-s2); }
.es-gps .ins-chip { display:inline-flex; align-items:center; gap:var(--ent-s1); }
.es-suggest { margin-top:var(--ent-s2); }
.ins-check.full { grid-column:1 / -1; }

.es-catch { display:flex; flex-direction:column; gap:var(--ent-s3); }
.es-catch-radius { display:flex; align-items:flex-end; gap:var(--ent-s2); }
.es-catch-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(10rem, 1fr)); gap:var(--ent-s4); }
.es-catch-cols h4 { margin:0 0 var(--ent-s2); font-size:var(--ent-fs-sm); color:var(--ent-text); }
.es-catch-cols h4 span { color:var(--ent-text-3); font-weight:var(--ent-fw-medium); }
.es-catch-cols ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.es-catch-cols small { color:var(--ent-text-3); font-variant-numeric:tabular-nums; }
.es-limits { margin:0; padding-left:var(--ent-s5); font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.es-linkbtn { border:0; background:none; padding:0; cursor:pointer; font:inherit; color:var(--ent-accent); text-align:left; }
.es-linkbtn:hover { text-decoration:underline; }
</style>
