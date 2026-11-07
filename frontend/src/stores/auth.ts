import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../services/api'
import { markSignedIn, clearSession, hasSessionHint } from '../services/session'
import { isClientRole, type AuthUser, type Role } from '../services/types'

// Re-export so existing imports (`import type { User } from '@/stores/auth'`) keep working.
export type User = AuthUser
export type { Role }

/**
 * What a sign-in attempt produced. A password can be correct and still not
 * produce a session — staff accounts with MFA owe a second factor first — so
 * the two outcomes are distinct values rather than one nullable user.
 */
export type LoginOutcome =
  | { mfaRequired: false; user: AuthUser }
  | { mfaRequired: true; mfaToken: string }

// ── Session model ───────────────────────────────────────────────────────
// The access and refresh tokens live in httpOnly cookies (`vungu_at`,
// `vungu_rt`) set by the backend and unreadable from JavaScript. This store
// holds the hydrated user in memory ONLY. Nothing about the session — no
// token, no AuthUser — is persisted, so an XSS anywhere in the app can no
// longer lift a live session or the PII the user record carries (national
// ID, phone, physical address).
//
// The cost of in-memory-only is that a refresh must re-fetch the user: one
// GET /auth/me on boot, gated on the `auth_present` hint so anonymous
// visitors never pay for it. See services/session.ts.

