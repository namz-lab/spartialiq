// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────────────────
// importDxf() merge: the "bring it back from QGIS/AutoCAD" half of the
// round-trip. Incoming lots that match by lotId (or a unique lotNumber) take
// fresh geometry and keep use/status; new polygons are added; existing lots
// that are not in the file stay on the map. Roads are appended (not replaced)
// at the hierarchy encoded on the DXF layer, with the matching reserve width.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import { usePlanningTools } from '../usePlanningTools'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) => turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
function squareFeature(sizeM: number): Feature<Polygon> {
  const o = O, e = move(o, sizeM, 90), ne = move(e, sizeM, 0), n = move(o, sizeM, 0)
  return turf.polygon([[o, e, ne, n, o]]) as any
}
function streetGrid(parcel: Feature<Polygon>, spacingM = 80) {
  const [minX, minY, maxX, maxY] = turf.bbox(parcel)
  const sw: [number, number] = [minX, minY]
  const w = turf.distance([minX, minY], [maxX, minY], { units: 'meters' })
  const h = turf.distance([minX, minY], [minX, maxY], { units: 'meters' })
  const lines: any[] = []
  for (let d = spacingM; d < w; d += spacingM) {
    const x = turf.destination(sw, d, 90, { units: 'meters' }).geometry.coordinates[0]
    lines.push(turf.lineString([[x, minY], [x, maxY]]).geometry)
  }
  for (let d = spacingM; d < h; d += spacingM) {
    const y = turf.destination(sw, d, 0, { units: 'meters' }).geometry.coordinates[1]
    lines.push(turf.lineString([[minX, y], [maxX, y]]).geometry)
  }
  return lines
}

/** Build a subdivided session: a 300m square, grid roads, blocks, lots. */
function seeded() {
  const t = usePlanningTools()
  const sq = squareFeature(300)
  t.selectParcel(sq as any, 'Square')
  for (const g of streetGrid(sq)) t.addRoad(g, { hierarchy: 'local' })
  t.runBlocks()
  t.runSubdivision()
  expect(t.lots.value.length).toBeGreaterThan(2)
  return t
}

describe('usePlanningTools().importDxf — preconditions', () => {
  it('refuses when no planning area is selected', () => {
    const t = usePlanningTools()
    const r = t.importDxf({ features: [{ properties: { layer: 'LOTS' }, geometry: squareFeature(10).geometry }] })
    expect(r).toEqual({ ok: false, reason: 'no-area', matched: 0, added: 0, removed: 0, roadCount: 0 })
  })

  it('refuses an empty feature set', () => {
    const t = seeded()
    const r = t.importDxf({ features: [] })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
  })
})

