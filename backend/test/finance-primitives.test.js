/**
 * The finance primitives: money, dates, column mapping, and the row normaliser.
 *
 * These are the functions where a quiet mistake becomes a wrong figure in a council's published
 * accounts, so they are tested on their own, with no database and no HTTP, against the specific
 * ways a council's finance export is malformed in practice.
 */
const {
  parseMoney, parseDate, normaliseCurrency, normaliseCode, normaliseHeader, resolveColumns, cell,
} = require('../src/lib/finance')
const { normaliseRow } = require('../src/routes/finance-imports')

describe('parseMoney', () => {
  test('accepts the shapes a council export actually contains', () => {
    expect(parseMoney('1234.56')).toEqual({ ok: true, value: '1234.56' })
    expect(parseMoney('1,234.56')).toEqual({ ok: true, value: '1234.56' })
    expect(parseMoney('1 234 567.89')).toEqual({ ok: true, value: '1234567.89' })
    expect(parseMoney('USD 99')).toEqual({ ok: true, value: '99.00' })
    expect(parseMoney('$1,000')).toEqual({ ok: true, value: '1000.00' })
    expect(parseMoney('0')).toEqual({ ok: true, value: '0.00' })
  })

  test('reads accounting and trailing negatives', () => {
    expect(parseMoney('(2,500.00)')).toEqual({ ok: true, value: '-2500.00' })
    expect(parseMoney('-2500')).toEqual({ ok: true, value: '-2500.00' })
    expect(parseMoney('2500-')).toEqual({ ok: true, value: '-2500.00' })
  })

  test('treats a lone comma with one or two trailing digits as a decimal comma', () => {
    expect(parseMoney('1234,5')).toEqual({ ok: true, value: '1234.50' })
    expect(parseMoney('1234,56')).toEqual({ ok: true, value: '1234.56' })
    // Three digits after the comma is a thousands separator, not a decimal.
    expect(parseMoney('1,234')).toEqual({ ok: true, value: '1234.00' })
  })

  test('refuses rather than coerces', () => {
    expect(parseMoney('n/a').ok).toBe(false)
    expect(parseMoney('').ok).toBe(false)
    expect(parseMoney(null)).toEqual({ ok: false, reason: 'missing' })
    expect(parseMoney('#REF!').ok).toBe(false)
    expect(parseMoney('12.3.4').ok).toBe(false)
    expect(parseMoney('one thousand').ok).toBe(false)
    expect(parseMoney('1.234').reason).toBe('more_than_2_decimal_places')
    expect(parseMoney(Number.NaN).ok).toBe(false)
  })

  test('returns a string, never a number: the precision is the point', () => {
    const r = parseMoney('99999999999999.99')
    expect(r.ok).toBe(true)
    expect(typeof r.value).toBe('string')
    // The same figure as a float64 loses its last digits; the string does not.
    expect(r.value).toBe('99999999999999.99')
    expect(String(Number('99999999999999.99'))).not.toBe('99999999999999.99')
  })

  test('flags a JSON number as coerced so the caller knows precision may already be gone', () => {
    expect(parseMoney(1234.56)).toEqual({ ok: true, value: '1234.56', coerced_from_number: true })
  })
})

describe('parseDate', () => {
  test('reads ISO and day-first, which is Zimbabwean practice', () => {
    expect(parseDate('2026-03-31')).toEqual({ ok: true, value: '2026-03-31' })
    expect(parseDate('31/03/2026')).toEqual({ ok: true, value: '2026-03-31' })
    expect(parseDate('31-03-2026')).toEqual({ ok: true, value: '2026-03-31' })
    expect(parseDate('2026/03/31')).toEqual({ ok: true, value: '2026-03-31' })
  })

  test('reads month-first only when told to', () => {
    expect(parseDate('03/04/2026')).toEqual({ ok: true, value: '2026-04-03' })
    expect(parseDate('03/04/2026', { dayFirst: false })).toEqual({ ok: true, value: '2026-03-04' })
  })

  test('refuses a date that does not exist instead of rolling it forward', () => {
    expect(parseDate('2026-02-30')).toEqual({ ok: false, reason: 'date_does_not_exist' })
    expect(parseDate('31/02/2026')).toEqual({ ok: false, reason: 'date_does_not_exist' })
    expect(parseDate('2026-13-01').reason).toBe('date_out_of_range')
    expect(parseDate('not a date').reason).toBe('unrecognised_date_format')
    expect(parseDate('').reason).toBe('missing')
  })
})

