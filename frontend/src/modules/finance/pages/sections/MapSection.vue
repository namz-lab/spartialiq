<script setup lang="ts">
/**
 * The finance map (GIS–finance Milestones 3–5): where the Council's money is, geographically.
 *
 * WHAT SHADING MEANS HERE
 * Every shaded figure comes from finance.v_ward_performance via /finance/map/wards — the same
 * SQL views the consoles read. This section renders; it never computes. A ward with no value
 * for the selected measure is grey ("no data"), never the bottom class: a ward with no
 * expenditure budget did not spend zero.
 *
 * THE THREE HONEST STATES
 * 1. Ward register not linked (Council decision D11 open): the banner says so, no polygon is
 *    invented, and the measures appear in the table below instead. Migration 201 links the
 *    national register as INTERIM data, so the banner also labels a provisional list.
 * 2. Register linked but no ward-tagged figures for the year: wards draw grey with the note.
 * 3. Figures whose ward code is not one of the council's wards: shown, flagged `unlinked`.
 *
 * THE PROJECT LAYER (M5)
 * A capital project is a graduated circle at its recorded point. A project with no point is not
 * nudged to a ward centroid: it is listed in "what the map cannot place", by name, so an officer
 * can fix it. Physical progress is shown only when it was recorded (decision D12); a null is
 * "not recorded", never 0 %.
 *
 * THE UNLOCATED CARD
 * Records with no geography at all are a first-class panel, not a rounding error: what the
 * map cannot place is stated with amounts, per currency, per dataset.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, Download, ExternalLink, Info, Layers, MapPin, RefreshCw } from 'lucide-vue-next'
import {
  addVunguBasemap, PLANNER_BASEMAP_DEFAULT, prefersReducedMotion, watchWebglContext,
} from '@/map/vunguBasemap'
import { baseMapStyle, FINANCE_NO_DATA, FINANCE_PROJECT_STATUS } from '@/map/vunguBasemapStyle'
import { exportMapToPdf, type LegendEntry } from '@/map/tools/mapExport'
import { useFinanceStore, messageOf } from '../../stores/finance'
import { financeApi } from '../../api/financeApi'
import type {
  ActualsBasis, ProjectMapData, ProjectMapProperties, WardDimension, WardDimensionRow,
  WardGeometryData, WardMapData, WardPerformanceRow, WardProjectSummary,
} from '../../api/financeApi'
import type { BudgetLinePerformance, Currency, FinanceProject } from '../../models/types'
import {
  ACTUALS_BASIS_LABELS, CHOROPLETH_COLORS, MEASURES, MEASURE_GROUPS, canvasState,
  circleRadiusExpression, computeBreaks, fillExpression, formatMeasure, mapExportMeta,
  mapPresetFor, measureValue, projectStatusColor, rowsByWard, type MeasureKey,
} from '../../composables/useFinanceMap'
import { formatDate, formatDateTime, formatMoney, formatPercentage } from '../../composables/useMoney'
import { describeProgress, describeSpendVsProgress } from '../../composables/useProjectProgress'
import SpatialAllocationPanel from '../../components/SpatialAllocationPanel.vue'
import SpatialSplitsQueue from '../../components/SpatialSplitsQueue.vue'
import ProjectProgressControl from '../../components/ProjectProgressControl.vue'

const store = useFinanceStore()
const router = useRouter()
const route = useRoute()

const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const mapData = ref<WardMapData | null>(null)
const projectData = ref<ProjectMapData | null>(null)
const geometry = ref<WardGeometryData | null>(null)

// M6-1: the map opens on the measure this person's permissions imply. These are DEFAULTS ONLY —
// every control stays available, and the permission `finance.map.view` (checked by the rail and the
// server) is what decides whether the section is reachable at all. The section is mounted after the
// identity loads, so the permission set is complete here; it is read once, not watched.
const preset = mapPresetFor(store.permissions)
const measure = ref<MeasureKey>(preset.measure)
const currency = ref<Currency>(preset.currency ?? 'USD')
const dimension = ref<WardDimension>(preset.dimension)
const showProjects = ref(preset.showProjects)
const projectMeasure = ref<'approved_budget' | 'allocated_total' | 'actual_spend'>(preset.projectMeasure)
/**
 * M4-5: which of the two legitimate attribution rules the `*_actual` figures on screen follow.
 *
 * Both are in every row, and they genuinely differ — a transaction's own ward code against the ward
 * of the budget line it posts to. The map must say which one it is showing, and must not pick one
 * silently, so this is a control with its sentence under the legend rather than a constant.
 */
const actualsBasis = ref<ActualsBasis>('transaction_ward_code')
/** Scope filters the endpoint already applies in SQL (M4-4). The client never groups rows itself. */
const departmentId = ref<string>('')
const programmeId = ref<string>('')
const accountKind = ref<'' | 'revenue' | 'expenditure'>('')
/** M5: the project layer's own filters. `exceptions_only` is the view's flag, not a client test. */
const projectStatus = ref<string>('')
const exceptionsOnly = ref(false)
/** GAP-2: the cross-subject split register, opened by the work queue's `?splits=` link. */
const showSplits = ref(route.query.splits === 'draft' || route.query.splits === 'all')
const selectedWard = ref<string | null>(null)
const selectedProjectId = ref<string | null>(null)
const wardLines = ref<BudgetLinePerformance[]>([])
const wardProjects = ref<FinanceProject[]>([])
const paintBreaks = ref<number[]>([])
const projectBreaks = ref<number[]>([])
const allocationFor = ref<{
  kind: 'budget_line' | 'project'; id: string; label: string; currency: Currency
  /** The subject's own total, as the view serves it, shown as the cap. Never used in arithmetic. */
  cap: string | null
  capLabel: string
} | null>(null)

const yearId = computed(() => store.selectedYearId)
const yearLabel = computed(() => store.selectedYear?.label ?? '')
const linked = computed(() => geometry.value?.ward_register_linked === true)
const provisionalWardList = computed(() =>
  (mapData.value?.ward_register_bases ?? []).includes('interim'))
const joined = computed(() =>
  mapData.value ? rowsByWard(mapData.value.wards, currency.value) : new Map<string, WardPerformanceRow>())
const wardRows = computed(() =>
  mapData.value?.wards.filter((w) => !w.unlocated_reason && w.currency === currency.value) ?? [])
const unlocatedRows = computed(() =>
  mapData.value?.unlocated.filter((u) => u.currency === currency.value) ?? [])
const currencies = computed(() => {
  const present = mapData.value?.currencies ?? []
  return present.length > 0 ? present : (['USD', 'ZWG'] as Currency[])
})
const selectedRow = computed(() =>
  selectedWard.value ? joined.value.get(selectedWard.value) ?? null : null)
const measureLabel = computed(() => MEASURES.find((m) => m.key === measure.value)?.label ?? '')
const selectedFeature = computed(() =>
  geometry.value?.features.find((f) => f.properties.ward_code === selectedWard.value) ?? null)
const wardProjectSummary = computed<WardProjectSummary | null>(() =>
  mapData.value?.projects_by_ward.find((p) =>
    p.ward_code === selectedWard.value && p.currency === currency.value) ?? null)
const selectedWardDimensions = computed<WardDimensionRow[]>(() =>
  (mapData.value?.ward_dimensions ?? []).filter((d) =>
    d.ward_code === selectedWard.value && d.currency === currency.value))
const projectFeatures = computed<ProjectMapProperties[]>(() => {
  if (!showProjects.value || !projectData.value) return []
  return projectData.value.features.features
    .map((f) => f.properties)
    .filter((p) => p.currency === currency.value)
})
const selectedProject = computed<ProjectMapProperties | null>(() => {
  if (!selectedProjectId.value) return null
  return projectData.value?.features.features
    .find((f) => f.properties.project_id === selectedProjectId.value)?.properties ?? null
})
const unlocatedProjects = computed(() =>
  (projectData.value?.unlocated_projects ?? []).filter((p) => p.currency === currency.value))
const actualsBasisNote = computed(() =>
  ACTUALS_BASIS_LABELS[mapData.value?.actuals_basis ?? 'transaction_ward_code']
  ?? 'The attribution rule for actuals is not stated.')
const projectMeasureLabel = computed(() => ({
  approved_budget: 'Approved budget',
  allocated_total: 'Allocated total',
  actual_spend: 'Actual spend',
}[projectMeasure.value]))
const projectStatuses = computed(() =>
  [...new Set(projectFeatures.value.map((p) => p.status))].sort())
