/**
 * Turn an auth API failure into something a person can act on.
 *
 * WHY THIS IS A MODULE AND NOT `err.response.data.message`
 * The auth endpoints answer with eight distinct failures and they do not all
 * mean "try again". A locked account, a blocked network, a rate limit, a
 * suspended account and a wrong password all arrived at the same grey box
 * saying "Login failed", which is the single most common support call a
 * council help desk gets and the hardest to answer, because the screen threw
 * away the one thing that would have settled it.
 *
 * Each case here decides three things: what the person is told, whether
 * trying again could possibly help, and which field (if any) is at fault so
 * focus can land on it. Pure and testable — nothing here touches the network.
 */

/** The envelope every route in src/routes/auth.js answers with. */
interface AuthErrorBody {
  error?: string
  message?: string
  data?: { retryAt?: string; attemptsRemaining?: number }
}

interface AxiosLike {
  response?: { status?: number; data?: AuthErrorBody }
  code?: string
  message?: string
}

export interface AuthFailure {
  /** One sentence for the person. Never a stack, never a code. */
  message: string
  /** Backend error code where there was one — for tests and telemetry. */
  code: string | null
  /**
   * False when the same submission cannot possibly work: a lockout, a
   * suspension, a blocked network. The form disables submit rather than
   * inviting a sixth attempt that deepens the lockout.
   */
  retryable: boolean
  /** Field to move focus to, when the failure names one. */
  field?: 'email' | 'password' | 'captcha' | 'code'
  /** When a lockout or rate limit lifts, if the server said. */
  retryAt?: Date
  /** Attempts left before lockout, when the server volunteered it. */
  attemptsRemaining?: number
  /** True when the CAPTCHA must be re-drawn — its challenge is now spent. */
  refreshCaptcha: boolean
}

const OFFLINE =
  'Could not reach the council server. Check your connection and try again.'

/**
 * `429` arrives from two unrelated places: the account lockout in
 * loginSecurity, and @fastify/rate-limit guarding the whole /auth scope at
 * 10 requests a minute. They need different sentences — one is about the
 * account, the other about the device — and only the first carries a code.
 */
function rateLimited(body: AuthErrorBody | undefined): AuthFailure {
  return {
    message:
      body?.message && /rate limit/i.test(body.message)
        ? 'Too many requests from this device. Wait a minute and try again.'
        : body?.message || 'Too many requests. Wait a minute and try again.',
    code: 'rate_limited',
    retryable: false,
    refreshCaptcha: true,
  }
}

export function describeAuthError(err: unknown): AuthFailure {
  const e = err as AxiosLike

  // No response at all: DNS, offline, CORS, or the request never left. An
  // axios timeout carries code ECONNABORTED and no response.
  if (!e?.response) {
    if (e?.code === 'ECONNABORTED') {
      return {
        message: 'The council server took too long to answer. Try again.',
        code: 'timeout', retryable: true, refreshCaptcha: false,
      }
    }
    // A locally-thrown Error (malformed response, unsupported MFA) has its
    // own message and it is more accurate than anything invented here.
    const local = err instanceof Error && err.message && !/network error/i.test(err.message)
      ? err.message
      : OFFLINE
    return { message: local, code: null, retryable: true, refreshCaptcha: false }
  }

  const status = e.response.status ?? 0
  const body = e.response.data ?? {}
  const code = body.error ?? null
  const said = body.message

  switch (code) {
    case 'invalid_credentials':
      return {
        // The server appends "N attempts remaining" as the lockout nears; it
        // knows the count and this screen does not, so its wording wins.
        message: said || 'That email and password do not match an account.',
        code, retryable: true, field: 'password',
        attemptsRemaining: body.data?.attemptsRemaining,
        refreshCaptcha: true,
      }

    case 'locked_out':
      return {
        message: said || 'Too many failed sign-in attempts. Try again later or contact council IT.',
        code, retryable: false,
        retryAt: body.data?.retryAt ? new Date(body.data.retryAt) : undefined,
        refreshCaptcha: true,
      }

    case 'ip_blocked':
      return {
        message: said || 'Sign-in from this network has been blocked. Contact council IT.',
        code, retryable: false, refreshCaptcha: false,
      }

    case 'account_suspended':
      return {
        message: 'This account has been suspended. Contact council IT to have it restored.',
        code, retryable: false, refreshCaptcha: false,
      }

    case 'password_reset_required':
      return {
        message: 'This account needs a new password before it can be used. Use “Forgot password” below.',
        code, retryable: false, field: 'password', refreshCaptcha: false,
      }

    case 'captcha_failed':
      return {
        message: said || 'The security check did not pass. It has restarted — try again.',
        code, retryable: true, field: 'captcha', refreshCaptcha: true,
      }

    case 'invalid_mfa_code':
      return {
        message: 'That code is not right. Check your authenticator app, or use a backup code.',
        code, retryable: true, field: 'code', refreshCaptcha: false,
      }

    case 'invalid_or_expired_mfa_token':
      return {
        message: 'This sign-in took too long to confirm. Enter your password again.',
        code, retryable: false, refreshCaptcha: true,
      }

    case 'invalid_token':      // reset link
    case 'invite_invalid':
      return {
        message: said || 'This link has expired or has already been used. Request a new one.',
        code, retryable: false, refreshCaptcha: false,
      }

    case 'password_too_short':
      return { message: said || 'That password is too short.', code, retryable: true, field: 'password', refreshCaptcha: false }

    case 'invalid_email':
      return { message: said || 'Enter a valid email address.', code, retryable: true, field: 'email', refreshCaptcha: false }
  }

  // No code, so fall back on the status. 409 is only ever "email taken" on
  // these routes, and it is worth naming because the answer is "sign in",
  // not "try a different password".
  if (status === 409) {
    return {
      message: said || 'An account with this email already exists. Sign in instead, or reset the password.',
      code: 'email_taken', retryable: false, field: 'email', refreshCaptcha: true,
    }
  }
  if (status === 429) return rateLimited(body)
  if (status === 404) {
    // Fastify's not-found body carries the route it could not find, and
    // rendering that verbatim shows an officer "Route POST /api/auth/…
    // not found". A 404 on an auth endpoint means the frontend is ahead of
    // the backend — a deploy ordering problem, not something the person
    // reading it did.
    return {
      message: 'This part of the portal is not available right now. Try again shortly, or contact council IT.',
      code: 'not_deployed', retryable: false, refreshCaptcha: false,
    }
  }
  if (status === 400) {
    return {
      message: said || 'Some of the details are not valid. Check the fields above.',
      code, retryable: true, refreshCaptcha: true,
    }
  }
  if (status === 401 || status === 403) {
    return { message: said || 'You are not allowed to do that.', code, retryable: false, refreshCaptcha: true }
  }
  if (status >= 500) {
    return {
      message: 'The council server had a problem. Nothing was changed — try again in a moment.',
      code: 'server_error', retryable: true, refreshCaptcha: true,
    }
  }

  return { message: said || OFFLINE, code, retryable: true, refreshCaptcha: true }
}

/** "in 12 minutes" / "in under a minute" for a lockout countdown. */
export function untilPhrase(retryAt: Date | undefined, now = new Date()): string {
  if (!retryAt || Number.isNaN(retryAt.getTime())) return ''
  const minutes = Math.ceil((retryAt.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return 'now'
  if (minutes === 1) return 'in under a minute'
  return `in about ${minutes} minutes`
}
