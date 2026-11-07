/**
 * Reactive EO console preferences — one shared ref for the whole app, so the
 * Settings section, the rail, the section router and the dashboard all move in
 * the same frame. Rules and storage live in ./console.ts (pure, tested).
 */
import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import {
  readPreferences, writePreferences, DEFAULT_EO_PREFERENCES, type EoPreferences,
} from './console'

let shared: Ref<EoPreferences> | null = null

export function useEoPreferences() {
  if (!shared) shared = ref(readPreferences())
  const prefs = shared

  function set<K extends keyof EoPreferences>(key: K, value: EoPreferences[K]) {
    prefs.value = { ...prefs.value, [key]: value }
    writePreferences(prefs.value)
  }

  function reset() {
    prefs.value = { ...DEFAULT_EO_PREFERENCES }
    writePreferences(prefs.value)
  }

  return {
    prefs: readonly(prefs) as DeepReadonly<Ref<EoPreferences>>,
    set,
    reset,
  }
}
