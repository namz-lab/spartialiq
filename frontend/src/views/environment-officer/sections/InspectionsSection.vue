<script setup lang="ts">
// Inspections — the premises register and everything done at a premises.
//
//   Register       the premises, ranked by inspection risk, and the case sheet
//                  for one: details, record-an-inspection, and its history.
//   Follow-ups     failed and conditional inspections owed a return visit.
//   Construction   joint stage inspections with the Building Inspector
//                  (Stage 7 drainage, 8 sanitary fittings, 9 occupation).
//
// The register and inspections are offline-first (useHealthCase): an officer
// records a failed kitchen standing in it, with no signal, and the record is
// sent when the connection returns. Nothing here waits on the network to
// show what was just written.
//
// URL: ?tab=register|followups|construction  ?premises=<id>

import { computed, ref, watch } from 'vue'
import { dmApi, type StageInspection, type PermitApplication } from '@/services/developmentManagementService'
import { isPermitApproved } from '@/composables/useApplicationPipeline'
import { useHealthCase, type PremisesRecord, type PremisesType } from '@/composables/useHealthCase'
import {
  INSPECTION_SCOPE_LABELS, type InspectionScope, type InspectionVerdict,
} from '@/services/environmentalHealthOps'
import type { Position } from '@/services/environmentalHealth'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { useEhoPreferences } from '@/environment-officer/useEhoPreferences'
import { isOverdue, daysSince, daysUntil, fmtDate, fmtDateTime, humanise, isoDay } from '@/environment-officer/console'
import { isPersonName, isZwPhone, sanitizePhone } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Building, Plus, Search, Pencil, Trash2, MapPin, Crosshair, CalendarClock,
  ClipboardCheck, HardHat, RefreshCw, CloudOff, ArrowLeft, ShieldAlert, Store,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()
const { prefs } = useEhoPreferences()

type Tab = 'register' | 'followups' | 'construction'
const tab = computed<Tab>(() => {
  const t = nav.param('tab')
  return t === 'followups' || t === 'construction' ? t : 'register'
})
function setTab(t: Tab) { nav.setParam('tab', t === 'register' ? null : t) }

const PREMISES_TYPES: { value: PremisesType; label: string }[] = [
  { value: 'bakery', label: 'Bakery' }, { value: 'butchery', label: 'Butchery' },
  { value: 'restaurant', label: 'Restaurant' }, { value: 'tea_room', label: 'Tea room' },
  { value: 'boarding_house', label: 'Boarding house' }, { value: 'hotel', label: 'Hotel' },
  { value: 'general_dealer', label: 'General dealer' }, { value: 'bottle_store', label: 'Bottle store' },
  { value: 'beerhall', label: 'Beerhall' }, { value: 'creche', label: 'Crèche' },
  { value: 'school', label: 'School' }, { value: 'hostel', label: 'Hostel' },
  { value: 'tuck_shop', label: 'Tuck shop' }, { value: 'supermarket', label: 'Supermarket' },
  { value: 'factory', label: 'Factory' }, { value: 'workshop', label: 'Workshop' },
  { value: 'nightclub', label: 'Nightclub' }, { value: 'lodge', label: 'Lodge' },
  { value: 'abattoir', label: 'Abattoir' }, { value: 'other', label: 'Other' },
]

// ── Register ────────────────────────────────────────────────────────
const search = ref('')
const filter = ref<'due' | 'all' | PremisesType>('all')
const cycle = computed(() => prefs.value.inspectionCycleDays)

const dueCount = computed(() => hc.registry.value.filter(p => isOverdue(p.last_inspected_at, cycle.value)).length)

const premisesList = computed(() => {
  let arr = hc.registry.value
  if (filter.value === 'due') arr = arr.filter(p => isOverdue(p.last_inspected_at, cycle.value))
  else if (filter.value !== 'all') arr = arr.filter(p => p.type === filter.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    arr = arr.filter(p =>
      `${p.name} ${p.reference ?? ''} ${p.operator_name} ${p.stand_number} ${p.suburb_ward}`.toLowerCase().includes(q))
  }
  // Risk order: never inspected, then the longest gap, then by name.
  return [...arr].sort((a, b) => {
    const da = daysSince(a.last_inspected_at) ?? Infinity
    const db = daysSince(b.last_inspected_at) ?? Infinity
    return db - da || a.name.localeCompare(b.name)
  })
})

const selectedId = computed(() => nav.param('premises'))
const selected = computed<PremisesRecord | null>(() =>
  hc.registry.value.find(p => p.id === selectedId.value) ?? null)
function openPremises(id: string | null) { nav.setParam('premises', id) }

