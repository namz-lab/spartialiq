<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────
// Planning Studio — a CAD drafting workspace, decoupled from the basemap.
// The parcel boundary is sketched on a clean dark grid canvas in LOCAL SURVEY
// COORDINATES (metres east/north from the parcel's SW corner). The planner draws
// streets, generates stands, reserves civic sites, allocates uses — then "Export to
// Map" saves the proposal back to GIS and returns to the geographic planner.
//
// Implementation note: the canvas is still a MapLibre instance with the basemap
// hidden (dark background + synced grid overlay). Keeping the map engine means the
// geometry stays georeferenced, so Export to Map round-trips exactly — versus a
// from-scratch planar engine. To the planner it reads as a CAD canvas.
// ─────────────────────────────────────────────────────────────────────────
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import maplibregl from 'maplibre-gl'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { usePlanningTools } from '@/planning/usePlanningTools'
import { usePlanningStudio } from '@/planning/usePlanningStudio'
import { useWorkspaceHistory } from '@/planning/useWorkspaceHistory'
import { useStudioSnapping } from '@/planning/useStudioSnapping'
import { useStudioInput, parseDynamic, resolveDynamic, constrainBearing } from '@/planning/useStudioInput'
import { arcThrough } from '@/planning/cad/cadArc'
import { saveDraft, loadDraft, clearDraft, type StudioDraft } from '@/planning/useLocalDraft'
import { useCadDocument } from '@/planning/cad/useCadDocument'
import { addCadLayers, addGripLayer, addDimensionLayers, addSymbolLayers, addHatchLayers, syncCad, syncDimensions, syncSymbols, syncHatch, setCadSelected, CAD_LAYER_IDS, DIM_LAYER_IDS, SYMBOL_LAYER_IDS, HATCH_LAYER_IDS } from '@/planning/cad/cadRender'
import { SYMBOL_LIST } from '@/planning/cad/cadSymbols'
import { attachXref, setXrefVisible, type XrefLayer } from '@/planning/cad/cadXref'
import { getTileLayerCatalog } from '@/services/vectorTiles'
import type { HatchPattern } from '@/planning/cad/cadModel'
import { useCadGrips } from '@/planning/cad/useCadGrips'
import { findVertexAt, offsetFromPoint } from '@/planning/cad/cadDimension'
import type { DimAnchor } from '@/planning/cad/cadModel'
import { plotLayoutPdf } from '@/planning/cad/cadLayoutPdf'
import type { PaperName, Orientation } from '@/planning/cad/cadLayout'
import type { LotUseType, RoadHierarchy } from '@/planning/planning-types'
import { mpColor } from '@/map/masterplanSymbology'
import CadInterchangeDialog from '@/components/planner/CadInterchangeDialog.vue'
import type { MergePayload } from '@/planning/dxf/types'
import { useAuthStore } from '@/stores/auth'
import {
  ArrowLeft, Save, Upload, Undo2, Redo2,
  MousePointer2, Square, Circle, Minus, Slash, Crop, Trash2, Ruler,
  Gavel, Layers, Eye, EyeOff, Lock, LockOpen, Play, Grid2x2, LayoutGrid, ArrowLeftRight, Printer, Type, MessageSquare, Compass, PaintBucket,
  PenLine, Spline as ArcIcon, AlertTriangle, CheckCircle2,
  Scissors, MoveRight, CornerUpRight, Triangle, Keyboard, X, ChevronRight,
  CircleAlert, CircleCheck, Loader2, SquareStack, Map as MapIcon,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const mapEl = ref<HTMLElement | null>(null)
let map: any = null

const planning = usePlanningTools()
const studio = usePlanningStudio(planning)
const history = useWorkspaceHistory(planning)
const auth = useAuthStore()
const exportedBy = computed(() => auth.userName || auth.userEmail || 'Planner')

// ── CAD drafting document (lines/polylines/rectangles/circles on layers) ─────
const cad = useCadDocument()

// Precision drafting (ortho/polar/grid + dynamic length/bearing entry).
const input = useStudioInput()
// Snapping now also snaps to drawn CAD geometry + the metre grid.
const snapping = useStudioSnapping(() => map, planning, {
  getCadEntities: () => cad.entities.value,
  getOrigin: () => origin,
  getGridStepM: () => input.state.gridStepM,
  gridEnabled: () => snapOn.value && gridOn.value,
})
const currentLayer = ref<string>(cad.layers.value[0]?.id || 'roads')
const grips = useCadGrips(cad, () => map)
// keep the on-map selection highlight in sync with the document selection
watch(() => cad.selection.value.slice(), (cur, prev) => {
  for (const id of (prev || [])) if (map) setCadSelected(map, id, false)
  for (const id of cur) if (map) setCadSelected(map, id, true)
})

// Crash-recovery local draft, keyed by the parcel being drafted (V1 DoD #4).
const draftKey = `${String(route.params.layer || '')}/${String(route.params.fid || '')}`
const recoverable = ref<StudioDraft | null>(null)
let draftTimer: ReturnType<typeof setTimeout> | null = null
function queueLocalDraft() {
  if (!planning.planningArea.value) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => { saveDraft(draftKey, { ...planning.snapshot(), cad: cad.snapshot() }) }, 1500)
}
function restoreDraft() {
  const snap: any = recoverable.value?.snapshot
  if (snap) {
    planning.restore(snap)
    if (snap.cad) cad.load(snap.cad)
    showToast('Recovered your unsaved work')
  }
  recoverable.value = null
}
function dismissDraft() { clearDraft(draftKey); recoverable.value = null }

// ── local survey coordinate frame (metres from parcel SW corner) ─────────────
let origin: [number, number] | null = null
function setOrigin() {
  const a = planning.planningArea.value
  if (!a) return
  const bb = turf.bbox(turf.feature(a.geom as any))
  origin = [bb[0], bb[1]]
}
function toLocal(lngLat: [number, number]): { x: number; y: number } {
  if (!origin) return { x: 0, y: 0 }
  const east = turf.distance([origin[0], lngLat[1]], [lngLat[0], lngLat[1]], { units: 'meters' }) * (lngLat[0] >= origin[0] ? 1 : -1)
  const north = turf.distance([lngLat[0], origin[1]], [lngLat[0], lngLat[1]], { units: 'meters' }) * (lngLat[1] >= origin[1] ? 1 : -1)
  return { x: east, y: north }
}

// ── UI state ─────────────────────────────────────────────────────────────────
type Tool = 'select' | 'line' | 'polyline' | 'arc' | 'rectangle' | 'circle' | 'road' | 'reserve' | 'measure'
  | 'trim' | 'extend' | 'fillet' | 'chamfer' | 'dimension' | 'text' | 'leader' | 'symbol' | 'hatch'
const tool = ref<Tool>('select')
const gridOn = ref(true)
const snapOn = ref(true)
const scaleDenom = ref(500)   // live map scale (1:scaleDenom), updated on pan/zoom
const gridPos = reactive({ x: 0, y: 0 })
const coord = reactive({ x: 0, y: 0 })          // local survey coords under cursor
const tracker = reactive({ x: 0, y: 0, show: false })
const command = ref('')
const reserveUse = ref<LotUseType>('school')
// symbol insertion: active symbol + optional size override (blank = library default)
const symbolList = SYMBOL_LIST
const activeSymbol = ref<string>('north_arrow')
const symbolSizeM = ref<number | ''>('')

// hatch (land-use fills): pattern + colour + angle/spacing, with land-use
// presets on the statutory master-plan colour schedule (masterplanSymbology).
const hatch = reactive<{ pattern: HatchPattern; color: string; angleDeg: number; spacingM: number; landuse: string }>(
  { pattern: 'lines', color: mpColor('Yellow-Brown 3'), angleDeg: 45, spacingM: 4, landuse: 'agriculture' })
const HATCH_PRESETS: Array<{ id: string; label: string; pattern: HatchPattern; color: string }> = [
  { id: 'residential', label: 'Residential', pattern: 'solid', color: mpColor('Yellow 2') },       // dwelling houses
  { id: 'commercial', label: 'Commercial', pattern: 'cross', color: mpColor('Blue 1') },           // shops/business
  { id: 'industrial', label: 'Industrial', pattern: 'cross', color: mpColor('Red-Purple 1') },     // general industry
  { id: 'open_space', label: 'Open space', pattern: 'dots', color: mpColor('Green 1') },           // public open space
  { id: 'agriculture', label: 'Agriculture', pattern: 'lines', color: mpColor('Yellow-Brown 3') }, // cultivated farm land
  { id: 'water', label: 'Water', pattern: 'lines', color: '#6699cc' },                             // hydrology (basemap water stroke)
]
function applyHatchPreset(id: string) {
  const p = HATCH_PRESETS.find(x => x.id === id); if (!p) return
  hatch.pattern = p.pattern; hatch.color = p.color; hatch.landuse = p.id
}
function hatchSpec() {
  return { pattern: hatch.pattern, angleDeg: hatch.angleDeg, spacingM: hatch.spacingM, color: hatch.color, landuse: hatch.landuse }
}
function hatchSelection() {
  const polys = cad.selectedEntities.value.filter(e => e.geom.type === 'Polygon' || e.geom.type === 'MultiPolygon')
  if (!polys.length) return showToast('Select a closed shape to hatch', 'error')
  for (const p of polys) cad.addHatch(p.geom, hatchSpec())
  showToast(`Hatched ${polys.length} shape(s)`)
}

// Xref — reference context underlays (existing buildings/roads/water/parcels…)
const xrefLayers = ref<XrefLayer[]>([])
function toggleXref(l: XrefLayer) {
  if (!map) return
  setXrefVisible(map, l, !l.visible)
  xrefLayers.value = [...xrefLayers.value]
}

const toast = ref<{ msg: string; type: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, type = 'success') {
  toast.value = { msg, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3000)
}

// The tool rail, grouped the way a drafter thinks: select → draw → plan →
// annotate → measure → modify. Grouping is presentation only; the ids are the
// same `Tool` values the canvas handlers already switch on.
type RailItem = { id: Tool; icon: any; label: string; key?: string; hint: string }
const TOOL_GROUPS: Array<{ id: string; label: string; items: RailItem[] }> = [
  { id: 'select', label: 'Select', items: [
    { id: 'select', icon: MousePointer2, label: 'Select', key: 'V', hint: 'Select drawn objects and stands' },
  ] },
  { id: 'draw', label: 'Draw', items: [
    { id: 'line', icon: Minus, label: 'Line', key: 'L', hint: 'Two clicks — type a length/bearing for exact input' },
    { id: 'polyline', icon: PenLine, label: 'Polyline', key: 'P', hint: 'Click points, double-click to finish' },
    { id: 'arc', icon: ArcIcon, label: 'Arc', key: 'A', hint: 'Start, through, end — curved roads and cul-de-sacs' },
    { id: 'rectangle', icon: Square, label: 'Rectangle', key: 'R', hint: 'Two opposite corners' },
    { id: 'circle', icon: Circle, label: 'Circle', key: 'C', hint: 'Centre, then radius' },
  ] },
  { id: 'plan', label: 'Plan', items: [
    { id: 'road', icon: Slash, label: 'Street', hint: 'Draw a street centreline, double-click to finish' },
    { id: 'reserve', icon: Crop, label: 'Reserve', hint: 'Two corners — reserve a facility site; stands flow around it' },
  ] },
  { id: 'annotate', label: 'Annotate', items: [
    { id: 'dimension', icon: ArrowLeftRight, label: 'Dimension', key: 'D', hint: 'Two points, then the offset side — snaps to vertices' },
    { id: 'text', icon: Type, label: 'Text', key: 'T', hint: 'Click, then type a label' },
    { id: 'leader', icon: MessageSquare, label: 'Leader', hint: 'Click the feature, then where the note goes' },
    { id: 'symbol', icon: Compass, label: 'Symbol', hint: 'Place the symbol chosen in the inspector' },
    { id: 'hatch', icon: PaintBucket, label: 'Hatch', key: 'H', hint: 'Draw a boundary, double-click to close — fills with the land-use pattern' },
  ] },
  { id: 'measure', label: 'Measure', items: [
    { id: 'measure', icon: Ruler, label: 'Measure', key: 'M', hint: 'Distance between two points' },
  ] },
  { id: 'modify', label: 'Modify', items: [
    { id: 'trim', icon: Scissors, label: 'Trim', hint: 'Click the cutting edge, then the part to remove' },
    { id: 'extend', icon: MoveRight, label: 'Extend', hint: 'Click the boundary, then the line end to extend' },
    { id: 'fillet', icon: CornerUpRight, label: 'Fillet', hint: 'Round a corner at the radius set in the inspector' },
    { id: 'chamfer', icon: Triangle, label: 'Chamfer', hint: 'Cut a corner at the distance set in the inspector' },
  ] },
]
const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'V', action: 'Select tool' },
  { keys: 'L', action: 'Line' },
  { keys: 'P', action: 'Polyline' },
  { keys: 'A', action: 'Arc' },
  { keys: 'R', action: 'Rectangle' },
  { keys: 'C', action: 'Circle' },
  { keys: 'M', action: 'Measure' },
  { keys: 'D', action: 'Dimension' },
  { keys: 'T', action: 'Text' },
  { keys: 'H', action: 'Hatch' },
  { keys: 'G', action: 'Generate stands' },
  { keys: 'Delete', action: 'Delete selection' },
  { keys: 'Ctrl + Z', action: 'Undo' },
  { keys: 'Ctrl + Y', action: 'Redo' },
  { keys: 'Esc', action: 'Cancel the current operation' },
  { keys: '?', action: 'This shortcut list' },
]
const useList = computed(() => Object.values(planning.standards.uses))
const m = computed(() => planning.metrics.value)

// ── workstation shell state (presentation only) ──────────────────────────────
type PanelTab = 'inspect' | 'plan' | 'layers'
const panelTab = ref<PanelTab>('inspect')
const PANEL_TABS: Array<{ id: PanelTab; label: string; icon: any }> = [
  { id: 'inspect', label: 'Inspector', icon: SquareStack },
  { id: 'plan', label: 'Planning', icon: Gavel },
  { id: 'layers', label: 'Layers', icon: Layers },
]
const showShortcuts = ref(false)
const saveFailed = ref(false)
/** Save state, spelled out in words as well as colour (never colour alone). */
const saveState = computed(() => {
  if (history.saving.value) return { key: 'saving', label: 'Saving…', icon: Loader2 }
  if (saveFailed.value) return { key: 'failed', label: 'Save failed', icon: CircleAlert }
  if (planning.dirty.value) return { key: 'unsaved', label: 'Unsaved changes', icon: CircleAlert }
  return { key: 'saved', label: 'Saved', icon: CircleCheck }
})
watch(() => planning.dirty.value, (d) => { if (d) saveFailed.value = false })

