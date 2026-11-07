<script setup lang="ts">
// Map & Discover — citizen-side spatial portal.
//
// Live data only (no synthetic POIs / wards / stands):
//   - vunguBasemap (PostGIS vector tiles)         → src/map/vunguBasemap.ts
//   - country-wide search (places, wards, POIs)   → GET /api/map-search
//   - council contact card                        → GET /api/council
//   - exact Vungu parcel boundaries                → GET /api/stands/polygons
//
// Chrome matches the Stitch "Map & Discover" design: a full-bleed map
// with a floating search + map tools + legend, a desktop "Land Discovery"
// right sidebar, a mobile bottom sheet of layer toggles, and a floating
// selected-parcel card.

import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap, setBasemapLayerVisible } from '@/map/vunguBasemap'
import { searchMap, type SearchResult } from '@/services/vectorTiles'
import { useCitizenCase } from '@/composables/useCitizenCase'
import api from '@/services/api'
import {
  Search, MapPin, FilePlus, Phone, Mail, Layers, X, Loader2,
  Plus, Minus, LocateFixed, Info, Map as MapIcon,
} from 'lucide-vue-next'

const router = useRouter()
const cc = useCitizenCase()

// ── Map setup ─────────────────────────────────────────────────────
const mapContainer = ref<HTMLDivElement | null>(null)
let map: maplibregl.Map | undefined
const mapLoading = ref(true)
const mapError = ref('')
const basemapLayers = ref(0)

const VUNGU_CENTER: [number, number] = [29.6, -19.45]
const reduceMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const blankStyle = {
  version: 8 as const,
  sources: {
    // Always-on OSM raster so the map is never a blank cream rectangle if
    // PostGIS tiles are down. Vungu vector layers paint on top when ready.
    'osm-fallback': {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#f5f3ee' } },
    { id: 'osm-fallback', type: 'raster' as const, source: 'osm-fallback', paint: { 'raster-opacity': 0.92 } },
  ],
  glyphs: '/fonts/{fontstack}/{range}.pbf',
}

let resizeObserver: ResizeObserver | undefined

function initMap() {
  if (map || !mapContainer.value) return
  mapError.value = ''
  map = new maplibregl.Map({
    container: mapContainer.value,
    style: blankStyle as any,
    center: VUNGU_CENTER,
    zoom: 8, minZoom: 5, maxZoom: 22,
    attributionControl: false,
  })
  // Compact attribution control (OSM credit) — the built-in control can't be
  // enabled via `attributionControl: true` (MapLibre's type only accepts
  // `false | AttributionControlOptions`), so we add the compact one the same
  // way every other map view in the app does.
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.on('load', async () => {
    try {
      const result = map ? await addVunguBasemap(map) : { layerCount: 0 }
      basemapLayers.value = result.layerCount
      if (result.layerCount === 0) {
        mapError.value = 'Council vector layers are not available right now. Showing OpenStreetMap underneath — check that the API and PostGIS tiles are running.'
      } else {
        // Fade OSM once we have real cadastral/zoning paint.
        try {
          map?.setPaintProperty('osm-fallback', 'raster-opacity', 0.25)
        } catch { /* style may have been replaced */ }
      }
      applyLayerToggles()
      void loadStandPolygons()
    } catch (err) {
      console.warn('[citizen map] basemap failed', err)
      mapError.value = 'Could not load the council basemap. The OpenStreetMap base is still usable for navigation.'
    } finally {
      mapLoading.value = false
      // Container often finishes layout after MapLibre measures — force a resize.
      requestAnimationFrame(() => map?.resize())
    }
  })
  // Spatial identify: click any stand polygon → sold/status + properties from Postgres.
  map.on('click', (e) => {
    void identifyStandAt(e.lngLat.lng, e.lngLat.lat, e.point)
  })
  map.getCanvas().style.cursor = 'crosshair'
  resizeObserver = new ResizeObserver(() => map?.resize())
  resizeObserver.observe(mapContainer.value)
}

function zoomIn() { map?.zoomIn({ duration: reduceMotion ? 0 : 200 }) }
function zoomOut() { map?.zoomOut({ duration: reduceMotion ? 0 : 200 }) }
function locate() {
  if (!map) return
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => map!.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 14, duration: reduceMotion ? 0 : 800 }),
      () => map!.flyTo({ center: VUNGU_CENTER, zoom: 9, duration: reduceMotion ? 0 : 600 }),
    )
  } else {
    map.flyTo({ center: VUNGU_CENTER, zoom: 9, duration: reduceMotion ? 0 : 600 })
  }
}

