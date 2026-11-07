/**
 * Environmental Health Officer console — the URL contract and device preferences.
 *
 * Pure: no Vue, no router, no device access beyond localStorage (guarded), so
 * the rules are testable. The Vue bindings are useEhoNav.ts and useEhoPreferences.ts.
 *
 * URL
 *   /env-officer-workspace?section=licensing
 *
 * The section belongs in the URL for the same reason it does in the inspector
 * console (src/inspector/consoleRoute.ts): a reload, the Back button and a link
 * pasted to a colleague must all land on the same screen. The map/console pane
 * is not part of this contract — RoleWorkspaceShell keeps it uncontrolled for
 * this role, as CLAUDE.md records.
 *
 * PREFERENCES
 * Three, and each one changes behaviour somewhere real:
 *   landingSection   the section a bare URL opens on
 *   railCollapsed    whether the desktop rail starts collapsed
 *   inspectionCycleDays  the interval "overdue for inspection" is measured
 *                    against — on the dashboard, the Inspections register and
 *                    the server summary. The Public Health Act sets no single
 *                    figure, so it is the council's to choose, not ours.
 * Device preferences, not council record: a colleague borrowing the tablet gets
 * the safe defaults rather than someone else's.
 */

export const SECTION_KEYS = [
  'dashboard', 'inspections', 'surveillance', 'enforcement',
  'programmes', 'licensing', 'appraisal', 'certificates',
  'reports', 'reference', 'settings',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export const FALLBACK_SECTION: SectionKey = 'dashboard'

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value)
}

/** Vue Router gives `string | string[] | null`; only a single string is meaningful. */
function one(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  return null
}

/**
 * The section a query means. An unknown ?section= is treated as absent rather
 * than as an error: a stale bookmark to a renamed section still opens the console.
 */
export function readSection(query: Record<string, unknown> | undefined, landing: SectionKey = FALLBACK_SECTION): SectionKey {
  const raw = one(query?.section)
  if (isSectionKey(raw)) return raw
  return isSectionKey(landing) ? landing : FALLBACK_SECTION
}

/**
 * The query for a section, applied over an existing one.
 *
 * ?section= is omitted when the URL would land there anyway, so the common case
 * stays a clean link — and it is omitted against the SAME landing preference
 * readSection is given, or a bare URL and the screen would disagree. Every key
 * this contract does not own (the shell's pane, a tab's own state) is kept.
 */
export function sectionQuery(
  existing: Record<string, unknown>,
  section: SectionKey,
  landing: SectionKey = FALLBACK_SECTION,
): Record<string, unknown> {
  const { section: _dropped, ...kept } = existing ?? {}
  return section === landing ? kept : { ...kept, section }
}

// ── Preferences ──────────────────────────────────────────────────────────

/**
 * Sections offered as a landing choice: the ones useful with nothing open.
 * Settings is excluded — nobody wants to start the day on it.
 */
export const LANDING_SECTIONS = [
  'dashboard', 'inspections', 'surveillance', 'enforcement', 'programmes', 'licensing',
] as const satisfies readonly SectionKey[]
export type LandingSection = (typeof LANDING_SECTIONS)[number]

/** Offered cycles. Free entry would invite "7" typed as a test and forgotten. */
export const INSPECTION_CYCLES = [30, 60, 90, 180, 365] as const

export interface EhoPreferences {
  landingSection: LandingSection
  railCollapsed: boolean
  inspectionCycleDays: number
}

export const DEFAULT_EHO_PREFERENCES: Readonly<EhoPreferences> = Object.freeze({
  landingSection: 'dashboard',
  railCollapsed: false,
  // Quarterly is the common district practice for food premises.
  inspectionCycleDays: 90,
})

export const EHO_PREFERENCES_KEY = 'vungu.eho.preferences'

function isLanding(value: unknown): value is LandingSection {
  return typeof value === 'string' && (LANDING_SECTIONS as readonly string[]).includes(value)
}

/**
 * Parse a stored blob field by field. A value written by an older build, or
 * hand-edited, costs only that field — never the whole set, never an error.
 */
export function parsePreferences(raw: string | null): EhoPreferences {
  const d = DEFAULT_EHO_PREFERENCES
  if (!raw) return { ...d }
  let o: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...d }
    o = parsed as Record<string, unknown>
  } catch {
    return { ...d }
  }
  const cycle = Number(o.inspectionCycleDays)
  return {
    landingSection: isLanding(o.landingSection) ? o.landingSection : d.landingSection,
    railCollapsed: typeof o.railCollapsed === 'boolean' ? o.railCollapsed : d.railCollapsed,
    inspectionCycleDays: (INSPECTION_CYCLES as readonly number[]).includes(cycle) ? cycle : d.inspectionCycleDays,
  }
}

export function readPreferences(): EhoPreferences {
  try {
    return parsePreferences(localStorage.getItem(EHO_PREFERENCES_KEY))
  } catch {
    return { ...DEFAULT_EHO_PREFERENCES }   // storage blocked: defaults, no error
  }
}

export function writePreferences(next: EhoPreferences): void {
  try {
    localStorage.setItem(EHO_PREFERENCES_KEY, JSON.stringify(next))
  } catch {
    // A blocked store costs persistence, not the session: the in-memory value still applies.
  }
}

// ── Shared date + risk helpers ───────────────────────────────────────────
// The date and text helpers moved to src/utils/dates.ts when the EO planner
// console needed the same seven; they are re-exported here so every EHO
// section keeps importing them from the console contract it already knows.
export {
  daysSince, daysUntil, fmtDate, fmtDateTime, isoDay, humanise, wardLabel,
} from '@/utils/dates'

import { daysSince } from '@/utils/dates'

/**
 * Whether a premises is overdue for inspection under a cycle.
 * Never inspected counts as overdue: an uninspected food premises is the
 * highest-risk entry on the register, not a neutral one.
 */
export function isOverdue(lastInspectedAt: string | null | undefined, cycleDays: number, now = Date.now()): boolean {
  const d = daysSince(lastInspectedAt, now)
  return d === null || d > cycleDays
}
