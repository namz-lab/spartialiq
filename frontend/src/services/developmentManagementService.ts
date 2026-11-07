/**
 * Development Management (Control) Handbook 2021 v1.2
 * Client-side service for all 26 backend endpoints in /api/development-management.js
 */
import api from './api'
import { isQuietApiFailure } from '@/utils/apiNoise'

// ─── Shared types ──────────────────────────────────────────────────────────

export type PermitStatus =
  // Canonical backend statuses (permit_application CHECK, migrations 070 + 085):
  | 'pending_payment' | 'registered' | 'acknowledged' | 'circulation'
  | 'objection_period' | 'under_review' | 'awaiting_eo_decision' | 'deferred'
  | 'approved' | 'approved_with_conditions' | 'refused' | 'withdrawn' | 'appealed'
  // Legacy aliases still referenced in places (normalised by useApplicationPipeline):
  | 'pending_docs' | 'consultation' | 'appeal' | 'conditionally_approved' | 'lapsed'

// DM Handbook application types — must match the backend's VALID_TYPES on
// POST /api/permit-applications.
export type DevType =
  | 'new_building' | 'alteration' | 'extension' | 'change_of_use'
  | 'subdivision' | 'consolidation' | 'rezoning' | 'other'

export interface PermitApplication {
  id: string
  tpd_reference: string | null
  dev_register_no: string | null
  stand_number: string
  suburb_ward: string
  /**
   * permit_application.street_address (migration 070). Returned by getPermit's
   * SELECT *, but absent from v_application_summary — so it is present on a
   * single permit fetch and undefined on list endpoints.
   */
  street_address?: string | null
  applicant_name: string
  applicant_id_number: string
  applicant_phone: string | null
  applicant_email: string | null
  development_type: DevType
  description: string | null
  status: PermitStatus
  fee_paid: boolean
  received_at: string | null
  /** When the council acknowledged receipt — the start of the three-month clock (s.26(7)). */
  acknowledged_at?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Centroid from permit_application.location, surfaced by v_application_summary
  // (migration 081). Null when the permit has no stored location.
  lng?: number | null
  lat?: number | null
  // Planner case-file fields (migration 082). Persisted on the permit so the
  // planning record is the shared system-of-record, not browser localStorage.
  estimated_cost?: number | null
  plinth_area?: number | null
  floors?: number | null
  parking_bays?: number | null
  title_deed_no?: string | null
  classification?: string | null
  recommendation?: string | null
  recommendation_reasons?: string | null
  due_diligence?: unknown | null
  committee_report?: unknown | null
  zoning_assessment?: unknown | null
  permit_conditions?: unknown | null
  assigned_to?: string | null
  statutory_due_date?: string | null
  // Optimistic-lock counter (migration 097). The /case and /status PATCH routes
  // REQUIRE the caller's expectedRevision to match this before writing, and bump
  // it by 1 on success. A mismatch is a 409 conflict, not a silent overwrite.
  revision?: number
  // Determination columns, written by PATCH /status and POST /eo-decision.
  decision_at?: string | null
  decision_officer?: string | null
  decision_conditions?: string | null
  has_occupation_certificate?: boolean
}

/** A 409 from an optimistic-lock check: someone else saved since we loaded. */
export function isConflictError(e: unknown): boolean {
  const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response
  return r?.status === 409 && r?.data?.error === 'conflict'
}

/** The server's current permit row, returned alongside a 409 when available. */
export function conflictPermit(e: unknown): PermitApplication | null {
  return (e as { response?: { data?: { data?: PermitApplication } } })
    ?.response?.data?.data ?? null
}

export interface PermitListParams {
  status?: PermitStatus
  development_type?: DevType
  search?: string
  limit?: number
  offset?: number
}

/** GET /permit-applications clamps `limit` to this. */
export const PERMIT_PAGE_MAX = 200

export interface PermitListResponse {
  data: PermitApplication[]
  total: number
  limit: number
  offset: number
}

export interface Consultation {
  id: string
  permit_application_id: string
  department: string
  contacted_at: string
  response_received_at: string | null
  response: string | null
  outcome: 'pending' | 'no_objection' | 'objection' | 'conditional'
  notes: string | null
  created_at: string
  // Canonical backend columns (spatial_planning.application_consultation).
  // The fields above are a normalised legacy shape; these are what the API
  // actually returns and what the planner console maps referrals from.
  permit_app_id?: string
  body_name?: string
  response_status?: 'pending' | 'no_objection' | 'objection' | 'conditional_approval' | 'no_response'
  response_notes?: string | null
  response_received_at_date?: string | null
  response_document_url?: string | null
  assigned_to?: string | null
  // Task model (migrations 085 + 090).
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  task_status?: 'open' | 'in_progress' | 'responded' | 'accepted' | 'returned' | 'cancelled'
  task_type?: string | null
  response_due_at?: string | null
  circulated_at?: string | null
  blocking?: boolean
  escalated_at?: string | null
}

