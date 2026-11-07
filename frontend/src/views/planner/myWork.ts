import type { PermitApplication, EnforcementOrder, Appeal } from '@/services/developmentManagementService'
import { deriveStatutoryState } from '@/composables/useStatutoryClock'
import { needsComplianceReview } from './enforcementRules'
import { ACK_DAYS } from './caseClock'
import { normalizeStatus, type CanonicalStatus, caseRef } from '@/composables/useApplicationPipeline'
import type { SectionKey } from '@/composables/usePlannerShell'

export const CLOSED_PERMIT_STATUSES: readonly CanonicalStatus[] = [
  'approved', 'approved_with_conditions', 'refused', 'withdrawn',
]

export type WorkSeverity = 'critical' | 'urgent' | 'caution' | 'info'

export type WorkAction =
  | { type: 'case'; permitId: string }
  | { type: 'section'; section: SectionKey }

export interface WorkItem {
  id: string
  ref: string
  title: string
  reason: string
  daysRemaining?: number
  severity: WorkSeverity
  action: WorkAction
}

export interface MyWorkQueues {
  urgent: WorkItem[]
  applications: {
    newlyAssigned: WorkItem[]
    inAssessment: WorkItem[]
    awaitingInformation: WorkItem[]
    awaitingReferrals: WorkItem[]
    awaitingObjections: WorkItem[]
    readyForRecommendation: WorkItem[]
    awaitingDecision: WorkItem[]
  }
  enforcement: WorkItem[]
  alerts: WorkItem[]
}

/**
 * Whose applications My Work shows. It used to show every live application in
 * the office under "My applications"; with more than one planner that is a
 * shared inbox, not a worklist. Enforcement and appeals carry no assignee, so
 * they stay office-wide in every scope.
 */
export type WorkScope = 'mine' | 'unassigned' | 'office'

export function scopePermits(permits: PermitApplication[], scope: WorkScope, userId: string | null | undefined): PermitApplication[] {
  if (scope === 'office') return permits
  if (scope === 'unassigned') return permits.filter(p => !p.assigned_to)
  return userId ? permits.filter(p => p.assigned_to === userId) : []
}

/** Live (undetermined) applications per scope, for the scope switch. */
export function scopeCounts(permits: PermitApplication[], userId: string | null | undefined): Record<WorkScope, number> {
  const live = permits.filter(isOpen)
  return {
    mine: scopePermits(live, 'mine', userId).length,
    unassigned: scopePermits(live, 'unassigned', userId).length,
    office: live.length,
  }
}

function refOf(p: PermitApplication): string {
  return caseRef(p)
}

function itemFromPermit(p: PermitApplication, reason: string, severity: WorkSeverity, daysRemaining?: number): WorkItem {
  return {
    id: p.id,
    ref: refOf(p),
    title: p.description?.trim() || p.applicant_name,
    reason,
    daysRemaining,
    severity,
    action: { type: 'case', permitId: p.id },
  }
}

function isOpen(p: PermitApplication): boolean {
  return !CLOSED_PERMIT_STATUSES.includes(normalizeStatus(p.status))
}

