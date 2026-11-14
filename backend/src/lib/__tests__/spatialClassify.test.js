const { computeBreaks, fixedBreaks, classify, reliabilityOf, rankWards } = require('../spatialClassify')

describe('computeBreaks', () => {
  test('gives upper edges over the distinct values', () => {
    expect(computeBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([3, 5, 6, 8])
  })

  test('has no scale for fewer than two distinct values', () => {
    expect(computeBreaks([])).toEqual([])
    expect(computeBreaks([4])).toEqual([])
    expect(computeBreaks([4, 4, 4])).toEqual([])
  })

  test('never repeats an edge, so no class is empty', () => {
    const b = computeBreaks([0, 0, 0, 0, 0, 0, 0, 1, 1, 9], 5)
    expect(b).toEqual([...new Set(b)])
    expect(b).toEqual([...b].sort((x, y) => x - y))
  })

  test('ignores non-finite values', () => {
    expect(computeBreaks([1, Number.NaN, 2, Infinity, 3, 4], 3)).toEqual(computeBreaks([1, 2, 3, 4], 3))
  })
})

describe('fixedBreaks', () => {
  test('accepts increasing policy thresholds within the class limits', () => {
    expect(fixedBreaks([25, 50, 75])).toEqual([25, 50, 75])
  })
  test.each([
    [[50, 25, 75], /increasing/],
    [[10, 10, 20], /increasing/],
    [[10], /classes/],
    [[1, 2, 3, 4, 5, 6, 7], /classes/],
    [[1, 'x', 3], /finite/],
  ])('rejects %j', (input, message) => {
    expect(() => fixedBreaks(input)).toThrow(message)
  })
})

describe('classify', () => {
  test('quantile reports its method and class count', () => {
    const c = classify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { classes: 5 })
    expect(c).toEqual({ method: 'quantile', breaks: [3, 5, 6, 8], classes: 5 })
  })
  test('keeps the class count within 3 to 7', () => {
    expect(classify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { classes: 20 }).classes).toBeLessThanOrEqual(7)
    expect(classify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { classes: 1 }).classes).toBeGreaterThanOrEqual(3)
  })
  test('fixed uses the policy thresholds as given', () => {
    expect(classify([1, 2, 3], { method: 'fixed', fixed: [25, 50, 75] })).toEqual({ method: 'fixed', breaks: [25, 50, 75], classes: 4 })
  })
  test('a single value is flat: no breaks, no classes', () => {
    expect(classify([7, 7], {})).toEqual({ method: 'quantile', breaks: [], classes: 0 })
  })
})

describe('reliabilityOf', () => {
  test('no value is no data, never zero', () => {
    expect(reliabilityOf({ value: null, denominator: 100, minDenominator: 30 })).toBe('no_data')
    expect(reliabilityOf({ value: undefined })).toBe('no_data')
  })
  test('a base below the minimum is small_base', () => {
    expect(reliabilityOf({ value: 50, denominator: 12, minDenominator: 30 })).toBe('small_base')
  })
  test('a base at or above the minimum is ok, and so is a measure with no minimum', () => {
    expect(reliabilityOf({ value: 50, denominator: 30, minDenominator: 30 })).toBe('ok')
    expect(reliabilityOf({ value: 50, denominator: 3, minDenominator: null })).toBe('ok')
    expect(reliabilityOf({ value: 0, denominator: 100, minDenominator: 30 })).toBe('ok')
  })
})

describe('rankWards', () => {
  const rows = [
    { ward_code: 'A', value: 10, reliability: 'ok' },
    { ward_code: 'B', value: 30, reliability: 'ok' },
    { ward_code: 'C', value: 30, reliability: 'ok' },
    { ward_code: 'D', value: 5, reliability: 'small_base' },
    { ward_code: 'E', value: null, reliability: 'no_data' },
  ]
  test('ties share a rank and unreliable or empty wards are not ranked', () => {
    const r = rankWards(rows, 'higher_is_better')
    expect(r.get('B')).toBe(1)
    expect(r.get('C')).toBe(1)
    expect(r.get('A')).toBe(3)
    expect(r.has('D')).toBe(false)
    expect(r.has('E')).toBe(false)
  })
  test('lower_is_better ranks the lowest value first', () => {
    const r = rankWards(rows, 'lower_is_better')
    expect(r.get('A')).toBe(1)
    expect(r.get('B')).toBe(2)
  })
})
