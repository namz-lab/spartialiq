import { describe, it, expect } from 'vitest'
import { trackFor, DEVELOPMENT_TRACKS } from '@/views/planner/developmentTracks'

describe('developmentTracks — approval track per application type', () => {
  it('falls back to the "other" track for unknown / empty types', () => {
    expect(trackFor('nonsense').type).toBe('other')
    expect(trackFor(null).type).toBe('other')
    expect(trackFor(undefined).type).toBe('other')
  })

  it('new building requires building drawings on top of the common submittals', () => {
    const t = trackFor('new_building')
    const keys = t.submittals.map(s => s.key)
    expect(keys).toContain('tpd1')          // common
    expect(keys).toContain('architectural') // building-specific
    expect(t.statutoryDays).toBe(30)
    expect(t.hearingRequired).toBe(false)
  })

  it('rezoning, subdivision and change-of-use need a hearing on the 90-day track', () => {
    for (const type of ['rezoning', 'subdivision', 'change_of_use'] as const) {
      const t = trackFor(type)
      expect(t.hearingRequired).toBe(true)
      expect(t.statutoryDays).toBe(90)
    }
  })

  it('subdivision requires the surveyor and a survey diagram', () => {
    const t = trackFor('subdivision')
    expect(t.referrals).toContain('Surveyor')
    expect(t.submittals.map(s => s.key)).toContain('survey_diagram')
  })

  it('every track circulates to at least one department', () => {
    for (const t of Object.values(DEVELOPMENT_TRACKS)) {
      expect(t.referrals.length).toBeGreaterThan(0)
    }
  })
})
