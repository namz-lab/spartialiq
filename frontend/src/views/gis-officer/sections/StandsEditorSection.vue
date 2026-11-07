<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, reactive, nextTick, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import api from '@/services/api'
import { isPositiveNumber } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import { addVunguBasemap } from '@/map/vunguBasemap'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import {
  Plus, Pencil, Trash2, Save, X, Search, Filter,
  MapPin, AlertTriangle, CheckCircle2, RotateCcw,
  ChevronRight, Layers, Info, Move, MousePointer2,
  Combine, Scissors,
} from 'lucide-vue-next'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stand {
  id: string
  standNumber: string
  ward: string
  zoneId: string | null
  zoneType: string | null
  useScale: string | null
  areaSqm: number | null
  frontageM: number | null
  depthM: number | null
  priceUsd: number | null
  status: 'available' | 'reserved' | 'allocated' | 'withdrawn'
  description: string | null
  geometry: GeoJSON.Polygon | null
  centroid: [number, number] | null
}

type DrawMode = 'idle' | 'drawing' | 'editing'

// ─── Map refs ─────────────────────────────────────────────────────────────────

const mapContainer = ref<HTMLDivElement>()
const mapRef = shallowRef<maplibregl.Map | null>(null)
let map: maplibregl.Map | null = null
let draw: any = null

// ─── Data state ───────────────────────────────────────────────────────────────

const stands = ref<Stand[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const successMsg = ref<string | null>(null)

// ─── Selection + edit state ───────────────────────────────────────────────────

const selectedStand = ref<Stand | null>(null)
const editingStandId = ref<string | null>(null)
const drawMode = ref<DrawMode>('idle')
const drawnGeometry = ref<GeoJSON.Polygon | null>(null)
const drawnAreaSqm = ref(0)
const drawError = ref<string | null>(null)

// ─── Merge (consolidation) + Split (subdivision) state ─────────────────────────

const multiSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
const showMergeForm = ref(false)
const mergeStandNumber = ref('')
const splitMode = ref(false)
const opBusy = ref(false)

// ─── Form ─────────────────────────────────────────────────────────────────────

const showForm = ref(false)
const isCreating = ref(false)
const form = reactive({
  standNumber: '',
  ward: '',
  zoneType: '',
  useScale: '',
  frontageM: '',
  depthM: '',
  priceUsd: '',
  description: '',
})
const formErrors = reactive<Record<string, string>>({})
const fb = useUiFeedback()

// ─── Filters ──────────────────────────────────────────────────────────────────

const searchQ = ref('')
const filterWard = ref('')
const filterZoneType = ref('')
const filterStatus = ref<Set<string>>(new Set(['available', 'reserved', 'allocated']))

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  reserved:  '#f59e0b',
  allocated: '#3b82f6',
  withdrawn: '#9ca3af',
}
const STATUS_BG: Record<string, string> = {
  available: 'bg-green-100 text-green-800',
  reserved:  'bg-amber-100 text-amber-800',
  allocated: 'bg-blue-100 text-blue-800',
  withdrawn: 'bg-gray-100 text-gray-500',
}

const USE_SCALES = ['Low Density', 'Medium Density', 'High Density', 'Commercial', 'Industrial', 'Institutional', 'Agricultural']

// ─── Computed ─────────────────────────────────────────────────────────────────

const allWards = computed(() => [...new Set(stands.value.map(s => s.ward))].sort())
const allZoneTypes = computed(() => [...new Set(stands.value.map(s => s.zoneType).filter(Boolean) as string[])].sort())

const filteredStands = computed(() =>
  stands.value.filter(s => {
    if (searchQ.value && !s.standNumber.toLowerCase().includes(searchQ.value.toLowerCase())) return false
    if (filterWard.value && s.ward !== filterWard.value) return false
    if (filterZoneType.value && s.zoneType !== filterZoneType.value) return false
    if (!filterStatus.value.has(s.status)) return false
    return true
  })
)

const stats = computed(() => ({
  total:     stands.value.length,
  available: stands.value.filter(s => s.status === 'available').length,
  reserved:  stands.value.filter(s => s.status === 'reserved').length,
  allocated: stands.value.filter(s => s.status === 'allocated').length,
  withdrawn: stands.value.filter(s => s.status === 'withdrawn').length,
}))

const canSave = computed(() =>
  form.standNumber.trim() && form.ward && drawnGeometry.value && !drawError.value
)

const mergeSelection = computed(() => {
  const chosen = stands.value.filter(s => selectedIds.value.has(s.id))
  return {
    count: chosen.length,
    stands: chosen,
    totalArea: chosen.reduce((sum, s) => sum + (s.areaSqm ?? 0), 0),
  }
})

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadStands() {
  loading.value = true
  errorMsg.value = null
  try {
    const res = await api.get('/stands', {
      params: { status: 'available,reserved,allocated,withdrawn' },
    })
    stands.value = (res.data?.features ?? []).map((f: any) => ({
      ...f.properties,
      geometry: f.geometry,
    }))
    updateMapSource()
  } catch {
    errorMsg.value = 'Failed to load stands'
  } finally {
    loading.value = false
  }
}

