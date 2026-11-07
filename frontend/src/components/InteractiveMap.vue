<template>
  <div ref="rootEl" class="interactive-map-container">
    <!-- Map Container -->
    <div ref="mapContainer" class="map-wrapper"></div>

    <!-- PostGIS basemap layer filters (marketing/home preview only).
         When the host opts out of dynamic-layers fetch, this floating
         panel exposes per-layer toggles backed by the tile catalog. -->
    <MapLayerFilters v-if="!props.fetchLayers" :map="map" />

    <!-- Authoritative QGIS project layers. QGIS Server renders these itself
         (WMS), so the home map shows the same pixels as QGIS Desktop and
         /qgis-map. Falls back to PostGIS/WFS vectors if the server is down. -->
    <QgisLayerPanel :map="map" />

    <!-- Interactive GIS toolset: search, measure, notification radius,
         satellite/hybrid imagery, PDF export, live coordinate readout. -->
    <MapToolbar :map="map" />

    <!-- Attribute table: browse/filter a layer's features, click to zoom. -->
    <AttributeTable :map="map" />

    <!-- Data import: upload GeoJSON/KML/shapefile, preview, save to PostGIS. -->
    <DataImport :map="map" />


    <!-- Fullscreen lives in MapLibre's own top-right control column (see
         onMounted). The floating panel it replaced sat on top of that column
         and hid the zoom buttons, and it fullscreened only the canvas, so
         the search, toolbar and layer panels vanished in fullscreen. -->

    <!-- The Layers panel that lived here listed the same store layers as
         the explorer rail beside it — two switches for one thing. The
         explorer is the only host, and its rail owns layer toggling. -->

    <!-- Search Bar -->
    <div class="search-container">
      <div class="search-input-wrapper">
        <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
        <input 
          v-model="searchQuery"
          @input="handleSearch"
          type="text" 
          placeholder="Search places, addresses, coordinates..."
          class="search-input"
        />
      </div>
      
      <!-- Search Results -->
      <div v-if="searchResults.length > 0" class="search-results">
        <div 
          v-for="result in searchResults" 
          :key="result.id"
          @click="flyToLocation(result)"
          class="search-result-item"
        >
          <div class="result-name">{{ result.name }}</div>
          <div class="result-description">{{ result.description }}</div>
        </div>
      </div>
    </div>
    
    <!-- Loading Indicator -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>Loading map...</p>
    </div>
    
    <!-- No feature popup of its own: it opened alongside the host's feature
         dialog, so one click showed the same feature twice. The host renders
         the `feature-clicked` event. -->
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSpatialStore } from '@/stores/spatial'
import { addVunguBasemap, setBasemapLayerVisible as _setBasemapLayerVisible } from '@/map/vunguBasemap'
import { prefetchTileLayerCatalog, tileUrlTemplate } from '@/services/vectorTiles'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import QgisLayerPanel from '@/components/QgisLayerPanel.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'
import AttributeTable from '@/components/map/AttributeTable.vue'
import DataImport from '@/components/map/DataImport.vue'
import { SVGSymbolGenerator, SVGSymbolCache } from '@/utils/svgSymbols'

// Props
const props = defineProps({
  center: {
    type: Array as unknown as () => [number, number],
    default: () => [30.0, -20.0]
  },
  zoom: {
    type: Number,
    default: 10
  },
  layers: {
    type: Array,
    default: () => []
  },
  // When false, the map will not call /dynamic-layers/layers on mount.
  // The home page (marketing preview) sets this to false so a backend
  // outage doesn't surface a 500 in the console for unauthenticated visitors.
  fetchLayers: {
    type: Boolean,
    default: true
  },
  // When true, grey-out everything outside Vungu district and fitBounds to
  // the Vungu planning extent on load. Intended for the home page preview.
  vunguOnly: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits([
  'map-ready',
  'layer-added',
  'layer-removed',
  'layer-error',
  'feature-clicked'
])

interface MapLayer {
  id: string
  name: string
  description: string
  color: string
  visible: boolean
  type: 'polygon' | 'line' | 'point'
  data?: any
}

interface SearchResult {
  id: string
  name: string
  description: string
  coordinates: [number, number]
}

interface DynamicLayer {
  id: string
  name: string
  type: string
  description: string
  geometry_type?: string
  style_config?: any
  style: {
    color?: string
    radius?: number
    strokeWidth?: number
    fillOpacity?: number
    _style?: {
      type: string
      fillColor?: string
      fillOpacity?: number
      strokeColor?: string
      strokeWidth?: number
      color?: string
      width?: number
      opacity?: number
      radius?: number
    }
    _rendererType?: string
    _categories?: Array<{
      value: any
      label: string
      style: {
        type: string
        fillColor?: string
        fillOpacity?: number
        strokeColor?: string
        strokeWidth?: number
        color?: string
        width?: number
        opacity?: number
        radius?: number
      }
    }>
  }
}

// Reactive state
const mapContainer = ref<HTMLElement>()
const rootEl = ref<HTMLElement>()
const map = shallowRef<maplibregl.Map>()
const loading = ref(true)
const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
let vunguMaskLoaded = false

// Pinia store
const spatialStore = useSpatialStore()

// Computed properties
const availableLayers = computed(() => spatialStore.allAvailableLayers.filter(layer => layer && layer.id))

// Watch for layer changes
watch(availableLayers, (newLayers) => {
  console.log('🔄 Available layers updated:', newLayers.length, 'layers')
})


// Available layers from store
// const availableLayers = ref<MapLayer[]>([]) // Removed - now using computed

// Load the Vungu grey mask (country minus ward union) and apply as fill,
// then overlay the district boundary as a crisp line layer.
const applyVunguMask = async () => {
  if (vunguMaskLoaded || !map.value) return
  try {
    // Cache-bust daily — forces new geometry after boundary fixes without
    // hitting the server on every load. Key is just the UTC date.
    const today = new Date().toISOString().slice(0, 10)
    const [maskRes, boundaryRes] = await Promise.all([
      fetch(`/api/map-search/vungu-mask?d=${today}`),
      fetch(`/api/map-search/vungu-boundary?d=${today}`),
    ])
    if (!map.value) return

    if (maskRes.ok) {
      const geojson = await maskRes.json()
      if (!map.value.getSource('vungu-grey-mask')) {
        map.value.addSource('vungu-grey-mask', { type: 'geojson', data: geojson })
        map.value.addLayer({
          id: 'vungu-grey-mask',
          type: 'fill',
          source: 'vungu-grey-mask',
          paint: { 'fill-color': '#6b7280', 'fill-opacity': 0.5 },
        })
      }
    }

    if (boundaryRes.ok) {
      const boundary = await boundaryRes.json()
      if (!map.value.getSource('vungu-boundary')) {
        map.value.addSource('vungu-boundary', { type: 'geojson', data: boundary })
        // Outer casing — white halo for contrast on any basemap
        map.value.addLayer({
          id: 'vungu-boundary-casing',
          type: 'line',
          source: 'vungu-boundary',
          layout: { 'line-cap': 'butt', 'line-join': 'miter' },
          paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.7 },
        })
        // Inner line — black district boundary
        map.value.addLayer({
          id: 'vungu-boundary-line',
          type: 'line',
          source: 'vungu-boundary',
          layout: { 'line-cap': 'butt', 'line-join': 'miter' },
          paint: { 'line-color': '#111827', 'line-width': 2.5, 'line-opacity': 1 },
        })
      }
    }

    vunguMaskLoaded = true
  } catch {
    // backend unreachable — silently skip mask
  }
}

// Fly the map to a bounding box returned by /api/map-query.
// Called by the parent view's search sidebar.
const flyToResult = (bbox: [number, number, number, number]) => {
  if (!map.value) return
  map.value.fitBounds(
    [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
    { padding: 60, maxZoom: 14, duration: 800 }
  )
}

// Initialize map
const initializeMap = () => {
  if (!mapContainer.value) return

  // When the host opts out of dynamic layers (home/marketing preview),
  // skip the external demotiles style — it 404s in offline/restricted
  // networks and leaves only a label, which looks like a broken map.
  // The PostGIS basemap (addVunguBasemap below) is the entire content.
  // Cream land base (mirrors MAP_BACKGROUND in vunguBasemapStyle.ts) —
  // the classic OpenStreetMap (OSM Carto) document-like background that
  // the landuse, road, and building layers are painted on top of.
  const blankStyle = {
    version: 8 as const,
    sources: {},
    layers: [
      { id: 'background', type: 'background' as const, paint: { 'background-color': '#f2efe9' } },
    ],
    glyphs: '/fonts/{fontstack}/{range}.pbf',
  }
  // Always start from the self-hosted blank (cream) base; addVunguBasemap
  // paints the PostGIS layers on top. No external demo basemap (fix F11).
  const style = blankStyle as any
  // Vungu RDC district centre — Midlands Province, pcode ZW1704
  const initialZoom = props.fetchLayers ? 10 : 6
  const initialCenter: [number, number] = props.fetchLayers ? [29.82, -19.48] : [29.82, -19.48]

  map.value = new maplibregl.Map({
    container: mapContainer.value,
    style,
    center: initialCenter,
    zoom: initialZoom,
    // Allow zooming all the way down to street/building scale — the
    // backend tile registry covers up to z22 for every layer, so we
    // expose the full range to the user rather than capping at MapLibre's
    // default. Past z22 MapLibre overzooms the last available tile.
    minZoom: 1,
    maxZoom: 22,
    // Disable MapLibre's built-in attribution; we add a compact custom
    // one with proper OSM credit below so the data lineage is visible
    // but the control doesn't eat the corner.
    attributionControl: false,
    // Retain the WebGL drawing buffer so MapToolbar's "Export PDF" can read
    // the rendered canvas back with toDataURL() (otherwise it comes out blank).
    preserveDrawingBuffer: true,
  })

  // Compact attribution: OSM data + a hint at the renderer. Sits in the
  // bottom-right and stays out of the way until the user hovers.
  map.value.addControl(
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }),
    'bottom-right',
  )
  // Compact attribution opens expanded; on a phone that is a third of the
  // bottom edge, over the attribute-table tab. Start it folded — the
  // credit stays one tap away on the "i".
  if (window.matchMedia?.('(max-width: 767px)').matches) {
    mapContainer.value
      ?.querySelector('.maplibregl-ctrl-attrib')
      ?.classList.remove('maplibregl-compact-show')
  }

  // Add navigation control. `visualizePitch` adds the tilt indicator to
  // the compass so users can see and reset the 3D camera angle; the
  // basemap auto-tilts into 3D when zoomed into a city.
  map.value.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    'top-right',
  )

  // Fullscreen the whole component, not just the canvas, so the overlays
  // come with it.
  map.value.addControl(
    new maplibregl.FullscreenControl({ container: rootEl.value }),
    'top-right',
  )

  // Add scale control
  map.value.addControl(new maplibregl.ScaleControl(), 'bottom-left')

  // Locate-me: GPS puck with continuous tracking. Critical for field
  // inspectors and citizens on phones ("find my stand") — PRODUCT.md's
  // first job is "locate land".
  map.value.addControl(
    // `showUserHeading` is valid in maplibre-gl v4 at runtime, but the stale
    // @types/maplibre-gl@1 pin in this repo doesn't declare it — cast to keep
    // the heading indicator without a type error.
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    } as any),
    'top-right',
  )

  // Map load event
  map.value.on('load', async () => {
    if (map.value) addVunguBasemap(map.value)
    loading.value = false
    emit('map-ready', map.value)

    // Initialize SVG symbols for business centres — fire in background so it
    // doesn't block tile loading or the map-ready signal.
    initializeSVGSymbols()

    // Load available layers from store (only if requested by the host view).
    // The marketing/home preview opts out via :fetch-layers="false" so a
    // backend outage doesn't produce console noise for unauthenticated visitors.
    if (props.fetchLayers
        && !spatialStore.isLoading
        && spatialStore.availableLayers.length === 0) {
      spatialStore.loadLayers()
    }

    // Vungu-only mode: fit to district extent and apply grey mask
    if (props.vunguOnly || !props.fetchLayers) {
      const bounds: [number, number, number, number] = [29.55, -19.85, 30.15, -19.25]
      map.value?.fitBounds(
        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
        { padding: 24, duration: 0 }
      )
      applyVunguMask()
    }

    // Add interaction handlers
    map.value?.on('click', handleMapClick)
    map.value?.on('mousemove', handleMapHover)
  })
}