const history = computed(() =>
  hc.inspections.value
    .filter(i => i.premisesId === selectedId.value)
    .sort((a, b) => +new Date(b.inspectedAt) - +new Date(a.inspectedAt)))

const openComplaintsHere = computed(() =>
  hc.complaints.value.filter(c => c.premisesId === selectedId.value && (c.status === 'open' || c.status === 'investigating')))

function ageLabel(p: PremisesRecord) {
  const d = daysSince(p.last_inspected_at)
  return d === null ? 'Never inspected' : d === 0 ? 'Inspected today' : `${d} day${d === 1 ? '' : 's'} ago`
}

// ── Position capture ────────────────────────────────────────────────
// A GPS fix taken on site, labelled as one. Never silently substituted by a
// guess: if the device cannot fix, the record simply carries no position.
const locating = ref(false)
function captureGps(): Promise<Partial<Position> | null> {
  if (!('geolocation' in navigator)) {
    fb.showToast('This device cannot report its location.', 'warning')
    return Promise.resolve(null)
  }
  locating.value = true
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        locating.value = false
        resolve({
          lng: pos.coords.longitude, lat: pos.coords.latitude,
          locationSource: 'field_gps', locationAccuracyM: Math.round(pos.coords.accuracy),
        })
      },
      () => {
        locating.value = false
        fb.showToast('Location unavailable. The record will be saved without a position.', 'warning')
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}

// ── Add / edit premises ─────────────────────────────────────────────
interface PremForm {
  id?: string; name: string; type: PremisesType; stand_number: string; suburb_ward: string
  operator_name: string; operator_contact: string; notes: string; position: Partial<Position> | null
}
const blankPrem = (): PremForm => ({
  name: '', type: 'general_dealer', stand_number: '', suburb_ward: '',
  operator_name: '', operator_contact: '', notes: '', position: null,
})
const premOpen = ref(false)
const premForm = ref<PremForm>(blankPrem())

function startAdd() { premForm.value = blankPrem(); premOpen.value = true }
function startEdit(p: PremisesRecord) {
  premForm.value = {
    id: p.id, name: p.name, type: p.type, stand_number: p.stand_number, suburb_ward: p.suburb_ward,
    operator_name: p.operator_name, operator_contact: p.operator_contact, notes: p.notes,
    position: p.lng != null ? { lng: p.lng, lat: p.lat, locationSource: p.locationSource, locationAccuracyM: p.locationAccuracyM } : null,
  }
  premOpen.value = true
}
async function premGps() {
  const pos = await captureGps()
  if (pos) premForm.value.position = pos
}

function savePremises() {
  const f = premForm.value
  if (f.name.trim().length < 2) return fb.showToast('Give the premises a name.', 'warning')
  if (!f.stand_number.trim()) return fb.showToast('A stand number is required to find the premises again.', 'warning')
  if (f.operator_name.trim() && !isPersonName(f.operator_name)) {
    return fb.showToast('Operator name must be a person’s name, or left blank.', 'warning')
  }
  if (f.operator_contact.trim() && !isZwPhone(f.operator_contact)) {
    return fb.showToast('Operator contact must be a Zimbabwe mobile number, or left blank.', 'warning')
  }
  const existing = f.id ? hc.registry.value.find(r => r.id === f.id) : null
  const rec = hc.upsertPremises({
    ...(existing ?? {}),
    id: f.id,
    name: f.name.trim(), type: f.type,
    stand_number: f.stand_number.trim(), suburb_ward: f.suburb_ward.trim(),
    operator_name: f.operator_name.trim(),
    operator_contact: f.operator_contact.trim() ? sanitizePhone(f.operator_contact) : '',
    notes: f.notes.trim(),
    permit_application_id: existing?.permit_application_id ?? null,
    last_inspected_at: existing?.last_inspected_at ?? null,
    fitness_certificate_no: existing?.fitness_certificate_no ?? null,
    fitness_certificate_expiry: existing?.fitness_certificate_expiry ?? null,
    ...(f.position ?? {}),
  })
  premOpen.value = false
  fb.showToast(f.id ? 'Premises updated.' : 'Premises added to the register.', 'success')
  openPremises(rec.id)
}

async function removeSelected() {
  const p = selected.value
  if (!p) return
  const ok = await fb.confirmAction(
    'Remove from the register',
    `Remove ${p.name} from the premises register? Use this for a duplicate entry. Its inspections stay on the council record.`,
    { confirmLabel: 'Remove premises', danger: true },
  )
  if (!ok) return
  hc.removePremises(p.id)
  openPremises(null)
  fb.showToast('Premises removed from the register.', 'info')
}

