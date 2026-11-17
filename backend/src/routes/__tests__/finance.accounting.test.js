/**
 * The Accounting workspace's server side, end to end through the real routes and the real database.
 *
 * THIS SUITE GROWS TASK BY TASK AND ITS FIXTURE ACCUMULATES. Each block below adds to the books the
 * blocks above it left. Before asserting a figure, either create fresh years and TAG-prefixed
 * accounts with `makeYear` and `account` so the figure is pristine, or derive it from the blocks
 * above and say how. Nothing posts into year 1 once the "migration 242" block has run: year 1 is
 * closed (USD), year 2 is open, year 3 is closed, reversed and closed again.
 *
 * THE FIXTURE YEARS ARE 1991, 1992 AND 1993, ON PURPOSE (and 1990, made by the LAST test of the B12
 * block only, so that an earlier year left unclosed cannot disturb any figure above it). `finance.ledger_balances` carries balances
 * forward from EARLIER years, so the fixture must be earlier than every other row in the database
 * or another suite's postings would leak into these figures. A run that crashed before its teardown
 * leaves those years behind and the next run could not create them (financial years may not
 * overlap), so `beforeAll` first removes what such a run left.
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.accounting.test.js \
 *     --testPathIgnorePatterns '/node_modules/' --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { tenantPool } = require('../../lib/tenancy')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `AC${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

const PEOPLE = {
  director: 'demo.finance-admin@vungu.test', accountant: 'demo.accountant@vungu.test',
  auditor: 'demo.auditor@vungu.test', cashier: 'demo.cashier@vungu.test',
}

// ── Shared by every block in this file ────────────────────────────────────────────────────────
let app
let sys
/** Bearer tokens: as.director, as.accountant, as.auditor, as.cashier. */
const as = {}
/** User ids for the same four people, and ids.authority, the council they belong to. */
const ids = {}
/** The fixture: made.y1, y2, y3 (financial years) and made.bank, debtors, tax, surplus, income, expense. */
const made = {}
/** Every financial year `makeYear` created, for the teardown. */
const years = []

const call = (method, url, token, payload) =>
  app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })

/** A financial year, opened, with its twelve monthly periods open. Returns its id. */
const makeYear = async (label, start, end) => {
  const year = await call('POST', '/finance/financial-years', as.director,
    { label: `${TAG} ${label}`, start_date: start, end_date: end, reporting_currency: 'USD' })
  if (year.statusCode !== 201) throw new Error(`financial year ${label} was not created (${year.statusCode}): ${year.body}`)
  const id = year.json().data.id
  years.push(id)
  const opened = await call('POST', `/finance/financial-years/${id}/open`, as.director)
  if (opened.statusCode !== 200) throw new Error(`financial year ${label} was not opened (${opened.statusCode}): ${opened.body}`)
  const periods = await call('POST', '/finance/ledger/periods', as.director, { financial_year_id: id, periodicity: 'monthly' })
  if (periods.statusCode !== 201) throw new Error(`periods of ${label} were not opened (${periods.statusCode}): ${periods.body}`)
  return id
}

/** A ledger account coded `${TAG}-<code>`, created by the Director. Returns its id. */
const account = async (code, name, root, type) => {
  const res = await call('POST', '/finance/ledger/accounts', as.director,
    { code: `${TAG}-${code}`, name, root_type: root, ...(type ? { account_type: type } : {}) })
  if (res.statusCode !== 201) throw new Error(`account ${code} was not created (${res.statusCode}): ${res.body}`)
  return res.json().data.id
}

/**
 * A posted journal: prepared by the accountant, posted by the Director. Returns the voucher id.
 * `extra` goes onto the voucher as given (voucher_no, narration, reference, currency, voucher_type);
 * with no voucher_no the number is issued from the journal series.
 */
const journal = async (yearId, date, lines, extra = {}) => {
  const res = await call('POST', '/finance/ledger/vouchers', as.accountant,
    { voucher_type: 'journal', currency: 'USD', financial_year_id: yearId, posting_date: date, lines, ...extra })
  if (res.statusCode !== 201) throw new Error(`journal of ${date} was not created (${res.statusCode}): ${res.body}`)
  const id = res.json().data.voucher.id
  // B-SOD: the poster sends the version they reviewed; a new draft is version 1.
  const posted = await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director,
    { expected_version: res.json().data.voucher.version })
  if (posted.statusCode !== 200) throw new Error(`journal of ${date} was not posted (${posted.statusCode}): ${posted.body}`)
  return id
}

/** The version a voucher is at now, as GET /vouchers/:id shows it to the person about to post it. */
const versionOf = async (voucherId, token = as.auditor) => {
  const res = await call('GET', `/finance/ledger/vouchers/${voucherId}`, token)
  if (res.statusCode !== 200) throw new Error(`voucher ${voucherId} could not be read (${res.statusCode}): ${res.body}`)
  return res.json().data.voucher.version
}

/** Post a voucher as `token`, sending the version it is at now (read first, as a reviewer would). */
const postAs = async (token, voucherId) => call('POST', `/finance/ledger/vouchers/${voucherId}/post`, token,
  { expected_version: await versionOf(voucherId) })

/**
 * Close every period of a year that is still open, as `token` (the accountant by default). B11: the
 * year-end close is raised only when no period of the year is open.
 */
const closeAllPeriods = async (yearId, token = as.accountant) => {
  const { rows } = await sys.query(
    "SELECT id, period_no FROM finance.ledger_period WHERE financial_year_id = $1 AND status = 'open' ORDER BY period_no", [yearId])
  for (const p of rows) {
    const res = await call('PATCH', `/finance/ledger/periods/${p.id}`, token, { status: 'closed' })
    if (res.statusCode !== 200) throw new Error(`period ${p.period_no} was not closed (${res.statusCode}): ${res.body}`)
  }
}

/** Two lines that balance: Dr expense, Cr bank. */
const pair = (amount) => [
  { ledger_account_id: made.expense, debit: amount },
  { ledger_account_id: made.bank, credit: amount },
]

// Amounts leave the database as text with two decimals, so an assertion compares '1550.00' with
// '1550.00' and no figure is ever a JavaScript number.
const BALANCE_COLUMNS = `currency, ledger_account_id, account_code, account_name, root_type, report_type,
  account_type, entry_count, debit_total::numeric(18,2)::text AS debit_total,
  credit_total::numeric(18,2)::text AS credit_total, net_debit::numeric(18,2)::text AS net_debit`

/** The rows of finance.ledger_balances, read through the system connection. */
const balances = async (yearId, asAt = null, closing = 'after') => (await sys.query(
  `SELECT ${BALANCE_COLUMNS} FROM finance.ledger_balances($1, $2, $3)`, [yearId, asAt, closing])).rows

/** One account's USD balance, signed debit-positive, or undefined when it has no row. */
const net = (rows, accountId) =>
  (rows.find((r) => r.currency === 'USD' && r.ledger_account_id === accountId) || {}).net_debit

/** The USD "earlier years not yet closed" row, or undefined. */
const unclosedRow = (rows) => rows.find((r) => r.currency === 'USD' && r.ledger_account_id === null)
/** That row's balance, or undefined when every earlier year is closed. */
const unclosed = (rows) => (unclosedRow(rows) || {}).net_debit

/** What the USD book nets to. Summed by the database, never in JavaScript. */
const sumNet = async (yearId, asAt = null, closing = 'after') => (await sys.query(
  `SELECT sum(net_debit)::numeric(18,2)::text AS total FROM finance.ledger_balances($1, $2, $3) WHERE currency = 'USD'`,
  [yearId, asAt, closing])).rows[0].total

/** finance.year_closed for one book of one year. */
const closed = async (yearId, currency = 'USD') => (await sys.query(
  'SELECT finance.year_closed($1, $2) AS closed', [yearId, currency])).rows[0].closed

/**
 * Remove ledger fixture rows: the years given, everything posted in them, the bank statements on
 * the ledger accounts whose code matches (with their lines and matches), those accounts, and the
 * parties whose reference matches. The ledger is insert-only and a reconciled statement is frozen,
 * so this runs with the triggers set aside, which is why the suite needs a disposable database. The
 * triggers set aside include the foreign keys' cascades, so every child row is deleted by name,
 * children first.
 */
const removeLedgerFixture = async (yearIds, accountCodePattern) => {
  const client = await sys.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL session_replication_role = 'replica'")
    // Bank statements on the fixture's accounts (a crashed run leaves them; Task 9 imports one).
    const statements = `SELECT st.id FROM finance.bank_statement st
                         JOIN finance.ledger_account la ON la.id = st.bank_account_id WHERE la.code ~ $1`
    await client.query(
      `DELETE FROM finance.bank_match_entry
        WHERE match_id IN (SELECT id FROM finance.bank_match WHERE statement_id IN (${statements}))
           OR ledger_entry_id IN (SELECT id FROM finance.ledger_entry WHERE financial_year_id = ANY($2::uuid[]))`,
      [accountCodePattern, yearIds])
    await client.query(`DELETE FROM finance.bank_statement_line WHERE statement_id IN (${statements})`, [accountCodePattern])
    await client.query(`DELETE FROM finance.bank_match WHERE statement_id IN (${statements})`, [accountCodePattern])
    await client.query(`DELETE FROM finance.bank_statement WHERE id IN (${statements})`, [accountCodePattern])
    await client.query('DELETE FROM finance.ledger_entry WHERE financial_year_id = ANY($1::uuid[])', [yearIds])
    await client.query('DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE financial_year_id = ANY($1::uuid[]))', [yearIds])
    await client.query('DELETE FROM finance.voucher WHERE financial_year_id = ANY($1::uuid[])', [yearIds])
    await client.query('DELETE FROM finance.ledger_account WHERE code ~ $1', [accountCodePattern])
    // The Task 10 parties: referenced `${TAG}-…` and named 'Accounting test …'.
    await client.query(
      "DELETE FROM finance.party WHERE reference ~ $1 AND name LIKE 'Accounting test %'", [accountCodePattern])
    await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = ANY($1::uuid[])', [yearIds])
    await client.query('DELETE FROM finance.financial_year WHERE id = ANY($1::uuid[])', [yearIds])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

beforeAll(async () => {
  app = await buildFinanceAppForTest()
  sys = systemOf(app.pg)
  for (const [who, email] of Object.entries(PEOPLE)) {
    as[who] = await loginAs(app, email, PASSWORD)
    const { rows } = await sys.query('SELECT id, authority_id FROM public.users WHERE email = $1', [email])
    ids[who] = rows[0].id
    if (who === 'director') ids.authority = rows[0].authority_id
  }

  // What a run that crashed before its teardown left behind.
  const { rows: stale } = await sys.query(
    `SELECT id FROM finance.financial_year
      WHERE label LIKE 'AC%' AND start_date >= DATE '1990-01-01' AND end_date <= DATE '1993-12-31'`)
  await removeLedgerFixture(stale.map((r) => r.id), '^AC[0-9A-F]{6}-')

  made.y1 = await makeYear('Year 1', '1991-01-01', '1991-12-31')
  made.y2 = await makeYear('Year 2', '1992-01-01', '1992-12-31')
  made.y3 = await makeYear('Year 3', '1993-01-01', '1993-12-31')

  made.bank = await account('1100', 'Accounting test bank', 'asset', 'bank')
  made.debtors = await account('1200', 'Accounting test debtors', 'asset', 'receivable')
  made.tax = await account('2100', 'Accounting test VAT', 'liability', 'tax')
  made.surplus = await account('3000', 'Accounting test accumulated surplus', 'equity', 'accumulated_surplus')
  made.income = await account('4000', 'Accounting test income', 'revenue')
  made.expense = await account('5000', 'Accounting test expense', 'expense')

  // The year-end close credits the FIRST accumulated-surplus account by code. If another one sorts
  // ahead of the fixture's, every closing figure below would land somewhere else: say so plainly.
  const { rows: first } = await sys.query(
    `SELECT id, code FROM finance.ledger_account
      WHERE account_type = 'accumulated_surplus' AND deleted_at IS NULL AND is_postable AND NOT is_group
        AND status = 'active' AND authority_id = $1
      ORDER BY code LIMIT 1`, [ids.authority])
  if (first[0].id !== made.surplus) {
    throw new Error(`Accumulated-surplus account ${first[0].code} sorts ahead of ${TAG}-3000, so the `
      + 'year-end close would credit it instead. This suite needs a database whose chart holds no other one.')
  }

  // Year 1 (USD): opening, income, expense. Year 2 (USD): one receipt of income.
  await journal(made.y1, '1991-01-05',
    [{ ledger_account_id: made.bank, debit: '1000.00' }, { ledger_account_id: made.surplus, credit: '1000.00' }],
    { voucher_no: `${TAG}-OPEN`, narration: 'Opening balances' })
  await journal(made.y1, '1991-03-10',
    [{ ledger_account_id: made.bank, debit: '900.00' }, { ledger_account_id: made.income, credit: '900.00' }],
    { voucher_no: `${TAG}-INC1`, narration: 'Income banked' })
  await journal(made.y1, '1991-06-20',
    [{ ledger_account_id: made.expense, debit: '400.00' }, { ledger_account_id: made.bank, credit: '400.00' }],
    { voucher_no: `${TAG}-EXP1`, narration: 'Expense paid' })
  await journal(made.y2, '1992-02-01',
    [{ ledger_account_id: made.bank, debit: '50.00' }, { ledger_account_id: made.income, credit: '50.00' }],
    { voucher_no: `${TAG}-INC2`, narration: 'Income banked' })
})

afterAll(async () => {
  if (!app) return
  try {
    await removeLedgerFixture(years, `^${TAG}-`)
  } finally {
    await app.close()
  }
})

// ══ Task 2: migration 242 ═════════════════════════════════════════════════════════════════════
// Leaves: year 1 closed (USD) by `${TAG}-CLOSE`; year 2 open; year 3 closed, reversed and closed
// again, with one posting of its own (Dr bank 70.00 / Cr income 70.00 on 1993-02-01). Two DRAFT
// journals of 10.00 stay in year 1 from the first test; a draft posts nothing. B11: every period of
// years 1 and 3 is left CLOSED (the year-end close is raised only then), so nothing more can post
// into either year; year 2's periods stay open until the B11 block at the end of this file.
describe('migration 242', () => {
  const draft = (type, extra = {}) => call('POST', '/finance/ledger/vouchers', as.accountant,
    { voucher_type: type, currency: 'USD', financial_year_id: made.y1, posting_date: '1991-07-01', lines: pair('10.00'), ...extra })

  test('a journal number is issued when none is typed, and a typed one is kept', async () => {
    const a = await draft('journal')
    expect(a.statusCode).toBe(201)
    expect(a.json().data.voucher.voucher_no).toMatch(/^JV-\d{7}$/)
    const b = await draft('journal', { voucher_no: `${TAG}-TYPED` })
    expect(b.statusCode).toBe(201)
    expect(b.json().data.voucher.voucher_no).toBe(`${TAG}-TYPED`)

    // The next one issued follows the first: one series, no gap left by the typed number.
    const next = await draft('journal')
    const serial = (res) => BigInt(res.json().data.voucher.voucher_no.slice(3))
    expect(serial(next) - serial(a)).toBe(1n)
    expect((await call('DELETE', `/finance/ledger/vouchers/${next.json().data.voucher.id}`, as.accountant)).statusCode).toBe(200)
  })

  test.each([
    ['credit_note', /^CN-\d{7}$/], ['write_off', /^WO-\d{7}$/], ['opening', /^OB-\d{7}$/],
  ])('%s: with no number typed, it is numbered from its own series', async (type, pattern) => {
    const res = await draft(type)
    expect(res.statusCode).toBe(201)
    expect(res.json().data.voucher.voucher_no).toMatch(pattern)
    // Discarded again, so year 1 keeps only the two drafts of the test above.
    expect((await call('DELETE', `/finance/ledger/vouchers/${res.json().data.voucher.id}`, as.accountant)).statusCode).toBe(200)
  })

  // B-SOD changed this test: a receipt, rates bill or closing voucher can no longer be typed at all
  // (accounting audit M5, security audit H4), so the refusal is system_type, not number_required.
  test('a receipt, a rates bill and a closing voucher cannot be typed', async () => {
    const res = await draft('receipt')
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      success: false, error: 'system_type',
      message: 'A receipt is raised by the cash office, or by Rates, when the money is received; it cannot be typed.',
    })
    const bill = await draft('rates_bill')
    expect(bill.statusCode).toBe(400)
    expect(bill.json()).toMatchObject({
      error: 'system_type', message: 'A rates bill is raised by a billing run under Rates; it cannot be typed.',
    })
    expect((await draft('closing')).json().error).toBe('system_type')
    // Nothing was written for any of the three.
    const { rows } = await sys.query(
      `SELECT count(*)::int AS n FROM finance.voucher
        WHERE financial_year_id = $1 AND voucher_type IN ('receipt', 'rates_bill', 'closing')`, [made.y1])
    expect(rows[0].n).toBe(0)
  })

  test('a typed number in the form of an issued one is refused wherever a number can be typed (fix round 1)', async () => {
    // Typed ahead of its series, JV-… would jam the series once its counter reached that number:
    // the insert would hit uq_voucher_no, roll the counter back, and draw the same number again.
    const reserved = (no, blank) => ({
      success: false, error: 'number_reserved',
      message: `${no} is in the form of a number the ledger issues from its own series, and typing it `
        + 'would block that series when it reaches the same number. '
        + (blank ? 'Leave the number blank to have one issued, or type the number of the document.'
          : 'Type the number of the document instead.'),
    })
    // B-SOD: a discard now cancels and keeps the voucher, so the count is of vouchers not cancelled.
    const { rows: [{ n: before }] } = await sys.query(
      `SELECT count(*)::int AS n FROM finance.voucher
        WHERE financial_year_id = ANY($1::uuid[]) AND status <> 'cancelled'`, [[made.y1, made.y2]])

    // Create: a journal, in any case and with stray spaces, and the other series' shapes.
    const jv = await draft('journal', { voucher_no: ' jv-9999999 ' })
    expect(jv.statusCode).toBe(400)
    expect(jv.json()).toMatchObject(reserved('JV-9999999', true))
    for (const [type, no] of [['credit_note', 'CN-9999999'], ['write_off', 'WO-9999999'], ['opening', 'OB-9999999'],
      ['journal', 'YC-9999999'], ['journal', 'PV-9999999']]) {
      const res = await draft(type, { voucher_no: no })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject(reserved(no, true))
    }
    // B-SOD: a receipt cannot be typed at all, so that refusal comes before the number's.
    const rc = await draft('receipt', { voucher_no: 'RC-9999999' })
    expect(rc.statusCode).toBe(400)
    expect(rc.json().error).toBe('system_type')
    // Near misses are ordinary numbers and are kept as typed.
    const near = await draft('journal', { voucher_no: `${TAG}-JV-0000001` })
    expect(near.statusCode).toBe(201)
    expect(near.json().data.voucher.voucher_no).toBe(`${TAG}-JV-0000001`)

    // Update: the number cannot be changed through PATCH at all, so a reserved one cannot arrive
    // there. The schema does not list voucher_no, and Fastify's Ajv (removeAdditional) strips it
    // before the handler runs, so the save answers 200 and changes nothing. The number is what matters.
    const patched = await call('PATCH', `/finance/ledger/vouchers/${near.json().data.voucher.id}`, as.accountant,
      { voucher_no: 'JV-9999999' })
    expect(patched.statusCode).toBe(200)
    const unchanged = await call('GET', `/finance/ledger/vouchers/${near.json().data.voucher.id}`, as.accountant)
    expect(unchanged.json().data.voucher.voucher_no).toBe(`${TAG}-JV-0000001`)
    // Sent beside a field PATCH does accept, the number is dropped by the schema and the rest saved.
    const beside = await call('PATCH', `/finance/ledger/vouchers/${near.json().data.voucher.id}`, as.accountant,
      { voucher_no: 'JV-9999999', narration: 'Renumber attempt' })
    expect(beside.statusCode).toBe(200)
    const reread = await call('GET', `/finance/ledger/vouchers/${near.json().data.voucher.id}`, as.accountant)
    expect(reread.json().data.voucher).toMatchObject({ voucher_no: `${TAG}-JV-0000001`, narration: 'Renumber attempt' })
    expect((await call('DELETE', `/finance/ledger/vouchers/${near.json().data.voucher.id}`, as.accountant)).statusCode).toBe(200)
    // B-SOD: discarded means cancelled, with its number kept.
    const { rows: [kept] } = await sys.query('SELECT voucher_no, status FROM finance.voucher WHERE id = $1', [near.json().data.voucher.id])
    expect(kept).toEqual({ voucher_no: `${TAG}-JV-0000001`, status: 'cancelled' })

    // Reverse: the reversal's own number may be typed, so it is held to the same rule.
    const { rows: [opening] } = await sys.query('SELECT id FROM finance.voucher WHERE voucher_no = $1', [`${TAG}-OPEN`])
    const rev = await call('POST', `/finance/ledger/vouchers/${opening.id}/reverse`, as.director,
      { reason: 'A reversal numbered from a series it does not own.', voucher_no: 'JV-9999999' })
    expect(rev.statusCode).toBe(400)
    expect(rev.json()).toMatchObject(reserved('JV-9999999', true))

    // Close: the closing voucher's number may be typed, and YC- is the closing series. B11 changed
    // this: a blank number is now issued from that series, so the refusal offers the blank.
    const yc = await call('POST', '/finance/ledger/close-year', as.accountant,
      { financial_year_id: made.y2, currency: 'USD', voucher_no: 'YC-9999999' })
    expect(yc.statusCode).toBe(400)
    expect(yc.json()).toMatchObject(reserved('YC-9999999', true))
    expect(await closed(made.y2)).toBe(false)

    // Nothing refused was written, and the near miss was discarded again.
    const { rows: [{ n: after }] } = await sys.query(
      `SELECT count(*)::int AS n FROM finance.voucher
        WHERE financial_year_id = ANY($1::uuid[]) AND status <> 'cancelled'`, [[made.y1, made.y2]])
    expect(after).toBe(before)
  })

  test('every number series keeps its prefix, and the four new ones are kept beside them', async () => {
    // Inside a transaction that is rolled back, so no number is used up by asking.
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      const prefixOf = async (kind) => (await client.query(
        'SELECT finance.next_document_no($1, $2) AS no', [ids.authority, kind])).rows[0].no.replace(/-\d{7}$/, '')
      const seen = {}
      for (const kind of ['receipt', 'cashier_session', 'bank_deposit', 'opening', 'supplier_invoice', 'payment',
        'asset', 'depreciation', 'asset_disposal', 'journal', 'credit_note', 'write_off', 'closing']) {
        seen[kind] = await prefixOf(kind)
      }
      expect(seen).toEqual({
        receipt: 'RC', cashier_session: 'CS', bank_deposit: 'BD', opening: 'OB', supplier_invoice: 'SI',
        payment: 'PV', asset: 'FA', depreciation: 'DP', asset_disposal: 'AD',
        journal: 'JV', credit_note: 'CN', write_off: 'WO', closing: 'YC',
      })
      await expect(client.query('SELECT finance.next_document_no($1, $2)', [ids.authority, 'reversal']))
        .rejects.toMatchObject({ code: '23514', message: 'no document sequence is kept for reversal' })
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
  })

  test('year 2 carries year 1 forward, before year 1 is closed', async () => {
    expect(await closed(made.y1)).toBe(false)
    const rows = await balances(made.y2, null, 'after')
    expect(net(rows, made.bank)).toBe('1550.00') // 1000 + 900 − 400 + 50
    expect(net(rows, made.surplus)).toBe('-1000.00') // the opening balance, carried
    expect(net(rows, made.income)).toBe('-50.00') // year 2 only
    expect(net(rows, made.expense)).toBeUndefined() // year 1's expense is not year 2's
    expect(unclosed(rows)).toBe('-500.00') // year 1 surplus, visible, not silent
    expect(unclosedRow(rows)).toEqual({
      currency: 'USD', ledger_account_id: null, account_code: null,
      account_name: 'Surplus of earlier years not yet closed', root_type: 'equity',
      report_type: 'balance_sheet', account_type: 'unclosed_surplus',
      entry_count: 2, debit_total: '400.00', credit_total: '900.00', net_debit: '-500.00',
    })
    expect(await sumNet(made.y2)).toBe('0.00')

    // Year 1 has no earlier year, and with no closing voucher 'before' and 'after' are the same book.
    const y1 = await balances(made.y1, null, 'after')
    expect(unclosed(y1)).toBeUndefined()
    expect(y1).toEqual(await balances(made.y1, null, 'before'))
    expect(y1.find((r) => r.ledger_account_id === made.bank)).toEqual({
      currency: 'USD', ledger_account_id: made.bank, account_code: `${TAG}-1100`,
      account_name: 'Accounting test bank', root_type: 'asset', report_type: 'balance_sheet', account_type: 'bank',
      entry_count: 3, debit_total: '1900.00', credit_total: '400.00', net_debit: '1500.00',
    })
    expect(await sumNet(made.y1)).toBe('0.00')
  })

  test('closing year 1 moves its surplus to accumulated surplus and its performance still reads', async () => {
    // B11 changed this: the close is raised once every period is closed, as a DRAFT prepared by the
    // accountant, and the Director posts it into the closed final period. Same voucher, same figures.
    await closeAllPeriods(made.y1)
    const res = await call('POST', '/finance/ledger/close-year', as.accountant,
      { financial_year_id: made.y1, currency: 'USD', voucher_no: `${TAG}-CLOSE` })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.closing_voucher).toMatchObject({ voucher_no: `${TAG}-CLOSE`, posting_date: '1991-12-31', status: 'draft', entries: 0 })
    expect(await closed(made.y1)).toBe(false)
    const posted = await postAs(as.director, res.json().data.closing_voucher.id)
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data).toMatchObject({ posted: `${TAG}-CLOSE`, entries: 3 })
    expect(await closed(made.y1)).toBe(true)
    expect(await closed(made.y1, 'ZWG')).toBe(false)
    expect(await closed(made.y2)).toBe(false)

    const before = await balances(made.y1, null, 'before')
    expect(net(before, made.income)).toBe('-900.00'); expect(net(before, made.expense)).toBe('400.00')
    expect(net(before, made.surplus)).toBe('-1000.00')
    expect(await sumNet(made.y1, null, 'before')).toBe('0.00')
    const after = await balances(made.y1, null, 'after')
    expect(net(after, made.income)).toBeUndefined(); expect(net(after, made.expense)).toBeUndefined()
    expect(net(after, made.surplus)).toBe('-1500.00')
    expect(await sumNet(made.y1, null, 'after')).toBe('0.00')
    const y2 = await balances(made.y2, null, 'after')
    expect(unclosed(y2)).toBeUndefined(); expect(net(y2, made.surplus)).toBe('-1500.00'); expect(await sumNet(made.y2)).toBe('0.00')
    // Year 2 has no closing voucher of its own, so leaving it out changes nothing there.
    expect(await balances(made.y2, null, 'before')).toEqual(y2)
  })

  test('as at a date inside the year', async () => {
    const rows = await balances(made.y1, '1991-03-31', 'before')
    expect(net(rows, made.bank)).toBe('1900.00')
    expect(net(rows, made.income)).toBe('-900.00')
    expect(net(rows, made.surplus)).toBe('-1000.00')
    expect(net(rows, made.expense)).toBeUndefined() // paid in June
    expect(rows).toHaveLength(3)
    expect(await sumNet(made.y1, '1991-03-31', 'before')).toBe('0.00')

    // The closing voucher is dated the year end, so before that date 'after' has nothing to add.
    expect(await balances(made.y1, '1991-03-31', 'after')).toEqual(rows)
    // A date beyond the year end reads as the year end: year 2's 50.00 is not in year 1's bank.
    const late = await balances(made.y1, '1995-06-30', 'after')
    expect(late).toEqual(await balances(made.y1, null, 'after'))
    expect(net(late, made.bank)).toBe('1500.00')
  })

  test('an unknown closing option is refused, not read as one of the two', async () => {
    await expect(balances(made.y1, null, 'during')).rejects.toMatchObject({ code: '22023' })
    await expect(sys.query('SELECT * FROM finance.ledger_balances($1, NULL, NULL)', [made.y1]))
      .rejects.toMatchObject({ code: '22023' })
  })

  test('the balance function is a stable read that runs with the rights of whoever calls it', async () => {
    const { rows: fn } = await sys.query(
      `SELECT p.prosecdef, p.provolatile::text AS provolatile FROM pg_proc p
        WHERE p.oid = 'finance.ledger_balances(uuid, date, text)'::regprocedure`)
    expect(fn[0]).toEqual({ prosecdef: false, provolatile: 's' })

    // As the application's own database role, under row-level security: the same figures for this
    // council, and nothing at all for a council that is not this one.
    const read = (authorityId) => tenantPool(sys, { id: ids.auditor, authority_id: authorityId })
      .query(`SELECT ${BALANCE_COLUMNS} FROM finance.ledger_balances($1, NULL, 'after')`, [made.y2])
    expect((await read(ids.authority)).rows).toEqual(await balances(made.y2))
    expect((await read(2147483000)).rows).toEqual([])
  })

  test('a reversed closing reads as not closed, and the year can be closed again (Review Focus 1)', async () => {
    // Year 3's only posting, numbered from the journal series.
    await journal(made.y3, '1993-02-01',
      [{ ledger_account_id: made.bank, debit: '70.00' }, { ledger_account_id: made.income, credit: '70.00' }])
    // B11 changed this: every period is closed first; each close is a draft the Director posts.
    await closeAllPeriods(made.y3)
    const close = async (voucherNo) => {
      const raised = await call('POST', '/finance/ledger/close-year', as.accountant,
        { financial_year_id: made.y3, currency: 'USD', voucher_no: voucherNo })
      if (raised.statusCode === 201) {
        const posted = await postAs(as.director, raised.json().data.closing_voucher.id)
        expect(posted.statusCode).toBe(200)
      }
      return raised
    }

    const first = await close(`${TAG}-Y3-CLOSE`)
    expect(first.statusCode).toBe(201)
    expect(await closed(made.y3)).toBe(true)
    expect(net(await balances(made.y3, null, 'after'), made.income)).toBeUndefined()
    // While it stands, a second closing is still refused. B11: it is refused because nothing is left
    // to close (a remainder could be closed; accounting audit M6), not because one stands.
    const twice = await close(`${TAG}-Y3-TWICE`)
    expect(twice.statusCode).toBe(409)
    expect(twice.json().error).toBe('nothing_to_close')

    const reversal = await call('POST', `/finance/ledger/vouchers/${first.json().data.closing_voucher.id}/reverse`, as.director,
      { reason: 'Year 3 was closed before its last journals were in.' })
    expect(reversal.statusCode).toBe(201)
    // B-SOD changed this: the reversal is a DRAFT prepared by the Director, and somebody else (the
    // accountant) posts it. Until then the year still reads closed.
    expect(reversal.json().data.reversal).toMatchObject({ voucher_type: 'reversal', status: 'draft', reverses_voucher_id: first.json().data.closing_voucher.id })
    expect(await closed(made.y3)).toBe(true)
    expect((await postAs(as.director, reversal.json().data.reversal.id)).json().error).toBe('separation_of_duties')
    // B11: the reversal of a closing posts into the closed final period, as the closing did.
    const postedReversal = await postAs(as.accountant, reversal.json().data.reversal.id)
    expect(postedReversal.statusCode).toBe(200)

    expect(await closed(made.y3)).toBe(false)
    const before = await balances(made.y3, null, 'before')
    expect(net(before, made.income)).toBe('-70.00')
    expect(await sumNet(made.y3, null, 'before')).toBe('0.00')
    expect(before.find((r) => r.ledger_account_id === made.income))
      .toMatchObject({ entry_count: 1, debit_total: '0.00', credit_total: '70.00' })
    // 'after' reads the closing and its reversal as well. They cancel, so every balance is the same,
    // and both halves stay in the totals: nothing is hidden.
    const after = await balances(made.y3, null, 'after')
    expect(net(after, made.income)).toBe('-70.00')
    expect(await sumNet(made.y3, null, 'after')).toBe('0.00')
    const nets = (rows) => rows.map((r) => [r.currency, r.account_code, r.net_debit])
    expect(nets(after)).toEqual(nets(before))
    expect(after.find((r) => r.ledger_account_id === made.income))
      .toMatchObject({ entry_count: 3, debit_total: '70.00', credit_total: '140.00' })
    // Year 3 stands on the two years before it: 1550.00 + 70.00 in the bank, year 1's surplus in
    // accumulated surplus, and year 2, still open, shown as not yet closed.
    expect(net(after, made.bank)).toBe('1620.00')
    expect(net(after, made.surplus)).toBe('-1500.00')
    expect(unclosed(after)).toBe('-50.00')

    const again = await close(`${TAG}-Y3-RECLOSE`)
    expect(again.statusCode).toBe(201)
    expect(await closed(made.y3)).toBe(true)
    const reclosed = await balances(made.y3, null, 'after')
    expect(net(reclosed, made.income)).toBeUndefined()
    expect(net(reclosed, made.surplus)).toBe('-1570.00') // 1000 + 500 (year 1) + 70 (year 3)
    expect(await sumNet(made.y3, null, 'after')).toBe('0.00')
    // 'before' leaves out both closings and the reversal between them.
    const reclosedBefore = await balances(made.y3, null, 'before')
    expect(net(reclosedBefore, made.income)).toBe('-70.00')
    expect(net(reclosedBefore, made.surplus)).toBe('-1500.00')
    expect(await sumNet(made.y3, null, 'before')).toBe('0.00')

    // Years 1 and 2 are as the tests above left them: year 1 closed, year 2 open.
    expect(await closed(made.y1)).toBe(true)
    expect(await closed(made.y2)).toBe(false)
    expect(net(await balances(made.y2), made.bank)).toBe('1550.00')
  })

  test('the accountant now holds the chart and the year-end close, and nothing that publishes', async () => {
    const { rows: held } = await sys.query(
      `SELECT rp.permission_code FROM finance.role_permission rp
        WHERE rp.role_name = 'accountant'
          AND rp.permission_code IN ('finance.ledger.account.manage', 'finance.ledger.close_year')
        ORDER BY rp.permission_code`)
    expect(held.map((r) => r.permission_code)).toEqual(['finance.ledger.account.manage', 'finance.ledger.close_year'])
    const { rows: publishes } = await sys.query(
      `SELECT rp.permission_code FROM finance.role_permission rp
         JOIN finance.permission p ON p.code = rp.permission_code
        WHERE rp.role_name = 'accountant' AND p.is_publication`)
    expect(publishes).toEqual([])
    // No role anywhere holds both an approval and a publication permission.
    const { rows: both } = await sys.query(
      `SELECT rp.role_name FROM finance.role_permission rp
         JOIN finance.permission p ON p.code = rp.permission_code
        GROUP BY rp.role_name HAVING bool_or(p.is_approval) AND bool_or(p.is_publication)`)
    expect(both).toEqual([])

    // Through the route: the accountant opens an account and withdraws it; the auditor still cannot.
    const body = { code: `${TAG}-9990`, name: 'Accounting test account the accountant opened', root_type: 'expense' }
    expect((await call('POST', '/finance/ledger/accounts', as.auditor, body)).statusCode).toBe(403)
    const opened = await call('POST', '/finance/ledger/accounts', as.accountant, body)
    expect(opened.statusCode).toBe(201)
    expect((await call('DELETE', `/finance/ledger/accounts/${opened.json().data.id}`, as.accountant)).json().data)
      .toEqual({ withdrawn: `${TAG}-9990` })
  })
})

