/**
 * Publication control: what the public sees, who decided it, and when.
 *
 * Table: finance.publication (migration 188). The public read surface is src/routes/finance-public.js.
 *
 * HOW A ROW BECOMES PUBLIC
 * Not by a flag on the record. A finance row is public exactly while a `finance.publication` row
 * for its year and dataset is in state 'published' — and that is enforced by the row-level
 * security policies in §14 of migration 188, not by this route's WHERE clauses. The consequence
 * worth knowing: withdrawing a publication takes the data off the public portal immediately,
 * without touching a single financial record.
 *
 * THE STATES
 *   pending   → requested, awaiting review and approval
 *   approved  → an authorised reviewer has approved the content for release
 *   published → a publisher has released it; the data is live on the public portal
 *   withdrawn → was published, has been taken down; the row stays for the audit trail
 *   rejected  → review refused it
 *
 * SEPARATION OF DUTIES. Approving and publishing are different permissions and no seeded role
 * holds both (asserted in migration 188). On top of that, whether the two acts must be performed
 * by different PEOPLE is a council setting — `separation_of_duties.publication`, default true,
 * decision D6 — because the specification says to separate duties "where practicable" and a
 * council with one finance officer must still be able to publish. The setting is read here, the
 * actors are always both recorded, and a published row without both is refused by a CHECK
 * constraint whatever this route does.
 */