// Apply circle fallback for SVG loading errors
const applyCircleFallback = (cat: any, symbolConfig: any, symbolLayerId: string, sourceId: string, categorizationField: string) => {
  const fallbackColors: Record<string, string> = {
    'BC': '#FF6B6B',  // Business Centre - Red
    'GP': '#4ECDC4',  // Growth Point - Teal
    'RSC': '#45B7D1'  // Rural Service Centre - Blue
  }
  
  symbolConfig.type = 'circle'
  symbolConfig.paint = {
    'circle-color': fallbackColors[cat.value] || '#45B7D1',
    'circle-radius': 8,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': 0.8
  }
  
  if (map.value) {
    map.value.addLayer(symbolConfig)
    console.log(`[Map] 🔄 Applied circle fallback for ${cat.label}`)
  }
}

// Apply frontend SVG fallback when QGIS SVG is not available
const applyFrontendSVGFallback = (cat: any, symbolConfig: any, symbolLayerId: string, sourceId: string, categorizationField: string, layerIdMap: string, categoryId: string) => {
  console.log(`[Map] 🔄 Applying frontend SVG fallback for ${cat.label}`)
  
  // Create SVG configuration from QGIS data
  const qgisStyle = cat._style || {}
  const svgConfig = SVGSymbolGenerator.createConfigFromQGIS(qgisStyle, cat.value)
  
  console.log(`[Map] 🎯 Frontend SVG Config:`, svgConfig)
  
  // Generate SVG for this specific category
  const svg = SVGSymbolGenerator.generateSVG(svgConfig)
  const dataURL = SVGSymbolGenerator.generateDataURL(svg)
  const symbolName = `${layerIdMap}-${categoryId}-svg`
  
  // Load SVG as image and add to map
  const loadSVG = async () => {
    try {
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = dataURL
      })
      
      if (map.value && !map.value.hasImage(symbolName)) {
        map.value.addImage(symbolName, img)
        console.log(`[Map] ✅ Added frontend SVG symbol: ${symbolName}`)
        
        // Create symbol layer with SVG
        const svgSymbolConfig: any = {
          id: symbolLayerId,
          source: sourceId,
          type: 'symbol' as const,
          filter: ['==', ['get', categorizationField], cat.value],
          layout: {
            'icon-image': symbolName,
            'icon-size': 1.0,
            'icon-anchor': 'center',
            'icon-allow-overlap': true
          },
          paint: {
            'icon-opacity': svgConfig.opacity
          }
        }
        
        // Check if layer already exists and remove it
        if (map.value.getLayer(symbolLayerId)) {
          console.log(`[Map] 🗑️ Removing existing layer: ${symbolLayerId}`)
          map.value.removeLayer(symbolLayerId)
        }
        
        if (map.value) {
          map.value.addLayer(svgSymbolConfig)
          console.log(`[Map] 🎨 Applied frontend SVG symbol layer for ${cat.label}`)
          console.log(`   - Shape: ${svgConfig.shape}`)
          console.log(`   - Color: ${svgConfig.color}`)
          console.log(`   - Size: Dynamic`)
          console.log(`   - Rotation: ${svgConfig.rotation}°`)
          console.log(`   - Scale: ${svgConfig.scale}x`)
        }
      }
    } catch (error) {
      console.error(`[Map] ❌ Error loading frontend SVG for ${cat.label}:`, error)
      // Final fallback to circle styling
      applyCircleFallback(cat, symbolConfig, symbolLayerId, sourceId, categorizationField)
    }
  }
  
  loadSVG()
}

// Initialize SVG symbols
const initializeSVGSymbols = async () => {
  if (!map.value) return
  
  console.log('[Map] 🎨 Initializing SVG symbols for 100% QGIS matching...')
  
  // Helper function to load SVG as image
  const loadSVGAsImage = (dataURL: string, id: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        if (map.value && !map.value.hasImage(id)) {
          map.value.addImage(id, img)
          console.log(`[Map] ✅ Added SVG symbol: ${id}`)
        }
        resolve()
      }
      img.onerror = reject
      img.src = dataURL
    })
  }
  
  // Add pre-generated SVG symbols to map
  const symbolPromises: Promise<void>[] = []
  Object.entries(SVGSymbolCache).forEach(([key, dataURL]) => {
    symbolPromises.push(loadSVGAsImage(dataURL, key))
  })
  
  // Generate and add dynamic SVG symbols for business centres
  const businessSymbols = [
    { shape: 'square', color: '#000000', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 },
    { shape: 'triangle', color: '#ffffff', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 },
    { shape: 'diamond', color: '#ffffff', strokeColor: '#2c3e50', strokeWidth: 1, rotation: 0, scale: 1, opacity: 1 }
  ]
  
  businessSymbols.forEach((config, index) => {
    const svg = SVGSymbolGenerator.generateSVG(config)
    const dataURL = SVGSymbolGenerator.generateDataURL(svg)
    const symbolName = `business-${config.shape}-${index}`
    
    symbolPromises.push(loadSVGAsImage(dataURL, symbolName))
  })
  
  try {
    await Promise.all(symbolPromises)
    console.log('[Map] 🎨 SVG symbols initialized successfully!')
  } catch (error) {
    console.error('[Map] ❌ Error loading SVG symbols:', error)
  }
}

