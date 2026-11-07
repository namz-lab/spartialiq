import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  ANNEXURE_STAGES,
  BOOKING_STATUSES,
  DEAD_BI_API_PREFIX,
  OFFICIAL_INSPECTION_IDENTITY,
  OFFICIAL_INSPECTION_RESULTS,
  OFFICIAL_ENFORCEMENT_STATUSES,
  SHORT_WORKFLOW_STAGES,
  inspectorMayIssueEnforcementOrder,
  isOfficialInspectionResult,
  isSchedulingStatus,
  isSyntheticChecklistItemId,
  matchSiteByStand,
  nextAnnexureStageNumber,
  normalizeEnforcementStatus,
  occupationIssueFailed,
  officialEnforcementOpen,
  parseOccupationIssueFailure,
  permitToInspectorSite,
} from '../architecture'
import {
  issueOccupationCertificateOfficial,
  referInspectorEnforcement,
} from '../officialActions'
import * as apiBarrel from '@/services/api'
import type { PermitApplication } from '@/services/developmentManagementService'

describe('Option A — official inspection identity', () => {
  it('names stage_inspection as the official municipal inspection record', () => {
    expect(OFFICIAL_INSPECTION_IDENTITY).toBe('spatial_planning.stage_inspection')
  })

  it('uses the nine Annexure 12 stages, not the four-stage Pinia workflow', () => {
    expect(ANNEXURE_STAGES.map(s => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(ANNEXURE_STAGES[0].name).toMatch(/setting out/i)
    expect(ANNEXURE_STAGES[8].name).toMatch(/occupation/i)
    for (const short of SHORT_WORKFLOW_STAGES) {
      expect(ANNEXURE_STAGES.some(s => s.name === short)).toBe(false)
      expect(isOfficialInspectionResult(short)).toBe(false)
    }
  })

  it('keeps booking statuses as scheduling, not official results', () => {
    expect(BOOKING_STATUSES).toContain('waitlisted')
    expect(BOOKING_STATUSES).toContain('scheduled')
    expect(isSchedulingStatus('scheduled')).toBe(true)
    expect(isOfficialInspectionResult('passed')).toBe(false)
    expect(isOfficialInspectionResult('failed')).toBe(false)
  })

  it('uses the DM result vocabulary for official outcomes', () => {
    expect([...OFFICIAL_INSPECTION_RESULTS].sort()).toEqual(
      ['conditional_pass', 'fail', 'pass', 'reinspection_required'].sort(),
    )
  })
})

describe('enforcement vocabulary', () => {
  it('uses the database CHECK values, not active/extended/cancelled', () => {
    expect([...OFFICIAL_ENFORCEMENT_STATUSES].sort()).toEqual(
      ['appealed', 'complied', 'draft', 'issued', 'non_complied', 'served', 'withdrawn'].sort(),
    )
    expect(normalizeEnforcementStatus('active')).toBe('issued')
    expect(normalizeEnforcementStatus('extended')).toBe('issued')
    expect(normalizeEnforcementStatus('cancelled')).toBe('withdrawn')
    expect(normalizeEnforcementStatus('served')).toBe('served')
    expect(officialEnforcementOpen('issued')).toBe(true)
    expect(officialEnforcementOpen('complied')).toBe(false)
  })

  it('does not authorise the building inspector to issue an enforcement order', () => {
    expect(inspectorMayIssueEnforcementOrder()).toBe(false)
  })
})

describe('checklist identity', () => {
  it('rejects synthetic stage*100+index checklist ids', () => {
    expect(isSyntheticChecklistItemId(201)).toBe(true)
    expect(isSyntheticChecklistItemId(801)).toBe(true)
    expect(isSyntheticChecklistItemId(3)).toBe(false)
    expect(isSyntheticChecklistItemId(38)).toBe(false)
  })
})

describe('permit → map site', () => {
  it('maps a permit onto an inspector site without inventing workflow statuses', () => {
    const permit = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      tpd_reference: 'TPD/2026/1',
      dev_register_no: 'DEV/2026/0001',
      stand_number: '1824',
      suburb_ward: 'Ward 4',
      applicant_name: 'A. Moyo',
      development_type: 'new_building',
      description: 'Dwelling',
      status: 'approved',
      has_occupation_certificate: false,
      lat: -19.45,
      lng: 29.82,
    } as PermitApplication
    const site = permitToInspectorSite(permit)
    expect(site.permitId).toBe(permit.id)
    expect(site.stand).toBe('1824')
    expect(site.lat).toBe(-19.45)
    expect(site.permitStatus).toBe('approved')
    expect(site.workflowStatus).toBeUndefined()
  })
})

describe('dead /api/bi client', () => {
  it('is not exported from the API barrel', () => {
    expect(DEAD_BI_API_PREFIX).toBe('/bi')
    expect(Object.prototype.hasOwnProperty.call(apiBarrel, 'buildingInspectorApi')).toBe(false)
  })
})

describe('official inspector actions — fail closed', () => {
  const permitId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates an EO consultation and never posts to /bi/enforcement', async () => {
    const createConsultation = vi.fn().mockResolvedValue({ id: 'c1', task_type: 'eo_review' })
    const result = await referInspectorEnforcement({
      permitId,
      reason: 'Work exceeds the approved footprint on the eastern boundary.',
      stand: '1824',
      createConsultation,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.consultationId).toBe('c1')
    expect(createConsultation).toHaveBeenCalledWith(
      permitId,
      expect.objectContaining({ task_type: 'eo_review', blocking: true }),
    )
  })

  it('does not claim a referral exists when the consultation API fails', async () => {
    const createConsultation = vi.fn().mockRejectedValue(new Error('network'))
    const result = await referInspectorEnforcement({
      permitId,
      reason: 'Work exceeds the approved footprint on the eastern boundary.',
      createConsultation,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  it('does not mark occupation issued when the server returns stages_not_passed', async () => {
    const err = {
      response: {
        status: 409,
        data: { error: 'stages_not_passed', message: 'Stages 3, 4 have not passed.' },
      },
    }
    expect(occupationIssueFailed(err)).toBe(true)
    expect(parseOccupationIssueFailure(err).missingStages).toEqual([3, 4])

    const issueCertificate = vi.fn().mockRejectedValue(err)
    const result = await issueOccupationCertificateOfficial({
      permitId,
      certificateNo: 'OC/HRE/2026/1',
      issueCertificate,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issued).toBe(false)
      expect(result.missingStages).toEqual([3, 4])
    }
  })
})

describe('Annexure stage progression', () => {
  it('starts at setting-out and stays on a failed stage', () => {
    expect(nextAnnexureStageNumber([])).toBe(1)
    expect(nextAnnexureStageNumber([{ stage_number: 1, result: 'pass', attempt: 1 }])).toBe(2)
    expect(nextAnnexureStageNumber([
      { stage_number: 1, result: 'pass', attempt: 1 },
      { stage_number: 2, result: 'fail', attempt: 1 },
    ])).toBe(2)
  })

  it('matches the backend Annexure 12 catalogue names', () => {
    expect(ANNEXURE_STAGES.map(s => s.name)).toEqual([
      'Setting out',
      'Foundation trenches and footing levels',
      'Foundation brickwork to floor level',
      'Brickwork and window level',
      'Brickwork to wall plate',
      'Roof trusses',
      'Drainage / sewerage work',
      'Final inspection',
      'Certificate of occupation',
    ])
  })
})

describe('inspector modules must not keep competing official records', () => {
  const srcRoot = join(__dirname, '../..')
  const forbidden = [
    'usePlanningWorkflowStore',
    'buildingInspectorApi',
    '/api/bi',
    '/bi/applications',
    '/bi/enforcement',
  ]

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '__tests__') continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, acc)
      else if (/\.(ts|vue|js)$/.test(name)) acc.push(full)
    }
    return acc
  }

  it('does not import planningWorkflow or the dead /bi client from inspector code', () => {
    const files = [
      ...walk(join(srcRoot, 'inspector')),
      ...walk(join(srcRoot, 'views/inspector')),
      join(srcRoot, 'views/BuildingInspectorView.vue'),
      join(srcRoot, 'views/InspectorWorkspace.vue'),
      join(srcRoot, 'views/InspectorWorkspaceView.vue'),
      join(srcRoot, 'composables/useInspectionCase.ts'),
      join(srcRoot, 'composables/useInspectorQueue.ts'),
      join(srcRoot, 'composables/useInspectorSites.ts'),
    ]
    const hits: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const token of forbidden) {
        if (src.includes(token)) hits.push(`${relative(srcRoot, file)}: ${token}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('leaves planningWorkflow without inspector consumers', () => {
    const files = walk(srcRoot).filter(f => !f.endsWith('planningWorkflow.ts'))
    const consumers = files.filter(f => readFileSync(f, 'utf8').includes('usePlanningWorkflowStore'))
    expect(consumers.map(f => relative(srcRoot, f))).toEqual([])
  })
})

describe('map parcel -> case resolution', () => {
  const sites = [
    { stand: '1824', permitId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { stand: 'Somabula', permitId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
  ]

  it('resolves a clicked stand number to its inspection case', () => {
    expect(matchSiteByStand(sites, '1824')?.permitId).toBe(sites[0].permitId)
  })

  it('tolerates the whitespace and casing drift between the two registers', () => {
    expect(matchSiteByStand(sites, ' somabula ')?.permitId).toBe(sites[1].permitId)
  })

  it('returns null for a stand with no case rather than the wrong case', () => {
    expect(matchSiteByStand(sites, '9999')).toBeNull()
  })

  it('returns null for an unlabelled parcel instead of guessing the first site', () => {
    expect(matchSiteByStand(sites, '')).toBeNull()
    expect(matchSiteByStand(sites, null)).toBeNull()
    expect(matchSiteByStand(sites, undefined)).toBeNull()
  })
})
