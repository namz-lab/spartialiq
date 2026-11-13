/**
 * Reading a council's uploaded CSV or XLSX into rows of cells.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A SPREADSHEET LIBRARY
 * An XLSX file is a zip of XML, and the two pieces needed to read one — a zip reader (jszip) and
 * an XML parser (fast-xml-parser) — are already direct or near-direct dependencies of this
 * service. A full spreadsheet library would add a large attack surface for the one thing wanted
 * here: the used range of the first worksheet, as text, with dates recognised.
 *
 * WHAT IS DELIBERATELY NOT SUPPORTED
 *   - Formulas are read as their CACHED VALUE, which is what the council's system wrote when it
 *     saved the file. A formula whose cached value is absent reads as empty and the row becomes an
 *     exception rather than a zero.
 *   - Multiple sheets: the first worksheet in the workbook's own order is read. A file whose data
 *     is on the third tab must be saved with that tab first; the reader reports the sheet name it
 *     used so an officer can see which one it took.
 *   - Merged cells contribute their value to the top-left cell only, as the format stores them.
 *
 * DATES. An XLSX date is a number plus a number format, so the formats are read from styles.xml
 * and a dated cell is converted to an ISO date here. Without that step a transaction date arrives
 * as 46112 and every row fails validation for a reason that makes no sense to the person who
 * uploaded it.
 */

const { parse: parseCsvSync } = require('csv-parse/sync')
const JSZip = require('jszip')
const { XMLParser } = require('fast-xml-parser')

/** The biggest upload worth attempting in memory. The route enforces its own council-set limit too. */
const MAX_BYTES = 80 * 1024 * 1024

/**
 * Column letters to a zero-based index: 'A' → 0, 'AA' → 26.
 * Sheet XML omits empty cells, so a row's cells have to be placed by their reference, not by the
 * order they appear in — otherwise a blank column shifts every value after it one to the left,
 * which is the classic way a spreadsheet import silently posts amounts to the wrong account.
 */
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)
  if (!letters) return null
  let n = 0
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Excel's serial day number to an ISO date. */
function serialToIsoDate(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n) || n < 1 || n > 2958466) return null
  // Day 1 is 1900-01-01, and the format contains a non-existent 1900-02-29 that everything has to
  // reproduce. Serials above 60 are therefore one day ahead of a true day count.
  const days = n > 60 ? n - 1 : n
  const ms = Math.round((days - 1) * 86400000)
  const d = new Date(Date.UTC(1900, 0, 1) + ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

/** Does this number format produce a date? Quoted literals are ignored so "May" is not a d/m/y. */
function formatIsDate(formatCode) {
  if (!formatCode) return false
  const stripped = String(formatCode).replace(/"[^"]*"/g, '').replace(/\\./g, '')
  return /[ymdhs]/i.test(stripped) && !/^(General|@|#|0)/.test(stripped.trim())
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])

/**
 * Read the first worksheet of an XLSX buffer.
 * Returns { headers, rows, sheetName, truncated } where every cell is a string, a number, or null.
 */
async function readXlsx(buffer, { maxRows = 200000 } = {}) {
  const zip = await JSZip.loadAsync(buffer)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // A cell's text is what matters; without this, whitespace-only cells come back as undefined
    // and a deliberately blank column looks like a missing one.
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  })

  const readXml = async (path) => {
    const file = zip.file(path)
    if (!file) return null
    return parser.parse(await file.async('string'))
  }

  // Which worksheet is first, and what is it called? The relationship ids in workbook.xml point at
  // the part names in workbook.xml.rels; both are needed because the sheet file is not always
  // sheet1.xml.
  const workbook = await readXml('xl/workbook.xml')
  const rels = await readXml('xl/_rels/workbook.xml.rels')
  if (!workbook) throw new Error('not_an_xlsx_workbook')

  const sheets = asArray(workbook.workbook?.sheets?.sheet)
  if (sheets.length === 0) throw new Error('workbook_has_no_sheets')
  const first = sheets[0]
  const sheetName = first['@name'] || 'Sheet1'
  const relId = first['@r:id'] || first['@id']

  let sheetPath = 'xl/worksheets/sheet1.xml'
  const relList = asArray(rels?.Relationships?.Relationship)
  const rel = relList.find((r) => r['@Id'] === relId)
  if (rel && rel['@Target']) {
    const target = String(rel['@Target']).replace(/^\//, '')
    sheetPath = target.startsWith('xl/') ? target : `xl/${target}`
  }
  if (!zip.file(sheetPath)) {
    const candidate = Object.keys(zip.files).find((f) => /^xl\/worksheets\/.+\.xml$/.test(f))
    if (!candidate) throw new Error('workbook_has_no_worksheet_part')
    sheetPath = candidate
  }

  // The shared string table. Rich text splits a string across several <r><t> runs, which have to be
  // concatenated or a supplier name arrives truncated at the first formatting change.
  const sharedDoc = await readXml('xl/sharedStrings.xml')
  const shared = asArray(sharedDoc?.sst?.si).map((si) => {
    if (si === null || si === undefined) return ''
    if (typeof si === 'string') return si
    if (si.t !== undefined) return typeof si.t === 'string' ? si.t : (si.t?.['#text'] ?? '')
    return asArray(si.r).map((r) => (typeof r?.t === 'string' ? r.t : r?.t?.['#text'] ?? '')).join('')
  })

  // Which style indexes mean "this is a date".
  const stylesDoc = await readXml('xl/styles.xml')
  const customFormats = new Map()
  for (const nf of asArray(stylesDoc?.styleSheet?.numFmts?.numFmt)) {
    customFormats.set(Number(nf['@numFmtId']), nf['@formatCode'])
  }
  const dateStyles = new Set()
  asArray(stylesDoc?.styleSheet?.cellXfs?.xf).forEach((xf, i) => {
    const id = Number(xf?.['@numFmtId'])
    if (!Number.isFinite(id)) return
    if (BUILTIN_DATE_FORMATS.has(id) || formatIsDate(customFormats.get(id))) dateStyles.add(i)
  })

  const sheetDoc = parser.parse(await zip.file(sheetPath).async('string'))
  const sheetRows = asArray(sheetDoc?.worksheet?.sheetData?.row)

  const out = []
  let truncated = false
  for (const row of sheetRows) {
    if (out.length >= maxRows) { truncated = true; break }
    const cells = []
    for (const c of asArray(row?.c)) {
      const ref = c?.['@r']
      const idx = ref ? columnIndex(ref) : cells.length
      if (idx === null || idx > 16383) continue
      const type = c?.['@t']
      const styleIdx = c?.['@s'] !== undefined ? Number(c['@s']) : null
      let value = null

      if (type === 's') {
        const i = Number(typeof c.v === 'string' ? c.v : c.v?.['#text'])
        value = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : null
      } else if (type === 'inlineStr') {
        const is = c.is
        value = typeof is?.t === 'string' ? is.t
          : asArray(is?.r).map((r) => (typeof r?.t === 'string' ? r.t : r?.t?.['#text'] ?? '')).join('') || null
      } else if (type === 'str') {
        value = typeof c.v === 'string' ? c.v : c.v?.['#text'] ?? null
      } else if (type === 'b') {
        const raw = typeof c.v === 'string' ? c.v : c.v?.['#text']
        value = raw === '1' ? 'TRUE' : 'FALSE'
      } else if (type === 'e') {
        // An error cell (#REF!, #N/A). Kept as its text so the row becomes a legible exception.
        value = typeof c.v === 'string' ? c.v : c.v?.['#text'] ?? '#ERROR'
      } else {
        const raw = typeof c.v === 'string' ? c.v : c.v?.['#text']
        if (raw === undefined || raw === null || raw === '') value = null
        else if (styleIdx !== null && dateStyles.has(styleIdx)) value = serialToIsoDate(raw) ?? raw
        else value = raw
      }
      cells[idx] = value === undefined ? null : value
    }
    // Normalise holes left by skipped empty cells so every row is a dense array.
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = null
    out.push(cells)
  }

  // Leading blank rows above the header are common in exports that carry a title banner.
  while (out.length && out[0].every((v) => v === null || String(v).trim() === '')) out.shift()
  const headers = (out.shift() || []).map((h) => (h === null ? '' : String(h).trim()))
  return { headers, rows: out, sheetName, truncated, format: 'xlsx' }
}

