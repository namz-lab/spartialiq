/**
 * Plan auto-review service — citizens upload a building plan, the
 * backend runs deterministic checks, returns a row + findings.
 */

import api from './api'

export type PlanReviewStatus =
  | 'pending'
  | 'auto_passed'
  | 'auto_warnings'
  | 'auto_failed'
  | 'staff_approved'
  | 'staff_rejected'

export type FindingSeverity = 'info' | 'warn' | 'error'

export interface PlanReviewFinding {
  id?:        number
  severity:   FindingSeverity
  code:       string
  message:    string
  source?:    { manualSection?: string; page?: number; [k: string]: unknown }
  bbox?:      { page: number; x0: number; y0: number; x1: number; y1: number }
  createdAt?: string
}

export interface PlanReview {
  id:             string
  applicationId:  string
  uploadedBy:     string | null
  storageUrl:     string
  mimeType:       string
  bytes:          number
  sha256Hex:      string | null
  status:         PlanReviewStatus
  notes:          string | null
  createdAt:      string
  updatedAt:      string
}

export interface PlanReviewWithFindings extends PlanReview {
  findings: PlanReviewFinding[]
}

export const planReviewService = {
  async upload(applicationId: string, file: File): Promise<PlanReviewWithFindings> {
    const fd = new FormData()
    fd.append('plan', file)
    const res = await api.post<{ success: boolean; data: PlanReviewWithFindings }>(
      `/applications/${encodeURIComponent(applicationId)}/plan-reviews`,
      fd,
      { headers: { 'Content-Type': undefined as unknown as string } },
    )
    return res.data.data
  },

  async list(applicationId: string): Promise<PlanReview[]> {
    const res = await api.get<{ success: boolean; data: PlanReview[] }>(
      `/applications/${encodeURIComponent(applicationId)}/plan-reviews`,
    )
    return res.data.data
  },

  async get(id: string): Promise<PlanReviewWithFindings> {
    const res = await api.get<{ success: boolean; data: PlanReviewWithFindings }>(
      `/plan-reviews/${encodeURIComponent(id)}`,
    )
    return res.data.data
  },

  async decide(
    id: string,
    decision: 'staff_approved' | 'staff_rejected',
    notes?: string,
  ): Promise<PlanReview> {
    const res = await api.post<{ success: boolean; data: PlanReview }>(
      `/plan-reviews/${encodeURIComponent(id)}/decide`,
      { decision, notes },
    )
    return res.data.data
  },
}
