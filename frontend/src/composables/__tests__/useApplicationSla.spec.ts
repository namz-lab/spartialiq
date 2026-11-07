import { describe, it, expect } from 'vitest'
import { slaForPermit, summariseSla } from '@/composables/useApplicationSla'
import type { PermitApplication } from '@/services/developmentManagementService'

const NOW = new Date('2026-06-09T00:00:00Z')

function permit(over: Partial<PermitApplication>): PermitApplication {
  return {
    id: 'p', status: 'registered', development_type: 'new_building',
    received_at: '2026-06-01', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    ...over,
  } as unknown as PermitApplication
}

describe('useApplicationSla — slaForPermit (type-aware statutory clock)', () => {
  it('buckets an open application well within its window as on_track', () => {
    const s = slaForPermit(permit({ received_at: '2026-06-01' }), NOW) // 8 days of 30
    expect(s.decided).toBe(false)
    expect(s.bucket).toBe('on_track')
    expect(s.statutoryDays).toBe(30)
  })

  it('flags an open application within 7 days of the deadline as due_soon', () => {
    const s = slaForPermit(permit({ received_at: '2026-05-15' }), NOW) // 25 of 30 → 5 left
    expect(s.bucket).toBe('due_soon')
  })

  it('flags an open application past its window as overdue', () => {
    const s = slaForPermit(permit({ received_at: '2026-04-25' }), NOW) // 45 of 30
    expect(s.bucket).toBe('overdue')
    expect(s.remainingDays).toBeLessThan(0)
  })

  it('measures a decided application as on-time when within the window', () => {
    const s = slaForPermit(
      permit({ status: 'approved', received_at: '2026-06-01', updated_at: '2026-06-10T00:00:00Z' }), NOW)
    expect(s.decided).toBe(true)
    expect(s.ageDays).toBe(9)
    expect(s.onTime).toBe(true)
  })

  it('uses the special-consent 90-day window for rezoning', () => {
    const s = slaForPermit(permit({ development_type: 'rezoning', received_at: '2026-06-01' }), NOW)
    expect(s.statutoryDays).toBe(90)
    expect(s.bucket).toBe('on_track')
  })
})

describe('useApplicationSla — summariseSla', () => {
  it('aggregates buckets and cycle-time across the register', () => {
    const permits = [
      permit({ received_at: '2026-06-01' }),                                              // on_track
      permit({ received_at: '2026-05-15' }),                                              // due_soon
      permit({ received_at: '2026-04-25' }),                                              // overdue
      permit({ status: 'approved', received_at: '2026-06-01', updated_at: '2026-06-10T00:00:00Z' }), // decided on-time
    ]
    const s = summariseSla(permits, NOW)
    expect(s.total).toBe(4)
    expect(s.open).toBe(3)
    expect(s.decided).toBe(1)
    expect(s.overdue).toBe(1)
    expect(s.dueSoon).toBe(1)
    expect(s.onTrack).toBe(1)
    expect(s.avgDaysToDecision).toBe(9)
    expect(s.onTimeRate).toBe(1)
  })

  it('returns null metrics for an empty register', () => {
    const s = summariseSla([], NOW)
    expect(s.total).toBe(0)
    expect(s.avgDaysToDecision).toBeNull()
    expect(s.onTimeRate).toBeNull()
  })
})
