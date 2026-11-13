/**
 * Finance primitives: money, currency, dates, codes, and the column-mapping resolver.
 *
 * MONEY IS A STRING IN THIS CODEBASE, NOT A NUMBER.
 * A JavaScript number is a binary float: 0.1 + 0.2 is 0.30000000000000004, and a council's
 * expenditure total is not something to be approximately right about. So:
 *
 *   - Parsing produces a normalised DECIMAL STRING ('1234.56'), which node-postgres hands to
 *     Postgres unchanged and NUMERIC(18,2) stores exactly.
 *   - Arithmetic happens in SQL, over NUMERIC. There is no money arithmetic in JavaScript anywhere
 *     in this module — the totals, variances, available balances and execution percentages are all
 *     computed by finance.v_budget_line_performance (migration 188).
 *   - Comparison for reconciliation is done by Postgres too (compareMoney below asks the database),
 *     because comparing '1000.00' with '1000' in JavaScript needs a decimal library to be right.
 *
 * If you find yourself writing `a + b` on two amounts here, that is the bug.
 */

/** The currencies this system stores. Adding one is a migration (finance.currency_code). */
const CURRENCIES = ['USD', 'ZWG']

const isCurrency = (v) => typeof v === 'string' && CURRENCIES.includes(v.trim().toUpperCase())
const normaliseCurrency = (v) => (isCurrency(v) ? v.trim().toUpperCase() : null)

/**
 * Parse an amount from a source file or an API body into a normalised decimal string.
 *
 * Accepts what councils' exports actually contain: thousands separators, a currency symbol, a
 * trailing or leading minus, and accounting parentheses for negatives. Rejects anything else
 * rather than coercing it — a cell reading 'n/a' must become an exception row, not a zero.
 *
 * Returns { ok: true, value: '-1234.56' } or { ok: false, reason }.
 */
function parseMoney(raw, { maxScale = 2 } = {}) {
  if (raw === null || raw === undefined) return { ok: false, reason: 'missing' }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: 'not_a_finite_number' }
    // A number has already lost whatever it was going to lose; round half-up at the scale and say so.
    return { ok: true, value: raw.toFixed(maxScale), coerced_from_number: true }
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_number' }

  let s = raw.trim()
  if (s === '') return { ok: false, reason: 'missing' }

  // Accounting negative: (1,234.56)
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim() }

  // Currency symbols and codes a spreadsheet may have glued to the figure.
  s = s.replace(/^(USD|ZWG|ZWL|US\$|\$|Z\$)\s*/i, '').trim()
  s = s.replace(/\s*(USD|ZWG|ZWL)$/i, '').trim()

  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim() }
  else if (s.startsWith('+')) { s = s.slice(1).trim() }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1).trim() }

  // Thousands separators: spaces, and commas when they are not the decimal mark. A single comma
  // followed by one or two digits is treated as a decimal comma, which is how some exports write it.
  s = s.replace(/[\s ']/g, '')
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')

  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'not_a_number' }

  const [whole, frac = ''] = s.split('.')
  if (frac.length > maxScale) {
    return { ok: false, reason: `more_than_${maxScale}_decimal_places` }
  }
  if (whole.replace(/^0+/, '').length > 16) return { ok: false, reason: 'too_large' }

  const value = `${negative ? '-' : ''}${whole.replace(/^0+(?=\d)/, '')}.${frac.padEnd(maxScale, '0')}`
  return { ok: true, value }
}

/**
 * Compare two decimal strings for equality, in Postgres rather than in JavaScript.
 * Used by reconciliation, where '1000' and '1000.00' are the same total and `===` says they are not.
 */
async function moneyEquals(pg, a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false
  const { rows } = await pg.query('SELECT ($1::numeric = $2::numeric) AS eq', [String(a), String(b)])
  return rows[0].eq === true
}

/**
 * Parse a date from a source file. Councils' exports are inconsistent, so the accepted forms are
 * stated here and nothing else is guessed:
 *
 *   2026-03-31          ISO, unambiguous, preferred
 *   31/03/2026          day first, which is what Zimbabwean practice and Excel's en-ZW locale write
 *   31-03-2026          the same with dashes
 *   2026/03/31          year first with slashes
 *
 * A form like 03/04/2026 is read day-first (3 April), consistently. An export written month-first
 * must be mapped with an explicit `date_format` on the column mapping; the importer records which
 * interpretation it used on the batch so an officer can see it.
 */
