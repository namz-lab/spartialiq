<template>
  <div class="parcel-selector-map">
    <div class="bg-white rounded-lg shadow-lg p-4">
      <div class="flex justify-between items-center mb-4">
        <div>
          <h3 class="text-lg font-medium text-gray-900">Select Property Parcel</h3>
          <div class="flex items-center space-x-2 mt-1">
            <span class="text-xs text-gray-500">Live updates:</span>
            <span 
              class="text-xs px-2 py-0.5 rounded-full"
              :class="connectionStatus === 'connected' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'"
            >
              {{ connectionStatus === 'connected' ? '🟢 Connected' : '🟡 Connecting...' }}
            </span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              📍 Zone parcels only
            </span>
          </div>
        </div>
        <button
          @click="clearSelection"
          class="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Clear Selection
        </button>
      </div>
      
      <!-- Update Notification -->
      <div v-if="updateNotification" class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
        <div class="flex items-center">
          <span class="text-blue-600 mr-2">🔄</span>
          <span class="text-sm text-blue-800">{{ updateNotification }}</span>
        </div>
        <button 
          @click="refreshData"
          class="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Refresh Now
        </button>
      </div>
      
      <!-- User Notification -->
      <div v-if="notification" class="mb-4 p-4 rounded-lg border flex items-start justify-between" 
           :class="{
             'bg-yellow-50 border-yellow-200': notification.type === 'warning',
             'bg-green-50 border-green-200': notification.type === 'success',
             'bg-red-50 border-red-200': notification.type === 'error',
             'bg-blue-50 border-blue-200': notification.type === 'info'
           }">
        <div class="flex items-start">
          <span class="mr-3 text-lg" v-if="notification.type === 'warning'">⚠️</span>
          <span class="mr-3 text-lg" v-if="notification.type === 'success'">✅</span>
          <span class="mr-3 text-lg" v-if="notification.type === 'error'">❌</span>
          <span class="mr-3 text-lg" v-if="notification.type === 'info'">ℹ️</span>
          <div>
            <h5 class="font-medium text-gray-900">{{ notification.title }}</h5>
            <p class="text-sm text-gray-700 mt-1">{{ notification.message }}</p>
          </div>
        </div>
        <button 
          @click="notification = null"
          class="ml-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>
      
      <!-- Map Container -->
      <div class="relative">
        <div ref="mapContainer" class="h-96 bg-gray-100 rounded-lg"></div>
        
        <!-- Search Box -->
        <div class="absolute top-4 left-4 z-10">
          <div class="bg-white rounded-lg shadow-lg p-3">
            <input
              v-model="searchQuery"
              @input="searchParcels"
              type="text"
              placeholder="Search by CFU or stand number..."
              class="w-64 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div v-if="searchResults.length > 0" class="mt-2 max-h-48 overflow-y-auto">
              <div
                v-for="parcel in searchResults"
                :key="parcel.parcel_id"
                @click="selectParcel(parcel)"
                class="px-3 py-2 hover:bg-gray-100 cursor-pointer rounded text-sm"
              >
                <div class="font-medium">{{ parcel.name_cfu || parcel.stand_number || 'Stand ' + parcel.parcel_id }}</div>
                <div class="text-gray-600 text-xs">{{ parcel.stand_number ? 'Stand: ' + parcel.stand_number : '' }} {{ parcel.township_name ? '| ' + parcel.township_name : '' }}</div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Selected Parcel Info -->
        <div v-if="selectedParcel" class="absolute bottom-4 left-4 z-10">
          <div class="bg-white rounded-lg shadow-lg p-4 max-w-sm">
            <h4 class="font-medium text-gray-900 mb-2">Selected Parcel</h4>
            <div class="space-y-1 text-sm">
              <div><span class="font-medium">Stand:</span> {{ selectedParcel.name_cfu || selectedParcel.stand_number || selectedParcel.parcel_id }}</div>
              <div><span class="font-medium">Township:</span> {{ selectedParcel.township_name }}</div>
              <div><span class="font-medium">Area:</span> {{ selectedParcel.area_hectares?.toFixed(2) }} ha</div>
              <div><span class="font-medium">Zone:</span> {{ selectedParcel.zone_name }}</div>
            </div>
            <button
              @click="confirmSelection"
              class="mt-3 w-full px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              Confirm Selection
            </button>
          </div>
        </div>
        
        <!-- Loading Indicator -->
        <div v-if="loading" class="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-lg">
          <div class="text-gray-600">Loading map...</div>
        </div>
      </div>
      
      <!-- Zone Legend -->
      <div class="mt-4 p-3 bg-gray-50 rounded-lg">
        <h4 class="text-sm font-medium text-gray-700 mb-2">Zone Legend</h4>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="zone in uniqueZones"
            :key="zone.zone_code + '-' + zone.zone"
            class="flex items-center space-x-2"
          >
            <div
              class="w-4 h-4 rounded"
              :style="{ backgroundColor: zone.map_color || '#cccccc' }"
            ></div>
            <span class="text-xs text-gray-600">{{ zone.zone_code }} - {{ zone.zone }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ogcService } from '../services/ogc'
