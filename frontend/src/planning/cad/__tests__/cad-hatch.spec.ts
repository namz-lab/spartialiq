// @vitest-environment happy-dom
// Hatch generator (cadHatch.generateHatch) + useCadDocument.addHatch.
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Polygon } from 'geojson'
import { generateHatch } from '../cadHatch'
import { useCadDocument } from '../useCadDocument'
import type { HatchSpec } from '../cadModel'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) =>
  turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
/** An axis-aligned square polygon of `sizeM`, SW corner at O. */
function square(sizeM: number): Polygon {
  const o = O, e = move(o, sizeM, 90), ne = move(e, sizeM, 0), n = move(o, sizeM, 0)
  return turf.polygon([[o, e, ne, n, o]]).geometry as Polygon
}
const spec = (over: Partial<HatchSpec> = {}): HatchSpec =>
  ({ pattern: 'lines', angleDeg: 0, spacingM: 10, color: '#65a30d', ...over })

describe('generateHatch', () => {
  it('solid → no lines and no dots (the boundary fill is drawn separately)', () => {
    const h = generateHatch(square(100), spec({ pattern: 'solid' }))
    expect(h.lines).toHaveLength(0)
    expect(h.dots).toHaveLength(0)
  })

  it('lines → ~1 scanline per spacing, each clipped inside the boundary', () => {
    const poly = square(100)
    const h = generateHatch(poly, spec({ pattern: 'lines', angleDeg: 0, spacingM: 10 }))
    expect(h.lines.length).toBeGreaterThan(7)
    expect(h.lines.length).toBeLessThan(12)
    // every segment midpoint lies inside the polygon (clipping worked)
    for (const seg of h.lines) {
      const mid: [number, number] = [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2]
      expect(turf.booleanPointInPolygon(mid, poly as any)).toBe(true)
    }
  })

  it('cross → roughly twice as many lines as a single direction', () => {
    const poly = square(100)
    const one = generateHatch(poly, spec({ pattern: 'lines', spacingM: 10 })).lines.length
    const two = generateHatch(poly, spec({ pattern: 'cross', spacingM: 10 })).lines.length
    expect(two).toBeGreaterThan(one * 1.6)
  })

  it('dots → a grid of points, all inside the boundary', () => {
    const poly = square(100)
    const h = generateHatch(poly, spec({ pattern: 'dots', spacingM: 20 }))
    expect(h.dots.length).toBeGreaterThan(4)
    for (const d of h.dots) expect(turf.booleanPointInPolygon(d, poly as any)).toBe(true)
  })

  it('tighter spacing yields more scanlines (scale-true)', () => {
    const poly = square(100)
    const coarse = generateHatch(poly, spec({ spacingM: 20 })).lines.length
    const fine = generateHatch(poly, spec({ spacingM: 5 })).lines.length
    expect(fine).toBeGreaterThan(coarse)
  })
})

describe('useCadDocument.addHatch', () => {
  it('creates a hatch entity + overlay features, excluded from toGeoJSON', () => {
    const d = useCadDocument()
    const e = d.addHatch(square(80), spec({ pattern: 'lines', landuse: 'agriculture' }))!
    expect(e.type).toBe('hatch')
    expect(e.hatch!.pattern).toBe('lines')
    expect((d.toGeoJSON.value.features as any[]).some(f => f.properties.id === e.id)).toBe(false)
    const feats = (d.hatchGeoJSON.value.features as any[]).filter(f => f.properties.id === e.id)
    expect(feats.some(f => f.properties.role === 'fill')).toBe(true)
    expect(feats.some(f => f.properties.role === 'line')).toBe(true)
  })

  it('solid hatch emits only a strong fill (no pattern features)', () => {
    const d = useCadDocument()
    const e = d.addHatch(square(80), spec({ pattern: 'solid' }))!
    const feats = (d.hatchGeoJSON.value.features as any[]).filter(f => f.properties.id === e.id)
    expect(feats).toHaveLength(1)
    expect(feats[0].properties.role).toBe('fill')
    expect(feats[0].properties.fillOpacity).toBeGreaterThan(0.3)
  })

  it('rejects a non-polygon geometry', () => {
    const d = useCadDocument()
    expect(d.addHatch({ type: 'LineString', coordinates: [O, move(O, 10, 90)] } as any, spec())).toBeNull()
    expect(d.entities.value).toHaveLength(0)
  })
})
