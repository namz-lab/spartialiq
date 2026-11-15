import { describe, it, expect } from 'vitest'
import { groupsToTable, landGroup, missing } from '../unitStats'

const fail = () => missing('The land register could not be read.', true, 'Land register')
const stat = (g: ReturnType<typeof landGroup>, label: string) => g.stats.find((s) => s.label === label)

describe('landGroup', () => {
  it('shows stands and farm parcels apart, so farms with no rates account are not read as a gap among the stands', () => {
    const g = landGroup({ loaded: true, parcels: 2320, parcels_with_account: 1589, stands: 1589, stands_with_account: 1589, farms: 731, farms_with_account: 0, estimated_boundaries: 1064 }, fail)
    expect(stat(g, 'Stands with a rates account')?.value).toBe('1,589 of 1,589')
    expect(stat(g, 'Farm parcels with a rates account')?.value).toBe('0 of 731')
    expect(stat(g, 'With a rates account')).toBeUndefined()
  })

  it('does not mention farm parcels when the register holds none', () => {
    const g = landGroup({ loaded: true, parcels: 10, parcels_with_account: 8, stands: 10, stands_with_account: 8, farms: 0, farms_with_account: 0, estimated_boundaries: 0 }, fail)
    expect(stat(g, 'Farm parcels with a rates account')).toBeUndefined()
  })

  it('keeps the old combined share for a server that does not give the split', () => {
    const g = landGroup({ loaded: true, parcels: 100, parcels_with_account: 68, estimated_boundaries: 3 }, fail)
    expect(stat(g, 'With a rates account')?.value).toBe('68%')
  })
})

describe('groupsToTable', () => {
  it('turns the figures into one line each, and says so for a group that could not be read instead of leaving it out', () => {
    const t = groupsToTable('Chief Executive\'s overview', '15 Nov 2026', [
      { area: 'Planning', groups: [{ heading: 'Land register', loaded: true, stats: [{ label: 'Parcels', value: '2,320' }], footnote: 'A caveat.' }] },
      { area: 'Engineering', groups: [{ loaded: false, unavailable: true, note: 'Could not be read.', stats: [] }] },
    ], ['Affirmed for testing.'])
    expect(t.columns).toEqual(['Area', 'Group', 'Figure', 'Value'])
    expect(t.rows).toEqual([
      ['Planning', 'Land register', 'Parcels', '2,320'],
      ['Planning', 'Land register', 'Note', 'A caveat.'],
      ['Engineering', '', 'Not available', 'Could not be read.'],
    ])
    expect(t.notes).toEqual(['Affirmed for testing.'])
  })
})
