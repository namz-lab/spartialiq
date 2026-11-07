/**
 * Citizen residency verification + (mock) Ministry of Lands deeds registry.
 * Backend: backend/src/routes/residency.js (migration 115).
 */

import api from './api'
import type { DocKind, VerificationStatus } from './documentsService'

export type ResidencyStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface ResidencyRequirement {
  kind: DocKind
  label: string
  detail: string
  /** True when the proof verifies instantly (deeds registry lookup). */
  instant: boolean
}

export interface ResidencyEvidence {
  id: string
  docKind: DocKind
  verificationStatus: VerificationStatus
  verificationNotes: string | null
  createdAt: string
  verifiedAt: string | null
}

export interface ResidencyState {
  status: ResidencyStatus
  method: string | null
  verifiedAt: string | null
  evidence: ResidencyEvidence[]
}

export interface DeedCheckResult {
  found: boolean
  deed: {
    deedNumber: string
    holderName: string
    standNo: string | null
    propertyDescription: string | null
    district: string
    status: 'active' | 'transfer_pending' | 'cancelled'
    registeredAt: string
  } | null
  holderMatch: boolean
  residencyVerified: boolean
  message: string
}

export interface RegistryDeed {
  id: string
  deedNumber: string
  holderName: string
  holderNationalId: string | null
  standNo: string | null
  propertyDescription: string | null
  district: string
  hectares: number | null
  status: 'active' | 'transfer_pending' | 'cancelled'
  registeredAt: string
}

export interface RegistryCheck {
  id: string
  deedNumber: string
  requesterName: string | null
  requesterEmail: string | null
  matched: boolean
  holderMatch: boolean
  resultStatus: string | null
  createdAt: string
}

export interface RegistryStats {
  totalDeeds: number
  activeDeeds: number
  totalChecks: number
  checksThisWeek: number
  verifiedMatches: number
  verifiedResidents: number
}

export const residencyService = {
  async requirements(): Promise<ResidencyRequirement[]> {
    const res = await api.get<{ data: ResidencyRequirement[] }>('/residency/requirements')
    return res.data.data
  },

  async status(): Promise<ResidencyState> {
    const res = await api.get<{ data: ResidencyState }>('/residency/status')
    return res.data.data
  },

  async deedCheck(deedNumber: string): Promise<DeedCheckResult> {
    const res = await api.post<{ data: DeedCheckResult }>('/residency/deed-check', { deedNumber })
    return res.data.data
  },
}

export const landsRegistryService = {
  async deeds(params: { search?: string; status?: string } = {}): Promise<RegistryDeed[]> {
    const res = await api.get<{ data: RegistryDeed[] }>('/lands-registry/deeds', { params })
    return res.data.data
  },

  async addDeed(deed: {
    deedNumber: string
    holderName: string
    holderNationalId?: string
    standNo?: string
    propertyDescription?: string
    district?: string
    hectares?: number
    status?: string
  }): Promise<RegistryDeed> {
    const res = await api.post<{ data: RegistryDeed }>('/lands-registry/deeds', deed)
    return res.data.data
  },

  async checks(): Promise<RegistryCheck[]> {
    const res = await api.get<{ data: RegistryCheck[] }>('/lands-registry/checks')
    return res.data.data
  },

  async stats(): Promise<RegistryStats> {
    const res = await api.get<{ data: RegistryStats }>('/lands-registry/stats')
    return res.data.data
  },
}