/** Read-out for the selected CAD object(s): type, layer, and measured size.
 *  Everything here is derived from the geometry already in the document. */
const selInfo = computed(() => {
  const es = cad.selectedEntities.value
  if (!es.length) return null
  const types = new Set(es.map(e => e.type))
  const layerIds = new Set(es.map(e => e.layerId))
  const layer = cad.layers.value.find(l => l.id === es[0].layerId)
  let lengthM = 0, areaSqm = 0, vertices = 0
  for (const e of es) {
    const f = { type: 'Feature' as const, geometry: e.geom, properties: {} }
    try {
      if (e.geom.type === 'LineString' || e.geom.type === 'MultiLineString') lengthM += turf.length(f as any, { units: 'meters' })
      else if (e.geom.type === 'Polygon' || e.geom.type === 'MultiPolygon') {
        areaSqm += turf.area(f as any)
        lengthM += turf.length(turf.polygonToLine(f as any) as any, { units: 'meters' })
      }
    } catch { /* degenerate geometry — leave the measure out rather than guess */ }
    const c: any = (e.geom as any).coordinates
    if (e.geom.type === 'LineString') vertices += c.length
    else if (e.geom.type === 'Polygon') vertices += (c[0]?.length || 0)
    else if (e.geom.type === 'Point') vertices += 1
  }
  return {
    count: es.length,
    type: types.size === 1 ? [...types][0] : 'mixed',
    layerName: layerIds.size === 1 ? (layer?.name || es[0].layerId) : 'multiple layers',
    layerId: layerIds.size === 1 ? es[0].layerId : '',
    layerColor: layerIds.size === 1 ? (layer?.color || '') : '',
    lengthM, areaSqm, vertices,
    text: es.length === 1 ? (es[0].text || '') : '',
  }
})
function setSelectionLayer(id: string) {
  if (!id || !cad.selection.value.length) return
  cad.setEntityLayer([...cad.selection.value], id)
}
// Compliance-driven layout: the headline score + the failing checks, each with the
// offending features so the planner can jump to and fix them.
const compliance = computed(() => planning.complianceScore.value)
const failingChecks = computed(() => planning.validation.value.checks.filter(c => !c.pass))
/** Highlight + zoom to the features a failing check flags, and select the stands
 *  so the existing "To selected" use/merge tools act on exactly that set. */
function showFailing(check: any) {
  const lotIds: string[] = check.lotIds || []
  const roadIds: string[] = check.roadIds || []
  planning.clearMergeSelection()
  for (const id of lotIds) planning.toggleMergeSelection(id)
  for (const r of planning.roads.value) {
    try { map?.setFeatureState({ source: 'pl-roads', id: r.id }, { selected: roadIds.includes(r.id) }) } catch { /* */ }
  }
  const geoms = [
    ...planning.lots.value.filter(l => lotIds.includes(l.id)).map(l => l.geom),
    ...planning.roads.value.filter(r => roadIds.includes(r.id)).map(r => r.geom),
  ]
  if (geoms.length && map) {
    try {
      const bb = turf.bbox({ type: 'FeatureCollection', features: geoms.map(g => ({ type: 'Feature', geometry: g, properties: {} })) } as any)
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]] as any, { padding: 80, duration: 400, maxZoom: 19 })
    } catch { /* */ }
  }
  showToast(`${check.label} — ${check.detail || ''}`.trim(), 'error')
}

// ── Neighbourhood wizard (road templates + one-click Generate Neighbourhood) ──
const zoneList = computed(() => Object.values(planning.standards.zones))
const nbhd = reactive({ spine: true, school: true, spacingM: 0 })  // spacingM 0 = auto from zone
function genTemplate(kind: 'grid' | 'spine' | 'ring' | 'perimeter') {
  if (!planning.planningArea.value) { showToast('Select a parcel first', 'error'); return }
  const n = planning.generateRoadTemplate(kind)
  showToast(n ? `${n} ${kind} road${n > 1 ? 's' : ''} added` : 'No roads generated for this parcel', n ? 'success' : 'error')
}
function genNeighbourhood() {
  if (!planning.planningArea.value) { showToast('Select a parcel first', 'error'); return }
  planning.generateNeighbourhood({
    spine: nbhd.spine,
    facilities: nbhd.school ? ['school'] : [],
    spacingM: nbhd.spacingM > 0 ? nbhd.spacingM : undefined,
  })
  showToast(`Neighbourhood generated · ${planning.metrics.value.lotCount} stands`)
}

// ── drafting interactions ────────────────────────────────────────────────────
const draftPts = ref<[number, number][]>([])
const PREVIEW = 'studio-preview'
const emptyFC = () => ({ type: 'FeatureCollection' as const, features: [] as any[] })
function setPreview(fc: any) { const s = map?.getSource(PREVIEW); if (s) s.setData(fc) }
function drawPreview(closed = false, ghost?: [number, number]) {
  const pts = ghost ? [...draftPts.value, ghost] : draftPts.value
  const feats: any[] = pts.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }))
  if (pts.length >= 2) {
    const coords = closed ? [...pts, pts[0]] : pts
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
  }
  setPreview({ type: 'FeatureCollection', features: feats })
}
function resetDraft() { draftPts.value = []; setPreview(emptyFC()) }

// Dynamic dimensional entry: type an exact length (and optional bearing) to place
// the next vertex. Synthesises a click at the computed point so every draw tool
// gets precise input for free.
const cursorLngLat = ref<[number, number] | null>(null)
const dyn = reactive({ value: '' })
const drawToolActive = computed(() => DRAW_TOOLS.has(tool.value))
function submitDynamic() {
  const parsed = parseDynamic(dyn.value); dyn.value = ''
  if (!parsed || !map) return
  const from = (draftPts.value[draftPts.value.length - 1] || cursorLngLat.value) as [number, number] | null
  if (!from) return showToast('Click a start point first, then type a length', 'error')
  const p = resolveDynamic(from, (cursorLngLat.value || from), parsed)
  onCanvasClick({ lngLat: { lng: p[0], lat: p[1] }, point: map.project(p as any), _synthetic: true })
}
/** Live length/bearing of the segment being drawn — the CAD dynamic read-out.
 *  Mirrors the ortho/polar constraint so it shows what will actually be drawn. */
const liveDim = computed(() => {
  const last = draftPts.value[draftPts.value.length - 1]
  const cur = cursorLngLat.value
  if (!last || !cur || !drawToolActive.value) return null
  const to = (input.state.ortho || input.state.polar)
    ? constrainBearing(last, cur, { ortho: input.state.ortho, polar: input.state.polar, stepDeg: input.state.polarStepDeg })
    : cur
  try {
    const len = turf.distance(last, to, { units: 'meters' })
    const brg = (turf.bearing(last, to) + 360) % 360
    return { len, brg }
  } catch { return null }
})

function addReserveRect(a: [number, number], b: [number, number]) {
  const ring = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]]
  const poly = turf.polygon([ring])
  const c = planning.addFacilityReserve(poly.geometry as any, reserveUse.value)
  planning.runBlocks()
  showToast(`${c.label} site reserved — stands will avoid it`)
}

function rectRing(a: [number, number], b: [number, number]) {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]]
}
// tools that finish on a double-click rather than a fixed click count
const MULTI_CLICK = new Set<Tool>(['road', 'polyline', 'hatch'])
const EDIT_TOOLS = new Set<Tool>(['trim', 'extend', 'fillet', 'chamfer'])

// Two-stage edit picks (trim needs a cutter; extend needs a target).
const pick = reactive({ cutterId: '', targetId: '' })
// in-progress dimension anchors (click A, click B, then click the offset side)
const dimPick = reactive<{ a: DimAnchor | null; b: DimAnchor | null }>({ a: null, b: null })

// Floating text entry for the Text / Leader tools. `target` is set for a leader
// (the pointed-at feature); `anchor` is where the label sits.
const textEntry = reactive<{
  open: boolean; screenX: number; screenY: number; value: string
  mode: 'text' | 'leader'; anchor: [number, number] | null; target: [number, number] | null
}>({ open: false, screenX: 0, screenY: 0, value: '', mode: 'text', anchor: null, target: null })
const textInputEl = ref<HTMLInputElement | null>(null)
function openTextEntry(mode: 'text' | 'leader', anchor: [number, number], screen: { x: number; y: number }, target: [number, number] | null = null) {
  textEntry.open = true; textEntry.mode = mode; textEntry.value = ''
  textEntry.anchor = anchor; textEntry.target = target
  textEntry.screenX = screen.x; textEntry.screenY = screen.y
  nextTick(() => textInputEl.value?.focus())
}
function commitTextEntry() {
  const v = textEntry.value.trim()
  if (!v || !textEntry.anchor) { cancelTextEntry(); return }
  if (textEntry.mode === 'leader' && textEntry.target) {
    cad.addLeader(textEntry.target, textEntry.anchor, v, 'annotation')
    showToast('Leader added')
  } else {
    cad.addText(textEntry.anchor, v, 'annotation')
    showToast('Text added')
  }
  cancelTextEntry(); resetDraft()
}
function cancelTextEntry() {
  textEntry.open = false; textEntry.value = ''; textEntry.anchor = null; textEntry.target = null
}

function resetPick() { pick.cutterId = ''; pick.targetId = ''; dimPick.a = null; dimPick.b = null; cancelTextEntry() }

/** CAD entity id under a screen point, or null. */
function cadEntityAt(point: any): string | null {
  const ids = CAD_LAYER_IDS.filter((l: string) => map.getLayer(l))
  const hits = map.queryRenderedFeatures(point, { layers: ids })
  return hits.length && hits[0].id != null ? String(hits[0].id) : null
}
function ringCoordsOf(geom: any): number[][] {
  if (!geom) return []
  if (geom.type === 'Polygon') return geom.coordinates[0]
  if (geom.type === 'LineString') return geom.coordinates
  return []
}
/** Index of the polyline/ring vertex nearest a lng/lat point. */
function nearestVertexIdx(geom: any, lngLat: [number, number]): number {
  const ring = ringCoordsOf(geom); let best = -1, bestD = Infinity
  ring.forEach((c, i) => { const d = turf.distance(c, lngLat, { units: 'meters' }); if (d < bestD) { bestD = d; best = i } })
  return best
}
/** Which end of a line is nearer the click. */
function nearestEnd(geom: any, lngLat: [number, number]): 'start' | 'end' {
  const c = geom.coordinates
  const d0 = turf.distance(c[0], lngLat, { units: 'meters' })
  const dN = turf.distance(c[c.length - 1], lngLat, { units: 'meters' })
  return d0 <= dN ? 'start' : 'end'
}

