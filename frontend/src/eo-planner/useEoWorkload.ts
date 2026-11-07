/**
 * The EO's workload, read once and shared.
 *
 * Every section used to ask the server for the same 200 applications and then
 * filter them in the browser — the dashboard alone did it five times on mount,
 * for five queues cut from one list. This loads the working set once: the EO
 * decision queue (the server view that already carries the handoff state and
 * the deemed-refusal countdown) and the pre-acknowledgement intake queue, plus
 * two cheap counts for the registers that hang off the rail.
 *
 * Module-level state on purpose. The rail badge, the dashboard and the section
 * the officer is reading are three views of one workload, and they must not
 * disagree because they refreshed at different moments.
 */
import { computed, ref } from 'vue'
import {
  dmApi,
  type EoCase, type PermitApplication,
} from '@/services/developmentManagementService'
import { normalizeStatus } from '@/composables/useApplicationPipeline'
import { useEoPreferences } from './useEoPreferences'
import { caseClock, type CaseClock } from './console'

const cases = ref<EoCase[]>([])
const intake = ref<PermitApplication[]>([])
const openAppeals = ref(0)
const activeEnforcement = ref(0)

const loading = ref(false)
const error = ref<string | null>(null)
const loadedAt = ref(0)

/** One in-flight refresh at a time; callers share it rather than queueing. */
let inFlight: Promise<void> | null = null

/** Statuses that mean the application has not yet entered assessment. */
const INTAKE_STATUSES = ['pending_payment', 'registered', 'acknowledged'] as const

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [queue, intakePages, appeals, enforcement] = await Promise.all([
      dmApi.listEoCases(),
      Promise.all(INTAKE_STATUSES.map(status =>
        dmApi.listPermits({ status, limit: 200, offset: 0 })
          .then(r => r.data)
          .catch(() => [] as PermitApplication[]))),
      dmApi.listAppeals({ open: true }).catch(() => []),
      dmApi.listEnforcement({ status: 'active' }).catch(() => []),
    ])
    cases.value = queue
    intake.value = intakePages.flat()
      .sort((a, b) => (a.received_at ?? '').localeCompare(b.received_at ?? ''))
    openAppeals.value = appeals.length
    activeEnforcement.value = enforcement.length
    loadedAt.value = Date.now()
  } catch (err: unknown) {
    const ax = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = ax?.response?.data?.error ?? ax?.message ?? 'Could not read the workload.'
  } finally {
    loading.value = false
  }
}

export function useEoWorkload() {
  const { prefs } = useEoPreferences()

  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = load().finally(() => { inFlight = null })
    return inFlight
  }

  /** Re-read only if the working set is older than `maxAgeMs`. */
  function refreshIfStale(maxAgeMs = 120_000): Promise<void> {
    if (Date.now() - loadedAt.value < maxAgeMs) return Promise.resolve()
    return refresh()
  }

  const byStatus = (...wanted: string[]) =>
    computed(() => cases.value.filter(c => wanted.includes(normalizeStatus(c.status))))

  const circulation = byStatus('circulation')
  const notification = byStatus('objection_period')
  const review = byStatus('under_review')
  const deferred = byStatus('deferred')
  const awaitingDecision = computed(() =>
    cases.value.filter(c =>
      normalizeStatus(c.status) === 'awaiting_eo_decision' || c.handoff_status === 'submitted'))

  /** Reported by the planner and sent back for more work — the EO's own returns. */
  const returned = computed(() => cases.value.filter(c => c.handoff_status === 'returned'))

  /** Cases with a recommendation on file, which is what a committee sits on. */
  const forCommittee = computed(() =>
    review.value.filter(c => !!c.recommendation || c.handoff_status === 'submitted'))

  function clockFor(c: { acknowledged_at?: string | null; development_type?: string | null; days_to_deemed?: number | null }): CaseClock {
    // The server's countdown is authoritative where the view provides it; the
    // browser clock is only a fallback for rows that came from elsewhere.
    if (typeof c.days_to_deemed === 'number') {
      const d = c.days_to_deemed
      const warn = prefs.value.clockWarningDays
      if (d < 0) return { daysLeft: d, tone: 'expired', label: `Deemed refused ${Math.abs(d)} d ago` }
      if (d === 0) return { daysLeft: 0, tone: 'expired', label: 'Deemed refused today' }
      return {
        daysLeft: d,
        tone: d <= Math.ceil(warn / 2) ? 'urgent' : d <= warn ? 'caution' : 'ok',
        label: `${d} d to determine`,
      }
    }
    return caseClock(c.acknowledged_at ?? null, prefs.value.clockWarningDays, Date.now(), c.development_type)
  }

  /** Everything inside the council's own warning window, worst first. */
  const urgent = computed(() =>
    cases.value
      .filter(c => c.days_to_deemed != null && c.days_to_deemed <= prefs.value.clockWarningDays)
      .sort((a, b) => (a.days_to_deemed ?? 0) - (b.days_to_deemed ?? 0)))

  const breached = computed(() =>
    cases.value.filter(c => c.days_to_deemed != null && c.days_to_deemed < 0))

  /**
   * Rail badges. Work waiting, never a total: a rail that reads "412" beside a
   * register teaches the officer to stop reading the rail.
   */
  const badges = computed<Record<string, number>>(() => ({
    intake: intake.value.length,
    diligence: review.value.length,
    notification: notification.value.length,
    circulation: circulation.value.length,
    committee: forCommittee.value.length,
    decision: awaitingDecision.value.length + returned.value.length,
    appeals: openAppeals.value,
    enforcement: activeEnforcement.value,
  }))

  return {
    cases, intake, loading, error, loadedAt,
    refresh, refreshIfStale,
    circulation, notification, review, deferred, awaitingDecision, returned, forCommittee,
    urgent, breached, badges, clockFor,
  }
}
