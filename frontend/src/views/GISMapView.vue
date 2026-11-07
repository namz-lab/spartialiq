<template>
  <div class="gis-view">
    <!-- Header -->
    <header class="gis-header">
      <button class="back-btn" @click="router.back()">
        <ArrowLeft :size="16" /> Portal
      </button>

      <!-- ── Intelligent Search ─────────────────────────────────────── -->
      <div class="search-wrap" ref="searchWrap">
        <div class="search-bar" :class="{ focused: searchFocused }">
          <Search :size="15" class="search-icon" />
          <input
            ref="searchInput"
            v-model="searchQ"
            class="search-input"
            placeholder="Search stands, zones, hospitals, schools…"
            autocomplete="off"
            @focus="searchFocused = true"
            @blur="onSearchBlur"
            @input="onSearchInput"
            @keydown.enter.prevent="runQuery"
            @keydown.escape="closeSearch"
            @keydown.down.prevent="moveSuggestion(1)"
            @keydown.up.prevent="moveSuggestion(-1)"
          />
          <button v-if="searchQ" class="search-clear" @click="clearSearch"><X :size="13" /></button>
        </div>

        <!-- Autocomplete dropdown -->
        <div v-if="showSuggestions && suggestions.length" class="search-dropdown">
          <div
            v-for="(s, i) in suggestions" :key="i"
            :class="['search-item', { highlighted: i === suggestionIdx }]"
            @mousedown.prevent="selectSuggestion(s)"
          >
            <span class="si-icon" :class="`si-${s.type}`">
              <MapPin v-if="s.type==='stand'" :size="12" />
              <Layers v-else-if="s.type==='zone'" :size="12" />
              <MapIcon v-else-if="s.type==='ward' || s.type==='place'" :size="12" />
              <Star v-else :size="12" />
            </span>
            <div class="si-text">
              <span class="si-label">{{ s.label }}</span>
              <span class="si-sub">{{ s.subtitle }}</span>
            </div>
          </div>
        </div>

        <!-- Query result banner -->
        <div v-if="queryResult" class="query-banner" :class="`qb-${queryResult.type}`">
          <span class="qb-msg">{{ queryResult.message }}</span>
          <button class="qb-close" @click="clearQueryResult"><X :size="12" /></button>
        </div>
      </div>

      <!--
        Layer toggles. A wrapping row of pills would push the 52px header to
        three rows on a phone, so below 768px this scrolls horizontally
        instead: every layer stays reachable, and the header keeps its height.
        aria-pressed carries the on/off state, which the tinted fill alone
        would not (WCAG 1.4.1).
      -->
      <div class="header-actions ent-chiprow" role="group" aria-label="Map layers">
        <button
          v-for="lyr in layerToggles" :key="lyr.id"
          type="button"
          :class="['layer-pill', { active: lyr.visible }]"
          :aria-pressed="lyr.visible"
          :style="lyr.visible ? { background: lyr.color + '25', borderColor: lyr.color, color: lyr.color } : {}"
          @click="toggleLayer(lyr)"
        >{{ lyr.label }}</button>
        <button
          type="button"
          :class="['layer-pill', { active: vunguHighlight }]"
          :aria-pressed="vunguHighlight"
          :style="vunguHighlight ? { background:'#1a73e815', borderColor:'#1a73e8', color:'#1a73e8' } : {}"
          @click="toggleVunguHighlight"
        >Vungu Only</button>
      </div>
    </header>

    <div class="gis-body">
      <!--
        Tools rail on desktop; bottom sheet on a phone. One set of markup: the
        breakpoint changes the box, not the contents.
      -->
      <aside class="gis-panel" :class="{ 'is-open': toolsOpen }"
             :aria-hidden="isMobile && !toolsOpen ? 'true' : undefined"
             aria-label="Map tools">
        <!-- Sheet chrome. Rendered only where the panel behaves as a sheet;
             the desktop rail has no need for a dismiss control. -->
        <div v-if="isMobile" class="panel-sheet-head">
          <span class="panel-grab" aria-hidden="true" />
          <p class="panel-sheet-title">Map tools</p>
          <button type="button" class="panel-sheet-close"
                  aria-label="Close map tools" @click="toolsOpen = false">
            <ChevronDown :size="18" />
          </button>
        </div>

        <div class="panel-section">
          <p class="panel-heading">Cadastral Query</p>
          <div class="query-row">
            <input v-model="queryStand" class="query-input" placeholder="Stand number" @keyup.enter="runCadastralQuery" />
            <select v-model="queryWard" class="query-select">
              <option value="">Ward</option>
              <option v-for="w in 19" :key="w" :value="String(w)">W{{ w }}</option>
            </select>
            <button class="btn-query" @click="runCadastralQuery"><Search :size="13" /></button>
          </div>
        </div>

        <!-- Query results list -->
        <div v-if="queryResultItems.length" class="panel-section">
          <p class="panel-heading">Results <span class="result-count">({{ queryResultItems.length }})</span></p>
          <div class="result-list">
            <div
              v-for="item in queryResultItems.slice(0, 8)"
              :key="item.label"
              class="result-row"
              @click="flyToItem(item)"
            >
              <span class="result-dot" :class="`dot-${item.type}`" />
              <div class="result-text">
                <span class="result-label">{{ item.label }}</span>
                <span class="result-sub">{{ item.subtitle }}</span>
              </div>
            </div>
            <p v-if="queryResultItems.length > 8" class="panel-more">+{{ queryResultItems.length - 8 }} more</p>
          </div>
        </div>

        <div class="panel-section">
          <p class="panel-heading">Legend</p>
          <div class="legend-items">
            <div v-for="item in legend" :key="item.label" class="legend-item">
              <div class="legend-swatch" :style="{ background: item.color, borderRadius: item.round ? '50%' : '3px' }" />
              <span>{{ item.label }}</span>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <p class="panel-heading">Quick Actions</p>
          <button class="panel-btn" @click="flyToDistrict"><Compass :size="13" /> Zoom to District</button>
          <button class="panel-btn" @click="locateMe"><MapPin :size="13" /> My Location</button>
          <button class="panel-btn accent" @click="showReportHere = true"><Flag :size="13" /> Report Issue Here</button>
        </div>

        <div class="panel-section">
          <p class="panel-heading">Reports on Map</p>
          <div v-if="geoReports.length === 0" class="panel-empty">No geotagged reports yet</div>
          <div v-else>
            <div v-for="rpt in geoReports.slice(0, 5)" :key="rpt.id" class="mini-report-row" @click="flyToReport(rpt)">
              <span class="mini-dot" :style="{ background: reportColor(rpt.type) }" />
              <span class="mini-label">{{ rpt.typeName }}</span>
            </div>
            <p v-if="geoReports.length > 5" class="panel-more">+{{ geoReports.length - 5 }} more</p>
          </div>
        </div>
      </aside>

      <!-- Map container -->
      <div ref="mapContainer" class="map-container" />

      <!--
        Floating tools control. Bottom-left, clear of MapLibre's own zoom and
        compass controls (top-right) and of the property sheet, and inside the
        thumb arc of a one-handed grip.
      -->
      <button
        v-if="showToolsFab"
        type="button"
        class="tools-fab"
        aria-label="Open map tools"
        :aria-expanded="toolsOpen"
        @click="toolsOpen = true"
      >
        <SlidersHorizontal :size="18" aria-hidden="true" />
      </button>

      <!-- Feature properties: side panel on desktop, property sheet on
           mobile. Non-modal, so the selected feature stays visible. -->
      <Transition name="slide-in">
        <aside v-if="infoPanel" class="info-panel" aria-label="Feature properties">
          <span v-if="isMobile" class="panel-grab" aria-hidden="true" />
          <button class="info-close" aria-label="Close feature properties"
                  @click="infoPanel = null"><X :size="16" /></button>
          <div class="info-tag" :style="{ background: infoPanel.color + '20', color: infoPanel.color }">
            {{ infoPanel.type }}
          </div>
          <h3 class="info-title">{{ infoPanel.title }}</h3>
          <div class="info-fields">
            <div v-for="f in infoPanel.fields" :key="f.label" class="info-field">
              <p class="info-field-label">{{ f.label }}</p>
              <p class="info-field-value">{{ f.value }}</p>
            </div>
          </div>
          <div v-if="infoPanel.actions?.length" class="info-actions">
            <button v-for="act in infoPanel.actions" :key="act.label" class="info-action-btn" @click="act.handler()">
              {{ act.label }}
            </button>
          </div>
        </aside>
      </Transition>
    </div>

    <!-- Report-here modal -->
    <Teleport to="body">
      <div v-if="showReportHere" class="modal-backdrop" @click.self="showReportHere = false">
        <div class="rh-modal">
          <div class="rh-header">
            <Flag :size="18" class="rh-icon" />
            <div>
              <h3 class="rh-title">Report an Issue Here</h3>
              <p class="rh-sub">Click on the map to pick a location, then choose report type</p>
            </div>
            <button class="rh-close-btn" @click="showReportHere = false"><X :size="16" /></button>
          </div>
          <div class="rh-coords">
            <MapPin :size="14" class="rh-pin" />
            <span v-if="pickedCoords">{{ pickedCoords.lat.toFixed(5) }}°S, {{ pickedCoords.lng.toFixed(5) }}°E</span>
            <span v-else class="rh-no-coord">Click map to pick location</span>
          </div>
          <div class="rh-types">
            <button
              v-for="rt in quickReportTypes" :key="rt.id"
              class="rh-type-btn"
              :disabled="!pickedCoords"
              @click="goToReport(rt.id)"
            >
              <span class="rh-dot" :style="{ background: rt.color }" />
              {{ rt.name }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" :class="['toast', toast.type]">{{ toast.msg }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// RESPONSIVE STRUCTURE (Phase 12) — the map is the product, so the map keeps
// the screen.
//
//   ≥1024px  tools rail (220px) | map | property panel (280px)
//   768–1023 the rail and the property panel float OVER the map as narrower
//            overlays, so the map never loses width
//   ≤767px   map-first. Both panels become bottom sheets covering the lower
//            half of the screen, leaving the map visible and pannable above
//            them. A floating Tools control opens the rail; selecting a
//            feature opens the property sheet by itself.
//
// The two sheets are deliberately NON-MODAL — no scrim, no focus trap. A
// modal property sheet would be wrong here: the point of tapping a parcel is
// to look at the parcel while reading its record, and a scrim would hide the
// very feature the sheet describes. They are disclosure panels over a live
// map, not dialogs, so they keep the canvas interactive. UiSheet is for a
// decision that must be answered before anything else continues; this is not
// that.
//
// Both panels keep ONE set of markup at every width and change only their
// box, so there is no mobile copy of the layer list or the property fields to
// fall out of sync (Phase 20).
import { computed, ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft, Map as MapIcon, Search, MapPin, Compass, Flag, X, Layers, Star,
  SlidersHorizontal, ChevronDown,
} from 'lucide-vue-next'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { escapeHtml } from '@/utils/escapeHtml'
import api from '@/services/api'

const router = useRouter()
const { isMobile } = useBreakpoint()

// Below 768px the tools rail is a sheet the officer opens. At every larger
// width it is a permanent rail and the CSS ignores this flag.
const toolsOpen = ref(false)

// showToolsFab is declared with infoPanel further down, because it depends on
// it.
const mapContainer = ref<HTMLDivElement>()
const searchWrap = ref<HTMLDivElement>()
const searchInput = ref<HTMLInputElement>()
let map: maplibregl.Map | null = null
let pickerMarker: maplibregl.Marker | null = null
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

// ── Vungu highlight (grey out rest of Zimbabwe) ──────────────────────────────
const vunguHighlight = ref(false)
let maskLoaded = false

async function loadVunguMask() {
  if (maskLoaded || !map) return
  const today = new Date().toISOString().slice(0, 10)
  try {
    const [maskRes, boundaryRes] = await Promise.all([
      api.get(`/map-search/vungu-mask?d=${today}`),
      api.get(`/map-search/vungu-boundary?d=${today}`),
    ])

    if (!map.getSource('vungu-mask')) {
      map.addSource('vungu-mask', { type: 'geojson', data: maskRes.data })
      map.addLayer({
        id: 'vungu-grey-mask',
        type: 'fill',
        source: 'vungu-mask',
        paint: { 'fill-color': '#6b7280', 'fill-opacity': 0.5 },
        layout: { visibility: 'none' }
      })
    }

    if (!map.getSource('vungu-boundary')) {
      map.addSource('vungu-boundary', { type: 'geojson', data: boundaryRes.data })
      map.addLayer({
        id: 'vungu-boundary-casing',
        type: 'line',
        source: 'vungu-boundary',
        layout: { 'line-cap': 'butt', 'line-join': 'miter', visibility: 'none' },
        paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.7 },
      })
      map.addLayer({
        id: 'vungu-boundary-line',
        type: 'line',
        source: 'vungu-boundary',
        layout: { 'line-cap': 'butt', 'line-join': 'miter', visibility: 'none' },
        paint: { 'line-color': '#111827', 'line-width': 2.5, 'line-opacity': 1 },
      })
    }

    maskLoaded = true
  } catch { /* mask unavailable */ }
}

