<script setup lang="ts">
/**
 * The public transparency map (audit M7-4): published ward aggregates on the council's own
 * boundaries.
 *
 * WHAT IT WILL NOT DO
 * It never decides what may be shown. `available_measures` comes from the server and is derived
 * from live publications; a measure that is not in that list is not offered, and a blank figure is
 * rendered as "not published" rather than zero (audit MAJOR-2). Installing a budget publication
 * does not make expenditure actuals public, so a citizen cannot read "0 % executed" as a fact.
 *
 * The ward list may be PROVISIONAL (decision D11, migration 201). When the register basis is
 * 'interim' the map labels it, because an unconfirmed boundary list must not be presented as a
 * Council resolution.
 *
 * The table below the map is not a fallback: it is the keyboard and screen-reader equivalent of
 * the choropleth and is always present.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, Info, MapPin } from 'lucide-vue-next'
import {
  addVunguBasemap, PLANNER_BASEMAP_DEFAULT, prefersReducedMotion, watchWebglContext,
} from '@/map/vunguBasemap'
import { baseMapStyle, FINANCE_NO_DATA } from '@/map/vunguBasemapStyle'
import { financePublicApi } from '../api/financeApi'
import type { PublicWardGeometryData, PublicWardMapData, PublicWardMapRow } from '../api/financeApi'
import type { Currency, FinanceProject } from '../models/types'
import {
  CHOROPLETH_COLORS, PUBLIC_MEASURES, availablePublicMeasures, computeBreaks, fillExpression,
  hasReleasedLocation, projectStatusColor, publicMeasureValue, publishedProjectPoints,
} from '../composables/useFinanceMap'
import type { PublicMeasureDef, PublicMeasureKey } from '../composables/useFinanceMap'
import { formatDateTime, formatMoney, formatPercentage } from '../composables/useMoney'
import { messageOf } from '../stores/finance'

const props = defineProps<{ financialYearId: string }>()

const loading = ref(true)
const error = ref<string | null>(null)
const data = ref<PublicWardMapData | null>(null)
const geometry = ref<PublicWardGeometryData | null>(null)
const projects = ref<FinanceProject[]>([])
const projectsTruncated = ref(false)
const showProjects = ref(true)
const selectedProject = ref<FinanceProject | null>(null)
const currency = ref<Currency>('USD')
const measure = ref<PublicMeasureKey>('expenditure_budget')
const selectedWard = ref<string | null>(null)
const breaks = ref<number[]>([])

const available = computed(() => availablePublicMeasures(data.value?.available_measures ?? []))
const groups = computed(() => {
  const out: Array<{ label: string; measures: PublicMeasureDef[] }> = []
  for (const label of ['Expenditure', 'Revenue', 'Projects'] as const) {
    const measures = available.value.filter((m) => m.group === label)
    if (measures.length > 0) out.push({ label, measures })
  }
  return out
})
const measureDef = computed(() => PUBLIC_MEASURES.find((m) => m.key === measure.value) ?? PUBLIC_MEASURES[0])
const wards = computed(() =>
  (data.value?.wards ?? []).filter((w) => w.currency === currency.value))
const currencies = computed(() =>
  data.value?.currencies?.length ? data.value.currencies : (['USD', 'ZWG'] as Currency[]))
const provisional = computed(() => (data.value?.ward_register_bases ?? []).includes('interim'))
const projectsPublished = computed(() => (data.value?.available_measures ?? []).includes('project_count'))
const selected = computed(() =>
  wards.value.find((w) => w.ward_code === selectedWard.value) ?? null)
const projectCountFor = (wardCode: string): number | null => {
  const row = data.value?.projects_by_ward.find((p) =>
    p.ward_code === wardCode && p.currency === currency.value)
  return row ? row.project_count : null
}

/** A project is on the map only when the council published a location; a ward code is not a point. */
// `hasReleasedLocation` (useFinanceMap) is the single rule; the local computed below applies it.
const currencyProjects = computed(() =>
  projects.value.filter((p) => p.currency === currency.value))
