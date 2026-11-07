const DB_NAME = 'vungu-cad-interchange'
const STORE = 'artifacts'
const AUDIT_KEY = 'vungu-cad-audit'
const REV_KEY = 'vungu-cad-revisions'

import type { ArtifactRecord, CadRevisionRecord, InterchangeAuditEvent } from './types'

const memArtifacts = new Map<string, ArtifactRecord>()
let memAudit: InterchangeAuditEvent[] = []
let memRevisions: CadRevisionRecord[] = []

function hasIDB(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null } catch { return false }
}
function hasLS(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage !== null } catch { return false }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function recordArtifact(rec: ArtifactRecord): Promise<void> {
  memArtifacts.set(rec.id, rec)
  if (hasIDB()) {
    try {
      const db = await openDB()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(rec)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      return
    } catch { /* fall through */ }
  }
  if (hasLS() && rec.kind !== 'export-dxf' && rec.kind !== 'import-dxf') {
    try { localStorage.setItem(`cad-art:${rec.id}`, JSON.stringify({ ...rec, text: rec.text?.slice(0, 200_000) })) } catch { /* quota */ }
  }
}

export async function listArtifacts(projectId: string): Promise<ArtifactRecord[]> {
  const out: ArtifactRecord[] = []
  if (hasIDB()) {
    try {
      const db = await openDB()
      const rows = await new Promise<ArtifactRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).getAll()
        req.onsuccess = () => resolve((req.result || []) as ArtifactRecord[])
        req.onerror = () => reject(req.error)
      })
      db.close()
      return rows.filter(r => r.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch { /* fall through */ }
  }
  for (const r of memArtifacts.values()) if (r.projectId === projectId) out.push(r)
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getArtifact(id: string): Promise<ArtifactRecord | null> {
  if (memArtifacts.has(id)) return memArtifacts.get(id) || null
  if (hasIDB()) {
    try {
      const db = await openDB()
      const row = await new Promise<ArtifactRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(id)
        req.onsuccess = () => resolve(req.result as ArtifactRecord | undefined)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return row || null
    } catch { /* */ }
  }
  return null
}

function loadLs<T>(key: string, fallback: T): T {
  if (!hasLS()) return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch { return fallback }
}
function saveLs(key: string, v: unknown) {
  if (!hasLS()) return
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota */ }
}

export async function recordAudit(ev: InterchangeAuditEvent): Promise<void> {
  memAudit = [ev, ...memAudit].slice(0, 200)
  const stored = loadLs<InterchangeAuditEvent[]>(AUDIT_KEY, [])
  saveLs(AUDIT_KEY, [ev, ...stored].slice(0, 200))
}

export function listAudit(): InterchangeAuditEvent[] {
  const stored = loadLs<InterchangeAuditEvent[]>(AUDIT_KEY, [])
  return (stored.length ? stored : memAudit).slice(0, 80)
}

export async function recordRevision(rec: CadRevisionRecord): Promise<void> {
  memRevisions = [rec, ...memRevisions.filter(r => r.id !== rec.id)]
  const stored = loadLs<CadRevisionRecord[]>(REV_KEY, [])
  saveLs(REV_KEY, [rec, ...stored.filter(r => r.id !== rec.id)].slice(0, 80))
}

export function listRevisions(projectId: string): CadRevisionRecord[] {
  const stored = loadLs<CadRevisionRecord[]>(REV_KEY, memRevisions)
  return stored.filter(r => r.projectId === projectId).slice(0, 40)
}

export function nextImportLabel(gisRevision: number): string {
  const n = String(gisRevision + 1).padStart(2, '0')
  return `IMPORT REVISION ${n}`
}
