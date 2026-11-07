// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────────────────
// V1.0 Planning Studio foundation tests: civic land uses + facility schedule,
// reserve-first facility exclusion, undo/redo restore round-trip, lot-fill colour
// coverage (missing-colour guard), and vertex snapping.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usePlanningTools } from '../usePlanningTools'
import { generateBlocks } from '../block-generation'
import { useStudioSnapping } from '../useStudioSnapping'
import { LOT_FILL_BY_USE } from '../planning-layers'
import type { ConstraintLayer, LotUseType } from '../planning-types'

vi.setConfig({ testTimeout: 60000 })

const farm = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/planning/__tests__/farm.geojson'), 'utf8'),
) as Feature

const ALL_USES: LotUseType[] = [
  'single_residential', 'duplex', 'townhouse', 'mixed_use', 'open_space',
  'school', 'health', 'community_centre', 'place_of_worship', 'commercial', 'recreation',
]

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) =>
  turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
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

describe('lot-fill colour coverage (missing-colour guard)', () => {
  it('LOT_FILL_BY_USE has a colour for every LotUseType', () => {
    const json = JSON.stringify(LOT_FILL_BY_USE)
    for (const u of ALL_USES) expect(json).toContain(u)
  })
})

describe('civic land uses + facility schedule', () => {
  it('assigning a civic use adds area but zero dwelling units', () => {
    const t = usePlanningTools()
    t.selectParcel(farm, 'Farm')
    t.applyZone('residential_medium')
    t.rules.seed = 'studio-civic'
    for (const g of streetGrid(turf.feature(t.planningArea.value!.geom as Polygon) as any)) t.addRoad(g, { hierarchy: 'local' })
    t.runBlocks(); t.runSubdivision()
    expect(t.lots.value.length).toBeGreaterThan(0)

    t.assignUseToAll('school')
    const m = t.metrics.value
    expect(m.areaByUseType.school).toBeGreaterThan(0)   // counted by area
    expect(m.totalUnits).toBe(0)                         // 0 dwelling units
  })
})

describe('reserve-first facility (engine avoids the reserved site)', () => {
  it('generateBlocks excludes a kind:"facility" non-buildable area', () => {
    const parcel = squareFeature(400)
    const [minX, minY, maxX, maxY] = turf.bbox(parcel)
    const road = turf.lineString([[minX, (minY + maxY) / 2], [maxX, (minY + maxY) / 2]]).geometry
    // reserve a square in the lower-left quadrant
    const rO = O, rE = move(rO, 120, 90), rNE = move(rE, 120, 0), rN = move(rO, 120, 0)
    const reservePoly = turf.polygon([[rO, rE, rNE, rN, rO]])
    const facility: ConstraintLayer = {
      id: 'f1', kind: 'facility', label: 'School', geom: reservePoly.geometry as any,
      buildable: false, facilityUse: 'school',
    }
    const blocks = generateBlocks(parcel as any, [{ id: 'r1', geom: road, type: 'street', hierarchy: 'local', widthM: 12 } as any], [facility])
    const reserveCentre = turf.centroid(reservePoly)
    const overlaps = blocks.filter(b => {
      try { return turf.booleanPointInPolygon(reserveCentre, turf.polygon((b.geom as any).coordinates)) } catch { return false }
    })
    expect(overlaps.length).toBe(0)
    expect(blocks.length).toBeGreaterThan(0)             // rest of the parcel still blocks
  })
})

describe('undo/redo restore round-trip', () => {
  it('restore returns to a prior snapshot', () => {
    const t = usePlanningTools()
    t.selectParcel(farm, 'Farm')
    const before = JSON.parse(JSON.stringify(t.snapshot()))
    const roadCountBefore = t.roads.value.length
    t.addRoad(turf.lineString([[29.80, -19.40], [29.83, -19.40]]).geometry as any, { hierarchy: 'local' })
    expect(t.roads.value.length).toBe(roadCountBefore + 1)
    t.restore(before)
    expect(t.roads.value.length).toBe(roadCountBefore)
  })
})

describe('vertex snapping', () => {
  it('snaps a click to a nearby planning-area corner', () => {
    const t = usePlanningTools()
    const sq = squareFeature(300)
    t.selectParcel(sq as any, 'Square')
    // fake map: project lng/lat → screen with a simple linear transform
    const fakeMap = { project: (c: number[]) => ({ x: c[0] * 100000, y: c[1] * 100000 }) }
    const snapping = useStudioSnapping(() => fakeMap as any, t)
    const corner = (sq.geometry as any).coordinates[0][0] as [number, number]  // O
    const screen = { x: corner[0] * 100000 + 4, y: corner[1] * 100000 - 3 }    // within SNAP_PX
    const snapped = snapping.snap([corner[0] + 0.001, corner[1] + 0.001], screen)
    expect(snapped[0]).toBeCloseTo(corner[0], 6)
    expect(snapped[1]).toBeCloseTo(corner[1], 6)
  })
})