export function buildMyWork(input: {
  permits: PermitApplication[]
  enforcement: EnforcementOrder[]
  appeals?: Appeal[]
}, now = new Date()): MyWorkQueues {
  const urgent: WorkItem[] = []
  const newlyAssigned: WorkItem[] = []
  const inAssessment: WorkItem[] = []
  const awaitingInformation: WorkItem[] = []
  const awaitingReferrals: WorkItem[] = []
  const awaitingObjections: WorkItem[] = []
  const readyForRecommendation: WorkItem[] = []
  const awaitingDecision: WorkItem[] = []
  const alerts: WorkItem[] = []

  for (const p of input.permits) {
    if (!isOpen(p)) continue

    const s0 = normalizeStatus(p.status)
    const unacknowledged = s0 === 'registered' || s0 === 'pending_payment'
    if (unacknowledged && p.received_at) {
      // s.26(2): acknowledge within 14 days of receipt.
      const left = ACK_DAYS - Math.floor((now.getTime() - new Date(p.received_at).getTime()) / 86_400_000)
      if (left <= 3) {
        urgent.push(itemFromPermit(p, left <= 0 ? 'Acknowledgement overdue (s.26(2))' : 'Acknowledge receipt (s.26(2))',
          left <= 0 ? 'critical' : 'urgent', left))
      }
    }
    // s.26(7): three months from acknowledgement. The list view carries no
    // acknowledged_at, so receipt stands in — the earlier, safer deadline.
    const clockStart = p.acknowledged_at ?? p.received_at
    if (!unacknowledged && clockStart) {
      const clock = deriveStatutoryState(clockStart, now)
      if (clock.warningLevel === 'critical' || clock.daysRemaining <= 0) {
        urgent.push(itemFromPermit(p, clock.daysRemaining <= 0 ? 'Statutory deadline passed' : 'Statutory deadline critical', 'critical', clock.daysRemaining))
      } else if (clock.warningLevel === 'urgent') {
        urgent.push(itemFromPermit(p, 'Statutory deadline approaching', 'urgent', clock.daysRemaining))
      } else if (clock.warningLevel === 'caution') {
        urgent.push(itemFromPermit(p, 'Statutory clock under pressure', 'caution', clock.daysRemaining))
      }
    }

    const s = s0

    if (s === 'registered' || s === 'acknowledged' || s === 'pending_payment') {
      newlyAssigned.push(itemFromPermit(p, 'Newly received', 'info'))
    }
    if (s === 'under_review') {
      inAssessment.push(itemFromPermit(p, 'In assessment', 'info'))
      if (p.recommendation) {
        readyForRecommendation.push(itemFromPermit(p, 'Recommendation recorded', 'info'))
      }
    }
    if (!p.fee_paid) {
      awaitingInformation.push(itemFromPermit(p, 'Application fee unpaid', 'caution'))
      alerts.push(itemFromPermit(p, 'Application fee unpaid', 'caution'))
    }
    if (s === 'circulation') {
      awaitingReferrals.push(itemFromPermit(p, 'Awaiting referrals', 'caution'))
    }
    if (s === 'objection_period') {
      awaitingObjections.push(itemFromPermit(p, 'Objection period open', 'caution'))
    }
    if (s === 'awaiting_eo_decision' || s === 'deferred' || s === 'appealed') {
      awaitingDecision.push(itemFromPermit(p, 'Awaiting decision', 'info'))
    }
  }

  // Only orders with a planner action waiting: a draft to sign, a compliance
  // period that has run out, or an ignored order awaiting council action.
  const enforcement: WorkItem[] = []
  for (const e of input.enforcement) {
    const reason = e.status === 'draft' ? 'Draft order awaiting signature'
      : needsComplianceReview(e, now) ? 'Compliance period ended: review'
      : e.status === 'non_complied' ? 'Not complied: recommend council action'
      : null
    if (!reason) continue
    const item: WorkItem = {
      id: e.id,
      ref: e.order_reference,
      title: e.subject_name || e.owner_name || e.stand_number,
      reason,
      severity: e.status === 'draft' ? 'caution' : 'urgent',
      action: { type: 'section', section: 'enforcement' },
    }
    enforcement.push(item)
    if (item.severity === 'urgent') urgent.push(item)
  }

  for (const a of input.appeals ?? []) {
    if (a.status === 'decided' || a.status === 'withdrawn') continue
    urgent.push({
      id: a.id,
      ref: caseRef(a),
      title: `${a.appellant_name} v. council`,
      reason: 'Appeal lodged: prepare the case record',
      severity: 'urgent',
      action: { type: 'section', section: 'appeals' },
    })
  }

  urgent.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999))

  return {
    urgent,
    applications: {
      newlyAssigned,
      inAssessment,
      awaitingInformation,
      awaitingReferrals,
      awaitingObjections,
      readyForRecommendation,
      awaitingDecision,
    },
    enforcement,
    alerts,
  }
}
