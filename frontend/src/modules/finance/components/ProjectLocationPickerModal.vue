<script setup lang="ts">
/**
 * Pick a capital project's point on the map (audit M5-5).
 *
 * WHY THE NUMERIC INPUTS STAY
 * The two decimal boxes in the project form are the audit-friendly record and the only way to enter
 * a GPS fix read off a handset in the field. This modal does not replace them: it writes them, and
 * they write the marker. One source of truth, two editors.
 *
 * WHAT IT REUSES
 * The pattern is `src/components/StandPickerModal.vue` — `addVunguBasemap`, the debounced
 * `/api/map-search` name lookup, a draggable `maplibregl.Marker`, and a reduced-motion guard on the
 * camera. It deliberately does not reuse the orphaned GMS map workspace, which the audit flags as
 * dead code.
 *
 * WHAT IT WILL NOT DO
 * It will not guess. Without a click there is no point: a project is never dropped at the map
 * centre, at a ward centroid or at the council's offices, because an invented coordinate is
 * indistinguishable from a surveyed one once it is in the register. It also does not validate the
 * point against the district — the server records a point outside the jurisdiction with a flag
 * rather than refusing or moving it — but it does say which of the council's wards the point falls
 * in, read off the ward polygons the finance map already serves, so a transposed pair is visible
 * before it is saved.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Check, Crosshair, Info, Search, X } from 'lucide-vue-next'
import { addVunguBasemap, PLANNER_BASEMAP_DEFAULT, prefersReducedMotion } from '@/map/vunguBasemap'
import { searchMap, type SearchResult } from '@/services/vectorTiles'
import { baseMapStyle } from '@/map/vunguBasemapStyle'
import { financeApi } from '../api/financeApi'
import type { WardGeometryData } from '../api/financeApi'

const props = defineProps<{
  open: boolean
  /** The coordinates the form already holds, as the form holds them: decimal strings. */
  longitude: string
  latitude: string
  reference?: string | null
}>()

const emit = defineEmits<{
  close: []
  /** Six decimal places: ~0.1 m, finer than any handheld fix and stable in a text field. */
  pick: [{ longitude: string; latitude: string; wardCode: string | null }]
}>()

const mapEl = ref<HTMLDivElement | null>(null)
let map: maplibregl.Map | null = null
let marker: maplibregl.Marker | null = null

const point = ref<{ lon: number; lat: number } | null>(null)
const wardCode = ref<string | null>(null)
const wardName = ref<string | null>(null)
const query = ref('')
const results = ref<SearchResult[]>([])
const geometry = ref<WardGeometryData | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const WARD_SOURCE = 'proj-pick-wards'
const WARD_LINE = 'proj-pick-wards-line'
const WARD_FILL = 'proj-pick-wards-fill'

function fmt(value: number): string {
  return value.toFixed(6)
}

/**
 * Which of the council's wards contains the point.
 *
 * Ray casting over the polygons the finance map already loads, so no request is made per click and
 * no new endpoint is needed. It is a STATEMENT ABOUT THE DISPLAY, never a validation: the answer is
 * shown to the officer, and "outside the council's wards" does not stop the pick, because a point
 * can be right and a provisional ward list wrong.
 */
