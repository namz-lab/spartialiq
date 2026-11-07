/**
 * Moving around the EHO console.
 *
 * Every move goes through the URL (see ./console.ts), so Back walks the
 * officer's path and a copied link opens the same screen. Section-scoped keys
 * — the open premises, a tab, a permit — belong to the section that set them
 * and are dropped on the way to another section, or they would linger and
 * contradict the next screen.
 */
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { readSection, sectionQuery, type SectionKey } from './console'
import { useEhoPreferences } from './useEhoPreferences'

/** Query keys a section may own. Cleared whenever the section changes. */
export const SECTION_SCOPED_KEYS = ['premises', 'tab', 'permit', 'q'] as const
export type SectionScopedKey = (typeof SECTION_SCOPED_KEYS)[number]

export function useEhoNav() {
  const route = useRoute()
  const router = useRouter()
  const { prefs } = useEhoPreferences()

  const section = computed<SectionKey>(() => readSection(route.query, prefs.value.landingSection))

  function param(key: SectionScopedKey): string | null {
    const v = route.query[key]
    const s = Array.isArray(v) ? v[0] : v
    return typeof s === 'string' && s.length ? s : null
  }

  /** Go to a section, optionally with section-scoped state. Pushes a history entry. */
  function go(to: SectionKey, scoped: Partial<Record<SectionScopedKey, string | null>> = {}) {
    const base: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(route.query)) {
      if (!(SECTION_SCOPED_KEYS as readonly string[]).includes(k)) base[k] = v
    }
    for (const [k, v] of Object.entries(scoped)) if (v) base[k] = v
    void router.push({ query: sectionQuery(base, to, prefs.value.landingSection) as Record<string, string> })
      .catch(() => undefined)
  }

  /**
   * Change section-scoped state without leaving the section. Replaces, so Back
   * leaves the section rather than stepping through every tab click.
   */
  function setParam(key: SectionScopedKey, value: string | null) {
    const next: Record<string, unknown> = { ...route.query }
    if (value) next[key] = value
    else delete next[key]
    void router.replace({ query: next as Record<string, string> }).catch(() => undefined)
  }

  return { section, param, go, setParam }
}
