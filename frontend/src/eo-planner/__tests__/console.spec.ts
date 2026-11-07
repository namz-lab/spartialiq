import { describe, it, expect } from 'vitest'
import {
  readSection, readCaseId, sectionQuery, isCaseSection,
  parsePreferences, caseClock, DEFAULT_EO_PREFERENCES, SECTION_KEYS, SECTION_GROUP,
} from '../console'

const CASE = '3f1a2b4c-5d6e-4f70-8901-abcdef012345'

describe('readSection', () => {
  it('reads a known section', () => {
    expect(readSection({ section: 'decision' })).toBe('decision')
  })
  it('falls back to the landing preference, not to an error', () => {
    expect(readSection({ section: 'not_a_section' }, 'register')).toBe('register')
    expect(readSection({}, 'register')).toBe('register')
    expect(readSection(undefined)).toBe('dashboard')
  })
  it('ignores a repeated query parameter beyond the first', () => {
    expect(readSection({ section: ['committee', 'decision'] })).toBe('committee')
  })
})

describe('readCaseId', () => {
  it('accepts a uuid', () => {
    expect(readCaseId({ case: CASE })).toBe(CASE)
  })
  it('refuses anything that could not be a case, rather than fetching it', () => {
    expect(readCaseId({ case: '12345' })).toBeNull()
    expect(readCaseId({ case: '' })).toBeNull()
    expect(readCaseId({})).toBeNull()
  })
})

describe('sectionQuery', () => {
  it('keeps the open case across a section change', () => {
    expect(sectionQuery({ case: CASE }, 'diligence')).toEqual({ case: CASE, section: 'diligence' })
  })
  it('drops section-scoped keys, which belong to the section being left', () => {
    expect(sectionQuery({ case: CASE, tab: 'conditions', q: 'moyo' }, 'committee'))
      .toEqual({ case: CASE, section: 'committee' })
  })
  it('omits ?section= when the bare URL already lands there', () => {
    expect(sectionQuery({}, 'dashboard')).toEqual({})
    // …and against the SAME landing preference the reader is given, or a bare
    // link and the screen it writes would disagree.
    expect(sectionQuery({}, 'register', 'register')).toEqual({})
    expect(sectionQuery({}, 'dashboard', 'register')).toEqual({ section: 'dashboard' })
  })
  it('keeps keys this contract does not own', () => {
    expect(sectionQuery({ pane: 'console' }, 'appeals'))
      .toEqual({ pane: 'console', section: 'appeals' })
  })
})

describe('sections', () => {
  it('gives every section exactly one group', () => {
    for (const k of SECTION_KEYS) expect(SECTION_GROUP[k]).toBeTruthy()
  })
  it('knows which sections work on the open case', () => {
    expect(isCaseSection('decision')).toBe(true)
    expect(isCaseSection('reports')).toBe(false)
  })
})

describe('parsePreferences', () => {
  it('returns the defaults for nothing, rubbish, or the wrong shape', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_EO_PREFERENCES)
    expect(parsePreferences('{oops')).toEqual(DEFAULT_EO_PREFERENCES)
    expect(parsePreferences('"a string"')).toEqual(DEFAULT_EO_PREFERENCES)
  })
  it('takes the fields it recognises and defaults the rest', () => {
    const p = parsePreferences(JSON.stringify({
      landingSection: 'register', railCollapsed: true, clockWarningDays: 30,
    }))
    expect(p).toEqual({ landingSection: 'register', railCollapsed: true, clockWarningDays: 30 })
  })
  it('refuses a value that is not on offer, field by field', () => {
    const p = parsePreferences(JSON.stringify({
      landingSection: 'settings', railCollapsed: 'yes', clockWarningDays: 1,
    }))
    expect(p).toEqual(DEFAULT_EO_PREFERENCES)
  })
})

describe('caseClock', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')

  it('says so when no clock has started, rather than counting from receipt', () => {
    expect(caseClock(null, 14, now)).toEqual({ daysLeft: null, tone: 'ok', label: 'Not acknowledged: no clock yet' })
    expect(caseClock('not a date', 14, now).daysLeft).toBeNull()
  })
  it('counts down from the start of the statutory period', () => {
    const c = caseClock('2026-05-02T00:00:00Z', 14, now)   // deadline 2 Aug: 62 days
    expect(c.daysLeft).toBe(62)
    expect(c.tone).toBe('ok')
  })
  it('escalates inside the council’s own warning window', () => {
    expect(caseClock('2026-03-15T00:00:00Z', 14, now).tone).toBe('caution')  // deadline 15 Jun: 14 left
    expect(caseClock('2026-03-06T00:00:00Z', 14, now).tone).toBe('urgent')   // deadline 6 Jun: 5 left
  })
  it('treats the day the period expires as expired, not as one day left', () => {
    const c = caseClock('2026-03-01T00:00:00Z', 14, now)   // three months to the day
    expect(c.daysLeft).toBe(0)
    expect(c.tone).toBe('expired')
    expect(c.label).toBe('Deemed refused today')
  })
  it('keeps counting after the deadline, because the case still exists', () => {
    const c = caseClock('2026-02-01T00:00:00Z', 14, now)
    expect(c.daysLeft).toBeLessThan(0)
    expect(c.tone).toBe('expired')
    expect(c.label).toMatch(/Deemed refused \d+ d ago/)
  })
  it('widens with the preference', () => {
    expect(caseClock('2026-03-22T00:00:00Z', 14, now).tone).toBe('ok')      // 21 left
    expect(caseClock('2026-03-22T00:00:00Z', 30, now).tone).toBe('caution')
  })
})
