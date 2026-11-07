// src/planning/road-templates.ts
// ─────────────────────────────────────────────────────────────────────────
// Road-network templates for the Planning Studio. Pure geometry — given a
// planning-area polygon, generate sensible street centre-lines (grid, spine,
// ring/loop, perimeter) clipped to the parcel. No Vue, no MapLibre: the
// composable feeds the returned LineStrings to addRoad().
//
// All distances are real ground metres (geodesic via turf), coordinates are
// WGS84 [lng, lat] — same convention as planning-types.ts.
// ─────────────────────────────────────────────────────────────────────────
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon, LineString } from 'geojson'

type AreaFeature = Feature<Polygon | MultiPolygon>

/** Constituent polygons of a Polygon/MultiPolygon area as individual features. */
function polysOf(area: AreaFeature): Feature<Polygon>[] {
  try { return turf.flatten(area).features as Feature<Polygon>[] } catch { return [] }
}

/**
 * Clip a centre-line to the inside of a (multi)polygon, returning the inside
 * segments only. Splits the line at every boundary crossing and keeps the
 * pieces whose midpoint lies within the area.
 */
export function clipLineToPolygon(line: Feature<LineString>, area: AreaFeature): LineString[] {
  const out: LineString[] = []
  for (const poly of polysOf(area)) {
    let segments: Feature<LineString>[]
    try {
      const split = turf.lineSplit(line, poly)
      segments = (split.features && split.features.length) ? split.features : [line]
    } catch {
      segments = [line]
    }
    for (const seg of segments) {
      try {
        const len = turf.length(seg, { units: 'meters' })
        if (len < 1) continue
        const mid = turf.along(seg, len / 2, { units: 'meters' })
        if (turf.booleanPointInPolygon(mid, poly)) out.push(seg.geometry as LineString)
      } catch { /* skip degenerate segment */ }
    }
  }
  return out
}

/** The single longest LineString in a list (by ground length), or null. */
export function longestLine(lines: LineString[]): LineString | null {
  let best: LineString | null = null
  let bestLen = 0
  for (const g of lines) {
    try {
      const len = turf.length(turf.feature(g) as any, { units: 'meters' })
      if (len > bestLen) { bestLen = len; best = g }
    } catch { /* skip */ }
  }
  return best
}

/** Positions stepping from `start` along `bearing` by `stepM` until past `limit`
 *  on the same axis. Returns the moving coordinate at each step (geodesic). */
function walk(start: number[], bearing: number, stepM: number, axisIndex: 0 | 1, limit: number): number[][] {
  const pts: number[][] = []
  let p = start
  let guard = 0
  const ascending = (bearing === 0 || bearing === 90)
  while (guard++ < 2000) {
    if (ascending ? p[axisIndex] > limit : p[axisIndex] < limit) break
    pts.push(p)
    try { p = turf.destination(p, stepM, bearing, { units: 'meters' }).geometry.coordinates } catch { break }
  }
  return pts
}

/**
 * Grid of streets at `spacingM` intervals (both N–S and E–W), clipped to the
 * parcel. The workhorse template for township extensions / farm subdivisions.
 */
export function gridRoads(area: AreaFeature, spacingM = 150): LineString[] {
  const [minX, minY, maxX, maxY] = turf.bbox(area)
  const midY = (minY + maxY) / 2
  const midX = (minX + maxX) / 2
  const out: LineString[] = []

  // Vertical streets (run N–S): step east across the parcel.
  for (const p of walk([minX, midY], 90, spacingM, 0, maxX)) {
    const x = p[0]
    const line = turf.lineString([[x, minY], [x, maxY]])
    out.push(...clipLineToPolygon(line, area))
  }
  // Horizontal streets (run E–W): step north across the parcel.
  for (const p of walk([midX, minY], 0, spacingM, 1, maxY)) {
    const y = p[1]
    const line = turf.lineString([[minX, y], [maxX, y]])
    out.push(...clipLineToPolygon(line, area))
  }
  return out
}

/** A single spine road down the parcel's longer axis, clipped to the parcel. */
export function spineRoad(area: AreaFeature): LineString | null {
  const [minX, minY, maxX, maxY] = turf.bbox(area)
  const midY = (minY + maxY) / 2
  const midX = (minX + maxX) / 2
  const wide = turf.distance([minX, midY], [maxX, midY], { units: 'meters' })
  const tall = turf.distance([midX, minY], [midX, maxY], { units: 'meters' })
  const line = wide >= tall
    ? turf.lineString([[minX, midY], [maxX, midY]])
    : turf.lineString([[midX, minY], [midX, maxY]])
  return longestLine(clipLineToPolygon(line, area))
}

/** Polygon outline(s) as LineStrings (handles Line/MultiLine output of polygonToLine). */
function outlineLines(polyOrMulti: any): LineString[] {
  const out: LineString[] = []
  const push = (f: any) => {
    const g = f.geometry || f
    if (!g) return
    if (g.type === 'LineString') out.push(g)
    else if (g.type === 'MultiLineString') for (const c of g.coordinates) out.push({ type: 'LineString', coordinates: c })
  }
  try {
    for (const poly of (turf.flatten(polyOrMulti).features as any[])) {
      push(turf.polygonToLine(poly))
    }
  } catch { /* ignore */ }
  return out
}

/**
 * A loop / ring road set back `insetM` from the parcel boundary. With a small
 * inset it doubles as an "align to boundary" perimeter road.
 */
export function ringRoad(area: AreaFeature, insetM = 20): LineString[] {
  let inner: any
  try { inner = turf.buffer(area, -insetM, { units: 'meters' }) } catch { inner = null }
  if (!inner) return []
  // buffer of a small/!concave parcel can collapse — fall back to the boundary.
  const lines = outlineLines(inner)
  return lines.length ? lines : outlineLines(area)
}

/**
 * An axis-aligned square of the given ground area, centred on a point that is
 * guaranteed to lie inside the parcel, then trimmed to the parcel. Used to drop
 * a civic facility reserve (school/clinic) into a generated neighbourhood.
 */
export function facilitySquareInside(area: AreaFeature, areaSqm: number): Polygon | MultiPolygon | null {
  const side = Math.sqrt(Math.max(areaSqm, 1))
  const h = side / 2
  let centre: number[]
  try { centre = (turf.pointOnFeature(area).geometry as any).coordinates } catch { return null }
  try {
    const n = turf.destination(centre, h, 0, { units: 'meters' }).geometry.coordinates[1]
    const s = turf.destination(centre, h, 180, { units: 'meters' }).geometry.coordinates[1]
    const e = turf.destination(centre, h, 90, { units: 'meters' }).geometry.coordinates[0]
    const w = turf.destination(centre, h, 270, { units: 'meters' }).geometry.coordinates[0]
    const square = turf.polygon([[[w, n], [e, n], [e, s], [w, s], [w, n]]])
    const clipped = turf.intersect(square as any, area as any)
    return (clipped?.geometry as any) || (square.geometry as any)
  } catch { return null }
}
