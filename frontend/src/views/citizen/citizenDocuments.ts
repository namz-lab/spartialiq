// Client-side PDF for citizen-facing case summaries. The backend does not
// yet serve generated application or inspection PDFs; this produces a
// printable record from data already on the case so the Download buttons
// do real work at the counter and at home.
import jsPDF from 'jspdf'
import { dmApi } from '@/services/developmentManagementService'

/** Open a council-generated letter in a new tab (same rendering the EO console uses). */
export async function openCouncilLetter(docId: string): Promise<void> {
  const doc = await dmApi.getGeneratedDocument(docId)
  if (!doc.content) throw new Error('This letter has no stored content. Ask the Planning Clerk for a copy.')
  const mime = doc.mime_type || 'text/html'
  const blob = (mime.startsWith('image') && doc.content.startsWith('data:'))
    ? await (await fetch(doc.content)).blob()
    : new Blob([doc.content], { type: mime })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadCitizenPdf(filename: string, title: string, lines: string[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  let y = 16

  doc.setFontSize(14)
  doc.setTextColor(26, 32, 44)
  doc.text(title, 14, y)
  y += 6
  doc.setFontSize(9)
  doc.setTextColor(90, 98, 112)
  doc.text('Vungu Rural District Council · Development Control', 14, y)
  y += 5
  doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, 14, y)
  y += 4
  doc.setDrawColor(26, 115, 232)
  doc.setLineWidth(0.4)
  doc.line(14, y, pageW - 14, y)
  y += 8

  doc.setFontSize(10)
  doc.setTextColor(26, 32, 44)
  for (const ln of lines) {
    const wrapped = doc.splitTextToSize(ln, pageW - 28) as string[]
    for (const w of wrapped) {
      if (y > pageH - 18) {
        doc.addPage()
        y = 16
      }
      doc.text(w, 14, y)
      y += 5.5
    }
  }

  doc.setFontSize(8)
  doc.setTextColor(120, 128, 140)
  doc.text('This is an official case extract for the applicant. Certified copies are issued at the Vungu RDC office.', 14, pageH - 10)
  doc.save(filename)
}
