<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────
// Building Inspector — site map pane.
//
// The spatial half of /inspector-workspace. The console pane owns the statutory
// workflow (stages, checklist, flags, certificates, referrals); this pane owns
// the questions an inspector asks of the map:
//
//   Where is the site, and how sure are we?   server site resolution + precision
//   What checks apply to it?                  site report (zoning, constraints,
//                                             coverage, boundary clearance,
//                                             adjoining stands, nearby cases)
//   What is at this spot?                     identify-on-click, incl. mapped
//                                             structures with no linked case
//   Where am I, and in what order do I go?    locate me + day-run ordering
//   Measure / notification radius / imagery   shared MapToolbar
//   The permit has no position                record it (GPS at pegs or map pick)
//
// Spec: docs/superpowers/specs/2026-09-13-inspector-gis-design.md
//
// Map symbology reads the --ent-* tokens at runtime so the legend swatches and
// the painted sites cannot disagree.
// ─────────────────────────────────────────────────────────────────────────
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import {
  Crosshair, HardHat, LayoutGrid, List, LocateFixed, Navigation, RefreshCw,
  Route, Search, X,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { addVunguBasemap, setBasemapLayerVisible } from '@/map/vunguBasemap'
import { featureAtPoint, type ClickedFeature } from '@/map/featureAtPoint'
import { fitBounds, flyTo } from '@/map/tools/camera'
import MapToolbar from '@/components/map/MapToolbar.vue'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import InspectorSiteReport from '@/components/inspector/InspectorSiteReport.vue'
import InspectorIdentifyCard from '@/components/inspector/InspectorIdentifyCard.vue'
import InspectorSiteLocationSheet from '@/components/inspector/InspectorSiteLocationSheet.vue'
import SiteNavigation from '@/components/inspector/SiteNavigation.vue'
import { useInspectorSites, type InspectorMapSite } from '@/composables/useInspectorSites'
import { tryUseInspectionCase } from '@/composables/useInspectionCase'
import {
  captureGps, gpsFailureMessage, isGpsFailure, navigationHref,
  type GpsObservation,
} from '@/composables/useInspectionNavigation'
import { useBreakpoint } from '@/composables/useBreakpoint'
import {
  inspectorGis, type IdentifyResult, type SiteLocationResult, type SiteReport,
} from '@/services/inspectorGis'
import {
  SITE_STATUS_LABELS, SITE_STATUS_TOKENS, distanceM, formatMetres, humanize,
  isPositioned, nextStageFor, planRun, precisionCopy, siteStatusClass,
  type SiteStatusClass,
} from '@/inspector/siteGeo'

// `embedded`: hosted as the map pane of RoleWorkspaceShell, which supplies the
// brand block and profile menu.
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ 'open-console': [] }>()

const router = useRouter()
const auth = useAuthStore()
const { isMobile: isPhone, isTablet } = useBreakpoint()
// Below the laptop breakpoint the side panels become sheets: a 768px pane has no room for two rails and a map.
const isMobile = computed(() => isPhone.value || isTablet.value)
const inspectionCase = tryUseInspectionCase()

const {
  layers, sites, enforcement, unpositioned, loading: sitesLoading, error: sitesError, scope, refresh,
} = useInspectorSites()

const SITE_POSITION_ROLES = ['building_inspector', 'gis_officer', 'planner', 'admin']
const canRecordPosition = computed(() => SITE_POSITION_ROLES.includes(String(auth.user?.role ?? '')))

// ── announcements (one polite live region) ────────────────────────────
const status = ref('')
let statusTimer: ReturnType<typeof setTimeout> | null = null
function announce(msg: string) {
  status.value = msg
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { status.value = '' }, 6000)
}

// ── site list: filter, search, status ─────────────────────────────────
type Filter = 'all' | 'attention' | 'enforcement' | 'unpositioned'
const filter = ref<Filter>('all')
const query = ref('')
const now = ref(new Date())

const STATUS_RANK: Record<SiteStatusClass, number> = {
  enforcement: 0, failed: 1, overdue: 2, due: 3, active: 4, awaiting: 5, occupied: 6,
}

const classed = computed(() => sites.value.map(s => ({ site: s, cls: siteStatusClass(s, now.value) })))

const counts = computed(() => ({
  total: sites.value.length,
  positioned: sites.value.length - unpositioned.value.length,
  unpositioned: unpositioned.value.length,
  attention: classed.value.filter(x => ['failed', 'overdue', 'due'].includes(x.cls)).length,
  enforcement: classed.value.filter(x => x.cls === 'enforcement').length,
}))

const visibleSites = computed(() => {
  const q = query.value.trim().toLowerCase()
  return classed.value
    .filter(({ site, cls }) => {
      if (filter.value === 'attention' && !['failed', 'overdue', 'due'].includes(cls)) return false
      if (filter.value === 'enforcement' && cls !== 'enforcement') return false
      if (filter.value === 'unpositioned' && site.center) return false
      if (!q) return true
      return [site.ref, site.title, site.stand, site.ward, site.applicant]
        .some(v => String(v ?? '').toLowerCase().includes(q))
    })
    .sort((a, b) => STATUS_RANK[a.cls] - STATUS_RANK[b.cls] || a.site.ref.localeCompare(b.site.ref))
})

// ── selection ─────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null)
const selected = computed<InspectorMapSite | null>(() =>
  sites.value.find(s => s.permitId === selectedId.value) ?? null)
const selectedClass = computed(() => selected.value ? siteStatusClass(selected.value, now.value) : null)

const report = shallowRef<SiteReport | null>(null)
const reportReload = ref(0)

const sitesSheetOpen = ref(false)
const detailSheetOpen = ref(false)

function selectSite(permitId: string, opts: { fly?: boolean; loadCase?: boolean } = {}) {
  const site = sites.value.find(s => s.permitId === permitId)
  selectedId.value = permitId
  clearIdentify()
  runOpen.value = false
  if (opts.loadCase !== false && inspectionCase && inspectionCase.current.value?.permitId !== permitId) {
    void inspectionCase.loadPermit(permitId)
  }
  if (opts.fly !== false && site) focusSite(site)
  if (isMobile.value) { sitesSheetOpen.value = false; detailSheetOpen.value = true }
}

function clearSelection() {
  selectedId.value = null
  report.value = null
  detailSheetOpen.value = false
}

/** Console → map: the case opened in the console is the case the map shows. */
watch(() => inspectionCase?.current.value?.permitId ?? null, (permitId) => {
  if (!permitId || permitId === selectedId.value) return
  if (sites.value.some(s => s.permitId === permitId)) selectSite(permitId, { loadCase: false })
})

