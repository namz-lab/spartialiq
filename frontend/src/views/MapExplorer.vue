<template>
  <div class="map-explorer" :class="{ 'is-mobile': isMobile }">
    <!-- Layer rail. A drawer over the map on a phone. -->
    <aside
      id="explorer-rail"
      class="rail"
      :class="{ collapsed: sidebarCollapsed }"
      aria-label="Map layers"
    >
      <div class="rail-head">
        <template v-if="!sidebarCollapsed">
          <RouterLink to="/" class="rail-home">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            Vungu RDC
          </RouterLink>
          <h1 class="rail-title">Map explorer</h1>
        </template>
        <button
          type="button"
          class="icon-btn rail-collapse"
          :aria-expanded="!sidebarCollapsed"
          aria-controls="explorer-rail"
          :aria-label="sidebarCollapsed ? 'Show map layers' : 'Hide map layers'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <svg v-if="sidebarCollapsed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      <template v-if="!sidebarCollapsed">
        <div class="rail-toolbar">
          <span class="rail-label">Layers</span>
          <div class="rail-actions">
            <button
              type="button"
              class="icon-btn"
              aria-label="Reload QGIS Server layers"
              title="Reload QGIS Server layers"
              :disabled="spatialStore.ogcLoading"
              @click="refreshOGC"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{ spinning: spatialStore.ogcLoading }" aria-hidden="true">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Hide every layer"
              title="Hide every layer"
              :disabled="activeLayers.size === 0"
              @click="hideAllLayers"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- The only part that scrolls. The head and the footer stay put. -->
        <div class="rail-body">
          <div v-if="spatialStore.ogcLoading && availableLayers.length === 0" class="rail-state" role="status">
            <span class="spinner" aria-hidden="true"></span>
            Loading layers…
          </div>

          <p v-else-if="availableLayers.length === 0" class="rail-state">
            No layers are published right now. The council basemap is still
            shown on the map.
          </p>

          <template v-else>
            <section
              v-for="group in [
                { key: 'ogc', title: 'QGIS Server layers', badge: 'WFS', items: ogcLayersList },
                { key: 'db', title: 'Council database layers', badge: 'DB', items: dbLayersList },
              ].filter(g => g.items.length)"
              :key="group.key"
              class="layer-group"
            >
              <button
                type="button"
                class="group-header"
                :aria-expanded="groupsOpen[group.key]"
                :aria-controls="`group-${group.key}`"
                @click="groupsOpen[group.key] = !groupsOpen[group.key]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="['chevron', { open: groupsOpen[group.key] }]" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span>{{ group.title }}</span>
                <span class="group-count">{{ group.items.length }}</span>
              </button>

              <ul v-show="groupsOpen[group.key]" :id="`group-${group.key}`" class="group-items">
                <li
                  v-for="layer in group.items"
                  :key="layer.id || layer.table_name"
                  class="explorer-layer"
                  :class="{
                    active: isLayerActive(layer.id || layer.table_name),
                    errored: failedLayers.has(layer.id || layer.table_name),
                  }"
                >
                  <button
                    type="button"
                    role="switch"
                    class="layer-switch"
                    :aria-checked="isLayerActive(layer.id || layer.table_name)"
                    :disabled="loadingLayers.has(layer.id || layer.table_name) || failedLayers.has(layer.id || layer.table_name)"
                    @click="toggleLayer(layer.id || layer.table_name)"
                  >
                    <span v-if="loadingLayers.has(layer.id || layer.table_name)" class="spinner sm" aria-hidden="true"></span>
                    <span v-else class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
                    <span class="layer-info">
                      <span class="layer-name">{{ layerLabel(layer) }}</span>
                      <span class="layer-meta">
                        <span class="badge" :class="group.key">{{ group.badge }}</span>
                        <span v-if="failedLayers.has(layer.id || layer.table_name)" class="badge err">Unavailable</span>
                        <!-- A layer switched on with nothing in it must say so,
                             or "on" with no change on the map reads as broken. -->
                        <template v-else-if="isLayerActive(layer.id || layer.table_name)">
                          <span v-if="getActiveFeatureCount(layer.id || layer.table_name) === 0" class="badge empty">
                            No mapped features
                          </span>
                          <span v-else class="layer-count">
                            {{ getActiveFeatureCount(layer.id || layer.table_name).toLocaleString() }} features
                          </span>
                        </template>
                        <span v-else-if="layer.feature_count" class="layer-count">
                          {{ Number(layer.feature_count).toLocaleString() }} features
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <div class="rail-foot">
          <span>{{ activeLayers.size }} of {{ availableLayers.length }} layers on</span>
          <button
            v-if="activeLayers.size > 0"
            type="button"
            class="text-btn"
            @click="hideAllLayers"
          >Clear all</button>
        </div>
      </template>
    </aside>

    <!-- Scrim behind the drawer on a phone; tapping it closes the drawer. -->
    <div
      v-if="isMobile && !sidebarCollapsed"
      class="rail-scrim"
      aria-hidden="true"
      @click="sidebarCollapsed = true"
    ></div>

    <!-- Map. The status bar is its own row, not an overlay: laid over the
         map it hid the scale bar, the attribute-table tab and the
         OpenStreetMap attribution the licence requires to be visible. -->
    <div class="map-area">
      <div class="map-slot">
        <InteractiveMap
          ref="mapComponent"
          :center="mapCenter"
          :zoom="mapZoom"
          :layers="[]"
          @map-ready="onMapReady"
          @layer-error="onLayerError"
          @feature-clicked="onFeatureClicked"
        />
      </div>

      <div class="status-bar">
        <span>Zoom {{ currentZoom.toFixed(1) }}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>{{ activeLayers.size }} layer{{ activeLayers.size === 1 ? '' : 's' }} on</span>
        <span class="spacer"></span>
        <button type="button" class="text-btn" @click="resetView">Reset view</button>
      </div>
    </div>

    <!-- Feature dialog -->
    <div v-if="selectedFeature" class="feature-modal" @click="closeFeatureInfo">
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-title"
        @click.stop
      >
        <div class="modal-header">
          <h2 id="feature-title">{{ selectedFeature.properties?.name || 'Feature details' }}</h2>
          <button ref="closeButton" type="button" class="icon-btn" aria-label="Close" @click="closeFeatureInfo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <dl class="modal-body">
          <div class="prop-row">
            <dt>Layer</dt>
            <dd>{{ featureLayerName(selectedFeature) }}</dd>
          </div>
          <div class="prop-row">
            <dt>Geometry</dt>
            <dd>{{ selectedFeature.geometry?.type || '—' }}</dd>
          </div>
          <div v-for="(value, key) in selectedFeature.properties" :key="key" class="prop-row">
            <dt>{{ formatPropertyName(key) }}</dt>
            <dd>{{ formatPropertyValue(value) }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck — untyped admin/explorer view; excluded from strict type-check
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { RouterLink } from 'vue-router'
import { useSpatialStore } from '../stores/spatial'
import { useBreakpoint } from '../composables/useBreakpoint'
import InteractiveMap from '../components/InteractiveMap.vue'

const spatialStore = useSpatialStore()

const mapComponent = ref(null)
const mapReady = ref(false)
const sidebarCollapsed = ref(false)
const currentZoom = ref(10)
const selectedFeature = ref(null)
const loadingLayers = ref(new Set())
const groupsOpen = ref({ ogc: true, db: true })

const mapCenter = ref([29.82, -19.48])  // Vungu RDC district centre
const mapZoom = ref(10)

// The Streets / Satellite / Terrain switcher that used to sit here was never
// wired: its handler only logged. It cannot be wired either — satellite and
// terrain need third-party tile hosts, which the self-hosting rule forbids.
// The council basemap is the only basemap, so the control is gone.

// On a phone a 280px rail leaves no map. The rail becomes a drawer over the
// map there, and starts closed so the first thing seen is the district.
const { isMobile } = useBreakpoint()
if (isMobile.value) sidebarCollapsed.value = true

/**
 * Table names are what the backend has; people read names. A layer the
 * catalogue already titles ("Gweru Health Centres") is left alone.
 */
const layerLabel = (layer) => {
  const raw = String(layer.display_name || layer.name || layer.id || layer.table_name || '')
    .replace(/^(?:wms|wfs)-/, '')
  if (!raw.includes('_') && raw !== raw.toLowerCase()) return raw
  const words = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const availableLayers = computed(() => spatialStore.allAvailableLayers)
const activeLayers = computed(() => spatialStore.activeLayers)
const failedLayers = computed(() => spatialStore.failedLayers)

const ogcLayersList = computed(() =>
  availableLayers.value.filter(l => l.source === 'ogc')
)

const dbLayersList = computed(() =>
  availableLayers.value.filter(l => l.source !== 'ogc')
)

// Resolve an OGC layer ID (wms-DisplayName) to its dynamic layer id (=table_name) if one exists.
// Dynamic layers returned by the backend have id=table_name and name=display_name.
const resolveOgcToTableName = (layerId) => {
  if (!layerId.startsWith('wms-') && !layerId.startsWith('wfs-')) return null
  const displayName = layerId.replace(/^(?:wms|wfs)-/, '').toLowerCase()
  const normalizedId = displayName.replace(/\s+/g, '_')
  const match = (spatialStore.layers).find(l =>
    (l.name || '').toLowerCase() === displayName ||
    (l.id || '').toLowerCase() === normalizedId
  )
  return match?.id || null
}

const getActiveFeatureCount = (layerId) => {
  const tableName = resolveOgcToTableName(layerId)
  const resolvedId = tableName || layerId
  const data = spatialStore.activeLayers.get(resolvedId)
  if (!data) return 0
  // The store holds a FeatureCollection for database layers and a
  // GeometryCollection or WFS payload for OGC ones; count whichever it is.
  return data.geojson?.features?.length
    ?? data.geojson?.geometries?.length
    ?? data.features?.features?.length
    ?? data.totalFeatures
    ?? 0
}

const isLayerActive = (layerId) => {
  const tableName = resolveOgcToTableName(layerId)
  if (tableName) return spatialStore.isLayerActive(tableName)
  return spatialStore.isLayerActive(layerId)
}

const toggleLayer = async (layerId) => {
  if (!layerId || loadingLayers.value.has(layerId)) return

  const layer = availableLayers.value.find(l => (l.id || l.table_name) === layerId)
  const isOgc = layer?.source === 'ogc' || layerId.startsWith('wms-') || layerId.startsWith('wfs-')

  if (isOgc) {
    const tableName = resolveOgcToTableName(layerId)

    if (tableName) {
      // Dynamic layer counterpart exists — use same algorithm as home page
      if (spatialStore.isLayerActive(tableName)) {
        spatialStore.clearLayer(tableName)
        mapComponent.value?.removeLayerFromMap?.(tableName)
      } else {
        loadingLayers.value = new Set([...loadingLayers.value, layerId])
        try {
          await spatialStore.loadLayerData(tableName)
          mapComponent.value?.addLayerToMap?.(tableName)
        } catch (e) {
          spatialStore.failedLayers.add(layerId)
        } finally {
          const next = new Set(loadingLayers.value)
          next.delete(layerId)
          loadingLayers.value = next
        }
      }
    } else {
      // OGC-only layer (no DB counterpart) — fall back to WMS raster
      if (spatialStore.isLayerActive(layerId)) {
        spatialStore.clearLayer(layerId)
        mapComponent.value?.removeLayerFromMap?.(layerId)
      } else {
        loadingLayers.value = new Set([...loadingLayers.value, layerId])
        try {
          await spatialStore.loadOGCLayerData(layerId)
          mapComponent.value?.addLayerToMap?.(layerId)
        } finally {
          const next = new Set(loadingLayers.value)
          next.delete(layerId)
          loadingLayers.value = next
        }
      }
    }
  } else {
    if (spatialStore.isLayerActive(layerId)) {
      spatialStore.clearLayer(layerId)
      mapComponent.value?.removeLayerFromMap?.(layerId)
    } else {
      loadingLayers.value = new Set([...loadingLayers.value, layerId])
      try {
        await mapComponent.value?.addLayerToMap?.(layerId)
      } catch (e) {
        spatialStore.failedLayers.add(layerId)
      } finally {
        const next = new Set(loadingLayers.value)
        next.delete(layerId)
        loadingLayers.value = next
      }
    }
  }
}

const hideAllLayers = () => {
  Array.from(activeLayers.value.keys()).forEach(id => {
    spatialStore.clearLayer(id)
    mapComponent.value?.removeLayerFromMap?.(id)
  })
}

const refreshOGC = async () => {
  await spatialStore.loadOGCCapabilities()
}

const onMapReady = (map) => {
  mapReady.value = true
  Promise.all([
    spatialStore.loadLayers(),
    spatialStore.loadOGCCapabilities(),
    spatialStore.loadTileLayers()
  ])
  // One decimal: a whole-number readout sits on "Zoom 10" through most of a
  // pinch and reads as though the map did not respond.
  const syncZoom = () => { currentZoom.value = Math.round(map.getZoom() * 10) / 10 }
  syncZoom()
  map.on('zoomend', syncZoom)
}

const resetView = () => {
  mapComponent.value?.flyTo?.({ center: mapCenter.value, zoom: mapZoom.value })
}

const onLayerError = (layerId) => {
  spatialStore.clearLayer(layerId)
  spatialStore.failedLayers.add(layerId)
}

// ── Feature dialog ──────────────────────────────────────────────────────
// A real dialog: Escape closes it, focus moves into it on open and back to
// where it was on close, so a keyboard user is never stranded behind it.
const closeButton = ref(null)
let returnFocusTo = null

const onFeatureClicked = async (feature) => {
  returnFocusTo = document.activeElement
  selectedFeature.value = feature
  await nextTick()
  closeButton.value?.focus()
}

const closeFeatureInfo = () => {
  selectedFeature.value = null
  returnFocusTo?.focus?.()
  returnFocusTo = null
}

/**
 * `feature.layer` is MapLibre's style-layer object; printing it dumped JSON
 * into the dialog. The source id names the data: `source-<table>` for the
 * council layers, `vungu-<layer>` for the basemap.
 */
const featureLayerName = (feature) => {
  const id = String(feature?.source || feature?.layer?.source || '')
    .replace(/^(?:source|vungu)-/, '')
  if (!id) return '—'
  const known = availableLayers.value.find(l => (l.id || l.table_name) === id)
  return layerLabel(known || { id })
}

const onKeydown = (e) => {
  if (e.key === 'Escape' && selectedFeature.value) closeFeatureInfo()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const formatPropertyName = (key) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

const formatPropertyValue = (value) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}
</script>

<style scoped>
/* Built on the --ent-* tokens (src/styles/enterprise.css) like the rest of
   the app chrome. It previously carried its own dark palette and system font,
   which made the public map the one page that looked like another product. */

.map-explorer {
  position: relative;
  height: var(--ent-vh, 100vh);
  display: flex;
  overflow: hidden;
  background: var(--ent-canvas);
  font-family: var(--ent-font);
  font-size: var(--ent-fs-sm);
  color: var(--ent-text);
}

/* ── Rail ─────────────────────────────────────────────────────────────── */
.rail {
  width: 288px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--ent-surface);
  border-right: 1px solid var(--ent-line);
  /* No width transition: animating it reflows the map beside it every
     frame and makes MapLibre resize its canvas on each one. */
  z-index: var(--ent-z-rail);
}
.rail.collapsed { width: var(--ent-rail-w-collapsed); }

.rail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "home toggle" "title title";
  align-items: center;
  padding: var(--ent-s3) var(--ent-s3) var(--ent-s3) var(--ent-s4);
  border-bottom: 1px solid var(--ent-line);
}
.rail-home { grid-area: home; justify-self: start; }
.rail-title { grid-area: title; }
.rail-collapse { grid-area: toggle; }
.rail.collapsed .rail-head { grid-template-columns: 1fr; grid-template-areas: "toggle"; justify-items: center; padding: var(--ent-s3) 0; }

