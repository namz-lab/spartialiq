// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────────────────
// CAD-3 Designate bridge — the clean engine entry points the Studio's
// designate() routes through: addFacilityReserve / addOpenSpace / addManualLot,
// plus a designated road feeding block generation at the chosen hierarchy.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import { usePlanningTools } from '../usePlanningTools'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) =>
  turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
function squareFeature(sizeM: number): Feature<Polygon> {
  const o = O, e = move(o, sizeM, 90), ne = move(e, sizeM, 0), n = move(o, sizeM, 0)
  return turf.polygon([[o, e, ne, n, o]]) as any
}
/** A smaller square polygon geometry anchored at the parcel SW corner. */
function squareGeom(sizeM: number): Polygon {
  const o = O, e = move(o, sizeM, 90), ne = move(e, sizeM, 0), n = move(o, sizeM, 0)
  return turf.polygon([[o, e, ne, n, o]]).geometry as Polygon
}

describe('addFacilityReserve', () => {
  it('adds a non-buildable facility constraint carrying the use + label', () => {
    const t = usePlanningTools()
    const c = t.addFacilityReserve(squareGeom(120), 'school')
    expect(t.constraints.value).toHaveLength(1)
    expect(c.kind).toBe('facility')
    expect(c.buildable).toBe(false)
    expect(c.facilityUse).toBe('school')
    expect(c.label).toBe('School')
  })

  it('counts as exclusion area (reduces net developable land)', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')
    const netBefore = t.metrics.value.netDevelopableAreaHa
    t.addFacilityReserve(squareGeom(150), 'health')
    expect(t.metrics.value.netDevelopableAreaHa).toBeLessThan(netBefore)
  })
})

describe('addOpenSpace', () => {
  it('adds park open space with a computed area and lifts open-space %', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')   // 400 m × 400 m = 16 ha
    expect(t.metrics.value.openSpacePct).toBe(0)
    const o = t.addOpenSpace(squareGeom(100), 'park')   // 100 m × 100 m = 1 ha
    expect(o.kind).toBe('park')
    expect(o.areaSqm).toBeGreaterThan(9000)
    expect(o.areaSqm).toBeLessThan(11000)
    expect(t.metrics.value.openSpacePct).toBeGreaterThan(5)   // ~6.25%
  })
})

describe('addManualLot', () => {
  it('adds a stand with a civic use, zero dwelling units, counted by area', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')
    const lot = t.addManualLot(squareGeom(80), { useType: 'school' })
    expect(t.lots.value).toHaveLength(1)
    expect(lot.useType).toBe('school')
    expect(lot.unitsPerLot).toBe(0)                       // civic → no dwellings
    expect(lot.areaSqm).toBeGreaterThan(5000)
    const m = t.metrics.value
    expect(m.areaByUseType.school).toBeGreaterThan(0)     // in the facility schedule
    expect(m.totalUnits).toBe(0)
  })

  it('defaults to a residential stand when no use is given', () => {
    const t = usePlanningTools()
    const lot = t.addManualLot(squareGeom(40))
    expect(lot.useType).toBeUndefined()                  // engine treats as single_residential
    expect(t.metrics.value.areaByUseType.single_residential).toBeGreaterThan(0)
  })
})

describe('designated items survive regeneration (no silent data loss)', () => {
  it('a designated open space is kept after runBlocks + runSubdivision', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')
    const os = t.addOpenSpace(squareGeom(100), 'park')
    t.runBlocks()
    expect(t.openSpace.value.some(o => o.id === os.id)).toBe(true)   // not wiped by runBlocks
    t.runSubdivision()
    expect(t.openSpace.value.some(o => o.id === os.id)).toBe(true)   // not wiped by runSubdivision
  })

  it('a designated stand is kept after runSubdivision and is not overlapped', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')
    const [minX, minY, maxX, maxY] = turf.bbox(t.planningArea.value!.geom as Polygon)
    t.addRoad(turf.lineString([[minX, (minY + maxY) / 2], [maxX, (minY + maxY) / 2]]).geometry as any, { hierarchy: 'local' })
    const stand = t.addManualLot(squareGeom(80), { useType: 'school' })
    t.runBlocks(); t.runSubdivision()

    // the manual stand is still present
    expect(t.lots.value.some(l => l.id === stand.id)).toBe(true)
    // no generated block overlaps the stand's centre (it was excluded from generation)
    const standCentre = turf.centroid(turf.polygon((stand.geom as any).coordinates))
    const overlapping = t.blocks.value.filter(b => {
      try { return turf.booleanPointInPolygon(standCentre, turf.polygon((b.geom as any).coordinates)) } catch { return false }
    })
    expect(overlapping.length).toBe(0)
  })
})

describe('designated road feeds subdivision', () => {
  it('a road added at a hierarchy gets that reserve width and produces blocks', () => {
    const t = usePlanningTools()
    t.selectParcel(squareFeature(400), 'Farm')
    const [minX, minY, maxX, maxY] = turf.bbox(t.planningArea.value!.geom as Polygon)
    const midY = (minY + maxY) / 2
    const road = turf.lineString([[minX, midY], [maxX, midY]]).geometry as any

    // mirror designate('road') with hierarchy 'collector'
    const r = t.addRoad(road, { hierarchy: 'collector' })
    expect(r.widthM).toBe(t.standards.roadReserveByHierarchy.collector)   // 20 m, from the table

    t.runBlocks()
    expect(t.blocks.value.length).toBeGreaterThan(0)
  })
})
