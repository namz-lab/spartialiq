/**
 * Reads behind Finance Access Administration (backend `src/routes/finance-users.js` and the finance
 * audit trail in `src/routes/finance-reports.js`). Writes go through `financeApi.updateFinanceUserAccess`,
 * the one write the access screen already uses.
 *
 * Nothing here decides access. `workspaces` / `home_workspace` on an access detail are read only if
 * the server sends them (see the backend gap in workspaces/administration/workspacePreview.ts).
 */
import api from '../../../services/api'
import type { AuditEvent, FinanceAccessDetail, FinanceUserList } from '../models/types'
import type { WorkspaceKey } from '../shell/workspaces'

const unwrap = <T>(r: { data?: { data?: T } & T }): T => (r.data?.data ?? r.data) as T

/** An access detail, with the server's workspace answer when the server sends one. */
export type AccessDetail = FinanceAccessDetail & { workspaces?: WorkspaceKey[]; home_workspace?: WorkspaceKey | null }

/** A trail row as the server sends it, including the fields the shared model leaves out. */
export type AccessEvent = AuditEvent & { actor_id?: string | null; details?: Record<string, unknown> | null }

const PAGE = 200

export const financeAccessApi = {
  /** Every staff account that may hold finance access, all pages (the server caps a page at 200). */
  async allUsers(q?: string): Promise<FinanceUserList> {
    const first = unwrap<FinanceUserList>(await api.get('/finance/users', { params: { limit: PAGE, offset: 0, ...(q ? { q } : {}) } }))
    const users = [...first.users]
    while (users.length < first.total) {
      const next = unwrap<FinanceUserList>(await api.get('/finance/users', { params: { limit: PAGE, offset: users.length, ...(q ? { q } : {}) } }))
      if (!next.users.length) break
      users.push(...next.users)
    }
    return { ...first, users, limit: users.length, offset: 0 }
  },
  async access(id: string): Promise<AccessDetail> {
    return unwrap(await api.get(`/finance/users/${id}/access`))
  },
  /** Changes to finance access (event FIN_PERMISSION), including refused attempts. */
  async changes(params: { from?: string; to?: string; actor_id?: string; entity_id?: string; limit?: number } = {}): Promise<AccessEvent[]> {
    const r = unwrap<{ events: AccessEvent[] }>(await api.get('/finance/audit', { params: { event: 'FIN_PERMISSION', limit: 500, ...params } }))
    return r.events
  },
}
