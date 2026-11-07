/**
 * Planning Clerk console — the URL contract and the device preferences.
 *
 * Pure: no Vue, no router, no device access beyond a guarded localStorage, so
 * every rule here is testable without mounting anything. The Vue bindings are
 * useClerkConsole.ts.
 *
 * URL
 *   /planning-clerk-portal?section=fees&permit=…&q=…&kind=application
 *
 * The section belongs in the URL for the same reason it does in the inspector,
 * EHO and IT consoles (src/inspector/consoleRoute.ts, src/admin/console.ts): a
 * reload, the Back button and a link pasted to a colleague must all land on
 * the same screen. The clerk's console had none of that — the open section was
 * a plain `ref`, so every reload put the clerk back on the dashboard and there
 * was no way to send anyone a link to anything.
 *
 * WHY `permit` IS NOT SECTION-SCOPED
 * Every other key here is cleared on a move, because `q` means a different
 * search in each section and `status` filters different things. `permit` is
 * the exception, and it is the exception on purpose: the clerk's actual loop
 * at the counter is to find a file, then log the letter that arrived with it,
 * then receipt the fee, then sign the file out — four sections, one file.
 * Clearing it on each move would make the clerk re-find the same file four
 * times while somebody stands at the desk waiting.
 *
 * PREFERENCES
 * Four, and each changes real behaviour:
 *   landingSection        the section a bare link opens on
 *   railCollapsed         whether the desktop rail starts collapsed
 *   deadlineHorizonDays   how far ahead the deadline board looks
 *   counterCurrency       the currency the receipt form opens on
 * Device preferences, not council record: a colleague borrowing the machine
 * gets the safe defaults rather than someone else's. Nothing the server
 * enforces is offered here — the five-day and seven-day rules are statute and
 * are computed in the database, not configured on a desk.
 */

