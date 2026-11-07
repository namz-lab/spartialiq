import { describe, it, expect, vi, beforeEach } from 'vitest'

// vunguBasemapStyle holds no cartography of its own any more -- it resolves
// compiled MapLibre layers from the enterprise GIS symbology registry. So this
// spec mocks the registry client and asserts the RESOLUTION behaviour: that a
// published style is used verbatim, that server-rendered symbology is never
// approximated, and that a missing style degrades visibly rather than silently.
const styles = new Map<string, any>()

vi.mock('@/services/gisStyles', () => ({
  peekPublishedStyle: (layerId: string) => styles.get(layerId) ?? null,
  getPublishedStylesheet: async () => Array.from(styles.values()),
}))

import {
  styleLayerFor, styleLayersFor, chipColorFor,
  classificationColorsFor, renderStrategyFor,
} from '../vunguBasemapStyle'

/** A published style shaped as the backend compiler emits it. */
function published(layerId: string, over: Record<string, any> = {}) {
  return {
    layerId,
    styleVersion: 1,
    status: 'published',
    source: 'statutory_schedule',
    fidelity: 'direct',
    renderStrategy: 'vector',
    checksum: `sha256:${layerId}`,
    maplibre: [],
    renderNotes: [],
    definition: { renderer: { type: 'single' } },
    ...over,
  }
}

const src = (layerId: string) => ({ source: `vungu-${layerId}`, 'source-layer': layerId })

beforeEach(() => styles.clear())

describe('styleLayersFor — resolution from the registry', () => {
  it('uses the published compiled layers verbatim', () => {
    styles.set('landuse', published('landuse', {
      maplibre: [{
        id: 'vungu-landuse-fill', type: 'fill', ...src('landuse'),
        minzoom: 8, maxzoom: 22,
        paint: {
          'fill-color': ['match', ['get', 'fclass'], 'residential', '#f1dd7c', '#efeadf'],
          'fill-opacity': 0.9,
        },
      }],
    }))

    const layers = styleLayersFor({ id: 'landuse', geomType: 'polygon', group: 'landuse' } as any)
    expect(layers).toHaveLength(1)
    expect(layers[0].type).toBe('fill')
    expect(layers[0]['source-layer']).toBe('landuse')
    // The colour is the registry's, not this module's.
    expect(layers[0].paint['fill-color']).toEqual(
      ['match', ['get', 'fclass'], 'residential', '#f1dd7c', '#efeadf'],
    )
  })

  it('returns EVERY compiled layer, so casings and labels are not dropped', () => {
    // A statutory road is a paper casing under an inked line: two MapLibre
    // layers for one symbol. Returning only the first would lose the casing.
    styles.set('roads', published('roads', {
      fidelity: 'converted',
      maplibre: [
        { id: 'vungu-roads-casing', type: 'line', ...src('roads'), paint: { 'line-color': '#ffffff', 'line-width': 1.5 } },
        { id: 'vungu-roads-line', type: 'line', ...src('roads'), paint: { 'line-color': ['match', ['get', 'fclass'], 'motorway', '#202020', '#cf9077'], 'line-width': 1 } },
        { id: 'vungu-roads-label', type: 'symbol', ...src('roads'), paint: { 'text-color': '#444444' }, layout: { 'text-field': ['get', 'name'] } },
      ],
    }))

    const layers = styleLayersFor({ id: 'roads', geomType: 'line', group: 'transport' } as any)
    expect(layers.map((l) => l.id)).toEqual([
      'vungu-roads-casing', 'vungu-roads-line', 'vungu-roads-label',
    ])
  })

  it('does NOT approximate server-rendered symbology in MapLibre', () => {
    // A procedural hatch or SVG marker has no MapLibre equivalent. Drawing a
    // lookalike would put unapproved cartography in front of a planner, so the
    // resolver must yield nothing and leave the layer to the WMS overlay.
    styles.set('vungu_parcels', published('vungu_parcels', {
      fidelity: 'server',
      renderStrategy: 'wms',
      maplibre: [],
    }))

    expect(styleLayersFor({ id: 'vungu_parcels', geomType: 'polygon', group: 'master_plan' } as any)).toEqual([])
    expect(renderStrategyFor('vungu_parcels')).toBe('wms')
  })

  it('degrades to a visibly diagnostic layer when no style resolved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const layers = styleLayersFor({ id: 'unknown_layer', geomType: 'polygon', group: 'landuse' } as any)
    expect(layers).toHaveLength(1)
    expect(layers[0].type).toBe('fill')
    // Neutral grey, not a plausible cartographic colour.
    expect(layers[0].paint['fill-color']).toBe('#d4d4d4')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps geometry-appropriate diagnostics for line and point layers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(styleLayersFor({ id: 'x', geomType: 'line' } as any)[0].type).toBe('line')
    expect(styleLayersFor({ id: 'y', geomType: 'point' } as any)[0].type).toBe('circle')
    warn.mockRestore()
  })
})

