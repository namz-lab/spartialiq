/**
 * Spatial allocation of finance across geography — GIS–finance integration, Milestone 2
 * (docs/gis-finance/ARCHITECTURE-ASSESSMENT.md §6.2 in the frontend repository).
 *
 * Tables and views: finance.spatial_allocation, finance.v_budget_ward_attribution,
 * finance.v_ward_performance, finance.v_unlocated_finance (migrations 198–199).
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE
 *
 * 1. It never decides attribution. Whether a line's money belongs to one ward or five is a
 *    recorded, methodology-backed, APPROVED act (the guard trigger enforces the caps and the
 *    separation of duties); this route only carries it. Equal division is not offered, let
 *    alone defaulted.
 *
 * 2. It never computes roll-ups. Ward figures live in the SQL views and are read through
 *    /finance/map/* endpoints — never re-aggregated here. Where a map payload needs a coarser
 *    grain than a view provides (ward totals from the department breakdown), the GROUP BY is in
 *    SQL, not in JavaScript: §6.1 rule 2 says the map renders and never calculates, and a
 *    JavaScript sum of two numeric strings is exactly the calculation it forbids.
 *
 * 3. It never attributes actuals on an unstated basis. finance.v_ward_performance returns BOTH —
 *    by the transaction's own ward code and by the budget line's geography — and every payload
 *    echoes `actuals_basis` so the legend can name the one on screen (audit M4-5 / MAJOR-4).
 *
 * Permissions are per subject kind: a budget-line split is budget work (prepare/approve under
 * finance.budget.*), a project split is project work (finance.project.manage/approve). The
 * read-only listing rides finance.map.view, the same permission the map itself will use.
 *
 * DEPARTMENT SCOPE. Every read in this file applies departmentScope() the way
 * finance-budget.js:83 does. It did not until the production-readiness audit's BLOCKER-2: a
 * dept_head confined by finance.user_scope read ward aggregates spanning departments whose
 * individual records they cannot open, so the map and the drill-down disagreed.
 */

const {
  requirePermission, requireAnyPermission, hasPermission, departmentScope,
} = require('../middleware/financePermissions')
const { parseMoney, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/** Map a guard-trigger refusal (ERRCODE 22023/23503/42501) to a reply, or null to rethrow. */
function triggerRefusal(reply, err) {
  if (err.code === '22023') return fail(reply, 422, 'allocation_refused', err.message)
  if (err.code === '23503') return fail(reply, 422, 'allocation_refused', err.message)
  if (err.code === '42501') return fail(reply, 403, 'wrong_council', err.message)
  return null
}

/** The prepare/approve permission codes for each subject kind. */
const PREPARE = { budget_line: 'finance.budget.prepare', project: 'finance.project.manage' }
const APPROVE = { budget_line: 'finance.budget.approve', project: 'finance.project.approve' }

/** Provenance block every map payload carries: figures come from these views, nowhere else. */
const SOURCES = ['finance.v_ward_performance', 'finance.v_unlocated_finance']
const DIMENSION_SOURCES = ['finance.v_ward_dimension_performance', 'finance.v_unlocated_finance']
const PROJECT_SOURCES = ['finance.v_project_performance', 'finance.v_unlocated_finance']

/**
 * The two legitimate ways to attribute an actual to a ward, named so a legend can say which.
 * Neither is a default the reader has to guess at; `transaction_ward_code` is the one migration
 * 199 shipped, so it stays the parameter's default for compatibility and is always echoed.
 */
const ACTUALS_BASES = {
  transaction_ward_code: { revenue: 'revenue_actual', expenditure: 'expenditure_actual' },
  budget_line_ward_code: {
    revenue: 'revenue_actual_via_line', expenditure: 'expenditure_actual_via_line',
  },
}

/** The project statuses finance.project permits (migration 188 §5). */
const PROJECT_STATUSES = ['proposed', 'awaiting_approval', 'approved', 'in_progress',
  'suspended', 'completed', 'cancelled']

/**
 * 'minLon,minLat,maxLon,maxLat' -> four finite numbers in range, or a reason.
 *
 * Validated here rather than interpolated: the four values reach ST_MakeEnvelope as bound
 * parameters, so a bbox cannot carry SQL, and a transposed or out-of-range box is refused with a
 * message instead of silently returning nothing.
 */
function parseBbox(text) {
  const parts = String(text).split(',').map((v) => v.trim())
  if (parts.length !== 4) {
    return { ok: false, reason: 'bbox must be four comma-separated numbers: minLon,minLat,maxLon,maxLat.' }
  }
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number)
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return { ok: false, reason: 'bbox values must all be numbers.' }
  }
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    return { ok: false, reason: 'bbox is outside the valid range of longitude/latitude.' }
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    return { ok: false, reason: 'bbox must read minLon,minLat,maxLon,maxLat with the minima first.' }
  }
  return { ok: true, minLon, minLat, maxLon, maxLat }
}

