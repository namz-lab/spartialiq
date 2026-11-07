// src/services/planningClerk.ts
// Client for the Planning Clerk registers API (backend
// src/routes/planning-clerk.js, migration 125).
//
// Same rules as the other service modules in this directory, deliberately:
//
//   • Errors PROPAGATE. A register that failed to load must never render as
//     an empty register — "no acknowledgement was sent" and "could not reach
//     the server" are different statements, and only one of them should
//     reassure a clerk who is about to tell an applicant their letter went.
//   • The wire shape stops here. Sections never learn that the correspondence
//     table calls its date column `logged_at`.
//   • Nothing is decided here. The server owns every rule; this module's job
//     is to carry the answer, including the refusals, back intact.
//
// SUPERSEDES the localStorage half of usePlanningClerkCase.ts. Seven of these
// nine registers used to live in one browser's local storage, where clearing
// the cache destroyed the council's proof of statutory notice and a second
// clerk saw an empty book.

import api from './api'

// ── Envelope ────────────────────────────────────────────────────────────

function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

function paged<T, M>(r: { data?: { data?: T; meta?: M } }): { data: T; meta: M } {
  const body = r.data as { data?: T; meta?: M } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return { data: body.data, meta: (body.meta ?? {}) as M }
}

/**
 * Drop empty filter values before they reach the query string.
 *
 * Axios serialises `{ q: '' }` as `?q=`, which the backend treats as absent
 * anyway — but it also puts it in the address bar, and the address bar is
 * what a clerk copies and sends to the planner.
 */
