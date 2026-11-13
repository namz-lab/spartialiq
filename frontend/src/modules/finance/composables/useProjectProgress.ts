/**
 * How a project's physical progress and its spend-versus-progress flag are WORDED (decision D12).
 *
 * This file exists so that "null is not zero" and "null is not a pass" are assertions in a test
 * rather than claims in a template. Three distinctions it keeps:
 *
 *   1. `physical_progress_percent === null`  → "not recorded". No officer has reported anything.
 *   2. `physical_progress_percent === 0`     → "nothing built yet". A report was made, and it says
 *      nothing has been built. These are different facts and must read differently.
 *   3. `spend_ahead_of_progress === null`    → "not compared". The view could not evaluate the
 *      comparison — no progress figure, no execution figure, or no council threshold configured.
 *      It is NOT "within tolerance", and a surface that rendered it as one would turn an absent
 *      control into a clean bill of health.
 *
 * Nothing here computes a figure. The gap in percentage points comes from
 * finance.v_project_performance; elapsed schedule is not physical progress and is never substituted
 * for one (ARCHITECTURE-ASSESSMENT §10 conflict 2).
 */
import { formatPercentage } from './useMoney'

export function describeProgress(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return 'not recorded'
  if (Number(percent) === 0) return '0% — nothing built yet (reported)'
  return formatPercentage(percent)
}

export interface SpendVsProgressInput {
  physicalProgressPercent: number | null | undefined
  /** A percentage as the view serves it: a number, or the decimal string SQL returned. */
  executionPercentage: number | string | null | undefined
  gapPoints: number | null | undefined
  aheadOfProgress: boolean | null | undefined
  thresholdPoints: number | null | undefined
}

export interface SpendVsProgressDescription {
  /** The short phrase beside the figure. */
  label: string
  /** Why it reads that way — always present, so a blank is never left to interpretation. */
  why: string
  /** True only for a flag the view actually raised. Never true for a null. */
  exception: boolean
  /** True when the comparison could not be made at all. */
  notCompared: boolean
}

export function describeSpendVsProgress(input: SpendVsProgressInput): SpendVsProgressDescription {
  const progress = input.physicalProgressPercent
  const execution = input.executionPercentage
  const gap = input.gapPoints
  const ahead = input.aheadOfProgress
  const threshold = input.thresholdPoints

  if (ahead === null || ahead === undefined) {
    const reason = progress === null || progress === undefined
      ? 'no physical progress has been recorded for this project, so there is nothing to compare '
        + 'the spend with (decision D12).'
      : execution === null || execution === undefined
        ? 'nothing has been allocated to this project, so its financial execution is not defined '
          + 'and the comparison cannot be made.'
        : threshold === null || threshold === undefined
          ? 'the council has not configured a spend-versus-progress threshold '
            + '(finance.setting project.spend_ahead_of_progress_points), so no figure counts as an '
            + 'exception yet.'
          : 'the view could not evaluate the comparison.'
    return {
      label: 'not compared',
      why: `Not compared: ${reason} This is not a statement that the spend is in order.`,
      exception: false,
      notCompared: true,
    }
  }

  const gapText = gap === null || gap === undefined
    ? 'the gap is not reported'
    : `${gap > 0 ? '+' : ''}${gap} percentage points of spend over reported completion`
  const thresholdText = threshold === null || threshold === undefined
    ? ''
    : ` against a council threshold of ${threshold} points`

  return ahead
    ? {
      label: 'spend ahead of recorded progress',
      why: `Flagged by finance.v_project_performance: ${gapText}${thresholdText}. It is a question `
        + 'to ask, not a finding.',
      exception: true,
      notCompared: false,
    }
    : {
      label: 'within recorded progress',
      why: `Compared: ${gapText}${thresholdText}.`,
      exception: false,
      notCompared: false,
    }
}