function toggleVunguHighlight() {
  vunguHighlight.value = !vunguHighlight.value
  const vis = vunguHighlight.value ? 'visible' : 'none'
  loadVunguMask().then(() => {
    ;['vungu-grey-mask', 'vungu-boundary-casing', 'vungu-boundary-line'].forEach(id => {
      if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    })
    if (vunguHighlight.value) {
      map?.fitBounds([[29.09, -19.98], [30.19, -19.09]], { padding: 24, duration: 900, maxZoom: 11 })
    }
  })
}

// ── Search ───────────────────────────────────────────────────────────────────
const searchQ = ref('')
const searchFocused = ref(false)
const showSuggestions = ref(false)
const suggestions = ref<any[]>([])
const suggestionIdx = ref(-1)
const queryResult = ref<{ type: string; message: string; count: number; bbox?: number[] } | null>(null)
const queryResultItems = ref<any[]>([])

// Search dot markers on map
let searchMarkers: maplibregl.Marker[] = []

function clearSearchMarkers() {
  searchMarkers.forEach(m => m.remove())
  searchMarkers = []
}

function onSearchInput() {
  const q = searchQ.value.trim()
  suggestionIdx.value = -1
  clearQueryResult()
  if (!q) { showSuggestions.value = false; suggestions.value = []; return }
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => fetchSuggestions(q), 220)
}

