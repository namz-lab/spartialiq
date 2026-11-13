/**
 * Proof that the till session lifecycle (migration 208) holds its controls with every route
 * bypassed.
 *
 *   L1  suspended and abandoned sessions still hold the drawer and the cashier (one drawer, one person)
 *   L2  only the cashier suspends and resumes; a suspended session takes no receipts and is not counted
 *   L3  only a supervisor finds a session abandoned, never their own, only past the threshold or the day
 *   L4  an abandoned drawer is freed only by a supervised, witnessed count that obeys C6 and C8
 *   L5  nobody who counted or witnessed a drawer verifies it (C4 extended); a supervised count
 *       returned for recount goes back to the supervisor, not the cashier
 *   L6  a session's history is append-only and records every count as it was declared
 *   L7  only the listed state changes exist; a session is never deleted
 *   L8  assignment: never yourself, only to till operators, ended never edited, and ending one never
 *       touches a session in progress; when required (D29), a till opens only at an assigned point
 *   L9  a session whose business day has passed takes no receipts
 *   L10 concurrency: two cashiers racing for one drawer, two supervisors racing to abandon one
 *       session, and a receipt racing an abandonment, each resolve to exactly one outcome
 *
 * L1–L9 run in transactions that end in ROLLBACK. L10 needs separate connections that can see each
 * other's committed rows, so it commits fixtures tagged with a random code and removes them in a
 * `finally`, as the database owner, with the append-only triggers suspended only for that cleanup.
 *
 * Run: node scripts/verify-cash-session-lifecycle.js        (DATABASE_URL from .env, or the env)
 * Exits non-zero if any check fails.
 */
require('dotenv').config()
const { Client } = require('pg')
const { randomBytes } = require('crypto')

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
  const sp = `lproof_${savepointSeq}`
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

/**
 * A year, an open period, a till with a difference account, an income code, a second cash point,
 * and the people: two cashiers, two supervisors, a witness, a verifier and a planner.
 */
async function fixtures(client, tag = 'LP') {
  const { rows: auth } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
  const authorityId = auth[0].id
  const person = async (key, role) => (await client.query(
    `INSERT INTO public.users (email, password_hash, name, role)
     VALUES ($1, 'x', $2, $3) RETURNING id`, [`${tag.toLowerCase()}.${key}@proof.test`, `${tag} ${key}`, role])).rows[0].id
  const P = {
    cashier: await person('cashier', 'cashier'),
    cashier2: await person('cashier2', 'cashier'),
    supervisor: await person('supervisor', 'cash_supervisor'),
    supervisor2: await person('supervisor2', 'cash_supervisor'),
    witness: await person('witness', 'accountant'),
    verifier: await person('verifier', 'accountant'),
    planner: await person('planner', 'planner'),
  }

  const { rows: year } = await client.query(
    `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES ($1, $2, $3, $4, 'open', 'USD') RETURNING id`, [authorityId, `${tag} proof year`, day(-30), day(330)])
  const yearId = year[0].id
  await client.query(
    `INSERT INTO finance.ledger_period (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 1, $3, $4, $5, 'open'), ($1, $2, 2, $6, $7, $8, 'open')`,
    [authorityId, yearId, `${tag}-1`, day(-30), day(30), `${tag}-2`, day(31), day(330)])
  const account = async (code, name, root, type) => (await client.query(
    `INSERT INTO finance.ledger_account (authority_id, code, name, root_type, account_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`, [authorityId, `${tag}-${code}`, name, root, type])).rows[0].id
  const A = {
    till: await account('TILL', 'Proof till', 'asset', 'cash'),
    till2: await account('TILL2', 'Proof till 2', 'asset', 'cash'),
    market: await account('MKT', 'Proof market fees', 'revenue', null),
    diff: await account('DIFF', 'Proof cash differences', 'expense', null),
  }
  const point = async (code, till) => (await client.query(
    `INSERT INTO finance.cash_point (authority_id, code, name, till_account_id, difference_account_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`, [authorityId, `${tag}-${code}`, `${tag} ${code} counter`, till, A.diff])).rows[0].id
  const pointId = await point('MAIN', A.till)
  const point2Id = await point('SIDE', A.till2)
  const { rows: codes } = await client.query(
    `INSERT INTO finance.income_code (authority_id, code, name, ledger_account_id, pricing)
     VALUES ($1, $2, 'Market fee', $3, 'variable') RETURNING id`, [authorityId, `${tag}-MKT`, A.market])
  return { authorityId, yearId, P, A, pointId, point2Id, market: codes[0].id }
}

