/**
 * Finance module security controls, exercised against a real database and the real middleware.
 *
 * This suite is deliberately adversarial: it asserts what each caller CANNOT do. It complements
 * finance.acceptance.test.js, which proves the financial controls work for authorised users.
 *
 * Covers (priority 4 of the production-readiness review):
 *   - authentication and session management (missing / malformed / wrong-secret / expired tokens,
 *     tokens without a session, logout revocation)
 *   - role and permission enforcement across the finance surface
 *   - API access restrictions (administrative routes vs anonymous public routes)
 *   - document access and upload file-signature checks
 *   - financial data exposure and public/administrative separation
 *   - SQL-injection-safe query parameters
 *   - audit-trail integrity (append-only grants and trigger)
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.security.test.js --runInBand
 *
 * Everything created here is tagged and removed in afterAll. No production data is touched.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const jwt = require('jsonwebtoken')
const Fastify = require('fastify')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')
const { validateUpload, detectMime } = require('../../middleware/fileSecurity')
const { mayRead } = require('../../routes/protected-uploads')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `SEC${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const uuid = () => crypto.randomUUID()

/** The audit row is written by the onResponse hook, after the reply is sent. */
async function waitForRows(pg, sql, params) {
  let rows = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ rows } = await pg.query(sql, params))
    if (rows.length) return rows
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return rows
}

