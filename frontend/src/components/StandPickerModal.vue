<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { searchMap, type SearchResult } from '@/services/vectorTiles'
import { locateStand, type StandLocation } from '@/services/parcels'
import { ArrowLeft, Search, X, Loader2, MapPin, Check, TriangleAlert } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; select: [StandLocation] }>()

const mapEl = ref<HTMLDivElement>()
let map: maplibregl.Map | undefined
let marker: maplibregl.Marker | undefined

const loading = ref(false)
const location = ref<StandLocation | null>(null)
const query = ref('')
const results = ref<SearchResult[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined

const reduceMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const blankStyle = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#f5f3ee' } }],
  glyphs: '/fonts/{fontstack}/{range}.pbf',
}

function initMap() {
  if (map || !mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: blankStyle as any,
    center: [29.6, -19.45],
    zoom: 8, minZoom: 5, maxZoom: 22,
    attributionControl: false,
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl(), 'bottom-right')
  map.on('load', () => { if (map) addVunguBasemap(map) })
  map.on('click', (e: maplibregl.MapMouseEvent) => { void selectPoint(e.lngLat.lng, e.lngLat.lat) })
}

async function selectPoint(lng: number, lat: number) {
  loading.value = true
  if (marker) marker.remove()
  if (map) marker = new maplibregl.Marker({ color: '#1a73e8' }).setLngLat([lng, lat]).addTo(map)
  try {
    const res = await locateStand(lng, lat)
    await applyLocation(res)
  } catch {
    location.value = null
  } finally {
    loading.value = false
  }
}

// Exposed for tests + reused by selectPoint.
async function applyLocation(res: StandLocation) {
  location.value = res
}
defineExpose({ applyLocation })

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => { results.value = await searchMap(query.value) }, 250)
}

function clearSearch() { query.value = ''; results.value = [] }

function pickResult(r: SearchResult) {
  results.value = []
  query.value = r.label
  if (map) map.flyTo({ center: r.center, zoom: 15, duration: reduceMotion ? 0 : 800 })
  void selectPoint(r.center[0], r.center[1])
}

function clearSelection() {
  location.value = null
  if (marker) { marker.remove(); marker = undefined }
}

function fmtArea(ha: number | null): string {
  if (ha == null) return 'Area not recorded'
  return `${ha.toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`
}

const canConfirm = () => Boolean(location.value?.in_jurisdiction && location.value?.stand)

function confirm() {
  if (location.value && canConfirm()) emit('select', location.value)
}

function close() { emit('close') }

watch(() => props.open, async (open) => {
  if (open) { await nextTick(); initMap(); map?.resize() }
})

onBeforeUnmount(() => { if (map) { map.remove(); map = undefined } })
</script>