import { addVunguBasemap } from '@/map/vunguBasemap'
import * as turf from '@turf/turf'

const emit = defineEmits(['parcel-selected'])

const mapContainer = ref(null)
const map = ref(null)
const loading = ref(true)
const searchQuery = ref('')
const searchResults = ref([])
const selectedParcel = ref(null)
const zones = ref([])
const parcels = ref([])
const connectionStatus = ref('connecting')
const updateNotification = ref('')
const notification = ref(null)
let eventSource = null

// Cache for parcel eligibility to avoid expensive recalculations
const parcelEligibilityCache = new Map()

// Unique zones for legend (remove duplicates based on zone name and map_color)
const uniqueZones = computed(() => {
  const seen = new Set()
  const unique = zones.value.filter(zone => {
    // Use zone name and map_color for deduplication, ignore zone_code
    const key = `${zone.zone}-${zone.map_color}`
    if (seen.has(key)) {
      console.log(`[ParcelSelectorMap] Filtering duplicate zone: ${key}`)
      return false
    }
    seen.add(key)
    return true
  })
  console.log(`[ParcelSelectorMap] Zone deduplication: ${zones.value.length} total → ${unique.length} unique`)
  return unique
})

// Initialize MapLibre map
const initializeMap = async () => {
  if (!mapContainer.value) return
  
  map.value = new maplibregl.Map({
    container: mapContainer.value,
    // Self-hosted base (cream land + PostGIS basemap added on load) — no
    // external tile servers.
    style: {
      version: 8,
      sources: {
        'zones-wms': {
          type: 'raster',
          tiles: [
            '/api/ogc/wms/map/proposed_peri_urban_zones?bbox={bbox-epsg-3857}&width=512&height=512&format=png&transparent=true'
          ],
          tileSize: 512,
          attribution: 'Vungu RDC Planning Zones (QGIS Server)'
        }
      },
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      layers: [{
        id: 'bg',
        type: 'background',
        paint: { 'background-color': '#f2efe9' }
      }, {
        id: 'zones-wms',
        type: 'raster',
        source: 'zones-wms',
        paint: {
          'raster-opacity': 0.7
        }
      }]
    },
    center: [29.1549, -19.0154], // Zimbabwe
    zoom: 10
  })
  
  map.value.on('load', async () => {
    if (map.value) addVunguBasemap(map.value)
    await loadZones()
    await loadParcels()
    loading.value = false
  })
}

