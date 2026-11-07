import { describe, it, expect } from 'vitest'
import { snapCoord, snapGeometry } from '../snap'

// 1 unit = 1 px, so tolerances read as pixels.
const project = (c: [number, number]) => c

describe('snapping', () => {
  const road: GeoJSON.LineString = { type: 'LineString', coordinates: [[0, 0], [100, 0]] }

  it('prefers a vertex in range over the edge', () => {
    expect(snapCoord([97, 3], [road], project, 10)).toEqual([100, 0])
  })

  it('falls back to the nearest point on an edge, exactly on it', () => {
    const p = snapCoord([40, 4], [road], project, 10)
    expect(p).toEqual([40, 0])
  })

  it('leaves coordinates alone when nothing is in range', () => {
    expect(snapCoord([40, 30], [road], project, 10)).toEqual([40, 30])
  })

  it('snaps a new road end onto the existing road (the "meet at nodes" rule)', () => {
    const stub: GeoJSON.LineString = { type: 'LineString', coordinates: [[50, 60], [50, 3]] }
    const out = snapGeometry(stub, [road], project) as GeoJSON.LineString
    expect(out.coordinates).toEqual([[50, 60], [50, 0]])
  })
})