export const SECTION_KEYS = [
  // Front counter
  'dashboard', 'search', 'receipt', 'verification', 'public_inspection', 'matrix',
  // Statutory clocks
  'deadlines', 'acknowledgements', 'notices', 'refusals',
  // Registers
  'register', 'correspondence', 'fees', 'movements',
  // Decisions and enforcement
  'dispatch', 'enforcement', 'appeals',
  // This device
  'preferences',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export type SectionGroup = 'counter' | 'clocks' | 'registers' | 'outcomes' | 'device'

export const GROUP_LABELS: Record<SectionGroup, string> = {
  counter: 'Front counter',
  clocks: 'Statutory clocks',
  registers: 'Registers',
  outcomes: 'Decisions & enforcement',
  device: 'This device',
}

/** Which group each section belongs to. Drives the rail's headings. */
export const SECTION_GROUP: Record<SectionKey, SectionGroup> = {
  dashboard: 'counter', search: 'counter', receipt: 'counter',
  verification: 'counter', public_inspection: 'counter', matrix: 'counter',

  deadlines: 'clocks', acknowledgements: 'clocks', notices: 'clocks', refusals: 'clocks',

  register: 'registers', correspondence: 'registers', fees: 'registers', movements: 'registers',

  dispatch: 'outcomes', enforcement: 'outcomes', appeals: 'outcomes',

  preferences: 'device',
}

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

/** The open file, if there is one. */
export function readPermit(query: Record<string, unknown> | undefined): string | null {
  return one(query?.permit)
}

/**
 * Query keys that belong to whichever section is open, and must not survive a
 * move to another one. `permit` is deliberately NOT here — see the header.
 */
export const SECTION_SCOPED_KEYS = [
  'q', 'kind', 'status', 'method', 'direction', 'from', 'to', 'view',
] as const

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
 * so clearing a search box produces `?section=fees` and not `?section=fees&q=`.
 * The difference matters because the second is what a clerk copies out of the
 * bar and sends to the planner.
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
 * else open. Preferences is excluded — nobody wants to start on it — and so
 * are the two that need a file already chosen.
 */
export const LANDING_CHOICES: SectionKey[] = [
  'dashboard', 'search', 'receipt', 'deadlines', 'register', 'correspondence', 'fees',
]

export type Currency = 'USD' | 'ZWG'

export interface ClerkPreferences {
  landingSection: SectionKey
  railCollapsed: boolean
  /** How far ahead the deadline board looks, in days. */
  deadlineHorizonDays: number
  /** The currency the counter receipt form opens on. */
  counterCurrency: Currency
}

export const DEFAULT_PREFERENCES: ClerkPreferences = {
  landingSection: FALLBACK_SECTION,
  railCollapsed: false,
  deadlineHorizonDays: 30,
  counterCurrency: 'USD',
}

/** The horizons offered. Anything else is a filter the clerk sets explicitly. */
export const HORIZON_CHOICES = [7, 14, 30, 60, 90] as const

const STORAGE_KEY = 'vungu_clerk_console_prefs'

/**
 * Read the stored preferences, falling back field by field.
 *
 * Field by field, not all or nothing: a stored object from an older version
 * that is missing `counterCurrency` should keep the clerk's landing choice
 * rather than resetting everything. Every access is guarded — private mode,
 * cleared site data and a disabled storage quota all throw rather than
 * returning null, and none of them is a reason for the console not to open.
 */
export function readPreferences(storage?: Storage): ClerkPreferences {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    const raw = store?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<ClerkPreferences>
    return {
      landingSection: isSectionKey(parsed.landingSection)
        && LANDING_CHOICES.includes(parsed.landingSection)
        ? parsed.landingSection
        : DEFAULT_PREFERENCES.landingSection,
      railCollapsed: typeof parsed.railCollapsed === 'boolean'
        ? parsed.railCollapsed
        : DEFAULT_PREFERENCES.railCollapsed,
      deadlineHorizonDays: (HORIZON_CHOICES as readonly number[])
        .includes(Number(parsed.deadlineHorizonDays))
        ? Number(parsed.deadlineHorizonDays)
        : DEFAULT_PREFERENCES.deadlineHorizonDays,
      counterCurrency: parsed.counterCurrency === 'ZWG' || parsed.counterCurrency === 'USD'
        ? parsed.counterCurrency
        : DEFAULT_PREFERENCES.counterCurrency,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/** Persist. A failure is silent by design: a preference is not worth an error. */
export function writePreferences(next: ClerkPreferences, storage?: Storage): void {
  try {
    const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    store?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode, quota, disabled storage — none is worth failing over */
  }
}

// ── Statutory arithmetic ────────────────────────────────────────────────
// The server computes every deadline it stores. These exist for the one
// moment the client must propose one: the receipt desk offering a due date
// before the row is written. They are exported and tested because a clerk
// reads the proposed date off the screen and writes it on a letter.

/**
 * `n` working days after an instant, Saturdays and Sundays excluded.
 *
 * Public holidays are NOT excluded, and that is a stated limitation rather
 * than an oversight: Zimbabwe's public holidays move (Heroes' Day and the
 * Defence Forces Day weekend shift, and a holiday falling on a Sunday is
 * observed on the Monday), and a hardcoded list that silently goes stale
 * would produce a deadline that is wrong in the council's favour. The clerk
 * can move the date; the field is editable for exactly this reason.
 */
export function plusWorkingDays(iso: string, n: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  let added = 0
  while (added < n) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()          // 0 Sunday, 6 Saturday
    if (day !== 0 && day !== 6) added++
  }
  return d.toISOString()
}

/** `n` calendar days after an instant. The seven-day refusal rule counts these. */
export function plusCalendarDays(iso: string, n: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

/**
 * `n` calendar months after an instant, clamped to the end of the month.
 *
 * Date.setMonth rolls 30 November + 3 months into 2 March, because February
 * is short. For a three-month determination clock that is a deadline two days
 * later than the statute allows, which is the wrong direction to be wrong in.
 */
export function plusMonths(iso: string, n: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const lastOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastOfTarget))
  return d.toISOString()
}

// ── Formatting shared by the sections ───────────────────────────────────
// Here rather than in a component because a dozen sections format the same
// quantities, and a dozen copies of a money formatter is how two of them end
// up disagreeing about whether to show cents.

/**
 * Money, with its currency named.
 *
 * Never a bare number: this council's books run in two currencies at once,
 * and "1 200" on a receipt screen that does not say which one is a figure
 * nobody can reconcile.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: Currency | string = 'USD',
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${currency} ${n.toLocaleString('en-ZW', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`
}

/** A short absolute timestamp for dense table cells and `title` attributes. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** A date with no time. Register entries that are calendar dates use this. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** The value a `<input type="date">` wants, from an ISO instant. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // Local parts, not toISOString(): a receipt taken at 01:00 in Harare is
  // still today's receipt, and UTC would date it yesterday.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The value a `<input type="datetime-local">` wants, from an ISO instant. */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${toDateInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A wire value as a label: `registered_post` → `Registered post`.
 *
 * Statuses, methods and kinds arrive from the database in the shape the column
 * stores them, and a dozen sections render one straight into a chip. Without
 * this the same value reads `ecocash` on one screen and `EcoCash` on the next.
 */
export function asLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * How a deadline should read, and how hard it should shout.
 *
 * One function, because the deadline board, the dashboard tiles, the
 * acknowledgement queue and the refusal queue all render the same judgement,
 * and four copies of it is how "due today" ends up amber on one screen and
 * red on the next.
 */
export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'ok' | 'done'

export function deadlineTone(
  dueIso: string | null | undefined,
  satisfiedIso: string | null | undefined = null,
  now: Date = new Date(),
): { tone: DeadlineTone; days: number; label: string } {
  if (satisfiedIso) return { tone: 'done', days: 0, label: 'Done' }
  if (!dueIso) return { tone: 'ok', days: 0, label: 'No date' }
  const due = new Date(dueIso)
  if (Number.isNaN(due.getTime())) return { tone: 'ok', days: 0, label: 'No date' }

  // Whole days between calendar dates, not between instants: a letter due at
  // 09:00 tomorrow is "due tomorrow", not "due in 0 days".
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(due) - startOf(now)) / 86_400_000)

  if (days < 0) {
    return {
      tone: 'overdue',
      days,
      label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`,
    }
  }
  if (days === 0) return { tone: 'today', days, label: 'Due today' }
  if (days <= 3) return { tone: 'soon', days, label: `Due in ${days} day${days === 1 ? '' : 's'}` }
  return { tone: 'ok', days, label: `Due in ${days} days` }
}
