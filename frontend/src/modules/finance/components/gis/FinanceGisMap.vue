<script setup lang="ts">
/**
 * The finance GIS: the council's parcels from the Planning register, coloured by their financial
 * standing, beside the figures, the search and the filters that drive them.
 *
 *   LEFT   KPIs, property search (stand, account, customer, ward, national ID with permission),
 *          status filters, revenue and debt by ward (click a ward to zoom and filter).
 *   MAP    parcel polygons (Planning's exact boundaries), ward and township outlines, planning
 *          zones, located capital projects, the basemap roads; a layer control and a legend that
 *          keeps geographic features apart from financial statuses.
 *   RIGHT  the property's financial profile when a parcel is clicked (shift-click adds to a
 *          multi-selection instead).
 *
 * One component for every finance workspace; `mode` decides the default colouring, the layers on
 * at first, and the actions (a cashier takes payment, the publisher sees no names). Nothing here
 * computes a balance: every figure is a string from SQL, formatted.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import {
  Search, Layers, X, MapPin, Loader2, AlertTriangle, Maximize2, Home, ListChecks, Download, Info, Map as MapIcon,
  Wallet, CircleAlert, Users, PlugZap, Crosshair, ChevronRight, MousePointerClick,
} from 'lucide-vue-next'
import { addVunguBasemap, prefersReducedMotion, setBasemapLayerVisible, watchWebglContext } from '@/map/vunguBasemap'
import { baseMapStyle } from '@/map/vunguBasemapStyle'
import { formatMoney } from '../../composables/useMoney'
import { messageOf, useFinanceStore } from '../../stores/finance'
import PropertyProfilePanel from './PropertyProfilePanel.vue'
import {
  propertyApi, STATUS_COLOURS, STATUS_LABELS, STATUS_ORDER, LAND_USE_COLOURS, LAND_USE_LABELS,
  type FeatureCollection, type MapFeatureProps, type PropertyLayers, type PropertyAnalytics, type PropertyProfile,
  type PropertyRow, type FinancialStatus, type LandUseClass,
} from '../../api/propertyApi'

const props = withDefaults(defineProps<{
  mode?: string
  /** Embedded in a dashboard: shorter, no profile drawer width taken until a parcel is chosen. */
  compact?: boolean
  height?: string
  /** Open this parcel's profile on arrival (a deep link from another page). */
  initialParcel?: string | null
  /** Run this search on arrival (the cashier dashboard's finder). */
  initialQuery?: string | null
}>(), { mode: 'manager', compact: false, height: '', initialParcel: null, initialQuery: null })

const emit = defineEmits<{ select: [parcelId: string | null]; analytics: [a: PropertyAnalytics] }>()
const store = useFinanceStore()

type ColourBy = 'status' | 'land_use' | 'ward_collected' | 'ward_outstanding' | 'ward_rate'
const DEFAULT_COLOUR: Record<string, ColourBy> = {
  budget: 'land_use', department: 'land_use', executive: 'ward_collected', committee: 'ward_collected', publisher: 'ward_collected',
}
const colourBy = ref<ColourBy>(DEFAULT_COLOUR[props.mode] ?? 'status')
const anonymous = computed(() => props.mode === 'publisher')
const canPay = computed(() => store.can('finance.rates.receipt.record') && store.can('finance.cash.receipt.record'))

// ── Data ──────────────────────────────────────────────────────────────────────────────────────
const parcels = shallowRef<FeatureCollection<MapFeatureProps> | null>(null)
const layers = shallowRef<PropertyLayers | null>(null)
const analytics = shallowRef<PropertyAnalytics | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [fc, ly, an] = await Promise.all([propertyApi.map('all'), propertyApi.layers(), propertyApi.analytics()])
    parcels.value = fc
    layers.value = ly
    analytics.value = an
    emit('analytics', an)
    paintAll()
  } catch (e) {
    error.value = messageOf(e, 'The property map could not be read.')
  } finally {
    loading.value = false
  }
}

/** After a payment or an integration run: re-read the figures without moving the camera. */
async function refresh(): Promise<void> {
  try {
    const [fc, an] = await Promise.all([propertyApi.map('all'), propertyApi.analytics()])
    parcels.value = fc
    analytics.value = an
    emit('analytics', an)
    paintAll()
    if (selectedId.value) await openProfile(selectedId.value, false)
  } catch (e) {
    error.value = messageOf(e, 'The property map could not be refreshed.')
  }
}
defineExpose({ refresh, focusParcel: (id: string) => openProfile(id, true), zoomWard: (code: string) => { wardFilter.value = null; zoomWard(code) } })

// ── Filters and layers ────────────────────────────────────────────────────────────────────────
const landUses = reactive<Record<LandUseClass, boolean>>({
  residential: true, commercial: true, industrial: true, institutional: true, council: true, agricultural: true, other: true,
})
const statuses = reactive<Record<FinancialStatus, boolean>>({
  overdue: true, awaiting_payment: true, partially_paid: true, paid_up: true, not_billed: true,
  allocated_no_account: true, unallocated: true, no_account: true, cancelled: true,
})
const overlays = reactive({
  wards: true,
  townships: true,
  zones: false,
  projects: ['budget', 'department', 'executive', 'committee', 'manager'].includes(props.mode),
  roads: true,
})
const wardFilter = ref<string | null>(null)
const layerPanelOpen = ref(false)

/** Status shortcuts, as a revenue officer asks for them. */
const PRESETS: { id: string; label: string; set: FinancialStatus[] }[] = [
  { id: 'all', label: 'All', set: STATUS_ORDER },
  { id: 'owing', label: 'Owing', set: ['overdue', 'awaiting_payment', 'partially_paid'] },
  { id: 'overdue', label: 'Overdue', set: ['overdue'] },
  { id: 'paid', label: 'Paid up', set: ['paid_up'] },
  { id: 'unbilled', label: 'Unbilled', set: ['not_billed', 'allocated_no_account'] },
  { id: 'allocated', label: 'Allocated', set: ['overdue', 'awaiting_payment', 'partially_paid', 'paid_up', 'not_billed', 'allocated_no_account'] },
]
const preset = ref('all')
function applyPreset(id: string): void {
  preset.value = id
  const set = PRESETS.find((p) => p.id === id)?.set ?? STATUS_ORDER
  for (const s of STATUS_ORDER) statuses[s] = set.includes(s)
}

