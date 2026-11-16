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
            to_char(GREATEST(spatial_planning.determination_deadline(p.acknowledged_at, p.development_type), p.extension_until) - INTERVAL '1 month', 'YYYY-MM-DD') AS ask_extension_by,
            to_char(GREATEST(spatial_planning.determination_deadline(p.acknowledged_at, p.development_type), p.extension_until) - INTERVAL '15 days', 'YYYY-MM-DD') AS resolve_by,
            p.statutory_checks,
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

/**
 * The questions the Act makes the council ask of every application (working workflow, section 4). The software cannot know whether a site is within 200 m of
 * a State road or in an aerodrome's obstacle limitation area, so the EO answers yes or no; a decision waits for every answer.
 * 'referral' names the body a "yes" has to be sent to (case_referral.statutory_key).
 */
const CHECKS = {
  road_within_200m:         { label: 'The site is within 200 m of the centre line of a State road', section: 's.26(2)(c), s.40(2)(c)', referral: 'road', body: 'the minister responsible for roads' },
  aviation_olz:             { label: "The site is within an aerodrome's obstacle limitation area", section: 's.26(2)(c), s.40(2)(c)', referral: 'aviation', body: 'the minister responsible for aviation' },
  neighbouring_authority:   { label: "The site is next to another planning authority's area", section: 's.26(4)(b)', referral: 'neighbouring', body: 'the neighbouring planning authority' },
  agricultural_subdivision: { label: 'The land is agricultural property outside a municipal or town council area (a subdivision)', section: 's.40(5)(a)(i)', referral: 'agriculture', body: 'the minister responsible for agriculture', subdivisionOnly: true },
  title_condition_conflict: { label: 'The proposal conflicts with a condition of title', section: 's.26(3), s.26(9)', referral: null, body: null },
  adverse_or_nonconforming: { label: 'The proposal is a non-conforming use or has an adverse impact', section: 's.26(3)', referral: null, body: null },
}
const checksFor = (devType) => Object.entries(CHECKS).filter(([, c]) => !c.subdivisionOnly || NEEDS_S2[devType] === 'L3').map(([k]) => k)

/** Which questions are unanswered, which "yes" answers still wait on a referral, and whether public notice is required. Pure. */
function checkState({ devType, classification, answers }, referrals) {
  const keys = checksFor(devType)
  const a = answers || {}
  const unanswered = keys.filter((k) => typeof a[k] !== 'boolean')
  const waiting = []
  for (const k of keys) {
    if (a[k] !== true || !CHECKS[k].referral) continue
    const r = (referrals || []).find((x) => x.statutory_key === CHECKS[k].referral)
    if (!r) waiting.push({ key: k, why: 'not sent', body: CHECKS[k].body })
    else if (!(r.answered_on || r.no_reply || r.month_passed)) waiting.push({ key: k, why: 'awaiting reply (they have one month, s.26(2)(c))', body: CHECKS[k].body })
  }
  const noticeRequired = classification === 'special_consent_26_3' || a.title_condition_conflict === true || a.adverse_or_nonconforming === true
  return { keys, unanswered, waiting, noticeRequired }
}

/** Copies the Act requires after a permit is issued (section 5, step 16): a subdivision goes to the Surveyor-General and the Registrar; a title-condition conflict to the Registrar. */
function copiesDue({ devType, answers }) {
  const out = []
  if (NEEDS_S2[devType] === 'L3') {
    out.push({ key: 'surveyor_general', body: 'the Surveyor-General', section: 's.40(7), (8)' })
    out.push({ key: 'registrar', body: 'the Registrar of Deeds', section: 's.40(7), (8)' })
  } else if ((answers || {}).title_condition_conflict === true) out.push({ key: 'registrar', body: 'the Registrar of Deeds', section: 's.26(9)' })
  return out
}

async function statutoryReferrals(q, permitId) {
  const { rows } = await q.query(
    `SELECT statutory_key, sent_on, answered_on, no_reply, (sent_on + INTERVAL '1 month' <= CURRENT_DATE) AS month_passed
       FROM spatial_planning.case_referral WHERE permit_app_id = $1 AND deleted_at IS NULL AND statutory_key IS NOT NULL`, [permitId])
  return rows
}

