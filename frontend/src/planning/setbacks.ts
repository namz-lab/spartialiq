// src/planning/setbacks.ts
// ─────────────────────────────────────────────────────────────────────────
// Per-lot building envelope from front / side / rear setbacks.
//
// Approximation (robust, not CAD-exact — planners need a usable envelope):
//   1. Inset the whole lot by the SIDE setback (turf.buffer negative).
//   2. Identify the frontage edge (nearest a road, else the longest edge) and
//      the opposite (rear) edge.
//   3. Remove the extra FRONT depth and REAR depth as bands from the front /
//      rear edges (front/rear are usually deeper than the side inset).
//   4. The largest remaining polygon is the buildable envelope; if nothing
//      survives the lot fails the "buildable envelope" check.
//
// Pure functions, no DOM — safe to move into a Web Worker later.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import type { RoadSegment } from './planning-types'

export interface SetbackSpec {
  front: number
  side: number
  rear: number
  /** corner-lot overrides (applied when the lot fronts two roads) */
  cornerFront?: number
  cornerSide?: number
}
export interface EnvelopeResult { geom: Polygon | null; corner: boolean }

interface Edge { a: Position; b: Position; len: number; bearing: number; mid: Position }

// An edge within this of a road centre-line "fronts" it. Sized to cover a lot
// frontage sitting half a road reserve back from the centre-line (≈6 m local,
// 10 m collector, 15 m arterial).
const ROAD_FACE_TOL_M = 16

export function buildingEnvelope(lotGeom: Polygon, roads: RoadSegment[], s: SetbackSpec): EnvelopeResult {
  try {
    const lot = turf.polygon(lotGeom.coordinates)
    const side = Math.max(0, s.side)
    let env: any = side > 0.05 ? largest(turf.buffer(lot, -side, { units: 'meters' })) : largest(lot)
    if (!env || turf.area(env) < 1) return { geom: null, corner: false }

    const edges = rankedEdges(lot)   // longest → shortest
    if (!edges.length) return { geom: null, corner: false }

    // Primary frontage = nearest road edge (fallback: shortest edge). Collect
    // every road-facing edge so we can detect a corner lot (two frontages).
    let primary = edges[edges.length - 1]
    let primaryD = Infinity
    const roadFacing: { e: Edge; d: number }[] = []
    if (roads && roads.length) {
      for (const e of edges) {
        let dMid = Infinity   // nearest by midpoint → primary selection
        let dMax = Infinity   // nearest by whole-edge worst point → fronting test
        for (const r of roads) {
          try {
            const line = turf.feature(r.geom) as any
            const dm = turf.pointToLineDistance(turf.point(e.mid), line, { units: 'meters' })
            const da = turf.pointToLineDistance(turf.point(e.a), line, { units: 'meters' })
            const db = turf.pointToLineDistance(turf.point(e.b), line, { units: 'meters' })
            if (dm < dMid) dMid = dm
            const worst = Math.max(dm, da, db)   // whole edge close ⇒ parallel & adjacent
            if (worst < dMax) dMax = worst
          } catch { /* skip */ }
        }
        if (dMid < primaryD) { primaryD = dMid; primary = e }
        if (dMax < ROAD_FACE_TOL_M) roadFacing.push({ e, d: dMid })   // only true frontages
      }
    }
    // Corner lot = a second road-facing edge adjacent (not opposite) to primary.
    let secondary: Edge | null = null
    if (roadFacing.length >= 2) {
      const cands = roadFacing.filter(x => x.e !== primary).sort((a, b) => a.d - b.d)
      for (const c of cands) { if (angleDiff(c.e.bearing, primary.bearing) < 135) { secondary = c.e; break } }
    }
    const corner = !!secondary

    const rear = oppositeEdge(edges, primary)
    const frontSet = corner ? (s.cornerFront ?? s.front) : s.front
    if (Math.max(0, frontSet - side) > 0.1) {
      const fb = bandAlong(lot, primary, frontSet)
      if (fb) { env = safeDiff(env, fb); if (!env) return { geom: null, corner } }
    }
    if (rear && Math.max(0, s.rear - side) > 0.1) {
      const rb = bandAlong(lot, rear, s.rear)
      if (rb) { env = safeDiff(env, rb); if (!env) return { geom: null, corner } }
    }
    if (corner && secondary) {
      const cornerSide = s.cornerSide ?? s.side   // street setback on the side street
      if (Math.max(0, cornerSide - side) > 0.1) {
        const sb = bandAlong(lot, secondary, cornerSide)
        if (sb) { env = safeDiff(env, sb); if (!env) return { geom: null, corner } }
      }
    }
    if (!env || turf.area(env) < 1) return { geom: null, corner }
    return { geom: (env.geometry || env) as Polygon, corner }
  } catch { return { geom: null, corner: false } }
}

