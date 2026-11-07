/**
 * Field rules for the sign-in, sign-up, reset and invite forms.
 *
 * Pure and dependency-free on purpose: these are the only four screens an
 * anonymous visitor can reach, they are the ones a script hammers, and they
 * are the ones that must still work on a slow rural connection. A validation
 * library would be more code on the critical path than the rules it holds.
 *
 * Nothing here is a security boundary — src/routes/auth.js re-checks every
 * one of these on the server, and the server's answer always wins. What this
 * buys is that the applicant is told what is wrong *before* they submit,
 * which on a 3G link is the difference between one round trip and five.
 */

export interface FieldCheck {
  /** True when the value may be submitted. */
  ok: boolean
  /** One sentence, addressed to the person, present tense. Absent when ok. */
  message?: string
}

const OK: FieldCheck = { ok: true }
const fail = (message: string): FieldCheck => ({ ok: false, message })

/**
 * Same shape as the server's EMAIL_RX (src/routes/auth.js) plus a length cap.
 * Deliberately not an RFC 5322 parser: the only address that matters is one a
 * mail server will accept, and that is settled by the confirmation email, not
 * by a regex.
 */
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(value: string): FieldCheck {
  const v = value.trim()
  if (!v) return fail('Enter your email address.')
  if (v.length > 255) return fail('That email address is too long.')
  if (/\s/.test(v)) return fail('An email address cannot contain spaces.')
  if (!EMAIL_RX.test(v)) return fail('Enter a complete email address, for example name@example.com.')
  return OK
}

/**
 * `what` names the field in the message, because the sign-up form asks for a
 * first name and a surname separately and "Enter your full name" under the
 * surname box tells the person nothing about which box is wrong. `max` exists
 * because two fields that each allow the server's full 120 characters can
 * join into 121 and be rejected by an endpoint the person cannot see.
 */
export function validateName(
  value: string,
  { what = 'full name', min = 2, max = 120 } = {},
): FieldCheck {
  const v = value.trim()
  if (!v || v.length < min) return fail(`Enter your ${what}.`)
  if (v.length > max) return fail(`That ${what} is too long for the register.`)
  // A permit is issued in this name and a notice is served on it, so it has
  // to be a name rather than a handle.
  if (!/[\p{L}]/u.test(v)) return fail(`Enter your ${what} as it appears on your ID.`)
  if (/[<>]/.test(v)) return fail('A name cannot contain < or >.')
  return OK
}

/**
 * What goes to the server as one `name`. The council's register, every permit
 * and every served notice carry this string, so it is built in one place
 * rather than concatenated at each call site.
 */
export function joinName(firstName: string, surname: string): string {
  return [firstName.trim(), surname.trim()].filter(Boolean).join(' ')
}

// ── Zimbabwe telephone numbers ─────────────────────────────────────────
// Accepted: +263 77 123 4567, 0771234567, 077 123 4567, and the same with
// any mix of spaces, hyphens or brackets. Stored and sent normalised.
export function normalisePhone(value: string): string {
  const raw = value.replace(/[\s()\-.]/g, '')
  if (/^\+263\d{9}$/.test(raw)) return raw
  if (/^263\d{9}$/.test(raw)) return `+${raw}`
  if (/^0\d{9}$/.test(raw)) return `+263${raw.slice(1)}`
  return value.trim()
}

export function validatePhone(value: string, { required = false } = {}): FieldCheck {
  const v = value.trim()
  if (!v) return required ? fail('Enter a phone number the council can reach you on.') : OK
  const digits = v.replace(/[\s()\-.+]/g, '')
  if (/[^\d]/.test(digits)) return fail('A phone number can only contain digits, spaces and + ( ) -.')
  const normalised = normalisePhone(v)
  if (!/^\+263\d{9}$/.test(normalised)) {
    return fail('Enter a Zimbabwean number, for example 077 123 4567 or +263 77 123 4567.')
  }
  return OK
}

// ── Zimbabwe national identity number ──────────────────────────────────
// 63-123456 K 42 — two digits for the registration office, six or seven
// serial digits, one check letter, two digits for the district of origin.
// Separators are whatever the holder's card happens to print.
const NATIONAL_ID_RX = /^\d{2}\d{6,7}[A-Z]\d{2}$/

export function normaliseNationalId(value: string): string {
  return value.replace(/[\s\-.]/g, '').toUpperCase()
}

export function validateNationalId(value: string, { required = false } = {}): FieldCheck {
  const v = value.trim()
  if (!v) return required ? fail('Enter your national ID number.') : OK
  const compact = normaliseNationalId(v)
  if (!NATIONAL_ID_RX.test(compact)) {
    return fail('Enter it as it appears on your ID, for example 63-123456 K 42.')
  }
  return OK
}

// ── Passwords ──────────────────────────────────────────────────────────
// Length and re-use are what actually decide whether an account falls, so
// those are what is enforced. Composition rules ("one capital, one symbol")
// are not: they push people to Password1! and are no longer recommended
// (NIST SP 800-63B). The strength meter below is advice, never a gate.

/**
 * The passwords a script tries first, plus the ones this portal invites by
 * name. Not a breach corpus — the server's lockout handles volume — but the
 * handful that would otherwise be chosen here and guessed in three attempts.
 */
const OBVIOUS_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', 'qwertyuiop', 'qwerty123', 'iloveyou', 'welcome1', 'welcome123',
  'admin123', 'letmein1', 'abc12345', 'football', 'zimbabwe', 'harare123',
  'vungu123', 'vungurdc', 'council1', 'demo1234', 'changeme', 'password@1',
])

