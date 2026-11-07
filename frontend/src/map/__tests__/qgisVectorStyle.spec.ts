import { describe, it, expect, vi } from 'vitest'
vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))
vi.mock('@/services/ogc', () => ({ ogcService: {}, wmsTileUrlTemplate: () => '' }))
import { qgisVectorLayers, qgisLegend, type QgisStyle } from '@/map/qgisWmsOverlay'

// Shapes taken from /api/ogc/api/styles/:layer for the real project layers.
const zones: QgisStyle = {
  rendererType: 'categorizedSymbol', attributeName: 'zone',
  symbols: [
    { category: 'Low Density Residential', name: 'Low Density Residential', fill: { color: '#f6ecae', style: 'solid' }, stroke: { color: '#232323', width: 0.26 } },
    { category: 'Light Industry', name: 'Light Industry', fill: { color: '#cf9cba', style: 'solid' }, stroke: { color: '#232323', width: 0.26 } },
    { category: 'default', name: 'Other', fill: { color: '#efeadf', style: 'solid' }, stroke: { color: '#232323', width: 0.26 } },
  ],
}
const farms: QgisStyle = {
  rendererType: 'graduatedSymbol', attributeName: 'area_ha',
  symbols: [
    { name: 'Large', lower: 2000, upper: 10000, fill: { color: '#78c679', style: 'solid' } },
    { name: 'Smallholding', lower: 0, upper: 500, fill: { color: '#ffffcc', style: 'solid' } },
  ],
}
const roads: QgisStyle = {
  rendererType: 'categorizedSymbol', attributeName: 'fclass',
  symbols: [{ category: 'primary', name: 'primary', strokeLayers: [{ color: '#ffffff', width: 6 }, { color: '#202020', width: 4 }] }],
}

describe('qgisVectorLayers', () => {
  it('categorised polygons match on the attribute, with the else class as default', () => {
    const [fill, outline] = qgisVectorLayers('m', 's', 'Polygon', zones)
    expect(fill.paint['fill-color']).toEqual(
      ['match', ['to-string', ['get', 'zone']], 'Low Density Residential', '#f6ecae', 'Light Industry', '#cf9cba', '#efeadf'])
    expect(outline.id).toBe('m-outline')
  })

  it('graduated classes become a step ordered by lower bound', () => {
    const [fill] = qgisVectorLayers('m', 's', 'Polygon', farms)
    expect(fill.paint['fill-color']).toEqual(['step', ['to-number', ['get', 'area_ha'], 0], '#ffffcc', 2000, '#78c679'])
  })

  it('a stacked line symbol draws its core colour over a casing layer', () => {
    const [core, casing] = qgisVectorLayers('m', 's', 'LineString', roads)
    expect(core.id).toBe('m')
    expect(core.paint['line-color']).toEqual(['match', ['to-string', ['get', 'fclass']], 'primary', '#202020', '#202020'])
    expect(casing.id).toBe('m-casing')
  })

  it('without a QGIS style a layer still gets a statutory colour, not nothing', () => {
    const [pt] = qgisVectorLayers('m', 's', 'Point', null)
    expect(pt.type).toBe('circle')
    expect(typeof pt.paint['circle-color']).toBe('string')
  })

  it('legend rows carry the project labels', () => {
    expect(qgisLegend(zones).map(r => r.label)).toEqual(['Low Density Residential', 'Light Industry', 'Other'])
  })
})