// ── Layer toggles (wired to real vunguBasemap layer ids) ────────────
interface LayerDef { key: keyof typeof layers.value; label: string; icon: any }
const layers = ref({
  wards: true, landuse: true, parcels: false, buildings: false,
  roads: true, places: true, stands: true, acua: false,
})
const LAYER_DEFS: LayerDef[] = [
  { key: 'wards',     label: 'Ward boundaries', icon: MapIcon },
  { key: 'landuse',   label: 'Land-use zoning', icon: Layers },
  { key: 'parcels',   label: 'Parcels (cadastre)', icon: MapIcon },
  { key: 'buildings', label: 'Buildings', icon: MapIcon },
  { key: 'roads',     label: 'Roads', icon: MapIcon },
  { key: 'places',    label: 'Places & facilities', icon: MapPin },
  { key: 'stands',    label: 'Vungu parcels', icon: MapIcon },
  { key: 'acua',      label: 'Acua 300 m² stands', icon: MapPin },
]
const LAYER_GROUPS: Record<string, string[]> = {
  wards: ['wards'], landuse: ['landuse'], parcels: ['vungu_parcels'],
  buildings: ['buildings'], roads: ['roads'], places: ['places_points', 'pois_points'],
}
function applyLayerToggles() {
  if (!map) return
  for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
    const on = (layers.value as Record<string, boolean>)[group]
    for (const id of ids) {
      try { setBasemapLayerVisible(map, id, !!on) } catch { /* layer absent at this zoom */ }
    }
  }
}
watch(layers, () => {
  applyLayerToggles()
  syncStandLayer()
  syncAcuaLayer()
}, { deep: true })

// ── Council contact card (real data) ──────────────────────────────
interface Council { name: string; type: string | null; address: string | null; telephone: string | null; email: string | null; application_fee: string | null }
const council = ref<Council | null>(null)
async function loadCouncil() {
  try { const r = await api.get('/council'); council.value = (r.data?.data ?? null) as Council | null }
  catch { council.value = null }
}

// ── Available stands (real data + map markers) ────────────────────
interface AvailableStand {
  id: string
  stand_number: string
  suburb_ward: string | null
  area_sqm: string | null
  zone: string | null
  status: string
  description: string | null
  longitude: number | null
  latitude: number | null
  sold?: boolean
  available?: boolean
  label?: string
  priceUsd?: number | null
  frontageM?: number | null
  depthM?: number | null
  useScale?: string | null
  allocation?: { referenceNo?: string; purpose?: string | null; allocatedAt?: string | null } | null
  cadastral?: boolean
  gid?: string | null
  nameCfu?: string | null
  areaHa?: string | null
  mapSheet?: string | null
}
const identifyLoading = ref(false)

const standCount = ref(0)

function standFromHit(props: Record<string, unknown>): AvailableStand {
  const name = props.name != null ? String(props.name) : ''
  const nameCfu = props.name_cfu != null ? String(props.name_cfu) : ''
  const status = props.status != null && String(props.status) !== '' ? String(props.status) : 'Unstated'
  return {
    id: String(props.gid || props.fid || ''),
    stand_number: String(props.label || name || props.gid || 'Parcel'),
    suburb_ward: props.district != null ? String(props.district) : null,
    area_sqm: null,
    zone: name && nameCfu && name !== nameCfu ? nameCfu : null,
    status,
    description: null,
    longitude: props.longitude != null ? Number(props.longitude) : null,
    latitude: props.latitude != null ? Number(props.latitude) : null,
    sold: false,
    available: false,
    label: status,
    cadastral: true,
    gid: props.gid != null ? String(props.gid) : null,
    nameCfu: nameCfu || null,
    areaHa: props.area_ha != null ? String(props.area_ha) : null,
    mapSheet: props.map_sheet != null ? String(props.map_sheet) : null,
  }
}

