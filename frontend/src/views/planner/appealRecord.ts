// The case record for an appeal (RTCP Act s.38): everything the council holds
// on the application, assembled from the server into one indexed PDF.
import { caseRef } from '@/composables/useApplicationPipeline'
import { dmApi, type Appeal, type DecisionPackage, type PermitDocument, type PermitEvent } from '@/services/developmentManagementService'
import { appealCaseRecord, renderDraftPdf, type DraftBlock } from './plannerDocuments'

const fmt = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => typeof x === 'string' && x.trim())
      .map(([k, x]) => `${k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}: ${x}`)
      .join('\n')
  }
  return String(v)
}

/** Pure: the record's sections from what the server returned. */
export function appealSections(pkg: DecisionPackage, docs: PermitDocument[], events: PermitEvent[]): DraftBlock[] {
  const p = pkg.permit
  const onFile = [
    ...docs.map(d => `${d.doc_type.replace(/_/g, ' ')}: ${d.file_name} (${fmt(d.uploaded_at)})`),
    ...pkg.documents.map(d => `Generated: ${(d as { title?: string }).title ?? 'document'}`),
  ]
  return [
    { heading: 'A. Determination', text: [
      `Status: ${p.status.replace(/_/g, ' ')}`,
      `Decided: ${fmt(p.decision_at)}${p.decision_officer ? ` by ${p.decision_officer}` : ''}`,
      `Recommendation: ${pkg.recommendation.value ?? '—'}`,
      ...(pkg.recommendation.reasons ? [`Reasons: ${pkg.recommendation.reasons}`] : []),
      ...(p.decision_conditions ? [`Decision notes / conditions: ${p.decision_conditions}`] : []),
    ] },
    { heading: 'B. Planning assessment and committee report', text: text(pkg.committee_report) || 'No committee report on the record.' },
    { heading: 'C. Referrals and replies', text: pkg.consultations.length
      ? pkg.consultations.map(c => `${c.body_name || c.department}: ${(c.response_status ?? c.outcome ?? 'pending').replace(/_/g, ' ')}${c.response_notes ? ` — ${c.response_notes}` : ''}`)
      : 'No referrals.' },
    { heading: 'D. Objections', text: pkg.objections.length
      ? pkg.objections.map(o => `${o.objector_name} (${fmt(o.received_at)}): ${o.grounds}${o.sustained != null ? ` — ${o.sustained ? 'sustained' : 'dismissed'}` : ''}${o.consideration_notes ? `. ${o.consideration_notes}` : ''}`)
      : 'No objections.' },
    { heading: 'E. Documents on file', text: onFile.length ? onFile : 'No documents.', numbered: onFile.length > 0 },
    { heading: 'F. Chronology', text: events.length
      ? events.map(e => `${fmt(e.created_at)} — ${e.event_type.replace(/_/g, ' ')}${e.actor_name ? ` (${e.actor_name})` : ''}`)
      : 'No events recorded.' },
  ]
}

export async function downloadAppealRecord(appeal: Appeal, officer: string): Promise<void> {
  const id = appeal.permit_application_id
  const [pkg, docs, events] = await Promise.all([
    dmApi.getDecisionPackage(id),
    dmApi.listPermitDocuments(id).catch(() => [] as PermitDocument[]),
    dmApi.listEvents(id).catch(() => [] as PermitEvent[]),
  ])
  const p = pkg.permit
  renderDraftPdf(appealCaseRecord(
    {
      reference: caseRef(p),
      applicant: p.applicant_name, standNo: p.stand_number, ward: p.suburb_ward,
      proposal: p.description || p.development_type.replace(/_/g, ' '),
    },
    { appellant: `${appeal.appellant_name} (${appeal.appellant_type})`, grounds: appeal.grounds, lodged: fmt(appeal.lodged_at) },
    appealSections(pkg, docs, events),
    officer,
  ))
}