const statusCounts = computed(() => {
  const c: Partial<Record<FinancialStatus, number>> = {}
  for (const f of parcels.value?.features ?? []) c[f.properties.status] = (c[f.properties.status] ?? 0) + 1
  return c
})
const pendingCount = computed(() => (parcels.value?.features ?? []).filter((f) => f.properties.pending).length)
const landUseCounts = computed(() => {
  const c: Partial<Record<LandUseClass, number>> = {}
  for (const f of parcels.value?.features ?? []) c[f.properties.land_use_class] = (c[f.properties.land_use_class] ?? 0) + 1
  return c
})

// ── Map ───────────────────────────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLDivElement | null>(null)
let map: maplibregl.Map | null = null
let hoverPopup: maplibregl.Popup | null = null
let stopWebgl: (() => void) | null = null
const mapReady = ref(false)
let boundsSet = false
const P_SRC = 'fg-parcels'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function statusColourExpr(): unknown {
  return ['match', ['get', 'status'], ...STATUS_ORDER.flatMap((s) => [s, STATUS_COLOURS[s]]), '#cfd5dc']
}
function landUseColourExpr(): unknown {
  return ['match', ['get', 'land_use_class'], ...(Object.keys(LAND_USE_COLOURS) as LandUseClass[]).flatMap((k) => [k, LAND_USE_COLOURS[k]]), '#cfd5dc']
}

const WARD_RAMP = ['#eef4fb', '#c9dcf1', '#93badf', '#5a92c8', '#2a66a8', '#123f74']
const DEBT_RAMP = ['#fdf0ec', '#f9cdbf', '#f19d86', '#e2684f', '#c43b2b', '#8c1d17']
function wardValue(code: string | null | undefined, by: ColourBy): number | null {
  const w = analytics.value?.by_ward.find((x) => x.ward_code === code)
  if (!w) return null
  if (by === 'ward_collected') return Number(w.usd_paid)
  if (by === 'ward_outstanding') return Number(w.usd_outstanding)
  if (by === 'ward_rate') return w.usd_collection_rate === null ? null : Number(w.usd_collection_rate)
  return null
}
const wardBreaks = computed(() => {
  const vals = (layers.value?.wards.features ?? []).map((f) => wardValue(f.properties.ward_code, colourBy.value)).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)
  if (vals.length < 2) return vals.length ? [vals[0]] : []
  const n = Math.min(5, vals.length)
  return Array.from({ length: n }, (_, i) => vals[Math.floor((i * (vals.length - 1)) / Math.max(1, n - 1))])
})
const wardChoropleth = computed(() => colourBy.value.startsWith('ward_'))

function wardsData(): FeatureCollection {
  const by = colourBy.value
  return {
    type: 'FeatureCollection',
    features: (layers.value?.wards.features ?? []).map((f) => {
      const v = wardValue(f.properties.ward_code, by)
      const breaks = wardBreaks.value
      const idx = v === null || v <= 0 ? -1 : breaks.filter((b) => v >= b).length
      const ramp = by === 'ward_outstanding' ? DEBT_RAMP : WARD_RAMP
      return { ...f, properties: { ...f.properties, label: `Ward ${f.properties.name}`, fill: idx < 0 ? '#f2f2f2' : ramp[Math.min(idx, ramp.length - 1)], value: v } }
    }),
  }
}

/** One label point per township: the centre of its stands' extent (the outline has many parts). */
function townshipPoints(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (layers.value?.townships.features ?? []).map((f) => {
      const b = bboxOf([f])
      return { type: 'Feature', geometry: { type: 'Point', coordinates: b ? [(b[0] + b[2]) / 2, b[3]] : [0, 0] }, properties: { township: f.properties.township, stands: f.properties.stands } }
    }) as FeatureCollection['features'],
  }
}

function parcelFilter(): unknown {
  const lu = (Object.keys(landUses) as LandUseClass[]).filter((k) => landUses[k])
  const st = STATUS_ORDER.filter((s) => statuses[s])
  const f: unknown[] = ['all', ['in', ['get', 'land_use_class'], ['literal', lu]], ['in', ['get', 'status'], ['literal', st]]]
  if (wardFilter.value) f.push(['==', ['get', 'ward_code'], wardFilter.value])
  return f
}

const selection = ref<string[]>([])
const selectedId = ref<string | null>(null)

function paintAll(): void {
  if (!map || !mapReady.value) return
  const src = map.getSource(P_SRC) as maplibregl.GeoJSONSource | undefined
  src?.setData((parcels.value ?? EMPTY) as never)
  ;(map.getSource('fg-wards') as maplibregl.GeoJSONSource | undefined)?.setData(wardsData() as never)
  const council = layers.value?.council
  ;(map.getSource('fg-council') as maplibregl.GeoJSONSource | undefined)?.setData((council
    ? { type: 'Feature', geometry: council.boundary, properties: { name: council.name } } : EMPTY) as never)
  ;(map.getSource('fg-outside') as maplibregl.GeoJSONSource | undefined)?.setData((council
    ? { type: 'Feature', geometry: council.outside, properties: {} } : EMPTY) as never)
  if (council && !boundsSet) {
    boundsSet = true
    const [x0, y0, x1, y1] = council.bbox
    map.setMaxBounds([[x0 - 0.6, y0 - 0.45], [x1 + 0.6, y1 + 0.45]])
  }
  ;(map.getSource('fg-townships') as maplibregl.GeoJSONSource | undefined)?.setData((layers.value?.townships ?? EMPTY) as never)
  ;(map.getSource('fg-town-pts') as maplibregl.GeoJSONSource | undefined)?.setData(townshipPoints() as never)
  ;(map.getSource('fg-zones') as maplibregl.GeoJSONSource | undefined)?.setData((layers.value?.zones ?? EMPTY) as never)
  ;(map.getSource('fg-projects') as maplibregl.GeoJSONSource | undefined)?.setData((layers.value?.projects ?? EMPTY) as never)
  restyle()
}

