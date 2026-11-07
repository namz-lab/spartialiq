// ─── Planner drafts for signature ──────────────────────────────────────────
// Refusals, enforcement / prohibition orders, section 35 notices, letters,
// the report on plan objections and the appeal case record. Every document the
// planner produces is a DRAFT: the planner prepares, an authorised officer signs.
//
// Builders are pure (return a DraftDoc) so the statutory wording is testable;
// renderDraftPdf is the only function that touches jsPDF.
// ───────────────────────────────────────────────────────────────────────────
import jsPDF from 'jspdf'
import { drawLetterhead } from '@/documents/letterheadPdf'

export interface DraftBlock { heading?: string; text: string | string[]; numbered?: boolean }

export interface DraftDoc {
  title: string
  reference: string
  date: string
  to: string[]
  blocks: DraftBlock[]
  signatory: string
  fileName: string
}

// The council's own department. "Department of Physical Planning" is the Ministry's,
// and on a council letter it reads as though the Ministry decided.
const DEPT = 'Planning Department'

export function todayLong(d = new Date()): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ── Development management ───────────────────────────────────────────────

export interface CaseRef {
  reference: string
  applicant: string
  standNo: string
  ward?: string
  proposal: string
}

export function refusalLetter(c: CaseRef, reasons: string[], officer: string): DraftDoc {
  return {
    title: 'NOTICE OF REFUSAL OF PERMIT',
    reference: c.reference,
    date: todayLong(),
    to: [c.applicant, `Stand ${c.standNo}${c.ward ? `, ${c.ward}` : ''}`],
    blocks: [
      { text: `Application for: ${c.proposal}` },
      { text: 'Your application, made under section 26 of the Regional, Town and Country Planning Act '
          + '[Chapter 29:12], has been considered and is REFUSED for the following reasons:' },
      { text: reasons, numbered: true },
      { heading: 'Right of appeal',
        text: 'If you are aggrieved by this decision you may appeal to the Administrative Court under '
          + 'section 38 of the Act within one month of the date of this notice.' },
    ],
    signatory: officer,
    fileName: `refusal-${slug(c.reference)}.pdf`,
  }
}

export function requestInfoLetter(c: CaseRef, items: string[], dueDate: string, officer: string): DraftDoc {
  return {
    title: 'REQUEST FOR FURTHER INFORMATION',
    reference: c.reference,
    date: todayLong(),
    to: [c.applicant, `Stand ${c.standNo}`],
    blocks: [
      { text: `Application for: ${c.proposal}` },
      { text: 'To complete the assessment of your application the council requires the following:' },
      { text: items, numbered: true },
      { text: `Please submit the information by ${dueDate}. The application cannot be determined until it is received.` },
    ],
    signatory: officer,
    fileName: `request-info-${slug(c.reference)}.pdf`,
  }
}

// ── Enforcement ──────────────────────────────────────────────────────────

export interface OrderRef {
  reference: string
  subject: string
  address: string
  standNo: string
  contravention: string
  requiredAction: string
  compliancePeriodDays: number
}

export type OrderKind = 'enforcement' | 'prohibition' | 's35'

const ORDER_TITLE: Record<OrderKind, string> = {
  enforcement: 'ENFORCEMENT ORDER (SECTION 32)',
  prohibition: 'PROHIBITION ORDER (SECTION 34)',
  s35: 'NOTICE UNDER SECTION 35 — REMOVAL OR REINSTATEMENT',
}

export function orderDraft(kind: OrderKind, o: OrderRef, officer: string): DraftDoc {
  const statute = 'the Regional, Town and Country Planning Act [Chapter 29:12]'
  const lead: Record<OrderKind, string> = {
    enforcement: `TAKE NOTICE that the council, as local planning authority, has found development on the `
      + `property described below carried out in contravention of ${statute}, and orders the steps set out below.`,
    prohibition: `TAKE NOTICE that, pending compliance with the enforcement order, the operations described `
      + `below are PROHIBITED on the property from the date of service of this order, under section 34 of ${statute}.`,
    s35: `TAKE NOTICE that under section 35 of ${statute} you are required to remove the unauthorised works `
      + `or reinstate the land or building as set out below.`,
  }
  return {
    title: ORDER_TITLE[kind],
    reference: o.reference,
    date: todayLong(),
    to: [o.subject, o.address],
    blocks: [
      { text: lead[kind] },
      { heading: 'Property', text: `Stand ${o.standNo}` },
      { heading: kind === 'prohibition' ? 'Operations prohibited' : 'Contravention', text: o.contravention },
      { heading: 'Steps required', text: o.requiredAction },
      { heading: 'Period for compliance',
        text: `${o.compliancePeriodDays} days from the date on which this order takes effect.` },
      { heading: 'Appeal',
        text: 'This order takes effect one month after service unless an appeal is lodged with the '
          + 'Administrative Court under section 38 within that period. Failure to comply is an offence.' },
    ],
    signatory: officer,
    fileName: `${kind}-${slug(o.reference)}.pdf`,
  }
}

