import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { inspectorQueueSummary: vi.fn(), listEnforcement: vi.fn() },
}))
vi.mock('@/services/inspectionsService', () => ({
  inspectionsService: { inspectorQueue: vi.fn() },
}))
vi.mock('@/services/buildingComplaints', () => ({
  complaintsApi: { list: vi.fn() },
}))

import { dmApi } from '@/services/developmentManagementService'
import { inspectionsService } from '@/services/inspectionsService'
import { complaintsApi } from '@/services/buildingComplaints'
import { useInspectorWorkload } from '../useInspectorWorkload'

const { workload, refreshWorkload } = useInspectorWorkload()

const summary = (over = {}) => ({
  today: 0, overdue: 0, upcoming: 0, followup: 0,
  failed: 0, unscheduled: 0, completed: 0, total: 0, ...over,
})

/** An order issued `daysAgo` with a 30-day period, so the deadline is real. */
const order = (status: string, daysAgo: number) => ({
  status,
  issued_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  compliance_period: 30,
})

function allOk() {
  vi.mocked(dmApi.inspectorQueueSummary).mockResolvedValue(summary() as never)
  vi.mocked(dmApi.listEnforcement).mockResolvedValue([] as never)
  vi.mocked(inspectionsService.inspectorQueue).mockResolvedValue({ assigned: [], waitlist: [] } as never)
  vi.mocked(complaintsApi.list).mockResolvedValue({
    data: [], summary: { open: 0, emergency: 0, awaiting_visit: 0, total: 0 },
  } as never)
}

describe('inspector workload badges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workload.value = {}
    allOk()
  })

  it('shows no badge for a section with nothing outstanding', async () => {
    await refreshWorkload()
    expect(workload.value.dashboard).toBeUndefined()
    expect(workload.value.bookings).toBeUndefined()
    expect(workload.value.enforcement).toBeUndefined()
    expect(workload.value.complaints).toBeUndefined()
  })

  it('counts today and overdue together, and reddens once anything is overdue', async () => {
    vi.mocked(dmApi.inspectorQueueSummary).mockResolvedValue(summary({ today: 3, overdue: 2 }) as never)
    await refreshWorkload()
    expect(workload.value.dashboard).toEqual({ count: 5, tone: 'danger' })

    vi.mocked(dmApi.inspectorQueueSummary).mockResolvedValue(summary({ today: 3 }) as never)
    await refreshWorkload()
    expect(workload.value.dashboard).toEqual({ count: 3, tone: 'info' })
  })

  it('counts only enforcement orders past their compliance deadline', async () => {
    vi.mocked(dmApi.listEnforcement).mockResolvedValue([
      order('issued', 45),      // 15 days past a 30-day deadline
      order('served', 40),      // 10 days past
      order('issued', 5),       // open, still in time — work in hand, not owed
      order('complied', 90),    // closed, however old
    ] as never)
    await refreshWorkload()
    expect(workload.value.enforcement).toEqual({ count: 2, tone: 'danger' })
  })

  it('reddens public reports only when one is an emergency', async () => {
    vi.mocked(complaintsApi.list).mockResolvedValue({
      data: [], summary: { open: 4, emergency: 0, awaiting_visit: 4, total: 9 },
    } as never)
    await refreshWorkload()
    expect(workload.value.complaints).toEqual({ count: 4, tone: 'warn' })

    vi.mocked(complaintsApi.list).mockResolvedValue({
      data: [], summary: { open: 4, emergency: 1, awaiting_visit: 4, total: 9 },
    } as never)
    await refreshWorkload()
    expect(workload.value.complaints).toEqual({ count: 4, tone: 'danger' })
  })

  it('counts undated booking requests, which are owners waiting on the council', async () => {
    vi.mocked(inspectionsService.inspectorQueue).mockResolvedValue({
      assigned: [{}, {}, {}], waitlist: [{}, {}],
    } as never)
    await refreshWorkload()
    expect(workload.value.bookings).toEqual({ count: 2, tone: 'warn' })
  })

  it('re-reads once more when asked during a read, so a just-made change is not lost', async () => {
    // First read is slow and sees the register BEFORE a report is recorded.
    let releaseFirst!: () => void
    vi.mocked(complaintsApi.list)
      .mockImplementationOnce(() => new Promise(res => {
        releaseFirst = () => res({ data: [], summary: { open: 0, emergency: 0, awaiting_visit: 0, total: 0 } } as never)
      }))
      .mockResolvedValue({ data: [], summary: { open: 1, emergency: 0, awaiting_visit: 1, total: 1 } } as never)

    const first = refreshWorkload()
    await Promise.resolve()
    // The report is recorded and the section asks for a re-read mid-flight.
    const second = refreshWorkload()
    releaseFirst()
    await Promise.all([first, second])

    // Dropping the second call would leave the rail on the stale "nothing open".
    expect(workload.value.complaints).toEqual({ count: 1, tone: 'warn' })
    expect(complaintsApi.list).toHaveBeenCalledTimes(2)
  })

  it('renders NO badge for a section whose request failed — never a false zero', async () => {
    vi.mocked(dmApi.listEnforcement).mockRejectedValue(new Error('network'))
    vi.mocked(complaintsApi.list).mockRejectedValue(new Error('network'))
    vi.mocked(dmApi.inspectorQueueSummary).mockResolvedValue(summary({ today: 2 }) as never)

    await refreshWorkload()

    // The failures are absent, not zero — a red 0 on Enforcement would read as
    // a desk that is clear.
    expect('enforcement' in workload.value).toBe(false)
    expect('complaints' in workload.value).toBe(false)
    // And one section failing does not cost the others their counts.
    expect(workload.value.dashboard).toEqual({ count: 2, tone: 'info' })
  })
})
