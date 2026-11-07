import type { Feature, Geometry, Polygon } from 'geojson'
import type { PlanningObjectType, RoadHierarchy } from './layerRegistry'

export const MAX_DXF_BYTES = 25 * 1024 * 1024

export type CadEntitySupport = 'SUPPORTED' | 'CONVERTIBLE' | 'UNSUPPORTED'

export type InterchangeEvent =
  | 'dxf_exported'
  | 'dxf_downloaded'
  | 'dxf_imported'
  | 'validation_run'
  | 'validation_failed'
  | 'validation_passed'
  | 'changes_reviewed'
  | 'revision_merged'
  | 'revision_rejected'

export type RevisionStatus = 'pending_review' | 'merged' | 'rejected' | 'blocked'

export type CrsStatus = 'match' | 'mismatch' | 'unknown' | 'confirmed'
export type UnitsStatus = 'match' | 'mismatch' | 'unknown'

export interface DxfExportManifest {
  schema: 'vungu.cad.export'
  schemaVersion: 1
  exportId: string
  caseId: string | null
  applicationRef: string | null
  parcelId: string | null
  parcelName: string | null
  projectId: string
  projectName: string
  drawingRevision: number
  sourceGisRevision: number
  sourceStyleVersion: string
  layerMapVersion: number
  crs: string
  crsName: string
  units: 'metres'
  insunits: number
  scale: string
  exportedAt: string
  exportedBy: string
  dxfVersion: string
  layerCount: number
  objectCount: number
  sha256: string
  authority: {
    cad: 'design-editing-artifact'
    planningStudio: 'planning-workflow'
    postgis: 'authoritative-enterprise-spatial-data'
    cadastral: 'authoritative-parcel-boundary-source'
  }
}

export interface ExportDrawingSheet {
  caseId: string | null
  applicationRef: string | null
  parcelId: string | null
  parcelName: string | null
  projectId: string
  projectName: string
  drawingRevision: number
  crs: string
  crsName: string
  units: string
  scale: string
  exportDate: string
  exportedBy: string
  dxfVersion: string
  layerCount: number
  objectCount: number
  gisRevision: number
  checkout: {
    supported: false
    note: string
  }
}

export interface InspectedEntity {
  type: string
  layer: string
  support: CadEntitySupport
  note?: string
}

export interface DxfInspection {
  readable: boolean
  error?: string
  acadVer: string | null
  insunits: number | null
  unitsLabel: string
  comments: string[]
  exportIdFromFile: string | null
  crsFromFile: string | null
  layers: string[]
  entityCounts: Record<string, number>
  entities: InspectedEntity[]
  xrefs: string[]
  hasBinaryDwg: boolean
}

export interface ClassifiedFeature {
  feature: Feature
  sourceLayer: string
  objectType: PlanningObjectType | 'UNMAPPED'
  gisRole: 'planning' | 'cad' | 'cadastral-read-only' | 'annotation' | 'unmapped'
  hierarchy?: RoadHierarchy
}

export interface ValidationIssue {
  code: string
  severity: 'block' | 'warn'
  title: string
  detail: string
}

export interface ValidationReport {
  ok: boolean
  blocked: boolean
  issues: ValidationIssue[]
  geometry: { valid: number; invalid: number; zeroLength: number; openRings: number; duplicates: number; selfIntersections: number; outsideExtent: number }
  layers: { mapped: string[]; unmapped: string[] }
  entities: { supported: number; convertible: number; unsupported: number }
  xrefs: string[]
  crs: { status: CrsStatus; source: string | null; expected: string; detail: string }
  units: { status: UnitsStatus; source: string; expected: string; scaleToMetres: number | null }
  cadastralConflict: boolean
}

export interface ChangeItem {
  id: string
  kind: 'stand' | 'road' | 'open_space' | 'cad'
  category: 'added' | 'modified' | 'deleted' | 'moved' | 'resized' | 'layer_changed'
  label: string
  confidence: 'identity' | 'geometric'
  geometry?: Geometry | null
}

export interface ChangeSet {
  method: 'identity-then-geometric'
  note: string
  added: ChangeItem[]
  modified: ChangeItem[]
  deleted: ChangeItem[]
  moved: ChangeItem[]
  resized: ChangeItem[]
  layerChanged: ChangeItem[]
  totals: { added: number; modified: number; deleted: number; moved: number; resized: number }
}

export interface CadRevisionRecord {
  id: string
  projectId: string
  label: string
  status: RevisionStatus
  createdAt: string
  createdBy: string
  source: 'studio' | 'autocad-dxf'
  parentRevision: number
  gisRevisionAfter: number | null
  exportId: string | null
  fileName: string | null
  sha256: string | null
  changes: ChangeSet['totals'] | null
  approval: { by: string | null; at: string | null } | null
  validationOk: boolean | null
}

export interface MergePayload {
  planningFeatures: Array<{ properties?: any; geometry: any }>
  cadItems: Array<{ type: string; geom: Geometry; layerId: string; text?: string; sourceLayer?: string }>
  openSpace: Feature<Polygon>[]
  dropMissingLots: boolean
  revision: CadRevisionRecord
}

export interface InterchangeAuditEvent {
  at: string
  actor: string
  action: InterchangeEvent
  detail: string
  exportId?: string
  revisionId?: string
}

export interface ArtifactRecord {
  id: string
  kind: 'export-dxf' | 'export-manifest' | 'import-dxf' | 'validation-report' | 'change-report'
  fileName: string
  sha256: string
  bytes: number
  createdAt: string
  createdBy: string
  caseId: string | null
  parcelId: string | null
  projectId: string
  revisionLabel: string
  source: string
  status: string
  text?: string
}
