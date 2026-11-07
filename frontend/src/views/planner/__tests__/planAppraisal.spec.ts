import { describe, it, expect } from 'vitest'
import {
  ANNEXURE_11, CHECK_TOTAL, checkKey, checkedCount, composeAppraisal, emptyAppraisal, parseAppraisal,
} from '../planAppraisal'

describe('planAppraisal', () => {
  it('round-trips a partial appraisal through the stored notes', () => {
    const a = emptyAppraisal()
    a.checked[checkKey('Floor plan', 'Dimensions')] = true
    a.checked[checkKey('Elevation', 'Dimensions')] = true
    a.requirements['Minimum health standards'] = 'Soak-away 30 m from borehole'
    a.notes = 'Resubmit the site plan at 1:200.\nShow the building line.'

    const text = composeAppraisal(a)
    expect(text).toMatch(/^Annexure 11 appraisal: 2\/23/)
    const back = parseAppraisal(text)
    expect(back).toEqual(a)
    expect(checkedCount(back)).toBe(2)
    // Same item name in two sections stays distinct.
    expect(back.checked[checkKey('Site plan', 'Dimensions')]).toBeUndefined()
  })

  it('round-trips a complete appraisal (no Outstanding line)', () => {
    const a = emptyAppraisal()
    for (const s of ANNEXURE_11) for (const it of s.items) a.checked[checkKey(s.section, it)] = true
    const text = composeAppraisal(a)
    expect(text).not.toMatch(/Outstanding/)
    expect(checkedCount(parseAppraisal(text))).toBe(CHECK_TOTAL)
  })

  it('keeps foreign notes whole and ticks nothing', () => {
    const back = parseAppraisal('Approved at counter.\nSee file.')
    expect(back.notes).toBe('Approved at counter.\nSee file.')
    expect(checkedCount(back)).toBe(0)
    expect(parseAppraisal(null)).toEqual(emptyAppraisal())
  })
})