const locatedProjects = computed(() => currencyProjects.value.filter(hasReleasedLocation))
const unlocatedProjects = computed(() => currencyProjects.value.filter((p) => !hasReleasedLocation(p)))
const projectStatusLegend = computed(() => {
  const seen = new Set(locatedProjects.value.map((p) => p.status))
  return [...seen].map((status) => ({ status, color: projectStatusColor(status) }))
})
const projectStatusLabel = (status: string): string =>
  status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function selectProject(project: FinanceProject | null): void {
  selectedProject.value = project
  if (project?.ward_code) selectedWard.value = project.ward_code
}
const rowValue = (row: PublicWardMapRow | null): number | null =>
  publicMeasureValue(row, measure.value, row ? projectCountFor(row.ward_code) : null)
const hasValues = computed(() => wards.value.some((w) => rowValue(w) !== null))
const formatMoneyOrMissing = (value: string | null, ccy: Currency): string =>
  value === null || value === undefined ? 'not published' : formatMoney(value, ccy)
const formatValue = (row: PublicWardMapRow | null): string => {
  if (!row) return '—'
  const value = rowValue(row)
  if (value === null) return 'not published'
  if (measureDef.value.kind === 'percent') return formatPercentage(value)
  if (measureDef.value.kind === 'count') return String(value)
  return formatMoney(String(value), row.currency)
}

/**
 * Audit §6.5. Two states on this surface are stronger requirements than on the staff map, and both
 * are about what a resident would read into a blank:
 *
 *   1. NO LIVE PUBLICATION. The endpoint answers 404 when no publication covers the year. That is
 *      not an error for a red banner — it is the normal, correct state of a council that has not
 *      released its figures, and it must read as "nothing is published", never as "the map is
 *      broken" and never as "nothing was spent".
 *   2. NO WARD REGISTER. With `ward_register_linked` false the panel renders NO CANVAS AT ALL and
 *      one sentence. A resident shown an empty grey district reads it as "nothing was spent here",
 *      which is the exact misreading the missing-is-not-zero principle exists to prevent. The staff
 *      map may draw the grey because its reader is told why; the public one may not.
 */
const nothingPublished = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  nothingPublished.value = false
  try {
    const [map, boundaries, publishedProjects] = await Promise.all([
      financePublicApi.mapWards({ financial_year_id: props.financialYearId }),
      financePublicApi.mapWardGeometry({ financial_year_id: props.financialYearId }),
      // Published project locations (M7-5). The route itself applies the release contract: a
      // proposed or draft project is not public, and withdrawing the projects register empties it
      // with no code change here.
      financePublicApi.projects({ financial_year_id: props.financialYearId, limit: 200 }),
    ])
    data.value = map
    geometry.value = boundaries
    projects.value = publishedProjects.projects
    projectsTruncated.value = publishedProjects.projects.length >= 200
    if (map.currencies.length > 0 && !map.currencies.includes(currency.value)) {
      currency.value = map.currencies[0]
    }
    if (!map.available_measures.includes(measure.value) && available.value.length > 0) {
      measure.value = available.value[0].key
    }
    paint()
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) {
      // The council has published nothing for this year. A complete answer, not a failure.
      data.value = null
      geometry.value = null
      projects.value = []
      nothingPublished.value = true
    } else {
      error.value = messageOf(err, 'The published map could not be loaded.')
    }
  } finally {
    loading.value = false
  }
}

// ── map ──────────────────────────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLElement | null>(null)
let map: maplibregl.Map | null = null
let resizeObserver: ResizeObserver | null = null
let unwatchContext: (() => void) | null = null
const ready = ref(false)
/**
 * The canvas lost its WebGL context. A resident shown a blank district reads it as "nothing was
 * spent here", so the panel says what happened and the published tables below stand in — they
 * carry the same figures and are the surface's keyboard equivalent anyway.
 */
const contextLost = ref(false)
const SOURCE = 'pub-fin-wards'
const FILL = 'pub-fin-wards-fill'
const OUTLINE = 'pub-fin-wards-outline'
const PROJECT_SOURCE = 'pub-fin-projects'
const PROJECT_LAYER = 'pub-fin-projects-circle'
const EMPTY_FC = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection

function featureCollection(): GeoJSON.FeatureCollection {
  if (!geometry.value?.ward_register_linked) return EMPTY_FC
  return {
    type: 'FeatureCollection',
    features: geometry.value.features
      .filter((f) => f.geometry)
      .map((f) => ({
        type: 'Feature',
        properties: {
          ward_code: f.properties.ward_code,
          name: f.properties.name,
          value: rowValue(wards.value.find((w) => w.ward_code === f.properties.ward_code) ?? null),
        },
        geometry: f.geometry as unknown as GeoJSON.Geometry,
      })),
  }
}

