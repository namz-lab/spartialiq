const {
  ALL_ROLES, STAFF_ROLES, FINANCE_ROLES, ASSIGNABLE_ROLES, ROLE_LABELS,
} = require('../src/config/permissions')

describe('finance role registry', () => {
  test('every finance role is a permitted and staff role', () => {
    for (const role of FINANCE_ROLES) {
      expect(ALL_ROLES).toContain(role)
      expect(STAFF_ROLES).toContain(role)
      expect(ASSIGNABLE_ROLES).toContain(role)
    }
  })

  test('every role has a console label', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeDefined()
      expect(ROLE_LABELS[role].name).toBeTruthy()
      expect(ROLE_LABELS[role].summary).toBeTruthy()
    }
  })

  test('the finance roles are the seven separated duties from migration 188, the four from 207 and the cash supervisor from 208', () => {
    expect([...FINANCE_ROLES].sort()).toEqual([
      'accountant', 'accounting_officer', 'auditor', 'budget_officer', 'cash_supervisor', 'cashier', 'dept_head',
      'finance_admin', 'finance_committee', 'finance_officer', 'publisher', 'revenue_officer',
    ])
  })
})
