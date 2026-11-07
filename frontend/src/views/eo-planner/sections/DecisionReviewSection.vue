<script setup lang="ts">
// EO Planner — Decision Review workspace (RTCP Act [Ch. 29:12] s.26).
//
// The authoritative determination surface: an inbox of permits awaiting an EO
// decision, and — for the selected case — one assembled package bringing
// together the planner recommendation, every specialist finding, the objection
// summary, documents, GIS evidence and proposed conditions. The EO then either
// Approves / Approves-with-conditions / Refuses, returns the case to a role for
// more work, or requests information from the applicant. Every action is
// backed by the development-management API (migrations 085 + 086) and lands in
// the permit's append-only audit trail.

import { ref, computed, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap, setBasemapLayerVisible } from '@/map/vunguBasemap'
import { MAP_BACKGROUND } from '@/map/vunguBasemapStyle'
import {
  dmApi,
  type EoCase, type DecisionPackage, type CaseMessage,
  type SpecialistFinding, type ReturnRole, type PermitCondition,
  type GeneratedDocumentRef, type PermitEvent,
} from '@/services/developmentManagementService'
import { normalizeStatus } from '@/composables/useApplicationPipeline'
import { useEoCase } from '@/eo-planner/useEoCase'
import { useEoPreferences } from '@/eo-planner/useEoPreferences'
import '@/views/inspector/inspector.css'
import {
  Gavel, Inbox, RefreshCw, Clock, CheckCircle2, XCircle, CornerUpLeft,
  MessageSquare, Users, FileText, MapPin, AlertTriangle, Send, Plus,
  Trash2, Scale, Building2, ClipboardList, Loader2, Eye, FileCheck2,
  Map as MapIcon, Camera,
} from 'lucide-vue-next'

// ─── Inbox state ──────────────────────────────────────────────────────
type Bucket = 'all' | 'awaiting' | 'returned' | 'urgent'
const cases = ref<EoCase[]>([])
const loadingCases = ref(true)
const bucket = ref<Bucket>('all')
const search = ref('')

// The case this section works on is the console's open case (?case=), not a
// selection private to this screen: an EO who opened a file in Applications
// and came here to determine it should find it already open.
const eoCase = useEoCase()
const { prefs } = useEoPreferences()
const selectedId = computed(() => eoCase.caseId.value)
const pkg = ref<DecisionPackage | null>(null)
const messages = ref<CaseMessage[]>([])
const events = ref<PermitEvent[]>([])
type EventFilter = 'all' | 'decisions' | 'referrals' | 'messages'
const eventFilter = ref<EventFilter>('all')
const loadingPkg = ref(false)
const pkgError = ref<string | null>(null)
const lastDoc = ref<GeneratedDocumentRef | null>(null)   // letter from the last decision
const viewingDoc = ref(false)

// ─── Working decision state (for the selected case) ───────────────────
const decisionNotes = ref('')
const conditions = ref<{ text: string }[]>([])
const newCondition = ref('')
const returnRole = ref<ReturnRole>('planner')
const newMessage = ref('')
const busy = ref<string | null>(null)            // which action is in-flight

// ─── Toast ────────────────────────────────────────────────────────────
const toast = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function flash(type: 'success' | 'error', text: string) {
  toast.value = { type, text }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3800)
}

// ─── Inbox loading + filtering ────────────────────────────────────────
async function loadCases() {
  loadingCases.value = true
  try {
    cases.value = await dmApi.listEoCases()
  } catch (e: unknown) {
    cases.value = []
    flash('error', errMsg(e, 'Failed to load EO cases'))
  } finally {
    loadingCases.value = false
  }
}

function isAwaitingEo(status: string): boolean {
  const s = normalizeStatus(status)
  return s === 'awaiting_eo_decision' || s === 'appealed'
}

const filteredCases = computed(() => {
  const q = search.value.trim().toLowerCase()
  return cases.value.filter(c => {
    if (bucket.value === 'awaiting' && !isAwaitingEo(c.status)) return false
    if (bucket.value === 'returned' && c.handoff_status !== 'returned') return false
    if (bucket.value === 'urgent'
        && !(c.days_to_deemed != null && c.days_to_deemed <= prefs.value.clockWarningDays)) return false
    if (!q) return true
    return [c.dev_register_no, c.tpd_reference, c.stand_number, c.applicant_name, c.suburb_ward]
      .some(v => (v || '').toLowerCase().includes(q))
  })
})

const bucketCounts = computed(() => ({
  all: cases.value.length,
  awaiting: cases.value.filter(c => isAwaitingEo(c.status)).length,
  returned: cases.value.filter(c => c.handoff_status === 'returned').length,
  urgent: cases.value.filter(c =>
    c.days_to_deemed != null && c.days_to_deemed <= prefs.value.clockWarningDays).length,
}))

// ─── Package loading ──────────────────────────────────────────────────
/** Clicking a case in the inbox opens it for the whole console. */
function selectCase(id: string) {
  eoCase.open(id)
}

async function loadPackage(id: string) {
  loadingPkg.value = true
  pkgError.value = null
  pkg.value = null
  messages.value = []
  events.value = []
  eventFilter.value = 'all'
  decisionNotes.value = ''
  newCondition.value = ''
  newMessage.value = ''
  try {
    const [p, m, ev] = await Promise.all([
      dmApi.getDecisionPackage(id),
      dmApi.listMessages(id).catch(() => [] as CaseMessage[]),
      dmApi.listEvents(id).catch(() => [] as PermitEvent[]),
    ])
    pkg.value = p
    messages.value = m
    events.value = ev
    conditions.value = normalizeConditions(p.proposed_conditions)
  } catch (e: unknown) {
    pkgError.value = errMsg(e, 'Failed to load decision package')
  } finally {
    loadingPkg.value = false
  }
}

onMounted(loadCases)

// Follow the console's open case, including one opened from another section
// or restored from a pasted link.
watch(selectedId, (id) => {
  if (id) void loadPackage(id)
  else { pkg.value = null; messages.value = []; events.value = [] }
}, { immediate: true })

// ─── Conditions editing ───────────────────────────────────────────────
function normalizeConditions(raw: unknown): { text: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c: unknown) => typeof c === 'string'
      ? { text: c }
      : { text: String((c as Record<string, unknown>)?.text ?? '') })
    .filter(c => c.text.trim().length > 0)
}
function addCondition() {
  const t = newCondition.value.trim()
  if (!t) return
  conditions.value.push({ text: t })
  newCondition.value = ''
}
function removeCondition(i: number) {
  conditions.value.splice(i, 1)
}