/** Canvas or sentence, and whether the table must stand in for the picture. */
const canvas = computed(() => canvasState({
  contextLost: contextLost.value,
  wardRegisterLinked: linked.value,
  wardCount: wardTableRows.value.length,
}))

/**
 * THE TABLE BENEATH THE MAP — the keyboard and screen-reader equivalent of the choropleth.
 *
 * It is built from the WARD LIST, not from the figures, and that difference is the whole point
 * right now: with 19 polygons drawn and no ward-tagged figure anywhere, a table of figures is
 * empty and a keyboard user cannot select a single ward the mouse can click (WCAG 2.1.1). Every
 * drawn ward is a row; a ward with no figures says so in words rather than being absent.
 *
 * A coded ward that is NOT in the register is appended rather than dropped — a legacy or imported
 * code is still money somewhere, and hiding it would make the table disagree with the view.
 */
const wardTableRows = computed<Array<{
  code: string; name: string | null; row: WardPerformanceRow | null; inRegister: boolean
}>>(() => {
  const rows: Array<{
    code: string; name: string | null; row: WardPerformanceRow | null; inRegister: boolean
  }> = []
  const seen = new Set<string>()
  for (const f of geometry.value?.features ?? []) {
    seen.add(f.properties.ward_code)
    rows.push({
      code: f.properties.ward_code,
      name: f.properties.name ?? null,
      row: joined.value.get(f.properties.ward_code) ?? null,
      inRegister: true,
    })
  }
  for (const w of wardRows.value) {
    if (seen.has(w.ward_code)) continue
    rows.push({ code: w.ward_code, name: null, row: w, inRegister: false })
  }
  return rows
})
/** The ward chosen while it carries no figures — a real selection with an honest empty panel. */
const selectedWardName = computed(() =>
  wardTableRows.value.find((r) => r.code === selectedWard.value)?.name ?? null)
/** Wards whose rows the views flagged, so the map can state them instead of dropping them. */
const attributionExceptionWards = computed(() =>
  wardRows.value.filter((w) => Number(w.attribution_exception_rows ?? 0) > 0))
const remainderWards = computed(() =>
  wardRows.value.filter((w) => w.unallocated_remainder_amount !== null
    && w.unallocated_remainder_amount !== undefined))
/** The project panel's wording for physical delivery; one helper for the whole module. */
const selectedProjectProgress = computed(() => describeProgress(
  selectedProject.value?.physical_progress_percent ?? null))
const selectedProjectComparison = computed(() => describeSpendVsProgress({
  physicalProgressPercent: selectedProject.value?.physical_progress_percent ?? null,
  executionPercentage: selectedProject.value?.execution_percentage ?? null,
  gapPoints: selectedProject.value?.spend_vs_progress_gap_points ?? null,
  aheadOfProgress: selectedProject.value?.spend_ahead_of_progress ?? null,
  thresholdPoints: selectedProject.value?.spend_ahead_of_progress_threshold_points ?? null,
}))

// ── data ─────────────────────────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  if (!yearId.value) { mapData.value = null; projectData.value = null; return }
  loading.value = true
  error.value = null
  try {
    const [wards, wardGeometry, projects] = await Promise.all([
      financeApi.mapWards({
        financial_year_id: yearId.value,
        dimension: dimension.value,
        actuals_basis: actualsBasis.value,
        department_id: departmentId.value || undefined,
        programme_id: programmeId.value || undefined,
        account_kind: accountKind.value || undefined,
      }),
      geometry.value ? Promise.resolve(geometry.value) : financeApi.mapWardGeometry(),
      showProjects.value
        ? financeApi.mapProjects({
          financial_year_id: yearId.value,
          status: projectStatus.value || undefined,
          department_id: departmentId.value || undefined,
          exceptions_only: exceptionsOnly.value || undefined,
        })
        : Promise.resolve(null),
    ])
    mapData.value = wards
    geometry.value = wardGeometry
    projectData.value = projects
    // Default to the first currency that actually has figures, so the first paint is not empty.
    if (wards.currencies.length > 0 && !wards.currencies.includes(currency.value)) {
      currency.value = wards.currencies[0]
    }
    paint()
    paintProjects()
    if (selectedWard.value) await loadWardDetail(selectedWard.value)
  } catch (err) {
    error.value = messageOf(err, 'The finance map could not be read.')
  } finally {
    loading.value = false
  }
}

async function loadWardDetail(code: string): Promise<void> {
  if (!yearId.value) return
  wardLines.value = []
  wardProjects.value = []
  try {
    const [lines, projects] = await Promise.all([
      store.can('finance.budget.view')
        ? financeApi.budgetLines({ financial_year_id: yearId.value, ward_code: code, limit: 15 })
        : Promise.resolve({ lines: [], total: 0, limit: 0, offset: 0,
          available_balance_includes_commitments: false }),
      store.can('finance.project.view')
        ? financeApi.projects({ ward_code: code, limit: 10 })
        : Promise.resolve([] as FinanceProject[]),
    ])
    wardLines.value = lines.lines
    wardProjects.value = projects
  } catch {
    // The panel figures still stand; drill-down fetches are best-effort.
  }
}

/**
 * Audit X-2: selecting a ward publishes it — to the store, which the Budget and Projects registers
 * watch, and to the URL, so `/finance?section=map&ward=ZW170401` is a link a committee paper can
 * cite and a reload can restore. The write is `replace`, not `push`: choosing a ward is refining a
 * view, not navigating, and it should not fill the back button.
 */
async function selectWard(code: string, publish = true): Promise<void> {
  selectedWard.value = code
  selectedProjectId.value = null
  allocationFor.value = null
  store.setMapWard(code)
  if (publish && route.query.ward !== code) {
    void router.replace({ query: { ...route.query, section: 'map', ward: code } })
  }
  await loadWardDetail(code)
}

function selectProject(id: string): void {
  selectedProjectId.value = id
  selectedWard.value = null
  allocationFor.value = null
  const project = selectedProject.value
  if (project?.ward_code) store.setMapWard(project.ward_code)
}

function openAllocations(
  kind: 'budget_line' | 'project', id: string, label: string, currency: Currency,
  cap: string | null = null, capLabel = 'revised total',
): void {
  allocationFor.value = { kind, id, label, currency, cap, capLabel }
}

/** From the cross-subject queue into the subject's own panel, where the cap is in view. */
function openSubjectSplits(subject: {
  kind: 'budget_line' | 'project'; id: string; label: string
}): void {
  const line = wardLines.value.find((l) => l.budget_line_id === subject.id)
  const project = projectFeatures.value.find((pr) => pr.project_id === subject.id)
  if (subject.kind === 'budget_line' && line) {
    openAllocations('budget_line', line.budget_line_id, subject.label, line.currency,
      line.revised_amount, 'revised total')
    return
  }
  if (subject.kind === 'project' && project) {
    openAllocations('project', project.project_id, subject.label, project.currency,
      project.allocated_total, 'allocated total')
    return
  }
  // The subject is not in this view's lists (another year, another ward, no location). The
  // register still opens — it simply cannot state the cap, and says so rather than guessing one.
  allocationFor.value = {
    kind: subject.kind, id: subject.id, label: subject.label,
    currency: currency.value, cap: null,
    capLabel: subject.kind === 'project' ? 'allocated total' : 'revised total',
  }
}

/** An approved split changes the ward figures, so the map is re-read from the views. */
async function onAllocationsChanged(): Promise<void> {
  await load()
  if (selectedWard.value) await loadWardDetail(selectedWard.value)
}

function openInBudget(): void {
  if (!selectedWard.value) return
  router.push({ query: { section: 'budget', ward: selectedWard.value } })
}

/** X-2: the ward travels. This used to push `{section:'projects'}` and open the register unfiltered. */
function openInProjects(): void {
  const ward = selectedWard.value ?? selectedProject.value?.ward_code ?? null
  router.push({ query: ward ? { section: 'projects', ward } : { section: 'projects' } })
}

/**
 * M6-3: print the sheet that is on screen, with its provenance attached. The subtitle and footer
 * name the year, currency, measure, source view and the view's `generated_at`; the legend is the
 * same ramp and project-status key the officer is reading. Nothing is recomputed for export — the
 * canvas carries the SQL-derived figures that were painted.
 */
