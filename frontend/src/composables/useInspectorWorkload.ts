import { ref } from 'vue'
import { dmApi } from '@/services/developmentManagementService'
import { inspectionsService } from '@/services/inspectionsService'
import { complaintsApi } from '@/services/buildingComplaints'
import { complianceDeadline } from '@/inspector/caseFile'
import { officialEnforcementOpen } from '@/inspector/architecture'
import type { SectionKey } from '@/inspector/consoleRoute'

/**
 * What is outstanding, per console section, for the rail and the phone's
 * bottom bar.
 *
 * The console has thirteen sections and, until now, no way to tell from the
 * rail which of them was owed work. An inspector had to open Today, Bookings,
 * Enforcement and Public reports in turn to find out what their day looked
 * like — four navigations to answer one question.
 *
 * WHAT IS COUNTED
 * Signal, not totals. A badge reading "47" against Bookings is decoration; one
 * reading "3" against a section with three visits owed a date is the reason to
 * go there. Each count is the work that is actually demanding an act.
 *
 * NULL IS NOT ZERO
 * A count whose request failed stays null and renders no badge at all. A red
 * "0" on Enforcement because the orders endpoint was down would be worse than
 * no badge: it reads as a desk that is clear.
 *
 * Shared module state, so the rail and the bottom bar cannot disagree about how
 * much work there is.
 */

export type WorkloadTone = 'danger' | 'warn' | 'info'

export interface WorkloadEntry {
  count: number
  tone: WorkloadTone
}

/** Keys with no entry are sections that carry no outstanding-work notion. */
export type Workload = Partial<Record<SectionKey, WorkloadEntry>>

const workload = ref<Workload>({})
const loading = ref(false)
/**
 * A request arrived while one was in flight. Dropping it would be wrong: the
 * in-flight read may predate the change that prompted the new call (a report
 * recorded a moment ago), and the rail would then disagree with the page
 * beside it until the next age-guarded refresh. So it is remembered and run
 * once more when the current read lands.
 */
let rerunRequested = false

/** Only a positive count is an entry; nothing outstanding means no badge. */
function entry(count: number, tone: WorkloadTone): WorkloadEntry | undefined {
  return count > 0 ? { count, tone } : undefined
}

async function refreshWorkload(): Promise<void> {
  if (loading.value) { rerunRequested = true; return }
  loading.value = true

  const [queue, bookings, orders, complaints] = await Promise.allSettled([
    dmApi.inspectorQueueSummary(),
    inspectionsService.inspectorQueue(),
    dmApi.listEnforcement(),
    complaintsApi.list({ open: true, limit: 200 }),
  ])

  const next: Workload = {}

  if (queue.status === 'fulfilled') {
    // Due today plus anything already past its date — the day's actual list.
    const due = (queue.value?.today ?? 0) + (queue.value?.overdue ?? 0)
    next.dashboard = entry(due, queue.value?.overdue ? 'danger' : 'info')
  }

  if (bookings.status === 'fulfilled') {
    // A request with no date is an owner waiting on the council for an answer.
    next.bookings = entry(bookings.value.waitlist.length, 'warn')
  }

  if (orders.status === 'fulfilled') {
    // Past the compliance deadline and still open: the orders that have to be
    // revisited. Open-but-in-time orders are work in hand, not work owed.
    const overdue = orders.value.filter(o =>
      officialEnforcementOpen(o.status)
      && (complianceDeadline(o.issued_at, o.compliance_period)?.daysLeft ?? 1) < 0).length
    next.enforcement = entry(overdue, 'danger')
  }

  if (complaints.status === 'fulfilled') {
    const open = complaints.value.summary.open
    next.complaints = entry(open, complaints.value.summary.emergency ? 'danger' : 'warn')
  }

  workload.value = next
  loading.value = false
  if (rerunRequested) {
    rerunRequested = false
    await refreshWorkload()
  }
}

export function useInspectorWorkload() {
  return { workload, workloadLoading: loading, refreshWorkload }
}
