/**
 * Moving around the EO planner console.
 *
 * Every move goes through the URL (see ./console.ts), so Back walks the
 * officer's path and a copied link opens the same screen with the same case.
 *
 * Push or replace, and why:
 *   go(section)        pushes — Back should step between sections
 *   openCase(id)       replaces — opening a case is choosing what you are
 *                      looking at, not a place; pushing would make Back walk
 *                      backwards through every case skimmed in the register
 *   setParam(tab|q)    replaces — Back leaves the section, rather than
 *                      stepping through every tab click inside it
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  readSection, readCaseId, sectionQuery,
  SECTION_SCOPED_KEYS, type SectionKey, type SectionScopedKey,
} from './console'
import { useEoPreferences } from './useEoPreferences'

export function useEoNav() {
  const route = useRoute()
  const router = useRouter()
  const { prefs } = useEoPreferences()

  const section = computed<SectionKey>(() => readSection(route.query, prefs.value.landingSection))
  const caseId = computed<string | null>(() => readCaseId(route.query))

  function param(key: SectionScopedKey): string | null {
    const v = route.query[key]
    const s = Array.isArray(v) ? v[0] : v
    return typeof s === 'string' && s.length ? s : null
  }

  /** Go to a section, optionally opening a case on the way. Pushes. */
  function go(to: SectionKey, opts: { case?: string | null } = {}) {
    const base: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(route.query)) {
      if (!(SECTION_SCOPED_KEYS as readonly string[]).includes(k)) base[k] = v
    }
    if (opts.case !== undefined) {
      if (opts.case) base.case = opts.case
      else delete base.case
    }
    void router.push({ query: sectionQuery(base, to, prefs.value.landingSection) as Record<string, string> })
      .catch(() => undefined)
  }

  /** Open (or clear) the case every case section works on. Replaces. */
  function openCase(id: string | null) {
    const next: Record<string, unknown> = { ...route.query }
    if (id) next.case = id
    else delete next.case
    void router.replace({ query: next as Record<string, string> }).catch(() => undefined)
  }

  /** Change section-scoped state without leaving the section. Replaces. */
  function setParam(key: SectionScopedKey, value: string | null) {
    const next: Record<string, unknown> = { ...route.query }
    if (value) next[key] = value
    else delete next[key]
    void router.replace({ query: next as Record<string, string> }).catch(() => undefined)
  }

  return { section, caseId, param, go, openCase, setParam }
}
