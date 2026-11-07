// Rules for the Planning Clerk console's URL contract, its statutory
// arithmetic and its shared formatters.
//
// The arithmetic is the reason this file matters more than the equivalent for
// the other consoles. A clerk reads the proposed due date off the screen and
// writes it on a letter that the council is then held to, so a five-day
// calculation that lands on a Saturday, or a three-month clock that rolls 30
// November into 2 March, is a real defect in a real letter.
//
// No component mounts here — console.ts is pure precisely so that these can be
// checked without a router or a DOM.

import { describe, it, expect } from 'vitest'
import {
  readSection, readPermit, sectionQuery, paramQuery, isSectionKey,
  readPreferences, writePreferences, DEFAULT_PREFERENCES,
  plusWorkingDays, plusCalendarDays, plusMonths,
  formatMoney, asLabel, deadlineTone, toDateInput,
  SECTION_KEYS, SECTION_GROUP, LANDING_CHOICES, FALLBACK_SECTION,
  SECTION_SCOPED_KEYS,
} from '../console'

describe('section keys', () => {
  it('assigns every section to a group', () => {
    // A section missing from SECTION_GROUP renders with no rail heading, which
    // looks like a bug in the rail rather than a missing entry here.
    for (const key of SECTION_KEYS) {
      expect(SECTION_GROUP[key], `${key} has no group`).toBeDefined()
    }
  })

  it('offers only real sections as a landing choice', () => {
    for (const key of LANDING_CHOICES) expect(isSectionKey(key)).toBe(true)
  })

  it('does not offer preferences as a landing choice', () => {
    // Nobody wants their console to open on its own settings screen.
    expect(LANDING_CHOICES).not.toContain('preferences')
  })
})

describe('readSection', () => {
  it('reads the section from the query', () => {
    expect(readSection({ section: 'fees' })).toBe('fees')
  })

  it('falls back to the landing preference when the query says nothing', () => {
    expect(readSection({}, 'register')).toBe('register')
    expect(readSection(undefined)).toBe(FALLBACK_SECTION)
  })

  it('treats an unknown section as absent rather than as an error', () => {
    // A bookmark saved before a section was renamed should still open the
    // console, not a 404 screen.
    expect(readSection({ section: 'cashbook' }, 'search')).toBe('search')
  })

  it('ignores a landing preference that is not a section', () => {
    expect(readSection({}, 'nonsense' as never)).toBe(FALLBACK_SECTION)
  })

  it('takes the first value when the router gives an array', () => {
    expect(readSection({ section: ['fees', 'register'] })).toBe('fees')
  })
})

describe('sectionQuery', () => {
  it('omits ?section= when a bare link would land there anyway', () => {
    expect(sectionQuery({}, 'dashboard', 'dashboard')).toEqual({})
  })

  it('writes ?section= when it differs from the landing preference', () => {
    expect(sectionQuery({}, 'fees', 'dashboard')).toEqual({ section: 'fees' })
  })

  it('omits ?section= against the landing preference, not the fallback', () => {
    // The trap CLAUDE.md warns about for the admin console: readSection and
    // sectionQuery must be given the same preference, or a bare link lands
    // somewhere the rail disagrees with.
    const query = sectionQuery({}, 'register', 'register')
    expect(query.section).toBeUndefined()
    expect(readSection(query, 'register')).toBe('register')
  })

  it('drops section-scoped filters on a move', () => {
    // `status` filters dispatch methods in one section and permit statuses in
    // the next. Carrying it across would silently narrow the next screen.
    const next = sectionQuery({ section: 'fees', q: 'Moyo', kind: 'application' }, 'register')
    expect(next.q).toBeUndefined()
    expect(next.kind).toBeUndefined()
  })

  it('keeps the open file across a move', () => {
    // The clerk's loop at the counter is one file across four sections. This
    // is the single deliberate exception to the rule above.
    expect(SECTION_SCOPED_KEYS).not.toContain('permit')
    const next = sectionQuery({ permit: 'abc', q: 'Moyo' }, 'correspondence')
    expect(next.permit).toBe('abc')
    expect(next.q).toBeUndefined()
  })

  it('preserves keys the contract does not own', () => {
    expect(sectionQuery({ debug: '1' }, 'fees').debug).toBe('1')
  })
})