// ══ Task 3: the ledger reads ══════════════════════════════════════════════════════════════════
// Starts from Task 2's state: year 1 closed (USD), year 2 open with one posting (Dr bank 50.00 /
// Cr income 50.00 on 1992-02-01), year 3 closed, reversed and closed again. Nothing here posts into
// year 1. Leaves for the blocks after it:
//   - a heading `${TAG}-1000` (asset) with bank and debtors moved beneath it;
//   - year 2: `${TAG}-RF2` Dr expense 2000.00 / Cr bank 2000.00 on 1992-03-01, and `${TAG}-P1..P3`
//     Dr bank 1.00, 2.00, 3.00 / Cr income on 1992-04-01. Year 2 then reads: bank −444.00 (in
//     credit), income −56.00, expense 2000.00, accumulated surplus −1500.00. No draft is left in it.
describe('Task 3: the ledger reads', () => {
  const qs = (query) => (query ? `?${new URLSearchParams(query)}` : '')
  /** A GET that must answer 200; returns the envelope's data. */
  const get = async (path, query, token = as.accountant) => {
    const res = await call('GET', `${path}${qs(query)}`, token)
    if (res.statusCode !== 200) throw new Error(`GET ${path} answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  const chart = async (yearId, extra = {}) => (await get('/finance/ledger/chart-balances', { financial_year_id: yearId, ...extra })).accounts
  const row = (accounts, code) => accounts.find((a) => a.code === code)
  const bal = (accounts, code, cur) => row(accounts, code).balances.find((b) => b.currency === cur)
  const bankLedger = (extra = {}) => get(`/finance/ledger/accounts/${made.bank}/ledger`,
    { financial_year_id: made.y2, currency: 'USD', ...extra })
  const ids3 = {}

  test('the chart carries each account\'s balance and headings carry their sum', async () => {
    const heading = await call('POST', '/finance/ledger/accounts', as.director,
      { code: `${TAG}-1000`, name: 'Accounting test current assets', root_type: 'asset', is_group: true, is_postable: false })
    expect(heading.statusCode).toBe(201)
    ids3.heading = heading.json().data.id
    for (const id of [made.bank, made.debtors]) {
      expect((await call('PATCH', `/finance/ledger/accounts/${id}`, as.director, { parent_id: ids3.heading })).statusCode).toBe(200)
    }

    const data = await get('/finance/ledger/chart-balances', { financial_year_id: made.y2 })
    expect(data.as_at).toBe('1992-12-31')
    expect(data.closing).toBe('after')
    expect(data.currencies).toEqual(['USD'])
    const { accounts } = data
    // Code order, headings included, every account present whether or not it has a balance.
    const mine = accounts.filter((a) => a.code.startsWith(`${TAG}-`)).map((a) => a.code)
    expect(mine).toEqual(['1000', '1100', '1200', '2100', '3000', '4000', '5000'].map((c) => `${TAG}-${c}`))

    // Bank: 1000 + 900 − 400 brought from year 1, + 50 in year 2.
    expect(bal(accounts, `${TAG}-1100`, 'USD')).toEqual({ currency: 'USD', net_debit: '1550.00', amount: '1550.00', side: 'Dr' })
    // The heading is bank (1550.00) plus debtors (nothing posted).
    expect(row(accounts, `${TAG}-1000`)).toMatchObject({ is_group: true, is_postable: false, parent_id: null })
    expect(bal(accounts, `${TAG}-1000`, 'USD')).toEqual({ currency: 'USD', net_debit: '1550.00', amount: '1550.00', side: 'Dr' })
    expect(row(accounts, `${TAG}-1100`).parent_id).toBe(ids3.heading)
    // A nil balance is left out, not sent as 0.00.
    expect(row(accounts, `${TAG}-1200`).balances).toEqual([])
    expect(row(accounts, `${TAG}-5000`).balances).toEqual([]) // year 1's expense is not year 2's
    expect(bal(accounts, `${TAG}-4000`, 'USD')).toEqual({ currency: 'USD', net_debit: '-50.00', amount: '50.00', side: 'Cr' })
    expect(bal(accounts, `${TAG}-3000`, 'USD')).toEqual({ currency: 'USD', net_debit: '-1500.00', amount: '1500.00', side: 'Cr' })

    // Year 1 before its closing: income and expense read as they stood.
    const y1 = await chart(made.y1, { closing: 'before' })
    expect(bal(y1, `${TAG}-4000`, 'USD')).toEqual({ currency: 'USD', net_debit: '-900.00', amount: '900.00', side: 'Cr' })
    expect(bal(y1, `${TAG}-5000`, 'USD')).toEqual({ currency: 'USD', net_debit: '400.00', amount: '400.00', side: 'Dr' })
    expect(bal(y1, `${TAG}-3000`, 'USD').net_debit).toBe('-1000.00')
    // After it, they are nil and the surplus has moved.
    const y1after = await chart(made.y1)
    expect(row(y1after, `${TAG}-4000`).balances).toEqual([])
    expect(bal(y1after, `${TAG}-3000`, 'USD').net_debit).toBe('-1500.00')
  })

  test('an account in credit against its nature is shown in credit (Review Focus 2)', async () => {
    ids3.rf2 = await journal(made.y2, '1992-03-01',
      [{ ledger_account_id: made.expense, debit: '2000.00' }, { ledger_account_id: made.bank, credit: '2000.00' }],
      { voucher_no: `${TAG}-RF2`, narration: 'Paid against the bank' })
    const accounts = await chart(made.y2)
    // 1550.00 − 2000.00: an asset in credit stays in credit, on the chart and on its heading.
    expect(bal(accounts, `${TAG}-1100`, 'USD')).toEqual({ currency: 'USD', net_debit: '-450.00', amount: '450.00', side: 'Cr' })
    expect(bal(accounts, `${TAG}-1000`, 'USD')).toEqual({ currency: 'USD', net_debit: '-450.00', amount: '450.00', side: 'Cr' })
    expect(bal(accounts, `${TAG}-5000`, 'USD')).toEqual({ currency: 'USD', net_debit: '2000.00', amount: '2000.00', side: 'Dr' })
    // And in the trial balance it sits in the credit column.
    const tb = await get('/finance/ledger/trial-balance', { financial_year_id: made.y2 })
    expect(tb.accounts.find((r) => r.ledger_account_id === made.bank))
      .toMatchObject({ debit_balance: '0.00', credit_balance: '450.00' })
  })

  test('the account page runs a balance from what was brought forward', async () => {
    const p = await bankLedger()
    expect(p.account).toMatchObject({ id: made.bank, code: `${TAG}-1100`, root_type: 'asset', account_type: 'bank', is_group: false })
    expect(p.natural_side).toBe('debit')
    expect(p).toMatchObject({ currency: 'USD', from: '1992-01-01', to: '1992-12-31', total: 2, limit: 100, offset: 0 })
    // Everything before 1992-01-01 in any year: 1000 + 900 − 400.
    expect(p.brought_forward).toEqual({ net_debit: '1500.00', amount: '1500.00', side: 'Dr' })
    expect(p.entries.map((e) => [e.debit, e.credit, e.balance.amount, e.balance.side]))
      .toEqual([['50.00', '0.00', '1550.00', 'Dr'], ['0.00', '2000.00', '450.00', 'Cr']])
    expect(p.entries[0]).toMatchObject({
      voucher_no: `${TAG}-INC2`, voucher_type: 'journal', posting_date: '1992-02-01', narration: 'Income banked',
      party_id: null, party_name: null, balance: { net_debit: '1550.00', amount: '1550.00', side: 'Dr' },
    })
    expect(p.entries[1]).toMatchObject({ voucher_id: ids3.rf2, balance: { net_debit: '-450.00', amount: '450.00', side: 'Cr' } })
    // A bank account: each entry says whether it is under a reconciled statement. None is.
    expect(p.entries.map((e) => e.reconciled)).toEqual([false, false])
    expect(p.totals).toEqual({ debit: '50.00', credit: '2000.00' })
    expect(p.carried_forward).toEqual({ net_debit: '-450.00', amount: '450.00', side: 'Cr' })

    // Not a bank account: reconciled is null, not false.
    const income = await get(`/finance/ledger/accounts/${made.income}/ledger`, { financial_year_id: made.y2, currency: 'USD' })
    expect(income.entries.map((e) => e.reconciled)).toEqual([null])

    // A heading has no entries of its own.
    const heading = await call('GET', `/finance/ledger/accounts/${ids3.heading}/ledger${qs({ financial_year_id: made.y2, currency: 'USD' })}`, as.accountant)
    expect(heading.statusCode).toBe(409)
    expect(heading.json()).toMatchObject({ success: false, error: 'is_group' })
    // One book at a time: the currency is required, and a range must run forwards.
    expect((await call('GET', `/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2 })}`, as.accountant)).statusCode).toBe(400)
    const backwards = await call('GET', `/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2, currency: 'USD', from: '1992-06-01', to: '1992-05-01' })}`, as.accountant)
    expect(backwards.statusCode).toBe(400)
    expect(backwards.json().error).toBe('bad_range')
  })

  test('a revenue account is brought forward within its year only', async () => {
    // Year 2's 50.00 credit falls before 1992-02-15; year 1's 900.00 is not brought into year 2.
    const p = await get(`/finance/ledger/accounts/${made.income}/ledger`,
      { financial_year_id: made.y2, currency: 'USD', from: '1992-02-15' })
    expect(p.natural_side).toBe('credit')
    expect(p.brought_forward).toEqual({ net_debit: '-50.00', amount: '50.00', side: 'Cr' })
    expect(p.entries).toEqual([])
    expect(p.totals).toEqual({ debit: '0.00', credit: '0.00' })
    expect(p.carried_forward).toEqual({ net_debit: '-50.00', amount: '50.00', side: 'Cr' })
    // From the year start nothing is brought forward: nil reads Dr, and the page handles it.
    const whole = await get(`/finance/ledger/accounts/${made.income}/ledger`, { financial_year_id: made.y2, currency: 'USD' })
    expect(whole.brought_forward).toEqual({ net_debit: '0.00', amount: '0.00', side: 'Dr' })
    expect(whole.entries.map((e) => [e.credit, e.balance.amount, e.balance.side])).toEqual([['50.00', '50.00', 'Cr']])
  })

  test('the running balance continues across a page break on one date (Review Focus 5)', async () => {
    for (const [n, amount] of [[1, '1.00'], [2, '2.00'], [3, '3.00']]) {
      await journal(made.y2, '1992-04-01',
        [{ ledger_account_id: made.bank, debit: amount }, { ledger_account_id: made.income, credit: amount }],
        { voucher_no: `${TAG}-P${n}`, narration: `Page break ${n}` })
    }
    const one = await bankLedger({ limit: 3, offset: 0 })
    const two = await bankLedger({ limit: 3, offset: 3 })
    expect(one.total).toBe(5); expect(two.total).toBe(5)
    expect(one.entries.map((e) => [e.voucher_no, e.balance.net_debit])).toEqual([
      [`${TAG}-INC2`, '1550.00'], [`${TAG}-RF2`, '-450.00'], [`${TAG}-P1`, '-449.00']])
    // Page 2 starts where page 1 ended: −449.00 + 2.00, then + 3.00. Same date, ordered by posting.
    expect(two.entries.map((e) => [e.voucher_no, e.debit, e.balance.net_debit, e.balance.amount, e.balance.side])).toEqual([
      [`${TAG}-P2`, '2.00', '-447.00', '447.00', 'Cr'], [`${TAG}-P3`, '3.00', '-444.00', '444.00', 'Cr']])
    // Brought forward, totals and carried forward describe the range, not the page.
    for (const page of [one, two]) {
      expect(page.brought_forward).toEqual({ net_debit: '1500.00', amount: '1500.00', side: 'Dr' })
      expect(page.totals).toEqual({ debit: '56.00', credit: '2000.00' })
      expect(page.carried_forward).toEqual({ net_debit: '-444.00', amount: '444.00', side: 'Cr' })
    }
  })

  test('csv carries the same figures, for the whole range whatever the page', async () => {
    const res = await call('GET', `/finance/ledger/accounts/${made.bank}/ledger${qs({
      financial_year_id: made.y2, currency: 'USD', format: 'csv', limit: 1, offset: 3 })}`, as.accountant)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.csv"$/)
    expect(res.body.split('\r\n')).toEqual([
      'Date,Voucher,Type,Narration,Party,Debit,Credit,Balance,Side',
      ',,,Brought forward,,,,1500.00,Dr',
      `1992-02-01,${TAG}-INC2,journal,Income banked,,50.00,0.00,1550.00,Dr`,
      `1992-03-01,${TAG}-RF2,journal,Paid against the bank,,0.00,2000.00,450.00,Cr`,
      `1992-04-01,${TAG}-P1,journal,Page break 1,,1.00,0.00,449.00,Cr`,
      `1992-04-01,${TAG}-P2,journal,Page break 2,,2.00,0.00,447.00,Cr`,
      `1992-04-01,${TAG}-P3,journal,Page break 3,,3.00,0.00,444.00,Cr`,
      ',,,Period totals,,56.00,2000.00,,',
      ',,,Carried forward,,,,444.00,Cr',
      '',
    ])
  })

  test('the trial balance at a date balances and names the closing state', async () => {
    const tb = await get('/finance/ledger/trial-balance', { financial_year_id: made.y1, as_at: '1991-03-31', closing: 'before' })
    expect(tb).toMatchObject({ as_at: '1991-03-31', closing: 'before', unbalanced: [], currencies: ['USD'] })
    expect(tb.books.find((b) => b.currency === 'USD'))
      .toMatchObject({ debit_total: '1900.00', credit_total: '1900.00', difference: '0.00', balances: true, account_count: 3 })
    expect(tb.closed).toContainEqual({ currency: 'USD', closed: true })
    expect(tb.closed).toContainEqual({ currency: 'ZWG', closed: false })
    expect(tb.accounts.map((r) => [r.account_code, r.debit_balance, r.credit_balance])).toEqual([
      [`${TAG}-1100`, '1900.00', '0.00'], [`${TAG}-3000`, '0.00', '1000.00'], [`${TAG}-4000`, '0.00', '900.00']])
    expect(tb.accounts[0]).toMatchObject({ entry_count: 2, debit_total: '1900.00', credit_total: '0.00',
      first_posting_date: '1991-01-05', last_posting_date: '1991-03-10' })

    // Year 2 with no date: the year end, after closing, with year 1 brought forward.
    // Debits: expense 2000.00. Credits: bank 444.00 + income 56.00 + surplus 1500.00 = 2000.00.
    const y2 = await get('/finance/ledger/trial-balance', { financial_year_id: made.y2 })
    expect(y2).toMatchObject({ as_at: '1992-12-31', closing: 'after', unbalanced: [] })
    expect(y2.closed).toContainEqual({ currency: 'USD', closed: false })
    expect(y2.books).toEqual([{ currency: 'USD', account_count: 4, debit_total: '2000.00', credit_total: '2000.00', difference: '0.00', balances: true }])
    expect(y2.accounts.find((r) => r.ledger_account_id === made.bank)).toMatchObject({ debit_balance: '0.00', credit_balance: '444.00' })
    // Year 1 is closed, so no unclosed-surplus row.
    expect(y2.accounts.some((r) => r.ledger_account_id === null)).toBe(false)
  })

  test('the trial balance exports as csv with a totals line per book', async () => {
    const res = await call('GET', `/finance/ledger/trial-balance${qs({ financial_year_id: made.y2, format: 'csv' })}`, as.accountant)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toBe('attachment; filename="trial-balance-1992-12-31.csv"')
    const lines = res.body.split('\r\n')
    expect(lines[0]).toBe('Book,Code,Account,Debit,Credit')
    expect(lines).toContain(`USD,${TAG}-1100,Accounting test bank,0.00,444.00`)
    expect(lines).toContain(`USD,${TAG}-5000,Accounting test expense,2000.00,0.00`)
    expect(lines).toContain('USD,,Totals,2000.00,2000.00')
    expect(lines.filter((l) => l.includes(',Totals,'))).toHaveLength(1)
  })

  test('the voucher queues count what waits for each person', async () => {
    const drafted = await call('POST', '/finance/ledger/vouchers', as.accountant,
      { voucher_type: 'journal', currency: 'USD', financial_year_id: made.y2, posting_date: '1992-05-01', lines: pair('5.00') })
    expect(drafted.statusCode).toBe(201)
    const draftId = drafted.json().data.voucher.id
    try {
      // Year 2 holds five posted vouchers (INC2, RF2, P1–P3) and this one draft.
      const mine = await get('/finance/ledger/vouchers', { financial_year_id: made.y2 }, as.accountant)
      // B-SOD added the `cancelled` count; `all` leaves cancelled vouchers out.
      expect(mine.queues).toEqual({ to_post: 0, mine: 1, posted: 5, all: 6, cancelled: 0 })
      const theirs = await get('/finance/ledger/vouchers', { financial_year_id: made.y2 }, as.director)
      expect(theirs.queues).toEqual({ to_post: 1, mine: 0, posted: 5, all: 6, cancelled: 0 })

      const toPost = await get('/finance/ledger/vouchers', { financial_year_id: made.y2, queue: 'to_post' }, as.director)
      expect(toPost.vouchers.map((v) => v.id)).toEqual([draftId]); expect(toPost.total).toBe(1)
      expect((await get('/finance/ledger/vouchers', { financial_year_id: made.y2, queue: 'to_post' }, as.accountant)).total).toBe(0)
      const myDrafts = await get('/finance/ledger/vouchers', { financial_year_id: made.y2, queue: 'mine' }, as.accountant)
      expect(myDrafts.vouchers.map((v) => v.id)).toEqual([draftId])
      // The counts follow the year filter only: another filter narrows the list, not the tabs.
      const narrowed = await get('/finance/ledger/vouchers', { financial_year_id: made.y2, status: 'posted' }, as.director)
      expect(narrowed.total).toBe(5); expect(narrowed.queues).toEqual({ to_post: 1, mine: 0, posted: 5, all: 6, cancelled: 0 })

      // A hand-keyed journal was raised from no document.
      expect((await get(`/finance/ledger/vouchers/${ids3.rf2}`)).source).toBeNull()
      expect((await get(`/finance/ledger/vouchers/${draftId}`)).source).toBeNull()
    } finally {
      // Discarded, so year 2 holds no draft for the blocks after this one.
      expect((await call('DELETE', `/finance/ledger/vouchers/${draftId}`, as.accountant)).statusCode).toBe(200)
    }
  })

  test('a role without the ledger gets 403 on every new read', async () => {
    for (const url of [
      `/finance/ledger/chart-balances${qs({ financial_year_id: made.y2 })}`,
      `/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2, currency: 'USD' })}`,
      `/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2, currency: 'USD', format: 'csv' })}`,
      `/finance/ledger/trial-balance${qs({ financial_year_id: made.y2, as_at: '1992-06-30' })}`,
      `/finance/ledger/vouchers${qs({ financial_year_id: made.y2, queue: 'to_post' })}`,
    ]) {
      const res = await call('GET', url, as.cashier)
      expect(res.statusCode).toBe(403)
      expect(res.json().required_permission).toBe('finance.ledger.view')
    }
    // The auditor holds it and reads.
    expect((await call('GET', `/finance/ledger/chart-balances${qs({ financial_year_id: made.y2 })}`, as.auditor)).statusCode).toBe(200)
  })

  test('another council cannot read this council\'s ledger through any of these reads', async () => {
    const code = `${TAG}X`
    const { rows: [other] } = await sys.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`, [`Accounting test neighbour council ${TAG} (fictional)`, code])
    const email = `${TAG.toLowerCase()}.neighbour@vungu.test`
    try {
      // The demo auditor's role and password, in the other council.
      await sys.query(
        `INSERT INTO public.users (email, name, role, password_hash, active, status, authority_id)
         SELECT $1, $2, role, password_hash, true, 'active', $3 FROM public.users WHERE email = $4`,
        [email, `${TAG} neighbour auditor`, other.id, PEOPLE.auditor])
      const token = await loginAs(app, email, PASSWORD)
      const read = (url) => call('GET', url, token)

      expect((await read(`/finance/ledger/chart-balances${qs({ financial_year_id: made.y2 })}`)).statusCode).toBe(404)
      expect((await read(`/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2, currency: 'USD' })}`)).statusCode).toBe(404)
      expect((await read(`/finance/ledger/accounts/${made.bank}/ledger${qs({ financial_year_id: made.y2, currency: 'USD', format: 'csv' })}`)).statusCode).toBe(404)
      expect((await read(`/finance/ledger/trial-balance${qs({ financial_year_id: made.y2 })}`)).statusCode).toBe(404)
      expect((await read(`/finance/ledger/vouchers/${ids3.rf2}`)).statusCode).toBe(404)
      const list = await read(`/finance/ledger/vouchers${qs({ financial_year_id: made.y2 })}`)
      expect(list.statusCode).toBe(200)
      expect(list.json().data).toMatchObject({ vouchers: [], total: 0, queues: { to_post: 0, mine: 0, posted: 0, all: 0 } })
    } finally {
      await sys.query('DELETE FROM public.users WHERE email = $1', [email]).catch(() => {})
      await sys.query('DELETE FROM public.local_authorities WHERE id = $1', [other.id]).catch(() => {})
    }
  })
})

