/**
 * Vue bindings for the Planning Clerk console's URL contract and preferences.
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
  readSection, readPermit, sectionQuery, paramQuery,
  readPreferences, writePreferences,
  type ClerkPreferences, type SectionKey,
} from './console'

/** The one route this console lives at. */
export const CONSOLE_PATH = '/planning-clerk-portal'

// ── Preferences ─────────────────────────────────────────────────────────
// Module-level, so the rail, the deadline board and the preferences screen
// all read one object. A per-call ref would let the rail keep rendering the
// old collapse state after Preferences changed it.
const prefs = ref<ClerkPreferences>(readPreferences())

/**
 * Persist whenever anything changes, rather than asking each caller to save.
 *
 * `deep` because the sections mutate fields on the object rather than
 * replacing it, and a shallow watcher would miss every one of those.
 */
watch(prefs, (next) => writePreferences(next), { deep: true })

export function useClerkPreferences() {
  function set<K extends keyof ClerkPreferences>(key: K, value: ClerkPreferences[K]) {
    prefs.value = { ...prefs.value, [key]: value }
  }
  return { prefs, set }
}

// ── Navigation ──────────────────────────────────────────────────────────

export function useClerkNav() {
  const route = useRoute()
  const router = useRouter()

  // Read against the SAME landing preference that go() writes against, or a
  // bare link and the rail would disagree about which section is open.
  const section = computed<SectionKey>(() =>
    readSection(route.query as Record<string, unknown>, prefs.value.landingSection))

  /** The file the clerk currently has open, which follows them across sections. */
  const permit = computed<string | null>(() =>
    readPermit(route.query as Record<string, unknown>))

  /**
   * Move to another section. Pushes, so Back walks the clerk's path.
   *
   * Section-scoped filters are dropped by sectionQuery; the open file is not,
   * because the counter loop is one file across several sections. An `extra`
   * object lets a caller arrive somewhere pre-filtered, which is how the
   * dashboard's "3 acknowledgements overdue" tile opens the queue already
   * showing only the outstanding ones.
   */
  function go(next: SectionKey, extra: Record<string, string> = {}) {
    const query = {
      ...sectionQuery(route.query as Record<string, unknown>, next, prefs.value.landingSection),
      ...extra,
    } as LocationQueryRaw
    router.push({ path: CONSOLE_PATH, query })
  }

  /**
   * Set or clear one filter inside the current section.
   *
   * REPLACES rather than pushes: typing six characters into a search box
   * should not put six entries in the history and make Back useless.
   */
  function setParam(key: string, value: string | null) {
    const query = paramQuery(route.query as Record<string, unknown>, key, value) as LocationQueryRaw
    router.replace({ path: CONSOLE_PATH, query })
  }

  /**
   * Open a file, or close the one that is open.
   *
   * REPLACES, like a filter and unlike a section change: the clerk picks
   * through several files at the counter looking for the right one, and each
   * wrong guess should not be a Back press to undo.
   */
  function openFile(permitId: string | null) {
    setParam('permit', permitId)
  }

  /** One filter's current value, or '' — the shape a bound `<input>` wants. */
  function param(key: string): string {
    const raw = route.query[key]
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
    return ''
  }

  return { section, permit, go, setParam, param, openFile, route }
}