function parseDate(raw, { dayFirst = true } = {}) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { ok: true, value: raw.toISOString().slice(0, 10) }
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'not_a_date' }
  const s = raw.trim()
  if (s === '') return { ok: false, reason: 'missing' }

  let y, m, d
  let match
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
    [, y, m, d] = match
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    if (dayFirst) [, d, m, y] = match
    else [, m, d, y] = match
  } else {
    return { ok: false, reason: 'unrecognised_date_format' }
  }

  const yi = Number(y), mi = Number(m), di = Number(d)
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return { ok: false, reason: 'date_out_of_range' }
  // Reject 31 February rather than letting Date roll it into March.
  const probe = new Date(Date.UTC(yi, mi - 1, di))
  if (probe.getUTCFullYear() !== yi || probe.getUTCMonth() !== mi - 1 || probe.getUTCDate() !== di) {
    return { ok: false, reason: 'date_does_not_exist' }
  }
  if (yi < 1900 || yi > 2200) return { ok: false, reason: 'date_out_of_range' }
  return { ok: true, value: `${String(yi).padStart(4, '0')}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}` }
}

/**
 * How a header or a classification code is compared: case-folded, with spaces, underscores and
 * hyphens removed. 'Vote Code', 'vote_code' and 'VOTECODE' are the same column; '01-100' and
 * '01100' are NOT the same account, so code normalisation keeps the digits and drops only
 * whitespace.
 */
const normaliseHeader = (v) => String(v ?? '').toLowerCase().replace(/[\s_\-.]/g, '')
const normaliseCode = (v) => String(v ?? '').trim().replace(/[\s ]/g, '')

/** A trimmed non-empty string within a length bound, or null. */
function str(v, max = 500) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length === 0 || t.length > max) return null
  return t
}

/**
 * Work out which column of the uploaded file feeds each target field.
 *
 * `mapping` is { target_field: [accepted header, ...] } from finance.column_mapping; `headers` is
 * the file's first row. Returns { resolved, unmatchedTargets, unusedHeaders } — the caller decides
 * which missing targets are fatal, because that differs by dataset.
 *
 * An explicit override wins over the alias list, which is how a finance officer fixes a file whose
 * headers nobody anticipated without editing the saved mapping for everyone.
 */
function resolveColumns(mapping, headers, overrides = {}) {
  const byNormalised = new Map()
  headers.forEach((h, i) => {
    const key = normaliseHeader(h)
    if (key && !byNormalised.has(key)) byNormalised.set(key, { header: h, index: i })
  })

  const resolved = {}
  const used = new Set()

  for (const [target, header] of Object.entries(overrides)) {
    if (header === null || header === undefined || header === '') continue
    const hit = byNormalised.get(normaliseHeader(header))
    if (hit) { resolved[target] = hit; used.add(hit.index) }
  }

  for (const [target, aliases] of Object.entries(mapping || {})) {
    if (resolved[target]) continue
    if (!Array.isArray(aliases)) continue
    for (const alias of aliases) {
      const hit = byNormalised.get(normaliseHeader(alias))
      if (hit) { resolved[target] = hit; used.add(hit.index); break }
    }
  }

  const unmatchedTargets = Object.keys(mapping || {}).filter((t) => !resolved[t])
  const unusedHeaders = headers.filter((_, i) => !used.has(i))
  return { resolved, unmatchedTargets, unusedHeaders }
}

/** Pull one mapped field out of a row of cells. Returns undefined when the column is not mapped. */
function cell(resolved, row, target) {
  const col = resolved[target]
  if (!col) return undefined
  const v = row[col.index]
  return v === undefined || v === null ? undefined : v
}

/**
 * Re-select DATE columns as text.
 *
 * A SQL DATE has no time zone. node-postgres turns one into a JavaScript Date at LOCAL midnight,
 * and this service runs in Central Africa Time, so `2031-01-01` is serialised as
 * `2030-12-31T22:00:00.000Z` — a client taking the first ten characters gets the wrong day, and a
 * financial year appears to start before it does. Reading the column as text keeps the date the
 * date the database holds.
 *
 * Append the result to a `*` or `RETURNING *` list: PostgreSQL permits the duplicate column name
 * and node-postgres keeps the LAST one, so `SELECT y.*, ` + dateText('y', 'start_date') overrides
 * the parsed value with the text one without having to list every other column by hand.
 *
 *   `SELECT y.*, ${dateText('y', 'start_date', 'end_date')} FROM finance.financial_year y`
 *   `... RETURNING *, ${dateText(null, 'effective_date')}`
 *
 * Only DATE columns need this. A timestamptz is an instant and is correctly carried by an ISO
 * string in UTC.
 */
function dateText(alias, ...columns) {
  const prefix = alias ? `${alias}.` : ''
  return columns.map((c) => `${prefix}${c}::text AS ${c}`).join(', ')
}

module.exports = {
  dateText,
  CURRENCIES,
  isCurrency,
  normaliseCurrency,
  parseMoney,
  moneyEquals,
  parseDate,
  normaliseHeader,
  normaliseCode,
  str,
  resolveColumns,
  cell,
}
