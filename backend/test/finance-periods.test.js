/**
 * The period engine.
 *
 * Every period-based report — the monthly management account, the quarterly return to the parent
 * Ministry, the annual budget-execution statement — generates its columns from `periodList()` and
 * its SQL buckets from the same array. So a fault here is not a wrong column heading, it is a
 * council's figures assigned to the wrong month, or counted twice, or dropped. These tests are
 * pure: no database, no HTTP, no Fastify.
 *
 * The central one is `tiles the year exactly`. It walks every day of a financial year and asserts
 * that each day falls in exactly one bucket. That is the property every period report's arithmetic
 * depends on and it is asserted directly rather than inferred from the boundaries.
 */
const {
  periodList, PERIODICITIES, PERIODICITY_MONTHS, isPeriodKey, assertPeriodKey,
} = require('../src/lib/financePeriods')

/** Every date from `start` to `end` inclusive, as 'YYYY-MM-DD'. No Date, so no time zone. */
function eachDay(start, end) {
  const days = []
  let [y, m, d] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const dim = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  for (;;) {
    days.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    if (y === ey && m === em && d === ed) break
    if (d < dim(y, m)) d += 1
    else if (m < 12) { m += 1; d = 1 }
    else { y += 1; m = 1; d = 1 }
    if (days.length > 2000) throw new Error('eachDay: runaway')
  }
  return days
}

/** How many of `periods` contain `day`. The tiling property says this is 1 for every day. */
const bucketsContaining = (periods, day) =>
  periods.filter((p) => p.from_date <= day && day <= p.to_date).length

describe('periodList — the council\'s own financial year governs the buckets', () => {
  test('a calendar year at monthly gives twelve calendar months', () => {
    const periods = periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'monthly' })
    expect(periods).toHaveLength(12)
    expect(periods[0]).toEqual({
      from_date: '2026-01-01', to_date: '2026-01-31', key: 'm01', label: 'Jan 2026',
    })
    expect(periods[1].to_date).toBe('2026-02-28')
    expect(periods[11]).toEqual({
      from_date: '2026-12-01', to_date: '2026-12-31', key: 'm12', label: 'Dec 2026',
    })
  })

  test('a leap year gives 29 February, because the month end is computed and not assumed', () => {
    const periods = periodList({ start: '2028-01-01', end: '2028-12-31', periodicity: 'monthly' })
    expect(periods[1].to_date).toBe('2028-02-29')
  })

  // Acceptance check C7. This is the whole reason the function exists.
  test('a July-June year yields Q1 = Jul-Sep, not Jan-Mar', () => {
    const periods = periodList({ start: '2026-07-01', end: '2027-06-30', periodicity: 'quarterly' })
    expect(periods).toHaveLength(4)
    expect(periods.map((p) => [p.key, p.from_date, p.to_date, p.label])).toEqual([
      ['q1', '2026-07-01', '2026-09-30', 'Jul-Sep 2026'],
      ['q2', '2026-10-01', '2026-12-31', 'Oct-Dec 2026'],
      ['q3', '2027-01-01', '2027-03-31', 'Jan-Mar 2027'],
      ['q4', '2027-04-01', '2027-06-30', 'Apr-Jun 2027'],
    ])
    // The trap this guards: nothing in the list is a calendar quarter of 2026.
    expect(periods.map((p) => p.from_date)).not.toContain('2026-01-01')
  })

  test('a July-June year at monthly starts in July', () => {
    const periods = periodList({ start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly' })
    expect(periods).toHaveLength(12)
    expect(periods[0].label).toBe('Jul 2026')
    expect(periods[0].key).toBe('m01')
    expect(periods[11].label).toBe('Jun 2027')
  })

  test('a year crossing the calendar boundary labels a half-year with both years', () => {
    const periods = periodList({ start: '2026-10-01', end: '2027-09-30', periodicity: 'half_yearly' })
    expect(periods.map((p) => p.label)).toEqual(['Oct 2026-Mar 2027', 'Apr-Sep 2027'])
  })

  test('yearly gives one bucket, labelled with the years it spans', () => {
    expect(periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'yearly' }))
      .toEqual([{ from_date: '2026-01-01', to_date: '2026-12-31', key: 'y1', label: '2026' }])
    expect(periodList({ start: '2026-07-01', end: '2027-06-30', periodicity: 'yearly' })[0].label)
      .toBe('2026-2027')
  })
})