function restyle(): void {
  if (!map || !mapReady.value) return
  const colour = colourBy.value === 'land_use' ? landUseColourExpr() : statusColourExpr()
  map.setPaintProperty('fg-parcel-fill', 'fill-color', colour as never)
  map.setPaintProperty('fg-parcel-fill', 'fill-opacity', (wardChoropleth.value ? 0.25 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.78]) as never)
  map.setFilter('fg-parcel-fill', parcelFilter() as never)
  map.setFilter('fg-parcel-line', parcelFilter() as never)
  map.setFilter('fg-parcel-sel', ['in', ['get', 'parcel_id'], ['literal', selection.value.length ? selection.value : selectedId.value ? [selectedId.value] : []]] as never)
  ;(map.getSource('fg-wards') as maplibregl.GeoJSONSource | undefined)?.setData(wardsData() as never)
  map.setPaintProperty('fg-ward-fill', 'fill-opacity', wardChoropleth.value ? 0.72 : 0)
  const vis = (id: string, on: boolean) => { if (map!.getLayer(id)) map!.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') }
  vis('fg-ward-fill', overlays.wards || wardChoropleth.value)
  vis('fg-ward-line', overlays.wards || wardChoropleth.value)
  vis('fg-ward-label', overlays.wards || wardChoropleth.value)
  vis('fg-town-line', overlays.townships)
  vis('fg-town-label', overlays.townships)
  vis('fg-zone-fill', overlays.zones)
  vis('fg-zone-line', overlays.zones)
  vis('fg-proj-circle', overlays.projects)
  vis('fg-proj-label', overlays.projects)
  try { setBasemapLayerVisible(map, 'roads', overlays.roads) } catch { /* the basemap may not carry roads */ }
}

watch([colourBy, wardFilter, () => ({ ...landUses }), () => ({ ...statuses }), () => ({ ...overlays }), selection, selectedId], restyle, { deep: true })

