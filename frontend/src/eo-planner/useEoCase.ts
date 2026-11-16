/**
 * The case the EO console has open.
 *
 * One application, chosen once, worked everywhere. Intake, due diligence,
 * public notice, circulation, the committee report, the determination and the
 * permit are seven views of the same file, and before this each carried its
 * own picker: the officer chose the same application five times and had no way
 * of telling whether two sections were even showing the same case.
 *
 * The open case lives in the URL (?case=<uuid>, see ./console.ts) and is
 * mirrored into usePlannerCase, which is what the Step1–Step5 components and
 * the statutory clock banner already read. So opening a case here opens it for
 * them too, with no second copy of "which case is open" to drift.
 *
 * State is module-level: every section sees the same case, loaded once. The
 * watcher that follows the URL belongs to the console shell — see
 * EOPlannerPortalView — so it runs once per console, not once per section.
 */
import { computed, ref } from 'vue'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { useOrProvidePlannerCase } from '@/composables/usePlannerCase'
import { useEoNav } from './useEoNav'
import { useEoPreferences } from './useEoPreferences'
import { caseClock } from './console'
import { eoWorkflowApi, type CaseLane } from '@/services/eoWorkflow'
import { caseStep, nextDate } from './caseSteps'

const permit = ref<PermitApplication | null>(null)
/** The council's workflow position for the open case: lane, dates, what stands in the way. Best effort: the case opens without it. */
const lane = ref<CaseLane | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** What is actually loaded, so a repeated URL read is not a repeated fetch. */
let loadedId: string | null = null

export function useEoCase() {
  const nav = useEoNav()
  // useOrProvide, not use: the console shell calls this in the same setup that
  // provides the planner case, and Vue resolves inject() from the PARENT chain
  // — so a plain usePlannerCase() here throws in the one component that owns
  // the context.
  const planner = useOrProvidePlannerCase()
  const { prefs } = useEoPreferences()

  async function load(id: string | null, force = false): Promise<void> {
    if (!id) {
      permit.value = null
      lane.value = null
      loadedId = null
      error.value = null
      return
    }
    if (id === loadedId && !force) return
    loading.value = true
    error.value = null
    try {
      const p = await dmApi.getPermit(id)
      permit.value = p
      loadedId = id
      lane.value = await eoWorkflowApi.lane(id).catch(() => null)
      // Mirror into the planner case file the step components read. It reads
      // the same permit again, which is one extra request on opening a case
      // and the price of not keeping two ideas of "the open case".
      await planner.loadFromPermit(id)
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { error?: string } }; message?: string }
      error.value = ax?.response?.status === 404
        ? 'That application no longer exists, or was never on this council’s register.'
        : ax?.response?.data?.error ?? ax?.message ?? 'Could not open the case.'
      permit.value = null
      loadedId = null
    } finally {
      loading.value = false
    }
  }

  function reload(): Promise<void> {
    return load(nav.caseId.value, true)
  }

  /** Reference an officer would write on a file cover. */
  const reference = computed(() => {
    const p = permit.value
    if (!p) return null
    return p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase()
  })

  /**
   * The determination clock. It runs from acknowledgement — s.26(7) counts from the council's acknowledgement, not from the
   * day the envelope arrived — so a case nobody has acknowledged has none yet. Three months, or four for a subdivision.
   */
  const DECIDED = ['approved', 'approved_with_conditions', 'refused']
  const isDecided = computed(() => DECIDED.includes(permit.value?.status ?? ''))
  const clock = computed(() => isDecided.value
    ? { daysLeft: null, tone: 'ok' as const, label: 'Decided' }
    : caseClock(permit.value?.acknowledged_at ?? null, prefs.value.clockWarningDays, Date.now(),
      (permit.value as { development_type?: string | null } | null)?.development_type))

  /** Where the case is on its road, and the next date to work to. */
  const step = computed(() => caseStep({
    status: permit.value?.status ?? '',
    committeeResolved: !!lane.value?.committee && lane.value.committee.outcome !== 'deferred' && lane.value.committee.outcome !== 'noted',
    notified: !!permit.value?.notification_date,
    acknowledged: !!permit.value?.acknowledged_at,
  }))
  // once decided, the dates to work to are history
  const upcoming = computed(() => (isDecided.value ? null : nextDate(lane.value?.milestones, new Date().toISOString().slice(0, 10))))

  return {
    permit,
    lane,
    step,
    upcoming,
    loading,
    error,
    caseId: nav.caseId,
    reference,
    clock,
    load,
    reload,
    open: nav.openCase,
    close: () => nav.openCase(null),
  }
}
