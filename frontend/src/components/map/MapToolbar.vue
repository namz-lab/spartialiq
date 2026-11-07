<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────
// MapToolbar — the interactive GIS toolset that sits on the shared MapLibre
// map. It turns the read-only basemap into a working GIS surface:
//
//   • Search      — fly to a coordinate ("-19.45, 29.81") or a named place
//                   (backend /spatial/search), fully offline for coordinates.
//   • Measure     — click vertices to measure distance; ≥3 points also reports
//                   area (turf). Download the drawn shape as GeoJSON.
//   • Radius      — drop a statutory notification radius (default 100 m for a
//                   s.26(3) advert) and count parcels/structures inside it.
//   • Imagery     — switch between cartographic map, satellite, and hybrid.
//   • Export PDF  — print the current view as an A4 map sheet.
//   • Coordinates — live lng/lat readout under the cursor.
//
// The component no-ops until `map` is supplied (after the host emits
// `map-ready`). All scratch geometry lives in one transient GeoJSON source
// (`gis-tools`) so nothing touches the PostGIS layers.
// ─────────────────────────────────────────────────────────────────────────
import { ref, onBeforeUnmount, watch } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { Search, Ruler, Circle, Image as ImageIcon, Printer, X, Download } from 'lucide-vue-next'
import { setBasemapMode, type BasemapMode } from '@/map/tools/basemaps'
import { exportMapToPdf } from '@/map/tools/mapExport'
import { searchMap } from '@/services/vectorTiles'
import { parcelsWithin, withinCsv, clampRadius, type WithinResult } from '@/map/tools/withinQuery'
import { flyTo as flyToRM } from '@/map/tools/camera'
import api from '@/services/api'

const props = withDefaults(defineProps<{
  /** MapLibre map instance. The toolbar is inert until this is set. */
  map: any | null
  /** Satellite imagery is an external (Esri) tile source. Hosts that must work
   *  entirely from council infrastructure pass false and lose the button. */
  imagery?: boolean
}>(), { imagery: true })

type Tool = 'none' | 'search' | 'measure' | 'radius' | 'imagery'
const activeTool = ref<Tool>('none')
const basemap = ref<BasemapMode>('map')

// Hosts with their own click behaviour (identify, pick) pause it while a tool
// that consumes map clicks is active.
const emit = defineEmits<{ 'tool-change': [tool: Tool] }>()
watch(activeTool, (t) => emit('tool-change', t))

// ── live coordinate readout ───────────────────────────────────────────────
const cursor = ref<{ lng: number; lat: number } | null>(null)

// ── search state ──────────────────────────────────────────────────────────
const query = ref('')
const searching = ref(false)
const searchError = ref('')
const results = ref<any[]>([])

// ── measure state ─────────────────────────────────────────────────────────
const measureVerts = ref<[number, number][]>([])
const distanceM = ref(0)
const areaM2 = ref(0)

// ── radius state ──────────────────────────────────────────────────────────
const radiusMeters = ref(100)
const radiusCenter = ref<[number, number] | null>(null)
const withinCount = ref<number | null>(null)
const withinNote = ref('')
const withinResult = ref<WithinResult | null>(null)
const withinLoading = ref(false)

const TOOL_SOURCE = 'gis-tools'

// ── map event wiring ──────────────────────────────────────────────────────
let bound: any = null
function bind(m: any) {
  if (!m || bound === m) return
  unbind()
  bound = m
  m.on('mousemove', onMove)
  m.on('click', onClick)
}
function unbind() {
  if (!bound) return
  try {
    bound.off('mousemove', onMove)
    bound.off('click', onClick)
  } catch {
    /* map already torn down */
  }
  bound = null
}
watch(() => props.map, (m) => { if (m) bind(m) }, { immediate: true })
onBeforeUnmount(() => {
  if (props.map) {
    try {
      if (props.map.getLayer('gis-tools-fill')) props.map.removeLayer('gis-tools-fill')
      if (props.map.getLayer('gis-tools-line')) props.map.removeLayer('gis-tools-line')
      if (props.map.getLayer('gis-tools-pts')) props.map.removeLayer('gis-tools-pts')
      if (props.map.getSource(TOOL_SOURCE)) props.map.removeSource(TOOL_SOURCE)
      props.map.getCanvas().style.cursor = ''
    } catch {
      /* ignore */
    }
  }
  unbind()
})

