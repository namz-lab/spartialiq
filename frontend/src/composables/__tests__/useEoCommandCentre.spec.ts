import { describe, it, expect } from 'vitest'
import {
  deriveMetrics, deriveQueue, deriveProposals, deriveWardActivity,
  deriveViolations, deriveStaffWorkload, parseWard, stageForStatus,
} from '../useEoCommandCentre'
import type { PermitApplication, EnforcementOrder } from '@/services/developmentManagementService'

const NOW = new Date('2026-06-08T00:00:00.000Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

function permit(over: Partial<PermitApplication> = {}): PermitApplication {
  return {
    id: 'p-' + Math.random().toString(36).slice(2),
    tpd_reference: null, dev_register_no: null,
    stand_number: '100', suburb_ward: 'Ward 4 — Lalapanzi',
    applicant_name: 'Tendai Moyo', applicant_id_number: '63-1', applicant_phone: null, applicant_email: null,
    development_type: 'new_building', description: null,
    status: 'registered', fee_paid: true,
    received_at: daysAgo(10), created_by: 'u1', created_at: daysAgo(10), updated_at: daysAgo(1),
    ...over,
  }
}

function order(over: Partial<EnforcementOrder> = {}): EnforcementOrder {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    order_reference: 'ENF-1', permit_application_id: null,
    stand_number: '100', suburb_ward: 'Ward 5 — Zhombe North',
    owner_name: 'Owner', owner_contact: null,
    order_type: 'stop_work', breach_description: 'Unauthorised works',
    required_action: 'Stop', compliance_period: 30, issued_at: daysAgo(3),
    status: 'active', notes: null, latitude: -19.4, longitude: 29.8,
    created_at: daysAgo(3), updated_at: daysAgo(3),
    ...over,
  }
}

describe('parseWard', () => {
  it('parses "Ward N — Name", bare numbers, and free text', () => {
    expect(parseWard('Ward 4 — Lalapanzi')).toEqual({ key: 'w4', label: 'Ward 4 — Lalapanzi' })
    expect(parseWard('7')).toEqual({ key: 'w7', label: 'Ward 7' })
    expect(parseWard('Mkoba')).toEqual({ key: 'mkoba', label: 'Mkoba' })
    expect(parseWard('')).toEqual({ key: 'unknown', label: 'Unassigned ward' })
  })
})

describe('stageForStatus', () => {
  it('maps statuses to stage chips resiliently', () => {
    expect(stageForStatus('approved_with_conditions')).toBe('approved')
    expect(stageForStatus('refused')).toBe('rejected')
    expect(stageForStatus('circulation')).toBe('circulating')
    expect(stageForStatus('consultation')).toBe('circulating')
    expect(stageForStatus('conditionally_approved')).toBe('approved')
    expect(stageForStatus('registered')).toBe('awaiting_eo')
  })
})

describe('deriveMetrics', () => {
  it('counts pending, active, violations and averages turnaround', () => {
    const permits = [
      permit({ status: 'registered' }),
      permit({ status: 'under_review' }),
      permit({ status: 'approved', received_at: daysAgo(20), updated_at: daysAgo(10) }), // 10-day turnaround
      permit({ status: 'refused', received_at: daysAgo(8), updated_at: daysAgo(4) }),    // 4-day turnaround
    ]
    const enforcement = [order({ status: 'active' }), order({ status: 'complied' })]
    const m = deriveMetrics(permits, enforcement)
    expect(m.pendingApprovals).toBe(2)   // registered + under_review
    expect(m.activeProjects).toBe(2)     // the two undecided
    expect(m.envViolations).toBe(1)      // only the active order
    expect(m.avgTurnaroundDays).toBe(7)  // (10 + 4) / 2
    expect(m.revenueThisMonth).toBeNull()
  })
})

describe('deriveQueue', () => {
  it('keeps only actionable permits, flags unpaid + deemed, sorts by urgency', () => {
    const permits = [
      permit({ status: 'approved' }),                                  // excluded (decided)
      permit({ status: 'registered', received_at: daysAgo(85), fee_paid: false }), // 5 days to deemed → urgent
      permit({ status: 'under_review', received_at: daysAgo(2) }),     // plenty of time
    ]
    const q = deriveQueue(permits, NOW)
    expect(q).toHaveLength(2)
    expect(q[0].priority).toBe('urgent')         // nearest deemed-refusal first
    expect(q[0].flags).toContain('Fee unpaid')
    expect(q[0].flags.some(f => f.includes('deemed'))).toBe(true)
  })
})

describe('deriveProposals', () => {
  it('maps every permit to a card with ref, stand, stage', () => {
    const cards = deriveProposals([permit({ stand_number: '512', status: 'approved' })])
    expect(cards).toHaveLength(1)
    expect(cards[0].stand).toBe('512')
    expect(cards[0].stage).toBe('approved')
    expect(cards[0].ref).toBeTruthy()
  })
})

describe('deriveWardActivity', () => {
  it('groups apps and violations by ward', () => {
    const permits = [
      permit({ suburb_ward: 'Ward 4 — Lalapanzi' }),
      permit({ suburb_ward: 'Ward 4 — Lalapanzi' }),
      permit({ suburb_ward: '5' }),
    ]
    const enforcement = [order({ suburb_ward: 'Ward 5 — Zhombe North' })]
    const rows = deriveWardActivity(permits, enforcement)
    const w4 = rows.find(r => r.key === 'w4')
    const w5 = rows.find(r => r.key === 'w5')
    expect(w4?.apps).toBe(2)
    expect(w5?.apps).toBe(1)
    expect(w5?.violations).toBe(1)
  })
})

describe('deriveStaffWorkload', () => {
  it('counts live cases onto role desks', () => {
    const rows = deriveStaffWorkload(
      [permit({ status: 'registered' }), permit({ status: 'approved' }), permit({ status: 'circulation' })],
      [order({ status: 'active' })],
    )
    const byName = Object.fromEntries(rows.map(r => [r.name, r.tasks]))
    expect(byName['Town Planning']).toBeGreaterThan(0)
    expect(byName['Building Inspector']).toBe(1)
    expect(byName['Environment']).toBe(1)
    expect(byName['GIS Officer']).toBe(1)
  })
})

describe('deriveViolations', () => {
  it('maps enforcement orders to severity + resolved + coordinates', () => {
    const rows = deriveViolations([
      order({ status: 'appealed' }),
      order({ order_type: 'rectification', status: 'complied' }),
    ])
    expect(rows[0].severity).toBe('critical')
    expect(rows[0].resolved).toBe(false)
    expect(rows[0].lng).toBe(29.8)
    expect(rows[1].severity).toBe('medium')
    expect(rows[1].resolved).toBe(true)
  })
})