/** Exact vungu_parcels polygons. Demo layout stands are not drawn. */
async function loadStandPolygons() {
  if (!map) return
  try {
    const r = await api.get('/stands/polygons')
    const fc = r.data?.type === 'FeatureCollection' ? r.data : { type: 'FeatureCollection', features: [] }
    standCount.value = Array.isArray(fc.features) ? fc.features.length : 0
    if (map.getSource('stand-polygons')) {
      ;(map.getSource('stand-polygons') as maplibregl.GeoJSONSource).setData(fc)
    } else {
      map.addSource('stand-polygons', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'stand-polygons-fill',
        type: 'fill',
        source: 'stand-polygons',
        paint: {
          'fill-color': [
            'match', ['get', 'status'],
            'Commercial', '#c4a574',
            'City', '#7eb6d6',
            'Purchase', '#8fbf9f',
            'State Land', '#d4a0a0',
            'Resettlement', '#c9b6e4',
            'Communal', '#e6d48a',
            '#d9d3c7',
          ],
          'fill-opacity': 0.42,
        },
      })
      map.addLayer({
        id: 'stand-polygons-line',
        type: 'line',
        source: 'stand-polygons',
        paint: { 'line-color': '#3f3428', 'line-width': 1.15 },
      })
      map.addLayer({
        id: 'stand-polygons-label',
        type: 'symbol',
        source: 'stand-polygons',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-allow-overlap': false,
          'text-optional': true,
          'text-max-width': 10,
        },
        paint: {
          'text-color': '#1c1917',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      })
    }
    try { setBasemapLayerVisible(map, 'stands', false) } catch { /* demo stand tiles */ }
    try { setBasemapLayerVisible(map, 'vungu_parcels', false) } catch { /* same polygons, simplified in tiles */ }
    syncStandLayer()
  } catch (err) {
    console.warn('[citizen map] parcel polygons failed', err)
  }
}

function syncStandLayer() {
  if (!map) return
  const on = !!layers.value.stands
  for (const id of ['stand-polygons-fill', 'stand-polygons-line', 'stand-polygons-label']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
}

/** Click selects the Vungu parcel under the cursor. */
async function identifyStandAt(_lng: number, _lat: number, point?: { x: number; y: number }) {
  identifyLoading.value = true
  try {
    if (!map || !point || !map.getLayer('stand-polygons-fill')) {
      selectedStand.value = null
      return
    }
    const hits = map.queryRenderedFeatures([point.x, point.y], { layers: ['stand-polygons-fill'] })
    selectedStand.value = hits[0]?.properties
      ? standFromHit(hits[0].properties as Record<string, unknown>)
      : null
  } finally {
    identifyLoading.value = false
  }
}

/** Acua ~300 m² sub-unit polygons (GeoJSON overlay). */
let acuaLoaded = false
async function loadAcuaSubunits() {
  if (!map || acuaLoaded) return
  try {
    const r = await api.get('/stands/subunits', { params: { typology: 'acua_300', status: 'available,reserved,allocated' } })
    const fc = r.data?.type === 'FeatureCollection' ? r.data : { type: 'FeatureCollection', features: [] }
    if (map.getSource('acua-subunits')) {
      ;(map.getSource('acua-subunits') as maplibregl.GeoJSONSource).setData(fc)
    } else {
      map.addSource('acua-subunits', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'acua-subunits-fill',
        type: 'fill',
        source: 'acua-subunits',
        paint: {
          'fill-color': [
            'match', ['get', 'status'],
            'available', '#2a9d8f',
            'reserved', '#e9c46a',
            'allocated', '#e76f51',
            '#94a3b8',
          ],
          'fill-opacity': 0.45,
        },
      })
      map.addLayer({
        id: 'acua-subunits-line',
        type: 'line',
        source: 'acua-subunits',
        paint: { 'line-color': '#0b5f4b', 'line-width': 1.2 },
      })
    }
    acuaLoaded = true
    syncAcuaLayer()
  } catch { /* thin DB / migration not applied */ }
}
function syncAcuaLayer() {
  if (!map) return
  const on = !!layers.value.acua
  for (const id of ['acua-subunits-fill', 'acua-subunits-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
}

const selectedStand = ref<AvailableStand | null>(null)

// ── Search (country-wide) ────────────────────────────────────────
const search = ref('')
const searchResults = ref<SearchResult[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    searchResults.value = search.value.trim().length >= 2 ? await searchMap(search.value) : []
  }, 250)
}
function flyToResult(r: SearchResult) {
  searchResults.value = []
  search.value = r.label
  if (map) map.flyTo({ center: r.center, zoom: 15, duration: reduceMotion ? 0 : 800 })
}
function clearSearch() { search.value = ''; searchResults.value = [] }

