// @vitest-environment happy-dom
// Grips/Stretch kernel (cadGrips.ts) + useCadDocument previewStretch/pushUndo.
import { describe, it, expect } from 'vitest'
import type { LineString, Polygon, Point } from 'geojson'
import { getGrips, stretchGeom } from '../cadGrips'
import { useCadDocument } from '../useCadDocument'
import type { CadEntity } from '../cadModel'

// ── helpers ───────────────────────────────────────────────────────────────────

const A: [number, number] = [29.8, -19.4]
const B: [number, number] = [29.82, -19.4]
const C: [number, number] = [29.82, -19.42]
const D: [number, number] = [29.8, -19.42]

function lineEnt(a = A, b = B): CadEntity {
  return { id: 'l1', type: 'line', geom: { type: 'LineString', coordinates: [a, b] }, layerId: 'roads' }
}
function polyEnt(): CadEntity {
  return {
    id: 'p1', type: 'polygon', layerId: 'roads',
    geom: { type: 'Polygon', coordinates: [[A, B, C, D, A]] },
  }
}
function pointEnt(): CadEntity {
  return { id: 'pt1', type: 'text', geom: { type: 'Point', coordinates: A }, layerId: 'annotation' }
}

// ── getGrips ──────────────────────────────────────────────────────────────────

describe('getGrips', () => {
  it('LineString → 2 vertex grips with correct paths', () => {
    const g = getGrips(lineEnt())
    expect(g).toHaveLength(2)
    expect(g[0].gripPath).toEqual([0])
    expect(g[1].gripPath).toEqual([1])
    expect(g[0].lngLat).toEqual(A)
  })

  it('Polygon (4 unique verts) → 4 grips (closing dup skipped)', () => {
    const g = getGrips(polyEnt())
    expect(g).toHaveLength(4)
    expect(g[0].gripPath).toEqual([0, 0])
    expect(g[3].gripPath).toEqual([0, 3])
  })

  it('Point → 1 grip with empty path', () => {
    const g = getGrips(pointEnt())
    expect(g).toHaveLength(1)
    expect(g[0].gripPath).toEqual([])
    expect(g[0].lngLat).toEqual(A)
  })

  it('gripIdx values are sequential starting at 0', () => {
    const g = getGrips(lineEnt())
    expect(g.map(x => x.gripIdx)).toEqual([0, 1])
  })
})

// ── stretchGeom ───────────────────────────────────────────────────────────────

describe('stretchGeom', () => {
  const NEW: [number, number] = [29.85, -19.35]

  it('stretches a LineString start vertex', () => {
    const geom: LineString = { type: 'LineString', coordinates: [A, B] }
    const out = stretchGeom(geom, [0], NEW) as LineString
    expect(out.coordinates[0]).toEqual(NEW)
    expect(out.coordinates[1]).toEqual(B)
  })

  it('does not mutate the original geometry', () => {
    const geom: LineString = { type: 'LineString', coordinates: [A, B] }
    stretchGeom(geom, [0], NEW)
    expect(geom.coordinates[0]).toEqual(A)
  })

  it('stretches a Polygon vertex and updates the closing duplicate', () => {
    const geom: Polygon = { type: 'Polygon', coordinates: [[A, B, C, D, A]] }
    const out = stretchGeom(geom, [0, 0], NEW) as Polygon
    const ring = out.coordinates[0]
    expect(ring[0]).toEqual(NEW)
    expect(ring[ring.length - 1]).toEqual(NEW)
    expect(ring[1]).toEqual(B)
  })

  it('stretches a non-zero Polygon vertex without touching vertex 0', () => {
    const geom: Polygon = { type: 'Polygon', coordinates: [[A, B, C, D, A]] }
    const out = stretchGeom(geom, [0, 2], NEW) as Polygon
    const ring = out.coordinates[0]
    expect(ring[2]).toEqual(NEW)
    expect(ring[0]).toEqual(A)
    expect(ring[ring.length - 1]).toEqual(A)
  })

  it('stretches a Point', () => {
    const geom: Point = { type: 'Point', coordinates: A }
    const out = stretchGeom(geom, [], NEW) as Point
    expect(out.coordinates).toEqual(NEW)
  })
})

// ── useCadDocument: previewStretch + pushUndo ─────────────────────────────────

describe('useCadDocument grips integration', () => {
  it('previewStretch moves vertex without pushing to undo stack', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', { type: 'LineString', coordinates: [A, B] })
    // addEntity pushed 1 entry; previewStretch must not add another
    const stackDepth = (d as any).canUndo.value

    d.previewStretch(e.id, [0], [29.9, -19.5])

    const coord = (d.byId(e.id)!.geom as LineString).coordinates[0]
    expect(coord[0]).toBeCloseTo(29.9)
    // undo stack depth unchanged (still one entry from addEntity)
    expect((d as any).canUndo.value).toBe(stackDepth)
  })

  it('pushUndo + previewStretch + undo restores pre-drag geometry', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', { type: 'LineString', coordinates: [A, B] })

    d.pushUndo()                                  // checkpoint before drag
    d.previewStretch(e.id, [1], [29.99, -19.0])  // drag end vertex

    expect(((d.byId(e.id)!.geom as LineString).coordinates[1])[0]).toBeCloseTo(29.99)

    d.undo()  // jump back to pre-drag
    const restored = (d.byId(e.id)!.geom as LineString).coordinates[1] as [number, number]
    expect(restored[0]).toBeCloseTo(B[0])
    expect(restored[1]).toBeCloseTo(B[1])
  })

  it('previewStretch is a no-op for an unknown id', () => {
    const d = useCadDocument()
    expect(() => d.previewStretch('ghost', [0], [0, 0])).not.toThrow()
  })
})
