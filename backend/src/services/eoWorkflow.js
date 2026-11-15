/**
 * The controls of the EO Planning working workflow (docs/workflows/eo-planning-working-workflow.md), applied to a determination.
 *
 * Safe by default (rule 1): the EO decides on a committee or council resolution that matches the decision. The EO's own (delegated)
 * lane is open only when the council's confirmations are recorded as switches (S1, S3, and S5 for a refusal), and never for a case
 * the workflow keeps for the committee. Subdivisions, consolidations and rezonings are decided only if the Minister's instrument
 * authorising the council is recorded (S2). The statutory clock never stops (rule 2): an approval after the deemed-refusal date,
 * counted to any extension the applicant gave in writing, is refused here.
 *
 * Every function takes `q`, anything with `.query(text, params)`, so the caller's connection (and so its tenancy) is used.
 */

const DECISION_STATUS = { approve: 'approved', approve_with_conditions: 'approved_with_conditions', refuse: 'refused' }

/** The switches and what each one opens, as the working workflow lists them (section 7). */
const SWITCHES = {
  S1: 'The council resolution delegating determination to the EO, by name or designation',
  S2: "The Minister's instrument authorising the council for Part IV and/or Part VI (s.10(1)(b))",
  S3: 'An operative plan or approved scheme covers the land (s.12(3)(b))',
  S4: "The committee's own delegation, membership and quorum",
  S5: 'Written answer that the EO may refuse under delegation',
  S6: 'The legal adviser\'s answer on review of a delegated decision',
  S7: "The Department's returns and information requirements",
  S8: 'The current text of the Act after 1998',
}

/** Development types the working workflow keeps from the committee unless S2 is on. */
const NEEDS_S2 = { subdivision: 'L3', consolidation: 'L3', rezoning: 'L7' }

async function loadSwitches(q) {
  const { rows } = await q.query('SELECT switch_key, is_on FROM spatial_planning.delegation_switch')
  const on = {}
  for (const k of Object.keys(SWITCHES)) on[k] = false
  for (const r of rows) on[r.switch_key] = r.is_on === true
  return on
}

/**
 * Which lane a case takes, and why (working workflow, section 2). Pure.
 * L1 permit by committee; L2 permit delegated to the EO; L3 subdivision or consolidation; L7 plan work (rezoning).
 */
function laneOf({ devType, classification, objectionCount, directionApplies }, sw, { committeeResolved = false } = {}) {
  const reasons = []
  if (NEEDS_S2[devType]) {
    const lane = NEEDS_S2[devType]
    return { lane, open: sw.S2 === true, reasons: sw.S2 ? [] : [`${lane} is closed until the Minister's authorising instrument is recorded (switch S2).`] }
  }
  if (committeeResolved) return { lane: 'L1', open: true, reasons: [] }
  // no resolution: could the EO decide alone? (the cases the workflow keeps for the committee never can)
  if (classification === 'special_consent_26_3') reasons.push('Special consent is reserved to the committee.')
  if (objectionCount > 0) reasons.push(`${objectionCount} objection${objectionCount === 1 ? ' was' : 's were'} received; the committee decides.`)
  if (directionApplies) reasons.push('A ministerial direction applies to this class of case.')
  if (!sw.S1) reasons.push('The council has not recorded its delegation to the EO (switch S1).')
  if (!sw.S3) reasons.push('No operative plan or approved scheme is recorded for the land (switch S3).')
  return { lane: 'L2', open: reasons.length === 0, reasons }
}

/** The facts of a case the gates need, read once. */
async function caseFacts(q, permitId) {
  const { rows } = await q.query(
    `SELECT p.id, p.development_type, p.classification, p.acknowledged_at, p.extension_until, p.direction_checked_at,
            to_char(spatial_planning.determination_deadline(p.acknowledged_at, p.development_type), 'YYYY-MM-DD') AS statutory_deadline,
            to_char(GREATEST(spatial_planning.determination_deadline(p.acknowledged_at, p.development_type), p.extension_until), 'YYYY-MM-DD') AS deemed_on,
            (CURRENT_DATE > GREATEST(spatial_planning.determination_deadline(p.acknowledged_at, p.development_type), p.extension_until)) AS deemed_past,
            to_char(p.extension_until, 'YYYY-MM-DD') AS extension_until_text,
            (SELECT count(*) FROM spatial_planning.application_objection o WHERE o.permit_app_id = p.id)::int AS objection_count
       FROM spatial_planning.permit_application p WHERE p.id = $1`, [permitId])
  return rows[0] || null
}

/** In-force ministerial directions that bear on this class of case. */
async function directionsFor(q, devType) {
  const { rows } = await q.query(
    `SELECT id, reference, section, summary, refers_to_minister, restricts, created_at
       FROM spatial_planning.ministerial_direction
      WHERE deleted_at IS NULL AND in_force AND (ended_on IS NULL OR ended_on > CURRENT_DATE)
        AND (applies_to_dev_types IS NULL OR $1 = ANY (applies_to_dev_types))
      ORDER BY received_on DESC`, [devType])
  return rows
}

