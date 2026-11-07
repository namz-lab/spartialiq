// Annexure 11 building-plan appraisal, stored on the plan revision itself.
//
// The checklist used to live in the officer's browser (localStorage), so a
// second officer, or the same officer on another PC, saw a blank sheet. It now
// round-trips through building_plan.appraisal_notes: composeAppraisal() writes
// the plain-language record the applicant and the file already read, and
// parseAppraisal() reads that same text back into the checklist. The notes are
// the record; there is no hidden second copy to drift from it.

export const ANNEXURE_11: ReadonlyArray<{ section: string; items: readonly string[] }> = [
  { section: 'Floor plan',    items: ['Dimensions', 'Rooms', 'Lighting', 'Ventilation', 'Electrical fittings', 'Sanitary fittings'] },
  { section: 'Cross section', items: ['Foundations', 'Floor', 'Walls', 'Windows', 'Roof'] },
  { section: 'Elevation',     items: ['Natural ground level', 'External finish', 'Dimensions'] },
  { section: 'Site plan',     items: ['Existing features', 'Services', 'Dimensions', 'Scale', 'Orientation', 'Abutting properties', 'Position of entrance', 'Building lines', 'Plinth area'] },
]

export const MIN_REQS = ['Minimum health standards', 'Town planning requirements', 'Liquor licensing', 'Factories Act', 'Other'] as const
export type MinReq = typeof MIN_REQS[number]

export const CHECK_TOTAL = ANNEXURE_11.reduce((n, s) => n + s.items.length, 0)

export interface Appraisal {
  /** Keyed by checkKey(section, item). Absent means not checked. */
  checked: Record<string, boolean>
  requirements: Partial<Record<MinReq, string>>
  notes: string
}

export const checkKey = (section: string, item: string) => `${section} — ${item}`

const HEADER = /^Annexure 11 appraisal: \d+\/\d+ plan-content items checked\.$/
const OUTSTANDING = 'Outstanding: '

export function emptyAppraisal(): Appraisal {
  return { checked: {}, requirements: {}, notes: '' }
}

export function checkedCount(a: Appraisal): number {
  let n = 0
  for (const s of ANNEXURE_11) for (const it of s.items) if (a.checked[checkKey(s.section, it)]) n++
  return n
}

export function composeAppraisal(a: Appraisal): string {
  const missing: string[] = []
  for (const s of ANNEXURE_11) for (const it of s.items) {
    if (!a.checked[checkKey(s.section, it)]) missing.push(checkKey(s.section, it))
  }
  const lines = [`Annexure 11 appraisal: ${CHECK_TOTAL - missing.length}/${CHECK_TOTAL} plan-content items checked.`]
  if (missing.length) lines.push(`${OUTSTANDING}${missing.join('; ')}.`)
  for (const r of MIN_REQS) {
    const v = a.requirements[r]?.trim()
    if (v) lines.push(`${r}: ${v.replace(/\s*\n\s*/g, ' ')}`)
  }
  if (a.notes.trim()) lines.push(a.notes.trim())
  return lines.join('\n')
}

/**
 * Read a stored appraisal back. Notes that were not written by
 * composeAppraisal (typed before this format, or by another tool) come back
 * whole as free notes with nothing ticked, rather than being guessed at.
 */
export function parseAppraisal(text: string | null | undefined): Appraisal {
  const a = emptyAppraisal()
  const lines = (text ?? '').split('\n')
  if (!HEADER.test(lines[0]?.trim() ?? '')) {
    a.notes = (text ?? '').trim()
    return a
  }
  let i = 1
  const outstanding = new Set<string>()
  if (lines[i]?.startsWith(OUTSTANDING)) {
    for (const k of lines[i].slice(OUTSTANDING.length).replace(/\.$/, '').split('; ')) outstanding.add(k)
    i++
  }
  for (const s of ANNEXURE_11) for (const it of s.items) {
    const k = checkKey(s.section, it)
    if (!outstanding.has(k)) a.checked[k] = true
  }
  for (; i < lines.length; i++) {
    const req = MIN_REQS.find(r => lines[i].startsWith(`${r}: `))
    if (!req) break
    a.requirements[req] = lines[i].slice(req.length + 2)
  }
  a.notes = lines.slice(i).join('\n').trim()
  return a
}
