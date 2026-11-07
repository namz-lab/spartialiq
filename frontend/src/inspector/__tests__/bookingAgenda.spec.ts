import { describe, it, expect } from 'vitest'
import { groupAgenda, daysWaiting, noticeElapsed, localDateTime } from '../bookingAgenda'
import type { InspectionBooking } from '@/services/inspectionsService'

const NOW = new Date(2026, 8, 14, 9, 0) // Mon 14 Sep 2026, 09:00 local

function b(id: string, over: Partial<InspectionBooking> = {}): InspectionBooking {
  return {
    id, applicationId: 'app', stageNumber: 2, stageName: 'Foundations', citizenId: null, inspectorId: null,
    status: 'scheduled', feePaidAt: null, scheduledFor: null, completedAt: null, passed: null,
    citizenNotes: null, inspectorNotes: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  }
}

describe('booking agenda', () => {
  it('orders overdue, today, tomorrow, then dated days, earliest first within a day', () => {
    const days = groupAgenda([
      b('later', { scheduledFor: new Date(2026, 8, 17, 10).toISOString() }),
      b('today-pm', { scheduledFor: new Date(2026, 8, 14, 14).toISOString() }),
      b('late', { scheduledFor: new Date(2026, 8, 11, 8).toISOString() }),
      b('today-am', { scheduledFor: new Date(2026, 8, 14, 8).toISOString() }),
      b('tomorrow', { scheduledFor: new Date(2026, 8, 15, 8).toISOString() }),
    ], NOW)

    expect(days.map(d => d.label.split(' ')[0])).toEqual(['Overdue', 'Today', 'Tomorrow', 'Thursday'])
    expect(days[1].bookings.map(x => x.id)).toEqual(['today-am', 'today-pm'])
    expect(days[0].overdue).toBe(true)
  })

  it('drops bookings without a valid date rather than inventing one', () => {
    expect(groupAgenda([b('x'), b('y', { scheduledFor: 'nope' })], NOW)).toEqual([])
  })

  it('counts waiting days from payment and applies the 48-hour notice rule', () => {
    const paid = b('w', { feePaidAt: new Date(2026, 8, 12, 9).toISOString() })
    expect(daysWaiting(paid, NOW)).toBe(2)
    expect(noticeElapsed(paid, NOW)).toBe(true)
    expect(noticeElapsed(b('n', { feePaidAt: new Date(2026, 8, 13, 12).toISOString() }), NOW)).toBe(false)
  })

  it('builds a local date-time and rejects impossible dates', () => {
    expect(localDateTime('2026-09-15', '08:30')?.getHours()).toBe(8)
    expect(localDateTime('2026-02-30', '08:30')).toBeNull()
    expect(localDateTime('', '08:30')).toBeNull()
  })
})