.rail-home {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: -3px;
  font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-medium);
  color: var(--ent-text-2);
  text-decoration: none;
  border-radius: var(--ent-r-sm);
}
.rail-home:hover { color: var(--ent-accent); }
.rail-home:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

.rail-title {
  margin: 2px 0 0;
  font-size: var(--ent-fs-lg);
  font-weight: var(--ent-fw-semibold);
  line-height: var(--ent-lh-tight);
  color: var(--ent-text);
}
.rail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ent-s2) var(--ent-s3) var(--ent-s2) var(--ent-s4);
}
.rail-label {
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ent-text-3);
}
.rail-actions { display: flex; gap: 2px; }

/* The fix for the unreachable layers: this region scrolls, and min-height: 0
   is what lets a flex child shrink below its content and do so. */
.rail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--ent-s2) var(--ent-s3);
}

.rail-state {
  display: flex;
  align-items: center;
  gap: var(--ent-s2);
  margin: 0;
  padding: var(--ent-s3) var(--ent-s2);
  color: var(--ent-text-2);
  line-height: var(--ent-lh);
}

.rail-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ent-s2);
  min-height: 40px;
  padding: 0 var(--ent-s3) 0 var(--ent-s4);
  border-top: 1px solid var(--ent-line);
  background: var(--ent-surface-2);
  font-size: var(--ent-fs-xs);
  color: var(--ent-text-2);
}

