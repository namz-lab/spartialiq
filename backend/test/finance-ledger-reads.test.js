// test/finance-ledger-reads.test.js
// The CSV writer behind every ledger export (src/lib/financeCsv.js). No database.
//
// A ledger export is opened in a spreadsheet, so two things matter beyond RFC 4180: a figure must
// arrive exactly as the server computed it (never re-formatted, never parsed), and a text cell that
// a spreadsheet would read as a formula must not be one.
const { toCsv } = require('../src/lib/financeCsv')

const columns = [
  { header: 'Narration', key: 'narration' },
  { header: 'Debit', key: 'debit', type: 'amount' },
  { header: 'Credit', key: 'credit', type: 'amount' },
]

describe('toCsv', () => {
  test('a header line, then one line per row, each ended with CRLF', () => {
    const text = toCsv(columns, [
      { narration: 'Income banked', debit: '50.00', credit: '0.00' },
      { narration: 'Expense paid', debit: '0.00', credit: '2000.00' },
    ])
    expect(text).toBe('Narration,Debit,Credit\r\nIncome banked,50.00,0.00\r\nExpense paid,0.00,2000.00\r\n')
  })

  test('a value holding a comma or a quote is quoted, and its quotes are doubled (RFC 4180)', () => {
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: 'a,"b"' }])).toBe('x\r\n"a,""b"""\r\n')
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: 'say "no"' }])).toBe('x\r\n"say ""no"""\r\n')
  })

  test('a value holding a line break is quoted, and the break is kept as it was', () => {
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: 'two\nlines' }])).toBe('x\r\n"two\nlines"\r\n')
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: 'two\r\nlines' }])).toBe('x\r\n"two\r\nlines"\r\n')
  })

  test('a missing or null value is an empty cell, not the word null', () => {
    expect(toCsv(columns, [{ narration: null, debit: undefined }])).toBe('Narration,Debit,Credit\r\n,,\r\n')
  })

  test('a text cell a spreadsheet would read as a formula is prefixed with an apostrophe', () => {
    const text = toCsv([{ header: 'x', key: 'x' }], [
      { x: '=SUM(A1:A9)' }, { x: '+27 77 000' }, { x: '-cmd' }, { x: '@risk' }, { x: 'plain' },
    ])
    expect(text.split('\r\n')).toEqual(["x", "'=SUM(A1:A9)", "'+27 77 000", "'-cmd", "'@risk", 'plain', ''])
  })

  test('a text cell starting with a TAB is guarded, since a spreadsheet may strip it and read a formula', () => {
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: '\t=1+1' }, { x: '\tplain' }]))
      .toBe("x\r\n'\t=1+1\r\n'\tplain\r\n")
  })

  test('a text cell starting with a carriage return is guarded, and then quoted for its line break', () => {
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: '\r=cmd' }])).toBe('x\r\n"\'\r=cmd"\r\n')
  })

  test('an amount is not guarded for a TAB or CR either: an amount column is written as sent', () => {
    expect(toCsv([{ header: 'a', key: 'a', type: 'amount' }], [{ a: '\t5.00' }])).toBe('a\r\n\t5.00\r\n')
  })

  test('the guard comes before the quoting, so a guarded value that also needs quotes is both', () => {
    expect(toCsv([{ header: 'x', key: 'x' }], [{ x: '=HYPERLINK("http://x","y")' }]))
      .toBe('x\r\n"\'=HYPERLINK(""http://x"",""y"")"\r\n')
  })

  test('an amount is left exactly as the server sent it: a negative figure keeps its sign, no apostrophe', () => {
    const text = toCsv(columns, [{ narration: 'Net', debit: '-450.00', credit: '1234567.10' }])
    expect(text).toBe('Narration,Debit,Credit\r\nNet,-450.00,1234567.10\r\n')
  })

  test('values are never re-formatted: trailing zeros, leading zeros and long decimals stay', () => {
    const text = toCsv([{ header: 'a', key: 'a', type: 'amount' }, { header: 'code', key: 'code' }],
      [{ a: '0.10', code: '00120' }, { a: '99999999999999.99', code: '1.50' }])
    expect(text).toBe('a,code\r\n0.10,00120\r\n99999999999999.99,1.50\r\n')
  })

  test('a header is written through the same rules as a cell', () => {
    expect(toCsv([{ header: 'Debit, USD', key: 'd' }], [])).toBe('"Debit, USD"\r\n')
  })

  test('a non-string value is written as its text, never as a computed figure', () => {
    expect(toCsv([{ header: 'n', key: 'n' }, { header: 'b', key: 'b' }], [{ n: 5, b: false }])).toBe('n,b\r\n5,false\r\n')
  })
})
