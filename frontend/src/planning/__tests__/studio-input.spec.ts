import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { parseDynamic, snapAngle, constrainBearing, resolveDynamic, gridSnap } from '../useStudioInput'

describe('parseDynamic', () => {
  it('length only', () => { expect(parseDynamic('40')).toEqual({ lengthM: 40, bearingDeg: undefined }) })
  it('length + bearing (comma / < / space)', () => {
    expect(parseDynamic('40,90')).toEqual({ lengthM: 40, bearingDeg: 90 })
    expect(parseDynamic('@40<90')).toEqual({ lengthM: 40, bearingDeg: 90 })
    expect(parseDynamic('40 270')).toEqual({ lengthM: 40, bearingDeg: 270 })
  })
  it('rejects junk / zero', () => {
    expect(parseDynamic('')).toBeNull()
    expect(parseDynamic('abc')).toBeNull()
    expect(parseDynamic('0')).toBeNull()
  })
})

describe('snapAngle', () => {
  it('ortho', () => { expect(snapAngle(87, 90)).toBe(90); expect(snapAngle(44, 90)).toBe(0) })
  it('polar 15°', () => { expect(snapAngle(20, 15)).toBe(15); expect(snapAngle(23, 15)).toBe(30) })
})

describe('constrainBearing (ortho makes a square corner)', () => {
  const from: [number, number] = [29.82, -19.48]
  it('snaps a near-east cursor to due east, keeping distance', () => {
    // ~50 m east, ~3 m north — should collapse to due east (bearing 90)
    const to = turf.destination(from, 0.05, 87, { units: 'kilometers' }).geometry.coordinates as [number, number]
    const c = constrainBearing(from, to, { ortho: true, polar: false, stepDeg: 15 })
    expect(turf.bearing(from, c)).toBeCloseTo(90, 0)
    expect(turf.distance(from, c, { units: 'meters' })).toBeCloseTo(50, 0)
  })
  it('passes through unchanged with no constraint', () => {
    const to: [number, number] = [29.821, -19.4805]
    expect(constrainBearing(from, to, { ortho: false, polar: false, stepDeg: 15 })).toBe(to)
  })
})

describe('resolveDynamic', () => {
  const from: [number, number] = [29.82, -19.48]
  it('places an exact 40 m point due east from a typed bearing', () => {
    const p = resolveDynamic(from, [29.83, -19.48], { lengthM: 40, bearingDeg: 90 })
    expect(turf.distance(from, p, { units: 'meters' })).toBeCloseTo(40, 1)
    expect(turf.bearing(from, p)).toBeCloseTo(90, 0)
  })
})

describe('gridSnap', () => {
  const ref: [number, number] = [29.82, -19.48]
  it('rounds a point onto a 5 m grid', () => {
    // 12 m east, 8 m north → nearest 5 m grid = 10 m east, 10 m north
    const east12 = turf.destination(ref, 0.012, 90, { units: 'kilometers' }).geometry.coordinates as [number, number]
    const north8 = turf.destination(ref, 0.008, 0, { units: 'kilometers' }).geometry.coordinates as [number, number]
    const p = gridSnap([east12[0], north8[1]], ref, 5)
    const mPerDegLat = 111_320, mPerDegLng = 111_320 * Math.cos((ref[1] * Math.PI) / 180)
    expect((p[0] - ref[0]) * mPerDegLng).toBeCloseTo(10, 0)
    expect((p[1] - ref[1]) * mPerDegLat).toBeCloseTo(10, 0)
  })
})