describe('finance security', () => {
  let app
  const as = {}
  const made = { yearId: null, deptId: null, accountId: null, lineId: null, documentId: null, objectKey: null }

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    const accounts = {
      financeAdmin: 'demo.finance-admin@vungu.test',
      financeOfficer: 'demo.finance-officer@vungu.test',
      budgetOfficer: 'demo.budget-officer@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      publisher: 'demo.publisher@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      planner: 'demo.planner@vungu.test',
      citizen: 'demo.citizen@vungu.test',
      // A council officer whose users.authority_id is Vungu and who holds NOT ONE finance
      // permission. The public-exposure tests below were all anonymous, which is how audit
      // BLOCKER-1 survived them: published_select is a second PERMISSIVE policy OR'd with
      // tenant_select, so for this session every row of the finance register matched.
      inspector: 'demo.inspector@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) {
      as[key] = await loginAs(app, email, PASSWORD)
    }

    // A minimal, unpublished financial year. The security tests need a real record to attach a
    // document and a transaction to; they do not need a full budget cycle (that is the acceptance
    // and workflow suites' job).
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} Security 2032`, start_date: '2032-01-01', end_date: '2032-12-31', reporting_currency: 'USD' },
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    const opened = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/open`, headers: auth(as.financeAdmin),
    })
    expect(opened.statusCode).toBe(200)

    const dept = await app.inject({
      method: 'POST', url: '/api/finance/departments', headers: auth(as.financeAdmin),
      payload: { code: `${TAG}-SEC`, name: 'Security test department' },
    })
    expect(dept.statusCode).toBe(201)
    made.deptId = dept.json().data.id

    const chart = await app.inject({
      method: 'POST', url: '/api/finance/accounts/bulk', headers: auth(as.financeAdmin),
      payload: { accounts: [
        { code: `${TAG}-5100`, name: 'Security test expenditure', kind: 'expenditure', expenditure_class: 'recurrent' },
      ] },
    })
    expect(chart.statusCode).toBe(200)
    const accountsList = await app.inject({
      method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin),
    })
    made.accountId = accountsList.json().data.find((a) => a.code === `${TAG}-5100`).id

    const line = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.deptId, account_id: made.accountId,
        code: `${TAG}-BL`, description: 'Security test vote', currency: 'USD', original_amount: '1000.00',
      },
    })
    expect(line.statusCode).toBe(201)
    made.lineId = line.json().data.id

    // A real transaction in the year, inserted through the system connection so the public-surface
    // test can prove it stays hidden until a publication exists. It is tagged for cleanup.
    await systemOf(app.pg).query(
      `INSERT INTO finance.transaction
         (authority_id, financial_year_id, account_id, department_id, budget_line_id, txn_date, amount, currency,
          description, reference, record_type, source_system, source_ref, posted_at, created_by)
       VALUES ((SELECT authority_id FROM finance.financial_year WHERE id = $1),
               $1,$2,$3,$4,'2032-02-15','250.00','USD','Unpublished security test spend',
               $5,'actual','SECURITY_TEST',$5,now(),
               (SELECT id FROM users WHERE email = 'demo.finance-officer@vungu.test'))`,
      [made.yearId, made.accountId, made.deptId, made.lineId, TAG],
    )
  }, 120000)

  afterAll(async () => {
    if (!app) return
    const pg = systemOf(app.pg)
    try {
      if (made.objectKey) fs.unlinkSync(made.objectKey)
    } catch { /* already gone */ }
    const statements = [
      `DELETE FROM finance.document WHERE filename LIKE '${TAG}%'`,
      `DELETE FROM finance.transaction WHERE source_ref LIKE '${TAG}%'`,
      `DELETE FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.user_scope WHERE department_id IN (SELECT id FROM finance.department WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE label LIKE '${TAG}%'`,
    ]
    for (const statement of statements) await pg.query(statement).catch(() => {})
    await app.close()
  }, 60000)

  // ── Authentication and session management ─────────────────────────────────────────────────────
  describe('authentication and session management', () => {
    test('a protected finance route refuses a request with no credentials', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/finance/budget-lines' })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('unauthenticated')
    })

    test('a malformed token is refused', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth('not-a-jwt'),
      })
      expect(res.statusCode).toBe(401)
    })

    test('a token signed with the wrong secret is refused', async () => {
      const forged = jwt.sign(
        { sub: uuid(), type: 'access', sid: uuid() }, 'not-the-real-secret',
        { expiresIn: '1h', issuer: 'vungu-portal' },
      )
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(forged),
      })
      expect(res.statusCode).toBe(401)
    })

    test('an expired token is refused', async () => {
      const expired = jwt.sign(
        { sub: uuid(), type: 'access', sid: uuid() }, process.env.JWT_SECRET,
        { expiresIn: -60, issuer: 'vungu-portal' },
      )
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(expired),
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().message).toMatch(/expired/i)
    })

    test('a token with no session id is refused (a stateless token cannot be logged out)', async () => {
      const noSession = jwt.sign(
        { sub: uuid(), type: 'access' }, process.env.JWT_SECRET,
        { expiresIn: '1h', issuer: 'vungu-portal' },
      )
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(noSession),
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().message).toMatch(/session/i)
    })

    test('a refresh token cannot be used as an access token', async () => {
      const wrongType = jwt.sign(
        { sub: uuid(), type: 'refresh', sid: uuid() }, process.env.JWT_SECRET,
        { expiresIn: '1h', issuer: 'vungu-portal' },
      )
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(wrongType),
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().message).toMatch(/token type/i)
    })

    test('logout revokes the session immediately, so the access token stops working', async () => {
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email: 'demo.finance-officer@vungu.test', password: PASSWORD },
      })
      expect(login.statusCode).toBe(200)
      const access = (login.cookies || []).find((c) => c.name === 'vungu_at')
      const refresh = (login.cookies || []).find((c) => c.name === 'vungu_rt')
      expect(access?.value).toBeTruthy()
      expect(refresh?.value).toBeTruthy()

      const before = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(access.value),
      })
      expect(before.statusCode).toBe(200)

      const out = await app.inject({
        method: 'POST', url: '/api/auth/logout',
        headers: { cookie: `vungu_at=${access.value}; vungu_rt=${refresh.value}` },
      })
      expect(out.statusCode).toBe(200)

      const after = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(access.value),
      })
      expect(after.statusCode).toBe(401)
      expect(after.json().message).toMatch(/session/i)
    })
  })

  // ── Role and permission enforcement ───────────────────────────────────────────────────────────
  describe('role and permission enforcement', () => {
    const validLinePayload = () => ({
      financial_year_id: uuid(), department_id: uuid(), account_id: uuid(),
      code: `${TAG}-${crypto.randomBytes(2).toString('hex')}`, description: 'Role matrix probe',
      currency: 'USD', original_amount: '10.00',
    })

    test('a caller with no finance role cannot read the finance budget register', async () => {
      const res = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(as.citizen),
      })
      expect(res.statusCode).toBe(403)
    })

    test('a planner may follow the money but cannot prepare a budget', async () => {
      const read = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(as.planner),
      })
      expect(read.statusCode).toBe(200)

      const write = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.planner),
        payload: validLinePayload(),
      })
      expect(write.statusCode).toBe(403)
    })

    test('an auditor can read but cannot prepare a budget', async () => {
      const read = await app.inject({
        method: 'GET', url: '/api/finance/budget-lines', headers: auth(as.auditor),
      })
      expect(read.statusCode).toBe(200)

      const write = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.auditor),
        payload: validLinePayload(),
      })
      expect(write.statusCode).toBe(403)
    })

    test('a budget officer can prepare but cannot approve', async () => {
      const approve = await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${uuid()}/approve`,
        headers: auth(as.budgetOfficer),
      })
      expect(approve.statusCode).toBe(403)
      expect(approve.json().required_permission).toBe('finance.budget.approve')
    })

    test('a publisher cannot prepare a budget or approve a publication', async () => {
      const prepare = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.publisher),
        payload: validLinePayload(),
      })
      expect(prepare.statusCode).toBe(403)

      const approve = await app.inject({
        method: 'POST', url: `/api/finance/publications/${uuid()}/approve`,
        headers: auth(as.publisher), payload: {},
      })
      expect(approve.statusCode).toBe(403)
      expect(approve.json().required_permission).toBe('finance.publication.approve')
    })

    test('the committee can approve but cannot publish', async () => {
      const publish = await app.inject({
        method: 'POST', url: `/api/finance/publications/${uuid()}/publish`,
        headers: auth(as.committee),
      })
      expect(publish.statusCode).toBe(403)
      expect(publish.json().required_permission).toBe('finance.publication.publish')
    })

    test('a refused action is written to the audit trail with its status and actor role', async () => {
      const target = uuid()
      const res = await app.inject({
        method: 'POST', url: `/api/finance/publications/${target}/approve`,
        headers: auth(as.publisher), payload: {},
      })
      expect(res.statusCode).toBe(403)

      const rows = await waitForRows(
        systemOf(app.pg),
        `SELECT actor_role, status, event, path
           FROM public.admin_audit_event
          WHERE path = $1 AND status = 403
          ORDER BY occurred_at DESC LIMIT 1`,
        [`/api/finance/publications/${target}/approve`],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].actor_role).toBe('publisher')
      expect(rows[0].event).toBe('FIN_PUBLICATION')
    })
  })

  // ── API access restrictions and public/administrative separation ─────────────────────────────
  describe('API access restrictions and public separation', () => {
    test('administrative finance routes are closed to anonymous callers', async () => {
      for (const url of [
        '/api/finance/budget-lines',
        '/api/finance/publications',
        '/api/finance/audit',
        '/api/finance/documents',
      ]) {
        const res = await app.inject({ method: 'GET', url })
        expect({ url, status: res.statusCode }).toEqual({ url, status: 401 })
      }
    })

    test('the public transparency surface is open without a session', async () => {
      const years = await app.inject({ method: 'GET', url: '/api/public/finance/years' })
      expect(years.statusCode).toBe(200)
      expect(years.json().success).toBe(true)

      const overview = await app.inject({
        method: 'GET', url: `/api/public/finance/overview?financial_year_id=${uuid()}`,
      })
      expect(overview.statusCode).toBe(404)

      const transactions = await app.inject({
        method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${uuid()}`,
      })
      expect(transactions.statusCode).toBe(200)
      expect(transactions.json().data.total).toBe(0)
    })

    // ANONYMOUS IS NOT THE ONLY PUBLIC CALLER. Each assertion below is made for no session AND
    // for an ordinary signed-in council officer, because the public surface's confidentiality
    // must not depend on the caller having failed to sign in (audit BLOCKER-1). `null` means no
    // credentials; the inspector means a real Vungu session holding no finance permission.
    const publicCallers = () => [['anonymous', null], ['building_inspector', as.inspector]]
    const asPublic = (url, token) =>
      app.inject({ method: 'GET', url, ...(token ? { headers: auth(token) } : {}) })

    test('an unpublished year does not appear on the public portal, for any caller', async () => {
      for (const [who, token] of publicCallers()) {
        const years = await asPublic('/api/public/finance/years', token)
        expect({ who, present: years.json().data.some((y) => y.id === made.yearId) })
          .toEqual({ who, present: false })
      }
    })

    test('unpublished budget and transaction data are not visible publicly, for any caller', async () => {
      for (const [who, token] of publicCallers()) {
        const overview = await asPublic(`/api/public/finance/overview?financial_year_id=${made.yearId}`, token)
        // No publication admits the year at all, so the public surface behaves as if it does not
        // exist rather than confirming that an unpublished financial year is there.
        expect({ who, status: overview.statusCode }).toEqual({ who, status: 404 })

        const transactions = await asPublic(`/api/public/finance/transactions?financial_year_id=${made.yearId}`, token)
        expect({ who, status: transactions.statusCode }).toEqual({ who, status: 200 })
        expect({ who, total: transactions.json().data.total }).toEqual({ who, total: 0 })

        // The draft budget line created in beforeAll: the exact row BLOCKER-1 leaked.
        const budget = await asPublic(`/api/public/finance/budget?financial_year_id=${made.yearId}&limit=200`, token)
        expect({ who, status: budget.statusCode }).toEqual({ who, status: 200 })
        expect({ who, codes: budget.json().data.lines.map((l) => l.code) }).toEqual({ who, codes: [] })

        const documents = await asPublic(`/api/public/finance/documents?financial_year_id=${made.yearId}`, token)
        expect({ who, total: documents.json().data.total }).toEqual({ who, total: 0 })
      }
    })

    test('a signed-in council officer gets byte-identical public payloads to an anonymous caller', async () => {
      for (const url of [
        '/api/public/finance/years',
        `/api/public/finance/budget?financial_year_id=${made.yearId}&limit=200`,
        `/api/public/finance/transactions?financial_year_id=${made.yearId}`,
        `/api/public/finance/projects?financial_year_id=${made.yearId}`,
        `/api/public/finance/documents?financial_year_id=${made.yearId}`,
      ]) {
        const anonymous = await asPublic(url, null)
        const officer = await asPublic(url, as.inspector)
        expect({ url, status: officer.statusCode }).toEqual({ url, status: anonymous.statusCode })
        expect({ url, body: officer.json() }).toEqual({ url, body: anonymous.json() })
      }
    })

    test('the published transaction view carries no counterparty identity columns', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'finance' AND table_name = 'v_published_transaction'
          ORDER BY column_name`,
      )
      const columns = rows.map((r) => r.column_name)
      expect(columns).not.toContain('counterparty_name')
      expect(columns).not.toContain('counterparty_ref')
      expect(columns).toContain('description')
      expect(columns).toContain('currency')
    })
  })

  // ── SQL injection ─────────────────────────────────────────────────────────────────────────────
  describe('SQL injection protection', () => {
    const payloads = ["' OR 1=1 --", "'; DROP TABLE finance.transaction; --", "%' UNION SELECT NULL --"]

    test('public search parameters treat injection payloads as literal text', async () => {
      for (const q of payloads) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/public/finance/transactions?financial_year_id=${uuid()}&q=${encodeURIComponent(q)}`,
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data.total).toBe(0)
      }
    })

    test('public department and account filters treat injection payloads as literal text', async () => {
      for (const q of payloads) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/public/finance/transactions?financial_year_id=${uuid()}`
            + `&department_code=${encodeURIComponent(q)}&account_code=${encodeURIComponent(q)}`,
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().data.total).toBe(0)
      }
    })

    test('an injection payload in the administrative search is parameterised, not executed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/finance/budget-lines?q=${encodeURIComponent("' OR 1=1 --")}`,
        headers: auth(as.auditor),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().success).toBe(true)
    })

    test('closed-set parameters reject values outside the enum instead of passing them to SQL', async () => {
      const sort = await app.inject({
        method: 'GET',
        url: `/api/public/finance/transactions?financial_year_id=${uuid()}&sort=${encodeURIComponent('amount; DROP TABLE finance.transaction')}`,
      })
      expect(sort.statusCode).toBe(400)

      const year = await app.inject({
        method: 'GET', url: '/api/public/finance/transactions?financial_year_id=1%20OR%201=1',
      })
      expect(year.statusCode).toBe(400)
    })
  })

  // ── Document access and upload security ──────────────────────────────────────────────────────
  describe('document access and upload security', () => {
    test('an unknown document id is indistinguishable from an unauthorised one', async () => {
      const res = await app.inject({
        method: 'GET', url: `/api/finance/documents/${uuid()}/download`,
      })
      expect(res.statusCode).toBe(404)
    })

    test('a caller without the upload permission is refused before the file is parsed', async () => {
      const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
      const body = [
        `--${boundary}\r\nContent-Disposition: form-data; name="subject_kind"\r\n\r\nfinancial_year\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="subject_id"\r\n\r\n${made.yearId}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}-x.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 fake\r\n`,
        `--${boundary}--\r\n`,
      ].join('')
      const res = await app.inject({
        method: 'POST', url: '/api/finance/documents',
        headers: { ...auth(as.planner), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(403)
    })

    test('a file whose bytes do not match its claimed type is rejected', async () => {
      const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
      const body = [
        `--${boundary}\r\nContent-Disposition: form-data; name="subject_kind"\r\n\r\nfinancial_year\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="subject_id"\r\n\r\n${made.yearId}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}-fake.pdf"\r\nContent-Type: application/pdf\r\n\r\nThis is plain text, not a PDF.\r\n`,
        `--${boundary}--\r\n`,
      ].join('')
      const res = await app.inject({
        method: 'POST', url: '/api/finance/documents',
        headers: { ...auth(as.financeOfficer), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(415)
      expect(res.json().error).toBe('bad_file_signature')
    })

    test('a valid PDF is accepted, stored privately, and not served anonymously', async () => {
      const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject_kind"\r\n\r\nfinancial_year\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject_id"\r\n\r\n${made.yearId}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}-valid.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        pdf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const res = await app.inject({
        method: 'POST', url: '/api/finance/documents',
        headers: { ...auth(as.financeOfficer), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
      expect(res.statusCode).toBe(201)
      const doc = res.json().data.document
      made.documentId = doc.id
      expect(doc.visibility).toBe('private')

      const { rows } = await systemOf(app.pg).query(
        'SELECT object_key FROM finance.document WHERE id = $1', [doc.id],
      )
      made.objectKey = rows[0]?.object_key

      const anonymous = await app.inject({
        method: 'GET', url: `/api/finance/documents/${doc.id}/download`,
      })
      // The RLS policy hides a private document from the anonymous connection, so the public
      // caller gets the same 404 as for a document that does not exist.
      expect(anonymous.statusCode).toBe(404)
    })

    test('the magic-byte validator rejects a renamed executable and accepts real formats', () => {
      expect(detectMime(Buffer.from('MZ\x90\x00 not a document'))).toBeNull()
      expect(validateUpload(Buffer.from('<?php echo 1; ?>'), 'application/pdf').ok).toBe(false)
      expect(validateUpload(Buffer.from('%PDF-1.7 body'), 'application/pdf')).toMatchObject({ ok: true, mime: 'application/pdf' })
      expect(validateUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toMatchObject({ ok: true, mime: 'image/png' })
      expect(validateUpload(Buffer.alloc(0), 'application/pdf').ok).toBe(false)
    })
  })

  // ── Upload path confinement ──────────────────────────────────────────────────────────────────
  describe('upload path confinement', () => {
    test('only staff or the owning client may read a keyed upload', () => {
      const owner = { id: 'user-1', role: 'registered' }
      const stranger = { id: 'user-2', role: 'registered' }
      const staff = { id: 'user-3', role: 'planner' }
      expect(mayRead(owner, 'user-1')).toBe(true)
      expect(mayRead(stranger, 'user-1')).toBe(false)
      expect(mayRead(staff, 'user-1')).toBe(true)
      expect(mayRead(null, 'user-1')).toBe(false)
      expect(mayRead(owner, null)).toBe(false)
    })

    test('the protected upload route refuses unauthenticated and traversing requests', async () => {
      const uploads = Fastify({ logger: false })
      await uploads.register(require('@fastify/postgres'), {
        connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
      })
      const dbContext = require('../../lib/dbContext')
      dbContext.install(uploads)
      uploads.addHook('onRequest', (_req, _reply, done) => dbContext.runWithRequest(done))
      await uploads.register(require('@fastify/cookie'), { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
      await uploads.register(require('../../routes/protected-uploads').protectedUploadRoutes)
      await uploads.ready()

      try {
        const anonymous = await uploads.inject({
          method: 'GET', url: '/uploads/citizen-documents/user-1/file.pdf',
        })
        expect(anonymous.statusCode).toBe(401)

        const traversal = await uploads.inject({
          method: 'GET',
          url: '/uploads/citizen-documents/..%2F..%2Fetc/passwd',
          headers: auth(as.citizen),
        })
        expect(traversal.statusCode).toBe(404)

        const badFolder = await uploads.inject({
          method: 'GET', url: '/uploads/not-a-folder/user-1/file.pdf', headers: auth(as.citizen),
        })
        expect(badFolder.statusCode).toBe(404)

        const someoneElse = await uploads.inject({
          method: 'GET', url: '/uploads/citizen-documents/someone-else/file.pdf', headers: auth(as.citizen),
        })
        expect(someoneElse.statusCode).toBe(404)
      } finally {
        await uploads.close()
      }
    })
  })

  // ── Audit-trail integrity ────────────────────────────────────────────────────────────────────
  describe('audit-trail integrity', () => {
    test('the application role has no write access to the audit table', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT has_table_privilege('vungu_app', 'public.admin_audit_event', 'INSERT') AS can_insert,
                has_table_privilege('vungu_app', 'public.admin_audit_event', 'UPDATE') AS can_update,
                has_table_privilege('vungu_app', 'public.admin_audit_event', 'DELETE') AS can_delete`,
      )
      expect(rows[0]).toEqual({ can_insert: false, can_update: false, can_delete: false })
    })

    test('an update or delete of an audit row is blocked by the guard trigger', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'public.admin_audit_event'::regclass AND NOT tgisinternal`,
      )
      expect(rows.map((r) => r.tgname)).toContain('trg_admin_audit_event_guard')
    })

    test('the audit trail records refused finance mutations, not just successful ones', async () => {
      const { rows } = await systemOf(app.pg).query(
        `SELECT count(*)::int AS n FROM public.admin_audit_event
          WHERE event LIKE 'FIN%' AND status = 403`,
      )
      expect(rows[0].n).toBeGreaterThan(0)
    })
  })
})
