/**
 * Reading the text back out of a generated PDF, so a test can assert on what the page SAYS.
 *
 * A PDF's content streams are deflated, and pdfkit writes each drawn line as a TJ array of hex
 * strings separated by kerning adjustments -- `[<56> 60 <756e6775> 0] TJ`. Without undoing both
 * of those, the only thing a test can check about a PDF is its length, which is how a report
 * that silently stopped including its figures would still pass.
 *
 * Used by test/finance-pdf.test.js (the renderer) and the finance acceptance suite (the route),
 * which is also why it lives here rather than in either one of them.
 */
const zlib = require('node:zlib')

/**
 * The bytes 0x80-0x9F differ between WinAnsi (what pdfkit encodes a standard font in) and
 * latin1, and they are exactly the punctuation prose uses: an em dash read as latin1 is a
 * control character, so a test looking for one would never match.
 */
const WINANSI = {
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”',
  0x95: '•', 0x96: '–', 0x97: '—', 0x85: '…',
}

const decode = (hex) => Buffer.from(hex, 'hex').toString('latin1')
  .replace(/[\u0080-\u009F]/g, (c) => WINANSI[c.charCodeAt(0)] || c)

/** Every content stream in the file, inflated where it is FlateDecode. */
function pdfStreams(buf) {
  const s = buf.toString('latin1')
  const out = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length
    const end = s.indexOf('endstream', start)
    if (end === -1) continue
    const raw = Buffer.from(s.slice(start, end), 'latin1')
    try {
      out.push(zlib.inflateSync(raw).toString('latin1'))
    } catch {
      out.push(raw.toString('latin1'))
    }
  }
  return out
}

/** The lines drawn on the page, in the order they were drawn. */
function pdfLines(buf) {
  const content = pdfStreams(buf).join('\n')
  const lines = []
  const re = /\[([^\]]*)\]\s*TJ/g
  let m
  while ((m = re.exec(content))) {
    const hexes = m[1].match(/<([0-9A-Fa-f]*)>/g) || []
    lines.push(hexes.map((h) => decode(h.slice(1, -1))).join(''))
  }
  return lines
}

/**
 * Everything the document says, as one string, with runs of whitespace collapsed.
 *
 * The collapsing matters: a value too long for its column is wrapped by the renderer, so
 * "Midlands Plant Hire" is drawn as "Midlands " and then "Plant Hire" and rejoins here with two
 * spaces. A test asserting that a supplier name is absent would then pass on a document that
 * names the supplier in full, which is the one mistake this helper exists to prevent.
 */
const pdfText = (buf) => pdfLines(buf).join(' ').replace(/\s+/g, ' ').trim()

/** How many pages the document has. */
function pdfPageCount(buf) {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)
  return m ? m.length : 0
}

/** The first MediaBox in the file, as [width, height]. */
function pdfMediaBox(buf) {
  const m = buf.toString('latin1')
    .match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/)
  return m ? [Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])] : null
}

module.exports = { pdfStreams, pdfLines, pdfText, pdfPageCount, pdfMediaBox }
