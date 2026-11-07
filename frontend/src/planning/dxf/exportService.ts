import JSZip from 'jszip'
import { exportFeaturesToDxf } from '@/map/tools/dxfExport'
import { collectStudioDxfPayload } from '../studio-dxf'
import { DXF_VERSION, LAYER_MAP_VERSION } from './layerRegistry'
import { buildManifest, crsNameFor, manifestComments, newExportId, sheetFromManifest } from './manifest'
import { downloadBlob, downloadTextFile, sha256Hex } from './hash'
import { recordArtifact, recordAudit } from './artifactStore'
import type { CadEntity, CadLayer } from '../cad/cadModel'
import type { ConstraintLayer, Lot, OpenSpace, PlanningArea, RoadSegment } from '../planning-types'
import type { DxfExportManifest, ExportDrawingSheet } from './types'

export interface ExportContext {
  planningArea: PlanningArea | null
  constraints: ConstraintLayer[]
  roads: RoadSegment[]
  openSpace: OpenSpace[]
  lots: Lot[]
  cadEntities: CadEntity[]
  cadLayers: CadLayer[]
  projectId: string
  projectName: string
  caseId: string | null
  applicationRef: string | null
  parcelId: string | null
  parcelName: string | null
  gisRevision: number
  scaleDenom: number
  exportedBy: string
}

export interface ExportPackageResult {
  sheet: ExportDrawingSheet
  manifest: DxfExportManifest
  dxf: string
  zipName: string
}

export function previewExportSheet(ctx: ExportContext): ExportDrawingSheet | { empty: true } {
  const payload = collectStudioDxfPayload(ctx)
  if (!payload.features.length && !payload.labels.length) return { empty: true }
  const layers = new Set<string>()
  for (const f of payload.features) {
    const p = f.properties as any
    if (p?.dxfLayer) layers.add(p.dxfLayer)
    else if (p?.kind) layers.add(String(p.kind))
  }
  return {
    caseId: ctx.caseId,
    applicationRef: ctx.applicationRef,
    parcelId: ctx.parcelId,
    parcelName: ctx.parcelName,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    drawingRevision: ctx.gisRevision,
    crs: 'pending',
    crsName: 'Derived from the drawing centroid at export (WGS 84 / UTM).',
    units: 'metres',
    scale: `1:${ctx.scaleDenom}`,
    exportDate: new Date().toISOString(),
    exportedBy: ctx.exportedBy,
    dxfVersion: DXF_VERSION,
    layerCount: layers.size,
    objectCount: payload.features.length + payload.labels.length,
    gisRevision: ctx.gisRevision,
    checkout: {
      supported: false,
      note: 'Drawing checkout is not available. Concurrent exports of the same GIS revision are possible; the second Save to GIS may be rejected (HTTP 409).',
    },
  }
}

