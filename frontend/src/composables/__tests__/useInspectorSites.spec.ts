import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/inspectorGis', () => ({
  inspectorGis: { sites: vi.fn() },
}))

import { inspectorGis } from '@/services/inspectorGis'
import { toMapSite, useInspectorSites } from '../useInspectorSites'

const props = (over: Record<string, unknown> = {}) => ({
  permitId: 'p1', ref: 'TPD/1', title: 'House', stand: '12', ward: '6', applicant: 'A',
  developmentType: 'new_building', permitStatus: 'approved', hasOccupationCertificate: false,
  precision: 'boundary', source: 'stands_register', siteLabel: '12', coarseArea: null,
  lastStage: null, lastResult: null, scheduledAt: null, inspectedAt: null, openEnforcement: 0,
  ...over,
})

describe('toMapSite', () => {
  it('exposes the resolved centre as lat/lng for a positioned site', () => {
    const s = toMapSite({ type: 'Feature', geometry: { type: 'Point', coordinates: [29.2, -19.2] }, properties: props() as never })
    expect(s.center).toEqual([29.2, -19.2])
    expect(s.lng).toBe(29.2)
    expect(s.lat).toBe(-19.2)
  })

  it('never places a farm-sized area on the map as if it were the site', () => {
    const s = toMapSite({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [29.7, -19.5] },
      properties: props({ precision: 'area', source: 'cadastre_area' }) as never,
    })
    expect(s.center).toBeNull()
    expect(s.lat).toBeNull()
  })
})

describe('useInspectorSites', () => {
  // Braces matter: a function returned from beforeEach runs as teardown.
  beforeEach(() => { vi.mocked(inspectorGis.sites).mockReset() })

  it('surfaces a load failure as an error, not an empty district', async () => {
    const err = Object.assign(new Error('Request failed with status code 500'), {
      response: { data: { message: 'Inspection sites could not be loaded.' } },
    })
    vi.mocked(inspectorGis.sites).mockImplementation(async () => { throw err })
    const s = useInspectorSites()
    await s.refresh()
    expect(s.error.value).toBe('Inspection sites could not be loaded.')
    expect(s.loading.value).toBe(false)
  })

  it('splits positioned and unpositioned sites and requests the chosen scope', async () => {
    vi.mocked(inspectorGis.sites).mockResolvedValue({
      points: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [29.2, -19.2] }, properties: props() as never },
          { type: 'Feature', geometry: null, properties: props({ permitId: 'p2', precision: 'none', source: 'none' }) as never },
        ],
      },
      boundaries: { type: 'FeatureCollection', features: [] },
      enforcement: { type: 'FeatureCollection', features: [] },
      unlocated: 1,
    })
    const s = useInspectorSites()
    s.scope.value = 'all'
    await s.refresh()
    expect(inspectorGis.sites).toHaveBeenCalledWith('all')
    expect(s.sites.value).toHaveLength(2)
    expect(s.unpositioned.value.map(x => x.permitId)).toEqual(['p2'])
    expect(s.inspectable.value).toHaveLength(2)
  })
})