/* ── Buttons ──────────────────────────────────────────────────────────── */
.icon-btn {
  display: inline-grid;
  place-items: center;
  width: var(--ent-control-h-sm);
  height: var(--ent-control-h-sm);
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: var(--ent-r);
  background: none;
  color: var(--ent-text-2);
  cursor: pointer;
  transition: background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.icon-btn:hover:not(:disabled) { background: var(--ent-surface-2); color: var(--ent-text); }
.icon-btn:disabled { opacity: 0.4; cursor: default; }

.text-btn {
  padding: 3px var(--ent-s2);
  border: 0;
  border-radius: var(--ent-r-sm);
  background: none;
  font: inherit;
  font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold);
  color: var(--ent-accent);
  cursor: pointer;
}
.text-btn:hover { background: var(--ent-accent-soft); }

.icon-btn:focus-visible,
.text-btn:focus-visible,
.group-header:focus-visible,
.layer-switch:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }

/* ── Layer groups ─────────────────────────────────────────────────────── */
.layer-group + .layer-group { margin-top: var(--ent-s2); }

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px var(--ent-s2);
  border: 0;
  border-radius: var(--ent-r-sm);
  background: none;
  font: inherit;
  font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold);
  color: var(--ent-text-2);
  cursor: pointer;
}
.group-header:hover { background: var(--ent-surface-2); color: var(--ent-text); }

