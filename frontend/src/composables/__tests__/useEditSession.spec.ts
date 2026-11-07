// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveEdits = vi.fn()
vi.mock('@/services/gms', () => ({ gmsApi: { saveEdits: (...a: unknown[]) => saveEdits(...a) } }))

import { useEditSession } from '../useEditSession'
import type { EditSession } from '@/services/gms'

const pt = { type: 'Point', coordinates: [29.5, -19.6] } as GeoJSON.Point
const session = (over: Partial<EditSession> = {}): EditSession => ({
  session_id: 's1', layer_id: 'boreholes', user_id: 'u', user_email: 'e', user_name: null,
  status: 'open', edits: [], title: null, submitted_at: null, decided_by_email: null,
  decided_at: null, decision_note: null, created_at: '2026-09-30T08:00:00Z', updated_at: '2026-09-30T08:00:00Z',
  ...over,
})

describe('useEditSession', () => {
  beforeEach(() => {
    localStorage.clear()
    saveEdits.mockReset().mockResolvedValue({ updated_at: 'now' })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T09:00:00Z'))
  })

  it('undoes and redoes, and folds repeated updates of one feature', () => {
    const s = useEditSession()
    s.load(session())
    s.addCreate(pt, { name: 'A' }, 'B', 'GNSS')
    s.updateFeature(7, 1, { attrs: { status: 'broken' } })
    s.updateFeature(7, 1, { attrs: { name: 'X' } })
    expect(s.edits.value).toHaveLength(2)
    expect(s.edits.value[1]).toMatchObject({ op: 'update', feature_id: 7, attrs: { status: 'broken', name: 'X' } })

    s.deleteFeature(7, 1)
    expect(s.edits.value.map((e) => e.op)).toEqual(['create', 'delete'])
    s.undo()
    expect(s.edits.value[1]).toMatchObject({ op: 'update' })
    s.redo()
    expect(s.edits.value[1]).toMatchObject({ op: 'delete' })
  })

  it('keeps unsaved edits on the device and restores them after a power cut', async () => {
    const a = useEditSession()
    a.load(session())
    saveEdits.mockRejectedValue(new Error('offline'))
    a.addCreate(pt, { name: 'A' }, 'B', 'GNSS')
    await vi.runAllTimersAsync()
    expect(a.saveState.value).toBe('offline')

    // Page reloads; the server still has the empty session.
    saveEdits.mockResolvedValue({ updated_at: 'later' })
    const b = useEditSession()
    b.load(session())
    expect(b.recovered.value).toBe(true)
    expect(b.edits.value).toHaveLength(1)
    await vi.runAllTimersAsync()
    expect(saveEdits).toHaveBeenLastCalledWith('s1', b.edits.value)
    expect(localStorage.getItem('gms-session:s1')).toBeNull()
  })

  it('does not edit a submitted session', () => {
    const s = useEditSession()
    s.load(session({ status: 'submitted' }))
    s.addCreate(pt, {}, 'B', 'x')
    expect(s.edits.value).toHaveLength(0)
  })
})