async function exportPdf(): Promise<void> {
  if (!map || !mapReady.value || !mapData.value || exporting.value) return
  exporting.value = true
  error.value = null
  try {
    await exportMapToPdf(map, {
      title: 'Vungu Rural District Council — Finance map',
      subtitle: exportMeta.value.subtitle,
      provenance: exportMeta.value.provenance,
      legend: exportLegend.value,
      fileName: `vungu-finance-${slug(yearLabel.value || 'map')}-${currency.value}-${measure.value}`,
    })
  } catch (err) {
    error.value = messageOf(err, 'The map could not be exported.')
  } finally {
    exporting.value = false
  }
}

/** A file name that survives every operating system, built from the sheet's own labels. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map'
}

// ── map ──────────────────────────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLElement | null>(null)
let map: maplibregl.Map | null = null
let resizeObserver: ResizeObserver | null = null
let unwatchContext: (() => void) | null = null
const mapReady = ref(false)
/**
 * The canvas lost its WebGL context. MapLibre does not recover by itself, so the surface says so
 * and keeps the table: a blank choropleth beside a legend reads as "this ward has no budget",
 * which is exactly the misreading the missing-is-not-zero rule exists to prevent.
 */
const contextLost = ref(false)
const SOURCE = 'fin-wards'
const FILL = 'fin-wards-fill'
const OUTLINE = 'fin-wards-outline'
const PROJECT_SOURCE = 'fin-projects'
const PROJECT_CIRCLE = 'fin-projects-circle'
const EMPTY_FC = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection

function featureCollection(): GeoJSON.FeatureCollection {
  if (!linked.value || !geometry.value) return EMPTY_FC
  const features: GeoJSON.Feature[] = []
  for (const f of geometry.value.features) {
    if (!f.geometry) continue
    features.push({
      type: 'Feature',
      properties: {
        ward_code: f.properties.ward_code,
        name: f.properties.name,
        value: measureValue(joined.value.get(f.properties.ward_code), measure.value),
      },
      geometry: f.geometry as unknown as GeoJSON.Geometry,
    })
  }
  return { type: 'FeatureCollection', features }
}

function projectFeatureCollection(): GeoJSON.FeatureCollection {
  if (!showProjects.value || !projectData.value) return EMPTY_FC
  return {
    type: 'FeatureCollection',
    features: projectFeatures.value
      .filter((p) => p.longitude !== null && p.longitude !== undefined
        && p.latitude !== null && p.latitude !== undefined)
      .map((p) => {
        const raw = p[projectMeasure.value]
        return {
          type: 'Feature',
          properties: {
            ...p,
            value: raw === null || raw === undefined ? null : Number(raw),
          },
          geometry: { type: 'Point', coordinates: [p.longitude as number, p.latitude as number] },
        } as GeoJSON.Feature
      }),
  }
}

/**
 * Status colour for the capital circles.
 *
 * Guarded for arity like the choropleth's: a `match` with no label/output pair is
 * `['match', input, fallback]`, which MapLibre refuses the same way it refuses a stop-less `step`.
 * The scale is a constant today, so the guard can only fire if the registry is ever emptied — at
 * which point a flat no-data colour is the right answer anyway, since no status has a colour.
 */
function projectColorExpression(): unknown {
  const pairs: string[] = []
  for (const [status, color] of Object.entries(FINANCE_PROJECT_STATUS)) pairs.push(status, color)
  if (pairs.length === 0) return FINANCE_NO_DATA
  return ['match', ['get', 'status'], ...pairs, FINANCE_NO_DATA]
}

function paint(): void {
  if (!map || !mapReady.value) return
  const fc = featureCollection()
  const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) source.setData(fc)
  const values = fc.features
    .map((f) => (f.properties as { value: number | null }).value)
    .filter((v): v is number => v !== null)
  paintBreaks.value = computeBreaks(values)
  if (map.getLayer(FILL)) {
    map.setPaintProperty(FILL, 'fill-color', fillExpression(paintBreaks.value) as never)
  }
  if (fc.features.length > 0) {
    const bounds = new maplibregl.LngLatBounds()
    for (const f of fc.features) {
      const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
      const coords = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const ring of coords) for (const point of ring[0]) bounds.extend(point as [number, number])
    }
    // X-7: the same motion contract as every other map in the product. It was hardcoded to 0 ms,
    // which is accessible by accident and off-spec by DESIGN.md's "Click and motion" rule.
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 48, maxZoom: 11,
        duration: prefersReducedMotion() ? 0 : 700,
      })
    }
  }
}

/**
 * The capital layer.
 *
 * M5-3: WITH NO FEATURES THE LAYER IS NOT ON THE MAP AT ALL. An empty geojson source paints nothing
 * but still answers `queryRenderedFeatures`, so it keeps intercepting the clicks that belong to the
 * ward beneath it — and today, with one project and no coordinate, "no features" is the normal
 * case. The layer is therefore added when there is something to draw and removed when there is not.
 */
function paintProjects(): void {
  if (!map || !mapReady.value) return
  const fc = projectFeatureCollection()
  const source = map.getSource(PROJECT_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) source.setData(fc)
  const values = fc.features
    .map((f) => (f.properties as { value: number | null }).value)
    .filter((v): v is number => v !== null)
  projectBreaks.value = computeBreaks(values)

  if (fc.features.length === 0) {
    if (map.getLayer(PROJECT_CIRCLE)) map.removeLayer(PROJECT_CIRCLE)
    return
  }
  if (!map.getLayer(PROJECT_CIRCLE)) {
    map.addLayer({
      id: PROJECT_CIRCLE, type: 'circle', source: PROJECT_SOURCE,
      paint: {
        // A null figure gets the MINIMUM radius, never 0: invisible is not "no money", and a
        // project whose allocation has not been recorded still exists at its point.
        'circle-radius': circleRadiusExpression(projectBreaks.value) as never,
        'circle-color': projectColorExpression() as never,
        'circle-opacity': 0.86,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.4,
      },
    })
    return
  }
  map.setPaintProperty(PROJECT_CIRCLE, 'circle-radius',
    circleRadiusExpression(projectBreaks.value) as never)
  map.setPaintProperty(PROJECT_CIRCLE, 'circle-color', projectColorExpression() as never)
}