const open = async (client, f, cashier, point, date = TODAY, floats = []) => (await client.query(
  'SELECT finance.open_cashier_session($1,$2,$3,$4,$5::jsonb) AS id',
  [point || f.pointId, cashier || f.P.cashier, f.yearId, date, JSON.stringify(floats)])).rows[0].id

const receiptSql = 'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb) AS id'
const receiptArgs = (f, session, by, amount = '10.00') =>
  [session, by || f.P.cashier, 'A. Payer', 'USD', 'cash', JSON.stringify([{ income_code_id: f.market, unit_amount: amount }])]
const receipt = async (client, f, session, by, amount) => (await client.query(receiptSql, receiptArgs(f, session, by, amount))).rows[0].id

/** Put a session's opening back in time, past the provisional threshold. */
const age = (client, session, hours) => client.query(
  `UPDATE finance.cashier_session SET opened_at = now() - make_interval(hours => $2) WHERE id = $1`, [session, hours])

const statusOf = async (client, s) => (await client.query('SELECT status FROM finance.cashier_session WHERE id = $1', [s])).rows[0].status
const events = async (client, s) => (await client.query(
  'SELECT event, actor_id, witness_id, reason, detail FROM finance.cashier_session_event WHERE cashier_session_id = $1 ORDER BY id', [s])).rows

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const db = (await client.query('SELECT current_database() AS d')).rows[0].d
  console.log(`database: ${db}`)
  const counts = async () => (await client.query(
    `SELECT (SELECT count(*) FROM finance.ledger_entry)::int AS entries,
            (SELECT count(*) FROM finance.cashier_session)::int AS sessions,
            (SELECT count(*) FROM finance.cashier_session_event)::int AS events,
            (SELECT count(*) FROM finance.cash_receipt)::int AS receipts,
            (SELECT count(*) FROM finance.cash_point_assignment)::int AS assignments`)).rows[0]
  const before = await counts()

  await inRollback(client, 'L1, L2 — suspended still holds the drawer; only the cashier suspends and resumes', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await expectError(client, 'somebody else cannot suspend the cashier\'s session',
      'SELECT finance.suspend_cashier_session($1,$2)', [s, f.P.supervisor], /only its cashier suspends/)
    await client.query('SELECT finance.suspend_cashier_session($1,$2)', [s, f.P.cashier])
    is('the session is suspended', await statusOf(client, s), 'suspended')
    await expectError(client, 'a second cashier cannot open a suspended drawer',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier2, f.yearId, TODAY], /uq_cashier_session_open_point|one drawer has one cashier/)
    await expectError(client, 'the suspended cashier cannot open a second drawer',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.point2Id, f.P.cashier, f.yearId, TODAY], /uq_cashier_session_open_cashier|already have a session open/)
    await expectError(client, 'a suspended session takes no receipts',
      receiptSql, receiptArgs(f, s), /is suspended and takes no more receipts/)
    await expectError(client, 'a suspended session is resumed before it is counted',
      'SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.P.cashier, '[]'], /resume it before counting/)
    await expectError(client, 'somebody else cannot resume it',
      'SELECT finance.resume_cashier_session($1,$2)', [s, f.P.cashier2], /only its cashier resumes/)
    await client.query('SELECT finance.resume_cashier_session($1,$2)', [s, f.P.cashier])
    await receipt(client, f, s)
    is('resumed, it takes receipts again', await statusOf(client, s), 'open')
    await expectError(client, 'an open session cannot be resumed',
      'SELECT finance.resume_cashier_session($1,$2)', [s, f.P.cashier], /only a suspended session can be resumed/)
  })

  await inRollback(client, 'L3 — only a supervisor finds a session abandoned, past the threshold, with a reason', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await expectError(client, 'a cashier cannot find a session abandoned',
      'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.cashier2, 'left the counter at noon'], /needs finance.cash.session.supervise/)
    await expectError(client, 'not before the threshold on the same business day',
      'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor, 'left the counter at noon'], /after 12 hours or once its business day has passed/)
    await age(client, s, 13)
    await expectError(client, 'not without a reason of ten characters',
      'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor, 'gone'], /at least ten characters/)
    // A supervisor who also holds a till cannot find their OWN session abandoned.
    await client.query(
      `INSERT INTO finance.user_permission_override (user_id, permission_code, effect, authority_id, reason, granted_by)
       VALUES ($1, 'finance.cash.session.supervise', 'grant', $2, 'proof only', $3)`, [f.P.cashier, f.authorityId, f.P.supervisor])
    await expectError(client, 'a supervisor-cashier cannot find their own session abandoned',
      'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.cashier, 'my own session, left open'], /your own/)
    await expectError(client, 'the record itself refuses an abandonment by the session\'s cashier',
      `UPDATE finance.cashier_session SET status = 'abandoned', abandoned_at = now(), abandoned_by = cashier_id,
              abandon_reason = 'direct write, bypassing the function' WHERE id = $1`, [s], /cashier_session_abandoned_by_another/)
    await client.query('SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor, 'cashier went home at 16:00 without cashing up'])
    is('the session is abandoned', await statusOf(client, s), 'abandoned')
    await expectError(client, 'it cannot be abandoned twice',
      'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor2, 'second supervisor finds it too'], /already abandoned/)
    await expectError(client, 'an abandoned session takes no receipts',
      receiptSql, receiptArgs(f, s), /is abandoned and takes no more receipts/)
    await expectError(client, 'its cashier cannot resume it',
      'SELECT finance.resume_cashier_session($1,$2)', [s, f.P.cashier], /only a suspended session can be resumed/)
    await expectError(client, 'its cashier cannot count it alone any more',
      'SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.P.cashier, '[]'], /counted under supervision/)
    await expectError(client, 'and the drawer is still held: nobody else can open it',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier2, f.yearId, TODAY], /uq_cashier_session_open_point|one drawer has one cashier/)
    await expectError(client, 'nor can its cashier open another drawer',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.point2Id, f.P.cashier, f.yearId, TODAY], /uq_cashier_session_open_cashier|already have a session open/)
  })

  await inRollback(client, 'L3, L9 — a session from a past business day: no receipts, and abandonable at once', async () => {
    const f = await fixtures(client)
    const s = await open(client, f, f.P.cashier, f.pointId, day(-1))
    await expectError(client, 'yesterday\'s session takes no receipt today',
      receiptSql, receiptArgs(f, s), /belongs to .* and takes no more receipts; cash it up and open today's/)
    const { rows } = await client.query('SELECT may_be_abandoned, is_stale FROM finance.v_cash_drawer WHERE cash_point_id = $1', [f.pointId])
    is('the drawers view marks it stale and abandonable', `${rows[0].is_stale}/${rows[0].may_be_abandoned}`, 'true/true')
    await client.query('SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor, 'session from yesterday never cashed up'])
    is('a past day\'s session is abandonable without waiting', await statusOf(client, s), 'abandoned')
  })

  await inRollback(client, 'L4, L5 — the supervised count: witnessed, explained, and verified by a fourth person', async () => {
    const f = await fixtures(client)
    const s = await open(client, f, f.P.cashier, f.pointId, TODAY, [{ currency: 'USD', amount: '50.00' }])
    await receipt(client, f, s, null, '30.00')
    await receipt(client, f, s, null, '20.00')
    await expectError(client, 'an open session is not counted under supervision',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, f.P.witness, '[]'], /only a session found abandoned/)
    await age(client, s, 13)
    await client.query('SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [s, f.P.supervisor, 'cashier left without cashing up'])
    const count = (total, explanation) => JSON.stringify([{ currency: 'USD', declared_total: total, ...(explanation ? { explanation } : {}) }])
    await expectError(client, 'a cashier cannot do the supervised count',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.cashier2, f.P.witness, count('100.00')], /needs finance.cash.session.supervise/)
    await expectError(client, 'there is always a witness',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, null, count('100.00')], /name the witness/)
    await expectError(client, 'the witness is not the cashier',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, f.P.cashier, count('100.00')], /somebody other than the cashier and the supervisor/)
    await expectError(client, 'the witness is not the supervisor counting',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, f.P.supervisor, count('100.00')], /somebody other than the cashier and the supervisor/)
    await expectError(client, 'the witness is staff who may see the cash office',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, f.P.planner, count('100.00')], /may see the cash office/)
    await expectError(client, 'a shortage is explained in writing (C6), under supervision as at the counter',
      'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)', [s, f.P.supervisor, f.P.witness, count('97.00')], /explained in writing/)
    await client.query('SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)',
      [s, f.P.supervisor, f.P.witness, count('97.00', 'three dollars short; cashier to be asked on return')])
    const { rows: c } = await client.query(
      'SELECT expected_takings::text e, declared_total::text d, variance::text v FROM finance.cashier_session_count WHERE cashier_session_id = $1', [s])
    is('the count is compared with float plus receipts', `${c[0].e}/${c[0].d}/${c[0].v}`, '50.00/97.00/-3.00')
    const { rows: who } = await client.query('SELECT status, closed_by, witness_id, cashier_id FROM finance.cashier_session WHERE id = $1', [s])
    is('closed, with the supervisor and witness named and the cashier still the cashier',
      `${who[0].status}/${who[0].closed_by === f.P.supervisor}/${who[0].witness_id === f.P.witness}/${who[0].cashier_id === f.P.cashier}`, 'closed/true/true/true')

    await expectError(client, 'the supervisor who counted cannot verify (C4 extended)',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.P.supervisor], /cashier_session_verified_by_another/)
    await expectError(client, 'the witness cannot verify',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.P.witness], /cashier_session_verified_by_another/)
    await expectError(client, 'the cashier cannot verify',
      'SELECT finance.verify_cashier_session($1,$2)', [s, f.P.cashier], /your own cash-up/)
    await expectError(client, 'the supervisor cannot send their own count back',
      'SELECT finance.return_cashier_session($1,$2,$3)', [s, f.P.supervisor, 'recount please'], /counted or witnessed/)

    await client.query('SELECT finance.return_cashier_session($1,$2,$3)', [s, f.P.verifier, 'recount the coins tray'])
    is('a supervised count returned for recount goes back to abandoned, not to the cashier', await statusOf(client, s), 'abandoned')
    await client.query('SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)',
      [s, f.P.supervisor2, f.P.witness, count('98.00', 'two dollars short after recount')])
    const s2 = await open(client, f, f.P.cashier2)
    ok('the counted drawer is free: another cashier opens it', s2)
    await expectError(client, 'once the drawer is reissued, the old count cannot be returned and take it back',
      'SELECT finance.return_cashier_session($1,$2,$3)', [s, f.P.verifier, 'one more recount'], /its drawer is now held by/)
    const { rows: n } = await client.query('SELECT finance.verify_cashier_session($1,$2,$3) AS n', [s, f.P.verifier, 'agreed with witness'])
    is('verified by a fourth person: two receipts and one difference journal posted', n[0].n, 3)
    const { rows: tb } = await client.query(
      `SELECT sum(debit - credit)::text AS net FROM finance.ledger_entry e JOIN finance.voucher v ON v.id = e.voucher_id
        WHERE v.financial_year_id = $1`, [f.yearId])
    is('the book still balances', tb[0].net, '0.00')
    const { rows: diffLine } = await client.query(
      `SELECT sum(debit)::text AS d FROM finance.ledger_entry WHERE ledger_account_id = $1`, [f.A.diff])
    is('the shortage is posted to the difference account, not absorbed', diffLine[0].d, '2.00')

    const ev = await events(client, s)
    is('the history reads open → float → abandoned → supervised count → returned → supervised count → verified',
      ev.map((e) => e.event).join(' '), 'opened float_recorded abandoned counted_under_supervision returned counted_under_supervision verified')
    const first = ev.find((e) => e.event === 'counted_under_supervision')
    is('the first count is kept as declared, after the return cleared it from the session',
      `${first.detail.counts[0].declared_total}/${first.detail.counts[0].variance}`, '97.00/-3.00')
    is('it names the witness', first.witness_id === f.P.witness, true)
    const returned = ev.find((e) => e.event === 'returned')
    is('the return records the count it sent back and why', `${returned.detail.counts_returned[0].declared_total}/${returned.reason}`, '97.00/recount the coins tray')
  })

  await inRollback(client, 'L5 — a cashier\'s own count, returned, goes back to the cashier', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await receipt(client, f, s)
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.P.cashier,
      JSON.stringify([{ currency: 'USD', declared_total: '12.00', explanation: 'two dollars over, unknown' }])])
    await client.query('SELECT finance.return_cashier_session($1,$2,$3)', [s, f.P.supervisor, 'please recount the notes'])
    is('returned to open', await statusOf(client, s), 'open')
    const ev = await events(client, s)
    is('the over-count is still on the record', ev.find((e) => e.event === 'counted').detail.counts[0].variance, '2.00')
  })

  await inRollback(client, 'L6, L7 — the history is append-only and the states move only one way', async () => {
    const f = await fixtures(client)
    const s = await open(client, f)
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.P.cashier, '[]'])
    await client.query('SELECT finance.verify_cashier_session($1,$2)', [s, f.P.verifier])
    await expectError(client, 'an event cannot be edited',
      `UPDATE finance.cashier_session_event SET reason = 'rewritten' WHERE cashier_session_id = $1`, [s], /append-only/)
    await expectError(client, 'an event cannot be deleted',
      'DELETE FROM finance.cashier_session_event WHERE cashier_session_id = $1', [s], /append-only/)
    await expectError(client, 'the history cannot be truncated', 'TRUNCATE finance.cashier_session_event', [], /append-only/)
    await expectError(client, 'a verified session cannot be reopened by a direct write',
      `UPDATE finance.cashier_session SET status = 'open' WHERE id = $1`, [s], /cannot go from verified to open/)
    await expectError(client, 'an open session cannot jump to verified',
      `UPDATE finance.cashier_session SET status = 'verified' WHERE id = $1`, [await open(client, f, f.P.cashier2)], /cannot go from open to verified/)
    await expectError(client, 'a session is never deleted',
      'DELETE FROM finance.cashier_session WHERE id = $1', [s], /never deleted/)
    const { rows } = await client.query(
      `SELECT has_table_privilege('vungu_app', 'finance.cashier_session_event', 'UPDATE') u,
              has_table_privilege('vungu_app', 'finance.cashier_session_event', 'DELETE') d,
              has_table_privilege('vungu_app', 'finance.cashier_session_event', 'INSERT') i,
              has_table_privilege('vungu_app', 'finance.cashier_session', 'DELETE') sd
         WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app')`)
    if (rows.length) is('the application role appends and never updates or deletes history', `${rows[0].i}/${rows[0].u}/${rows[0].d}/${rows[0].sd}`, 'true/false/false/false')
  })

  await inRollback(client, 'L8 — assignment and reassignment', async () => {
    const f = await fixtures(client)
    await expectError(client, 'nobody assigns themselves',
      'SELECT finance.assign_cashier($1,$2,$3)', [f.pointId, f.P.supervisor, f.P.supervisor], /assign yourself/)
    await expectError(client, 'only a till operator is assigned to a till',
      'SELECT finance.assign_cashier($1,$2,$3)', [f.pointId, f.P.witness, f.P.supervisor], /does not operate a till/)
    await expectError(client, 'a cashier cannot assign',
      'SELECT finance.assign_cashier($1,$2,$3)', [f.pointId, f.P.cashier2, f.P.cashier], /needs finance.cash.assignment.manage/)
    const a1 = (await client.query('SELECT finance.assign_cashier($1,$2,$3,CURRENT_DATE,NULL,$4) AS id', [f.pointId, f.P.cashier, f.P.supervisor, 'morning shift'])).rows[0].id
    await expectError(client, 'one live assignment per person per point',
      'SELECT finance.assign_cashier($1,$2,$3)', [f.pointId, f.P.cashier, f.P.supervisor2], /uq_cash_point_assignment_live/)
    await client.query(
      `UPDATE finance.setting SET value = '{"value": true, "provisional": true}'::jsonb
        WHERE authority_id = $1 AND key = 'cash.require_assignment'`, [f.authorityId])
    await expectError(client, 'with assignment required, an unassigned cashier cannot open the point',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier2, f.yearId, TODAY], /not assigned to cash point/)
    const s = await open(client, f)
    ok('the assigned cashier opens it', s)

    // Reassignment mid-shift: the drawer goes to cashier2 from now on, but cashier still holds it.
    await client.query('SELECT finance.end_cashier_assignment($1,$2,$3)', [a1, f.P.supervisor, 'moved to the market counter'])
    await client.query('SELECT finance.assign_cashier($1,$2,$3)', [f.pointId, f.P.cashier2, f.P.supervisor])
    is('ending the assignment does not touch the session in progress', await statusOf(client, s), 'open')
    await receipt(client, f, s)
    ok('the outgoing cashier still receipts in their own open session until it is counted')
    await expectError(client, 'the incoming cashier cannot take the drawer before it is counted',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier2, f.yearId, TODAY], /uq_cashier_session_open_point|one drawer has one cashier/)
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s, f.P.cashier, JSON.stringify([{ currency: 'USD', declared_total: '10.00' }])])
    const s2 = await open(client, f, f.P.cashier2)
    ok('after the count, the incoming cashier opens the drawer', s2)
    await client.query('SELECT finance.close_cashier_session($1,$2,$3::jsonb)', [s2, f.P.cashier2, '[]'])
    await expectError(client, 'an ended assignment no longer admits its cashier, the same day',
      'SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier, f.yearId, TODAY], /not assigned to cash point/)
    await expectError(client, 'an ended assignment cannot be ended again',
      'SELECT finance.end_cashier_assignment($1,$2,$3)', [a1, f.P.supervisor, 'again, by mistake'], /already ended/)
    await expectError(client, 'an ended assignment cannot be edited',
      `UPDATE finance.cash_point_assignment SET note = 'rewritten' WHERE id = $1`, [a1], /already ended and is part of the record/)
    await expectError(client, 'an assignment is never deleted',
      'DELETE FROM finance.cash_point_assignment WHERE id = $1', [a1], /ended, never deleted/)
  })

  const after = await counts()
  console.log(`\nsessions ${before.sessions} -> ${after.sessions}, events ${before.events} -> ${after.events}, `
    + `receipts ${before.receipts} -> ${after.receipts}, ledger ${before.entries} -> ${after.entries}, assignments ${before.assignments} -> ${after.assignments}`)
  if (JSON.stringify(before) === JSON.stringify(after)) ok('L1–L9 wrote nothing', 'every proof ran inside a transaction that was rolled back')
  else bad('L1–L9 wrote nothing', 'rows persisted past the rollback')

  await concurrency(client)
  const final = await counts()
  if (JSON.stringify(before) === JSON.stringify(final)) ok('L10 left nothing behind', 'its committed fixtures were removed')
  else bad('L10 left nothing behind', `before ${JSON.stringify(before)} after ${JSON.stringify(final)}`)

  await client.end()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

