/**
 * Owner-requested stage inspection bookings, arranged as an inspector's agenda.
 *
 * Pure: no Vue, no API. The day boundaries are the device's local day, which is
 * what an inspector means by "today" when planning a run.
 */
import type { InspectionBooking } from '@/services/inspectionsService'

export interface AgendaDay {
  key: string
  label: string
  overdue: boolean
  bookings: InspectionBooking[]
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const DAY = 86_400_000

/** Group scheduled bookings by local day: Overdue first, then Today, Tomorrow, dated days. */
export function groupAgenda(bookings: InspectionBooking[], now = new Date()): AgendaDay[] {
  const today = dayStart(now)
  const days = new Map<string, AgendaDay>()
  const sorted = [...bookings]
    .filter(b => b.scheduledFor && !Number.isNaN(new Date(b.scheduledFor).getTime()))
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime())

  for (const b of sorted) {
    const when = new Date(b.scheduledFor!)
    const start = dayStart(when)
    const overdue = start < today
    const key = overdue ? 'overdue' : String(start)
    if (!days.has(key)) {
      const label = overdue ? 'Overdue'
        : start === today ? 'Today'
        : start === today + DAY ? 'Tomorrow'
        : when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
      days.set(key, { key, label, overdue, bookings: [] })
    }
    days.get(key)!.bookings.push(b)
  }
  return [...days.values()]
}

/** Whole days a paid request has waited for a date. */
export function daysWaiting(b: InspectionBooking, now = new Date()): number {
  const from = b.feePaidAt || b.createdAt
  const t = new Date(from).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((dayStart(now) - dayStart(new Date(t))) / DAY))
}

/**
 * The By-Laws require the owner to give at least 48 hours' notice before work
 * reaches an inspection stage (Sec 14). A request older than that is due.
 */
export function noticeElapsed(b: InspectionBooking, now = new Date()): boolean {
  const t = new Date(b.feePaidAt || b.createdAt).getTime()
  return !Number.isNaN(t) && now.getTime() - t >= 48 * 3_600_000
}

/** Combine a yyyy-mm-dd date and hh:mm time in local time; null when invalid. */
export function localDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const out = new Date(y, m - 1, d, hh, mm)
  return Number.isNaN(out.getTime()) || out.getDate() !== d ? null : out
}
