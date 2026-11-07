import type { CaseFile } from '@/composables/usePlannerCase'

export type BlockerSeverity = 'blocking' | 'warning' | 'clear'

export interface CaseBlocker {
  id: string
  label: string
  severity: BlockerSeverity
}

export interface CaseBlockersResult {
  blockers: CaseBlocker[]
  nextAction: string
}

export function deriveCaseBlockers(c: CaseFile): CaseBlockersResult {
  const blockers: CaseBlocker[] = []

  if (!c.intake.feePaid) {
    blockers.push({ id: 'intake', label: 'Applicant information incomplete — fee unpaid', severity: 'warning' })
  }

  for (const r of c.dueDiligence.referrals) {
    const severity: BlockerSeverity = r.outcome === 'pending' ? 'blocking'
      : r.outcome === 'objection' ? 'blocking'
      : 'clear'
    const suffix = r.outcome === 'pending' ? 'response outstanding'
      : r.outcome === 'objection' ? 'objected'
      : 'complete'
    blockers.push({ id: `referral:${r.department}`, label: `${r.department} ${suffix}`, severity })
  }

  const openObjections = c.notices.objections.filter(o => !o.resolvedAt)
  if (openObjections.length) {
    blockers.push({
      id: 'objections',
      label: openObjections.length === 1
        ? 'Objection response required'
        : `${openObjections.length} objections require a response`,
      severity: 'warning',
    })
  }

  if (c.permitId && !c.dueDiligence.completedAt && c.dueDiligence.referrals.every(r => r.outcome !== 'pending')) {
    blockers.push({ id: 'due-diligence', label: 'Due diligence not marked complete', severity: 'warning' })
  }

  const firstBlock = blockers.find(b => b.severity === 'blocking')
  const firstWarn = blockers.find(b => b.severity === 'warning')
  let nextAction: string
  if (firstBlock?.id.startsWith('referral:')) {
    const dept = firstBlock.id.slice('referral:'.length)
    nextAction = `Request revised ${dept.toLowerCase()} response from the specialist or the applicant.`
  } else if (firstBlock) {
    nextAction = firstBlock.label
  } else if (!c.intake.feePaid) {
    nextAction = 'Confirm the application fee has been paid before assessment proceeds.'
  } else if (firstWarn?.id === 'objections') {
    nextAction = 'Record the officer view and request the applicant response to the objection.'
  } else if (firstWarn?.id === 'intake') {
    nextAction = 'Request the outstanding fee and completeness items from the applicant.'
  } else if (firstWarn?.id === 'due-diligence') {
    nextAction = 'Finish the remaining due diligence checks and mark the stage complete.'
  } else if (!c.permitId) {
    nextAction = 'Register the application in intake.'
  } else if (!c.committeeReport.resolutionAt) {
    nextAction = 'Prepare the committee report and record the resolution.'
  } else if (!c.permit.issueDate && (c.committeeReport.recommendation === 'approve' || c.committeeReport.recommendation === 'approve_modified')) {
    nextAction = 'Draft conditions and issue the permit.'
  } else {
    nextAction = 'No blockers. Continue the statutory workflow.'
  }

  return { blockers, nextAction }
}
