// The periods the Regional, Town and Country Planning Act [Chapter 29:12] fixes, in one place.
//
// The Act counts in CALENDAR MONTHS, not in days, so a "90 day" clock is wrong by up to two days either way (three months
// from 1 June is 92 days; from 1 December it is 90). Every clock, countdown and letter reads from here so that two screens
// cannot disagree about when an application is deemed refused. Pure: no Vue, no I/O.
//
//   s.26(2)(a)  acknowledge within two weeks of receipt (or, if incomplete, as soon as it is made good)
//   s.26(4)     objections within one month of public notice
//   s.26(7)     not determined within THREE MONTHS of the date of ACKNOWLEDGEMENT, or any extension the applicant grants
//               in writing: deemed REFUSED
//   s.40(6)     the same for a subdivision or consolidation, but FOUR months
//   s.38, s.44  appeal to the Administrative Court within ONE MONTH of notification of the decision
//
// The clock starts at acknowledgement, not receipt. An application nobody has acknowledged has no deemed-refusal date yet; what
// it has is a date by which it must be acknowledged.

export const ACK_DAYS = 14
export const OBJECTION_MONTHS = 1
export const APPEAL_MONTHS = 1
export const DETERMINATION_MONTHS = 3
export const SUBDIVISION_DETERMINATION_MONTHS = 4

const DAY = 86_400_000

/** Development types governed by s.40 (subdivisions and consolidations) rather than s.26. */
export const isSubdivisionKind = (devType?: string | null) => devType === 'subdivision' || devType === 'consolidation'

export const determinationMonths = (devType?: string | null) =>
  isSubdivisionKind(devType) ? SUBDIVISION_DETERMINATION_MONTHS : DETERMINATION_MONTHS

/** The Act section a determination deadline rests on, for display. */
export const determinationSection = (devType?: string | null) => (isSubdivisionKind(devType) ? 's.40(6)' : 's.26(7)')

/**
 * `n` calendar months after an instant (UTC), clamped to the end of a short month: 30 November + 3 months is 28 February,
 * never 2 March. The time of day is kept.
 */
export function addMonths(iso: string, n: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString()
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Date(d.getTime() + n * DAY).toISOString()
}

/** When the council must have determined, counted from acknowledgement; null if not yet acknowledged. */
export function determinationDeadline(acknowledgedAt: string | null | undefined, devType?: string | null): string | null {
  if (!acknowledgedAt || Number.isNaN(new Date(acknowledgedAt).getTime())) return null
  return addMonths(acknowledgedAt, determinationMonths(devType))
}

/** The latest date acknowledgement is due (s.26(2)(a)). */
export const acknowledgementDue = (receivedAt: string) => addDays(receivedAt, ACK_DAYS)

export const objectionDeadline = (noticeGivenAt: string) => addMonths(noticeGivenAt, OBJECTION_MONTHS)
export const appealDeadline = (notifiedAt: string) => addMonths(notifiedAt, APPEAL_MONTHS)

/** Whole days left until `deadline`, rounded up, so the last (part) day counts as 1 and 0 means the deadline has passed. */
export function daysUntil(deadline: string, now: Date | number = Date.now()): number {
  const t = new Date(deadline).getTime()
  const n = typeof now === 'number' ? now : now.getTime()
  return Math.ceil((t - n) / DAY)
}
