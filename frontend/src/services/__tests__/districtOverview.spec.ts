import { describe, it, expect } from 'vitest'
import { formatFigure, compactFigure, freshness, FIGURE_KEYS } from '../districtOverview'

/**
 * The landing page publishes these figures as the council's own. The rule
 * that matters is the one about absence: a figure the database could not
 * supply must render as an em dash and never as a zero. "0 km of road" is a
 * claim about the district; "—" is a statement about the data, and only the
 * second one is true when a table is missing in an environment.
 */
describe('formatFigure', () => {
  it('renders a figure with thousands separators', () => {
    expect(formatFigure(133840)).toBe('133,840')
    expect(formatFigure(19)).toBe('19')
  })

  it('renders an em dash for a figure the server could not supply', () => {
    expect(formatFigure(null)).toBe('—')
    expect(formatFigure(undefined)).toBe('—')
    expect(formatFigure(Number.NaN)).toBe('—')
  })

  it('renders a genuine zero as zero', () => {
    // Distinct from the case above on purpose: a real 0 is a real reading.
    expect(formatFigure(0)).toBe('0')
  })
})

describe('compactFigure', () => {
  it('compresses figures that will not fit a tile', () => {
    expect(compactFigure(133840)).toBe('133.8K')
    expect(compactFigure(588851)).toBe('588.9K')
    expect(compactFigure(1_200_000)).toBe('1.2M')
  })

  it('leaves small figures alone', () => {
    expect(compactFigure(19)).toBe('19')
    expect(compactFigure(4005)).toBe('4,005')
  })

  it('drops a trailing .0 rather than printing "133.0K"', () => {
    expect(compactFigure(133000)).toBe('133K')
  })

  it('renders an em dash for a missing figure, like formatFigure', () => {
    expect(compactFigure(null)).toBe('—')
    expect(compactFigure(undefined)).toBe('—')
  })
})

describe('freshness', () => {
  const now = new Date('2026-09-23T12:00:00Z')

  it('says "today" for a reading taken today', () => {
    expect(freshness(new Date('2026-09-23T06:00:00Z'))).toMatch(/today/)
  })

  it('falls back to a date once the reading is a month old', () => {
    // A cache that has not refreshed in a month should say so with a date,
    // not "31 days ago", which reads as fresher than it is.
    const old = new Date(now.getTime() - 40 * 86_400_000)
    expect(freshness(old)).toMatch(/\d{4}/)
  })

  it('says nothing when there is no timestamp', () => {
    expect(freshness(null)).toBe('')
    expect(freshness(new Date('not a date'))).toBe('')
  })
})

describe('FIGURE_KEYS', () => {
  it('matches the keys the backend answers with', () => {
    // Guards the contract with src/routes/districtOverview.js in the backend:
    // a key added there and not here renders nowhere, and one renamed here
    // silently becomes an em dash on the live page.
    expect([...FIGURE_KEYS]).toEqual([
      'wards', 'hectares', 'roadKm', 'buildings',
      'parcels', 'farms', 'planningZones', 'waterBodies', 'settlements',
    ])
  })
})
