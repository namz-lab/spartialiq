// Citizen service-desk tickets (backend routes/service-desk.js, migration 125).

import api from './api'

export interface ServiceDeskTicket {
  id: string
  service_id: string
  department: string
  title: string
  requester_user_id: string | null
  requester_name: string | null
  contact_phone: string | null
  contact_email: string | null
  location_text: string | null
  details: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface ServiceDeskIntake {
  service_id: string
  department: string
  title: string
  requester_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  location_text?: string | null
  details: string
}

export const serviceDeskApi = {
  async create(body: ServiceDeskIntake): Promise<ServiceDeskTicket> {
    const r = await api.post('/service-desk/tickets', body)
    return r.data?.data ?? r.data
  },
  async mine(): Promise<ServiceDeskTicket[]> {
    const r = await api.get('/service-desk/tickets/mine')
    return r.data?.data ?? []
  },
  async list(params?: { status?: string; service_id?: string; limit?: number }) {
    const r = await api.get('/service-desk/tickets', { params })
    return r.data?.data ?? []
  },
}
