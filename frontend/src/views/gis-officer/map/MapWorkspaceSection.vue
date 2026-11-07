<script setup lang="ts">
// GMS map workspace (/gis/map): layer tree, one search box, identify,
// rectangle and attribute selection, geodesic measurement, bookmarks, a
// shareable view link, the WGS84 / UTM / Lo pointer readout, DXF export in
// the survey CRS, and editing through QA-gated sessions.
//
// THE ACTIVE TOOL OWNS MAP CLICKS. There is one click handler; it asks which
// tool is active and does only that tool's job. The basemap is added
// non-interactive so its drill-down never competes. Switching tools with an
// unfinished drawing asks first.
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import turfArea from '@turf/area'
import {
  MousePointer2, BoxSelect, Ruler, Square, MapPin, Spline, Hexagon, Move, Scissors,
  Search, Bookmark, Link2, FileDown, Layers as LayersIcon, PenLine, Table2,
} from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import GmsLayerTree, { type TreeLayer } from './GmsLayerTree.vue'
import GmsIdentifyPanel, { type IdentifyTarget } from './GmsIdentifyPanel.vue'
import GmsEditPanel, { type Draft } from './GmsEditPanel.vue'
import GmsSelectionTable, { type SelectedRow } from './GmsSelectionTable.vue'
import { useAuthStore } from '@/stores/auth'
import { useEditSession } from '@/composables/useEditSession'
import { DRAW_STYLES } from '@/map/drawStyles'
import { gmsOverlayLayers, parcelLayers, SELECTION_COLOUR, ERROR_COLOUR } from '@/map/gmsStyle'
import { readout, loDefsFrom, loBelt } from '@/map/coordinateReadout'
import { snapGeometry } from '@/map/snap'
import { prefersReducedMotion } from '@/map/vunguBasemap'
import {
  gmsApi, gmsTileUrl, dxfUrl, GMS_CAN,
  type AccuracyClass, type CrsEntry, type EditIssue, type Edit, type GmsLayer, type SearchHit, type FeatureDetail,
} from '@/services/gms'

type Tool = 'identify' | 'select' | 'distance' | 'area' | 'point' | 'line' | 'polygon' | 'reshape' | 'split'
type XY = [number, number]

const auth = useAuthStore()
const role = computed(() => auth.user?.role ?? 'public')
const canEditAny = computed(() => GMS_CAN.editLayers.includes(role.value))
const canRestore = computed(() => GMS_CAN.approveQa.includes(role.value))

const host = ref<HTMLElement | null>(null)
const map = shallowRef<any>(null)
let draw: any = null
let basemapLayerIds: string[] = []
const baseOpacity = new Map<string, { prop: string; value: number }>()

// ── Layers ────────────────────────────────────────────────────────────
const layers = ref<GmsLayer[]>([])
const tree = ref<TreeLayer[]>([])
const order = ref<string[]>([]) // top first
const accuracy = ref<AccuracyClass[]>(['A', 'B', 'C', 'D'])
const basemap = ref<'council' | 'blank'>('council')
const crs = ref<CrsEntry[]>([])
const loDefs = computed(() => loDefsFrom(crs.value))

// ── Tools and panels ──────────────────────────────────────────────────
const tool = ref<Tool>('identify')
const sideTab = ref<'layers' | 'edit'>('layers')
const target = ref<IdentifyTarget | null>(null)
const selection = ref<SelectedRow[]>([])
const tableOpen = ref(false)
const message = ref('')
const busy = ref(false)
const es = useEditSession()
const draft = ref<Draft | null>(null)
const issues = ref<EditIssue[]>([])
const clipboard = ref<Record<string, unknown> | null>(null)
const editLayer = computed(() => layers.value.find((l) => l.layer_id === es.session.value?.layer_id) ?? null)
const reshapeTarget = ref<{ kind: 'feature'; f: FeatureDetail } | { kind: 'pending'; index: number } | null>(null)
const splitTarget = ref<{ kind: 'feature'; f: FeatureDetail } | { kind: 'pending'; index: number } | null>(null)
let snapCandidates: GeoJSON.Geometry[] = []

const measurePts = ref<XY[]>([])
const readoutText = ref({ wgs: '', utm: '', lo: '' })

// ── Map setup ─────────────────────────────────────────────────────────
onMounted(async () => {
  const [{ default: maplibregl }, { addVunguBasemap }] = await Promise.all([
    import('maplibre-gl'), import('@/map/vunguBasemap'),
  ])
  if (!host.value) return
  const m = new maplibregl.Map({
    container: host.value,
    style: {
      version: 8, sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f5f3ee' } }],
      glyphs: '/fonts/{fontstack}/{range}.pbf',
    } as any,
    center: [29.55, -19.62],
    zoom: 13,
    // #map=zoom/lat/lng in the URL: the shareable view link.
    hash: 'map',
    attributionControl: false,
  })
  map.value = m
  m.on('error', () => {})
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

  const [ls, cs] = await Promise.all([gmsApi.layers().catch(() => []), gmsApi.crs().catch(() => [])])
  layers.value = ls
  crs.value = cs

  m.on('load', async () => {
    await addVunguBasemap(m, { interactive: false, autoTilt: false }).catch(() => {})
    basemapLayerIds = m.getStyle().layers.map((l: any) => l.id).filter((id: string) => id !== 'bg')
    addOverlays()
    draw = new MapboxDraw({ displayControlsDefault: false, controls: {}, styles: DRAW_STYLES })
    m.addControl(draw)
    m.on('click', onMapClick)
    m.on('dblclick', onDblClick)
    m.on('mousemove', onMouseMove)
    m.on('mousedown', onMouseDown)
    m.on('mouseup', onMouseUp)
    m.on('draw.create', onDrawCreate)
    m.on('moveend', refreshSnapCandidates)
  })
  window.addEventListener('keydown', onKey)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  try { map.value?.remove() } catch { /* torn down */ }
  map.value = null
})