describe('paramQuery', () => {
  it('sets a filter', () => {
    expect(paramQuery({ section: 'fees' }, 'q', 'Moyo')).toEqual({ section: 'fees', q: 'Moyo' })
  })

  it('removes the key when the value is cleared, rather than writing an empty one', () => {
    // `?section=fees&q=` is what a clerk copies out of the bar after clearing
    // a search box; the colleague who opens it should not see a blank filter.
    expect(paramQuery({ section: 'fees', q: 'Moyo' }, 'q', '')).toEqual({ section: 'fees' })
    expect(paramQuery({ section: 'fees', q: 'Moyo' }, 'q', null)).toEqual({ section: 'fees' })
  })

  it('does not mutate the query it was given', () => {
    const existing = { section: 'fees', q: 'Moyo' }
    paramQuery(existing, 'q', null)
    expect(existing.q).toBe('Moyo')
  })
})

describe('readPermit', () => {
  it('reads the open file', () => {
    expect(readPermit({ permit: 'abc' })).toBe('abc')
  })
  it('is null when no file is open', () => {
    expect(readPermit({})).toBeNull()
    expect(readPermit(undefined)).toBeNull()
  })
})

describe('preferences', () => {
  /** A localStorage that exists only for the test. */
  function memoryStore(seed: string | null = null): Storage {
    let value = seed
    return {
      getItem: () => value,
      setItem: (_k: string, v: string) => { value = v },
      removeItem: () => { value = null },
      clear: () => { value = null },
      key: () => null,
      length: 0,
    } as unknown as Storage
  }

  it('returns the defaults when nothing is stored', () => {
    expect(readPreferences(memoryStore())).toEqual(DEFAULT_PREFERENCES)
  })

  it('falls back field by field rather than all at once', () => {
    // A stored object from an older version, missing the newer field, should
    // keep the clerk's landing choice rather than resetting everything.
    const stored = JSON.stringify({ landingSection: 'fees' })
    const prefs = readPreferences(memoryStore(stored))
    expect(prefs.landingSection).toBe('fees')
    expect(prefs.counterCurrency).toBe(DEFAULT_PREFERENCES.counterCurrency)
  })

  it('refuses a landing section that is not offered', () => {
    const stored = JSON.stringify({ landingSection: 'preferences' })
    expect(readPreferences(memoryStore(stored)).landingSection)
      .toBe(DEFAULT_PREFERENCES.landingSection)
  })

  it('refuses a horizon that is not one of the choices', () => {
    const stored = JSON.stringify({ deadlineHorizonDays: 9999 })
    expect(readPreferences(memoryStore(stored)).deadlineHorizonDays)
      .toBe(DEFAULT_PREFERENCES.deadlineHorizonDays)
  })

  it('refuses a currency the council does not keep books in', () => {
    const stored = JSON.stringify({ counterCurrency: 'ZWL' })
    expect(readPreferences(memoryStore(stored)).counterCurrency).toBe('USD')
  })

  it('survives corrupt stored JSON', () => {
    expect(readPreferences(memoryStore('{not json'))).toEqual(DEFAULT_PREFERENCES)
  })

  it('survives a storage that throws', () => {
    // Private mode and blocked site data both throw on access, and neither is
    // a reason for the console not to open.
    const hostile = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
    } as unknown as Storage
    expect(readPreferences(hostile)).toEqual(DEFAULT_PREFERENCES)
    expect(() => writePreferences(DEFAULT_PREFERENCES, hostile)).not.toThrow()
  })

  it('round-trips through a store', () => {
    const store = memoryStore()
    const next = { ...DEFAULT_PREFERENCES, landingSection: 'search' as const, counterCurrency: 'ZWG' as const }
    writePreferences(next, store)
    expect(readPreferences(store)).toEqual(next)
  })
})

describe('plusWorkingDays', () => {
  it('counts five working days from a Monday to the following Monday', () => {
    // Mon 1 Jun 2026 + 5 working days = Mon 8 Jun. The weekend is skipped, so
    // it is seven calendar days, not five.
    const from = new Date(2026, 5, 1, 9, 0).toISOString()   // Monday
    const due = new Date(plusWorkingDays(from, 5))
    expect(due.getDay()).toBe(1)
    expect(due.getDate()).toBe(8)
  })

  it('never lands on a weekend', () => {
    // A letter due on a Saturday is a letter the council cannot post.
    for (let start = 1; start <= 30; start++) {
      for (let n = 1; n <= 10; n++) {
        const from = new Date(2026, 5, start, 10, 0).toISOString()
        const day = new Date(plusWorkingDays(from, n)).getDay()
        expect(day, `${start} Jun + ${n} working days landed on day ${day}`).not.toBe(0)
        expect(day).not.toBe(6)
      }
    }
  })

  it('starts counting from the next day when receipt is on a Friday', () => {
    // Fri 5 Jun 2026 + 1 working day = Mon 8 Jun, not Sat 6 Jun.
    const from = new Date(2026, 5, 5, 15, 0).toISOString()  // Friday
    const due = new Date(plusWorkingDays(from, 1))
    expect(due.getDate()).toBe(8)
  })

  it('returns the input unchanged rather than NaN for a bad date', () => {
    expect(plusWorkingDays('not a date', 5)).toBe('not a date')
  })
})