/**
 * Read a CSV buffer. The delimiter is detected from the header line among comma, semicolon and tab,
 * because a council whose spreadsheet locale uses a decimal comma exports semicolon-separated files
 * and would otherwise see every row as one column.
 */
function readCsv(buffer, { maxRows = 200000, delimiter } = {}) {
  // Strip a UTF-8 byte-order mark: left in place it becomes part of the first header name and the
  // first column silently fails to map.
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const detected = delimiter || [',', ';', '\t', '|']
    .map((d) => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0]

  const records = parseCsvSync(text, {
    delimiter: detected,
    bom: false,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: false,
    to: maxRows + 1,
  })
  const headers = (records.shift() || []).map((h) => String(h ?? '').trim())
  return { headers, rows: records, sheetName: null, truncated: records.length > maxRows, format: 'csv', delimiter: detected }
}

/** Dispatch on the file's own bytes, not on the extension a browser guessed. */
async function readTabular(buffer, filename = '', { maxRows = 200000 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('not_a_buffer')
  if (buffer.length === 0) throw new Error('empty_file')
  if (buffer.length > MAX_BYTES) throw new Error('file_too_large')

  // 'PK\x03\x04' — a zip, so an XLSX (or an XLSM, which reads the same way).
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04
  if (isZip) return readXlsx(buffer, { maxRows })

  // An old binary .xls is a different format entirely and is not readable here. Saying so plainly
  // is better than parsing its bytes as text and reporting nonsense.
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) throw new Error('legacy_xls_not_supported')
  if (/\.xlsx?$/i.test(filename) && !isZip) throw new Error('not_a_valid_xlsx')

  return readCsv(buffer, { maxRows })
}

module.exports = { readTabular, readCsv, readXlsx, columnIndex, serialToIsoDate, formatIsDate, MAX_BYTES }
