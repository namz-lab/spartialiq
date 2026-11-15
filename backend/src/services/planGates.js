/**
 * The plan constrains the Executive Officer's determination (migration 231 and routes/development-management.js).
 *
 * For an APPROVAL (approve, approve with conditions) the plan's decision for the land use assessed on the application is read from the latest
 * assessment snapshot, and what that decision implies is required before the determination is recorded:
 *
 *   prohibited                             a departure_reason: why the council approves a use its plan prohibits here
 *   special consent                        public notice completed (advert, abutting owners, site notice, objection period closed), or a departure_reason
 *   not decided, or only PROPOSED          rules_acknowledged: the EO accepts that the rule is not an agreed decision of the plan
 *   no parcel, or no land use assessed     a plan_note: why the plan could not be applied (for example "land not in the register")
 *   permitted, by the EO                   nothing
 *
 * A REFUSAL is never gated. A requirement met is written to the case history (plan_departure, rules_acknowledged, plan_note) with who and why.
 * The gate reads the snapshot recorded on the application, never anything the client sends about the plan.
 */

const APPROVALS = new Set(['approve', 'approve_with_conditions'])
const MIN_REASON = 10

const isReason = (v) => typeof v === 'string' && v.trim().length >= MIN_REASON && v.length <= 4000

/** The plan basis of an application: its parcel, the latest assessment, and whether the public notice is complete. */
async function loadBasis(db, permitId) {
  const { rows: [permit] } = await db.query(
    'SELECT id, parcel_layer, parcel_id, parcel_match, plan_instrument_id FROM spatial_planning.permit_application WHERE id = $1', [permitId])
  if (!permit) return null
  const { rows: [snap] } = await db.query(
    `SELECT id, land_use_code, snapshot, taken_at FROM spatial_planning.permit_rule_snapshot
      WHERE permit_id = $1 AND kind = 'assessment' ORDER BY taken_at DESC, id DESC LIMIT 1`, [permitId])
  const { rows: [notice] } = await db.query(
    `SELECT (advert_verified AND abutting_owners_verified AND site_notice_verified AND objection_period_closed) AS complete
       FROM spatial_planning.public_notice WHERE permit_app_id = $1`, [permitId])
  const results = snap?.snapshot?.results ?? []
  const governing = results.find((r) => r.governing) ?? results[0] ?? null
  return { permit, assessment: snap ?? null, governing, noticeComplete: Boolean(notice?.complete) }
}

/** What the plan says about this application, in words and codes the screen can show. */
function describeBasis(basis) {
  const g = basis.governing
  return {
    parcel: basis.permit.parcel_id ? { layer: basis.permit.parcel_layer, id: basis.permit.parcel_id, match: basis.permit.parcel_match } : null,
    assessed: Boolean(basis.assessment),
    land_use: g?.land_use ?? (basis.assessment ? { code: basis.assessment.land_use_code, description: null } : null),
    zone: g?.zone ?? null,
    plan: g?.plan ?? null,
    decision: g?.decision ?? null,
    authority: g?.decision_authority ?? null,
    provisional_decision: Boolean(g?.decision_provisional),
    pathway: g?.pathway ?? null,
    public_notice_complete: basis.noticeComplete,
  }
}

/**
 * @param decision  the determination: approve | approve_with_conditions | refuse
 * @param basis     loadBasis()
 * @param body      the request body (departure_reason, rules_acknowledged, plan_note)
 * @returns {{ gated: boolean, requirements: object[], missing: object[], record: object[] }}
 *   requirements: everything the plan asks for here; missing: what the body did not supply; record: the case-history events to write if the determination goes ahead
 */
function evaluate(decision, basis, body = {}) {
  if (!APPROVALS.has(decision)) return { gated: false, requirements: [], missing: [], record: [] }
  const requirements = []
  const ask = (code, field, message) => requirements.push({ code, field, message })
  const g = basis.governing

  if (!basis.permit.parcel_id) {
    ask('no_parcel', 'plan_note', 'This application is not linked to a parcel of the register, so the plan could not be applied. Say why it is being decided without it.')
  } else if (!basis.assessment) {
    ask('no_assessment', 'plan_note', 'No land use has been assessed against the plan for this application. Assess it, or say why it is being decided without.')
  } else if (!g || !g.decision) {
    ask('not_decided', 'rules_acknowledged', 'The plan has not decided this use in this zone. Confirm that you are deciding it by judgement.')
  } else {
    if (g.decision === 'prohibited') {
      ask('prohibited_use', 'departure_reason', 'The plan prohibits this use in this zone. Give the reason for approving it.')
    }
    if (g.decision === 'special_consent' && !basis.noticeComplete && g.pathway?.requires_public_notice !== false) {
      ask('special_consent_no_notice', 'departure_reason',
        'This use needs special consent, which needs public notice to be completed (advert, abutting owners, site notice, objection period closed). Complete it, or give the reason for deciding without.')
    }
    if (g.decision_provisional) {
      ask('proposed_rule', 'rules_acknowledged', 'This decision is a proposal (best practice), not yet agreed by the Executive Officer. Confirm that you accept it for this determination.')
    }
  }

  const supplied = {
    departure_reason: isReason(body.departure_reason) ? body.departure_reason.trim() : null,
    rules_acknowledged: body.rules_acknowledged === true,
    plan_note: isReason(body.plan_note) ? body.plan_note.trim() : null,
  }
  const met = (r) => (r.field === 'rules_acknowledged' ? supplied.rules_acknowledged : Boolean(supplied[r.field]))
  const missing = requirements.filter((r) => !met(r))

  const context = {
    decision: g?.decision ?? null, authority: g?.decision_authority ?? null, zone: g?.zone?.name ?? null,
    land_use: g?.land_use?.code ?? basis.assessment?.land_use_code ?? null, plan: g?.plan?.title ?? null, plan_status: g?.plan?.status ?? null,
  }
  const record = requirements.filter(met).map((r) => ({
    event: r.field === 'departure_reason' ? 'plan_departure' : r.field === 'rules_acknowledged' ? 'rules_acknowledged' : 'plan_note',
    detail: { code: r.code, ...(r.field === 'rules_acknowledged' ? {} : { reason: supplied[r.field] }), ...context },
  }))
  return { gated: requirements.length > 0, requirements, missing, record }
}

module.exports = { APPROVALS, MIN_REASON, loadBasis, describeBasis, evaluate }
