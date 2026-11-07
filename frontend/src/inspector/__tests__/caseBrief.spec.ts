/**
 * The case brief must answer the eight questions from real record state — and
 * must not claim progress, approval or clearance that the records do not show.
 */
import { describe, it, expect } from 'vitest'
import {
  buildCaseBrief, governingPlan, openBlockingConsultations,
  type CaseStageMirror,
} from '../caseBrief'
import type {
  PermitApplication, BuildingPlan, Consultation, OccupationCertificate,
} from '@/services/developmentManagementService'

const PERMIT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function permit(over: Partial<PermitApplication> = {}): PermitApplication {
  return {
    id: PERMIT_ID,
    tpd_reference: 'TPD/VUN/2026/0001',
    dev_register_no: 'DR-2026-014',
    stand_number: '1824',
    suburb_ward: '18',
    street_address: '14 Chirundu Road',
    applicant_name: 'A. Moyo',
    applicant_id_number: '63-000000A00',
    applicant_phone: null,
    applicant_email: null,
    development_type: 'new_building',
    description: 'Three-bedroom dwelling',
    status: 'approved',
    fee_paid: true,
    received_at: '2026-01-10T08:00:00.000Z',
    created_by: null,
    created_at: '2026-01-10T08:00:00.000Z',
    updated_at: '2026-01-10T08:00:00.000Z',
    lat: -19.45, lng: 29.82,
    ...over,
  } as PermitApplication
}

function stages(over: Record<number, Partial<CaseStageMirror>> = {}): Record<number, CaseStageMirror> {
  const out: Record<number, CaseStageMirror> = {}
  for (let n = 1; n <= 9; n++) {
    out[n] = { stageNumber: n, inspectionId: null, verdict: 'pending', inspectedAt: null, ...(over[n] || {}) }
  }
  return out
}

function plan(over: Partial<BuildingPlan> = {}): BuildingPlan {
  return {
    id: 'plan-1', permit_app_id: PERMIT_ID,
    revision: 1, revision_label: 'Rev A',
    plan_document_url: 'plans/rev-a.pdf', architect_name: 'T. Ncube', architect_reg_no: null,
    engineer_name: null, engineer_reg_no: null,
    status: 'approved', appraisal_notes: null, appraised_by: null,
    appraised_at: '2026-02-01',
    created_at: '2026-01-15T08:00:00.000Z', updated_at: '2026-02-01T08:00:00.000Z',
    ...over,
  }
}

describe('caseBrief — no case open', () => {
  it('says plainly that nothing is open instead of showing a blank case', () => {
    const b = buildCaseBrief({ permit: null, stages: null })
    expect(b.what).toBeNull()
    expect(b.now).toBeNull()
    expect(b.blockers.map(x => x.code)).toEqual(['no_permit'])
    expect(b.next).toMatch(/queue/i)
  })
})

describe('caseBrief — WHAT / WHERE', () => {
  it('identifies the case and the site from the permit', () => {
    const b = buildCaseBrief({ permit: permit(), stages: stages(), plans: [plan()] })
    expect(b.what?.reference).toBe('DR-2026-014')
    expect(b.what?.title).toBe('Three-bedroom dwelling')
    expect(b.where?.stand).toBe('1824')
    expect(b.where?.ward).toBe('18')
    expect(b.where?.address).toBe('14 Chirundu Road')
    expect(b.where?.lat).toBe(-19.45)
  })

  it('falls back through the real identifier chain, never inventing one', () => {
    const b = buildCaseBrief({
      permit: permit({ dev_register_no: null, tpd_reference: null }),
      stages: stages(), plans: [plan()],
    })
    expect(b.what?.reference).toBe(PERMIT_ID.slice(0, 8).toUpperCase())
  })
})

describe('caseBrief — WHAT WAS APPROVED', () => {
  it('picks the highest approved revision as the governing plan', () => {
    const plans = [
      plan({ id: 'p1', revision: 1, revision_label: 'Rev A', status: 'resubmitted' }),
      plan({ id: 'p2', revision: 2, revision_label: 'Rev B', status: 'approved' }),
      plan({ id: 'p3', revision: 3, revision_label: 'Rev C', status: 'rejected' }),
    ]
    expect(governingPlan(plans)?.revision_label).toBe('Rev B')
    const b = buildCaseBrief({ permit: permit(), stages: stages(), plans })
    expect(b.approved?.revisionLabel).toBe('Rev B')
  })

  it('treats a plan approved with amendments as approved', () => {
    const plans = [plan({ status: 'approved_with_amendments' })]
    expect(governingPlan(plans)?.id).toBe('plan-1')
  })

  it('blocks the inspection when no plan revision was approved', () => {
    const b = buildCaseBrief({
      permit: permit(), stages: stages(),
      plans: [plan({ status: 'submitted' })],
    })
    expect(b.approved).toBeNull()
    expect(b.blockers.map(x => x.code)).toContain('no_approved_plan')
    expect(b.next).toMatch(/approved plan/i)
  })
})