/** Is the council's ward register linked (decision D11)? Reported honestly, never assumed. */
async function wardRegisterLinked(pg, authorityId) {
  const { rows } = await pg.query(
    `SELECT EXISTS (
       SELECT 1 FROM admin.authority_ward WHERE authority_id = $1 AND valid_to IS NULL) AS linked`,
    [authorityId])
  return rows[0].linked === true
}

/**
 * How the council's ward list was established, for the surfaces that must label it.
 * 'interim' is the provisional state decision D11 is still open on (migration 201); a surface
 * that shows a ward figure without saying the ward list is unconfirmed would overstate it.
 * Returns the distinct bases actually present, which is [] when nothing is linked.
 */
async function wardRegisterBases(pg, authorityId) {
  const { rows } = await pg.query(
    `SELECT DISTINCT basis FROM admin.authority_ward
      WHERE authority_id = $1 AND valid_to IS NULL ORDER BY basis`, [authorityId])
  return rows.map((r) => r.basis)
}

/**
 * How current the figures are, as opposed to when the SQL ran.
 *
 * `generated_at` is query time and says nothing about the data (audit X-3). This is the latest
 * COMMITTED import for the year — the moment the council's accounting records last reached this
 * system. NULL when nothing has been imported, which the surface must render as "data currency
 * not recorded" rather than as now.
 */
async function dataAsAt(pg, yearId) {
  if (!yearId) return null
  const { rows } = await pg.query(
    `SELECT max(committed_at) AS data_as_at
       FROM finance.import_batch
      WHERE financial_year_id = $1 AND status = 'committed' AND deleted_at IS NULL`, [yearId])
  return rows[0]?.data_as_at || null
}

/**
 * Load the subject the way the guard trigger sees it: alive, this council (RLS already scopes
 * the read, so a foreign subject is simply not found), with its department for scope checks.
 * Returns null after replying when the subject is unusable.
 */
async function loadSubject(pg, request, reply, kind, id) {
  if (kind === 'budget_line') {
    const { rows } = await pg.query(
      `SELECT l.id, l.department_id, l.currency, l.financial_year_id, l.ward_code,
              y.status AS year_status, y.label AS year_label
         FROM finance.budget_line l
         JOIN finance.financial_year y ON y.id = l.financial_year_id
        WHERE l.id = $1 AND l.deleted_at IS NULL`, [id])
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such budget line.')
    return rows[0]
  }
  const { rows } = await pg.query(
    `SELECT p.id, p.department_id, p.currency, NULL::text AS year_status, NULL::text AS year_label
       FROM finance.project p WHERE p.id = $1 AND p.deleted_at IS NULL`, [id])
  if (!rows[0]) return fail(reply, 404, 'not_found', 'No such project.')
  return rows[0]
}

async function scopeRefusal(fastify, request, departmentId) {
  const scope = await departmentScope(fastify, request)
  if (!scope) return null
  if (departmentId && scope.includes(departmentId)) return null
  return 'Your access is limited to your own department(s).'
}

