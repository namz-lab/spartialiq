import { describe, it, expect } from 'vitest'
import {
  validateEmail, validateName, validatePhone, validateNationalId,
  validatePassword, validateConfirmation, passwordStrength,
  normalisePhone, normaliseNationalId, collectErrors, joinName,
} from '../validation'
import { describeAuthError, untilPhrase } from '../authErrors'

/** Axios shapes an error response like this; the mapper reads nothing else. */
const apiError = (status: number, data: unknown) => ({ response: { status, data } })

describe('validateEmail', () => {
  it('accepts an ordinary address', () => {
    expect(validateEmail('planner@vungurdc.gov.zw').ok).toBe(true)
  })

  it('rejects what the server would also reject', () => {
    for (const bad of ['', 'nobody', 'no@domain', 'a b@c.zw', '@vungu.zw', 'x@.zw']) {
      expect(validateEmail(bad).ok, bad).toBe(false)
    }
  })

  it('always explains itself', () => {
    expect(validateEmail('nobody').message).toBeTruthy()
  })
})

describe('validateName', () => {
  it('accepts a name with accents or an apostrophe', () => {
    expect(validateName("N'anga Chipo").ok).toBe(true)
    expect(validateName('José Müller').ok).toBe(true)
  })

  it('rejects digits-only and angle brackets', () => {
    expect(validateName('12345').ok).toBe(false)
    expect(validateName('<script>').ok).toBe(false)
  })

  it('names the field it is checking', () => {
    // Sign-up asks for a first name and a surname separately, so "Enter your
    // full name" under the surname box would say nothing about which is wrong.
    expect(validateName('', { what: 'surname' }).message).toBe('Enter your surname.')
    expect(validateName('', { what: 'first name' }).message).toBe('Enter your first name.')
    expect(validateName('').message).toBe('Enter your full name.')
  })

  it('honours a tighter per-field cap', () => {
    expect(validateName('a'.repeat(61), { what: 'surname', max: 60 }).ok).toBe(false)
    expect(validateName('a'.repeat(60), { what: 'surname', max: 60 }).ok).toBe(true)
  })
})

describe('joinName', () => {
  it('builds the single name the register and every permit carry', () => {
    expect(joinName('Chipo', 'Moyo')).toBe('Chipo Moyo')
  })

  it('trims, and never leaves a stray space when a part is missing', () => {
    expect(joinName('  Chipo  ', '  Moyo  ')).toBe('Chipo Moyo')
    expect(joinName('Chipo', '')).toBe('Chipo')
    expect(joinName('', 'Moyo')).toBe('Moyo')
    expect(joinName('', '')).toBe('')
  })

  it('can exceed the server cap from two in-range parts', () => {
    // 60 + 60 + the space is 121, one past what /auth/register accepts —
    // which is why RegisterView checks the joined length, not just each half.
    expect(joinName('a'.repeat(60), 'b'.repeat(60)).length).toBe(121)
  })
})

describe('Zimbabwe phone numbers', () => {
  it('accepts every way the same mobile is written', () => {
    for (const form of ['0771234567', '077 123 4567', '+263771234567', '+263 77 123 4567', '263771234567']) {
      expect(validatePhone(form).ok, form).toBe(true)
      expect(normalisePhone(form)).toBe('+263771234567')
    }
  })

  it('rejects a number of the wrong length', () => {
    expect(validatePhone('07712345').ok).toBe(false)
    expect(validatePhone('+2637712345678').ok).toBe(false)
  })

  it('is optional unless asked for', () => {
    expect(validatePhone('').ok).toBe(true)
    expect(validatePhone('', { required: true }).ok).toBe(false)
  })
})

describe('Zimbabwe national ID', () => {
  it('accepts the card format however it is punctuated', () => {
    for (const form of ['63-123456 K 42', '63123456K42', '63-1234567-K-42']) {
      expect(validateNationalId(form).ok, form).toBe(true)
    }
    expect(normaliseNationalId('63-123456 k 42')).toBe('63123456K42')
  })

  it('rejects a serial of the wrong length or a missing check letter', () => {
    expect(validateNationalId('63-12345 K 42').ok).toBe(false)
    expect(validateNationalId('63-123456 42').ok).toBe(false)
  })

  it('is optional by default — it can be added to the profile later', () => {
    expect(validateNationalId('').ok).toBe(true)
    expect(validateNationalId('', { required: true }).ok).toBe(false)
  })
})

describe('validatePassword', () => {
  it('honours the council minimum rather than a literal', () => {
    expect(validatePassword('abcd1234', { minLength: 8 }).ok).toBe(true)
    expect(validatePassword('abcd1234', { minLength: 12 }).ok).toBe(false)
  })

  it('refuses the passwords an attacker tries first', () => {
    for (const bad of ['password', 'Password123', 'demo1234', 'vungurdc', '12345678']) {
      expect(validatePassword(bad).ok, bad).toBe(false)
    }
  })

  it('refuses a password built from the account it protects', () => {
    expect(validatePassword('chipo-moyo-2026', { avoid: ['chipo.moyo@vungu.zw'] }).ok).toBe(false)
    expect(validatePassword('tsime-kubvumbi-11', { avoid: ['chipo.moyo@vungu.zw'] }).ok).toBe(true)
  })

  it('refuses a run of keys and a single repeated character', () => {
    expect(validatePassword('abcdefgh').ok).toBe(false)
    expect(validatePassword('qwertyuiop').ok).toBe(false)
    expect(validatePassword('aaaaaaaaaa').ok).toBe(false)
  })

  it('caps at 72 bytes, because bcrypt silently ignores the rest', () => {
    expect(validatePassword('a1'.repeat(40)).ok).toBe(false)
  })

  it('accepts a long passphrase with no symbols at all', () => {
    // The point of the policy: length beats composition.
    expect(validatePassword('mvura inonaya muHarare').ok).toBe(true)
  })
})