function wardAt(lon: number, lat: number): { code: string; name: string | null } | null {
  for (const feature of geometry.value?.features ?? []) {
    const g = feature.geometry as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon | null
    if (!g) continue
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const rings of polygons) {
      if (pointInRing(lon, lat, rings[0] as number[][])) {
        return { code: feature.properties.ward_code, name: feature.properties.name ?? null }
      }
    }
  }
  return null
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (((yi > lat) !== (yj > lat))
        && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function place(lon: number, lat: number): void {
  point.value = { lon, lat }
  const ward = wardAt(lon, lat)
  wardCode.value = ward?.code ?? null
  wardName.value = ward?.name ?? null
  if (!map) return
  if (marker) marker.setLngLat([lon, lat])
  else {
    marker = new maplibregl.Marker({ color: '#1a73e8', draggable: true })
      .setLngLat([lon, lat])
      .addTo(map)
    marker.on('dragend', () => {
      const at = marker!.getLngLat()
      place(at.lng, at.lat)
    })
  }
}

function clear(): void {
  point.value = null
  wardCode.value = null
  wardName.value = null
  marker?.remove()
  marker = null
}

async function initMap(): Promise<void> {
  if (map || !mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    // Without an explicit style the map never fires `load`, so nothing below ever runs:
    // no basemap, no ward polygons, a transparent canvas (see baseMapStyle).
    style: baseMapStyle(),
    center: [29.95, -19.15],
    zoom: 8.4,
    attributionControl: { compact: true },
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl(), 'bottom-right')
  map.on('load', async () => {
    await addVunguBasemap(map!, { defaultVisible: PLANNER_BASEMAP_DEFAULT })
    map!.addSource(WARD_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
    })
    // The council's wards as a reference outline only. It is a locating aid, not a measure, so it
    // carries no finance colour: the choropleth ramp belongs to a map that is showing a figure.
    map!.addLayer({
      id: WARD_FILL, type: 'fill', source: WARD_SOURCE,
      paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.05 },
    })
    map!.addLayer({
      id: WARD_LINE, type: 'line', source: WARD_SOURCE,
      paint: { 'line-color': '#1f2937', 'line-width': 1, 'line-opacity': 0.5 },
    })
    await loadWards()
    seedFromForm()
  })
  map.on('click', (e) => place(e.lngLat.lng, e.lngLat.lat))
}

async function loadWards(): Promise<void> {
  try {
    geometry.value = await financeApi.mapWardGeometry()
  } catch {
    geometry.value = null // The picker still works; it simply cannot name the ward.
  }
  const features = (geometry.value?.features ?? [])
    .filter((f) => f.geometry)
    .map((f) => ({
      type: 'Feature' as const,
      properties: { ward_code: f.properties.ward_code },
      geometry: f.geometry as unknown as GeoJSON.Geometry,
    }))
  const source = map?.getSource(WARD_SOURCE) as maplibregl.GeoJSONSource | undefined
  source?.setData({ type: 'FeatureCollection', features })
  if (features.length > 0 && !point.value) {
    const bounds = new maplibregl.LngLatBounds()
    for (const f of features) {
      const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const rings of polygons) {
        for (const c of rings[0] as number[][]) bounds.extend(c as [number, number])
      }
    }
    if (!bounds.isEmpty()) {
      map?.fitBounds(bounds, {
        padding: 40, maxZoom: 11,
        duration: prefersReducedMotion() ? 0 : 700,
      })
    }
  }
}

/** The form's own coordinates become the marker, so the modal opens on what is already recorded. */
function seedFromForm(): void {
  const lon = Number(props.longitude)
  const lat = Number(props.latitude)
  if (props.longitude !== '' && props.latitude !== ''
      && Number.isFinite(lon) && Number.isFinite(lat)) {
    place(lon, lat)
    map?.flyTo({ center: [lon, lat], zoom: 13, duration: prefersReducedMotion() ? 0 : 700 })
  }
}

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    try { results.value = await searchMap(query.value) } catch { results.value = [] }
  }, 250)
}

function pickResult(r: SearchResult): void {
  results.value = []
  query.value = r.label
  map?.flyTo({ center: r.center, zoom: 14, duration: prefersReducedMotion() ? 0 : 700 })
  // A search result locates the CAMERA, not the project: the officer still places the point. A
  // place name is the name of an area, and a project is not at the centroid of its village.
}

function confirm(): void {
  if (!point.value) return
  emit('pick', {
    longitude: fmt(point.value.lon),
    latitude: fmt(point.value.lat),
    wardCode: wardCode.value,
  })
}

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  await initMap()
  map?.resize()
  if (map?.loaded()) seedFromForm()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  marker?.remove()
  map?.remove()
  map = null
})

defineExpose({ place, wardAt })
</script>

