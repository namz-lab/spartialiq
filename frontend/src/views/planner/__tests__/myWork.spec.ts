import { describe, it, expect } from 'vitest'
import { buildMyWork, CLOSED_PERMIT_STATUSES, scopePermits, scopeCounts } from '@/views/planner/myWork'
import type { PermitApplication, EnforcementOrder } from '@/services/developmentManagementService'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString()
}

function permit(over: Partial<PermitApplication> = {}): PermitApplication {
  return {
    id: 'p-1',
    tpd_reference: 'TP/2026/0145',
    dev_register_no: 'TP/2026/0145',
    stand_number: '1234',
    suburb_ward: 'Ward 3',
    applicant_name: 'XYZ Developments',
    applicant_id_number: '12-345678-A-90',
    applicant_phone: null,
    applicant_email: null,
    development_type: 'change_of_use',
    description: 'Proposed restaurant',
    status: 'under_review',
    fee_paid: true,
    received_at: isoDaysAgo(10),
    created_by: null,
    created_at: isoDaysAgo(12),
    updated_at: isoDaysAgo(1),
    ...over,
  }
}

function order(over: Partial<EnforcementOrder> = {}): EnforcementOrder {
  return {
    id: 'e-1',
    order_reference: 'ENF/2026/01',
    permit_application_id: 'p-1',
    stand_number: '1234',
    suburb_ward: 'Ward 3',
    owner_name: 'XYZ Developments',
    owner_contact: null,
    order_type: 'stop_work',
    breach_description: 'Works without permit',
    required_action: 'Stop works',
    compliance_period: 14,
    issued_at: isoDaysAgo(3),
    status: 'served',
    served_at: isoDaysAgo(60),
    notes: null,
    latitude: null,
    longitude: null,
    created_at: isoDaysAgo(3),
    updated_at: isoDaysAgo(3),
    ...over,
  }
}

describe('buildMyWork', () => {
  it('puts overdue live applications in urgent', () => {
    const queues = buildMyWork({
      permits: [permit({ id: 'overdue', received_at: isoDaysAgo(95) })],
      enforcement: [],
    })
    expect(queues.urgent.some(i => i.id === 'overdue' && i.severity === 'critical')).toBe(true)
    expect(queues.urgent[0].action).toEqual({ type: 'case', permitId: 'overdue' })
  })

  it('excludes closed applications from urgent even if the clock has run out', () => {
    const queues = buildMyWork({
      permits: CLOSED_PERMIT_STATUSES.map((status, i) =>
        permit({ id: `c-${i}`, status, received_at: isoDaysAgo(95) })),
      enforcement: [],
    })
    expect(queues.urgent).toEqual([])
  })

  it('buckets applications by workflow stage', () => {
    const queues = buildMyWork({
      permits: [
        permit({ id: 'new', status: 'registered' }),
        permit({ id: 'assess', status: 'under_review' }),
        permit({ id: 'docs', status: 'pending_docs' }),
        permit({ id: 'circ', status: 'circulation' }),
        permit({ id: 'legacy-circ', status: 'consultation' }),
        permit({ id: 'obj', status: 'objection_period' }),
        permit({ id: 'eo', status: 'awaiting_eo_decision' }),
        permit({ id: 'unpaid', fee_paid: false, status: 'registered' }),
      ],
      enforcement: [],
    })
    expect(queues.applications.newlyAssigned.map(i => i.id)).toEqual(expect.arrayContaining(['new', 'docs', 'unpaid']))
    expect(queues.applications.inAssessment.map(i => i.id)).toContain('assess')
    expect(queues.applications.awaitingInformation.map(i => i.id)).toContain('unpaid')
    expect(queues.applications.awaitingInformation.map(i => i.id)).not.toContain('docs')
    expect(queues.applications.awaitingReferrals.map(i => i.id)).toEqual(expect.arrayContaining(['circ', 'legacy-circ']))
    expect(queues.applications.awaitingObjections.map(i => i.id)).toContain('obj')
    expect(queues.applications.awaitingDecision.map(i => i.id)).toContain('eo')
  })

  it('lists served orders past their compliance date as clickable section items', () => {
    const queues = buildMyWork({
      permits: [],
      enforcement: [order(), order({ id: 'e-2', status: 'complied' })],
    })
    expect(queues.enforcement).toHaveLength(1)
    expect(queues.enforcement[0].action).toEqual({ type: 'section', section: 'enforcement' })
  })

  it('flags an unacknowledged file past the 14-day window (s.26(2))', () => {
    const queues = buildMyWork({
      permits: [permit({ id: 'late', status: 'registered', received_at: isoDaysAgo(20) })],
      enforcement: [],
    })
    expect(queues.urgent.find(i => i.id === 'late')?.reason).toBe('Acknowledgement overdue (s.26(2))')
  })

  it('surfaces an open appeal as urgent work on the appeals section', () => {
    const queues = buildMyWork({
      permits: [],
      enforcement: [],
      appeals: [{ id: 'a1', status: 'lodged', appellant_name: 'J. Moyo', permit_application_id: 'p-1', dev_register_no: 'TP/1' } as never],
    })
    expect(queues.urgent[0].action).toEqual({ type: 'section', section: 'appeals' })
  })

  it('flags unpaid fees as alerts, not legacy pending_docs', () => {
    const queues = buildMyWork({
      permits: [
        permit({ id: 'unpaid', fee_paid: false, status: 'registered' }),
        permit({ id: 'docs', status: 'pending_docs', fee_paid: true }),
      ],
      enforcement: [],
    })
    const ids = queues.alerts.map(i => i.id)
    expect(ids).toContain('unpaid')
    expect(ids).not.toContain('docs')
  })
})

describe('My Work scope', () => {
  const me = 'u-me'
  const permits = [
    permit({ id: 'a', assigned_to: me }),
    permit({ id: 'b', assigned_to: 'u-other' }),
    permit({ id: 'c', assigned_to: null }),
    permit({ id: 'd', assigned_to: me, status: 'approved' }),
  ]

  it('mine shows only files assigned to the signed-in officer', () => {
    expect(scopePermits(permits, 'mine', me).map(p => p.id)).toEqual(['a', 'd'])
    expect(scopePermits(permits, 'mine', null)).toEqual([])
  })

  it('unassigned shows files nobody holds; office shows all', () => {
    expect(scopePermits(permits, 'unassigned', me).map(p => p.id)).toEqual(['c'])
    expect(scopePermits(permits, 'office', me)).toHaveLength(4)
  })

  it('counts only live applications', () => {
    expect(scopeCounts(permits, me)).toEqual({ mine: 1, unassigned: 1, office: 3 })
  })
})
