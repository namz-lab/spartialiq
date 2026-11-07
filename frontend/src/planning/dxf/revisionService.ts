import { nextImportLabel, recordAudit, recordRevision, listRevisions } from './artifactStore'
import type { CadRevisionRecord, ChangeSet } from './types'

export function createPendingRevision(args: {
  projectId: string
  gisRevision: number
  createdBy: string
  fileName: string
  sha256: string
  exportId: string | null
  changes: ChangeSet['totals']
  validationOk: boolean
}): CadRevisionRecord {
  const rec: CadRevisionRecord = {
    id: `rev-${Date.now().toString(36)}`,
    projectId: args.projectId,
    label: nextImportLabel(args.gisRevision),
    status: args.validationOk ? 'pending_review' : 'blocked',
    createdAt: new Date().toISOString(),
    createdBy: args.createdBy,
    source: 'autocad-dxf',
    parentRevision: args.gisRevision,
    gisRevisionAfter: null,
    exportId: args.exportId,
    fileName: args.fileName,
    sha256: args.sha256,
    changes: args.changes,
    approval: null,
    validationOk: args.validationOk,
  }
  void recordRevision(rec)
  return rec
}

export async function markMerged(rec: CadRevisionRecord, actor: string, gisRevisionAfter: number | null): Promise<CadRevisionRecord> {
  const next: CadRevisionRecord = {
    ...rec,
    status: 'merged',
    gisRevisionAfter,
    approval: { by: actor, at: new Date().toISOString() },
  }
  await recordRevision(next)
  await recordAudit({
    at: next.approval!.at!,
    actor,
    action: 'revision_merged',
    detail: `${rec.label} → GIS R${gisRevisionAfter ?? 'local'}`,
    revisionId: rec.id,
    exportId: rec.exportId || undefined,
  })
  return next
}

export async function markRejected(rec: CadRevisionRecord, actor: string): Promise<CadRevisionRecord> {
  const next: CadRevisionRecord = { ...rec, status: 'rejected', approval: { by: actor, at: new Date().toISOString() } }
  await recordRevision(next)
  await recordAudit({
    at: next.approval!.at!,
    actor,
    action: 'revision_rejected',
    detail: rec.label,
    revisionId: rec.id,
  })
  return next
}

export { listRevisions }
