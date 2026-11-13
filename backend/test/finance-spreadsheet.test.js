/**
 * Reading and writing the files a council actually hands over.
 *
 * The reader is where an import quietly goes wrong: a blank column shifts every amount one place
 * left, a date arrives as 46112, a byte-order mark makes the first column unmappable. Each of
 * those is a test here.
 */
const JSZip = require('jszip')
const { readTabular, readCsv, serialToIsoDate, formatIsDate, columnIndex } = require('../src/lib/spreadsheet')
const { buildXlsx, buildCsv, columnLetter } = require('../src/lib/spreadsheet-write')

/** A minimal but valid workbook, built by hand so the fixture is readable in the test. */
async function makeWorkbook({ sheetName = 'Data', strings, styles, sheetXml, sheetPart = 'data.xml' }) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>')
  zip.folder('_rels').file('.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const xl = zip.folder('xl')
  xl.file('workbook.xml', `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetPart}"/></Relationships>`)
  if (strings) {
    xl.file('sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings}</sst>`)
  }
  xl.file('styles.xml', styles || '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>')
  xl.folder('worksheets').file(sheetPart, `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const si = (...values) => values.map((v) => `<si><t>${v}</t></si>`).join('')

describe('CSV reading', () => {
  test('detects a semicolon delimiter, which a decimal-comma locale exports', () => {
    const r = readCsv(Buffer.from('Vote;GL Code;Value\n01;1100;1 234,56\n'))
    expect(r.delimiter).toBe(';')
    expect(r.headers).toEqual(['Vote', 'GL Code', 'Value'])
    expect(r.rows).toEqual([['01', '1100', '1 234,56']])
  })

  test('detects a tab delimiter', () => {
    const r = readCsv(Buffer.from('Vote\tAmount\n01\t5\n'))
    expect(r.delimiter).toBe('\t')
    expect(r.headers).toEqual(['Vote', 'Amount'])
  })

  test('strips a byte-order mark so the first column is mappable', () => {
    const r = readCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Vote,Amount\n01,5\n')]))
    expect(r.headers[0]).toBe('Vote')
    expect(r.headers[0].charCodeAt(0)).toBe(0x56) // 'V', not the BOM
  })

  test('keeps quoted commas inside one field', () => {
    const r = readCsv(Buffer.from('Code,Description\n01,"Roads, bridges and drains"\n'))
    expect(r.rows[0][1]).toBe('Roads, bridges and drains')
  })

  test('tolerates a ragged row rather than aborting the file', () => {
    const r = readCsv(Buffer.from('A,B,C\n1,2\n1,2,3,4\n'))
    expect(r.rows).toHaveLength(2)
  })
})

describe('XLSX reading', () => {
  test('places cells by their reference, so a blank column does not shift the amounts', async () => {
    // Row 3 omits A and C entirely. Reading in document order would put '500' in column B.
    const buf = await makeWorkbook({
      strings: si('Vote', 'GL', 'Date', 'Amount', '01', '1100'),
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
        + '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="D2"><v>1250</v></c></row>'
        + '<row r="3"><c r="B3" t="s"><v>5</v></c><c r="D3"><v>500</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.headers).toEqual(['Vote', 'GL', 'Date', 'Amount'])
    expect(r.rows[0]).toEqual(['01', '1100', null, '1250'])
    expect(r.rows[1]).toEqual([null, '1100', null, '500'])
  })

  test('converts a date-formatted number to an ISO date', async () => {
    const buf = await makeWorkbook({
      strings: si('Date'),
      styles: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" s="1"><v>46112</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.rows[0][0]).toBe('2026-03-31')
  })

  test('leaves a plain number a number, even under a style', async () => {
    const buf = await makeWorkbook({
      strings: si('Amount'),
      styles: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" s="1"><v>46112</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.rows[0][0]).toBe('46112')
  })

  test('joins a rich-text shared string instead of truncating it', async () => {
    const buf = await makeWorkbook({
      strings: '<si><t>Name</t></si><si><r><t>Bulawayo </t></r><r><t>City Works</t></r></si>',
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.rows[0][0]).toBe('Bulawayo City Works')
  })

  test('reads an inline string and keeps an error cell legible', async () => {
    const buf = await makeWorkbook({
      sheetXml: '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c></row>'
        + '<row r="2"><c r="A2" t="e"><v>#REF!</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.headers).toEqual(['Amount'])
    expect(r.rows[0][0]).toBe('#REF!')
  })

  test('skips a title banner above the header row', async () => {
    const buf = await makeWorkbook({
      strings: si('', 'Vote', 'Amount'),
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
        + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>'
        + '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>7</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.headers).toEqual(['Vote', 'Amount'])
  })

  test('finds the worksheet through the relationship, not by assuming sheet1.xml', async () => {
    const buf = await makeWorkbook({
      sheetName: 'Expenditure', sheetPart: 'somewhere-else.xml',
      strings: si('A'),
      sheetXml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
    })
    const r = await readTabular(buf, 'f.xlsx')
    expect(r.sheetName).toBe('Expenditure')
    expect(r.headers).toEqual(['A'])
  })

  test('says plainly that a legacy binary .xls is not supported', async () => {
    const xls = Buffer.alloc(16)
    xls[0] = 0xd0; xls[1] = 0xcf
    await expect(readTabular(xls, 'old.xls')).rejects.toThrow('legacy_xls_not_supported')
  })

  test('refuses a file named .xlsx that is not a workbook', async () => {
    await expect(readTabular(Buffer.from('Vote,Amount\n1,2\n'), 'lying.xlsx'))
      .rejects.toThrow('not_a_valid_xlsx')
  })

  test('refuses an empty file', async () => {
    await expect(readTabular(Buffer.alloc(0), 'x.csv')).rejects.toThrow('empty_file')
  })
})

describe('helpers', () => {
  test('column references round-trip', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
  })

  test('the 1900 leap-year quirk is reproduced, because every spreadsheet does', () => {
    expect(serialToIsoDate(1)).toBe('1900-01-01')
    expect(serialToIsoDate(61)).toBe('1900-03-01')
    expect(serialToIsoDate(46112)).toBe('2026-03-31')
    expect(serialToIsoDate(0)).toBeNull()
    expect(serialToIsoDate('nope')).toBeNull()
  })

  test('a date format is recognised, a number format is not', () => {
    expect(formatIsDate('dd/mm/yyyy')).toBe(true)
    expect(formatIsDate('yyyy-mm-dd hh:mm')).toBe(true)
    expect(formatIsDate('#,##0.00')).toBe(false)
    expect(formatIsDate('General')).toBe(false)
    // A quoted literal must not make a currency format look like a date.
    expect(formatIsDate('"May" #,##0')).toBe(false)
  })
})

describe('export writing', () => {
  test('an exported workbook reads back with its amounts as numbers', async () => {
    const buf = await buildXlsx({
      meta: [['Council', 'Vungu RDC']],
      sheets: [{
        name: 'Budget vs actual',
        columns: [
          { header: 'Code', key: 'code' },
          { header: 'Amount', key: 'amount', type: 'number' },
          { header: 'Date', key: 'd', type: 'date' },
        ],
        rows: [{ code: '01-5100', amount: '12345.67', d: '2026-03-31' }],
      }],
    })
    // The first sheet is the "About this export" sheet the specification's §3.9 metadata lives on.
    const about = await readTabular(buf, 'x.xlsx')
    expect(about.sheetName).toBe('About this export')
    expect(about.rows[0]).toEqual(['Council', 'Vungu RDC'])

    // The data sheet is a separate part; read it directly.
    const zip = await JSZip.loadAsync(buf)
    const sheet2 = await zip.file('xl/worksheets/sheet2.xml').async('string')
    expect(sheet2).toContain('<v>12345.67</v>')     // numeric cell, not text
    expect(sheet2).toContain('<t>2026-03-31</t>')
  })

  test('a sheet name is trimmed to what a workbook allows', async () => {
    const buf = await buildXlsx({
      sheets: [{ name: 'a:b/c?d*e[f]g that is far too long to be a sheet name', columns: [{ header: 'A', key: 'a' }], rows: [] }],
    })
    const zip = await JSZip.loadAsync(buf)
    const wb = await zip.file('xl/workbook.xml').async('string')
    const name = /name="([^"]+)"/.exec(wb)[1]
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name).not.toMatch(/[:\\/?*[\]]/)
  })

  test('control characters are stripped so the workbook is not rejected', async () => {
    const buf = await buildXlsx({
      sheets: [{ columns: [{ header: 'A', key: 'a' }], rows: [{ a: 'bad\u0000char' }], name: 'S' }],
    })
    const zip = await JSZip.loadAsync(buf)
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string')
    expect(sheet).toContain('badchar')
    expect(sheet).not.toContain('\u0000')
  })

  test('CSV quotes to RFC 4180 and neutralises a formula-looking cell', () => {
    const csv = buildCsv({
      columns: [{ header: 'A', key: 'a' }],
      rows: [{ a: '=HYPERLINK("http://x","click")' }, { a: 'has,comma and "quote"' }],
    }).toString('utf8')
    // The leading = is prefixed with a tab, so a spreadsheet shows the text and runs nothing.
    expect(csv).toMatch(/"?\t=HYPERLINK/)
    expect(csv).toContain('"has,comma and ""quote"""')
    // A byte-order mark, so Excel on Windows reads UTF-8.
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  test('the export metadata the specification requires is written as rows, not lost', () => {
    const csv = buildCsv({
      columns: [{ header: 'A', key: 'a' }], rows: [],
      meta: [['Council', 'Vungu RDC'], ['Currency treatment', 'USD and ZWG separate']],
    }).toString('utf8')
    expect(csv).toContain('# Council,Vungu RDC')
    expect(csv).toContain('USD and ZWG separate')
  })
})
