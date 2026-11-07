// Versioned DXF ↔ Vungu planning-object mapping.
// Unknown AutoCAD layer names never become GIS layers. They stay unmapped until
// the planner accepts them as CAD annotation, or the import is blocked.

export const LAYER_MAP_VERSION = 1
export const SOURCE_STYLE_VERSION = 'planning-studio-1'
export const DXF_VERSION = 'AC1009'
export const DXF_UNITS = 'metres' as const
export const INSUNITS_METRES = 6

export type PlanningObjectType =
  | 'ROAD'
  | 'ROAD_RESERVE'
  | 'STAND'
  | 'OPEN_SPACE'
  | 'PUBLIC_FACILITY'
  | 'WATER_BODY'
  | 'BUILDING'
  | 'BOUNDARY'
  | 'ANNOTATION'
  | 'DIMENSION'
  | 'CONSTRAINT'
  | 'DRAINAGE'

export type GisRole = 'planning' | 'cad' | 'cadastral-read-only' | 'annotation'

export type RoadHierarchy = 'arterial' | 'collector' | 'local' | 'access'

export interface LayerMapping {
  dxfLayer: string
  objectType: PlanningObjectType
  gisRole: GisRole
  aliases: string[]
  planningKind?: string
  roadHierarchy?: RoadHierarchy
}

export const LAYER_REGISTRY: readonly LayerMapping[] = [
  {
    dxfLayer: 'VUNGU_STANDS',
    objectType: 'STAND',
    gisRole: 'planning',
    aliases: ['LOTS', 'STANDS'],
    planningKind: 'lot',
  },
  {
    dxfLayer: 'VUNGU_ROADS_ARTERIAL',
    objectType: 'ROAD',
    gisRole: 'planning',
    aliases: ['ROADS-ARTERIAL', 'ARTERIAL'],
    planningKind: 'road',
    roadHierarchy: 'arterial',
  },
  {
    dxfLayer: 'VUNGU_ROADS_COLLECTOR',
    objectType: 'ROAD',
    gisRole: 'planning',
    aliases: ['ROADS-COLLECTOR', 'COLLECTOR'],
    planningKind: 'road',
    roadHierarchy: 'collector',
  },
  {
    dxfLayer: 'VUNGU_ROADS_ACCESS',
    objectType: 'ROAD',
    gisRole: 'planning',
    aliases: ['ROADS-ACCESS', 'ACCESS'],
    planningKind: 'road',
    roadHierarchy: 'access',
  },
  {
    dxfLayer: 'VUNGU_ROADS',
    objectType: 'ROAD',
    gisRole: 'planning',
    aliases: ['ROADS', 'CAD-ROADS', 'STREETS', 'ROADS-LOCAL'],
    planningKind: 'road',
    roadHierarchy: 'local',
  },
  {
    dxfLayer: 'VUNGU_RESERVES',
    objectType: 'OPEN_SPACE',
    gisRole: 'planning',
    aliases: ['OPEN-SPACE', 'OPEN_SPACE', 'RESERVES', 'CAD-RESERVES'],
    planningKind: 'open_space',
  },
  {
    dxfLayer: 'VUNGU_BUILDINGS',
    objectType: 'BUILDING',
    gisRole: 'cad',
    aliases: ['BUILDINGS', 'CAD-FACILITIES', 'FACILITIES'],
    planningKind: 'polygon',
  },
  {
    dxfLayer: 'VUNGU_DRAINAGE',
    objectType: 'DRAINAGE',
    gisRole: 'cad',
    aliases: ['DRAINAGE', 'CAD-DRAINAGE'],
  },
  {
    dxfLayer: 'VUNGU_BOUNDARIES',
    objectType: 'BOUNDARY',
    gisRole: 'cadastral-read-only',
    aliases: ['BOUNDARY', 'BOUNDARIES', 'CAD-BOUNDARY'],
    planningKind: 'boundary',
  },
  {
    dxfLayer: 'VUNGU_CONSTRAINTS',
    objectType: 'CONSTRAINT',
    gisRole: 'cad',
    aliases: ['CONSTRAINTS', 'CAD-CONSTRAINTS'],
    planningKind: 'constraint',
  },
  {
    dxfLayer: 'VUNGU_ANNOTATION',
    objectType: 'ANNOTATION',
    gisRole: 'annotation',
    aliases: ['ANNOTATION', 'PARCEL-AREAS', 'TITLE', 'CAD-ANNOTATION', 'TEXT'],
  },
  {
    dxfLayer: 'VUNGU_DIMENSIONS',
    objectType: 'DIMENSION',
    gisRole: 'annotation',
    aliases: ['DIMENSIONS', 'CAD-DIMENSIONS'],
    planningKind: 'dimension',
  },
  {
    dxfLayer: 'VUNGU_MANIFEST',
    objectType: 'ANNOTATION',
    gisRole: 'annotation',
    aliases: [],
  },
]

