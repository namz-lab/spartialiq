/**
 * The inspection case brief.
 *
 * One derivation of the eight questions an inspector must be able to answer at a
 * glance, from data the API already returns. Pure, so it can be tested without a
 * component and so the console and the map pane cannot drift into two different
 * answers for the same case.
 *
 * Nothing here invents a value: every field comes from the permit, the official
 * stage_inspection rows, the approved building plans, the consultation records or
 * the occupation certificate. Where a fact is unknown the brief says so.
 *
 * Severity vocabulary is deliberately the same as the planner's
 * views/planner/caseBlockers.ts ('blocking' | 'warning' | 'clear') so the platform
 * has one word for one idea. The models themselves are separate on purpose: the
 * planner blocks on intake fees, objections and notices (deciding an application);
 * the inspector blocks on approved plans, failed stages and open referrals
 * (inspecting a building).
 */

import {
  ANNEXURE_STAGES,
  annexureStageName,
  nextAnnexureStageNumber,
  type OfficialInspectionResult,
} from './architecture'
import {
  isBuildingPlanApproved,
  type PermitApplication,
  type BuildingPlan,
  type Consultation,
  type OccupationCertificate,
} from '@/services/developmentManagementService'

export type BlockerSeverity = 'blocking' | 'warning' | 'clear'

/** The verdict vocabulary held in the local case mirror (see useInspectionCase). */
export type CaseVerdict = 'pass' | 'fail' | 'rework' | 'pending'

export interface CaseStageMirror {
  stageNumber: number
  inspectionId: string | null
  verdict: CaseVerdict
  inspectedAt: string | null
}

export interface CaseBriefInput {
  permit: PermitApplication | null
  stages: Record<number, CaseStageMirror> | null
  plans?: BuildingPlan[]
  consultations?: Consultation[]
  certificate?: OccupationCertificate | null
}

export interface InspectionBlocker {
  /** Machine key so the UI can route the inspector to the thing that unblocks it. */
  code: 'no_permit' | 'no_approved_plan' | 'stage_failed' | 'awaiting_consultation' | 'occupation_issued'
  label: string
  detail: string
  severity: BlockerSeverity
}

export interface CaseBrief {
  /** WHAT — the case identity. */
  what: { reference: string; title: string; developmentType: string; permitStatus: string } | null
  /** WHERE — the site. */
  where: { stand: string; ward: string; address: string | null; lat: number | null; lng: number | null } | null
  /** WHY — why this desk is looking at it now. */
  why: string
  /** WHAT WAS APPROVED — the plan revision the work must match. */
  approved: { revisionLabel: string; approvedAt: string | null; architect: string | null } | null
  /** WHAT HAPPENED BEFORE — recorded stage attempts, most recent first. */
  history: Array<{ stageNumber: number; stageName: string; verdict: CaseVerdict; inspectedAt: string | null }>
  /** WHAT MUST I DO NOW. */
  now: { stageNumber: number; stageName: string } | null
  /** WHAT IS BLOCKING ME — empty when nothing blocks. */
  blockers: InspectionBlocker[]
  /** WHAT HAPPENS NEXT. */
  next: string
}

/** 'rework' mirrors conditional_pass — the stage advanced, so it counts as done. */
const ADVANCING: CaseVerdict[] = ['pass', 'rework']

const planIsApproved = (p: BuildingPlan) => isBuildingPlanApproved(p.status)

/** The governing approved revision: the highest revision number that was approved. */
export function governingPlan(plans: BuildingPlan[] = []): BuildingPlan | null {
  const approved = plans.filter(planIsApproved)
  if (!approved.length) return null
  return approved.reduce((best, p) => (p.revision > best.revision ? p : best))
}

/** Consultations still awaiting a specialist response. */
export function openBlockingConsultations(consultations: Consultation[] = []): Consultation[] {
  return consultations.filter((c) => {
    const status = c.response_status ?? c.outcome
    const answered = Boolean(status) && status !== 'pending' && status !== 'no_response'
    const closed = c.task_status === 'accepted' || c.task_status === 'cancelled'
    return !answered && !closed
  })
}

/** Local mirror verdict -> canonical stage_inspection result. */
function verdictToResult(v: CaseVerdict): OfficialInspectionResult | null {
  if (v === 'pass') return 'pass'
  if (v === 'rework') return 'conditional_pass'
  if (v === 'fail') return 'fail'
  return null
}