function params(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

/**
 * The server's refusal, said as the clerk should read it.
 *
 * The register endpoints answer three different ways when they say no:
 * `fields` for a form that is wrong, `message` for a constraint the database
 * refused in words, and a bare code for everything else. A component that
 * only read `error` would show `rejected` to a clerk who needs to be told the
 * file is already signed out.
 */
export interface ClerkApiError extends Error {
  fields?: Record<string, string>
  status?: number
}

export function errorMessage(err: unknown, fallback = 'The register could not be updated.'): string {
  const response = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response
  const body = response?.data
  if (typeof body?.message === 'string' && body.message) return body.message
  const fields = body?.fields as Record<string, string> | undefined
  if (fields && Object.keys(fields).length) {
    // "ref_no is required, party must not be blank" — the clerk sees which
    // boxes, in the order the form shows them.
    return Object.entries(fields)
      .map(([name, why]) => `${name.replace(/_/g, ' ')} ${why}`)
      .join('; ')
  }
  if (response?.status === 403) return 'Your role may read this register but not write to it.'
  if (response?.status === 401) return 'Your session has expired. Sign in again.'
  return err instanceof Error && err.message ? err.message : fallback
}

/** The per-field errors, for a form that wants to mark the boxes themselves. */
export function errorFields(err: unknown): Record<string, string> {
  const body = (err as { response?: { data?: { fields?: Record<string, string> } } })
    ?.response?.data?.fields
  return body && typeof body === 'object' ? body : {}
}

// ── The registers ───────────────────────────────────────────────────────

export const REGISTER_KEYS = [
  'correspondence', 'receipts', 'acknowledgements', 'dispatches', 'refusals',
  'certificates', 'abutters', 'movements', 'inspections',
] as const

export type RegisterKey = (typeof REGISTER_KEYS)[number]

export type Currency = 'USD' | 'ZWG'
export type SentMethod = 'registered_post' | 'ordinary_post' | 'email' | 'hand' | 'courier'

/** What every register row carries, whichever register it came from. */
export interface RegisterRowBase {
  id: string
  permit_application_id: string | null
  notes: string | null
  voided_at: string | null
  voided_reason: string | null
  created_at: string
  updated_at: string
  /** Joined from the permit, so a register row can name its file. */
  tpd_reference?: string | null
  dev_register_no?: string | null
  stand_number?: string | null
  applicant_name?: string | null
  permit_status?: string | null
}

export interface Correspondence extends RegisterRowBase {
  direction: 'in' | 'out'
  logged_at: string
  ref_no: string
  party: string
  subject: string
  channel: 'letter' | 'email' | 'phone' | 'in_person' | 'fax'
  attached_doc_ref: string | null
  logged_by_name: string
}

export type FeeKind =
  | 'application' | 'public_notice' | 'plan_scrutiny' | 'inspection'
  | 'occupation' | 'appeal' | 'search' | 'copies' | 'other'

export interface FeeReceipt extends RegisterRowBase {
  receipt_no: string
  fee_kind: FeeKind
  payer_name: string
  /** Postgres returns NUMERIC as a string; never assume it is a number. */
  amount: string
  currency: Currency
  paid_at: string
  payment_method: 'cash' | 'ecocash' | 'eft' | 'cheque' | 'card'
  reference: string | null
  issued_by_name: string
}

export interface Acknowledgement extends RegisterRowBase {
  letter_no: string
  application_register_no: string | null
  received_at: string
  due_by: string
  determination_due_by: string | null
  sent_at: string | null
  sent_method: SentMethod | null
  recipient: string
  drafted_by_name: string
}

export interface Dispatch extends RegisterRowBase {
  dispatched_at: string
  delivery_method: 'collected' | 'registered_post' | 'courier' | 'email'
  recipient: string
  proof_of_delivery_ref: string | null
  dispatched_by_name: string
}

export interface Refusal extends RegisterRowBase {
  letter_no: string
  council_resolution_date: string
  due_by: string
  sent_at: string | null
  sent_method: SentMethod | null
  recipient: string
  reasons: string
  drafted_by_name: string
}

export interface NoticeCertificate extends RegisterRowBase {
  newspaper_name: string
  advert_date: string
  second_advert_date: string | null
  certificate_received_at: string | null
  objection_closes_on: string | null
  filed_under_ref: string
  filed_by_name: string
}

export interface AbutterNotice extends RegisterRowBase {
  abutter_name: string
  abutter_stand_number: string | null
  abutter_address: string
  notified_at: string
  method: 'registered_post' | 'courier' | 'hand_delivered' | 'email'
  receipt_ref: string | null
  responded: boolean
  served_by_name: string
}

export type FileDestination =
  | 'planner' | 'eo_planner' | 'gis_officer' | 'building_inspector'
  | 'env_officer' | 'committee' | 'legal' | 'treasury' | 'registry'
  | 'chief_executive' | 'external' | 'other'

export interface FileMovement extends RegisterRowBase {
  issued_at: string
  holder_name: string
  holder_id: string | null
  destination: FileDestination
  purpose: string
  due_back_on: string
  returned_at: string | null
  returned_condition: 'intact' | 'incomplete' | 'damaged' | null
  issued_by_name: string
}

export interface PublicInspection extends RegisterRowBase {
  inspected_at: string
  subject_description: string
  requester_name: string
  requester_contact: string | null
  requester_capacity: 'member_of_public' | 'owner' | 'agent' | 'conveyancer'
    | 'surveyor' | 'developer' | 'other_authority' | 'media'
  request_kind: 'inspection' | 'certified_copy' | 'planning_search' | 'plan_copy'
  copies_issued: number
  fee_receipt_id: string | null
  attended_by_name: string
}

/** Maps a register key to the row type it yields, so callers keep their types. */
export interface RegisterRowMap {
  correspondence: Correspondence
  receipts: FeeReceipt
  acknowledgements: Acknowledgement
  dispatches: Dispatch
  refusals: Refusal
  certificates: NoticeCertificate
  abutters: AbutterNotice
  movements: FileMovement
  inspections: PublicInspection
}

export interface RegisterQuery {
  q?: string
  permit?: string
  from?: string
  to?: string
  /** Letters not yet sent. Only meaningful on acknowledgements and refusals. */
  outstanding?: boolean
  /** Files not yet back. Only meaningful on movements. */
  open?: boolean
  includeVoided?: boolean
  limit?: number
  offset?: number
}

export interface RegisterPage<K extends RegisterKey> {
  rows: RegisterRowMap[K][]
  total: number
  limit: number
  offset: number
}

function registerParams(query: RegisterQuery): Record<string, unknown> {
  return params({
    q: query.q,
    permit: query.permit,
    from: query.from,
    to: query.to,
    outstanding: query.outstanding ? 'true' : undefined,
    open: query.open ? 'true' : undefined,
    include_voided: query.includeVoided ? 'true' : undefined,
    limit: query.limit,
    offset: query.offset,
  })
}

export async function listRegister<K extends RegisterKey>(
  register: K,
  query: RegisterQuery = {},
): Promise<RegisterPage<K>> {
  const r = await api.get(`/planning-clerk/registers/${register}`, { params: registerParams(query) })
  const { data: rows, meta } = paged<RegisterRowMap[K][], {
    total: number; limit: number; offset: number
  }>(r)
  return { rows, total: meta.total ?? rows.length, limit: meta.limit ?? rows.length, offset: meta.offset ?? 0 }
}

export async function createEntry<K extends RegisterKey>(
  register: K,
  body: Record<string, unknown>,
): Promise<RegisterRowMap[K]> {
  const r = await api.post(`/planning-clerk/registers/${register}`, body)
  return data<RegisterRowMap[K]>(r)
}

export async function updateEntry<K extends RegisterKey>(
  register: K,
  id: string,
  body: Record<string, unknown>,
): Promise<RegisterRowMap[K]> {
  const r = await api.patch(`/planning-clerk/registers/${register}/${id}`, body)
  return data<RegisterRowMap[K]>(r)
}

/**
 * Strike an entry through, with a reason.
 *
 * There is no delete, here or on the server. A register a clerk can delete
 * rows from is not evidence, so a withdrawn entry stays in the book with the
 * reason and the officer's name beside it.
 */
export async function voidEntry<K extends RegisterKey>(
  register: K,
  id: string,
  reason: string,
): Promise<RegisterRowMap[K]> {
  const r = await api.post(`/planning-clerk/registers/${register}/${id}/void`, { reason })
  return data<RegisterRowMap[K]>(r)
}

/**
 * Download a register as CSV.
 *
 * `responseType: 'blob'` and a temporary anchor rather than opening the URL:
 * auth is an httpOnly cookie on the XHR, and `window.open` on a cross-origin
 * API base would drop it and return the sign-in page as a .csv file.
 */
export async function exportRegister(
  register: RegisterKey,
  query: RegisterQuery = {},
): Promise<void> {
  const r = await api.get(`/planning-clerk/registers/${register}/export`, {
    params: registerParams(query),
    responseType: 'blob',
  })
  const url = URL.createObjectURL(r.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${register}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately cancels the download in Safari; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Overview ────────────────────────────────────────────────────────────

export interface PermitSummary {
  id: string
  tpd_reference: string | null
  dev_register_no: string | null
  stand_number: string | null
  suburb_ward: string | null
  applicant_name: string
  development_type: string
  status: string
  received_at: string | null
  created_at: string
}

export interface ClerkOverview {
  permits: {
    received_today: string; received_this_week: string; unpaid: string
    in_notice: string; approved: string; refused: string; total: string
  }
  acknowledgements: { outstanding: string; overdue: string; determination_soon: string }
  refusals: { outstanding: string; overdue: string }
  movements: { files_out: string; files_overdue: string }
  fees: {
    today_usd: string; today_zwg: string
    month_usd: string; month_zwg: string; today_count: string
  }
  correspondence: { in_today: string; out_today: string }
  inspections: { today: string }
  certificates: { objection_windows_open: string }
  received_today_list: PermitSummary[]
  as_of: string
}

export async function getOverview(): Promise<ClerkOverview> {
  return data<ClerkOverview>(await api.get('/planning-clerk/overview'))
}

/**
 * Postgres `count(*)` and `sum()` arrive as strings over JSON, because they
 * are bigint and numeric. Rendering one straight into a template works by
 * accident; adding two of them concatenates. Every read of an overview number
 * goes through this.
 */
export function num(value: string | number | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n as number) ? (n as number) : 0
}

// ── Deadlines ───────────────────────────────────────────────────────────

export type DeadlineKind =
  | 'acknowledgement' | 'determination' | 'refusal' | 'objection_window' | 'file_return'

export interface Deadline {
  kind: DeadlineKind
  id: string
  permit_application_id: string | null
  reference: string | null
  party: string | null
  due_at: string
  satisfied_at: string | null
  tpd_reference: string | null
  stand_number: string | null
  applicant_name: string | null
  rule: string
  /** Computed by the server, from the database's clock, not the browser's. */
  days_left: number
  overdue: boolean
}

export async function getDeadlines(days = 30): Promise<Deadline[]> {
  return data<Deadline[]>(await api.get('/planning-clerk/deadlines', { params: { days } }))
}

// ── Counter search and the file view ────────────────────────────────────

export interface SearchHit extends PermitSummary {
  /** Who physically holds the paper file, if it is signed out. */
  file_held_by: string | null
  acknowledged: boolean
}

export async function searchFiles(q: string, limit = 25): Promise<SearchHit[]> {
  const term = q.trim()
  // The server answers an empty list for anything under two characters; not
  // asking at all saves a round trip per keystroke on a rural link.
  if (term.length < 2) return []
  return data<SearchHit[]>(
    await api.get('/planning-clerk/search', { params: { q: term, limit } }))
}

export interface ClerkFile {
  permit: PermitSummary & {
    street_address: string | null
    stand_area_sqm: string | null
    description: string | null
    applicant_email: string | null
    applicant_phone: string | null
    decision_at: string | null
    decision_conditions: string | null
    statutory_due_date: string | null
    clock_state: string | null
    updated_at: string
  }
  registers: { [K in RegisterKey]: RegisterRowMap[K][] }
}

export async function getFile(permitId: string): Promise<ClerkFile> {
  return data<ClerkFile>(await api.get(`/planning-clerk/file/${permitId}`))
}
