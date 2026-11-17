// @vitest-environment happy-dom
//
// Finance Access Administration. Pinned:
//   - the workspace preview follows the published admission rules, and the server's own answer
//     replaces it whenever the access detail carries one;
//   - duty conflicts are named by the catalogue flags (approve + publish; admin with authority);
//   - each permission's source is right, and a denial wins;
//   - the access log reads before / after into sentences, and marks refusals;
//   - the staff list is read across every page.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

import api from '@/services/api'
import { financeAccessApi } from '../api/financeAccessApi'
import { previewWorkspaces, workspacesOf, dutyConflicts, sourceOf, readChange } from '../workspaces/administration/workspacePreview'
import { byRole } from '../workspaces/administration/dashboard'
import '../workspaces/administration/routes'
import { registrationOf } from '../shell/workspaces'

const get = api.get as unknown as ReturnType<typeof vi.fn>

const COMMITTEE = ['finance.actuals.view', 'finance.audit.view', 'finance.budget.approve', 'finance.budget.view', 'finance.ledger.close_year',
  'finance.ledger.view', 'finance.project.approve', 'finance.publication.approve', 'finance.rates.tariff.approve', 'finance.revision.approve']
const ADMIN = ['finance.actuals.view', 'finance.audit.export', 'finance.audit.view', 'finance.budget.view', 'finance.users.manage_finance_roles']

const detail = (over: Record<string, unknown> = {}) => ({
  user: { id: 'u1', email: 'a@vungu', name: 'A', role: 'revenue_officer', department: null, job_title: null, active: true, status: 'active' },
  role_permissions: ['finance.rates.bill.prepare', 'finance.rates.view'],
  overrides: [] as unknown[], department_scope: [] as unknown[], permissions: ['finance.rates.bill.prepare', 'finance.rates.view'], ...over,
}) as never

const cat = (code: string, flags: Partial<{ is_approval: boolean; is_publication: boolean; is_restricted: boolean }> = {}) =>
  ({ code, label: code, category: 'x', is_approval: false, is_publication: false, is_restricted: false, description: null, ...flags })

beforeEach(() => { vi.clearAllMocks() })

describe('which workspaces an access opens', () => {
  it('previews the committee and administration roles as the catalogue admits them', () => {
    expect(previewWorkspaces({ role: 'finance_committee', permissions: COMMITTEE, scoped: false })).toEqual({ workspaces: ['committee'], home: 'committee' })
    expect(previewWorkspaces({ role: 'admin', permissions: ADMIN, scoped: false })).toEqual({ workspaces: ['administration'], home: 'administration' })
  })

  it('keeps the home on the role when an override adds a workspace', () => {
    const p = previewWorkspaces({ role: 'revenue_officer', permissions: ['finance.rates.bill.prepare', 'finance.cash.session.operate'], scoped: false })
    expect(p).toEqual({ workspaces: ['cashier', 'revenue'], home: 'revenue' })
  })

  it('confines a scoped preparer to Department Finance', () => {
    expect(previewWorkspaces({ role: 'budget_officer', permissions: ['finance.budget.prepare'], scoped: true }).workspaces).toEqual(['department'])
  })

  it('uses the server answer when the access detail carries it', () => {
    const w = workspacesOf({ ...(detail() as object), workspaces: ['revenue'], home_workspace: 'revenue' } as never)
    expect(w).toEqual({ workspaces: ['revenue'], home: 'revenue', fromServer: true })
    expect(workspacesOf(detail()).fromServer).toBe(false)
  })
})

