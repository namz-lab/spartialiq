// @vitest-environment happy-dom
//
// Regression tests for migration 082 wiring: the planner case file must be the
// shared backend system-of-record, not browser localStorage. These would have
// FAILED before the fix (referrals never hydrated; the case never PATCHed).
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/developmentManagementService', () => ({
  dmApi: {
    getPermit: vi.fn(),
    listConsultations: vi.fn(),
    updateCase: vi.fn(),
    createPermit: vi.fn(),
  },
}))

import { providePlannerCase, type PlannerCaseContext } from '@/composables/usePlannerCase'
import { dmApi } from '@/services/developmentManagementService'

function withCase(): PlannerCaseContext {
  let ctx!: PlannerCaseContext
  const Comp = defineComponent({ setup() { ctx = providePlannerCase(); return () => null } })
  mount(Comp)
  return ctx
}

const PERMIT_ID = '11111111-1111-1111-1111-111111111111'
const serverPermit = {
  id: PERMIT_ID,
  dev_register_no: 'DEV/2026/001',
  stand_number: '1234', suburb_ward: 'Ward 5',
  applicant_name: 'A. Citizen', applicant_id_number: '63-1234567-A-00',
  applicant_phone: null, applicant_email: null,
  development_type: 'new_building', description: 'Dwelling', status: 'registered', fee_paid: true,
  received_at: '2026-06-01', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-08T00:00:00Z',
  // migration 082 case fields:
  estimated_cost: 50000, plinth_area: 120, floors: 2, parking_bays: 2,
  permit_conditions: [{ id: 'c1', text: 'Front setback of 6 m to be maintained.' }],
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('usePlannerCase backend persistence (migration 082)', () => {
  it('hydrates referral outcomes from server consultations (closes the loop)', async () => {
    ;(dmApi.getPermit as any).mockResolvedValue(serverPermit)
    ;(dmApi.listConsultations as any).mockResolvedValue([
      { body_name: 'ZINWA', response_status: 'no_objection', response_notes: 'No objection',
        created_at: '2026-06-02T00:00:00Z', circulated_at: '2026-06-02' },
    ])
    const ctx = withCase()
    await ctx.loadFromPermit(PERMIT_ID)

    const refs = ctx.current.value!.dueDiligence.referrals
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      department: 'ZINWA', outcome: 'no_objection', response: 'No objection',
    })
  })

  it('loads server-stored proposal detail and conditions instead of zeros', async () => {
    ;(dmApi.getPermit as any).mockResolvedValue(serverPermit)
    ;(dmApi.listConsultations as any).mockResolvedValue([])
    const ctx = withCase()
    await ctx.loadFromPermit(PERMIT_ID)

    const c = ctx.current.value!
    expect(c.proposal.estimatedCost).toBe(50000)
    expect(c.proposal.floors).toBe(2)
    expect(c.permit.conditions).toHaveLength(1)
  })

  it('save() persists the case file to the backend, not just localStorage', async () => {
    vi.useFakeTimers()
    ;(dmApi.getPermit as any).mockResolvedValue(serverPermit)
    ;(dmApi.listConsultations as any).mockResolvedValue([])
    ;(dmApi.updateCase as any).mockResolvedValue(serverPermit)
    const ctx = withCase()
    await ctx.loadFromPermit(PERMIT_ID)

    ctx.current.value!.committeeReport.recommendation = 'approve'
    ctx.save()
    await vi.runAllTimersAsync()

    expect(dmApi.updateCase).toHaveBeenCalledWith(
      PERMIT_ID,
      expect.objectContaining({
        recommendation: 'approve',
        permit_conditions: expect.any(Array),
      }),
    )
    vi.useRealTimers()
  })
})
