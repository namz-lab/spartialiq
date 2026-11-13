/**
 * What a person is called on their profile chip.
 *
 * The finance role the SERVER reports, not the one the browser remembers: a person whose finance
 * role was changed while they were signed in should see the role their permissions came from.
 * `admin` is here because the IT administrator reaches finance to provision access and should not
 * be labelled a finance officer. Shared by the workspaces and the previous console.
 */
export const FINANCE_ROLE_LABELS: Record<string, string> = {
  finance_admin: 'Finance Administrator',
  finance_officer: 'Finance Officer',
  budget_officer: 'Budget Officer',
  dept_head: 'Departmental Head',
  finance_committee: 'Finance Committee',
  publisher: 'Publisher',
  auditor: 'Auditor',
  accountant: 'Accountant',
  cashier: 'Cashier',
  revenue_officer: 'Revenue Officer',
  accounting_officer: 'Accounting Officer',
  cash_supervisor: 'Cash Supervisor',
  admin: 'IT Administrator',
}

export function financeRoleLabel(role: string | null | undefined): string {
  const r = role ?? ''
  return FINANCE_ROLE_LABELS[r] ?? (r ? r.replace(/_/g, ' ') : 'Finance')
}
