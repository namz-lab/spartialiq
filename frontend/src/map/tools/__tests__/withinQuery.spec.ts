// The notification-radius query is a statutory artefact (the abutting owners an
// officer must write to), so the two things that can quietly corrupt it are
// checked here: the radius the server is asked for, and the CSV that leaves the
// building.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
vi.mock('@/services/api', () => ({ default: { get: (...a: any[]) => get(...a) } }))

import { clampRadius, parcelsWithin, withinCsv, MAX_RADIUS_M } from '../withinQuery'

describe('clampRadius', () => {
  it('keeps the server range and falls back to 100 m on nonsense', () => {
    expect(clampRadius(250)).toBe(250)
    expect(clampRadius(0)).toBe(1)
    expect(clampRadius(99999)).toBe(MAX_RADIUS_M)
    expect(clampRadius('abc')).toBe(100)
  })
})

// The failure path is a bare await on api.get — nothing here to break — so it
// is left to the callers, which each decide between fallback and error.
describe('parcelsWithin', () => {
  beforeEach(() => get.mockReset())

  it('asks the cadastre endpoint and normalises the rows', async () => {
    get.mockResolvedValue({
      data: {
        success: true, radius_m: 100, count: 2,
        parcels: [
          { label: 'Lot 3 of Vungu', district: 'Vungu', area_ha: '1.25', distance_m: 12.7 },
          { label: 'Parcel 88', district: null, area_ha: null, distance_m: 98 },
        ],
      },
    })
    const r = await parcelsWithin(29.81, -19.45, 100)
    expect(get).toHaveBeenCalledWith('/gis/within', { params: { lng: 29.81, lat: -19.45, radius: 100 } })
    expect(r.count).toBe(2)
    expect(r.authoritative).toBe(true)
    expect(r.parcels[0]).toEqual({ label: 'Lot 3 of Vungu', district: 'Vungu', areaHa: 1.25, distanceM: 13 })
    expect(r.parcels[1].areaHa).toBeNull()
  })

})

describe('withinCsv', () => {
  it('quotes separators and states how the figures were obtained', () => {
    const csv = withinCsv([29.81, -19.45], {
      radiusM: 100, count: 1, authoritative: true,
      parcels: [{ label: 'Lot 3, Vungu', district: 'Vungu', areaHa: 1.25, distanceM: 13 }],
    })
    const lines = csv.split('\n')
    expect(lines[0]).toContain('within 100 m of -19.450000, 29.810000')
    expect(lines[1]).toContain('cadastre (ST_DWithin)')
    expect(lines[3]).toBe('label,district,area_ha,distance_m')
    expect(lines[4]).toBe('"Lot 3, Vungu",Vungu,1.2500,13')
  })
})
