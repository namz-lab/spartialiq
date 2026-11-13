/**
 * Proof that the cash office holds its controls with every route bypassed.
 *
 * Acceptance checks P3 to P10 of
 * docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §9 (frontend
 * repository), which are controls C1 to C9 of §5.3:
 *
 *   C1  a receipt is taken only inside the caller's own open session
 *   C2  receipt numbers are consecutive, never burned by a rollback and never reissued
 *   C3  a receipt is never edited or deleted
 *   C4  the cashier does not verify their own cash-up
 *   C5  the session reaches the ledger only at verification, all at once
 *   C6  a cash difference is explained, and posted, never absorbed
 *   C8  currencies are counted separately
 *   C9  money that is not physical cash never sits in the till account
 *
 * Same shape and same reasons as scripts/verify-rates-invariants.js: these are statements about
 * Postgres, and NOTHING THIS SCRIPT WRITES SURVIVES IT. Every proof runs in a transaction that
 * ends in ROLLBACK, and the row counts printed at the end confirm it.
 *
 * Run: node scripts/verify-cash-office-invariants.js
 * Exits non-zero if any check fails.
 */
require('dotenv').config()
const { Client } = require('pg')

let passed = 0
let failed = 0
const ok = (name, detail) => { passed += 1; console.log(`  PASS  ${name}${detail ? `\n          ${detail}` : ''}`) }
const bad = (name, detail) => { failed += 1; console.log(`  FAIL  ${name}\n          ${detail}`) }
const is = (name, actual, expected, detail) => {
  if (String(actual) === String(expected)) ok(name, detail || `${actual}`)
  else bad(name, `expected ${expected}, got ${actual}${detail ? ` (${detail})` : ''}`)
}

