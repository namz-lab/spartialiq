// src/planning/cad/cadGeometry2.ts
// ─────────────────────────────────────────────────────────────────────────
// CAD-2 geometry editing ops: polygon offset/setback (JSTS buffer), trim, extend,
// chamfer, fillet. All metric work runs in the local metre frame (cadGeometry.ts)
// so results are survey-accurate. JSTS is used only where it clearly beats turf
// (robust polygon offset with join styles + boolean robustness).
// ─────────────────────────────────────────────────────────────────────────
// jsts has no package entry point; import the ESM class modules directly. The
// modular build doesn't attach Geometry.prototype.buffer, so use BufferOp.bufferOp.
// @ts-ignore — no bundled types for the deep module path
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
// @ts-ignore
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
// @ts-ignore
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Geometry, Position } from 'geojson'
import { frameForGeom, mapCoords, type MetreFrame } from './cadGeometry'

// ── JSTS polygon offset / setback ────────────────────────────────────────────
/** Offset a polygon by `distM` metres (negative = inward setback). JSTS buffer. */
export function polygonOffset(geom: Geometry, distM: number): Geometry | null {
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return null
  const f = frameForGeom(geom)
  const inM = mapCoords(geom, f.fwd)
  try {
    const reader = new (GeoJSONReader as any)()
    const writer = new (GeoJSONWriter as any)()
    const jg = reader.read(inM as any)
    const buffered = (BufferOp as any).bufferOp(jg, distM)
    if (!buffered || buffered.isEmpty()) return null
    const outM = writer.write(buffered) as Geometry
    return mapCoords(outM, f.inv)
  } catch { return null }
}

// ── trim (turf split, drop the picked piece) ─────────────────────────────────
/** Trim a line by a cutter (line/polygon): split, then drop the piece nearest
 *  `removeLngLat`. Returns the remaining geometry (LineString or MultiLineString). */
export function trimLine(line: Geometry, cutter: Geometry, removeLngLat: Position): Geometry | null {
  if (line.type !== 'LineString') return null
  let pieces: any
  try { pieces = turf.lineSplit(turf.feature(line as any) as any, turf.feature(cutter as any) as any) } catch { return null }
  const feats = pieces?.features || []
  if (feats.length < 2) return null   // no real intersection → nothing to trim
  const pt = turf.point(removeLngLat)
  let worstIdx = -1, worstD = Infinity
  feats.forEach((fpiece: any, i: number) => {
    let d: number
    try { d = turf.pointToLineDistance(pt, fpiece, { units: 'meters' }) } catch { d = Infinity }
    if (d < worstD) { worstD = d; worstIdx = i }
  })
  const kept = feats.filter((_: any, i: number) => i !== worstIdx).map((fp: any) => fp.geometry.coordinates)
  if (!kept.length) return null
  return kept.length === 1
    ? { type: 'LineString', coordinates: kept[0] }
    : { type: 'MultiLineString', coordinates: kept }
}

// ── extend (ray from a line end to the nearest hit on a target) ──────────────
function segmentsOf(geom: Geometry, f: MetreFrame): Position[][] {
  const segs: Position[][] = []
  const push = (ring: Position[]) => { for (let i = 0; i < ring.length - 1; i++) segs.push([f.fwd(ring[i]), f.fwd(ring[i + 1])]) }
  if (geom.type === 'LineString') push(geom.coordinates)
  else if (geom.type === 'Polygon') geom.coordinates.forEach(push)
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(push)
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(push))
  return segs
}
/** Intersection of ray (origin + t·dir, t>0) with segment a–b; null if none. */
function raySeg(o: Position, d: Position, a: Position, b: Position): { t: number; pt: Position } | null {
  const e = [b[0] - a[0], b[1] - a[1]]
  const denom = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(denom) < 1e-9) return null
  const ox = a[0] - o[0], oy = a[1] - o[1]
  const t = (ox * e[1] - oy * e[0]) / denom
  const u = (ox * d[1] - oy * d[0]) / denom
  if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return { t, pt: [o[0] + t * d[0], o[1] + t * d[1]] }
  return null
}
/** Extend a line's `end` ('start'|'end') to the nearest forward hit on `target`. */
export function extendLine(line: Geometry, target: Geometry, end: 'start' | 'end'): Geometry | null {
  if (line.type !== 'LineString' || line.coordinates.length < 2) return null
  const f = frameForGeom(line)
  const pts = line.coordinates.map(f.fwd)
  const tipIdx = end === 'start' ? 0 : pts.length - 1
  const adjIdx = end === 'start' ? 1 : pts.length - 2
  const tip = pts[tipIdx], adj = pts[adjIdx]
  const dir: Position = [tip[0] - adj[0], tip[1] - adj[1]]
  let best: Position | null = null, bestT = Infinity
  for (const [a, b] of segmentsOf(target, f)) {
    const hit = raySeg(tip, dir, a, b)
    if (hit && hit.t < bestT) { bestT = hit.t; best = hit.pt }
  }
  if (!best) return null
  const out = pts.map(f.inv)
  const hitLngLat = f.inv(best)
  if (end === 'start') out.unshift(hitLngLat); else out.push(hitLngLat)
  return { type: 'LineString', coordinates: out }
}

