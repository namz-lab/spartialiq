import { describe, it, expect } from 'vitest'
import {
  readLocation, locationQuery, navigationMode, inferredPane, isSectionKey, mergeQuery, caseKey,
  type ConsoleLocation,
} from '../consoleRoute'

const INSP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PERMIT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const loc = (over: Partial<ConsoleLocation> = {}): ConsoleLocation => ({
  section: 'dashboard', pane: 'console', inspectionId: null, permitId: null, ...over,
})

describe('reading the workspace URL', () => {
  it('opens the dashboard on the map when the URL says nothing', () => {
    expect(readLocation({})).toEqual({ section: 'dashboard', pane: 'map', inspectionId: null, permitId: null })
  })

  it('opens a named section in the console, because that is where the link points', () => {
    expect(readLocation({ query: { section: 'reports' } }))
      .toMatchObject({ section: 'reports', pane: 'console' })
  })

  it('opens a deep-linked inspection on its stage console', () => {
    expect(readLocation({ params: { inspectionId: INSP } }))
      .toMatchObject({ section: 'stages', pane: 'console', inspectionId: INSP })
  })

  it('lets an explicit section win over the one the inspection implies', () => {
    expect(readLocation({ params: { inspectionId: INSP }, query: { section: 'casefile' } }).section)
      .toBe('casefile')
  })

  it('honours an explicit pane over every inference', () => {
    expect(readLocation({ query: { section: 'reports', pane: 'map' } }).pane).toBe('map')
    expect(readLocation({ query: { pane: 'console' } }).pane).toBe('console')
  })

  it('always opens the console on a phone, where there is no room for both', () => {
    expect(readLocation({ isMobile: true }).pane).toBe('console')
  })

  it('treats a stale or junk section as absent rather than an error', () => {
    expect(readLocation({ query: { section: 'certificates-old' } }).section).toBe('dashboard')
    expect(readLocation({ query: { section: ['reports', 'x'] } }).section).toBe('reports')
    expect(readLocation({ query: { section: 42 } }).section).toBe('dashboard')
  })

  it('ignores ?permit= when the path already names the inspection, so the two cannot disagree', () => {
    expect(readLocation({ params: { inspectionId: INSP }, query: { permit: PERMIT } }).permitId).toBeNull()
    expect(readLocation({ query: { permit: PERMIT } })).toMatchObject({ permitId: PERMIT, pane: 'console' })
  })
})

describe('writing the workspace URL', () => {
  it('keeps the default screen out of the URL', () => {
    expect(locationQuery({ section: 'dashboard', pane: 'map', permitId: null })).toEqual({})
  })

  it('records the section, and no pane when the section already implies the console', () => {
    expect(locationQuery({ section: 'bookings', pane: 'console', permitId: null }))
      .toEqual({ section: 'bookings' })
  })

  it('records the pane only when it contradicts what the URL implies', () => {
    expect(locationQuery({ section: 'bookings', pane: 'map', permitId: null }))
      .toEqual({ section: 'bookings', pane: 'map' })
    expect(locationQuery({ section: 'dashboard', pane: 'console', permitId: null }))
      .toEqual({ pane: 'console' })
  })

  it('carries the open case so a reload does not lose it', () => {
    expect(locationQuery({ section: 'casefile', pane: 'console', permitId: PERMIT }))
      .toEqual({ section: 'casefile', permit: PERMIT })
  })

  it('drops the redundant permit once the path names the inspection', () => {
    // Nothing is left: the path implies the stage console AND the case, so
    // ?section=stages and ?permit= would both only repeat it.
    expect(locationQuery({ section: 'stages', pane: 'console', permitId: PERMIT }, { inspectionId: INSP }))
      .toEqual({})
  })

  it('round-trips: what is written reads back as the same location', () => {
    for (const pane of ['map', 'console'] as const) {
      for (const section of ['dashboard', 'reports', 'stages'] as const) {
        const query = locationQuery({ section, pane, permitId: PERMIT })
        expect(readLocation({ query })).toMatchObject({ section, pane, permitId: PERMIT })
      }
    }
  })

  it('round-trips on a phone too, where the console is the implied pane', () => {
    const query = locationQuery({ section: 'enforcement', pane: 'console', permitId: null }, { isMobile: true })
    expect(readLocation({ query, isMobile: true })).toMatchObject({ section: 'enforcement', pane: 'console' })
  })
})

describe('merging into an existing query', () => {
  it('removes an owned key that no longer applies, instead of leaving it to contradict the screen', () => {
    expect(mergeQuery({ section: 'reports', pane: 'map' }, { section: 'dashboard', pane: 'map', permitId: null }))
      .toEqual({})
  })

  it('leaves query parameters the workspace does not own untouched', () => {
    expect(mergeQuery({ ref: 'email-campaign', section: 'reports' }, { section: 'bookings', pane: 'console', permitId: null }))
      .toEqual({ ref: 'email-campaign', section: 'bookings' })
  })

  it('drops a stale permit when an inspection id takes over the path', () => {
    expect(mergeQuery({ permit: PERMIT }, { section: 'stages', pane: 'console', permitId: PERMIT }, { inspectionId: INSP }))
      .toEqual({})
  })

  it('still reads back as the stage console after dropping both', () => {
    const query = mergeQuery({ permit: PERMIT },
      { section: 'stages', pane: 'console', permitId: PERMIT }, { inspectionId: INSP })
    expect(readLocation({ query, params: { inspectionId: INSP } }))
      .toEqual({ section: 'stages', pane: 'console', inspectionId: INSP, permitId: null })
  })
})