function focusSite(site: InspectorMapSite) {
  const map = mapRef.value
  if (!map) return
  const boundary = layers.value.boundaries.features.find(f => f.properties.permitId === site.permitId)
  if (boundary) {
    const [minX, minY, maxX, maxY] = turf.bbox(boundary)
    fitBounds(map, [[minX, minY], [maxX, maxY]], { padding: 80, maxZoom: 18, duration: 700 })
  } else if (site.center) {
    flyTo(map, { center: site.center, zoom: Math.max(map.getZoom(), 16), duration: 700 })
  }
}

function onReportLoaded(r: SiteReport | null) {
  report.value = r
}

function openInConsole() {
  if (!selected.value) return
  if (inspectionCase && inspectionCase.current.value?.permitId !== selected.value.permitId) {
    void inspectionCase.loadPermit(selected.value.permitId)
  }
  if (props.embedded) emit('open-console')
  else router.push('/inspector-workspace')
}

// Navigation is the council's own turn-by-turn screen, not a handoff to a
// public map: it routes over the council road network, keeps working when the
// signal drops on a district road, and never puts an inspection site into a
// third party's request log. An external map stays as a one-line escape for an
// inspector who would rather drive with the app they already know.
//
// A site is navigable only when its position is a real point (ADR 0010) — an
// 'area' or 'none' precision is a ward centroid, and directions to it would be
// directions to the wrong place stated confidently.
const canNavigate = computed(
  () => !!selected.value?.center && isPositioned(selected.value?.precision),
)
const navOpen = ref(false)

// A function, NOT a computed: the device rule behind navigationHref reads
// navigator and has no reactive dependency, so a computed would cache the first
// answer and keep serving a geo: link after the device changed (emulation, or a
// panel kept alive across it). Re-reading per render costs nothing.
function externalMapHref(): string | null {
  const c = selected.value?.center
  return c && isPositioned(selected.value?.precision) ? navigationHref(c[1], c[0]) : null
}

// ── identify ──────────────────────────────────────────────────────────
const identifyPoint = ref<[number, number] | null>(null)
const identifyResult = shallowRef<IdentifyResult | null>(null)
const identifyLoading = ref(false)
const identifyError = ref<string | null>(null)
// The basemap feature under the same click — the road, parcel or landuse
// polygon itself, with the attributes the layer publishes. The basemap here is
// added non-interactive, so it is read off the rendered tile.
const mapFeature = shallowRef<ClickedFeature | null>(null)
let identifySeq = 0

async function runIdentify(lng: number, lat: number, feature: ClickedFeature | null = null) {
  const mine = ++identifySeq
  identifyPoint.value = [lng, lat]
  mapFeature.value = feature
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
  identifyPoint.value = null
  mapFeature.value = null
  identifyResult.value = null
  identifyError.value = null
  identifyLoading.value = false
}

function openCaseFromIdentify(permitId: string) {
  if (sites.value.some(s => s.permitId === permitId)) {
    selectSite(permitId)
    return
  }
  // The case exists but is outside the loaded scope (e.g. not yet approved).
  scope.value = 'all'
  void refresh().then(() => {
    if (sites.value.some(s => s.permitId === permitId)) selectSite(permitId)
    else announce('That case could not be opened on the map.')
  })
}

// ── locate me ─────────────────────────────────────────────────────────
const me = ref<GpsObservation | null>(null)
const locating = ref(false)

async function locateMe() {
  locating.value = true
  const r = await captureGps({ timeoutMs: 15000, maximumAgeMs: 10000 })
  locating.value = false
  if (isGpsFailure(r)) {
    announce(gpsFailureMessage(r).replace(/ Photos will be saved without GPS coordinates\.| Coordinates will not be attached\./, ''))
    return
  }
  me.value = r
  if (mapRef.value) flyTo(mapRef.value, { center: [r.lng, r.lat], zoom: Math.max(mapRef.value.getZoom(), 15), duration: 700 })
  announce(`Located${r.accuracyM != null ? ` to ±${Math.round(r.accuracyM)} m` : ''}.`)
}

const distanceFromMe = computed(() => {
  if (!me.value || !selected.value?.center) return null
  return distanceM([me.value.lng, me.value.lat], selected.value.center)
})

// ── day run ───────────────────────────────────────────────────────────
const runOpen = ref(false)
const runScope = ref<'attention' | 'open'>('attention')
const runStart = ref<{ center: [number, number]; from: 'gps' | 'map' } | null>(null)

const runStops = computed(() => classed.value
  .filter(({ site, cls }) => site.center && (runScope.value === 'open'
    ? ['enforcement', 'failed', 'overdue', 'due', 'active'].includes(cls)
    : ['failed', 'overdue', 'due'].includes(cls)))
  .map(({ site, cls }) => ({ id: site.permitId, center: site.center as [number, number], site, cls })))

const runLegs = computed(() => runStart.value ? planRun(runStart.value.center, runStops.value) : [])

function openRun() {
  const map = mapRef.value
  if (me.value) runStart.value = { center: [me.value.lng, me.value.lat], from: 'gps' }
  else if (map) { const c = map.getCenter(); runStart.value = { center: [c.lng, c.lat], from: 'map' } }
  runOpen.value = true
  if (isMobile.value) sitesSheetOpen.value = true
  fitRun()
}

function fitRun() {
  const map = mapRef.value
  if (!map || !runStart.value || !runLegs.value.length) return
  const pts = [runStart.value.center, ...runLegs.value.map(l => l.stop.center)]
  const [minX, minY, maxX, maxY] = turf.bbox(turf.multiPoint(pts))
  fitBounds(map, [[minX, minY], [maxX, maxY]], { padding: 80, maxZoom: 16, duration: 700 })
}

watch(runScope, fitRun)

// ── record site position ──────────────────────────────────────────────
const locationSheetOpen = ref(false)
const pickMode = ref(false)
const pickedPoint = ref<[number, number] | null>(null)

function openLocationSheet() {
  pickedPoint.value = null
  locationSheetOpen.value = true
}

function startPick() {
  locationSheetOpen.value = false
  detailSheetOpen.value = false
  pickMode.value = true
  announce('Click the site on the map. Press Escape to cancel.')
}

function cancelPick() {
  pickMode.value = false
  locationSheetOpen.value = true
}

