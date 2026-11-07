// src/views/planner/permit/permitDocument.ts
// ─────────────────────────────────────────────────────────────────────────
// Official development-permit renderer.
//
// Replaces the inline exporter that lived in Step4PermitDrafting.vue, which
// advanced a fixed `y` cursor by fixed amounts (`y += 12` per condition, `+= 18`
// for the description, `+= 40` for Annexure 7) with no page breaks. Anything
// longer than its guess silently overlapped the block beneath it, and past
// roughly 18 lines the content simply ran off page 1 and was never drawn.
//
// This renderer measures every block, breaks the page when a block does not
// fit, and repeats a header and a numbered footer on every page.
//
// AUTHORITATIVE-RECORD PRINCIPLE
// ------------------------------
// The caller must build `PermitDocumentRecord` from the permit row the SERVER
// returned, not from live form state. Fields the server does not yet store are
// flagged via `provenance`, so the document never implies the council holds a
// record it does not.
// ─────────────────────────────────────────────────────────────────────────

import jsPDF from 'jspdf'
import type { Annexure7Clause } from './permitRules'

export interface PermitDocumentCondition {
  category: string
  text: string
}

export interface PermitDocumentRecord {
  permitNo: string
  fileRef: string
  registrationNo: string
  applicantName: string
  applicantIdNumber: string
  standNo: string
  ward: string
  propertyDescription: string
  titleDeedNo: string
  applicationType: string
  useClass: string
  permittedDescription: string
  conditions: PermitDocumentCondition[]
  /** System-generated statutory clauses, from permitRules.buildAnnexure7(). */
  annexureClauses: Annexure7Clause[]
  /** Officer-authored discretionary notes — rendered separately and labelled. */
  officerNotes: string
  decisionDate: string | null
  issueDate: string | null
  notificationDate: string | null
  implementationDeadline: string | null
  appealDeadline: string | null
  issuingOfficer: string
  decisionAuthority: string
  status: string
  documentVersion: number
  /** Whether this was built from the server's row or an unsaved draft. */
  provenance: 'server' | 'draft'
}

// A4 portrait, millimetres.
const PAGE_W = 210
const PAGE_H = 297
const MARGIN_X = 16
const MARGIN_TOP = 16
const MARGIN_BOTTOM = 20
const CONTENT_W = PAGE_W - MARGIN_X * 2
const LINE_H = 5

const dash = (v: string | null | undefined) => (v && String(v).trim()) || '—'

/**
 * A cursor that knows when to break the page. Every write goes through it, so
 * no block can overlap another or fall off the sheet.
 */
class Cursor {
  y = MARGIN_TOP
  constructor(private doc: jsPDF) {
    this.header()
  }

  private header() {
    const d = this.doc
    d.setFont('helvetica', 'bold'); d.setFontSize(11)
    d.text('VUNGU RURAL DISTRICT COUNCIL', PAGE_W / 2, this.y, { align: 'center' })
    this.y += 4.5
    d.setFont('helvetica', 'normal'); d.setFontSize(8)
    d.text('Planning Department · Development Control',
      PAGE_W / 2, this.y, { align: 'center' })
    this.y += 3
    d.setLineWidth(0.4)
    d.line(MARGIN_X, this.y, PAGE_W - MARGIN_X, this.y)
    this.y += 6
  }

  /** Start a new page, repeating the header. */
  break() {
    this.doc.addPage()
    this.y = MARGIN_TOP
    this.header()
  }

  /** Ensure `h` mm is available, breaking first if not. */
  ensure(h: number) {
    if (this.y + h > PAGE_H - MARGIN_BOTTOM) this.break()
  }

  gap(h = 3) { this.y += h }

  /** Wrapped paragraph. Breaks mid-paragraph, so an arbitrarily long condition
   *  cannot overflow — each line is placed only once there is room for it. */
  paragraph(text: string, opts: { bold?: boolean; size?: number; indent?: number } = {}) {
    const { bold = false, size = 9.5, indent = 0 } = opts
    const d = this.doc
    d.setFont('helvetica', bold ? 'bold' : 'normal')
    d.setFontSize(size)
    const lines: string[] = d.splitTextToSize(text || '—', CONTENT_W - indent)
    for (const line of lines) {
      this.ensure(LINE_H)
      d.text(line, MARGIN_X + indent, this.y)
      this.y += LINE_H
    }
  }

  sectionTitle(text: string) {
    // Keep a heading with at least its first lines of body text.
    this.ensure(LINE_H * 3)
    this.gap(3)
    const d = this.doc
    d.setFont('helvetica', 'bold'); d.setFontSize(10)
    d.text(text.toUpperCase(), MARGIN_X, this.y)
    this.y += 2
    d.setLineWidth(0.2)
    d.line(MARGIN_X, this.y, PAGE_W - MARGIN_X, this.y)
    this.y += 4.5
  }

  /** Two-column label/value row; the value wraps. */
  field(label: string, value: string) {
    const d = this.doc
    const labelW = 46
    d.setFont('helvetica', 'normal'); d.setFontSize(9.5)
    const lines: string[] = d.splitTextToSize(dash(value), CONTENT_W - labelW)
    this.ensure(LINE_H * lines.length)
    d.setFont('helvetica', 'bold')
    d.text(label, MARGIN_X, this.y)
    d.setFont('helvetica', 'normal')
    lines.forEach((line, i) => d.text(line, MARGIN_X + labelW, this.y + i * LINE_H))
    this.y += LINE_H * lines.length
  }