export interface PermitEvent {
  id: string
  event_type: string
  actor_id: string | null
  actor_role: string | null
  actor_name: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

// Committee meetings & agenda (migration 083).
export interface CommitteeMeeting {
  id: string
  title: string
  meeting_date: string
  location: string | null
  status: 'scheduled' | 'held' | 'cancelled'
  notes: string | null
  item_count?: number
  /** Members who must be present for a resolution to stand. Null = not set. */
  quorum?: number | null
  /** Members recorded present, counted by the server (migration 104). */
  present_count?: number
  created_at: string
}

/** A standing member of the committee — often a councillor with no login. */
export interface CommitteeMember {
  id: string
  full_name: string
  title: string | null
  user_id: string | null
  active: boolean
  created_at: string
}

export type AttendanceStatus = 'present' | 'apology' | 'absent'

export interface MeetingAttendance {
  id: string
  member_id: string
  status: AttendanceStatus
  recorded_at: string
  full_name?: string
  title?: string | null
}

export interface AgendaItem {
  id: string
  meeting_id: string
  permit_app_id: string
  purpose: 'determination' | 'consideration' | 'deputation' | 'noting'
  outcome: 'pending' | 'approved' | 'approved_with_conditions' | 'refused' | 'deferred' | 'noted'
  resolution: string | null
  heard_at: string | null
  // joined permit fields when listed by meeting:
  dev_register_no?: string | null
  stand_number?: string
  applicant_name?: string
}

export interface PermitMeeting {
  agenda_item_id: string
  purpose: string
  outcome: string
  resolution: string | null
  heard_at: string | null
  meeting_id: string
  title: string
  meeting_date: string
  location: string | null
  meeting_status: string
}

export interface Objection {
  id: string
  permit_application_id: string
  objector_name: string
  objector_contact: string | null
  grounds: string
  received_at: string
  resolved_at: string | null
  resolution: string | null
  created_at: string
  // Canonical spatial_planning.application_objection columns (migration 070/089).
  permit_app_id?: string
  objector_address?: string | null
  grounds_detail?: string | null
  document_url?: string | null
  sustained?: boolean | null
  consideration_notes?: string | null
  considered_at?: string | null
  resolution_document_url?: string | null
}

// Section 26(3) public-notification record (migration 089). One per permit.
export interface PublicNotice {
  id: string
  permit_app_id: string
  advert_verified: boolean
  advert_reference: string | null
  advert_verified_at: string | null
  abutting_owners_verified: boolean
  abutting_owners_verified_at: string | null
  site_notice_verified: boolean
  site_notice_verified_at: string | null
  objection_period_start: string | null
  objection_period_end: string | null
  objection_period_closed: boolean
  objection_period_closed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type PublicNoticeStep =
  | 'advert' | 'abutting_owners' | 'site_notice'
  | 'objection_period_closed' | 'set_period' | 'notes'

export interface EnforcementOrder {
  id: string
  order_reference: string
  permit_application_id: string | null
  stand_number: string
  suburb_ward: string | null
  owner_name: string
  owner_contact: string | null
  // DM Handbook fields — what the backend's POST /enforcement-orders requires
  // and what its SELECT returns from spatial_planning.enforcement_order. The
  // owner_* names above predate the schema and are kept for older surfaces.
  subject_name?: string
  subject_address?: string
  // The DB CHECK constraint allows only the second group (enforcement_notice …
  // reinstatement). The first group is legacy frontend vocabulary kept for
  // older surfaces that still pass these values around client-side.
  order_type:
    | 'stop_work' | 'demolition' | 'rectification' | 'removal' | 'cessation'
    | 'enforcement_notice' | 'stop_notice' | 'breach_of_condition'
    | 'retrospective_consent' | 'reinstatement'
  breach_description: string
  required_action: string
  compliance_period: number
  issued_at: string
  status:
    | 'draft' | 'issued' | 'served' | 'complied' | 'non_complied' | 'withdrawn' | 'appealed'
    | 'active' | 'extended' | 'cancelled'
  notes: string | null
  latitude: number | null
  longitude: number | null
  created_at: string
  updated_at: string
  /** Set by PATCH /status when the order is marked served. */
  served_at?: string | null
  compliance_due_at?: string | null
  permit_app_id?: string | null
}

export interface ProhibitionOrder {
  id: string
  order_reference: string
  enforcement_order_id: string | null
  permit_application_id: string | null
  stand_number: string
  // POST /prohibition-orders requires these four (subject_name, subject_address,
  // prohibited_activity, reason); the table stores them NOT NULL.
  subject_name: string
  subject_address: string
  prohibited_activity: string
  reason: string
  issued_by: string | null
  issued_at: string
  lifted_at: string | null
  notes: string | null
  created_at: string
}

// spatial_planning.building_plan (migration 070), exactly as the routes return
// it. This type previously described columns the table never had
// (review_notes, reviewed_at) and statuses its CHECK rejects
// (under_review, approved_with_conditions), so appraisal notes were dropped by
// the server and two of the three appraisal buttons returned 400.
export type BuildingPlanStatus =
  | 'submitted' | 'under_appraisal' | 'approved' | 'approved_with_amendments'
  | 'rejected' | 'resubmitted'

export interface BuildingPlan {
  id: string
  permit_app_id: string
  revision: number
  revision_label: string | null
  plan_document_url: string
  site_plan_url?: string | null
  structural_drawings_url?: string | null
  services_drawings_url?: string | null
  architect_name: string | null
  architect_reg_no: string | null
  engineer_name: string | null
  engineer_reg_no: string | null
  gross_floor_area_sqm?: number | string | null
  number_of_storeys?: number | null
  building_use?: string | null
  submitted_at?: string | null
  status: BuildingPlanStatus
  appraised_by: string | null
  appraised_at: string | null
  appraisal_notes: string | null
  created_at: string
  updated_at: string
}

/** Roles the appraisal route accepts (PATCH /building-plans/:id/appraisal). */
export const BUILDING_PLAN_APPRAISERS = ['building_inspector', 'admin'] as const

export function isBuildingPlanApproved(status: BuildingPlanStatus): boolean {
  return status === 'approved' || status === 'approved_with_amendments'
}

export interface InspectionStage {
  stage_number: number
  stage_name: string
  description: string | null
  prerequisites: number[]
}

export interface ChecklistItem {
  /**
   * spatial_planning.checklist_item.id — SERIAL, therefore an integer (1–38).
   * The write endpoint rejects anything failing Number.isInteger with
   * 400 bad_result_entry, so this must not be widened to string.
   */
  id: number
  code: string
  description: string
  applicable_stages: number[]
  is_mandatory: boolean
  category_code: string
  category_label: string
}

export interface StageInspection {
  id: string
  /**
   * The API returns `SELECT si.*`, so this is the real column name
   * spatial_planning.stage_inspection.permit_app_id. It was previously declared
   * as `permit_application_id`, which is never present on the wire and therefore
   * always read back undefined.
   */
  permit_app_id: string
  stage_number: number
  stage_name: string
  attempt: number
  scheduled_at: string | null
  inspected_at: string | null
  inspector_name: string | null
  stamp_reference: string | null
  result: 'pass' | 'fail' | 'conditional_pass' | 'reinspection_required' | null
  overall_result: string | null
  notes: string | null
  photo_urls: string[]
  created_at: string
  updated_at: string
}

/**
 * One row of spatial_planning.v_inspector_queue (migration 116): the permit, its
 * latest stage_inspection attempt, and the booking that scheduled it. Field names
 * mirror the view exactly — nothing here is synthesised on the client.
 */
export interface InspectorQueueRow {
  permit_app_id: string
  dev_app_id: string | null
  tpd_reference: string | null
  dev_register_no: string | null
  stand_number: string | null
  suburb_ward: string | null
  street_address: string | null
  applicant_name: string
  development_type: string
  description: string | null
  permit_status: string
  permit_assigned_to: string | null
  statutory_due_date: string | null
  received_at: string | null
  permit_updated_at: string | null
  lng: number | null
  lat: number | null

  // Official inspection record (null until a stage inspection is opened).
  stage_inspection_id: string | null
  stage_number: number | null
  attempt: number | null
  inspector_id: string | null
  scheduled_at: string | null
  inspected_at: string | null
  assigned_at: string | null
  assigned_by: string | null
  result: 'pass' | 'fail' | 'conditional_pass' | 'reinspection_required' | null

  // Scheduling/payment context only.
  booking_id: string | null
  booking_application_id: string | null
  booking_status: string | null
  booking_scheduled_for: string | null
  fee_paid_at: string | null