async function onLocationSaved(r: SiteLocationResult) {
  announce(r.movedM != null ? `Site position saved. Moved ${formatMetres(r.movedM)}.` : 'Site position saved.')
  const id = selectedId.value
  await refresh()
  reportReload.value++
  if (id) {
    const site = sites.value.find(s => s.permitId === id)
    if (site) focusSite(site)
    if (isMobile.value) detailSheetOpen.value = true
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (pickMode.value) cancelPick()
  else if (identifyPoint.value) clearIdentify()
}

// ── map ───────────────────────────────────────────────────────────────
const mapContainer = ref<HTMLElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const mapRef = shallowRef<maplibregl.Map | null>(null)
const mapReady = ref(false)
const mapError = ref<string | null>(null)
const toolActive = ref<string>('none')
const cursor = ref<[number, number] | null>(null)
const zoom = ref(10.5)
let resizeObserver: ResizeObserver | null = null
// Overdue/due classes are calendar-based; refresh them as the day turns.
const clockTimer = setInterval(() => { now.value = new Date() }, 60_000)

const VUNGU_CENTER: [number, number] = [29.65, -19.45]

const SRC = {
  boundaries: 'bi-boundaries', points: 'bi-points', enforcement: 'bi-enforcement',
  selection: 'bi-selection', footprints: 'bi-footprints', me: 'bi-me', run: 'bi-run', identify: 'bi-identify',
} as const
const LYR = {
  boundaryFill: 'bi-boundary-fill', boundaryLine: 'bi-boundary-line',
  footprintFill: 'bi-footprint-fill', footprintLine: 'bi-footprint-line',
  run: 'bi-run-line', points: 'bi-points-circle', enforcement: 'bi-enforcement-ring',
  selectionLine: 'bi-selection-line', selectionRing: 'bi-selection-ring',
  meAccuracy: 'bi-me-accuracy', meDot: 'bi-me-dot', identify: 'bi-identify-pt', identifyLine: 'bi-identify-line',
} as const

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(rootEl.value ?? document.documentElement).getPropertyValue(name).trim()
  return /^(#|rgb|hsl)/i.test(v) ? v : fallback
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] } as const

function setData(id: string, data: unknown) {
  const src = mapRef.value?.getSource(id) as { setData?: (d: unknown) => void } | undefined
  src?.setData?.(data)
}

function addOverlays(map: maplibregl.Map) {
  const c = {
    accent: token('--ent-accent', '#1f5aa8'),
    danger: token('--ent-danger', '#bd2f28'),
    warning: token('--ent-warning', '#a8620a'),
    success: token('--ent-success', '#1d7a4d'),
    info: token('--ent-info', '#1f5aa8'),
    muted: token('--ent-text-3', '#7b8797'),
    surface: token('--ent-surface', '#ffffff'),
    text: token('--ent-text', '#1b2430'),
  }
  const statusColor = (cls: SiteStatusClass) => {
    const t = SITE_STATUS_TOKENS[cls]
    return t === '--ent-danger' ? c.danger : t === '--ent-warning' ? c.warning
      : t === '--ent-success' ? c.success : t === '--ent-info' ? c.info : c.muted
  }
  for (const id of Object.values(SRC)) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC } as never)
  }
  const add = (layer: Record<string, unknown>) => { if (!map.getLayer(layer.id as string)) map.addLayer(layer as never) }

  add({ id: LYR.boundaryFill, type: 'fill', source: SRC.boundaries, paint: { 'fill-color': c.accent, 'fill-opacity': 0.08 } })
  add({ id: LYR.boundaryLine, type: 'line', source: SRC.boundaries, paint: { 'line-color': c.accent, 'line-width': 1.5, 'line-opacity': 0.8 } })
  add({
    id: LYR.footprintFill, type: 'fill', source: SRC.footprints,
    paint: { 'fill-color': ['case', ['get', 'withinSite'], c.success, c.warning], 'fill-opacity': 0.35 },
  })
  add({
    id: LYR.footprintLine, type: 'line', source: SRC.footprints,
    paint: { 'line-color': ['case', ['get', 'withinSite'], c.success, c.warning], 'line-width': 1.5 },
  })
  add({
    id: LYR.run, type: 'line', source: SRC.run,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.text, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.7 },
  })
  add({
    id: LYR.enforcement, type: 'circle', source: SRC.enforcement,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 16, 13],
      'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': c.danger, 'circle-stroke-width': 2.5,
    },
  })
  const classes = Object.keys(SITE_STATUS_TOKENS) as SiteStatusClass[]
  add({
    id: LYR.points, type: 'circle', source: SRC.points,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 16, 8],
      'circle-color': ['match', ['get', 'statusClass'], ...classes.flatMap(k => [k, statusColor(k)]), c.muted],
      'circle-stroke-color': c.surface, 'circle-stroke-width': 2,
    },
  })
  add({ id: LYR.selectionLine, type: 'line', source: SRC.selection, filter: ['!=', '$type', 'Point'], paint: { 'line-color': c.accent, 'line-width': 3.5 } })
  add({
    id: LYR.selectionRing, type: 'circle', source: SRC.selection, filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 16, 17],
      'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': c.accent, 'circle-stroke-width': 3,
    },
  })
  add({ id: LYR.meAccuracy, type: 'fill', source: SRC.me, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': c.accent, 'fill-opacity': 0.12 } })
  add({
    id: LYR.meDot, type: 'circle', source: SRC.me, filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 6, 'circle-color': c.accent, 'circle-stroke-color': c.surface, 'circle-stroke-width': 2.5 },
  })
  add({ id: LYR.identifyLine, type: 'line', source: SRC.identify, filter: ['!=', '$type', 'Point'], paint: { 'line-color': c.text, 'line-width': 2.5 } })
  add({
    id: LYR.identify, type: 'circle', source: SRC.identify, filter: ['==', '$type', 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': c.surface, 'circle-stroke-color': c.text, 'circle-stroke-width': 2.5 },
  })
}

// Inspection overlays draw above every basemap layer, and the MapToolbar's
// measure / radius drawing above them. Layer filters can reorder the basemap
// after load, so this runs on every style change; it is a no-op once in order.
const OVERLAY_ORDER = [
  LYR.boundaryFill, LYR.boundaryLine, LYR.footprintFill, LYR.footprintLine, LYR.run,
  LYR.enforcement, LYR.points, LYR.selectionLine, LYR.selectionRing,
  LYR.meAccuracy, LYR.meDot, LYR.identifyLine, LYR.identify,
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

function pushAll() {
  if (!mapReady.value) return
  pushSites(); pushSelection(); pushFootprints(); pushMe(); pushRun(); pushIdentify()
}

function pushSites() {
  setData(SRC.boundaries, layers.value.boundaries)
  setData(SRC.points, {
    type: 'FeatureCollection',
    features: classed.value.filter(x => x.site.center).map(({ site, cls }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: site.center },
      properties: { permitId: site.permitId, statusClass: cls },
    })),
  })
  setData(SRC.enforcement, {
    type: 'FeatureCollection',
    features: enforcement.value.filter(o => o.center).map(o => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: o.center },
      properties: { orderId: o.orderId, permitId: o.permitId ?? '' },
    })),
  })
}

