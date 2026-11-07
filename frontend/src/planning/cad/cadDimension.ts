// src/planning/cad/cadDimension.ts
// ─────────────────────────────────────────────────────────────────────────
// Dimension kernel (CAD-2, final piece).  Computes linear/aligned dimension
// geometry — witness lines, the dimension line, architectural ticks, and the
// measurement label — and resolves ASSOCIATIVE anchors against live entities so
// a dimension re-measures itself whenever its anchored vertices move (e.g. a
// grip Stretch).  All measurement runs in the local metre frame (cadGeometry.ts)
// so distances are survey-accurate, not degree-warped.
// ─────────────────────────────────────────────────────────────────────────
import type { Position } from 'geojson'
import { frameFor, type MetreFrame } from './cadGeometry'
import { coordAt } from './cadGrips'
import type { CadEntity, DimAnchor, DimMode } from './cadModel'

// ── small vector helpers (metre frame) ─────────────────────────────────────────
const sub = (a: Position, b: Position): Position => [a[0] - b[0], a[1] - b[1]]
const add = (a: Position, b: Position): Position => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Position, k: number): Position => [a[0] * k, a[1] * k]
const len = (a: Position) => Math.hypot(a[0], a[1])
const unit = (a: Position): Position => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }
const dot = (a: Position, b: Position) => a[0] * b[0] + a[1] * b[1]
/** left normal (90° CCW) */
const perp = (a: Position): Position => [-a[1], a[0]]

// ── anchor resolution (associative) ────────────────────────────────────────────

/** Resolve a dimension anchor to a live lng/lat, following entity vertices. */
export function resolveAnchor(anchor: DimAnchor, entities: CadEntity[]): [number, number] | null {
  if (anchor.entityId && anchor.gripPath) {
    const e = entities.find(x => x.id === anchor.entityId)
    if (e) {
      const c = coordAt(e.geom, anchor.gripPath)
      if (c) return c
    }
  }
  return anchor.lngLat ?? null
}

// ── offset from a third (placement) click ──────────────────────────────────────

/** Signed perpendicular offset (metres) of point `c` from the a→b span. */
export function offsetFromPoint(
  a: [number, number], b: [number, number], c: [number, number], frame?: MetreFrame,
): number {
  const f = frame ?? frameFor(a[0], a[1])
  const A = f.fwd(a), B = f.fwd(b), C = f.fwd(c)
  const dir = unit(sub(B, A))
  return dot(sub(C, A), perp(dir))
}

// ── nearest-vertex hit-test (for associative anchoring on click) ───────────────

export interface VertexHit { entityId: string; gripPath: number[]; lngLat: [number, number] }

/**
 * Find the nearest entity vertex within `tolM` metres of `lngLat`, for snapping a
 * dimension end onto geometry so the anchor becomes associative.  Dimension and
 * text entities are skipped (their geometry is annotation, not measured edges).
 */
export function findVertexAt(
  entities: CadEntity[], lngLat: [number, number], tolM = 4, frame?: MetreFrame,
): VertexHit | null {
  const f = frame ?? frameFor(lngLat[0], lngLat[1])
  const target = f.fwd(lngLat)
  let best: VertexHit | null = null
  let bestD = tolM

  const consider = (entityId: string, gripPath: number[], c: [number, number]) => {
    const d = len(sub(f.fwd(c), target))
    if (d <= bestD) { bestD = d; best = { entityId, gripPath, lngLat: c } }
  }

  for (const e of entities) {
    if (e.type === 'dimension' || e.type === 'text') continue
    const g: any = e.geom
    switch (g.type) {
      case 'Point':
        consider(e.id, [], g.coordinates)
        break
      case 'LineString':
        g.coordinates.forEach((c: any, i: number) => consider(e.id, [i], c))
        break
      case 'Polygon':
        g.coordinates.forEach((ring: any[], ri: number) => {
          for (let vi = 0; vi < ring.length - 1; vi++) consider(e.id, [ri, vi], ring[vi])
        })
        break
      case 'MultiLineString':
        g.coordinates.forEach((line: any[], li: number) =>
          line.forEach((c: any, vi: number) => consider(e.id, [li, vi], c)))
        break
      case 'MultiPolygon':
        g.coordinates.forEach((poly: any[], pi: number) =>
          poly.forEach((ring: any[], ri: number) => {
            for (let vi = 0; vi < ring.length - 1; vi++) consider(e.id, [pi, ri, vi], ring[vi])
          }))
        break
    }
  }
  return best
}

