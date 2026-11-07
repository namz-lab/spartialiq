// ─── citizenPortalService ──────────────────────────────────────────
// Thin projection layer the Citizen Portal sections use to read the
// canonical Development-Management records via dmApi. No new backend
// endpoints — everything resolves to existing routes registered in
// the backend's development-management router.
// ───────────────────────────────────────────────────────────────────

import {
  dmApi,
  type PermitApplication, type Consultation, type Objection,
  type OccupationCertificate, type StageInspection,
  type PermitDocument, type GeneratedDocumentRef, type CaseMessage,
} from './developmentManagementService'
import type { LifecycleStatus } from '@/composables/useCitizenCase'
import api from './api'

// Map dmApi permit status → citizen-portal lifecycle bucket
export function permitStatusToLifecycle(p: PermitApplication): LifecycleStatus {
  switch (p.status) {
    case 'registered':              return 'received'
    case 'pending_docs':            return 'incomplete'
    case 'under_review':            return 'due_diligence'
    case 'consultation':            return 'technical_circulation'
    case 'objection_period':        return 'public_notice'
    case 'appeal':                  return 'appealed'
    case 'approved':                return 'permit_issued'
    case 'conditionally_approved':  return 'permit_issued'
    case 'refused':                 return 'refused'
    case 'withdrawn':               return 'lapsed'
    case 'lapsed':                  return 'lapsed'
    default:                        return 'received'
  }
}

export interface CitizenCaseSnapshot {
  permit: PermitApplication
  lifecycle: LifecycleStatus
  consultations: Consultation[]
  objections: Objection[]
  inspections: StageInspection[]
  certificate: OccupationCertificate | null
  /** Files on the permit (citizen uploads + counter scans). */
  documents: PermitDocument[]
  /** Council-generated letters (acknowledgement, decision, permit). */
  letters: GeneratedDocumentRef[]
  /** Messages staff addressed to the applicant; the backend filters out internal notes. */
  messages: CaseMessage[]
}

export const citizenPortalService = {
  async getCouncil(): Promise<{ name: string; application_fee: number }> {
    const r = await api.get<{ success: boolean; data: { name: string; application_fee: number | string } | null }>('/council')
    const d = r.data.data
    if (!d) throw new Error('The council record is not configured. Contact the Planning Clerk.')
    return { ...d, application_fee: Number(d.application_fee) }
  },

  async listMyApplications(): Promise<PermitApplication[]> {
    // Backend filters by created_by for non-staff callers, so the client
    // can take the response as authoritative.
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data
  },

  async getCaseSnapshot(permitId: string): Promise<CitizenCaseSnapshot> {
    const [permit, consultations, objections, inspections, certificate, documents, letters, messages] = await Promise.all([
      dmApi.getPermit(permitId),
      dmApi.listConsultations(permitId).catch(() => [] as Consultation[]),
      dmApi.listObjections(permitId).catch(() => [] as Objection[]),
      dmApi.listStageInspections(permitId).catch(() => [] as StageInspection[]),
      dmApi.getCertificate(permitId).catch(() => null),
      dmApi.listPermitDocuments(permitId).catch(() => [] as PermitDocument[]),
      dmApi.listGeneratedDocuments(permitId).catch(() => [] as GeneratedDocumentRef[]),
      dmApi.listMessages(permitId).catch(() => [] as CaseMessage[]),
    ])
    return {
      permit,
      lifecycle: permitStatusToLifecycle(permit),
      consultations, objections, inspections, certificate,
      documents, letters, messages,
    }
  },

  daysUntilDeemedRefusal(p: PermitApplication, statutoryDays = 90): number | null {
    if (!p.received_at) return null
    const elapsed = (Date.now() - new Date(p.received_at).getTime()) / 86_400_000
    return Math.max(0, Math.round(statutoryDays - elapsed))
  },

  missingDocuments(permit: PermitApplication): string[] {
    const flags: string[] = []
    if (permit.status === 'pending_docs') flags.push('Documents flagged outstanding')
    if (!permit.fee_paid) flags.push('Application fee outstanding')
    return flags
  },
}
