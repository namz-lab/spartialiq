<script setup lang="ts">
// Environmental Health Officer — spatial console (map pane of /env-officer-workspace).
//
// WHAT AN EHO ACTUALLY QUERIES ON A MAP, AND WHERE EACH ONE LIVES
//   What is at this spot?        identify-on-click  → GET /inspector/identify
//                                (stand, cadastral parcel, master-plan zone,
//                                 mapped structure, building-control cases,
//                                 open enforcement orders, ward/jurisdiction)
//   Is this site near water,     site screening     → GET /inspector/permits/:id
//   a wetland, a protected                             /site-report
//   area, a cemetery, a waste    measured distances against the statutory
//   site, a railway?             30 m EMA stream-bank buffer and the council
//                                review distances — never a legal finding
//   How far / how big?           measure tool (turf)        — MapToolbar
//   Who is within X metres?      notification radius        — MapToolbar
//   Where is this place?         coordinate + gazetteer     — MapToolbar
//   What does it look like?      satellite / hybrid imagery — MapToolbar
//   Where am I standing?         GeolocateControl (field GPS)
//   Give me a map sheet          A4 PDF export              — MapToolbar
//   Which layers?                env-first layer panel, PostGIS vector tiles
//
// None of the query endpoints are new: the Building Inspector GIS service
// already exposes them and `env_officer` is already inside its STAFF_ROLES
// allowlist. This console simply stopped short of calling them, so an EHO was
// rating environmental risk with no spatial evidence on screen at all.
//
// Nothing computed here is a determination. Statutory figures are labelled as
// statutory; everything else is a council review distance, and a missing layer
// reads "No data", never "Clear".

import { ref, shallowRef, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSpatialStore } from '@/stores/spatial'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { addVunguBasemap, DEFAULT_VISIBLE } from '@/map/vunguBasemap'
import { chipColorFor } from '@/map/vunguBasemapStyle'
import { flyTo } from '@/map/tools/camera'
import { escapeHtml } from '@/utils/escapeHtml'
import { dmApi, type PermitApplication, type Consultation } from '@/services/developmentManagementService'
import { inspectorGis, type IdentifyResult, type SiteReport } from '@/services/inspectorGis'
import { ehoApi, type CatchmentResult, type EhoLayer, type EhoMapLayers, type NearbyResult } from '@/services/environmentalHealth'
// @ts-ignore — turf ships no separate @types package in this project
import * as turf from '@turf/turf'
import { describeConstraints, isPositioned, sortConstraints } from '@/inspector/siteGeo'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'
import InspectorIdentifyCard from '@/components/inspector/InspectorIdentifyCard.vue'
import InspectorSiteReport from '@/components/inspector/InspectorSiteReport.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Leaf, RefreshCw, Layers, MapPin, AlertTriangle, TreePine, Droplets,
  FileText, Inbox, ClipboardCheck, Crosshair, ListFilter, ShieldAlert, Wand2, X,
} from 'lucide-vue-next'

// `embedded` hides this console's own brand block, profile menu and the
// navigate-to-workspace button when it is hosted as the map pane of
// RoleWorkspaceShell (which supplies that chrome). Every working control —
// refresh, layer toggles, map tools — is kept.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
const authStore = useAuthStore()
const spatialStore = useSpatialStore()
const { isMobile } = useBreakpoint()

// Statuses where an environmental review is relevant.
const REVIEW_STATUSES = new Set([
  'registered', 'acknowledged', 'circulation', 'consultation', 'under_review', 'objection_period',
])

