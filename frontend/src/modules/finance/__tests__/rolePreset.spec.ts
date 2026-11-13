// @vitest-environment happy-dom
//
// The role preset, for all eight roles.
//
// The grants here are transcribed from the authoritative matrix in
// docs/gis-finance/ROLE-WORKFLOW-COVERAGE.md §1, which is itself read out of backend migrations
// 188 (33 codes, default grants at :1107-1232) and 199 (`finance.map.view`, granted to the seven
// finance roles and NOT to `admin`). If a migration changes a grant, these fixtures must be
// re-derived from it rather than adjusted to make a test pass.
//
// Two properties matter more than any individual expectation and are asserted for every role:
// the preset never names a landing or a foreground section the person's permissions do not reach,
// and it never withholds anything — it is ordering and emphasis, and `can()` is untouched by it.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  resolveRolePreset, resolveActiveSection, deliberateAbsences, type FinanceSectionKey,
} from '../stores/rolePreset'
import { useFinanceStore } from '../stores/finance'
import type { FinanceIdentity } from '../models/types'

const ROLE_GRANTS: Record<string, string[]> = {
  finance_admin: [
    'finance.config.manage', 'finance.year.close', 'finance.budget.view', 'finance.budget.prepare',
    'finance.budget.submit', 'finance.revision.prepare', 'finance.revision.submit',
    'finance.actuals.view', 'finance.transaction.view', 'finance.transaction.view_counterparty',
    'finance.import.upload', 'finance.import.validate', 'finance.import.commit',
    'finance.import.exception.resolve', 'finance.project.view', 'finance.project.manage',
    'finance.document.view', 'finance.document.upload', 'finance.document.view_restricted',
    'finance.report.view', 'finance.report.export', 'finance.report.export_restricted',
    'finance.variance.explain', 'finance.publication.review', 'finance.audit.view',
    'finance.map.view',
  ],
  finance_officer: [
    'finance.budget.view', 'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit', 'finance.actuals.view',
    'finance.transaction.view', 'finance.transaction.view_counterparty', 'finance.import.upload',
    'finance.import.validate', 'finance.import.exception.resolve', 'finance.project.view',
    'finance.project.manage', 'finance.document.view', 'finance.document.upload',
    'finance.report.view', 'finance.report.export', 'finance.variance.explain', 'finance.map.view',
  ],
  budget_officer: [
    'finance.budget.view', 'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit', 'finance.actuals.view',
    'finance.project.view', 'finance.document.view', 'finance.document.upload',
    'finance.report.view', 'finance.report.export', 'finance.variance.explain', 'finance.map.view',
  ],
  dept_head: [
    'finance.budget.view', 'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit', 'finance.actuals.view',
    'finance.project.view', 'finance.project.manage', 'finance.document.view',
    'finance.document.upload', 'finance.report.view', 'finance.variance.explain',
    'finance.map.view',
  ],
  finance_committee: [
    'finance.budget.view', 'finance.budget.approve', 'finance.revision.approve',
    'finance.actuals.view', 'finance.transaction.view', 'finance.project.view',
    'finance.project.approve', 'finance.document.view', 'finance.report.view',
    'finance.report.export', 'finance.publication.review', 'finance.publication.approve',
    'finance.audit.view', 'finance.map.view',
  ],
  publisher: [
    'finance.budget.view', 'finance.actuals.view', 'finance.project.view',
    'finance.document.view', 'finance.report.view', 'finance.publication.review',
    'finance.publication.publish', 'finance.publication.withdraw', 'finance.map.view',
  ],
  auditor: [
    'finance.budget.view', 'finance.actuals.view', 'finance.transaction.view',
    'finance.transaction.view_counterparty', 'finance.project.view', 'finance.document.view',
    'finance.document.view_restricted', 'finance.report.view', 'finance.report.export',
    'finance.report.export_restricted', 'finance.audit.view', 'finance.audit.export',
    'finance.map.view',
  ],
  admin: [
    'finance.budget.view', 'finance.actuals.view', 'finance.project.view', 'finance.report.view',
    'finance.audit.view', 'finance.audit.export', 'finance.users.manage_finance_roles',
  ],
}

const preset = (role: string, scoped = false) =>
  resolveRolePreset({ role, permissions: ROLE_GRANTS[role], scoped })