.chevron { flex-shrink: 0; transition: transform var(--ent-dur) var(--ent-ease); }
.chevron:not(.open) { transform: rotate(-90deg); }

.group-count {
  margin-left: auto;
  padding: 0 6px;
  border-radius: var(--ent-r-pill);
  background: var(--ent-tone-neutral-bg);
  font-size: var(--ent-fs-micro);
  font-weight: var(--ent-fw-medium);
  color: var(--ent-tone-neutral-fg);
}

.group-items { list-style: none; margin: 2px 0 0; padding: 0; }

/* Named `explorer-layer`, not `layer-item`: main.css styles `.layer-item`
   globally, and its light divider leaked into this list. */
.explorer-layer { border-radius: var(--ent-r); }
.explorer-layer.active { background: var(--ent-accent-soft); }

.layer-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px var(--ent-s2);
  border: 0;
  border-radius: var(--ent-r);
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.layer-switch:hover:not(:disabled) { background: var(--ent-surface-2); }
.explorer-layer.active .layer-switch:hover:not(:disabled) { background: transparent; }
.layer-switch:disabled { cursor: default; }

.toggle-track {
  position: relative;
  flex-shrink: 0;
  width: 28px;
  height: 16px;
  border-radius: var(--ent-r-pill);
  background: var(--ent-line-strong);
  transition: background-color var(--ent-dur) var(--ent-ease);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ent-surface);
  box-shadow: var(--ent-e1);
  transition: transform var(--ent-dur) var(--ent-ease);
}
.layer-switch[aria-checked='true'] .toggle-track { background: var(--ent-accent); }
.layer-switch[aria-checked='true'] .toggle-thumb { transform: translateX(12px); }

