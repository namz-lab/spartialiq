/**
 * Building Inspector work queue.
 *
 * The live queue is served by spatial_planning.v_inspector_queue (migration 116)
 * and every filter/bucket/count is a Postgres predicate — see useInspectorQueue()
 * at the bottom of this file.
 *
 * The pure row-mapping and classification helpers above it are retained for
 * local presentation of a page that has already been fetched (search-as-you-type,
 * column sort) and for the citizen-booking shapes. They are NOT the queue's
 * source of truth and must not be used to recount server buckets.
 */

import { computed, ref } from 'vue'
import type { InspectionBooking } from '@/services/inspectionsService'
import {
  dmApi,
  type PermitApplication,
  type EnforcementOrder,
  type InspectorQueueRow as ServerQueueRow,
  type InspectorQueueQuery,
  type InspectorQueueBucket,
  type InspectorQueueSummary,
} from '@/services/developmentManagementService'

export type QueueSource = 'booking' | 'permit' | 'enforcement'

export type InspectorPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface InspectorQueueRow {
  id: string
  source: QueueSource
  inspectionRef: string
  applicationRef: string
  permitId: string | null
  bookingId: string | null
  property: string
  stand: string
  ward: string
  inspectionType: string
  stageNumber: number | null
  assignedInspector: string | null
  scheduledDate: string | null
  priority: InspectorPriority
  status: string
  lastResult: string | null
  nextAction: string
  lat: number | null
  lng: number | null
}

export interface QueueBuckets {
  today: InspectorQueueRow[]
  overdue: InspectorQueueRow[]
  completed: InspectorQueueRow[]
  highPriority: InspectorQueueRow[]
  followUps: InspectorQueueRow[]
  occupation: InspectorQueueRow[]
  violations: InspectorQueueRow[]
  recent: InspectorQueueRow[]
}

export function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function isSameLocalDay(iso: string | null, now = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const a = startOfLocalDay(d)
  const b = startOfLocalDay(now)
  return a.getTime() === b.getTime()
}

export function isOverdue(iso: string | null, now = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.getTime() < startOfLocalDay(now).getTime()
}

const OPEN_BOOKING = new Set(['scheduled', 'rescheduled', 'in_progress', 'waitlisted'])
const DONE_BOOKING = new Set(['passed', 'failed', 'cancelled'])
const OPEN_ENF = new Set(['draft', 'issued', 'served', 'non_complied', 'active', 'extended'])

export function bookingToRow(b: InspectionBooking): InspectorQueueRow {
  const overdue = isOverdue(b.scheduledFor)
  const inProgress = b.status === 'in_progress'
  let nextAction = 'Open'
  if (b.status === 'waitlisted') nextAction = 'Schedule'
  else if (b.status === 'scheduled' || b.status === 'rescheduled') nextAction = 'Travel to site'
  else if (inProgress) nextAction = 'Continue inspection'
  else if (b.status === 'failed') nextAction = 'Schedule follow-up'
  else if (b.status === 'passed') nextAction = 'View history'

  return {
    id: `booking:${b.id}`,
    source: 'booking',
    inspectionRef: `INSP-${b.stageNumber}-${b.id.slice(0, 8).toUpperCase()}`,
    applicationRef: b.applicationId,
    permitId: null,
    bookingId: b.id,
    property: b.stageName,
    stand: '—',
    ward: '—',
    inspectionType: b.stageName,
    stageNumber: b.stageNumber,
    assignedInspector: b.inspectorId,
    scheduledDate: b.scheduledFor,
    priority: overdue ? 'urgent' : (inProgress ? 'high' : (b.stageNumber >= 8 ? 'high' : 'normal')),
    status: b.status,
    lastResult: b.passed === true ? 'pass' : b.passed === false ? 'fail' : null,
    nextAction,
    lat: null,
    lng: null,
  }
}

export function permitToRow(p: PermitApplication): InspectorQueueRow {
  const occupation = p.has_occupation_certificate === true
  return {
    id: `permit:${p.id}`,
    source: 'permit',
    inspectionRef: p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
    applicationRef: p.dev_register_no || p.tpd_reference || p.id,
    permitId: p.id,
    bookingId: null,
    property: p.description || `${p.development_type.replace(/_/g, ' ')} — Stand ${p.stand_number}`,
    stand: p.stand_number || '—',
    ward: p.suburb_ward || '—',
    inspectionType: occupation ? 'Occupation' : 'Stage inspection',
    stageNumber: null,
    assignedInspector: p.assigned_to ?? null,
    scheduledDate: p.statutory_due_date || p.updated_at,
    priority: occupation ? 'low' : 'normal',
    status: p.status,
    lastResult: occupation ? 'occupation_issued' : null,
    nextAction: occupation ? 'View certificate' : 'Open inspection',
    lat: p.lat ?? null,
    lng: p.lng ?? null,
  }
}

export function enforcementToRow(o: EnforcementOrder): InspectorQueueRow {
  return {
    id: `enf:${o.id}`,
    source: 'enforcement',
    inspectionRef: o.order_reference,
    applicationRef: o.permit_application_id || '—',
    permitId: o.permit_application_id,
    bookingId: null,
    property: o.subject_name || o.owner_name || 'Enforcement',
    stand: o.stand_number || '—',
    ward: o.suburb_ward || '—',
    inspectionType: o.order_type.replace(/_/g, ' '),
    stageNumber: null,
    assignedInspector: null,
    scheduledDate: o.issued_at,
    priority: 'high',
    status: o.status,
    lastResult: o.status,
    nextAction: 'Record compliance check',
    lat: o.latitude,
    lng: o.longitude,
  }
}

