/**
 * Fail-closed inspector mutations. Success is only returned after the
 * canonical DM API confirms persistence. Never call the retired building-inspector client.
 */

import { inspectorMayIssueEnforcementOrder, parseOccupationIssueFailure } from './architecture'

export type ActionOk<T> = { ok: true } & T
export type ActionFail<T extends object = object> = { ok: false; error: string } & T

export async function referInspectorEnforcement(opts: {
  permitId: string
  reason: string
  stand?: string
  createConsultation: (permitId: string, data: Record<string, unknown>) => Promise<{ id?: string }>
}): Promise<ActionOk<{ consultationId: string }> | ActionFail> {
  if (inspectorMayIssueEnforcementOrder()) {
    return { ok: false, error: 'Building Inspector is not authorised to issue enforcement orders.' }
  }
  const reason = opts.reason.trim()
  if (!opts.permitId) return { ok: false, error: 'Open a permit before referring for enforcement.' }
  if (reason.length < 12) return { ok: false, error: 'Describe the observed breach before referring.' }
  try {
    const created = await opts.createConsultation(opts.permitId, {
      body_name: 'EO Planner',
      department: 'EO Planner',
      task_type: 'eo_review',
      priority: 'urgent',
      blocking: true,
      response_notes: [
        'Enforcement referral from Building Inspector. This desk has not issued an order.',
        opts.stand ? `Stand: ${opts.stand}` : '',
        `Reason: ${reason}`,
      ].filter(Boolean).join('\n'),
    })
    if (!created?.id) {
      return { ok: false, error: 'Referral was not persisted.' }
    }
    return { ok: true, consultationId: created.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Referral could not be created.'
    return { ok: false, error: message }
  }
}

export async function issueOccupationCertificateOfficial(opts: {
  permitId: string
  certificateNo: string
  issuedAt?: string
  notes?: string
  conditions?: string
  building?: { occupant_name?: string; building_use?: string; gross_floor_area_sqm?: number }
  issueCertificate: (
    permitId: string,
    data: {
      issued_at: string; certificate_no?: string; notes?: string; conditions?: string
      occupant_name?: string; building_use?: string; gross_floor_area_sqm?: number
    },
  ) => Promise<unknown>
}): Promise<ActionOk<{ issued: true }> | ActionFail<{ issued: false; missingStages?: number[] }>> {
  const certificateNo = opts.certificateNo.trim()
  if (!opts.permitId) {
    return { ok: false, issued: false, error: 'Open a permit before issuing a certificate.' }
  }
  if (!certificateNo) {
    return { ok: false, issued: false, error: 'Enter a certificate number. The server will not issue without one.' }
  }
  try {
    await opts.issueCertificate(opts.permitId, {
      issued_at: opts.issuedAt || new Date().toISOString(),
      certificate_no: certificateNo,
      notes: opts.notes,
      conditions: opts.conditions,
      ...opts.building,
    })
    return { ok: true, issued: true }
  } catch (err: unknown) {
    const parsed = parseOccupationIssueFailure(err)
    return { ok: false, issued: false, error: parsed.error, missingStages: parsed.missingStages }
  }
}