const addLayerToMap = async (layerId: string) => {
  try {
    let layerInfo: any = availableLayers.value.find(l => l.id === layerId)
    
    // For wfs- layers not directly in allAvailableLayers, look up the wms- counterpart
    if (!layerInfo && layerId.startsWith('wfs-')) {
      const layerName = layerId.slice(4)
      layerInfo = availableLayers.value.find(l => l.id === `wms-${layerName}`)
        || { id: layerId, name: layerName, layerName }
    }
    
    if (!map.value || !layerInfo) return
    
    // Handle WMS layers differently
    if (layerId.startsWith('wms-')) {
      console.log(`[Map] 🖼️ Adding WMS layer: ${layerId}`)
      await addWMSLayerToMap(layerId, layerInfo)
      return
    }
    
    // Handle WFS layers differently
    if (layerId.startsWith('wfs-')) {
      console.log(`[Map] 🌐 Adding WFS layer: ${layerId}`)
      await addWFSLayerToMap(layerId, layerInfo)
      return
    }
    
    // Handle regular vector layers
    const geojson = await spatialStore.loadLayerData(layerId)
    
    if (!geojson) return
    
    const sourceId = `source-${layerId}`
    const layerIdMap = `layer-${layerId}`
    
    // Add source
    map.value.addSource(sourceId, {
      type: 'geojson',
      data: geojson
    })
    
    // The drawn geometry decides the layer type. This used to read
    // `layerInfo.geometry_type`, a field the catalogue does not send (it
    // sends `type`), so every layer fell back to 'point' and rivers, farms
    // and boundaries were drawn as a dot on every vertex.
    const geometryType = geometryKindOf(geojson, layerInfo)
    let layerConfig = getLayerConfig(geometryType)
    
    // Apply intelligent auto-styling if available, otherwise use default for uploaded layers
    if (layerInfo?.style_config) {
      console.log('[Map] 🤖 Applying intelligent auto-styling for layer:', layerId, layerInfo.style_config)
      layerConfig = applyIntelligentAutoStyling(layerConfig, layerInfo.style_config, geometryType, sourceId, layerIdMap)
    } else if (layerInfo?.style?._style) {
      console.log('[Map] 🤖 Applying intelligent auto-styling for layer:', layerId, layerInfo.style)
      layerConfig = applyIntelligentAutoStyling(layerConfig, layerInfo.style, geometryType, sourceId, layerIdMap)
    } else if (layerInfo?.description?.includes('QGIS uploaded') || layerInfo?.name === 'proposed_peri_urban_zones') {
      // Apply default styling for uploaded QGIS layers
      console.log('[Map] 🎨 Applying default styling for uploaded QGIS layer:', layerId)
      console.log('[Map] 📋 Layer info:', { name: layerInfo?.name, description: layerInfo?.description, style: layerInfo?.style })
      layerConfig = {
        type: 'fill',
        layout: {},
        paint: {
          'fill-color': '#27ae60',
          'fill-opacity': 0.6,
          'fill-outline-color': '#2c3e50'
        }
      }
    }
    
    map.value.addLayer({
      id: layerIdMap,
      source: sourceId,
      type: layerConfig.type,
      paint: layerConfig.paint,
      layout: layerConfig.layout
    })
    
    // Add label layer if configured
    if (layerConfig._labelConfig) {
      console.log('[Map] 🏷️ Adding label layer')
      map.value.addLayer({
        id: `${layerIdMap}-labels`,
        source: sourceId,
        type: 'symbol',
        layout: {
          'text-field': ['get', layerConfig._labelConfig.field],
          'text-font': ['Open Sans Regular'],   // OpenFreeMap serves this; the default stack 404s
          'text-size': layerConfig._labelConfig.size,
          'text-anchor': 'bottom',
          'text-offset': [0, 1]
        },
        paint: {
          'text-color': layerConfig._labelConfig.color,
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      })
    }
    
    // Add medical cross symbol layer if detected
    if (layerConfig._medicalCross) {
      console.log('[Map] 🏥 Adding medical cross symbol layer')
      
      // Add a simple cross using text symbol
      map.value.addLayer({
        id: `${layerIdMap}-cross-text`,
        source: sourceId,
        type: 'symbol',
        layout: {
          'text-field': '+', // Simple cross symbol
          'text-font': ['Open Sans Regular'],   // OpenFreeMap serves this; the default stack 404s
          'text-size': (layerConfig._medicalCross.size || 6) * 2,
          'text-anchor': 'center',
          'text-allow-overlap': true
        },
        paint: {
          'text-color': layerConfig._medicalCross.color || '#ff0000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      })
      
      console.log('[Map] 🏥 Medical cross layers added')
    }
    
    // Add interaction layer for hover/click
    const interactivePaint = { ...layerConfig.paint }
    if (layerConfig.type === 'fill') {
      interactivePaint['fill-opacity'] = 0.1
    } else if (layerConfig.type === 'circle') {
      interactivePaint['circle-opacity'] = 0.5
    } else if (layerConfig.type === 'line') {
      interactivePaint['line-opacity'] = 0.5
    }
    
    map.value.addLayer({
      id: `${layerIdMap}-interactive`,
      source: sourceId,
      type: layerConfig.type,
      paint: interactivePaint,
      layout: layerConfig.layout
    })
    
    console.log(`✅ Layer ${layerId} added to map with ${geojson.geometries?.length || 0} geometries`)
    emit('layer-added', layerId)
    
  } catch (error) {
    console.error(`Failed to add layer ${layerId}:`, error)
  }
}

const removeLayerFromMap = (layerId: string) => {
  const m = map.value
  if (!m) return

  // Remove all sub-layers first (business centre symbol layers, labels, patterns, etc.)
  const layersToRemove: string[] = []
  m.getStyle().layers.forEach(layer => {
    if (layer.id.startsWith(layerId) || layer.id.startsWith(`layer-${layerId}`)) {
      layersToRemove.push(layer.id)
    }
  })

  // Remove sub-layers in reverse order to avoid dependency issues
  layersToRemove.reverse().forEach(layerIdToRemove => {
    if (m.getLayer(layerIdToRemove)) {
      m.removeLayer(layerIdToRemove)
      console.log(`[Map] 🗑️ Removed sub-layer: ${layerIdToRemove}`)
    }
  })

  // Remove the main layer
  if (m.getLayer(`layer-${layerId}`)) {
    m.removeLayer(`layer-${layerId}`)
  }

  // Remove the source
  if (m.getSource(`source-${layerId}`)) {
    m.removeSource(`source-${layerId}`)
  }
  
  console.log(`[Map] 🗑️ Removed layer ${layerId} and all sub-layers`)
  emit('layer-removed', layerId)
}

const addWMSLayerToMap = async (layerId: string, layerInfo: any) => {
  try {
    console.log(`[Map] 🖼️ Adding WMS layer: ${layerId}`)
    
    // Get WMS map URL from the layer data
    const layerData = spatialStore.getLayerData(layerId)
    console.log(`[Map] 📋 Layer data:`, layerData)
    
    if (!layerData || !layerData.url) {
      console.error(`[Map] ❌ No WMS URL found for layer: ${layerId}`)
      return
    }
    
    const sourceId = `source-${layerId}`
    const layerIdMap = `layer-${layerId}`
    const m = map.value
    if (!m) return

    // Use direct WMS image URL for better quality
    try {
      console.log(`[Map] 🖼️ Using direct WMS URL for layer: ${layerId}`)

      // Add WMS image source with direct URL
      m.addSource(sourceId, {
        type: 'image',
        url: layerData.url,
        coordinates: [
          [layerData.metadata?.bbox?.minx || 25.24, layerData.metadata?.bbox?.maxy || -15.61], // Top-left
          [layerData.metadata?.bbox?.maxx || 33.07, layerData.metadata?.bbox?.maxy || -15.61], // Top-right
          [layerData.metadata?.bbox?.maxx || 33.07, layerData.metadata?.bbox?.miny || -22.42], // Bottom-right
          [layerData.metadata?.bbox?.minx || 25.24, layerData.metadata?.bbox?.miny || -22.42]  // Bottom-left
        ]
      })
    } catch (fetchError) {
      console.error(`[Map] ❌ Failed to load WMS image for layer ${layerId}:`, fetchError)
      return
    }
    
    // Add WMS layer with better rendering
    m.addLayer({
      id: layerIdMap,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 1.0,
        'raster-resampling': 'linear' // Better resampling for quality
      }
    })
    
    // Add interactive layer for click events (optional)
    m.addLayer({
      id: `${layerIdMap}-interactive`,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': 0 // Invisible, just for events
      }
    })
    
    console.log(`[Map] ✅ WMS layer added: ${layerId}`)
    emit('layer-added', layerId)

    // Detect WMS tile-fetch failures (e.g. QGIS Server 500) via the map error event
    const onSourceError = (e: any) => {
      if (e.sourceId === sourceId) {
        console.warn(`[Map] ⚠️ WMS source error for ${layerId} (status ${e.error?.status || '?'}) - removing`)
        map.value?.off('error', onSourceError)
        removeLayerFromMap(layerId)
        emit('layer-error', layerId)
      }
    }
    map.value?.on('error', onSourceError)
    
  } catch (error) {
    console.error(`[Map] ❌ Failed to add WMS layer ${layerId}:`, error)
    emit('layer-error', layerId)
  }
}

const addWFSLayerToMap = async (layerId: string, layerInfo: any) => {
  try {
    console.log(`[Map] 🌐 Adding WFS layer: ${layerId}`)
    
    // Get WFS feature data from the spatial store
    const layerData = spatialStore.getLayerData(layerId)
    console.log(`[Map] 📋 WFS layer data:`, layerData)
    
    if (!layerData || !layerData.features) {
      console.error(`[Map] ❌ No WFS features found for layer: ${layerId}`)
      return
    }
    
    const sourceId = `source-${layerId}`
    const layerIdMap = `layer-${layerId}`
    const m = map.value
    if (!m) return

    // Convert non-standard format to proper GeoJSON FeatureCollection
    const originalFeatures = layerData.features.features || []
    const geoJsonFeatures = originalFeatures.map((feature: any) => {
      // If the feature itself is the geometry (non-standard), wrap it
      if (feature.type && feature.coordinates) {
        return {
          type: 'Feature',
          geometry: {
            type: feature.type,
            coordinates: feature.coordinates
          },
          properties: feature.properties || {}
        }
      }
      // Standard GeoJSON feature
      return feature
    })
    
    const properGeoJson: any = {
      type: 'FeatureCollection',
      features: geoJsonFeatures
    }
    
    console.log(`[Map] 🔄 Converted to proper GeoJSON:`, properGeoJson)
    
    // Add WFS GeoJSON source
    m.addSource(sourceId, {
      type: 'geojson',
      data: properGeoJson as any
    })
    
    // Determine geometry type from features
    if (originalFeatures.length === 0) {
      console.warn(`[Map] ⚠️ No features in WFS layer: ${layerId}`)
      return
    }
    
    const firstFeature = originalFeatures[0]
    console.log(`[Map] 🔍 First feature structure:`, firstFeature)
    console.log(`[Map] 🔍 Feature geometry:`, firstFeature.geometry)
    
    // Handle nested geometry structure
    let geometryType = null
    
    console.log(`[Map] 🔍 First feature structure:`, firstFeature)
    
    // The feature itself might be the geometry (non-standard format)
    if (firstFeature.type && firstFeature.coordinates) {
      geometryType = firstFeature.type
      console.log(`[Map] 🔍 Feature IS the geometry: ${geometryType}`)
    } else if (firstFeature.geometry && firstFeature.geometry.type) {
      geometryType = firstFeature.geometry.type
      console.log(`[Map] 🔍 Found geometry type in .geometry.type: ${geometryType}`)
    } else if (firstFeature.geometry && firstFeature.geometry.geometries && firstFeature.geometry.geometries.length > 0) {
      geometryType = firstFeature.geometry.geometries[0].type
      console.log(`[Map] 🔍 Found geometry type in .geometry.geometries[0]: ${geometryType}`)
    } else {
      // Try to find type in any nested structure
      const findType = (obj: any): any => {
        if (!obj) return null
        if (obj.type) return obj.type
        if (obj.geometries && obj.geometries.length > 0) return findType(obj.geometries[0])
        if (obj.coordinates) return findType(obj.coordinates)
        return null
      }
      geometryType = findType(firstFeature)
      console.log(`[Map] 🔍 Found geometry type via deep search: ${geometryType}`)
    }
    
    console.log(`[Map] 📐 WFS geometry type: ${geometryType}`)
    
    if (!geometryType) {
      console.error(`[Map] ❌ Could not determine geometry type for WFS layer: ${layerId}`)
      return
    }
    
    // Use hardcoded styling for now (OGC Bridge styling needs debugging)
    console.log(`[Map] 🎨 Using hardcoded styling for ${layerId}`)
    
    // Apply styling based on layer name (from your earlier requirements)
    if (geometryType.includes('Polygon')) {
      let fillColor, outlineColor, outlineWidth
      
      if (layerInfo.name === 'Untitled' || layerInfo.layerName === 'gweru_rural_planning_boundary') {
        // gweru_rural_planning_boundary styling - green cross-hatch pattern from your image
        fillColor = 'rgba(34, 139, 34, 0.3)';  // Green with transparency (cross-hatch effect)
        outlineColor = 'rgb(0, 100, 0)';        // Dark green outline
        outlineWidth = 2.0;                       // Thicker outline for definition
        console.log(`[Map] 🎨 Using gweru_rural_planning_boundary green cross-hatch style`)
      } else if (layerInfo.name === 'zimbabwe' || layerInfo.layerName === 'zimbabwe') {
        // Zimbabwe styling from vungu-master-plan-working.qgs
        fillColor = 'rgb(196, 60, 57)';        // Reddish fill (196,60,57)
        outlineColor = 'rgb(140, 43, 41)';      // Darker red outline (140,43,41)
        outlineWidth = 1.5;                   // Scale 0.2mm to pixels
        console.log(`[Map] 🎨 Using Zimbabwe QGIS colors`)
      } else {
        // Default styling
        fillColor = 'rgb(0, 128, 255)';      // Default blue
        outlineColor = 'rgb(0, 0, 255)';     // Default darker blue
        outlineWidth = 1.5;
        console.log(`[Map] 🎨 Using default colors`)
      }
      
      // Apply the styling
      m.addLayer({
        id: layerIdMap,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': fillColor,
          'fill-opacity': 1.0,
          'fill-outline-color': outlineColor
        }
      })
      
      // Add outline layer for proper line width
      m.addLayer({
        id: `${layerIdMap}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': outlineColor,
          'line-width': outlineWidth,
          'line-opacity': 1.0
        }
      })
      
    } else if (geometryType.includes('LineString')) {
      m.addLayer({
        id: layerIdMap,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#45B7D1',
          'line-width': 2,
          'line-opacity': 0.8
        }
      })
    } else if (geometryType.includes('Point')) {
      m.addLayer({
        id: layerIdMap,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#45B7D1',
          'circle-opacity': 0.8,
          'circle-stroke-color': '#2c3e50',
          'circle-stroke-width': 1
        }
      })
    }
    
    console.log(`[Map] ✅ Added styled layer: ${layerId}`)
    
    console.log(`[Map] ✅ WFS layer added: ${layerId}`)
    emit('layer-added', layerId)
    
  } catch (error) {
    console.error(`[Map] ❌ Failed to add WFS layer ${layerId}:`, error)
  }
}

const addPatternLayer = (map: any, sourceId: string, baseLayerId: string, category: string, patternType: string, color: string) => {
  console.log(`[Map] 🎨 Adding ${patternType} pattern for category: ${category}`)
  
  if (patternType === 'cross-hatch') {
    // Create true cross-hatch pattern by generating internal hatch lines
    createHatchPattern(map, sourceId, baseLayerId, category, 'cross-hatch', '#000000')
    
  } else if (patternType === 'diagonal-stripes') {
    // Create diagonal stripe pattern
    createHatchPattern(map, sourceId, baseLayerId, category, 'diagonal', '#222222')
  }
}

const createHatchPattern = (map: any, sourceId: string, baseLayerId: string, category: string, patternType: string, lineColor: string) => {
  // Get the source data to extract polygon geometries
  const source = map.getSource(sourceId)
  if (!source) {
    console.log(`[Map] ❌ Source not found: ${sourceId}`)
    return
  }
  
  // Get the actual GeoJSON data
  source.getData((error: any, data: any) => {
    if (error) {
      console.log(`[Map] ❌ Error getting source data:`, error)
      return
    }
    
    // Filter features for this specific category
    const categoryFeatures = data.features.filter((feature: any) => 
      feature.properties && feature.properties.zone === category
    )
    
    console.log(`[Map] 🔍 Found ${categoryFeatures.length} features for category: ${category}`)
    
    if (categoryFeatures.length > 0) {
      // Generate hatch lines based on actual polygon geometries
      const hatchLines = generateHatchLinesFromPolygons(categoryFeatures, patternType)
      
      if (hatchLines.length > 0) {
        // Create a new source for hatch lines
        const hatchSourceId = `${sourceId}-hatch-${category.replace(/\s+/g, '-')}`
        
        // Remove existing hatch source if it exists
        if (map.getSource(hatchSourceId)) {
          map.removeSource(hatchSourceId)
        }
        
        // Add hatch lines as a new source
        map.addSource(hatchSourceId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: hatchLines
          }
        })
        
        // Add hatch line layer
        const hatchLayerId = `${baseLayerId}-hatch-${category.replace(/\s+/g, '-')}`
        
        map.addLayer({
          id: hatchLayerId,
          source: hatchSourceId,
          type: 'line',
          paint: {
            'line-color': lineColor,
            'line-width': 3.5,
            'line-opacity': 1.0
          },
          layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
          }
        })
        
        console.log(`[Map] 🎨 Created ${patternType} hatch pattern: ${hatchLines.length} lines`)
      }
    }
  })
}

const generateHatchLinesFromPolygons = (polygons: any[], patternType: string): any[] => {
  const lines: any[] = []
  
  // Calculate overall bounding box for all polygons
  let minLng = Infinity, maxLng = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  
  polygons.forEach(polygon => {
    if (polygon.geometry && polygon.geometry.coordinates) {
      const coords = polygon.geometry.coordinates[0] // Exterior ring
      coords.forEach((coord: any) => {
        const [lng, lat] = coord
        minLng = Math.min(minLng, lng)
        maxLng = Math.max(maxLng, lng)
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
      })
    }
  })
  
  console.log(`[Map] 📐 Bounding box: [${minLng}, ${minLat}] to [${maxLng}, ${maxLat}]`)
  
  // Generate hatch lines within the bounding box
  const spacing = 0.002 // Ultra-dense pattern for maximum visibility
  
  if (patternType === 'cross-hatch') {
    // Generate diagonal lines in two directions (45° and -45°)
    for (let i = 0; i < 40; i++) {
      const offset = i * spacing
      
      // First diagonal direction (45°)
      const start1 = [minLng + offset, minLat]
      const end1 = [maxLng, maxLat - (maxLng - minLng - offset)]
      
      if (end1[1] >= minLat) {
        lines.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [start1, end1]
          },
          properties: { pattern: 'cross-hatch-1' }
        })
      }
      
      // Second diagonal direction (-45°)
      const start2 = [minLng, minLat + offset]
      const end2 = [maxLng - offset, maxLat]
      
      if (end2[0] >= minLng) {
        lines.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [start2, end2]
          },
          properties: { pattern: 'cross-hatch-2' }
        })
      }
    }
  } else if (patternType === 'diagonal') {
    // Generate parallel diagonal lines
    for (let i = 0; i < 35; i++) {
      const offset = i * spacing
      
      const start = [minLng + offset, minLat]
      const end = [maxLng, maxLat - (maxLng - minLng - offset)]
      
      if (end[1] >= minLat) {
        lines.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [start, end]
          },
          properties: { pattern: 'diagonal' }
        })
      }
    }
  }
  
  return lines
}

const generateHatchLines = (category: string, patternType: string): any[] => {
  // This is a simplified version - in production, you'd calculate actual polygon bounds
  // and generate proper hatch lines within those bounds
  
  const lines: any[] = []
  
  // For demo purposes, create some sample hatch lines
  // In reality, you'd:
  // 1. Get the actual polygon geometries for this category
  // 2. Calculate their bounding boxes
  // 3. Generate lines that span across the polygon interiors
  
  if (patternType === 'cross-hatch') {
    // Generate diagonal lines in two directions (45° and -45°)
    for (let i = 0; i < 10; i++) {
      // First diagonal direction
      lines.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-18.5 + i * 0.01, -32.0 + i * 0.01],  // Start point
            [-18.0 + i * 0.01, -31.5 + i * 0.01]   // End point
          ]
        },
        properties: { category: category }
      })
      
      // Second diagonal direction (perpendicular)
      lines.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-18.5 + i * 0.01, -31.5 + i * 0.01],  // Start point
            [-18.0 + i * 0.01, -32.0 + i * 0.01]   // End point
          ]
        },
        properties: { category: category }
      })
    }
  } else if (patternType === 'diagonal') {
    // Generate parallel diagonal lines
    for (let i = 0; i < 8; i++) {
      lines.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-18.5 + i * 0.01, -32.0 + i * 0.01],  // Start point
            [-18.0 + i * 0.01, -31.5 + i * 0.01]   // End point
          ]
        },
        properties: { category: category }
      })
    }
  }
  
  return lines
}

// INTELLIGENT AUTO-STYLING SYSTEM
// Automatically detects categorization field and applies appropriate styling
const applyIntelligentAutoStyling = (baseConfig: any, qgisStyle: any, geometryType: string, sourceId: string, layerIdMap: string) => {
  console.log('[Map] 🤖 Applying intelligent auto-styling:', qgisStyle)
  
  const config = { ...baseConfig }
  
  // Auto-detect if we have categorized styling
  if (qgisStyle._rendererType === 'categorized' && qgisStyle._categories?.length > 0) {
    console.log('[Map] 🎨 Categorized styling detected with', qgisStyle._categories.length, 'categories')
    
    // Auto-detect the categorization field
    const categorizationField = detectCategorizationField(qgisStyle._categories, geometryType)
    console.log('[Map] 🔍 Auto-detected categorization field:', categorizationField)
    
    // Apply intelligent categorized styling
    return applyIntelligentCategorizedStyling(config, qgisStyle, geometryType, categorizationField, sourceId, layerIdMap)
  } else {
    // Apply intelligent single symbol styling
    console.log('[Map] 🎨 Single symbol styling detected')
    return applyIntelligentSingleStyling(config, qgisStyle, geometryType)
  }
}

// Auto-detect the best categorization field based on data analysis
const detectCategorizationField = (categories: any[], geometryType?: string): string => {
  // Analyze category values to determine the field type
  const sampleValues = categories.slice(0, 5).map(cat => cat.value?.toLowerCase() || '')
  
  console.log(`[Map] 🔍 Analyzing categories for field detection:`, sampleValues)
  console.log(`[Map] 🔍 Geometry type: ${geometryType}`)
  
  // Point layers typically use sector-based categorization
  if (geometryType === 'point') {
    if (sampleValues.some(val => val.includes('bc') || val.includes('gp') || val.includes('rsc'))) {
      console.log('[Map] 🔍 Detected business centre categorization - using sector field')
      return 'sector'
    }
  }
  
  // Zone-based categorization (urban planning layers)
  if (sampleValues.some(val => val.includes('residential') || val.includes('density') || val.includes('zone'))) {
    console.log('[Map] 🔍 Detected zone-based categorization - using zone field')
    return 'zone'
  }
  
  // Village-based categorization (administrative layers)
  if (sampleValues.some(val => val.includes('village') || val.includes('insukamini') || val.includes('gunde'))) {
    console.log('[Map] 🔍 Detected village-based categorization - using village_na field')
    return 'village_na'
  }
  
  // Sector-based categorization (point layers)
  if (sampleValues.some(val => val.includes('health') || val.includes('education') || val.includes('business'))) {
    console.log('[Map] 🔍 Detected sector-based categorization - using sector field')
    return 'sector'
  }
  
  // Type-based categorization (general layers)
  if (sampleValues.some(val => val.includes('type') || val.includes('primary') || val.includes('secondary'))) {
    console.log('[Map] 🔍 Detected type-based categorization - using type field')
    return 'type'
  }
  
  // Default based on geometry type
  const defaultField = geometryType === 'point' ? 'sector' : 'zone'
  console.log(`[Map] 🔍 Using default field for ${geometryType}: ${defaultField}`)
  return defaultField
}

// Apply intelligent categorized styling
const applyIntelligentCategorizedStyling = (config: any, qgisStyle: any, geometryType: string, categorizationField: string, sourceId: string, layerIdMap: string) => {
  config.type = geometryType === 'polygon' ? 'fill' : geometryType === 'point' ? 'circle' : 'line'
  
  // Special handling for business centres with QGIS-extracted symbology
  if (geometryType === 'point' && layerIdMap.includes('business_centres')) {
    console.log('[Map] 🏢 Applying QGIS-extracted business centre symbology')
    
    // Create separate layers for each business centre type using QGIS symbology
    const categories = qgisStyle._categories || []
    
    // Create individual layers for each category with QGIS-extracted symbols
    categories.forEach((cat: any, index: number) => {
      if (cat.value && cat.value !== 'None') {
        const categoryId = cat.value.toLowerCase().replace(/[^a-z0-9]/g, '_')
        const symbolLayerId = `${layerIdMap}-${categoryId}-symbol`
        
        console.log(`[Map] 🏢 Creating QGIS symbol layer for ${cat.label}`)
        console.log(`[Map] 🎨 QGIS symbology data:`, cat)
        console.log(`[Map] 🔍 All category keys:`, Object.keys(cat))
        console.log(`[Map] 🔍 All category values:`, Object.keys(cat).map(key => `${key}: ${JSON.stringify(cat[key])}`))
        
        // Check nested _style properties
        if (cat._style) {
          console.log(`[Map] 🔍 _style keys:`, Object.keys(cat._style))
          console.log(`[Map] 🔍 _style values:`, Object.keys(cat._style).map(key => `${key}: ${JSON.stringify(cat._style[key])}`))
        }
        
        // Remove existing layer if it exists
        if (map.value?.getLayer(symbolLayerId)) {
          map.value.removeLayer(symbolLayerId)
          console.log(`[Map] 🗑️ Removed existing layer: ${symbolLayerId}`)
        }
        
        // Use QGIS-extracted symbology or fallback to basic styling
        let symbolConfig: any = {
          id: symbolLayerId,
          source: sourceId,
          type: 'circle',
          filter: ['==', ['get', categorizationField], cat.value],
          paint: {}
        }
        
        // Apply QGIS-extracted symbology properties with QGIS SVG data
        if (cat._style || cat.symbolType || cat.symbolName || cat.symbolLayer || cat.svgPath || cat.svgDataUrl) {
          console.log(`[Map] 🎨 Using QGIS SVG symbology for ${cat.label}:`)
          console.log(`   - Symbol Type: ${cat.symbolType || cat._style?.symbolType}`)
          console.log(`   - Symbol Name: ${cat.symbolName || cat._style?.symbolName}`)
          console.log(`   - Symbol Layers: ${cat.symbolLayer?.length || cat._style?.symbolLayer?.length || 0}`)
          console.log(`   - QGIS SVG Path: ${cat.svgPath ? '✅ Available' : '❌ None'}`)
          console.log(`   - QGIS SVG Data URL: ${cat.svgDataUrl ? '✅ Available' : '❌ None'}`)
          
          // Apply QGIS symbology properties (check both flattened and nested)
          const qgisStyle = cat._style || {}
          
          // 🎯 PRIORITY 1: Use QGIS-provided SVG data
          if (cat.svgDataUrl) {
            console.log(`[Map] 🎯 Using QGIS-provided SVG data URL`)
            const symbolName = `${layerIdMap}-${categoryId}-qgis-svg`
            
            // Load QGIS SVG as image and add to map
            const loadQGISSVG = async () => {
              try {
                const img = new Image()
                await new Promise((resolve, reject) => {
                  img.onload = resolve
                  img.onerror = reject
                  img.src = cat.svgDataUrl
                })
                
                if (map.value && !map.value.hasImage(symbolName)) {
                  map.value.addImage(symbolName, img)
                  console.log(`[Map] ✅ Added QGIS SVG symbol: ${symbolName}`)
                  
                  // Create symbol layer with QGIS SVG
                  const qgisSymbolConfig: any = {
                    id: symbolLayerId,
                    source: sourceId,
                    type: 'symbol' as const,
                    filter: ['==', ['get', categorizationField], cat.value],
                    layout: {
                      'icon-image': symbolName,
                      'icon-size': 1.0,
                      'icon-anchor': 'center',
                      'icon-allow-overlap': true
                    },
                    paint: {
                      'icon-opacity': cat.opacity || qgisStyle.opacity || 1
                    }
                  }
                  
                  if (map.value) {
                    map.value.addLayer(qgisSymbolConfig)
                    console.log(`[Map] 🎨 Applied QGIS SVG symbol layer for ${cat.label}`)
                    console.log(`   - Source: QGIS SVG Data`)
                    console.log(`   - 100% Authentic: ✅`)
                  }
                }
              } catch (error) {
                console.error(`[Map] ❌ Error loading QGIS SVG for ${cat.label}:`, error)
                // Fallback to frontend SVG generation
                applyFrontendSVGFallback(cat, symbolConfig, symbolLayerId, sourceId, categorizationField, layerIdMap, categoryId)
              }
            }
            
            loadQGISSVG()
            
          } else if (cat.svgPath) {
            console.log(`[Map] 🎯 Using QGIS-provided SVG path`)
            const dataURL = `data:image/svg+xml;base64,${btoa(cat.svgPath)}`
            const symbolName = `${layerIdMap}-${categoryId}-qgis-svg`
            
            // Load QGIS SVG as image and add to map
            const loadQGISSVGPath = async () => {
              try {
                const img = new Image()
                await new Promise((resolve, reject) => {
                  img.onload = resolve
                  img.onerror = reject
                  img.src = dataURL
                })
                
                if (map.value && !map.value.hasImage(symbolName)) {
                  map.value.addImage(symbolName, img)
                  console.log(`[Map] ✅ Added QGIS SVG path symbol: ${symbolName}`)
                  
                  // Create symbol layer with QGIS SVG
                  const qgisSymbolConfig: any = {
                    id: symbolLayerId,
                    source: sourceId,
                    type: 'symbol' as const,
                    filter: ['==', ['get', categorizationField], cat.value],
                    layout: {
                      'icon-image': symbolName,
                      'icon-size': 1.0,
                      'icon-anchor': 'center',
                      'icon-allow-overlap': true
                    },
                    paint: {
                      'icon-opacity': cat.opacity || qgisStyle.opacity || 1
                    }
                  }
                  
                  if (map.value) {
                    map.value.addLayer(qgisSymbolConfig)
                    console.log(`[Map] 🎨 Applied QGIS SVG path layer for ${cat.label}`)
                    console.log(`   - Source: QGIS SVG Path`)
                    console.log(`   - 100% Authentic: ✅`)
                  }
                }
              } catch (error) {
                console.error(`[Map] ❌ Error loading QGIS SVG path for ${cat.label}:`, error)
                // Fallback to frontend SVG generation
                applyFrontendSVGFallback(cat, symbolConfig, symbolLayerId, sourceId, categorizationField, layerIdMap, categoryId)
              }
            }
            
            loadQGISSVGPath()
            
          } else {
            console.log(`[Map] ⚠️ No QGIS SVG data found, using frontend SVG generation`)
            // Fallback to frontend SVG generation
            applyFrontendSVGFallback(cat, symbolConfig, symbolLayerId, sourceId, categorizationField, layerIdMap, categoryId)
          }
          
        } else {
          console.log(`[Map] ⚠️ No QGIS symbology found for ${cat.label}, using fallback`)
          applyCircleFallback(cat, symbolConfig, symbolLayerId, sourceId, categorizationField)
        }
        
        if (map.value) {
          map.value.addLayer(symbolConfig)
          
          // Add label layer for business centres
          const labelLayerId = `${layerIdMap}-${categoryId}-label`
          if (map.value.getLayer(labelLayerId)) {
            map.value.removeLayer(labelLayerId)
          }
          
          map.value.addLayer({
            id: labelLayerId,
            source: sourceId,
            type: 'symbol',
            filter: ['==', ['get', categorizationField], cat.value],
            layout: {
              'text-field': ['get', 'village_na'],
              'text-font': ['Open Sans Regular'],
              'text-size': 10,
              'text-anchor': 'top',
              'text-offset': [0, 1.5]
            },
            paint: {
              'text-color': '#2c3e50',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1
            }
          })
        }
      }
    })
    
    // Return a minimal config since we're creating separate layers
    return {
      type: 'circle',
      layout: {}, // Add empty layout to prevent error
      paint: {
        'circle-radius': 0, // Hide the main layer
        'circle-color': 'transparent'
      }
    }
  }
  
  // Standard categorized styling for other layers
  const matchExpression: any[] = ['match', ['get', categorizationField]]
  
  // Add categories with their actual colors from QGIS
  qgisStyle._categories.forEach((cat: any) => {
    if (cat.value && cat.value !== 'None') {
      // Debug: Show what's actually in the category
      console.log(`[Map] 🔍 Category structure:`, {
        value: cat.value,
        label: cat.label,
        fillColor: cat.fillColor,
        color: cat.color,
        style: cat.style,
        symbolType: cat.symbolType,
        symbolName: cat.symbolName,
        allKeys: Object.keys(cat),
        allValues: Object.keys(cat).map(key => `${key}: ${cat[key]}`)
      })
      
      // Use QGIS-extracted colors first, then fallback to hybrid approach
      let color = cat.fillColor || cat.color || // Direct QGIS colors
                  cat.style?.fillColor || cat.style?._style?.fillColor || // Old nested structure
                  cat.style?.color || cat.style?._style?.color || // Old nested structure fallback
                  '#45B7D1' // Ultimate fallback
      
      // Use predefined colors as fallback for known categories
      const predefinedColors: Record<string, string> = {
        // Zone colors (polygon layers)
        'Cemetry': '#b2b2b2',
        'Densification Zone [LDR]': '#ffffbe',
        'Densification Zone [MDR]': '#f5f57a',
        'Economic Corridor [Mixed Business]': '#ffff00',
        'High Density Residential': '#ffff00',
        'Institutional': '#ff0000',
        'Light Industry': '#c500ff',
        'Low Density Residential': '#ffffbe',
        'Medium Density Residential': '#f5f57a',
        'Mixed Density Residential': '#a8a800',
        'Railways Common User Facilities': '#dde0f6',
        'Residential Agricultural Plots': '#a5f57a'
      }
      
      // Use predefined color if no QGIS color available
      if (color === '#45B7D1' && predefinedColors[cat.value]) {
        color = predefinedColors[cat.value]
        console.log(`[Map] 🎨 Using predefined color for ${cat.label}: ${color}`)
      } else {
        console.log(`[Map] 🎨 Using QGIS color for ${cat.label}: ${color}`)
      }
                  
      matchExpression.push(cat.value, color)
      console.log(`[Map] 🎨 Auto-applied category: ${cat.label} -> ${color}`)
    }
  })
  
  // Add default color
  matchExpression.push('#45B7D1')
  
  // Apply geometry-specific styling
  if (geometryType === 'polygon') {
    config.paint = {
      'fill-opacity': 0.8,
      'fill-outline-color': '#2c3e50',
      'fill-color': matchExpression
    }
  } else if (geometryType === 'point') {
    config.paint = {
      'circle-radius': 6,
      'circle-color': matchExpression,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#2c3e50'
    }
  } else {
    config.paint = {
      'line-color': matchExpression,
      'line-width': 3
    }
  }
  
  // Auto-detect and apply patterns for special categories
  setTimeout(() => applyIntelligentPatterns(qgisStyle, categorizationField, sourceId, layerIdMap), 100)
  
  return config
}

// Apply intelligent single symbol styling
const applyIntelligentSingleStyling = (config: any, qgisStyle: any, geometryType: string) => {
  const style = qgisStyle._style || {}
  
  if (geometryType === 'polygon') {
    config.type = 'fill'
    config.paint = {
      'fill-opacity': style.fillOpacity || 0.8,
      'fill-outline-color': style.strokeColor || '#2c3e50',
      'fill-color': style.fillColor || '#45B7D1'
    }
  } else if (geometryType === 'point') {
    config.type = 'circle'
    config.paint = {
      'circle-radius': style.radius || 6,
      'circle-color': style.color || '#45B7D1',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#2c3e50'
    }
  } else {
    config.type = 'line'
    config.paint = {
      'line-color': style.color || '#45B7D1',
      'line-width': style.width || 3
    }
  }
  
  return config
}

// Auto-detect and apply patterns for special categories
const applyIntelligentPatterns = (qgisStyle: any, categorizationField: string, sourceId: string, layerIdMap: string) => {
  const categories = qgisStyle._categories || []
  
  console.log('[Map] 🤖 Applying intelligent patterns...')
  
  // Auto-detect cemetery patterns (cross-hatch)
  const cemeteryCategory = categories.find((cat: any) => 
    cat.label?.toLowerCase().includes('ceme') || cat.value?.toLowerCase().includes('ceme')
  )
  
  // Auto-detect economic corridor patterns (diagonal stripes)
  const corridorCategory = categories.find((cat: any) => 
    cat.label?.toLowerCase().includes('corridor') || cat.label?.toLowerCase().includes('economic') ||
    cat.value?.toLowerCase().includes('corridor') || cat.value?.toLowerCase().includes('economic')
  )
  
  // Auto-detect industrial patterns
  const industrialCategory = categories.find((cat: any) => 
    cat.label?.toLowerCase().includes('industrial') || cat.value?.toLowerCase().includes('industrial')
  )
  
  // Apply detected patterns with actual pattern layers
  setTimeout(() => {
    if (cemeteryCategory) {
      console.log('[Map] 🤖 Auto-applying cemetery cross-hatch pattern')
      // Use very dark black for high contrast against light gray
      addPatternLayer(map.value, sourceId, layerIdMap, cemeteryCategory.value, 'cross-hatch', '#000000')
    }
    
    if (corridorCategory) {
      console.log('[Map] 🤖 Auto-applying economic corridor diagonal stripes')
      // Use dark red/brown for high contrast against yellow
      addPatternLayer(map.value, sourceId, layerIdMap, corridorCategory.value, 'diagonal-stripes', '#8B0000')
    }
    
    if (industrialCategory) {
      console.log('[Map] 🤖 Auto-applying industrial pattern')
      // Use dark purple for high contrast against light purple
      addPatternLayer(map.value, sourceId, layerIdMap, industrialCategory.value, 'diagonal-stripes', '#4B0082')
    }
  }, 200)
}

const applyQGISStyling = (baseConfig: any, qgisStyle: any, geometryType: string, sourceId: string, layerIdMap: string) => {
  console.log('[Map] 🎨 Applying QGIS style:', qgisStyle)
  console.log(`[Map] 🔍 Geometry type passed: ${geometryType}`)
  console.log(`[Map] 🔍 Layer ID passed: ${layerIdMap}`)
  
  // Fix geometry type for Health Centres (backend stored as polygon but they're actually points)
  if (layerIdMap && layerIdMap.includes('health_centre')) {
    geometryType = 'point'
    console.log('[Map] 🔧 Fixed geometry type to point for Health Centres')
  }
  
  // Fix geometry type for Business Centres (backend stored as polygon but they're actually points)
  console.log('[Map] 🔍 Checking layerIdMap:', layerIdMap)
  console.log('[Map] 🔍 Does layerIdMap include business_centres?', layerIdMap?.includes('business_centres'))
  if (layerIdMap && layerIdMap.includes('business_centres')) {
    geometryType = 'point'
    console.log('[Map] 🔧 Fixed geometry type to point for Business Centres')
  }
  
  console.log('[Map] 🔍 Final geometry type:', geometryType)
  
  const config = { ...baseConfig }
  
  // Handle categorized styling with data-driven styling
  if (qgisStyle._rendererType === 'categorized' && qgisStyle._categories) {
    console.log('[Map] 🎨 Applying categorized styling with', qgisStyle._categories.length, 'categories')
    
    // Debug: Show the actual categories and their values
    qgisStyle._categories.forEach((cat: any, index: number) => {
      console.log(`[Map] 📋 Category ${index}:`, cat)
      console.log(`[Map] 📋 Category ${index} keys:`, Object.keys(cat))
    })
    
    // Check what field we should be using for categorization
    console.log('[Map] 🔍 QGIS style attributes:', qgisStyle._attributes || qgisStyle._classAttribute)
    
    // Handle point geometry (Business Centres, Health Centres)
    if (geometryType === 'point') {
      config.type = 'circle'
      
      // Build match expression based on QGIS categories
      const matchExpression: any[] = [
        'match',
        ['get', 'sector'],
        // Use the actual QGIS category values and their colors
        'BC', '#FF6B6B',  // Business Centre - Red
        'GP', '#4ECDC4',  // Growth Point - Teal
        'RSC', '#45B7D1', // Rural Service Centre - Blue
        // Default color for other values
        '#BDC3C7'
      ]
      
      console.log('[Map] 🔍 Match expression:', matchExpression)
      console.log('[Map] 🔍 Match expression JSON:', JSON.stringify(matchExpression, null, 2))
      
      // Set the paint config for point features
      config.paint = {
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#2c3e50',
        'circle-color': matchExpression,
        'circle-opacity': 0.8
      }
    }
    // Ensure the layer type is set to 'fill' for polygon geometry
    else if (geometryType === 'polygon') {
      config.type = 'fill'
      
      // Create expression-based fill color based on QGIS categories
      const defaultColor = qgisStyle._categories[0]?.style?.fillColor || '#45B7D1'
      
      // Build match expression using actual QGIS categories
      const matchExpression: any[] = ['match', ['get', 'zone']]
      
      // Add each category with its color from QGIS
      qgisStyle._categories.forEach((cat: any) => {
        if (cat.value && cat.value !== 'None') {
          // Try different possible color property locations
          let color = cat.style?.fillColor || 
                     cat.style?._style?.fillColor || 
                     cat.style?.color || 
                     cat.style?._style?.color ||
                     defaultColor
          
          const styleKeys = Object.keys(cat.style || {})
          console.log(`[Map] 🎨 Category details:`, {
            value: cat.value,
            label: cat.label,
            style: cat.style,
            fillColor: cat.style?.fillColor,
            innerFillColor: cat.style?._style?.fillColor,
            color: cat.style?.color,
            innerColor: cat.style?._style?.color,
            finalColor: color,
            styleKeys: styleKeys,
            styleValues: styleKeys.map(key => `${key}: ${cat.style?.[key]}`),
            fullStyle: JSON.stringify(cat.style, null, 2),
            usingDefault: color === defaultColor
          })
          matchExpression.push(cat.value, color)
          console.log(`[Map] 🎨 Adding category: ${cat.value} -> ${color}`)
        }
      })
      
      // Add default color for unmatched features
      matchExpression.push(defaultColor)
      
      console.log('[Map] 🔍 Match expression:', matchExpression)
      console.log('[Map] 🔍 Match expression JSON:', JSON.stringify(matchExpression, null, 2))
      
      // Use match expression for fill color
      const paintConfig: any = {
        'fill-opacity': 0.7, // Increased opacity for better visibility
        'fill-outline-color': '#2c3e50'
      }
      
      // Set the paint config properly
      config.paint = {
        'fill-opacity': paintConfig['fill-opacity'],
        'fill-outline-color': paintConfig['fill-outline-color'],
        'fill-color': matchExpression
      }
      
      // Check if any category has patterns
      const hasPatterns = qgisStyle._categories.some((cat: any) => cat.style?.pattern)
      
      // Also check for specific categories that should have patterns
      const cemeteryCategory = qgisStyle._categories.find((cat: any) => 
        cat.value && cat.value.toLowerCase().includes('cemetry')
      )
      const mixedCorridorCategory = qgisStyle._categories.find((cat: any) => 
        cat.value && cat.value.toLowerCase().includes('mixed business')
      )
      
      if (hasPatterns || cemeteryCategory || mixedCorridorCategory) {
        // Create pattern-based styling
        console.log('[Map] 🎨 Applying pattern-based styling')
        
        // For now, use solid fill but we'll add pattern layers
        paintConfig['fill-color'] = matchExpression
        
        // Store pattern info for additional layers
        const patternLayers: any[] = []
        
        qgisStyle._categories.forEach((cat: any) => {
          if (cat.style?.pattern && cat.value !== null && cat.value !== undefined) {
            patternLayers.push({
              category: cat.value,
              pattern: cat.style.pattern,
              color: cat.style.fillColor
            })
          }
        })
        
        // Add manual pattern detection for known categories
        if (cemeteryCategory && !patternLayers.find((p: any) => p.category === cemeteryCategory.value)) {
          patternLayers.push({
            category: cemeteryCategory.value,
            pattern: 'cross-hatch',
            color: cemeteryCategory.style.fillColor
          })
          console.log('[Map] 🎨 Manually detected cemetery pattern')
        }
        
        if (mixedCorridorCategory && !patternLayers.find((p: any) => p.category === mixedCorridorCategory.value)) {
          patternLayers.push({
            category: mixedCorridorCategory.value,
            pattern: 'diagonal-stripes',
            color: mixedCorridorCategory.style.fillColor
          })
          console.log('[Map] 🎨 Manually detected mixed corridor pattern')
        }
        
        // Add pattern layers after the main layer is created
        setTimeout((sourceId: string, layerIdMap: string) => {
          patternLayers.forEach((patternInfo: any, index: number) => {
            if (patternInfo.pattern === 'cross-hatch') {
              // Add cemetery cross-hatch pattern
              addPatternLayer(map.value, sourceId, layerIdMap, patternInfo.category, 'cross-hatch', patternInfo.color)
            } else if (patternInfo.pattern === 'diagonal-stripes') {
              // Add diagonal stripe pattern for mixed corridor
              addPatternLayer(map.value, sourceId, layerIdMap, patternInfo.category, 'diagonal-stripes', patternInfo.color)
            }
          })
        }, 100, sourceId, layerIdMap)
      } else {
        // Standard fill styling
        paintConfig['fill-color'] = matchExpression
      }
      
      console.log('[Map] 🔍 Match expression length:', matchExpression.length)
      console.log('[Map] 🔍 Match expression:', matchExpression)
      
      // Set the paint config with all properties including fill-color
      config.paint = {
        'fill-opacity': paintConfig['fill-opacity'],
        'fill-outline-color': paintConfig['fill-outline-color'],
        'fill-color': matchExpression
      }
    }
    
    console.log('[Map] 🎨 Categories found:', qgisStyle._categories.map((cat: any) => `${cat.label}: ${cat.style.fillColor}`))
  }
  // Apply styling based on geometry type and QGIS style
  else if (geometryType === 'polygon' && qgisStyle._style?.type === 'polygon') {
    config.type = 'fill'
    config.paint = {
      'fill-color': qgisStyle._style?.fillColor || '#45B7D1',
      'fill-opacity': qgisStyle._style?.fillOpacity || 0.6,
      'fill-outline-color': qgisStyle._style?.strokeColor || '#2c3e50'
    }
  } else if (geometryType === 'line' && qgisStyle._style?.type === 'line') {
    config.type = 'line'
    config.paint = {
      'line-color': qgisStyle._style?.color || '#4ECDC4',
      'line-width': qgisStyle._style?.width || 3,
      'line-opacity': qgisStyle._style?.opacity || 1.0
    }
  } else if (geometryType === 'point' && qgisStyle._style?.type === 'point') {
    config.type = 'circle'
    config.paint = {
      'circle-color': qgisStyle._style?.color || '#FF6B6B',
      'circle-radius': qgisStyle._style?.radius || 6,
      'circle-stroke-width': qgisStyle._style?.strokeWidth || 1,
      'circle-stroke-color': qgisStyle._style?.strokeColor || '#2c3e50',
      'circle-opacity': qgisStyle._style?.opacity || 0.8
    }
    
    // Store label configuration for separate symbol layer
    if (qgisStyle._labelField) {
      config._labelConfig = {
        field: qgisStyle._labelField,
        size: qgisStyle._labelSize || 10,
        color: qgisStyle._labelColor || '#2c3e50'
      }
      console.log(`[Map] 🏷️ Added label configuration for field: ${qgisStyle._labelField}`)
    }
    
    // Handle symbol layers (e.g., medical cross)
    if (qgisStyle._symbolLayers && Array.isArray(qgisStyle._symbolLayers)) {
      console.log('[Map] 🎨 Processing symbol layers:', qgisStyle._symbolLayers)
      
      // Check for medical cross symbol
      const medicalCrossLayer = qgisStyle._symbolLayers.find((layer: any) => 
        layer.symbolType === 'medical_cross' || 
        layer.type?.toString().toLowerCase().includes('cross')
      )
      
      if (medicalCrossLayer) {
        console.log('[Map] 🏥 Found medical cross symbol - adding cross layer')
        
        // Store medical cross info for additional layer creation
        config._medicalCross = {
          color: medicalCrossLayer.color || '#ff0000',
          size: medicalCrossLayer.size || qgisStyle._style?.radius || 6
        }
      }
    }
    
    // Manual medical cross detection for Health Centres
    console.log(`[Map] 🔍 Checking layer ID for medical cross: ${layerIdMap}`)
    if (layerIdMap && (layerIdMap.includes('health_centre') || layerIdMap.includes('health'))) {
      console.log('[Map] 🏥 Manual medical cross detection for Health Centres')
      config._medicalCross = {
        color: '#ff0000',
        size: 8
      }
    }
  }
  
  console.log('[Map] 🎨 Final paint config:', config.paint)
  return config
}

// Point, line or polygon, read from the features themselves and only then
// from the catalogue, whose declared type has been wrong before.
const geometryKindOf = (geojson: any, layerInfo: any): 'point' | 'line' | 'polygon' => {
  const first = geojson?.features?.find((f: any) => f?.geometry)?.geometry
    ?? geojson?.geometries?.[0]
  const declared = String(first?.type || layerInfo?.geometry_type || layerInfo?.type || '').toLowerCase()
  if (declared.includes('line')) return 'line'
  if (declared.includes('point')) return 'point'
  return 'polygon'
}

const getLayerConfig = (geometryType: string) => {
  const configs: Record<string, any> = {
    point: {
      type: 'circle',
      layout: {},
      paint: {
        'circle-radius': 6,
        'circle-color': '#FF6B6B',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    },
    line: {
      type: 'line',
      layout: {},
      paint: {
        'line-color': '#4ECDC4',
        'line-width': 3
      }
    },
    polygon: {
      type: 'fill',
      layout: {},
      paint: {
        'fill-color': '#45B7D1',
        'fill-opacity': 0.3
      }
    }
  }
  
  return configs[geometryType] || configs.point
}

// Interaction handlers
const handleMapClick = (e: maplibregl.MapMouseEvent) => {
  const features = map.value?.queryRenderedFeatures(e.point)
  
  if (features && features.length > 0) emit('feature-clicked', features[0])
}

const handleMapHover = (e: maplibregl.MapMouseEvent) => {
  const features = map.value?.queryRenderedFeatures(e.point)
  
  if (features && features.length > 0) {
    map.value!.getCanvas().style.cursor = 'pointer'
  } else {
    map.value!.getCanvas().style.cursor = ''
  }
}

// Additional methods for Map Explorer
const flyTo = (options: { center?: [number, number]; zoom?: number }) => {
  if (!map.value) return
  
  if (options.center) {
    map.value.flyTo({
      center: options.center,
      zoom: options.zoom || map.value.getZoom(),
      speed: 1.2
    })
  }
}

const flyToLocation = (location: SearchResult) => {
  flyTo({ center: location.coordinates, zoom: 15 })
}

const exportAsPNG = () => {
  if (!map.value) return
  
  try {
    const canvas = map.value.getCanvas()
    const link = document.createElement('a')
    link.download = `map-export-${Date.now()}.png`
    link.href = canvas.toDataURL()
    link.click()
    console.log('📸 Map exported as PNG')
  } catch (error) {
    console.error('❌ Failed to export map:', error)
  }
}

const fitToBounds = () => {
  if (!map.value || spatialStore.activeLayers.size === 0) return
  
  // Try to fit to visible layers
  const bounds = new maplibregl.LngLatBounds()
  let hasBounds = false
  
  // This is a simplified version - in production you'd calculate actual bounds
  // For now, just zoom to show the general area
  map.value.fitBounds([
    [28.5, -20.5], // Southwest Zimbabwe
    [31.5, -18.0]  // Northeast Zimbabwe
  ], {
    padding: 50,
    maxZoom: 12
  })
}

// Handle search
const handleSearch = () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  // Mock search results
  searchResults.value = [
    {
      id: '1',
      name: 'Harare City Center',
      description: 'Capital city of Zimbabwe',
      coordinates: [31.053, -17.829] as [number, number]
    },
    {
      id: '2',
      name: 'Bulawayo Downtown',
      description: 'Second largest city',
      coordinates: [28.583, -20.150] as [number, number]
    }
  ].filter(result => 
    result.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
}

// Lifecycle
// Real-time tile refresh on QGIS/PostGIS edits is wired inside
// addVunguBasemap() (src/map/vunguBasemap.ts) via the /api/map/events SSE
// stream — every caller of addVunguBasemap gets it, not just this component.

// Refresh a tile source by bumping its URL with a cache-busting timestamp.
// Works for both vector-tile sources (update tiles array) and geojson sources.
// Exposed for parents that want to force a manual refresh.
const refreshTileLayer = (layerId: string) => {
  if (!map.value) return
  const sourceId = `vungu-${layerId}`
  const src = map.value.getSource(sourceId) as any
  if (!src) return
  if (src.type === 'vector') {
    src.setTiles([`${tileUrlTemplate(layerId)}?v=${Date.now()}`])
  }
}

onMounted(() => {
  // Kick off the tile catalog fetch immediately — WebGL init takes ~200-500 ms,
  // so by the time the 'load' event fires the catalog is already in cache.
  prefetchTileLayerCatalog()
  initializeMap()
})

onUnmounted(() => {
  if (map.value) {
    map.value.remove()
  }
})

// Expose methods to parent components
defineExpose({
  flyToResult,
  refreshTileLayer,
  setBasemapLayerVisible: (layerId: string, visible: boolean) => {
    if (!map.value) return
    _setBasemapLayerVisible(map.value, layerId, visible)
  },
  flyTo: (coordinates: [number, number]) => {
    console.log('Flying to coordinates:', coordinates)
    if (map.value && coordinates) {
      map.value.flyTo({
        center: coordinates,
        zoom: 12,
        duration: 1000
      })
    }
  },
  addGeoJSONLayer: (layerId: string, geoData: any, style: any = {}) => {
    console.log('Adding GeoJSON layer:', layerId, geoData)
    if (!map.value) return

    // Add source
    map.value.addSource(layerId, {
      type: 'geojson',
      data: geoData
    })

    // Add layer based on geometry type
    if (geoData.type === 'FeatureCollection' && geoData.features.length > 0) {
      const firstFeature = geoData.features[0]
      const geometryType = firstFeature.geometry.type

      if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
        map.value.addLayer({
          id: layerId,
          type: 'fill',
          source: layerId,
          paint: {
            'fill-color': style.color || '#3B82F6',
            'fill-opacity': style.fillOpacity || 0.3
          }
        })
      } else if (geometryType === 'Point' || geometryType === 'MultiPoint') {
        map.value.addLayer({
          id: layerId,
          type: 'circle',
          source: layerId,
          paint: {
            'circle-color': style.color || '#EF4444',
            'circle-radius': style.radius || 6
          }
        })
      } else if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
        map.value.addLayer({
          id: layerId,
          type: 'line',
          source: layerId,
          paint: {
            'line-color': style.color || '#10B981',
            'line-width': style.strokeWidth || 2
          }
        })
      }
    }
  },
  fitToBounds: () => {
    console.log('Fitting map to bounds')
    if (map.value) {
      // This would fit to all layers - simplified for now
      map.value.fitBounds([
        [29.5, -20.5], // Southwest corner (Zimbabwe area)
        [31.5, -19.5]  // Northeast corner
      ], {
        padding: 20,
        maxZoom: 15
      })
    }
  },
  addLayerToMap: async (layerId: string) => {
    console.log('Adding layer to map:', layerId)
    await addLayerToMap(layerId)
  },
  removeLayerFromMap: (layerId: string) => {
    console.log('Removing layer from map:', layerId)
    removeLayerFromMap(layerId)
  },
  toggleLayer: (layerId: string, visible: boolean) => {
    console.log('Toggling layer:', layerId, visible)
    if (!map.value) return
    
    if (map.value.getLayer(layerId)) {
      map.value.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
    }
  },
  setLayerOpacity: (layerId: string, opacity: number) => {
    console.log('Setting layer opacity:', layerId, opacity)
    // Implementation would go here
  },
  exportAsPNG: () => {
    console.log('Exporting map as PNG')
    // Implementation would go here
  },
  // setStyle() is deliberately NOT exposed. map.setStyle() swaps the entire
  // style document, discarding the PostGIS sources, QGIS overlay, mask and SSE
  // layers this component installs. No caller used it; if basemap variants are
  // ever needed they must come from the published style registry so the layer
  // stack is rebuilt, not dropped.
  zoomIn: () => {
    console.log('Zooming in')
    if (map.value) {
      map.value.zoomIn()
    }
  },
  zoomOut: () => {
    console.log('Zooming out')
    if (map.value) {
      map.value.zoomOut()
    }
  },
  export: () => {
    console.log('Exporting map')
    // Implementation would go here
  }
})
</script>

<style scoped>
.interactive-map-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
}

.map-wrapper {
  width: 100%;
  height: 100%;
}





















.search-container {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 400px;
  z-index: 10;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  width: 1.25rem;
  height: 1.25rem;
  color: #6b7280;
  z-index: 1;
}

.search-input {
  width: 100%;
  padding: 0.75rem 1rem 0.75rem 2.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  background: white;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transition: border-color 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  max-height: 20rem;
  overflow-y: auto;
  margin-top: 0.5rem;
}

.search-result-item {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f3f4f6;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.search-result-item:hover {
  background: #f3f4f6;
}

.search-result-item:last-child {
  border-bottom: none;
}

.result-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #111827;
}

.result-description {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.loading-spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid #e5e7eb;
  border-radius: 50%;
  border-top-color: #3b82f6;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Responsive design */
/* The attribution button is stretched to a 44px touch target on touch
   devices, and MapLibre's icon is a background image — left to repeat, it
   tiled into two "i" icons. */
:deep(.maplibregl-ctrl-attrib-button) {
  background-repeat: no-repeat;
  background-position: center;
}

/* Phone: the search box sits between the tool column on the left and
   MapLibre's control column on the right instead of across both, where it
   covered the zoom-in button and the QGIS panel. */
@media (max-width: 767px) {
  .search-container {
    top: 16px;
    left: 68px;
    right: 52px;
    width: auto;
    max-width: none;
    transform: none;
  }
}
</style>
