// src/planning/cad/cadGrips.ts
// ─────────────────────────────────────────────────────────────────────────
// Grips/Stretch geometry kernel (CAD-2). Computes grip handles (vertex squares)
// for a selected entity and applies a stretch (move-one-vertex) to any geometry.
// All math is lng/lat only — no metre frame needed since we are just replacing
// a coordinate value.  The metre-frame round-trip is intentionally omitted here
// to keep dragging perfectly snappy; the surrounding layer already stores WGS84.
// ─────────────────────────────────────────────────────────────────────────
import type { Geometry, Position } from 'geojson'
import type { CadEntity } from './cadModel'

// ── Grip descriptor ───────────────────────────────────────────────────────────

/**
 * A single grip handle on a CAD entity.
 *
 * `gripPath` addresses the coordinate inside the geometry:
 *   Point                → []
 *   LineString           → [vertexIdx]
 *   Polygon              → [ringIdx, vertexIdx]   (vertexIdx < ring.length−1)
 *   MultiLineString      → [lineIdx, vertexIdx]
 *   MultiPolygon         → [polygonIdx, ringIdx, vertexIdx]
 */
export interface CadGrip {
  entityId: string
  /** Stable index into the grips[] array so MapLibre features can reference it. */
  gripIdx: number
  gripPath: number[]
  lngLat: [number, number]
}

// ── getGrips ──────────────────────────────────────────────────────────────────

/** Return all vertex grips for an entity. Closed-ring duplicates are skipped. */
export function getGrips(entity: CadEntity): CadGrip[] {
  const grips: CadGrip[] = []
  let n = 0
  const push = (path: number[], lngLat: [number, number]) =>
    grips.push({ entityId: entity.id, gripIdx: n++, gripPath: path, lngLat })

  const geom = entity.geom
  switch (geom.type) {
    case 'Point':
      push([], geom.coordinates as [number, number])
      break

    case 'LineString':
      geom.coordinates.forEach((c, i) => push([i], c as [number, number]))
      break

    case 'Polygon':
      geom.coordinates.forEach((ring, ri) => {
        // ring.length − 1 to skip the closing duplicate
        for (let vi = 0; vi < ring.length - 1; vi++) push([ri, vi], ring[vi] as [number, number])
      })
      break

    case 'MultiLineString':
      geom.coordinates.forEach((line, li) =>
        line.forEach((c, vi) => push([li, vi], c as [number, number])))
      break

    case 'MultiPolygon':
      geom.coordinates.forEach((poly, pi) =>
        poly.forEach((ring, ri) => {
          for (let vi = 0; vi < ring.length - 1; vi++) push([pi, ri, vi], ring[vi] as [number, number])
        }))
      break

    // text / dimension / hatch — expose the insertion point only
    default: {
      const coords = (geom as any).coordinates
      if (coords && !Array.isArray(coords[0])) push([], coords as [number, number])
      break
    }
  }
  return grips
}

// ── stretchGeom ───────────────────────────────────────────────────────────────

/** Read the coordinate addressed by `gripPath` (the read-counterpart of stretchGeom). */
export function coordAt(geom: Geometry, gripPath: number[]): [number, number] | null {
  const c: any = (geom as any).coordinates
  if (!c) return null
  switch (geom.type) {
    case 'Point':
      return c as [number, number]
    case 'LineString':
      return (c[gripPath[0]] as [number, number]) ?? null
    case 'Polygon':
      return (c[gripPath[0]]?.[gripPath[1]] as [number, number]) ?? null
    case 'MultiLineString':
      return (c[gripPath[0]]?.[gripPath[1]] as [number, number]) ?? null
    case 'MultiPolygon':
      return (c[gripPath[0]]?.[gripPath[1]]?.[gripPath[2]] as [number, number]) ?? null
    default:
      return !Array.isArray(c[0]) ? (c as [number, number]) : null
  }
}

/** Return a copy of `geom` with the vertex at `gripPath` moved to `newLngLat`. */
export function stretchGeom(geom: Geometry, gripPath: number[], newLngLat: Position): Geometry {
  const g: any = JSON.parse(JSON.stringify(geom))

  switch (g.type) {
    case 'Point':
      g.coordinates = newLngLat
      break

    case 'LineString': {
      const [vi] = gripPath
      g.coordinates[vi] = newLngLat
      break
    }

    case 'Polygon': {
      const [ri, vi] = gripPath
      const ring: Position[] = g.coordinates[ri]
      ring[vi] = newLngLat
      // keep ring closed: vertex 0 is duplicated as the last coordinate
      if (vi === 0) ring[ring.length - 1] = newLngLat
      break
    }

    case 'MultiLineString': {
      const [li, vi] = gripPath
      g.coordinates[li][vi] = newLngLat
      break
    }

    case 'MultiPolygon': {
      const [pi, ri, vi] = gripPath
      const ring: Position[] = g.coordinates[pi][ri]
      ring[vi] = newLngLat
      if (vi === 0) ring[ring.length - 1] = newLngLat
      break
    }
  }

  return g as Geometry
}
