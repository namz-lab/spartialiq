/**
 * The journal editor's running balance, in exact integer cents.
 *
 * This is the only money sum the browser performs, and it is a GUIDE: the posting is checked by the
 * database. It never touches a floating-point number, so 0.10 + 0.20 is 0.30 here, as it is in the
 * ledger. Amounts are held as `BigInt` cents and shown with `centsToText`.
 */
import { centsToText } from '../../../composables/cashMath'

/** One journal line as typed: two text boxes, either of which may be empty. */
export interface DraftLine { debit: string; credit: string }

export type LineState = 'empty' | 'debit' | 'credit' | 'both' | 'unreadable'

/**
 * Typed text as integer cents, or null.
 * Accepts `12`, `12.5`, `12.50` and surrounding spaces. Rejects commas, three or more decimals,
 * signs, exponents, a bare point, and the empty string.
 */
export function parseAmount(text: string): bigint | null {
  const t = String(text ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [whole, fraction = ''] = t.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}

const isBlank = (s: string) => String(s ?? '').trim() === ''

export function lineState(l: DraftLine): LineState {
  const hasDebit = !isBlank(l.debit), hasCredit = !isBlank(l.credit)
  if ((hasDebit && parseAmount(l.debit) === null) || (hasCredit && parseAmount(l.credit) === null)) return 'unreadable'
  if (hasDebit && hasCredit) return 'both'
  if (hasDebit) return 'debit'
  if (hasCredit) return 'credit'
  return 'empty'
}

export interface Guide {
  debit: string
  credit: string
  /** Debits less credits. */
  difference: string
  /** False while any line is unreadable, and when there is nothing to balance. */
  inBalance: boolean
  unreadable: number
}

function totals(lines: DraftLine[]) {
  let debit = 0n, credit = 0n, unreadable = 0
  for (const l of lines) {
    if (lineState(l) === 'unreadable') { unreadable += 1; continue }
    debit += parseAmount(l.debit) ?? 0n
    credit += parseAmount(l.credit) ?? 0n
  }
  return { debit, credit, unreadable }
}

export function guide(lines: DraftLine[]): Guide {
  const { debit, credit, unreadable } = totals(lines)
  return {
    debit: centsToText(debit),
    credit: centsToText(credit),
    difference: centsToText(debit - credit),
    inBalance: unreadable === 0 && debit === credit && debit > 0n,
    unreadable,
  }
}

/**
 * What the empty line at `index` must carry to bring the journal into balance.
 * Null when the journal is already in balance, or when any line cannot be read.
 */
export function balancingAmount(lines: DraftLine[], index: number): { side: 'debit' | 'credit'; amount: string } | null {
  const { debit, credit, unreadable } = totals(lines.filter((_, i) => i !== index))
  if (unreadable > 0 || debit === credit) return null
  return debit > credit
    ? { side: 'credit', amount: centsToText(debit - credit) }
    : { side: 'debit', amount: centsToText(credit - debit) }
}
