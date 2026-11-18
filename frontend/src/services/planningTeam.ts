// The EO Planning's team at a glance (GET /api/units/planning/team): one summary per desk under the Executive
// Officer (Planning). The EO and the Chief Executive may read it; the server refuses everyone else.
// Every desk obeys the overview's honesty rule: `loaded: false` with a `note`, never a row of zeros.
import api from './api'
import type { SectionState } from './executiveOverview'

export interface ClerkDesk extends SectionState {
  applications?: number
  received_this_month?: number
  awaiting_fee?: number
  to_acknowledge?: number
  decisions_to_send?: number
  objection_periods_running?: number
  objection_periods_to_close?: number
}

export interface PlannersDesk extends SectionState {
  in_hand?: number
  unassigned?: number
  due_soon?: number
  overdue?: number
  with_the_eo?: number
  objections_to_consider?: number
  replies_overdue?: number
  referrals_overdue?: number
}

export interface InspectorsDesk extends SectionState {
  booked?: number
  without_inspector?: number
  past_their_date?: number
  done_this_month?: number
  complaints_open?: number
  complaints_unassigned?: number
  enforcement_open?: number
}

export interface EnvironmentalHealthDesk extends SectionState {
  premises?: number
  certificates_expired?: number
  certificates_due?: number
  nuisance_open?: number
  follow_ups_past?: number
}

export interface GisSurveyDesk extends SectionState {
  tasks_open?: number
  tasks_overdue?: number
  awaiting_review?: number
  returned?: number
  parcels?: number
  outlines_estimated?: number
}

export interface PlanningTeam {
  as_of: string
  /** The days before the determination deadline at which a case counts as "due soon". */
  warning_days: number
  desks: {
    clerk: ClerkDesk
    planners: PlannersDesk
    inspectors: InspectorsDesk
    environmental_health: EnvironmentalHealthDesk
    gis_survey: GisSurveyDesk
  }
}

export const planningTeamApi = {
  async read(): Promise<PlanningTeam> {
    const res = await api.get<{ success: boolean; data: PlanningTeam }>('/units/planning/team')
    return res.data.data
  },
}
