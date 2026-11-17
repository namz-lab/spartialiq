/**
 * Property finance (migration 244): the pure helpers of src/routes/finance-property.js, with no
 * database. The map's land-use classes come from the Planning zone name and the register's tenure.
 */
const { landUseClass, STATUS_LABELS } = require('../src/routes/finance-property')

describe('property finance helpers', () => {
  test('the governing zone names the land use the map colours by', () => {
    expect(landUseClass('Medium Density Residential', null, 'stand')).toBe('residential')
    expect(landUseClass('Economic Corridor [Mixed Business]', null, 'stand')).toBe('commercial')
    expect(landUseClass('Light Industrial', null, 'stand')).toBe('industrial')
    expect(landUseClass('Institutional', null, 'stand')).toBe('institutional')
  })

  test('a farm parcel with no zone falls back to its tenure, then to agricultural', () => {
    expect(landUseClass(null, 'State Land', 'farm')).toBe('council')
    expect(landUseClass(null, 'Resettlement', 'farm')).toBe('agricultural')
    expect(landUseClass(null, null, 'farm')).toBe('agricultural')
    expect(landUseClass(null, null, 'stand')).toBe('other')
  })

  test('every status the view derives has a label', () => {
    for (const s of ['paid_up', 'partially_paid', 'awaiting_payment', 'overdue', 'not_billed',
      'allocated_no_account', 'unallocated', 'no_account', 'cancelled']) {
      expect(STATUS_LABELS[s]).toEqual(expect.any(String))
    }
  })
})
