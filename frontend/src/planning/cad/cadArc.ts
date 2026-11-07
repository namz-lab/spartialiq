// src/planning/cad/cadArc.ts
// ─────────────────────────────────────────────────────────────────────────
// 3-point circular arc for the Planning Studio. Given start / through / end in
// lng/lat, fit the unique circle through them (in a local UTM metre frame so it
// is survey-true, not degree-warped) and densify the arc into a LineString that
// passes through the "through" point. Returned as a LineString so cadRender, the
// PDF drawCad, dimensions and designate('road') all handle it with no new code.
// If the three points are collinear (no circle) it degrades to a 3-point polyline.
// ─────────────────────────────────────────────────────────────────────────
import type { LineString } from 'geojson'
import { frameFor } from './cadGeometry'

/** Circumcircle centre of a triangle in planar metres, or null if collinear. */
function circumcentre(
  a: [number, number], b: [number, number], c: [number, number],
): { cx: number; cy: number; r: number } | null {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1]
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return null   // collinear
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) }
}

/**
 * Arc through start → through → end. `steps` is the max densification (segments);
 * the actual count scales with the swept angle so short arcs stay light. Returns
 * a LineString in lng/lat, or a straight polyline through the 3 points if they are
 * collinear or the frame math fails.
 */
export function arcThrough(
  start: [number, number], through: [number, number], end: [number, number], steps = 48,
): LineString {
  const fallback: LineString = { type: 'LineString', coordinates: [start, through, end] }
  try {
    const f = frameFor(start[0], start[1])
    const A = f.fwd(start) as [number, number]
    const B = f.fwd(through) as [number, number]
    const C = f.fwd(end) as [number, number]
    const cc = circumcentre(A, B, C)
    if (!cc) return fallback

    const ang = (p: [number, number]) => Math.atan2(p[1] - cc.cy, p[0] - cc.cx)
    const a0 = ang(A), aT = ang(B), a1 = ang(C)
    const TAU = Math.PI * 2
    // Choose the sweep A→C that passes through B. Normalise offsets to [0, TAU).
    const norm = (x: number) => ((x % TAU) + TAU) % TAU
    let sweep = norm(a1 - a0)
    const sweepT = norm(aT - a0)
    // If the "through" point isn't on the short A→C sweep, go the other way.
    if (sweepT > sweep) { sweep = sweep - TAU }   // negative sweep (clockwise)

    const n = Math.max(2, Math.min(steps, Math.round((Math.abs(sweep) / TAU) * steps) + 2))
    const coords: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n
      const x = cc.cx + cc.r * Math.cos(t)
      const y = cc.cy + cc.r * Math.sin(t)
      coords.push(f.inv([x, y]) as [number, number])
    }
    // Pin exact endpoints (guard against float drift at the seams).
    coords[0] = start; coords[coords.length - 1] = end
    return { type: 'LineString', coordinates: coords }
  } catch {
    return fallback
  }
}