function fmtAreaHa(s: string | null | undefined): string {
  if (!s) return '—'
  const n = Number(s)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ha' : s
}
function openApply() { router.push('/citizen?section=new') }

const sheetExpanded = ref(false)

onMounted(async () => {
  await nextTick()
  initMap()
  void loadCouncil()
  // Acua layer after map style is ready
  const tryAcua = () => { if (map?.isStyleLoaded()) void loadAcuaSubunits(); else map?.once('load', () => void loadAcuaSubunits()) }
  tryAcua()
  void (cc as unknown as { refreshApplications?: () => Promise<void> }).refreshApplications?.()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = undefined
  if (map) { map.remove(); map = undefined }
})
</script>

<template>
  <div class="ms">
    <!-- Map + overlays -->
    <div class="ms-map-wrap">
      <div ref="mapContainer" class="ms-map"></div>

      <!-- Floating search (mobile) -->
      <div class="ms-float-search">
        <div class="ms-search">
          <Search :size="18" />
          <input v-model="search" placeholder="Search address, parcel, or ward…" @input="onSearchInput" />
          <button v-if="search" class="ms-x" @click="clearSearch" aria-label="Clear"><X :size="16" /></button>
        </div>
        <ul v-if="searchResults.length" class="ms-results">
          <li v-for="(r, i) in searchResults" :key="i" @click="flyToResult(r)">
            <MapPin :size="13" />
            <span class="ms-r-text"><span class="ms-r-label">{{ r.label }}</span><span v-if="r.subtitle" class="ms-r-sub">{{ r.subtitle }}</span></span>
          </li>
        </ul>
      </div>

      <!-- Map tools -->
      <div class="ms-tools">
        <button class="ms-tool" @click="locate" title="My location"><LocateFixed :size="20" /></button>
        <div class="ms-tool-group">
          <button class="ms-tool" @click="zoomIn" title="Zoom in"><Plus :size="20" /></button>
          <button class="ms-tool" @click="zoomOut" title="Zoom out"><Minus :size="20" /></button>
        </div>
        <button class="ms-tool ms-tool-layers" @click="sheetExpanded = !sheetExpanded" title="Layers"><Layers :size="20" /></button>
      </div>

      <!-- Legend (desktop) -->
      <div class="ms-legend">
        <h3>Map legend</h3>
        <div class="ms-leg-row"><span class="ms-sw commercial"></span> Commercial</div>
        <div class="ms-leg-row"><span class="ms-sw city"></span> City</div>
        <div class="ms-leg-row"><span class="ms-sw purchase"></span> Purchase</div>
        <div class="ms-leg-row"><span class="ms-sw state"></span> State land</div>
        <div class="ms-leg-row"><span class="ms-sw other"></span> Other tenure</div>
      </div>

      <!-- Loading / error -->
      <div v-if="mapLoading" class="ms-map-loading"><Loader2 :size="16" class="ms-spin" /> Loading basemap…</div>
      <div v-else-if="mapError" class="ms-map-banner" role="status">
        <Info :size="14" />
        <span>{{ mapError }}</span>
        <span v-if="basemapLayers" class="ms-map-banner-meta">{{ basemapLayers }} council layers loaded</span>
      </div>

      <!-- Selected stand card (floating) — from polygon identify or list -->
      <transition name="ms-pop-fade">
        <div v-if="selectedStand || identifyLoading" class="ms-prop">
          <div v-if="identifyLoading && !selectedStand" class="ms-prop-head">
            <div><h3>Identifying…</h3><p>Looking up the parcel under the click</p></div>
          </div>
          <template v-else-if="selectedStand">
            <div class="ms-prop-head">
              <div>
                <h3>{{ selectedStand.stand_number }}</h3>
                <p>{{ selectedStand.mapSheet || selectedStand.suburb_ward || 'Vungu RDC' }}</p>
              </div>
              <button class="ms-prop-x" @click="selectedStand = null"><X :size="18" /></button>
            </div>
            <div class="ms-prop-grid">
              <div><label>Parcel id</label><p class="mono">{{ selectedStand.gid || '—' }}</p></div>
              <div><label>Area</label><p class="mono">{{ fmtAreaHa(selectedStand.areaHa) }}</p></div>
              <div>
                <label>Tenure</label>
                <span class="ms-prop-pill">{{ selectedStand.label || '—' }}</span>
              </div>
              <div v-if="selectedStand.zone">
                <label>Recorded as</label>
                <p>{{ selectedStand.zone }}</p>
              </div>
            </div>
          </template>
        </div>
      </transition>

      <!-- Mobile bottom sheet -->
      <div class="ms-sheet" :class="{ open: sheetExpanded }">
        <button class="ms-sheet-handle" @click="sheetExpanded = !sheetExpanded" aria-label="Toggle sheet"><span></span></button>
        <div class="ms-sheet-body">
          <div class="ms-sheet-head">
            <h2>Map layers &amp; discovery</h2>
            <p>Customise your view of Vungu RDC</p>
          </div>
          <div class="ms-layer-card">
            <label v-for="l in LAYER_DEFS" :key="l.key" class="ms-layer">
              <span class="ms-layer-l"><component :is="l.icon" :size="18" /> {{ l.label }}</span>
              <input type="checkbox" v-model="layers[l.key]" />
            </label>
          </div>
        </div>
        <div class="ms-sheet-foot">
          <button class="ms-btn primary full" @click="openApply"><FilePlus :size="18" /> Start an application here</button>
        </div>
      </div>
    </div>

    <!-- Desktop sidebar -->
    <aside class="ms-side">
      <div class="ms-side-head">
        <h1>Find land</h1>
        <p>Each shape is a Vungu parcel boundary from the cadastre. The name on it is the name stored with that parcel.</p>
      </div>
      <div class="ms-side-body">
        <!-- Search -->
        <div class="ms-field">
          <label>Search</label>
          <div class="ms-search inset">
            <Search :size="16" />
            <input v-model="search" placeholder="Stand, place or ward…" @input="onSearchInput" />
            <button v-if="search" class="ms-x" @click="clearSearch" aria-label="Clear"><X :size="14" /></button>
          </div>
          <ul v-if="searchResults.length" class="ms-results inset">
            <li v-for="(r, i) in searchResults" :key="i" @click="flyToResult(r)">
              <MapPin :size="12" />
              <span class="ms-r-text"><span class="ms-r-label">{{ r.label }}</span><span v-if="r.subtitle" class="ms-r-sub">{{ r.subtitle }}</span></span>
            </li>
          </ul>
        </div>

        <!-- Layers -->
        <div class="ms-field">
          <label>Map layers</label>
          <div class="ms-layer-card">
            <label v-for="l in LAYER_DEFS" :key="l.key" class="ms-layer">
              <span class="ms-layer-l"><component :is="l.icon" :size="18" /> {{ l.label }}</span>
              <input type="checkbox" v-model="layers[l.key]" />
            </label>
          </div>
        </div>

        <!-- Available stands -->
        <div class="ms-field">
          <label>Vungu parcels <span v-if="standCount" class="ms-count">{{ standCount }}</span></label>
          <p class="ms-muted">These are the stored parcel polygons. A shared name keeps the source parcel id so each one stays distinct.</p>
        </div>

        <!-- Market brief / council -->
        <div v-if="council" class="ms-brief">
          <div class="ms-brief-head"><Info :size="18" /><strong>{{ council.name }}</strong></div>
          <p v-if="council.address" class="ms-brief-line">{{ council.address }}</p>
          <p v-if="council.telephone" class="ms-brief-line"><Phone :size="12" /> {{ council.telephone }}</p>
          <p v-if="council.email" class="ms-brief-line"><Mail :size="12" /> <a :href="'mailto:' + council.email">{{ council.email }}</a></p>
          <p v-if="council.application_fee" class="ms-brief-fee">Standard application fee: USD {{ council.application_fee }}</p>
        </div>
      </div>
      <div class="ms-side-foot">
        <button class="ms-btn primary full" @click="openApply"><FilePlus :size="16" /> Apply for stand</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.ms { display:flex; height:100%; min-height:0; background:#f5f3ee; }
.mono { font-family:var(--cp-mono); }

/* Map */
.ms-map-wrap { position:relative; flex:1; min-width:0; }
.ms-map { position:absolute; inset:0; }
.ms-map-loading { position:absolute; top:12px; left:12px; z-index:6; display:inline-flex; align-items:center; gap:0.4rem;
  padding:0.4rem 0.8rem; background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-pill);
  font-size:0.78rem; color:var(--cp-text-2); box-shadow:var(--cp-shadow-pop); }