// ══ Task 9: the cash and bank accounts (Cashbook) ═════════════════════════════════════════════
// Starts from Task 3's state. The bank `${TAG}-1100` then holds eight USD entries dated on or
// before 1992-12-31: OPEN 1000.00 Dr, INC1 900.00 Dr, EXP1 400.00 Cr (year 1); INC2 50.00 Dr,
// RF2 2000.00 Cr, P1..P3 1.00, 2.00, 3.00 Dr (year 2). Debits 1956.00, credits 2400.00, balance
// −444.00. Year 3 adds Dr bank 70.00 on 1993-02-01. Nothing is posted into year 1.
// Leaves for the blocks after it:
//   - a cash account `${TAG}-1150` with one entry, `${TAG}-CSH1` Dr cash 25.00 / Cr income 25.00 on
//     1992-05-01 (year 2). Year 2 then reads: bank −444.00, cash 25.00, income −81.00, expense
//     2000.00, accumulated surplus −1500.00. No draft is left in year 2.
//   - NO bank statement: the reconciled statement this block imports is removed by its afterAll.
describe('Task 9: the cash and bank accounts', () => {
  const qs = (query) => (query ? `?${new URLSearchParams(query)}` : '')
  const get = async (path, query, token = as.accountant) => {
    const res = await call('GET', `${path}${qs(query)}`, token)
    if (res.statusCode !== 200) throw new Error(`GET ${path} answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  /** The fixture's own rows of cash-accounts, in the order the server sent them. */
  const cashAccounts = async (yearId) => (await get('/finance/ledger/cash-accounts', { financial_year_id: yearId }))
    .accounts.filter((a) => a.code.startsWith(`${TAG}-`))
  const rowOf = (accounts, id) => accounts.find((a) => a.id === id)
  /** A statement upload, as the bank screen sends it (multipart, the file as CSV). */
  const upload = (token, fields, csv) => {
    const boundary = `----vungu${crypto.randomBytes(8).toString('hex')}`
    const body = [
      ...Object.entries(fields).map(([n, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="statement.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')
    return app.inject({ method: 'POST', url: '/api/finance/bank/statements',
      headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
  }
  const ids9 = {}

  afterAll(async () => {
    // A reconciled statement is frozen by triggers, so it is removed with them set aside.
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      const st = 'SELECT id FROM finance.bank_statement WHERE bank_account_id = $1'
      await client.query(`DELETE FROM finance.bank_match_entry WHERE match_id IN (SELECT id FROM finance.bank_match WHERE statement_id IN (${st}))`, [made.bank])
      await client.query(`DELETE FROM finance.bank_statement_line WHERE statement_id IN (${st})`, [made.bank])
      await client.query(`DELETE FROM finance.bank_match WHERE statement_id IN (${st})`, [made.bank])
      await client.query('DELETE FROM finance.bank_statement WHERE bank_account_id = $1', [made.bank])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  })

  test('a bank never reconciled: reconciled_to is null and every entry is unreconciled', async () => {
    const accounts = await cashAccounts(made.y2)
    // Only the bank: no other fixture account is a bank or cash account yet.
    expect(accounts.map((a) => a.code)).toEqual([`${TAG}-1100`])
    expect(accounts[0]).toEqual({
      id: made.bank, code: `${TAG}-1100`, name: 'Accounting test bank', account_type: 'bank', currency: 'USD',
      // 1956.00 − 2400.00, as at 1992-12-31, every year brought in.
      balance: { net_debit: '-444.00', amount: '444.00', side: 'Cr' },
      last_entry: '1992-04-01',
      reconciled_to: null,
      reconciled_balance: null,
      // All eight entries dated on or before the year end, of both years.
      unreconciled: { entries: 8, debit: '1956.00', credit: '2400.00' },
    })

    // The account page says the same entry by entry: none is reconciled.
    const page = await get(`/finance/ledger/accounts/${made.bank}/ledger`, { financial_year_id: made.y2, currency: 'USD' })
    expect(page.total).toBe(5)
    expect(page.entries.map((e) => e.reconciled)).toEqual([false, false, false, false, false])

    // As at the end of year 1: three entries, 1000 + 900 − 400.
    const y1 = await cashAccounts(made.y1)
    expect(y1).toHaveLength(1)
    expect(y1[0]).toMatchObject({
      id: made.bank, balance: { net_debit: '1500.00', amount: '1500.00', side: 'Dr' }, last_entry: '1991-06-20',
      reconciled_to: null, unreconciled: { entries: 3, debit: '1900.00', credit: '400.00' },
    })
  })

  test('a cash account has a balance and no reconciliation; an account with no entries is not listed', async () => {
    made.cash = await account('1150', 'Accounting test cash float', 'asset', 'cash')
    await journal(made.y2, '1992-05-01',
      [{ ledger_account_id: made.cash, debit: '25.00' }, { ledger_account_id: made.income, credit: '25.00' }],
      { voucher_no: `${TAG}-CSH1`, narration: 'Cash takings' })

    const accounts = await cashAccounts(made.y2)
    // Code order: 1100 before 1150.
    expect(accounts.map((a) => a.code)).toEqual([`${TAG}-1100`, `${TAG}-1150`])
    expect(rowOf(accounts, made.cash)).toEqual({
      id: made.cash, code: `${TAG}-1150`, name: 'Accounting test cash float', account_type: 'cash', currency: 'USD',
      balance: { net_debit: '25.00', amount: '25.00', side: 'Dr' },
      last_entry: '1992-05-01',
      reconciled_to: null,
      reconciled_balance: null,
      unreconciled: null,
    })
    // The bank is unchanged by it.
    expect(rowOf(accounts, made.bank).balance).toEqual({ net_debit: '-444.00', amount: '444.00', side: 'Cr' })
    // A cash account's ledger entries carry reconciled: null, not false.
    const page = await get(`/finance/ledger/accounts/${made.cash}/ledger`, { financial_year_id: made.y2, currency: 'USD' })
    expect(page.entries.map((e) => e.reconciled)).toEqual([null])

    // At the end of year 1 the cash account has no entry yet, so only the bank is listed.
    expect((await cashAccounts(made.y1)).map((a) => a.id)).toEqual([made.bank])

    // Task 3 carry: the trial balance's unclosed-surplus row belongs to no account, so it has no
    // account type. Year 3 reads year 2, still open, as not yet closed: income −50 − 1 − 2 − 3 − 25
    // = −81.00, plus expense 2000.00 = 1919.00 debit.
    const tb = await get('/finance/ledger/trial-balance', { financial_year_id: made.y3 })
    const unclosedTb = tb.accounts.filter((r) => r.ledger_account_id === null)
    expect(unclosedTb).toHaveLength(1)
    expect(unclosedTb[0]).toMatchObject({ currency: 'USD', account_type: null, debit_balance: '1919.00', credit_balance: '0.00' })
    expect(tb.books.find((b) => b.currency === 'USD')).toMatchObject({ balances: true, difference: '0.00' })
  })

  test('a reconciled statement moves reconciled_to and takes its matched entries out of the unreconciled count', async () => {
    // A statement for 5 January to 10 March 1991 showing the two deposits OPEN and INC1. The book
    // at 10 March is 1000 + 900 = 1900.00 with nothing outstanding, so it reconciles.
    const csv = [
      'Date,Details,Reference,Debit,Credit',
      `05/01/1991,Opening deposit,${TAG}-OPEN,,"1,000.00"`,
      `10/03/1991,Deposit,${TAG}-INC1,,900.00`,
    ].join('\r\n')
    const imported = await upload(as.accountant,
      { bank_account_id: made.bank, currency: 'USD', opening_balance: '0.00', closing_balance: '1900.00', statement_ref: `${TAG} statement 1` }, csv)
    expect(imported.statusCode).toBe(201)
    ids9.statement = imported.json().data.id

    // Imported but open: nothing is reconciled yet.
    expect(rowOf(await cashAccounts(made.y2), made.bank)).toMatchObject({
      reconciled_to: null, reconciled_balance: null, unreconciled: { entries: 8, debit: '1956.00', credit: '2400.00' },
    })
    const matched = await call('POST', `/finance/bank/statements/${ids9.statement}/auto-match`, as.accountant)
    expect(matched.statusCode).toBe(200)
    expect(matched.json().data.matched).toBe(2)
    // Matched under an OPEN statement still counts as unreconciled.
    expect(rowOf(await cashAccounts(made.y2), made.bank).unreconciled).toEqual({ entries: 8, debit: '1956.00', credit: '2400.00' })

    expect((await call('POST', `/finance/bank/statements/${ids9.statement}/complete`, as.accountant)).statusCode).toBe(200)

    // Year 2: reconciled to 1991-03-10 at 1900.00. Left: EXP1 400 Cr, INC2 50 Dr, RF2 2000 Cr,
    // P1..P3 6 Dr = six entries, debits 56.00, credits 2400.00. The balance does not move.
    expect(rowOf(await cashAccounts(made.y2), made.bank)).toMatchObject({
      balance: { net_debit: '-444.00', amount: '444.00', side: 'Cr' },
      reconciled_to: '1991-03-10', reconciled_balance: '1900.00',
      unreconciled: { entries: 6, debit: '56.00', credit: '2400.00' },
    })
    // Year 1: only EXP1 is left.
    expect(rowOf(await cashAccounts(made.y1), made.bank)).toMatchObject({
      balance: { net_debit: '1500.00', amount: '1500.00', side: 'Dr' },
      reconciled_to: '1991-03-10', reconciled_balance: '1900.00',
      unreconciled: { entries: 1, debit: '0.00', credit: '400.00' },
    })
    // Year 3 adds its 70.00: −444.00 + 70.00 = −374.00; seven entries open, debits 126.00.
    expect(rowOf(await cashAccounts(made.y3), made.bank)).toMatchObject({
      balance: { net_debit: '-374.00', amount: '374.00', side: 'Cr' }, last_entry: '1993-02-01',
      reconciled_to: '1991-03-10', unreconciled: { entries: 7, debit: '126.00', credit: '2400.00' },
    })
    // The account page flags the two matched entries, and only those.
    const y1page = await get(`/finance/ledger/accounts/${made.bank}/ledger`, { financial_year_id: made.y1, currency: 'USD' })
    expect(y1page.entries.map((e) => [e.voucher_no, e.reconciled])).toEqual([
      [`${TAG}-OPEN`, true], [`${TAG}-INC1`, true], [`${TAG}-EXP1`, false]])
    // The cash account is untouched by a bank statement.
    expect(rowOf(await cashAccounts(made.y2), made.cash)).toMatchObject({ reconciled_to: null, unreconciled: null })
  })

  test('the read needs the ledger permission and a year', async () => {
    const url = `/finance/ledger/cash-accounts${qs({ financial_year_id: made.y2 })}`
    const refused = await call('GET', url, as.cashier)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().required_permission).toBe('finance.ledger.view')
    expect((await call('GET', url, as.auditor)).statusCode).toBe(200)
    expect((await call('GET', '/finance/ledger/cash-accounts', as.accountant)).statusCode).toBe(400)
    expect((await call('GET', `/finance/ledger/cash-accounts${qs({ financial_year_id: crypto.randomUUID() })}`, as.accountant)).statusCode).toBe(404)
  })

  test('another council sees nothing of this council\'s cash and bank accounts', async () => {
    const code = `${TAG}Y`
    const { rows: [other] } = await sys.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`, [`Accounting test cashbook neighbour ${TAG} (fictional)`, code])
    const email = `${TAG.toLowerCase()}.cashbook-neighbour@vungu.test`
    try {
      await sys.query(
        `INSERT INTO public.users (email, name, role, password_hash, active, status, authority_id)
         SELECT $1, $2, role, password_hash, true, 'active', $3 FROM public.users WHERE email = $4`,
        [email, `${TAG} cashbook neighbour auditor`, other.id, PEOPLE.auditor])
      const token = await loginAs(app, email, PASSWORD)
      const res = await call('GET', `/finance/ledger/cash-accounts${qs({ financial_year_id: made.y2 })}`, token)
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ success: false, error: 'not_found' })
      expect(res.body).not.toContain(`${TAG}-1100`)
    } finally {
      await sys.query('DELETE FROM public.users WHERE email = $1', [email]).catch(() => {})
      await sys.query('DELETE FROM public.local_authorities WHERE id = $1', [other.id]).catch(() => {})
    }
  })
})

