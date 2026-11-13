/**
 * Budget management: budget lines, their approval states, the revision history, commitments and
 * variance explanations.
 *
 * Tables and views: finance.budget_line, finance.budget_revision, finance.commitment,
 * finance.variance_explanation, finance.v_budget_line_performance (migration 188).
 *
 * TWO THINGS THIS MODULE DOES NOT DO, ON PURPOSE
 *
 * 1. It never computes money in JavaScript. Revised amounts, available balances, variances and
 *    execution percentages all come from finance.v_budget_line_performance, which computes them in
 *    NUMERIC. See the header of src/lib/finance.js for why that matters.
 *
 * 2. It never updates `original_amount` after approval. A change to an approved allocation is a
 *    row in finance.budget_revision, which is what keeps the original and the revised figure
 *    separately visible for the life of the record (specification §3.3, critical test §13.1).
 *
 * SEPARATION OF DUTIES is enforced in three places, deliberately overlapping: the permission
 * catalogue (no role both prepares and approves), the route (an approver may not approve their own
 * request), and a CHECK constraint on finance.budget_revision (`decided_by <> requested_by`). The
 * constraint is the one that holds if the other two are ever edited carelessly.
 */

const { requirePermission, requireAnyPermission, departmentScope, financeSetting } = require('../middleware/financePermissions')
const { parseMoney, normaliseCode, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
// Money arrives as a string so no precision is lost in JSON; a JSON number is accepted and
// normalised, with parseMoney flagging that it was coerced. Expressed as anyOf rather than a union
// `type`, which ajv's strict mode rejects.
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/**
 * Is this person allowed to touch this department's budget?
 * A scoped person (a departmental head) is confined to their own votes; everyone else is
 * council-wide. Returns null when allowed, or a reply-ready refusal.
 */
async function scopeAllows(fastify, request, departmentId) {
  const scope = await departmentScope(fastify, request)
  if (!scope) return null
  if (departmentId && scope.includes(departmentId)) return null
  return 'Your access is limited to your own department(s).'
}

async function financeBudgetRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.budget.view') }
  const canPrepare = { preHandler: requirePermission(fastify, 'finance.budget.prepare') }
  const canSubmit = { preHandler: requirePermission(fastify, 'finance.budget.submit') }
  const canApprove = { preHandler: requirePermission(fastify, 'finance.budget.approve') }
  const canViewActuals = {
    preHandler: requireAnyPermission(fastify, ['finance.budget.view', 'finance.actuals.view']),
  }

  // ── Budget lines ─────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/budget-lines', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid, department_id: uuid, account_id: uuid, programme_id: uuid,
          status: { type: 'string', enum: ['draft', 'submitted', 'returned', 'approved', 'published'] },
          kind: { type: 'string', enum: ['revenue', 'expenditure'] },
          q: { type: 'string', maxLength: 200 },
          ward_code: { type: 'string', maxLength: 64 },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: ['code', 'description', 'original_amount', 'execution'], default: 'code' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    // Sorting is from a closed set mapped to column expressions — the client never supplies SQL.
    const sortColumn = {
      code: 'p.code', description: 'p.description',
      original_amount: 'p.original_amount', execution: 'p.execution_percentage',
    }[q.sort]
    const dir = q.direction === 'desc' ? 'DESC' : 'ASC'

    const params = [
      q.financial_year_id || null, q.department_id || null, q.account_id || null,
      q.programme_id || null, q.status || null, q.kind || null,
      q.q ? `%${q.q.trim()}%` : null, scope, q.ward_code ? q.ward_code.trim() : null,
      q.limit, q.offset,
    ]
    const where = `
      WHERE ($1::uuid IS NULL OR p.financial_year_id = $1::uuid)
        AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
        AND ($3::uuid IS NULL OR p.account_id = $3::uuid)
        AND ($4::uuid IS NULL OR p.programme_id = $4::uuid)
        AND ($5::text IS NULL OR p.status = $5::text)
        AND ($6::text IS NULL OR p.account_kind = $6::text)
        AND ($7::text IS NULL OR p.code ILIKE $7::text OR p.description ILIKE $7::text)
        AND ($8::uuid[] IS NULL OR p.department_id = ANY($8::uuid[]))
        AND ($9::text IS NULL OR p.ward_code = $9::text)`

    const { rows } = await pg.query(
      // `submitted_by` and `returned_note` come from the base table rather than the performance
      // view, which carries measures only. They are here so a screen can do two things it could
      // not: refuse to offer Approve on a line the viewer submitted themselves (this route already
      // refuses it at :346, but a button that exists only to produce a 403 is the thing the
      // workspace documents as deliberately absent), and show a returned line's reason on the row
      // instead of leaving the preparer to find it in the audit trail. Additive: no filter, no
      // ordering and no existing field changes, and the permission gate is unchanged.
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              bl.submitted_by, bl.returned_note,
              d.code AS department_code, d.name AS department_name,
              a.code AS account_code, a.name AS account_name,
              a.revenue_class, a.expenditure_class,
              pr.code AS programme_code, pr.name AS programme_name
         FROM finance.v_budget_line_performance p
         JOIN finance.budget_line bl ON bl.id = p.budget_line_id
         JOIN finance.department d ON d.id = p.department_id
         JOIN finance.account a    ON a.id = p.account_id
         LEFT JOIN finance.programme pr ON pr.id = p.programme_id
         ${where}
        ORDER BY ${sortColumn} ${dir} NULLS LAST, p.code ASC
        LIMIT $10 OFFSET $11`, params,
    )
    const { rows: count } = await pg.query(
      `SELECT count(*)::int AS total FROM finance.v_budget_line_performance p ${where}`,
      params.slice(0, 9),
    )
    const includeCommitments = await financeSetting(fastify, request.user.authority_id,
      'available_balance.include_commitments', false)
    return ok(reply, {
      lines: rows,
      total: count[0].total,
      limit: q.limit,
      offset: q.offset,
      // The screen must say which definition of "available" it is showing (specification §6.3), so
      // the API states it rather than leaving the UI to assume.
      available_balance_includes_commitments: includeCommitments === true,
    })
  })

  fastify.get('/finance/budget-lines/:id', canView, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              bl.submitted_by, bl.returned_note,
              d.code AS department_code, d.name AS department_name,
              a.code AS account_code, a.name AS account_name, a.kind AS account_kind,
              y.label AS financial_year_label, y.status AS financial_year_status
         FROM finance.v_budget_line_performance p
         JOIN finance.budget_line bl ON bl.id = p.budget_line_id
         JOIN finance.department d ON d.id = p.department_id
         JOIN finance.account a    ON a.id = p.account_id
         JOIN finance.financial_year y ON y.id = p.financial_year_id
        WHERE p.budget_line_id = $1`, [request.params.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such budget line.')
    const refusal = await scopeAllows(fastify, request, rows[0].department_id)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)

    // The full revision history, approved and not: "retain a versioned history of all approved
    // budget changes" (§3.3) is the minimum; showing the rejected ones too is what lets an auditor
    // see what was asked for and refused.
    const { rows: revisions } = await pg.query(
      `SELECT r.*, ${dateText('r', 'effective_date')},
              COALESCE(ru.full_name, ru.name) AS requested_by_name,
              COALESCE(du.full_name, du.name) AS decided_by_name
         FROM finance.budget_revision r
         LEFT JOIN public.users ru ON ru.id = r.requested_by
         LEFT JOIN public.users du ON du.id = r.decided_by
        WHERE r.budget_line_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.revision_no`, [request.params.id],
    )
    const { rows: commitments } = await pg.query(
      `SELECT c.*, ${dateText('c', 'committed_on')} FROM finance.commitment c
        WHERE c.budget_line_id = $1 AND c.deleted_at IS NULL ORDER BY c.committed_on DESC`,
      [request.params.id],
    )
    const { rows: explanations } = await pg.query(
      `SELECT v.*, COALESCE(u.full_name, u.name) AS recorded_by_name
         FROM finance.variance_explanation v
         LEFT JOIN public.users u ON u.id = v.recorded_by
        WHERE v.budget_line_id = $1 AND v.deleted_at IS NULL
        ORDER BY v.recorded_at DESC`, [request.params.id],
    )
    return ok(reply, { line: rows[0], revisions, commitments, explanations })
  })

  fastify.post('/finance/budget-lines', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object',
        required: ['financial_year_id', 'department_id', 'account_id', 'code', 'description', 'currency', 'original_amount'],
        additionalProperties: false,
        properties: {
          financial_year_id: uuid, department_id: uuid, account_id: uuid,
          programme_id: uuid, activity_id: uuid, ward_code: { type: 'string', maxLength: 24 },
          funding_source_account_id: uuid,
          code: { type: 'string', minLength: 1, maxLength: 60 },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          currency, original_amount: money,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const refusal = await scopeAllows(fastify, request, b.department_id)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)

    const amount = parseMoney(b.original_amount)
    if (!amount.ok) return fail(reply, 400, 'invalid_amount', `original_amount: ${amount.reason}`)
    if (amount.value.startsWith('-')) {
      return fail(reply, 400, 'invalid_amount', 'A budget allocation cannot be negative. Record a reduction as a revision.')
    }

    // The account's kind decides whether this line is revenue or expenditure, and a heading account
    // cannot carry a budget — only a postable leaf can.
    const { rows: acct } = await pg.query(
      'SELECT kind, is_postable, status FROM finance.account WHERE id = $1 AND deleted_at IS NULL',
      [b.account_id],
    )
    if (!acct[0]) return fail(reply, 400, 'unknown_account', 'No such account.')
    if (!acct[0].is_postable) {
      return fail(reply, 400, 'account_not_postable',
        'That account is a heading in the chart of accounts. Budget against one of its postable accounts.')
    }
    if (acct[0].status !== 'active') {
      return fail(reply, 400, 'account_inactive', 'That account is inactive.')
    }

    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.budget_line
           (financial_year_id, department_id, account_id, programme_id, activity_id, ward_code,
            funding_source_account_id, code, description, currency, original_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12)
         RETURNING *`,
        [b.financial_year_id, b.department_id, b.account_id, b.programme_id || null,
          b.activity_id || null, b.ward_code || null, b.funding_source_account_id || null,
          normaliseCode(b.code), b.description.trim(), b.currency, amount.value, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_code', 'A budget line with that code already exists for this financial year.')
      }
      if (err.code === '23503') return fail(reply, 400, 'unknown_reference', 'One of the referenced records does not exist.')
      // The closed-year trigger from migration 188.
      if (/accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed', err.message)
      }
      throw err
    }
  })

  // Editing is confined to a line that has not been approved. Once approved, the allocation moves
  // only by revision — which is the whole control, so this is not a convenience restriction.
  fastify.patch('/finance/budget-lines/:id', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 500 },
          original_amount: money,
          programme_id: uuid, activity_id: uuid, ward_code: { type: 'string', maxLength: 24 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT id, status, department_id FROM finance.budget_line WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such budget line.')
    const refusal = await scopeAllows(fastify, request, current[0].department_id)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)
    if (!['draft', 'returned'].includes(current[0].status)) {
      return fail(reply, 409, 'not_editable',
        `This line is ${current[0].status}. An approved allocation changes only through a budget revision.`,
        { next_step: `POST /api/finance/budget-lines/${request.params.id}/revisions` })
    }
    let amount = null
    if (b.original_amount !== undefined) {
      const parsed = parseMoney(b.original_amount)
      if (!parsed.ok) return fail(reply, 400, 'invalid_amount', `original_amount: ${parsed.reason}`)
      if (parsed.value.startsWith('-')) return fail(reply, 400, 'invalid_amount', 'A budget allocation cannot be negative.')
      amount = parsed.value
    }
    const { rows } = await pg.query(
      `UPDATE finance.budget_line
          SET description = COALESCE($2, description),
              original_amount = COALESCE($3::numeric, original_amount),
              programme_id = COALESCE($4, programme_id),
              activity_id = COALESCE($5, activity_id),
              ward_code = COALESCE($6, ward_code)
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, b.description?.trim() || null, amount,
        b.programme_id || null, b.activity_id || null, b.ward_code || null],
    )
    return ok(reply, rows[0])
  })

  // draft/returned → submitted
  fastify.post('/finance/budget-lines/:id/submit', canSubmit, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.budget_line
          SET status = 'submitted', submitted_at = now(), submitted_by = $2, returned_note = NULL
        WHERE id = $1 AND deleted_at IS NULL AND status IN ('draft', 'returned')
        RETURNING *`, [request.params.id, request.user.id],
    )
    if (!rows[0]) return fail(reply, 409, 'not_submittable', 'Only a draft or returned line can be submitted.')
    return ok(reply, rows[0])
  })

  // submitted → returned. A reviewer sending work back must say why.
  fastify.post('/finance/budget-lines/:id/return', {
    ...canApprove,
    schema: {
      body: {
        type: 'object', required: ['note'], additionalProperties: false,
        properties: { note: { type: 'string', minLength: 5, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.budget_line
          SET status = 'returned', returned_note = $2
        WHERE id = $1 AND deleted_at IS NULL AND status = 'submitted' RETURNING *`,
      [request.params.id, request.body.note.trim()],
    )
    if (!rows[0]) return fail(reply, 409, 'not_submitted', 'Only a submitted line can be returned.')
    return ok(reply, rows[0])
  })

  // submitted → approved. The approver must not be the person who submitted it: the point of a
  // submission step is that someone else looks at it.
  fastify.post('/finance/budget-lines/:id/approve', canApprove, async (request, reply) => {
    const { rows: current } = await pg.query(
      `SELECT id, code, status, submitted_by, original_amount, currency, ward_code
         FROM finance.budget_line WHERE id = $1 AND deleted_at IS NULL`,
      [request.params.id],
    )
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such budget line.')
    if (current[0].status !== 'submitted') {
      return fail(reply, 409, 'not_submitted', 'Only a submitted line can be approved.')
    }
    if (current[0].submitted_by === request.user.id) {
      return fail(reply, 403, 'self_approval',
        'You submitted this line. Approval must come from someone else (specification §2.3).')
    }
    const { rows } = await pg.query(
      `UPDATE finance.budget_line
          SET status = 'approved', approved_at = now(), approved_by = $2
        WHERE id = $1 AND status = 'submitted' RETURNING *`,
      [request.params.id, request.user.id],
    )
    // Audit MAJOR-6. This is the act that makes an allocation official, and it wrote only
    // `{routerPath}` into admin_audit_event.details: a committee asking six months later what
    // amount was approved had to reconstruct it from the line as it stands TODAY, after any
    // revision. The shape is the one the revision approval below already uses.
    request.auditDetails = {
      budget_line_id: rows[0].id,
      code: rows[0].code,
      before: {
        status: current[0].status,
        original_amount: current[0].original_amount,
        currency: current[0].currency,
        ward_code: current[0].ward_code,
      },
      after: {
        status: rows[0].status,
        original_amount: rows[0].original_amount,
        currency: rows[0].currency,
        ward_code: rows[0].ward_code,
        approved_by: request.user.id,
        approved_at: rows[0].approved_at,
      },
    }
    return ok(reply, rows[0])
  })

  // ── Budget revisions ─────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/budget-revisions', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid, budget_line_id: uuid,
          state: { type: 'string', enum: ['draft', 'submitted', 'approved', 'rejected', 'withdrawn'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const { rows } = await pg.query(
      `SELECT r.*, ${dateText('r', 'effective_date')},
              l.code AS budget_line_code, l.description AS budget_line_description,
              l.original_amount, l.department_id, l.financial_year_id,
              d.name AS department_name,
              COALESCE(ru.full_name, ru.name) AS requested_by_name,
              COALESCE(du.full_name, du.name) AS decided_by_name
         FROM finance.budget_revision r
         JOIN finance.budget_line l ON l.id = r.budget_line_id
         JOIN finance.department d ON d.id = l.department_id
         LEFT JOIN public.users ru ON ru.id = r.requested_by
         LEFT JOIN public.users du ON du.id = r.decided_by
        WHERE r.deleted_at IS NULL
          AND ($1::uuid IS NULL OR l.financial_year_id = $1::uuid)
          AND ($2::uuid IS NULL OR r.budget_line_id = $2::uuid)
          AND ($3::text IS NULL OR r.state = $3::text)
          AND ($4::uuid[] IS NULL OR l.department_id = ANY($4::uuid[]))
        ORDER BY r.requested_at DESC
        LIMIT $5 OFFSET $6`,
      [q.financial_year_id || null, q.budget_line_id || null, q.state || null, scope, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  fastify.post('/finance/budget-lines/:id/revisions', {
    preHandler: requirePermission(fastify, 'finance.revision.prepare'),
    schema: {
      body: {
        type: 'object', required: ['amount_delta', 'reason'], additionalProperties: false,
        properties: {
          // Signed: positive is a supplementary allocation, negative a reduction.
          amount_delta: money,
          reason: { type: 'string', minLength: 10, maxLength: 2000 },
          effective_date: isoDate,
          evidence_document_id: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: line } = await pg.query(
      `SELECT l.id, l.status, l.currency, l.department_id, l.original_amount,
              y.status AS year_status, y.label AS year_label,
              COALESCE((SELECT sum(amount_delta) FROM finance.budget_revision
                         WHERE budget_line_id = l.id AND state = 'approved' AND deleted_at IS NULL), 0) AS approved_adjustments
         FROM finance.budget_line l
         JOIN finance.financial_year y ON y.id = l.financial_year_id
        WHERE l.id = $1 AND l.deleted_at IS NULL`, [request.params.id],
    )
    if (!line[0]) return fail(reply, 404, 'not_found', 'No such budget line.')
    const refusal = await scopeAllows(fastify, request, line[0].department_id)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)
    if (!['approved', 'published'].includes(line[0].status)) {
      return fail(reply, 409, 'not_approved',
        'A revision adjusts an approved allocation. Edit the line directly while it is still a draft.')
    }
    if (['closed', 'archived'].includes(line[0].year_status)) {
      return fail(reply, 409, 'year_closed', `Financial year ${line[0].year_label} is ${line[0].year_status}.`)
    }

    const delta = parseMoney(b.amount_delta)
    if (!delta.ok) return fail(reply, 400, 'invalid_amount', `amount_delta: ${delta.reason}`)
    if (/^-?0\.00$/.test(delta.value)) {
      return fail(reply, 400, 'invalid_amount', 'A revision of zero changes nothing.')
    }
    // A reduction cannot take the revised allocation below zero. Asked in SQL so the comparison is
    // decimal, not float.
    const { rows: feasible } = await pg.query(
      'SELECT ($1::numeric + $2::numeric + $3::numeric) >= 0 AS ok, ($1::numeric + $2::numeric) AS current_revised',
      [line[0].original_amount, line[0].approved_adjustments, delta.value],
    )
    if (!feasible[0].ok) {
      return fail(reply, 400, 'revision_below_zero',
        `A reduction of ${delta.value} would take the revised allocation below zero (currently ${feasible[0].current_revised}).`)
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      // revision_no is allocated inside the transaction, so two officers raising a revision at the
      // same moment cannot both take number 3 — the unique index would reject the second, and this
      // ordering makes it retry-safe rather than a surprise 500.
      const { rows: next } = await client.query(
        `SELECT COALESCE(max(revision_no), 0) + 1 AS n FROM finance.budget_revision
          WHERE budget_line_id = $1`, [request.params.id],
      )
      const { rows } = await client.query(
        `INSERT INTO finance.budget_revision
           (budget_line_id, revision_no, amount_delta, currency, reason, effective_date,
            evidence_document_id, requested_by)
         VALUES ($1,$2,$3::numeric,$4,$5,$6,$7,$8)
         RETURNING *, ${dateText(null, 'effective_date')}`,
        [request.params.id, next[0].n, delta.value, line[0].currency, b.reason.trim(),
          b.effective_date || null, b.evidence_document_id || null, request.user.id],
      )
      await client.query('COMMIT')
      return ok(reply, rows[0], 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err.code === '23505') {
        return fail(reply, 409, 'concurrent_revision', 'Another revision was raised at the same moment. Try again.')
      }
      if (/accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed', err.message)
      }
      throw err
    } finally {
      client.release()
    }
  })

  fastify.post('/finance/budget-revisions/:id/submit', {
    preHandler: requirePermission(fastify, 'finance.revision.submit'),
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.budget_revision
          SET state = 'submitted', submitted_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND state = 'draft' RETURNING *`,
      [request.params.id],
    )
    if (!rows[0]) return fail(reply, 409, 'not_draft', 'Only a draft revision can be submitted.')
    return ok(reply, rows[0])
  })

  /**
   * Approve a revision — the act that changes the official revised allocation.
   *
   * The requester-is-not-the-approver rule is checked here so the caller gets a clear 403, and
   * again by the CHECK constraint on the table so it holds even if this check is ever removed.
   */
  fastify.post('/finance/budget-revisions/:id/approve', {
    preHandler: requirePermission(fastify, 'finance.revision.approve'),
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { note: { type: 'string', maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { rows: rev } = await pg.query(
      `SELECT r.id, r.state, r.requested_by, r.amount_delta, r.currency, r.budget_line_id,
              l.code AS budget_line_code, l.department_id, l.currency AS line_currency,
              y.status AS year_status
         FROM finance.budget_revision r
         JOIN finance.budget_line l ON l.id = r.budget_line_id
         JOIN finance.financial_year y ON y.id = l.financial_year_id
        WHERE r.id = $1 AND r.deleted_at IS NULL`, [request.params.id],
    )
    if (!rev[0]) return fail(reply, 404, 'not_found', 'No such revision.')
    if (rev[0].state !== 'submitted') {
      return fail(reply, 409, 'not_submitted', 'Only a submitted revision can be approved.')
    }
    if (['closed', 'archived'].includes(rev[0].year_status)) {
      return fail(reply, 409, 'year_closed', 'The financial year is closed.')
    }
    if (rev[0].requested_by === request.user.id) {
      return fail(reply, 403, 'self_approval',
        'You requested this revision. Approval must come from someone else (specification §2.3).')
    }

    // AUDIT MAJOR-1. Migration 198 caps the approved geographic splits of a line at its revised
    // amount AT APPROVAL TIME. Nothing re-checked it when the revised amount later FELL, so a
    // reduction approved after a split left the ward map attributing more money than the line
    // holds, plus a NEGATIVE unallocated remainder, with nothing flagged.
    //
    // The decision (migration 202 §7) is that the REDUCTION IS REFUSED, not that the splits are
    // quietly flagged: a negative remainder is a figure the choropleth would have to shade, and
    // only a person holding the deciding permission may revoke an approved split with its
    // recorded methodology. The database refuses it too (trg_budget_revision_splits_fit) — this
    // is the same rule asked here, so the officer is told WHICH splits to withdraw instead of
    // being handed a trigger message.
    const { rows: fit } = await pg.query(
      `SELECT p.revised_amount,
              (p.revised_amount + $2::numeric) AS revised_after,
              p.currency,
              COALESCE(sa.split_total, 0) AS approved_split_total,
              COALESCE(sa.allocation_ids, ARRAY[]::uuid[]) AS allocation_ids,
              COALESCE(sa.target_codes, ARRAY[]::text[]) AS target_codes
         FROM finance.v_budget_line_performance p
         LEFT JOIN (
           SELECT a.subject_id,
                  sum(a.amount) AS split_total,
                  array_agg(a.id ORDER BY a.target_code) AS allocation_ids,
                  array_agg(a.target_code ORDER BY a.target_code) AS target_codes
             FROM finance.spatial_allocation a
            WHERE a.subject_kind = 'budget_line' AND a.subject_id = $1::uuid
              AND a.status = 'approved' AND a.deleted_at IS NULL
            GROUP BY a.subject_id) sa ON sa.subject_id = p.budget_line_id
        WHERE p.budget_line_id = $1::uuid`,
      // A revision denominated in some other currency is excluded from revised_amount by
      // finance.v_budget_line_performance (FILTER currency = line currency) and must not be
      // added here either: currencies are never converted and never summed (decision D4).
      [rev[0].budget_line_id,
        rev[0].currency === rev[0].line_currency ? rev[0].amount_delta : '0'],
    )
    if (fit[0] && Number(fit[0].approved_split_total) > 0) {
      const { rows: exceeds } = await pg.query(
        'SELECT ($1::numeric > $2::numeric) AS over', [fit[0].approved_split_total, fit[0].revised_after],
      )
      if (exceeds[0].over) {
        return fail(reply, 409, 'spatial_allocations_exceed_revised',
          `Approved geographic splits of ${fit[0].approved_split_total} ${fit[0].currency} would `
          + `exceed the ${fit[0].revised_after} ${fit[0].currency} this reduction would leave on `
          + 'budget line ' + rev[0].budget_line_code + '. Withdraw the splits that no longer fit, '
          + 'then approve the reduction — an approved split is a recorded decision and this '
          + 'system will not revoke one on your behalf.',
          {
            approved_split_total: fit[0].approved_split_total,
            revised_amount: fit[0].revised_amount,
            revised_after: fit[0].revised_after,
            currency: fit[0].currency,
            allocation_ids: fit[0].allocation_ids,
            target_codes: fit[0].target_codes,
            withdraw_endpoint: '/api/finance/spatial-allocations/:id/withdraw',
          })
      }
    }

    try {
      const { rows } = await pg.query(
        `UPDATE finance.budget_revision
            SET state = 'approved', decided_by = $2, decided_at = now(), decision_note = $3
          WHERE id = $1 AND state = 'submitted'
        RETURNING *, ${dateText(null, 'effective_date')}`,
        [request.params.id, request.user.id, request.body?.note || null],
      )
      request.auditDetails = {
        note: request.body?.note || null,
        before: { state: rev[0].state, amount_delta: rev[0].amount_delta, currency: rev[0].currency },
        after: { state: 'approved', decided_by: request.user.id },
      }
      return ok(reply, rows[0])
    } catch (err) {
      if (err.code === '23514' && /requester_is_not_approver/.test(err.constraint || '')) {
        return fail(reply, 403, 'self_approval', 'A revision cannot be approved by the person who requested it.')
      }
      // The database's own copy of the rule checked above (migration 202 §7). Reached only if the
      // pre-check and the trigger disagree — a concurrent split approved between the two — so it
      // answers with the same code rather than a 500.
      if (err.code === '22023' && /exceed the revised amount/.test(err.message || '')) {
        return fail(reply, 409, 'spatial_allocations_exceed_revised', err.message,
          { withdraw_endpoint: '/api/finance/spatial-allocations/:id/withdraw' })
      }
      throw err
    }
  })

  fastify.post('/finance/budget-revisions/:id/reject', {
    preHandler: requirePermission(fastify, 'finance.revision.approve'),
    schema: {
      body: {
        type: 'object', required: ['note'], additionalProperties: false,
        properties: { note: { type: 'string', minLength: 5, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    // A rejected revision is kept, not deleted: what was asked for and refused is part of the
    // record (specification §3.10, §8.1 soft-delete rule).
    const { rows } = await pg.query(
      `UPDATE finance.budget_revision
          SET state = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $1 AND deleted_at IS NULL AND state = 'submitted'
        RETURNING *, ${dateText(null, 'effective_date')}`,
      [request.params.id, request.user.id, request.body.note.trim()],
    )
    if (!rows[0]) return fail(reply, 409, 'not_submitted', 'Only a submitted revision can be rejected.')
    request.auditDetails = {
      note: request.body.note.trim(),
      before: { state: 'submitted' },
      after: { state: 'rejected' },
    }
    return ok(reply, rows[0])
  })

  // ── Commitments ──────────────────────────────────────────────────────────────────────────────
  // Commitments are imported rather than keyed in, so there is no POST here; the import flow
  // writes them. Specification §3.3 admits them "where reliable source data exists" — a council
  // with no commitment data simply has none, and the available-balance figure that excludes them
  // is the one to show.
  fastify.get('/finance/commitments', {
    ...canViewActuals,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid, budget_line_id: uuid,
          status: { type: 'string', enum: ['open', 'partially_liquidated', 'liquidated', 'cancelled'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const { rows } = await pg.query(
      `SELECT c.*, ${dateText('c', 'committed_on')},
              l.code AS budget_line_code, l.description AS budget_line_description,
              (c.amount - c.liquidated_amount) AS outstanding_amount
         FROM finance.commitment c
         JOIN finance.budget_line l ON l.id = c.budget_line_id
        WHERE c.deleted_at IS NULL
          AND ($1::uuid IS NULL OR l.financial_year_id = $1::uuid)
          AND ($2::uuid IS NULL OR c.budget_line_id = $2::uuid)
          AND ($3::text IS NULL OR c.status = $3::text)
          AND ($4::uuid[] IS NULL OR l.department_id = ANY($4::uuid[]))
        ORDER BY c.committed_on DESC
        LIMIT $5 OFFSET $6`,
      [q.financial_year_id || null, q.budget_line_id || null, q.status || null, scope, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  // ── Variance explanations ────────────────────────────────────────────────────────────────────
  fastify.post('/finance/variance-explanations', {
    preHandler: requirePermission(fastify, 'finance.variance.explain'),
    schema: {
      body: {
        type: 'object', required: ['financial_year_id', 'explanation'], additionalProperties: false,
        properties: {
          financial_year_id: uuid, budget_line_id: uuid, department_id: uuid,
          period_label: { type: 'string', maxLength: 60 },
          explanation: { type: 'string', minLength: 10, maxLength: 4000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (!b.budget_line_id && !b.department_id) {
      return fail(reply, 400, 'no_subject', 'Name the budget line or the department the explanation is about.')
    }
    let departmentId = b.department_id || null
    if (b.budget_line_id) {
      const { rows } = await pg.query(
        'SELECT department_id FROM finance.budget_line WHERE id = $1 AND deleted_at IS NULL',
        [b.budget_line_id],
      )
      if (!rows[0]) return fail(reply, 400, 'not_found', 'No such budget line.')
      departmentId = departmentId || rows[0].department_id
    }
    const refusal = await scopeAllows(fastify, request, departmentId)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)

    const { rows } = await pg.query(
      `INSERT INTO finance.variance_explanation
         (financial_year_id, budget_line_id, department_id, period_label, explanation, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.financial_year_id, b.budget_line_id || null, departmentId,
        b.period_label || null, b.explanation.trim(), request.user.id],
    )
    return ok(reply, rows[0], 201)
  })

  // ── Performance roll-up ──────────────────────────────────────────────────────────────────────
  /**
   * Budget performance by department, for a year. ALWAYS GROUPED BY CURRENCY: a department that
   * budgets in both USD and ZWG gets two rows. There is no "total" row across currencies and there
   * will not be one until the Council approves a conversion basis (decision D4).
   */
  fastify.get('/finance/performance', {
    ...canViewActuals,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          department_id: uuid,
          kind: { type: 'string', enum: ['revenue', 'expenditure'] },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)
    const { rows: year } = await pg.query(
      `SELECT id, label, status, reporting_currency, ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`,
      [q.financial_year_id],
    )
    if (!year[0]) return fail(reply, 404, 'not_found', 'No such financial year.')

    const { rows } = await pg.query(
      `SELECT p.*, d.code AS department_code, d.name AS department_name
         FROM finance.v_department_performance p
         JOIN finance.department d ON d.id = p.department_id
        WHERE p.financial_year_id = $1
          AND ($2::uuid IS NULL OR p.department_id = $2::uuid)
          AND ($3::text IS NULL OR p.account_kind = $3::text)
          AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
        ORDER BY d.vote_number NULLS LAST, d.code, p.account_kind, p.currency`,
      [q.financial_year_id, q.department_id || null, q.kind || null, scope],
    )

    const warnAt = await financeSetting(fastify, request.user.authority_id, 'overspend.warn_execution_percentage', 90)
    const flagAt = await financeSetting(fastify, request.user.authority_id, 'overspend.flag_execution_percentage', 100)
    const includeCommitments = await financeSetting(fastify, request.user.authority_id,
      'available_balance.include_commitments', false)

    return ok(reply, {
      financial_year: year[0],
      // One entry per department per account kind per currency. Nothing is summed across these.
      rows,
      thresholds: { warn_execution_percentage: warnAt, flag_execution_percentage: flagAt },
      available_balance_includes_commitments: includeCommitments === true,
      // Stated so a report cannot be produced that looks like a single consolidated total when it
      // is not one.
      currencies_present: [...new Set(rows.map((r) => r.currency))],
    })
  })

  /** Lines worth a second look: over budget, nearly exhausted, or carrying a currency fault. */
  fastify.get('/finance/exceptions/budget', {
    ...canViewActuals,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const warnAt = Number(await financeSetting(fastify, request.user.authority_id, 'overspend.warn_execution_percentage', 90)) || 90
    const flagAt = Number(await financeSetting(fastify, request.user.authority_id, 'overspend.flag_execution_percentage', 100)) || 100
    const scope = await departmentScope(fastify, request)
    const { rows } = await pg.query(
      `SELECT p.*, ${dateText('p', 'last_transaction_date')},
              d.code AS department_code, d.name AS department_name,
              a.code AS account_code, a.name AS account_name,
              CASE
                WHEN p.actual_currency_mismatch_rows > 0 THEN 'currency_mismatch'
                WHEN p.execution_percentage IS NULL AND p.actual_amount <> 0 THEN 'spend_without_budget'
                WHEN p.execution_percentage >= $2 THEN 'over_budget'
                WHEN p.execution_percentage >= $3 THEN 'nearly_exhausted'
              END AS flag
         FROM finance.v_budget_line_performance p
         JOIN finance.department d ON d.id = p.department_id
         JOIN finance.account a    ON a.id = p.account_id
        WHERE p.financial_year_id = $1
          AND ($4::uuid[] IS NULL OR p.department_id = ANY($4::uuid[]))
          AND (p.actual_currency_mismatch_rows > 0
               OR (p.execution_percentage IS NULL AND p.actual_amount <> 0)
               OR p.execution_percentage >= $3)
        ORDER BY p.execution_percentage DESC NULLS FIRST, p.code
        LIMIT 500`,
      [request.query.financial_year_id, flagAt, warnAt, scope],
    )
    return ok(reply, {
      rows,
      thresholds: { warn_execution_percentage: warnAt, flag_execution_percentage: flagAt },
      // These are display warnings against council-configured thresholds. They are not findings,
      // and nothing is blocked by them.
      note: 'Flags are computed against council-configured thresholds and are advisory.',
    })
  })
}

module.exports = { financeBudgetRoutes }
