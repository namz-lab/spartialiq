import { describe, it, expect } from 'vitest'
import type { Consultation, EnforcementOrder } from '@/services/developmentManagementService'
import type { AnyPlan } from '@/statutory/types/plans'
import type { PlanningProject } from '@/planning/planning-types'
import { complianceDue, needsComplianceReview, orderForComplaint, breachFor, orderKind, isOrderOpen } from '../enforcementRules'
import { caseDeadlines, delegationCheck, noticeRequirement } from '../caseClock'
import { referralState, isSiteInspection, SITE_INSPECTION_TASK, SITE_INSPECTION_BODY } from '../referralRules'
import { planGate, STUDY_TOPICS, isStale } from '../forwardPlanning'
import { landBudget, standSchedule } from '../layoutBudget'
import { refusalLetter, orderDraft, renderDraftPdf } from '../plannerDocuments'
import { matchesReferralDepartment } from '@/composables/useApplicationPipeline'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe('enforcement rules', () => {
  const served = { status: 'served', served_at: daysAgo(70), compliance_period: 30, compliance_due_at: null } as Pick<EnforcementOrder, 'status' | 'served_at' | 'compliance_period' | 'compliance_due_at'>

  it('dates compliance from the order taking effect one month after service', () => {
    expect(complianceDue(served)!.toISOString().slice(0, 10)).toBe(daysAgo(10).slice(0, 10))
  })
  it('asks for review only once a served order is past its compliance date', () => {
    expect(needsComplianceReview(served, NOW)).toBe(true)
    expect(needsComplianceReview({ ...served, served_at: daysAgo(20) }, NOW)).toBe(false)
    expect(needsComplianceReview({ ...served, status: 'complied' }, NOW)).toBe(false)
  })
  it('links a route back to its contravention by reference', () => {
    const orders = [{ breach_description: breachFor('BC-2026-0007', 'Room built over the building line') }]
    expect(orderForComplaint('BC-2026-0007', orders)).toBe(orders[0])
    expect(orderForComplaint('BC-2026-0070', orders)).toBeNull()
  })
  it('treats server statuses correctly (no legacy active/extended)', () => {
    expect(isOrderOpen({ status: 'draft' })).toBe(true)
    expect(isOrderOpen({ status: 'complied' })).toBe(false)
    expect(orderKind('reinstatement')).toBe('s35')
    expect(orderKind('enforcement_notice')).toBe('enforcement')
  })
})

describe('case clock', () => {
  it('orders deadlines and marks the acknowledgement overdue', () => {
    const rows = caseDeadlines({ receivedAt: daysAgo(20), acknowledgedAt: null }, NOW)
    expect(rows.find(r => r.key === 'ack')?.state).toBe('overdue')
    expect(rows.find(r => r.key === 'determination')?.state).toBe('not_started')
  })
  it('runs determination three months from acknowledgement and opens the appeal window on decision', () => {
    const rows = caseDeadlines({ receivedAt: daysAgo(100), acknowledgedAt: daysAgo(95), decidedAt: daysAgo(2) }, NOW)
    expect(rows.find(r => r.key === 'determination')?.state).toBe('done')
    expect(rows.find(r => r.key === 'appeal')?.state).toBe('upcoming')
  })
  it('requires notice for change of use but not a routine building', () => {
    expect(noticeRequirement('change_of_use').required).toBe(true)
    expect(noticeRequirement('new_building').required).toBe(false)
    expect(noticeRequirement('new_building', 'special_consent_26_3').required).toBe(true)
  })
  it('sends refusals, objections and subdivisions to committee', () => {
    expect(delegationCheck({ devType: 'new_building', objectionCount: 0 }).committee).toBe(false)
    expect(delegationCheck({ devType: 'new_building', objectionCount: 1 }).committee).toBe(true)
    expect(delegationCheck({ devType: 'subdivision', objectionCount: 0 }).committee).toBe(true)
    expect(delegationCheck({ devType: 'extension', recommendation: 'refuse', objectionCount: 0 }).committee).toBe(true)
  })
})

describe('referrals', () => {
  const c = (o: Partial<Consultation>) => ({ id: 'c', response_status: 'pending', ...o }) as Consultation
  it('flags a pending reply past its due date as overdue', () => {
    expect(referralState(c({ response_due_at: daysAgo(1) }), NOW)).toBe('overdue')
    expect(referralState(c({ response_status: 'no_objection', response_due_at: daysAgo(1) }), NOW)).toBe('responded')
  })
  it('routes site-inspection requests to the DCO inbox', () => {
    expect(isSiteInspection(c({ task_type: SITE_INSPECTION_TASK }))).toBe(true)
    expect(matchesReferralDepartment({ body_name: SITE_INSPECTION_BODY }, ['inspector', 'building control'])).toBe(true)
  })
})

