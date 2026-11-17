/**
 * Exception tests the internal auditor re-performs over records the server already sends.
 *
 * Each test compares people or times; none adds money. The database enforces two of the duties
 * (a voucher's poster is not its preparer, a cash-up's verifier is not its cashier), so an exception
 * there means a control failed, and "none found" is evidence the control held over the population
 * read. Approving and publishing a release are separated only when the council's setting requires
 * it, so that test can find real cases.
 */
import type { VoucherSummary } from '../../models/ledgerTypes'
import type { CashierSession } from '../../models/cashTypes'
import type { TrailEvent } from '../../api/auditApi'
import type { PublicationRecord } from '../../api/publicationApi'

export const sameVoucherHands = (rows: VoucherSummary[]): VoucherSummary[] =>
  rows.filter((v) => v.posted_by && v.posted_by === v.prepared_by)

export const sameCashUpHands = (rows: CashierSession[]): CashierSession[] =>
  rows.filter((s) => s.verified_by && s.verified_by === s.cashier_id)

export const samePublicationHands = (rows: PublicationRecord[]): PublicationRecord[] =>
  rows.filter((p) => p.approved_by && p.published_by && p.approved_by === p.published_by)

/** A declared total that differs from the system total. The server sends the variance as text. */
const ZERO = /^[-+]?0*(\.0*)?$/
export const cashUpsWithVariance = (rows: CashierSession[]): CashierSession[] =>
  rows.filter((s) => s.counts?.some((c) => c.variance !== null && c.variance !== undefined && !ZERO.test(String(c.variance))))

/** Refused attempts grouped by person and module, most refusals first. */
export interface RefusalGroup { actor: string; actor_id: string | null; role: string | null; event: string; count: number; last: string }
export function refusalsByPerson(events: TrailEvent[]): RefusalGroup[] {
  const map = new Map<string, RefusalGroup>()
  for (const e of events) {
    if ((e.status ?? 0) < 400) continue
    const actor = e.actor_email ?? 'Unknown'
    const key = `${e.actor_id ?? actor}|${e.event}`
    const g = map.get(key)
    if (g) {
      g.count++
      if (e.occurred_at > g.last) g.last = e.occurred_at
    } else {
      map.set(key, { actor, actor_id: e.actor_id, role: e.actor_role, event: e.event, count: 1, last: e.occurred_at })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
}

/**
 * Outside the working day: a weekend, or before 07:00 or from 18:00, in the reader's local time
 * (the council's, for a council office). A change made then is not wrong; it is worth a look.
 */
export function outsideHours(iso: string): boolean {
  const d = new Date(iso)
  const day = d.getDay()
  const h = d.getHours()
  return day === 0 || day === 6 || h < 7 || h >= 18
}
export const changesOutsideHours = (events: TrailEvent[]): TrailEvent[] =>
  events.filter((e) => (e.status ?? 0) < 400 && e.method !== 'GET' && outsideHours(e.occurred_at))
