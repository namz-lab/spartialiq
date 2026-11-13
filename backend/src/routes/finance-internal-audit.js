/**
 * The internal audit plan and its findings (migration 210).
 *
 *   GET   /finance/internal-audit/engagements          the plan (finance.audit.view)
 *   POST  /finance/internal-audit/engagements          add an audit to it (finance.audit.manage)
 *   PATCH /finance/internal-audit/engagements/:id      move it on: phase, status, dates, lead
 *   GET   /finance/internal-audit/findings             the register (finance.audit.view)
 *   POST  /finance/internal-audit/findings             record a finding (finance.audit.manage)
 *   PATCH /finance/internal-audit/findings/:id         change it, or close it with a note
 *   GET   /finance/internal-audit/auditors             who can lead an audit
 *
 * These are the auditor's conclusions, not finance records: nothing here moves money. A finding is
 * never deleted; closing it needs a note, and a closed finding is not reopened by editing it.
 * Every write is filed in the admin trail as FIN_INTERNAL_AUDIT (middleware/auditLog.js).
 */

const { requirePermission } = require('../middleware/financePermissions')
const { systemOf } = require('../lib/dbContext')

const ok = (reply, data, code = 200) => reply.code(code).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

const uuid = { type: 'string', format: 'uuid' }
const date = { type: ['string', 'null'], format: 'date' }
const text = (max) => ({ type: ['string', 'null'], maxLength: max })

const ENGAGEMENT = `
  SELECT e.id, e.financial_year_id, e.title, e.area, e.phase, e.status,
         e.planned_start::text AS planned_start, e.planned_end::text AS planned_end,
         e.lead_user_id, COALESCE(u.full_name, u.name) AS lead_name, e.notes, e.completed_at,
         e.created_at, e.updated_at,
         (SELECT count(*)::int FROM finance.audit_finding f WHERE f.engagement_id = e.id) AS findings,
         (SELECT count(*)::int FROM finance.audit_finding f WHERE f.engagement_id = e.id AND f.status = 'open') AS open_findings
    FROM finance.audit_engagement e LEFT JOIN public.users u ON u.id = e.lead_user_id`

const FINDING = `
  SELECT f.id, f.engagement_id, e.title AS engagement_title, e.area, f.title, f.detail, f.risk, f.status,
         f.action, f.action_owner, f.due_date::text AS due_date, f.closed_at, f.closure_note,
         COALESCE(cu.full_name, cu.name) AS closed_by_name, f.created_at, f.updated_at,
         (f.status = 'open' AND f.due_date < CURRENT_DATE) AS overdue
    FROM finance.audit_finding f
    JOIN finance.audit_engagement e ON e.id = f.engagement_id
    LEFT JOIN public.users cu ON cu.id = f.closed_by`

