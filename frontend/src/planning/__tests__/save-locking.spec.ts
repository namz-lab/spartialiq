// @vitest-environment happy-dom
// Optimistic-locking behaviour of usePlanningTools.save():
// sends baseRevision, updates it on success, surfaces a conflict on 409.
import { describe, it, expect, vi, beforeEach } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'

vi.mock('@/services/api', () => ({
  planningApi: { saveProject: vi.fn(), getProject: vi.fn(), listProjects: vi.fn() },
}))
import { planningApi } from '@/services/api'
import { usePlanningTools } from '../usePlanningTools'

const square = turf.polygon([[[29.8, -19.4], [29.802, -19.4], [29.802, -19.398], [29.8, -19.398], [29.8, -19.4]]])
function withArea() {
  const t = usePlanningTools()
  t.selectParcel({ type: 'Feature', properties: {}, geometry: square.geometry } as any, 'P')
  return t
}

describe('save() optimistic locking', () => {
  beforeEach(() => { (planningApi.saveProject as any).mockReset() })

  it('sends baseRevision and adopts the server revision on success', async () => {
    const t = withArea()
    ;(planningApi.saveProject as any).mockResolvedValue({ data: { data: { id: 'x', revision: 5 } } })
    const r = await t.save()
    expect(r.ok).toBe(true)
    expect((r as any).revision).toBe(5)
    expect(t.baseRevision.value).toBe(5)
    expect((planningApi.saveProject as any).mock.calls[0][0]).toHaveProperty('baseRevision')
  })

  it('returns a conflict on 409 and never overwrites (baseRevision unchanged)', async () => {
    const t = withArea()
    t.baseRevision.value = 2
    ;(planningApi.saveProject as any).mockRejectedValue({ response: { status: 409, data: { currentRevision: 7 } } })
    const r: any = await t.save()
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('conflict')
    expect(r.currentRevision).toBe(7)
    expect(t.baseRevision.value).toBe(2)
  })
})