// ══ Task 10: debtors, statements of account, credit notes and write-offs ══════════════════════
// Starts from Task 9's state. The debtors account `${TAG}-1200` (receivable) has no entry yet and
// no fixture party exists. Everything here posts into year 2 (open), dated June and July 1992, so
// every bill is more than a year old and ages `over_365`; days_outstanding is read from Postgres
// (CURRENT_DATE − date), never computed in JavaScript.
// Leaves for the blocks after it:
//   - parties `${TAG}-P` (ratepayer, 'Accounting test ratepayer P') and `${TAG}-S` (supplier,
//     'Accounting test supplier S'); a payable account `${TAG}-2200`;
//   - year 2, party P on debtors: B1 Dr 300.00 (06-01), CN1 Cr 100.00 against B1 (06-15, a credit
//     note against income), R1 Cr 40.00 unallocated (06-20, Dr bank), B2 Dr 120.00 (07-01), W1 Cr
//     120.00 against B2 (07-10, a write-off against expense). P owes 160.00: B1 200.00 open, R1
//     −40.00 unallocated, B2 settled;
//   - year 2, party S on payable: SI1 Cr 80.00 (06-05, Dr expense), PAY1 Dr 30.00 against SI1
//     (06-25, Cr bank). S is owed 50.00;
//   - year 2 then reads: bank −444.00 + 40.00 − 30.00 = −434.00, debtors 160.00, payable −50.00,
//     income −81.00 − 300.00 + 100.00 − 120.00 = −401.00, expense 2000.00 + 120.00 + 80.00 =
//     2200.00, cash 25.00, accumulated surplus −1500.00. No draft is left in year 2.
describe('Task 10: debtors and statements of account', () => {
  const qs = (query) => (query ? `?${new URLSearchParams(query)}` : '')
  /** A GET that must answer 200; returns the envelope's data. */
  const get = async (path, query, token = as.accountant) => {
    const res = await call('GET', `${path}${qs(query)}`, token)
    if (res.statusCode !== 200) throw new Error(`GET ${path} answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  const statementUrl = (partyId, query) => `/finance/accounting/party-statement/${partyId}${qs(query)}`
  const statement = (partyId, query, token) => get(`/finance/accounting/party-statement/${partyId}`, query, token)
  const ageing = (query, token) => get('/finance/ledger/debtor-ageing', { outstanding_only: 'true', limit: '500', ...query }, token)
  /** A party in the register, created by the Director. Returns its id. */
  const party = async (partyType, name, reference, extra = {}) => {
    const res = await call('POST', '/finance/ledger/parties', as.director, { party_type: partyType, name, reference, ...extra })
    if (res.statusCode !== 201) throw new Error(`party ${reference} was not created (${res.statusCode}): ${res.body}`)
    return res.json().data.id
  }
  /** A draft voucher prepared by the accountant, not posted. Returns its id. */
  const draft = async (body) => {
    const res = await call('POST', '/finance/ledger/vouchers', as.accountant,
      { currency: 'USD', financial_year_id: made.y2, ...body })
    if (res.statusCode !== 201) throw new Error(`draft ${body.voucher_no} was not created (${res.statusCode}): ${res.body}`)
    return res.json().data.voucher.id
  }
  // B-SOD: the post sends the version the Director reviewed.
  const post = (voucherId) => postAs(as.director, voucherId)
  /** Days since a date, and today, both from Postgres. */
  const daysSince = async (date) => (await sys.query('SELECT (CURRENT_DATE - $1::date)::int AS d', [date])).rows[0].d
  const today = async () => (await sys.query('SELECT CURRENT_DATE::text AS d')).rows[0].d
  const NIL = { net_debit: '0.00', amount: '0.00', side: 'Dr' }
  const ids10 = {}

  test('a credit note against a bill leaves the rest open, and the statement carries it forward', async () => {
    ids10.p = await party('ratepayer', 'Accounting test ratepayer P', `${TAG}-P`, { address_text: '12 Test Road, Vungu' })
    ids10.b1 = await journal(made.y2, '1992-06-01',
      [{ ledger_account_id: made.debtors, debit: '300.00', party_id: ids10.p }, { ledger_account_id: made.income, credit: '300.00' }],
      { voucher_no: `${TAG}-B1`, narration: 'Rates bill' })
    // The credit note: Dr income 100.00 / Cr debtors 100.00 for P, naming the bill.
    ids10.cn1 = await journal(made.y2, '1992-06-15',
      [{ ledger_account_id: made.income, debit: '100.00' },
        { ledger_account_id: made.debtors, credit: '100.00', party_id: ids10.p, against_voucher_id: ids10.b1 }],
      { voucher_type: 'credit_note', voucher_no: `${TAG}-CN1`, narration: 'Credit note on B1' })

    const s = await statement(ids10.p, { currency: 'USD' })
    expect(s.party).toEqual({
      id: ids10.p, name: 'Accounting test ratepayer P', reference: `${TAG}-P`, party_type: 'ratepayer', address_text: '12 Test Road, Vungu',
    })
    expect(s).toMatchObject({ currency: 'USD', kind: 'receivable', as_at: await today() })
    // No `from`: nothing is brought forward.
    expect(s.brought_forward).toEqual(NIL)
    // 300.00 Dr, then 300.00 − 100.00 = 200.00 Dr.
    expect(s.entries.map((e) => [e.voucher_no, e.voucher_type, e.posting_date, e.debit, e.credit, e.balance.net_debit, e.balance.side, e.account_code]))
      .toEqual([
        [`${TAG}-B1`, 'journal', '1992-06-01', '300.00', '0.00', '300.00', 'Dr', `${TAG}-1200`],
        [`${TAG}-CN1`, 'credit_note', '1992-06-15', '0.00', '100.00', '200.00', 'Dr', `${TAG}-1200`],
      ])
    expect(s.entries[0]).toMatchObject({
      voucher_id: ids10.b1, narration: 'Rates bill', party_id: ids10.p, party_name: 'Accounting test ratepayer P',
      balance: { net_debit: '300.00', amount: '300.00', side: 'Dr' }, reconciled: null,
    })
    expect(s.carried_forward).toEqual({ net_debit: '200.00', amount: '200.00', side: 'Dr' })
    // The open item is the bill, less the credit note, with the receivable account it was billed to.
    expect(s.open_items).toEqual([{
      voucher_id: ids10.b1, voucher_no: `${TAG}-B1`, voucher_type: 'journal', posting_date: '1992-06-01',
      ledger_account_id: made.debtors,
      billed_amount: '300.00', settled_amount: '100.00', outstanding_amount: '200.00',
      days_outstanding: await daysSince('1992-06-01'), ageing_bucket: 'over_365',
    }])

    // From 10 June: the bill is brought forward and only the credit note is listed.
    const later = await statement(ids10.p, { currency: 'USD', from: '1992-06-10' })
    expect(later.brought_forward).toEqual({ net_debit: '300.00', amount: '300.00', side: 'Dr' })
    expect(later.entries.map((e) => [e.voucher_no, e.balance.net_debit])).toEqual([[`${TAG}-CN1`, '200.00']])
    expect(later.carried_forward).toEqual({ net_debit: '200.00', amount: '200.00', side: 'Dr' })
    // To 10 June: only the bill, carried forward at 300.00. The open items stay as at today.
    const earlier = await statement(ids10.p, { currency: 'USD', to: '1992-06-10' })
    expect(earlier.brought_forward).toEqual(NIL)
    expect(earlier.entries.map((e) => [e.voucher_no, e.balance.net_debit])).toEqual([[`${TAG}-B1`, '300.00']])
    expect(earlier.carried_forward).toEqual({ net_debit: '300.00', amount: '300.00', side: 'Dr' })
    expect(earlier.open_items.map((i) => [i.voucher_no, i.outstanding_amount])).toEqual([[`${TAG}-B1`, '200.00']])

    // One book at a time: nothing of P's is in the ZWG book.
    const zwg = await statement(ids10.p, { currency: 'ZWG' })
    expect(zwg).toMatchObject({ currency: 'ZWG', brought_forward: NIL, entries: [], carried_forward: NIL, open_items: [] })

    // The book is required, a range runs forwards, and an unknown party is not found.
    expect((await call('GET', statementUrl(ids10.p), as.accountant)).statusCode).toBe(400)
    const backwards = await call('GET', statementUrl(ids10.p, { currency: 'USD', from: '1992-07-01', to: '1992-06-01' }), as.accountant)
    expect(backwards.statusCode).toBe(400)
    expect(backwards.json()).toMatchObject({ success: false, error: 'bad_range' })
    const unknown = await call('GET', statementUrl(crypto.randomUUID(), { currency: 'USD' }), as.accountant)
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toMatchObject({ success: false, error: 'not_found' })
  })

  test('the ageing breaks each debtor into its buckets, summing to its total, and agrees with the control account', async () => {
    // Money received from P and not matched to a bill: Dr bank 40.00 / Cr debtors 40.00.
    ids10.r1 = await journal(made.y2, '1992-06-20',
      [{ ledger_account_id: made.bank, debit: '40.00' }, { ledger_account_id: made.debtors, credit: '40.00', party_id: ids10.p }],
      { voucher_no: `${TAG}-R1`, narration: 'Received from P' })

    const ag = await ageing({ currency: 'USD' })
    // P: B1 200.00 open and R1 −40.00 unallocated, two rows, 160.00 in all, the oldest from 1 June.
    expect(ag.by_party.find((r) => r.party_id === ids10.p)).toEqual({
      currency: 'USD', party_id: ids10.p, party_name: 'Accounting test ratepayer P', party_reference: `${TAG}-P`,
      bill_count: 2, outstanding_amount: '160.00', oldest_days: await daysSince('1992-06-01'),
    })
    expect(ag.by_party_bucket.filter((r) => r.party_id === ids10.p)).toEqual([
      { currency: 'USD', party_id: ids10.p, ageing_bucket: 'over_365', outstanding_amount: '200.00' },
      { currency: 'USD', party_id: ids10.p, ageing_bucket: 'unallocated', outstanding_amount: '-40.00' },
    ])
    // Asked for one book, both lists hold only that book.
    expect(ag.by_party.every((r) => r.currency === 'USD')).toBe(true)
    expect(ag.by_party_bucket.every((r) => r.currency === 'USD')).toBe(true)

    // For EVERY party listed, its buckets sum to its total, and no bucket row belongs to a party
    // that is not listed. Summed by Postgres over NUMERIC, never in JavaScript.
    const { rows: [check] } = await sys.query(
      `SELECT
         (SELECT count(*)::int FROM json_array_elements($1::json) p
           WHERE (p->>'outstanding_amount')::numeric IS DISTINCT FROM (
                   SELECT sum((b->>'outstanding_amount')::numeric) FROM json_array_elements($2::json) b
                    WHERE b->>'currency' = p->>'currency'
                      AND NOT (b->>'party_id') IS DISTINCT FROM (p->>'party_id'))) AS disagree,
         (SELECT count(*)::int FROM json_array_elements($2::json) b
           WHERE NOT EXISTS (SELECT 1 FROM json_array_elements($1::json) p
                              WHERE p->>'currency' = b->>'currency'
                                AND NOT (p->>'party_id') IS DISTINCT FROM (b->>'party_id'))) AS unlisted,
         (SELECT sum((b->>'outstanding_amount')::numeric)::numeric(18,2)::text FROM json_array_elements($2::json) b
           WHERE b->>'party_id' = $3) AS p_total`,
      [JSON.stringify(ag.by_party), JSON.stringify(ag.by_party_bucket), ids10.p])
    expect(check).toEqual({ disagree: 0, unlisted: 0, p_total: '160.00' })

    // The ageing total still agrees with the receivable control accounts' balance: the unallocated
    // receipt is what makes P's 160.00 match the 160.00 on `${TAG}-1200`.
    const usd = ag.reconciliation.find((r) => r.currency === 'USD')
    expect(usd).toMatchObject({ agrees: true, difference: '0.00' })
    expect(usd.control_codes).toContain(`${TAG}-1200`)
    // Under the explicit authority filter both sides are this council's own book: the ageing total
    // is this council's rows of the view, and the control balance this council's receivable
    // entries, each summed independently by Postgres here.
    const { rows: [own] } = await sys.query(
      `SELECT
         (SELECT COALESCE(sum(a.outstanding_amount), 0)::numeric(18,2)::text FROM finance.v_debtor_ageing a
           WHERE a.authority_id = $1 AND a.currency::text = 'USD') AS ageing_total,
         (SELECT COALESCE(sum(e.debit - e.credit), 0)::numeric(18,2)::text FROM finance.ledger_entry e
            JOIN finance.ledger_account la ON la.id = e.ledger_account_id
           WHERE e.authority_id = $1 AND la.authority_id = $1 AND la.account_type = 'receivable'
             AND la.deleted_at IS NULL AND e.currency::text = 'USD') AS control_balance`, [ids.authority])
    expect(own.ageing_total).toBe(own.control_balance)
    // Both are sums of two-decimal NUMERIC, so the route's text has two decimals as well.
    expect({ ageing_total: usd.ageing_total, control_balance: usd.control_balance }).toEqual(own)

    // The other book lists nothing of P's.
    const zwg = await ageing({ currency: 'ZWG' })
    expect(zwg.by_party.some((r) => r.party_id === ids10.p || r.currency === 'USD')).toBe(false)
    expect(zwg.by_party_bucket.some((r) => r.party_id === ids10.p || r.currency === 'USD')).toBe(false)

    // The statement lists the receipt as an open item of its own, negative.
    const s = await statement(ids10.p, { currency: 'USD' })
    expect(s.carried_forward).toEqual({ net_debit: '160.00', amount: '160.00', side: 'Dr' })
    expect(s.open_items).toEqual([
      expect.objectContaining({ voucher_id: ids10.b1, outstanding_amount: '200.00', ageing_bucket: 'over_365' }),
      {
        voucher_id: ids10.r1, voucher_no: `${TAG}-R1`, voucher_type: 'journal', posting_date: '1992-06-20',
        ledger_account_id: made.debtors, billed_amount: '0.00', settled_amount: '40.00', outstanding_amount: '-40.00',
        days_outstanding: await daysSince('1992-06-20'), ageing_bucket: 'unallocated',
      },
    ])
  })

  test('a credit note or write-off may not take a bill below nil: the second of two is refused', async () => {
    ids10.b2 = await journal(made.y2, '1992-07-01',
      [{ ledger_account_id: made.debtors, debit: '120.00', party_id: ids10.p }, { ledger_account_id: made.income, credit: '120.00' }],
      { voucher_no: `${TAG}-B2`, narration: 'Rates bill' })
    // Two write-offs of the whole 120.00, both drafted before either is posted.
    const writeOff = (no) => draft({
      voucher_type: 'write_off', voucher_no: no, posting_date: '1992-07-10', narration: 'Written off',
      lines: [{ ledger_account_id: made.expense, debit: '120.00' },
        { ledger_account_id: made.debtors, credit: '120.00', party_id: ids10.p, against_voucher_id: ids10.b2 }],
    })
    ids10.w1 = await writeOff(`${TAG}-W1`)
    const w2 = await writeOff(`${TAG}-W2`)
    // And a credit note of 250.00 against B1, which has 200.00 open.
    const cn2 = await draft({
      voucher_type: 'credit_note', voucher_no: `${TAG}-CN2`, posting_date: '1992-07-10',
      lines: [{ ledger_account_id: made.income, debit: '250.00' },
        { ledger_account_id: made.debtors, credit: '250.00', party_id: ids10.p, against_voucher_id: ids10.b1 }],
    })
    try {
      expect((await post(ids10.w1)).statusCode).toBe(200)
      const second = await post(w2)
      expect(second.statusCode).toBe(409)
      expect(second.json()).toEqual({
        success: false, error: 'over_applied', message: `${TAG}-B2 has USD 0.00 still open; this would apply USD 120.00.`,
      })
      const tooMuch = await post(cn2)
      expect(tooMuch.statusCode).toBe(409)
      expect(tooMuch.json()).toMatchObject({
        error: 'over_applied', message: `${TAG}-B1 has USD 200.00 still open; this would apply USD 250.00.`,
      })
      // Refused means nothing posted: both stay drafts with no entries.
      const { rows: left } = await sys.query(
        `SELECT v.voucher_no, v.status, (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries
           FROM finance.voucher v WHERE v.id = ANY($1::uuid[]) ORDER BY v.voucher_no`, [[w2, cn2]])
      expect(left).toEqual([
        { voucher_no: `${TAG}-CN2`, status: 'draft', entries: 0 },
        { voucher_no: `${TAG}-W2`, status: 'draft', entries: 0 },
      ])

      // B2 stands settled at 0.00, not −120.00.
      const bills = (await ageing({ currency: 'USD', party_id: ids10.p, outstanding_only: 'false' })).bills
      expect(bills.find((b) => b.voucher_id === ids10.b2)).toMatchObject({
        billed_amount: '120.00', settled_amount: '120.00', outstanding_amount: '0.00', ageing_bucket: 'settled',
      })
      // So the statement leaves B2 out of the open items; P still owes 300 − 100 − 40 + 120 − 120 = 160.00.
      const s = await statement(ids10.p, { currency: 'USD' })
      expect(s.open_items.map((i) => [i.voucher_no, i.outstanding_amount])).toEqual([[`${TAG}-B1`, '200.00'], [`${TAG}-R1`, '-40.00']])
      expect(s.carried_forward).toEqual({ net_debit: '160.00', amount: '160.00', side: 'Dr' })
      expect(s.entries.map((e) => [e.voucher_no, e.balance.net_debit])).toEqual([
        [`${TAG}-B1`, '300.00'], [`${TAG}-CN1`, '200.00'], [`${TAG}-R1`, '160.00'], [`${TAG}-B2`, '280.00'], [`${TAG}-W1`, '160.00']])
      expect((await ageing({ currency: 'USD' })).reconciliation.find((r) => r.currency === 'USD'))
        .toMatchObject({ agrees: true, difference: '0.00' })
    } finally {
      // Discarded, so year 2 holds no draft for the blocks after this one.
      for (const id of [w2, cn2]) expect((await call('DELETE', `/finance/ledger/vouchers/${id}`, as.accountant)).statusCode).toBe(200)
    }
  })

  test('a creditor\'s statement reads the payable accounts and the creditor open items', async () => {
    ids10.payable = await account('2200', 'Accounting test creditors', 'liability', 'payable')
    ids10.s = await party('supplier', 'Accounting test supplier S', `${TAG}-S`)
    ids10.si1 = await journal(made.y2, '1992-06-05',
      [{ ledger_account_id: made.expense, debit: '80.00' }, { ledger_account_id: ids10.payable, credit: '80.00', party_id: ids10.s }],
      { voucher_no: `${TAG}-SI1`, narration: 'Supplier invoice' })
    await journal(made.y2, '1992-06-25',
      [{ ledger_account_id: ids10.payable, debit: '30.00', party_id: ids10.s, against_voucher_id: ids10.si1 },
        { ledger_account_id: made.bank, credit: '30.00' }],
      { voucher_no: `${TAG}-PAY1`, narration: 'Part payment' })

    const s = await statement(ids10.s, { currency: 'USD', kind: 'payable' })
    expect(s).toMatchObject({ currency: 'USD', kind: 'payable', brought_forward: NIL })
    expect(s.party).toMatchObject({ id: ids10.s, party_type: 'supplier', reference: `${TAG}-S`, address_text: null })
    // In credit, as a creditor is: 80.00 Cr, then 80.00 − 30.00 = 50.00 Cr.
    expect(s.entries.map((e) => [e.voucher_no, e.debit, e.credit, e.balance.net_debit, e.balance.amount, e.balance.side, e.account_code]))
      .toEqual([
        [`${TAG}-SI1`, '0.00', '80.00', '-80.00', '80.00', 'Cr', `${TAG}-2200`],
        [`${TAG}-PAY1`, '30.00', '0.00', '-50.00', '50.00', 'Cr', `${TAG}-2200`],
      ])
    expect(s.carried_forward).toEqual({ net_debit: '-50.00', amount: '50.00', side: 'Cr' })
    // From finance.v_creditor_open: raised 80.00, paid 30.00, 50.00 still owed.
    expect(s.open_items).toEqual([{
      voucher_id: ids10.si1, voucher_no: `${TAG}-SI1`, voucher_type: 'journal', posting_date: '1992-06-05',
      ledger_account_id: ids10.payable, billed_amount: '80.00', settled_amount: '30.00', outstanding_amount: '50.00',
      days_outstanding: await daysSince('1992-06-05'), ageing_bucket: 'over_365',
    }])

    // Each kind reads only its own accounts.
    const asDebtor = await statement(ids10.s, { currency: 'USD' })
    expect(asDebtor).toMatchObject({ kind: 'receivable', entries: [], open_items: [], carried_forward: NIL })
    const pAsCreditor = await statement(ids10.p, { currency: 'USD', kind: 'payable' })
    expect(pAsCreditor).toMatchObject({ kind: 'payable', entries: [], open_items: [], carried_forward: NIL })

    // A payment beyond what is owed is refused as well.
    const pay2 = await draft({
      voucher_type: 'journal', voucher_no: `${TAG}-PAY2`, posting_date: '1992-06-30',
      lines: [{ ledger_account_id: ids10.payable, debit: '60.00', party_id: ids10.s, against_voucher_id: ids10.si1 },
        { ledger_account_id: made.bank, credit: '60.00' }],
    })
    try {
      const refused = await post(pay2)
      expect(refused.statusCode).toBe(409)
      expect(refused.json()).toMatchObject({ error: 'over_applied', message: `${TAG}-SI1 has USD 50.00 still open; this would apply USD 60.00.` })
    } finally {
      expect((await call('DELETE', `/finance/ledger/vouchers/${pay2}`, as.accountant)).statusCode).toBe(200)
    }
  })

  test('the statement needs the ledger permission', async () => {
    const url = statementUrl(ids10.p, { currency: 'USD' })
    const refused = await call('GET', url, as.cashier)
    expect(refused.statusCode).toBe(403)
    expect(refused.json().required_permission).toBe('finance.ledger.view')
    const auditor = await call('GET', url, as.auditor)
    expect(auditor.statusCode).toBe(200)
    expect(auditor.json().data.carried_forward).toEqual({ net_debit: '160.00', amount: '160.00', side: 'Dr' })
  })

  test('another council sees nothing of this council\'s debtors', async () => {
    const code = `${TAG}Z`
    const { rows: [other] } = await sys.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`, [`Accounting test debtors neighbour ${TAG} (fictional)`, code])
    const email = `${TAG.toLowerCase()}.debtors-neighbour@vungu.test`
    try {
      await sys.query(
        `INSERT INTO public.users (email, name, role, password_hash, active, status, authority_id)
         SELECT $1, $2, role, password_hash, true, 'active', $3 FROM public.users WHERE email = $4`,
        [email, `${TAG} debtors neighbour auditor`, other.id, PEOPLE.auditor])
      const token = await loginAs(app, email, PASSWORD)
      for (const [partyId, kind] of [[ids10.p, 'receivable'], [ids10.s, 'payable']]) {
        const res = await call('GET', statementUrl(partyId, { currency: 'USD', kind }), token)
        expect(res.statusCode).toBe(404)
        expect(res.json()).toMatchObject({ success: false, error: 'not_found' })
        expect(res.body).not.toContain(`${TAG}-`)
      }
      // The ageing, read by the neighbour, holds none of this council's rows.
      const ag = await call('GET', `/finance/ledger/debtor-ageing${qs({ currency: 'USD', limit: '500' })}`, token)
      expect(ag.statusCode).toBe(200)
      expect(ag.body).not.toContain(ids10.p)
      expect(ag.body).not.toContain(`${TAG}-`)
    } finally {
      await sys.query('DELETE FROM public.users WHERE email = $1', [email]).catch(() => {})
      await sys.query('DELETE FROM public.local_authorities WHERE id = $1', [other.id]).catch(() => {})
    }
  })
})