// ── Real data ────────────────────────────────────────────────────────────────
const permits = ref<PermitApplication[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function refresh() {
  loading.value = true; error.value = null
  try {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    permits.value = (r.data ?? []).filter(p => REVIEW_STATUSES.has(p.status))
    void flushPendingReviews()
  } catch (e: unknown) {
    const err = e as { response?: { data?: { error?: string } }; message?: string }
    error.value = err?.response?.data?.error ?? err?.message ?? 'Failed to load applications'
    permits.value = []
  } finally {
    loading.value = false
  }
}

const geolocated = computed(() => permits.value.filter(p => p.lng != null && p.lat != null))

// ── Selection / review ────────────────────────────────────────────────────────
const selected = ref<PermitApplication | null>(null)
function openPermit(p: PermitApplication) {
  selected.value = p
  clearIdentify()
  const prior = readEnvReviews().find(r => r.permitId === p.id)
  review.summary = prior?.summary ?? ''
  review.recommendation = prior?.recommendation ?? ''
  review.risk = prior?.risk ?? ''
  submitState.value = prior ? (prior.via === 'consultation' ? 'saved' : 'local') : ''
  submitNote.value = prior
    ? (prior.via === 'consultation'
      ? `Previously filed ${new Date(prior.savedAt).toLocaleString('en-GB')}.`
      : `Held locally since ${new Date(prior.savedAt).toLocaleString('en-GB')}.`)
    : ''
  if (isMobile.value) detailSheetOpen.value = true
  if (p.lng != null && p.lat != null) {
    flyTo(mapInstance.value, { center: [p.lng, p.lat], zoom: 15, duration: 700 })
  }
}

const review = reactive({ summary: '', recommendation: '', risk: '' })
const submitState = ref<'' | 'saving' | 'saved' | 'local' | 'invalid'>('')
const submitNote = ref('')
const ENV_REVIEWS_KEY = 'eho_env_reviews_v1'

type StoredEnvReview = {
  permitId: string
  stand_number: string
  summary: string
  risk: string
  recommendation: string
  savedAt: string
  via: 'consultation' | 'local'
}

function readEnvReviews(): StoredEnvReview[] {
  try { return JSON.parse(localStorage.getItem(ENV_REVIEWS_KEY) || '[]') } catch { return [] }
}
function writeEnvReviews(rows: StoredEnvReview[]) {
  try { localStorage.setItem(ENV_REVIEWS_KEY, JSON.stringify(rows)) } catch { /* no-op */ }
}

function persistEnvReview(row: StoredEnvReview) {
  const rest = readEnvReviews().filter(r => r.permitId !== row.permitId)
  writeEnvReviews([row, ...rest])
}

function outcomeFor(rec: string): Consultation['outcome'] {
  if (rec === 'objection') return 'objection'
  if (rec === 'no_objection') return 'no_objection'
  return 'conditional'
}

function responseStatusFor(rec: string): string {
  if (rec === 'objection') return 'objection'
  if (rec === 'no_objection') return 'no_objection'
  return 'conditional_approval'
}

function reviewNotes(r: Pick<StoredEnvReview, 'summary' | 'risk' | 'recommendation'>): string {
  return [
    r.summary.trim(),
    `Risk: ${r.risk}.`,
    r.recommendation === 'eia_required' ? 'EIA required before determination.' : '',
  ].filter(Boolean).join('\n')
}

async function findOpenEnvReferral(permitId: string) {
  try {
    const list = await dmApi.listConsultations(permitId)
    return list.find(c => {
      const dept = (c.body_name || c.department || '').toLowerCase()
      const status = c.response_status ?? c.outcome
      return (dept.includes('environment') || dept.includes('eia'))
        && (!status || status === 'pending')
    }) ?? null
  } catch {
    return null
  }
}

/**
 * File one review against the permit. Resolves true when the council record
 * actually took it — the caller decides what to do with a false.
 */
async function fileReview(row: StoredEnvReview): Promise<boolean> {
  const notes = reviewNotes(row)
  try {
    const open = await findOpenEnvReferral(row.permitId)
    if (open) {
      await dmApi.respondConsultation(open.id, {
        response_status: responseStatusFor(row.recommendation),
        response_notes: notes,
        response_received_at: new Date().toISOString(),
      })
    } else {
      await dmApi.createConsultation(row.permitId, {
        department: 'environment',
        outcome: outcomeFor(row.recommendation),
        response: notes,
        notes: `Environmental review · risk ${row.risk}`,
      })
    }
    return true
  } catch {
    return false
  }
}

// A review the officer wrote while the planning service was down used to sit in
// localStorage forever: nothing ever retried it, so a field review could be
// lost with no one aware. Every refresh now re-files the held ones.
const pendingCount = ref(0)
async function flushPendingReviews() {
  const rows = readEnvReviews()
  const held = rows.filter(r => r.via === 'local')
  pendingCount.value = held.length
  if (!held.length) return
  for (const row of held) {
    if (await fileReview(row)) {
      row.via = 'consultation'
      if (selected.value?.id === row.permitId && submitState.value === 'local') {
        submitState.value = 'saved'
        submitNote.value = 'A review held on this workstation has now been filed with the council record.'
      }
    }
  }
  writeEnvReviews(rows)
  pendingCount.value = rows.filter(r => r.via === 'local').length
}

async function submitReview() {
  if (!selected.value) return
  if (!review.summary.trim() || !review.recommendation || !review.risk) {
    submitState.value = 'invalid'
    submitNote.value = 'Findings, risk level and recommendation are required before filing.'
    return
  }
  submitState.value = 'saving'
  submitNote.value = ''

  const stored: StoredEnvReview = {
    permitId: selected.value.id,
    stand_number: selected.value.stand_number || '',
    summary: review.summary.trim(),
    risk: review.risk,
    recommendation: review.recommendation,
    savedAt: new Date().toISOString(),
    via: 'local',
  }

  if (await fileReview(stored)) {
    stored.via = 'consultation'
    persistEnvReview(stored)
    submitState.value = 'saved'
    submitNote.value = 'Review recorded on the permit as an environmental consultation.'
  } else {
    persistEnvReview(stored)
    submitState.value = 'local'
    submitNote.value = 'The planning service was unavailable. This review is kept on this workstation and re-filed automatically on the next refresh.'
  }
  pendingCount.value = readEnvReviews().filter(r => r.via === 'local').length
}

// ── Site screening (GET /inspector/permits/:id/site-report) ──────────────────
// InspectorSiteReport runs and renders the whole check; this view only keeps
// the constraint rows so the officer can lift the measured distances into
// their findings. The risk rating and the recommendation stay the officer's —
// a measured distance is evidence, not a determination.
const screening = shallowRef<SiteReport | null>(null)

const flaggedConstraints = computed(() =>
  sortConstraints(screening.value?.constraints ?? [])
    .filter(c => c.status === 'conflict' || c.status === 'review'))

const screeningPrefill = computed(() => describeConstraints(screening.value))

// A site the server could not place has run no distance checks at all, so it
// has no measurements to lift into the findings.
const screeningMeasured = computed(() =>
  !!screening.value && isPositioned(screening.value.site.precision))

function applyScreeningToFindings() {
  const text = screeningPrefill.value
  if (!text) return
  review.summary = review.summary.trim()
    ? `${review.summary.trim()}\n\n${text}`
    : text
}

// ── Identify: "what is here" for any clicked point ───────────────────────────
const identifyPoint = ref<[number, number] | null>(null)
const identifyResult = shallowRef<IdentifyResult | null>(null)
const identifyLoading = ref(false)
const identifyError = ref<string | null>(null)
let identifySeq = 0

async function runIdentify(lng: number, lat: number) {
  const mine = ++identifySeq
  clearCatchment()
  identifyPoint.value = [lng, lat]
  identifyResult.value = null
  identifyError.value = null
  identifyLoading.value = true
  if (isMobile.value) detailSheetOpen.value = true
  try {
    const r = await inspectorGis.identify(lng, lat)
    if (mine === identifySeq) identifyResult.value = r
  } catch (e: unknown) {
    if (mine !== identifySeq) return
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    identifyError.value = msg || 'This location could not be identified.'
  } finally {
    if (mine === identifySeq) identifyLoading.value = false
  }
}

function clearIdentify() {
  identifySeq++
  ehoPick.value = null
  nearby.value = null
  identifyPoint.value = null
  identifyResult.value = null
  identifyError.value = null
  identifyLoading.value = false
  setIdentifyMarker(null)
}

function openCaseFromIdentify(permitId: string) {
  const p = permits.value.find(x => x.id === permitId)
  if (p) openPermit(p)
}

// ── Map ──────────────────────────────────────────────────────────────────────
const mapContainer = ref<HTMLElement | null>(null)
// ADR 0011 — a MapLibre Map is an imperative handle, never reactive state.
const mapInstance = shallowRef<maplibregl.Map | null>(null)
const mapReady = ref(false)
const mapLoading = ref(true)
const layerVisibility = reactive<Record<string, boolean>>({})
const layerPanelOpen = ref(false)
// MapToolbar's measure and radius tools consume map clicks; identify stands
// aside while one of them is armed.
const toolActive = ref<string>('none')

const IDENTIFY_SRC = 'eho-identify'

function setIdentifyMarker(point: [number, number] | null) {
  const map = mapInstance.value
  if (!map || !mapReady.value) return
  const src = map.getSource(IDENTIFY_SRC) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: point
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } }]
      : [],
  } as GeoJSON.FeatureCollection)
}
watch(identifyPoint, p => setIdentifyMarker(p))

// ── EHO registers on the map (migration 121 · /api/eho/*) ───────────────────
// The premises register, outbreak log, water quality register and nuisance
// complaint book, drawn as one point source tagged by kind. One source and one
// circle layer, rather than four of each: they are all points, they are toggled
// together, and data-driven paint says which is which.
const EHO_SRC = 'eho-records'
const CATCHMENT_SRC = 'eho-catchment'

// The PostGIS basemap adds and reorders tile layers after load — and a layer
// toggle re-adds one — so an overlay added once on 'load' ends up painted
// UNDER a translucent landuse or building fill: faded points and a catchment
// ring you cannot see. Same fix as BuildingInspectorView: re-assert the order
// on every style change. A no-op once the tail is already in order.
const OVERLAY_ORDER = [
  'eho-catchment-fill', 'eho-catchment-line',
  'eho-records-ring', 'eho-records-pt', 'eho-identify-pt',
  'gis-tools-fill', 'gis-tools-line', 'gis-tools-pts',
]
function keepOverlaysOnTop(map: maplibregl.Map) {
  const layersNow = map.getStyle()?.layers
  if (!layersNow) return
  const wanted = OVERLAY_ORDER.filter(id => map.getLayer(id))
  const tail = layersNow.slice(-wanted.length).map(l => l.id)
  if (tail.join('|') === wanted.join('|')) return
  for (const id of wanted) map.moveLayer(id)
}

// MapLibre paint takes literal colours, so the enterprise tokens are repeated
// here as values. Semantic, never decorative: danger is a failed water source
// or an open cluster, warning is a complaint, accent is the premises register.
const EHO_COLORS = {
  accent: '#1f5aa8', danger: '#bd2f28', warning: '#a8620a',
  success: '#1d7a4d', neutral: '#7b8797', surface: '#ffffff',
}

const ehoLayers = shallowRef<EhoMapLayers | null>(null)
const ehoError = ref<string | null>(null)
const showEhoRecords = ref(true)

const ehoCounts = computed(() => ({
  premises: ehoLayers.value?.premises.features.length ?? 0,
  outbreaks: ehoLayers.value?.outbreaks.features.length ?? 0,
  water: ehoLayers.value?.waterSamples.features.length ?? 0,
  complaints: ehoLayers.value?.complaints.features.length ?? 0,
}))

