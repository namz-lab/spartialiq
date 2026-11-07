/**
 * Citizen document upload + verification service.
 */

import api from './api'

export type DocKind =
  | 'national_id'
  | 'passport'
  | 'drivers_licence'
  | 'proof_of_residence'
  | 'title_deed'
  | 'settlement_letter'
  | 'lodgers_permit'
  | 'occupation_certificate'
  | 'chiefs_letter'
  | 'company_registration'
  | 'tax_clearance'
  | 'other'

export type VerificationStatus =
  | 'pending'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'expired'

export interface CitizenDocument {
  id:                  string
  userId:              string
  docKind:             DocKind
  storageUrl:          string
  mimeType:            string
  bytes:               number
  sha256Hex:           string | null
  extractedName:       string | null
  extractedIdNumber:   string | null
  extractedDob:        string | null
  verificationStatus:  VerificationStatus
  verificationNotes:   string | null
  verifiedBy:          string | null
  verifiedAt:          string | null
  verifierProvider:    string | null
  verifierConfidence:  number | null
  /** AI triage result, null for the manual verifier. */
  aiRecommendation:    'pass' | 'fail' | 'uncertain' | null
  aiReason:            string | null
  createdAt:           string
  updatedAt:           string
}

export interface DocumentQueueRow extends CitizenDocument {
  ownerName:  string | null
  ownerEmail: string | null
}

export const documentsService = {
  async upload(file: File, docKind: DocKind): Promise<CitizenDocument> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('docKind', docKind)
    const res = await api.post<{ success: boolean; data: CitizenDocument }>(
      `/documents`, fd,
      { headers: { 'Content-Type': undefined as unknown as string } },
    )
    return res.data.data
  },

  async listMine(): Promise<CitizenDocument[]> {
    const res = await api.get<{ success: boolean; data: CitizenDocument[] }>(`/documents/mine`)
    return res.data.data
  },

  async get(id: string): Promise<CitizenDocument> {
    const res = await api.get<{ success: boolean; data: CitizenDocument }>(
      `/documents/${encodeURIComponent(id)}`,
    )
    return res.data.data
  },

  async queue(): Promise<DocumentQueueRow[]> {
    const res = await api.get<{ success: boolean; data: DocumentQueueRow[] }>(`/documents/queue`)
    return res.data.data
  },

  async verify(
    id: string,
    decision: 'verified' | 'rejected',
    extras: { notes?: string; extracted?: { name?: string; idNumber?: string; dob?: string } } = {},
  ): Promise<CitizenDocument> {
    const res = await api.post<{ success: boolean; data: CitizenDocument }>(
      `/documents/${encodeURIComponent(id)}/verify`,
      { decision, ...extras },
    )
    return res.data.data
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/documents/${encodeURIComponent(id)}`)
  },
}
