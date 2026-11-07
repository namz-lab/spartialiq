// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/services/developmentManagementService', () => ({ dmApi: {} }))

import {
  restoreDrafts, isAttached, provideCitizenCase, emptyDraft, type CitizenDraft,
} from '../useCitizenCase'

function stub(over: Partial<CitizenDraft['documents'][number]> = {}) {
  return {
    id: 'doc_1', doc_type: 'title_deed' as const, filename: 'deed.pdf', size_bytes: 10,
    uploaded_at: '2026-09-01T00:00:00Z', ...over,
  }
}

describe('draft document restore', () => {
  beforeEach(() => localStorage.clear())

  it('marks not-yet-uploaded stubs from storage as needing re-attach', () => {
    const d = { ...emptyDraft(), documents: [stub(), stub({ id: 'doc_2', uploaded: true })] }
    const [restored] = restoreDrafts([d])
    expect(restored.documents[0].upload_error).toBe('file_unavailable')
    expect(isAttached(restored.documents[0])).toBe(false)
    expect(isAttached(restored.documents[1])).toBe(true)
  })

  it('a fresh file of the same type replaces the stale stub', () => {
    const d = { ...emptyDraft(), documents: [stub()] }
    localStorage.setItem('citizen_drafts_v1', JSON.stringify([d]))
    const ctx = provideCitizenCase()
    const file = new File([new Uint8Array(4)], 'deed-new.pdf', { type: 'application/pdf' })
    ctx.stageDocument(d.id, { doc_type: 'title_deed', filename: file.name, size_bytes: 4 }, file)
    const docs = ctx.drafts.value[0].documents
    expect(docs).toHaveLength(1)
    expect(docs[0].filename).toBe('deed-new.pdf')
    expect(isAttached(docs[0])).toBe(true)
  })
})
