/**
 * A cut-over from the previous accounting package, end to end, through the real routes and the
 * real database: chart, customers and suppliers, the opening trial balance, open items in both
 * layouts, the reconciliation, and the sign-off that refuses an unexplained difference (G12).
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.migration.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 *
 * IT POSTS TO THE LEDGER, WHICH IS IMMUTABLE. afterAll removes this run's rows with triggers
 * suspended for one transaction. test/helpers/buildApp.js refuses a database that is not
 * obviously disposable.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `MG${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })
const day = (offset) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const dmy = (iso) => iso.split('-').reverse().join('/')

describe('cut-over from the previous accounting package', () => {
  let app
  let sys
  const as = {}
  const made = {}

  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })

  const upload = (token, fields, csv, filename = 'export.csv') => {
    const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
    const body = [
      ...Object.entries(fields).map(([n, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')
    return app.inject({
      method: 'POST', url: `/api/finance/migration/cutovers/${made.cutoverId}/batches`,
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
  }
  const rowsOf = async (batchId, status) =>
    (await call('GET', `/finance/migration/batches/${batchId}/rows?status=${status}`, as.accountant)).json().data.rows
  const code = (n) => `${TAG}-${n}`

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    const accounts = {
      director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test',
      auditor: 'demo.auditor@vungu.test', ceo: 'demo.ceo@vungu.test', cashier: 'demo.cashier@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) as[key] = await loginAs(app, email, PASSWORD)

    // A cut-over left behind by an interrupted run would block this one: only one may be in progress.
    await sys.query(`UPDATE finance.cutover SET status = 'abandoned', abandon_reason = 'left by an interrupted test run',
                       abandoned_at = now() WHERE status = 'preparing' AND name LIKE 'MG%'`)

    const year = await call('POST', '/finance/financial-years', as.director, {
      label: `${TAG} Cut-over year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD',
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect((await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)).statusCode).toBe(200)
    expect((await call('POST', '/finance/ledger/periods', as.director,
      { financial_year_id: made.yearId, periodicity: 'monthly' })).statusCode).toBeLessThan(300)

    // Already in the register before the migration: the customer master names the same party.
    const party = await call('POST', '/finance/ledger/parties', as.accountant,
      { party_type: 'debtor', name: `${TAG} Ncube Stores` })
    expect(party.statusCode).toBe(201)
    made.existingParty = party.json().data.id
  })

  afterAll(async () => {
    if (!app) return
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      const cut = 'SELECT id FROM finance.cutover WHERE financial_year_id = $1'
      const batches = `SELECT id FROM finance.migration_batch WHERE cutover_id IN (${cut})`
      await client.query(`DELETE FROM finance.cutover_reconciliation_line WHERE reconciliation_id IN
                            (SELECT id FROM finance.cutover_reconciliation WHERE cutover_id IN (${cut}))`, [made.yearId])
      await client.query(`DELETE FROM finance.cutover_reconciliation WHERE cutover_id IN (${cut})`, [made.yearId])
      await client.query(`DELETE FROM finance.migration_voucher WHERE batch_id IN (${batches})`, [made.yearId])
      await client.query(`DELETE FROM finance.migration_row WHERE batch_id IN (${batches})`, [made.yearId])
      await client.query(`DELETE FROM finance.account_code_map WHERE cutover_id IN (${cut})`, [made.yearId])
      await client.query(`DELETE FROM finance.party_source_map WHERE cutover_id IN (${cut})`, [made.yearId])
      await client.query(`DELETE FROM finance.migration_batch WHERE cutover_id IN (${cut})`, [made.yearId])
      await client.query('DELETE FROM finance.cutover WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.ledger_entry WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE financial_year_id = $1)', [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.party WHERE name LIKE $1', [`${TAG}%`])
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

  test('the accountant starts a cut-over; nobody without the permission can, and only one is in progress', async () => {
    const body = { name: `${TAG} from Pastel`, source_system: 'pastel_partner', cutover_date: day(-5), financial_year_id: made.yearId }
    for (const who of ['auditor', 'ceo', 'cashier']) {
      expect((await call('POST', '/finance/migration/cutovers', as[who], body)).statusCode).toBe(403)
    }
    expect((await call('POST', '/finance/migration/cutovers', as.accountant, { ...body, cutover_date: day(400) })).json().error)
      .toBe('date_outside_year')
    const res = await call('POST', '/finance/migration/cutovers', as.accountant, body)
    expect(res.statusCode).toBe(201)
    made.cutoverId = res.json().data.id
    expect((await call('POST', '/finance/migration/cutovers', as.accountant, body)).json().error).toBe('cutover_in_progress')
    expect((await call('GET', `/finance/migration/cutovers/${made.cutoverId}`, as.auditor)).statusCode).toBe(200)
    expect((await call('GET', `/finance/migration/cutovers/${made.cutoverId}`, as.cashier)).statusCode).toBe(403)
  })

  test('chart: categories are suggested, an unclassed account waits for a person, every code ends mapped or retired', async () => {
    const csv = [
      'Account Number,Description,Financial Category',
      `${code(1000)},Bank current account,Bank`,
      `${code(1200)},Debtors control,Accounts Receivable`,
      `${code(2000)},Creditors control,Accounts Payable`,
      `${code(3000)},Accumulated surplus,Retained Income`,
      `${code(4000)},Rates income,Sales`,
      `${code(5000)},Salaries,Expenses`,
      `${code(9999)},Old suspense,Mystery`,
    ].join('\r\n')
    const up = await upload(as.accountant, { load_kind: 'chart' }, csv, 'accounts.csv')
    expect(up.statusCode).toBe(201)
    const batch = up.json().data.batch
    made.chart = batch.id
    expect(batch.column_map).toEqual({ code: 'Account Number', name: 'Description', category: 'Financial Category' })
    expect(batch.options.category_map.Bank).toMatchObject({ root_type: 'asset', account_type: 'bank', suggested: true })
    expect(batch.options.category_map.Mystery).toMatchObject({ root_type: null })

    const checked = (await call('POST', `/finance/migration/batches/${batch.id}/validate`, as.accountant)).json().data.batch
    expect(checked).toMatchObject({ status: 'validated', rows_ready: 6, rows_problem: 1 })
    expect((await call('POST', `/finance/migration/batches/${batch.id}/commit`, as.accountant)).json().error).toBe('rows_need_decision')

    const [stuck] = await rowsOf(batch.id, 'problem')
    expect(stuck.problems[0].message).toMatch(/Mystery/)
    // Retiring needs a reason.
    const bare = await call('POST', `/finance/migration/batches/${batch.id}/decisions`, as.accountant,
      { row_ids: [stuck.id], decision: { action: 'set_aside' } })
    expect(bare.json().data.batch.rows_problem).toBe(1)
    const decided = await call('POST', `/finance/migration/batches/${batch.id}/decisions`, as.accountant,
      { row_ids: [stuck.id], decision: { action: 'set_aside', note: 'Cleared in 2019, nil since' } })
    expect(decided.json().data.batch).toMatchObject({ rows_problem: 0, rows_set_aside: 1 })

    const commit = await call('POST', `/finance/migration/batches/${batch.id}/commit`, as.accountant)
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.result).toEqual({ accounts_created: 6, codes_mapped: 0, codes_retired: 1 })

    const map = (await call('GET', `/finance/migration/cutovers/${made.cutoverId}/account-map`, as.auditor)).json().data.entries
    expect(map).toHaveLength(7)
    expect(map.find((m) => m.source_code === code(9999))).toMatchObject({ disposition: 'retired', ledger_account_id: null })
    const debtors = map.find((m) => m.source_code === code(1200))
    made.debtorsAccount = debtors.ledger_account_id
    made.creditorsAccount = map.find((m) => m.source_code === code(2000)).ledger_account_id
    made.bankAccount = map.find((m) => m.source_code === code(1000)).ledger_account_id
    made.incomeAccount = map.find((m) => m.source_code === code(4000)).ledger_account_id

    // The same bytes again: everything is already mapped, so nothing is written twice.
    const again = (await upload(as.accountant, { load_kind: 'chart' }, csv, 'accounts.csv')).json().data.batch
    const recheck = (await call('POST', `/finance/migration/batches/${again.id}/validate`, as.accountant)).json().data.batch
    expect(recheck).toMatchObject({ rows_ready: 0, rows_set_aside: 7 })
    expect((await call('POST', `/finance/migration/batches/${again.id}/cancel`, as.accountant)).statusCode).toBe(200)
  })

  test('customers and suppliers: a possible duplicate is decided by a person, never merged on its name', async () => {
    const customers = ['Account,Name,Telephone', `${code('C1')},${TAG} T Moyo,054 222 000`, `${code('C2')},${TAG} Ncube Stores,`].join('\r\n')
    const batch = (await upload(as.accountant, { load_kind: 'parties', party_kind: 'customer' }, customers, 'customers.csv')).json().data.batch
    const checked = (await call('POST', `/finance/migration/batches/${batch.id}/validate`, as.accountant)).json().data.batch
    expect(checked).toMatchObject({ rows_ready: 1, rows_problem: 1 })
    const [dup] = await rowsOf(batch.id, 'problem')
    expect(dup.problems[0].candidates[0].id).toBe(made.existingParty)
    await call('POST', `/finance/migration/batches/${batch.id}/decisions`, as.accountant,
      { row_ids: [dup.id], decision: { action: 'map', party_id: made.existingParty } })
    const commit = await call('POST', `/finance/migration/batches/${batch.id}/commit`, as.accountant)
    expect(commit.json().data.result).toEqual({ parties_created: 1, parties_matched: 1, rows_set_aside: 0 })

    const suppliers = ['Supplier Code,Supplier Name', `${code('S1')},${TAG} Gweru Hardware`].join('\r\n')
    const sup = (await upload(as.accountant, { load_kind: 'parties', party_kind: 'supplier' }, suppliers, 'suppliers.csv')).json().data.batch
    await call('POST', `/finance/migration/batches/${sup.id}/validate`, as.accountant)
    expect((await call('POST', `/finance/migration/batches/${sup.id}/commit`, as.accountant)).json().data.result.parties_created).toBe(1)
    const { rows } = await sys.query(`SELECT party_type FROM finance.party WHERE name = $1`, [`${TAG} Gweru Hardware`])
    expect(rows[0].party_type).toBe('supplier')
  })

  test('opening trial balance: an unbalanced file is refused whole, a retired code with a balance waits, and the loader cannot post', async () => {
    const lines = (surplus) => [
      'Account,Description,Debit,Credit',
      `${code(1000)},Bank current account,"1,000.00",`,
      `${code(1200)},Debtors control,300.00,`,
      `${code(2000)},Creditors control,,200.00`,
      `${code(3000)},Accumulated surplus,,${surplus}`,
      `${code(5000)},Salaries,0.00,0.00`,
      ',Total,1300.00,1300.00',
    ].join('\r\n')

    const bad = (await upload(as.accountant, { load_kind: 'opening_balance', currency: 'USD' }, lines('1000.00'), 'tb.csv')).json().data.batch
    const badChecked = (await call('POST', `/finance/migration/batches/${bad.id}/validate`, as.accountant)).json().data.batch
    expect(badChecked).toMatchObject({ rows_ready: 4, rows_problem: 0, rows_set_aside: 2, total_debit: '1300.00', total_credit: '1200.00' })
    const refused = await call('POST', `/finance/migration/batches/${bad.id}/commit`, as.accountant)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: 'trial_balance_does_not_balance' })
    expect(refused.json().message).toMatch(/difference 100\.00/)
    await call('POST', `/finance/migration/batches/${bad.id}/cancel`, as.accountant)

    expect((await upload(as.accountant, { load_kind: 'opening_balance' }, lines('1100.00'))).json().error).toBe('missing_currency')

    // A control total that disagrees with the file: a truncated export.
    const short = (await upload(as.accountant, { load_kind: 'opening_balance', currency: 'USD', declared_total: '1350.00' }, lines('1100.00'), 'tb.csv')).json().data.batch
    await call('POST', `/finance/migration/batches/${short.id}/validate`, as.accountant)
    expect((await call('POST', `/finance/migration/batches/${short.id}/commit`, as.accountant)).json().error).toBe('control_total_mismatch')
    await call('PATCH', `/finance/migration/batches/${short.id}`, as.accountant, { declared_total: '1300.00' })
    await call('POST', `/finance/migration/batches/${short.id}/validate`, as.accountant)
    made.opening = short.id

    const commit = await call('POST', `/finance/migration/batches/${short.id}/commit`, as.accountant)
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.result).toMatchObject({ lines: 4, debit_total: '1300.00', credit_total: '1300.00' })
    made.openingVoucher = commit.json().data.result.voucher_id

    // Nothing is in the ledger until somebody else posts it.
    const { rows: before } = await sys.query('SELECT count(*)::int AS n FROM finance.ledger_entry WHERE voucher_id = $1', [made.openingVoucher])
    expect(before[0].n).toBe(0)
    expect((await call('POST', `/finance/migration/batches/${short.id}/post`, as.accountant)).json().error).toBe('separation_of_duties')
    const posted = await call('POST', `/finance/migration/batches/${short.id}/post`, as.director)
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data.posted).toBe(1)

    // A second opening trial balance for the same currency would double the position.
    const second = (await upload(as.accountant, { load_kind: 'opening_balance', currency: 'USD' }, `${lines('1100.00')}\r\n`, 'tb2.csv')).json().data.batch
    await call('POST', `/finance/migration/batches/${second.id}/validate`, as.accountant)
    expect((await call('POST', `/finance/migration/batches/${second.id}/commit`, as.accountant)).json().error).toBe('already_loaded')
    await call('POST', `/finance/migration/batches/${second.id}/cancel`, as.accountant)
  })

  test('open items: they must equal the control account, and each document ages from its own date', async () => {
    const fields = { load_kind: 'open_items', currency: 'USD', item_side: 'debtors', control_account_id: made.debtorsAccount }
    expect((await upload(as.accountant, { ...fields, control_account_id: made.bankAccount }, 'Account,Outstanding\r\nX,1')).json().error)
      .toBe('bad_control_account')

    const items = (extra) => [
      'Account,Document No,Document Date,Outstanding',
      `${code('C1')},INV-1,${dmy(day(-100))},100.00`,
      `${code('C2')},INV-2,${dmy(day(-10))},250.00`,
      `${code('C9')},INV-9,${dmy(day(-10))},10.00`,
      ...extra,
    ].join('\r\n')

    const batch = (await upload(as.accountant, fields, items([]), 'debtors.csv')).json().data.batch
    const checked = (await call('POST', `/finance/migration/batches/${batch.id}/validate`, as.accountant)).json().data.batch
    expect(checked).toMatchObject({ rows_ready: 2, rows_problem: 1 })
    const [unknown] = await rowsOf(batch.id, 'problem')
    expect(unknown.problems[0].message).toMatch(/was not brought across/)
    // The person says which party C9 is; that holds for every later file.
    await call('POST', `/finance/migration/batches/${batch.id}/decisions`, as.accountant,
      { row_ids: [unknown.id], decision: { action: 'map', party_id: made.existingParty } })
    const disagree = await call('POST', `/finance/migration/batches/${batch.id}/commit`, as.accountant)
    expect(disagree.json().error).toBe('open_items_disagree_with_control')
    expect(disagree.json().message).toMatch(/360\.00.*300\.00/)
    await call('POST', `/finance/migration/batches/${batch.id}/cancel`, as.accountant)

    // With the customer's unallocated payment of 60.00 the list agrees with the control account.
    const good = (await upload(as.accountant, fields, items([`${code('C1')},PMT-7,${dmy(day(-3))},-60.00`]), 'debtors2.csv')).json().data.batch
    await call('POST', `/finance/migration/batches/${good.id}/validate`, as.accountant)
    const commit = await call('POST', `/finance/migration/batches/${good.id}/commit`, as.accountant)
    expect(commit.statusCode).toBe(200)
    expect(commit.json().data.result).toMatchObject({ vouchers: 4, items_total: '300.00', control_balance: '300.00' })
    expect((await call('POST', `/finance/migration/batches/${good.id}/post`, as.director)).json().data.posted).toBe(4)

    // Creditors, from a summary age analysis: one row per supplier, one column per age.
    const aged = ['Supplier,Current,30 Days,60 Days', `${code('S1')},120.00,0.00,80.00`, 'Total,120.00,0.00,80.00'].join('\r\n')
    const cred = (await upload(as.accountant,
      { load_kind: 'open_items', currency: 'USD', item_side: 'creditors', control_account_id: made.creditorsAccount }, aged, 'creditors.csv')).json().data.batch
    expect(cred.column_map).toMatchObject({ party_code: 'Supplier', age_current: 'Current', age_60: '60 Days' })
    const credChecked = (await call('POST', `/finance/migration/batches/${cred.id}/validate`, as.accountant)).json().data.batch
    // "Total" is not a supplier that was brought across, so it waits rather than being loaded.
    expect(credChecked).toMatchObject({ rows_ready: 1, rows_problem: 1 })
    const [total] = await rowsOf(cred.id, 'problem')
    // An open-item line cannot be mapped to nobody; the file is corrected instead.
    await call('POST', `/finance/migration/batches/${cred.id}/cancel`, as.accountant)
    expect(total.parsed.party_code).toBe('Total')
    const cred2 = (await upload(as.accountant,
      { load_kind: 'open_items', currency: 'USD', item_side: 'creditors', control_account_id: made.creditorsAccount },
      aged.split('\r\n').slice(0, 2).join('\r\n'), 'creditors2.csv')).json().data.batch
    await call('POST', `/finance/migration/batches/${cred2.id}/validate`, as.accountant)
    const credCommit = await call('POST', `/finance/migration/batches/${cred2.id}/commit`, as.accountant)
    expect(credCommit.json().data.result).toMatchObject({ vouchers: 2, items_total: '200.00' })
    expect((await call('POST', `/finance/migration/batches/${cred2.id}/post`, as.director)).json().data.posted).toBe(2)

    // The control accounts are unchanged by the transfers.
    const { rows: control } = await sys.query(
      `SELECT ledger_account_id, sum(debit) - sum(credit) AS net FROM finance.ledger_entry
        WHERE financial_year_id = $1 AND ledger_account_id = ANY($2::uuid[]) GROUP BY 1`,
      [made.yearId, [made.debtorsAccount, made.creditorsAccount]])
    expect(Number(control.find((c) => c.ledger_account_id === made.debtorsAccount).net)).toBe(300)
    expect(Number(control.find((c) => c.ledger_account_id === made.creditorsAccount).net)).toBe(-200)

    // Ageing: the party-less opening figure is settled; each document stands on its own date.
    const { rows: ageing } = await sys.query(
      `SELECT party_id, voucher_no, outstanding_amount::text AS outstanding, aged_from::text AS aged_from, ageing_bucket
         FROM finance.v_debtor_ageing WHERE ledger_account_id = $1 AND outstanding_amount <> 0`, [made.debtorsAccount])
    expect(ageing.every((a) => a.party_id !== null)).toBe(true)
    expect(ageing.reduce((sum, a) => sum + Number(a.outstanding), 0)).toBe(300)
    expect(ageing.find((a) => a.outstanding === '100.00')).toMatchObject({ aged_from: day(-100), ageing_bucket: '91_180' })
    expect(ageing.find((a) => a.outstanding === '-60.00')).toMatchObject({ ageing_bucket: 'unallocated' })
  })

  test('reconciliation and sign-off: an unexplained difference refuses the cut-over, and a loader cannot sign', async () => {
    const drawn = await call('POST', `/finance/migration/batches/${made.opening}/reconcile`, as.accountant)
    expect(drawn.statusCode).toBe(201)
    made.recon = drawn.json().data.reconciliation_id
    const ours = async () => {
      const { lines } = (await call('GET', `/finance/migration/reconciliations/${made.recon}`, as.auditor)).json().data
      return lines.filter((l) => (l.account_code || '').startsWith(TAG) || (l.source_codes || '').startsWith(TAG))
    }
    // Everything this cut-over loaded agrees with the ledger, to the cent.
    expect((await ours()).every((l) => l.difference === '0.00')).toBe(true)
    expect((await ours()).find((l) => l.account_code === code(1000))).toMatchObject({ source_net_debit: '1000.00', ledger_net_debit: '1000.00' })

    // A journal dated on the cut-over day that the old package never saw.
    const journal = await call('POST', '/finance/ledger/vouchers', as.accountant, {
      voucher_no: `${TAG}-J1`, voucher_type: 'journal', currency: 'USD', financial_year_id: made.yearId, posting_date: day(-5),
      lines: [{ ledger_account_id: made.bankAccount, debit: '10.00' }, { ledger_account_id: made.incomeAccount, credit: '10.00' }],
    })
    expect(journal.statusCode).toBe(201)
    expect((await call('POST', `/finance/ledger/vouchers/${journal.json().data.voucher.id}/post`, as.director)).statusCode).toBe(200)
    await call('POST', `/finance/migration/reconciliations/${made.recon}/refresh`, as.accountant)
    const differing = (await ours()).filter((l) => l.difference !== '0.00')
    expect(differing.map((l) => l.difference).sort()).toEqual(['-10.00', '10.00'])

    // Other suites' postings in this disposable database are differences too. Explain those, and
    // leave this run's two unexplained.
    const all = (await call('GET', `/finance/migration/reconciliations/${made.recon}?only=differences`, as.auditor)).json().data.lines
    for (const line of all.filter((l) => !differing.some((d) => d.id === l.id))) {
      await call('PATCH', `/finance/migration/reconciliation-lines/${line.id}`, as.accountant, { explanation: 'Belongs to another test fixture' })
    }

    expect((await call('POST', `/finance/migration/cutovers/${made.cutoverId}/sign-off`, as.accountant, {})).statusCode).toBe(403)
    const refused = await call('POST', `/finance/migration/cutovers/${made.cutoverId}/sign-off`, as.director, {})
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: 'cutover_not_ready' })
    expect(refused.json().message).toMatch(/2 difference\(s\) with no explanation/)

    for (const line of differing) {
      const res = await call('PATCH', `/finance/migration/reconciliation-lines/${line.id}`, as.accountant,
        { explanation: 'Bank interest for the cut-over day, journalled here as J1 and not in Pastel' })
      expect(res.statusCode).toBe(200)
    }
    const detail = (await call('GET', `/finance/migration/cutovers/${made.cutoverId}`, as.ceo)).json().data
    expect(detail.readiness.filter((r) => r.blocking && !r.passed)).toEqual([])
    expect(detail.opening_period).toMatchObject({ status: 'open' })

    const signed = await call('POST', `/finance/migration/cutovers/${made.cutoverId}/sign-off`, as.director, { note: 'Agreed to Pastel TB' })
    expect(signed.statusCode).toBe(200)

    // Closed: evidence now.
    expect((await upload(as.accountant, { load_kind: 'chart' }, 'Account,Description\r\nX,Y')).json().error).toBe('cutover_closed')
    const late = await call('PATCH', `/finance/migration/reconciliation-lines/${differing[0].id}`, as.accountant, { explanation: 'Changed my mind' })
    expect(late.statusCode).toBe(409)
    const { rows } = await sys.query('SELECT status, signed_off_by <> created_by AS two_people FROM finance.cutover WHERE id = $1', [made.cutoverId])
    expect(rows[0]).toEqual({ status: 'signed_off', two_people: true })
  })

  test('a blank template is offered for each load', async () => {
    const res = await call('GET', '/finance/migration/templates/opening_balance', as.accountant)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.body.split('\r\n')[0]).toBe('Account Number,Description,Debit,Credit')
  })
})
