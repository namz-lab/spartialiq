/**
 * IT Admin console — the URL contract and the device preferences.
 *
 * Pure: no Vue, no router, no device access beyond a guarded localStorage, so
 * every rule here is testable without mounting anything. The Vue bindings are
 * useAdminNav.ts and useAdminPreferences.ts.
 *
 * URL
 *   /admin?section=audit&q=…&severity=high
 *
 * The section belongs in the URL for the same reason it does in the inspector
 * and EHO consoles (src/inspector/consoleRoute.ts): a reload, the Back button
 * and a link pasted to a colleague must all land on the same screen. An IT
 * admin has one more reason than either of them — "send me the link to that
 * audit entry" is how a support conversation ends, and a console that cannot
 * produce such a link makes the admin describe the filters in prose instead.
 *
 * WHY SECTION-SCOPED KEYS ARE CLEARED ON A MOVE
 * `q`, `severity`, `event`, `status` and `user` all mean something different
 * per section: `status` filters invitations in one and outbox messages in the
 * next. Carrying them across a section change would silently apply the audit
 * screen's severity filter to the session list. go() drops them; setParam()
 * keeps them, because that is a move WITHIN a section.
 *
 * PREFERENCES
 * Three, and each changes real behaviour:
 *   landingSection   the section a bare /admin opens on
 *   railCollapsed    whether the desktop rail starts collapsed
 *   auditWindowDays  the period the audit trail and the sign-in log open on
 * Device preferences, not council record: a colleague borrowing the machine
 * gets the safe defaults rather than someone else's. Nothing the server
 * enforces is offered here — the lockout threshold and the retention period
 * are council policy and live in System settings, where they are audited.
 */

export const SECTION_KEYS = [
  // People and access
  'overview', 'employees', 'invitations', 'roles', 'org',
  // Security and audit
  'audit', 'sessions', 'signin',
  // System and operations
  'health', 'jobs', 'backups', 'usage', 'announcements',
  // Configuration
  'settings', 'integrations',
  // This device
  'preferences',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export type SectionGroup = 'people' | 'security' | 'system' | 'config' | 'device'

export const GROUP_LABELS: Record<SectionGroup, string> = {
  people: 'People & access',
  security: 'Security & audit',
  system: 'System & operations',
  config: 'Configuration',
  device: 'This device',
}

/** Which group each section belongs to. Drives the rail's headings. */
export const SECTION_GROUP: Record<SectionKey, SectionGroup> = {
  overview: 'people', employees: 'people', invitations: 'people', roles: 'people', org: 'people',
  audit: 'security', sessions: 'security', signin: 'security',
  health: 'system', jobs: 'system', backups: 'system', usage: 'system', announcements: 'system',
  settings: 'config', integrations: 'config',
  preferences: 'device',
}

export const FALLBACK_SECTION: SectionKey = 'overview'

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
 * The section a query means.
 *
 * An unknown ?section= is treated as absent rather than as an error screen: a
 * bookmark saved before a section was renamed should still open the console.
 */
export function readSection(
  query: Record<string, unknown> | undefined,
  landing: SectionKey = FALLBACK_SECTION,
): SectionKey {
  const raw = one(query?.section)
  if (isSectionKey(raw)) return raw
  return isSectionKey(landing) ? landing : FALLBACK_SECTION
}

/**
 * Query keys that belong to whichever section is open, and must not survive a
 * move to another one. See the header.
 */
export const SECTION_SCOPED_KEYS = ['q', 'severity', 'event', 'status', 'user', 'entity'] as const

/**
 * The query for a section, applied over an existing one.
 *
 * ?section= is omitted when a bare URL would land there anyway, so the common
 * link stays clean — and it is omitted against the SAME landing preference
 * readSection is given, or a bare URL and the screen would disagree. Anything
 * this contract does not own is preserved.
 */
export function sectionQuery(
  existing: Record<string, unknown>,
  section: SectionKey,
  landing: SectionKey = FALLBACK_SECTION,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (key === 'section') continue
    if ((SECTION_SCOPED_KEYS as readonly string[]).includes(key)) continue
    kept[key] = value
  }
  return section === landing ? kept : { ...kept, section }
}

/**
 * Set or clear one filter within the current section.
 *
 * A null or empty value REMOVES the key rather than writing an empty string,
 * so clearing a search box produces `/admin?section=audit` and not
 * `/admin?section=audit&q=`. The difference matters because the second is what
 * an admin copies out of the bar and sends to a colleague.
 */