function addOverlays() {
  const m = map.value
  m.addSource('gms-parcels', { type: 'vector', tiles: [`${location.origin}${gmsTileUrl('parcels')}`], minzoom: 10, maxzoom: 16 })
  const specs: { id: string; layers: any[] }[] = [{ id: 'parcels', layers: parcelLayers() }]
  for (const l of layers.value) {
    m.addSource(`gms-${l.layer_id}`, { type: 'vector', tiles: [`${location.origin}${gmsTileUrl(l.layer_id)}`], minzoom: 8, maxzoom: 16 })
    specs.push({ id: l.layer_id, layers: gmsOverlayLayers(l.layer_id, l.geom_type, l.custodian_dept) })
  }
  for (const s of specs) for (const spec of s.layers) {
    m.addLayer(spec)
    const prop = spec.type === 'fill' ? 'fill-opacity' : spec.type === 'line' ? 'line-opacity' : spec.type === 'circle' ? 'circle-opacity' : 'text-opacity'
    const v = spec.paint?.[prop]
    baseOpacity.set(spec.id, { prop, value: typeof v === 'number' ? v : 1 })
  }

  // Session edits, error highlights, selection and measurement ride on top.
  for (const src of ['gms-pending', 'gms-issues', 'gms-selection', 'gms-measure']) {
    m.addSource(src, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  const dash = { 'line-dasharray': [2, 1.5] }
  m.addLayer({ id: 'gms-pending-fill', type: 'fill', source: 'gms-pending', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': SELECTION_COLOUR, 'fill-opacity': 0.15 } })
  m.addLayer({ id: 'gms-pending-line', type: 'line', source: 'gms-pending', filter: ['!=', '$type', 'Point'], paint: { 'line-color': SELECTION_COLOUR, 'line-width': 2.5, ...dash } })
  m.addLayer({ id: 'gms-pending-point', type: 'circle', source: 'gms-pending', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': SELECTION_COLOUR, 'circle-stroke-width': 2.5 } })
  m.addLayer({ id: 'gms-issues-fill', type: 'fill', source: 'gms-issues', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ERROR_COLOUR, 'fill-opacity': 0.45 } })
  m.addLayer({ id: 'gms-issues-line', type: 'line', source: 'gms-issues', paint: { 'line-color': ERROR_COLOUR, 'line-width': 3 } })
  m.addLayer({ id: 'gms-issues-point', type: 'circle', source: 'gms-issues', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 9, 'circle-color': 'transparent', 'circle-stroke-color': ERROR_COLOUR, 'circle-stroke-width': 3 } })
  m.addLayer({ id: 'gms-selection-line', type: 'line', source: 'gms-selection', paint: { 'line-color': SELECTION_COLOUR, 'line-width': 3 } })
  m.addLayer({ id: 'gms-selection-point', type: 'circle', source: 'gms-selection', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': 'transparent', 'circle-stroke-color': SELECTION_COLOUR, 'circle-stroke-width': 3 } })
  m.addLayer({ id: 'gms-measure-line', type: 'line', source: 'gms-measure', paint: { 'line-color': '#1f2937', 'line-width': 2, ...dash } })
  m.addLayer({ id: 'gms-measure-point', type: 'circle', source: 'gms-measure', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#1f2937' } })

  order.value = [...layers.value.map((l) => l.layer_id), 'parcels']
  tree.value = [
    { id: 'parcels', title: 'Parcels (cadastre)', grp: 'Land & Cadastre', geom: 'Polygon', custodian: 'Survey Section', count: null, visible: true, opacity: 1 },
    ...layers.value.map((l) => ({ id: l.layer_id, title: l.title, grp: l.grp, geom: l.geom_type, custodian: l.custodian_dept, count: l.features, visible: true, opacity: 1 })),
  ]
  applyFilters()
}

const styleIdsOf = (id: string) => (map.value?.getStyle().layers ?? [])
  .map((l: any) => l.id).filter((sid: string) => sid === `gms-${id}` || sid.startsWith(`gms-${id}-`))

/** Accuracy filter on every layer, and hide published shapes the session is changing. */
function applyFilters() {
  const m = map.value
  if (!m?.getLayer('gms-parcels')) return
  const acc = ['in', ['get', 'accuracy_class'], ['literal', accuracy.value]]
  const touched = es.edits.value.filter((e) => e.op === 'delete' || (e.op === 'update' && e.geometry)).map((e) => (e as { feature_id: number }).feature_id)
  for (const t of tree.value) {
    for (const sid of styleIdsOf(t.id)) {
      const hide = t.id === editLayer.value?.layer_id && touched.length
        ? ['!', ['in', ['get', 'feature_id'], ['literal', touched]]] : null
      m.setFilter(sid, hide ? ['all', acc, hide] : acc)
    }
  }
}
watch(accuracy, applyFilters, { deep: true })

function toggleLayer(id: string) {
  const t = tree.value.find((x) => x.id === id)!
  t.visible = !t.visible
  for (const sid of styleIdsOf(id)) map.value.setLayoutProperty(sid, 'visibility', t.visible ? 'visible' : 'none')
}
function setOpacity(id: string, v: number) {
  tree.value.find((x) => x.id === id)!.opacity = v
  for (const sid of styleIdsOf(id)) {
    const b = baseOpacity.get(sid)
    if (b) map.value.setPaintProperty(sid, b.prop, b.value * v)
  }
}
function moveLayer(id: string, dir: -1 | 1) {
  const i = order.value.indexOf(id)
  const j = i - dir // up = earlier in the top-first list
  if (j < 0 || j >= order.value.length) return
  const next = [...order.value]
  ;[next[i], next[j]] = [next[j], next[i]]
  order.value = next
  // Re-stack bottom to top, each just under the session overlays.
  for (const lid of [...next].reverse()) for (const sid of styleIdsOf(lid)) map.value.moveLayer(sid, 'gms-pending-fill')
  tree.value = [...tree.value].sort((a, b) => next.indexOf(a.id) - next.indexOf(b.id))
}
function toggleAccuracy(c: AccuracyClass) {
  accuracy.value = accuracy.value.includes(c) ? accuracy.value.filter((x) => x !== c) : [...accuracy.value, c]
}
watch(basemap, (b) => {
  for (const id of basemapLayerIds) map.value?.setLayoutProperty(id, 'visibility', b === 'council' ? 'visible' : 'none')
})

// ── Sources that follow the session ───────────────────────────────────
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
function refreshPending() {
  const feats: GeoJSON.Feature[] = []
  es.edits.value.forEach((e, index) => {
    if (e.op !== 'delete' && e.geometry) feats.push({ type: 'Feature', geometry: e.geometry, properties: { index } })
  })
  if (draft.value?.kind === 'new') feats.push({ type: 'Feature', geometry: draft.value.geometry, properties: { index: -1 } })
  map.value?.getSource('gms-pending')?.setData(fc(feats))
  const bad = issues.value.flatMap((i): GeoJSON.Feature[] => {
    const g = i.geometry ?? (i.index != null ? (es.edits.value[i.index] as { geometry?: GeoJSON.Geometry })?.geometry : undefined)
    return g ? [{ type: 'Feature', geometry: g, properties: {} }] : []
  })
  map.value?.getSource('gms-issues')?.setData(fc(bad))
  applyFilters()
}
watch([() => es.edits.value, draft, issues], refreshPending, { deep: true })

async function refreshSnapCandidates() {
  const l = editLayer.value
  if (!l || !map.value) { snapCandidates = []; return }
  const b = map.value.getBounds()
  try {
    const res = await gmsApi.layerFeatures(l.layer_id, { bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] })
    snapCandidates = res.features.map((f) => f.geometry)
  } catch { snapCandidates = [] }
}
const pendingGeoms = () => es.edits.value.flatMap((e) => (e.op !== 'delete' && e.geometry ? [e.geometry] : []))
const project = (c: XY): XY => { const p = map.value.project(c); return [p.x, p.y] }
const snap = (g: GeoJSON.Geometry) => snapGeometry(g, [...snapCandidates, ...pendingGeoms()], project, 10)

// ── Tools ─────────────────────────────────────────────────────────────
const DRAW_MODE: Partial<Record<Tool, string>> = { point: 'draw_point', line: 'draw_line_string', polygon: 'draw_polygon' }
const GEOM_OF: Partial<Record<Tool, string>> = { point: 'Point', line: 'LineString', polygon: 'Polygon' }
const unfinished = () => (draw?.getAll().features.length ?? 0) > 0 || draft.value?.kind === 'new'

function setTool(t: Tool) {
  if (!map.value || t === tool.value) return
  if (unfinished() && !window.confirm('Discard the unfinished drawing?')) return
  draw?.deleteAll()
  draw?.changeMode('simple_select')
  if (draft.value?.kind === 'new') draft.value = null
  reshapeTarget.value = null
  splitTarget.value = null
  measurePts.value = []
  message.value = ''
  map.value.doubleClickZoom[t === 'distance' || t === 'area' ? 'disable' : 'enable']()

  const needsLayer = ['point', 'line', 'polygon', 'reshape', 'split'].includes(t)
  if (needsLayer && !es.editable.value) {
    message.value = 'Start an edit session on a layer first (Edit tab).'
    sideTab.value = 'edit'
    tool.value = 'identify'
    return
  }
  if (GEOM_OF[t] && GEOM_OF[t] !== editLayer.value?.geom_type) {
    message.value = `${editLayer.value?.title} is a ${editLayer.value?.geom_type.toLowerCase()} layer.`
    tool.value = 'identify'
    return
  }
  tool.value = t
  if (DRAW_MODE[t]) draw.changeMode(DRAW_MODE[t])
  if (t === 'reshape') message.value = 'Click a feature of the layer you are editing.'
  if (t === 'split') message.value = 'Click the feature to split, then draw the cutting line.'
  if (t === 'select') message.value = 'Drag a rectangle to select.'
  map.value.getCanvas().style.cursor = t === 'identify' ? '' : 'crosshair'
}
watch(measurePts, (pts) => {
  const feats: GeoJSON.Feature[] = pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }))
  if (pts.length > 1) {
    const ring = tool.value === 'area' && pts.length > 2 ? [...pts, pts[0]] : pts
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: {} })
  }
  map.value?.getSource('gms-measure')?.setData(fc(feats))
}, { deep: true })

/** Geodesic length on the WGS84 mean sphere (haversine), metres. */
function lengthM(pts: XY[]) {
  const R = 6371008.8
  let sum = 0
  for (let i = 1; i < pts.length; i++) {
    const [l1, p1] = pts[i - 1].map((v) => (v * Math.PI) / 180)
    const [l2, p2] = pts[i].map((v) => (v * Math.PI) / 180)
    const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2
    sum += 2 * R * Math.asin(Math.sqrt(h))
  }
  return sum
}
const measureText = computed(() => {
  const p = measurePts.value
  if (tool.value === 'distance' && p.length > 1) {
    const m = lengthM(p)
    return m >= 1000 ? `${(m / 1000).toFixed(3)} km` : `${m.toFixed(2)} m`
  }
  if (tool.value === 'area' && p.length > 2) {
    const a = turfArea({ type: 'Polygon', coordinates: [[...p, p[0]]] })
    return `${a.toFixed(1)} m² · ${(a / 10000).toFixed(4)} ha · perimeter ${lengthM([...p, p[0]]).toFixed(1)} m`
  }
  return ''
})

// Query order when several things are under the pointer: session edits,
// then points, lines, polygons, and the cadastre last.
function hitAt(point: { x: number; y: number }) {
  const m = map.value
  const box: [XY, XY] = [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]]
  const ids = ['gms-pending-point', 'gms-pending-line', 'gms-pending-fill',
    ...tree.value.filter((t) => t.visible && t.id !== 'parcels').flatMap((t) => styleIdsOf(t.id)), 'gms-parcels']
    .filter((id) => m.getLayer(id))
  const hits = m.queryRenderedFeatures(box, { layers: ids })
  const rank = (h: any) => (h.layer.id.startsWith('gms-pending') ? 0 : h.layer.type === 'circle' ? 1 : h.layer.type === 'line' ? 2 : h.layer.id === 'gms-parcels' ? 4 : 3)
  return hits.sort((a: any, b: any) => rank(a) - rank(b))[0] ?? null
}

async function onMapClick(e: any) {
  const t = tool.value
  if (t === 'distance' || t === 'area') { measurePts.value = [...measurePts.value, [e.lngLat.lng, e.lngLat.lat]]; return }
  if (t === 'identify') return identifyAt(e.point)
  if ((t === 'reshape' && !reshapeTarget.value) || (t === 'split' && !splitTarget.value)) return pickForGeometryTool(e.point)
  // Draw tools: MapboxDraw handles its own clicks.
}
function onDblClick() {
  if (tool.value === 'distance' || tool.value === 'area') message.value = measureText.value ? `Measured ${measureText.value}. Click to start again.` : ''
  if (measurePts.value.length) setTimeout(() => { measurePts.value = [] }, 0)
}

function identifyAt(point: { x: number; y: number }) {
  const h = hitAt(point)
  if (!h) { target.value = null; setSelection([]); return }
  if (h.layer.id.startsWith('gms-pending')) {
    const i = h.properties.index
    if (i >= 0) focusEdit(i)
    return
  }
  if (h.layer.id === 'gms-parcels') target.value = { kind: 'parcel', id: h.properties.parcel_id }
  else target.value = { kind: 'feature', id: Number(h.properties.feature_id) }
  setSelection([{ type: 'Feature', geometry: h.geometry, properties: {} }])
}
function setSelection(features: GeoJSON.Feature[]) {
  map.value?.getSource('gms-selection')?.setData(fc(features))
}

async function pickForGeometryTool(point: { x: number; y: number }) {
  const h = hitAt(point)
  const layerId = editLayer.value?.layer_id
  if (!h) return
  if (h.layer.id === 'gms-parcels') {
    message.value = 'Parcel boundaries change only through an import of an approved general plan or diagram from the Survey Section.'
    return
  }
  let picked: { kind: 'feature'; f: FeatureDetail } | { kind: 'pending'; index: number } | null = null
  let geometry: GeoJSON.Geometry | undefined
  if (h.layer.id.startsWith('gms-pending') && h.properties.index >= 0) {
    picked = { kind: 'pending', index: h.properties.index }
    geometry = (es.edits.value[h.properties.index] as { geometry?: GeoJSON.Geometry }).geometry
  } else if (h.layer.id.startsWith(`gms-${layerId}`)) {
    const f = await gmsApi.feature(Number(h.properties.feature_id))
    picked = { kind: 'feature', f }
    geometry = f.geometry
  } else {
    message.value = `Only features of ${editLayer.value?.title} can be changed in this session.`
    return
  }
  if (!geometry) return
  if (tool.value === 'reshape') {
    reshapeTarget.value = picked
    const [id] = draw.add({ type: 'Feature', geometry, properties: {} })
    draw.changeMode('simple_select', { featureIds: [id] })
    message.value = 'Drag to move. Double-click to edit vertices. Then Done.'
  } else {
    if (geometry.type === 'Point') { message.value = 'Points cannot be split.'; return }
    splitTarget.value = picked
    setSelection([{ type: 'Feature', geometry, properties: {} }])
    draw.changeMode('draw_line_string')
    message.value = 'Draw the cutting line across the feature; double-click to finish.'
  }
}

function finishReshape() {
  const t = reshapeTarget.value
  const g = draw.getAll().features[0]?.geometry
  if (!t || !g) return
  const snapped = snap(g)
  if (t.kind === 'pending') es.patchEdit(t.index, { geometry: snapped } as Partial<Edit>)
  else es.updateFeature(t.f.feature_id, t.f.version, { geometry: snapped })
  draw.deleteAll()
  reshapeTarget.value = null
  message.value = 'Shape changed in your session.'
}
function cancelReshape() {
  draw.deleteAll()
  reshapeTarget.value = null
  message.value = ''
}

async function onDrawCreate(e: any) {
  const g = e.features[0]?.geometry as GeoJSON.Geometry
  draw.deleteAll()
  if (!g) return
  if (tool.value === 'split' && splitTarget.value) return doSplit(g)
  draft.value = { kind: 'new', geometry: snap(g) }
  sideTab.value = 'edit'
}

async function doSplit(blade: GeoJSON.Geometry) {
  const t = splitTarget.value!
  const geometry = t.kind === 'feature' ? t.f.geometry : (es.edits.value[t.index] as { geometry: GeoJSON.Geometry }).geometry
  try {
    const [first, ...rest] = await gmsApi.split(geometry, blade)
    const next: Edit[] = JSON.parse(JSON.stringify(es.edits.value))
    let attrs: Record<string, unknown>
    let accuracy_class: AccuracyClass
    let source: string
    if (t.kind === 'pending') {
      const c = next[t.index] as Extract<Edit, { op: 'create' }>
      c.geometry = first
      ;({ attrs, accuracy_class, source } = c)
    } else {
      const i = next.findIndex((x) => x.op === 'update' && x.feature_id === t.f.feature_id)
      if (i >= 0) (next[i] as Extract<Edit, { op: 'update' }>).geometry = first
      else next.push({ op: 'update', feature_id: t.f.feature_id, base_version: t.f.version, geometry: first })
      ;({ attrs, accuracy_class, source } = t.f)
    }
    for (const g of rest) next.push({ op: 'create', geometry: g, attrs: { ...attrs }, accuracy_class, source })
    es.setEdits(next)
    message.value = `Split into ${rest.length + 1} parts. Check the attributes of the new parts.`
  } catch (err: any) {
    message.value = err?.response?.data?.error === 'blade_does_not_cross' ? 'The cutting line must cross the feature.' : 'The feature could not be split.'
  }
  splitTarget.value = null
  setSelection([])
  draw.changeMode('simple_select')
}

// Rectangle select.
let boxStart: { x: number; y: number } | null = null
const boxStyle = ref<Record<string, string> | null>(null)
function onMouseDown(e: any) {
  if (tool.value !== 'select' || e.originalEvent.button !== 0) return
  boxStart = e.point
  map.value.dragPan.disable()
}
function onMouseMove(e: any) {
  const r = readout(e.lngLat.lng, e.lngLat.lat, loDefs.value)
  readoutText.value = {
    wgs: `${r.wgs84.lat.toFixed(6)}, ${r.wgs84.lng.toFixed(6)}`,
    utm: `${r.utm.zone}S ${r.utm.e.toFixed(1)} E ${r.utm.n.toFixed(1)} N`,
    lo: r.lo ? `Lo${r.lo.belt} Y ${r.lo.y.toFixed(2)} X ${r.lo.x.toFixed(2)}` : `Lo${loBelt(e.lngLat.lng)} not registered`,
  }
  if (boxStart) {
    const [x0, y0, x1, y1] = [boxStart.x, boxStart.y, e.point.x, e.point.y]
    boxStyle.value = { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` }
  }
}
async function onMouseUp(e: any) {
  if (!boxStart) return
  const m = map.value
  const a = m.unproject(boxStart)
  const b = e.lngLat
  const px = [boxStart, e.point]
  boxStart = null
  boxStyle.value = null
  m.dragPan.enable()
  const bbox = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]
  const rows: SelectedRow[] = []
  for (const t of tree.value.filter((x) => x.visible)) {
    if (t.id === 'parcels') {
      const seen = new Set<string>()
      for (const f of m.queryRenderedFeatures([[px[0].x, px[0].y], [px[1].x, px[1].y]], { layers: ['gms-parcels'] })) {
        if (seen.has(f.properties.parcel_id)) continue
        seen.add(f.properties.parcel_id)
        rows.push({ layer_id: 'parcels', id: f.properties.parcel_id, props: f.properties, geometry: null })
      }
      continue
    }
    try {
      const res = await gmsApi.layerFeatures(t.id, { bbox, accuracy: accuracy.value })
      for (const f of res.features) rows.push({ layer_id: t.id, id: String(f.id), props: f.properties ?? {}, geometry: f.geometry })
    } catch { /* not visible to this role */ }
  }
  selection.value = rows
  tableOpen.value = true
  setSelection(rows.flatMap((r) => (r.geometry ? [{ type: 'Feature' as const, geometry: r.geometry, properties: {} }] : [])))
  message.value = `${rows.length} selected.`
}

async function queryByAttribute(q: { layer_id: string; field: string; op: 'eq' | 'contains'; value: string }) {
  const res = await gmsApi.layerFeatures(q.layer_id, { accuracy: accuracy.value })
  const v = q.value.trim().toLowerCase()
  const rows = res.features
    .filter((f) => {
      const x = String(f.properties?.[q.field] ?? '').toLowerCase()
      return q.op === 'eq' ? x === v : x.includes(v)
    })
    .map((f) => ({ layer_id: q.layer_id, id: String(f.id), props: f.properties ?? {}, geometry: f.geometry }))
  selection.value = rows
  setSelection(rows.map((r) => ({ type: 'Feature', geometry: r.geometry!, properties: {} })))
  message.value = `${rows.length} match${res.truncated ? ' (first 5000 features searched)' : ''}.`
  if (rows.length) fitTo(rows.map((r) => r.geometry!))
}

async function mergeRows(rows: SelectedRow[]) {
  if (!es.editable.value) return
  try {
    const union = await gmsApi.merge(rows.map((r) => r.geometry!))
    const [keep, drop] = rows
    const next: Edit[] = JSON.parse(JSON.stringify(es.edits.value))
      .filter((x: Edit) => x.op === 'create' || x.feature_id !== Number(drop.id))
    const i = next.findIndex((x) => x.op === 'update' && x.feature_id === Number(keep.id))
    if (i >= 0) (next[i] as Extract<Edit, { op: 'update' }>).geometry = union
    else next.push({ op: 'update', feature_id: Number(keep.id), base_version: Number(keep.props.version), geometry: union })
    next.push({ op: 'delete', feature_id: Number(drop.id), base_version: Number(drop.props.version) })
    es.setEdits(next)
    message.value = `Merged F-${drop.id} into F-${keep.id} in your session.`
  } catch (err: any) {
    message.value = err?.response?.data?.error === 'not_adjacent' ? 'Only features that touch can be merged.' : 'The features could not be merged.'
  }
}

// ── Search, bookmarks, share, export ──────────────────────────────────
const q = ref('')
const hits = ref<SearchHit[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(searchTimer)
  if (v.trim().length < 2) { hits.value = []; return }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try { hits.value = await gmsApi.search(v.trim()) } catch { hits.value = [] } finally { searching.value = false }
  }, 300)
})
let marker: any = null
async function go(h: SearchHit) {
  hits.value = []
  const m = map.value
  const duration = prefersReducedMotion() ? 0 : 600
  if (h.bbox) m.fitBounds([[h.bbox[0], h.bbox[1]], [h.bbox[2], h.bbox[3]]], { padding: 80, maxZoom: 18, duration })
  else m.flyTo({ center: h.center, zoom: Math.max(m.getZoom(), 16), duration })
  if (h.kind === 'coordinate') {
    const { default: maplibregl } = await import('maplibre-gl')
    marker?.remove()
    marker = new maplibregl.Marker({ color: SELECTION_COLOUR }).setLngLat(h.center).addTo(m)
  }
  if (h.kind === 'parcel' || h.kind === 'account') target.value = { kind: 'parcel', id: h.id }
  if (h.kind === 'feature') target.value = { kind: 'feature', id: Number(h.id) }
}
function fitTo(geoms: GeoJSON.Geometry[]) {
  const xs: number[] = []
  const ys: number[] = []
  const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') { xs.push((c as number[])[0]); ys.push((c as number[])[1]) } else (c as unknown[]).forEach(walk) }
  for (const g of geoms) if ('coordinates' in g) walk(g.coordinates)
  if (!xs.length) return
  map.value.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
    { padding: 80, maxZoom: 18, duration: prefersReducedMotion() ? 0 : 500 })
}

interface BookmarkEntry { name: string; center: XY; zoom: number }
const BM_KEY = 'gms-bookmarks'
const bookmarks = ref<BookmarkEntry[]>((() => { try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]') } catch { return [] } })())
const bmOpen = ref(false)
function addBookmark() {
  const name = window.prompt('Name this view')?.trim()
  if (!name) return
  const c = map.value.getCenter()
  bookmarks.value = [...bookmarks.value, { name, center: [c.lng, c.lat], zoom: map.value.getZoom() }]
  try { localStorage.setItem(BM_KEY, JSON.stringify(bookmarks.value)) } catch { /* private window */ }
}
function openBookmark(b: BookmarkEntry) {
  bmOpen.value = false
  map.value.flyTo({ center: b.center, zoom: b.zoom, duration: prefersReducedMotion() ? 0 : 600 })
}
async function share() {
  try { await navigator.clipboard.writeText(location.href); message.value = 'Link to this view copied.' }
  catch { message.value = `Link: ${location.href}` }
}

const dxfOpen = ref(false)
const dxf = ref({ layer: 'parcels', township: 'TSAMBA-GP', srid: 922029 })
watch(dxfOpen, (open) => {
  if (!open || !map.value) return
  // Default to the survey belt under the map centre.
  const belt = loBelt(map.value.getCenter().lng)
  const lo = crs.value.find((c) => c.code === `Lo${belt}`)
  if (lo) dxf.value.srid = lo.srid
})

// ── Edit session ──────────────────────────────────────────────────────
async function startEditing(layerId: string) {
  busy.value = true
  try {
    await es.open(layerId)
    issues.value = []
    await refreshSnapCandidates()
    message.value = es.recovered.value ? 'Recovered unsaved changes from this device.' : ''
  } catch (err: any) {
    message.value = err?.response?.data?.message || 'The session could not be opened.'
  } finally { busy.value = false }
}
function leaveEditing() {
  if (unfinished() && !window.confirm('Discard the unfinished drawing?')) return
  es.save()
  es.close()
  draft.value = null
  issues.value = []
  setTool('identify')
}
function focusEdit(index: number) {
  const e = es.edits.value[index]
  if (!e) return
  sideTab.value = 'edit'
  if (e.op !== 'delete' && e.geometry) fitTo([e.geometry])
  if (e.op === 'create') draft.value = { kind: 'pending', index }
}
function saveDraft(v: { attrs: Record<string, unknown>; accuracy_class: AccuracyClass; source: string }) {
  const d = draft.value
  if (!d) return
  if (d.kind === 'new') {
    es.addCreate(d.geometry, v.attrs, v.accuracy_class, v.source)
    draft.value = null
    if (DRAW_MODE[tool.value]) draw.changeMode(DRAW_MODE[tool.value]) // keep drawing
  } else if (d.kind === 'pending') {
    es.patchEdit(d.index, v as Partial<Edit>)
    draft.value = null
  } else {
    es.updateFeature(d.feature_id, d.version, v)
    draft.value = null
  }
}
function cancelDraft() {
  draft.value = null
  if (DRAW_MODE[tool.value]) draw.changeMode(DRAW_MODE[tool.value])
}
function editAttrs(f: FeatureDetail) {
  draft.value = { kind: 'feature', feature_id: f.feature_id, version: f.version, attrs: f.attrs, accuracy_class: f.accuracy_class, source: f.source }
  sideTab.value = 'edit'
}
function reshapeFeature(f: FeatureDetail) {
  setTool('reshape')
  if (tool.value !== 'reshape') return
  reshapeTarget.value = { kind: 'feature', f }
  const [id] = draw.add({ type: 'Feature', geometry: f.geometry, properties: {} })
  draw.changeMode('simple_select', { featureIds: [id] })
  message.value = 'Drag to move. Double-click to edit vertices. Then Done.'
}
function deleteFeature(f: FeatureDetail) {
  if (!window.confirm(`Delete F-${f.feature_id}? It is retired when QA approves, and stays in the history.`)) return
  es.deleteFeature(f.feature_id, f.version)
  target.value = null
}
async function validate() {
  busy.value = true
  try {
    await es.save()
    issues.value = (await gmsApi.validate(es.session.value!.session_id)).errors
    message.value = issues.value.length ? `${issues.value.length} problem${issues.value.length === 1 ? '' : 's'} to fix.` : 'No problems found.'
  } finally { busy.value = false }
}
async function submit() {
  busy.value = true
  try {
    await es.save()
    const res = await gmsApi.submit(es.session.value!.session_id)
    if (!res.success) {
      issues.value = res.errors ?? []
      message.value = 'Not submitted: fix the highlighted problems first.'
      return
    }
    issues.value = []
    es.load(await gmsApi.session(es.session.value!.session_id))
    message.value = 'Submitted to the QA queue.'
  } catch {
    message.value = 'The session could not be submitted. Your edits are saved.'
  } finally { busy.value = false }
}
async function abandon() {
  if (!window.confirm('Abandon this session? Its changes are discarded.')) return
  await gmsApi.abandon(es.session.value!.session_id).catch(() => {})
  es.close()
  issues.value = []
  draft.value = null
}

// ── Keyboard ──────────────────────────────────────────────────────────
const KEYS: Record<string, Tool> = { i: 'identify', s: 'select', d: 'distance', a: 'area', p: 'point', l: 'line', g: 'polygon', r: 'reshape', x: 'split' }
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? es.redo() : es.undo(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); es.redo(); return }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Escape') {
    measurePts.value = []
    if (reshapeTarget.value) cancelReshape()
    else if (unfinished() && window.confirm('Discard the unfinished drawing?')) { draw.deleteAll(); draft.value = null; if (DRAW_MODE[tool.value]) draw.changeMode(DRAW_MODE[tool.value]) }
    return
  }
  const t = KEYS[e.key.toLowerCase()]
  if (t) setTool(t)
}

const TOOLS: { t: Tool; label: string; key: string; icon: any; edit?: boolean }[] = [
  { t: 'identify', label: 'Identify', key: 'I', icon: MousePointer2 },
  { t: 'select', label: 'Select by rectangle', key: 'S', icon: BoxSelect },
  { t: 'distance', label: 'Measure distance', key: 'D', icon: Ruler },
  { t: 'area', label: 'Measure area', key: 'A', icon: Square },
  { t: 'point', label: 'Draw point', key: 'P', icon: MapPin, edit: true },
  { t: 'line', label: 'Draw line', key: 'L', icon: Spline, edit: true },
  { t: 'polygon', label: 'Draw polygon', key: 'G', icon: Hexagon, edit: true },
  { t: 'reshape', label: 'Move or reshape', key: 'R', icon: Move, edit: true },
  { t: 'split', label: 'Split', key: 'X', icon: Scissors, edit: true },
]
const toolList = computed(() => TOOLS.filter((x) => !x.edit || canEditAny.value))
watch(() => es.session.value?.layer_id, () => nextTick(applyFilters))
</script>

<template>
  <div class="mw">
    <aside class="mw-side" aria-label="Layers and editing">
      <div class="mw-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="sideTab === 'layers'" :class="{ on: sideTab === 'layers' }" @click="sideTab = 'layers'">
          <LayersIcon :size="13" aria-hidden="true" /> Layers
        </button>
        <button v-if="canEditAny" type="button" role="tab" :aria-selected="sideTab === 'edit'" :class="{ on: sideTab === 'edit' }" @click="sideTab = 'edit'">
          <PenLine :size="13" aria-hidden="true" /> Edit<span v-if="es.edits.value.length" class="mw-n">{{ es.edits.value.length }}</span>
        </button>
      </div>
      <div class="mw-side-body">
        <GmsLayerTree v-show="sideTab === 'layers'" :layers="tree" :accuracy="accuracy"
                      @toggle="toggleLayer" @opacity="setOpacity" @move="moveLayer" @accuracy="toggleAccuracy" />
        <GmsEditPanel v-if="sideTab === 'edit'" :es="es" :layers="layers" :draft="draft" :issues="issues" :clipboard="clipboard" :busy="busy"
                      @start="startEditing" @leave="leaveEditing" @draft-save="saveDraft" @draft-cancel="cancelDraft"
                      @focus="focusEdit" @validate="validate" @submit="submit" @abandon="abandon" />
      </div>
    </aside>

    <div class="mw-main">
      <div class="mw-bar">
        <div class="mw-search">
          <Search :size="14" class="mw-search-icon" aria-hidden="true" />
          <input v-model="q" type="search" placeholder="Stand, parcel ID, ERP account, ward, village, feature, or coordinates (Lo29 Y X · 35S E N · lat, lon)"
                 aria-label="Search the map" autocomplete="off" @keydown.enter.prevent="hits[0] && go(hits[0])" @keydown.esc="hits = []" />
          <ul v-if="hits.length" class="mw-hits" role="listbox">
            <li v-for="h in hits" :key="`${h.kind}:${h.id}`" role="option" aria-selected="false">
              <button type="button" @click="go(h)"><strong>{{ h.label }}</strong><span>{{ h.kind }} · {{ h.detail }}</span></button>
            </li>
          </ul>
          <p v-else-if="searching" class="mw-hits mw-hint" role="status">Searching…</p>
        </div>
        <div class="mw-tools" role="toolbar" aria-label="Map tools">
          <button v-for="x in toolList" :key="x.t" type="button" class="mw-tool" :class="{ on: tool === x.t }"
                  :aria-pressed="tool === x.t" :title="`${x.label} (${x.key})`" @click="setTool(x.t)">
            <component :is="x.icon" :size="15" aria-hidden="true" /><span class="ent-sr-only">{{ x.label }}</span>
          </button>
        </div>
        <label class="mw-basemap">
          <span class="ent-sr-only">Basemap</span>
          <select v-model="basemap"><option value="council">Council basemap</option><option value="blank">Blank</option></select>
        </label>
        <div class="mw-pop">
          <button type="button" class="mw-tool" title="Bookmarks" :aria-expanded="bmOpen" @click="bmOpen = !bmOpen"><Bookmark :size="15" /><span class="ent-sr-only">Bookmarks</span></button>
          <div v-if="bmOpen" class="mw-menu">
            <button v-for="b in bookmarks" :key="b.name" type="button" @click="openBookmark(b)">{{ b.name }}</button>
            <p v-if="!bookmarks.length" class="mw-hint">No bookmarks on this device yet.</p>
            <UiButton size="sm" variant="ghost" @click="addBookmark">Bookmark this view</UiButton>
          </div>
        </div>
        <button type="button" class="mw-tool" title="Copy a link to this view" @click="share"><Link2 :size="15" /><span class="ent-sr-only">Share view</span></button>
        <div class="mw-pop">
          <button type="button" class="mw-tool" title="Export DXF" :aria-expanded="dxfOpen" @click="dxfOpen = !dxfOpen"><FileDown :size="15" /><span class="ent-sr-only">Export DXF</span></button>
          <form v-if="dxfOpen" class="mw-menu mw-form" @submit.prevent>
            <label>Layer
              <select v-model="dxf.layer"><option value="parcels">Parcels</option>
                <option v-for="l in layers" :key="l.layer_id" :value="l.layer_id">{{ l.title }}</option></select>
            </label>
            <label v-if="dxf.layer === 'parcels'">Township <input v-model="dxf.township" /></label>
            <label>Coordinate system
              <select v-model.number="dxf.srid">
                <option v-for="c in crs" :key="c.srid" :value="c.srid">{{ c.code }}{{ c.is_survey ? ' — survey CRS' : '' }}</option>
              </select>
            </label>
            <a class="mw-dl" :href="dxfUrl(dxf)" download @click="dxfOpen = false">Download DXF</a>
          </form>
        </div>
        <button type="button" class="mw-tool" :class="{ on: tableOpen }" title="Attribute table" @click="tableOpen = !tableOpen"><Table2 :size="15" /><span class="ent-sr-only">Attribute table</span></button>
      </div>

      <div class="mw-stage">
        <div ref="host" class="mw-map" />
        <div v-if="boxStyle" class="mw-box" :style="boxStyle" />
        <div v-if="message || measureText || reshapeTarget" class="mw-msg" role="status">
          <span>{{ measureText && (tool === 'distance' || tool === 'area') ? measureText : message }}</span>
          <template v-if="reshapeTarget">
            <UiButton size="sm" variant="primary" @click="finishReshape">Done</UiButton>
            <UiButton size="sm" variant="ghost" @click="cancelReshape">Cancel</UiButton>
          </template>
        </div>
        <GmsIdentifyPanel v-if="target" class="mw-identify" :target="target" :edit-layer-id="es.editable.value ? es.session.value!.layer_id : null"
                          :can-restore="canRestore" @close="target = null; setSelection([])" @copy="clipboard = $event; message = 'Attributes copied.'"
                          @edit-attrs="editAttrs" @reshape="reshapeFeature" @delete="deleteFeature" />
      </div>

      <GmsSelectionTable v-if="tableOpen" class="mw-table" :rows="selection" :layers="layers" :edit-layer-id="es.editable.value ? editLayer?.layer_id ?? null : null"
                         @close="tableOpen = false" @zoom="(r) => r.geometry && fitTo([r.geometry])" @query="queryByAttribute" @merge="mergeRows" />

      <footer class="mw-readout" aria-label="Pointer coordinates">
        <span><b>WGS84</b> {{ readoutText.wgs || '—' }}</span>
        <span><b>UTM</b> {{ readoutText.utm || '—' }}</span>
        <span><b>Lo</b> {{ readoutText.lo || '—' }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.mw { display:flex; height:100%; min-height:0; }
.mw-side { width:280px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid var(--ent-line); background:var(--ent-surface); }
.mw-tabs { display:flex; border-bottom:1px solid var(--ent-line); }
.mw-tabs button { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:var(--ent-s1); padding:var(--ent-s2);
  background:none; border:0; border-bottom:2px solid transparent; font:inherit; font-size:var(--ent-fs-sm); color:var(--ent-text-2); cursor:pointer; }
.mw-tabs button.on { color:var(--ent-accent); border-bottom-color:var(--ent-accent); }
.mw-tabs button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.mw-n { font-family:var(--ent-font-mono); font-size:var(--ent-fs-micro); padding:0 5px; border-radius:var(--ent-r-pill); background:var(--ent-accent-soft); }
.mw-side-body { flex:1; overflow-y:auto; padding:var(--ent-s3); }
.mw-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.mw-bar { display:flex; align-items:center; gap:var(--ent-s2); padding:var(--ent-s2); border-bottom:1px solid var(--ent-line); background:var(--ent-surface); flex-wrap:wrap; }
.mw-search { position:relative; flex:1 1 280px; min-width:200px; }
.mw-search-icon { position:absolute; left:8px; top:50%; transform:translateY(-50%); color:var(--ent-text-3); }
.mw-search input { width:100%; height:var(--ent-control-h-sm); padding:0 var(--ent-s2) 0 28px; font:inherit; font-size:var(--ent-fs-sm);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.mw-hits { position:absolute; z-index:var(--ent-z-popover); top:calc(100% + 4px); left:0; right:0; margin:0; padding:var(--ent-s1); list-style:none;
  background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r); box-shadow:var(--ent-e3); max-height:320px; overflow:auto; }
.mw-hits button { display:flex; flex-direction:column; width:100%; padding:var(--ent-s2); text-align:left; background:none; border:0; border-radius:var(--ent-r-sm); font:inherit; cursor:pointer; }
.mw-hits button:hover, .mw-hits button:focus-visible { background:var(--ent-accent-soft); outline:none; }
.mw-hits span { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.mw-hint { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); padding:var(--ent-s2); }
.mw-tools { display:flex; gap:2px; padding:2px; border:1px solid var(--ent-line); border-radius:var(--ent-r-sm); }
.mw-tool { display:inline-flex; align-items:center; justify-content:center; width:30px; height:28px; background:none; border:0;
  border-radius:var(--ent-r-sm); color:var(--ent-text-2); cursor:pointer; }
.mw-tool:hover { background:var(--ent-surface-2); color:var(--ent-text); }
.mw-tool.on { background:var(--ent-accent-soft); color:var(--ent-accent); }
.mw-tool:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.mw-basemap select { height:var(--ent-control-h-sm); font:inherit; font-size:var(--ent-fs-xs); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.mw-pop { position:relative; }
.mw-menu { position:absolute; z-index:var(--ent-z-popover); top:calc(100% + 4px); right:0; min-width:220px; display:flex; flex-direction:column; gap:var(--ent-s1);
  padding:var(--ent-s2); background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r); box-shadow:var(--ent-e3); }
.mw-menu > button { text-align:left; padding:var(--ent-s1) var(--ent-s2); background:none; border:0; border-radius:var(--ent-r-sm); font:inherit; font-size:var(--ent-fs-sm); cursor:pointer; }
.mw-menu > button:hover { background:var(--ent-surface-2); }
.mw-form label { display:flex; flex-direction:column; gap:2px; font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.mw-form select, .mw-form input { height:var(--ent-control-h-sm); font:inherit; font-size:var(--ent-fs-sm); border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); background:var(--ent-surface); color:var(--ent-text); }
.mw-dl { align-self:flex-start; padding:var(--ent-s1) var(--ent-s3); border-radius:var(--ent-r-sm); background:var(--ent-accent); color:var(--ent-text-on-accent); font-size:var(--ent-fs-sm); text-decoration:none; }
.mw-stage { position:relative; flex:1; min-height:0; }
.mw-map { position:absolute; inset:0; }
.mw-box { position:absolute; border:1.5px dashed var(--ent-accent); background:color-mix(in srgb, var(--ent-accent) 8%, transparent); pointer-events:none; }
.mw-msg { position:absolute; top:var(--ent-s2); left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:var(--ent-s2);
  max-width:min(640px, 90%); padding:var(--ent-s2) var(--ent-s3); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); box-shadow:var(--ent-e2); font-size:var(--ent-fs-sm); }
.mw-identify { position:absolute; top:var(--ent-s2); right:50px; width:300px; max-height:calc(100% - 16px); overflow:auto;
  padding:var(--ent-s3); background:var(--ent-surface); border:1px solid var(--ent-line); border-radius:var(--ent-r); box-shadow:var(--ent-e2); }
.mw-table { height:220px; flex-shrink:0; border-top:1px solid var(--ent-line); background:var(--ent-surface); }
.mw-readout { display:flex; flex-wrap:wrap; gap:var(--ent-s4); padding:var(--ent-s1) var(--ent-s3); border-top:1px solid var(--ent-line);
  background:var(--ent-surface); font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); color:var(--ent-text-2); }
.mw-readout b { font-family:var(--ent-font); font-weight:var(--ent-fw-semibold); color:var(--ent-text-3); margin-right:4px; }
@media (max-width: 1023px) {
  .mw-side { width:230px; }
  .mw-identify { right:var(--ent-s2); width:260px; }
}
</style>
