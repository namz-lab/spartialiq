import JSZip from 'jszip'
import type { Feature, LineString, Polygon } from 'geojson'
import {
  inspectDxf,
  metresScaleForInsunits,
  parseDxfToGeoJSON,
  expectedUtmEpsg,
} from '@/map/tools/dxfImport'
import { looksLikeDwg, looksLikeDxf, sha256Hex } from './hash'
import { parseManifestJson, parseCommentField } from './manifest'
import { MAX_DXF_BYTES } from './types'
import { validateImport } from './validationService'
import { compareDrawings } from './compareService'
import { recordArtifact, recordAudit } from './artifactStore'
import type { DxfExportManifest, ValidationReport, ChangeSet } from './types'
import type { Lot, RoadSegment, PlanningArea } from '../planning-types'
import type { CadEntity } from '../cad/cadModel'

export interface PreparedImport {
  fileName: string
  dxfText: string
  sha256: string
  bytes: number
  sidecar: DxfExportManifest | null
  inspection: ReturnType<typeof inspectDxf>
}

export interface ParsedImport {
  features: Feature[]
  lots: Feature<Polygon>[]
  roads: Feature<LineString>[]
  cad: Feature[]
  openSpace: Feature<Polygon>[]
  warnings: string[]
  epsg: string
}

export async function readImportFiles(files: File[]): Promise<PreparedImport> {
  if (!files.length) throw new Error('Select a DXF file.')
  let dxfText = ''
  let fileName = ''
  let sidecar: DxfExportManifest | null = null

  for (const f of files) {
    if (f.size > MAX_DXF_BYTES) throw new Error(`File exceeds ${Math.round(MAX_DXF_BYTES / 1024 / 1024)} MB.`)
    const name = f.name.toLowerCase()
    if (name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer())
      const dxfEntry = Object.values(zip.files).find(z => !z.dir && /\.dxf$/i.test(z.name))
      const jsonEntry = Object.values(zip.files).find(z => !z.dir && (/\.vungu\.json$/i.test(z.name) || /manifest\.json$/i.test(z.name)))
      if (!dxfEntry) throw new Error('The ZIP does not contain a DXF.')
      dxfText = await dxfEntry.async('string')
      fileName = dxfEntry.name.split('/').pop() || f.name
      if (jsonEntry) sidecar = parseManifestJson(await jsonEntry.async('string'))
    } else if (name.endsWith('.json') || name.endsWith('.vungu.json')) {
      sidecar = parseManifestJson(await f.text()) || sidecar
    } else {
      const buf = new Uint8Array(await f.arrayBuffer())
      if (looksLikeDwg(buf)) throw new Error('This is a binary DWG file. Save as DXF from AutoCAD and try again.')
      dxfText = new TextDecoder('utf-8').decode(buf)
      fileName = f.name
    }
  }
  if (!dxfText) throw new Error('Select a DXF file.')
  if (!looksLikeDxf(dxfText)) throw new Error('File content is not DXF. The extension is not trusted on its own.')

  const inspection = inspectDxf(dxfText)
  const sha = await sha256Hex(dxfText)
  return { fileName, dxfText, sha256: sha, bytes: dxfText.length, sidecar, inspection }
}

export function parseConfirmed(args: {
  prepared: PreparedImport
  referenceLngLat: [number, number]
  confirmedEpsg: string
  applyUnitTransform: boolean
}): ParsedImport {
  const scale = args.applyUnitTransform ? metresScaleForInsunits(args.prepared.inspection.insunits) : 1
  const parsed = parseDxfToGeoJSON(args.prepared.dxfText, args.referenceLngLat, {
    includeOtherLayers: true,
    epsg: args.confirmedEpsg,
    scaleFactor: scale ?? 1,
  })
  const lots = parsed.featureCollection.features.filter(f => (f.properties as any)?.layer === 'LOTS') as Feature<Polygon>[]
  const roads = parsed.featureCollection.features.filter(f => (f.properties as any)?.layer === 'ROADS') as Feature<LineString>[]
  const cad = parsed.featureCollection.features.filter(f => (f.properties as any)?.cad)
  const openSpace = cad.filter(f => (f.properties as any)?.objectType === 'OPEN_SPACE' && f.geometry.type === 'Polygon') as Feature<Polygon>[]
  return {
    features: parsed.featureCollection.features,
    lots,
    roads,
    cad,
    openSpace,
    warnings: parsed.warnings,
    epsg: parsed.epsg,
  }
}

export function runValidation(args: {
  prepared: PreparedImport
  parsed: ParsedImport | null
  parcel: PlanningArea | null
  expectedEpsg: string
  confirmedEpsg: string | null
  applyUnitTransform: boolean
  acceptUnmappedAsCad: boolean
}): ValidationReport {
  return validateImport({
    inspection: args.prepared.inspection,
    features: args.parsed?.features || [],
    expectedEpsg: args.expectedEpsg,
    confirmedEpsg: args.confirmedEpsg,
    sidecarEpsg: args.prepared.sidecar?.crs || null,
    fileEpsg: args.prepared.inspection.crsFromFile,
    applyUnitTransform: args.applyUnitTransform,
    acceptUnmappedAsCad: args.acceptUnmappedAsCad,
    parcelGeom: args.parcel?.geom || null,
  })
}

export function runCompare(args: {
  lots: Lot[]
  roads: RoadSegment[]
  cadEntities: CadEntity[]
  parsed: ParsedImport
}): ChangeSet {
  return compareDrawings({
    lots: args.lots,
    roads: args.roads,
    cadEntities: args.cadEntities,
    importedLots: args.parsed.lots,
    importedRoads: args.parsed.roads,
    importedCad: args.parsed.cad,
  })
}

export function expectedCrsForParcel(parcel: PlanningArea | null, fallback: [number, number] = [29.82, -19.48]): string {
  if (!parcel) return expectedUtmEpsg(fallback[0], fallback[1])
  try {
    const c = (globalThis as any)
    // centroid computed by caller typically; keep a cheap bbox centre here
    const ring = (parcel.geom as any).coordinates?.[0]
    if (Array.isArray(ring) && ring.length) {
      const lngs = ring.map((p: number[]) => p[0])
      const lats = ring.map((p: number[]) => p[1])
      const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2
      const lat = (Math.min(...lats) + Math.max(...lats)) / 2
      return expectedUtmEpsg(lng, lat)
    }
  } catch { /* */ }
  return expectedUtmEpsg(fallback[0], fallback[1])
}

export { parseCommentField }

export async function logImportReceived(prepared: PreparedImport, actor: string, ctx: { caseId: string | null; parcelId: string | null; projectId: string }) {
  await recordArtifact({
    id: `imp-${prepared.sha256.slice(0, 12)}`,
    kind: 'import-dxf',
    fileName: prepared.fileName,
    sha256: prepared.sha256,
    bytes: prepared.bytes,
    createdAt: new Date().toISOString(),
    createdBy: actor,
    caseId: ctx.caseId,
    parcelId: ctx.parcelId,
    projectId: ctx.projectId,
    revisionLabel: 'pending',
    source: 'autocad-dxf',
    status: 'received',
    text: prepared.dxfText,
  })
  await recordAudit({
    at: new Date().toISOString(),
    actor,
    action: 'dxf_imported',
    detail: prepared.fileName,
  })
}
