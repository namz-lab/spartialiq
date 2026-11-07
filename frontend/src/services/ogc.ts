// OGC Services Client - connects to QGIS Server via backend API
import api from './api'
import { isQuietApiFailure } from '@/utils/apiNoise'

export interface OGCCapabilities {
  service: string
  version: string
  title: string
  abstract?: string
  layers: OGCLayer[]
}

export interface OGCLayer {
  name: string
  title: string
  abstract?: string
  crs: string[]
  bbox?: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    crs: string
  }
}

export interface WMSGetMapParams {
  layers: string
  styles?: string
  srs: string
  bbox: string
  width: number
  height: number
  format?: string
  transparent?: boolean
}

export interface WFSGetFeatureParams {
  typeName: string
  outputFormat?: string
  srsName?: string
  bbox?: string
  maxFeatures?: number
  propertyName?: string
}

// OGC Service Client
export class OGCService {
  private baseUrl: string

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  // Health check
  async health() {
    try {
      const response = await api.get(`${this.baseUrl}/ogc/health`, { timeout: 5000 })
      return response.data
    } catch (error) {
      if (!isQuietApiFailure(error)) console.error('OGC health check failed:', error)
      throw error
    }
  }

  // Is QGIS Server actually rendering? Drives automatic WMS-vs-vector
  // selection: healthy -> show pixel-perfect QGIS rasters; otherwise fall
  // back to client-side vector styling. Never throws (a down server = false).
  async isQgisServerHealthy(): Promise<boolean> {
    try {
      const r = await this.health()
      return r?.data?.status === 'healthy'
    } catch {
      return false
    }
  }

  // WMS Capabilities
  async getWMSCapabilities(): Promise<OGCCapabilities> {
    try {
      // Use backend API which correctly parses the QGIS project file
      const response = await api.get(`${this.baseUrl}/ogc/wms/capabilities`)
      const result = response.data.data
      
      if (result.success && result.layers && Array.isArray(result.layers)) {
        return {
          service: 'WMS',
          version: '1.3.0',
          title: 'Vungu GIS',
          layers: result.layers.map((l: any) => ({
            name: l.name,
            title: l.title || l.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            crs: l.crs || ['EPSG:4326', 'EPSG:3857', 'CRS:84']
          }))
        }
      }
      
      throw new Error('No WMS layers available')
    } catch (error) {
      console.error('Failed to get WMS capabilities:', error)
      throw error
    }
  }

  // WFS Capabilities
  async getWFSCapabilities(): Promise<OGCCapabilities> {
    try {
      const response = await api.get(`${this.baseUrl}/ogc/wfs/capabilities`)
      const result = response.data.data
      if (result.layers && Array.isArray(result.layers)) {
        return {
          service: 'WFS',
          version: '2.0.0',
          title: 'Vungu GIS WFS',
          layers: result.layers.map((l: any) => ({
            name: l.name,
            title: l.title || l.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            crs: l.crs || ['EPSG:4326']
          }))
        }
      }
      return result
    } catch (error) {
      console.error('Failed to get WFS capabilities:', error)
      throw error
    }
  }

