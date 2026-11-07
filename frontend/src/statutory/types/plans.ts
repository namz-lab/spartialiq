// src/statutory/types/plans.ts
// ─────────────────────────────────────────────────────────────────────────
// Plan domain — Parts II (regional) & IV (master/local). RTCP Act [Ch. 29:12].
// Lifecycle follows ss7/16/19 (preparation → exhibition → objections →
// submission → approval → operative) and s71 (validity/operation); alteration
// and repeal per s20. Pure data.
// ─────────────────────────────────────────────────────────────────────────

import type { GeomRef, AuditEntry, StatutoryDate, Money } from './common'

export type PlanKind = 'regional' | 'master' | 'local'

export type PlanStatus =
  | 'draft'        // under preparation (ss6/13/17)
  | 'exhibition'   // public exhibition / publicity (ss7/15/18)
  | 'objections'   // objections & representations period (s19)
  | 'submitted'    // submitted for approval / determination (ss7/16)
  | 'approved'     // approved by authority/Minister
  | 'operative'    // in force (s71)
  | 'altered'      // altered (s20)
  | 'repealed'     // repealed/replaced (s20)

/** Ordered lifecycle used by advanceStatus(); 'altered'/'repealed' branch from 'operative'. */
export const PLAN_LIFECYCLE: PlanStatus[] = ['draft', 'exhibition', 'objections', 'submitted', 'approved', 'operative']

export interface Phase { name: string; from?: StatutoryDate; to?: StatutoryDate; priority?: number }

export interface WrittenStatement { sections: { heading: string; body: string }[] }

export interface Objection {
  id: string
  objector: string
  text: string
  representation?: boolean   // representation (supportive) vs objection
  status: 'open' | 'withdrawn' | 'referred_admin_court' | 'upheld' | 'rejected'   // s19
  receivedAt?: StatutoryDate
  /** Planner's response, carried into the report on objections. */
  response?: string
  /** Recommended change to the plan, or 'no change'. */
  recommendation?: string
}

/** One topic of the study of the planning area (ss13/17), kept up to date. */
export interface StudyTopic { topic: string; findings: string; source?: string; reviewedAt?: StatutoryDate }

/** A consultation event during plan preparation. */
export interface PlanConsultation { id: string; date: StatutoryDate; stakeholder: string; method: string; summary: string }

export interface PlanBase {
  id: string
  kind: PlanKind
  name: string
  authorityId: string
  status: PlanStatus
  effectiveDate?: StatutoryDate                 // set when operative (s71)
  writtenStatement: WrittenStatement
  maps: GeomRef[]                               // PostGIS layer refs (proposals map)
  exhibition?: { from: StatutoryDate; to: StatutoryDate; place: string }   // ss7/15/18 publicity
  objections: Objection[]
  consultationLog: AuditEntry[]
  audit: AuditEntry[]
  study?: StudyTopic[]
  consultations?: PlanConsultation[]
  /** Report on objections, recorded when produced (precondition for submission). */
  objectionsReportAt?: StatutoryDate
}

export interface RegionalPlan extends PlanBase {
  kind: 'regional'
  phasing: Phase[]
  costEstimates: Money[]
  priorities: string[]
}
export interface MasterPlan extends PlanBase {
  kind: 'master'
  scenicAreas: GeomRef[]
  priorityAreas: GeomRef[]
  neighbourRelations: string[]
}
export interface LocalPlan extends PlanBase {
  kind: 'local'
  parentMasterPlanId?: string
  measures: string[]
  phasing: Phase[]
}

export type AnyPlan = RegionalPlan | MasterPlan | LocalPlan

/** Result of a plan-conflict check (ss9/21). */
export interface PlanConflict {
  severity: 'info' | 'warning' | 'error'
  winningInstrument: string
  reason: string
}
