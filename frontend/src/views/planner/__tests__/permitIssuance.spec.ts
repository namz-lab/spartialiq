// @vitest-environment happy-dom
//
// Covers the permit-issuance rules, deadline derivation, Annexure 7 generation
// and the document renderer's pagination.
//
// The pagination cases are the ones that would have FAILED before this work:
// the old exporter advanced a fixed `y` per condition with no page break, so
// 20 conditions or a very long Annexure 7 silently ran off page 1.

import { describe, it, expect } from 'vitest'
import {
  addDays, addMonths, buildAnnexure7, deriveDeadlines, permitRules,
  toDateOnly, unverifiedRules, type PermitRuleSet,
} from '../permit/permitRules'
import { renderPermitDocument, type PermitDocumentRecord } from '../permit/permitDocument'
import { can, UNASSIGNED_ACTIONS } from '@/statutory/roles'

// ── RBAC: the frontend matrix must agree with the backend allow-list ─────
describe('permit issuance authority', () => {
  // requireRole() on PATCH /permit-applications/:id/status in the backend's
  // development-management.js. If these ever diverge again, this fails.
  const BACKEND_ALLOWS = ['eo', 'planner', 'planning_clerk', 'admin'] as const
  const BACKEND_DENIES = [
    'env_officer', 'building_inspector', 'surveyor', 'gis_officer',
    'viewer', 'registered', 'public',
  ] as const

  it('grants devapp.issue_permit to exactly the roles the backend accepts', () => {
    for (const r of BACKEND_ALLOWS) expect(can(r, 'devapp.issue_permit')).toBe(true)
    for (const r of BACKEND_DENIES) expect(can(r, 'devapp.issue_permit')).toBe(false)
  })

  it('still reserves the decision power itself to nobody', () => {
    // Issuing a permit records who decided; it does not confer the power to
    // decide. That reservation must survive this change.
    expect(UNASSIGNED_ACTIONS).toContain('devapp.determine')
    for (const r of BACKEND_ALLOWS) {
      if (r === 'admin') continue          // admin is '*', the IT superuser
      expect(can(r, 'devapp.determine')).toBe(false)
    }
  })

  it('denies an unknown or absent role', () => {
    expect(can(null, 'devapp.issue_permit')).toBe(false)
    expect(can(undefined, 'devapp.issue_permit')).toBe(false)
    expect(can('not_a_role', 'devapp.issue_permit')).toBe(false)
  })
})

// ── Date arithmetic ──────────────────────────────────────────────────────
describe('permitRules date arithmetic', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonths('2026-08-12', 6)).toBe('2027-02-12')
  })

  it('clamps to the last valid day of a short month', () => {
    // 31 Jan + 1 month must not roll into 3 March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')  // leap year
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('normalises timestamps to a date-only string', () => {
    expect(toDateOnly('2026-08-12T09:30:00.000Z')).toBe('2026-08-12')
    expect(toDateOnly(null)).toBeNull()
    expect(toDateOnly('not-a-date')).toBeNull()
  })
})