async function fetchSuggestions(q: string) {
  try {
    const res = await api.get('/map-search', { params: { q } })
    suggestions.value = (res.data?.data || []).slice(0, 8)
    showSuggestions.value = true
  } catch { suggestions.value = [] }
}

function onSearchBlur() {
  setTimeout(() => { searchFocused.value = false; showSuggestions.value = false }, 200)
}

function closeSearch() {
  showSuggestions.value = false
  searchInput.value?.blur()
}

function clearSearch() {
  searchQ.value = ''
  suggestions.value = []
  showSuggestions.value = false
  clearQueryResult()
  clearSearchMarkers()
}

function clearQueryResult() {
  queryResult.value = null
  queryResultItems.value = []
  clearSearchMarkers()
}

function moveSuggestion(dir: 1 | -1) {
  const max = suggestions.value.length - 1
  suggestionIdx.value = Math.max(-1, Math.min(max, suggestionIdx.value + dir))
}

function selectSuggestion(s: any) {
  searchQ.value = s.label
  showSuggestions.value = false
  if (s.center && map) {
    map.flyTo({ center: s.center, zoom: 14, duration: 700 })
    // Show info panel for stand items
    if (s.type === 'stand' && s.meta) {
      infoPanel.value = {
        type: 'Stand', title: s.label, color: '#0891b2',
        fields: [
          { label: 'Status', value: s.meta.status || '—' },
          { label: 'Zone', value: s.meta.zone_type || '—' },
          { label: 'Area', value: s.meta.area_sqm ? `${s.meta.area_sqm} m²` : '—' },
          { label: 'Price', value: s.meta.price_usd ? `USD ${s.meta.price_usd.toLocaleString()}` : '—' },
        ],
        actions: [{ label: 'Apply for this Stand', handler: () => router.push('/apply/plot_allocation') }]
      }
    }
  }
}

async function runQuery() {
  const q = searchQ.value.trim()
  showSuggestions.value = false
  if (!q) return
  try {
    const res = await api.get('/map-query', { params: { q } })
    const data = res.data
    queryResult.value = { type: data.type, message: data.message, count: data.count, bbox: data.bbox }
    queryResultItems.value = data.results || []

    // Fly to result bbox
    if (data.bbox && data.bbox.length === 4 && map) {
      const [minLng, minLat, maxLng, maxLat] = data.bbox
      if ([minLng, minLat, maxLng, maxLat].every(isFinite)) {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, maxZoom: 14, duration: 800 })
      }
    }

    // Drop markers for POI / stand results
    clearSearchMarkers()
    if (data.results?.length && map) {
      for (const r of data.results.slice(0, 30)) {
        if (!r.center || !isFinite(r.center[0])) continue
        const el = document.createElement('div')
        el.className = `search-dot dot-${r.type || 'poi'}`
        const m = new maplibregl.Marker({ element: el })
          .setLngLat(r.center)
          .setPopup(new maplibregl.Popup({ offset: 10, closeButton: false, maxWidth: '200px' })
            // Search hits are database rows (stand/POI labels). Interpolating
            // them raw into setHTML is a stored-XSS sink — escape both fields.
            .setHTML(`<b>${escapeHtml(r.label)}</b>${r.subtitle ? `<br><small>${escapeHtml(r.subtitle)}</small>` : ''}`))
          .addTo(map)
        searchMarkers.push(m)
      }
    }
  } catch (err) {
    showToast('Search failed', 'error')
  }
}

function flyToItem(item: any) {
  if (!item.center || !map) return
  map.flyTo({ center: item.center, zoom: 14, duration: 700 })
  if (item.type === 'stand' && item.meta) {
    infoPanel.value = {
      type: 'Stand', title: item.label, color: '#0891b2',
      fields: [
        { label: 'Status', value: item.meta.status || '—' },
        { label: 'Zone', value: item.meta.zone_type || '—' },
        { label: 'Area', value: item.meta.area_sqm ? `${item.meta.area_sqm} m²` : '—' },
        { label: 'Price', value: item.meta.price_usd ? `USD ${item.meta.price_usd.toLocaleString()}` : '—' },
      ],
      actions: [{ label: 'Apply for this Stand', handler: () => router.push('/apply/plot_allocation') }]
    }
  }
}

// ── Info panel ───────────────────────────────────────────────────────────────
const infoPanel = ref<{
  type: string; title: string; color: string
  fields: { label: string; value: string }[]
  actions?: { label: string; handler: () => void }[]
} | null>(null)

/** The floating Tools control hides while either sheet is up: both cover the
 *  bottom of the screen, and a control floating on top of a sheet reads as a
 *  rendering bug. */
const showToolsFab = computed(() => isMobile.value && !toolsOpen.value && !infoPanel.value)

// Tapping a feature is an answer to the question the tools sheet was asking,
// so the tools sheet gets out of the way. Without this the property sheet
// would slide in underneath it and the officer would see neither properly.
watch(infoPanel, (panel) => { if (panel && isMobile.value) toolsOpen.value = false })

const showReportHere = ref(false)
const pickedCoords = ref<{ lat: number; lng: number } | null>(null)
const queryStand = ref('')
const queryWard = ref('')

// ── Live stands from API ─────────────────────────────────────────────────────
const liveStands = ref<any[]>([])