export const useAuthStore = defineStore('auth', () => {
  // ── State ─────────────────────────────────────────────────────────────
  const user = ref<AuthUser | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ── Getters ───────────────────────────────────────────────────────────
  const isAuthenticated = computed(() => !!user.value)
  // `admin` is the council IT role: it owns staff user management and system
  // configuration (the /admin/* console). It is deliberately NOT a planning
  // role — admins cannot open planning cases, map/GIS workspaces or planning
  // analytics. The router enforces that boundary via ADMIN_BLOCKED (separation
  // of duties + keeping applicant PII off the IT desk). See docs/ADMIN.md.
  const isAdmin     = computed(() => user.value?.role === 'admin')
  const isPlanner   = computed(() => user.value?.role === 'planner')
  /** A council client (citizen), never staff. */
  const isClient    = computed(() => !!user.value && isClientRole(user.value.role))
  const isRegistered = computed(() => user.value?.role === 'registered')
  const userName  = computed(() => user.value?.name ?? '')
  const userEmail = computed(() => user.value?.email ?? '')

  // ── Internal helpers ──────────────────────────────────────────────────
  /**
   * Adopt the signed-in user. The backend has already set `vungu_at` and
   * `vungu_rt` on this response via Set-Cookie; there is nothing for the
   * client to store beyond the presence hint.
   */
  function adopt(u: AuthUser) {
    user.value = u
    markSignedIn()
  }

  function clearLocal() {
    user.value = null
    clearSession()
  }

  // ── Actions ───────────────────────────────────────────────────────────
  async function login(
    email: string,
    password: string,
    captcha?: { token: string; website?: string },
  ): Promise<LoginOutcome> {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.post('/auth/login', {
        email,
        password,
        captcha_token: captcha?.token,
        website: captcha?.website || '',
      })
      const payload = response.data?.data ?? response.data

      // An account with MFA enabled gets a short-lived pending token instead
      // of a session; nothing is signed in until POST /auth/mfa/challenge
      // succeeds. This is returned rather than thrown: it is not a failure,
      // it is the second half of a sign-in, and the screen renders the code
      // step from it. (It WAS thrown, with "not yet supported here" — which
      // meant enabling MFA locked the account out of the portal entirely.)
      if (payload?.mfaRequired) {
        return { mfaRequired: true, mfaToken: String(payload.mfaToken ?? '') }
      }

      const u = payload?.user as AuthUser | undefined
      if (!u) {
        throw new Error('Invalid login response')
      }
      adopt(u)
      return { mfaRequired: false, user: u }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } }
      // Locally-thrown Errors (MFA, malformed response) carry no `.response`,
      // so fall back to their message instead of masking them as 'Login failed'.
      error.value = e.response?.data?.message
        ?? e.response?.data?.error
        ?? (err instanceof Error ? err.message : null)
        ?? 'Login failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function register(userData: {
    email: string
    password: string
    name: string
    organization?: string
    phone?: string
    applicantType?: string
    nationalId?: string
    address?: string
    role?: string
    captchaToken?: string
    website?: string
  }) {
    isLoading.value = true
    error.value = null
    try {
      // Map the camelCase form model to the snake_case keys the backend
      // register endpoint reads. Identity captured here (national ID, phone,
      // address) is persisted to the profile and reused by every application.
      const response = await api.post('/auth/register', {
        email:          userData.email,
        password:       userData.password,
        name:           userData.name,
        organization:   userData.organization || undefined,
        phone:          userData.phone || undefined,
        applicant_type: userData.applicantType || undefined,
        national_id:    userData.nationalId || undefined,
        address:        userData.address || undefined,
        role:           userData.role || undefined,
        captcha_token:  userData.captchaToken,
        website:        userData.website || '',
      })
      const payload = response.data?.data ?? response.data
      const u = payload?.user as AuthUser | undefined
      if (!u) {
        throw new Error('Invalid register response')
      }
      adopt(u)
      return response.data
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      error.value = e.response?.data?.error ?? 'Registration failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Second half of a sign-in for an account with MFA. The pending token from
   * `login()` is the only thing that ties the two halves together — it is not
   * a session and requireAuth will not accept it, so an interrupted sign-in
   * leaves nothing usable behind.
   *
   * A backup code is accepted here too; the backend tries the authenticator
   * secret first and falls back to the one-time codes, burning the one used.
   */
  async function completeMfa(mfaToken: string, code: string) {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.post('/auth/mfa/challenge', { mfaToken, code: code.trim() })
      const payload = response.data?.data ?? response.data
      const u = payload?.user as AuthUser | undefined
      if (!u) throw new Error('Invalid response to the verification code')
      adopt(u)
      return u
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } }
      error.value = e.response?.data?.message ?? e.response?.data?.error ?? 'Verification failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Ask for a reset link. Resolves the same way whether or not the address
   * has an account — that is the backend's contract, deliberately, and the
   * screen must not invent a distinction the server refused to make.
   */
  async function requestPasswordReset(
    email: string,
    captcha?: { token: string; website?: string },
  ) {
    const response = await api.post('/auth/forgot-password', {
      email,
      captcha_token: captcha?.token,
      website: captcha?.website || '',
    })
    return (response.data?.message as string | undefined) ?? ''
  }

  /** Check a reset link before rendering the form behind it. */
  async function validateResetToken(token: string) {
    const response = await api.get('/auth/reset-password/validate', { params: { token } })
    return (response.data?.data ?? {}) as {
      email?: string
      expiresAt?: string
      passwordMinLength?: number
    }
  }

  /**
   * Spend a reset link. Deliberately does NOT sign in: the backend issues no
   * cookie here, so the new password is typed once more on the sign-in screen
   * — which proves it was remembered and keeps MFA in the loop for staff.
   */
  async function resetPassword(token: string, password: string) {
    await api.post('/auth/reset-password', { token, password })
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // Ignore network errors — we still clear local state below.
    } finally {
      clearLocal()
    }
  }

  /**
   * Re-mint the access cookie from the refresh cookie.
   *
   * Both tokens are httpOnly, so the client sends no body — the backend reads
   * `vungu_rt` (scoped to /api/auth) and issues a fresh `vungu_at` via
   * Set-Cookie. The response carries the user, not a token, so there is
   * nothing to persist. A failure means the session is genuinely gone.
   */
  async function refreshToken() {
    try {
      const response = await api.post('/auth/refresh')
      const payload = response.data?.data ?? response.data
      const u = payload?.user as AuthUser | undefined
      if (u) {
        adopt(u)
        return u
      }
    } catch {
      // Refresh rejected — fall through to a profile probe, which settles
      // whether the access cookie is still good.
    }
    try {
      return await fetchProfile()
    } catch {
      await logout()
    }
  }

  async function fetchProfile() {
    try {
      const response = await api.get('/auth/me')
      const payload = (response.data?.data ?? response.data) as AuthUser
      adopt(payload)
      return payload
    } catch (err) {
      await logout()
      throw err
    }
  }

  async function updateProfile(userData: Partial<AuthUser>) {
    if (!user.value) return
    isLoading.value = true
    error.value = null
    try {
      const response = await api.put('/auth/profile', userData)
      const merged = { ...user.value, ...(response.data?.data ?? response.data) } as AuthUser
      user.value = merged
      return merged
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      error.value = e.response?.data?.error ?? 'Profile update failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    await api.post('/auth/change-password', { currentPassword, newPassword })
  }

  /**
   * Boot-time session hydrate. The user is held in memory only, so after a
   * refresh the store is empty even though the cookies are still valid —
   * this re-fetches from /auth/me.
   *
   * Gated on the presence hint so an anonymous visitor on a public page
   * never issues a doomed request. If the hint is stale (cookie expired,
   * session revoked server-side), fetchProfile 401s and logs out, which is
   * exactly the right outcome.
   */
  async function initializeAuth() {
    if (!hasSessionHint()) return
    try {
      await fetchProfile()
    } catch {
      // fetchProfile already calls logout on failure; nothing more to do.
    }
  }

  const clearError = () => { error.value = null }

  return {
    // State
    user,
    isLoading,
    error,

    // Getters
    isAuthenticated,
    isAdmin,
    isPlanner,
    isClient,
    isRegistered,
    userName,
    userEmail,

    // Actions
    login,
    completeMfa,
    requestPasswordReset,
    validateResetToken,
    resetPassword,
    register,
    logout,
    refreshToken,
    fetchProfile,
    updateProfile,
    changePassword,
    initializeAuth,
    clearError,
  }
})
