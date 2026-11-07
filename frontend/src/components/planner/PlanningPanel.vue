<script setup lang="ts">
// PlanningPanel — Phase 1 land-subdivision UI for the planner workspace.
// Drives the shared usePlanningTools() session (passed in as a prop). The map
// view owns the MapLibre interactions and reads `planning.tool`; this panel
// owns the controls, rules, metrics and the projects list. Map-dependent
// actions (river buffer) are emitted up to the view.
import { ref, computed, onMounted } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { PlanningToolsApi } from '@/planning/usePlanningTools'
import type { PlanningTool, LotUseType } from '@/planning/planning-types'
import { planningApi } from '@/services/api'
import { exportFeaturesToDxf } from '@/map/tools/dxfExport'
import { parseDxfToGeoJSON } from '@/map/tools/dxfImport'
import { exportLotScheduleCsv } from '@/planning/planning-exports'
import {
  MousePointerSquareDashed, Spline, Grid2x2, LayoutGrid, Droplets,
  Save, FolderOpen, RefreshCw, Square, Play, Download, Upload,
  Trash2, Eye, EyeOff, Scissors, Combine, Hash, FileText,
  CheckCircle2, AlertTriangle, Cloud, CloudUpload,
} from 'lucide-vue-next'

const props = defineProps<{ planning: PlanningToolsApi }>()
const emit = defineEmits<{
  (e: 'notify', message: string, type?: string): void
  (e: 'river-buffer'): void
  (e: 'export-pdf'): void
  (e: 'focus', payload: { kind: 'lot' | 'block' | 'road'; id: string; variant?: 'env' }): void
}>()

// Top-level refs are auto-unwrapped in the template.
const p = props.planning
const tool = p.tool
const rules = p.rules
const metrics = p.metrics
const blocks = p.blocks
const lots = p.lots
const openSpace = p.openSpace
const constraints = p.constraints
const roads = p.roads
const busy = p.busy
const planningArea = p.planningArea
const projectName = p.projectName
const roadsVisible = p.roadsVisible
const mergeSelection = p.mergeSelection
const roadSummaries = p.roadSummaries
const blockSummaries = p.blockSummaries
const standards = p.standards
const activeZone = p.activeZone
const validation = p.validation
const dirty = p.dirty
const targetDensityPerHa = p.targetDensityPerHa
const showEnvelopes = p.showEnvelopes
const colourByUse = p.colourByUse
// Engine-version note: shown when a loaded project's layout was produced by a
// different subdivision engine than the current default (re-running will upgrade it).
const loadedEngineVersion = p.loadedEngineVersion
const currentEngineVersion = p.currentEngineVersion
const engineNote = computed(() => {
  const lv = loadedEngineVersion.value
  return (lv != null && lv !== currentEngineVersion)
    ? `Loaded layout used engine v${lv} — re-running uses engine v${currentEngineVersion}.`
    : ''
})
const zoneList = computed(() => Object.values(standards.zones))
const useList = computed(() => Object.values(standards.uses))
const bulkUseType = ref<LotUseType>('single_residential')
function useLabelFor(k: string) { return (standards.uses as any)[k]?.label || k }
function applyUseAll() {
  if (!lots.value.length) return emit('notify', 'No lots yet', 'error')
  p.assignUseToAll(bulkUseType.value); emit('notify', `Use applied to all ${lots.value.length} lots`, 'success')
}
function applyUseSelected() {
  if (!mergeSelection.value.length) return emit('notify', 'Select lots first (Merge-lots tool)', 'error')
  p.assignUseToLots([...mergeSelection.value], bulkUseType.value)
  emit('notify', `Use applied to ${mergeSelection.value.length} lot(s)`, 'success')
}
function focusRoad(id: string) { emit('focus', { kind: 'road', id }) }
function roadChip(id: string) { const r = roadSummaries.value.find(x => x.id === id); return r ? `Road · ${r.lengthM} m` : 'Road' }
const parkingStatus = computed(() => {
  const req = metrics.value.requiredParkingSpaces
  const prov = metrics.value.providedParkingSpaces
  if (!req) return { label: '—', cls: 'meets' }
  return prov >= req ? { label: 'Meets', cls: 'meets' } : { label: 'Under', cls: 'under' }
})
const reserveLine = computed(() => Object.entries(standards.roadReserveByHierarchy).map(([k, v]) => `${k} ${v} m`).join(' · '))