/** Public notice under s.26(3): the advert, the abutting owners and the site notice verified, and the objection period closed. */
async function noticeComplete(q, permitId) {
  const { rows } = await q.query(
    `SELECT advert_verified, abutting_owners_verified, site_notice_verified, objection_period_closed
       FROM spatial_planning.public_notice WHERE permit_app_id = $1`, [permitId])
  const n = rows[0]
  if (!n) return { complete: false, missing: ['no public-notice record exists'] }
  const missing = []
  if (!n.advert_verified) missing.push('the newspaper advert is not verified')
  if (!n.abutting_owners_verified) missing.push('the abutting owners are not verified as notified')
  if (!n.site_notice_verified) missing.push('the site notice is not verified')
  if (!n.objection_period_closed) missing.push('the objection period is not closed')
  return { complete: missing.length === 0, missing }
}

/** Objections: each considered, put to the applicant, and the applicant's 14 days to comment over or used (working workflow, step 9). */
async function objectionState(q, permitId) {
  const { rows } = await q.query(
    `SELECT objector_name, sustained, put_to_applicant_on, applicant_commented_on,
            (put_to_applicant_on + 14 <= CURRENT_DATE) AS comment_period_over,
            to_char(put_to_applicant_on + 14, 'YYYY-MM-DD') AS comment_due
       FROM spatial_planning.application_objection WHERE permit_app_id = $1`, [permitId])
  const problems = []
  for (const o of rows) {
    if (o.sustained === null) problems.push('the objection of ' + o.objector_name + ' has not been considered')
    if (!o.put_to_applicant_on) problems.push('the objection of ' + o.objector_name + ' has not been put to the applicant')
    else if (!o.applicant_commented_on && !o.comment_period_over) problems.push('the applicant has until ' + o.comment_due + ' to comment on the objection of ' + o.objector_name)
  }
  return { count: rows.length, problems }
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
  // 0. the case has been acknowledged: the Act's clock runs from it
  if (!c.acknowledged_at) {
    return { halt: stop(409, 'not_acknowledged', 'This application has not been acknowledged, so the clock under the Act has not started. Acknowledge it (s.26(2)) before it is decided.') }
  }
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

  // 4a to 4d. what the Act asks of an APPROVAL: the statutory questions answered, the referrals they lead to made, public notice where it is
  // required, and the objections put to the applicant and heard. A refusal does not wait for them: the council may refuse a case it cannot approve.
  if (status !== 'refused') {
    const st = checkState({ devType: c.development_type, classification: c.classification, answers: c.statutory_checks }, await statutoryReferrals(q, permitId))
    if (st.unanswered.length) {
      return { halt: stop(409, 'statutory_checks_required',
        'Answer the questions the Act asks of every application before it is approved: ' + st.unanswered.map((k) => CHECKS[k].label + ' (' + CHECKS[k].section + ')').join('; ') + '.', { unanswered: st.unanswered }) }
    }
    if (st.waiting.length) {
      return { halt: stop(409, 'statutory_referral_pending',
        'A referral the Act requires is outstanding: ' + st.waiting.map((w) => 'to ' + w.body + ' (' + w.why + ')').join('; ') + '. Record it in the referral log.', { waiting: st.waiting }) }
    }
    if (st.noticeRequired) {
      const n = await noticeComplete(q, permitId)
      if (!n.complete) {
        return { halt: stop(409, 'public_notice_incomplete', 'Public notice is required (s.26(3)) and is not complete: ' + n.missing.join('; ') + '.', { missing: n.missing }) }
      }
    }
    const ob = await objectionState(q, permitId)
    if (ob.problems.length) {
      return { halt: stop(409, 'objections_open', 'Objections are not yet dealt with: ' + ob.problems.join('; ') + '.', { problems: ob.problems }) }
    }
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

module.exports = { CHECKS, checksFor, checkState, copiesDue, statutoryReferrals, noticeComplete, objectionState, SWITCHES, DECISION_STATUS, loadSwitches, laneOf, caseFacts, directionsFor, latestResolution, checkDetermination }