export function buildCaseBrief(input: CaseBriefInput): CaseBrief {
  const { permit, stages, plans = [], consultations = [], certificate = null } = input

  if (!permit || !stages) {
    return {
      what: null,
      where: null,
      why: 'No case is open. Choose an inspection from the queue.',
      approved: null,
      history: [],
      now: null,
      blockers: [{
        code: 'no_permit',
        label: 'No case open',
        detail: 'Open an inspection from the work queue before recording anything.',
        severity: 'blocking',
      }],
      next: 'Open a case from the queue.',
    }
  }

  const reference = permit.dev_register_no || permit.tpd_reference || permit.id.slice(0, 8).toUpperCase()
  const stand = permit.stand_number || '—'

  // ── WHAT HAPPENED BEFORE ────────────────────────────────────────────
  const history = Object.values(stages)
    .filter(s => s.verdict !== 'pending')
    .sort((a, b) => b.stageNumber - a.stageNumber)
    .map(s => ({
      stageNumber: s.stageNumber,
      stageName: annexureStageName(s.stageNumber),
      verdict: s.verdict,
      inspectedAt: s.inspectedAt,
    }))

  // ── WHAT MUST I DO NOW ──────────────────────────────────────────────
  // Reuse the progression rule the stage console uses, so the header and the
  // checklist can never disagree about which stage is due.
  const rows = Object.values(stages).map(s => ({
    stage_number: s.stageNumber,
    attempt: 1,
    result: verdictToResult(s.verdict),
  }))
  const dueStage = nextAnnexureStageNumber(rows)
  const advanced = history.filter(h => ADVANCING.includes(h.verdict)).length
  // Stage 9 is the certificate itself, so 1–8 are the construction stages.
  const constructionComplete = advanced >= ANNEXURE_STAGES.length - 1

  const now = certificate ? null : { stageNumber: dueStage, stageName: annexureStageName(dueStage) }

  // ── WHAT IS BLOCKING ME ─────────────────────────────────────────────
  const blockers: InspectionBlocker[] = []

  const plan = governingPlan(plans)
  if (!plan) {
    blockers.push({
      code: 'no_approved_plan',
      label: 'No approved building plan',
      detail: 'There is no approved plan revision on this permit, so work on site cannot be '
            + 'assessed against what was approved.',
      severity: 'blocking',
    })
  }

  const failed = history.filter(h => h.verdict === 'fail')
  for (const f of failed) {
    blockers.push({
      code: 'stage_failed',
      label: `Stage ${f.stageNumber} failed`,
      detail: `${f.stageName} did not pass. A re-inspection attempt is required before the work proceeds.`,
      severity: 'blocking',
    })
  }

  const awaiting = openBlockingConsultations(consultations)
  if (awaiting.length) {
    blockers.push({
      code: 'awaiting_consultation',
      label: `${awaiting.length} referral${awaiting.length > 1 ? 's' : ''} awaiting response`,
      detail: 'A specialist consultation is still open on this case.',
      severity: 'warning',
    })
  }

  if (certificate) {
    blockers.push({
      code: 'occupation_issued',
      label: 'Occupation certificate issued',
      detail: `Certificate ${certificate.certificate_no} was issued for this building. Further stage `
            + 'inspections are not part of the original approval.',
      severity: 'warning',
    })
  }

  // ── WHY / WHAT HAPPENS NEXT ─────────────────────────────────────────
  const why = certificate
    ? `Stand ${stand} is complete and occupied under a certificate of occupation.`
    : failed.length
      ? `Stand ${stand} has a failed stage awaiting re-inspection.`
      : history.length
        ? `Stand ${stand} is part-built; ${advanced} of ${ANNEXURE_STAGES.length - 1} construction stages are signed off.`
        : `Stand ${stand} has a permit and no stage inspection has been recorded yet.`

  const next = certificate
    ? 'No further action — the case is closed by the occupation certificate.'
    : !plan
      ? 'Obtain the approved plan revision before inspecting.'
      : failed.length
        ? `Re-inspect stage ${failed[failed.length - 1].stageNumber} and record the outcome.`
        : constructionComplete
          ? 'All construction stages are signed off — the occupation certificate can be considered.'
          : `Attend site and complete the stage ${dueStage} checklist.`

  return {
    what: {
      reference,
      title: permit.description
        || `${String(permit.development_type || 'development').replace(/_/g, ' ')} — Stand ${stand}`,
      developmentType: permit.development_type || '',
      permitStatus: permit.status,
    },
    where: {
      stand,
      ward: permit.suburb_ward || '—',
      address: permit.street_address ?? null,
      lat: permit.lat ?? null,
      lng: permit.lng ?? null,
    },
    why,
    approved: plan
      ? {
          revisionLabel: plan.revision_label || `Revision ${plan.revision}`,
          approvedAt: plan.appraised_at,
          architect: plan.architect_name,
        }
      : null,
    history,
    now,
    blockers,
    next,
  }
}