async function financeInternalAuditRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.audit.view') }
  const canManage = { preHandler: requirePermission(fastify, 'finance.audit.manage') }

  const refuse = (reply, err, what) => {
    if (err.code === '23514' || err.code === '23503' || err.code === '22007') {
      return fail(reply, 422, 'invalid', `The ${what} was refused: ${err.message}`)
    }
    fastify.log.error({ err }, `internal audit ${what}`)
    return fail(reply, 500, 'internal_audit_error', `The ${what} could not be saved.`)
  }

  fastify.get('/finance/internal-audit/auditors', canView, async (request, reply) => {
    // Who holds a permission is read from the catalogue, which only the system role reads.
    const { rows } = await systemOf(pg).query(
      `SELECT u.id, COALESCE(u.full_name, u.name) AS name, u.role FROM public.users u
        WHERE u.deleted_at IS NULL AND COALESCE(u.active, true)
          AND EXISTS (SELECT 1 FROM finance.role_permission rp WHERE rp.role_name = u.role AND rp.permission_code = 'finance.audit.manage')
        ORDER BY 2`)
    return ok(reply, rows)
  })

  fastify.get('/finance/internal-audit/engagements', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      financial_year_id: uuid, status: { type: 'string', enum: ['not_started', 'in_progress', 'completed', 'cancelled'] },
    } } },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `${ENGAGEMENT}
        WHERE ($1::uuid IS NULL OR e.financial_year_id = $1 OR e.financial_year_id IS NULL)
          AND ($2::text IS NULL OR e.status = $2)
        ORDER BY CASE e.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
                 e.planned_start NULLS LAST, e.title`, [q.financial_year_id || null, q.status || null])
    return ok(reply, rows)
  })

  const engagementBody = {
    title: { type: 'string', minLength: 3, maxLength: 200 },
    area: { type: 'string', minLength: 2, maxLength: 120 },
    financial_year_id: { type: ['string', 'null'], format: 'uuid' },
    phase: { type: 'string', enum: ['planning', 'fieldwork', 'reporting', 'follow_up'] },
    status: { type: 'string', enum: ['not_started', 'in_progress', 'completed', 'cancelled'] },
    planned_start: date, planned_end: date,
    lead_user_id: { type: ['string', 'null'], format: 'uuid' },
    notes: text(2000),
  }

  fastify.post('/finance/internal-audit/engagements', {
    ...canManage,
    schema: { body: { type: 'object', additionalProperties: false, required: ['title', 'area'], properties: engagementBody } },
  }, async (request, reply) => {
    const b = request.body
    try {
      const status = b.status || 'not_started'
      const { rows } = await pg.query(
        `INSERT INTO finance.audit_engagement
           (financial_year_id, title, area, phase, status, planned_start, planned_end, lead_user_id, notes, completed_at, created_by)
         VALUES ($1, btrim($2), btrim($3), $4, $5, $6, $7, $8, $9, CASE WHEN $5 = 'completed' THEN now() END, $10)
         RETURNING id`,
        [b.financial_year_id || null, b.title, b.area, b.phase || 'planning', status, b.planned_start || null,
          b.planned_end || null, b.lead_user_id || null, b.notes || null, request.user.id])
      const { rows: out } = await pg.query(`${ENGAGEMENT} WHERE e.id = $1`, [rows[0].id])
      return ok(reply, out[0], 201)
    } catch (err) { return refuse(reply, err, 'audit') }
  })

  fastify.patch('/finance/internal-audit/engagements/:id', {
    ...canManage,
    schema: { params: { type: 'object', properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: engagementBody } },
  }, async (request, reply) => {
    const b = request.body
    const cols = ['title', 'area', 'financial_year_id', 'phase', 'status', 'planned_start', 'planned_end', 'lead_user_id', 'notes']
      .filter((c) => c in b)
    const sets = cols.map((c, i) => `${c} = $${i + 2}`)
    if ('status' in b) sets.push(`completed_at = CASE WHEN $${cols.indexOf('status') + 2} = 'completed' THEN COALESCE(completed_at, now()) END`)
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.audit_engagement SET ${sets.join(', ')}, updated_at = clock_timestamp() WHERE id = $1`,
        [request.params.id, ...cols.map((c) => (typeof b[c] === 'string' ? b[c].trim() || null : b[c]))])
      if (!rowCount) return fail(reply, 404, 'not_found', 'No such audit.')
      const { rows } = await pg.query(`${ENGAGEMENT} WHERE e.id = $1`, [request.params.id])
      return ok(reply, rows[0])
    } catch (err) { return refuse(reply, err, 'audit') }
  })

  fastify.get('/finance/internal-audit/findings', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      engagement_id: uuid, risk: { type: 'string', enum: ['high', 'medium', 'low'] },
      status: { type: 'string', enum: ['open', 'closed', 'overdue'] },
    } } },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `${FINDING}
        WHERE ($1::uuid IS NULL OR f.engagement_id = $1) AND ($2::text IS NULL OR f.risk = $2)
          AND ($3::text IS NULL OR ($3 = 'overdue' AND f.status = 'open' AND f.due_date < CURRENT_DATE) OR f.status = $3)
        ORDER BY (f.status = 'open') DESC, CASE f.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 f.due_date NULLS LAST, f.created_at`, [q.engagement_id || null, q.risk || null, q.status || null])
    return ok(reply, rows)
  })

  const findingBody = {
    engagement_id: uuid,
    title: { type: 'string', minLength: 3, maxLength: 200 },
    detail: text(4000),
    risk: { type: 'string', enum: ['high', 'medium', 'low'] },
    action: text(2000), action_owner: text(160), due_date: date,
  }

  fastify.post('/finance/internal-audit/findings', {
    ...canManage,
    schema: { body: { type: 'object', additionalProperties: false, required: ['engagement_id', 'title', 'risk'], properties: findingBody } },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.audit_finding (engagement_id, title, detail, risk, action, action_owner, due_date, created_by)
         VALUES ($1, btrim($2), $3, $4, $5, $6, $7, $8) RETURNING id`,
        [b.engagement_id, b.title, b.detail || null, b.risk, b.action || null, b.action_owner || null, b.due_date || null, request.user.id])
      await pg.query('UPDATE finance.audit_engagement SET updated_at = clock_timestamp() WHERE id = $1', [b.engagement_id])
      const { rows: out } = await pg.query(`${FINDING} WHERE f.id = $1`, [rows[0].id])
      return ok(reply, out[0], 201)
    } catch (err) { return refuse(reply, err, 'finding') }
  })

  fastify.patch('/finance/internal-audit/findings/:id', {
    ...canManage,
    schema: { params: { type: 'object', properties: { id: uuid } },
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
        ...findingBody, close: { type: 'boolean', const: true }, closure_note: { type: 'string', minLength: 3, maxLength: 2000 },
      } } },
  }, async (request, reply) => {
    const b = request.body
    const { rows: found } = await pg.query('SELECT status FROM finance.audit_finding WHERE id = $1', [request.params.id])
    if (!found.length) return fail(reply, 404, 'not_found', 'No such finding.')
    if (found[0].status === 'closed') return fail(reply, 409, 'closed', 'This finding is closed. Record a new finding if the matter has come back.')
    if (b.close && !b.closure_note) return fail(reply, 422, 'note_required', 'Say how the finding was resolved.')
    const cols = ['title', 'detail', 'risk', 'action', 'action_owner', 'due_date'].filter((c) => c in b)
    const sets = cols.map((c, i) => `${c} = $${i + 2}`)
    const values = cols.map((c) => (typeof b[c] === 'string' ? b[c].trim() || null : b[c]))
    if (b.close) {
      sets.push(`status = 'closed'`, `closed_at = clock_timestamp()`, `closed_by = $${values.length + 2}`, `closure_note = $${values.length + 3}`)
      values.push(request.user.id, b.closure_note.trim())
    }
    if (!sets.length) return fail(reply, 422, 'nothing_to_change', 'Nothing to change.')
    try {
      await pg.query(
        `UPDATE finance.audit_finding SET ${sets.join(', ')}, updated_at = clock_timestamp() WHERE id = $1`,
        [request.params.id, ...values])
      const { rows } = await pg.query(`${FINDING} WHERE f.id = $1`, [request.params.id])
      await pg.query('UPDATE finance.audit_engagement SET updated_at = clock_timestamp() WHERE id = $1', [rows[0].engagement_id])
      return ok(reply, rows[0])
    } catch (err) { return refuse(reply, err, 'finding') }
  })
}

module.exports = { financeInternalAuditRoutes }