async function fetchLiveStands() {
  try {
    const res = await api.get('/stands', { params: { status: 'available,allocated,reserved' } })
    const features = res.data?.features ?? []
    liveStands.value = features
    const src = map?.getSource('live-stands') as any
    if (src?.setData) {
      src.setData({
        type: 'FeatureCollection',
        features: features
          .map((f: any) => {
            const p = f.properties || {}
            const lng = Array.isArray(p.centroid) ? Number(p.centroid[0]) : Number(p.centroid_lng)
            const lat = Array.isArray(p.centroid) ? Number(p.centroid[1]) : Number(p.centroid_lat)
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
            return {
              type: 'Feature',
              properties: {
                ...p,
                // Normalize camelCase API → snake_case UI fields
                stand_number: p.standNumber ?? p.stand_number,
                zone_type: p.zoneType ?? p.zone_type,
                area_sqm: p.areaSqm ?? p.area_sqm,
                sold: String(p.status || '').toLowerCase() === 'allocated',
                available: String(p.status || '').toLowerCase() === 'available',
              },
              geometry: { type: 'Point', coordinates: [lng, lat] },
            }
          })
          .filter(Boolean),
      })
    }
  } catch { /* backend unreachable — tile layer still shows polygons */ }
}

// ── Mining GeoJSON ────────────────────────────────────────────────────────────
const MINING_DEFS = [
  { name:'Kwekwe Gold Mine Operations', company:'AurumZim Mining Ltd', mine_type:'Gold', safety_zone_km:2.5, status:'Active', compliance:'EIA Compliant — last audit Jan 2026', coords:[[29.85,-19.30],[29.98,-19.30],[29.98,-19.38],[29.85,-19.38],[29.85,-19.30]] },
  { name:'Sebakwe Chrome Operations',   company:'Chrome Holdings Pvt Ltd', mine_type:'Chrome', safety_zone_km:1.8, status:'Active', compliance:'EIA Compliant — last audit Nov 2025', coords:[[29.87,-19.44],[29.98,-19.44],[29.98,-19.53],[29.87,-19.53],[29.87,-19.44]] },
  { name:'Mvuma Sand Extraction Site',  company:'Builders Supply (Pvt) Ltd', mine_type:'Sand & Aggregate', safety_zone_km:0.5, status:'Seasonal', compliance:'EIA Pending — renewal due', coords:[[29.38,-19.83],[29.48,-19.83],[29.48,-19.90],[29.38,-19.90],[29.38,-19.83]] },
]
function miningGeoJSON() {
  return { type:'FeatureCollection' as const, features: MINING_DEFS.map(m => ({
    type:'Feature' as const,
    properties:{ ...m },
    geometry:{ type:'Polygon' as const, coordinates:[m.coords] }
  }))}
}

// ── Geotagged reports ─────────────────────────────────────────────────────────
interface StoredReport {
  id: string; ref: string; type: string; typeName: string
  submittedAt: string; status: string; summary: string
  lat?: number; lng?: number
}
const geoReports = ref<StoredReport[]>([])

function loadReports() {
  const all: StoredReport[] = JSON.parse(localStorage.getItem('vungu_reports') || '[]')
  geoReports.value = all.filter(r => r.lat != null && r.lng != null)
}

function reportColor(type: string): string {
  const m: Record<string,string> = {
    illegal_development:'#dc2626', boundary_encroachment:'#d97706',
    environmental_nuisance:'#16a34a', building_progress:'#2563eb',
    ownership_change:'#7c3aed', dev_milestone:'#0891b2',
    safety_land_intel:'#dc2626', env_compliance:'#16a34a',
    plan_deviation:'#d97706', utility_connection:'#0284c7',
  }
  return m[type] || '#6b7280'
}

function reportsGeoJSON() {
  return { type:'FeatureCollection' as const, features: geoReports.value.map(r => ({
    type:'Feature' as const,
    properties:{ ...r, color: reportColor(r.type) },
    geometry:{ type:'Point' as const, coordinates:[r.lng!, r.lat!] }
  }))}
}

// ── Layer toggles ─────────────────────────────────────────────────────────────
const layerToggles = reactive([
  { id:'wards',   label:'Wards',     color:'#3b82f6', visible:true },
  { id:'zoning',  label:'Zoning',    color:'#a78bfa', visible:true },
  { id:'mining',  label:'MineGuard', color:'#d97706', visible:true },
  { id:'stands',  label:'Stands',    color:'#0891b2', visible:true },
  { id:'reports', label:'Reports',   color:'#ef4444', visible:true },
])
const LAYER_IDS: Record<string, string[]> = {
  wards:   ['vungu-wards', 'vungu-wards-label'],
  zoning:  ['vungu-vungu_proposed_peri_urban_zones', 'vungu-vungu_proposed_peri_urban_zones-master-label'],
  mining:  ['mining-fill','mining-outline'],
  stands:  ['live-stands-circles','live-stands-labels'],
  reports: ['reports-circles'],
}
function toggleLayer(lyr: typeof layerToggles[0]) {
  lyr.visible = !lyr.visible
  const vis = lyr.visible ? 'visible' : 'none'
  LAYER_IDS[lyr.id]?.forEach(id => { if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis) })
}

// ── Legend ────────────────────────────────────────────────────────────────────
const legend = [
  { label:'Ward Boundary',            color:'#3b82f6', round:false },
  { label:'R1 Low Density Res.',      color:'#fde047', round:false },
  { label:'R2 Medium Density Res.',   color:'#fb923c', round:false },
  { label:'Commercial Zone',          color:'#c084fc', round:false },
  { label:'Industrial Zone',          color:'#f97316', round:false },
  { label:'Agricultural Reserve',     color:'#4ade80', round:false },
  { label:'Mining Operation',         color:'#d97706', round:false },
  { label:'Available Stand',          color:'#0891b2', round:true  },
  { label:'Search Result',            color:'#f43f5e', round:true  },
  { label:'Geotagged Report',         color:'#ef4444', round:true  },
]

// ── Quick report types ────────────────────────────────────────────────────────
const quickReportTypes = [
  { id:'illegal_development',   name:'Illegal Development',    color:'#dc2626' },
  { id:'environmental_nuisance',name:'Environmental Nuisance', color:'#16a34a' },
  { id:'boundary_encroachment', name:'Boundary Encroachment',  color:'#d97706' },
  { id:'building_progress',     name:'Building Progress',      color:'#2563eb' },
]
function goToReport(typeId: string) {
  showReportHere.value = false
  router.push({ path: '/portal', query: { openReport: typeId, lat: String(pickedCoords.value?.lat ?? ''), lng: String(pickedCoords.value?.lng ?? '') } })
}

// ── Toast ─────────────────────────────────────────────────────────────────────
const toast = reactive({ show: false, msg: '', type: 'info' })
function showToast(msg: string, type = 'info') {
  toast.msg = msg; toast.type = type; toast.show = true
  setTimeout(() => { toast.show = false }, 3500)
}

// ── Map actions ───────────────────────────────────────────────────────────────
function flyToDistrict() { map?.fitBounds([[29.55, -19.85], [30.15, -19.25]], { padding: 32, duration: 900 }) }

