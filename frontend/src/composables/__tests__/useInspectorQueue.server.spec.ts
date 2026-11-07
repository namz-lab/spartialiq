// @vitest-environment happy-dom
//
// Phase 2: the queue is server-backed. These lock the behaviours the old
// client-assembled queue got wrong:
//   - a server failure must NEVER render as an empty work list
//   - retained rows must be explicitly marked stale
//   - KPI buckets and paging are server queries, not client recounts

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}))

import { dmApi, type InspectorQueueRow } from '@/services/developmentManagementService'
import { useInspectorQueue, parseQueueError } from '@/composables/useInspectorQueue'

function row(over: Partial<InspectorQueueRow> = {}): InspectorQueueRow {
  return {
    permit_app_id: '7ee23015-87ea-4eda-b5f4-e6f3d30bd9be',
    dev_app_id: null,
    tpd_reference: 'TPD/VUN/2026/0001',
    dev_register_no: null,
    stand_number: 'Somabula',
    suburb_ward: '18',
    street_address: null,
    applicant_name: 'A. Moyo',
    development_type: 'new_building',
    description: 'Dwelling',
    permit_status: 'approved',
    permit_assigned_to: null,
    statutory_due_date: null,
    received_at: '2026-09-01T08:00:00.000Z',
    permit_updated_at: null,
    lng: 29.82, lat: -19.45,
    stage_inspection_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    stage_number: 3,
    attempt: 1,
    inspector_id: null,
    scheduled_at: '2026-09-10T10:00:00.000Z',
    inspected_at: null,
    assigned_at: null,
    assigned_by: null,
    result: null,
    booking_id: null,
    booking_application_id: null,
    booking_status: null,
    booking_scheduled_for: null,
    fee_paid_at: null,
    has_occupation_certificate: false,
    effective_scheduled_at: '2026-09-10T10:00:00.000Z',
    is_overdue: false,
    ...over,
  }
}

const summary = {
  today: 2, overdue: 5, upcoming: 1, followup: 3,
  failed: 1, unscheduled: 4, completed: 7, total: 20,
}

describe('useInspectorQueue — server failure is never an empty queue', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('surfaces the error and shows NO rows when the first load fails', async () => {
    vi.spyOn(dmApi, 'inspectorWorkQueue').mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 500 } }),
    )
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockRejectedValue(new Error('Request failed'))

    const q = useInspectorQueue()
    await q.refresh()

    expect(q.error.value).toBeTruthy()
    expect(q.rows.value).toEqual([])
    // Nothing was retained, so nothing may be presented as last-known data.
    expect(q.stale.value).toBe(false)
    // The decisive point: the caller can tell failure from "no work assigned".
    expect(q.summary.value).toBeNull()
  })

  it('retains the previous page on a later failure and marks it stale', async () => {
    const ok = vi.spyOn(dmApi, 'inspectorWorkQueue')
      .mockResolvedValue({ data: [row()], total: 1, limit: 50, offset: 0 })
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockResolvedValue(summary)

    const q = useInspectorQueue()
    await q.refresh()
    expect(q.rows.value).toHaveLength(1)
    expect(q.stale.value).toBe(false)

    ok.mockRejectedValue(Object.assign(new Error('offline'), { response: { status: 503 } }))
    await q.refresh()

    expect(q.error.value).toBeTruthy()
    expect(q.rows.value).toHaveLength(1)   // last known data kept
    expect(q.stale.value).toBe(true)       // ...and explicitly labelled
  })

  it('reports an authorisation failure as such rather than as an empty queue', () => {
    const msg = parseQueueError({ response: { status: 403 } })
    expect(msg).toMatch(/not authorised/i)
  })

  it('prefers the server-supplied message', () => {
    const msg = parseQueueError({ response: { status: 400, data: { message: 'bucket must be one of: today' } } })
    expect(msg).toBe('bucket must be one of: today')
  })
})

describe('useInspectorQueue — buckets and paging are server queries', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('sends the bucket to the server instead of recounting locally', async () => {
    const spy = vi.spyOn(dmApi, 'inspectorWorkQueue')
      .mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 })
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockResolvedValue(summary)

    const q = useInspectorQueue()
    await q.setBucket('overdue')

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'overdue' }))
    // The KPI count comes from the server summary, not from rows.length.
    expect(q.summary.value?.overdue).toBe(5)
    expect(q.rows.value).toHaveLength(0)
  })

  it('pages with a real total and stops at the end', async () => {
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockResolvedValue(summary)
    const spy = vi.spyOn(dmApi, 'inspectorWorkQueue')
      .mockResolvedValue({ data: [row(), row()], total: 3, limit: 2, offset: 0 })

    const q = useInspectorQueue()
    await q.setQuery({ limit: 2 })

    expect(q.total.value).toBe(3)
    expect(q.hasMore.value).toBe(true)
    expect(q.hasPrev.value).toBe(false)

    spy.mockResolvedValue({ data: [row()], total: 3, limit: 2, offset: 2 })
    await q.nextPage()

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2, limit: 2 }))
    expect(q.hasPrev.value).toBe(true)
  })

  it('resets to the first page when a filter changes', async () => {
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockResolvedValue(summary)
    const spy = vi.spyOn(dmApi, 'inspectorWorkQueue')
      .mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 })

    const q = useInspectorQueue()
    q.query.value = { ...q.query.value, offset: 100 }
    await q.setQuery({ ward: '18' })

    // Paging into a stale offset would hide matching rows.
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ ward: '18', offset: 0 }))
  })

  it('never fetches an unbounded window', async () => {
    const spy = vi.spyOn(dmApi, 'inspectorWorkQueue')
      .mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 })
    vi.spyOn(dmApi, 'inspectorQueueSummary').mockResolvedValue(summary)

    const q = useInspectorQueue()
    await q.refresh()

    const sent = spy.mock.calls[0][0]!
    expect(sent.limit).toBeDefined()
    expect(sent.limit).toBeLessThanOrEqual(200)
  })
})