function fitTo(bbox: [number, number, number, number], maxZoom = 18): void {
  map?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom, duration: prefersReducedMotion() ? 0 : 900 })
}
function bboxOf(features: { geometry: GeoJSON.Geometry }[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[]
      b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  for (const f of features) walk((f.geometry as { coordinates?: unknown }).coordinates)
  return b
}
function zoomTownship(code = 'HERTS'): void {
  const f = (parcels.value?.features ?? []).filter((x) => x.properties.township === code)
  const b = bboxOf(f)
  if (b) fitTo(b, 16)
}
function zoomDistrict(): void {
  const b = layers.value?.council?.bbox ?? bboxOf(layers.value?.wards.features ?? [])
  if (b) fitTo(b, 11)
}
function zoomWard(code: string | null): void {
  wardFilter.value = wardFilter.value === code ? null : code
  const w = layers.value?.wards.features.find((x) => x.properties.ward_code === code)
  if (wardFilter.value && w) { const b = bboxOf([w]); if (b) fitTo(b, 15) }
}

function initMap(): void {
  if (!mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: baseMapStyle(),
    center: [29.7954, -19.3763],
    zoom: props.mode === 'cashier' || props.compact ? 14 : 10,
    attributionControl: { compact: true },
    preserveDrawingBuffer: true,
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right')
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
  stopWebgl = watchWebglContext(map, { onLost: () => { error.value = 'The map lost its graphics context. Reload the page to redraw it.' } })
  map.on('load', async () => {
    // The finance overlays first, then the basemap beneath them (beforeId).
    map!.addSource('fg-council', { type: 'geojson', data: EMPTY as never })
    map!.addSource('fg-outside', { type: 'geojson', data: EMPTY as never })
    map!.addSource('fg-wards', { type: 'geojson', data: EMPTY as never })
    map!.addSource('fg-zones', { type: 'geojson', data: EMPTY as never })
    map!.addSource('fg-townships', { type: 'geojson', data: EMPTY as never })
    map!.addSource(P_SRC, { type: 'geojson', data: EMPTY as never, promoteId: 'parcel_id' })
    map!.addSource('fg-projects', { type: 'geojson', data: EMPTY as never })
    map!.addSource('fg-town-pts', { type: 'geojson', data: EMPTY as never })
    map!.addLayer({ id: 'fg-ward-fill', type: 'fill', source: 'fg-wards', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0 } })
    map!.addLayer({ id: 'fg-zone-fill', type: 'fill', source: 'fg-zones', layout: { visibility: 'none' },
      paint: { 'fill-color': ['coalesce', ['get', 'color'], '#a5b4c8'], 'fill-opacity': 0.22 } })
    map!.addLayer({ id: 'fg-zone-line', type: 'line', source: 'fg-zones', layout: { visibility: 'none' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#7b8aa0'], 'line-width': 1 } })
    map!.addLayer({ id: 'fg-parcel-fill', type: 'fill', source: P_SRC, paint: { 'fill-color': statusColourExpr() as never, 'fill-opacity': 0.78 } })
    map!.addLayer({ id: 'fg-parcel-line', type: 'line', source: P_SRC,
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.2, 16, 1.2] as never, 'line-opacity': 0.9 } })
    // A payment receipted and waiting for the accountant: a dashed blue ring, over the status colour.
    map!.addLayer({ id: 'fg-parcel-pending', type: 'line', source: P_SRC, filter: ['==', ['get', 'pending'], true] as never,
      paint: { 'line-color': '#1559b3', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 17, 3] as never, 'line-dasharray': [2, 1.2] } })
    map!.addLayer({ id: 'fg-parcel-sel', type: 'line', source: P_SRC, filter: ['in', ['get', 'parcel_id'], ['literal', []]] as never,
      paint: { 'line-color': '#0b2f63', 'line-width': 3.2 } })
    // Outside Vungu RDC: muted, so the council's own area reads as the subject of the map.
    map!.addLayer({ id: 'fg-outside', type: 'fill', source: 'fg-outside', paint: { 'fill-color': '#eef0f3', 'fill-opacity': 0.82 } })
    map!.addLayer({ id: 'fg-council-line', type: 'line', source: 'fg-council',
      paint: { 'line-color': '#0f2c52', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 3.5] as never, 'line-opacity': 0.9 } })
    map!.addLayer({ id: 'fg-ward-line', type: 'line', source: 'fg-wards',
      paint: { 'line-color': '#24476f', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } })
    map!.addLayer({ id: 'fg-town-line', type: 'line', source: 'fg-townships',
      paint: { 'line-color': '#5b3a8c', 'line-width': 2, 'line-opacity': 0.75 } })
    map!.addLayer({ id: 'fg-proj-circle', type: 'circle', source: 'fg-projects',
      paint: { 'circle-radius': 8, 'circle-color': '#0f766e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } })
    map!.addLayer({ id: 'fg-ward-label', type: 'symbol', source: 'fg-wards', maxzoom: 14.5,
      layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'symbol-placement': 'point' },
      paint: { 'text-color': '#1d3a5f', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 } })
    map!.addLayer({ id: 'fg-town-label', type: 'symbol', source: 'fg-town-pts', minzoom: 11,
      layout: { 'text-field': ['concat', ['get', 'township'], ' township · ', ['to-string', ['get', 'stands']], ' stands'], 'text-size': 12.5, 'text-font': ['Noto Sans Bold'], 'text-anchor': 'bottom', 'text-offset': [0, -0.4] },
      paint: { 'text-color': '#4a2f75', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } })
    map!.addLayer({ id: 'fg-proj-label', type: 'symbol', source: 'fg-projects', minzoom: 9,
      layout: { 'text-field': ['get', 'name'], 'text-size': 11.5, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-max-width': 12 },
      paint: { 'text-color': '#0f5f58', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } })
    mapReady.value = true
    paintAll()
    // The council's basemap beneath: roads and water orient the reader; the rest stays off.
    void addVunguBasemap(map!, {
      defaultVisible: new Set(['country', 'roads', 'water_areas']),
      interactive: false, autoTilt: false, beforeId: 'fg-ward-fill',
    }).then(() => restyle()).catch(() => { /* the finance layers stand on their own */ })
    if (props.initialParcel) void openProfile(props.initialParcel, true)
    else if (props.mode === 'cashier' || props.compact || props.mode === 'revenue' || props.mode === 'manager' || props.mode === 'accountant' || props.mode === 'audit') zoomTownship()
    else zoomDistrict()
  })

  let hovered: string | number | null = null
  map.on('mousemove', 'fg-parcel-fill', (e) => {
    const f = e.features?.[0]
    if (!f || !map) return
    map.getCanvas().style.cursor = 'pointer'
    if (hovered !== null) map.setFeatureState({ source: P_SRC, id: hovered }, { hover: false })
    hovered = f.id ?? null
    if (hovered !== null) map.setFeatureState({ source: P_SRC, id: hovered }, { hover: true })
    const p = f.properties as unknown as MapFeatureProps
    const bal = (Number(p.usd_balance) > 0 ? `<br><b>${formatMoney(p.usd_balance, 'USD')}</b> outstanding` : '')
      + (p.pending ? '<br><span style="color:#1559b3">Payment awaiting posting</span>' : '')
    const who = !anonymous.value && p.party_name ? `<br>${escapeHtml(p.party_name)}` : ''
    hoverPopup ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'fg-hover' })
    hoverPopup.setLngLat(e.lngLat).setHTML(
      `<strong>${p.kind === 'stand' ? `Stand ${escapeHtml(p.stand_no)}` : escapeHtml(p.stand_no)}</strong>${p.township ? ` · ${escapeHtml(p.township)}` : ''}`
      + `<br><span style="color:${STATUS_COLOURS[p.status]}">●</span> ${escapeHtml(p.status_label)}${who}${bal}`).addTo(map)
  })
  map.on('mouseleave', 'fg-parcel-fill', () => {
    if (!map) return
    map.getCanvas().style.cursor = ''
    if (hovered !== null) map.setFeatureState({ source: P_SRC, id: hovered }, { hover: false })
    hovered = null
    hoverPopup?.remove()
  })
  map.on('click', 'fg-parcel-fill', (e) => {
    const f = e.features?.[0]
    const id = (f?.properties as { parcel_id?: string } | undefined)?.parcel_id
    if (!id) return
    if (e.originalEvent.shiftKey || multiMode.value) {
      selection.value = selection.value.includes(id) ? selection.value.filter((x) => x !== id) : [...selection.value, id]
      return
    }
    void openProfile(id, false)
  })
  map.on('click', 'fg-proj-circle', (e) => {
    const p = e.features?.[0]?.properties as Record<string, string> | undefined
    if (!p || !map) return
    new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(
      `<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.reference)} · ${escapeHtml(p.status.replace('_', ' '))}`
      + `<br>Approved budget ${formatMoney(p.approved_budget, p.currency as 'USD')}${p.progress ? `<br>Physical progress ${escapeHtml(p.progress)}%` : ''}`).addTo(map)
  })
  map.on('mouseenter', 'fg-proj-circle', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'fg-proj-circle', () => { if (map) map.getCanvas().style.cursor = '' })
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// ── Profile ───────────────────────────────────────────────────────────────────────────────────
const profile = ref<PropertyProfile | null>(null)
const profileLoading = ref(false)
const profileError = ref<string | null>(null)
let profileSeq = 0
async function openProfile(id: string, zoom: boolean): Promise<void> {
  selectedId.value = id
  emit('select', id)
  const seq = ++profileSeq
  profileLoading.value = true
  profileError.value = null
  if (profile.value?.property.parcel_id !== id) profile.value = null
  try {
    const p = await propertyApi.profile(id)
    if (seq !== profileSeq) return
    profile.value = p
    if (zoom) fitTo(p.bbox, p.property.parcel_kind === 'stand' ? 18 : 14)
  } catch (e) {
    if (seq === profileSeq) profileError.value = messageOf(e, 'The property could not be read.')
  } finally {
    if (seq === profileSeq) profileLoading.value = false
  }
}
function closeProfile(): void {
  selectedId.value = null
  profile.value = null
  emit('select', null)
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────
const q = ref('')
const results = ref<PropertyRow[]>([])
const searching = ref(false)
const searched = ref(false)
const searchError = ref<string | null>(null)
const identitySearch = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
async function runSearch(): Promise<void> {
  const term = q.value.trim()
  if (!term) { results.value = []; searched.value = false; return }
  searching.value = true
  searchError.value = null
  try {
    const r = await propertyApi.search(term)
    results.value = r.results
    identitySearch.value = r.identity_search
    searched.value = true
    const exact = r.results.find((x) => [x.stand_no, x.account_no, x.parcel_id, x.allocation_reference].some((v) => v && v.toUpperCase() === term.toUpperCase()))
    if (r.results.length === 1 || exact) void openProfile((exact ?? r.results[0]).parcel_id, true)
  } catch (e) {
    searchError.value = messageOf(e, 'The search could not be run.')
  } finally {
    searching.value = false
  }
}
watch(q, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { if (q.value.trim().length >= 2) void runSearch() }, 350)
})
function pick(r: PropertyRow): void { void openProfile(r.parcel_id, true) }
function clearSearch(): void { q.value = ''; results.value = []; searched.value = false }

// ── Multi-selection ──────────────────────────────────────────────────────────────────────────
const multiMode = ref(false)
const selectedFeatures = computed(() => (parcels.value?.features ?? []).filter((f) => selection.value.includes(f.properties.parcel_id)).map((f) => f.properties))
const selectionTotal = computed(() => selectedFeatures.value.reduce((s, f) => s + Math.round(Math.max(0, Number(f.usd_balance)) * 100), 0))
function exportSelection(): void {
  const rows = [['Parcel', 'Stand', 'Township', 'Ward', 'Land use', 'Account', ...(anonymous.value ? [] : ['Account holder']), 'Status', 'USD balance']]
  for (const f of selectedFeatures.value) rows.push([f.parcel_id, f.stand_no, f.township ?? '', f.ward_name ?? '', f.land_use ?? '', f.account_no ?? '', ...(anonymous.value ? [] : [f.party_name ?? '']), f.status_label, f.usd_balance])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }))
  a.download = 'selected-properties.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── KPIs and ward list ───────────────────────────────────────────────────────────────────────
