/**
 * The committee's decision register, read from the finance audit trail (`GET /finance/audit`,
 * finance.audit.view). Every approve, return and reject is a POST the audit hook records with the
 * route's own details (note, resolution reference, the figure before and after), including the
 * attempts the server refused. There is no separate decisions table to read.
 */
import { financeApi } from '../../api/financeApi'
import type { AuditEvent } from '../../models/types'
import { KINDS, resolutionOf, type DecisionKind } from './agenda'

/** The trail row as the server sends it; the shared model leaves out `actor_id` and `details`. */
export type TrailRow = AuditEvent & { actor_id?: string | null; details?: Record<string, unknown> | null }

export type Outcome = 'approved' | 'returned' | 'rejected'

export interface Decision {
  id: string
  kind: DecisionKind
  outcome: Outcome
  /** The server refused the decision (a 4xx): an attempt, not a decision. */
  refused: boolean
  status: number | null
  at: string
  actor: string
  actor_id: string | null
  subject: string
  note: string | null
  resolution: string | null
  figure: string | null
}

const ACT = /\/(approve|reject|return)$/
const OUTCOME: Record<string, Outcome> = { approve: 'approved', reject: 'rejected', return: 'returned' }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})

/** One trail row as a decision, or null when the row is not a committee decision. */
export function toDecision(kind: DecisionKind, row: TrailRow): Decision | null {
  if (row.method !== 'POST' || !row.path) return null
  const m = ACT.exec(row.path)
  if (!m) return null
  const d = obj(row.details)
  const before = obj(d.before)
  const after = obj(d.after)
  const note = str(d.note)
  const amount = str(after.original_amount) ?? str(after.approved_budget) ?? str(before.amount_delta)
  const currency = str(after.currency) ?? str(before.currency) ?? str(d.currency)
  const figure = kind === 'tariff'
    ? (str(d.rate_in_dollar) ? `${d.rate_in_dollar} in the dollar${currency ? ` (${currency})` : ''}` : null)
    : amount ? `${currency ?? ''} ${amount}`.trim() : null
  return {
    id: row.id,
    kind,
    outcome: OUTCOME[m[1]],
    refused: (row.status ?? 0) >= 400,
    status: row.status,
    at: row.occurred_at,
    actor: row.actor_email ?? '—',
    actor_id: row.actor_id ?? null,
    subject: str(d.code) ?? str(d.reference) ?? (str(d.category) ? `Category ${d.category}` : null) ?? row.entity_id ?? '—',
    note,
    resolution: str(d.resolution_reference) ?? resolutionOf(note),
    figure,
  }
}

/** The register for the kinds this member decides, newest first. */
export async function loadDecisions(kinds: DecisionKind[], params: { from?: string; to?: string } = {}): Promise<Decision[]> {
  const metas = KINDS.filter((m) => kinds.includes(m.kind))
  const reads = await Promise.all(metas.map(async (m) => {
    const { events } = await financeApi.audit({ event: m.event, limit: 500, ...params })
    return (events as TrailRow[]).map((row) => toDecision(m.kind, row)).filter((x): x is Decision => x !== null)
  }))
  return reads.flat().sort((a, b) => b.at.localeCompare(a.at))
}

export const OUTCOME_LABEL: Record<Outcome, string> = { approved: 'Approved', returned: 'Returned', rejected: 'Rejected' }