// ─── Decision actions ─────────────────────────────────────────────────
async function decide(decision: 'approve' | 'approve_with_conditions' | 'refuse') {
  if (!selectedId.value) return
  if (decision === 'refuse' && !decisionNotes.value.trim()) {
    flash('error', 'A refusal requires reasons in the decision notes.')
    return
  }
  if (decision === 'approve_with_conditions' && conditions.value.length === 0) {
    flash('error', 'Add at least one condition before approving with conditions.')
    return
  }
  busy.value = decision
  try {
    const res = await dmApi.submitEoDecision(selectedId.value, {
      decision,
      notes: decisionNotes.value.trim() || undefined,
      conditions: decision === 'approve_with_conditions'
        ? (conditions.value as PermitCondition[]) : undefined,
    })
    lastDoc.value = res.document
    flash('success', decision === 'refuse'
      ? 'Application refused — refusal letter generated.'
      : 'Application approved — decision letter generated.')
    eoCase.close()
    pkg.value = null
    await loadCases()
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Decision could not be recorded'))
  } finally {
    busy.value = null
  }
}

// Open a generated document in a new tab via an auth'd fetch. Handles both the
// HTML decision letters and the PNG map-evidence snapshots (data-URL content).
async function viewDocument(docId: string) {
  viewingDoc.value = true
  try {
    const doc = await dmApi.getGeneratedDocument(docId)
    if (!doc.content) { flash('error', 'Document has no stored content.'); return }
    const mime = doc.mime_type || 'text/html'
    const blob = (mime.startsWith('image') && doc.content.startsWith('data:'))
      ? await (await fetch(doc.content)).blob()
      : new Blob([doc.content], { type: mime })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Could not open document'))
  } finally {
    viewingDoc.value = false
  }
}

// ─── GIS evidence map ─────────────────────────────────────────────────
type EvLayerKey = 'landuse' | 'roads' | 'buildings' | 'environmental'
const EV_TOGGLES: { key: EvLayerKey; label: string }[] = [
  { key: 'landuse', label: 'Land use / zoning' },
  { key: 'roads', label: 'Roads' },
  { key: 'buildings', label: 'Buildings' },
  { key: 'environmental', label: 'Environmental' },
]
const ENV_LAYER_IDS = ['protected_areas', 'natural_areas', 'water_areas', 'waterways']

/** --ent-accent, written out because MapLibre paints the marker in canvas. */
const EVIDENCE_PIN = '#1f5aa8'

const mapContainer = ref<HTMLElement | null>(null)
const mapReady = ref(false)
const savingSnapshot = ref(false)
const evidenceLayers = ref<Record<EvLayerKey, boolean>>({
  landuse: true, roads: true, buildings: true, environmental: true,
})
let evMap: maplibregl.Map | null = null
let evMarker: maplibregl.Marker | null = null

function destroyMap() {
  mapReady.value = false
  if (evMarker) { evMarker.remove(); evMarker = null }
  if (evMap) { evMap.remove(); evMap = null }
}

function initMap(lng: number, lat: number) {
  if (!mapContainer.value) return
  destroyMap()
  evMap = new maplibregl.Map({
    container: mapContainer.value,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': MAP_BACKGROUND } }], glyphs: '/fonts/{fontstack}/{range}.pbf' } as any,
    center: [lng, lat],
    zoom: 16,
    attributionControl: false,
    preserveDrawingBuffer: true,   // required so the canvas can be exported
  })
  evMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  evMap.on('load', () => {
    if (!evMap) return
    addVunguBasemap(evMap)
    // The one place a marker colour is written out: MapLibre paints the pin
    // itself, so it cannot read a CSS custom property. Matches --ent-accent.
    evMarker = new maplibregl.Marker({ color: EVIDENCE_PIN }).setLngLat([lng, lat]).addTo(evMap)
    mapReady.value = true
    applyLayerVisibility()
  })
}

function applyLayerVisibility() {
  if (!evMap) return
  setBasemapLayerVisible(evMap, 'landuse', evidenceLayers.value.landuse)
  setBasemapLayerVisible(evMap, 'roads', evidenceLayers.value.roads)
  setBasemapLayerVisible(evMap, 'buildings', evidenceLayers.value.buildings)
  for (const id of ENV_LAYER_IDS) setBasemapLayerVisible(evMap, id, evidenceLayers.value.environmental)
}

function toggleLayer(key: EvLayerKey) {
  evidenceLayers.value[key] = !evidenceLayers.value[key]
  applyLayerVisibility()
}

async function saveSnapshot() {
  if (!evMap || !selectedId.value || !mapReady.value) return
  savingSnapshot.value = true
  try {
    evMap.triggerRepaint()
    const image = evMap.getCanvas().toDataURL('image/png')
    const r = pkg.value?.permit.dev_register_no || pkg.value?.permit.tpd_reference || ''
    const doc = await dmApi.saveMapEvidence(selectedId.value, {
      image,
      title: `Map evidence${r ? ' — ' + r : ''}`,
      payload: { center: evMap.getCenter(), zoom: evMap.getZoom(), layers: { ...evidenceLayers.value } },
    })
    if (pkg.value) pkg.value.documents = [doc, ...pkg.value.documents]
    flash('success', 'Map evidence saved to the decision record.')
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Could not save map evidence'))
  } finally {
    savingSnapshot.value = false
  }
}

// (Re)create the map whenever a different case package loads with a centroid.
watch(() => (pkg.value ? pkg.value.permit.id : null), async () => {
  const p = pkg.value
  if (p && p.permit.lng != null && p.permit.lat != null) {
    await nextTick()
    initMap(p.permit.lng, p.permit.lat)
  } else {
    destroyMap()
  }
})
onBeforeUnmount(destroyMap)

async function doReturn() {
  if (!selectedId.value) return
  if (!decisionNotes.value.trim()) {
    flash('error', 'Add a reason in the decision notes before returning the case.')
    return
  }
  busy.value = 'return'
  try {
    await dmApi.returnToRole(selectedId.value, {
      role: returnRole.value,
      reason: decisionNotes.value.trim(),
    })
    flash('success', `Returned to ${ROLE_LABELS[returnRole.value]}.`)
    eoCase.close()
    pkg.value = null
    await loadCases()
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Return could not be recorded'))
  } finally {
    busy.value = null
  }
}