  // WMS GetMap - returns image URL
  getWMSMapUrl(params: WMSGetMapParams): string {
    const wmsParams = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: '1.3.0',
      STYLES: params.styles || '',
      SRS: params.srs,
      BBOX: params.bbox,
      WIDTH: params.width.toString(),
      HEIGHT: params.height.toString(),
      FORMAT: params.format || 'image/png',
      TRANSPARENT: params.transparent ? 'TRUE' : 'FALSE'
    })

    return `/api/ogc/wms/map/${params.layers}?${wmsParams.toString()}`
  }

  // WFS GetFeature
  async getWFSFeatures(params: {
    typeName: string
    bbox?: string
    maxFeatures?: number
    propertyName?: string
    outputFormat?: string
    srsName?: string
  }): Promise<any[]> {
    try {
      const wfsParams = new URLSearchParams({
        SERVICE: 'WFS',
        REQUEST: 'GetFeature',
        VERSION: '1.1.0',
        OUTPUTFORMAT: params.outputFormat || 'application/json',
        SRSNAME: params.srsName || 'EPSG:4326'
      })

      if (params.bbox) wfsParams.append('BBOX', params.bbox)
      if (params.maxFeatures) wfsParams.append('MAXFEATURES', params.maxFeatures.toString())
      if (params.propertyName) wfsParams.append('PROPERTYNAME', params.propertyName)

      const response = await api.get(`/ogc/wfs/features/${params.typeName}?${wfsParams.toString()}`)
      
      // Handle wrapped response format
      if (response.data?.success && response.data?.data?.features) {
        return response.data.data.features
      }

      // Handle wrapped response where data contains the actual GeoJSON/TopoJSON
      if (response.data?.success && response.data?.data) {
        const innerData = response.data.data

        // Check if innerData is a GeoJSON FeatureCollection
        if (innerData?.type === 'FeatureCollection' && innerData?.features) {
          return innerData.features
        }

        // Check if innerData is TopoJSON
        if (innerData?.type === 'Topology' && innerData.objects?.collection?.features) {
          return innerData.objects.collection.features
        }

        // Check if innerData is direct features array
        if (Array.isArray(innerData)) {
          return innerData
        }
      }

      // Backend returns TopoJSON - extract features from objects.collection
      const topoJson = response.data
      if (topoJson?.type === 'Topology' && topoJson.objects?.collection?.features) {
        return topoJson.objects.collection.features
      }

      // Fallback for pure GeoJSON response
      if (Array.isArray(response.data)) {
        return response.data
      }

      if (response.data?.features) {
        return response.data.features
      }

      console.warn('[OGC] Unexpected WFS response format:', response.data)
      return []
    } catch (error) {
      console.error('Failed to get WFS features:', error)
      throw error
    }
  }

  // WMS GetLegendGraphic — the pixel-perfect legend for symbology MapLibre
  // cannot express, per docs/RENDER-FIDELITY-REPORT.md.
  //
  // `raw=true` is required: without it the route answers a JSON wrapper
  // ({ success, data }), which an <img src> cannot render. The route states the
  // media type it is sending, so the browser gets real image bytes in both the
  // QGIS-Server-up case (image/png) and the offline case (image/svg+xml).
  getWMSLegendGraphicUrl(layer: string, style?: string, format = 'image/png'): string {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetLegendGraphic',
      VERSION: '1.3.0',
      FORMAT: format,
      STYLE: style || '',
      raw: 'true'
    })

    return `/api/ogc/wms/legend/${encodeURIComponent(layer)}?${params.toString()}`
  }

  // Get styled layer (features + QGIS styling + MapLibre style)
  async getStyledLayer(layerName: string, options: { bbox?: string; maxFeatures?: number; noCache?: boolean } = {}) {
    try {
      const params = new URLSearchParams()
      if (options.bbox) params.append('bbox', options.bbox)
      if (options.maxFeatures) params.append('maxFeatures', options.maxFeatures.toString())
      if (options.noCache) params.append('noCache', 'true')
      
      const url = `${this.baseUrl}/ogc/styled-layer/${layerName}${params.toString() ? '?' + params.toString() : ''}`
      const response = await api.get(url)
      const result = response.data.data
      
      // Extract features into a flat GeoJSON Feature array
      if (result.features?.type === 'Topology' && result.features.objects?.collection?.features) {
        // TopoJSON from getDirectFeatures
        result.features = result.features.objects.collection.features
      } else if (result.features?.type === 'FeatureCollection') {
        // Standard GeoJSON FeatureCollection
        result.features = result.features.features || []
      } else if (result.features?.success === false) {
        // Backend returned error for features
        console.warn('[OGC] Features fetch failed on backend:', result.features.error)
        result.features = []
      } else if (!Array.isArray(result.features)) {
        console.warn('[OGC] Unexpected features format:', typeof result.features)
        result.features = []
      }
      
      return result
    } catch (error) {
      console.error('Failed to get styled layer:', error)
      throw error
    }
  }

  // Get MapLibre style for a layer
  async getMapLibreStyle(layerName: string) {
    try {
      const response = await api.get(`${this.baseUrl}/ogc/maplibre-style/${layerName}`)
      return response.data.data
    } catch (error) {
      console.error('Failed to get MapLibre style:', error)
      throw error
    }
  }

  // Get all available layers from the QGIS project
  async getAvailableLayers() {
    try {
      const response = await api.get(`${this.baseUrl}/ogc/layers`, { timeout: 8000 })
      return response.data.data?.layers || []
    } catch (error) {
      if (!isQuietApiFailure(error)) console.error('Failed to get available layers:', error)
      return []
    }
  }

  async clearCache(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await api.post(`${this.baseUrl}/ogc/cache/clear`)
      return response.data
    } catch (error: any) {
      console.error('Failed to clear cache:', error)
      throw error
    }
  }

  async getWatcherStatus(): Promise<{ isWatching: boolean; projectPath: string; lastClearTime: string | null }> {
    try {
      const response = await api.get(`${this.baseUrl}/ogc/watcher/status`)
      return response.data.data
    } catch (error: any) {
      console.error('Failed to get watcher status:', error)
      throw error
    }
  }
}

