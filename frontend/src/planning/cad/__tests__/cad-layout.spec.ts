// @vitest-environment happy-dom
// Paper-space layout engine (cadLayout.ts): paper sizes, engineering scales,
// metric bounds, fit-to-frame, and the SCALE-TRUE projector (1:S → 1000/S mm/m).
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import {
  paperDims, niceScale, fitScale, boundsMetres, makeProjector,
  metresToMm, scaleBarMetres, ENGINEERING_SCALES,
} from '../cadLayout'
import { buildLayoutPdf } from '../cadLayoutPdf'
import { expandSymbol } from '../cadSymbols'

const A: [number, number] = [29.8, -19.4]
const eastOf = (p: [number, number], m: number) =>
  turf.destination(p, m, 90, { units: 'meters' }).geometry.coordinates as [number, number]
const northOf = (p: [number, number], m: number) =>
  turf.destination(p, m, 0, { units: 'meters' }).geometry.coordinates as [number, number]
const pt = (c: [number, number]) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: {} })

describe('paperDims', () => {
  it('A4 portrait is 210×297; landscape swaps', () => {
    expect(paperDims('A4', 'portrait')).toEqual({ w: 210, h: 297 })
    expect(paperDims('A4', 'landscape')).toEqual({ w: 297, h: 210 })
  })
  it('A0 is 841×1189', () => {
    expect(paperDims('A0', 'portrait')).toEqual({ w: 841, h: 1189 })
  })
})

describe('niceScale', () => {
  it('rounds out to the next engineering scale', () => {
    expect(niceScale(1)).toBe(100)
    expect(niceScale(555)).toBe(1000)   // 500 too small → 1000
    expect(niceScale(1000)).toBe(1000)
    expect(niceScale(2001)).toBe(2500)
  })
  it('only returns known engineering scales', () => {
    expect(ENGINEERING_SCALES).toContain(niceScale(700))
  })
})

describe('fitScale', () => {
  it('80 m of content in a 180 mm frame fits at 1:500', () => {
    // 80 m × 1000 / 180 mm ≈ 444 → next nice scale 500
    expect(fitScale(80, 80, 180, 180)).toBe(500)
  })
  it('the tighter dimension drives the scale', () => {
    // wide but short: 300 m wide in 180 mm → 1666 → 2000
    expect(fitScale(300, 20, 180, 260)).toBe(2000)
  })
})

describe('boundsMetres', () => {
  it('measures a 100 m square as ~100 × 100 m', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [pt(A), pt(eastOf(A, 100)), pt(northOf(A, 100)), pt(northOf(eastOf(A, 100), 100))],
    }
    const { bounds } = boundsMetres(fc)
    // ~100 m each way (a few cm of UTM grid-vs-true-north convergence inflates
    // the axis-aligned bbox of a true-north square slightly — well under 2%).
    expect(bounds.widthM).toBeGreaterThan(98)
    expect(bounds.widthM).toBeLessThan(103)
    expect(bounds.heightM).toBeGreaterThan(98)
    expect(bounds.heightM).toBeLessThan(103)
  })
})

describe('makeProjector — scale-true', () => {
  it('100 m east plots exactly 100 mm apart at 1:1000', () => {
    const fc: FeatureCollection = { type: 'FeatureCollection', features: [pt(A), pt(eastOf(A, 100))] }
    const { bounds, frame } = boundsMetres(fc)
    const project = makeProjector(frame, bounds.centerM, 1000, { x: 0, y: 0, w: 200, h: 200 })
    const pa = project(A), pb = project(eastOf(A, 100))
    expect(Math.abs(pb[0] - pa[0])).toBeGreaterThan(99)
    expect(Math.abs(pb[0] - pa[0])).toBeLessThan(101)
  })

  it('north is up — a northward point has a smaller paper y', () => {
    const fc: FeatureCollection = { type: 'FeatureCollection', features: [pt(A), pt(northOf(A, 100))] }
    const { bounds, frame } = boundsMetres(fc)
    const project = makeProjector(frame, bounds.centerM, 1000, { x: 0, y: 0, w: 200, h: 200 })
    const pa = project(A), pn = project(northOf(A, 100))
    expect(pn[1]).toBeLessThan(pa[1])
  })

  it('halving the scale doubles the paper distance', () => {
    const fc: FeatureCollection = { type: 'FeatureCollection', features: [pt(A), pt(eastOf(A, 100))] }
    const { bounds, frame } = boundsMetres(fc)
    const p1000 = makeProjector(frame, bounds.centerM, 1000, { x: 0, y: 0, w: 400, h: 400 })
    const p500 = makeProjector(frame, bounds.centerM, 500, { x: 0, y: 0, w: 400, h: 400 })
    const d1000 = Math.abs(p1000(eastOf(A, 100))[0] - p1000(A)[0])
    const d500 = Math.abs(p500(eastOf(A, 100))[0] - p500(A)[0])
    expect(d500 / d1000).toBeGreaterThan(1.9)
    expect(d500 / d1000).toBeLessThan(2.1)
  })
})

