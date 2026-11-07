/**
 * The console's shared counters.
 *
 * WHY THIS IS MODULE-LEVEL STATE
 * Five things read the same numbers: the rail badges, the overview tiles, the
 * maintenance bar, the jump palette's staff list, and whichever section the
 * admin has open. Fetching per component would put five identical requests on
 * a rural link every time a section changed, and would let the rail's badge
 * disagree with the tile immediately below it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * No polling. A timer refreshing a console nobody is looking at spends a
 * council's data allowance to keep a number nobody is reading current. The
 * shell re-reads on mount and on every section change, which is exactly when
 * the numbers start mattering.
 *
 * FAILURE IS VISIBLE
 * `error` is a separate field from `data` and the shell renders it. A security
 * overview that quietly shows zero failed sign-ins because the request failed
 * is worse than one that shows nothing at all.
 */

import { computed, ref } from 'vue'
import {
  getOverview, listStaff, listSettings, errorMessage,
  type AdminOverview, type StaffUser, type AdminSetting,
} from '@/services/adminConsole'

const data = ref<AdminOverview | null>(null)
const settings = ref<AdminSetting[]>([])
const staff = ref<StaffUser[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/**
 * Whether a maintenance window is open.
 *
 * Read from the settings list rather than added to /admin/overview: the
 * settings section already loads it, the value is a string in the same shape
 * everywhere, and one more sub-select on the overview query to answer a
 * question the console already knows is a query nobody needs.
 */
const maintenanceMode = computed(() =>
  settings.value.find(s => s.key === 'system.maintenance_mode')?.value === 'true')

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    // Together, because the maintenance bar and the badges appear at the same
    // moment and two sequential awaits would show one before the other.
    const [overview, settingList] = await Promise.all([getOverview(), listSettings()])
    data.value = overview
    settings.value = settingList
  } catch (err) {
    error.value = errorMessage(err, 'Could not read the console counters.')
  } finally {
    loading.value = false
  }
}

/**
 * The staff register, for the jump palette.
 *
 * Loaded on demand and then kept: the palette is opened repeatedly in one
 * session and the register changes when the admin changes it, which is a
 * moment the Employees section already refreshes.
 */
async function loadStaff(force = false): Promise<void> {
  if (staff.value.length && !force) return
  try {
    staff.value = await listStaff(true)
  } catch {
    // The palette still offers every section; a missing staff list narrows it
    // rather than breaking it, so this is not worth an error banner.
    staff.value = []
  }
}

/** Called after any write that changes a counter, so the rail catches up. */
function invalidate(): void {
  void refresh()
  void loadStaff(true)
}

export function useAdminOverview() {
  return { data, settings, staff, loading, error, maintenanceMode, refresh, loadStaff, invalidate }
}
