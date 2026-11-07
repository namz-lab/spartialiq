// src/services/environmentalHealth.ts
// Client for the Environmental Health Officer's four registers and the spatial
// questions asked of them (backend src/routes/environmental-health.js,
// tables from migration 121).
//
// WHY THE MAPPING LIVES HERE
// The console's seven sections speak `useHealthCase`'s camelCase types and
// have no tests. Translating the API's snake_case in this file — rather than
// changing those types — is what lets the registers move from localStorage to
// the server without touching a single section.
//
// Errors propagate. A register that failed to load must never render as an
// empty register: "no outbreaks recorded" and "could not reach the server" are
// different statements and only one of them is safe to show an officer.

import api from './api'
import type {
  NotifiableDisease, NuisanceComplaint, OutbreakCase,
  PremisesRecord, PremisesType, WaterSample,
} from '@/composables/useHealthCase'

/** Where a recorded position came from. A map_pick is a guess, not a survey. */
export type PositionSource =
  | 'field_gps' | 'map_pick' | 'stand_register' | 'permit_site' | 'premises' | 'ward_centroid'

export interface Position {
  lng: number | null
  lat: number | null
  locationSource: PositionSource | null
  locationAccuracyM: number | null
}

/** The registers carry a position; the console's own types never did. */
export type Positioned<T> = T & Position & { reference?: string }

export interface EhoPoint {
  type: 'Feature'
  id: string
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: Record<string, unknown>
}
export interface EhoLayer { type: 'FeatureCollection'; features: EhoPoint[] }

export interface EhoMapLayers {
  premises: EhoLayer
  outbreaks: EhoLayer
  waterSamples: EhoLayer
  complaints: EhoLayer
  /** Rows with no coordinate. Counted, never silently dropped from the map. */
  unpositioned: { premises: number; outbreaks: number; water_samples: number; complaints: number }
}

export interface NearbyResult {
  point: [number, number]
  radiusM: number
  premises: Array<Positioned<PremisesRecord> & { distanceM: number }>
  outbreaks: Array<Positioned<OutbreakCase> & { distanceM: number }>
  waterSamples: Array<Positioned<WaterSample> & { distanceM: number }>
  complaints: Array<Positioned<NuisanceComplaint> & { distanceM: number }>
}

export interface CatchmentResult {
  outbreak: Positioned<OutbreakCase>
  radiusM: number | null
  positioned: boolean
  usedRecordedCatchment?: boolean
  premises: Array<Positioned<PremisesRecord> & { distanceM: number }>
  waterSamples: Array<Positioned<WaterSample> & { distanceM: number }>
  complaints: Array<Positioned<NuisanceComplaint> & { distanceM: number }>
  limitations: string[]
}

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

// ── row → console type ──────────────────────────────────────────────────
function toPremises(r: Row): Positioned<PremisesRecord> {
  return {
    id: r.id,
    reference: r.reference,
    name: r.name,
    type: r.premises_type as PremisesType,
    stand_number: r.stand_number ?? '',
    suburb_ward: r.suburb_ward ?? '',
    operator_name: r.operator_name ?? '',
    operator_contact: r.operator_contact ?? '',
    permit_application_id: r.permit_app_id ?? null,
    created_at: r.created_at,
    last_inspected_at: r.last_inspected_at ?? null,
    fitness_certificate_no: r.fitness_certificate_no ?? null,
    fitness_certificate_expiry: r.fitness_certificate_expiry ?? null,
    notes: r.notes ?? '',
    ...position(r),
  }
}

function toOutbreak(r: Row): Positioned<OutbreakCase> {
  return {
    id: r.id,
    reference: r.reference,
    disease: r.disease as NotifiableDisease,
    firstReportedAt: r.first_reported_at,
    suspectedSource: r.suspected_source ?? '',
    casesCount: Number(r.cases_count ?? 0),
    ward: r.ward ?? '',
    status: r.status,
    actionsTaken: r.actions_taken ?? '',
    closedAt: r.closed_at ?? null,
    catchmentM: r.catchment_m == null ? null : Number(r.catchment_m),
    ...position(r),
  } as Positioned<OutbreakCase>
}

function toSample(r: Row): Positioned<WaterSample> {
  return {
    id: r.id,
    reference: r.reference,
    sourceLabel: r.source_label ?? '',
    sourceType: r.source_type ?? null,
    sampledAt: r.sampled_at,
    ecoliCount: n(r.ecoli_count),
    faecalColiform: n(r.faecal_coliform),
    freeChlorine: n(r.free_chlorine),
    ph: n(r.ph),
    result: r.result,
    actionsTaken: r.actions_taken ?? '',
    ...position(r),
  } as Positioned<WaterSample>
}

