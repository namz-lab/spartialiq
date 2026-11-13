// @vitest-environment happy-dom
//
// Entering the finance workspaces.
//
// The server decides which workspaces a person holds (`/finance/me`); these guards only route on
// that answer. They are pinned because each failure here is a person locked out of their work or
// sent somewhere that is not theirs:
//   - while the migration lasts, a person whose workspace is not built yet reaches the previous
//     console, never a blank page or a loop (spec §13.7);
//   - a direct URL to a workspace the server did not grant goes home with a sentence saying so;
//   - an old `?section=` link opens the screen that replaced it, or explains;
//   - a failed identity read does not bounce between /finance and a workspace forever;
//   - the next person on a shared machine is routed on THEIR identity, not the last one's.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RouteLocationNormalized } from 'vue-router'

vi.mock('../api/financeApi', () => ({ financeApi: { identity: vi.fn() } }))

import { financeApi } from '../api/financeApi'
import { useFinanceStore } from '../stores/finance'
import { registerWorkspace, __resetRegistry } from '../shell/workspaces'
import {
  financeEntry, guardWorkspace, guardUnknownWorkspace, __setWorkspacesEnabled,
  CONSOLE_PATH, NO_WORKSPACE_PATH,
} from '../shell/workspaceGuard'
import type { FinanceIdentity } from '../models/types'

const identity = (workspaces: string[] | undefined, home: string | null = workspaces?.[0] ?? null) => ({
  user_id: 'u1', role: 'x', authority_id: 1, permissions: [], department_scope: [], catalogue: [],
  workspaces, home_workspace: home,
}) as unknown as FinanceIdentity

const to = (path: string, query: Record<string, string> = {}, financeWorkspace?: string) =>
  ({ path, query, params: {}, meta: financeWorkspace ? { financeWorkspace } : {} }) as unknown as RouteLocationNormalized

const identityMock = vi.mocked(financeApi.identity)

beforeEach(() => {
  setActivePinia(createPinia())
  __resetRegistry()
  __setWorkspacesEnabled(true)
  identityMock.mockReset()
  registerWorkspace({ key: 'cashier', routes: [], serves: { 'cash.counter': 'fin-cashier-counter', 'cash.sessions': 'fin-cashier-sessions' } })
})

describe('/finance — where a person lands', () => {
  it('lands on the home workspace when it is built', async () => {
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await financeEntry(to('/finance'))).toEqual({ path: '/finance/cashier' })
  })

  it('reaches the previous console while their home workspace is not built yet', async () => {
    identityMock.mockResolvedValue(identity(['accountant']))
    expect(await financeEntry(to('/finance'))).toEqual({ path: CONSOLE_PATH, query: {} })
  })

  it('is told plainly when no permission opens any finance workspace', async () => {
    identityMock.mockResolvedValue(identity([], null))
    expect(await financeEntry(to('/finance'))).toEqual({ path: NO_WORKSPACE_PATH })
  })

  it('reaches the console, which shows the error and Retry, when the identity cannot be read', async () => {
    identityMock.mockRejectedValue(new Error('network'))
    expect(await financeEntry(to('/finance'))).toEqual({ path: CONSOLE_PATH, query: {} })
  })

  it('reaches the console when the server predates the workspace catalogue', async () => {
    identityMock.mockResolvedValue(identity(undefined))
    expect(await financeEntry(to('/finance', { section: 'rates' })))
      .toEqual({ path: CONSOLE_PATH, query: { section: 'rates' } })
  })

  it('sends every finance URL to the console when the workspaces are switched off', async () => {
    __setWorkspacesEnabled(false)
    expect(await financeEntry(to('/finance', { section: 'rates' })))
      .toEqual({ path: CONSOLE_PATH, query: { section: 'rates' } })
    expect(await guardWorkspace(to('/finance/cashier', {}, 'cashier'))).toEqual({ path: CONSOLE_PATH, query: {} })
    expect(identityMock).not.toHaveBeenCalled()
  })
})

describe('/finance?section= — links written for the previous console', () => {
  it('opens the screen that replaced the section, keeping its filters', async () => {
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await financeEntry(to('/finance', { section: 'cash', view: 'sessions', status: 'open', junk: 'x' })))
      .toEqual({ name: 'fin-cashier-counter', query: { view: 'sessions', status: 'open' } })
  })

  it('goes home with an explanation, and drops the filters, when none of their workspaces has it', async () => {
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await financeEntry(to('/finance', { section: 'budget', status: 'submitted' })))
      .toEqual({ path: '/finance/cashier', query: { notice: 'unavailable' } })
  })

  it('keeps the previous behaviour for someone whose workspace is not built yet', async () => {
    identityMock.mockResolvedValue(identity(['revenue']))
    expect(await financeEntry(to('/finance', { section: 'rates', state: 'draft' })))
      .toEqual({ path: CONSOLE_PATH, query: { section: 'rates', state: 'draft' } })
  })

  it('treats an unknown section like a missing one', async () => {
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await financeEntry(to('/finance', { section: 'nonsense' })))
      .toEqual({ path: '/finance/cashier', query: { notice: 'unavailable' } })
  })
})

describe('/finance/<workspace> — direct addresses', () => {
  it('admits a workspace the server granted', async () => {
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await guardWorkspace(to('/finance/cashier', {}, 'cashier'))).toBe(true)
  })

  it('sends a person home, saying why, from a built workspace that is not theirs', async () => {
    registerWorkspace({ key: 'accountant', routes: [], serves: {} })
    identityMock.mockResolvedValue(identity(['cashier']))
    expect(await guardWorkspace(to('/finance/accountant', {}, 'accountant')))
      .toEqual({ path: '/finance/cashier', query: { notice: 'not-yours' } })
  })

  it('does not loop when the identity cannot be read: the frame shows the error', async () => {
    identityMock.mockRejectedValue(new Error('network'))
    expect(await guardWorkspace(to('/finance/cashier', {}, 'cashier'))).toBe(true)
  })

  it('distinguishes a workspace not built yet from one that is not theirs', async () => {
    identityMock.mockResolvedValue(identity(['accountant']))
    expect(await guardUnknownWorkspace(to('/finance/accountant')))
      .toEqual({ path: CONSOLE_PATH, query: { notice: 'not-built' } })
    expect(await guardUnknownWorkspace(to('/finance/publisher')))
      .toEqual({ path: CONSOLE_PATH, query: { notice: 'not-yours' } })
  })

  it('routes the next person on a shared machine on their own identity', async () => {
    identityMock.mockResolvedValueOnce(identity(['cashier']))
    expect(await guardWorkspace(to('/finance/cashier', {}, 'cashier'))).toBe(true)
    useFinanceStore().reset()
    registerWorkspace({ key: 'accountant', routes: [], serves: {} })
    identityMock.mockResolvedValueOnce(identity(['accountant']))
    expect(await guardWorkspace(to('/finance/cashier', {}, 'cashier')))
      .toEqual({ path: '/finance/accountant', query: { notice: 'not-yours' } })
    expect(identityMock).toHaveBeenCalledTimes(2)
  })
})
