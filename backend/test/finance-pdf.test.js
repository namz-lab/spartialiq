/**
 * The PDF a council puts in a committee pack.
 *
 * A PDF is the format nobody re-checks: once it is printed and tabled, whatever it says is what
 * the committee believes. So the tests here are about the things that would be believed wrongly —
 * an amount rounded by a float, a combined total across two currencies, a restricted file that
 * does not admit it is restricted, a page of figures with no statement of which year they are.
 *
 * Text is read back out of the PDF by inflating its content streams, which is why these assertions
 * can speak about what the page actually says rather than only about its byte count.
 */
const { buildPdf } = require('../src/lib/report-pdf')
const { pdfLines, pdfText, pdfPageCount: pageCount, pdfMediaBox: mediaBox } = require('./helpers/pdf-text')

const COLUMNS = [
  { header: 'Department', key: 'department_name' },
  { header: 'Account', key: 'account_name' },
  { header: 'Currency', key: 'currency' },
  { header: 'Original budget', key: 'original_amount', type: 'number' },
  { header: 'Actual', key: 'actual_amount', type: 'number' },
]

const META = [
  ['Council', 'Vungu Rural District Council'],
  ['Financial year', '2026 (2026-01-01 to 2026-12-31)'],
  ['Currency treatment', 'USD and ZWG are reported separately. No exchange rate is applied and no total combines them.'],
  ['Rows', '2'],
]

const ROWS = [
  { department_name: 'Roads', account_name: 'Fuel and lubricants', currency: 'USD', original_amount: '120000.00', actual_amount: '98765.43' },
  { department_name: 'Health', account_name: 'Clinic drugs', currency: 'ZWG', original_amount: '4500000.50', actual_amount: '1234567.89' },
]

