// src/services/environmentalHealthOps.ts
// Client for the EHO's operational record — the work carried out, the
// documents issued, the licence clearances decided and the field programmes
// run (backend src/routes/environmental-health-ops.js, migration 122).
//
// Companion to environmentalHealth.ts, which fronts the four registers of
// migration 121. Same rules, deliberately:
//
//   • snake_case ↔ camelCase translation lives here, so the console's sections
//     never learn the wire format.
//   • Errors propagate. A list that failed to load must never render as an
//     empty list: "no certificates issued" and "could not reach the server"
//     are different statements and only one of them is safe to show.
//   • Nothing is decided here. These calls record what an officer determined
//     under the Public Health Act; they do not determine it.

import api from './api'
import type { Position, PositionSource } from './environmentalHealth'

type Row = Record<string, any>

function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

const n = (v: unknown): number | null => (v == null ? null : Number(v))

function position(r: Row): Position {
  return {
    lng: n(r.lng),
    lat: n(r.lat),
    locationSource: (r.location_source ?? null) as PositionSource | null,
    locationAccuracyM: n(r.location_accuracy_m),
  }
}

/**
 * A position is sent as a complete triple or not at all — the schema rejects
 * provenance without a coordinate, and refusing to send that is friendlier
 * than explaining the 400 afterwards. Same helper, same reason, as the
 * registers client.
 */
function posBody(p: Partial<Position> | undefined): Row {
  if (!p || p.lng == null || p.lat == null) return {}
  return {
    lng: p.lng,
    lat: p.lat,
    ...(p.locationSource ? { location_source: p.locationSource } : {}),
    ...(p.locationAccuracyM != null ? { location_accuracy_m: p.locationAccuracyM } : {}),
  }
}

// ── Premises inspection ─────────────────────────────────────────────────
export type InspectionScope =
  | 'food_hygiene' | 'sanitation' | 'water_supply'
  | 'pest_control' | 'staff_hygiene' | 'general'
export type InspectionVerdict = 'pass' | 'fail' | 'conditional' | 'pending'

export interface PremisesInspection extends Position {
  id: string
  reference: string
  premisesId: string
  premisesName: string | null
  inspectedAt: string
  inspectorName: string
  scope: InspectionScope
  verdict: InspectionVerdict
  findings: string
  actionRequired: string | null
  followUpDate: string | null
  /** The Public Health Act notice this inspection grounded or re-inspects. */
  noticeId: string | null
  createdByName: string | null
}

export interface NewInspection extends Partial<Position> {
  premisesId: string
  inspectorName: string
  scope: InspectionScope
  verdict: InspectionVerdict
  findings: string
  actionRequired?: string | null
  followUpDate?: string | null
  inspectedAt?: string | null
  noticeId?: string | null
}

function toInspection(r: Row): PremisesInspection {
  return {
    id: r.id,
    reference: r.reference,
    premisesId: r.premises_id,
    premisesName: r.premises_name ?? null,
    inspectedAt: r.inspected_at,
    inspectorName: r.inspector_name,
    scope: r.scope,
    verdict: r.verdict,
    findings: r.findings ?? '',
    actionRequired: r.action_required ?? null,
    followUpDate: r.follow_up_date ?? null,
    noticeId: r.notice_id ?? null,
    createdByName: r.created_by_name ?? null,
    ...position(r),
  }
}

// ── Public Health Act notice ────────────────────────────────────────────
export type NoticeType = 'abatement' | 'closure' | 'works_in_default' | 'prohibition'
export type NoticeStatus = 'served' | 'extended' | 'complied' | 'non_complied' | 'escalated' | 'withdrawn'
export type NoticeEscalation = 'works_in_default' | 'prosecution' | 'closure'
export type ServedMethod = 'hand' | 'registered_post' | 'affixed' | 'email'