function initMap(): void {
  if (!mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    // Without an explicit style the map never fires `load`, so nothing below ever runs:
    // no basemap, no ward polygons, a transparent canvas (see baseMapStyle).
    style: baseMapStyle(),
    center: [29.95, -19.15], // Vungu RDC district, adjusted when ward bounds arrive
    zoom: 8.4,
    // M6-3: an exported map sheet must not be a blank canvas.
    preserveDrawingBuffer: true,
    attributionControl: { compact: true },
  })
  map.on('load', async () => {
    // M5-9: a quiet reference base. The full catalogue (buildings, POIs, stands, four admin
    // fills) competes with a 0.78-opacity finance choropleth for the same pixels; and with the
    // basemap's ward layer hidden, its admin drill-zoom cannot move the camera under a click
    // that belongs to the finance overlay.
    await addVunguBasemap(map!, { defaultVisible: PLANNER_BASEMAP_DEFAULT })
    map!.addSource(SOURCE, { type: 'geojson', data: EMPTY_FC })
    map!.addSource(PROJECT_SOURCE, { type: 'geojson', data: EMPTY_FC })
    map!.addLayer({
      id: FILL, type: 'fill', source: SOURCE,
      paint: { 'fill-color': FINANCE_NO_DATA, 'fill-opacity': 0.78 },
    })
    map!.addLayer({
      id: OUTLINE, type: 'line', source: SOURCE,
      paint: { 'line-color': '#1f2937', 'line-width': 1.1, 'line-opacity': 0.75 },
    })
    // The circle layer is NOT added here. `paintProjects()` adds it only when there is a located
    // project to draw, and removes it again when there is not (M5-3).
    mapReady.value = true
    paint()
    paintProjects()
  })
  map.on('click', PROJECT_CIRCLE, (e) => {
    const id = (e.features?.[0]?.properties as { project_id?: string } | undefined)?.project_id
    if (id) selectProject(id)
  })
  map.on('click', FILL, (e) => {
    // A circle sits inside a ward polygon, so the same click reaches both layer handlers. If the
    // point hit a project, let the project handler own it; otherwise selecting a ward would clear
    // the project panel that was just opened. The layer may not exist (M5-3), so it is checked.
    if (map!.getLayer(PROJECT_CIRCLE)
        && map!.queryRenderedFeatures(e.point, { layers: [PROJECT_CIRCLE] }).length > 0) return
    const code = (e.features?.[0]?.properties as { ward_code?: string } | undefined)?.ward_code
    if (code) void selectWard(code)
  })
  map.on('mouseenter', FILL, () => { map!.getCanvas().style.cursor = 'pointer' })
  map.on('mouseenter', PROJECT_CIRCLE, () => { map!.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', FILL, () => { map!.getCanvas().style.cursor = '' })
  map.on('mouseleave', PROJECT_CIRCLE, () => { map!.getCanvas().style.cursor = '' })
  unwatchContext = watchWebglContext(map, {
    onLost: () => { contextLost.value = true; mapReady.value = false },
    // Some browsers grant the context back. MapLibre still needs its sources and layers again,
    // so the map is rebuilt rather than assumed to have survived.
    onRestored: () => { void rebuildMap() },
  })
  resizeObserver = new ResizeObserver(() => map?.resize())
  resizeObserver.observe(mapEl.value)
}

/** Tear the map down and build it again — the only reliable recovery from a lost context. */
async function rebuildMap(): Promise<void> {
  unwatchContext?.()
  unwatchContext = null
  resizeObserver?.disconnect()
  resizeObserver = null
  map?.remove()
  map = null
  mapReady.value = false
  contextLost.value = false
  await nextTick()
  initMap()
  await load()
}

onMounted(() => {
  initMap()
  // Audit X-2, the inbound half. The map used to initialise `selectedWard` to null and consult
  // neither the URL nor the store, so a deep link or a hand-back from Budget opened on nothing.
  const linked = typeof route.query.ward === 'string' && route.query.ward
    ? route.query.ward
    : store.mapWardCode
  if (linked) selectedWard.value = linked
  void load()
})
onBeforeUnmount(() => {
  unwatchContext?.()
  unwatchContext = null
  resizeObserver?.disconnect()
  map?.remove()
  map = null
})
watch(yearId, () => void load())
watch([dimension, actualsBasis, departmentId, programmeId, accountKind], () => void load())
watch([projectStatus, exceptionsOnly], () => { if (showProjects.value) void load() })
watch(showProjects, () => { if (showProjects.value && !projectData.value) void load(); else paintProjects() })
watch([measure, currency], () => paint())
watch([projectMeasure, currency], () => paintProjects())
watch(mapReady, (ready) => { if (ready) { paint(); paintProjects() } })
/** A `?ward=` arriving while the section is mounted (a queue link, a back button) must still apply. */
watch(() => route.query.ward, (ward) => {
  const code = typeof ward === 'string' ? ward : ''
  if (code && code !== selectedWard.value) void selectWard(code, false)
  else if (!code && selectedWard.value) { selectedWard.value = null; store.setMapWard(null) }
})
watch(() => route.query.splits, (value) => {
  if (value === 'draft' || value === 'all') showSplits.value = true
})

const legendEntries = computed(() => {
  const breaks = paintBreaks.value
  if (breaks.length === 0) {
    return [{ color: CHOROPLETH_COLORS[0], label: 'all wards with a figure' }]
  }
  const colors = CHOROPLETH_COLORS.slice(0, breaks.length + 1)
  const fmt = (v: number) =>
    MEASURES.find((m) => m.key === measure.value)!.kind === 'percent'
      ? `${v.toFixed(0)}%`
      : MEASURES.find((m) => m.key === measure.value)!.kind === 'count'
        ? String(v)
        : compactMoney(v)
  const entries: Array<{ color: string; label: string }> = []
  for (let i = 0; i < colors.length; i++) {
    const from = i === 0 ? null : breaks[i - 1]
    const to = i < breaks.length ? breaks[i] : null
    entries.push({
      color: colors[i],
      label: to === null ? `over ${fmt(from!)}` : from === null ? `up to ${fmt(to)}` : `${fmt(from)} – ${fmt(to)}`,
    })
  }
  return entries
})

function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toFixed(0)
}

const DATASET_LABELS: Record<string, string> = {
  budget: 'Budget lines with no ward and no allocation',
  transactions: 'Transactions with no ward code',
  projects: 'Projects with no ward and no location',
}
const STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed', awaiting_approval: 'Awaiting approval', approved: 'Approved',
  in_progress: 'In progress', suspended: 'Suspended', completed: 'Completed',
  cancelled: 'Cancelled',
}

/** The printed sheet's metadata: what the figures are, and when the source view produced them. */
const exportMeta = computed(() => mapExportMeta({
  yearLabel: yearLabel.value,
  currency: currency.value,
  measureLabel: measureLabel.value,
  dimension: dimension.value,
  generatedAt: mapData.value?.generated_at,
  projectMeasureLabel: projectMeasureLabel.value,
  hasLocatedProjects: projectFeatures.value.length > 0,
  provisionalWardList: provisionalWardList.value,
}))

/** The same key as the on-screen legend, minus the circle-size sentence the PDF card cannot hold. */
const exportLegend = computed<LegendEntry[]>(() => {
  const entries: LegendEntry[] = []
  // Mirror the on-screen legend: only key the choropleth classes when there is a choropleth to key.
  if (linked.value && wardRows.value.length > 0) {
    entries.push({ color: FINANCE_NO_DATA, label: 'no data' })
    entries.push(...legendEntries.value)
  }
  if (showProjects.value && projectStatuses.value.length > 0) {
    for (const status of projectStatuses.value) {
      entries.push({
        color: projectStatusColor(status),
        label: `Project: ${STATUS_LABELS[status] ?? status}`,
      })
    }
  }
  return entries
})
</script>

