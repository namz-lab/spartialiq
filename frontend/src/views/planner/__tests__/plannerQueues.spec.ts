import { describe, it, expect } from 'vitest'
import { PLANNER_TOOL_SECTIONS } from '@/composables/usePlannerShell'
import { filterPermitsForQueue } from '@/views/planner/plannerQueues'
import type { PermitApplication } from '@/services/developmentManagementService'

function permit(over: Partial<PermitApplication> = {}): PermitApplication {
  return {
    id: 'p-1',
    tpd_reference: null,
    dev_register_no: 'TP/2026/0001',
    stand_number: '100',
    suburb_ward: 'Ward 1',
    applicant_name: 'A',
    applicant_id_number: 'x',
    applicant_phone: null,
    applicant_email: null,
    development_type: 'new_building',
    description: 'House',
    status: 'registered',
    fee_paid: true,
    received_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('planner tool sections', () => {
  it('exposes every planner duty in the console, not only the original seven', () => {
    expect(PLANNER_TOOL_SECTIONS).toEqual([
      'dashboard', 'workflow', 'register', 'property', 'referrals',
      'participation', 'inspections', 'committee', 'appeals',
      'enforcement', 'plans', 'forward', 'layouts', 'matrix', 'reports', 'reference',
    ])
  })
})

describe('filterPermitsForQueue', () => {
  it('treats legacy consultation as circulation', () => {
    const rows = filterPermitsForQueue([
      permit({ id: 'a', status: 'circulation' }),
      permit({ id: 'b', status: 'under_review' }),
      permit({ id: 'c', status: 'consultation' }),
    ], ['circulation'])
    expect(rows.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('treats legacy conditionally_approved as approved_with_conditions', () => {
    const rows = filterPermitsForQueue([
      permit({ id: 'a', status: 'approved' }),
      permit({ id: 'b', status: 'conditionally_approved' }),
      permit({ id: 'c', status: 'registered' }),
    ], ['approved', 'approved_with_conditions'])
    expect(rows.map(p => p.id)).toEqual(['a', 'b'])
  })
})
