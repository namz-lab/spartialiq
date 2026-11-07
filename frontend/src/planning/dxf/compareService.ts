// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Geometry, LineString, Polygon } from 'geojson'
import type { Lot, RoadSegment } from '../planning-types'
import type { CadEntity } from '../cad/cadModel'
import type { ChangeItem, ChangeSet } from './types'

function centroid(g: Geometry): [number, number] | null {
  try {
    const c = turf.centroid(turf.feature(g as any) as any)
    return c.geometry.coordinates as [number, number]
  } catch { return null }
}

function distM(a: [number, number], b: [number, number]): number {
  return turf.distance(a, b, { units: 'meters' })
}

function areaOf(g: Geometry): number {
  try {
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') return turf.area(turf.feature(g as any) as any)
  } catch { /* */ }
  return 0
}

function lengthOf(g: Geometry): number {
  try {
    if (g.type === 'LineString' || g.type === 'MultiLineString') return turf.length(turf.feature(g as any) as any, { units: 'meters' })
  } catch { /* */ }
  return 0
}

function sameGeom(a: Geometry, b: Geometry, tolM: number): boolean {
  const ca = centroid(a), cb = centroid(b)
  if (!ca || !cb) return false
  if (distM(ca, cb) > tolM) return false
  const aa = areaOf(a), ab = areaOf(b)
  if (aa && ab && Math.abs(aa - ab) / Math.max(aa, ab) > 0.02) return false
  const la = lengthOf(a), lb = lengthOf(b)
  if (la && lb && Math.abs(la - lb) / Math.max(la, lb) > 0.02) return false
  return true
}

export interface CompareInput {
  lots: Lot[]
  roads: RoadSegment[]
  cadEntities: CadEntity[]
  importedLots: Feature<Polygon>[]
  importedRoads: Feature<LineString>[]
  importedCad: Feature[]
}