// Rows with no coordinate. Surfaced rather than hidden: a map that silently
// drops half the outbreak log understates the district's caseload.
const ehoUnpositioned = computed(() => {
  const u = ehoLayers.value?.unpositioned
  if (!u) return 0
  return u.premises + u.outbreaks + u.water_samples + u.complaints
})

async function loadEhoLayers() {
  ehoError.value = null
  try {
    ehoLayers.value = await ehoApi.mapLayers()
    pushEhoData()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    ehoError.value = msg || 'The health registers could not be loaded.'
    ehoLayers.value = null
  }
}

/** Flatten the four collections into one tagged point source. */
function pushEhoData() {
  const map = mapInstance.value
  if (!map || !mapReady.value) return
  const src = map.getSource(EHO_SRC) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  const L = ehoLayers.value
  const tag = (fc: EhoLayer | undefined, kind: string) =>
    (fc?.features ?? []).map(ft => ({ ...ft, properties: { ...ft.properties, kind } }))
  src.setData({
    type: 'FeatureCollection',
    features: L ? [
      ...tag(L.premises, 'premises'),
      ...tag(L.complaints, 'complaint'),
      ...tag(L.waterSamples, 'water'),
      // Outbreaks last so they draw on top of everything they explain.
      ...tag(L.outbreaks, 'outbreak'),
    ] : [],
  } as any)
}
watch([ehoLayers, showEhoRecords], () => {
  const map = mapInstance.value
  if (!map || !mapReady.value) return
  for (const id of ['eho-records-pt', 'eho-records-ring']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showEhoRecords.value ? 'visible' : 'none')
  }
})

// ── Outbreak catchment ──────────────────────────────────────────────────────
// The first-hour question of a cholera report: which food premises are inside
// the zone and must be visited, and which tested water source explains it.
// A premises, water sample or complaint the officer clicked on the map. Its
// properties come straight from the GeoJSON, so this is a read-out, not a fetch.
const ehoPick = ref<Record<string, string> | null>(null)

// "What else is around this record" — the health-register counterpart to the
// MapToolbar's notification radius, which counts rendered parcels rather than
// council records.
const nearby = shallowRef<NearbyResult | null>(null)
const nearbyLoading = ref(false)
const NEARBY_RADIUS_M = 300

async function runNearbyFromPick() {
  const pick = ehoPick.value
  const lng = Number(pick?.lng), lat = Number(pick?.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  nearbyLoading.value = true
  nearby.value = null
  try {
    nearby.value = await ehoApi.nearby(lng, lat, NEARBY_RADIUS_M)
  } catch {
    nearby.value = null
  } finally {
    nearbyLoading.value = false
  }
}

const catchment = shallowRef<CatchmentResult | null>(null)
const catchmentLoading = ref(false)
const catchmentError = ref<string | null>(null)
let catchmentSeq = 0

async function runCatchment(outbreakId: string, radiusM?: number) {
  const mine = ++catchmentSeq
  catchmentLoading.value = true
  catchmentError.value = null
  clearIdentify()
  selected.value = null
  if (isMobile.value) detailSheetOpen.value = true
  try {
    const r = await ehoApi.catchment(outbreakId, radiusM)
    if (mine !== catchmentSeq) return
    catchment.value = r
    drawCatchment(r)
    if (r.positioned && r.outbreak.lng != null && r.outbreak.lat != null) {
      flyTo(mapInstance.value, { center: [r.outbreak.lng, r.outbreak.lat], zoom: 15 })
    }
  } catch (e: unknown) {
    if (mine !== catchmentSeq) return
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    catchmentError.value = msg || 'The catchment could not be worked out.'
    catchment.value = null
  } finally {
    if (mine === catchmentSeq) catchmentLoading.value = false
  }
}

function clearCatchment() {
  catchmentSeq++
  catchment.value = null
  catchmentError.value = null
  catchmentLoading.value = false
  const src = mapInstance.value?.getSource(CATCHMENT_SRC) as maplibregl.GeoJSONSource | undefined
  src?.setData({ type: 'FeatureCollection', features: [] } as any)
}

/** The catchment ring, as a real ground-distance circle (turf, metres). */
function drawCatchment(r: CatchmentResult) {
  const src = mapInstance.value?.getSource(CATCHMENT_SRC) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  if (!r.positioned || r.radiusM == null || r.outbreak.lng == null || r.outbreak.lat == null) {
    src.setData({ type: 'FeatureCollection', features: [] } as any)
    return
  }
  const circle = turf.circle([r.outbreak.lng, r.outbreak.lat], r.radiusM / 1000,
    { units: 'kilometers', steps: 96 })
  src.setData({ type: 'FeatureCollection', features: [circle] } as any)
}

// Environmental-relevant layers float to the top of the panel.
const ENV_HINT = /water|hydro|river|wetland|land.?use|veg|forest|park|conserv|flood|natural|protect|cemet|waste/i
const layers = computed(() =>
  spatialStore.tileLayers
    .map(l => ({ id: l.id, name: l.title, color: chipColorFor(l.id, l.geomType), env: ENV_HINT.test(l.id + l.title + l.group) }))
    .sort((a, b) => Number(b.env) - Number(a.env)),
)
function toggleLayer(l: { id: string }) {
  const map = mapInstance.value
  if (!map) return
  spatialStore.toggleTileLayer(map, l.id)
  layerVisibility[l.id] = spatialStore.visibleTileLayers.has(l.id)
}

let markers: maplibregl.Marker[] = []
function renderPins() {
  const map = mapInstance.value
  if (!map) return
  markers.forEach(m => m.remove()); markers = []
  for (const p of geolocated.value) {
    const el = document.createElement('div')
    // Inline because a Marker element is created outside the component tree and
    // never picks up the scoped-style attribute. The custom properties still
    // resolve — they cascade from :root.
    el.style.cssText = 'width:13px;height:13px;border-radius:50%;border:2px solid var(--ent-surface);cursor:pointer;box-shadow:var(--ent-e2);background:var(--ent-success)'
    el.setAttribute('role', 'button')
    el.setAttribute('tabindex', '0')
    el.setAttribute('aria-label', `Application ${p.stand_number || p.applicant_name || ''}`)
    const popup = new maplibregl.Popup({ offset: 12, closeButton: true }).setHTML(
      `<div style="font-family:inherit;font-size:12px">
         <div style="font-weight:700">${escapeHtml(p.stand_number || p.applicant_name || 'Application')}</div>
         <div>${escapeHtml(p.development_type || '')}</div>
         <div style="color:#64748b;font-size:11px">${escapeHtml(p.suburb_ward || '')} · ${escapeHtml(p.status || '')}</div>
       </div>`)
    const m = new maplibregl.Marker({ element: el }).setLngLat([p.lng as number, p.lat as number]).setPopup(popup).addTo(map)
    el.addEventListener('click', () => openPermit(p))
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPermit(p) }
    })
    markers.push(m)
  }
}
watch(geolocated, () => renderPins())

// ── Mobile presentation ──────────────────────────────────────────────────────
// A phone cannot carry a 19rem list, a map and a 22rem panel side by side, and
// an EHO does more of their work standing in a premises than at a desk. Both
// side panels become sheets over a full-bleed map; the map itself never moves.
const listSheetOpen = ref(false)
const detailSheetOpen = ref(false)

const leftBinding = computed(() => isMobile.value
  ? { is: UiSheet, attrs: { open: listSheetOpen.value, title: 'For environmental review', variant: 'drawer', side: 'left', tall: true, 'onUpdate:open': (v: boolean) => { listSheetOpen.value = v } } }
  : { is: 'aside', attrs: { class: 'e-left', 'aria-label': 'Applications for environmental review' } })

