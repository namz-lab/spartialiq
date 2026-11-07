/**
 * Council documents the EHO console prints — notices, dossiers, certificates,
 * permits. One layout, so a notice and the certificate that follows it look
 * like they came from the same office.
 *
 * The letterhead itself lives in `@/documents/letterheadPdf`, shared with
 * every other surface that carries the council's identity.
 */
import jsPDF from 'jspdf'
import { COUNCIL } from '@/documents/council'
import { drawLetterhead } from '@/documents/letterheadPdf'

export interface CouncilDoc {
  doc: jsPDF
  /** Current cursor, in mm from the top. */
  y: number
}

export function councilDoc(title: string, subtitle: string): CouncilDoc {
  const doc = new jsPDF()
  const y = drawLetterhead(doc, { department: COUNCIL.department })

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(title.toUpperCase(), 105, y + 9, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(subtitle, 105, y + 14, { align: 'center' })
  return { doc, y: y + 24 }
}

/** A labelled paragraph. Breaks to a new page rather than running off one. */
export function block(d: CouncilDoc, label: string, text: string): void {
  if (d.y > 262) { d.doc.addPage(); d.y = 20 }
  d.doc.setFont('helvetica', 'bold'); d.doc.setFontSize(9); d.doc.text(label, 14, d.y)
  d.doc.setFont('helvetica', 'normal')
  const lines = d.doc.splitTextToSize(text || '—', 182)
  d.doc.text(lines, 14, d.y + 5)
  d.y += 7 + lines.length * 4.6
}

/** Label/value rows in two columns, for certificates. */
export function rows(d: CouncilDoc, pairs: [string, string][]): void {
  d.doc.setFontSize(10)
  for (const [k, v] of pairs) {
    if (d.y > 270) { d.doc.addPage(); d.y = 20 }
    d.doc.setFont('helvetica', 'bold'); d.doc.text(k, 14, d.y)
    d.doc.setFont('helvetica', 'normal')
    const lines = d.doc.splitTextToSize(v || '—', 124)
    d.doc.text(lines, 70, d.y)
    d.y += 7 * lines.length
  }
}

/** Signature lines: the officer on the left, an optional recipient on the right. */
export function signatures(d: CouncilDoc, officer: string, recipient?: string): void {
  d.y += 12
  if (d.y > 262) { d.doc.addPage(); d.y = 30 }
  d.doc.setLineWidth(0.3)
  d.doc.line(14, d.y, 90, d.y)
  d.doc.setFontSize(8)
  d.doc.text(officer, 14, d.y + 5)
  if (recipient) {
    d.doc.line(120, d.y, 196, d.y)
    d.doc.text(recipient, 120, d.y + 5)
  }
}

export function footer(d: CouncilDoc, text: string): void {
  d.doc.setFontSize(8)
  d.doc.text(text, 105, 287, { align: 'center' })
}