describe('styleLayerFor — primary layer', () => {
  it('picks the ink, not the casing, as the primary layer', () => {
    styles.set('roads', published('roads', {
      maplibre: [
        { id: 'vungu-roads-casing', type: 'line', ...src('roads'), paint: { 'line-color': '#ffffff' } },
        { id: 'vungu-roads-line', type: 'line', ...src('roads'), paint: { 'line-color': '#202020' } },
      ],
    }))
    expect(styleLayerFor({ id: 'roads', geomType: 'line', group: 'transport' } as any).id)
      .toBe('vungu-roads-line')
  })
})

describe('provinces regression guard', () => {
  // The first registry seed pass wrongly reduced provinces to a plain boundary
  // line, silently deleting the per-province colour wash and its zoom fade.
  // The registry must carry both, and the resolver must pass them through.
  it('keeps the per-province match fill and its zoom-interpolated fade', () => {
    styles.set('provinces', published('provinces', {
      fidelity: 'converted',
      maplibre: [{
        id: 'vungu-provinces-fill', type: 'fill', ...src('provinces'),
        paint: {
          'fill-color': ['match', ['get', 'name_en'], 'Midlands', '#d9f99d', '#cbd5e1'],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 11, 0],
        },
      }],
    }))

    const l = styleLayerFor({ id: 'provinces', geomType: 'polygon', group: 'admin' } as any)
    expect(l.type).toBe('fill')
    expect(Array.isArray(l.paint['fill-color'])).toBe(true)
    expect(l.paint['fill-color'][0]).toBe('match')
    expect(Array.isArray(l.paint['fill-opacity'])).toBe(true)
    expect(l.paint['fill-opacity'][0]).toBe('interpolate')
  })
})

describe('legend colours come from the same paint the map draws', () => {
  it('chipColorFor reads the fallback colour out of a match expression', () => {
    styles.set('landuse', published('landuse', {
      maplibre: [{
        id: 'vungu-landuse-fill', type: 'fill', ...src('landuse'),
        paint: { 'fill-color': ['match', ['get', 'fclass'], 'residential', '#f1dd7c', '#efeadf'] },
      }],
    }))
    expect(chipColorFor('landuse', 'polygon')).toBe('#efeadf')
  })

  it('chipColorFor skips the casing so a road chip shows ink, not paper', () => {
    styles.set('roads', published('roads', {
      maplibre: [
        { id: 'vungu-roads-casing', type: 'line', ...src('roads'), paint: { 'line-color': '#ffffff' } },
        { id: 'vungu-roads-line', type: 'line', ...src('roads'), paint: { 'line-color': '#cf9077' } },
      ],
    }))
    expect(chipColorFor('roads', 'line')).toBe('#cf9077')
  })

  it('falls back to a diagnostic grey rather than inventing a colour', () => {
    expect(chipColorFor('nope', 'polygon')).toBe('#d4d4d4')
    expect(chipColorFor('nope', 'line')).toBe('#a3a3a3')
    expect(chipColorFor('nope', 'point')).toBe('#8a8a8a')
  })

  it('classificationColorsFor exposes the published categories for the legend', () => {
    styles.set('vungu_proposed_peri_urban_zones', published('vungu_proposed_peri_urban_zones', {
      definition: {
        renderer: {
          type: 'categorized',
          attribute: 'zone',
          categories: [
            { value: 'High Density Residential', label: 'High Density Residential', symbol: { fill: '#d8ab47' } },
            { value: 'Economic Corridor [Mixed Business]', label: 'Economic Corridor [Mixed Business]', symbol: { fill: '#4f83c2' } },
          ],
        },
      },
    }))

    const colours = classificationColorsFor('vungu_proposed_peri_urban_zones')
    expect(colours['High Density Residential']).toBe('#d8ab47')
    // The two classes QGIS once painted the same #ffff00 must stay distinct.
    expect(colours['Economic Corridor [Mixed Business]']).toBe('#4f83c2')
    expect(colours['High Density Residential'])
      .not.toBe(colours['Economic Corridor [Mixed Business]'])
  })

  it('returns nothing for a layer with no classification', () => {
    styles.set('buildings', published('buildings'))
    expect(classificationColorsFor('buildings')).toEqual({})
  })
})
