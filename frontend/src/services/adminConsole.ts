// src/services/adminConsole.ts
// Client for the IT Admin console API (backend src/routes/admin-console.js,
// migration 124).
//
// Same rules as the other service modules in this directory, deliberately:
//
//   • Errors PROPAGATE. A list that failed to load must never render as an
//     empty list — "no failed sign-ins" and "could not reach the server" are
//     different statements, and only one of them should reassure anybody
//     looking at a security screen.
//   • The wire shape stops here. Sections never learn that the audit table
//     calls a column `occurred_at`.
//   • Nothing is decided here. These calls record what the administrator did;
//     the server decides whether they may.

import api from './api'

/** Unwrap the {success, data} envelope every backend route returns. */
function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

/** Some endpoints carry a `meta` block alongside the rows (totals, counts). */
function paged<T, M>(r: { data?: { data?: T; meta?: M } }): { data: T; meta: M } {
  const body = r.data as { data?: T; meta?: M } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return { data: body.data, meta: (body.meta ?? {}) as M }
}

/**
 * Drop empty filter values before they reach the query string.
 *
 * Axios serialises `{ q: '' }` as `?q=`, which the backend's `isStr` treats as
 * absent anyway — but it also puts it in the browser's address bar, and the
 * address bar is what an admin copies and sends to a colleague.
 */