describe('forward planning gate', () => {
  const plan = (o: Partial<AnyPlan>) => ({
    id: 'p', kind: 'master', name: 'Master plan', authorityId: 'lpa', status: 'draft',
    writtenStatement: { sections: [] }, maps: [], objections: [], consultationLog: [], audit: [],
    scenicAreas: [], priorityAreas: [], neighbourRelations: [], ...o,
  }) as AnyPlan

  it('blocks exhibition until study, statement, consultation and a month-long exhibition exist', () => {
    expect(planGate(plan({})).missing.length).toBe(4)
    const ready = plan({
      study: STUDY_TOPICS.map(topic => ({ topic, findings: 'x', reviewedAt: NOW.toISOString() })),
      writtenStatement: { sections: [{ heading: 'Vision', body: 'Text' }] },
      consultations: [{ id: 'c', date: '2026-09-01', stakeholder: 'Ward 7', method: 'Meeting', summary: 'x' }],
      exhibition: { from: '2026-10-01', to: '2026-10-31', place: 'Council offices' },
    })
    expect(planGate(ready).missing).toEqual([])
    expect(planGate(ready).next).toBe('exhibition')
  })
  it('needs a response to each objection and the report before submission', () => {
    const g = planGate(plan({ status: 'objections', objections: [{ id: 'o', objector: 'A', text: 'x', status: 'open' }] }))
    expect(g.missing).toHaveLength(2)
  })
  it('never offers approval to the planner', () => {
    expect(planGate(plan({ status: 'submitted' })).next).toBeNull()
  })
  it('marks an unreviewed study topic stale', () => {
    expect(isStale({ topic: 't', findings: 'x', reviewedAt: daysAgo(400) }, NOW)).toBe(true)
    expect(isStale({ topic: 't', findings: 'x', reviewedAt: daysAgo(10) }, NOW)).toBe(false)
  })
})

describe('land budget', () => {
  const lot = (useType: string, areaSqm: number) => ({ useType, areaSqm }) as PlanningProject['lots'][number]
  const project = {
    planningArea: { areaSqm: 10_000 } as PlanningProject['planningArea'],
    lots: [lot('single_residential', 3000), lot('single_residential', 3000), lot('school', 800), lot('commercial', 400)],
    openSpace: [{ id: 'o', kind: 'park', areaSqm: 700, geom: null as never }],
    roads: [{ id: 'r', type: 'street', hierarchy: 'local', widthM: 10,
      geom: { type: 'LineString', coordinates: [[29.8, -19.45], [29.8, -19.4518]] } }],
  } as unknown as PlanningProject

  it('splits the area into categories that sum to the whole', () => {
    const rows = landBudget(project)
    expect(rows.reduce((s, r) => s + r.areaSqm, 0)).toBeGreaterThanOrEqual(9_999)
    expect(rows.find(r => r.category === 'residential')?.pct).toBe(60)
    expect(rows.find(r => r.category === 'residential')?.verdict).toBe('within')
    expect(rows.find(r => r.category === 'roads')!.areaSqm).toBeGreaterThan(1900)
  })
  it('schedules stands by use', () => {
    const s = standSchedule(project.lots)
    expect(s[0]).toMatchObject({ use: 'single residential', count: 2, avgSqm: 3000 })
  })
})

describe('draft documents', () => {
  const kase = { reference: 'VR-2026-0012', applicant: 'T. Ncube', standNo: '441', proposal: 'Change of use to a guest house' }
  it('numbers refusal reasons and states the s.38 right of appeal', () => {
    const d = refusalLetter(kase, ['Conflicts with zoning', 'No safe access'], 'Planner')
    expect(d.blocks.find(b => b.numbered)?.text).toEqual(['Conflicts with zoning', 'No safe access'])
    expect(JSON.stringify(d.blocks)).toContain('section 38')
  })
  it('renders a draft marked for signature', () => {
    const doc = renderDraftPdf(orderDraft('s35', { reference: 'EO/1', subject: 'A', address: 'B', standNo: '1',
      contravention: 'x', requiredAction: 'y', compliancePeriodDays: 30 }, 'Planner'), false)
    // @ts-expect-error - internal page buffer, the only way to read text back
    const text = doc.internal.pages.flat().join(' ')
    expect(text).toContain('DRAFT')
    expect(text).toContain('SECTION 35')
  })
})