async function requestInfo() {
  if (!selectedId.value) return
  if (!decisionNotes.value.trim()) {
    flash('error', 'Write the request to the applicant in the decision notes.')
    return
  }
  busy.value = 'request'
  try {
    await dmApi.requestCitizenInfo(selectedId.value, { message: decisionNotes.value.trim() })
    flash('success', 'Information requested from the applicant.')
    decisionNotes.value = ''
    await loadPackage(selectedId.value)
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Request could not be sent'))
  } finally {
    busy.value = null
  }
}

async function postNote() {
  if (!selectedId.value || !newMessage.value.trim()) return
  busy.value = 'note'
  try {
    const m = await dmApi.postMessage(selectedId.value, {
      body: newMessage.value.trim(), message_type: 'internal_note', visibility: 'internal',
    })
    messages.value.push(m)
    newMessage.value = ''
  } catch (e: unknown) {
    flash('error', errMsg(e, 'Note could not be posted'))
  } finally {
    busy.value = null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
const ROLE_LABELS: Record<ReturnRole, string> = {
  planner: 'Planner', gis_officer: 'GIS Officer', surveyor: 'Surveyor',
  env_officer: 'Environmental Officer', building_inspector: 'Building Inspector',
}
const RETURN_ROLE_OPTIONS = Object.keys(ROLE_LABELS) as ReturnRole[]

const DEV_TYPE_LABELS: Record<string, string> = {
  new_building: 'New Building', alteration: 'Alteration', extension: 'Extension',
  change_of_use: 'Change of Use', subdivision: 'Subdivision', consolidation: 'Consolidation',
  rezoning: 'Rezoning', other: 'Other',
}

function errMsg(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string }
  return ax?.response?.data?.error ?? ax?.message ?? fallback
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function devLabel(t: string): string { return DEV_TYPE_LABELS[t] ?? t }
function caseRef(c: EoCase): string {
  return c.dev_register_no || c.tpd_reference || c.id.slice(0, 8).toUpperCase()
}
function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}

// Map any officer outcome word to a severity class for the chip.
function outcomeClass(o: string | null): string {
  const v = (o || '').toLowerCase()
  if (/(no_objection|approved|pass|cleared|support|low)/.test(v)) return 'ok'
  if (/(objection|refus|fail|reject|high|critical|breach)/.test(v)) return 'bad'
  if (/(conditional|caution|medium|review|amend)/.test(v)) return 'warn'
  return 'neutral'
}
function findingGroupLabel(f: SpecialistFinding): string {
  switch (f.finding_type) {
    case 'survey':       return 'Surveyor'
    case 'inspection':   return 'Building inspection'
    case 'plan_review':  return 'Plan review'
    default:             return f.source_label || 'Consultation'
  }
}

const eoEvents = new Set(['eo_decision', 'returned_to_role', 'citizen_info_requested',
  'status_changed', 'map_evidence_saved'])
function eventLabel(t: string): string {
  const map: Record<string, string> = {
    eo_decision: 'EO determination',
    returned_to_role: 'Returned to role',
    citizen_info_requested: 'Citizen information requested',
    status_changed: 'Status changed',
    case_updated: 'Case updated',
    referral_created: 'Referral created',
    referral_response: 'Referral response',
    message_posted: 'Message posted',
    map_evidence_saved: 'Map evidence saved',
  }
  return map[t] ?? statusLabel(t)
}

// Audit-trail filtering + one-line detail rendering.
const EVENT_FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'messages', label: 'Notes' },
]
function eventBucket(type: string): EventFilter {
  if (['eo_decision', 'returned_to_role', 'citizen_info_requested', 'status_changed', 'map_evidence_saved'].includes(type)) return 'decisions'
  if (['referral_created', 'referral_response'].includes(type)) return 'referrals'
  if (type === 'message_posted') return 'messages'
  return 'all'
}
const filteredEvents = computed(() => eventFilter.value === 'all'
  ? events.value
  : events.value.filter(e => eventBucket(e.event_type) === eventFilter.value))
function eventDetail(e: PermitEvent): string {
  const d = (e.detail || {}) as Record<string, unknown>
  const s = (v: unknown) => String(v ?? '').replace(/_/g, ' ')
  switch (e.event_type) {
    case 'eo_decision':           return `${s(d.decision)} → ${s(d.status)}`
    case 'returned_to_role':      return d.role ? `to ${s(d.role)}` : ''
    case 'status_changed':        return d.status ? `→ ${s(d.status)}` : ''
    case 'referral_created':      return s(d.body_name)
    case 'referral_response':     return d.body_name ? `${d.body_name}: ${s(d.response_status)}` : ''
    case 'message_posted':        return s(d.message_type)
    case 'map_evidence_saved':    return 'snapshot saved'
    case 'citizen_info_requested': return d.doc_kind ? s(d.doc_kind) : 'information requested'
    case 'case_updated':          return Array.isArray(d.fields) ? (d.fields as string[]).join(', ') : ''
    default:                      return ''
  }
}

const selectedCase = computed(() => cases.value.find(c => c.id === selectedId.value) || null)

// A case opened from the register need not be in the EO inbox — a determined
// application is not in the decision queue — so the header reads the loaded
// package, which is always the case on screen.
const headerRef = computed(() => {
  const p = pkg.value?.permit
  if (!p) return ''
  return p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase()
})

/**
 * Days to deemed refusal. The server's countdown where the case is in the EO
 * queue, and the shared clock otherwise, so a case opened from anywhere still
 * shows the deadline rather than nothing.
 */
const deemed = computed(() =>
  selectedCase.value?.days_to_deemed ?? eoCase.clock.value.daysLeft)
</script>

