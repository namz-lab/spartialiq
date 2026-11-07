/**
 * Reactive view of the inspector's device preferences.
 *
 * One shared ref for the whole app, not one per caller: the settings page, the
 * workspace rail, the console route default and the device outbox all read the
 * same object, so flipping a switch on the settings page moves the rail in the
 * same frame instead of on the next reload.
 *
 * The rules and the storage live in src/inspector/preferences.ts, which is pure
 * and tested. This file is only the Vue binding: a ref, a subscription, and a
 * setter that delegates.
 */
import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import {
  readPreferences, writePreference, resetPreferences, onPreferencesChange,
  type InspectorPreferences,
} from '@/inspector/preferences'

// Module scope: the singleton. Created lazily so importing this file does not
// touch localStorage during module evaluation (which SSR and some test
// environments do not have).
let shared: Ref<InspectorPreferences> | null = null
let unsubscribe: (() => void) | null = null

function ensure(): Ref<InspectorPreferences> {
  if (!shared) {
    shared = ref(readPreferences())
    // Never torn down: the singleton lives as long as the app, and dropping the
    // subscription would silently stop cross-tab updates for every caller.
    unsubscribe = onPreferencesChange((next) => { shared!.value = next })
  }
  return shared
}

export function useInspectorPreferences() {
  const prefs = ensure()

  function set<K extends keyof InspectorPreferences>(key: K, value: InspectorPreferences[K]) {
    prefs.value = writePreference(key, value)
  }

  function reset() {
    prefs.value = resetPreferences()
  }

  return {
    /** Read-only so a stray `prefs.value.x = …` cannot bypass persistence. */
    prefs: readonly(prefs) as DeepReadonly<Ref<InspectorPreferences>>,
    set,
    reset,
  }
}

/** Test seam: drop the singleton so the next call re-reads storage. */
export function __resetInspectorPreferencesForTest() {
  unsubscribe?.()
  unsubscribe = null
  shared = null
}