export interface HealthNotice {
  id: string
  reference: string
  noticeType: NoticeType
  premisesId: string | null
  premisesName: string | null
  complaintId: string | null
  complaintReference: string | null
  standNumber: string | null
  suburbWard: string | null
  subjectName: string
  subjectAddress: string | null
  subjectContact: string | null
  nuisanceDescription: string
  requiredAction: string
  complianceDays: number
  servedAt: string
  servedMethod: ServedMethod
  /** Extension date if granted, otherwise service date + compliance period. */
  complianceDue: string
  status: NoticeStatus
  extendedTo: string | null
  escalation: NoticeEscalation | null
  outcomeNotes: string | null
  closedAt: string | null
  issuedByName: string
  reinspections: number
  lastReinspectionVerdict: InspectionVerdict | null
}

export interface NewHealthNotice {
  noticeType: NoticeType
  premisesId?: string | null
  complaintId?: string | null
  inspectionId?: string | null
  standNumber?: string | null
  suburbWard?: string | null
  subjectName: string
  subjectAddress?: string | null
  subjectContact?: string | null
  nuisanceDescription: string
  requiredAction: string
  complianceDays: number
  servedMethod?: ServedMethod
  servedAt?: string | null
  issuedByName: string
}

export interface NoticeUpdate {
  status?: NoticeStatus
  extendedTo?: string | null
  escalation?: NoticeEscalation | null
  outcomeNotes?: string | null
}

function toNotice(r: Row): HealthNotice {
  return {
    id: r.id,
    reference: r.reference,
    noticeType: r.notice_type,
    premisesId: r.premises_id ?? null,
    premisesName: r.premises_name ?? null,
    complaintId: r.complaint_id ?? null,
    complaintReference: r.complaint_reference ?? null,
    standNumber: r.stand_number ?? null,
    suburbWard: r.suburb_ward ?? null,
    subjectName: r.subject_name,
    subjectAddress: r.subject_address ?? null,
    subjectContact: r.subject_contact ?? null,
    nuisanceDescription: r.nuisance_description ?? '',
    requiredAction: r.required_action ?? '',
    complianceDays: Number(r.compliance_days),
    servedAt: r.served_at,
    servedMethod: r.served_method,
    complianceDue: r.compliance_due,
    status: r.status,
    extendedTo: r.extended_to ?? null,
    escalation: r.escalation ?? null,
    outcomeNotes: r.outcome_notes ?? null,
    closedAt: r.closed_at ?? null,
    issuedByName: r.issued_by_name ?? '',
    reinspections: Number(r.reinspections ?? 0),
    lastReinspectionVerdict: r.last_reinspection_verdict ?? null,
  }
}

export const NOTICE_LABELS: Record<NoticeType, { label: string; statute: string }> = {
  abatement:        { label: 'Abatement notice',          statute: 'Public Health Act s. 83' },
  closure:          { label: 'Closure — unfit premises',  statute: 'Public Health Act s. 87' },
  works_in_default: { label: 'Works in default',          statute: 'Public Health Act s. 84' },
  prohibition:      { label: 'Prohibition — cease trading', statute: 'Public Health Act; food by-laws' },
}

// ── Food-handler certificate ────────────────────────────────────────────
export interface FoodHandlerCertificate {
  id: string
  reference: string
  premisesId: string
  premisesName: string | null
  handlerName: string
  handlerIdNumber: string | null
  issuedAt: string
  expiresAt: string
  medicalClearanceSource: string
  notes: string | null
  revokedAt: string | null
  revokedReason: string | null
  issuedByName: string | null
}

export interface NewFoodHandlerCertificate {
  premisesId: string
  handlerName: string
  handlerIdNumber?: string | null
  expiresAt: string
  medicalClearanceSource: string
  notes?: string | null
}

