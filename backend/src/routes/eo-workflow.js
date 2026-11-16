/**
 * The EO Planning working workflow's records (docs/workflows/eo-planning-working-workflow.md):
 *   the switches S1 to S8 and what they open; the lane a case takes; the check against ministerial directions (step 5); the written extension
 *   the APPLICANT grants (step 14); the referral log (sections 3 and 4); the register of ministerial directions.
 * The decision itself is gated in POST /permit-applications/:id/eo-decision through services/eoWorkflow.js.
 *
 *   GET   /eo-workflow/switches                       staff
 *   PUT   /eo-workflow/switches/:key                  CEO (accounting_officer), admin: turn a switch on with its written evidence, or off
 *   GET   /eo-workflow/lane/:id                       staff: the lane of a case and why
 *   POST  /permit-applications/:id/direction-check    eo, admin: record that the case was checked against the directions in force
 *   POST  /permit-applications/:id/extension          eo, admin: record the applicant's written extension
 *   GET   /eo-workflow/referrals                      staff (?permit=<id>, ?open=1)
 *   POST  /eo-workflow/referrals                      eo, planner, admin
 *   PATCH /eo-workflow/referrals/:id                  eo, planner, admin: record the reply, or "no reply"
 *   GET   /eo-workflow/directions                     staff
 *   POST  /eo-workflow/directions                     eo, accounting_officer, admin
 *   PATCH /eo-workflow/directions/:id                 eo, accounting_officer, admin: end a direction, or record that the CEO was told
 */
const { requireRole } = require('../middleware/jwtAuth')
const { tenantPool } = require('../lib/tenancy')
const eoWorkflow = require('../services/eoWorkflow')

const STAFF = ['admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer', 'surveyor', 'gis_officer', 'accounting_officer']
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)
const text = (v, max = 4000) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