function pushSelection() {
  const s = selected.value
  if (!s) { setData(SRC.selection, EMPTY_FC); return }
  const boundary = layers.value.boundaries.features.find(f => f.properties.permitId === s.permitId)
  const features: unknown[] = []
  if (boundary) features.push({ type: 'Feature', geometry: boundary.geometry, properties: {} })
  if (s.center) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: s.center }, properties: {} })
  setData(SRC.selection, { type: 'FeatureCollection', features })
}

function pushFootprints() {
  const fc = report.value?.site.permitId === selectedId.value ? report.value?.structures?.footprints : null
  setData(SRC.footprints, fc ?? EMPTY_FC)
}

function pushMe() {
  const m = me.value
  if (!m) { setData(SRC.me, EMPTY_FC); return }
  const features: unknown[] = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng, m.lat] }, properties: {} }]
  if (m.accuracyM != null && m.accuracyM > 0) {
    features.unshift(turf.circle([m.lng, m.lat], m.accuracyM / 1000, { steps: 48, units: 'kilometers' }))
  }
  setData(SRC.me, { type: 'FeatureCollection', features })
}

function pushRun() {
  if (!runOpen.value || !runStart.value || !runLegs.value.length) { setData(SRC.run, EMPTY_FC); return }
  setData(SRC.run, {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [runStart.value.center, ...runLegs.value.map(l => l.stop.center)] },
    properties: {},
  })
}

function pushIdentify() {
  const p = identifyPoint.value
  const features: unknown[] = []
  if (p) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })
  if (identifyResult.value?.building?.geometry) {
    features.push({ type: 'Feature', geometry: identifyResult.value.building.geometry, properties: {} })
  }
  setData(SRC.identify, { type: 'FeatureCollection', features })
}

watch([layers, classed, enforcement], pushSites)
watch([selected, layers], pushSelection)
watch([report, selectedId], pushFootprints)
watch(me, pushMe)
watch([runOpen, runLegs], pushRun)
watch([identifyPoint, identifyResult], pushIdentify)

function onMapClick(e: maplibregl.MapMouseEvent) {
  const map = mapRef.value
  if (!map) return
  // Measure and radius own the click while active.
  if (toolActive.value === 'measure' || toolActive.value === 'radius') return
  const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]

  if (pickMode.value) {
    pickMode.value = false
    pickedPoint.value = lngLat
    locationSheetOpen.value = true
    return
  }

  const box: [[number, number], [number, number]] = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]]
  const pointLayers = [LYR.points, LYR.enforcement].filter(id => map.getLayer(id))
  const hits = pointLayers.length ? map.queryRenderedFeatures(box, { layers: pointLayers }) : []
  const siteHit = hits.find(h => h.layer.id === LYR.points)
  if (siteHit) { selectSite(String(siteHit.properties?.permitId)); return }
  const enfHit = hits.find(h => h.layer.id === LYR.enforcement)
  if (enfHit?.properties?.permitId && sites.value.some(s => s.permitId === enfHit.properties?.permitId)) {
    selectSite(String(enfHit.properties.permitId))
    return
  }
  // Inside another site's boundary selects it; inside the selected site's
  // boundary identifies what is there (a structure on the stand).
  const boundaryHits = map.getLayer(LYR.boundaryFill) ? map.queryRenderedFeatures(e.point, { layers: [LYR.boundaryFill] }) : []
  const other = boundaryHits.find(h => h.properties?.permitId !== selectedId.value)
  if (other && !boundaryHits.some(h => h.properties?.permitId === selectedId.value)) {
    selectSite(String(other.properties?.permitId), { fly: false })
    return
  }
  void runIdentify(lngLat[0], lngLat[1], featureAtPoint(map, e.point))
}

function onMapMove(e: maplibregl.MapMouseEvent) {
  cursor.value = [e.lngLat.lng, e.lngLat.lat]
  const map = mapRef.value
  if (!map || !map.getLayer(LYR.points)) return
  const over = map.queryRenderedFeatures(e.point, { layers: [LYR.points] }).length > 0
  map.getCanvas().style.cursor = pickMode.value || toolActive.value === 'measure' || toolActive.value === 'radius'
    ? 'crosshair'
    : over ? 'pointer' : ''
}

function resetView() {
  const map = mapRef.value
  if (!map) return
  const pts = sites.value.filter(s => s.center).map(s => s.center as [number, number])
  if (pts.length > 1) {
    const [minX, minY, maxX, maxY] = turf.bbox(turf.multiPoint(pts))
    fitBounds(map, [[minX, minY], [maxX, maxY]], { padding: 80, maxZoom: 15, duration: 700 })
  } else if (pts.length === 1) {
    flyTo(map, { center: pts[0], zoom: 15, duration: 700 })
  } else {
    flyTo(map, { center: VUNGU_CENTER, zoom: 10.5, duration: 700 })
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)

  void refresh()
  if (!mapContainer.value) return
  try {
    const map = new maplibregl.Map({
      container: mapContainer.value,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }],
        glyphs: '/fonts/{fontstack}/{range}.pbf',
      } as never,
      center: VUNGU_CENTER,
      zoom: 10.5,
      minZoom: 5,
      maxZoom: 21,
      attributionControl: false,
      // Retain the WebGL drawing buffer so MapToolbar's "Export PDF" can read
      // the rendered canvas back with toDataURL() — without it the exported
      // A4 sheet comes out blank on every host that mounts the toolbar.
      preserveDrawingBuffer: true,
    })
    mapRef.value = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    map.on('error', (ev) => {
      const m = (ev as { error?: { message?: string } })?.error?.message ?? ''
      if (!/fetch|network|glyph|tile|font|ERR_|unimplemented type|AbortError/i.test(m)) console.warn('[inspector map]', m)
    })
    map.on('load', async () => {
      // Not interactive: the basemap's own click handler drill-zooms admin
      // units, which would move the camera on every identify click. No
      // auto-tilt: a pitched camera distorts measured setbacks.
      try { await addVunguBasemap(map, { interactive: false, autoTilt: false }) } catch (e) { console.warn('[inspector map] basemap', e) }
      if (!mapRef.value) return
      // The Stands Register is the cadastre a building inspector works against.
      setBasemapLayerVisible(map, 'stands', true)
      addOverlays(map)
      map.on('styledata', () => keepOverlaysOnTop(map))
      mapReady.value = true
      pushAll()
      if (sites.value.some(s => s.center)) resetView()
    })
    map.on('click', onMapClick)
    map.on('mousemove', onMapMove)
    map.on('zoomend', () => { zoom.value = Math.round(map.getZoom() * 10) / 10 })
    // The pane may mount hidden (console-first on phones): resize when it shows.
    resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(mapContainer.value)
  } catch (e: unknown) {
    mapError.value = e instanceof Error && /webgl/i.test(e.message)
      ? 'The map needs WebGL, which this browser has disabled. Site lists and checks still work.'
      : 'The map could not start. Site lists and checks still work.'
  }
})