describe('the role preset — where each of the eight roles lands', () => {
  it('sends the publisher to the one section it acts in', () => {
    // Nine permissions, two sections. It used to land on Overview, a page of departmental figures
    // it has no permission to change.
    expect(preset('publisher').landing).toBe('publication')
  })

  it('sends the technical administrator to Finance access and nowhere near the money', () => {
    expect(preset('admin').landing).toBe('access')
    expect([...preset('admin').foreground].sort()).toEqual(['access', 'audit'])
  })

  it('sends the auditor to the trail', () => {
    expect(preset('auditor').landing).toBe('audit')
  })

  it('sends the preparing roles to the register they prepare', () => {
    expect(preset('budget_officer').landing).toBe('budget')
    expect(preset('dept_head', true).landing).toBe('budget')
  })

  it('sends the data custodian to imports', () => {
    expect(preset('finance_officer').landing).toBe('imports')
  })

  it('sends the two roles that decide across the cycle to the decisions surface', () => {
    // Overview carries the work queue above the departmental position, so for these two it is a
    // decisions view rather than a dashboard. The committee approves four different things and the
    // finance administrator operates all of them; neither has one section that is "its" work.
    expect(preset('finance_committee').landing).toBe('overview')
    expect(preset('finance_admin').landing).toBe('overview')
  })

  it('gives every role a landing it can actually open', () => {
    for (const role of Object.keys(ROLE_GRANTS)) {
      const p = preset(role, role === 'dept_head')
      // Nothing is foregrounded that the permissions do not reach: `access` only for the one role
      // that holds the provisioning permission, `map` never for `admin`.
      if (p.foreground.includes('access')) {
        expect(ROLE_GRANTS[role]).toContain('finance.users.manage_finance_roles')
      }
      if (p.foreground.includes('map')) expect(ROLE_GRANTS[role]).toContain('finance.map.view')
      expect(p.foreground[0]).toBeDefined()
      expect(p.foreground).toContain(p.landing)
    }
  })
})

describe('the role preset — what each role is shown as its work', () => {
  // The expected sets are §6 of the audit, transcribed. The landing is included because arriving
  // somewhere presented as "also available" would be incoherent.
  //
  // `transactions` appears for exactly the four roles granted `finance.transaction.view`
  // (migration 188:1065) — finance_admin, finance_officer, finance_committee and auditor. It is
  // absent for budget_officer, dept_head, publisher and admin, none of which hold it. Before the
  // register was built this permission had no endpoint and no screen at all (GAP-1), so the four
  // sets below are the assertion that it now has both and that it reached nobody else.
  const EXPECTED: Record<string, string[]> = {
    finance_admin: ['overview', 'years', 'classifications', 'budget', 'revisions', 'projects', 'transactions', 'imports', 'reports', 'documents', 'settings'],
    finance_officer: ['overview', 'budget', 'revisions', 'projects', 'transactions', 'imports', 'reports', 'documents'],
    budget_officer: ['overview', 'map', 'budget', 'revisions', 'reports', 'documents'],
    dept_head: ['overview', 'budget', 'revisions', 'projects', 'documents'],
    // Documents is NOT here: the committee holds `finance.document.view` and neither
    // `document.upload` nor `document.view_restricted`, so documents are something it reads in
    // passing rather than work it does. The audit lists Documents under its de-emphasised set.
    finance_committee: ['overview', 'budget', 'revisions', 'projects', 'transactions', 'reports', 'publication', 'audit'],
    publisher: ['publication', 'documents'],
    auditor: ['audit', 'map', 'budget', 'transactions', 'reports', 'documents'],
    admin: ['access', 'audit'],
  }

  for (const [role, expected] of Object.entries(EXPECTED)) {
    it(`foregrounds the right sections for ${role}`, () => {
      const p = preset(role, role === 'dept_head')
      expect([...p.foreground].sort()).toEqual([...expected].sort())
    })
  }

  it('foregrounds Rates for the office that works it and the committee that resolves the rate, and for nobody who only reads', () => {
    // The grants of migration 205, added to each role's own.
    const withRates = (role: string, extra: string[]) =>
      resolveRolePreset({ role, permissions: [...ROLE_GRANTS[role], 'finance.rates.view', ...extra] })
    expect(withRates('finance_officer', ['finance.rates.bill.prepare', 'finance.rates.receipt.record']).foreground).toContain('rates')
    expect(withRates('finance_admin', ['finance.rates.bill.post']).foreground).toContain('rates')
    expect(withRates('finance_committee', ['finance.rates.tariff.approve']).foreground).toContain('rates')
    expect(withRates('auditor', []).foreground).not.toContain('rates')
    expect(withRates('admin', []).foreground).not.toContain('rates')
    // A reader is told why the section is there, rather than left to find no buttons on it.
    expect(deliberateAbsences({ role: 'auditor', permissions: [...ROLE_GRANTS.auditor, 'finance.rates.view'] })
      .some((n) => n.startsWith('Rates is on your rail to read'))).toBe(true)
    // And without the permission the section is not foregrounded at all.
    expect(preset('finance_officer').foreground).not.toContain('rates')
  })

  it('never foregrounds Permissions, which is reference rather than work', () => {
    for (const role of Object.keys(ROLE_GRANTS)) {
      expect(preset(role, role === 'dept_head').foreground).not.toContain('permissions')
    }
  })

  it('keeps the publisher\'s rail from being five-sixths other people\'s work', () => {
    // Twelve sections are visible to it because six of them accept bare finance.budget.view. Two
    // are its job, and only those two are foregrounded.
    expect(preset('publisher').foreground).toHaveLength(2)
  })

  it('does not foreground the map for a departmental head confined to one vote', () => {
    expect(preset('dept_head', true).foreground).not.toContain('map')
    // Unscoped, the same grants are a council-wide preparer and the map is their allocation view.
    expect(preset('dept_head', false).foreground).toContain('map')
  })
})

