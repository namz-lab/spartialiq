import { describe, it, expect } from 'vitest'
import jsPDF from 'jspdf'
import { drawLetterhead } from '../letterheadPdf'
import { COUNCIL } from '../council'

/** Every string drawn onto the page, flattened. */
function textOf(doc: jsPDF): string {
  // @ts-expect-error - internal, but stable and the only way to read back text
  return doc.internal.pages.flat().join(' ')
}

describe('drawLetterhead', () => {
  it('writes the council name onto the page', () => {
    const doc = new jsPDF()
    drawLetterhead(doc, { department: COUNCIL.department })
    expect(textOf(doc)).toContain('VUNGU RURAL DISTRICT COUNCIL')
  })

  it('writes the department it was given', () => {
    const doc = new jsPDF()
    drawLetterhead(doc, { department: 'Department of Planning' })
    expect(textOf(doc)).toContain('Department of Planning')
  })

  it('returns a cursor below the letterhead so callers can keep writing', () => {
    const doc = new jsPDF()
    const y = drawLetterhead(doc, { department: COUNCIL.department })
    expect(y).toBeGreaterThan(28)
  })
})