// Validation issue helpers (clickable → zoom/select on the map).
const lotsById = computed(() => { const m = new Map<string, any>(); for (const l of lots.value) m.set(l.id, l); return m })
const blocksById = computed(() => { const m = new Map<string, any>(); for (const b of blocks.value) m.set(b.id, b); return m })
const failingChecks = computed(() =>
  validation.value.checks.filter(c => !c.pass && ((c.lotIds && c.lotIds.length) || (c.blockIds && c.blockIds.length) || (c.roadIds && c.roadIds.length))))
function lotChip(id: string) { const l = lotsById.value.get(id); return l ? `Lot ${l.lotNumber ?? '?'} · ${l.areaSqm} m²` : 'Lot' }
function blockChip(id: string) { const b = blocksById.value.get(id); return b ? `Block · ${fmtA(b.areaSqm)}` : 'Block' }
function focusLot(id: string, variant?: 'env') { emit('focus', { kind: 'lot', id, variant }) }
function focusBlock(id: string) { emit('focus', { kind: 'block', id }) }
function onTargetDensity(e: Event) { p.setTargetDensity(Number((e.target as HTMLInputElement).value) || 0) }

// Density vs target indicator (±10% band).
const densityStatus = computed(() => {
  const t = targetDensityPerHa.value
  if (!t) return null
  const net = metrics.value.netDensityPerHa
  const ratio = net / t
  if (ratio < 0.9) return { label: 'Under target', cls: 'under' }
  if (ratio > 1.1) return { label: 'Over target', cls: 'over' }
  return { label: 'Meets target', cls: 'meets' }
})

const tab = ref<'design' | 'streets' | 'lots' | 'metrics' | 'projects'>('design')
const hasArea = computed(() => !!planningArea.value)

function setTool(t: PlanningTool) {
  tool.value = tool.value === t ? 'idle' : t
}

