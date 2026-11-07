// src/planning/cad/cadJoin.ts
// ─────────────────────────────────────────────────────────────────────────
// Join + Explode geometry helpers (CAD-3). JOIN chains contiguous LineStrings
// (endpoints coincident within a metre tolerance) into merged polylines — the
// classic "fix a broken polyline". EXPLODE breaks a polyline/polygon into its
// individual 2-point segments. Endpoint matching runs in the local metre frame
// so the tolerance is true ground metres. Pure: no Vue, no turf.
// ─────────────────────────────────────────────────────────────────────────
import type { Geometry, LineString, Position } from 'geojson'
import { frameForGeom, type MetreFrame } from './cadGeometry'

const dist = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Chain contiguous LineStrings into merged polylines. Segments whose endpoints
 * coincide within `tolM` metres are joined (reversing as needed). Returns one
 * LineString per connected chain — fewer than the input when anything joined.
 */
export function joinLineStrings(lines: LineString[], tolM: number, frame?: MetreFrame): LineString[] {
  if (!lines.length) return []
  const f = frame ?? frameForGeom(lines[0])
  const segs = lines.map(l => ({ pts: l.coordinates.map(f.fwd), used: false }))
  const near = (a: Position, b: Position) => dist(a, b) <= tolM
  const out: Position[][] = []

  for (let i = 0; i < segs.length; i++) {
    if (segs[i].used) continue
    segs[i].used = true
    let chain = [...segs[i].pts]

    // extend the tail
    for (let grew = true; grew;) {
      grew = false
      const end = chain[chain.length - 1]
      for (let j = 0; j < segs.length; j++) {
        if (segs[j].used) continue
        const s = segs[j].pts
        if (near(end, s[0])) { chain = chain.concat(s.slice(1)); segs[j].used = true; grew = true; break }
        if (near(end, s[s.length - 1])) { chain = chain.concat([...s].reverse().slice(1)); segs[j].used = true; grew = true; break }
      }
    }
    // extend the head
    for (let grew = true; grew;) {
      grew = false
      const start = chain[0]
      for (let j = 0; j < segs.length; j++) {
        if (segs[j].used) continue
        const s = segs[j].pts
        if (near(start, s[s.length - 1])) { chain = s.slice(0, -1).concat(chain); segs[j].used = true; grew = true; break }
        if (near(start, s[0])) { chain = [...s].reverse().slice(0, -1).concat(chain); segs[j].used = true; grew = true; break }
      }
    }
    out.push(chain)
  }
  return out.map(c => ({ type: 'LineString', coordinates: c.map(f.inv) }))
}

/** Break a polyline/polygon into individual 2-point LineString segments. */
export function explodeToSegments(geom: Geometry): LineString[] {
  let rings: Position[][] = []
  if (geom.type === 'LineString') rings = [geom.coordinates]
  else if (geom.type === 'MultiLineString') rings = geom.coordinates
  else if (geom.type === 'Polygon') rings = geom.coordinates
  else if (geom.type === 'MultiPolygon') rings = (geom.coordinates as Position[][][]).flat()
  const segs: LineString[] = []
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) segs.push({ type: 'LineString', coordinates: [r[i], r[i + 1]] })
  return segs
}