async function saveStand() {
  if (!validateForm()) return
  saving.value = true
  errorMsg.value = null
  try {
    const body = {
      standNumber: form.standNumber.trim(),
      ward: form.ward,
      zoneType:   form.zoneType   || null,
      useScale:   form.useScale   || null,
      frontageM:  form.frontageM  ? Number(form.frontageM)  : null,
      depthM:     form.depthM     ? Number(form.depthM)     : null,
      priceUsd:   form.priceUsd   ? Number(form.priceUsd)   : null,
      description: form.description || null,
      geometry:   drawnGeometry.value,
    }
    if (isCreating.value) {
      await api.post('/stands', body)
      flashSuccess('Stand created')
    } else {
      await api.put(`/stands/${editingStandId.value}`, body)
      flashSuccess('Stand updated')
    }
    cancelEdit()
    await loadStands()
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message ?? 'Failed to save stand'
  } finally {
    saving.value = false
  }
}

async function deleteStand(stand: Stand) {
  const ok = await fb.confirmAction(
    'Delete stand',
    `Delete stand ${stand.standNumber}? This cannot be undone.`,
    { confirmLabel: 'Delete', danger: true },
  )
  if (!ok) return
  try {
    await api.delete(`/stands/${stand.id}`)
    if (selectedStand.value?.id === stand.id) {
      selectedStand.value = null
      showForm.value = false
    }
    flashSuccess(`Stand ${stand.standNumber} deleted`)
    await loadStands()
  } catch {
    errorMsg.value = 'Failed to delete stand'
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateForm(): boolean {
  Object.keys(formErrors).forEach(k => delete formErrors[k])
  let ok = true
  if (!form.standNumber.trim()) { formErrors.standNumber = 'Required'; ok = false }
  if (!form.ward) { formErrors.ward = 'Required'; ok = false }
  if (!drawnGeometry.value) { errorMsg.value = 'Draw a polygon on the map first'; ok = false }
  if (form.frontageM.trim() && !isPositiveNumber(form.frontageM, { min: 0 })) {
    formErrors.frontageM = 'Must be a number of 0 or more'; ok = false
  }
  if (form.depthM.trim() && !isPositiveNumber(form.depthM, { min: 0 })) {
    formErrors.depthM = 'Must be a number of 0 or more'; ok = false
  }
  if (form.priceUsd.trim() && !isPositiveNumber(form.priceUsd, { min: 0 })) {
    formErrors.priceUsd = 'Must be a number of 0 or more'; ok = false
  }
  return ok
}

// ─── Map setup ────────────────────────────────────────────────────────────────

function initMap() {
  if (!mapContainer.value) return

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8 as const,
      sources: {},
      layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#f2efe9' } }],
      glyphs: '/fonts/{fontstack}/{range}.pbf',
    },
    center: [29.82, -19.48],
    zoom: 11,
    attributionControl: false,
  })

  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {},
    styles: DRAW_STYLES,
  })
  ;(map as any).addControl(draw)

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left')
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    'bottom-right',
  )

  // Expose for automated UI testing / debugging.
  ;(window as any).__seMap = map

  map.on('load', async () => {
    await addVunguBasemap(map as any, {
      groups: ['admin', 'landuse', 'hydro', 'transport', 'structures'],
      interactive: false,
      autoTilt: false,
    })
    // Unmounted while the basemap loaded — onUnmounted already removed the map.
    if (!map) return
    mapRef.value = map
    addStandsLayer()
    await loadStands()
    if (!map) return
    fitToStands()

    for (const lyr of ['stands-fill', 'stands-marker']) {
      map!.on('click', lyr, onStandClick)
      map!.on('mouseenter', lyr, () => { map!.getCanvas().style.cursor = 'pointer' })
      map!.on('mouseleave', lyr, () => { map!.getCanvas().style.cursor = '' })
    }

    map!.on('draw.create', onDrawCreate)
    map!.on('draw.update', onDrawUpdate)
  })
}

function addStandsLayer() {
  if (!map) return
  map.addSource('editor-stands', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: 'stands-fill',
    type: 'fill',
    source: 'editor-stands',
    paint: {
      'fill-color': [
        'match', ['get', 'status'],
        'available', STATUS_COLOR.available,
        'reserved',  STATUS_COLOR.reserved,
        'allocated', STATUS_COLOR.allocated,
        'withdrawn', STATUS_COLOR.withdrawn,
        '#9ca3af',
      ],
      'fill-opacity': 0.45,
    },
  })
  map.addLayer({
    id: 'stands-selected',
    type: 'fill',
    source: 'editor-stands',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'fill-color': '#818cf8', 'fill-opacity': 0.65 },
  })
  map.addLayer({
    id: 'stands-outline',
    type: 'line',
    source: 'editor-stands',
    paint: {
      'line-color': [
        'match', ['get', 'status'],
        'available', '#16a34a',
        'reserved',  '#d97706',
        'allocated', '#1d4ed8',
        'withdrawn', '#6b7280',
        '#6b7280',
      ],
      'line-width': 1.5,
    },
  })
  map.addLayer({
    id: 'stands-outline-selected',
    type: 'line',
    source: 'editor-stands',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#4f46e5', 'line-width': 3 },
  })
  // Always-visible centroid markers. Municipal stands are ~300 m² — at the
  // district extent the polygons are sub-pixel and the map looks empty. A
  // status-coloured circle keeps every stand findable; it grows with zoom and
  // fades out past z16 once the polygon fill itself is legible.
  map.addLayer({
    id: 'stands-marker',
    type: 'circle',
    source: 'editor-stands',
    maxzoom: 17,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        9, 4, 13, 7, 16, 9,
      ],
      'circle-color': [
        'match', ['get', 'status'],
        'available', STATUS_COLOR.available,
        'reserved',  STATUS_COLOR.reserved,
        'allocated', STATUS_COLOR.allocated,
        'withdrawn', STATUS_COLOR.withdrawn,
        '#9ca3af',
      ],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        15, 0.9, 16.5, 0,
      ],
      'circle-stroke-opacity': [
        'interpolate', ['linear'], ['zoom'],
        15, 1, 16.5, 0,
      ],
    },
  })

  map.addLayer({
    id: 'stands-label',
    type: 'symbol',
    source: 'editor-stands',
    minzoom: 13,
    layout: {
      'text-field': ['get', 'standNumber'],
      'text-size': 10,
      'text-anchor': 'center',
      'text-offset': [0, -1.2],
    },
    paint: {
      'text-color': '#1e293b',
      'text-halo-color': '#fff',
      'text-halo-width': 1.2,
    },
  })
}