function paint(): void {
  if (!map || !ready.value) return
  const fc = featureCollection()
  const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) source.setData(fc)
  const values = fc.features
    .map((f) => (f.properties as { value: number | null }).value)
    .filter((v): v is number => v !== null)
  breaks.value = computeBreaks(values)
  if (map.getLayer(FILL)) {
    map.setPaintProperty(FILL, 'fill-color', fillExpression(breaks.value) as never)
  }
  paintProjects()
  fitToData(fc)
}

/** Published project locations, drawn from the coordinates the server released (M7-5). */
function projectFeatureCollection(): GeoJSON.FeatureCollection {
  if (!showProjects.value) return EMPTY_FC
  return {
    type: 'FeatureCollection',
    features: publishedProjectPoints(projects.value, currency.value),
  } as GeoJSON.FeatureCollection
}

function paintProjects(): void {
  if (!map) return
  const source = map.getSource(PROJECT_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (source) source.setData(projectFeatureCollection())
}

function fitToData(fc: GeoJSON.FeatureCollection): void {
  const bounds = new maplibregl.LngLatBounds()
  for (const f of fc.features) {
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const coords = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const ring of coords) for (const point of ring[0]) bounds.extend(point as [number, number])
  }
  // A year with no linked boundaries can still publish project points; fit to those instead of
  // leaving the map on the city-wide default.
  if (fc.features.length === 0 && showProjects.value) {
    for (const p of locatedProjects.value) {
      bounds.extend([p.longitude as number, p.latitude as number])
    }
  }
  if (!bounds.isEmpty()) {
    // The same motion contract as every other map in the product (DESIGN.md, Click and motion).
    map?.fitBounds(bounds, { padding: 44, maxZoom: 11, duration: prefersReducedMotion() ? 0 : 700 })
  }
}