// Tools that build geometry from successive draft points (get ortho/polar/dynamic input).
const DRAW_TOOLS = new Set<Tool>(['line', 'polyline', 'arc', 'rectangle', 'road', 'reserve', 'measure', 'hatch', 'circle'])
function onCanvasClick(e: any) {
  if (textEntry.open) return   // a label is being typed — ignore map clicks
  const raw: [number, number] = [e.lngLat.lng, e.lngLat.lat]
  // Ortho/polar constrains the live segment; object-snap (run last) still overrides it.
  let base = raw
  const last = draftPts.value[draftPts.value.length - 1]
  if (!e._synthetic && last && (input.state.ortho || input.state.polar) && DRAW_TOOLS.has(tool.value)) {
    base = constrainBearing(last, raw, { ortho: input.state.ortho, polar: input.state.polar, stepDeg: input.state.polarStepDeg })
  }
  // Synthetic clicks (typed length/bearing) are already exact — never re-snap them.
  const pt = e._synthetic ? raw : (snapOn.value ? snapping.snap(base, e.point, draftPts.value) : base)
  switch (tool.value) {
    case 'road': draftPts.value.push(pt); drawPreview(); break
    case 'polyline': draftPts.value.push(pt); drawPreview(); break
    case 'arc':
      draftPts.value.push(pt); drawPreview()
      if (draftPts.value.length === 3) {
        const [a, b, c] = draftPts.value
        cad.addEntity('arc', arcThrough(a, b, c) as any, { layerId: currentLayer.value })
        showToast('Arc added'); resetDraft()
      }
      break
    case 'line':
      draftPts.value.push(pt)
      if (draftPts.value.length === 2) {
        cad.addEntity('line', { type: 'LineString', coordinates: [...draftPts.value] }, { layerId: currentLayer.value })
        resetDraft()
      } else drawPreview()
      break
    case 'rectangle':
      draftPts.value.push(pt)
      if (draftPts.value.length === 2) {
        cad.addEntity('rectangle', { type: 'Polygon', coordinates: [rectRing(draftPts.value[0], draftPts.value[1])] }, { layerId: currentLayer.value })
        resetDraft()
      } else drawPreview()
      break
    case 'circle':
      draftPts.value.push(pt)
      if (draftPts.value.length === 2) {
        const km = turf.distance(draftPts.value[0], draftPts.value[1], { units: 'kilometers' }) || 0.01
        const c = turf.circle(draftPts.value[0], km, { steps: 48, units: 'kilometers' })
        cad.addEntity('circle', c.geometry as any, { layerId: currentLayer.value })
        resetDraft()
      } else drawPreview()
      break
    case 'reserve':
      draftPts.value.push(pt)
      if (draftPts.value.length === 2) { addReserveRect(draftPts.value[0], draftPts.value[1]); resetDraft() }
      else drawPreview()
      break
    case 'measure':
      draftPts.value.push(pt); drawPreview()
      if (draftPts.value.length === 2) {
        const d = turf.distance(draftPts.value[0], draftPts.value[1], { units: 'meters' })
        showToast(`Distance: ${d.toFixed(1)} m`); setTimeout(resetDraft, 1200)
      }
      break
    case 'trim': {
      const id = cadEntityAt(e.point); if (!id) break
      if (!pick.cutterId) { pick.cutterId = id; showToast('Cutting edge set — now click the part of a line to remove'); break }
      if (id === pick.cutterId) break
      const ok = cad.trim(id, pick.cutterId, raw)
      showToast(ok ? 'Trimmed' : 'No intersection to trim there', ok ? 'success' : 'error')
      break
    }
    case 'extend': {
      const id = cadEntityAt(e.point); if (!id) break
      if (!pick.targetId) { pick.targetId = id; showToast('Boundary set — now click near the line end to extend'); break }
      if (id === pick.targetId) break
      const ent = cad.byId(id)
      if (ent?.geom.type === 'LineString') {
        const ok = cad.extend(id, pick.targetId, nearestEnd(ent.geom, raw))
        showToast(ok ? 'Extended' : "Couldn't reach the boundary", ok ? 'success' : 'error')
      } else showToast('Extend works on a line', 'error')
      break
    }
    case 'fillet': {
      const id = cadEntityAt(e.point); const ent = id ? cad.byId(id) : null; if (!ent) break
      const ok = cad.fillet(id!, nearestVertexIdx(ent.geom, raw), mod.radius)
      showToast(ok ? `Filleted r=${mod.radius} m` : 'Pick an inner corner', ok ? 'success' : 'error')
      break
    }
    case 'chamfer': {
      const id = cadEntityAt(e.point); const ent = id ? cad.byId(id) : null; if (!ent) break
      const ok = cad.chamfer(id!, nearestVertexIdx(ent.geom, raw), mod.dist)
      showToast(ok ? `Chamfered ${mod.dist} m` : 'Pick an inner corner', ok ? 'success' : 'error')
      break
    }
    case 'dimension': {
      // Snap onto an entity vertex (within ~3 m of the snapped click) → associative.
      const hit = findVertexAt(cad.entities.value, pt as [number, number], 3)
      const at = hit ? hit.lngLat : (pt as [number, number])
      const anchor: DimAnchor = hit
        ? { entityId: hit.entityId, gripPath: hit.gripPath, lngLat: hit.lngLat }
        : { lngLat: at }
      if (!dimPick.a) { dimPick.a = anchor; draftPts.value = [at]; drawPreview(); showToast('Dimension: pick the second point'); break }
      if (!dimPick.b) { dimPick.b = anchor; draftPts.value = [dimPick.a.lngLat!, at]; drawPreview(); showToast('Dimension: click the side to place it'); break }
      const off = offsetFromPoint(dimPick.a.lngLat!, dimPick.b.lngLat!, raw)
      const dim = cad.addDimension(dimPick.a, dimPick.b, off, 'aligned')
      showToast(dim ? `Dimension ${dim.text}` : 'Could not place dimension', dim ? 'success' : 'error')
      dimPick.a = null; dimPick.b = null; resetDraft()
      break
    }
    case 'text':
      openTextEntry('text', pt as [number, number], e.point)
      break
    case 'leader':
      if (!draftPts.value.length) {
        draftPts.value = [pt]; drawPreview(); showToast('Leader: click where the note goes')
      } else {
        openTextEntry('leader', pt as [number, number], e.point, draftPts.value[0])
      }
      break
    case 'symbol': {
      const sym = cad.addSymbol(activeSymbol.value, pt as [number, number], { sizeM: symbolSizeM.value || undefined })
      showToast(sym ? `Placed ${sym.text}` : 'Could not place symbol', sym ? 'success' : 'error')
      break
    }
    case 'hatch': draftPts.value.push(pt); drawPreview(true); break
    case 'select': {
      const cadHits = map.queryRenderedFeatures(e.point, { layers: CAD_LAYER_IDS.filter((l: string) => map.getLayer(l)) })
      if (cadHits.length && cadHits[0].id != null) { cad.toggleSelect(String(cadHits[0].id)); break }
      const dimHits = map.queryRenderedFeatures(e.point, { layers: DIM_LAYER_IDS.filter((l: string) => map.getLayer(l)) })
      if (dimHits.length && dimHits[0].properties?.id) { cad.toggleSelect(String(dimHits[0].properties.id)); break }
      const symHits = map.queryRenderedFeatures(e.point, { layers: SYMBOL_LAYER_IDS.filter((l: string) => map.getLayer(l)) })
      if (symHits.length && symHits[0].properties?.id) { cad.toggleSelect(String(symHits[0].properties.id)); break }
      const hatchHits = map.queryRenderedFeatures(e.point, { layers: HATCH_LAYER_IDS.filter((l: string) => map.getLayer(l)) })
      if (hatchHits.length && hatchHits[0].properties?.id) { cad.toggleSelect(String(hatchHits[0].properties.id)); break }
      const lotHits = map.queryRenderedFeatures(e.point, { layers: map.getLayer('pl-lot-fill') ? ['pl-lot-fill'] : [] })
      if (lotHits.length && lotHits[0].id != null) planning.toggleMergeSelection(String(lotHits[0].id))
      break
    }
  }
}
function onCanvasDblClick(e: any) {
  if (tool.value === 'road') {
    e.preventDefault?.()
    if (draftPts.value.length >= 2) {
      planning.addRoad({ type: 'LineString', coordinates: [...draftPts.value] }, { hierarchy: 'local', widthM: 12 })
      showToast('Street added — draw more, then Generate stands')
    }
    resetDraft()
  } else if (tool.value === 'polyline') {
    e.preventDefault?.()
    if (draftPts.value.length >= 2) {
      cad.addEntity('polyline', { type: 'LineString', coordinates: [...draftPts.value] }, { layerId: currentLayer.value })
    }
    resetDraft()
  } else if (tool.value === 'hatch') {
    e.preventDefault?.()
    if (draftPts.value.length >= 3) {
      const ring = [...draftPts.value, draftPts.value[0]]
      cad.addHatch({ type: 'Polygon', coordinates: [ring] }, hatchSpec())
      showToast('Hatch added')
    }
    resetDraft()
  }
}

watch(tool, (t) => {
  resetDraft(); resetPick()
  if (!map) return
  if (MULTI_CLICK.has(t)) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable()
  planning.tool.value = t === 'road' ? 'draw-road' : 'idle'
  map.getCanvas().style.cursor = t === 'select' ? '' : 'crosshair'
})
const editHint = computed(() => {
  if (tool.value === 'trim') return pick.cutterId ? 'Trim: click the part of a line to remove' : 'Trim: click the cutting edge first'
  if (tool.value === 'extend') return pick.targetId ? 'Extend: click near the line end to extend' : 'Extend: click the boundary first'
  if (tool.value === 'fillet') return 'Fillet: click a corner of a polyline/shape'
  if (tool.value === 'chamfer') return 'Chamfer: click a corner of a polyline/shape'
  return ''
})
function pickTool(t: Tool) { tool.value = t }
function deleteSelection() {
  if (cad.selection.value.length) { const n = cad.selection.value.length; cad.deleteEntities(); showToast(`Deleted ${n} object(s)`) }
}

// ── CAD Modify (transforms on the selection — engine ops from CAD-1a) ────────
const mod = reactive({ dx: 10, dy: 0, deg: 90, k: 1.5, dist: 6, count: 4, radius: 8 })
const cadColor = ref('#1a73e8')
function applyColor() { if (cad.selection.value.length) cad.setEntityStyle([...cad.selection.value], { color: cadColor.value }) }
function applyMatchProps() {
  if (cad.selection.value.length < 2) return showToast('Select 2+ objects (first = source)', 'error')
  const [src, ...rest] = cad.selection.value
  cad.matchProperties(src, rest); showToast('Properties matched')
}
function doJoin() {
  const n = cad.joinSelected(0.5)
  showToast(n ? `Joined into ${n} polyline(s)` : 'Select 2+ connected lines to join', n ? 'success' : 'error')
}
function doExplode() {
  const n = cad.explodeSelected()
  showToast(n ? `Exploded into ${n} part(s)` : 'Select object(s) to explode', n ? 'success' : 'error')
}
const cadSelCount = computed(() => cad.selection.value.length)
function selCentroid(): [number, number] | null {
  const geoms = cad.selectedEntities.value.map(e => ({ type: 'Feature' as const, geometry: e.geom, properties: {} }))
  if (!geoms.length) return null
  try { return turf.centroid({ type: 'FeatureCollection', features: geoms } as any).geometry.coordinates as [number, number] } catch { return null }
}
function needSel(): boolean { if (!cadSelCount.value) { showToast('Select object(s) first', 'error'); return false } return true }
function applyMove() { if (needSel()) { cad.move(mod.dx, mod.dy); showToast('Moved') } }
function applyCopy() { if (needSel()) { cad.copy(mod.dx, mod.dy); showToast('Copied') } }
function applyRotate() { const c = selCentroid(); if (c && needSel()) { cad.rotateBy(mod.deg, c); showToast(`Rotated ${mod.deg}°`) } }
function applyScale() { const c = selCentroid(); if (c && needSel()) { cad.scaleBy(mod.k, c); showToast(`Scaled ×${mod.k}`) } }
function applyMirror() {
  const c = selCentroid(); if (!c || !needSel()) return
  const b = turf.destination(c, 100, 0, { units: 'meters' }).geometry.coordinates as [number, number]  // vertical axis through centroid
  cad.mirrorAcross(c, b, true); showToast('Mirrored')
}
function applyArray() { if (needSel()) { cad.array(Math.max(2, mod.count), mod.dx, mod.dy); showToast(`Arrayed ×${mod.count}`) } }
function applyOffset() {
  if (!needSel()) return
  const e = cad.byId(cad.selection.value[0])
  if (!e) return
  // Polygons → JSTS setback (negative = inward); lines → parallel offset.
  const t = e.geom.type
  const r = (t === 'Polygon' || t === 'MultiPolygon')
    ? cad.offsetPolygon(e.id, -Math.abs(mod.dist))
    : cad.offset(e.id, mod.dist)
  showToast(r ? `Offset ${mod.dist} m` : 'Offset failed for this object', r ? 'success' : 'error')
}

// ── Designate: turn a CAD drawing into a planning object (CAD → engine) ──────
// The CAD-3 bridge. A drawn LINE → street (at the chosen hierarchy → reserve width
// from the standards table); a closed SHAPE → reserved facility site / open space /
// manual stand. The drawing is consumed (one source of truth, no duplicate geom).
const designateHierarchy = ref<RoadHierarchy>('local')
const designateName = ref('')                 // optional road name for the label
const culDeSacRadius = ref(9)                 // turning-circle radius (m)
const isPolygon = (t: string) => t === 'Polygon' || t === 'MultiPolygon'
const isLine = (t: string) => t === 'LineString' || t === 'MultiLineString'
function hierarchyFromCadLayer(layerId: string): RoadHierarchy | null {
  const id = String(layerId || '').toLowerCase()
  if (id.includes('arterial')) return 'arterial'
  if (id.includes('collector')) return 'collector'
  if (id.includes('access')) return 'access'
  if (id === 'roads' || id.includes('local')) return 'local'
  return null
}
/** Split a (possibly multi-part) line geometry into individual LineStrings. */
function lineParts(geom: any): any[] {
  if (geom.type === 'LineString') return [geom]
  if (geom.type === 'MultiLineString') return geom.coordinates.map((c: any) => ({ type: 'LineString', coordinates: c }))
  return []
}
function designate(kind: 'road' | 'reserve' | 'open-space' | 'stand') {
  const sel = cad.selectedEntities.value
  if (!sel.length) return showToast('Select drawn object(s) first', 'error')
  const consumed: string[] = []
  let n = 0
  for (const e of sel) {
    const gt = e.geom.type
    if (kind === 'road' && isLine(gt)) {
      const hierarchy = hierarchyFromCadLayer(e.layerId) || designateHierarchy.value
      for (const lg of lineParts(e.geom)) planning.addRoad(lg, { hierarchy, name: designateName.value.trim() || undefined })
      n++; consumed.push(e.id)
    } else if (kind === 'reserve' && isPolygon(gt)) {
      planning.addFacilityReserve(e.geom as any, reserveUse.value); n++; consumed.push(e.id)
    } else if (kind === 'open-space' && isPolygon(gt)) {
      planning.addOpenSpace(e.geom as any, 'park'); n++; consumed.push(e.id)
    } else if (kind === 'stand' && gt === 'Polygon') {
      planning.addManualLot(e.geom as any, { useType: reserveUse.value }); n++; consumed.push(e.id)
    }
  }
  if (!n) {
    return showToast(
      kind === 'road' ? 'Designate roads from lines/polylines'
      : kind === 'stand' ? 'Designate a stand from a single closed polygon'
      : 'Designate from a closed shape (rectangle/circle/polygon)', 'error')
  }
  // Refresh blocks so generated stands flow around the new reserve/open-space/stand.
  if (kind !== 'road') planning.runBlocks()
  cad.deleteEntities(consumed)                    // the drawing becomes a planning object
  showToast(`Designated ${n} object(s) as ${kind.replace('-', ' ')}`)
}

/** Add a turning-circle (cul-de-sac bulb) at the far end of the selected line/road.
 *  ponytail: a scale-true CAD circle on the roads layer (the drafting glyph a plan
 *  needs). Structural road-widening geometry is a later upgrade if the engine grows one. */
function addCulDeSac() {
  const e = cad.selectedEntities.value.find(x => x.geom.type === 'LineString')
  if (!e) return showToast('Select a road/line first — the bulb goes at its far end', 'error')
  const cs = (e.geom as any).coordinates
  const end = cs[cs.length - 1] as [number, number]
  const circle = turf.circle(end, Math.max(4, culDeSacRadius.value) / 1000, { steps: 32, units: 'kilometers' })
  cad.addEntity('circle', circle.geometry as any, { layerId: 'roads' })
  showToast(`Cul-de-sac Ø${culDeSacRadius.value * 2} m added at the road end`)
}

// ── Plot: scale-true paper-space sheet (CAD-3 Layout & Viewports) ────────────
const plot = reactive({
  open: false,
  paper: 'A3' as PaperName,
  orientation: 'landscape' as Orientation,
  scale: 'fit' as 'fit' | number,
  drawingNumber: '',
  planner: '',
  planNumber: '',
  showSchedule: true,
  showCoordinates: true,
})
function openPlot() {
  if (!planning.planningArea.value && !cad.entities.value.length) {
    return showToast('Nothing to plot yet — load a parcel or draw first', 'error')
  }
  plot.open = true
}
function runPlot() {
  try {
    const L = planning.layers.value
    const { scale } = plotLayoutPdf({
      paper: plot.paper,
      orientation: plot.orientation,
      scale: plot.scale === 'fit' ? 'fit' : Number(plot.scale),
      title: planning.projectName.value || 'Subdivision layout',
      drawingNumber: plot.drawingNumber || undefined,
      planner: plot.planner || undefined,
      planNumber: plot.planNumber || undefined,
      showSchedule: plot.showSchedule,
      showCoordinates: plot.showCoordinates,
      planningArea: L.planningArea as any,
      roads: L.roads as any,
      lots: L.lots as any,
      openSpace: L.openSpace as any,
      constraints: L.constraints as any,
      cad: cad.toGeoJSON.value as any,
      dimensions: cad.dimensionsGeoJSON.value as any,
      symbols: cad.symbolsGeoJSON.value as any,
      hatch: cad.hatchGeoJSON.value as any,
    })
    plot.open = false
    showToast(`Plotted ${plot.paper} at 1:${scale}`)
  } catch (e) {
    showToast('Could not generate the plot', 'error')
  }
}