describe('periodList — the final bucket is clipped and never runs past the year end', () => {
  test('a nine-month year at quarterly gives three quarters, the last ending on the year end', () => {
    const periods = periodList({ start: '2026-01-01', end: '2026-09-30', periodicity: 'quarterly' })
    expect(periods).toHaveLength(3)
    expect(periods[2].to_date).toBe('2026-09-30')
  })

  test('a year that is not a whole number of quarters clips the last one short', () => {
    const periods = periodList({ start: '2026-01-01', end: '2026-10-15', periodicity: 'quarterly' })
    expect(periods).toHaveLength(4)
    expect(periods[3].from_date).toBe('2026-10-01')
    expect(periods[3].to_date).toBe('2026-10-15')
    // A part period says its days rather than claiming a whole quarter.
    expect(periods[3].label).toBe('1 Oct 2026 - 15 Oct 2026')
    expect(periods.every((p) => p.to_date <= '2026-10-15')).toBe(true)
  })

  test('a first transitional year of five months gives five monthly buckets and no more', () => {
    const periods = periodList({ start: '2026-08-01', end: '2026-12-31', periodicity: 'monthly' })
    expect(periods.map((p) => p.label))
      .toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'])
  })

  test('a one-day year is one bucket at every periodicity', () => {
    for (const periodicity of PERIODICITIES) {
      const periods = periodList({ start: '2026-03-31', end: '2026-03-31', periodicity })
      expect(periods).toHaveLength(1)
      expect(periods[0]).toMatchObject({ from_date: '2026-03-31', to_date: '2026-03-31' })
    }
  })

  test('half-yearly over a year and a bit clips rather than overshooting', () => {
    const periods = periodList({ start: '2026-01-01', end: '2027-02-28', periodicity: 'half_yearly' })
    expect(periods).toHaveLength(3)
    expect(periods[2]).toMatchObject({ from_date: '2027-01-01', to_date: '2027-02-28' })
  })
})

// The property the whole workstream rests on (acceptance check C6).
describe('periodList — the buckets tile the year exactly', () => {
  const YEARS = [
    ['a calendar year', '2026-01-01', '2026-12-31'],
    ['a July-June year', '2026-07-01', '2027-06-30'],
    ['a year not starting on the first', '2026-04-15', '2027-04-14'],
    ['a year starting on the 31st', '2026-01-31', '2027-01-30'],
    ['a nine-month transitional year', '2026-01-01', '2026-09-30'],
    ['a year ending mid-month', '2026-03-01', '2027-02-14'],
    ['a leap-February year', '2028-01-01', '2028-12-31'],
    ['a single day', '2026-06-30', '2026-06-30'],
  ]

  for (const [name, start, end] of YEARS) {
    for (const periodicity of PERIODICITIES) {
      test(`${name} at ${periodicity}: every day in exactly one bucket`, () => {
        const periods = periodList({ start, end, periodicity })

        // No gap, no overlap: each of the year's days is in exactly one bucket.
        for (const day of eachDay(start, end)) {
          expect(bucketsContaining(periods, day)).toBe(1)
        }

        // The buckets cover the year and nothing outside it.
        expect(periods[0].from_date).toBe(start)
        expect(periods[periods.length - 1].to_date).toBe(end)

        // Consecutive: each bucket begins the day after the previous ended, and none is inverted.
        const days = eachDay(start, end)
        const indexOf = new Map(days.map((d, i) => [d, i]))
        for (let i = 0; i < periods.length; i++) {
          expect(indexOf.get(periods[i].from_date)).toBeLessThanOrEqual(indexOf.get(periods[i].to_date))
          if (i > 0) {
            expect(indexOf.get(periods[i].from_date))
              .toBe(indexOf.get(periods[i - 1].to_date) + 1)
          }
        }
      })
    }
  }

  test('a bucket boundary belongs to the later bucket and not to both', () => {
    const periods = periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'monthly' })
    // 31 January closes m01; 1 February opens m02. Neither date is in two buckets.
    expect(bucketsContaining(periods, '2026-01-31')).toBe(1)
    expect(bucketsContaining(periods, '2026-02-01')).toBe(1)
    expect(periods.find((p) => p.to_date === '2026-01-31').key).toBe('m01')
    expect(periods.find((p) => p.from_date === '2026-02-01').key).toBe('m02')
  })

  test('a day outside the year is in no bucket, so nothing outside the year can be counted', () => {
    const periods = periodList({ start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly' })
    expect(bucketsContaining(periods, '2026-06-30')).toBe(0)
    expect(bucketsContaining(periods, '2027-07-01')).toBe(0)
  })

  test('the bucket count matches the months the periodicity spans', () => {
    for (const [periodicity, months] of Object.entries(PERIODICITY_MONTHS)) {
      const periods = periodList({ start: '2026-01-01', end: '2026-12-31', periodicity })
      expect(periods).toHaveLength(12 / months)
    }
  })
})

