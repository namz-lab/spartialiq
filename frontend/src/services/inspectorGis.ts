// src/services/inspectorGis.ts
// Client for the Building Inspector GIS endpoints (backend routes/inspector-gis.js).
// Contract: docs/superpowers/specs/2026-09-13-inspector-gis-design.md
//
// Errors propagate. A failed site load must never render as an empty district,
// and a failed site check must never render as "clear".

import api from './api'

export type SitePrecision = 'boundary' | 'point' | 'area' | 'none'
export type SiteSource = 'stands_register' | 'cadastre' | 'permit_location' | 'cadastre_area' | 'none'
export type PositionSource = 'intake' | 'case_file' | 'field_gps' | 'map_pick'
export type GeofenceResult = 'on_site' | 'off_site' | 'unverifiable'
export type ConstraintStatus = 'conflict' | 'review' | 'clear' | 'no_data'

type Position = [number, number]

export interface GeoJsonGeometry {
  type: string
  coordinates: unknown
}

export interface Feature<G extends GeoJsonGeometry | null, P> {
  type: 'Feature'
  id?: string | number
  geometry: G
  properties: P
}

export interface FeatureCollection<G extends GeoJsonGeometry | null, P> {
  type: 'FeatureCollection'
  features: Array<Feature<G, P>>
}

export interface CoarseArea {
  label: string
  areaHa: number | null
}

export interface SitePointProps {
  permitId: string
  ref: string
  title: string
  stand: string
  ward: string
  applicant: string
  developmentType: string
  permitStatus: string
  hasOccupationCertificate: boolean
  precision: SitePrecision
  source: SiteSource
  siteLabel: string | null
  coarseArea: CoarseArea | null
  lastStage: number | null
  lastResult: string | null
  scheduledAt: string | null
  inspectedAt: string | null
  openEnforcement: number
}

export interface EnforcementPointProps {
  orderId: string
  reference: string | null
  orderType: string
  status: string
  stand: string | null
  permitId: string | null
  complianceDueAt: string | null
  positionFrom: 'order' | 'permit_site' | 'none'
}

export interface InspectorSiteLayers {
  points: FeatureCollection<{ type: 'Point'; coordinates: Position } | null, SitePointProps>
  boundaries: FeatureCollection<GeoJsonGeometry, { permitId: string; ref: string; source: SiteSource }>
  enforcement: FeatureCollection<{ type: 'Point'; coordinates: Position } | null, EnforcementPointProps>
  unlocated: number
}

export interface ResolvedSite {
  permitId: string
  ref: string
  standNumber: string | null
  recordedWard: string | null
  source: SiteSource
  precision: SitePrecision
  label: string | null
  center: Position | null
  geometry: GeoJsonGeometry | null
  areaSqm: number | null
  coarseArea: CoarseArea | null
  position: { source: PositionSource | null; accuracyM: number | null; setAt: string | null }
}

export interface SiteConstraint {
  key: string
  label: string
  basis: 'statutory' | 'council_review'
  reference: string
  thresholdM: number
  status: ConstraintStatus
  distanceM: number | null
  feature: { name: string | null; fclass: string | null } | null
}

export interface FootprintProps {
  fid: number
  type: string | null
  areaSqm: number | null
  withinSite: boolean
  boundaryClearanceM: number | null
}

export interface SiteStructures {
  available: boolean
  source?: string
  count?: number
  footprintSqm?: number | null
  coveragePct?: number | null
  largestSqm?: number | null
  crossingBoundary?: number
  minBoundaryClearanceM?: number | null
  approvedPlinthSqm?: number | null
  exceedsApprovedPlinth?: boolean | null
  footprints?: FeatureCollection<GeoJsonGeometry, FootprintProps>
}