const rightBinding = computed(() => isMobile.value
  ? { is: UiSheet, attrs: { open: detailSheetOpen.value, title: identifyPoint.value ? 'What is here' : (selected.value ? `Stand ${selected.value.stand_number || '—'}` : 'Site'), tall: true, 'onUpdate:open': (v: boolean) => { detailSheetOpen.value = v; if (!v) clearIdentify() } } }
  : { is: 'aside', attrs: { class: 'e-right', 'aria-label': 'Site screening and environmental review' } })

function handleLogout() { authStore.logout(); router.push('/login') }
function fmtCoord(v: number | null | undefined) { return v == null ? '—' : v.toFixed(5) }

function onMapClick(e: maplibregl.MapMouseEvent) {
  if (toolActive.value === 'measure' || toolActive.value === 'radius') return
  const map = mapInstance.value
  // A click that lands on a health record asks about that record, not about
  // the ground underneath it.
  if (map && showEhoRecords.value && map.getLayer('eho-records-pt')) {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['eho-records-pt'] })[0]
    if (hit) {
      const props = hit.properties as Record<string, string>
      if (props.kind === 'outbreak' && props.id) {
        void runCatchment(props.id)
      } else {
        clearIdentify()          // order matters: this nulls ehoPick
        ehoPick.value = props
        if (isMobile.value) detailSheetOpen.value = true
      }
      return
    }
  }
  void runIdentify(e.lngLat.lng, e.lngLat.lat)
}

onMounted(() => {
  refresh()
  spatialStore.loadTileLayers()
  if (!mapContainer.value) return
  const blankStyle = {
    version: 8 as const, sources: {},
    layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#f2efe9' } }],
    glyphs: '/fonts/{fontstack}/{range}.pbf',
  }
  const map = new maplibregl.Map({
    container: mapContainer.value, style: blankStyle as any,
    center: [29.81, -19.49], zoom: 9, minZoom: 1, maxZoom: 22, attributionControl: false,
    // Retain the WebGL drawing buffer so MapToolbar's "Export PDF" can read the
    // rendered canvas back with toDataURL() — otherwise the sheet comes out blank.
    preserveDrawingBuffer: true,
  })
  mapInstance.value = map
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
  // Field GPS. An EHO inspecting a premises needs "where am I" before they need
  // anything else on this screen; MapLibre ships it, so we do not write one.
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
  }), 'top-right')
  // Bottom-RIGHT: the layer panel owns the bottom-left corner and MapToolbar
  // the top-left, so a scale bar in either place would sit under a panel.
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')

  map.on('error', (e) => {
    const msg = (e as { error?: { message?: string } })?.error?.message ?? ''
    if (!/fetch|network|ajax|load|glyph|tile|font|ERR_|unimplemented type/i.test(msg)) console.warn('[env map]', msg)
  })
  map.on('load', () => {
    addVunguBasemap(map)
    DEFAULT_VISIBLE.forEach(id => { layerVisibility[id] = true })
    map.addSource(IDENTIFY_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'eho-identify-pt', type: 'circle', source: IDENTIFY_SRC,
      paint: {
        'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#1a2430', 'circle-stroke-width': 2.5,
      },
    })

    // Catchment ring first, so the records it contains draw on top of it.
    map.addSource(CATCHMENT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'eho-catchment-fill', type: 'fill', source: CATCHMENT_SRC,
      paint: { 'fill-color': EHO_COLORS.danger, 'fill-opacity': 0.08 },
    })
    map.addLayer({
      id: 'eho-catchment-line', type: 'line', source: CATCHMENT_SRC,
      paint: { 'line-color': EHO_COLORS.danger, 'line-width': 1.5, 'line-dasharray': [3, 2] },
    })

    map.addSource(EHO_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    // A ring around open outbreaks only: the thing an officer must not miss.
    map.addLayer({
      id: 'eho-records-ring', type: 'circle', source: EHO_SRC,
      filter: ['all', ['==', ['get', 'kind'], 'outbreak'], ['!=', ['get', 'status'], 'closed']],
      paint: {
        'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': EHO_COLORS.danger, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.5,
      },
    })
    map.addLayer({
      id: 'eho-records-pt', type: 'circle', source: EHO_SRC,
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'outbreak', 7, 5.5],
        'circle-stroke-color': EHO_COLORS.surface,
        'circle-stroke-width': 1.5,
        // Semantic, never decorative: a failed water source and an open
        // cluster are the two things that read as danger.
        'circle-color': ['case',
          ['==', ['get', 'kind'], 'outbreak'], EHO_COLORS.danger,
          ['==', ['get', 'kind'], 'complaint'], EHO_COLORS.warning,
          ['==', ['get', 'kind'], 'water'], ['match', ['get', 'result'],
            'not_potable', EHO_COLORS.danger,
            'borderline', EHO_COLORS.warning,
            'potable', EHO_COLORS.success,
            EHO_COLORS.neutral],
          EHO_COLORS.accent],
      },
    })

    for (const id of ['eho-records-pt', 'eho-records-ring']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }

    mapReady.value = true
    mapLoading.value = false
    renderPins()
    void loadEhoLayers()
    keepOverlaysOnTop(map)
  })
  map.on('styledata', () => { if (mapReady.value) keepOverlaysOnTop(map) })
  map.on('click', onMapClick)
})
onUnmounted(() => {
  markers.forEach(m => m.remove()); markers = []
  mapInstance.value?.remove()
  mapInstance.value = null
})
</script>

