import { describe, it, expect } from 'vitest'
import {
  readSection, sectionQuery, parsePreferences, isOverdue, daysUntil, humanise,
  DEFAULT_EHO_PREFERENCES, FALLBACK_SECTION, wardLabel,
} from '../console'

describe('readSection', () => {
  it('honours a known section', () => {
    expect(readSection({ section: 'licensing' })).toBe('licensing')
  })
  it('takes the first value of a repeated key', () => {
    expect(readSection({ section: ['programmes', 'reports'] })).toBe('programmes')
  })
  it('falls back to the landing preference for a bare or stale URL', () => {
    expect(readSection({}, 'enforcement')).toBe('enforcement')
    expect(readSection({ section: 'renamed-long-ago' }, 'inspections')).toBe('inspections')
  })
  it('falls back to the dashboard with no preference', () => {
    expect(readSection(undefined)).toBe(FALLBACK_SECTION)
  })
})

describe('sectionQuery', () => {
  it('omits the section the URL would land on anyway', () => {
    expect(sectionQuery({ section: 'reports' }, 'dashboard')).toEqual({})
  })
  it('writes the section out when it differs from the landing preference', () => {
    // With Enforcement as landing, the dashboard must be named explicitly —
    // otherwise a reload would open Enforcement instead.
    expect(sectionQuery({}, 'dashboard', 'enforcement')).toEqual({ section: 'dashboard' })
    expect(sectionQuery({}, 'enforcement', 'enforcement')).toEqual({})
  })
  it('keeps every key it does not own', () => {
    expect(sectionQuery({ pane: 'map', tab: 'water' }, 'surveillance'))
      .toEqual({ pane: 'map', tab: 'water', section: 'surveillance' })
  })
  it('round-trips through readSection for every landing choice', () => {
    for (const landing of ['dashboard', 'licensing'] as const) {
      for (const s of ['dashboard', 'licensing', 'reports'] as const) {
        expect(readSection(sectionQuery({}, s, landing), landing)).toBe(s)
      }
    }
  })
})

describe('parsePreferences', () => {
  it('returns defaults for nothing, junk and non-objects', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_EHO_PREFERENCES)
    expect(parsePreferences('{not json')).toEqual(DEFAULT_EHO_PREFERENCES)
    expect(parsePreferences('42')).toEqual(DEFAULT_EHO_PREFERENCES)
  })
  it('keeps valid fields and replaces only the invalid ones', () => {
    const p = parsePreferences(JSON.stringify({
      landingSection: 'settings',          // not a landing choice
      railCollapsed: true,
      inspectionCycleDays: 7,              // not an offered cycle
    }))
    expect(p).toEqual({ landingSection: 'dashboard', railCollapsed: true, inspectionCycleDays: 90 })
  })
  it('accepts a full valid set', () => {
    const p = { landingSection: 'licensing', railCollapsed: false, inspectionCycleDays: 180 }
    expect(parsePreferences(JSON.stringify(p))).toEqual(p)
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime()
  it('treats a never-inspected premises as overdue', () => {
    expect(isOverdue(null, 90, now)).toBe(true)
  })
  it('measures against the cycle', () => {
    expect(isOverdue('2026-07-01T12:00:00Z', 90, now)).toBe(false)   // 75 days
    expect(isOverdue('2026-05-01T12:00:00Z', 90, now)).toBe(true)    // 136 days
    expect(isOverdue('2026-05-01T12:00:00Z', 180, now)).toBe(false)
  })
})

describe('daysUntil / humanise', () => {
  const now = new Date('2026-09-14T00:00:00Z').getTime()
  it('counts down and goes negative once passed', () => {
    expect(daysUntil('2026-09-24T00:00:00Z', now)).toBe(10)
    expect(daysUntil('2026-09-04T00:00:00Z', now)).toBe(-10)
    expect(daysUntil(null, now)).toBeNull()
  })
  it('humanises snake_case keys', () => {
    expect(humanise('food_poisoning')).toBe('Food poisoning')
    expect(humanise(null)).toBe('—')
  })
})

describe('wardLabel', () => {
  it('never doubles the word', () => {
    expect(wardLabel('3')).toBe('Ward 3')
    expect(wardLabel('Ward 3')).toBe('Ward 3')
    expect(wardLabel('ward 12')).toBe('Ward 12')
    expect(wardLabel('')).toBe('—')
  })
})