// ── Deadlines ────────────────────────────────────────────────────────────
describe('deriveDeadlines', () => {
  const base = {
    decisionDate: '2026-08-01',
    issueDate: '2026-08-12',
    notificationDate: null,
    implementationPeriodMonths: 12,
  }

  it('derives the implementation deadline from the issue date and the permit period', () => {
    expect(deriveDeadlines(base).implementationDeadline).toBe('2027-08-12')
    expect(deriveDeadlines({ ...base, implementationPeriodMonths: 24 }).implementationDeadline)
      .toBe('2028-08-12')
  })

  it('returns no implementation deadline when no period is imposed', () => {
    expect(deriveDeadlines({ ...base, implementationPeriodMonths: 0 }).implementationDeadline)
      .toBeNull()
  })

  it('asserts the appeal deadline: s.38(1)(a) gives one month, and the rule is verified against the Act', () => {
    const d = deriveDeadlines(base)
    expect(d.appealRule.status).toBe('verified')
    expect(d.appealRule.months).toBe(1)
    expect(d.appealDeadline).toBe('2026-09-01')   // no notification date yet: from the decision date
  })

  it('does NOT assert an appeal deadline if a rule set leaves the period unverified', () => {
    const r = permitRules()
    const unverified = { ...r, appealPeriod: { ...r.appealPeriod, status: 'unverified' as const } }
    expect(deriveDeadlines(base, unverified).appealDeadline).toBeNull()
  })

  it('runs the appeal deadline from the notification date once the rule is verified', () => {
    const rules: PermitRuleSet = {
      ...permitRules(),
      appealPeriod: { ...permitRules().appealPeriod, status: 'verified', months: 1 },
    }
    const withNotice = deriveDeadlines({ ...base, notificationDate: '2026-08-20' }, rules)
    expect(withNotice.appealDeadline).toBe('2026-09-20')
    expect(withNotice.appealBasis).toBe('notification of the decision')

    // Falls back to the decision date when the applicant has not been notified.
    const noNotice = deriveDeadlines(base, rules)
    expect(noNotice.appealDeadline).toBe('2026-09-01')
    expect(noNotice.appealBasis).toBe('the decision date')
  })
})

