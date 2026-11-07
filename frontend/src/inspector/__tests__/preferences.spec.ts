// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_PREFERENCES, LANDING_SECTIONS, isLandingSection,
  readPreferences, writePreference, resetPreferences, onPreferencesChange,
} from '../preferences'

const KEY = 'vungu.inspector.preferences'
const VOICE_KEY = 'vungu.nav.voice.muted'

beforeEach(() => {
  localStorage.clear()
})

describe('defaults', () => {
  it('gives a new device the safe defaults', () => {
    expect(readPreferences()).toEqual({
      landingSection: 'dashboard',
      railCollapsed: false,
      autoUploadOnReconnect: true,
      voiceGuidance: true,
    })
  })

  it('defaults evidence upload ON, because evidence owed to the record should not wait on a button', () => {
    expect(DEFAULT_PREFERENCES.autoUploadOnReconnect).toBe(true)
  })

  it('offers only operational sections as a landing choice', () => {
    // A case-bound section would land the inspector on an empty state every
    // morning, since no case is open when the console first loads.
    expect([...LANDING_SECTIONS]).toEqual(
      ['dashboard', 'stages', 'bookings', 'enforcement', 'complaints'])
    expect(isLandingSection('casefile')).toBe(false)
    expect(isLandingSection('certificates')).toBe(false)
    expect(isLandingSection('preconstruction')).toBe(false)
    expect(isLandingSection('enforcement')).toBe(true)
    // Public reports needs no case to be useful, so it qualifies.
    expect(isLandingSection('complaints')).toBe(true)
    expect(isLandingSection('nonsense')).toBe(false)
  })
})

describe('writing', () => {
  it('persists a preference across reads', () => {
    writePreference('landingSection', 'enforcement')
    expect(readPreferences().landingSection).toBe('enforcement')
  })

  it('leaves the other preferences alone', () => {
    writePreference('railCollapsed', true)
    writePreference('autoUploadOnReconnect', false)
    expect(readPreferences()).toMatchObject({
      landingSection: 'dashboard',
      railCollapsed: true,
      autoUploadOnReconnect: false,
    })
  })

  it('stores voice through navVoice, not a second copy of its own', () => {
    // A duplicate would drift from the mute button on the navigation panel.
    writePreference('voiceGuidance', false)
    expect(localStorage.getItem(VOICE_KEY)).toBe('1')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).not.toHaveProperty('voiceGuidance')
    expect(readPreferences().voiceGuidance).toBe(false)
  })
})

describe('surviving junk', () => {
  it('falls back to the defaults when the stored value is not JSON', () => {
    localStorage.setItem(KEY, 'not json {{{')
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES)
  })

  it('falls back to the defaults when the stored value is not an object', () => {
    localStorage.setItem(KEY, '"a string"')
    expect(readPreferences().landingSection).toBe('dashboard')
  })

  it('keeps the good fields of a partly invalid blob', () => {
    // A build that renamed a section must not cost the inspector every other
    // preference they set.
    localStorage.setItem(KEY, JSON.stringify({
      landingSection: 'a-section-that-was-removed',
      railCollapsed: true,
      autoUploadOnReconnect: 'yes please',
    }))
    expect(readPreferences()).toMatchObject({
      landingSection: 'dashboard',          // invalid -> default
      railCollapsed: true,                  // valid   -> kept
      autoUploadOnReconnect: true,          // invalid -> default
    })
  })

  it('does not throw when storage itself is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    expect(() => readPreferences()).not.toThrow()
    expect(readPreferences().landingSection).toBe('dashboard')
    spy.mockRestore()
  })
})

describe('reset', () => {
  it('puts every preference back, including the voice flag', () => {
    writePreference('landingSection', 'bookings')
    writePreference('railCollapsed', true)
    writePreference('voiceGuidance', false)

    expect(resetPreferences()).toEqual(DEFAULT_PREFERENCES)
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('notifying', () => {
  it('tells subscribers about a change made in this tab', () => {
    // The `storage` event never fires in the tab that caused it, so a write has
    // to announce itself or the rail would not move until a reload.
    const seen: string[] = []
    const off = onPreferencesChange(p => seen.push(p.landingSection))

    writePreference('landingSection', 'stages')
    writePreference('landingSection', 'bookings')

    expect(seen).toEqual(['stages', 'bookings'])
    off()
    writePreference('landingSection', 'enforcement')
    expect(seen).toEqual(['stages', 'bookings'])
  })

  it('announces a reset too', () => {
    writePreference('railCollapsed', true)
    const seen: boolean[] = []
    const off = onPreferencesChange(p => seen.push(p.railCollapsed))
    resetPreferences()
    expect(seen).toEqual([false])
    off()
  })
})