export function regularisationInvitation(o: Omit<OrderRef, 'requiredAction' | 'compliancePeriodDays'>, dueDays: number, officer: string): DraftDoc {
  return {
    title: 'INVITATION TO APPLY FOR REGULARISATION (SECTION 27)',
    reference: o.reference,
    date: todayLong(),
    to: [o.subject, o.address],
    blocks: [
      { text: `Council records show development on Stand ${o.standNo} carried out without a permit: ${o.contravention}` },
      { text: 'The council is prepared to consider the development for regularisation under section 27 of the '
          + 'Regional, Town and Country Planning Act [Chapter 29:12]. You are invited to lodge an application, '
          + `with plans of the works as built, within ${dueDays} days of this letter.` },
      { text: 'If no application is received the council may take enforcement action without further notice.' },
    ],
    signatory: officer,
    fileName: `regularisation-${slug(o.reference)}.pdf`,
  }
}

// ── Forward planning ─────────────────────────────────────────────────────

export interface PlanObjectionRow { objector: string; text: string; response: string; recommendation: string }

export function reportOnObjections(planName: string, kind: string, exhibition: string, rows: PlanObjectionRow[], officer: string): DraftDoc {
  return {
    title: `REPORT ON OBJECTIONS — ${planName.toUpperCase()}`,
    reference: `${kind} plan`,
    date: todayLong(),
    to: ['The Chairperson, Planning Committee'],
    blocks: [
      { text: `The draft ${kind} plan was exhibited ${exhibition || '(exhibition not recorded)'}. `
          + `${rows.length} objection${rows.length === 1 ? ' was' : 's were'} received and are considered below, `
          + 'as required before the plan is submitted for approval.' },
      ...rows.map((r, i) => ({
        heading: `${i + 1}. ${r.objector}`,
        text: [`Objection: ${r.text}`, `Planning response: ${r.response || 'Not yet written'}`,
          `Recommendation: ${r.recommendation || 'Not yet made'}`],
      })),
    ],
    signatory: officer,
    fileName: `report-on-objections-${slug(planName)}.pdf`,
  }
}

// ── Appeal ───────────────────────────────────────────────────────────────

export function appealCaseRecord(
  c: CaseRef,
  appeal: { appellant: string; grounds: string; lodged: string },
  sections: DraftBlock[],
  officer: string,
): DraftDoc {
  return {
    title: 'CASE RECORD FOR APPEAL — ADMINISTRATIVE COURT',
    reference: c.reference,
    date: todayLong(),
    to: ['The Registrar, Administrative Court'],
    blocks: [
      { heading: 'Application', text: [`${c.proposal}`, `Applicant: ${c.applicant}`, `Stand ${c.standNo}${c.ward ? `, ${c.ward}` : ''}`] },
      { heading: 'Appeal', text: [`Appellant: ${appeal.appellant}`, `Lodged: ${appeal.lodged}`, `Grounds: ${appeal.grounds}`] },
      ...sections,
    ],
    signatory: officer,
    fileName: `appeal-record-${slug(c.reference)}.pdf`,
  }
}

// ── Rendering ────────────────────────────────────────────────────────────

export function renderDraftPdf(d: DraftDoc, save = true): jsPDF {
  const doc = new jsPDF()
  const pageH = doc.internal.pageSize.getHeight()
  const width = 182
  let y = drawLetterhead(doc, { department: DEPT }) + 8

  const need = (h: number) => { if (y + h > pageH - 20) { doc.addPage(); y = 20 } }
  const write = (text: string, size = 10, bold = false, indent = 0) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(text, width - indent) as string[]
    need(lines.length * 5)
    doc.text(lines, 14 + indent, y)
    y += lines.length * 5
  }

  doc.setTextColor(180, 0, 0)
  write('DRAFT — FOR SIGNATURE', 8, true)
  doc.setTextColor(0, 0, 0)
  write(`Ref: ${d.reference}`, 9)
  write(d.date, 9)
  y += 3
  d.to.forEach(line => write(line, 10))
  y += 4
  write(d.title, 12, true)
  y += 2
  for (const b of d.blocks) {
    y += 2
    if (b.heading) write(b.heading, 10, true)
    const parts = Array.isArray(b.text) ? b.text : [b.text]
    parts.forEach((p, i) => write(b.numbered ? `${i + 1}. ${p}` : p, 10, false, b.numbered ? 4 : 0))
  }
  y += 14
  need(20)
  doc.line(14, y, 90, y)
  y += 5
  write(d.signatory || 'Authorised officer', 10)
  write('for: VUNGU RURAL DISTRICT COUNCIL', 9)

  if (save) doc.save(d.fileName)
  return doc
}
