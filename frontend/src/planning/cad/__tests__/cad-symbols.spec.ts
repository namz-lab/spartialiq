// @vitest-environment happy-dom
// Symbol library + insertion (cadSymbols.expandSymbol + useCadDocument.addSymbol).
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { expandSymbol, SYMBOL_LIBRARY, SYMBOL_LIST } from '../cadSymbols'
import { useCadDocument } from '../useCadDocument'

const A: [number, number] = [29.8, -19.4]

describe('SYMBOL_LIBRARY', () => {
  it('every symbol has a default size and at least one part', () => {
    expect(SYMBOL_LIST.length).toBeGreaterThan(3)
    for (const s of SYMBOL_LIST) {
      expect(s.defaultSizeM).toBeGreaterThan(0)
      expect(s.parts.length).toBeGreaterThan(0)
    }
  })
})

describe('expandSymbol', () => {
  it('returns nothing for an unknown symbol', () => {
    expect(expandSymbol({ symbolId: 'nope', sizeM: 5, rotationDeg: 0 }, A)).toHaveLength(0)
  })

  it('is scale-true — a tree canopy of size 10 m has ~5 m radius', () => {
    const parts = expandSymbol({ symbolId: 'tree', sizeM: 10, rotationDeg: 0 }, A)
    const canopy = parts.find(p => p.geom.type === 'Polygon')!
    const ring = (canopy.geom as any).coordinates[0] as [number, number][]
    const r = turf.distance(A, ring[0], { units: 'meters' })
    expect(r).toBeGreaterThan(4.6)
    expect(r).toBeLessThan(5.4)
  })

  it('emits the north-arrow "N" label north of the insertion at 0° rotation', () => {
    const parts = expandSymbol({ symbolId: 'north_arrow', sizeM: 14, rotationDeg: 0 }, A)
    const label = parts.find(p => p.role === 'text')!
    expect(label.text).toBe('N')
    const b = turf.bearing(A, (label.geom as any).coordinates)
    expect(Math.abs(b)).toBeLessThan(4)   // ~due north
  })

  it('rotates clockwise — 90° puts the "N" label to the east', () => {
    const parts = expandSymbol({ symbolId: 'north_arrow', sizeM: 14, rotationDeg: 90 }, A)
    const label = parts.find(p => p.role === 'text')!
    const b = turf.bearing(A, (label.geom as any).coordinates)
    expect(b).toBeGreaterThan(86)
    expect(b).toBeLessThan(94)            // ~due east
  })

  it('falls back to the library default size when sizeM ≤ 0', () => {
    const parts = expandSymbol({ symbolId: 'tree', sizeM: 0, rotationDeg: 0 }, A)
    const ring = (parts[0].geom as any).coordinates[0] as [number, number][]
    const r = turf.distance(A, ring[0], { units: 'meters' })
    // default tree size is 6 m → ~3 m radius
    expect(r).toBeGreaterThan(2.6)
    expect(r).toBeLessThan(3.4)
  })
})

describe('useCadDocument.addSymbol', () => {
  it('inserts a symbol entity that expands via symbolsGeoJSON, excluded from toGeoJSON', () => {
    const d = useCadDocument()
    const e = d.addSymbol('survey_beacon', A)!
    expect(e.type).toBe('symbol')
    expect(e.symbol!.symbolId).toBe('survey_beacon')
    expect(e.symbol!.sizeM).toBe(SYMBOL_LIBRARY.survey_beacon.defaultSizeM)
    // symbols render via the live overlay, not the main CAD geojson
    expect((d.toGeoJSON.value.features as any[]).some(f => f.properties.id === e.id)).toBe(false)
    const symFeats = (d.symbolsGeoJSON.value.features as any[]).filter(f => f.properties.id === e.id)
    expect(symFeats.length).toBeGreaterThan(0)
  })

  it('returns null for an unknown symbol id', () => {
    const d = useCadDocument()
    expect(d.addSymbol('ghost', A)).toBeNull()
    expect(d.entities.value).toHaveLength(0)
  })

  it('honours a size override', () => {
    const d = useCadDocument()
    const e = d.addSymbol('tree', A, { sizeM: 12 })!
    expect(e.symbol!.sizeM).toBe(12)
  })
})