function toHandler(r: Row): FoodHandlerCertificate {
  return {
    id: r.id,
    reference: r.reference,
    premisesId: r.premises_id,
    premisesName: r.premises_name ?? null,
    handlerName: r.handler_name,
    handlerIdNumber: r.handler_id_number ?? null,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    medicalClearanceSource: r.medical_clearance_source ?? '',
    notes: r.notes ?? null,
    revokedAt: r.revoked_at ?? null,
    revokedReason: r.revoked_reason ?? null,
    issuedByName: r.issued_by_name ?? null,
  }
}

// ── Burial permit ───────────────────────────────────────────────────────
export type BurialPermitKind = 'burial' | 'exhumation' | 'reburial'

export interface BurialPermit {
  id: string
  reference: string
  permitKind: BurialPermitKind
  deceasedName: string
  deceasedIdNumber: string | null
  dateOfDeath: string
  causeOfDeath: string | null
  cemetery: string
  ward: string | null
  intermentAt: string | null
  applicantName: string | null
  applicantRelation: string | null
  applicantContact: string | null
  issuedByName: string
  issuedAt: string
  notes: string | null
  cancelledAt: string | null
  cancelledReason: string | null
}

export interface NewBurialPermit {
  permitKind?: BurialPermitKind
  deceasedName: string
  deceasedIdNumber?: string | null
  dateOfDeath: string
  causeOfDeath?: string | null
  cemetery: string
  ward?: string | null
  intermentAt?: string | null
  applicantName?: string | null
  applicantRelation?: string | null
  applicantContact?: string | null
  issuedByName: string
  notes?: string | null
}

function toBurial(r: Row): BurialPermit {
  return {
    id: r.id,
    reference: r.reference,
    permitKind: r.permit_kind,
    deceasedName: r.deceased_name,
    deceasedIdNumber: r.deceased_id_number ?? null,
    dateOfDeath: r.date_of_death,
    causeOfDeath: r.cause_of_death ?? null,
    cemetery: r.cemetery,
    ward: r.ward ?? null,
    intermentAt: r.interment_at ?? null,
    applicantName: r.applicant_name ?? null,
    applicantRelation: r.applicant_relation ?? null,
    applicantContact: r.applicant_contact ?? null,
    issuedByName: r.issued_by_name ?? '',
    issuedAt: r.issued_at,
    notes: r.notes ?? null,
    cancelledAt: r.cancelled_at ?? null,
    cancelledReason: r.cancelled_reason ?? null,
  }
}

// ── Licence clearance ───────────────────────────────────────────────────
export type LicenceType =
  | 'shop' | 'liquor' | 'hawker' | 'food_outlet' | 'lodging'
  | 'abattoir' | 'creche' | 'transport_of_food' | 'other'
export type ClearanceStatus = 'pending' | 'cleared' | 'conditional' | 'refused' | 'withdrawn'

export interface LicenceClearance {
  id: string
  reference: string
  licenceType: LicenceType
  applicantName: string
  applicantContact: string | null
  tradingName: string | null
  premisesId: string | null
  premisesName: string | null
  standNumber: string | null
  suburbWard: string | null
  receivedAt: string
  inspectionId: string | null
  inspectionReference: string | null
  inspectionVerdict: InspectionVerdict | null
  status: ClearanceStatus
  conditions: string | null
  refusalReason: string | null
  decidedAt: string | null
  decidedByName: string | null
  validUntil: string | null
  notes: string | null
}

export interface NewLicenceClearance {
  licenceType: LicenceType
  applicantName: string
  applicantContact?: string | null
  tradingName?: string | null
  premisesId?: string | null
  standNumber?: string | null
  suburbWard?: string | null
  notes?: string | null
}

export interface ClearanceDecision {
  status?: ClearanceStatus
  conditions?: string | null
  refusalReason?: string | null
  validUntil?: string | null
  inspectionId?: string | null
  decidedByName?: string | null
  notes?: string | null
}