function locateMe() {
  if (!navigator.geolocation) { showToast('Geolocation not available', 'error'); return }
  navigator.geolocation.getCurrentPosition(
    pos => map?.flyTo({ center:[pos.coords.longitude, pos.coords.latitude], zoom:14, duration:1000 }),
    () => showToast('Could not get your location', 'error')
  )
}

function flyToReport(rpt: StoredReport) {
  if (rpt.lat == null || rpt.lng == null) return
  map?.flyTo({ center:[rpt.lng, rpt.lat], zoom:14, duration:800 })
}

async function runCadastralQuery() {
  if (!queryStand.value.trim()) return
  const q = queryStand.value.trim()
  let match = liveStands.value.find((f: any) =>
    (f.properties?.stand_number ?? '').toLowerCase().includes(q.toLowerCase())
  )
  if (!match) {
    try {
      const res = await api.get('/stands', { params: { q, status: 'available,allocated,reserved' } })
      match = (res.data?.features ?? [])[0]
    } catch { /* ignore */ }
  }
  if (match) {
    const p = match.properties
    const lng = p.centroid_lng
    const lat = p.centroid_lat
    if (lng != null && lat != null) map?.flyTo({ center:[lng, lat], zoom:15, duration:900 })
    infoPanel.value = {
      type:'Cadastral Record', title:`Stand ${p.stand_number}`, color:'#0891b2',
      fields:[
        { label:'Ward', value:p.ward || '—' },
        { label:'Zone', value:p.zone_type || p.zone_type_cache || '—' },
        { label:'Status', value:p.status || '—' },
        { label:'Area', value:p.area_sqm ? `${p.area_sqm} m²` : '—' },
      ],
      actions:[{ label:'Apply for this Stand', handler: () => router.push({ path:'/citizen', query:{ section:'new', stand: p.stand_number } }) }]
    }
  } else {
    showToast(`Stand "${q}" not found`, 'error')
  }
}

