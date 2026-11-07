import { describe, it, expect } from 'vitest'
import {
  buildPipeline, normalizeStatus, statusLabel, nextStatuses, STAGE_DEFS,
  isPermitApproved, isPermitInCirculation, matchesReferralDepartment,
} from '@/composables/useApplicationPipeline'
import type { PermitApplication, Consultation } from '@/services/developmentManagementService'

function permit(status: string, extra: Partial<PermitApplication> = {}): PermitApplication {
  return { id: 'p1', status, ...extra } as unknown as PermitApplication
}

describe('useApplicationPipeline — canonical status model', () => {
  it('normalises legacy frontend statuses to backend values', () => {
    expect(normalizeStatus('conditionally_approved')).toBe('approved_with_conditions')
    expect(normalizeStatus('consultation')).toBe('circulation')
    expect(normalizeStatus('appeal')).toBe('appealed')
    expect(normalizeStatus(null)).toBe('registered')
  })

  it('labels statuses for display', () => {
    expect(statusLabel('approved_with_conditions')).toBe('Approved with conditions')
    expect(statusLabel('circulation')).toBe('In circulation')
  })

  it('treats conditional approval as an approved permit', () => {
    expect(isPermitApproved('approved')).toBe(true)
    expect(isPermitApproved('approved_with_conditions')).toBe(true)
    expect(isPermitApproved('conditionally_approved')).toBe(true)
    expect(isPermitApproved('circulation')).toBe(false)
    expect(isPermitApproved('refused')).toBe(false)
  })

  it('treats legacy consultation as technical circulation', () => {
    expect(isPermitInCirculation('circulation')).toBe(true)
    expect(isPermitInCirculation('consultation')).toBe(true)
    expect(isPermitInCirculation('under_review')).toBe(true)
    expect(isPermitInCirculation('registered')).toBe(false)
    expect(isPermitInCirculation('approved')).toBe(false)
  })

  it('matches specialist referrals on free-text body names', () => {
    expect(matchesReferralDepartment({ department: 'gis' }, ['gis'])).toBe(true)
    expect(matchesReferralDepartment({ body_name: 'GIS Officer' }, ['gis'])).toBe(true)
    expect(matchesReferralDepartment({ body_name: 'Building Inspector' }, ['inspector'])).toBe(true)
    expect(matchesReferralDepartment({ body_name: 'Environmental Health' }, ['environmental'])).toBe(true)
    expect(matchesReferralDepartment({ department: 'fire' }, ['gis'])).toBe(false)
  })

  it('exposes only backend-valid forward transitions', () => {
    expect(nextStatuses('under_review')).toContain('approved_with_conditions')
    expect(nextStatuses('under_review')).toContain('refused')
    // 'conditionally_approved' is a legacy alias and must never be a target.
    expect(nextStatuses('under_review')).not.toContain('conditionally_approved')
    expect(nextStatuses('withdrawn')).toHaveLength(0)
  })
})

describe('useApplicationPipeline — buildPipeline', () => {
  it('returns a 7-stage pending skeleton with no permit', () => {
    const stages = buildPipeline(null)
    expect(stages).toHaveLength(STAGE_DEFS.length)
    expect(stages.every(s => s.status === 'pending')).toBe(true)
  })

  it('marks earlier stages done, current active, later pending', () => {
    const stages = buildPipeline(permit('under_review'))
    const byKey = Object.fromEntries(stages.map(s => [s.key, s.status]))
    expect(byKey.submitted).toBe('done')
    expect(byKey.intake).toBe('done')
    expect(byKey.assessment).toBe('active')
    expect(byKey.decision).toBe('pending')
    expect(byKey.outcome).toBe('pending')
  })

  it('marks the whole pipeline done on a terminal status and surfaces the outcome', () => {
    const stages = buildPipeline(permit('approved_with_conditions'))
    expect(stages.every(s => s.status === 'done')).toBe(true)
    expect(stages.find(s => s.key === 'outcome')!.evidence).toBe('Approved with conditions')
  })

  it('summarises referral responses on the circulation stage', () => {
    const consultations = [
      { id: 'c1', response_status: 'no_objection' },
      { id: 'c2', response_status: 'pending' },
    ] as unknown as Consultation[]
    const stages = buildPipeline(permit('circulation'), { consultations })
    expect(stages.find(s => s.key === 'circulation')!.evidence).toBe('1/2 referrals responded')
  })

  it('shows the recommendation on the assessment stage when set', () => {
    const stages = buildPipeline(permit('under_review', { recommendation: 'approve' } as any))
    expect(stages.find(s => s.key === 'assessment')!.evidence).toBe('Recommendation: approve')
  })
})
