// src/planning/constraint-tools.ts
// ─────────────────────────────────────────────────────────────────────────
// GRASS-like constraint & suitability helpers, simplified for the browser.
// Buffers, exclusion masks and "net buildable land" all run client-side with
// turf. DEM/slope work stays on the backend (PostGIS/raster); this module just
// turns the polygons it returns into exclusion layers.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import type { ConstraintLayer } from './planning-types'

let seq = 0
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Union a list of polygons defensively (bad geometry is skipped, not thrown). */
export function unionAll(
  polys: Feature<Polygon | MultiPolygon>[],
): Feature<Polygon | MultiPolygon> | null {
  if (!polys.length) return null
  let acc: any = polys[0]
  for (let i = 1; i < polys.length; i++) {
    try { acc = turf.union(acc, polys[i] as any) || acc } catch { /* keep acc */ }
  }
  return acc
}

/** Buffer constraint features (rivers / roads / points) by metres → mask. */
export function bufferConstraint(
  features: Feature[],
  distanceM: number,
  meta: { kind: ConstraintLayer['kind']; label: string },
): ConstraintLayer | null {
  const buffered: Feature<Polygon | MultiPolygon>[] = []
  for (const f of features) {
    try {
      const b = turf.buffer(f as any, distanceM, { units: 'meters' })
      if (b) buffered.push(b as any)
    } catch { /* skip bad geometry */ }
  }
  const merged = unionAll(buffered)
  if (!merged) return null
  return {
    id: id('cons'),
    kind: meta.kind,
    label: meta.label,
    geom: merged.geometry as Polygon | MultiPolygon,
    buildable: false,
    params: { distance_m: distanceM },
  }
}

/** Subtract every exclusion mask from the parcel → net buildable land. */
export function buildableArea(
  parcel: Feature<Polygon | MultiPolygon>,
  constraints: ConstraintLayer[],
): Feature<Polygon | MultiPolygon> | null {
  const masks = constraints.filter(c => !c.buildable)
  if (!masks.length) return parcel
  const mask = unionAll(masks.map(c => turf.feature(c.geom) as any))
  if (!mask) return parcel
  try {
    return (turf.difference(parcel as any, mask as any) as any) ?? null
  } catch {
    return parcel
  }
}

// Slope mask from a backend slope/DEM service.
// CONTRACT: the backend returns GeoJSON polygons where slope exceeds the
// threshold (e.g. GET /api/terrain/slope?aoi=…&min_deg=15). The browser turns
// them into an exclusion ConstraintLayer — DEM processing stays server-side
// (GRASS-like), the design logic stays in the browser.
export function slopeMaskFromPolygons(
  polys: Feature<Polygon | MultiPolygon>[],
  thresholdDeg: number,
): ConstraintLayer | null {
  const merged = unionAll(polys)
  if (!merged) return null
  return {
    id: id('slope'),
    kind: 'slope',
    label: `Slope > ${thresholdDeg}°`,
    geom: merged.geometry as Polygon | MultiPolygon,
    buildable: false,
    params: { threshold_deg: thresholdDeg },
  }
}