describe('history behaviour', () => {
  it('pushes a section change, so Back returns to the previous section', () => {
    expect(navigationMode(loc(), loc({ section: 'reports' }))).toBe('push')
  })

  it('pushes a pane change, so Back returns from the map to the console', () => {
    expect(navigationMode(loc({ pane: 'console' }), loc({ pane: 'map' }))).toBe('push')
  })

  it('replaces when only the open case changed, so Back cannot strand a stale case', () => {
    expect(navigationMode(loc(), loc({ permitId: PERMIT }))).toBe('replace')
    expect(navigationMode(loc(), loc({ inspectionId: INSP }))).toBe('replace')
  })

  it('does nothing when nothing moved, so no empty history entries pile up', () => {
    expect(navigationMode(loc({ section: 'reports' }), loc({ section: 'reports' }))).toBe('none')
  })
})

describe('the case identity a watcher should key on', () => {
  it('is unchanged by the pane or the section, so a resize cannot re-fetch the case', () => {
    // `location` is recomputed whenever the pane inference changes, which
    // happens on every breakpoint crossing. Watching the object (or a tuple of
    // its fields) re-ran the case load on every resize — a burst of identical
    // requests, and a burst of 400s when the URL held a malformed id.
    const onMap = readLocation({ query: { section: 'casefile', permit: PERMIT, pane: 'map' } })
    const onConsole = readLocation({ query: { section: 'stages', permit: PERMIT, pane: 'console' } })
    expect(onMap.pane).not.toBe(onConsole.pane)
    expect(onMap.section).not.toBe(onConsole.section)
    expect(caseKey(onMap)).toBe(caseKey(onConsole))

    // And the inference itself differs by device while the case does not.
    const wide = readLocation({ isMobile: false })
    const narrow = readLocation({ isMobile: true })
    expect(wide.pane).toBe('map')
    expect(narrow.pane).toBe('console')
    expect(caseKey(wide)).toBe(caseKey(narrow))
  })

  it('changes when the case changes, so a real move still loads', () => {
    expect(caseKey({ inspectionId: null, permitId: PERMIT }))
      .not.toBe(caseKey({ inspectionId: null, permitId: 'other' }))
    expect(caseKey({ inspectionId: INSP, permitId: null }))
      .not.toBe(caseKey({ inspectionId: null, permitId: null }))
  })

  it('distinguishes an inspection from a permit with the same id', () => {
    expect(caseKey({ inspectionId: PERMIT, permitId: null }))
      .not.toBe(caseKey({ inspectionId: null, permitId: PERMIT }))
  })
})

describe('section keys', () => {
  it('accepts every section the console actually renders', () => {
    expect(isSectionKey('casefile')).toBe(true)
    expect(isSectionKey('plans')).toBe(true)
    expect(isSectionKey('nope')).toBe(false)
    expect(isSectionKey(undefined)).toBe(false)
  })

  it('infers the console for any link that names something in it', () => {
    expect(inferredPane({ query: { section: 'reports' } })).toBe('console')
    expect(inferredPane({ query: { permit: PERMIT } })).toBe('console')
    expect(inferredPane({})).toBe('map')
  })
})

describe('the landing-section preference', () => {
  it('fills the gap when the URL names no section', () => {
    expect(readLocation({ defaultSection: 'enforcement' }).section).toBe('enforcement')
  })

  it('never overrides a section the URL names', () => {
    // A link is the more specific instruction: a colleague sending "look at
    // Reports" must not land on the recipient's own preferred section.
    expect(readLocation({ query: { section: 'reports' }, defaultSection: 'enforcement' }).section)
      .toBe('reports')
  })

  it('never overrides an inspection in the path', () => {
    expect(readLocation({ params: { inspectionId: INSP }, defaultSection: 'bookings' }).section)
      .toBe('stages')
  })

  it('is ignored when it names a section that no longer exists', () => {
    expect(readLocation({ defaultSection: 'removed-section' as never }).section).toBe('dashboard')
  })

  it('still falls back to the dashboard when no preference is given', () => {
    expect(readLocation({}).section).toBe('dashboard')
  })

  it('round-trips: what mergeQuery writes, readLocation reads back', () => {
    // The regression this guards: omitting ?section= for 'dashboard' regardless
    // of the preference. With Enforcement as the landing section, a bare URL
    // means Enforcement — so the dashboard is the one that must be written out.
    const context = { defaultSection: 'enforcement' as const, isMobile: false }
    for (const section of ['dashboard', 'enforcement', 'reports', 'settings'] as const) {
      const query = mergeQuery({}, { section, pane: 'console', permitId: null }, context)
      const back = readLocation({ query, defaultSection: 'enforcement' })
      expect(back.section, `round trip for ${section}`).toBe(section)
    }
  })

  it('omits ?section= only for the section the URL would land on anyway', () => {
    expect(mergeQuery({}, { section: 'enforcement', pane: 'console', permitId: null },
      { defaultSection: 'enforcement' })).not.toHaveProperty('section')
    expect(mergeQuery({}, { section: 'dashboard', pane: 'console', permitId: null },
      { defaultSection: 'enforcement' })).toMatchObject({ section: 'dashboard' })
  })

  it('omits ?section= for the stage console once an inspection is in the path', () => {
    // The path already implies 'stages'; the preference does not apply there.
    expect(mergeQuery({}, { section: 'stages', pane: 'console', permitId: null },
      { inspectionId: INSP, defaultSection: 'enforcement' })).not.toHaveProperty('section')
  })
})

describe('settings', () => {
  it('is a real section with its own URL, so it can be linked and bookmarked', () => {
    expect(isSectionKey('settings')).toBe(true)
    expect(readLocation({ query: { section: 'settings' } }))
      .toMatchObject({ section: 'settings', pane: 'console' })
  })
})
