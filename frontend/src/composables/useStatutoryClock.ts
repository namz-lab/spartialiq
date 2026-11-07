import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import { daysUntil, determinationDeadline } from '@/statutory/periods'

export type ClockPhase =
  | 'pre_ack' | 'consultation' | 'objections'
  | 'report_drafting' | 'committee' | 'permit_issue'
  // 'overdue' / 'completed' are set by consumers, not by this clock.
  | 'overdue' | 'deemed_refused' | 'completed'

export type WarningLevel = 'ok' | 'caution' | 'urgent' | 'critical'

export interface ClockState {
  ackDate:       Date | null
  expiryDate:    Date | null
  daysElapsed:   number
  daysRemaining: number
  weekNumber:    number
  phase:         ClockPhase
  warningLevel:  WarningLevel
}

/**
 * NOMINAL length of the determination period, for display scaling only (week milestones, progress). Never for a deadline:
 * the Act counts calendar months (three, or four for a subdivision), so use determinationDeadline() in '@/statutory/periods'.
 */
export const STATUTORY_DAYS = 90

const MILESTONES = [
  { week: 0,  label: 'Intake' },
  { week: 1,  label: 'Ack'     },
  { week: 3,  label: 'Notice'  },
  { week: 6,  label: 'Objections' },
  { week: 9,  label: 'Report'  },
  { week: 12, label: 'Resolution' },
] as const

function diffDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

// Pure derivation: takes an ISO ack date (or null) and a 'now' Date, returns the
// fully-derived clock state. Exported so tests + consumer guards can call this
// without instantiating reactivity. Math is UTC; daysRemaining == 0 already
// triggers deemed_refused (statutory boundary — do not change without legal review).
export function deriveStatutoryState(ackIso: string | null, now: Date = new Date(), devType?: string | null): ClockState {
  if (!ackIso) {
    return {
      ackDate: null, expiryDate: null,
      daysElapsed: 0, daysRemaining: STATUTORY_DAYS,
      weekNumber: 0, phase: 'pre_ack', warningLevel: 'ok',
    }
  }
  const ack = new Date(ackIso)
  const expiry = new Date(determinationDeadline(ackIso, devType) ?? ackIso)
  const daysElapsed   = Math.max(0, diffDays(ack, now))
  const daysRemaining = daysUntil(expiry.toISOString(), now)
  const weekNumber    = Math.floor(daysElapsed / 7)
  let phase: ClockPhase
  if (daysRemaining <= 0)        phase = 'deemed_refused'
  else if (weekNumber < 1)       phase = 'consultation'
  else if (weekNumber < 6)       phase = 'objections'
  else if (weekNumber < 9)       phase = 'report_drafting'
  else if (weekNumber < 12)      phase = 'committee'
  else                           phase = 'permit_issue'
  let warningLevel: WarningLevel
  if (daysRemaining > 30)        warningLevel = 'ok'
  else if (daysRemaining > 14)   warningLevel = 'caution'
  else if (daysRemaining > 0)    warningLevel = 'urgent'
  else                           warningLevel = 'critical'
  return { ackDate: ack, expiryDate: expiry, daysElapsed, daysRemaining, weekNumber, phase, warningLevel }
}

export function useStatutoryClock(ackDateRef: Ref<string | null>, devTypeRef?: Ref<string | null | undefined>) {
  const tick = ref(0)
  const scope = getCurrentScope()
  // Only register a wall-clock ticker + cleanup when there's an enclosing scope
  // (i.e. inside a component's setup or effectScope). In test / script
  // environments without a scope we skip both — tests seed the date manually.
  // window.setInterval returns a numeric handle in the browser; typing it as
  // `number` keeps this independent of the ambient Node timer typings.
  let intervalId: number | null = null
  if (scope && typeof window !== 'undefined') {
    intervalId = window.setInterval(() => { tick.value++ }, 60_000)
    onScopeDispose(() => { if (intervalId !== null) window.clearInterval(intervalId) })
  }

  const state = computed<ClockState>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    tick.value  // create a dependency on the ticker so we recompute every minute
    return deriveStatutoryState(ackDateRef.value, new Date(), devTypeRef?.value)
  })

  function weekMilestones(): ReadonlyArray<{ readonly week: number; readonly label: string }> {
    return MILESTONES
  }

  return { state, weekMilestones }
}
