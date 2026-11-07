// @vitest-environment happy-dom
// CAD-2 geometry ops: JSTS polygon offset + trim/extend/chamfer/fillet, metre-accurate.
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { LineString, Polygon } from 'geojson'
import { polygonOffset, trimLine, extendLine, chamferPolyline, filletPolyline } from '../cadGeometry2'

const A: [number, number] = [29.8, -19.4]
const go = (p: [number, number], m: number, b: number) =>
  turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]

describe('polygonOffset (JSTS buffer)', () => {
  it('insets a 100×100 m square by 10 m → ~80×80 m', () => {
    const e = go(A, 100, 90), ne = go(e, 100, 0), n = go(A, 100, 0)
    const sq: Polygon = { type: 'Polygon', coordinates: [[A, e, ne, n, A]] }
    const inset = polygonOffset(sq, -10)
    expect(inset).toBeTruthy()
    const area = turf.area(turf.feature(inset as any) as any)
    expect(area).toBeGreaterThan(5500); expect(area).toBeLessThan(7200)  // ~6400
  })
})

describe('trimLine', () => {
  it('drops the picked side of a split line', () => {
    const line: LineString = { type: 'LineString', coordinates: [A, go(A, 100, 90)] }
    const mid = go(A, 50, 90)
    const cutter: LineString = { type: 'LineString', coordinates: [go(mid, 20, 180), go(mid, 20, 0)] }
    const removeEast = go(A, 80, 90)   // pick the east half to remove
    const res = trimLine(line, cutter, removeEast) as LineString
    expect(res).toBeTruthy()
    const remainingLen = turf.length(turf.feature(res as any) as any, { units: 'meters' })
    expect(remainingLen).toBeGreaterThan(40); expect(remainingLen).toBeLessThan(60)  // ~50 west half kept
  })
})

describe('extendLine', () => {
  it('extends an end to meet a target line', () => {
    const line: LineString = { type: 'LineString', coordinates: [A, go(A, 40, 90)] }   // ends at 40 m
    const at60 = go(A, 60, 90)
    const target: LineString = { type: 'LineString', coordinates: [go(at60, 30, 180), go(at60, 30, 0)] }
    const res = extendLine(line, target, 'end') as LineString
    expect(res).toBeTruthy()
    const newEnd = res.coordinates[res.coordinates.length - 1] as [number, number]
    expect(turf.distance(A, newEnd, { units: 'meters' })).toBeGreaterThan(58)  // reached ~60 m
  })
})

describe('chamfer + fillet a corner', () => {
  const L: LineString = { type: 'LineString', coordinates: [A, go(A, 50, 90), go(go(A, 50, 90), 50, 0)] }
  it('chamfer replaces the middle vertex with two points', () => {
    const res = chamferPolyline(L, 1, 10) as LineString
    expect(res).toBeTruthy()
    expect(res.coordinates.length).toBe(4)   // 3 → corner becomes 2 points
  })
  it('fillet replaces the middle vertex with an arc', () => {
    const res = filletPolyline(L, 1, 10, 6) as LineString
    expect(res).toBeTruthy()
    expect(res.coordinates.length).toBeGreaterThan(5)   // arc tessellation
  })
})
