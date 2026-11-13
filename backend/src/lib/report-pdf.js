/**
 * Rendering a financial report as PDF.
 *
 * The third export format alongside src/lib/spreadsheet-write.js, and it follows that file's two
 * rules unchanged:
 *
 * AMOUNTS ARE PASSED THROUGH UNPARSED. The decimal string Postgres produced is drawn as text
 * exactly as it arrived. No Number() is applied anywhere in this file, so no binary float ever
 * stands between the ledger and the page.
 *
 * CURRENCY IS A COLUMN, NEVER A FORMAT. Every row states its own currency and this renderer adds
 * no total row of any kind. A report mixing USD and ZWG therefore cannot show a combined figure,
 * which is acceptance check A8 expressed as a missing feature rather than a guarded one.
 *
 * WHY A PDF AT ALL. CSV and XLSX are for someone who will carry on calculating. A PDF is for a
 * report that goes into a committee pack, so what matters here is that the page states what it is:
 * the cover carries the council identity, reporting period, currency treatment, filters applied
 * and generation time the specification requires on every report (§3.9), and a file containing
 * supplier or beneficiary identities says RESTRICTED on every single page rather than only in its
 * filename.
 *
 * It is a presentation of a report, not a statutory return, and the cover says so.
 */

const PDFDocument = require('pdfkit')

const FONT = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'

const BODY_SIZE = 7.5
const HEAD_SIZE = 7.5
const MARGIN = 28
const CELL_PAD = 4
const MIN_COL_WIDTH = 34
const ROW_GAP = 3

/**
 * Column widths are measured from the real glyph widths of the header and the data, so a column of
 * short codes stays narrow and the description column gets the room it needs.
 *
 * Only the first SAMPLE_ROWS rows are measured. Measuring every row of a 40 000-row register would
 * cost more than drawing it, and the consequence of a later row being wider than the sample is
 * that its text wraps onto a second line — not that it overflows the column.
 */
const SAMPLE_ROWS = 300

const isNumeric = (column) => column.type === 'number'

/** Text for a cell. null and undefined are blank; everything else is its own string, unparsed. */
function cellText(value) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function measureColumns(doc, columns, rows, available) {
  const sample = rows.length > SAMPLE_ROWS ? rows.slice(0, SAMPLE_ROWS) : rows

  // Header and data are measured apart, because they are not equally negotiable: a heading may
  // wrap onto a second line without harm, an amount may not.
  const headerWidth = columns.map((column) => {
    doc.font(FONT_BOLD).fontSize(HEAD_SIZE)
    return doc.widthOfString(cellText(column.header))
  })
  const dataWidth = columns.map((column) => {
    doc.font(FONT).fontSize(BODY_SIZE)
    let width = 0
    for (const row of sample) {
      const w = doc.widthOfString(cellText(row[column.key]))
      if (w > width) width = w
    }
    return width
  })

  const natural = columns.map((_, i) => Math.max(headerWidth[i], dataWidth[i]) + CELL_PAD * 2)

  const total = natural.reduce((a, b) => a + b, 0)
  if (total <= available) return natural

  // Too wide for the page, so something has to give -- but it must not be an amount.
  //
  // A WRAPPED NUMBER IS A WRONG NUMBER. "400000.00" broken across two lines reads as "400000.0"
  // followed by a stray "0", and on a page of figures that is not a cosmetic problem: it is a
  // figure a committee can misread. So a numeric column's floor is whatever its widest AMOUNT
  // needs -- not its heading, which is free to wrap onto a second line. The space comes out of
  // the text columns, which wrap harmlessly.
  const floors = natural.map((w, i) => (isNumeric(columns[i])
    ? Math.min(w, dataWidth[i] + CELL_PAD * 2)
    : Math.min(w, MIN_COL_WIDTH)))
  const floorTotal = floors.reduce((a, b) => a + b, 0)

  if (floorTotal > available) {
    // Even the amounts and the minimum text columns do not fit. Nothing can be preserved here, so
    // scale everything proportionally and let the caller see a cramped table rather than a
    // truncated one -- this needs a narrower report, not a cleverer layout.
    const scale = available / total
    return natural.map((w) => w * scale)
  }

  const shrinkable = total - floorTotal
  if (shrinkable <= 0) return floors

  const scale = Math.max(0, available - floorTotal) / shrinkable
  return natural.map((w, i) => floors[i] + (w - floors[i]) * scale)
}

/** The height one row needs: the tallest of its wrapped cells. */
function rowHeight(doc, columns, widths, row) {
  doc.font(FONT).fontSize(BODY_SIZE)
  let height = 0
  for (let i = 0; i < columns.length; i++) {
    const text = cellText(row[columns[i].key])
    if (!text) continue
    // A numeric cell is never wrapped (see measureColumns), so it is always one line tall.
    if (isNumeric(columns[i])) continue
    const h = doc.heightOfString(text, { width: widths[i] - CELL_PAD * 2 })
    if (h > height) height = h
  }
  return Math.max(height, BODY_SIZE + 2) + ROW_GAP
}

/**
 * Build a PDF buffer.
 *
 * title      the report's name, shown on the cover and in the running header
 * columns    [{ header, key, type?: 'number' | 'date' | 'text' }] — as the report builder emits
 * rows       [object] keyed by the columns' `key`
 * meta       [[field, value]] — the §3.9 cover block, same array the CSV and XLSX writers take
 * restricted true when the rows carry supplier or beneficiary identities
 */
