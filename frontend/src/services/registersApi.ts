/**
 * Statutory registers — A5 / P10 / G11 / C15 / F7
 * Backend: /api/registers/*
 */
import api from './api'

export const registersApi = {
  // A5
  listBylaws: (params?: { status?: string }) =>
    api.get('/registers/bylaws', { params }),
  createBylaw: (body: Record<string, unknown>) =>
    api.post('/registers/bylaws', body),
  patchBylaw: (id: string, body: Record<string, unknown>) =>
    api.patch(`/registers/bylaws/${id}`, body),

  // P10
  listAnnualPlans: () => api.get('/registers/annual-plans'),
  upsertAnnualPlan: (body: Record<string, unknown>) =>
    api.post('/registers/annual-plans', body),
  patchAnnualPlan: (id: string, body: Record<string, unknown>) =>
    api.patch(`/registers/annual-plans/${id}`, body),

  // G11
  listAcquisitions: () => api.get('/registers/acquisitions'),
  createAcquisition: (body: Record<string, unknown>) =>
    api.post('/registers/acquisitions', body),
  patchAcquisition: (id: string, body: Record<string, unknown>) =>
    api.patch(`/registers/acquisitions/${id}`, body),

  // C15 / X6
  listRatesClearances: (params?: { stand_number?: string }) =>
    api.get('/registers/rates-clearances', { params }),
  myRatesClearances: () => api.get('/registers/rates-clearances/mine'),
  requestRatesClearance: (body: {
    stand_number: string
    applicant_name: string
    applicant_email?: string
  }) => api.post('/registers/rates-clearances', body),
  decideRatesClearance: (id: string, body: {
    decision: 'clear' | 'refuse'
    charges_outstanding_usd?: number
    refusal_reason?: string
  }) => api.post(`/registers/rates-clearances/${id}/decide`, body),
  handoffRatesClearance: (id: string, deeds_handoff_ref: string) =>
    api.post(`/registers/rates-clearances/${id}/handoff`, { deeds_handoff_ref }),

  // F7
  listExpenseRecoveries: () => api.get('/registers/expense-recoveries'),
  createExpenseRecovery: (body: Record<string, unknown>) =>
    api.post('/registers/expense-recoveries', body),
  patchExpenseRecovery: (id: string, body: Record<string, unknown>) =>
    api.patch(`/registers/expense-recoveries/${id}`, body),
}
