# Citizen Application Fee via Paynow (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `payments` infrastructure to a real Paynow Express Checkout so a citizen submitting a new permit application can pay the council application fee with EcoCash / OneMoney / InnBucks from their phone, and the planner only sees the row once the fee clears.

**Architecture:** Two repos. Backend (`app-backend`, Fastify + Postgres + Jest) implements the Paynow driver, extends `applyPaid` with an `application_fee` branch, and gates planner visibility on `status='pending_payment'`. Frontend (`app-frontend`, Vue 3 + Pinia + Vitest) ships a `PaymentMethodPicker` component, a `PaymentInitView` wrapper route at `/payment/new`, and rewires the citizen wizard, `PaymentGatewayView`, and `PaymentsSection` to the real `payments` row.

**Tech Stack:** Backend — Node 22, Fastify 5, `@fastify/postgres`, `pg`, Jest 29, `nock` (new dep). Frontend — Vue 3, Pinia 2, axios, Vitest 4 + happy-dom + @vue/test-utils, lucide-vue-next.

**Spec:** [docs/superpowers/specs/2026-05-31-citizen-application-fee-paynow-design.md](../specs/2026-05-31-citizen-application-fee-paynow-design.md)

---

## File map

Backend (`app-backend/`):
- `migrations/077_permit_application_pending_payment.sql` (new) — status enum + `fee_paid_at`.
- `src/services/paymentDriver.js` (modify) — replace `paynowDriver` stub with real implementation.
- `src/routes/payments.js` (modify) — `applyPaid` branch for `application_fee`, new `POST /api/payments/:id/poll`, `relatedKind/relatedId` filters on `GET /api/payments`.
- `src/routes/development-management.js` (modify) — accept `pay_intent` on permit create, exclude `pending_payment` from planner queue by default.
- `src/services/__tests__/paymentDriver.paynow.test.js` (new).
- `src/routes/__tests__/payments.applicationfee.test.js` (new).
- `src/routes/__tests__/permit-applications.pending-payment.test.js` (new).
- `.env.example` (modify) — Paynow env-var keys.

Frontend (`app-frontend/`):
- `src/components/PaymentMethodPicker.vue` (new) — shared picker UI.
- `src/views/PaymentInitView.vue` (new) — `/payment/new` route wrapper.
- `src/views/PaymentGatewayView.vue` (modify) — repurpose as awaiting/success only.
- `src/views/citizen/sections/NewApplicationSection.vue` (modify) — Submit & pay step.
- `src/views/citizen/sections/PaymentsSection.vue` (modify) — Pay-now routing.
- `src/services/paymentsService.ts` (modify) — `poll(id)`, `listForRelated(kind, id)`.
- `src/composables/useCitizenCase.ts` (modify) — `submitDraft(id, { payIntent })`.
- `src/router/index.ts` (modify) — register `/payment/new`.
- `src/components/__tests__/PaymentMethodPicker.spec.ts` (new).
- `src/views/__tests__/PaymentInitView.spec.ts` (new).
- `src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts` (new).
- `src/views/__tests__/PaymentGatewayView.awaiting.spec.ts` (new).

---

## Task 1: Migration 077 — `pending_payment` status + `fee_paid_at`

**Files:**
- Create: `app-backend/migrations/077_permit_application_pending_payment.sql`

- [ ] **Step 1: Write the migration**

```sql
BEGIN;

ALTER TABLE spatial_planning.permit_application
  DROP CONSTRAINT IF EXISTS permit_application_status_check;

ALTER TABLE spatial_planning.permit_application
  ADD  CONSTRAINT permit_application_status_check
  CHECK (status IN (
    'pending_payment',
    'registered',
    'acknowledged',
    'circulation',
    'objection_period',
    'under_review',
    'deferred',
    'approved',
    'approved_with_conditions',
    'refused',
    'withdrawn',
    'appealed'
  ));

ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS fee_paid_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_permit_app_status_received
  ON spatial_planning.permit_application(status, received_at DESC);

COMMIT;
```

- [ ] **Step 2: Apply the migration**

```bash
cd app-backend
psql "$DATABASE_URL" -f migrations/077_permit_application_pending_payment.sql
```

Expected: `BEGIN`, three `ALTER TABLE` lines, `CREATE INDEX`, `COMMIT`. No errors.

- [ ] **Step 3: Verify the schema**

```bash
psql "$DATABASE_URL" -c "\d spatial_planning.permit_application" | grep -E "fee_paid_at|status_check"
```

Expected: `fee_paid_at | timestamp with time zone` and the CHECK constraint mentioning `pending_payment`.

- [ ] **Step 4: Commit**

```bash
git add migrations/077_permit_application_pending_payment.sql
git commit -m "feat(dm-migration): add pending_payment status and fee_paid_at column

Slice A of the citizen application-fee flow holds a permit row in
pending_payment until Paynow confirms the fee. The migration extends
the status CHECK and adds the fee timestamp the planner case header
reads."
```

---

## Task 2: Backend — `nock` dev dependency

**Files:**
- Modify: `app-backend/package.json`

- [ ] **Step 1: Install nock**

```bash
cd app-backend
npm install --save-dev nock@^13.5.4
```

- [ ] **Step 2: Smoke-check**

```bash
node -e "console.log(require('nock').name)"
```

Expected: `Scope` (the exported class) or similar non-error output.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add nock for Paynow HTTP-driver tests"
```

---

## Task 3: Backend — Paynow driver `initPayment`

**Files:**
- Create: `app-backend/src/services/__tests__/paymentDriver.paynow.test.js`
- Modify: `app-backend/src/services/paymentDriver.js`

- [ ] **Step 1: Write the failing test**

`app-backend/src/services/__tests__/paymentDriver.paynow.test.js`:

```js
const nock = require('nock')
const { getDriver } = require('../paymentDriver')

beforeAll(() => {
  process.env.PAYNOW_INTEGRATION_ID  = '12345'
  process.env.PAYNOW_INTEGRATION_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  process.env.PAYNOW_RESULT_URL      = 'https://example.test/api/payments/webhook/paynow'
  process.env.PAYNOW_RETURN_URL      = 'https://example.test/payment/return'
  process.env.PAYNOW_API_BASE        = 'https://www.paynow.co.zw'
})
afterEach(() => nock.cleanAll())