// ── dimension geometry ─────────────────────────────────────────────────────────

export interface DimensionRender {
  /** poly-lines (lng/lat): witness A, witness B, dimension line, tick A, tick B */
  paths: Position[][]
  /** label placement + rotation (degrees, screen) and the measured distance */
  textLngLat: [number, number]
  textAngleDeg: number
  distanceM: number
  label: string
}

const TICK_M = 1.2          // architectural tick half-length (metres)
const OVERSHOOT_M = 1.0     // witness line overshoot past the dimension line
const GAP_M = 0.6           // witness line gap from the measured point

function fmt(distM: number): string {
  return distM >= 100 ? `${distM.toFixed(0)} m` : `${distM.toFixed(2)} m`
}

/**
 * Build the renderable geometry + label for a dimension between `a` and `b`,
 * with the dimension line offset by `offsetM` metres (signed; perpendicular for
 * 'aligned').  `mode` selects aligned / horizontal / vertical measurement.
 */
export function computeDimension(
  a: [number, number], b: [number, number], offsetM: number, mode: DimMode = 'aligned',
  frame?: MetreFrame,
): DimensionRender | null {
  const f = frame ?? frameFor(a[0], a[1])
  const A = f.fwd(a), B = f.fwd(b)
  if (len(sub(B, A)) < 1e-6) return null

  // direction of the dimension line + the two offset endpoints A2/B2
  let dir: Position
  let A2: Position, B2: Position
  let distanceM: number

  if (mode === 'aligned') {
    dir = unit(sub(B, A))
    const n = perp(dir)
    A2 = add(A, mul(n, offsetM))
    B2 = add(B, mul(n, offsetM))
    distanceM = len(sub(B, A))
  } else if (mode === 'horizontal') {
    // dimension line is east-west; placed |offsetM| beyond the outer point
    const baseY = (offsetM >= 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) + offsetM
    A2 = [A[0], baseY]
    B2 = [B[0], baseY]
    dir = unit(sub(B2, A2))
    distanceM = Math.abs(B[0] - A[0])
  } else {
    // vertical: dimension line is north-south
    const baseX = (offsetM >= 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) + offsetM
    A2 = [baseX, A[1]]
    B2 = [baseX, B[1]]
    dir = unit(sub(B2, A2))
    distanceM = Math.abs(B[1] - A[1])
  }

  // witness (extension) lines: from a small gap off the measured point to a small
  // overshoot past the dimension line, along each point→dimension-end direction.
  const witness = (P: Position, P2: Position): Position[] => {
    const wdir = unit(sub(P2, P))
    const start = add(P, mul(wdir, GAP_M))
    const end = add(P2, mul(wdir, OVERSHOOT_M))
    return [f.inv(start), f.inv(end)]
  }

  // architectural ticks: a short 45°-to-the-line stroke centred on each dim end
  const tickDir = unit(add(dir, perp(dir)))   // 45° between line dir and its normal
  const tick = (P2: Position): Position[] => [
    f.inv(sub(P2, mul(tickDir, TICK_M))),
    f.inv(add(P2, mul(tickDir, TICK_M))),
  ]

  const paths: Position[][] = [
    witness(A, A2),
    witness(B, B2),
    [f.inv(A2), f.inv(B2)],   // dimension line
    tick(A2),
    tick(B2),
  ]

  const mid = mul(add(A2, B2), 0.5)
  let angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI   // metre-frame angle
  // keep text upright (never upside-down)
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180

  return {
    paths,
    textLngLat: f.inv(mid) as [number, number],
    textAngleDeg: -angle,        // screen y is down → negate for MapLibre text-rotate
    distanceM,
    label: fmt(distanceM),
  }
}