.ms-map-banner { position:absolute; top:12px; left:12px; right:12px; z-index:6; display:flex; flex-wrap:wrap; align-items:center; gap:0.45rem 0.75rem;
  max-width:min(520px, calc(100% - 24px)); padding:0.55rem 0.85rem; background:rgba(255,251,235,0.96);
  border:1px solid #f0d78c; border-radius:var(--cp-radius-sm); font-size:0.78rem; color:#7a5b12;
  box-shadow:var(--cp-shadow-pop); line-height:1.35; }
.ms-map-banner :deep(svg) { flex-shrink:0; color:#b8860b; }
.ms-map-banner span { flex:1; min-width:12rem; }
.ms-map-banner-meta { flex:0 0 auto !important; min-width:0 !important; font-size:0.7rem; font-weight:600;
  padding:0.15rem 0.5rem; border-radius:var(--cp-radius-pill); background:rgba(184,134,11,0.12); color:#7a5b12; }
.ms-spin { animation: ms-spin 0.8s linear infinite; }
@keyframes ms-spin { to { transform: rotate(360deg); } }

/* Search */
.ms-search { display:flex; align-items:center; gap:0.5rem; padding:0.5rem 0.8rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-pill); box-shadow:var(--cp-shadow); }
.ms-search.inset { border-radius:var(--cp-radius-sm); box-shadow:none; background:var(--cp-surface-2); }
.ms-search :deep(svg) { color:var(--cp-faint); flex-shrink:0; }
.ms-search:focus-within { outline:2px solid var(--cp-primary); outline-offset:2px; }
.ms-search input { flex:1; min-width:0; border:0; outline:none; background:transparent; font-size:0.85rem; color:var(--cp-text); }
.ms-x { border:0; background:transparent; color:var(--cp-faint); cursor:pointer; padding:2px; }
.ms-x:hover { color:var(--cp-text); }
.ms-results { position:absolute; left:0; right:0; top:calc(100% + 6px); margin:0; padding:4px; list-style:none;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); max-height:280px; overflow:auto;
  box-shadow:var(--cp-shadow-pop); z-index:8; }
