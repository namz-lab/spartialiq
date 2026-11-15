// The public map's legend and plan identity, from the plan itself and the published zone style (never hand-typed colours).
import api from './api'

export interface PlanIdentity {
  id: string
  title: string
  version: number
  status: string
  authority: string | null
  provisional: boolean
  revision_label: string | null
  revision_date: string | null
  map_scale: number | null
  gazette_ref: string | null
  effective_from: string | null
  adopted_by_council: boolean
  approved_by_minister: boolean
  zones: Array<{ name: string; polygons: number; hectares: number | null }>
}
export interface LegendEntry { label: string; fill: string; hectares: number | null }

export async function getPlanIdentity(): Promise<{ plans: PlanIdentity[]; published: boolean }> {
  const r = await api.get('/plan-lookup/identity')
  return r.data.data
}

interface Category { label?: string; value?: string; symbol?: { fill?: string } }
interface ZoneStyle { definition?: { renderer?: { categories?: Category[]; fallback?: { symbol?: { fill?: string } } } } }

/**
 * One legend row for each zone the plan holds, coloured as the map paints it (the published style's category for that zone name).
 * A zone the style does not know about is listed with the style's fallback colour, so the legend never claims a colour the map does not use.
 */
export function legendFor(styles: Array<ZoneStyle | null> | ZoneStyle | null, plan: PlanIdentity | null): LegendEntry[] {
  const list = (Array.isArray(styles) ? styles : [styles]).filter((s): s is ZoneStyle => Boolean(s?.definition?.renderer))
  if (!list.length || !plan) return []
  // the zones are drawn by more than one layer (the peri-urban zones, and the areas beyond them), each with its own published style
  const byValue = new Map<string, string>()
  for (const st of list) for (const c of st.definition!.renderer!.categories ?? []) byValue.set(String(c.value ?? c.label), c.symbol?.fill ?? '')
  const fallback = list[0].definition!.renderer!.fallback?.symbol?.fill ?? '#efeadf'
  return plan.zones.map((z) => ({ label: z.name, fill: byValue.get(z.name) || fallback, hectares: z.hectares }))
}

/** One row of the key for a layer coloured by kind (facilities, land features): the published style's own categories. */
export interface KindEntry { label: string; fill: string; shape: 'dot' | 'area' }
export function kindLegend(style: ZoneStyle | null, shape: 'dot' | 'area'): KindEntry[] {
  const cats = style?.definition?.renderer?.categories ?? []
  return cats.map((c) => ({ label: String(c.label ?? c.value), fill: c.symbol?.fill ?? '#cccccc', shape }))
}

/** "Rev 005 · July 2026 · 1:120 000" */
export function identityLine(p: Pick<PlanIdentity, 'revision_label' | 'revision_date' | 'map_scale'>): string {
  const date = p.revision_date ? new Date(p.revision_date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null
  const scale = p.map_scale ? `1:${p.map_scale.toLocaleString('en').replace(/,/g, ' ')}` : null
  return [p.revision_label, date, scale].filter(Boolean).join(' · ')
}

export function standing(p: PlanIdentity): string {
  if (p.status === 'gazetted') return p.effective_from ? `In force since ${new Date(p.effective_from).toLocaleDateString('en-GB')}` : 'In force'
  return 'Not yet in force: shown for information'
}
