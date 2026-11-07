/**
 * Payments service — typed wrapper over /api/payments/*.
 */

import api from './api'

export type WalletCurrency = 'USD' | 'ZWG'
export type PaymentDriver = 'manual' | 'paynow' | 'stripe' | 'ecocash' | 'onemoney'
export type PaymentStatus =
  | 'pending'
  | 'awaiting_provider'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded'

export interface ExchangeRateMeta {
  rate:     number
  source:   string
  rateId:   string | null
  rateDate: string | null
  asOf:     string | null
  isStale:  boolean
}

export interface PaymentQuote {
  walletCcy:   WalletCurrency
  amountUsd:   number
  amountZwg:   number
  rate:        number
  rateId:      string | null
  rateSource:  string
  rateAsOf:    string | null
  isStale:     boolean
}

export interface Payment {
  id:               string
  purpose:          string
  relatedKind:      string | null
  relatedId:        string | null
  payerId:          string | null
  amountUsd:        number
  amountZwg:        number
  rateUsed:         number
  walletCcy:        WalletCurrency
  driver:           PaymentDriver
  providerRef:      string | null
  providerStatus:   string | null
  status:           PaymentStatus
  issuedReceiptNo:  string | null
  paidAt:           string | null
  receiptUrl:       string | null
  metadata:         Record<string, unknown>
  createdAt:        string
  updatedAt:        string
  /** Set on init() responses only — provider may redirect the citizen. */
  redirectUrl?:     string | null
}

export interface InitPaymentInput {
  purpose:      string
  priceUsd:     number
  walletCcy:    WalletCurrency
  driver?:      PaymentDriver
  relatedKind?: 'inspection_booking' | 'development_application' | 'permit' | 'council_charge'
  relatedId?:   string
  metadata?:    Record<string, unknown>
}

export interface CouncilCharge {
  code: string
  department: string
  title: string
  detail: string
  amountUsd: number | null
  unitLabel: string
  pricedBy: 'tariff' | 'bill'
}

export interface PaymentMethod {
  id: string
  label: string
  live: boolean
}

export const paymentsService = {
  async quote(priceUsd: number, walletCcy: WalletCurrency): Promise<PaymentQuote> {
    const res = await api.get<{ success: boolean; data: PaymentQuote }>(
      `/payments/quote?priceUsd=${encodeURIComponent(priceUsd)}&walletCcy=${walletCcy}`,
    )
    return res.data.data
  },

  async rate(): Promise<ExchangeRateMeta> {
    const res = await api.get<{ success: boolean; data: ExchangeRateMeta }>(`/payments/rate`)
    return res.data.data
  },

  async tariff(): Promise<CouncilCharge[]> {
    const res = await api.get<{ success: boolean; data: CouncilCharge[] }>(`/payments/tariff`)
    return res.data.data
  },

  async methods(): Promise<PaymentMethod[]> {
    const res = await api.get<{ success: boolean; data: PaymentMethod[] }>(`/payments/methods`)
    return res.data.data
  },

  async init(input: InitPaymentInput): Promise<Payment> {
    const res = await api.post<{ success: boolean; data: Payment }>(`/payments`, input)
    return res.data.data
  },

  async get(id: string): Promise<Payment> {
    const res = await api.get<{ success: boolean; data: Payment }>(
      `/payments/${encodeURIComponent(id)}`,
    )
    return res.data.data
  },

  async listMine(): Promise<Payment[]> {
    const res = await api.get<{ success: boolean; data: Payment[] }>(`/payments`)
    return res.data.data
  },

  async confirmManual(id: string): Promise<Payment> {
    const res = await api.post<{ success: boolean; data: Payment }>(
      `/payments/${encodeURIComponent(id)}/confirm`,
    )
    return res.data.data
  },

  async cancel(id: string): Promise<Payment> {
    const res = await api.post<{ success: boolean; data: Payment }>(
      `/payments/${encodeURIComponent(id)}/cancel`,
    )
    return res.data.data
  },

  async poll(id: string): Promise<Payment> {
    const res = await api.post<{ success: boolean; data: Payment }>(
      `/payments/${encodeURIComponent(id)}/poll`,
    )
    return res.data.data
  },

  async listForRelated(kind: 'permit', id: string): Promise<Payment[]> {
    const res = await api.get<{ success: boolean; data: Payment[] }>(
      `/payments?relatedKind=${kind}&relatedId=${encodeURIComponent(id)}`,
    )
    return res.data.data
  },
}
