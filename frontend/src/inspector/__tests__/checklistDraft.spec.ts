// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveChecklistDraft, readChecklistDraft, discardChecklistDraft, heldChecklistDrafts,
  CHECKLIST_DRAFT_PREFIX, type ChecklistDraftRow,
} from '../checklistDraft'

const row = (id: number, over: Partial<ChecklistDraftRow> = {}): ChecklistDraftRow => ({
  checklist_item_id: id,
  result: 'not_inspected',
  notes: '',
  score: null,
  ...over,
})

describe('checklist draft custody', () => {
  beforeEach(() => localStorage.clear())

  it('holds the marks an inspector made and gives them back', () => {
    const rows = [row(1, { result: 'pass', score: 8 }), row(2, { result: 'fail', notes: '620 mm' })]
    expect(saveChecklistDraft('permit-a', 3, rows)).toBe(true)

    const back = readChecklistDraft('permit-a', 3)
    expect(back?.rows).toHaveLength(2)
    expect(back?.rows.find(r => r.checklist_item_id === 2)?.notes).toBe('620 mm')
  })

  it('keeps stages and permits apart', () => {
    saveChecklistDraft('permit-a', 3, [row(1, { result: 'pass' })])
    expect(readChecklistDraft('permit-a', 4)).toBeNull()
    expect(readChecklistDraft('permit-b', 3)).toBeNull()
  })

  it('does not hold a checklist nobody has touched', () => {
    expect(saveChecklistDraft('permit-a', 1, [row(1), row(2)])).toBe(false)
    expect(readChecklistDraft('permit-a', 1)).toBeNull()
  })

  it('drops a previously held draft once every mark is cleared', () => {
    saveChecklistDraft('permit-a', 1, [row(1, { result: 'pass' })])
    saveChecklistDraft('permit-a', 1, [row(1)])
    expect(readChecklistDraft('permit-a', 1)).toBeNull()
  })

  it('keeps a row that carries only a note or only a score', () => {
    saveChecklistDraft('permit-a', 2, [row(1, { notes: 'rebar spacing' }), row(2, { score: 0 })])
    expect(readChecklistDraft('permit-a', 2)?.rows).toHaveLength(2)
  })

  it('releases custody only when told to', () => {
    saveChecklistDraft('permit-a', 3, [row(1, { result: 'pass' })])
    discardChecklistDraft('permit-a', 3)
    expect(readChecklistDraft('permit-a', 3)).toBeNull()
  })

  it('reads malformed storage as absent rather than throwing', () => {
    localStorage.setItem(`${CHECKLIST_DRAFT_PREFIX}permit-a_3`, '{not json')
    expect(readChecklistDraft('permit-a', 3)).toBeNull()
    expect(heldChecklistDrafts()).toEqual([])
  })

  it('lists every held draft, newest first, and ignores the case cache', () => {
    localStorage.setItem('inspector_case_permit-z', JSON.stringify({ permitId: 'permit-z' }))
    saveChecklistDraft('permit-a', 1, [row(1, { result: 'pass' })])
    saveChecklistDraft('permit-b', 2, [row(1, { result: 'fail' })])

    const held = heldChecklistDrafts()
    expect(held).toHaveLength(2)
    expect(held.map(d => d.permitId).sort()).toEqual(['permit-a', 'permit-b'])
    expect(held[0].savedAt >= held[1].savedAt).toBe(true)
  })
})
