/**
 * Inspections service — typed wrapper over /api/inspection*.
 *
 * Mirrors the backend in src/routes/inspections.js. Stage numbers + names
 * come from the Manual 2021 Annexure 12.
 */

import api from './api'

export type InspectionStatus =
  | 'pending_payment'
  | 'waitlisted'
  | 'scheduled'
  | 'rescheduled'
  | 'in_progress'
  | 'passed'
  | 'failed'
  | 'cancelled'

export interface InspectionStage {
  number: number
  name: string
  requires: number[]
}

export interface InspectionBooking {
  id:             string
  applicationId:  string
  stageNumber:    number
  stageName:      string
  citizenId:      string | null
  inspectorId:    string | null
  status:         InspectionStatus
  feePaidAt:      string | null
  scheduledFor:   string | null
  completedAt:    string | null
  passed:         boolean | null
  citizenNotes:   string | null
  inspectorNotes: string | null
  createdAt:      string
  updatedAt:      string
}

export interface InspectionStatusEvent {
  id:           number
  fromStatus:   InspectionStatus | null
  toStatus:     InspectionStatus
  scheduledFor: string | null
  actorId:      string | null
  actorRole:    string | null
  notes:        string | null
  createdAt:    string
}

export interface InspectionPhoto {
  id:         string
  storageUrl: string
  mimeType:   string
  bytes:      number
  widthPx:    number | null
  heightPx:   number | null
  caption:    string | null
  takenAt:    string | null
  takenLng:   number | null
  takenLat:   number | null
  createdAt:  string
}

export interface InspectionDetail extends InspectionBooking {
  events: InspectionStatusEvent[]
  photos: InspectionPhoto[]
}

export const inspectionsService = {
  async stages(): Promise<InspectionStage[]> {
    const res = await api.get<{ success: boolean; data: InspectionStage[] }>('/inspection-stages')
    return res.data.data
  },

  async listForApplication(appId: string): Promise<InspectionBooking[]> {
    const res = await api.get<{ success: boolean; data: InspectionBooking[] }>(
      `/applications/${encodeURIComponent(appId)}/inspections`,
    )
    return res.data.data
  },

  async create(appId: string, stageNumber: number, citizenNotes?: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/applications/${encodeURIComponent(appId)}/inspections`,
      { stageNumber, citizenNotes },
    )
    return res.data.data
  },

  async pay(bookingId: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/pay`,
    )
    return res.data.data
  },

  async schedule(
    bookingId: string,
    scheduledFor: string,
    opts: { inspectorId?: string; inspectorNotes?: string } = {},
  ): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/schedule`,
      { scheduledFor, ...opts },
    )
    return res.data.data
  },

  async reschedule(bookingId: string, scheduledFor: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/reschedule`,
      { scheduledFor },
    )
    return res.data.data
  },

  async start(bookingId: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/start`,
    )
    return res.data.data
  },

  async complete(bookingId: string, passed: boolean, notes?: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/complete`,
      { passed, notes },
    )
    return res.data.data
  },

  async cancel(bookingId: string): Promise<InspectionBooking> {
    const res = await api.post<{ success: boolean; data: InspectionBooking }>(
      `/inspections/${encodeURIComponent(bookingId)}/cancel`,
    )
    return res.data.data
  },

  async get(bookingId: string): Promise<InspectionDetail> {
    const res = await api.get<{ success: boolean; data: InspectionDetail }>(
      `/inspections/${encodeURIComponent(bookingId)}`,
    )
    return res.data.data
  },

  async inspectorQueue(): Promise<{ assigned: InspectionBooking[]; waitlist: InspectionBooking[] }> {
    const res = await api.get<{
      success: boolean
      data: { assigned: InspectionBooking[]; waitlist: InspectionBooking[] }
    }>('/inspector/queue')
    return res.data.data
  },

  /**
   * Upload one photo. The backend strips EXIF (TODO) and persists to
   * uploads/inspection-photos/<bookingId>/<id>.<ext>.
   *
   * The optional caption / GPS fields piggyback on the multipart body.
   */
  async uploadPhoto(
    bookingId: string,
    file: File,
    extras: { caption?: string; takenAt?: string; lng?: number; lat?: number } = {},
  ): Promise<InspectionPhoto> {
    const fd = new FormData()
    fd.append('photo', file)
    if (extras.caption) fd.append('caption', extras.caption)
    if (extras.takenAt) fd.append('takenAt', extras.takenAt)
    if (extras.lng != null) fd.append('lng', String(extras.lng))
    if (extras.lat != null) fd.append('lat', String(extras.lat))

    const res = await api.post<{ success: boolean; data: InspectionPhoto }>(
      `/inspections/${encodeURIComponent(bookingId)}/photos`,
      fd,
      // axios will set the right multipart boundary if we omit Content-Type.
      { headers: { 'Content-Type': undefined as unknown as string } },
    )
    return res.data.data
  },

  async listPhotos(bookingId: string): Promise<InspectionPhoto[]> {
    const res = await api.get<{ success: boolean; data: InspectionPhoto[] }>(
      `/inspections/${encodeURIComponent(bookingId)}/photos`,
    )
    return res.data.data
  },

  async deletePhoto(bookingId: string, photoId: string): Promise<void> {
    await api.delete(
      `/inspections/${encodeURIComponent(bookingId)}/photos/${encodeURIComponent(photoId)}`,
    )
  },
}

// ────────────────────────────────────────────────────────────────────
// Application status changes
// ────────────────────────────────────────────────────────────────────

export interface StatusHistoryRow {
  id:             number
  application_id: string
  from_status:    string | null
  to_status:      string
  changed_by:     string | null
  notes:          string | null
  changed_at:     string
}

export const applicationStatusService = {
  async setStatus(appId: string, toStatus: string, notes?: string) {
    const res = await api.post(
      `/applications/${encodeURIComponent(appId)}/status`,
      { toStatus, notes },
    )
    return res.data
  },

  async history(appId: string): Promise<StatusHistoryRow[]> {
    const res = await api.get<{ success: boolean; data: StatusHistoryRow[] }>(
      `/applications/${encodeURIComponent(appId)}/status-history`,
    )
    return res.data.data
  },
}
