import { describe, it, expect } from 'vitest'
import {
  sanitizeDecimal, sanitizeInteger, sanitizePhone, sanitizeNationalId,
  isPositiveNumber, isNationalId, isZwPhone, isEmail, isPersonName, isJobTitle,
  documentFileError, imageFileError, toPermitDevType, parseOptionalNumber,
} from '../citizenValidation'

describe('sanitizeDecimal / sanitizeInteger', () => {
  it('strips letters and extra dots from quantities', () => {
    expect(sanitizeDecimal('12a00.5b0.1')).toBe('1200.501')
    expect(sanitizeDecimal('e10')).toBe('10')
    expect(sanitizeInteger('3 floors')).toBe('3')
    expect(sanitizeInteger('twelve')).toBe('')
  })
})

describe('isPositiveNumber', () => {
  it('rejects empty, letters, scientific notation and negatives', () => {
    expect(isPositiveNumber('')).toBe(false)
    expect(isPositiveNumber('abc')).toBe(false)
    expect(isPositiveNumber('1e3')).toBe(false)
    expect(isPositiveNumber('-4')).toBe(false)
    expect(isPositiveNumber('0', { min: 1 })).toBe(false)
    expect(isPositiveNumber('1200', { min: 1 })).toBe(true)
    expect(isPositiveNumber('2.5', { integer: true })).toBe(false)
    expect(isPositiveNumber('2', { integer: true, min: 1 })).toBe(true)
    expect(isPositiveNumber('0', { integer: true, min: 0 })).toBe(true)
    expect(isPositiveNumber('10', { min: 0, max: 10 })).toBe(true)
    expect(isPositiveNumber('11', { min: 0, max: 10 })).toBe(false)
  })
})

describe('identity', () => {
  it('accepts Zimbabwe national ID formats used on the form', () => {
    expect(isNationalId('12-345678-X-78')).toBe(true)
    expect(isNationalId('63-212345A18')).toBe(true)
    expect(isNationalId('ABCDEF')).toBe(false)
    expect(isNationalId('12-345678')).toBe(false)
  })

  it('accepts EcoCash / OneMoney / InnBucks numbers and rejects letters', () => {
    expect(isZwPhone('0771234567')).toBe(true)
    expect(isZwPhone('+263771234567')).toBe(true)
    expect(isZwPhone('0711234567')).toBe(true)
    expect(isZwPhone('0861234567')).toBe(true)
    expect(isZwPhone('not-a-phone')).toBe(false)
    expect(isZwPhone('123')).toBe(false)
    expect(sanitizePhone('077 123 4567abc')).toBe('0771234567')
    expect(sanitizeNationalId('12-345678-x-78!!!')).toBe('12-345678-X-78')
  })

  it('validates email and person names', () => {
    expect(isEmail('citizen@vungu.test')).toBe(true)
    expect(isEmail('not-an-email')).toBe(false)
    expect(isPersonName('Tendai Moyo')).toBe(true)
    expect(isPersonName('12345')).toBe(false)
  })

  it('validates job titles used on staff invite', () => {
    expect(isJobTitle('Planning Officer')).toBe(true)
    expect(isJobTitle('EO-2')).toBe(true)
    expect(isJobTitle('x')).toBe(false)
    expect(isJobTitle('***')).toBe(false)
  })
})

describe('imageFileError', () => {
  it('rejects non-image and oversize files', () => {
    const jpg = new File([new Uint8Array(4)], 'site.jpg', { type: 'image/jpeg' })
    expect(imageFileError(jpg)).toBeNull()
    const pdf = new File([new Uint8Array(4)], 'plan.pdf', { type: 'application/pdf' })
    expect(imageFileError(pdf)).toMatch(/JPG/)
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect(imageFileError(huge)).toMatch(/10 MB/)
  })
})

describe('documentFileError', () => {
  it('rejects oversize and non PDF/JPG/PNG files', () => {
    const pdf = new File([new Uint8Array(4)], 'plan.pdf', { type: 'application/pdf' })
    expect(documentFileError(pdf)).toBeNull()
    const txt = new File([new Uint8Array(4)], 'notes.txt', { type: 'text/plain' })
    expect(documentFileError(txt)).toMatch(/PDF/)
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    expect(documentFileError(huge)).toMatch(/10 MB/)
  })
})

describe('toPermitDevType', () => {
  it('maps land-use category + works onto backend VALID_TYPES', () => {
    expect(toPermitDevType('residential', 'new_building')).toBe('new_building')
    expect(toPermitDevType('commercial', 'addition')).toBe('extension')
    expect(toPermitDevType('subdivision', 'new_building')).toBe('subdivision')
    expect(toPermitDevType('change_of_use', '')).toBe('change_of_use')
    expect(toPermitDevType('residential', 'alteration')).toBe('alteration')
    expect(toPermitDevType('advertisement', '')).toBe('other')
    expect(toPermitDevType('new_building', '')).toBe('new_building')
  })
})

describe('parseOptionalNumber', () => {
  it('returns null for blank and a number for valid input', () => {
    expect(parseOptionalNumber('')).toBeNull()
    expect(parseOptionalNumber('180')).toBe(180)
    expect(parseOptionalNumber('nope')).toBeNull()
  })
})
