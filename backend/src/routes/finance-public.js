/**
 * The public financial transparency surface. No sign-in required.
 *
 * View: finance.v_published_transaction, finance.v_published_budget_line, and the
 * `published_select` row-level security policies in §14 of migration 188 (hardened by 194, 197
 * and 200).
 *
 * TWO INDEPENDENT GUARANTEES, DELIBERATELY REDUNDANT
 *
 * 1. THE CONNECTION IS ALWAYS THE PUBLIC ONE. Every query below goes through `publicPg`, a pool
 *    scoped to NOBODY: app.user_id, app.authority_id and app.platform are empty, whatever cookie
 *    the request carried. So `app.visible_authorities()` is empty, `tenant_select` matches
 *    nothing, and only a `published_select` policy — each of which requires a LIVE PUBLICATION
 *    ROW — can admit a row.
 *
 *    This is the fix for audit BLOCKER-1. Until migration 200 these handlers read through
 *    `fastify.pg`, which follows the person asking (src/lib/dbContext.js). PostgreSQL ORs
 *    PERMISSIVE policies, so for any signed-in member of this council — including a
 *    `building_inspector`, `planning_clerk`, `surveyor` or `gis_officer`, none of whom holds a
 *    single finance permission — `tenant_select` matched and the public route served the
 *    council's unpublished draft budget. Confidentiality must not depend on the caller having
 *    forgotten to sign in.
 *
 * 2. EVERY HANDLER STATES ITS OWN PUBLICATION PREDICATE. The route is correct even if the
 *    policies were dropped: `/budget` reads finance.v_published_budget_line (migration 200),
 *    `/overview`, `/projects` and `/documents` carry an EXISTS on a live finance.publication row
 *    for their dataset, and the transaction surfaces read
 *    finance.v_published_transaction, which carries the join itself. Belt and braces: a policy
 *    change cannot silently open a route, and a forgotten filter cannot silently open one either.
 *
 * COUNTERPARTY IDENTITY IS NOT WITHHELD BY A FILTER. finance.v_published_transaction does not
 * select those columns, so no amount of query-string ingenuity reaches them.
 *
 * THE PUBLIC MAP (GIS-finance Milestone 7). /public/finance/map/wards serves WARD AGGREGATES
 * only, and /public/finance/map/ward-geometry serves the boundaries they are drawn on. Decision
 * D14 sets the ceiling of what may be published per ward (budget allocation, expenditure,
 * revenue, and project locations with status; counterparty identity at no width) and the live
 * finance.publication row decides what IS published. Permission is not publication: a measure
 * D14 permits appears only while its dataset has a live publication, and no measure is ever
 * inferred from another (there is no expenditure map derived from a published budget).
 *
 * `optionalAuth` is kept so that `request.user` is populated for the audit hook and the logs. It
 * no longer changes a single row of the response: a signed-in officer and an anonymous citizen
 * see byte-identical published data, which is what the public portal means.
 */