<template>
  <div v-if="open" class="sp" role="dialog" aria-modal="true" aria-label="Find the stand on the map"
       @keydown.esc="close" tabindex="-1">
    <div ref="mapEl" class="sp-map"></div>

    <!-- Top-left: back + title + search. Map-first; chrome floats and stays small. -->
    <div class="sp-top">
      <div class="sp-bar">
        <button class="sp-back" @click="close" aria-label="Back to the form"><ArrowLeft :size="18" /></button>
        <div class="sp-bar-text">
          <span class="sp-eyebrow">Locate stand</span>
          <span class="sp-title">Find the stand on the map</span>
        </div>
      </div>

      <div class="sp-search-wrap">
        <div class="sp-search">
          <Search :size="16" class="sp-search-ic" />
          <input v-model="query" name="sp-search" autocomplete="off"
                 placeholder="Search a stand, place or district"
                 @input="onSearchInput" />
          <button v-if="query" class="sp-qclear" @click="clearSearch" aria-label="Clear search"><X :size="14" /></button>
        </div>
        <ul v-if="results.length" class="sp-results">
          <li v-for="(r, i) in results" :key="i" @click="pickResult(r)">
            <MapPin :size="14" class="sp-r-ic" />
            <span class="sp-r-text">
              <span class="sp-r-label">{{ r.label }}</span>
              <span v-if="r.subtitle" class="sp-r-sub">{{ r.subtitle }}</span>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Bottom-left: result of the last pick. Only present once something is selected. -->
    <div v-if="loading || location" class="sp-panel">
      <div v-if="loading" class="sp-loading"><Loader2 :size="16" class="sp-spin" /> Locating…</div>

      <template v-else-if="location">
        <!-- In jurisdiction, parcel found -->
        <div v-if="location.in_jurisdiction && location.stand">
          <span class="sp-flag sp-flag-ok"><Check :size="13" /> Within Vungu RDC</span>
          <h2 class="sp-stand">{{ location.stand.stand_number }}</h2>
          <dl class="sp-facts">
            <div><dt>Ward</dt><dd>{{ location.stand.ward || '—' }}</dd></div>
            <div><dt>District</dt><dd>{{ location.stand.district || '—' }}</dd></div>
            <div><dt>Parcel area</dt><dd>{{ fmtArea(location.stand.area_ha) }}</dd></div>
          </dl>
        </div>

        <!-- In jurisdiction, no parcel under the point -->
        <p v-else-if="location.in_jurisdiction" class="sp-hint">
          No registered parcel at this point. Tap directly on a parcel outline, or search by name.
        </p>

        <!-- Outside Vungu RDC -->
        <div v-else class="sp-notice">
          <TriangleAlert :size="18" class="sp-notice-ic" />
          <div>
            <p class="sp-notice-title">Outside Vungu RDC</p>
            <p class="sp-notice-body">
              <template v-if="location.district">
                This location is in {{ location.district }} district, outside Vungu RDC's jurisdiction.
                Vungu RDC cannot process applications here. Contact the local authority responsible
                for {{ location.district }}.
              </template>
              <template v-else>
                This location is outside Vungu RDC's jurisdiction.
              </template>
            </p>
          </div>
        </div>

        <div class="sp-actions">
          <button class="sp-btn ghost" @click="clearSelection">Clear</button>
          <button class="sp-btn primary" data-test="confirm" :disabled="!canConfirm()" @click="confirm">
            Use this stand
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sp { position: fixed; inset: 0; z-index: 1000; background: #f5f3ee; }
.sp-map { position: absolute; inset: 0; }

/* ── Top-left cluster ─────────────────────────────────────────────── */
.sp-top { position: absolute; top: 16px; left: 16px; z-index: 2;
  width: min(380px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 8px; }

.sp-bar { display: flex; align-items: center; gap: 10px;
  background: #ffffff; border: 1px solid #dadce0; border-radius: 10px;
  padding: 8px 12px 8px 8px; box-shadow: 0 4px 16px rgba(15,23,42,0.10); }
.sp-back { display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex-shrink: 0; border: none; border-radius: 8px;
  background: #f5f3ee; color: #3c4043; cursor: pointer; transition: background 0.15s ease; }
.sp-back:hover { background: #ece9e0; }
.sp-bar-text { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.sp-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: #9aa0a6; }
.sp-title { font-size: 15px; font-weight: 700; color: #3c4043; letter-spacing: -0.01em; }

.sp-search-wrap { position: relative; }
.sp-search { display: flex; align-items: center; gap: 8px;
  background: #ffffff; border: 1px solid #dadce0; border-radius: 10px;
  padding: 9px 10px; box-shadow: 0 4px 16px rgba(15,23,42,0.10); }
.sp-search:focus-within { border-color: #bdc1c6; }
.sp-search-ic { color: #9aa0a6; flex-shrink: 0; }
.sp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 15px; color: #3c4043; }
.sp-search input::placeholder { color: #9aa0a6; }
.sp-qclear { display: inline-flex; border: none; background: transparent; cursor: pointer;
  color: #9aa0a6; padding: 2px; border-radius: 4px; }
.sp-qclear:hover { color: #3c4043; background: #ece9e0; }

.sp-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; margin: 0;
  padding: 4px; list-style: none; background: #ffffff; border: 1px solid #dadce0;
  border-radius: 10px; max-height: 320px; overflow: auto;
  box-shadow: 0 8px 28px rgba(15,23,42,0.14); }
.sp-results li { display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 6px; cursor: pointer; }
.sp-results li:hover { background: #f5f3ee; }
.sp-r-ic { color: #9aa0a6; flex-shrink: 0; }
.sp-r-text { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
.sp-r-label { font-size: 14px; color: #3c4043; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-r-sub { font-size: 11px; color: #9aa0a6; }

/* ── Bottom-left result panel ─────────────────────────────────────── */
.sp-panel { position: absolute; left: 16px; bottom: 24px; z-index: 2;
  width: min(380px, calc(100vw - 32px));
  background: #ffffff; border: 1px solid #dadce0; border-radius: 10px;
  padding: 16px; box-shadow: 0 8px 28px rgba(15,23,42,0.14); }

.sp-loading { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #5a5a5a; }

.sp-flag { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
  font-weight: 600; letter-spacing: 0.02em; padding: 3px 8px; border-radius: 9999px; }
.sp-flag-ok { background: #e6f4ea; color: #1e8e3e; }

.sp-stand { margin: 10px 0 12px; font-size: 17px; line-height: 1.2; font-weight: 700;
  color: #3c4043; letter-spacing: -0.01em; }

.sp-facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.sp-facts dt { font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: #9aa0a6; margin-bottom: 2px; }
.sp-facts dd { margin: 0; font-size: 14px; color: #3c4043; }

.sp-hint { margin: 0; font-size: 14px; line-height: 1.45; color: #5a5a5a; }

.sp-notice { display: flex; gap: 10px; align-items: flex-start;
  background: #fef7e0; border: 1px solid #feefc3; border-radius: 8px; padding: 12px; }
.sp-notice-ic { color: #f9ab00; flex-shrink: 0; margin-top: 1px; }
.sp-notice-title { margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #3c4043; }
.sp-notice-body { margin: 0; font-size: 13px; line-height: 1.45; color: #5a5a5a; }

.sp-actions { display: flex; gap: 8px; margin-top: 16px; }
.sp-btn { font-size: 14px; font-weight: 600; padding: 9px 16px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent; transition: background 0.15s ease, border-color 0.15s ease; }
.sp-btn.ghost { background: #ffffff; border-color: #dadce0; color: #3c4043; }
.sp-btn.ghost:hover { background: #f5f3ee; }
.sp-btn.primary { flex: 1; background: #1a73e8; color: #ffffff; }
.sp-btn.primary:hover:not(:disabled) { background: #1557b0; }
.sp-btn.primary:disabled { background: #ece9e0; color: #9aa0a6; cursor: not-allowed; }

.sp-spin { animation: sp-spin 0.8s linear infinite; }
@keyframes sp-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .sp-back, .sp-btn { transition: none; }
  .sp-spin { animation: none; }
}
</style>
