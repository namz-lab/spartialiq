// @vitest-environment happy-dom
// Dimension kernel (cadDimension.ts) + useCadDocument addDimension/associativity.
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import {
  computeDimension, offsetFromPoint, findVertexAt, resolveAnchor,
} from '../cadDimension'
import { useCadDocument } from '../useCadDocument'
import type { CadEntity } from '../cadModel'

const A: [number, number] = [29.8, -19.4]
const eastOf = (p: [number, number], m: number) =>
  turf.destination(p, m, 90, { units: 'meters' }).geometry.coordinates as [number, number]
const northOf = (p: [number, number], m: number) =>
  turf.destination(p, m, 0, { units: 'meters' }).geometry.coordinates as [number, number]

// ── computeDimension ────────────────────────────────────────────────────────────

describe('computeDimension', () => {
  it('aligned dimension measures the true span (~50 m)', () => {
    const B = eastOf(A, 50)
    const d = computeDimension(A, B, 10, 'aligned')!
    expect(d).toBeTruthy()
    expect(d.distanceM).toBeGreaterThan(49.5)
    expect(d.distanceM).toBeLessThan(50.5)
    expect(d.label).toMatch(/m$/)
  })

  it('emits 5 paths (2 witness + dim line + 2 ticks) and a label point', () => {
    const d = computeDimension(A, eastOf(A, 30), 8, 'aligned')!
    expect(d.paths).toHaveLength(5)
    expect(d.paths.every(p => p.length >= 2)).toBe(true)
    expect(Number.isFinite(d.textLngLat[0])).toBe(true)
    expect(Number.isFinite(d.textLngLat[1])).toBe(true)
  })

  it('offset pushes the dimension line ~off metres off the span', () => {
    const B = eastOf(A, 40)
    const d = computeDimension(A, B, 12, 'aligned')!
    const dimLine = d.paths[2]   // [A2, B2]
    const perp = turf.pointToLineDistance(turf.point(dimLine[0]), turf.lineString([A, B]) as any, { units: 'meters' })
    expect(perp).toBeGreaterThan(10)
    expect(perp).toBeLessThan(14)
  })

  it('horizontal mode measures the east-west component only', () => {
    // a point 50 m east + 50 m north → horizontal span ≈ 50 m
    const B = northOf(eastOf(A, 50), 50)
    const d = computeDimension(A, B, 10, 'horizontal')!
    expect(d.distanceM).toBeGreaterThan(48)
    expect(d.distanceM).toBeLessThan(52)
  })

  it('returns null for a zero-length span', () => {
    expect(computeDimension(A, A, 5, 'aligned')).toBeNull()
  })
})

// ── offsetFromPoint ──────────────────────────────────────────────────────────────

describe('offsetFromPoint', () => {
  it('returns a signed perpendicular distance ~ the offset of the third point', () => {
    const B = eastOf(A, 60)
    const north = northOf(A, 15)   // 15 m to one side of the A→B (eastward) span
    const off = offsetFromPoint(A, B, north)
    expect(Math.abs(off)).toBeGreaterThan(13)
    expect(Math.abs(off)).toBeLessThan(17)
  })

  it('flips sign for the opposite side', () => {
    const B = eastOf(A, 60)
    const a = offsetFromPoint(A, B, northOf(A, 15))
    const b = offsetFromPoint(A, B, northOf(A, -15))
    expect(Math.sign(a)).toBe(-Math.sign(b))
  })
})

// ── findVertexAt / resolveAnchor ─────────────────────────────────────────────────