describe('periodList — keys are stable, ordinal and safe as a SQL alias', () => {
  test('monthly keys are zero-padded so they sort in period order as text', () => {
    const keys = periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'monthly' })
      .map((p) => p.key)
    expect(keys).toEqual(['m01', 'm02', 'm03', 'm04', 'm05', 'm06',
      'm07', 'm08', 'm09', 'm10', 'm11', 'm12'])
    expect([...keys].sort()).toEqual(keys)
  })

  test('quarterly and half-yearly keys are q1..q4 and h1..h2', () => {
    expect(periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'quarterly' })
      .map((p) => p.key)).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'half_yearly' })
      .map((p) => p.key)).toEqual(['h1', 'h2'])
  })

  test('a key does not depend on the year, so the same month is the same key every year', () => {
    const a = periodList({ start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly' })
    const b = periodList({ start: '2027-07-01', end: '2028-06-30', periodicity: 'monthly' })
    expect(a.map((p) => p.key)).toEqual(b.map((p) => p.key))
  })

  test('keys are unique within a run, including for an accumulated run', () => {
    for (const accumulated of [false, true]) {
      for (const periodicity of PERIODICITIES) {
        const keys = periodList({ start: '2026-04-15', end: '2027-04-14', periodicity, accumulated })
          .map((p) => p.key)
        expect(new Set(keys).size).toBe(keys.length)
      }
    }
  })

  test('every key is recognised by the guard that lets it become a SQL alias', () => {
    for (const periodicity of PERIODICITIES) {
      for (const period of periodList({ start: '2026-01-01', end: '2026-12-31', periodicity })) {
        expect(isPeriodKey(period.key)).toBe(true)
        expect(assertPeriodKey(period.key)).toBe(period.key)
      }
    }
  })

  test('the guard refuses anything a caller could have injected', () => {
    expect(isPeriodKey('m1; DROP TABLE finance.transaction')).toBe(false)
    expect(isPeriodKey('actual_amount')).toBe(false)
    expect(isPeriodKey('')).toBe(false)
    expect(isPeriodKey(null)).toBe(false)
    expect(() => assertPeriodKey('m01 AS x, (SELECT 1)')).toThrow(/not a period key/)
  })
})