// First successful load with positioned sites: frame them.
watch(() => sites.value.length, (n, prev) => {
  if (mapReady.value && n && !prev && !selectedId.value) resetView()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (statusTimer) clearTimeout(statusTimer)
  resizeObserver?.disconnect()
  clearInterval(clockTimer)
  mapRef.value?.remove()
  mapRef.value = null
})

function handleLogout() {
  auth.logout()
  router.push('/login')
}

const LEGEND = (Object.keys(SITE_STATUS_LABELS) as SiteStatusClass[]).map(k => ({ key: k, label: SITE_STATUS_LABELS[k] }))
const legendOpen = ref(!isMobile.value)

const leftBinding = computed(() => isMobile.value
  ? { is: UiSheet, attrs: { open: sitesSheetOpen.value, title: runOpen.value ? 'Day run' : 'Inspection sites', variant: 'drawer', side: 'left', tall: true, 'onUpdate:open': (v: boolean) => { sitesSheetOpen.value = v } } }
  : { is: 'aside', attrs: { class: 'bim-left', 'aria-label': 'Inspection sites' } })

const rightBinding = computed(() => isMobile.value
  ? { is: UiSheet, attrs: { open: detailSheetOpen.value, title: identifyPoint.value ? 'What is here' : (selected.value?.ref ?? 'Site'), tall: true, 'onUpdate:open': (v: boolean) => { detailSheetOpen.value = v; if (!v) clearIdentify() } } }
  : { is: 'aside', attrs: { class: 'bim-right', 'aria-label': 'Selected site' } })
</script>

