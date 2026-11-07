import { describe, expect, it } from 'vitest'
import {
  acknowledgementDue, addMonths, appealDeadline, daysUntil, determinationDeadline, determinationMonths, determinationSection,
  objectionDeadline,
} from '../periods'

describe('statutory periods (RTCP Act [Ch. 29:12])', () => {
  it('counts calendar months, not 90 days', () => {
    // three months from 1 June is 92 days, from 1 December is 90 days
    expect(determinationDeadline('2026-06-01T00:00:00.000Z')).toBe('2026-09-01T00:00:00.000Z')
    expect(determinationDeadline('2026-12-01T00:00:00.000Z')).toBe('2027-03-01T00:00:00.000Z')
  })
  it('clamps to the end of a short month instead of rolling over', () => {
    expect(addMonths('2026-11-30T08:00:00.000Z', 3)).toBe('2027-02-28T08:00:00.000Z')
    expect(addMonths('2027-11-30T08:00:00.000Z', 3)).toBe('2028-02-29T08:00:00.000Z')   // leap year
    expect(addMonths('2026-01-31T00:00:00.000Z', 1)).toBe('2026-02-28T00:00:00.000Z')
  })
  it('starts at acknowledgement: an unacknowledged application has no deemed-refusal date', () => {
    expect(determinationDeadline(null)).toBeNull()
    expect(determinationDeadline(undefined)).toBeNull()
    expect(determinationDeadline('not a date')).toBeNull()
  })
  it('gives a subdivision or consolidation four months (s.40(6)), everything else three (s.26(7))', () => {
    expect(determinationMonths('subdivision')).toBe(4)
    expect(determinationMonths('consolidation')).toBe(4)
    expect(determinationMonths('new_building')).toBe(3)
    expect(determinationMonths(undefined)).toBe(3)
    expect(determinationSection('subdivision')).toBe('s.40(6)')
    expect(determinationDeadline('2026-06-01T00:00:00.000Z', 'subdivision')).toBe('2026-10-01T00:00:00.000Z')
  })
  it('acknowledgement is due two weeks after receipt', () => {
    expect(acknowledgementDue('2026-06-01T00:00:00.000Z')).toBe('2026-06-15T00:00:00.000Z')
  })
  it('objections and appeals run one month', () => {
    expect(objectionDeadline('2026-01-31T00:00:00.000Z')).toBe('2026-02-28T00:00:00.000Z')
    expect(appealDeadline('2026-03-15T00:00:00.000Z')).toBe('2026-04-15T00:00:00.000Z')
  })
  it('daysUntil rounds up, so the last part-day counts and zero means passed', () => {
    const dl = '2026-09-01T00:00:00.000Z'
    expect(daysUntil(dl, Date.parse('2026-08-31T12:00:00.000Z'))).toBe(1)
    expect(daysUntil(dl, Date.parse('2026-09-01T00:00:00.000Z'))).toBe(0)
    expect(daysUntil(dl, Date.parse('2026-09-02T06:00:00.000Z'))).toBe(-1)
  })
})
