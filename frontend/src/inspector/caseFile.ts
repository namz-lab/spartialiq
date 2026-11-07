/**
 * Building file derivations for the Case file section. Pure — no Vue, no API.
 */
import type { StageInspection } from '@/services/developmentManagementService'
import { INSPECTION_STAGES_STATIC } from '@/composables/useInspectionCase'

export type StageState = 'passed' | 'conditional' | 'failed' | 'booked' | 'not_started'

export interface StageLine {
  n: number
  name: string
  state: StageState
  attempts: number
  latest: StageInspection | null
}

/** One line per statutory stage, judged on its LATEST attempt only. */
export function stageTimeline(inspections: StageInspection[]): StageLine[] {
  return INSPECTION_STAGES_STATIC.map(({ n, name }) => {
    const rows = inspections.filter(i => i.stage_number === n)
    const latest = rows.reduce<StageInspection | null>(
      (best, r) => (!best || (r.attempt ?? 0) >= (best.attempt ?? 0) ? r : best), null)
    const state: StageState = !latest ? 'not_started'
      : latest.result === 'pass' ? 'passed'
      : latest.result === 'conditional_pass' ? 'conditional'
      : latest.result === 'fail' || latest.result === 'reinspection_required' ? 'failed'
      : 'booked'
    return { n, name, state, attempts: rows.length, latest }
  })
}

export interface PermitValidity {
  /** 'commenced' once any stage has been inspected. */
  state: 'commenced' | 'valid' | 'expiring' | 'lapsed' | 'unknown'
  lapsesOn: Date | null
  daysLeft: number | null
}

/**
 * A development permit lapses if work has not commenced within 12 months of
 * the decision. An inspected stage is the council's evidence of commencement.
 * Within 60 days of the deadline the permit is flagged as expiring.
 */
export function permitValidity(
  decisionAt: string | null | undefined,
  inspections: StageInspection[],
  now = new Date(),
): PermitValidity {
  if (inspections.some(i => i.inspected_at)) return { state: 'commenced', lapsesOn: null, daysLeft: null }
  const t = decisionAt ? new Date(decisionAt) : null
  if (!t || Number.isNaN(t.getTime())) return { state: 'unknown', lapsesOn: null, daysLeft: null }
  const lapsesOn = new Date(t)
  lapsesOn.setFullYear(lapsesOn.getFullYear() + 1)
  const daysLeft = Math.ceil((lapsesOn.getTime() - now.getTime()) / 86_400_000)
  const state = daysLeft < 0 ? 'lapsed' : daysLeft <= 60 ? 'expiring' : 'valid'
  return { state, lapsesOn, daysLeft }
}

/**
 * When an enforcement order must be complied with: issue date plus its
 * compliance period in days. Negative daysLeft means overdue.
 */
export function complianceDeadline(
  issuedAt: string | null | undefined,
  periodDays: number | null | undefined,
  now = new Date(),
): { dueOn: Date; daysLeft: number } | null {
  const t = issuedAt ? new Date(issuedAt) : null
  if (!t || Number.isNaN(t.getTime()) || periodDays == null || !Number.isFinite(Number(periodDays))) return null
  const dueOn = new Date(t.getTime() + Number(periodDays) * 86_400_000)
  return { dueOn, daysLeft: Math.ceil((dueOn.getTime() - now.getTime()) / 86_400_000) }
}