<template>
  <div ref="rootEl" class="bim" :class="{ embedded: props.embedded }">
    <!-- Top bar -->
    <header class="bim-bar">
      <div v-if="!props.embedded" class="bim-brand">
        <span class="bim-logo"><HardHat :size="15" aria-hidden="true" /></span>
        <span class="bim-brand-text">
          <span class="bim-title">Building Inspector</span>
          <span class="bim-sub">Site map</span>
        </span>
      </div>

      <label v-if="!isPhone" class="bim-search">
        <Search :size="13" aria-hidden="true" />
        <span class="ent-sr-only">Filter sites</span>
        <input v-model="query" type="search" placeholder="Filter by reference, stand, ward, applicant" @focus="isMobile && (sitesSheetOpen = true)" />
      </label>

      <div class="bim-actions">
        <UiButton v-if="isMobile" size="sm" @click="sitesSheetOpen = true">
          <template #icon><List :size="13" /></template>
          Sites
        </UiButton>
        <UiButton size="sm" :loading="locating" :disabled="locating" @click="locateMe">
          <template #icon><LocateFixed :size="13" /></template>
          <span :class="{ 'ent-sr-only': isMobile }">Locate me</span>
        </UiButton>
        <UiButton size="sm" :variant="runOpen ? 'primary' : 'secondary'" @click="runOpen ? (runOpen = false) : openRun()">
          <template #icon><Route :size="13" /></template>
          <span :class="{ 'ent-sr-only': isMobile }">Day run</span>
        </UiButton>
        <UiButton size="sm" variant="ghost" :disabled="sitesLoading" @click="refresh">
          <template #icon><RefreshCw :size="13" :class="{ spin: sitesLoading }" /></template>
          <span class="ent-sr-only">Reload sites</span>
        </UiButton>
      </div>

      <ProfileDropdown v-if="!props.embedded" role-label="Building Inspector" avatar-key="building_inspector_avatar" @logout="handleLogout" />
    </header>

    <div class="bim-body">
      <!-- Left: site list or day run -->
      <component :is="leftBinding.is" v-bind="leftBinding.attrs">
        <div class="bim-panel">
          <template v-if="!runOpen">
            <label v-if="isPhone" class="bim-search bim-search--panel">
              <Search :size="13" aria-hidden="true" />
              <span class="ent-sr-only">Filter sites</span>
              <input v-model="query" type="search" placeholder="Reference, stand, ward, applicant" />
            </label>
            <div class="bim-summary" role="group" aria-label="Site filters">
              <button v-for="f in ([
                  { key: 'all', label: 'All', n: counts.total },
                  { key: 'attention', label: 'Due or failed', n: counts.attention },
                  { key: 'enforcement', label: 'Enforcement', n: counts.enforcement },
                  { key: 'unpositioned', label: 'Not positioned', n: counts.unpositioned },
                ] as const)"
                :key="f.key" type="button" class="bim-chip" :class="{ on: filter === f.key }"
                :aria-pressed="filter === f.key" @click="filter = f.key">
                {{ f.label }} <span class="bim-chip-n">{{ f.n }}</span>
              </button>
            </div>
            <div class="bim-scope">
              <label>
                <input type="checkbox" :checked="scope === 'all'" @change="scope = ($event.target as HTMLInputElement).checked ? 'all' : 'inspectable'; refresh()" />
                Include permits not yet approved
              </label>
            </div>

            <p v-if="sitesError" class="bim-error" role="alert">
              {{ sitesError }} <button type="button" class="bim-link" @click="refresh">Try again</button>
            </p>
            <p v-else-if="sitesLoading && !sites.length" class="bim-muted" role="status">Loading inspection sites…</p>
            <p v-else-if="!visibleSites.length" class="bim-muted">
              {{ sites.length ? 'No sites match this filter.' : 'No inspection sites. Approved permits appear here.' }}
            </p>

            <p v-if="counts.unpositioned && filter !== 'unpositioned'" class="bim-hint">
              {{ counts.unpositioned }} of {{ counts.total }} sites have no usable position and are not on the map.
              <button type="button" class="bim-link" @click="filter = 'unpositioned'">Show them</button>
            </p>

            <ul class="bim-list">
              <li v-for="{ site, cls } in visibleSites" :key="site.permitId">
                <button type="button" class="bim-item" :class="{ selected: site.permitId === selectedId }"
                        :aria-current="site.permitId === selectedId ? 'true' : undefined"
                        @click="selectSite(site.permitId)">
                  <span class="bim-dot" :class="`c-${cls}`" aria-hidden="true" />
                  <span class="bim-item-body">
                    <span class="bim-item-top">
                      <span class="bim-ref">{{ site.ref }}</span>
                      <span class="bim-cls">{{ SITE_STATUS_LABELS[cls] }}</span>
                    </span>
                    <span class="bim-item-title">{{ site.title }}</span>
                    <span class="bim-item-meta">
                      Stand {{ site.stand }} · Ward {{ site.ward }} · {{ nextStageFor(site).label }}
                    </span>
                    <span v-if="!site.center" class="bim-item-warn">{{ precisionCopy(site.precision, site.coarseArea).label }}</span>
                  </span>
                </button>
              </li>
            </ul>
          </template>

          <!-- Day run -->
          <template v-else>
            <div class="bim-run-head">
              <strong>Day run</strong>
              <button type="button" class="bim-icon-btn" @click="runOpen = false">
                <X :size="14" aria-hidden="true" /><span class="ent-sr-only">Close day run</span>
              </button>
            </div>
            <div class="bim-summary" role="group" aria-label="Sites in the run">
              <button type="button" class="bim-chip" :class="{ on: runScope === 'attention' }" :aria-pressed="runScope === 'attention'" @click="runScope = 'attention'">Due, overdue, failed</button>
              <button type="button" class="bim-chip" :class="{ on: runScope === 'open' }" :aria-pressed="runScope === 'open'" @click="runScope = 'open'">All open sites</button>
            </div>
            <p class="bim-hint">
              Starting from {{ runStart?.from === 'gps' ? 'your GPS position' : 'the map centre' }}.
              Distances are straight-line, not road distance.
              <button v-if="runStart?.from !== 'gps'" type="button" class="bim-link" @click="locateMe().then(openRun)">Use my position</button>
            </p>
            <p v-if="!runLegs.length" class="bim-muted">No positioned sites in this run.</p>
            <ol class="bim-run">
              <li v-for="(leg, i) in runLegs" :key="leg.stop.id">
                <button type="button" class="bim-item" :class="{ selected: leg.stop.id === selectedId }" @click="selectSite(leg.stop.id)">
                  <span class="bim-run-n" :class="`c-${leg.stop.cls}`">{{ i + 1 }}</span>
                  <span class="bim-item-body">
                    <span class="bim-item-top">
                      <span class="bim-ref">{{ leg.stop.site.ref }}</span>
                      <span class="bim-cls">+{{ formatMetres(leg.legM) }}</span>
                    </span>
                    <span class="bim-item-title">{{ leg.stop.site.title }}</span>
                    <span class="bim-item-meta">{{ nextStageFor(leg.stop.site).label }} · {{ formatMetres(leg.cumulativeM) }} total</span>
                  </span>
                </button>
              </li>
            </ol>
          </template>
        </div>
      </component>

      <!-- Map -->
      <div class="bim-map" :class="{ picking: pickMode }">
        <div ref="mapContainer" class="bim-canvas" role="application" aria-label="Inspection site map" />
        <p v-if="mapError" class="bim-map-error" role="alert">{{ mapError }}</p>

        <MapToolbar v-if="mapReady" :map="mapRef" @tool-change="toolActive = $event" />
        <div v-if="mapReady" class="bim-layers"><MapLayerFilters :map="mapRef" /></div>

        <div v-if="pickMode" class="bim-pick" role="status">
          <Crosshair :size="14" aria-hidden="true" /> Click the site position on the map.
          <UiButton size="sm" variant="ghost" @click="cancelPick">Cancel</UiButton>
        </div>

        <div v-if="!isMobile && (identifyPoint)" class="bim-identify">
          <InspectorIdentifyCard :result="identifyResult" :loading="identifyLoading" :error="identifyError"
                                 :point="identifyPoint" :map-feature="mapFeature"
                                 @close="clearIdentify" @open-case="openCaseFromIdentify" />
        </div>

        <div class="bim-legend" :class="{ open: legendOpen }">
          <button type="button" class="bim-legend-toggle" :aria-expanded="legendOpen" @click="legendOpen = !legendOpen">Key</button>
          <ul v-if="legendOpen">
            <li v-for="l in LEGEND" :key="l.key"><span class="bim-dot" :class="`c-${l.key}`" aria-hidden="true" />{{ l.label }}</li>
            <li><span class="bim-sw ring" aria-hidden="true" />Enforcement order position</li>
            <li><span class="bim-sw boundary" aria-hidden="true" />Stand boundary</li>
            <li><span class="bim-sw inside" aria-hidden="true" />Mapped structure on stand</li>
            <li><span class="bim-sw crossing" aria-hidden="true" />Structure crossing boundary</li>
          </ul>
        </div>

        <div class="bim-status" aria-hidden="true">
          <span v-if="cursor">{{ cursor[1].toFixed(5) }}, {{ cursor[0].toFixed(5) }}</span>
          <span>z {{ zoom }}</span>
          <span>{{ counts.positioned }} of {{ counts.total }} sites mapped</span>
        </div>
      </div>

      <!-- Right: selected site -->
      <component :is="rightBinding.is" v-if="isMobile || selected" v-bind="rightBinding.attrs">
        <div class="bim-panel">
          <InspectorIdentifyCard v-if="isMobile && identifyPoint" :result="identifyResult" :loading="identifyLoading"
                                 :error="identifyError" :point="identifyPoint" :map-feature="mapFeature"
                                 @close="clearIdentify(); detailSheetOpen = !!selected" @open-case="openCaseFromIdentify" />

          <template v-else-if="selected">
            <div class="bim-detail-head">
              <div class="bim-detail-titles">
                <span class="bim-ref">{{ selected.ref }}</span>
                <h2>{{ selected.title }}</h2>
              </div>
              <button v-if="!isMobile" type="button" class="bim-icon-btn" @click="clearSelection">
                <X :size="14" aria-hidden="true" /><span class="ent-sr-only">Close site</span>
              </button>
            </div>
            <div class="bim-badges">
              <UiStatusBadge :status="selected.permitStatus" />
              <UiStatusBadge v-if="selectedClass" :tone="selectedClass === 'enforcement' || selectedClass === 'failed' ? 'negative'
                : selectedClass === 'overdue' || selectedClass === 'due' ? 'warning'
                : selectedClass === 'occupied' ? 'info' : 'neutral'" :label="SITE_STATUS_LABELS[selectedClass]" :dot="false" />
            </div>
            <dl class="bim-dl">
              <div><dt>Next</dt><dd>{{ nextStageFor(selected).label }}</dd></div>
              <div><dt>Stand · ward</dt><dd>{{ selected.stand }} · {{ selected.ward }}</dd></div>
              <div><dt>Applicant</dt><dd>{{ selected.applicant }}</dd></div>
              <div><dt>Development</dt><dd>{{ humanize(selected.developmentType) }}</dd></div>
              <div v-if="selected.openEnforcement"><dt>Enforcement</dt><dd class="bad">{{ selected.openEnforcement }} open order{{ selected.openEnforcement === 1 ? '' : 's' }}</dd></div>
              <div v-if="distanceFromMe != null"><dt>From you</dt><dd>{{ formatMetres(distanceFromMe) }} straight line</dd></div>
            </dl>
            <div class="bim-detail-actions">
              <UiButton size="sm" variant="primary" @click="openInConsole">
                <template #icon><LayoutGrid :size="13" /></template>
                Open in console
              </UiButton>
              <button v-if="canNavigate" type="button" class="bim-navlink" @click="navOpen = true">
                <Navigation :size="13" aria-hidden="true" /> Navigate
              </button>
              <span v-else class="bim-navlink is-disabled" aria-disabled="true">
                <Navigation :size="13" aria-hidden="true" /> Navigate
              </span>
            </div>
            <p v-if="canNavigate" class="bim-navhint">
              Turn-by-turn over the council road network, with spoken directions.
              <a class="bim-navext" :href="externalMapHref()!" target="_blank" rel="noopener noreferrer">
                Use an external map instead
              </a>
            </p>

            <InspectorSiteReport
              :permit-id="selected.permitId"
              :reload-key="reportReload"
              :can-record-position="canRecordPosition"
              @loaded="onReportLoaded"
              @record-position="openLocationSheet"
              @open-permit="openCaseFromIdentify"
            />
          </template>

          <p v-else class="bim-muted">Select a site on the map or in the list, or click anywhere to see what is there.</p>
        </div>
      </component>
    </div>

    <SiteNavigation
      v-if="selected && canNavigate"
      v-model:open="navOpen"
      :lat="selected.center![1]"
      :lng="selected.center![0]"
      :stand="selected.stand"
      :ward="selected.ward"
      :reference="selected.ref"
    />

    <InspectorSiteLocationSheet
      v-model:open="locationSheetOpen"
      :permit-id="selected?.permitId ?? null"
      :permit-ref="selected?.ref ?? null"
      :picked-point="pickedPoint"
      :current-center="selected?.center ?? null"
      @start-pick="startPick"
      @saved="onLocationSaved"
    />

    <p class="ent-sr-only" role="status" aria-live="polite">{{ status }}</p>
    <div v-if="status" class="bim-toast" aria-hidden="true">{{ status }}</div>
  </div>