describe('the role preset — the filters a section opens on', () => {
  it('gives the committee the submitted work it must decide', () => {
    const f = preset('finance_committee').defaultFilters
    expect(f.budgetStatus).toBe('submitted')
    expect(f.revisionState).toBe('submitted')
    expect(f.projectStatus).toBe('awaiting_approval')
    expect(f.publicationState).toBe('pending')
  })

  it('gives the publisher "approved and awaiting publication" and not the committee\'s half', () => {
    expect(preset('publisher').defaultFilters.publicationState).toBe('approved')
  })

  it('gives the only committer the batches that are waiting for it', () => {
    expect(preset('finance_admin').defaultFilters.importStatus).toBe('validated')
    expect(preset('finance_officer').defaultFilters.importStatus).toBeUndefined()
  })

  it('gives a preparer its own unfinished work and leaves the operator\'s register whole', () => {
    expect(preset('budget_officer').defaultFilters.budgetStatus).toBe('draft')
    expect(preset('dept_head', true).defaultFilters.budgetStatus).toBe('draft')
    // The finance administrator answers questions about any line in any state; narrowing its
    // register on arrival would hide the line someone is asking about.
    expect(preset('finance_admin').defaultFilters.budgetStatus).toBeUndefined()
  })

  it('narrows the trail to a review period instead of everything ever recorded', () => {
    expect(preset('auditor').defaultFilters.auditDays).toBe(30)
    expect(preset('admin').defaultFilters.auditDays).toBe(7)
  })

  it('records that a scoped person\'s department is not theirs to change', () => {
    expect(preset('dept_head', true).defaultFilters.departmentLocked).toBe(true)
    expect(preset('finance_officer').defaultFilters.departmentLocked).toBeUndefined()
  })
})

describe('the role preset — unusual grants', () => {
  it('reads the permissions, not the role name', () => {
    // A publisher whose council also gave it the committee's approval permission is not sent to
    // the section a "publisher" would be sent to by name — it is sent where its duties are.
    const odd = resolveRolePreset({
      role: 'publisher',
      permissions: ['finance.budget.view', 'finance.budget.approve', 'finance.report.view'],
    })
    expect(odd.landing).toBe('overview')
    expect(odd.foreground).toContain('budget')
    expect(odd.foreground).not.toContain('publication')
  })

  it('gives someone with nothing but read access a coherent workspace rather than an empty one', () => {
    const readOnly = resolveRolePreset({ role: 'planner', permissions: ['finance.budget.view'] })
    expect(readOnly.landing).toBe('overview')
    expect(readOnly.foreground).toEqual(['overview'])
    expect(readOnly.summary).toMatch(/read access/i)
  })

  it('does not fall over on an identity with no permissions at all', () => {
    const none = resolveRolePreset({ role: null, permissions: [] })
    expect(none.landing).toBe('permissions')
    expect(none.foreground).toEqual(['permissions'])
  })
})