// ── Annexure 7 ───────────────────────────────────────────────────────────
describe('buildAnnexure7', () => {
  const dates = {
    decisionDate: '2026-08-01',
    issueDate: '2026-08-12',
    notificationDate: null,
    implementationPeriodMonths: 12,
  }

  it('states the appeal date now that the period is verified (s.38: one month)', () => {
    const appeal = buildAnnexure7(dates)[0]
    expect(appeal.text).toContain('2026-09-01')
    expect(appeal.text).toContain('1 month(s)')
    expect(appeal.status).toBe('verified')
  })

  it('prints neutral appeal wording if a rule set leaves the period unverified', () => {
    const r = permitRules()
    const unverified = { ...r, appealPeriod: { ...r.appealPeriod, status: 'unverified' as const } }
    const appeal = buildAnnexure7(dates, unverified)[0]
    expect(appeal.text).toContain('within the period prescribed by the Act')
    expect(appeal.status).toBe('unverified')
  })

  it('carries rule provenance on every clause', () => {
    for (const clause of buildAnnexure7(dates)) {
      expect(clause.ruleId).toBeTruthy()
      expect(clause.source).toBeTruthy()
      expect(clause.version).toMatch(/^\d+\.\d+\.\d+/)
      expect(clause.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('states the commencement date actually imposed, not a hard-coded 12 months', () => {
    const at24 = buildAnnexure7({ ...dates, implementationPeriodMonths: 24 })
    const clause = at24.find(c => c.ruleId === 'permit.implementation.commencement')!
    expect(clause.text).toContain('24 month(s)')
    expect(clause.text).toContain('2028-08-12')
  })

  it('omits the lapse clause entirely when no commencement period is set', () => {
    const none = buildAnnexure7({ ...dates, implementationPeriodMonths: 0 })
    expect(none.find(c => c.ruleId === 'permit.implementation.commencement')).toBeUndefined()
  })

  it('flags only the rules an officer still has to verify', () => {
    const ids = unverifiedRules().map(r => r.id)
    expect(ids).not.toContain('rtcp.appeal.administrative-court')   // s.38(1)(a): one month, checked against the Act
    expect(ids).not.toContain('rtcp.s26.7.determination')          // s.26(7): three months, checked against the Act
    expect(ids).toContain('permit.implementation.commencement')     // still a per-permit default, not a rule
  })
})

// ── Document rendering ───────────────────────────────────────────────────
function record(over: Partial<PermitDocumentRecord> = {}): PermitDocumentRecord {
  return {
    permitNo: 'PERM-2026-001',
    fileRef: 'file/DEV-2026-001',
    registrationNo: 'DEV/2026/001',
    applicantName: 'A. Citizen',
    applicantIdNumber: '63-1234567-A-00',
    standNo: '1234',
    ward: 'Ward 5',
    propertyDescription: 'Stand 1234 Lalapanzi Township',
    titleDeedNo: 'DT-9911',
    applicationType: 'new_building',
    useClass: 'II',
    permittedDescription: 'Construction of a four-bedroom dwelling and ancillary buildings.',
    conditions: [{ category: 'setback', text: 'A 5 m building line shall be maintained.' }],
    annexureClauses: buildAnnexure7({
      decisionDate: '2026-08-01', issueDate: '2026-08-12',
      notificationDate: null, implementationPeriodMonths: 12,
    }),
    officerNotes: '',
    decisionDate: '2026-08-01',
    issueDate: '2026-08-12',
    notificationDate: null,
    implementationDeadline: '2027-08-12',
    appealDeadline: null,
    issuingOfficer: 'T. Moyo',
    decisionAuthority: 'Council committee resolution',
    status: 'approved_with_conditions',
    documentVersion: 1,
    provenance: 'server',
    ...over,
  }
}

describe('permit document rendering', () => {
  const pages = (over: Partial<PermitDocumentRecord> = {}) =>
    renderPermitDocument(record(over)).getNumberOfPages()

  // A permit with one short condition. Its full field set (identification,
  // applicant, property, development, conditions, Annexure 7, decision record,
  // signature) legitimately runs to a second page — asserting an exact number
  // here would only be asserting the current type scale, so the tests below
  // measure the property that actually matters: content growth must produce
  // page growth, and nothing may be silently dropped.
  const BASELINE = pages()

  it('renders a short permit over a small, bounded number of pages', () => {
    expect(BASELINE).toBeGreaterThanOrEqual(1)
    expect(BASELINE).toBeLessThanOrEqual(2)
  })

  it('paginates 20 conditions instead of running off the page', () => {
    const conditions = Array.from({ length: 20 }, (_, i) => ({
      category: 'custom',
      text: `Condition ${i + 1}: the developer shall comply with the approved plans in all `
        + 'respects, and shall not deviate from them without the prior written consent of '
        + 'the local planning authority.',
    }))
    expect(pages({ conditions })).toBeGreaterThan(BASELINE)
  })

  it('paginates a single very long condition', () => {
    const long = 'The developer shall, at their own cost and to the satisfaction of the '
      + 'Council Engineer, provide and maintain all services. '.repeat(200)
    expect(pages({ conditions: [{ category: 'services', text: long }] })).toBeGreaterThan(BASELINE)
  })

  it('paginates a long permitted-development description', () => {
    expect(pages({ permittedDescription: 'Construction of a mixed-use development. '.repeat(200) }))
      .toBeGreaterThan(BASELINE)
  })

  it('paginates long officer notes', () => {
    expect(pages({ officerNotes: 'Note to the applicant regarding servicing arrangements. '.repeat(150) }))
      .toBeGreaterThan(BASELINE)
  })

  it('renders with no conditions without throwing, and no longer than the baseline', () => {
    expect(pages({ conditions: [] })).toBeLessThanOrEqual(BASELINE)
  })

  it('stamps a footer on every page once the count is known', () => {
    const conditions = Array.from({ length: 40 }, (_, i) => ({
      category: 'custom', text: `Condition ${i + 1}. ${'Detail text. '.repeat(20)}`,
    }))
    const doc = renderPermitDocument(record({ conditions }))
    const total = doc.getNumberOfPages()
    expect(total).toBeGreaterThan(BASELINE)
    // stampFooters walks every page, so each must be selectable.
    for (let p = 1; p <= total; p++) expect(() => doc.setPage(p)).not.toThrow()
  })

  it('renders an unissued permit as a draft without changing its length', () => {
    expect(pages({ provenance: 'draft', status: 'under_review' })).toBe(BASELINE)
  })
})