describe('caseBrief — HISTORY / NOW / NEXT', () => {
  it('reports no recorded inspection honestly on a fresh permit', () => {
    const b = buildCaseBrief({ permit: permit(), stages: stages(), plans: [plan()] })
    expect(b.history).toEqual([])
    expect(b.now?.stageNumber).toBe(1)
    expect(b.why).toMatch(/no stage inspection has been recorded/i)
  })

  it('advances to the next stage and counts conditional passes as advancing', () => {
    const b = buildCaseBrief({
      permit: permit(),
      stages: stages({
        1: { verdict: 'pass', inspectedAt: '2026-03-01T09:00:00.000Z' },
        2: { verdict: 'rework', inspectedAt: '2026-03-08T09:00:00.000Z' }, // conditional_pass
      }),
      plans: [plan()],
    })
    expect(b.now?.stageNumber).toBe(3)
    expect(b.history[0].stageNumber).toBe(2)      // most recent first
    expect(b.why).toMatch(/2 of 8 construction stages/)
  })

  it('surfaces a failed stage as blocking and directs a re-inspection', () => {
    const b = buildCaseBrief({
      permit: permit(),
      stages: stages({
        1: { verdict: 'pass', inspectedAt: '2026-03-01T09:00:00.000Z' },
        2: { verdict: 'fail', inspectedAt: '2026-03-08T09:00:00.000Z' },
      }),
      plans: [plan()],
    })
    const failed = b.blockers.filter(x => x.code === 'stage_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].severity).toBe('blocking')
    expect(b.next).toMatch(/Re-inspect stage 2/)
    expect(b.now?.stageNumber).toBe(2)            // stays on the failed stage
  })

  it('offers the occupation certificate only once all eight stages advanced', () => {
    const all: Record<number, Partial<CaseStageMirror>> = {}
    for (let n = 1; n <= 8; n++) all[n] = { verdict: 'pass', inspectedAt: '2026-04-01T09:00:00.000Z' }
    const b = buildCaseBrief({ permit: permit(), stages: stages(all), plans: [plan()] })
    expect(b.next).toMatch(/occupation certificate can be considered/i)
  })
})

describe('caseBrief — BLOCKERS', () => {
  it('counts only unanswered, unclosed consultations', () => {
    const consultations = [
      { id: 'c1', response_status: 'pending', task_status: 'open' },
      { id: 'c2', response_status: 'no_objection', task_status: 'responded' },
      { id: 'c3', response_status: 'pending', task_status: 'cancelled' },
    ] as unknown as Consultation[]

    expect(openBlockingConsultations(consultations).map(c => c.id)).toEqual(['c1'])

    const b = buildCaseBrief({ permit: permit(), stages: stages(), plans: [plan()], consultations })
    const awaiting = b.blockers.find(x => x.code === 'awaiting_consultation')
    expect(awaiting?.label).toMatch(/^1 referral awaiting/)
    expect(awaiting?.severity).toBe('warning')
  })

  it('closes the case once an occupation certificate exists', () => {
    const certificate = {
      id: 'oc1', permit_application_id: PERMIT_ID, certificate_no: 'OC/2026/007',
      issued_by: null, issued_at: '2026-06-01T08:00:00.000Z', conditions: null,
      created_at: '2026-06-01T08:00:00.000Z',
    } as OccupationCertificate

    const b = buildCaseBrief({ permit: permit(), stages: stages(), plans: [plan()], certificate })
    expect(b.now).toBeNull()
    expect(b.blockers.map(x => x.code)).toContain('occupation_issued')
    expect(b.blockers.find(x => x.code === 'occupation_issued')?.detail).toContain('OC/2026/007')
    expect(b.next).toMatch(/No further action/i)
  })

  it('reports no blockers on a clean, in-progress case', () => {
    const b = buildCaseBrief({
      permit: permit(),
      stages: stages({ 1: { verdict: 'pass', inspectedAt: '2026-03-01T09:00:00.000Z' } }),
      plans: [plan()],
      consultations: [],
    })
    expect(b.blockers).toEqual([])
    expect(b.next).toMatch(/stage 2 checklist/i)
  })
})