describe('duties and sources', () => {
  const catalogue = [cat('a.approve', { is_approval: true }), cat('p.publish', { is_publication: true }), cat('r.view', { is_restricted: true }), cat('x.view')]

  it('names an approve-and-publish conflict, and finance authority held by the IT administrator', () => {
    expect(dutyConflicts('publisher', ['a.approve', 'p.publish'], catalogue).map((c) => c.rule)).toEqual(['approve-and-publish'])
    expect(dutyConflicts('admin', ['r.view'], catalogue).map((c) => c.rule)).toEqual(['admin-authority'])
    expect(dutyConflicts('admin', ['x.view'], catalogue)).toEqual([])
  })

  it('says where each permission comes from, a denial winning', () => {
    const d = detail({ overrides: [
      { permission_code: 'finance.cash.session.operate', effect: 'grant' },
      { permission_code: 'finance.rates.view', effect: 'deny' },
    ] })
    expect(sourceOf('finance.cash.session.operate', d)).toBe('granted')
    expect(sourceOf('finance.rates.view', d)).toBe('denied')
    expect(sourceOf('finance.rates.bill.prepare', d)).toBe('role')
  })
})

describe('the access log', () => {
  const ev = (status: number, details: Record<string, unknown>) => ({
    id: 'e1', occurred_at: '2026-11-10T08:00:00Z', actor_email: 'it@vungu', actor_role: 'admin', event: 'FIN_PERMISSION', severity: 'high',
    method: 'PUT', path: '/api/finance/users/u1/access', status, entity_type: 'finance_user_access', entity_id: 'u1', ip: null, details,
  }) as never

  it('reads a saved change as what was added and removed', () => {
    const c = readChange(ev(200, {
      reason: 'Relief cashier for December',
      before: { role: 'revenue_officer', overrides: [], department_scope: [], permissions: ['finance.rates.view'] },
      after: { role: 'revenue_officer', overrides: [{ permission_code: 'finance.cash.session.operate', effect: 'grant' }], department_scope: [{ code: 'TRE' }], permissions: ['finance.rates.view', 'finance.cash.session.operate'] },
    }))
    expect(c.refused).toBe(false)
    expect(c.reason).toBe('Relief cashier for December')
    expect(c.lines).toEqual(expect.arrayContaining(['Added override: grant finance.cash.session.operate', 'Departmental scope none → TRE', 'Now holds: finance.cash.session.operate']))
  })

  it('marks a refused attempt and says why', () => {
    const c = readChange(ev(409, {
      refused: 'separation_of_duties', conflict: { approval: 'finance.publication.approve', publication: 'finance.publication.publish' },
      attempted: { role: 'publisher', overrides: [{ permission_code: 'finance.publication.approve', effect: 'grant' }] },
      before: { role: 'publisher', overrides: [] },
    }))
    expect(c.refused).toBe(true)
    expect(c.refusal).toContain('separation of duties')
    expect(c.lines).toContain('Added override: grant finance.publication.approve')
  })
})

describe('reads', () => {
  it('reads every page of the staff list', async () => {
    const u = (i: number) => ({ id: `u${i}`, email: '', name: `N${i}`, role: i % 2 ? 'cashier' : 'auditor', department: null, job_title: null, active: true, status: null, override_count: 0, scope_count: 0 })
    get.mockResolvedValueOnce({ data: { data: { users: Array.from({ length: 200 }, (_, i) => u(i)), total: 250, limit: 200, offset: 0, roles: [] } } })
    get.mockResolvedValueOnce({ data: { data: { users: Array.from({ length: 50 }, (_, i) => u(200 + i)), total: 250, limit: 200, offset: 200, roles: [] } } })
    const all = await financeAccessApi.allUsers()
    expect(all.users).toHaveLength(250)
    expect(get).toHaveBeenLastCalledWith('/finance/users', { params: { limit: 200, offset: 200 } })
    expect(byRole(all)).toEqual([{ role: 'auditor', n: 125 }, { role: 'cashier', n: 125 }])
  })

  it('reads access changes from the finance trail only', async () => {
    get.mockResolvedValueOnce({ data: { data: { events: [] } } })
    await financeAccessApi.changes({ from: '2026-08-01' })
    expect(get).toHaveBeenCalledWith('/finance/audit', { params: { event: 'FIN_PERMISSION', limit: 500, from: '2026-08-01' } })
  })

  it('registers the workspace with the access and permissions targets', () => {
    expect(registrationOf('administration')?.serves).toEqual({ access: 'adm-users', permissions: 'adm-roles' })
  })
})