function onMove(e: any) {
  cursor.value = { lng: e.lngLat.lng, lat: e.lngLat.lat }
}
function onClick(e: any) {
  const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
  if (activeTool.value === 'measure') {
    measureVerts.value = [...measureVerts.value, pt]
    redrawMeasure()
  } else if (activeTool.value === 'radius') {
    radiusCenter.value = pt
    runRadius(pt)
  }
}

// ── transient draw layers ─────────────────────────────────────────────────
function ensureToolLayers(m: any) {
  if (!m || m.getSource(TOOL_SOURCE)) return
  try {
    m.addSource(TOOL_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    m.addLayer({
      id: 'gis-tools-fill',
      type: 'fill',
      source: TOOL_SOURCE,
      filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 },
    })
    m.addLayer({
      id: 'gis-tools-line',
      type: 'line',
      source: TOOL_SOURCE,
      filter: ['in', '$type', 'LineString', 'Polygon'],
      paint: { 'line-color': '#1a73e8', 'line-width': 2.5, 'line-dasharray': [2, 1] },
    })
    m.addLayer({
      id: 'gis-tools-pts',
      type: 'circle',
      source: TOOL_SOURCE,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#1a73e8',
        'circle-stroke-width': 2,
      },
    })
  } catch {
    /* style not ready — tools will retry on next activation */
  }
}
function setToolData(features: any[]) {
  const src = props.map?.getSource(TOOL_SOURCE)
  if (src) src.setData({ type: 'FeatureCollection', features })
}

// ── tool activation ───────────────────────────────────────────────────────
function selectTool(tool: Tool) {
  if (activeTool.value === tool) {
    closeTool()
    return
  }
  activeTool.value = tool
  if (tool === 'measure' || tool === 'radius') {
    ensureToolLayers(props.map)
    clearDrawing()
    if (props.map) {
      props.map.getCanvas().style.cursor = 'crosshair'
      if (tool === 'measure') props.map.doubleClickZoom?.disable?.()
    }
  }
}
function closeTool() {
  activeTool.value = 'none'
  if (props.map) {
    props.map.getCanvas().style.cursor = ''
    props.map.doubleClickZoom?.enable?.()
  }
}
function clearDrawing() {
  measureVerts.value = []
  distanceM.value = 0
  areaM2.value = 0
  radiusCenter.value = null
  withinCount.value = null
  withinNote.value = ''
  withinResult.value = null
  withinLoading.value = false
  setToolData([])
}

// ── measure ───────────────────────────────────────────────────────────────
function redrawMeasure() {
  const verts = measureVerts.value
  const feats: any[] = verts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
  if (verts.length >= 3) {
    const ring = [...verts, verts[0]]
    const poly = turf.polygon([ring] as any)
    feats.push({ type: 'Feature', properties: {}, geometry: poly.geometry })
    areaM2.value = turf.area(poly)
  } else {
    areaM2.value = 0
    if (verts.length >= 2) {
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: verts } })
    }
  }
  distanceM.value = verts.length >= 2 ? turf.length(turf.lineString(verts as any), { units: 'kilometers' }) * 1000 : 0
  setToolData(feats)
}

