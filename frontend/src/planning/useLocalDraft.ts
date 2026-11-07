// src/planning/useLocalDraft.ts
// ─────────────────────────────────────────────────────────────────────────
// Crash-recovery local draft store for the Planning Studio (V1 DoD #4: never lose
// work — kill the browser and recover the last draft on reload). Persists a project
// snapshot locally, keyed by parcel, so a reload after a crash / dropped connection
// can restore unsaved work. Prefers IndexedDB (handles MB-scale snapshots); falls
// back to localStorage, then to an in-memory map (tests / locked-down browsers).
//
// This is local-only safety; the authoritative copy is the server (planning.save()).
// On a successful server save/export the local draft is cleared.
// ─────────────────────────────────────────────────────────────────────────

const DB_NAME = 'vungu-studio'
const STORE = 'drafts'
const LS_PREFIX = 'studio-draft:'

export interface StudioDraft {
  key: string
  savedAt: number
  snapshot: any
}

const memory = new Map<string, StudioDraft>()

function hasIDB(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null } catch { return false }
}
function hasLS(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage !== null } catch { return false }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function idbDo<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const r = fn(tx.objectStore(STORE))
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
    tx.oncomplete = () => db.close()
  }))
}

/** Save a snapshot under a stable key (e.g. "vungu_farm_cadastre/626"). */
export async function saveDraft(key: string, snapshot: any): Promise<void> {
  const draft: StudioDraft = { key, savedAt: Date.now(), snapshot }
  if (hasIDB()) {
    try { await idbDo('readwrite', s => s.put(draft)); return } catch { /* fall through */ }
  }
  if (hasLS()) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(draft)); return } catch { /* fall through */ }
  }
  memory.set(key, draft)
}

/** Load the draft for a key, or null if none. */
export async function loadDraft(key: string): Promise<StudioDraft | null> {
  if (hasIDB()) {
    try { const d = await idbDo<StudioDraft | undefined>('readonly', s => s.get(key)); if (d) return d } catch { /* fall through */ }
  }
  if (hasLS()) {
    try { const raw = localStorage.getItem(LS_PREFIX + key); if (raw) return JSON.parse(raw) as StudioDraft } catch { /* fall through */ }
  }
  return memory.get(key) ?? null
}

/** Clear a draft once the work is safely persisted to the server. */
export async function clearDraft(key: string): Promise<void> {
  if (hasIDB()) { try { await idbDo('readwrite', s => s.delete(key)) } catch { /* ignore */ } }
  if (hasLS()) { try { localStorage.removeItem(LS_PREFIX + key) } catch { /* ignore */ } }
  memory.delete(key)
}
