/**
 * The finance officer's reading of import batches: which need review, and how many sit at each
 * stage of upload → validate → commit. Pure, so the rules are tested without a server.
 */
import type { ImportBatch, ImportStatus } from '../../models/types'

/** Batches with an unresolved exception, or that failed, most recent first. */
export function batchesToReview(batches: ImportBatch[]): ImportBatch[] {
  return batches
    .filter((b) => b.status === 'failed' || (Number(b.open_exceptions ?? 0) > 0 && !['cancelled', 'superseded', 'committed'].includes(b.status)))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
}

export const STAGES: { key: string; label: string; statuses: ImportStatus[] }[] = [
  { key: 'uploaded', label: 'Uploaded, not yet validated', statuses: ['uploaded', 'mapped', 'validating'] },
  { key: 'validated', label: 'Validated, waiting to be committed', statuses: ['validated', 'committing'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
  { key: 'committed', label: 'Committed', statuses: ['committed'] },
]

/** How many batches sit at each stage. Cancelled and superseded batches are not work. */
export function byStage(batches: ImportBatch[]): { key: string; label: string; n: number }[] {
  return STAGES.map((s) => ({ key: s.key, label: s.label, n: batches.filter((b) => s.statuses.includes(b.status)).length }))
}

/** The codes the server's validator raises (backend `src/routes/finance-imports.js`). */
const LABELS: Record<string, string> = {
  ACCOUNT_INACTIVE: 'Account is inactive',
  ACCOUNT_NOT_POSTABLE: 'Account cannot be posted to',
  ALREADY_IN_REGISTER: 'Already in the register',
  DATE_OUTSIDE_FINANCIAL_YEAR: 'Date outside the financial year',
  DEPARTMENT_INACTIVE: 'Department is inactive',
  DUPLICATE_WITHIN_FILE: 'Duplicate within the file',
  INVALID_DATE: 'Date not readable',
  MISSING_ACCOUNT_CODE: 'Account code missing',
  MISSING_DATE: 'Date missing',
  MISSING_DEPARTMENT_CODE: 'Department code missing',
  MISSING_LINE_CODE: 'Budget line code missing',
  MISSING_PROJECT_NAME: 'Project name missing',
  MISSING_PROJECT_REFERENCE: 'Project reference missing',
  MISSING_REFERENCE: 'Reference missing',
  NEGATIVE_BUDGET: 'Negative budget amount',
  UNKNOWN_ACCOUNT_CODE: 'Account not in the chart',
  UNKNOWN_BUDGET_LINE: 'Budget line not known',
  UNKNOWN_DEPARTMENT_CODE: 'Department not known',
  UNSUPPORTED_CURRENCY: 'Currency not supported',
}
/** A plain name for an exception code; an unknown code is shown with its underscores as spaces. */
export const exceptionLabel = (code: string): string => LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase()