// ══ B-SOD: segregation of duties and voucher integrity ════════════════════════════════════════
// From the accounting audit (M3, M4, M5, M8) and the security audit (C1, H1 to H4, Medium M3).
// Starts from Task 10's state and posts only into year 2, in August 1992, between the bank
// `${TAG}-1100` and the expense `${TAG}-5000`. Every posting here is reversed again inside its own
// test, so year 2's balances are left as Task 10 left them (bank −434.00, expense 2200.00). It
// leaves CANCELLED vouchers in year 2 (a cancelled voucher posts nothing) and no draft.
describe('B-SOD: segregation of duties and voucher integrity', () => {
  /** Rows written by the audit hook, which writes after the reply is sent. */
  const waitForRows = async (sql, params) => {
    let rows = []
    for (let attempt = 0; attempt < 40; attempt += 1) {
      ({ rows } = await sys.query(sql, params))
      if (rows.length) return rows
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return rows
  }
  const auditOf = (action, voucherId) => waitForRows(
    `SELECT event, severity, actor_id, status, details FROM public.admin_audit_event
      WHERE event = 'FIN_LEDGER_POST' AND details->>'action' = $1 AND details->>'voucher_id' = $2
      ORDER BY occurred_at DESC, id DESC`, [action, voucherId])
  /** A draft journal prepared by `token` (the accountant by default) in year 2. Returns the reply data. */
  const draftJournal = async (amount, extra = {}, token = as.accountant) => {
    const res = await call('POST', '/finance/ledger/vouchers', token,
      { voucher_type: 'journal', currency: 'USD', financial_year_id: made.y2, posting_date: '1992-08-01', lines: pair(amount), ...extra })
    if (res.statusCode !== 201) throw new Error(`draft was not created (${res.statusCode}): ${res.body}`)
    return res.json().data
  }
  const detail = async (id) => (await call('GET', `/finance/ledger/vouchers/${id}`, as.auditor)).json().data
  const bankOfY2 = async () => net(await balances(made.y2), made.bank)
  const discard = (id, token = as.accountant, payload) => call('DELETE', `/finance/ledger/vouchers/${id}`, token, payload)

  test('a reversal is a draft prepared by the caller, and only somebody else can post it (C1, M3)', async () => {
    const bankBefore = await bankOfY2()
    expect(bankBefore).toBe('-434.00')
    const original = await draftJournal('7.00', { voucher_no: `${TAG}-SOD-R1` })
    expect((await postAs(as.director, original.voucher.id)).statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-441.00')

    // The accountant reverses it: a DRAFT, prepared by the accountant, posted by nobody.
    const rev = await call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.accountant,
      { reason: 'Posted to the wrong period by mistake.' })
    expect(rev.statusCode).toBe(201)
    const reversal = rev.json().data.reversal
    expect(rev.json().data).toMatchObject({ reversed: `${TAG}-SOD-R1`, awaiting_post: true })
    expect(reversal).toMatchObject({
      voucher_no: `${TAG}-SOD-R1-R`, voucher_type: 'reversal', status: 'draft', posting_date: '1992-08-01',
      reverses_voucher_id: original.voucher.id, prepared_by: ids.accountant, version: 1,
    })
    // Nothing has moved, and no second person's name is on anything.
    expect(await bankOfY2()).toBe('-441.00')
    const { rows: [rv] } = await sys.query(
      `SELECT posted_by, posted_at, (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries,
              (SELECT count(*)::int FROM finance.voucher_line l WHERE l.voucher_id = v.id) AS lines
         FROM finance.voucher v WHERE v.id = $1`, [reversal.id])
    expect(rv).toEqual({ posted_by: null, posted_at: null, entries: 0, lines: 2 })

    // It waits in the Director's To post queue, and in the accountant's own drafts.
    const toPost = (await call('GET', `/finance/ledger/vouchers?financial_year_id=${made.y2}&queue=to_post`, as.director)).json().data
    expect(toPost.vouchers.map((v) => v.id)).toEqual([reversal.id])
    const mine = (await call('GET', `/finance/ledger/vouchers?financial_year_id=${made.y2}&queue=mine`, as.accountant)).json().data
    expect(mine.vouchers.map((v) => v.id)).toEqual([reversal.id])
    const listed = (await call('GET', `/finance/ledger/vouchers?financial_year_id=${made.y2}&q=${TAG}-SOD-R1`, as.auditor)).json().data
    expect(listed.vouchers.find((v) => v.id === original.voucher.id)).toMatchObject({
      pending_reversal_no: `${TAG}-SOD-R1-R`, reversed_by_voucher_no: null,
    })

    // A second reversal while this one waits is refused.
    const twice = await call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.director,
      { reason: 'A second reversal of the same voucher.' })
    expect(twice.statusCode).toBe(409)
    expect(twice.json()).toEqual({
      success: false, error: 'reversal_pending',
      message: `Voucher ${TAG}-SOD-R1 already has a reversal, ${TAG}-SOD-R1-R, waiting to be posted. Have it posted `
        + 'from the To post queue, or discard it and raise the reversal again.',
    })

    // The preparer cannot post it; the Director can.
    const self = await postAs(as.accountant, reversal.id)
    expect(self.statusCode).toBe(409)
    expect(self.json().error).toBe('separation_of_duties')
    const posted = await postAs(as.director, reversal.id)
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data).toMatchObject({ posted: `${TAG}-SOD-R1-R`, entries: 2 })
    expect(await bankOfY2()).toBe(bankBefore)
    const { rows: [done] } = await sys.query('SELECT prepared_by, posted_by, status FROM finance.voucher WHERE id = $1', [reversal.id])
    expect(done).toEqual({ prepared_by: ids.accountant, posted_by: ids.director, status: 'posted' })

    // Reversed once is reversed: a third attempt is refused as already done.
    const again = await call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.director,
      { reason: 'And once more, which must be refused.' })
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toBe('already_done')

    // The audit trail: who raised the reversal, why, and who posted it.
    const [raised] = await auditOf('reversal_drafted', original.voucher.id)
    expect(raised).toMatchObject({ event: 'FIN_LEDGER_POST', severity: 'critical', actor_id: ids.accountant, status: 201 })
    expect(raised.details).toMatchObject({
      voucher_no: `${TAG}-SOD-R1`, reversal_id: reversal.id, reversal_no: `${TAG}-SOD-R1-R`,
      reason: 'Posted to the wrong period by mistake.', line_count: 2, debit_total: '7.00', credit_total: '7.00',
    })
    const [postRow] = await auditOf('voucher_posted', reversal.id)
    expect(postRow).toMatchObject({ actor_id: ids.director, status: 200 })
    expect(postRow.details).toMatchObject({
      voucher_no: `${TAG}-SOD-R1-R`, voucher_type: 'reversal', version: 1, version_checked: true, prepared_by: ids.accountant,
      reverses_voucher_id: original.voucher.id, entries: 2,
    })
  })

  test('a discarded reversal keeps its number, and the next one is numbered after it (L4)', async () => {
    const original = await draftJournal('3.00', { voucher_no: `${TAG}-SOD-R2` })
    expect((await postAs(as.director, original.voucher.id)).statusCode).toBe(200)
    const reverse = () => call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.director,
      { reason: 'Reversal raised and then thought better of.' })
    const first = (await reverse()).json().data.reversal
    expect(first.voucher_no).toBe(`${TAG}-SOD-R2-R`)
    expect((await discard(first.id, as.director)).statusCode).toBe(200)
    // The cancelled reversal does not count as live, so a new one may be raised; its number is the next free one.
    const second = await reverse()
    expect(second.statusCode).toBe(201)
    expect(second.json().data.reversal.voucher_no).toBe(`${TAG}-SOD-R2-R2`)
    expect((await postAs(as.accountant, second.json().data.reversal.id)).statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-434.00')
    // The voucher's detail names the posted reversal, not the cancelled one.
    expect((await detail(original.voucher.id)).reversed_by).toMatchObject({ voucher_no: `${TAG}-SOD-R2-R2`, status: 'posted' })
  })

  test('a reversal draft keeps the reason it was raised with, and its lines (fix round 1, M-3)', async () => {
    const original = await draftJournal('2.00', { voucher_no: `${TAG}-SOD-R3` })
    expect((await postAs(as.director, original.voucher.id)).statusCode).toBe(200)
    const reversal = (await call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.director,
      { reason: 'Charged to the wrong vote.' })).json().data.reversal
    // Its preparer cannot rewrite the reason, alone or beside another field.
    for (const body of [{ narration: 'A different reason entirely.' }, { narration: 'Another reason.', posting_date: '1992-08-02' }]) {
      const res = await call('PATCH', `/finance/ledger/vouchers/${reversal.id}`, as.director, body)
      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        success: false, error: 'reversal_reason',
        message: `Voucher ${TAG}-SOD-R3-R is a reversal, and its narration is the reason it was raised with. `
          + 'Discard it and raise the reversal again to give a different reason.',
      })
    }
    // Nor its lines.
    const relined = await call('PATCH', `/finance/ledger/vouchers/${reversal.id}`, as.director, { lines: pair('2.00') })
    expect(relined.statusCode).toBe(409)
    expect(relined.json().error).toBe('reversal_lines')
    const kept = await detail(reversal.id)
    expect(kept.voucher).toMatchObject({ narration: 'Charged to the wrong vote.', posting_date: '1992-08-01', version: 1 })
    // Posted by somebody else with the reason intact; year 2 is as it was.
    expect((await postAs(as.accountant, reversal.id)).statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-434.00')
  })

  test('only the preparer may change or discard a draft (H1, M4)', async () => {
    const d = await draftJournal('450.00', { voucher_no: `${TAG}-SOD-P1`, narration: 'Fuel' })
    const id = d.voucher.id
    // The Director holds prepare and post, and still may not rewrite the accountant's draft.
    const rewrite = await call('PATCH', `/finance/ledger/vouchers/${id}`, as.director, { lines: pair('4500.00') })
    expect(rewrite.statusCode).toBe(403)
    expect(rewrite.json()).toEqual({
      success: false, error: 'not_preparer',
      message: `Only the person who prepared voucher ${TAG}-SOD-P1 may change it. Copy it into a new draft of your own instead.`,
    })
    expect((await call('PATCH', `/finance/ledger/vouchers/${id}`, as.director, { narration: 'Renamed' })).statusCode).toBe(403)
    const binned = await discard(id, as.director)
    expect(binned.statusCode).toBe(403)
    expect(binned.json()).toEqual({
      success: false, error: 'not_preparer',
      message: `Only the person who prepared voucher ${TAG}-SOD-P1 may discard it. Ask them to discard it.`,
    })
    // Nothing changed: same lines, same narration, same version, still a draft.
    const after = await detail(id)
    expect(after.voucher).toMatchObject({ status: 'draft', narration: 'Fuel', version: 1, prepared_by: ids.accountant })
    expect(after.draft_balance).toEqual({ line_count: 2, debit_total: '450.00', credit_total: '450.00', difference: '0.00' })
    // The refused attempts are in the trail with the reason.
    const [refusedEdit] = await auditOf('voucher_edit_refused', id)
    expect(refusedEdit).toMatchObject({ actor_id: ids.director, status: 403 })
    expect(refusedEdit.details).toMatchObject({ reason: 'not_preparer', voucher_no: `${TAG}-SOD-P1` })
    const [refusedCancel] = await auditOf('voucher_cancel_refused', id)
    expect(refusedCancel).toMatchObject({ actor_id: ids.director, status: 403 })

    // The preparer may; the edit raises the version and is audited with before and after.
    const edited = await call('PATCH', `/finance/ledger/vouchers/${id}`, as.accountant, { lines: pair('45.00'), narration: 'Fuel, corrected' })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().data).toEqual({
      updated: `${TAG}-SOD-P1`, version: 2,
      balance: { debit_total: '45.00', credit_total: '45.00', difference: '0.00' }, balances: true,
    })
    const [amended] = await auditOf('voucher_amended', id)
    expect(amended).toMatchObject({ actor_id: ids.accountant, status: 200 })
    expect(amended.details).toMatchObject({
      voucher_no: `${TAG}-SOD-P1`, version_before: 1, version_after: 2,
      before: { narration: 'Fuel' }, after: { narration: 'Fuel, corrected' }, lines_replaced: true,
      lines_before: { line_count: 2, debit_total: '450.00', credit_total: '450.00' },
      lines_after: { line_count: 2, debit_total: '45.00', credit_total: '45.00' },
    })
    expect((await discard(id)).statusCode).toBe(200)
  })

  test('a discarded draft is cancelled, keeps its number and lines, and leaves the queues (M8)', async () => {
    const d = await draftJournal('12.00') // numbered from the journal series
    const id = d.voucher.id
    const no = d.voucher.voucher_no
    expect(no).toMatch(/^JV-\d{7}$/)
    const count = async (query, token = as.director) =>
      (await call('GET', `/finance/ledger/vouchers?${new URLSearchParams({ financial_year_id: made.y2, ...query })}`, token)).json().data
    const before = await count({})
    expect(before.queues.to_post).toBe(1)

    const res = await discard(id, as.accountant, { reason: 'Raised twice by mistake.' })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      cancelled: no, voucher_id: id, status: 'cancelled', cancel_reason: 'Raised twice by mistake.',
      note: `${no} is cancelled. Its number and lines stay on the record, and it posts nothing.`,
    })
    const { rows: [row] } = await sys.query(
      `SELECT voucher_no, status, cancelled_by, cancelled_at IS NOT NULL AS stamped, cancel_reason,
              (SELECT count(*)::int FROM finance.voucher_line l WHERE l.voucher_id = v.id) AS lines,
              (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries
         FROM finance.voucher v WHERE v.id = $1`, [id])
    expect(row).toEqual({ voucher_no: no, status: 'cancelled', cancelled_by: ids.accountant, stamped: true,
      cancel_reason: 'Raised twice by mistake.', lines: 2, entries: 0 })

    // Out of the queues and the default register, in the Cancelled count, and listed when asked for.
    const after = await count({})
    expect(after.queues.to_post).toBe(before.queues.to_post - 1)
    expect(after.queues.all).toBe(before.queues.all - 1)
    expect(after.queues.cancelled).toBe(before.queues.cancelled + 1)
    expect(after.vouchers.some((v) => v.id === id)).toBe(false)
    expect((await count({ queue: 'to_post' })).vouchers.some((v) => v.id === id)).toBe(false)
    expect((await count({ queue: 'mine' }, as.accountant)).vouchers.some((v) => v.id === id)).toBe(false)
    const cancelled = await count({ status: 'cancelled' })
    expect(cancelled.vouchers.find((v) => v.id === id)).toMatchObject({
      voucher_no: no, status: 'cancelled', cancel_reason: 'Raised twice by mistake.', cancelled_by: ids.accountant, line_count: 2,
    })
    expect((await detail(id)).note).toBe('Cancelled before it was posted. Its number and lines stay on the record; it posts nothing.')

    // Cancelled is final: it cannot be discarded again, edited or posted.
    expect((await discard(id)).json()).toMatchObject({ error: 'voucher_cancelled' })
    expect((await call('PATCH', `/finance/ledger/vouchers/${id}`, as.accountant, { narration: 'x' })).json().error).toBe('voucher_cancelled')
    const post = await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director, { expected_version: 1 })
    expect(post.statusCode).toBe(409)
    expect(post.json().error).toBe('already_done')
    // A cancelled voucher's lines stay frozen in the database too.
    await expect(sys.query('UPDATE finance.voucher_line SET narration = $2 WHERE voucher_id = $1', [id, 'tampered']))
      .rejects.toMatchObject({ code: '23514' })

    // The next number follows it: the series has no gap and no reuse.
    const next = await draftJournal('1.00')
    expect(BigInt(next.voucher.voucher_no.slice(3)) - BigInt(no.slice(3))).toBe(1n)
    expect((await discard(next.voucher.id)).statusCode).toBe(200)

    // A reason, when sent, must be a sentence; and a bad one changes nothing.
    const third = await draftJournal('2.00')
    const short = await discard(third.voucher.id, as.accountant, { reason: 'x' })
    expect(short.statusCode).toBe(400)
    expect(short.json().error).toBe('bad_reason')
    expect((await detail(third.voucher.id)).voucher.status).toBe('draft')
    // Without a body, the record says why in general terms.
    expect((await discard(third.voucher.id)).json().data.cancel_reason).toBe('Discarded by its preparer before posting.')

    const [audit] = await auditOf('voucher_cancelled', id)
    expect(audit).toMatchObject({ event: 'FIN_LEDGER_POST', actor_id: ids.accountant, status: 200 })
    expect(audit.details).toMatchObject({
      voucher_no: no, voucher_type: 'journal', reason: 'Raised twice by mistake.', line_count: 2, debit_total: '12.00', credit_total: '12.00',
    })
  })

  test('a poster who reviewed an earlier version is refused (H3)', async () => {
    const d = await draftJournal('450.00', { voucher_no: `${TAG}-SOD-V1` })
    const id = d.voucher.id
    expect(d.voucher.version).toBe(1)
    expect((await detail(id)).voucher.version).toBe(1)
    // The Director opens it at version 1. The accountant then changes the amount.
    expect((await call('PATCH', `/finance/ledger/vouchers/${id}`, as.accountant, { lines: pair('4500.00') })).json().data.version).toBe(2)

    const stale = await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director, { expected_version: 1 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({
      success: false, error: 'changed_since_review',
      message: 'The draft was changed after you opened it. Read it again before posting.', current_version: 2,
    })
    const { rows: [still] } = await sys.query(
      'SELECT status, (SELECT count(*)::int FROM finance.ledger_entry e WHERE e.voucher_id = v.id) AS entries FROM finance.voucher v WHERE v.id = $1', [id])
    expect(still).toEqual({ status: 'draft', entries: 0 })
    const [refused] = await auditOf('voucher_post_refused', id)
    expect(refused.details).toMatchObject({ reason: 'changed_since_review', expected_version: 1, current_version: 2 })

    // When sent, the version must be a positive whole number (fix round 1: it is optional).
    const zero = await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director, { expected_version: 0 })
    expect(zero.statusCode).toBe(400)
    expect(zero.json().error).toBe('bad_version')
    // A header edit raises it too; the list shows the version beside each voucher.
    expect((await call('PATCH', `/finance/ledger/vouchers/${id}`, as.accountant, { narration: 'Reviewed amount' })).json().data.version).toBe(3)
    const listed = (await call('GET', `/finance/ledger/vouchers?financial_year_id=${made.y2}&queue=to_post`, as.director)).json().data
    expect(listed.vouchers.find((v) => v.id === id).version).toBe(3)
    expect((await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director, { expected_version: 2 })).json().error).toBe('changed_since_review')

    // Read again at version 3, it posts; then it is reversed so year 2 is as it was.
    const posted = await call('POST', `/finance/ledger/vouchers/${id}/post`, as.director, { expected_version: 3 })
    expect(posted.statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-4934.00')
    const rev = (await call('POST', `/finance/ledger/vouchers/${id}/reverse`, as.director, { reason: 'Test posting withdrawn again.' })).json().data.reversal
    expect((await postAs(as.accountant, rev.id)).statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-434.00')
  })

  test('a post without a version is accepted, as the console sends it, and the audit row says it was not checked (fix round 1)', async () => {
    const d = await draftJournal('9.00', { voucher_no: `${TAG}-SOD-V2` })
    // Changed after drafting, so version 2; posted with no version at all, as the console posts `{}`.
    expect((await call('PATCH', `/finance/ledger/vouchers/${d.voucher.id}`, as.accountant, { narration: 'Edited once' })).json().data.version).toBe(2)
    const posted = await call('POST', `/finance/ledger/vouchers/${d.voucher.id}/post`, as.director, {})
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data).toMatchObject({ posted: `${TAG}-SOD-V2`, entries: 2 })
    const [row] = await auditOf('voucher_posted', d.voucher.id)
    expect(row.details).toMatchObject({ version: 2, version_checked: false })
    // An unknown field is still refused.
    const d2 = await draftJournal('1.00')
    expect((await call('POST', `/finance/ledger/vouchers/${d2.voucher.id}/post`, as.director, { version: 1 })).json().error).toBe('bad_request')
    expect((await discard(d2.voucher.id)).statusCode).toBe(200)
    // Reversed again, so year 2 is as it was.
    const rev = (await call('POST', `/finance/ledger/vouchers/${d.voucher.id}/reverse`, as.director, { reason: 'Test posting withdrawn again.' })).json().data.reversal
    expect((await postAs(as.accountant, rev.id)).statusCode).toBe(200)
    expect(await bankOfY2()).toBe('-434.00')
  })

  test('system voucher types cannot be typed, by the route or into the database (H4, M5)', async () => {
    const make = (type) => call('POST', '/finance/ledger/vouchers', as.accountant,
      { voucher_type: type, voucher_no: `${TAG}-SOD-${type}`, currency: 'USD', financial_year_id: made.y2, posting_date: '1992-08-01', lines: pair('1.00') })
    for (const [type, message] of [
      ['closing', 'A year-end closing voucher is raised by the year-end close under Period Close; it cannot be typed.'],
      ['receipt', 'A receipt is raised by the cash office, or by Rates, when the money is received; it cannot be typed.'],
      ['rates_bill', 'A rates bill is raised by a billing run under Rates; it cannot be typed.'],
      ['reversal', 'A reversal is raised by reversing a posted voucher; it cannot be typed.'],
      ['supplier_invoice', 'A supplier invoice voucher is raised by Creditors when the invoice is captured; it cannot be typed.'],
      ['payment', 'A payment voucher is raised by Creditors when the payment is prepared; it cannot be typed.'],
      ['depreciation', 'A depreciation voucher is raised by a depreciation run in the Asset Register; it cannot be typed.'],
      ['asset_disposal', 'An asset disposal voucher is raised by a disposal in the Asset Register; it cannot be typed.'],
    ]) {
      const res = await make(type)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ success: false, error: 'system_type', message })
    }
    const typed = ['closing', 'receipt', 'rates_bill', 'reversal', 'supplier_invoice', 'payment', 'depreciation', 'asset_disposal']
      .map((type) => `${TAG}-SOD-${type}`)
    const { rows: [{ n }] } = await sys.query('SELECT count(*)::int AS n FROM finance.voucher WHERE voucher_no = ANY($1::text[])', [typed])
    expect(n).toBe(0)
    // Opening balances stay creatable (spec §6.2), numbered OB-.
    const opening = await call('POST', '/finance/ledger/vouchers', as.accountant,
      { voucher_type: 'opening', currency: 'USD', financial_year_id: made.y2, posting_date: '1992-08-01', lines: pair('1.00') })
    expect(opening.statusCode).toBe(201)
    expect(opening.json().data.voucher.voucher_no).toMatch(/^OB-\d{7}$/)
    expect((await discard(opening.json().data.voucher.id)).statusCode).toBe(200)

    // In the database, even past the route and row-level security, a closing voucher is refused
    // unless finance.close_ledger_year() raises it; and a draft cannot be retyped as one.
    await expect(sys.query(
      `INSERT INTO finance.voucher (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, status, prepared_by)
       VALUES ($1, $2, 'closing', 'USD', $3, '1992-12-31', 'draft', $4)`, [ids.authority, `${TAG}-SOD-HANDCLOSE`, made.y2, ids.accountant]))
      .rejects.toMatchObject({ code: '23514', message: 'a year-end closing voucher is raised only by the year-end close' })
    const d = await draftJournal('1.00')
    await expect(sys.query("UPDATE finance.voucher SET voucher_type = 'closing' WHERE id = $1", [d.voucher.id]))
      .rejects.toMatchObject({ code: '23514' })
    expect((await discard(d.voucher.id)).statusCode).toBe(200)
    expect(await closed(made.y2)).toBe(false)
  })

  test('no voucher, line or reference may cite another council\'s records, by the route or in the database (H2, L5, L6)', async () => {
    const code = `${TAG}W`
    const { rows: [other] } = await sys.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`, [`Accounting test B-SOD neighbour ${TAG} (fictional)`, code])
    const foreign = {}
    try {
      // The neighbour's year, heading-free postable account, party and a bill, written as the system.
      foreign.year = (await sys.query(
        `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status)
         VALUES ($1, $2, '1992-01-01', '1992-12-31', 'open') RETURNING id`, [other.id, `${code} neighbour year`])).rows[0].id
      foreign.account = (await sys.query(
        `INSERT INTO finance.ledger_account (authority_id, code, name, root_type, account_type)
         VALUES ($1, $2, 'Neighbour debtors', 'asset', 'receivable') RETURNING id`, [other.id, `${code}-1200`])).rows[0].id
      foreign.party = (await sys.query(
        `INSERT INTO finance.party (authority_id, party_type, name, reference)
         VALUES ($1, 'ratepayer', 'Neighbour ratepayer', $2) RETURNING id`, [other.id, `${code}-P`])).rows[0].id
      foreign.bill = (await sys.query(
        `INSERT INTO finance.voucher (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, status, prepared_by)
         VALUES ($1, $2, 'journal', 'USD', $3, '1992-06-01', 'draft', $4) RETURNING id`,
        [other.id, `${code}-B1`, foreign.year, ids.director])).rows[0].id
      // Its analysis dimensions, for the ledger-entry checks (fix round 1, review I-3).
      foreign.department = (await sys.query(
        `INSERT INTO finance.department (authority_id, code, name) VALUES ($1, $2, 'Neighbour works') RETURNING id`,
        [other.id, `${code}-D`])).rows[0].id
      foreign.programme = (await sys.query(
        `INSERT INTO finance.programme (authority_id, department_id, code, name) VALUES ($1, $2, $3, 'Neighbour roads') RETURNING id`,
        [other.id, foreign.department, `${code}-PG`])).rows[0].id
      foreign.activity = (await sys.query(
        `INSERT INTO finance.activity (authority_id, programme_id, code, name) VALUES ($1, $2, $3, 'Neighbour patching') RETURNING id`,
        [other.id, foreign.programme, `${code}-AC`])).rows[0].id
      foreign.project = (await sys.query(
        `INSERT INTO finance.project (authority_id, reference, name, currency) VALUES ($1, $2, 'Neighbour bridge', 'USD') RETURNING id`,
        [other.id, `${code}-PR`])).rows[0].id
      foreign.vote = (await sys.query(
        `INSERT INTO finance.account (authority_id, code, name, kind) VALUES ($1, $2, 'Neighbour vote', 'expenditure') RETURNING id`,
        [other.id, `${code}-V`])).rows[0].id
      foreign.budgetLine = (await sys.query(
        `INSERT INTO finance.budget_line (authority_id, financial_year_id, department_id, account_id, code, description, currency)
         VALUES ($1, $2, $3, $4, $5, 'Neighbour budget line', 'USD') RETURNING id`,
        [other.id, foreign.year, foreign.department, foreign.vote, `${code}-BL`])).rows[0].id

      const create = (body) => call('POST', '/finance/ledger/vouchers', as.accountant,
        { voucher_type: 'journal', currency: 'USD', financial_year_id: made.y2, posting_date: '1992-08-01', lines: pair('5.00'), ...body })
      const refusal = (message) => ({ success: false, error: 'foreign_reference', message })
      const cases = [
        [{ financial_year_id: foreign.year }, 'The financial year named is not in this council\'s records.'],
        [{ lines: [{ ledger_account_id: made.expense, debit: '5.00' }, { ledger_account_id: foreign.account, credit: '5.00' }] },
          'Line 2 names a ledger account that is not in this council\'s records.'],
        [{ lines: [{ ledger_account_id: made.debtors, debit: '5.00', party_id: foreign.party }, { ledger_account_id: made.income, credit: '5.00' }] },
          'Line 1 names a party that is not in this council\'s records.'],
        [{ lines: [{ ledger_account_id: made.income, debit: '5.00' }, { ledger_account_id: made.debtors, credit: '5.00', against_voucher_id: foreign.bill }] },
          'Line 2 names a voucher to settle that is not in this council\'s records.'],
        // A row that exists nowhere gets the same sentence as another council's: nothing is learnt.
        [{ lines: [{ ledger_account_id: made.expense, debit: '5.00', budget_line_id: crypto.randomUUID() }, { ledger_account_id: made.bank, credit: '5.00' }] },
          'Line 1 names a budget line that is not in this council\'s records.'],
      ]
      for (const [body, message] of cases) {
        const res = await create(body)
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual(refusal(message))
        expect(res.body).not.toContain(code)
      }

      // PATCH is held to the same rule, and the draft is unchanged after it.
      const d = await draftJournal('5.00')
      const patched = await call('PATCH', `/finance/ledger/vouchers/${d.voucher.id}`, as.accountant,
        { lines: [{ ledger_account_id: made.expense, debit: '5.00' }, { ledger_account_id: foreign.account, credit: '5.00' }] })
      expect(patched.statusCode).toBe(400)
      expect(patched.json()).toEqual(refusal('Line 2 names a ledger account that is not in this council\'s records.'))
      expect((await detail(d.voucher.id)).voucher.version).toBe(1)

      // The neighbour's own draft cannot be edited, discarded, posted or reversed from here: it is not found.
      expect((await call('PATCH', `/finance/ledger/vouchers/${foreign.bill}`, as.accountant, { narration: 'x' })).statusCode).toBe(404)
      expect((await discard(foreign.bill)).statusCode).toBe(404)
      expect((await call('POST', `/finance/ledger/vouchers/${foreign.bill}/post`, as.director, { expected_version: 1 })).statusCode).toBe(404)
      expect((await call('POST', `/finance/ledger/vouchers/${foreign.bill}/reverse`, as.director, { reason: 'Not ours to reverse.' })).statusCode).toBe(404)

      // In the database, as the application's role under row-level security AND as the system role
      // past it, a line citing a foreign row is refused before any other trigger can name it.
      const app = tenantPool(sys, { id: ids.accountant, authority_id: ids.authority })
      const line = (db, column, value) => db.query(
        `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, ${column})
         VALUES ($1, $2, 99, $3, 1, 0, $4)`, [ids.authority, d.voucher.id, made.debtors, value])
      for (const db of [app, sys]) {
        await expect(db.query(
          `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
           VALUES ($1, $2, 99, $3, 1, 0)`, [ids.authority, d.voucher.id, foreign.account]))
          .rejects.toMatchObject({ code: '23503', message: 'line 99 names a ledger account that is not in this council\'s records' })
        await expect(line(db, 'party_id', foreign.party))
          .rejects.toMatchObject({ code: '23503', message: 'line 99 names a party that is not in this council\'s records' })
        await expect(line(db, 'against_voucher_id', foreign.bill))
          .rejects.toMatchObject({ code: '23503', message: 'line 99 names a voucher to settle that is not in this council\'s records' })
      }
      // A line of this council attached to the neighbour's voucher (security audit L5).
      await expect(sys.query(
        `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
         VALUES ($1, $2, 99, $3, 1, 0)`, [ids.authority, foreign.bill, made.bank]))
        .rejects.toMatchObject({ code: '23503', message: 'line 99 names a voucher that is not in this council\'s records' })
      // A voucher of this council in the neighbour's year.
      await expect(sys.query(
        `INSERT INTO finance.voucher (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date, status, prepared_by)
         VALUES ($1, $2, 'journal', 'USD', $3, '1992-08-01', 'draft', $4)`, [ids.authority, `${TAG}-SOD-FY`, foreign.year, ids.accountant]))
        .rejects.toMatchObject({ code: '23503', message: `voucher ${TAG}-SOD-FY names a financial year that is not in this council's records` })
      // The SECURITY DEFINER lookups of migration 203 now name the authority as well.
      const { rows: fns } = await sys.query(
        `SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'finance' AND p.proname IN ('assert_voucher_line_account_postable', 'validate_ledger_entry')
          ORDER BY p.proname`)
      expect(fns.map((f) => f.proname)).toEqual(['assert_voucher_line_account_postable', 'validate_ledger_entry'])
      expect(fns[0].def).toContain('la.authority_id = NEW.authority_id')
      for (const alias of ['vv', 'lp', 'la', 'gg']) expect(fns[1].def).toContain(`${alias}.authority_id = NEW.authority_id`)

      // The ledger itself (fix round 1, review I-3): an entry written past post_voucher, as the
      // system role, must name a line of its own voucher and only this council's party and
      // analysis dimensions. Each insert is refused; none is left behind (the deferred balance
      // trigger would refuse a lone one-sided entry at commit in any case).
      const { rows: [{ id: periodId }] } = await sys.query(
        `SELECT id FROM finance.ledger_period WHERE financial_year_id = $1 AND DATE '1992-08-01' BETWEEN from_date AND to_date`, [made.y2])
      const lineOf = async (voucherId) => (await sys.query(
        'SELECT id FROM finance.voucher_line WHERE voucher_id = $1 ORDER BY line_no LIMIT 1', [voucherId])).rows[0].id
      const ownLine = await lineOf(d.voucher.id)
      const entry = (column, value, lineId = ownLine) => sys.query(
        `INSERT INTO finance.ledger_entry (authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
           debit, credit, currency, posting_date, financial_year_id, ledger_period_id, posted_by${column ? `, ${column}` : ''})
         VALUES ($1, $2, $3, $4, 'journal', $5, 1, 0, 'USD', '1992-08-01', $6, $7, $8${column ? ', $9' : ''})`,
        [ids.authority, d.voucher.id, lineId, d.voucher.voucher_no, made.expense, made.y2, periodId, ids.director,
          ...(column ? [value] : [])])
      for (const [column, value, label] of [
        ['party_id', foreign.party, 'party'],
        ['department_id', foreign.department, 'department'],
        ['programme_id', foreign.programme, 'programme'],
        ['activity_id', foreign.activity, 'activity'],
        ['project_id', foreign.project, 'project'],
        ['budget_line_id', foreign.budgetLine, 'budget line'],
      ]) {
        await expect(entry(column, value)).rejects.toMatchObject({
          code: '23503', message: `entry of voucher ${d.voucher.voucher_no} names ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label} that is not in this council's records`,
        })
      }
      // A line of another voucher of this same council.
      const other2 = await draftJournal('2.00')
      await expect(entry(null, null, await lineOf(other2.voucher.id))).rejects.toMatchObject({
        code: '23514', message: `entry of voucher ${d.voucher.voucher_no} names a voucher line that is not a line of that voucher`,
      })
      expect((await discard(other2.voucher.id)).statusCode).toBe(200)
      const { rows: [{ n: entries }] } = await sys.query(
        'SELECT count(*)::int AS n FROM finance.ledger_entry WHERE voucher_id = $1', [d.voucher.id])
      expect(entries).toBe(0)

      // Nothing was written: the draft still has its two lines.
      expect((await detail(d.voucher.id)).draft_balance.line_count).toBe(2)
      expect((await discard(d.voucher.id)).statusCode).toBe(200)
    } finally {
      const client = await sys.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL session_replication_role = 'replica'")
        await client.query('DELETE FROM finance.voucher_line WHERE voucher_id = $1', [foreign.bill || null])
        await client.query('DELETE FROM finance.voucher WHERE authority_id = $1', [other.id])
        await client.query('DELETE FROM finance.party WHERE authority_id = $1', [other.id])
        for (const table of ['budget_line', 'activity', 'programme', 'project', 'account', 'department']) {
          await client.query(`DELETE FROM finance.${table} WHERE authority_id = $1`, [other.id])
        }
        await client.query('DELETE FROM finance.ledger_account WHERE authority_id = $1', [other.id])
        await client.query('DELETE FROM finance.financial_year WHERE authority_id = $1', [other.id])
        await client.query('DELETE FROM public.local_authorities WHERE id = $1', [other.id])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    }
  })

  test('creating a draft is audited with its header, line count and totals', async () => {
    const d = await draftJournal('6.50', { voucher_no: `${TAG}-SOD-A1` })
    const [row] = await auditOf('voucher_drafted', d.voucher.id)
    expect(row).toMatchObject({ event: 'FIN_LEDGER_POST', severity: 'critical', actor_id: ids.accountant, status: 201 })
    expect(row.details).toMatchObject({
      voucher_no: `${TAG}-SOD-A1`, voucher_type: 'journal', currency: 'USD', financial_year_id: made.y2,
      posting_date: '1992-08-01', version: 1, line_count: 2, debit_total: '6.50', credit_total: '6.50',
    })
    expect((await discard(d.voucher.id)).statusCode).toBe(200)
    // Year 2 is left as Task 10 left it, with no draft in it.
    expect(await bankOfY2()).toBe('-434.00')
    expect(net(await balances(made.y2), made.expense)).toBe('2200.00')
    const { rows: [{ n }] } = await sys.query(
      "SELECT count(*)::int AS n FROM finance.voucher WHERE financial_year_id = $1 AND status = 'draft'", [made.y2])
    expect(n).toBe(0)
  })
})