describe('currency and code normalisation', () => {
  test('only USD and ZWG are storable', () => {
    expect(normaliseCurrency('usd')).toBe('USD')
    expect(normaliseCurrency(' ZWG ')).toBe('ZWG')
    // ZWL was demonetised; accepting it silently as ZWG would restate history.
    expect(normaliseCurrency('ZWL')).toBeNull()
    expect(normaliseCurrency('ZAR')).toBeNull()
  })

  test('a header is matched loosely, an account code strictly', () => {
    expect(normaliseHeader('Vote Code')).toBe(normaliseHeader('vote_code'))
    expect(normaliseHeader('GL-Code')).toBe(normaliseHeader('glcode'))
    // Two different accounts must not collapse into one.
    expect(normaliseCode('01-100')).not.toBe(normaliseCode('01100'))
    expect(normaliseCode(' 1100 ')).toBe('1100')
  })
})

describe('resolveColumns', () => {
  const mapping = {
    department_code: ['vote', 'department_code'],
    account_code: ['economic_line', 'glcode'],
    amount: ['amount', 'value'],
  }

  test('matches aliases case- and separator-insensitively', () => {
    const r = resolveColumns(mapping, ['Vote', 'GL Code', 'Value', 'Narration'])
    expect(r.resolved.department_code.header).toBe('Vote')
    expect(r.resolved.account_code.header).toBe('GL Code')
    expect(r.resolved.amount.header).toBe('Value')
    expect(r.unmatchedTargets).toEqual([])
    expect(r.unusedHeaders).toEqual(['Narration'])
  })

  test('reports what it could not match rather than guessing', () => {
    const r = resolveColumns(mapping, ['Something', 'Else'])
    expect(r.unmatchedTargets.sort()).toEqual(['account_code', 'amount', 'department_code'])
    expect(Object.keys(r.resolved)).toEqual([])
  })

  test('an explicit override beats the alias list', () => {
    const r = resolveColumns(mapping, ['Vote', 'Mystery Column'], { account_code: 'Mystery Column' })
    expect(r.resolved.account_code.header).toBe('Mystery Column')
  })

  test('cell() returns undefined for an unmapped field, never a blank', () => {
    const r = resolveColumns(mapping, ['Vote', 'Value'])
    expect(cell(r.resolved, ['01', '5'], 'department_code')).toBe('01')
    expect(cell(r.resolved, ['01', '5'], 'account_code')).toBeUndefined()
  })
})