// ── Record inspection ───────────────────────────────────────────────
const SCOPES = Object.entries(INSPECTION_SCOPE_LABELS) as [InspectionScope, string][]
const VERDICTS: { value: InspectionVerdict; label: string; tone: string }[] = [
  { value: 'pass', label: 'Pass', tone: 't-positive' },
  { value: 'conditional', label: 'Conditional', tone: '' },
  { value: 'fail', label: 'Fail', tone: 't-negative' },
]
interface InspForm {
  scope: InspectionScope; verdict: InspectionVerdict; inspectorName: string
  findings: string; actionRequired: string; followUpDate: string
  position: Partial<Position> | null
}
const blankInsp = (): InspForm => ({
  scope: 'food_hygiene', verdict: 'pass', inspectorName: auth.userName || '',
  findings: '', actionRequired: '', followUpDate: '', position: null,
})
const insp = ref<InspForm>(blankInsp())
watch(selectedId, () => { insp.value = blankInsp() })

// A failed verdict with no date to come back is an inspection that will be forgotten.
watch(() => insp.value.verdict, (v) => {
  if (v !== 'pass' && !insp.value.followUpDate) {
    const d = new Date(); d.setDate(d.getDate() + (v === 'fail' ? 7 : 14))
    insp.value.followUpDate = isoDay(d)
  }
})

async function inspGps() {
  const pos = await captureGps()
  if (pos) insp.value.position = pos
}

function recordInspection() {
  const p = selected.value
  if (!p) return
  const f = insp.value
  if (!isPersonName(f.inspectorName)) return fb.showToast('Enter the inspecting officer’s name.', 'warning')
  if (!f.findings.trim()) return fb.showToast('Record what was observed.', 'warning')
  if (f.verdict !== 'pass' && !f.actionRequired.trim()) {
    return fb.showToast('A fail or conditional verdict must state the action required — the notice quotes it.', 'warning')
  }
  if (f.followUpDate && f.followUpDate < isoDay()) {
    return fb.showToast('The follow-up date cannot be in the past.', 'warning')
  }
  const rec = hc.recordInspection({
    premisesId: p.id,
    inspectorName: f.inspectorName.trim(),
    scope: f.scope, verdict: f.verdict,
    findings: f.findings.trim(),
    actionRequired: f.verdict === 'pass' ? null : f.actionRequired.trim(),
    followUpDate: f.followUpDate || null,
    ...(f.position ?? {}),
  })
  insp.value = blankInsp()
  fb.showToast(
    rec.pendingSync && !navigator.onLine
      ? 'Inspection saved on this device. It will be sent when the connection returns.'
      : 'Inspection recorded.',
    'success',
  )
}

function issueNoticeFrom(i: { premisesId: string }) {
  nav.go('enforcement', { premises: i.premisesId })
}

// ── Follow-ups ──────────────────────────────────────────────────────
const followUps = computed(() =>
  hc.inspections.value
    .filter(i => i.verdict !== 'pass' && i.followUpDate)
    // Only the latest inspection per premises owes a visit: a later pass
    // discharges an earlier fail.
    .filter(i => !hc.inspections.value.some(o =>
      o.premisesId === i.premisesId && +new Date(o.inspectedAt) > +new Date(i.inspectedAt)))
    .sort((a, b) => (a.followUpDate ?? '').localeCompare(b.followUpDate ?? '')))
const followUpsDue = computed(() => followUps.value.filter(i => (daysUntil(i.followUpDate) ?? 1) <= 0).length)

// ── Construction-stage joint inspections ────────────────────────────
const permits = ref<PermitApplication[]>([])
const stageInsps = ref<Record<string, StageInspection[]>>({})
const loadingPermits = ref(false)
const permitsError = ref<string | null>(null)

async function loadConstructionPermits() {
  loadingPermits.value = true
  permitsError.value = null
  try {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    permits.value = r.data.filter(p => isPermitApproved(p.status))
    const results = await Promise.allSettled(permits.value.slice(0, 40).map(p => dmApi.listStageInspections(p.id)))
    const next: Record<string, StageInspection[]> = {}
    permits.value.slice(0, 40).forEach((p, i) => {
      const res = results[i]
      if (res.status === 'fulfilled') next[p.id] = res.value
    })
    stageInsps.value = next
  } catch (err: unknown) {
    permitsError.value = fb.parseApiError(err, 'Construction permits could not be loaded.')
  } finally {
    loadingPermits.value = false
  }
}
watch(tab, (t) => { if (t === 'construction' && !permits.value.length && !loadingPermits.value) loadConstructionPermits() },
  { immediate: true })

