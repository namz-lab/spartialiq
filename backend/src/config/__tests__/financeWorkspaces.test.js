/**
 * Which finance workspaces a person may open, and which one they land on.
 *
 * The fixture is the live `finance.role_permission` table as of 2026-11-12 (migrations 188–208).
 * If a migration changes a role's grants, this test should be re-run against the new table: a
 * role silently gaining or losing a workspace is a change the client must see.
 */
const GRANTS = require('./fixtures/financeRoleGrants.json')
const { WORKSPACES, workspacesFor } = require('../financeWorkspaces')

const forRole = (role, extra = [], scoped = false) =>
  workspacesFor({ role, permissions: [...(GRANTS[role] || []), ...extra], scoped })

describe('finance workspace catalogue', () => {
  it('has the twelve workspaces in the specified order', () => {
    expect(WORKSPACES.map((w) => w.key)).toEqual([
      'manager', 'officer', 'accountant', 'accounting', 'budget', 'department',
      'committee', 'cashier', 'revenue', 'publisher', 'audit', 'administration',
    ])
  })
})

describe('default grants', () => {
  it.each([
    ['finance_admin', ['manager', 'officer', 'accountant', 'budget', 'cashier', 'revenue'], 'manager'],
    ['finance_officer', ['officer', 'budget', 'revenue'], 'officer'],
    ['accountant', ['accountant'], 'accountant'],
    ['accounting_officer', ['accounting'], 'accounting'],
    ['budget_officer', ['budget'], 'budget'],
    ['finance_committee', ['committee'], 'committee'],
    ['cashier', ['cashier'], 'cashier'],
    // Migration 208: the supervisor works from the Cash Office (the drawers board) and takes no money.
    ['cash_supervisor', ['cashier'], 'cashier'],
    ['revenue_officer', ['revenue'], 'revenue'],
    ['publisher', ['publisher'], 'publisher'],
    ['auditor', ['audit'], 'audit'],
    ['admin', ['administration'], 'administration'],
  ])('%s opens %j and lands on %s', (role, workspaces, home) => {
    expect(forRole(role)).toEqual({ workspaces, home })
  })

  it('a scoped departmental head opens Department Finance only', () => {
    expect(forRole('dept_head', [], true)).toEqual({ workspaces: ['department'], home: 'department' })
  })

  it('an unscoped departmental head still gets Department Finance, not the council budget', () => {
    expect(forRole('dept_head', [], false)).toEqual({ workspaces: ['department'], home: 'department' })
  })
})

describe('overrides and fallbacks', () => {
  it('a revenue officer granted the till keeps Revenue as home and gains the Cash Office', () => {
    expect(forRole('revenue_officer', ['finance.cash.session.operate']))
      .toEqual({ workspaces: ['cashier', 'revenue'], home: 'revenue' })
  })

  it('a role whose own workspace is not admitted lands on the first one that is', () => {
    expect(workspacesFor({ role: 'budget_officer', permissions: GRANTS.cashier, scoped: false }))
      .toEqual({ workspaces: ['cashier'], home: 'cashier' })
  })

  it('no permissions means no workspace and no home', () => {
    expect(workspacesFor({ role: 'cashier', permissions: [], scoped: false }))
      .toEqual({ workspaces: [], home: null })
  })

  it('a departmental scope moves a budget preparer out of the council-wide Budget workspace', () => {
    expect(forRole('budget_officer', [], true)).toEqual({ workspaces: ['department'], home: 'department' })
  })

  it('the accounting officer loses Executive Finance the moment they hold anything that writes', () => {
    expect(forRole('accounting_officer', ['finance.budget.prepare']).workspaces).not.toContain('accounting')
  })

  it('accepts a Set of permissions', () => {
    expect(workspacesFor({ role: 'cashier', permissions: new Set(GRANTS.cashier), scoped: false }).home)
      .toBe('cashier')
  })
})