function updateMapSource() {
  if (!map) return
  const src = map.getSource('editor-stands') as any
  if (!src) return
  const features = stands.value
    .filter(s => s.geometry)
    .map(s => ({
      type: 'Feature' as const,
      geometry: s.geometry!,
      properties: { id: s.id, standNumber: s.standNumber, status: s.status, ward: s.ward, areaSqm: s.areaSqm },
    }))
  src.setData({ type: 'FeatureCollection', features })
}

// Zoom/pan the map so every stand polygon is visible. Without this the map
// opens centred on the district centroid at z11 where the ~300 m² stands are
// sub-pixel and the map looks empty — the #1 "it's not working" complaint.
function fitToStands() {
  if (!map) return
  const withGeom = stands.value.filter(s => s.geometry)
  if (withGeom.length === 0) return
  const fc = { type: 'FeatureCollection' as const, features: withGeom.map(s => ({ type: 'Feature' as const, geometry: s.geometry!, properties: {} })) }
  try {
    const [minX, minY, maxX, maxY] = turf.bbox(fc)
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 80, maxZoom: 17, duration: 600 })
  } catch { /* degenerate bbox — leave default view */ }
}

function highlightStand(id: string | null) {
  if (!map || !map.getLayer('stands-selected')) return
  map.setFilter('stands-selected', ['==', ['get', 'id'], id ?? ''])
  map.setFilter('stands-outline-selected', ['==', ['get', 'id'], id ?? ''])
}