const { optionalAuth } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const { tenantPool } = require('../lib/tenancy')
const { dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const ok = (reply, data) => reply.send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

/**
 * The project statuses the council has released. The same list as migration 197's
 * `published_select` policy on finance.project — a proposed or draft project is not public.
 */
const PUBLIC_PROJECT_STATUSES = ['approved', 'in_progress', 'suspended', 'completed']

/** A public document dataset narrows the subject kinds a document may be attached to. */
const DOCUMENT_DATASET_KINDS = {
  budget: ['budget_line', 'budget_revision', 'financial_year'],
  revenue: ['transaction'],
  expenditure: ['transaction'],
  projects: ['project'],
  reports: ['report'],
}

/**
 * Every published figure is served with the provenance the specification asks for on each dataset
 * (§3.1: publication date, reporting period and data currency) — so a figure cannot be quoted
 * without the reader being able to see when it was published and what it covers.
 */
function provenance(publication) {
  if (!publication) return null
  return {
    published_at: publication.published_at,
    reporting_period_label: publication.reporting_period_label,
    data_as_at: publication.data_as_at,
    version: publication.version,
  }
}

async function financePublicRoutes(fastify) {
  /**
   * The public connection, for every query in this file.
   *
   * `fastify.pg` follows the person asking; this does not. `tenantPool(..., null)` steps into the
   * vungu_app role (which cannot bypass row-level security) with no user, no authority and no
   * platform flag, which is exactly the session `published_select` was written for. Passing the
   * unscoped `systemOf()` connection as its base is deliberate: it is the pool, not an authority,
   * and the scoping is applied on top of it per statement.
   *
   * Nothing in this file may use `fastify.pg`. That is the whole of audit BLOCKER-1's fix at the
   * connection level.
   */
  const pg = tenantPool(systemOf(fastify.pg), null)
  const anyone = { preHandler: optionalAuth(fastify) }

  /**
   * "A live publication of this dataset covers this financial year." Written once, used by the
   * handlers whose own source table carries no publication join, so each of them is correct
   * regardless of how the policies compose. $n is the year parameter's position.
   */
  const yearPublished = (dataset, yearParam) => `EXISTS (
          SELECT 1 FROM finance.publication pub
           WHERE pub.financial_year_id = ${yearParam}
             AND pub.dataset = '${dataset}' AND pub.state = 'published')`

  /**
   * The same, for the two datasets migration 197 keys to the AUTHORITY rather than to a year:
   * projects span financial years and documents are classified one at a time, so their
   * publication covers the council's register, not one reporting period. Stated the way the
   * policy states it so the route and the policy cannot disagree.
   */
  const registerPublished = (dataset, authorityCol) => `EXISTS (
          SELECT 1 FROM finance.publication pub
           WHERE pub.authority_id = ${authorityCol}
             AND pub.dataset = '${dataset}' AND pub.state = 'published')`

  /** The years the council has published something for. This drives the year selector. */
  fastify.get('/public/finance/years', anyone, async (_request, reply) => {
    const { rows } = await pg.query(
      `SELECT y.id, y.label, y.reporting_currency, ${dateText('y', 'start_date', 'end_date')},
              array_agg(DISTINCT p.dataset ORDER BY p.dataset) AS published_datasets,
              max(p.published_at) AS last_published_at
         FROM finance.financial_year y
         JOIN finance.publication p ON p.financial_year_id = y.id AND p.state = 'published'
        GROUP BY y.id, y.label, y.start_date, y.end_date, y.reporting_currency
        ORDER BY y.start_date DESC`,
    )
    return ok(reply, rows)
  })

  /**
   * The financial summary: approved/revised budget, revenue collected, expenditure, and the
   * available allocation. PER CURRENCY, with no combined total — the honest shape while the
   * Council has not approved a conversion basis (decision D4).
   */
  fastify.get('/public/finance/overview', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    const yearId = request.query.financial_year_id
    const { rows: year } = await pg.query(
      `SELECT y.id, y.label, y.reporting_currency, ${dateText('y', 'start_date', 'end_date')},
              la.authority_name
         FROM finance.financial_year y
         JOIN public.local_authorities la ON la.id = y.authority_id
        WHERE y.id = $1
          AND EXISTS (SELECT 1 FROM finance.publication pub
                       WHERE pub.financial_year_id = y.id AND pub.state = 'published')`, [yearId],
    )
    if (!year[0]) {
      return fail(reply, 404, 'not_found', 'No published financial information for that year.')
    }

    const { rows: publications } = await pg.query(
      `SELECT dataset, version, published_at, reporting_period_label,
              data_as_at::text AS data_as_at
         FROM finance.publication WHERE financial_year_id = $1 AND state = 'published'`, [yearId],
    )
    const byDataset = Object.fromEntries(publications.map((p) => [p.dataset, p]))

    // Budget. The published_select policy enforces this too; the predicate is stated here as
    // well so the figures are right whatever the policy does (audit BLOCKER-1, defence in depth).
    const { rows: budget } = await pg.query(
      `SELECT l.currency, a.kind AS account_kind,
              count(*)::int AS lines,
              sum(l.original_amount) AS original_amount,
              sum(l.original_amount + COALESCE(r.approved_adjustments, 0)) AS revised_amount
         FROM finance.budget_line l
         JOIN finance.account a ON a.id = l.account_id
         LEFT JOIN (SELECT budget_line_id, sum(amount_delta) AS approved_adjustments
                      FROM finance.budget_revision
                     WHERE state = 'approved' AND deleted_at IS NULL
                     GROUP BY budget_line_id) r
                ON r.budget_line_id = l.id
        WHERE l.financial_year_id = $1
          AND l.deleted_at IS NULL
          AND l.status = 'published'
          AND ${yearPublished('budget', '$1')}
        GROUP BY l.currency, a.kind ORDER BY l.currency, a.kind`, [yearId],
    )

    const { rows: actuals } = await pg.query(
      `SELECT currency, account_kind, count(*)::int AS transactions, sum(amount) AS amount,
              min(txn_date)::text AS earliest, max(txn_date)::text AS latest
         FROM finance.v_published_transaction
        WHERE financial_year_id = $1
        GROUP BY currency, account_kind ORDER BY currency, account_kind`, [yearId],
    )

    // Projects belong to a year through their allocations and linked transactions, not through a
    // column on finance.project (audit F-03). The view exposes `financial_year_ids` for exactly
    // this filter, so the project figures cannot contradict the selected reporting period.
    const { rows: projects } = await pg.query(
      `SELECT v.currency, count(*)::int AS projects, sum(v.approved_budget) AS approved_budget,
              sum(v.allocation_currency_mismatch_rows)::int AS allocation_currency_mismatch_rows,
              sum(v.actual_currency_mismatch_rows)::int     AS actual_currency_mismatch_rows
         FROM finance.v_project_performance v
        WHERE $1 = ANY(v.financial_year_ids)
          AND v.status = ANY($2::text[])
          AND ${registerPublished('projects', 'v.authority_id')}
        GROUP BY currency ORDER BY currency`, [yearId, PUBLIC_PROJECT_STATUSES],
    )

    // Assemble per currency. Every arithmetic step below is a lookup of a figure Postgres already
    // computed, never an addition of two amounts in JavaScript.
    const currencies = [...new Set([
      ...budget.map((b) => b.currency), ...actuals.map((a) => a.currency),
    ])].sort()
    const summary = currencies.map((c) => {
      const pick = (rows, kind) => rows.find((r) => r.currency === c && r.account_kind === kind) || null
      return {
        currency: c,
        revenue: {
          budget: pick(budget, 'revenue'),
          actual: pick(actuals, 'revenue'),
        },
        expenditure: {
          budget: pick(budget, 'expenditure'),
          actual: pick(actuals, 'expenditure'),
        },
      }
    })

    return ok(reply, {
      council: { name: year[0].authority_name || 'Vungu Rural District Council' },
      financial_year: year[0],
      summary,
      projects,
      published: {
        budget: provenance(byDataset.budget),
        revenue: provenance(byDataset.revenue),
        expenditure: provenance(byDataset.expenditure),
        projects: provenance(byDataset.projects),
        documents: provenance(byDataset.documents),
      },
      // Said once, prominently, so nobody reads the two currency blocks as parts of one total.
      definitions: {
        revised_budget: 'The original approved budget plus approved adjustments.',
        actual: 'Posted transactions within the published reporting scope.',
        currency: 'USD and ZWG figures are reported separately and are never added together. No exchange rate is applied.',
        source: 'Figures are as imported from the council\'s accounting records, with the source file and reconciliation result retained.',
      },
    })
  })

  /**
   * Published budget lines, with the original and the revised allocation both visible.
   *
   * Reads finance.v_published_budget_line (migration 200), NOT the staff view
   * finance.v_budget_line_performance. The staff view carries no publication join, so until the
   * audit's BLOCKER-1 this handler returned every draft line of the council's budget to any
   * signed-in member of staff. The publication contract now lives in the view, where a future
   * caller inherits it instead of having to remember it.
   */
  fastify.get('/public/finance/budget', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          kind: { type: 'string', enum: ['revenue', 'expenditure'] },
          department_id: uuid,
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: ['code', 'revised_amount', 'execution'], default: 'code' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const sortColumn = { code: 'p.code', revised_amount: 'p.revised_amount', execution: 'p.execution_percentage' }[q.sort]
    const dir = q.direction === 'desc' ? 'DESC' : 'ASC'
    const params = [q.financial_year_id, q.kind || null, q.department_id || null,
      q.q ? `%${q.q.trim()}%` : null, q.limit, q.offset]
    const where = `
      WHERE p.financial_year_id = $1
        AND ($2::text IS NULL OR p.account_kind = $2::text)
        AND ($3::uuid IS NULL OR p.department_id = $3::uuid)
        AND ($4::text IS NULL OR p.code ILIKE $4::text OR p.description ILIKE $4::text)`
    const { rows } = await pg.query(
      `SELECT p.budget_line_id, p.code, p.description, p.currency, p.account_kind,
              p.original_amount, p.approved_adjustments, p.revised_amount,
              p.actual_amount, p.available_excluding_commitments, p.execution_percentage, p.variance,
              d.code AS department_code, d.name AS department_name,
              a.code AS account_code, a.name AS account_name
         FROM finance.v_published_budget_line p
         JOIN finance.department d ON d.id = p.department_id
         JOIN finance.account a ON a.id = p.account_id
         ${where}
        ORDER BY ${sortColumn} ${dir} NULLS LAST, p.code
        LIMIT $5 OFFSET $6`, params,
    )
    const { rows: count } = await pg.query(
      `SELECT count(*)::int AS total FROM finance.v_published_budget_line p
         JOIN finance.department d ON d.id = p.department_id ${where}`, params.slice(0, 4),
    )
    return ok(reply, {
      lines: rows, total: count[0].total, limit: q.limit, offset: q.offset,
      note: 'Available allocation shown excludes commitments.',
    })
  })

  /** Published revenue or expenditure, summarised by department and by account. */
  for (const kind of ['revenue', 'expenditure']) {
    fastify.get(`/public/finance/${kind}`, {
      ...anyone,
      schema: {
        querystring: {
          type: 'object', required: ['financial_year_id'], additionalProperties: false,
          properties: { financial_year_id: uuid },
        },
      },
    }, async (request, reply) => {
      const yearId = request.query.financial_year_id
      const { rows: byDepartment } = await pg.query(
        `SELECT department_code, department_name, currency,
                count(*)::int AS transactions, sum(amount) AS amount
           FROM finance.v_published_transaction
          WHERE financial_year_id = $1 AND account_kind = $2
          GROUP BY department_code, department_name, currency
          ORDER BY sum(amount) DESC`, [yearId, kind],
      )
      const { rows: byAccount } = await pg.query(
        `SELECT account_code, account_name, currency,
                count(*)::int AS transactions, sum(amount) AS amount
           FROM finance.v_published_transaction
          WHERE financial_year_id = $1 AND account_kind = $2
          GROUP BY account_code, account_name, currency
          ORDER BY sum(amount) DESC LIMIT 200`, [yearId, kind],
      )
      const { rows: byMonth } = await pg.query(
        `SELECT date_trunc('month', txn_date)::date::text AS month, currency,
                sum(amount) AS amount, count(*)::int AS transactions
           FROM finance.v_published_transaction
          WHERE financial_year_id = $1 AND account_kind = $2
          GROUP BY 1, currency ORDER BY 1`, [yearId, kind],
      )
      const { rows: pub } = await pg.query(
        `SELECT version, published_at, reporting_period_label, data_as_at::text AS data_as_at
           FROM finance.publication
          WHERE financial_year_id = $1 AND dataset = $2 AND state = 'published'`, [yearId, kind],
      )
      return ok(reply, {
        kind,
        by_department: byDepartment,
        by_account: byAccount,
        by_month: byMonth,
        published: provenance(pub[0]),
        note: 'Amounts are grouped by currency and are never added across currencies.',
      })
    })
  }

  /**
   * Published transactions. Served exclusively from finance.v_published_transaction, which carries
   * no counterparty columns.
   */
  fastify.get('/public/finance/transactions', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          kind: { type: 'string', enum: ['revenue', 'expenditure'] },
          department_code: { type: 'string', maxLength: 60 },
          account_code: { type: 'string', maxLength: 60 },
          from: { type: 'string', format: 'date' },
          to: { type: 'string', format: 'date' },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: ['txn_date', 'amount'], default: 'txn_date' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const sortColumn = { txn_date: 't.txn_date', amount: 't.amount' }[q.sort]
    const dir = q.direction === 'asc' ? 'ASC' : 'DESC'
    const params = [q.financial_year_id, q.kind || null, q.department_code || null,
      q.account_code || null, q.from || null, q.to || null,
      q.q ? `%${q.q.trim()}%` : null, q.limit, q.offset]
    const where = `
      WHERE t.financial_year_id = $1
        AND ($2::text IS NULL OR t.account_kind = $2::text)
        AND ($3::text IS NULL OR t.department_code = $3::text)
        AND ($4::text IS NULL OR t.account_code = $4::text)
        AND ($5::date IS NULL OR t.txn_date >= $5::date)
        AND ($6::date IS NULL OR t.txn_date <= $6::date)
        AND ($7::text IS NULL OR t.description ILIKE $7::text OR t.reference ILIKE $7::text)`
    const { rows } = await pg.query(
      `SELECT t.id, t.txn_date::text AS txn_date, t.amount, t.currency, t.description, t.reference,
              t.account_code, t.account_name, t.account_kind,
              t.department_code, t.department_name, t.published_at,
              t.data_as_at::text AS data_as_at
         FROM finance.v_published_transaction t ${where}
        ORDER BY ${sortColumn} ${dir}, t.id
        LIMIT $8 OFFSET $9`, params,
    )
    const { rows: count } = await pg.query(
      `SELECT count(*)::int AS total FROM finance.v_published_transaction t ${where}`, params.slice(0, 7),
    )
    return ok(reply, {
      transactions: rows, total: count[0].total, limit: q.limit, offset: q.offset,
      withheld: 'Supplier and beneficiary identities are not part of the published record.',
    })
  })

  fastify.get('/public/finance/transactions/:id', anyone, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT *, ${dateText(null, 'txn_date', 'data_as_at')}
         FROM finance.v_published_transaction WHERE id = $1`, [request.params.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No published transaction with that reference.')
    // 'public' is a classification, not a publication: the council must also have published its
    // documents register. Stated here as well as in the policy (audit BLOCKER-1).
    const { rows: documents } = await pg.query(
      `SELECT d.id, d.filename, d.mime_type, d.size_bytes, d.document_type, d.uploaded_at
         FROM finance.document d
        WHERE d.subject_kind = 'transaction' AND d.subject_id = $1::text
          AND d.visibility = 'public' AND d.deleted_at IS NULL
          AND ${registerPublished('documents', 'd.authority_id')}`, [request.params.id],
    )
    return ok(reply, { transaction: rows[0], documents })
  })

  /** Published projects and their financial performance, scoped to one reporting year. */
  fastify.get('/public/finance/projects', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          status: { type: 'string', maxLength: 40 },
          ward_code: { type: 'string', maxLength: 24 },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT p.project_id, p.reference, p.name, p.status, p.ward_code, p.currency,
              p.approved_budget, p.allocated_total, p.actual_spend, p.execution_percentage,
              p.other_currency_allocations, p.other_currency_spend,
              p.allocation_currency_mismatch_rows, p.actual_currency_mismatch_rows,
              p.financial_year_ids,
              d.code AS department_code, d.name AS department_name,
              pr.description, pr.location_text,
              ${dateText('pr', 'start_date', 'end_date')},
              ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude
         FROM finance.v_project_performance p
         JOIN finance.project pr ON pr.id = p.project_id
         LEFT JOIN finance.department d ON d.id = p.department_id
        WHERE ($1::uuid IS NULL OR $1 = ANY(p.financial_year_ids))
          AND ($2::text IS NULL OR p.status = $2::text)
          AND ($3::text IS NULL OR p.ward_code = $3::text)
          AND ($4::text IS NULL OR p.reference ILIKE $4::text OR p.name ILIKE $4::text)
          -- The release contract, stated rather than inherited (audit BLOCKER-1): a project is
          -- public only in a released status, and only while the council's projects register is
          -- published. A proposed or draft project is not a public commitment.
          AND p.status = ANY($7::text[])
          AND ${registerPublished('projects', 'p.authority_id')}
        ORDER BY p.reference
        LIMIT $5 OFFSET $6`,
      [q.financial_year_id || null, q.status || null, q.ward_code || null,
        q.q ? `%${q.q.trim()}%` : null, q.limit, q.offset, PUBLIC_PROJECT_STATUSES],
    )
    return ok(reply, {
      projects: rows,
      limit: q.limit,
      offset: q.offset,
      note: 'Amounts are in each project\'s own currency. Allocations or spend in another currency '
        + 'are listed separately and are never converted or added to the totals.',
    })
  })

  /**
   * THE PUBLIC WARD MAP — ward-level aggregates only (GIS–finance Milestone 7, audit M7-2).
   *
   * WHAT THE COUNCIL HAS PERMITTED (decision D14, owner direction of 2026-11-09): ward-level
   * budget allocation, expenditure and revenue, each per ward and per currency, plus project
   * locations with status. Counterparty identity is excluded at every width — structurally, since
   * nothing here reads finance.transaction's counterparty columns and this route never returns a
   * transaction at all.
   *
   * D14 IS PERMISSION, NOT PUBLICATION. The two are different gates and both apply:
   *
   *   permission  — the Council has said a ward-level revenue aggregate MAY be public.
   *   publication — a live finance.publication row for that dataset and year is what makes a
   *                 figure public, and withdrawing it must make the same request return nothing
   *                 WITH NO CODE CHANGE.
   *
   * So a measure appears here only if its dataset is actually published. `published_datasets`
   * tells the client which measures to offer; an absent dataset yields NULL measures, never an
   * inferred one — there is no expenditure choropleth derived from a published budget.
   *
   * THE TWO GUARANTEES THE FILE HEADER DESCRIBES, BOTH HONOURED:
   *
   *   1. This handler queries `pg` — the pool scoped to NOBODY — like every other handler here.
   *      A signed-in council officer who holds no finance permission (a building_inspector) must
   *      see exactly what an anonymous citizen sees, which is the hole audit BLOCKER-1 found.
   *   2. It states its own publication predicate. finance.v_ward_performance is
   *      security_invoker, so RLS is already doing this work — and the CASE expressions below do
   *      it again from finance.publication, so a dropped policy cannot open the route and a
   *      forgotten filter cannot either.
   *
   * AGGREGATED PER WARD ONLY. No budget_line_id, no project_id, no transaction row, no
   * department breakdown. The grain of this payload is the ward.
   */
  fastify.get('/public/finance/map/wards', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', required: ['financial_year_id'], additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          currency: { type: 'string', enum: ['USD', 'ZWG'] },
          dataset: { type: 'string', enum: ['budget', 'revenue', 'expenditure', 'projects'] },
        },
      },
    },
  }, async (request, reply) => {
    const yearId = request.query.financial_year_id
    const currency = request.query.currency || null

    // The year must itself be covered by a live publication, exactly as /public/finance/overview
    // requires. A year nobody has published is not a 403 and not an empty map: it is a 404,
    // because as far as the public record goes that reporting period does not exist.
    const { rows: year } = await pg.query(
      `SELECT y.id, y.label, y.authority_id, y.reporting_currency,
              ${dateText('y', 'start_date', 'end_date')}, la.authority_name
         FROM finance.financial_year y
         JOIN public.local_authorities la ON la.id = y.authority_id
        WHERE y.id = $1
          AND EXISTS (SELECT 1 FROM finance.publication pub
                       WHERE pub.financial_year_id = y.id AND pub.state = 'published')`, [yearId],
    )
    if (!year[0]) {
      return fail(reply, 404, 'not_found', 'No published financial information for that year.')
    }

    const { rows: publications } = await pg.query(
      `SELECT dataset, version, published_at, reporting_period_label,
              data_as_at::text AS data_as_at
         FROM finance.publication
        WHERE financial_year_id = $1 AND state = 'published'
        UNION
        -- Projects and documents are published against the council's REGISTER rather than a
        -- reporting period (migration 197), so their publication is not keyed to the year.
        SELECT dataset, version, published_at, reporting_period_label,
               data_as_at::text AS data_as_at
          FROM finance.publication
         WHERE authority_id = $2 AND state = 'published' AND dataset IN ('projects', 'documents')`,
      [yearId, year[0].authority_id],
    )
    const byDataset = Object.fromEntries(publications.map((p) => [p.dataset, p]))
    const publishedDatasets = Object.keys(byDataset).sort()
    const live = (dataset) => Boolean(byDataset[dataset])

    // `dataset` narrows what the caller asked for; it can never WIDEN what publication allows.
    const want = (dataset) => live(dataset)
      && (!request.query.dataset || request.query.dataset === dataset)

    const showBudget = want('budget')
    const showRevenue = want('revenue')
    const showExpenditure = want('expenditure')
    const showProjects = want('projects')

    // Every measure is NULL unless its own dataset is live. Passed as booleans, so the predicate
    // is data and not string-built SQL, and so a dataset the Council has not published cannot be
    // reached by any query string.
    const { rows: wards } = await pg.query(
      `SELECT w.ward_code, w.ward_status, w.currency,
              -- The provisional-register signal (decision D11): a public map must not present an
              -- unconfirmed ward list as settled.
              w.ward_register_basis,
              CASE WHEN $3::boolean THEN w.revenue_budget END      AS revenue_budget,
              CASE WHEN $4::boolean THEN w.revenue_actual END      AS revenue_actual,
              CASE WHEN $3::boolean AND $4::boolean THEN w.revenue_variance END AS revenue_variance,
              CASE WHEN $3::boolean AND $4::boolean
                   THEN w.revenue_collection_percentage END        AS revenue_collection_percentage,
              CASE WHEN $3::boolean THEN w.expenditure_budget END  AS expenditure_budget,
              CASE WHEN $5::boolean THEN w.expenditure_actual END  AS expenditure_actual,
              CASE WHEN $3::boolean AND $5::boolean
                   THEN w.expenditure_execution_percentage END     AS expenditure_execution_percentage
         FROM finance.v_ward_performance w
        WHERE w.financial_year_id = $1
          AND w.ward_code IS NOT NULL
          AND ($2::text IS NULL OR w.currency = $2::text)
        ORDER BY w.currency, w.ward_code`,
      [yearId, currency, showBudget, showRevenue, showExpenditure],
    )

    // Project COUNTS and approved budget per ward — an aggregate, never a project row. The
    // release contract is stated here as well as in the policy: a proposed project is not a
    // public commitment, and the projects register must be published.
    let projectsByWard = []
    if (showProjects) {
      ({ rows: projectsByWard } = await pg.query(
        `SELECT p.ward_code, p.currency,
                count(*)::int AS project_count,
                sum(p.approved_budget) AS approved_budget,
                count(*) FILTER (WHERE pr.location IS NOT NULL)::int AS located_project_count
           FROM finance.v_project_performance p
           JOIN finance.project pr ON pr.id = p.project_id
          WHERE p.ward_code IS NOT NULL
            AND ($1::uuid IS NULL OR $1 = ANY(p.financial_year_ids))
            AND ($2::text IS NULL OR p.currency = $2::text)
            AND p.status = ANY($3::text[])
            AND ${registerPublished('projects', 'p.authority_id')}
          GROUP BY p.ward_code, p.currency
          ORDER BY p.currency, p.ward_code`,
        [yearId, currency, PUBLIC_PROJECT_STATUSES],
      ))
    }

    // What the published record cannot place. An aggregate of published rows only — under this
    // connection the view sees nothing else.
    const { rows: unlocated } = await pg.query(
      `SELECT dataset, currency, unlocated_rows, unlocated_amount
         FROM finance.v_unlocated_finance
        WHERE (financial_year_id = $1 OR (financial_year_id IS NULL AND dataset = 'projects'))
          AND ($2::text IS NULL OR currency = $2::text)
          AND ((dataset = 'budget' AND $3::boolean)
               OR (dataset = 'transactions' AND ($4::boolean OR $5::boolean))
               OR (dataset = 'projects' AND $6::boolean))
        ORDER BY dataset, currency`,
      [yearId, currency, showBudget, showRevenue, showExpenditure, showProjects],
    )

    const { rows: register } = await pg.query(
      `SELECT count(*)::int AS linked_wards,
              array_agg(DISTINCT basis ORDER BY basis) AS bases
         FROM admin.authority_ward
        WHERE authority_id = $1 AND valid_to IS NULL`, [year[0].authority_id],
    )

    const currencies = [...new Set(wards.concat(projectsByWard).map((r) => r.currency))].sort()

    return ok(reply, {
      council: { name: year[0].authority_name || 'Vungu Rural District Council' },
      financial_year: {
        id: year[0].id, label: year[0].label,
        start_date: year[0].start_date, end_date: year[0].end_date,
        reporting_currency: year[0].reporting_currency,
      },
      currencies,
      wards,
      projects_by_ward: projectsByWard,
      unlocated,
      ward_register_linked: register[0].linked_wards > 0,
      ward_register_bases: register[0].bases || [],
      published_datasets: publishedDatasets,
      // Which measures the client may offer. Derived from publication, not from D14's ceiling:
      // permission is necessary and publication is sufficient, and only the pair makes a figure
      // public.
      available_measures: [
        ...(showBudget ? ['revenue_budget', 'expenditure_budget'] : []),
        ...(showRevenue ? ['revenue_actual'] : []),
        ...(showExpenditure ? ['expenditure_actual'] : []),
        ...(showBudget && showRevenue ? ['revenue_variance', 'revenue_collection_percentage'] : []),
        ...(showBudget && showExpenditure ? ['expenditure_execution_percentage'] : []),
        ...(showProjects ? ['project_count'] : []),
      ],
      provenance: {
        budget: provenance(byDataset.budget),
        revenue: provenance(byDataset.revenue),
        expenditure: provenance(byDataset.expenditure),
        projects: provenance(byDataset.projects),
      },
      // M4-5: which attribution rule the actuals follow, stated on the public surface too.
      actuals_basis: 'transaction_ward_code',
      sources: ['finance.v_ward_performance', 'finance.v_project_performance',
        'finance.v_unlocated_finance'],
      generated_at: new Date().toISOString(),
      notes: {
        aggregation: 'Figures are totals for a whole ward. No individual transaction, budget line '
          + 'or project is published through this view.',
        counterparty: 'Supplier and beneficiary identities are not part of the published record.',
        currency: 'USD and ZWG figures are reported separately and are never added together. '
          + 'No exchange rate is applied.',
        missing: 'A blank measure means the council has not published that dataset for this year, '
          + 'or has no figure for that ward. It does not mean zero.',
      },
    })
  })

  /**
   * The ward polygons the public map draws on (audit M7-3).
   *
   * Safe to serve anonymously, and not because of a policy: `admin.ward` and
   * `admin.authority_ward` are national reference data with row-level security OFF, and the same
   * boundaries are already public through /api/tiles/wards. Ward boundaries are public
   * information; the FIGURES are what publication gates, and they are not in this payload.
   *
   * `ward_register_bases` is the honest part: while the register carries basis 'interim'
   * (migration 201, decision D11 still open) the public map must say the ward list is provisional
   * rather than draw 19 confident polygons.
   */
  fastify.get('/public/finance/map/ward-geometry', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { financial_year_id: uuid },
      },
    },
  }, async (request, reply) => {
    // Which council? The public portal serves one authority per deployment, and the year names
    // it. Without a year, the councils that have published anything at all.
    const { rows: authority } = await pg.query(
      request.query.financial_year_id
        ? `SELECT DISTINCT y.authority_id FROM finance.financial_year y
            WHERE y.id = $1
              AND EXISTS (SELECT 1 FROM finance.publication pub
                           WHERE pub.financial_year_id = y.id AND pub.state = 'published')`
        : `SELECT DISTINCT authority_id FROM finance.publication WHERE state = 'published'`,
      request.query.financial_year_id ? [request.query.financial_year_id] : [],
    )
    if (!authority.length) {
      return ok(reply, { ward_register_linked: false, ward_register_bases: [], features: [] })
    }
    const authorityIds = authority.map((r) => r.authority_id)

    const { rows } = await pg.query(
      `SELECT w.ward_code, w.name, aw.basis,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(w.geom, 0.001))::json AS geometry
         FROM admin.authority_ward aw
         JOIN admin.ward w ON w.ward_code = aw.ward_code
        WHERE aw.authority_id = ANY($1::int[]) AND aw.valid_to IS NULL
        ORDER BY w.ward_code`, [authorityIds],
    )

    return ok(reply, {
      ward_register_linked: rows.length > 0,
      ward_register_bases: [...new Set(rows.map((r) => r.basis))].sort(),
      features: rows.map((r) => ({
        type: 'Feature',
        properties: { ward_code: r.ward_code, name: r.name, register_basis: r.basis },
        geometry: r.geometry,
      })),
      note: rows.some((r) => r.basis === 'interim')
        ? 'This ward list is PROVISIONAL: it has not yet been confirmed by a Council resolution '
          + '(decision D11). Boundaries come from the national COD-AB register.'
        : null,
    })
  })

  /**
   * Approved budgets, reports and statements the council has released. Paginated and filterable:
   * the register may be large, and returning 500 newest rows made older documents unreachable
   * (audit F-07). The year is derived from the document's subject (migration 191), so the public
   * year selector and the document panel cannot disagree.
   */
  fastify.get('/public/finance/documents', {
    ...anyone,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          dataset: { type: 'string', enum: ['budget', 'revenue', 'expenditure', 'projects', 'reports', 'documents'] },
          subject_kind: { type: 'string', maxLength: 40 },
          document_type: { type: 'string', maxLength: 80 },
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: ['uploaded_at', 'filename', 'document_type'], default: 'uploaded_at' },
          direction: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const kinds = q.dataset ? (DOCUMENT_DATASET_KINDS[q.dataset] || null) : null
    const sortColumn = { uploaded_at: 'uploaded_at', filename: 'filename', document_type: 'document_type' }[q.sort]
    const direction = q.direction === 'asc' ? 'ASC' : 'DESC'

    // visibility = 'public' is the council's hand classification (decision D5); it is NOT a
    // publication. A document classified public whose documents register was never published — or
    // whose publication has since been withdrawn — must not appear here, which is what the
    // publication predicate says and what the policy also says (audit BLOCKER-1).
    const where = `WHERE d.visibility = 'public' AND d.deleted_at IS NULL
        AND ($1::uuid IS NULL OR d.financial_year_id = $1::uuid)
        AND ($2::text IS NULL OR d.subject_kind = $2::text)
        AND ($3::text IS NULL OR d.document_type = $3::text)
        AND ($4::text IS NULL OR d.filename ILIKE $4::text OR d.document_type ILIKE $4::text)
        AND ($5::text[] IS NULL OR d.subject_kind = ANY($5::text[]))
        AND ${registerPublished('documents', 'd.authority_id')}`
    const params = [
      q.financial_year_id || null, q.subject_kind || null, q.document_type || null,
      q.q ? `%${q.q.trim()}%` : null, kinds,
    ]
    const { rows } = await pg.query(
      `SELECT d.id, d.filename, d.mime_type, d.size_bytes, d.document_type, d.subject_kind,
              d.financial_year_id, d.uploaded_at
         FROM finance.document d
         ${where}
        ORDER BY d.${sortColumn} ${direction} NULLS LAST, d.id
        LIMIT $6 OFFSET $7`, [...params, q.limit, q.offset],
    )
    const { rows: count } = await pg.query(
      `SELECT count(*)::int AS total FROM finance.document d ${where}`, params,
    )
    return ok(reply, {
      documents: rows, total: count[0].total, limit: q.limit, offset: q.offset,
      sort: q.sort, direction: q.direction,
      note: q.dataset === 'projects'
        ? 'Project documents are multi-year and have no single financial year; the year filter does not apply to them.'
        : null,
    })
  })
}

module.exports = { financePublicRoutes }