export interface PasswordPolicy {
  /** The council's own minimum (admin_setting security.password_min_length). */
  minLength?: number
  /**
   * Values the password must not simply repeat — the account's own email and
   * name. A password that is the address it protects survives no attack.
   */
  avoid?: (string | undefined | null)[]
}

export function validatePassword(value: string, policy: PasswordPolicy = {}): FieldCheck {
  const minLength = policy.minLength ?? 8
  if (!value) return fail('Choose a password.')
  if (value.length < minLength) {
    return fail(`Use at least ${minLength} characters. Longer is stronger than complicated.`)
  }
  // bcrypt only reads the first 72 bytes, so anything past that is silently
  // ignored rather than stored — better to say so than to let someone rely on it.
  if (value.length > 72) return fail('Use 72 characters or fewer.')
  if (/^\s|\s$/.test(value)) return fail('A password cannot start or end with a space.')

  const lower = value.toLowerCase()
  if (OBVIOUS_PASSWORDS.has(lower)) {
    return fail('That is one of the first passwords an attacker tries. Choose another.')
  }
  if (/^(.)\1+$/.test(value)) return fail('Repeating one character is not a password.')
  if (isRunOfKeys(lower)) return fail('That is a straight run of keys. Choose something less predictable.')

  // Compared on letters and digits only. `chipo.moyo@vungu.zw` and
  // `Chipo-Moyo-2026` are the same password to anyone guessing it, and a
  // plain substring test on the raw strings misses that entirely — the
  // punctuation is exactly what the person changed to feel safe.
  const flat = lower.replace(/[^a-z0-9]/g, '')
  for (const raw of policy.avoid ?? []) {
    const hint = String(raw ?? '').trim().toLowerCase()
    if (!hint) continue
    const stem = hint.includes('@') ? hint.split('@')[0] : hint
    // The whole stem, and each word in it — a surname on its own is as
    // guessable as the full name.
    const parts = [stem, ...stem.split(/[^a-z0-9]+/)]
    for (const part of parts) {
      const needle = part.replace(/[^a-z0-9]/g, '')
      if (needle.length >= 4 && flat.includes(needle)) {
        return fail('Your password must not contain your name or email address.')
      }
    }
  }
  return OK
}

/** `abcdefg`, `1234567`, `qwertyu` — consecutive on the alphabet, row or pad. */
function isRunOfKeys(lower: string): boolean {
  const rows = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  return rows.some((row) => {
    const back = [...row].reverse().join('')
    return row.includes(lower) || back.includes(lower)
  })
}

export interface PasswordStrength {
  /** 0 unusable, 1 weak, 2 fair, 3 strong, 4 excellent. */
  score: 0 | 1 | 2 | 3 | 4
  label: string
  /** What would move it up one band. Empty once there is nothing worth saying. */
  hint: string
}

/**
 * Advice, not a gate — a password that passes validatePassword can be
 * submitted at any score. Length dominates the score because length is what
 * dominates the real cost of guessing it.
 */
export function passwordStrength(value: string): PasswordStrength {
  if (!value) return { score: 0, label: '', hint: '' }

  const classes =
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) +
    Number(/\d/.test(value)) + Number(/[^\w\s]/.test(value))
  const distinct = new Set(value).size

  let score = 0
  if (value.length >= 8) score = 1
  if (value.length >= 10 && (classes >= 2 || value.length >= 14)) score = 2
  if (value.length >= 12 && classes >= 3) score = 3
  if (value.length >= 14 && classes >= 3 && distinct >= 10) score = 4
  // A long password made of three characters is not a long password.
  if (distinct <= 4) score = Math.min(score, 1) as 0 | 1
  if (OBVIOUS_PASSWORDS.has(value.toLowerCase())) score = 0

  const labels = ['Too easy to guess', 'Weak', 'Fair', 'Strong', 'Excellent']
  const hint =
    score >= 4 ? ''
      : value.length < 12 ? 'Add a few more characters — length helps most.'
        : classes < 3 ? 'Mix in a number or a symbol.'
          : 'Add a few more characters.'

  return { score: score as PasswordStrength['score'], label: labels[score], hint }
}

export function validateConfirmation(password: string, confirmation: string): FieldCheck {
  if (!confirmation) return fail('Type the password again to confirm it.')
  if (password !== confirmation) return fail('The two passwords do not match.')
  return OK
}

/** Required free-text: organisation on a business account, a sign-in password. */
export function validateRequired(value: string, message: string): FieldCheck {
  return value.trim() ? OK : fail(message)
}

/**
 * Collapse a form's checks into the errors to render.
 *
 * Returns a plain record so a view can bind `errors.email` straight onto the
 * field, and `firstInvalid` so submit can move focus to the field that
 * actually needs attention rather than scrolling the person to the top.
 */
export function collectErrors<K extends string>(
  checks: Record<K, FieldCheck>,
): { errors: Partial<Record<K, string>>; valid: boolean; firstInvalid: K | null } {
  const errors: Partial<Record<K, string>> = {}
  let firstInvalid: K | null = null
  for (const key of Object.keys(checks) as K[]) {
    const check = checks[key]
    if (!check.ok) {
      errors[key] = check.message
      if (firstInvalid === null) firstInvalid = key
    }
  }
  return { errors, valid: firstInvalid === null, firstInvalid }
}