describe('plusCalendarDays', () => {
  it('counts calendar days, weekends included', () => {
    // The seven-day refusal rule is calendar days, unlike the five-day
    // acknowledgement rule. Getting these the same way round matters.
    const from = new Date(2026, 5, 1, 9, 0).toISOString()
    expect(new Date(plusCalendarDays(from, 7)).getDate()).toBe(8)
  })
})

describe('plusMonths', () => {
  it('clamps to the end of a short month instead of rolling over', () => {
    // 30 November + 3 months. Date.setMonth alone gives 2 March, which is a
    // determination deadline two days later than the statute allows.
    const from = new Date(2026, 10, 30, 9, 0).toISOString()
    const due = new Date(plusMonths(from, 3))
    expect(due.getMonth()).toBe(1)          // February
    expect(due.getDate()).toBe(28)
  })

  it('handles a leap February', () => {
    const from = new Date(2027, 10, 30, 9, 0).toISOString()
    const due = new Date(plusMonths(from, 3))
    expect(due.getMonth()).toBe(1)
    expect(due.getDate()).toBe(29)          // 2028 is a leap year
  })

  it('leaves an ordinary date alone', () => {
    const from = new Date(2026, 0, 15, 9, 0).toISOString()
    const due = new Date(plusMonths(from, 3))
    expect(due.getMonth()).toBe(3)          // April
    expect(due.getDate()).toBe(15)
  })
})

describe('deadlineTone', () => {
  const now = new Date(2026, 5, 10, 14, 0)

  it('calls a satisfied deadline done, whatever its date', () => {
    const past = new Date(2026, 4, 1).toISOString()
    expect(deadlineTone(past, new Date(2026, 4, 2).toISOString(), now).tone).toBe('done')
  })

  it('counts whole calendar days, not hours', () => {
    // A letter due at 09:00 tomorrow is due tomorrow, not "in 0 days".
    const tomorrowMorning = new Date(2026, 5, 11, 9, 0).toISOString()
    const result = deadlineTone(tomorrowMorning, null, now)
    expect(result.days).toBe(1)
    expect(result.tone).toBe('soon')
  })

  it('calls today today even when the hour has passed', () => {
    const thisMorning = new Date(2026, 5, 10, 9, 0).toISOString()
    expect(deadlineTone(thisMorning, null, now).tone).toBe('today')
  })

  it('reports overdue in whole days, singular and plural', () => {
    expect(deadlineTone(new Date(2026, 5, 9).toISOString(), null, now).label)
      .toBe('1 day overdue')
    expect(deadlineTone(new Date(2026, 5, 7).toISOString(), null, now).label)
      .toBe('3 days overdue')
  })

  it('is quiet about a deadline that is comfortably away', () => {
    expect(deadlineTone(new Date(2026, 6, 10).toISOString(), null, now).tone).toBe('ok')
  })

  it('does not throw on a missing or malformed date', () => {
    expect(deadlineTone(null).tone).toBe('ok')
    expect(deadlineTone('whenever').tone).toBe('ok')
  })
})

describe('formatMoney', () => {
  it('always names the currency', () => {
    // Two currencies run side by side in this council's books; a bare number
    // on a receipt screen cannot be reconciled.
    expect(formatMoney(1200, 'USD')).toBe('USD 1,200.00')
    expect(formatMoney(1200, 'ZWG')).toBe('ZWG 1,200.00')
  })

  it('accepts the string Postgres returns for a NUMERIC column', () => {
    expect(formatMoney('45.50', 'USD')).toBe('USD 45.50')
  })

  it('shows a dash rather than NaN for a missing amount', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatMoney('abc')).toBe('—')
  })
})

describe('asLabel', () => {
  it('turns a wire value into a sentence', () => {
    expect(asLabel('registered_post')).toBe('Registered post')
  })
  it('shows a dash for nothing', () => {
    expect(asLabel(null)).toBe('—')
    expect(asLabel('')).toBe('—')
  })
})

describe('toDateInput', () => {
  it('uses local date parts, not UTC', () => {
    // A receipt taken at 01:00 in Harare is today's receipt. toISOString()
    // would date it yesterday for anyone east of Greenwich.
    const localMidnightish = new Date(2026, 5, 10, 1, 0)
    expect(toDateInput(localMidnightish.toISOString())).toBe('2026-06-10')
  })
  it('is empty for nothing', () => {
    expect(toDateInput(null)).toBe('')
  })
})
