// @vitest-environment happy-dom
// Export to Map = statutory submission: save({status:'submitted', permitAppId})
// forwards the case link + metrics and returns the server's export summary.
import { describe, it, expect, vi, beforeEach } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'

vi.mock('@/services/api', () => ({
  planningApi: { saveProject: vi.fn(), getProject: vi.fn(), listProjects: vi.fn() },
}))
import { planningApi } from '@/services/api'
import { usePlanningTools } from '../usePlanningTools'

const square = turf.polygon([[[29.8, -19.4], [29.802, -19.4], [29.802, -19.398], [29.8, -19.398], [29.8, -19.4]]])
const CASE_ID = '11111111-2222-3333-4444-555555555555'

function withArea() {
  const t = usePlanningTools()
  t.selectParcel({ type: 'Feature', properties: {}, geometry: square.geometry } as any, 'P')
  return t
}

describe('save() as statutory submission', () => {
  beforeEach(() => { (planningApi.saveProject as any).mockReset() })

  it('forwards status + permitAppId + metrics and returns the summary', async () => {
    const t = withArea()
    ;(planningApi.saveProject as any).mockResolvedValue(
      { data: { data: { id: 'x', revision: 3, lotCount: 12, permitAppId: CASE_ID } } })
    const r: any = await t.save({ status: 'submitted', permitAppId: CASE_ID })
    expect(r.ok).toBe(true)
    const sent = (planningApi.saveProject as any).mock.calls[0][0]
    expect(sent.status).toBe('submitted')
    expect(sent.permitAppId).toBe(CASE_ID)
    expect(sent.metrics).toHaveProperty('roadLengthM')
    expect(r.summary).toMatchObject({ lotCount: 12, permitAppId: CASE_ID })
  })

  it('a plain save stays a draft (no submission fields)', async () => {
    const t = withArea()
    ;(planningApi.saveProject as any).mockResolvedValue({ data: { data: { id: 'x', revision: 1 } } })
    await t.save()
    const sent = (planningApi.saveProject as any).mock.calls[0][0]
    expect(sent.status).toBeUndefined()
    expect(sent.permitAppId).toBeUndefined()
  })
})
