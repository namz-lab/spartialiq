/**
 * The console's shared counters and the open file.
 *
 * WHY THIS IS MODULE-LEVEL STATE
 * The rail badges, the dashboard tiles, the deadline board and whichever
 * section is open all read the same numbers. The console used to fetch them
 * per component — and worse, it built the dashboard from six separate reads
 * of the whole permit table, five hundred rows each, then counted them in the
 * browser. On a rural link that is most of a megabyte to show eight numbers,
 * and it let the rail's badge disagree with the tile immediately below it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * No polling. A timer refreshing a console nobody is looking at spends a
 * council's data allowance to keep a number nobody is reading current. The
 * shell re-reads on mount and on every section change, which is exactly when
 * the numbers start mattering.
 *
 * FAILURE IS VISIBLE
 * `error` is a separate field from `data`, and the shell renders it. A
 * dashboard that quietly shows zero overdue acknowledgements because the
 * request failed is worse than one that shows nothing at all — the first one
 * tells a clerk their letters are up to date.
 */

import { computed, ref } from 'vue'
import {
  getOverview, getDeadlines, getFile, errorMessage, num,
  type ClerkOverview, type Deadline, type ClerkFile,
} from '@/services/planningClerk'

// ── Counters ────────────────────────────────────────────────────────────

const data = ref<ClerkOverview | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** Everything past its date, across every register. Drives the rail badge. */
const overdueTotal = computed(() => {
  const d = data.value
  if (!d) return 0
  return num(d.acknowledgements.overdue) + num(d.refusals.overdue) + num(d.movements.files_overdue)
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await getOverview()
  } catch (err) {
    error.value = errorMessage(err, 'Could not read the console counters.')
  } finally {
    loading.value = false
  }
}

// ── Deadlines ───────────────────────────────────────────────────────────
// Shared for the same reason as the counters: the dashboard shows the next
// few and the deadline board shows them all, and two fetches of the same
// list is two chances for them to disagree about what is overdue.

const deadlines = ref<Deadline[]>([])
const deadlinesLoading = ref(false)
const deadlinesError = ref<string | null>(null)
const deadlinesHorizon = ref(0)

async function refreshDeadlines(days: number, force = false): Promise<void> {
  // A horizon change is a real reason to refetch; re-entering the section
  // with the same horizon is not.
  if (!force && deadlinesHorizon.value === days && deadlines.value.length) return
  deadlinesLoading.value = true
  deadlinesError.value = null
  try {
    deadlines.value = await getDeadlines(days)
    deadlinesHorizon.value = days
  } catch (err) {
    deadlinesError.value = errorMessage(err, 'Could not read the statutory deadlines.')
  } finally {
    deadlinesLoading.value = false
  }
}

// ── The open file ───────────────────────────────────────────────────────
// One fetch, shared by every section that can act on a file. The clerk opens
// a file at the counter and then works four sections against it; each of them
// reading the file itself would be four identical requests with somebody
// standing at the desk.

const file = ref<ClerkFile | null>(null)
const fileLoading = ref(false)
const fileError = ref<string | null>(null)
let fileKey: string | null = null

async function loadFile(permitId: string | null, force = false): Promise<void> {
  if (!permitId) {
    file.value = null
    fileError.value = null
    fileKey = null
    return
  }
  if (!force && fileKey === permitId && file.value) return
  fileLoading.value = true
  fileError.value = null
  // Cleared before the await, not after: leaving the previous file on screen
  // while a different one loads is how a clerk reads the wrong applicant's
  // details out to somebody at the counter.
  file.value = null
  fileKey = permitId
  try {
    const next = await getFile(permitId)
    // A second open may have overtaken this one while it was in flight.
    if (fileKey === permitId) file.value = next
  } catch (err) {
    if (fileKey === permitId) {
      fileError.value = errorMessage(err, 'Could not open that file.')
    }
  } finally {
    if (fileKey === permitId) fileLoading.value = false
  }
}

/**
 * Called after any write that changes a counter or the open file.
 *
 * Both, always: receipting a fee changes the day's takings AND adds a row to
 * the file the clerk is looking at, and a caller that remembered only one of
 * those is how a register row appears without the badge moving.
 */
function invalidate(): void {
  void refresh()
  if (fileKey) void loadFile(fileKey, true)
  if (deadlinesHorizon.value) void refreshDeadlines(deadlinesHorizon.value, true)
}

export function useClerkOverview() {
  return {
    data, loading, error, overdueTotal, refresh,
    deadlines, deadlinesLoading, deadlinesError, refreshDeadlines,
    file, fileLoading, fileError, loadFile,
    invalidate,
  }
}
