import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))
import api from '../api'
import { locateStand } from '../parcels'

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

describe('locateStand', () => {
  beforeEach(() => mockGet.mockReset())

  it('unwraps the {success,data} envelope', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: {
      in_jurisdiction: true, district: 'Gweru', authority: { name: 'Vungu Rural District Council' },
      stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands',
        area_ha: 12.3, centroid: [29.39, -19.29], ward: '6', district: 'Gweru',
        description: 'Parcel Communal Land, Gweru — 12.3 ha' },
    } } })
    const res = await locateStand(29.39, -19.29)
    expect(mockGet).toHaveBeenCalledWith('/parcels/locate', { params: { lng: 29.39, lat: -19.29 } })
    expect(res.in_jurisdiction).toBe(true)
    expect(res.stand?.stand_number).toBe('Communal Land')
  })

  it('returns an out-of-jurisdiction bundle', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: {
      in_jurisdiction: false, district: 'Harare', authority: null, stand: null,
    } } })
    const res = await locateStand(31.05, -17.83)
    expect(res.in_jurisdiction).toBe(false)
    expect(res.district).toBe('Harare')
    expect(res.stand).toBeNull()
  })
})
