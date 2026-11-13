/**
 * Writing a workbook, for financial exports.
 *
 * The same reasoning as the reader (src/lib/spreadsheet.js): an XLSX is a zip of XML and jszip is
 * already here, so a council gets a real .xlsx without this service taking on a spreadsheet
 * library to produce one.
 *
 * AMOUNTS ARE WRITTEN AS NUMBERS, WITH A NUMBER FORMAT. A finance export whose amounts arrive as
 * text is useless — the recipient cannot sum a column — so a cell declared `number` is written as
 * a numeric cell. The decimal string from the database is passed through unparsed into the XML, so
 * the file carries exactly the digits Postgres produced and no JavaScript float is involved.
 *
 * CURRENCY IS A COLUMN, NEVER A FORMAT. Every exported row states its own currency, and a sheet
 * mixing USD and ZWG has no total row. The alternative — formatting a column as "$" — would make
 * a mixed sheet look consistent when it is not.
 */

const JSZip = require('jszip')

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Control characters are not legal in XML 1.0 and will make Excel refuse the file outright.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** Zero-based column index to its letters: 0 → 'A', 26 → 'AA'. */
function columnLetter(index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const isDecimalString = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)

/**
 * Build an .xlsx buffer.
 *
 * sheets: [{ name, columns: [{ header, key, type?: 'text'|'number'|'date' }], rows: [object] }]
 * meta:   lines written on a leading "About this export" sheet — the council identity, reporting
 *         period, currency treatment, filters applied and generation time the specification
 *         requires on every report (§3.9).
 */
async function buildXlsx({ sheets, meta = [] }) {
  const zip = new JSZip()
  const allSheets = []

  if (meta.length) {
    allSheets.push({
      name: 'About this export',
      columns: [{ header: 'Field', key: 'field' }, { header: 'Value', key: 'value' }],
      rows: meta.map(([field, value]) => ({ field, value: value === null || value === undefined ? '' : String(value) })),
    })
  }
  allSheets.push(...sheets)

  // Styles: 0 plain, 1 bold (headers), 2 two-decimal number, 3 ISO date.
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`)

  const sheetEntries = allSheets.map((sheet, i) => ({
    ...sheet,
    // Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters.
    safeName: String(sheet.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || `Sheet${i + 1}`,
    part: `sheet${i + 1}.xml`,
    relId: `rId${i + 1}`,
  }))

  for (const sheet of sheetEntries) {
    const rowsXml = []
    rowsXml.push(`<row r="1">${sheet.columns.map((c, ci) =>
      `<c r="${columnLetter(ci)}1" t="inlineStr" s="1"><is><t>${esc(c.header)}</t></is></c>`).join('')}</row>`)

    sheet.rows.forEach((row, ri) => {
      const r = ri + 2
      const cells = sheet.columns.map((col, ci) => {
        const ref = `${columnLetter(ci)}${r}`
        const raw = row[col.key]
        if (raw === null || raw === undefined || raw === '') return ''
        if (col.type === 'number') {
          // The database's decimal string, written verbatim as a numeric cell.
          if (isDecimalString(raw)) return `<c r="${ref}" s="2"><v>${raw}</v></c>`
          if (typeof raw === 'number' && Number.isFinite(raw)) return `<c r="${ref}" s="2"><v>${raw}</v></c>`
          // Not a number after all: write it as text rather than corrupt the column.
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(raw)}</t></is></c>`
        }
        if (col.type === 'date') {
          const iso = String(raw).slice(0, 10)
          return `<c r="${ref}" t="inlineStr"><is><t>${esc(iso)}</t></is></c>`
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(raw)}</t></is></c>`
      })
      rowsXml.push(`<row r="${r}">${cells.join('')}</row>`)
    })

    zip.file(`xl/worksheets/${sheet.part}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join('')}</sheetData></worksheet>`)
  }

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/${s.part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`)

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)

  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries.map((s, i) => `<sheet name="${esc(s.safeName)}" sheetId="${i + 1}" r:id="${s.relId}"/>`).join('')}</sheets>
</workbook>`)

  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetEntries.map((s) => `<Relationship Id="${s.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${s.part}"/>`).join('\n')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Build a CSV. RFC 4180 quoting, CRLF line endings, and a UTF-8 byte-order mark so Excel on a
 * Windows desktop opens it in the right encoding instead of mangling every council name with a
 * non-ASCII character.
 *
 * A leading =, +, - or @ is prefixed with a tab: without it a spreadsheet treats the cell as a
 * formula, which is both wrong and a way to smuggle a payload into a file a council will open
 * (CSV injection). The displayed text is unchanged.
 */
function buildCsv({ columns, rows, meta = [] }) {
  const cell = (v) => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = []
  for (const [field, value] of meta) lines.push(`${cell(`# ${field}`)},${cell(value)}`)
  if (meta.length) lines.push('')
  lines.push(columns.map((c) => cell(c.header)).join(','))
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','))
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8')])
}

module.exports = { buildXlsx, buildCsv, columnLetter }