// ── radius / notification buffer ──────────────────────────────────────────
// The answer comes from the cadastre (GET /gis/within, ST_DWithin over every
// parcel). Counting rendered features only sees the tiles the viewport has
// loaded, so it is kept strictly as the offline fallback and says so.
async function runRadius(center: [number, number]) {
  const r = clampRadius(radiusMeters.value)
  const circle = turf.circle(center as any, r / 1000, { units: 'kilometers', steps: 64 })
  setToolData([
    { type: 'Feature', properties: {}, geometry: circle.geometry },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } },
  ])
  withinLoading.value = true
  withinResult.value = null
  try {
    const res = await parcelsWithin(center[0], center[1], r)
    // A later click may have landed while this one was in flight.
    if (radiusCenter.value !== center) return
    withinResult.value = res
    withinCount.value = res.count
    withinNote.value = res.count >= 500
      ? 'parcels in the cadastre within the radius (first 500)'
      : 'parcels in the cadastre within the radius'
    return
  } catch {
    if (radiusCenter.value !== center) return
    /* fall through to the viewport estimate */
  } finally {
    if (radiusCenter.value === center) withinLoading.value = false
  }

  const m = props.map
  const layerIds = ['vungu-vungu_parcels', 'vungu-vungu_farm_cadastre', 'vungu-buildings'].filter(
    (id) => m?.getLayer?.(id),
  )
  let count = 0
  if (layerIds.length) {
    let rendered: any[] = []
    try {
      rendered = m.queryRenderedFeatures({ layers: layerIds })
    } catch {
      rendered = []
    }
    const seen = new Set<string>()
    for (const f of rendered) {
      try {
        const cen = turf.centroid(f as any)
        if (turf.booleanPointInPolygon(cen, circle as any)) {
          const key = String(f.id ?? cen.geometry.coordinates.join(','))
          if (!seen.has(key)) {
            seen.add(key)
            count++
          }
        }
      } catch {
        /* skip unparseable feature */
      }
    }
    withinNote.value = 'estimate — parcels/structures on screen only (cadastre unreachable)'
  } else {
    withinNote.value = 'cadastre unreachable — zoom in to load parcels, then click again'
  }
  withinCount.value = count
}

// ── search ────────────────────────────────────────────────────────────────
function parseCoord(s: string): { lng: number; lat: number } | null {
  const m = s.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/)
  if (!m) return null
  const a = parseFloat(m[1])
  const b = parseFloat(m[2])
  let lat: number
  let lng: number
  // Default to "lat, lng". If the first value reads like a Zimbabwe longitude
  // (≈ 20–40) and the second like a latitude (negative), treat it as "lng,lat".
  if (a >= 10 && a <= 40 && b < 0) {
    lng = a
    lat = b
  } else {
    lat = a
    lng = b
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lng, lat }
}
function flyTo(lngLat: { lng: number; lat: number }, zoom?: number) {
  if (!props.map) return
  const target = Math.max(props.map.getZoom?.() ?? 12, zoom ?? 15)
  flyToRM(props.map, { center: [lngLat.lng, lngLat.lat], zoom: target })
  ensureToolLayers(props.map)
  setToolData([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] } }])
}
function hitLngLat(h: any): { lng: number; lat: number } | null {
  const lng = h.lng ?? h.longitude ?? h.x ?? (Array.isArray(h.center) ? h.center[0] : undefined)
  const lat = h.lat ?? h.latitude ?? h.y ?? (Array.isArray(h.center) ? h.center[1] : undefined)
  if (lng == null || lat == null) return null
  return { lng: Number(lng), lat: Number(lat) }
}
function hitLabel(h: any): string {
  return h.name || h.label || h.title || h.place || h.display_name || 'Result'
}
async function runSearch() {
  const q = query.value.trim()
  searchError.value = ''
  results.value = []
  if (!q) return
  const coord = parseCoord(q)
  if (coord) {
    flyTo(coord)
    return
  }
  searching.value = true
  try {
    // The backend geocoder (/api/map-search) searches wards, districts,
    // parcels, the farm cadastre, named places, POIs, and master-plan zones,
    // returning { label, subtitle, center: [lon, lat] } rows.
    const hits = await searchMap(q)
    results.value = Array.isArray(hits) ? hits : []
    if (!results.value.length) searchError.value = 'No matches. Try coordinates, e.g. -19.45, 29.81'
  } catch {
    searchError.value = 'Search unavailable. Try coordinates, e.g. -19.45, 29.81'
  } finally {
    searching.value = false
  }
}
function chooseResult(h: any) {
  const ll = hitLngLat(h)
  if (ll) {
    flyTo(ll)
    results.value = []
  }
}

// ── imagery / basemap ─────────────────────────────────────────────────────
function chooseBasemap(mode: BasemapMode) {
  basemap.value = mode
  setBasemapMode(props.map, mode)
}