// ── CAD interchange (export package / staged import — never silent merge) ────
const cadxOpen = ref(false)
const cadxRef = ref<{ completeSuccess: (gis: { ok: boolean; revision?: number; conflict?: boolean }) => void } | null>(null)
const canExchangeDxf = computed(() => !!planning.planningArea.value)
function openCadInterchange() { cadxOpen.value = true }
async function onCadMerge(payload: MergePayload) {
  planning.importDxf({ features: payload.planningFeatures }, { dropMissingLots: payload.dropMissingLots })
  for (const os of payload.openSpace) {
    if (os.geometry?.type === 'Polygon') planning.addOpenSpace(os.geometry as any, 'park')
  }
  if (payload.cadItems.length) cad.addEntities(payload.cadItems as any)
  history.commit()
  let gis: { ok: boolean; revision?: number; conflict?: boolean } = { ok: false }
  try {
    const r = await history.saveNow()
    if (r && 'ok' in r && r.ok) gis = { ok: true, revision: (r as any).revision ?? planning.baseRevision.value }
    else if ((r as any)?.reason === 'conflict') gis = { ok: false, conflict: true }
  } catch (e: any) {
    gis = { ok: false, conflict: e?.response?.status === 409 }
  }
  cadxRef.value?.completeSuccess(gis)
  showToast(gis.conflict ? 'Merged locally. GIS save rejected (concurrent revision).' : 'Imported revision merged into the drawing')
}

// Keep the saved project + crash draft in sync with the CAD drawing.
watch([() => cad.entities.value, () => cad.layers.value], () => { planning.cadSnapshot.value = cad.snapshot() }, { deep: true })

// ── lot selection highlight ──────────────────────────────────────────────────
watch(() => planning.mergeSelection.value.slice(), (cur, prev) => {
  for (const id of (prev || [])) { try { map.setFeatureState({ source: 'pl-lots', id }, { selected: false }) } catch { /* */ } }
  for (const id of cur) { try { map.setFeatureState({ source: 'pl-lots', id }, { selected: true }) } catch { /* */ } }
})
const selCount = computed(() => planning.mergeSelection.value.length)
function applyUse(use: LotUseType, toSelected: boolean) {
  if (toSelected) {
    if (!selCount.value) return showToast('Select stands first (Select tool)', 'error')
    planning.assignUseToLots([...planning.mergeSelection.value], use)
    showToast(`Applied ${use.replace(/_/g, ' ')} to ${selCount.value} stand(s)`)
  } else {
    if (!planning.lots.value.length) return showToast('Generate stands first', 'error')
    planning.assignUseToAll(use)
    showToast(`Applied ${use.replace(/_/g, ' ')} to all stands`)
  }
}

// ── grid sync (keeps the survey grid aligned to the parcel as you pan) ─────────
function syncGrid() {
  if (!map || !origin) return
  const p = map.project(origin)
  gridPos.x = ((p.x % 40) + 40) % 40
  gridPos.y = ((p.y % 40) + 40) % 40
}
// Live map scale from the true ground metres per screen pixel at the map centre
// (measured, so it is correct regardless of latitude/tile math). OGC uses a
// 0.28 mm standard pixel: S = (m per px) / 0.00028.
function updateScale() {
  if (!map) return
  try {
    const c = map.getCenter()
    const a = map.project([c.lng, c.lat] as any)
    const east = turf.destination([c.lng, c.lat], 0.1, 90, { units: 'kilometers' }).geometry.coordinates as [number, number]
    const b = map.project(east as any)
    const px = Math.hypot(b.x - a.x, b.y - a.y)
    if (px > 0) scaleDenom.value = Math.max(1, Math.round(100 / px / 0.00028))
  } catch { /* ignore */ }
}

// ── command line ─────────────────────────────────────────────────────────────
function runCommand() {
  const c = command.value.trim().toLowerCase()
  command.value = ''
  if (!c) return
  if (c === 'l' || c.startsWith('line')) pickTool('line')
  else if (c === 'pl' || c.startsWith('poly')) pickTool('polyline')
  else if (c === 'a' || c.startsWith('arc')) pickTool('arc')
  else if (c.startsWith('rec') || c.startsWith('rect')) pickTool('rectangle')
  else if (c === 'c' || c.startsWith('circ')) pickTool('circle')
  else if (c.startsWith('road')) pickTool('road')
  else if (c.startsWith('res')) pickTool('reserve')
  else if (c.startsWith('meas') || c === 'm') pickTool('measure')
  else if (c.startsWith('dim') || c === 'd') pickTool('dimension')
  else if (c.startsWith('text') || c === 't' || c.startsWith('mtext')) pickTool('text')
  else if (c.startsWith('lead') || c === 'le') pickTool('leader')
  else if (c.startsWith('sym') || c.startsWith('insert') || c.startsWith('block')) pickTool('symbol')
  else if (c.startsWith('hatch') || c === 'h') pickTool('hatch')
  else if (c.startsWith('join') || c === 'j') doJoin()
  else if (c.startsWith('expl') || c === 'x') doExplode()
  else if (c.startsWith('sel') || c === 'v') pickTool('select')
  else if (c === 'e' || c.startsWith('del') || c.startsWith('era')) deleteSelection()
  else if (c.startsWith('block')) { planning.runBlocks(); showToast('Blocks generated') }
  else if (c.startsWith('gen') || c.startsWith('sub')) { planning.runSubdivision(); showToast('Stands generated') }
  else if (c.startsWith('save')) onSaveGis()
  else if (c === 'dxfout' || c.startsWith('export dxf') || c === 'dxfin' || c.startsWith('import dxf') || c.startsWith('cad')) openCadInterchange()
  else showToast(`Unknown command: ${c}`, 'error')
}

// ── lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  if (!mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f8fafc' } }], glyphs: '/fonts/{fontstack}/{range}.pbf' } as any,
    center: [29.82, -19.48], zoom: 12, minZoom: 1, maxZoom: 24,
  })
  map.on('load', async () => {
    if (!map.getSource(PREVIEW)) {
      map.addSource(PREVIEW, { type: 'geojson', data: emptyFC() })
      map.addLayer({ id: 'studio-prev-line', type: 'line', source: PREVIEW, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#1a73e8', 'line-width': 1.5, 'line-dasharray': [2, 1] } })
      map.addLayer({ id: 'studio-prev-pt', type: 'circle', source: PREVIEW, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 3.5, 'circle-color': '#1a73e8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } })
    }
    // Xref reference context (dimmed, hidden underlays beneath everything).
    try { xrefLayers.value = attachXref(map, await getTileLayerCatalog()) } catch { /* tiles offline → no xref */ }

    studio.attach(map)

    // CAD drafting layer (lines/polylines/rectangles/circles) on top of the canvas.
    addHatchLayers(map)   // beneath the CAD linework (land-use fills)
    addCadLayers(map)
    addDimensionLayers(map)
    addSymbolLayers(map)
    addGripLayer(map)
    syncCad(map, cad.toGeoJSON.value as any)
    syncDimensions(map, cad.dimensionsGeoJSON.value as any)
    syncSymbols(map, cad.symbolsGeoJSON.value as any)
    syncHatch(map, cad.hatchGeoJSON.value as any)
    watch(cad.toGeoJSON, (fc) => { if (map) syncCad(map, fc as any) }, { deep: true })
    watch(cad.dimensionsGeoJSON, (fc) => { if (map) syncDimensions(map, fc as any) }, { deep: true })
    watch(cad.symbolsGeoJSON, (fc) => { if (map) syncSymbols(map, fc as any) }, { deep: true })
    watch(cad.hatchGeoJSON, (fc) => { if (map) syncHatch(map, fc as any) }, { deep: true })

    const layer = String(route.params.layer || ''); const fid = Number(route.params.fid)
    if (layer && Number.isFinite(fid)) {
      const ok = await studio.loadParcel(layer, fid)
      if (ok) { setOrigin(); syncGrid() }
      showToast(ok ? 'Parcel sketched — start drafting' : (studio.error.value || 'Could not load parcel'), ok ? 'success' : 'error')
    }

    // Crash recovery: offer to restore a local draft if one has real content.
    try {
      const d = await loadDraft(draftKey)
      const snap: any = d?.snapshot
      if (snap && ((snap.roads?.length || 0) + (snap.lots?.length || 0) + (snap.constraints?.length || 0) + (snap.cad?.entities?.length || 0)) > 0) {
        recoverable.value = d
      }
    } catch { /* ignore */ }

    map.on('mousedown', (e: any) => {
      // Grip drag takes priority: if a grip was hit, suppress map pan + click.
      if (grips.onPointerDown(e)) e.preventDefault()
    })
    map.on('click', onCanvasClick)
    map.on('dblclick', onCanvasDblClick)
    map.on('mousemove', (e: any) => {
      grips.onPointerMove(e)
      const raw: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      cursorLngLat.value = raw
      const l = toLocal(raw); coord.x = l.x; coord.y = l.y
      tracker.x = e.point.x; tracker.y = e.point.y; tracker.show = true
      // Live rubber-band showing the ortho/polar-constrained next segment.
      if (drawToolActive.value && draftPts.value.length && !textEntry.open) {
        const lastP = draftPts.value[draftPts.value.length - 1]
        const ghost = (input.state.ortho || input.state.polar)
          ? constrainBearing(lastP, raw, { ortho: input.state.ortho, polar: input.state.polar, stepDeg: input.state.polarStepDeg })
          : raw
        drawPreview(tool.value === 'hatch', ghost)
      }
    })
    map.on('mouseup', () => grips.onPointerUp())
    map.getCanvas().addEventListener('mouseleave', () => { grips.onPointerUp(); tracker.show = false })
    map.on('move', () => { syncGrid(); updateScale() })
    updateScale()
  })

  window.addEventListener('keydown', onKey)
})
function undoAny() { if (cad.canUndo.value) cad.undo(); else history.undo() }
function redoAny() { if (cad.canRedo.value) cad.redo(); else history.redo() }
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.key === '?') { e.preventDefault(); showShortcuts.value = !showShortcuts.value; return }
  if (e.key === 'Escape') { showShortcuts.value = false; plot.open = false; resetDraft(); resetPick() }
  else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoAny() }
  else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redoAny() }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection()
  else if (e.key === 'v') pickTool('select')
  else if (e.key === 'l') pickTool('line')
  else if (e.key === 'p') pickTool('polyline')
  else if (e.key === 'a') pickTool('arc')
  else if (e.key === 'r') pickTool('rectangle')
  else if (e.key === 'c') pickTool('circle')
  else if (e.key === 'm') pickTool('measure')
  else if (e.key === 'd') pickTool('dimension')
  else if (e.key === 't') pickTool('text')
  else if (e.key === 'h') pickTool('hatch')
  else if (e.key === 'g') { planning.runSubdivision(); showToast('Stands generated') }
}

// Persist a local crash-recovery draft whenever the design changes.
watch(
  [() => planning.roads.value, () => planning.lots.value, () => planning.openSpace.value, () => planning.constraints.value, () => cad.entities.value],
  () => queueLocalDraft(),
)

async function onSaveGis() {
  const r: any = await history.saveNow()
  if (r.ok) { saveFailed.value = false; clearDraft(draftKey); showToast('Saved to GIS') }   // server is now source of truth
  else if (r.reason === 'conflict') { saveFailed.value = true; showToast('A newer version was saved by someone else — reload to merge. Your work is kept locally.', 'error') }
  else { saveFailed.value = true; showToast('Save failed — backend offline?', 'error') }
}
// ── Export to Map: the statutory hand-off ────────────────────────────────
// Saves a 'submitted' revision linked to the launching case (?case=… from the
// planner console); the server writes the case audit event in the same
// transaction. A confirmation sheet replaces the old toast-and-redirect.
const caseId  = String(route.query.case || '') || null
const caseRef = String(route.query.ref || '') || (caseId ? caseId.slice(0, 8).toUpperCase() : null)
const exported = ref<{ revision?: number; lots: number; areaSqm: number; caseRef: string | null } | null>(null)

async function onExportToMap() {
  const r: any = await history.saveNow({ status: 'submitted', ...(caseId ? { permitAppId: caseId } : {}) })
  if (!r.ok) {
    saveFailed.value = true
    showToast(r.reason === 'conflict'
      ? 'Cannot export: a newer version exists — reload to merge first.'
      : 'Export failed — could not save', 'error')
    return
  }
  saveFailed.value = false
  clearDraft(draftKey)
  const linked = r.summary?.permitAppId
  exported.value = {
    revision: r.revision,
    lots: r.summary?.lotCount ?? planning.lots.value.length,
    areaSqm: planning.planningArea.value?.areaSqm || 0,
    caseRef: linked ? (caseRef || String(linked).slice(0, 8).toUpperCase()) : null,
  }
}
function onExit() { router.push('/planner') }

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
  if (draftTimer) clearTimeout(draftTimer)
  window.removeEventListener('keydown', onKey)
  try { map?.remove() } catch { /* ignore */ }
})
</script>

