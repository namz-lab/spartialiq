// src/views/planner/permit/usePermitIssuance.ts
// ─────────────────────────────────────────────────────────────────────────
// Decision-readiness + the guarded issue action for the permit workspace.
//
// Determinations go through POST /eo-decision (EO/admin). Planners who click
// Issue hand the case to awaiting_eo_decision. PATCH /status rejects
// approve/refuse unless admin override:true.
// ─────────────────────────────────────────────────────────────────────────

import { computed, ref, type Ref } from 'vue'
import {
  dmApi, isConflictError,
  type PermitApplication, type PublicNotice, type DecisionPackage, type PermitMeeting,
} from '@/services/developmentManagementService'
import { deriveStatutoryState } from '@/composables/useStatutoryClock'
import { eoWorkflowApi, type CaseLane } from '@/services/eoWorkflow'
import { determinationSection } from '@/statutory/periods'
import { useConditionLibrary, type PlanningCondition } from '@/composables/useConditionLibrary'
import type { CaseFile } from '@/composables/usePlannerCase'
import type { Role } from '@/services/types'
import { can } from '@/statutory/roles'
import { buildAnnexure7, deriveDeadlines, toDateOnly, unverifiedRules } from './permitRules'
import { savePermitDocument, type PermitDocumentRecord } from './permitDocument'

/** Statuses a determination is lawful from (mirrors config/permitWorkflow.js
 *  TRANSITIONS; the server re-checks and is the authority). */
const LAWFUL_FROM = ['under_review', 'awaiting_eo_decision', 'deferred', 'appealed']

export type RequirementStatus = 'complete' | 'outstanding' | 'not_applicable' | 'unknown'

export interface ReadinessRequirement {
  id: string
  label: string
  status: RequirementStatus
  /** Plain-language explanation, shown whether complete or not, so a blocked
   *  officer is never left guessing which record to go and fix. */
  detail: string
  /** True only when the backend independently refuses issuance without it. */
  serverEnforced: boolean
}

export type IssuanceState =
  | 'loading' | 'ready' | 'blocked' | 'issuing' | 'issued'
  | 'conflict' | 'forbidden' | 'error'

export interface PermitIssuanceOptions {
  current: Ref<CaseFile | null>
  save: () => void
  role: Ref<Role | undefined>
  officerName: Ref<string>
}

