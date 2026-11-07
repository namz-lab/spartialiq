import { LAYER_MAP_VERSION, SOURCE_STYLE_VERSION, DXF_VERSION, INSUNITS_METRES } from './layerRegistry'
import type { DxfExportManifest, ExportDrawingSheet } from './types'

export function newExportId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `EXP-${t}-${r}`.toUpperCase()
}

export function crsNameFor(epsg: string, zone: number): string {
  const south = /327\d\d$/.test(epsg) || epsg.includes('327')
  return `WGS 84 / UTM zone ${zone}${south ? 'S' : 'N'} (${epsg})`
}

export function buildManifest(args: {
  exportId: string
  caseId: string | null
  applicationRef: string | null
  parcelId: string | null
  parcelName: string | null
  projectId: string
  projectName: string
  drawingRevision: number
  sourceGisRevision: number
  crs: string
  crsName: string
  scale: string
  exportedAt: string
  exportedBy: string
  layerCount: number
  objectCount: number
  sha256: string
}): DxfExportManifest {
  return {
    schema: 'vungu.cad.export',
    schemaVersion: 1,
    exportId: args.exportId,
    caseId: args.caseId,
    applicationRef: args.applicationRef,
    parcelId: args.parcelId,
    parcelName: args.parcelName,
    projectId: args.projectId,
    projectName: args.projectName,
    drawingRevision: args.drawingRevision,
    sourceGisRevision: args.sourceGisRevision,
    sourceStyleVersion: SOURCE_STYLE_VERSION,
    layerMapVersion: LAYER_MAP_VERSION,
    crs: args.crs,
    crsName: args.crsName,
    units: 'metres',
    insunits: INSUNITS_METRES,
    scale: args.scale,
    exportedAt: args.exportedAt,
    exportedBy: args.exportedBy,
    dxfVersion: DXF_VERSION,
    layerCount: args.layerCount,
    objectCount: args.objectCount,
    sha256: args.sha256,
    authority: {
      cad: 'design-editing-artifact',
      planningStudio: 'planning-workflow',
      postgis: 'authoritative-enterprise-spatial-data',
      cadastral: 'authoritative-parcel-boundary-source',
    },
  }
}

export function sheetFromManifest(m: DxfExportManifest): ExportDrawingSheet {
  return {
    caseId: m.caseId,
    applicationRef: m.applicationRef,
    parcelId: m.parcelId,
    parcelName: m.parcelName,
    projectId: m.projectId,
    projectName: m.projectName,
    drawingRevision: m.drawingRevision,
    crs: m.crs,
    crsName: m.crsName,
    units: 'metres',
    scale: m.scale,
    exportDate: m.exportedAt,
    exportedBy: m.exportedBy,
    dxfVersion: m.dxfVersion,
    layerCount: m.layerCount,
    objectCount: m.objectCount,
    gisRevision: m.sourceGisRevision,
    checkout: {
      supported: false,
      note: 'Drawing checkout is not available. Concurrent exports of the same GIS revision are possible; the second Save to GIS may be rejected (HTTP 409).',
    },
  }
}

export function manifestComments(m: DxfExportManifest): string[] {
  return [
    `VUNGU-EXPORT:${m.exportId}`,
    `VUNGU-CASE:${m.caseId || ''}`,
    `VUNGU-PARCEL:${m.parcelId || ''}`,
    `VUNGU-PROJECT:${m.projectId}`,
    `VUNGU-REV:${m.sourceGisRevision}`,
    `VUNGU-CRS:${m.crs}`,
    `VUNGU-UNITS:${m.units}`,
    `VUNGU-LAYMAP:${m.layerMapVersion}`,
    'VUNGU: DXF is an interchange format. PostGIS remains the system of record.',
  ]
}

export function parseManifestJson(text: string): DxfExportManifest | null {
  try {
    const v = JSON.parse(text)
    if (v && v.schema === 'vungu.cad.export' && typeof v.exportId === 'string') return v as DxfExportManifest
  } catch { /* not a sidecar */ }
  return null
}

export function parseCommentField(comments: string[], prefix: string): string | null {
  const hit = comments.find(c => c.toUpperCase().startsWith(prefix.toUpperCase()))
  if (!hit) return null
  const v = hit.slice(prefix.length).trim()
  return v || null
}