.ms-results.inset { position:static; box-shadow:none; margin-top:4px; max-height:200px; }
.ms-results li { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; cursor:pointer; color:var(--cp-faint); }
.ms-results li:hover { background:var(--cp-surface-2); }
.ms-r-text { display:flex; flex-direction:column; min-width:0; line-height:1.25; }
.ms-r-label { font-size:0.82rem; color:var(--cp-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ms-r-sub { font-size:0.68rem; color:var(--cp-faint); }

.ms-float-search { position:absolute; top:14px; left:14px; right:14px; z-index:7; }

/* Map tools */
.ms-tools { position:absolute; right:14px; top:72px; z-index:6; display:flex; flex-direction:column; gap:0.5rem; }
.ms-tool { width:40px; height:40px; display:inline-flex; align-items:center; justify-content:center;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); color:var(--cp-text-2);
  box-shadow:var(--cp-shadow); cursor:pointer; }
.ms-tool:hover { background:var(--cp-surface-2); color:var(--cp-text); }
.ms-tool-group { display:flex; flex-direction:column; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); overflow:hidden; box-shadow:var(--cp-shadow); }
.ms-tool-group .ms-tool { border:0; border-radius:0; box-shadow:none; }
.ms-tool-group .ms-tool:first-child { border-bottom:1px solid var(--cp-border); }
.ms-tool-layers { display:none; }