// Load zones using styled layer endpoint
const loadZones = async () => {
  try {
    // Use styled layer to get features + QGIS styling
    const styledLayer = await ogcService.getStyledLayer('chipinge_land_zones', { noCache: true })
    
    if (styledLayer.features && styledLayer.features.length > 0) {
      console.log('[ParcelSelectorMap] Zone features:', styledLayer.features.length)
      
      // Create color mapping from QGIS style symbols
      const zoneColorMap = new Map()
      if (styledLayer.style && styledLayer.style.symbols) {
        console.log('[ParcelSelectorMap] Found style symbols:', styledLayer.style.symbols.length)
        styledLayer.style.symbols.forEach((symbol) => {
          const zoneValue = symbol.id || symbol.name
          // Get fill color - check direct fill.color first, then pattern color, then stroke
          const zoneColor = symbol.fill?.color || symbol.fill?.pattern?.color || symbol.stroke?.color
          if (zoneValue && zoneColor && zoneValue !== 'NULL') {
            zoneColorMap.set(zoneValue, zoneColor)
          }
        })
        console.log('[ParcelSelectorMap] Zone color map:', Object.fromEntries(zoneColorMap))
      }
      
      // Update zones with actual colors from QGIS styling
      zones.value = styledLayer.features.map(f => ({
        id: f.properties?.id || f.properties?.zone_id,
        zone_code: f.properties?.zone_code,
        zone: f.properties?.zone || f.properties?.name,
        zone_type: f.properties?.zone_type,
        map_color: zoneColorMap.get(f.properties?.zone) || f.properties?.map_color,
        geometry: f.geometry
      }))
      
      // Using WMS layer instead of vector zones for QGIS Server styling
      // Keep zone data for legend and bounds calculation only
      /*
      // Add zones as GeoJSON source with QGIS styling
      const zonesGeoJSON = {
        type: 'FeatureCollection',
        features: styledLayer.features
      }
      
      map.value.addSource('zones', {
        type: 'geojson',
        data: zonesGeoJSON
      })
      
      // Use QGIS-converted MapLibre style if available
      if (styledLayer.maplibreStyle) {
        map.value.addLayer({
          id: 'zones-fill',
          type: styledLayer.maplibreStyle.type || 'fill',
          source: 'zones',
          paint: styledLayer.maplibreStyle.paint || {
            'fill-color': ['get', 'map_color'],
            'fill-opacity': 0.3
          }
        })
      } else {
        // Fallback styling
        map.value.addLayer({
          id: 'zones-fill',
          type: 'fill',
          source: 'zones',
          paint: {
            'fill-color': ['get', 'map_color'],
            'fill-opacity': 0.3
          }
        })
      }
      
      map.value.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2
        }
      })
      */
      
      // Fit map to zones bounds - zoom to zone extent
      const bounds = new maplibregl.LngLatBounds()
      let hasValidCoords = false
      
      console.log('[ParcelSelectorMap] Calculating bounds from zones...')
      
      styledLayer.features.forEach((feature, index) => {
        if (!feature.geometry || !feature.geometry.coordinates) {
          console.log(`[ParcelSelectorMap] Zone ${index}: No geometry or coordinates`)
          return
        }
        
        let coordsToProcess = []
        
        if (feature.geometry.type === 'MultiPolygon') {
          // For MultiPolygon, coordinates is [polygon1, polygon2, ...]
          // Each polygon is [ring1, ring2, ...] where ring1 is outer ring
          feature.geometry.coordinates.forEach((polygon, polyIndex) => {
            if (polygon && polygon[0]) {
              coordsToProcess.push(...polygon[0])
            }
          })
        } else if (feature.geometry.type === 'Polygon') {
          // For Polygon, coordinates is [ring1, ring2, ...] where ring1 is outer ring
          coordsToProcess = feature.geometry.coordinates[0]
        }
        
        console.log(`[ParcelSelectorMap] Zone ${index}: Processing ${coordsToProcess.length} coordinates`)
        
        coordsToProcess.forEach((coord, coordIndex) => {
          if (Array.isArray(coord) && coord.length >= 2) {
            let lng, lat
            
            if (coord.length === 4) {
              // Bounding box format: [minLng, minLat, maxLng, maxLat]
              // Use min and max as separate points
              lng = coord[0]
              lat = coord[1]
              bounds.extend([lng, lat])
              hasValidCoords = true
              
              lng = coord[2]
              lat = coord[3]
              bounds.extend([lng, lat])
              hasValidCoords = true
              
              if (index === 0 && coordIndex < 3) {
                console.log(`[ParcelSelectorMap] Zone ${index} bbox ${coordIndex}: [${coord[0]}, ${coord[1]}, ${coord[2]}, ${coord[3]}]`)
              }
            } else {
              // Regular coordinate format: [lng, lat]
              [lng, lat] = coord
              if (typeof lng === 'number' && typeof lat === 'number' && !isNaN(lng) && !isNaN(lat)) {
                bounds.extend(coord)
                hasValidCoords = true
                if (index === 0 && coordIndex < 3) {
                  console.log(`[ParcelSelectorMap] Zone ${index} coord ${coordIndex}: [${lng}, ${lat}]`)
                }
              } else {
                console.log(`[ParcelSelectorMap] Zone ${index} coord ${coordIndex}: Invalid [${lng}, ${lat}]`)
              }
            }
          }
        })
      })
      
      console.log(`[ParcelSelectorMap] Bounds calculation: hasValidCoords=${hasValidCoords}, isEmpty=${bounds.isEmpty()}`)
      if (hasValidCoords && !bounds.isEmpty()) {
        console.log('[ParcelSelectorMap] Final bounds:', bounds)
      }
      
      if (hasValidCoords && !bounds.isEmpty()) {
        // Wait a bit for map to be ready, then zoom
        setTimeout(() => {
          if (map.value) {
            map.value.fitBounds(bounds, { 
              padding: 50,
              maxZoom: 14,
              duration: 1000
            })
            console.log('[ParcelSelectorMap] Zoomed to proposed_peri_urban_zones extent:', bounds)
          }
        }, 500)
      } else {
        console.warn('[ParcelSelectorMap] No valid zone bounds found for zooming')
      }
      
      // Debug: Check if layers were added properly
      setTimeout(() => {
        const layers = map.value.getStyle().layers
        const parcelLayers = layers.filter(layer => layer.source === 'parcels')
        console.log('[ParcelSelectorMap] 📋 Map layers with parcels source:', parcelLayers.map(l => l.id))
        
        // Check layer visibility
        parcelLayers.forEach(layer => {
          const visibility = map.value.getLayoutProperty(layer.id, 'visibility')
          console.log(`[ParcelSelectorMap] Layer ${layer.id} visibility:`, visibility || 'visible')
        })
      }, 1000)
      
      console.log(`[ParcelSelectorMap] Loaded ${zones.value.length} zones with QGIS styling`)
      console.log('[ParcelSelectorMap] Zone layers added, now loading parcels...')
    } else {
      console.warn('[ParcelSelectorMap] No parcels found in styled layer')
    }
  } catch (error) {
    console.error('[ParcelSelectorMap] Failed to load zones:', error)
  }
}

