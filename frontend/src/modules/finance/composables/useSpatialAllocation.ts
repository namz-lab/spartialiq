/**
 * Pure rules for recording a spatial allocation (M5-7).
 *
 * The server is the control: it enforces the currency, the methodology length, the allocation
 * cap, the separation of duties and the "no equal division" rule. These helpers exist so the form
 * can say what is wrong before a request is made, and so those statements are testable without a
 * browser. They never compute an amount — the decimal string is passed through as recorded.
 */
import type { SpatialAllocationStatus } from '../api/financeApi'

export const MIN_METHODOLOGY_LENGTH = 10

export interface AllocationDraft {
  targetCode: string
  amount: string
  methodology: string
}

export interface AllocationDraftErrors {
  targetCode?: string
  amount?: string
  methodology?: string
}

/**
 * A plain decimal with at most two places, as `finance.money` stores it. No grouping separators,
 * no currency symbol, no exponent: those are display forms and would be ambiguous in a record.
 */
const MONEY_INPUT = /^\d+(\.\d{1,2})?$/

export function validateAllocationDraft(draft: AllocationDraft): AllocationDraftErrors {
  const errors: AllocationDraftErrors = {}
  if (!draft.targetCode.trim()) {
    errors.targetCode = 'Choose the ward this money belongs to.'
  }
  const amount = draft.amount.trim()
  if (!amount) {
    errors.amount = 'Record the amount to attribute to this ward.'
  } else if (!MONEY_INPUT.test(amount)) {
    errors.amount = 'Use a plain decimal with at most two places, for example 1250.00.'
  } else if (Number(amount) <= 0) {
    errors.amount = 'The amount must be greater than zero.'
  }
  if (draft.methodology.trim().length < MIN_METHODOLOGY_LENGTH) {
    errors.methodology =
      `Explain how the split was determined, in at least ${MIN_METHODOLOGY_LENGTH} characters.`
  }
  return errors
}

export function isValidDraft(errors: AllocationDraftErrors): boolean {
  return Object.keys(errors).length === 0
}

export const ALLOCATION_STATUS_LABELS: Readonly<Record<SpatialAllocationStatus, string>> = {
  draft: 'Draft — not yet attributed',
  approved: 'Approved',
  rejected: 'Refused',
  withdrawn: 'Withdrawn',
}

/** Status tone class used beside the status, so colour is never the only carrier. */
export function allocationStatusTone(status: SpatialAllocationStatus): string {
  if (status === 'approved') return 'tone-positive'
  if (status === 'rejected') return 'tone-negative'
  if (status === 'withdrawn') return 'tone-neutral'
  return 'tone-info'
}

// ── D16: a reduction is refused while approved splits would exceed the revised total ──────────
//
// `POST /finance/budget-revisions/:id/approve` answers 409 `spatial_allocations_exceed_revised`
// with the figures and the allocations that do not fit. Decision D16 is deliberate on both halves:
// the reduction is REFUSED rather than permitted-and-flagged (a negative unallocated remainder is
// not a warning, it is a figure the choropleth would have to shade), and the splits are NOT
// auto-withdrawn (an approved split carries a recorded methodology and a named approver, so
// revoking it is its own audited decision).
//
// What the UI owes the officer is therefore not an error message but a route out: which splits are
// in the way, a withdraw action on each, and the approval to retry. That is one extra ordering of
// two decisions the officer already holds — nothing is lost.

export interface AllocationOverrunConflict {
  approvedSplitTotal: string | null
  revisedAmount: string | null
  revisedAfter: string | null
  currency: string | null
  allocationIds: string[]
  targetCodes: string[]
  message: string
}

/**
 * Read the 409 payload, or return null for any other failure.
 *
 * Every money field is passed through as the decimal STRING the server sent. Nothing here is parsed
 * into a float: these figures exist to be read out and quoted, and a float would round them.
 */
export function allocationOverrunConflict(err: unknown): AllocationOverrunConflict | null {
  const response = (err as {
    response?: {
      status?: number
      data?: {
        error?: string
        message?: string
        approved_split_total?: string | number | null
        revised_amount?: string | number | null
        revised_after?: string | number | null
        currency?: string | null
        allocation_ids?: unknown
        target_codes?: unknown
      }
    }
  })?.response
  const data = response?.data
  if (response?.status !== 409 || data?.error !== 'spatial_allocations_exceed_revised') return null
  const text = (value: string | number | null | undefined): string | null =>
    value === null || value === undefined ? null : String(value)
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  return {
    approvedSplitTotal: text(data.approved_split_total),
    revisedAmount: text(data.revised_amount),
    revisedAfter: text(data.revised_after),
    currency: data.currency ?? null,
    allocationIds: list(data.allocation_ids),
    targetCodes: list(data.target_codes),
    message: data.message
      ?? 'The approved geographic splits of this line would exceed what the reduction leaves on it.',
  }
}

/**
 * The splits named by a conflict, paired code-to-id in the order the server listed them.
 *
 * The server sends two parallel arrays; pairing them here keeps the withdraw button beside the ward
 * it belongs to. A ward with no matching id is still listed — the officer must see every ward that
 * is in the way, even one the payload could not identify.
 */
export function conflictSplits(
  conflict: AllocationOverrunConflict,
): Array<{ id: string | null; targetCode: string }> {
  const count = Math.max(conflict.allocationIds.length, conflict.targetCodes.length)
  const out: Array<{ id: string | null; targetCode: string }> = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: conflict.allocationIds[i] ?? null,
      targetCode: conflict.targetCodes[i] ?? 'ward not named',
    })
  }
  return out
}
