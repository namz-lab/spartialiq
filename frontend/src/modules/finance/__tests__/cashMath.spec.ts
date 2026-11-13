// The counter's preview arithmetic and the amount in words. Integers throughout: the preview must
// agree with `round(quantity * unit_amount, 2)` in Postgres to the cent, every time.
import { describe, it, expect } from 'vitest'
import { amountInWords, centsToText, CURRENCY_WORDS, lineCents, toCents, toThousandths } from '../composables/cashMath'

describe('cash arithmetic', () => {
  it('reads money as integer cents and refuses what is not a plain amount', () => {
    expect(toCents('40')).toBe(4000n)
    expect(toCents('12.5')).toBe(1250n)
    expect(toCents('0.07')).toBe(7n)
    for (const bad of ['', '-1', '1.234', 'abc', '1,000', '1e3', null, undefined]) expect(toCents(bad)).toBeNull()
  })

  it('reads a quantity to three places', () => {
    expect(toThousandths('2.5')).toBe(2500n)
    expect(toThousandths('1.2345')).toBeNull()
  })

  it('rounds a line once, on the product, half up — as the database does', () => {
    expect(lineCents('2', '40.00')).toBe(8000n)
    expect(lineCents('', '7.50')).toBe(750n)          // a blank quantity is one
    expect(lineCents('0.333', '10.00')).toBe(333n)    // 3.33
    expect(lineCents('0.335', '1.00')).toBe(34n)      // 0.335 → 0.34, not 0.33
    expect(lineCents('1.5', '0.33')).toBe(50n)        // 0.495 → 0.50
    expect(lineCents('0', '10.00')).toBeNull()
    expect(lineCents('1', '')).toBeNull()
  })

  it('never loses a cent to floating point', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; three lines of 0.10 must be exactly 0.30.
    const total = [lineCents('1', '0.10')!, lineCents('1', '0.10')!, lineCents('1', '0.10')!].reduce((a, b) => a + b, 0n)
    expect(centsToText(total)).toBe('0.30')
    expect(centsToText(123456789n)).toBe('1234567.89')
    expect(centsToText(-200n)).toBe('-2.00')
  })

  it('writes the amount in words for the receipt, naming the currency it is in', () => {
    expect(amountInWords('40.00', CURRENCY_WORDS.USD)).toBe('Forty United States dollars only')
    expect(amountInWords('105.50', CURRENCY_WORDS.USD)).toBe('One hundred and five United States dollars and 50 cents')
    expect(amountInWords('1250000.00', CURRENCY_WORDS.ZWG)).toBe('One million two hundred and fifty thousand Zimbabwe Gold only')
    expect(amountInWords('0.75', CURRENCY_WORDS.USD)).toBe('Zero United States dollars and 75 cents')
    expect(amountInWords('21.00', CURRENCY_WORDS.USD)).toBe('Twenty-one United States dollars only')
    expect(amountInWords('rubbish', CURRENCY_WORDS.USD)).toBe('')
  })
})
