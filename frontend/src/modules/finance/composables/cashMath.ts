/**
 * Exact decimal arithmetic for the counter's PREVIEW total, and the amount in words for a printed
 * receipt.
 *
 * The receipt's real total is computed by Postgres (`finance.record_cash_receipt`) and that is the
 * figure the receipt carries. This exists only so a cashier sees what the payer is about to be
 * asked for while the lines are still being keyed, and it is done in integers — cents and
 * thousandths as BigInt — so the preview can never differ from the database by a float's rounding.
 * It rounds a line the way the database does: once, on the product, half away from zero.
 */

/** A money string as integer cents, or null when it is not a plain non-negative amount. */
export function toCents(text: string | null | undefined): bigint | null {
  const t = String(text ?? '').trim()
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null
  const [whole, fraction = ''] = t.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

/** A quantity (at most three places) as integer thousandths, or null. */
export function toThousandths(text: string | null | undefined): bigint | null {
  const t = String(text ?? '').trim()
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t)) return null
  const [whole, fraction = ''] = t.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'))
}

/** quantity × unit amount in cents, rounded half up — `round(quantity * unit_amount, 2)`. */
export function lineCents(quantity: string, unitAmount: string | null | undefined): bigint | null {
  const q = toThousandths(quantity === '' ? '1' : quantity)
  const u = toCents(unitAmount)
  if (q === null || u === null || q === 0n) return null
  return (q * u + 500n) / 1000n
}

/** Integer cents as the decimal string the rest of the module formats. */
export function centsToText(cents: bigint): string {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', ' thousand', ' million', ' billion', ' trillion']

function belowThousand(n: number): string {
  const parts: string[] = []
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100 }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)])
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n])
  }
  // "one hundred and five": the conjunction a Zimbabwean receipt is written with.
  return parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0]
}

/**
 * An amount in words, as a receipt states it: "Forty dollars and 50 cents".
 * The unit names come from the caller because USD and ZWG are different currencies with different
 * names, and this module never implies one for the other.
 */
export function amountInWords(amount: string, unit: { major: string; minor: string }): string {
  const cents = toCents(amount)
  if (cents === null) return ''
  let whole = cents / 100n
  const minor = Number(cents % 100n)
  const groups: string[] = []
  let scale = 0
  if (whole === 0n) groups.push('zero')
  while (whole > 0n && scale < SCALES.length) {
    const chunk = Number(whole % 1000n)
    if (chunk > 0) groups.unshift(`${belowThousand(chunk)}${SCALES[scale]}`)
    whole /= 1000n
    scale += 1
  }
  const words = `${groups.join(' ')} ${unit.major}`
  const sentence = minor > 0 ? `${words} and ${minor} ${unit.minor}` : `${words} only`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export const CURRENCY_WORDS = {
  USD: { major: 'United States dollars', minor: 'cents' },
  ZWG: { major: 'Zimbabwe Gold', minor: 'cents' },
} as const
