/**
 * The four access-control blockers from the production-readiness audit, each with a test that
 * FAILS on the code as it was and passes on the code as it is.
 *
 *   BLOCKER-1  /api/public/finance/* served the council's UNPUBLISHED data to any authenticated
 *              Vungu session, because `published_select` is a second PERMISSIVE policy OR'd with
 *              `tenant_select` and four handlers carried no publication predicate of their own.
 *              Every public-exposure test in the suite was anonymous, which is why it survived:
 *              so these tests sign in as a `building_inspector` — a council officer holding
 *              ZERO finance permissions — and assert the public surface is byte-identical to the
 *              anonymous one.
 *
 *   BLOCKER-2  separation of duties could be dissolved through PUT /finance/users/:id/access:
 *              the invariant was asserted over ROLE DEFAULTS only, while the route wrote
 *              arbitrary grant overrides. Attempted here through the real route.
 *
 *   BLOCKER-3  DELETE /finance/documents/:id was gated by finance.document.view, a READ
 *              permission the read-only auditor holds, and the required reason was discarded.
 *
 *   B-1        finance.spatial_allocation had no `published_select` policy, so an anonymous read
 *              of finance.v_ward_performance saw no splits at all and every split line attributed
 *              its WHOLE amount to its own ward_code — the all-or-nothing rule inverted for the
 *              public. Asserted against the anonymous session directly, because no public map
 *              route exists yet (Milestone 7): the policy is the prerequisite, and this is the
 *              regression test that keeps it.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.access-control.test.js --runInBand
 *
 * Everything created here is tagged and removed in afterAll. test/helpers/buildApp.js refuses a
 * database whose name is not obviously disposable, so this cannot run against vungu_dev by
 * accident (audit MAJOR-7).
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const { systemOf } = require('../../lib/dbContext')
const { tenantPool } = require('../../lib/tenancy')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `AC${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

/** The audit row is written by the onResponse hook, after the reply is sent. */
async function waitForRows(pg, sql, params) {
  let rows = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ({ rows } = await pg.query(sql, params))
    if (rows.length) return rows
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return rows
}

