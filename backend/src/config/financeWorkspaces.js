/**
 * The finance workspace catalogue: which of the twelve role workspaces a person may open, and
 * which one they land on.
 *
 * Design: docs/superpowers/specs/2026-11-12-finance-role-workspaces-design.md (frontend repo) §6.
 *
 * WHY THIS LIVES ON THE SERVER
 * The client asked that entry to a workspace be validated server-side. The frontend never computes
 * access: `GET /api/finance/me` returns `workspaces` and `home_workspace` from this module, and the
 * route guard only reads them. That is still a CONVENIENCE. The control is unchanged: every finance
 * endpoint re-checks its own permission in `src/middleware/financePermissions.js` and audits a
 * refusal, so a person who reaches a workspace screen they should not see still cannot act in it.
 *
 * WHY THE PREDICATES ARE "DEFINING" PERMISSIONS
 * Admission is by the permission that IS the job (posting vouchers, operating a till), never by a
 * view permission. `finance.budget.view` is held by almost every role, so admitting by it would put
 * every workspace in every switcher.
 *
 * THE ROLE PICKS THE HOME, THE PERMISSIONS PICK EVERYTHING ELSE
 * A personal override (`finance.user_permission_override`) widens what a person may open without
 * moving their home: a revenue officer granted the till lands in Revenue and reaches the Cash
 * Office through the switcher.
 */

// A code that only reads or exports. Anything else prepares, posts, approves, publishes or
// configures. Same rule the frontend's role preset used for the accounting officer.
const READ_ONLY = /\.(view|export|view_counterparty|view_restricted|export_restricted)$/

const APPROVALS = [
  'finance.budget.approve', 'finance.revision.approve', 'finance.project.approve',
  'finance.publication.approve', 'finance.rates.tariff.approve', 'finance.ledger.close_year',
]

const isDepartmental = (ctx) => ctx.scoped || ctx.role === 'dept_head'

/** In this order: the switcher lists workspaces in it, and a home fallback takes the first. */
const WORKSPACES = Object.freeze([
  { key: 'manager', label: 'Finance Management', homeFor: ['finance_admin'],
    admits: (h) => h.has('finance.config.manage') },
  { key: 'officer', label: 'Finance Operations', homeFor: ['finance_officer'],
    admits: (h) => h.has('finance.import.upload') },
  { key: 'accountant', label: 'Accounting', homeFor: ['accountant'],
    admits: (h) => h.has('finance.ledger.voucher.post') },
  // The executive reads the whole position and acts on none of it. Distinguished from the auditor
  // by not taking the trail away (no audit export).
  { key: 'accounting', label: 'Executive Finance', homeFor: ['accounting_officer'],
    admits: (h) => h.has('finance.audit.view') && h.has('finance.ledger.view')
      && !h.has('finance.audit.export') && [...h].every((c) => READ_ONLY.test(c)) },
  // A departmental scope confines a preparer to their own votes, which is Department Finance's
  // job, not the council-wide budget's. A departmental head counts as departmental even before a
  // scope is recorded for them: an unconfigured scope must not widen them to the whole council.
  { key: 'budget', label: 'Budget Management', homeFor: ['budget_officer'],
    admits: (h, ctx) => h.has('finance.budget.prepare') && !isDepartmental(ctx) },
  // A departmental head without a scope still belongs here: the workspace says no votes are
  // assigned rather than showing them the whole council.
  { key: 'department', label: 'Department Finance', homeFor: ['dept_head'],
    admits: (h, ctx) => isDepartmental(ctx) },
  { key: 'committee', label: 'Committee Decisions', homeFor: ['finance_committee'],
    admits: (h) => APPROVALS.some((c) => h.has(c)) },
  // The cash supervisor (migration 208) works in the Cash Office too: the drawers board is there.
  { key: 'cashier', label: 'Cash Office', homeFor: ['cashier', 'cash_supervisor'],
    admits: (h) => h.has('finance.cash.session.operate') || h.has('finance.cash.session.supervise') },
  { key: 'revenue', label: 'Revenue and Rates', homeFor: ['revenue_officer'],
    admits: (h) => h.has('finance.rates.bill.prepare') || h.has('finance.rates.valuation.manage') },
  { key: 'publisher', label: 'Publication', homeFor: ['publisher'],
    admits: (h) => h.has('finance.publication.publish') },
  { key: 'audit', label: 'Internal Audit', homeFor: ['auditor'],
    admits: (h) => h.has('finance.audit.export') && h.has('finance.report.export_restricted') },
  { key: 'administration', label: 'Finance Access Administration', homeFor: ['admin'],
    admits: (h) => h.has('finance.users.manage_finance_roles') },
].map(Object.freeze))

/**
 * @param {{ role: string, permissions: Iterable<string>, scoped: boolean }} who
 *   `permissions` are the EFFECTIVE codes (role grants with personal overrides applied), as
 *   `permissionsFor` returns them.
 * @returns {{ workspaces: string[], home: string | null }}
 */
function workspacesFor({ role, permissions, scoped }) {
  const held = permissions instanceof Set ? permissions : new Set(permissions)
  const ctx = { role: role || '', scoped: Boolean(scoped) }
  const open = WORKSPACES.filter((w) => w.admits(held, ctx))
  const own = open.find((w) => w.homeFor.includes(ctx.role))
  return {
    workspaces: open.map((w) => w.key),
    home: (own || open[0] || { key: null }).key,
  }
}

module.exports = { WORKSPACES, workspacesFor }
