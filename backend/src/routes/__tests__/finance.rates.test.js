/**
 * Rates billing end to end, through the real routes and the real database.
 *
 * The readiness finding, the valuation roll, a tariff drafted by one person and approved by
 * another, a billing run raised by the officer and committed by the Director, a payment, the
 * arrears, and their reconciliation to the receivable control account — plus what each role
 * CANNOT do along the way, and what reaches the audit trail.
 *
 * What the database itself refuses, with every route bypassed, is proven separately in
 * scripts/verify-rates-invariants.js. This suite proves the routes reach those rules, translate
 * their refusals, and hold the permissions.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.rates.test.js --runInBand
 *
 * IT POSTS TO THE LEDGER, WHICH IS INSERT-ONLY. So afterAll removes this run's rows with the
 * immutability trigger disabled for one transaction, exactly as
 * scripts/seed-general-ledger-demo.js --clean does, and only rows carrying this run's tag.
 * test/helpers/buildApp.js refuses a database whose name is not obviously disposable, so that
 * cannot happen to a real book of account.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `RT${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

async function waitForRows(pg, sql, params) {
  let rows = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ({ rows } = await pg.query(sql, params))
    if (rows.length) return rows
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return rows
}

describe('rates billing, debtors and arrears', () => {
  let app
  let sys
  const as = {}
  const made = {}
  let parcels = []

  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const period = () =>
    `financial_year_id=${made.yearId}&period_from=2038-01-01&period_to=2038-03-31&currency=USD`

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)

    const accounts = {
      director: 'demo.finance-admin@vungu.test',
      officer: 'demo.finance-officer@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      technicalAdmin: 'demo.admin@vungu.test',
      inspector: 'demo.inspector@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) as[key] = await loginAs(app, email, PASSWORD)

    // Two real properties with no rates account, so this run collides with nothing.
    const { rows } = await sys.query(
      `SELECT pa.parcel_id FROM land.parcel pa
        WHERE pa.status = 'current'
          AND NOT EXISTS (SELECT 1 FROM finance.rates_account ra
                           WHERE ra.parcel_id = pa.parcel_id AND ra.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM finance.valuation_roll v
                           WHERE v.parcel_id = pa.parcel_id AND v.deleted_at IS NULL)
        ORDER BY pa.parcel_id LIMIT 2`)
    parcels = rows.map((r) => r.parcel_id)
    expect(parcels).toHaveLength(2)

    const year = await call('POST', '/finance/financial-years', as.director, {
      label: `${TAG} Rates 2038`, start_date: '2038-01-01', end_date: '2038-12-31', reporting_currency: 'USD',
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect((await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)).statusCode).toBe(200)
    expect((await call('POST', '/finance/ledger/periods', as.director,
      { financial_year_id: made.yearId, periodicity: 'monthly' })).statusCode).toBeLessThan(300)

    const account = async (code, name, rootType, accountType) => {
      const res = await call('POST', '/finance/ledger/accounts', as.director,
        { code: `${TAG}-${code}`, name, root_type: rootType, ...(accountType ? { account_type: accountType } : {}) })
      expect(res.statusCode).toBe(201)
      return res.json().data.id
    }
    made.bank = await account('1100', 'Rates test bank', 'asset', 'bank')
    made.receivable = await account('1200', 'Rates test receivable', 'asset', 'receivable')
    made.revenue = await account('4100', 'Rates test revenue', 'revenue')

    const party = await call('POST', '/finance/ledger/parties', as.officer,
      { party_type: 'ratepayer', name: `${TAG} Ratepayer`, reference: `${TAG}-RP1` })
    expect(party.statusCode).toBe(201)
    made.partyId = party.json().data.id
  })

  afterAll(async () => {
    if (app) {
      let cleanupError = null
      const client = await sys.connect()
      try {
        await client.query('BEGIN')
        const like = `${TAG}%`
        await client.query('ALTER TABLE finance.ledger_entry DISABLE TRIGGER trg_ledger_entry_immutable')
        await client.query('DELETE FROM finance.ledger_entry WHERE voucher_no LIKE $1', [like])
        await client.query('ALTER TABLE finance.ledger_entry ENABLE TRIGGER trg_ledger_entry_immutable')
        await client.query('DELETE FROM finance.rates_receipt WHERE receipt_no LIKE $1', [like])
        await client.query('DELETE FROM finance.rates_bill WHERE bill_no LIKE $1', [like])
        await client.query('DELETE FROM finance.rates_billing_run WHERE run_reference LIKE $1', [like])
        // A posted voucher's lines are frozen, and so are a cancelled one's, so every voucher of
        // this run goes back to draft before its lines are removed.
        await client.query(
          `UPDATE finance.voucher SET status = 'draft', posted_by = NULL, posted_at = NULL
            WHERE voucher_no LIKE $1 AND status <> 'draft'`, [like])
        await client.query(
          `DELETE FROM finance.voucher_line WHERE voucher_id IN
             (SELECT id FROM finance.voucher WHERE voucher_no LIKE $1)`, [like])
        await client.query('DELETE FROM finance.voucher WHERE voucher_no LIKE $1', [like])
        await client.query('DELETE FROM finance.rates_account WHERE account_no LIKE $1', [like])
        await client.query('DELETE FROM finance.rates_tariff WHERE financial_year_id = $1', [made.yearId])
        await client.query('DELETE FROM finance.valuation_roll WHERE source LIKE $1', [like])
        await client.query('DELETE FROM finance.property_category WHERE code LIKE $1', [like])
        await client.query('DELETE FROM finance.party WHERE reference LIKE $1', [like])
        await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = $1', [made.yearId])
        await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [like])
        await client.query('DELETE FROM finance.financial_year WHERE id = $1', [made.yearId])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        cleanupError = err
      } finally {
        client.release()
      }
      await app.close()
      // A teardown that failed leaves a financial year behind, and the next run then cannot
      // create its own. Fail here, where the cause is, rather than there.
      if (cleanupError) throw new Error(`[finance.rates] cleanup of ${TAG} failed: ${cleanupError.message}`)
    }
  })

  test('the rates surface is closed to anonymous callers and to staff with no finance permission', async () => {
    expect((await call('GET', '/finance/rates/readiness')).statusCode).toBe(401)
    for (const url of ['/finance/rates/readiness', '/finance/rates/arrears', '/finance/rates/bills',
      '/finance/rates/properties', '/finance/rates/tariffs']) {
      expect((await call('GET', url, as.inspector)).statusCode).toBe(403)
    }
  })

  test('readiness states what billing is waiting on rather than showing an empty table', async () => {
    const res = await call('GET', `/finance/rates/readiness?financial_year_id=${made.yearId}`, as.auditor)
    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.properties.properties).toBeGreaterThan(0)
    expect(d.blockers.map((b) => b.decision)).toEqual(['D19', 'D17', 'D18'])
    const d18 = d.blockers.find((b) => b.decision === 'D18')
    expect(d18.met).toBe(false)
    expect(d18.detail).toMatch(/No tariff has been approved for this financial year/)
    expect(d.ledger.periods.open).toBe(12)
  })

  test('the auditor reads everything and writes nothing', async () => {
    expect((await call('GET', '/finance/rates/categories', as.auditor)).statusCode).toBe(200)
    const writes = [
      ['POST', '/finance/rates/categories', { code: 'X', name: 'X' }],
      ['POST', '/finance/rates/valuations', { parcel_id: parcels[0], property_category_id: made.yearId, rateable_value: '1', currency: 'USD', effective_from: '2038-01-01', source: 'x roll' }],
      ['POST', '/finance/rates/tariffs', { financial_year_id: made.yearId, property_category_id: made.yearId, currency: 'USD', rate_in_dollar: '0.01' }],
      ['POST', '/finance/rates/accounts', { account_no: 'X', parcel_id: parcels[0], party_id: made.partyId }],
      ['POST', '/finance/rates/billing/runs', { run_reference: 'XXX', financial_year_id: made.yearId, period_from: '2038-01-01', period_to: '2038-03-31', posting_date: '2038-01-01', currency: 'USD', receivable_ledger_account_id: made.receivable, revenue_ledger_account_id: made.revenue }],
      ['POST', '/finance/rates/receipts', { receipt_no: 'X', rates_account_id: made.yearId, financial_year_id: made.yearId, amount: '1', currency: 'USD', received_on: '2038-01-01', bank_ledger_account_id: made.bank }],
    ]
    for (const [method, url, payload] of writes) {
      const res = await call(method, url, as.auditor, payload)
      expect({ url, status: res.statusCode }).toEqual({ url, status: 403 })
    }
  })

  test('the officer keeps the roll and the accounts', async () => {
    const category = await call('POST', '/finance/rates/categories', as.officer,
      { code: `${TAG}-res`, name: 'Residential (test)' })
    expect(category.statusCode).toBe(201)
    expect(category.json().data.code).toBe(`${TAG}-RES`)
    made.categoryId = category.json().data.id
    expect((await call('POST', '/finance/rates/categories', as.officer,
      { code: `${TAG}-RES`, name: 'again' })).statusCode).toBe(409)

    // 250 000.00 at 0.0085 is 2 125.00; with the 12.00 fixed charge, 2 137.00.
    const valuation = await call('POST', '/finance/rates/valuations', as.officer, {
      parcel_id: parcels[0], property_category_id: made.categoryId, rateable_value: '250,000.00',
      currency: 'USD', effective_from: '2037-07-01', source: `${TAG} general valuation roll`, status: 'active',
    })
    expect(valuation.statusCode).toBe(201)
    made.valuationId = valuation.json().data.id
    expect(valuation.json().data.rateable_value).toBe('250000.00')

    // Two values in force for one property on one day is refused, by the database, as a 409.
    const overlap = await call('POST', '/finance/rates/valuations', as.officer, {
      parcel_id: parcels[0], property_category_id: made.categoryId, rateable_value: '300000.00',
      currency: 'USD', effective_from: '2038-01-01', source: `${TAG} second roll`, status: 'active',
    })
    expect(overlap.statusCode).toBe(409)
    expect(overlap.json().error).toBe('valuation_overlap')

    // A value that is in force cannot be quietly changed.
    const amend = await call('PATCH', `/finance/rates/valuations/${made.valuationId}`, as.officer,
      { rateable_value: '1.00' })
    expect(amend.statusCode).toBe(409)
    expect(amend.json().error).toBe('valuation_in_force')

    const account = await call('POST', '/finance/rates/accounts', as.officer,
      { account_no: `${TAG}-A1`, parcel_id: parcels[0], party_id: made.partyId })
    expect(account.statusCode).toBe(201)
    made.accountId = account.json().data.id
    const twice = await call('POST', '/finance/rates/accounts', as.officer,
      { account_no: `${TAG}-A2`, parcel_id: parcels[0], party_id: made.partyId })
    expect(twice.statusCode).toBe(409)
    expect(twice.json().message).toMatch(/bill it twice/)

    const listed = await call('GET', `/finance/rates/properties?q=${TAG}-A1`, as.auditor)
    expect(listed.json().data.properties[0]).toMatchObject({
      parcel_id: parcels[0], has_rates_account: true, has_rateable_value: false, // not in force until 2037
    })
  })

  test('a tariff is drafted by one person and becomes the rate only when another records the resolution', async () => {
    // The officer does not hold tariff.manage; the technical administrator holds nothing that bills.
    const body = { financial_year_id: made.yearId, property_category_id: made.categoryId, currency: 'USD', rate_in_dollar: '0.0085', fixed_charge: '12.00' }
    expect((await call('POST', '/finance/rates/tariffs', as.officer, body)).statusCode).toBe(403)
    expect((await call('POST', '/finance/rates/tariffs', as.technicalAdmin, body)).statusCode).toBe(403)

    // A rate is never rounded to fit: nine places is refused rather than cut to eight, and a
    // negative rate is not a rate.
    for (const bad of ['0.000000001', '-0.0085', 'a cent and a half']) {
      const res = await call('POST', '/finance/rates/tariffs', as.director, { ...body, rate_in_dollar: bad })
      expect({ bad, status: res.statusCode, error: res.json().error }).toEqual({ bad, status: 400, error: 'rate_unreadable' })
    }

    const draft = await call('POST', '/finance/rates/tariffs', as.director, body)
    expect(draft.statusCode).toBe(201)
    expect(draft.json().data).toMatchObject({ status: 'draft', rate_in_dollar: '0.00850000' })
    made.tariffId = draft.json().data.id

    // A draft tariff bills nothing: the preview refuses the property and names D18.
    const before = await call('GET', `/finance/rates/billing/preview?${period()}`, as.officer)
    expect(before.statusCode).toBe(200)
    expect(before.json().data.billable).toBe(0)
    expect(before.json().data.refusals.find((r) => r.reason_code === 'no_approved_tariff'))
      .toMatchObject({ properties: 1, waiting_on: 'D18' })

    // The Director drafted it and does not hold the approval; the committee does.
    expect((await call('POST', `/finance/rates/tariffs/${made.tariffId}/approve`, as.director,
      { resolution_reference: 'Minute 1/2038' })).statusCode).toBe(403)
    expect((await call('POST', `/finance/rates/tariffs/${made.tariffId}/approve`, as.committee, {})).statusCode).toBe(400)
    const approved = await call('POST', `/finance/rates/tariffs/${made.tariffId}/approve`, as.committee,
      { resolution_reference: 'Full Council minute 14/2037', resolution_date: '2037-11-30' })
    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.status).toBe('approved')

    // Approved means frozen.
    expect((await call('PATCH', `/finance/rates/tariffs/${made.tariffId}`, as.director,
      { rate_in_dollar: '0.5' })).statusCode).toBe(409)

    const audit = await waitForRows(sys,
      `SELECT severity, details FROM public.admin_audit_event
        WHERE event = 'FIN_RATES_TARIFF' AND details->>'tariff_id' = $1`, [made.tariffId])
    expect(audit[0].severity).toBe('critical')
    expect(audit[0].details).toMatchObject({ action: 'tariff_approved', rate_in_dollar: '0.00850000' })
  })

  test('the preview and the run agree, and the run posts nothing until somebody else commits it', async () => {
    const preview = await call('GET', `/finance/rates/billing/preview?${period()}&billable=true`, as.officer)
    const p = preview.json().data
    expect(p).toMatchObject({ billable: 1, total_amount: '2137.00', currency: 'USD' })
    expect(p.properties_considered).toBe(p.billable + p.refused)
    expect(p.rows[0]).toMatchObject({ parcel_id: parcels[0], bill_amount: '2137.00', billable: true })
    // Every other property is refused for want of a ratepayer of record.
    expect(p.refusals.find((r) => r.reason_code === 'no_rates_account').properties).toBe(p.refused)

    const body = {
      run_reference: `${TAG}-q1`, financial_year_id: made.yearId, period_from: '2038-01-01',
      period_to: '2038-03-31', posting_date: '2038-01-05', currency: 'USD',
      receivable_ledger_account_id: made.receivable, revenue_ledger_account_id: made.revenue,
    }
    // Posting a bill to an account that is not a receivable control would hide the debt.
    const wrong = await call('POST', '/finance/rates/billing/runs', as.officer,
      { ...body, receivable_ledger_account_id: made.bank })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().error).toBe('account_unsuitable')

    const raised = await call('POST', '/finance/rates/billing/runs', as.officer, body)
    expect(raised.statusCode).toBe(201)
    const run = raised.json().data.run
    made.runId = run.id
    expect(run).toMatchObject({
      status: 'raised', bills_raised: 1, total_billed: '2137.00', run_reference: `${TAG}-Q1`,
      properties_refused: p.refused, properties_considered: p.properties_considered,
    })

    const refusals = await call('GET', `/finance/rates/billing/runs/${run.id}/refusals?limit=5`, as.auditor)
    expect(refusals.json().data.total).toBe(p.refused)
    expect(refusals.json().data.refusals[0]).toMatchObject({ reason_code: 'no_rates_account', waiting_on: 'D19' })

    const bills = await call('GET', `/finance/rates/bills?billing_run_id=${run.id}`, as.auditor)
    const bill = bills.json().data.bills[0]
    made.billId = bill.id
    made.billVoucherId = bill.voucher_id
    expect(bill).toMatchObject({ amount: '2137.00', voucher_status: 'draft', open_amount: '2137.00' })
    expect(bills.json().data.totals).toEqual([{ currency: 'USD', voucher_status: 'draft', bills: 1, amount: '2137.00' }])

    // Nothing is owed yet: a draft is not in the book of account.
    const arrears = await call('GET', '/finance/rates/arrears', as.auditor)
    expect(arrears.json().data.accounts.find((a) => a.rates_account_id === made.accountId)).toBeUndefined()

    // The bill's draft voucher cannot be re-lined or discarded through the ledger.
    const reline = await call('PATCH', `/finance/ledger/vouchers/${bill.voucher_id}`, as.officer, {
      lines: [{ ledger_account_id: made.receivable, debit: '137.00' }, { ledger_account_id: made.revenue, credit: '137.00' }],
    })
    expect(reline.statusCode).toBe(409)
    expect(reline.json().error).toBe('voucher_belongs_to_rates')
    expect((await call('DELETE', `/finance/ledger/vouchers/${bill.voucher_id}`, as.officer)).statusCode).toBe(409)

    // A draft bill cannot be paid.
    const early = await call('POST', '/finance/rates/receipts', as.officer, {
      receipt_no: `${TAG}-RC0`, rates_account_id: made.accountId, financial_year_id: made.yearId,
      amount: '100.00', currency: 'USD', received_on: '2038-01-10', bank_ledger_account_id: made.bank,
      allocations: [{ rates_bill_id: bill.id, amount: '100.00' }],
    })
    expect(early.statusCode).toBe(409)
    expect(early.json().error).toBe('bill_not_settleable')

    // The officer raised it and holds no posting permission at all.
    expect((await call('POST', `/finance/rates/billing/runs/${run.id}/commit`, as.officer)).statusCode).toBe(403)
    const committed = await call('POST', `/finance/rates/billing/runs/${run.id}/commit`, as.director)
    expect(committed.statusCode).toBe(200)
    expect(committed.json().data).toMatchObject({ bills_posted: 1 })
    expect(committed.json().data.run.status).toBe('committed')
    expect((await call('POST', `/finance/rates/billing/runs/${run.id}/commit`, as.director)).statusCode).toBe(409)
    expect((await call('POST', `/finance/rates/billing/runs/${run.id}/cancel`, as.director,
      { reason: 'second thoughts' })).statusCode).toBe(409)

    const audit = await waitForRows(sys,
      `SELECT severity, details FROM public.admin_audit_event
        WHERE event = 'FIN_RATES_BILLING' AND details->>'action' = 'billing_run_committed'
          AND details->>'run_id' = $1`, [run.id])
    expect(audit[0].severity).toBe('critical')
    expect(audit[0].details).toMatchObject({ bills_posted: 1, total_billed: '2137.00', currency: 'USD' })
  })

  test('whoever raises a run cannot commit it, and a raised run can be cancelled with a reason', async () => {
    // The Director holds both permissions; the control that binds is on the record.
    const second = await call('POST', '/finance/rates/billing/runs', as.director, {
      run_reference: `${TAG}-Q2`, financial_year_id: made.yearId, period_from: '2038-04-01',
      period_to: '2038-06-30', posting_date: '2038-04-05', currency: 'USD',
      receivable_ledger_account_id: made.receivable, revenue_ledger_account_id: made.revenue,
    })
    expect(second.statusCode).toBe(201)
    const runId = second.json().data.run.id
    expect(second.json().data.run.bills_raised).toBe(1)

    const self = await call('POST', `/finance/rates/billing/runs/${runId}/commit`, as.director)
    expect(self.statusCode).toBe(409)
    expect(self.json().error).toBe('separation_of_duties')

    expect((await call('POST', `/finance/rates/billing/runs/${runId}/cancel`, as.director, { reason: 'no' })).statusCode).toBe(400)
    const cancelled = await call('POST', `/finance/rates/billing/runs/${runId}/cancel`, as.director,
      { reason: 'Raised against the wrong quarter' })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().data).toMatchObject({ drafts_cancelled: 1 })
    expect(cancelled.json().data.run).toMatchObject({ status: 'cancelled', cancel_reason: 'Raised against the wrong quarter' })

    // The period is free to be billed again, and nothing of the cancelled run is in the ledger.
    const again = await call('GET',
      `/finance/rates/billing/preview?financial_year_id=${made.yearId}&period_from=2038-04-01&period_to=2038-06-30&currency=USD`,
      as.officer)
    expect(again.json().data.billable).toBe(1)
    const { rows } = await sys.query(
      'SELECT count(*)::int AS n FROM finance.ledger_entry WHERE voucher_no LIKE $1', [`${TAG}-Q2%`])
    expect(rows[0].n).toBe(0)
  })

  test('a payment is recorded by the officer, posted by the Director, and cannot settle more than is open', async () => {
    const base = {
      rates_account_id: made.accountId, financial_year_id: made.yearId, currency: 'USD',
      received_on: '2038-02-10', bank_ledger_account_id: made.bank, method: 'bank_transfer',
    }
    const over = await call('POST', '/finance/rates/receipts', as.officer, {
      ...base, receipt_no: `${TAG}-RC1`, amount: '3000.00',
      allocations: [{ rates_bill_id: made.billId, amount: '2137.01' }],
    })
    expect(over.statusCode).toBe(409)
    expect(over.json().error).toBe('over_allocation')
    expect(over.json().message).toMatch(/has 2137.00 still open and this receipt allocates 2137.01/)

    const notBank = await call('POST', '/finance/rates/receipts', as.officer,
      { ...base, receipt_no: `${TAG}-RC1`, amount: '10.00', bank_ledger_account_id: made.revenue })
    expect(notBank.statusCode).toBe(400)

    // 1 200.00 taken: 1 000.00 against the bill, 200.00 left on the account.
    const taken = await call('POST', '/finance/rates/receipts', as.officer, {
      ...base, receipt_no: `${TAG}-RC1`, amount: '1200.00',
      allocations: [{ rates_bill_id: made.billId, amount: '1000.00' }],
    })
    expect(taken.statusCode).toBe(201)
    const receipt = taken.json().data.receipt
    expect(receipt).toMatchObject({ amount: '1200.00', voucher_status: 'draft', unallocated_amount: '200.00' })
    expect((await call('POST', '/finance/rates/receipts', as.officer,
      { ...base, receipt_no: `${TAG}-RC1`, amount: '5.00' })).statusCode).toBe(409)

    // A draft receipt already holds its part of the bill, so a second cannot take it again.
    const bills = await call('GET', `/finance/rates/bills?rates_account_id=${made.accountId}&status=posted`, as.auditor)
    expect(bills.json().data.bills[0].open_amount).toBe('1137.00')
    const twice = await call('POST', '/finance/rates/receipts', as.officer, {
      ...base, receipt_no: `${TAG}-RC2`, amount: '1137.01',
      allocations: [{ rates_bill_id: made.billId, amount: '1137.01' }],
    })
    expect(twice.statusCode).toBe(409)

    // The officer took the money and cannot put it in the book of account.
    expect((await call('POST', `/finance/rates/receipts/${receipt.id}/post`, as.officer)).statusCode).toBe(403)
    const posted = await call('POST', `/finance/rates/receipts/${receipt.id}/post`, as.director)
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data.entries).toBe(3)

    // A posted receipt is reversed, never cancelled.
    const cancel = await call('POST', `/finance/rates/receipts/${receipt.id}/cancel`, as.officer,
      { reason: 'keyed to the wrong account' })
    expect(cancel.statusCode).toBe(409)
    expect(cancel.json().error).toBe('receipt_posted')

    // A draft one is cancelled with its reason, and kept.
    const stray = await call('POST', '/finance/rates/receipts', as.officer,
      { ...base, receipt_no: `${TAG}-RC3`, amount: '50.00', receivable_ledger_account_id: made.receivable })
    expect(stray.statusCode).toBe(201)
    expect((await call('POST', `/finance/rates/receipts/${stray.json().data.receipt.id}/cancel`, as.officer,
      { reason: 'duplicate of RC1' })).statusCode).toBe(200)
    const { rows } = await sys.query(
      `SELECT v.status, v.cancel_reason, rc.deleted_at IS NOT NULL AS withdrawn
         FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
        WHERE rc.receipt_no = $1`, [`${TAG}-RC3`])
    expect(rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'duplicate of RC1', withdrawn: true })
  })

  test('the arrears, the statement and the control account agree', async () => {
    const statement = await call('GET', `/finance/rates/accounts/${made.accountId}`, as.auditor)
    expect(statement.statusCode).toBe(200)
    const s = statement.json().data
    expect(s.balances).toEqual([{ currency: 'USD', balance: '937.00', owed: '1137.00', unallocated_credit: '200.00' }])
    expect(s.bills.find((b) => b.id === made.billId)).toMatchObject({ outstanding_amount: '1137.00', voucher_status: 'posted' })
    expect(s.receipts.map((r) => r.receipt_no)).toEqual([`${TAG}-RC1`])

    const arrears = await call('GET', `/finance/rates/arrears?q=${TAG}-A1`, as.auditor)
    expect(arrears.statusCode).toBe(200)
    const a = arrears.json().data
    expect(a.accounts).toHaveLength(1)
    expect(a.accounts[0]).toMatchObject({
      account_no: `${TAG}-A1`, currency: 'USD', balance: '937.00', owed: '1137.00',
      unallocated_credit: '200.00', open_bills: 1,
    })
    const usd = a.books.find((b) => b.currency === 'USD')
    expect(usd.buckets.map((b) => b.bucket)).toEqual(
      ['current', '31_60', '61_90', '91_180', '181_365', 'over_365', 'settled', 'unallocated'])
    expect(usd.buckets.find((b) => b.bucket === 'unallocated').outstanding).toBe('-200.00')

    // The reconciliation is over the whole control account, not the filtered slice.
    const recon = a.reconciliation.find((r) => r.currency === 'USD')
    expect(recon.reconciles).toBe(true)
    expect(recon.ledger_difference).toBe('0.00')

    // And against this run's own control account, to the cent.
    const { rows } = await sys.query(
      `SELECT net_debit::text AS balance FROM finance.v_account_balance
        WHERE ledger_account_id = $1 AND currency = 'USD'`, [made.receivable])
    expect(rows[0].balance).toBe('937.00')
  })

  test('readiness now reports that something can be billed', async () => {
    const res = await call('GET', `/finance/rates/readiness?financial_year_id=${made.yearId}`, as.director)
    const d = res.json().data
    expect(d.blockers.find((b) => b.decision === 'D18').met).toBe(true)
    expect(d.properties.with_ratepayer).toBeGreaterThanOrEqual(1)
  })
})