// Load parcels using styled layer endpoint with QGIS styling
const loadParcels = async () => {
  try {
    // Clear cache when loading new parcels or when criteria changes
    parcelEligibilityCache.clear()
    console.log('[ParcelSelectorMap] 🗑️ Parcel eligibility cache cleared (25% selection criteria)')
    
    // Use styled layer to get features + QGIS styling like VunguPlannerView
    const styledLayer = await ogcService.getStyledLayer('gweru_rural_farms')
    
    if (styledLayer.features && styledLayer.features.length > 0) {
      parcels.value = styledLayer.features.map(f => ({
        parcel_id: f.properties?.id || f.properties?.gid,
        name_cfu: f.properties?.name_cfu || f.properties?.NAME_CFU,
        stand_number: f.properties?.name || f.properties?.stand_number,
        township_name: f.properties?.district || f.properties?.township_name,
        area_hectares: f.properties?.area_ha || f.properties?.area_hectares,
        zone_name: f.properties?.zone_name,
        geometry: f.geometry
      }))
      
      // Add parcels as GeoJSON source
      const parcelsGeoJSON = {
        type: 'FeatureCollection',
        features: styledLayer.features
      }
      
      map.value.addSource('parcels', {
        type: 'geojson',
        data: parcelsGeoJSON
      })
      
      // Use QGIS-converted MapLibre style if available
      if (styledLayer.maplibreStyle) {
        console.log('[ParcelSelectorMap] Using QGIS MapLibre style for parcels')
        console.log('[ParcelSelectorMap] QGIS style paint:', styledLayer.maplibreStyle.paint)
        
        const paintProperties = { ...styledLayer.maplibreStyle.paint }
        
        // Determine layer type based on paint properties
        let layerType = styledLayer.maplibreStyle.type || 'fill'
        
        // If QGIS returned line properties, create a line layer with fill underneath
        if (paintProperties['line-color'] && !paintProperties['fill-color']) {
          console.log('[ParcelSelectorMap] QGIS style is line-based, creating fill + outline layers')
          
          // Create fill layer for interaction
          map.value.addLayer({
            id: 'parcels-fill',
            type: 'fill',
            source: 'parcels',
            paint: {
              'fill-color': '#3388ff',
              'fill-opacity': 0.3
            }
          })
          
          // Create outline layer using QGIS line styling
          map.value.addLayer({
            id: 'parcels-outline',
            type: 'line',
            source: 'parcels',
            paint: paintProperties
          })
        } else {
          // Use original styling
          map.value.addLayer({
            id: 'parcels-fill',
            type: layerType,
            source: 'parcels',
            paint: paintProperties
          })
        }
        
        // Add additional layers if defined (e.g., outlines, line casings).
        // `placement: 'below'` keeps a casing under the main layer instead of
        // painting it over the core it outlines.
        if (styledLayer.maplibreStyle.additionalLayers) {
          styledLayer.maplibreStyle.additionalLayers.forEach(additionalLayer => {
            const definition = {
              id: additionalLayer.id,
              type: additionalLayer.type,
              source: 'parcels',
              paint: additionalLayer.paint
            }
            if (additionalLayer.placement === 'below') {
              map.value.addLayer(definition, 'parcels-fill')
            } else {
              map.value.addLayer(definition)
            }
          })
        }
      } else {
        // Fallback to default styling
        console.log('[ParcelSelectorMap] Using fallback styling for parcels')
        map.value.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'parcels',
          paint: {
            'fill-color': '#3388ff',
            'fill-opacity': 0.2
          }
        })
        
        map.value.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'parcels',
          paint: {
            'line-color': '#ffffff',
            'line-width': 1
          }
        })
      }
      
      // Add scale-dependent CFU labels layer with collision avoidance
      console.log('[ParcelSelectorMap] Adding scale-dependent CFU labels layer with collision avoidance...')
      
      // Debug: Check current zoom level and sample parcel data
      const currentZoom = map.value.getZoom()
      console.log(`[ParcelSelectorMap] 📍 Current zoom level: ${currentZoom}`)
      
      // Debug: Check first few parcels to understand field names
      if (parcels.value.length > 0) {
        console.log('[ParcelSelectorMap] 📋 Sample parcel data:')
        parcels.value.slice(0, 3).forEach((parcel, index) => {
          console.log(`  Parcel ${index}:`, {
            parcel_id: parcel.parcel_id,
            name_cfu: parcel.name_cfu,
            NAME_CFU: parcel.NAME_CFU,
            name: parcel.name,
            area_hectares: parcel.area_hectares
          })
        })
      }
      
      // Create multiple label layers for different zoom levels
      // Zoom 0-9: No labels (too cluttered)
      // Zoom 8-10: Major parcels only (larger farms) - LOWERED THRESHOLD
      // Zoom 11-14: All parcels with collision avoidance
      // Zoom 15+: All parcels with full details
      
      // High zoom level labels (zoom 15+) - Full details, no collision avoidance
      map.value.addLayer({
        id: 'parcels-labels-high-zoom',
        type: 'symbol',
        source: 'parcels',
        minzoom: 15,
        layout: {
          'text-field': ['coalesce', ['get', 'name_cfu'], ['get', 'NAME_CFU'], ['get', 'name'], ['get', 'stand_number'], ''],
          'text-size': 14,
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-font': ['Noto Sans Regular'],
          'text-max-width': 8,
          'text-line-height': 1.2
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
          'text-opacity': 1
        }
      })
      
      // Medium zoom level labels (zoom 11-14) - Collision avoidance enabled
      map.value.addLayer({
        id: 'parcels-labels-medium-zoom',
        type: 'symbol',
        source: 'parcels',
        minzoom: 11,
        maxzoom: 14,
        layout: {
          'text-field': ['coalesce', ['get', 'name_cfu'], ['get', 'NAME_CFU'], ['get', 'name'], ['get', 'stand_number'], ''],
          'text-size': 12,
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-font': ['Noto Sans Regular'],
          'text-max-width': 6,
          'symbol-placement': 'point',
          'text-optional': true, // Hide labels if they would collide
          'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.5
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
          'text-opacity': 0.9
        }
      })
      
      // Low zoom level labels (zoom 8-10) - Major parcels only, larger text
      map.value.addLayer({
        id: 'parcels-labels-low-zoom',
        type: 'symbol',
        source: 'parcels',
        minzoom: 8,
        maxzoom: 10,
        filter: [
          'any',
          ['>=', ['coalesce', ['get', 'area_hectares'], 0], 50], // Large farms (50+ ha) - LOWERED THRESHOLD
          ['>=', ['length', ['coalesce', ['get', 'name_cfu'], ['get', 'NAME_CFU'], ['get', 'name'], '']], 2], // Has a meaningful name
          ['>=', ['length', ['coalesce', ['get', 'stand_number'], '']], 1] // Has stand number
        ],
        layout: {
          'text-field': ['coalesce', ['get', 'name_cfu'], ['get', 'NAME_CFU'], ['get', 'name'], ['get', 'stand_number'], ''],
          'text-size': 16,
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-font': ['Noto Sans Bold'],
          'text-max-width': 10,
          'text-optional': true,
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-radial-offset': 1
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 3,
          'text-opacity': 1
        }
      })
      
      console.log('[ParcelSelectorMap] 🏷️ Scale-dependent labels added: Low (8-10), Medium (11-14), High (15+)')
      
      // General map click handler - clear selection when clicking outside parcels
      map.value.on('click', (e) => {
        console.log('[ParcelSelectorMap] 🖱️ General map click detected at:', e.lngLat)
        
        // Check if clicking on a parcel
        const parcelFeatures = map.value.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] })
        
        // If not clicking on a parcel, clear selection
        if (parcelFeatures.length === 0) {
          console.log('[ParcelSelectorMap] 🗑️ Clicked outside parcels, clearing selection')
          selectedParcel.value = null
          removeSelectedParcelLayers()
        }
      })
      
      // Click handler for parcels - only selectable if within zones
      map.value.on('click', 'parcels-fill', (e) => {
        console.log('[ParcelSelectorMap] 🖱️ Click detected on parcels-fill layer')
        const feature = e.features[0]
        if (!feature) {
          console.log('[ParcelSelectorMap] ❌ No feature found in click event')
          return
        }
        
        console.log('[ParcelSelectorMap] 📦 Clicked feature properties:', feature.properties)
        
        // Find the parcel in our parcels array
        const parcel = parcels.value.find(p => 
          p.parcel_id === (feature.properties?.id || feature.properties?.gid)
        )
        
        if (!parcel) {
          console.log('[ParcelSelectorMap] ❌ Parcel not found in parcels array')
          return
        }
        
        console.log('[ParcelSelectorMap] 🎯 Found parcel:', parcel.parcel_id, parcel.name_cfu || parcel.stand_number)
        
        // Check if parcel intersects with any zone
        if (isParcelInZone(parcel)) {
          console.log('[ParcelSelectorMap] ✅ Parcel is selectable, calling selectParcel')
          selectParcel(parcel)
        } else {
          console.log('[ParcelSelectorMap] ❌ Parcel is not in any zone, not selectable')
          
          // Clear any existing selection
          selectedParcel.value = null
          removeSelectedParcelLayers()
          
          // Show user-friendly notification
          const parcelName = parcel.name_cfu || parcel.stand_number || `Parcel ${parcel.parcel_id}`
          showNotification(
            `📍 ${parcelName}`,
            'This parcel is not at least 25% within the designated land zones and cannot be selected for development application.',
            'warning'
          )
        }
      })
      
      // Change cursor on hover - pointer for selectable parcels, grab for non-selectable
      map.value.on('mouseenter', 'parcels-fill', (e) => {
        const feature = e.features[0]
        if (!feature) return
        
        const parcel = parcels.value.find(p => 
          p.parcel_id === (feature.properties?.id || feature.properties?.gid)
        )
        
        if (parcel && isParcelInZoneFast(parcel)) {
          map.value.getCanvas().style.cursor = 'pointer'
        } else {
          map.value.getCanvas().style.cursor = 'grab'
        }
      })
      
      map.value.on('mouseleave', 'parcels-fill', () => {
        map.value.getCanvas().style.cursor = ''
      })
      
      // Debug: Check if layers were added properly
      setTimeout(() => {
        const layers = map.value.getStyle().layers
        const parcelLayers = layers.filter(layer => layer.source === 'parcels')
        console.log('[ParcelSelectorMap] 📋 Map layers with parcels source:', parcelLayers.map(l => l.id))
        
        // Check layer visibility
        parcelLayers.forEach(layer => {
          const visibility = map.value.getLayoutProperty(layer.id, 'visibility')
          console.log(`[ParcelSelectorMap] Layer ${layer.id} visibility:`, visibility || 'visible')
        })
      }, 1000)
      
      console.log(`[ParcelSelectorMap] Loaded ${parcels.value.length} parcels with QGIS styling`)
    } else {
      console.warn('[ParcelSelectorMap] No parcels found in styled layer')
    }
  } catch (error) {
    console.error('Failed to load parcels:', error)
  }
}