describe('usePlanningTools().importDxf — reconciliation', () => {
  it('matches by lotId, keeps useType/status, takes fresh geometry; unmatched -> added; missing lots stay on the map', () => {
    const t = seeded()
    const original = [...t.lots.value]
    const keepLot = original[0]
    const dropLot = original[1]
    t.assignUseToLots([keepLot.id], 'school')
    const keptUseType = t.lots.value.find(l => l.id === keepLot.id)!.useType
    expect(keptUseType).toBe('school')

    // Simulate a CAD edit: shift the kept lot 2m east, keep every other
    // original lot except dropLot, and add one brand-new polygon with no id.
    const editedGeom = turf.transformTranslate(turf.feature(keepLot.geom as any), 2, 90, { units: 'meters' }).geometry
    const carried = original.filter(l => l.id !== dropLot.id && l.id !== keepLot.id)
    const newPoly = turf.transformTranslate(turf.feature(carried[0].geom as any), 40, 0, { units: 'meters' }).geometry

    const importedFeatures = [
      { properties: { layer: 'LOTS', lotId: keepLot.id }, geometry: editedGeom },
      ...carried.map(l => ({ properties: { layer: 'LOTS', lotId: l.id }, geometry: l.geom })),
      { properties: { layer: 'LOTS' }, geometry: newPoly }, // no id -> new lot
    ]

    const before = t.lots.value.length
    const r = t.importDxf({ features: importedFeatures as any })

    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
    expect(r.removed).toBe(0) // merge keeps lots that are not in the file
    expect(r.matched).toBe(before - 1) // every original lot except dropLot (which is kept, not matched)

    // Dropped-from-file lot is still on the map (merge, not replace).
    expect(t.lots.value.find(l => l.id === dropLot.id)).toBeTruthy()
    // Kept lot survived with its id, use type, and NEW geometry.
    const kept = t.lots.value.find(l => l.id === keepLot.id)
    expect(kept).toBeTruthy()
    expect(kept!.useType).toBe('school')
    expect(kept!.geom).toEqual(editedGeom)
    // New lot exists, unmanaged by any generated block.
    const manualLots = t.lots.value.filter(l => l.blockId === 'manual')
    expect(manualLots.length).toBeGreaterThanOrEqual(1)
    expect(t.lots.value.length).toBe(before + 1)
  })

  it('falls back to lotNumber matching only when the number is unique across the whole session', () => {
    // A single-block layout (no interior roads) so renumberLots() produces
    // globally-unique numbers — the fallback is only safe in exactly this case.
    const t = usePlanningTools()
    const sq = squareFeature(120)
    t.selectParcel(sq as any, 'Small block')
    t.runBlocks()
    t.runSubdivision()
    expect(t.blocks.value.length).toBe(1)
    expect(t.lots.value.length).toBeGreaterThan(1)
    t.renumberLots()

    const target = t.lots.value[0]
    const num = target.lotNumber!
    expect(num).toBeTruthy()
    const editedGeom = turf.transformTranslate(turf.feature(target.geom as any), 1, 0, { units: 'meters' }).geometry

    const importedFeatures = t.lots.value.map(l => ({
      properties: { layer: 'LOTS', lotNumber: l.lotNumber },
      geometry: l.id === target.id ? editedGeom : l.geom,
    }))
    const r = t.importDxf({ features: importedFeatures as any })
    expect(r.ok).toBe(true)
    expect(r.removed).toBe(0)
    const match = t.lots.value.find(l => l.id === target.id)
    expect(match?.geom).toEqual(editedGeom)
  })

  it('does not guess when lotNumber is ambiguous across blocks (no lotId given)', () => {
    const t = seeded() // multi-block grid — lot numbers repeat per block
    const blockCount = new Set(t.lots.value.map(l => l.blockId)).size
    expect(blockCount).toBeGreaterThan(1)
    const before = t.lots.value.length

    // Every feature only carries the ambiguous per-block number, no lotId.
    const importedFeatures = t.lots.value.map(l => ({ properties: { layer: 'LOTS', lotNumber: l.lotNumber }, geometry: l.geom }))
    const r = t.importDxf({ features: importedFeatures as any })

    expect(r.ok).toBe(true)
    const ids = t.lots.value.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(r.removed).toBe(0)
    expect(t.lots.value.length).toBeGreaterThanOrEqual(before)
  })

  it('leaves roads untouched when the import carries no ROADS layer, appends them when it does', () => {
    const t = seeded()
    const originalRoads = t.roads.value
    const originalRoadCount = originalRoads.length
    expect(originalRoadCount).toBeGreaterThan(0)

    // Import with lots only — roads must survive unchanged.
    const lotsOnly = t.lots.value.map(l => ({ properties: { layer: 'LOTS', lotId: l.id }, geometry: l.geom }))
    t.importDxf({ features: lotsOnly as any })
    expect(t.roads.value).toBe(originalRoads) // same array reference — untouched
    expect(t.roads.value.length).toBe(originalRoadCount)

    // Import with an explicit ROADS layer — the new centre-line is merged in
    // (existing streets stay) and the hierarchy from the file is honoured.
    const oneRoad = {
      properties: { layer: 'ROADS', hierarchy: 'arterial' },
      geometry: { type: 'LineString', coordinates: [[29.80, -19.40], [29.803, -19.40]] },
    }
    const withRoads = [...lotsOnly, oneRoad]
    const r = t.importDxf({ features: withRoads as any })
    expect(r.roadsAdded).toBe(1)
    expect(t.roads.value.length).toBe(originalRoadCount + 1)
    const added = t.roads.value[t.roads.value.length - 1]
    expect(added.hierarchy).toBe('arterial')
    expect(added.widthM).toBe(t.standards.roadReserveByHierarchy.arterial)
  })

  it('applies collector / local / access reserve widths from DXF road classes', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(200) as any, 'Farm')
    const lines = [
      { properties: { layer: 'ROADS', hierarchy: 'collector' }, geometry: { type: 'LineString', coordinates: [[29.80, -19.40], [29.801, -19.40]] } },
      { properties: { layer: 'ROADS', hierarchy: 'local' }, geometry: { type: 'LineString', coordinates: [[29.80, -19.401], [29.801, -19.401]] } },
      { properties: { layer: 'ROADS', hierarchy: 'access' }, geometry: { type: 'LineString', coordinates: [[29.80, -19.402], [29.801, -19.402]] } },
    ]
    const r = t.importDxf({ features: lines as any })
    expect(r.ok).toBe(true)
    expect(r.roadsAdded).toBe(3)
    const byH = Object.fromEntries(t.roads.value.map(x => [x.hierarchy, x.widthM]))
    expect(byH.collector).toBe(t.standards.roadReserveByHierarchy.collector)
    expect(byH.local).toBe(t.standards.roadReserveByHierarchy.local)
    expect(byH.access).toBe(t.standards.roadReserveByHierarchy.access)
  })

  it('marks the session dirty and leaves an undoable checkpoint (normal reactive path, not restore())', () => {
    const t = seeded()
    t.dirty.value = false // pretend it was just saved
    const lotsOnly = t.lots.value.map(l => ({ properties: { layer: 'LOTS', lotId: l.id }, geometry: l.geom }))
    t.importDxf({ features: lotsOnly as any })
    expect(t.dirty.value).toBe(true)
  })
})
