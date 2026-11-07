import { describe, it, expect } from 'vitest'
import { summariseSiteContext, exactStandMatch, type SiteContext } from '@/views/planner/siteAnalysis'
import { verdictFromDecision } from '@/views/planner/planningRules'

function ctx(over: Partial<SiteContext> = {}): SiteContext {
  return {
    parcel: { layer: 'vungu_parcels', fid: 12, name: 'Stand 1234', areaHa: 0.245, perimeterM: 200, centroid: [29.8, -19.5], boundary: null, complexity: 'normal', rawValid: true },
    developableHa: 0.22,
    roads: [{ fid: 1, name: 'Main Rd', fclass: 'primary', ref: null, lengthInParcelM: 40, entryPoints: [] }],
    water: { streams: [{ fid: 2, name: 'Stream', fclass: 'stream', lengthInParcelM: 12 }], waterAreas: [] },
    terrain: [],
    protected: [],
    landuse: [{ fclass: 'residential', areaHa: 0.24 }],
    buildings: { count: 2, totalAreaSqm: 180, avgFootprintSqm: 90 },
    settlements: [],
    amenities: { schools: [], health: [] },
    nogo: { type: 'Polygon', coordinates: [] },
    ...over,
  }
}

describe('summariseSiteContext', () => {
  it('converts hectares to square metres and lists constraints', () => {
    const s = summariseSiteContext(ctx())
    expect(s.areaSqm).toBe(2450)
    expect(s.landUse).toBe('residential')
    expect(s.constraints.some(c => /stream|water/i.test(c.label))).toBe(true)
    expect(s.constraints.some(c => /heritage/i.test(c.label) && c.ok)).toBe(true)
  })

  it('requires a traffic look when a primary road intersects the parcel', () => {
    const s = summariseSiteContext(ctx())
    expect(s.constraints.some(c => /traffic/i.test(c.label) && !c.ok)).toBe(true)
  })
})

describe('verdictFromDecision', () => {
  it('maps assistant decisions onto planner verdicts', () => {
    expect(verdictFromDecision('permitted').verdict).toBe('COMPLIANT')
    expect(verdictFromDecision('prohibited').verdict).toBe('NON-COMPLIANT')
    expect(verdictFromDecision('special_consent').verdict).toBe('PLANNER REVIEW REQUIRED')
    expect(verdictFromDecision('unknown').verdict).toBe('WARNING')
  })
})

describe('exactStandMatch', () => {
  const p = (stand_number: string, fid = 1) =>
    ({ fid, stand_number, status: null, district: null, area_ha: null, centroid: [29.7, -19.5] as [number, number], bbox: [0, 0, 0, 0] as [number, number, number, number] })

  it('places a case only on the stand it names', () => {
    expect(exactStandMatch([p('4521'), p('45210', 2)], '4521')?.fid).toBe(1)
    expect(exactStandMatch([p('Somabula')], 'Stand somabula ')?.stand_number).toBe('Somabula')
  })

  it('never guesses: partial or duplicate hits are refused', () => {
    expect(exactStandMatch([p('45210')], '4521')).toBeNull()
    expect(exactStandMatch([p('4521'), p('4521', 2)], '4521')).toBeNull()
    expect(exactStandMatch([p('4521')], '  ')).toBeNull()
  })
})