// Check if two geometries intersect (simple bounding box check for performance)
const checkIntersection = (geom1, geom2) => {
  try {
    // First check bounding boxes for quick rejection
    const bbox1 = getBoundingBox(geom1)
    const bbox2 = getBoundingBox(geom2)
    
    // If bounding boxes don't intersect, geometries can't intersect
    if (bbox1.maxX < bbox2.minX || bbox1.minX > bbox2.maxX ||
        bbox1.maxY < bbox2.minY || bbox1.minY > bbox2.maxY) {
      return false
    }
    
    // Use Turf.js for proper geometric intersection
    return turf.intersect(geom1, geom2) !== null
  } catch (e) {
    console.error('[ParcelSelectorMap] Error checking intersection:', e)
    return false
  }
}

// Get bounding box from geometry
const getBoundingBox = (geometry) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  
  const coords = geometry.coordinates[0]
  if (!Array.isArray(coords)) return { minX, minY, maxX, maxY }
  
  coords.forEach(coord => {
    if (Array.isArray(coord) && coord.length >= 2) {
      const [lng, lat] = coord
      minX = Math.min(minX, lng)
      maxX = Math.max(maxX, lng)
      minY = Math.min(minY, lat)
      maxY = Math.max(maxY, lat)
    }
  })
  
  return { minX, minY, maxX, maxY }
}