function onStandClick(e: any) {
  if (drawMode.value !== 'idle' || splitMode.value) return
  const feat = e.features?.[0]
  if (!feat) return
  const stand = stands.value.find(s => s.id === feat.properties.id)
  if (!stand) return
  if (multiSelectMode.value) {
    toggleMultiSelect(stand)
  } else {
    selectStand(stand)
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

function selectStand(stand: Stand) {
  selectedStand.value = stand
  highlightStand(stand.id)
  if (stand.centroid) {
    map?.flyTo({ center: stand.centroid, zoom: Math.max((map.getZoom() || 11), 15), duration: 500 })
  }
}

function clearSelection() {
  selectedStand.value = null
  highlightStand(null)
}

function toggleMultiSelect(stand: Stand) {
  const next = new Set(selectedIds.value)
  if (next.has(stand.id)) next.delete(stand.id)
  else next.add(stand.id)
  selectedIds.value = next
  highlightMulti()
}

function highlightMulti() {
  if (!map || !map.getLayer('stands-selected')) return
  const ids = [...selectedIds.value]
  const filter = ['in', ['get', 'id'], ['literal', ids]] as any
  map.setFilter('stands-selected', filter)
  map.setFilter('stands-outline-selected', filter)
}

// ─── Draw actions ─────────────────────────────────────────────────────────────

function startDrawNew() {
  if (!draw) return
  clearSelection()
  cancelEdit()
  isCreating.value = true
  drawMode.value = 'drawing'
  draw.deleteAll()
  draw.changeMode('draw_polygon')
  drawError.value = null
  drawnGeometry.value = null
  drawnAreaSqm.value = 0
  resetForm()
  errorMsg.value = null
}

function startEditGeometry() {
  const stand = selectedStand.value
  if (!stand || !stand.geometry || !draw) return
  drawMode.value = 'editing'
  editingStandId.value = stand.id
  isCreating.value = false
  draw.deleteAll()
  const fid = draw.add({ type: 'Feature', geometry: stand.geometry, properties: {} })[0]
  draw.changeMode('direct_select', { featureId: fid })
  drawnGeometry.value = stand.geometry
  drawnAreaSqm.value = turf.area({ type: 'Feature', geometry: stand.geometry, properties: {} })
  populateForm(stand)
  showForm.value = true
  drawError.value = null
}

function cancelEdit() {
  drawMode.value = 'idle'
  draw?.deleteAll()
  draw?.changeMode?.('simple_select')
  showForm.value = false
  isCreating.value = false
  editingStandId.value = null
  drawnGeometry.value = null
  drawnAreaSqm.value = 0
  drawError.value = null
  Object.keys(formErrors).forEach(k => delete formErrors[k])
}

// ─── Merge (consolidation) ─────────────────────────────────────────────────────

function enterMultiSelect() {
  cancelEdit()
  clearSelection()
  multiSelectMode.value = true
  selectedIds.value = new Set()
  showMergeForm.value = false
  errorMsg.value = null
}

function exitMultiSelect() {
  multiSelectMode.value = false
  selectedIds.value = new Set()
  showMergeForm.value = false
  mergeStandNumber.value = ''
  highlightMulti()
}

function openMergeForm() {
  if (selectedIds.value.size < 2) return
  mergeStandNumber.value = ''
  showMergeForm.value = true
}

async function confirmMerge() {
  if (!mergeStandNumber.value.trim() || selectedIds.value.size < 2) return
  opBusy.value = true
  errorMsg.value = null
  try {
    const ids = [...selectedIds.value]
    const wards = stands.value.filter(s => ids.includes(s.id)).map(s => s.ward)
    await api.post('/stands/merge', {
      standIds: ids,
      standNumber: mergeStandNumber.value.trim(),
      ward: wards[0],
    })
    flashSuccess(`Merged ${ids.length} stands into ${mergeStandNumber.value.trim()}`)
    exitMultiSelect()
    await loadStands()
  } catch (err: any) {
    errorMsg.value = err.response?.data?.error ?? 'Merge failed'
  } finally {
    opBusy.value = false
  }
}

// ─── Split (subdivision) ───────────────────────────────────────────────────────

function startSplit() {
  const stand = selectedStand.value
  if (!stand || !draw) return
  splitMode.value = true
  errorMsg.value = null
  draw.deleteAll()
  draw.changeMode('draw_line_string')
}

function cancelSplit() {
  splitMode.value = false
  draw?.deleteAll()
  draw?.changeMode?.('simple_select')
}

async function submitSplit(blade: GeoJSON.LineString) {
  const stand = selectedStand.value
  if (!stand) return
  opBusy.value = true
  errorMsg.value = null
  try {
    const res = await api.post(`/stands/${stand.id}/split`, { blade })
    const n = res.data?.data?.children?.length ?? 0
    flashSuccess(`Subdivided ${stand.standNumber} into ${n} stands`)
    splitMode.value = false
    draw?.deleteAll()
    clearSelection()
    await loadStands()
  } catch (err: any) {
    errorMsg.value = err.response?.data?.error ?? 'Split failed'
    draw?.deleteAll()
    splitMode.value = false
  } finally {
    opBusy.value = false
  }
}

function onDrawCreate(e: any) {
  const geo = e.features?.[0]?.geometry
  // A line drawn during split mode is a subdivision blade, not a new stand.
  if (splitMode.value && geo?.type === 'LineString') {
    submitSplit(geo)
    return
  }
  if (geo?.type === 'Polygon') {
    processGeometry(geo)
    // auto-open form once polygon is complete
    if (!showForm.value) showForm.value = true
  }
}

function onDrawUpdate(e: any) {
  const geo = e.features?.[0]?.geometry
  if (geo) processGeometry(geo)
}

function processGeometry(geometry: GeoJSON.Polygon) {
  const feat = { type: 'Feature' as const, geometry, properties: {} }
  // Self-intersection check
  try {
    const kinks = turf.kinks(feat)
    if (kinks.features.length > 0) {
      drawError.value = 'Self-intersecting polygon — fix vertices before saving'
      return
    }
  } catch { /* turf.kinks might throw on degenerate input */ }
  drawError.value = null
  drawnGeometry.value = geometry
  drawnAreaSqm.value = turf.area(feat)
  // Auto-fill frontage/depth from bounding box if not already set
  const bb = turf.bbox(feat)
  const w = turf.distance([bb[0], (bb[1] + bb[3]) / 2], [bb[2], (bb[1] + bb[3]) / 2], { units: 'meters' })
  const h = turf.distance([(bb[0] + bb[2]) / 2, bb[1]], [(bb[0] + bb[2]) / 2, bb[3]], { units: 'meters' })
  if (!form.frontageM) form.frontageM = String(Math.round(w * 10) / 10)
  if (!form.depthM)    form.depthM    = String(Math.round(h * 10) / 10)
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function populateForm(stand: Stand) {
  form.standNumber = stand.standNumber
  form.ward        = stand.ward
  form.zoneType    = stand.zoneType ?? ''
  form.useScale    = stand.useScale ?? ''
  form.frontageM   = stand.frontageM != null ? String(stand.frontageM) : ''
  form.depthM      = stand.depthM    != null ? String(stand.depthM)    : ''
  form.priceUsd    = stand.priceUsd  != null ? String(stand.priceUsd)  : ''
  form.description = stand.description ?? ''
}

function resetForm() {
  Object.assign(form, { standNumber: '', ward: '', zoneType: '', useScale: '', frontageM: '', depthM: '', priceUsd: '', description: '' })
  Object.keys(formErrors).forEach(k => delete formErrors[k])
}

// ─── Status filter toggle ─────────────────────────────────────────────────────

function toggleStatus(s: string) {
  if (filterStatus.value.has(s)) {
    if (filterStatus.value.size > 1) filterStatus.value.delete(s)
  } else {
    filterStatus.value.add(s)
  }
}

// ─── Flash messages ───────────────────────────────────────────────────────────

function flashSuccess(msg: string) {
  successMsg.value = msg
  setTimeout(() => { successMsg.value = null }, 3000)
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtArea(sqm: number | null | undefined): string {
  if (sqm == null) return '—'
  return sqm >= 10000 ? `${(sqm / 10000).toFixed(2)} ha` : `${Math.round(sqm)} m²`
}

function fmtPrice(usd: number | null): string {
  if (usd == null) return '—'
  return `$${usd.toLocaleString()}`
}

// ─── Draw styles ──────────────────────────────────────────────────────────────

const DRAW_STYLES = [
  { id: 'draw-polygon-fill-active',   type: 'fill',   filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.2 } },
  { id: 'draw-polygon-fill-inactive', type: 'fill',   filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#4f46e5', 'fill-opacity': 0.15 } },
  { id: 'draw-polygon-stroke-active', type: 'line',   filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2.5, 'line-dasharray': [3, 1.5] } },
  { id: 'draw-polygon-stroke-inactive', type: 'line', filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2 } },
  { id: 'draw-line-active',   type: 'line',   filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],  layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2, 'line-dasharray': [3, 1.5] } },
  { id: 'draw-line-inactive', type: 'line',   filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'false']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4f46e5', 'line-width': 2 } },
  { id: 'draw-vertex-stroke', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']], paint: { 'circle-radius': 7, 'circle-color': '#fff' } },
  { id: 'draw-vertex',        type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']], paint: { 'circle-radius': 5, 'circle-color': '#4f46e5' } },
  { id: 'draw-midpoint',      type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 3.5, 'circle-color': '#818cf8' } },
]

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => { nextTick(initMap) })
onUnmounted(() => { map?.remove(); map = null })
</script>

