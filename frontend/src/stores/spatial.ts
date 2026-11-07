import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from '@/utils/axios'
import { feature } from 'topojson-client'
import { ogcService, type OGCCapabilities } from '@/services/ogc'
import { getTileLayerCatalog, type TileLayerMeta } from '@/services/vectorTiles'
import { setBasemapLayerVisible, DEFAULT_VISIBLE } from '@/map/vunguBasemap'

export const useSpatialStore = defineStore('spatial', () => {
  // State
  const layers = ref([])
  const activeLayers = ref(new Map())
  const loading = ref(false)
  const layersAttempted = ref(false)
  const error = ref(null)
  const wmsCaps = ref<OGCCapabilities | null>(null)
  const wfsCaps = ref<OGCCapabilities | null>(null)
  const ogcLoading = ref(false)
  const failedLayers = ref(new Set<string>())

  // PostGIS vector tile layers (zimbabwe.gpkg dataset).
  const tileLayers = ref<TileLayerMeta[]>([])
  // Start in sync with addVunguBasemap() so the first checkbox click hides,
  // rather than no-opping because the store thought every layer was off.
  const visibleTileLayers = ref<Set<string>>(new Set(DEFAULT_VISIBLE))

  // Getters
  const availableLayers = computed(() => layers.value)
  const isLoading = computed(() => loading.value)
  const getLayerData = computed(() => (layerId: string) => {
    return activeLayers.value.get(layerId)
  })
  
  // OGC Getters
  const ogcLayers = computed(() => {
    const layers: any[] = []

    if (wmsCaps.value?.layers) {
      wmsCaps.value.layers.forEach(layer => {
        const hasWFS = wfsCaps.value?.layers?.some(wl => wl.name === layer.name)
        const BAD_TITLES = new Set(['untitled', 'wms', 'qgis', 'layer', ''])
        const rawTitle = (layer.title || '').trim()
        const displayName = rawTitle && !BAD_TITLES.has(rawTitle.toLowerCase())
          ? rawTitle
          : layer.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        layers.push({
          id: `wms-${layer.name}`,
          name: displayName,
          type: 'WMS',
          source: 'ogc',
          serviceName: hasWFS ? 'WMS+WFS' : 'WMS',
          feature_count: 0,
          metadata: layer
        })
      })
    }
    
    return layers
  })
  
  const allAvailableLayers = computed(() => {
    // Build sets of normalized names and ids from dynamic layers to avoid duplicates
    const dynamicNames = new Set<string>(
      (layers.value as any[]).map((l: any) =>
        (l.table_name || l.name || '').toLowerCase().replace(/\s+/g, '_')
      )
    )
    const dynamicIds = new Set<string>(
      (layers.value as any[]).map((l: any) => (l.id || '').toLowerCase())
    )
    // Only include OGC layers not already represented by a dynamic layer (by name or id)
    const uniqueOgcLayers = ogcLayers.value.filter((ol: any) => {
      const ogcName = (ol.metadata?.name || '').toLowerCase().replace(/\s+/g, '_')
      return !dynamicNames.has(ogcName) && !dynamicIds.has(ogcName)
    })
    return [...(layers.value as any[]), ...uniqueOgcLayers]
  })
  
  // Actions
  async function loadLayers() {
    if (loading.value || layersAttempted.value) return
    layersAttempted.value = true
    try {
      loading.value = true
      const response = await axios.get('/dynamic-layers/layers')
      layers.value = response.data?.data ?? []
      // Mark the layers the server says cannot load (views, key-less tables) as disabled before the
      // user touches a toggle. The server already knows this, so no request is made per layer: this
      // used to fetch one feature from every layer (about 40 requests) on every page load. A layer
      // that fails when it is first switched on is still marked failed by loadLayerData below.
      for (const layer of layers.value as any[]) {
        const layerId = layer.id || layer.table_name
        if (layerId && layer.loadable === false) failedLayers.value.add(layerId)
      }
    } catch (err: any) {
      // Backend may be unavailable (e.g. dev without API). Surface the error
      // through `error.value` for any UI that wants to show it, but don't spam
      // the console on every page load.
      error.value = err?.message ?? 'Layer service unavailable'
      layers.value = []
      // Allow a manual retry — clear the attempted flag so a future call works.
      layersAttempted.value = false
    } finally {
      loading.value = false
    }
  }
  
  // Loads the PostGIS vector tile catalog. Safe to call repeatedly.
  async function loadTileLayers() {
    tileLayers.value = await getTileLayerCatalog()
  }

  // Toggles a tile layer's visibility on the given MapLibre map.
  function toggleTileLayer(map: any, layerId: string) {
    const next = !visibleTileLayers.value.has(layerId)
    if (next) visibleTileLayers.value.add(layerId)
    else visibleTileLayers.value.delete(layerId)
    setBasemapLayerVisible(map, layerId, next)
  }

  async function loadLayerData(layerId: string, options = {}) {
    try {
      loading.value = true
      
      const response = await axios.get(`/dynamic-layers/layer/${layerId}`, {
        params: options
      })
      
      // Convert TopoJSON to GeoJSON
      const topology = response.data
      
      // Use the correct topojson-client API to extract FeatureCollection
      const geojson = topology.objects.collection
      
      // Store converted data
      activeLayers.value.set(layerId, {
        topology: topology,
        geojson: geojson,
        metadata: {
          loadedAt: new Date(),
          featureCount: geojson.geometries?.length || 0,
          ...options
        }
      })
      
      return geojson
    } catch (err: any) {
      error.value = err.message
      console.error(`Failed to load layer ${layerId}:`, err)
      throw err
    } finally {
      loading.value = false
    }
  }
  
  async function toggleLayer(layerId: string) {
    if (activeLayers.value.has(layerId)) {
      activeLayers.value.delete(layerId)
    } else {
      try {
        await loadLayerData(layerId)
        failedLayers.value.delete(layerId)
      } catch {
        failedLayers.value.add(layerId)
      }
    }
  }
  
  function clearLayer(layerId: string) {
    activeLayers.value.delete(layerId)
  }
  
  function clearAllLayers() {
    activeLayers.value.clear()
  }
  
  function isLayerActive(layerId: string) {
    return activeLayers.value.has(layerId)
  }
  
  // OGC Actions
  async function loadOGCCapabilities() {
    try {
      ogcLoading.value = true
      
      // Load WMS capabilities first
      try {
        const wmsResponse = await ogcService.getWMSCapabilities()
        wmsCaps.value = wmsResponse
        console.log('✅ WMS Capabilities loaded:', wmsCaps.value?.layers?.length || 0, 'layers')
      } catch (wmsError) {
        console.error('❌ Failed to load WMS capabilities:', wmsError)
        wmsCaps.value = { service: 'WMS', version: '1.3.0', title: 'WMS Service', layers: [] }
      }
      
      // Load WFS capabilities
      try {
        const wfsResponse = await ogcService.getWFSCapabilities()
        wfsCaps.value = wfsResponse
        console.log('✅ WFS Capabilities loaded:', wfsCaps.value?.layers?.length || 0, 'layers')
        
        // If WFS capabilities are empty, use WMS layers as fallback
        if (wfsCaps.value?.layers?.length === 0) {
          console.log('🔄 WFS layers empty, using WMS layers as fallback')
          console.log('📋 WMS layers available:', wmsCaps.value?.layers?.length || 0)
          
          const wfsFallbackLayers = wmsCaps.value?.layers?.map(layer => {
            console.log('🔄 Creating WFS layer from WMS:', layer.name)
            return {
              name: layer.name,
              title: layer.title || layer.name,
              abstract: layer.abstract || `Vector layer ${layer.name}`,
              crs: layer.crs || ['EPSG:4326'],
              bbox: layer.bbox
            }
          }) || []
          
          wfsCaps.value = {
            service: 'WFS',
            version: '2.0.0',
            title: 'WFS Service (PostgreSQL Access)',
            layers: wfsFallbackLayers
          }
          console.log('✅ WFS fallback created with', wfsCaps.value?.layers?.length || 0, 'layers')
        }
      } catch (wfsError) {
        console.error('❌ Failed to load WFS capabilities:', wfsError)
        wfsCaps.value = { service: 'WFS', version: '2.0.0', title: 'WFS Service (PostgreSQL Access)', layers: wmsCaps.value?.layers || [] }
      }
      
      console.log('🌐 OGC capabilities loading complete')
    } catch (err: any) {
      error.value = err.message
      console.error('❌ Failed to load OGC capabilities:', err)
    } finally {
      ogcLoading.value = false
    }
  }
  
  // Load WFS features via PostgreSQL (working approach)
  async function loadWFSFeatures(layerName: string, options: { maxFeatures?: number } = {}) {
    try {
      console.log(`🌐 Loading WFS features for ${layerName} via PostgreSQL...`)
      
      // Use the existing PostgreSQL endpoint that we know works
      const response = await axios.get(`/spatial/layers/${layerName}/features`, {
        params: {
          limit: options.maxFeatures || 1000,
          format: 'geojson'
        }
      })
      
      console.log(`🔍 WFS response received:`, response.data)
      console.log(`🔍 Features count:`, response.data.features?.length || 0)
      
      // Store the GeoJSON response with metadata
      const layerId = `wfs-${layerName}`
      activeLayers.value.set(layerId, {
        type: 'wfs',
        layerName,
        metadata: { name: layerName },
        features: response.data, // GeoJSON FeatureCollection
        _source: 'direct-postgresql'
      })
      
      console.log(`✅ WFS features loaded for ${layerName}: ${response.data.features?.length || 0} features`)
      
    } catch (error) {
      console.error(`❌ Failed to load WFS features for ${layerName}:`, error)
      throw error
    }
  }

  async function loadOGCLayerData(layerId: string, options = {}) {
    try {
      loading.value = true
      console.log(`🌐 Loading OGC layer data for ${layerId}...`)
      
      // Parse layer ID to determine service and layer name
      const [service, layerName] = layerId.split('-')
      
      if (service === 'wms') {
        // For WMS, we don't load feature data, just store metadata
        const layer = ogcLayers.value.find(l => l.id === layerId)
        if (layer) {
          // Use direct QGIS Server URL for better quality
          const bbox = layer.metadata.bbox ? 
            `${layer.metadata.bbox.minx},${layer.metadata.bbox.miny},${layer.metadata.bbox.maxx},${layer.metadata.bbox.maxy}` :
            '25.24,-22.42,33.07,-15.61' // Default Zimbabwe bbox
          
          const wmsUrl = `/qgis/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layerName}&STYLES=&CRS=CRS:84&BBOX=${bbox}&WIDTH=2048&HEIGHT=2048&FORMAT=image/png&TRANSPARENT=FALSE&DPI=96`
          
          console.log(`🌐 Generated WMS URL for ${layerId}:`, wmsUrl)
          
          activeLayers.value.set(layerId, {
            type: 'wms',
            layerName: layerName,
            metadata: layer.metadata,
            url: wmsUrl
          })
        }
      } else if (service === 'wfs') {
        // For WFS, load actual feature data via OGC Bridge
        await loadWFSFeatures(layerName, options)
      }
      
      console.log(`✅ OGC layer data loaded for ${layerId}`)
    } catch (err: any) {
      error.value = err.message
      console.error(`❌ Failed to load OGC layer ${layerId}:`, err)
    } finally {
      loading.value = false
    }
  }
  
  return {
    // State
    layers,
    activeLayers,
    loading,
    error,
    wmsCaps,
    wfsCaps,
    ogcLoading,
    failedLayers,
    tileLayers,
    visibleTileLayers,

    // Getters
    availableLayers,
    isLoading,
    getLayerData,
    ogcLayers,
    allAvailableLayers,

    // Actions
    loadLayers,
    loadTileLayers,
    loadLayerData,
    loadWFSFeatures,
    toggleLayer,
    toggleTileLayer,
    clearLayer,
    clearAllLayers,
    isLayerActive,
    loadOGCCapabilities,
    loadOGCLayerData
  }
})