</template>

<style scoped>
.bim {
  display: flex; flex-direction: column; height: var(--ent-vh); overflow: hidden;
  background: var(--ent-canvas); color: var(--ent-text); font-family: var(--ent-font); font-size: var(--ent-fs-sm);
}
.bim.embedded { height: 100%; }

/* ── bar ── */
.bim-bar {
  display: flex; align-items: center; gap: var(--ent-s3); flex-shrink: 0;
  padding: var(--ent-s2) var(--ent-s4); background: var(--ent-surface);
  border-bottom: 1px solid var(--ent-line);
}
.bim-brand { display: flex; align-items: center; gap: var(--ent-s2); }
.bim-logo {
  display: inline-flex; align-items: center; justify-content: center; width: 1.85rem; height: 1.85rem;
  border-radius: var(--ent-r); background: var(--ent-accent); color: var(--ent-text-on-accent);
}
.bim-brand-text { display: flex; flex-direction: column; line-height: 1.2; }
.bim-title { font-weight: var(--ent-fw-bold); }
.bim-sub { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.bim-search {
  flex: 1; min-width: 0; max-width: 26rem; display: flex; align-items: center; gap: var(--ent-s2);
  height: var(--ent-control-h-sm); padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); color: var(--ent-text-3);
}
.bim-search:focus-within { box-shadow: var(--ent-focus-ring); border-color: var(--ent-accent); }
.bim-search input { flex: 1; min-width: 0; border: none; outline: none; background: none; font: inherit; color: var(--ent-text); }
.bim-search--panel { max-width: none; width: 100%; }
.bim-actions { display: flex; align-items: center; gap: var(--ent-s2); margin-left: auto; }

.bim-body { flex: 1; min-height: 0; display: flex; }

/* ── side panels ── */
.bim-left, .bim-right {
  flex-shrink: 0; overflow-y: auto; background: var(--ent-surface);
}
.bim-left { width: 20rem; border-right: 1px solid var(--ent-line); }
.bim-right { width: 24rem; border-left: 1px solid var(--ent-line); }
.bim-panel { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s3); }

.bim-summary { display: flex; flex-wrap: wrap; gap: var(--ent-s1); }
.bim-chip {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  min-height: var(--ent-control-h-sm); padding: 0 var(--ent-s2);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-pill);
  background: var(--ent-surface); color: var(--ent-text-2); font: inherit; font-size: var(--ent-fs-xs); cursor: pointer;
}
.bim-chip.on { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.bim-chip:focus-visible, .bim-item:focus-visible, .bim-icon-btn:focus-visible, .bim-link:focus-visible,
.bim-legend-toggle:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.bim-chip-n { font-variant-numeric: tabular-nums; color: var(--ent-text-3); }
.bim-chip.on .bim-chip-n { color: inherit; }
.bim-scope label { display: flex; align-items: center; gap: var(--ent-s2); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.bim-scope input { accent-color: var(--ent-accent); }

.bim-muted { margin: 0; color: var(--ent-text-3); font-size: var(--ent-fs-xs); }
.bim-hint { margin: 0; padding: var(--ent-s2); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); color: var(--ent-text-2); font-size: var(--ent-fs-xs); }
.bim-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-xs); }
.bim-link { padding: 0; border: none; background: none; font: inherit; color: var(--ent-accent); cursor: pointer; text-decoration: underline; }

