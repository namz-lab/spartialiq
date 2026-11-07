// Rules for the IT Admin console's URL contract and its shared formatters.
//
// Every one of these is a rule that has a wrong answer somebody would ship:
// a filter that survives a section change and silently narrows the next
// screen, a bare link that lands somewhere the rail disagrees with, a cleared
// search box that leaves `?q=` in a link a colleague is about to open.
//
// No component mounts here — console.ts is pure precisely so that these can be
// checked without a router or a DOM.

import { describe, it, expect } from 'vitest'
import {
  readSection, sectionQuery, paramQuery, isSectionKey,
  readPreferences, writePreferences, DEFAULT_PREFERENCES,
  formatBytes, timeAgo, daysAgoIso, describeAgent,
  SECTION_KEYS, SECTION_GROUP, LANDING_CHOICES, FALLBACK_SECTION,
} from '../console'

describe('section keys', () => {
  it('assigns every section to a group', () => {
    // A section missing from SECTION_GROUP renders with no rail heading, which
    // looks like a bug in the rail rather than a missing entry here.
    for (const key of SECTION_KEYS) {
      expect(SECTION_GROUP[key], `${key} has no group`).toBeDefined()
    }
  })

  it('only offers real sections as a landing choice', () => {
    for (const key of LANDING_CHOICES) expect(isSectionKey(key)).toBe(true)
  })

  it('never offers Preferences as a landing choice', () => {
    expect(LANDING_CHOICES).not.toContain('preferences')
  })
})

describe('readSection', () => {
  it('reads the section from the query', () => {
    expect(readSection({ section: 'audit' })).toBe('audit')
  })

  it('treats an unknown section as absent rather than as an error', () => {
    // A bookmark saved before a section was renamed should still open the
    // console, not a 404 screen.
    expect(readSection({ section: 'no-such-section' })).toBe(FALLBACK_SECTION)
  })

  it('honours the landing preference when the query names nothing', () => {
    expect(readSection({}, 'signin')).toBe('signin')
  })

  it('lets an explicit section beat the landing preference', () => {
    // The link is the more specific instruction.
    expect(readSection({ section: 'overview' }, 'signin')).toBe('overview')
  })

  it('takes the first value when the router hands back an array', () => {
    expect(readSection({ section: ['audit', 'health'] })).toBe('audit')
  })

  it('falls back when the landing preference is itself junk', () => {
    expect(readSection({}, 'nonsense' as never)).toBe(FALLBACK_SECTION)
  })
})

describe('sectionQuery', () => {
  it('omits the section a bare URL would land on anyway', () => {
    expect(sectionQuery({}, FALLBACK_SECTION)).toEqual({})
  })

  it('omits it against the landing preference, not against the fallback', () => {
    // The trap: hardcoding 'overview' here breaks the preference. With
    // Sign-in chosen, a bare URL MEANS sign-in — so ?section= has to be
    // written out for the overview and dropped for sign-in, the exact
    // opposite of the default case above.
    expect(sectionQuery({}, 'signin', 'signin')).toEqual({})
    expect(sectionQuery({}, 'overview', 'signin')).toEqual({ section: 'overview' })
  })

  it('drops section-scoped filters on the way to another section', () => {
    // `status` means "suspended" on Employees and "failed" on the outbox.
    // Carrying it would silently filter the next screen by the last one's idea.
    expect(sectionQuery({ section: 'employees', status: 'suspended', q: 'moyo' }, 'jobs'))
      .toEqual({ section: 'jobs' })
  })

  it('keeps query keys the console does not own', () => {
    expect(sectionQuery({ utm_source: 'email' }, 'audit'))
      .toEqual({ utm_source: 'email', section: 'audit' })
  })

  it('survives an undefined query', () => {
    expect(sectionQuery(undefined as never, 'audit')).toEqual({ section: 'audit' })
  })
})

describe('paramQuery', () => {
  it('sets a filter', () => {
    expect(paramQuery({ section: 'audit' }, 'severity', 'high'))
      .toEqual({ section: 'audit', severity: 'high' })
  })

  it('removes the key when the value is cleared', () => {
    // Not `severity: ''` — an empty value stays in the address bar, and the
    // address bar is what gets pasted into a support thread.
    expect(paramQuery({ section: 'audit', severity: 'high' }, 'severity', ''))
      .toEqual({ section: 'audit' })
    expect(paramQuery({ section: 'audit', q: 'x' }, 'q', null))
      .toEqual({ section: 'audit' })
  })

  it('does not mutate the query it was given', () => {
    const existing = { section: 'audit', q: 'moyo' }
    paramQuery(existing, 'q', null)
    expect(existing).toEqual({ section: 'audit', q: 'moyo' })
  })
})

