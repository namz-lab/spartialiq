/**
 * Finance module — Chegutu-style cadastre-linked revenue console.
 * Backend: /api/finance/*
 */
import api from './api'

export const financeApi = {
  overview: () => api.get('/finance/overview'),
  districts: () => api.get('/finance/districts'),
  district: (code: string) => api.get(`/finance/districts/${encodeURIComponent(code)}`),
  accounts: (params?: Record<string, string | number | undefined>) =>
    api.get('/finance/accounts', { params }),
  account: (accountNo: string) =>
    api.get(`/finance/accounts/${encodeURIComponent(accountNo)}`),
  ledger: (accountNo: string) =>
    api.get(`/finance/accounts/${encodeURIComponent(accountNo)}/ledger`),
  mapDistricts: () => api.get('/finance/map/districts'),
  mapAccounts: (params?: { district?: string; owing?: string; limit?: number }) =>
    api.get('/finance/map/accounts', { params }),
  mapExtrude: (params?: { scope?: 'layout' | 'owing' }) =>
    api.get('/finance/map/extrude', { params }),
  rails: () => api.get('/finance/rails'),
  trends: (params?: { district?: string }) =>
    api.get('/finance/trends', { params }),
  receipts: (params?: { limit?: number }) =>
    api.get('/finance/receipts', { params }),
  tariff: () => api.get('/finance/tariff'),
  clearances: (params?: { status?: string }) =>
    api.get('/finance/clearances', { params }),
  decideClearance: (id: string, body: {
    decision: 'clear' | 'refuse'
    refusal_reason?: string
  }) => api.post(`/finance/clearances/${id}/decide`, body),
  workflows: () => api.get('/finance/workflows'),
  adjust: (accountNo: string, body: {
    amountUsd: number
    entryType: string
    purpose?: string
    description: string
  }) => api.post(`/finance/accounts/${encodeURIComponent(accountNo)}/adjust`, body),
}
