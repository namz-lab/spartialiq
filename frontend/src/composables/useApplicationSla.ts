// ─── useApplicationSla ───────────────────────────────────────────────────
// CityView-style "legislated timeline adherence" + "time spent vs target"
// metrics for the permit register. Type-aware: the statutory window comes from
// the application's approval track (developmentTracks), 30 days for routine
// permits and 90 for special-consent types.
//
// Pure functions over PermitApplication — no side effects, easy to test.
// Cycle time for decided applications is approximated as received_at → updated_at
// (the last status change ≈ the determination); a precise figure would read the
// permit_event audit log, but the register list gives a good aggregate cheaply.
// ───────────────────────────────────────────────────────────────────────────
import type { PermitApplication } from '@/services/developmentManagementService'
import { normalizeStatus } from '@/composables/useApplicationPipeline'
import { trackFor } from '@/views/planner/developmentTracks'

const TERMINAL = ['approved', 'approved_with_conditions', 'refused', 'withdrawn']
const MS_DAY = 86_400_000

export type SlaBucket = 'decided' | 'overdue' | 'due_soon' | 'on_track'

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.round((db - da) / MS_DAY)
}

export interface PermitSla {
  statutoryDays: number
  ageDays: number | null        // received → now (open) or received → decided
  remainingDays: number | null  // statutoryDays − ageDays (open only)
  decided: boolean
  onTime: boolean | null        // decided within the statutory window
  bucket: SlaBucket
}

export function slaForPermit(p: PermitApplication, now: Date = new Date()): PermitSla {
  const status = normalizeStatus(p.status)
  const decided = TERMINAL.includes(status)
  const statutoryDays = trackFor(p.development_type).statutoryDays
  const received = p.received_at || p.created_at

  if (decided) {
    const cycle = daysBetween(received, p.updated_at)
    return {
      statutoryDays, ageDays: cycle, remainingDays: null, decided: true,
      onTime: cycle == null ? null : cycle <= statutoryDays, bucket: 'decided',
    }
  }

  const age = daysBetween(received, now.toISOString())
  const remaining = age == null ? null : statutoryDays - age
  let bucket: SlaBucket = 'on_track'
  if (remaining != null) {
    if (remaining < 0) bucket = 'overdue'
    else if (remaining <= 7) bucket = 'due_soon'
  }
  return { statutoryDays, ageDays: age, remainingDays: remaining, decided: false, onTime: null, bucket }
}

export interface SlaSummary {
  total: number
  open: number
  decided: number
  overdue: number
  dueSoon: number
  onTrack: number
  avgDaysToDecision: number | null
  onTimeRate: number | null   // 0..1 (decided within statutory window)
  avgOpenAge: number | null
}

export function summariseSla(permits: PermitApplication[], now: Date = new Date()): SlaSummary {
  let open = 0, decided = 0, overdue = 0, dueSoon = 0, onTrack = 0
  const cycleTimes: number[] = []
  const openAges: number[] = []
  let onTimeCount = 0, decidedWithCycle = 0

  for (const p of permits) {
    const s = slaForPermit(p, now)
    if (s.decided) {
      decided++
      if (s.ageDays != null) { cycleTimes.push(s.ageDays); decidedWithCycle++; if (s.onTime) onTimeCount++ }
    } else {
      open++
      if (s.ageDays != null) openAges.push(s.ageDays)
      if (s.bucket === 'overdue') overdue++
      else if (s.bucket === 'due_soon') dueSoon++
      else onTrack++
    }
  }

  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null
  return {
    total: permits.length, open, decided, overdue, dueSoon, onTrack,
    avgDaysToDecision: avg(cycleTimes),
    onTimeRate: decidedWithCycle ? onTimeCount / decidedWithCycle : null,
    avgOpenAge: avg(openAges),
  }
}
