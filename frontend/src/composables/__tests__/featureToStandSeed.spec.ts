import { describe, it, expect } from 'vitest'
import { featureToStandSeed } from '@/composables/featureToStandSeed'

describe('featureToStandSeed', () => {
  it('extracts stand, ward, description from common property keys', () => {
    const seed = featureToStandSeed({
      properties: { stand_number: '1234', ward: 'Ward 5', land_use: 'Residential' },
    })
    expect(seed.standNo).toBe('1234')
    expect(seed.ward).toBe('Ward 5')
    expect(seed.description).toBe('Residential')
  })

  it('falls back across alternative key spellings and coerces numbers', () => {
    const seed = featureToStandSeed({ properties: { erf_no: 88, suburb: 'Mkoba' } })
    expect(seed.standNo).toBe('88')
    expect(seed.ward).toBe('Mkoba')
  })

  it('parses a centroid from a "lng, lat" click coordinate string', () => {
    const seed = featureToStandSeed({ properties: {}, _clickCoord: '29.82, -19.45' })
    expect(seed.centroid).toEqual([29.82, -19.45])
  })

  it('prefers _center over _clickCoord for the centroid', () => {
    const seed = featureToStandSeed({ properties: {}, _center: [29.82, -19.45], _clickCoord: '0, 0' })
    expect(seed.centroid).toEqual([29.82, -19.45])
  })

  it('returns empty strings and no centroid for an empty/null feature', () => {
    expect(featureToStandSeed(null)).toEqual({
      standNo: '', ward: '', description: '', centroid: undefined,
    })
  })
})
