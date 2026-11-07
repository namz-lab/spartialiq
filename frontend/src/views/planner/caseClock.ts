// Every statutory deadline on one case, in date order. Pure.
// RTCP Act [Ch. 29:12]: s.26(2) acknowledgement, s.26(3)-(4) notice and
// objections, s.26(7) three-month determination, s.38 appeal window.
import {
  ACK_DAYS, appealDeadline, determinationDeadline, determinationSection, objectionDeadline,
} from '@/statutory/periods'

export { ACK_DAYS }

export type DeadlineState = 'done' | 'overdue' | 'due_soon' | 'upcoming' | 'not_started'

export interface Deadline {
  key: string
  label: string
  basis: string
  due: Date | null
  doneAt: Date | null
  state: DeadlineState
}

export interface ClockInput {
  receivedAt: string | null
  acknowledgedAt: string | null
  /** development_type: a subdivision or consolidation is governed by s.40 (four months) rather than s.26 (three). */
  devType?: string | null
  objectionStart?: string | null
  objectionEnd?: string | null
  objectionClosed?: boolean
  /** Due dates of referrals still awaiting a reply. */
  pendingReferralDue?: (string | null | undefined)[]
  decidedAt?: string | null
  notifiedAt?: string | null
}

const DAY = 86_400_000
const d = (v: string | null | undefined) => (v ? new Date(v) : null)
const plus = (v: Date | null, days: number) => (v ? new Date(v.getTime() + days * DAY) : null)

function stateOf(due: Date | null, doneAt: Date | null, now: Date): DeadlineState {
  if (doneAt) return 'done'
  if (!due) return 'not_started'
  const left = (due.getTime() - now.getTime()) / DAY
  if (left < 0) return 'overdue'
  if (left <= 7) return 'due_soon'
  return 'upcoming'
}

export function caseDeadlines(i: ClockInput, now = new Date()): Deadline[] {
  const received = d(i.receivedAt)
  const ack = d(i.acknowledgedAt)
  const decided = d(i.decidedAt)
  const rows: Omit<Deadline, 'state'>[] = [
    { key: 'ack', label: 'Acknowledge receipt', basis: 's.26(2) — within 14 days of receipt',
      due: plus(received, ACK_DAYS), doneAt: ack },
  ]
  if (i.objectionStart || i.objectionEnd) {
    const end = d(i.objectionEnd) ?? d(i.objectionStart ? objectionDeadline(i.objectionStart) : null)
    rows.push({ key: 'objections', label: 'Objection period closes', basis: 's.26(4) — one month from notice',
      due: end, doneAt: i.objectionClosed ? end : null })
  }
  const pending = (i.pendingReferralDue ?? []).map(d).filter((x): x is Date => !!x)
  if (pending.length) {
    rows.push({ key: 'referrals', label: `Referral replies (${pending.length} outstanding)`, basis: 'Due dates set on circulation',
      due: new Date(Math.max(...pending.map(x => x.getTime()))), doneAt: null })
  }
  const months = i.devType === 'subdivision' || i.devType === 'consolidation' ? 'four' : 'three'
  rows.push({ key: 'determination', label: 'Determine the application',
    basis: `${determinationSection(i.devType)} — ${months} months from acknowledgement; otherwise deemed refused`,
    due: d(determinationDeadline(i.acknowledgedAt, i.devType)), doneAt: decided })
  if (decided) {
    const notified = d(i.notifiedAt)
    rows.push({ key: 'appeal', label: 'Appeal window closes', basis: 's.38 — one month from notification of the decision',
      due: d(appealDeadline((notified ?? decided).toISOString())), doneAt: null })
  }
  return rows
    .map(r => ({ ...r, state: stateOf(r.due, r.doneAt, now) }))
    .sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))
}

/** Is the case outside the planner's delegated authority, so it goes to committee? */
export function delegationCheck(i: {
  devType: string
  classification?: string | null
  recommendation?: string | null
  objectionCount: number
}): { committee: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (['rezoning', 'subdivision'].includes(i.devType)) reasons.push('Subdivisions and rezonings are reserved to committee.')
  if (i.classification === 'special_consent_26_3') reasons.push('Special consent applications are reserved to committee.')
  if (i.recommendation === 'refuse') reasons.push('Refusals are reported to committee.')
  if (i.objectionCount) reasons.push(`${i.objectionCount} objection${i.objectionCount === 1 ? ' was' : 's were'} received.`)
  return { committee: reasons.length > 0, reasons }
}

/** Does this application need public notice and notice to adjoining owners? */
export function noticeRequirement(devType: string, classification?: string | null): { required: boolean; why: string } {
  if (classification === 'special_consent_26_3') {
    return { required: true, why: 'Special consent (s.26(3)): newspaper notice, site notice and notice to adjoining owners.' }
  }
  if (['change_of_use', 'subdivision', 'rezoning'].includes(devType)) {
    return { required: true, why: 'Change of use, subdivision and rezoning affect neighbours: give public notice and notify adjoining owners.' }
  }
  if (devType === 'consolidation') {
    return { required: false, why: 'Consolidation within one ownership: notice is not normally required.' }
  }
  return { required: false, why: 'Permitted use complying with the operative plan: notice is not normally required. Give notice if the proposal departs from the plan or affects neighbours.' }
}