<template>
  <div class="ps">
    <!-- ═══ APPLICATION HEADER ══════════════════════════════════════════════ -->
    <header class="ps-top">
      <div class="ps-ident">
        <span class="ps-mark" aria-hidden="true"><LayoutGrid :size="16" /></span>
        <span class="ps-ident-txt">
          <em>Planning Studio · Drafting</em>
          <strong :title="planning.projectName.value || 'Untitled proposal'">{{ planning.projectName.value || 'Untitled proposal' }}</strong>
        </span>
      </div>

      <dl class="ps-meta">
        <div class="ps-meta-i">
          <dt>Zone</dt>
          <dd>{{ (planning.standards.zones[planning.activeZone.value] || {}).label || '—' }}</dd>
        </div>
        <div class="ps-meta-i">
          <dt>Site area</dt>
          <dd class="mono">{{ planning.planningArea.value ? (planning.planningArea.value.areaSqm / 10000).toFixed(2) + ' ha' : '—' }}</dd>
        </div>
        <div class="ps-meta-i" v-if="caseId" title="This proposal is linked to the statutory case on export">
          <dt>Case</dt>
          <dd class="mono">{{ caseRef }}</dd>
        </div>
      </dl>

      <div class="ps-top-actions">
        <span class="ps-savestate" :class="'is-' + saveState.key" role="status" aria-live="polite">
          <component :is="saveState.icon" :size="13" :class="{ spin: saveState.key === 'saving' }" aria-hidden="true" />
          {{ saveState.label }}
        </span>

        <div class="ps-iconset">
          <button class="ps-icobtn" :disabled="!history.canUndo.value && !cad.canUndo.value" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" @click="undoAny"><Undo2 :size="15" /></button>
          <button class="ps-icobtn" :disabled="!history.canRedo.value && !cad.canRedo.value" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" @click="redoAny"><Redo2 :size="15" /></button>
        </div>

        <button class="ps-btn ps-btn--quiet" title="Plot a scale-true drawing sheet (PDF)" @click="openPlot"><Printer :size="14" /> Plot</button>
        <button class="ps-btn ps-btn--quiet" title="CAD interchange: export a DXF package, import from AutoCAD, review changes, merge a revision" @click="openCadInterchange"><ArrowLeftRight :size="14" /> CAD Interchange</button>
        <button class="ps-btn" title="Save the working revision to GIS" @click="onSaveGis"><Save :size="14" /> Save to GIS</button>
        <button class="ps-btn ps-btn--primary" title="Submit the proposal to GIS and the case file" @click="onExportToMap"><Upload :size="14" /> Export to Map</button>

        <span class="ps-top-sep" aria-hidden="true"></span>
        <button class="ps-btn ps-btn--quiet" title="Return to the planner map" @click="onExit"><ArrowLeft :size="14" /> Exit</button>
      </div>
    </header>

    <div class="ps-body">
      <!-- ═══ TOOL RAIL ════════════════════════════════════════════════════ -->
      <nav class="ps-rail" aria-label="Drafting tools">
        <div v-for="g in TOOL_GROUPS" :key="g.id" class="ps-railgrp">
          <p class="ps-railgrp-h">{{ g.label }}</p>
          <button
            v-for="t in g.items" :key="t.id"
            class="ps-tool" :class="{ 'is-active': tool === t.id }"
            type="button" :aria-pressed="tool === t.id" :aria-label="t.label + (t.key ? ' (' + t.key + ')' : '')"
            :title="t.label + (t.key ? '  [' + t.key + ']' : '') + ' — ' + t.hint"
            @click="pickTool(t.id)"
          >
            <component :is="t.icon" :size="17" aria-hidden="true" />
            <span v-if="t.key" class="ps-tool-key" aria-hidden="true">{{ t.key }}</span>
          </button>
        </div>

        <div class="ps-railfoot">
          <button
            class="ps-tool ps-tool--run" type="button"
            :disabled="!planning.planningArea.value"
            aria-label="Generate stands (G)" title="Generate stands  [G] — subdivide the blocks with the current rules"
            @click="planning.runSubdivision(); showToast('Stands generated')"
          ><Grid2x2 :size="17" aria-hidden="true" /></button>
          <button class="ps-tool" type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts  [?]" @click="showShortcuts = true"><Keyboard :size="17" aria-hidden="true" /></button>
        </div>
      </nav>

      <!-- ═══ MODEL SPACE ══════════════════════════════════════════════════ -->
      <section class="ps-canvas" aria-label="Drafting canvas">
        <div ref="mapEl" class="ps-map"></div>
        <div v-show="gridOn" class="ps-grid" :style="{ backgroundPosition: gridPos.x + 'px ' + gridPos.y + 'px' }" aria-hidden="true"></div>

        <!-- command prompt / operation hint -->
        <div v-if="editHint" class="ps-prompt" role="status">
          <ChevronRight :size="13" aria-hidden="true" />{{ editHint }}<span>Esc to cancel</span>
        </div>
        <div v-if="studio.loading.value" class="ps-prompt is-busy" role="status">
          <Loader2 :size="13" class="spin" aria-hidden="true" />Loading parcel geometry…
        </div>

        <!-- CAD dynamic read-out: survey coordinates, plus live length/bearing -->
        <div v-if="tracker.show" class="ps-hud" :style="{ left: (tracker.x + 16) + 'px', top: (tracker.y + 16) + 'px' }" aria-hidden="true">
          <span class="ps-hud-r"><em>X</em>{{ coord.x.toFixed(2) }}</span>
          <span class="ps-hud-r"><em>Y</em>{{ coord.y.toFixed(2) }}</span>
          <template v-if="liveDim">
            <span class="ps-hud-r is-live"><em>LEN</em>{{ liveDim.len.toFixed(2) }} m</span>
            <span class="ps-hud-r is-live"><em>BRG</em>{{ liveDim.brg.toFixed(1) }}°</span>
          </template>
        </div>

        <!-- in-place label entry (Text / Leader) -->
        <div v-if="textEntry.open" class="ps-textentry" :style="{ left: (textEntry.screenX + 8) + 'px', top: (textEntry.screenY + 8) + 'px' }">
          <input
            ref="textInputEl" v-model="textEntry.value"
            :aria-label="textEntry.mode === 'leader' ? 'Callout text' : 'Label text'"
            :placeholder="textEntry.mode === 'leader' ? 'Callout text…' : 'Label text…'"
            @keydown.enter.prevent="commitTextEntry" @keydown.esc.prevent="cancelTextEntry"
          />
          <button class="ps-textentry-ok" aria-label="Place label (Enter)" title="Place (Enter)" @click="commitTextEntry"><Type :size="13" /></button>
        </div>
      </section>

      <!-- ═══ INSPECTOR ════════════════════════════════════════════════════ -->
      <aside class="ps-side" aria-label="Inspector">
        <div class="ps-tabs" role="tablist" aria-label="Inspector panels">
          <button
            v-for="t in PANEL_TABS" :key="t.id"
            class="ps-tab" :class="{ 'is-active': panelTab === t.id }"
            role="tab" type="button" :aria-selected="panelTab === t.id" @click="panelTab = t.id"
          >
            <component :is="t.icon" :size="14" aria-hidden="true" />{{ t.label }}
          </button>
        </div>

        <!-- ── INSPECT ─────────────────────────────────────────────────── -->
        <div v-show="panelTab === 'inspect'" class="ps-panel" role="tabpanel" aria-label="Inspector">
          <section class="ps-sec">
            <h2 class="ps-sec-h">{{ selInfo ? 'Object properties' : 'Planning context' }}</h2>

            <template v-if="selInfo">
              <p class="ps-selbar">{{ selInfo.count }} object{{ selInfo.count > 1 ? 's' : '' }} selected</p>
              <dl class="ps-props">
                <div><dt>Type</dt><dd>{{ selInfo.type }}</dd></div>
                <div><dt>Vertices</dt><dd class="mono">{{ selInfo.vertices || '—' }}</dd></div>
                <div v-if="selInfo.lengthM"><dt>Length</dt><dd class="mono">{{ selInfo.lengthM.toFixed(2) }} m</dd></div>
                <div v-if="selInfo.areaSqm"><dt>Area</dt><dd class="mono">{{ selInfo.areaSqm.toFixed(1) }} m²</dd></div>
                <div v-if="selInfo.text" class="wide"><dt>Label</dt><dd>{{ selInfo.text }}</dd></div>
              </dl>
              <label class="ps-field">Layer
                <select :value="selInfo.layerId" @change="setSelectionLayer(($event.target as HTMLSelectElement).value)">
                  <option v-if="!selInfo.layerId" value="">multiple layers</option>
                  <option v-for="l in cad.layers.value" :key="l.id" :value="l.id">{{ l.name }}</option>
                </select>
              </label>
              <div class="ps-inline">
                <label class="ps-swatch"><input type="color" v-model="cadColor" aria-label="Object colour" /><span>Colour</span></label>
                <button class="ps-act" @click="applyColor">Apply colour</button>
              </div>
              <div class="ps-row2">
                <button class="ps-act" :disabled="cadSelCount < 2" title="Copy layer and style from the first selected object" @click="applyMatchProps">Match properties</button>
                <button class="ps-act ps-act--danger" @click="deleteSelection"><Trash2 :size="13" /> Delete</button>
              </div>
            </template>

            <template v-else>
              <dl class="ps-props">
                <div class="wide"><dt>Project</dt><dd>{{ planning.projectName.value || 'Untitled proposal' }}</dd></div>
                <div><dt>Zone</dt><dd>{{ (planning.standards.zones[planning.activeZone.value] || {}).label || '—' }}</dd></div>
                <div><dt>Site area</dt><dd class="mono">{{ planning.planningArea.value ? (planning.planningArea.value.areaSqm / 10000).toFixed(2) + ' ha' : '—' }}</dd></div>
                <div><dt>Stands</dt><dd class="mono">{{ m.lotCount }}</dd></div>
                <div><dt>Case</dt><dd class="mono">{{ caseRef || 'Not linked' }}</dd></div>
              </dl>
              <p class="ps-note" v-if="selCount">{{ selCount }} stand{{ selCount > 1 ? 's' : '' }} selected — use Planning ▸ Land use to allocate.</p>
              <p class="ps-note" v-else>Select a drawn object to inspect and modify it, or a stand to allocate a use.</p>
            </template>
          </section>

          <!-- Active drafting layer -->
          <section class="ps-sec">
            <h2 class="ps-sec-h">Drafting</h2>
            <label class="ps-field">Current layer
              <select v-model="currentLayer">
                <option v-for="l in cad.layers.value" :key="l.id" :value="l.id">{{ l.name }}</option>
              </select>
            </label>
            <p class="ps-note">New linework is created on the current layer.</p>
          </section>

          <!-- Transforms — revealed only with a selection -->
          <section class="ps-sec" :class="{ 'is-muted': !cadSelCount }">
            <h2 class="ps-sec-h">Transform<span v-if="cadSelCount" class="ps-sec-badge">{{ cadSelCount }}</span></h2>
            <div class="ps-grid2">
              <label class="ps-field">Δ East (m)<input type="number" v-model.number="mod.dx" /></label>
              <label class="ps-field">Δ North (m)<input type="number" v-model.number="mod.dy" /></label>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" @click="applyMove">Move</button>
              <button class="ps-act" :disabled="!cadSelCount" @click="applyCopy">Copy</button>
            </div>
            <div class="ps-grid2">
              <label class="ps-field">Rotate (°)<input type="number" v-model.number="mod.deg" /></label>
              <label class="ps-field">Scale (×)<input type="number" step="0.1" v-model.number="mod.k" /></label>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" @click="applyRotate">Rotate</button>
              <button class="ps-act" :disabled="!cadSelCount" @click="applyScale">Scale</button>
            </div>
            <div class="ps-grid2">
              <label class="ps-field">Offset (m)<input type="number" v-model.number="mod.dist" /></label>
              <label class="ps-field">Array count<input type="number" min="2" v-model.number="mod.count" /></label>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" title="Polygons set back inward; lines offset parallel" @click="applyOffset">Offset</button>
              <button class="ps-act" :disabled="!cadSelCount" title="Repeat the selection by the Δ above" @click="applyArray">Array</button>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" title="Mirror across a vertical axis through the selection centroid" @click="applyMirror">Mirror</button>
              <button class="ps-act" :disabled="!cadSelCount" title="Break into segments / parts" @click="doExplode">Explode</button>
            </div>
            <button class="ps-act ps-act--wide" :disabled="cadSelCount < 2" title="Merge connected lines into one polyline" @click="doJoin">Join into polyline</button>
          </section>

          <!-- Corner / edit tool parameters -->
          <section class="ps-sec">
            <h2 class="ps-sec-h">Corner &amp; edit settings</h2>
            <div class="ps-grid2">
              <label class="ps-field">Fillet r (m)<input type="number" v-model.number="mod.radius" /></label>
              <label class="ps-field">Chamfer d (m)<input type="number" v-model.number="mod.dist" /></label>
            </div>
            <p class="ps-note">Trim, Extend, Fillet and Chamfer are picked on the canvas — choose the tool in the Modify group, then click the geometry.</p>
          </section>

          <!-- CAD → planning bridge -->
          <section class="ps-sec ps-designate" :class="{ 'is-muted': !cadSelCount }">
            <h2 class="ps-sec-h">Designate</h2>
            <p class="ps-flow" aria-hidden="true"><span>CAD drawing</span><ChevronRight :size="12" /><span>designate</span><ChevronRight :size="12" /><span class="is-out">Planning object</span></p>
            <label class="ps-field">Road class
              <select v-model="designateHierarchy">
                <option value="arterial">Arterial</option>
                <option value="collector">Collector</option>
                <option value="local">Local</option>
                <option value="access">Access</option>
              </select>
            </label>
            <label class="ps-field">Road name (optional)
              <input v-model="designateName" placeholder="e.g. Acacia Street" />
            </label>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" title="Lines and polylines become subdivision streets at the road class above" @click="designate('road')">Road</button>
              <button class="ps-act" :disabled="!cadSelCount" title="Closed shape becomes a reserved facility site of the use type set in Planning ▸ Land use" @click="designate('reserve')">Reserve</button>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!cadSelCount" title="Closed shape becomes public open space" @click="designate('open-space')">Open space</button>
              <button class="ps-act" :disabled="!cadSelCount" title="Closed polygon becomes a stand" @click="designate('stand')">Stand</button>
            </div>
            <div class="ps-inline">
              <label class="ps-field ps-field--tight">Bulb radius (m)<input type="number" min="4" step="1" v-model.number="culDeSacRadius" /></label>
              <button class="ps-act" :disabled="!cadSelCount" title="Turning circle at the far end of the selected road/line" @click="addCulDeSac">Cul-de-sac</button>
            </div>
            <p class="ps-note">Linework on Arterial, Collector, Local street, or Access is designated at that class. Otherwise the road class above is used.</p>
          </section>

          <details class="ps-fold">
            <summary>Symbols</summary>
            <label class="ps-field">Symbol
              <select v-model="activeSymbol">
                <option v-for="s in symbolList" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label class="ps-field">Size (m) — blank uses the library default
              <input type="number" min="0" step="0.5" placeholder="default" v-model.number="symbolSizeM" />
            </label>
            <button class="ps-act ps-act--wide" :class="{ 'is-on': tool === 'symbol' }" @click="pickTool('symbol')">Place symbol on the canvas</button>
          </details>

          <details class="ps-fold">
            <summary>Land-use hatch</summary>
            <label class="ps-field">Preset (master-plan colour schedule)
              <select :value="hatch.landuse" @change="applyHatchPreset(($event.target as HTMLSelectElement).value)">
                <option v-for="p in HATCH_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </label>
            <div class="ps-grid2">
              <label class="ps-field">Pattern
                <select v-model="hatch.pattern">
                  <option value="solid">Solid</option><option value="lines">Lines</option>
                  <option value="cross">Cross</option><option value="dots">Dots</option>
                </select>
              </label>
              <label class="ps-swatch ps-swatch--field"><input type="color" v-model="hatch.color" aria-label="Hatch colour" /><span>Colour</span></label>
              <label class="ps-field">Angle (°)<input type="number" step="15" v-model.number="hatch.angleDeg" /></label>
              <label class="ps-field">Spacing (m)<input type="number" min="0.5" step="0.5" v-model.number="hatch.spacingM" /></label>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :class="{ 'is-on': tool === 'hatch' }" @click="pickTool('hatch')">Draw boundary</button>
              <button class="ps-act" :disabled="!cadSelCount" title="Fill the selected closed shape(s)" @click="hatchSelection">Hatch selected</button>
            </div>
          </details>
        </div>

        <!-- ── PLANNING ────────────────────────────────────────────────── -->
        <div v-show="panelTab === 'plan'" class="ps-panel" role="tabpanel" aria-label="Planning">
          <section class="ps-sec">
            <h2 class="ps-sec-h">Generate</h2>
            <label class="ps-field">Zoning / density
              <select :value="planning.activeZone.value" @change="planning.applyZone(($event.target as HTMLSelectElement).value)">
                <option v-for="z in zoneList" :key="z.zone" :value="z.zone">{{ z.label }}</option>
              </select>
            </label>
            <div class="ps-grid2">
              <label class="ps-field">Road spacing (m)<input type="number" min="0" step="10" placeholder="Auto" v-model.number="nbhd.spacingM" /></label>
              <fieldset class="ps-checks">
                <legend>Include</legend>
                <label><input type="checkbox" v-model="nbhd.spine" /> Collector spine</label>
                <label><input type="checkbox" v-model="nbhd.school" /> School reserve</label>
              </fieldset>
            </div>
            <button class="ps-act ps-act--wide ps-act--primary" :disabled="!planning.planningArea.value" @click="genNeighbourhood">
              <LayoutGrid :size="14" /> Generate neighbourhood
            </button>
            <p class="ps-sub-h">Road pattern</p>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!planning.planningArea.value" title="Street grid at the spacing above" @click="genTemplate('grid')"><Grid2x2 :size="13" /> Grid</button>
              <button class="ps-act" :disabled="!planning.planningArea.value" title="Collector spine down the long axis" @click="genTemplate('spine')"><Slash :size="13" /> Spine</button>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!planning.planningArea.value" title="Loop road set back from the boundary" @click="genTemplate('ring')"><Circle :size="13" /> Loop</button>
              <button class="ps-act" :disabled="!planning.planningArea.value" title="Perimeter road along the boundary" @click="genTemplate('perimeter')"><Square :size="13" /> Perimeter</button>
            </div>
            <p class="ps-note">One pass lays roads, blocks, stands and a park sized to the chosen density. Refine below.</p>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Subdivision rules</h2>
            <div class="ps-grid2">
              <label class="ps-field">Stand width (m)<input type="number" v-model.number="planning.rules.targetWidthM" /></label>
              <label class="ps-field">Max depth (m)<input type="number" v-model.number="planning.rules.maxDepthM" /></label>
              <label class="ps-field">Min area (m²)<input type="number" step="50" v-model.number="planning.rules.minAreaSqm" /></label>
              <label class="ps-field">Rows
                <select v-model.number="planning.rules.rows"><option :value="1">Single</option><option :value="2">Double</option></select>
              </label>
            </div>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!planning.planningArea.value" @click="planning.runBlocks(); showToast('Blocks generated')"><Grid2x2 :size="13" /> Blocks</button>
              <button class="ps-act ps-act--primary" :disabled="!planning.blocks.value.length && !planning.planningArea.value" @click="planning.runSubdivision(); showToast('Stands generated')"><Play :size="13" /> Generate stands</button>
            </div>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Land use</h2>
            <label class="ps-field">Use / reserve type
              <select v-model="reserveUse">
                <option v-for="u in useList" :key="u.use" :value="u.use">{{ u.label }}</option>
              </select>
            </label>
            <div class="ps-row2">
              <button class="ps-act" :disabled="!selCount" @click="applyUse(reserveUse, true)">Apply to selected ({{ selCount }})</button>
              <button class="ps-act" :disabled="!planning.lots.value.length" @click="applyUse(reserveUse, false)">Apply to all</button>
            </div>
            <p class="ps-note">The Reserve tool sets aside a site of this type; stands are generated around it.</p>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Schedule</h2>
            <dl class="ps-kpis">
              <div><dt>Stands</dt><dd>{{ m.lotCount }}</dd></div>
              <div><dt>Avg stand</dt><dd>{{ m.avgLotAreaSqm }}<small> m²</small></dd></div>
              <div><dt>Density</dt><dd>{{ m.grossDensityPerHa }}<small> /ha</small></dd></div>
              <div><dt>Open space</dt><dd>{{ m.openSpacePct }}<small> %</small></dd></div>
            </dl>
            <div class="ps-row2">
              <button class="ps-act" title="Export DXF package, import from AutoCAD, review and merge a revision" @click="openCadInterchange"><ArrowLeftRight :size="13" /> CAD Interchange</button>
            </div>
            <p class="ps-note">DXF is an interchange format. Export a package, edit in AutoCAD, then import, validate and confirm merge. Parcel boundaries are not overwritten.</p>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Planning validation</h2>
            <div class="ps-score" :class="compliance.pct >= 100 ? 'is-pass' : compliance.pct < 60 ? 'is-fail' : 'is-warn'">
              <p class="ps-score-n"><b>{{ compliance.pct }}</b><span>/100</span></p>
              <p class="ps-score-t">
                <strong>Statutory compliance</strong>
                <span>{{ compliance.passed }} of {{ compliance.total }} checks pass</span>
              </p>
            </div>

            <ul class="ps-checklist">
              <li v-for="c in failingChecks" :key="c.key" class="is-fail">
                <AlertTriangle :size="13" aria-hidden="true" />
                <span class="ps-check-t"><b>{{ c.label }}</b><em>{{ c.detail }}</em></span>
                <button
                  v-if="(c.lotIds && c.lotIds.length) || (c.roadIds && c.roadIds.length)"
                  class="ps-review" :title="'Zoom to and select the features failing: ' + c.label" @click="showFailing(c)"
                >Review</button>
              </li>
              <li v-for="c in planning.validation.value.checks.filter(x => x.pass)" :key="c.key" class="is-pass">
                <CheckCircle2 :size="13" aria-hidden="true" />
                <span class="ps-check-t"><b>{{ c.label }}</b><em>{{ c.detail }}</em></span>
              </li>
            </ul>

            <p v-if="failingChecks.length" class="ps-issues">
              {{ failingChecks.length }} issue{{ failingChecks.length > 1 ? 's' : '' }} require attention
            </p>
            <div class="ps-row2" v-if="failingChecks.length">
              <button class="ps-act" :disabled="!selCount" title="Merge the selected stands (fixes undersized or awkward shapes)" @click="planning.mergeSelected() ? showToast('Merged') : showToast('Pick 2+ adjacent stands', 'error')">Merge selected</button>
              <button class="ps-act" :disabled="!planning.planningArea.value" title="Re-run subdivision with the current rules" @click="planning.runSubdivision(); showToast('Stands regenerated')">Re-run</button>
            </div>
          </section>
        </div>

        <!-- ── LAYERS ──────────────────────────────────────────────────── -->
        <div v-show="panelTab === 'layers'" class="ps-panel" role="tabpanel" aria-label="Layers">
          <section class="ps-sec">
            <h2 class="ps-sec-h">Drawing layers</h2>
            <ul class="ps-layers">
              <li v-for="l in cad.layers.value" :key="l.id" :class="{ 'is-current': currentLayer === l.id }">
                <label class="ps-layer-pick" :title="'Draw on ' + l.name">
                  <input type="radio" name="ps-current-layer" :value="l.id" v-model="currentLayer" :aria-label="'Make ' + l.name + ' the current layer'" />
                  <span class="ps-swatch-dot" :style="{ background: l.color }" aria-hidden="true"></span>
                  <span class="ps-layer-n">{{ l.name }}</span>
                </label>
                <button class="ps-icobtn ps-icobtn--sm" :aria-label="(l.visible ? 'Hide ' : 'Show ') + l.name" :title="l.visible ? 'Hide layer' : 'Show layer'" @click="cad.setLayerVisible(l.id, !l.visible)">
                  <component :is="l.visible ? Eye : EyeOff" :size="14" />
                </button>
                <button class="ps-icobtn ps-icobtn--sm" :aria-label="(l.locked ? 'Unlock ' : 'Lock ') + l.name" :title="l.locked ? 'Unlock layer' : 'Lock layer'" @click="cad.setLayerLocked(l.id, !l.locked)">
                  <component :is="l.locked ? Lock : LockOpen" :size="14" />
                </button>
              </li>
            </ul>
            <p class="ps-note">The current layer receives new linework.</p>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Proposal layers</h2>
            <ul class="ps-layers" v-if="studio.layerRegistry.value.length">
              <li v-for="l in studio.layerRegistry.value" :key="l.id">
                <span class="ps-layer-pick">
                  <span class="ps-swatch-dot" :class="l.group" aria-hidden="true"></span>
                  <span class="ps-layer-n">{{ l.label }}</span>
                </span>
                <button class="ps-icobtn ps-icobtn--sm" :aria-label="(l.visible ? 'Hide ' : 'Show ') + l.label" :title="l.visible ? 'Hide layer' : 'Show layer'" @click="studio.setLayerVisible(l.id, !l.visible)">
                  <component :is="l.visible ? Eye : EyeOff" :size="14" />
                </button>
                <component :is="l.locked ? Lock : LockOpen" :size="13" class="ps-lockmark" :aria-label="l.locked ? 'Locked' : 'Unlocked'" />
              </li>
            </ul>
            <p v-else class="ps-note">Proposal layers appear once a parcel is loaded.</p>
          </section>

          <section class="ps-sec">
            <h2 class="ps-sec-h">Reference data<span class="ps-sec-note">Xref</span></h2>
            <ul class="ps-layers" v-if="xrefLayers.length">
              <li v-for="l in xrefLayers" :key="l.id">
                <span class="ps-layer-pick"><MapIcon :size="13" class="ps-layer-ico" aria-hidden="true" /><span class="ps-layer-n">{{ l.label }}</span></span>
                <span class="ps-layer-state">{{ l.visible ? 'Visible' : 'Hidden' }}</span>
                <button class="ps-icobtn ps-icobtn--sm" :aria-label="(l.visible ? 'Hide ' : 'Show ') + l.label" :title="l.visible ? 'Hide reference layer' : 'Show reference layer'" @click="toggleXref(l)">
                  <component :is="l.visible ? Eye : EyeOff" :size="14" />
                </button>
              </li>
            </ul>
            <p v-else class="ps-note">No reference context available — the tile service is offline.</p>
            <p class="ps-note" v-if="xrefLayers.length">Reference layers render beneath and dimmer than the active design.</p>
          </section>
        </div>
      </aside>
    </div>

    <!-- ═══ STATUS BAR ═══════════════════════════════════════════════════ -->
    <footer class="ps-status">
      <div class="ps-cmd">
        <label class="ps-cmd-in">
          <span class="ps-cmd-caret" aria-hidden="true">&gt;</span>
            <input v-model="command" aria-label="Command line" placeholder="Command (line, road, generate, hatch, save, dxfout, dxfin)…" @keydown.enter="runCommand" />
        </label>
        <div v-if="drawToolActive" class="ps-dyn">
          <span class="ps-dyn-l">Length, bearing</span>
          <input
            v-model="dyn.value" class="ps-dyn-in" aria-label="Exact length and bearing"
            placeholder="40 or 40,90" title="Type an exact length in metres, optionally a bearing (0 = north, 90 = east). Enter applies, Esc cancels."
            @keydown.enter="submitDynamic" @keydown.esc="dyn.value = ''"
          />
          <span class="ps-dyn-h" v-if="liveDim">{{ liveDim.len.toFixed(2) }} m · {{ liveDim.brg.toFixed(1) }}°</span>
        </div>
      </div>

      <div class="ps-status-r">
        <button class="ps-toggle" :class="{ 'is-on': snapOn }" :aria-pressed="snapOn" title="Object and grid snap" @click="snapOn = !snapOn">SNAP</button>
        <button class="ps-toggle" :class="{ 'is-on': gridOn }" :aria-pressed="gridOn" title="Show the survey grid and snap to it" @click="gridOn = !gridOn">GRID</button>
        <input v-if="gridOn" v-model.number="input.state.gridStepM" type="number" min="1" step="1" class="ps-gridstep" aria-label="Grid step in metres" title="Grid step (m)" />
        <button class="ps-toggle" :class="{ 'is-on': input.state.ortho }" :aria-pressed="input.state.ortho" title="Ortho — lock to 90° (square corners)" @click="input.state.ortho = !input.state.ortho">ORTHO</button>
        <button class="ps-toggle" :class="{ 'is-on': input.state.polar }" :aria-pressed="input.state.polar" :title="'Polar — lock to ' + input.state.polarStepDeg + '° steps'" @click="input.state.polar = !input.state.polar">POLAR</button>
        <span class="ps-stat"><em>Scale</em>1:{{ scaleDenom.toLocaleString() }}</span>
        <span class="ps-stat"><em>Selected</em>{{ cadSelCount }} obj · {{ selCount }} stands</span>
        <span class="ps-stat ps-stat--xy"><em>X</em>{{ coord.x.toFixed(2) }}<em>Y</em>{{ coord.y.toFixed(2) }}<i>m</i></span>
      </div>
    </footer>

    <!-- ═══ DIALOGS ══════════════════════════════════════════════════════ -->

    <!-- Draft recovery -->
    <Transition name="ps-fade">
      <div v-if="recoverable" class="ps-scrim">
        <div class="ps-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-recover-h">
          <header class="ps-dialog-h"><AlertTriangle :size="15" /><h2 id="ps-recover-h">Unsaved work found</h2></header>
          <div class="ps-dialog-b">
            <p>A recoverable draft from a previous session on this parcel is stored on this workstation. Restoring replaces the current drawing; discarding deletes the draft permanently.</p>
          </div>
          <footer class="ps-dialog-f">
            <button class="ps-btn ps-btn--quiet" @click="dismissDraft">Discard draft</button>
            <button class="ps-btn ps-btn--primary" @click="restoreDraft">Restore draft</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Plot -->
    <Transition name="ps-fade">
      <div v-if="plot.open" class="ps-scrim" @click.self="plot.open = false">
        <div class="ps-dialog ps-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="ps-plot-h">
          <header class="ps-dialog-h"><Printer :size="15" /><h2 id="ps-plot-h">Plot drawing</h2></header>
          <div class="ps-dialog-b">
            <div class="ps-grid2">
              <label class="ps-field">Paper
                <select v-model="plot.paper">
                  <option value="A4">A4</option><option value="A3">A3</option>
                  <option value="A2">A2</option><option value="A1">A1</option><option value="A0">A0</option>
                </select>
              </label>
              <label class="ps-field">Orientation
                <select v-model="plot.orientation">
                  <option value="landscape">Landscape</option><option value="portrait">Portrait</option>
                </select>
              </label>
              <label class="ps-field">Scale
                <select v-model="plot.scale">
                  <option value="fit">Fit to sheet</option>
                  <option :value="200">1:200</option><option :value="500">1:500</option>
                  <option :value="1000">1:1000</option><option :value="2500">1:2500</option>
                  <option :value="5000">1:5000</option><option :value="10000">1:10000</option>
                </select>
              </label>
              <label class="ps-field">Drawing number<input v-model="plot.drawingNumber" placeholder="VRDC-2026-014" /></label>
              <label class="ps-field">Plan / SG number<input v-model="plot.planNumber" placeholder="SG 1234/2026" /></label>
              <label class="ps-field">Drawn by<input v-model="plot.planner" placeholder="Planner name" /></label>
            </div>
            <fieldset class="ps-checks ps-checks--wide">
              <legend>Sheet content</legend>
              <label><input type="checkbox" v-model="plot.showSchedule" /> Stand schedule — numbered table of areas and frontages</label>
              <label><input type="checkbox" v-model="plot.showCoordinates" /> Corner coordinates — survey X/Y on the parcel beacons</label>
            </fieldset>
            <p class="ps-note">Vector and scale-true: at 1:1000 a 12 m road reserve plots at 12 mm. Parcel, roads, stands by use, open space, reserves, linework, dimensions, symbols and hatching are all included.</p>
          </div>
          <footer class="ps-dialog-f">
            <button class="ps-btn ps-btn--quiet" @click="plot.open = false">Cancel</button>
            <button class="ps-btn ps-btn--primary" @click="runPlot"><Printer :size="14" /> Generate plot</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Export confirmation -->
    <Transition name="ps-fade">
      <div v-if="exported" class="ps-scrim">
        <div class="ps-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-export-h">
          <header class="ps-dialog-h"><CheckCircle2 :size="15" /><h2 id="ps-export-h">Export complete</h2></header>
          <div class="ps-dialog-b">
            <dl class="ps-props ps-props--lg">
              <div><dt>Case file</dt><dd class="mono">{{ exported.caseRef || 'Not linked' }}</dd></div>
              <div><dt>Revision</dt><dd class="mono">R{{ exported.revision ?? '—' }}</dd></div>
              <div><dt>Stands</dt><dd class="mono">{{ exported.lots }}</dd></div>
              <div><dt>Site area</dt><dd class="mono">{{ (exported.areaSqm / 10000).toFixed(2) }} ha</dd></div>
              <div class="wide"><dt>Status</dt><dd>Submitted</dd></div>
            </dl>
            <p class="ps-note">
              Saved as an immutable revision{{ exported.caseRef ? ' and recorded on the case audit trail' : '' }}.
              The proposal is now visible on the planner map.
            </p>
          </div>
          <footer class="ps-dialog-f">
            <button class="ps-btn ps-btn--quiet" @click="exported = null">Keep drafting</button>
            <button class="ps-btn ps-btn--primary" @click="router.push('/planner')">Return to case</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Keyboard shortcuts -->
    <Transition name="ps-fade">
      <div v-if="showShortcuts" class="ps-scrim" @click.self="showShortcuts = false">
        <div class="ps-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-keys-h">
          <header class="ps-dialog-h">
            <Keyboard :size="15" /><h2 id="ps-keys-h">Keyboard shortcuts</h2>
            <button class="ps-icobtn ps-dialog-x" aria-label="Close" @click="showShortcuts = false"><X :size="15" /></button>
          </header>
          <div class="ps-dialog-b">
            <dl class="ps-keys">
              <div v-for="s in SHORTCUTS" :key="s.keys"><dt><kbd>{{ s.keys }}</kbd></dt><dd>{{ s.action }}</dd></div>
            </dl>
            <p class="ps-note">The command line at the bottom-left accepts the same operations by name — line, polyline, arc, rect, circle, road, reserve, measure, dim, text, leader, symbol, hatch, join, explode, blocks, generate, save, dxfout, dxfin.</p>
          </div>
          <footer class="ps-dialog-f">
            <button class="ps-btn ps-btn--primary" @click="showShortcuts = false">Close</button>
          </footer>
        </div>
      </div>
    </Transition>

    <CadInterchangeDialog
      ref="cadxRef"
      :open="cadxOpen"
      :project-id="planning.projectId.value"
      :project-name="planning.projectName.value"
      :case-id="caseId"
      :application-ref="caseRef"
      :parcel-id="String(route.params.fid || '')"
      :parcel-name="planning.planningArea.value?.name || null"
      :gis-revision="planning.baseRevision.value"
      :scale-denom="scaleDenom"
      :exported-by="exportedBy"
      :can-export="canExchangeDxf || !!cad.entities.value.length"
      :can-import="canExchangeDxf"
      :planning-area="planning.planningArea.value"
      :lots="planning.lots.value"
      :roads="planning.roads.value"
      :open-space="planning.openSpace.value"
      :constraints="planning.constraints.value"
      :cad-entities="cad.entities.value"
      :cad-layers="cad.layers.value"
      :current-layer-id="currentLayer"
      :planning-checks="planning.validation.value"
      :compliance-pct="compliance.pct"
      @close="cadxOpen = false"
      @merge="onCadMerge"
    />

    <Transition name="ps-fade">
      <p v-if="toast" class="ps-toast" :class="toast.type" role="status" aria-live="polite">
        <component :is="toast.type === 'error' ? CircleAlert : CircleCheck" :size="14" aria-hidden="true" />{{ toast.msg }}
      </p>
    </Transition>
  </div>