function initMap(): void {
  if (!mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    // Without an explicit style the map never fires `load`, so nothing below ever runs:
    // no basemap, no ward polygons, a transparent canvas (see baseMapStyle).
    style: baseMapStyle(),
    center: [29.95, -19.15],
    zoom: 8.4,
    attributionControl: { compact: true },
  })
  map.on('load', async () => {
    await addVunguBasemap(map!, { defaultVisible: PLANNER_BASEMAP_DEFAULT })
    map!.addSource(SOURCE, { type: 'geojson', data: EMPTY_FC })
    map!.addLayer({
      id: FILL, type: 'fill', source: SOURCE,
      paint: { 'fill-color': FINANCE_NO_DATA, 'fill-opacity': 0.78 },
    })
    map!.addLayer({
      id: OUTLINE, type: 'line', source: SOURCE,
      paint: { 'line-color': '#1f2937', 'line-width': 1.1, 'line-opacity': 0.75 },
    })
    // Published projects, above the wards: a point is a released location, not a ward centroid.
    map!.addSource(PROJECT_SOURCE, { type: 'geojson', data: EMPTY_FC })
    map!.addLayer({
      id: PROJECT_LAYER, type: 'circle', source: PROJECT_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 9],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.92,
      },
    })
    ready.value = true
    paint()
  })
  map.on('click', FILL, (e) => {
    const code = (e.features?.[0]?.properties as { ward_code?: string } | undefined)?.ward_code
    if (code) selectedWard.value = code
  })
  map.on('click', PROJECT_LAYER, (e) => {
    const id = (e.features?.[0]?.properties as { project_id?: string } | undefined)?.project_id
    selectProject(projects.value.find((p) => p.project_id === id) ?? null)
  })
  map.on('mouseenter', FILL, () => { map!.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', FILL, () => { map!.getCanvas().style.cursor = '' })
  map.on('mouseenter', PROJECT_LAYER, () => { map!.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', PROJECT_LAYER, () => { map!.getCanvas().style.cursor = '' })
  unwatchContext = watchWebglContext(map, {
    onLost: () => { contextLost.value = true; ready.value = false },
    onRestored: () => { void rebuildMap() },
  })
  resizeObserver = new ResizeObserver(() => map?.resize())
  resizeObserver.observe(mapEl.value)
}

/** Rebuild after a lost context: MapLibre does not restore its own sources and layers. */
async function rebuildMap(): Promise<void> {
  unwatchContext?.()
  unwatchContext = null
  resizeObserver?.disconnect()
  resizeObserver = null
  map?.remove()
  map = null
  ready.value = false
  contextLost.value = false
  await nextTick()
  initMap()
}

// The canvas exists only while the ward register is linked (audit §6.5), so the map is created
// after the payload says so rather than on mount. A council that links its wards later gets the
// canvas without a reload.
onMounted(() => { void load() })
watch(() => data.value?.ward_register_linked === true, async (linked) => {
  if (!linked) return
  await nextTick()
  initMap()
  map?.resize()
}, { immediate: true })
onBeforeUnmount(() => {
  unwatchContext?.()
  unwatchContext = null
  resizeObserver?.disconnect()
  map?.remove()
  map = null
})
watch(() => props.financialYearId, () => void load())
watch([measure, currency], () => {
  if (selectedProject.value && selectedProject.value.currency !== currency.value) {
    selectedProject.value = null
  }
  paint()
})
watch(showProjects, () => paintProjects())
watch(ready, (v) => { if (v) paint() })

const legend = computed(() => {
  if (breaks.value.length === 0) {
    return [{ color: CHOROPLETH_COLORS[0], label: 'all published figures' }]
  }
  const colors = CHOROPLETH_COLORS.slice(0, breaks.value.length + 1)
  return colors.map((color, i) => ({
    color,
    label: i === 0
      ? `up to ${compact(breaks.value[0])}`
      : i < breaks.value.length
        ? `${compact(breaks.value[i - 1])} – ${compact(breaks.value[i])}`
        : `over ${compact(breaks.value[i - 1])}`,
  }))
})
function compact(value: number | undefined): string {
  if (value === undefined) return '—'
  if (measureDef.value.kind === 'percent') return `${value.toFixed(0)}%`
  if (measureDef.value.kind === 'count') return String(value)
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toFixed(0)
}
const provenance = computed(() => {
  const key = measure.value === 'project_count' ? 'projects'
    : measure.value.startsWith('revenue') ? 'revenue' : 'budget'
  return data.value?.provenance[key] ?? null
})
</script>

<template>
  <div class="pub-map">
    <div v-if="error" class="ins-banner t-warning" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" /><span>{{ error }}</span>
    </div>

    <p v-if="data" class="ins-hint pub-map-caption">
      Published ward figures for {{ data.financial_year.label }}. A blank measure means the council
      has not published that dataset for this year, or has no figure for that ward — it does not
      mean zero. USD and ZWG are never added together.
    </p>

    <div v-if="data && available.length" class="pub-map-bar">
      <label>
        <span class="ins-label">Measure</span>
        <select v-model="measure" class="ins-input">
          <optgroup v-for="group in groups" :key="group.label" :label="group.label">
            <option v-for="m in group.measures" :key="m.key" :value="m.key">{{ m.label }}</option>
          </optgroup>
        </select>
      </label>
      <label>
        <span class="ins-label">Currency</span>
        <select v-model="currency" class="ins-input">
          <option v-for="c in currencies" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label v-if="projects.length" class="pub-map-toggle">
        <input v-model="showProjects" type="checkbox" />
        <span>Published projects</span>
      </label>
      <span v-if="provenance" class="ins-hint">
        Published {{ formatDateTime(provenance.published_at) }} · v{{ provenance.version }}
        <template v-if="provenance.data_as_at"> · figures as at {{ formatDateTime(provenance.data_as_at) }}</template>
      </span>
    </div>

    <!--
      No canvas while the register is unlinked (audit §6.5). Deliberately stricter than the staff
      map: a grey district shown to a resident reads as "nothing was spent here", and that
      misreading is worse than showing no picture. The published figures are not withheld — they are
      in the tables below, which is where they are readable anyway.
    -->
    <p v-if="data && !data.ward_register_linked" class="pub-map-nocanvas" role="status">
      <Info :size="16" aria-hidden="true" />
      <span>The Council's published finances are not yet mapped by ward. Every published figure is
        listed below.</span>
    </p>

    <div v-if="data" class="pub-map-grid" :class="{ 'is-listonly': !data.ward_register_linked }">
      <div v-if="data.ward_register_linked" class="pub-map-canvas-wrap">
        <div ref="mapEl" class="pub-map-canvas"
             :class="{ 'is-dead': contextLost }"
             :aria-hidden="contextLost ? 'true' : undefined"
             aria-label="Published ward figures and published project locations shown on the council's ward boundaries"></div>

        <div v-if="contextLost" class="pub-map-canvas-lost" role="alert">
          <Info :size="18" aria-hidden="true" />
          <p>
            The map lost its graphics context and cannot draw. This is a display failure, not a
            finding: a ward with no shading here is not a ward with no money. Every published
            figure is in the tables below.
          </p>
          <button type="button" class="ins-btn" @click="rebuildMap">Reload the map</button>
        </div>

        <div v-if="!contextLost && wards.length === 0" class="pub-map-overlay" role="status">
          <Info :size="15" aria-hidden="true" />
          <span>No published ward figures for this year in {{ currency }}.
            A ward with no data is not a ward with zero.</span>
        </div>

        <div v-else-if="!contextLost && !hasValues" class="pub-map-overlay" role="status">
          <Info :size="15" aria-hidden="true" />
          <span>No {{ measureDef.label.toLowerCase() }} figure is published for any ward in
            {{ currency }}. A ward with no figure is not a ward with zero.</span>
        </div>

        <div v-else-if="!contextLost" class="pub-map-overlay pub-map-legend">
          <p class="pub-map-legend-title">{{ measureDef.label }} · {{ currency }}</p>
          <ul>
            <li><span class="pub-swatch" :style="{ background: FINANCE_NO_DATA }"></span>no published figure</li>
            <li v-for="(entry, i) in legend" :key="i">
              <span class="pub-swatch" :style="{ background: entry.color }"></span>{{ entry.label }}
            </li>
          </ul>
          <p v-if="provisional" class="pub-map-provisional">
            <Info :size="12" aria-hidden="true" /> Ward list is provisional (D11).
          </p>
        </div>

        <div v-if="!contextLost && showProjects && projectStatusLegend.length"
             class="pub-map-overlay pub-map-legend pub-map-project-legend">
          <p class="pub-map-legend-title">Published projects · {{ currency }}</p>
          <ul>
            <li v-for="entry in projectStatusLegend" :key="entry.status">
              <span class="pub-swatch" :style="{ background: entry.color }"></span>
              {{ projectStatusLabel(entry.status) }}
            </li>
          </ul>
          <p class="pub-map-provisional">
            A point is a location the council released, not every project in the register.
          </p>
        </div>
      </div>

      <div class="pub-map-side">
        <section v-if="selected" class="ins-card">
          <div class="ins-card-head">
            <h3><MapPin :size="15" aria-hidden="true" /> Ward {{ selected.ward_code }}</h3>
            <span v-if="selected.ward_status === 'unlinked'" class="fin-chip warn">code not linked</span>
          </div>
          <div class="ins-card-body">
            <dl class="pub-map-facts">
              <dt>Expenditure budget</dt><dd>{{ formatMoneyOrMissing(selected.expenditure_budget, selected.currency) }}</dd>
              <dt>Actual expenditure</dt><dd>{{ formatMoneyOrMissing(selected.expenditure_actual, selected.currency) }}</dd>
              <dt>Execution</dt>
              <dd>{{ selected.expenditure_execution_percentage === null
                ? 'not published' : formatPercentage(selected.expenditure_execution_percentage) }}</dd>
              <dt>Revenue budget</dt><dd>{{ formatMoneyOrMissing(selected.revenue_budget, selected.currency) }}</dd>
              <dt>Revenue collected</dt><dd>{{ formatMoneyOrMissing(selected.revenue_actual, selected.currency) }}</dd>
              <dt>Revenue variance</dt><dd>{{ formatMoneyOrMissing(selected.revenue_variance, selected.currency) }}</dd>
              <dt>Collection rate</dt>
              <dd>{{ selected.revenue_collection_percentage === null
                ? 'not published' : formatPercentage(selected.revenue_collection_percentage) }}</dd>
              <dt>Projects</dt><dd>{{ projectCountFor(selected.ward_code) ?? 'not published' }}</dd>
            </dl>
          </div>
        </section>

        <section v-if="selectedProject" class="ins-card">
          <div class="ins-card-head">
            <h3><MapPin :size="15" aria-hidden="true" /> {{ selectedProject.reference }} ·
              {{ selectedProject.name }}</h3>
            <span class="fin-chip"
                  :style="{ background: projectStatusColor(selectedProject.status), color: '#fff' }">
              {{ projectStatusLabel(selectedProject.status) }}
            </span>
          </div>
          <div class="ins-card-body">
            <dl class="pub-map-facts">
              <dt>Status</dt><dd>{{ projectStatusLabel(selectedProject.status) }}</dd>
              <dt>Ward</dt><dd>{{ selectedProject.ward_code ?? 'not recorded' }}</dd>
              <dt>Location</dt>
              <dd>{{ selectedProject.location_text ?? (hasReleasedLocation(selectedProject)
                ? 'released coordinates' : 'not published') }}</dd>
              <dt>Approved budget</dt>
              <dd>{{ formatMoneyOrMissing(selectedProject.approved_budget, selectedProject.currency) }}</dd>
              <dt>Allocated</dt>
              <dd>{{ formatMoneyOrMissing(selectedProject.allocated_total, selectedProject.currency) }}</dd>
              <dt>Actual spend</dt>
              <dd>{{ formatMoneyOrMissing(selectedProject.actual_spend, selectedProject.currency) }}</dd>
              <dt>Execution</dt>
              <dd>{{ selectedProject.execution_percentage === null
                ? 'not published' : formatPercentage(selectedProject.execution_percentage) }}</dd>
            </dl>
            <p v-if="!hasReleasedLocation(selectedProject)" class="ins-hint">
              The council has not released a location for this project, so it is not drawn on the map.
            </p>
            <button type="button" class="ins-btn ins-btn-ghost" @click="selectProject(null)">
              Close project
            </button>
          </div>
        </section>

        <section class="ins-card">
          <div class="ins-card-head"><h3>Ward figures — {{ currency }}</h3></div>
          <div class="ins-card-body">
            <table class="fin-table">
              <caption class="sr-only">
                The figures the map shades, as a table. Choose a ward to open its detail panel; this
                is the keyboard and screen-reader equivalent of clicking the map.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ward</th>
                  <th scope="col">{{ measureDef.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="w in wards" :key="w.ward_code"
                    :class="{ selected: w.ward_code === selectedWard }">
                  <td>
                    <button type="button" class="pub-ward-pick"
                            :aria-pressed="w.ward_code === selectedWard"
                            @click="selectedWard = w.ward_code">
                      {{ w.ward_code }}
                    </button>
                  </td>
                  <td>{{ formatValue(w) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="wards.length === 0" class="ins-hint">Nothing is published for this measure yet.</p>
          </div>
        </section>

        <section class="ins-card">
          <div class="ins-card-head"><h3>Published projects — {{ currency }}</h3></div>
          <div class="ins-card-body">
            <p v-if="!projectsPublished" class="ins-hint">
              The council has not published its project register for this year, so project locations
              are not shown. Withdrawing the publication removes the points without a code change.
            </p>
            <template v-else>
            <table class="fin-table">
              <caption class="sr-only">
                The published projects the map locates, as a table. Choose a project to open its
                detail panel; this is the keyboard and screen-reader equivalent of clicking a point.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col">Ward</th>
                  <th scope="col">Allocated</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in currencyProjects" :key="p.project_id"
                    :title="hasReleasedLocation(p) ? undefined : 'No released location — not drawn on the map'">
                  <td>
                    <button type="button" class="pub-ward-pick"
                            :aria-pressed="selectedProject?.project_id === p.project_id"
                            @click="selectProject(p)">
                      {{ p.reference }} — {{ p.name }}
                    </button>
                    <span v-if="!hasReleasedLocation(p)" class="pub-project-unlocated">· no released location</span>
                  </td>
                  <td>{{ projectStatusLabel(p.status) }}</td>
                  <td>{{ p.ward_code ?? '—' }}</td>
                  <td>{{ formatMoneyOrMissing(p.allocated_total, p.currency) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="currencyProjects.length === 0" class="ins-hint">
              No published project has a figure in {{ currency }} for this year. Projects in another
              currency are not converted or added.
            </p>
            <p v-if="unlocatedProjects.length" class="ins-hint">
              {{ unlocatedProjects.length }} published project(s) have no released location. They are
              listed here but not drawn on the map.
            </p>
            <p v-if="projectsTruncated" class="ins-hint">
              Showing the first 200 published projects. Narrow the register to see the rest.
            </p>
            </template>
          </div>
        </section>
      </div>
    </div>

    <!--
      Nothing is published. This is the state the database is in today, and the one a reviewer sees
      first, so it is built as a real answer rather than a shrug: what is missing, why the map is
      empty, and what would make it appear.
    -->
    <section v-else-if="nothingPublished" class="pub-map-unpublished">
      <h3>Nothing is currently published for this reporting period</h3>
      <p>
        The Council has not released a financial dataset covering this year, so there is nothing
        this map may show. That is a statement about publication, not about the Council's finances:
        budgets, expenditure and projects exist in the Council's own records and become public only
        when a dataset is published.
      </p>
      <p class="ins-hint">
        A ward-level map appears here once the Council publishes its budget, revenue, expenditure or
        project register for the year. Withdrawing a publication removes the figures again.
      </p>
    </section>

    <p v-else-if="!loading && !error" class="ins-hint">
      The council has not published a ward-level map for this reporting period.
    </p>
  </div>
</template>

<style scoped>
.pub-map-caption { margin: 0 0 10px; }
.pub-map-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 10px; }
.pub-map-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr); gap: 14px; align-items: start; }
/* With no canvas the side column is the whole panel, so it takes the full width. */
.pub-map-grid.is-listonly { grid-template-columns: 1fr; }
.pub-map-nocanvas {
  display: flex; gap: 8px; align-items: flex-start; margin: 0 0 12px;
  padding: 12px 14px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 10px;
  background: var(--ent-surface-2, #f7f9fb); max-width: 70ch;
}
.pub-map-unpublished {
  padding: 18px; border: 1px solid var(--ent-line, #d7dde5); border-radius: 10px;
  background: var(--ent-surface-2, #f7f9fb); max-width: 72ch;
}
.pub-map-unpublished h3 { margin: 0 0 8px; font-size: 15px; }
.pub-map-unpublished p { margin: 0 0 8px; }
.pub-map-unpublished p:last-child { margin-bottom: 0; }
.pub-map-canvas-wrap { position: relative; }
.pub-map-canvas { position: relative; height: 500px; border-radius: 10px; border: 1px solid var(--ent-line, #d7dde5); background: #eef2f6; isolation: isolate; }
/* A dead canvas is dimmed and covered; it is never left looking like an empty district. */
.pub-map-canvas.is-dead { opacity: 0.25; filter: grayscale(1); }
.pub-map-canvas-lost {
  position: absolute; inset: 10px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 18px;
  border-radius: 10px; background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--ent-line, #d7dde5);
}
.pub-map-canvas-lost p { margin: 0; max-width: 46ch; font-size: 13px; }
.pub-map-overlay {
  position: absolute; background: rgba(255,255,255,.95);
  border: 1px solid var(--ent-line, #d7dde5); border-radius: 8px;
  padding: 8px 10px; font-size: 12.5px; max-width: 330px;
  display: flex; gap: 8px; align-items: flex-start;
}
.pub-map-legend { bottom: 10px; left: 10px; display: block; }
.pub-map-project-legend { left: auto; right: 10px; }
.pub-map-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.pub-project-unlocated { color: var(--ent-text-muted, rgba(15,42,74,.72)); font-size: 12px; }
.pub-map-legend-title { font-weight: 600; margin: 0 0 4px; }
.pub-map-legend ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.pub-map-legend li { display: flex; align-items: center; gap: 6px; }
.pub-map-provisional { display: flex; align-items: center; gap: 5px; margin: 6px 0 0; color: #7a5b00; }
.pub-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0,0,0,.2); }
.pub-map-side { display: grid; gap: 14px; }
.pub-map-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13px; }
.pub-map-facts dt { color: var(--ent-text-muted, rgba(15,42,74,.72)); }
.pub-map-facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.pub-ward-pick {
  border: 0; background: none; padding: 0; font: inherit; color: var(--ent-accent);
  text-decoration: underline; text-underline-offset: 2px; cursor: pointer;
}
.pub-ward-pick:focus-visible { outline: var(--ent-focus-ring); outline-offset: 2px; }
.pub-ward-pick[aria-pressed='true'] { font-weight: 600; color: var(--ent-text); }
tr.selected { background: rgba(15, 42, 74, 0.07); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@media (max-width: 1000px) {
  .pub-map-grid { grid-template-columns: 1fr; }
  .pub-map-canvas { height: 400px; }
}
</style>