async function financeSpatialRoutes(fastify) {
  const pg = fastify.pg

  // ── The register ────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/spatial-allocations', {
    preHandler: requirePermission(fastify, 'finance.map.view'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          subject_kind: { type: 'string', enum: ['budget_line', 'project'] },
          subject_id: uuid,
          status: { type: 'string', enum: ['draft', 'approved', 'rejected', 'withdrawn'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    // target_status says, honestly, how the ward code relates to the register: 'linked' is one of
    // this council's current wards; 'unlinked' is a code the register does not carry; and
    // 'ward_register_empty' is the D11 state — the council has not linked any wards yet, so
    // nothing can be validated and the map must say so rather than draw nothing silently.
    const { rows } = await pg.query(
      `SELECT a.*,
              CASE
                WHEN a.target_kind <> 'ward' THEN NULL
                WHEN EXISTS (SELECT 1 FROM admin.authority_ward aw
                              WHERE aw.authority_id = a.authority_id
                                AND aw.ward_code = a.target_code AND aw.valid_to IS NULL)
                  THEN 'linked'
                WHEN EXISTS (SELECT 1 FROM admin.authority_ward aw2
                              WHERE aw2.authority_id = a.authority_id AND aw2.valid_to IS NULL)
                  THEN 'unlinked'
                ELSE 'ward_register_empty'
              END AS target_status
         FROM finance.spatial_allocation a
        WHERE ($1::text IS NULL OR a.subject_kind = $1::text)
          AND ($2::uuid IS NULL OR a.subject_id = $2::uuid)
          AND ($3::text IS NULL OR a.status = $3::text)
        ORDER BY a.requested_at DESC
        LIMIT $4 OFFSET $5`,
      [q.subject_kind || null, q.subject_id || null, q.status || null, q.limit, q.offset])
    return ok(reply, { allocations: rows, limit: q.limit, offset: q.offset })
  })

  // ── Record a draft split ────────────────────────────────────────────────────────────────────
  fastify.post('/finance/spatial-allocations', {
    preHandler: requireAnyPermission(fastify, ['finance.budget.prepare', 'finance.project.manage']),
    schema: {
      body: {
        type: 'object',
        required: ['subject_kind', 'subject_id', 'target_code', 'amount', 'methodology'],
        additionalProperties: false,
        properties: {
          subject_kind: { type: 'string', enum: ['budget_line', 'project'] },
          subject_id: uuid,
          target_code: { type: 'string', minLength: 1, maxLength: 64 },
          amount: money,
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          share: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
          methodology: { type: 'string', minLength: 10, maxLength: 2000 },
          evidence_document_id: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (!(await hasPermission(fastify, request, PREPARE[b.subject_kind]))) {
      return fail(reply, 403, 'forbidden',
        'Preparing this kind of split requires a different permission.',
        { required_permission: PREPARE[b.subject_kind] })
    }
    const subject = await loadSubject(pg, request, reply, b.subject_kind, b.subject_id)
    if (!subject) return reply
    const refusal = await scopeRefusal(fastify, request, subject.department_id)
    if (refusal) return fail(reply, 403, 'out_of_scope', refusal)

    const amount = parseMoney(b.amount)
    if (!amount.ok) return fail(reply, 400, 'invalid_amount', `amount: ${amount.reason}`)

    const currency = b.currency || subject.currency
    if (currency !== subject.currency) {
      return fail(reply, 400, 'currency_mismatch',
        `The split must be in the subject's own currency (${subject.currency}); currencies are never converted.`)
    }
    if (subject.year_status === 'closed' || subject.year_status === 'archived') {
      return fail(reply, 409, 'year_closed',
        `Financial year ${subject.year_label} is ${subject.year_status}; it accepts no further financial records.`)
    }

    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.spatial_allocation
           (authority_id, subject_kind, subject_id, target_kind, target_code, amount, currency,
            share, methodology, evidence_document_id, requested_by, created_by)
         VALUES ($1,$2,$3,'ward',$4,$5::numeric,$6,$7,$8,$9,$10,$10)
         RETURNING *`,
        [request.user.authority_id, b.subject_kind, b.subject_id, b.target_code.trim(),
          amount.value, currency, b.share ?? null, b.methodology.trim(),
          b.evidence_document_id || null, request.user.id])
      request.auditDetails = {
        subject_kind: b.subject_kind, subject_id: b.subject_id,
        target_code: b.target_code.trim(), amount: amount.value, currency,
      }
      return ok(reply, rows[0], 201)
    } catch (err) {
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_target',
          'There is already a live allocation for this subject and target in this currency.')
      }
      const refusalReply = triggerRefusal(reply, err)
      if (refusalReply) return refusalReply
      throw err
    }
  })

  // ── Decide a draft: approve / reject ────────────────────────────────────────────────────────
  const decide = (action) => async (request, reply) => {
    const { rows: found } = await pg.query(
      `SELECT * FROM finance.spatial_allocation WHERE id = $1 AND deleted_at IS NULL`,
      [request.params.id])
    const alloc = found[0]
    if (!alloc) return fail(reply, 404, 'not_found', 'No such spatial allocation.')
    if (alloc.status !== 'draft') {
      return fail(reply, 409, 'already_decided',
        `This allocation is ${alloc.status}; its decision is final.`)
    }
    if (!(await hasPermission(fastify, request, APPROVE[alloc.subject_kind]))) {
      return fail(reply, 403, 'forbidden',
        'Deciding this kind of split requires a different permission.',
        { required_permission: APPROVE[alloc.subject_kind] })
    }
    if (alloc.requested_by === request.user.id) {
      return fail(reply, 403, 'self_approval',
        'The officer who recorded the split may not also decide it.')
    }
    try {
      const { rows } = await pg.query(
        `UPDATE finance.spatial_allocation
            SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
          WHERE id = $1 AND status = 'draft'
          RETURNING *`,
        [alloc.id, action, request.user.id, request.body.decision_note || null])
      if (!rows[0]) return fail(reply, 409, 'already_decided', 'Decided elsewhere at the same moment.')
      request.auditDetails = {
        allocation_id: alloc.id, subject_kind: alloc.subject_kind, subject_id: alloc.subject_id,
        target_code: alloc.target_code, amount: alloc.amount, currency: alloc.currency,
        decision: action,
      }
      return ok(reply, rows[0])
    } catch (err) {
      const refusalReply = triggerRefusal(reply, err)
      if (refusalReply) return refusalReply
      throw err
    }
  }

  fastify.post('/finance/spatial-allocations/:id/approve', {
    preHandler: requireAnyPermission(fastify, ['finance.budget.approve', 'finance.project.approve']),
    schema: { body: { type: 'object', additionalProperties: false,
      properties: { decision_note: { type: 'string', maxLength: 2000 } } } },
  }, decide('approved'))

  fastify.post('/finance/spatial-allocations/:id/reject', {
    preHandler: requireAnyPermission(fastify, ['finance.budget.approve', 'finance.project.approve']),
    schema: { body: { type: 'object', required: ['decision_note'], additionalProperties: false,
      properties: { decision_note: { type: 'string', minLength: 3, maxLength: 2000 } } } },
  }, decide('rejected'))

  // ── Withdraw: draft by its requester, approved by the deciding permission (a revocation) ────
  fastify.post('/finance/spatial-allocations/:id/withdraw', {
    preHandler: requireAnyPermission(fastify,
      ['finance.budget.prepare', 'finance.project.manage', 'finance.budget.approve', 'finance.project.approve']),
    schema: { body: { type: 'object', additionalProperties: false,
      properties: { decision_note: { type: 'string', maxLength: 2000 } } } },
  }, async (request, reply) => {
    const { rows: found } = await pg.query(
      `SELECT * FROM finance.spatial_allocation WHERE id = $1 AND deleted_at IS NULL`,
      [request.params.id])
    const alloc = found[0]
    if (!alloc) return fail(reply, 404, 'not_found', 'No such spatial allocation.')
    if (alloc.status === 'rejected' || alloc.status === 'withdrawn') {
      return fail(reply, 409, 'already_decided', `This allocation is already ${alloc.status}.`)
    }
    if (alloc.status === 'draft' && alloc.requested_by !== request.user.id) {
      return fail(reply, 403, 'not_yours', 'Only the officer who recorded the draft may withdraw it.')
    }
    if (alloc.status === 'approved'
        && !(await hasPermission(fastify, request, APPROVE[alloc.subject_kind]))) {
      return fail(reply, 403, 'forbidden',
        'Revoking an approved split requires the deciding permission.',
        { required_permission: APPROVE[alloc.subject_kind] })
    }
    const { rows } = await pg.query(
      `UPDATE finance.spatial_allocation
          SET status = 'withdrawn', decision_note = coalesce($2, decision_note)
        WHERE id = $1 AND status IN ('draft', 'approved')
        RETURNING *`,
      [alloc.id, request.body.decision_note || null])
    if (!rows[0]) return fail(reply, 409, 'already_decided', 'Changed elsewhere at the same moment.')
    request.auditDetails = {
      allocation_id: alloc.id, subject_kind: alloc.subject_kind, subject_id: alloc.subject_id,
      target_code: alloc.target_code, amount: alloc.amount, currency: alloc.currency,
      decision: 'withdrawn', previously: alloc.status,
    }
    return ok(reply, rows[0])
  })

  // ── What the map cannot place (assessment §6.1 rule 4: unlocated is a first-class state) ────
  fastify.get('/finance/unlocated', {
    preHandler: requirePermission(fastify, 'finance.map.view'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT * FROM finance.v_unlocated_finance
        WHERE ($1::uuid IS NULL OR financial_year_id = $1::uuid)
        ORDER BY dataset, currency`,
      [request.query.financial_year_id || null])
    return ok(reply, { unlocated: rows })
  })

  // ── The ward measures the choropleth renders (Milestone 3, completed by M4-2/M4-4/M4-5) ─────
  // Every figure is read from finance.v_ward_performance (or, once a dimension filter or a
  // department scope applies, from finance.v_ward_dimension_performance rolled up to the ward
  // grain IN SQL): this endpoint renders, it never computes. The ward register link (D11) is
  // reported, not assumed — an unlinked register means polygons cannot be shaded yet, and the
  // payload says so rather than returning a quietly empty map.
  //
  // TWO QUERY PATHS, ONE GRAIN. Unfiltered and unscoped reads go to v_ward_performance, which is
  // the documented source. A read that is department-scoped or dimension-filtered goes to the
  // breakdown view and groups by exactly the same key (council, year, currency, ward_code,
  // unlocated_reason), so the two cannot report a different grain. The suite pins that they
  // report the same FIGURES for the same data (finance.spatial-map.test.js).
  fastify.get('/finance/map/wards', {
    preHandler: requirePermission(fastify, 'finance.map.view'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          department_id: uuid,
          programme_id: uuid,
          account_kind: { type: 'string', enum: ['revenue', 'expenditure'] },
          dimension: { type: 'string', enum: ['total', 'department', 'programme'], default: 'total' },
          actuals_basis: {
            type: 'string', enum: ['transaction_ward_code', 'budget_line_ward_code'],
            default: 'transaction_ward_code',
          },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    // BLOCKER-2. Null means "not confined"; an array means these departments and no others. The
    // same resolution finance-budget.js:83 and finance-projects.js:94 use.
    const scope = await departmentScope(fastify, request)

    // Default year: the council's latest by end date. The workspace passes its selected year, so
    // this default only serves ad-hoc API reads.
    let yearId = q.financial_year_id || null
    let year = null
    if (yearId) {
      const { rows } = await pg.query(
        'SELECT id, label, status FROM finance.financial_year WHERE id = $1', [yearId])
      year = rows[0] || null
    }
    if (!year) {
      const { rows } = await pg.query(
        `SELECT id, label, status FROM finance.financial_year
          WHERE deleted_at IS NULL ORDER BY end_date DESC LIMIT 1`)
      year = rows[0] || null
    }
    if (!year) {
      return ok(reply, {
        financial_year: null, currencies: [], wards: [], ward_dimensions: [],
        projects_by_ward: [], unlocated: [],
        ward_register_linked: false, ward_register_bases: [],
        department_scope: scope, dimension: q.dimension, actuals_basis: q.actuals_basis,
        filters: { department_id: null, programme_id: null, account_kind: null },
        sources: SOURCES, data_as_at: null, generated_at: new Date().toISOString(),
      })
    }

    const filtered = Boolean(scope || q.department_id || q.programme_id || q.account_kind)
    const dimensionParams = [
      year.id, q.currency || null, scope || null,
      q.department_id || null, q.programme_id || null, q.account_kind || null,
    ]
    // One predicate for both the ward roll-up and the breakdown list, so a figure in the panel
    // and a row in the breakdown can never have been selected differently.
    const dimensionWhere = `
        WHERE d.financial_year_id = $1
          AND ($2::text IS NULL OR d.currency = $2::text)
          AND ($3::uuid[] IS NULL OR d.department_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR d.department_id = $4::uuid)
          AND ($5::uuid IS NULL OR d.programme_id = $5::uuid)
          AND ($6::text IS NULL OR d.account_kind = $6::text)`

    /**
     * sum(col) over one account kind, NULL unless EVERY row of that kind carries it.
     *
     * The only two things this composes into SQL are a COLUMN NAME and an ACCOUNT KIND, both
     * written at the call sites below and neither reachable from the request — the same discipline
     * as the `sortColumn` maps in finance-budget.js and the `dataset` constants in
     * finance-public.js. The guard makes that checkable rather than a convention: every request
     * value in this file is a bound parameter.
     */
    const COMPLETE_COLUMNS = new Set(['original_amount', 'approved_adjustments',
      'actual_amount_via_line', 'available_excluding_commitments',
      'available_including_commitments', 'variance'])
    const complete = (col, kind) => {
      if (!COMPLETE_COLUMNS.has(col) || !['revenue', 'expenditure'].includes(kind)) {
        throw new Error(`complete(): ${col}/${kind} is not one of the allowed view columns`)
      }
      return `
         CASE WHEN count(*) FILTER (WHERE d.account_kind = '${kind}') > 0
               AND count(*) FILTER (WHERE d.account_kind = '${kind}' AND d.${col} IS NULL) = 0
              THEN (sum(d.${col}) FILTER (WHERE d.account_kind = '${kind}'))::finance.money END`
    }

    let wards
    if (!filtered) {
      ({ rows: wards } = await pg.query(
        `SELECT * FROM finance.v_ward_performance
          WHERE financial_year_id = $1
            AND ward_code IS NOT NULL
            AND ($2::text IS NULL OR currency = $2::text)
          ORDER BY currency, ward_code`,
        [year.id, q.currency || null]))
    } else {
      // Identical column names and identical grain to v_ward_performance. The arithmetic is here
      // in SQL over NUMERIC and nowhere else; the client receives finished figures.
      ({ rows: wards } = await pg.query(
        `SELECT d.authority_id, d.financial_year_id, d.currency, d.ward_code,
                min(d.unlocated_reason) AS unlocated_reason,
                max(d.ward_status) AS ward_status,
                (SELECT aw.basis FROM admin.authority_ward aw
                  WHERE aw.authority_id = d.authority_id AND aw.ward_code = d.ward_code
                    AND aw.valid_to IS NULL
                  ORDER BY aw.valid_from DESC LIMIT 1) AS ward_register_basis,
                ${complete('original_amount', 'revenue')} AS original_revenue,
                ${complete('approved_adjustments', 'revenue')} AS adjustments_revenue,
                (sum(d.budget_amount) FILTER (WHERE d.account_kind = 'revenue'))::finance.money
                  AS revenue_budget,
                (sum(d.actual_amount) FILTER (WHERE d.account_kind = 'revenue'))::finance.money
                  AS revenue_actual,
                ${complete('actual_amount_via_line', 'revenue')} AS revenue_actual_via_line,
                CASE WHEN (sum(d.budget_amount) FILTER (WHERE d.account_kind = 'revenue')) IS NULL
                     THEN NULL
                     ELSE (coalesce(sum(d.actual_amount) FILTER (WHERE d.account_kind = 'revenue'), 0)
                           - sum(d.budget_amount) FILTER (WHERE d.account_kind = 'revenue'))::finance.money
                END AS revenue_variance,
                CASE WHEN coalesce(sum(d.budget_amount) FILTER (WHERE d.account_kind = 'revenue'), 0) = 0
                     THEN NULL
                     ELSE round(coalesce(sum(d.actual_amount) FILTER (WHERE d.account_kind = 'revenue'), 0)
                                * 100 / sum(d.budget_amount) FILTER (WHERE d.account_kind = 'revenue'), 2)
                END AS revenue_collection_percentage,
                ${complete('original_amount', 'expenditure')} AS original_expenditure,
                ${complete('approved_adjustments', 'expenditure')} AS adjustments_expenditure,
                (sum(d.budget_amount) FILTER (WHERE d.account_kind = 'expenditure'))::finance.money
                  AS expenditure_budget,
                (sum(d.actual_amount) FILTER (WHERE d.account_kind = 'expenditure'))::finance.money
                  AS expenditure_actual,
                ${complete('actual_amount_via_line', 'expenditure')} AS expenditure_actual_via_line,
                (sum(d.open_commitments))::finance.money AS open_commitments,
                ${complete('available_excluding_commitments', 'expenditure')}
                  AS available_excluding_commitments,
                ${complete('available_including_commitments', 'expenditure')}
                  AS available_including_commitments,
                ${complete('variance', 'expenditure')} AS expenditure_variance,
                CASE WHEN coalesce(sum(d.budget_amount) FILTER (WHERE d.account_kind = 'expenditure'), 0) = 0
                     THEN NULL
                     ELSE round(coalesce(sum(d.actual_amount) FILTER (WHERE d.account_kind = 'expenditure'), 0)
                                * 100 / sum(d.budget_amount) FILTER (WHERE d.account_kind = 'expenditure'), 2)
                END AS expenditure_execution_percentage,
                (sum(d.split_coverage_amount))::finance.money AS split_coverage_amount,
                (sum(d.unallocated_remainder_amount))::finance.money AS unallocated_remainder_amount,
                sum(d.attribution_exception_rows)::int AS attribution_exception_rows,
                sum(d.attributed_lines)::int AS attributed_lines,
                sum(d.allocation_rows)::int AS allocation_rows,
                sum(d.transaction_rows)::int AS transaction_rows
           FROM finance.v_ward_dimension_performance d
           ${dimensionWhere}
            AND d.ward_code IS NOT NULL
          GROUP BY d.authority_id, d.financial_year_id, d.currency, d.ward_code
          ORDER BY d.currency, d.ward_code`,
        dimensionParams))
    }

    // The breakdown the panel lists under the ward. Returned SEPARATELY from `wards` on purpose:
    // `wards` is always one row per (ward, currency) so a choropleth cannot accidentally shade a
    // ward twice from a department split of it.
    let wardDimensions = []
    if (q.dimension !== 'total') {
      // Mapped from a validated enum to a column name, never taken from the request as text.
      const key = { department: 'department_id', programme: 'programme_id' }[q.dimension]
      const { rows } = await pg.query(
        `SELECT d.currency, d.ward_code, d.unlocated_reason, d.ward_status, d.account_kind,
                d.${key} AS dimension_id,
                dep.code AS department_code, dep.name AS department_name,
                prog.code AS programme_code, prog.name AS programme_name,
                d.original_amount, d.approved_adjustments, d.budget_amount,
                d.actual_amount, d.actual_amount_via_line, d.open_commitments,
                d.available_excluding_commitments, d.available_including_commitments,
                d.variance, d.execution_percentage,
                d.attributed_lines, d.allocation_rows, d.transaction_rows
           FROM finance.v_ward_dimension_performance d
           LEFT JOIN finance.department dep ON dep.id = d.department_id
           LEFT JOIN finance.programme prog ON prog.id = d.programme_id
           ${dimensionWhere}
          ORDER BY d.currency, d.ward_code NULLS LAST, d.account_kind, 7, 9`,
        dimensionParams)
      wardDimensions = rows
    }

    // Field 11 of the ward panel (assessment §6.2.3): the ward's PROJECT measures. They are not
    // in v_ward_performance and must not be — project figures span financial years, so a
    // year-scoped row would misstate them (migration 199's header). They are a separate array at
    // the same grain, aggregated in SQL, so the panel reads a figure rather than reducing a list.
    // A project with no allocation belongs to no year and still belongs to its ward.
    const { rows: projectsByWard } = await pg.query(
      `SELECT p.ward_code, p.currency,
              count(*)::int AS project_count,
              count(*) FILTER (WHERE pr.location IS NOT NULL)::int AS located_project_count,
              sum(p.approved_budget)::finance.money  AS approved_budget,
              sum(p.allocated_total)::finance.money  AS allocated_total,
              sum(p.actual_spend)::finance.money     AS actual_spend,
              count(*) FILTER (WHERE p.spend_ahead_of_progress IS TRUE)::int
                AS spend_ahead_of_progress_count,
              count(*) FILTER (WHERE p.physical_progress_percent IS NULL)::int
                AS progress_not_recorded_count
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
        WHERE p.ward_code IS NOT NULL
          AND ($1::uuid IS NULL OR $1 = ANY(p.financial_year_ids)
               OR cardinality(p.financial_year_ids) = 0)
          AND ($2::text IS NULL OR p.currency = $2::text)
          AND ($3::uuid[] IS NULL OR p.department_id = ANY($3::uuid[]) OR p.department_id IS NULL)
          AND ($4::uuid IS NULL OR p.department_id = $4::uuid)
        GROUP BY p.ward_code, p.currency
        ORDER BY p.currency, p.ward_code`,
      [year.id, q.currency || null, scope || null, q.department_id || null])

    const { rows: unlocated } = await pg.query(
      `SELECT * FROM finance.v_unlocated_finance
        WHERE (financial_year_id = $1
               OR (financial_year_id IS NULL AND dataset = 'projects'))
          AND ($2::text IS NULL OR currency = $2::text)
        ORDER BY dataset, currency`,
      [year.id, q.currency || null])

    const currencies = [...new Set(wards.concat(unlocated).map((r) => r.currency))]
    const linked = await wardRegisterLinked(pg, request.user.authority_id)

    return ok(reply, {
      financial_year: year,
      currencies,
      wards,
      ward_dimensions: wardDimensions,
      projects_by_ward: projectsByWard,
      unlocated,
      ward_register_linked: linked,
      ward_register_bases: await wardRegisterBases(pg, request.user.authority_id),
      // What was actually applied, not what was asked for: a dept_head sees the array that
      // confined them, and a council-wide officer sees null.
      department_scope: scope,
      dimension: q.dimension,
      // M4-5: which attribution rule the `*_actual` columns the client should read were built
      // from. BOTH are in every row; this names the one the legend must label.
      actuals_basis: q.actuals_basis,
      actuals_basis_columns: ACTUALS_BASES[q.actuals_basis],
      filters: {
        department_id: q.department_id || null,
        programme_id: q.programme_id || null,
        account_kind: q.account_kind || null,
      },
      sources: (filtered ? DIMENSION_SOURCES : SOURCES).concat(['finance.v_project_performance']),
      // How current the FIGURES are, as distinct from when the query ran (audit X-3).
      data_as_at: await dataAsAt(pg, year.id),
      generated_at: new Date().toISOString(),
    })
  })

  // ── The capital/project layer (Milestone 5, audit M5-1) ─────────────────────────────────────
  // Points from finance.project.location joined to finance.v_project_performance, which is where
  // every project measure is computed. Three properties this endpoint is built around:
  //
  //   1. UNLOCATED PROJECTS ARE LISTED, NEVER PLACED. A project with no point is not dropped and
  //      not nudged to a ward centroid; it comes back by name in `unlocated_projects` so an
  //      officer can fix it, which is the only honest empty state (§6.1 rule 4).
  //   2. A BBOX FILTERS THE MAP, NOT THE TRUTH. Panning the map changes `features`; it never
  //      changes `unlocated_projects` or the `unlocated` totals, because what cannot be placed
  //      does not become placeable by scrolling.
  //   3. PHYSICAL PROGRESS IS NULL OR RECORDED (decision D12). `spend_ahead_of_progress` is
  //      TRUE, FALSE or NULL, and NULL means the comparison could not be made — never "fine".
  fastify.get('/finance/map/projects', {
    preHandler: requirePermission(fastify, 'finance.map.view'),
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          status: { type: 'string', enum: PROJECT_STATUSES },
          department_id: uuid,
          ward_code: { type: 'string', maxLength: 64 },
          // 'minLon,minLat,maxLon,maxLat'. Validated below, then applied as && ST_MakeEnvelope so
          // the existing GIST index idx_project_location is used rather than scanned past.
          bbox: { type: 'string', maxLength: 120 },
          exceptions_only: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const scope = await departmentScope(fastify, request)

    let bbox = null
    if (q.bbox !== undefined) {
      bbox = parseBbox(q.bbox)
      if (!bbox.ok) return fail(reply, 400, 'invalid_bbox', bbox.reason)
    }

    // The year is optional here, unlike the ward map: a project register spans financial years
    // (finance.v_project_performance.financial_year_ids), so "no year" means "every year" rather
    // than "the latest", and a project with no allocation at all belongs to no year and would
    // vanish from a year-defaulted map.
    let year = null
    if (q.financial_year_id) {
      const { rows } = await pg.query(
        'SELECT id, label, status FROM finance.financial_year WHERE id = $1', [q.financial_year_id])
      year = rows[0] || null
      if (!year) return fail(reply, 404, 'not_found', 'No such financial year.')
    }

    const params = [
      year ? year.id : null, q.currency || null, q.status || null,
      q.department_id || null, q.ward_code ? q.ward_code.trim() : null, scope || null,
      q.exceptions_only === true,
    ]
    // A project with no allocation and no linked transaction belongs to NO financial year
    // (v_unlocated_finance records project rows with financial_year_id NULL for the same reason,
    // migration 199). Filtering it out would hide from a year-selected map exactly the project an
    // officer needs to find and fix, so a year-less project passes every year filter.
    const where = `
      WHERE ($1::uuid IS NULL OR $1 = ANY(p.financial_year_ids)
             OR cardinality(p.financial_year_ids) = 0)
        AND ($2::text IS NULL OR p.currency = $2::text)
        AND ($3::text IS NULL OR p.status = $3::text)
        AND ($4::uuid IS NULL OR p.department_id = $4::uuid)
        AND ($5::text IS NULL OR p.ward_code = $5::text)
        AND ($6::uuid[] IS NULL OR p.department_id = ANY($6::uuid[]) OR p.department_id IS NULL)
        AND ($7::boolean IS NOT TRUE OR p.spend_ahead_of_progress IS TRUE)`

    // The same SELECT list the project register already serves (finance-projects.js:96-99), so
    // the panel opened from the map and the panel opened from the register show one record.
    const properties = `
             p.*, ${dateText('p', 'last_transaction_date')},
             d.code AS department_code, d.name AS department_name,
             pr.description, pr.location_text,
             ${dateText('pr', 'start_date', 'end_date')},
             ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude,
             CASE
               WHEN p.ward_code IS NULL THEN NULL
               WHEN EXISTS (SELECT 1 FROM admin.authority_ward aw
                             WHERE aw.authority_id = p.authority_id
                               AND aw.ward_code = p.ward_code AND aw.valid_to IS NULL)
                 THEN 'linked'
               ELSE 'unlinked'
             END AS ward_status`

    const { rows: located } = await pg.query(
      `SELECT ${properties},
              ST_AsGeoJSON(pr.location)::json AS geometry
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
         LEFT JOIN finance.department d ON d.id = p.department_id
         ${where}
          AND pr.location IS NOT NULL
          AND ($8::double precision IS NULL
               OR pr.location && ST_MakeEnvelope($8::double precision, $9::double precision,
                                                 $10::double precision, $11::double precision, 4326))
        ORDER BY p.reference
        LIMIT $12 OFFSET $13`,
      [...params,
        bbox ? bbox.minLon : null, bbox ? bbox.minLat : null,
        bbox ? bbox.maxLon : null, bbox ? bbox.maxLat : null,
        q.limit, q.offset])

    // Deliberately NOT bbox-filtered and NOT paginated by the map's window: this is the list of
    // what the map could not draw, and it is the same list wherever the camera is.
    const { rows: unlocatedProjects } = await pg.query(
      `SELECT p.project_id, p.reference, p.name, p.status, p.currency, p.approved_budget,
              p.allocated_total, p.actual_spend, p.execution_percentage,
              p.physical_progress_percent, p.ward_code,
              d.code AS department_code, d.name AS department_name,
              pr.location_text,
              CASE WHEN p.ward_code IS NULL THEN 'no_ward_or_location' ELSE 'no_location' END
                AS reason
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
         LEFT JOIN finance.department d ON d.id = p.department_id
         ${where}
          AND pr.location IS NULL
        ORDER BY p.reference
        LIMIT 500`, params)

    const { rows: unlocated } = await pg.query(
      `SELECT * FROM finance.v_unlocated_finance
        WHERE dataset = 'projects'
          AND ($1::text IS NULL OR currency = $1::text)
        ORDER BY currency`,
      [q.currency || null])

    const currencies = [...new Set(
      located.concat(unlocatedProjects).map((r) => r.currency))].sort()

    return ok(reply, {
      financial_year: year,
      currencies,
      features: {
        type: 'FeatureCollection',
        features: located.map((r) => {
          const { geometry, ...rest } = r
          return { type: 'Feature', geometry, properties: rest }
        }),
      },
      unlocated_projects: unlocatedProjects,
      unlocated,
      ward_register_linked: await wardRegisterLinked(pg, request.user.authority_id),
      ward_register_bases: await wardRegisterBases(pg, request.user.authority_id),
      department_scope: scope,
      bbox: bbox ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] : null,
      limit: q.limit,
      offset: q.offset,
      // Project spend is attributed through finance.project_transaction, not through a ward code,
      // so there is one basis here and it is named rather than assumed.
      actuals_basis: 'project_transaction',
      progress_decision: 'D12',
      sources: PROJECT_SOURCES,
      data_as_at: await dataAsAt(pg, year ? year.id : null),
      generated_at: new Date().toISOString(),
    })
  })

  // ── The council's ward polygons, for shading (Milestone 3) ──────────────────────────────────
  // Served only to finance staff (never a public tile route) and simplified for display; the
  // register itself (admin.ward) stays untouched and authoritative.
  fastify.get('/finance/map/ward-geometry', {
    preHandler: requirePermission(fastify, 'finance.map.view'),
  }, async (request, reply) => {
    const linked = await wardRegisterLinked(pg, request.user.authority_id)
    const features = []
    if (linked) {
      const { rows } = await pg.query(
        `SELECT w.ward_code, w.name,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(w.geom, 0.001))::json AS geometry
           FROM admin.authority_ward aw
           JOIN admin.ward w ON w.ward_code = aw.ward_code
          WHERE aw.authority_id = $1 AND aw.valid_to IS NULL
          ORDER BY w.ward_code`,
        [request.user.authority_id])
      for (const r of rows) {
        features.push({
          type: 'Feature',
          properties: { ward_code: r.ward_code, name: r.name },
          geometry: r.geometry,
        })
      }
    }
    return ok(reply, { ward_register_linked: linked, features })
  })
}

module.exports = { financeSpatialRoutes, parseBbox }