// ── helpers ──────────────────────────────────────────────────────────────
const dest = (p: Position, m: number, bearing: number): Position =>
  turf.destination(p, m, bearing, { units: 'meters' }).geometry.coordinates as Position

function rankedEdges(poly: Feature<Polygon>): Edge[] {
  const ring = poly.geometry.coordinates[0]
  const edges: Edge[] = []
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1]
    const len = turf.distance(a, b, { units: 'meters' })
    if (len < 0.5) continue
    edges.push({ a, b, len, bearing: turf.bearing(a, b), mid: turf.midpoint(a, b).geometry.coordinates as Position })
  }
  edges.sort((x, y) => y.len - x.len)
  return edges
}
function nearestRoadEdge(edges: Edge[], roads: RoadSegment[]): Edge | null {
  let best: Edge | null = null, bestD = Infinity
  for (const e of edges) {
    let d = Infinity
    for (const r of roads) {
      try { const dd = turf.pointToLineDistance(turf.point(e.mid), turf.feature(r.geom) as any, { units: 'meters' }); if (dd < d) d = dd } catch { /* skip */ }
    }
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}
function angleDiff(a: number, b: number): number {
  let d = Math.abs(((a - b) % 360 + 360) % 360)
  if (d > 180) d = 360 - d
  return d
}
function oppositeEdge(edges: Edge[], e: Edge): Edge | null {
  let best: Edge | null = null, bestLen = -1
  for (const x of edges) {
    if (x === e) continue
    if (angleDiff(x.bearing, e.bearing) >= 135 && x.len > bestLen) { bestLen = x.len; best = x }
  }
  return best
}
function perpInto(poly: Feature<Polygon>, A: Position, B: Position, bearingAB: number): number {
  const mid = turf.midpoint(A, B)
  const right = bearingAB + 90
  const test = turf.destination(mid, 0.5, right, { units: 'meters' })
  return turf.booleanPointInPolygon(test, poly as any) ? right : bearingAB - 90
}
/** Quad from an edge projected `depthM` into the lot, extended past each end. */
function bandAlong(poly: Feature<Polygon>, e: Edge, depthM: number): Feature<Polygon> | null {
  try {
    const perp = perpInto(poly, e.a, e.b, e.bearing)
    const ext = 5
    const A2 = dest(e.a, -ext, e.bearing)
    const B2 = dest(e.b, ext, e.bearing)
    const A3 = dest(A2, depthM, perp)
    const B3 = dest(B2, depthM, perp)
    return turf.polygon([[A2, B2, B3, A3, A2]])
  } catch { return null }
}
function safeDiff(a: any, b: any): any {
  try { const d = turf.difference(a, b); return d ? largest(d) : null } catch { return a }
}
function largest(f: any): any {
  if (!f) return null
  const g = f.geometry || f
  if (g.type === 'Polygon') return turf.polygon(g.coordinates)
  if (g.type === 'MultiPolygon') {
    let best: any = null, ba = -1
    for (const c of g.coordinates) { const p = turf.polygon(c); const a = turf.area(p); if (a > ba) { ba = a; best = p } }
    return best
  }
  return null
}
