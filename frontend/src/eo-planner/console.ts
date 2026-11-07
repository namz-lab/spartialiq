import { daysUntil, determinationDeadline } from '@/statutory/periods'

/**
 * Executive Officer (Planning) console — the URL contract and device settings.
 *
 * Pure: no Vue, no router, no device access beyond a guarded localStorage, so
 * every rule here is testable on its own. The Vue bindings are useEoNav.ts and
 * useEoPreferences.ts.
 *
 * URL
 *   /eo-planner-portal?section=decision&case=<permit uuid>&tab=conditions
 *
 * Two things belong in the URL and one does not.
 *   section  where the officer is. A reload, Back, and a link pasted to a
 *            colleague must land on the same screen.
 *   case     WHICH APPLICATION IS OPEN. This is the difference between this
 *            console and a pile of separate screens: an EO opens a case once
 *            and every section — intake, diligence, notice, circulation,
 *            committee, determination, permit — acts on that case. Before
 *            this, each section carried its own picker and the officer chose
 *            the same file five times.
 *   pane     not here. The map/console pane is RoleWorkspaceShell's own state
 *            for this role, as it is for the EHO.
 *
 * `tab` and `q` are section-scoped: they belong to whichever section set them
 * and are dropped on the way to another section, or they would linger and
 * contradict the next screen. `case` is NOT scoped — carrying the open case
 * across sections is the whole point.
 *
 * This is deliberately a separate module from the EHO's console.ts and the
 * inspector's consoleRoute.ts. The three consoles agree on the idea and differ
 * in the contract — the inspector's case lives in the path, the EHO has no
 * case at all — and a shared abstraction would be three special cases wearing
 * one name.
 */

// ── Sections ─────────────────────────────────────────────────────────────

export const SECTION_KEYS = [
  // Casework — the statutory path of one application, in order.
  'dashboard', 'register', 'intake', 'diligence', 'notification',
  'circulation', 'committee', 'decision',
  // Records — registers the EO keeps, which outlive any single application.
  'permits', 'enforcement', 'appeals', 'plans',
  // Office
  'reports', 'matrix', 'reference', 'settings',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export type SectionGroup = 'casework' | 'records' | 'office'

export const SECTION_GROUP: Readonly<Record<SectionKey, SectionGroup>> = Object.freeze({
  dashboard: 'casework', register: 'casework', intake: 'casework', diligence: 'casework',
  notification: 'casework', circulation: 'casework', committee: 'casework', decision: 'casework',
  permits: 'records', enforcement: 'records', appeals: 'records', plans: 'records',
  reports: 'office', matrix: 'office', reference: 'office', settings: 'office',
})

/**
 * Sections that work on the open case. The case bar offers "open in…" for
 * these, and only these warn when nothing is open — Reports and the registers
 * are whole-council views and are not waiting for a case to be chosen.
 */
export const CASE_SECTIONS: readonly SectionKey[] = [
  'intake', 'diligence', 'notification', 'circulation', 'committee', 'decision', 'permits',
]

export const FALLBACK_SECTION: SectionKey = 'dashboard'

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value)
}

export function isCaseSection(section: SectionKey): boolean {
  return CASE_SECTIONS.includes(section)
}

/** Vue Router gives `string | string[] | null`; only a single string is meaningful. */
function one(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  return null
}

/**
 * The section a query means. An unknown ?section= is treated as absent rather
 * than as an error: a bookmark to a renamed section still opens the console.
 */
export function readSection(
  query: Record<string, unknown> | undefined,
  landing: SectionKey = FALLBACK_SECTION,
): SectionKey {
  const raw = one(query?.section)
  if (isSectionKey(raw)) return raw
  return isSectionKey(landing) ? landing : FALLBACK_SECTION
}

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

/**
 * The open case. Validated as a UUID rather than trusted: a hand-edited or
 * truncated link would otherwise send the console fetching a case that cannot
 * exist and show an error where "no case open" is the honest answer.
 */
export function readCaseId(query: Record<string, unknown> | undefined): string | null {
  const raw = one(query?.case)
  return raw && UUID_RE.test(raw) ? raw : null
}

/** Query keys a section owns. Cleared whenever the section changes. */
export const SECTION_SCOPED_KEYS = ['tab', 'q'] as const
export type SectionScopedKey = (typeof SECTION_SCOPED_KEYS)[number]

/**
 * The query for a section, applied over an existing one.
 *
 * ?section= is omitted when the URL would land there anyway, so the common
 * case stays a clean link — and it is omitted against the SAME landing
 * preference readSection is given, or a bare URL and the screen would
 * disagree. Section-scoped keys are dropped; everything else, the open case
 * included, is kept.
 */
export function sectionQuery(
  existing: Record<string, unknown>,
  section: SectionKey,
  landing: SectionKey = FALLBACK_SECTION,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(existing ?? {})) {
    if (k === 'section') continue
    if ((SECTION_SCOPED_KEYS as readonly string[]).includes(k)) continue
    kept[k] = v
  }
  return section === landing ? kept : { ...kept, section }
}

// ── Where a case goes next ───────────────────────────────────────────────

/**
 * The section that does the next piece of work on a case at this status.
 *
 * One mapping, used by the register, the dashboard and the case bar, so those
 * three never offer an officer three different "next steps" for the same file.
 * It is advice, not a gate: the officer can open any section they like.
 */