.bim-list, .bim-run { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.bim-item {
  display: flex; align-items: flex-start; gap: var(--ent-s2); width: 100%;
  padding: var(--ent-s2); border: 1px solid transparent; border-radius: var(--ent-r-sm);
  background: none; font: inherit; color: inherit; text-align: left; cursor: pointer;
}
.bim-item:hover { background: var(--ent-surface-2); }
.bim-item.selected { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); }
.bim-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.bim-item-top { display: flex; justify-content: space-between; align-items: baseline; gap: var(--ent-s2); min-width: 0; }
.bim-ref { flex-shrink: 0; white-space: nowrap; font-weight: var(--ent-fw-semibold); font-size: var(--ent-fs-xs); font-variant-numeric: tabular-nums; }
.bim-cls { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--ent-fs-micro); color: var(--ent-text-3); white-space: nowrap; }
.bim-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bim-item-meta { font-size: var(--ent-fs-micro); color: var(--ent-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bim-item-warn { font-size: var(--ent-fs-micro); color: var(--ent-tone-warning-fg); }

.bim-dot { display: inline-block; width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; flex-shrink: 0; border: 2px solid var(--ent-surface); box-shadow: 0 0 0 1px var(--ent-line-strong); }
.c-enforcement, .c-failed { background: var(--ent-danger); }
.c-overdue, .c-due { background: var(--ent-warning); }
.c-active { background: var(--ent-success); }
.c-occupied { background: var(--ent-info); }
.c-awaiting { background: var(--ent-text-3); }

.bim-run-head { display: flex; align-items: center; justify-content: space-between; }
.bim-run-n {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 1.4rem; height: 1.4rem; border-radius: 50%; color: var(--ent-text-on-accent);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
}

.bim-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--ent-control-h-sm); height: var(--ent-control-h-sm); flex-shrink: 0;
  border: 1px solid transparent; border-radius: var(--ent-r-sm); background: none; color: var(--ent-text-2); cursor: pointer;
}
.bim-icon-btn:hover { background: var(--ent-surface-2); }

/* ── detail ── */
.bim-detail-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.bim-detail-titles { flex: 1; min-width: 0; }
.bim-detail-titles h2 { margin: 2px 0 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); line-height: var(--ent-lh-tight); overflow-wrap: anywhere; }
.bim-badges { display: flex; flex-wrap: wrap; gap: var(--ent-s1); }
.bim-dl { margin: 0; display: grid; gap: var(--ent-s1); }
.bim-dl > div { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: var(--ent-s2); }
.bim-dl dt { color: var(--ent-text-3); }
.bim-dl dd { margin: 0; overflow-wrap: anywhere; }
.bim-dl dd.bad { color: var(--ent-danger); font-weight: var(--ent-fw-semibold); }
.bim-navlink {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
  min-height: var(--ent-control-h-sm); padding: 0 var(--ent-control-px, 0.75rem);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  background: var(--ent-surface); color: var(--ent-text);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold);
  text-decoration: none; cursor: pointer;
}
.bim-navhint { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.bim-navext { color: var(--ent-accent); }
.bim-navlink:hover { background: var(--ent-surface-2); }
.bim-navlink:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.bim-navlink.is-disabled { opacity: 0.5; cursor: not-allowed; }
.bim-detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s2); padding-bottom: var(--ent-s3); border-bottom: 1px solid var(--ent-line); }

/* ── map ── */
.bim-map { position: relative; flex: 1; min-width: 0; }
.bim-canvas { position: absolute; inset: 0; }
.bim-map-error {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); max-width: 22rem; margin: 0;
  padding: var(--ent-s3) var(--ent-s4); background: var(--ent-surface); border: 1px solid var(--ent-danger);
  border-radius: var(--ent-r); color: var(--ent-text); text-align: center;
}
.bim-layers { position: absolute; top: 16px; right: 16px; z-index: 5; }
.bim-identify {
  position: absolute; top: 64px; right: 16px; z-index: 6; width: 22rem; max-height: calc(100% - 140px); overflow-y: auto;
  padding: var(--ent-s3); background: var(--ent-map-panel-bg, var(--ent-surface));
  border: 1px solid var(--ent-map-panel-line, var(--ent-line)); border-radius: var(--ent-r);
  box-shadow: var(--ent-map-panel-shadow, var(--ent-e2));
}
.bim-pick {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 7;
  display: flex; align-items: center; gap: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3);
  background: var(--ent-surface); border: 1px solid var(--ent-accent-line); border-radius: var(--ent-r-pill);
  box-shadow: var(--ent-e2); white-space: nowrap;
}
.bim-map.picking .bim-canvas :deep(canvas) { cursor: crosshair; }
.bim-legend {
  position: absolute; left: 16px; bottom: 36px; z-index: 5; max-width: 15rem;
  background: var(--ent-map-panel-bg, var(--ent-surface)); border: 1px solid var(--ent-map-panel-line, var(--ent-line));
  border-radius: var(--ent-r); box-shadow: var(--ent-map-panel-shadow, var(--ent-e1)); font-size: var(--ent-fs-xs);
}
.bim-legend-toggle {
  width: 100%; padding: var(--ent-s1) var(--ent-s3); border: none; background: none; text-align: left;
  font: inherit; font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); cursor: pointer;
}
.bim-legend ul { margin: 0; padding: 0 var(--ent-s3) var(--ent-s2); list-style: none; display: flex; flex-direction: column; gap: 3px; }
.bim-legend li { display: flex; align-items: center; gap: var(--ent-s2); color: var(--ent-text-2); }
.bim-legend .bim-dot { margin-top: 0; }
.bim-sw { display: inline-block; width: 12px; height: 12px; flex-shrink: 0; border-radius: 2px; }
.bim-sw.ring { border-radius: 50%; border: 2.5px solid var(--ent-danger); }
.bim-sw.boundary { border: 1.5px solid var(--ent-accent); background: var(--ent-accent-soft); }
.bim-sw.inside { background: var(--ent-success); opacity: 0.6; }
.bim-sw.crossing { background: var(--ent-warning); opacity: 0.6; }
.bim-status {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
  display: flex; gap: var(--ent-s4); padding: 3px var(--ent-s3);
  background: color-mix(in srgb, var(--ent-surface) 85%, transparent);
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); font-variant-numeric: tabular-nums;
}
.bim-toast {
  position: absolute; left: 50%; bottom: 3rem; transform: translateX(-50%); z-index: var(--ent-z-toast, 60);
  max-width: min(28rem, calc(100% - 2rem)); padding: var(--ent-s2) var(--ent-s4);
  background: var(--ent-text); color: var(--ent-surface); border-radius: var(--ent-r); box-shadow: var(--ent-e3);
  font-size: var(--ent-fs-xs); pointer-events: none;
}
.bim :deep(.maplibregl-ctrl-bottom-right) { bottom: 22px; }

.spin { animation: bim-spin 0.9s linear infinite; }
@keyframes bim-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

@media (max-width: 1279px) {
  .bim-left { width: 17rem; }
  .bim-right { width: 21rem; }
}
@media (max-width: 767px) {
  .bim-bar { padding: var(--ent-s2); gap: var(--ent-s2); }
  .bim-search { max-width: none; }
  .bim-legend { bottom: 28px; }
  .bim-status span:first-child { display: none; }
  .bim-pick { white-space: normal; width: calc(100% - 2rem); }
}
</style>