// ── export ────────────────────────────────────────────────────────────────
const exporting = ref(false)
async function doExport() {
  if (!props.map) return
  exporting.value = true
  try {
    await exportMapToPdf(props.map, {
      subtitle: `${basemap.value === 'map' ? 'Cartographic' : basemap.value === 'satellite' ? 'Satellite' : 'Hybrid'} basemap`,
    })
  } finally {
    exporting.value = false
  }
}

// ── digitize export ───────────────────────────────────────────────────────
function downloadGeojson() {
  const verts = measureVerts.value
  if (verts.length < 2) return
  const geometry =
    verts.length >= 3
      ? { type: 'Polygon', coordinates: [[...verts, verts[0]]] }
      : { type: 'LineString', coordinates: verts }
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          source: 'vungu-digitize',
          created_at: new Date().toISOString(),
          area_m2: areaM2.value || undefined,
          length_m: distanceM.value || undefined,
        },
        geometry,
      },
    ],
  }
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `vungu-digitized-${Date.now()}.geojson`
  a.click()
  URL.revokeObjectURL(a.href)
}

// Persist the drawn geometry to PostGIS (spatial_planning.gis_feature via
// POST /api/gis/features). Degrades gracefully: GeoJSON export still works if
// the endpoint is unavailable or the user lacks an editor role.
const saving = ref(false)
const saveMsg = ref('')
async function saveDigitized() {
  const verts = measureVerts.value
  if (verts.length < 2) return
  const geometry =
    verts.length >= 3
      ? { type: 'Polygon', coordinates: [[...verts, verts[0]]] }
      : { type: 'LineString', coordinates: verts }
  saving.value = true
  saveMsg.value = ''
  try {
    const res = await api.post('/gis/features', {
      geometry,
      layer: 'digitized',
      properties: { area_m2: areaM2.value || undefined, length_m: distanceM.value || undefined },
    })
    saveMsg.value = `Saved to map (#${(res.data as any)?.id ?? '—'})`
  } catch (e: any) {
    const code = e?.response?.status
    saveMsg.value =
      code === 401 || code === 403
        ? 'Sign in as a GIS officer or planner to save.'
        : code === 404 || code === 400
          ? 'Save endpoint not ready (apply migration 091). GeoJSON export still works.'
          : 'Could not save. GeoJSON export still works.'
  } finally {
    saving.value = false
  }
}

