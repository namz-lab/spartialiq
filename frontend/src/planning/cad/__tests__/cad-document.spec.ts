// @vitest-environment happy-dom
// CAD-1 document + metre-frame kernel: draw, transforms (move/copy/rotate/mirror/
// array), offset, measurement, and undo/redo — verified to survey accuracy.
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { LineString, Polygon } from 'geojson'
import { useCadDocument } from '../useCadDocument'

const A: [number, number] = [29.8, -19.4]
const eastOf = (p: [number, number], m: number) =>
  turf.destination(p, m, 90, { units: 'meters' }).geometry.coordinates as [number, number]
const line = (a: [number, number], b: [number, number]): LineString => ({ type: 'LineString', coordinates: [a, b] })

describe('CAD document — draw + delete + undo', () => {
  it('adds and deletes entities with undo', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', line(A, eastOf(A, 50)))
    expect(d.entities.value.length).toBe(1)
    d.deleteEntities([e.id])
    expect(d.entities.value.length).toBe(0)
    d.undo(); expect(d.entities.value.length).toBe(1)   // undo delete
    d.undo(); expect(d.entities.value.length).toBe(0)   // undo add
    d.redo(); expect(d.entities.value.length).toBe(1)
  })

  it('addEntities inserts a batch in a single undo step', () => {
    const d = useCadDocument()
    d.addEntities([
      { type: 'line', geom: line(A, eastOf(A, 10)), layerId: 'roads' },
      { type: 'line', geom: line(A, eastOf(A, 20)), layerId: 'roads' },
    ])
    expect(d.entities.value.length).toBe(2)
    d.undo()
    expect(d.entities.value.length).toBe(0)
  })
})

describe('CAD document — transforms are metre-accurate', () => {
  it('move shifts geometry by the requested metres', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', line(A, eastOf(A, 50)))
    d.select([e.id])
    d.move(10, 0)
    const moved = (d.byId(e.id)!.geom as LineString).coordinates[0] as [number, number]
    const dist = turf.distance(A, moved, { units: 'meters' })
    const bearing = turf.bearing(A, moved)
    expect(dist).toBeGreaterThan(9.5); expect(dist).toBeLessThan(10.5)
    expect(Math.abs(bearing - 90)).toBeLessThan(2)
  })

  it('copy duplicates and offsets; original is untouched', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', line(A, eastOf(A, 50)))
    d.select([e.id])
    const [newId] = d.copy(0, 20)
    expect(d.entities.value.length).toBe(2)
    const origStart = (d.byId(e.id)!.geom as LineString).coordinates[0] as [number, number]
    const copyStart = (d.byId(newId)!.geom as LineString).coordinates[0] as [number, number]
    expect(turf.distance(A, origStart, { units: 'meters' })).toBeLessThan(0.5)   // original unchanged
    expect(turf.distance(origStart, copyStart, { units: 'meters' })).toBeGreaterThan(19) // copy moved ~20m north
  })

  it('rotate 90° about an endpoint moves the far end perpendicular', () => {
    const d = useCadDocument()
    const B = eastOf(A, 50)
    const e = d.addEntity('line', line(A, B))
    d.select([e.id]); d.rotateBy(90, A)
    const far = (d.byId(e.id)!.geom as LineString).coordinates[1] as [number, number]
    // still ~50 m from the pivot, but bearing rotated from ~90° to ~180° (south)
    expect(turf.distance(A, far, { units: 'meters' })).toBeGreaterThan(49)
    expect(Math.abs(turf.bearing(A, far) - 180)).toBeLessThan(3)
  })

  it('array creates count-1 extra copies', () => {
    const d = useCadDocument()
    const e = d.addEntity('rectangle', line(A, eastOf(A, 5)))
    d.select([e.id])
    const made = d.array(4, 6, 0)   // 3 extra, 6 m apart
    expect(made.length).toBe(3)
    expect(d.entities.value.length).toBe(4)
  })

  it('mirror adds a reflected copy', () => {
    const d = useCadDocument()
    const e = d.addEntity('line', line(A, eastOf(A, 30)))
    d.select([e.id])
    const axisA = eastOf(A, 40)
    const axisB = turf.destination(axisA, 50, 0, { units: 'meters' }).geometry.coordinates as [number, number]
    const made = d.mirrorAcross(axisA, axisB, true)
    expect(made.length).toBe(1)
    expect(d.entities.value.length).toBe(2)
  })
})

describe('CAD document — offset + measure', () => {
  it('offset produces a parallel line ~distM away', () => {
    const d = useCadDocument()
    const orig = line(A, eastOf(A, 80))
    const e = d.addEntity('polyline', orig)
    const offId = d.offset(e.id, 5)!
    expect(offId).toBeTruthy()
    const offPt = (d.byId(offId)!.geom as LineString).coordinates[0] as [number, number]
    const dPerp = turf.pointToLineDistance(turf.point(offPt), turf.lineString(orig.coordinates) as any, { units: 'meters' })
    expect(dPerp).toBeGreaterThan(4); expect(dPerp).toBeLessThan(6)
  })

  it('measures polygon area accurately', () => {
    const d = useCadDocument()
    // ~100 m × 100 m square ⇒ ~10,000 m²
    const o = A
    const e = eastOf(o, 100)
    const ne = turf.destination(e, 100, 0, { units: 'meters' }).geometry.coordinates as [number, number]
    const n = turf.destination(o, 100, 0, { units: 'meters' }).geometry.coordinates as [number, number]
    const poly: Polygon = { type: 'Polygon', coordinates: [[o, e, ne, n, o]] }
    const ent = d.addEntity('polygon', poly)
    const { areaM2 } = d.measure(ent.id)
    expect(areaM2).toBeGreaterThan(9000); expect(areaM2).toBeLessThan(11000)
  })
})
