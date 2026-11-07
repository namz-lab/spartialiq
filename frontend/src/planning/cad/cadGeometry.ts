// src/planning/cad/cadGeometry.ts
// ─────────────────────────────────────────────────────────────────────────
// Survey-accurate geometry kernel for the CAD document. Per the architecture,
// ALL editing math runs in a LOCAL PLANAR METRE FRAME (proj4 UTM zone derived
// from the geometry), then converts back to lng/lat — so move/rotate/scale/mirror
// are metre-accurate, not degree-warped. Offset uses turf.lineOffset for CAD-1;
// robust polygon offset/boolean (JSTS) arrives in CAD-2.
// ─────────────────────────────────────────────────────────────────────────
import proj4 from 'proj4'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Geometry, Position } from 'geojson'

export interface MetreFrame {
  fwd: (lngLat: Position) => Position   // lng/lat → [easting, northing] metres
  inv: (xy: Position) => Position       // metres → lng/lat
}

/** Build a local UTM metre frame for the zone containing [lng, lat]. */
export function frameFor(lng: number, lat: number): MetreFrame {
  const zone = Math.floor((lng + 180) / 6) + 1
  const def = `+proj=utm +zone=${zone} ${lat < 0 ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`
  return {
    fwd: (c) => proj4('EPSG:4326', def, [c[0], c[1]]) as Position,
    inv: (c) => proj4(def, 'EPSG:4326', [c[0], c[1]]) as Position,
  }
}

/** Frame anchored on a geometry's first coordinate (good enough for one parcel). */
export function frameForGeom(geom: Geometry): MetreFrame {
  const first = firstCoord(geom)
  return frameFor(first[0], first[1])
}

function firstCoord(geom: Geometry): Position {
  let c: any = (geom as any).coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return c as Position
}

/** Apply a coordinate function over any geometry, preserving its structure. */
export function mapCoords(geom: Geometry, fn: (c: Position) => Position): Geometry {
  const walk = (c: any): any => (Array.isArray(c[0]) ? c.map(walk) : fn(c as Position))
  const g = JSON.parse(JSON.stringify(geom))
  if ((g as any).coordinates) (g as any).coordinates = walk((g as any).coordinates)
  return g
}

/** Run an op in the metre frame: lng/lat → metres → op → lng/lat. */
function inFrame(geom: Geometry, frame: MetreFrame, op: (c: Position) => Position): Geometry {
  const toM = mapCoords(geom, frame.fwd)
  const moved = mapCoords(toM, op)
  return mapCoords(moved, frame.inv)
}

// ── transforms (dx/dy and pivots given in metres unless noted) ───────────────

/** Move by dxEast/dyNorth metres. */
export function translate(geom: Geometry, frame: MetreFrame, dx: number, dy: number): Geometry {
  return inFrame(geom, frame, ([x, y]) => [x + dx, y + dy])
}

/** Rotate `deg` clockwise about a pivot given in lng/lat. */
export function rotate(geom: Geometry, frame: MetreFrame, deg: number, pivotLngLat: Position): Geometry {
  const [px, py] = frame.fwd(pivotLngLat)
  const r = (-deg * Math.PI) / 180   // screen-clockwise
  const cos = Math.cos(r), sin = Math.sin(r)
  return inFrame(geom, frame, ([x, y]) => {
    const dx = x - px, dy = y - py
    return [px + dx * cos - dy * sin, py + dx * sin + dy * cos]
  })
}

/** Scale by factor `k` about an origin given in lng/lat. */
export function scale(geom: Geometry, frame: MetreFrame, k: number, originLngLat: Position): Geometry {
  const [ox, oy] = frame.fwd(originLngLat)
  return inFrame(geom, frame, ([x, y]) => [ox + (x - ox) * k, oy + (y - oy) * k])
}

/** Mirror across the line through two lng/lat points. */
export function mirror(geom: Geometry, frame: MetreFrame, aLngLat: Position, bLngLat: Position): Geometry {
  const [ax, ay] = frame.fwd(aLngLat)
  const [bx, by] = frame.fwd(bLngLat)
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  return inFrame(geom, frame, ([x, y]) => {
    // reflect point P across line A–B
    const t = ((x - ax) * dx + (y - ay) * dy) / len2
    const projx = ax + t * dx, projy = ay + t * dy
    return [2 * projx - x, 2 * projy - y]
  })
}

/** Parallel offset of a line/polyline by `distM` metres (sign = side). turf-based. */
export function offsetLine(geom: Geometry, distM: number): Geometry | null {
  try {
    const off = turf.lineOffset(turf.feature(geom as any) as any, distM, { units: 'meters' })
    return (off?.geometry as Geometry) ?? null
  } catch { return null }
}

// ── measurement ──────────────────────────────────────────────────────────────
export function lengthM(geom: Geometry): number {
  try { return turf.length(turf.feature(geom as any) as any, { units: 'meters' }) } catch { return 0 }
}
export function areaM2(geom: Geometry): number {
  try { return turf.area(turf.feature(geom as any) as any) } catch { return 0 }
}