describe('passwordStrength', () => {
  it('is advice, not a gate — it scores without rejecting', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('abcd1234').score).toBeGreaterThanOrEqual(1)
    expect(passwordStrength('Tsime-Kubvumbi-2026!').score).toBe(4)
  })

  it('does not reward a long password made of three characters', () => {
    expect(passwordStrength('ababababababababab').score).toBeLessThanOrEqual(1)
  })

  it('stops offering a hint once there is nothing left to say', () => {
    expect(passwordStrength('Tsime-Kubvumbi-2026!').hint).toBe('')
    expect(passwordStrength('abcd1234').hint).not.toBe('')
  })
})

describe('validateConfirmation', () => {
  it('catches a mismatch and an empty confirmation separately', () => {
    expect(validateConfirmation('abc', '').message).toMatch(/again/i)
    expect(validateConfirmation('abc', 'abd').message).toMatch(/match/i)
    expect(validateConfirmation('abc', 'abc').ok).toBe(true)
  })
})

describe('collectErrors', () => {
  it('names the first invalid field so focus can land on it', () => {
    const { errors, valid, firstInvalid } = collectErrors({
      name: { ok: true },
      email: { ok: false, message: 'Enter your email address.' },
      password: { ok: false, message: 'Choose a password.' },
    })
    expect(valid).toBe(false)
    expect(firstInvalid).toBe('email')
    expect(errors.email).toBe('Enter your email address.')
    expect(errors.name).toBeUndefined()
  })

  it('reports valid when everything passes', () => {
    const { valid, firstInvalid } = collectErrors({ a: { ok: true }, b: { ok: true } })
    expect(valid).toBe(true)
    expect(firstInvalid).toBeNull()
  })
})

describe('describeAuthError', () => {
  it('tells a lockout apart from a wrong password', () => {
    const wrong = describeAuthError(apiError(401, { error: 'invalid_credentials' }))
    expect(wrong.retryable).toBe(true)
    expect(wrong.field).toBe('password')

    const locked = describeAuthError(apiError(429, {
      error: 'locked_out', data: { retryAt: '2026-09-23T10:00:00Z' },
    }))
    expect(locked.retryable).toBe(false)
    expect(locked.retryAt).toBeInstanceOf(Date)
  })

  it('tells an account lockout apart from the scope rate limit', () => {
    // Both are 429. Only one is about the account, and the other must not
    // tell the officer their account is locked when it is not.
    const limited = describeAuthError(apiError(429, {
      error: 'too_many_requests', message: 'Rate limit exceeded. Please wait before retrying.',
    }))
    expect(limited.code).toBe('rate_limited')
    expect(limited.message).toMatch(/device/i)
  })

  it('prefers the server wording when it knows more than the client', () => {
    // The server counts the attempts; this screen does not.
    const near = describeAuthError(apiError(401, {
      error: 'invalid_credentials',
      message: 'Invalid email or password. 1 attempt remaining before lockout.',
      data: { attemptsRemaining: 1 },
    }))
    expect(near.message).toMatch(/1 attempt remaining/)
    expect(near.attemptsRemaining).toBe(1)
  })

  it('marks a suspended account and a blocked network as not worth retrying', () => {
    expect(describeAuthError(apiError(403, { error: 'account_suspended' })).retryable).toBe(false)
    expect(describeAuthError(apiError(403, { error: 'ip_blocked' })).retryable).toBe(false)
  })

  it('sends an expired MFA token back to the password step', () => {
    const stale = describeAuthError(apiError(401, { error: 'invalid_or_expired_mfa_token' }))
    expect(stale.retryable).toBe(false)
    const wrongCode = describeAuthError(apiError(401, { error: 'invalid_mfa_code' }))
    expect(wrongCode.retryable).toBe(true)
    expect(wrongCode.field).toBe('code')
  })

  it('points a duplicate registration at sign-in instead of a retry', () => {
    const taken = describeAuthError(apiError(409, {}))
    expect(taken.code).toBe('email_taken')
    expect(taken.field).toBe('email')
    expect(taken.retryable).toBe(false)
  })

  it('says a 500 changed nothing, so it is safe to retry', () => {
    const boom = describeAuthError(apiError(500, {}))
    expect(boom.retryable).toBe(true)
    expect(boom.message).toMatch(/nothing was changed/i)
  })

  it('handles a request that never reached the server', () => {
    expect(describeAuthError({ message: 'Network Error' }).message).toMatch(/connection/i)
    expect(describeAuthError({ code: 'ECONNABORTED' }).code).toBe('timeout')
  })
})

describe('untilPhrase', () => {
  const now = new Date('2026-09-23T09:00:00Z')

  it('rounds up to whole minutes and reads as a sentence', () => {
    expect(untilPhrase(new Date('2026-09-23T09:12:00Z'), now)).toBe('in about 12 minutes')
    expect(untilPhrase(new Date('2026-09-23T09:00:30Z'), now)).toBe('in under a minute')
    expect(untilPhrase(new Date('2026-09-23T08:59:00Z'), now)).toBe('now')
  })

  it('says nothing when the server did not say', () => {
    expect(untilPhrase(undefined, now)).toBe('')
  })
})
