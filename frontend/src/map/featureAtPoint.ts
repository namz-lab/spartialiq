// src/map/featureAtPoint.ts
// ─────────────────────────────────────────────────────────────────────────
// "What is this thing on the map" — the basemap feature under a click, with
// the attributes the layer publishes (road class and name, landuse class,
// parcel name and area, POI type…). It answers a different question than
// /inspector/identify, which reports what the REGISTERS hold at a point.
//
// Read straight off the rendered tile rather than fetched: tiles are built
// from the same per-layer attribute allowlist as GET /tiles/:layer/:id
// (src/config/spatialLayers.js), so the attributes are identical and the
// answer is immediate — and it works on maps that add the basemap with
// `interactive: false`, which dispatch no feature-click event of their own.
//
// Layer priority (points > parcels > farms > zones > landuse > admin) is
// pickTopHit's, so this agrees with the basemap's own click behaviour.
// ─────────────────────────────────────────────────────────────────────────
import { pickTopHit } from '@/map/vunguBasemap'

export interface ClickedFeature {
  /** Catalog layer id, e.g. 'roads' (the 'vungu-' style prefix removed). */
  layer: string
  /** Human title from the tile catalog when the caller has one. */
  layerTitle: string | null
  fid: number | string | null
  properties: Record<string, unknown>
}

/** Screen point, as MapLibre reports it on a click. */
export interface ScreenPoint { x: number; y: number }

export function featureAtPoint(
  map: any,
  point: ScreenPoint,
  titles?: Record<string, string>,
): ClickedFeature | null {
  if (!map?.queryRenderedFeatures || !map.getStyle) return null
  let basemapLayerIds: string[]
  try {
    basemapLayerIds = (map.getStyle()?.layers ?? [])
      .map((l: any) => String(l.id))
      .filter((id: string) => id.startsWith('vungu-'))
  } catch {
    return null
  }
  if (!basemapLayerIds.length) return null

  let hits: any[] = []
  try {
    // A few pixels of slack: a road centreline is hard to hit exactly.
    const box: [ScreenPoint, ScreenPoint] = [
      { x: point.x - 4, y: point.y - 4 },
      { x: point.x + 4, y: point.y + 4 },
    ]
    hits = map.queryRenderedFeatures(box, { layers: basemapLayerIds }) ?? []
  } catch {
    return null
  }
  const hit = hits.length ? (pickTopHit(hits) || hits[0]) : null
  if (!hit) return null

  const layer = String(hit.layer?.id ?? '').replace(/^vungu-/, '')
  if (!layer) return null
  const properties: Record<string, unknown> = { ...(hit.properties ?? {}) }
  const fid = properties.fid ?? hit.id ?? null
  return {
    layer,
    layerTitle: titles?.[layer] ?? null,
    fid: (typeof fid === 'number' || typeof fid === 'string') ? fid : null,
    properties,
  }
}
