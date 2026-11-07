// @vitest-environment happy-dom
// Verifies dxfImport.ts against its own spec: (a) a real round-trip through
// the actual exportFeaturesToDxf() writer (golden path — our own output must
// come back byte-for-byte equivalent geometry with ids recovered), and (b) a
// hand-built LWPOLYLINE fixture, because dxfExport.ts only ever writes legacy
// POLYLINE/VERTEX/SEQEND — a real AutoCAD/QGIS re-save is what would actually
// produce LWPOLYLINE, so the golden round-trip alone can't cover that path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { exportFeaturesToDxf } from '../dxfExport'
import { parseDxfToGeoJSON, roadHierarchyFromDxfLayer } from '../dxfImport'

// Small farm parcel near Gweru, Zimbabwe (southern hemisphere, UTM zone 36S) —
// used as both the export input's rough location and the import reference point.
const REF: [number, number] = [29.815, -19.45]

function makeLotPolygon(cx: number, cy: number, halfW: number, halfH: number) {
  // ~0.001 deg steps around REF so this stays in the same UTM zone/hemisphere.
  return {
    type: 'Polygon' as const,
    coordinates: [[
      [cx - halfW, cy - halfH], [cx + halfW, cy - halfH],
      [cx + halfW, cy + halfH], [cx - halfW, cy + halfH],
      [cx - halfW, cy - halfH],
    ]],
  }
}

let capturedBlob: Blob | null = null
let origCreateObjectURL: typeof URL.createObjectURL
let origRevokeObjectURL: typeof URL.revokeObjectURL

beforeEach(() => {
  capturedBlob = null
  origCreateObjectURL = URL.createObjectURL
  origRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = ((blob: Blob) => { capturedBlob = blob; return 'blob:mock' }) as any
  URL.revokeObjectURL = (() => {}) as any
})
afterEach(() => {
  URL.createObjectURL = origCreateObjectURL
  URL.revokeObjectURL = origRevokeObjectURL
})

describe('parseDxfToGeoJSON — golden round-trip through the real exporter', () => {
  it('recovers lot geometry, round-trip ids, lot numbers, and roads exactly as exported', async () => {
    const feats = [
      { type: 'Feature' as const, properties: { kind: 'lot', id: 'Lot 1', roundTripId: 'lot-aaa' }, geometry: makeLotPolygon(29.810, -19.450, 0.001, 0.0008) },
      { type: 'Feature' as const, properties: { kind: 'lot', id: 'Lot 2', roundTripId: 'lot-bbb' }, geometry: makeLotPolygon(29.815, -19.450, 0.001, 0.0008) },
      { type: 'Feature' as const, properties: { kind: 'road' }, geometry: { type: 'LineString' as const, coordinates: [[29.809, -19.451], [29.817, -19.451]] } },
    ]
    exportFeaturesToDxf(feats, [], { fileName: 'test-subdivision' })
    expect(capturedBlob).toBeTruthy()
    const dxfText = await capturedBlob!.text()

    const result = parseDxfToGeoJSON(dxfText, REF)
    expect(result.warnings).toEqual([])

    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    const roads = result.featureCollection.features.filter((f: any) => f.properties.layer === 'ROADS')
    expect(lots).toHaveLength(2)
    expect(roads).toHaveLength(1)

    const lotIds = lots.map((f: any) => f.properties.lotId).sort()
    expect(lotIds).toEqual(['lot-aaa', 'lot-bbb'])
    const lotNumbers = lots.map((f: any) => f.properties.lotNumber).sort()
    expect(lotNumbers).toEqual(['1', '2'])

    // Geometry should round-trip to within a few metres (DXF is written at mm precision
    // in UTM metres, then re-projected — floating point + proj4 tolerance only).
    for (const lot of lots) {
      const ring = (lot.geometry as any).coordinates[0]
      for (const [lng, lat] of ring) {
        expect(lng).toBeGreaterThan(29.7)
        expect(lng).toBeLessThan(29.9)
        expect(lat).toBeGreaterThan(-19.6)
        expect(lat).toBeLessThan(-19.3)
      }
    }
  })

  it('falls back to the lot-number label when no round-trip id was embedded (older export)', async () => {
    const feats = [
      { type: 'Feature' as const, properties: { kind: 'lot', id: 'Lot 7' }, geometry: makeLotPolygon(29.810, -19.450, 0.001, 0.0008) },
    ]
    exportFeaturesToDxf(feats, [], { fileName: 'legacy-export' })
    const dxfText = await capturedBlob!.text()
    const result = parseDxfToGeoJSON(dxfText, REF)
    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    expect(lots).toHaveLength(1)
    expect(lots[0].properties!.lotId).toBeUndefined()
    expect(lots[0].properties!.lotNumber).toBe('7')
  })

  it('imports lots even when no PARCEL-AREAS labels exist (annotateAreas: false)', async () => {
    const feats = [
      { type: 'Feature' as const, properties: { kind: 'lot', id: 'Lot 1' }, geometry: makeLotPolygon(29.810, -19.450, 0.001, 0.0008) },
    ]
    exportFeaturesToDxf(feats, [], { fileName: 'no-labels', annotateAreas: false })
    const dxfText = await capturedBlob!.text()
    const result = parseDxfToGeoJSON(dxfText, REF)
    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    expect(lots).toHaveLength(1)
    expect(lots[0].properties!.lotNumber).toBeUndefined()
  })
})