// Check if parcel is at least 99% within any zone (with detailed logging)
const isParcelInZone = (parcel) => {
  return isParcelInZoneInternal(parcel, true)
}

// Lightweight version for hover checks (no detailed logging)
const isParcelInZoneFast = (parcel) => {
  return isParcelInZoneInternal(parcel, false)
}

// Internal function with caching
const isParcelInZoneInternal = (parcel, detailedLogging = false) => {
  if (!parcel.geometry) {
    if (detailedLogging) console.log('[ParcelSelectorMap] Parcel has no geometry')
    return false
  }
  
  // Check cache first
  const cacheKey = parcel.parcel_id
  if (parcelEligibilityCache.has(cacheKey)) {
    return parcelEligibilityCache.get(cacheKey)
  }
  
  if (detailedLogging) {
    console.log(`[ParcelSelectorMap] Checking parcel ${parcel.parcel_id} against ${zones.value.length} zones`)
  }
  
  try {
    // Calculate total parcel area
    const parcelArea = turf.area(parcel.geometry)
    if (parcelArea <= 0) {
      if (detailedLogging) console.log(`[ParcelSelectorMap] ❌ Parcel ${parcel.parcel_id} has invalid area`)
      parcelEligibilityCache.set(cacheKey, false)
      return false
    }
    
    let maxOverlapPercentage = 0
    let bestZone = null
    
    zones.value.forEach((zone, index) => {
      if (!zone.geometry) return
      
      // Calculate intersection area
      const intersection = turf.intersect(parcel.geometry, zone.geometry)
      if (intersection) {
        const intersectionArea = turf.area(intersection)
        const overlapPercentage = (intersectionArea / parcelArea) * 100
        
        if (detailedLogging) {
          console.log(`[ParcelSelectorMap] 📊 Parcel ${parcel.parcel_id} vs Zone ${index} (${zone.zone || zone.zone_code || 'unnamed'}): ${overlapPercentage.toFixed(2)}% overlap`)
        }
        
        if (overlapPercentage > maxOverlapPercentage) {
          maxOverlapPercentage = overlapPercentage
          bestZone = zone
        }
      }
    })
    
    const isSelectable = maxOverlapPercentage >= 25
    
    if (detailedLogging) {
      if (isSelectable) {
        console.log(`[ParcelSelectorMap] ✅ Parcel ${parcel.parcel_id} is ${maxOverlapPercentage.toFixed(2)}% within zone: ${bestZone?.zone || bestZone?.zone_code || 'unnamed'} - SELECTABLE`)
      } else {
        console.log(`[ParcelSelectorMap] ❌ Parcel ${parcel.parcel_id} is only ${maxOverlapPercentage.toFixed(2)}% within zones (needs 25%) - NOT SELECTABLE`)
      }
    }
    
    // Cache the result
    parcelEligibilityCache.set(cacheKey, isSelectable)
    return isSelectable
  } catch (error) {
    console.error('[ParcelSelectorMap] Error calculating parcel overlap:', error)
    parcelEligibilityCache.set(cacheKey, false)
    return false
  }
}