const t = computed(() => analytics.value?.totals)
const money = (v: string | null | undefined) => formatMoney(v, 'USD', { whole: true })
const wardRows = computed(() => (analytics.value?.by_ward ?? []).filter((w) => w.ward_code && (Number(w.usd_billed) > 0 || w.stands > 0))
  .sort((a, b) => Number(b.usd_paid) - Number(a.usd_paid)))
const wardMax = computed(() => Math.max(1, ...wardRows.value.map((w) => Number(w.usd_billed))))

const legend = computed(() => {
  if (colourBy.value === 'land_use') {
    return (Object.keys(LAND_USE_COLOURS) as LandUseClass[]).filter((k) => landUseCounts.value[k]).map((k) => ({ colour: LAND_USE_COLOURS[k], label: LAND_USE_LABELS[k], n: landUseCounts.value[k] ?? 0 }))
  }
  if (wardChoropleth.value) {
    const ramp = colourBy.value === 'ward_outstanding' ? DEBT_RAMP : WARD_RAMP
    const fmt = (v: number) => (colourBy.value === 'ward_rate' ? `${v.toFixed(0)}%` : formatMoney(v.toFixed(2), 'USD', { whole: true }))
    return [{ colour: '#f2f2f2', label: 'No figure', n: null as number | null },
      ...wardBreaks.value.map((b, i) => ({ colour: ramp[Math.min(i + 1, ramp.length - 1)], label: `${fmt(b)} and over`, n: null as number | null }))]
  }
  return STATUS_ORDER.filter((s) => statusCounts.value[s]).map((s) => ({ colour: STATUS_COLOURS[s], label: STATUS_LABELS[s], n: statusCounts.value[s] ?? 0 }))
})
const COLOUR_OPTIONS: { id: ColourBy; label: string }[] = [
  { id: 'status', label: 'Financial status' },
  { id: 'land_use', label: 'Land use' },
  { id: 'ward_collected', label: 'Ward: revenue collected' },
  { id: 'ward_outstanding', label: 'Ward: outstanding debt' },
  { id: 'ward_rate', label: 'Ward: collection rate' },
]

onMounted(async () => {
  await nextTick()
  initMap()
  if (props.initialQuery) { q.value = props.initialQuery; void runSearch() }
  await loadAll()
})
onBeforeUnmount(() => {
  stopWebgl?.()
  hoverPopup?.remove()
  map?.remove()
  map = null
  if (searchTimer) clearTimeout(searchTimer)
})
watch(() => props.initialParcel, (id) => { if (id && mapReady.value) void openProfile(id, true) })
</script>