describe('preferences', () => {
  /** A localStorage that behaves, for the happy path. */
  function fakeStorage(initial?: string): Storage {
    let value = initial ?? null
    return {
      getItem: () => value,
      setItem: (_k: string, v: string) => { value = v },
      removeItem: () => { value = null },
      clear: () => { value = null },
      key: () => null,
      length: 0,
    } as Storage
  }

  it('returns the defaults when nothing is stored', () => {
    expect(readPreferences(fakeStorage())).toEqual(DEFAULT_PREFERENCES)
  })

  it('round-trips a full set', () => {
    const store = fakeStorage()
    const next = { landingSection: 'audit' as const, railCollapsed: true, auditWindowDays: 30 }
    writePreferences(next, store)
    expect(readPreferences(store)).toEqual(next)
  })

  it('falls back field by field, not all or nothing', () => {
    // A stored object from an older version keeps the admin's landing choice
    // instead of resetting everything they set.
    const store = fakeStorage(JSON.stringify({ landingSection: 'health' }))
    expect(readPreferences(store)).toEqual({
      ...DEFAULT_PREFERENCES,
      landingSection: 'health',
    })
  })

  it('rejects a landing section that is not offered as one', () => {
    const store = fakeStorage(JSON.stringify({ landingSection: 'preferences' }))
    expect(readPreferences(store).landingSection).toBe(DEFAULT_PREFERENCES.landingSection)
  })

  it('rejects an audit window that is not one of the choices', () => {
    const store = fakeStorage(JSON.stringify({ auditWindowDays: 9999 }))
    expect(readPreferences(store).auditWindowDays).toBe(DEFAULT_PREFERENCES.auditWindowDays)
  })

  it('returns the defaults rather than throwing on corrupt storage', () => {
    expect(readPreferences(fakeStorage('{not json'))).toEqual(DEFAULT_PREFERENCES)
  })

  it('survives storage that throws, as private mode does', () => {
    const hostile = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') },
    } as unknown as Storage
    expect(readPreferences(hostile)).toEqual(DEFAULT_PREFERENCES)
    // A preference is not worth failing the console over.
    expect(() => writePreferences(DEFAULT_PREFERENCES, hostile)).not.toThrow()
  })
})

describe('formatBytes', () => {
  it('uses binary units, matching pg_size_pretty', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024 * 5)).toBe('5.0 MB')
    expect(formatBytes(1024 ** 3 * 42)).toBe('42 GB')
  })

  it('renders an absent figure as a dash rather than as zero', () => {
    // "0 B" on a backup screen reads as an empty file; a dash reads as
    // "not known", which is the true statement.
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-09-21T12:00:00Z')

  it('collapses the last minute to "just now"', () => {
    expect(timeAgo('2026-09-21T11:59:40Z', now)).toBe('just now')
  })

  it('picks the largest unit that still gives a whole number', () => {
    // 90 minutes is "2 hours ago", never "90 minutes ago".
    expect(timeAgo('2026-09-21T10:30:00Z', now)).toBe('2 hours ago')
    expect(timeAgo('2026-09-19T12:00:00Z', now)).toBe('2 days ago')
    expect(timeAgo('2025-09-21T12:00:00Z', now)).toBe('last year')
  })

  it('says so when a timestamp is in the future', () => {
    // An expiry date is rendered with this, and "in 3 days" matters there.
    expect(timeAgo('2026-09-22T12:00:00Z', now)).toBe('in the future')
  })

  it('renders nothing and junk as a dash', () => {
    expect(timeAgo(null)).toBe('—')
    expect(timeAgo('not a date')).toBe('—')
  })
})

describe('daysAgoIso', () => {
  it('walks back whole days', () => {
    const now = new Date('2026-09-21T12:00:00Z')
    expect(daysAgoIso(7, now)).toBe('2026-09-14T12:00:00.000Z')
  })
})

describe('describeAgent', () => {
  it('names the browser and the platform', () => {
    expect(describeAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    )).toBe('Chrome on Windows')
  })

  it('does not mistake Chrome for Safari', () => {
    // Chrome and Edge both carry "Safari" in their user agent, so Safari has
    // to be tested last or every Windows laptop reads as a Mac browser.
    expect(describeAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    )).toBe('Safari on macOS')
    expect(describeAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
    )).toBe('Edge on Windows')
  })

  it('flags a non-browser client', () => {
    // A session held by a script is exactly what an admin is scanning for.
    expect(describeAgent('curl/8.4.0')).toBe('Script or tool')
  })

  it('handles a missing user agent', () => {
    expect(describeAgent(null)).toBe('Unknown device')
  })
})
