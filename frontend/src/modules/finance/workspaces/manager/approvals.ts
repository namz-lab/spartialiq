/**
 * Everything waiting for somebody's decision across finance, in one list for the finance director.
 *
 * The director does not approve from here: approving is the approver's act in the workspace that
 * holds the evidence (preparer ≠ approver is enforced there and on the server). This list says what
 * is waiting, who decides it, and opens the screen where it is decided, when the director may open
 * that screen. A count the director cannot read is reported as unreadable, never as zero.
 */
import type { ManagerDashboard } from '../../api/dashboardsApi'
import type { AccountingDashboard } from '../../api/accountingApi'
import type { PayablesSummary } from '../../api/payablesApi'
import type { FinanceTarget } from '../../shell/targets'
import type { WorkspaceKey } from '../../shell/workspaces'

/** Where an item is decided: a target `useFinanceNav` resolves, or a named screen in a workspace. */
export type InboxWhere = { target: FinanceTarget; query?: Record<string, string> } | { workspace: WorkspaceKey; name: string; query?: Record<string, string> }

export interface InboxItem {
  key: string
  label: string
  /** `null` when the count could not be read. */
  n: number | null
  /** Who decides it, in plain words. */
  decides: string
  where: InboxWhere
  /** Why `n` is null. */
  why?: string
}

export interface InboxInputs {
  manager: ManagerDashboard | null
  accounting: AccountingDashboard | null
  payables: PayablesSummary | null
  importsValidated: number | null
  assetRunsAwaiting: number | null
  disposalsAwaiting: number | null
  cutoversPreparing: number | null
}

const DECIDES: Record<string, string> = {
  budget: 'Finance committee',
  revisions: 'Finance committee',
  publication: 'Finance committee',
  projects: 'Finance committee',
  rates: 'Finance committee (tariff approval)',
  map: 'Budget officer or committee',
  vouchers: 'Accountant (not the preparer)',
}
const WHERE: Record<string, InboxWhere> = {
  budget: { target: 'budget', query: { status: 'submitted' } },
  revisions: { target: 'revisions', query: { state: 'submitted' } },
  publication: { target: 'publication' },
  projects: { target: 'projects', query: { status: 'awaiting_approval' } },
  rates: { target: 'rates' },
  map: { target: 'map' },
  vouchers: { target: 'ledger.vouchers' },
}

const unreadable = 'Your role cannot read this count.'

export function buildInbox(i: InboxInputs): InboxItem[] {
  const items: InboxItem[] = (i.manager?.pending ?? []).map((p) => ({
    key: p.key, label: p.label, n: p.n, decides: DECIDES[p.key] ?? 'The approver', where: WHERE[p.key] ?? { target: 'overview' },
  }))
  items.push(
    {
      key: 'invoices', label: 'Supplier invoices awaiting approval', n: i.payables?.awaiting_approval.invoices ?? null,
      decides: 'Invoice approver (not the preparer)', where: { workspace: 'accountant', name: 'acc-payable' },
      ...(i.payables ? {} : { why: unreadable }),
    },
    {
      key: 'payments', label: 'Supplier payments awaiting approval', n: i.payables?.awaiting_approval.payments ?? null,
      decides: 'Payment approver (not the preparer)', where: { workspace: 'accountant', name: 'acc-payable' },
      ...(i.payables ? {} : { why: unreadable }),
    },
    {
      key: 'cashups', label: 'Cash-ups awaiting verification', n: i.accounting ? i.accounting.cashups.length : null,
      decides: 'Accountant who did not count the till', where: { target: 'cash.sessions', query: { view: 'sessions' } },
      ...(i.accounting ? {} : { why: unreadable }),
    },
    {
      key: 'imports', label: 'Imports validated and waiting to be committed', n: i.importsValidated,
      decides: 'Finance administrator', where: { target: 'imports', query: { status: 'validated' } },
      ...(i.importsValidated === null ? { why: unreadable } : {}),
    },
    {
      key: 'assets', label: 'Depreciation runs awaiting approval', n: i.assetRunsAwaiting,
      decides: 'Asset approver (not the preparer)', where: { workspace: 'accountant', name: 'acc-assets' },
      ...(i.assetRunsAwaiting === null ? { why: unreadable } : {}),
    },
    {
      key: 'disposals', label: 'Asset disposals awaiting approval', n: i.disposalsAwaiting,
      decides: 'Asset approver (not the preparer)', where: { workspace: 'accountant', name: 'acc-assets' },
      ...(i.disposalsAwaiting === null ? { why: unreadable } : {}),
    },
    {
      key: 'cutover', label: 'Data migration cut-overs in preparation, not yet signed off', n: i.cutoversPreparing,
      decides: 'Finance administrator (sign-off)', where: { workspace: 'accountant', name: 'acc-migration' },
      ...(i.cutoversPreparing === null ? { why: unreadable } : {}),
    },
  )
  return items
}

/** Items with something waiting first (largest first), then the empty ones, then the unreadable. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  const rank = (x: InboxItem) => (x.n === null ? 2 : x.n > 0 ? 0 : 1)
  return [...items].sort((a, b) => rank(a) - rank(b) || (b.n ?? 0) - (a.n ?? 0))
}

export const waitingTotal = (items: InboxItem[]): number => items.reduce((s, x) => s + (x.n ?? 0), 0)