<template>
  <div class="fg" :class="{ 'fg--compact': compact, 'fg--profile': !!selectedId }" :style="height ? { '--fg-h': height } : undefined">
    <!-- ════ LEFT PANEL ════ -->
    <section class="fg-left" aria-label="Property search and figures">
      <form class="fg-search" role="search" @submit.prevent="runSearch">
        <Search :size="17" aria-hidden="true" class="fg-search-icon" />
        <label class="sr-only" for="fg-q">Search properties</label>
        <input id="fg-q" v-model="q" type="text" enterkeyhint="search" autocomplete="off"
          :placeholder="mode === 'cashier' ? 'Stand no., account, customer or ID number' : 'Stand, account, customer, ward or suburb'" />
        <button v-if="q" type="button" class="fg-search-clear" aria-label="Clear search" @click="clearSearch"><X :size="15" /></button>
      </form>
      <div v-if="searched || searching || searchError" class="fg-results" aria-live="polite">
        <p v-if="searching" class="fg-muted"><Loader2 :size="14" class="spin" aria-hidden="true" /> Searching…</p>
        <p v-else-if="searchError" class="fg-err">{{ searchError }}</p>
        <p v-else-if="!results.length" class="fg-muted">No property matches “{{ q }}”.</p>
        <ul v-else>
          <li v-for="r in results" :key="r.parcel_id">
            <button type="button" class="fg-result" :class="{ on: selectedId === r.parcel_id }" @click="pick(r)">
              <span class="fg-swatch" :style="{ background: STATUS_COLOURS[r.financial_status] }" aria-hidden="true" />
              <span class="fg-result-main">
                <strong>{{ r.parcel_kind === 'stand' ? `Stand ${r.stand_no}` : r.stand_no }}<small v-if="r.township_code"> · {{ r.township_code }}</small></strong>
                <small>{{ r.account_no ?? 'No account' }}<template v-if="!anonymous && (r.party_name || r.allottee_name)"> · {{ r.party_name || r.allottee_name }}</template></small>
              </span>
              <span class="fg-result-bal num" :class="{ neg: Number(r.usd_balance) > 0 }">{{ Number(r.usd_balance) > 0 ? money(r.usd_balance) : r.financial_status === 'paid_up' ? 'Paid' : '' }}</span>
            </button>
          </li>
        </ul>
        <p v-if="results.length && identitySearch && mode === 'cashier'" class="fg-hint">National ID numbers are searched for your role.</p>
      </div>

      <div class="fg-kpis" :aria-busy="loading">
        <div class="fg-kpi"><span><Wallet :size="15" aria-hidden="true" /> Collected</span><strong class="num">{{ money(t?.usd_paid) }}</strong><small>of {{ money(t?.usd_billed) }} billed · {{ t?.usd_collection_rate ?? '—' }}%</small></div>
        <div class="fg-kpi fg-kpi--neg"><span><CircleAlert :size="15" aria-hidden="true" /> Outstanding</span><strong class="num">{{ money(t?.usd_outstanding) }}</strong><small>{{ money(t?.usd_overdue) }} overdue</small></div>
        <div class="fg-kpi"><span><MapPin :size="15" aria-hidden="true" /> Allocated stands</span><strong class="num">{{ t?.allocated ?? '—' }}</strong><small>{{ t?.allocated_not_paid_up ?? 0 }} not fully paid</small></div>
        <div class="fg-kpi fg-kpi--warn"><span><PlugZap :size="15" aria-hidden="true" /> Not yet billed</span><strong class="num">{{ (t?.not_billed ?? 0) + (t?.allocated_no_account ?? 0) }}</strong><small>{{ t?.allocated_no_account ?? 0 }} with no account</small></div>
      </div>

      <div class="fg-block">
        <h4>Show</h4>
        <div class="fg-presets" role="group" aria-label="Status filter">
          <button v-for="p in PRESETS" :key="p.id" type="button" :aria-pressed="preset === p.id" :class="{ on: preset === p.id }" @click="applyPreset(p.id)">{{ p.label }}</button>
        </div>
        <p v-if="wardFilter" class="fg-chipline">Ward {{ analytics?.by_ward.find((w) => w.ward_code === wardFilter)?.ward_name }} only
          <button type="button" class="fg-link" @click="wardFilter = null">Show all wards</button></p>
      </div>

      <div v-if="!compact" class="fg-block">
        <h4>Revenue by ward <small>USD, posted</small></h4>
        <ul class="fg-wards">
          <li v-for="w in wardRows" :key="w.ward_code ?? 'none'">
            <button type="button" :class="{ on: wardFilter === w.ward_code }" @click="zoomWard(w.ward_code)">
              <span class="fg-ward-name">Ward {{ w.ward_name }}<small>{{ w.accounts }} account{{ w.accounts === 1 ? '' : 's' }}</small></span>
              <span class="fg-bar" aria-hidden="true">
                <i class="paid" :style="{ width: `${(Number(w.usd_paid) / wardMax) * 100}%` }" />
                <i class="owed" :style="{ width: `${(Number(w.usd_outstanding) / wardMax) * 100}%` }" />
              </span>
              <span class="fg-ward-fig num">{{ money(w.usd_paid) }}<small>{{ w.usd_collection_rate ? `${w.usd_collection_rate}%` : '—' }}</small></span>
            </button>
          </li>
        </ul>
        <p class="fg-key"><i class="paid" /> collected <i class="owed" /> outstanding</p>
      </div>

      <div v-if="selection.length" class="fg-block fg-sel">
        <h4><ListChecks :size="15" aria-hidden="true" /> {{ selection.length }} selected</h4>
        <p class="num">{{ formatMoney((selectionTotal / 100).toFixed(2), 'USD') }} outstanding across the selection</p>
        <div class="fg-row">
          <button type="button" class="fg-btn" @click="exportSelection"><Download :size="14" aria-hidden="true" /> Export</button>
          <button type="button" class="fg-btn" @click="selection = []">Clear</button>
        </div>
      </div>
    </section>

    <!-- ════ MAP ════ -->
    <section class="fg-map-wrap" aria-label="Council property map">
      <div ref="mapEl" class="fg-map" role="application" aria-label="Map of council properties coloured by financial status" />
      <div v-if="loading" class="fg-loading"><Loader2 :size="18" class="spin" aria-hidden="true" /> Drawing the Planning register…</div>
      <p v-if="error" class="fg-maperr" role="alert"><AlertTriangle :size="16" aria-hidden="true" /> {{ error }} <button type="button" class="fg-btn" @click="loadAll">Retry</button></p>

      <div class="fg-toolbar">
        <label class="fg-colour"><span class="sr-only">Colour the map by</span>
          <MapIcon :size="15" aria-hidden="true" />
          <select v-model="colourBy">
            <option v-for="o in COLOUR_OPTIONS" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
        </label>
        <button type="button" class="fg-tool" :aria-pressed="layerPanelOpen" @click="layerPanelOpen = !layerPanelOpen"><Layers :size="16" aria-hidden="true" /> Layers</button>
        <button type="button" class="fg-tool" :aria-pressed="multiMode" title="Select several properties (or shift-click)" @click="multiMode = !multiMode"><MousePointerClick :size="16" aria-hidden="true" /> Select</button>
        <button type="button" class="fg-tool" title="Hertfordshire township" @click="zoomTownship()"><Home :size="16" aria-hidden="true" /> Township</button>
        <button type="button" class="fg-tool" title="The whole of Vungu RDC" @click="zoomDistrict"><Maximize2 :size="16" aria-hidden="true" /> Vungu RDC</button>
      </div>

      <div v-if="layerPanelOpen" class="fg-layers" role="dialog" aria-label="Map layers">
        <header><strong>Layers</strong><button type="button" class="fg-x" aria-label="Close layers" @click="layerPanelOpen = false"><X :size="16" /></button></header>
        <fieldset>
          <legend>Properties by land use</legend>
          <label v-for="k in (Object.keys(LAND_USE_LABELS) as LandUseClass[])" :key="k" :class="{ dim: !landUseCounts[k] }">
            <input v-model="landUses[k]" type="checkbox" /><span class="fg-swatch" :style="{ background: LAND_USE_COLOURS[k] }" />{{ LAND_USE_LABELS[k] }}<small>{{ landUseCounts[k] ?? 0 }}</small>
          </label>
        </fieldset>
        <fieldset>
          <legend>Financial status</legend>
          <label v-for="s in STATUS_ORDER" :key="s" :class="{ dim: !statusCounts[s] }">
            <input v-model="statuses[s]" type="checkbox" @change="preset = ''" /><span class="fg-swatch" :style="{ background: STATUS_COLOURS[s] }" />{{ STATUS_LABELS[s] }}<small>{{ statusCounts[s] ?? 0 }}</small>
          </label>
        </fieldset>
        <fieldset>
          <legend>Boundaries and infrastructure</legend>
          <label><input v-model="overlays.wards" type="checkbox" /><span class="fg-line fg-line--ward" />Ward boundaries</label>
          <label><input v-model="overlays.townships" type="checkbox" /><span class="fg-line fg-line--town" />Suburb / township outlines</label>
          <label><input v-model="overlays.zones" type="checkbox" /><span class="fg-swatch" style="background:#c7d1de" />Planning zones<small>{{ layers?.zones.features.length ?? 0 }}</small></label>
          <label><input v-model="overlays.projects" type="checkbox" /><span class="fg-dot" />Infrastructure projects<small>{{ layers?.projects.features.length ?? 0 }}</small></label>
          <label><input v-model="overlays.roads" type="checkbox" /><span class="fg-line fg-line--road" />Roads</label>
          <label v-for="u in layers?.unavailable ?? []" :key="u.id" class="dim" :title="u.reason"><input type="checkbox" disabled /><span class="fg-swatch" />{{ u.label }}<small>not captured</small></label>
        </fieldset>
      </div>

      <div class="fg-legend" aria-label="Legend">
        <strong>{{ COLOUR_OPTIONS.find((o) => o.id === colourBy)?.label }}</strong>
        <ul>
          <li v-for="l in legend" :key="l.label"><span class="fg-swatch" :style="{ background: l.colour }" />{{ l.label }}<small v-if="l.n !== null">{{ l.n }}</small></li>
        </ul>
        <p v-if="pendingCount" class="fg-legend-geo"><span class="fg-line fg-line--pending" /> Payment awaiting posting<small class="fg-legend-n">{{ pendingCount }}</small></p>
        <p class="fg-legend-geo"><span class="fg-line fg-line--council" /> Vungu RDC <span class="fg-line fg-line--ward" /> Ward <span class="fg-line fg-line--town" /> Township<template v-if="overlays.projects"> <span class="fg-dot" /> Project</template></p>
      </div>

      <p class="fg-provenance"><Info :size="13" aria-hidden="true" /> Vungu RDC only. Boundaries, wards and zoning: Planning register. Accounts, charges and payments shown here are demonstration data.</p>

      <!-- ════ PROFILE ════ -->
      <PropertyProfilePanel v-if="selectedId" class="fg-profile" :profile="profile" :loading="profileLoading" :error="profileError"
        :mode="mode" :can-pay="canPay && mode === 'cashier'" @close="closeProfile" @zoom="profile && fitTo(profile.bbox, 18)" @changed="refresh" />
    </section>
  </div>