<template>
  <div class="e-root" :class="{ embedded: props.embedded }">
    <header class="e-header">
      <div v-if="!props.embedded" class="e-brand">
        <div class="e-icon"><Leaf :size="16" aria-hidden="true" /></div>
        <div class="e-brand-text">
          <span class="e-title">Environmental Officer Console</span>
          <span class="e-sub">Vungu RDC · Environmental Management Unit</span>
        </div>
      </div>

      <button v-if="isMobile" class="e-btn" type="button" @click="listSheetOpen = true">
        <ListFilter :size="14" aria-hidden="true" /><span>Cases ({{ permits.length }})</span>
      </button>

      <button class="e-btn" type="button" @click="refresh" :disabled="loading">
        <RefreshCw :size="14" :class="{ spin: loading }" aria-hidden="true" /><span class="e-btn-label">Refresh</span>
      </button>
      <button v-if="!props.embedded" class="e-btn" type="button" @click="router.push('/env-officer-workspace')">
        <Layers :size="14" aria-hidden="true" /><span class="e-btn-label">Workspace</span>
      </button>
      <ProfileDropdown v-if="!props.embedded" role-label="Env. Officer" avatar-key="env_officer_avatar" @logout="handleLogout" />
    </header>

    <div class="e-body">
      <!-- LEFT: applications needing environmental review -->
      <component :is="leftBinding.is" v-bind="leftBinding.attrs">
        <div class="e-left-inner">
          <div class="e-kpis">
            <div class="e-kpi"><span class="e-v">{{ permits.length }}</span><span class="e-l">For review</span></div>
            <div class="e-kpi"><span class="e-v">{{ geolocated.length }}</span><span class="e-l">Geolocated</span></div>
          </div>

          <p v-if="pendingCount" class="e-warn" role="status">
            <AlertTriangle :size="12" aria-hidden="true" />
            {{ pendingCount }} review{{ pendingCount === 1 ? '' : 's' }} held on this workstation. Refresh re-files them.
          </p>

          <div v-if="loading" class="e-state"><RefreshCw :size="16" class="spin" aria-hidden="true" /> Loading…</div>
          <div v-else-if="error" class="e-state err" role="alert">
            <AlertTriangle :size="16" aria-hidden="true" /> {{ error }}
            <button class="e-link" type="button" @click="refresh">Retry</button>
          </div>
          <div v-else-if="!permits.length" class="e-state">
            <Inbox :size="20" aria-hidden="true" /><p>No applications awaiting environmental review.</p>
            <span>Applications in registration, circulation, or review appear here.</span>
          </div>
          <div v-else class="e-list">
            <button v-for="p in permits" :key="p.id" type="button" class="e-item"
                    :class="{ active: selected?.id === p.id }"
                    :aria-current="selected?.id === p.id ? 'true' : undefined"
                    @click="openPermit(p); listSheetOpen = false">
              <div class="e-item-top">
                <span class="e-item-stand">Stand {{ p.stand_number || '—' }}</span>
                <span class="e-chip">{{ p.status }}</span>
              </div>
              <div class="e-item-sub">{{ p.development_type }} · {{ p.suburb_ward || '—' }}</div>
              <div class="e-item-meta">{{ p.applicant_name || '—' }}<span v-if="p.lng == null" class="e-nogeo">· no location</span></div>
            </button>
          </div>
        </div>
      </component>

      <!-- CENTER: map -->
      <div class="e-center">
        <div ref="mapContainer" class="e-map"></div>
        <div v-if="mapLoading" class="e-map-overlay">
          <RefreshCw :size="18" class="spin" aria-hidden="true" /><span>Loading basemap…</span>
        </div>

        <!-- The GIS toolset: search, measure, notification radius, imagery,
             A4 PDF export and a live coordinate readout. -->
        <MapToolbar v-if="mapReady" :map="mapInstance" @tool-change="toolActive = $event" />

        <div class="e-layers" :class="{ open: layerPanelOpen || !isMobile }">
          <button class="e-layers-head" type="button" :aria-expanded="layerPanelOpen || !isMobile"
                  @click="layerPanelOpen = !layerPanelOpen">
            <TreePine :size="12" aria-hidden="true" /> Environmental layers
            <span v-if="spatialStore.isLoading" class="e-mini">loading…</span>
          </button>
          <div v-show="layerPanelOpen || !isMobile" class="e-layers-body">
            <div v-if="!layers.length && !spatialStore.isLoading" class="e-mini">No layers available</div>
            <label v-for="l in layers" :key="l.id" class="e-layer" :class="{ env: l.env }">
              <input type="checkbox" :checked="layerVisibility[l.id]" @change="toggleLayer(l)" />
              <span class="e-dot" :style="{ background: l.color }"></span>
              <span class="e-layer-name">{{ l.name }}</span>
              <Droplets v-if="l.env" :size="10" class="e-envico" aria-hidden="true" />
            </label>
            <!-- Water bodies, waterways, protected areas, natural areas,
                 cemeteries and waste-management sites ARE in the catalog and
                 are what the site screening measures against. Flood zones and
                 slope are the genuine gaps. -->
            <p class="e-gap">
              <AlertTriangle :size="10" aria-hidden="true" />
              Flood-zone and slope layers are not yet in the tile catalog (GIS data gap). Screening cannot test them.
            </p>
          </div>
        </div>

        <!-- The EHO's own registers, drawn from /api/eho/map. Separate from the
             basemap layer list because these are council records, not cartography. -->
        <div v-if="mapReady" class="e-eho">
          <label class="e-eho-head">
            <input type="checkbox" v-model="showEhoRecords" />
            <ShieldAlert :size="12" aria-hidden="true" />
            <span>Health registers</span>
          </label>
          <p v-if="ehoError" class="e-eho-err" role="alert">{{ ehoError }}</p>
          <ul v-else-if="showEhoRecords" class="e-eho-key">
            <li><span class="e-sw premises"></span>Premises <b>{{ ehoCounts.premises }}</b></li>
            <li><span class="e-sw outbreak"></span>Outbreaks <b>{{ ehoCounts.outbreaks }}</b></li>
            <li><span class="e-sw water"></span>Water, by result <b>{{ ehoCounts.water }}</b></li>
            <li><span class="e-sw complaint"></span>Complaints <b>{{ ehoCounts.complaints }}</b></li>
          </ul>
          <!-- Counted, not hidden: a map missing half the outbreak log would
               understate the district's caseload without saying so. -->
          <p v-if="showEhoRecords && ehoUnpositioned" class="e-eho-note">
            {{ ehoUnpositioned }} record{{ ehoUnpositioned === 1 ? '' : 's' }} without a position — not on this map.
          </p>
        </div>

        <p v-if="!isMobile" class="e-hint">Click the map to identify a point, or a health record to open it.</p>
      </div>

      <!-- RIGHT: identify result, site screening, environmental review -->
      <!-- Always mounted: on desktop it carries the empty state, on mobile the
           sheet has to exist before it can animate open. -->
      <component :is="rightBinding.is" v-bind="rightBinding.attrs">
        <!-- Both inspector cards style themselves but expect the host to own
             the gutter, the way BuildingInspectorView's .bim-panel does. -->
        <div v-if="identifyPoint" class="e-identify">
          <InspectorIdentifyCard
            :result="identifyResult" :loading="identifyLoading" :error="identifyError" :point="identifyPoint"
            @close="clearIdentify()" @open-case="openCaseFromIdentify" />
        </div>

        <!-- Outbreak catchment: the first-hour question of a cholera report. -->
        <div v-if="catchmentLoading || catchment || catchmentError" class="e-catch">
          <div class="e-catch-head">
            <ShieldAlert :size="14" aria-hidden="true" />
            <h3>Outbreak catchment</h3>
            <button type="button" class="e-x" @click="clearCatchment">
              <X :size="14" aria-hidden="true" /><span class="ent-sr-only">Close catchment</span>
            </button>
          </div>
          <p v-if="catchmentLoading" class="e-mini" role="status">Working out the catchment…</p>
          <p v-else-if="catchmentError" class="e-warn" role="alert">{{ catchmentError }}</p>
          <template v-else-if="catchment">
            <p class="e-catch-sub">
              <strong>{{ catchment.outbreak.reference }}</strong>
              · {{ catchment.outbreak.disease.replace(/_/g, ' ') }}
              · {{ catchment.outbreak.casesCount }} case{{ catchment.outbreak.casesCount === 1 ? '' : 's' }}
              · Ward {{ catchment.outbreak.ward }}
            </p>

            <div v-if="catchment.positioned" class="e-catch-radius">
              <label for="eho-radius">Radius</label>
              <input id="eho-radius" type="range" min="100" max="3000" step="100"
                     :value="catchment.radiusM ?? 500"
                     @change="runCatchment(catchment!.outbreak.id, Number(($event.target as HTMLInputElement).value))" />
              <span class="e-mono">{{ catchment.radiusM }} m</span>
            </div>

            <ul class="e-catch-list">
              <li><span>Food and other premises</span><b>{{ catchment.premises.length }}</b></li>
              <li><span>Tested water sources</span><b>{{ catchment.waterSamples.length }}</b></li>
              <li><span>Related complaints</span><b>{{ catchment.complaints.length }}</b></li>
            </ul>

            <div v-if="catchment.waterSamples.length" class="e-catch-block">
              <h4>Water sources</h4>
              <p v-for="w in catchment.waterSamples" :key="w.id" class="e-catch-row">
                <span class="e-sw" :class="`r-${w.result}`"></span>
                {{ w.sourceLabel }} — {{ w.result.replace(/_/g, ' ') }}
                <span class="e-mono">{{ w.distanceM }} m</span>
              </p>
            </div>

            <div v-if="catchment.premises.length" class="e-catch-block">
              <h4>Premises to visit</h4>
              <p v-for="pr in catchment.premises" :key="pr.id" class="e-catch-row">
                {{ pr.name }} <span class="e-mini">({{ pr.type.replace(/_/g, ' ') }})</span>
                <span class="e-mono">{{ pr.distanceM }} m</span>
              </p>
            </div>

            <p v-for="(l, i) in catchment.limitations" :key="i" class="e-warn">{{ l }}</p>
          </template>
        </div>

        <!-- A premises, sample or complaint read straight off the map. -->
        <div v-if="ehoPick" class="e-catch">
          <div class="e-catch-head">
            <MapPin :size="14" aria-hidden="true" />
            <h3>{{ ehoPick.reference || 'Health record' }}</h3>
            <button type="button" class="e-x" @click="ehoPick = null">
              <X :size="14" aria-hidden="true" /><span class="ent-sr-only">Close record</span>
            </button>
          </div>
          <dl class="e-pick">
            <div v-for="[k, v] in Object.entries(ehoPick).filter(([k2, v2]) => !['id','kind','reference'].includes(k2) && v2 != null && v2 !== '')"
                 :key="k">
              <dt>{{ k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()) }}</dt>
              <dd>{{ String(v).replace(/_/g, ' ') }}</dd>
            </div>
          </dl>
          <button type="button" class="e-btn sm" :disabled="nearbyLoading" @click="runNearbyFromPick">
            <Crosshair :size="12" aria-hidden="true" />
            {{ nearbyLoading ? 'Searching…' : `What else is within ${NEARBY_RADIUS_M} m` }}
          </button>
          <div v-if="nearby" class="e-catch-block">
            <h4>Within {{ nearby.radiusM }} m</h4>
            <p v-if="!nearby.premises.length && !nearby.outbreaks.length
                     && !nearby.waterSamples.length && !nearby.complaints.length" class="e-mini">
              No other health record is within {{ nearby.radiusM }} m.
            </p>
            <template v-else>
              <p v-for="o in nearby.outbreaks" :key="o.id" class="e-catch-row">
                <span class="e-sw outbreak"></span>{{ o.reference }} {{ o.disease.replace(/_/g, ' ') }}
                <span class="e-mono">{{ o.distanceM }} m</span>
              </p>
              <p v-for="w in nearby.waterSamples" :key="w.id" class="e-catch-row">
                <span class="e-sw" :class="`r-${w.result}`"></span>{{ w.sourceLabel }}
                <span class="e-mono">{{ w.distanceM }} m</span>
              </p>
              <p v-for="pr in nearby.premises" :key="pr.id" class="e-catch-row">
                <span class="e-sw premises"></span>{{ pr.name }}
                <span class="e-mono">{{ pr.distanceM }} m</span>
              </p>
              <p v-for="c in nearby.complaints" :key="c.id" class="e-catch-row">
                <span class="e-sw complaint"></span>{{ c.reference }} {{ c.category }}
                <span class="e-mono">{{ c.distanceM }} m</span>
              </p>
            </template>
          </div>
        </div>

        <div v-if="!selected && !identifyPoint && !catchment && !ehoPick && !catchmentLoading" class="e-state">
          <ClipboardCheck :size="20" aria-hidden="true" /><p>Select an application</p>
          <span>Its site screening, environmental context and review form appear here. Click the map to identify any other point.</span>
        </div>

        <div v-else-if="selected" class="e-detail">
          <div class="e-detail-head">
            <div>
              <div class="e-detail-stand">Stand {{ selected.stand_number || '—' }}</div>
              <div class="e-detail-sub">{{ selected.development_type }} · {{ selected.suburb_ward || '—' }}</div>
            </div>
            <span class="e-chip">{{ selected.status }}</span>
          </div>

          <div class="e-card">
            <header><MapPin :size="13" aria-hidden="true" /> Application</header>
            <div class="e-kv"><span>Applicant</span><strong>{{ selected.applicant_name || '—' }}</strong></div>
            <div class="e-kv"><span>Coordinates</span><strong class="e-mono">{{ fmtCoord(selected.lat) }}, {{ fmtCoord(selected.lng) }}</strong></div>
            <p v-if="selected.description" class="e-desc">{{ selected.description }}</p>
            <button v-if="selected.lat != null" class="e-btn sm" type="button"
                    @click="flyTo(mapInstance, { center: [selected.lng, selected.lat], zoom: 16 })">
              <Crosshair :size="12" aria-hidden="true" /> Locate
            </button>
          </div>

          <!-- Site screening. Measured distances to watercourses, water bodies
               and wetlands, protected and natural areas, cemeteries, waste
               sites, railways and major roads, plus zoning, adjoining stands
               and nearby cases. Run server-side against PostGIS. -->
          <div class="e-card">
            <header>
              <ShieldAlert :size="13" aria-hidden="true" /> Site screening
              <span v-if="flaggedConstraints.length" class="e-flag">{{ flaggedConstraints.length }} flagged</span>
            </header>
            <div class="e-screen">
              <InspectorSiteReport :permit-id="selected.id" @loaded="screening = $event" @open-permit="openCaseFromIdentify" />
            </div>
          </div>

          <div class="e-card">
            <header><Leaf :size="13" aria-hidden="true" /> Environmental review</header>
            <!-- Only when the site was actually located. An unlocated site has
                 measured nothing, and offering to paste "measurements" that do
                 not exist is how a "not checked" turns into a "clear". -->
            <button v-if="screeningMeasured" class="e-btn sm" type="button" @click="applyScreeningToFindings">
              <Wand2 :size="12" aria-hidden="true" /> Add screening measurements to findings
            </button>
            <label class="ent-sr-only" for="eho-summary">Environmental findings</label>
            <textarea id="eho-summary" v-model="review.summary" rows="5" class="e-input"
                      placeholder="Environmental findings / constraints observed…"></textarea>
            <label class="ent-sr-only" for="eho-risk">Risk level</label>
            <select id="eho-risk" v-model="review.risk" class="e-input">
              <option value="">Risk level…</option>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
            <label class="ent-sr-only" for="eho-rec">Recommendation</label>
            <select id="eho-rec" v-model="review.recommendation" class="e-input">
              <option value="">Recommendation…</option>
              <option value="no_objection">No objection</option>
              <option value="conditions">Approve with conditions</option>
              <option value="eia_required">EIA required</option>
              <option value="objection">Objection</option>
            </select>
            <button class="e-btn primary" type="button" :disabled="submitState === 'saving'" @click="submitReview">
              <FileText :size="13" aria-hidden="true" /> {{ submitState === 'saving' ? 'Filing review…' : 'Submit review to Planner / EO' }}
            </button>
            <p v-if="submitState === 'invalid'" class="e-warn" role="alert">{{ submitNote }}</p>
            <p v-else-if="submitState === 'saved'" class="e-ok" role="status">{{ submitNote }}</p>
            <p v-else-if="submitState === 'local'" class="e-warn" role="status">{{ submitNote }}</p>
          </div>
        </div>
      </component>
    </div>
  </div>
