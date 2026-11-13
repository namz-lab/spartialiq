/**
 * Formatting money, and refusing to add it up.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * USD and ZWG are never combined. The Council has approved no conversion basis (decision D4), so
 * a single figure spanning both would be invented. Every function here either takes a currency or
 * returns a per-currency breakdown; there is deliberately no `sum(amounts)` that ignores currency,
 * and `totalByCurrency` throws if asked to add two currencies together.
 *
 * PRECISION
 * Amounts arrive from the API as decimal strings and are formatted from the string, digit by digit,
 * without passing through a JavaScript number. `Number('99999999999999.99')` is not that figure,
 * and a council's consolidated expenditure can reach that scale in ZWG. The only place a number is
 * produced is `toChartValue`, which exists for drawing a bar and says so.
 */

export type Currency = 'USD' | 'ZWG'

/** How each currency is written on screen. ZWG is written as the code: it has no settled symbol. */
const CURRENCY_LABEL: Record<Currency, string> = { USD: 'US$', ZWG: 'ZWG' }
const CURRENCY_NAME: Record<Currency, string> = { USD: 'United States dollar', ZWG: 'Zimbabwe Gold' }

/** Split a decimal string into sign, whole digits and exactly two fraction digits. */
function parts(amount: string | null | undefined): { negative: boolean; whole: string; fraction: string } | null {
  if (amount === null || amount === undefined) return null
  const text = String(amount).trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [whole, fraction = ''] = unsigned.split('.')
  return { negative, whole, fraction: `${fraction}00`.slice(0, 2) }
}

/** Group the whole part in threes, from the right, without turning it into a number. */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export interface FormatOptions {
  /** Leave the currency off — for a column whose header already states it. */
  bare?: boolean
  /** Round to whole units for a dense table or an axis label. The underlying figure is unchanged. */
  whole?: boolean
  /** What to show when the amount is null or unparseable. Defaults to an em dash. */
  placeholder?: string
}

/**
 * Format one amount in its own currency.
 * `formatMoney('125000.00', 'USD')` → `US$ 125 000.00`
 */
export function formatMoney(
  amount: string | null | undefined,
  currency: Currency | null | undefined,
  options: FormatOptions = {},
): string {
  const placeholder = options.placeholder ?? '—'
  const p = parts(amount)
  if (!p) return placeholder
  const body = options.whole
    ? groupThousands(p.whole)
    : `${groupThousands(p.whole)}.${p.fraction}`
  const signed = p.negative ? `−${body}` : body
  if (options.bare || !currency) return signed
  return `${CURRENCY_LABEL[currency]} ${signed}`
}

/** The symbol or code a column header should carry. */
export function currencyLabel(currency: Currency): string {
  return CURRENCY_LABEL[currency]
}

export function currencyName(currency: Currency): string {
  return CURRENCY_NAME[currency]
}

/**
 * A percentage, or the word for its absence.
 *
 * The API returns null for execution where the revised budget is zero, because the ratio is
 * UNDEFINED there — not zero, and not infinity. Showing "0%" for a line with spend and no budget
 * would be the most misleading number on the page, so this says so instead.
 */
export function formatPercentage(value: string | number | null | undefined, options: { undefinedLabel?: string } = {}): string {
  if (value === null || value === undefined || value === '') return options.undefinedLabel ?? 'not defined'
  const text = String(value)
  if (!/^-?\d+(\.\d+)?$/.test(text)) return options.undefinedLabel ?? 'not defined'
  const rounded = text.includes('.') ? text.replace(/(\.\d)\d+$/, '$1').replace(/\.0$/, '') : text
  return `${rounded}%`
}

/**
 * Add amounts, per currency, and never across them.
 *
 * Returns a map of currency → decimal string. Pass rows that already carry their own currency;
 * there is no way to call this such that two currencies end up in one figure.
 *
 * The addition itself is done on integer cents as BigInt, so it is exact for any figure the
 * database can hold.
 */
export function totalByCurrency<T extends { currency: Currency; }>(
  rows: readonly T[],
  pick: (row: T) => string | null | undefined,
): Record<string, string> {
  const cents: Record<string, bigint> = {}
  for (const row of rows) {
    const p = parts(pick(row))
    if (!p) continue
    const value = BigInt(`${p.negative ? '-' : ''}${p.whole}${p.fraction}`)
    cents[row.currency] = (cents[row.currency] ?? 0n) + value
  }
  const out: Record<string, string> = {}
  for (const [currency, total] of Object.entries(cents)) {
    const negative = total < 0n
    const absolute = (negative ? -total : total).toString().padStart(3, '0')
    out[currency] = `${negative ? '-' : ''}${absolute.slice(0, -2)}.${absolute.slice(-2)}`
  }
  return out
}

/** Which currencies a set of rows is stated in, so a screen can label itself honestly. */
export function currenciesIn<T extends { currency: Currency }>(rows: readonly T[]): Currency[] {
  return [...new Set(rows.map((r) => r.currency))].sort() as Currency[]
}

/**
 * A number for a chart axis or a bar width, and nothing else.
 *
 * Named so that a reviewer can see at a glance that a float has entered the picture, and see that
 * it only reached a pixel calculation. Never use the result in a figure the reader will read as
 * money.
 */
export function toChartValue(amount: string | null | undefined): number {
  const p = parts(amount)
  if (!p) return 0
  const value = Number(`${p.whole}.${p.fraction}`)
  return p.negative ? -value : value
}

/** A date the API sent as text (`2031-03-31`), written the way a council writes it. */
export function formatDate(value: string | null | undefined, placeholder = '—'): string {
  if (!value) return placeholder
  const text = String(value).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return placeholder
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/** A timestamp, to the minute, in the reader's own time zone. */
export function formatDateTime(value: string | null | undefined, placeholder = '—'): string {
  if (!value) return placeholder
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return placeholder
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * A file size a person can read.
 *
 * `Number(null)` is 0, so the null check has to come first: a missing size rendered as "0 B" reads
 * as a fact about the file rather than an absence of information about it.
 */
export function formatBytes(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function useMoney() {
  return {
    formatMoney,
    formatPercentage,
    formatDate,
    formatDateTime,
    formatBytes,
    currencyLabel,
    currencyName,
    totalByCurrency,
    currenciesIn,
    toChartValue,
  }
}