/* Legend */
.ms-legend { position:absolute; left:14px; bottom:14px; z-index:6; width:11rem; padding:0.75rem;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); }
.ms-legend h3 { margin:0 0 0.5rem; font-size:0.62rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); }
.ms-leg-row { display:flex; align-items:center; gap:0.5rem; font-size:0.78rem; color:var(--cp-text-2); margin-bottom:0.3rem; }
.ms-sw { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
.ms-sw.commercial { background:#c4a574; border:1px solid #3f3428; }
.ms-sw.city { background:#7eb6d6; border:1px solid #1e4d6b; }
.ms-sw.purchase { background:#8fbf9f; border:1px solid #1f6b3a; }
.ms-sw.state { background:#d4a0a0; border:1px solid #7a3030; }
.ms-sw.other { background:#e6d48a; border:1px solid #6b5420; }

/* Selected parcel card */
.ms-prop { position:absolute; right:14px; bottom:14px; z-index:9; width:20rem; max-width:calc(100% - 28px);
  background:var(--cp-surface); border:1px solid var(--cp-primary-tint-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow-pop); padding:1rem; }
.ms-prop-head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:0.85rem; }
.ms-prop-head h3 { margin:0; font-size:1.1rem; font-weight:700; color:var(--cp-text); }
.ms-prop-head p { margin:0.1rem 0 0; font-size:0.78rem; color:var(--cp-muted); }
.ms-prop-x { border:0; background:none; color:var(--cp-muted); cursor:pointer; padding:0.2rem; }
.ms-prop-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:0.5rem; margin-bottom:0.75rem; }
.ms-prop-grid > div { padding:0.5rem; background:var(--cp-surface-2); border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); }
.ms-prop-grid label { display:block; font-size:0.56rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-faint); margin-bottom:0.2rem; }
.ms-prop-grid p { margin:0; font-size:0.8rem; font-weight:600; color:var(--cp-text); }
.ms-prop-grid p.pri { color:var(--cp-primary); }
.ms-prop-pill { display:inline-block; padding:0.1rem 0.4rem; border-radius:var(--cp-radius-sm); background:var(--cp-green-bg); color:var(--cp-green-fg); font-size:0.58rem; font-weight:700; text-transform:uppercase; }
.ms-prop-pill.sold { background:#fee2e2; color:#991b1b; }
.ms-prop-pill.avail { background:var(--cp-green-bg); color:var(--cp-green-fg); }
.ms-prop-desc { margin:0 0 0.75rem; font-size:0.78rem; color:var(--cp-text-2); line-height:1.5; }
.ms-pop-fade-enter-active, .ms-pop-fade-leave-active { transition:opacity .2s, transform .2s; }
.ms-pop-fade-enter-from, .ms-pop-fade-leave-to { opacity:0; transform:translateY(8px); }

/* Buttons */
.ms-btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.6rem 1rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm); font-size:0.82rem; font-weight:600; cursor:pointer; }
.ms-btn.primary { background:var(--cp-primary); color:var(--cp-on-primary); }
.ms-btn.primary:hover { background:var(--cp-primary-hover); }
.ms-btn.full { width:100%; }

/* Layer toggle list */
.ms-layer-card { border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); overflow:hidden; background:var(--cp-surface); }
.ms-layer { display:flex; align-items:center; justify-content:space-between; padding:0.65rem 0.8rem; border-bottom:1px solid var(--cp-border); cursor:pointer; }
.ms-layer:last-child { border-bottom:0; }
.ms-layer:hover { background:var(--cp-surface-2); }
.ms-layer-l { display:inline-flex; align-items:center; gap:0.6rem; font-size:0.82rem; color:var(--cp-text); }
.ms-layer-l :deep(svg) { color:var(--cp-muted); }
.ms-layer input { accent-color:var(--cp-primary); width:16px; height:16px; }

/* Mobile bottom sheet */
.ms-sheet { position:absolute; left:0; right:0; bottom:0; z-index:8; display:flex; flex-direction:column;
  background:var(--cp-surface); border-top:1px solid var(--cp-border); border-top-left-radius:16px; border-top-right-radius:16px;
  box-shadow:0 -2px 12px rgba(15,23,42,0.08); max-height:42%; transition:max-height .3s ease; }
