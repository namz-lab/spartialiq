// src/planning/useStudioSnapping.ts
// ─────────────────────────────────────────────────────────────────────────
// Object + grid snapping for the Planning Studio. Snaps a click to the nearest
// candidate within a pixel threshold, in priority order:
//   1. an EXISTING VERTEX — planning-area boundary corners, proposed-road
//      vertices, drawn CAD entity vertices, in-progress points,
//   2. a SEGMENT MIDPOINT of any drawn CAD line/ring,
//   3. failing an object hit, the metre GRID (when grid snap is on).
// Vertex/endpoint always wins over midpoint, which always wins over grid, so
// "snap to my own line" behaves like a real CAD object-snap.
// ─────────────────────────────────────────────────────────────────────────
import type { PlanningToolsApi } from './usePlanningTools'
import { gridSnap } from './useStudioInput'

const SNAP_PX = 12

function ringCoords(geom: any): number[][] {
  if (!geom) return []
  if (geom.type === 'Polygon') return geom.coordinates.flat()
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat(2)
  if (geom.type === 'LineString') return geom.coordinates
  if (geom.type === 'MultiLineString') return geom.coordinates.flat()
  return []
}
/** Midpoints of each consecutive segment in a ring/line (for MIDpoint snap). */
function midpoints(coords: number[][]): number[][] {
  const out: number[][] = []
  for (let i = 1; i < coords.length; i++) {
    out.push([(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2])
  }
  return out
}

export interface SnapSources {
  /** Drawn CAD entities to snap to (vertices + segment midpoints). */
  getCadEntities?: () => Array<{ geom: any }>
  /** Parcel origin [lng,lat] for the metre grid. */
  getOrigin?: () => [number, number] | null
  /** Grid step in metres (0 disables). */
  getGridStepM?: () => number
  /** Whether grid snapping is currently enabled. */
  gridEnabled?: () => boolean
}

export function useStudioSnapping(getMap: () => any, planning: PlanningToolsApi, sources: SnapSources = {}) {
  /**
   * Return a snapped [lng,lat]. Vertex → midpoint → grid, in that priority.
   * `extra` are transient in-progress draft points (highest-value vertices).
   */
  function snap(lngLat: [number, number], screenPt: { x: number; y: number }, extra: number[][] = []): [number, number] {
    const map = getMap()
    if (!map) return lngLat

    // ── 1 + 2: object snap (vertices first, then midpoints) ──────────────────
    const vertices: number[][] = [...extra]
    const mids: number[][] = []
    const area = planning.planningArea.value
    if (area) vertices.push(...ringCoords(area.geom))
    for (const r of planning.roads.value) vertices.push(...ringCoords(r.geom))
    for (const e of sources.getCadEntities?.() ?? []) {
      const rc = ringCoords(e.geom)
      vertices.push(...rc)
      mids.push(...midpoints(rc))
    }

    const nearest = (cands: number[][]) => {
      let best: number[] | null = null
      let bestD = SNAP_PX
      for (const c of cands) {
        let p: { x: number; y: number }
        try { p = map.project(c as any) } catch { continue }
        const d = Math.hypot(p.x - screenPt.x, p.y - screenPt.y)
        if (d < bestD) { bestD = d; best = c }
      }
      return best
    }
    const v = nearest(vertices)
    if (v) return [v[0], v[1]]
    const mid = nearest(mids)
    if (mid) return [mid[0], mid[1]]

    // ── 3: grid snap fallback ────────────────────────────────────────────────
    if (sources.gridEnabled?.()) {
      const origin = sources.getOrigin?.()
      const step = sources.getGridStepM?.() ?? 0
      if (origin && step > 0) return gridSnap(lngLat, origin, step)
    }
    return lngLat
  }

  return { snap, SNAP_PX }
}