.layer-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.layer-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ent-fs-sm);
  font-weight: var(--ent-fw-medium);
  color: var(--ent-text);
}
.layer-meta { display: flex; align-items: center; gap: 6px; }
.layer-count { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

.badge {
  padding: 0 5px;
  border-radius: var(--ent-r-sm);
  font-size: 10px;
  font-weight: var(--ent-fw-semibold);
  letter-spacing: 0.04em;
  line-height: 16px;
}
.badge.ogc { background: var(--ent-tone-info-bg); color: var(--ent-tone-info-fg); }
.badge.db  { background: var(--ent-tone-positive-bg); color: var(--ent-tone-positive-fg); }
.badge.err { background: var(--ent-tone-negative-bg); color: var(--ent-tone-negative-fg); }
.badge.empty {
  background: var(--ent-tone-warning-bg);
  color: var(--ent-tone-warning-fg);
  letter-spacing: 0;
}

.explorer-layer.errored .layer-name { color: var(--ent-text-3); text-decoration: line-through; }
.explorer-layer.errored .toggle-track { background: var(--ent-danger-soft); }

/* ── Map area ─────────────────────────────────────────────────────────── */
.map-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.map-slot { position: relative; flex: 1; min-height: 0; }

.status-bar {
  display: flex;
  align-items: center;
  gap: var(--ent-s2);
  height: 30px;
  flex-shrink: 0;
  padding: 0 var(--ent-s2) 0 var(--ent-s3);
  border-top: 1px solid var(--ent-line);
  background: var(--ent-surface);
  font-size: var(--ent-fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--ent-text-2);
}
.sep { color: var(--ent-text-3); }
.spacer { flex: 1; }

/* ── Phone: the rail becomes a drawer ────────────────────────────────── */
.is-mobile .rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: min(88vw, 320px);
  box-shadow: var(--ent-e4);
}
.is-mobile .rail.collapsed {
  /* Collapsed on a phone is a floating button, not a 52px strip that
     permanently eats a seventh of the map. Bottom-left, above the scale
     bar: in thumb reach, and clear of the map's tool column top-left. */
  inset: auto auto 76px var(--ent-s3);
  width: auto;
  border: 1px solid var(--ent-map-panel-line);
  border-radius: var(--ent-r-md);
  box-shadow: var(--ent-map-panel-shadow);
}
.is-mobile .rail.collapsed .rail-head { padding: 3px; border: 0; }
.is-mobile .rail.collapsed .icon-btn { width: 38px; height: 38px; }

