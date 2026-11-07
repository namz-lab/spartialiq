// src/planning/studio-dxf.ts
// ─────────────────────────────────────────────────────────────────────────
// Planning Studio DXF interchange: collect a georeferenced payload for
// dxfExport.ts (subdivision + CAD linework) and turn imported GeoJSON back
// into CAD entities. Lots/roads stay on LOTS/ROADS so they round-trip through
// usePlanningTools().importDxf(); CAD entities use a CAD- prefix so AutoCAD
// does not merge them with the planning ROADS layer (DXF layer names are
// case-insensitive).
// ─────────────────────────────────────────────────────────────────────────

import type { Feature, Geometry } from 'geojson'
import type { DxfLabel } from '@/map/tools/dxfExport'
import type { CadEntity, CadEntityType, CadLayer } from './cad/cadModel'
import type { ConstraintLayer, Lot, OpenSpace, PlanningArea, RoadSegment } from './planning-types'
import { dxfLayerForCadLayerId, dxfLayerForKind } from './dxf/layerRegistry'

export interface StudioDxfPayload {
  features: Feature[]
  labels: DxfLabel[]
}

export interface CadDraftItem {
  type: CadEntityType
  geom: Geometry
  layerId: string
  text?: string
  sourceLayer?: string
}

function cadKind(type: CadEntityType): string {
  if (type === 'rectangle' || type === 'polygon' || type === 'hatch') return 'polygon'
  if (type === 'circle') return 'circle'
  if (type === 'arc') return 'arc'
  if (type === 'polyline') return 'polyline'
  if (type === 'line') return 'line'
  return 'polyline'
}

export function collectStudioDxfPayload(args: {
  planningArea: PlanningArea | null
  constraints: ConstraintLayer[]
  roads: RoadSegment[]
  openSpace: OpenSpace[]
  lots: Lot[]
  cadEntities: CadEntity[]
  cadLayers: CadLayer[]
}): StudioDxfPayload {
  const features: Feature[] = []
  const labels: DxfLabel[] = []
  const a = args.planningArea
  if (a) features.push({ type: 'Feature', properties: { kind: 'boundary', id: a.name, dxfLayer: dxfLayerForKind('boundary') }, geometry: a.geom })
  for (const c of args.constraints) {
    features.push({ type: 'Feature', properties: { kind: 'constraint', id: c.label, dxfLayer: dxfLayerForKind('constraint') }, geometry: c.geom })
  }
  for (const r of args.roads) {
    features.push({
      type: 'Feature',
      properties: { kind: 'road', dxfLayer: dxfLayerForKind('road', r.hierarchy) },
      geometry: r.geom,
    })
  }
  for (const o of args.openSpace) {
    features.push({ type: 'Feature', properties: { kind: 'open_space', dxfLayer: dxfLayerForKind('open_space') }, geometry: o.geom })
  }
  for (const l of args.lots) {
    features.push({
      type: 'Feature',
      properties: { kind: 'lot', id: `Lot ${l.lotNumber ?? ''}`.trim(), roundTripId: l.id, dxfLayer: dxfLayerForKind('lot') },
      geometry: l.geom,
    })
  }
  for (const e of args.cadEntities) {
    if (e.visible === false) continue
    if (e.type === 'symbol') continue
    if ((e.type === 'text' || e.type === 'dimension') && e.geom.type === 'Point' && e.text) {
      labels.push({ lngLat: e.geom.coordinates as [number, number], text: e.text })
      continue
    }
    if (e.type === 'dimension') continue
    if (!e.geom || e.geom.type === 'Point') continue
    features.push({
      type: 'Feature',
      properties: { kind: cadKind(e.type), dxfLayer: dxfLayerForCadLayerId(e.layerId) },
      geometry: e.geom,
    })
  }
  return { features, labels }
}

export function resolveCadLayerId(dxfLayer: string, cadLayers: CadLayer[], fallbackLayerId: string): string {
  const raw = String(dxfLayer || '').replace(/^CAD-/i, '').replace(/^VUNGU[_-]?/i, '').replace(/[_-]+/g, ' ').trim()
  if (!raw) return fallbackLayerId
  const slug = raw.toLowerCase().replace(/\s+/g, '-')
  const byId = cadLayers.find(l => l.id.toLowerCase() === slug)
  if (byId) return byId.id
  const byName = cadLayers.find(l => l.name.toLowerCase() === raw.toLowerCase())
  if (byName) return byName.id
  if (/annot|title|text|dimension/i.test(raw)) return cadLayers.find(l => l.id === 'annotation')?.id || fallbackLayerId
  if (/stand|lot/i.test(raw)) return cadLayers.find(l => l.id === 'stands')?.id || fallbackLayerId
  if (/facilit|build/i.test(raw)) return cadLayers.find(l => l.id === 'facilities')?.id || fallbackLayerId
  if (/arterial|primary|highway/i.test(raw)) return cadLayers.find(l => l.id === 'roads-arterial')?.id || fallbackLayerId
  if (/collector|spine|secondary/i.test(raw)) return cadLayers.find(l => l.id === 'roads-collector')?.id || fallbackLayerId
  if (/access|lane|cul/i.test(raw)) return cadLayers.find(l => l.id === 'roads-access')?.id || fallbackLayerId
  if (/road|street|local/i.test(raw)) return cadLayers.find(l => l.id === 'roads')?.id || fallbackLayerId
  return fallbackLayerId
}

export function cadDraftFromDxfFeatures(
  features: Array<{ properties?: Record<string, unknown> | null; geometry: Geometry | null }>,
  cadLayers: CadLayer[],
  fallbackLayerId: string,
): CadDraftItem[] {
  const items: CadDraftItem[] = []
  for (const f of features) {
    if (!f.properties?.cad || !f.geometry) continue
    if (f.properties.gisRole === 'cadastral-read-only') continue
    const layerId = resolveCadLayerId(String(f.properties.layer || ''), cadLayers, fallbackLayerId)
    const g = f.geometry
    const text = typeof f.properties.text === 'string' ? f.properties.text : undefined
    if (g.type === 'Point') {
      if (text) items.push({ type: 'text', geom: g, layerId, text, sourceLayer: String(f.properties.layer || '') })
      continue
    }
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const type: CadEntityType = f.properties.cadType === 'circle' ? 'circle' : 'polygon'
      items.push({ type, geom: g, layerId, sourceLayer: String(f.properties.layer || '') })
      continue
    }
    if (g.type === 'LineString') {
      const type: CadEntityType = f.properties.cadType === 'arc'
        ? 'arc'
        : g.coordinates.length === 2 ? 'line' : 'polyline'
      items.push({ type, geom: g, layerId, sourceLayer: String(f.properties.layer || '') })
    }
  }
  return items
}
