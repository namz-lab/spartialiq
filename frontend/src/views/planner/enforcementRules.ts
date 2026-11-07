// Enforcement rules the planner console applies to server records. Pure.
import type { EnforcementOrder } from '@/services/developmentManagementService'
import type { OrderKind } from './plannerDocuments'

/** Days between service and an order taking effect, unless appealed (s.38). */
export const EFFECT_AFTER_SERVICE_DAYS = 30

export const OPEN_ORDER_STATUSES: readonly EnforcementOrder['status'][] = ['draft', 'issued', 'served', 'non_complied', 'appealed']

export function isOrderOpen(o: Pick<EnforcementOrder, 'status'>): boolean {
  return OPEN_ORDER_STATUSES.includes(o.status)
}

/** Which draft document an order produces. */
export function orderKind(type: EnforcementOrder['order_type']): OrderKind {
  return type === 'reinstatement' || type === 'demolition' || type === 'removal' ? 's35' : 'enforcement'
}

function addDays(iso: string, days: number): Date {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d
}

/** When compliance falls due: the stored date, else service + effect + period. */
export function complianceDue(o: Pick<EnforcementOrder, 'compliance_due_at' | 'served_at' | 'compliance_period'>): Date | null {
  if (o.compliance_due_at) return new Date(o.compliance_due_at)
  if (!o.served_at) return null
  return addDays(o.served_at, EFFECT_AFTER_SERVICE_DAYS + (Number(o.compliance_period) || 0))
}

/** A served order whose compliance period has run out needs the planner's review. */
export function needsComplianceReview(
  o: Pick<EnforcementOrder, 'status' | 'compliance_due_at' | 'served_at' | 'compliance_period'>,
  now = new Date(),
): boolean {
  if (o.status !== 'served') return false
  const due = complianceDue(o)
  return !!due && due.getTime() <= now.getTime()
}

/** Orders raised from a contravention carry its reference as a prefix. */
export function breachFor(reference: string, text: string): string {
  return `${reference}: ${text}`
}

export function orderForComplaint<T extends Pick<EnforcementOrder, 'breach_description'>>(reference: string, orders: T[]): T | null {
  return orders.find(o => (o.breach_description || '').startsWith(`${reference}:`)) ?? null
}