// Get zone info for a parcel
const getParcelZoneInfo = (parcel) => {
  if (!parcel.geometry) return null
  return zones.value.find(zone => {
    if (!zone.geometry) return false
    return checkIntersection(parcel.geometry, zone.geometry)
  })
}
const searchParcels = async () => {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  
  const query = searchQuery.value.toLowerCase()
  
  // Filter locally - only show parcels within zones
  searchResults.value = parcels.value
    .filter(p => {
      // Must match search query (name_cfu or stand_number)
      const matchesSearch = 
        p.name_cfu?.toLowerCase().includes(query) ||
        p.stand_number?.toLowerCase().includes(query)
      if (!matchesSearch) return false
      
      // Must be within a zone
      return isParcelInZone(p)
    })
    .slice(0, 10)
}

// Select parcel - enforce zone-only selection
// Remove selected parcel layers from map
const removeSelectedParcelLayers = () => {
  if (!map.value) return
  
  try {
    // Remove selection layers if they exist
    if (map.value.getLayer('selected-parcel-fill')) {
      map.value.removeLayer('selected-parcel-fill')
    }
    if (map.value.getLayer('selected-parcel-outline')) {
      map.value.removeLayer('selected-parcel-outline')
    }
    
    // Remove source if it exists
    if (map.value.getSource('selected-parcel')) {
      map.value.removeSource('selected-parcel')
    }
    
    console.log('[ParcelSelectorMap] 🗑️ Selected parcel layers removed')
  } catch (error) {
    console.warn('[ParcelSelectorMap] Error removing selected parcel layers:', error)
  }
}

// Remove all parcel layers (including labels) - useful for cleanup
const removeAllParcelLayers = () => {
  if (!map.value) return
  
  try {
    const parcelLayers = [
      'parcels-fill',
      'parcels-outline', 
      'parcels-labels-high-zoom',
      'parcels-labels-medium-zoom',
      'parcels-labels-low-zoom',
      'selected-parcel-fill',
      'selected-parcel-outline'
    ]
    
    parcelLayers.forEach(layerId => {
      if (map.value.getLayer(layerId)) {
        map.value.removeLayer(layerId)
      }
    })
    
    // Remove sources
    if (map.value.getSource('parcels')) {
      map.value.removeSource('parcels')
    }
    if (map.value.getSource('selected-parcel')) {
      map.value.removeSource('selected-parcel')
    }
    
    console.log('[ParcelSelectorMap] 🗑️ All parcel layers removed')
  } catch (error) {
    console.warn('[ParcelSelectorMap] Error removing parcel layers:', error)
  }
}