export function paramQuery(
  existing: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
): Record<string, unknown> {
  const next = { ...(existing ?? {}) }
  if (value === null || value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

// ── Preferences ─────────────────────────────────────────────────────────

/**
 * Sections offered as a landing choice: the ones that are useful with nothing
 * else open. Preferences is excluded — nobody wants to start on it.
 */
export const LANDING_CHOICES: SectionKey[] = [
  'overview', 'employees', 'audit', 'sessions', 'signin', 'health', 'jobs',
]

export interface AdminPreferences {
  landingSection: SectionKey
  railCollapsed: boolean
  /** Days of history the audit trail and sign-in log open on. */
  auditWindowDays: number
}

export const DEFAULT_PREFERENCES: AdminPreferences = {
  landingSection: FALLBACK_SECTION,
  railCollapsed: false,
  auditWindowDays: 7,
}

/** The windows offered. Anything longer is a filter the admin sets explicitly. */
export const AUDIT_WINDOW_CHOICES = [1, 7, 30, 90] as const

const STORAGE_KEY = 'vungu_admin_console_prefs'

/**
 * Read the stored preferences, falling back field by field.
 *
 * Field by field, not all or nothing: a stored object from an older version
 * that is missing `auditWindowDays` should keep the admin's landing choice
 * rather than resetting everything. Every access is guarded — private mode,
 * cleared site data and a disabled storage quota all throw rather than
 * returning null, and none of them is a reason for the console not to open.
 */
export function readPreferences(storage?: Storage): AdminPreferences {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    const raw = store?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<AdminPreferences>
    return {
      landingSection: isSectionKey(parsed.landingSection) && LANDING_CHOICES.includes(parsed.landingSection)
        ? parsed.landingSection
        : DEFAULT_PREFERENCES.landingSection,
      railCollapsed: typeof parsed.railCollapsed === 'boolean'
        ? parsed.railCollapsed
        : DEFAULT_PREFERENCES.railCollapsed,
      auditWindowDays: (AUDIT_WINDOW_CHOICES as readonly number[]).includes(Number(parsed.auditWindowDays))
        ? Number(parsed.auditWindowDays)
        : DEFAULT_PREFERENCES.auditWindowDays,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/** Persist. A failure is silent by design: a preference is not worth an error. */
export function writePreferences(next: AdminPreferences, storage?: Storage): void {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    store?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode, quota, disabled storage — none is worth failing over */
  }
}

// ── Formatting shared by the sections ───────────────────────────────────
// Here rather than in a component because four sections format the same
// quantities, and four copies of a byte formatter is how two of them end up
// disagreeing about whether a kilobyte is 1000 or 1024.

/** Binary units, because that is what pg_size_pretty and `ls` both report. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/**
 * "4 minutes ago", "3 days ago".
 *
 * Relative rather than absolute because every use is a freshness judgement —
 * how stale is this backup, how long since that officer was active — and
 * "2026-09-19 14:02" makes the reader do the subtraction. The absolute time
 * stays in the `title` attribute wherever this is used, so it is still
 * recoverable for a report.
 */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 0) return 'in the future'
  if (seconds < 45) return 'just now'

  // Largest unit that still gives a number of at least one, so "90 minutes
  // ago" reads as "2 hours ago" rather than as ninety of anything.
  const scale: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute'],
  ]
  const [divisor, unit] = scale.find(([d]) => seconds >= d) ?? [60, 'minute' as const]
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    .format(-Math.round(seconds / divisor), unit)
}

/**
 * A wire value as a label: `bad_password` → `Bad password`.
 *
 * Statuses and severities arrive from the database in the shape the column
 * stores them, and four sections render one straight into a badge. Without
 * this the same state reads `active` on one screen and `Active` on the next.
 */
export function asLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** An ISO instant for `n` days ago — what the audit window filters on. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86400_000).toISOString()
}

/** A short absolute timestamp for the `title` attribute and dense table cells. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/**
 * A user agent reduced to "what device is this".
 *
 * The full string is 150 characters of version noise and makes the session
 * table unreadable; the question an admin is answering is "is that the
 * officer's own laptop or something I don't recognise", which needs only the
 * browser and the platform. The full string stays in the row's title.
 */
export function describeAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    // Safari must be tested last: Chrome and Edge both carry "Safari" too.
    : /Safari\//.test(ua) ? 'Safari'
    : /curl|node|axios|python/i.test(ua) ? 'Script or tool'
    : 'Browser'
  const platform =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return platform ? `${browser} on ${platform}` : browser
}
