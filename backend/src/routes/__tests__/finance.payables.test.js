/**
 * Creditors end to end: capture a supplier invoice, approve it, pay it in part and in full, and
 * the refusals (duplicate invoice, own approval, overpayment, editing the voucher as a journal).
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.payables.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `PY${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const day = (o) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + o); return d.toISOString().slice(0, 10) }

describe('creditors', () => {
  let app
  let sys
  const as = {}
  const made = {}
  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const balance = async (account) => (await sys.query(
    'SELECT COALESCE(sum(debit) - sum(credit), 0)::text AS net FROM finance.ledger_entry WHERE ledger_account_id = $1 AND financial_year_id = $2',
    [account, made.yearId])).rows[0].net
  const open = async () => (await call('GET', `/finance/payables/open?party_id=${made.supplier}`, as.auditor)).json().data.items
  const invoiceBody = (ref, extra = {}) => ({
    party_id: made.supplier, currency: 'USD', financial_year_id: made.yearId, invoice_date: day(-40), due_date: day(-10),
    supplier_ref: ref, payable_account_id: made.payable, tax_account_id: made.tax,
    lines: [{ ledger_account_id: made.fuel, description: 'Diesel', net_amount: '1000.00', tax_amount: '150.00' },
      { ledger_account_id: made.repairs, net_amount: '200.00' }],
    ...extra,
  })

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    for (const [k, email] of Object.entries({
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test', officer: 'demo.finance-officer@vungu.test',
      auditor: 'demo.auditor@vungu.test', cashier: 'demo.cashier@vungu.test',
    })) as[k] = await loginAs(app, email, PASSWORD)
    const year = await call('POST', '/finance/financial-years', as.director,
      { label: `${TAG} Creditors year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD' })
    if (year.statusCode !== 201) throw new Error(year.body)
    made.yearId = year.json().data.id
    await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)
    await call('POST', '/finance/ledger/periods', as.director, { financial_year_id: made.yearId, periodicity: 'monthly' })
    const account = async (code, name, root, type) => (await call('POST', '/finance/ledger/accounts', as.director,
      { code: `${TAG}-${code}`, name, root_type: root, ...(type ? { account_type: type } : {}) })).json().data.id
    made.bank = await account('1100', 'Creditors test bank', 'asset', 'bank')
    made.payable = await account('2000', 'Creditors test control', 'liability', 'payable')
    made.tax = await account('2100', 'Creditors test VAT', 'liability', 'tax')
    made.fuel = await account('5100', 'Creditors test fuel', 'expense')
    made.repairs = await account('5200', 'Creditors test repairs', 'expense')
    made.supplier = (await call('POST', '/finance/ledger/parties', as.accountant, { party_type: 'supplier', name: `${TAG} Petrotrade` })).json().data.id
  })

  afterAll(async () => {
    if (!app) return
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      await client.query('DELETE FROM finance.supplier_payment_allocation WHERE payment_id IN (SELECT id FROM finance.supplier_payment WHERE party_id = $1)', [made.supplier])
      await client.query('DELETE FROM finance.supplier_payment WHERE party_id = $1', [made.supplier])
      await client.query('DELETE FROM finance.supplier_invoice_line WHERE invoice_id IN (SELECT id FROM finance.supplier_invoice WHERE party_id = $1)', [made.supplier])
      await client.query('DELETE FROM finance.supplier_invoice WHERE party_id = $1', [made.supplier])
      await client.query('DELETE FROM finance.ledger_entry WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE financial_year_id = $1)', [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.party WHERE id = $1', [made.supplier])
      await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.financial_year WHERE id = $1', [made.yearId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
      await app.close()
    }
  })

  test('an invoice is captured as a draft: nothing is owed in the ledger until somebody else approves it', async () => {
    expect((await call('POST', '/finance/payables/invoices', as.auditor, invoiceBody('INV-1'))).statusCode).toBe(403)
    expect((await call('POST', '/finance/payables/invoices', as.cashier, invoiceBody('INV-1'))).statusCode).toBe(403)
    const noTaxAccount = invoiceBody('INV-0'); delete noTaxAccount.tax_account_id
    expect((await call('POST', '/finance/payables/invoices', as.officer, noTaxAccount)).statusCode).toBe(409)
    expect((await call('POST', '/finance/payables/invoices', as.officer, invoiceBody('INV-0', { payable_account_id: made.bank }))).statusCode).toBe(409)

    const res = await call('POST', '/finance/payables/invoices', as.officer, invoiceBody('INV-1'))
    expect(res.statusCode).toBe(201)
    made.invoice = res.json().data.id
    expect(await balance(made.payable)).toBe('0')
    expect(await open()).toEqual([])

    const dup = await call('POST', '/finance/payables/invoices', as.accountant, invoiceBody(' inv-1 '))
    expect(dup.json()).toMatchObject({ error: 'duplicate_invoice' })

    // The officer holds no approval; and whoever captured it could not approve it anyway.
    expect((await call('POST', `/finance/payables/invoices/${made.invoice}/approve`, as.officer)).statusCode).toBe(403)
    const mine = await call('POST', '/finance/payables/invoices', as.accountant, invoiceBody('INV-2', { lines: [{ ledger_account_id: made.fuel, net_amount: '50.00' }] }))
    made.invoice2 = mine.json().data.id
    expect((await call('POST', `/finance/payables/invoices/${made.invoice2}/approve`, as.accountant)).json().error).toBe('separation_of_duties')
  })

  test('approval posts the invoice: expense net of tax, input tax, and the creditor, aged from the invoice date', async () => {
    expect((await call('POST', `/finance/payables/invoices/${made.invoice}/approve`, as.accountant)).statusCode).toBe(200)
    expect(await balance(made.fuel)).toBe('1000.00')
    expect(await balance(made.repairs)).toBe('200.00')
    expect(await balance(made.tax)).toBe('150.00')
    expect(await balance(made.payable)).toBe('-1350.00')

    const [item] = await open()
    expect(item).toMatchObject({ document_ref: 'INV-1', outstanding: '1350.00', payable: '1350.00', document_date: day(-40), days_overdue: 10, bucket: '31_60' })
    made.invoiceVoucher = item.voucher_id
    const detail = (await call('GET', `/finance/payables/invoices/${made.invoice}`, as.auditor)).json().data
    expect(detail.invoice).toMatchObject({ status: 'approved', total: '1350.00', outstanding: '1350.00' })
    expect(detail.lines).toHaveLength(2)

    // Its voucher cannot be edited or discarded as a journal.
    expect((await call('DELETE', `/finance/payables/invoices/${made.invoice}`, as.officer)).json().error).toBe('already_done')
    const { rows } = await sys.query('SELECT voucher_id FROM finance.supplier_invoice WHERE id = $1', [made.invoice2])
    const edit = await call('PATCH', `/finance/ledger/vouchers/${rows[0].voucher_id}`, as.accountant, {
      lines: [{ ledger_account_id: made.fuel, debit: '9999.00' }, { ledger_account_id: made.payable, credit: '9999.00' }],
    })
    expect(edit.statusCode).toBe(409)
    expect(edit.json().error).toBe('document_voucher')
    // The draft is discarded through its own document.
    expect((await call('DELETE', `/finance/payables/invoices/${made.invoice2}`, as.accountant)).statusCode).toBe(200)
  })

  test('a payment cannot exceed what is open, counting payments already drafted', async () => {
    const pay = (amount, who = as.officer) => call('POST', '/finance/payables/payments', who, {
      party_id: made.supplier, currency: 'USD', financial_year_id: made.yearId, payment_date: day(-1), bank_account_id: made.bank,
      method: 'bank_transfer', reference: 'TRF-7781', allocations: [{ against_voucher_id: made.invoiceVoucher, amount }],
    })
    expect((await pay('1350.01')).json().error).toBe('overpayment')
    expect((await pay('500.00', as.auditor)).statusCode).toBe(403)

    const first = await pay('500.00')
    expect(first.statusCode).toBe(201)
    made.payment = first.json().data.id
    // Drafted, not paid: the ledger is unchanged, but 500.00 is already spoken for.
    expect(await balance(made.bank)).toBe('0')
    expect((await open())[0]).toMatchObject({ outstanding: '1350.00', pending: '500.00', payable: '850.00' })
    const second = await pay('900.00')
    expect(second.json().error).toBe('overpayment')
    expect(second.json().message).toMatch(/only 850\.00 is still open/)

    expect((await call('POST', `/finance/payables/payments/${made.payment}/approve`, as.officer)).statusCode).toBe(403)
    expect((await call('POST', `/finance/payables/payments/${made.payment}/approve`, as.accountant)).statusCode).toBe(200)
    expect(await balance(made.bank)).toBe('-500.00')
    expect(await balance(made.payable)).toBe('-850.00')
    expect((await open())[0]).toMatchObject({ outstanding: '850.00', pending: '0.00', settled: '500.00' })

    // The rest, prepared by the accountant and approved by the Director.
    const rest = await pay('850.00', as.accountant)
    expect((await call('POST', `/finance/payables/payments/${rest.json().data.id}/approve`, as.accountant)).json().error).toBe('separation_of_duties')
    expect((await call('POST', `/finance/payables/payments/${rest.json().data.id}/approve`, as.director)).statusCode).toBe(200)
    expect(await open()).toEqual([])
    expect(await balance(made.payable)).toBe('0.00')
    expect((await call('GET', `/finance/payables/invoices?status=paid&party_id=${made.supplier}`, as.auditor)).json().data.invoices).toHaveLength(1)
    const payments = (await call('GET', `/finance/payables/payments?party_id=${made.supplier}`, as.auditor)).json().data.payments
    expect(payments.map((p) => [p.total, p.status, p.pays[0].document_ref])).toEqual(
      expect.arrayContaining([['500.00', 'approved', 'INV-1'], ['850.00', 'approved', 'INV-1']]))
  })

  test('reversing a payment re-opens what it paid', async () => {
    const { rows } = await sys.query('SELECT voucher_id FROM finance.supplier_payment WHERE id = $1', [made.payment])
    const res = await call('POST', `/finance/ledger/vouchers/${rows[0].voucher_id}/reverse`, as.accountant, { reason: 'Transfer returned by the bank' })
    expect(res.statusCode).toBe(201)
    // B-SOD: the reversal is a draft until somebody other than its preparer posts it.
    expect(res.json().data.reversal.status).toBe('draft')
    const posted = await call('POST', `/finance/ledger/vouchers/${res.json().data.reversal.id}/post`, as.director,
      { expected_version: res.json().data.reversal.version })
    expect(posted.statusCode).toBe(200)
    expect((await open())[0]).toMatchObject({ outstanding: '500.00', payable: '500.00' })
    const summary = (await call('GET', '/finance/payables/summary', as.auditor)).json().data
    expect(summary.payable_accounts.some((a) => a.id === made.payable)).toBe(true)
    expect(summary.owed.find((o) => o.currency === 'USD')).toBeTruthy()
  })
})
