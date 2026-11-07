/**
 * The Building Inspector workspace's URL contract.
 *
 * The workspace is one route with four pieces of state, and all four belong in
 * the URL so that a reload, the Back button, and a link pasted to a colleague
 * all land on the same screen:
 *
 *   /inspector-workspace/:inspectionId?   the open stage inspection
 *   ?section=                             which console section
 *   ?pane=map|console                     which half of the workspace
 *   ?permit=                              the open case, when no inspection id
 *
 * Pure: no Vue, no router, no device access. The caller passes what it knows
 * and applies what comes back, which is what makes the rules testable.
 */

export const SECTION_KEYS = [
  'dashboard', 'bookings', 'stages', 'preconstruction', 'casefile',
  'plans', 'enforcement', 'complaints', 'certificates',
  'referrals', 'reports', 'reference', 'settings',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]
export type Pane = 'map' | 'console'

export interface ConsoleLocation {
  section: SectionKey
  pane: Pane
  inspectionId: string | null
  permitId: string | null
}

/** Shaped to match Vue Router's LocationQuery without importing the router. */
export type QueryValue = string | null | (string | null)[]

export interface RouteInput {
  query?: Record<string, unknown>
  params?: Record<string, unknown>
  /** A phone has no room for a map pane beside the console. */
  isMobile?: boolean
  /**
   * The section a bare URL means, when the inspector has chosen one in
   * Settings. An enforcement-heavy district opens on Enforcement; everyone else
   * opens on Today. It only ever fills a gap — a ?section= in the URL still
   * wins, because the link is the more specific instruction.
   */
  defaultSection?: SectionKey
}

/** What a URL means when it names no section and no inspection. */
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
 * Which pane a URL implies when it does not say.
 *
 * A link that names a section, a case or an inspection is a link to the
 * console — someone sent it to be read there. Everything else opens on the map,
 * which is where an inspector starts the day, except on a phone.
 */
export function inferredPane(input: RouteInput): Pane {
  if (input.isMobile) return 'console'
  if (one(input.params?.inspectionId)) return 'console'
  if (one(input.query?.section) || one(input.query?.permit)) return 'console'
  return 'map'
}

/** Read the whole workspace location out of a route. Never throws on junk input. */
export function readLocation(input: RouteInput): ConsoleLocation {
  const inspectionId = one(input.params?.inspectionId)
  const rawSection = one(input.query?.section)
  const rawPane = one(input.query?.pane)

  // An unknown ?section= is treated as absent rather than as an error screen:
  // a stale bookmark from a renamed section should still open the workspace.
  //
  // An inspection in the path beats the landing preference: a link to a
  // specific inspection is a link to the inspection screen, whatever the
  // recipient's settings say.
  const section: SectionKey = isSectionKey(rawSection)
    ? rawSection
    : inspectionId ? 'stages'
    : isSectionKey(input.defaultSection) ? input.defaultSection
    : FALLBACK_SECTION

  const pane: Pane = rawPane === 'map' || rawPane === 'console'
    ? rawPane
    : inferredPane(input)

  return {
    section,
    pane,
    inspectionId,
    // The path already identifies the case when an inspection is open, so the
    // redundant ?permit= is ignored rather than allowed to contradict it.
    permitId: inspectionId ? null : one(input.query?.permit),
  }
}

/** What the caller knows about the device and the open case. */
export interface LocationContext {
  isMobile?: boolean
  inspectionId?: string | null
  /** The inspector's landing-section preference; see RouteInput. */
  defaultSection?: SectionKey
}

/**
 * The section a URL lands on when it names none — the write-side counterpart of
 * the rule in readLocation, kept next to it so the two cannot drift.
 */
function impliedSection(context: LocationContext): SectionKey {
  if (context.inspectionId) return 'stages'
  return isSectionKey(context.defaultSection) ? context.defaultSection : FALLBACK_SECTION
}

/**
 * The query for a location, keeping the URL as short as it can be without
 * losing meaning: anything the URL would imply anyway is left out.
 */
export function locationQuery(
  next: Pick<ConsoleLocation, 'section' | 'pane' | 'permitId'>,
  context: LocationContext = {},
): Record<string, string> {
  const query: Record<string, string> = {}
  // Omit the section only when the URL would land on it anyway. Hardcoding
  // 'dashboard' here would have broken the landing preference: with Enforcement
  // chosen, a bare URL means Enforcement, so ?section= must be written out for
  // the dashboard and dropped for Enforcement — the exact opposite.
  if (next.section !== impliedSection(context)) query.section = next.section
  if (!context.inspectionId && next.permitId) query.permit = next.permitId

  // Only record the pane when it differs from what this URL already implies on
  // this device, so the common case stays a clean ?section=… link.
  const implied = inferredPane({
    isMobile: context.isMobile,
    params: { inspectionId: context.inspectionId ?? null },
    query,
  })
  if (next.pane !== implied) query.pane = next.pane

  return query
}

/**
 * A primitive identity for the case a location points at.
 *
 * Watch THIS, never the location object or a tuple built from it: those are
 * rebuilt whenever anything else in the location changes — including the pane,
 * which is re-derived every time the viewport crosses a breakpoint — and a
 * watcher on a fresh array fires every time, re-fetching the same inspection on
 * every resize.
 */
export function caseKey(location: Pick<ConsoleLocation, 'inspectionId' | 'permitId'>): string {
  return `${location.inspectionId ?? ''}|${location.permitId ?? ''}`
}

/** The query keys this contract owns. Everything else on the URL is left alone. */
const OWNED_KEYS = ['section', 'pane', 'permit'] as const

/**
 * Apply a location to an existing query.
 *
 * The owned keys are rebuilt from scratch rather than merged over, because a
 * key this contract omits — ?section= on the dashboard, ?permit= once an
 * inspection id is in the path — must actually disappear from the URL instead
 * of lingering and contradicting the screen. Anything the workspace does not
 * own is preserved untouched.
 */
export function mergeQuery(
  existing: Record<string, QueryValue>,
  next: Pick<ConsoleLocation, 'section' | 'pane' | 'permitId'>,
  context: LocationContext = {},
): Record<string, QueryValue> {
  const kept: Record<string, QueryValue> = {}
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!(OWNED_KEYS as readonly string[]).includes(key)) kept[key] = value
  }
  return { ...kept, ...locationQuery(next, context) }
}

/**
 * Whether a move should add a history entry.
 *
 * Changing section or pane is a move the inspector made and may want to undo,
 * so it is pushed and the Back button walks back through it. Opening a case is
 * context, not a destination: it is replaced, so Back never strands the console
 * on a case the URL no longer names.
 */
export function navigationMode(from: ConsoleLocation, to: ConsoleLocation): 'push' | 'replace' | 'none' {
  if (from.section !== to.section || from.pane !== to.pane) return 'push'
  if (from.inspectionId !== to.inspectionId || from.permitId !== to.permitId) return 'replace'
  return 'none'
}
