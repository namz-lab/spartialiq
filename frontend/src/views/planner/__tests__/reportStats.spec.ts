import { describe, it, expect } from 'vitest'
import { buildReturns, periodBounds, periodLabel, share } from '../reportStats'
import type { PermitApplication } from '@/services/developmentManagementService'

const permit = (over: Partial<PermitApplication>): PermitApplication => ({
  id: Math.random().toString(36).slice(2), tpd_reference: null, dev_register_no: null,
  stand_number: '1', suburb_ward: '3', applicant_name: 'A', applicant_id_number: '',
  applicant_phone: null, applicant_email: null, development_type: 'new_building',
  description: '', status: 'registered', fee_paid: true, received_at: null,
  created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...over,
} as PermitApplication)

describe('reportStats', () => {
  it('bounds months, quarters and years', () => {
    expect(periodBounds({ kind: 'month', year: 2026, index: 1 }).map(d => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01', '2026-02-28'])
    expect(periodBounds({ kind: 'quarter', year: 2026, index: 3 })[1].toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(periodLabel({ kind: 'month', year: 2026, index: 8 })).toBe('September 2026')
  })

  it('counts by receipt and decision date, with turnaround and timeliness', () => {
    const now = new Date('2026-09-26T00:00:00Z')
    const rows = [
      // Received in Q3, acknowledged day 5, approved day 40: in time.
      permit({ received_at: '2026-07-01T00:00:00Z', acknowledged_at: '2026-07-06T00:00:00Z', decision_at: '2026-08-10T00:00:00Z', status: 'approved' }),
      // Received in Q2, acknowledged 20 Apr, refused 20 Sep (in Q3): 153 days, late.
      permit({ received_at: '2026-04-01T00:00:00Z', acknowledged_at: '2026-04-20T00:00:00Z', decision_at: '2026-09-20T00:00:00Z', status: 'refused' }),
      // Received yesterday: acknowledgement not yet due.
      permit({ received_at: '2026-09-25T00:00:00Z', suburb_ward: '' }),
      // Received in Q1, still live, past 90 days: overdue now, not in the Q3 counts.
      permit({ received_at: '2026-02-01T00:00:00Z', status: 'under_review' }),
    ]
    const r = buildReturns(rows, [], { kind: 'quarter', year: 2026, index: 3 }, now)
    expect(r.received).toBe(2)
    expect(r.decided).toBe(2)
    expect([r.approved, r.refused]).toEqual([1, 1])
    expect(r.medianDaysToDecision).toBe(Math.round((40 + 172) / 2))
    expect(r.decidedInTime).toBe(1)
    expect([r.ackOnTime, r.ackDue]).toEqual([1, 1])
    expect(r.overdueNow).toBe(1)
    expect(r.byWard.map(([w]) => w)).toContain('Ward 3')
    expect(r.byWard.map(([w]) => w)).toContain('Ward not recorded')
    expect(r.byType[0][0]).toBe('New building')
  })

  it('formats shares', () => {
    expect(share(3, 4)).toBe('3 of 4 (75%)')
    expect(share(0, 0)).toBe('—')
  })
})
