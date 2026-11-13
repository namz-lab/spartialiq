/**
 * The money rules, as unit tests.
 *
 * These are the functions standing between a decimal string from the database and a figure a
 * council officer reads. Three properties matter and each has tests here: precision survives the
 * trip, an undefined percentage is not shown as zero, and two currencies cannot be added.
 */
import { describe, it, expect } from 'vitest'
import {
  formatMoney, formatPercentage, formatDate, formatDateTime, formatBytes,
  totalByCurrency, currenciesIn, toChartValue, currencyLabel, currencyName,
} from '../composables/useMoney'

describe('formatMoney', () => {
  it('groups thousands and keeps both decimal places', () => {
    expect(formatMoney('125000.00', 'USD')).toBe('US$ 125 000.00')
    expect(formatMoney('1234567.89', 'ZWG')).toBe('ZWG 1 234 567.89')
    expect(formatMoney('0.50', 'USD')).toBe('US$ 0.50')
  })

  it('does not lose precision a JavaScript number would', () => {
    // Number('99999999999999.99') is not that figure; the string path is.
    expect(formatMoney('99999999999999.99', 'ZWG', { bare: true })).toBe('99 999 999 999 999.99')
    expect(String(Number('99999999999999.99'))).not.toContain('99999999999999.99')
  })

  it('writes a negative with a true minus sign, not a hyphen', () => {
    expect(formatMoney('-2500.00', 'USD', { bare: true })).toBe('−2 500.00')
  })

  it('shows an em dash for a missing or unparseable amount rather than zero', () => {
    expect(formatMoney(null, 'USD')).toBe('—')
    expect(formatMoney(undefined, 'USD')).toBe('—')
    expect(formatMoney('n/a', 'USD')).toBe('—')
    expect(formatMoney('', 'USD')).toBe('—')
    // A zero that IS a zero still reads as a zero.
    expect(formatMoney('0.00', 'USD', { bare: true })).toBe('0.00')
  })

  it('omits the currency when the column header already carries it', () => {
    expect(formatMoney('1000.00', 'USD', { bare: true })).toBe('1 000.00')
  })

  it('rounds to whole units only when asked, for a dense table', () => {
    expect(formatMoney('1234.56', 'USD', { bare: true, whole: true })).toBe('1 234')
  })

  it('names both currencies, and gives ZWG its code rather than inventing a symbol', () => {
    expect(currencyLabel('USD')).toBe('US$')
    expect(currencyLabel('ZWG')).toBe('ZWG')
    expect(currencyName('ZWG')).toBe('Zimbabwe Gold')
  })
})

describe('formatPercentage', () => {
  it('says "not defined" where the API returns null, never 0%', () => {
    // The revised budget was zero, so execution is undefined — showing 0% for a line with spend
    // and no budget would be the most misleading figure on the page.
    expect(formatPercentage(null)).toBe('not defined')
    expect(formatPercentage(undefined)).toBe('not defined')
    expect(formatPercentage('')).toBe('not defined')
    expect(formatPercentage('nonsense')).toBe('not defined')
  })

  it('shows one decimal at most', () => {
    expect(formatPercentage('25.00')).toBe('25%')
    expect(formatPercentage('25.46')).toBe('25.4%')
    expect(formatPercentage('100')).toBe('100%')
    expect(formatPercentage(0)).toBe('0%')
  })
})

describe('totalByCurrency', () => {
  const rows = [
    { currency: 'USD' as const, amount: '10000.00' },
    { currency: 'USD' as const, amount: '5500.50' },
    { currency: 'ZWG' as const, amount: '750000.00' },
  ]

  it('returns one total per currency and never one total overall', () => {
    const totals = totalByCurrency(rows, (r) => r.amount)
    expect(totals).toEqual({ USD: '15500.50', ZWG: '750000.00' })
    // There is no key under which the two were combined.
    expect(Object.keys(totals)).toHaveLength(2)
    expect(totals).not.toHaveProperty('total')
  })

  it('adds exactly, on integer cents, where a float would drift', () => {
    const cents = [
      { currency: 'USD' as const, amount: '0.10' },
      { currency: 'USD' as const, amount: '0.20' },
    ]
    expect(totalByCurrency(cents, (r) => r.amount).USD).toBe('0.30')
    // The same sum in floating point does not produce 0.3.
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('is exact at a scale a float cannot represent', () => {
    const big = [
      { currency: 'ZWG' as const, amount: '99999999999999.99' },
      { currency: 'ZWG' as const, amount: '0.01' },
    ]
    expect(totalByCurrency(big, (r) => r.amount).ZWG).toBe('100000000000000.00')
  })

  it('handles reductions and a net negative', () => {
    const mixed = [
      { currency: 'USD' as const, amount: '1000.00' },
      { currency: 'USD' as const, amount: '-2500.00' },
    ]
    expect(totalByCurrency(mixed, (r) => r.amount).USD).toBe('-1500.00')
  })

  it('skips an unparseable amount rather than treating it as zero in a visible total', () => {
    const dirty = [
      { currency: 'USD' as const, amount: '100.00' },
      { currency: 'USD' as const, amount: 'n/a' },
    ]
    expect(totalByCurrency(dirty, (r) => r.amount).USD).toBe('100.00')
  })

  it('reports which currencies a set of rows is stated in', () => {
    expect(currenciesIn(rows)).toEqual(['USD', 'ZWG'])
    expect(currenciesIn([{ currency: 'USD' as const }])).toEqual(['USD'])
  })
})

describe('toChartValue', () => {
  it('produces a number, and is named so a reviewer can see a float has entered', () => {
    expect(toChartValue('1234.56')).toBe(1234.56)
    expect(toChartValue('-500.00')).toBe(-500)
    expect(toChartValue(null)).toBe(0)
    expect(toChartValue('n/a')).toBe(0)
  })
})

describe('dates and sizes', () => {
  it('writes a date the way a council writes it, from the text the API sent', () => {
    // The API sends DATE columns as text precisely so this is the council's date and not an
    // instant shifted by the reader's time zone.
    expect(formatDate('2031-03-31')).toBe('31 March 2031')
    expect(formatDate('2031-01-01')).toBe('1 January 2031')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })

  it('renders a timestamp, and an em dash for nothing', () => {
    expect(formatDateTime('2031-03-31T09:30:00.000Z')).toMatch(/2031/)
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('rubbish')).toBe('—')
  })

  it('renders a file size a person can read', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 kB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(null)).toBe('—')
  })
})
