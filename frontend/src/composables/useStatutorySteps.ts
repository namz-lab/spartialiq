// Derives the timeline-stepper rail's per-step descriptors from the planner-case
// context. Pure status/progress/guidance — it does NOT own completion actions
// (those live in the step components). Takes the context as an argument (rather
// than injecting) so the shell can both provide and consume the case safely.
import { computed, type ComputedRef } from 'vue'
import type { PlannerCaseContext, CaseFile, CheckResult } from '@/composables/usePlannerCase'
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS, DD_CHECK_TOTAL } from '@/views/planner/dueDiligenceChecks'

export type StepStatus = 'done' | 'available' | 'locked'
export interface StatutorySubtask { label: string; done: boolean }
export interface StatutoryStep {
  id: 1 | 2 | 3 | 4 | 5
  key: 'intake' | 'due_diligence' | 'committee_report' | 'permit' | 'notices'
  title: string
  status: StepStatus
  progressDone: number
  progressTotal: number
  nextAction: string | null
  lockedReason: string | null
  subtasks: StatutorySubtask[]
}

type Bucket = Record<string, { result: CheckResult; notes: string }> | undefined

function markedCount(bucket: Bucket, keys: ReadonlyArray<readonly [string, string]>): number {
  if (!bucket) return 0
  let n = 0
  for (const [k] of keys) if (bucket[k]?.result != null) n++
  return n
}

function lockedStep(id: StatutoryStep['id'], key: StatutoryStep['key'], title: string): StatutoryStep {
  return { id, key, title, status: 'locked', progressDone: 0, progressTotal: 0,
    nextAction: null, lockedReason: 'No active case', subtasks: [] }
}

export function useStatutorySteps(ctx: PlannerCaseContext): { steps: ComputedRef<StatutoryStep[]> } {
  const steps = computed<StatutoryStep[]>(() => {
    const c = ctx.current.value as CaseFile | null
    if (!c) {
      return [
        lockedStep(1, 'intake', 'Intake'),
        lockedStep(2, 'due_diligence', 'Due Diligence'),
        lockedStep(3, 'committee_report', 'Committee Report'),
        lockedStep(4, 'permit', 'Permit'),
        lockedStep(5, 'notices', 'Notices'),
      ]
    }
    const dd = c.dueDiligence
    const ddMarked = markedCount(dd.fileChecks, FILE_CHECKS)
      + markedCount(dd.compatibility, COMPAT_CHECKS)
      + markedCount(dd.statutoryChecks, STATUTE_CHECKS)
    const ddOutstanding = DD_CHECK_TOTAL - ddMarked

    // 1 · Intake
    const intakeSubs: StatutorySubtask[] = [
      { label: 'Applicant', done: !!c.applicant.name },
      { label: 'Property / stand', done: !!c.property.standNo },
      { label: 'Proposal', done: !!c.proposal.description },
    ]
    const intake: StatutoryStep = {
      id: 1, key: 'intake', title: 'Intake',
      status: c.permitId ? 'done' : 'available',
      progressDone: intakeSubs.filter(s => s.done).length, progressTotal: intakeSubs.length,
      nextAction: c.permitId ? null : 'Register the application',
      lockedReason: null, subtasks: intakeSubs,
    }

    // 2 · Due Diligence
    const ddLocked = !ctx.step2Unlocked.value
    const dueDiligence: StatutoryStep = {
      id: 2, key: 'due_diligence', title: 'Due Diligence',
      status: ddLocked ? 'locked' : (dd.completedAt ? 'done' : 'available'),
      progressDone: ddMarked, progressTotal: DD_CHECK_TOTAL,
      nextAction: ddLocked ? null
        : dd.completedAt ? null
        : ddOutstanding > 0 ? `${ddOutstanding} checks outstanding`
        : 'Mark due diligence complete',
      lockedReason: ddLocked ? 'Register the application first' : null,
      subtasks: [
        { label: 'File checks',          done: markedCount(dd.fileChecks, FILE_CHECKS) === FILE_CHECKS.length },
        { label: 'Compatibility',        done: markedCount(dd.compatibility, COMPAT_CHECKS) === COMPAT_CHECKS.length },
        { label: 'Statutory provisions', done: markedCount(dd.statutoryChecks, STATUTE_CHECKS) === STATUTE_CHECKS.length },
        { label: 'Title-deed',           done: !dd.titleDeedConflict.hasConflict || dd.titleDeedConflict.bondholderConsentReceived },
        { label: 'Referrals logged',     done: dd.referrals.length > 0 },
      ],
    }

    // 3 · Committee Report
    const repLocked = !ctx.step3Unlocked.value
    const cr = c.committeeReport
    const reportSubs: StatutorySubtask[] = [
      { label: 'Tabled to committee', done: !!cr.tabledAt },
      { label: 'Resolution recorded', done: !!cr.resolutionAt },
    ]
    const report: StatutoryStep = {
      id: 3, key: 'committee_report', title: 'Committee Report',
      status: repLocked ? 'locked' : (cr.resolutionAt ? 'done' : 'available'),
      progressDone: reportSubs.filter(s => s.done).length, progressTotal: reportSubs.length,
      nextAction: repLocked ? null : cr.resolutionAt ? null : 'Record committee resolution',
      lockedReason: repLocked ? 'Complete due diligence first' : null,
      subtasks: reportSubs,
    }

    // 4 · Permit
    const permitLocked = !ctx.step4Unlocked.value
    const permitSubs: StatutorySubtask[] = [
      { label: 'Permit number', done: !!c.permit.permitNo },
      { label: 'Conditions',    done: c.permit.conditions.length > 0 },
      { label: 'Issued',        done: !!c.permit.issueDate },
    ]
    const permit: StatutoryStep = {
      id: 4, key: 'permit', title: 'Permit',
      status: permitLocked ? 'locked' : (c.permit.issueDate ? 'done' : 'available'),
      progressDone: permitSubs.filter(s => s.done).length, progressTotal: permitSubs.length,
      nextAction: permitLocked ? null : c.permit.issueDate ? null : 'Draft & issue the permit',
      lockedReason: permitLocked ? 'Needs an approve resolution' : null,
      subtasks: permitSubs,
    }

    // 5 · Notices
    const n = c.notices
    const noticeSubs: StatutorySubtask[] = [
      { label: 'Acknowledgement sent', done: !!n.ackSentAt },
      { label: 'Public notice',        done: !!n.publicNotice?.publishedAt },
      { label: 'Objections handled',   done: n.objections.length === 0 || n.objections.every(o => !!o.resolvedAt) },
      { label: 'Outcome letter sent',  done: !!n.outcomeLetterSentAt },
    ]
    const notices: StatutoryStep = {
      id: 5, key: 'notices', title: 'Notices',
      status: n.outcomeLetterSentAt ? 'done' : 'available',
      progressDone: noticeSubs.filter(s => s.done).length, progressTotal: noticeSubs.length,
      nextAction: n.outcomeLetterSentAt ? null : 'Issue acknowledgement & notices',
      lockedReason: null, subtasks: noticeSubs,
    }

    return [intake, dueDiligence, report, permit, notices]
  })

  return { steps }
}