export function classifyQueue(rows: InspectorQueueRow[], now = new Date()): QueueBuckets {
  const open = rows.filter(r => {
    if (r.source === 'booking') return OPEN_BOOKING.has(r.status)
    if (r.source === 'enforcement') return OPEN_ENF.has(r.status)
    return r.lastResult !== 'occupation_issued'
  })
  const today = open.filter(r => isSameLocalDay(r.scheduledDate, now) || r.status === 'in_progress')
  const overdue = open.filter(r => isOverdue(r.scheduledDate, now))
  const completed = rows.filter(r => {
    if (r.source === 'booking') return DONE_BOOKING.has(r.status)
    return r.lastResult === 'occupation_issued'
  })
  const highPriority = open.filter(r => r.priority === 'high' || r.priority === 'urgent')
  const followUps = rows.filter(r => r.lastResult === 'fail' || r.status === 'failed' || r.status === 'reinspection_required')
  const occupation = rows.filter(r =>
    r.inspectionType.toLowerCase().includes('occupation') || r.stageNumber === 9)
  const violations = rows.filter(r => r.source === 'enforcement' && OPEN_ENF.has(r.status))
  const recent = [...rows]
    .sort((a, b) => String(b.scheduledDate || '').localeCompare(String(a.scheduledDate || '')))
    .slice(0, 8)

  return { today, overdue, completed, highPriority, followUps, occupation, violations, recent }
}

export function filterQueue(
  rows: InspectorQueueRow[],
  q: {
    search?: string
    status?: string
    ward?: string
    type?: string
    inspector?: string
  },
): InspectorQueueRow[] {
  const needle = (q.search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (q.status && q.status !== 'all' && r.status !== q.status) return false
    if (q.ward && r.ward !== q.ward) return false
    if (q.type && r.inspectionType !== q.type) return false
    if (q.inspector && r.assignedInspector !== q.inspector) return false
    if (!needle) return true
    return r.inspectionRef.toLowerCase().includes(needle)
      || r.applicationRef.toLowerCase().includes(needle)
      || r.property.toLowerCase().includes(needle)
      || r.stand.toLowerCase().includes(needle)
      || r.ward.toLowerCase().includes(needle)
      || r.inspectionType.toLowerCase().includes(needle)
  })
}

export function sortQueue(
  rows: InspectorQueueRow[],
  key: keyof InspectorQueueRow,
  dir: 'asc' | 'desc' = 'asc',
): InspectorQueueRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = String(a[key] ?? '')
    const bv = String(b[key] ?? '')
    const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

/**
 * Server-backed Building Inspector queue.
 *
 * Every filter, bucket and count is evaluated in Postgres over
 * spatial_planning.v_inspector_queue. This composable holds no notion of "today"
 * or "overdue" of its own — the server owns those predicates, so a KPI tile and
 * the list it opens can never disagree.
 *
 * Failure policy: a rejected request NEVER becomes an empty queue. The error is
 * surfaced, the previous page is retained, and `stale` marks it as last-known.
 */
export function useInspectorQueue() {
  const rows = ref<ServerQueueRow[]>([])
  const total = ref(0)
  const summary = ref<InspectorQueueSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** True when `rows` is last-known data retained across a failed refresh. */
  const stale = ref(false)
  const lastSynced = ref<string | null>(null)

  const query = ref<InspectorQueueQuery>({ limit: 50, offset: 0 })

  const pageStart = computed(() => (rows.value.length ? (query.value.offset ?? 0) + 1 : 0))
  const pageEnd = computed(() => (query.value.offset ?? 0) + rows.value.length)
  const hasMore = computed(() => pageEnd.value < total.value)
  const hasPrev = computed(() => (query.value.offset ?? 0) > 0)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      // Deliberately no .catch() on either call: a server failure must reach the
      // catch below and be shown, not be silently rewritten as "no work assigned".
      const [page, counts] = await Promise.all([
        dmApi.inspectorWorkQueue(query.value),
        dmApi.inspectorQueueSummary(),
      ])
      rows.value = page.data
      total.value = page.total
      summary.value = counts
      stale.value = false
      lastSynced.value = new Date().toISOString()
    } catch (e: unknown) {
      error.value = parseQueueError(e)
      // Keep whatever was already on screen, but say plainly that it is old.
      stale.value = rows.value.length > 0
    } finally {
      loading.value = false
    }
  }

  /** Apply a filter patch and return to page 1 — paging into a stale offset hides rows. */
  async function setQuery(patch: Partial<InspectorQueueQuery>) {
    query.value = { ...query.value, ...patch, offset: 0 }
    await refresh()
  }

  /** Open a KPI tile as the actual server query behind it. */
  async function setBucket(bucket: InspectorQueueBucket | undefined) {
    await setQuery({ bucket })
  }

  async function nextPage() {
    if (!hasMore.value) return
    query.value = { ...query.value, offset: (query.value.offset ?? 0) + (query.value.limit ?? 50) }
    await refresh()
  }

  async function prevPage() {
    if (!hasPrev.value) return
    const limit = query.value.limit ?? 50
    query.value = { ...query.value, offset: Math.max((query.value.offset ?? 0) - limit, 0) }
    await refresh()
  }

  return {
    rows, total, summary, loading, error, stale, lastSynced, query,
    pageStart, pageEnd, hasMore, hasPrev,
    refresh, setQuery, setBucket, nextPage, prevPage,
  }
}

/** Surface the server's own message where it sent one; never invent reassurance. */
export function parseQueueError(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: { message?: string; error?: string } } })?.response
  if (res?.data?.message) return res.data.message
  if (res?.status === 401 || res?.status === 403) {
    return 'You are not authorised to view the inspection queue. Sign in again.'
  }
  if (res?.status) return `The inspection queue could not be loaded (server said ${res.status}).`
  if (e instanceof Error) return e.message
  return 'The inspection queue could not be loaded.'
}