describe('parseDxfToGeoJSON — LWPOLYLINE (real AutoCAD/QGIS re-save shape)', () => {
  // dxfExport.ts never writes LWPOLYLINE (always legacy POLYLINE/VERTEX/SEQEND),
  // but AutoCAD and QGIS's DXF writer both default to LWPOLYLINE, so a file a
  // planner actually edited and re-saved will look like this, not like our own
  // export. This fixture is a minimal, hand-built, standards-conformant DXF
  // with a closed LWPOLYLINE on LOTS and one on ROADS (open).
  const LWPOLY_DXF = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'LOTS', '90', '4', '70', '1',
    '10', '311000.0', '20', '7847000.0',
    '10', '311100.0', '20', '7847000.0',
    '10', '311100.0', '20', '7847100.0',
    '10', '311000.0', '20', '7847100.0',
    '0', 'LWPOLYLINE', '8', 'ROADS', '90', '2', '70', '0',
    '10', '310990.0', '20', '7846990.0',
    '10', '311110.0', '20', '7846990.0',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n') + '\n'

  it('parses a closed LWPOLYLINE on LOTS and an open one on ROADS', () => {
    const result = parseDxfToGeoJSON(LWPOLY_DXF, REF)
    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    const roads = result.featureCollection.features.filter((f: any) => f.properties.layer === 'ROADS')
    expect(lots).toHaveLength(1)
    expect(roads).toHaveLength(1)
    // closed ring: first === last
    const ring = (lots[0].geometry as any).coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect((roads[0].geometry as any).coordinates).toHaveLength(2)
  })
})

describe('parseDxfToGeoJSON — error handling', () => {
  it('rejects an empty file', () => {
    expect(() => parseDxfToGeoJSON('', REF)).toThrow(/empty/i)
  })

  it('rejects malformed / non-DXF text', () => {
    expect(() => parseDxfToGeoJSON('this is not a dxf file at all', REF)).toThrow()
  })

  it('rejects a file with entities only on layers it does not recognise', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'CONSTRUCTION', '90', '2', '70', '0',
      '10', '311000.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847000.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n'
    expect(() => parseDxfToGeoJSON(dxf, REF)).toThrow(/nothing to import/i)
  })
})