const EHO_STAGES = [
  { n: 7, label: 'Drainage', desc: 'Pipework, septic tank ≥ 10 m from buildings, air test' },
  { n: 8, label: 'Sanitary fittings', desc: 'WCs, basins, showers; water and sewer connections' },
  { n: 9, label: 'Occupation', desc: 'Final joint inspection with the Building Inspector' },
] as const

type StageStatus = 'pending' | 'pass' | 'fail' | 'booked'
const jointRows = computed(() =>
  permits.value.slice(0, 40).map(p => {
    const list = stageInsps.value[p.id] || []
    const stages = EHO_STAGES.map(st => {
      const found = list.find(i => i.stage_number === st.n)
      const r = String(found?.result || '').toLowerCase()
      const status: StageStatus =
        r === 'pass' || r === 'conditional_pass' ? 'pass'
        : r === 'fail' || r === 'reinspection_required' ? 'fail'
        : found ? 'booked' : 'pending'
      return { ...st, status, at: found?.inspected_at ?? null }
    })
    return { permit: p, stages }
  }))
const STAGE_TONE: Record<StageStatus, 'positive' | 'negative' | 'info' | 'neutral'> =
  { pass: 'positive', fail: 'negative', booked: 'info', pending: 'neutral' }
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Public Health Act · s. 93</span>
        <h2 class="ins-title">Inspections</h2>
        <p class="ins-lede">
          {{ hc.registry.value.length }} premises on the register · {{ dueCount }} due on a {{ cycle }}-day cycle.
          Inspections are saved on this device first and sent as soon as there is a connection.
        </p>
      </div>
      <div class="ins-actions">
        <UiButton variant="primary" @click="startAdd">
          <template #icon><Plus :size="15" /></template>Add premises
        </UiButton>
      </div>
    </header>

    <div class="ins-seg" role="tablist" aria-label="Inspection views">
      <button type="button" role="tab" :aria-selected="tab === 'register'" @click="setTab('register')">
        <Store :size="14" aria-hidden="true" /> Register
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'followups'" @click="setTab('followups')">
        <CalendarClock :size="14" aria-hidden="true" /> Follow-ups
        <span v-if="followUpsDue" class="ei-pill">{{ followUpsDue }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'construction'" @click="setTab('construction')">
        <HardHat :size="14" aria-hidden="true" /> Construction stages
      </button>
    </div>

    <!-- ══ REGISTER ═════════════════════════════════════════════════ -->
    <div v-if="tab === 'register'" class="ins-split" :class="{ 'ei-has-selection': selected }">
      <aside class="ins-card ins-sticky ei-list-card" aria-label="Premises register">
        <div class="ins-card-body ei-list-tools">
          <label class="ins-search">
            <Search :size="15" aria-hidden="true" />
            <span class="ent-sr-only">Search premises</span>
            <input v-model="search" type="search" placeholder="Name, stand, operator, reference" />
          </label>
          <div class="ins-chips" role="group" aria-label="Filter">
            <button type="button" class="ins-chip" :aria-pressed="filter === 'all'" @click="filter = 'all'">
              All<span class="ins-chip-n">{{ hc.registry.value.length }}</span>
            </button>
            <button type="button" class="ins-chip" :aria-pressed="filter === 'due'" @click="filter = 'due'">
              Due<span class="ins-chip-n">{{ dueCount }}</span>
            </button>
            <select v-model="filter" class="ins-input ei-type-select" aria-label="Premises type">
              <option value="all">Any type</option>
              <option v-for="t in PREMISES_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </div>

        <ul v-if="premisesList.length" class="ins-rows ei-list">
          <li v-for="p in premisesList" :key="p.id">
            <button type="button" class="ei-prem" :class="{ on: p.id === selectedId }"
                    :aria-current="p.id === selectedId ? 'true' : undefined" @click="openPremises(p.id)">
              <span class="ins-row-main">
                <span class="ins-row-title">{{ p.name }}</span>
                <span class="ins-row-meta">{{ humanise(p.type) }} · Stand {{ p.stand_number || '—' }}</span>
              </span>
              <span class="ei-age" :class="{ due: isOverdue(p.last_inspected_at, cycle), never: !p.last_inspected_at }">
                {{ p.last_inspected_at ? `${daysSince(p.last_inspected_at)}d` : 'Never' }}
              </span>
              <CloudOff v-if="p.pendingSync" :size="13" class="ei-held" aria-label="Not yet sent" />
            </button>
          </li>
        </ul>
        <p v-else-if="!hc.registry.value.length" class="ei-empty">
          The register is empty. Add the first premises — a stand number is enough to start.
        </p>
        <p v-else class="ei-empty">No premises match this search.</p>
      </aside>

      <!-- Case sheet -->
      <section v-if="selected" class="ei-sheet" :aria-label="selected.name">
        <button type="button" class="ei-back" @click="openPremises(null)">
          <ArrowLeft :size="15" aria-hidden="true" /> Register
        </button>

        <div class="ins-card">
          <div class="ins-card-head">
            <h3><Building :size="16" aria-hidden="true" /> {{ selected.name }}</h3>
            <UiStatusBadge
              :tone="!selected.last_inspected_at ? 'negative' : isOverdue(selected.last_inspected_at, cycle) ? 'warning' : 'positive'"
              :label="ageLabel(selected)" />
            <button type="button" class="ins-iconbtn" title="Edit premises" @click="startEdit(selected)">
              <Pencil :size="15" aria-hidden="true" /><span class="ent-sr-only">Edit premises</span>
            </button>
            <button type="button" class="ins-iconbtn" title="Remove premises" @click="removeSelected">
              <Trash2 :size="15" aria-hidden="true" /><span class="ent-sr-only">Remove premises</span>
            </button>
          </div>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Reference</dt><dd class="ins-mono">{{ selected.reference || (selected.pendingSync ? 'Assigned on sync' : '—') }}</dd></div>
              <div><dt>Type</dt><dd>{{ humanise(selected.type) }}</dd></div>
              <div><dt>Stand · ward</dt><dd>{{ selected.stand_number || '—' }} · {{ selected.suburb_ward || '—' }}</dd></div>
              <div><dt>Operator</dt><dd>{{ selected.operator_name || '—' }}</dd></div>
              <div><dt>Contact</dt><dd>{{ selected.operator_contact || '—' }}</dd></div>
              <div><dt>Fitness certificate</dt>
                <dd>{{ selected.fitness_certificate_no || 'None' }}
                  <template v-if="selected.fitness_certificate_expiry"> · to {{ fmtDate(selected.fitness_certificate_expiry) }}</template></dd></div>
              <div><dt>Position</dt>
                <dd>
                  <template v-if="selected.lng != null"><MapPin :size="12" aria-hidden="true" />
                    {{ selected.lat?.toFixed(5) }}, {{ selected.lng?.toFixed(5) }}
                    <span class="ei-muted">({{ humanise(selected.locationSource) }}<template v-if="selected.locationAccuracyM"> ±{{ selected.locationAccuracyM }} m</template>)</span>
                  </template>
                  <template v-else>Not recorded</template>
                </dd></div>
            </dl>
            <p v-if="selected.notes" class="ins-hint ei-notes">{{ selected.notes }}</p>
            <p v-if="openComplaintsHere.length" class="ins-banner t-warning ei-mt">
              <ShieldAlert :size="16" aria-hidden="true" />
              <span><strong>{{ openComplaintsHere.length }} open complaint{{ openComplaintsHere.length === 1 ? '' : 's' }}</strong>
                against this premises. Address them during this visit.</span>
            </p>
          </div>
        </div>

        <!-- Record inspection -->
        <form class="ins-card" aria-labelledby="ei-rec" @submit.prevent="recordInspection">
          <div class="ins-card-head">
            <h3 id="ei-rec"><ClipboardCheck :size="16" aria-hidden="true" /> Record inspection</h3>
          </div>
          <div class="ins-card-body ins-form">
            <div class="ins-field full">
              <span class="ins-label">Scope</span>
              <div class="ins-chips" role="radiogroup" aria-label="Inspection scope">
                <button v-for="[k, label] in SCOPES" :key="k" type="button" class="ins-chip"
                        role="radio" :aria-checked="insp.scope === k" :aria-pressed="insp.scope === k"
                        @click="insp.scope = k">{{ label }}</button>
              </div>
            </div>
            <div class="ins-field full">
              <span class="ins-label">Verdict</span>
              <div class="ins-seg" role="radiogroup" aria-label="Verdict">
                <button v-for="v in VERDICTS" :key="v.value" type="button" role="radio" :class="v.tone"
                        :aria-checked="insp.verdict === v.value" @click="insp.verdict = v.value">{{ v.label }}</button>
              </div>
            </div>
            <label class="ins-field full">
              <span class="ins-label">Findings</span>
              <textarea v-model="insp.findings" class="ins-input" rows="3"
                placeholder="What was observed: temperatures, fly screens, storage, staff protective clothing, water supply…" />
            </label>
            <Transition name="ei-reveal">
              <label v-if="insp.verdict !== 'pass'" class="ins-field full">
                <span class="ins-label">Action required</span>
                <textarea v-model="insp.actionRequired" class="ins-input" rows="2"
                  placeholder="What the operator must do, and by when. An abatement notice quotes this." />
              </label>
            </Transition>
            <label class="ins-field">
              <span class="ins-label">Inspecting officer</span>
              <input v-model="insp.inspectorName" class="ins-input" autocomplete="name" />
            </label>
            <label class="ins-field">
              <span class="ins-label">Follow-up date</span>
              <input v-model="insp.followUpDate" type="date" class="ins-input" :min="isoDay()" />
            </label>
            <div class="ins-field full ei-gps">
              <button type="button" class="ins-chip" :disabled="locating" @click="inspGps">
                <Crosshair :size="13" aria-hidden="true" :class="{ 'ins-spin': locating }" />
                {{ insp.position ? 'Position captured' : locating ? 'Locating…' : 'Stamp with GPS position' }}
              </button>
              <span v-if="insp.position" class="ins-hint">±{{ insp.position.locationAccuracyM }} m field fix</span>
            </div>
          </div>
          <div class="ins-card-foot">
            <UiButton variant="primary" type="submit">Record inspection</UiButton>
          </div>
        </form>

        <!-- History -->
        <section class="ins-card" aria-labelledby="ei-hist">
          <div class="ins-card-head">
            <h3 id="ei-hist">Inspection history</h3>
            <span class="ins-count">{{ history.length }}</span>
          </div>
          <p v-if="!history.length" class="ei-empty">No inspections recorded at this premises yet.</p>
          <ol v-else class="ei-timeline">
            <li v-for="i in history" :key="i.id" class="ei-tl" :class="`v-${i.verdict}`">
              <div class="ei-tl-head">
                <UiStatusBadge :status="i.verdict === 'conditional' ? 'conditional_pass' : i.verdict" />
                <strong>{{ INSPECTION_SCOPE_LABELS[i.scope] }}</strong>
                <span class="ei-muted">{{ fmtDateTime(i.inspectedAt) }} · {{ i.inspectorName }}</span>
                <span class="ins-mono ei-ref">{{ i.reference || '' }}</span>
                <span v-if="i.pendingSync" class="ei-held-label"><CloudOff :size="12" aria-hidden="true" /> Not yet sent</span>
              </div>
              <p class="ei-tl-body">{{ i.findings }}</p>
              <p v-if="i.actionRequired" class="ei-tl-body"><strong>Action:</strong> {{ i.actionRequired }}</p>
              <div v-if="i.followUpDate || i.verdict === 'fail'" class="ei-tl-foot">
                <span v-if="i.followUpDate" class="ei-muted"><CalendarClock :size="12" aria-hidden="true" /> Return by {{ fmtDate(i.followUpDate) }}</span>
                <button v-if="i.verdict !== 'pass'" type="button" class="ei-linkbtn" @click="issueNoticeFrom(i)">
                  Issue abatement notice
                </button>
              </div>
            </li>
          </ol>
        </section>
      </section>

      <div v-else class="ins-card ei-placeholder">
        <Building :size="28" aria-hidden="true" />
        <p><strong>Choose a premises</strong></p>
        <p class="ins-hint">Its details, inspection history and the inspection form open here. Press Ctrl K to jump by name.</p>
      </div>
    </div>

    <!-- ══ FOLLOW-UPS ═══════════════════════════════════════════════ -->
    <section v-else-if="tab === 'followups'" class="ins-card" aria-label="Follow-up visits">
      <div class="ins-card-head">
        <h3><CalendarClock :size="16" aria-hidden="true" /> Return visits owed</h3>
        <span class="ins-count">{{ followUps.length }}</span>
      </div>
      <p v-if="!followUps.length" class="ei-empty">
        No return visits owed. A failed or conditional inspection with a follow-up date appears here until the premises is inspected again.
      </p>
      <ul v-else class="ins-rows">
        <li v-for="i in followUps" :key="i.id">
          <button type="button" class="ei-prem" @click="nav.go('inspections', { premises: i.premisesId })">
            <span class="ins-row-main">
              <span class="ins-row-title">{{ i.premisesName || 'Premises' }}</span>
              <span class="ins-row-meta">{{ INSPECTION_SCOPE_LABELS[i.scope] }} · {{ i.actionRequired || i.findings }}</span>
            </span>
            <UiStatusBadge :status="i.verdict === 'conditional' ? 'conditional_pass' : i.verdict" />
            <span class="ei-due" :class="{ late: (daysUntil(i.followUpDate) ?? 1) <= 0 }">
              <template v-if="(daysUntil(i.followUpDate) ?? 0) < 0">{{ -(daysUntil(i.followUpDate) ?? 0) }}d late</template>
              <template v-else-if="daysUntil(i.followUpDate) === 0">Today</template>
              <template v-else>in {{ daysUntil(i.followUpDate) }}d</template>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <!-- ══ CONSTRUCTION ═════════════════════════════════════════════ -->
    <section v-else class="ins-card" aria-label="Joint construction-stage inspections">
      <div class="ins-card-head">
        <h3><HardHat :size="16" aria-hidden="true" /> Joint stage inspections</h3>
        <span class="ins-count">{{ jointRows.length }} approved permits</span>
        <button type="button" class="ins-iconbtn" :disabled="loadingPermits" title="Reload" @click="loadConstructionPermits">
          <RefreshCw :size="15" :class="{ 'ins-spin': loadingPermits }" aria-hidden="true" />
          <span class="ent-sr-only">Reload permits</span>
        </button>
      </div>
      <div class="ins-card-body">
        <p class="ins-hint">
          The EHO attends Stage 7 (drainage), Stage 8 (sanitary fittings) and Stage 9 (occupation) alongside the Building Inspector,
          who books and records them.
        </p>
      </div>
      <ul v-if="loadingPermits" class="ins-rows" aria-busy="true">
        <li v-for="n in 4" :key="n" class="ins-row"><span class="ins-skel" style="width:70%" /></li>
      </ul>
      <p v-else-if="permitsError" class="ins-banner t-negative ei-m">
        <CloudOff :size="16" aria-hidden="true" /><span>{{ permitsError }}</span>
      </p>
      <p v-else-if="!jointRows.length" class="ei-empty">No approved permits are under construction.</p>
      <ul v-else class="ins-rows">
        <li v-for="row in jointRows" :key="row.permit.id" class="ins-row ei-joint">
          <span class="ins-row-main">
            <span class="ins-row-title">{{ row.permit.dev_register_no || 'Permit' }} · {{ row.permit.applicant_name }}</span>
            <span class="ins-row-meta">Stand {{ row.permit.stand_number || '—' }}</span>
          </span>
          <span class="ei-stages">
            <span v-for="st in row.stages" :key="st.n" class="ei-stage" :title="`Stage ${st.n}: ${st.desc}`">
              <UiStatusBadge :tone="STAGE_TONE[st.status]" :label="`S${st.n} ${st.label}`" />
            </span>
          </span>
        </li>
      </ul>
    </section>

    <!-- Add / edit premises -->
    <UiSheet :open="premOpen" :title="premForm.id ? 'Edit premises' : 'Add premises'"
             subtitle="Premises register" width="36rem" @update:open="premOpen = $event">
      <form id="ei-prem-form" class="ins-form" @submit.prevent="savePremises">
        <label class="ins-field full"><span class="ins-label">Premises name</span>
          <input v-model="premForm.name" class="ins-input" required /></label>
        <label class="ins-field"><span class="ins-label">Type</span>
          <select v-model="premForm.type" class="ins-input">
            <option v-for="t in PREMISES_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select></label>
        <label class="ins-field"><span class="ins-label">Stand number</span>
          <input v-model="premForm.stand_number" class="ins-input" required /></label>
        <label class="ins-field"><span class="ins-label">Ward / suburb</span>
          <input v-model="premForm.suburb_ward" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Operator name</span>
          <input v-model="premForm.operator_name" class="ins-input" autocomplete="off" /></label>
        <label class="ins-field"><span class="ins-label">Operator phone</span>
          <input v-model="premForm.operator_contact" class="ins-input" inputmode="tel" placeholder="07…" /></label>
        <label class="ins-field full"><span class="ins-label">Notes</span>
          <textarea v-model="premForm.notes" class="ins-input" rows="2" /></label>
        <div class="ins-field full ei-gps">
          <button type="button" class="ins-chip" :disabled="locating" @click="premGps">
            <Crosshair :size="13" aria-hidden="true" :class="{ 'ins-spin': locating }" />
            {{ premForm.position ? 'Position captured' : locating ? 'Locating…' : 'Use my current position' }}
          </button>
          <span class="ins-hint">Only when standing at the premises. It places the premises on the map.</span>
        </div>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="premOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ei-prem-form">{{ premForm.id ? 'Save changes' : 'Add premises' }}</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ei-pill { min-width:1.2rem; padding:0 5px; border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); line-height:1.2rem; color:var(--ent-tone-negative-fg); background:var(--ent-tone-negative-bg); }