async function eoWorkflowRoutes(fastify) {
  const pg = fastify.pg
  const db = (request) => tenantPool(pg, request.user)
  const bad = (reply, error, message) => reply.code(400).send({ success: false, error, message })

  async function logEvent(permitId, eventType, request, detail) {
    try {
      await pg.query(
        `INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [permitId, eventType, request.user?.id || null, request.user?.role || null, JSON.stringify(detail || {})])
    } catch (err) { request.log.error({ err }, 'permit_event insert failed') }
  }

  // ── the switches ─────────────────────────────────────────────────────────────────────────
  fastify.get('/eo-workflow/switches', { preHandler: requireRole(fastify, STAFF) }, async (request, reply) => {
    const { rows } = await db(request).query(
      `SELECT s.switch_key, s.is_on, s.evidence, s.confirmed_at, COALESCE(u.full_name, u.name) AS confirmed_by
         FROM spatial_planning.delegation_switch s LEFT JOIN public.users u ON u.id = s.confirmed_by`)
    const byKey = Object.fromEntries(rows.map((r) => [r.switch_key, r]))
    return reply.send({
      success: true,
      data: Object.entries(eoWorkflow.SWITCHES).map(([key, label]) => ({
        key, label, is_on: byKey[key]?.is_on === true, evidence: byKey[key]?.evidence || null,
        confirmed_at: byKey[key]?.confirmed_at || null, confirmed_by: byKey[key]?.confirmed_by || null,
      })),
    })
  })

  fastify.put('/eo-workflow/switches/:key', { preHandler: requireRole(fastify, ['accounting_officer', 'admin']) }, async (request, reply) => {
    const key = request.params.key
    if (!eoWorkflow.SWITCHES[key]) return bad(reply, 'bad_switch', 'The switches are S1 to S8.')
    const b = request.body || {}
    if (typeof b.is_on !== 'boolean') return bad(reply, 'bad_request', 'is_on must be true or false.')
    const evidence = text(b.evidence)
    if (b.is_on && (!evidence || evidence.length < 5)) {
      return bad(reply, 'evidence_required', 'A switch is turned on only with the written confirmation behind it: say which resolution, instrument or letter, and its date.')
    }
    try {
      const { rows } = await db(request).query(
        `INSERT INTO spatial_planning.delegation_switch (switch_key, is_on, evidence, confirmed_by, confirmed_at)
              VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (authority_id, switch_key)
           DO UPDATE SET is_on = EXCLUDED.is_on, evidence = EXCLUDED.evidence, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now(), updated_at = now()
         RETURNING switch_key, is_on, evidence, confirmed_at`,
        [key, b.is_on, evidence, request.user.id])
      await db(request).query(
        `INSERT INTO spatial_planning.delegation_switch_event (switch_key, is_on, evidence, changed_by) VALUES ($1,$2,$3,$4)`,
        [key, b.is_on, evidence, request.user.id])
      return reply.send({ success: true, data: rows[0] })
    } catch (err) {
      request.log.error({ err }, 'switch update failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })

  // ── the lane of a case ───────────────────────────────────────────────────────────────────
  fastify.get('/eo-workflow/lane/:id', { preHandler: requireRole(fastify, STAFF) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const q = db(request)
    const c = await eoWorkflow.caseFacts(q, request.params.id)
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' })
    const sw = await eoWorkflow.loadSwitches(q)
    const directions = await eoWorkflow.directionsFor(q, c.development_type)
    const binding = directions.filter((d) => d.refers_to_minister || d.restricts)
    const resolution = await eoWorkflow.latestResolution(q, request.params.id)
    const lane = eoWorkflow.laneOf({ devType: c.development_type, classification: c.classification, objectionCount: c.objection_count, directionApplies: binding.length > 0 }, sw)
    const latestDirection = directions.reduce((m, d) => (d.created_at > m ? d.created_at : m), null)
    const refs = await eoWorkflow.statutoryReferrals(q, request.params.id)
    const st = eoWorkflow.checkState({ devType: c.development_type, classification: c.classification, answers: c.statutory_checks }, refs)
    const notice = st.noticeRequired ? await eoWorkflow.noticeComplete(q, request.params.id) : null
    const objections = await eoWorkflow.objectionState(q, request.params.id)
    const sent = new Set((await q.query(
      `SELECT statutory_key FROM spatial_planning.case_referral WHERE permit_app_id = $1 AND deleted_at IS NULL AND statutory_key IS NOT NULL`, [request.params.id])).rows.map((r) => r.statutory_key))
    return reply.send({
      success: true,
      data: {
        milestones: c.deemed_on ? { ask_extension_by: c.ask_extension_by, resolve_by: c.resolve_by, deemed_on: c.deemed_on } : null,
        checks: st.keys.map((k) => ({ key: k, label: eoWorkflow.CHECKS[k].label, section: eoWorkflow.CHECKS[k].section, referral_body: eoWorkflow.CHECKS[k].body, answer: typeof (c.statutory_checks || {})[k] === 'boolean' ? c.statutory_checks[k] : null })),
        checks_unanswered: st.unanswered,
        referrals_waiting: st.waiting,
        notice_required: st.noticeRequired,
        notice_missing: notice ? notice.missing : [],
        objection_problems: objections.problems,
        copies_due: eoWorkflow.copiesDue({ devType: c.development_type, answers: c.statutory_checks }).map((x) => ({ ...x, recorded: sent.has(x.key) })),
        lane: lane.lane, open: lane.open, reasons: lane.reasons,
        deemed_on: c.deemed_on, extension_until: c.extension_until_text, acknowledged_at: c.acknowledged_at,
        direction_checked_at: c.direction_checked_at,
        direction_check_current: !!c.direction_checked_at && !(latestDirection && new Date(latestDirection) > new Date(c.direction_checked_at)),
        binding_directions: binding.map((d) => ({ id: d.id, reference: d.reference, section: d.section, summary: d.summary })),
        committee: resolution ? { outcome: resolution.outcome, resolution: resolution.resolution, heard_at: resolution.heard_at } : null,
        switches: sw,
      },
    })
  })

  // ── step 5: the direction check ──────────────────────────────────────────────────────────
  fastify.post('/permit-applications/:id/direction-check', { preHandler: requireRole(fastify, ['eo', 'admin']) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.permit_application SET direction_checked_at = now(), direction_checked_by = $2, updated_at = now()
        WHERE id = $1 RETURNING id, direction_checked_at`, [request.params.id, request.user.id])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    await logEvent(request.params.id, 'direction_checked', request, {})
    return reply.send({ success: true, data: rows[0] })
  })

  // ── step 14: the applicant's written extension ───────────────────────────────────────────
  fastify.post('/permit-applications/:id/extension', { preHandler: requireRole(fastify, ['eo', 'admin']) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const b = request.body || {}
    if (!isDate(b.extension_until)) return bad(reply, 'bad_date', 'extension_until must be a date (YYYY-MM-DD).')
    const evidence = text(b.evidence)
    if (!evidence || evidence.length < 5) return bad(reply, 'evidence_required', "An extension is the applicant's to grant, in writing: say where the letter is filed and its date.")
    const c = await eoWorkflow.caseFacts(db(request), request.params.id)
    if (!c) return reply.code(404).send({ success: false, error: 'not_found' })
    if (!c.statutory_deadline) return bad(reply, 'not_acknowledged', 'The clock starts at acknowledgement; acknowledge the application first.')
    if (c.deemed_past === true) {
      return reply.code(409).send({ success: false, error: 'deemed_refused', message: 'The application is already deemed refused; an extension cannot revive it. The applicant may lodge a new application or appeal.' })
    }
    if (b.extension_until <= c.deemed_on) return bad(reply, 'not_later', 'The extension must be later than the date the application would be deemed refused.')
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.permit_application
          SET extension_until = $2, extension_evidence = $3, extension_recorded_by = $4, statutory_due_date = $2, updated_at = now()
        WHERE id = $1 RETURNING id, extension_until`, [request.params.id, b.extension_until, evidence, request.user.id])
    await logEvent(request.params.id, 'extension_recorded', request, { extension_until: b.extension_until, evidence })
    return reply.send({ success: true, data: rows[0] })
  })

  // ── the statutory checks (the questions the Act makes the council ask) ───────────────────
  fastify.post('/permit-applications/:id/statutory-checks', { preHandler: requireRole(fastify, ['eo', 'planner', 'admin']) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const a = (request.body || {}).answers
    if (!a || typeof a !== 'object') return bad(reply, 'bad_request', 'Send the answers as { key: true | false }.')
    const clean = {}
    for (const [k, v] of Object.entries(a)) {
      if (!eoWorkflow.CHECKS[k]) return bad(reply, 'bad_check', 'Unknown question: ' + k)
      if (typeof v !== 'boolean') return bad(reply, 'bad_answer', 'Each answer is yes or no (true or false): ' + k)
      clean[k] = v
    }
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.permit_application
          SET statutory_checks = statutory_checks || $2::jsonb, statutory_checks_at = now(), statutory_checks_by = $3, updated_at = now()
        WHERE id = $1 RETURNING id, statutory_checks`, [request.params.id, JSON.stringify(clean), request.user.id])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    await logEvent(request.params.id, 'statutory_checks_recorded', request, { answers: clean })
    return reply.send({ success: true, data: rows[0] })
  })

  // ── the objection steps: put to the applicant, and the applicant's comment ───────────────
  const OBJECTION_STAFF = ['eo', 'planner', 'planning_clerk', 'admin']
  fastify.patch('/objections/:oid/put-to-applicant', { preHandler: requireRole(fastify, OBJECTION_STAFF) }, async (request, reply) => {
    if (!isUuid(request.params.oid)) return bad(reply, 'bad_id')
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.application_objection SET put_to_applicant_on = COALESCE(put_to_applicant_on, CURRENT_DATE)
        WHERE id = $1 RETURNING id, permit_app_id, put_to_applicant_on, to_char(put_to_applicant_on + 14, 'YYYY-MM-DD') AS comment_due`, [request.params.oid])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    await logEvent(rows[0].permit_app_id, 'objection_put_to_applicant', request, { objection_id: rows[0].id })
    return reply.send({ success: true, data: rows[0] })
  })

  fastify.patch('/objections/:oid/applicant-comment', { preHandler: requireRole(fastify, OBJECTION_STAFF) }, async (request, reply) => {
    if (!isUuid(request.params.oid)) return bad(reply, 'bad_id')
    const comment = text((request.body || {}).comment, 8000)
    if (!comment) return bad(reply, 'comment_required', 'Record what the applicant said.')
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.application_objection SET applicant_comment = $2, applicant_commented_on = CURRENT_DATE
        WHERE id = $1 AND put_to_applicant_on IS NOT NULL RETURNING id, permit_app_id, applicant_commented_on`, [request.params.oid, comment])
    if (!rows[0]) return reply.code(409).send({ success: false, error: 'not_put_to_applicant', message: 'The objection has not been put to the applicant yet.' })
    await logEvent(rows[0].permit_app_id, 'applicant_commented', request, { objection_id: rows[0].id })
    return reply.send({ success: true, data: rows[0] })
  })

  // ── the referral log ─────────────────────────────────────────────────────────────────────
  fastify.get('/eo-workflow/referrals', { preHandler: requireRole(fastify, STAFF) }, async (request, reply) => {
    const { permit, open } = request.query || {}
    if (permit !== undefined && !isUuid(permit)) return bad(reply, 'bad_id')
    const { rows } = await db(request).query(
      `SELECT r.*, (r.answered_on IS NULL AND NOT r.no_reply AND r.reply_by IS NOT NULL AND r.reply_by < CURRENT_DATE) AS overdue
         FROM spatial_planning.case_referral r
        WHERE r.deleted_at IS NULL
          AND ($1::uuid IS NULL OR r.permit_app_id = $1)
          AND ($2::boolean IS NOT TRUE OR (r.answered_on IS NULL AND NOT r.no_reply))
        ORDER BY r.sent_on DESC, r.created_at DESC`, [permit || null, open === '1' || open === 'true'])
    return reply.send({ success: true, data: rows })
  })

  fastify.post('/eo-workflow/referrals', { preHandler: requireRole(fastify, ['eo', 'planner', 'admin']) }, async (request, reply) => {
    const b = request.body || {}
    const kind = ['department', 'minister', 'statutory', 'other'].includes(b.kind) ? b.kind : null
    const tier = b.tier === undefined ? 'precautionary' : (['mandatory', 'precautionary', 'routine'].includes(b.tier) ? b.tier : null)
    const body = text(b.body, 300), question = text(b.question)
    if (!kind || !tier || !body || !question) return bad(reply, 'bad_request', 'A referral needs a kind, the body it goes to, and the question.')
    if (b.permit_app_id !== undefined && b.permit_app_id !== null && !isUuid(b.permit_app_id)) return bad(reply, 'bad_id')
    const KEYS = ['road', 'aviation', 'neighbouring', 'agriculture', 'registrar', 'surveyor_general']
    const statutoryKey = b.statutory_key === undefined || b.statutory_key === null ? null : (KEYS.includes(b.statutory_key) ? b.statutory_key : false)
    if (statutoryKey === false) return bad(reply, 'bad_request', 'statutory_key must be one of ' + KEYS.join(', ') + '.')
    if (statutoryKey && !b.permit_app_id) return bad(reply, 'bad_request', 'A statutory referral belongs to a case.')
    const topic = text(b.topic, 300)
    if (!b.permit_app_id && !topic) return bad(reply, 'bad_request', 'Say which case it is about, or the topic.')
    // the reply-by date: given, or 21 days after sending (the working workflow's proposed figure)
    const sent = isDate(b.sent_on) ? b.sent_on : null
    const { rows } = await db(request).query(
      `INSERT INTO spatial_planning.case_referral
         (permit_app_id, topic, kind, tier, body, legal_basis, question, sent_on, reply_by, created_by, statutory_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::date, CURRENT_DATE), COALESCE($9::date, COALESCE($8::date, CURRENT_DATE) + 21), $10, $11)
       RETURNING *`,
      [b.permit_app_id || null, topic, kind, tier, body, text(b.legal_basis, 300), question, sent, isDate(b.reply_by) ? b.reply_by : null, request.user.id, statutoryKey])
    if (rows[0].permit_app_id) await logEvent(rows[0].permit_app_id, 'referral_sent', request, { referral_id: rows[0].id, kind, body, tier })
    return reply.code(201).send({ success: true, data: rows[0] })
  })

  fastify.patch('/eo-workflow/referrals/:id', { preHandler: requireRole(fastify, ['eo', 'planner', 'admin']) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const b = request.body || {}
    const noReply = b.no_reply === true
    const advice = text(b.advice, 8000)
    if (!noReply && !advice) return bad(reply, 'bad_request', 'Record the advice received, or record that no reply came.')
    if (b.answered_on !== undefined && !isDate(b.answered_on)) return bad(reply, 'bad_date')
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.case_referral
          SET answered_on = CASE WHEN $2 THEN NULL ELSE COALESCE($3::date, CURRENT_DATE) END,
              advice = $4, no_reply = $2, council_action = COALESCE($5, council_action), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, noReply, b.answered_on || null, advice, text(b.council_action)])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    if (rows[0].permit_app_id) await logEvent(rows[0].permit_app_id, noReply ? 'referral_no_reply' : 'referral_answered', request, { referral_id: rows[0].id })
    return reply.send({ success: true, data: rows[0] })
  })

  // ── the register of ministerial directions ───────────────────────────────────────────────
  fastify.get('/eo-workflow/directions', { preHandler: requireRole(fastify, STAFF) }, async (request, reply) => {
    const { rows } = await db(request).query(
      `SELECT * FROM spatial_planning.ministerial_direction WHERE deleted_at IS NULL ORDER BY in_force DESC, received_on DESC`)
    return reply.send({ success: true, data: rows })
  })

  fastify.post('/eo-workflow/directions', { preHandler: requireRole(fastify, ['eo', 'accounting_officer', 'admin']) }, async (request, reply) => {
    const b = request.body || {}
    const section = ['s29', 's69', 's70', 'other'].includes(b.section) ? b.section : null
    const summary = text(b.summary)
    if (!section || !summary || !isDate(b.received_on)) return bad(reply, 'bad_request', 'A direction needs its section (s29, s69, s70 or other), the date received, and a summary.')
    const types = Array.isArray(b.applies_to_dev_types) && b.applies_to_dev_types.length ? b.applies_to_dev_types.filter((t) => typeof t === 'string') : null
    const { rows } = await db(request).query(
      `INSERT INTO spatial_planning.ministerial_direction
         (reference, section, received_on, summary, refers_to_minister, restricts, applies_to_dev_types, ceo_informed_on, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [text(b.reference, 200), section, b.received_on, summary, b.refers_to_minister === true, b.restricts === true, types,
       isDate(b.ceo_informed_on) ? b.ceo_informed_on : null, request.user.id])
    return reply.code(201).send({ success: true, data: rows[0] })
  })

  fastify.patch('/eo-workflow/directions/:id', { preHandler: requireRole(fastify, ['eo', 'accounting_officer', 'admin']) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return bad(reply, 'bad_id')
    const b = request.body || {}
    const { rows } = await db(request).query(
      `UPDATE spatial_planning.ministerial_direction
          SET in_force = COALESCE($2, in_force),
              ended_on = CASE WHEN $2 IS FALSE THEN COALESCE($3::date, CURRENT_DATE) ELSE ended_on END,
              ceo_informed_on = COALESCE($4::date, ceo_informed_on), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, typeof b.in_force === 'boolean' ? b.in_force : null, isDate(b.ended_on) ? b.ended_on : null, isDate(b.ceo_informed_on) ? b.ceo_informed_on : null])
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'not_found' })
    return reply.send({ success: true, data: rows[0] })
  })
}

module.exports = { eoWorkflowRoutes }
