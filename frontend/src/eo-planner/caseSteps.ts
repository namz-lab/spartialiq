/**
 * Where a case is on its road, in the steps the EO sees (working workflow, section 5). Pure: no Vue, no requests.
 *
 * The statuses are the server's; the two facts that are not in a status (the committee has resolved, the applicant has been notified)
 * come from the lane and the permit. The step is only ever read from the council's record.
 */

export interface CaseStep {
  key: string
  /** Short label for the stepper. */
  label: string
  /** Who normally does it, so the EO knows whether the next move is theirs. */
  owner: 'clerk' | 'planner' | 'committee' | 'eo' | 'applicant'
}

export const CASE_STEPS: readonly CaseStep[] = [
  { key: 'registered',   label: 'Registered',          owner: 'clerk' },
  { key: 'acknowledged', label: 'Acknowledged',        owner: 'clerk' },
  { key: 'circulated',   label: 'Circulated and noticed', owner: 'planner' },
  { key: 'assessed',     label: 'Assessed',            owner: 'planner' },
  { key: 'committee',    label: 'Committee resolved',  owner: 'committee' },
  { key: 'decided',      label: 'Decided',             owner: 'eo' },
  { key: 'notified',     label: 'Applicant notified',  owner: 'eo' },
]

export interface CaseStepInput {
  status: string
  /** The committee has recorded a resolution on this case. */
  committeeResolved?: boolean
  /** The applicant has been formally notified of the decision (the appeal window runs from it). */
  notified?: boolean
  /** The council has recorded an acknowledgement. When false, the "Acknowledged" step was skipped, whatever the status says. */
  acknowledged?: boolean
}

export interface CaseStepState {
  /** 0-based index into CASE_STEPS of the step the case has reached; -1 before registration (awaiting payment). */
  index: number
  /** The step the case is at, or null before registration. */
  current: CaseStep | null
  /** The step that comes next, or null when there is none (notified, appealed, withdrawn). */
  next: CaseStep | null
  /** A word for the end states the steps do not describe. */
  note: string | null
  /** Steps the case has passed in status but not in fact (a case moved on without being acknowledged). They are not shown as done. */
  skipped: string[]
}

const at = (key: string) => CASE_STEPS.findIndex((s) => s.key === key)

export function caseStep(i: CaseStepInput): CaseStepState {
  const status = i.status
  let index: number
  let note: string | null = null
  switch (status) {
    case 'pending_payment': index = -1; note = 'Waiting for the fee'; break
    case 'registered': index = at('registered'); break
    case 'acknowledged': index = at('acknowledged'); break
    case 'circulation':
    case 'objection_period': index = at('circulated'); break
    case 'under_review':
    case 'awaiting_eo_decision':
    case 'deferred':
      index = i.committeeResolved ? at('committee') : at('assessed')
      if (status === 'deferred') note = 'Deferred'
      break
    case 'approved':
    case 'approved_with_conditions':
    case 'refused':
      index = i.notified ? at('notified') : at('decided')
      break
    case 'appealed': index = at('notified'); note = 'Under appeal'; break
    case 'withdrawn': index = -1; note = 'Withdrawn'; break
    default: index = -1
  }
  const current = index >= 0 ? CASE_STEPS[index] : null
  const ended = status === 'withdrawn' || status === 'appealed' || (index === at('notified'))
  const next = !ended && index + 1 < CASE_STEPS.length ? CASE_STEPS[index + 1] : null
  const skipped = i.acknowledged === false && index > at('registered') ? ['acknowledged'] : []
  if (skipped.length && !note) note = 'Not acknowledged: the clock under the Act has not started'
  return { index, current, next, note, skipped }
}

/** The next date to work to, from the server's milestones: the first one not yet past. */
export interface Milestones { ask_extension_by: string; resolve_by: string; deemed_on: string }

export function nextDate(m: Milestones | null | undefined, today: string): { label: string; date: string; days: number } | null {
  if (!m) return null
  const list: { label: string; date: string }[] = [
    { label: 'Ask for an extension by', date: m.ask_extension_by },
    { label: 'Committee to resolve by', date: m.resolve_by },
    { label: 'Deemed refused on', date: m.deemed_on },
  ]
  const day = 86_400_000
  const t = Date.parse(today + 'T00:00:00Z')
  for (const x of list) {
    const d = Date.parse(x.date + 'T00:00:00Z')
    if (d >= t) return { label: x.label, date: x.date, days: Math.round((d - t) / day) }
  }
  const last = list[list.length - 1]
  return { label: last.label, date: last.date, days: Math.round((Date.parse(last.date + 'T00:00:00Z') - t) / day) }
}