const selectParcel = (parcel) => {
  // Validate parcel is within a zone
  if (!isParcelInZone(parcel)) {
    console.warn('[ParcelSelectorMap] Cannot select parcel outside chipinge_land_zones')
    return
  }
  
  // Enrich parcel with zone info
  const zoneInfo = getParcelZoneInfo(parcel)
  if (zoneInfo) {
    parcel.zone_name = zoneInfo.zone_code || zoneInfo.zone
  }
  
  selectedParcel.value = parcel
  searchQuery.value = ''
  searchResults.value = []
  
  // Add selected parcel source if not exists
  const source = map.value.getSource('selected-parcel')
  if (source) {
    map.value.removeLayer('selected-parcel-fill')
    map.value.removeLayer('selected-parcel-outline')
    map.value.removeSource('selected-parcel')
  }
  
  if (parcel.geometry) {
    const geometry = typeof parcel.geometry === 'string' ? JSON.parse(parcel.geometry) : parcel.geometry
    
    map.value.addSource('selected-parcel', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: geometry,
          properties: {}
        }]
      }
    })
    
    map.value.addLayer({
      id: 'selected-parcel-fill',
      type: 'fill',
      source: 'selected-parcel',
      paint: {
        'fill-color': '#ff7800',
        'fill-opacity': 0.5
      }
    })
    
    map.value.addLayer({
      id: 'selected-parcel-outline',
      type: 'line',
      source: 'selected-parcel',
      paint: {
        'line-color': '#ff7800',
        'line-width': 3
      }
    })
    
    // Zoom to parcel with proper coordinate handling
    try {
      let coords
      if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0] // Outer ring of polygon
      } else if (geometry.type === 'MultiPolygon') {
        coords = geometry.coordinates[0][0] // First polygon, outer ring
      } else {
        coords = geometry.coordinates
      }
      
      if (!coords || coords.length === 0) {
        console.warn('[ParcelSelectorMap] No valid coordinates for zoom')
        return
      }
      
      const bounds = new maplibregl.LngLatBounds()
      let validCoords = 0
      
      coords.forEach(coord => {
        // Validate coordinate: [lng, lat] where lng is -180 to 180, lat is -90 to 90
        if (Array.isArray(coord) && coord.length >= 2) {
          const [lng, lat] = coord
          if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
            bounds.extend([lng, lat])
            validCoords++
          }
        }
      })
      
      if (validCoords === 0) {
        console.warn('[ParcelSelectorMap] No valid coordinates for bounds')
        return
      }
      
      console.log('[ParcelSelectorMap] Zooming to parcel bounds:', bounds)
      map.value.fitBounds(bounds, { 
        padding: 100,
        maxZoom: 18,
        duration: 1000
      })
    } catch (e) {
      console.error('[ParcelSelectorMap] Failed to zoom to parcel:', e)
    }
  }
}

// Clear selection
const clearSelection = () => {
  selectedParcel.value = null
  
  const source = map.value.getSource('selected-parcel')
  if (source) {
    map.value.removeLayer('selected-parcel-fill')
    map.value.removeLayer('selected-parcel-outline')
    map.value.removeSource('selected-parcel')
  }
}

// Setup SSE connection for real-time updates
const setupRealtimeUpdates = () => {
  if (eventSource) {
    eventSource.close()
  }
  
  eventSource = new EventSource('/api/development-control/live-updates')
  
  eventSource.onopen = () => {
    connectionStatus.value = 'connected'
    console.log('[ParcelSelectorMap] 🟢 Connected to live updates')
  }
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      console.log('[ParcelSelectorMap] 📡 Update received:', data.type)
      
      if (data.type === 'cache_clear') {
        updateNotification.value = data.message || 'Map data updated'
        // Auto-refresh after 3 seconds if user doesn't click
        setTimeout(() => {
          if (updateNotification.value) {
            refreshData()
          }
        }, 3000)
      } else if (data.type === 'layer_change') {
        updateNotification.value = data.message || 'Layer updated'
      }
    } catch (e) {
      console.error('[ParcelSelectorMap] ❌ Failed to parse update:', e)
    }
  }
  
  eventSource.onerror = (error) => {
    connectionStatus.value = 'error'
    console.error('[ParcelSelectorMap] 🔴 SSE error:', error)
    // Reconnect after 5 seconds
    setTimeout(setupRealtimeUpdates, 5000)
  }
}

// Refresh all map data
const refreshData = async () => {
  updateNotification.value = ''
  loading.value = true
  
  try {
    // Clear existing sources
    if (map.value.getSource('zones')) {
      map.value.removeLayer('zones-fill')
      map.value.removeLayer('zones-outline')
      map.value.removeSource('zones')
    }
    if (map.value.getSource('parcels')) {
      map.value.removeLayer('parcels-fill')
      map.value.removeLayer('parcels-outline')
      map.value.removeSource('parcels')
    }
    
    // Reload data
    await loadZones()
    await loadParcels()
    
    console.log('[ParcelSelectorMap] ✅ Data refreshed successfully')
  } catch (error) {
    console.error('[ParcelSelectorMap] ❌ Failed to refresh data:', error)
  } finally {
    loading.value = false
  }
}
const confirmSelection = () => {
  if (selectedParcel.value) {
    emit('parcel-selected', selectedParcel.value)
  }
}

// Show notification to user
const showNotification = (title, message, type = 'info') => {
  notification.value = {
    title,
    message,
    type,
    timestamp: Date.now()
  }
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (notification.value && notification.value.timestamp === Date.now() - 5000) {
      notification.value = null
    }
  }, 5000)
}

onMounted(() => {
  initializeMap()
  setupRealtimeUpdates()
})

onUnmounted(() => {
  if (map.value) {
    map.value.remove()
  }
  if (eventSource) {
    eventSource.close()
  }
})
</script>

<style scoped>
:deep(.maplibregl-map) {
  border-radius: 0.5rem;
}
</style>