// The abutting-owner schedule, as a spreadsheet.
function downloadWithinCsv() {
  const r = withinResult.value
  const c = radiusCenter.value
  if (!r || !c) return
  const blob = new Blob([withinCsv(c, r)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `parcels-within-${r.radiusM}m-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── formatting ────────────────────────────────────────────────────────────
function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}
function fmtArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`
}
</script>

<template>
  <div class="map-toolbar" v-if="map">
    <!-- vertical tool rail -->
    <div class="rail" role="toolbar" aria-label="Map tools">
      <button class="rail-btn" :class="{ active: activeTool === 'search' }" type="button"
        aria-label="Search the map" title="Search place or coordinates" @click="selectTool('search')">
        <Search :size="18" />
      </button>
      <button class="rail-btn" :class="{ active: activeTool === 'measure' }" type="button"
        aria-label="Measure distance and area" title="Measure" @click="selectTool('measure')">
        <Ruler :size="18" />
      </button>
      <button class="rail-btn" :class="{ active: activeTool === 'radius' }" type="button"
        aria-label="Notification radius" title="Notification radius" @click="selectTool('radius')">
        <Circle :size="18" />
      </button>
      <button v-if="props.imagery" class="rail-btn" :class="{ active: activeTool === 'imagery' }" type="button"
        aria-label="Basemap and imagery" title="Imagery" @click="selectTool('imagery')">
        <ImageIcon :size="18" />
      </button>
      <button class="rail-btn" type="button" aria-label="Export map as PDF" title="Export PDF"
        :disabled="exporting" @click="doExport">
        <Printer :size="18" />
      </button>
    </div>

    <!-- expandable panel for the active tool -->
    <div v-if="activeTool !== 'none'" class="panel" role="group" :aria-label="`${activeTool} tool`">
      <div class="panel-head">
        <span class="panel-title">
          {{ activeTool === 'search' ? 'Search' : activeTool === 'measure' ? 'Measure' : activeTool === 'radius' ? 'Notification radius' : 'Imagery' }}
        </span>
        <button class="icon-btn" type="button" aria-label="Close tool" @click="closeTool"><X :size="15" /></button>
      </div>

      <!-- SEARCH -->
      <div v-if="activeTool === 'search'" class="panel-body">
        <form class="search-row" @submit.prevent="runSearch">
          <input v-model="query" class="text-input" type="text" placeholder="Place name or -19.45, 29.81"
            aria-label="Search query" autocomplete="off" />
          <button class="primary-btn" type="submit" :disabled="searching">{{ searching ? '…' : 'Go' }}</button>
        </form>
        <p v-if="searchError" class="hint error">{{ searchError }}</p>
        <ul v-if="results.length" class="result-list">
          <li v-for="(h, i) in results" :key="i">
            <button type="button" class="result-btn" @click="chooseResult(h)">
              <span class="result-label">{{ hitLabel(h) }}</span>
              <span v-if="h.subtitle" class="result-sub">{{ h.subtitle }}</span>
            </button>
          </li>
        </ul>
        <p class="hint">Type a coordinate to fly there offline, or search a named place.</p>
      </div>

      <!-- MEASURE -->
      <div v-else-if="activeTool === 'measure'" class="panel-body">
        <p class="hint">Click points on the map. Three or more also measures area.</p>
        <div class="readout">
          <div class="readout-row"><span>Distance</span><strong>{{ fmtDistance(distanceM) }}</strong></div>
          <div class="readout-row"><span>Area</span><strong>{{ areaM2 ? fmtArea(areaM2) : '—' }}</strong></div>
          <div class="readout-row"><span>Points</span><strong>{{ measureVerts.length }}</strong></div>
        </div>
        <div class="btn-row">
          <button class="ghost-btn" type="button" @click="clearDrawing">Clear</button>
          <button class="ghost-btn" type="button" :disabled="measureVerts.length < 2" @click="downloadGeojson">
            <Download :size="14" /> GeoJSON
          </button>
          <button class="ghost-btn" type="button" :disabled="measureVerts.length < 2 || saving" @click="saveDigitized">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p v-if="saveMsg" class="hint">{{ saveMsg }}</p>
      </div>

      <!-- RADIUS -->
      <div v-else-if="activeTool === 'radius'" class="panel-body">
        <p class="hint">Set a radius, then click the site. Counts parcels/structures inside — e.g. a s.26(3) advert notification zone.</p>
        <label class="field">
          <span>Radius (m)</span>
          <input v-model.number="radiusMeters" class="text-input small" type="number" min="1" step="10"
            @change="radiusCenter && runRadius(radiusCenter)" />
        </label>
        <p v-if="withinLoading" class="hint" role="status">Querying the cadastre…</p>
        <div v-if="withinCount !== null" class="readout">
          <div class="readout-row"><span>Within radius</span><strong>{{ withinCount }}</strong></div>
          <p class="hint sub">{{ withinNote }}</p>
        </div>
        <ul v-if="withinResult && withinResult.parcels.length" class="within-list">
          <li v-for="(pc, i) in withinResult.parcels.slice(0, 12)" :key="i">
            <span class="within-label">{{ pc.label }}</span>
            <span class="within-dist">{{ pc.distanceM }} m</span>
          </li>
          <li v-if="withinResult.parcels.length > 12" class="within-more">
            +{{ withinResult.parcels.length - 12 }} more — export for the full schedule
          </li>
        </ul>
        <div class="btn-row">
          <button class="ghost-btn" type="button" @click="clearDrawing">Clear</button>
          <button class="ghost-btn" type="button" :disabled="!withinResult || !withinResult.parcels.length"
            @click="downloadWithinCsv">
            <Download :size="14" /> CSV
          </button>
        </div>
      </div>

      <!-- IMAGERY -->
      <div v-else-if="activeTool === 'imagery'" class="panel-body">
        <div class="seg" role="radiogroup" aria-label="Basemap mode">
          <button type="button" class="seg-btn" :class="{ on: basemap === 'map' }" role="radio"
            :aria-checked="basemap === 'map'" @click="chooseBasemap('map')">Map</button>
          <button type="button" class="seg-btn" :class="{ on: basemap === 'satellite' }" role="radio"
            :aria-checked="basemap === 'satellite'" @click="chooseBasemap('satellite')">Satellite</button>
          <button type="button" class="seg-btn" :class="{ on: basemap === 'hybrid' }" role="radio"
            :aria-checked="basemap === 'hybrid'" @click="chooseBasemap('hybrid')">Hybrid</button>
        </div>
        <p class="hint">Satellite shows Esri aerial imagery beneath the labels. Hybrid keeps zoning faintly visible.</p>
      </div>
    </div>

    <!-- coordinate readout -->
    <div v-if="cursor" class="coord-readout" aria-live="off">
      {{ cursor.lat.toFixed(5) }}, {{ cursor.lng.toFixed(5) }}
    </div>
  </div>
</template>

<style scoped>
.within-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 9.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.within-list li { display: flex; gap: 8px; align-items: baseline; font-size: 0.72rem; color: #334155; }
.within-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.within-dist { font-variant-numeric: tabular-nums; color: #64748b; }
.within-more { color: #64748b; font-style: italic; }

/* Tokens mirror MapLayerFilters.vue: white cards, warm-grey borders, the
   single accent (#1a73e8). Calm chrome that subordinates to the map. */
.map-toolbar {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: inherit;
  color: #3c4043;
}
.rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
}
.rail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #3c4043;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.rail-btn:hover { background: #f1f3f4; }
.rail-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
.rail-btn.active { background: #1a73e8; color: #ffffff; }
.rail-btn:disabled { opacity: 0.5; cursor: progress; }

.panel {
  width: min(248px, calc(100vw - 76px));
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #eceff1;
}
.panel-title { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: #5f6368;
  cursor: pointer;
  padding: 2px;
  border-radius: 6px;
}
.icon-btn:hover { background: #f1f3f4; color: #202124; }
.panel-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }

.search-row { display: flex; gap: 6px; }
.text-input {
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-size: 13px;
  color: #202124;
}
.text-input.small { width: 90px; flex: none; }
.text-input:focus { outline: 2px solid #1a73e8; outline-offset: 0; border-color: #1a73e8; }
.primary-btn {
  padding: 7px 12px;
  border: none;
  border-radius: 8px;
  background: #1a73e8;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled { opacity: 0.6; cursor: default; }

.field { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #5f6368; }

.hint { font-size: 11px; color: #5f6368; margin: 0; line-height: 1.4; }
.hint.sub { margin-top: 4px; }
.hint.error { color: #c5221f; }

.result-list { list-style: none; margin: 0; padding: 0; max-height: 160px; overflow-y: auto; border: 1px solid #eceff1; border-radius: 8px; }
.result-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1px;
  text-align: left;
  padding: 7px 10px;
  border: none;
  background: #fff;
  cursor: pointer;
  border-bottom: 1px solid #f1f3f4;
}
.result-btn:hover { background: #f5f9ff; }
.result-label { font-size: 13px; color: #202124; }
.result-sub { font-size: 11px; color: #5f6368; }

.readout { background: #f8f9fa; border: 1px solid #eceff1; border-radius: 8px; padding: 8px 10px; }
.readout-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #5f6368; padding: 2px 0; }
.readout-row strong { color: #202124; font-size: 13px; font-variant-numeric: tabular-nums; }

.btn-row { display: flex; gap: 6px; }
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  color: #3c4043;
  cursor: pointer;
}
.ghost-btn:hover { background: #f1f3f4; }
.ghost-btn:disabled { opacity: 0.5; cursor: default; }

.seg { display: flex; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; }
.seg-btn {
  flex: 1;
  padding: 7px 4px;
  border: none;
  background: #fff;
  font-size: 12px;
  color: #3c4043;
  cursor: pointer;
  border-right: 1px solid #dadce0;
}
.seg-btn:last-child { border-right: none; }
.seg-btn.on { background: #1a73e8; color: #fff; }

.coord-readout {
  align-self: flex-end;
  margin-top: 2px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #dadce0;
  border-radius: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #3c4043;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
</style>