describe('findVertexAt + resolveAnchor', () => {
  const ents: CadEntity[] = [
    { id: 'l1', type: 'line', layerId: 'roads', geom: { type: 'LineString', coordinates: [A, eastOf(A, 50)] } },
  ]

  it('snaps to a nearby vertex and returns its grip path', () => {
    const near = eastOf(A, 1)   // 1 m from vertex A
    const hit = findVertexAt(ents, near, 3)
    expect(hit).toBeTruthy()
    expect(hit!.entityId).toBe('l1')
    expect(hit!.gripPath).toEqual([0])
  })

  it('returns null when no vertex is within tolerance', () => {
    expect(findVertexAt(ents, eastOf(A, 25), 3)).toBeNull()
  })

  it('skips dimension and text entities', () => {
    const withText: CadEntity[] = [
      ...ents,
      { id: 't1', type: 'text', layerId: 'annotation', geom: { type: 'Point', coordinates: eastOf(A, 1) }, text: 'hi' },
    ]
    const hit = findVertexAt(withText, eastOf(A, 1), 3)
    expect(hit!.entityId).toBe('l1')   // text ignored, line vertex chosen
  })

  it('resolveAnchor follows the live vertex when the entity moves', () => {
    const moved: CadEntity[] = [
      { id: 'l1', type: 'line', layerId: 'roads', geom: { type: 'LineString', coordinates: [eastOf(A, 5), eastOf(A, 55)] } },
    ]
    const p = resolveAnchor({ entityId: 'l1', gripPath: [0], lngLat: A }, moved)!
    // should return the MOVED vertex, not the stale fallback A
    expect(turf.distance(p, eastOf(A, 5), { units: 'meters' })).toBeLessThan(0.5)
    expect(turf.distance(p, A, { units: 'meters' })).toBeGreaterThan(4)
  })

  it('resolveAnchor falls back to lngLat for a fixed anchor', () => {
    const p = resolveAnchor({ lngLat: A }, [])
    expect(p).toEqual(A)
  })
})

// ── useCadDocument: addDimension + associativity ─────────────────────────────────

describe('useCadDocument dimensions', () => {
  it('addDimension creates a dimension entity excluded from toGeoJSON', () => {
    const d = useCadDocument()
    const line = d.addEntity('line', { type: 'LineString', coordinates: [A, eastOf(A, 50)] })
    const dim = d.addDimension(
      { entityId: line.id, gripPath: [0], lngLat: A },
      { entityId: line.id, gripPath: [1], lngLat: eastOf(A, 50) },
      10, 'aligned',
    )
    expect(dim).toBeTruthy()
    expect(dim!.type).toBe('dimension')
    // the dimension is NOT a normal cad feature (renders via dimensionsGeoJSON)
    const cadIds = (d.toGeoJSON.value.features as any[]).map(f => f.properties.id)
    expect(cadIds).not.toContain(dim!.id)
    // but it DOES produce dimension features (lines + label)
    expect(d.dimensionsGeoJSON.value.features.length).toBeGreaterThan(0)
  })

  it('is associative: stretching the anchored vertex re-measures the dimension', () => {
    const d = useCadDocument()
    const line = d.addEntity('line', { type: 'LineString', coordinates: [A, eastOf(A, 50)] })
    d.addDimension(
      { entityId: line.id, gripPath: [0], lngLat: A },
      { entityId: line.id, gripPath: [1], lngLat: eastOf(A, 50) },
      10, 'aligned',
    )

    const labelBefore = (d.dimensionsGeoJSON.value.features as any[])
      .find(f => f.properties.dimLabel)?.properties.dimLabel as string

    // drag the far vertex out to ~80 m
    d.previewStretch(line.id, [1], eastOf(A, 80))

    const labelAfter = (d.dimensionsGeoJSON.value.features as any[])
      .find(f => f.properties.dimLabel)?.properties.dimLabel as string

    expect(labelBefore).not.toEqual(labelAfter)
    const after = parseFloat(labelAfter)
    expect(after).toBeGreaterThan(78)
    expect(after).toBeLessThan(82)
  })

  it('addDimension returns null when an anchor cannot resolve', () => {
    const d = useCadDocument()
    expect(d.addDimension({ entityId: 'ghost', gripPath: [0] }, { lngLat: A }, 5)).toBeNull()
  })
})