describe('buildLayoutPdf — renderer smoke test', () => {
  // a tiny but representative scene: parcel, a road (with width), a lot (with use),
  // a CAD line, and a dimension feature. Exercises every drawing path.
  const ring = (sizeM: number) => {
    const o = A, e = eastOf(A, sizeM), ne = northOf(e, sizeM), n = northOf(A, sizeM)
    return [o, e, ne, n, o]
  }
  const fc = (features: any[]): FeatureCollection => ({ type: 'FeatureCollection', features })

  it('renders an A3 sheet without throwing and picks a positive scale', () => {
    const { pdf, scale } = buildLayoutPdf({
      paper: 'A3', orientation: 'landscape', scale: 'fit',
      title: 'Test layout', drawingNumber: 'VRDC-TEST-1', planner: 'QA',
      planningArea: fc([{ type: 'Feature', properties: { name: 'Parcel' }, geometry: { type: 'Polygon', coordinates: [ring(300)] } }]),
      roads: fc([{ type: 'Feature', properties: { widthM: 12, hierarchy: 'local' }, geometry: { type: 'LineString', coordinates: [A, eastOf(A, 300)] } }]),
      lots: fc([{ type: 'Feature', properties: { lotNumber: '1', useType: 'school' }, geometry: { type: 'Polygon', coordinates: [ring(60)] } }]),
      openSpace: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(40)] } }]),
      cad: fc([
        { type: 'Feature', properties: { color: '#1a73e8' }, geometry: { type: 'LineString', coordinates: [A, northOf(A, 120)] } },
        { type: 'Feature', properties: { type: 'text', text: 'Proposed access' }, geometry: { type: 'Point', coordinates: northOf(A, 130) } },
      ]),
      symbols: fc(expandSymbol({ symbolId: 'north_arrow', sizeM: 14, rotationDeg: 0 }, eastOf(A, 280))
        .map(p => ({ type: 'Feature', properties: { role: p.role, text: p.text || '', color: '#1f2933' }, geometry: p.geom }))),
      hatch: fc([
        { type: 'Feature', properties: { role: 'fill', color: '#65a30d', fillOpacity: 0.08 }, geometry: { type: 'Polygon', coordinates: [ring(90)] } },
        { type: 'Feature', properties: { role: 'line', color: '#65a30d' }, geometry: { type: 'LineString', coordinates: [A, eastOf(A, 90)] } },
        { type: 'Feature', properties: { role: 'dot', color: '#65a30d' }, geometry: { type: 'Point', coordinates: eastOf(A, 45) } },
      ]),
      dimensions: fc([{ type: 'Feature', properties: { dim: true }, geometry: { type: 'LineString', coordinates: [A, eastOf(A, 50)] } }]),
    })
    expect(scale).toBeGreaterThan(0)
    expect(pdf.getNumberOfPages()).toBe(1)
  })

  it('honours an explicit scale and an empty scene', () => {
    const { scale } = buildLayoutPdf({ paper: 'A4', orientation: 'portrait', scale: 2500, title: 'Empty' })
    expect(scale).toBe(2500)
  })

  it('showSchedule appends stand-schedule page(s); many stands paginate', () => {
    const lots = Array.from({ length: 80 }, (_, i) => ({
      type: 'Feature' as const,
      properties: { lotNumber: String(i + 1), useType: 'single_residential', areaSqm: 400 + i, frontageM: 20 },
      geometry: { type: 'Polygon' as const, coordinates: [ring(20)] },
    }))
    const { pdf } = buildLayoutPdf({
      paper: 'A4', orientation: 'portrait', scale: 'fit', title: 'Sched', showSchedule: true,
      planningArea: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(300)] } }]),
      lots: fc(lots),
    })
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1)   // sheet + ≥1 schedule page
  })
})

describe('metresToMm + scaleBarMetres', () => {
  it('a 12 m reserve is 12 mm at 1:1000', () => {
    expect(metresToMm(12, 1000)).toBeCloseTo(12)
    expect(metresToMm(50, 500)).toBeCloseTo(100)
  })
  it('picks a round scale-bar length (~40 mm target)', () => {
    expect(scaleBarMetres(1000, 40)).toBe(20)     // 20 m → 20 mm
    expect(scaleBarMetres(500, 40)).toBe(20)      // 20 m → 40 mm
    expect(metresToMm(scaleBarMetres(2000, 40), 2000)).toBeLessThanOrEqual(45)
  })
})