<template>
  <div class="eodr">
    <!-- Toast -->
    <transition name="eodr-toast">
      <div v-if="toast" class="eodr-toast" :class="toast.type">
        <component :is="toast.type === 'success' ? CheckCircle2 : AlertTriangle" :size="14" />
        <span>{{ toast.text }}</span>
      </div>
    </transition>

    <!-- INBOX -->
    <aside class="eodr-inbox">
      <header class="eodr-inbox-head">
        <Inbox :size="14" />
        <strong>Decision inbox</strong>
        <button class="eodr-icon" :disabled="loadingCases" title="Refresh" @click="loadCases">
          <RefreshCw :size="13" :class="{ spin: loadingCases }" />
        </button>
      </header>

      <input v-model="search" class="eodr-search" type="search"
             placeholder="Search ref · stand · applicant · ward" />

      <div class="eodr-buckets">
        <button v-for="b in (['all','awaiting','returned','urgent'] as Bucket[])" :key="b"
                class="eodr-bucket" :class="{ active: bucket === b }" @click="bucket = b">
          {{ b === 'all' ? 'All' : b === 'awaiting' ? 'Awaiting EO' : b === 'returned' ? 'Returned' : `Urgent ≤${prefs.clockWarningDays}d` }}
          <span class="eodr-count">{{ bucketCounts[b] }}</span>
        </button>
      </div>

      <div class="eodr-caselist">
        <div v-if="loadingCases" class="eodr-muted eodr-pad"><Loader2 :size="13" class="spin" /> Loading…</div>
        <div v-else-if="!filteredCases.length" class="eodr-muted eodr-pad">No cases in this view.</div>
        <button v-for="c in filteredCases" :key="c.id"
                class="eodr-caseitem" :class="{ active: selectedId === c.id }"
                @click="selectCase(c.id)">
          <div class="eodr-caseitem-top">
            <span class="eodr-ref">{{ caseRef(c) }}</span>
            <span v-if="c.days_to_deemed != null"
                  class="eodr-clock"
                  :class="{ crit: c.days_to_deemed <= Math.ceil(prefs.clockWarningDays / 2),
                            warn: c.days_to_deemed > Math.ceil(prefs.clockWarningDays / 2)
                                  && c.days_to_deemed <= prefs.clockWarningDays }">
              <Clock :size="10" /> {{ c.days_to_deemed }}d
            </span>
          </div>
          <span class="eodr-caseitem-title">{{ c.description || devLabel(c.development_type) }}</span>
          <div class="eodr-caseitem-meta">
            <span>Stand {{ c.stand_number }}</span>
            <span class="eodr-statuschip" :class="c.handoff_status === 'returned' ? 'bad' : 'neutral'">
              {{ c.handoff_status === 'returned' ? 'Returned' : statusLabel(c.status) }}
            </span>
          </div>
        </button>
      </div>
    </aside>

    <!-- PACKAGE -->
    <main class="eodr-pkg">
      <!-- Empty -->
      <div v-if="!selectedId" class="eodr-empty">
        <Gavel :size="34" />
        <h3>EO Planner decision workspace</h3>
        <p>Select a case from the inbox to review the full decision package — planner
          recommendation, specialist findings, objections, documents and GIS evidence —
          then determine, return, or request information.</p>
        <div v-if="lastDoc" class="eodr-lastdoc">
          <FileCheck2 :size="15" />
          <span>{{ lastDoc.title || 'Decision letter' }} generated.</span>
          <button class="eodr-btn ghost sm" :disabled="viewingDoc" @click="viewDocument(lastDoc.id)">
            <component :is="viewingDoc ? Loader2 : Eye" :size="13" :class="{ spin: viewingDoc }" /> View letter
          </button>
        </div>
      </div>

      <div v-else-if="loadingPkg" class="eodr-empty"><Loader2 :size="26" class="spin" /><p>Loading decision package…</p></div>
      <div v-else-if="pkgError" class="eodr-empty err"><AlertTriangle :size="26" /><p>{{ pkgError }}</p>
        <button class="eodr-btn ghost" @click="loadPackage(selectedId!)">Retry</button>
      </div>

      <template v-else-if="pkg">
        <!-- Header -->
        <header class="eodr-pkg-head">
          <div>
            <div class="eodr-pkg-ref">
              <Gavel :size="15" />
              <strong>{{ headerRef }}</strong>
              <span class="eodr-statuschip neutral">{{ statusLabel(pkg.permit.status) }}</span>
            </div>
            <p class="eodr-pkg-title">{{ pkg.permit.description || devLabel(pkg.permit.development_type) }}</p>
            <p class="eodr-pkg-sub">
              {{ pkg.permit.applicant_name }} · Stand {{ pkg.permit.stand_number }}
              · {{ pkg.permit.suburb_ward }} · {{ devLabel(pkg.permit.development_type) }}
              · received {{ fmtDate(pkg.permit.received_at) }}
            </p>
          </div>
          <div v-if="deemed != null" class="eodr-deemed"
               :class="{ crit: deemed <= Math.ceil(prefs.clockWarningDays / 2),
                         warn: deemed > Math.ceil(prefs.clockWarningDays / 2) && deemed <= prefs.clockWarningDays }">
            <Clock :size="14" />
            <div><strong>{{ deemed }}</strong><span>days to deemed refusal</span></div>
          </div>
        </header>

        <div class="eodr-grid">
          <!-- LEFT: evidence -->
          <div class="eodr-col">
            <!-- Planner recommendation -->
            <section class="eodr-card">
              <header><ClipboardList :size="13" /> Planner recommendation</header>
              <div class="eodr-card-body">
                <div v-if="pkg.recommendation.value" class="eodr-reco">
                  <span class="eodr-statuschip" :class="outcomeClass(pkg.recommendation.value)">
                    {{ statusLabel(pkg.recommendation.value) }}
                  </span>
                </div>
                <p v-if="pkg.recommendation.reasons" class="eodr-reason">{{ pkg.recommendation.reasons }}</p>
                <p v-if="!pkg.recommendation.value && !pkg.recommendation.reasons" class="eodr-muted">
                  No planner recommendation recorded yet.
                </p>
              </div>
            </section>

            <!-- Specialist findings -->
            <section class="eodr-card">
              <header><Users :size="13" /> Specialist findings
                <span class="eodr-hcount">{{ pkg.findings.length }}</span></header>
              <div class="eodr-card-body">
                <div v-if="!pkg.findings.length" class="eodr-muted">No specialist findings returned yet.</div>
                <ul v-else class="eodr-findings">
                  <li v-for="f in pkg.findings" :key="f.finding_type + f.source_id">
                    <div class="eodr-finding-top">
                      <span class="eodr-finding-label">{{ findingGroupLabel(f) }}</span>
                      <span class="eodr-statuschip" :class="outcomeClass(f.outcome)">
                        {{ f.outcome ? statusLabel(f.outcome) : 'Pending' }}
                      </span>
                    </div>
                    <p v-if="f.summary" class="eodr-finding-sum">{{ f.summary }}</p>
                    <span class="eodr-finding-meta">
                      {{ f.specialist_name || '—' }} · {{ fmtDate(f.received_at) }}
                    </span>
                  </li>
                </ul>
              </div>
            </section>

            <!-- Objections -->
            <section class="eodr-card">
              <header><AlertTriangle :size="13" /> Objections
                <span class="eodr-hcount">{{ pkg.objection_summary.total }}</span></header>
              <div class="eodr-card-body">
                <div class="eodr-objsum">
                  <span><strong>{{ pkg.objection_summary.total }}</strong> total</span>
                  <span class="bad"><strong>{{ pkg.objection_summary.sustained }}</strong> sustained</span>
                  <span class="warn"><strong>{{ pkg.objection_summary.pending }}</strong> pending</span>
                </div>
                <ul v-if="pkg.objections.length" class="eodr-objlist">
                  <li v-for="o in pkg.objections" :key="o.id">
                    <span class="eodr-obj-name">{{ o.objector_name }}</span>
                    <span class="eodr-obj-grounds">{{ o.grounds || '—' }}</span>
                  </li>
                </ul>
                <p v-else class="eodr-muted">No objections lodged.</p>
              </div>
            </section>

            <!-- Documents + GIS evidence -->
            <section class="eodr-card">
              <header><FileText :size="13" /> Documents &amp; evidence</header>
              <div class="eodr-card-body">
                <div class="eodr-doc-row" v-if="pkg.building_plans.length">
                  <Building2 :size="13" />
                  <span>{{ pkg.building_plans.length }} building-plan revision{{ pkg.building_plans.length > 1 ? 's' : '' }}</span>
                </div>
                <ul v-if="pkg.documents.length" class="eodr-doclist">
                  <li v-for="d in pkg.documents" :key="d.id">
                    <FileText :size="12" />
                    <button class="eodr-doclink" @click="viewDocument(d.id)">
                      {{ d.title || statusLabel(d.doc_type) }}</button>
                    <span class="eodr-muted">v{{ d.version }}</span>
                  </li>
                </ul>
                <p v-else-if="!pkg.building_plans.length" class="eodr-muted">No generated documents yet.</p>

                <div class="eodr-gis" v-if="pkg.permit.lng != null && pkg.permit.lat != null">
                  <MapPin :size="13" />
                  <span>GIS centroid {{ pkg.permit.lat!.toFixed(5) }}, {{ pkg.permit.lng!.toFixed(5) }}</span>
                </div>
                <div class="eodr-gis muted" v-else>
                  <MapPin :size="13" /><span>No GIS location on record.</span>
                </div>
              </div>
            </section>

            <!-- GIS evidence map -->
            <section class="eodr-card">
              <header><MapIcon :size="13" /> GIS evidence
                <button class="eodr-btn ghost sm eodr-snap"
                        :disabled="!mapReady || savingSnapshot" @click="saveSnapshot">
                  <component :is="savingSnapshot ? Loader2 : Camera" :size="13" :class="{ spin: savingSnapshot }" />
                  Save snapshot
                </button>
              </header>
              <div class="eodr-card-body">
                <template v-if="pkg.permit.lng != null && pkg.permit.lat != null">
                  <div class="eodr-evtoggles">
                    <button v-for="t in EV_TOGGLES" :key="t.key" class="eodr-evchip"
                            :class="{ on: evidenceLayers[t.key] }" @click="toggleLayer(t.key)">
                      {{ t.label }}
                    </button>
                  </div>
                  <div ref="mapContainer" class="eodr-evmap"></div>
                  <p class="eodr-muted eodr-evnote">
                    Application centroid {{ pkg.permit.lat!.toFixed(5) }}, {{ pkg.permit.lng!.toFixed(5) }}
                    · zoning, land-use, roads &amp; environmental constraints from the PostGIS basemap.
                  </p>
                </template>
                <p v-else class="eodr-muted">
                  No GIS location on record for this application — a map snapshot cannot be produced.
                </p>
              </div>
            </section>

            <!-- Audit trail -->
            <section class="eodr-card">
              <header><Scale :size="13" /> Audit trail
                <span class="eodr-hcount">{{ events.length }}</span></header>
              <div class="eodr-card-body">
                <div class="eodr-evtoggles">
                  <button v-for="f in EVENT_FILTERS" :key="f.key" class="eodr-evchip"
                          :class="{ on: eventFilter === f.key }" @click="eventFilter = f.key">
                    {{ f.label }}
                  </button>
                </div>
                <ul v-if="filteredEvents.length" class="eodr-events eodr-events-scroll">
                  <li v-for="(e, i) in filteredEvents" :key="i" :class="{ key: eoEvents.has(e.event_type) }">
                    <span class="eodr-ev-type">{{ eventLabel(e.event_type) }}<span
                          v-if="eventDetail(e)" class="eodr-ev-detail"> — {{ eventDetail(e) }}</span></span>
                    <span class="eodr-ev-meta">{{ e.actor_name || e.actor_role || 'System' }} · {{ fmtDateTime(e.created_at) }}</span>
                  </li>
                </ul>
                <p v-else class="eodr-muted">No recorded activity in this view.</p>
              </div>
            </section>
          </div>

          <!-- RIGHT: decision -->
          <div class="eodr-col">
            <!-- Conditions -->
            <section class="eodr-card">
              <header><CheckCircle2 :size="13" /> Proposed conditions
                <span class="eodr-hcount">{{ conditions.length }}</span></header>
              <div class="eodr-card-body">
                <ul v-if="conditions.length" class="eodr-condlist">
                  <li v-for="(c, i) in conditions" :key="i">
                    <span>{{ c.text }}</span>
                    <button class="eodr-icon sm" title="Remove" @click="removeCondition(i)"><Trash2 :size="12" /></button>
                  </li>
                </ul>
                <p v-else class="eodr-muted">No conditions yet. Add the conditions of approval below.</p>
                <div class="eodr-condadd">
                  <input v-model="newCondition" placeholder="Add a condition of approval…"
                         @keyup.enter="addCondition" />
                  <button class="eodr-btn ghost sm" @click="addCondition"><Plus :size="13" /> Add</button>
                </div>
              </div>
            </section>

            <!-- Decision notes + actions -->
            <section class="eodr-card eodr-decide">
              <header><Gavel :size="13" /> EO determination</header>
              <div class="eodr-card-body">
                <label class="eodr-label">Decision notes / reason</label>
                <textarea v-model="decisionNotes" rows="4"
                          placeholder="Reasons for the decision, refusal grounds, return instructions, or the request to the applicant…"></textarea>

                <div class="eodr-actions">
                  <button class="eodr-btn ok" :disabled="!!busy" @click="decide('approve')">
                    <component :is="busy === 'approve' ? Loader2 : CheckCircle2" :size="14" :class="{ spin: busy === 'approve' }" />
                    Approve
                  </button>
                  <button class="eodr-btn ok-alt" :disabled="!!busy" @click="decide('approve_with_conditions')">
                    <component :is="busy === 'approve_with_conditions' ? Loader2 : CheckCircle2" :size="14" :class="{ spin: busy === 'approve_with_conditions' }" />
                    Approve with conditions
                  </button>
                  <button class="eodr-btn bad" :disabled="!!busy" @click="decide('refuse')">
                    <component :is="busy === 'refuse' ? Loader2 : XCircle" :size="14" :class="{ spin: busy === 'refuse' }" />
                    Refuse
                  </button>
                </div>

                <div class="eodr-return">
                  <label class="eodr-label">Return to role</label>
                  <div class="eodr-return-row">
                    <select v-model="returnRole">
                      <option v-for="r in RETURN_ROLE_OPTIONS" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
                    </select>
                    <button class="eodr-btn ghost" :disabled="!!busy" @click="doReturn">
                      <component :is="busy === 'return' ? Loader2 : CornerUpLeft" :size="14" :class="{ spin: busy === 'return' }" />
                      Return
                    </button>
                  </div>
                  <button class="eodr-btn ghost wide" :disabled="!!busy" @click="requestInfo">
                    <component :is="busy === 'request' ? Loader2 : MessageSquare" :size="14" :class="{ spin: busy === 'request' }" />
                    Request information from applicant
                  </button>
                </div>
              </div>
            </section>

            <!-- Thread -->
            <section class="eodr-card">
              <header><MessageSquare :size="13" /> Case thread</header>
              <div class="eodr-card-body">
                <ul v-if="messages.length" class="eodr-thread">
                  <li v-for="m in messages" :key="m.id" :class="m.message_type">
                    <div class="eodr-msg-top">
                      <span class="eodr-msg-author">{{ m.author_name || m.author_role || 'Staff' }}</span>
                      <span class="eodr-msg-vis">{{ m.visibility }}</span>
                      <span class="eodr-msg-time">{{ fmtDateTime(m.created_at) }}</span>
                    </div>
                    <p>{{ m.body }}</p>
                  </li>
                </ul>
                <p v-else class="eodr-muted">No messages on this case yet.</p>
                <div class="eodr-condadd">
                  <input v-model="newMessage" placeholder="Add an internal note…" @keyup.enter="postNote" />
                  <button class="eodr-btn ghost sm" :disabled="busy === 'note' || !newMessage.trim()" @click="postNote">
                    <component :is="busy === 'note' ? Loader2 : Send" :size="13" :class="{ spin: busy === 'note' }" /> Post
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
/* Migrated onto the enterprise token SSOT (src/styles/enterprise.css). The
   violet this file hardcoded 126 times was a second brand for one section: an
   EO determination screen that is a different colour from every other screen
   the same officer uses is inconsistency, not identity. */