// Create singleton instance
export const ogcService = new OGCService()

// WMS GetMap raster-tile template for MapLibre, rendered by QGIS Server via
// the backend proxy. The {bbox-epsg-3857} token must stay UNencoded so
// MapLibre can substitute it per tile (URLSearchParams would escape the
// braces, which is why getWMSMapUrl above can't be used for tile sources).
// The QGIS Server address itself lives in the backend env (QGIS_SERVER_URL) —
// nothing here points at a server directly.
import { apiBaseUrl } from './runtimeOrigin'
const API_BASE = apiBaseUrl()

// 512 px tiles by default, not 256: a 1920x1080 viewport needs ~12 of them
// instead of ~40, so a pan costs a quarter of the QGIS renders and HTTP
// round-trips. That matters because QGIS Server runs a single FCGI worker —
// fewer, larger tiles keep bursts from queueing behind one renderer.
// Callers must pass the SAME value to MapLibre's `tileSize`.
export function wmsTileUrlTemplate(layerName: string, size = 512): string {
  return `${API_BASE}/ogc/wms/map/${encodeURIComponent(layerName)}`
    + `?bbox={bbox-epsg-3857}&width=${size}&height=${size}&crs=EPSG:3857&transparent=true`
}

// Helper functions for common operations
export async function testOGCConnection() {
  try {
    const health = await ogcService.health()
    console.log('✅ OGC Service Health:', health)
    
    const wmsCaps = await ogcService.getWMSCapabilities()
    console.log('✅ WMS Layers:', wmsCaps.layers?.length || 0)
    
    const wfsCaps = await ogcService.getWFSCapabilities()
    console.log('✅ WFS Layers:', wfsCaps.layers?.length || 0)
    
    return { health, wmsCaps, wfsCaps }
  } catch (err: any) {
    console.error('❌ OGC Connection failed:', err)
    throw err
  }
}

// Get map image for Leaflet
export function getWMSLayerForLeaflet(layerName: string, options: Partial<WMSGetMapParams> = {}) {
  const defaultParams: WMSGetMapParams = {
    layers: layerName,
    srs: 'EPSG:4326',
    bbox: '-180,-90,180,90',
    width: 256,
    height: 256,
    format: 'image/png',
    transparent: true,
    ...options
  }

  return {
    url: `${ogcService['baseUrl']}/wms/map`,
    layers: defaultParams.layers,
    styles: defaultParams.styles || '',
    format: defaultParams.format,
    transparent: defaultParams.transparent,
    version: '1.3.0',
    attribution: 'QGIS Server'
  }
}
