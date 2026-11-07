// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import type { Polygon, LineString } from 'geojson'
import { DEFAULT_CAD_LAYERS, type CadEntity } from '../cad/cadModel'
import { collectStudioDxfPayload, cadDraftFromDxfFeatures, resolveCadLayerId } from '../studio-dxf'

const ring: Polygon = {
  type: 'Polygon',
  coordinates: [[[29.81, -19.45], [29.82, -19.45], [29.82, -19.44], [29.81, -19.44], [29.81, -19.45]]],
}
const street: LineString = {
  type: 'LineString',
  coordinates: [[29.81, -19.45], [29.82, -19.45]],
}

describe('collectStudioDxfPayload', () => {
  it('writes lots, roads and CAD linework onto versioned VUNGU_* layers', () => {
    const cadLine: CadEntity = {
      id: 'line-1', type: 'line', geom: street, layerId: 'roads', visible: true,
    }
    const cadText: CadEntity = {
      id: 'txt-1', type: 'text', geom: { type: 'Point', coordinates: [29.815, -19.445] },
      layerId: 'annotation', text: 'Stand 12', visible: true,
    }
    const payload = collectStudioDxfPayload({
      planningArea: { id: 'pa', projectId: 'p', name: 'Farm 12', geom: ring, areaSqm: 10000 } as any,
      constraints: [],
      roads: [{ id: 'rd-1', geom: street, type: 'street', hierarchy: 'local', widthM: 12 }],
      openSpace: [],
      lots: [{ id: 'lot-aaa', blockId: 'blk-1', geom: ring, areaSqm: 400, frontageM: 20, depthM: 20, lotNumber: '1', status: 'draft' }],
      cadEntities: [cadLine, cadText],
      cadLayers: DEFAULT_CAD_LAYERS,
    })
    const kinds = payload.features.map(f => (f.properties as any).kind)
    expect(kinds).toContain('boundary')
    expect(kinds).toContain('road')
    expect(kinds).toContain('lot')
    expect(kinds).toContain('line')
    const cadFeat = payload.features.find(f => (f.properties as any).kind === 'line')
    expect(cadFeat?.properties).toMatchObject({ dxfLayer: 'VUNGU_ROADS', kind: 'line' })
    const road = payload.features.find(f => (f.properties as any).kind === 'road')
    expect(road?.properties).toMatchObject({ dxfLayer: 'VUNGU_ROADS' })
    const lot = payload.features.find(f => (f.properties as any).kind === 'lot')
    expect(lot?.properties).toMatchObject({ id: 'Lot 1', roundTripId: 'lot-aaa' })
    expect(payload.labels).toEqual([{ lngLat: [29.815, -19.445], text: 'Stand 12' }])
  })
})

describe('cadDraftFromDxfFeatures', () => {
  it('maps CAD- prefixed layers back onto studio layers and types geometry', () => {
    const items = cadDraftFromDxfFeatures([
      { properties: { cad: true, layer: 'CAD-ROADS' }, geometry: street },
      { properties: { cad: true, layer: 'CAD-STANDS' }, geometry: ring },
      { properties: { cad: true, layer: 'CAD-ANNOTATION', text: 'N' }, geometry: { type: 'Point', coordinates: [29.81, -19.45] } },
      { properties: { layer: 'LOTS' }, geometry: ring },
    ], DEFAULT_CAD_LAYERS, 'roads')
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ type: 'line', layerId: 'roads' })
    expect(items[1]).toMatchObject({ type: 'polygon', layerId: 'stands' })
    expect(items[2]).toMatchObject({ type: 'text', layerId: 'annotation', text: 'N' })
  })
})

describe('resolveCadLayerId', () => {
  it('strips the CAD- prefix and matches by name', () => {
    expect(resolveCadLayerId('CAD-ROADS', DEFAULT_CAD_LAYERS, 'annotation')).toBe('roads')
    expect(resolveCadLayerId('CAD-STANDS', DEFAULT_CAD_LAYERS, 'roads')).toBe('stands')
    expect(resolveCadLayerId('VUNGU_ROADS_ARTERIAL', DEFAULT_CAD_LAYERS, 'roads')).toBe('roads-arterial')
    expect(resolveCadLayerId('VUNGU_ANNOTATION', DEFAULT_CAD_LAYERS, 'roads')).toBe('annotation')
    expect(resolveCadLayerId('C-ROAD-COLLECTOR', DEFAULT_CAD_LAYERS, 'roads')).toBe('roads-collector')
    expect(resolveCadLayerId('LINES', DEFAULT_CAD_LAYERS, 'roads')).toBe('roads')
  })
})
