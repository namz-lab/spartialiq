// @vitest-environment happy-dom
// Xref reference underlays (cadXref.attachXref / setXrefVisible).
// Uses a mock MapLibre map (no backend) to verify the wiring.
import { describe, it, expect } from 'vitest'
import { attachXref, setXrefVisible, XREF_CONTEXT } from '../cadXref'
import type { TileLayerMeta } from '@/services/vectorTiles'

/** A minimal MapLibre stand-in that records source/layer/visibility calls. */
function mockMap() {
  const sources = new Set<string>()
  const layers = new Map<string, any>()
  const visibility: Record<string, string> = {}
  return {
    sources, layers, visibility,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string, def: any) => { sources.add(id); (sources as any)[id] = def },
    getLayer: (id: string) => layers.get(id),
    addLayer: (def: any, _before?: string) => { layers.set(def.id, def) },
    setLayoutProperty: (id: string, _k: string, v: string) => { visibility[id] = v },
  }
}

const catalog: TileLayerMeta[] = [
  { id: 'buildings', title: 'Buildings', geomType: 'polygon', group: 'structures', minzoom: 12, maxzoom: 22 },
  { id: 'roads', title: 'Roads', geomType: 'line', group: 'transport', minzoom: 8, maxzoom: 22 },
  { id: 'waterways', title: 'Waterways', geomType: 'line', group: 'hydro', minzoom: 8, maxzoom: 22 },
  // note: water_areas / vungu_parcels / landuse intentionally absent from this catalog
]

describe('attachXref', () => {
  it('adds sources + layers only for context ids present in the catalog', () => {
    const m = mockMap()
    const reg = attachXref(m, catalog)
    // buildings + roads + waterways present; the other 3 context ids are not
    expect(reg.map(r => r.id).sort()).toEqual(['buildings', 'roads', 'waterways'])
    expect(m.sources.has('vungu-buildings')).toBe(true)
    expect(m.sources.has('vungu-landuse')).toBe(false)
    // buildings is a polygon → fill + line layers, both bound to the source-layer
    expect(m.layers.get('xref-buildings-fill')['source-layer']).toBe('buildings')
    expect(m.layers.get('xref-buildings-line')).toBeTruthy()
    // roads is a line → single line layer
    expect(m.layers.get('xref-roads-line').type).toBe('line')
  })

  it('adds every reference layer HIDDEN by default (opt-in underlay)', () => {
    const m = mockMap()
    const reg = attachXref(m, catalog)
    expect(reg.every(r => r.visible === false)).toBe(true)
    for (const r of reg) for (const id of r.layerIds) expect(m.visibility[id]).toBe('none')
  })

  it('returns nothing when the catalog is empty (tiles offline)', () => {
    expect(attachXref(mockMap(), [])).toHaveLength(0)
  })

  it('is idempotent — re-attaching does not duplicate sources', () => {
    const m = mockMap()
    attachXref(m, catalog)
    const before = m.sources.size
    attachXref(m, catalog)
    expect(m.sources.size).toBe(before)
  })
})

describe('setXrefVisible', () => {
  it('toggles all of a layer’s style-layers and updates the flag', () => {
    const m = mockMap()
    const reg = attachXref(m, catalog)
    const buildings = reg.find(r => r.id === 'buildings')!
    setXrefVisible(m, buildings, true)
    expect(buildings.visible).toBe(true)
    for (const id of buildings.layerIds) expect(m.visibility[id]).toBe('visible')
    setXrefVisible(m, buildings, false)
    expect(buildings.visible).toBe(false)
    for (const id of buildings.layerIds) expect(m.visibility[id]).toBe('none')
  })
})

describe('XREF_CONTEXT', () => {
  it('offers the curated planning reference set', () => {
    expect(XREF_CONTEXT.map(c => c.id)).toContain('vungu_parcels')
    expect(XREF_CONTEXT.length).toBeGreaterThanOrEqual(5)
  })
})