.ei-list-card { overflow:hidden; }
.ei-list-tools { display:flex; flex-direction:column; gap:var(--ent-s3); border-bottom:1px solid var(--ent-line); }
.ei-type-select { width:auto; min-height:28px; padding:0 var(--ent-s2); font-size:var(--ent-fs-xs); border-radius:var(--ent-r-pill); }
.ei-list { max-height:calc(var(--ent-vh) - 22rem); min-height:12rem; overflow-y:auto; }

.ei-prem { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line);
  border-left:3px solid transparent; background:transparent; text-align:left; cursor:pointer;
  font-family:var(--ent-font); transition:background-color var(--ent-dur) var(--ent-ease); }
li:first-child > .ei-prem { border-top:0; }
.ei-prem:hover { background:var(--ent-surface-2); }
.ei-prem:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.ei-prem.on { background:var(--ent-accent-soft); border-left-color:var(--ent-accent); }

.ei-age { flex-shrink:0; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); font-variant-numeric:tabular-nums; color:var(--ent-text-3); }
.ei-age.due { color:var(--ent-tone-warning-fg); }
.ei-age.never { color:var(--ent-danger); }
.ei-held { color:var(--ent-warning); flex-shrink:0; }

.ei-sheet { display:flex; flex-direction:column; gap:var(--ent-s4); min-width:0; }
.ei-back { display:none; }
.ei-muted { color:var(--ent-text-3); }
.ei-notes { margin-top:var(--ent-s3); white-space:pre-line; }
.ei-mt { margin-top:var(--ent-s3); }
.ei-m { margin:0 var(--ent-s4) var(--ent-s4); }
.ei-gps { flex-direction:row; align-items:center; flex-wrap:wrap; gap:var(--ent-s2); }
.ei-gps .ins-chip { display:inline-flex; align-items:center; gap:var(--ent-s1); }