// ── Map init ──────────────────────────────────────────────────────────────────
function initMap() {
  if (!mapContainer.value) return
  map = new maplibregl.Map({
    container: mapContainer.value,
    style: {
      version: 8,
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      // Self-hosted base — PostGIS basemap painted on load; no external tiles.
      sources: {},
      layers: [{ id:'background', type:'background', paint:{ 'background-color':'#f2efe9' } }]
    },
    center: [29.80, -19.52],
    zoom: 9.5
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.addControl(new maplibregl.ScaleControl({ maxWidth:100, unit:'metric' }), 'bottom-right')
  map.on('load', async () => {
    await addVunguBasemap(map!)
    addAllLayers()
    addClickHandlers()
    enablePickingMode()
    fetchLiveStands()
  })
}

function addAllLayers() {
  if (!map) return

  map.addSource('mining', { type:'geojson', data:miningGeoJSON() })
  map.addLayer({ id:'mining-fill',    type:'fill', source:'mining', paint:{ 'fill-color':'#92400e', 'fill-opacity':0.22 } })
  map.addLayer({ id:'mining-outline', type:'line', source:'mining', paint:{ 'line-color':'#d97706', 'line-width':2, 'line-dasharray':[4,2] } })

  map.addSource('live-stands', { type:'geojson', data:{ type:'FeatureCollection', features:[] } })
  map.addLayer({ id:'live-stands-circles', type:'circle', source:'live-stands',
    paint:{ 'circle-radius':7, 'circle-color':['match',['get','status'],'available','#0891b2','allocated','#6366f1','reserved','#f59e0b','#94a3b8'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2 }
  })
  map.addLayer({ id:'live-stands-labels', type:'symbol', source:'live-stands',
    minzoom: 13,
    layout:{ 'text-field':['get','stand_number'], 'text-size':9, 'text-font':['Open Sans Regular'], 'text-offset':[0,1.2], 'text-anchor':'top' },
    paint:{ 'text-color':'#0891b2', 'text-halo-color':'#fff', 'text-halo-width':1 }
  })

  map.addSource('reports', { type:'geojson', data:reportsGeoJSON() })
  map.addLayer({ id:'reports-circles', type:'circle', source:'reports',
    paint:{ 'circle-radius':8, 'circle-color':['get','color'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2, 'circle-opacity':0.9 }
  })
}

const PROPERTY_STAND_KEYS = ['stand_number','stand_no','standno','stand','name_cfu','name','parcel_id','erf_number','erf_no','plot_number','plot_no']
function standFromProps(props: any): string {
  if (!props) return ''
  for (const k of PROPERTY_STAND_KEYS) {
    const v = props[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function addClickHandlers() {
  if (!map) return

  map.on('click', 'vungu-wards', e => {
    const p = e.features?.[0]?.properties as any
    if (!p) return
    infoPanel.value = {
      type:'Ward', title:p.name_en || `Ward ${p.fid}`, color:'#3b82f6',
      fields:[
        { label:'Code', value:p.pcode || '—' },
        { label:'District', value:p.district_name || '—' },
      ],
      actions:[{ label:'View Ward Services', handler:()=>router.push('/portal') }]
    }
  })

  map.on('click', 'vungu-vungu_proposed_peri_urban_zones', e => {
    const p = e.features?.[0]?.properties as any
    if (!p) return
    infoPanel.value = {
      type:'Planning Zone', title:p.zone || '—', color:'#a78bfa',
      fields:[
        { label:'Area', value:p.area_ha ? `${Number(p.area_ha).toFixed(1)} ha` : '—' },
        { label:'Zone Type', value:p.zone_type || p.zone || '—' },
        { label:'Permit Required', value:'Yes — contact Planning Department' },
      ],
      actions:[{ label:'Apply for Change of Use', handler:()=>router.push({ path:'/citizen', query:{ section:'new' } }) }]
    }
  })

  map.on('click', 'mining-fill', e => {
    const p = e.features?.[0]?.properties as any
    if (!p) return
    infoPanel.value = {
      type:'MineGuard', title:p.name, color:'#d97706',
      fields:[
        { label:'Company', value:p.company },
        { label:'Mine Type', value:p.mine_type },
        { label:'Status', value:p.status },
        { label:'Safety Exclusion Zone', value:`${p.safety_zone_km} km` },
        { label:'Compliance', value:p.compliance },
      ],
      actions:[{ label:'Submit Safety Report', handler:()=>router.push({ path:'/portal', query:{ openReport:'safety_land_intel' } }) }]
    }
  })

  map.on('click', 'live-stands-circles', e => {
    const p = e.features?.[0]?.properties as any
    if (!p) return
    const standNo = p.stand_number || p.standNumber
    const status = p.status || '—'
    const sold = p.sold === true || String(status).toLowerCase() === 'allocated'
    infoPanel.value = {
      type:'Stand', title:`Stand ${standNo}`, color: sold ? '#991b1b' : '#0891b2',
      fields:[
        { label:'Ward', value:p.ward || '—' },
        { label:'Zone', value:p.zone_type || p.zoneType || p.zone_type_cache || '—' },
        { label:'Status', value: sold ? 'Sold / allocated' : status },
        { label:'Area', value:(p.area_sqm ?? p.areaSqm) ? `${p.area_sqm ?? p.areaSqm} m²` : '—' },
        { label:'Price', value: p.priceUsd != null ? `USD ${Number(p.priceUsd).toLocaleString()}` : (p.price_usd != null ? `USD ${Number(p.price_usd).toLocaleString()}` : '—') },
      ],
      actions:[
        { label:'Open property file', handler:()=>router.push({ name:'property-file', params:{ standNo } }) },
        ...(sold ? [] : [{ label:'Apply for Allocation', handler:()=>router.push({ path:'/citizen', query:{ section:'new', stand: standNo } }) }]),
      ]
    }
  })

  map.on('click', 'reports-circles', e => {
    const p = e.features?.[0]?.properties as any
    if (!p) return
    infoPanel.value = {
      type:'Report', title:p.typeName, color:p.color,
      fields:[
        { label:'Reference', value:p.ref },
        { label:'Submitted', value:p.submittedAt },
        { label:'Status', value:p.status },
        { label:'Summary', value:p.summary },
      ]
    }
  })

  const clickable = ['vungu-wards','vungu-vungu_proposed_peri_urban_zones','mining-fill','live-stands-circles','reports-circles']
  clickable.forEach(id => {
    map!.on('mouseenter', id, () => { map!.getCanvas().style.cursor = 'pointer' })
    map!.on('mouseleave', id, () => { map!.getCanvas().style.cursor = '' })
  })

  map.getContainer().addEventListener('feature-click', (ev: Event) => {
    const detail = (ev as CustomEvent).detail || {}
    const layer = String(detail.layer || '')
    if (!/parcel|farm|cadastr|stand|erf|plot/i.test(layer)) return
    const props = detail.properties || detail.feature?.properties || {}
    const stand = standFromProps(props)
    if (!stand) return
    infoPanel.value = {
      type: 'Parcel', title: `Stand ${stand}`, color: '#1d4ed8',
      fields: [
        { label: 'Source layer', value: layer.replace(/_/g, ' ') },
        { label: 'Ward / district', value: props.ward || props.district || '—' },
      ],
      actions: [{ label: 'Open property file', handler: () => router.push({ name: 'property-file', params: { standNo: stand } }) }],
    }
  })
}

function enablePickingMode() {
  if (!map) return
  map.on('click', e => {
    if (!showReportHere.value) return
    pickedCoords.value = { lat: e.lngLat.lat, lng: e.lngLat.lng }
    if (pickerMarker) pickerMarker.remove()
    pickerMarker = new maplibregl.Marker({ color: '#ef4444' })
      .setLngLat([e.lngLat.lng, e.lngLat.lat])
      .addTo(map!)
  })
}

onMounted(() => { loadReports(); initMap() })
onUnmounted(() => {
  clearSearchMarkers()
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  map?.remove(); map = null
})
</script>

<style scoped>
.gis-view {
  display: flex; flex-direction: column; height: var(--ent-vh);
  background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #0f172a; overflow: hidden;
}

/* ── Header ───────────────────────────────────────────────────────────── */
.gis-header {
  display: flex; align-items: center; gap: 0.75rem; height: 52px;
  background: #111827; border-bottom: 1px solid #1e293b;
  padding: 0 0.75rem; flex-shrink: 0; z-index: 10;
}
.back-btn {
  display: flex; align-items: center; gap: 0.375rem;
  background: #1e293b; border: none; color: #94a3b8;
  font-size: 0.8125rem; padding: 0.375rem 0.75rem;
  border-radius: 0.375rem; cursor: pointer; flex-shrink: 0;
  transition: color 0.15s, background 0.15s; white-space: nowrap;
}
.back-btn:hover { background: #334155; color: #f1f5f9; }

/* ── Search bar ───────────────────────────────────────────────────────── */
.search-wrap { flex: 1; position: relative; max-width: 480px; min-width: 200px; }
.search-bar {
  display: flex; align-items: center; gap: 0.5rem;
  background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem;
  padding: 0.3rem 0.625rem; transition: border-color 0.15s;
}
.search-bar.focused { border-color: #3b82f6; }
.search-icon { color: #64748b; flex-shrink: 0; }
.search-input {
  flex: 1; background: none; border: none; outline: none;
  color: #e2e8f0; font-size: 0.8125rem; min-width: 0;
}
.search-input::placeholder { color: #475569; }
.search-clear {
  background: none; border: none; color: #475569; cursor: pointer;
  padding: 0; display: flex; align-items: center; flex-shrink: 0;
}
.search-clear:hover { color: #94a3b8; }

.search-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: #1e293b; border: 1px solid #334155; border-radius: 0.5rem;
  overflow: hidden; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.search-item {
  display: flex; align-items: center; gap: 0.625rem;
  padding: 0.5rem 0.75rem; cursor: pointer; transition: background 0.1s;
}
.search-item:hover, .search-item.highlighted { background: #334155; }
.si-icon {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: #fff;
}
.si-stand  { background: #0891b2; }
.si-zone   { background: #a78bfa; }
.si-ward, .si-place { background: #3b82f6; }
.si-poi, .si-farm, .si-parcel { background: #16a34a; }
.si-text { display: flex; flex-direction: column; min-width: 0; }
.si-label { font-size: 0.8125rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.si-sub   { font-size: 0.7rem; color: #64748b; white-space: nowrap; }

.query-banner {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  padding: 0.5rem 0.75rem; border-radius: 0.5rem;
  display: flex; align-items: center; gap: 0.5rem; z-index: 100;
  font-size: 0.8125rem; font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.qb-count  { background: #0c4a6e; color: #bae6fd; border: 1px solid #0369a1; }
.qb-poi    { background: #064e3b; color: #a7f3d0; border: 1px solid #059669; }
.qb-zone   { background: #4c1d95; color: #e9d5ff; border: 1px solid #7c3aed; }
.qb-stand  { background: #0c4a6e; color: #bae6fd; border: 1px solid #0369a1; }
.qb-notfound { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
.qb-msg { flex: 1; }
.qb-close { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7; padding: 0; display: flex; align-items: center; }
.qb-close:hover { opacity: 1; }

.header-actions { display: flex; gap: 0.375rem; flex-wrap: nowrap; flex-shrink: 0; }
.layer-pill {
  font-size: 0.7rem; font-weight: 600; padding: 0.25rem 0.5rem;
  border-radius: 99px; border: 1px solid #334155; background: transparent;
  color: #64748b; cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.layer-pill:hover { border-color: #475569; color: #94a3b8; }

/* ── Body ─────────────────────────────────────────────────────────────── */
.gis-body { display: flex; flex: 1; overflow: hidden; position: relative; }

/* ── Left panel ───────────────────────────────────────────────────────── */
.gis-panel {
  width: 220px; flex-shrink: 0; background: #ffffff;
  border-right: 1px solid #e2e8f0; overflow-y: auto; z-index: 5;
}
.panel-section { padding: 0.875rem 1rem; border-bottom: 1px solid #f1f5f9; }
.panel-heading {
  font-size: 0.7rem; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.07em; margin: 0 0 0.625rem;
}
.result-count { font-weight: 400; color: #3b82f6; }
.query-row { display: flex; gap: 0.375rem; }
.query-input {
  flex: 1; border: 1px solid #d1d5db; border-radius: 0.375rem;
  padding: 0.375rem 0.5rem; font-size: 0.8125rem; min-width: 0; outline: none;
}
.query-input:focus { border-color: #3b82f6; }
.query-select {
  width: 56px; border: 1px solid #d1d5db; border-radius: 0.375rem;
  padding: 0.375rem 0.25rem; font-size: 0.75rem; outline: none;
}
.btn-query {
  background: #2563eb; color: #fff; border: none; border-radius: 0.375rem;
  width: 32px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.btn-query:hover { background: #1d4ed8; }

/* Results list */
.result-list { display: flex; flex-direction: column; gap: 0.25rem; }
.result-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.3rem 0; cursor: pointer; border-radius: 0.25rem;
}
.result-row:hover { background: #f8fafc; }
.result-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-stand  { background: #0891b2; }
.dot-zone   { background: #a78bfa; }
.dot-poi    { background: #16a34a; }
.dot-ward   { background: #3b82f6; }
.dot-place, .dot-farm, .dot-parcel { background: #94a3b8; }
.result-text { display: flex; flex-direction: column; min-width: 0; }
.result-label { font-size: 0.8125rem; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-sub { font-size: 0.7rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.legend-items { display: flex; flex-direction: column; gap: 0.375rem; }
.legend-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.775rem; color: #374151; }
.legend-swatch { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.85; }
.panel-btn {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.375rem;
  padding: 0.5rem 0.625rem; font-size: 0.8125rem; color: #374151;
  cursor: pointer; text-align: left; margin-bottom: 0.375rem; transition: all 0.15s;
}
.panel-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
.panel-btn.accent { background: #fef2f2; border-color: #fecaca; color: #dc2626; }
.panel-btn.accent:hover { background: #fee2e2; }
.panel-empty { font-size: 0.775rem; color: #94a3b8; font-style: italic; }
.mini-report-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.25rem 0; cursor: pointer; font-size: 0.775rem; color: #374151;
}
.mini-report-row:hover { color: #0f172a; }
.mini-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mini-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-more { font-size: 0.75rem; color: #94a3b8; margin: 0.25rem 0 0; }

/* ── Map ──────────────────────────────────────────────────────────────── */
.map-container { flex: 1; position: relative; }
:deep(.maplibregl-canvas) { outline: none; }

/* Search dot markers injected by JS */
:deep(.search-dot) {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
:deep(.search-dot.dot-stand)  { background: #0891b2; }
:deep(.search-dot.dot-poi)    { background: #f43f5e; }
:deep(.search-dot.dot-zone)   { background: #a78bfa; }
:deep(.search-dot.dot-ward)   { background: #3b82f6; }
:deep(.search-dot.dot-place)  { background: #94a3b8; }

/* ── Info panel ───────────────────────────────────────────────────────── */
.info-panel {
  width: 280px; flex-shrink: 0; background: #ffffff;
  border-left: 1px solid #e2e8f0; padding: 1.25rem;
  overflow-y: auto; z-index: 5; position: relative;
}
.info-close {
  position: absolute; top: 0.875rem; right: 0.875rem;
  background: #f1f5f9; border: none; border-radius: 0.375rem;
  width: 28px; height: 28px; display: flex; align-items: center;
  justify-content: center; cursor: pointer; color: #64748b;
}
.info-close:hover { background: #e2e8f0; color: #0f172a; }
.info-tag {
  display: inline-block; font-size: 0.7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 0.2rem 0.5rem; border-radius: 99px; margin-bottom: 0.625rem;
}
.info-title { font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0 0 1rem; }
.info-fields { display: flex; flex-direction: column; gap: 0.75rem; }
.info-field-label {
  font-size: 0.7rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.125rem;
}
.info-field-value { font-size: 0.875rem; color: #0f172a; margin: 0; }
.info-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.25rem; }
.info-action-btn {
  background: #2563eb; color: #fff; border: none; border-radius: 0.5rem;
  padding: 0.5rem 0.875rem; font-size: 0.8125rem; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.info-action-btn:hover { background: #1d4ed8; }

.slide-in-enter-active, .slide-in-leave-active { transition: transform 0.22s ease, opacity 0.22s; }
.slide-in-enter-from, .slide-in-leave-to { transform: translateX(20px); opacity: 0; }

/* ── Report-here modal ────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: flex-end; justify-content: center;
  padding: 0 0 2rem; z-index: 1000;
}
.rh-modal {
  background: #fff; border-radius: 1rem; padding: 1.25rem;
  width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.rh-header { display: flex; align-items: flex-start; gap: 0.75rem; margin-bottom: 0.875rem; }
.rh-icon { color: #dc2626; margin-top: 0.125rem; flex-shrink: 0; }
.rh-title { font-size: 0.9375rem; font-weight: 700; color: #0f172a; margin: 0 0 0.125rem; }
.rh-sub { font-size: 0.8125rem; color: #64748b; margin: 0; }
.rh-close-btn { margin-left: auto; background: none; border: none; cursor: pointer; color: #94a3b8; flex-shrink: 0; }
.rh-coords {
  display: flex; align-items: center; gap: 0.5rem;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem;
  padding: 0.5rem 0.75rem; font-size: 0.8125rem; color: #374151;
  margin-bottom: 0.875rem; font-family: monospace;
}
.rh-pin { color: #dc2626; flex-shrink: 0; }
.rh-no-coord { color: #94a3b8; font-style: italic; font-family: inherit; }
.rh-types { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.rh-type-btn {
  display: flex; align-items: center; gap: 0.5rem;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem;
  padding: 0.625rem 0.75rem; font-size: 0.8125rem; color: #374151;
  cursor: pointer; transition: all 0.15s; text-align: left;
}
.rh-type-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #cbd5e1; }
.rh-type-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rh-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

/* ── Toast ────────────────────────────────────────────────────────────── */
.toast {
  position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
  padding: 0.625rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem;
  font-weight: 600; z-index: 2000; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.toast.success { background: #dcfce7; color: #166534; }
.toast.error   { background: #fef2f2; color: #991b1b; }
.toast.info    { background: #eff6ff; color: #1e40af; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.3s, transform 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* ═══════════════════════════════════════════════════════════════════════
   RESPONSIVE (Phase 12)
   This view previously had no media queries at all: a 220px tools rail, a
   280px property panel and a map, side by side, on every device. At 375px
   that leaves the map −125px of width.

   The strategy below is map-first, not shrink-first. Nothing is deleted; the
   panels change what kind of box they are.
   ═══════════════════════════════════════════════════════════════════════ */

/* Full-height container that does not jump when mobile browser chrome
   retracts. The 100vh above is kept as the fallback for engines without dvh. */
.gis-view { height: var(--ent-vh); }

/* Shared sheet grabber: purely a visual affordance saying "this panel came
   from the bottom edge and can be dismissed". Every dismiss it implies is
   also on a real button. */
.panel-grab {
  display: block; width: 36px; height: 4px; margin: 10px auto 4px;
  border-radius: 999px; background: #cbd5e1; flex-shrink: 0;
}

.panel-sheet-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0 0.875rem 0.5rem; border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
}
.panel-sheet-head .panel-grab { flex-basis: 100%; margin-bottom: 6px; }
.panel-sheet-title {
  flex: 1; margin: 0; font-size: 0.875rem; font-weight: 600; color: #0f172a;
}
.panel-sheet-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 0.375rem;
  background: transparent; color: #64748b; cursor: pointer;
}
.panel-sheet-close:hover { background: #f1f5f9; color: #0f172a; }
.panel-sheet-close:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }

/* Floating tools control. Bottom-LEFT: MapLibre puts zoom and compass at the
   top-right, and the property sheet occupies the bottom, so the left corner
   is the only spot that never collides. */
.tools-fab {
  position: absolute; left: 0.875rem;
  bottom: calc(0.875rem + var(--ent-safe-bottom));
  z-index: 15;
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px;
  border: 1px solid #cbd5e1; border-radius: 999px;
  background: #ffffff; color: #0f172a;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
  cursor: pointer;
}
.tools-fab:active { background: #f1f5f9; }
.tools-fab:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }

/* ── Tablet: 768–1023 ─────────────────────────────────────────────────────
   Both panels lift off the layout and float over the map, so the map keeps
   its full width instead of being squeezed to ~250px on an iPad in portrait.
   The rail narrows; the property panel narrows less, because it is showing
   label/value pairs that wrap badly. */
@media (max-width: 1023px) {
  .gis-body { position: relative; }
  .gis-panel {
    position: absolute; top: 0; bottom: 0; left: 0;
    width: 200px; z-index: 12;
    box-shadow: 2px 0 12px rgba(15, 23, 42, 0.12);
  }
  .info-panel {
    position: absolute; top: 0; bottom: 0; right: 0;
    width: 260px; z-index: 12;
    box-shadow: -2px 0 12px rgba(15, 23, 42, 0.12);
  }
  .search-wrap { max-width: 340px; }
}

/* ── Mobile: ≤767 ─────────────────────────────────────────────────────────
   Map-first. Both panels become bottom sheets over a live map.

   58dvh, not 100: the remaining 42% keeps the selected parcel, the ward
   outline and the user's own location visible, which is the entire reason an
   officer is looking at a map rather than a register. */
@media (max-width: 767px) {
  .gis-header {
    height: auto; min-height: 52px; flex-wrap: wrap;
    padding: 0.5rem calc(0.75rem + var(--ent-safe-right))
             0.5rem calc(0.75rem + var(--ent-safe-left));
    row-gap: 0.5rem;
  }
  /* Search takes the full second row rather than competing with Back and the
     layer pills for a 375px line. */
  .search-wrap { order: 3; flex: 1 0 100%; max-width: none; min-width: 0; }
  .header-actions { order: 2; flex: 1; min-width: 0; }
  .back-btn { order: 1; }

  /* Suggestions drop over the map, not inside the header's own stacking
     context, so they are not clipped by the header's overflow. */
  .search-dropdown { z-index: 200; max-height: 50dvh; overflow-y: auto; }

  .gis-body { position: relative; }

  /* Both sheets share one geometry. */
  .gis-panel,
  .info-panel {
    position: absolute; left: 0; right: 0; bottom: 0; top: auto;
    width: 100%; height: 58dvh; max-height: 58dvh;
    z-index: 14;
    border: none; border-top: 1px solid #e2e8f0;
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -8px 28px rgba(15, 23, 42, 0.22);
    padding-bottom: var(--ent-safe-bottom);
    overflow-y: auto; overscroll-behavior: contain;
  }

  /* The tools sheet is dismissed by default and slides up on request. It
     stays in the DOM so the query field keeps whatever the officer typed
     between openings; aria-hidden and the translate keep it out of the tab
     order and off the screen meanwhile. */
  .gis-panel {
    transform: translateY(100%);
    visibility: hidden;
    transition: transform var(--ent-dur-sheet) var(--ent-ease-sheet),
                visibility 0s linear var(--ent-dur-sheet);
  }
  .gis-panel.is-open {
    transform: translateY(0);
    visibility: visible;
    transition: transform var(--ent-dur-sheet) var(--ent-ease-sheet),
                visibility 0s;
  }

  /* The property sheet is mounted only while a feature is selected, so it
     animates through the existing slide-in Transition — retargeted from a
     horizontal slide to a vertical one, because on a phone it arrives from
     the bottom edge, not the right. */
  .info-panel { padding: 0 1rem 1rem; }
  .info-close { top: 0.5rem; right: 0.75rem; }
  .slide-in-enter-from, .slide-in-leave-to { transform: translateY(100%); }

  /* Report-here: a centred 480px dialog on a 375px screen is a card with
     16px of scrim either side. Full-width sheet instead, actions stacked. */
  .modal-backdrop { align-items: flex-end; padding: 0; }
  .rh-modal {
    width: 100%; max-width: 100%;
    border-radius: 14px 14px 0 0;
    padding-bottom: calc(1.25rem + var(--ent-safe-bottom));
    max-height: 88dvh; overflow-y: auto;
  }
  .rh-types { grid-template-columns: 1fr; }

  /* The toast clears the sheet edge and the home indicator. */
  .toast { bottom: calc(1.5rem + var(--ent-safe-bottom)); max-width: calc(100% - 2rem); }
}

/* Honour reduced motion for the sheet, which travels the full height of the
   viewport — the largest movement in this view. */
@media (prefers-reduced-motion: reduce) {
  .gis-panel { transition: visibility 0s !important; transform: none !important; }
  .gis-panel:not(.is-open) { visibility: hidden; display: none; }
}
</style>
