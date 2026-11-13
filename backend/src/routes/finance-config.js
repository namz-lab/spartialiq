/**
 * Finance configuration: financial years, the vote and programme structure, the chart of accounts,
 * council finance settings and the import column mappings.
 *
 * Tables: finance.* (migration 188). Authorisation: src/middleware/financePermissions.js.
 *
 * NOTHING HERE IS SEEDED WITH REAL VALUES. A financial year, a department and an account code are
 * the Council's to define (decisions D1–D3 in docs/finance/COUNCIL-DECISIONS.md); this module is
 * the means of entering them, not a guess at what they are.
 *
 * `authority_id` is never passed from the client. Every finance table defaults it to
 * `app.authority_id()`, which the scoped connection sets from the signed-in person
 * (src/lib/dbContext.js), so a route cannot write into another council's books even by mistake,
 * and a request with no authority fails rather than landing somewhere plausible.
 */

const {
  requirePermission, requireAnyPermission, permissionsFor, departmentScope,
} = require('../middleware/financePermissions')
const { authenticate } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const { str, normaliseCode, isCurrency, dateText } = require('../lib/finance')
const { workspacesFor } = require('../config/financeWorkspaces')

const CONFIG = 'finance.config.manage'
const VIEW_BUDGET = 'finance.budget.view'

// Fastify validates the body against these before a handler runs, so a malformed request is
// refused at the API boundary with a consistent error shape rather than by a hand-written `if`.
const code = { type: 'string', minLength: 1, maxLength: 60 }
const name = { type: 'string', minLength: 1, maxLength: 300 }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const isoDate = { type: 'string', format: 'date' }
const uuid = { type: 'string', format: 'uuid' }

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

