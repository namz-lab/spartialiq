/**
 * Reactive EHO console preferences — one shared ref for the whole app, so the
 * Settings section, the rail, the section router and the dashboard all move in
 * the same frame. Rules and storage live in ./console.ts (pure, tested).
 */
import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import { readPreferences, writePreferences, DEFAULT_EHO_PREFERENCES, type EhoPreferences } from './console'

let shared: Ref<EhoPreferences> | null = null

export function useEhoPreferences() {
  if (!shared) shared = ref(readPreferences())
  const prefs = shared

  function set<K extends keyof EhoPreferences>(key: K, value: EhoPreferences[K]) {
    prefs.value = { ...prefs.value, [key]: value }
    writePreferences(prefs.value)
  }

  function reset() {
    prefs.value = { ...DEFAULT_EHO_PREFERENCES }
    writePreferences(prefs.value)
  }

  return {
    prefs: readonly(prefs) as DeepReadonly<Ref<EhoPreferences>>,
    set,
    reset,
  }
}