</template>

<style scoped>
/* Migrated onto the enterprise token SSOT (src/styles/enterprise.css). The
   slate-and-green hexes this file used to hardcode are gone: an EHO console
   that is a different colour from every other console for no reason is
   inconsistency, not identity. Role identity lives in the brand mark. */

.e-root { display:flex; flex-direction:column; height:var(--ent-vh);
  background:var(--ent-canvas); color:var(--ent-text);
  font-family:var(--ent-font); font-size:var(--ent-fs-base); }
.e-root.embedded { height:100%; }

.e-root :deep(input:focus-visible),
.e-root :deep(textarea:focus-visible),
.e-root :deep(select:focus-visible),
.e-root :deep(button:focus-visible) { outline:none; box-shadow:var(--ent-focus-ring); }

@media (prefers-reduced-motion: reduce) {
  .e-root, .e-root :deep(*) { transition-duration:0ms !important; animation-duration:0ms !important; }
}

.e-header { display:flex; align-items:center; gap:var(--ent-s2);
  padding:var(--ent-s2) var(--ent-s4); background:var(--ent-surface);
  border-bottom:1px solid var(--ent-line); box-shadow:var(--ent-e1); flex-shrink:0; }
.e-brand { display:flex; align-items:center; gap:var(--ent-s2); margin-right:auto; min-width:0; }
.e-icon { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.85rem; height:1.85rem; border-radius:var(--ent-r);
  background:var(--ent-accent); color:var(--ent-text-on-accent); }
