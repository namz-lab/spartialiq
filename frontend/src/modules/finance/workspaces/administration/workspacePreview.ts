/**
 * Access administration helpers: which workspaces a person's access would open, duty conflicts,
 * and the access-change trail read as before / after.
 *
 * WORKSPACES. Which workspaces a person may open is decided by the SERVER at sign-in
 * (`GET /finance/me`, backend `src/config/financeWorkspaces.js`), and the route guard reads only that.
 * `GET /finance/users/:id/access` does not yet return the answer for ANOTHER person (backend gap),
 * so the administrator's effective-access screen shows a PREVIEW made from the same published
 * admission rules (docs/finance/WORKSPACE-ACCESS.md). It is labelled as a preview, it is never used
 * to route anyone, and as soon as the access detail carries `workspaces` the screen shows the
 * server's answer instead (`workspacesOf`).
 */
import type { FinancePermission } from '../../models/types'
import { WORKSPACE_KEYS, type WorkspaceKey } from '../../shell/workspaces'
import type { AccessDetail, AccessEvent } from '../../api/financeAccessApi'

const READ_ONLY = /\.(view|export|view_counterparty|view_restricted|export_restricted)$/
const APPROVALS = [
  'finance.budget.approve', 'finance.revision.approve', 'finance.project.approve',
  'finance.publication.approve', 'finance.rates.tariff.approve',
]

/** The admission rule of each workspace, in words, as WORKSPACE-ACCESS.md states it. */
export const ADMISSION: Record<WorkspaceKey, string> = {
  manager: 'holds finance.config.manage',
  officer: 'holds finance.import.upload',
  accountant: 'holds finance.ledger.voucher.post',
  accounting: 'holds finance.audit.view and finance.ledger.view, no audit export, and nothing that writes',
  budget: 'holds finance.budget.prepare and is not departmental',
  department: 'has a departmental scope, or the role dept_head',
  committee: 'holds any committee approval (budget, revision, project, publication, tariff)',
  cashier: 'holds finance.cash.session.operate or finance.cash.session.supervise',
  revenue: 'holds finance.rates.bill.prepare or finance.rates.valuation.manage',
  publisher: 'holds finance.publication.publish',
  audit: 'holds finance.audit.export and finance.report.export_restricted',
  administration: 'holds finance.users.manage_finance_roles',
}

const HOME_FOR: Partial<Record<string, WorkspaceKey>> = {
  finance_admin: 'manager', finance_officer: 'officer', accountant: 'accountant', accounting_officer: 'accounting',
  budget_officer: 'budget', dept_head: 'department', finance_committee: 'committee', cashier: 'cashier',
  cash_supervisor: 'cashier', revenue_officer: 'revenue', publisher: 'publisher', auditor: 'audit', admin: 'administration',
}

/** A preview of the server's catalogue. Display only; never routes anyone. */
export function previewWorkspaces(who: { role: string; permissions: Iterable<string>; scoped: boolean }): { workspaces: WorkspaceKey[]; home: WorkspaceKey | null } {
  const h = new Set(who.permissions)
  const departmental = who.scoped || who.role === 'dept_head'
  const admits: Record<WorkspaceKey, boolean> = {
    manager: h.has('finance.config.manage'),
    officer: h.has('finance.import.upload'),
    accountant: h.has('finance.ledger.voucher.post'),
    accounting: h.has('finance.audit.view') && h.has('finance.ledger.view') && !h.has('finance.audit.export') && [...h].every((c) => READ_ONLY.test(c)),
    budget: h.has('finance.budget.prepare') && !departmental,
    department: departmental,
    committee: APPROVALS.some((c) => h.has(c)),
    cashier: h.has('finance.cash.session.operate') || h.has('finance.cash.session.supervise'),
    revenue: h.has('finance.rates.bill.prepare') || h.has('finance.rates.valuation.manage'),
    publisher: h.has('finance.publication.publish'),
    audit: h.has('finance.audit.export') && h.has('finance.report.export_restricted'),
    administration: h.has('finance.users.manage_finance_roles'),
  }
  const workspaces = WORKSPACE_KEYS.filter((k) => admits[k])
  const own = HOME_FOR[who.role]
  return { workspaces, home: own && workspaces.includes(own) ? own : workspaces[0] ?? null }
}

/** The server's answer when the access detail carries it, else the labelled preview. */
export function workspacesOf(detail: AccessDetail): { workspaces: WorkspaceKey[]; home: WorkspaceKey | null; fromServer: boolean } {
  if (Array.isArray(detail.workspaces)) return { workspaces: detail.workspaces, home: detail.home_workspace ?? null, fromServer: true }
  return { ...previewWorkspaces({ role: detail.user.role, permissions: detail.permissions, scoped: detail.department_scope.length > 0 }), fromServer: false }
}