function toClearance(r: Row): LicenceClearance {
  return {
    id: r.id,
    reference: r.reference,
    licenceType: r.licence_type,
    applicantName: r.applicant_name,
    applicantContact: r.applicant_contact ?? null,
    tradingName: r.trading_name ?? null,
    premisesId: r.premises_id ?? null,
    premisesName: r.premises_name ?? null,
    standNumber: r.stand_number ?? null,
    suburbWard: r.suburb_ward ?? null,
    receivedAt: r.received_at,
    inspectionId: r.inspection_id ?? null,
    inspectionReference: r.inspection_reference ?? null,
    inspectionVerdict: r.inspection_verdict ?? null,
    status: r.status,
    conditions: r.conditions ?? null,
    refusalReason: r.refusal_reason ?? null,
    decidedAt: r.decided_at ?? null,
    decidedByName: r.decided_by_name ?? null,
    validUntil: r.valid_until ?? null,
    notes: r.notes ?? null,
  }
}

// ── Field programme ─────────────────────────────────────────────────────
export type ProgrammeType =
  | 'refuse_collection' | 'illegal_dump_clearance' | 'disposal_site_check'
  | 'latrine_construction' | 'indoor_residual_spray' | 'larviciding'
  | 'rodent_control' | 'health_education' | 'water_point_maintenance' | 'other'
export type ProgrammeStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'

export interface FieldProgramme extends Position {
  id: string
  reference: string
  programmeType: ProgrammeType
  title: string
  ward: string
  villageOrArea: string | null
  scheduledFor: string
  executedAt: string | null
  status: ProgrammeStatus
  targetQuantity: number | null
  achievedQuantity: number | null
  quantityUnit: string | null
  teamLead: string | null
  teamSize: number | null
  notes: string | null
  cancelledReason: string | null
}

export interface NewFieldProgramme extends Partial<Position> {
  programmeType: ProgrammeType
  title: string
  ward: string
  villageOrArea?: string | null
  scheduledFor: string
  targetQuantity?: number | null
  quantityUnit?: string | null
  teamLead?: string | null
  teamSize?: number | null
  notes?: string | null
}

export interface ProgrammeUpdate {
  status?: ProgrammeStatus
  achievedQuantity?: number | null
  quantityUnit?: string | null
  teamLead?: string | null
  notes?: string | null
  cancelledReason?: string | null
  executedAt?: string | null
}

function toProgramme(r: Row): FieldProgramme {
  return {
    id: r.id,
    reference: r.reference,
    programmeType: r.programme_type,
    title: r.title,
    ward: r.ward,
    villageOrArea: r.village_or_area ?? null,
    scheduledFor: r.scheduled_for,
    executedAt: r.executed_at ?? null,
    status: r.status,
    targetQuantity: r.target_quantity == null ? null : Number(r.target_quantity),
    achievedQuantity: r.achieved_quantity == null ? null : Number(r.achieved_quantity),
    quantityUnit: r.quantity_unit ?? null,
    teamLead: r.team_lead ?? null,
    teamSize: r.team_size == null ? null : Number(r.team_size),
    notes: r.notes ?? null,
    cancelledReason: r.cancelled_reason ?? null,
    ...position(r),
  }
}

// ── Console summary ─────────────────────────────────────────────────────
/**
 * Every counter the dashboard shows, from one request.
 *
 * The alternative — fetching seven lists and reading their lengths — moves
 * every row of every register across a rural link and then throws all but the
 * count away. These are computed where the rows already are.
 */
export interface EhoSummary {
  /** The inspection interval these counts were computed against. */
  overdueDays: number
  premises: number
  premisesOverdue: number
  outbreaksOpen: number
  outbreakCasesOpen: number
  waterFailing90d: number
  complaintsOpen: number
  followUpsDue: number
  handlerCertsExpiring30d: number
  handlerCertsExpired: number
  clearancesPending: number
  programmesDue: number
  noticesOpen: number
  noticesOverdue: number
}

