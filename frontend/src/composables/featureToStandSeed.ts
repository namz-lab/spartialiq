// Normalises a clicked map feature into the minimal "stand seed" the
// statutory intake form needs. Map features come from many PostGIS layers
// whose property names are not consistent, so we probe candidate keys per
// field and fall back to empty strings.

export interface StandSeed {
  standNo: string
  ward: string
  description: string
  centroid?: [number, number]
}

// A clicked feature as VunguPlannerView exposes it: arbitrary GeoJSON
// properties plus a few underscore-prefixed helpers attached on click.
export interface MapFeatureLike {
  properties?: Record<string, unknown> | null
  _clickCoord?: string | null
  _center?: [number, number] | null
}

const STAND_KEYS = ['stand_number', 'stand_no', 'standno', 'stand', 'parcel_id',
  'parcelid', 'erf_number', 'erf_no', 'plot_number', 'plot_no']
const WARD_KEYS  = ['ward', 'ward_name', 'ward_no', 'wardno', 'suburb_ward', 'suburb']
const DESC_KEYS  = ['description', 'desc', 'land_use', 'landuse', 'use', 'name', 'label']

function firstString(props: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

function parseClickCoord(s: string | null | undefined): [number, number] | undefined {
  if (!s) return undefined
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const a = Number(m[1]); const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  return [a, b]
}

export function featureToStandSeed(feature: MapFeatureLike | null | undefined): StandSeed {
  const props = (feature?.properties ?? {}) as Record<string, unknown>
  const centroid: [number, number] | undefined =
    (feature?._center ?? undefined) ?? parseClickCoord(feature?._clickCoord)
  return {
    standNo: firstString(props, STAND_KEYS),
    ward: firstString(props, WARD_KEYS),
    description: firstString(props, DESC_KEYS),
    centroid,
  }
}
