/**
 * The finance module's acceptance criteria, walked end to end against a real database.
 *
 * Each `test` below names one of the checks in docs/finance/2026-11-05-finance-impact-gap-note.md
 * (A1–A10), which in turn come from the specification's acceptance criteria (§15) and critical test
 * scenarios (§13.1). They run in order and share state, because the thing being tested IS the
 * order: a budget that is approved before it is submitted, or published before it is approved, is
 * the failure these controls exist to prevent.
 *
 * Prerequisites: the migration chain through 188, and the demo accounts
 * (`DEMO_SEED_ENABLED=true DEMO_DEFAULT_PASSWORD=… node scripts/seed-demo-users.js`).
 * Run with: npm run test:db
 *
 * Everything this suite creates is prefixed with a per-run tag and removed in afterAll, so it can
 * be run repeatedly against a development database without accumulating fixtures.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')
const { pdfText } = require('../../../test/helpers/pdf-text')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `T${crypto.randomBytes(3).toString('hex').toUpperCase()}`

const auth = (token) => ({ authorization: `Bearer ${token}` })

/**
 * The audit row is written by the onResponse hook, after the reply is sent. `inject` can resolve
 * first, so poll briefly instead of asserting on a race. This is a test of the trail, not of
 * Fastify's hook ordering.
 */