.eodr { display:grid; grid-template-columns:280px minmax(0, 1fr); gap:0; height:100%; position:relative; }

/* Toast */
.eodr-toast { position:fixed; top:var(--ent-s4); right:var(--ent-s4); z-index:var(--ent-z-toast);
  display:flex; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s2) var(--ent-s4); border-radius:var(--ent-r);
  font-size:var(--ent-fs-sm); color:var(--ent-text-on-accent); box-shadow:var(--ent-e3); }
.eodr-toast.success { background:var(--ent-success); }
.eodr-toast.error { background:var(--ent-danger); }
.eodr-toast-enter-active, .eodr-toast-leave-active {
  transition:opacity var(--ent-dur) var(--ent-ease), transform var(--ent-dur) var(--ent-ease); }
.eodr-toast-enter-from, .eodr-toast-leave-to { opacity:0; transform:translateY(-6px); }

/* Inbox */
.eodr-inbox { display:flex; flex-direction:column; min-height:0; max-height:100%;
  background:var(--ent-surface); border-right:1px solid var(--ent-line); }
.eodr-inbox-head { display:flex; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s3) var(--ent-s4); border-bottom:1px solid var(--ent-line);
  font-size:var(--ent-fs-sm); color:var(--ent-text); }
.eodr-inbox-head strong { font-weight:var(--ent-fw-bold); }
.eodr-inbox-head .eodr-icon { margin-left:auto; }
.eodr-search { margin:var(--ent-s3) var(--ent-s3) var(--ent-s2);
  padding:0 var(--ent-s3); min-height:var(--ent-control-h-sm);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); background:var(--ent-surface); color:var(--ent-text); }
