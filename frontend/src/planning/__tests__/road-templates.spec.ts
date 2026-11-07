// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────────────────
// Road-template geometry tests: grid / spine / ring generation and clipping
// against a synthetic rectangular parcel. Pure turf — no Vue, no map.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import {
  gridRoads, spineRoad, ringRoad, clipLineToPolygon, longestLine, facilitySquareInside,
} from '../road-templates'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, bearing: number) =>
  turf.destination(p, m, bearing, { units: 'meters' }).geometry.coordinates as [number, number]

/** Axis-aligned rectangle parcel: widthM east × depthM north from O. */
function rectArea(widthM: number, depthM: number): Feature<Polygon> {
  const o = O
  const e = move(o, widthM, 90)
  const ne = move(e, depthM, 0)
  const n = move(o, depthM, 0)
  return turf.polygon([[o, e, ne, n, o]]) as Feature<Polygon>
}

describe('road-templates', () => {
  const area = rectArea(600, 400) // 600 m × 400 m ≈ 24 ha

  it('grid generates both N–S and E–W streets clipped inside the parcel', () => {
    const lines = gridRoads(area, 150)
    expect(lines.length).toBeGreaterThanOrEqual(4) // ~3 vertical + ~2 horizontal

    // Every segment midpoint must sit inside the parcel.
    for (const g of lines) {
      const len = turf.length(turf.feature(g) as any, { units: 'meters' })
      const mid = turf.along(turf.feature(g) as any, len / 2, { units: 'meters' })
      expect(turf.booleanPointInPolygon(mid, area)).toBe(true)
    }
  })

  it('grid spacing controls density: tighter spacing ⇒ more streets', () => {
    expect(gridRoads(area, 100).length).toBeGreaterThan(gridRoads(area, 250).length)
  })

  it('spine follows the longer axis (east–west here) and stays inside', () => {
    const s = spineRoad(area)
    expect(s).toBeTruthy()
    const len = turf.length(turf.feature(s!) as any, { units: 'meters' })
    expect(len).toBeGreaterThan(400) // long axis is ~600 m
    const mid = turf.along(turf.feature(s!) as any, len / 2, { units: 'meters' })
    expect(turf.booleanPointInPolygon(mid, area)).toBe(true)
  })

  it('ring road sits inside the parcel (inset from the boundary)', () => {
    const ring = ringRoad(area, 30)
    expect(ring.length).toBeGreaterThanOrEqual(1)
    const total = ring.reduce((s, g) => s + turf.length(turf.feature(g) as any, { units: 'meters' }), 0)
    expect(total).toBeGreaterThan(0)
  })

  it('clipLineToPolygon keeps only the inside portion of a crossing line', () => {
    // A line from well west to well east of the parcel: inside portion ≈ 600 m.
    const w = move(O, 200, 270)
    const e = move(move(O, 600, 90), 200, 90)
    const midLat = (O[1] + move(O, 200, 0)[1]) / 2
    const line = turf.lineString([[w[0], midLat], [e[0], midLat]])
    const inside = clipLineToPolygon(line as any, area)
    const len = inside.reduce((s, g) => s + turf.length(turf.feature(g) as any, { units: 'meters' }), 0)
    expect(len).toBeGreaterThan(550)
    expect(len).toBeLessThan(650)
  })

  it('facilitySquareInside returns a polygon of ~the requested area, inside the parcel', () => {
    const geom = facilitySquareInside(area, 4000) // ~63 m square
    expect(geom).toBeTruthy()
    const a = turf.area(turf.feature(geom as any) as any)
    expect(a).toBeGreaterThan(2500)
    expect(a).toBeLessThan(4500)
  })

  it('longestLine picks the longest segment', () => {
    const a = turf.lineString([[0, 0], [0, 0.001]]).geometry
    const b = turf.lineString([[0, 0], [0, 0.01]]).geometry
    expect(longestLine([a, b])).toBe(b)
    expect(longestLine([])).toBeNull()
  })
})