/** The committee's latest recorded resolution on this case, if any. */
async function latestResolution(q, permitId) {
  const { rows } = await q.query(
    `SELECT a.id, a.outcome, a.resolution, a.heard_at
       FROM spatial_planning.agenda_item a
       JOIN spatial_planning.committee_meeting m ON m.id = a.meeting_id
      WHERE a.permit_app_id = $1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL
        AND a.outcome <> 'pending' AND a.resolution IS NOT NULL
      ORDER BY a.heard_at DESC NULLS LAST, a.created_at DESC LIMIT 1`, [permitId])
  return rows[0] || null
}

const stop = (status, error, message, extra = {}) => ({ status, body: { success: false, error, message, ...extra } })

/**
 * The gates, in the order the working workflow gives them. Returns null to proceed, or { status, body } to send.
 * Also returns, on success through `out.basis`, what the decision rests on (for the record).
 */
async function checkDetermination(q, permitId, { decision, notes, delegated, adminOverride, overrideReason }) {
  const status = DECISION_STATUS[decision]
  const c = await caseFacts(q, permitId)
  if (!c) return { halt: stop(404, 'not_found', 'Case not found.') }
  const sw = await loadSwitches(q)
  const directions = await directionsFor(q, c.development_type)
  const binding = directions.filter((d) => d.refers_to_minister || d.restricts)
  const resolution = await latestResolution(q, permitId)
  const committeeResolved = !!resolution && resolution.outcome === status

  // 1. the lane must be open
  const lane = laneOf({ devType: c.development_type, classification: c.classification, objectionCount: c.objection_count, directionApplies: binding.length > 0 }, sw, { committeeResolved })
  if ((lane.lane === 'L3' || lane.lane === 'L7') && !lane.open) {
    return { halt: stop(409, 'lane_closed', lane.reasons[0], { lane: lane.lane, switch: 'S2' }) }
  }

  // 2. the statutory clock: no approval after the case is deemed refused
  if (status !== 'refused' && c.deemed_past === true) {
    return { halt: stop(409, 'deemed_refused',
      `This application was deemed refused on ${c.deemed_on} (s.26(7), s.40(6)). It cannot now be approved. `
      + 'Record an extension only if the applicant agreed one in writing before that date.', { deemed_on: c.deemed_on }) }
  }

  // 3. ministerial directions (step 5)
  if (binding.length) {
    return { halt: stop(409, 'ministerial_direction_applies',
      `A ministerial direction (${binding[0].reference || binding[0].section}) applies to this class of case: ${binding[0].summary} Follow it and record what was done.`, { directions: binding.map((d) => d.id) }) }
  }
  const latestDirection = directions.reduce((m, d) => (d.created_at > m ? d.created_at : m), null)
  if (!c.direction_checked_at || (latestDirection && new Date(latestDirection) > new Date(c.direction_checked_at))) {
    return { halt: stop(409, 'direction_check_required',
      'Check this case against the ministerial directions in force and record the check before deciding (working workflow, step 5).') }
  }

  // 4. a blocking circulation reply still outstanding
  const blocking = await q.query(
    `SELECT body_name FROM spatial_planning.application_consultation
      WHERE permit_app_id = $1 AND blocking AND response_status = 'pending' AND task_status NOT IN ('cancelled')`, [permitId])
  if (blocking.rows.length) {
    return { halt: stop(409, 'blocking_consultation_pending',
      `A reply the circulation marked as blocking is still outstanding: ${blocking.rows.map((r) => r.body_name).join(', ')}.`) }
  }

  // 5. a refusal gives written reasons (s.26(6)(b))
  if (status === 'refused' && !(typeof notes === 'string' && notes.trim().length >= 10)) {
    return { halt: stop(400, 'refusal_reasons_required', 'A refusal must give its reasons in writing (s.26(6)(b)).') }
  }

  // 6. what the decision rests on
  if (committeeResolved) return { basis: { kind: 'committee_resolution', agenda_item_id: resolution.id, lane: lane.lane } }
  if (resolution && !committeeResolved) {
    return { halt: stop(409, 'resolution_mismatch',
      `The committee's latest resolution is "${resolution.outcome}", which is not the decision being made ("${status}"). Record a resolution that matches, or return the case to the committee.`,
      { resolved: resolution.outcome, decision: status }) }
  }
  if (adminOverride) {
    if (!(typeof overrideReason === 'string' && overrideReason.trim().length >= 10)) {
      return { halt: stop(400, 'override_reason_required', 'An administrator override needs a written reason.') }
    }
    return { basis: { kind: 'admin_override', reason: overrideReason.trim(), lane: lane.lane } }
  }
  if (delegated) {
    const missing = [...lane.reasons]
    if (status === 'refused' && !sw.S5) missing.push('The council has not confirmed that the EO may refuse under delegation (switch S5).')
    if (missing.length === 0) return { basis: { kind: 'delegation', reference: String(delegated).trim(), lane: 'L2' } }
    return { halt: stop(409, 'delegation_not_open', 'The EO\'s delegated lane is closed for this case. ' + missing.join(' '), { lane: 'L2', reasons: missing }) }
  }
  return { halt: stop(409, 'committee_resolution_required',
    'A committee resolution is required before this determination. Table the application on a committee agenda and record the resolution.', { lane: lane.lane, reasons: lane.reasons }) }
}

module.exports = { SWITCHES, DECISION_STATUS, loadSwitches, laneOf, caseFacts, directionsFor, latestResolution, checkDetermination }
