// @vitest-environment happy-dom
// Crash-recovery local draft store round-trip (V1 DoD #4).
import { describe, it, expect } from 'vitest'
import { saveDraft, loadDraft, clearDraft } from '../useLocalDraft'

describe('useLocalDraft', () => {
  it('saves, loads and clears a draft by key', async () => {
    const key = 'vungu_farm_cadastre/626'
    const snapshot = { roads: [{ id: 'r1' }], lots: [], constraints: [], name: 'Test' }

    await saveDraft(key, snapshot)
    const d = await loadDraft(key)
    expect(d).toBeTruthy()
    expect(d!.key).toBe(key)
    expect(d!.snapshot.roads.length).toBe(1)
    expect(typeof d!.savedAt).toBe('number')

    await clearDraft(key)
    expect(await loadDraft(key)).toBeNull()
  })

  it('returns null for an unknown key', async () => {
    expect(await loadDraft('nope/0')).toBeNull()
  })
})
