/**
 * The budget officer's dashboard: one read for the Budget Management workspace's first screen.
 *
 * Everything comes from finance.v_budget_line_performance (the view every budget report already
 * uses), so this dashboard and the budget reports cannot disagree. Spending figures are the
 * EXPENDITURE lines; revenue lines are budgeted income, not spending, and are left out of
 * "committed", "spent" and "available".
 *
 * Same rules as the rest of finance: no money arithmetic in JavaScript, one row per currency
 * (decision D4), and this route only reads. Submitting, revising and approving are the existing
 * budget routes with their own permissions.
 */

const { requirePermission, departmentScope } = require('../middleware/financePermissions')

const ok = (reply, data) => reply.code(200).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

const pct = (part, whole) => `CASE WHEN COALESCE(sum(${whole}), 0) > 0 THEN round(sum(${part}) * 100 / sum(${whole}), 1)::text END`

async function financeBudgetingRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.budget.view') }
  const uuid = { type: 'string', format: 'uuid' }

  fastify.get('/finance/budgeting/dashboard', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    try {
      const { rows: years } = await pg.query(
        `SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, status, reporting_currency
           FROM finance.financial_year
          WHERE deleted_at IS NULL
            AND (($1::uuid IS NOT NULL AND id = $1::uuid)
                 OR ($1::uuid IS NULL AND status = 'open' AND CURRENT_DATE BETWEEN start_date AND end_date))
          ORDER BY start_date DESC LIMIT 1`, [request.query.financial_year_id || null])
      const year = years[0]
      if (!year) return fail(reply, 404, 'no_year', 'No open financial year contains today. Choose a year.')
      // A departmental head is confined to their own votes here as everywhere else; null means council-wide.
      const scope = await departmentScope(fastify, request)
      const Y = [year.id, scope]
      const inScope = (col) => `($2::uuid[] IS NULL OR ${col} = ANY($2::uuid[]))`
      const spend = `p.financial_year_id = $1 AND p.account_kind = 'expenditure' AND p.status IN ('approved', 'published') AND ${inScope('p.department_id')}`

      const [totals, programmes, departments, workflow, revisions, overLines, oldCommitments, projects, periods] = await Promise.all([
        pg.query(
          `SELECT p.currency,
                  COALESCE(sum(p.revised_amount), 0)::numeric(18,2)::text AS budget,
                  COALESCE(sum(p.open_commitments), 0)::numeric(18,2)::text AS committed,
                  COALESCE(sum(p.actual_amount), 0)::numeric(18,2)::text AS actual,
                  COALESCE(sum(p.available_including_commitments), 0)::numeric(18,2)::text AS available,
                  ${pct('p.open_commitments', 'p.revised_amount')} AS committed_pct,
                  ${pct('p.actual_amount', 'p.revised_amount')} AS actual_pct,
                  ${pct('p.available_including_commitments', 'p.revised_amount')} AS available_pct,
                  ${pct('p.actual_amount + p.open_commitments', 'p.revised_amount')} AS utilised_pct
             FROM finance.v_budget_line_performance p WHERE ${spend}
            GROUP BY p.currency ORDER BY p.currency`, Y),
        pg.query(
          `SELECT p.currency, COALESCE(pr.code, '—') AS code, COALESCE(pr.name, 'No programme') AS name,
                  sum(p.revised_amount)::numeric(18,2)::text AS budget, sum(p.actual_amount)::numeric(18,2)::text AS actual
             FROM finance.v_budget_line_performance p LEFT JOIN finance.programme pr ON pr.id = p.programme_id
            WHERE ${spend}
            GROUP BY p.currency, pr.code, pr.name ORDER BY p.currency, sum(p.revised_amount) DESC`, Y),
        pg.query(
          `SELECT p.currency, d.code, d.name,
                  sum(p.revised_amount)::numeric(18,2)::text AS budget,
                  sum(p.actual_amount)::numeric(18,2)::text AS actual,
                  sum(p.open_commitments)::numeric(18,2)::text AS committed,
                  (sum(p.actual_amount) - sum(p.revised_amount))::numeric(18,2)::text AS variance,
                  ${pct('p.actual_amount', 'p.revised_amount')} AS utilisation,
                  CASE WHEN sum(p.revised_amount) > 0
                       THEN round((sum(p.actual_amount) - sum(p.revised_amount)) * 100 / sum(p.revised_amount), 1)::text END AS variance_pct
             FROM finance.v_budget_line_performance p JOIN finance.department d ON d.id = p.department_id
            WHERE ${spend}
            GROUP BY p.currency, d.code, d.name ORDER BY p.currency, sum(p.revised_amount) DESC`, Y),
        pg.query(
          `SELECT status, count(*)::int AS n FROM finance.budget_line
            WHERE financial_year_id = $1 AND deleted_at IS NULL AND ${inScope('department_id')} GROUP BY status`, Y),
        pg.query(
          `SELECT r.state, count(*)::int AS n FROM finance.budget_revision r
             JOIN finance.budget_line l ON l.id = r.budget_line_id
            WHERE l.financial_year_id = $1 AND r.deleted_at IS NULL AND ${inScope('l.department_id')} GROUP BY r.state`, Y),
        pg.query(
          `SELECT count(*)::int AS n FROM finance.v_budget_line_performance p
            WHERE ${spend} AND p.actual_amount + p.open_commitments > p.revised_amount`, Y),
        pg.query(
          `SELECT count(*)::int AS n FROM finance.commitment c JOIN finance.budget_line l ON l.id = c.budget_line_id
            WHERE l.financial_year_id = $1 AND ${inScope('l.department_id')} AND c.deleted_at IS NULL AND c.status IN ('open', 'partially_liquidated')
              AND c.amount > c.liquidated_amount AND c.committed_on < CURRENT_DATE - 90`, Y),
        pg.query(
          `SELECT count(*)::int AS n FROM finance.v_project_performance pp
            WHERE pp.status NOT IN ('completed', 'cancelled')
              AND ($1::uuid[] IS NULL OR pp.department_id = ANY($1::uuid[]))
              AND COALESCE(pp.approved_budget, 0) > 0
              AND pp.allocated_original > pp.approved_budget`, [scope]).catch(() => ({ rows: [{ n: 0 }] })),
        pg.query(
          `SELECT period_no, label, to_date::text AS to_date, (to_date - CURRENT_DATE) AS days_left
             FROM finance.ledger_period
            WHERE financial_year_id = $1 AND to_date >= CURRENT_DATE
            ORDER BY to_date LIMIT 3`, [year.id]),
      ])

      const count = (rows, key, value) => rows.find((r) => r[key] === value)?.n ?? 0
      const flow = {
        draft: count(workflow.rows, 'status', 'draft'),
        submitted: count(workflow.rows, 'status', 'submitted'),
        returned: count(workflow.rows, 'status', 'returned'),
        approved: count(workflow.rows, 'status', 'approved') + count(workflow.rows, 'status', 'published'),
      }
      const revisionsAwaiting = count(revisions.rows, 'state', 'submitted')
      const revisionDrafts = count(revisions.rows, 'state', 'draft')

      const alerts = [
        overLines.rows[0].n && { tone: 'neg', key: 'monitoring', text: `${overLines.rows[0].n} budget line${overLines.rows[0].n === 1 ? ' is' : 's are'} over budget (spent and committed)` },
        revisionsAwaiting && { tone: 'warn', key: 'virements', text: `${revisionsAwaiting} revision${revisionsAwaiting === 1 ? '' : 's'} awaiting approval` },
        flow.returned && { tone: 'warn', key: 'approval', text: `${flow.returned} budget line${flow.returned === 1 ? '' : 's'} returned for revision` },
        oldCommitments.rows[0].n && { tone: 'warn', key: 'commitments', text: `${oldCommitments.rows[0].n} commitment${oldCommitments.rows[0].n === 1 ? '' : 's'} open for more than 90 days` },
        projects.rows[0].n && { tone: 'info', key: 'projects', text: `${projects.rows[0].n} project${projects.rows[0].n === 1 ? '' : 's'} allocated more than its approved budget` },
        revisionDrafts && { tone: 'info', key: 'virements', text: `${revisionDrafts} draft revision${revisionDrafts === 1 ? '' : 's'} not yet submitted` },
        flow.draft && { tone: 'info', key: 'planning', text: `${flow.draft} draft budget line${flow.draft === 1 ? '' : 's'} not yet submitted` },
      ].filter(Boolean)

      // The calendar is the ledger's own: each period end is the month-end budget report date.
      const calendar = periods.rows.map((p) => ({ date: p.to_date, days_left: p.days_left, text: `Month-end budget performance (${p.label})` }))
      if (year.end_date && !calendar.some((c) => c.date === year.end_date)) {
        calendar.push({ date: year.end_date, days_left: null, text: `Financial year ends (${year.label})` })
      }

      return ok(reply, {
        year,
        totals: totals.rows,
        programmes: programmes.rows,
        departments: departments.rows,
        workflow: flow,
        revisions_awaiting: revisionsAwaiting,
        alerts,
        calendar,
      })
    } catch (err) {
      fastify.log.error({ err }, 'budgeting dashboard')
      return fail(reply, 500, 'budgeting_error', 'The budget dashboard could not be read.')
    }
  })
}

module.exports = { financeBudgetingRoutes }