async function financeConfigRoutes(fastify) {
  const pg = fastify.pg

  const canConfig = { preHandler: requirePermission(fastify, CONFIG) }
  const canViewBudget = { preHandler: requirePermission(fastify, VIEW_BUDGET) }
  // Reading the structure is needed by anyone who can see a budget, an actual or a project.
  const canRead = {
    preHandler: requireAnyPermission(fastify, [
      VIEW_BUDGET, 'finance.actuals.view', 'finance.project.view', 'finance.report.view',
    ]),
  }

  // ── Who am I, in finance terms ───────────────────────────────────────────────────────────────
  // The frontend uses this to decide which surfaces to offer. It is a CONVENIENCE, not the
  // control: every endpoint below re-checks the permission server-side, so a hand-crafted request
  // from a hidden menu gets the same 403 as one from a visible button.
  fastify.get('/finance/me', { preHandler: async (request, reply) => {
    const user = await authenticate(fastify, request, reply)
    if (!user) return
  } }, async (request, reply) => {
    const permissions = await permissionsFor(fastify, request)
    const scope = await departmentScope(fastify, request)
    let scopeNames = []
    if (scope && scope.length) {
      const { rows } = await pg.query(
        'SELECT id, code, name FROM finance.department WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [scope],
      )
      scopeNames = rows
    }
    const { rows: cat } = await systemOf(pg).query(
      'SELECT code, label, category, is_approval, is_publication, is_restricted FROM finance.permission ORDER BY category, code',
    )
    const places = workspacesFor({
      role: request.user.role, permissions, scoped: Boolean(scope && scope.length),
    })
    return ok(reply, {
      user_id: request.user.id,
      role: request.user.role,
      authority_id: request.user.authority_id ?? null,
      permissions: [...permissions].sort(),
      department_scope: scopeNames,
      // Sent so the UI can explain *why* something is unavailable instead of hiding it silently.
      catalogue: cat,
      // Which role workspaces this person may open, and where they land. Decided here so the
      // browser never computes access; still a convenience, since every route re-checks.
      workspaces: places.workspaces,
      home_workspace: places.home,
    })
  })

  // ── Financial years ──────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/financial-years', canRead, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT y.*, ${dateText('y', 'start_date', 'end_date')},
              (SELECT count(*) FROM finance.budget_line l
                WHERE l.financial_year_id = y.id AND l.deleted_at IS NULL) AS budget_line_count,
              (SELECT count(*) FROM finance.transaction t
                WHERE t.financial_year_id = y.id AND t.deleted_at IS NULL) AS transaction_count
         FROM finance.financial_year y
        WHERE y.deleted_at IS NULL
        ORDER BY y.start_date DESC`,
    )
    return ok(reply, rows)
  })

  fastify.post('/finance/financial-years', {
    ...canConfig,
    schema: {
      body: {
        type: 'object',
        required: ['label', 'start_date', 'end_date'],
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 40 },
          start_date: isoDate,
          end_date: isoDate,
          reporting_currency: currency,
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (b.end_date <= b.start_date) {
      return fail(reply, 400, 'invalid_period', 'The end date must fall after the start date.')
    }
    // Reporting periods must not overlap: two open years covering the same day would make
    // "the actuals for this year" ambiguous, and there is no honest answer to an ambiguous total.
    const { rows: clash } = await pg.query(
      `SELECT label, start_date, end_date FROM finance.financial_year
        WHERE deleted_at IS NULL
          AND daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')
        LIMIT 1`,
      [b.start_date, b.end_date],
    )
    if (clash.length) {
      return fail(reply, 409, 'period_overlaps',
        `This period overlaps the financial year ${clash[0].label} (${clash[0].start_date} to ${clash[0].end_date}).`)
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.financial_year
           (label, start_date, end_date, reporting_currency, notes, created_by)
         VALUES ($1, $2, $3, COALESCE($4, 'USD'), $5, $6)
         RETURNING *, ${dateText(null, 'start_date', 'end_date')}`,
        [b.label.trim(), b.start_date, b.end_date, b.reporting_currency || null,
          b.notes || null, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') return fail(reply, 409, 'duplicate_label', 'That label is already in use.')
      if (err.code === '23514') return fail(reply, 400, 'invalid_period', 'The period fails a database constraint.')
      throw err
    }
  })

  fastify.patch('/finance/financial-years/:id', {
    ...canConfig,
    schema: {
      params: { type: 'object', properties: { id: uuid } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 40 },
          reporting_currency: currency,
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    // The dates of a year that already carries records are not editable here: moving them would
    // silently move transactions between reporting periods. A correction needs a new year.
    const { rows } = await pg.query(
      `UPDATE finance.financial_year
          SET label = COALESCE($2, label),
              reporting_currency = COALESCE($3, reporting_currency),
              notes = COALESCE($4, notes)
        WHERE id = $1 AND deleted_at IS NULL AND status IN ('draft', 'open')
        RETURNING *, ${dateText(null, 'start_date', 'end_date')}`,
      [request.params.id, request.body.label || null, request.body.reporting_currency || null,
        request.body.notes || null],
    )
    if (!rows[0]) {
      return fail(reply, 404, 'not_found',
        'No open or draft financial year with that id. A closed year cannot be edited.')
    }
    return ok(reply, rows[0])
  })

  // Opening a year is configuration; closing or reopening one is a separate permission, because
  // closing a period is the act that freezes a set of books.
  fastify.post('/finance/financial-years/:id/open', canConfig, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.financial_year
          SET status = 'open', opened_at = now(), opened_by = $2
        WHERE id = $1 AND deleted_at IS NULL AND status = 'draft'
        RETURNING *, ${dateText(null, 'start_date', 'end_date')}`,
      [request.params.id, request.user.id],
    )
    if (!rows[0]) return fail(reply, 409, 'not_draft', 'Only a draft financial year can be opened.')
    return ok(reply, rows[0])
  })

  fastify.post('/finance/financial-years/:id/close', {
    preHandler: requirePermission(fastify, 'finance.year.close'),
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { note: { type: 'string', maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    // Open import batches would be committed into a frozen year the moment someone pressed the
    // button, so closing refuses while any batch is still in flight. The officer is told which.
    const { rows: open } = await pg.query(
      `SELECT id, original_filename, status FROM finance.import_batch
        WHERE financial_year_id = $1 AND deleted_at IS NULL
          AND status IN ('uploaded', 'mapped', 'validating', 'validated', 'committing')`,
      [request.params.id],
    )
    if (open.length) {
      return fail(reply, 409, 'open_import_batches',
        `${open.length} import batch(es) are still open for this year. Commit or cancel them before closing.`)
    }
    const { rows } = await pg.query(
      `UPDATE finance.financial_year
          SET status = 'closed', closed_at = now(), closed_by = $2,
              notes = COALESCE($3, notes)
        WHERE id = $1 AND deleted_at IS NULL AND status = 'open'
        RETURNING *, ${dateText(null, 'start_date', 'end_date')}`,
      [request.params.id, request.user.id, request.body?.note || null],
    )
    if (!rows[0]) return fail(reply, 409, 'not_open', 'Only an open financial year can be closed.')
    return ok(reply, rows[0])
  })

  fastify.post('/finance/financial-years/:id/reopen', {
    preHandler: requirePermission(fastify, 'finance.year.close'),
    schema: {
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 10, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    // Reopening a closed period is exceptional, so it demands a written reason. The reason goes on
    // the year and the act goes in the audit trail (FIN_CONFIG, severity high).
    const { rows } = await pg.query(
      `UPDATE finance.financial_year
          SET status = 'open', closed_at = NULL, closed_by = NULL,
              notes = concat_ws(E'\\n', notes, format('Reopened %s: %s', now()::date, $2::text))
        WHERE id = $1 AND deleted_at IS NULL AND status = 'closed'
        RETURNING *, ${dateText(null, 'start_date', 'end_date')}`,
      [request.params.id, request.body.reason.trim()],
    )
    if (!rows[0]) return fail(reply, 409, 'not_closed', 'Only a closed financial year can be reopened.')
    return ok(reply, rows[0])
  })

  // ── Departments (votes) ──────────────────────────────────────────────────────────────────────
  fastify.get('/finance/departments', canRead, async (request, reply) => {
    const scope = await departmentScope(fastify, request)
    const { rows } = await pg.query(
      `SELECT d.*, u.email AS head_email, COALESCE(u.full_name, u.name) AS head_name
         FROM finance.department d
         LEFT JOIN public.users u ON u.id = d.head_user_id
        WHERE d.deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR d.id = ANY($1::uuid[]))
        ORDER BY d.vote_number NULLS LAST, d.code`,
      [scope],
    )
    return ok(reply, rows)
  })

  fastify.post('/finance/departments', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', required: ['code', 'name'], additionalProperties: false,
        properties: {
          code, name,
          vote_number: { type: 'integer', minimum: 0, maximum: 99999 },
          parent_id: uuid,
          head_user_id: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.department (code, name, vote_number, parent_id, head_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [normaliseCode(b.code), b.name.trim(), b.vote_number ?? null,
          b.parent_id || null, b.head_user_id || null, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') return fail(reply, 409, 'duplicate_code', 'A department already uses that code.')
      throw err
    }
  })

  fastify.patch('/finance/departments/:id', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name, vote_number: { type: 'integer', minimum: 0, maximum: 99999 },
          head_user_id: uuid, status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows } = await pg.query(
      `UPDATE finance.department
          SET name = COALESCE($2, name), vote_number = COALESCE($3, vote_number),
              head_user_id = COALESCE($4, head_user_id), status = COALESCE($5, status)
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, b.name || null, b.vote_number ?? null, b.head_user_id || null, b.status || null],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such department.')
    return ok(reply, rows[0])
  })

  // A department is never hard-deleted: budget lines and transactions reference it, and a financial
  // record must stay readable years after the department was wound up (specification §8.1).
  fastify.delete('/finance/departments/:id', canConfig, async (request, reply) => {
    const { rows: used } = await pg.query(
      `SELECT (SELECT count(*) FROM finance.budget_line WHERE department_id = $1 AND deleted_at IS NULL) AS lines,
              (SELECT count(*) FROM finance.transaction WHERE department_id = $1 AND deleted_at IS NULL) AS txns`,
      [request.params.id],
    )
    if (Number(used[0].lines) > 0 || Number(used[0].txns) > 0) {
      // Retiring it keeps every figure that was ever posted against it intact and traceable.
      const { rows } = await pg.query(
        `UPDATE finance.department SET status = 'inactive' WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [request.params.id],
      )
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such department.')
      return ok(reply, { ...rows[0], retired_instead_of_deleted: true,
        reason: `${used[0].lines} budget line(s) and ${used[0].txns} transaction(s) reference this department.` })
    }
    const { rows } = await pg.query(
      `UPDATE finance.department SET deleted_at = now(), deleted_by = $2
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [request.params.id, request.user.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such department.')
    return ok(reply, { id: rows[0].id, deleted: true })
  })

  // ── Programmes and activities ────────────────────────────────────────────────────────────────
  for (const [path, table, parentCol, parentTable] of [
    ['programmes', 'programme', 'department_id', 'department'],
    ['activities', 'activity', 'programme_id', 'programme'],
  ]) {
    fastify.get(`/finance/${path}`, canRead, async (request, reply) => {
      const parent = str(request.query?.[parentCol], 64)
      const { rows } = await pg.query(
        `SELECT * FROM finance.${table}
          WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR ${parentCol} = $1::uuid)
          ORDER BY code`,
        [parent],
      )
      return ok(reply, rows)
    })

    fastify.post(`/finance/${path}`, {
      ...canConfig,
      schema: {
        body: {
          type: 'object', required: ['code', 'name', parentCol], additionalProperties: false,
          properties: { code, name, [parentCol]: uuid, description: { type: 'string', maxLength: 2000 } },
        },
      },
    }, async (request, reply) => {
      const b = request.body
      const cols = table === 'programme'
        ? ['code', 'name', parentCol, 'description', 'created_by']
        : ['code', 'name', parentCol, 'created_by']
      const vals = table === 'programme'
        ? [normaliseCode(b.code), b.name.trim(), b[parentCol], b.description || null, request.user.id]
        : [normaliseCode(b.code), b.name.trim(), b[parentCol], request.user.id]
      try {
        const { rows } = await pg.query(
          `INSERT INTO finance.${table} (${cols.join(', ')})
           VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, vals,
        )
        return ok(reply, rows[0], 201)
      } catch (err) {
        if (err.code === '23505') return fail(reply, 409, 'duplicate_code', `A ${table} already uses that code.`)
        if (err.code === '23503') return fail(reply, 400, 'unknown_parent', `No such ${parentTable}.`)
        throw err
      }
    })

    fastify.patch(`/finance/${path}/:id`, {
      ...canConfig,
      schema: {
        body: {
          type: 'object', additionalProperties: false,
          properties: { name, status: { type: 'string', enum: ['active', 'inactive'] },
            description: { type: 'string', maxLength: 2000 } },
        },
      },
    }, async (request, reply) => {
      const b = request.body
      const setDescription = table === 'programme' ? ', description = COALESCE($4, description)' : ''
      const params = table === 'programme'
        ? [request.params.id, b.name || null, b.status || null, b.description || null]
        : [request.params.id, b.name || null, b.status || null]
      const { rows } = await pg.query(
        `UPDATE finance.${table}
            SET name = COALESCE($2, name), status = COALESCE($3, status)${setDescription}
          WHERE id = $1 AND deleted_at IS NULL RETURNING *`, params,
      )
      if (!rows[0]) return fail(reply, 404, 'not_found', `No such ${table}.`)
      return ok(reply, rows[0])
    })
  }

  // ── Chart of accounts ────────────────────────────────────────────────────────────────────────
  // `kind` is required on every account and is never inferred. A council whose codes happen to run
  // 1000–4999 for revenue and 5000–7999 for expenditure still has to say so account by account,
  // because the next council's codes will not, and a wrong guess here mislabels a whole budget.
  fastify.get('/finance/accounts', canRead, async (request, reply) => {
    const kind = request.query?.kind
    const { rows } = await pg.query(
      `SELECT a.*, ${dateText('a', 'effective_from', 'effective_to')},
              p.code AS parent_code, p.name AS parent_name
         FROM finance.account a
         LEFT JOIN finance.account p ON p.id = a.parent_id
        WHERE a.deleted_at IS NULL
          AND ($1::text IS NULL OR a.kind = $1::text)
        ORDER BY a.kind, a.code`,
      [kind === 'revenue' || kind === 'expenditure' ? kind : null],
    )
    return ok(reply, rows)
  })

  const accountBody = {
    type: 'object',
    required: ['code', 'name', 'kind'],
    additionalProperties: false,
    properties: {
      code, name,
      kind: { type: 'string', enum: ['revenue', 'expenditure'] },
      revenue_class: { type: 'string', enum: ['internally_generated', 'grant', 'transfer', 'other'] },
      expenditure_class: { type: 'string', enum: ['recurrent', 'capital'] },
      parent_id: uuid,
      is_postable: { type: 'boolean' },
      effective_from: isoDate,
      effective_to: isoDate,
    },
  }

  fastify.post('/finance/accounts', { ...canConfig, schema: { body: accountBody } },
    async (request, reply) => {
      const b = request.body
      if (b.kind === 'revenue' && b.expenditure_class) {
        return fail(reply, 400, 'class_mismatch', 'A revenue account cannot carry an expenditure class.')
      }
      if (b.kind === 'expenditure' && b.revenue_class) {
        return fail(reply, 400, 'class_mismatch', 'An expenditure account cannot carry a revenue class.')
      }
      try {
        const { rows } = await pg.query(
          `INSERT INTO finance.account
             (code, name, kind, revenue_class, expenditure_class, parent_id, is_postable,
              effective_from, effective_to, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true), $8, $9, $10) RETURNING *`,
          [normaliseCode(b.code), b.name.trim(), b.kind, b.revenue_class || null,
            b.expenditure_class || null, b.parent_id || null, b.is_postable,
            b.effective_from || null, b.effective_to || null, request.user.id],
        )
        return ok(reply, rows[0], 201)
      } catch (err) {
        if (err.code === '23505') return fail(reply, 409, 'duplicate_code', 'An account already uses that code.')
        throw err
      }
    })

  /**
   * Load a chart of accounts in one go.
   *
   * A council supplies its chart as a list, not one account at a time. This is a single
   * transaction: either the whole chart loads or none of it does, so a half-loaded chart — which
   * would silently send half of an import to the exception queue — cannot happen.
   *
   * It UPDATES an existing code's name and classification but will not change an account's `kind`
   * once transactions have been posted against it: that would reclassify history. Such an account
   * is reported back in `refused` and the rest of the chart still loads.
   */
  fastify.post('/finance/accounts/bulk', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', required: ['accounts'], additionalProperties: false,
        properties: {
          accounts: {
            type: 'array', minItems: 1, maxItems: 5000,
            items: { ...accountBody, properties: { ...accountBody.properties, parent_code: code } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const client = await pg.connect()
    const created = []
    const updated = []
    const refused = []
    try {
      await client.query('BEGIN')
      for (const a of request.body.accounts) {
        const c = normaliseCode(a.code)
        const { rows: existing } = await client.query(
          'SELECT id, kind FROM finance.account WHERE code = $1 AND deleted_at IS NULL', [c],
        )
        if (existing.length) {
          if (existing[0].kind !== a.kind) {
            const { rows: posted } = await client.query(
              'SELECT count(*)::int AS n FROM finance.transaction WHERE account_id = $1 AND deleted_at IS NULL',
              [existing[0].id],
            )
            if (posted[0].n > 0) {
              refused.push({ code: c, reason: 'kind_change_would_reclassify_history',
                detail: `${posted[0].n} transaction(s) are already posted to ${c} as ${existing[0].kind}.` })
              continue
            }
          }
          const { rows } = await client.query(
            `UPDATE finance.account
                SET name = $2, kind = $3, revenue_class = $4, expenditure_class = $5,
                    is_postable = COALESCE($6, is_postable)
              WHERE id = $1 RETURNING code`,
            [existing[0].id, a.name.trim(), a.kind, a.revenue_class || null,
              a.expenditure_class || null, a.is_postable],
          )
          updated.push(rows[0].code)
        } else {
          const { rows } = await client.query(
            `INSERT INTO finance.account
               (code, name, kind, revenue_class, expenditure_class, is_postable,
                parent_id, effective_from, effective_to, created_by)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, true),
                     (SELECT id FROM finance.account WHERE code = $7 AND deleted_at IS NULL),
                     $8, $9, $10)
             RETURNING code`,
            [c, a.name.trim(), a.kind, a.revenue_class || null, a.expenditure_class || null,
              a.is_postable, a.parent_code ? normaliseCode(a.parent_code) : null,
              a.effective_from || null, a.effective_to || null, request.user.id],
          )
          created.push(rows[0].code)
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    return ok(reply, { created: created.length, updated: updated.length, refused })
  })

  fastify.patch('/finance/accounts/:id', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name,
          revenue_class: { type: 'string', enum: ['internally_generated', 'grant', 'transfer', 'other'] },
          expenditure_class: { type: 'string', enum: ['recurrent', 'capital'] },
          is_postable: { type: 'boolean' },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    },
  }, async (request, reply) => {
    // `kind` is deliberately absent: see the bulk loader. Reclassifying an account that carries
    // history is not an edit, it is a restatement, and it needs a decision and a new account.
    const b = request.body
    const { rows } = await pg.query(
      `UPDATE finance.account
          SET name = COALESCE($2, name),
              revenue_class = COALESCE($3, revenue_class),
              expenditure_class = COALESCE($4, expenditure_class),
              is_postable = COALESCE($5, is_postable),
              status = COALESCE($6, status)
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, b.name || null, b.revenue_class || null, b.expenditure_class || null,
        b.is_postable, b.status || null],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such account.')
    return ok(reply, rows[0])
  })

  // ── Council finance settings ─────────────────────────────────────────────────────────────────
  const SETTABLE = new Set([
    'available_balance.include_commitments',
    'separation_of_duties.publication',
    'overspend.warn_execution_percentage',
    'overspend.flag_execution_percentage',
    'reporting.default_currency',
    'import.max_rows',
    'import.max_file_bytes',
  ])

  fastify.get('/finance/settings', canViewBudget, async (_request, reply) => {
    const { rows } = await pg.query('SELECT key, value, updated_at FROM finance.setting ORDER BY key')
    return ok(reply, rows)
  })

  fastify.put('/finance/settings/:key', {
    ...canConfig,
    schema: {
      body: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: {} } },
    },
  }, async (request, reply) => {
    const key = request.params.key
    if (!SETTABLE.has(key)) {
      return fail(reply, 400, 'unknown_setting',
        `${key} is not a settable finance setting. Settable keys: ${[...SETTABLE].join(', ')}`)
    }
    const v = request.body.value
    // Each setting's shape is checked here because the column is jsonb and would otherwise accept
    // a string where a boolean is meant, which would quietly disable a control.
    const bad = (m) => fail(reply, 400, 'invalid_value', m)
    if (key === 'available_balance.include_commitments' || key === 'separation_of_duties.publication') {
      if (typeof v !== 'boolean') return bad('This setting is true or false.')
    } else if (key.startsWith('overspend.')) {
      if (!Number.isFinite(v) || v < 0 || v > 1000) return bad('A percentage between 0 and 1000.')
    } else if (key === 'reporting.default_currency') {
      if (!isCurrency(v)) return bad('A supported currency code: USD or ZWG.')
    } else if (key.startsWith('import.')) {
      if (!Number.isInteger(v) || v <= 0) return bad('A positive whole number.')
    }
    const { rows } = await pg.query(
      `INSERT INTO finance.setting (key, value, updated_by)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (authority_id, key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING key, value, updated_at`,
      [key, JSON.stringify(v), request.user.id],
    )
    return ok(reply, rows[0])
  })

  // ── Import column mappings ───────────────────────────────────────────────────────────────────
  fastify.get('/finance/column-mappings', canRead, async (request, reply) => {
    const dataset = request.query?.dataset
    const { rows } = await pg.query(
      `SELECT * FROM finance.column_mapping
        WHERE deleted_at IS NULL AND ($1::text IS NULL OR dataset = $1::text)
        ORDER BY dataset, is_default DESC, name`,
      [['budget', 'actuals', 'commitments', 'projects'].includes(dataset) ? dataset : null],
    )
    return ok(reply, rows)
  })

  fastify.post('/finance/column-mappings', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', required: ['name', 'dataset', 'mapping'], additionalProperties: false,
        properties: {
          name, dataset: { type: 'string', enum: ['budget', 'actuals', 'commitments', 'projects'] },
          source_system: { type: 'string', maxLength: 120 },
          // { target_field: [header, ...] }
          mapping: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 40 },
          },
          is_default: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.column_mapping (name, dataset, source_system, mapping, is_default, created_by)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, false), $6) RETURNING *`,
        [b.name.trim(), b.dataset, b.source_system || null, JSON.stringify(b.mapping),
          b.is_default, request.user.id],
      )
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') return fail(reply, 409, 'duplicate_name', 'A mapping already uses that name.')
      throw err
    }
  })

  fastify.patch('/finance/column-mappings/:id', {
    ...canConfig,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name,
          mapping: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 40 },
          },
          is_default: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows } = await pg.query(
      `UPDATE finance.column_mapping
          SET name = COALESCE($2, name),
              mapping = COALESCE($3::jsonb, mapping),
              is_default = COALESCE($4, is_default)
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [request.params.id, b.name || null, b.mapping ? JSON.stringify(b.mapping) : null, b.is_default],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such column mapping.')
    return ok(reply, rows[0])
  })
}

module.exports = { financeConfigRoutes }
