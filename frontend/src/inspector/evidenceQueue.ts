/**
 * Field evidence custody.
 *
 * A building inspector photographs a defect once, standing in a trench, often
 * with no signal. If that upload fails we take custody of the ORIGINAL bytes
 * before saying anything reassuring — a claim of safety we have not earned is
 * worse than the failure itself, because the inspector will drive away from the
 * site believing the evidence is filed.
 *
 * Rules this module holds:
 *   1. The original file is the evidence. Never a downscaled preview, never a
 *      data URL. The bytes that reach the server are the bytes off the camera.
 *   2. Nothing is reported as held unless a durable write actually succeeded.
 *      A store that cannot accept the file raises EvidenceNotQueuedError so the
 *      caller can tell the inspector to retake the photograph.
 *   3. A record leaves the queue only after the server confirms the upload.
 *
 * Durability is IndexedDB (blobs survive a reload; localStorage cannot hold
 * them). `setEvidenceStore` swaps the backend for tests.
 */

export type EvidenceStatus = 'pending' | 'failed' | 'uploaded'

export interface QueuedEvidence {
  id: string
  inspectionId: string
  /** Checklist row this photograph evidences, when it was captured against one. */
  checklistItemId: string | null
  caption: string
  fileName: string
  mimeType: string
  /** Byte length of `blob` — what the UI reports as held. */
  bytes: number
  takenAt: string | null
  lat: number | null
  lng: number | null
  status: EvidenceStatus
  attempts: number
  lastError: string | null
  queuedAt: string
  /** The original capture. */
  blob: Blob
}

export interface EvidenceInput {
  inspectionId: string
  file: File
  checklistItemId?: string | null
  caption?: string
  takenAt?: string | null
  lng?: number | null
  lat?: number | null
}

/**
 * Durable backend for held evidence. Deliberately three methods: anything
 * richer invites partial writes, and a half-written photograph is the failure
 * this module exists to prevent.
 */
export interface EvidenceStore {
  put(record: QueuedEvidence): Promise<void>
  all(): Promise<QueuedEvidence[]>
  delete(id: string): Promise<void>
}

/**
 * Raised when the evidence could NOT be stored durably. The caller must treat
 * this as "this photograph is not recorded" and say so — never as a warning.
 */
export class EvidenceNotQueuedError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'EvidenceNotQueuedError'
    this.cause = cause
  }
}

// ── Stores ──────────────────────────────────────────────────────────────

const DB_NAME = 'vungu-inspector-evidence'
const DB_VERSION = 1
const STORE_NAME = 'evidence'

export function createMemoryEvidenceStore(): EvidenceStore {
  const rows = new Map<string, QueuedEvidence>()
  return {
    async put(record) { rows.set(record.id, record) },
    async all() { return [...rows.values()] },
    async delete(id) { rows.delete(id) },
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened.'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const req = run(transaction.objectStore(STORE_NAME))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('The evidence store rejected the write.'))
    transaction.oncomplete = () => db.close()
  }))
}

export function createIndexedDbEvidenceStore(): EvidenceStore {
  return {
    put: record => tx('readwrite', s => s.put(record)).then(() => undefined),
    all: () => tx<QueuedEvidence[]>('readonly', s => s.getAll() as IDBRequest<QueuedEvidence[]>),
    delete: id => tx('readwrite', s => s.delete(id)).then(() => undefined),
  }
}

let store: EvidenceStore | null = null

/** Swap the durable backend. Tests use the memory store; the app uses IndexedDB. */
export function setEvidenceStore(next: EvidenceStore): void {
  store = next
}

function activeStore(): EvidenceStore {
  if (!store) store = createIndexedDbEvidenceStore()
  return store
}

// ── Queue operations ────────────────────────────────────────────────────

function newId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `ev-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Upload failed.'
}

/**
 * Take custody of one capture.
 *
 * The bytes are copied out of the File before the write, so the record does not
 * depend on a file handle that can go stale between the capture and the retry.
 *
 * @throws EvidenceNotQueuedError when the bytes could not be stored durably.
 */
export async function enqueueEvidence(input: EvidenceInput): Promise<QueuedEvidence> {
  let blob: Blob
  let bytes: number
  try {
    const buf = await input.file.arrayBuffer()
    bytes = buf.byteLength
    blob = new Blob([buf], { type: input.file.type || 'application/octet-stream' })
  } catch (err: unknown) {
    throw new EvidenceNotQueuedError(
      'The photograph could not be read off the device and is not recorded.',
      err,
    )
  }

  const record: QueuedEvidence = {
    id: newId(),
    inspectionId: input.inspectionId,
    checklistItemId: input.checklistItemId ?? null,
    caption: input.caption ?? '',
    fileName: input.file.name,
    mimeType: input.file.type || 'application/octet-stream',
    bytes,
    takenAt: input.takenAt ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    queuedAt: new Date().toISOString(),
    blob,
  }

  try {
    await activeStore().put(record)
  } catch (err: unknown) {
    // Storage refused (quota, private mode, no IndexedDB). Say so — do not
    // return a record the caller would report as safely held.
    throw new EvidenceNotQueuedError(
      'The photograph could not be stored on this device and is not recorded.',
      err,
    )
  }
  return record
}

/** Evidence still owed to the server for one inspection, oldest capture first. */
export async function listEvidence(inspectionId: string): Promise<QueuedEvidence[]> {
  const rows = await activeStore().all()
  return rows
    .filter(r => r.inspectionId === inspectionId && r.status !== 'uploaded')
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Everything still owed to the server on this device, across all inspections. */
export async function listAllEvidence(): Promise<QueuedEvidence[]> {
  const rows = await activeStore().all()
  return rows
    .filter(r => r.status !== 'uploaded')
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Counts the inspector can act on before signing off the stage. */
export async function evidenceCounts(
  inspectionId: string,
): Promise<{ pending: number; failed: number; uploaded: number }> {
  const rows = await activeStore().all()
  const counts = { pending: 0, failed: 0, uploaded: 0 }
  for (const r of rows) {
    if (r.inspectionId !== inspectionId) continue
    counts[r.status] += 1
  }
  return counts
}

/**
 * Retry every held capture for one inspection.
 *
 * A record is deleted only after `upload` resolves — the server confirming is
 * the only thing that ends our custody. A failure keeps the original bytes and
 * records why, so the next attempt sends the same evidence.
 *
 * One photograph failing does not abandon the rest of the batch.
 */
export async function flushEvidence(
  inspectionId: string,
  upload: (record: QueuedEvidence) => Promise<unknown>,
): Promise<{ uploaded: number; failed: number }> {
  const s = activeStore()
  const rows = await listEvidence(inspectionId)
  let uploaded = 0
  let failed = 0

  for (const record of rows) {
    try {
      await upload(record)
      await s.delete(record.id)
      uploaded += 1
    } catch (err: unknown) {
      failed += 1
      try {
        await s.put({
          ...record,
          status: 'failed',
          attempts: record.attempts + 1,
          lastError: errorText(err),
        })
      } catch {
        // The retry bookkeeping failed, but the original record is still in the
        // store with its bytes. Losing the attempt count is survivable; losing
        // the evidence is not.
      }
    }
  }

  return { uploaded, failed }
}

/** Drop a held capture. Only ever on an explicit instruction from the inspector. */
export async function discardEvidence(id: string): Promise<void> {
  await activeStore().delete(id)
}