function params(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

// ── Overview ────────────────────────────────────────────────────────────

export interface AdminOverview {
  staff: { total: number; active: number; suspended: number; pending: number }
  citizens: number
  invites: { open: number; expired: number }
  sessions: { live: number; users: number }
  security: { failedLogins24h: number; ipBlocks: number; notable7d: number }
  audit: { events24h: number }
  outbox: { pending: number; failed: number }
  org: { vacancies: number }
  announcements: { live: number }
}

export async function getOverview(): Promise<AdminOverview> {
  return data<AdminOverview>(await api.get('/admin/overview'))
}

// ── Audit trail ─────────────────────────────────────────────────────────

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface AuditEvent {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_email: string | null
  actor_role: string | null
  event: string
  severity: Severity
  method: string | null
  path: string | null
  status: number | null
  duration_ms: number | null
  entity_type: string | null
  entity_id: string | null
  ip: string | null
  details: Record<string, unknown>
}

export interface AuditQuery {
  from?: string
  to?: string
  event?: string
  severity?: Severity | ''
  actor?: string
  entityType?: string
  entityId?: string
  failuresOnly?: boolean
  q?: string
  limit?: number
  offset?: number
}

export async function listAudit(query: AuditQuery = {}) {
  return paged<AuditEvent[], { total: number; limit: number; offset: number }>(
    await api.get('/admin/audit', {
      params: params({ ...query, failuresOnly: query.failuresOnly ? 'true' : undefined }),
    }),
  )
}

export interface AuditEventType { event: string; n: number; last_seen: string }

export async function listAuditEventTypes(): Promise<AuditEventType[]> {
  return data<AuditEventType[]>(await api.get('/admin/audit/events'))
}

/**
 * Download the current filter as CSV.
 *
 * `responseType: 'blob'` and an object URL rather than pointing the browser at
 * the endpoint: the session is an httpOnly cookie on /api, and a plain
 * `window.open` would work here but lose the axios error handling — a 403 on a
 * navigated download shows the JSON error as a downloaded file rather than
 * raising. Going through axios means a refusal is an exception the section can
 * report in place.
 */
export async function exportAudit(query: AuditQuery = {}): Promise<{ blob: Blob; rows: number; capped: boolean }> {
  const response = await api.get('/admin/audit/export', {
    params: params({ ...query, failuresOnly: query.failuresOnly ? 'true' : undefined }),
    responseType: 'blob',
  })
  const rows = Number(response.headers['x-row-count'] ?? 0)
  const limit = Number(response.headers['x-row-limit'] ?? 0)
  return { blob: response.data as Blob, rows, capped: limit > 0 && rows >= limit }
}

// ── Sessions ────────────────────────────────────────────────────────────

export interface AdminSession {
  id: string
  user_id: string
  email: string
  name: string | null
  role: string | null
  ip: string | null
  user_agent: string | null
  created_at: string
  last_used_at: string | null
  expires_at: string
  revoked_at: string | null
  current: boolean
}

export async function listSessions(opts: { user?: string; includeExpired?: boolean } = {}): Promise<AdminSession[]> {
  return data<AdminSession[]>(await api.get('/admin/sessions', {
    params: params({ user: opts.user, includeExpired: opts.includeExpired ? 'true' : undefined }),
  }))
}

export async function revokeSession(id: string): Promise<void> {
  await api.delete(`/admin/sessions/${id}`)
}

/** Sign one officer out of every device. Returns how many were ended. */
export async function revokeAllSessions(userId: string): Promise<number> {
  return data<{ revoked: number }>(await api.post(`/admin/users/${userId}/revoke-sessions`)).revoked
}

// ── Sign-in security ────────────────────────────────────────────────────

export type LoginFailureReason =
  | 'no_such_user' | 'bad_password' | 'suspended' | 'deleted'
  | 'locked_out' | 'mfa_failed' | 'ip_blocked'

export interface LoginAttempt {
  id: number
  attempted_at: string
  email: string
  user_id: string | null
  name: string | null
  role: string | null
  ip: string | null
  user_agent: string | null
  succeeded: boolean
  reason: LoginFailureReason | null
}

export interface LockedOut { email: string; failures: number; last_failure: string }

export async function listLoginAttempts(opts: { failuresOnly?: boolean; email?: string; from?: string; limit?: number } = {}) {
  return paged<LoginAttempt[], { lockedOut: LockedOut[]; limit: number; offset: number }>(
    await api.get('/admin/login-attempts', {
      params: params({ ...opts, failuresOnly: opts.failuresOnly ? 'true' : undefined }),
    }),
  )
}

export async function clearLockout(email: string): Promise<void> {
  await api.post('/admin/login-attempts/clear', { email })
}

export interface IpBlock {
  id: string
  cidr: string
  reason: string
  created_at: string
  expires_at: string | null
  released_at: string | null
  created_by_name: string | null
  released_by_name: string | null
}

export async function listIpBlocks(includeReleased = false): Promise<IpBlock[]> {
  return data<IpBlock[]>(await api.get('/admin/ip-blocks', {
    params: params({ includeReleased: includeReleased ? 'true' : undefined }),
  }))
}

export async function createIpBlock(input: { cidr: string; reason: string; expiresAt?: string | null }): Promise<IpBlock> {
  return data<IpBlock>(await api.post('/admin/ip-blocks', input))
}

export async function releaseIpBlock(id: string): Promise<void> {
  await api.delete(`/admin/ip-blocks/${id}`)
}

// ── Settings ────────────────────────────────────────────────────────────

export type SettingType = 'string' | 'number' | 'boolean' | 'json' | 'text'

export interface AdminSetting {
  key: string
  value: string | null
  value_type: SettingType
  category: string
  label: string
  description: string | null
  constraints: { min?: number; max?: number; choices?: string[] }
  /** true when the server reads this key and behaves differently. See the
   *  migration's comment: the console SAYS which is which, so an admin is
   *  never misled into thinking a record-only field switches something off. */
  enforced: boolean
  secret: boolean
  updated_at: string
  updated_by_name: string | null
}

export async function listSettings(): Promise<AdminSetting[]> {
  return data<AdminSetting[]>(await api.get('/admin/settings'))
}

/**
 * Save several settings as one transaction.
 *
 * The whole form goes in one call because the backend applies it atomically: a
 * security page that saved four of six values and then failed would leave the
 * council's policy in a state nobody chose.
 */
export async function saveSettings(settings: Record<string, unknown>): Promise<number> {
  return data<{ updated: number }>(await api.put('/admin/settings', { settings })).updated
}

/** What the server says is wrong, key by key, when a save is refused. */
export interface SettingsRejection { key: string; why: string }

export function rejectionsFrom(error: unknown): SettingsRejection[] {
  const payload = (error as { response?: { data?: { data?: { rejected?: SettingsRejection[] } } } })
    ?.response?.data?.data?.rejected
  return Array.isArray(payload) ? payload : []
}

// ── Permissions ─────────────────────────────────────────────────────────

export interface RoleDescription {
  id: string
  name: string
  short: string
  summary: string
  capabilities: string[]
}

export interface CapabilityRow {
  id: string
  group: string
  label: string
  routes: string[]
  granted: Record<string, boolean>
}

export async function getPermissions(): Promise<{ roles: RoleDescription[]; capabilities: CapabilityRow[] }> {
  return data<{ roles: RoleDescription[]; capabilities: CapabilityRow[] }>(
    await api.get('/admin/permissions'),
  )
}

// ── System ──────────────────────────────────────────────────────────────

export interface SystemHealth {
  database: {
    name: string; version: string; size: string; sizeBytes: number
    connections: number; maxConnections: number; uptimeSeconds: number; postgis: boolean
  }
  migrations: { applied: number; latest: string | null } | null
  process: { node: string; uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; env: string }
  host: {
    platform: string; cpus: number; totalMemBytes: number; freeMemBytes: number
    loadAvg: number[]; loadAvgSupported: boolean
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return data<SystemHealth>(await api.get('/admin/system/health'))
}

export interface TableInfo {
  schema: string
  name: string
  rows_approx: number
  bytes: number
  size: string
  last_autovacuum: string | null
  last_analyze: string | null
}

export async function listTables(): Promise<TableInfo[]> {
  return data<TableInfo[]>(await api.get('/admin/system/tables'))
}

export interface BackupFile { name: string; kind: 'database' | 'uploads'; bytes: number; modifiedAt: string }

export interface BackupReport {
  directory: string
  exists: boolean
  files: BackupFile[]
  newestAgeHours?: number | null
  note?: string
}

export async function getBackups(): Promise<BackupReport> {
  return data<BackupReport>(await api.get('/admin/backups'))
}

// ── Portal usage ────────────────────────────────────────────────────────

export type UsageWindow = 7 | 30

export interface UsageReport {
  days: UsageWindow
  totalViews: number
  distinctVisitors: number
  /** One entry per calendar day in the window, oldest first, zero days included. */
  daily: { day: string; views: number; visitors: number }[]
  /** Route patterns, most viewed first. */
  topPaths: { path: string; views: number; visitors: number }[]
}

export async function getUsage(days: UsageWindow): Promise<UsageReport> {
  return data<UsageReport>(await api.get('/admin/usage', { params: { days } }))
}

// ── Outbox ──────────────────────────────────────────────────────────────

export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

export interface OutboxMessage {
  id: string
  email: string | null
  channel: string
  kind: string
  subject: string
  status: OutboxStatus
  attempts: number
  last_error: string | null
  scheduled_at: string
  sent_at: string | null
  created_at: string
}

/**
 * What happens to a message once it is queued.
 *
 * `delivers` is the load-bearing field: on the `console` transport the worker
 * advances a row to `sent` after printing it to the server log, so "sent" does
 * NOT mean delivered. An administrator answering "were they told?" has to know
 * which of the two happened.
 */
export interface OutboxDelivery {
  workerRunning: boolean
  transport: string
  delivers: boolean
}

export async function listOutbox(opts: { status?: OutboxStatus | ''; q?: string; limit?: number } = {}) {
  return paged<OutboxMessage[], {
    counts: Partial<Record<OutboxStatus, number>>
    limit: number
    offset: number
    delivery?: OutboxDelivery
  }>(await api.get('/admin/outbox', { params: params(opts) }))
}

export async function retryMessage(id: string): Promise<void> {
  await api.post(`/admin/outbox/${id}/retry`)
}

export async function cancelMessage(id: string): Promise<void> {
  await api.post(`/admin/outbox/${id}/cancel`)
}

// ── Announcements ───────────────────────────────────────────────────────

export type AnnouncementLevel = 'info' | 'warning' | 'critical'
export type AnnouncementAudience = 'all' | 'staff' | 'admin'

export interface Announcement {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  audience: AnnouncementAudience
  starts_at: string
  ends_at: string | null
  created_at: string
  withdrawn_at: string | null
  created_by_name: string | null
}

export async function listAnnouncements(all = false): Promise<Announcement[]> {
  return data<Announcement[]>(await api.get('/admin/announcements', {
    params: params({ all: all ? 'true' : undefined }),
  }))
}

export interface AnnouncementInput {
  title: string
  body: string
  level: AnnouncementLevel
  audience: AnnouncementAudience
  startsAt?: string | null
  endsAt?: string | null
}

export async function createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
  return data<Announcement>(await api.post('/admin/announcements', input))
}

export async function updateAnnouncement(id: string, input: Partial<AnnouncementInput>): Promise<Announcement> {
  return data<Announcement>(await api.patch(`/admin/announcements/${id}`, input))
}

export async function withdrawAnnouncement(id: string): Promise<void> {
  await api.delete(`/admin/announcements/${id}`)
}

// ── Organisation structure ──────────────────────────────────────────────

export interface OrgPosition {
  id: string
  title: string
  department: string | null
  system_role: string | null
  holder_id: string | null
  holder_name: string | null
  holder_email: string | null
  holder_role: string | null
  holder_status: string | null
  reports_to: string | null
  sort_order: number
  /** The post carries one role and its holder's account carries another. The
   *  access problem an admin is asked to find, invisible in a user list. */
  roleMismatch: boolean
}

export async function listOrg(): Promise<OrgPosition[]> {
  return data<OrgPosition[]>(await api.get('/admin/org'))
}

export interface OrgInput {
  title?: string
  department?: string | null
  systemRole?: string | null
  holderId?: string | null
  reportsTo?: string | null
  sortOrder?: number
}

export async function createPosition(input: OrgInput): Promise<{ id: string }> {
  return data<{ id: string }>(await api.post('/admin/org', input))
}

export async function updatePosition(id: string, input: OrgInput): Promise<{ id: string }> {
  return data<{ id: string }>(await api.patch(`/admin/org/${id}`, input))
}

export async function deletePosition(id: string): Promise<void> {
  await api.delete(`/admin/org/${id}`)
}

// ── Staff and invitations (existing endpoints, typed here for one import) ──

export interface StaffUser {
  id: string
  email: string
  name: string
  role: string
  organization: string | null
  jobTitle: string | null
  department: string | null
  applicantType: string | null
  active: boolean
  status: string
  createdAt: string
  lastLogin: string | null
}

export async function listStaff(staff = true): Promise<StaffUser[]> {
  return data<StaffUser[]>(await api.get('/admin/users', { params: { staff } }))
}

export interface Invite {
  id: string
  token: string
  email: string
  role: string
  jobTitle: string | null
  department: string | null
  used: boolean
  usedAt: string | null
  expiresAt: string
  createdAt: string
  invitedBy: string | null
  inviteUrl: string
}

export async function listInvites(): Promise<Invite[]> {
  return data<Invite[]>(await api.get('/admin/invites'))
}

/**
 * A human sentence for whatever went wrong.
 *
 * Every section shows failures in place rather than in an alert, and they all
 * need the same "server said X, otherwise say something true" logic. The
 * fallback is deliberately not "Something went wrong": it names the action, so
 * the admin can tell a failed save from a failed load.
 */
export function errorMessage(error: unknown, fallback = 'The request could not be completed.'): string {
  const response = (error as { response?: { status?: number; data?: { message?: string; error?: string } } }).response
  if (response?.data?.message) return response.data.message
  if (response?.status === 403) return 'You do not have permission for this action.'
  if (response?.status === 404) return 'That record no longer exists. Refresh to see the current list.'
  if (response?.status === 409) return 'That action does not apply to this record in its current state.'
  if (response?.status === 503) return 'The portal is in maintenance mode.'
  if ((error as { code?: string }).code === 'ERR_NETWORK') return 'Could not reach the server. Check the connection and retry.'
  return fallback
}
