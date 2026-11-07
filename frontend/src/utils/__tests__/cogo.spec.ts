import { describe, it, expect } from 'vitest'
import {
  joinYX, polarYX, dmsToDeg, degToDms, normalizeDeg,
  shoelaceAreaYX, traverseBowditch,
} from '../cogo'

describe('normalizeDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(-90)).toBe(270)
    expect(normalizeDeg(725)).toBe(5)
  })
})

describe('joinYX / polarYX (south-azimuth P(Y,X) frame)', () => {
  it('join due South is bearing 0', () => {
    const r = joinYX({ y: 0, x: 0 }, { y: 0, x: 100 })
    expect(r.bearingDeg).toBeCloseTo(0, 9)
    expect(r.distance).toBeCloseTo(100, 9)
  })

  it('join due West is bearing 90', () => {
    const r = joinYX({ y: 0, x: 0 }, { y: 100, x: 0 })
    expect(r.bearingDeg).toBeCloseTo(90, 9)
  })

  it('join due North is bearing 180', () => {
    const r = joinYX({ y: 0, x: 0 }, { y: 0, x: -100 })
    expect(r.bearingDeg).toBeCloseTo(180, 9)
  })

  it('polar is the exact inverse of join', () => {
    const from = { y: 12345.678, x: 98765.432 }
    const to = { y: 12401.221, x: 98700.005 }
    const j = joinYX(from, to)
    const p = polarYX(from, j.bearingDeg, j.distance)
    expect(p.y).toBeCloseTo(to.y, 6)
    expect(p.x).toBeCloseTo(to.x, 6)
  })

  it('45° diagonal splits displacement equally', () => {
    const p = polarYX({ y: 0, x: 0 }, 45, Math.SQRT2)
    expect(p.y).toBeCloseTo(1, 9)
    expect(p.x).toBeCloseTo(1, 9)
  })
})

describe('dmsToDeg', () => {
  it('parses symbol form', () => {
    expect(dmsToDeg(`123°45'30"`)).toBeCloseTo(123 + 45 / 60 + 30 / 3600, 9)
  })
  it('parses space-separated form', () => {
    expect(dmsToDeg('123 45 30')).toBeCloseTo(123.758333333, 6)
  })
  it('takes a bare decimal at face value', () => {
    expect(dmsToDeg('123.4530')).toBeCloseTo(123.4530, 9)
  })
  it('parses degrees and decimal minutes', () => {
    expect(dmsToDeg(`10°30.5'`)).toBeCloseTo(10 + 30.5 / 60, 9)
  })
  it('rejects minutes/seconds ≥ 60', () => {
    expect(Number.isNaN(dmsToDeg('12°61\'00"'))).toBe(true)
    expect(Number.isNaN(dmsToDeg('12°00\'75"'))).toBe(true)
  })
  it('rejects garbage', () => {
    expect(Number.isNaN(dmsToDeg('north-ish'))).toBe(true)
    expect(Number.isNaN(dmsToDeg(''))).toBe(true)
  })
})

describe('degToDms', () => {
  it('formats a plain value', () => {
    expect(degToDms(123 + 45 / 60 + 30 / 3600)).toBe(`123°45'30.0"`)
  })
  it('handles the 59.95s rollover without printing 60"', () => {
    expect(degToDms(29.999999)).toBe(`30°00'00.0"`)
  })
  it('round-trips through dmsToDeg', () => {
    const deg = 217.6042
    expect(dmsToDeg(degToDms(deg, 3))).toBeCloseTo(deg, 5)
  })
})

describe('shoelaceAreaYX', () => {
  it('computes a unit square', () => {
    const r = shoelaceAreaYX([
      { y: 0, x: 0 }, { y: 100, x: 0 }, { y: 100, x: 100 }, { y: 0, x: 100 },
    ])
    expect(r.areaM2).toBeCloseTo(10000, 6)
    expect(r.perimeterM).toBeCloseTo(400, 6)
  })
  it('is orientation-independent', () => {
    const cw = shoelaceAreaYX([
      { y: 0, x: 0 }, { y: 0, x: 100 }, { y: 100, x: 100 }, { y: 100, x: 0 },
    ])
    expect(cw.areaM2).toBeCloseTo(10000, 6)
  })
  it('returns zeros for degenerate input', () => {
    expect(shoelaceAreaYX([{ y: 0, x: 0 }, { y: 1, x: 1 }])).toEqual({ areaM2: 0, perimeterM: 0 })
  })
})

describe('traverseBowditch', () => {
  it('a perfect closed square closes exactly', () => {
    const r = traverseBowditch({ y: 0, x: 0 }, [
      { bearingDeg: 0, distance: 100 },
      { bearingDeg: 90, distance: 100 },
      { bearingDeg: 180, distance: 100 },
      { bearingDeg: 270, distance: 100 },
    ])
    expect(r.misclosure.linear).toBeCloseTo(0, 6)
    expect(r.misclosure.ratioFormatted).toBe('exact')
    const last = r.adjusted[r.adjusted.length - 1]
    expect(last.y).toBeCloseTo(0, 6)
    expect(last.x).toBeCloseTo(0, 6)
  })

  it('distributes a small misclosure by cumulative distance', () => {
    // Same square but the last leg is 0.4 m short → misclosure 0.4 due North(ish).
    const r = traverseBowditch({ y: 0, x: 0 }, [
      { bearingDeg: 0, distance: 100 },
      { bearingDeg: 90, distance: 100 },
      { bearingDeg: 180, distance: 100 },
      { bearingDeg: 270, distance: 99.6 },
    ])
    expect(r.misclosure.linear).toBeCloseTo(0.4, 6)
    // Total = 399.6; precision ≈ 1:999
    expect(r.misclosure.ratio).toBeCloseTo(399.6 / 0.4, 3)
    // The adjusted final station must land exactly on the start.
    const last = r.adjusted[r.adjusted.length - 1]
    expect(last.y).toBeCloseTo(0, 9)
    expect(last.x).toBeCloseTo(0, 9)
    // Start point never moves.
    expect(r.adjusted[0]).toEqual({ index: 0, y: 0, x: 0 })
    // Station 1 gets 100/399.6 of the correction.
    const f = 100 / 399.6
    expect(r.adjusted[1].x).toBeCloseTo(r.stations[1].x + r.misclosure.dX * f, 9)
  })

  it('supports link traverses onto a known closing point', () => {
    const r = traverseBowditch(
      { y: 1000, x: 2000 },
      [{ bearingDeg: 45, distance: 141.4213562 }],
      { y: 1100.05, x: 2100 }, // known point 5 cm off the computed one
    )
    expect(r.misclosure.linear).toBeCloseTo(0.05, 3)
    const last = r.adjusted[r.adjusted.length - 1]
    expect(last.y).toBeCloseTo(1100.05, 6)
    expect(last.x).toBeCloseTo(2100, 6)
  })
})
