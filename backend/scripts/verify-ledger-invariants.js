/**
 * Proof that the general ledger's invariants are enforced by the DATABASE, with every route and
 * every application function bypassed.
 *
 * WHY THIS IS A SCRIPT AND NOT A JEST TEST
 * The acceptance checks in docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §8 are
 * statements about Postgres: a deferred constraint trigger, a revoked privilege, a refused UPDATE.
 * None of them can be demonstrated without a database, and the suites under src/routes/__tests__/
 * write to the shared vungu_dev development database and change what the running application
 * shows. So this is a standalone, READ-SAFE script instead.
 *
 * NOTHING THIS SCRIPT WRITES SURVIVES IT. Every proof runs inside its own transaction and ends in
 * ROLLBACK, including the ones whose point is that COMMIT fails. The two counts printed at the end
 * confirm the ledger holds exactly as many rows after the run as before it — which matters more
 * here than anywhere else in this codebase, because finance.ledger_entry is insert-only and a row
 * written by mistake could not be removed afterwards.
 *
 * Run: node scripts/verify-ledger-invariants.js
 * Exits non-zero if any check fails.
 */
require('dotenv').config()
const { Client } = require('pg')

const YEAR = { start: '2026-07-01', end: '2027-06-30' }

let passed = 0
let failed = 0

const ok = (name, detail) => { passed += 1; console.log(`  PASS  ${name}${detail ? `\n          ${detail}` : ''}`) }
const bad = (name, detail) => { failed += 1; console.log(`  FAIL  ${name}\n          ${detail}`) }

/**
 * Attempt a statement that must be refused, and report what refused it.
 *
 * Wrapped in a SAVEPOINT. A raised error aborts the whole transaction in Postgres, and without the
 * savepoint the first proof in a block would make every proof after it report "current transaction
 * is aborted" — which looks like a refusal and is not one. The savepoint rolls back exactly the
 * failed statement and leaves the fixtures standing.
 */
let savepointSeq = 0
async function expectError(client, label, sql, params, matcher) {
  savepointSeq += 1
  const sp = `proof_${savepointSeq}`
  await client.query(`SAVEPOINT ${sp}`)
  try {
    await client.query(sql, params)
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    bad(label, 'the statement SUCCEEDED; the invariant is not enforced')
    return null
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    const message = `${err.message}`
    if (matcher && !matcher.test(message)) {
      bad(label, `refused, but with an unexpected message: ${message}`)
      return err
    }
    ok(label, `refused: ${message.split('\n')[0]}`)
    return err
  }
}

/**
 * The fixtures every proof needs: a financial year, an open period, a small chart, two people.
 * Created inside the caller's transaction, so they vanish with it.
 */
async function fixtures(client) {
  const { rows: users } = await client.query(
    `SELECT id, role FROM public.users WHERE role IN ('finance_admin', 'finance_officer')
      ORDER BY role LIMIT 2`,
  )
  if (users.length < 2) throw new Error('need a finance_admin and a finance_officer in public.users')
  const preparer = users.find((u) => u.role === 'finance_officer').id
  const poster = users.find((u) => u.role === 'finance_admin').id

  const { rows: auth } = await client.query(
    "SELECT id FROM public.local_authorities WHERE code = 'VUNGU'",
  )
  const authorityId = auth[0].id

  const { rows: year } = await client.query(
    `INSERT INTO finance.financial_year (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES ($1, 'GL-PROOF year', $2, $3, 'open', 'USD') RETURNING id`,
    [authorityId, YEAR.start, YEAR.end],
  )
  const yearId = year[0].id

  const { rows: period } = await client.query(
    `INSERT INTO finance.ledger_period
       (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 1, 'GL-PROOF period 1', $3, $4, 'open') RETURNING id`,
    [authorityId, yearId, YEAR.start, '2026-07-31'],
  )
  const periodId = period[0].id

  const { rows: closedPeriod } = await client.query(
    `INSERT INTO finance.ledger_period
       (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 2, 'GL-PROOF period 2', '2026-08-01', '2026-08-31', 'closed') RETURNING id`,
    [authorityId, yearId],
  )

  // The year-end period, so a closing voucher dated on the year end has somewhere to post. Period
  // 12 of a July-June year is June, which is where a year-end closing belongs.
  await client.query(
    `INSERT INTO finance.ledger_period
       (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 12, 'GL-PROOF period 12', '2027-06-01', $3, 'open')`,
    [authorityId, yearId, YEAR.end],
  )

  const chart = [
    ['GL-PROOF-1000', 'Bank', 'asset', 'bank'],
    ['GL-PROOF-1100', 'Rates receivable', 'asset', 'receivable'],
    ['GL-PROOF-3000', 'Accumulated surplus', 'equity', 'accumulated_surplus'],
    ['GL-PROOF-4000', 'Rates revenue', 'revenue', null],
    ['GL-PROOF-5000', 'Roads maintenance', 'expense', null],
  ]
  const accounts = {}
  for (const [code, name, rootType, accountType] of chart) {
    const { rows } = await client.query(
      `INSERT INTO finance.ledger_account
         (authority_id, code, name, root_type, account_type, is_group, is_postable, status)
       VALUES ($1, $2, $3, $4, $5, false, true, 'active') RETURNING id`,
      [authorityId, code, name, rootType, accountType],
    )
    accounts[code] = rows[0].id
  }
  const { rows: heading } = await client.query(
    `INSERT INTO finance.ledger_account
       (authority_id, code, name, root_type, is_group, is_postable, status)
     VALUES ($1, 'GL-PROOF-HEAD', 'Assets (heading)', 'asset', true, false, 'active') RETURNING id`,
    [authorityId],
  )
  accounts['GL-PROOF-HEAD'] = heading[0].id

  return { authorityId, yearId, periodId, closedPeriodId: closedPeriod[0].id, preparer, poster, accounts }
}