describe('the deliberate absences', () => {
  it('tells a finance administrator why it cannot administer finance access', () => {
    const notes = deliberateAbsences({ role: 'finance_admin', permissions: ROLE_GRANTS.finance_admin })
    expect(notes.join(' ')).toMatch(/provisioned by the technical administrator/)
    expect(notes.join(' ')).toMatch(/confers no authority over financial content/)
  })

  it('tells a technical administrator why there is no finance map on its rail', () => {
    const notes = deliberateAbsences({ role: 'admin', permissions: ROLE_GRANTS.admin })
    expect(notes.join(' ')).toMatch(/no Finance map on your rail/)
  })

  it('says nothing to the roles for whom nothing is missing', () => {
    expect(deliberateAbsences({ role: 'budget_officer', permissions: ROLE_GRANTS.budget_officer })).toEqual([])
    expect(deliberateAbsences({ role: 'publisher', permissions: ROLE_GRANTS.publisher })).toEqual([])
  })
})

describe('the preset is presentation and not a gate', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  const identity = (role: string, scope: FinanceIdentity['department_scope'] = []): FinanceIdentity => ({
    user_id: 'u1', role, authority_id: 1, permissions: ROLE_GRANTS[role],
    department_scope: scope, catalogue: [],
  })

  it('does not change what can() answers for any role', () => {
    const store = useFinanceStore()
    for (const role of Object.keys(ROLE_GRANTS)) {
      store.identity = identity(role)
      // The preset is read, and the answers are unchanged by reading it.
      const before = ROLE_GRANTS[role].every((code) => store.can(code))
      void store.rolePreset
      const after = ROLE_GRANTS[role].every((code) => store.can(code))
      expect(before).toBe(true)
      expect(after).toBe(true)
      // And it grants nothing: a section's foreground entry never implies a permission.
      expect(store.can('finance.users.manage_finance_roles'))
        .toBe(ROLE_GRANTS[role].includes('finance.users.manage_finance_roles'))
    }
  })

  it('exposes nothing at all before the identity is loaded', () => {
    const store = useFinanceStore()
    expect(store.identity).toBeNull()
    // Failing closed: no permissions means no claim about what this person's work is.
    expect(store.rolePreset.foreground).toEqual(['permissions'])
    expect(store.absenceNotes).toEqual([])
  })

  it('tracks a scope the server reports, so an override is reflected without a code change', () => {
    const store = useFinanceStore()
    store.identity = identity('dept_head', [{ id: 'd1', code: 'ENG', name: 'Engineering' }])
    expect(store.rolePreset.defaultFilters.departmentLocked).toBe(true)
    expect(store.rolePreset.summary).toMatch(/confined to your own votes/)
  })
})

describe('which section is open: the URL, then the preset, then what is reachable', () => {
  // The rail, in order, for a publisher: twelve sections are visible to it because six of them
  // accept bare finance.budget.view, and only two are its work.
  const PUBLISHER_RAIL: FinanceSectionKey[] = [
    'overview', 'map', 'years', 'classifications', 'budget', 'revisions', 'projects',
    'reports', 'documents', 'publication', 'permissions', 'settings',
  ]

  it('opens the role preset\'s landing when the URL says nothing', () => {
    expect(resolveActiveSection({
      openable: PUBLISHER_RAIL, preset: preset('publisher'),
    })).toBe('publication')
  })

  it('lets an explicit link beat the preset, because "send me the link" must keep working', () => {
    expect(resolveActiveSection({
      requested: 'budget', openable: PUBLISHER_RAIL, preset: preset('publisher'),
    })).toBe('budget')
  })

  it('ignores a section the person cannot open and falls back to the preset', () => {
    // `access` needs finance.users.manage_finance_roles, which a publisher does not hold. The URL
    // is then corrected rather than showing something else under the wrong address.
    expect(resolveActiveSection({
      requested: 'access', openable: PUBLISHER_RAIL, preset: preset('publisher'),
    })).toBe('publication')
  })

  it('falls back to the first reachable section when even the landing is unreachable', () => {
    // A preset can never widen what the permissions allow. If a council denied `access` to the one
    // role whose landing it is, that role still gets a working workspace.
    expect(resolveActiveSection({
      openable: ['overview', 'audit'], preset: preset('admin'),
    })).toBe('overview')
  })

  it('never returns a section outside the openable set', () => {
    for (const role of Object.keys(ROLE_GRANTS)) {
      const open = resolveActiveSection({
        requested: 'access', openable: ['overview', 'budget'], preset: preset(role),
      })
      expect(['overview', 'budget']).toContain(open)
    }
  })
})
