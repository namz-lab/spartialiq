import type { PlanningDecision } from '@/services/planningAssistantService'
import api from '@/services/api'
import { locateStand, type FoundParcel } from '@/services/parcels'

/**
 * The one parcel whose stand number IS the case's stand, or null. A search
 * hit is only used to place a case when it is unambiguous: a partial or
 * multiple match would pin the application on someone else's land.
 */
export function exactStandMatch(found: FoundParcel[], standNo: string): FoundParcel | null {
  const want = standNo.trim().toLowerCase().replace(/^stand\s+/, '')
  if (!want) return null
  const hits = found.filter(p => p.stand_number?.trim().toLowerCase() === want)
  return hits.length === 1 ? hits[0] : null
}

export interface SiteParcel {
  layer: string
  fid: number
  name: string | null
  areaHa: number | null
  perimeterM: number | null
  centroid: [number, number] | null
  boundary: unknown
  complexity: string
  rawValid: boolean
}

export interface SiteContext {
  parcel: SiteParcel
  developableHa: number | null
  roads: Array<{ fid: number; name: string | null; fclass: string | null; ref: string | null; lengthInParcelM: number | null; entryPoints: unknown[] }>
  water: { streams: Array<{ fid: number; name: string | null; fclass: string | null; lengthInParcelM: number | null }>; waterAreas: Array<{ fclass: string; areaHa: number | null }> }
  terrain: Array<{ fclass: string; areaHa: number | null }>
  protected: Array<{ fclass: string; areaHa: number | null }>
  landuse: Array<{ fclass: string; areaHa: number | null }>
  buildings: { count: number; totalAreaSqm: number | null; avgFootprintSqm: number | null }
  settlements: Array<{ name: string | null; fclass: string | null; population: number | null; distKm: number | null }>
  amenities: { schools: unknown[]; health: unknown[] }
  nogo: unknown
}

export interface SiteConstraint {
  label: string
  ok: boolean
}

export interface SiteSummary {
  areaSqm: number | null
  landUse: string | null
  developableSqm: number | null
  adjacentCount: number
  constraints: SiteConstraint[]
  requiredReferrals: string[]
}

function hasGeometry(nogo: unknown): boolean {
  if (!nogo || typeof nogo !== 'object') return false
  const coords = (nogo as { coordinates?: unknown }).coordinates
  return Array.isArray(coords) && coords.length > 0
}

export function summariseSiteContext(ctx: SiteContext): SiteSummary {
  const areaSqm = ctx.parcel.areaHa == null ? null : Math.round(ctx.parcel.areaHa * 10_000)
  const developableSqm = ctx.developableHa == null ? null : Math.round(ctx.developableHa * 10_000)
  const landUse = ctx.landuse[0]?.fclass ?? null
  const constraints: SiteConstraint[] = []

  if (ctx.water.streams.length || ctx.water.waterAreas.length) {
    constraints.push({ label: 'Watercourse or wetland intersects the parcel', ok: false })
  }
  if (ctx.protected.length) {
    constraints.push({ label: 'Protected area overlap', ok: false })
  }
  if (ctx.terrain.length) {
    constraints.push({ label: 'Terrain constraint present', ok: false })
  }
  constraints.push({ label: 'No heritage conflict recorded on this layer', ok: true })

  const primaryRoad = ctx.roads.some(r => /primary|trunk|motorway|secondary/i.test(r.fclass ?? ''))
  if (primaryRoad) {
    constraints.push({ label: 'Traffic assessment required', ok: false })
  }

  if (hasGeometry(ctx.nogo)) {
    constraints.push({ label: 'No-go overlay present — building line requires review', ok: false })
  }

  const requiredReferrals = ['Engineering']
  if (primaryRoad) requiredReferrals.push('Traffic')
  if (ctx.water.streams.length || ctx.water.waterAreas.length) requiredReferrals.push('Health')
  requiredReferrals.push('Fire')

  return {
    areaSqm,
    landUse,
    developableSqm,
    adjacentCount: ctx.settlements.length,
    constraints,
    requiredReferrals,
  }
}

export type PlanningVerdict = 'COMPLIANT' | 'NON-COMPLIANT' | 'WARNING' | 'PLANNER REVIEW REQUIRED'

export function verdictFromDecision(decision: PlanningDecision): { verdict: PlanningVerdict; why: string } {
  switch (decision) {
    case 'permitted':
      return { verdict: 'COMPLIANT', why: 'The proposed use is permitted in this zone.' }
    case 'prohibited':
      return { verdict: 'NON-COMPLIANT', why: 'The proposed use is prohibited in this zone.' }
    case 'special_consent':
      return { verdict: 'PLANNER REVIEW REQUIRED', why: 'The use needs special consent before it can proceed.' }
    default:
      return { verdict: 'WARNING', why: 'The rules engine could not determine a permission for this location.' }
  }
}

export async function analyseSiteAt(lng: number, lat: number): Promise<{ context: SiteContext; summary: SiteSummary; layer: string; fid: number } | null> {
  const loc = await locateStand(lng, lat)
  const fid = loc.stand?.fid
  if (fid == null) return null
  const layer = 'vungu_parcels'
  const r = await api.post('/planning/site-context', { layer, fid })
  const context = (r.data?.data ?? r.data) as SiteContext
  return { context, summary: summariseSiteContext(context), layer, fid }
}

/** Downloads the server-generated Site Planning Screening Report PDF. */
export async function downloadSiteAssessmentReport(opts: {
  layer: string
  fid: number
  applicationRef?: string
  summary?: SiteSummary
}): Promise<void> {
  const r = await api.post('/planning/site-assessment-report', {
    layer: opts.layer,
    fid: opts.fid,
    applicationRef: opts.applicationRef,
    summary: opts.summary,
  }, { responseType: 'blob' })
  const blob = new Blob([r.data], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `VRDC-Site-Screening-${opts.layer}-${opts.fid}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