describe('parseDxfToGeoJSON — includeOtherLayers (Planning Studio CAD import)', () => {
  it('promotes CAD road layers onto planning ROADS with hierarchy, and keeps other linework as CAD', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'CAD-ROADS', '90', '2', '70', '0',
      '10', '311000.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847000.0',
      '0', 'LWPOLYLINE', '8', 'ROADS-ARTERIAL', '90', '2', '70', '0',
      '10', '311000.0', '20', '7847100.0',
      '10', '311100.0', '20', '7847100.0',
      '0', 'LWPOLYLINE', '8', 'CAD-STANDS', '90', '4', '70', '1',
      '10', '311000.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847100.0',
      '10', '311000.0', '20', '7847100.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n'
    const result = parseDxfToGeoJSON(dxf, REF, { includeOtherLayers: true })
    expect(result.warnings).toEqual([])
    const roads = result.featureCollection.features.filter((f: any) => f.properties.layer === 'ROADS')
    const cad = result.featureCollection.features.filter((f: any) => f.properties.cad)
    expect(roads).toHaveLength(2)
    expect(roads.map((f: any) => f.properties.hierarchy).sort()).toEqual(['arterial', 'local'])
    expect(cad).toHaveLength(1)
    expect(cad[0].geometry.type).toBe('Polygon')
    expect(cad[0].properties.layer).toBe('CAD-STANDS')
  })

  it('still round-trips LOTS/ROADS when includeOtherLayers is on', async () => {
    const feats = [
      { type: 'Feature' as const, properties: { kind: 'lot', id: 'Lot 1', roundTripId: 'lot-aaa' }, geometry: makeLotPolygon(29.810, -19.450, 0.001, 0.0008) },
      { type: 'Feature' as const, properties: { kind: 'road', dxfLayer: 'ROADS-COLLECTOR' }, geometry: { type: 'LineString' as const, coordinates: [[29.809, -19.451], [29.817, -19.451]] } },
      { type: 'Feature' as const, properties: { kind: 'line', dxfLayer: 'CONSTRUCTION' }, geometry: { type: 'LineString' as const, coordinates: [[29.810, -19.452], [29.816, -19.452]] } },
    ]
    exportFeaturesToDxf(feats, [], { fileName: 'studio-mixed' })
    const dxfText = await capturedBlob!.text()
    const result = parseDxfToGeoJSON(dxfText, REF, { includeOtherLayers: true })
    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    const roads = result.featureCollection.features.filter((f: any) => f.properties.layer === 'ROADS')
    const cad = result.featureCollection.features.filter((f: any) => f.properties.cad)
    expect(lots).toHaveLength(1)
    expect(roads).toHaveLength(1)
    expect(roads[0].properties!.hierarchy).toBe('collector')
    expect(cad).toHaveLength(1)
    expect(cad[0].properties!.layer).toBe('CONSTRUCTION')
  })
})

describe('parseDxfToGeoJSON — VUNGU_* registry layers', () => {
  it('treats VUNGU_STANDS / VUNGU_ROADS as planning lots and roads', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'VUNGU_STANDS', '90', '4', '70', '1',
      '10', '311000.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847000.0',
      '10', '311100.0', '20', '7847100.0',
      '10', '311000.0', '20', '7847100.0',
      '0', 'LWPOLYLINE', '8', 'VUNGU_ROADS_COLLECTOR', '90', '2', '70', '0',
      '10', '310990.0', '20', '7846990.0',
      '10', '311110.0', '20', '7846990.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n'
    const result = parseDxfToGeoJSON(dxf, REF, { epsg: 'EPSG:32736' })
    const lots = result.featureCollection.features.filter((f: any) => f.properties.layer === 'LOTS')
    const roads = result.featureCollection.features.filter((f: any) => f.properties.layer === 'ROADS')
    expect(lots).toHaveLength(1)
    expect(roads).toHaveLength(1)
    expect(roads[0].properties!.hierarchy).toBe('collector')
    expect(result.epsg).toBe('EPSG:32736')
  })
})

describe('roadHierarchyFromDxfLayer', () => {
  it('maps common CAD road layer names onto the four reserve classes', () => {
    expect(roadHierarchyFromDxfLayer('ROADS')).toBe('local')
    expect(roadHierarchyFromDxfLayer('CAD-ROADS')).toBe('local')
    expect(roadHierarchyFromDxfLayer('ROADS-ARTERIAL')).toBe('arterial')
    expect(roadHierarchyFromDxfLayer('C-ROAD-COLLECTOR')).toBe('collector')
    expect(roadHierarchyFromDxfLayer('ACCESS')).toBe('access')
    expect(roadHierarchyFromDxfLayer('VUNGU_ROADS')).toBe('local')
    expect(roadHierarchyFromDxfLayer('VUNGU_ROADS_ARTERIAL')).toBe('arterial')
    expect(roadHierarchyFromDxfLayer('LINES')).toBeNull()
    expect(roadHierarchyFromDxfLayer('LOTS')).toBeNull()
  })
})