// ── API ─────────────────────────────────────────────────────────────────
export const ehoOpsApi = {
  // Inspections
  async listInspections(params: {
    premises_id?: string; verdict?: InspectionVerdict
    from?: string; to?: string; due?: boolean; limit?: number
  } = {}): Promise<PremisesInspection[]> {
    return (data<Row[]>(await api.get('/eho/inspections', { params }))).map(toInspection)
  },
  async createInspection(i: NewInspection): Promise<PremisesInspection> {
    return toInspection(data<Row>(await api.post('/eho/inspections', {
      premises_id: i.premisesId,
      inspector_name: i.inspectorName,
      scope: i.scope,
      verdict: i.verdict,
      findings: i.findings,
      action_required: i.actionRequired || null,
      follow_up_date: i.followUpDate || null,
      ...(i.inspectedAt ? { inspected_at: i.inspectedAt } : {}),
      ...(i.noticeId ? { notice_id: i.noticeId } : {}),
      ...posBody(i),
    })))
  },
  /** Links the notice this inspection grounded. Findings are not editable. */
  async linkNotice(id: string, noticeId: string | null): Promise<PremisesInspection> {
    return toInspection(data<Row>(await api.patch(`/eho/inspections/${encodeURIComponent(id)}`, {
      notice_id: noticeId,
    })))
  },

  // Public Health Act notices
  async listNotices(params: {
    status?: NoticeStatus; notice_type?: NoticeType; premises_id?: string
    search?: string; open?: boolean; limit?: number
  } = {}): Promise<HealthNotice[]> {
    return (data<Row[]>(await api.get('/eho/notices', { params }))).map(toNotice)
  },
  async serveNotice(n: NewHealthNotice): Promise<HealthNotice> {
    return toNotice(data<Row>(await api.post('/eho/notices', {
      notice_type: n.noticeType,
      premises_id: n.premisesId || null,
      complaint_id: n.complaintId || null,
      inspection_id: n.inspectionId || null,
      stand_number: n.standNumber || null,
      suburb_ward: n.suburbWard || null,
      subject_name: n.subjectName,
      subject_address: n.subjectAddress || null,
      subject_contact: n.subjectContact || null,
      nuisance_description: n.nuisanceDescription,
      required_action: n.requiredAction,
      compliance_days: n.complianceDays,
      served_method: n.servedMethod || 'hand',
      issued_by_name: n.issuedByName,
      ...(n.servedAt ? { served_at: n.servedAt } : {}),
    })))
  },
  async updateNotice(id: string, u: NoticeUpdate): Promise<HealthNotice> {
    return toNotice(data<Row>(await api.patch(`/eho/notices/${encodeURIComponent(id)}`, {
      ...(u.status !== undefined ? { status: u.status } : {}),
      ...(u.extendedTo !== undefined ? { extended_to: u.extendedTo } : {}),
      ...(u.escalation !== undefined ? { escalation: u.escalation } : {}),
      ...(u.outcomeNotes !== undefined ? { outcome_notes: u.outcomeNotes } : {}),
    })))
  },

  // Food-handler certificates
  async listFoodHandlers(params: {
    premises_id?: string; search?: string
    expiring_days?: number; include_revoked?: boolean; limit?: number
  } = {}): Promise<FoodHandlerCertificate[]> {
    return (data<Row[]>(await api.get('/eho/food-handlers', { params }))).map(toHandler)
  },
  async issueFoodHandler(h: NewFoodHandlerCertificate): Promise<FoodHandlerCertificate> {
    return toHandler(data<Row>(await api.post('/eho/food-handlers', {
      premises_id: h.premisesId,
      handler_name: h.handlerName,
      handler_id_number: h.handlerIdNumber || null,
      expires_at: h.expiresAt,
      medical_clearance_source: h.medicalClearanceSource,
      notes: h.notes || null,
    })))
  },
  async revokeFoodHandler(id: string, reason: string): Promise<FoodHandlerCertificate> {
    return toHandler(data<Row>(
      await api.post(`/eho/food-handlers/${encodeURIComponent(id)}/revoke`, { reason })))
  },

  // Burial permits
  async listBurialPermits(params: {
    search?: string; kind?: BurialPermitKind; limit?: number
  } = {}): Promise<BurialPermit[]> {
    return (data<Row[]>(await api.get('/eho/burial-permits', { params }))).map(toBurial)
  },
  async issueBurialPermit(b: NewBurialPermit): Promise<BurialPermit> {
    return toBurial(data<Row>(await api.post('/eho/burial-permits', {
      permit_kind: b.permitKind || 'burial',
      deceased_name: b.deceasedName,
      deceased_id_number: b.deceasedIdNumber || null,
      date_of_death: b.dateOfDeath,
      cause_of_death: b.causeOfDeath || null,
      cemetery: b.cemetery,
      ward: b.ward || null,
      interment_at: b.intermentAt || null,
      applicant_name: b.applicantName || null,
      applicant_relation: b.applicantRelation || null,
      applicant_contact: b.applicantContact || null,
      issued_by_name: b.issuedByName,
      notes: b.notes || null,
    })))
  },
  async cancelBurialPermit(id: string, reason: string): Promise<BurialPermit> {
    return toBurial(data<Row>(
      await api.post(`/eho/burial-permits/${encodeURIComponent(id)}/cancel`, { reason })))
  },

  // Licence clearances
  async listClearances(params: {
    status?: ClearanceStatus; licence_type?: LicenceType
    search?: string; open?: boolean; limit?: number
  } = {}): Promise<LicenceClearance[]> {
    return (data<Row[]>(await api.get('/eho/clearances', { params }))).map(toClearance)
  },
  async createClearance(c: NewLicenceClearance): Promise<LicenceClearance> {
    return toClearance(data<Row>(await api.post('/eho/clearances', {
      licence_type: c.licenceType,
      applicant_name: c.applicantName,
      applicant_contact: c.applicantContact || null,
      trading_name: c.tradingName || null,
      premises_id: c.premisesId || null,
      stand_number: c.standNumber || null,
      suburb_ward: c.suburbWard || null,
      notes: c.notes || null,
    })))
  },
  async decideClearance(id: string, d: ClearanceDecision): Promise<LicenceClearance> {
    return toClearance(data<Row>(await api.patch(`/eho/clearances/${encodeURIComponent(id)}`, {
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.conditions !== undefined ? { conditions: d.conditions } : {}),
      ...(d.refusalReason !== undefined ? { refusal_reason: d.refusalReason } : {}),
      ...(d.validUntil !== undefined ? { valid_until: d.validUntil } : {}),
      ...(d.inspectionId !== undefined ? { inspection_id: d.inspectionId } : {}),
      ...(d.decidedByName !== undefined ? { decided_by_name: d.decidedByName } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
    })))
  },

  // Field programmes
  async listProgrammes(params: {
    programme_type?: ProgrammeType; status?: ProgrammeStatus
    ward?: string; from?: string; to?: string; limit?: number
  } = {}): Promise<FieldProgramme[]> {
    return (data<Row[]>(await api.get('/eho/programmes', { params }))).map(toProgramme)
  },
  async createProgramme(p: NewFieldProgramme): Promise<FieldProgramme> {
    return toProgramme(data<Row>(await api.post('/eho/programmes', {
      programme_type: p.programmeType,
      title: p.title,
      ward: p.ward,
      village_or_area: p.villageOrArea || null,
      scheduled_for: p.scheduledFor,
      target_quantity: p.targetQuantity ?? null,
      quantity_unit: p.quantityUnit || null,
      team_lead: p.teamLead || null,
      team_size: p.teamSize ?? null,
      notes: p.notes || null,
      ...posBody(p),
    })))
  },
  async updateProgramme(id: string, u: ProgrammeUpdate): Promise<FieldProgramme> {
    return toProgramme(data<Row>(await api.patch(`/eho/programmes/${encodeURIComponent(id)}`, {
      ...(u.status !== undefined ? { status: u.status } : {}),
      ...(u.achievedQuantity !== undefined ? { achieved_quantity: u.achievedQuantity } : {}),
      ...(u.quantityUnit !== undefined ? { quantity_unit: u.quantityUnit } : {}),
      ...(u.teamLead !== undefined ? { team_lead: u.teamLead } : {}),
      ...(u.notes !== undefined ? { notes: u.notes } : {}),
      ...(u.cancelledReason !== undefined ? { cancelled_reason: u.cancelledReason } : {}),
      ...(u.executedAt !== undefined ? { executed_at: u.executedAt } : {}),
    })))
  },

  /** Every console counter, in one round trip. */
  async summary(overdueDays?: number): Promise<EhoSummary> {
    return data<EhoSummary>(await api.get('/eho/summary', {
      params: overdueDays ? { overdue_days: overdueDays } : {},
    }))
  },
}

