// src/services/vectorTiles.ts
// Client for the backend PostGIS vector tile service (/api/tiles).
import api from './api'
import { isQuietApiFailure } from '@/utils/apiNoise'
import { absoluteApiUrl } from './runtimeOrigin'

export interface TileLayerMeta {
  id: string
  title: string
  geomType: 'polygon' | 'line' | 'point'
  group: 'admin' | 'landuse' | 'hydro' | 'transport' | 'structures' | 'poi' | 'master_plan'
  minzoom: number
  maxzoom: number
}

/** MapLibre vector-source tile template for a layer (absolute URL for workers / Tauri). */
export function tileUrlTemplate(layerId: string): string {
  return absoluteApiUrl(`/api/tiles/${layerId}/{z}/{x}/{y}.pbf`)
}

// Module-level promise cache — deduplicated across concurrent callers and
// reused across map instances within the same session. The catalog is static
// at runtime (only changes on server restart), so one fetch per page load is
// enough. Call prefetchTileLayerCatalog() early so the promise is already
// resolving by the time the MapLibre 'load' event fires.
let _catalogPromise: Promise<TileLayerMeta[]> | null = null

/** Fetches the layer catalog. Returns [] on failure so maps still render. */
export function getTileLayerCatalog(): Promise<TileLayerMeta[]> {
  if (!_catalogPromise) {
    _catalogPromise = api.get('/tiles/layers')
      .then(res => res.data?.data ?? [])
      .catch(error => {
        _catalogPromise = null  // allow retry on next call
        console.error('Failed to load tile layer catalog:', error)
        return [] as TileLayerMeta[]
      })
  }
  return _catalogPromise
}

/** Fire the catalog fetch immediately — call this as early as possible so the
 *  promise is in flight while the MapLibre WebGL context initialises. */
export function prefetchTileLayerCatalog(): void {
  getTileLayerCatalog()
}

/** Drop the cached catalog so the next call refetches — used when the server
 *  signals a layer-catalog change (SSE cache_clear) and by tests. */
export function resetTileLayerCatalog(): void {
  _catalogPromise = null
}

/** Fetches a single feature as a GeoJSON Feature, or null if not found. */
export async function getFeature(layerId: string, fid: number): Promise<any | null> {
  try {
    const res = await api.get(`/tiles/${layerId}/${fid}`, { timeout: 8000 })
    return res.data ?? null
  } catch (error) {
    if (!isQuietApiFailure(error)) {
      console.error(`Failed to load feature ${layerId}/${fid}:`, error)
    }
    return null
  }
}

export interface WardRecord {
  fid: number
  name: string
  pcode: string | null
  center: [number, number]   // [lon, lat]
}

/** Fetches the full ward list with centroids, used by the planner ward selector. */
export async function getWards(): Promise<WardRecord[]> {
  try {
    const res = await api.get('/wards', { timeout: 8000 })
    return res.data?.data ?? []
  } catch (error) {
    if (!isQuietApiFailure(error)) {
      console.error('Failed to load ward list:', error)
    }
    return []
  }
}

export interface SearchResult {
  type: 'ward' | 'parcel' | 'farm' | 'place' | 'poi' | 'zone'
  label: string
  subtitle?: string
  center: [number, number]   // [lon, lat]
}

/** Searches wards, parcels, farm cadastre and places by name. Returns [] on
 *  failure or for queries shorter than 2 chars. */
export async function searchMap(q: string): Promise<SearchResult[]> {
  const term = q.trim()
  if (term.length < 1) return []
  try {
    const res = await api.get('/map-search', { params: { q: term } })
    return res.data?.data ?? []
  } catch (error) {
    console.error('Map search failed:', error)
    return []
  }
}