</template>

<style scoped>
/* ─────────────────────────────────────────────────────────────────────────
   Planning Studio — municipal GIS/CAD workstation shell.
   All colour, type, spacing and elevation come from the --ent-* enterprise
   tokens (src/styles/enterprise.css). Three fixed regions: header, work area
   (rail · model space · inspector), status bar. Only the canvas flexes; every
   panel scrolls internally, so the page itself never scrolls.
   ───────────────────────────────────────────────────────────────────────── */
.ps {
  position: fixed; inset: 0; z-index: 1000;
  display: grid; grid-template-rows: 48px minmax(0, 1fr) 28px;
  background: var(--ent-canvas); color: var(--ent-text);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm);
  overflow: hidden;
}
.mono { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }
.spin { animation: ps-spin 1s linear infinite; }
@keyframes ps-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

/* ── HEADER ──────────────────────────────────────────────────────────────*/
.ps-top {
  display: flex; align-items: center; gap: var(--ent-s5);
  padding: 0 var(--ent-s3) 0 var(--ent-s4);
  background: var(--ent-surface); border-bottom: 1px solid var(--ent-line-strong);
}
.ps-ident { display: flex; align-items: center; gap: var(--ent-s2); min-width: 0; }
.ps-mark { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--ent-r-sm); background: var(--ent-accent-soft); color: var(--ent-accent); }
.ps-ident-txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.ps-ident-txt em { font-style: normal; font-size: var(--ent-fs-micro); letter-spacing: .07em; text-transform: uppercase; color: var(--ent-text-3); }
.ps-ident-txt strong { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 22ch; }