export function compareDrawings(input: CompareInput): ChangeSet {
  const added: ChangeItem[] = []
  const modified: ChangeItem[] = []
  const deleted: ChangeItem[] = []
  const moved: ChangeItem[] = []
  const resized: ChangeItem[] = []
  const layerChanged: ChangeItem[] = []

  const usedLots = new Set<string>()
  const byId = new Map(input.lots.map(l => [l.id, l]))
  const numberCounts = new Map<string, number>()
  for (const l of input.lots) if (l.lotNumber) numberCounts.set(l.lotNumber, (numberCounts.get(l.lotNumber) || 0) + 1)
  const byNumber = new Map<string, Lot>()
  for (const l of input.lots) if (l.lotNumber && numberCounts.get(l.lotNumber) === 1) byNumber.set(l.lotNumber, l)

  input.importedLots.forEach((f, i) => {
    const lotId = f.properties?.lotId as string | undefined
    const lotNumber = f.properties?.lotNumber as string | undefined
    const prev = (lotId && byId.get(lotId)) || (lotNumber ? byNumber.get(lotNumber) : undefined)
    const g = f.geometry
    if (prev && !usedLots.has(prev.id)) {
      usedLots.add(prev.id)
      const conf: ChangeItem['confidence'] = lotId && byId.has(lotId) ? 'identity' : 'geometric'
      const pc = centroid(prev.geom), ic = centroid(g)
      const movedM = pc && ic ? distM(pc, ic) : 0
      const areaDelta = Math.abs(areaOf(g) - prev.areaSqm)
      if (movedM > 0.8 && areaDelta / Math.max(prev.areaSqm, 1) < 0.08) {
        moved.push({ id: prev.id, kind: 'stand', category: 'moved', label: `Stand ${prev.lotNumber || prev.id} moved ${movedM.toFixed(1)} m`, confidence: conf, geometry: g })
      } else if (areaDelta > 2 && movedM <= 0.8) {
        resized.push({ id: prev.id, kind: 'stand', category: 'resized', label: `Stand ${prev.lotNumber || prev.id} area ${prev.areaSqm} → ${Math.round(areaOf(g))} m²`, confidence: conf, geometry: g })
      } else if (!sameGeom(prev.geom, g, 0.4)) {
        modified.push({ id: prev.id, kind: 'stand', category: 'modified', label: `Stand ${prev.lotNumber || prev.id} geometry changed`, confidence: conf, geometry: g })
      }
    } else {
      added.push({ id: `new-stand-${i}`, kind: 'stand', category: 'added', label: lotNumber ? `Stand ${lotNumber} added` : 'Stand added', confidence: lotId ? 'identity' : 'geometric', geometry: g })
    }
  })
  for (const l of input.lots) {
    if (!usedLots.has(l.id)) {
      deleted.push({ id: l.id, kind: 'stand', category: 'deleted', label: `Stand ${l.lotNumber || l.id} not present in DXF`, confidence: 'geometric', geometry: l.geom })
    }
  }

  const usedRoads = new Set<string>()
  input.importedRoads.forEach((f, i) => {
    const g = f.geometry
    const c = centroid(g)
    let match: RoadSegment | undefined
    if (c) {
      let best = Infinity
      for (const r of input.roads) {
        if (usedRoads.has(r.id)) continue
        const rc = centroid(r.geom)
        if (!rc) continue
        const d = distM(c, rc)
        if (d < best && d < 8) { best = d; match = r }
      }
    }
    if (match) {
      usedRoads.add(match.id)
      const srcH = String((f.properties as any)?.hierarchy || '')
      if (srcH && srcH !== match.hierarchy) {
        layerChanged.push({ id: match.id, kind: 'road', category: 'layer_changed', label: `Road class ${match.hierarchy} → ${srcH}`, confidence: 'geometric', geometry: g })
      } else if (!sameGeom(match.geom, g, 1.2)) {
        modified.push({ id: match.id, kind: 'road', category: 'modified', label: 'Road centre-line changed', confidence: 'geometric', geometry: g })
      }
    } else {
      added.push({ id: `new-road-${i}`, kind: 'road', category: 'added', label: `Road added (${(f.properties as any)?.hierarchy || 'local'})`, confidence: 'geometric', geometry: g })
    }
  })
  for (const r of input.roads) {
    if (!usedRoads.has(r.id)) {
      deleted.push({ id: r.id, kind: 'road', category: 'deleted', label: 'Road not present in DXF', confidence: 'geometric', geometry: r.geom })
    }
  }

  const usedCad = new Set<string>()
  input.importedCad.forEach((f, i) => {
    if ((f.properties as any)?.gisRole === 'cadastral-read-only') return
    const g = f.geometry
    const c = centroid(g)
    let match: CadEntity | undefined
    if (c) {
      let best = Infinity
      for (const e of input.cadEntities) {
        if (usedCad.has(e.id) || e.visible === false) continue
        const ec = centroid(e.geom)
        if (!ec) continue
        const d = distM(c, ec)
        if (d < best && d < 3) { best = d; match = e }
      }
    }
    if (match) {
      usedCad.add(match.id)
      if (!sameGeom(match.geom, g, 0.6)) {
        modified.push({ id: match.id, kind: 'cad', category: 'modified', label: 'CAD object changed', confidence: 'geometric', geometry: g })
      }
    } else {
      added.push({ id: `new-cad-${i}`, kind: 'cad', category: 'added', label: `CAD object on ${(f.properties as any)?.layer || 'layer'}`, confidence: 'geometric', geometry: g })
    }
  })

  return {
    method: 'identity-then-geometric',
    note: 'Stand identity is recovered from the #id token in area labels when AutoCAD preserves them. Otherwise comparison is geometric (centroid and area). Object handles do not survive AutoCAD.',
    added, modified, deleted, moved, resized, layerChanged,
    totals: {
      added: added.length,
      modified: modified.length + layerChanged.length,
      deleted: deleted.length,
      moved: moved.length,
      resized: resized.length,
    },
  }
}

export function changeReportText(cs: ChangeSet): string {
  const lines = [
    'Vungu Planning Studio — DXF change report',
    `Method: ${cs.method}`,
    cs.note,
    `Added ${cs.totals.added} · Modified ${cs.totals.modified} · Removed ${cs.totals.deleted} · Moved ${cs.totals.moved} · Resized ${cs.totals.resized}`,
    '',
    ...[...cs.added, ...cs.modified, ...cs.moved, ...cs.resized, ...cs.layerChanged, ...cs.deleted]
      .map(i => `- [${i.category}/${i.confidence}] ${i.label}`),
  ]
  return lines.join('\n')
}
