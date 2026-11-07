import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inspectionsService } from '@/services/inspectionsService'
import { dmApi } from '@/services/developmentManagementService'
import { checklistComplete } from '@/composables/useInspectorFieldCapture'

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}))

import api from '@/services/api'

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const BOOKING_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PERMIT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const INSP_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

describe('inspector field workflow — service contract', () => {
  beforeEach(() => {
    apiMock.get.mockReset()
    apiMock.post.mockReset()
  })

  it('starts a scheduled booking before evidence is captured', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { success: true, data: { id: BOOKING_ID, status: 'in_progress', passed: null } },
    })
    const row = await inspectionsService.start(BOOKING_ID)
    expect(apiMock.post).toHaveBeenCalledWith(`/inspections/${BOOKING_ID}/start`)
    expect(row.status).toBe('in_progress')
  })

  it('refuses to treat a checklist as complete while items are not inspected', () => {
    expect(checklistComplete([
      { result: 'pass', is_mandatory: true },
      { result: 'not_inspected', is_mandatory: true },
    ]).ok).toBe(false)
  })

  it('uploads a photo against a stage inspection id, not a sibling case', async () => {
    const file = new File(['x'], 'site.jpg', { type: 'image/jpeg' })
    apiMock.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 'photo-1', stage_inspection_id: INSP_ID } },
    })
    await dmApi.uploadStagePhoto(INSP_ID, file, {
      caption: 'Foundation trench',
      takenAt: '2026-09-09T10:00:00.000Z',
      lat: -19.45,
      lng: 29.82,
    })
    const [url, body] = apiMock.post.mock.calls[0]
    expect(url).toBe(`/stage-inspections/${INSP_ID}/photos`)
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('caption')).toBe('Foundation trench')
    expect((body as FormData).get('lat')).toBe('-19.45')
  })

  it('records checklist results and lets the system compute the verdict', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { computed_result: 'fail', stage_inspection_id: INSP_ID, scored_count: 2, item_count: 2 },
      },
    })
    const scoring = await dmApi.recordChecklist(INSP_ID, [
      { checklist_item_id: 1, result: 'fail', notes: 'Trench 400 mm', score: 2 },
      { checklist_item_id: 2, result: 'pass', notes: null, score: 8 },
    ])
    expect(scoring.computed_result).toBe('fail')
    const [url] = apiMock.post.mock.calls[0]
    expect(url).toContain(INSP_ID)
  })

  it('creates a planner referral on the same permit', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 'ref-1', body_name: 'Planner', task_type: 'planner', task_status: 'open' } },
    })
    const created = await dmApi.createConsultation(PERMIT_ID, {
      body_name: 'Planner',
      task_type: 'planner',
      response_notes: 'Observed development differs from approved planning permission.',
    })
    expect(apiMock.post).toHaveBeenCalledWith(
      `/permit-applications/${PERMIT_ID}/consultations`,
      expect.objectContaining({ body_name: 'Planner', task_type: 'planner' }),
    )
    expect(created.body_name).toBe('Planner')
  })

  it('opens a follow-up as a new stage attempt on the same permit', async () => {
    apiMock.post.mockResolvedValueOnce({
      data: { success: true, data: { id: 'insp-2', permit_application_id: PERMIT_ID, stage_number: 2, attempt: 2 } },
    })
    const follow = await dmApi.createStageInspection(PERMIT_ID, {
      stage_number: 2,
      scheduled_at: '2026-09-16T08:00:00.000Z',
      notes: 'Follow-up of previous fail',
    })
    expect(follow.attempt).toBe(2)
    expect(follow.permit_application_id).toBe(PERMIT_ID)
  })
})