<template>
  <div v-if="open" class="plp" role="dialog" aria-modal="true"
       aria-label="Pick the project's location on the map" tabindex="-1"
       @keydown.esc="emit('close')">
    <div class="plp-sheet">
      <header class="plp-head">
        <div>
          <h2>Pick the project's location</h2>
          <p class="ins-hint">
            Click the map to place the point{{ reference ? ` for ${reference}` : '' }}, or drag the
            marker. Nothing is recorded until you use it: a project is never placed at the map
            centre or at a ward centroid.
          </p>
        </div>
        <button type="button" class="fin-btn small" @click="emit('close')">
          <X :size="14" aria-hidden="true" /> Close
        </button>
      </header>

      <div class="plp-search">
        <Search :size="15" aria-hidden="true" />
        <input v-model="query" class="ins-input" type="search" autocomplete="off"
               placeholder="Search a place to move the map"
               aria-label="Search a place name to move the map"
               @input="onSearchInput" />
        <ul v-if="results.length" class="plp-results">
          <li v-for="r in results" :key="`${r.label}-${r.center.join(',')}`">
            <button type="button" @click="pickResult(r)">{{ r.label }}</button>
          </li>
        </ul>
      </div>

      <div ref="mapEl" class="plp-map"
           aria-label="The council's wards; click to place the project's point"></div>

      <footer class="plp-foot">
        <dl class="plp-facts">
          <dt>Longitude</dt>
          <dd>{{ point ? fmt(point.lon) : 'not picked' }}</dd>
          <dt>Latitude</dt>
          <dd>{{ point ? fmt(point.lat) : 'not picked' }}</dd>
          <dt>Falls in</dt>
          <dd>
            <template v-if="!point">—</template>
            <template v-else-if="wardCode">
              {{ wardCode }}{{ wardName ? ` — ${wardName}` : '' }}
            </template>
            <template v-else-if="geometry?.ward_register_linked">
              outside this council's wards
            </template>
            <template v-else>not known — the ward register is not linked (D11)</template>
          </dd>
        </dl>
        <p v-if="point && !wardCode && geometry?.ward_register_linked" class="ins-hint plp-warn">
          <Info :size="13" aria-hidden="true" />
          The point is outside the council's linked wards. It can still be recorded — the ward list
          is provisional and a point is not moved to fit it — but check the pair is not transposed.
        </p>
        <div class="plp-actions">
          <button v-if="point" type="button" class="fin-btn small" @click="clear">
            <Crosshair :size="13" aria-hidden="true" /> Clear the point
          </button>
          <button type="button" class="fin-btn" :disabled="!point" @click="confirm">
            <Check :size="14" aria-hidden="true" /> Use these coordinates
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.plp {
  position: fixed; inset: 0; z-index: 70; display: grid; place-items: center;
  background: rgba(15, 42, 74, 0.45); padding: 18px;
}
.plp-sheet {
  background: var(--ent-surface, #fff); border-radius: 12px; width: min(1040px, 100%);
  max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 16px;
}
.plp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.plp-head h2 { margin: 0 0 2px; font-size: 16px; }
.plp-head p { margin: 0; max-width: 62ch; }
.plp-search { position: relative; display: flex; align-items: center; gap: 7px; }
.plp-search .ins-input { flex: 1; }
.plp-results {
  position: absolute; top: 100%; left: 22px; right: 0; z-index: 2; margin: 2px 0 0; padding: 0;
  list-style: none; background: var(--ent-surface, #fff);
  border: 1px solid var(--ent-line, #d7dde5); border-radius: 8px; max-height: 220px; overflow: auto;
}
.plp-results button {
  display: block; width: 100%; text-align: left; border: 0; background: none;
  padding: 6px 10px; font: inherit; cursor: pointer;
}
.plp-results button:hover, .plp-results button:focus-visible { background: rgba(26, 115, 232, 0.08); }
.plp-map {
  height: min(54vh, 460px); border-radius: 10px;
  border: 1px solid var(--ent-line, #d7dde5); background: #eef2f6;
}
.plp-foot { display: flex; flex-direction: column; gap: 8px; }
.plp-facts {
  display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 3px 10px;
  margin: 0; font-size: 13px;
}
.plp-facts dt { color: var(--ent-text-muted, rgba(15, 42, 74, 0.72)); }
.plp-facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.plp-warn { display: flex; align-items: flex-start; gap: 5px; margin: 0; color: #7a5b00; }
.plp-actions { display: flex; gap: 8px; justify-content: flex-end; }
@media (max-width: 720px) {
  .plp-facts { grid-template-columns: auto 1fr; }
}
</style>