.ei-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.ei-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--ent-s1);
  min-height:18rem; padding:var(--ent-s6); text-align:center; color:var(--ent-text-3); }
.ei-placeholder p { margin:0; }
.ei-placeholder strong { color:var(--ent-text); }

/* Timeline — a left rule coloured by verdict, so the premises' trajectory reads at a glance. */
.ei-timeline { list-style:none; margin:0; padding:var(--ent-s2) var(--ent-s4) var(--ent-s4); }
.ei-tl { position:relative; padding:var(--ent-s3) 0 var(--ent-s3) var(--ent-s4); border-left:2px solid var(--ent-line-strong); }
.ei-tl.v-pass { border-left-color:var(--ent-success); }
.ei-tl.v-fail { border-left-color:var(--ent-danger); }
.ei-tl.v-conditional { border-left-color:var(--ent-warning); }
.ei-tl-head { display:flex; align-items:center; flex-wrap:wrap; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.ei-tl-head strong { color:var(--ent-text); }
.ei-ref { margin-left:auto; color:var(--ent-text-3); font-size:var(--ent-fs-xs); }
.ei-tl-body { margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); white-space:pre-line; }
.ei-tl-foot { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; margin-top:var(--ent-s2); font-size:var(--ent-fs-xs); }
.ei-held-label { display:inline-flex; align-items:center; gap:4px; font-size:var(--ent-fs-xs); color:var(--ent-tone-warning-fg); }
.ei-linkbtn { border:0; background:none; padding:0; cursor:pointer; font-family:var(--ent-font);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-accent); }
.ei-linkbtn:hover { text-decoration:underline; }
.ei-linkbtn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:var(--ent-r-sm); }

