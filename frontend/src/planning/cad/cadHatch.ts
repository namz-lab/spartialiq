// src/planning/cad/cadHatch.ts
// ─────────────────────────────────────────────────────────────────────────
// Hatch generator (CAD-1 completion — land-use fills). Produces a pattern for a
// closed boundary: parallel scanlines (single or cross), or a dot grid, clipped
// to the polygon interior. All work runs in the local metre frame so `spacingM`
// is true ground spacing (scale-true) and the same lines render on the map and
// the Plot sheet. Even–odd crossing across ALL rings, so holes are respected.
// Pure: no Vue, no turf.
// ─────────────────────────────────────────────────────────────────────────
import type { Geometry, Position } from 'geojson'
import { frameForGeom, type MetreFrame } from './cadGeometry'
import type { HatchSpec } from './cadModel'

// Perf guard: never emit more than this many scanlines / dot rows for one hatch.
const MAX_ROWS = 2000

function rot(p: Position, c: number, s: number): Position { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c] }

function ringsOf(geom: Geometry): Position[][] {
  if (geom.type === 'Polygon') return geom.coordinates
  if (geom.type === 'MultiPolygon') return (geom.coordinates as Position[][][]).flat()
  return []
}

/** Even–odd point-in-polygon across all rings (metre space). */
function inside(pt: Position, rings: Position[][]): boolean {
  let win = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) win = !win
    }
  }
  return win
}

function bbox(rings: Position[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rings) for (const p of r) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
  }
  return { minX, minY, maxX, maxY }
}

/** Parallel hatch segments at `angleDeg`, `spacing` metres apart, clipped to the rings. */
function scanlines(ringsM: Position[][], angleDeg: number, spacing: number): Position[][] {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(-a), s = Math.sin(-a)     // rotate hatch direction → horizontal
  const ci = Math.cos(a), si = Math.sin(a)     // inverse rotation
  const rings = ringsM.map(r => r.map(p => rot(p, c, s)))
  const b = bbox(rings)
  const out: Position[][] = []
  const step = Math.max(spacing, 0.05)
  if ((b.maxY - b.minY) / step > MAX_ROWS) return out
  const start = Math.ceil(b.minY / step) * step
  for (let y = start; y <= b.maxY; y += step) {
    const xs: number[] = []
    for (const r of rings) {
      for (let i = 0; i < r.length - 1; i++) {
        const y1 = r[i][1], y2 = r[i + 1][1]
        // half-open test avoids double-counting shared vertices
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          const t = (y - y1) / (y2 - y1)
          xs.push(r[i][0] + t * (r[i + 1][0] - r[i][0]))
        }
      }
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < 1e-6) continue
      out.push([rot([xs[i], y], ci, si), rot([xs[i + 1], y], ci, si)])
    }
  }
  return out
}

function dotGrid(ringsM: Position[][], spacing: number): Position[] {
  const b = bbox(ringsM)
  const step = Math.max(spacing, 0.05)
  if ((b.maxY - b.minY) / step > MAX_ROWS || (b.maxX - b.minX) / step > MAX_ROWS) return []
  const dots: Position[] = []
  const sy = Math.ceil(b.minY / step) * step
  const sx = Math.ceil(b.minX / step) * step
  for (let y = sy; y <= b.maxY; y += step)
    for (let x = sx; x <= b.maxX; x += step)
      if (inside([x, y], ringsM)) dots.push([x, y])
  return dots
}

export interface HatchGeom { lines: Position[][]; dots: Position[] }

/** Generate the hatch pattern for `geom` in lng/lat. Solid → no lines/dots. */
export function generateHatch(geom: Geometry, spec: HatchSpec, frame?: MetreFrame): HatchGeom {
  const ringsLL = ringsOf(geom)
  if (ringsLL.length < 1) return { lines: [], dots: [] }
  const f = frame ?? frameForGeom(geom)
  const ringsM = ringsLL.map(r => r.map(f.fwd))

  let linesM: Position[][] = []
  if (spec.pattern === 'lines') {
    linesM = scanlines(ringsM, spec.angleDeg, spec.spacingM)
  } else if (spec.pattern === 'cross') {
    linesM = [...scanlines(ringsM, spec.angleDeg, spec.spacingM), ...scanlines(ringsM, spec.angleDeg + 90, spec.spacingM)]
  }
  const dotsM = spec.pattern === 'dots' ? dotGrid(ringsM, spec.spacingM) : []

  return {
    lines: linesM.map(seg => seg.map(f.inv)),
    dots: dotsM.map(f.inv),
  }
}