export interface SiteReport {
  generatedAt: string
  site: ResolvedSite
  permit: {
    status: string
    developmentType: string
    approvedPlinthSqm: number | null
    floors: number | null
    recordedStandAreaSqm: number | null
  }
  jurisdiction: {
    inJurisdiction: boolean
    district: string | null
    ward: string | null
    recordedWard: string | null
    wardMatchesRecord: boolean | null
  } | null
  zoning: {
    available: boolean
    zones: Array<{ id: number; zone: string; zoneCode: string | null; coveragePct: number | null }>
    controls: Array<{
      controlType: string
      landUse: string | null
      category: string | null
      authority: string | null
      conditions: string | null
    }>
  } | null
  constraints: SiteConstraint[]
  access: {
    available: boolean
    nearestRoad: { name: string | null; fclass: string | null; ref: string | null; distanceM: number | null } | null
    abutsRoad: boolean | null
    searchedM?: number
  } | null
  structures: SiteStructures | null
  neighbours: Array<{
    kind: 'stand' | 'parcel'
    label: string
    ward: string | null
    status: string | null
    areaSqm: number | null
    sharedBoundaryM: number | null
  }>
  nearbyCases: {
    radiusM: number
    permits: Array<{ permitId: string; ref: string; stand: string | null; status: string; developmentType: string; distanceM: number | null }>
    enforcement: Array<{
      orderId: string; reference: string | null; orderType: string; status: string
      stand: string | null; onThisPermit: boolean; open: boolean; distanceM: number | null
    }>
  } | null
  limitations: string[]
}

export type IdentifyAssessment =
  | 'outside_jurisdiction'
  | 'permitted_case'
  | 'case_not_approved'
  | 'structure_without_case'
  | 'no_case'

export interface IdentifyResult {
  point: Position
  jurisdiction: { inJurisdiction: boolean; district: string | null; ward: string | null }
  stand: { id: string; standNumber: string; ward: string | null; zoneType: string | null; status: string | null; areaSqm: number | null } | null
  parcel: { fid: number; name: string; status: string | null; areaSqm: number | null } | null
  zone: { id: number; zone: string; zoneCode: string | null } | null
  building: { fid: number; type: string | null; areaSqm: number | null; geometry: GeoJsonGeometry | null } | null
  cases: Array<{
    permitId: string
    ref: string
    title: string
    stand: string | null
    status: string
    developmentType: string
    hasOccupationCertificate: boolean
    precision: SitePrecision
    distanceM: number | null
    match: 'on_site' | 'nearby'
  }>
  enforcement: Array<{ orderId: string; reference: string | null; orderType: string; status: string; stand: string | null; permitId: string | null }>
  assessment: IdentifyAssessment
  radiusM: number
}

export type GeoVerdict = 'consistent' | 'discrepancy' | 'insufficient' | 'unverifiable'

export interface GeoVerification {
  inspectionId: string
  stageNumber: number
  site: { precision: SitePrecision; source: SiteSource; center: Position | null; label: string | null } | null
  tolerance: { boundaryM: number; pointM: number; maxAccuracyCreditM: number }
  arrivals: Array<{
    eventId: string
    recordedAt: string
    hasFix: boolean
    accuracyM: number | null
    distanceM: number | null
    result: GeofenceResult | null
    sitePrecisionAtTime: SitePrecision | null
  }>
  photos: Array<{
    photoId: string
    caption: string | null
    takenAt: string | null
    hasFix: boolean
    distanceM: number | null
    result: GeofenceResult | null
  }>
  summary: {
    arrivalsWithFix: number
    photos: number
    geotaggedPhotos: number
    onSite: number
    offSite: number
    verdict: GeoVerdict
  }
}

export interface SiteLocationInput {
  lng: number
  lat: number
  source: 'field_gps' | 'map_pick'
  accuracy_m?: number
  reason: string
}

export interface SiteLocationResult {
  site: ResolvedSite | null
  revision: number
  movedM: number | null
  boundaryChecked: boolean
}

function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

export const inspectorGis = {
  async sites(scope: 'inspectable' | 'all' = 'inspectable'): Promise<InspectorSiteLayers> {
    return data(await api.get('/inspector/sites', { params: { scope } }))
  },

  async siteReport(permitId: string): Promise<SiteReport> {
    return data(await api.get(`/inspector/permits/${encodeURIComponent(permitId)}/site-report`))
  },

  async identify(lng: number, lat: number): Promise<IdentifyResult> {
    return data(await api.get('/inspector/identify', { params: { lng, lat } }))
  },

  async geoVerification(inspectionId: string): Promise<GeoVerification> {
    return data(await api.get(`/stage-inspections/${encodeURIComponent(inspectionId)}/geo-verification`))
  },

  async setSiteLocation(permitId: string, input: SiteLocationInput): Promise<SiteLocationResult> {
    return data(await api.put(`/permit-applications/${encodeURIComponent(permitId)}/site-location`, input))
  },
}