  has_occupation_certificate: boolean
  effective_scheduled_at: string | null
  is_overdue: boolean
}

export type InspectorQueueBucket =
  | 'today' | 'overdue' | 'upcoming' | 'followup' | 'failed' | 'unscheduled' | 'completed'

export interface InspectorQueueQuery {
  bucket?: InspectorQueueBucket
  scope?: 'unassigned'
  inspector?: string | 'me'
  status?: string
  result?: string
  stage?: number
  ward?: string
  booking_status?: string
  /** YYYY-MM-DD */
  from?: string
  /** YYYY-MM-DD */
  to?: string
  search?: string
  limit?: number
  offset?: number
}

export interface InspectorQueuePage {
  data: InspectorQueueRow[]
  total: number
  limit: number
  offset: number
}

export interface InspectorQueueSummary {
  today: number
  overdue: number
  upcoming: number
  followup: number
  failed: number
  unscheduled: number
  completed: number
  total: number
}

/**
 * Field activity for a stage inspection (migration 117).
 * assigned -> travelling -> arrived -> inspection_started -> inspection_completed.
 * An append-only log: the canonical stage_inspection.result vocabulary must not
 * absorb movement states.
 */
export type FieldEventType =
  | 'travelling' | 'arrived' | 'inspection_started' | 'inspection_completed'

export interface FieldEvent {
  id: string
  stage_inspection_id: string
  event_type: FieldEventType
  recorded_at: string
  recorded_by: string | null
  recorded_by_name?: string | null
  /**
   * NUMERIC over the wire arrives as a string from Postgres. Null is a genuine,
   * common answer — GPS is frequently unavailable on site and is never faked.
   */
  observed_lat: number | string | null
  observed_lng: number | string | null
  accuracy_m: number | string | null
  note: string | null
  /**
   * Server-computed geofence against the resolved site (migration 118), frozen
   * at write time. Null when the event carried no fix. The client never sends these.
   */
  site_distance_m?: number | null
  geofence_result?: 'on_site' | 'off_site' | 'unverifiable' | null
  site_precision?: 'boundary' | 'point' | 'area' | 'none' | null
}

export interface InspectionChecklistResult {
  /** Matches ChecklistItem.id — integer, validated server-side. */
  checklist_item_id: number
  /**
   * 'not_inspected' is a DRAFT mark (migration 117): the item has not been
   * assessed yet. It is persisted so an interrupted site visit survives, is
   * excluded from scoring, and suppresses the computed stage result until
   * cleared — so saving a draft can never stamp an official verdict.
   */
  result: 'pass' | 'fail' | 'na' | 'not_inspected'
  notes: string | null
  // Inspector-assigned 0–10 score. Required unless the item is 'na' or
  // 'not_inspected'. The *system* — not the inspector — uses these to compute
  // the overall stage result. Anti-corruption: the inspector cannot override.
  score?: number | null
  // UUID of a stage_inspection_photo captured specifically for this item.
  photo_id?: string | null
}

// System-computed scoring summary for a stage inspection.
export interface StageScoring {
  stage_inspection_id: string
  item_count: number
  scored_count: number
  photo_count: number
  /**
   * Items still marked not_inspected (migration 117). While this is > 0 the
   * checklist is a draft and computed_result is NULL — the stage is deliberately
   * left without an official verdict.
   */
  outstanding_count: number
  avg_score: number | null
  min_score: number | null
  max_score: number | null
  computed_result: 'pass' | 'fail' | 'conditional_pass' | 'reinspection_required' | null
}

export interface OccupationCertificate {
  id: string
  permit_application_id: string
  certificate_no: string
  /** users.id of the issuing officer — an identifier, not a display name. */
  issued_by: string | null
  issued_at: string
  /**
   * Legacy field. spatial_planning.occupation_certificate has no conditions
   * column; conditions and the joint-inspection record are stored in `notes`.
   */
  conditions?: string | null
  notes?: string | null
  occupant_name?: string | null
  building_use?: string | null
  gross_floor_area_sqm?: number | string | null
  created_at: string
}

// ─── Phase 4b — Stage Inspection Photos & Flags ───────────────────────────

export interface StageInspectionPhoto {
  id: string
  stage_inspection_id: string
  storage_url: string
  mime_type: string
  bytes: number
  sha256_hex: string
  caption: string | null
  taken_at: string | null
  taken_lng: number | null
  taken_lat: number | null
  uploaded_by: string | null
  created_at: string
}

export type FlagReasonCode =
  | 'work_not_done'
  | 'work_not_to_standard'
  | 'photos_dont_match_site'
  | 'safety_issue_missed'
  | 'measurements_incorrect'
  | 'fraudulent_pass'
  | 'absent_during_inspection'
  | 'other'

export interface StageInspectionFlag {
  id: string
  stage_inspection_id: string
  reason_code: FlagReasonCode
  description: string
  evidence_photo_ids: string[]
  flagged_by: string
  flagged_by_role: string
  flagged_by_name?: string | null
  status: 'open' | 'under_review' | 'upheld' | 'dismissed' | 'withdrawn'
  resolution_notes: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  stage_number?: number
}

// ─── EO Planner — Decision Workspace (migrations 085 + 086) ─────────────────
// One authoritative review surface: the assembled decision package, the
// federated specialist findings, the case thread, and the EO determination /
// return / request-info actions.

// A row of v_eo_decision_queue — the EO inbox (GET /eo-planner/cases).
export interface EoCase {
  id: string
  dev_register_no: string | null
  tpd_reference: string | null
  stand_number: string
  suburb_ward: string | null
  applicant_name: string
  development_type: DevType
  description: string | null
  status: PermitStatus
  fee_paid: boolean
  received_at: string | null
  statutory_due_date: string | null
  recommendation: string | null
  created_at: string
  updated_at: string
  lng: number | null
  lat: number | null
  handoff_id: string | null
  handoff_status: 'submitted' | 'accepted' | 'returned' | 'decided' | null
  handoff_recommendation: string | null
  handoff_submitted_by: string | null
  handoff_submitted_at: string | null
  returned_to_role: string | null
  days_to_deemed: number | null
}

// A row of v_specialist_findings — every officer's finding in one shape.
export interface SpecialistFinding {
  permit_app_id: string
  finding_type: 'consultation' | 'survey' | 'inspection' | 'plan_review'
  source_id: string
  source_label: string
  specialist_id: string | null
  specialist_name: string | null
  outcome: string | null
  summary: string | null
  task_status: string | null
  priority: string | null
  received_at: string | null
  created_at: string
}

export interface CaseMessage {
  id: string
  permit_app_id: string
  author_id: string | null
  author_role: string | null
  author_name: string | null
  message_type: 'internal_note' | 'citizen_message' | 'specialist_comment' | 'decision_comment' | 'document_request'
  visibility: 'internal' | 'specialist' | 'citizen' | 'public'
  body: string
  created_at: string
  edited_at: string | null
}

export interface EoHandoffPackage {
  id: string
  permit_app_id: string
  submitted_by: string | null
  recommendation: string | null
  reasons: string | null
  conditions: unknown
  attachments: unknown
  findings_snapshot: unknown
  status: 'submitted' | 'accepted' | 'returned' | 'decided'
  eo_decision: string | null
  eo_notes: string | null
  decided_by: string | null
  decided_at: string | null
  returned_to_role: string | null
  return_reason: string | null
  created_at: string
  updated_at: string
}

export interface GeneratedDocumentRef {
  id: string
  doc_type: string
  title: string | null
  storage_url: string | null
  mime_type: string
  version: number
  created_at: string
  generated_by_name?: string | null
}

// A generated document including its rendered body (GET /generated-documents/:id).
export interface GeneratedDocument extends GeneratedDocumentRef {
  permit_app_id: string
  content: string | null
  bytes: number | null
  sha256_hex: string | null
  payload: unknown
}

// A structured condition of approval (permit_application.permit_conditions).
export interface PermitCondition {
  id?: string
  text: string
  [k: string]: unknown
}

// The assembled GET /permit-applications/:id/decision-package payload.
export interface DecisionPackage {
  permit: PermitApplication
  recommendation: { value: string | null; reasons: string | null }
  due_diligence: unknown | null
  committee_report: unknown | null
  zoning_assessment: unknown | null
  proposed_conditions: PermitCondition[] | unknown
  findings: SpecialistFinding[]
  objections: Objection[]
  objection_summary: { total: number; sustained: number; pending: number }
  consultations: Consultation[]
  building_plans: BuildingPlan[]
  documents: GeneratedDocumentRef[]
  handoff: EoHandoffPackage | null
  events_recent: PermitEvent[]
}

export type EoDecisionAction = 'approve' | 'approve_with_conditions' | 'refuse'
export type ReturnRole = 'planner' | 'gis_officer' | 'surveyor' | 'env_officer' | 'building_inspector'

// Application documents attached to a permit (site plan, building plan, title
// deed, consent letters …). Uploaded by the citizen at submission and read by
// the planner/clerk completeness review. Distinct from the identity-document
// queue in services/documentsService.ts (/documents) — these are permit-scoped.
export interface PermitDocument {
  id: string
  permit_application_id: string
  doc_type: string
  file_name: string
  storage_url: string | null
  mime_type: string | null
  bytes: number | null
  uploaded_by: string | null
  uploaded_at: string
}

// Statutory appeal against a determination (RTCP Act s.38). Lodged by the
// appellant, processed and decided by council staff — the appellant never
// advances the status.
//
// These names are the column names in spatial_planning.application_appeal
// (migration 070) and its CHECK constraints, not a parallel vocabulary: the
// earlier set ('filed' / 'admitted' / 'heard') could never have been written
// to the table, which is one reason nothing ever served this register.
export type AppealStatus =
  | 'lodged' | 'acknowledged' | 'hearing_scheduled' | 'decided' | 'withdrawn'

/** What the Administrative Court held. */
export type AppealDecision = 'upheld' | 'dismissed' | 'remitted'

export type AppellantType = 'applicant' | 'objector' | 'third_party'

export interface Appeal {
  id: string
  permit_application_id: string
  appellant_type: AppellantType
  appellant_name: string
  appellant_address: string | null
  grounds: string
  lodged_at: string
  document_url: string | null
  status: AppealStatus
  hearing_date: string | null
  decision: AppealDecision | null
  decision_notes: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
  // Denormalised by the backend so a register row needs no second query:
  dev_register_no: string | null
  tpd_reference: string | null
  stand_number: string | null
  suburb_ward: string | null
  applicant_name: string | null
  permit_status: string | null
  permit_decided_at: string | null
  /** Days between the determination and the lodging. Null when undetermined. */
  days_after_decision: number | null
  /** Lodged inside the one-month s.38 window. Null when it cannot be computed. */
  within_window: boolean | null
}

export interface AppealInput {
  grounds: string
  /** Defaults to the signed-in appellant for a citizen; required from staff. */
  appellant_name?: string
  appellant_type?: AppellantType
  appellant_address?: string | null
  /** `YYYY-MM-DD`. Defaults to today — a counter lodging can be back-dated. */
  lodged_at?: string | null
  hearing_date?: string | null
  document_url?: string | null
}

export interface AppealListParams {
  status?: AppealStatus
  decision?: AppealDecision
  permit_application_id?: string
  /** Everything not yet decided or withdrawn. */
  open?: boolean
  search?: string
  limit?: number
  offset?: number
}

/** Staff-side progress on an appeal: acknowledge, set a hearing, record it. */
export interface AppealPatch {
  status: AppealStatus
  hearing_date?: string | null
  /** Required when status is 'decided'. */
  decision?: AppealDecision | null
  notes?: string | null
}

// ─── Phase 1 — Permit Applications ────────────────────────────────────────

/** What a plan decides for one land use on one zone, as computed and stored by the server. */
export interface RuleSnapshotResult {
  plan: { id: string; title: string; version: number; status: string; authority: string | null; provisional?: boolean }
  zone: { id: number; name: string; type_code: string | null; review_status?: 'unreviewed' | 'in_review' | 'reviewed'; reviewed_by?: string | null }
  governing: boolean
  share_pct: number | null
  land_use: { code: string; description: string } | null
  /** null = not decided (or the plan has no such land use) — never "allowed". */
  decision: 'permitted' | 'special_consent' | 'prohibited' | null
  conditions: string | null
  pathway: { code: string; name: string; objection_days: number | null; decision_body: string | null } | null
  standards: Array<{ kind: string; name: string; unit: string; min: number | null; max: number | null }>
}
export interface RuleSnapshot {
  computed_at: string
  parcel: { layer: string; id: string }
  land_use_code: string | null
  unzoned: boolean
  /** Some plan that governs the parcel is not in force: the rules recorded are a draft. */
  provisional?: boolean
  results: RuleSnapshotResult[]
}

export const dmApi = {
  /** Staff: compute and store the rules for the land use the planner picked (append-only). */
  async takeRuleSnapshot(permitId: string, landUseCode: string): Promise<RuleSnapshot> {
    const r = await api.post(`/permit-applications/${permitId}/rule-snapshot`, { land_use_code: landUseCode })
    return r.data.data
  },

  /** Staff: set or correct the parcel a permit concerns. */
  async setPermitParcel(permitId: string, layer: string, id: string): Promise<RuleSnapshot> {
    const r = await api.put(`/permit-applications/${permitId}/parcel`, { layer, id })
    return r.data.data
  },

  async listPermits(params: PermitListParams = {}): Promise<PermitListResponse> {
    const r = await api.get('/permit-applications', { params })
    return r.data
  },

  /**
   * Every application matching the filter, across as many pages as it takes.
   *
   * The server caps a page at PERMIT_PAGE_MAX rows and silently clamps larger
   * limits, so a queue or return built from one `limit: 500` call quietly lost
   * everything past the 200 most recently received. Use this wherever the
   * screen needs the whole set (queues, returns); use listPermits for a page.
   */
  async listAllPermits(params: Omit<PermitListParams, 'limit' | 'offset'> = {}): Promise<PermitApplication[]> {
    const first = await dmApi.listPermits({ ...params, limit: PERMIT_PAGE_MAX, offset: 0 })
    const rest: Promise<PermitListResponse>[] = []
    // ponytail: all remaining pages in parallel; a few thousand rows is ~15
    // requests. Past that, the queues want server-side status/assignee filters.
    for (let offset = PERMIT_PAGE_MAX; offset < first.total; offset += PERMIT_PAGE_MAX) {
      rest.push(dmApi.listPermits({ ...params, limit: PERMIT_PAGE_MAX, offset }))
    }
    const pages = [first, ...await Promise.all(rest)]
    // A row received between page requests shifts the offsets by one; dedupe
    // so it cannot appear twice.
    const seen = new Map<string, PermitApplication>()
    for (const page of pages) for (const p of page.data) seen.set(p.id, p)
    return [...seen.values()]
  },

  async getPermit(id: string): Promise<PermitApplication> {
    const r = await api.get(`/permit-applications/${id}`)
    return r.data?.data ?? r.data
  },

  async createPermit(data: Partial<PermitApplication>): Promise<PermitApplication> {
    const r = await api.post('/permit-applications', data)
    return r.data?.data ?? r.data
  },

  /**
   * Transition a permit's status.
   *
   * `expectedRevision` is REQUIRED by the backend (migration 097): the route
   * rejects a missing one with 400 `expected_revision_required` and a stale one
   * with 409 `conflict`. It is an object parameter rather than a trailing
   * positional so it cannot be silently omitted — every caller must state the
   * revision it last read.
   */
  async setPermitStatus(
    id: string,
    status: PermitStatus,
    opts: {
      expectedRevision: number
      notes?: string
      /** STRUCTURED conditions of approval — the authoritative, enforceable
       *  list that lands on the permit for inspectors and the citizen, not
       *  just the rendered PDF. */
      permitConditions?: unknown
      /** Determination date, `YYYY-MM-DD` (the backend's isDate() guard). */
      decisionAt?: string
    },
  ): Promise<PermitApplication> {
    // The backend status route reads `decision_conditions` (not `notes`); send
    // both so decision notes/conditions are persisted on approve/refuse.
    const r = await api.patch(`/permit-applications/${id}/status`, {
      status,
      notes: opts.notes,
      decision_conditions: opts.notes ?? null,
      permit_conditions: opts.permitConditions ?? undefined,
      decision_at: opts.decisionAt ?? undefined,
      expectedRevision: opts.expectedRevision,
    })
    return r.data?.data ?? r.data
  },

  // Persist the planner's working case file to the permit (migration 082):
  // proposal detail, due-diligence, zoning snapshot, committee report,
  // recommendation, structured conditions, statutory due date, assignment.
  //
  // The patch MUST carry `expectedRevision` (migration 097) — the route 400s
  // with `expected_revision_required` without it. caseToPatch() in
  // usePlannerCase.ts supplies it from the revision the case was loaded at.
  async updateCase(id: string, patch: Record<string, unknown>): Promise<PermitApplication> {
    const r = await api.patch(`/permit-applications/${id}/case`, patch)
    return r.data?.data ?? r.data
  },

  // ── Application documents (permit-scoped) ──────────────────────────────
  // Multipart upload, one file per call so each carries its own doc_type.
  // Citizen submission uploads here; the planner/clerk completeness review
  // reads them back via listPermitDocuments. Mirrors uploadStagePhoto's
  // multipart pattern (omit Content-Type so axios sets the boundary).
  async uploadPermitDocument(
    permitId: string, file: File, docType: string,
  ): Promise<PermitDocument> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('doc_type', docType)
    const r = await api.post(
      `/permit-applications/${encodeURIComponent(permitId)}/documents`,
      fd,
      { headers: { 'Content-Type': undefined as unknown as string } },
    )
    return r.data?.data ?? r.data
  },

