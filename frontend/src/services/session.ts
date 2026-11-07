// Session state for the cookie-based auth session.
//
// The backend owns the session: POST /api/auth/login sets `vungu_at` (12h,
// httpOnly, sameSite=lax, path=/) and `vungu_rt` (httpOnly, path=/api/auth).
// See ../app-backend/src/middleware/jwtAuth.js setAuthCookies().
// Because those cookies are httpOnly, JavaScript cannot read them — so the
// client keeps ONE non-sensitive bit: "a session probably exists". That lets
// the router decide whether to await a /auth/me hydrate before resolving a
// guard, without a blocking request on every anonymous page load.
//
// Deliberately holds no token and no user record. Access tokens, refresh
// tokens and the AuthUser (name, email, phone, national ID, address) used to
// live in localStorage, which made any XSS in the app a full session +
// PII disclosure. They do not live here.
//
// This module imports nothing — services/api.ts imports it, and stores/auth.ts
// imports services/api.ts, so any dependency of its own risks a cycle.

const HINT_KEY = 'auth_present'

/**
 * Cached role data written by the per-role case composables (planner case
 * files, inspector cases, clerk registers, EHO records, GIS requests, studio
 * drafts). These carry applicant PII — national ID, phone, address — and
 * objector names, and must not outlive the session on a shared council
 * workstation, where the next user is a different officer.
 *
 * Matched by prefix rather than an explicit key list: the composables build
 * keys dynamically (`planner_case_${permitId}`, `bpa_check_${id}`), and an
 * exhaustive literal list would silently rot as sections are added.
 */
const CASE_CACHE_PREFIXES = [
  'planner_',      // planner_case_*, planner_recent_cases
  'inspector_',    // inspector_case_*
  'clerk_',        // clerk_acknowledgements_v1, clerk_fee_receipts_v1, …
  'eho_',          // eho_case_*, eho_complaints_v1, eho_burial_permits_v1, …
  'gis_',          // gis_map_requests_v1, gis_data_quality_v1, …
  'citizen_',      // citizen_drafts_v1
  'studio-draft:', // subdivision studio drafts
  'bpa_check_',    // building-plan appraisal checklists
  'survey.',       // survey.estimate.draft
]

/**
 * Exact keys that carry identity or case data but share no common prefix.
 * `userProfile` / `surveyorProfile` hold the surveyor's email, licence and
 * registration numbers, phone and address.
 */
const CASE_CACHE_KEYS = [
  'userProfile',
  'surveyorProfile',  // legacy key, still written by older builds
  'selectedProject',
  'recentControlPoints',
  'vungu.noticeEmail',  // legacy PII key, superseded by vungu.noticeSubscribed
]

/**
 * Non-sensitive UI preferences that happen to share a purged prefix. These
 * are settings, not case data, and survive logout so the next sign-in does
 * not reset the officer's chosen language.
 */
const PREFERENCE_KEYS = new Set(['citizen_language'])

function isPurgeable(key: string): boolean {
  if (PREFERENCE_KEYS.has(key)) return false
  if (CASE_CACHE_KEYS.includes(key)) return true
  return CASE_CACHE_PREFIXES.some(p => key.startsWith(p))
}

/** True if a session cookie is believed to exist. Advisory only — the backend
 *  is the authority, and any protected call still 401s if it is wrong. */
export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    // localStorage unavailable (private mode / disabled) — treat as no hint.
    // Auth still works; the app just probes /auth/me on first guarded route.
    return false
  }
}

/** Record that login succeeded and the browser now holds the session cookies. */
export function markSignedIn(): void {
  try { localStorage.setItem(HINT_KEY, '1') } catch { /* non-fatal */ }
}

/**
 * Drop the hint and every cached role case-file. Called on logout and on any
 * 401, so a rejected session cannot leave PII readable on the workstation.
 * The cookies themselves are cleared server-side by POST /api/auth/logout —
 * httpOnly means the client cannot clear them itself.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(HINT_KEY)
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isPurgeable(k)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    // localStorage unavailable — nothing cached, nothing to purge.
  }
}