function toComplaint(r: Row): Positioned<NuisanceComplaint> {
  return {
    id: r.id,
    reference: r.reference,
    receivedAt: r.received_at,
    complainantName: r.complainant_name ?? '',
    complainantContact: r.complainant_contact ?? '',
    category: r.category,
    description: r.description ?? '',
    premisesId: r.premises_id ?? null,
    status: r.status,
    abatementNoticeRef: r.abatement_notice_ref ?? null,
    anonymous: r.anonymous === true,
    ...position(r),
  } as Positioned<NuisanceComplaint>
}

// ── console type → request body ─────────────────────────────────────────
/**
 * A position is only ever sent as a complete triple or not at all: the schema
 * rejects provenance without a coordinate, and it is friendlier to never send
 * that than to explain the 400 afterwards.
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

export type NewPremises = Omit<PremisesRecord, 'id' | 'created_at'> & Partial<Position>
export type NewOutbreak = Omit<OutbreakCase, 'id'> & Partial<Position> & { catchmentM?: number | null }
export type NewSample = Omit<WaterSample, 'id'> & Partial<Position>
export type NewComplaint = Omit<NuisanceComplaint, 'id'> & Partial<Position> & { anonymous?: boolean }

export const ehoApi = {
  // ── registers ──────────────────────────────────────────────────────
  async listPremises(params: { type?: string; search?: string; due_days?: number } = {}) {
    return (data<Row[]>(await api.get('/eho/premises', { params }))).map(toPremises)
  },
  async createPremises(p: NewPremises): Promise<Positioned<PremisesRecord>> {
    return toPremises(data<Row>(await api.post('/eho/premises', {
      name: p.name,
      premises_type: p.type,
      stand_number: p.stand_number || null,
      suburb_ward: p.suburb_ward || null,
      operator_name: p.operator_name || null,
      operator_contact: p.operator_contact || null,
      permit_app_id: p.permit_application_id || null,
      fitness_certificate_no: p.fitness_certificate_no || null,
      fitness_certificate_expiry: p.fitness_certificate_expiry || null,
      notes: p.notes || null,
      ...posBody(p),
    })))
  },
  async updatePremises(id: string, patch: Partial<NewPremises>): Promise<Positioned<PremisesRecord>> {
    return toPremises(data<Row>(await api.patch(`/eho/premises/${encodeURIComponent(id)}`, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { premises_type: patch.type } : {}),
      ...(patch.stand_number !== undefined ? { stand_number: patch.stand_number } : {}),
      ...(patch.suburb_ward !== undefined ? { suburb_ward: patch.suburb_ward } : {}),
      ...(patch.operator_name !== undefined ? { operator_name: patch.operator_name } : {}),
      ...(patch.operator_contact !== undefined ? { operator_contact: patch.operator_contact } : {}),
      ...(patch.fitness_certificate_no !== undefined ? { fitness_certificate_no: patch.fitness_certificate_no } : {}),
      ...(patch.fitness_certificate_expiry !== undefined ? { fitness_certificate_expiry: patch.fitness_certificate_expiry } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.last_inspected_at !== undefined ? { last_inspected_at: patch.last_inspected_at } : {}),
      ...posBody(patch),
    })))
  },
  async deletePremises(id: string): Promise<void> {
    await api.delete(`/eho/premises/${encodeURIComponent(id)}`)
  },

  async listOutbreaks(params: { open?: boolean; disease?: string } = {}) {
    return (data<Row[]>(await api.get('/eho/outbreaks', { params }))).map(toOutbreak)
  },
  async createOutbreak(o: NewOutbreak): Promise<Positioned<OutbreakCase>> {
    return toOutbreak(data<Row>(await api.post('/eho/outbreaks', {
      disease: o.disease,
      suspected_source: o.suspectedSource,
      cases_count: o.casesCount,
      ward: o.ward,
      actions_taken: o.actionsTaken || null,
      ...(o.catchmentM != null ? { catchment_m: o.catchmentM } : {}),
      ...posBody(o),
    })))
  },
  async updateOutbreak(id: string, patch: Partial<NewOutbreak>): Promise<Positioned<OutbreakCase>> {
    return toOutbreak(data<Row>(await api.patch(`/eho/outbreaks/${encodeURIComponent(id)}`, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.casesCount !== undefined ? { cases_count: patch.casesCount } : {}),
      ...(patch.suspectedSource !== undefined ? { suspected_source: patch.suspectedSource } : {}),
      ...(patch.actionsTaken !== undefined ? { actions_taken: patch.actionsTaken } : {}),
      ...(patch.catchmentM !== undefined && patch.catchmentM != null ? { catchment_m: patch.catchmentM } : {}),
      ...posBody(patch),
    })))
  },

  async listWaterSamples(params: { failing?: boolean; result?: string } = {}) {
    return (data<Row[]>(await api.get('/eho/water-samples', { params }))).map(toSample)
  },
  async createWaterSample(s: NewSample): Promise<Positioned<WaterSample>> {
    return toSample(data<Row>(await api.post('/eho/water-samples', {
      source_label: s.sourceLabel,
      ...((s as Row).sourceType ? { source_type: (s as Row).sourceType } : {}),
      ecoli_count: s.ecoliCount,
      faecal_coliform: s.faecalColiform,
      free_chlorine: s.freeChlorine,
      ph: s.ph,
      result: s.result,
      actions_taken: s.actionsTaken || null,
      ...posBody(s),
    })))
  },

  async listComplaints(params: { open?: boolean; category?: string } = {}) {
    return (data<Row[]>(await api.get('/eho/complaints', { params }))).map(toComplaint)
  },
  async createComplaint(c: NewComplaint): Promise<Positioned<NuisanceComplaint>> {
    return toComplaint(data<Row>(await api.post('/eho/complaints', {
      category: c.category,
      description: c.description,
      premises_id: c.premisesId || null,
      suburb_ward: (c as Row).suburb_ward || null,
      location_note: (c as Row).locationNote || null,
      anonymous: c.anonymous === true,
      complainant_name: c.anonymous ? null : (c.complainantName || null),
      complainant_contact: c.anonymous ? null : (c.complainantContact || null),
      ...posBody(c),
    })))
  },
  async updateComplaint(id: string, patch: Partial<NewComplaint>): Promise<Positioned<NuisanceComplaint>> {
    return toComplaint(data<Row>(await api.patch(`/eho/complaints/${encodeURIComponent(id)}`, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.abatementNoticeRef !== undefined ? { abatement_notice_ref: patch.abatementNoticeRef } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.premisesId !== undefined ? { premises_id: patch.premisesId } : {}),
      ...posBody(patch),
    })))
  },

  // ── spatial ────────────────────────────────────────────────────────
  /** Every positioned register record as GeoJSON, plus what has no position. */
  async mapLayers(): Promise<EhoMapLayers> {
    return data<EhoMapLayers>(await api.get('/eho/map'))
  },

  /** What the health registers hold within `radiusM` of a point. */
  async nearby(lng: number, lat: number, radiusM = 500): Promise<NearbyResult> {
    const d = data<Row>(await api.get('/eho/nearby', { params: { lng, lat, radius_m: radiusM } }))
    return {
      point: d.point,
      radiusM: d.radiusM,
      premises: d.premises.map((r: Row) => ({ ...toPremises(r), distanceM: r.distanceM })),
      outbreaks: d.outbreaks.map((r: Row) => ({ ...toOutbreak(r), distanceM: r.distanceM })),
      waterSamples: d.waterSamples.map((r: Row) => ({ ...toSample(r), distanceM: r.distanceM })),
      complaints: d.complaints.map((r: Row) => ({ ...toComplaint(r), distanceM: r.distanceM })),
    }
  },

  /**
   * The premises, water sources and related complaints inside an outbreak's
   * catchment. `radiusM` overrides the recorded catchment for a what-if
   * without editing the record.
   */
  async catchment(outbreakId: string, radiusM?: number): Promise<CatchmentResult> {
    const d = data<Row>(await api.get(
      `/eho/outbreaks/${encodeURIComponent(outbreakId)}/catchment`,
      { params: radiusM ? { radius_m: radiusM } : {} },
    ))
    return {
      outbreak: toOutbreak(d.outbreak),
      radiusM: d.radiusM,
      positioned: d.positioned,
      usedRecordedCatchment: d.usedRecordedCatchment,
      premises: d.premises.map((r: Row) => ({ ...toPremises(r), distanceM: r.distanceM })),
      waterSamples: d.waterSamples.map((r: Row) => ({ ...toSample(r), distanceM: r.distanceM })),
      complaints: d.complaints.map((r: Row) => ({ ...toComplaint(r), distanceM: r.distanceM })),
      limitations: d.limitations ?? [],
    }
  },
}