describe('normaliseRow', () => {
  const lookups = {
    departments: new Map([['01', { id: 'dept-1', code: '01', status: 'active' }],
      ['99', { id: 'dept-9', code: '99', status: 'inactive' }]]),
    accounts: new Map([
      ['1100', { id: 'acct-r', code: '1100', kind: 'revenue', is_postable: true, status: 'active' }],
      ['5100', { id: 'acct-e', code: '5100', kind: 'expenditure', is_postable: true, status: 'active' }],
      ['5000', { id: 'acct-h', code: '5000', kind: 'expenditure', is_postable: false, status: 'active' }],
    ]),
    programmes: new Map(), activities: new Map(),
    lines: new Map([['01-5100', { id: 'line-1', code: '01-5100', currency: 'USD', department_id: 'dept-1', account_id: 'acct-e' }]]),
    projects: new Map([['P-001', { id: 'proj-1', reference: 'P-001' }]]),
    wards: new Map([['ZW1921', { code: 'ZW1921' }]]),
  }
  const defaults = { currency: 'USD', year_start: '2026-01-01', year_end: '2026-12-31', year_label: '2026' }
  const headers = ['Vote', 'GL Code', 'Date', 'Amount', 'Narration', 'Ward', 'Project', 'Currency']
  const resolved = resolveColumns({
    department_code: ['vote'], account_code: ['glcode'], txn_date: ['date'],
    amount: ['amount'], description: ['narration'], ward_code: ['ward'],
    project_ref: ['project'], currency: ['currency'],
  }, headers).resolved

  const run = (row, dataset = 'actuals') =>
    normaliseRow({ dataset, resolved, row, lookups, defaults, dayFirst: true })

  test('a clean expenditure row maps to its account, department and budget line', () => {
    const { out, issues } = run(['01', '5100', '31/03/2026', '1,250.00', 'Grader hire', 'ZW1921', 'P-001', 'USD'])
    expect(issues).toEqual([])
    expect(out.account_id).toBe('acct-e')
    expect(out.department_id).toBe('dept-1')
    expect(out.budget_line_id).toBe('line-1')
    expect(out.ward_code).toBe('ZW1921')
    expect(out.project_id).toBe('proj-1')
    expect(out.amount).toBe('1250.00')
    expect(out.currency).toBe('USD')
    expect(out.txn_date).toBe('2026-03-31')
  })

  test('an unknown account code is an exception, not a default', () => {
    const { out, issues } = run(['01', '9999', '31/03/2026', '100', 'x', '', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('UNKNOWN_ACCOUNT_CODE')
    expect(out.account_id).toBeUndefined()
    // Nothing in the output silently stands in for the account.
    expect(JSON.stringify(out)).not.toMatch(/misc|default|unknown_account/i)
  })

  test('an unknown department is an exception, not assigned to a catch-all', () => {
    const { issues } = run(['77', '5100', '31/03/2026', '100', 'x', '', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('UNKNOWN_DEPARTMENT_CODE')
  })

  test('a heading account cannot carry a transaction', () => {
    const { issues } = run(['01', '5000', '31/03/2026', '100', 'x', '', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('ACCOUNT_NOT_POSTABLE')
  })

  test('an inactive department is refused', () => {
    const { issues } = run(['99', '5100', '31/03/2026', '100', 'x', '', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('DEPARTMENT_INACTIVE')
  })

  test('a date outside the financial year is flagged, not silently accepted', () => {
    const { issues } = run(['01', '5100', '31/03/2025', '100', 'x', '', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('DATE_OUTSIDE_FINANCIAL_YEAR')
  })

  test('an unsupported currency is refused rather than converted', () => {
    const { issues } = run(['01', '5100', '31/03/2026', '100', 'x', '', '', 'ZAR'])
    expect(issues.map((i) => i.error_code)).toContain('UNSUPPORTED_CURRENCY')
  })

  test('a missing currency falls back to the financial year, and says so', () => {
    const { out } = run(['01', '5100', '31/03/2026', '100', 'x', '', '', ''])
    expect(out.currency).toBe('USD')
    expect(out.currency_from_financial_year).toBe(true)
  })

  test('an unreadable amount is an exception with the reason named', () => {
    const { issues } = run(['01', '5100', '31/03/2026', 'n/a', 'x', '', '', ''])
    const issue = issues.find((i) => i.field === 'amount')
    expect(issue.error_code).toBe('INVALID_AMOUNT')
    expect(issue.message).toMatch(/not_a_number/)
  })

  test('a row with no source reference gets a deterministic derived one', () => {
    const row = ['01', '5100', '31/03/2026', '100', 'Fuel', '', '', '']
    const a = run(row).out.source_ref
    const b = run([...row]).out.source_ref
    expect(a).toBe(b)
    expect(a).toMatch(/^derived:[0-9a-f]{32}$/)
    expect(run(row).out.source_ref_derived).toBe(true)
    // A different amount is a different row.
    expect(run(['01', '5100', '31/03/2026', '101', 'Fuel', '', '', '']).out.source_ref).not.toBe(a)
  })

  test('an unresolved ward is recorded, not fabricated', () => {
    const { out, issues } = run(['01', '5100', '31/03/2026', '100', 'x', 'ZW9999', '', ''])
    expect(issues.map((i) => i.error_code)).toContain('UNKNOWN_WARD_CODE')
    expect(out.ward_code).toBeUndefined()
  })

  test('an unresolved project reference is kept for the officer, not invented', () => {
    const { out } = run(['01', '5100', '31/03/2026', '100', 'x', '', 'P-404', ''])
    expect(out.project_id).toBeUndefined()
    expect(out.unresolved_project_ref).toBe('P-404')
  })

  test('a negative budget allocation is refused; a reduction is a revision', () => {
    const budgetResolved = resolveColumns({
      department_code: ['vote'], account_code: ['glcode'], amount: ['amount'], description: ['narration'],
    }, headers).resolved
    const { issues } = normaliseRow({
      dataset: 'budget', resolved: budgetResolved,
      row: ['01', '5100', '', '-500', 'Cut', '', '', ''], lookups, defaults, dayFirst: true,
    })
    expect(issues.map((i) => i.error_code)).toContain('NEGATIVE_BUDGET')
  })

  test('an actual with no matching budget line is posted but flagged', () => {
    // 1100 is a revenue account with no budget line in the fixtures.
    const { out, issues } = run(['01', '1100', '31/03/2026', '100', 'Rates', '', '', ''])
    expect(issues).toEqual([])
    expect(out.budget_line_id).toBeUndefined()
    expect(out.no_matching_budget_line).toBe(true)
  })
})
