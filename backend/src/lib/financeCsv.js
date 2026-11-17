/**
 * CSV for the ledger's exports (RFC 4180).
 *
 * VALUES ARE WRITTEN AS GIVEN. An amount arrives here as the decimal string SQL produced
 * ('1550.00', '-450.00') and leaves the same string: nothing is parsed, rounded or re-formatted,
 * so the export and the screen cannot disagree by a cent.
 *
 * A TEXT CELL IS NEVER A FORMULA. A spreadsheet reads a cell starting with `=`, `+`, `-` or `@` as a
 * formula, and a narration or a party name is typed by a person. A leading TAB or carriage return is
 * treated the same way, because some spreadsheets strip it and then read what follows as a formula
 * (OWASP CSV injection). Such a text cell is prefixed with an apostrophe. A column marked
 * `type: 'amount'` is exempt, because a negative figure starts with `-` and must stay a number.
 *
 * Lines end with CRLF, including the last. A value holding a comma, a quote or a line break is
 * quoted, with its quotes doubled.
 */

const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

function cell(value, type) {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (type !== 'amount' && FORMULA_START.test(text)) text = `'${text}`
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * @param {{ header: string, key: string, type?: 'amount' }[]} columns
 * @param {object[]} rows
 * @returns {string}
 */
function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key], c.type)).join(','))
  return `${lines.join('\r\n')}\r\n`
}

module.exports = { toCsv }