export function usePermitIssuance(opts: PermitIssuanceOptions) {
  const { current, save, role, officerName } = opts
  const { passesAllTests } = useConditionLibrary()

  const loading = ref(false)
  const issuing = ref(false)
  const loadError = ref<string | null>(null)
  const issueError = ref<string | null>(null)
  const conflict = ref(false)
  const confirmed = ref(false)

  // Server-owned records backing the readiness panel.
  const pkg = ref<DecisionPackage | null>(null)
  const notice = ref<PublicNotice | null>(null)
  const meetings = ref<PermitMeeting[]>([])
  // The council's own workflow position: the statutory questions, public notice, objections. Null if it could not be read, which is then 'not verified'.
  const lane = ref<CaseLane | null>(null)

  const permitRow = computed<PermitApplication | null>(() => pkg.value?.permit ?? null)

  const isIssued = computed(() => {
    const s = permitRow.value?.status ?? current.value?.status
    return s === 'approved' || s === 'approved_with_conditions' || s === 'refused'
  })

  // Single frontend source of truth for who may issue (statutory/roles.ts),
  // which mirrors requireRole() on PATCH /:id/status. Still only a UI
  // convenience — the server re-checks and is the authority.
  const canAttemptIssue = computed(() => can(role.value, 'devapp.issue_permit'))

  // ── Load the server records ────────────────────────────────────────────
  async function refresh() {
    const id = current.value?.permitId
    if (!id) return
    loading.value = true
    loadError.value = null
    try {
      // Readiness must degrade, not vanish: only the decision package is hard
      // required. A council that never opened a public-notice record legitimately
      // has none, and the meetings route may 403 for some roles.
      const [p, n, m, l] = await Promise.all([
        dmApi.getDecisionPackage(id),
        dmApi.getPublicNotice(id).catch(() => null),
        dmApi.listPermitMeetings(id).catch(() => [] as PermitMeeting[]),
        eoWorkflowApi.lane(id).catch(() => null),
      ])
      pkg.value = p
      lane.value = l
      notice.value = n
      meetings.value = m ?? []
      // Adopt the server's revision: this is the freshest read we have, and
      // issuing with a stale one is a guaranteed 409.
      if (current.value && typeof p?.permit?.revision === 'number') {
        current.value.revision = p.permit.revision
      }
      conflict.value = false
    } catch (e) {
      loadError.value = describeError(e, 'Could not load the decision record.')
    } finally {
      loading.value = false
    }
  }

  // ── Readiness ──────────────────────────────────────────────────────────
  const requirements = computed<ReadinessRequirement[]>(() => {
    const c = current.value
    const p = permitRow.value
    const n = notice.value
    const out: ReadinessRequirement[] = []

    const unknown = (id: string, label: string, why: string): ReadinessRequirement =>
      ({ id, label, status: 'unknown', detail: why, serverEnforced: false })

    if (!p) {
      return [unknown('package', 'Decision record',
        'The server decision record has not loaded, so readiness cannot be established.')]
    }

    // 1. Acknowledgement
    out.push({
      id: 'acknowledged',
      label: 'Application acknowledged',
      // the council's own record: the acknowledgement date the server holds (it starts the Act's clock), never the date of receipt
      status: p.acknowledged_at ? 'complete' : 'outstanding',
      detail: p.acknowledged_at
        ? `Acknowledged on ${toDateOnly(p.acknowledged_at)}.`
        : 'No acknowledgement is recorded, so the clock under the Act has not started. Acknowledge the application before determining it.',
      serverEnforced: true,
    })

    // 2. Statutory determination period
    // the clock runs from acknowledgement (s.26(7)), not from receipt
    const clock = deriveStatutoryState(p.acknowledged_at ?? null, new Date(), (p as { development_type?: string | null }).development_type)
    out.push({
      id: 'statutory_period',
      label: 'Statutory determination period',
      status: !p.acknowledged_at ? 'unknown' : clock.daysRemaining > 0 ? 'complete' : 'outstanding',
      detail: !p.acknowledged_at
        ? 'Cannot be computed until the application is acknowledged.'
        : clock.daysRemaining > 0
          ? `${clock.daysRemaining} day(s) remain of the statutory period (${determinationSection((p as { development_type?: string | null }).development_type)}).`
          : 'The statutory period has expired — the application may be deemed refused. '
            + 'Confirm the position before issuing a permit.',
      serverEnforced: false,
    })

    // 3–6. Section 26(3) public notification
    const L = lane.value
    const notApplicable = (id: string, label: string, why: string): ReadinessRequirement =>
      ({ id, label, status: 'not_applicable', detail: why, serverEnforced: true })
    if (!n && L && !L.notice_required) {
      const why = 'Public notice is not required for this case (s.26(3)): it is not a special consent, a conflict with a condition of title, or a non-conforming or adverse use.'
      out.push(notApplicable('public_notice', 'Public notice (s.26(3))', why))
      out.push(notApplicable('abutting_owners', 'Adjacent owners notified', why))
      out.push(notApplicable('objection_period', 'Objection period closed', why))
    } else if (!n && L) {
      const why = 'Public notice is required (s.26(3)) and no record of it exists. Open Public notice and record the advert, the abutting owners, the site notice and the objection period.'
      out.push({ id: 'public_notice', label: 'Public notice (s.26(3))', status: 'outstanding', detail: why, serverEnforced: true })
      out.push({ id: 'abutting_owners', label: 'Adjacent owners notified', status: 'outstanding', detail: why, serverEnforced: true })
      out.push({ id: 'objection_period', label: 'Objection period closed', status: 'outstanding', detail: why, serverEnforced: true })
    } else if (!n) {
      out.push(unknown('public_notice', 'Public notice (s.26(3))', 'The council\'s notice record could not be read, so whether notice was required and given is not verified.'))
      out.push(unknown('abutting_owners', 'Adjacent owners notified', 'The council\'s notice record could not be read.'))
      out.push(unknown('objection_period', 'Objection period closed', 'The council\'s notice record could not be read.'))
    } else {
      out.push({
        id: 'public_notice',
        label: 'Public notice (s.26(3))',
        status: n.advert_verified && n.site_notice_verified ? 'complete' : 'outstanding',
        detail: n.advert_verified && n.site_notice_verified
          ? `Advert${n.advert_reference ? ` (${n.advert_reference})` : ''} and site notice verified.`
          : [
              n.advert_verified ? null : 'newspaper advert not verified',
              n.site_notice_verified ? null : 'site notice not verified',
            ].filter(Boolean).join('; ') + '.',
        serverEnforced: false,
      })
      out.push({
        id: 'abutting_owners',
        label: 'Adjacent owners notified',
        status: n.abutting_owners_verified ? 'complete' : 'outstanding',
        detail: n.abutting_owners_verified
          ? `Verified on ${toDateOnly(n.abutting_owners_verified_at)}.`
          : 'Notification of abutting owners has not been verified.',
        serverEnforced: false,
      })
      out.push({
        id: 'objection_period',
        label: 'Objection period closed',
        status: n.objection_period_closed ? 'complete' : 'outstanding',
        detail: n.objection_period_closed
          ? `Closed on ${toDateOnly(n.objection_period_closed_at)}.`
          : n.objection_period_end
            ? `Open until ${toDateOnly(n.objection_period_end)}; not yet recorded as closed.`
            : 'No objection period has been set or closed.',
        serverEnforced: false,
      })
    }

    // 7. Objections considered
    const objs = pkg.value?.objection_summary
    const none = !objs || objs.total === 0
    out.push({
      id: 'objections',
      label: 'Objections dealt with',
      status: L
        ? (L.objection_problems.length ? 'outstanding' : none ? 'not_applicable' : 'complete')
        : 'unknown',
      detail: !L
        ? 'The council\'s record of the objections could not be read.'
        : L.objection_problems.length
          ? `${L.objection_problems.join('; ')}.`
          : none ? 'No objections were lodged.'
            : `All ${objs!.total} objection(s) considered and put to the applicant (${objs!.sustained} sustained).`,
      serverEnforced: true,
    })

    // The Act's questions, and the referrals a "yes" leads to
    out.push({
      id: 'statutory_checks',
      label: 'The Act\'s questions answered',
      status: !L ? 'unknown' : L.checks_unanswered.length ? 'outstanding' : 'complete',
      detail: !L ? 'The council\'s record could not be read.'
        : L.checks_unanswered.length ? `${L.checks_unanswered.length} of ${L.checks.length} not answered (State road, aerodrome, neighbouring authority, title conflict, adverse use). Answer them on the Determination screen.`
          : 'Every question is answered.',
      serverEnforced: true,
    })
    out.push({
      id: 'statutory_referrals',
      label: 'Referrals the Act requires',
      status: !L ? 'unknown' : L.referrals_waiting.length ? 'outstanding' : 'complete',
      detail: !L ? 'The council\'s record could not be read.'
        : L.referrals_waiting.length ? L.referrals_waiting.map(w => `to ${w.body}: ${w.why}`).join('; ') + '.'
          : 'None outstanding.',
      serverEnforced: true,
    })

    // 8. Blocking referrals
    const consults = pkg.value?.consultations ?? []
    const blocking = consults.filter(x => x.blocking)
    const openBlocking = blocking.filter(
      x => x.response_status === 'pending' || x.task_status === 'open' || x.task_status === 'in_progress',
    )
    out.push({
      id: 'referrals',
      label: 'Required referrals',
      status: blocking.length === 0
        ? 'not_applicable'
        : openBlocking.length === 0 ? 'complete' : 'outstanding',
      detail: blocking.length === 0
        ? consults.length
          ? `${consults.length} referral(s) circulated, none marked blocking.`
          : 'No referrals were circulated.'
        : openBlocking.length === 0
          ? `All ${blocking.length} blocking referral(s) have responded.`
          : `Awaiting ${openBlocking.map(x => x.body_name || x.department || 'a body').join(', ')}.`,
      serverEnforced: false,
    })

    // 9. Decision authority — the committee's resolution. A typed 'delegated authority' no longer stands in for it: the EO's own lane opens only when
    // the council's delegation is recorded as switches (working workflow, section 7), and the server decides that.
    const resolved = meetings.value.filter(m => m.outcome && m.outcome !== 'pending' && m.resolution)
    out.push({
      id: 'authority',
      label: 'Decision authority',
      status: resolved.length ? 'complete' : 'outstanding',
      detail: resolved.length
        ? `Committee resolution recorded (${resolved[0].title}, ${toDateOnly(resolved[0].meeting_date)}).`
        : 'No committee resolution is recorded. A determination rests on one that matches it, unless the council has recorded its delegation to the EO.',
      // The backend enforces this on /eo-decision only, which planners cannot call.
      serverEnforced: false,
    })

    // 10. Fees
    out.push({
      id: 'fees',
      label: 'Application fee paid',
      status: p.fee_paid ? 'complete' : 'outstanding',
      detail: p.fee_paid ? 'Recorded as paid.' : 'The application fee is not recorded as paid.',
      serverEnforced: false,
    })

    // 11. Lawful transition — this one the server really does enforce.
    const lawful = LAWFUL_FROM.includes(p.status)
    out.push({
      id: 'transition',
      label: 'Lawful workflow state',
      status: lawful ? 'complete' : 'outstanding',
      detail: lawful
        ? `Status '${p.status}' may proceed to a determination.`
        : `A case in '${p.status}' cannot move to a determination. The server will reject this.`,
      serverEnforced: true,
    })

    // 12. Authorisation — also genuinely enforced.
    out.push({
      id: 'authorisation',
      label: 'Officer authorised to issue',
      status: canAttemptIssue.value ? 'complete' : 'outstanding',
      detail: canAttemptIssue.value
        ? `Signed in as ${role.value}, which may record a determination.`
        : `The role '${role.value ?? 'unknown'}' may not record a determination. `
          + 'The server will reject this.',
      serverEnforced: true,
    })

    return out
  })

  const unknowns = computed(() => requirements.value.filter(r => r.status === 'unknown'))
  // "Not verified" is not evidence that a step was done, so it blocks like "outstanding". There is no typed justification to get past it: the server
  // enforces the Act's requirements itself, and a record the screen cannot read is a reason to reload, not to issue.
  const blockers = computed(() => requirements.value.filter(r => r.status === 'outstanding' || r.status === 'unknown'))

  // ── Local form validation (usability, not authority) ───────────────────
  const fieldErrors = computed<Record<string, string>>(() => {
    const c = current.value
    const errs: Record<string, string> = {}
    if (!c) return errs
    const p = c.permit
    if (!p.permitNo.trim()) errs.permitNo = 'A permit number is required.'
    if (!p.useClass) errs.useClass = 'Select the use class this permit authorises.'
    if (p.permittedDescription.trim().length < 20) {
      errs.permittedDescription = 'Describe the permitted development in at least 20 characters '
        + `(currently ${p.permittedDescription.trim().length}).`
    }
    if (!p.issuingOfficer.trim()) errs.issuingOfficer = 'Record the issuing officer.'
    if (!p.decisionDate) errs.decisionDate = 'Record the date the decision was made.'
    if (!(p.implementationPeriodMonths > 0)) {
      errs.implementationPeriodMonths = 'Set the commencement period in months.'
    }
    if (!p.conditions.length) errs.conditions = 'At least one condition of approval is required.'
    else if (p.conditions.some(cond => !cond.text.trim())) {
      errs.conditions = 'Every condition needs wording.'
    } else if (p.conditions.some(cond => !passesAllTests(cond))) {
      errs.conditions = 'Every condition must satisfy all five legal tests.'
    }
    return errs
  })

  const failingConditions = computed<PlanningCondition[]>(() =>
    (current.value?.permit.conditions ?? []).filter(c => !passesAllTests(c)))

  const formValid = computed(() => Object.keys(fieldErrors.value).length === 0)

  const state = computed<IssuanceState>(() => {
    if (loading.value) return 'loading'
    if (issuing.value) return 'issuing'
    if (conflict.value) return 'conflict'
    if (isIssued.value) return 'issued'
    if (!canAttemptIssue.value) return 'forbidden'
    if (loadError.value || issueError.value) return 'error'
    if (blockers.value.length || !formValid.value) return 'blocked'
    return 'ready'
  })

  /** Available only when everything lines up AND the officer has ticked the
   *  authority confirmation. */
  const canIssue = computed(() => state.value === 'ready' && confirmed.value && !isIssued.value)

  const deadlines = computed(() => {
    const p = current.value?.permit
    return deriveDeadlines({
      decisionDate: p?.decisionDate ?? null,
      issueDate: toDateOnly(p?.issueDate ?? null),
      notificationDate: p?.notificationDate ?? null,
      implementationPeriodMonths: p?.implementationPeriodMonths ?? 0,
    })
  })

  const annexure = computed(() => buildAnnexure7({
    decisionDate: current.value?.permit.decisionDate ?? null,
    issueDate: toDateOnly(current.value?.permit.issueDate ?? null),
    notificationDate: current.value?.permit.notificationDate ?? null,
    implementationPeriodMonths: current.value?.permit.implementationPeriodMonths ?? 0,
  }))

  const rulesNeedingConfirmation = computed(() => unverifiedRules())

  // ── Document ───────────────────────────────────────────────────────────
  /**
   * Build the document record. `server` is the row the API just returned (or
   * the loaded decision package); anything it holds WINS over local form state,
   * because the council's record — not the officer's browser — is the permit.
   */
  function buildRecord(server: PermitApplication | null): PermitDocumentRecord {
    const c = current.value!
    const p = c.permit
    // Prefer the server's stored conditions: that is the list inspectors and
    // the citizen will actually see.
    const serverConds = Array.isArray(server?.permit_conditions)
      ? (server!.permit_conditions as PlanningCondition[])
      : null
    const conds = (serverConds ?? p.conditions).map(x => ({
      category: String(x?.category ?? 'condition'),
      text: String(x?.text ?? ''),
    }))
    return {
      permitNo: p.permitNo,
      fileRef: c.fileRef,
      registrationNo: server?.dev_register_no || c.registrationNo,
      applicantName: server?.applicant_name || c.applicant.name,
      applicantIdNumber: server?.applicant_id_number || c.applicant.idNumber,
      standNo: server?.stand_number || c.property.standNo,
      ward: server?.suburb_ward || c.property.ward,
      propertyDescription: c.property.description,
      titleDeedNo: server?.title_deed_no || c.property.titleDeedNo,
      applicationType: server?.development_type || c.proposal.devType,
      useClass: p.useClass,
      permittedDescription: p.permittedDescription,
      conditions: conds,
      annexureClauses: annexure.value,
      officerNotes: p.annexure7Notes,
      decisionDate: toDateOnly(server?.decision_at ?? null) ?? p.decisionDate,
      issueDate: toDateOnly(p.issueDate),
      notificationDate: p.notificationDate,
      implementationDeadline: deadlines.value.implementationDeadline,
      appealDeadline: deadlines.value.appealDeadline,
      issuingOfficer: p.issuingOfficer || officerName.value,
      decisionAuthority: p.decisionAuthority,
      status: server?.status ?? c.status ?? 'draft',
      documentVersion: p.documentVersion ?? 1,
      provenance: server ? 'server' : 'draft',
    }
  }

  /** Download the permit as it currently stands. */
  function downloadDocument(): string | null {
    if (!current.value) return null
    return savePermitDocument(buildRecord(permitRow.value))
  }

  // ── The issue action ───────────────────────────────────────────────────
  async function issue(): Promise<boolean> {
    // Re-entrancy guard: a double click, an Enter keypress landing on the
    // button, or a slow network must not produce two determinations.
    if (issuing.value) return false
    const c = current.value
    if (!c?.permitId || !canIssue.value) return false

    issuing.value = true
    issueError.value = null
    try {
      const decisionDate = c.permit.decisionDate ?? toDateOnly(new Date())!
      const notes = `Permit ${c.permit.permitNo} issued by ${c.permit.issuingOfficer}`
        + (c.permit.decisionAuthority ? ` under ${c.permit.decisionAuthority}` : '')

      // Server gate: only EO/admin may determine. Planners hand the case up.
      const r = role.value
      if (r === 'planner' || r === 'planning_clerk') {
        const updated = await dmApi.setPermitStatus(c.permitId, 'awaiting_eo_decision', {
          expectedRevision: c.revision,
          notes: 'Package ready for EO determination. ' + notes,
        })
        c.revision = updated.revision ?? c.revision + 1
        c.status = updated.status
        save()
        issueError.value = 'Case moved to awaiting EO decision. An Environment Officer / authorised EO must determine via EO decision.'
        return false
      }

      const result = await dmApi.submitEoDecision(c.permitId, {
        decision: 'approve_with_conditions',
        notes,
        conditions: c.permit.conditions as any,
      })
      const updated = result.permit

      c.revision = updated.revision ?? c.revision + 1
      c.status = updated.status
      c.permit.decisionDate = toDateOnly(updated.decision_at ?? null) ?? decisionDate
      c.permit.issueDate = new Date().toISOString()
      c.permit.documentVersion = (c.permit.documentVersion ?? 0) + 1
      save()

      await refresh()
      savePermitDocument(buildRecord(updated))
      return true
    } catch (e) {
      if (isConflictError(e)) {
        conflict.value = true
        issueError.value = 'This permit was modified by another officer since you opened it. '
          + 'Reload the case and review the changes before issuing.'
        return false
      }

      // Lost-response protection. A network drop or a 5xx tells us the request
      // failed to COMPLETE — not that it failed to APPLY. The write may well
      // have committed before the connection died. Re-read the server before
      // reporting failure, or the officer retries and we determine twice.
      if (isIndeterminate(e)) {
        await refresh()
        if (isIssued.value) {
          // It did commit. Adopt the server's record and report success.
          c.permit.issueDate = c.permit.issueDate ?? new Date().toISOString()
          c.permit.documentVersion = c.permit.documentVersion ?? 1
          save()
          savePermitDocument(buildRecord(permitRow.value))
          return true
        }
        issueError.value = 'The connection failed before the server confirmed the decision. '
          + 'The permit was NOT issued — the case has been re-checked and is unchanged. '
          + 'You can safely try again.'
        return false
      }

      issueError.value = describeError(e, 'The server rejected the permit issue.')
      return false
    } finally {
      issuing.value = false
    }
  }

  // ── Notification ───────────────────────────────────────────────────────
  /**
   * Record that the applicant was formally notified of the decision.
   *
   * Setting a date on a form is not notification, and a date held only in this
   * browser is not a record of one. This posts a citizen-visible case message,
   * which the backend stores in case_message and audits as `message_posted` —
   * so the notification that starts the appeal window has server-side evidence.
   */
  async function recordNotification(dateOnly: string): Promise<boolean> {
    const c = current.value
    if (!c?.permitId || !dateOnly) return false
    try {
      await dmApi.postMessage(c.permitId, {
        body: `Notice of decision on application ${c.registrationNo || c.fileRef}: `
          + `permit ${c.permit.permitNo} was issued on `
          + `${toDateOnly(c.permit.issueDate) ?? c.permit.decisionDate ?? dateOnly}. `
          + `Formal notification to the applicant was given on ${dateOnly}.`,
        message_type: 'citizen_message',
        visibility: 'citizen',
      })
      c.permit.notificationDate = dateOnly
      save()
      return true
    } catch (e) {
      issueError.value = describeError(e, 'Could not record the notification.')
      return false
    }
  }

  return {
    // state
    state, loading, issuing, conflict, confirmed,
    loadError, issueError, isIssued, canAttemptIssue, canIssue,
    // data
    pkg, notice, meetings, permitRow,
    requirements, blockers, unknowns, lane,
    fieldErrors, failingConditions, formValid,
    deadlines, annexure, rulesNeedingConfirmation,
    // actions
    refresh, issue, downloadDocument, recordNotification,
  }
}