  async listPermitDocuments(permitId: string): Promise<PermitDocument[]> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/documents`)
    return r.data?.data ?? r.data ?? []
  },

  // ── Appeals (statutory, against a refusal) ─────────────────────────────
  // Citizen lodges via createAppeal; council reviews/decides via
  // updateAppealStatus. listAppeals serves both: citizens pass { mine:true }
  // (backend also scopes by created_by), staff see the full queue.
  async createAppeal(permitId: string, payload: AppealInput): Promise<Appeal> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/appeals`, payload)
    return r.data?.data ?? r.data
  },

  async listAppeals(params: AppealListParams = {}): Promise<Appeal[]> {
    try {
      const r = await api.get('/appeals', { params })
      return r.data?.data ?? r.data ?? []
    } catch (err) {
      if (isQuietApiFailure(err)) return []
      throw err
    }
  },

  async getAppeal(id: string): Promise<Appeal> {
    const r = await api.get(`/appeals/${encodeURIComponent(id)}`)
    return r.data?.data ?? r.data
  },

  async updateAppealStatus(id: string, patch: AppealPatch): Promise<Appeal> {
    const r = await api.patch(`/appeals/${encodeURIComponent(id)}/status`, patch)
    return r.data?.data ?? r.data
  },

  // Append-only audit trail for a permit (who did what, when, why).
  async listEvents(id: string): Promise<PermitEvent[]> {
    const r = await api.get(`/permit-applications/${id}/events`)
    return r.data?.data ?? r.data ?? []
  },

  // A tasked specialist records their finding, closing the referral loop so
  // the response surfaces back in the planner console.
  async respondConsultation(
    consultationId: string,
    data: { response_status: string; response_notes?: string; response_received_at?: string; response_document_url?: string },
  ): Promise<Consultation> {
    const r = await api.patch(`/consultations/${consultationId}/response`, data)
    return r.data?.data ?? r.data
  },

  // Update a referral's task fields (priority, status, due date, blocking,
  // assignment) or escalate it. EO Planner — Technical Circulation.
  async updateConsultationTask(
    consultationId: string,
    data: {
      priority?: Consultation['priority']
      task_status?: Consultation['task_status']
      response_due_at?: string
      blocking?: boolean
      assigned_to?: string
      escalate?: boolean
    },
  ): Promise<Consultation> {
    const r = await api.patch(`/consultations/${encodeURIComponent(consultationId)}/task`, data)
    return r.data?.data ?? r.data
  },

  // ── Committee meetings & agenda (migration 083) ──────────────────
  async listMeetings(status?: string): Promise<CommitteeMeeting[]> {
    const r = await api.get('/committee-meetings', { params: status ? { status } : {} })
    return r.data?.data ?? r.data ?? []
  },
  async createMeeting(data: {
    title: string; meeting_date: string; location?: string; notes?: string
    /** Members required for a valid resolution (migration 104). */
    quorum?: number
  }): Promise<CommitteeMeeting> {
    const r = await api.post('/committee-meetings', data)
    return r.data?.data ?? r.data
  },
  async scheduleOnAgenda(meetingId: string, data: { permit_app_id: string; purpose?: string }): Promise<AgendaItem> {
    const r = await api.post(`/committee-meetings/${meetingId}/agenda`, data)
    return r.data?.data ?? r.data
  },
  async listAgenda(meetingId: string): Promise<AgendaItem[]> {
    const r = await api.get(`/committee-meetings/${meetingId}/agenda`)
    return r.data?.data ?? r.data ?? []
  },
  async recordAgendaOutcome(agendaItemId: string, data: { outcome?: string; resolution?: string }): Promise<AgendaItem> {
    const r = await api.patch(`/agenda-items/${agendaItemId}`, data)
    return r.data?.data ?? r.data
  },
  async listPermitMeetings(permitId: string): Promise<PermitMeeting[]> {
    const r = await api.get(`/permit-applications/${permitId}/meetings`)
    return r.data?.data ?? r.data ?? []
  },

  // ── Committee roster, attendance and quorum (migration 104) ────────────
  // The tables and routes shipped with 104; nothing in the product called
  // them, so a resolution could be recorded with no record of who sat.
  async listCommitteeMembers(includeInactive = false): Promise<CommitteeMember[]> {
    const r = await api.get('/committee-members', {
      params: includeInactive ? { all: 'true' } : {},
    })
    return r.data?.data ?? r.data ?? []
  },

  async addCommitteeMember(data: { full_name: string; title?: string | null }): Promise<CommitteeMember> {
    const r = await api.post('/committee-members', data)
    return r.data?.data ?? r.data
  },

  /** Soft-retire: attendance history is kept, the member leaves the roster. */
  async retireCommitteeMember(id: string): Promise<void> {
    await api.delete(`/committee-members/${encodeURIComponent(id)}`)
  },

  async listAttendance(meetingId: string): Promise<MeetingAttendance[]> {
    const r = await api.get(`/committee-meetings/${encodeURIComponent(meetingId)}/attendance`)
    return r.data?.data ?? r.data ?? []
  },

  async recordAttendance(
    meetingId: string,
    data: { member_id: string; status: AttendanceStatus },
  ): Promise<MeetingAttendance> {
    const r = await api.post(`/committee-meetings/${encodeURIComponent(meetingId)}/attendance`, data)
    return r.data?.data ?? r.data
  },

  async deleteMeeting(meetingId: string): Promise<void> {
    await api.delete(`/committee-meetings/${encodeURIComponent(meetingId)}`)
  },

  async removeAgendaItem(agendaItemId: string): Promise<void> {
    await api.delete(`/agenda-items/${encodeURIComponent(agendaItemId)}`)
  },

  async listConsultations(permitId: string): Promise<Consultation[]> {
    const r = await api.get(`/permit-applications/${permitId}/consultations`)
    return r.data?.data ?? r.data ?? []
  },

  async createConsultation(permitId: string, data: Partial<Consultation>): Promise<Consultation> {
    const r = await api.post(`/permit-applications/${permitId}/consultations`, data)
    return r.data?.data ?? r.data
  },

  async listObjections(permitId: string): Promise<Objection[]> {
    const r = await api.get(`/permit-applications/${permitId}/objections`)
    return r.data?.data ?? r.data ?? []
  },

  async createObjection(permitId: string, data: Partial<Objection>): Promise<Objection> {
    const r = await api.post(`/permit-applications/${permitId}/objections`, data)
    return r.data?.data ?? r.data
  },

  async listOpenPublicNotices(): Promise<Array<{
    permit_app_id: string
    reference: string | null
    stand_number: string | null
    suburb_ward: string | null
    development_type: string | null
    objection_end: string | null
  }>> {
    const r = await api.get('/public-notices')
    return r.data?.data ?? []
  },

  async lodgePublicObjection(permitId: string, grounds_detail: string, objector_address?: string) {
    const r = await api.post(`/public-notices/${permitId}/objections`, { grounds_detail, objector_address })
    return r.data?.data ?? r.data
  },

  // Resolve / consider an objection (sustain or dismiss) with optional evidence.
  async considerObjection(
    objectionId: string,
    data: { sustained: boolean; consideration_notes?: string; resolution_document_url?: string },
  ): Promise<Objection> {
    const r = await api.patch(`/objections/${encodeURIComponent(objectionId)}/consideration`, data)
    return r.data?.data ?? r.data
  },

  // ── Public notification (RTCP s.26(3), migration 089) ────────────
  async getPublicNotice(permitId: string): Promise<PublicNotice | null> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/public-notice`)
    return r.data?.data ?? r.data ?? null
  },

  async verifyPublicNotice(
    permitId: string,
    data: {
      step: PublicNoticeStep
      verified?: boolean
      reference?: string
      objection_period_start?: string
      objection_period_end?: string
      notes?: string
    },
  ): Promise<PublicNotice> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/public-notice/verify`, data)
    return r.data?.data ?? r.data
  },

  // ─── Phase 2 — Enforcement ──────────────────────────────────────────────

  /**
   * Orders on a property. `stand_number` (trimmed, case-insensitive) and
   * `permit_app_id` OR together server-side, so an order raised against the
   * permit but captured with a different stand string is still returned.
   * `status` narrows whichever matched.
   */
  async listEnforcement(params?: {
    status?: string
    stand_number?: string
    permit_app_id?: string
  }): Promise<EnforcementOrder[]> {
    try {
      const r = await api.get('/enforcement-orders', { params })
      return r.data?.data ?? r.data ?? []
    } catch (err) {
      if (isQuietApiFailure(err)) return []
      throw err
    }
  },

  async createEnforcement(data: Partial<EnforcementOrder>): Promise<EnforcementOrder> {
    const r = await api.post('/enforcement-orders', data)
    return r.data?.data ?? r.data
  },

  async setEnforcementStatus(
    id: string,
    status: 'draft' | 'issued' | 'served' | 'complied' | 'non_complied' | 'withdrawn' | 'appealed',
    notes?: string,
  ): Promise<EnforcementOrder> {
    const r = await api.patch(`/enforcement-orders/${id}/status`, { status, notes })
    return r.data?.data ?? r.data
  },

  async createComplianceCheck(enforcementId: string, data: {
    visited_at: string
    complied: boolean
    notes?: string
    photo_urls?: string[]
  }): Promise<void> {
    await api.post(`/enforcement-orders/${enforcementId}/compliance-checks`, data)
  },

  async listProhibitionOrders(params?: { stand_number?: string }): Promise<ProhibitionOrder[]> {
    const r = await api.get('/prohibition-orders', { params })
    return r.data?.data ?? r.data ?? []
  },

  async createProhibitionOrder(data: Partial<ProhibitionOrder>): Promise<ProhibitionOrder> {
    const r = await api.post('/prohibition-orders', data)
    return r.data?.data ?? r.data
  },

  // ─── Phase 3 — Building Plans ─────────────────────────────────────────

  async listBuildingPlans(permitId: string): Promise<BuildingPlan[]> {
    const r = await api.get(`/permit-applications/${permitId}/building-plans`)
    return r.data?.data ?? r.data ?? []
  },

  async submitBuildingPlan(permitId: string, data: Partial<BuildingPlan>): Promise<BuildingPlan> {
    const r = await api.post(`/permit-applications/${permitId}/building-plans`, data)
    return r.data?.data ?? r.data
  },

  async appraiseBuildingPlan(planId: string, data: { status: BuildingPlanStatus; appraisal_notes?: string }): Promise<BuildingPlan> {
    const r = await api.patch(`/building-plans/${planId}/appraisal`, data)
    return r.data?.data ?? r.data
  },

  // ─── Phase 4 — Stage Inspections ──────────────────────────────────────

  async listInspectionStages(): Promise<InspectionStage[]> {
    const r = await api.get('/inspection-stages')
    return r.data?.data ?? r.data ?? []
  },

  async getInspectionChecklist(stageNumber: number): Promise<ChecklistItem[]> {
    const r = await api.get(`/inspection-checklist/${stageNumber}`)
    return r.data?.data ?? r.data ?? []
  },

  async listStageInspections(permitId: string): Promise<StageInspection[]> {
    const r = await api.get(`/permit-applications/${permitId}/stage-inspections`)
    return r.data?.data ?? r.data ?? []
  },

  // ── Field activity (migration 117) ────────────────────────────────────
  /**
   * Record a field event. Coordinates are optional and must be omitted entirely
   * when the device has no fix — the server rejects a half pair, and a fabricated
   * position is worse than no position on an official record.
   */
  async recordFieldEvent(inspectionId: string, data: {
    event_type: FieldEventType
    observed_lat?: number
    observed_lng?: number
    accuracy_m?: number
    note?: string
  }): Promise<FieldEvent> {
    const r = await api.post(
      `/stage-inspections/${encodeURIComponent(inspectionId)}/field-events`, data)
    return r.data?.data ?? r.data
  },

  async listFieldEvents(inspectionId: string): Promise<FieldEvent[]> {
    const r = await api.get(
      `/stage-inspections/${encodeURIComponent(inspectionId)}/field-events`)
    return r.data?.data ?? r.data ?? []
  },

  // ── Building Inspector work queue (server-side, migration 116) ─────────
  // One query over spatial_planning.v_inspector_queue. Errors propagate: a
  // failure here must never be presented as an empty queue.
  async inspectorWorkQueue(params: InspectorQueueQuery = {}): Promise<InspectorQueuePage> {
    const r = await api.get('/inspector/work-queue', { params })
    return {
      data: r.data?.data ?? [],
      total: Number(r.data?.total ?? 0),
      limit: Number(r.data?.limit ?? 50),
      offset: Number(r.data?.offset ?? 0),
    }
  },

  async inspectorQueueSummary(scope?: 'mine'): Promise<InspectorQueueSummary> {
    const r = await api.get('/inspector/work-queue/summary', {
      params: scope ? { scope } : undefined,
    })
    return r.data?.data
  },

  async getStageInspection(inspectionId: string): Promise<(StageInspection & {
    checklist?: Array<InspectionChecklistResult & { code?: string; description?: string }>
  }) | null> {
    try {
      const r = await api.get(`/stage-inspections/${encodeURIComponent(inspectionId)}`)
      return r.data?.data ?? r.data ?? null
    } catch {
      return null
    }
  },

  async createStageInspection(permitId: string, data: {
    stage_number: number
    scheduled_at?: string
    notes?: string
  }): Promise<StageInspection> {
    const r = await api.post(`/permit-applications/${permitId}/stage-inspections`, data)
    return r.data?.data ?? r.data
  },

  async recordInspectionResult(inspectionId: string, data: {
    result: StageInspection['result']
    inspected_at: string
    stamp_reference?: string
    notes?: string
    photo_urls?: string[]
    checklist: InspectionChecklistResult[]
  }): Promise<StageInspection> {
    const r = await api.post(`/stage-inspections/${inspectionId}/checklist`, data)
    return r.data?.data ?? r.data
  },

  // ─── Phase 5 — Occupation Certificate ────────────────────────────────

  async issueCertificate(permitId: string, data: {
    issued_at: string
    certificate_no?: string
    /** Not persisted by the server — put conditions in `notes`. */
    conditions?: string
    notes?: string
    occupant_name?: string
    building_use?: string
    gross_floor_area_sqm?: number
  }): Promise<OccupationCertificate> {
    const r = await api.post(`/permit-applications/${permitId}/occupation-certificate`, data)
    return r.data?.data ?? r.data
  },

  /**
   * The permit's occupation certificate, or null when none has been issued —
   * the normal state of an unfinished building.
   *
   * The server answers 200 with `data: null` for "not issued", and reserves 404
   * for a permit that does not exist or is not the caller's. The 404 branch
   * below is kept so an older backend still degrades to null rather than
   * throwing; both cases mean "no certificate to show".
   */
  /**
   * The issued Certificate of Occupation, or null when none has been issued.
   *
   * null means "none issued" and NOTHING else. This used to swallow every
   * failure — offline, 500, a permit the caller may not read — and return null,
   * so a building with a certificate could be reported as uncertified, and an
   * inspector could be shown an issue form for a case they had no answer for.
   * Only the server's own "no certificate" answer maps to null now; anything
   * else is raised so the caller can say it does not know.
   *
   * Both server shapes are accepted: 200 with data:null, and the older 404 for
   * an unissued certificate.
   */
  async getCertificate(permitId: string): Promise<OccupationCertificate | null> {
    try {
      const r = await api.get(`/permit-applications/${permitId}/occupation-certificate`)
      return r.data?.data ?? null
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null
      throw err
    }
  },

  // ─── Phase 4b — Stage Inspection Photo Evidence ─────────────────────────

  /**
   * Upload a single photo for a stage inspection. Backend stores the file,
   * computes a SHA-256 hash for tamper detection, and ties it to the
   * uploading user so photos cannot be silently substituted.
   *
   * @param inspectionId stage_inspection.id (UUID)
   * @param file         File from <input type="file"> or camera capture
   * @param extras       optional caption + GPS / taken-at metadata
   */
  async uploadStagePhoto(
    inspectionId: string,
    file: File,
    extras: { caption?: string; takenAt?: string; lng?: number; lat?: number } = {},
  ): Promise<StageInspectionPhoto> {
    const fd = new FormData()
    fd.append('photo', file)
    if (extras.caption)             fd.append('caption', extras.caption)
    if (extras.takenAt)             fd.append('takenAt', extras.takenAt)
    if (extras.lng != null)         fd.append('lng', String(extras.lng))
    if (extras.lat != null)         fd.append('lat', String(extras.lat))
    const r = await api.post(
      `/stage-inspections/${encodeURIComponent(inspectionId)}/photos`,
      fd,
      // axios will set the right multipart boundary when Content-Type is omitted.
      { headers: { 'Content-Type': undefined as unknown as string } },
    )
    return r.data?.data ?? r.data
  },

  async listStagePhotos(inspectionId: string): Promise<StageInspectionPhoto[]> {
    const r = await api.get(`/stage-inspections/${encodeURIComponent(inspectionId)}/photos`)
    return r.data?.data ?? r.data ?? []
  },

  // ─── Phase 4c — Anti-corruption Flags ───────────────────────────────────

  /**
   * File an anti-corruption / quality flag against a previous inspection.
   * The backend prevents an inspector flagging their own inspection.
   */
  async flagStageInspection(
    inspectionId: string,
    reasonCode: FlagReasonCode,
    description: string,
    evidencePhotoIds: string[] = [],
  ): Promise<StageInspectionFlag> {
    const r = await api.post(`/stage-inspections/${encodeURIComponent(inspectionId)}/flag`, {
      reason_code: reasonCode,
      description,
      evidence_photo_ids: evidencePhotoIds,
    })
    return r.data?.data ?? r.data
  },

  // ─── Phase 4d — Per-item scoring (system-computed pass/fail) ───────────

  /**
   * Save per-item checklist results with score + photo. The backend
   * computes the overall stage result from the average and returns the
   * scoring summary. The inspector cannot override this — the system
   * is the sole authority on whether the stage has passed.
   */
  async recordChecklist(
    inspectionId: string,
    results: InspectionChecklistResult[],
    resultNotes?: string,
  ): Promise<StageScoring> {
    const r = await api.post(
      `/stage-inspections/${encodeURIComponent(inspectionId)}/checklist`,
      { results, result_notes: resultNotes },
    )
    return r.data?.data ?? r.data
  },

  async getStageScoring(inspectionId: string): Promise<StageScoring | null> {
    try {
      const r = await api.get(`/stage-inspections/${encodeURIComponent(inspectionId)}/scoring`)
      return r.data?.data ?? r.data ?? null
    } catch {
      return null
    }
  },

  async listStageFlags(inspectionId: string): Promise<StageInspectionFlag[]> {
    const r = await api.get(`/stage-inspections/${encodeURIComponent(inspectionId)}/flags`)
    return r.data?.data ?? r.data ?? []
  },

  async listFlagsForPermit(permitId: string): Promise<StageInspectionFlag[]> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/stage-inspection-flags`)
    return r.data?.data ?? r.data ?? []
  },

  // ─── EO Planner — Decision Workspace (migrations 085 + 086) ────────────

  // The EO inbox: every permit awaiting a determination, with the latest
  // handoff state + deemed-refusal countdown (v_eo_decision_queue).
  async listEoCases(): Promise<EoCase[]> {
    const r = await api.get('/eo-planner/cases')
    return r.data?.data ?? r.data ?? []
  },

  // The single assembled review screen for one permit.
  async getDecisionPackage(permitId: string): Promise<DecisionPackage> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/decision-package`)
    return r.data?.data ?? r.data
  },

  async getSpecialistFindings(permitId: string): Promise<SpecialistFinding[]> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/specialist-findings`)
    return r.data?.data ?? r.data ?? []
  },

  async listMessages(permitId: string): Promise<CaseMessage[]> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/messages`)
    return r.data?.data ?? r.data ?? []
  },

  async postMessage(
    permitId: string,
    data: { body: string; message_type?: CaseMessage['message_type']; visibility?: CaseMessage['visibility'] },
  ): Promise<CaseMessage> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/messages`, data)
    return r.data?.data ?? r.data
  },

  // Final EO determination: approve / approve-with-conditions / refuse.
  // Returns the updated permit plus the council decision letter generated for it.
  async submitEoDecision(
    permitId: string,
    data: { decision: EoDecisionAction; notes?: string; conditions?: PermitCondition[] },
  ): Promise<{ permit: PermitApplication; document: GeneratedDocumentRef | null }> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/eo-decision`, data)
    return r.data?.data ?? r.data
  },

  // Generated decision documents (the council's authoritative letters/reports).
  async listGeneratedDocuments(permitId: string): Promise<GeneratedDocumentRef[]> {
    const r = await api.get(`/permit-applications/${encodeURIComponent(permitId)}/generated-documents`)
    return r.data?.data ?? r.data ?? []
  },

  async getGeneratedDocument(docId: string): Promise<GeneratedDocument> {
    const r = await api.get(`/generated-documents/${encodeURIComponent(docId)}`)
    return r.data?.data ?? r.data
  },

  // Save a GIS map snapshot (PNG data URL) to the decision record.
  async saveMapEvidence(
    permitId: string,
    data: { image: string; title?: string; payload?: unknown },
  ): Promise<GeneratedDocumentRef> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/map-evidence`, data)
    return r.data?.data ?? r.data
  },

  // Send the case back to a role for more work (with a reason).
  async returnToRole(
    permitId: string,
    data: { role: ReturnRole; reason?: string; status?: PermitStatus },
  ): Promise<PermitApplication> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/return-to-role`, data)
    return r.data?.data ?? r.data
  },

  // Ask the applicant for information (optionally opening a document request).
  async requestCitizenInfo(
    permitId: string,
    data: { message: string; doc_kind?: string; due_at?: string },
  ): Promise<{ message: CaseMessage; document_request: unknown }> {
    const r = await api.post(`/permit-applications/${encodeURIComponent(permitId)}/request-info`, data)
    return r.data?.data ?? r.data
  },
}