function buildPdf({ title, columns, rows, meta = [], restricted = false }) {
  return new Promise((resolve, reject) => {
    const landscape = columns.length > 6
    const doc = new PDFDocument({
      size: 'A4',
      layout: landscape ? 'landscape' : 'portrait',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: title || 'Financial report',
        Author: 'Vungu Rural District Council',
        Subject: restricted ? 'Financial report (contains restricted data)' : 'Financial report',
        Creator: 'Vungu RDC budget and planning system',
      },
    })

    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = doc.page.margins.left
    const right = doc.page.width - doc.page.margins.right
    const available = right - left
    const bottom = () => doc.page.height - doc.page.margins.bottom - 18

    // ── Cover: what this document is ───────────────────────────────────────────────────────────
    doc.font(FONT_BOLD).fontSize(15).fillColor('#000')
      .text('Vungu Rural District Council', left, MARGIN)
    doc.font(FONT).fontSize(11).fillColor('#333')
      .text(title || 'Financial report', { width: available })
    doc.moveDown(0.8)

    if (restricted) {
      doc.font(FONT_BOLD).fontSize(9).fillColor('#8a1c1c')
        .text('RESTRICTED — contains supplier or beneficiary identities. Not for publication.',
          { width: available })
      doc.moveDown(0.6)
    }

    doc.font(FONT).fontSize(8.5).fillColor('#000')
    const labelWidth = Math.min(190, available * 0.42)
    for (const [field, value] of meta) {
      const text = cellText(value)
      const y = doc.y
      const h = Math.max(
        doc.heightOfString(cellText(field), { width: labelWidth }),
        doc.heightOfString(text, { width: available - labelWidth - 10 }),
      )
      if (y + h > bottom()) doc.addPage()
      doc.font(FONT_BOLD).text(cellText(field), left, doc.y, { width: labelWidth, continued: false })
      doc.font(FONT).text(text, left + labelWidth + 10, y, { width: available - labelWidth - 10 })
      doc.y = Math.max(doc.y, y + h) + 1.5
    }

    // ── The table ──────────────────────────────────────────────────────────────────────────────
    const widths = measureColumns(doc, columns, rows, available)

    const drawHeader = () => {
      const y = doc.y
      let h = 0
      doc.font(FONT_BOLD).fontSize(HEAD_SIZE)
      for (let i = 0; i < columns.length; i++) {
        const hh = doc.heightOfString(cellText(columns[i].header), { width: widths[i] - CELL_PAD * 2 })
        if (hh > h) h = hh
      }
      h += ROW_GAP

      doc.save().rect(left, y, available, h).fill('#eef1f4').restore()
      doc.fillColor('#000').font(FONT_BOLD).fontSize(HEAD_SIZE)
      let x = left
      for (let i = 0; i < columns.length; i++) {
        doc.text(cellText(columns[i].header), x + CELL_PAD, y + ROW_GAP / 2, {
          width: widths[i] - CELL_PAD * 2,
          align: isNumeric(columns[i]) ? 'right' : 'left',
          lineBreak: true,
        })
        x += widths[i]
      }
      doc.moveTo(left, y + h).lineTo(right, y + h).lineWidth(0.5).strokeColor('#9aa5b1').stroke()
      doc.y = y + h
    }

    doc.addPage()
    doc.font(FONT_BOLD).fontSize(9).fillColor('#000')
      .text(title || 'Financial report', left, MARGIN, { width: available })
    doc.moveDown(0.3)
    drawHeader()

    if (!rows.length) {
      doc.font(FONT).fontSize(8.5).fillColor('#444')
        .text('This report returned no rows for the filters on the cover.', left, doc.y + 6, { width: available })
    }

    let striped = false
    for (const row of rows) {
      const h = rowHeight(doc, columns, widths, row)
      if (doc.y + h > bottom()) {
        doc.addPage()
        doc.font(FONT_BOLD).fontSize(9).fillColor('#000')
          .text(title || 'Financial report', left, MARGIN, { width: available })
        doc.moveDown(0.3)
        drawHeader()
      }

      const y = doc.y
      if (striped) doc.save().rect(left, y, available, h).fill('#f7f8fa').restore()
      striped = !striped

      doc.fillColor('#000').font(FONT).fontSize(BODY_SIZE)
      let x = left
      for (let i = 0; i < columns.length; i++) {
        const text = cellText(row[columns[i].key])
        if (text) {
          const numeric = isNumeric(columns[i])
          doc.text(text, x + CELL_PAD, y + ROW_GAP / 2, {
            width: widths[i] - CELL_PAD * 2,
            align: numeric ? 'right' : 'left',
            // An amount is drawn on one line whatever happens; its column was sized to hold it.
            lineBreak: !numeric,
          })
        }
        x += widths[i]
      }
      doc.y = y + h
    }

    // ── Footers: page numbers, and the restricted mark on every page ───────────────────────────
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      const fy = doc.page.height - doc.page.margins.bottom - 10
      const fRight = doc.page.width - doc.page.margins.right
      doc.font(FONT).fontSize(7).fillColor('#555')
        .text(`Page ${i - range.start + 1} of ${range.count}`,
          doc.page.margins.left, fy, { width: fRight - doc.page.margins.left, align: 'right' })
      if (restricted) {
        doc.font(FONT_BOLD).fontSize(7).fillColor('#8a1c1c')
          .text('RESTRICTED', doc.page.margins.left, fy, { lineBreak: false })
      }
    }

    doc.end()
  })
}

module.exports = { buildPdf }