<template>
  <!--
    NOT `fin-map`: that class is a definition-list layout for the import column-mapping panel
    (finance.css:201, `display: grid` with a 14rem label column), and this section's root picked it
    up by name. The toolbar was laid out in that 224px column — a vertical stack of selects beside
    the canvas — which is the same failure mode as reusing `.ins-bar`, a progress meter, as a
    toolbar. The section's own root needs its own name.
  -->
  <div class="fin-map-section">
    <div v-if="error" class="ins-banner t-warning" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>

    <div class="fin-bar">
      <label class="fin-map-measure">
        <span class="ins-label">Measure</span>
        <select v-model="measure" class="ins-input" aria-label="Measure to shade the wards by">
          <optgroup v-for="group in MEASURE_GROUPS" :key="group.id" :label="group.label">
            <option v-for="m in group.measures" :key="m.key" :value="m.key">{{ m.label }}</option>
          </optgroup>
          <!--
            D13. "Areas with outstanding revenue" was asked for and cannot be built: no debtor or
            arrears amount exists anywhere in the database, and `revenue_link` carries account keys
            and status bands with no amounts, by design. It is listed as unavailable with its reason
            rather than quietly absent — a reader promised an arrears map must learn why there isn't
            one — and nothing in this module derives a figure for it. A collection shortfall against
            budget is not a debt anyone owes.
          -->
          <optgroup label="Not available">
            <option disabled value="__arrears_unavailable">
              Outstanding revenue (arrears) — no data source (Council decision D13)
            </option>
          </optgroup>
        </select>
      </label>
      <label>
        <span class="ins-label">Currency</span>
        <select v-model="currency" class="ins-input" aria-label="Currency (currencies are never combined)">
          <option v-for="c in currencies" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label>
        <span class="ins-label">Breakdown</span>
        <select v-model="dimension" class="ins-input" aria-label="Show the ward total or a department/programme breakdown">
          <option value="total">Ward totals</option>
          <option value="department">By department</option>
          <option value="programme">By programme</option>
        </select>
      </label>
      <!--
        M4-5. The basis is a CONTROL, not a constant: "actual" has two legitimate definitions and
        the figures differ. Nothing is picked silently — the choice is here and its sentence is
        under the legend.
      -->
      <label class="fin-map-measure">
        <span class="ins-label">Actuals attributed by</span>
        <select v-model="actualsBasis" class="ins-input"
                aria-label="Which attribution rule the actual figures follow">
          <option value="transaction_ward_code">The transaction's own ward code</option>
          <option value="budget_line_ward_code">The budget line's ward</option>
        </select>
      </label>
      <label class="fin-map-measure">
        <span class="ins-label">Department</span>
        <select v-model="departmentId" class="ins-input"
                aria-label="Confine the figures to one department (applied in SQL)">
          <option value="">Every department in your scope</option>
          <option v-for="d in store.activeDepartments" :key="d.id" :value="d.id">
            {{ d.code }} {{ d.name }}
          </option>
        </select>
      </label>
      <label v-if="store.programmes.length > 0" class="fin-map-measure">
        <span class="ins-label">Programme</span>
        <select v-model="programmeId" class="ins-input" aria-label="Confine the figures to one programme">
          <option value="">Every programme</option>
          <option v-for="p in store.programmes" :key="p.id" :value="p.id">{{ p.code }} {{ p.name }}</option>
        </select>
      </label>
      <label class="fin-map-measure">
        <span class="ins-label">Vote</span>
        <select v-model="accountKind" class="ins-input" aria-label="Revenue or expenditure accounts only">
          <option value="">Revenue and expenditure</option>
          <option value="revenue">Revenue only</option>
          <option value="expenditure">Expenditure only</option>
        </select>
      </label>
      <label class="fin-map-check">
        <input v-model="showProjects" type="checkbox" />
        <span>Projects</span>
      </label>
      <label v-if="showProjects" class="fin-map-measure">
        <span class="ins-label">Circle size</span>
        <select v-model="projectMeasure" class="ins-input" aria-label="Project figure that sets the circle size">
          <option value="approved_budget">Approved budget</option>
          <option value="allocated_total">Allocated total</option>
          <option value="actual_spend">Actual spend</option>
        </select>
      </label>
      <label v-if="showProjects" class="fin-map-measure">
        <span class="ins-label">Project status</span>
        <select v-model="projectStatus" class="ins-input" aria-label="Show only projects in one state">
          <option value="">Any status</option>
          <option v-for="(label, value) in STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label v-if="showProjects" class="fin-map-check">
        <input v-model="exceptionsOnly" type="checkbox" />
        <span title="Projects the view flagged as spending ahead of their recorded progress">
          Exceptions only
        </span>
      </label>
      <label class="fin-map-check">
        <input v-model="showSplits" type="checkbox" />
        <span>Ward splits</span>
      </label>
      <span class="fin-map-year ins-hint">{{ yearLabel || 'No financial year selected' }} · {{ measureLabel }}</span>
      <button type="button" class="fin-btn small" :disabled="loading" @click="load">
        <RefreshCw :size="13" aria-hidden="true" :class="{ 'ins-spin': loading }" /> Refresh
      </button>
      <button type="button" class="fin-btn small"
              :disabled="exporting || loading || !mapReady || !mapData"
              :aria-busy="exporting"
              title="Download this map as a PDF with its year, currency, measure and source view"
              @click="exportPdf">
        <Download :size="13" aria-hidden="true" /> {{ exporting ? 'Exporting…' : 'Export PDF' }}
      </button>
    </div>

    <p v-if="!yearId" class="ins-hint">
      Choose a financial year in the workspace header to see its geography.
    </p>

    <!--
      Provenance, outside the legend (audit X-3).
      It used to live in the legend card, which renders only when there are figures to key — so in
      the state this council is actually in, the surface showed no source and no date at all. Two
      timestamps, two meanings: `data_as_at` is the last committed import, `generated_at` is when
      the query ran, and a figure quoted without both cannot be checked later. A null data date
      says the currency of the data is not recorded; it is never allowed to read as "now".
    -->
    <p v-if="mapData" class="ins-hint fin-map-provenance">
      Source: {{ (mapData.sources ?? []).join(', ') || 'finance.v_ward_performance' }}
      · figures as at
      {{ mapData.data_as_at ? formatDateTime(mapData.data_as_at) : 'data currency not recorded' }}
      · read {{ formatDateTime(mapData.generated_at) }}
      · {{ actualsBasisNote }}
      <template v-if="mapData.department_scope">
        · confined to your department scope, so these are not council-wide totals
      </template>
    </p>

    <!--
      Attribution exceptions and the unattributed remainder are SURFACED, not hidden. Both are
      figures the views compute (migration 202): a split that exceeds its line's revised total is
      published as an exception rather than suppressed, and the remainder of a split line is money
      the choropleth is not shading anywhere. A map that quietly dropped either would be showing
      less than the council's own books.
    -->
    <div v-if="attributionExceptionWards.length > 0" class="ins-banner t-warning" role="status">
      <AlertTriangle :size="16" aria-hidden="true" />
      <span>
        {{ attributionExceptionWards.length }}
        ward{{ attributionExceptionWards.length === 1 ? '' : 's' }}
        ({{ attributionExceptionWards.map((w) => w.ward_code).join(', ') }})
        carry attribution exceptions — approved splits that exceed the line's revised total
        (decision D16). Their figures are published as they are, not corrected here; withdraw the
        splits that no longer fit from the line's ward allocations.
      </span>
    </div>
    <div v-if="remainderWards.length > 0" class="ins-banner t-info" role="status">
      <Info :size="16" aria-hidden="true" />
      <span>
        An unallocated remainder is recorded against
        {{ remainderWards.length }} ward{{ remainderWards.length === 1 ? '' : 's' }}: money on a
        split line that no approved split places. It is never spread across the splits, and it is a
        measure of its own in the Attribution group.
      </span>
    </div>

    <div class="fin-map-grid">
      <div class="fin-map-canvas-wrap">
        <!--
          The canvas is kept in the DOM (maplibre owns it) and covered when the context is lost, so
          a rebuild has a container to mount into. What the reader sees is the sentence, not a
          blank box with a legend beside it.
        -->
        <div ref="mapEl" class="fin-map-canvas"
             :class="{ 'is-dead': contextLost }"
             :aria-hidden="contextLost ? 'true' : undefined"
             aria-label="Ward choropleth of the selected finance measure"></div>

        <div v-if="canvas.message" class="fin-map-canvas-lost" role="alert">
          <AlertTriangle :size="18" aria-hidden="true" />
          <p>{{ canvas.message }}</p>
          <button v-if="canvas.offerRetry" type="button" class="fin-btn" @click="rebuildMap">
            <RefreshCw :size="14" aria-hidden="true" /> Reload the map
          </button>
        </div>

        <div v-if="!contextLost && mapData && !linked" class="fin-map-overlay fin-map-banner" role="status">
          <Info :size="15" aria-hidden="true" />
          <span>Ward boundaries for this council are not linked yet (Council decision D11 is open).
            The measures below are real — nothing can be shaded on the map until the official
            ward list is recorded.</span>
        </div>

        <!--
          Audit §6.3. "No data" is not an answer on its own: the reader needs to know WHICH of the
          two causes applies, with the counts, and where the money that cannot be placed has gone.
          Today every ward is grey because no budget line and no transaction carries a ward code —
          a fact this banner states rather than leaving the grey to be interpreted.
        -->
        <div v-if="!contextLost && mapData && linked && wardRows.length === 0" class="fin-map-overlay fin-map-banner" role="status">
          <Info :size="15" aria-hidden="true" />
          <span>
            The ward register is linked ({{ geometry?.features.length ?? 0 }} wards), but no budget
            line or transaction carries a ward code for {{ yearLabel || 'this year' }} in
            {{ currency }}. Every ward is therefore grey — <strong>no data, not zero</strong>.
            <template v-if="unlocatedRows.length > 0">
              {{ unlocatedRows.reduce((n, u) => n + u.unlocated_rows, 0) }} records are listed under
              “what the map cannot place”.
            </template>
          </span>
        </div>

        <!--
          Decision D11. The polygons are drawn because the boundaries are real, but the list of
          wards that belongs to this council is INTERIM reference data pending a Council
          resolution. This label sits on the canvas, not only in the legend: the legend is hidden
          whenever there are no figures to key, which is exactly the state the map is in today.
        -->
        <p v-if="!contextLost && linked && provisionalWardList" class="fin-map-overlay fin-map-provisional-badge" role="note">
          <Info :size="13" aria-hidden="true" />
          Provisional ward list (D11) — {{ geometry?.features.length ?? 0 }} wards loaded as interim
          reference data, not confirmed by Council resolution.
        </p>

        <div v-if="!contextLost && mapData && linked && wardRows.length > 0" class="fin-map-overlay fin-map-legend">
          <p class="fin-map-legend-title">{{ measureLabel }} · {{ currency }} · {{ yearLabel }}</p>
          <ul>
            <li><span class="fin-swatch" :style="{ background: FINANCE_NO_DATA }"></span>no data</li>
            <li v-for="(entry, i) in legendEntries" :key="i">
              <span class="fin-swatch" :style="{ background: entry.color }"></span>{{ entry.label }}
            </li>
          </ul>
          <p v-if="showProjects && projectFeatures.length > 0" class="fin-map-legend-sub">
            <span class="fin-circle-key" aria-hidden="true"></span>
            Projects: circle area = {{ projectMeasureLabel }}; colour = status
          </p>
          <ul v-if="showProjects && projectStatuses.length > 0" class="fin-map-status-key">
            <li v-for="status in projectStatuses" :key="status">
              <span class="fin-swatch" :style="{ background: projectStatusColor(status) }"></span>
              {{ STATUS_LABELS[status] ?? status }}
            </li>
          </ul>
          <!--
            X-3. Two timestamps, two meanings, stated separately. `data_as_at` is the last committed
            import — how current the council's accounting records in this system are. `generated_at`
            is when the SQL ran. Showing only the second, labelled "as at", said the figures were
            current to the second. When nothing has been imported `data_as_at` is null, and the line
            says the data currency is not recorded rather than quietly reading as now.
          -->
          <p class="ins-hint">
            Source: {{ (mapData.sources ?? []).join(', ') || 'finance.v_ward_performance' }}<br />
            Figures as at
            {{ mapData.data_as_at ? formatDateTime(mapData.data_as_at) : 'data currency not recorded' }}
            · read {{ formatDateTime(mapData.generated_at) }}<br />
            {{ actualsBasisNote }}
          </p>
          <p v-if="mapData.department_scope" class="ins-hint">
            Confined to your department scope — these are not council-wide totals.
          </p>
          <p v-if="provisionalWardList" class="fin-map-provisional">
            <Info :size="12" aria-hidden="true" /> Ward list is provisional (D11) — unconfirmed reference geography.
          </p>
        </div>
      </div>

      <div class="fin-map-side">
        <section v-if="selectedProject" class="ins-card fin-project-card">
          <div class="ins-card-head">
            <h3><MapPin :size="15" aria-hidden="true" /> {{ selectedProject.reference }}</h3>
            <span class="fin-chip" :style="{ background: FINANCE_PROJECT_STATUS[selectedProject.status] ?? FINANCE_NO_DATA }">
              {{ STATUS_LABELS[selectedProject.status] ?? selectedProject.status }}
            </span>
          </div>
          <div class="ins-card-body">
            <p class="fin-project-name">{{ selectedProject.name }}</p>
            <dl class="fin-ward-facts">
              <dt>Department</dt>
              <dd>{{ selectedProject.department_name || selectedProject.department_code || '—' }}</dd>
              <dt>Ward</dt>
              <dd>
                {{ selectedProject.ward_code || 'not recorded' }}
                <span v-if="selectedProject.ward_status === 'unlinked'" class="fin-chip warn">unlinked code</span>
              </dd>
              <dt>Currency</dt><dd>{{ selectedProject.currency }}</dd>
              <dt>Approved budget</dt>
              <dd>{{ formatMoney(selectedProject.approved_budget, selectedProject.currency) }}</dd>
              <dt>Allocated total</dt>
              <dd>{{ formatMoney(selectedProject.allocated_total, selectedProject.currency) }}</dd>
              <dt>Actual spend</dt>
              <dd>{{ formatMoney(selectedProject.actual_spend, selectedProject.currency) }}</dd>
              <dt>Remaining</dt>
              <dd>{{ formatMoney(selectedProject.remaining_allocation, selectedProject.currency) }}</dd>
              <dt>Execution</dt>
              <dd>{{ selectedProject.execution_percentage === null ? 'not defined' : formatPercentage(selectedProject.execution_percentage) }}</dd>
              <!--
                D12. A null progress figure is "not recorded" and a null flag is "not compared" —
                neither may read as a pass. The wording comes from one helper so the panel, the
                register and the recording control cannot say it three different ways.
              -->
              <dt>Physical progress</dt>
              <dd :class="{ 'fin-absent': selectedProject.physical_progress_percent === null }">
                {{ selectedProjectProgress }}
              </dd>
              <dt>Progress recorded</dt>
              <dd>
                {{ selectedProject.progress_recorded_at
                  ? formatDateTime(selectedProject.progress_recorded_at)
                  : 'no figure recorded' }}
              </dd>
              <dt>Spend vs progress</dt>
              <dd :class="{ 'fin-absent': selectedProject.spend_ahead_of_progress === null }">
                {{ selectedProjectComparison.label }}
              </dd>
              <dt>Start · end</dt>
              <dd>{{ selectedProject.start_date ? formatDate(selectedProject.start_date) : '—' }}
                · {{ selectedProject.end_date ? formatDate(selectedProject.end_date) : '—' }}</dd>
              <dt>Location</dt>
              <dd>
                {{ selectedProject.location_text
                  || (selectedProject.longitude !== null && selectedProject.longitude !== undefined
                    ? `${selectedProject.longitude.toFixed(5)}, ${selectedProject.latitude?.toFixed(5)}`
                    : 'no recorded location') }}
              </dd>
            </dl>
            <div v-if="selectedProject.other_currency_spend && Object.keys(selectedProject.other_currency_spend).length > 0"
                 class="fin-other-currency">
              <h4>Spend in other currencies (never added to the total)</h4>
              <ul>
                <li v-for="(amount, ccy) in selectedProject.other_currency_spend" :key="ccy">
                  {{ formatMoney(amount, ccy as Currency) }}
                </li>
              </ul>
            </div>
            <div class="fin-ward-actions">
              <button type="button" class="fin-btn small" @click="openInProjects">
                <ExternalLink :size="13" aria-hidden="true" /> Open in Projects
              </button>
              <button type="button" class="fin-btn small"
                      @click="openAllocations('project', selectedProject.project_id,
                        selectedProject.reference, selectedProject.currency,
                        selectedProject.allocated_total, 'allocated total')">
                <Layers :size="13" aria-hidden="true" /> Ward allocations
              </button>
            </div>
          </div>
        </section>

        <section v-else-if="selectedRow" class="ins-card fin-ward-card">
          <div class="ins-card-head">
            <h3><MapPin :size="15" aria-hidden="true" />
              {{ selectedFeature?.properties.name || 'Ward' }} {{ selectedRow.ward_code }}</h3>
            <span v-if="selectedRow.ward_status === 'unlinked'" class="fin-chip warn">code not linked to this council</span>
            <span v-else class="fin-chip ok">linked ward</span>
          </div>
          <div class="ins-card-body">
            <dl class="fin-ward-facts">
              <dt>Expenditure budget</dt><dd>{{ formatMeasure(selectedRow, 'expenditure_budget') }}</dd>
              <dt>Original · adjustments</dt>
              <dd>{{ formatMeasure(selectedRow, 'expenditure_original') }} · {{ formatMeasure(selectedRow, 'expenditure_adjustments') }}</dd>
              <dt>Actual expenditure</dt><dd>{{ formatMeasure(selectedRow, 'expenditure_actual') }}</dd>
              <dt>Actual (via budget line)</dt><dd>{{ formatMeasure(selectedRow, 'expenditure_actual_via_line') }}</dd>
              <dt>Execution</dt><dd>{{ formatMeasure(selectedRow, 'execution') }}</dd>
              <dt>Open commitments</dt><dd>{{ formatMeasure(selectedRow, 'commitments') }}</dd>
              <dt>Available (excl. · incl.)</dt>
              <dd>{{ formatMeasure(selectedRow, 'available_excluding_commitments') }} ·
                {{ formatMeasure(selectedRow, 'available_including_commitments') }}</dd>
              <dt>Expenditure variance</dt><dd>{{ formatMeasure(selectedRow, 'expenditure_variance') }}</dd>
              <dt>Revenue budget</dt><dd>{{ formatMeasure(selectedRow, 'revenue_budget') }}</dd>
              <dt>Revenue collected</dt><dd>{{ formatMeasure(selectedRow, 'revenue_actual') }}</dd>
              <dt>Collection rate</dt><dd>{{ formatMeasure(selectedRow, 'revenue_collection_percentage') }}</dd>
              <dt>Revenue variance</dt><dd>{{ formatMeasure(selectedRow, 'revenue_variance') }}</dd>
              <dt>Attributed by splits</dt><dd>{{ formatMeasure(selectedRow, 'split_coverage_amount') }}</dd>
              <dt>Unallocated remainder</dt><dd>{{ formatMeasure(selectedRow, 'unallocated_remainder_amount') }}</dd>
              <dt>Attribution exceptions</dt><dd>{{ formatMeasure(selectedRow, 'attribution_exception_rows') }}</dd>
              <dt>Ward-tagged lines</dt><dd>{{ selectedRow.attributed_lines }}</dd>
              <dt>Allocation splits</dt><dd>{{ selectedRow.allocation_rows }}</dd>
              <dt>Transactions</dt><dd>{{ selectedRow.transaction_rows }}</dd>
              <dt>Year · currency</dt><dd>{{ yearLabel }} · {{ selectedRow.currency }}</dd>
            </dl>

            <div v-if="wardProjectSummary" class="fin-ward-projects-summary">
              <h4>Projects in this ward</h4>
              <dl class="fin-ward-facts">
                <dt>Projects · located</dt>
                <dd>{{ wardProjectSummary.project_count }} · {{ wardProjectSummary.located_project_count }}</dd>
                <dt>Approved budget</dt>
                <dd>{{ formatMoney(wardProjectSummary.approved_budget, wardProjectSummary.currency) }}</dd>
                <dt>Allocated · spent</dt>
                <dd>{{ formatMoney(wardProjectSummary.allocated_total, wardProjectSummary.currency) }} ·
                  {{ formatMoney(wardProjectSummary.actual_spend, wardProjectSummary.currency) }}</dd>
                <dt>Progress not recorded</dt>
                <dd>{{ wardProjectSummary.progress_not_recorded_count }}</dd>
                <dt>Spend ahead of progress</dt>
                <dd>{{ wardProjectSummary.spend_ahead_of_progress_count }}</dd>
              </dl>
            </div>

            <div v-if="selectedWardDimensions.length > 0" class="fin-ward-dimensions">
              <h4>{{ dimension === 'department' ? 'By department' : 'By programme' }}</h4>
              <table class="ins-table">
                <thead><tr><th>Kind</th><th>Name</th><th>Budget</th><th>Actual</th><th>Execution</th></tr></thead>
                <tbody>
                  <tr v-for="(d, i) in selectedWardDimensions" :key="i">
                    <td>{{ d.account_kind }}</td>
                    <td>{{ dimension === 'department'
                      ? (d.department_name || d.department_code || '—')
                      : (d.programme_name || d.programme_code || '—') }}</td>
                    <td>{{ formatMoney(d.budget_amount, d.currency) }}</td>
                    <td>{{ formatMoney(d.actual_amount, d.currency) }}</td>
                    <td>{{ d.execution_percentage === null ? 'not defined' : formatPercentage(d.execution_percentage) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="wardLines.length > 0" class="fin-ward-lines">
              <h4>Budget lines in this ward</h4>
              <table class="ins-table">
                <thead><tr><th>Line</th><th>Revised</th><th>Used</th><th><span class="sr-only">Allocations</span></th></tr></thead>
                <tbody>
                  <tr v-for="line in wardLines" :key="line.budget_line_id">
                    <td>{{ line.code }}</td>
                    <td>{{ formatMoney(line.revised_amount, line.currency) }}</td>
                    <td>{{ line.execution_percentage === null ? '—' : `${line.execution_percentage}%` }}</td>
                    <td>
                      <button type="button" class="fin-btn small"
                              @click="openAllocations('budget_line', line.budget_line_id, line.code,
                                line.currency, line.revised_amount, 'revised total')">
                        <Layers :size="12" aria-hidden="true" /> Splits
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="ins-hint">No budget lines carry this ward code in {{ yearLabel }}.</p>

            <div v-if="wardProjects.length > 0" class="fin-ward-projects">
              <h4>Projects in this ward</h4>
              <ul>
                <li v-for="p in wardProjects" :key="p.project_id">
                  {{ p.name }} <span class="fin-chip">{{ p.status }}</span>
                </li>
              </ul>
            </div>

            <div class="fin-ward-actions">
              <button type="button" class="fin-btn small" @click="openInBudget">
                <ExternalLink :size="13" aria-hidden="true" /> Open in Budget
              </button>
              <button v-if="wardProjects.length > 0" type="button" class="fin-btn small" @click="openInProjects">
                <ExternalLink :size="13" aria-hidden="true" /> Projects
              </button>
            </div>
          </div>
        </section>

        <!--
          A ward WAS selected and the views have no row for it. That is the state of every ward in
          this council today, and it is a fact worth a panel: the ward exists, the selection worked,
          and the absence of figures is what there is to report. Silently falling back to "choose a
          ward" would make a working click look like a broken one.
        -->
        <section v-else-if="selectedWard" class="ins-card fin-ward-card">
          <div class="ins-card-head">
            <h3><MapPin :size="15" aria-hidden="true" />
              {{ selectedWardName ? `${selectedWard} — ${selectedWardName}` : selectedWard }}</h3>
            <span class="fin-chip">no figures</span>
          </div>
          <div class="ins-card-body">
            <p class="ins-hint">
              No budget line, transaction or approved split attributes any {{ currency }} figure to
              this ward for {{ yearLabel || 'this year' }}. That is <strong>no data, not zero</strong>:
              the council's money for this period is recorded without a ward code, and it is listed
              under “what the map cannot place”.
            </p>
            <div class="fin-ward-actions">
              <button type="button" class="fin-btn small" @click="openInBudget">
                <ExternalLink :size="13" aria-hidden="true" /> Open this ward in Budget
              </button>
              <button type="button" class="fin-btn small" @click="openInProjects">
                <ExternalLink :size="13" aria-hidden="true" /> Projects
              </button>
            </div>
          </div>
        </section>

        <section v-else class="ins-card fin-ward-card">
          <div class="ins-card-body">
            <p class="ins-hint">
              {{ linked
                ? 'Select a ward on the map, or in the table below, to see its figures and drill into the records behind them.'
                : 'The ward register is not linked yet (D11). The measures that exist are listed below; selecting a row shows the same panel the map would.' }}
            </p>
          </div>
        </section>

        <section v-if="allocationFor" class="ins-card fin-allocation-panel">
          <div class="ins-card-head">
            <h3><Layers :size="15" aria-hidden="true" /> Ward allocations</h3>
            <button type="button" class="fin-btn small" @click="allocationFor = null">Close</button>
          </div>
          <div class="ins-card-body">
            <SpatialAllocationPanel
              :key="`${allocationFor.kind}:${allocationFor.id}`"
              :subject-kind="allocationFor.kind"
              :subject-id="allocationFor.id"
              :subject-label="allocationFor.label"
              :currency="allocationFor.currency"
              :subject-cap="allocationFor.cap"
              :subject-cap-label="allocationFor.capLabel"
              @changed="onAllocationsChanged"
            />
          </div>
        </section>

        <!--
          GAP-2, the approver's half. The per-subject panel above answers "how is this line
          divided"; this one answers "what is waiting on me", which is the question that had no
          screen at all and so left a recorded split with nobody informed.
        -->
        <section v-if="showSplits" class="ins-card fin-splits-card">
          <div class="ins-card-head">
            <h3><Layers :size="15" aria-hidden="true" /> Ward splits</h3>
            <button type="button" class="fin-btn small" @click="showSplits = false">Close</button>
          </div>
          <div class="ins-card-body">
            <SpatialSplitsQueue
              :status="route.query.splits === 'all' ? '' : 'draft'"
              @changed="onAllocationsChanged"
              @open-subject="openSubjectSplits"
            />
          </div>
        </section>

        <section v-if="unlocatedRows.length > 0" class="ins-card fin-unlocated">
          <div class="ins-card-head">
            <h3><AlertTriangle :size="15" aria-hidden="true" /> What the map cannot place ({{ currency }})</h3>
          </div>
          <div class="ins-card-body">
            <p class="ins-hint">
              These records are real but carry no geography. They are never mapped to an invented
              location — linking them needs ward codes (or approved splits) at the source.
            </p>
            <table class="ins-table">
              <thead><tr><th>Dataset</th><th>Rows</th><th>Amount</th></tr></thead>
              <tbody>
                <tr v-for="(u, i) in unlocatedRows" :key="i">
                  <td>{{ DATASET_LABELS[u.dataset] ?? u.dataset }}</td>
                  <td>{{ u.unlocated_rows }}</td>
                  <td>{{ u.unlocated_amount === null ? '—' : formatMoney(u.unlocated_amount, u.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="unlocatedProjects.length > 0" class="ins-card fin-unlocated">
          <div class="ins-card-head">
            <h3><AlertTriangle :size="15" aria-hidden="true" /> Projects with no point ({{ currency }})</h3>
          </div>
          <div class="ins-card-body">
            <p class="ins-hint">
              A project with no recorded location is listed here, not placed on a ward centroid.
              Set its location in Projects to put it on this map.
            </p>
            <ul class="fin-unlocated-projects">
              <li v-for="p in unlocatedProjects" :key="p.project_id">
                <strong>{{ p.reference }}</strong> — {{ p.name }}
                <span class="fin-chip">{{ STATUS_LABELS[p.status] ?? p.status }}</span>
                <span class="ins-hint"> · {{ p.ward_code ? `ward ${p.ward_code}` : 'no ward' }}</span>
              </li>
            </ul>
          </div>
        </section>

        <!--
          THE TABLE IS THE MAP'S ACCESSIBLE EQUIVALENT AND IS THEREFORE ALWAYS RENDERED.

          It used to appear only while the ward register was unlinked, so in the intended production
          state — Council's wards recorded — the choropleth was the sole way to select a ward, and
          selecting one is this section's primary interaction. A keyboard user could reach the
          measure, the currency and Refresh, and then nothing: the eleven-field ward panel, the
          per-ward budget lines and the drill-through to Budget were unreachable (WCAG 2.1.1), and
          the measure itself was conveyed by polygon fill alone (1.4.1). The ward code is now a real
          button carrying `aria-pressed`, so the selection is operable and its state is announced.
        -->
        <section v-if="wardTableRows.length > 0" class="ins-card fin-ward-table">
          <div class="ins-card-head">
            <h3>Wards — {{ yearLabel }}, {{ currency }}</h3>
            <span v-if="provisionalWardList" class="fin-chip warn">provisional list (D11)</span>
          </div>
          <div class="ins-card-body">
            <table class="ins-table">
              <caption class="sr-only">
                Every ward the map draws, with the figures the choropleth shades. Choose a ward to
                open its detail panel; this is the keyboard and screen-reader equivalent of
                clicking the map, and a ward with no figures is listed as such rather than omitted.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ward</th><th scope="col">Status</th>
                  <th scope="col">Exp. budget</th><th scope="col">Actual</th><th scope="col">Execution</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in wardTableRows" :key="w.code"
                    :class="{ selected: w.code === selectedWard }">
                  <td>
                    <button type="button" class="fin-ward-pick"
                            :aria-pressed="w.code === selectedWard"
                            @click="selectWard(w.code)">
                      {{ w.name ? `${w.code} — ${w.name}` : w.code }}
                    </button>
                  </td>
                  <td>
                    {{ !w.inRegister ? 'code not in the register'
                      : w.row ? 'linked' : 'linked · no figures' }}
                  </td>
                  <td>{{ w.row ? formatMeasure(w.row, 'expenditure_budget') : 'no data' }}</td>
                  <td>{{ w.row ? formatMeasure(w.row, 'expenditure_actual') : 'no data' }}</td>
                  <td>{{ w.row ? formatMeasure(w.row, 'execution') : 'no data' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="showProjects && projectFeatures.length > 0" class="ins-card fin-project-table">
          <div class="ins-card-head"><h3>Located projects — {{ yearLabel }}, {{ currency }}</h3></div>
          <div class="ins-card-body">
            <table class="ins-table">
              <caption class="sr-only">
                The projects drawn as circles, as a table. Choose a project to open its detail panel.
              </caption>
              <thead>
                <tr><th scope="col">Reference</th><th scope="col">Project</th><th scope="col">Status</th>
                  <th scope="col">{{ projectMeasureLabel }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in projectFeatures" :key="p.project_id"
                    :class="{ selected: p.project_id === selectedProjectId }">
                  <td>
                    <button type="button" class="fin-ward-pick"
                            :aria-pressed="p.project_id === selectedProjectId"
                            @click="selectProject(p.project_id)">
                      {{ p.reference }}
                    </button>
                  </td>
                  <td>{{ p.name }}</td>
                  <td>{{ STATUS_LABELS[p.status] ?? p.status }}</td>
                  <td>{{ formatMoney(p[projectMeasure], p.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The section's own root. It replaces `fin-map`, which belongs to the import mapping list. */
.fin-map-section { display: flex; flex-direction: column; gap: var(--ent-s4, 14px); }
.fin-map-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
  gap: 14px;
  align-items: start;
}
.fin-map-canvas-wrap { position: relative; }
/* A dead canvas is dimmed and covered; it is never left looking like an empty district. */
.fin-map-canvas.is-dead { opacity: 0.25; filter: grayscale(1); }
.fin-map-canvas-lost {
  position: absolute; inset: 10px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; text-align: center;
  padding: 18px; border-radius: 10px; background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(15, 42, 74, 0.16);
}
.fin-map-canvas-lost p { margin: 0; max-width: 46ch; font-size: 13px; }
.fin-map-canvas {
  height: 540px;
  border-radius: 10px;
  border: 1px solid rgba(15, 42, 74, 0.16);
  background: #eef2f6;
}
.fin-map-overlay {
  position: absolute;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(15, 42, 74, 0.16);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  max-width: 340px;
}
.fin-map-banner { top: 10px; left: 10px; display: flex; gap: 8px; align-items: flex-start; }
.fin-map-legend { bottom: 10px; left: 10px; }
.fin-map-legend-title { font-weight: 600; margin: 0 0 4px; }
.fin-map-legend ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.fin-map-legend li { display: flex; align-items: center; gap: 6px; }
.fin-map-legend-sub { display: flex; align-items: center; gap: 6px; margin: 6px 0 0; }
.fin-map-legend .fin-map-status-key { margin-top: 6px; }
.fin-map-provisional { display: flex; align-items: center; gap: 5px; margin: 6px 0 0; color: #7a5b00; }
/* The D11 label sits on the canvas, because the legend it used to live in is hidden whenever
   there are no figures to key — which is exactly when the polygons most need explaining. */
.fin-map-provisional-badge {
  top: 10px; right: 10px; display: flex; align-items: flex-start; gap: 5px;
  margin: 0; max-width: 260px; color: #7a5b00; font-size: 12px;
}
.fin-circle-key { width: 13px; height: 13px; border-radius: 50%; background: #8aa4bd; display: inline-block; }
.fin-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0,0,0,.2); }
.fin-map-measure { display: inline-flex; flex-direction: column; gap: 2px; min-width: 9.5rem; }
/* Eleven controls is a lot for one row; it wraps rather than squeezing a select to nothing. */
.fin-map-section .fin-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.fin-map-check { display: inline-flex; align-items: center; gap: 6px; align-self: end; font-size: 13px; }
.fin-map-year { margin-left: auto; align-self: end; }
.fin-map-provenance { margin: 0; max-width: 110ch; }
.fin-map-side { display: grid; gap: 14px; }
.fin-ward-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
.fin-ward-facts dt { color: rgba(15, 42, 74, 0.72); }
.fin-ward-facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.fin-ward-lines h4, .fin-ward-projects h4,
.fin-ward-projects-summary h4, .fin-ward-dimensions h4, .fin-other-currency h4 {
  margin: 12px 0 6px; font-size: 13px;
}
.fin-project-name { margin: 0 0 8px; font-weight: 600; }
.fin-ward-projects ul, .fin-unlocated-projects { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 13px; }
.fin-other-currency ul { list-style: none; padding: 0; margin: 0; }
.fin-ward-actions { display: flex; gap: 8px; margin-top: 12px; }
.fin-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: rgba(15, 42, 74, 0.08);
}
.fin-chip.warn { background: #fdf3d7; color: #7a5b00; }
.fin-chip.ok { background: #e2f2e6; color: #216b3c; }
.fin-ward-table tbody tr.selected, .fin-project-table tbody tr.selected { background: rgba(15, 42, 74, 0.07); }
/* The ward code is the control. A row-wide click target that is not focusable is a mouse-only
   interface; a button is operable by both and announces its own pressed state. */
.fin-ward-pick {
  border: 0; background: none; padding: 0; font: inherit; color: var(--ent-accent);
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.fin-ward-pick:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.fin-ward-pick[aria-pressed='true'] { font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (max-width: 1100px) {
  .fin-map-grid { grid-template-columns: 1fr; }
  .fin-map-canvas { height: 420px; }
}
</style>