.e-brand-text { min-width:0; }
.e-title { display:block; font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold); line-height:1.1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.e-sub { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); line-height:1.4;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.e-btn { display:inline-flex; align-items:center; gap:var(--ent-s1);
  min-height:var(--ent-control-h-sm); padding:0 var(--ent-s3);
  border:1px solid var(--ent-line); border-radius:var(--ent-r);
  background:var(--ent-surface); color:var(--ent-text-2);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); cursor:pointer; }
.e-btn:hover:not(:disabled) { background:var(--ent-surface-2); color:var(--ent-text); }
.e-btn.primary { background:var(--ent-accent); color:var(--ent-text-on-accent); border-color:var(--ent-accent);
  width:calc(100% - 2 * var(--ent-s3)); margin:var(--ent-s2) var(--ent-s3); justify-content:center;
  min-height:var(--ent-control-h); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); }
.e-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.e-btn.sm { font-size:var(--ent-fs-micro); margin:var(--ent-s2) var(--ent-s3) 0; }
.e-btn:disabled { opacity:0.5; cursor:not-allowed; }

.e-body { flex:1; min-height:0; display:flex; overflow:hidden; }

/* ── Left: case list ─────────────────────────────────────────────────────── */
.e-left { width:19rem; background:var(--ent-surface); border-right:1px solid var(--ent-line);
  overflow-y:auto; flex-shrink:0; }
.e-left-inner { padding:var(--ent-s2); display:flex; flex-direction:column; gap:var(--ent-s2); }
.e-kpis { display:grid; grid-template-columns:repeat(2,1fr); gap:var(--ent-s1); }
.e-kpi { background:var(--ent-surface-2); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-sm); padding:var(--ent-s2); text-align:center; }
.e-v { display:block; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-bold); line-height:var(--ent-lh-tight); }
.e-l { display:block; font-size:var(--ent-fs-micro); color:var(--ent-text-3); }

.e-state { padding:var(--ent-s5); text-align:center; color:var(--ent-text-3);
  font-size:var(--ent-fs-xs); display:flex; flex-direction:column; align-items:center; gap:var(--ent-s1); }
.e-state.err { color:var(--ent-danger); }
.e-state p { margin:0; font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); }
.e-state span { font-size:var(--ent-fs-micro); line-height:var(--ent-lh); }
.e-link { background:none; border:none; color:var(--ent-accent); cursor:pointer;
  text-decoration:underline; font-family:var(--ent-font); font-size:inherit; }

.e-list { display:flex; flex-direction:column; gap:var(--ent-s1); }
/* Selection reads through the tinted fill and the accent border. The 3px
   left stripe this row used to carry said the same thing a third time. */
.e-item { text-align:left; background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-sm);
  padding:var(--ent-s2) var(--ent-s3); cursor:pointer; font-family:var(--ent-font); }
.e-item:hover { background:var(--ent-surface-2); }
.e-item.active { border-color:var(--ent-accent); background:var(--ent-accent-soft); }
.e-item-top { display:flex; justify-content:space-between; align-items:center; gap:var(--ent-s2); }
.e-item-stand { font-weight:var(--ent-fw-semibold); font-size:var(--ent-fs-xs); color:var(--ent-text); }
.e-item-sub { font-size:var(--ent-fs-micro); color:var(--ent-text-2); }
.e-item-meta { font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.e-nogeo { color:var(--ent-warning); margin-left:var(--ent-s1); }
.e-chip { flex-shrink:0; font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  padding:1px var(--ent-s2); border-radius:var(--ent-r-pill);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg);
  border:1px solid var(--ent-tone-neutral-line); text-transform:capitalize; }

/* ── Centre: map ─────────────────────────────────────────────────────────── */
.e-center { flex:1; min-width:0; position:relative; }
.e-map { position:absolute; inset:0; }
.e-map-overlay { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:var(--ent-s1);
  background:#f2efe9; color:var(--ent-text-2); font-size:var(--ent-fs-sm); }

.e-layers { position:absolute; bottom:var(--ent-s3); left:var(--ent-s3); width:14rem;
  max-height:min(24rem, 55%); display:flex; flex-direction:column; overflow:hidden;
  background:var(--ent-map-panel-bg); border:1px solid var(--ent-map-panel-line);
  border-radius:var(--ent-r-lg); box-shadow:var(--ent-map-panel-shadow);
  backdrop-filter:blur(6px); z-index:var(--ent-z-sticky); }
.e-layers-head { display:flex; align-items:center; gap:var(--ent-s1); width:100%;
  padding:var(--ent-s2) var(--ent-s3); background:none; border:none;
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-bold);
  color:var(--ent-text); text-align:left; cursor:pointer; }
.e-layers-body { overflow-y:auto; padding:0 var(--ent-s3) var(--ent-s2); }
.e-mini { font-size:var(--ent-fs-micro); color:var(--ent-text-3); font-weight:var(--ent-fw-normal); }
.e-layer { display:flex; align-items:center; gap:var(--ent-s1); min-height:22px;
  font-size:var(--ent-fs-micro); color:var(--ent-text-2); cursor:pointer; }
.e-layer.env { font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.e-dot { width:0.7rem; height:0.7rem; border-radius:2px; flex-shrink:0; }
.e-layer-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.e-envico { color:var(--ent-accent); flex-shrink:0; }
.e-gap { display:flex; align-items:flex-start; gap:var(--ent-s1);
  margin:var(--ent-s2) 0 0; padding-top:var(--ent-s2); border-top:1px solid var(--ent-line);
  font-size:var(--ent-fs-micro); line-height:var(--ent-lh); color:var(--ent-warning); }

/* Top-centre, not bottom: MapToolbar owns the top-left, the navigation and
   geolocate controls the top-right, and the layer panel the whole bottom-left
   corner — which is where a bottom-centred hint gets buried. */
.e-hint { position:absolute; top:var(--ent-s3); left:50%; transform:translateX(-50%);
  margin:0; padding:var(--ent-s1) var(--ent-s3);
  background:var(--ent-map-panel-bg); border:1px solid var(--ent-map-panel-line);
  border-radius:var(--ent-r-pill); box-shadow:var(--ent-e1);
  font-size:var(--ent-fs-micro); color:var(--ent-text-3); pointer-events:none; }

/* ── Right: screening + review ───────────────────────────────────────────── */
.e-right { width:24rem; background:var(--ent-surface); border-left:1px solid var(--ent-line);
  overflow-y:auto; flex-shrink:0; }
.e-detail { padding:var(--ent-s3); display:flex; flex-direction:column; gap:var(--ent-s3); }
.e-detail-head { display:flex; justify-content:space-between; align-items:flex-start; gap:var(--ent-s2); }
.e-detail-stand { font-weight:var(--ent-fw-bold); font-size:var(--ent-fs-md); }
.e-detail-sub { font-size:var(--ent-fs-xs); color:var(--ent-text-2); }

.e-card { border:1px solid var(--ent-line); border-radius:var(--ent-r-md);
  overflow:hidden; background:var(--ent-surface); }
.e-card > header { display:flex; align-items:center; gap:var(--ent-s1);
  padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface-2);
  border-bottom:1px solid var(--ent-line);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.e-flag { margin-left:auto; padding:1px var(--ent-s2); border-radius:var(--ent-r-pill);
  background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg);
  border:1px solid var(--ent-tone-warning-line); font-size:var(--ent-fs-micro); }