.eodr-search:focus { outline:none; border-color:var(--ent-accent); box-shadow:var(--ent-focus-ring); }
.eodr-buckets { display:flex; flex-wrap:wrap; gap:var(--ent-s1); padding:0 var(--ent-s3) var(--ent-s3); }
.eodr-bucket { display:inline-flex; align-items:center; gap:var(--ent-s1);
  padding:3px var(--ent-s2); border:1px solid var(--ent-line); background:var(--ent-surface);
  border-radius:var(--ent-r-pill); font-family:var(--ent-font); font-size:var(--ent-fs-micro);
  color:var(--ent-text-2); cursor:pointer; }
.eodr-bucket:hover { border-color:var(--ent-line-strong); color:var(--ent-text); }
.eodr-bucket:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eodr-bucket.active { background:var(--ent-accent-soft); border-color:var(--ent-accent-line);
  color:var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.eodr-count { font-weight:var(--ent-fw-bold); font-variant-numeric:tabular-nums; }
.eodr-caselist { overflow-y:auto; flex:1; min-height:0; }
.eodr-caseitem { display:flex; flex-direction:column; gap:2px; width:100%; text-align:left;
  padding:var(--ent-s2) var(--ent-s4); border:0; border-top:1px solid var(--ent-line);
  background:transparent; cursor:pointer; font-family:var(--ent-font); }
.eodr-caseitem:hover { background:var(--ent-surface-2); }
.eodr-caseitem:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.eodr-caseitem.active { background:var(--ent-accent-soft); box-shadow:inset 3px 0 0 var(--ent-accent); }
.eodr-caseitem-top { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s2); }
.eodr-ref { font-family:var(--ent-font-mono); font-weight:var(--ent-fw-semibold);
  font-size:var(--ent-fs-xs); color:var(--ent-text); }