export interface DutyConflict { rule: 'approve-and-publish' | 'admin-authority'; text: string }

/**
 * Separation of duties over an effective permission set, by the catalogue's own flags: the same
 * rule the access screen shows and the server enforces on save (migration 200). An explanation, not
 * the control.
 */
export function dutyConflicts(role: string, permissions: string[], catalogue: FinancePermission[]): DutyConflict[] {
  const held = catalogue.filter((p) => permissions.includes(p.code))
  const out: DutyConflict[] = []
  const approval = held.find((p) => p.is_approval)
  const publication = held.find((p) => p.is_publication)
  if (approval && publication) {
    out.push({ rule: 'approve-and-publish', text: `Holds both "${approval.label}" and "${publication.label}": one person would approve a release and publish it.` })
  }
  if (role === 'admin') {
    const authority = held.find((p) => p.is_approval || p.is_publication || p.is_restricted)
    if (authority) out.push({ rule: 'admin-authority', text: `The IT administrator holds "${authority.label}". The technical administrator should hold no financial authority.` })
  }
  return out
}

/** Where a permission comes from for this person. A denial always wins over the role and a grant. */
export function sourceOf(code: string, detail: AccessDetail): 'role' | 'granted' | 'denied' | 'none' {
  const o = detail.overrides.find((x) => x.permission_code === code)
  if (o?.effect === 'deny') return 'denied'
  if (o?.effect === 'grant') return detail.role_permissions.includes(code) ? 'role' : 'granted'
  return detail.role_permissions.includes(code) ? 'role' : 'none'
}

// ── The access-change trail ────────────────────────────────────────────────────────────────────

type Summary = { role?: string; overrides?: { permission_code: string; effect: string; expires_at?: string | null }[]; department_scope?: { code: string }[]; permissions?: string[] }

export interface AccessChange {
  id: string
  at: string
  actor: string
  target: string | null
  refused: boolean
  status: number | null
  refusal: string | null
  reason: string | null
  lines: string[]
}

const obj = (v: unknown): Summary | null => (v && typeof v === 'object' ? v as Summary : null)

/** One FIN_PERMISSION row as what changed, in sentences. */
export function readChange(e: AccessEvent): AccessChange {
  const d = (e.details ?? {}) as Record<string, unknown>
  const before = obj(d.before)
  const after = obj(d.after)
  const attempted = obj(d.attempted)
  const lines: string[] = []
  const target = after ?? attempted
  if (before && target) {
    if (target.role && before.role !== target.role) lines.push(`Role ${before.role ?? '—'} → ${target.role}`)
    const key = (o: { permission_code: string; effect: string }) => `${o.effect} ${o.permission_code}`
    const was = new Set((before.overrides ?? []).map(key))
    const now = new Set((target.overrides ?? []).map(key))
    for (const k of now) if (!was.has(k)) lines.push(`Added override: ${k}`)
    for (const k of was) if (!now.has(k)) lines.push(`Removed override: ${k}`)
    if (after) {
      const sb = (before.department_scope ?? []).map((s) => s.code).join(', ')
      const sa = (after.department_scope ?? []).map((s) => s.code).join(', ')
      if (sb !== sa) lines.push(`Departmental scope ${sb || 'none'} → ${sa || 'none'}`)
      const pb = new Set(before.permissions ?? [])
      const pa = new Set(after.permissions ?? [])
      const gained = [...pa].filter((p) => !pb.has(p))
      const lost = [...pb].filter((p) => !pa.has(p))
      if (gained.length) lines.push(`Now holds: ${gained.join(', ')}`)
      if (lost.length) lines.push(`No longer holds: ${lost.join(', ')}`)
    }
  }
  const conflict = d.conflict && typeof d.conflict === 'object' ? Object.values(d.conflict as Record<string, unknown>).filter((v) => typeof v === 'string').join(' and ') : ''
  return {
    id: e.id,
    at: e.occurred_at,
    actor: e.actor_email ?? '—',
    target: e.entity_id,
    refused: (e.status ?? 0) >= 400,
    status: e.status,
    refusal: typeof d.refused === 'string' ? `${d.refused.replace(/_/g, ' ')}${conflict ? `: ${conflict}` : ''}` : null,
    reason: typeof d.reason === 'string' ? d.reason : null,
    lines,
  }
}