<template>
  <div class="se-root">
    <!-- ── Sidebar ─────────────────────────────────────────────────────── -->
    <aside class="se-sidebar">
      <!-- Stats row -->
      <div class="se-stats">
        <div class="se-stat se-stat--available">
          <span class="se-stat__val">{{ stats.available }}</span>
          <span class="se-stat__lbl">Available</span>
        </div>
        <div class="se-stat se-stat--reserved">
          <span class="se-stat__val">{{ stats.reserved }}</span>
          <span class="se-stat__lbl">Reserved</span>
        </div>
        <div class="se-stat se-stat--allocated">
          <span class="se-stat__val">{{ stats.allocated }}</span>
          <span class="se-stat__lbl">Allocated</span>
        </div>
        <div class="se-stat se-stat--total">
          <span class="se-stat__val">{{ stats.total }}</span>
          <span class="se-stat__lbl">Total</span>
        </div>
      </div>

      <!-- Draw toolbar -->
      <div class="se-toolbar">
        <button
          class="se-btn se-btn--primary"
          :disabled="drawMode !== 'idle' || multiSelectMode || splitMode"
          @click="startDrawNew"
          title="Draw a new stand polygon"
        >
          <Plus :size="14" />
          New
        </button>
        <button
          class="se-btn"
          :class="multiSelectMode ? 'se-btn--primary' : 'se-btn--secondary'"
          :disabled="drawMode !== 'idle' || splitMode"
          @click="multiSelectMode ? exitMultiSelect() : enterMultiSelect()"
          title="Select multiple stands to consolidate"
        >
          <Combine :size="14" />
          Merge
        </button>
        <button
          v-if="selectedStand && drawMode === 'idle' && !multiSelectMode && !splitMode"
          class="se-btn se-btn--secondary"
          @click="startSplit"
          title="Subdivide this stand by drawing a cut line"
        >
          <Scissors :size="14" />
          Split
        </button>
        <button
          v-if="selectedStand && drawMode === 'idle' && !multiSelectMode && !splitMode"
          class="se-btn se-btn--secondary"
          @click="startEditGeometry"
          title="Edit this stand's boundary"
        >
          <Pencil :size="14" />
        </button>
        <button
          v-if="selectedStand && drawMode === 'idle' && !multiSelectMode && !splitMode"
          class="se-btn se-btn--danger"
          @click="deleteStand(selectedStand)"
          title="Delete stand"
        >
          <Trash2 :size="14" />
        </button>
        <button
          v-if="drawMode !== 'idle'"
          class="se-btn se-btn--ghost"
          @click="cancelEdit"
          title="Cancel drawing"
        >
          <X :size="14" />
          Cancel
        </button>
        <button
          v-if="splitMode"
          class="se-btn se-btn--ghost"
          @click="cancelSplit"
          title="Cancel split"
        >
          <X :size="14" />
          Cancel
        </button>
      </div>

      <!-- Draw hint -->
      <div v-if="drawMode === 'drawing'" class="se-hint se-hint--blue">
        <Info :size="13" />
        Click to add vertices · Double-click to finish
      </div>
      <div v-else-if="drawMode === 'editing'" class="se-hint se-hint--violet">
        <Move :size="13" />
        Drag vertices to reshape · Save when done
      </div>
      <div v-else-if="splitMode" class="se-hint se-hint--amber">
        <Scissors :size="13" />
        Draw a line across the stand · Double-click to cut
      </div>
      <div v-else-if="multiSelectMode" class="se-hint se-hint--blue">
        <Combine :size="13" />
        Click adjacent stands to select · then Merge
      </div>

      <!-- Merge selection bar -->
      <div v-if="multiSelectMode && mergeSelection.count > 0 && !showMergeForm" class="se-merge-bar">
        <span class="se-merge-count">{{ mergeSelection.count }} selected · {{ fmtArea(mergeSelection.totalArea) }}</span>
        <button
          class="se-btn se-btn--primary se-btn--sm"
          :disabled="mergeSelection.count < 2"
          @click="openMergeForm"
        >
          <Combine :size="13" /> Consolidate
        </button>
      </div>

      <!-- Merge form -->
      <div v-if="showMergeForm" class="se-merge-form">
        <label class="se-label">
          New stand number *
          <input v-model="mergeStandNumber" class="se-field" placeholder="e.g. CONS-001" @keyup.enter="confirmMerge" />
        </label>
        <div class="se-merge-form__actions">
          <button class="se-btn se-btn--ghost se-btn--sm" @click="showMergeForm = false" :disabled="opBusy">Back</button>
          <button class="se-btn se-btn--primary se-btn--sm" @click="confirmMerge" :disabled="opBusy || !mergeStandNumber.trim()">
            {{ opBusy ? 'Merging…' : 'Merge' }}
          </button>
        </div>
      </div>

      <!-- Error / success -->
      <div v-if="errorMsg" class="se-alert se-alert--error">
        <AlertTriangle :size="13" />
        {{ errorMsg }}
        <button class="se-alert__close" @click="errorMsg = null"><X :size="12" /></button>
      </div>
      <div v-if="successMsg" class="se-alert se-alert--success">
        <CheckCircle2 :size="13" />
        {{ successMsg }}
      </div>

      <!-- Filters -->
      <div class="se-filters">
        <div class="se-input-wrap">
          <Search :size="13" class="se-input-icon" />
          <input v-model="searchQ" class="se-input" placeholder="Search stand number…" />
        </div>
        <select v-model="filterWard" class="se-select">
          <option value="">All wards</option>
          <option v-for="w in allWards" :key="w" :value="w">{{ w }}</option>
        </select>
        <select v-model="filterZoneType" class="se-select">
          <option value="">All zone types</option>
          <option v-for="z in allZoneTypes" :key="z" :value="z">{{ z }}</option>
        </select>
        <div class="se-status-filters">
          <button
            v-for="s in ['available','reserved','allocated','withdrawn']"
            :key="s"
            class="se-status-btn"
            :class="{ 'se-status-btn--active': filterStatus.has(s) }"
            :style="filterStatus.has(s) ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s], color: '#fff' } : {}"
            @click="toggleStatus(s)"
          >{{ s }}</button>
        </div>
      </div>

      <!-- Stand list -->
      <div class="se-list">
        <div v-if="loading" class="se-empty">Loading…</div>
        <div v-else-if="filteredStands.length === 0" class="se-empty">No stands match filters</div>
        <button
          v-for="stand in filteredStands"
          :key="stand.id"
          class="se-stand-row"
          :class="{ 'se-stand-row--active': selectedStand?.id === stand.id }"
          @click="selectStand(stand)"
        >
          <span class="se-stand-dot" :style="{ background: STATUS_COLOR[stand.status] }" />
          <span class="se-stand-info">
            <span class="se-stand-num">{{ stand.standNumber }}</span>
            <span class="se-stand-meta">{{ stand.ward }} · {{ fmtArea(stand.areaSqm) }}</span>
          </span>
          <span class="se-stand-badge" :class="STATUS_BG[stand.status]">{{ stand.status }}</span>
        </button>
      </div>
    </aside>

    <!-- ── Map panel ───────────────────────────────────────────────────── -->
    <div class="se-map-wrap">
      <div ref="mapContainer" class="se-map" />
      <MapLayerFilters :map="mapRef" />

      <!-- Draw area indicator -->
      <div v-if="drawMode !== 'idle' && drawnAreaSqm > 0" class="se-map-badge">
        <Layers :size="12" />
        {{ fmtArea(drawnAreaSqm) }}
        <span v-if="drawError" class="se-map-badge__err">· {{ drawError }}</span>
      </div>

      <!-- Selected stand info strip -->
      <div v-if="selectedStand && drawMode === 'idle' && !showForm" class="se-info-strip">
        <div class="se-info-strip__body">
          <strong>{{ selectedStand.standNumber }}</strong>
          <span>{{ selectedStand.ward }}</span>
          <span v-if="selectedStand.zoneType">{{ selectedStand.zoneType }}</span>
          <span>{{ fmtArea(selectedStand.areaSqm) }}</span>
          <span v-if="selectedStand.priceUsd">{{ fmtPrice(selectedStand.priceUsd) }}</span>
          <span class="se-info-badge" :class="STATUS_BG[selectedStand.status]">{{ selectedStand.status }}</span>
        </div>
        <div class="se-info-strip__actions">
          <button class="se-btn se-btn--secondary" @click="startEditGeometry">
            <Pencil :size="13" /> Edit boundary
          </button>
          <button class="se-btn se-btn--secondary" @click="() => { populateForm(selectedStand!); editingStandId = selectedStand!.id; isCreating = false; showForm = true }">
            <Info :size="13" /> Edit details
          </button>
          <button class="se-btn se-btn--danger" @click="deleteStand(selectedStand)">
            <Trash2 :size="13" />
          </button>
          <button class="se-btn se-btn--ghost" @click="clearSelection">
            <X :size="13" />
          </button>
        </div>
      </div>
    </div>

    <!-- ── Form panel ──────────────────────────────────────────────────── -->
    <transition name="se-slide">
      <aside v-if="showForm" class="se-form-panel">
        <header class="se-form-header">
          <h3 class="se-form-title">
            {{ isCreating ? 'Create Stand' : 'Edit Stand' }}
          </h3>
          <button class="se-icon-btn" @click="cancelEdit"><X :size="15" /></button>
        </header>

        <!-- Geometry status -->
        <div v-if="drawnGeometry" class="se-geom-ok">
          <CheckCircle2 :size="14" />
          Polygon set · {{ fmtArea(drawnAreaSqm) }}
        </div>
        <div v-else class="se-geom-missing">
          <AlertTriangle :size="14" />
          Draw a polygon on the map
        </div>
        <div v-if="drawError" class="se-geom-error">
          <AlertTriangle :size="14" />
          {{ drawError }}
        </div>

        <!-- Form fields -->
        <div class="se-form-fields">
          <label class="se-label">
            Stand Number *
            <input v-model="form.standNumber" class="se-field" :class="{ 'se-field--err': formErrors.standNumber }" placeholder="e.g. HDR-001" />
            <span v-if="formErrors.standNumber" class="se-err">{{ formErrors.standNumber }}</span>
          </label>

          <label class="se-label">
            Ward *
            <select v-model="form.ward" class="se-field" :class="{ 'se-field--err': formErrors.ward }">
              <option value="">Select ward</option>
              <option v-for="w in allWards" :key="w" :value="w">{{ w }}</option>
              <option value="__new__" disabled>— or type below —</option>
            </select>
            <input v-if="!allWards.includes(form.ward) && form.ward !== ''" v-model="form.ward" class="se-field mt-1" placeholder="Ward name" />
            <span v-if="formErrors.ward" class="se-err">{{ formErrors.ward }}</span>
          </label>

          <label class="se-label">
            Zone Type
            <select v-model="form.zoneType" class="se-field">
              <option value="">— none —</option>
              <option v-for="z in allZoneTypes" :key="z" :value="z">{{ z }}</option>
            </select>
          </label>

          <label class="se-label">
            Use Scale
            <select v-model="form.useScale" class="se-field">
              <option value="">— none —</option>
              <option v-for="s in USE_SCALES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>

          <div class="se-row">
            <label class="se-label">
              Frontage (m)
              <input v-model="form.frontageM" class="se-field" :class="{ 'se-field--err': formErrors.frontageM }" type="number" min="0" step="0.1" />
              <span v-if="formErrors.frontageM" class="se-err">{{ formErrors.frontageM }}</span>
            </label>
            <label class="se-label">
              Depth (m)
              <input v-model="form.depthM" class="se-field" :class="{ 'se-field--err': formErrors.depthM }" type="number" min="0" step="0.1" />
              <span v-if="formErrors.depthM" class="se-err">{{ formErrors.depthM }}</span>
            </label>
          </div>

          <label class="se-label">
            Price (USD)
            <input v-model="form.priceUsd" class="se-field" :class="{ 'se-field--err': formErrors.priceUsd }" type="number" min="0" step="1" placeholder="0" />
            <span v-if="formErrors.priceUsd" class="se-err">{{ formErrors.priceUsd }}</span>
          </label>

          <label class="se-label">
            Description
            <textarea v-model="form.description" class="se-field se-textarea" rows="3" placeholder="Optional notes…" />
          </label>
        </div>

        <div class="se-form-actions">
          <button class="se-btn se-btn--ghost" @click="cancelEdit" :disabled="saving">Cancel</button>
          <button class="se-btn se-btn--primary" @click="saveStand" :disabled="saving || !canSave">
            <Save :size="14" />
            {{ saving ? 'Saving…' : isCreating ? 'Create Stand' : 'Save Changes' }}
          </button>
        </div>
      </aside>
    </transition>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