// ── Display vocabulary ──────────────────────────────────────────────────
// Kept beside the types rather than in each section, so the twelve places a
// programme type is named all name it the same way.

export const PROGRAMME_LABELS: Record<ProgrammeType, string> = {
  refuse_collection:      'Refuse collection round',
  illegal_dump_clearance: 'Illegal dump clearance',
  disposal_site_check:    'Disposal site inspection',
  latrine_construction:   'Latrine construction (VIP/Blair)',
  indoor_residual_spray:  'Indoor residual spraying',
  larviciding:            'Larviciding',
  rodent_control:         'Rodent control',
  health_education:       'Health education campaign',
  water_point_maintenance:'Water point maintenance',
  other:                  'Other programme',
}

/**
 * The unit each programme counts in, offered as the default when a round is
 * planned. The officer can always overwrite it — a council that counts refuse
 * rounds in tonnes rather than bins is not wrong, it is just not the common case.
 */
export const PROGRAMME_DEFAULT_UNITS: Record<ProgrammeType, string> = {
  refuse_collection:      'collection points',
  illegal_dump_clearance: 'sites',
  disposal_site_check:    'inspections',
  latrine_construction:   'latrines',
  indoor_residual_spray:  'households',
  larviciding:            'breeding sites',
  rodent_control:         'premises baited',
  health_education:       'people reached',
  water_point_maintenance:'water points',
  other:                  'units',
}