const { requirePermission, requireAnyPermission, separationOfDutiesRequired } = require('../middleware/financePermissions')
const { str, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const DATASETS = ['budget', 'revenue', 'expenditure', 'projects', 'documents', 'reports']

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

async function financePublicationRoutes(fastify) {
  const pg = fastify.pg

  const canReview = { preHandler: requirePermission(fastify, 'finance.publication.review') }
  const canApprove = { preHandler: requirePermission(fastify, 'finance.publication.approve') }
  const canPublish = { preHandler: requirePermission(fastify, 'finance.publication.publish') }
  const canWithdraw = { preHandler: requirePermission(fastify, 'finance.publication.withdraw') }
  const canRead = {
    preHandler: requireAnyPermission(fastify, [
      'finance.publication.review', 'finance.publication.approve', 'finance.publication.publish',
      'finance.budget.view', 'finance.audit.view',
    ]),
  }

  // ── The queue ────────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/publications', {
    ...canRead,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          dataset: { type: 'string', enum: DATASETS },
          state: { type: 'string', enum: ['pending', 'approved', 'rejected', 'published', 'withdrawn'] },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT p.*, ${dateText('p', 'data_as_at')},
              y.label AS financial_year_label, y.status AS financial_year_status,
              b.original_filename AS import_filename, b.file_hash AS import_file_hash,
              b.reconciliation_status AS import_reconciliation_status,
              COALESCE(ru.full_name, ru.name) AS reviewed_by_name,
              COALESCE(au.full_name, au.name) AS approved_by_name,
              COALESCE(pu.full_name, pu.name) AS published_by_name,
              COALESCE(wu.full_name, wu.name) AS withdrawn_by_name
         FROM finance.publication p
         JOIN finance.financial_year y ON y.id = p.financial_year_id
         LEFT JOIN finance.import_batch b ON b.id = p.import_batch_id
         LEFT JOIN public.users ru ON ru.id = p.reviewed_by
         LEFT JOIN public.users au ON au.id = p.approved_by
         LEFT JOIN public.users pu ON pu.id = p.published_by
         LEFT JOIN public.users wu ON wu.id = p.withdrawn_by
        WHERE ($1::uuid IS NULL OR p.financial_year_id = $1::uuid)
          AND ($2::text IS NULL OR p.dataset = $2::text)
          AND ($3::text IS NULL OR p.state = $3::text)
        ORDER BY p.created_at DESC
        LIMIT $4 OFFSET $5`,
      [q.financial_year_id || null, q.dataset || null, q.state || null, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  /**
   * What a release would make public, before it is made public.
   *
   * A publisher is being asked to put council figures in front of residents; they should be able
   * to see the counts and totals they are about to publish, per currency, and whether the import
   * behind them reconciled. Counts, not rows: the detail is available through the ordinary
   * endpoints to anyone with permission to see it.
   */
  fastify.get('/finance/publications/:id/preview', canReview, async (request, reply) => {
    const { rows: pub } = await pg.query(
      `SELECT p.*, ${dateText('p', 'data_as_at')},
              y.label AS financial_year_label, ${dateText('y', 'start_date', 'end_date')}
         FROM finance.publication p
         JOIN finance.financial_year y ON y.id = p.financial_year_id
        WHERE p.id = $1`, [request.params.id],
    )
    if (!pub[0]) return fail(reply, 404, 'not_found', 'No such publication.')
    const p = pub[0]

    let summary = []
    if (p.dataset === 'budget') {
      const { rows } = await pg.query(
        `SELECT currency, count(*)::int AS rows,
                sum(original_amount) AS original_total,
                sum(revised_amount) AS revised_total
           FROM finance.v_budget_line_performance
          WHERE financial_year_id = $1 AND status = 'published'
          GROUP BY currency ORDER BY currency`, [p.financial_year_id],
      )
      summary = rows
      if (rows.length === 0) {
        const { rows: unpublished } = await pg.query(
          `SELECT count(*)::int AS n FROM finance.budget_line
            WHERE financial_year_id = $1 AND status = 'approved' AND deleted_at IS NULL`,
          [p.financial_year_id],
        )
        return ok(reply, {
          publication: p,
          summary: [],
          warning: unpublished[0].n > 0
            ? `No budget line for this year is marked published, so this release would show nothing. ${unpublished[0].n} approved line(s) are waiting to be marked published.`
            : 'No approved budget lines exist for this year, so this release would show nothing.',
        })
      }
    } else if (p.dataset === 'revenue' || p.dataset === 'expenditure') {
      const kind = p.dataset === 'revenue' ? 'revenue' : 'expenditure'
      const { rows } = await pg.query(
        `SELECT t.currency, count(*)::int AS rows, sum(t.amount) AS total,
                min(t.txn_date)::text AS earliest, max(t.txn_date)::text AS latest
           FROM finance.transaction t JOIN finance.account a ON a.id = t.account_id
          WHERE t.financial_year_id = $1 AND a.kind = $2 AND t.deleted_at IS NULL
          GROUP BY t.currency ORDER BY t.currency`, [p.financial_year_id, kind],
      )
      summary = rows
    } else if (p.dataset === 'projects') {
      const { rows } = await pg.query(
        `SELECT currency, count(*)::int AS rows, sum(approved_budget) AS approved_budget_total
           FROM finance.project
          WHERE deleted_at IS NULL AND status IN ('approved','in_progress','suspended','completed')
          GROUP BY currency ORDER BY currency`,
      )
      summary = rows
    } else if (p.dataset === 'documents') {
      const { rows } = await pg.query(
        `SELECT count(*)::int AS rows FROM finance.document
          WHERE visibility = 'public' AND deleted_at IS NULL`,
      )
      summary = rows
    }

    // The transaction datasets carry counterparty columns; the public view does not select them.
    // Saying so here is the difference between a publisher trusting the system and hoping.
    return ok(reply, {
      publication: p,
      // Per currency. Never a combined total.
      summary,
      withheld_from_public: (p.dataset === 'revenue' || p.dataset === 'expenditure')
        ? ['counterparty_ref', 'counterparty_name', 'import lineage', 'internal notes']
        : [],
      note: 'The public portal reads finance.v_published_transaction, which does not select the counterparty columns at all.',
    })
  })

  /**
   * Request a release. Creating the row is a review act, not an approval: a new publication starts
   * 'pending' whoever creates it.
   */
  fastify.post('/finance/publications', {
    ...canReview,
    schema: {
      body: {
        type: 'object', required: ['financial_year_id', 'dataset'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          dataset: { type: 'string', enum: DATASETS },
          import_batch_id: uuid,
          scope: { type: 'object' },
          reporting_period_label: { type: 'string', maxLength: 120 },
          data_as_at: { type: 'string', format: 'date' },
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows: next } = await client.query(
        `SELECT COALESCE(max(version), 0) + 1 AS v FROM finance.publication
          WHERE financial_year_id = $1 AND dataset = $2`, [b.financial_year_id, b.dataset],
      )
      const { rows } = await client.query(
        `INSERT INTO finance.publication
           (financial_year_id, dataset, version, scope, import_batch_id,
            reporting_period_label, data_as_at, decision_note, created_by)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
         RETURNING *, ${dateText(null, 'data_as_at')}`,
        [b.financial_year_id, b.dataset, next[0].v,
          b.scope ? JSON.stringify(b.scope) : null, b.import_batch_id || null,
          b.reporting_period_label || null, b.data_as_at || null, b.notes || null, request.user.id],
      )
      await client.query('COMMIT')
      return ok(reply, rows[0], 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err.code === '23505') {
        return fail(reply, 409, 'concurrent_version', 'Another version was created at the same moment. Try again.')
      }
      if (err.code === '23503') return fail(reply, 400, 'unknown_reference', 'No such financial year or import batch.')
      throw err
    } finally {
      client.release()
    }
  })

  fastify.post('/finance/publications/:id/approve', {
    ...canApprove,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { note: { type: 'string', maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { rows: pub } = await pg.query(
      'SELECT id, state, created_by FROM finance.publication WHERE id = $1', [request.params.id],
    )
    if (!pub[0]) return fail(reply, 404, 'not_found', 'No such publication.')
    if (pub[0].state !== 'pending') {
      return fail(reply, 409, 'not_pending', `This publication is ${pub[0].state}.`)
    }
    const { rows } = await pg.query(
      `UPDATE finance.publication
          SET state = 'approved', reviewed_by = COALESCE(reviewed_by, $2), reviewed_at = COALESCE(reviewed_at, now()),
              approved_by = $2, approved_at = now(), decision_note = COALESCE($3, decision_note)
        WHERE id = $1 AND state = 'pending'
        RETURNING *, ${dateText(null, 'data_as_at')}`,
      [request.params.id, request.user.id, request.body?.note || null],
    )
    request.auditDetails = {
      note: request.body?.note || null,
      before: { state: 'pending' },
      after: { state: 'approved', approved_by: request.user.id },
    }
    return ok(reply, rows[0])
  })

  fastify.post('/finance/publications/:id/reject', {
    ...canApprove,
    schema: {
      body: {
        type: 'object', required: ['note'], additionalProperties: false,
        properties: { note: { type: 'string', minLength: 5, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.publication
          SET state = 'rejected', reviewed_by = $2, reviewed_at = now(), decision_note = $3
        WHERE id = $1 AND state = 'pending'
        RETURNING *, ${dateText(null, 'data_as_at')}`,
      [request.params.id, request.user.id, request.body.note.trim()],
    )
    if (!rows[0]) return fail(reply, 409, 'not_pending', 'Only a pending publication can be rejected.')
    request.auditDetails = {
      note: request.body.note.trim(),
      before: { state: 'pending' },
      after: { state: 'rejected' },
    }
    return ok(reply, rows[0])
  })

  /**
   * Publish. The act that puts council figures in front of residents.
   *
   * Publishing a new version withdraws the live one in the same transaction, so the public portal
   * never shows two versions of the same dataset and never shows none in between.
   */
  fastify.post('/finance/publications/:id/publish', canPublish, async (request, reply) => {
    const { rows: pub } = await pg.query(
      `SELECT p.*, y.label AS year_label FROM finance.publication p
         JOIN finance.financial_year y ON y.id = p.financial_year_id
        WHERE p.id = $1`, [request.params.id],
    )
    if (!pub[0]) return fail(reply, 404, 'not_found', 'No such publication.')
    const p = pub[0]
    if (p.state === 'published') return ok(reply, p) // idempotent
    if (p.state !== 'approved') {
      return fail(reply, 409, 'not_approved',
        `This publication is ${p.state}. Only an approved dataset can be published.`)
    }

    const separate = await separationOfDutiesRequired(fastify, request.user.authority_id)
    if (separate && p.approved_by === request.user.id) {
      return fail(reply, 403, 'separation_of_duties',
        'You approved this dataset. Publication must be carried out by someone else. The Council can relax this with the setting separation_of_duties.publication.',
        { setting: 'separation_of_duties.publication' })
    }

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      // Retire the live version of this dataset, if there is one.
      const { rows: superseded } = await client.query(
        `UPDATE finance.publication
            SET state = 'withdrawn', withdrawn_by = $3, withdrawn_at = now(),
                withdraw_reason = format('Superseded by version %s', $4::int)
          WHERE financial_year_id = $1 AND dataset = $2 AND state = 'published'
          RETURNING id, version`,
        [p.financial_year_id, p.dataset, request.user.id, p.version],
      )
      const { rows } = await client.query(
        `UPDATE finance.publication
            SET state = 'published', published_by = $2, published_at = now()
          WHERE id = $1 AND state = 'approved'
        RETURNING *, ${dateText(null, 'data_as_at')}`,
        [request.params.id, request.user.id],
      )
      await client.query('COMMIT')
      request.auditDetails = {
        before: { state: p.state },
        after: {
          state: 'published',
          published_by: request.user.id,
          superseded: superseded.map((s) => ({ id: s.id, version: s.version })),
        },
      }
      return ok(reply, {
        publication: rows[0],
        superseded: superseded.map((s) => ({ id: s.id, version: s.version })),
        // What this actually did, in plain terms.
        effect: `${p.dataset} for ${p.year_label} is now visible on the public portal. Prior versions remain on record.`,
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err.code === '23514' && /published_has_both_actors/.test(err.constraint || '')) {
        return fail(reply, 409, 'approval_missing', 'A published dataset must record both its approver and its publisher.')
      }
      throw err
    } finally {
      client.release()
    }
  })

  fastify.post('/finance/publications/:id/withdraw', {
    ...canWithdraw,
    schema: {
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 10, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    // Withdrawal takes the data off the public portal at once — the row-level security policies
    // key off this state — and changes no financial record.
    const { rows } = await pg.query(
      `UPDATE finance.publication
          SET state = 'withdrawn', withdrawn_by = $2, withdrawn_at = now(), withdraw_reason = $3
        WHERE id = $1 AND state = 'published'
        RETURNING *, ${dateText(null, 'data_as_at')}`,
      [request.params.id, request.user.id, request.body.reason.trim()],
    )
    if (!rows[0]) return fail(reply, 409, 'not_published', 'Only a published dataset can be withdrawn.')
    request.auditDetails = {
      reason: request.body.reason.trim(),
      before: { state: 'published' },
      after: { state: 'withdrawn' },
    }
    return ok(reply, {
      publication: rows[0],
      effect: 'This dataset is no longer visible on the public portal. No financial record was changed.',
    })
  })

  /**
   * Mark approved budget lines as published, so the public sees the budget rather than nothing.
   *
   * Two conditions make a budget line public (migration 188 §14): the budget dataset is published
   * for its year, AND the line itself is at status 'published'. This is the second step, kept
   * separate so that releasing a year's budget does not sweep up lines that are still in draft.
   */
  fastify.post('/finance/publications/:id/mark-budget-lines', {
    ...canPublish,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { department_id: uuid },
      },
    },
  }, async (request, reply) => {
    const { rows: pub } = await pg.query(
      'SELECT id, state, dataset, financial_year_id FROM finance.publication WHERE id = $1',
      [request.params.id],
    )
    if (!pub[0]) return fail(reply, 404, 'not_found', 'No such publication.')
    if (pub[0].dataset !== 'budget') {
      return fail(reply, 400, 'wrong_dataset', 'Only a budget publication marks budget lines.')
    }
    if (!['approved', 'published'].includes(pub[0].state)) {
      return fail(reply, 409, 'not_approved', `This publication is ${pub[0].state}.`)
    }
    const { rows } = await pg.query(
      `UPDATE finance.budget_line
          SET status = 'published'
        WHERE financial_year_id = $1 AND status = 'approved' AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR department_id = $2::uuid)
        RETURNING id`,
      [pub[0].financial_year_id, request.body?.department_id || null],
    )
    return ok(reply, {
      marked: rows.length,
      note: rows.length === 0
        ? 'No approved budget line was waiting to be marked. Only approved lines can be published.'
        : undefined,
    })
  })

  // ── Documents ────────────────────────────────────────────────────────────────────────────────
  /**
   * Change a document's visibility. This is the one place a finance document becomes public, and it
   * takes a deliberate act by a publisher — nothing makes a document public as a side effect of
   * anything else (decision D5).
   */
  fastify.patch('/finance/documents/:id/visibility', {
    ...canPublish,
    schema: {
      body: {
        type: 'object', required: ['visibility'], additionalProperties: false,
        properties: {
          visibility: { type: 'string', enum: ['private', 'internal', 'public'] },
          reason: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    if (request.body.visibility === 'public' && !str(request.body.reason, 2000)) {
      return fail(reply, 400, 'reason_required',
        'Publishing a document requires a stated reason, which is kept in the audit trail.')
    }
    const { rows } = await pg.query(
      `UPDATE finance.document SET visibility = $2
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, filename, visibility, subject_kind, subject_id`,
      [request.params.id, request.body.visibility],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such document.')
    return ok(reply, rows[0])
  })
}

module.exports = { financePublicationRoutes }
