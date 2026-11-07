import { describe, it, expect } from 'vitest'
import { arcThrough } from '../cadArc'

// A semicircle: start and end 100 m apart (E–W), "through" bulging north.
// Centre sits at the midpoint; every densified point should be ~equidistant
// from that centre (constant radius = the arc invariant).
describe('arcThrough', () => {
  const lng = 29.82, lat = -19.48
  // ~100 m east ≈ 0.000953° at this latitude; ~50 m north ≈ 0.000451°.
  const start: [number, number] = [lng, lat]
  const end: [number, number] = [lng + 0.000953, lat]
  const through: [number, number] = [lng + 0.000953 / 2, lat + 0.000451]

  it('densifies into a many-point LineString through the mid point', () => {
    const arc = arcThrough(start, through, end)
    expect(arc.type).toBe('LineString')
    expect(arc.coordinates.length).toBeGreaterThan(10)
    // exact endpoints are pinned
    expect(arc.coordinates[0]).toEqual(start)
    expect(arc.coordinates[arc.coordinates.length - 1]).toEqual(end)
  })

  it('keeps a near-constant radius (real circular arc, not a kink)', () => {
    const arc = arcThrough(start, through, end)
    // crude planar metre scale at this latitude
    const mPerDegLat = 111_320
    const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180)
    const toM = (c: number[]): [number, number] => [(c[0] - lng) * mPerDegLng, (c[1] - lat) * mPerDegLat]
    const pts = arc.coordinates.map(toM)
    // centre ≈ midpoint of chord (semicircle) — estimate from first/last
    const cx = (pts[0][0] + pts[pts.length - 1][0]) / 2
    const cy = (pts[0][1] + pts[pts.length - 1][1]) / 2
    const radii = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy))
    const rMax = Math.max(...radii), rMin = Math.min(...radii)
    expect(rMax - rMin).toBeLessThan(2) // within 2 m across the whole arc
  })

  it('degrades to a 3-point polyline for collinear input', () => {
    const arc = arcThrough([lng, lat], [lng + 0.001, lat], [lng + 0.002, lat])
    expect(arc.coordinates.length).toBe(3)
  })
})