  /** Numbered list item, hanging-indented under its number. */
  numbered(n: number, text: string, sub?: string) {
    const d = this.doc
    const indent = 8
    d.setFont('helvetica', 'normal'); d.setFontSize(9.5)
    const lines: string[] = d.splitTextToSize(text || '—', CONTENT_W - indent)
    // Keep the number with its first line; the remainder may flow to a new page.
    this.ensure(LINE_H * 2)
    d.setFont('helvetica', 'bold')
    d.text(`${n}.`, MARGIN_X, this.y)
    d.setFont('helvetica', 'normal')
    lines.forEach((line, i) => {
      if (i > 0) this.ensure(LINE_H)
      d.text(line, MARGIN_X + indent, this.y)
      this.y += LINE_H
    })
    if (sub) {
      this.ensure(LINE_H)
      d.setFont('helvetica', 'italic'); d.setFontSize(7.5)
      d.setTextColor(110)
      d.text(sub, MARGIN_X + indent, this.y)
      d.setTextColor(0)
      d.setFontSize(9.5)
      this.y += LINE_H - 1
    }
    this.gap(1.5)
  }
}

/** Stamp "Page X of Y" plus the permit reference on every page — done last,
 *  once the true page count is known. */
function stampFooters(doc: jsPDF, rec: PermitDocumentRecord) {
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(110)
    doc.setLineWidth(0.2)
    doc.line(MARGIN_X, PAGE_H - MARGIN_BOTTOM + 4, PAGE_W - MARGIN_X, PAGE_H - MARGIN_BOTTOM + 4)
    doc.text(
      `Permit ${dash(rec.permitNo)}  ·  File ${dash(rec.fileRef)}  ·  Document v${rec.documentVersion}`,
      MARGIN_X, PAGE_H - MARGIN_BOTTOM + 9,
    )
    doc.text(`Page ${p} of ${total}`, PAGE_W - MARGIN_X, PAGE_H - MARGIN_BOTTOM + 9, { align: 'right' })
    if (rec.provenance === 'draft') {
      doc.setTextColor(170, 40, 40)
      doc.text(
        'DRAFT — not issued. Not an authoritative record of a council decision.',
        PAGE_W / 2, PAGE_H - MARGIN_BOTTOM + 14, { align: 'center' },
      )
    }
    doc.setTextColor(0)
  }
}

/** Render the permit. Returns the jsPDF document; callers save or inspect it. */
export function renderPermitDocument(rec: PermitDocumentRecord): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const c = new Cursor(doc)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(
    rec.provenance === 'draft' ? 'DRAFT DEVELOPMENT PERMIT' : 'DEVELOPMENT PERMIT',
    PAGE_W / 2, c.y, { align: 'center' },
  )
  c.y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text('Issued under Section 26 of the Regional, Town and Country Planning Act [Chapter 29:12]',
    PAGE_W / 2, c.y, { align: 'center' })
  c.y += 6

  c.sectionTitle('Permit identification')
  c.field('Permit number', rec.permitNo)
  c.field('File reference', rec.fileRef)
  c.field('Development register no', rec.registrationNo)
  c.field('Status', rec.status)

  c.sectionTitle('Applicant')
  c.field('Name', rec.applicantName)
  c.field('Identification', rec.applicantIdNumber)

  c.sectionTitle('Property')
  c.field('Stand number', rec.standNo)
  c.field('Ward / suburb', rec.ward)
  c.field('Legal description', rec.propertyDescription)
  c.field('Title deed no', rec.titleDeedNo)

  c.sectionTitle('Permitted development')
  c.field('Application type', rec.applicationType)
  c.field('Use class', rec.useClass ? `Class ${rec.useClass}` : '')
  c.gap(2)
  c.paragraph(rec.permittedDescription)

  c.sectionTitle(`Conditions of approval (${rec.conditions.length})`)
  if (!rec.conditions.length) {
    c.paragraph('No conditions were imposed on this permit.')
  } else {
    rec.conditions.forEach((cond, i) => c.numbered(i + 1, cond.text, cond.category))
  }

  c.sectionTitle('Annexure 7 — Notes attached to this permit')
  if (!rec.annexureClauses.length) {
    c.paragraph('No statutory notes apply.')
  } else {
    rec.annexureClauses.forEach((cl, i) => c.numbered(i + 1, cl.text, `${cl.source} · v${cl.version}`))
  }
  if (rec.officerNotes.trim()) {
    c.gap(2)
    c.paragraph('Additional notes by the issuing officer:', { bold: true, size: 9 })
    c.paragraph(rec.officerNotes)
  }

  c.sectionTitle('Decision record')
  c.field('Decision date', rec.decisionDate ?? '')
  c.field('Issue date', rec.issueDate ?? '')
  c.field('Applicant notified', rec.notificationDate ?? '')
  c.field('Commencement by', rec.implementationDeadline ?? '')
  c.field('Appeal by', rec.appealDeadline ?? 'As prescribed by the Act')
  c.field('Decision authority', rec.decisionAuthority)
  c.field('Issuing officer', rec.issuingOfficer)

  c.gap(8)
  c.ensure(20)
  doc.setLineWidth(0.3)
  doc.line(MARGIN_X, c.y, MARGIN_X + 62, c.y)
  c.y += 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text('Signature — authorised officer', MARGIN_X, c.y)

  stampFooters(doc, rec)
  return doc
}

/** Render and download. Returns the filename written. */
export function savePermitDocument(rec: PermitDocumentRecord): string {
  const name = `permit-${(rec.permitNo || 'draft').replace(/[^\w.-]+/g, '_')}`
    + `-v${rec.documentVersion}.pdf`
  renderPermitDocument(rec).save(name)
  return name
}