async function waitForRows(pg, sql, params) {
  let rows = []
  for (let attempt = 0; attempt < 20; attempt += 1) {
    ({ rows } = await pg.query(sql, params))
    if (rows.length) return rows
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return rows
}

describe('finance acceptance', () => {
  let app
  const as = {}
  const made = { yearId: null, deptId: null, deptId2: null, accountExpId: null, accountRevId: null,
    lineId: null, line2Id: null, revisionId: null, projectId: null, batchId: null,
    publicationBudget: null, publicationExp: null }

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    const accounts = {
      financeAdmin: 'demo.finance-admin@vungu.test',
      financeOfficer: 'demo.finance-officer@vungu.test',
      budgetOfficer: 'demo.budget-officer@vungu.test',
      deptHead: 'demo.dept-head@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      publisher: 'demo.publisher@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      technicalAdmin: 'demo.admin@vungu.test',
      planner: 'demo.planner@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) {
      as[key] = await loginAs(app, email, PASSWORD)
    }
  }, 60000)

  afterAll(async () => {
    if (!app) return
    const pg = systemOf(app.pg)
    // Children before parents. Everything is identified by the run tag.
    const sql = [
      `DELETE FROM finance.project_transaction WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.project_allocation WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.project WHERE reference LIKE '${TAG}%'`,
      `DELETE FROM finance.document WHERE filename LIKE '${TAG}%'`,
      `DELETE FROM finance.import_exception WHERE batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE '${TAG}%')`,
      `DELETE FROM finance.import_row WHERE batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE '${TAG}%')`,
      `DELETE FROM finance.transaction WHERE import_batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE '${TAG}%')`,
      `DELETE FROM finance.commitment WHERE import_batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE '${TAG}%')`,
      `DELETE FROM finance.import_batch WHERE idempotency_key LIKE '${TAG}%'`,
      `DELETE FROM finance.publication WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label LIKE '${TAG}%')`,
      `DELETE FROM finance.variance_explanation WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.transaction WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.user_scope WHERE department_id IN (SELECT id FROM finance.department WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.transaction WHERE department_id IN (SELECT id FROM finance.department WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE label LIKE '${TAG}%'`,
    ]
    // A closed year refuses writes, so reopen anything this run closed before clearing it.
    await pg.query(`UPDATE finance.financial_year SET status = 'open' WHERE label LIKE '${TAG}%'`).catch(() => {})
    for (const statement of sql) await pg.query(statement).catch(() => {})
    await app.close()
  }, 60000)

  // ── Configuration ──────────────────────────────────────────────────────────────────────────────
  test('a finance administrator sets up a financial year, votes and a chart of accounts', async () => {
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} 2031`, start_date: '2031-01-01', end_date: '2031-12-31', reporting_currency: 'USD' },
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect(year.json().data.status).toBe('draft')

    const opened = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/open`, headers: auth(as.financeAdmin),
    })
    expect(opened.statusCode).toBe(200)
    expect(opened.json().data.status).toBe('open')

    for (const [key, code, name] of [['deptId', `${TAG}-ENG`, 'Engineering'], ['deptId2', `${TAG}-HLT`, 'Health']]) {
      const dept = await app.inject({
        method: 'POST', url: '/api/finance/departments', headers: auth(as.financeAdmin),
        payload: { code, name },
      })
      expect(dept.statusCode).toBe(201)
      made[key] = dept.json().data.id
    }

    // The chart of accounts, loaded as a chart. `kind` is given explicitly on every row.
    const chart = await app.inject({
      method: 'POST', url: '/api/finance/accounts/bulk', headers: auth(as.financeAdmin),
      payload: { accounts: [
        { code: `${TAG}-1100`, name: 'Rates and charges', kind: 'revenue', revenue_class: 'internally_generated' },
        { code: `${TAG}-1200`, name: 'Devolution grant', kind: 'revenue', revenue_class: 'grant' },
        { code: `${TAG}-5100`, name: 'Roads maintenance', kind: 'expenditure', expenditure_class: 'recurrent' },
        { code: `${TAG}-5900`, name: 'Expenditure headings', kind: 'expenditure', expenditure_class: 'capital', is_postable: false },
      ] },
    })
    expect(chart.statusCode).toBe(200)
    expect(chart.json().data.created).toBe(4)
    expect(chart.json().data.refused).toEqual([])

    const accounts = await app.inject({
      method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin),
    })
    const byCode = Object.fromEntries(accounts.json().data.map((a) => [a.code, a]))
    made.accountExpId = byCode[`${TAG}-5100`].id
    made.accountRevId = byCode[`${TAG}-1100`].id
    // The classification is data, not arithmetic over the code: a code in the 5000s is only
    // expenditure here because the chart said so.
    expect(byCode[`${TAG}-1200`].kind).toBe('revenue')
    expect(byCode[`${TAG}-5900`].is_postable).toBe(false)
  })

  test('A5: the technical administrator can read but cannot approve, publish, commit or configure', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(as.technicalAdmin) })
    expect(me.statusCode).toBe(200)
    const permissions = me.json().data.permissions
    expect(permissions).toContain('finance.budget.view')
    expect(permissions).toContain('finance.audit.view')
    expect(permissions).toContain('finance.users.manage_finance_roles')
    // None of these, by default:
    expect(permissions).not.toContain('finance.budget.approve')
    expect(permissions).not.toContain('finance.revision.approve')
    expect(permissions).not.toContain('finance.publication.approve')
    expect(permissions).not.toContain('finance.publication.publish')
    expect(permissions).not.toContain('finance.import.commit')
    expect(permissions).not.toContain('finance.config.manage')
    expect(permissions).not.toContain('finance.transaction.view_counterparty')

    // And the endpoints agree, which is the part that matters.
    const attempt = await app.inject({
      method: 'POST', url: '/api/finance/departments', headers: auth(as.technicalAdmin),
      payload: { code: `${TAG}-NOPE`, name: 'Should not exist' },
    })
    expect(attempt.statusCode).toBe(403)
    expect(attempt.json().required_permission).toBe('finance.config.manage')
  })

  test('F-02: the technical administrator administers finance roles, overrides and scope', async () => {
    const pg = systemOf(app.pg)
    const email = `${TAG.toLowerCase()}-access@vungu.test`
    const { rows: [temp] } = await pg.query(
      `INSERT INTO public.users
         (email, name, full_name, role, password_hash, status, active, authority_id)
       VALUES ($1, $2, $2, 'planner', 'not-a-login', 'active', true,
               (SELECT id FROM public.local_authorities WHERE code = 'VUNGU'))
       RETURNING id`,
      [email, `${TAG} Access`],
    )
    try {
      // The finance administrator prepares and imports; it does not provision people.
      const refused = await app.inject({
        method: 'GET', url: '/api/finance/users', headers: auth(as.financeAdmin),
      })
      expect(refused.statusCode).toBe(403)
      expect(refused.json().required_permission).toBe('finance.users.manage_finance_roles')

      const list = await app.inject({
        method: 'GET', url: `/api/finance/users?q=${TAG}`, headers: auth(as.technicalAdmin),
      })
      expect(list.statusCode).toBe(200)
      expect(list.json().data.users.map((u) => u.id)).toContain(temp.id)
      expect(list.json().data.roles.find((r) => r.name === 'finance_officer').permissions)
        .toContain('finance.budget.view')

      const before = await app.inject({
        method: 'GET', url: `/api/finance/users/${temp.id}/access`, headers: auth(as.technicalAdmin),
      })
      expect(before.statusCode).toBe(200)
      expect(before.json().data.user.role).toBe('planner')
      // A planner already reads the money that touches their projects; they cannot audit it.
      expect(before.json().data.permissions).toContain('finance.project.view')
      expect(before.json().data.permissions).not.toContain('finance.audit.view')

      const granted = await app.inject({
        method: 'PUT', url: `/api/finance/users/${temp.id}/access`, headers: auth(as.technicalAdmin),
        payload: {
          role: 'finance_officer',
          overrides: [{ permission_code: 'finance.audit.export', effect: 'grant', reason: 'Audit support' }],
          department_ids: [made.deptId],
          reason: 'Appointed as finance officer for the TAG pilot',
        },
      })
      expect(granted.statusCode).toBe(200)
      expect(granted.json().data.user.role).toBe('finance_officer')
      expect(granted.json().data.permissions).toContain('finance.budget.view')
      expect(granted.json().data.permissions).toContain('finance.audit.export')
      expect(granted.json().data.department_scope.map((d) => d.id)).toEqual([made.deptId])

      // The grant is reviewable: who changed what, why, and the effective sets either side.
      const trail = await waitForRows(
        pg,
        `SELECT event, severity, details FROM public.admin_audit_event
          WHERE path = $1 AND method = 'PUT' AND status = 200
          ORDER BY occurred_at DESC LIMIT 1`,
        [`/api/finance/users/${temp.id}/access`],
      )
      expect(trail).toHaveLength(1)
      expect(trail[0].event).toBe('FIN_PERMISSION')
      expect(trail[0].severity).toBe('high')
      expect(trail[0].details.reason).toMatch(/Appointed as finance officer/)
      expect(trail[0].details.before.role).toBe('planner')
      expect(trail[0].details.after.role).toBe('finance_officer')
      expect(trail[0].details.after.permissions).toContain('finance.audit.export')
      // The person's email is not copied into the trail; the change is what matters.
      expect(JSON.stringify(trail[0].details)).not.toContain(email)

      // A deny override is a real removal, not a hidden checkbox.
      const denied = await app.inject({
        method: 'PUT', url: `/api/finance/users/${temp.id}/access`, headers: auth(as.technicalAdmin),
        payload: {
          overrides: [{ permission_code: 'finance.budget.view', effect: 'deny', reason: 'Conflict of interest' }],
          reason: 'Conflict of interest declared',
        },
      })
      expect(denied.statusCode).toBe(200)
      expect(denied.json().data.permissions).not.toContain('finance.budget.view')

      const unknown = await app.inject({
        method: 'PUT', url: `/api/finance/users/${temp.id}/access`, headers: auth(as.technicalAdmin),
        payload: { overrides: [{ permission_code: 'finance.not.a.permission', effect: 'grant' }], reason: 'x' },
      })
      expect(unknown.statusCode).toBe(400)
      expect(unknown.json().error).toBe('unknown_permission')

      const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(as.technicalAdmin) })
      const own = await app.inject({
        method: 'PUT', url: `/api/finance/users/${me.json().data.user_id}/access`,
        headers: auth(as.technicalAdmin),
        payload: { reason: 'no' },
      })
      expect(own.statusCode).toBe(409)
      expect(own.json().error).toBe('self_access')
    } finally {
      await pg.query('DELETE FROM public.users WHERE id = $1', [temp.id])
    }
  })

  /**
   * This assertion used to be made on the CATALOGUE alone, and the catalogue was telling the
   * truth: `auditor` holds no permission whose name ends in a writing verb. What the catalogue
   * could not see was that DELETE /finance/documents/:id was guarded by finance.document.view —
   * a READ permission the auditor holds — so the read-only role could withdraw the invoice
   * supporting a posted transaction (audit BLOCKER-3). The test now walks the mutating verbs
   * rather than trusting the permission names, which is the property the claim was always about.
   */
  test('an auditor holds no write permission at all, and every mutating finance route refuses it', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(as.auditor) })
    const permissions = me.json().data.permissions
    const writeLike = permissions.filter((p) =>
      /\.(prepare|submit|approve|publish|withdraw|manage|commit|upload|resolve|explain|close|delete)$/.test(p))
    expect(writeLike).toEqual([])
    expect(permissions).toContain('finance.audit.view')
    expect(permissions).toContain('finance.transaction.view_counterparty')

    // Walked, not assumed: one mutating request per finance subject area, each of which must be
    // refused for want of a permission (403), never attempted. A 404 would mean the guard let the
    // auditor through and the handler merely failed to find the row — which is exactly what
    // DELETE /finance/documents/:id used to do, so the ids below are deliberately arbitrary:
    // the refusal must come from the preHandler, before the record is looked up.
    const anyId = crypto.randomUUID()
    const attempts = [
      { method: 'POST', url: '/api/finance/financial-years', payload: { label: 'AUDITOR TRY', start_date: '2040-01-01', end_date: '2040-12-31', reporting_currency: 'USD' } },
      { method: 'POST', url: '/api/finance/departments', payload: { code: 'AUDITOR-TRY', name: 'Auditor try' } },
      { method: 'POST', url: '/api/finance/budget-lines', payload: { financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountExpId, code: 'AUDITOR-TRY', description: 'x', currency: 'USD', original_amount: '1.00' } },
      { method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/submit`, payload: {} },
      { method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/approve`, payload: {} },
      { method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/revisions`, payload: { amount_delta: '1.00', currency: 'USD', reason: 'auditor attempt at a revision' } },
      { method: 'POST', url: '/api/finance/projects', payload: { reference: 'AUDITOR-TRY', name: 'Auditor try', currency: 'USD' } },
      { method: 'POST', url: '/api/finance/publications', payload: { financial_year_id: made.yearId, dataset: 'budget' } },
      { method: 'DELETE', url: `/api/finance/documents/${anyId}`, payload: { reason: 'auditor attempt at a withdrawal' } },
      { method: 'POST', url: '/api/finance/spatial-allocations', payload: { subject_kind: 'budget_line', subject_id: made.lineId || anyId, target_code: 'AUDITOR-TRY', amount: '1.00', methodology: 'auditor attempt at a spatial split' } },
    ]
    for (const attempt of attempts) {
      const res = await app.inject({ ...attempt, headers: auth(as.auditor) })
      expect({ url: attempt.url, status: res.statusCode }).toEqual({ url: attempt.url, status: 403 })
    }
  })

  // ── Budget and its approval ────────────────────────────────────────────────────────────────────
  test('a budget line is prepared, submitted and approved by someone else', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountExpId,
        code: `${TAG}-L1`, description: 'Roads maintenance — Engineering',
        currency: 'USD', original_amount: '100000.00',
      },
    })
    expect(created.statusCode).toBe(201)
    made.lineId = created.json().data.id
    expect(created.json().data.status).toBe('draft')

    // A revenue budget line too, so the revenue side of the portal has something to show.
    const revenueLine = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountRevId,
        code: `${TAG}-L2`, description: 'Rates and charges', currency: 'USD', original_amount: '250000.00',
      },
    })
    expect(revenueLine.statusCode).toBe(201)
    made.line2Id = revenueLine.json().data.id

    // A heading account cannot carry a budget.
    const heading = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.deptId,
        account_id: (await app.inject({ method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin) }))
          .json().data.find((a) => a.code === `${TAG}-5900`).id,
        code: `${TAG}-LH`, description: 'Against a heading', currency: 'USD', original_amount: '1.00',
      },
    })
    expect(heading.statusCode).toBe(400)
    expect(heading.json().error).toBe('account_not_postable')

    // A finance administrator prepares and submits but holds no approval permission.
    for (const id of [made.lineId, made.line2Id]) {
      const submitted = await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/submit`, headers: auth(as.financeAdmin),
      })
      expect(submitted.statusCode).toBe(200)
      expect(submitted.json().data.status).toBe('submitted')
    }
    const selfApprove = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${made.lineId}/approve`, headers: auth(as.financeAdmin),
    })
    expect(selfApprove.statusCode).toBe(403)
    expect(selfApprove.json().required_permission).toBe('finance.budget.approve')

    for (const id of [made.lineId, made.line2Id]) {
      const approved = await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/approve`, headers: auth(as.committee),
      })
      expect(approved.statusCode).toBe(200)
      expect(approved.json().data.status).toBe('approved')
      expect(approved.json().data.approved_by).toBeTruthy()
    }
  })

  test('an approved allocation can no longer be edited in place', async () => {
    const edit = await app.inject({
      method: 'PATCH', url: `/api/finance/budget-lines/${made.lineId}`, headers: auth(as.financeAdmin),
      payload: { original_amount: '999999.00' },
    })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error).toBe('not_editable')
    expect(edit.json().next_step).toMatch(/revisions$/)
  })

  test('A4: an approved revision changes the revised budget and leaves the original visible', async () => {
    const before = await app.inject({
      method: 'GET', url: `/api/finance/budget-lines/${made.lineId}`, headers: auth(as.financeAdmin),
    })
    expect(before.json().data.line.original_amount).toBe('100000.00')
    expect(before.json().data.line.revised_amount).toBe('100000.00')

    const revision = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/revisions`, headers: auth(as.budgetOfficer),
      payload: { amount_delta: '25000.00', reason: 'Supplementary allocation for storm damage repairs', effective_date: '2031-06-30' },
    })
    expect(revision.statusCode).toBe(201)
    made.revisionId = revision.json().data.id
    expect(revision.json().data.state).toBe('draft')
    expect(revision.json().data.revision_no).toBe(1)

    const submitted = await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${made.revisionId}/submit`, headers: auth(as.budgetOfficer),
    })
    expect(submitted.statusCode).toBe(200)

    const approved = await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${made.revisionId}/approve`, headers: auth(as.committee),
      payload: { note: 'Approved by Finance Committee' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.state).toBe('approved')

    const after = await app.inject({
      method: 'GET', url: `/api/finance/budget-lines/${made.lineId}`, headers: auth(as.financeAdmin),
    })
    const line = after.json().data.line
    // Both figures, side by side, for the life of the record.
    expect(line.original_amount).toBe('100000.00')
    expect(line.approved_adjustments).toBe('25000.00')
    expect(line.revised_amount).toBe('125000.00')
    expect(after.json().data.revisions).toHaveLength(1)
    expect(after.json().data.revisions[0].reason).toMatch(/storm damage/)
  })

  test('A6: the person who requested a revision cannot approve it, even holding both permissions', async () => {
    // No seeded role both prepares and approves, so the rule cannot be reached by role alone —
    // which is the first line of defence working. To test the SECOND line, one person is given
    // both permissions deliberately, through the per-user override table. That is also what a
    // council would do if it decided one officer should be able to raise a revision as well as
    // approve others' — and the rule must still hold for them.
    const { rows: who } = await systemOf(app.pg).query(
      "SELECT id FROM public.users WHERE email = 'demo.treasurer@vungu.test'",
    )
    await systemOf(app.pg).query(
      `INSERT INTO finance.user_permission_override
         (user_id, permission_code, effect, authority_id, reason, granted_by)
       VALUES ($1, 'finance.revision.prepare', 'grant', 1, 'Acceptance test: hold both permissions', $1),
              ($1, 'finance.revision.submit',  'grant', 1, 'Acceptance test: hold both permissions', $1)
       ON CONFLICT (user_id, permission_code) DO NOTHING`, [who[0].id],
    )
    try {
      const token = await loginAs(app, 'demo.treasurer@vungu.test', PASSWORD)
      const both = { authorization: `Bearer ${token}` }

      // The override took effect: this person now prepares as well as approves.
      const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: both })
      expect(me.json().data.permissions).toContain('finance.revision.prepare')
      expect(me.json().data.permissions).toContain('finance.revision.approve')

      const revision = await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/revisions`, headers: both,
        payload: { amount_delta: '-5000.00', reason: 'Reduction following reprioritisation of works' },
      })
      expect(revision.statusCode).toBe(201)
      const id = revision.json().data.id
      const submitted = await app.inject({
        method: 'POST', url: `/api/finance/budget-revisions/${id}/submit`, headers: both,
      })
      expect(submitted.statusCode).toBe(200)

      // Holding finance.revision.approve is not enough: this is their own request.
      const self = await app.inject({
        method: 'POST', url: `/api/finance/budget-revisions/${id}/approve`, headers: both, payload: {},
      })
      expect(self.statusCode).toBe(403)
      expect(self.json().error).toBe('self_approval')

      // And the database refuses it independently of the route, so a path that goes round the API
      // gains nothing.
      await expect(systemOf(app.pg).query(
        `UPDATE finance.budget_revision
            SET state = 'approved', decided_by = requested_by, decided_at = now() WHERE id = $1`, [id],
      )).rejects.toThrow(/requester_is_not_approver/)

      const rejected = await app.inject({
        method: 'POST', url: `/api/finance/budget-revisions/${id}/reject`, headers: both,
        payload: { note: 'Withdrawn by the requester; raised in error.' },
      })
      expect(rejected.statusCode).toBe(200)
      // A rejected revision is kept, not deleted.
      expect(rejected.json().data.state).toBe('rejected')

      // A `deny` override beats the role's default grant, which is how least privilege is applied
      // to one person without inventing a role for them.
      await systemOf(app.pg).query(
        `INSERT INTO finance.user_permission_override
           (user_id, permission_code, effect, authority_id, reason, granted_by)
         VALUES ($1, 'finance.revision.approve', 'deny', 1, 'Acceptance test: deny wins', $1)
         ON CONFLICT (user_id, permission_code) DO UPDATE SET effect = 'deny'`, [who[0].id],
      )
      const denied = await app.inject({
        method: 'GET', url: '/api/finance/me',
        headers: { authorization: `Bearer ${await loginAs(app, 'demo.treasurer@vungu.test', PASSWORD)}` },
      })
      expect(denied.json().data.permissions).not.toContain('finance.revision.approve')
    } finally {
      await systemOf(app.pg).query(
        'DELETE FROM finance.user_permission_override WHERE user_id = $1', [who[0].id],
      )
    }
  })

  test('a reduction cannot take the revised allocation below zero', async () => {
    const tooBig = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${made.lineId || anyId}/revisions`, headers: auth(as.budgetOfficer),
      payload: { amount_delta: '-500000.00', reason: 'An impossible reduction, for the avoidance of doubt' },
    })
    expect(tooBig.statusCode).toBe(400)
    expect(tooBig.json().error).toBe('revision_below_zero')
  })

  // ── Import ─────────────────────────────────────────────────────────────────────────────────────
  const uploadCsv = async (token, { csv, dataset = 'actuals', key, count, total, currency = 'USD' }) => {
    const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
    const parts = [
      ['dataset', dataset], ['financial_year_id', made.yearId], ['idempotency_key', key],
    ]
    if (count !== undefined) parts.push(['declared_control_count', String(count)])
    if (total !== undefined) parts.push(['declared_control_total', total], ['declared_control_currency', currency])
    const body = [
      ...parts.map(([n, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${dataset}.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')
    return app.inject({
      method: 'POST', url: '/api/finance/imports',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
  }

  const GOOD_CSV = [
    'Vote,GL Code,Date,Amount,Currency,Narration,Voucher No,Source Ref,Supplier Name',
    `${TAG}-ENG,${TAG}-5100,15/02/2031,10000.00,USD,Grader hire February,V-001,SRC-A-${TAG},Midlands Plant Hire`,
    `${TAG}-ENG,${TAG}-5100,20/03/2031,"5,500.50",USD,Culvert repairs,V-002,SRC-B-${TAG},Gweru Builders`,
    `${TAG}-ENG,${TAG}-1100,31/03/2031,80000.00,USD,Rates collected Q1,R-001,SRC-C-${TAG},`,
  ].join('\n')

  test('A2 and A3: malformed rows become row-level exceptions and the batch reconciles to the declared totals', async () => {
    const csv = [
      'Vote,GL Code,Date,Amount,Currency,Narration,Voucher No,Source Ref',
      // valid
      `${TAG}-ENG,${TAG}-5100,15/02/2031,1000.00,USD,Valid row,V-100,SRC-OK-${TAG}`,
      // unknown account code
      `${TAG}-ENG,${TAG}-9999,15/02/2031,1000.00,USD,Unknown account,V-101,SRC-X1-${TAG}`,
      // impossible date
      `${TAG}-ENG,${TAG}-5100,31/02/2031,1000.00,USD,Bad date,V-102,SRC-X2-${TAG}`,
      // amount that is not a number
      `${TAG}-ENG,${TAG}-5100,15/02/2031,n/a,USD,Bad amount,V-103,SRC-X3-${TAG}`,
      // unknown department
      `${TAG}-ZZZ,${TAG}-5100,15/02/2031,1000.00,USD,Unknown vote,V-104,SRC-X4-${TAG}`,
      // date outside the financial year
      `${TAG}-ENG,${TAG}-5100,15/02/2030,1000.00,USD,Out of year,V-105,SRC-X5-${TAG}`,
      // currency this system does not store
      `${TAG}-ENG,${TAG}-5100,15/02/2031,1000.00,ZAR,Foreign currency,V-106,SRC-X6-${TAG}`,
    ].join('\n')

    const uploaded = await uploadCsv(as.financeOfficer, {
      csv, key: `${TAG}-errors`, count: 1, total: '1000.00',
    })
    expect(uploaded.statusCode).toBe(201)
    const batchId = uploaded.json().data.batch.id
    // The preserved file's hash is recorded at upload.
    expect(uploaded.json().data.batch.file_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(uploaded.json().data.mapping.missing_required).toEqual([])

    const validated = await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/validate`, headers: auth(as.financeOfficer),
      payload: {},
    })
    expect(validated.statusCode).toBe(200)
    const result = validated.json().data
    expect(result.counts.valid).toBe(1)
    expect(result.counts.rejected).toBe(6)
    // One batch, not one failure: every bad row is reported with its own reason.
    const codes = result.exception_summary.map((e) => e.error_code)
    expect(codes).toContain('UNKNOWN_ACCOUNT_CODE')
    expect(codes).toContain('INVALID_DATE')
    expect(codes).toContain('INVALID_AMOUNT')
    expect(codes).toContain('UNKNOWN_DEPARTMENT_CODE')
    expect(codes).toContain('DATE_OUTSIDE_FINANCIAL_YEAR')
    expect(codes).toContain('UNSUPPORTED_CURRENCY')
    // The one valid row matches the declared control total.
    expect(result.reconciliation.status).toBe('matched')

    // The exceptions are addressable one by one, and each names its field.
    const exceptions = await app.inject({
      method: 'GET', url: `/api/finance/imports/${batchId}/exceptions`, headers: auth(as.financeOfficer),
    })
    expect(exceptions.statusCode).toBe(200)
    const rows = exceptions.json().data
    expect(rows.length).toBeGreaterThanOrEqual(6)
    expect(rows.every((r) => r.row_number >= 2)).toBe(true) // row 1 is the header
    expect(rows.every((r) => typeof r.message === 'string' && r.message.length > 0)).toBe(true)

    const resolved = await app.inject({
      method: 'PATCH', url: `/api/finance/imports/${batchId}/exceptions/${rows[0].id}`,
      headers: auth(as.financeOfficer),
      payload: { resolution: 'corrected_at_source', note: 'Finance to re-export with the correct code.' },
    })
    expect(resolved.statusCode).toBe(200)
    expect(resolved.json().data.resolution).toBe('corrected_at_source')

    await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/cancel`, headers: auth(as.financeOfficer),
      payload: { reason: 'Superseded by a corrected export.' },
    })
  })

  test('a mismatched control total blocks the commit until it is explicitly overridden', async () => {
    const uploaded = await uploadCsv(as.financeOfficer, {
      csv: GOOD_CSV, key: `${TAG}-mismatch`, count: 3, total: '99999.00',
    })
    const batchId = uploaded.json().data.batch.id
    const validated = await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/validate`, headers: auth(as.financeOfficer), payload: {},
    })
    expect(validated.json().data.reconciliation.status).toBe('mismatched')
    expect(validated.json().data.reconciliation.notes.join(' ')).toMatch(/declared 99999.00/)

    const blocked = await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/commit`, headers: auth(as.financeAdmin), payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('not_reconciled')

    const noReason = await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/commit`, headers: auth(as.financeAdmin),
      payload: { override_reconciliation: true },
    })
    expect(noReason.statusCode).toBe(400)
    expect(noReason.json().error).toBe('override_reason_required')

    await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/cancel`, headers: auth(as.financeOfficer),
      payload: { reason: 'Control totals to be reconfirmed with Finance.' },
    })
  })

  test('the officer who uploads cannot commit; the administrator who commits cannot upload blind', async () => {
    const uploaded = await uploadCsv(as.financeOfficer, {
      csv: GOOD_CSV, key: `${TAG}-main`, count: 3, total: '95500.50',
    })
    expect(uploaded.statusCode).toBe(201)
    made.batchId = uploaded.json().data.batch.id

    const validated = await app.inject({
      method: 'POST', url: `/api/finance/imports/${made.batchId}/validate`,
      headers: auth(as.financeOfficer), payload: {},
    })
    expect(validated.statusCode).toBe(200)
    expect(validated.json().data.counts).toEqual({ total: 3, valid: 3, rejected: 0, duplicates: 0 })
    expect(validated.json().data.reconciliation.status).toBe('matched')

    // §3.8: an authorised review stands between validation and the register.
    const officerCommit = await app.inject({
      method: 'POST', url: `/api/finance/imports/${made.batchId}/commit`,
      headers: auth(as.financeOfficer), payload: {},
    })
    expect(officerCommit.statusCode).toBe(403)
    expect(officerCommit.json().required_permission).toBe('finance.import.commit')

    const committed = await app.inject({
      method: 'POST', url: `/api/finance/imports/${made.batchId}/commit`,
      headers: auth(as.financeAdmin), payload: {},
    })
    expect(committed.statusCode).toBe(200)
    expect(committed.json().data.written).toBe(3)
    expect(committed.json().data.skipped_as_duplicate).toBe(0)
    expect(committed.json().data.batch.status).toBe('committed')
  })

  test('A1: the same file cannot be committed twice, and a retried commit is the same commit', async () => {
    // A repeated commit of the same batch returns the first commit's result rather than writing again.
    const again = await app.inject({
      method: 'POST', url: `/api/finance/imports/${made.batchId}/commit`,
      headers: auth(as.financeAdmin), payload: {},
    })
    expect(again.statusCode).toBe(200)
    expect(again.json().data.already_committed).toBe(true)

    // The same bytes uploaded again for the same year and dataset are refused, with the batch that
    // already carried them named.
    const reupload = await uploadCsv(as.financeOfficer, {
      csv: GOOD_CSV, key: `${TAG}-dup-attempt`, count: 3, total: '95500.50',
    })
    expect(reupload.statusCode).toBe(409)
    expect(reupload.json().error).toBe('already_committed')
    expect(reupload.json().existing_batch_id).toBe(made.batchId)

    // A retried UPLOAD carrying the same idempotency key is the same upload, not a second one.
    const retried = await uploadCsv(as.financeOfficer, {
      csv: `${GOOD_CSV}\n`, key: `${TAG}-main`, count: 3, total: '95500.50',
    })
    expect(retried.statusCode).toBe(200)
    expect(retried.json().data.already_existed).toBe(true)
    expect(retried.json().data.batch.id).toBe(made.batchId)

    // And a genuinely different file whose rows carry source references already in the register
    // skips those rows rather than double-posting them.
    const overlapping = [
      'Vote,GL Code,Date,Amount,Currency,Narration,Voucher No,Source Ref',
      `${TAG}-ENG,${TAG}-5100,15/02/2031,10000.00,USD,Grader hire February,V-001,SRC-A-${TAG}`,
      `${TAG}-ENG,${TAG}-5100,01/04/2031,2000.00,USD,New row,V-003,SRC-D-${TAG}`,
    ].join('\n')
    const second = await uploadCsv(as.financeOfficer, {
      csv: overlapping, key: `${TAG}-overlap`, count: 1, total: '2000.00',
    })
    expect(second.statusCode).toBe(201)
    const secondId = second.json().data.batch.id
    const secondValidated = await app.inject({
      method: 'POST', url: `/api/finance/imports/${secondId}/validate`,
      headers: auth(as.financeOfficer), payload: {},
    })
    expect(secondValidated.json().data.counts.duplicates).toBe(1)
    expect(secondValidated.json().data.exception_summary.map((e) => e.error_code))
      .toContain('ALREADY_IN_REGISTER')
    expect(secondValidated.json().data.reconciliation.status).toBe('matched')

    const secondCommit = await app.inject({
      method: 'POST', url: `/api/finance/imports/${secondId}/commit`,
      headers: auth(as.financeAdmin), payload: {},
    })
    expect(secondCommit.json().data.written).toBe(1)

    // Four transactions in all, not five: the duplicate never became a second posting.
    const { rows } = await systemOf(app.pg).query(
      `SELECT count(*)::int AS n FROM finance.transaction
        WHERE financial_year_id = $1 AND source_ref LIKE 'SRC-%${TAG}'`, [made.yearId],
    )
    expect(rows[0].n).toBe(4)
  })

  test('A3: the reconciliation statement shows declared, file and posted figures separately', async () => {
    const recon = await app.inject({
      method: 'GET', url: `/api/finance/imports/${made.batchId}/reconciliation`, headers: auth(as.auditor),
    })
    expect(recon.statusCode).toBe(200)
    const r = recon.json().data
    expect(r.declared_by_council).toEqual({ count: 3, total: '95500.50', currency: 'USD' })
    expect(r.yielded_by_file).toEqual({ count: 3, total: '95500.50' })
    expect(r.posted_to_register).toEqual([{ currency: 'USD', rows: 3, total: '95500.50' }])
    expect(r.source_file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.reconciliation_status).toBe('matched')
  })

  test('A8: amounts in different currencies are kept apart, not aggregated', async () => {
    // A ZWG transaction posted against a USD budget line. It is stored, and it is excluded from
    // that line's totals and counted as a fault — never converted and never added in.
    const zwg = [
      'Vote,GL Code,Date,Amount,Currency,Narration,Source Ref',
      `${TAG}-ENG,${TAG}-5100,01/05/2031,750000.00,ZWG,Local purchase in ZWG,SRC-Z-${TAG}`,
    ].join('\n')
    const uploaded = await uploadCsv(as.financeOfficer, {
      csv: zwg, key: `${TAG}-zwg`, count: 1, total: '750000.00', currency: 'ZWG',
    })
    expect(uploaded.statusCode).toBe(201)
    const batchId = uploaded.json().data.batch.id
    await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/validate`, headers: auth(as.financeOfficer), payload: {},
    })
    const committed = await app.inject({
      method: 'POST', url: `/api/finance/imports/${batchId}/commit`, headers: auth(as.financeAdmin), payload: {},
    })
    expect(committed.json().data.written).toBe(1)

    const line = await app.inject({
      method: 'GET', url: `/api/finance/budget-lines/${made.lineId}`, headers: auth(as.financeAdmin),
    })
    const perf = line.json().data.line
    // The USD postings against this line: 10000.00 and 5500.50 from the main batch, plus the
    // 2000.00 that the overlapping batch contributed. The 750000 ZWG is nowhere in this figure.
    expect(perf.actual_amount).toBe('17500.50')
    expect(perf.currency).toBe('USD')
    expect(perf.actual_currency_mismatch_rows).toBe(1)

    // The department roll-up gives one row per currency, and no combined total exists.
    const performance = await app.inject({
      method: 'GET', url: `/api/finance/performance?financial_year_id=${made.yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(performance.statusCode).toBe(200)
    const body = performance.json().data
    expect(body.rows.every((r) => typeof r.currency === 'string')).toBe(true)
    expect(body).not.toHaveProperty('grand_total')
    expect(body.available_balance_includes_commitments).toBe(false)

    // The exception report surfaces the currency fault rather than burying it.
    const exceptions = await app.inject({
      method: 'GET', url: `/api/finance/exceptions/budget?financial_year_id=${made.yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(exceptions.json().data.rows.some((r) => r.flag === 'currency_mismatch')).toBe(true)
  })

  // ── Projects and the planning integration ──────────────────────────────────────────────────────
  test('A10: a project traces from allocation through revisions to actual spend', async () => {
    // An existing planning application, so the link points at a real record.
    const { rows: applications } = await systemOf(app.pg).query(
      'SELECT id FROM public.development_applications ORDER BY created_at DESC LIMIT 1',
    )
    const linked = applications[0]
      ? { linked_subject_kind: 'development_application', linked_subject_id: String(applications[0].id) }
      : {}

    const created = await app.inject({
      method: 'POST', url: '/api/finance/projects', headers: auth(as.financeOfficer),
      payload: {
        reference: `${TAG}-P1`, name: 'Tsamba access road rehabilitation',
        description: 'Regravelling and culvert replacement', department_id: made.deptId,
        currency: 'USD', approved_budget: '40000.00',
        longitude: 29.8, latitude: -19.45, ...linked,
      },
    })
    expect(created.statusCode).toBe(201)
    made.projectId = created.json().data.project.id

    // A link that points at nothing is refused: a trace that looks complete and is not is worse
    // than no trace.
    const dangling = await app.inject({
      method: 'POST', url: '/api/finance/projects', headers: auth(as.financeOfficer),
      payload: {
        reference: `${TAG}-P9`, name: 'Points at nothing', currency: 'USD',
        linked_subject_kind: 'development_application',
        linked_subject_id: '00000000-0000-0000-0000-000000000000',
      },
    })
    expect(dangling.statusCode).toBe(400)
    expect(dangling.json().error).toBe('linked_record_not_found')

    // Approval is someone else's act.
    await app.inject({ method: 'POST', url: `/api/finance/projects/${made.projectId}/submit`, headers: auth(as.financeOfficer) })
    const selfApprove = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/approve`, headers: auth(as.financeOfficer),
    })
    expect(selfApprove.statusCode).toBe(403)
    const approved = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/approve`, headers: auth(as.committee),
    })
    expect(approved.statusCode).toBe(200)

    const allocation = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/allocations`, headers: auth(as.financeOfficer),
      payload: { budget_line_id: made.lineId, amount: '40000.00', note: 'Original allocation' },
    })
    expect(allocation.statusCode).toBe(201)

    // An allocation cannot exceed the line's headroom.
    const tooMuch = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/allocations`, headers: auth(as.financeOfficer),
      payload: { budget_line_id: made.lineId, amount: '200000.00', allocation_type: 'revision', budget_revision_id: made.revisionId },
    })
    expect(tooMuch.statusCode).toBe(409)
    expect(tooMuch.json().error).toBe('exceeds_budget_line')

    // Associate a committed transaction with the project.
    const { rows: txns } = await systemOf(app.pg).query(
      `SELECT id FROM finance.transaction WHERE source_ref = $1`, [`SRC-A-${TAG}`],
    )
    const associated = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/transactions`, headers: auth(as.financeOfficer),
      payload: { transaction_id: txns[0].id },
    })
    expect(associated.statusCode).toBe(201)

    const trace = await app.inject({
      method: 'GET', url: `/api/finance/projects/${made.projectId}`, headers: auth(as.financeOfficer),
    })
    expect(trace.statusCode).toBe(200)
    const t = trace.json().data
    expect(t.project.allocated_total).toBe('40000.00')
    expect(t.project.actual_spend).toBe('10000.00')
    expect(t.project.execution_percentage).toBe('25.00')
    expect(t.allocations).toHaveLength(1)
    // The revision that moved the funding line is part of the trace.
    expect(t.revisions.some((r) => r.id === made.revisionId)).toBe(true)
    expect(t.transactions).toHaveLength(1)
    expect(t.counterparty_visible).toBe(true)
    expect(t.transactions[0].counterparty_name).toBe('Midlands Plant Hire')

    if (applications[0]) {
      // A planner, who holds no finance permission beyond viewing, can follow the money from the
      // application they are already looking at.
      const fromPlanning = await app.inject({
        method: 'GET',
        url: `/api/finance/linked/development_application/${applications[0].id}`,
        headers: auth(as.planner),
      })
      expect(fromPlanning.statusCode).toBe(200)
      expect(fromPlanning.json().data.projects.some((p) => p.project_id === made.projectId)).toBe(true)
      // And sees no supplier identity, because a planner does not hold that permission.
      expect(fromPlanning.json().data.counterparty_visible).toBe(false)
      expect(fromPlanning.json().data.recent_transactions[0]).not.toHaveProperty('counterparty_name')
    }
  })

  // ── Publication and the public surface ─────────────────────────────────────────────────────────
  test('nothing is public before it is published', async () => {
    const years = await app.inject({ method: 'GET', url: '/api/public/finance/years' })
    expect(years.statusCode).toBe(200)
    expect(years.json().data.some((y) => y.id === made.yearId)).toBe(false)

    const transactions = await app.inject({
      method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${made.yearId}`,
    })
    expect(transactions.statusCode).toBe(200)
    expect(transactions.json().data.total).toBe(0)
  })

  test('A7: a publisher cannot approve, an approver cannot publish, and the refusal is audited', async () => {
    const requested = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, dataset: 'budget',
        reporting_period_label: `${TAG} 2031 full year`, data_as_at: '2031-12-31',
      },
    })
    expect(requested.statusCode).toBe(201)
    made.publicationBudget = requested.json().data.id
    expect(requested.json().data.state).toBe('pending')
    expect(requested.json().data.version).toBe(1)

    // A publisher holds no approval permission.
    const publisherApproves = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/approve`,
      headers: auth(as.publisher), payload: {},
    })
    expect(publisherApproves.statusCode).toBe(403)
    expect(publisherApproves.json().required_permission).toBe('finance.publication.approve')

    // The technical administrator holds neither — the specification's third critical scenario.
    const adminPublishes = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/publish`,
      headers: auth(as.technicalAdmin),
    })
    expect(adminPublishes.statusCode).toBe(403)

    // Both refusals are in the audit trail, with their status. Scope the query to this
    // publication: other suites in the same run also record publication refusals, and a global
    // "last 5" query would let their rows push this test's rows out.
    const auditPaths = [
      `/api/finance/publications/${made.publicationBudget}/approve`,
      `/api/finance/publications/${made.publicationBudget}/publish`,
    ]
    let audit = []
    for (let attempt = 0; attempt < 20 && audit.length < 2; attempt += 1) {
      ({ rows: audit } = await systemOf(app.pg).query(
        `SELECT actor_role, status, event FROM public.admin_audit_event
          WHERE path = ANY($1::text[]) AND status = 403
          ORDER BY occurred_at DESC`,
        [auditPaths],
      ))
      if (audit.length < 2) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(audit.length).toBeGreaterThanOrEqual(2)
    expect(audit.map((a) => a.actor_role)).toContain('publisher')
    expect(audit.map((a) => a.actor_role)).toContain('admin')
    expect(audit.every((a) => a.event === 'FIN_PUBLICATION')).toBe(true)

    // The committee approves and then cannot publish its own approval.
    const approved = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/approve`,
      headers: auth(as.committee), payload: { note: 'Approved for public release' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.state).toBe('approved')

    const committeePublishes = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/publish`,
      headers: auth(as.committee),
    })
    expect(committeePublishes.statusCode).toBe(403)
    expect(committeePublishes.json().required_permission).toBe('finance.publication.publish')
  })

  test('a published budget reaches the public portal, with its original and revised figures', async () => {
    const published = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/publish`,
      headers: auth(as.publisher),
    })
    expect(published.statusCode).toBe(200)
    expect(published.json().data.publication.state).toBe('published')
    expect(published.json().data.publication.approved_by).toBeTruthy()
    expect(published.json().data.publication.published_by).toBeTruthy()

    // The year appears, but the budget lines do not until they are marked published — releasing a
    // year's budget does not sweep up drafts.
    const beforeMarking = await app.inject({
      method: 'GET', url: `/api/public/finance/budget?financial_year_id=${made.yearId}`,
    })
    expect(beforeMarking.json().data.total).toBe(0)

    const marked = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationBudget}/mark-budget-lines`,
      headers: auth(as.publisher), payload: {},
    })
    expect(marked.statusCode).toBe(200)
    expect(marked.json().data.marked).toBeGreaterThanOrEqual(2)

    const budget = await app.inject({
      method: 'GET', url: `/api/public/finance/budget?financial_year_id=${made.yearId}`,
    })
    expect(budget.statusCode).toBe(200)
    const line = budget.json().data.lines.find((l) => l.code === `${TAG}-L1`)
    expect(line).toBeTruthy()
    // Both figures are public, as §3.3 requires them to remain.
    expect(line.original_amount).toBe('100000.00')
    expect(line.revised_amount).toBe('125000.00')
    expect(line.approved_adjustments).toBe('25000.00')

    const years = await app.inject({ method: 'GET', url: '/api/public/finance/years' })
    const year = years.json().data.find((y) => y.id === made.yearId)
    expect(year).toBeTruthy()
    expect(year.published_datasets).toContain('budget')
  })

  test('A7: published transactions carry no supplier identity, and the overview states its currency rule', async () => {
    for (const dataset of ['expenditure', 'revenue']) {
      const created = await app.inject({
        method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
        payload: { financial_year_id: made.yearId, dataset, reporting_period_label: `${TAG} 2031`, data_as_at: '2031-12-31' },
      })
      const id = created.json().data.id
      if (dataset === 'expenditure') made.publicationExp = id
      await app.inject({
        method: 'POST', url: `/api/finance/publications/${id}/approve`, headers: auth(as.committee), payload: {},
      })
      const published = await app.inject({
        method: 'POST', url: `/api/finance/publications/${id}/publish`, headers: auth(as.publisher),
      })
      expect(published.statusCode).toBe(200)
    }

    const transactions = await app.inject({
      method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${made.yearId}&kind=expenditure`,
    })
    expect(transactions.statusCode).toBe(200)
    const rows = transactions.json().data.transactions
    expect(rows.length).toBeGreaterThan(0)
    // Not blank — absent. A client cannot render an empty supplier name as a fact.
    for (const row of rows) {
      expect(row).not.toHaveProperty('counterparty_name')
      expect(row).not.toHaveProperty('counterparty_ref')
      expect(row).not.toHaveProperty('source_ref')
      expect(row).not.toHaveProperty('import_batch_id')
    }
    expect(JSON.stringify(rows)).not.toMatch(/Midlands Plant Hire|Gweru Builders/)

    const overview = await app.inject({
      method: 'GET', url: `/api/public/finance/overview?financial_year_id=${made.yearId}`,
    })
    expect(overview.statusCode).toBe(200)
    const o = overview.json().data
    expect(o.definitions.currency).toMatch(/never added together/)
    // One summary block per currency, no combined total.
    expect(o.summary.map((s) => s.currency).sort()).toEqual(['USD', 'ZWG'])
    expect(o).not.toHaveProperty('total')
    expect(o.published.budget.published_at).toBeTruthy()
    expect(o.published.expenditure.reporting_period_label).toContain(TAG)
  })

  test('withdrawing a publication removes the data from the public portal and changes no record', async () => {
    const { rows: before } = await systemOf(app.pg).query(
      `SELECT count(*)::int AS n FROM finance.transaction WHERE financial_year_id = $1`, [made.yearId],
    )
    const withdrawn = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.publicationExp}/withdraw`,
      headers: auth(as.publisher), payload: { reason: 'Figures to be restated following a reconciliation query.' },
    })
    expect(withdrawn.statusCode).toBe(200)

    const transactions = await app.inject({
      method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${made.yearId}&kind=expenditure`,
    })
    expect(transactions.json().data.total).toBe(0)

    const { rows: after } = await systemOf(app.pg).query(
      `SELECT count(*)::int AS n FROM finance.transaction WHERE financial_year_id = $1`, [made.yearId],
    )
    expect(after[0].n).toBe(before[0].n)

    // The withdrawn version stays on record.
    const queue = await app.inject({
      method: 'GET', url: `/api/finance/publications?financial_year_id=${made.yearId}`, headers: auth(as.auditor),
    })
    const row = queue.json().data.find((p) => p.id === made.publicationExp)
    expect(row.state).toBe('withdrawn')
    expect(row.withdraw_reason).toMatch(/restated/)
  })

  // ── Public project reporting correctness (F-03 / F-04) ────────────────────────────────────────
  test('F-03 and F-04: public projects follow the selected year and report other currencies separately', async () => {
    const pg = systemOf(app.pg)

    // A second reporting year, with a project whose only financial activity is in that year.
    const year2 = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} 2032`, start_date: '2032-01-01', end_date: '2032-12-31', reporting_currency: 'USD' },
    })
    expect(year2.statusCode).toBe(201)
    const year2Id = year2.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${year2Id}/open`, headers: auth(as.financeAdmin),
    })

    const line3 = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: year2Id, department_id: made.deptId, account_id: made.accountExpId,
        code: `${TAG}-L3`, description: 'Roads maintenance — 2032', currency: 'USD',
        original_amount: '50000.00',
      },
    })
    expect(line3.statusCode).toBe(201)
    const line3Id = line3.json().data.id
    await app.inject({ method: 'POST', url: `/api/finance/budget-lines/${line3Id}/submit`, headers: auth(as.financeAdmin) })
    await app.inject({ method: 'POST', url: `/api/finance/budget-lines/${line3Id}/approve`, headers: auth(as.committee) })

    const second = await app.inject({
      method: 'POST', url: '/api/finance/projects', headers: auth(as.financeOfficer),
      payload: { reference: `${TAG}-P2`, name: '2032 clinic roof', currency: 'USD', approved_budget: '20000.00' },
    })
    expect(second.statusCode).toBe(201)
    const secondProjectId = second.json().data.project.id
    await app.inject({ method: 'POST', url: `/api/finance/projects/${secondProjectId}/submit`, headers: auth(as.financeOfficer) })
    await app.inject({ method: 'POST', url: `/api/finance/projects/${secondProjectId}/approve`, headers: auth(as.committee) })
    const secondAllocation = await app.inject({
      method: 'POST', url: `/api/finance/projects/${secondProjectId}/allocations`, headers: auth(as.financeOfficer),
      payload: { budget_line_id: line3Id, amount: '20000.00' },
    })
    expect(secondAllocation.statusCode).toBe(201)

    // A live projects publication makes approved projects eligible for the public view. Which
    // year they appear under is decided by their own financial activity, not by the publication's
    // year — that is the F-03 fix.
    const publication = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, dataset: 'projects',
        reporting_period_label: `${TAG} 2031 projects`, data_as_at: '2031-12-31',
      },
    })
    const publicationId = publication.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/publications/${publicationId}/approve`,
      headers: auth(as.committee), payload: {},
    })
    const published = await app.inject({
      method: 'POST', url: `/api/finance/publications/${publicationId}/publish`, headers: auth(as.publisher),
    })
    expect(published.statusCode).toBe(200)

    // The second year needs its own published projects dataset before the public overview will
    // admit that the year exists at all.
    const secondPublication = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: year2Id, dataset: 'projects',
        reporting_period_label: `${TAG} 2032 projects`, data_as_at: '2032-12-31',
      },
    })
    const secondPublicationId = secondPublication.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/publications/${secondPublicationId}/approve`,
      headers: auth(as.committee), payload: {},
    })
    const secondPublished = await app.inject({
      method: 'POST', url: `/api/finance/publications/${secondPublicationId}/publish`,
      headers: auth(as.publisher),
    })
    expect(secondPublished.statusCode).toBe(200)

    // The expenditure dataset was withdrawn earlier in the suite. Republish it: a public project's
    // spend is only the spend the public is allowed to see, so this test must run against a live
    // expenditure publication, not a hidden one.
    const expenditure = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, dataset: 'expenditure',
        reporting_period_label: `${TAG} 2031 expenditure`, data_as_at: '2031-12-31',
      },
    })
    const expenditureId = expenditure.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/publications/${expenditureId}/approve`,
      headers: auth(as.committee), payload: {},
    })
    const expenditurePublished = await app.inject({
      method: 'POST', url: `/api/finance/publications/${expenditureId}/publish`, headers: auth(as.publisher),
    })
    expect(expenditurePublished.statusCode).toBe(200)

    // A ZWG allocation and a ZWG transaction against a USD project is a data fault the schema
    // cannot prevent. The old view turned it into a second project row and then hid the ZWG spend
    // behind a currency join (F-04). The replacement must return one row and name the fault.
    await pg.query(
      `INSERT INTO finance.project_allocation
         (authority_id, project_id, budget_line_id, amount, currency, allocation_type, budget_revision_id, note)
       VALUES ((SELECT authority_id FROM finance.project WHERE id = $1), $1, $2, '5000.00', 'ZWG', 'revision', $3, 'Acceptance test: currency fault')`,
      [made.projectId, made.lineId, made.revisionId],
    )
    const { rows: zwgTxn } = await pg.query(
      'SELECT id FROM finance.transaction WHERE source_ref = $1', [`SRC-Z-${TAG}`],
    )
    const associated = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/transactions`,
      headers: auth(as.financeOfficer), payload: { transaction_id: zwgTxn[0].id },
    })
    expect(associated.statusCode).toBe(201)

    const inYear1 = await app.inject({
      method: 'GET', url: `/api/public/finance/projects?financial_year_id=${made.yearId}`,
    })
    expect(inYear1.statusCode).toBe(200)
    const projects2031 = inYear1.json().data.projects
    expect(projects2031.filter((p) => p.project_id === made.projectId)).toHaveLength(1)
    expect(projects2031.some((p) => p.project_id === secondProjectId)).toBe(false)

    const first = projects2031.find((p) => p.project_id === made.projectId)
    expect(first.currency).toBe('USD')
    // The USD figures are the project's own; the ZWG allocation and spend are beside them, not in
    // them, and are never converted.
    expect(first.allocated_total).toBe('40000.00')
    expect(first.actual_spend).toBe('10000.00')
    expect(first.allocation_currency_mismatch_rows).toBe(1)
    expect(first.actual_currency_mismatch_rows).toBe(1)
    expect(first.other_currency_allocations.ZWG).toBe('5000.00')
    expect(first.other_currency_spend.ZWG).toBe('750000.00')
    expect(first.financial_year_ids).toContain(made.yearId)

    const inYear2 = await app.inject({
      method: 'GET', url: `/api/public/finance/projects?financial_year_id=${year2Id}`,
    })
    expect(inYear2.statusCode).toBe(200)
    expect(inYear2.json().data.projects.some((p) => p.project_id === secondProjectId)).toBe(true)
    expect(inYear2.json().data.projects.some((p) => p.project_id === made.projectId)).toBe(false)

    // The overview's project count is scoped the same way, so the landing page cannot contradict
    // the project panel.
    const overview = await app.inject({
      method: 'GET', url: `/api/public/finance/overview?financial_year_id=${year2Id}`,
    })
    expect(overview.statusCode).toBe(200)
    const usd = overview.json().data.projects.find((p) => p.currency === 'USD')
    expect(usd.projects).toBe(1)
    expect(usd.approved_budget).toBe('20000.00')
  })

  test('F-05: a transaction cannot cross financial years, while a currency mismatch is stored and counted', async () => {
    const pg = systemOf(app.pg)

    // A second open year gives the test a budget line that belongs to a different year.
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} 2033`, start_date: '2033-01-01', end_date: '2033-12-31', reporting_currency: 'USD' },
    })
    expect(year.statusCode).toBe(201)
    const yearId = year.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${yearId}/open`, headers: auth(as.financeAdmin),
    })

    const line = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: yearId, department_id: made.deptId, account_id: made.accountExpId,
        code: `${TAG}-L5`, description: 'Roads maintenance — 2033', currency: 'USD',
        original_amount: '10000.00',
      },
    })
    expect(line.statusCode).toBe(201)
    const lineId = line.json().data.id

    const insertTxn = (financialYearId, budgetLineId, currency, sourceRef) => pg.query(
      `INSERT INTO finance.transaction
         (financial_year_id, account_id, department_id, budget_line_id, txn_date, amount, currency,
          source_system, source_ref, authority_id)
       VALUES ($1, $2, $3, $4, '2033-06-01', 750000.00, $5, 'manual', $6, 1)
       RETURNING id`,
      [financialYearId, made.accountExpId, made.deptId, budgetLineId, currency, sourceRef],
    )

    try {
      // Year 2033 against the 2031 line: refused at the database, not only in a route.
      await expect(insertTxn(yearId, made.lineId, 'USD', `SRC-XYEAR-${TAG}`))
        .rejects.toThrow(/belongs to/)
      const { rows: [absent] } = await pg.query(
        'SELECT count(*)::int AS n FROM finance.transaction WHERE source_ref = $1', [`SRC-XYEAR-${TAG}`],
      )
      expect(absent.n).toBe(0)

      // The same year and line is accepted, and an update that moves either side of the pair is refused.
      const { rows: [valid] } = await insertTxn(yearId, lineId, 'USD', `SRC-VALID-${TAG}`)
      await expect(pg.query(
        'UPDATE finance.transaction SET financial_year_id = $2 WHERE id = $1', [valid.id, made.yearId],
      )).rejects.toThrow(/belongs to/)
      await expect(pg.query(
        'UPDATE finance.transaction SET budget_line_id = $2 WHERE id = $1', [valid.id, made.lineId],
      )).rejects.toThrow(/belongs to/)

      // A different currency is NOT a cross-year error: §6.4/A8 require it to be stored, excluded
      // from the line's totals and counted, never converted or silently dropped.
      const { rows: [mismatch] } = await insertTxn(yearId, lineId, 'ZWG', `SRC-CURR-${TAG}`)
      const { rows: [performance] } = await pg.query(
        'SELECT actual_currency_mismatch_rows FROM finance.v_budget_line_performance WHERE budget_line_id = $1',
        [lineId],
      )
      expect(performance.actual_currency_mismatch_rows).toBe(1)
      const { rows: [stored] } = await pg.query(
        'SELECT currency, amount FROM finance.transaction WHERE id = $1', [mismatch.id],
      )
      expect(stored.currency).toBe('ZWG')
      expect(stored.amount).toBe('750000.00')
    } finally {
      await pg.query(
        'DELETE FROM finance.transaction WHERE source_ref IN ($1, $2)',
        [`SRC-VALID-${TAG}`, `SRC-CURR-${TAG}`],
      )
    }
  })

  test('F-06: a year-on-year report compares two years without combining currencies', async () => {
    // A fresh department and account, used in both years, so the comparison row is unambiguous.
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} 2034`, start_date: '2034-01-01', end_date: '2034-12-31', reporting_currency: 'USD' },
    })
    expect(year.statusCode).toBe(201)
    const yearId = year.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${yearId}/open`, headers: auth(as.financeAdmin),
    })

    const department = await app.inject({
      method: 'POST', url: '/api/finance/departments', headers: auth(as.financeAdmin),
      payload: { code: `${TAG}-YOY`, name: 'Year-on-year test' },
    })
    expect(department.statusCode).toBe(201)
    const departmentId = department.json().data.id

    const chart = await app.inject({
      method: 'POST', url: '/api/finance/accounts/bulk', headers: auth(as.financeAdmin),
      payload: { accounts: [
        { code: `${TAG}-YOY`, name: 'Year-on-year account', kind: 'expenditure', expenditure_class: 'recurrent' },
      ] },
    })
    expect(chart.statusCode).toBe(200)
    const accounts = await app.inject({
      method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin),
    })
    const accountId = accounts.json().data.find((a) => a.code === `${TAG}-YOY`).id

    for (const [code, financialYearId, amount, description] of [
      [`${TAG}-YOY-P`, made.yearId, '100000.00', 'Year-on-year prior'],
      [`${TAG}-YOY-C`, yearId, '120000.00', 'Year-on-year current'],
    ]) {
      const created = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
        payload: {
          financial_year_id: financialYearId, department_id: departmentId, account_id: accountId,
          code, description, currency: 'USD', original_amount: amount,
        },
      })
      expect(created.statusCode).toBe(201)
      const lineId = created.json().data.id
      await app.inject({ method: 'POST', url: `/api/finance/budget-lines/${lineId}/submit`, headers: auth(as.financeAdmin) })
      const approved = await app.inject({ method: 'POST', url: `/api/finance/budget-lines/${lineId}/approve`, headers: auth(as.committee) })
      expect(approved.statusCode).toBe(200)
    }

    const report = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/run?report=year_on_year&financial_year_id=${yearId}&compare_financial_year_id=${made.yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(report.statusCode).toBe(200)
    const data = report.json().data
    expect(data.meta['Financial year']).toContain(`${TAG} 2034`)
    expect(data.meta['Comparison year']).toContain(`${TAG} 2031`)
    expect(data.meta['Currency treatment']).toMatch(/separately/)

    const row = data.rows.find((r) =>
      r.department_code === `${TAG}-YOY` && r.account_code === `${TAG}-YOY` && r.currency === 'USD')
    expect(row).toBeTruthy()
    expect(row.prior_revised_amount).toBe('100000.00')
    expect(row.current_revised_amount).toBe('120000.00')
    expect(row.revised_change).toBe('20000.00')

    // Both years are mandatory, and comparing a year with itself is meaningless.
    const missing = await app.inject({
      method: 'GET', url: `/api/finance/reports/run?report=year_on_year&financial_year_id=${yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('comparison_year_required')

    const same = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/run?report=year_on_year&financial_year_id=${yearId}&compare_financial_year_id=${yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(same.statusCode).toBe(400)
    expect(same.json().error).toBe('same_financial_year')

    // The export carries the same comparison, including both year labels in its metadata.
    const exported = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=year_on_year&format=csv&financial_year_id=${yearId}&compare_financial_year_id=${made.yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(exported.statusCode).toBe(200)
    expect(exported.body).toContain('Prior year revised budget')
    expect(exported.body).toContain(`${TAG} 2031`)
    expect(exported.body).toContain(`${TAG} 2034`)
  })

  test('F-07 and F-08: public documents are paginated and year-scoped, and the council name comes from the register', async () => {
    const pg = systemOf(app.pg)
    const { rows: [year] } = await pg.query(
      'SELECT id, authority_id FROM finance.financial_year WHERE id = $1', [made.yearId],
    )
    const { rows: [uploader] } = await pg.query(
      "SELECT id FROM public.users WHERE email = 'demo.finance-admin@vungu.test'",
    )
    const { rows: [txn] } = await pg.query(
      'SELECT id FROM finance.transaction WHERE financial_year_id = $1 AND deleted_at IS NULL LIMIT 1',
      [made.yearId],
    )

    // A live documents publication is what admits a public document through the RLS policy.
    const publication = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, dataset: 'documents',
        reporting_period_label: `${TAG} 2031 documents`, data_as_at: '2031-12-31',
      },
    })
    expect(publication.statusCode).toBe(201)
    const publicationId = publication.json().data.id
    await app.inject({
      method: 'POST', url: `/api/finance/publications/${publicationId}/approve`,
      headers: auth(as.committee), payload: {},
    })
    expect((await app.inject({
      method: 'POST', url: `/api/finance/publications/${publicationId}/publish`,
      headers: auth(as.publisher),
    })).statusCode).toBe(200)

    const insertDoc = (filename, subjectKind, subjectId, documentType, visibility) => pg.query(
      `INSERT INTO finance.document
         (authority_id, subject_kind, subject_id, object_key, filename, mime_type, size_bytes,
          checksum, document_type, visibility, uploaded_by)
       VALUES ($1, $2, $3, $4, $4, 'text/plain', 1, 'test-checksum', $5, $6, $7)
       RETURNING id, filename, financial_year_id`,
      [year.authority_id, subjectKind, subjectId, filename, documentType, visibility, uploader.id],
    )

    try {
      const docs = []
      docs.push((await insertDoc(`${TAG}-DOC-A.txt`, 'budget_line', made.lineId, 'budget', 'public')).rows[0])
      docs.push((await insertDoc(`${TAG}-DOC-B.txt`, 'budget_line', made.lineId, 'budget', 'public')).rows[0])
      docs.push((await insertDoc(`${TAG}-DOC-C.txt`, 'transaction', txn.id, 'statement', 'public')).rows[0])
      // Not public, so it must never appear even when the year matches.
      await insertDoc(`${TAG}-DOC-X.txt`, 'budget_line', made.lineId, 'budget', 'private')

      // The year is derived from the subject by migration 191's trigger.
      expect(docs.every((d) => d.financial_year_id === made.yearId)).toBe(true)

      const budgetDocs = await app.inject({
        method: 'GET',
        url: `/api/public/finance/documents?financial_year_id=${made.yearId}&dataset=budget&limit=2&offset=0&sort=filename&direction=asc`,
      })
      expect(budgetDocs.statusCode).toBe(200)
      expect(budgetDocs.json().data.total).toBe(2)
      expect(budgetDocs.json().data.documents.map((d) => d.filename))
        .toEqual([`${TAG}-DOC-A.txt`, `${TAG}-DOC-B.txt`])

      const transactionDocs = await app.inject({
        method: 'GET',
        url: `/api/public/finance/documents?financial_year_id=${made.yearId}&dataset=expenditure`,
      })
      expect(transactionDocs.json().data.total).toBe(1)
      expect(transactionDocs.json().data.documents[0].filename).toBe(`${TAG}-DOC-C.txt`)

      const nextPage = await app.inject({
        method: 'GET',
        url: `/api/public/finance/documents?financial_year_id=${made.yearId}&limit=2&offset=2&sort=filename&direction=asc`,
      })
      expect(nextPage.json().data.total).toBe(3)
      expect(nextPage.json().data.documents).toHaveLength(1)
      expect(nextPage.json().data.documents[0].filename).toBe(`${TAG}-DOC-C.txt`)

      const searched = await app.inject({
        method: 'GET', url: '/api/public/finance/documents?q=DOC-B',
      })
      expect(searched.json().data.total).toBe(1)

      // F-08: the name is read from the authority register, not baked into the route.
      const { rows: [authority] } = await pg.query(
        "SELECT id, authority_name FROM public.local_authorities WHERE code = 'VUNGU'",
      )
      await pg.query('UPDATE public.local_authorities SET authority_name = $2 WHERE id = $1',
        [authority.id, `${TAG} District`])
      try {
        const overview = await app.inject({
          method: 'GET', url: `/api/public/finance/overview?financial_year_id=${made.yearId}`,
        })
        expect(overview.statusCode).toBe(200)
        expect(overview.json().data.council.name).toBe(`${TAG} District`)
      } finally {
        await pg.query('UPDATE public.local_authorities SET authority_name = $2 WHERE id = $1',
          [authority.id, authority.authority_name])
      }
    } finally {
      await pg.query('DELETE FROM finance.document WHERE filename LIKE $1', [`${TAG}-DOC-%`])
    }
  })

  // ── Reporting ──────────────────────────────────────────────────────────────────────────────────
  test('a report carries the metadata the specification requires, and restricted columns need their own permission', async () => {
    const report = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/run?report=budget_vs_actual&financial_year_id=${made.yearId}`,
      headers: auth(as.financeAdmin),
    })
    expect(report.statusCode).toBe(200)
    const meta = report.json().data.meta
    expect(meta.Council).toBeTruthy()
    expect(meta['Financial year']).toContain(TAG)
    expect(meta['Currency treatment']).toMatch(/separately/)
    expect(meta['Generated at']).toBeTruthy()
    expect(meta['Filters applied']).toContain('budget_vs_actual')
    expect(meta['Restricted data included']).toBe('no')

    // A budget officer may export, but not the supplier names.
    const refused = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=transaction_register&financial_year_id=${made.yearId}&format=csv&include_restricted=true`,
      headers: auth(as.budgetOfficer),
    })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().required_permission).toBe('finance.report.export_restricted')

    const plain = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=transaction_register&financial_year_id=${made.yearId}&format=csv`,
      headers: auth(as.budgetOfficer),
    })
    expect(plain.statusCode).toBe(200)
    expect(plain.headers['content-type']).toMatch(/text\/csv/)
    expect(plain.headers['x-finance-restricted']).toBe('false')
    expect(plain.body).not.toMatch(/Midlands Plant Hire/)
    expect(plain.body).toContain('# Currency treatment')

    // The auditor may, and the file says so in its name and its header.
    const restricted = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=transaction_register&financial_year_id=${made.yearId}&format=csv&include_restricted=true`,
      headers: auth(as.auditor),
    })
    expect(restricted.statusCode).toBe(200)
    expect(restricted.headers['x-finance-restricted']).toBe('true')
    expect(restricted.headers['content-disposition']).toMatch(/RESTRICTED/)
    expect(restricted.body).toMatch(/Midlands Plant Hire/)

    // And an .xlsx comes back as a real workbook.
    const workbook = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=departmental_summary&financial_year_id=${made.yearId}&format=xlsx`,
      headers: auth(as.financeAdmin),
    })
    expect(workbook.statusCode).toBe(200)
    expect(workbook.headers['content-type']).toMatch(/spreadsheetml/)
    expect(workbook.rawPayload.slice(0, 2).toString('latin1')).toBe('PK')

    // And a PDF comes back as a real document, carrying the same cover metadata as the other two
    // formats -- a committee pack is the copy that gets believed, so it has to state its own year
    // and currency rule rather than being a bare grid of numbers.
    const pdf = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=departmental_summary&financial_year_id=${made.yearId}&format=pdf`,
      headers: auth(as.financeAdmin),
    })
    expect(pdf.statusCode).toBe(200)
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/)
    expect(pdf.headers['content-disposition']).toMatch(/\.pdf"/)
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pdfSays = pdfText(pdf.rawPayload)
    expect(pdfSays).toContain('Departmental summary')
    expect(pdfSays).toContain(TAG)
    expect(pdfSays).toMatch(/reported separately/)

    // A7, in the format most likely to be forwarded: an unrestricted PDF of the transaction
    // register names no supplier, and the restricted one is marked on its face, not only in its
    // filename.
    const pdfPlain = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=transaction_register&financial_year_id=${made.yearId}&format=pdf`,
      headers: auth(as.budgetOfficer),
    })
    expect(pdfPlain.statusCode).toBe(200)
    expect(pdfPlain.headers['x-finance-restricted']).toBe('false')
    const plainSays = pdfText(pdfPlain.rawPayload)
    expect(plainSays).not.toMatch(/Midlands Plant Hire/)
    expect(plainSays).not.toContain('RESTRICTED')

    const pdfRestricted = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/export?report=transaction_register&financial_year_id=${made.yearId}&format=pdf&include_restricted=true`,
      headers: auth(as.auditor),
    })
    expect(pdfRestricted.statusCode).toBe(200)
    expect(pdfRestricted.headers['x-finance-restricted']).toBe('true')
    expect(pdfRestricted.headers['content-disposition']).toMatch(/RESTRICTED/)
    const restrictedSays = pdfText(pdfRestricted.rawPayload)
    expect(restrictedSays).toMatch(/Midlands Plant Hire/)
    expect(restrictedSays).toContain('RESTRICTED')
  })

  test('a departmental head sees only their own vote', async () => {
    // Scope is data: one row in finance.user_scope confines this person to Engineering.
    const { rows: head } = await systemOf(app.pg).query(
      "SELECT id FROM public.users WHERE email = 'demo.dept-head@vungu.test'",
    )
    await systemOf(app.pg).query(
      'INSERT INTO finance.user_scope (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [head[0].id, made.deptId],
    )
    try {
      const token = await loginAs(app, 'demo.dept-head@vungu.test', PASSWORD)
      const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(token) })
      expect(me.json().data.department_scope.map((d) => d.id)).toEqual([made.deptId])

      const departments = await app.inject({
        method: 'GET', url: '/api/finance/departments', headers: auth(token),
      })
      expect(departments.json().data.map((d) => d.id)).toEqual([made.deptId])

      const lines = await app.inject({
        method: 'GET', url: `/api/finance/budget-lines?financial_year_id=${made.yearId}`, headers: auth(token),
      })
      expect(lines.json().data.lines.every((l) => l.department_id === made.deptId)).toBe(true)

      // And cannot prepare a line for a vote that is not theirs.
      const outOfScope = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(token),
        payload: {
          financial_year_id: made.yearId, department_id: made.deptId2, account_id: made.accountExpId,
          code: `${TAG}-OOS`, description: 'Another department', currency: 'USD', original_amount: '1.00',
        },
      })
      expect(outOfScope.statusCode).toBe(403)
      expect(outOfScope.json().error).toBe('out_of_scope')
    } finally {
      await systemOf(app.pg).query('DELETE FROM finance.user_scope WHERE user_id = $1', [head[0].id])
    }
  })

  // ── Closing the year ───────────────────────────────────────────────────────────────────────────
  test('A9: a closed financial year accepts nothing, through the API or around it', async () => {
    const pg = systemOf(app.pg)
    // A transaction that exists before the close, to prove a project link cannot be attached to a
    // closed-year transaction afterwards (D-04).
    const { rows: [authorityRow] } = await pg.query(
      'SELECT authority_id FROM finance.financial_year WHERE id = $1', [made.yearId],
    )
    const { rows: [lateTxn] } = await pg.query(
      `INSERT INTO finance.transaction
         (financial_year_id, account_id, department_id, txn_date, amount, currency,
          source_system, source_ref, authority_id)
       VALUES ($1, $2, $3, '2031-05-01', 1.00, 'USD', 'manual', $4, $5)
       RETURNING id`,
      [made.yearId, made.accountExpId, made.deptId, `SRC-PRELINK-${TAG}`, authorityRow.authority_id],
    )

    const closed = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/close`,
      headers: auth(as.financeAdmin), payload: { note: 'Year end.' },
    })
    expect(closed.statusCode).toBe(200)
    expect(closed.json().data.status).toBe('closed')

    const line = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountExpId,
        code: `${TAG}-AFTER`, description: 'After the year closed', currency: 'USD', original_amount: '1.00',
      },
    })
    expect(line.statusCode).toBe(409)
    expect(line.json().error).toBe('year_closed')

    const upload = await uploadCsv(as.financeOfficer, {
      csv: `Vote,GL Code,Date,Amount,Currency,Source Ref\n${TAG}-ENG,${TAG}-5100,01/06/2031,1.00,USD,SRC-LATE-${TAG}`,
      key: `${TAG}-late`, count: 1, total: '1.00',
    })
    expect(upload.statusCode).toBe(409)
    expect(upload.json().error).toBe('year_not_open')

    // The database refuses it as well, so a path that bypasses the route gains nothing.
    await expect(systemOf(app.pg).query(
      `INSERT INTO finance.transaction
         (financial_year_id, account_id, department_id, txn_date, amount, currency,
          source_system, source_ref, authority_id)
       VALUES ($1, $2, $3, '2031-06-01', 1.00, 'USD', 'manual', $4, 1)`,
      [made.yearId, made.accountExpId, made.deptId, `SRC-BYPASS-${TAG}`],
    )).rejects.toThrow(/accepts no further financial records/)

    // D-04: the same guard covers the two project tables that change what a year's figures say.
    await expect(pg.query(
      `UPDATE finance.project_allocation SET note = 'after close'
        WHERE project_id = $1 AND deleted_at IS NULL`, [made.projectId],
    )).rejects.toThrow(/accepts no further financial records/)
    await expect(pg.query(
      `INSERT INTO finance.project_transaction (authority_id, project_id, transaction_id)
       VALUES ($1, $2, $3)`,
      [authorityRow.authority_id, made.projectId, lateTxn.id],
    )).rejects.toThrow(/accepts no further financial records/)

    // The routes translate that database refusal into a clear 409, not an unhandled 500.
    const allocationAfterClose = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/allocations`,
      headers: auth(as.financeOfficer),
      payload: {
        budget_line_id: made.lineId, amount: '1.00',
        allocation_type: 'revision', budget_revision_id: made.revisionId,
      },
    })
    expect(allocationAfterClose.statusCode).toBe(409)
    expect(allocationAfterClose.json().error).toBe('year_closed')

    const linkAfterClose = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/transactions`,
      headers: auth(as.financeOfficer), payload: { transaction_id: lateTxn.id },
    })
    expect(linkAfterClose.statusCode).toBe(409)
    expect(linkAfterClose.json().error).toBe('year_closed')

    const { rows: [existingLink] } = await pg.query(
      `SELECT pt.transaction_id
         FROM finance.project_transaction pt
         JOIN finance.transaction t ON t.id = pt.transaction_id
        WHERE pt.project_id = $1 AND pt.deleted_at IS NULL AND t.financial_year_id = $2
        LIMIT 1`, [made.projectId, made.yearId],
    )
    const unlinkAfterClose = await app.inject({
      method: 'DELETE',
      url: `/api/finance/projects/${made.projectId}/transactions/${existingLink.transaction_id}`,
      headers: auth(as.financeOfficer),
    })
    expect(unlinkAfterClose.statusCode).toBe(409)
    expect(unlinkAfterClose.json().error).toBe('year_closed')

    // Reopening is possible, but demands a written reason.
    const noReason = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/reopen`,
      headers: auth(as.financeAdmin), payload: { reason: 'short' },
    })
    expect(noReason.statusCode).toBe(400)

    const reopened = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/reopen`,
      headers: auth(as.financeAdmin),
      payload: { reason: 'Reopened to post a late supplier invoice, approved by the Treasurer.' },
    })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json().data.status).toBe('open')
    expect(reopened.json().data.notes).toMatch(/Reopened/)
  })

  test('the finance audit trail records what was done and what was refused', async () => {
    const audit = await app.inject({
      method: 'GET', url: '/api/finance/audit?limit=200', headers: auth(as.auditor),
    })
    expect(audit.statusCode).toBe(200)
    const events = audit.json().data.events
    expect(events.length).toBeGreaterThan(0)
    const names = new Set(events.map((e) => e.event))
    expect(names).toContain('FIN_PUBLICATION')
    expect(names).toContain('FIN_IMPORT')
    expect(names).toContain('FIN_CONFIG')
    // Refusals are there too, which is what makes the trail useful.
    expect(events.some((e) => e.status === 403)).toBe(true)
    expect(events.every((e) => e.actor_email)).toBe(true)

    // D-06: the most consequential transitions carry a structured before/after, not only the
    // request context. The row is written after the reply, so poll briefly.
    const pg = systemOf(app.pg)
    const publication = await waitForRows(pg,
      `SELECT details FROM public.admin_audit_event
        WHERE event = 'FIN_PUBLICATION' AND details->'after'->>'state' = 'published'
        ORDER BY occurred_at DESC LIMIT 1`)
    expect(publication).toHaveLength(1)
    expect(publication[0].details.before.state).toBe('approved')
    expect(publication[0].details.after.state).toBe('published')

    const revision = await waitForRows(pg,
      `SELECT details FROM public.admin_audit_event
        WHERE event = 'FIN_REVISION' AND details->'after'->>'state' = 'approved'
        ORDER BY occurred_at DESC LIMIT 1`)
    expect(revision).toHaveLength(1)
    expect(revision[0].details.before.state).toBe('submitted')

    const imported = await waitForRows(pg,
      `SELECT details FROM public.admin_audit_event
        WHERE event = 'FIN_IMPORT' AND details->'after'->>'status' = 'committed'
        ORDER BY occurred_at DESC LIMIT 1`)
    expect(imported).toHaveLength(1)
    expect(imported[0].details.before.status).toBe('validated')
    expect(imported[0].details.after.written).toBeGreaterThan(0)

    // An auditor can export it; the export says the records are not editable through the app.
    const exported = await app.inject({
      method: 'GET', url: '/api/finance/audit/export?format=csv', headers: auth(as.auditor),
    })
    expect(exported.statusCode).toBe(200)
    expect(exported.body).toMatch(/cannot be edited through the application/)

    // A budget officer cannot read it at all.
    const refused = await app.inject({
      method: 'GET', url: '/api/finance/audit', headers: auth(as.budgetOfficer),
    })
    expect(refused.statusCode).toBe(403)
  })
})