/**
 * Did this error leave the outcome UNKNOWN rather than definitely rejected?
 *
 * A 4xx is a decision: the server looked and refused, so nothing was written.
 * A transport failure or a 5xx is not — the write may have committed before the
 * response was lost. Those must be re-checked against the server, never assumed
 * to have failed.
 */
function isIndeterminate(e: unknown): boolean {
  const err = e as { response?: { status?: number }; code?: string }
  if (!err?.response) return true                       // no response at all
  const status = err.response.status ?? 0
  return status >= 500 || status === 0
}

/** Turn a server error into something a planning officer can act on. */
function describeError(e: unknown, fallback: string): string {
  const res = (e as { response?: { status?: number; data?: { error?: string; message?: string } } })?.response
  const code = res?.data?.error
  const msg = res?.data?.message
  const MAP: Record<string, string> = {
    expected_revision_required:
      'The server needs the record version this permit was loaded at. Reload the case and try again.',
    conflict:
      'This permit was modified by another officer since you opened it. Reload before issuing.',
    invalid_transition:
      'The application is not in a state from which a permit may be issued.',
    committee_resolution_required:
      'A committee resolution is required before this determination.',
    delegation_not_open:
      "The EO's own lane is closed until the council's delegation is recorded.",
    resolution_mismatch:
      "The committee's resolution does not match this decision.",
    deemed_refused:
      'The application is deemed refused (s.26(7)); it cannot now be approved.',
    forbidden:
      'You do not have authority to issue this permit. A determination must be recorded by '
      + 'an authorised officer.',
    bad_status: 'The requested decision is not a valid permit status.',
    not_found: 'This permit no longer exists on the server.',
  }
  if (code && MAP[code]) return MAP[code]
  if (res?.status === 403) return MAP.forbidden
  if (msg) return msg
  if ((e as { code?: string })?.code === 'ERR_NETWORK') {
    return 'Cannot reach the server. The permit has NOT been issued.'
  }
  return fallback
}
