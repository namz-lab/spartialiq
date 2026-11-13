// What belongs to the person who is signed in, and how it is dropped when they leave.
//
// WHY THIS EXISTS
// Signing out used to clear three things: the in-memory `AuthUser`, the `auth_present` hint, and
// the cached role case-files in localStorage (see ./session.ts). It did NOT clear the Pinia
// stores, because nothing navigates away from the app — a sign-out is a route change inside one
// long-lived page, and a store created on the first visit lives until the tab is closed.
//
// On a shared council workstation that is the normal case rather than the edge case: one browser,
// one tab, officers taking turns at it. The second officer signed in and inherited the first
// officer's finance permission set, departmental scope, selected financial year and loaded
// classifications, and the planning board's loaded applications — until each store happened to
// refetch. The finance workspace worked around this by calling `financeStore.reset()` from its
// own sign-out handler, which fixed the one door it knew about and left every other way out of
// the app (the 401 interceptor, an idle timeout, another role's shell) leaking.
//
// So the clearing lives at the session boundary instead, and every store is in scope by default.
//
// WHAT IS NOT RESET, AND WHY
// A store is exempt only when it holds nothing about the person: `council` is the authority's own
// name and province, `spatial` is the public tile-layer catalogue and which basemap layers are
// shown. Both are the same for an anonymous visitor as for the Chief Executive, and refetching
// the layer catalogue on every sign-out would cost a request to show identical data. Everything
// else is cleared whether or not anyone remembered to add it here — a store added next year is
// session-scoped until someone argues otherwise, which is the safe direction for a default.
//
// THIS IS NOT A SECURITY BOUNDARY. The server revokes the `user_session` row on logout and
// `authenticate()` re-checks session liveness on every request, so state left in a browser cannot
// be used to read anything. What this prevents is the second officer being shown the first
// officer's figures as if they were their own.

import { getActivePinia } from 'pinia'

/** Stores that hold no user-specific data. See the note above before adding to this. */
const NOT_SESSION_SCOPED = new Set([
  'auth',     // cleared by the auth store itself, which is what calls this
  'council',  // the authority's name and province
  'spatial',  // the public tile-layer catalogue and basemap visibility
])

interface ResettableStore {
  $id: string
  /**
   * The store's own clearing action. Session-scoped stores are expected to expose one; Pinia's
   * `$reset` is deliberately not used as a fallback, because on a setup store it exists as a
   * function that throws, so calling it blindly would turn every sign-out into a console error.
   */
  reset?: () => void
}

/**
 * Every store this Pinia has instantiated, which is Pinia's own `_s` map.
 *
 * It is read rather than tracked by a plugin because `pinia.use()` defers plugins until the Pinia
 * is installed on an app: a plugin-based registry works in the browser and silently registers
 * nothing in a unit test, which is the one place it would be proved. `_s` is private to Pinia, so
 * a version that drops it is caught here and said out loud rather than quietly clearing nothing.
 */
function instantiatedStores(): Iterable<ResettableStore> {
  const pinia = getActivePinia() as { _s?: Map<string, ResettableStore> } | undefined
  if (!pinia) return []
  if (!pinia._s) {
    console.error(
      '[sessionScope] this version of Pinia does not expose _s, so no store was cleared on ' +
      'sign-out. The session boundary needs another way to enumerate stores.',
    )
    return []
  }
  return pinia._s.values()
}

/**
 * Module-level caches that are not stores. A composable holding shared state at module scope is a
 * singleton for the life of the tab exactly as a store is, so it needs the same clearing; it just
 * cannot be found by walking Pinia. Each one registers itself when its module loads.
 */
const extraResets = new Set<() => void>()

/** Register a non-store cache to be cleared when the session ends. */
export function onSessionEnd(reset: () => void): void {
  extraResets.add(reset)
}

/**
 * Drop everything the signed-in person put in memory. Called from the auth store's own clearing,
 * which runs on an explicit sign-out, on a 401 from any endpoint, and on an idle timeout.
 *
 * One store's `reset` throwing must not stop the rest from running — a half-cleared session is
 * worse than the error, because what is left behind is the state nobody is looking at.
 */
export function resetSessionScope(): void {
  for (const store of instantiatedStores()) {
    if (NOT_SESSION_SCOPED.has(store.$id)) continue
    if (typeof store.reset !== 'function') {
      // Not fatal, but it means this store's contents outlive the person who loaded them. Said
      // out loud in development so a new store is noticed here rather than by the next officer.
      if (import.meta.env.DEV) {
        console.warn(
          `[sessionScope] store "${store.$id}" has no reset(), so its state survives sign-out. ` +
          'Add a reset() action, or list it in NOT_SESSION_SCOPED if it holds nothing about the ' +
          'signed-in person.',
        )
      }
      continue
    }
    try {
      store.reset()
    } catch (err) {
      console.error(`[sessionScope] ${store.$id} could not be reset on sign-out`, err)
    }
  }
  for (const reset of extraResets) {
    try {
      reset()
    } catch (err) {
      console.error('[sessionScope] a cached module could not be reset on sign-out', err)
    }
  }
}