describe('financial report PDF', () => {
  test('is a well-formed PDF document', async () => {
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: ROWS, meta: META })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
  })

  test('the cover states the council, the year and the currency rule (specification 3.9)', async () => {
    const text = pdfText(await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: ROWS, meta: META }))
    expect(text).toContain('Vungu Rural District Council')
    expect(text).toContain('Budget versus actual')
    expect(text).toContain('2026 (2026-01-01 to 2026-12-31)')
    expect(text).toContain('USD and ZWG are reported separately')
  })

  test('amounts are drawn exactly as the database produced them, with no float rounding', async () => {
    const rows = [
      { department_name: 'Roads', account_name: 'Grading', currency: 'USD', original_amount: '0.10', actual_amount: '0.20' },
      { department_name: 'Water', account_name: 'Boreholes', currency: 'USD', original_amount: '9007199254740993.01', actual_amount: '1234567.89' },
    ]
    const text = pdfText(await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows, meta: [] }))
    // 0.1 + 0.2 and an integer past 2^53 are the two places a float would show itself.
    expect(text).toContain('0.10')
    expect(text).toContain('0.20')
    expect(text).toContain('9007199254740993.01')
    expect(text).toContain('1234567.89')
  })

  test('adds no total row, so two currencies cannot appear added together (A8)', async () => {
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: ROWS, meta: META })
    // No drawn line is a total label. (The cover's currency sentence contains the word "total" --
    // "no total combines them" -- which is the statement, not a total row.)
    expect(pdfLines(buf).filter((l) => /^\s*(sub)?total\b/i.test(l))).toEqual([])
    // And the arithmetic itself appears nowhere: 120000.00 + 4500000.50 across two currencies.
    const text = pdfText(buf)
    expect(text).not.toContain('4620000.50')
    expect(text).not.toContain('4620000.5')
  })

  test('a restricted export says so on the cover and on every page', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      department_name: `Department ${i}`, account_name: 'Supplier payment', currency: 'USD',
      original_amount: '100.00', actual_amount: '100.00',
    }))
    const buf = await buildPdf({ title: 'Transaction register', columns: COLUMNS, rows: many, meta: META, restricted: true })
    const pages = pageCount(buf)
    expect(pages).toBeGreaterThan(1)

    expect(pdfText(buf)).toContain('RESTRICTED — contains supplier or beneficiary identities. Not for publication.')
    // The short footer mark, once per page.
    const marks = pdfLines(buf).filter((l) => l === 'RESTRICTED').length
    expect(marks).toBe(pages)
  })

  test('an unrestricted export carries no restricted marking', async () => {
    const text = pdfText(await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: ROWS, meta: META }))
    expect(text).not.toContain('RESTRICTED')
  })

  test('every page is numbered, and the count is the real number of pages', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      department_name: `Department ${i}`, account_name: 'Operating costs', currency: 'USD',
      original_amount: '1.00', actual_amount: '2.00',
    }))
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: many, meta: META })
    const pages = pageCount(buf)
    const text = pdfText(buf)
    expect(text).toContain(`Page 1 of ${pages}`)
    expect(text).toContain(`Page ${pages} of ${pages}`)
  })

  test('the column headers repeat on each page, so a later page is readable alone', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      department_name: `Department ${i}`, account_name: 'Operating costs', currency: 'USD',
      original_amount: '1.00', actual_amount: '2.00',
    }))
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: many, meta: META })
    const headerCount = pdfLines(buf).filter((l) => l === 'Original budget').length
    // One per table page: every page except the cover.
    expect(headerCount).toBe(pageCount(buf) - 1)
  })

  test('an amount is never broken across two lines, however wide the report', async () => {
    // A wide report forces the layout to shrink columns. "400000.00" split after "400000.0"
    // reads as a different number, so amounts must survive the squeeze intact and the text
    // columns must absorb it instead.
    const columns = [
      { header: 'Department code', key: 'dept' },
      { header: 'Department', key: 'deptName' },
      { header: 'Account code', key: 'acct' },
      { header: 'Account', key: 'acctName' },
      { header: 'Revenue/expenditure', key: 'kind' },
      { header: 'Budget line', key: 'line' },
      { header: 'Description', key: 'description' },
      { header: 'Currency', key: 'currency' },
      { header: 'Original budget', key: 'original', type: 'number' },
      { header: 'Approved adjustments', key: 'adjust', type: 'number' },
      { header: 'Revised budget', key: 'revised', type: 'number' },
      { header: 'Actual', key: 'actual', type: 'number' },
      { header: 'Open commitments', key: 'commitments', type: 'number' },
      { header: 'Available (excl. commitments)', key: 'availExcl', type: 'number' },
      { header: 'Available (incl. commitments)', key: 'availIncl', type: 'number' },
      { header: 'Execution %', key: 'execution', type: 'number' },
      { header: 'Variance', key: 'variance', type: 'number' },
    ]
    const amounts = {
      original: '400000.00', adjust: '0.00', revised: '400000.00', actual: '0.00',
      commitments: '0.00', availExcl: '18500000.00', availIncl: '18500000.00',
      execution: '0.00', variance: '-400000.00',
    }
    const rows = [{
      dept: 'DEMO-ENG', deptName: 'Engineering (demo)', acct: 'DEMO-1100',
      acctName: 'Rates and charges (demo)', kind: 'revenue', line: 'DEMO-L2',
      description: 'Rates collection (demo)', currency: 'USD', ...amounts,
    }]
    const lines = pdfLines(await buildPdf({ title: 'Budget versus actual', columns, rows, meta: [] }))
    // Each amount appears as one whole drawn line -- not as a fragment of one.
    for (const value of new Set(Object.values(amounts))) {
      expect(lines).toContain(value)
    }
    // And no line is a truncated amount: a decimal point with fewer than two digits after it.
    expect(lines.filter((l) => /^-?\d+\.\d$/.test(l))).toEqual([])
  })

  test('a report with no rows says so rather than printing an empty grid', async () => {
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows: [], meta: META })
    expect(pdfText(buf)).toContain('This report returned no rows for the filters on the cover.')
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('a wide report is laid out landscape so its columns are not crushed', async () => {
    const wide = Array.from({ length: 14 }, (_, i) => ({ header: `Column ${i}`, key: `c${i}` }))
    const row = Object.fromEntries(wide.map((c, i) => [c.key, `value ${i}`]))
    const [w, h] = mediaBox(await buildPdf({ title: 'Wide', columns: wide, rows: [row], meta: [] }))
    expect(w).toBeGreaterThan(h)
  })

  test('a narrow report stays portrait', async () => {
    const narrow = [{ header: 'Vote', key: 'a' }, { header: 'Amount', key: 'b', type: 'number' }]
    const [w, h] = mediaBox(await buildPdf({ title: 'Narrow', columns: narrow, rows: [{ a: 'Roads', b: '1.00' }], meta: [] }))
    expect(h).toBeGreaterThan(w)
  })

  test('a blank cell is blank, not the word null or undefined', async () => {
    const rows = [{ department_name: null, account_name: undefined, currency: 'USD', original_amount: '1.00', actual_amount: '2.00' }]
    const text = pdfText(await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows, meta: [] }))
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')
  })

  test('a very long description wraps instead of overrunning its column', async () => {
    const long = 'A description long enough that it cannot possibly fit inside one narrow column of a table '.repeat(4)
    const rows = [{ department_name: 'Roads', account_name: long, currency: 'USD', original_amount: '1.00', actual_amount: '2.00' }]
    const buf = await buildPdf({ title: 'Budget versus actual', columns: COLUMNS, rows, meta: [] })
    // It renders, and the text is present in some wrapped form.
    expect(pdfText(buf)).toContain('A description long enough')
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
