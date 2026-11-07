/**
 * Vue bindings for the IT Admin console's URL contract and preferences.
 *
 * The rules live in console.ts, which is pure and tested. This file is only
 * the wiring: it reads the live route, writes the router, and keeps one
 * reactive copy of the preferences so two sections cannot disagree about them.
 *
 * Both are deliberately thin. Anything here that starts making a decision
 * belongs in console.ts, where it can be tested without a router.
 */

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import {
  readSection, sectionQuery, paramQuery,
  readPreferences, writePreferences,
  type AdminPreferences, type SectionKey,
} from './console'

// ── Preferences ─────────────────────────────────────────────────────────
// Module-level, so the rail, the audit section and the preferences screen all
// read one object. A per-call ref would let the rail keep rendering the old
// collapse state after Preferences changed it.
const prefs = ref<AdminPreferences>(readPreferences())

/**
 * Persist whenever anything changes, rather than asking each caller to save.
 *
 * `deep` because the sections mutate fields on the object rather than
 * replacing it, and a shallow watcher would miss every one of those.
 */
watch(prefs, (next) => writePreferences(next), { deep: true })

export function useAdminPreferences() {
  function set<K extends keyof AdminPreferences>(key: K, value: AdminPreferences[K]) {
    prefs.value = { ...prefs.value, [key]: value }
  }
  return { prefs, set }
}

// ── Navigation ──────────────────────────────────────────────────────────

export function useAdminNav() {
  const route = useRoute()
  const router = useRouter()

  // Read against the SAME landing preference that go() writes against, or a
  // bare /admin and the rail would disagree about which section is open.
  const section = computed<SectionKey>(() =>
    readSection(route.query as Record<string, unknown>, prefs.value.landingSection))

  /**
   * Move to another section. Pushes, so Back walks the admin's path.
   *
   * Section-scoped filters are dropped by sectionQuery — see its header. An
   * `extra` object lets a caller arrive somewhere pre-filtered, which is how
   * the overview's "3 failed sign-ins" tile opens the sign-in log already
   * showing only failures.
   */
  function go(next: SectionKey, extra: Record<string, string> = {}) {
    // console.ts is deliberately router-agnostic and returns a plain record;
    // the cast is the one place the two type systems meet. Its values are only
    // ever strings — every writer goes through paramQuery or sectionQuery.
    const query = {
      ...sectionQuery(route.query as Record<string, unknown>, next, prefs.value.landingSection),
      ...extra,
    } as LocationQueryRaw
    router.push({ path: '/admin', query })
  }

  /**
   * Set or clear one filter inside the current section.
   *
   * REPLACES rather than pushes: typing six characters into a search box
   * should not put six entries in the history and make Back useless.
   */
  function setParam(key: string, value: string | null) {
    const query = paramQuery(route.query as Record<string, unknown>, key, value) as LocationQueryRaw
    router.replace({ path: '/admin', query })
  }

  /** One filter's current value, or '' — the shape a bound <input> wants. */
  function param(key: string): string {
    const raw = route.query[key]
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
    return ''
  }

  return { section, go, setParam, param, route }
}