describe('finance access control', () => {
  let app
  /** A connection scoped to NOBODY: the session `published_select` was written for. */
  let anonymousPg
  const as = {}
  const made = {
    yearId: null, deptId: null, accountExpId: null,
    draftLineId: null, publishedLineId: null, approvedOnlyLineId: null,
    approvedAllocationId: null, draftAllocationId: null, hiddenAllocationId: null,
    budgetPublicationId: null,
    documentId: null, objectKey: null, secondDocumentId: null,
    tempUserId: null,
  }
  const WARD_SPLIT = `${TAG}-W1`
  const WARD_DRAFT = `${TAG}-W2`
  const WARD_HIDDEN = `${TAG}-W3`

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    anonymousPg = tenantPool(systemOf(app.pg), null)

    const accounts = {
      financeAdmin: 'demo.finance-admin@vungu.test',
      financeOfficer: 'demo.finance-officer@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      publisher: 'demo.publisher@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      technicalAdmin: 'demo.admin@vungu.test',
      // The council officer at the heart of BLOCKER-1: a real, ordinary staff session whose
      // users.authority_id is Vungu and who holds NOT ONE finance permission.
      inspector: 'demo.inspector@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) {
      as[key] = await loginAs(app, email, PASSWORD)
    }

    // ── Reference data ────────────────────────────────────────────────────────────────────────
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: {
        label: `${TAG} Access 2034`, start_date: '2034-01-01', end_date: '2034-12-31',
        reporting_currency: 'USD',
      },
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/open`,
      headers: auth(as.financeAdmin),
    })).statusCode).toBe(200)

    const dept = await app.inject({
      method: 'POST', url: '/api/finance/departments', headers: auth(as.financeAdmin),
      payload: { code: `${TAG}-ENG`, name: 'Access-control test engineering vote' },
    })
    expect(dept.statusCode).toBe(201)
    made.deptId = dept.json().data.id

    expect((await app.inject({
      method: 'POST', url: '/api/finance/accounts/bulk', headers: auth(as.financeAdmin),
      payload: {
        accounts: [{
          code: `${TAG}-5200`, name: 'Access-control test expenditure',
          kind: 'expenditure', expenditure_class: 'recurrent',
        }],
      },
    })).statusCode).toBe(200)
    const accountsList = await app.inject({
      method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin),
    })
    made.accountExpId = accountsList.json().data.find((a) => a.code === `${TAG}-5200`).id

    const newLine = async (code, description, amount) => {
      const res = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
        payload: {
          financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountExpId,
          code, description, currency: 'USD', original_amount: amount,
        },
      })
      expect(res.statusCode).toBe(201)
      return res.json().data.id
    }
    const approveLine = async (id) => {
      expect((await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/submit`, headers: auth(as.financeAdmin),
      })).statusCode).toBe(200)
      expect((await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/approve`, headers: auth(as.committee),
      })).statusCode).toBe(200)
    }

    // The pre-Council draft: prepared, never submitted. NOTHING may ever make this public.
    made.draftLineId = await newLine(`${TAG}-DRAFT`, 'Unapproved draft — pre-Council', '777000.00')
    // The line that does get published.
    made.publishedLineId = await newLine(`${TAG}-PUB`, 'Published roads maintenance', '100000.00')
    await approveLine(made.publishedLineId)

    // ── Spatial allocations on the published line (B-1) ───────────────────────────────────────
    const allocate = async (subjectId, targetCode, amount) => {
      const res = await app.inject({
        method: 'POST', url: '/api/finance/spatial-allocations', headers: auth(as.financeAdmin),
        payload: {
          subject_kind: 'budget_line', subject_id: subjectId, target_code: targetCode,
          amount, currency: 'USD',
          methodology: 'Access-control regression fixture: split recorded by surveyed road length.',
        },
      })
      expect(res.statusCode).toBe(201)
      return res.json().data.id
    }
    made.approvedAllocationId = await allocate(made.publishedLineId, WARD_SPLIT, '60000.00')
    expect((await app.inject({
      method: 'POST', url: `/api/finance/spatial-allocations/${made.approvedAllocationId}/approve`,
      headers: auth(as.committee), payload: { decision_note: 'Split approved' },
    })).statusCode).toBe(200)
    // A DRAFT split: a proposal, never public, whatever its subject's publication state.
    made.draftAllocationId = await allocate(made.publishedLineId, WARD_DRAFT, '15000.00')

    // ── Publish the budget dataset ────────────────────────────────────────────────────────────
    const publication = await app.inject({
      method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, dataset: 'budget',
        reporting_period_label: `${TAG} 2034 full year`, data_as_at: '2034-12-31',
      },
    })
    expect(publication.statusCode).toBe(201)
    made.budgetPublicationId = publication.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.budgetPublicationId}/approve`,
      headers: auth(as.committee), payload: { note: 'Approved for release' },
    })).statusCode).toBe(200)
    const marked = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.budgetPublicationId}/mark-budget-lines`,
      headers: auth(as.publisher), payload: { department_id: made.deptId },
    })
    expect(marked.statusCode).toBe(200)
    expect(marked.json().data.marked).toBe(1) // only the approved line; the draft is untouched
    expect((await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.budgetPublicationId}/publish`,
      headers: auth(as.publisher),
    })).statusCode).toBe(200)

    // ── An APPROVED line that was never published, created AFTER mark-budget-lines ran ───────
    // Its approved split must stay invisible publicly: a split may never be more public than the
    // money it splits.
    made.approvedOnlyLineId = await newLine(`${TAG}-APPROVED-ONLY`, 'Approved, not released', '50000.00')
    await approveLine(made.approvedOnlyLineId)
    made.hiddenAllocationId = await allocate(made.approvedOnlyLineId, WARD_HIDDEN, '20000.00')
    expect((await app.inject({
      method: 'POST', url: `/api/finance/spatial-allocations/${made.hiddenAllocationId}/approve`,
      headers: auth(as.committee), payload: { decision_note: 'Split approved' },
    })).statusCode).toBe(200)

    // ── A document classified PUBLIC with no documents publication ────────────────────────────
    // 'public' is the council's hand classification (decision D5); it is not a publication. The
    // documents dataset is deliberately never published in this suite.
    const uploadPdf = async (filename) => {
      const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
      // Distinct bytes per upload: the route refuses a second file with the same checksum against
      // the same subject (409 duplicate), which is correct and not what this suite is testing.
      const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /T (${filename}) >>\nendobj\ntrailer\n<<>>\n%%EOF\n`)
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject_kind"\r\n\r\nfinancial_year\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject_id"\r\n\r\n${made.yearId}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document_type"\r\n\r\napproved_budget\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
        pdf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const res = await app.inject({
        method: 'POST', url: '/api/finance/documents',
        headers: { ...auth(as.financeOfficer), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(201)
      return res.json().data.document.id
    }
    made.documentId = await uploadPdf(`${TAG}-public-classified.pdf`)
    made.secondDocumentId = await uploadPdf(`${TAG}-withdrawable.pdf`)
    expect((await app.inject({
      method: 'PATCH', url: `/api/finance/documents/${made.documentId}/visibility`,
      headers: auth(as.publisher),
      payload: { visibility: 'public', reason: 'Access-control fixture: classified public, register unpublished' },
    })).statusCode).toBe(200)
    const { rows: keys } = await systemOf(app.pg).query(
      `SELECT object_key FROM finance.document WHERE filename LIKE $1`, [`${TAG}%`],
    )
    made.objectKey = keys.map((r) => r.object_key)

    // ── A disposable target for the access-administration tests ───────────────────────────────
    const { rows: temp } = await systemOf(app.pg).query(
      `INSERT INTO public.users (email, name, role, password_hash, active, status, authority_id)
       SELECT $1, $2, 'finance_committee', password_hash, true, 'active', authority_id
         FROM public.users WHERE email = 'demo.treasurer@vungu.test'
       RETURNING id`,
      [`${TAG.toLowerCase()}.target@vungu.test`, `${TAG} access target`],
    )
    made.tempUserId = temp[0].id
  }, 180000)

  afterAll(async () => {
    if (!app) return
    const pg = systemOf(app.pg)
    for (const key of made.objectKey || []) {
      try { fs.unlinkSync(key) } catch { /* already gone */ }
    }
    const statements = [
      `DELETE FROM finance.user_permission_override WHERE user_id = '${made.tempUserId}'`,
      `DELETE FROM finance.user_scope WHERE user_id = '${made.tempUserId}'`,
      `DELETE FROM public.users WHERE email LIKE '${TAG.toLowerCase()}%'`,
      `DELETE FROM finance.spatial_allocation WHERE target_code LIKE '${TAG}%'`,
      `DELETE FROM finance.document WHERE filename LIKE '${TAG}%'`,
      `DELETE FROM finance.publication WHERE financial_year_id IN
         (SELECT id FROM finance.financial_year WHERE label LIKE '${TAG}%')`,
      `DELETE FROM finance.transaction WHERE budget_line_id IN
         (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_revision WHERE budget_line_id IN
         (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.user_scope WHERE department_id IN
         (SELECT id FROM finance.department WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE label LIKE '${TAG}%'`,
    ]
    for (const statement of statements) await pg.query(statement).catch(() => {})
    await app.close()
  }, 90000)

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // BLOCKER-1 — the public surface must not depend on the caller being anonymous
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  describe('BLOCKER-1: the public finance API under an authenticated council session', () => {
    const publicUrls = () => [
      '/api/public/finance/years',
      `/api/public/finance/overview?financial_year_id=${made.yearId}`,
      `/api/public/finance/budget?financial_year_id=${made.yearId}&limit=200`,
      `/api/public/finance/revenue?financial_year_id=${made.yearId}`,
      `/api/public/finance/expenditure?financial_year_id=${made.yearId}`,
      `/api/public/finance/transactions?financial_year_id=${made.yearId}`,
      `/api/public/finance/projects?financial_year_id=${made.yearId}`,
      `/api/public/finance/documents?financial_year_id=${made.yearId}`,
    ]

    test('the building inspector holds no finance permission and is refused the staff routes', async () => {
      const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(as.inspector) })
      expect(me.statusCode).toBe(200)
      expect(me.json().data.role).toBe('building_inspector')
      expect(me.json().data.permissions).toEqual([])

      const staff = await app.inject({
        method: 'GET', url: `/api/finance/budget-lines?financial_year_id=${made.yearId}`,
        headers: auth(as.inspector),
      })
      expect(staff.statusCode).toBe(403)
    })

    test('every public endpoint answers an authenticated council session exactly as it answers the public', async () => {
      for (const url of publicUrls()) {
        const anonymous = await app.inject({ method: 'GET', url })
        const signedIn = await app.inject({ method: 'GET', url, headers: auth(as.inspector) })
        expect({ url, status: signedIn.statusCode }).toEqual({ url, status: anonymous.statusCode })
        // The whole point: being signed in as council staff changes NOTHING on the public surface.
        expect({ url, body: signedIn.json() }).toEqual({ url, body: anonymous.json() })
      }
    })

    test('the unpublished draft budget does not reach the public budget page, signed in or not', async () => {
      for (const token of [null, as.inspector, as.auditor, as.technicalAdmin]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/public/finance/budget?financial_year_id=${made.yearId}&limit=200`,
          ...(token ? { headers: auth(token) } : {}),
        })
        expect(res.statusCode).toBe(200)
        const codes = res.json().data.lines.map((l) => l.code)
        expect(codes).toContain(`${TAG}-PUB`)
        // The pre-Council draft and the approved-but-unreleased line are both absent.
        expect(codes).not.toContain(`${TAG}-DRAFT`)
        expect(codes).not.toContain(`${TAG}-APPROVED-ONLY`)
        expect(codes.filter((c) => c.startsWith(TAG))).toEqual([`${TAG}-PUB`])
      }
    })

    test('the public overview sums only published lines for an authenticated council session', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/public/finance/overview?financial_year_id=${made.yearId}`,
        headers: auth(as.inspector),
      })
      expect(res.statusCode).toBe(200)
      const usd = res.json().data.summary.find((s) => s.currency === 'USD')
      // 100,000 published. NOT 777,000 of draft, and not the 50,000 approved-but-unreleased line.
      expect(usd.expenditure.budget.revised_amount).toBe('100000.00')
      expect(usd.expenditure.budget.lines).toBe(1)
    })

    test('a document classified public is not public until the documents register is published', async () => {
      for (const token of [null, as.inspector]) {
        const res = await app.inject({
          method: 'GET', url: `/api/public/finance/documents?financial_year_id=${made.yearId}`,
          ...(token ? { headers: auth(token) } : {}),
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data.documents.map((d) => d.id)).not.toContain(made.documentId)
        expect(res.json().data.total).toBe(0)
      }
    })

    test('the public handlers are correct even with the policies out of the picture', async () => {
      // The second half of the defence: run each handler's own predicate as the DATABASE OWNER,
      // for whom row-level security does not apply at all. If the route depended on the policies
      // the draft line would appear here.
      const owner = systemOf(app.pg)
      const { rows: budget } = await owner.query(
        `SELECT code FROM finance.v_published_budget_line WHERE financial_year_id = $1`, [made.yearId],
      )
      expect(budget.map((r) => r.code)).toEqual([`${TAG}-PUB`])

      const { rows: docs } = await owner.query(
        `SELECT d.id FROM finance.document d
          WHERE d.filename LIKE $1 AND d.visibility = 'public' AND d.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM finance.publication pub
                         WHERE pub.authority_id = d.authority_id
                           AND pub.dataset = 'documents' AND pub.state = 'published')`,
        [`${TAG}%`],
      )
      expect(docs).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // BLOCKER-2 — separation of duties over the effective permission set
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  describe('BLOCKER-2: separation of duties through the access API', () => {
    const putAccess = (targetId, payload, token) => app.inject({
      method: 'PUT', url: `/api/finance/users/${targetId}/access`,
      headers: auth(token || as.technicalAdmin), payload,
    })

    test('an approver cannot also be granted the publication permission', async () => {
      const res = await putAccess(made.tempUserId, {
        role: 'finance_committee',
        reason: 'cover during the publisher’s leave',
        overrides: [
          { permission_code: 'finance.publication.publish', effect: 'grant' },
          { permission_code: 'finance.transaction.view_counterparty', effect: 'grant' },
          { permission_code: 'finance.report.export_restricted', effect: 'grant' },
        ],
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('separation_of_duties')
      // The refusal names the conflicting pair, so the administrator knows what to remove.
      expect(res.json().conflict).toMatchObject({
        rule: 'approval_and_publication',
        publication_permission: 'finance.publication.publish',
      })
      expect(res.json().conflict.approval_permission).toMatch(/^finance\..*\.approve$/)
      expect(res.json().message).toContain('finance.publication.publish')
    })

    test('the refused change wrote nothing: the transaction rolled back', async () => {
      const { rows } = await systemOf(app.pg).query(
        'SELECT permission_code, effect FROM finance.user_permission_override WHERE user_id = $1',
        [made.tempUserId],
      )
      expect(rows).toEqual([])
      const access = await app.inject({
        method: 'GET', url: `/api/finance/users/${made.tempUserId}/access`,
        headers: auth(as.technicalAdmin),
      })
      expect(access.statusCode).toBe(200)
      expect(access.json().data.permissions).not.toContain('finance.publication.publish')
    })

    test('the refusal is audited', async () => {
      const rows = await waitForRows(
        systemOf(app.pg),
        `SELECT actor_role, status, event, details
           FROM public.admin_audit_event
          WHERE path = $1 AND status = 409
          ORDER BY occurred_at DESC LIMIT 1`,
        [`/api/finance/users/${made.tempUserId}/access`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].actor_role).toBe('admin')
      expect(rows[0].details.refused).toBe('separation_of_duties')
      expect(rows[0].details.conflict.publication_permission).toBe('finance.publication.publish')
      expect(rows[0].details.reason).toMatch(/leave/)
    })

    test('the same conflict assembled the other way round is refused too', async () => {
      // A publisher (holds finance.publication.publish by default) granted an approval permission.
      const res = await putAccess(made.tempUserId, {
        role: 'publisher',
        reason: 'needs to approve revisions while the committee is away',
        overrides: [{ permission_code: 'finance.revision.approve', effect: 'grant' }],
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('separation_of_duties')
      expect(res.json().conflict.approval_permission).toBe('finance.revision.approve')
    })

    test('a grant that is cancelled by a deny in the same save is permitted', async () => {
      // The rule is about the RESULT, not about any one row: an officer who is given the
      // publication permission AND denied every approval permission holds only one of the two
      // duties, which is exactly what separation of duties asks for.
      //
      // "Every approval permission" is READ FROM THE CATALOGUE, not listed here. It used to be a
      // list of four, and the test began failing — correctly — the day migrations 203 and 205 gave
      // the committee `finance.ledger.close_year` and `finance.rates.tariff.approve`: the officer
      // then still held an approval alongside publication and the save was rightly refused. A
      // hard-coded list goes stale every time an approval is added; the role's own grants do not.
      const { rows: approvals } = await systemOf(app.pg).query(
        `SELECT rp.permission_code
           FROM finance.role_permission rp
           JOIN finance.permission p ON p.code = rp.permission_code
          WHERE rp.role_name = 'finance_committee' AND p.is_approval
          ORDER BY rp.permission_code`)
      const held = approvals.map((r) => r.permission_code)
      expect(held).toEqual(expect.arrayContaining([
        'finance.budget.approve', 'finance.revision.approve', 'finance.project.approve',
        'finance.publication.approve',
      ]))

      // Leave one approval standing and the save is still refused: the rule is over the result.
      const partial = await putAccess(made.tempUserId, {
        role: 'finance_committee',
        reason: 'publication cover, with all but one approval duty withdrawn',
        overrides: [
          { permission_code: 'finance.publication.publish', effect: 'grant' },
          ...held.slice(1).map((code) => ({ permission_code: code, effect: 'deny' })),
        ],
      })
      expect(partial.statusCode).toBe(409)
      expect(partial.json().error).toBe('separation_of_duties')

      const res = await putAccess(made.tempUserId, {
        role: 'finance_committee',
        reason: 'publication cover, with every approval duty withdrawn for the period',
        overrides: [
          { permission_code: 'finance.publication.publish', effect: 'grant' },
          ...held.map((code) => ({ permission_code: code, effect: 'deny' })),
        ],
      })
      expect(res.statusCode).toBe(200)
      const permissions = res.json().data.permissions
      expect(permissions).toContain('finance.publication.publish')
      expect(permissions).not.toContain('finance.budget.approve')
      expect(permissions).not.toContain('finance.publication.approve')
      for (const code of held) expect(permissions).not.toContain(code)
    })

    test('an ordinary access change still works', async () => {
      const res = await putAccess(made.tempUserId, {
        role: 'budget_officer',
        reason: 'moved to the budget office',
        overrides: [],
        department_ids: [made.deptId],
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.user.role).toBe('budget_officer')
      expect(res.json().data.department_scope.map((d) => d.id)).toEqual([made.deptId])
    })

    test('the technical administrator cannot be given financial authority', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT id FROM public.users WHERE email = 'demo.admin@vungu.test'`,
      )
      const res = await putAccess(rows[0].id, {
        reason: 'IT needs to approve the budget this once',
        overrides: [{ permission_code: 'finance.budget.approve', effect: 'grant' }],
      }, as.technicalAdmin)
      // Self-edit is refused first, which is also correct; what must never happen is a 200.
      expect([403, 409]).toContain(res.statusCode)
      expect(['self_access', 'separation_of_duties']).toContain(res.json().error)
      const { rows: overrides } = await systemOf(app.pg).query(
        'SELECT permission_code FROM finance.user_permission_override WHERE user_id = $1',
        [rows[0].id],
      )
      expect(overrides).toEqual([])
    })

    test('the database refuses the same combination written around the route', async () => {
      // The deferred constraint trigger, not the route: a future endpoint, a script or a
      // hand-written UPDATE gets the same answer.
      await expect(systemOf(app.pg).transact(async (client) => {
        await client.query('DELETE FROM finance.user_permission_override WHERE user_id = $1', [made.tempUserId])
        await client.query('UPDATE public.users SET role = $2 WHERE id = $1', [made.tempUserId, 'finance_committee'])
        await client.query(
          `INSERT INTO finance.user_permission_override (user_id, permission_code, effect, authority_id, granted_by)
           VALUES ($1, 'finance.publication.publish', 'grant', 1, $1)`,
          [made.tempUserId],
        )
      })).rejects.toThrow(/separation of duties/i)

      const { rows } = await systemOf(app.pg).query(
        'SELECT permission_code FROM finance.user_permission_override WHERE user_id = $1',
        [made.tempUserId],
      )
      expect(rows.map((r) => r.permission_code)).not.toContain('finance.publication.publish')
    })

    test('no role holds both duties by default, which is what the screen claims', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT rp.role_name
           FROM finance.role_permission rp JOIN finance.permission p ON p.code = rp.permission_code
          GROUP BY rp.role_name
         HAVING bool_or(p.is_approval) AND bool_or(p.is_publication)`,
      )
      expect(rows).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // BLOCKER-3 — withdrawing a document is a write, and the reason is kept
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  describe('BLOCKER-3: withdrawing a finance document', () => {
    test('the read-only auditor holds no write permission, including the withdrawal', async () => {
      const me = await app.inject({ method: 'GET', url: '/api/finance/me', headers: auth(as.auditor) })
      const permissions = me.json().data.permissions
      const writeLike = permissions.filter((p) => /\.(prepare|submit|approve|publish|withdraw|manage|commit|upload|resolve|explain|close|delete)$/.test(p))
      expect(writeLike).toEqual([])
      expect(permissions).toContain('finance.document.view')
      expect(permissions).not.toContain('finance.document.withdraw')
    })

    test('the auditor is refused the withdrawal, and told which permission it needs', async () => {
      const res = await app.inject({
        method: 'DELETE', url: `/api/finance/documents/${made.secondDocumentId}`,
        headers: auth(as.auditor), payload: { reason: 'duplicate' },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().required_permission).toBe('finance.document.withdraw')

      // And nothing happened to the document.
      const { rows } = await systemOf(app.pg).query(
        'SELECT deleted_at, withdrawn_reason FROM finance.document WHERE id = $1', [made.secondDocumentId],
      )
      expect(rows[0].deleted_at).toBeNull()
      expect(rows[0].withdrawn_reason).toBeNull()
    })

    test('the auditor refusal is audited', async () => {
      const rows = await waitForRows(
        systemOf(app.pg),
        `SELECT actor_role, status, event FROM public.admin_audit_event
          WHERE path = $1 AND status = 403 ORDER BY occurred_at DESC LIMIT 1`,
        [`/api/finance/documents/${made.secondDocumentId}`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].actor_role).toBe('auditor')
      expect(rows[0].event).toBe('FIN_DOCUMENT')
    })

    test('the publisher and the technical administrator are refused too', async () => {
      for (const [role, token] of [['publisher', as.publisher], ['admin', as.technicalAdmin]]) {
        const res = await app.inject({
          method: 'DELETE', url: `/api/finance/documents/${made.secondDocumentId}`,
          headers: auth(token), payload: { reason: 'tidying the register' },
        })
        expect({ role, status: res.statusCode }).toEqual({ role, status: 403 })
      }
    })

    test('a holder of the withdrawal permission succeeds, and the reason is kept on the row', async () => {
      const reason = 'Superseded by the signed copy; withdrawn at the Finance Director’s request'
      const res = await app.inject({
        method: 'DELETE', url: `/api/finance/documents/${made.secondDocumentId}`,
        headers: auth(as.financeOfficer), payload: { reason },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.withdrawn).toBe(true)
      expect(res.json().data.withdrawn_reason).toBe(reason)

      const { rows } = await systemOf(app.pg).query(
        'SELECT deleted_at, deleted_by, withdrawn_reason FROM finance.document WHERE id = $1',
        [made.secondDocumentId],
      )
      expect(rows[0].deleted_at).not.toBeNull()   // soft delete: the row and the file remain
      expect(rows[0].deleted_by).not.toBeNull()
      expect(rows[0].withdrawn_reason).toBe(reason)

      // The file is still on disk: the record is evidence (§8.1), this is not a hard delete.
      const { rows: key } = await systemOf(app.pg).query(
        'SELECT object_key FROM finance.document WHERE id = $1', [made.secondDocumentId],
      )
      expect(fs.existsSync(key[0].object_key)).toBe(true)
    })

    test('the reason reaches the audit trail', async () => {
      const rows = await waitForRows(
        systemOf(app.pg),
        `SELECT actor_role, status, event, details FROM public.admin_audit_event
          WHERE path = $1 AND status = 200 ORDER BY occurred_at DESC LIMIT 1`,
        [`/api/finance/documents/${made.secondDocumentId}`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].event).toBe('FIN_DOCUMENT')
      expect(rows[0].details.reason).toMatch(/Superseded by the signed copy/)
      expect(rows[0].details.before.deleted_at).toBeNull()
      expect(rows[0].details.after.withdrawn_reason).toMatch(/Superseded by the signed copy/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // B-1 — finance.spatial_allocation under the public session
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  describe('B-1: published_select on finance.spatial_allocation', () => {
    test('the policy exists', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT polname FROM pg_policy
          WHERE polrelid = 'finance.spatial_allocation'::regclass ORDER BY polname`,
      )
      expect(rows.map((r) => r.polname)).toContain('published_select')
    })

    test('an anonymous reader sees the approved split of a published line', async () => {
      const { rows } = await anonymousPg.query(
        `SELECT id, target_code, amount, status FROM finance.spatial_allocation
          WHERE target_code LIKE $1 ORDER BY target_code`, [`${TAG}%`],
      )
      expect(rows.map((r) => r.target_code)).toEqual([WARD_SPLIT])
      expect(rows[0].status).toBe('approved')
      expect(rows[0].amount).toBe('60000.00')
    })

    test('a draft split never reaches the public, and neither does an approved split of an unpublished line', async () => {
      const { rows } = await anonymousPg.query(
        'SELECT id FROM finance.spatial_allocation WHERE id = ANY($1::uuid[])',
        [[made.draftAllocationId, made.hiddenAllocationId]],
      )
      expect(rows).toEqual([])
    })

    test('the public ward attribution equals the staff reading, split for split', async () => {
      // The defect this test exists for: with no published_select policy the anonymous session saw
      // no allocation rows at all, so v_budget_ward_attribution's split_total CTE was empty and
      // the whole 100,000 line was attributed to its own ward_code — contradicting the staff map
      // and attributing to one ward money the Council allocated to another.
      const sql = `SELECT ward_code, basis, budget_amount, allocation_rows
                     FROM finance.v_budget_ward_attribution
                    WHERE financial_year_id = $1 AND currency = 'USD' AND ward_code = $2`
      const staff = await systemOf(app.pg).query(sql, [made.yearId, WARD_SPLIT])
      const publicRead = await anonymousPg.query(sql, [made.yearId, WARD_SPLIT])
      expect(staff.rows).toHaveLength(1)
      expect(staff.rows[0].basis).toBe('spatial_allocation')
      expect(staff.rows[0].budget_amount).toBe('60000.00')
      // Identical, split for split. Before migration 200 the anonymous read returned no row for
      // this ward at all, and the whole 100,000 appeared against the line's own ward_code.
      expect(publicRead.rows).toEqual(staff.rows)
    })

    test('withdrawing the budget publication takes the split off the public surface, with no code change', async () => {
      const withdrawn = await app.inject({
        method: 'POST', url: `/api/finance/publications/${made.budgetPublicationId}/withdraw`,
        headers: auth(as.publisher),
        payload: { reason: 'Withdrawn for the access-control regression check' },
      })
      expect(withdrawn.statusCode).toBe(200)
      try {
        const { rows } = await anonymousPg.query(
          'SELECT id FROM finance.spatial_allocation WHERE target_code LIKE $1', [`${TAG}%`],
        )
        expect(rows).toEqual([])
        const budget = await app.inject({
          method: 'GET', url: `/api/public/finance/budget?financial_year_id=${made.yearId}`,
        })
        expect(budget.json().data.total).toBe(0)
      } finally {
        // Put it back so the suite leaves the fixture as it found it.
        await systemOf(app.pg).query(
          `UPDATE finance.publication SET state = 'published', withdrawn_by = NULL,
                  withdrawn_at = NULL, withdraw_reason = NULL
            WHERE id = $1`, [made.budgetPublicationId],
        )
      }
    })
  })
})
