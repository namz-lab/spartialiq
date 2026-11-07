import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))
vi.mock('@/services/vectorTiles', () => ({ searchMap: vi.fn() }))
import api from '@/services/api'
import { searchMap } from '@/services/vectorTiles'
import {
  searchOrQuery, haversine, pathLength, ringArea, fmtDistance, fmtArea, parseAt, formatAt, citizenLayerGroups,
} from '../citizenMap'

const get = api.get as unknown as ReturnType<typeof vi.fn>
const search = searchMap as unknown as ReturnType<typeof vi.fn>

describe('searchOrQuery', () => {
  beforeEach(() => { get.mockReset(); search.mockReset() })

  it('uses name search for a plain name that matches', async () => {
    search.mockResolvedValue([{ type: 'ward', label: 'Ward 5', center: [29.5, -19.4] }])
    const out = await searchOrQuery('ward 5')
    expect(out.isQuery).toBe(false)
    expect(out.hits).toHaveLength(1)
    expect(get).not.toHaveBeenCalled()
  })

  it('sends questions straight to /map-query and drops hits without a usable centre', async () => {
    get.mockResolvedValue({ data: { message: '13 Clinics in Vungu', results: [
      { type: 'poi', label: 'A', center: [29.8, -19.4] },
      { type: 'poi', label: 'B', center: [0, 0] },
    ] } })
    const out = await searchOrQuery('how many clinics')
    expect(search).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith('/map-query', { params: { q: 'how many clinics' } })
    expect(out).toMatchObject({ isQuery: true, message: '13 Clinics in Vungu' })
    expect(out.hits.map(h => h.label)).toEqual(['A'])
  })

  it('falls back to /map-query when a name search finds nothing', async () => {
    search.mockResolvedValue([])
    get.mockResolvedValue({ data: { message: '4 available stands', results: [] } })
    expect((await searchOrQuery('available stands')).message).toBe('4 available stands')
  })

  it('reports an outage instead of throwing', async () => {
    search.mockResolvedValue([])
    get.mockRejectedValue(new Error('down'))
    expect((await searchOrQuery('schools')).message).toMatch(/not available/)
  })
})

describe('measuring', () => {
  it('measures about 111 km per degree of latitude', () => {
    expect(haversine([29.8, -19], [29.8, -20]) / 1000).toBeCloseTo(111.2, 0)
  })
  it('sums a path and closes a ring for area', () => {
    const sq: [number, number][] = [[29.8, -19.4], [29.801, -19.4], [29.801, -19.401], [29.8, -19.401]]
    expect(pathLength(sq)).toBeGreaterThan(300)
    expect(ringArea(sq.slice(0, 2))).toBe(0)
    // ~105 m × 111 m at this latitude
    expect(ringArea(sq)).toBeGreaterThan(11000)
    expect(ringArea(sq)).toBeLessThan(12500)
  })
})

describe('formatting and deep links', () => {
  it('formats distance and area at sensible units', () => {
    expect(fmtDistance(420)).toBe('420 m')
    expect(fmtDistance(2092)).toBe('2.1 km')
    expect(fmtDistance(23500)).toBe('24 km')
    expect(fmtArea(1200)).toBe('1,200 m²')
    expect(fmtArea(23521110)).toBe('2352.11 ha')
  })
  it('round-trips a map link and rejects junk', () => {
    const at = formatAt([29.7894, -19.4612], 16.4)
    expect(parseAt(at)).toEqual({ center: [29.7894, -19.4612], zoom: 16 })
    expect(parseAt('29.7,-19.4')).toEqual({ center: [29.7, -19.4], zoom: 16 })
    expect(parseAt('x,y')).toBeNull()
    expect(parseAt('200,10,5')).toBeNull()
    expect(parseAt(undefined)).toBeNull()
  })
  it('never offers the always-on country outline as a toggle', () => {
    const ids = citizenLayerGroups().flatMap(g => g.rows.flatMap(r => r.ids))
    expect(ids).not.toContain('country')
  })
})