describe('periodList — accumulated mode is year-to-date', () => {
  test('every bucket runs from the year start and the label says so', () => {
    const periods = periodList({
      start: '2026-01-01', end: '2026-12-31', periodicity: 'quarterly', accumulated: true,
    })
    expect(periods).toEqual([
      { from_date: '2026-01-01', to_date: '2026-03-31', key: 'q1', label: 'To Mar 2026' },
      { from_date: '2026-01-01', to_date: '2026-06-30', key: 'q2', label: 'To Jun 2026' },
      { from_date: '2026-01-01', to_date: '2026-09-30', key: 'q3', label: 'To Sep 2026' },
      { from_date: '2026-01-01', to_date: '2026-12-31', key: 'q4', label: 'To Dec 2026' },
    ])
  })

  test('an accumulated July-June year accumulates from July, not from January', () => {
    const periods = periodList({
      start: '2026-07-01', end: '2027-06-30', periodicity: 'quarterly', accumulated: true,
    })
    expect(periods.every((p) => p.from_date === '2026-07-01')).toBe(true)
    expect(periods.map((p) => p.label))
      .toEqual(['To Sep 2026', 'To Dec 2026', 'To Mar 2027', 'To Jun 2027'])
  })

  test('the to_dates are the discrete buckets\' to_dates, unchanged', () => {
    const discrete = periodList({ start: '2026-04-15', end: '2027-04-14', periodicity: 'quarterly' })
    const running = periodList({ start: '2026-04-15', end: '2027-04-14', periodicity: 'quarterly', accumulated: true })
    expect(running.map((p) => p.to_date)).toEqual(discrete.map((p) => p.to_date))
    expect(running.map((p) => p.key)).toEqual(discrete.map((p) => p.key))
  })

  test('the last accumulated bucket is the whole year', () => {
    const periods = periodList({
      start: '2026-07-01', end: '2027-06-30', periodicity: 'monthly', accumulated: true,
    })
    expect(periods[periods.length - 1]).toMatchObject({
      from_date: '2026-07-01', to_date: '2027-06-30',
    })
  })

  test('an accumulated label states the day when the year does not end on a month end', () => {
    const periods = periodList({
      start: '2026-03-01', end: '2027-02-14', periodicity: 'yearly', accumulated: true,
    })
    expect(periods[0].label).toBe('To 14 Feb 2027')
  })
})

describe('periodList — it refuses rather than guesses', () => {
  test('an unknown periodicity is an error, not a silent default to monthly', () => {
    expect(() => periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'weekly' }))
      .toThrow(/periodicity must be one of/)
    expect(() => periodList({ start: '2026-01-01', end: '2026-12-31' }))
      .toThrow(/periodicity must be one of/)
    // Not satisfied by an inherited property.
    expect(() => periodList({ start: '2026-01-01', end: '2026-12-31', periodicity: 'constructor' }))
      .toThrow(/periodicity must be one of/)
  })

  test('an end before the start is an error', () => {
    expect(() => periodList({ start: '2026-12-31', end: '2026-01-01', periodicity: 'monthly' }))
      .toThrow(/is before start/)
  })

  test('a malformed or impossible date is an error', () => {
    expect(() => periodList({ start: '31/03/2026', end: '2026-12-31', periodicity: 'monthly' }))
      .toThrow(/must be a YYYY-MM-DD date/)
    expect(() => periodList({ start: null, end: '2026-12-31', periodicity: 'monthly' }))
      .toThrow(/must be a YYYY-MM-DD date/)
    expect(() => periodList({ start: '2026-02-30', end: '2026-12-31', periodicity: 'monthly' }))
      .toThrow(/not a date that exists/)
    expect(() => periodList({ start: '2026-13-01', end: '2026-12-31', periodicity: 'monthly' }))
      .toThrow(/not a date that exists/)
  })

  test('a timestamp is accepted by its date part, which is what dateText() hands over', () => {
    const periods = periodList({
      start: '2026-01-01T00:00:00.000Z', end: '2026-03-31', periodicity: 'monthly',
    })
    expect(periods).toHaveLength(3)
    expect(periods[0].from_date).toBe('2026-01-01')
  })

  test('a decade-long range is refused rather than producing a hundred columns', () => {
    expect(() => periodList({ start: '2020-01-01', end: '2030-12-31', periodicity: 'monthly' }))
      .toThrow(/that is a range, not a financial year/)
  })
})
