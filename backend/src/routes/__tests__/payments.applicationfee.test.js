const nock = require('nock')
const { systemOf } = require('../../lib/dbContext')   // fixtures use the system connection (TENANCY_MODE=strict has no request context)
const crypto = require('crypto')
const { buildAppForTest, assertDisposableDatabase } = require('../../../test/helpers/buildApp')
const { loginAs }         = require('../../../test/helpers/auth')

// A paid planning fee is noted for the ledger (migration 246) in finance.planning_fee, which never lets a row be deleted:
// each run leaves that record behind wherever it runs. So this suite is an integration suite (scripts/test-suites.js),
// it refuses a database that is not a disposable one, and it removes its rows with the keeping trigger switched off.
async function removeFixture(client, paymentId, permitId) {
  await client.query('BEGIN')
  try {
    await client.query('ALTER TABLE finance.planning_fee DISABLE TRIGGER trg_planning_fee_kept')
    await client.query('DELETE FROM finance.planning_fee WHERE payment_id = $1', [paymentId])
    await client.query('ALTER TABLE finance.planning_fee ENABLE TRIGGER trg_planning_fee_kept')
    await client.query('DELETE FROM payments WHERE id = $1', [paymentId])
    await client.query('DELETE FROM spatial_planning.permit_application WHERE id = $1', [permitId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

describe('application fee payment lifecycle', () => {
  let app, token

  beforeAll(async () => {
    assertDisposableDatabase('the application fee suite')
    process.env.PAYNOW_INTEGRATION_ID  = '12345'
    process.env.PAYNOW_INTEGRATION_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    process.env.PAYNOW_RESULT_URL      = 'https://example.test/api/payments/webhook/paynow'
    process.env.PAYNOW_RETURN_URL      = 'https://example.test/payment/return'
    process.env.PAYNOW_API_BASE        = 'https://www.paynow.co.zw'
    app = await buildAppForTest()
    token = await loginAs(app, 'demo.viewer@vungu.test', 'demo1234')
  })
  afterAll(async () => { await app?.close() })
  afterEach(() => nock.cleanAll())

  async function setupPaidFlow() {
    const client = await systemOf(app.pg).connect()
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

      // A poll URL of this run's own: the webhook finds its payment by it, and a fixed one ('guid=ZZ') matched the paid
      // rows an interrupted earlier run had left behind, so the webhook settled one of those and this run's stayed unpaid.
      const guid = crypto.randomUUID()
      nock('https://www.paynow.co.zw')
        .post('/interface/remotetransaction')
        .reply(200,
          `status=Ok&pollurl=https%3A%2F%2Fwww.paynow.co.zw%2FInterface%2FCheckPayment%2F%3Fguid%3D${guid}&hash=AA`)

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
    const client = await systemOf(app.pg).connect()
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
      try { await removeFixture(client, paymentId, permitId) } finally { client.release() }
    }
  })

  it('replaying the same webhook does not double-stamp', async () => {
    const { permitId, paymentId, rawBody } = await setupPaidFlow()
    const client = await systemOf(app.pg).connect()
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
      try { await removeFixture(client, paymentId, permitId) } finally { client.release() }
    }
  })
})