/** Which working group a programme belongs to — the tabs of the Programmes section. */
export const PROGRAMME_GROUPS = {
  waste: ['refuse_collection', 'illegal_dump_clearance', 'disposal_site_check'],
  sanitation: ['latrine_construction', 'water_point_maintenance'],
  vector: ['indoor_residual_spray', 'larviciding', 'rodent_control'],
  education: ['health_education', 'other'],
} as const satisfies Record<string, readonly ProgrammeType[]>

export type ProgrammeGroup = keyof typeof PROGRAMME_GROUPS

export const LICENCE_LABELS: Record<LicenceType, string> = {
  shop:              'Shop licence',
  liquor:            'Liquor licence',
  hawker:            'Hawker / vendor permit',
  food_outlet:       'Food outlet licence',
  lodging:           'Lodging house licence',
  abattoir:          'Abattoir licence',
  creche:            'Crèche registration',
  transport_of_food: 'Food transport permit',
  other:             'Other licence',
}

export const INSPECTION_SCOPE_LABELS: Record<InspectionScope, string> = {
  food_hygiene:  'Food hygiene',
  sanitation:    'Sanitation',
  water_supply:  'Water supply',
  pest_control:  'Pest control',
  staff_hygiene: 'Staff hygiene',
  general:       'General',
}
