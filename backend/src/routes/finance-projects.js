/**
 * The municipal project register, its budget allocations, and the trace from a planning or
 * environmental project through to what was actually spent on it.
 *
 * Tables: finance.project, finance.project_allocation, finance.project_transaction,
 * finance.v_project_performance (migration 188).
 *
 * HOW THIS INTEGRATES RATHER THAN DUPLICATES
 * This council already has project-shaped records: `development_applications` (a citizen's permit
 * application), `spatial_planning.planning_project` (a subdivision layout), `survey.projects`,
 * `council_ops.*` assets and tickets. None of them is a *capital/development project with a
 * budget*, which is what the specification asks for, so that register is new — but it does not copy
 * any of them. A finance project points at the existing record by ITS OWN primary key
 * (`linked_subject_kind` + `linked_subject_id`), so a planning application keeps one identity
 * across both domains and a planner can follow the money without the finance module owning a
 * second copy of the application.
 *
 * `location` is a real geometry, so a project sits on the same map as the parcels, roads and wards
 * the rest of this product renders.
 */

const { requirePermission, departmentScope, hasPermission } = require('../middleware/financePermissions')
const { parseMoney, normaliseCode, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }
const SUBJECT_KINDS = ['development_application', 'planning_project', 'survey_project',
  'council_asset', 'service_desk_ticket', 'environmental_review', 'other']
const STATUSES = ['proposed', 'awaiting_approval', 'approved', 'in_progress', 'suspended', 'completed', 'cancelled']

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/**
 * Does the record this project claims to be about actually exist?
 *
 * A dangling link is worse than no link: it makes a trace that looks complete and is not. Each kind
 * is checked against its own table. A table that is absent from this database yields `unknown`
 * rather than a refusal, so a deployment without, say, the survey schema can still record the link.
 */
async function verifySubject(pg, kind, id) {
  const probes = {
    development_application: ['public.development_applications', 'id', 'uuid'],
    planning_project: ['spatial_planning.planning_project', 'id', 'uuid'],
    survey_project: ['survey.projects', 'id', 'text'],
    council_asset: ['council_ops.council_asset', 'id', 'text'],
    service_desk_ticket: ['council_ops.service_desk_ticket', 'id', 'text'],
  }
  if (kind === 'other' || kind === 'environmental_review') return { exists: 'unknown', reason: 'no_single_register' }
  const probe = probes[kind]
  if (!probe) return { exists: 'unknown', reason: 'unknown_kind' }
  const [table, column, cast] = probe
  try {
    const { rows } = await pg.query(
      `SELECT 1 FROM ${table} WHERE ${column}::text = $1::text LIMIT 1`, [String(id)],
    )
    return { exists: rows.length > 0 }
  } catch (err) {
    // The table is not here, or not readable by this person. Either way the link is recorded and
    // the uncertainty is reported rather than hidden.
    return { exists: 'unknown', reason: 'register_unavailable', detail: String(err.code || err.message).slice(0, 80) }
  }
}