export async function exportDrawingPackage(ctx: ExportContext): Promise<ExportPackageResult> {
  const payload = collectStudioDxfPayload(ctx)
  if (!payload.features.length && !payload.labels.length) {
    throw new Error('Nothing to export — draw or generate stands first.')
  }
  const exportId = newExportId()
  const exportedAt = new Date().toISOString()
  const stamp = exportedAt.slice(0, 10)
  const base = (ctx.projectName || 'planning-studio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'planning-studio'

  const written = exportFeaturesToDxf(payload.features, payload.labels, {
    fileName: `${base}-${exportId}`,
    title: ctx.projectName || 'Planning Studio',
    download: false,
    comments: [
      `VUNGU-EXPORT:${exportId}`,
      `VUNGU-CASE:${ctx.caseId || ''}`,
      `VUNGU-PARCEL:${ctx.parcelId || ''}`,
      `VUNGU-PROJECT:${ctx.projectId}`,
      `VUNGU-REV:${ctx.gisRevision}`,
      `VUNGU-LAYMAP:${LAYER_MAP_VERSION}`,
      'VUNGU: DXF is an interchange format. PostGIS remains the system of record.',
    ],
  })

  const crsName = crsNameFor(written.epsg, written.zone)
  const comments = manifestComments({
    exportId,
    caseId: ctx.caseId,
    applicationRef: ctx.applicationRef,
    parcelId: ctx.parcelId,
    parcelName: ctx.parcelName,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    drawingRevision: ctx.gisRevision,
    sourceGisRevision: ctx.gisRevision,
    crs: written.epsg,
    crsName,
    scale: `1:${ctx.scaleDenom}`,
    exportedAt,
    exportedBy: ctx.exportedBy,
    layerCount: 0,
    objectCount: written.count,
    sha256: '',
  } as any)
  comments.splice(5, 0, `VUNGU-CRS:${written.epsg}`)

  // Re-write with CRS now known (UTM zone comes from the drawing centroid).
  const final = exportFeaturesToDxf(payload.features, payload.labels, {
    fileName: `${base}-${exportId}`,
    title: ctx.projectName || 'Planning Studio',
    download: false,
    comments,
  })
  const hash = await sha256Hex(final.dxf)
  const layers = new Set<string>()
  for (const f of payload.features) {
    const p = f.properties as any
    if (p?.dxfLayer) layers.add(p.dxfLayer)
  }
  const manifest = buildManifest({
    exportId,
    caseId: ctx.caseId,
    applicationRef: ctx.applicationRef,
    parcelId: ctx.parcelId,
    parcelName: ctx.parcelName,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    drawingRevision: ctx.gisRevision,
    sourceGisRevision: ctx.gisRevision,
    crs: final.epsg,
    crsName,
    scale: `1:${ctx.scaleDenom}`,
    exportedAt,
    exportedBy: ctx.exportedBy,
    layerCount: layers.size,
    objectCount: final.count,
    sha256: hash,
  })
  const manifestText = JSON.stringify(manifest, null, 2)
  const zip = new JSZip()
  zip.file(`${base}.dxf`, final.dxf)
  zip.file(`${base}.vungu.json`, manifestText)
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const zipName = `${base}-${stamp}-${exportId}.zip`

  downloadBlob(zipName, zipBlob)
  downloadTextFile(`${base}-${stamp}.dxf`, final.dxf, 'application/dxf')

  await recordArtifact({
    id: `${exportId}-dxf`,
    kind: 'export-dxf',
    fileName: `${base}.dxf`,
    sha256: hash,
    bytes: final.dxf.length,
    createdAt: exportedAt,
    createdBy: ctx.exportedBy,
    caseId: ctx.caseId,
    parcelId: ctx.parcelId,
    projectId: ctx.projectId,
    revisionLabel: `R${ctx.gisRevision}`,
    source: 'planning-studio',
    status: 'exported',
    text: final.dxf,
  })
  await recordArtifact({
    id: `${exportId}-manifest`,
    kind: 'export-manifest',
    fileName: `${base}.vungu.json`,
    sha256: await sha256Hex(manifestText),
    bytes: manifestText.length,
    createdAt: exportedAt,
    createdBy: ctx.exportedBy,
    caseId: ctx.caseId,
    parcelId: ctx.parcelId,
    projectId: ctx.projectId,
    revisionLabel: `R${ctx.gisRevision}`,
    source: 'planning-studio',
    status: 'exported',
    text: manifestText,
  })
  await recordAudit({
    at: exportedAt,
    actor: ctx.exportedBy,
    action: 'dxf_exported',
    detail: `${final.count} entities · ${final.epsg} · ${exportId}`,
    exportId,
  })
  await recordAudit({
    at: exportedAt,
    actor: ctx.exportedBy,
    action: 'dxf_downloaded',
    detail: zipName,
    exportId,
  })

  return { sheet: sheetFromManifest(manifest), manifest, dxf: final.dxf, zipName }
}
