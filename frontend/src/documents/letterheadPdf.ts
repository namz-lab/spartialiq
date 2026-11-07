/**
 * The letterhead as drawn onto a jsPDF page.
 *
 * Typographic rather than an image: jsPDF needs the artwork rasterised and
 * base64-encoded before it can place it, which would make every PDF heavier
 * and would fail silently when the asset is missing. The council's identity is
 * short enough to set in type, and type always renders.
 */
import type jsPDF from 'jspdf'
import { COUNCIL } from './council'

export interface LetterheadOptions {
  /** The issuing department, printed beneath the council name. */
  department: string
}

/**
 * Draws the letterhead at the top of the current page.
 *
 * @returns the y cursor, in mm, immediately below the rule.
 */
export function drawLetterhead(doc: jsPDF, opts: LetterheadOptions): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(COUNCIL.name, 105, 18, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(opts.department, 105, 24, { align: 'center' })

  doc.setFontSize(8)
  doc.text(COUNCIL.address, 105, 29, { align: 'center' })
  doc.text(COUNCIL.contactLine(), 105, 33, { align: 'center' })

  doc.setLineWidth(0.4)
  doc.line(14, 36, 196, 36)

  return 36
}