// ══ B11: period readiness, the year end and the close ═════════════════════════════════════════
// From the accounting audit (M1, M2, M6, S10, S11, S12), the security audit (C2) and the ruling
// "B11 design" of 2026-11-17. The last block of the file: it closes year 2.
// Starts from B-SOD's state, derived from the blocks above: year 2 reads bank −434.00, income
// −401.00 (revenue 401.00), expense 2200.00, accumulated surplus −1500.00, with no draft in it and
// every period open. Years 1 and 3 have every period closed. The bank statement Task 9 imported is
// gone. Postings here, all in year 2:
//   - `${TAG}-B11-N1` Dr expense 1.00 / Cr bank 1.00 on 1992-08-01, and its reversal: net nil;
//   - `${TAG}-B11-D1` Dr expense 5.00 / Cr bank 5.00 on 1992-03-15;
//   - `${TAG}-B11-CP` Dr payable 7.00 / Cr bank 7.00 on 1992-09-10, and its reversal: net nil;
//   - `${TAG}-B11-INC` Dr bank 2000.00 / Cr income 2000.00 on 1992-11-15;
//   - `${TAG}-B11-EXP` Dr expense 300.00 / Cr bank 300.00 on 1992-11-20;
//   - `${TAG}-B11-LATE` Dr expense 30.00 / Cr income 30.00 on 1992-11-25, after the close is raised:
//     a reclassification, so the remainder it leaves nets to nil (review I1);
//   - two closings that stand: the first of revenue 2401.00 / expenditure 2505.00 (deficit 104.00),
//     the second of the 30.00 / 30.00 remainder, with no surplus line. One closing raised between
//     them is cancelled by its preparer, and two reversals of the second are cancelled.
// LEAVES (for any block added after this one): year 2 closed in USD, every period of year 2 closed,
// period 4 and period 12 LOCKED, so nothing more can post into year 2; no draft in year 2. Years 1
// and 3 have every period closed. The teardown removes it all.
describe('B11: period readiness, the year end and the close', () => {
  const waitForRows = async (sql, params) => {
    let rows = []
    for (let attempt = 0; attempt < 40; attempt += 1) {
      ({ rows } = await sys.query(sql, params))
      if (rows.length) return rows
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return rows
  }
  /** Audit rows of one period for one action, newest first (the hook writes after the reply). */
  const periodAudit = (action, periodId) => waitForRows(
    `SELECT event, severity, actor_id, status, details FROM public.admin_audit_event
      WHERE event = 'FIN_LEDGER' AND details->>'action' = $1 AND details->>'period_id' = $2
      ORDER BY occurred_at DESC, id DESC`, [action, periodId])
  const ids11 = {}
  /** The id of year 2's period `no`. */
  const periodOf = async (no) => (await sys.query(
    'SELECT id FROM finance.ledger_period WHERE financial_year_id = $1 AND period_no = $2', [made.y2, no])).rows[0].id
  const periodRow = async (no) => (await sys.query(
    `SELECT status, closed_by, closed_at IS NOT NULL AS closed_at_set, locked_by, locked_at IS NOT NULL AS locked_at_set
       FROM finance.ledger_period WHERE financial_year_id = $1 AND period_no = $2`, [made.y2, no])).rows[0]
  const setStatus = async (no, status, token = as.accountant) =>
    call('PATCH', `/finance/ledger/periods/${await periodOf(no)}`, token, { status })
  const readiness = async (no, token = as.accountant) => {
    const res = await call('GET', `/finance/accounting/period-readiness?period_id=${await periodOf(no)}`, token)
    if (res.statusCode !== 200) throw new Error(`readiness of period ${no} answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  const check = (r, key) => r.checks.find((c) => c.key === key)
  const WHOLE_BOOK = ['debtors_control', 'creditors_control']
  const outstanding = (r) => r.checks.filter((c) => !c.ok).map(({ key, count }) => (
    WHOLE_BOOK.includes(key) ? { key, count, scope: 'whole_book', as_at: r.as_at } : { key, count }))
  const todayIs = async () => (await sys.query('SELECT CURRENT_DATE::text AS d')).rows[0].d
  const periodsOfY2 = async (token = as.accountant) => {
    const res = await call('GET', `/finance/ledger/periods?financial_year_id=${made.y2}`, token)
    if (res.statusCode !== 200) throw new Error(`periods answered ${res.statusCode}: ${res.body}`)
    return res.json().data.periods
  }
  const closingSerial = async () => (await sys.query(
    "SELECT last_no FROM finance.document_sequence WHERE authority_id = $1 AND kind = 'closing'", [ids.authority])).rows[0].last_no
  const yearEnd = async (token = as.accountant) => {
    const res = await call('GET', `/finance/accounting/year-end?financial_year_id=${made.y2}`, token)
    if (res.statusCode !== 200) throw new Error(`year-end answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  const usdBook = async () => (await yearEnd()).books.find((b) => b.currency === 'USD')
  const raiseClose = (body = {}, token = as.accountant) => call('POST', '/finance/ledger/close-year', token,
    { financial_year_id: made.y2, currency: 'USD', ...body })
  /** A draft journal in year 2, prepared by the accountant. Returns the reply data. */
  const draftOn = async (date, lines, voucherNo) => {
    const res = await call('POST', '/finance/ledger/vouchers', as.accountant,
      { voucher_type: 'journal', currency: 'USD', financial_year_id: made.y2, posting_date: date, lines, voucher_no: voucherNo })
    if (res.statusCode !== 201) throw new Error(`draft ${voucherNo} was not created (${res.statusCode}): ${res.body}`)
    return res.json().data
  }
  // The checks that are about the month itself, as opposed to the two whole-book reconciliations.
  const PERIOD_KEYS = ['draft_vouchers', 'cashups_unverified', 'deposits_unposted', 'payables_awaiting',
    'depreciation_not_run', 'bank_statements_open', 'bank_not_reconciled']
  const yearLabel = `${TAG} Year 2`

  test('a reversal\'s reason is not another person\'s to change, and a post sent as anything but JSON is refused (B-SOD N1, N4)', async () => {
    const original = await draftOn('1992-08-01', pair('1.00'), `${TAG}-B11-N1`)
    expect((await postAs(as.director, original.voucher.id)).statusCode).toBe(200)
    const reversal = (await call('POST', `/finance/ledger/vouchers/${original.voucher.id}/reverse`, as.director,
      { reason: 'Withdrawn again by the B11 block.' })).json().data.reversal
    // N1: somebody other than its preparer is told it is not theirs, before anything about reasons.
    const other = await call('PATCH', `/finance/ledger/vouchers/${reversal.id}`, as.accountant, { narration: 'Another reason.' })
    expect(other.statusCode).toBe(403)
    expect(other.json()).toEqual({
      success: false, error: 'not_preparer',
      message: `Only the person who prepared voucher ${TAG}-B11-N1-R may change it. Copy it into a new draft of your own instead.`,
    })
    // N4: text/plain is parsed by Fastify, and refused by the route with 415; nothing is posted.
    const plain = await app.inject({ method: 'POST', url: `/api/finance/ledger/vouchers/${reversal.id}/post`,
      headers: { ...auth(as.accountant), 'content-type': 'text/plain' }, payload: '{"expected_version":1}' })
    expect(plain.statusCode).toBe(415)
    expect(plain.json()).toEqual({ success: false, error: 'unsupported_media_type', message: 'A posting is sent as JSON, or with no body at all.' })
    expect((await sys.query('SELECT status FROM finance.voucher WHERE id = $1', [reversal.id])).rows[0].status).toBe('draft')
    // Review M5: a media type Fastify has no parser for, and a schema refusal, come in the same shape.
    const xml = await app.inject({ method: 'POST', url: `/api/finance/ledger/vouchers/${reversal.id}/post`,
      headers: { ...auth(as.accountant), 'content-type': 'application/xml' }, payload: '<post/>' })
    expect(xml.statusCode).toBe(415)
    expect(xml.json()).toEqual({ success: false, error: 'unsupported_media_type', message: 'This is sent as JSON, or with no body at all.' })
    const badStatus = await call('PATCH', `/finance/ledger/periods/${await periodOf(1)}`, as.accountant, { status: 'frozen' })
    expect(badStatus.statusCode).toBe(400)
    expect(badStatus.json()).toEqual({ success: false, error: 'bad_request', message: expect.stringMatching(/^The request is not in the form this action takes: /) })
    expect((await postAs(as.accountant, reversal.id)).statusCode).toBe(200)
    expect(net(await balances(made.y2), made.bank)).toBe('-434.00')
  })

  test('readiness counts a draft dated in the period, and the check clears once it is posted (S12)', async () => {
    const d = await draftOn('1992-03-15', pair('5.00'), `${TAG}-B11-D1`)
    const r = await readiness(3)
    const { rows: [p3] } = await sys.query(
      `SELECT id, period_no, label, from_date::text AS from_date, to_date::text AS to_date, status
         FROM finance.ledger_period WHERE financial_year_id = $1 AND period_no = 3`, [made.y2])
    expect(r.period).toEqual(p3)
    expect(r.period).toMatchObject({ period_no: 3, from_date: '1992-03-01', to_date: '1992-03-31', status: 'open' })
    // The brief's keys in order, then the two control reconciliations (depreciation is listed only
    // when an asset in use exists, which this database may or may not hold).
    expect(r.checks.map((c) => c.key).filter((k) => k !== 'depreciation_not_run')).toEqual([
      'draft_vouchers', 'cashups_unverified', 'deposits_unposted', 'payables_awaiting',
      'bank_statements_open', 'bank_not_reconciled', 'debtors_control', 'creditors_control'])
    expect(check(r, 'draft_vouchers')).toEqual({
      key: 'draft_vouchers', label: 'Draft vouchers dated in the period', count: 1, ok: false,
      detail: '1 draft is dated in the period and not posted.', target: 'acc-journals',
    })
    for (const key of ['cashups_unverified', 'deposits_unposted', 'payables_awaiting', 'bank_statements_open']) {
      expect(check(r, key)).toMatchObject({ count: 0, ok: true, detail: null })
    }
    // RF2 (Cr bank 2000.00 on 1992-03-01) is in the period, and no reconciled statement matched it.
    expect(check(r, 'bank_not_reconciled')).toEqual({
      key: 'bank_not_reconciled', label: 'Bank accounts with entries no completed reconciliation has matched',
      count: 1, ok: false, detail: `${TAG}-1100 (USD): 1 entry`, target: 'acc-bank',
    })
    // Each book at the period end, from finance.ledger_balances: it balances.
    expect(r.books).toEqual([{ currency: 'USD', balances: true, difference: '0.00' }])
    // The two whole-book reconciliations are read as at today, and say so (review M1).
    expect(r.as_at).toBe(await todayIs())
    expect(check(r, 'debtors_control').label).toBe('Debtors ageing differs from the receivable control account (whole book, as at today)')
    expect(r.ready).toBe(false)

    expect((await postAs(as.director, d.voucher.id)).statusCode).toBe(200)
    const after = await readiness(3)
    expect(check(after, 'draft_vouchers')).toMatchObject({ count: 0, ok: true, detail: null })
    expect(check(after, 'bank_not_reconciled')).toMatchObject({ count: 1, detail: `${TAG}-1100 (USD): 2 entries` })
    expect(after.ready).toBe(false)
    // The readiness of another council's period, or of none, is not found.
    expect((await call('GET', `/finance/accounting/period-readiness?period_id=${crypto.randomUUID()}`, as.accountant)).statusCode).toBe(404)
    // The read needs the ledger.
    expect((await call('GET', `/finance/accounting/period-readiness?period_id=${await periodOf(3)}`, as.cashier)).statusCode).toBe(403)
  })

  test('closing a period records what was outstanding; reopening records who had closed it', async () => {
    const r3 = await readiness(3)
    const closed3 = await setStatus(3, 'closed')
    expect(closed3.statusCode).toBe(200)
    expect(closed3.json().data).toMatchObject({ period_no: 3, status: 'closed', from_date: '1992-03-01', to_date: '1992-03-31' })
    const [row] = await periodAudit('period_closed', await periodOf(3))
    expect(row).toMatchObject({ event: 'FIN_LEDGER', severity: 'high', actor_id: ids.accountant, status: 200 })
    expect(row.details).toMatchObject({ period_no: 3, financial_year_id: made.y2, from: 'open', to: 'closed' })
    expect(row.details.readiness).toEqual(outstanding(r3))
    expect(row.details.readiness).toContainEqual({ key: 'bank_not_reconciled', count: 1 })
    expect(await periodRow(3)).toMatchObject({ status: 'closed', closed_by: ids.accountant, closed_at_set: true })

    // A month with nothing in it: nothing about the month is outstanding.
    const r10 = await readiness(10)
    for (const key of PERIOD_KEYS) if (check(r10, key)) expect(check(r10, key)).toMatchObject({ count: 0, ok: true })
    expect((await setStatus(10, 'closed')).statusCode).toBe(200)
    const [row10] = await periodAudit('period_closed', await periodOf(10))
    expect(row10.details.readiness).toEqual(outstanding(r10))
    expect(row10.details.readiness.filter((o) => PERIOD_KEYS.includes(o.key))).toEqual([])

    // Closing what is closed changes nothing, and says so.
    const again = await setStatus(3, 'closed')
    expect(again.statusCode).toBe(409)
    expect(again.json()).toEqual({ success: false, error: 'no_change', message: 'Period 3 is already closed.' })

    // Reopen: allowed while the year is not closed; the row forgets the close, the audit keeps it.
    const reopened = await setStatus(3, 'open')
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json().data.status).toBe('open')
    expect(await periodRow(3)).toMatchObject({ status: 'open', closed_by: null, closed_at_set: false })
    const [back] = await periodAudit('period_reopened', await periodOf(3))
    expect(back.details).toMatchObject({ from: 'closed', to: 'open', previously_closed_by: ids.accountant })
    expect(back.details.previously_closed_at).toEqual(expect.any(String))
    expect(back.details.readiness).toBeUndefined()
  })

  test('a period is locked only from closed, keeps who closed it, and the last one waits for the year end (S11)', async () => {
    const early = await setStatus(4, 'locked')
    expect(early.statusCode).toBe(409)
    expect(early.json()).toEqual({
      success: false, error: 'lock_needs_close',
      message: 'Period 4 is open. Close it first: a period is locked only once it is closed, so what was '
        + 'outstanding when it closed is on the record.',
    })
    expect((await periodRow(4)).status).toBe('open')
    const [refused] = await periodAudit('period_change_refused', await periodOf(4))
    expect(refused.details).toMatchObject({ from: 'open', to: 'locked', reason: 'lock_needs_close' })

    expect((await setStatus(4, 'closed')).statusCode).toBe(200)
    const locked = await setStatus(4, 'locked')
    expect(locked.statusCode).toBe(200)
    expect(locked.json().data.status).toBe('locked')
    // Who closed it is kept; who locked it is added.
    expect(await periodRow(4)).toEqual({
      status: 'locked', closed_by: ids.accountant, closed_at_set: true, locked_by: ids.accountant, locked_at_set: true,
    })
    const [lockRow] = await periodAudit('period_locked', await periodOf(4))
    expect(lockRow.details).toMatchObject({ from: 'closed', to: 'locked' })
    expect(Array.isArray(lockRow.details.readiness)).toBe(true)
    for (const next of ['open', 'closed', 'locked']) {
      const res = await setStatus(4, next)
      expect(res.statusCode).toBe(409)
      expect(res.json().error).toBe('period_locked')
    }

    // The last period of a year whose book still has revenue and expenditure is not locked.
    expect((await setStatus(12, 'closed')).statusCode).toBe(200)
    const last = await setStatus(12, 'locked')
    expect(last.statusCode).toBe(409)
    expect(last.json()).toEqual({
      success: false, error: 'year_not_closed',
      message: `Period 12 is the last of ${yearLabel}, and the USD book still has revenue or expenditure to close. `
        + 'Close the year first: once the last period is locked, no closing can be posted into it.',
    })
    expect((await periodRow(12)).status).toBe('closed')

    // The periods list sends what each would be told, from the PATCH's own rule (frontend ask 1).
    const listed = await periodsOfY2()
    const row = (no) => listed.find((p) => p.period_no === no)
    expect(row(12)).toMatchObject({
      is_final: true, status: 'closed', reopen_refusal: null,
      lock_refusal: { error: 'year_not_closed', message: last.json().message },
    })
    expect(row(4)).toMatchObject({ is_final: false, lock_refusal: { error: 'period_locked' }, reopen_refusal: { error: 'period_locked' } })
    expect(row(5)).toMatchObject({ is_final: false, status: 'open', lock_refusal: { error: 'lock_needs_close' } })
    expect(row(10)).toMatchObject({ status: 'closed', lock_refusal: null, reopen_refusal: null })
  })

  test('readiness reconciles the debtors and the creditors to their control accounts (S12)', async () => {
    // Debtors: the same comparison as the debtor ageing's own reconciliation, so the two agree.
    const ageing = await call('GET', '/finance/ledger/debtor-ageing?limit=1', as.accountant)
    expect(ageing.statusCode).toBe(200)
    const disagree = ageing.json().data.reconciliation.filter((x) => !x.agrees).map((x) => x.currency)
    const r = await readiness(9)
    expect(check(r, 'debtors_control')).toMatchObject({ count: disagree.length, ok: disagree.length === 0, target: 'acc-receivable' })
    for (const c of disagree) expect(check(r, 'debtors_control').detail).toContain(`${c}: the ageing less the control is`)

    // Creditors, read independently from the entries: the open items less the payable control.
    const creditorGap = async () => (await sys.query(
      `SELECT (COALESCE((SELECT sum(c.outstanding_amount) FROM finance.v_creditor_open c
                          WHERE c.authority_id = $1 AND c.currency::text = 'USD'), 0)
               - COALESCE((SELECT sum(e.credit - e.debit) FROM finance.ledger_entry e
                             JOIN finance.ledger_account la ON la.id = e.ledger_account_id
                            WHERE la.account_type = 'payable' AND la.deleted_at IS NULL
                              AND la.authority_id = $1 AND e.authority_id = $1 AND e.currency::text = 'USD'), 0)
              )::numeric(18,2)::text AS gap`, [ids.authority])).rows[0].gap
    const usdLine = (rr) => (check(rr, 'creditors_control').detail || '').split('; ').find((x) => x.startsWith('USD:'))
    const before = await creditorGap()
    expect(usdLine(r)).toBe(before === '0.00' ? undefined : `USD: the open items less the control is ${before}`)

    // A debit to the payable control that settles nothing: the control falls by 7.00, and no open
    // item moves. The readiness says so, to the cent.
    const { rows: [payable] } = await sys.query('SELECT id FROM finance.ledger_account WHERE code = $1', [`${TAG}-2200`])
    const cp = await draftOn('1992-09-10',
      [{ ledger_account_id: payable.id, debit: '7.00' }, { ledger_account_id: made.bank, credit: '7.00' }], `${TAG}-B11-CP`)
    expect((await postAs(as.director, cp.voucher.id)).statusCode).toBe(200)
    const { rows: [{ expected }] } = await sys.query("SELECT ($1::numeric + 7)::numeric(18,2)::text AS expected", [before])
    expect(await creditorGap()).toBe(expected)
    const skewed = await readiness(9)
    // The bank side of it is in September and not matched by any statement.
    expect(check(skewed, 'bank_not_reconciled')).toMatchObject({ count: 1, detail: `${TAG}-1100 (USD): 1 entry` })
    expect(check(skewed, 'creditors_control').ok).toBe(false)
    expect(usdLine(skewed)).toBe(`USD: the open items less the control is ${expected}`)
    expect(skewed.ready).toBe(false)

    // Reversed again (prepared by the Director, posted by the accountant): back as it was.
    const rev = (await call('POST', `/finance/ledger/vouchers/${cp.voucher.id}/reverse`, as.director,
      { reason: 'A payable debit that settled nothing.' })).json().data.reversal
    expect((await postAs(as.accountant, rev.id)).statusCode).toBe(200)
    expect(await creditorGap()).toBe(before)
    const restored = await readiness(9)
    expect(usdLine(restored)).toBe(usdLine(r))
    // A posting and its reversal both in the month cancel; no statement will show either (review M2).
    expect(check(restored, 'bank_not_reconciled')).toMatchObject({ count: 0, ok: true, detail: null })
    expect(net(await balances(made.y2), made.bank)).toBe('-439.00') // −434.00 less D1's 5.00
  })

  test('the year end of year 2: what is open, the result of the book, and who may post the closing (C2)', async () => {
    const ye = await yearEnd()
    expect(ye.year).toEqual({ id: made.y2, label: yearLabel, start_date: '1992-01-01', end_date: '1992-12-31', status: 'open' })
    // Periods 4 (locked), 10 and 12 (closed) are not open; the other nine are.
    expect(ye.periods_open).toBe(9)
    expect(ye.books).toEqual([{
      currency: 'USD', closed: false, revenue: '401.00', expenditure: '2205.00', surplus: '1804.00',
      side: 'deficit', closing_voucher: null, pending_closing: null, to_close: true,
    }])
    expect(ye.surplus_account).toEqual({ id: made.surplus, code: `${TAG}-3000`, name: 'Accounting test accumulated surplus' })
    // Who may post a closing the accountant raises: this council's posters, never the accountant.
    expect(ye.posters.map((p) => p.id)).toContain(ids.director)
    expect(ye.posters.map((p) => p.id)).not.toContain(ids.accountant)
    for (const p of ye.posters) expect(p).toEqual({ id: expect.any(String), name: expect.any(String) })
    const { rows: foreign } = await sys.query(
      'SELECT count(*)::int AS n FROM public.users WHERE id = ANY($1::uuid[]) AND authority_id IS DISTINCT FROM $2',
      [ye.posters.map((p) => p.id), ids.authority])
    expect(foreign[0].n).toBe(0)
    const asDirector = await yearEnd(as.director)
    expect(asDirector.posters.map((p) => p.id)).toContain(ids.accountant)
    expect(asDirector.posters.map((p) => p.id)).not.toContain(ids.director)

    // Raised while a period is open: refused, naming them.
    const early = await raiseClose()
    expect(early.statusCode).toBe(409)
    expect(early.json()).toEqual({
      success: false, error: 'periods_open',
      message: `Every period of ${yearLabel} must be closed before its year end; still open: 1, 2, 3, 5, 6, 7, 8, 9, 11.`,
    })
    // Who may raise it, and read it.
    expect((await raiseClose({}, as.cashier)).statusCode).toBe(403)
    expect((await raiseClose({}, as.auditor)).statusCode).toBe(403)
    expect((await call('GET', `/finance/accounting/year-end?financial_year_id=${made.y2}`, as.cashier)).statusCode).toBe(403)
    expect((await call('GET', `/finance/accounting/year-end?financial_year_id=${crypto.randomUUID()}`, as.accountant)).statusCode).toBe(404)

    // From a deficit to a surplus, and back.
    await journal(made.y2, '1992-11-15',
      [{ ledger_account_id: made.bank, debit: '2000.00' }, { ledger_account_id: made.income, credit: '2000.00' }],
      { voucher_no: `${TAG}-B11-INC` })
    expect(await usdBook()).toMatchObject({ revenue: '2401.00', expenditure: '2205.00', surplus: '196.00', side: 'surplus' })
    await journal(made.y2, '1992-11-20', pair('300.00'), { voucher_no: `${TAG}-B11-EXP` })
    expect(await usdBook()).toMatchObject({ revenue: '2401.00', expenditure: '2505.00', surplus: '104.00', side: 'deficit', closed: false })
  })

  test('the close is dated the year end, raised as a draft, and posted by somebody else into the closed final period (M1, M2, S10)', async () => {
    await closeAllPeriods(made.y2)
    expect((await yearEnd()).periods_open).toBe(0)
    const closings = async () => (await sys.query(
      "SELECT count(*)::int AS n FROM finance.voucher WHERE financial_year_id = $1 AND voucher_type = 'closing'", [made.y2])).rows[0].n

    // S10: any other date is refused, and nothing is written.
    const misdated = await raiseClose({ posting_date: '1992-06-30' })
    expect(misdated.statusCode).toBe(400)
    expect(misdated.json()).toEqual({
      success: false, error: 'bad_date', message: 'A year-end closing is dated the last day of the year, 1992-12-31, not 1992-06-30.',
    })
    // A number typed as spaces is not a number (review M4).
    const blank = await raiseClose({ voucher_no: '   ' })
    expect(blank.statusCode).toBe(400)
    expect(blank.json()).toEqual({
      success: false, error: 'bad_number',
      message: 'A typed voucher number cannot be blank. Leave it out to have one issued from the YC series.',
    })
    expect(await closings()).toBe(0)

    // Raised by the accountant, numbered from the YC series, as a draft. Nobody is named to post it.
    const raised = await raiseClose({ posting_date: '1992-12-31' })
    expect(raised.statusCode).toBe(201)
    const yc1 = raised.json().data.closing_voucher
    ids11.yc1 = yc1
    expect(yc1).toMatchObject({ currency: 'USD', posting_date: '1992-12-31', status: 'draft', entries: 0, version: 1 })
    expect(yc1.voucher_no).toMatch(/^YC-\d{7}$/)
    expect(raised.json().data.awaiting_post).toBe(true)
    expect(raised.json().data.note).toMatch(new RegExp(`^Closing voucher ${yc1.voucher_no} is a draft\\. It changes nothing until somebody other than you posts it`))
    expect(raised.json().data.note).toMatch(/Next: ask a colleague who may post vouchers to post it from To post\./)
    const { rows: [header] } = await sys.query(
      'SELECT voucher_type, prepared_by, posted_by, status FROM finance.voucher WHERE id = $1', [yc1.id])
    expect(header).toEqual({ voucher_type: 'closing', prepared_by: ids.accountant, posted_by: null, status: 'draft' })
    const { rows: lines } = await sys.query(
      `SELECT ledger_account_id, debit::numeric(18,2)::text AS debit, credit::numeric(18,2)::text AS credit
         FROM finance.voucher_line WHERE voucher_id = $1 ORDER BY line_no`, [yc1.id])
    expect(lines).toHaveLength(3)
    expect(lines).toEqual(expect.arrayContaining([
      { ledger_account_id: made.income, debit: '2401.00', credit: '0.00' },
      { ledger_account_id: made.expense, debit: '0.00', credit: '2505.00' },
    ]))
    expect(lines[2]).toEqual({ ledger_account_id: made.surplus, debit: '104.00', credit: '0.00' }) // the deficit
    const [drafted] = await waitForRows(
      `SELECT event, actor_id, details FROM public.admin_audit_event
        WHERE event = 'FIN_LEDGER_POST' AND details->>'action' = 'closing_drafted' AND details->>'voucher_id' = $1`, [yc1.id])
    expect(drafted).toMatchObject({ actor_id: ids.accountant })
    expect(drafted.details).toMatchObject({
      voucher_no: yc1.voucher_no, financial_year_id: made.y2, currency: 'USD', posting_date: '1992-12-31',
      line_count: 3, debit_total: '2505.00', credit_total: '2505.00',
    })
    expect(await closed(made.y2)).toBe(false)
    expect(await usdBook()).toMatchObject({
      closed: false, to_close: true, closing_voucher: null, pending_closing: { id: yc1.id, voucher_no: yc1.voucher_no },
    })
    // Who may post it: never its preparer, whoever is asking (review M6).
    expect((await yearEnd(as.director)).posters.map((p) => p.id)).not.toContain(ids.accountant)
    // Its preparer may discard it; nobody else may (frontend ask 4).
    const detailOf = async (token) => (await call('GET', `/finance/ledger/vouchers/${yc1.id}`, token)).json().data
    expect((await detailOf(as.accountant)).may_discard).toBe(true)
    expect((await detailOf(as.director)).may_discard).toBe(false)

    // One closing of a book waits at a time; its lines and date are not edited by hand.
    const second = await raiseClose()
    expect(second.statusCode).toBe(409)
    expect(second.json()).toEqual({
      success: false, error: 'closing_pending',
      message: `The USD book of ${yearLabel} already has a closing, ${yc1.voucher_no}, waiting to be posted. `
        + 'Have it posted from the To post queue, or discard it and raise the close again.',
    })
    const edited = await call('PATCH', `/finance/ledger/vouchers/${yc1.id}`, as.accountant, { narration: 'Edited by hand' })
    expect(edited.statusCode).toBe(409)
    expect(edited.json().error).toBe('closing_voucher')
    // Somebody else is told first that it is not theirs (review M10 d).
    const othersEdit = await call('PATCH', `/finance/ledger/vouchers/${yc1.id}`, as.director, { narration: 'Edited by hand' })
    expect(othersEdit.statusCode).toBe(403)
    expect(othersEdit.json().error).toBe('not_preparer')
    // Its preparer cannot post it.
    const own = await postAs(as.accountant, yc1.id)
    expect(own.statusCode).toBe(409)
    expect(own.json().error).toBe('separation_of_duties')

    // A late posting arrives before the closing is posted: period 11 is reopened (the year is not
    // closed yet). While it is open the closing is not posted; the late posting is a
    // reclassification (Dr expense / Cr income), and period 11 is closed again.
    expect((await setStatus(11, 'open')).statusCode).toBe(200)
    const whileOpen = await postAs(as.director, yc1.id)
    expect(whileOpen.statusCode).toBe(409)
    expect(whileOpen.json()).toEqual({
      success: false, error: 'periods_open',
      message: `Every period of ${yearLabel} must be closed before its year-end closing is posted; still open: 11.`,
    })
    await journal(made.y2, '1992-11-25',
      [{ ledger_account_id: made.expense, debit: '30.00' }, { ledger_account_id: made.income, credit: '30.00' }],
      { voucher_no: `${TAG}-B11-LATE` })
    expect((await setStatus(11, 'closed')).statusCode).toBe(200)

    // A LOCKED final period takes nothing, a closing included. (Locked by hand here, as a database
    // from before this guard might hold it; the route itself refuses that lock, above.)
    const p12 = await periodOf(12)
    await sys.query("UPDATE finance.ledger_period SET status = 'locked' WHERE id = $1", [p12])
    try {
      const intoLocked = await postAs(as.director, yc1.id)
      expect(intoLocked.statusCode).toBe(409)
      expect(intoLocked.json()).toMatchObject({ error: 'period_not_open', message: 'accounting period 12 is locked and accepts no postings' })
      // A close raised then is refused before anything is written (the waiting draft aside).
      const raisedLocked = await raiseClose()
      expect(raisedLocked.statusCode).toBe(409)
      expect(raisedLocked.json()).toEqual({
        success: false, error: 'final_period_locked',
        message: `Period 12 of ${yearLabel} is locked, so no year-end closing can be posted into it. `
          + 'A locked period is final: correct this book in the next year.',
      })
    } finally {
      await sys.query("UPDATE finance.ledger_period SET status = 'closed' WHERE id = $1", [p12])
    }

    // Every other voucher stays out of the closed final period.
    const ordinary = await draftOn('1992-12-15', pair('1.00'), `${TAG}-B11-DEC`)
    const refused = await postAs(as.director, ordinary.voucher.id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: 'period_not_open', message: 'accounting period 12 is closed and accepts no postings' })
    expect((await call('DELETE', `/finance/ledger/vouchers/${ordinary.voucher.id}`, as.accountant)).statusCode).toBe(200)

    // Somebody else posts the closing, into the closed final period.
    const posted = await postAs(as.director, yc1.id)
    expect(posted.statusCode).toBe(200)
    expect(posted.json().data).toMatchObject({ posted: yc1.voucher_no, entries: 3 })
    const { rows: [done] } = await sys.query(
      `SELECT v.prepared_by, v.posted_by, v.status, lp.period_no, lp.status AS period_status
         FROM finance.voucher v JOIN finance.ledger_period lp ON lp.id = v.ledger_period_id WHERE v.id = $1`, [yc1.id])
    expect(done).toEqual({ prepared_by: ids.accountant, posted_by: ids.director, status: 'posted', period_no: 12, period_status: 'closed' })
    expect(await closed(made.y2)).toBe(true)
    // The late reclassification is left: 30.00 of revenue and 30.00 of expenditure, netting to nil,
    // still on two accounts. The book stands closed by YC1 with a remainder to close.
    expect(await usdBook()).toEqual({
      currency: 'USD', closed: false, to_close: true, revenue: '30.00', expenditure: '30.00', surplus: '0.00', side: 'surplus',
      closing_voucher: { id: yc1.id, voucher_no: yc1.voucher_no }, pending_closing: null,
    })
  })

  test('a remainder is closed on its own, nothing left is refused, and a closed year is not reopened (M6, the ruling)', async () => {
    const yc1 = ids11.yc1
    // The last period waits for the remainder.
    expect((await setStatus(12, 'locked')).json().error).toBe('year_not_closed')
    // No period reopens while a closing stands; with a remainder left it is worded as one.
    const reopen = await setStatus(5, 'open')
    expect(reopen.statusCode).toBe(409)
    expect(reopen.json()).toEqual({
      success: false, error: 'year_closed',
      message: `A remainder is left in the USD book of ${yearLabel} after ${yc1.voucher_no}. Reverse the year-end closing first.`,
    })
    expect((await periodRow(5)).status).toBe('closed')

    // The ruling on discards: the preparer of a CLOSING draft may discard it holding
    // finance.ledger.close_year alone. Here the accountant's voucher.prepare is denied for a moment.
    const keep = await draftOn('1992-12-20', pair('1.00'), `${TAG}-B11-DENY`)
    const firstTry = await raiseClose()
    expect(firstTry.statusCode).toBe(201)
    const discarded = firstTry.json().data.closing_voucher
    await sys.query(
      `INSERT INTO finance.user_permission_override (user_id, permission_code, effect, authority_id, reason, granted_by)
       VALUES ($1, 'finance.ledger.voucher.prepare', 'deny', $2, $3, $4)`,
      [ids.accountant, ids.authority, `${TAG} B11 discard test`, ids.director])
    try {
      expect((await call('GET', `/finance/ledger/vouchers/${discarded.id}`, as.accountant)).json().data.may_discard).toBe(true)
      expect((await call('GET', `/finance/ledger/vouchers/${keep.voucher.id}`, as.accountant)).json().data.may_discard).toBe(false)
      const gone = await call('DELETE', `/finance/ledger/vouchers/${discarded.id}`, as.accountant)
      expect(gone.statusCode).toBe(200)
      expect(gone.json().data).toMatchObject({ status: 'cancelled' })
      const notThis = await call('DELETE', `/finance/ledger/vouchers/${keep.voucher.id}`, as.accountant)
      expect(notThis.statusCode).toBe(403)
      expect(notThis.json()).toEqual({ success: false, error: 'forbidden', message: 'You do not hold the permission this action requires.' })
    } finally {
      await sys.query(
        "DELETE FROM finance.user_permission_override WHERE user_id = $1 AND permission_code = 'finance.ledger.voucher.prepare'",
        [ids.accountant])
    }
    expect((await call('DELETE', `/finance/ledger/vouchers/${keep.voucher.id}`, as.accountant)).statusCode).toBe(200)

    // The second close takes the remainder only. It nets to nil, so it has NO surplus line (review
    // I1): two lines that balance on their own. The cancelled one keeps its number, so this is +2.
    const raised = await raiseClose()
    expect(raised.statusCode).toBe(201)
    const yc2 = raised.json().data.closing_voucher
    expect(BigInt(yc2.voucher_no.slice(3)) - BigInt(yc1.voucher_no.slice(3))).toBe(2n)
    expect(BigInt(discarded.voucher_no.slice(3)) - BigInt(yc1.voucher_no.slice(3))).toBe(1n)
    const { rows: lines } = await sys.query(
      `SELECT ledger_account_id, debit::numeric(18,2)::text AS debit, credit::numeric(18,2)::text AS credit
         FROM finance.voucher_line WHERE voucher_id = $1 ORDER BY line_no`, [yc2.id])
    expect(lines).toHaveLength(2)
    expect(lines).toEqual(expect.arrayContaining([
      { ledger_account_id: made.income, debit: '30.00', credit: '0.00' },
      { ledger_account_id: made.expense, debit: '0.00', credit: '30.00' },
    ]))
    expect((await postAs(as.director, yc2.id)).json().data).toMatchObject({ posted: yc2.voucher_no, entries: 2 })

    // Closed: the whole year's result, before closing, and the closing that stands last.
    expect(await usdBook()).toEqual({
      currency: 'USD', closed: true, to_close: false, revenue: '2431.00', expenditure: '2535.00', surplus: '104.00', side: 'deficit',
      closing_voucher: { id: yc2.id, voucher_no: yc2.voucher_no }, pending_closing: null,
    })
    const after = await balances(made.y2)
    expect(net(after, made.income)).toBeUndefined()
    expect(net(after, made.expense)).toBeUndefined()
    expect(net(after, made.surplus)).toBe('-1396.00') // −1500.00 carried, less the 104.00 deficit
    expect(await sumNet(made.y2)).toBe('0.00')
    const before = await balances(made.y2, null, 'before')
    expect(net(before, made.income)).toBe('-2431.00') // 401.00 + 2000.00 + 30.00
    expect(net(before, made.expense)).toBe('2535.00') // 2200.00 + 5.00 + 300.00 + 30.00
    expect(net(before, made.surplus)).toBe('-1500.00')

    // Nothing left: refused, and no number is used up (review M10 c).
    const serialBefore = await closingSerial()
    const nothing = await raiseClose()
    expect(nothing.statusCode).toBe(409)
    expect(nothing.json()).toEqual({
      success: false, error: 'nothing_to_close', message: `The USD book of ${yearLabel} has no revenue or expense balance to close.`,
    })
    expect(await closingSerial()).toBe(serialBefore)
    const reopenLast = await setStatus(12, 'open')
    expect(reopenLast.json()).toEqual({
      success: false, error: 'year_closed',
      message: `The USD book of ${yearLabel} is closed by ${yc1.voucher_no} and ${yc2.voucher_no}. Reverse the year-end closing first.`,
    })

    // A reversal of the closing waiting: the last period is not locked under it (review M8).
    const rev = (await call('POST', `/finance/ledger/vouchers/${yc2.id}/reverse`, as.director,
      { reason: 'Raised to show the lock waits for it.' })).json().data.reversal
    const blocked = await setStatus(12, 'locked')
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toEqual({
      success: false, error: 'closing_reversal_pending',
      message: 'Period 12 is the last of ' + yearLabel + ', and a reversal of its year-end closing is waiting to be posted. '
        + 'Have it posted, or discard it, first: once the last period is locked it could never be posted.',
    })
    expect((await periodsOfY2()).find((p) => p.period_no === 12).lock_refusal).toEqual({
      error: 'closing_reversal_pending', message: blocked.json().message,
    })
    expect((await call('DELETE', `/finance/ledger/vouchers/${rev.id}`, as.director)).statusCode).toBe(200)

    // With the book closed and nothing waiting, the last period may be locked, which is final.
    expect((await periodsOfY2()).find((p) => p.period_no === 12)).toMatchObject({ lock_refusal: null })
    const locked = await setStatus(12, 'locked')
    expect(locked.statusCode).toBe(200)
    expect(await periodRow(12)).toMatchObject({ status: 'locked', closed_by: ids.accountant, locked_by: ids.accountant })

    // A reversal of the closing raised now cannot be posted into the locked period (review M10 b).
    const late = (await call('POST', `/finance/ledger/vouchers/${yc2.id}/reverse`, as.director,
      { reason: 'Raised after the lock, to show it is refused.' })).json().data.reversal
    const intoLocked = await postAs(as.accountant, late.id)
    expect(intoLocked.statusCode).toBe(409)
    expect(intoLocked.json()).toMatchObject({ error: 'period_not_open', message: 'accounting period 12 is locked and accepts no postings' })
    expect((await call('DELETE', `/finance/ledger/vouchers/${late.id}`, as.director)).statusCode).toBe(200)
    expect(await closed(made.y2)).toBe(true)

    const { rows: [{ n }] } = await sys.query(
      "SELECT count(*)::int AS n FROM finance.voucher WHERE financial_year_id = $1 AND status = 'draft'", [made.y2])
    expect(n).toBe(0)
  })

  // THE RACE THE LOCKS CLOSE (review I2), not shown here because this suite runs one request at a
  // time. A lock of period 12 read "nothing to close" while a reversal of the closing was being
  // posted into it; both committed, and period 12 was locked over a year that was no longer closed,
  // for good. Now the PATCH takes the period row FOR UPDATE (and, for a reopen, the final period)
  // before it reads anything, and a closing or its reversal takes the final period FOR SHARE (the
  // post route, and finance.validate_ledger_entry for any writer). Whichever comes second waits for
  // the first to commit and then reads what it left: the lock sees the reversal and is refused, or
  // the reversal sees the lock and is refused. Proving it needs two connections held open at once.
})

// ══ B12: the statements (accounting audit M7, S13, S14) ══════════════════════════════════════
// Every year is closed by the blocks above, and every period of years 1 to 3 is closed (year 2's
// last is locked). To post fresh figures this block reopens year 3's period 3 (March 1993) BY HAND
// through the system connection, as the B11 block locks period 12 by hand, and closes it again in
// its afterAll. Postings into March 1993 leave a remainder in year 3 after its closing, which is
// what the position's surplus-to-date rule must show. Figures that depend on the blocks above are
// derived here in SQL from finance.ledger_balances / finance.ledger_entry, never in JavaScript, and
// never assumed (review m7). The LAST test makes a fifth year, 1990, left unclosed, to produce the
// earlier-years row (review I3); nothing after it reads a figure it would disturb.
describe('B12: the statements', () => {
  const ids12 = {}
  const qs = (query) => (query ? `?${new URLSearchParams(query)}` : '')
  const get = async (path, query, token = as.accountant) => {
    const res = await call('GET', `${path}${qs(query)}`, token)
    if (res.statusCode !== 200) throw new Error(`GET ${path} answered ${res.statusCode}: ${res.body}`)
    return res.json().data
  }
  const one = async (sql, params) => (await sys.query(sql, params)).rows[0]
  const y3Label = `${TAG} Year 3`
  const setMarch = (status) => sys.query(
    'UPDATE finance.ledger_period SET status = $2 WHERE financial_year_id = $1 AND period_no = 3', [made.y3, status])

  beforeAll(async () => {
    ids12.bankB = await account('1300', 'Accounting test second bank', 'asset', 'bank')
    ids12.plant = await account('1600', 'Accounting test plant', 'asset', 'fixed_asset')
    // Task 10 already created the creditors control `${TAG}-2200`, and a code may not be reused:
    // the statements read that same account, the way B11 looked it up.
    ids12.creditors = (await one('SELECT id FROM finance.ledger_account WHERE code = $1', [`${TAG}-2200`]))?.id
    if (!ids12.creditors) throw new Error('the creditors control account Task 10 created is missing')
    ids12.fees = await account('4100', 'Accounting test fees', 'revenue')
    await setMarch('open')
    // An opening balance dated in the range: part of the opening figure, never a receipt.
    await journal(made.y3, '1993-03-01',
      [{ ledger_account_id: ids12.bankB, debit: '50.00' }, { ledger_account_id: made.surplus, credit: '50.00' }],
      { voucher_type: 'opening', voucher_no: `${TAG}-B12-OB`, narration: 'Second bank opened' })
    // A compound receipt into two banks: two cash lines, two counter-sides.
    await journal(made.y3, '1993-03-05', [
      { ledger_account_id: made.bank, debit: '333.33' }, { ledger_account_id: ids12.bankB, debit: '666.67' },
      { ledger_account_id: ids12.fees, credit: '900.00' }, { ledger_account_id: made.tax, credit: '100.00' },
    ], { voucher_no: `${TAG}-B12-RCPT` })
    // A transfer between the council's own banks.
    await journal(made.y3, '1993-03-10',
      [{ ledger_account_id: ids12.bankB, debit: '200.00' }, { ledger_account_id: made.bank, credit: '200.00' }],
      { voucher_no: `${TAG}-B12-TRF` })
    // Plant bought: the register holds no asset for it.
    ids12.ppe = await journal(made.y3, '1993-03-15',
      [{ ledger_account_id: ids12.plant, debit: '450.00' }, { ledger_account_id: ids12.bankB, credit: '450.00' }],
      { voucher_no: `${TAG}-B12-PPE` })
    // Cash lines on both sides: net 100.00 in.
    await journal(made.y3, '1993-03-20', [
      { ledger_account_id: made.bank, debit: '120.00' }, { ledger_account_id: ids12.bankB, credit: '20.00' },
      { ledger_account_id: ids12.fees, credit: '100.00' },
    ], { voucher_no: `${TAG}-B12-MIX` })
    // The ZWG book: one receipt, which no USD figure may include.
    await journal(made.y3, '1993-03-22',
      [{ ledger_account_id: made.bank, debit: '500.00' }, { ledger_account_id: ids12.fees, credit: '500.00' }],
      { voucher_no: `${TAG}-B12-ZWG`, currency: 'ZWG' })
    // A payment with tax withheld (review I1): 900.00 leaves the bank against a 1,000.00 creditor.
    await journal(made.y3, '1993-03-25', [
      { ledger_account_id: ids12.creditors, debit: '1000.00' }, { ledger_account_id: made.bank, credit: '900.00' },
      { ledger_account_id: made.tax, credit: '100.00' },
    ], { voucher_no: `${TAG}-B12-WHT` })
  })

  afterAll(async () => {
    await setMarch('closed')
  })

  const cash = (from, to) => get('/finance/ledger/statements/cash', { financial_year_id: made.y3, from, to })
  const book = (list, cur = 'USD') => list.filter((r) => r.currency === cur)
  const acct = (statement, id, cur = 'USD') => statement.accounts.find((a) => a.id === id && a.currency === cur)
  /**
   * One account's (or, with no account, the whole book's) opening and closing for a range, from the
   * entries themselves: opening = everything before `from` plus opening-balance vouchers dated in the
   * range; closing = everything to `to`.
   */
  const cashSpan = (from, to, accountId = null, cur = 'USD') => one(
    `SELECT COALESCE(sum(e.debit - e.credit) FILTER (WHERE e.posting_date < $1::date OR e.voucher_type = 'opening'), 0)::numeric(18,2)::text AS opening,
            COALESCE(sum(e.debit - e.credit), 0)::numeric(18,2)::text AS closing
       FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id
      WHERE e.authority_id = $3 AND la.account_type IN ('bank', 'cash') AND e.currency::text = $5
        AND e.posting_date <= $2::date AND ($4::uuid IS NULL OR e.ledger_account_id = $4::uuid)`,
    [from, to, ids.authority, accountId, cur])

  test('the cash statement: accounts keep transfers, the book leaves them out, and the analysis agrees', async () => {
    const s = await cash('1993-03-01', '1993-03-24')
    expect(s).toMatchObject({ from: '1993-03-01', to: '1993-03-24' })
    expect(s.note).toMatch(/^This is a statement of cash receipts and payments\. It is not a cash flow statement under IPSAS 2/)

    const bank = await cashSpan('1993-03-01', '1993-03-24', made.bank)
    expect(acct(s, made.bank)).toEqual({
      id: made.bank, code: `${TAG}-1100`, name: 'Accounting test bank', currency: 'USD',
      opening: bank.opening, receipts: '453.33', payments: '200.00', closing: bank.closing, agrees: true,
    })
    // 50.00 opening (the opening voucher), + 666.67 + 200.00 in, − 450.00 − 20.00 out.
    expect(acct(s, ids12.bankB)).toEqual({
      id: ids12.bankB, code: `${TAG}-1300`, name: 'Accounting test second bank', currency: 'USD',
      opening: '50.00', receipts: '866.67', payments: '470.00', closing: '446.67', agrees: true,
    })

    // The book: 1000.00 + 100.00 in, 450.00 out; the 200.00 transfer and the 20.00 moved inside the
    // mixed voucher are not receipts or payments of the book.
    const whole = await cashSpan('1993-03-01', '1993-03-24')
    expect(book(s.books)).toEqual([{ currency: 'USD', opening: whole.opening, receipts: '1100.00', payments: '450.00', closing: whole.closing }])
    expect(book(s.by_counter)).toEqual([
      { currency: 'USD', group: 'revenue', label: 'Revenue', inflow: '1000.00', outflow: '0.00', net: '1000.00' },
      { currency: 'USD', group: 'tax', label: 'Taxes', inflow: '100.00', outflow: '0.00', net: '100.00' },
      { currency: 'USD', group: 'fixed_asset', label: 'Property, plant and equipment', inflow: '0.00', outflow: '450.00', net: '-450.00' },
    ])
    expect(book(s.reconciles)).toEqual([{ currency: 'USD', movement: '650.00', analysed: '650.00', agrees: true }])
  })

  test('tax withheld from a payment: the outflows add up to the payment, with the tax negative (review I1)', async () => {
    const s = await cash('1993-03-25', '1993-03-25')
    expect(acct(s, made.bank)).toMatchObject({ receipts: '0.00', payments: '900.00', agrees: true })
    expect(book(s.books)[0]).toMatchObject({ receipts: '0.00', payments: '900.00' })
    expect(book(s.by_counter)).toEqual([
      { currency: 'USD', group: 'payable', label: 'Creditors', inflow: '0.00', outflow: '1000.00', net: '-1000.00' },
      { currency: 'USD', group: 'tax', label: 'Taxes', inflow: '0.00', outflow: '-100.00', net: '100.00' },
    ])
    expect(book(s.reconciles)).toEqual([{ currency: 'USD', movement: '-900.00', analysed: '-900.00', agrees: true }])

    // Over the month the inflows tie to the receipts and the outflows to the payments, group by group.
    const month = await cash('1993-03-01', '1993-03-31')
    expect(book(month.books)[0]).toMatchObject({ receipts: '1100.00', payments: '1350.00' })
    expect(book(month.by_counter)).toEqual([
      { currency: 'USD', group: 'revenue', label: 'Revenue', inflow: '1000.00', outflow: '0.00', net: '1000.00' },
      { currency: 'USD', group: 'payable', label: 'Creditors', inflow: '0.00', outflow: '1000.00', net: '-1000.00' },
      { currency: 'USD', group: 'tax', label: 'Taxes', inflow: '100.00', outflow: '-100.00', net: '200.00' },
      { currency: 'USD', group: 'fixed_asset', label: 'Property, plant and equipment', inflow: '0.00', outflow: '450.00', net: '-450.00' },
    ])
    const tie = await one(
      `SELECT sum((x->>'inflow')::numeric)::numeric(18,2)::text AS inflow, sum((x->>'outflow')::numeric)::numeric(18,2)::text AS outflow
         FROM json_array_elements($1::json) x WHERE x->>'currency' = 'USD'`, [JSON.stringify(month.by_counter)])
    expect(tie).toEqual({ inflow: '1100.00', outflow: '1350.00' })
    expect(book(month.reconciles)).toEqual([{ currency: 'USD', movement: '-250.00', analysed: '-250.00', agrees: true }])
  })

  test('a transfer alone: each account moves, the book receives and pays nothing, and nothing is analysed', async () => {
    const s = await cash('1993-03-10', '1993-03-10')
    expect(acct(s, made.bank)).toMatchObject({ receipts: '0.00', payments: '200.00', agrees: true })
    expect(acct(s, ids12.bankB)).toMatchObject({ receipts: '200.00', payments: '0.00', agrees: true })
    expect(book(s.books)[0]).toMatchObject({ receipts: '0.00', payments: '0.00' })
    expect(book(s.by_counter)).toEqual([])
    expect(book(s.reconciles)).toEqual([{ currency: 'USD', movement: '0.00', analysed: '0.00', agrees: true }])
  })

  test('a compound voucher with two cash lines is analysed to the cent', async () => {
    const s = await cash('1993-03-05', '1993-03-05')
    expect(acct(s, made.bank)).toMatchObject({ receipts: '333.33', payments: '0.00' })
    expect(acct(s, ids12.bankB)).toMatchObject({ receipts: '666.67', payments: '0.00' })
    expect(book(s.books)[0]).toMatchObject({ receipts: '1000.00', payments: '0.00' })
    expect(book(s.by_counter)).toEqual([
      { currency: 'USD', group: 'revenue', label: 'Revenue', inflow: '900.00', outflow: '0.00', net: '900.00' },
      { currency: 'USD', group: 'tax', label: 'Taxes', inflow: '100.00', outflow: '0.00', net: '100.00' },
    ])
    expect(book(s.reconciles)).toEqual([{ currency: 'USD', movement: '1000.00', analysed: '1000.00', agrees: true }])
  })

  test('an opening-balance voucher in the range is opening, not a receipt', async () => {
    const s = await cash('1993-03-01', '1993-03-01')
    expect(acct(s, ids12.bankB)).toEqual(expect.objectContaining({
      opening: '50.00', receipts: '0.00', payments: '0.00', closing: '50.00', agrees: true,
    }))
    expect(book(s.books)[0]).toMatchObject({ receipts: '0.00', payments: '0.00' })
    expect(book(s.by_counter)).toEqual([])
    expect(book(s.reconciles)[0]).toMatchObject({ movement: '0.00', analysed: '0.00', agrees: true })
  })

  test('the ZWG book stands alone: its own receipts, analysis and check, and nothing of it in USD', async () => {
    const s = await cash('1993-03-22', '1993-03-22')
    const zwg = await cashSpan('1993-03-22', '1993-03-22', made.bank, 'ZWG')
    expect(acct(s, made.bank, 'ZWG')).toEqual({
      id: made.bank, code: `${TAG}-1100`, name: 'Accounting test bank', currency: 'ZWG',
      opening: zwg.opening, receipts: '500.00', payments: '0.00', closing: zwg.closing, agrees: true,
    })
    expect(book(s.books, 'ZWG')).toEqual([{ currency: 'ZWG', ...(await cashSpan('1993-03-22', '1993-03-22', null, 'ZWG')), receipts: '500.00', payments: '0.00' }])
    expect(book(s.by_counter, 'ZWG')).toEqual([
      { currency: 'ZWG', group: 'revenue', label: 'Revenue', inflow: '500.00', outflow: '0.00', net: '500.00' }])
    expect(book(s.reconciles, 'ZWG')).toEqual([{ currency: 'ZWG', movement: '500.00', analysed: '500.00', agrees: true }])
    // The USD book that day: nothing moved.
    expect(book(s.books)[0]).toMatchObject({ receipts: '0.00', payments: '0.00' })
    expect(book(s.by_counter)).toEqual([])
  })

  test('the cash statement exports the same figures with its note, and refuses a range outside the year', async () => {
    const s = await cash('1993-03-01', '1993-03-24')
    const res = await call('GET', `/finance/ledger/statements/cash${qs({ financial_year_id: made.y3, from: '1993-03-01', to: '1993-03-24', format: 'csv' })}`, as.accountant)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    const b = book(s.books)[0]
    expect(res.body).toContain(`USD,Book,,Without movements between the council's own accounts,${b.opening},1100.00,450.00,${b.closing},,,,,,\r\n`)
    expect(res.body).toContain(`USD,Account,${TAG}-1300,Accounting test second bank,50.00,866.67,470.00,446.67,,,,,,yes\r\n`)
    expect(res.body).toContain('USD,Check,,Movement in cash against the analysis,,,,,,,,650.00,650.00,yes\r\n')
    expect(res.body).toContain('It is not a cash flow statement under IPSAS 2')

    const outside = await call('GET', `/finance/ledger/statements/cash${qs({ financial_year_id: made.y3, from: '1992-12-01' })}`, as.accountant)
    expect(outside.statusCode).toBe(400)
    expect(outside.json()).toEqual({
      success: false, error: 'bad_date',
      message: `The range must start within ${y3Label}, from 1993-01-01 to 1993-12-31; 1992-12-01 is not.`,
    })
    const reversed = await call('GET', `/finance/ledger/statements/cash${qs({ financial_year_id: made.y3, from: '1993-04-01', to: '1993-03-01' })}`, as.accountant)
    expect(reversed.json()).toEqual({ success: false, error: 'bad_date', message: 'The range starts on 1993-04-01, after it ends on 1993-03-01.' })
    expect((await call('GET', `/finance/ledger/statements/cash${qs({ financial_year_id: made.y3 })}`, as.cashier)).statusCode).toBe(403)
  })

  /** The USD check of a position, derived from ledger_balances. */
  const derivedCheck = (yearId, asAt, cur = 'USD') => one(
    `SELECT COALESCE(sum(net_debit) FILTER (WHERE root_type = 'asset'), 0)::numeric(18,2)::text AS assets,
            COALESCE(sum(-net_debit) FILTER (WHERE root_type = 'liability'), 0)::numeric(18,2)::text AS liabilities,
            COALESCE(sum(-net_debit) FILTER (WHERE root_type IN ('equity', 'revenue', 'expense')), 0)::numeric(18,2)::text AS eq,
            COALESCE(sum(-net_debit) FILTER (WHERE root_type = 'equity'), 0)::numeric(18,2)::text AS equity_subtotal
       FROM finance.ledger_balances($1, $2::date, 'after') WHERE currency = $3`, [yearId, asAt, cur])

  test('year 2\'s position carries balances brought forward, foots, and has no surplus line once closed', async () => {
    const p = await get('/finance/ledger/statements/position', { financial_year_id: made.y2 })
    expect(p.as_at).toBe('1992-12-31')
    const lifetime = (await one(
      `SELECT sum(debit - credit)::numeric(18,2)::text AS t FROM finance.ledger_entry
        WHERE ledger_account_id = $1 AND currency = 'USD' AND posting_date <= DATE '1992-12-31'`, [made.bank])).t
    const yearOnly = (await one(
      `SELECT sum(debit - credit)::numeric(18,2)::text AS t FROM finance.ledger_entry
        WHERE ledger_account_id = $1 AND currency = 'USD' AND financial_year_id = $2`, [made.bank, made.y2])).t
    expect(lifetime).not.toBe(yearOnly)
    const assets = p.books.find((b) => b.currency === 'USD').sections.find((s) => s.root_type === 'asset')
    expect(assets.accounts.find((a) => a.ledger_account_id === made.bank).balance).toBe(lifetime)
    expect(p.surplus_to_date.find((s) => s.currency === 'USD')).toBeUndefined()
    const d = await derivedCheck(made.y2, '1992-12-31')
    expect(p.check.find((x) => x.currency === 'USD')).toEqual({
      currency: 'USD', assets: d.assets, liabilities: d.liabilities, equity_and_surplus: d.eq, difference: '0.00', balances: true,
    })
    // Every earlier year is closed (year 0 is made only by the last test): no earlier-years row.
    const equity = p.books.find((b) => b.currency === 'USD').sections.find((s) => s.root_type === 'equity')
    expect(equity.accounts.filter((a) => a.ledger_account_id === null)).toEqual([])
  })

  test('mid-year, the position shows the surplus to date and foots with it', async () => {
    const p = await get('/finance/ledger/statements/position', { financial_year_id: made.y2, as_at: '1992-06-30' })
    expect(p.as_at).toBe('1992-06-30')
    const d = await one(
      `SELECT abs(sum(-net_debit))::numeric(18,2)::text AS amount,
              CASE WHEN sum(-net_debit) < 0 THEN 'deficit' ELSE 'surplus' END AS side
         FROM finance.ledger_balances($1, '1992-06-30', 'after')
        WHERE currency = 'USD' AND root_type IN ('revenue', 'expense')`, [made.y2])
    expect(p.surplus_to_date.find((s) => s.currency === 'USD')).toEqual({ currency: 'USD', amount: d.amount, side: d.side })
    const c = await derivedCheck(made.y2, '1992-06-30')
    expect(p.check.find((x) => x.currency === 'USD')).toMatchObject({ equity_and_surplus: c.eq, difference: '0.00', balances: true })
    // Not the year end: no sentence about open periods.
    expect(p.incomplete.filter((s) => /still open/.test(s))).toEqual([])
    // A date before the year starts is refused.
    const early = await call('GET', `/finance/ledger/statements/position${qs({ financial_year_id: made.y2, as_at: '1991-12-31' })}`, as.accountant)
    expect(early.statusCode).toBe(400)
    expect(early.json()).toEqual({ success: false, error: 'bad_date', message: `1991-12-31 is before ${TAG} Year 2 starts, on 1992-01-01.` })
  })

  test('year 3\'s position: the remainder after its closing is shown per book, it foots, and what is missing is said', async () => {
    const p = await get('/finance/ledger/statements/position', { financial_year_id: made.y3 })
    expect(p.as_at).toBe('1993-12-31')
    expect(p.currencies).toEqual(expect.arrayContaining(['USD', 'ZWG']))
    expect(p.surplus_to_date.find((s) => s.currency === 'USD')).toEqual({ currency: 'USD', amount: '1000.00', side: 'surplus' })
    expect(p.surplus_to_date.find((s) => s.currency === 'ZWG')).toEqual({ currency: 'ZWG', amount: '500.00', side: 'surplus' })
    for (const cur of ['USD', 'ZWG']) {
      const d = await derivedCheck(made.y3, '1993-12-31', cur)
      expect(p.check.find((x) => x.currency === cur)).toEqual({
        currency: cur, assets: d.assets, liabilities: d.liabilities, equity_and_surplus: d.eq, difference: '0.00', balances: true,
      })
    }
    const assets = p.books.find((b) => b.currency === 'USD').sections.find((s) => s.root_type === 'asset').accounts
    expect(assets.find((a) => a.ledger_account_id === ids12.plant)).toMatchObject({ balance: '450.00', account_type: 'fixed_asset' })
    expect(assets.find((a) => a.ledger_account_id === ids12.bankB)).toMatchObject({ balance: '446.67' })

    expect(p.incomplete).toContain(`The USD balance of bank account ${TAG}-1100 Accounting test bank has never been reconciled to a bank statement.`)
    expect(p.incomplete).toContain(`The ZWG balance of bank account ${TAG}-1100 Accounting test bank has never been reconciled to a bank statement.`)
    expect(p.incomplete).toContain(`The USD balance of bank account ${TAG}-1300 Accounting test second bank has never been reconciled to a bank statement.`)
    expect(p.incomplete).toContain(`Period 3 of ${y3Label} is still open, so these year-end figures may still change.`)
    // Derived from the data: this council may already hold an old asset still in use.
    const { assets_held: held } = await one(
      `SELECT EXISTS (SELECT 1 FROM finance.fixed_asset WHERE authority_id = $1 AND currency = 'USD'
                        AND acquired_on <= DATE '1993-12-31'
                        AND (disposed_on IS NULL OR disposed_on > DATE '1993-12-31')) AS assets_held`, [ids.authority])
    const ppe = 'The property, plant and equipment accounts carry a balance in the USD book, but the asset register '
      + 'holds no USD asset acquired by 31 December 1993, so no depreciation has been charged against it.'
    expect(p.incomplete.includes(ppe)).toBe(!held)
    // The fixture now holds a payable account, so there is no payables sentence.
    expect(p.incomplete.some((s) => /no creditors \(payable\) control account/.test(s))).toBe(false)

    // One book only: the ZWG statement carries nothing of the USD book, sentences included.
    const z = await get('/finance/ledger/statements/position', { financial_year_id: made.y3, currency: 'ZWG' })
    expect(z.currencies).toEqual(['ZWG'])
    expect(z.books.map((b) => b.currency)).toEqual(['ZWG'])
    expect(z.check.map((c) => c.currency)).toEqual(['ZWG'])
    expect(z.subtotals.every((s) => s.currency === 'ZWG')).toBe(true)
    expect(z.incomplete.some((s) => /The USD balance/.test(s))).toBe(false)

    // The same figures in the csv.
    const res = await call('GET', `/finance/ledger/statements/position${qs({ financial_year_id: made.y3, format: 'csv' })}`, as.accountant)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain(`USD,Assets,${TAG}-1600,Accounting test plant,450.00\r\n`)
    expect(res.body).toContain('USD,Net assets/equity,,Surplus to date,1000.00\r\n')
    expect(res.body).toContain('ZWG,Net assets/equity,,Surplus to date,500.00\r\n')
    expect(res.body).toContain('USD,Check,,Assets less liabilities less net assets/equity,0.00\r\n')
    expect(res.body).toContain(`,Not yet included,,"Period 3 of ${y3Label} is still open, so these year-end figures may still change.",\r\n`)
  })

  /** One account's natural-side movement in year 2 over a range, closings and their reversals left out. */
  const y2Revenue = (accountId, from, to) => one(
    `SELECT sum(e.credit - e.debit)::numeric(18,2)::text AS t
       FROM finance.ledger_entry e JOIN finance.voucher v ON v.id = e.voucher_id
       LEFT JOIN finance.voucher o ON o.id = v.reverses_voucher_id
      WHERE e.ledger_account_id = $1 AND e.posting_date BETWEEN $2::date AND $3::date
        AND v.voucher_type <> 'closing' AND COALESCE(o.voucher_type, '') <> 'closing'`, [accountId, from, to])

  test('a closed year\'s performance still shows its figures, and its periods leave the closing out', async () => {
    const plain = await get('/finance/ledger/statements/performance', { financial_year_id: made.y2 })
    expect(plain).not.toHaveProperty('prior_year')
    expect(plain).not.toHaveProperty('prior')
    const rowOf = (data, id) => data.books.find((b) => b.currency === 'USD').sections.flatMap((s) => s.accounts)
      .find((a) => a.ledger_account_id === id)
    const income = (await y2Revenue(made.income, '1992-01-01', '1992-12-31')).t
    expect(rowOf(plain, made.income).balance).toBe(income)
    const { t: expense } = await one(
      `SELECT (-sum(e.credit - e.debit))::numeric(18,2)::text AS t FROM finance.ledger_entry e
         JOIN finance.voucher v ON v.id = e.voucher_id LEFT JOIN finance.voucher o ON o.id = v.reverses_voucher_id
        WHERE e.ledger_account_id = $1 AND e.financial_year_id = $2
          AND v.voucher_type <> 'closing' AND COALESCE(o.voucher_type, '') <> 'closing'`, [made.expense, made.y2])
    expect(rowOf(plain, made.expense).balance).toBe(expense)
    // B11's own figures, as that block left them.
    expect(income).toBe('2431.00')
    expect(expense).toBe('2535.00')
    expect(plain.surplus.find((s) => s.currency === 'USD')).toEqual({ currency: 'USD', amount: '104.00', side: 'deficit' })

    const monthly = await get('/finance/ledger/statements/performance', { financial_year_id: made.y2, periodicity: 'monthly' })
    // December and November, each derived; the closing (dated 1992-12-31) is in neither.
    const dec = (await y2Revenue(made.income, '1992-12-01', '1992-12-31')).t
    const decRow = monthly.period_rows.find((r) => r.key === 'm12' && r.ledger_account_id === made.income)
    expect(decRow ? decRow.balance : null).toBe(dec)
    const nov = (await y2Revenue(made.income, '1992-11-01', '1992-11-30')).t
    expect(monthly.period_rows.find((r) => r.key === 'm11' && r.ledger_account_id === made.income).balance).toBe(nov)
  })

  test('performance as at a date reads nothing after it, and compares with the same span of the prior year (review m2, m7)', async () => {
    const mid = await get('/finance/ledger/statements/performance', {
      financial_year_id: made.y2, as_at: '1992-06-30', periodicity: 'monthly', compare: 'prior_year',
    })
    expect(mid.as_at).toBe('1992-06-30')
    const rowOf = (id) => mid.books.find((b) => b.currency === 'USD').sections.flatMap((s) => s.accounts)
      .find((a) => a.ledger_account_id === id)
    expect(rowOf(made.income).balance).toBe((await y2Revenue(made.income, '1992-01-01', '1992-06-30')).t)
    expect(mid.period_rows.filter((r) => ['m07', 'm08', 'm09', 'm10', 'm11', 'm12'].includes(r.key))).toEqual([])
    expect(mid.prior_year).toEqual({ id: made.y1, label: `${TAG} Year 1, to 30 June 1991`, as_at: '1991-06-30', whole_year: false })
    const priorOf = (id) => mid.prior.find((r) => r.currency === 'USD' && r.ledger_account_id === id).balance
    expect(priorOf(made.income)).toBe((await y2Revenue(made.income, '1991-01-01', '1991-06-30')).t)

    const whole = await get('/finance/ledger/statements/performance', { financial_year_id: made.y2, compare: 'prior_year' })
    expect(whole.prior_year).toEqual({ id: made.y1, label: `${TAG} Year 1`, as_at: '1991-12-31', whole_year: true })
    expect(whole.prior).toEqual(expect.arrayContaining([
      { currency: 'USD', ledger_account_id: made.income, balance: '900.00' },
      { currency: 'USD', ledger_account_id: made.expense, balance: '400.00' },
    ]))
    const csv = await call('GET', `/finance/ledger/statements/performance${qs({ financial_year_id: made.y2, as_at: '1992-06-30', compare: 'prior_year', format: 'csv' })}`, as.accountant)
    expect(csv.body.split('\r\n')[0]).toBe(`Book,Section,Code,Account,Amount,"${TAG} Year 1, to 30 June 1991"`)

    const first = await get('/finance/ledger/statements/performance', { financial_year_id: made.y1, compare: 'prior_year' })
    expect(first.prior_year).toBeNull()
    expect(first.prior).toEqual([])
  })

  test('a reversal of a year-end closing keeps the closing\'s date, on the reverse route and on the draft (B11 N1)', async () => {
    const yc = await one(
      `SELECT c.id, c.voucher_no, c.posting_date::text AS posting_date FROM finance.voucher c
        WHERE c.financial_year_id = $1 AND c.voucher_type = 'closing' AND c.status = 'posted'
          AND NOT EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = c.id AND r.status = 'posted')
        ORDER BY c.posted_at DESC LIMIT 1`, [made.y2])
    expect(yc.posting_date).toBe('1992-12-31')
    const misdated = await call('POST', `/finance/ledger/vouchers/${yc.id}/reverse`, as.director,
      { reason: 'Raised on the wrong day, to show it is refused.', posting_date: '1992-12-30' })
    expect(misdated.statusCode).toBe(400)
    expect(misdated.json()).toEqual({
      success: false, error: 'bad_date',
      message: `A reversal of the year-end closing ${yc.voucher_no} is dated the same day as the closing, 1992-12-31, not 1992-12-30. `
        + 'Leave the date out, or give 1992-12-31.',
    })
    expect((await one(
      "SELECT count(*)::int AS n FROM finance.voucher WHERE reverses_voucher_id = $1 AND status IN ('draft', 'posted')", [yc.id])).n).toBe(0)
    // The database refuses it too, for any caller that is not this route (review m1).
    await expect(sys.query('SELECT finance.raise_reversal($1, $2, $3, $4, NULL)',
      [yc.id, ids.director, 'Straight to the database.', '1992-12-30']))
      .rejects.toThrow(/a reversal of the year-end closing .* is dated the same day as the closing, 1992-12-31, not 1992-12-30/)

    const raised = await call('POST', `/finance/ledger/vouchers/${yc.id}/reverse`, as.director,
      { reason: 'Raised on the right day, then moved.' })
    expect(raised.statusCode).toBe(201)
    const rev = raised.json().data.reversal
    expect(rev.posting_date).toBe('1992-12-31')
    const moved = await call('PATCH', `/finance/ledger/vouchers/${rev.id}`, as.director, { posting_date: '1992-12-30' })
    expect(moved.statusCode).toBe(400)
    expect(moved.json().error).toBe('bad_date')
    expect((await one('SELECT posting_date::text AS d FROM finance.voucher WHERE id = $1', [rev.id])).d).toBe('1992-12-31')
    expect((await call('PATCH', `/finance/ledger/vouchers/${rev.id}`, as.director, { posting_date: '1992-12-31' })).statusCode).toBe(200)
    expect((await call('DELETE', `/finance/ledger/vouchers/${rev.id}`, as.director)).statusCode).toBe(200)

    // Any other voucher may still be reversed on another day.
    const other = await call('POST', `/finance/ledger/vouchers/${ids12.ppe}/reverse`, as.director,
      { reason: 'An ordinary reversal on a later day.', posting_date: '1993-03-26' })
    expect(other.statusCode).toBe(201)
    expect(other.json().data.reversal.posting_date).toBe('1993-03-26')
    expect((await call('DELETE', `/finance/ledger/vouchers/${other.json().data.reversal.id}`, as.director)).statusCode).toBe(200)
  })

  // LAST in this file: it makes 1990, an earlier year left unclosed, which every later year's
  // balance-sheet figures would carry from here on.
  test('an earlier year not closed: its row is labelled, last in equity, inside the subtotal, and the position foots (review I3)', async () => {
    ids12.y0 = await makeYear('Year 0', '1990-01-01', '1990-12-31')
    ids12.y0Debtor = await account('1250', 'Accounting test year-0 debtor', 'asset')
    ids12.y0Income = await account('4200', 'Accounting test year-0 income', 'revenue')
    await journal(ids12.y0, '1990-06-15',
      [{ ledger_account_id: ids12.y0Debtor, debit: '75.00' }, { ledger_account_id: ids12.y0Income, credit: '75.00' }],
      { voucher_no: `${TAG}-B12-Y0` })

    const p = await get('/finance/ledger/statements/position', { financial_year_id: made.y1 })
    const { net } = await one(
      `SELECT net_debit::numeric(18,2)::text AS net FROM finance.ledger_balances($1, NULL, 'after')
        WHERE currency = 'USD' AND ledger_account_id IS NULL`, [made.y1])
    expect(net).toBe('-75.00')
    const equity = p.books.find((b) => b.currency === 'USD').sections.find((s) => s.root_type === 'equity').accounts
    expect(equity[equity.length - 1]).toEqual({
      currency: 'USD', ledger_account_id: null, account_code: null,
      account_name: 'Surplus or deficit of earlier years not yet closed', root_type: 'equity', account_type: null,
      debit_balance: '0.00', credit_balance: '75.00', balance: '75.00',
    })
    expect(equity.filter((a) => a.ledger_account_id === null)).toHaveLength(1)
    const d = await derivedCheck(made.y1, '1991-12-31')
    expect(p.subtotals.find((s) => s.currency === 'USD' && s.root_type === 'equity').subtotal).toBe(d.equity_subtotal)
    expect(p.check.find((x) => x.currency === 'USD')).toEqual({
      currency: 'USD', assets: d.assets, liabilities: d.liabilities, equity_and_surplus: d.eq, difference: '0.00', balances: true,
    })
    const res = await call('GET', `/finance/ledger/statements/position${qs({ financial_year_id: made.y1, format: 'csv' })}`, as.accountant)
    expect(res.body).toContain('USD,Net assets/equity,,Surplus or deficit of earlier years not yet closed,75.00\r\n')
  })
})