const INDEX = new Map<string, LayerMapping>()
for (const m of LAYER_REGISTRY) {
  INDEX.set(m.dxfLayer.toUpperCase(), m)
  for (const a of m.aliases) INDEX.set(a.toUpperCase(), m)
}

export function normalizeLayerName(name: string): string {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, '_')
}

export function resolveLayer(name: string): LayerMapping | null {
  const key = normalizeLayerName(name)
  if (!key) return null
  const direct = INDEX.get(key)
  if (direct) return direct
  const dashed = INDEX.get(key.replace(/_/g, '-'))
  if (dashed) return dashed
  const underscored = INDEX.get(key.replace(/-/g, '_'))
  return underscored || null
}

export function dxfLayerForKind(kind: string, hierarchy?: string): string {
  if (kind === 'lot') return 'VUNGU_STANDS'
  if (kind === 'boundary') return 'VUNGU_BOUNDARIES'
  if (kind === 'open_space') return 'VUNGU_RESERVES'
  if (kind === 'constraint') return 'VUNGU_CONSTRAINTS'
  if (kind === 'dimension') return 'VUNGU_DIMENSIONS'
  if (kind === 'road') {
    const h = String(hierarchy || '').toLowerCase()
    if (h === 'arterial') return 'VUNGU_ROADS_ARTERIAL'
    if (h === 'collector') return 'VUNGU_ROADS_COLLECTOR'
    if (h === 'access') return 'VUNGU_ROADS_ACCESS'
    return 'VUNGU_ROADS'
  }
  return 'VUNGU_ANNOTATION'
}

export function dxfLayerForCadLayerId(layerId: string): string {
  const id = String(layerId || '').toLowerCase()
  if (id === 'roads-arterial') return 'VUNGU_ROADS_ARTERIAL'
  if (id === 'roads-collector') return 'VUNGU_ROADS_COLLECTOR'
  if (id === 'roads-access') return 'VUNGU_ROADS_ACCESS'
  if (id === 'roads') return 'VUNGU_ROADS'
  if (id === 'stands') return 'VUNGU_BUILDINGS'
  if (id === 'facilities') return 'VUNGU_BUILDINGS'
  if (id === 'annotation') return 'VUNGU_ANNOTATION'
  return 'VUNGU_ANNOTATION'
}

export function isStandLayer(name: string): boolean {
  return resolveLayer(name)?.objectType === 'STAND'
}

export function isRoadLayer(name: string): boolean {
  return resolveLayer(name)?.objectType === 'ROAD'
}

export function isBoundaryLayer(name: string): boolean {
  return resolveLayer(name)?.gisRole === 'cadastral-read-only'
}

export function isLabelLayer(name: string): boolean {
  const m = resolveLayer(name)
  return m?.objectType === 'ANNOTATION' || m?.dxfLayer === 'VUNGU_MANIFEST'
}