.ms-sheet.open { max-height:80%; }
.ms-sheet-handle { display:flex; justify-content:center; padding:0.6rem; border:0; background:none; cursor:grab; }
.ms-sheet-handle span { width:40px; height:5px; border-radius:9999px; background:var(--cp-border-strong); }
.ms-sheet-body { flex:1; overflow-y:auto; padding:0 1rem; }
.ms-sheet-head h2 { margin:0; font-size:1rem; font-weight:600; color:var(--cp-text); }
.ms-sheet-head p { margin:0.15rem 0 0.85rem; font-size:0.8rem; color:var(--cp-muted); }
.ms-sheet-foot { padding:0.85rem 1rem calc(0.85rem + env(safe-area-inset-bottom)); border-top:1px solid var(--cp-border); }

/* Desktop sidebar */
.ms-side { display:none; width:21rem; flex-shrink:0; flex-direction:column; min-height:0;
  background:var(--cp-surface); border-left:1px solid var(--cp-border); }
.ms-side-head { padding:1.25rem; border-bottom:1px solid var(--cp-border); }
.ms-side-head h1 { margin:0; font-size:1.2rem; font-weight:700; color:var(--cp-text); }
.ms-side-head p { margin:0.2rem 0 0; font-size:0.8rem; color:var(--cp-text-2); }
.ms-side-body { flex:1; overflow-y:auto; padding:1.25rem; display:flex; flex-direction:column; gap:1.25rem; }
.ms-side-foot { padding:1rem 1.25rem; border-top:1px solid var(--cp-border); }
.ms-field { position:relative; display:flex; flex-direction:column; gap:0.4rem; }
.ms-field > label { font-size:0.64rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); display:flex; align-items:center; gap:0.4rem; }
.ms-count { padding:0.05rem 0.4rem; border-radius:var(--cp-radius-pill); background:var(--cp-primary-tint); color:var(--cp-primary); font-size:0.62rem; }

/* Stand list */
.ms-stand-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.5rem; }
.ms-stand { border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); padding:0.7rem 0.8rem; background:var(--cp-surface); }
.ms-stand-top { display:flex; align-items:center; justify-content:space-between; gap:0.4rem; }
.ms-stand-top strong { font-size:0.85rem; color:var(--cp-text); }
.ms-zone { padding:0.1rem 0.45rem; border-radius:var(--cp-radius-pill); background:var(--cp-surface-2); color:var(--cp-muted); font-size:0.6rem; font-weight:700; text-transform:uppercase; }
.ms-stand-meta { margin:0.3rem 0; font-size:0.74rem; color:var(--cp-muted); }
.ms-stand-actions { display:flex; gap:0.4rem; }
.ms-link { display:inline-flex; align-items:center; gap:0.25rem; padding:0.3rem 0.55rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm);
  background:var(--cp-surface-2); font-size:0.72rem; font-weight:600; color:var(--cp-text-2); cursor:pointer; }
.ms-link:hover { background:var(--cp-surface); }
.ms-link.primary { background:var(--cp-primary); color:var(--cp-on-primary); border-color:var(--cp-primary); }
.ms-muted { display:inline-flex; align-items:center; gap:0.4rem; color:var(--cp-faint); font-size:0.8rem; }

/* Market brief */
.ms-brief { padding:0.9rem 1rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface-2); }
.ms-brief-head { display:flex; align-items:center; gap:0.45rem; margin-bottom:0.5rem; }
.ms-brief-head :deep(svg) { color:var(--cp-primary); }
.ms-brief-head strong { font-size:0.85rem; color:var(--cp-text); }
.ms-brief-line { margin:0.2rem 0; font-size:0.78rem; color:var(--cp-text-2); display:flex; align-items:center; gap:0.35rem; }
.ms-brief-line a { color:var(--cp-primary); text-decoration:none; }
.ms-brief-fee { margin:0.4rem 0 0; font-size:0.78rem; font-weight:600; color:var(--cp-text); }

/* ── Responsive ───────────────────────────────────────────────────── */
@media (min-width: 1024px) {
  .ms-float-search { display:none; }
  .ms-sheet { display:none; }
  .ms-side { display:flex; }
}
@media (max-width: 1023px) {
  .ms-legend { display:none; }
  .ms-tools { top:84px; }
  .ms-tool-layers { display:inline-flex; }
}
</style>
