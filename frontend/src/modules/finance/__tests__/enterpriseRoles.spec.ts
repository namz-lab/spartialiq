// @vitest-environment happy-dom
//
// The four roles of the enterprise design's Phase 1, and the desks they arrive at.
//
// The grants are read out of backend migration 207 (finance.role_permission, section 9). If the
// migration changes a grant these fixtures are re-derived from it, not adjusted to pass.
// Design: docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §4.
import { describe, it, expect } from 'vitest'
import { resolveRolePreset, deliberateAbsences } from '../stores/rolePreset'

const f = (codes: string) => codes.split(' ').map((c) => `finance.${c}`)
const GRANTS: Record<string, string[]> = {
  cashier: f('cash.deposit.prepare cash.receipt.cancel cash.receipt.record cash.session.operate cash.view rates.receipt.record rates.view'),
  accountant: f('actuals.view budget.view cash.session.verify cash.setup.manage cash.view document.upload document.view ledger.party.manage ledger.period.manage ledger.view ledger.voucher.post ledger.voucher.prepare ledger.voucher.reverse map.view project.view rates.bill.post rates.view report.export report.view transaction.view transaction.view_counterparty variance.explain'),
  revenue_officer: f('actuals.view budget.view cash.view document.upload document.view ledger.party.manage ledger.view map.view rates.account.manage rates.bill.prepare rates.receipt.record rates.tariff.manage rates.valuation.manage rates.view report.export report.view'),
  accounting_officer: f('actuals.view audit.view budget.view cash.view document.view ledger.view map.view project.view rates.view report.export report.view transaction.view'),
  cash_supervisor: f('cash.assignment.manage cash.session.supervise cash.session.verify cash.view rates.view'),
}
const preset = (role: string) => resolveRolePreset({ role, permissions: GRANTS[role] })

describe('the enterprise roles — where each one lands', () => {
  it('sends the cashier to the counter, with the counter first on a rail of two', () => {
    const p = preset('cashier')
    expect(p.landing).toBe('cash')
    expect(p.foreground).toEqual(['cash', 'rates'])
    expect(p.summary).toMatch(/open your till/)
  })

  it('sends the accountant to the book it keeps, with the cash-ups it verifies as its work', () => {
    const p = preset('accountant')
    expect(p.landing).toBe('ledger')
    for (const key of ['ledger', 'statements', 'cash', 'rates', 'transactions', 'reports']) expect(p.foreground).toContain(key)
    expect(p.foreground).not.toContain('revisions')
    expect(p.foreground).not.toContain('publication')
    expect(p.summary).toMatch(/cannot post a voucher you prepared/)
  })

  it('sends the revenue officer to Rates', () => {
    const p = preset('revenue_officer')
    expect(p.landing).toBe('rates')
    expect(p.foreground).toContain('rates')
    // Reads the book and the cash office; keeps neither.
    expect(p.foreground).not.toContain('ledger')
    expect(p.foreground).not.toContain('cash')
  })

  it('sends the accounting officer to the position, with oversight of the cash office and the trail', () => {
    const p = preset('accounting_officer')
    expect(p.landing).toBe('overview')
    for (const key of ['overview', 'statements', 'cash', 'audit', 'reports']) expect(p.foreground).toContain(key)
    expect(p.summary).toMatch(/Nothing on these screens is yours to change/)
  })

  it('does not mistake the accounting officer for the auditor, or the auditor for the accounting officer', () => {
    // What separates them is the audit EXPORT: the auditor takes the trail away, the executive reads it.
    const auditor = resolveRolePreset({ role: 'auditor', permissions: [...GRANTS.accounting_officer, 'finance.audit.export'] })
    expect(auditor.landing).toBe('audit')
    expect(preset('accounting_officer').landing).not.toBe('audit')
  })

  it('never foregrounds a section the grants do not reach', () => {
    const NEEDS: Record<string, string> = {
      cash: 'finance.cash.view', rates: 'finance.rates.view', ledger: 'finance.ledger.view',
      statements: 'finance.ledger.view', audit: 'finance.audit.view', map: 'finance.map.view',
      transactions: 'finance.transaction.view', overview: 'finance.budget.view', budget: 'finance.budget.view',
    }
    for (const role of Object.keys(GRANTS)) {
      for (const key of preset(role).foreground) {
        if (NEEDS[key]) expect(GRANTS[role], `${role} → ${key}`).toContain(NEEDS[key])
      }
    }
  })

  it('tells the cashier why their rail is short, and the readers that the cash office is theirs to read', () => {
    expect(deliberateAbsences({ role: 'cashier', permissions: GRANTS.cashier }).join(' ')).toMatch(/A counter is where the public pays/i)
    expect(deliberateAbsences({ role: 'revenue_officer', permissions: GRANTS.revenue_officer }).join(' ')).toMatch(/cash office is on your rail to read/)
    expect(deliberateAbsences({ role: 'accountant', permissions: GRANTS.accountant }).join(' ')).not.toMatch(/cash office is on your rail to read/)
  })

  it('sends the cash supervisor (migration 208) to the cash office, and says they take no money', () => {
    const p = preset('cash_supervisor')
    expect(p.landing).toBe('cash')
    expect(p.foreground).toContain('cash')
    expect(p.summary).toMatch(/take no money/)
    expect(p.summary).toMatch(/never verify a count you made or witnessed/)
  })
})