async function financeProjectRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.project.view') }
  const canManage = { preHandler: requirePermission(fastify, 'finance.project.manage') }
  const canApprove = { preHandler: requirePermission(fastify, 'finance.project.approve') }

  // ── Register ─────────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/projects', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: STATUSES },
          department_id: uuid,
          ward_code: { type: 'string', maxLength: 24 },
          linked_subject_kind: { type: 'string', enum: SUBJECT_KINDS },
          linked_subject_id: { type: 'string', maxLength: 200 },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const { rows } = await pg.query(
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              d.code AS department_code, d.name AS department_name,
              ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
         LEFT JOIN finance.department d ON d.id = p.department_id
        WHERE ($1::text IS NULL OR p.status = $1::text)
          AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
          AND ($3::text IS NULL OR p.ward_code = $3::text)
          AND ($4::text IS NULL OR p.linked_subject_kind = $4::text)
          AND ($5::text IS NULL OR p.linked_subject_id = $5::text)
          AND ($6::text IS NULL OR p.reference ILIKE $6::text OR p.name ILIKE $6::text)
          AND ($7::uuid[] IS NULL OR p.department_id = ANY($7::uuid[]) OR p.department_id IS NULL)
        ORDER BY p.reference
        LIMIT $8 OFFSET $9`,
      [q.status || null, q.department_id || null, q.ward_code || null,
        q.linked_subject_kind || null, q.linked_subject_id || null,
        q.q ? `%${q.q.trim()}%` : null, scope, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  /**
   * One project, end to end: the allocation it was given, every approved revision that changed it,
   * every transaction posted against it, and the documents attached.
   *
   * This endpoint is the specification's integration requirement made concrete — "trace a planning
   * or environmental project from approved allocation through revisions, transactions, documents
   * and actual spend". Counterparty identity on the transactions is included ONLY for a caller who
   * holds finance.transaction.view_counterparty; everyone else gets the same rows with those two
   * fields absent, not blanked, so a client cannot display an empty supplier name as fact.
   */
  fastify.get('/finance/projects/:id', canView, async (request, reply) => {
    const { rows: perf } = await pg.query(
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              d.code AS department_code, d.name AS department_name,
              pr.description, pr.location_text, pr.approved_at, pr.approved_by, pr.created_at,
              ${dateText('pr', 'start_date', 'end_date')},
              ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude,
              COALESCE(au.full_name, au.name) AS approved_by_name
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
         LEFT JOIN finance.department d ON d.id = p.department_id
         LEFT JOIN public.users au ON au.id = pr.approved_by
        WHERE p.project_id = $1`, [request.params.id],
    )
    if (!perf[0]) return fail(reply, 404, 'not_found', 'No such project.')

    const { rows: allocations } = await pg.query(
      `SELECT a.*, ${dateText('a', 'effective_date')},
              l.code AS budget_line_code, l.description AS budget_line_description,
              l.financial_year_id, y.label AS financial_year_label,
              r.revision_no, r.reason AS revision_reason, r.state AS revision_state
         FROM finance.project_allocation a
         JOIN finance.budget_line l ON l.id = a.budget_line_id
         JOIN finance.financial_year y ON y.id = l.financial_year_id
         LEFT JOIN finance.budget_revision r ON r.id = a.budget_revision_id
        WHERE a.project_id = $1 AND a.deleted_at IS NULL
        ORDER BY y.start_date, a.allocation_type, a.effective_date NULLS FIRST`,
      [request.params.id],
    )

    // Every approved revision touching any line this project draws on — the "through revisions"
    // half of the trace.
    const { rows: revisions } = await pg.query(
      `SELECT DISTINCT r.id, r.revision_no, r.amount_delta, r.currency, r.reason, r.state,
              r.effective_date::text AS effective_date, r.decided_at, l.code AS budget_line_code,
              COALESCE(du.full_name, du.name) AS decided_by_name
         FROM finance.project_allocation a
         JOIN finance.budget_line l ON l.id = a.budget_line_id
         JOIN finance.budget_revision r ON r.budget_line_id = l.id
         LEFT JOIN public.users du ON du.id = r.decided_by
        WHERE a.project_id = $1 AND a.deleted_at IS NULL AND r.deleted_at IS NULL
        ORDER BY r.revision_no`, [request.params.id],
    )

    const showCounterparty = await hasPermission(fastify, request, 'finance.transaction.view_counterparty')
    const { rows: transactions } = await pg.query(
      `SELECT t.id, t.txn_date::text AS txn_date, t.amount, t.currency, t.description, t.reference,
              t.record_type, t.source_system, t.source_ref, t.import_batch_id,
              pt.association, pt.share,
              a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
              d.code AS department_code
              ${showCounterparty ? ', t.counterparty_ref, t.counterparty_name' : ''}
         FROM finance.project_transaction pt
         JOIN finance.transaction t ON t.id = pt.transaction_id AND t.deleted_at IS NULL
         JOIN finance.account a ON a.id = t.account_id
         JOIN finance.department d ON d.id = t.department_id
        WHERE pt.project_id = $1 AND pt.deleted_at IS NULL
        ORDER BY t.txn_date DESC, t.id
        LIMIT 500`, [request.params.id],
    )

    const { rows: documents } = await pg.query(
      `SELECT id, filename, mime_type, size_bytes, document_type, visibility, uploaded_at
         FROM finance.document
        WHERE subject_kind = 'project' AND subject_id = $1::text AND deleted_at IS NULL
        ORDER BY uploaded_at DESC`, [request.params.id],
    )

    let linkedRecord = null
    if (perf[0].linked_subject_kind) {
      linkedRecord = {
        kind: perf[0].linked_subject_kind,
        id: perf[0].linked_subject_id,
        ...(await verifySubject(pg, perf[0].linked_subject_kind, perf[0].linked_subject_id)),
      }
    }

    return ok(reply, {
      project: perf[0],
      allocations,
      revisions,
      transactions,
      documents,
      linked_record: linkedRecord,
      // Said plainly so a client cannot mistake an absent field for an empty value.
      counterparty_visible: showCounterparty,
    })
  })

  fastify.post('/finance/projects', {
    ...canManage,
    schema: {
      body: {
        type: 'object', required: ['reference', 'name', 'currency'], additionalProperties: false,
        properties: {
          reference: { type: 'string', minLength: 1, maxLength: 60 },
          name: { type: 'string', minLength: 1, maxLength: 300 },
          description: { type: 'string', maxLength: 4000 },
          department_id: uuid,
          ward_code: { type: 'string', maxLength: 24 },
          location_text: { type: 'string', maxLength: 500 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          funding_source_account_id: uuid,
          start_date: isoDate,
          end_date: isoDate,
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          approved_budget: money,
          linked_subject_kind: { type: 'string', enum: SUBJECT_KINDS },
          linked_subject_id: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if ((b.linked_subject_kind && !b.linked_subject_id) || (!b.linked_subject_kind && b.linked_subject_id)) {
      return fail(reply, 400, 'incomplete_link', 'Give both linked_subject_kind and linked_subject_id, or neither.')
    }
    if ((b.longitude === undefined) !== (b.latitude === undefined)) {
      return fail(reply, 400, 'incomplete_point', 'Give both longitude and latitude, or neither.')
    }
    if (b.department_id) {
      const refusal = await (async () => {
        const scope = await departmentScope(fastify, request)
        if (!scope) return null
        return scope.includes(b.department_id) ? null : 'Your access is limited to your own department(s).'
      })()
      if (refusal) return fail(reply, 403, 'out_of_scope', refusal)
    }

    let budget = '0.00'
    if (b.approved_budget !== undefined) {
      const parsed = parseMoney(b.approved_budget)
      if (!parsed.ok) return fail(reply, 400, 'invalid_amount', `approved_budget: ${parsed.reason}`)
      if (parsed.value.startsWith('-')) return fail(reply, 400, 'invalid_amount', 'A project budget cannot be negative.')
      budget = parsed.value
    }

    let link = null
    if (b.linked_subject_kind) {
      link = await verifySubject(pg, b.linked_subject_kind, b.linked_subject_id)
      if (link.exists === false) {
        return fail(reply, 400, 'linked_record_not_found',
          `No ${b.linked_subject_kind.replace(/_/g, ' ')} with id ${b.linked_subject_id}. A link that points at nothing would make the audit trail look complete when it is not.`)
      }
    }

    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.project
           (reference, name, description, department_id, ward_code, location_text, location,
            funding_source_account_id, start_date, end_date, currency, approved_budget,
            linked_subject_kind, linked_subject_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,
                 CASE WHEN $7::double precision IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($7::double precision, $8::double precision), 4326) END,
                 $9,$10,$11,$12,$13::numeric,$14,$15,$16)
         RETURNING *, ${dateText(null, 'start_date', 'end_date')},
                   ST_AsGeoJSON(location)::json AS location,
                   ST_X(location) AS longitude, ST_Y(location) AS latitude`,
        [normaliseCode(b.reference), b.name.trim(), b.description || null, b.department_id || null,
          b.ward_code ? normaliseCode(b.ward_code) : null, b.location_text || null,
          b.longitude ?? null, b.latitude ?? null,
          b.funding_source_account_id || null, b.start_date || null, b.end_date || null,
          b.currency, budget, b.linked_subject_kind || null, b.linked_subject_id || null,
          request.user.id],
      )
      return ok(reply, { project: rows[0], linked_record: link }, 201)
    } catch (err) {
      if (err.code === '23505') return fail(reply, 409, 'duplicate_reference', 'A project already uses that reference.')
      if (err.code === '23514') return fail(reply, 400, 'constraint_failed', 'The project fails a database constraint (check the dates).')
      throw err
    }
  })

  fastify.patch('/finance/projects/:id', {
    ...canManage,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          description: { type: 'string', maxLength: 4000 },
          department_id: uuid,
          ward_code: { type: 'string', maxLength: 24 },
          location_text: { type: 'string', maxLength: 500 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          start_date: isoDate,
          end_date: isoDate,
          // 'approved' is not settable here: see the approve endpoint. Nor is 'proposed' reachable
          // again once a project has been approved.
          status: { type: 'string', enum: ['in_progress', 'suspended', 'completed', 'cancelled', 'awaiting_approval'] },
          linked_subject_kind: { type: 'string', enum: SUBJECT_KINDS },
          linked_subject_id: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT id, status FROM finance.project WHERE id = $1 AND deleted_at IS NULL', [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such project.')
    // A project that has not been approved cannot be put straight into progress.
    if (b.status && ['in_progress', 'suspended', 'completed'].includes(b.status)
        && ['proposed', 'awaiting_approval'].includes(current[0].status)) {
      return fail(reply, 409, 'not_approved',
        `This project is ${current[0].status}. It must be approved before it can be ${b.status.replace('_', ' ')}.`)
    }
    if (b.linked_subject_kind && b.linked_subject_id) {
      const link = await verifySubject(pg, b.linked_subject_kind, b.linked_subject_id)
      if (link.exists === false) {
        return fail(reply, 400, 'linked_record_not_found',
          `No ${b.linked_subject_kind.replace(/_/g, ' ')} with id ${b.linked_subject_id}.`)
      }
    }
    const { rows } = await pg.query(
      `UPDATE finance.project
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              department_id = COALESCE($4, department_id),
              ward_code = COALESCE($5, ward_code),
              location_text = COALESCE($6, location_text),
              location = CASE WHEN $7::double precision IS NULL THEN location
                              ELSE ST_SetSRID(ST_MakePoint($7::double precision, $8::double precision), 4326) END,
              start_date = COALESCE($9, start_date),
              end_date = COALESCE($10, end_date),
              status = COALESCE($11, status),
              linked_subject_kind = COALESCE($12, linked_subject_kind),
              linked_subject_id = COALESCE($13, linked_subject_id)
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *, ${dateText(null, 'start_date', 'end_date')},
                  ST_AsGeoJSON(location)::json AS location,
                  ST_X(location) AS longitude, ST_Y(location) AS latitude`,
      [request.params.id, b.name?.trim() || null, b.description || null, b.department_id || null,
        b.ward_code ? normaliseCode(b.ward_code) : null, b.location_text || null,
        b.longitude ?? null, b.latitude ?? null, b.start_date || null, b.end_date || null,
        b.status || null, b.linked_subject_kind || null, b.linked_subject_id || null],
    )
    return ok(reply, rows[0])
  })

  /**
   * Record (or clear) a project's physical completion — decision D12.
   *
   * A SEPARATE PATH FROM PATCH /finance/projects/:id, for two reasons that are not stylistic:
   *
   *   1. That handler updates with COALESCE($n, column), so it is structurally incapable of
   *      setting a field back to NULL. "This progress figure was recorded in error and we do not
   *      have another" has to be expressible, or the only way out of a wrong number is a wronger
   *      one.
   *   2. Progress is a different act from editing a project's name or dates: it is a periodic
   *      report with evidence behind it, and it carries its own timestamp and reporter so a
   *      report reading the row can say how old the figure is.
   *
   * `physical_progress_percent: null` clears it. OMITTING the field is not the same thing and
   * changes nothing — the schema distinguishes them, and so does this handler.
   *
   * NULL IS NOT ZERO. A project with no recorded progress must render as "not recorded"; the view
   * returns `spend_ahead_of_progress = NULL` for it, never false. Nothing here derives a figure
   * from elapsed schedule: elapsed time is not physical progress (assessment §10 conflict 2).
   */
  fastify.patch('/finance/projects/:id/progress', {
    ...canManage,
    schema: {
      body: {
        type: 'object', required: ['physical_progress_percent'], additionalProperties: false,
        properties: {
          physical_progress_percent: {
            type: ['number', 'null'], minimum: 0, maximum: 100,
          },
          progress_evidence_document_id: { type: ['string', 'null'], format: 'uuid' },
          note: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      `SELECT id, reference, department_id, status, currency,
              physical_progress_percent, progress_evidence_document_id, progress_recorded_at
         FROM finance.project WHERE id = $1 AND deleted_at IS NULL`, [request.params.id])
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such project.')

    const scope = await departmentScope(fastify, request)
    if (scope && current[0].department_id && !scope.includes(current[0].department_id)) {
      return fail(reply, 403, 'out_of_scope', 'Your access is limited to your own department(s).')
    }

    const progress = b.physical_progress_percent === null || b.physical_progress_percent === undefined
      ? null : b.physical_progress_percent
    // Evidence of a figure that is being cleared is evidence of nothing; the CHECK constraint
    // says so too, and this is the message instead of a 500 from the database.
    if (progress === null && b.progress_evidence_document_id) {
      return fail(reply, 400, 'evidence_without_progress',
        'Evidence cannot be attached while the progress figure is being cleared.')
    }

    try {
      const { rows } = await pg.query(
        `UPDATE finance.project
            SET physical_progress_percent = $2::numeric,
                progress_evidence_document_id = CASE WHEN $2::numeric IS NULL THEN NULL
                                                     ELSE $3::uuid END,
                progress_recorded_at = CASE WHEN $2::numeric IS NULL THEN NULL ELSE now() END,
                progress_recorded_by = CASE WHEN $2::numeric IS NULL THEN NULL ELSE $4::uuid END,
                updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, reference, physical_progress_percent, progress_evidence_document_id,
                    progress_recorded_at, progress_recorded_by`,
        [request.params.id, progress,
          progress === null ? null : (b.progress_evidence_document_id || null),
          request.user.id])

      // Audited in the shape finance-budget.js:539-543 established: what it was, what it is.
      request.auditDetails = {
        project_id: current[0].id,
        reference: current[0].reference,
        note: b.note || null,
        before: {
          physical_progress_percent: current[0].physical_progress_percent,
          progress_evidence_document_id: current[0].progress_evidence_document_id,
          progress_recorded_at: current[0].progress_recorded_at,
        },
        after: {
          physical_progress_percent: rows[0].physical_progress_percent,
          progress_evidence_document_id: rows[0].progress_evidence_document_id,
          progress_recorded_at: rows[0].progress_recorded_at,
        },
      }

      // The exception flag and the threshold in force, read from the view rather than computed
      // here: the map and this reply cannot disagree about what counts as an exception.
      const { rows: performance } = await pg.query(
        `SELECT execution_percentage, physical_progress_percent, spend_vs_progress_gap_points,
                spend_ahead_of_progress, spend_ahead_of_progress_threshold_points
           FROM finance.v_project_performance WHERE project_id = $1`, [request.params.id])

      return ok(reply, {
        project: rows[0],
        performance: performance[0] || null,
        recorded: progress !== null,
        note: progress === null
          ? 'Physical progress is now NOT RECORDED for this project. It must be shown as such, never as 0 %.'
          : 'Physical progress recorded. The spend-versus-progress flag is NULL until the council '
            + 'has configured a threshold (finance.setting project.spend_ahead_of_progress_points).',
      })
    } catch (err) {
      if (err.code === '23503') {
        return fail(reply, 400, 'unknown_document', 'No such finance document for the progress evidence.')
      }
      if (err.code === '23514') {
        return fail(reply, 400, 'constraint_failed', 'Physical progress must be between 0 and 100.')
      }
      throw err
    }
  })

  fastify.post('/finance/projects/:id/submit', canManage, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.project SET status = 'awaiting_approval'
        WHERE id = $1 AND deleted_at IS NULL AND status = 'proposed' RETURNING *`,
      [request.params.id],
    )
    if (!rows[0]) return fail(reply, 409, 'not_proposed', 'Only a proposed project can be submitted for approval.')
    return ok(reply, rows[0])
  })

  fastify.post('/finance/projects/:id/approve', canApprove, async (request, reply) => {
    const { rows: current } = await pg.query(
      `SELECT id, status, created_by, approved_budget, currency
         FROM finance.project WHERE id = $1 AND deleted_at IS NULL`,
      [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such project.')
    if (current[0].status !== 'awaiting_approval') {
      return fail(reply, 409, 'not_awaiting_approval', 'Only a project awaiting approval can be approved.')
    }
    if (current[0].created_by === request.user.id) {
      return fail(reply, 403, 'self_approval',
        'You created this project. Approval must come from someone else (specification §2.3).')
    }
    const { rows } = await pg.query(
      `UPDATE finance.project SET status = 'approved', approved_at = now(), approved_by = $2
        WHERE id = $1 AND status = 'awaiting_approval' RETURNING *`,
      [request.params.id, request.user.id],
    )
    // Audit MAJOR-6. Approving a project is one of the two acts that make an allocation official,
    // and it carried only `{routerPath}` into admin_audit_event.details: six months later the
    // amount approved had to be reconstructed from finance.project as it stood TODAY, after any
    // revision. The shape is the one finance-budget.js:539-543 already uses for revisions.
    request.auditDetails = {
      project_id: rows[0].id,
      reference: rows[0].reference,
      before: {
        status: current[0].status,
        approved_budget: current[0].approved_budget,
        currency: current[0].currency,
      },
      after: {
        status: rows[0].status,
        approved_budget: rows[0].approved_budget,
        currency: rows[0].currency,
        approved_by: request.user.id,
        approved_at: rows[0].approved_at,
      },
    }
    return ok(reply, rows[0])
  })

  // ── Allocations ──────────────────────────────────────────────────────────────────────────────
  /**
   * Tie a project to the budget line that funds it.
   *
   * The allocation cannot exceed what is left on the line: the line's revised amount less what is
   * already allocated to other projects. Checked in SQL, over NUMERIC, inside the same transaction
   * as the insert — so two officers allocating the last of a line at the same moment cannot both
   * succeed.
   */
  fastify.post('/finance/projects/:id/allocations', {
    ...canManage,
    schema: {
      body: {
        type: 'object', required: ['budget_line_id', 'amount'], additionalProperties: false,
        properties: {
          budget_line_id: uuid,
          amount: money,
          allocation_type: { type: 'string', enum: ['original', 'revision'] },
          budget_revision_id: uuid,
          effective_date: isoDate,
          note: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const parsed = parseMoney(b.amount)
    if (!parsed.ok) return fail(reply, 400, 'invalid_amount', `amount: ${parsed.reason}`)
    if (parsed.value.startsWith('-')) return fail(reply, 400, 'invalid_amount', 'An allocation cannot be negative.')
    const allocationType = b.allocation_type || 'original'
    if (allocationType === 'revision' && !b.budget_revision_id) {
      return fail(reply, 400, 'revision_required', 'A revision allocation must name the budget revision it follows from.')
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      // Lock the line so the headroom calculation cannot be overtaken.
      const { rows: line } = await client.query(
        `SELECT l.id, l.currency, l.status, l.department_id,
                (l.original_amount + COALESCE((SELECT sum(amount_delta) FROM finance.budget_revision
                   WHERE budget_line_id = l.id AND state = 'approved' AND deleted_at IS NULL), 0)) AS revised_amount
           FROM finance.budget_line l
          WHERE l.id = $1 AND l.deleted_at IS NULL
          FOR UPDATE OF l`, [b.budget_line_id],
      )
      if (!line[0]) {
        await client.query('ROLLBACK')
        return fail(reply, 400, 'unknown_budget_line', 'No such budget line.')
      }
      if (!['approved', 'published'].includes(line[0].status)) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'line_not_approved',
          `That budget line is ${line[0].status}. A project can only draw on an approved allocation.`)
      }
      const { rows: project } = await client.query(
        'SELECT id, currency, status FROM finance.project WHERE id = $1 AND deleted_at IS NULL',
        [request.params.id],
      )
      if (!project[0]) {
        await client.query('ROLLBACK')
        return fail(reply, 404, 'not_found', 'No such project.')
      }
      if (project[0].currency !== line[0].currency) {
        await client.query('ROLLBACK')
        return fail(reply, 400, 'currency_mismatch',
          `The project is in ${project[0].currency} and the budget line in ${line[0].currency}. These are not converted (decision D4): fund the project from a line in its own currency.`)
      }

      const { rows: headroom } = await client.query(
        `SELECT ($1::numeric - COALESCE(sum(a.amount), 0)) AS remaining
           FROM finance.project_allocation a
          WHERE a.budget_line_id = $2 AND a.deleted_at IS NULL`,
        [line[0].revised_amount, b.budget_line_id],
      )
      const { rows: fits } = await client.query(
        'SELECT ($1::numeric >= $2::numeric) AS ok', [headroom[0].remaining, parsed.value],
      )
      if (!fits[0].ok) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'exceeds_budget_line',
          `That allocation exceeds what is left on the budget line. Remaining: ${headroom[0].remaining} ${line[0].currency}.`,
          { remaining: headroom[0].remaining, currency: line[0].currency })
      }

      const { rows } = await client.query(
        `INSERT INTO finance.project_allocation
           (project_id, budget_line_id, amount, currency, allocation_type, budget_revision_id,
            effective_date, note, created_by)
         VALUES ($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9)
         RETURNING *, ${dateText(null, 'effective_date')}`,
        [request.params.id, b.budget_line_id, parsed.value, line[0].currency, allocationType,
          b.budget_revision_id || null, b.effective_date || null, b.note || null, request.user.id],
      )
      await client.query('COMMIT')
      return ok(reply, rows[0], 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_allocation',
          'This project already has an original allocation from that budget line. Record a change as a revision allocation.')
      }
      if (err.code === '23000' && /accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed',
          'The budget line belongs to a closed financial year; no further project allocation can be recorded.')
      }
      throw err
    } finally {
      client.release()
    }
  })

  /** Associate an existing transaction with a project, directly or as an apportioned share. */
  fastify.post('/finance/projects/:id/transactions', {
    ...canManage,
    schema: {
      body: {
        type: 'object', required: ['transaction_id'], additionalProperties: false,
        properties: {
          transaction_id: uuid,
          association: { type: 'string', enum: ['direct', 'apportioned'] },
          share: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          note: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const association = b.association || 'direct'
    const share = association === 'direct' ? 1 : b.share
    if (association === 'apportioned' && (share === undefined || share <= 0 || share > 1)) {
      return fail(reply, 400, 'share_required',
        'An apportioned association needs the share of the transaction that belongs to this project, between 0 and 1.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.project_transaction
           (project_id, transaction_id, association, share, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [request.params.id, b.transaction_id, association, share, b.note || null, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') return fail(reply, 409, 'already_associated', 'That transaction is already associated with this project.')
      if (err.code === '23503') return fail(reply, 400, 'unknown_reference', 'No such project or transaction.')
      if (err.code === '23000' && /accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed',
          'The transaction belongs to a closed financial year; it cannot be linked to a project.')
      }
      throw err
    }
  })

  fastify.delete('/finance/projects/:id/transactions/:transactionId', canManage, async (request, reply) => {
    // Soft-deleted: an association that was made and then withdrawn is part of the record.
    try {
      const { rows } = await pg.query(
        `UPDATE finance.project_transaction SET deleted_at = now(), deleted_by = $3
          WHERE project_id = $1 AND transaction_id = $2 AND deleted_at IS NULL RETURNING id`,
        [request.params.id, request.params.transactionId, request.user.id],
      )
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such association.')
      return ok(reply, { id: rows[0].id, removed: true })
    } catch (err) {
      if (err.code === '23000' && /accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed',
          'The financial year is closed; a project link cannot be removed.')
      }
      throw err
    }
  })

  // ── The integration entry point ──────────────────────────────────────────────────────────────
  /**
   * Finance for an existing planning or environmental record, found by ITS id.
   *
   * This is what a planner's or environmental officer's screen calls: given a development
   * application or a planning project they are already looking at, what money is attached to it?
   * It needs only finance.project.view, which `planner`, `eo` and `env_officer` hold — the
   * integration works without giving planning staff the finance module.
   *
   * It returns an empty list rather than a 404 when nothing is linked: "no finance is attached to
   * this application" is a true and useful answer, and a 404 would read as "this application does
   * not exist".
   */
  fastify.get('/finance/linked/:kind/:subjectId', {
    ...canView,
    schema: {
      params: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: SUBJECT_KINDS },
          subjectId: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const { rows: projects } = await pg.query(
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              d.code AS department_code, d.name AS department_name
         FROM finance.v_project_performance p
         LEFT JOIN finance.department d ON d.id = p.department_id
        WHERE p.linked_subject_kind = $1 AND p.linked_subject_id = $2::text
        ORDER BY p.reference`,
      [request.params.kind, request.params.subjectId],
    )
    const showCounterparty = await hasPermission(fastify, request, 'finance.transaction.view_counterparty')
    const projectIds = projects.map((p) => p.project_id)
    let transactions = []
    if (projectIds.length) {
      const { rows } = await pg.query(
        `SELECT t.id, t.txn_date::text AS txn_date, t.amount, t.currency, t.description, t.reference,
                pt.project_id, pt.share, a.code AS account_code, a.name AS account_name, a.kind AS account_kind
                ${showCounterparty ? ', t.counterparty_name' : ''}
           FROM finance.project_transaction pt
           JOIN finance.transaction t ON t.id = pt.transaction_id AND t.deleted_at IS NULL
           JOIN finance.account a ON a.id = t.account_id
          WHERE pt.project_id = ANY($1::uuid[]) AND pt.deleted_at IS NULL
          ORDER BY t.txn_date DESC LIMIT 200`, [projectIds],
      )
      transactions = rows
    }
    return ok(reply, {
      subject: { kind: request.params.kind, id: request.params.subjectId },
      projects,
      recent_transactions: transactions,
      counterparty_visible: showCounterparty,
      // Totals are per currency. There is no combined figure (decision D4).
      totals_by_currency: Object.values(projects.reduce((acc, p) => {
        const key = p.currency || 'unknown'
        acc[key] = acc[key] || { currency: key, projects: 0 }
        acc[key].projects += 1
        return acc
      }, {})),
    })
  })
}

module.exports = { financeProjectRoutes, verifySubject, SUBJECT_KINDS }
