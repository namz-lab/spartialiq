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

const permit = ref<PermitApplication | null>(null)
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
  const clock = computed(() =>
    caseClock(permit.value?.acknowledged_at ?? null, prefs.value.clockWarningDays, Date.now(),
      (permit.value as { development_type?: string | null } | null)?.development_type))

  return {
    permit,
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