/* ─── Layout ──────────────────────────────────────────────────────────────── */
.se-root {
  display: flex;
  height: 100%;
  overflow: hidden;
  font-size: 13px;
  background: #f8fafc;
}

.se-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #fff;
  overflow: hidden;
}

.se-map-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.se-map { width: 100%; height: 100%; }

/* ─── Stats ───────────────────────────────────────────────────────────────── */
.se-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  border-bottom: 1px solid #e2e8f0;
}
.se-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
  border-right: 1px solid #f1f5f9;
  gap: 2px;
}
.se-stat:last-child { border-right: none; }
.se-stat__val { font-size: 18px; font-weight: 700; line-height: 1; }
.se-stat__lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
.se-stat--available .se-stat__val { color: #16a34a; }
.se-stat--reserved  .se-stat__val { color: #d97706; }
.se-stat--allocated .se-stat__val { color: #1d4ed8; }
.se-stat--total     .se-stat__val { color: #334155; }

/* ─── Toolbar ─────────────────────────────────────────────────────────────── */
.se-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0;
}

/* ─── Hint bar ────────────────────────────────────────────────────────────── */
.se-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  border-bottom: 1px solid #e2e8f0;
}
.se-hint--blue   { background: #eff6ff; color: #1d4ed8; }
.se-hint--violet { background: #f5f3ff; color: #6d28d9; }
.se-hint--amber  { background: #fffbeb; color: #b45309; }

/* ─── Merge bar + form ────────────────────────────────────────────────────── */
.se-merge-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: #eef2ff;
  border-bottom: 1px solid #e2e8f0;
}
.se-merge-count { font-size: 12px; font-weight: 600; color: #4338ca; }
.se-merge-form {
  padding: 10px;
  background: #eef2ff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.se-merge-form__actions { display: flex; gap: 6px; justify-content: flex-end; }
.se-btn--sm { padding: 4px 8px; font-size: 11px; }

/* ─── Alerts ──────────────────────────────────────────────────────────────── */
.se-alert {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 12px;
  border-bottom: 1px solid transparent;
}
.se-alert--error   { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.se-alert--success { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
.se-alert__close { margin-left: auto; background: none; border: none; cursor: pointer; color: inherit; padding: 0; display: flex; }

/* ─── Filters ─────────────────────────────────────────────────────────────── */
.se-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0;
}
.se-input-wrap { position: relative; }
.se-input-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none; }
.se-input {
  width: 100%;
  padding: 6px 8px 6px 28px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.se-input:focus { border-color: #6366f1; }
.se-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  background: #fff;
  cursor: pointer;
  outline: none;
}
.se-status-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.se-status-btn {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: 11px;
  cursor: pointer;
  text-transform: capitalize;
  transition: all 0.15s;
  color: #64748b;
}

/* ─── Stand list ──────────────────────────────────────────────────────────── */
.se-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.se-empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 12px; }
.se-stand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.1s;
}
.se-stand-row:hover { background: #f8fafc; }
.se-stand-row--active { background: #eef2ff; }
.se-stand-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.se-stand-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.se-stand-num { font-weight: 600; font-size: 12px; color: #1e293b; }
.se-stand-meta { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.se-stand-badge { font-size: 10px; padding: 2px 6px; border-radius: 999px; text-transform: capitalize; white-space: nowrap; }

/* ─── Buttons ─────────────────────────────────────────────────────────────── */
.se-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.se-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.se-btn--primary  { background: #4f46e5; color: #fff; border-color: #4338ca; }
.se-btn--primary:hover:not(:disabled)  { background: #4338ca; }
.se-btn--secondary { background: #f8fafc; color: #334155; border-color: #e2e8f0; }
.se-btn--secondary:hover:not(:disabled) { background: #f1f5f9; }
.se-btn--danger   { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.se-btn--danger:hover:not(:disabled)   { background: #fee2e2; }
.se-btn--ghost    { background: transparent; color: #64748b; }
.se-btn--ghost:hover:not(:disabled) { background: #f1f5f9; }
.se-icon-btn { background: none; border: none; cursor: pointer; color: #64748b; padding: 4px; display: flex; border-radius: 4px; }
.se-icon-btn:hover { background: #f1f5f9; }

/* ─── Map overlays ────────────────────────────────────────────────────────── */
.se-map-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(255,255,255,0.95);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #4f46e5;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.se-map-badge__err { color: #dc2626; font-weight: 400; }

.se-info-strip {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(255,255,255,0.97);
  border-top: 1px solid #e2e8f0;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.06);
}
.se-info-strip__body {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #334155;
}
.se-info-strip__body strong { color: #1e293b; font-weight: 700; }
.se-info-strip__actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.se-info-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; }

/* ─── Form panel ──────────────────────────────────────────────────────────── */
.se-form-panel {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #e2e8f0;
  background: #fff;
  overflow: hidden;
}
.se-form-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
}
.se-form-title { font-size: 14px; font-weight: 700; color: #1e293b; margin: 0; }

.se-geom-ok, .se-geom-missing, .se-geom-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.se-geom-ok      { background: #f0fdf4; color: #15803d; }
.se-geom-missing { background: #fffbeb; color: #92400e; }
.se-geom-error   { background: #fef2f2; color: #dc2626; }

.se-form-fields {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.se-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}
.se-field {
  padding: 6px 9px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
  width: 100%;
  box-sizing: border-box;
}
.se-field:focus { border-color: #4f46e5; }
.se-field--err  { border-color: #f87171; }
.se-textarea { resize: vertical; min-height: 64px; }
.se-err { font-size: 11px; color: #dc2626; font-weight: 400; }
.se-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.se-form-actions {
  display: flex;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #e2e8f0;
  justify-content: flex-end;
}

/* ─── Transitions ─────────────────────────────────────────────────────────── */
.se-slide-enter-active, .se-slide-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.se-slide-enter-from, .se-slide-leave-to { transform: translateX(20px); opacity: 0; }

/* ─── Misc ────────────────────────────────────────────────────────────────── */
.mt-1 { margin-top: 4px; }

/* Fix mapbox-gl-draw CSS class names (draw uses .mapboxgl-ctrl-*, MapLibre uses .maplibregl-ctrl-*) */
:deep(.mapboxgl-ctrl-group) {
  display: none; /* hide the default draw button group; we use our own toolbar */
}
</style>