</template>

<style scoped>
.fg { --fg-h: calc(100vh - 210px); display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 14px; height: var(--fg-h); min-height: 560px; }
.fg--compact { --fg-h: 560px; grid-template-columns: 300px minmax(0, 1fr); }
.fg-left { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 2px; }
.fg-search { position: relative; display: flex; align-items: center; }
.fg-search input { width: 100%; height: 44px; border-radius: 10px; border: 1px solid var(--cw-line-2, #808b99); padding: 0 36px 0 38px; font: inherit; font-size: 14px; background: #fff; }
.fg-search input:focus { outline: 2px solid var(--cw-accent); outline-offset: 1px; }
.fg-search-icon { position: absolute; left: 12px; color: var(--cw-ink-3); }
.fg-search-clear { position: absolute; right: 6px; border: 0; background: none; padding: 6px; cursor: pointer; color: var(--cw-ink-3); }
.fg-results { background: #fff; border: 1px solid var(--cw-card-line, #e3e8ee); border-radius: 10px; padding: 6px; max-height: 300px; overflow-y: auto; }
.fg-results ul { list-style: none; margin: 0; padding: 0; }
.fg-result { width: 100%; display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 8px; border-radius: 8px; cursor: pointer; text-align: left; font: inherit; }
.fg-result:hover, .fg-result.on { background: var(--cw-accent-softer, #f3f7fc); }
.fg-result-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fg-result-main strong { font-size: 13.5px; }
.fg-result-main small { color: var(--cw-ink-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fg-result-bal { font-size: 12.5px; font-weight: 600; color: var(--cw-pos); }
.fg-result-bal.neg { color: var(--cw-neg); }
.fg-muted, .fg-hint { color: var(--cw-ink-3); font-size: 12.5px; margin: 6px; display: flex; gap: 6px; align-items: center; }
.fg-err { color: var(--cw-neg); font-size: 13px; margin: 6px; }
.fg-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fg-kpi { background: #fff; border: 1px solid var(--cw-card-line); border-radius: 10px; padding: 10px 12px; box-shadow: var(--cw-shadow); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fg-kpi span { font-size: 12px; font-weight: 600; color: var(--cw-ink-2); display: flex; gap: 5px; align-items: center; }
.fg-kpi strong { font-size: 18px; white-space: nowrap; font-weight: 700; letter-spacing: -0.01em; }
.fg-kpi small { font-size: 11.5px; color: var(--cw-ink-3); }
.fg-kpi--neg strong { color: var(--cw-neg); }
.fg-kpi--warn strong { color: #7b5cc4; }
.fg-block { background: #fff; border: 1px solid var(--cw-card-line); border-radius: 10px; padding: 10px 12px; }
.fg-block h4 { margin: 0 0 8px; font-size: 13px; font-weight: 650; display: flex; gap: 6px; align-items: center; }
.fg-block h4 small { font-weight: 500; color: var(--cw-ink-3); }
.fg-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.fg-presets button { border: 1px solid var(--cw-line); background: #fff; border-radius: 99px; padding: 4px 11px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--cw-ink-2); }
.fg-presets button.on { background: var(--cw-accent); border-color: var(--cw-accent); color: #fff; }
.fg-chipline { margin: 8px 0 0; font-size: 12.5px; display: flex; gap: 8px; align-items: center; }
.fg-link { border: 0; background: none; color: var(--cw-accent); font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
.fg-wards { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.fg-wards button { width: 100%; display: grid; grid-template-columns: 82px 1fr 82px; gap: 8px; align-items: center; border: 0; background: none; padding: 6px 4px; border-radius: 7px; cursor: pointer; font: inherit; text-align: left; }
.fg-wards button:hover, .fg-wards button.on { background: var(--cw-accent-softer); }
.fg-ward-name { font-size: 13px; font-weight: 600; display: flex; flex-direction: column; }
.fg-ward-name small, .fg-ward-fig small { font-size: 11px; color: var(--cw-ink-3); font-weight: 500; }
.fg-ward-fig { font-size: 12.5px; font-weight: 600; text-align: right; display: flex; flex-direction: column; }
.fg-bar { height: 9px; background: #eef1f5; border-radius: 5px; display: flex; overflow: hidden; }
.fg-bar i, .fg-key i { display: inline-block; height: 100%; }
.fg-bar .paid, .fg-key .paid { background: #2a66a8; }
.fg-bar .owed, .fg-key .owed { background: #e2684f; }
.fg-key { margin: 8px 0 0; font-size: 11.5px; color: var(--cw-ink-3); display: flex; gap: 6px; align-items: center; }
.fg-key i { width: 10px; height: 10px; border-radius: 2px; }
.fg-sel p { margin: 0 0 8px; font-size: 13px; }
.fg-row { display: flex; gap: 8px; }
.fg-btn { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--cw-line-2); background: #fff; border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }

.fg-map-wrap { position: relative; border-radius: 12px; overflow: hidden; border: 1px solid var(--cw-card-line); box-shadow: var(--cw-shadow); background: #f2efe9; min-height: 0; }
.fg-map { position: absolute; inset: 0; }
.fg-loading { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); background: #fff; padding: 8px 14px; border-radius: 99px; box-shadow: var(--cw-shadow); font-size: 13px; display: flex; gap: 8px; align-items: center; z-index: 3; }
.fg-maperr { position: absolute; top: 60px; left: 12px; right: 12px; background: var(--cw-neg-soft); color: var(--cw-neg); padding: 8px 12px; border-radius: 8px; display: flex; gap: 8px; align-items: center; z-index: 4; margin: 0; font-size: 13px; }
.fg-toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; flex-wrap: wrap; z-index: 3; max-width: calc(100% - 24px); }
.fg-tool, .fg-colour { display: inline-flex; gap: 6px; align-items: center; background: #fff; border: 1px solid var(--cw-line); border-radius: 8px; padding: 0 10px; height: 34px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--cw-ink); box-shadow: 0 1px 3px rgba(16, 32, 56, 0.12); }
.fg-tool[aria-pressed='true'] { background: var(--cw-accent); border-color: var(--cw-accent); color: #fff; }
.fg-colour select { border: 0; background: none; font: inherit; font-weight: 600; cursor: pointer; padding-right: 2px; }
.fg-layers { position: absolute; top: 54px; left: 12px; width: 300px; max-height: calc(100% - 120px); overflow-y: auto; background: #fff; border-radius: 10px; box-shadow: 0 8px 28px rgba(16, 32, 56, 0.22); z-index: 5; padding: 10px 12px; }
.fg-layers header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fg-x { border: 0; background: none; cursor: pointer; padding: 4px; color: var(--cw-ink-3); }
.fg-layers fieldset { border: 0; padding: 0; margin: 8px 0 0; }
.fg-layers legend { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--cw-ink-3); margin-bottom: 4px; }
.fg-layers label { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; cursor: pointer; }
.fg-layers label small { margin-left: auto; color: var(--cw-ink-3); font-size: 11.5px; }
.fg-layers label.dim { color: var(--cw-ink-3); }
.fg-swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; display: inline-block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14); background: #eee; }
.fg-dot { width: 12px; height: 12px; border-radius: 50%; background: #0f766e; border: 2px solid #fff; box-shadow: 0 0 0 1px #0f766e; display: inline-block; flex: none; }
.fg-line { width: 18px; height: 0; display: inline-block; flex: none; border-top: 2px solid; }
.fg-line--ward { border-top: 2px dashed #24476f; }
.fg-line--town { border-color: #5b3a8c; }
.fg-line--council { border-top: 3px solid #0f2c52; }
.fg-line--pending { border-top: 3px dashed #1559b3; }
.fg-legend-n { margin-left: auto; color: var(--cw-ink-3); }
.fg-line--road { border-color: #e8a33d; border-top-width: 3px; }
.fg-legend { position: absolute; left: 12px; bottom: 38px; background: rgba(255, 255, 255, 0.96); border-radius: 10px; padding: 9px 12px; box-shadow: 0 2px 10px rgba(16, 32, 56, 0.16); z-index: 2; font-size: 12.5px; max-width: 270px; }
.fg-legend ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; }
.fg-legend li { display: flex; gap: 7px; align-items: center; }
.fg-legend li small { margin-left: auto; padding-left: 10px; color: var(--cw-ink-3); }
.fg-legend-geo { margin: 7px 0 0; padding-top: 6px; border-top: 1px solid var(--cw-line); display: flex; gap: 6px; align-items: center; color: var(--cw-ink-2); flex-wrap: wrap; }
.fg-provenance { position: absolute; right: 12px; bottom: 6px; margin: 0; font-size: 11.5px; color: var(--cw-ink-2); background: rgba(255, 255, 255, 0.92); padding: 3px 8px; border-radius: 6px; display: flex; gap: 5px; align-items: center; z-index: 2; max-width: calc(100% - 330px); right: 54px; }
.fg-profile { position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100%); z-index: 6; box-shadow: -8px 0 28px rgba(16, 32, 56, 0.18); }
.fg--profile .fg-provenance { right: 434px; }
.spin { animation: fg-spin 1s linear infinite; }
@keyframes fg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.num { font-variant-numeric: tabular-nums; }
:global(.fg-hover .maplibregl-popup-content) { font-size: 12.5px; line-height: 1.4; padding: 7px 10px; border-radius: 8px; box-shadow: 0 4px 14px rgba(16, 32, 56, 0.2); }
@media (max-width: 1100px) {
  .fg, .fg--compact { grid-template-columns: 1fr; height: auto; }
  .fg-left { max-height: none; }
  .fg-map-wrap { height: 70vh; }
  .fg-provenance { display: none; }
}
</style>