.eodr-caseitem-title { font-size:var(--ent-fs-xs); color:var(--ent-text-2);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.eodr-caseitem-meta { display:flex; align-items:center; justify-content:space-between;
  gap:var(--ent-s2); font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.eodr-clock { display:inline-flex; align-items:center; gap:2px; flex-shrink:0;
  padding:1px 6px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.eodr-clock.warn { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.eodr-clock.crit { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }

/* Package */
.eodr-pkg { overflow-y:auto; min-height:0; max-height:100%; background:var(--ent-canvas); }
.eodr-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--ent-s3); height:100%; padding:var(--ent-s8); text-align:center; color:var(--ent-text-3); }
.eodr-empty h3 { margin:0; color:var(--ent-text); font-size:var(--ent-fs-lg); }
.eodr-empty p { margin:0; max-width:46ch; font-size:var(--ent-fs-sm); line-height:var(--ent-lh); }
.eodr-empty svg { color:var(--ent-text-3); }
.eodr-empty.err { color:var(--ent-danger); }
.eodr-empty.err svg { color:var(--ent-danger); }

.eodr-pkg-head { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--ent-s4);
  padding:var(--ent-s4) var(--ent-s5); background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); }
.eodr-pkg-ref { display:flex; align-items:center; gap:var(--ent-s2); color:var(--ent-text); }
.eodr-pkg-ref strong { font-family:var(--ent-font-mono); font-size:var(--ent-fs-md); }
.eodr-pkg-ref svg { color:var(--ent-accent); }
.eodr-pkg-title { margin:var(--ent-s2) 0 2px; font-size:var(--ent-fs-base);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.eodr-pkg-sub { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.eodr-deemed { display:flex; align-items:center; gap:var(--ent-s2); white-space:nowrap;
  padding:var(--ent-s2) var(--ent-s3); border-radius:var(--ent-r);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.eodr-deemed.warn { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.eodr-deemed.crit { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.eodr-deemed strong { display:block; font-size:var(--ent-fs-xl); line-height:1;
  font-variant-numeric:tabular-nums; }
.eodr-deemed span { font-size:var(--ent-fs-micro); }

.eodr-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr));
  gap:var(--ent-s4); padding:var(--ent-s4) var(--ent-s5) var(--ent-s8); }
.eodr-col { display:flex; flex-direction:column; gap:var(--ent-s4); min-width:0; }

.eodr-card { background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); overflow:hidden; }
.eodr-card > header { display:flex; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface-2);
  border-bottom:1px solid var(--ent-line);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.eodr-card > header svg { color:var(--ent-text-3); }
.eodr-hcount { margin-left:auto; padding:1px 7px; border-radius:var(--ent-r-pill);
  background:var(--ent-surface); border:1px solid var(--ent-line);
  color:var(--ent-text-2); font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  font-variant-numeric:tabular-nums; }
.eodr-card-body { padding:var(--ent-s3) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
/* The determination card is the one thing on this screen that changes a
   statutory record, so it is the one card the accent is spent on. */
.eodr-decide { border-color:var(--ent-accent-line); }
.eodr-decide > header { background:var(--ent-accent-soft); color:var(--ent-accent); }
.eodr-decide > header svg { color:var(--ent-accent); }

.eodr-muted { color:var(--ent-text-3); font-size:var(--ent-fs-xs); }
.eodr-pad { padding:var(--ent-s4); display:flex; align-items:center; gap:var(--ent-s2); }
.eodr-reason { margin:var(--ent-s2) 0 0; line-height:var(--ent-lh); }
.eodr-reco { margin-bottom:var(--ent-s1); }

/* chips */
.eodr-statuschip { display:inline-block; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.eodr-statuschip.ok { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); }
.eodr-statuschip.bad { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.eodr-statuschip.warn { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.eodr-statuschip.neutral { background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }

.eodr-findings { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s3); }
.eodr-findings li { border-bottom:1px solid var(--ent-line); padding-bottom:var(--ent-s3); }
.eodr-findings li:last-child { border-bottom:0; padding-bottom:0; }
.eodr-finding-top { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s2); }
.eodr-finding-label { font-weight:var(--ent-fw-semibold); color:var(--ent-text); font-size:var(--ent-fs-xs); }
.eodr-finding-sum { margin:var(--ent-s1) 0; line-height:var(--ent-lh); }
.eodr-finding-meta { font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.eodr-objsum { display:flex; gap:var(--ent-s4); margin-bottom:var(--ent-s2);
  font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.eodr-objsum .bad strong { color:var(--ent-danger); }
.eodr-objsum .warn strong { color:var(--ent-warning); }
.eodr-objlist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.eodr-objlist li { display:flex; flex-direction:column; }
.eodr-obj-name { font-weight:var(--ent-fw-semibold); font-size:var(--ent-fs-xs); color:var(--ent-text); }
.eodr-obj-grounds { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.eodr-doc-row, .eodr-gis { display:flex; align-items:center; gap:var(--ent-s2);
  margin-top:var(--ent-s2); font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.eodr-gis.muted { color:var(--ent-text-3); }

.eodr-snap { margin-left:auto; }
.eodr-evtoggles { display:flex; flex-wrap:wrap; gap:var(--ent-s1); margin-bottom:var(--ent-s3); }
.eodr-evchip { padding:3px var(--ent-s2); border:1px solid var(--ent-line); background:var(--ent-surface);
  border-radius:var(--ent-r-pill); font-family:var(--ent-font); font-size:var(--ent-fs-micro);
  color:var(--ent-text-2); cursor:pointer; }
.eodr-evchip:hover { border-color:var(--ent-line-strong); color:var(--ent-text); }
.eodr-evchip:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eodr-evchip.on { background:var(--ent-accent-soft); border-color:var(--ent-accent-line);
  color:var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.eodr-evmap { height:240px; border-radius:var(--ent-r-sm); overflow:hidden;
  border:1px solid var(--ent-line); }
.eodr-evnote { margin:var(--ent-s2) 0 0; line-height:var(--ent-lh); }
.eodr-doclist { list-style:none; margin:var(--ent-s2) 0 0; padding:0;
  display:flex; flex-direction:column; gap:var(--ent-s1); }
.eodr-doclist li { display:flex; align-items:center; gap:var(--ent-s2); font-size:var(--ent-fs-xs); }
.eodr-doclink { background:none; border:0; padding:0; text-align:left; cursor:pointer;
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); color:var(--ent-accent); }
.eodr-doclink:hover { text-decoration:underline; }
.eodr-doclink:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.eodr-lastdoc { display:flex; align-items:center; gap:var(--ent-s3); margin-top:var(--ent-s5);
  padding:var(--ent-s3) var(--ent-s4); border-radius:var(--ent-r);
  background:var(--ent-tone-positive-bg); border:1px solid var(--ent-tone-positive-line);
  color:var(--ent-tone-positive-fg); font-size:var(--ent-fs-sm); }
.eodr-lastdoc svg { color:var(--ent-success); }

.eodr-events { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.eodr-events li { display:flex; flex-direction:column; padding-left:var(--ent-s3);
  border-left:2px solid var(--ent-line); }
.eodr-events li.key { border-left-color:var(--ent-accent); }
.eodr-ev-type { font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.eodr-ev-detail { color:var(--ent-text-3); font-weight:var(--ent-fw-normal); }
.eodr-ev-meta { font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.eodr-events-scroll { max-height:260px; overflow-y:auto; }

.eodr-condlist { list-style:none; margin:0 0 var(--ent-s3); padding:0;
  display:flex; flex-direction:column; gap:var(--ent-s2); }
.eodr-condlist li { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--ent-s2);
  padding:var(--ent-s2) var(--ent-s3); font-size:var(--ent-fs-xs);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); }
.eodr-condadd { display:flex; gap:var(--ent-s2); }
.eodr-condadd input { flex:1; min-width:0; padding:0 var(--ent-s3); min-height:var(--ent-control-h-sm);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); color:var(--ent-text); background:var(--ent-surface); }
.eodr-condadd input:focus { outline:none; border-color:var(--ent-accent); box-shadow:var(--ent-focus-ring); }

.eodr-label { display:block; margin-bottom:var(--ent-s1);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.04em;
  text-transform:uppercase; color:var(--ent-text-3); }
.eodr-decide textarea { width:100%; box-sizing:border-box; padding:var(--ent-s2) var(--ent-s3);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); resize:vertical;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); color:var(--ent-text);
  background:var(--ent-surface); }
.eodr-decide textarea:focus { outline:none; border-color:var(--ent-accent); box-shadow:var(--ent-focus-ring); }
.eodr-actions { display:flex; flex-wrap:wrap; gap:var(--ent-s2); margin-top:var(--ent-s3); }
.eodr-return { margin-top:var(--ent-s4); padding-top:var(--ent-s4); border-top:1px solid var(--ent-line); }
.eodr-return-row { display:flex; gap:var(--ent-s2); margin-bottom:var(--ent-s2); }
.eodr-return-row select { flex:1; min-width:0; padding:0 var(--ent-s2); min-height:var(--ent-control-h-sm);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); color:var(--ent-text); background:var(--ent-surface); }

.eodr-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  border:1px solid transparent; border-radius:var(--ent-r); cursor:pointer;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); }
.eodr-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eodr-btn:disabled { opacity:0.55; cursor:not-allowed; }
/* Approve, approve-with-conditions and refuse are three different statutory
   acts, so they read as three, and only the refusal is allowed to be loud. */
.eodr-btn.ok { background:var(--ent-success); color:var(--ent-text-on-accent); }
.eodr-btn.ok-alt { background:var(--ent-surface); border-color:var(--ent-tone-positive-line);
  color:var(--ent-success); }
.eodr-btn.ok-alt:hover:not(:disabled) { background:var(--ent-tone-positive-bg); }
.eodr-btn.bad { background:var(--ent-danger); color:var(--ent-text-on-accent); }
.eodr-btn.ghost { background:var(--ent-surface); border-color:var(--ent-line); color:var(--ent-text); }
.eodr-btn.ghost:hover:not(:disabled) { background:var(--ent-surface-2); }
.eodr-btn.wide { width:100%; justify-content:center; }
.eodr-btn.sm { min-height:var(--ent-control-h-sm); padding:0 var(--ent-s2); font-size:var(--ent-fs-xs); }

.eodr-thread { list-style:none; margin:0 0 var(--ent-s3); padding:0;
  display:flex; flex-direction:column; gap:var(--ent-s3); max-height:240px; overflow-y:auto; }
.eodr-thread li { padding:var(--ent-s2) var(--ent-s3);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); }
.eodr-thread li.citizen_message { background:var(--ent-tone-info-bg); border-color:var(--ent-tone-info-line); }
.eodr-thread li.decision_comment { background:var(--ent-accent-soft); border-color:var(--ent-accent-line); }
.eodr-msg-top { display:flex; align-items:center; gap:var(--ent-s2); margin-bottom:2px; }
.eodr-msg-author { font-weight:var(--ent-fw-semibold); font-size:var(--ent-fs-micro); color:var(--ent-text); }
.eodr-msg-vis { padding:0 5px; border-radius:var(--ent-r-sm);
  font-size:var(--ent-fs-micro); letter-spacing:0.03em; text-transform:uppercase;
  background:var(--ent-surface); border:1px solid var(--ent-line); color:var(--ent-text-3); }
