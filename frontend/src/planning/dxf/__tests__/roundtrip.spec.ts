import { describe, it, expect } from 'vitest'
import { resolveLayer, dxfLayerForKind, isStandLayer, isRoadLayer, LAYER_MAP_VERSION } from '../layerRegistry'
import { validateImport } from '../validationService'
import { compareDrawings } from '../compareService'
import { inspectDxf, parseDxfToGeoJSON, metresScaleForInsunits } from '@/map/tools/dxfImport'
import { exportFeaturesToDxf } from '@/map/tools/dxfExport'
import { collectStudioDxfPayload } from '../../studio-dxf'
import { usePlanningTools } from '../../usePlanningTools'
import type { Polygon, LineString } from 'geojson'

const ring: Polygon = {
  type: 'Polygon',
  coordinates: [[[29.81, -19.45], [29.82, -19.45], [29.82, -19.44], [29.81, -19.44], [29.81, -19.45]]],
}
const street: LineString = {
  type: 'LineString',
  coordinates: [[29.81, -19.45], [29.82, -19.45]],
}

function inspectFixture(extra: string[] = []) {
  return inspectDxf([
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '9', '$INSUNITS', '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'VUNGU_STANDS', '90', '4', '70', '1',
    '10', '311000.0', '20', '7847000.0',
    '10', '311100.0', '20', '7847000.0',
    '10', '311100.0', '20', '7847100.0',
    '10', '311000.0', '20', '7847100.0',
    ...extra,
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n') + '\n')
}

describe('DXF layer registry', () => {
  it('is versioned and maps legacy LOTS/ROADS onto VUNGU_* without inventing GIS layers', () => {
    expect(LAYER_MAP_VERSION).toBe(1)
    expect(resolveLayer('LOTS')?.dxfLayer).toBe('VUNGU_STANDS')
    expect(resolveLayer('ROADS-ARTERIAL')?.dxfLayer).toBe('VUNGU_ROADS_ARTERIAL')
    expect(resolveLayer('RANDOM_LAYER')).toBeNull()
    expect(dxfLayerForKind('lot')).toBe('VUNGU_STANDS')
    expect(dxfLayerForKind('road', 'collector')).toBe('VUNGU_ROADS_COLLECTOR')
    expect(isStandLayer('VUNGU_STANDS')).toBe(true)
    expect(isRoadLayer('CAD-ROADS')).toBe(true)
    expect(isStandLayer('CONSTRUCTION')).toBe(false)
  })
})

describe('inspectDxf', () => {
  it('reads units, version and does not assume a CRS', () => {
    const ins = inspectFixture()
    expect(ins.readable).toBe(true)
    expect(ins.acadVer).toBe('AC1009')
    expect(ins.insunits).toBe(6)
    expect(ins.unitsLabel).toBe('metres')
    expect(ins.crsFromFile).toBeNull()
    expect(ins.layers).toContain('VUNGU_STANDS')
    expect(ins.entitySupport.LWPOLYLINE).toBe('SUPPORTED')
  })

  it('classifies unsupported entities and lists XREFs', () => {
    const dxf = [
      '999', 'VUNGU-CRS:EPSG:32736',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', '3DSOLID', '8', '0',
      '1', 'site.dwg',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n'
    const ins = inspectDxf(dxf)
    expect(ins.entitySupport['3DSOLID']).toBe('UNSUPPORTED')
    expect(ins.xrefs.some(x => /site\.dwg/i.test(x))).toBe(true)
    expect(ins.crsFromFile).toBe('EPSG:32736')
  })

  it('rejects binary DWG', () => {
    const ins = inspectDxf('AC1027\0binary')
    expect(ins.readable).toBe(false)
    expect(ins.hasBinaryDwg).toBe(true)
  })
})

describe('validateImport', () => {
  const expected = 'EPSG:32736'

  it('blocks when CRS cannot be identified', () => {
    const inspection = inspectFixture()
    const report = validateImport({
      inspection,
      features: [],
      expectedEpsg: expected,
      confirmedEpsg: null,
      sidecarEpsg: null,
      fileEpsg: null,
      applyUnitTransform: false,
      acceptUnmappedAsCad: false,
      parcelGeom: ring,
    })
    expect(report.blocked).toBe(true)
    expect(report.issues.some(i => i.code === 'crs-unknown')).toBe(true)
  })

  it('blocks CRS mismatch against the source planning project', () => {
    const inspection = inspectFixture()
    const report = validateImport({
      inspection,
      features: [],
      expectedEpsg: expected,
      confirmedEpsg: null,
      sidecarEpsg: 'EPSG:32735',
      fileEpsg: 'EPSG:32735',
      applyUnitTransform: false,
      acceptUnmappedAsCad: false,
      parcelGeom: ring,
    })
    expect(report.blocked).toBe(true)
    expect(report.crs.status).toBe('mismatch')
    expect(report.issues.find(i => i.code === 'crs-mismatch')?.detail).toMatch(/does not match the source planning project/i)
  })

  it('blocks unit mismatch until Transform is chosen', () => {
    const mm = inspectDxf([
      '0', 'SECTION', '2', 'HEADER',
      '9', '$INSUNITS', '70', '4',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'VUNGU_ROADS', '10', '0', '20', '0', '11', '1', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n')
    const blocked = validateImport({
      inspection: mm,
      features: [],
      expectedEpsg: expected,
      confirmedEpsg: expected,
      sidecarEpsg: expected,
      fileEpsg: expected,
      applyUnitTransform: false,
      acceptUnmappedAsCad: true,
      parcelGeom: ring,
    })
    expect(blocked.blocked).toBe(true)
    expect(blocked.units.status).toBe('mismatch')
    expect(blocked.issues.find(i => i.code === 'units-mismatch')?.title).toBe('UNIT MISMATCH')
    expect(metresScaleForInsunits(4)).toBe(0.001)
    const ok = validateImport({
      inspection: mm,
      features: [],
      expectedEpsg: expected,
      confirmedEpsg: expected,
      sidecarEpsg: expected,
      fileEpsg: expected,
      applyUnitTransform: true,
      acceptUnmappedAsCad: true,
      parcelGeom: ring,
    })
    expect(ok.issues.some(i => i.code === 'units-mismatch')).toBe(false)
  })

  it('blocks unmapped layers unless accepted as CAD annotation', () => {
    const inspection = inspectDxf([
      '0', 'SECTION', '2', 'HEADER',
      '9', '$INSUNITS', '70', '6',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'RANDOM_CIVIL', '90', '2', '70', '0',
      '10', '0', '20', '0', '10', '1', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n')
    const blocked = validateImport({
      inspection,
      features: [],
      expectedEpsg: expected,
      confirmedEpsg: expected,
      sidecarEpsg: expected,
      fileEpsg: expected,
      applyUnitTransform: false,
      acceptUnmappedAsCad: false,
      parcelGeom: ring,
    })
    expect(blocked.blocked).toBe(true)
    expect(blocked.issues.some(i => i.code === 'unmapped-layer')).toBe(true)
    const allowed = validateImport({ ...blocked, inspection, features: [], expectedEpsg: expected, confirmedEpsg: expected, sidecarEpsg: expected, fileEpsg: expected, applyUnitTransform: false, acceptUnmappedAsCad: true, parcelGeom: ring })
    expect(allowed.issues.some(i => i.code === 'unmapped-layer')).toBe(false)
  })
})

describe('compareDrawings', () => {
  it('uses identity when lot ids survive and geometric matching otherwise', () => {
    const lots = [{ id: 'lot-aaa', geom: ring, areaSqm: 400, lotNumber: '1' } as any]
    const imported = [{ type: 'Feature' as const, properties: { lotId: 'lot-aaa', lotNumber: '1' }, geometry: ring }]
    const same = compareDrawings({ lots, roads: [], cadEntities: [], importedLots: imported as any, importedRoads: [], importedCad: [] })
    expect(same.totals.added).toBe(0)
    expect(same.totals.deleted).toBe(0)
    expect(same.method).toBe('identity-then-geometric')

    const movedRing: Polygon = {
      type: 'Polygon',
      coordinates: [[[29.83, -19.45], [29.84, -19.45], [29.84, -19.44], [29.83, -19.44], [29.83, -19.45]]],
    }
    const moved = compareDrawings({
      lots, roads: [], cadEntities: [],
      importedLots: [{ type: 'Feature', properties: { lotId: 'lot-aaa' }, geometry: movedRing }] as any,
      importedRoads: [], importedCad: [],
    })
    expect(moved.moved.length + moved.modified.length).toBeGreaterThan(0)
    expect(moved.moved[0]?.confidence || moved.modified[0]?.confidence).toBe('identity')
  })
})

describe('round-trip export → parse → merge gate', () => {
  it('exports VUNGU layers, round-trips geometry, and importDxf only runs when called (no silent merge)', () => {
    const lotRing: Polygon = {
      type: 'Polygon',
      coordinates: [[[29.812, -19.448], [29.818, -19.448], [29.818, -19.442], [29.812, -19.442], [29.812, -19.448]]],
    }
    const identity = exportFeaturesToDxf([
      { type: 'Feature', properties: { kind: 'lot', id: 'Lot 1', roundTripId: 'lot-aaa', dxfLayer: 'VUNGU_STANDS' }, geometry: lotRing },
    ], [], { download: false })
    expect(identity.dxf).toMatch(/VUNGU_STANDS/)
    expect(identity.dxf).toMatch(/#lot-aaa/)
    const identified = parseDxfToGeoJSON(identity.dxf, [29.815, -19.45], { epsg: identity.epsg })
    const idLots = identified.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    expect(idLots[0].properties!.lotId).toBe('lot-aaa')

    const payload = collectStudioDxfPayload({
      planningArea: { id: 'pa', projectId: 'p', name: 'Farm 12', geom: ring, areaSqm: 10000 } as any,
      constraints: [],
      roads: [{ id: 'rd-1', geom: street, type: 'street', hierarchy: 'local', widthM: 12 }],
      openSpace: [],
      lots: [{ id: 'lot-aaa', blockId: 'blk-1', geom: lotRing, areaSqm: 400, frontageM: 20, depthM: 20, lotNumber: '1', status: 'draft' }],
      cadEntities: [],
      cadLayers: [],
    })
    const written = exportFeaturesToDxf(payload.features, payload.labels, { download: false, comments: ['VUNGU-CRS:EPSG:32736'] })
    expect(written.dxf).toMatch(/VUNGU_STANDS/)
    expect(written.dxf).toMatch(/VUNGU-CRS:EPSG:32736/)
    expect(written.dxf).toMatch(/\$INSUNITS[\s\S]*6/)

    const parsed = parseDxfToGeoJSON(written.dxf, [29.815, -19.45], { includeOtherLayers: true, epsg: written.epsg })
    const lots = parsed.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    expect(lots.length).toBeGreaterThanOrEqual(1)

    const t = usePlanningTools()
    t.selectParcel({ type: 'Feature', properties: {}, geometry: ring } as any, 'Farm 12')
    t.addManualLot(ring)
    const before = t.lots.value.length
    expect(before).toBeGreaterThan(0)
    const summary = t.importDxf({ features: parsed.featureCollection.features.filter((f: any) => !f.properties.cad) })
    expect(summary.ok).toBe(true)
    expect(t.lots.value.length).toBeGreaterThanOrEqual(before)
  })
})