.ei-due { flex-shrink:0; min-width:4.5rem; text-align:right; font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; color:var(--ent-text-2); }
.ei-due.late { color:var(--ent-danger); }

.ei-joint { flex-wrap:wrap; }
.ei-stages { display:flex; gap:var(--ent-s1); flex-wrap:wrap; }

.ei-reveal-enter-active, .ei-reveal-leave-active { transition:opacity var(--ent-dur) var(--ent-ease), transform var(--ent-dur) var(--ent-ease); }
.ei-reveal-enter-from, .ei-reveal-leave-to { opacity:0; transform:translateY(-4px); }

/* Below 1024px the split stacks; with a premises open, the list steps aside so
   the case sheet is the screen, with a Back button to return. */
@media (max-width: 1023px) {
  .ei-has-selection > .ei-list-card { display:none; }
  .ei-back { display:inline-flex; align-items:center; gap:var(--ent-s1); align-self:flex-start;
    border:0; background:none; padding:var(--ent-s1) 0; cursor:pointer; font-family:var(--ent-font);
    font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-accent); }
  .ei-list { max-height:none; }
  .ei-placeholder { display:none; }
}
@media (prefers-reduced-motion: reduce) {
  .ei-reveal-enter-active, .ei-reveal-leave-active { transition:none; }
}
</style>