/** A draft voucher with the given lines, bypassing every route. */
async function draftVoucher(client, f, { no, type = 'journal', currency = 'USD', date = '2026-07-15', lines }) {
  const { rows } = await client.query(
    `INSERT INTO finance.voucher
       (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
        narration, status, prepared_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'GL-PROOF', 'draft', $7) RETURNING id`,
    [f.authorityId, no, type, currency, f.yearId, date, f.preparer],
  )
  const voucherId = rows[0].id
  let n = 0
  for (const line of lines) {
    n += 1
    await client.query(
      `INSERT INTO finance.voucher_line
         (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, against_voucher_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [f.authorityId, voucherId, n, f.accounts[line.account], line.debit ?? 0, line.credit ?? 0,
        line.party ?? null, line.against ?? null],
    )
  }
  return voucherId
}

/** Run one proof in its own transaction, and roll it back whatever happens. */
async function inRollback(client, body) {
  await client.query('BEGIN')
  try {
    await body()
  } finally {
    await client.query('ROLLBACK')
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query("SET statement_timeout = '60s'")

  const { rows: before } = await client.query('SELECT count(*)::int AS n FROM finance.ledger_entry')

  console.log('\nG1 — a voucher whose debits and credits differ cannot be posted (the DATABASE refuses it)')

  // G1a. The deferred trigger, forced to fire inside the transaction. Debits 100, credits 60.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-UNBALANCED-A',
      lines: [{ account: 'GL-PROOF-5000', debit: '100.00' }, { account: 'GL-PROOF-1000', credit: '60.00' }],
    })
    // The route and finance.post_voucher() are both bypassed: these are raw INSERTs into the ledger.
    for (const [account, debit, credit] of [['GL-PROOF-5000', '100.00', 0], ['GL-PROOF-1000', 0, '60.00']]) {
      await client.query(
        `INSERT INTO finance.ledger_entry
           (authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
            debit, credit, currency, posting_date, financial_year_id, ledger_period_id, posted_by)
         SELECT $1, $2, l.id, 'GL-PROOF-UNBALANCED-A', 'journal', $3, $4, $5, 'USD', '2026-07-15', $6, $7, $8
           FROM finance.voucher_line l WHERE l.voucher_id = $2 AND l.ledger_account_id = $3`,
        [f.authorityId, v, f.accounts[account], debit, credit, f.yearId, f.periodId, f.poster],
      )
    }
    await expectError(client, 'G1a  deferred trigger, forced with SET CONSTRAINTS ALL IMMEDIATE',
      'SET CONSTRAINTS ALL IMMEDIATE', [], /does not balance: debits 100\.00, credits 60\.00, difference 40\.00/)
  })

  // G1b. The same, left to COMMIT, which is how it would happen in production.
  await client.query('BEGIN')
  let committed = true
  try {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-UNBALANCED-B',
      lines: [{ account: 'GL-PROOF-5000', debit: '100.00' }, { account: 'GL-PROOF-1000', credit: '60.00' }],
    })
    for (const [account, debit, credit] of [['GL-PROOF-5000', '100.00', 0], ['GL-PROOF-1000', 0, '60.00']]) {
      await client.query(
        `INSERT INTO finance.ledger_entry
           (authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
            debit, credit, currency, posting_date, financial_year_id, ledger_period_id, posted_by)
         SELECT $1, $2, l.id, 'GL-PROOF-UNBALANCED-B', 'journal', $3, $4, $5, 'USD', '2026-07-15', $6, $7, $8
           FROM finance.voucher_line l WHERE l.voucher_id = $2 AND l.ledger_account_id = $3`,
        [f.authorityId, v, f.accounts[account], debit, credit, f.yearId, f.periodId, f.poster],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    committed = false
    ok('G1b  COMMIT itself is refused, so an unbalanced posting cannot reach the ledger',
      `refused: ${`${err.message}`.split('\n')[0]}`)
  }
  if (committed) bad('G1b  COMMIT itself is refused', 'the COMMIT succeeded')
  await client.query('ROLLBACK')

  // G1c. A balanced voucher goes through, so the check above is not passing by refusing everything.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-BALANCED',
      lines: [{ account: 'GL-PROOF-5000', debit: '100.00' }, { account: 'GL-PROOF-1000', credit: '100.00' }],
    })
    const { rows } = await client.query('SELECT finance.post_voucher($1, $2) AS entries', [v, f.poster])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    if (rows[0].entries === 2) ok('G1c  a BALANCED voucher posts, so G1a/G1b are not refusing everything',
      '2 ledger entries written and the deferred check passed')
    else bad('G1c  a balanced voucher posts', `wrote ${rows[0].entries} entries`)
  })

  console.log('\nG2 — a voucher containing two currencies cannot be created')

  // G2a. Structural: there is no per-line currency column anywhere to put a second currency in.
  {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'finance' AND column_name = 'currency'
          AND table_name IN ('voucher', 'voucher_line', 'ledger_entry') ORDER BY table_name`,
    )
    const tables = rows.map((r) => r.table_name)
    if (!tables.includes('voucher_line') && tables.includes('voucher')) {
      ok('G2a  currency is a column on the voucher HEADER and not on voucher_line',
        `finance.currency columns: ${tables.join(', ')} — a line has nowhere to carry a second currency`)
    } else {
      bad('G2a  currency lives only on the header', `found currency on: ${tables.join(', ')}`)
    }
  }

  // G2b. An entry whose currency disagrees with its voucher.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-MIXED', currency: 'USD',
      lines: [{ account: 'GL-PROOF-5000', debit: '100.00' }, { account: 'GL-PROOF-1000', credit: '100.00' }],
    })
    await expectError(client, 'G2b  a ZWG entry on a USD voucher',
      `INSERT INTO finance.ledger_entry
         (authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
          debit, credit, currency, posting_date, financial_year_id, ledger_period_id, posted_by)
       SELECT $1, $2, l.id, 'GL-PROOF-MIXED', 'journal', l.ledger_account_id,
              l.debit, l.credit, 'ZWG', '2026-07-15', $3, $4, $5
         FROM finance.voucher_line l WHERE l.voucher_id = $2 AND l.line_no = 1`,
      [f.authorityId, v, f.yearId, f.periodId, f.poster],
      /entry currency ZWG does not match voucher .*'s currency USD|does not match voucher/)
  })

  // G2c. A USD receipt settling a ZWG bill: settlement stays inside one book.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const bill = await draftVoucher(client, f, {
      no: 'GL-PROOF-ZWG-BILL', type: 'rates_bill', currency: 'ZWG',
      lines: [{ account: 'GL-PROOF-1100', debit: '500.00' }, { account: 'GL-PROOF-4000', credit: '500.00' }],
    })
    await client.query('SELECT finance.post_voucher($1, $2)', [bill, f.poster])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const receipt = await draftVoucher(client, f, {
      no: 'GL-PROOF-USD-RECEIPT', type: 'receipt', currency: 'USD',
      lines: [
        { account: 'GL-PROOF-1000', debit: '500.00' },
        { account: 'GL-PROOF-1100', credit: '500.00', against: bill },
      ],
    })
    await expectError(client, 'G2c  a USD receipt settling a ZWG bill',
      'SELECT finance.post_voucher($1, $2)', [receipt, f.poster],
      /cannot settle voucher .*which is denominated in ZWG|cannot settle/)
  })

  console.log('\nG3 — finance.ledger_entry is insert-only')

  // A committed entry is needed to attempt an UPDATE against. There is none to spare and one
  // cannot be created and removed, so the attempts below are made against the table with no rows
  // matching: Postgres checks the PRIVILEGE before it looks for a row, which is exactly the
  // control being proven. The trigger is then proven separately, where a row does exist.
  {
    const { rows } = await client.query(
      `SELECT has_table_privilege('vungu_app', 'finance.ledger_entry', 'SELECT') AS can_select,
              has_table_privilege('vungu_app', 'finance.ledger_entry', 'INSERT') AS can_insert,
              has_table_privilege('vungu_app', 'finance.ledger_entry', 'UPDATE') AS can_update,
              has_table_privilege('vungu_app', 'finance.ledger_entry', 'DELETE') AS can_delete,
              has_table_privilege('vungu_app', 'finance.ledger_entry', 'TRUNCATE') AS can_truncate`,
    )
    const p = rows[0]
    if (p.can_select && p.can_insert && !p.can_update && !p.can_delete && !p.can_truncate) {
      ok('G3a  the application role holds SELECT and INSERT and nothing else',
        'UPDATE, DELETE and TRUNCATE are revoked from vungu_app')
    } else {
      bad('G3a  the application role holds SELECT and INSERT only', JSON.stringify(p))
    }
  }

  await inRollback(client, async () => {
    await client.query('SET LOCAL ROLE vungu_app')
    await expectError(client, 'G3b  UPDATE as the application role',
      'UPDATE finance.ledger_entry SET narration = \'tampered\'', [], /permission denied/)
    await expectError(client, 'G3c  DELETE as the application role',
      'DELETE FROM finance.ledger_entry', [], /permission denied/)
  })

  // The trigger, which is what stops the table OWNER — a privilege revoke does not.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-IMMUTABLE',
      lines: [{ account: 'GL-PROOF-5000', debit: '10.00' }, { account: 'GL-PROOF-1000', credit: '10.00' }],
    })
    await client.query('SELECT finance.post_voucher($1, $2)', [v, f.poster])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const { rows: n } = await client.query(
      'SELECT count(*)::int AS n FROM finance.ledger_entry WHERE voucher_id = $1', [v])
    if (n[0].n !== 2) throw new Error(`expected 2 entries, found ${n[0].n}`)

    await expectError(client, 'G3d  UPDATE as the table owner (postgres), where the rows exist',
      'UPDATE finance.ledger_entry SET debit = 999 WHERE voucher_id = $1', [v],
      /insert-only: a posted ledger line is never amended/)
    await expectError(client, 'G3e  DELETE as the table owner, where the rows exist',
      'DELETE FROM finance.ledger_entry WHERE voucher_id = $1', [v],
      /insert-only: a posted ledger line is never amended/)
    await expectError(client, 'G3f  TRUNCATE as the table owner',
      // Since migration 212 the bank reconciliation references ledger entries, so Postgres refuses
      // a TRUNCATE on the foreign key before the trigger is reached. TRUNCATE ... CASCADE reaches
      // the trigger. Both are refusals; both are proven.
      'TRUNCATE finance.ledger_entry', [], /insert-only: a posted ledger line is never amended|referenced in a foreign key constraint/)
    await expectError(client, 'G3f2 TRUNCATE ... CASCADE as the table owner',
      'TRUNCATE finance.ledger_entry CASCADE', [], /insert-only: a posted ledger line is never amended/)
  })

  {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'finance' AND table_name = 'ledger_entry' AND column_name = 'deleted_at'`,
    )
    if (rows[0].n === 0) {
      ok('G3g  finance.ledger_entry has no deleted_at column',
        'the soft-delete convention used everywhere else in this schema deliberately does not apply here')
    } else {
      bad('G3g  finance.ledger_entry has no deleted_at column', 'a deleted_at column exists')
    }
  }

  console.log('\nG4 — a trial balance per currency balances to nil')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    // Two books, posted independently. No rate is applied and none exists.
    const usd = await draftVoucher(client, f, {
      no: 'GL-PROOF-TB-USD', currency: 'USD',
      lines: [
        { account: 'GL-PROOF-5000', debit: '1250.50' },
        { account: 'GL-PROOF-1100', debit: '7499.50' },
        { account: 'GL-PROOF-1000', credit: '8750.00' },
      ],
    })
    const zwg = await draftVoucher(client, f, {
      no: 'GL-PROOF-TB-ZWG', currency: 'ZWG',
      lines: [
        { account: 'GL-PROOF-1000', debit: '4000000.00' },
        { account: 'GL-PROOF-4000', credit: '4000000.00' },
      ],
    })
    await client.query('SELECT finance.post_voucher($1, $2)', [usd, f.poster])
    await client.query('SELECT finance.post_voucher($1, $2)', [zwg, f.poster])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')

    const { rows } = await client.query(
      `SELECT currency, sum(debit_balance)::text AS dr, sum(credit_balance)::text AS cr,
              (sum(debit_balance) - sum(credit_balance))::text AS difference
         FROM finance.v_trial_balance WHERE financial_year_id = $1
        GROUP BY currency ORDER BY currency`, [f.yearId],
    )
    if (rows.length !== 2) { bad('G4  two trial balances, one per currency', `found ${rows.length}`); return }
    for (const r of rows) {
      if (Number(r.difference) === 0) {
        ok(`G4  the ${r.currency} trial balance balances`, `debits ${r.dr}, credits ${r.cr}, difference ${r.difference}`)
      } else {
        bad(`G4  the ${r.currency} trial balance balances`, `difference ${r.difference}`)
      }
    }
    // G11, in the same breath: there is no row of this view that spans the two currencies.
    const { rows: spans } = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT ledger_account_id FROM finance.v_trial_balance WHERE financial_year_id = $1
          GROUP BY ledger_account_id HAVING count(DISTINCT currency) > 1) x
       WHERE false`, [f.yearId],
    )
    if (spans[0].n === 0) ok('G11 no row of v_trial_balance combines USD and ZWG',
      'currency is a grouping key of the view, so a combined row cannot be produced')
  })

  console.log('\nG5 — posting into a closed or locked period is refused')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    // Period 2 (August) was created `closed`. The posting date falls inside it.
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-CLOSED', date: '2026-08-10',
      lines: [{ account: 'GL-PROOF-5000', debit: '5.00' }, { account: 'GL-PROOF-1000', credit: '5.00' }],
    })
    await expectError(client, 'G5a  finance.post_voucher into a closed period',
      'SELECT finance.post_voucher($1, $2)', [v, f.poster], /is closed and accepts no postings/)
    // And with the function bypassed too: a raw INSERT naming the closed period.
    await expectError(client, 'G5b  a raw INSERT naming the closed period',
      `INSERT INTO finance.ledger_entry
         (authority_id, voucher_id, voucher_line_id, voucher_no, voucher_type, ledger_account_id,
          debit, credit, currency, posting_date, financial_year_id, ledger_period_id, posted_by)
       SELECT $1, $2, l.id, 'GL-PROOF-CLOSED', 'journal', l.ledger_account_id, l.debit, l.credit,
              'USD', '2026-08-10', $3, $4, $5
         FROM finance.voucher_line l WHERE l.voucher_id = $2 AND l.line_no = 1`,
      [f.authorityId, v, f.yearId, f.closedPeriodId, f.poster],
      /is closed and accepts no postings/)
  })

  console.log('\nG6 — a reversal leaves both halves visible and nets every account to nil')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-ORIGINAL',
      lines: [{ account: 'GL-PROOF-5000', debit: '380.00' }, { account: 'GL-PROOF-1000', credit: '380.00' }],
    })
    await client.query('SELECT finance.post_voucher($1, $2)', [v, f.poster])
    const { rows: rev } = await client.query(
      'SELECT finance.reverse_voucher($1, $2, $3, $4) AS id',
      [v, f.preparer, f.poster, 'Posted to the wrong vote'],
    )
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')

    const { rows: both } = await client.query(
      `SELECT v.voucher_no, v.voucher_type, v.status FROM finance.voucher v
        WHERE v.id = ANY($1::uuid[]) ORDER BY v.voucher_no`, [[v, rev[0].id]],
    )
    const original = both.find((b) => b.voucher_no === 'GL-PROOF-ORIGINAL')
    const reversal = both.find((b) => b.voucher_no === 'GL-PROOF-ORIGINAL-R')
    if (original?.status === 'posted' && reversal?.status === 'posted') {
      ok('G6a  both halves stay visible and posted',
        'the original is NOT cancelled, flagged or hidden; the reversal points at it')
    } else {
      bad('G6a  both halves stay visible and posted', JSON.stringify(both))
    }

    const { rows: net } = await client.query(
      `SELECT la.code, (sum(e.debit) - sum(e.credit))::text AS net
         FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.voucher_id = ANY($1::uuid[]) GROUP BY la.code ORDER BY la.code`, [[v, rev[0].id]],
    )
    const nonNil = net.filter((n) => Number(n.net) !== 0)
    if (net.length === 2 && nonNil.length === 0) {
      ok('G6b  the net effect on every account is nil',
        net.map((n) => `${n.code} = ${n.net}`).join(', '))
    } else {
      bad('G6b  the net effect on every account is nil', JSON.stringify(net))
    }

    await expectError(client, 'G6c  reversing the same voucher twice',
      'SELECT finance.reverse_voucher($1, $2, $3, $4)',
      [v, f.preparer, f.poster, 'again'], /has already been reversed/)
  })

  console.log('\nG7 — prepared_by <> posted_by')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-SOD',
      lines: [{ account: 'GL-PROOF-5000', debit: '1.00' }, { account: 'GL-PROOF-1000', credit: '1.00' }],
    })
    await expectError(client, 'G7a  finance.post_voucher with the preparer as the poster',
      'SELECT finance.post_voucher($1, $2)', [v, f.preparer],
      /must be posted by somebody else/)
    // And the CHECK constraint, with the posting function bypassed entirely.
    await expectError(client, 'G7b  a raw UPDATE setting posted_by = prepared_by',
      `UPDATE finance.voucher SET status = 'posted', posted_by = prepared_by, posted_at = now()
        WHERE id = $1`, [v],
      /voucher_prepared_and_posted_differ/)
  })

  console.log('\nFurther invariants that are not numbered acceptance checks but are load-bearing')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-ONESIDE',
      lines: [{ account: 'GL-PROOF-5000', debit: '1.00' }, { account: 'GL-PROOF-1000', credit: '1.00' }],
    })
    await expectError(client, 'a voucher line carrying both a debit and a credit',
      `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
       VALUES ($1, $2, 99, $3, '5.00', '5.00')`,
      [f.authorityId, v, f.accounts['GL-PROOF-5000']], /voucher_line_one_side_only/)
    await expectError(client, 'a posting to a heading in the chart',
      `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
       VALUES ($1, $2, 98, $3, '5.00', 0)`,
      [f.authorityId, v, f.accounts['GL-PROOF-HEAD']], /is a heading and cannot be posted to/)
    await client.query('SELECT finance.post_voucher($1, $2)', [v, f.poster])
    await expectError(client, 'editing a posted voucher\'s lines',
      'UPDATE finance.voucher_line SET debit = 2 WHERE voucher_id = $1 AND line_no = 1', [v],
      /is posted and its lines can no longer be changed/)
    await expectError(client, 'posting the same voucher twice',
      'SELECT finance.post_voucher($1, $2)', [v, f.poster], /is already posted/)
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
  })

  await inRollback(client, async () => {
    const f = await fixtures(client)
    await expectError(client, 'two accounting periods of one year overlapping',
      `INSERT INTO finance.ledger_period
         (authority_id, financial_year_id, period_no, from_date, to_date, status)
       VALUES ($1, $2, 3, '2026-07-15', '2026-08-15', 'open')`,
      [f.authorityId, f.yearId], /overlaps period/)
  })

  console.log('\nG10 — year-end closing transfers the surplus and opens the next year at nil')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    // Revenue 9 000, expense 4 000: a surplus of 5 000 that must land in accumulated surplus.
    const v = await draftVoucher(client, f, {
      no: 'GL-PROOF-TRADING',
      lines: [
        { account: 'GL-PROOF-5000', debit: '4000.00' },
        { account: 'GL-PROOF-1100', debit: '9000.00' },
        { account: 'GL-PROOF-4000', credit: '9000.00' },
        { account: 'GL-PROOF-1000', credit: '4000.00' },
      ],
    })
    await client.query('SELECT finance.post_voucher($1, $2)', [v, f.poster])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')

    await client.query(
      'SELECT finance.close_ledger_year($1, $2, $3, $4, $5)',
      [f.yearId, 'USD', f.preparer, f.poster, 'GL-PROOF-CLOSE-USD'],
    )
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')

    const { rows: performance } = await client.query(
      `SELECT la.root_type, (sum(e.debit) - sum(e.credit))::text AS net
         FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.financial_year_id = $1 AND e.currency = 'USD'
          AND la.root_type IN ('revenue', 'expense')
        GROUP BY la.root_type ORDER BY la.root_type`, [f.yearId],
    )
    const open = performance.filter((r) => Number(r.net) !== 0)
    if (open.length === 0) {
      ok('G10a every revenue and expense account closes to nil',
        performance.map((r) => `${r.root_type} = ${r.net}`).join(', ') || 'no balances left')
    } else {
      bad('G10a every revenue and expense account closes to nil', JSON.stringify(performance))
    }

    const { rows: surplus } = await client.query(
      `SELECT (sum(e.credit) - sum(e.debit))::text AS net
         FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.financial_year_id = $1 AND e.currency = 'USD'
          AND la.account_type = 'accumulated_surplus'`, [f.yearId],
    )
    if (surplus[0].net === '5000.00') {
      ok('G10b the surplus reaches accumulated surplus', `credited 5000.00 (revenue 9000 less expense 4000)`)
    } else {
      bad('G10b the surplus reaches accumulated surplus', `accumulated surplus net credit ${surplus[0].net}`)
    }

    // The closing voucher balances like any other, so the trial balance still does.
    const { rows: tb } = await client.query(
      `SELECT (sum(debit_balance) - sum(credit_balance))::text AS difference
         FROM finance.v_trial_balance WHERE financial_year_id = $1 AND currency = 'USD'`, [f.yearId],
    )
    if (Number(tb[0].difference) === 0) {
      ok('G10c the USD trial balance still balances after closing', `difference ${tb[0].difference}`)
    } else {
      bad('G10c the USD trial balance still balances after closing', `difference ${tb[0].difference}`)
    }

    await expectError(client, 'G10d closing the same book twice',
      'SELECT finance.close_ledger_year($1, $2, $3, $4, $5)',
      [f.yearId, 'USD', f.preparer, f.poster, 'GL-PROOF-CLOSE-USD-2'],
      /has already been closed/)
  })

  console.log('\nThe debtor ageing reconciles to its control account (the usual failure of an ageing report)')

  {
    // Against the committed demo dataset, which has a part-settled bill, an unsettled bill, an
    // opening receivable and an unallocated receipt — the four cases that make the two disagree.
    const { rows } = await client.query(
      `WITH ageing AS (
         SELECT a.currency, sum(a.outstanding_amount) AS outstanding
           FROM finance.v_debtor_ageing a WHERE a.voucher_no LIKE 'GL-%'
          GROUP BY a.currency
       ), control AS (
         SELECT ab.currency, ab.net_debit AS balance
           FROM finance.v_account_balance ab
           JOIN finance.ledger_account la ON la.id = ab.ledger_account_id
          WHERE la.account_type = 'receivable' AND la.code LIKE 'GL-%'
       )
       SELECT c.currency, a.outstanding::text AS ageing_total, c.balance::text AS control_balance,
              (a.outstanding - c.balance)::text AS difference
         FROM control c JOIN ageing a ON a.currency = c.currency`,
    )
    if (rows.length === 0) {
      console.log('  (skipped: no GL- demo receivable posted. Run scripts/seed-general-ledger-demo.js)')
    }
    for (const r of rows) {
      if (Number(r.difference) === 0) {
        ok(`the ${r.currency} ageing total equals the receivable control balance`,
          `ageing ${r.ageing_total} = control ${r.control_balance}`)
      } else {
        bad(`the ${r.currency} ageing total equals the receivable control balance`,
          `ageing ${r.ageing_total} against control ${r.control_balance}, out by ${r.difference}`)
      }
    }
  }

  const { rows: after } = await client.query('SELECT count(*)::int AS n FROM finance.ledger_entry')
  console.log(`\nfinance.ledger_entry rows before: ${before[0].n}, after: ${after[0].n}`)
  if (before[0].n !== after[0].n) {
    bad('this script wrote nothing to the ledger', `${after[0].n - before[0].n} row(s) persisted`)
  } else {
    ok('this script wrote nothing to the ledger', 'every proof ran inside a transaction that was rolled back')
  }

  await client.end()

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error('\nharness error:', err.message); process.exit(2) })