describe('paynowDriver.initPayment', () => {
  it('POSTs Express Checkout with the wallet method and parses the poll URL', async () => {
    nock('https://www.paynow.co.zw')
      .post('/interface/remotetransaction', body => {
        return /method=ecocash/i.test(body)
          && /phone=263771234567/.test(body)
          && /amount=25\.00/.test(body)
          && /hash=[A-F0-9]{128}/.test(body)
      })
      .reply(200,
        'status=Ok&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2FInterface%2FCheckPayment%2F%3Fguid%3DAAA&hash=DEADBEEF')

    const driver = getDriver('paynow')
    const result = await driver.initPayment({
      payment: {
        id:           'b8b3a9e0-1111-2222-3333-444444444444',
        amount_usd:   '25.00',
        wallet_ccy:   'USD',
        payer_email:  'demo.viewer@vungu.test',
        metadata:     { phone: '+263771234567', wallet: 'ecocash' },
      },
    })

    expect(result.providerRef).toBe('https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA')
    expect(result.providerStatus).toBe('sent')
    expect(result.redirectUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js -t "POSTs Express Checkout"
```

Expected: FAIL — current stub throws `driver_not_implemented`.

- [ ] **Step 3: Implement `initPayment`**

In `app-backend/src/services/paymentDriver.js`, below the existing `manualDriver` block, add:

```js
// ════════════════════════════════════════════════════════════════════
// Paynow driver — Express Checkout (mobile money) + future Web Initiate.
// ════════════════════════════════════════════════════════════════════
const PAYNOW_API_BASE = () => process.env.PAYNOW_API_BASE || 'https://www.paynow.co.zw'
const PAYNOW_ID       = () => process.env.PAYNOW_INTEGRATION_ID
const PAYNOW_KEY      = () => process.env.PAYNOW_INTEGRATION_KEY
const PAYNOW_RETURN   = () => process.env.PAYNOW_RETURN_URL
const PAYNOW_RESULT   = () => process.env.PAYNOW_RESULT_URL

function paynowHash(fields, integrationKey) {
  const concat = Object.values(fields).join('') + integrationKey
  return crypto.createHash('sha512').update(concat, 'utf8').digest('hex').toUpperCase()
}

function paynowParse(body) {
  const out = {}
  for (const pair of String(body).split('&')) {
    const [k, v] = pair.split('=')
    if (k) out[k.toLowerCase()] = decodeURIComponent((v || '').replace(/\+/g, ' '))
  }
  return out
}

const paynowDriver = {
  name: 'paynow',

  async initPayment({ payment }) {
    const wallet = String(payment?.metadata?.wallet || '').toLowerCase()
    const phone  = String(payment?.metadata?.phone  || '').replace(/^\+/, '')
    if (!['ecocash', 'onemoney', 'innbucks'].includes(wallet)) {
      throw Object.assign(new Error('paynow: unsupported wallet'), { code: 'bad_wallet' })
    }
    if (!/^263(71|73|77|78|86)\d{7}$/.test(phone)) {
      throw Object.assign(new Error('paynow: bad phone for wallet'), { code: 'bad_phone' })
    }

    const amount = payment.wallet_ccy === 'USD'
      ? Number(payment.amount_usd).toFixed(2)
      : Number(payment.amount_zwg).toFixed(2)

    const fields = {
      id:             PAYNOW_ID(),
      reference:      String(payment.id),
      amount:         amount,
      additionalinfo: `Vungu RDC application fee ${payment.id}`,
      returnurl:      PAYNOW_RETURN(),
      resulturl:      PAYNOW_RESULT(),
      authemail:      payment.payer_email || '',
      phone:          phone,
      method:         wallet,
      status:         'Message',
    }
    fields.hash = paynowHash(fields, PAYNOW_KEY())

    const body = new URLSearchParams(fields).toString()
    const res = await fetch(`${PAYNOW_API_BASE()}/interface/remotetransaction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const text = await res.text()
    const parsed = paynowParse(text)

    if (String(parsed.status || '').toLowerCase() !== 'ok' || !parsed.pollurl) {
      const e = new Error(`paynow init failed: ${parsed.error || parsed.status || text}`)
      e.code = 'paynow_init_failed'
      throw e
    }

    return {
      providerRef:    parsed.pollurl,
      providerStatus: 'sent',
      redirectUrl:    null,
    }
  },

  async pollPayment({ payment }) { throw NOT_IMPLEMENTED('paynow.pollPayment') },
  async verifyWebhook()          { throw NOT_IMPLEMENTED('paynow.verifyWebhook') },
  async refund()                 { throw NOT_IMPLEMENTED('paynow.refund') },
}
```

Then update the `DRIVERS` map so `paynow` references the new object instead of `makeStubDriver('paynow')`:

```js
const DRIVERS = {
  manual:   manualDriver,
  paynow:   paynowDriver,
  stripe:   stripeDriver,
  ecocash:  ecocashDriver,
  onemoney: onemoneyDriver,
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js -t "POSTs Express Checkout"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentDriver.js src/services/__tests__/paymentDriver.paynow.test.js
git commit -m "feat(paynow): implement initPayment for Express Checkout

Builds an SHA-512-hashed urlencoded request, posts to
/interface/remotetransaction, parses status=Ok&pollurl=... into the
providerRef/providerStatus shape the payments route expects. pollPayment
and verifyWebhook still stubbed; followed up in the next tasks."
```

---

## Task 4: Backend — Paynow driver `pollPayment`

**Files:**
- Modify: `app-backend/src/services/__tests__/paymentDriver.paynow.test.js`
- Modify: `app-backend/src/services/paymentDriver.js`

- [ ] **Step 1: Add the failing tests**

Append to the same test file:

```js
describe('paynowDriver.pollPayment', () => {
  it('maps Paid → { paid:true }', async () => {
    nock('https://www.paynow.co.zw')
      .get('/Interface/CheckPayment/').query(true)
      .reply(200,
        'reference=ref&paynowreference=PN1&amount=25.00&status=Paid&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2FInterface%2FCheckPayment%2F%3Fguid%3DAAA&hash=ZZ')
    const driver = getDriver('paynow')
    const r = await driver.pollPayment({
      payment: { provider_ref: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA' },
    })
    expect(r.paid).toBe(true)
    expect(r.providerStatus).toBe('Paid')
  })

  it('maps Sent → { paid:false }', async () => {
    nock('https://www.paynow.co.zw')
      .get('/Interface/CheckPayment/').query(true)
      .reply(200, 'reference=ref&status=Sent&hash=ZZ')
    const driver = getDriver('paynow')
    const r = await driver.pollPayment({
      payment: { provider_ref: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA' },
    })
    expect(r.paid).toBe(false)
    expect(r.providerStatus).toBe('Sent')
  })

  it('maps Cancelled → { paid:false }', async () => {
    nock('https://www.paynow.co.zw')
      .get('/Interface/CheckPayment/').query(true)
      .reply(200, 'reference=ref&status=Cancelled&hash=ZZ')
    const driver = getDriver('paynow')
    const r = await driver.pollPayment({
      payment: { provider_ref: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA' },
    })
    expect(r.paid).toBe(false)
    expect(r.providerStatus).toBe('Cancelled')
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js -t "pollPayment"
```

Expected: 3 FAIL — driver throws `paynow.pollPayment is not implemented`.

- [ ] **Step 3: Implement `pollPayment`**

In `paymentDriver.js`, replace the `pollPayment` line in `paynowDriver`:

```js
async pollPayment({ payment }) {
  if (!payment?.provider_ref) {
    throw Object.assign(new Error('paynow: missing provider_ref'), { code: 'no_provider_ref' })
  }
  const res = await fetch(payment.provider_ref, { method: 'GET' })
  const parsed = paynowParse(await res.text())
  const status = String(parsed.status || '')
  const paidish = ['Paid', 'Awaiting Delivery', 'Delivered']
  return {
    providerStatus: status,
    paid:           paidish.includes(status),
    paidAt:         paidish.includes(status) ? new Date().toISOString() : null,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js -t "pollPayment"
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentDriver.js src/services/__tests__/paymentDriver.paynow.test.js
git commit -m "feat(paynow): implement pollPayment for status checks

GETs the provider_ref poll URL, decodes Paynow's status string into our
paid/pending/cancelled enum. Used by the citizen 'Check now' button and
the awaiting screen's manual refresh."
```

---

## Task 5: Backend — Paynow driver `verifyWebhook`

**Files:**
- Modify: `app-backend/src/services/__tests__/paymentDriver.paynow.test.js`
- Modify: `app-backend/src/services/paymentDriver.js`

- [ ] **Step 1: Add the failing tests**

Append to the test file:

```js
describe('paynowDriver.verifyWebhook', () => {
  function signedBody(fields) {
    const concat = Object.values(fields).join('')
      + process.env.PAYNOW_INTEGRATION_KEY
    const hash = require('crypto').createHash('sha512')
      .update(concat, 'utf8').digest('hex').toUpperCase()
    return new URLSearchParams({ ...fields, hash }).toString()
  }

  it('accepts a correctly-hashed Paid callback', async () => {
    const fields = {
      reference:       'ref',
      paynowreference: 'PN1',
      amount:          '25.00',
      additionalinfo:  'fee',
      status:          'Paid',
      pollurl:         'https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA',
    }
    const raw = signedBody(fields)
    const driver = getDriver('paynow')
    const v = await driver.verifyWebhook({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    Object.fromEntries(new URLSearchParams(raw)),
      rawBody: raw,
    })
    expect(v.ok).toBe(true)
    expect(v.paid).toBe(true)
    expect(v.providerRef).toBe(fields.pollurl)
    expect(v.providerStatus).toBe('Paid')
  })

  it('rejects a tampered Paid callback', async () => {
    const fields = {
      reference: 'ref', paynowreference: 'PN1', amount: '25.00',
      additionalinfo: 'fee', status: 'Paid',
      pollurl: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=AAA',
    }
    const raw = signedBody(fields)
    const tampered = raw.replace('amount=25.00', 'amount=0.01')
    const driver = getDriver('paynow')
    const v = await driver.verifyWebhook({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    Object.fromEntries(new URLSearchParams(tampered)),
      rawBody: tampered,
    })
    expect(v.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js -t "verifyWebhook"
```

Expected: 2 FAIL.

- [ ] **Step 3: Implement `verifyWebhook`**

Replace the `verifyWebhook` line in `paynowDriver`:

```js
async verifyWebhook({ body, rawBody }) {
  const incoming = (body && typeof body === 'object' && Object.keys(body).length)
    ? body
    : paynowParse(rawBody || '')
  const claimed = String(incoming.hash || '').toUpperCase()
  if (!claimed) return { ok: false }

  const fields = { ...incoming }
  delete fields.hash
  // Paynow hashes the values in the order they appear in the request.
  // URLSearchParams preserves insertion order; rebuild from raw body so
  // we honour the caller's order rather than JS object-key order.
  const ordered = {}
  for (const pair of String(rawBody || '').split('&')) {
    const [k] = pair.split('=')
    if (k && k !== 'hash' && k in fields) ordered[k] = fields[k]
  }
  const recomputed = paynowHash(ordered, PAYNOW_KEY())

  const a = Buffer.from(recomputed, 'utf8')
  const b = Buffer.from(claimed, 'utf8')
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) return { ok: false }

  const status = String(incoming.status || '')
  const paidish = ['Paid', 'Awaiting Delivery', 'Delivered']
  return {
    ok:             true,
    providerRef:    incoming.pollurl || null,
    providerStatus: status,
    paid:           paidish.includes(status),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/services/__tests__/paymentDriver.paynow.test.js
```

Expected: 6 PASS (all paynow tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentDriver.js src/services/__tests__/paymentDriver.paynow.test.js
git commit -m "feat(paynow): implement verifyWebhook with constant-time hash check

Recomputes the SHA-512 from rawBody field order (matching Paynow's
canonical order), compares with crypto.timingSafeEqual. Returns ok:false
on any mismatch so the route can reject without writing."
```

---

## Task 6: Backend — `payments` route extensions

**Files:**
- Create: `app-backend/src/routes/__tests__/payments.routes.test.js`
- Create: `app-backend/test/helpers/buildApp.js`
- Create: `app-backend/test/helpers/auth.js`
- Modify: `app-backend/src/routes/payments.js`

- [ ] **Step 1: Add test helpers**

If `app-backend/test/helpers/` does not exist, create the two helpers below. The implementer mirrors how `server.js` registers routes; if the project doesn't yet have a `buildAppForTest` factory, copy the route registration block from `server.js` into a new `server-test-bootstrap.js` that exports `registerAllRoutes(app)` so the test can boot a Fastify instance without listening.

`app-backend/test/helpers/buildApp.js`:

```js
require('dotenv').config()
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const { paymentRoutes } = require('../../src/routes/payments')
const { authRoutes } = require('../../src/routes/auth')
const { developmentManagementRoutes } = require('../../src/routes/development-management')

async function buildAppForTest() {
  const app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  await app.register(async (scope) => {
    await authRoutes(scope)
    await paymentRoutes(scope)
    await developmentManagementRoutes(scope)
  }, { prefix: '/api' })
  await app.ready()
  return app
}
module.exports = { buildAppForTest }
```

`app-backend/test/helpers/auth.js`:

```js
async function loginAs(app, email, password) {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login',
    payload: { email, password },
  })
  const body = res.json()
  if (!body.success) throw new Error(`login failed: ${JSON.stringify(body)}`)
  return body.data.token
}
module.exports = { loginAs }
```

- [ ] **Step 2: Write the failing test**

`app-backend/src/routes/__tests__/payments.routes.test.js`:

```js
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs }         = require('../../../test/helpers/auth')

describe('payments routes', () => {
  let app
  beforeAll(async () => { app = await buildAppForTest() })
  afterAll(async () => { await app.close() })

  it('GET /api/payments accepts relatedKind/relatedId filters', async () => {
    const token = await loginAs(app, 'demo.viewer@vungu.test', 'demo1234')
    const res = await app.inject({
      method:  'GET',
      url:     '/api/payments?relatedKind=permit&relatedId=00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('POST /api/payments/:id/poll returns 404 for unknown id', async () => {
    const token = await loginAs(app, 'demo.viewer@vungu.test', 'demo1234')
    const res = await app.inject({
      method:  'POST',
      url:     '/api/payments/11111111-1111-1111-1111-111111111111/poll',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: Run the test to verify the poll test fails**

```bash
cd app-backend
npx jest src/routes/__tests__/payments.routes.test.js
```

Expected: the GET test passes (existing route returns empty list); the POST test FAILS because the route does not exist yet (Fastify's default 404 path).

- [ ] **Step 4: Add the filters and the new route**

In `src/routes/payments.js`, locate `fastify.get('/payments', …)` (~line 207). Replace its body:

```js
fastify.get('/payments', { preHandler: requireAuth(fastify) }, async (request, reply) => {
  try {
    const { relatedKind, relatedId } = request.query || {}
    const params = [request.user.id]
    let where = 'payer_id = $1'
    if (relatedKind) { params.push(relatedKind); where += ` AND related_kind = $${params.length}` }
    if (relatedId)   { params.push(relatedId);   where += ` AND related_id   = $${params.length}` }
    const { rows } = await fastify.pg.query(
      `SELECT * FROM payments WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params,
    )
    return reply.send({ success: true, data: rows.map(paymentDTO) })
  } catch (err) {
    request.log.error({ err }, 'payment list failed')
    return reply.code(500).send({ success: false, error: 'internal' })
  }
})
```

Directly below the existing `/payments/:id/confirm` route (~line 250), add:

```js
fastify.post('/payments/:id/poll', { preHandler: requireAuth(fastify) }, async (request, reply) => {
  try {
    const { rows } = await fastify.pg.query(
      `SELECT * FROM payments WHERE id = $1`,
      [request.params.id],
    )
    const row = rows[0]
    if (!row) return reply.code(404).send({ success: false, error: 'not_found' })
    const u = request.user
    const isStaff = ['admin', 'planner', 'eo', 'planning_clerk'].includes(u.role)
    if (row.payer_id !== u.id && !isStaff) {
      return reply.code(403).send({ success: false, error: 'forbidden' })
    }

    const driver = driverModule.getDriver(row.driver)
    const verdict = await driver.pollPayment({ payment: row })

    await fastify.pg.query(
      `UPDATE payments SET provider_status = $2, updated_at = NOW() WHERE id = $1`,
      [row.id, verdict.providerStatus || null],
    )
    if (verdict.paid && row.status !== 'paid') {
      await applyPaid(fastify, row, request.user.id)
    }

    const fresh = await fastify.pg.query(`SELECT * FROM payments WHERE id = $1`, [row.id])
    return reply.send({ success: true, data: paymentDTO(fresh.rows[0]) })
  } catch (err) {
    request.log.error({ err }, 'payment poll failed')
    return reply.code(500).send({ success: false, error: 'internal' })
  }
})
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/routes/__tests__/payments.routes.test.js
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/payments.js src/routes/__tests__/payments.routes.test.js test/helpers/
git commit -m "feat(payments): add /poll route and relatedKind/relatedId filters

The frontend uses POST /api/payments/:id/poll for the 'Check now' button
on the awaiting screen and GET /api/payments?relatedKind=permit&relatedId=…
to find the latest payment for an outstanding permit row."
```

---

## Task 7: Backend — `applyPaid` branch for `application_fee`

**Files:**
- Create: `app-backend/src/routes/__tests__/payments.applicationfee.test.js`
- Modify: `app-backend/src/routes/payments.js`

- [ ] **Step 1: Write the failing tests**

```js
const nock = require('nock')
const crypto = require('crypto')
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs }         = require('../../../test/helpers/auth')

describe('application fee payment lifecycle', () => {
  let app, token

  beforeAll(async () => {
    process.env.PAYNOW_INTEGRATION_ID  = '12345'
    process.env.PAYNOW_INTEGRATION_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    process.env.PAYNOW_RESULT_URL      = 'https://example.test/api/payments/webhook/paynow'
    process.env.PAYNOW_RETURN_URL      = 'https://example.test/payment/return'
    process.env.PAYNOW_API_BASE        = 'https://www.paynow.co.zw'
    app = await buildAppForTest()
    token = await loginAs(app, 'demo.viewer@vungu.test', 'demo1234')
  })
  afterAll(async () => { await app.close() })
  afterEach(() => nock.cleanAll())

  async function setupPaidFlow() {
    const client = await app.pg.connect()
    let permitId, paymentId, pollUrl, rawBody
    try {
      const created = await client.query(
        `INSERT INTO spatial_planning.permit_application
           (applicant_name, applicant_email, development_type, status, created_by)
         VALUES ('App Fee Smoke', 'demo.viewer@vungu.test', 'new_building',
                 'pending_payment',
                 (SELECT id FROM users WHERE email = 'demo.viewer@vungu.test'))
         RETURNING id`,
      )
      permitId = created.rows[0].id

      nock('https://www.paynow.co.zw')
        .post('/interface/remotetransaction')
        .reply(200,
          'status=Ok&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2FInterface%2FCheckPayment%2F%3Fguid%3DZZ&hash=AA')

      const initRes = await app.inject({
        method:  'POST', url: '/api/payments',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          purpose:     'application_fee',
          relatedKind: 'permit',
          relatedId:   permitId,
          priceUsd:    25,
          walletCcy:   'USD',
          driver:      'paynow',
          metadata:    { phone: '+263771234567', wallet: 'ecocash' },
        },
      })
      paymentId = initRes.json().data.id
      pollUrl   = initRes.json().data.providerRef

      const fields = {
        reference: paymentId, paynowreference: 'PN1', amount: '25.00',
        additionalinfo: 'fee', status: 'Paid', pollurl: pollUrl,
      }
      const concat = Object.values(fields).join('') + process.env.PAYNOW_INTEGRATION_KEY
      const hash = crypto.createHash('sha512').update(concat, 'utf8').digest('hex').toUpperCase()
      rawBody = new URLSearchParams({ ...fields, hash }).toString()
    } finally { client.release() }
    return { permitId, paymentId, pollUrl, rawBody }
  }

  it('webhook flips permit pending_payment → registered and stamps fee_paid_at', async () => {
    const { permitId, paymentId, rawBody } = await setupPaidFlow()
    const client = await app.pg.connect()
    try {
      const hookRes = await app.inject({
        method:  'POST', url: '/api/payments/webhook/paynow',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: rawBody,
      })
      expect(hookRes.statusCode).toBe(200)

      const after = await client.query(
        `SELECT status, fee_paid_at FROM spatial_planning.permit_application WHERE id = $1`,
        [permitId],
      )
      expect(after.rows[0].status).toBe('registered')
      expect(after.rows[0].fee_paid_at).not.toBeNull()

      const pay = await client.query(`SELECT * FROM payments WHERE id = $1`, [paymentId])
      expect(pay.rows[0].status).toBe('paid')
      expect(pay.rows[0].issued_receipt_no).toMatch(/^VRDC-\d{4}-\d{6}$/)
    } finally {
      await client.query(`DELETE FROM payments WHERE id = $1`, [paymentId])
      await client.query(`DELETE FROM spatial_planning.permit_application WHERE id = $1`, [permitId])
      client.release()
    }
  })

  it('replaying the same webhook does not double-stamp', async () => {
    const { permitId, paymentId, rawBody } = await setupPaidFlow()
    const client = await app.pg.connect()
    try {
      await app.inject({
        method:  'POST', url: '/api/payments/webhook/paynow',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: rawBody,
      })
      const firstReceipt = (await client.query(
        `SELECT issued_receipt_no FROM payments WHERE id = $1`, [paymentId])).rows[0].issued_receipt_no
      expect(firstReceipt).toMatch(/^VRDC-\d{4}-\d{6}$/)

      const replay = await app.inject({
        method:  'POST', url: '/api/payments/webhook/paynow',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: rawBody,
      })
      expect(replay.statusCode).toBe(200)
      const secondReceipt = (await client.query(
        `SELECT issued_receipt_no FROM payments WHERE id = $1`, [paymentId])).rows[0].issued_receipt_no
      expect(secondReceipt).toBe(firstReceipt)
    } finally {
      await client.query(`DELETE FROM payments WHERE id = $1`, [paymentId])
      await client.query(`DELETE FROM spatial_planning.permit_application WHERE id = $1`, [permitId])
      client.release()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/routes/__tests__/payments.applicationfee.test.js
```

Expected: 2 FAIL — webhook returns 200 but the permit row stays `pending_payment` because `applyPaid` has no `application_fee` branch.

- [ ] **Step 3: Add the `application_fee` branch**

In `src/routes/payments.js`, in the `applyPaid` function (~line 341), directly after the existing `inspection_fee` branch, add:

```js
if (updated.purpose === 'application_fee' && updated.related_kind === 'permit') {
  const { rows: permitRows } = await client.query(
    `UPDATE spatial_planning.permit_application
        SET status      = CASE WHEN status = 'pending_payment'
                              THEN 'registered'
                              ELSE status END,
            fee_paid_at = COALESCE(fee_paid_at, NOW()),
            updated_at  = NOW()
      WHERE id = $1
      RETURNING id, applicant_email, applicant_name`,
    [updated.related_id],
  )
  const permit = permitRows[0]
  if (permit?.applicant_email) {
    await notifier.enqueue(client, {
      userId: updated.payer_id,
      email:  permit.applicant_email,
      kind:   'application_fee_paid',
      templateData: {
        permitId: permit.id,
        name:     permit.applicant_name,
        receipt:  updated.issued_receipt_no,
      },
      payload: { permitId: permit.id, paymentId: updated.id },
    })
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest src/routes/__tests__/payments.applicationfee.test.js
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/payments.js src/routes/__tests__/payments.applicationfee.test.js
git commit -m "feat(payments): apply application_fee side-effects on confirm

When a payment with purpose=application_fee + relatedKind=permit clears,
flip the linked permit pending_payment → registered, stamp fee_paid_at,
and enqueue the application_fee_paid notification. Replay-safe via the
existing WHERE status <> 'paid' idempotency guard."
```

---

## Task 8: Backend — `pay_intent` on permit create + planner queue filter

**Files:**
- Create: `app-backend/src/routes/__tests__/permit-applications.pending-payment.test.js`
- Modify: `app-backend/src/routes/development-management.js`

- [ ] **Step 1: Write the failing tests**

```js
const { buildAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs }         = require('../../../test/helpers/auth')

describe('permit-applications pending_payment gating', () => {
  let app, citizen, planner

  beforeAll(async () => {
    app = await buildAppForTest()
    citizen = await loginAs(app, 'demo.viewer@vungu.test', 'demo1234')
    planner = await loginAs(app, 'demo.planner@vungu.test', 'demo1234')
  })
  afterAll(async () => { await app.close() })

  it('creating with pay_intent yields status=pending_payment', async () => {
    const res = await app.inject({
      method:  'POST', url: '/api/permit-applications',
      headers: { authorization: `Bearer ${citizen}` },
      payload: {
        applicant_name:   'Pending Smoke',
        development_type: 'new_building',
        pay_intent:       { phone: '+263771234567', walletCcy: 'USD' },
      },
    })
    expect(res.statusCode).toBe(201)
    const row = res.json().data
    expect(row.status).toBe('pending_payment')

    const client = await app.pg.connect()
    try { await client.query(`DELETE FROM spatial_planning.permit_application WHERE id = $1`, [row.id]) }
    finally { client.release() }
  })

  it('planner GET excludes pending_payment by default and opt-in surfaces it', async () => {
    const client = await app.pg.connect()
    let id
    try {
      const r = await client.query(
        `INSERT INTO spatial_planning.permit_application
           (applicant_name, development_type, status, created_by)
         VALUES ('Hidden Smoke', 'new_building', 'pending_payment',
                 (SELECT id FROM users WHERE email='demo.viewer@vungu.test'))
         RETURNING id`,
      )
      id = r.rows[0].id

      const plannerView = await app.inject({
        method: 'GET', url: '/api/permit-applications',
        headers: { authorization: `Bearer ${planner}` },
      })
      expect(plannerView.json().data.map(d => d.id)).not.toContain(id)

      const citizenView = await app.inject({
        method: 'GET', url: '/api/permit-applications',
        headers: { authorization: `Bearer ${citizen}` },
      })
      expect(citizenView.json().data.map(d => d.id)).toContain(id)

      const optIn = await app.inject({
        method: 'GET', url: '/api/permit-applications?includePendingPayment=true',
        headers: { authorization: `Bearer ${planner}` },
      })
      expect(optIn.json().data.map(d => d.id)).toContain(id)
    } finally {
      if (id) await client.query(`DELETE FROM spatial_planning.permit_application WHERE id = $1`, [id])
      client.release()
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest src/routes/__tests__/permit-applications.pending-payment.test.js
```

Expected: 2 FAIL.

- [ ] **Step 3: Honour `pay_intent` on create**

In `src/routes/development-management.js`, in the `POST /permit-applications` handler (~line 94), insert before the `pg.query` INSERT call:

```js
const initialStatus = (b.pay_intent && typeof b.pay_intent === 'object')
  ? 'pending_payment'
  : 'registered'
```

Then change the INSERT to include `status` as the 17th column / parameter:

```js
const { rows } = await pg.query(
  `INSERT INTO spatial_planning.permit_application
     (dev_app_id, tpd_reference, dev_register_no, stand_number, suburb_ward,
      street_address, stand_area_sqm, applicant_name, applicant_id_number,
      applicant_phone, applicant_email, development_type, description,
      site_plan_url, received_at, created_by, status)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
   RETURNING *`,
  [
    b.dev_app_id || null,
    b.tpd_reference || null,
    b.dev_register_no || null,
    b.stand_number || null,
    b.suburb_ward || null,
    b.street_address || null,
    b.stand_area_sqm || null,
    b.applicant_name,
    b.applicant_id_number || null,
    b.applicant_phone || null,
    b.applicant_email || null,
    b.development_type,
    b.description || null,
    b.site_plan_url || null,
    isDate(b.received_at) ? b.received_at : new Date().toISOString().slice(0, 10),
    request.user.id,
    initialStatus,
  ],
)
```

- [ ] **Step 4: Exclude `pending_payment` from the planner queue**

In the same file, in `GET /permit-applications` (~line 141), extend params + WHERE:

```js
const isStaff = STAFF_ROLES.includes(request.user.role)
const ownerFilter = isStaff ? null : request.user.id
const includePending = isStaff && request.query.includePendingPayment === 'true'

const { rows } = await pg.query(
  `SELECT * FROM spatial_planning.v_application_summary
   WHERE ($1::text IS NULL OR status = $1)
     AND ($2::text IS NULL OR development_type = $2)
     AND ($3::text IS NULL OR (
           applicant_name ILIKE '%' || $3 || '%'
           OR tpd_reference ILIKE '%' || $3 || '%'
           OR stand_number  ILIKE '%' || $3 || '%'
         ))
     AND ($6::uuid IS NULL OR created_by = $6)
     AND ($7::boolean = true
          OR created_by = COALESCE($6, '00000000-0000-0000-0000-000000000000'::uuid)
          OR status <> 'pending_payment')
   ORDER BY received_at DESC
   LIMIT $4 OFFSET $5`,
  [status || null, development_type || null, search || null,
   Math.min(Number(limit) || 50, 200), Number(offset) || 0,
   ownerFilter, includePending],
)
```

Read as: include the row if (caller opted in) OR (the row is owned by the caller — citizens still see their own) OR (the row is not pending_payment — planners see everything else by default).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx jest src/routes/__tests__/permit-applications.pending-payment.test.js
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/development-management.js src/routes/__tests__/permit-applications.pending-payment.test.js
git commit -m "feat(permits): honour pay_intent on create, hide pending_payment from planners

When the citizen wizard sends pay_intent, the new permit row is created
as pending_payment instead of registered. The planner queue (GET
/api/permit-applications) excludes pending_payment by default but
admits ?includePendingPayment=true for opt-in audits. Citizens still
see their own pending_payment rows because the created_by clause wins."
```

---

## Task 9: Backend — Paynow env-var documentation

**Files:**
- Modify: `app-backend/.env.example`

- [ ] **Step 1: Append the Paynow keys**

Append to `app-backend/.env.example`:

```bash
# ── Paynow (Slice A: mobile money via Express Checkout) ───────────
# Sandbox values from https://developers.paynow.co.zw/ . Replace with
# the production Vungu RDC merchant credentials before shipping.
PAYNOW_INTEGRATION_ID=12345
PAYNOW_INTEGRATION_KEY=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
PAYNOW_API_BASE=https://www.paynow.co.zw
PAYNOW_RESULT_URL=http://localhost:3000/api/payments/webhook/paynow
PAYNOW_RETURN_URL=http://localhost:5174/payment/return
```

- [ ] **Step 2: Mirror in the local `.env`**

```bash
grep '^PAYNOW_' .env.example >> .env
```

Then verify:

```bash
node -e "require('dotenv').config(); console.log(process.env.PAYNOW_INTEGRATION_ID)"
```

Expected: `12345`.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(env): document Paynow integration keys for Slice A"
```

(Do NOT commit `.env` — it's gitignored.)

---

## Task 10: Frontend — `paymentsService.ts` additions

**Files:**
- Create: `app-frontend/src/services/__tests__/paymentsService.spec.ts`
- Modify: `app-frontend/src/services/paymentsService.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

import api from '../api'
import { paymentsService } from '../paymentsService'

describe('paymentsService.poll', () => {
  beforeEach(() => vi.clearAllMocks())
  it('POSTs /payments/:id/poll and returns the data', async () => {
    ;(api.post as any).mockResolvedValue({ data: { success: true, data: { id: 'P1', status: 'paid' } } })
    const r = await paymentsService.poll('P1')
    expect(api.post).toHaveBeenCalledWith('/payments/P1/poll')
    expect(r).toEqual({ id: 'P1', status: 'paid' })
  })
})

describe('paymentsService.listForRelated', () => {
  beforeEach(() => vi.clearAllMocks())
  it('GETs with relatedKind/relatedId query', async () => {
    ;(api.get as any).mockResolvedValue({ data: { success: true, data: [{ id: 'P2' }] } })
    const r = await paymentsService.listForRelated('permit', 'abc')
    expect(api.get).toHaveBeenCalledWith('/payments?relatedKind=permit&relatedId=abc')
    expect(r).toEqual([{ id: 'P2' }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd app-frontend
npx vitest run src/services/__tests__/paymentsService.spec.ts
```

Expected: FAIL — `paymentsService.poll is not a function`.

- [ ] **Step 3: Add the methods**

In `app-frontend/src/services/paymentsService.ts`, before the closing `}` of the `paymentsService` object, add:

```ts
async poll(id: string): Promise<Payment> {
  const res = await api.post<{ success: boolean; data: Payment }>(
    `/payments/${encodeURIComponent(id)}/poll`,
  )
  return res.data.data
},

async listForRelated(kind: 'permit', id: string): Promise<Payment[]> {
  const res = await api.get<{ success: boolean; data: Payment[] }>(
    `/payments?relatedKind=${kind}&relatedId=${encodeURIComponent(id)}`,
  )
  return res.data.data
},
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/services/__tests__/paymentsService.spec.ts
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentsService.ts src/services/__tests__/paymentsService.spec.ts
git commit -m "feat(payments): add poll(id) and listForRelated(kind, id) to paymentsService

poll() drives the citizen 'Check now' button; listForRelated() drives
the Payments tab's 'is there an active payment for this permit?' lookup."
```

---

## Task 11: Frontend — `useCitizenCase.submitDraft` accepts `payIntent`

**Files:**
- Modify: `app-frontend/src/composables/useCitizenCase.ts`

- [ ] **Step 1: Locate the current signature**

In `app-frontend/src/composables/useCitizenCase.ts`, find the `submitDraft` function declaration.

- [ ] **Step 2: Extend the signature and call**

Replace the signature and call site:

```ts
interface SubmitOpts {
  payIntent?: { phone: string; walletCcy: 'USD' | 'ZWG' }
}

async function submitDraft(id: string, opts: SubmitOpts = {}) {
  // existing pre-call logic stays untouched
  const permit = await dmApi.createPermit({
    /* existing field list … */
    ...(opts.payIntent ? { pay_intent: opts.payIntent } : {}),
  } as any)
  // existing post-call logic stays untouched
  return permit
}
```

`as any` is used because the `PermitApplication` type on the dm service doesn't currently include `pay_intent`. The backend only reads truthy presence.

- [ ] **Step 3: Verify the build**

```bash
npx vue-tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useCitizenCase.ts
git commit -m "feat(citizen): submitDraft accepts payIntent to gate new permit on payment

When the wizard's Submit & pay step calls submitDraft({ payIntent }),
the backend creates the permit as pending_payment so the planner queue
won't surface it until the fee clears."
```

---

## Task 12: Frontend — `PaymentMethodPicker` component

**Files:**
- Create: `app-frontend/src/components/PaymentMethodPicker.vue`
- Create: `app-frontend/src/components/__tests__/PaymentMethodPicker.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PaymentMethodPicker from '../PaymentMethodPicker.vue'

const baseProps = {
  priceUsd: 25,
  council:  { name: 'Vungu Rural District Council' },
}

describe('PaymentMethodPicker', () => {
  it('renders three active tiles and three disabled tiles', () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    expect(w.find('[data-tile="ecocash"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="onemoney"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="innbucks"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-tile="card"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-tile="googlepay"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-tile="applepay"]').attributes('disabled')).toBeDefined()
  })

  it('blocks submit when phone prefix does not match the picked wallet', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-tile="innbucks"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    expect(w.find('[data-test="pmp-pay"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('InnBucks numbers start with 086')
  })

  it('emits submit with normalised +263 phone when valid', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    const events = w.emitted('submit')
    expect(events).toBeTruthy()
    expect(events![0][0]).toEqual({
      wallet:    'ecocash',
      phone:     '+263771234567',
      walletCcy: 'USD',
    })
  })

  it('emits cancel on close button', async () => {
    const w = mount(PaymentMethodPicker, { props: baseProps })
    await w.find('[data-test="pmp-close"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/components/__tests__/PaymentMethodPicker.spec.ts
```

Expected: 4 FAIL.

- [ ] **Step 3: Create the component**

`app-frontend/src/components/PaymentMethodPicker.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

type ActiveWallet = 'ecocash' | 'onemoney' | 'innbucks'

interface Props {
  priceUsd: number
  council:  { name: string }
  defaultWalletCcy?: 'USD' | 'ZWG'
}
const props = withDefaults(defineProps<Props>(), {
  defaultWalletCcy: 'USD',
})
const emit = defineEmits<{
  (e: 'submit', payload: { wallet: ActiveWallet; phone: string; walletCcy: 'USD'|'ZWG' }): void
  (e: 'cancel'): void
}>()

const ACTIVE: Array<{ id: ActiveWallet; name: string; emoji: string; prefixHint: string }> = [
  { id: 'ecocash',  name: 'EcoCash',  emoji: '📱', prefixHint: '077 / 078' },
  { id: 'onemoney', name: 'OneMoney', emoji: '📲', prefixHint: '071' },
  { id: 'innbucks', name: 'InnBucks', emoji: '🪙', prefixHint: '086' },
]
const COMING: Array<{ id: string; name: string; emoji: string }> = [
  { id: 'card',      name: 'Card',       emoji: '💳' },
  { id: 'googlepay', name: 'Google Pay', emoji: '🟢' },
  { id: 'applepay',  name: 'Apple Pay',  emoji: '⚪' },
]
const PREFIX_RE: Record<ActiveWallet, RegExp> = {
  ecocash:  /^(?:\+?263|0)?(77|78)\d{7}$/,
  onemoney: /^(?:\+?263|0)?71\d{7}$/,
  innbucks: /^(?:\+?263|0)?86\d{7}$/,
}
const PREFIX_LABEL: Record<ActiveWallet, string> = {
  ecocash:  'EcoCash numbers start with 077 or 078',
  onemoney: 'OneMoney numbers start with 071',
  innbucks: 'InnBucks numbers start with 086',
}

const wallet    = ref<ActiveWallet | null>(null)
const phone     = ref('')
const walletCcy = ref<'USD' | 'ZWG'>(props.defaultWalletCcy)

const prefixError = computed(() => {
  if (!wallet.value || !phone.value) return ''
  return PREFIX_RE[wallet.value].test(phone.value.replace(/\s/g, ''))
    ? ''
    : PREFIX_LABEL[wallet.value]
})
const canPay = computed(() => Boolean(
  wallet.value && phone.value && !prefixError.value && walletCcy.value,
))

function normalisedPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.startsWith('263')) return '+' + digits
  if (digits.startsWith('0'))   return '+263' + digits.slice(1)
  return '+263' + digits
}
function onPay() {
  if (!canPay.value || !wallet.value) return
  emit('submit', {
    wallet:    wallet.value,
    phone:     normalisedPhone(phone.value),
    walletCcy: walletCcy.value,
  })
}
function fmtAmount(): string {
  return walletCcy.value === 'USD'
    ? `USD ${props.priceUsd.toFixed(2)}`
    : `ZWG ${props.priceUsd.toFixed(2)} (quoted at submit)`
}
</script>

<template>
  <div class="pmp">
    <header class="pmp-head">
      <div>
        <h3>Pay application fee</h3>
        <p class="pmp-sub">{{ council.name }} · {{ fmtAmount() }}</p>
      </div>
      <button class="pmp-close" data-test="pmp-close" @click="emit('cancel')" aria-label="Close">✕</button>
    </header>

    <p class="pmp-section">Pay with</p>
    <div class="pmp-grid">
      <button
        v-for="m in ACTIVE" :key="m.id"
        :data-tile="m.id"
        :class="['pmp-tile', { selected: wallet === m.id }]"
        @click="wallet = m.id"
      >
        <span class="pmp-emoji">{{ m.emoji }}</span>
        <span class="pmp-name">{{ m.name }}</span>
        <span class="pmp-hint">{{ m.prefixHint }}</span>
      </button>
    </div>
    <div class="pmp-grid">
      <button
        v-for="m in COMING" :key="m.id"
        :data-tile="m.id"
        class="pmp-tile pmp-tile--coming"
        disabled
        title="Available once card payments are enabled"
      >
        <span class="pmp-emoji">{{ m.emoji }}</span>
        <span class="pmp-name">{{ m.name }}</span>
        <span class="pmp-hint">Coming soon</span>
      </button>
    </div>

    <div v-if="wallet" class="pmp-fields">
      <label class="pmp-label" for="pmp-phone">Phone (+263)</label>
      <input
        id="pmp-phone" name="pmp-phone"
        v-model="phone"
        class="pmp-input"
        placeholder="0771234567"
        autocomplete="tel-national"
      />
      <p v-if="prefixError" class="pmp-error">{{ prefixError }}</p>

      <label class="pmp-label" style="margin-top:0.6rem">Currency</label>
      <div class="pmp-currency">
        <label><input type="radio" name="pmp-ccy" value="USD" v-model="walletCcy" /> USD</label>
        <label><input type="radio" name="pmp-ccy" value="ZWG" v-model="walletCcy" /> ZWG</label>
      </div>
    </div>

    <div class="pmp-actions">
      <button class="pmp-pay" data-test="pmp-pay" :disabled="!canPay" @click="onPay">
        Pay {{ fmtAmount() }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pmp { background:#fff; border:1px solid #e2e8f0; border-radius:0.75rem; padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; max-width:520px; }
.pmp-head { display:flex; align-items:flex-start; justify-content:space-between; }
.pmp-head h3 { margin:0; font-size:1rem; font-weight:700; color:#0f172a; }
.pmp-sub { margin:0; color:#64748b; font-size:0.75rem; }
.pmp-close { background:none; border:none; cursor:pointer; font-size:1rem; color:#64748b; }
.pmp-section { margin:0.25rem 0 -0.25rem; font-size:0.65rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8; }
.pmp-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:0.5rem; }
.pmp-tile { display:flex; flex-direction:column; align-items:center; gap:0.15rem; padding:0.65rem 0.45rem; border:1.5px solid #e2e8f0; border-radius:0.6rem; background:#f8fafc; cursor:pointer; font:inherit; }
.pmp-tile:hover { border-color:#cbd5e1; background:#fff; }
.pmp-tile.selected { border-color:#0f172a; box-shadow:0 0 0 3px rgba(15,23,42,0.08); background:#fff; }
.pmp-tile--coming { opacity:0.55; cursor:not-allowed; }
.pmp-tile--coming:hover { border-color:#e2e8f0; background:#f8fafc; }
.pmp-emoji { font-size:1.25rem; }
.pmp-name { font-size:0.78rem; font-weight:600; color:#0f172a; }
.pmp-hint { font-size:0.6rem; color:#64748b; }
.pmp-fields { display:flex; flex-direction:column; gap:0.35rem; margin-top:0.25rem; }
.pmp-label { font-size:0.72rem; color:#475569; font-weight:600; }
.pmp-input { padding:0.55rem 0.75rem; border:1.5px solid #e2e8f0; border-radius:0.5rem; font-size:0.85rem; font:inherit; background:#f8fafc; }
.pmp-input:focus { outline:none; border-color:#0f172a; background:#fff; }
.pmp-error { margin:0; color:#b91c1c; font-size:0.7rem; }
.pmp-currency { display:flex; gap:1rem; font-size:0.78rem; color:#374151; }
.pmp-actions { margin-top:0.4rem; }
.pmp-pay { width:100%; padding:0.75rem 1rem; background:#0f172a; color:#fff; border:none; border-radius:0.6rem; font-weight:700; font-size:0.85rem; cursor:pointer; font:inherit; }
.pmp-pay:disabled { background:#cbd5e1; cursor:not-allowed; }
</style>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/__tests__/PaymentMethodPicker.spec.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PaymentMethodPicker.vue src/components/__tests__/PaymentMethodPicker.spec.ts
git commit -m "feat(payments): add PaymentMethodPicker component

Three active mobile-money tiles (EcoCash/OneMoney/InnBucks) and three
disabled tiles (Card/Google Pay/Apple Pay) marked 'Coming soon'. Wallet
is chosen on the tile; phone is validated against the tile's prefix.
Emits submit({ wallet, phone, walletCcy }) for the parent to act on."
```

---

## Task 13: Frontend — `PaymentInitView` + router registration

**Files:**
- Create: `app-frontend/src/views/PaymentInitView.vue`
- Create: `app-frontend/src/views/__tests__/PaymentInitView.spec.ts`
- Modify: `app-frontend/src/router/index.ts`
- Modify (possibly): `app-frontend/src/services/citizenPortalService.ts` — add `getCouncil()` if missing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import PaymentInitView from '../PaymentInitView.vue'

vi.mock('@/services/paymentsService', () => ({
  paymentsService: { init: vi.fn() },
}))
vi.mock('@/services/citizenPortalService', () => ({
  citizenPortalService: { getCouncil: vi.fn() },
}))
vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { getPermit: vi.fn() },
}))

import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { dmApi } from '@/services/developmentManagementService'

async function mountView(query = { relatedKind: 'permit', relatedId: 'P1' }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payment/new', component: PaymentInitView },
      { path: '/payment/:id', name: 'payment', component: { template: '<div>aw</div>' } },
      { path: '/citizen',     component: { template: '<div>portal</div>' } },
    ],
  })
  router.push({ path: '/payment/new', query })
  await router.isReady()
  const w = mount(PaymentInitView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('PaymentInitView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(citizenPortalService.getCouncil as any).mockResolvedValue({
      name: 'Vungu Rural District Council', application_fee: 25,
    })
    ;(dmApi.getPermit as any).mockResolvedValue({ id: 'P1' })
  })

  it('initiates a payment and routes to the awaiting screen on submit', async () => {
    ;(paymentsService.init as any).mockResolvedValue({ id: 'PAY1' })
    const { w, router } = await mountView()
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    await flushPromises()

    expect(paymentsService.init).toHaveBeenCalledWith({
      purpose:     'application_fee',
      relatedKind: 'permit',
      relatedId:   'P1',
      priceUsd:    25,
      walletCcy:   'USD',
      driver:      'paynow',
      metadata:    { phone: '+263771234567', wallet: 'ecocash' },
    })
    expect(router.currentRoute.value.path).toBe('/payment/PAY1')
  })

  it('routes back to /citizen on cancel', async () => {
    const { w, router } = await mountView()
    await w.find('[data-test="pmp-close"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/citizen')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/__tests__/PaymentInitView.spec.ts
```

Expected: FAIL — view doesn't exist.

- [ ] **Step 3: Create the view**

`app-frontend/src/views/PaymentInitView.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { dmApi } from '@/services/developmentManagementService'

const router = useRouter()
const route  = useRoute()
const loading = ref(true)
const council = ref<{ name: string; application_fee: number } | null>(null)
const permit  = ref<{ id: string } | null>(null)

onMounted(async () => {
  try {
    const relatedKind = String(route.query.relatedKind || '')
    const relatedId   = String(route.query.relatedId   || '')
    if (relatedKind !== 'permit' || !relatedId) { router.replace('/citizen'); return }
    permit.value  = await dmApi.getPermit(relatedId)
    council.value = await citizenPortalService.getCouncil()
  } catch {
    router.replace('/citizen')
  } finally {
    loading.value = false
  }
})

async function onSubmit(p: { wallet: 'ecocash'|'onemoney'|'innbucks'; phone: string; walletCcy: 'USD'|'ZWG' }) {
  if (!council.value || !permit.value) return
  const payment = await paymentsService.init({
    purpose:     'application_fee',
    relatedKind: 'permit',
    relatedId:   permit.value.id,
    priceUsd:    council.value.application_fee,
    walletCcy:   p.walletCcy,
    driver:      'paynow',
    metadata:    { phone: p.phone, wallet: p.wallet },
  })
  router.replace(`/payment/${payment.id}`)
}

function onCancel() { router.replace('/citizen') }
</script>

<template>
  <div class="piv">
    <div v-if="loading" class="piv-loading">Loading…</div>
    <PaymentMethodPicker
      v-else-if="council && permit"
      :price-usd="council.application_fee"
      :council="{ name: council.name }"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
.piv { min-height:80vh; display:flex; align-items:center; justify-content:center; padding:1.5rem; background:#f8fafc; }
.piv-loading { color:#64748b; font-size:0.85rem; }
</style>
```

If `citizenPortalService.getCouncil` does not exist, add it:

```ts
async getCouncil(): Promise<{ name: string; application_fee: number; type: string; address: string; telephone: string; email: string }> {
  const r = await api.get('/council')
  return r.data.data
},
```

- [ ] **Step 4: Register the route**

In `app-frontend/src/router/index.ts`, alongside the other authenticated citizen routes, add:

```ts
{
  path: '/payment/new',
  name: 'payment-new',
  component: () => import('@/views/PaymentInitView.vue'),
  meta: { requiresAuth: true },
},
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/views/__tests__/PaymentInitView.spec.ts
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/PaymentInitView.vue src/views/__tests__/PaymentInitView.spec.ts src/router/index.ts src/services/citizenPortalService.ts
git commit -m "feat(payments): add /payment/new route mounting PaymentMethodPicker

Used by the Payments tab when a citizen wants to pay or resume an
outstanding application fee. Loads the permit and council fee, hands
the picker the price, initiates the payments row on submit, then
routes to /payment/:paymentId for the awaiting screen."
```

---

## Task 14: Frontend — `NewApplicationSection` Submit & pay step

**Files:**
- Create: `app-frontend/src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts`
- Modify: `app-frontend/src/views/citizen/sections/NewApplicationSection.vue`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const submitDraft = vi.fn()
const draft = { value: {
  id: 'D1', stand_number: 'CIT-SMK-1', suburb_ward: '1',
  development_type: 'new_building', description: 'shed',
}}
vi.mock('@/composables/useCitizenCase', () => ({
  useCitizenCase: () => ({ submitDraft, draft }),
  FEE_SCHEDULE: [],
}))
vi.mock('@/services/paymentsService', () => ({
  paymentsService: { init: vi.fn() },
}))
vi.mock('@/services/citizenPortalService', () => ({
  citizenPortalService: { getCouncil: vi.fn() },
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ error: vi.fn(), success: vi.fn() }),
}))

import NewApplicationSection from '../NewApplicationSection.vue'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'

async function mountAtSubmitStep() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/citizen', component: { template: '<div/>' } },
      { path: '/payment/:id', name: 'payment', component: { template: '<div/>' } },
    ],
  })
  router.push('/citizen')
  await router.isReady()
  const w = mount(NewApplicationSection, { global: { plugins: [router] } })
  await flushPromises()
  ;(w.vm as any).step = (w.vm as any).TOTAL_STEPS
  await flushPromises()
  return { w, router }
}

describe('NewApplicationSection Submit & pay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(citizenPortalService.getCouncil as any).mockResolvedValue({
      name: 'Vungu Rural District Council', application_fee: 25,
    })
    submitDraft.mockResolvedValue({ id: 'P1' })
    ;(paymentsService.init as any).mockResolvedValue({ id: 'PAY1' })
  })

  it('on picker submit: submitDraft → init → route to /payment/:id', async () => {
    const { w, router } = await mountAtSubmitStep()
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(submitDraft).toHaveBeenCalledWith('D1', {
      payIntent: { phone: '+263771234567', walletCcy: 'USD' },
    })
    expect(paymentsService.init).toHaveBeenCalledWith(expect.objectContaining({
      purpose:    'application_fee', relatedKind: 'permit',
      relatedId:  'P1', driver: 'paynow',
      metadata:   { phone: '+263771234567', wallet: 'ecocash' },
    }))
    expect(router.currentRoute.value.path).toBe('/payment/PAY1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace the Submit step content**

Open `app-frontend/src/views/citizen/sections/NewApplicationSection.vue`. Find the wizard's terminal Submit step (search for the existing `submitDraft` call). Replace the inner content of that step's `<section>` with:

```vue
<PaymentMethodPicker
  v-if="council"
  :price-usd="council.application_fee"
  :council="{ name: council.name }"
  @submit="handlePay"
  @cancel="step--"
/>
<p v-else class="na-loading">Loading council fee…</p>
```

Add to the `<script setup>`:

```ts
import PaymentMethodPicker from '@/components/PaymentMethodPicker.vue'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { useRouter } from 'vue-router'
import { onMounted, ref } from 'vue'

const router = useRouter()
const council = ref<{ name: string; application_fee: number } | null>(null)
const TOTAL_STEPS = 5   // adjust if the wizard already exposes a constant

onMounted(async () => {
  try { council.value = await citizenPortalService.getCouncil() }
  catch { /* council stays null → loading text shown */ }
})

async function handlePay(p: { wallet: 'ecocash'|'onemoney'|'innbucks'; phone: string; walletCcy: 'USD'|'ZWG' }) {
  if (!draft.value || !council.value) return
  try {
    const permit = await cc.submitDraft(draft.value.id, {
      payIntent: { phone: p.phone, walletCcy: p.walletCcy },
    })
    const payment = await paymentsService.init({
      purpose:     'application_fee',
      relatedKind: 'permit',
      relatedId:   permit.id,
      priceUsd:    council.value.application_fee,
      walletCcy:   p.walletCcy,
      driver:      'paynow',
      metadata:    { phone: p.phone, wallet: p.wallet },
    })
    router.push(`/payment/${payment.id}`)
  } catch {
    fb.error('Payment couldn’t start — try again from the Payments tab.')
    router.push('/citizen?section=payments')
  }
}

defineExpose({ step, TOTAL_STEPS })
```

(`cc` and `fb` are the existing `useCitizenCase()` and `useUiFeedback()` injections in the file. If `TOTAL_STEPS` already exists or `defineExpose` is already used, merge instead of duplicating.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/citizen/sections/NewApplicationSection.vue src/views/citizen/sections/__tests__/NewApplicationSection.submitandpay.spec.ts
git commit -m "feat(citizen): wire wizard Submit step to PaymentMethodPicker

Mounts the picker as the final wizard step; on submit, creates the
permit as pending_payment via submitDraft({ payIntent }), then
initiates the payment row and routes to /payment/:id. On failure
between the two calls, lands the citizen on the Payments tab so the
outstanding row can be resumed."
```

---

## Task 15: Frontend — `PaymentGatewayView` becomes awaiting/success only

**Files:**
- Create: `app-frontend/src/views/__tests__/PaymentGatewayView.awaiting.spec.ts`
- Modify: `app-frontend/src/views/PaymentGatewayView.vue`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/services/paymentsService', () => ({
  paymentsService: { get: vi.fn(), poll: vi.fn(), cancel: vi.fn() },
}))

import { paymentsService } from '@/services/paymentsService'
import PaymentGatewayView from '../PaymentGatewayView.vue'

async function mountView(id = 'PAY1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payment/:id', component: PaymentGatewayView },
      { path: '/citizen',     component: { template: '<div/>' } },
    ],
  })
  router.push(`/payment/${id}`)
  await router.isReady()
  const w = mount(PaymentGatewayView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('PaymentGatewayView (awaiting/success)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows awaiting state while status=awaiting_provider', async () => {
    ;(paymentsService.get as any).mockResolvedValue({
      id: 'PAY1', status: 'awaiting_provider',
      amountUsd: 25, walletCcy: 'USD',
      metadata: { phone: '+263771234567' },
    })
    const { w } = await mountView()
    expect(w.text()).toMatch(/check your phone/i)
    expect(w.text()).toContain('+263771234567')
  })

  it('Check Now hits poll() and transitions to success on paid', async () => {
    ;(paymentsService.get as any).mockResolvedValue({
      id: 'PAY1', status: 'awaiting_provider',
      amountUsd: 25, walletCcy: 'USD', metadata: {},
    })
    ;(paymentsService.poll as any).mockResolvedValue({
      id: 'PAY1', status: 'paid', amountUsd: 25, walletCcy: 'USD',
      issuedReceiptNo: 'VRDC-2026-000001', paidAt: '2026-05-31T10:00:00Z',
      driver: 'paynow', metadata: {},
    })
    const { w } = await mountView()
    await w.find('[data-test="pgw-check-now"]').trigger('click')
    await flushPromises()
    expect(paymentsService.poll).toHaveBeenCalledWith('PAY1')
    expect(w.text()).toMatch(/payment successful/i)
    expect(w.text()).toContain('VRDC-2026-000001')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/views/__tests__/PaymentGatewayView.awaiting.spec.ts
```

Expected: FAIL — existing view uses `paymentsApi.getStatus`, not the new service.

- [ ] **Step 3: Replace the view**

Replace the full contents of `app-frontend/src/views/PaymentGatewayView.vue` with:

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { paymentsService } from '@/services/paymentsService'
import { ArrowLeft, Shield, Lock, CheckCircle2, AlertCircle, FileText } from 'lucide-vue-next'

const route  = useRoute()
const router = useRouter()
const paymentId = computed(() => String(route.params.id || ''))

const payment = ref<any>(null)
const loading = ref(true)
const fatal   = ref('')
const polling = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const step = computed<'awaiting'|'success'|'cancelled'|'failed'>(() => {
  const s = payment.value?.status
  if (s === 'paid')      return 'success'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'failed')    return 'failed'
  return 'awaiting'
})

async function refresh() {
  try { payment.value = await paymentsService.get(paymentId.value) }
  catch { fatal.value = 'Payment not found.' }
}
async function checkNow() {
  if (polling.value) return
  polling.value = true
  try { payment.value = await paymentsService.poll(paymentId.value) }
  catch { /* keep last good state */ }
  finally { polling.value = false }
}
async function cancel() {
  if (!confirm('Cancel this payment? You can pay again from the Payments tab.')) return
  try { payment.value = await paymentsService.cancel(paymentId.value) }
  finally { router.push('/citizen?section=payments') }
}
function startPolling() { pollTimer = setInterval(refresh, 5000) }

onMounted(async () => {
  await refresh()
  loading.value = false
  if (step.value === 'awaiting') startPolling()
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })

function fmtDate(d?: string|null) {
  return d ? new Date(d).toLocaleString('en-ZW', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
function fmtAmount() {
  const a = payment.value; if (!a) return ''
  const ccy = a.walletCcy || 'USD'
  const amt = ccy === 'USD' ? a.amountUsd : a.amountZwg
  return `${ccy} ${Number(amt).toFixed(2)}`
}
</script>

<template>
  <div class="pgw-root">
    <header class="pgw-topbar">
      <button class="pgw-back" @click="router.back()"><ArrowLeft :size="14" /> Back</button>
      <div class="pgw-brand">
        <div class="pgw-brand-icon"><Shield :size="14" /></div>
        <span>Vungu Rural District Council</span>
      </div>
      <div class="pgw-secure"><Lock :size="11" /> Secure</div>
    </header>

    <div v-if="loading" class="pgw-state"><div class="pgw-spinner"/><p>Loading…</p></div>

    <div v-else-if="fatal" class="pgw-state">
      <AlertCircle :size="40" class="pgw-state-error" />
      <h2>Payment not found</h2>
      <p>{{ fatal }}</p>
      <button class="pgw-btn-primary" @click="router.push('/citizen?section=payments')">Go to Payments</button>
    </div>

    <div v-else class="pgw-body">
      <div v-if="step === 'awaiting'" class="pgw-center-card">
        <div class="pgw-state-emoji">📱</div>
        <h2 class="pgw-center-heading">Check your phone</h2>
        <p class="pgw-center-text">
          A payment prompt has been sent to <strong>{{ payment.metadata?.phone || 'your phone' }}</strong>.
        </p>
        <p class="pgw-hint pgw-hint--center">Accept the prompt to pay {{ fmtAmount() }}.</p>
        <div class="pgw-center-actions">
          <button class="pgw-btn-secondary" data-test="pgw-check-now"
                  :disabled="polling" @click="checkNow">Check Now</button>
          <button class="pgw-btn-ghost" @click="cancel">Cancel</button>
        </div>
      </div>

      <div v-else-if="step === 'success'" class="pgw-center-card">
        <div class="pgw-success-stamp"><div class="pgw-stamp-ring"/><CheckCircle2 :size="48" class="pgw-stamp-icon" /></div>
        <h2 class="pgw-center-heading pgw-center-heading--success">Payment successful</h2>
        <div class="pgw-receipt">
          <div class="pgw-receipt-row"><span>Receipt no.</span><strong>{{ payment.issuedReceiptNo }}</strong></div>
          <div class="pgw-receipt-row"><span>Amount paid</span><strong>{{ fmtAmount() }}</strong></div>
          <div class="pgw-receipt-row"><span>Method</span><strong>{{ payment.driver }}</strong></div>
          <div class="pgw-receipt-row"><span>Date</span><strong>{{ fmtDate(payment.paidAt) }}</strong></div>
        </div>
        <div class="pgw-center-actions">
          <button class="pgw-btn-primary" @click="router.push('/citizen')"><FileText :size="15" /> My Applications</button>
        </div>
      </div>

      <div v-else class="pgw-center-card">
        <div class="pgw-state-emoji">⚠️</div>
        <h2 class="pgw-center-heading">Payment {{ step }}</h2>
        <p class="pgw-center-text">You can try again from the Payments tab.</p>
        <button class="pgw-btn-primary" @click="router.push('/citizen?section=payments')">Go to Payments</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pgw-root { min-height:100vh; background:#f8fafc; font-family:system-ui,-apple-system,sans-serif; color:#0f172a; display:flex; flex-direction:column; }
.pgw-topbar { position:sticky; top:0; background:#fff; border-bottom:1px solid #e2e8f0; padding:0.875rem 1.5rem; display:flex; align-items:center; gap:1rem; }
.pgw-back { display:inline-flex; align-items:center; gap:0.35rem; background:none; border:none; cursor:pointer; font:inherit; color:#374151; }
.pgw-brand { flex:1; display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; font-weight:600; }
.pgw-brand-icon { width:26px; height:26px; background:#111827; color:#fff; border-radius:6px; display:flex; align-items:center; justify-content:center; }
.pgw-secure { display:flex; align-items:center; gap:0.3rem; font-size:0.68rem; font-weight:600; color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; border-radius:999px; padding:0.3rem 0.6rem; text-transform:uppercase; letter-spacing:0.04em; }
.pgw-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4rem 1.5rem; text-align:center; color:#64748b; gap:0.75rem; }
.pgw-state-error { color:#ef4444; }
.pgw-body { flex:1; max-width:520px; margin:0 auto; width:100%; padding:2rem 1.5rem 4rem; }
.pgw-center-card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:2.5rem 2rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center; box-shadow:0 2px 12px rgba(0,0,0,0.05); }
.pgw-state-emoji { font-size:3rem; }
.pgw-center-heading { font-size:1.375rem; font-weight:800; color:#0f172a; }
.pgw-center-heading--success { color:#16a34a; }
.pgw-center-text { font-size:0.9rem; color:#374151; }
.pgw-hint { font-size:0.72rem; color:#94a3b8; }
.pgw-hint--center { text-align:center; }
.pgw-center-actions { display:flex; gap:0.75rem; flex-wrap:wrap; justify-content:center; margin-top:0.5rem; }
.pgw-btn-primary { display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 1.75rem; background:#111827; color:#fff; border:none; border-radius:9999px; font:inherit; font-weight:600; cursor:pointer; }
.pgw-btn-secondary { display:inline-flex; align-items:center; gap:0.5rem; padding:0.75rem 1.75rem; background:#fff; color:#1e293b; border:1.5px solid #e2e8f0; border-radius:9999px; font:inherit; font-weight:600; cursor:pointer; }
.pgw-btn-secondary:disabled { opacity:0.5; cursor:not-allowed; }
.pgw-btn-ghost { background:none; border:none; color:#64748b; font:inherit; cursor:pointer; padding:0.75rem 0.5rem; }
.pgw-receipt { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; width:100%; text-align:left; overflow:hidden; }
.pgw-receipt-row { display:flex; justify-content:space-between; align-items:center; padding:0.55rem 1rem; border-bottom:1px solid #e2e8f0; font-size:0.8125rem; gap:1rem; }
.pgw-receipt-row:last-child { border-bottom:none; }
.pgw-receipt-row span { color:#64748b; }
.pgw-receipt-row strong { color:#0f172a; text-align:right; }
.pgw-success-stamp { position:relative; }
.pgw-stamp-ring { position:absolute; inset:-10px; border:2px dashed #d1fae5; border-radius:50%; animation:rotateSlow 8s linear infinite; }
@keyframes rotateSlow { to { transform:rotate(360deg); } }
.pgw-stamp-icon { color:#16a34a; display:block; }
.pgw-spinner { width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#111827; border-radius:50%; animation:spin 0.7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/views/__tests__/PaymentGatewayView.awaiting.spec.ts
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/PaymentGatewayView.vue src/views/__tests__/PaymentGatewayView.awaiting.spec.ts
git commit -m "feat(payments): repurpose PaymentGatewayView as awaiting/success screen

Drives off the real payments row via paymentsService.get / .poll /
.cancel. Auto-polls every 5s; Check Now forces a Paynow round-trip;
Cancel ends the row and lands on the Payments tab. Removes the
PCI-risky card form and the stale bank-transfer tab — Slice B
re-introduces card via Paynow redirect."
```

---

## Task 16: Frontend — `PaymentsSection` Pay-now routing

**Files:**
- Modify: `app-frontend/src/views/citizen/sections/PaymentsSection.vue`

- [ ] **Step 1: Replace the button handler**

In `app-frontend/src/views/citizen/sections/PaymentsSection.vue`, replace the `payNow` function and the disabled state on the Pay-now button.

Imports:

```ts
import { paymentsService } from '@/services/paymentsService'
```

Function:

```ts
async function payNow(p: { id: string }) {
  try {
    const existing = await paymentsService.listForRelated('permit', p.id)
    const live = existing.find(x => x.status === 'pending' || x.status === 'awaiting_provider')
    if (live) {
      router.push(`/payment/${live.id}`)
      return
    }
    router.push({
      path: '/payment/new',
      query: { relatedKind: 'permit', relatedId: p.id },
    })
  } catch {
    router.push({
      path: '/payment/new',
      query: { relatedKind: 'permit', relatedId: p.id },
    })
  }
}
```

Button binding in the `outstanding` `<li>`:

```vue
<button class="pay-btn primary" @click="payNow(p)" :disabled="!p.id">
  Pay now <ArrowRight :size="11" />
</button>
```

(Drop `:disabled="!p.dev_register_no"`.)

- [ ] **Step 2: Smoke-test in the browser**

```bash
npm run dev
```

Visit `http://localhost:5174/citizen`, log in as `demo.viewer@vungu.test` / `demo1234`, open the Payments tab.

Expected: the "Pay now" buttons are no longer greyed; clicking one navigates to `/payment/new?relatedKind=permit&relatedId=<id>` and the picker mounts.

- [ ] **Step 3: Commit**

```bash
git add src/views/citizen/sections/PaymentsSection.vue
git commit -m "feat(citizen): wire Payments tab Pay-now to live payment row

Looks up the latest payments row for the permit; routes to the
awaiting screen if one is pending/awaiting_provider, otherwise to
/payment/new so the citizen picks a method. Drops the dev_register_no
gate that left the button greyed for citizen-submitted permits."
```

---

## Task 17: End-to-end smoke run

**Files:** none modified.

- [ ] **Step 1: Start both servers**

In two terminals:

```bash
cd app-backend && npm run dev
cd app-frontend && npm run dev
```

Wait for `Server listening at http://127.0.0.1:3000` and `Local: http://localhost:5174/`.

- [ ] **Step 2: Citizen happy path**

1. Open `http://localhost:5174`.
2. Log in as `demo.viewer@vungu.test` / `demo1234`.
3. `/citizen → New application`, walk through the wizard. The final step renders the picker.
4. Click EcoCash, enter `0771111111` (Paynow sandbox success number), click Pay.

Expected: awaiting screen appears, sandbox confirms in seconds, screen transitions to "Payment successful" with a receipt number `VRDC-2026-000XXX`.

- [ ] **Step 3: Planner sees the row only after pay**

1. Open an incognito window. Log in as `demo.planner@vungu.test` / `demo1234`.
2. Open `/planner-workspace → Permit Register`.

Expected: the new permit appears with status `Received`. Before Step 2 cleared, the same row was not visible.

- [ ] **Step 4: Pay-now path on outstanding rows**

1. Back in the citizen window, `/citizen → Payments`.
2. Pick any row with "APPLICATION FEE OUTSTANDING".
3. Click Pay now.

Expected: navigates to `/payment/new?relatedKind=permit&relatedId=<id>`; the picker mounts. Choose a method, pay, observe the awaiting → success transition.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Wizard's final step is "Submit & pay" | 14 |
| Permit row created with `status='pending_payment'` | 8 |
| Planner doesn't see pending_payment rows by default | 8 |
| Paynow Express Checkout init | 3 |
| Wallet picked on tile, validated against phone prefix | 12 |
| Card / Google Pay / Apple Pay tiles disabled + "Coming soon" | 12 |
| Webhook hash verification (constant-time) | 5 |
| applyPaid `application_fee` branch flips permit + stamps fee_paid_at + notifies | 7 |
| `POST /api/payments/:id/poll` for Check Now button | 6 |
| `GET /api/payments` accepts `relatedKind/relatedId` filters | 6 |
| `paymentsService.poll(id)` and `listForRelated(kind, id)` | 10 |
| `useCitizenCase.submitDraft(id, { payIntent })` forwarding | 11 |
| `/payment/new` route mounted on `PaymentInitView` | 13 |
| `PaymentGatewayView` driven by real payments row, card/bank tabs removed | 15 |
| `PaymentsSection` Pay-now drops `dev_register_no` gate | 16 |
| Migration extends status CHECK + adds `fee_paid_at` | 1 |
| `.env.example` documents Paynow keys | 9 |
| Manual E2E with Paynow sandbox | 17 |