.rail-scrim {
  position: absolute;
  inset: 0;
  z-index: calc(var(--ent-z-rail) - 1);
  background: rgba(17, 29, 45, 0.32);
}

/* ── Spinner ──────────────────────────────────────────────────────────── */
.spinner {
  display: inline-block;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 2px solid var(--ent-line);
  border-top-color: var(--ent-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.spinner.sm { width: 12px; height: 12px; margin: 2px 8px; }
.spinning { animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Feature dialog ───────────────────────────────────────────────────── */
.feature-modal {
  position: fixed;
  inset: 0;
  z-index: var(--ent-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ent-s4);
  background: rgba(17, 29, 45, 0.45);
}
.modal-content {
  width: min(440px, 100%);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ent-line);
  border-radius: var(--ent-r-lg);
  background: var(--ent-surface);
  box-shadow: var(--ent-e4);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ent-s3);
  padding: var(--ent-s3) var(--ent-s3) var(--ent-s3) var(--ent-s4);
  border-bottom: 1px solid var(--ent-line);
}
.modal-header h2 {
  margin: 0;
  font-size: var(--ent-fs-md);
  font-weight: var(--ent-fw-semibold);
  color: var(--ent-text);
}
.modal-body { margin: 0; padding: var(--ent-s1) 0 var(--ent-s2); overflow-y: auto; }
.prop-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--ent-s4);
  padding: 6px var(--ent-s4);
}
.prop-row:nth-child(even) { background: var(--ent-surface-2); }
.prop-row dt { flex-shrink: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.prop-row dd {
  margin: 0;
  font-size: var(--ent-fs-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ent-text);
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .chevron, .toggle-thumb, .toggle-track { transition: none; }
  .spinner, .spinning { animation-duration: 2s; }
}
</style>