/** Two connections that see each other's commits. Fixtures are committed, then removed. */
async function concurrency(owner) {
  console.log('\nL10 — concurrency, on separate connections')
  const tag = `LC${randomBytes(3).toString('hex').toUpperCase()}`
  const a = new Client({ connectionString: process.env.DATABASE_URL })
  const b = new Client({ connectionString: process.env.DATABASE_URL })
  await a.connect()
  await b.connect()
  let f
  const seq = async () => (await owner.query(
    `SELECT COALESCE((SELECT last_no FROM finance.document_sequence ds JOIN public.local_authorities la ON la.id = ds.authority_id
                       WHERE la.code = 'VUNGU' AND ds.kind = 'cashier_session'), 0)::int AS n`)).rows[0].n
  const seqBefore = await seq()
  try {
    await owner.query('BEGIN')
    f = await fixtures(owner, tag)
    await owner.query('COMMIT')

    // Two cashiers press "Open till" on the same drawer at the same moment.
    await a.query('BEGIN')
    await a.query('SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier, f.yearId, TODAY])
    await b.query('BEGIN')
    const racing = b.query('SELECT finance.open_cashier_session($1,$2,$3,$4)', [f.pointId, f.P.cashier2, f.yearId, TODAY])
      .then(() => 'opened', (err) => err.message)
    await new Promise((r) => setTimeout(r, 300))
    await a.query('COMMIT')
    const second = await racing
    await b.query('ROLLBACK')
    is('two cashiers racing for one drawer: the second is refused once the first commits',
      /uq_cashier_session_open_point|one drawer has one cashier/.test(second), true, second.split('\n')[0])
    const { rows: held } = await owner.query(
      `SELECT count(*)::int n FROM finance.cashier_session WHERE cash_point_id = $1 AND status IN ('open','suspended','abandoned')`, [f.pointId])
    is('exactly one session holds the drawer', held[0].n, 1)
    const session = (await owner.query('SELECT id FROM finance.cashier_session WHERE cash_point_id = $1', [f.pointId])).rows[0].id
    await age(owner, session, 13)

    // A receipt and an abandonment arrive together: the abandonment holds the row lock first.
    await a.query('BEGIN')
    await a.query('SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [session, f.P.supervisor, 'two supervisors and a receipt race'])
    await b.query('BEGIN')
    const receiptRace = b.query(receiptSql, receiptArgs(f, session)).then(() => 'receipted', (err) => err.message)
    const c = new Client({ connectionString: process.env.DATABASE_URL })
    await c.connect()
    await c.query('BEGIN')
    const abandonRace = c.query('SELECT finance.mark_cashier_session_abandoned($1,$2,$3)', [session, f.P.supervisor2, 'the second supervisor, a moment later'])
      .then(() => 'abandoned twice', (err) => err.message)
    await new Promise((r) => setTimeout(r, 300))
    await a.query('COMMIT')
    const [r1, r2] = await Promise.all([receiptRace, abandonRace])
    await b.query('ROLLBACK')
    await c.query('ROLLBACK')
    await c.end()
    is('a receipt racing an abandonment is refused once the abandonment commits', /is abandoned and takes no more receipts/.test(r1), true, r1.split('\n')[0])
    is('a second supervisor racing the first is told it is already abandoned', /already abandoned/.test(r2), true, r2.split('\n')[0])
    const { rows: ev } = await owner.query(
      `SELECT count(*)::int n FROM finance.cashier_session_event WHERE cashier_session_id = $1 AND event = 'abandoned'`, [session])
    is('exactly one abandonment is on the record', ev[0].n, 1)
    const { rows: rc } = await owner.query('SELECT count(*)::int n FROM finance.cash_receipt WHERE cashier_session_id = $1', [session])
    is('and no receipt was taken in the abandoned session', rc[0].n, 0)
  } catch (err) {
    bad('L10 harness', err.message)
  } finally {
    await a.end().catch(() => {})
    await b.end().catch(() => {})
    await cleanup(owner, tag)
    // The race committed one session, which took a session number. Give it back only if nobody
    // else has taken one since, so a real session never shares or skips a number because of this.
    await owner.query(
      `UPDATE finance.document_sequence ds SET last_no = $1
         FROM public.local_authorities la
        WHERE la.id = ds.authority_id AND la.code = 'VUNGU' AND ds.kind = 'cashier_session' AND ds.last_no = $1 + 1`, [seqBefore])
    is('the session number the race used is given back', await seq(), seqBefore)
  }
}

/** Remove L10's committed fixtures. The append-only triggers are suspended for this only. */
async function cleanup(client, tag) {
  try {
    await client.query('BEGIN')
    const yearIds = (await client.query('SELECT id FROM finance.financial_year WHERE label = $1', [`${tag} proof year`])).rows.map((r) => r.id)
    const sessions = `SELECT id FROM finance.cashier_session WHERE financial_year_id = ANY($1)`
    await client.query('ALTER TABLE finance.cashier_session_event DISABLE TRIGGER trg_cashier_session_event_immutable')
    await client.query('ALTER TABLE finance.cashier_session DISABLE TRIGGER trg_cashier_session_transition')
    await client.query('ALTER TABLE finance.cash_point_assignment DISABLE TRIGGER trg_cash_point_assignment_guard')
    await client.query(`DELETE FROM finance.cashier_session_event WHERE cashier_session_id IN (${sessions})`, [yearIds])
    await client.query(`DELETE FROM finance.cashier_session_count WHERE cashier_session_id IN (${sessions})`, [yearIds])
    await client.query('DELETE FROM finance.cashier_session WHERE financial_year_id = ANY($1)', [yearIds])
    await client.query('DELETE FROM finance.cash_point_assignment WHERE cash_point_id IN (SELECT id FROM finance.cash_point WHERE code LIKE $1)', [`${tag}-%`])
    await client.query('ALTER TABLE finance.cashier_session_event ENABLE TRIGGER trg_cashier_session_event_immutable')
    await client.query('ALTER TABLE finance.cashier_session ENABLE TRIGGER trg_cashier_session_transition')
    await client.query('ALTER TABLE finance.cash_point_assignment ENABLE TRIGGER trg_cash_point_assignment_guard')
    await client.query('DELETE FROM finance.income_code WHERE code LIKE $1', [`${tag}-%`])
    await client.query('DELETE FROM finance.cash_point WHERE code LIKE $1', [`${tag}-%`])
    await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = ANY($1)', [yearIds])
    await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${tag}-%`])
    await client.query('DELETE FROM finance.financial_year WHERE id = ANY($1)', [yearIds])
    await client.query('DELETE FROM public.users WHERE email LIKE $1', [`${tag.toLowerCase()}.%@proof.test`])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    bad('L10 cleanup', `${err.message} — remove rows tagged ${tag} by hand`)
  }
}

main().catch((err) => { console.error('\nharness error:', err.message); process.exit(2) })