.eodr-msg-time { margin-left:auto; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.eodr-thread li p { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-2); line-height:var(--ent-lh); }

.eodr-icon { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h-sm); height:var(--ent-control-h-sm);
  border:1px solid var(--ent-line); border-radius:var(--ent-r-sm);
  background:var(--ent-surface); color:var(--ent-text-2); cursor:pointer; }
.eodr-icon:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.eodr-icon:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.eodr-icon.sm { width:22px; height:22px; border-color:transparent; }
.eodr-icon:disabled { opacity:0.5; cursor:not-allowed; }
.spin { animation:eodr-spin 1s linear infinite; }
@keyframes eodr-spin { to { transform:rotate(360deg); } }

@media (max-width: 1279px) {
  .eodr-grid { grid-template-columns:minmax(0, 1fr); }
}
@media (max-width: 767px) {
  .eodr { grid-template-columns:minmax(0, 1fr); }
  .eodr-inbox { max-height:240px; border-right:0; border-bottom:1px solid var(--ent-line); }
  .eodr-grid { padding:var(--ent-s3) var(--ent-s4) var(--ent-s8); }
  .eodr-pkg-head { flex-direction:column; gap:var(--ent-s3); padding:var(--ent-s4); }
}
@media (prefers-reduced-motion: reduce) {
  .spin { animation:none; }
}
</style>
