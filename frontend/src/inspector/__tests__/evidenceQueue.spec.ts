// @vitest-environment happy-dom
/**
 * Field evidence durability.
 *
 * A building inspector photographs a defect once, standing in a trench, often
 * with no signal. If that upload fails and we keep only a downscaled preview,
 * the municipality has lost the evidence and the inspector was told it was safe.
 * These tests hold the line on that: the ORIGINAL bytes survive, and we never
 * report safety we did not achieve.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueueEvidence,
  listEvidence,
  listAllEvidence,
  evidenceCounts,
  flushEvidence,
  setEvidenceStore,
  createMemoryEvidenceStore,
  EvidenceNotQueuedError,
  type QueuedEvidence,
} from '../evidenceQueue'

const INSP = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

/** 12 bytes of "original" image data we can assert survived byte-for-byte. */
function originalFile(name = 'trench.jpg'): File {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
  return new File([bytes], name, { type: 'image/jpeg' })
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

const input = (over: Partial<Parameters<typeof enqueueEvidence>[0]> = {}) => ({
  inspectionId: INSP,
  file: originalFile(),
  caption: 'Foundation trench depth',
  checklistItemId: '17',
  takenAt: '2026-09-11T08:15:00.000Z',
  lat: -19.45,
  lng: 29.82,
  ...over,
})

beforeEach(() => {
  setEvidenceStore(createMemoryEvidenceStore())
})

describe('evidence queue — the original file is the evidence', () => {
  it('preserves the original bytes, not a preview', async () => {
    const rec = await enqueueEvidence(input())
    const [stored] = await listEvidence(INSP)

    expect(stored.blob).toBeInstanceOf(Blob)
    expect(await bytesOf(stored.blob)).toEqual(await bytesOf(originalFile()))
    expect(stored.bytes).toBe(12)
    expect(rec.id).toBeTruthy()
  })

  it('keeps the capture context needed to file the evidence correctly', async () => {
    await enqueueEvidence(input())
    const [stored] = await listEvidence(INSP)

    expect(stored).toMatchObject({
      inspectionId: INSP,
      checklistItemId: '17',
      caption: 'Foundation trench depth',
      mimeType: 'image/jpeg',
      fileName: 'trench.jpg',
      takenAt: '2026-09-11T08:15:00.000Z',
      lat: -19.45,
      lng: 29.82,
      status: 'pending',
      attempts: 0,
    })
  })

  it('never silently accepts evidence it cannot store durably', async () => {
    setEvidenceStore({
      put: () => Promise.reject(new Error('QuotaExceededError')),
      all: () => Promise.resolve([]),
      delete: () => Promise.resolve(),
    })

    await expect(enqueueEvidence(input())).rejects.toBeInstanceOf(EvidenceNotQueuedError)
  })

  it('scopes the queue to one inspection so evidence cannot attach to the wrong case', async () => {
    await enqueueEvidence(input())
    await enqueueEvidence(input({ inspectionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }))

    expect(await listEvidence(INSP)).toHaveLength(1)
  })

  it('lists every held capture on the device for the outbox, oldest first', async () => {
    await enqueueEvidence(input({ file: originalFile('first.jpg') }))
    await enqueueEvidence(input({ inspectionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', file: originalFile('second.jpg') }))

    const all = await listAllEvidence()
    expect(all.map(r => r.fileName)).toEqual(['first.jpg', 'second.jpg'])
  })
})

describe('evidence queue — retry and reconciliation', () => {
  it('uploads pending evidence and clears it only after the server confirms', async () => {
    await enqueueEvidence(input())
    const upload = vi.fn().mockResolvedValue({ id: 'server-photo-1' })

    const result = await flushEvidence(INSP, upload)

    expect(upload).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ uploaded: 1, failed: 0 })
    expect(await listEvidence(INSP)).toHaveLength(0)
  })

  it('hands the upload the original file, not a data URL', async () => {
    await enqueueEvidence(input())
    let seen: Blob | null = null
    await flushEvidence(INSP, async (rec: QueuedEvidence) => {
      seen = rec.blob
      return { id: 'server-photo-1' }
    })

    expect(seen).toBeInstanceOf(Blob)
    expect(await bytesOf(seen!)).toEqual(await bytesOf(originalFile()))
  })

  it('retains the evidence and records why when the upload fails', async () => {
    await enqueueEvidence(input())
    const upload = vi.fn().mockRejectedValue(new Error('Network Error'))

    const result = await flushEvidence(INSP, upload)

    expect(result).toMatchObject({ uploaded: 0, failed: 1 })
    const [stored] = await listEvidence(INSP)
    expect(stored.status).toBe('failed')
    expect(stored.attempts).toBe(1)
    expect(stored.lastError).toContain('Network Error')
    expect(await bytesOf(stored.blob)).toEqual(await bytesOf(originalFile()))
  })

  it('survives an app restart and retries the same original bytes', async () => {
    const store = createMemoryEvidenceStore()
    setEvidenceStore(store)
    await enqueueEvidence(input())
    await flushEvidence(INSP, () => Promise.reject(new Error('offline')))

    // Simulate a fresh app boot against the same durable store.
    setEvidenceStore(store)
    const upload = vi.fn().mockResolvedValue({ id: 'server-photo-1' })
    const result = await flushEvidence(INSP, upload)

    expect(result.uploaded).toBe(1)
    const arg = upload.mock.calls[0][0] as QueuedEvidence
    expect(await bytesOf(arg.blob)).toEqual(await bytesOf(originalFile()))
    expect(arg.attempts).toBe(1)
  })

  it('does not re-upload evidence the server already accepted', async () => {
    await enqueueEvidence(input())
    await flushEvidence(INSP, () => Promise.resolve({ id: 'server-photo-1' }))

    const upload = vi.fn()
    const result = await flushEvidence(INSP, upload)

    expect(upload).not.toHaveBeenCalled()
    expect(result.uploaded).toBe(0)
  })

  it('reports counts the inspector can act on', async () => {
    await enqueueEvidence(input())
    await enqueueEvidence(input({ file: originalFile('b.jpg') }))
    await flushEvidence(INSP, () => Promise.reject(new Error('offline')))

    expect(await evidenceCounts(INSP)).toMatchObject({ pending: 0, failed: 2, uploaded: 0 })
  })

  it('keeps going when one photo in the batch fails', async () => {
    await enqueueEvidence(input({ file: originalFile('a.jpg') }))
    await enqueueEvidence(input({ file: originalFile('b.jpg') }))

    const result = await flushEvidence(INSP, async (rec: QueuedEvidence) => {
      if (rec.fileName === 'a.jpg') throw new Error('boom')
      return { id: 'ok' }
    })

    expect(result).toMatchObject({ uploaded: 1, failed: 1 })
    const left = await listEvidence(INSP)
    expect(left).toHaveLength(1)
    expect(left[0].fileName).toBe('a.jpg')
  })
})