.e-screen { padding:var(--ent-s2) var(--ent-s3); }
.e-identify { padding:var(--ent-s3); border-bottom:1px solid var(--ent-line); }
.e-kv { display:flex; justify-content:space-between; gap:var(--ent-s2);
  padding:var(--ent-s1) var(--ent-s3); font-size:var(--ent-fs-xs); }
.e-kv span { color:var(--ent-text-3); }
.e-mono { font-family:var(--ent-font-mono); }
.e-desc { margin:var(--ent-s1) var(--ent-s3); font-size:var(--ent-fs-micro);
  line-height:var(--ent-lh); color:var(--ent-text-2); }

.e-warn { display:flex; align-items:flex-start; gap:var(--ent-s1);
  margin:var(--ent-s2) var(--ent-s3); padding:var(--ent-s2);
  background:var(--ent-tone-warning-bg); border:1px solid var(--ent-tone-warning-line);
  border-radius:var(--ent-r-sm); font-size:var(--ent-fs-micro);
  line-height:var(--ent-lh); color:var(--ent-tone-warning-fg); }
.e-ok { margin:var(--ent-s2) var(--ent-s3); padding:var(--ent-s2);
  background:var(--ent-tone-positive-bg); border:1px solid var(--ent-tone-positive-line);
  border-radius:var(--ent-r-sm); font-size:var(--ent-fs-micro);
  line-height:var(--ent-lh); color:var(--ent-tone-positive-fg); }

.e-input { display:block; width:calc(100% - 2 * var(--ent-s3)); margin:var(--ent-s2) var(--ent-s3) 0;
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm);
  padding:var(--ent-s2); font-family:var(--ent-font); font-size:var(--ent-fs-xs);
  color:var(--ent-text); background:var(--ent-surface); box-sizing:border-box; }
textarea.e-input { resize:vertical; line-height:var(--ent-lh); }
select.e-input { min-height:var(--ent-control-h); }

/* ── Health registers: the map key and the spatial read-outs ───────────── */
/* Below MapLibre's zoom, compass and geolocate stack in the top-right, which
   leaves the top-centre clear for the hint. */
.e-eho { position:absolute; top:9.5rem; right:var(--ent-s3); width:12.5rem;
  background:var(--ent-map-panel-bg); border:1px solid var(--ent-map-panel-line);
  border-radius:var(--ent-r-lg); box-shadow:var(--ent-map-panel-shadow);
  padding:var(--ent-s2) var(--ent-s3); backdrop-filter:blur(6px); z-index:var(--ent-z-sticky); }
.e-eho-head { display:flex; align-items:center; gap:var(--ent-s1);
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-bold); color:var(--ent-text); cursor:pointer; }
.e-eho-key { list-style:none; margin:var(--ent-s2) 0 0; padding:0;
  display:flex; flex-direction:column; gap:2px; }
.e-eho-key li { display:flex; align-items:center; gap:var(--ent-s1);
  font-size:var(--ent-fs-micro); color:var(--ent-text-2); }
.e-eho-key b { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--ent-text); }
.e-eho-err { margin:var(--ent-s2) 0 0; font-size:var(--ent-fs-micro); color:var(--ent-danger); }
.e-eho-note { margin:var(--ent-s2) 0 0; padding-top:var(--ent-s2);
  border-top:1px solid var(--ent-line);
  font-size:var(--ent-fs-micro); line-height:var(--ent-lh); color:var(--ent-warning); }

/* One swatch vocabulary, matching the map paint above. */
.e-sw { width:0.6rem; height:0.6rem; border-radius:50%; flex-shrink:0;
  border:1.5px solid var(--ent-surface); box-shadow:0 0 0 1px var(--ent-line); }
.e-sw.premises { background:var(--ent-accent); }
.e-sw.outbreak, .e-sw.r-not_potable { background:var(--ent-danger); }
.e-sw.complaint, .e-sw.r-borderline { background:var(--ent-warning); }
.e-sw.r-potable { background:var(--ent-success); }
.e-sw.r-pending { background:var(--ent-text-3); }
/* The key swatch for water is split: danger / warning / success, because the
   map colours each sample by its result and no single colour is honest. */
.e-sw.water { background:conic-gradient(var(--ent-danger) 0 33%, var(--ent-warning) 0 66%, var(--ent-success) 0); }

.e-catch { padding:var(--ent-s3); border-bottom:1px solid var(--ent-line);
  display:flex; flex-direction:column; gap:var(--ent-s2); }
.e-catch-head { display:flex; align-items:center; gap:var(--ent-s2); color:var(--ent-text-2); }
.e-catch-head h3 { flex:1; margin:0; font-size:var(--ent-fs-sm);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.e-x { display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h-sm); height:var(--ent-control-h-sm);
  border:1px solid transparent; border-radius:var(--ent-r-sm);
  background:none; color:var(--ent-text-2); cursor:pointer; }
.e-x:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.e-catch-sub { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-2); text-transform:capitalize; }
.e-catch-radius { display:flex; align-items:center; gap:var(--ent-s2); font-size:var(--ent-fs-micro);
  color:var(--ent-text-3); }
.e-catch-radius input { flex:1; min-width:0; accent-color:var(--ent-accent); }
.e-catch-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.e-catch-list li { display:flex; gap:var(--ent-s2); font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.e-catch-list b { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--ent-text); }
.e-catch-block { border-top:1px solid var(--ent-line); padding-top:var(--ent-s2); }
.e-catch-block h4 { margin:0 0 var(--ent-s1); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); color:var(--ent-text-3);
  text-transform:uppercase; letter-spacing:0.04em; }
.e-catch-row { display:flex; align-items:center; gap:var(--ent-s1); margin:0 0 2px;
  font-size:var(--ent-fs-micro); color:var(--ent-text-2); text-transform:capitalize; }
.e-catch-row .e-mono { margin-left:auto; color:var(--ent-text-3); text-transform:none; }
.e-catch .e-btn.sm { margin:0; align-self:flex-start; }
.e-pick { margin:0; display:flex; flex-direction:column; gap:2px; }
.e-pick > div { display:flex; gap:var(--ent-s2); font-size:var(--ent-fs-micro); }
.e-pick dt { color:var(--ent-text-3); min-width:7rem; }
.e-pick dd { margin:0; color:var(--ent-text); text-transform:capitalize; }

.spin { animation:e-spin 1s linear infinite; }
@keyframes e-spin { to { transform:rotate(360deg); } }

/* ── Tablet: 768–1023 ─────────────────────────────────────────────────────
   Both side panels narrow rather than disappear — a tablet is still a
   two-hand, desk-adjacent device and the officer wants the list visible. */
@media (max-width: 1023px) {
  .e-left { width:15rem; }
  .e-right { width:19rem; }
  .e-btn-label { display:none; }
  .e-hint { display:none; }
}

/* ── Mobile: ≤767 ─────────────────────────────────────────────────────────
   The panels are UiSheets at this width (see leftBinding / rightBinding), so
   the map is full-bleed and only the layer panel remains on it, collapsed. */
@media (max-width: 767px) {
  .e-brand-text { display:none; }
  /* The key competes with the map on a 390px screen; the records stay drawn
     and the counts are in the sheet. */
  .e-eho { display:none; }
  .e-layers { width:auto; max-width:calc(100vw - 2 * var(--ent-s3)); right:var(--ent-s3); }
  .e-layers:not(.open) .e-layers-body { display:none; }
}
</style>
