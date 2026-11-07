// Referral (technical circulation) rules for the planner case file. Pure.
import type { Consultation } from '@/services/developmentManagementService'

/** Bodies a planner routinely circulates to. Names carry the needles each
 *  specialist inbox matches on (SpecialistReferralsInbox), so an internal
 *  referral reaches the right desk. */
export const REFERRAL_BODIES = [
  'Roads authority (Department of Roads)',
  'Environmental Management Agency (EMA)',
  'Neighbouring local authority',
  'Engineering Services',
  'Environmental Health',
  'Surveyor',
  'GIS Officer',
] as const

/** Site-inspection requests go to Development Control Officers, whose inbox
 *  matches on 'inspector' / 'building control'. */
export const SITE_INSPECTION_BODY = 'Building Inspector (Development Control Officer)'
export const SITE_INSPECTION_TASK = 'site_inspection'

export const DEFAULT_RESPONSE_DAYS = 21

export type ReferralState = 'responded' | 'overdue' | 'awaiting' | 'cancelled'

export function responseStatus(c: Consultation): string {
  return c.response_status ?? c.outcome ?? 'pending'
}

export function referralState(c: Consultation, now = new Date()): ReferralState {
  if (c.task_status === 'cancelled') return 'cancelled'
  const s = responseStatus(c)
  if (s !== 'pending' && s !== 'no_response') return 'responded'
  if (c.response_due_at && new Date(c.response_due_at).getTime() < now.getTime()) return 'overdue'
  return 'awaiting'
}

export function isSiteInspection(c: Consultation): boolean {
  return c.task_type === SITE_INSPECTION_TASK
}

export function dueDateFrom(days: number, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const RESPONSE_LABEL: Record<string, string> = {
  pending: 'Awaiting response',
  no_objection: 'No objection',
  objection: 'Objection',
  conditional_approval: 'No objection, with conditions',
  conditional: 'No objection, with conditions',
  no_response: 'No response',
}