function day(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const TODAY = day(0)

let savepointSeq = 0
async function expectError(client, label, sql, params, matcher) {
  savepointSeq += 1
  const sp = `cproof_${savepointSeq}`
  await client.query(`SAVEPOINT ${sp}`)
  try {
    await client.query(sql, params)
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    bad(label, 'the statement SUCCEEDED; the refusal is not enforced')
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    const message = `${err.message}`
    if (matcher && !matcher.test(message)) bad(label, `refused, but with an unexpected message: ${message}`)
    else ok(label, `refused: ${message.split('\n')[0]}`)
  }
}

async function inRollback(client, title, fn) {
  console.log(`\n${title}`)
  await client.query('BEGIN')
  try { await fn() } catch (err) { bad(title, `harness error: ${err.message}`) }
  await client.query('ROLLBACK')
}

/** A year, an open period, a chart, a cash point, three income codes and three people. */
async function fixtures(client) {
  const { rows: users } = await client.query(
    `SELECT id FROM public.users WHERE deleted_at IS NULL AND role IN
       ('finance_admin', 'finance_officer', 'budget_officer', 'accountant', 'cashier')
      ORDER BY role, id LIMIT 3`)
  if (users.length < 3) throw new Error('need three finance staff in public.users')
  const [cashier, verifier, other] = users.map((u) => u.id)
  const { rows: auth } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
  const authorityId = auth[0].id

  const { rows: year } = await client.query(
    `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES ($1, 'CASH-PROOF year', $2, $3, 'open', 'USD') RETURNING id`, [authorityId, day(-30), day(330)])
  const yearId = year[0].id
  await client.query(
    `INSERT INTO finance.ledger_period (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 1, 'CP-1', $3, $4, 'open'), ($1, $2, 2, 'CP-2', $5, $6, 'open')`,
    [authorityId, yearId, day(-30), day(30), day(31), day(330)])

  const account = async (code, name, root, type) => {
    const { rows } = await client.query(
      `INSERT INTO finance.ledger_account (authority_id, code, name, root_type, account_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [authorityId, code, name, root, type])
    return rows[0].id
  }
  const A = {
    till: await account('CP-TILL', 'Proof till cash', 'asset', 'cash'),
    bank: await account('CP-BANK', 'Proof bank', 'asset', 'bank'),
    hall: await account('CP-HALL', 'Proof hall hire', 'revenue', null),
    market: await account('CP-MKT', 'Proof market fees', 'revenue', null),
    diff: await account('CP-DIFF', 'Proof cash differences', 'expense', null),
    payable: await account('CP-PAY', 'Proof payable', 'liability', 'payable'),
  }

  const { rows: point } = await client.query(
    `INSERT INTO finance.cash_point (authority_id, code, name, till_account_id)
     VALUES ($1, 'CP-MAIN', 'Proof counter', $2) RETURNING id`, [authorityId, A.till])
  const { rows: codes } = await client.query(
    `INSERT INTO finance.income_code (authority_id, code, name, ledger_account_id, pricing, unit_amount_usd)
     VALUES ($1, 'CP-HALL', 'Hall hire', $2, 'fixed', 40.00),
            ($1, 'CP-MKT', 'Market fee', $3, 'variable', NULL) RETURNING id, code`,
    [authorityId, A.hall, A.market])
  const code = Object.fromEntries(codes.map((c) => [c.code, c.id]))
  return { authorityId, yearId, cashier, verifier, other, A, pointId: point[0].id, code }
}

const open = async (client, f, floats = []) => (await client.query(
  'SELECT finance.open_cashier_session($1,$2,$3,$4,$5::jsonb) AS id',
  [f.pointId, f.cashier, f.yearId, TODAY, JSON.stringify(floats)])).rows[0].id

const receipt = async (client, f, session, { currency = 'USD', method = 'cash', lines, deposit = null, ref = null, by } = {}) =>
  (await client.query(
    'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7,NULL,$8) AS id',
    [session, by || f.cashier, 'A. Payer', currency, method,
      JSON.stringify(lines || [{ income_code_id: f.code['CP-MKT'], unit_amount: '10.00' }]), deposit, ref])).rows[0].id

const tillLedger = async (client, f, currency) => (await client.query(
  `SELECT COALESCE(sum(debit - credit), 0)::text AS b FROM finance.ledger_entry
    WHERE ledger_account_id = $1 AND currency = $2`, [f.A.till, currency])).rows[0].b

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const counts = async () => (await client.query(
    `SELECT (SELECT count(*) FROM finance.ledger_entry)::int AS entries,
            (SELECT count(*) FROM finance.voucher)::int AS vouchers,
            (SELECT count(*) FROM finance.cash_receipt)::int AS receipts,
            (SELECT COALESCE(sum(last_no), 0) FROM finance.document_sequence)::int AS issued`)).rows[0]
  const before = await counts()

  await inRollback(client, 'Setup is refused when it names the wrong kind of account', async () => {
    const f = await fixtures(client)
    await expectError(client, 'a till cannot keep its takings in a bank account',
      `INSERT INTO finance.cash_point (authority_id, code, name, till_account_id) VALUES ($1,'X','X',$2)`,
      [f.authorityId, f.A.bank], /is not a cash account/)
    await expectError(client, 'a cash difference cannot be posted to a liability',
      'UPDATE finance.cash_point SET difference_account_id = $2 WHERE id = $1',
      [f.pointId, f.A.payable], /gain or a loss/)
    await expectError(client, 'an income code cannot credit an expense account',
      `INSERT INTO finance.income_code (authority_id, code, name, ledger_account_id) VALUES ($1,'X','X',$2)`,
      [f.authorityId, f.A.diff], /credits a revenue account/)
    await expectError(client, 'a fixed charge with no amount in any currency is not a charge',
      `INSERT INTO finance.income_code (authority_id, code, name, ledger_account_id, pricing) VALUES ($1,'X','X',$2,'fixed')`,
      [f.authorityId, f.A.hall], /income_code_fixed_has_a_charge/)
  })

  await inRollback(client, 'C1 — a receipt needs the caller\'s own open session', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await expectError(client, 'another person cannot receipt in this cashier\'s session',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb)',
      [s, f.other, 'A. Payer', 'USD', 'cash', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }])],
      /belongs to another cashier/)
    await expectError(client, 'a cashier cannot open a second session',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.cashier, f.yearId, TODAY], /already have a session open/)
    await expectError(client, 'a second cashier cannot open the same drawer',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.other, f.yearId, TODAY], /one drawer has one cashier/)
    await receipt(client, f, s)
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)',
      [s, f.cashier, JSON.stringify([{ currency: 'USD', declared_total: '10.00' }])])
    await expectError(client, 'a closed session takes no more receipts',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb)',
      [s, f.cashier, 'A. Payer', 'USD', 'cash', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }])],
      /takes no more receipts/)
    await expectError(client, 'a session cannot be opened on a date no accounting period contains',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.other, f.yearId, day(400)], /not inside financial year/)
  })

  await inRollback(client, 'C2 — receipt numbers are issued, consecutive and never reused', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    const a = await receipt(client, f, s)
    await client.query('SAVEPOINT burned')
    await receipt(client, f, s)
    await client.query('ROLLBACK TO SAVEPOINT burned')
    const b = await receipt(client, f, s)
    const { rows } = await client.query(
      'SELECT receipt_no FROM finance.cash_receipt WHERE id = ANY($1) ORDER BY receipt_no', [[a, b]])
    const n = rows.map((r) => Number(r.receipt_no.split('-')[1]))
    is('a receipt that was never saved burns no number', n[1] - n[0], 1, `${rows[0].receipt_no}, ${rows[1].receipt_no}`)
    await client.query('SELECT finance.cancel_cash_receipt($1,$2,$3)', [b, f.cashier, 'wrong payer entered'])
    const c = await receipt(client, f, s)
    const { rows: next } = await client.query('SELECT receipt_no FROM finance.cash_receipt WHERE id = $1', [c])
    is('a cancelled receipt keeps its number; the next one moves on',
      Number(next[0].receipt_no.split('-')[1]) - n[1], 1, next[0].receipt_no)
    const { rows: v } = await client.query(
      `SELECT voucher_no = receipt_no AS same FROM finance.cash_receipt r JOIN finance.voucher v ON v.id = r.voucher_id WHERE r.id = $1`, [a])
    is('the voucher carries the receipt number', v[0].same, true)
  })

  // Serialisation needs a second connection: the counter row is locked until the first ends.
  console.log('\nC2 — two cashiers in the same instant cannot be issued the same number')
  {
    const other = new Client({ connectionString: process.env.DATABASE_URL })
    await other.connect()
    await client.query('BEGIN'); await other.query('BEGIN')
    const { rows: auth } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
    const first = (await client.query("SELECT finance.next_document_no($1, 'receipt') AS n", [auth[0].id])).rows[0].n
    let settled = false
    const second = other.query("SELECT finance.next_document_no($1, 'receipt') AS n", [auth[0].id])
      .then((r) => { settled = true; return r.rows[0].n })
    await new Promise((resolve) => setTimeout(resolve, 400))
    is('the second caller waits while the first holds the number', settled, false)
    await client.query('ROLLBACK')
    const got = await second
    is('and when the first is rolled back, the second is issued that same number, not the next', got, first)
    await other.query('ROLLBACK')
    await other.end()
  }

  await inRollback(client, 'C3 — a receipt is never edited or deleted', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    const r = await receipt(client, f, s)
    await expectError(client, 'the amount cannot be changed',
      'UPDATE finance.cash_receipt SET amount = 1 WHERE id = $1', [r], /cannot be amended/)
    await expectError(client, 'the payer cannot be changed',
      `UPDATE finance.cash_receipt SET payer_name = 'Somebody Else' WHERE id = $1`, [r], /cannot be amended/)
    await expectError(client, 'a line cannot be changed',
      'UPDATE finance.cash_receipt_line SET unit_amount = 1 WHERE cash_receipt_id = $1', [r], /never amended/)
    await expectError(client, 'a receipt cannot be deleted',
      'DELETE FROM finance.cash_receipt WHERE id = $1', [r], /never deleted/)
    await expectError(client, 'cancelling needs a reason',
      'SELECT finance.cancel_cash_receipt($1,$2,$3)', [r, f.cashier, ''], /needs a reason/)
    await expectError(client, 'only the cashier whose session it is cancels at the counter',
      'SELECT finance.cancel_cash_receipt($1,$2,$3)', [r, f.other, 'not mine to cancel'], /another cashier/)
    await client.query('SELECT finance.cancel_cash_receipt($1,$2,$3)', [r, f.cashier, 'duplicate of the previous receipt'])
    const { rows } = await client.query(
      `SELECT r.cancel_reason, v.status FROM finance.cash_receipt r JOIN finance.voucher v ON v.id = r.voucher_id WHERE r.id = $1`, [r])
    is('a cancelled receipt stays on the record with its reason and a cancelled voucher',
      `${rows[0].status}/${rows[0].cancel_reason}`, 'cancelled/duplicate of the previous receipt')
    await expectError(client, 'a cancelled receipt accepts no further change',
      `UPDATE finance.cash_receipt SET cancel_reason = 'rewritten' WHERE id = $1`, [r], /accepts no further change/)
  })

  await inRollback(client, 'The Council\'s charge is not varied at the counter', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await expectError(client, 'a fixed charge cannot be discounted',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb)',
      [s, f.cashier, 'A. Payer', 'USD', 'cash', JSON.stringify([{ income_code_id: f.code['CP-HALL'], unit_amount: '25.00' }])],
      /may not vary it/)
    await expectError(client, 'a charge set only in USD cannot be receipted in ZWG',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb)',
      [s, f.cashier, 'A. Payer', 'ZWG', 'cash', JSON.stringify([{ income_code_id: f.code['CP-HALL'] }])],
      /has no charge set in ZWG/)
    const r = await receipt(client, f, s, { lines: [{ income_code_id: f.code['CP-HALL'], quantity: '2' }, { income_code_id: f.code['CP-MKT'], unit_amount: '7.50' }] })
    const { rows } = await client.query('SELECT amount::text FROM finance.cash_receipt WHERE id = $1', [r])
    is('the total is computed by the database from the lines', rows[0].amount, '87.50', '2 x 40.00 + 7.50')
    const { rows: bal } = await client.query('SELECT difference::text FROM finance.voucher_imbalance((SELECT voucher_id FROM finance.cash_receipt WHERE id = $1))', [r])
    is('and its voucher balances', Number(bal[0].difference), 0)
  })

  await inRollback(client, 'C9 — money that is not in the drawer never sits in the till account', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await expectError(client, 'a mobile-money payment must name the account it was paid into',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,NULL,NULL,$7)',
      [s, f.cashier, 'A. Payer', 'USD', 'mobile_money', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }]), 'ECO123'],
      /names the bank or wallet account/)
    await expectError(client, 'a transfer cannot be receipted into the till',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7,NULL,$8)',
      [s, f.cashier, 'A. Payer', 'USD', 'bank_transfer', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }]), f.A.till, 'TRF99'],
      /is not a bank account/)
    await expectError(client, 'cash cannot be receipted straight into the bank',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7)',
      [s, f.cashier, 'A. Payer', 'USD', 'cash', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }]), f.A.bank],
      /go into the till/)
    await expectError(client, 'an electronic payment carries its transaction reference',
      'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7)',
      [s, f.cashier, 'A. Payer', 'USD', 'card', JSON.stringify([{ income_code_id: f.code['CP-MKT'], unit_amount: '5' }]), f.A.bank],
      /cash_receipt_electronic_is_referenced/)
  })

  await inRollback(client, 'C4, C5, C6, C8 — the cash-up, and the session reaching the ledger', async () => {
    const f = await fixtures(client)
    const s = await open(client, f, [{ currency: 'USD', amount: '50.00' }])
    await receipt(client, f, s, { lines: [{ income_code_id: f.code['CP-HALL'] }] })                    // USD 40 cash
    await receipt(client, f, s, { lines: [{ income_code_id: f.code['CP-MKT'], unit_amount: '12.00' }] }) // USD 12 cash
    await receipt(client, f, s, { method: 'mobile_money', deposit: f.A.bank, ref: 'ECO-777',
      lines: [{ income_code_id: f.code['CP-MKT'], unit_amount: '30.00' }] })                           // USD 30 wallet
    await receipt(client, f, s, { currency: 'ZWG', lines: [{ income_code_id: f.code['CP-MKT'], unit_amount: '900.00' }] })
    const cancelled = await receipt(client, f, s, { lines: [{ income_code_id: f.code['CP-MKT'], unit_amount: '99.00' }] })
    await client.query('SELECT finance.cancel_cash_receipt($1,$2,$3)', [cancelled, f.cashier, 'keyed twice by mistake'])

    is('before verification the ledger holds nothing from the session (C5)', await tillLedger(client, f, 'USD'), '0')

    await expectError(client, 'every currency in the drawer is counted (C8)',
      'SELECT finance.close_cashier_session($1,$2,$3::jsonb)',
      [s, f.cashier, JSON.stringify([{ currency: 'USD', declared_total: '102.00' }])], /ZWG count has not been declared/)
    await expectError(client, 'a difference is explained before the session can be closed (C6)',
      'SELECT finance.close_cashier_session($1,$2,$3::jsonb)',
      [s, f.cashier, JSON.stringify([{ currency: 'USD', declared_total: '100.00' }, { currency: 'ZWG', declared_total: '900.00' }])],
      /explained in writing/)
    await expectError(client, 'the count is declared by whoever took the money',
      'SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.other, '[]'], /belongs to another cashier/)

    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.cashier, JSON.stringify([
      { currency: 'USD', declared_total: '100.00', explanation: 'Two dollars short; change given in error' },
      { currency: 'ZWG', declared_total: '900.00' }])])
    const { rows: counts } = await client.query(
      `SELECT currency, expected_takings::text AS e, variance::text AS v FROM finance.cashier_session_count
        WHERE cashier_session_id = $1 ORDER BY currency`, [s])
    is('expected takings are the physical, uncancelled receipts only, per currency (C8, C9)',
      counts.map((c) => `${c.currency} ${c.e} ${c.v}`).join(' | '), 'USD 52.00 -2.00 | ZWG 900.00 0.00',
      'float 50.00 taken off the USD count; the wallet payment and the cancelled receipt are not in the drawer')

    await expectError(client, 'the cashier cannot verify their own cash-up (C4, function)',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.cashier], /verified by somebody else/)
    await expectError(client, 'nor can the row be made to say so (C4, CHECK)',
      `UPDATE finance.cashier_session SET status = 'verified', verified_by = cashier_id, verified_at = now() WHERE id = $1`,
      [s], /cashier_session_verified_by_another/)
    await expectError(client, 'a difference with no account to post it to is not absorbed (C6)',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.verifier], /no cash-difference account/)

    await client.query('UPDATE finance.cash_point SET difference_account_id = $2 WHERE id = $1', [f.pointId, f.A.diff])
    const { rows: posted } = await client.query('SELECT finance.verify_cashier_session($1,$2,$3) AS n', [s, f.verifier, 'counted with the cashier'])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    is('verification posts every live receipt and the difference journal, together (C5)', posted[0].n, 5, '4 receipts + 1 USD difference')
    is('till cash in the ledger equals the takings actually counted, USD (C6)', await tillLedger(client, f, 'USD'), '50.00', '52.00 receipted less 2.00 short')
    is('and ZWG, in its own book (C8)', await tillLedger(client, f, 'ZWG'), '900.00')
    const { rows: bank } = await client.query(
      `SELECT COALESCE(sum(debit - credit), 0)::text AS b FROM finance.ledger_entry WHERE ledger_account_id = $1 AND currency = 'USD'`, [f.A.bank])
    is('the wallet payment went to the bank account, not the till (C9)', bank[0].b, '30.00')
    const { rows: diff } = await client.query(
      `SELECT COALESCE(sum(debit - credit), 0)::text AS b FROM finance.ledger_entry WHERE ledger_account_id = $1`, [f.A.diff])
    is('the shortage is a posted expense', diff[0].b, '2.00')
    const { rows: tb } = await client.query(
      `SELECT currency, (sum(debit) - sum(credit))::text AS d FROM finance.ledger_entry
        WHERE financial_year_id = $1 GROUP BY currency ORDER BY currency`, [f.yearId])
    is('each book still balances', tb.map((r) => `${r.currency} ${r.d}`).join(' | '), 'USD 0.00 | ZWG 0.00')
    const { rows: posters } = await client.query(
      `SELECT count(*) FILTER (WHERE v.posted_by = $2)::int AS by_verifier, count(*)::int AS n
         FROM finance.v_cashier_session_receipt r JOIN finance.voucher v ON v.id = r.voucher_id
        WHERE r.cashier_session_id = $1 AND NOT r.is_cancelled`, [s, f.verifier])
    is('every receipt was prepared by the cashier and posted by the verifier', posters[0].by_verifier, posters[0].n)
    await expectError(client, 'a verified session cannot be verified again',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.verifier], /only a closed session/)

    // P10: the banking.
    await expectError(client, 'more than the till holds cannot be banked',
      'SELECT finance.prepare_bank_deposit($1,$2,$3,$4,$5,$6,$7,$8)',
      [f.pointId, f.cashier, 'USD', '60.00', f.A.bank, f.yearId, TODAY, 'SLIP-001'], /holds USD 50.00/)
    await expectError(client, 'a banking needs the deposit slip reference',
      'SELECT finance.prepare_bank_deposit($1,$2,$3,$4,$5,$6,$7,$8)',
      [f.pointId, f.cashier, 'USD', '50.00', f.A.bank, f.yearId, TODAY, ''], /deposit slip reference/)
    const { rows: dep } = await client.query(
      'SELECT finance.prepare_bank_deposit($1,$2,$3,$4,$5,$6,$7,$8) AS id',
      [f.pointId, f.cashier, 'USD', '50.00', f.A.bank, f.yearId, TODAY, 'SLIP-001'])
    await expectError(client, 'the same takings cannot be banked twice while the first banking is unposted',
      'SELECT finance.prepare_bank_deposit($1,$2,$3,$4,$5,$6,$7,$8)',
      [f.pointId, f.cashier, 'USD', '1.00', f.A.bank, f.yearId, TODAY, 'SLIP-002'], /holds USD 0.00/)
    const { rows: dv } = await client.query('SELECT voucher_id FROM finance.bank_deposit WHERE id = $1', [dep[0].id])
    await expectError(client, 'whoever prepared the banking cannot post it',
      'SELECT finance.post_voucher($1,$2)', [dv[0].voucher_id, f.cashier], /posted by somebody else/)
    await client.query('SELECT finance.post_voucher($1,$2)', [dv[0].voucher_id, f.verifier])
    is('after the banking the till holds nil in that currency (P10)', await tillLedger(client, f, 'USD'), '0.00')
  })

  await inRollback(client, 'A count sent back for recounting, and a session with no difference', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await receipt(client, f, s, { lines: [{ income_code_id: f.code['CP-MKT'], unit_amount: '20.00' }] })
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.cashier,
      JSON.stringify([{ currency: 'USD', declared_total: '2.00', explanation: 'mistyped: should read 20.00' }])])
    await expectError(client, 'the cashier cannot return their own count',
      'SELECT finance.return_cashier_session($1,$2,$3)', [s, f.cashier, 'let me recount'], /verifier''s act|verifier's act/)
    await client.query('SELECT finance.return_cashier_session($1,$2,$3)', [s, f.verifier, 'count reads 2.00; please recount'])
    const { rows } = await client.query('SELECT status, return_reason FROM finance.cashier_session WHERE id = $1', [s])
    is('a returned session is open again and says why', `${rows[0].status}/${rows[0].return_reason}`, 'open/count reads 2.00; please recount')
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.cashier,
      JSON.stringify([{ currency: 'USD', declared_total: '20.00' }])])
    const { rows: n } = await client.query('SELECT finance.verify_cashier_session($1,$2) AS n', [s, f.verifier])
    is('a session that agrees verifies with no difference account and no difference journal', n[0].n, 1)
  })

  const after = await counts()
  console.log(`\nledger_entry ${before.entries} -> ${after.entries}, voucher ${before.vouchers} -> ${after.vouchers}, `
    + `cash_receipt ${before.receipts} -> ${after.receipts}, numbers issued ${before.issued} -> ${after.issued}`)
  if (JSON.stringify(before) === JSON.stringify(after)) ok('this script wrote nothing', 'every proof ran inside a transaction that was rolled back')
  else bad('this script wrote nothing', 'rows persisted past the rollback')

  await client.end()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error('\nharness error:', err.message); process.exit(2) })