.ps-meta { display: flex; align-items: stretch; gap: 0; margin: 0; border-left: 1px solid var(--ent-line); }
.ps-meta-i { padding: 0 var(--ent-s4); border-right: 1px solid var(--ent-line); line-height: 1.2; }
.ps-meta dt { font-size: var(--ent-fs-micro); letter-spacing: .07em; text-transform: uppercase; color: var(--ent-text-3); }
.ps-meta dd { margin: 1px 0 0; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium); color: var(--ent-text); white-space: nowrap; }

.ps-top-actions { display: flex; align-items: center; gap: var(--ent-s2); margin-left: auto; }
.ps-savestate { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium); padding: 0 var(--ent-s2); white-space: nowrap; }
.ps-savestate.is-saved { color: var(--ent-success); }
.ps-savestate.is-saving { color: var(--ent-text-2); }
.ps-savestate.is-unsaved { color: var(--ent-warning); }
.ps-savestate.is-failed { color: var(--ent-danger); }
.ps-iconset { display: flex; gap: 2px; padding: 0 var(--ent-s1); }
.ps-top-sep { width: 1px; height: 22px; background: var(--ent-line); margin: 0 var(--ent-s1); }

.ps-btn {
  display: inline-flex; align-items: center; gap: 6px; height: var(--ent-control-h-sm);
  padding: 0 var(--ent-s3); border-radius: var(--ent-r); cursor: pointer;
  font-family: inherit; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium);
  background: var(--ent-surface); color: var(--ent-text); border: 1px solid var(--ent-line-strong);
  transition: background var(--ent-dur) var(--ent-ease), border-color var(--ent-dur) var(--ent-ease);
}
.ps-btn:hover:not(:disabled) { background: var(--ent-surface-2); }
.ps-btn:disabled { opacity: .45; cursor: not-allowed; }
.ps-btn--primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); font-weight: var(--ent-fw-semibold); }
.ps-btn--primary:hover:not(:disabled) { background: var(--ent-accent-hover); border-color: var(--ent-accent-hover); }
.ps-btn--quiet { background: transparent; border-color: transparent; color: var(--ent-text-2); }
.ps-btn--quiet:hover:not(:disabled) { background: var(--ent-surface-2); color: var(--ent-text); }
.ps-icobtn {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--ent-r-sm);
  background: transparent; border: 1px solid transparent; color: var(--ent-text-2); cursor: pointer;
}
.ps-icobtn:hover:not(:disabled) { background: var(--ent-surface-2); color: var(--ent-text); }
.ps-icobtn:disabled { opacity: .35; cursor: not-allowed; }
.ps-icobtn--sm { width: 24px; height: 24px; }
.ps-hidden-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* ── WORK AREA ───────────────────────────────────────────────────────────*/
.ps-body { display: flex; min-height: 0; min-width: 0; }

/* Tool rail */
.ps-rail {
  flex: 0 0 58px; display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s2) 0 var(--ent-s2);
  background: var(--ent-surface-sunken); border-right: 1px solid var(--ent-line-strong);
  overflow-y: auto; overflow-x: hidden;
}
.ps-rail::-webkit-scrollbar { width: 5px; }
.ps-rail::-webkit-scrollbar-thumb { background: var(--ent-line-strong); border-radius: 3px; }
.ps-railgrp { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.ps-railgrp-h {
  margin: 0 0 2px; width: 100%; text-align: center;
  font-size: 9px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
  font-weight: var(--ent-fw-semibold); color: var(--ent-text-3);
}
.ps-railgrp + .ps-railgrp { border-top: 1px solid var(--ent-line); padding-top: var(--ent-s2); }
.ps-tool {
  position: relative; display: grid; place-items: center;
  width: 40px; height: 32px; border: 0; border-radius: var(--ent-r-sm);
  background: transparent; color: var(--ent-text-2); cursor: pointer;
  transition: background var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.ps-tool:hover:not(:disabled) { background: var(--ent-surface); color: var(--ent-text); }
.ps-tool:disabled { opacity: .35; cursor: not-allowed; }
.ps-tool.is-active { background: var(--ent-accent-soft); color: var(--ent-accent); }
/* second, non-colour cue for the active tool */
.ps-tool.is-active::before {
  content: ''; position: absolute; left: -1px; top: 4px; bottom: 4px; width: 3px;
  border-radius: 0 2px 2px 0; background: var(--ent-accent);
}
.ps-tool-key {
  position: absolute; right: 2px; bottom: 1px; font-family: var(--ent-font-mono);
  font-size: 8px; line-height: 1; color: var(--ent-text-3);
}
.ps-tool.is-active .ps-tool-key { color: var(--ent-accent); }
.ps-railfoot { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: var(--ent-s2); border-top: 1px solid var(--ent-line); }
.ps-tool--run { color: var(--ent-accent); }

/* Model space */
.ps-canvas { position: relative; flex: 1 1 auto; min-width: 0; background: var(--ent-surface); }
.ps-map { position: absolute; inset: 0; }
.ps-grid {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(26, 36, 48, .055) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(26, 36, 48, .055) 1px, transparent 1px);
  background-size: 40px 40px;
}
.ps-prompt {
  position: absolute; top: var(--ent-s3); left: 50%; transform: translateX(-50%); z-index: 26;
  display: inline-flex; align-items: center; gap: 6px; max-width: 70%;
  padding: 5px var(--ent-s3); border-radius: var(--ent-r-sm);
  background: var(--ent-text); color: #fff; font-size: var(--ent-fs-xs); box-shadow: var(--ent-e2);
}
.ps-prompt span { color: rgba(255, 255, 255, .62); }
.ps-prompt.is-busy { background: var(--ent-surface); color: var(--ent-text-2); border: 1px solid var(--ent-line-strong); }
.ps-hud {
  position: absolute; z-index: 25; pointer-events: none;
  display: flex; flex-direction: column; gap: 1px;
  padding: 4px 7px; border-radius: var(--ent-r-sm);
  background: rgba(26, 36, 48, .93); color: #fff;
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); font-variant-numeric: tabular-nums;
}
.ps-hud-r { display: flex; gap: 6px; }
.ps-hud-r em { font-style: normal; width: 22px; color: rgba(255, 255, 255, .55); }
.ps-hud-r.is-live { color: #a9cdf5; }
.ps-hud-r.is-live em { color: rgba(169, 205, 245, .65); }
.ps-textentry {
  position: absolute; z-index: 30; display: flex; align-items: center; gap: 3px;
  padding: 3px; border-radius: var(--ent-r-sm);
  background: var(--ent-surface); border: 1px solid var(--ent-accent); box-shadow: var(--ent-e3);
}
.ps-textentry input { width: 178px; padding: 4px 6px; border: 0; outline: none; font-family: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text); background: transparent; }
.ps-textentry-ok { display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: var(--ent-r-sm); background: var(--ent-accent); color: #fff; cursor: pointer; }

/* ── INSPECTOR ───────────────────────────────────────────────────────────*/
.ps-side {
  flex: 0 0 328px; display: flex; flex-direction: column; min-height: 0;
  background: var(--ent-surface); border-left: 1px solid var(--ent-line-strong);
}
.ps-tabs { display: flex; flex: 0 0 auto; background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line-strong); }
.ps-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 34px; border: 0; border-bottom: 2px solid transparent; background: transparent; cursor: pointer;
  font-family: inherit; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium); color: var(--ent-text-2);
}
.ps-tab:hover { color: var(--ent-text); background: var(--ent-surface); }
.ps-tab.is-active { color: var(--ent-accent); background: var(--ent-surface); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.ps-panel { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ps-panel::-webkit-scrollbar { width: 8px; }
.ps-panel::-webkit-scrollbar-thumb { background: var(--ent-line-strong); border-radius: 4px; }

.ps-sec { padding: var(--ent-s3) var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line); }
.ps-sec.is-muted { opacity: .55; }
.ps-sec-h {
  display: flex; align-items: center; gap: var(--ent-s2); margin: 0 0 var(--ent-s3);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); letter-spacing: .08em;
  text-transform: uppercase; color: var(--ent-text-2);
}
.ps-sec-badge { padding: 0 6px; border-radius: var(--ent-r-pill); background: var(--ent-accent-soft); color: var(--ent-accent); letter-spacing: 0; }
.ps-sec-note { margin-left: auto; font-weight: var(--ent-fw-normal); letter-spacing: .04em; color: var(--ent-text-3); }
.ps-sub-h { margin: var(--ent-s4) 0 var(--ent-s2); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); letter-spacing: .06em; text-transform: uppercase; color: var(--ent-text-3); }
.ps-note { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs); line-height: 1.45; color: var(--ent-text-3); }
.ps-selbar {
  margin: 0 0 var(--ent-s2); padding: 4px var(--ent-s2); border-radius: var(--ent-r-sm);
  background: var(--ent-accent-soft); border: 1px solid var(--ent-accent-line);
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium); color: var(--ent-accent);
}

