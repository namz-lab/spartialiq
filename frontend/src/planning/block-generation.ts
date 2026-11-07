// src/planning/block-generation.ts
// ─────────────────────────────────────────────────────────────────────────
// Derive blocks (developable faces) from a planning parcel + proposed street
// centre-lines + exclusion masks.
//
// Web-friendly approach (no planar-graph face extraction needed):
//   1. Turn each road centre-line into a reserve ribbon (buffer by width/2).
//   2. Union the ribbons + exclusion masks → "everything that is NOT a block".
//   3. difference(parcel, that) → the block faces; flatten to single polygons.
// This is robust, fast enough for interactive use, and good enough for a
// municipal first-pass layout. Phase 3 can swap in a true noding/face-graph.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import type { Block, RoadSegment, ConstraintLayer } from './planning-types'
import { unionAll } from './constraint-tools'

let seq = 0
const id = () => `blk-${Date.now().toString(36)}-${(seq++).toString(36)}`

export interface BlockGenOptions {
  /** drop faces smaller than this (m²) as slivers */
  minBlockAreaSqm?: number
  /** road reserve to assume when a segment lacks widthM */
  defaultRoadWidthM?: number
}

export function generateBlocks(
  parcel: Feature<Polygon | MultiPolygon>,
  roads: RoadSegment[],
  exclusions: ConstraintLayer[] = [],
  opts: BlockGenOptions = {},
): Block[] {
  const minArea = opts.minBlockAreaSqm ?? 150
  const dW = opts.defaultRoadWidthM ?? 12

  const cutters: Feature<Polygon | MultiPolygon>[] = []
  for (const r of roads) {
    // r.widthM is the road RESERVE width (set per-hierarchy from the zone
    // standards in usePlanningTools.addRoad); the ribbon is half the reserve,
    // so arterial/collector/local roads carve correspondingly wider/narrower
    // reserves out of the parcel — driving block (and hence lot) sizes.
    const half = Math.max((r.widthM || dW) / 2, 1)
    try {
      const ribbon = turf.buffer(turf.feature(r.geom) as any, half, { units: 'meters' })
      if (ribbon) cutters.push(ribbon as any)
    } catch { /* skip */ }
  }
  for (const c of exclusions.filter(e => !e.buildable)) cutters.push(turf.feature(c.geom) as any)

  let faces: Feature<Polygon>[]
  if (!cutters.length) {
    faces = flattenPolys(parcel)
  } else {
    const cut = unionAll(cutters)
    let diff: any = parcel
    try { diff = cut ? turf.difference(parcel as any, cut as any) : parcel } catch { diff = parcel }
    faces = diff ? flattenPolys(diff) : []
  }

  const blocks: Block[] = []
  for (const f of faces) {
    const areaSqm = turf.area(f)
    if (areaSqm < minArea) continue
    blocks.push({
      id: id(),
      geom: f.geometry,
      areaSqm: Math.round(areaSqm),
      roadIds: roadsTouching(f, roads, dW),
    })
  }
  return blocks
}

function roadsTouching(face: Feature<Polygon>, roads: RoadSegment[], dW: number): string[] {
  const out: string[] = []
  for (const r of roads) {
    try {
      const ribbon = turf.buffer(turf.feature(r.geom) as any, Math.max((r.widthM || dW) / 2 + 1, 2), { units: 'meters' })
      if (ribbon && turf.booleanIntersects(face as any, ribbon as any)) out.push(r.id)
    } catch { /* skip */ }
  }
  return out
}

/** Flatten any Polygon/MultiPolygon feature/geometry into single polygons. */
export function flattenPolys(f: any): Feature<Polygon>[] {
  const g = f?.geometry || f
  if (!g) return []
  if (g.type === 'Polygon') return [turf.polygon(g.coordinates)]
  if (g.type === 'MultiPolygon') return g.coordinates.map((c: any) => turf.polygon(c))
  return []
}
