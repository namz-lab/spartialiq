// Land budget and stand schedule for a layout plan, from a Planning Studio
// snapshot (spatial_planning.planning_project.data). Pure.
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Lot, LotUseType, PlanningProject } from '@/planning/planning-types'

export type BudgetCategory = 'residential' | 'commercial' | 'institutional' | 'open_space' | 'roads' | 'unallocated'

const CATEGORY_OF: Record<LotUseType, BudgetCategory> = {
  single_residential: 'residential', duplex: 'residential', townhouse: 'residential',
  mixed_use: 'commercial', commercial: 'commercial',
  school: 'institutional', health: 'institutional', community_centre: 'institutional', place_of_worship: 'institutional',
  open_space: 'open_space', recreation: 'open_space',
}

export const CATEGORY_LABEL: Record<BudgetCategory, string> = {
  residential: 'Residential', commercial: 'Commercial and mixed use', institutional: 'Institutional and community',
  open_space: 'Open space and recreation', roads: 'Roads', unallocated: 'Unallocated / excluded',
}

// ponytail: advisory planning norms for a rural-district residential layout.
// Council to confirm; move to StandardsConfig if they vary by zone.
export const NORMS: Partial<Record<BudgetCategory, { min: number; max: number }>> = {
  residential: { min: 50, max: 65 },
  commercial: { min: 2, max: 8 },
  institutional: { min: 5, max: 12 },
  open_space: { min: 5, max: 15 },
  roads: { min: 15, max: 25 },
}

export interface BudgetRow { category: BudgetCategory; areaSqm: number; pct: number; verdict: 'within' | 'below' | 'above' | 'n/a' }

type Snapshot = Pick<PlanningProject, 'planningArea' | 'lots' | 'roads' | 'openSpace'>

export function roadReserveSqm(roads: Snapshot['roads']): number {
  return (roads ?? []).reduce((s, r) => s + turf.length(turf.feature(r.geom), { units: 'meters' }) * (r.widthM || 0), 0)
}

export function landBudget(p: Snapshot): BudgetRow[] {
  const total = p.planningArea?.areaSqm || 0
  const area: Record<BudgetCategory, number> = { residential: 0, commercial: 0, institutional: 0, open_space: 0, roads: 0, unallocated: 0 }
  for (const l of p.lots ?? []) area[CATEGORY_OF[l.useType ?? 'single_residential'] ?? 'residential'] += l.areaSqm || 0
  for (const o of p.openSpace ?? []) if (o.kind !== 'leftover') area.open_space += o.areaSqm || 0
  area.roads = roadReserveSqm(p.roads)
  const allocated = area.residential + area.commercial + area.institutional + area.open_space + area.roads
  area.unallocated = Math.max(0, total - allocated)
  return (Object.keys(area) as BudgetCategory[]).map(category => {
    const pct = total ? Math.round((area[category] / total) * 1000) / 10 : 0
    const n = NORMS[category]
    return {
      category, areaSqm: Math.round(area[category]), pct,
      verdict: !n || !total ? 'n/a' : pct < n.min ? 'below' : pct > n.max ? 'above' : 'within',
    }
  })
}

export interface ScheduleRow { use: string; count: number; minSqm: number; avgSqm: number; maxSqm: number; totalSqm: number }

export function standSchedule(lots: Lot[]): ScheduleRow[] {
  const by = new Map<string, number[]>()
  for (const l of lots ?? []) {
    const k = l.useType ?? 'single_residential'
    by.set(k, [...(by.get(k) ?? []), l.areaSqm || 0])
  }
  return [...by.entries()].map(([use, a]) => ({
    use: use.replace(/_/g, ' '),
    count: a.length,
    minSqm: Math.round(Math.min(...a)),
    avgSqm: Math.round(a.reduce((s, x) => s + x, 0) / a.length),
    maxSqm: Math.round(Math.max(...a)),
    totalSqm: Math.round(a.reduce((s, x) => s + x, 0)),
  })).sort((x, y) => y.count - x.count)
}