const NEXT_STEP: Readonly<Record<string, { section: SectionKey; label: string }>> = Object.freeze({
  pending_payment:          { section: 'intake',       label: 'Work the intake check' },
  registered:               { section: 'intake',       label: 'Work the intake check' },
  acknowledged:             { section: 'diligence',    label: 'Start due diligence' },
  circulation:              { section: 'circulation',  label: 'Chase the referrals' },
  objection_period:         { section: 'notification', label: 'Manage the notice period' },
  under_review:             { section: 'committee',    label: 'Prepare the committee report' },
  awaiting_eo_decision:     { section: 'decision',     label: 'Determine this application' },
  deferred:                 { section: 'committee',    label: 'Return it to committee' },
  approved:                 { section: 'permits',      label: 'Draft the permit' },
  approved_with_conditions: { section: 'permits',      label: 'Draft the permit' },
  refused:                  { section: 'appeals',      label: 'Check for an appeal' },
  appealed:                 { section: 'appeals',      label: 'Work the appeal' },
})

export function nextStepFor(status: string | null | undefined):
  { section: SectionKey; label: string } | null {
  return (status && NEXT_STEP[status]) || null
}

// ── Preferences ──────────────────────────────────────────────────────────

/**
 * Sections offered as a landing choice: the ones that make sense with no case
 * open. Settings is excluded — nobody wants to start the day on it — and so
 * are the seven case sections, which would land on "no case open".
 */
export const LANDING_SECTIONS = [
  'dashboard', 'register', 'appeals', 'enforcement', 'reports',
] as const satisfies readonly SectionKey[]
export type LandingSection = (typeof LANDING_SECTIONS)[number]

/**
 * How early the console starts calling a case urgent, in days before the
 * determination deadline. The Act fixes the period (three calendar months); it says nothing about
 * when a council should start worrying, and a district with one committee
 * sitting a month needs more notice than one that sits weekly. Offered, not
 * free-typed, so "1" cannot be entered as a test and left there.
 */
export const CLOCK_WARNING_CHOICES = [7, 14, 21, 30] as const

export interface EoPreferences {
  landingSection: LandingSection
  railCollapsed: boolean
  clockWarningDays: number
}

export const DEFAULT_EO_PREFERENCES: Readonly<EoPreferences> = Object.freeze({
  landingSection: 'dashboard',
  railCollapsed: false,
  clockWarningDays: 14,
})

export const EO_PREFERENCES_KEY = 'vungu.eo.preferences'

function isLanding(value: unknown): value is LandingSection {
  return typeof value === 'string' && (LANDING_SECTIONS as readonly string[]).includes(value)
}

/**
 * Parse a stored blob field by field. A value written by an older build, or
 * hand-edited, costs only that field — never the whole set, never an error.
 */
export function parsePreferences(raw: string | null): EoPreferences {
  const d = DEFAULT_EO_PREFERENCES
  if (!raw) return { ...d }
  let o: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...d }
    o = parsed as Record<string, unknown>
  } catch {
    return { ...d }
  }
  const warn = Number(o.clockWarningDays)
  return {
    landingSection: isLanding(o.landingSection) ? o.landingSection : d.landingSection,
    railCollapsed: typeof o.railCollapsed === 'boolean' ? o.railCollapsed : d.railCollapsed,
    clockWarningDays: (CLOCK_WARNING_CHOICES as readonly number[]).includes(warn)
      ? warn : d.clockWarningDays,
  }
}

export function readPreferences(): EoPreferences {
  try {
    return parsePreferences(localStorage.getItem(EO_PREFERENCES_KEY))
  } catch {
    return { ...DEFAULT_EO_PREFERENCES }   // storage blocked: defaults, no error
  }
}

export function writePreferences(next: EoPreferences): void {
  try {
    localStorage.setItem(EO_PREFERENCES_KEY, JSON.stringify(next))
  } catch {
    // A blocked store costs persistence, not the session.
  }
}

// ── Statutory clock ──────────────────────────────────────────────────────

/** Section 26(7), and s.40(6) for a subdivision: see '@/statutory/periods'. The period is counted in calendar months from acknowledgement. */

export type ClockTone = 'ok' | 'caution' | 'urgent' | 'expired'

export interface CaseClock {
  /** Days left before the application is deemed refused. Negative once past. */
  daysLeft: number | null
  tone: ClockTone
  label: string
}

/**
 * The clock for one case, counted from ACKNOWLEDGEMENT: the Act starts it there (s.26(7)), not at receipt. A case nobody has
 * acknowledged has no deemed-refusal date yet and says so; the date acknowledgement is due is a separate matter
 * (s.26(2)(a), '@/statutory/periods' acknowledgementDue).
 */
export function caseClock(
  startedAt: string | null | undefined,
  warningDays = DEFAULT_EO_PREFERENCES.clockWarningDays,
  now = Date.now(),
  devType?: string | null,
): CaseClock {
  const deadline = determinationDeadline(startedAt, devType)
  if (!deadline) return { daysLeft: null, tone: 'ok', label: 'Not acknowledged: no clock yet' }
  const daysLeft = daysUntil(deadline, now)

  if (daysLeft < 0) {
    return { daysLeft, tone: 'expired', label: `Deemed refused ${Math.abs(daysLeft)} d ago` }
  }
  if (daysLeft === 0) return { daysLeft, tone: 'expired', label: 'Deemed refused today' }
  const tone: ClockTone = daysLeft <= Math.ceil(warningDays / 2)
    ? 'urgent'
    : daysLeft <= warningDays ? 'caution' : 'ok'
  return { daysLeft, tone, label: `${daysLeft} d to determine` }
}
