// @vitest-environment happy-dom
//
// Cross-workspace links. A link names WHAT it wants ("the vouchers"), and the resolver decides
// WHERE: in the workspace the person is in if it has it, else their home, else another workspace
// they hold. A workspace they do not hold is never chosen, and a target none of theirs serves is
// an explanation, not a link (spec §7, client amendment §13.5).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerWorkspace, builtWorkspaces, registrationOf, __resetRegistry, WORKSPACE_KEYS, WORKSPACE_META,
} from '../shell/workspaces'
import { SECTION_TARGETS } from '../shell/targets'
import { resolveTarget, UNAVAILABLE_REASON } from '../shell/useFinanceNav'

beforeEach(() => {
  __resetRegistry()
  registerWorkspace({ key: 'accountant', routes: [], serves: { 'ledger.vouchers': 'fin-accountant-journals', statements: 'fin-accountant-statements' } })
  registerWorkspace({ key: 'manager', routes: [], serves: { overview: 'fin-manager-home', statements: 'fin-manager-statements' } })
})

describe('the workspace registry', () => {
  it('names the twelve workspaces in catalogue order, as the server does', () => {
    expect(WORKSPACE_KEYS).toEqual([
      'manager', 'officer', 'accountant', 'accounting', 'budget', 'department',
      'committee', 'cashier', 'revenue', 'publisher', 'audit', 'administration',
    ])
  })

  it('carries the application name and route of each workspace', () => {
    expect(WORKSPACE_META.cashier).toEqual({ name: 'Cash Office', path: '/finance/cashier' })
    expect(WORKSPACE_META.audit).toEqual({ name: 'Internal Audit', path: '/finance/audit' })
    expect(WORKSPACE_META.administration.path).toBe('/finance/administration')
  })

  it('reports only the workspaces that have been built, in catalogue order', () => {
    expect(builtWorkspaces()).toEqual(['manager', 'accountant'])
    expect(registrationOf('cashier')).toBeUndefined()
  })
})

describe('legacy sections', () => {
  it('maps every old section to a target', () => {
    expect(SECTION_TARGETS.cash).toBe('cash.counter')
    expect(SECTION_TARGETS.ledger).toBe('ledger.vouchers')
    expect(SECTION_TARGETS.budget).toBe('budget')
    expect(Object.keys(SECTION_TARGETS)).toHaveLength(20)
  })
})

describe('resolveTarget', () => {
  it('stays in the current workspace when it serves the target', () => {
    expect(resolveTarget('statements', { current: 'manager', home: 'manager', open: ['manager', 'accountant'] }))
      .toEqual({ kind: 'route', workspace: 'manager', name: 'fin-manager-statements' })
  })

  it('goes home when the current workspace does not serve it', () => {
    expect(resolveTarget('overview', { current: 'accountant', home: 'manager', open: ['manager', 'accountant'] }))
      .toEqual({ kind: 'route', workspace: 'manager', name: 'fin-manager-home' })
  })

  it('goes to another held workspace when neither current nor home serves it', () => {
    expect(resolveTarget('ledger.vouchers', { current: 'manager', home: 'manager', open: ['manager', 'accountant'] }))
      .toEqual({ kind: 'route', workspace: 'accountant', name: 'fin-accountant-journals' })
  })

  it('never sends a person to a workspace they do not hold', () => {
    expect(resolveTarget('ledger.vouchers', { current: 'manager', home: 'manager', open: ['manager'] }))
      .toEqual({ kind: 'unavailable', reason: UNAVAILABLE_REASON })
  })

  it('explains, rather than links, when no workspace of theirs serves the target', () => {
    expect(UNAVAILABLE_REASON).toBe(
      'None of your finance workspaces includes this. Ask the finance administrator if your duties have changed.')
    expect(resolveTarget('rates', { current: null, home: 'manager', open: ['manager', 'accountant'] }).kind)
      .toBe('unavailable')
  })

  it('skips a held workspace that has not been built yet', () => {
    expect(resolveTarget('cash.counter', { current: null, home: 'cashier', open: ['cashier'] }).kind)
      .toBe('unavailable')
  })
})
