// Development-control returns for a month, quarter or year.
//
// The old return counted rows by created_at (when the record was typed, not
// when the application was received) and reported only volumes. A council's
// committee and the Ministry also ask how fast it decides: days to decision,
// decisions inside the statutory period, acknowledgements on time, and files
// already past their deadline. Those are computed here from the register rows.

import type { PermitApplication, EnforcementOrder } from '@/services/developmentManagementService'
import {
  isPermitApproved, normalizeStatus, statusLabel, devTypeLabel, wardLabel,
} from '@/composables/useApplicationPipeline'
import { determinationDeadline } from '@/statutory/periods'
import { ACK_DAYS } from './caseClock'
import { CLOSED_PERMIT_STATUSES } from './myWork'

export type PeriodKind = 'month' | 'quarter' | 'year'
/** index: month 0–11, quarter 1–4, ignored for a year. */
export interface Period { kind: PeriodKind; year: number; index: number }

const DAY = 86_400_000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function currentPeriod(kind: PeriodKind, now = new Date()): Period {
  const m = now.getUTCMonth()
  return { kind, year: now.getUTCFullYear(), index: kind === 'month' ? m : kind === 'quarter' ? Math.floor(m / 3) + 1 : 0 }
}

export function periodBounds(p: Period): [Date, Date] {
  const [m0, months] = p.kind === 'month' ? [p.index, 1] : p.kind === 'quarter' ? [(p.index - 1) * 3, 3] : [0, 12]
  return [new Date(Date.UTC(p.year, m0, 1)), new Date(Date.UTC(p.year, m0 + months, 1) - 1)]
}

export function periodLabel(p: Period): string {
  if (p.kind === 'month') return `${MONTHS[p.index]} ${p.year}`
  if (p.kind === 'quarter') return `Q${p.index} ${p.year}`
  return String(p.year)
}

const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)
const days = (from: number, to: number) => Math.floor((to - from) / DAY)

/**
 * The deemed-refusal instant for a permit, in ms: three calendar months from acknowledgement (four for a subdivision or
 * consolidation, s.40(6)). Where there is no acknowledgement the receipt date stands in, because for a performance return an
 * unacknowledged file is a failure of its own and should not look like it has all the time in the world.
 */
function deadlineMs(x: PermitApplication, startMs: number): number {
  return Number.isFinite(startMs)
    ? new Date(determinationDeadline(new Date(startMs).toISOString(), (x as { development_type?: string | null }).development_type) as string).getTime()
    : NaN
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function tally<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export interface Returns {
  received: number
  decided: number
  approved: number
  refused: number
  medianDaysToDecision: number | null
  decidedInTime: number
  ackDue: number
  ackOnTime: number
  overdueNow: number
  enforcementIssued: number
  byStatus: [string, number][]
  byType: [string, number][]
  byWard: [string, number][]
}

export function buildReturns(
  permits: PermitApplication[], enforcement: EnforcementOrder[], p: Period, now = new Date(),
): Returns {
  const [start, end] = periodBounds(p).map(d => d.getTime())
  const inPeriod = (ms: number) => ms >= start && ms <= end
  const receivedAt = (x: PermitApplication) => t(x.received_at ?? x.created_at)

  const received = permits.filter(x => inPeriod(receivedAt(x)))
  const decided = permits.filter(x => inPeriod(t(x.decision_at)))

  const turnaround = decided.map(x => days(receivedAt(x), t(x.decision_at))).filter(Number.isFinite)
  const decidedInTime = decided.filter(x => {
    const clock = t(x.acknowledged_at) || receivedAt(x)
    return t(x.decision_at) <= deadlineMs(x, clock)
  }).length

  // Acknowledgement is due 14 days after receipt; count only applications
  // whose 14 days have run (or that were acknowledged), so a file received
  // yesterday is not a failure.
  const ackDueRows = received.filter(x => x.acknowledged_at || days(receivedAt(x), now.getTime()) > ACK_DAYS)
  const ackOnTime = ackDueRows.filter(x => x.acknowledged_at && days(receivedAt(x), t(x.acknowledged_at)) <= ACK_DAYS).length

  const overdueNow = permits.filter(x => {
    if (CLOSED_PERMIT_STATUSES.includes(normalizeStatus(x.status))) return false
    const clock = t(x.acknowledged_at) || receivedAt(x)
    return Number.isFinite(clock) && now.getTime() > deadlineMs(x, clock)
  }).length

  return {
    received: received.length,
    decided: decided.length,
    approved: decided.filter(x => isPermitApproved(x.status)).length,
    refused: decided.filter(x => normalizeStatus(x.status) === 'refused').length,
    medianDaysToDecision: median(turnaround),
    decidedInTime,
    ackDue: ackDueRows.length,
    ackOnTime,
    overdueNow,
    enforcementIssued: enforcement.filter(o => inPeriod(t(o.issued_at))).length,
    byStatus: tally(received, x => statusLabel(x.status)),
    byType: tally(received, x => devTypeLabel(x.development_type)),
    byWard: tally(received, x => wardLabel(x.suburb_ward)),
  }
}

/** "12 of 15 (80%)", or "—" when nothing was due. */
export function share(n: number, of: number): string {
  return of ? `${n} of ${of} (${Math.round((n / of) * 100)}%)` : '—'
}
