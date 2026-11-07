<template>
  <div class="qgis-map-view">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <h1>🗺️ QGIS Styled Layers</h1>
        <span class="project-name">vungu-docker-minimal.qgs</span>
      </div>
      <div class="header-right">
        <button @click="refreshLayers" class="btn btn-refresh" :disabled="loading">
          🔄 {{ loading ? 'Loading...' : 'Refresh' }}
        </button>
        <button @click="refreshStyles" class="btn btn-refresh-styles" :disabled="refreshingStyles" title="Clear QGIS style cache">
          🎨 {{ refreshingStyles ? 'Refreshing Styles...' : 'Refresh Styles' }}
        </button>
        <button @click="serviceMode = 'vector'" class="btn btn-mode" :class="{ active: serviceMode === 'vector' }">
          📦 Vector
        </button>
        <button @click="serviceMode = 'wms'" class="btn btn-mode" :class="{ active: serviceMode === 'wms' }">
          🗺️ WMS
        </button>
        <button @click="serviceMode = 'wfs'" class="btn btn-mode" :class="{ active: serviceMode === 'wfs' }">
          📡 WFS
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="main-content">
      <!-- Sidebar -->
      <div class="sidebar">
        <!-- Unified Layer List -->
        <div class="sidebar-section">
          <h3>📋 Layers ({{ totalLayerCount }})</h3>
          <div class="layer-list">
            <div 
              v-for="layer in unifiedLayers" 
              :key="layer.name"
              class="layer-item"
              :class="{ active: isLayerLoaded(layer.name) }"
            >
              <label>
                <input 
                  type="checkbox" 
                  :checked="isLayerLoaded(layer.name)"
                  @change="toggleLayer(layer.name)"
                  :disabled="loadingLayers.has(layer.name)"
                />
                <span class="layer-name">{{ layer.name }}</span>
                <span class="layer-source" :title="`Source: ${layer.source}`">{{ layer.source }}</span>
                <span v-if="loadingLayers.has(layer.name)" class="loading-indicator">⏳</span>
              </label>
            </div>
          </div>
          <p v-if="unifiedLayers.length === 0" class="no-layers">No layers available</p>
        </div>

        <!-- Layer Style Details -->
        <div v-if="selectedLayerInfo" class="sidebar-section">
          <h3>🎨 Layer Style</h3>
          <div class="layer-details">
            <div class="detail-row">
              <span class="label">Renderer:</span>
              <span class="value">{{ selectedLayerInfo.style?.rendererType || 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Source:</span>
              <span class="value">{{ selectedLayerInfo.style?.source || 'N/A' }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Symbols:</span>
              <span class="value">{{ selectedLayerInfo.style?.symbols?.length || 0 }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Features:</span>
              <span class="value">{{ selectedLayerInfo.features?.totalFeatures || 0 }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Patterns:</span>
              <span class="value">{{ selectedLayerInfo.style?.hasComplexPatterns ? '✅' : '❌' }}</span>
            </div>
          </div>

          <!-- MapLibre Style Preview -->
          <div class="style-preview">
            <h4>MapLibre Style</h4>
            <pre>{{ JSON.stringify(selectedLayerInfo.maplibreStyle, null, 2) }}</pre>
          </div>
        </div>
      </div>

      <!-- Map Container -->
      <div class="map-container">
        <div ref="mapContainer" class="map"></div>
        
        <!-- Map Info -->
        <div class="map-info">
          <span>Loaded: {{ loadedLayers.size }} layers</span>
          <span>•</span>
          <span>Center: {{ mapCenter[1].toFixed(4) }}, {{ mapCenter[0].toFixed(4) }}</span>
          <span>•</span>
          <span>Zoom: {{ mapZoom.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <!-- Status Bar -->
    <div class="status-bar" :class="{ error: hasError }">
      <span v-if="statusMessage">{{ statusMessage }}</span>
      <span v-else>Ready</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ogcService, wmsTileUrlTemplate } from '../services/ogc'
import { addVunguBasemap } from '@/map/vunguBasemap'

// State
const mapContainer = ref<HTMLElement | null>(null)
let map: maplibregl.Map | null = null

const loading = ref(false)
const loadingLayers = ref(new Set<string>())
const refreshingStyles = ref(false)
const hasError = ref(false)
const statusMessage = ref('')

const availableLayers = ref<Array<{ name: string; title?: string; type?: string; geometry?: string }>>([])
const wmsLayers = ref<Array<{ name: string; title: string }>>([])
const wfsLayers = ref<Array<{ name: string; title: string }>>([])

// Computed: Unified unique layer list from all sources, sorted by geometry type
const unifiedLayers = computed(() => {
  // Create a map to track unique layers by name
  const layerMap = new Map<string, { name: string; title: string; source: string; geometryType?: string }>()
  
  // Helper to determine geometry type priority (lower = higher in list)
  const getGeometryPriority = (geomType?: string): number => {
    if (!geomType) return 999
    const lower = geomType.toLowerCase()
    if (lower.includes('point')) return 1
    if (lower.includes('line')) return 2
    if (lower.includes('polygon')) return 3
    return 999
  }
  
  // Add WMS layers (primary source from QGIS Server)
  wmsLayers.value.forEach(layer => {
    layerMap.set(layer.name, { ...layer, source: 'WMS' })
  })
  
  // Add WFS layers (only if not already in WMS)
  wfsLayers.value.forEach(layer => {
    if (!layerMap.has(layer.name)) {
      layerMap.set(layer.name, { ...layer, source: 'WFS' })
    }
  })
  
  // Add available layers (only if not already present) - these have geometry type
  availableLayers.value.forEach(layer => {
    if (!layerMap.has(layer.name)) {
      layerMap.set(layer.name, { 
        name: layer.name, 
        title: layer.title || layer.name, 
        source: layer.type || 'Vector',
        geometryType: layer.geometry || layer.type
      })
    } else {
      // Update existing layer with geometry type if available
      const existing = layerMap.get(layer.name)!
      if (layer.geometry || layer.type) {
        existing.geometryType = layer.geometry || layer.type
      }
    }
  })
  
  // Convert map to array, sort by geometry type priority, then by name
  return Array.from(layerMap.values()).sort((a, b) => {
    const priorityA = getGeometryPriority(a.geometryType)
    const priorityB = getGeometryPriority(b.geometryType)
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB // Points (1) before Lines (2) before Polygons (3)
    }
    
    return a.name.localeCompare(b.name) // Secondary sort by name
  })
})

// Layer count for display
const totalLayerCount = computed(() => unifiedLayers.value.length)

// Mode: 'vector' | 'wms' | 'wfs'
const serviceMode = ref<'vector' | 'wms' | 'wfs'>('vector')

// Fetch WFS layers from capabilities
async function fetchWFSLayers() {
  try {
    console.log('[QGISMap] Fetching WFS layers...')
    const capabilities = await ogcService.getWFSCapabilities()
    wfsLayers.value = capabilities.layers.map((l: any) => ({
      name: l.name,
      title: l.title || l.name
    }))
    console.log('[QGISMap] Found WFS layers:', wfsLayers.value.map((l: any) => l.name))
  } catch (error) {
    console.error('[QGISMap] Failed to fetch WFS layers:', error)
  }
}
async function fetchWMSLayers() {
  try {
    console.log('[QGISMap] Fetching WMS layers...')
    const capabilities = await ogcService.getWMSCapabilities()
    wmsLayers.value = capabilities.layers.map((l: any) => ({
      name: l.name,
      title: l.title || l.name
    }))
    console.log('[QGISMap] Found WMS layers:', wmsLayers.value.map((l: any) => l.name))
  } catch (error) {
    console.error('[QGISMap] Failed to fetch WMS layers:', error)
  }
}
async function fetchAvailableLayers() {
  try {
    console.log('[QGISMap] Fetching available layers from QGIS project...')
    const layers = await ogcService.getAvailableLayers()
    availableLayers.value = layers
    console.log('[QGISMap] Found layers:', layers.map((l: any) => l.name))
  } catch (error) {
    console.error('[QGISMap] Failed to fetch layers:', error)
    statusMessage.value = '❌ Failed to load layer list'
    hasError.value = true
  }
}

const loadedLayers = ref(new Map<string, any>())
const selectedLayerInfo = ref<any>(null)

// Map state
const mapCenter = ref([29.8, -19.45]) // Zimbabwe approximate center
const mapZoom = ref(8)

// Computed
const isLayerLoaded = (name: string) => loadedLayers.value.has(name)

// Initialize map
onMounted(async () => {
  // Auto-prefer QGIS Server's pixel-perfect WMS rasters when it's actually
  // rendering; otherwise stay on client-side vector styling. This is what
  // makes "what you see in QGIS = what you see here" true the moment QGIS
  // Server is up — with zero regression while it's down. The mode buttons
  // still let a user override.
  if (await ogcService.isQgisServerHealthy()) {
    serviceMode.value = 'wms'
  }
  await fetchAvailableLayers()
  await fetchWMSLayers()
  await fetchWFSLayers()
  initMap()
})

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
})

function initMap() {
  if (!mapContainer.value) return

  map = new maplibregl.Map({
    container: mapContainer.value,
    // Self-hosted base — the PostGIS basemap (addVunguBasemap on load) is
    // the content; no external tile servers.
    style: {
      version: 8,
      sources: {},
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      layers: [
        {
          id: 'bg',
          type: 'background',
          paint: { 'background-color': '#f2efe9' }
        }
      ]
    },
    center: mapCenter.value as [number, number],
    zoom: mapZoom.value
  })

  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left')

  map.on('move', () => {
    if (map) {
      const center = map.getCenter()
      mapCenter.value = [center.lng, center.lat]
      mapZoom.value = map.getZoom()
    }
  })

  map.on('load', () => {
    addVunguBasemap(map!)
    statusMessage.value = '✅ Map loaded - Click layers to add them'
    console.log('[QGISMap] Map initialized')
    
    // Auto-load first layer if available from unified list
    if (unifiedLayers.value.length > 0) {
      loadStyledLayer(unifiedLayers.value[0].name)
    }
  })
}

async function toggleLayer(layerName: string) {
  if (isLayerLoaded(layerName)) {
    removeLayer(layerName)
  } else {
    switch (serviceMode.value) {
      case 'wms':
        await loadWMSLayer(layerName)
        break
      case 'wfs':
        await loadWFSLayer(layerName)
        break
      default:
        await loadStyledLayer(layerName)
    }
  }
}

async function loadWFSLayer(layerName: string) {
  if (!map || loadingLayers.value.has(layerName)) return

  loadingLayers.value.add(layerName)
  statusMessage.value = `⏳ Loading WFS ${layerName}...`
  hasError.value = false

  try {
    console.log(`[QGISMap] 📡 Loading WFS layer: ${layerName}`)

    const sourceId = `wfs-source-${layerName}`
    const layerId = `wfs-layer-${layerName}`

    // Remove existing if present
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)

    // Fetch WFS features as GeoJSON
    const features = await ogcService.getWFSFeatures({
      typeName: layerName,
      srsName: 'EPSG:4326',
      outputFormat: 'application/json'
    })

    if (!Array.isArray(features) || features.length === 0) {
      throw new Error('No features returned from WFS')
    }

    console.log(`[QGISMap] ✅ Received ${features.length} WFS features`)

    // Add GeoJSON source
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features
      }
    })

    // Add layer with default styling (blue circles for points, lines for linestrings, fills for polygons)
    const geometryType = features[0]?.geometry?.type || 'Point'
    
    if (geometryType.includes('Point')) {
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#4fc3f7',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      })
    } else if (geometryType.includes('LineString')) {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#4fc3f7',
          'line-width': 2
        }
      })
    } else if (geometryType.includes('Polygon')) {
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#4fc3f7',
          'fill-opacity': 0.5,
          'fill-outline-color': '#2c3e50'
        }
      })
      // Add outline
      map.addLayer({
        id: `${layerId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#2c3e50',
          'line-width': 1
        }
      })
    }

    // Store layer info
    loadedLayers.value.set(layerName, { type: 'wfs', name: layerName, features: features.length })

    // Fit to bounds
    const bounds = new maplibregl.LngLatBounds()
    features.forEach((feature: any) => {
      if (feature.geometry) {
        addCoordsToBounds(feature.geometry, bounds)
      }
    })
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 50 })
    }

    statusMessage.value = `✅ Loaded WFS ${layerName} (${features.length} features)`
    console.log(`[QGISMap] ✅ WFS layer added: ${layerName}`)

  } catch (error: any) {
    console.error(`[QGISMap] ❌ Failed to load WFS ${layerName}:`, error)
    statusMessage.value = `❌ Failed to load WFS ${layerName}: ${error.message}`
    hasError.value = true
  } finally {
    loadingLayers.value.delete(layerName)
  }
}

async function loadWMSLayer(layerName: string) {
  if (!map || loadingLayers.value.has(layerName)) return

  loadingLayers.value.add(layerName)
  statusMessage.value = `⏳ Loading WMS ${layerName}...`
  hasError.value = false

  try {
    console.log(`[QGISMap] 🗺️ Loading WMS layer: ${layerName}`)

    const sourceId = `wms-source-${layerName}`
    const layerId = `wms-layer-${layerName}`

    // Remove existing if present
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)

    // Add WMS raster source via the shared URL builder (services/ogc.ts) —
    // the same one the home map and planner use, so there is exactly one
    // place that knows how to ask the OGC proxy for QGIS-rendered tiles.
    // 512 px tiles: a pan costs a quarter of the QGIS renders vs 256.
    map.addSource(sourceId, {
      type: 'raster',
      tiles: [wmsTileUrlTemplate(layerName, 512)],
      tileSize: 512
    })

    // Add WMS raster layer
    map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0.8
      }
    })

    // Store layer info
    loadedLayers.value.set(layerName, { type: 'wms', name: layerName })

    statusMessage.value = `✅ Loaded WMS ${layerName}`
    console.log(`[QGISMap] ✅ WMS layer added: ${layerName}`)

  } catch (error: any) {
    console.error(`[QGISMap] ❌ Failed to load WMS ${layerName}:`, error)
    statusMessage.value = `❌ Failed to load WMS ${layerName}: ${error.message}`
    hasError.value = true
  } finally {
    loadingLayers.value.delete(layerName)
  }
}

async function loadStyledLayer(layerName: string) {
  if (!map || loadingLayers.value.has(layerName)) return

  loadingLayers.value.add(layerName)
  statusMessage.value = `⏳ Loading ${layerName}...`
  hasError.value = false

  try {
    console.log(`[QGISMap] 📦 Loading styled layer: ${layerName}`)
    
    const styledLayer = await ogcService.getStyledLayer(layerName, { noCache: true })
    
    console.log(`[QGISMap] ✅ Received styled layer:`, styledLayer)

    // Features are already extracted as flat array by ogc.ts getStyledLayer()
    const features = Array.isArray(styledLayer.features) 
      ? styledLayer.features 
      : (styledLayer.features?.features || [])
    
    if (!features || features.length === 0) {
      throw new Error('No features returned')
    }
    
    console.log(`[QGISMap] 📊 Extracted ${features.length} features for ${layerName}`)
    
    // Debug: log first feature properties to check attribute names
    const firstFeature = features[0]
    if (firstFeature) {
      console.log(`[QGISMap] 🔍 First feature properties:`, firstFeature.properties)
    }

    // Add source
    const sourceId = `source-${layerName}`
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }

    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features
      }
    })

    // Get MapLibre style from response
    const maplibreStyle = styledLayer.maplibreStyle || {
      id: layerName,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': '#45B7D1',
        'fill-opacity': 0.5,
        'fill-outline-color': '#2c3e50'
      }
    }

    const isOutlineOnly = maplibreStyle.metadata?.['qgis:isOutlineOnly']
    console.log(`[QGISMap] 🎨 Layer type: ${maplibreStyle.type}, isOutlineOnly: ${isOutlineOnly}`)
    console.log(`[QGISMap] 🎨 Paint properties:`, JSON.stringify(maplibreStyle.paint, null, 2))

    // Add layer with QGIS styling
    const layerId = `layer-${layerName}`
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }

    // For outline-only polygons, use line type
    if (isOutlineOnly || maplibreStyle.type === 'line') {
      // Clean up paint object (remove internal properties)
      const cleanPaint = { ...maplibreStyle.paint }
      delete cleanPaint._strokeLayers
      
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: cleanPaint
      })

      // Add additional line layers for multi-line styles (like gweru_rural_planning_boundary)
      // and line-symbol casings. `placement: 'below'` inserts before the main
      // layer so a casing is not painted over the core it outlines.
      if (maplibreStyle.additionalLayers && maplibreStyle.additionalLayers.length > 0) {
        for (const additionalLayer of maplibreStyle.additionalLayers) {
          const additionalId = `${layerId}-${additionalLayer.id}`
          if (map.getLayer(additionalId)) {
            map.removeLayer(additionalId)
          }
          const definition = {
            id: additionalId,
            type: 'line',
            source: sourceId,
            paint: additionalLayer.paint
          }
          if (additionalLayer.placement === 'below') {
            map.addLayer(definition, layerId)
          } else {
            map.addLayer(definition)
          }
          console.log(`[QGISMap] ➕ Added additional line layer: ${additionalId}${additionalLayer.placement === 'below' ? ' (below)' : ''}`)
        }
      }
      
      console.log(`[QGISMap] 🔲 Added outline-only layer: ${layerId}`)
    } else {
      // Regular fill layer
      map.addLayer({
        id: layerId,
        type: maplibreStyle.type || 'fill',
        source: sourceId,
        paint: maplibreStyle.paint || {}
      })

      // Add outline layer for fill polygons
      if (maplibreStyle.type === 'fill') {
        const outlineId = `outline-${layerName}`
        if (map.getLayer(outlineId)) {
          map.removeLayer(outlineId)
        }
        
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': maplibreStyle.paint?.['fill-outline-color'] || '#2c3e50',
            'line-width': 2
          }
        })
      }
    }

    // Store layer info
    loadedLayers.value.set(layerName, styledLayer)
    selectedLayerInfo.value = styledLayer

    // Fit to bounds if features exist
    if (features && features.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      
      features.forEach((feature: any) => {
        if (feature.geometry) {
          addCoordsToBounds(feature.geometry, bounds)
        }
      })

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50 })
      }
    }

    statusMessage.value = `✅ Loaded ${layerName} (${features.length} features)`
    console.log(`[QGISMap] ✅ Layer added: ${layerName}`)

  } catch (error: any) {
    console.error(`[QGISMap] ❌ Failed to load ${layerName}:`, error)
    statusMessage.value = `❌ Failed to load ${layerName}: ${error.message}`
    hasError.value = true
  } finally {
    loadingLayers.value.delete(layerName)
  }
}

function removeLayer(layerName: string) {
  if (!map) return

  const layerInfo = loadedLayers.value.get(layerName)
  
  if (layerInfo?.type === 'wfs') {
    // Remove WFS layer
    const layerId = `wfs-layer-${layerName}`
    const outlineId = `${layerId}-outline`
    const sourceId = `wfs-source-${layerName}`
    
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getLayer(outlineId)) map.removeLayer(outlineId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  } else if (layerInfo?.type === 'wms') {
    // Remove WMS layer
    const layerId = `wms-layer-${layerName}`
    const sourceId = `wms-source-${layerName}`
    
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  } else {
    // Remove vector layer
    const layerId = `layer-${layerName}`
    const outlineId = `outline-${layerName}`
    const sourceId = `source-${layerName}`

    // Remove main layer
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getLayer(outlineId)) map.removeLayer(outlineId)
    
    // Remove any additional line layers (for multi-line styles)
    const allLayers = map.getStyle()?.layers || []
    for (const layer of allLayers) {
      if (layer.id.startsWith(`${layerId}-`)) {
        map.removeLayer(layer.id)
      }
    }
    
    // Remove source last
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  }

  loadedLayers.value.delete(layerName)
  
  if (selectedLayerInfo.value?.layerName === layerName) {
    selectedLayerInfo.value = null
  }

  statusMessage.value = `Removed ${layerName}`
}

function addCoordsToBounds(geometry: any, bounds: maplibregl.LngLatBounds) {
  if (geometry.type === 'Point') {
    bounds.extend(geometry.coordinates as [number, number])
  } else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    geometry.coordinates.forEach((coord: [number, number]) => bounds.extend(coord))
  } else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ring: [number, number][]) => {
      ring.forEach((coord: [number, number]) => bounds.extend(coord))
    })
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon: [number, number][][]) => {
      polygon.forEach((ring: [number, number][]) => {
        ring.forEach((coord: [number, number]) => bounds.extend(coord))
      })
    })
  }
}

async function refreshLayers() {
  loading.value = true
  statusMessage.value = '🔄 Refreshing layers...'
  
  // Clear existing layers
  for (const layerName of loadedLayers.value.keys()) {
    removeLayer(layerName)
  }
  
  // Re-fetch available layers from all sources
  await fetchAvailableLayers()
  await fetchWMSLayers()
  await fetchWFSLayers()
  
  // Auto-load first layer from unified list if available
  if (unifiedLayers.value.length > 0) {
    await loadStyledLayer(unifiedLayers.value[0].name)
  }
  
  loading.value = false
  statusMessage.value = `✅ Refreshed - ${unifiedLayers.value.length} unique layers available`
}

async function refreshStyles() {
  refreshingStyles.value = true
  statusMessage.value = '🎨 Clearing style cache...'
  
  try {
    // Clear backend cache
    const result = await ogcService.clearCache()
    console.log('[QGISMap] Cache cleared:', result)
    
    // Reload all currently loaded layers with fresh styles
    const loadedLayerNames = Array.from(loadedLayers.value.keys())
    
    for (const layerName of loadedLayerNames) {
      statusMessage.value = `🎨 Reloading ${layerName} with fresh styles...`
      removeLayer(layerName)
      await loadStyledLayer(layerName)
    }
    
    statusMessage.value = `✅ Styles refreshed - ${loadedLayerNames.length} layers updated`
  } catch (error: any) {
    console.error('[QGISMap] Failed to refresh styles:', error)
    statusMessage.value = `❌ Failed to refresh styles: ${error.message}`
  } finally {
    refreshingStyles.value = false
  }
}
</script>

<style scoped>
.qgis-map-view {
  display: flex;
  flex-direction: column;
  height: var(--ent-vh);
  background: #1a1a2e;
  color: #eee;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: linear-gradient(135deg, #16213e, #1a1a2e);
  border-bottom: 1px solid #333;
}

.header-left h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #4fc3f7;
}

.project-name {
  font-size: 0.85rem;
  color: #888;
  margin-left: 12px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.btn-refresh {
  background: #4fc3f7;
  color: #000;
}

.btn-refresh:hover:not(:disabled) {
  background: #81d4fa;
}

.btn-refresh-styles {
  background: #e91e63;
  color: #fff;
}

.btn-refresh-styles:hover:not(:disabled) {
  background: #f48fb1;
}

/* Mode toggle button */
.btn-mode {
  background: #666;
  color: #fff;
  margin-left: 8px;
}

.btn-mode.active {
  background: #ff9800;
  color: #000;
}

.btn-mode:hover {
  background: #888;
}

.no-layers {
  color: #888;
  font-size: 0.85rem;
  font-style: italic;
  text-align: center;
  padding: 8px;
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 320px;
  background: #16213e;
  border-right: 1px solid #333;
  overflow-y: auto;
  padding: 16px;
}

.sidebar-section {
  margin-bottom: 20px;
}

.sidebar-section h3 {
  margin: 0 0 12px 0;
  font-size: 1rem;
  color: #4fc3f7;
  border-bottom: 1px solid #333;
  padding-bottom: 8px;
}

.layer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.layer-item {
  padding: 8px 12px;
  background: #1a1a2e;
  border-radius: 6px;
  transition: all 0.2s;
}

.layer-item:hover {
  background: #252547;
}

.layer-item.active {
  background: #2a3f5f;
  border-left: 3px solid #4fc3f7;
}

.layer-item label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.layer-name {
  flex: 1;
  font-size: 0.9rem;
}

.layer-source {
  font-size: 0.7rem;
  padding: 2px 6px;
  background: #4fc3f7;
  color: #000;
  border-radius: 10px;
  margin-left: 4px;
}

.loading-indicator {
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.layer-details {
  background: #1a1a2e;
  border-radius: 6px;
  padding: 12px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.85rem;
}

.detail-row .label {
  color: #888;
}

.detail-row .value {
  color: #4fc3f7;
}

.style-preview {
  margin-top: 12px;
  background: #1a1a2e;
  border-radius: 6px;
  padding: 12px;
}

.style-preview h4 {
  margin: 0 0 8px 0;
  font-size: 0.85rem;
  color: #888;
}

.style-preview pre {
  margin: 0;
  font-size: 0.75rem;
  color: #aaa;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.map-container {
  flex: 1;
  position: relative;
}

.map {
  width: 100%;
  height: 100%;
}

.map-info {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.8rem;
  display: flex;
  gap: 12px;
}

.status-bar {
  padding: 8px 20px;
  background: #16213e;
  border-top: 1px solid #333;
  font-size: 0.85rem;
  color: #4fc3f7;
}

.status-bar.error {
  color: #ff6b6b;
  background: #2a1a1a;
}
</style>