// ── Streets & Blocks / manual lot edit ────────────────────────────────────
const fmtA = (s: number) => (s >= 10000 ? `${(s / 10000).toFixed(2)} ha` : `${Math.round(s)} m²`)
const fmtL = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`)
function delRoad(id: string) { p.removeRoad(id); emit('notify', 'Road deleted', 'success') }
function subBlock(id: string) {
  p.subdivideOne(id)
  emit('notify', 'Block subdivided', 'success')
}
function doMergeSelected() {
  const ok = p.mergeSelected()
  emit('notify', ok ? 'Lots merged' : 'Pick 2+ adjacent lots first', ok ? 'success' : 'error')
}
function doRenumber() { p.renumberLots(); emit('notify', 'Lots renumbered', 'success') }
function lotCountFor(id: string) { return lots.value.filter(l => l.blockId === id).length }
function setBlockFrontage(b: any, e: Event) {
  const mode = (e.target as HTMLSelectElement).value as 'longest' | 'both'
  b.frontageMode = mode
  p.subdivideOne(b.id, { frontageMode: mode })
  emit('notify', mode === 'both' ? 'Block loaded from both sides' : 'Block loaded from longest edge', 'success')
}
function onZone(e: Event) {
  p.applyZone((e.target as HTMLSelectElement).value)
  emit('notify', 'Zone standards applied', 'success')
}
function genBlocks() {
  if (!hasArea.value) return emit('notify', 'Select a planning parcel first', 'error')
  p.runBlocks()
  emit('notify', `${blocks.value.length} block(s) generated`, blocks.value.length ? 'success' : 'error')
}
function runSub() {
  if (!hasArea.value) return emit('notify', 'Select a planning parcel first', 'error')
  p.runSubdivision()
  emit('notify', `${lots.value.length} lot(s) created`, lots.value.length ? 'success' : 'error')
}

// ── Projects ────────────────────────────────────────────────────────────────
const projects = ref<Array<{ id: string; name: string }>>([])
const loadingProjects = ref(false)
async function refreshProjects() {
  loadingProjects.value = true
  try {
    const res = await planningApi.listProjects()
    projects.value = res.data?.data ?? res.data ?? []
  } catch { projects.value = [] }
  finally { loadingProjects.value = false }
}
async function openProject(id: string) {
  const ok = await p.loadProject(id)
  emit('notify', ok ? 'Project loaded' : 'Could not load project', ok ? 'success' : 'error')
}
async function save() {
  const r = await p.save()
  emit('notify', r.ok ? 'Planning project saved' : 'Save failed — backend offline?', r.ok ? 'success' : 'error')
  if (r.ok) refreshProjects()
}

// Export the whole subdivision (boundary + roads + lots + open space +
// constraints) as a georeferenced AutoCAD DXF — UTM metres, each collection on
// its own layer, every closed lot auto-labelled by number + area.
function exportDxf() {
  const a = planningArea.value
  const feats: any[] = []
  if (a) feats.push({ type: 'Feature', properties: { kind: 'boundary', id: a.name }, geometry: a.geom })
  for (const c of constraints.value) feats.push({ type: 'Feature', properties: { kind: 'constraint', id: c.label }, geometry: c.geom })
  for (const r of roads.value) feats.push({ type: 'Feature', properties: { kind: 'road', dxfLayer: `ROADS-${r.hierarchy.toUpperCase()}` }, geometry: r.geom })
  for (const o of openSpace.value) feats.push({ type: 'Feature', properties: { kind: 'open_space' }, geometry: o.geom })
  for (const l of lots.value) feats.push({ type: 'Feature', properties: { kind: 'lot', id: `Lot ${l.lotNumber ?? ''}`.trim(), roundTripId: l.id }, geometry: l.geom })
  if (!feats.length) { emit('notify', 'Nothing to export — design a subdivision first', 'error'); return }
  try {
    const res = exportFeaturesToDxf(feats, [], { fileName: 'vungu-subdivision-plan', title: projectName.value || 'Subdivision' })
    emit('notify', `DXF exported — ${res.count} entities · UTM zone ${res.zone}`, 'success')
  } catch {
    emit('notify', 'DXF export failed', 'error')
  }
}
function exportCsv() {
  if (!lots.value.length) { emit('notify', 'No lots to export — run subdivision first', 'error'); return }
  exportLotScheduleCsv(lots.value, projectName.value || 'subdivision')
  emit('notify', `Lot schedule exported (${lots.value.length} lots)`, 'success')
}

// Import a DXF laid out or edited in QGIS/AutoCAD/Civil3D/Bricscad — the
// return trip of exportDxf(). Reconciled by usePlanningTools().importDxf();
// if the result looks wrong, Undo (autosave/undo-history already tracks this
// like any other edit) rather than a separate confirm step.
const dxfFileInput = ref<HTMLInputElement | null>(null)
function triggerImportDxf() {
  if (!hasArea.value) { emit('notify', 'Select a planning parcel first', 'error'); return }
  dxfFileInput.value?.click()
}
async function onImportDxfFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-selecting the same file
  const a = planningArea.value
  if (!file || !a) return
  try {
    const text = await file.text()
    const centroid = turf.centroid(turf.feature(a.geom as any)).geometry.coordinates as [number, number]
    const parsed = parseDxfToGeoJSON(text, centroid)
    const r = p.importDxf(parsed.featureCollection as any)
    if (!r.ok) {
      emit('notify', r.reason === 'empty' ? 'No lots or roads found in that DXF' : 'Select a planning parcel first', 'error')
      return
    }
    const parts = [`${r.matched} matched`, r.added ? `${r.added} added` : '', r.removed ? `${r.removed} removed` : '']
      .filter(Boolean).join(' · ')
    const warn = parsed.warnings.length ? ` — ${parsed.warnings.join(' ')}` : ''
    emit('notify', `Imported from DXF: ${parts}${warn}`, 'success')
  } catch (err: any) {
    emit('notify', err?.message || 'Could not read that DXF', 'error')
  }
}
onMounted(refreshProjects)
</script>

<template>
  <div class="pl-panel">
    <!-- Save state -->
    <div class="pl-saved" :class="{ unsaved: dirty }">
      <component :is="dirty ? CloudUpload : Cloud" :size="12" />
      <span>{{ dirty ? 'Unsaved changes' : 'All changes saved' }}</span>
    </div>

    <!-- Planning toolbar -->
    <div class="pl-toolbar">
      <button class="pl-tool" :class="{ active: tool === 'select-parcel' }" @click="setTool('select-parcel')" title="Click a parcel on the map to set the planning area">
        <MousePointerSquareDashed :size="15" /><span>Select Parcel</span>
      </button>
      <button class="pl-tool" :class="{ active: tool === 'draw-road' }" :disabled="!hasArea" @click="setTool('draw-road')" title="Click to add street vertices, double-click to finish">
        <Spline :size="15" /><span>Draw Road</span>
      </button>
      <button class="pl-tool" :disabled="!hasArea" @click="genBlocks" title="Cut the parcel into blocks along the roads">
        <Grid2x2 :size="15" /><span>Generate Blocks</span>
      </button>
      <button class="pl-tool primary" :disabled="!blocks.length" @click="runSub" title="Auto-fill (engine v2): frontage-based tiling, deterministic. Deep blocks may create interior reserves or flag lots far from streets — add manual streets to refine.">
        <LayoutGrid :size="15" /><span>Run Subdivision</span>
      </button>
    </div>

    <!-- Engine-version note (only when a loaded project predates the current engine) -->
    <div v-if="engineNote" class="pl-engine-note">{{ engineNote }}</div>

    <div v-if="tool !== 'idle'" class="pl-hint">
      <span v-if="tool === 'select-parcel'">Click a parcel — or a polygon you drew — to set the area…</span>
      <span v-else-if="tool === 'draw-road'">Click to add street points · double-click to finish</span>
      <button class="pl-stop" @click="tool = 'idle'"><Square :size="11" /> Stop</button>
    </div>

    <!-- Area summary -->
    <div class="pl-area" :class="{ empty: !hasArea }">
      <template v-if="hasArea">
        <strong>{{ planningArea!.name }}</strong>
        <span>{{ (planningArea!.areaSqm / 10000).toFixed(2) }} ha · {{ roads.length }} road(s) · {{ blocks.length }} block(s) · {{ lots.length }} lot(s)</span>
      </template>
      <span v-else>No planning area yet — use <b>Select Parcel</b>.</span>
    </div>

    <!-- Tabs -->
    <nav class="pl-tabs">
      <button :class="{ active: tab === 'design' }" @click="tab = 'design'">Design</button>
      <button :class="{ active: tab === 'streets' }" @click="tab = 'streets'">Streets</button>
      <button :class="{ active: tab === 'lots' }" @click="tab = 'lots'">Lots</button>
      <button :class="{ active: tab === 'metrics' }" @click="tab = 'metrics'">Metrics</button>
      <button :class="{ active: tab === 'projects' }" @click="tab = 'projects'">Projects</button>
    </nav>

    <!-- DESIGN: constraints (Phase-1 lite) -->
    <section v-if="tab === 'design'" class="pl-tab">
      <h4>Constraints</h4>
      <button class="pl-btn" :disabled="!hasArea" @click="emit('river-buffer')">
        <Droplets :size="14" /> Add river buffer (30 m)
      </button>
      <ul v-if="constraints.length" class="pl-list">
        <li v-for="c in constraints" :key="c.id">
          <span class="pl-swatch cons"></span>{{ c.label }}
          <button class="pl-x" @click="p.removeConstraint(c.id)">✕</button>
        </li>
      </ul>
      <p v-else class="pl-muted">No constraints. River buffers reduce buildable land and lower the lot yield.</p>
      <p class="pl-muted">Slope / floodplain masks arrive in a later phase (need the DEM service).</p>
    </section>

    <!-- STREETS & BLOCKS -->
    <section v-else-if="tab === 'streets'" class="pl-tab">
      <div class="pl-row-head">
        <h4>Streets ({{ roadSummaries.length }})</h4>
        <button class="pl-icon" @click="roadsVisible = !roadsVisible" :title="roadsVisible ? 'Hide roads' : 'Show roads'">
          <component :is="roadsVisible ? Eye : EyeOff" :size="14" />
        </button>
      </div>
      <ul v-if="roadSummaries.length" class="pl-list">
        <li v-for="r in roadSummaries" :key="r.id">
          <Spline :size="12" />
          <span class="pl-rd">{{ r.hierarchy }} · {{ r.widthM }} m · {{ fmtL(r.lengthM) }}</span>
          <button class="pl-x" @click="delRoad(r.id)" title="Delete road"><Trash2 :size="12" /></button>
        </li>
      </ul>
      <p v-else class="pl-muted">No streets yet — use Draw Road.</p>

      <h4>Blocks ({{ blocks.length }})</h4>
      <ul v-if="blocks.length" class="pl-list">
        <li v-for="b in blocks" :key="b.id" class="pl-block-row">
          <Grid2x2 :size="12" />
          <span class="pl-block-meta">{{ fmtA(b.areaSqm) }} · {{ lotCountFor(b.id) }} lot(s)</span>
          <select class="pl-sel" :value="b.frontageMode || 'longest'" @change="setBlockFrontage(b, $event)" title="Which edges to load lots from">
            <option value="longest">Longest edge</option>
            <option value="both">Both sides</option>
          </select>
          <button class="pl-mini" @click="subBlock(b.id)" title="Subdivide this block with current rules">
            <LayoutGrid :size="11" /> Subdivide
          </button>
        </li>
      </ul>
      <p v-else class="pl-muted">No blocks yet — Generate Blocks first.</p>

      <h4>Edit lots</h4>
      <div class="pl-toolbar">
        <button class="pl-tool" :class="{ active: tool === 'split-lot' }" :disabled="!lots.length" @click="setTool('split-lot')">
          <Scissors :size="15" /><span>Split lot</span>
        </button>
        <button class="pl-tool" :class="{ active: tool === 'merge-lots' }" :disabled="lots.length < 2" @click="setTool('merge-lots')">
          <Combine :size="15" /><span>Merge lots</span>
        </button>
      </div>
      <div v-if="tool === 'split-lot'" class="pl-hint"><span>Click a lot, then click 2 points across it · double-click to cut</span></div>
      <div v-else-if="tool === 'merge-lots'" class="pl-hint"><span>Click adjacent lots to select ({{ mergeSelection.length }}), then Merge selected</span></div>
      <button v-if="mergeSelection.length" class="pl-btn" @click="doMergeSelected">
        <Combine :size="14" /> Merge selected ({{ mergeSelection.length }})
      </button>
      <button class="pl-btn" :disabled="!lots.length" @click="doRenumber">
        <Hash :size="14" /> Renumber lots (per block)
      </button>
    </section>

    <!-- LOTS: subdivision rules -->
    <section v-else-if="tab === 'lots'" class="pl-tab">
      <h4>Subdivision rules</h4>
      <label class="pl-field">Lot width (m)
        <span class="pl-range">
          <input type="number" v-model.number="rules.minWidthM" min="5" /> –
          <input type="number" v-model.number="rules.maxWidthM" min="5" />
        </span>
      </label>
      <label class="pl-field">Target width (m)
        <input type="number" v-model.number="rules.targetWidthM" min="5" />
      </label>
      <label class="pl-field">Max depth (m)
        <input type="number" v-model.number="rules.maxDepthM" min="10" />
      </label>
      <label class="pl-field">Min lot area (m²)
        <input type="number" v-model.number="rules.minAreaSqm" min="50" step="50" />
      </label>
      <label class="pl-field">Rows
        <select v-model.number="rules.rows"><option :value="1">Single</option><option :value="2">Double</option></select>
      </label>
      <label class="pl-field">Frontage
        <select v-model="rules.frontageMode"><option value="longest">Longest edge</option><option value="both">Both sides</option></select>
      </label>
      <label class="pl-field">Width variation
        <input type="range" min="0" max="0.5" step="0.05" v-model.number="rules.widthVariation" />
        <span class="pl-val">{{ Math.round(rules.widthVariation * 100) }}%</span>
      </label>
      <button class="pl-btn primary" :disabled="!blocks.length || busy" @click="runSub">
        <Play :size="14" /> Run subdivision
      </button>
      <label class="pl-toggle"><input type="checkbox" v-model="showEnvelopes" /> Show building envelopes</label>

      <h4>Lot use</h4>
      <label class="pl-field">Use type
        <select v-model="bulkUseType">
          <option v-for="u in useList" :key="u.use" :value="u.use">{{ u.label }} ({{ u.defaultUnitsPerLot }} u)</option>
        </select>
      </label>
      <div class="pl-toolbar">
        <button class="pl-btn" :disabled="!lots.length" @click="applyUseAll">Apply to all</button>
        <button class="pl-btn" :disabled="!mergeSelection.length" @click="applyUseSelected">To selected ({{ mergeSelection.length }})</button>
      </div>
      <label class="pl-toggle"><input type="checkbox" v-model="colourByUse" /> Colour by use type</label>
      <p class="pl-muted">{{ lots.length }} lot(s) · {{ openSpace.length }} open-space piece(s)</p>
    </section>

    <!-- METRICS -->
    <section v-else-if="tab === 'metrics'" class="pl-tab">
      <h4>Metrics</h4>
      <div class="pl-metrics">
        <div><span>Lots</span><b>{{ metrics.lotCount }}</b></div>
        <div><span>Avg lot</span><b>{{ metrics.avgLotAreaSqm }} m²</b></div>
        <div><span>Density</span><b>{{ metrics.grossDensityPerHa }}/ha</b></div>
        <div><span>Open space</span><b>{{ metrics.openSpacePct }}%</b></div>
        <div><span>Road length</span><b>{{ metrics.roadLengthM }} m</b></div>
        <div><span>Efficiency</span><b>{{ metrics.efficiencyPct }}%</b></div>
      </div>
      <h4>Density &amp; yield</h4>
      <div class="pl-den">
        <div class="pl-den-row"><span>Net developable</span><b>{{ metrics.netDevelopableAreaHa }} ha</b></div>
        <div class="pl-den-row"><span>Gross density</span><b>{{ metrics.grossDensityPerHa }} /ha</b></div>
        <div class="pl-den-row">
          <span>Net density</span><b>{{ metrics.netDensityPerHa }} /ha</b>
          <span v-if="densityStatus" class="pl-badge" :class="densityStatus.cls">{{ densityStatus.label }}</span>
        </div>
      </div>
      <label class="pl-field">Target density (lots/ha)
        <input type="number" min="0" step="1" :value="targetDensityPerHa" @change="onTargetDensity" />
      </label>

      <h4>Units &amp; yield</h4>
      <div class="pl-den">
        <div class="pl-den-row"><span>Total lots</span><b>{{ metrics.lotCount }}</b></div>
        <div class="pl-den-row"><span>Total units</span><b>{{ metrics.totalUnits }}</b></div>
        <div class="pl-den-row"><span>Units / ha (net)</span><b>{{ metrics.unitsPerHa }}</b></div>
        <div v-for="(u, k) in metrics.yieldByUseType" :key="k" class="pl-den-row"><span>{{ useLabelFor(k) }}</span><b>{{ u }} unit(s)</b></div>
      </div>

      <h4>Parking</h4>
      <div class="pl-den">
        <div class="pl-den-row"><span>Required</span><b>{{ metrics.requiredParkingSpaces }}</b></div>
        <div class="pl-den-row">
          <span>Provided (assumed)</span><b>{{ metrics.providedParkingSpaces }}</b>
          <span class="pl-badge" :class="parkingStatus.cls">{{ parkingStatus.label }}</span>
        </div>
      </div>

      <h4>Standards &amp; compliance</h4>
      <label class="pl-field">Zone
        <select :value="activeZone" @change="onZone">
          <option v-for="z in zoneList" :key="z.zone" :value="z.zone">{{ z.label }}</option>
        </select>
      </label>
      <p class="pl-std">Min lot {{ validation.zone.minLotAreaSqm }} m² · Min frontage {{ validation.zone.minFrontageM }} m · Open space ≥ {{ validation.zone.minOpenSpacePct }}%</p>
      <p class="pl-std">Setbacks — front {{ validation.zone.frontSetbackM }} m · side {{ validation.zone.sideSetbackM }} m · rear {{ validation.zone.rearSetbackM }} m</p>
      <p class="pl-std">Corner — front {{ validation.zone.cornerFrontSetbackM ?? validation.zone.frontSetbackM }} m · side {{ validation.zone.cornerSideSetbackM ?? validation.zone.sideSetbackM }} m</p>
      <p class="pl-std">Cul-de-sac — max {{ validation.zone.maxCulDeSacLengthM }} m · {{ validation.zone.maxCulDeSacLots }} lots · Parking {{ validation.zone.parkingSpacesPerUnit }}/unit</p>
      <p class="pl-std">Reserves — {{ reserveLine }}</p>
      <label class="pl-toggle"><input type="checkbox" v-model="showEnvelopes" /> Show building envelopes</label>
      <ul class="pl-checks">
        <li v-for="(c, i) in validation.checks" :key="i" :class="c.pass ? 'ok' : 'bad'">
          <component :is="c.pass ? CheckCircle2 : AlertTriangle" :size="12" />
          <span class="pl-check-label">{{ c.label }}</span>
          <em>{{ c.detail }}</em>
        </li>
      </ul>

      <!-- Clickable issues → zoom + highlight on the map -->
      <div v-if="failingChecks.length" class="pl-issues">
        <h4>Issues</h4>
        <div v-for="c in failingChecks" :key="'iss-' + c.key" class="pl-issue-group">
          <div class="pl-issue-head">{{ c.label }} ({{ (c.lotIds?.length || c.blockIds?.length) }})</div>
          <div class="pl-chips">
            <button v-for="id in (c.lotIds || []).slice(0, 12)" :key="id" class="pl-chip" :class="{ env: c.key === 'envelope' }" @click="focusLot(id, c.key === 'envelope' ? 'env' : undefined)">{{ lotChip(id) }}</button>
            <button v-for="id in (c.blockIds || []).slice(0, 12)" :key="id" class="pl-chip" @click="focusBlock(id)">{{ blockChip(id) }}</button>
            <button v-for="id in (c.roadIds || []).slice(0, 12)" :key="id" class="pl-chip" @click="focusRoad(id)">{{ roadChip(id) }}</button>
          </div>
        </div>
      </div>

      <label class="pl-field">Project name
        <input type="text" v-model="projectName" />
      </label>
      <button class="pl-btn primary" :disabled="!hasArea || busy" @click="save">
        <Save :size="14" /> Save project
      </button>
      <button class="pl-btn" :disabled="!hasArea" @click="exportDxf" title="Export the subdivision as a georeferenced AutoCAD DXF (UTM metres, layers per collection, lots labelled by area)">
        <Download :size="14" /> Export DXF (AutoCAD)
      </button>
      <button class="pl-btn" :disabled="!hasArea" @click="triggerImportDxf" title="Import a DXF laid out or edited in QGIS, AutoCAD, Civil3D, or Bricscad — matches lots back by id, adds new ones, replaces roads if the file has any">
        <Upload :size="14" /> Import from CAD/QGIS (DXF)
      </button>
      <input ref="dxfFileInput" type="file" accept=".dxf" class="pl-hidden-input" aria-label="Import DXF" @change="onImportDxfFile" />
      <button class="pl-btn" :disabled="!lots.length" @click="exportCsv" title="Export the schedule of lots as CSV (lot no, block, area, frontage, depth)">
        <FileText :size="14" /> Lot schedule (CSV)
      </button>
      <button class="pl-btn" :disabled="!lots.length" @click="emit('export-pdf')" title="Export a printable subdivision plan PDF (layout, north arrow, scale bar, area schedule)">
        <FileText :size="14" /> Subdivision plan (PDF)
      </button>
    </section>

    <!-- PROJECTS -->
    <section v-else class="pl-tab">
      <div class="pl-row-head">
        <h4>Planning projects</h4>
        <button class="pl-icon" :disabled="loadingProjects" @click="refreshProjects" title="Refresh">
          <RefreshCw :size="13" :class="{ spin: loadingProjects }" />
        </button>
      </div>
      <ul v-if="projects.length" class="pl-list">
        <li v-for="pr in projects" :key="pr.id">
          <FolderOpen :size="13" />
          <button class="pl-link" @click="openProject(pr.id)">{{ pr.name || pr.id }}</button>
        </li>
      </ul>
      <p v-else class="pl-muted">{{ loadingProjects ? 'Loading…' : 'No saved projects yet.' }}</p>
    </section>
  </div>
</template>

<style scoped>
.pl-panel { display: flex; flex-direction: column; gap: 0.6rem; }
.pl-hidden-input { display: none; }
.pl-toolbar { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; }
.pl-tool { display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem;
  height: 2.1rem; border: 1px solid #e2e8f0; border-radius: 0.35rem; background: #fff;
  color: #334155; font-size: 0.68rem; font-weight: 600; cursor: pointer; transition: all .12s; }
.pl-tool:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.pl-tool:disabled { opacity: 0.45; cursor: not-allowed; }
.pl-tool.active { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
.pl-tool.primary { background: #0369a1; color: #fff; border-color: #0369a1; }
.pl-tool.primary:disabled { background: #94a3b8; border-color: #94a3b8; }

.pl-hint { display: flex; align-items: center; gap: 0.5rem; font-size: 0.66rem; color: #1e40af;
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 0.35rem; padding: 0.3rem 0.5rem; }
.pl-stop { margin-left: auto; display: inline-flex; align-items: center; gap: 0.2rem;
  border: none; background: #1e293b; color: #fff; border-radius: 0.25rem; padding: 0.15rem 0.4rem;
  font-size: 0.62rem; cursor: pointer; }

.pl-area { font-size: 0.68rem; line-height: 1.35; color: #0f172a; background: #f1f5f9;
  border-radius: 0.35rem; padding: 0.4rem 0.55rem; display: flex; flex-direction: column; gap: 0.1rem; }
.pl-area.empty { color: #64748b; }
.pl-area strong { font-size: 0.74rem; }

.pl-tabs { display: flex; gap: 0.15rem; border-bottom: 1px solid #e2e8f0; }
.pl-tabs button { flex: 1; border: none; background: none; padding: 0.4rem 0.2rem; font-size: 0.64rem;
  font-weight: 600; color: #94a3b8; cursor: pointer; border-bottom: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.03em; }
.pl-tabs button.active { color: #0f172a; border-bottom-color: #0369a1; }

.pl-tab { display: flex; flex-direction: column; gap: 0.45rem; }
.pl-tab h4 { margin: 0; font-size: 0.7rem; font-weight: 700; color: #0f172a; }
.pl-field { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.68rem; color: #475569; }
.pl-field input[type=number], .pl-field input[type=text], .pl-field select {
  width: 5.5rem; border: 1px solid #e2e8f0; border-radius: 0.25rem; padding: 0.25rem 0.4rem; font-size: 0.68rem; }
.pl-field input[type=text] { width: 9rem; }
.pl-range { display: inline-flex; align-items: center; gap: 0.25rem; }
.pl-range input { width: 3.4rem; }
.pl-val { width: 2.5rem; text-align: right; font-variant-numeric: tabular-nums; }

.pl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
  height: 2rem; border: 1px solid #e2e8f0; border-radius: 0.35rem; background: #fff; color: #334155;
  font-size: 0.7rem; font-weight: 600; cursor: pointer; }
.pl-btn:hover:not(:disabled) { background: #f8fafc; }
.pl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pl-btn.primary { background: #0369a1; color: #fff; border-color: #0369a1; }
.pl-btn.primary:disabled { background: #94a3b8; border-color: #94a3b8; }

.pl-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
.pl-metrics div { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.35rem; padding: 0.35rem 0.5rem; display: flex; flex-direction: column; }
.pl-metrics span { font-size: 0.58rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.pl-metrics b { font-size: 0.85rem; color: #0f172a; }

.pl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.pl-list li { display: flex; align-items: center; gap: 0.4rem; font-size: 0.68rem; color: #334155; }
.pl-link { border: none; background: none; color: #0369a1; cursor: pointer; font-size: 0.68rem; text-align: left; padding: 0; }
.pl-link:hover { text-decoration: underline; }
.pl-x { margin-left: auto; border: none; background: none; color: #94a3b8; cursor: pointer; font-size: 0.7rem; display: inline-flex; align-items: center; }
.pl-x:hover { color: #b91c1c; }
.pl-rd { text-transform: capitalize; }
.pl-mini { display: inline-flex; align-items: center; gap: 0.2rem; border: 1px solid #cbd5e1;
  background: #fff; color: #0369a1; border-radius: 0.25rem; padding: 0.12rem 0.4rem; font-size: 0.6rem; font-weight: 600; cursor: pointer; }
.pl-mini:hover { background: #f0f9ff; }
.pl-block-row { gap: 0.3rem; }
.pl-block-meta { flex: 1; min-width: 0; }
.pl-sel { font-size: 0.6rem; border: 1px solid #e2e8f0; border-radius: 0.25rem; padding: 0.1rem 0.2rem; background: #fff; color: #0f172a; cursor: pointer; }
.pl-std { font-size: 0.62rem; color: #64748b; margin: 0; }
.pl-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.pl-checks li { display: flex; align-items: center; gap: 0.35rem; font-size: 0.64rem; }
.pl-checks li.ok { color: #166534; }
.pl-checks li.bad { color: #b91c1c; }
.pl-check-label { color: #334155; }
.pl-checks em { margin-left: auto; font-style: normal; color: #94a3b8; font-size: 0.6rem; }

.pl-saved { display: inline-flex; align-items: center; gap: 0.3rem; align-self: flex-start;
  font-size: 0.6rem; font-weight: 600; color: #166534; background: #f0fdf4;
  border: 1px solid #bbf7d0; border-radius: 9999px; padding: 0.15rem 0.5rem; }
.pl-saved.unsaved { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.pl-engine-note { margin: 0.1rem 0 0; padding: 0.35rem 0.5rem; font-size: 0.72rem; line-height: 1.3;
  color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 0.4rem; }

.pl-den { display: flex; flex-direction: column; gap: 0.25rem; }
.pl-den-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.66rem; color: #475569; }
.pl-den-row b { color: #0f172a; }
.pl-badge { margin-left: auto; font-size: 0.58rem; font-weight: 700; padding: 0.05rem 0.4rem; border-radius: 9999px; }
.pl-badge.under { background: #fef9c3; color: #854d0e; }
.pl-badge.meets { background: #dcfce7; color: #166534; }
.pl-badge.over { background: #fee2e2; color: #991b1b; }

.pl-issues { display: flex; flex-direction: column; gap: 0.4rem; }
.pl-issue-group { display: flex; flex-direction: column; gap: 0.25rem; }
.pl-issue-head { font-size: 0.62rem; font-weight: 700; color: #b91c1c; }
.pl-chips { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.pl-chip { border: 1px solid #fecaca; background: #fff; color: #991b1b; border-radius: 0.3rem;
  padding: 0.1rem 0.4rem; font-size: 0.58rem; cursor: pointer; }
.pl-chip:hover { background: #fef2f2; }
.pl-chip.env { border-color: #e9d5ff; color: #7e22ce; }
.pl-chip.env:hover { background: #faf5ff; }
.pl-toggle { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.66rem; color: #334155; cursor: pointer; }
.pl-toggle input { width: 0.85rem; height: 0.85rem; accent-color: #14b8a6; }
.pl-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.pl-swatch.cons { background: #ef4444; }
.pl-row-head { display: flex; align-items: center; justify-content: space-between; }
.pl-icon { border: none; background: none; color: #64748b; cursor: pointer; }
.pl-muted { font-size: 0.64rem; color: #94a3b8; line-height: 1.4; margin: 0; }
.spin { animation: pl-spin 1s linear infinite; }
@keyframes pl-spin { to { transform: rotate(360deg); } }
</style>
