/**
 * Custody of an unsent stage checklist.
 *
 * The photograph queue in ./evidenceQueue already refuses to let a failed
 * upload look like a filed one. The marks beside those photographs had no such
 * protection: an inspector standing in a foundation trench with no signal could
 * mark twenty Annexure 14 items, press Save, receive "Could not save checklist"
 * — and lose every mark the moment the tab was reloaded or the phone reclaimed
 * the page, because the marks lived only in component state.
 *
 * So the draft is written down as it is made, and it survives until the SERVER
 * accepts it. Same rule as the evidence queue: nothing leaves custody on a
 * promise, only on an acknowledgement.
 *
 * Two deliberate choices:
 *
 *  1. Keyed on (permitId, stageNumber), not on the stage_inspection id. The
 *     inspection record is created lazily, at submit time — the very request
 *     that fails when there is no signal. Keying on a record that does not
 *     exist yet would lose exactly the drafts worth keeping.
 *
 *  2. A prefix of its own, NOT the `inspector_case_` prefix. Settings clears
 *     cached case drafts on the stated grounds that everything in them was
 *     already accepted by the server; that claim is true of the case cache and
 *     false of this. Sharing the prefix would turn "clear cached data" into
 *     "destroy this morning's unsent field work".
 *
 * localStorage, not IndexedDB: these are a few hundred bytes of JSON with no
 * blobs. The evidence queue needs IndexedDB because it holds camera originals.
 */

export type DraftMark = 'pass' | 'fail' | 'na' | 'not_inspected'

export interface ChecklistDraftRow {
  checklist_item_id: number
  result: DraftMark
  notes: string
  score: number | null
  photo_id?: string | null
}

export interface ChecklistDraft {
  permitId: string
  stageNumber: number
  /** ISO timestamp of the last mark, shown to the inspector when it is restored. */
  savedAt: string
  rows: ChecklistDraftRow[]
}

export const CHECKLIST_DRAFT_PREFIX = 'inspector_checklist_'

const keyFor = (permitId: string, stageNumber: number) =>
  `${CHECKLIST_DRAFT_PREFIX}${permitId}_${stageNumber}`

/** A row the inspector has actually touched. Untouched rows are not work. */
function isMarked(r: ChecklistDraftRow): boolean {
  return r.result !== 'not_inspected' || !!r.notes.trim() || r.score != null
}

/**
 * Write the draft, or remove it when nothing is marked.
 *
 * Answers whether a draft is now held, so the caller can tell the inspector the
 * truth rather than assume the write succeeded. A storage failure (private
 * mode, quota) answers false — and the caller must not then claim the marks are
 * safe, for the same reason the evidence queue raises rather than reassures.
 */
export function saveChecklistDraft(
  permitId: string,
  stageNumber: number,
  rows: ChecklistDraftRow[],
): boolean {
  const marked = rows.filter(isMarked)
  try {
    if (!marked.length) {
      localStorage.removeItem(keyFor(permitId, stageNumber))
      return false
    }
    const draft: ChecklistDraft = {
      permitId,
      stageNumber,
      savedAt: new Date().toISOString(),
      rows: marked,
    }
    localStorage.setItem(keyFor(permitId, stageNumber), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/** The held draft for this stage, or null. Malformed storage reads as absent. */
export function readChecklistDraft(permitId: string, stageNumber: number): ChecklistDraft | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(keyFor(permitId, stageNumber))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as ChecklistDraft
    if (!d || !Array.isArray(d.rows) || !d.rows.length) return null
    return d
  } catch {
    return null
  }
}

/** Called only after the server has accepted the checklist, or on a deliberate discard. */
export function discardChecklistDraft(permitId: string, stageNumber: number): void {
  try { localStorage.removeItem(keyFor(permitId, stageNumber)) } catch { /* nothing to undo */ }
}

/**
 * Every held draft on this device, newest first.
 *
 * Settings shows this so an inspector can see, before they hand the phone in or
 * clear anything, that there is field work on it the office has never seen.
 */
export function heldChecklistDrafts(): ChecklistDraft[] {
  const out: ChecklistDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(CHECKLIST_DRAFT_PREFIX)) continue
      try {
        const d = JSON.parse(localStorage.getItem(k) || '') as ChecklistDraft
        if (d && Array.isArray(d.rows) && d.rows.length) out.push(d)
      } catch { /* skip the unreadable one, report the rest */ }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))
}