/* property lists */
.ps-props { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s2) var(--ent-s3); margin: 0; }
.ps-props .wide { grid-column: 1 / -1; }
.ps-props dt { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: .05em; color: var(--ent-text-3); }
.ps-props dd { margin: 1px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text); text-transform: capitalize; }
.ps-props dd.mono { font-family: var(--ent-font-mono); text-transform: none; font-variant-numeric: tabular-nums; }
.ps-props--lg dd { font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }

/* controls */
.ps-field { display: flex; flex-direction: column; gap: 3px; font-size: var(--ent-fs-micro); color: var(--ent-text-2); }
.ps-field + .ps-field, .ps-sec > .ps-field { margin-top: var(--ent-s2); }
.ps-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s2); }
.ps-grid2 > .ps-field { margin-top: 0; }   /* the grid gap spaces rows; a margin would stagger the columns */
.ps-field input, .ps-field select {
  height: 30px; padding: 0 7px; border-radius: var(--ent-r-sm);
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong); color: var(--ent-text);
  font-family: inherit; font-size: var(--ent-fs-sm); min-width: 0;
}
.ps-field--tight { margin: 0; flex: 1; }
.ps-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s2); margin-top: var(--ent-s2); }
.ps-inline { display: flex; align-items: flex-end; gap: var(--ent-s2); margin-top: var(--ent-s2); }
.ps-inline .ps-act { flex: 1; }
.ps-act {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 30px; padding: 0 var(--ent-s2); border-radius: var(--ent-r-sm); cursor: pointer;
  background: var(--ent-surface); border: 1px solid var(--ent-line-strong); color: var(--ent-text);
  font-family: inherit; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-medium);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ps-act:hover:not(:disabled) { background: var(--ent-surface-2); }
.ps-act:disabled { opacity: .45; cursor: not-allowed; }
.ps-act--wide { width: 100%; margin-top: var(--ent-s2); }
.ps-act--primary { background: var(--ent-accent); border-color: var(--ent-accent); color: var(--ent-text-on-accent); font-weight: var(--ent-fw-semibold); }
.ps-act--primary:hover:not(:disabled) { background: var(--ent-accent-hover); }
.ps-act--danger { color: var(--ent-danger); border-color: var(--ent-tone-negative-line); }
.ps-act--danger:hover:not(:disabled) { background: var(--ent-danger-soft); }
.ps-act.is-on { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.ps-swatch { display: inline-flex; align-items: center; gap: 6px; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.ps-swatch input[type="color"] { width: 30px; height: 30px; padding: 0; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); cursor: pointer; }
.ps-swatch--field { flex-direction: row-reverse; justify-content: flex-end; align-self: end; height: 30px; margin-top: 15px; }
.ps-checks { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; border: 0; }
.ps-checks legend { padding: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-2); }
.ps-checks label { display: flex; align-items: center; gap: 6px; font-size: var(--ent-fs-xs); color: var(--ent-text); cursor: pointer; }
.ps-checks--wide { margin-top: var(--ent-s3); gap: 6px; }

/* designate — the CAD → planning bridge */
.ps-designate { background: var(--ent-surface-2); }
.ps-flow {
  display: flex; align-items: center; gap: 4px; margin: 0 0 var(--ent-s3);
  font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: .05em; color: var(--ent-text-3);
}
.ps-flow span { padding: 2px 6px; border-radius: var(--ent-r-sm); background: var(--ent-surface); border: 1px solid var(--ent-line); }
.ps-flow .is-out { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }

/* folded (secondary) groups */
.ps-fold { border-bottom: 1px solid var(--ent-line); padding: 0 var(--ent-s3) 0; }
.ps-fold > summary {
  list-style: none; cursor: pointer; padding: var(--ent-s3) 0;
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); letter-spacing: .08em;
  text-transform: uppercase; color: var(--ent-text-2);
}
.ps-fold > summary::-webkit-details-marker { display: none; }
.ps-fold > summary::before { content: '▸'; display: inline-block; width: 14px; color: var(--ent-text-3); }
.ps-fold[open] > summary::before { content: '▾'; }
.ps-fold[open] { padding-bottom: var(--ent-s4); }

/* KPIs + validation */
.ps-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ent-s2); margin: 0; }
.ps-kpis div { padding: 6px var(--ent-s2); border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); }
.ps-kpis dt { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: .05em; color: var(--ent-text-3); }
.ps-kpis dd { margin: 2px 0 0; font-family: var(--ent-font-mono); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; }
.ps-kpis small { font-family: var(--ent-font); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-normal); color: var(--ent-text-3); }

.ps-score { display: flex; align-items: center; gap: var(--ent-s3); padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r-sm); border: 1px solid var(--ent-tone-warning-line); background: var(--ent-tone-warning-bg); }
.ps-score.is-pass { border-color: var(--ent-tone-positive-line); background: var(--ent-tone-positive-bg); }
.ps-score.is-fail { border-color: var(--ent-tone-negative-line); background: var(--ent-tone-negative-bg); }
.ps-score-n { margin: 0; display: flex; align-items: baseline; font-family: var(--ent-font-mono); }
.ps-score-n b { font-size: var(--ent-fs-num); font-weight: var(--ent-fw-bold); line-height: 1; color: var(--ent-text); }
.ps-score-n span { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.ps-score-t { margin: 0; display: flex; flex-direction: column; }
.ps-score-t strong { font-size: var(--ent-fs-sm); }
.ps-score-t span { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }

.ps-checklist { list-style: none; margin: var(--ent-s3) 0 0; padding: 0; display: flex; flex-direction: column; }
.ps-checklist li { display: flex; align-items: flex-start; gap: 7px; padding: 6px 0; border-bottom: 1px solid var(--ent-line); font-size: var(--ent-fs-xs); }
.ps-checklist li:last-child { border-bottom: 0; }
.ps-checklist li.is-fail > svg { color: var(--ent-warning); flex: 0 0 auto; margin-top: 1px; }
.ps-checklist li.is-pass > svg { color: var(--ent-success); flex: 0 0 auto; margin-top: 1px; }
.ps-checklist li.is-pass { color: var(--ent-text-3); }
.ps-check-t { flex: 1; display: flex; flex-direction: column; line-height: 1.35; min-width: 0; }
.ps-check-t b { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.ps-checklist li.is-pass .ps-check-t b { font-weight: var(--ent-fw-normal); color: var(--ent-text-2); }
.ps-check-t em { font-style: normal; color: var(--ent-text-3); }
.ps-review { flex: 0 0 auto; height: 22px; padding: 0 var(--ent-s2); border: 1px solid var(--ent-accent-line); border-radius: var(--ent-r-sm); background: var(--ent-accent-soft); color: var(--ent-accent); font-family: inherit; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); cursor: pointer; }
.ps-review:hover { background: var(--ent-accent); color: #fff; }
.ps-issues { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-warning); }

/* layer lists */
.ps-layers { list-style: none; margin: 0; padding: 0; }
.ps-layers li { display: flex; align-items: center; gap: 4px; height: 30px; border-bottom: 1px solid var(--ent-line); }
.ps-layers li:last-child { border-bottom: 0; }
.ps-layers li.is-current { background: var(--ent-accent-soft); box-shadow: inset 3px 0 0 var(--ent-accent); }
.ps-layer-pick { flex: 1; display: flex; align-items: center; gap: 7px; min-width: 0; padding-left: 5px; font-size: var(--ent-fs-xs); cursor: pointer; }
.ps-layer-pick input[type="radio"] { accent-color: var(--ent-accent); }
.ps-layer-n { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ps-layer-ico { color: var(--ent-text-3); }
.ps-layer-state { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.ps-swatch-dot { width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(26, 36, 48, .18); flex: 0 0 auto; }
.ps-swatch-dot.proposed { background: var(--ent-accent); }
.ps-swatch-dot.context { background: var(--ent-text-3); }
.ps-lockmark { color: var(--ent-text-3); margin-right: 5px; }

/* ── STATUS BAR ──────────────────────────────────────────────────────────*/
.ps-status {
  display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s4);
  padding: 0 var(--ent-s3); background: var(--ent-surface); border-top: 1px solid var(--ent-line-strong);
  font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); color: var(--ent-text-2);
}
.ps-cmd { display: flex; align-items: center; gap: var(--ent-s3); flex: 1; min-width: 0; }
.ps-cmd-in { display: flex; align-items: center; gap: 6px; flex: 1; max-width: 460px; min-width: 0; }
.ps-cmd-caret { color: var(--ent-accent); font-weight: var(--ent-fw-bold); }
.ps-cmd-in input { flex: 1; min-width: 0; height: 20px; border: 0; background: transparent; color: var(--ent-text); font-family: inherit; font-size: var(--ent-fs-micro); }
.ps-cmd-in input:focus { outline: none; }
.ps-dyn { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.ps-dyn-l { color: var(--ent-accent); text-transform: uppercase; letter-spacing: .05em; }
.ps-dyn-in { width: 128px; height: 20px; padding: 0 6px; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); color: var(--ent-text); font-family: inherit; font-size: var(--ent-fs-micro); }
.ps-dyn-in:focus { outline: none; border-color: var(--ent-accent); background: var(--ent-surface); box-shadow: var(--ent-focus-ring); }
.ps-dyn-h { color: var(--ent-text-3); font-variant-numeric: tabular-nums; }

.ps-status-r { display: flex; align-items: center; gap: var(--ent-s3); flex: 0 0 auto; }
.ps-toggle { height: 20px; padding: 0 6px; border: 1px solid transparent; border-radius: var(--ent-r-sm); background: transparent; color: var(--ent-text-3); font-family: inherit; font-size: var(--ent-fs-micro); letter-spacing: .05em; cursor: pointer; }
.ps-toggle:hover { background: var(--ent-surface-2); color: var(--ent-text-2); }
.ps-toggle.is-on { background: var(--ent-accent-soft); border-color: var(--ent-accent-line); color: var(--ent-accent); font-weight: var(--ent-fw-bold); }
.ps-gridstep { width: 44px; height: 20px; padding: 0 4px; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); color: var(--ent-text); font-family: inherit; font-size: var(--ent-fs-micro); }
.ps-stat { display: inline-flex; align-items: center; gap: 5px; color: var(--ent-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ps-stat em { font-style: normal; text-transform: uppercase; letter-spacing: .06em; color: var(--ent-text-3); }
.ps-stat i { font-style: normal; color: var(--ent-text-3); }
.ps-stat--xy { min-width: 190px; justify-content: flex-end; }

/* ── DIALOGS + TOAST ─────────────────────────────────────────────────────*/
.ps-scrim { position: absolute; inset: 0; z-index: var(--ent-z-modal); display: grid; place-items: center; background: rgba(17, 29, 45, .38); padding: var(--ent-s4); }
.ps-dialog { width: 400px; max-width: 100%; max-height: calc(100vh - 96px); display: flex; flex-direction: column; background: var(--ent-surface); border-radius: var(--ent-r-lg); box-shadow: var(--ent-e4); overflow: hidden; }
.ps-dialog--wide { width: 480px; }
.ps-dialog-h { display: flex; align-items: center; gap: var(--ent-s2); padding: var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line); color: var(--ent-accent); }
.ps-dialog-h h2 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.ps-dialog-x { margin-left: auto; }
.ps-dialog-b { padding: var(--ent-s4); overflow-y: auto; font-size: var(--ent-fs-sm); line-height: var(--ent-lh); color: var(--ent-text-2); }
.ps-dialog-b p:first-child { margin-top: 0; }
.ps-dialog-f { display: flex; justify-content: flex-end; gap: var(--ent-s2); padding: var(--ent-s3) var(--ent-s4); background: var(--ent-surface-2); border-top: 1px solid var(--ent-line); }
.ps-dialog-f .ps-btn { height: var(--ent-control-h); padding: 0 var(--ent-s4); font-size: var(--ent-fs-sm); }
.ps-keys { display: grid; grid-template-columns: auto 1fr; gap: 5px var(--ent-s3); margin: 0; }
.ps-keys > div { display: contents; }
.ps-keys dt { justify-self: start; }
.ps-keys kbd { display: inline-block; min-width: 26px; padding: 2px 6px; border: 1px solid var(--ent-line-strong); border-bottom-width: 2px; border-radius: var(--ent-r-sm); background: var(--ent-surface-2); font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); color: var(--ent-text); text-align: center; }
.ps-keys dd { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }

.ps-toast {
  position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: var(--ent-z-toast);
  display: inline-flex; align-items: center; gap: 7px; margin: 0;
  padding: 8px var(--ent-s4); border-radius: var(--ent-r); box-shadow: var(--ent-e3);
  background: var(--ent-text); color: #fff; font-size: var(--ent-fs-sm);
}
.ps-toast.error { background: var(--ent-danger); }
.ps-fade-enter-active, .ps-fade-leave-active { transition: opacity var(--ent-dur) var(--ent-ease); }
.ps-fade-enter-from, .ps-fade-leave-to { opacity: 0; }

/* ── FOCUS + REDUCED MOTION ──────────────────────────────────────────────*/
.ps :is(button, input, select, summary, a):focus-visible {
  outline: 2px solid var(--ent-accent); outline-offset: 1px; box-shadow: var(--ent-focus-ring);
}
@media (prefers-reduced-motion: reduce) {
  .ps *, .ps *::before, .ps *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}

/* ── NARROWER WORKSTATIONS ───────────────────────────────────────────────*/
@media (max-width: 1366px) {
  .ps-side { flex-basis: 300px; }
  .ps-meta-i:nth-child(2) { display: none; }   /* site area stays in the inspector */
}
@media (max-width: 1180px) {
  .ps-side { flex-basis: 276px; }
  .ps-ident-txt strong { max-width: 14ch; }
  .ps-stat--xy { min-width: 0; }
}
@media (max-width: 1024px) {
  .ps-meta { display: none; }                  /* context stays in the inspector */
}
</style>
