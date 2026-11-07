import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'

/**
 * Keep a kept-alive section's data honest.
 *
 * The inspector console wraps every section in `<KeepAlive>` so a half-marked
 * checklist survives a trip to Reference and back. The cost is that a section
 * which loads in `onMounted` loads ONCE, for the life of the session — and an
 * inspector who opens Today at 07:00 and comes back to it after four hours of
 * site visits is shown the 07:00 queue, with no sign that it is four hours old.
 * Bookings and Enforcement had the same shape.
 *
 * Two moments matter, and they are not the same moment:
 *
 *   - coming back to the section  (`onActivated`)
 *   - coming back to the APP      (`visibilitychange`) — the common one in the
 *     field, where the phone is pocketed between sites with the section still
 *     open, so `onActivated` never fires
 *
 * Both are guarded by age, so switching between two sections in quick
 * succession does not re-query the register twice, and only the section the
 * inspector is actually looking at reacts to the app waking up.
 *
 * This does not replace the visible Refresh button. It removes the need to
 * remember to press it.
 */
export function useStaleRefresh(
  refresh: () => void | Promise<void>,
  maxAgeMs = 120_000,
) {
  const lastRun = ref(0)
  /** False while the section is cached but not on screen. */
  let onScreen = true

  function run() {
    lastRun.value = Date.now()
    void refresh()
  }

  function runIfStale() {
    if (Date.now() - lastRun.value >= maxAgeMs) run()
  }

  function onVisibility() {
    if (onScreen && document.visibilityState === 'visible') runIfStale()
  }

  onMounted(() => {
    run()
    document.addEventListener('visibilitychange', onVisibility)
  })
  // Fires on the first mount too; the age guard makes that a no-op.
  onActivated(() => { onScreen = true; runIfStale() })
  onDeactivated(() => { onScreen = false })
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibility))

  /** Exposed so a manual Refresh resets the clock rather than racing it. */
  return { refreshNow: run, lastRun }
}