// ── chamfer / fillet a polyline (or polygon ring) vertex ─────────────────────
function ringOf(geom: Geometry): { ring: Position[]; closed: boolean } | null {
  if (geom.type === 'LineString') return { ring: geom.coordinates, closed: false }
  if (geom.type === 'Polygon') return { ring: geom.coordinates[0], closed: true }
  return null
}
const sub = (a: Position, b: Position): Position => [a[0] - b[0], a[1] - b[1]]
const add = (a: Position, b: Position): Position => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Position, k: number): Position => [a[0] * k, a[1] * k]
const len = (a: Position) => Math.hypot(a[0], a[1])
const unit = (a: Position): Position => { const l = len(a) || 1; return [a[0] / l, a[1] / l] }

/** Replace vertex `idx` with a straight chamfer of `distM` along each leg. */
export function chamferPolyline(geom: Geometry, idx: number, distM: number): Geometry | null {
  const r = ringOf(geom); if (!r) return null
  const f = frameForGeom(geom)
  const pts = r.ring.map(f.fwd)
  const n = pts.length
  if (idx <= 0 || idx >= n - 1) return null   // need both neighbours
  const v = pts[idx], p1 = pts[idx - 1], p2 = pts[idx + 1]
  const t1 = add(v, mul(unit(sub(p1, v)), distM))
  const t2 = add(v, mul(unit(sub(p2, v)), distM))
  const out = [...pts.slice(0, idx), t1, t2, ...pts.slice(idx + 1)]
  const back = out.map(f.inv)
  return r.closed ? { type: 'Polygon', coordinates: [back] } : { type: 'LineString', coordinates: back }
}

/** Replace vertex `idx` with a tangent fillet arc of radius `rM` (tessellated). */
export function filletPolyline(geom: Geometry, idx: number, rM: number, steps = 8): Geometry | null {
  const r = ringOf(geom); if (!r) return null
  const f = frameForGeom(geom)
  const pts = r.ring.map(f.fwd)
  const n = pts.length
  if (idx <= 0 || idx >= n - 1) return null
  const v = pts[idx], p1 = pts[idx - 1], p2 = pts[idx + 1]
  const u = unit(sub(p1, v)), w = unit(sub(p2, v))
  const dot = Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1]))
  const theta = Math.acos(dot)                       // angle at the corner
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null   // collinear
  const tan = Math.tan(theta / 2)
  const t = rM / tan                                  // distance from v to tangent points
  const maxT = Math.min(len(sub(p1, v)), len(sub(p2, v))) * 0.98
  const tt = Math.min(t, maxT)
  const rr = tt * tan
  const t1 = add(v, mul(u, tt)), t2 = add(v, mul(w, tt))
  const bis = unit(add(u, w))
  const center = add(v, mul(bis, rr / Math.sin(theta / 2)))
  const a1 = Math.atan2(t1[1] - center[1], t1[0] - center[0])
  const a2 = Math.atan2(t2[1] - center[1], t2[0] - center[0])
  let da = a2 - a1
  while (da > Math.PI) da -= 2 * Math.PI
  while (da < -Math.PI) da += 2 * Math.PI
  const arc: Position[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (da * i) / steps
    arc.push([center[0] + rr * Math.cos(a), center[1] + rr * Math.sin(a)])
  }
  const out = [...pts.slice(0, idx), ...arc, ...pts.slice(idx + 1)]
  const back = out.map(f.inv)
  return r.closed ? { type: 'Polygon', coordinates: [back] } : { type: 'LineString', coordinates: back }
}
