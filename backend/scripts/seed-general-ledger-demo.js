#!/usr/bin/env node
/**
 * A synthetic general-ledger dataset: a chart of accounts, twelve monthly periods, an opening
 * trial balance per currency, journals in both books, a rates bill and its receipt, and one
 * correction made as a reversal.
 *
 *   node scripts/seed-general-ledger-demo.js            # create
 *   node scripts/seed-general-ledger-demo.js --report   # show the trial balance and the ageing
 *   node scripts/seed-general-ledger-demo.js --clean    # remove everything it created
 *
 * WHY THIS EXISTS
 * Migration 203 seeds no ledger account, no period and no voucher, on purpose: the chart of
 * accounts is a Council resolution (decision D16) and a plausible-looking placeholder in a book of
 * account is worse than an empty table. But a trial balance over no entries cannot be wrong, an
 * ageing view over no receivable cannot be tested, and acceptance check G4 — "a trial balance per
 * currency balances to nil on the demo dataset" — needs a demo dataset. This is it, and everything
 * it writes is prefixed `GL-` and labelled synthetic.
 *
 * IT USES THE EXISTING DEMO YEAR. `scripts/seed-finance-director-demo.js` creates a July-to-June
 * financial year, which is the fixture that makes a report bucketing from January visibly wrong.
 * The ledger hangs off the same year so the two demos describe one council rather than two, and so
 * the ledger's actuals and the register's imported actuals sit in the same period columns. If that
 * year is absent this script creates its own, labelled the same way.
 *
 * TWO BOOKS, AND NO RATE BETWEEN THEM
 * There is a USD book and a ZWG book and each balances on its own. Nothing here converts anything:
 * the opening balances, the journals and the closing position are all per currency, because the
 * Council has approved no conversion basis (decision D4). A dataset with a single mixed book would
 * make the two-books design untestable.
 *
 * REMOVING IT NEEDS THE IMMUTABILITY TRIGGER DISABLED, AND THAT IS THE POINT
 * `finance.ledger_entry` is insert-only: UPDATE and DELETE are revoked from the application role
 * and refused by `trg_ledger_entry_immutable` for everyone else, including the table owner. So
 * `--clean` cannot simply delete its rows. It disables that trigger for one transaction, deletes
 * only the rows this script created, and re-enables it — and it says so on the way past, loudly,
 * because a script that quietly switched off a control of a book of account would be the most
 * dangerous file in this repository. It refuses to run at all against a database whose name looks
 * like production.
 *
 * SAFETY
 * Refuses a production-looking database name. Writes only rows it can identify by its own prefix,
 * and never touches a row it did not create.
 */
require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/vungu_dev'

const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '')
if (/prod|live/i.test(dbName)) {
  console.error(`Refusing to seed synthetic data into ${dbName}: the name looks like production.`)
  process.exit(1)
}

const YEAR_LABEL = 'DD 2026/27 (synthetic demo — July to June, not a Council year)'
const PREFIX = 'GL-'

/**
 * The chart. Small on purpose: five roots, a receivable control, a bank, an accumulated surplus the
 * year-end closing can transfer into, and enough revenue and expense accounts to make a statement
 * of financial performance say something.
 *
 * `account_type` is what the ledger's own machinery reads — `receivable` for the ageing view,
 * `accumulated_surplus` for the closing function — so those two are not optional decoration.
 */
const CHART = [
  // code, name, root_type, account_type, parent code, is_group
  ['GL-1000', 'Assets (demo)', 'asset', null, null, true],
  ['GL-1100', 'Bank — current account (demo)', 'asset', 'bank', 'GL-1000', false],
  ['GL-1200', 'Rates receivable (demo)', 'asset', 'receivable', 'GL-1000', false],
  ['GL-2000', 'Liabilities (demo)', 'liability', null, null, true],
  ['GL-2100', 'Accrued expenses (demo)', 'liability', 'provision', 'GL-2000', false],
  ['GL-3000', 'Equity (demo)', 'equity', null, null, true],
  ['GL-3100', 'Accumulated surplus (demo)', 'equity', 'accumulated_surplus', 'GL-3000', false],
  ['GL-4000', 'Revenue (demo)', 'revenue', null, null, true],
  ['GL-4100', 'Rates revenue (demo)', 'revenue', null, 'GL-4000', false],
  ['GL-4200', 'Licence fees (demo)', 'revenue', null, 'GL-4000', false],
  ['GL-5000', 'Expenditure (demo)', 'expense', null, null, true],
  ['GL-5100', 'Employment costs (demo)', 'expense', null, 'GL-5000', false],
  ['GL-5200', 'Roads maintenance (demo)', 'expense', null, 'GL-5000', false],
]

const PARTIES = [
  ['ratepayer', 'Chirumhanzu Farm Holdings (demo)', 'GL-RP-0001'],
  ['ratepayer', 'Vungu Growth Point Traders (demo)', 'GL-RP-0002'],
  ['supplier', 'Midlands Plant Hire (demo)', 'GL-SP-0001'],
]

/**
 * The vouchers. Each is one currency and each balances; a voucher that did not would be refused by
 * the database, which is exactly the behaviour acceptance check G1 covers.
 *
 * `settles` names an earlier voucher in this list whose receivable this one pays, which is what
 * makes the ageing view able to say anything.
 */
const VOUCHERS = [
  {
    no: 'GL-OPEN-USD', type: 'opening', currency: 'USD', date: '2026-07-01',
    narration: 'Opening trial balance, USD book (demo)',
    lines: [
      ['GL-1100', '120000.00', null],
      ['GL-1200', '45000.00', null],
      ['GL-2100', null, '15000.00'],
      ['GL-3100', null, '150000.00'],
    ],
  },
  {
    no: 'GL-OPEN-ZWG', type: 'opening', currency: 'ZWG', date: '2026-07-01',
    narration: 'Opening trial balance, ZWG book (demo)',
    lines: [
      ['GL-1100', '8400000.00', null],
      ['GL-3100', null, '8400000.00'],
    ],
  },
  {
    no: 'GL-JV-0001', type: 'journal', currency: 'USD', date: '2026-07-31',
    narration: 'July employment costs (demo)',
    lines: [['GL-5100', '38500.00', null], ['GL-1100', null, '38500.00']],
  },
  {
    no: 'GL-JV-0002', type: 'journal', currency: 'USD', date: '2026-08-31',
    narration: 'August roads maintenance (demo)',
    lines: [['GL-5200', '21750.50', null], ['GL-1100', null, '21750.50']],
  },
  {
    no: 'GL-JV-0003', type: 'journal', currency: 'ZWG', date: '2026-08-31',
    narration: 'August licence fee collections (demo)',
    lines: [['GL-1100', '2650000.00', null], ['GL-4200', null, '2650000.00']],
  },
  {
    // The accrual, which is the whole point of decision 2: revenue is recognised when BILLED and a
    // receivable is raised. Until this, D13 said debtor ageing could not exist.
    no: 'GL-RB-0001', type: 'rates_bill', currency: 'USD', date: '2026-07-10',
    narration: 'Rates bill 2026/27, Chirumhanzu Farm Holdings (demo)',
    lines: [['GL-1200', '18000.00', null, 'GL-RP-0001'], ['GL-4100', null, '18000.00']],
  },
  {
    no: 'GL-RB-0002', type: 'rates_bill', currency: 'USD', date: '2026-09-15',
    narration: 'Rates bill 2026/27, Vungu Growth Point Traders (demo)',
    lines: [['GL-1200', '7200.00', null, 'GL-RP-0002'], ['GL-4100', null, '7200.00']],
  },
  {
    // A part payment, settled against the bill, so the ageing view has an outstanding balance that
    // is neither the full bill nor nil.
    no: 'GL-RC-0001', type: 'receipt', currency: 'USD', date: '2026-10-02',
    narration: 'Part payment of GL-RB-0001 (demo)',
    settles: 'GL-RB-0001',
    lines: [['GL-1100', '11000.00', null], ['GL-1200', null, '11000.00', 'GL-RP-0001']],
  },
  {
    // A receipt with NO settlement link: money in, not yet matched to a bill. It shows in the
    // ageing view's `unallocated` bucket with a negative outstanding figure, which is what makes a
    // party's ageing total reconcile to its control account instead of silently disagreeing.
    no: 'GL-RC-0002', type: 'receipt', currency: 'USD', date: '2026-10-20',
    narration: 'Unallocated receipt, payer not yet identified (demo)',
    lines: [['GL-1100', '1500.00', null], ['GL-1200', null, '1500.00']],
  },
  {
    // Posted to the wrong account on purpose. It is corrected below by a reversal, so the demo
    // carries a real correction pair rather than a tidy book nobody ever made a mistake in.
    no: 'GL-JV-0004', type: 'journal', currency: 'USD', date: '2026-11-05',
    narration: 'October roads maintenance, posted to employment costs in error (demo)',
    lines: [['GL-5100', '9400.00', null], ['GL-1100', null, '9400.00']],
    reverse: 'Posted to employment costs in error; it is roads maintenance.',
  },
  {
    no: 'GL-JV-0005', type: 'journal', currency: 'USD', date: '2026-11-05',
    narration: 'October roads maintenance, correctly posted (demo)',
    lines: [['GL-5200', '9400.00', null], ['GL-1100', null, '9400.00']],
  },
]

/** Remove everything this script created, in dependency order. */
async function clean(db, { announce = true } = {}) {
  if (announce) {
    console.log('finance.ledger_entry is insert-only. To remove the demo ledger this script now')
    console.log('disables trg_ledger_entry_immutable for ONE transaction, deletes only its own')
    console.log(`\`${PREFIX}\` rows, and re-enables it. Nothing else is touched.`)
  }
  // The trigger is the control; disabling it is deliberate, scoped to this transaction's work, and
  // re-enabled below in the same transaction so a failure cannot leave it off.
  await db.query('ALTER TABLE finance.ledger_entry DISABLE TRIGGER trg_ledger_entry_immutable')
  try {
    await db.query(
      `DELETE FROM finance.ledger_entry
        WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE voucher_no LIKE $1)`,
      [`${PREFIX}%`],
    )
  } finally {
    await db.query('ALTER TABLE finance.ledger_entry ENABLE TRIGGER trg_ledger_entry_immutable')
  }
  // A posted voucher's lines are frozen too, so the vouchers go back to draft before their lines
  // are removed. Same reasoning: the control is suspended for exactly this work and no further.
  await db.query(
    `UPDATE finance.voucher SET status = 'draft', posted_by = NULL, posted_at = NULL
      WHERE voucher_no LIKE $1`, [`${PREFIX}%`],
  )
  await db.query(
    `DELETE FROM finance.voucher_line
      WHERE voucher_id IN (SELECT id FROM finance.voucher WHERE voucher_no LIKE $1)`,
    [`${PREFIX}%`],
  )
  // Reversals point at their originals, so the children go first.
  await db.query(
    `DELETE FROM finance.voucher WHERE voucher_no LIKE $1 AND reverses_voucher_id IS NOT NULL`,
    [`${PREFIX}%`],
  )
  await db.query('DELETE FROM finance.voucher WHERE voucher_no LIKE $1', [`${PREFIX}%`])
  await db.query(
    `DELETE FROM finance.ledger_period
      WHERE label LIKE $1 OR financial_year_id IN (
        SELECT id FROM finance.financial_year WHERE label = $2)`,
    [`${PREFIX}%`, YEAR_LABEL],
  )
  await db.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${PREFIX}%`])
  await db.query('DELETE FROM finance.party WHERE reference LIKE $1', [`${PREFIX}%`])
}

async function report(db) {
  const { rows: counts } = await db.query(
    `SELECT 'ledger_account' AS entity, count(*)::int AS rows FROM finance.ledger_account WHERE code LIKE $1
     UNION ALL SELECT 'party', count(*)::int FROM finance.party WHERE reference LIKE $1
     UNION ALL SELECT 'ledger_period', count(*)::int FROM finance.ledger_period
                WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label = $2)
     UNION ALL SELECT 'voucher', count(*)::int FROM finance.voucher WHERE voucher_no LIKE $1
     UNION ALL SELECT 'voucher (posted)', count(*)::int FROM finance.voucher
                WHERE voucher_no LIKE $1 AND status = 'posted'
     UNION ALL SELECT 'voucher (reversal)', count(*)::int FROM finance.voucher
                WHERE voucher_no LIKE $1 AND voucher_type = 'reversal'
     UNION ALL SELECT 'ledger_entry', count(*)::int FROM finance.ledger_entry
                WHERE voucher_no LIKE $1
     ORDER BY entity`, [`${PREFIX}%`, YEAR_LABEL],
  )
  console.log('\nRows:')
  for (const r of counts) console.log(`  ${r.entity.padEnd(20)} ${String(r.rows).padStart(6)}`)

  const { rows: books } = await db.query(
    `SELECT tb.currency,
            count(*)::int AS accounts,
            sum(tb.debit_balance)::text  AS debits,
            sum(tb.credit_balance)::text AS credits,
            (sum(tb.debit_balance) - sum(tb.credit_balance))::text AS difference
       FROM finance.v_trial_balance tb
      WHERE tb.financial_year_id IN (SELECT id FROM finance.financial_year WHERE label = $1)
      GROUP BY tb.currency ORDER BY tb.currency`, [YEAR_LABEL],
  )
  console.log('\nTrial balance, per currency (acceptance check G4):')
  if (books.length === 0) console.log('  nothing posted')
  for (const b of books) {
    const verdict = Number(b.difference) === 0 ? 'BALANCES' : `OUT BY ${b.difference}`
    console.log(`  ${b.currency}  ${b.accounts} accounts  Dr ${b.debits}  Cr ${b.credits}  ${verdict}`)
  }
  console.log('  No figure above spans the two currencies, and there is no combined total (D4).')

  const { rows: ageing } = await db.query(
    `SELECT a.currency, a.ageing_bucket, count(*)::int AS bills,
            sum(a.outstanding_amount)::text AS outstanding
       FROM finance.v_debtor_ageing a
      WHERE a.voucher_no LIKE $1
      GROUP BY a.currency, a.ageing_bucket ORDER BY a.currency, a.ageing_bucket`, [`${PREFIX}%`],
  )
  console.log('\nDebtor ageing (what decision D13 said could not exist):')
  if (ageing.length === 0) console.log('  no receivable posted')
  for (const a of ageing) {
    console.log(`  ${a.currency}  ${a.ageing_bucket.padEnd(12)} ${a.bills} bill(s)  ${a.outstanding}`)
  }
}

async function main() {
  // `--undo` is the verb scripts/seed-all-demo.js passes to every seed it runs; `--clean` is the
  // verb the other finance scripts use. Both mean the same thing here.
  const removing = process.argv.includes('--clean') || process.argv.includes('--undo')
  const mode = removing ? 'clean'
    : process.argv.includes('--report') ? 'report' : 'create'

  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  await db.query('SET statement_timeout = 0')

  try {
    if (mode === 'report') {
      console.log(`Synthetic general-ledger demo data in ${dbName}:`)
      await report(db)
      return
    }

    await db.query('BEGIN')
    await clean(db, { announce: true })
    if (mode === 'clean') {
      await db.query('COMMIT')
      console.log(`\nRemoved the synthetic general-ledger dataset from ${dbName}.`)
      return
    }

    const authorityId = 1

    // Three different people. Separation of duties is a CHECK constraint on finance.voucher
    // (prepared_by <> posted_by), so a dataset in which one account both prepared and posted would
    // be refused by the database — and would misrepresent the control if it were not.
    const { rows: people } = await db.query(
      `SELECT id, role FROM public.users
        WHERE role IN ('finance_officer', 'finance_admin', 'finance_committee')
        ORDER BY role`,
    )
    const by = (role) => {
      const person = people.find((p) => p.role === role)
      if (!person) {
        throw new Error(
          `no ${role} account in public.users. Run: node scripts/seed-demo-users.js`,
        )
      }
      return person.id
    }
    const preparer = by('finance_officer')
    const poster = by('finance_admin')

    // The financial year, shared with the Director demo so the two describe one council.
    let { rows: year } = await db.query(
      'SELECT id, start_date::text AS start_date, end_date::text AS end_date FROM finance.financial_year WHERE label = $1',
      [YEAR_LABEL],
    )
    if (!year[0]) {
      ({ rows: year } = await db.query(
        `INSERT INTO finance.financial_year
           (authority_id, label, start_date, end_date, status, reporting_currency)
         VALUES ($1, $2, '2026-07-01', '2027-06-30', 'open', 'USD')
         RETURNING id, start_date::text AS start_date, end_date::text AS end_date`,
        [authorityId, YEAR_LABEL],
      ))
      console.log('Created the July–June demo financial year (the Director demo had not been run).')
    }
    const yearId = year[0].id

    // Twelve monthly periods, generated from the same library the statements bucket by, so a
    // posting cannot fall in a month a report disagrees about.
    const { periodList } = require('../src/lib/financePeriods')
    const buckets = periodList({
      start: year[0].start_date, end: year[0].end_date, periodicity: 'monthly',
    })
    for (let i = 0; i < buckets.length; i += 1) {
      await db.query(
        `INSERT INTO finance.ledger_period
           (authority_id, financial_year_id, period_no, label, from_date, to_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
         ON CONFLICT (financial_year_id, period_no) DO NOTHING`,
        [authorityId, yearId, i + 1, `${PREFIX}${buckets[i].label}`,
          buckets[i].from_date, buckets[i].to_date, preparer],
      )
    }

    const accounts = {}
    for (const [code, name, rootType, accountType, parentCode, isGroup] of CHART) {
      const { rows } = await db.query(
        `INSERT INTO finance.ledger_account
           (authority_id, code, name, root_type, account_type, parent_id, is_group, is_postable,
            status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10) RETURNING id`,
        [authorityId, code, name, rootType, accountType,
          parentCode ? accounts[parentCode] : null, isGroup, !isGroup,
          'Synthetic demo account. Not a Council-approved chart of accounts (decision D16).',
          preparer],
      )
      accounts[code] = rows[0].id
    }

    const parties = {}
    for (const [partyType, name, reference] of PARTIES) {
      const { rows } = await db.query(
        `INSERT INTO finance.party (authority_id, party_type, name, reference, status, notes, created_by)
         VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING id`,
        [authorityId, partyType, name, reference,
          'Synthetic demo party. The real ratepayer of record is decision D19.', preparer],
      )
      parties[reference] = rows[0].id
    }

    const vouchers = {}
    const reversals = []
    for (const v of VOUCHERS) {
      const { rows: header } = await db.query(
        `INSERT INTO finance.voucher
           (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
            narration, reference, status, is_opening, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10) RETURNING id`,
        [authorityId, v.no, v.type, v.currency, yearId, v.date, v.narration, v.no,
          v.type === 'opening', preparer],
      )
      vouchers[v.no] = header[0].id
      let lineNo = 0
      for (const [code, debit, credit, partyRef] of v.lines) {
        lineNo += 1
        await db.query(
          `INSERT INTO finance.voucher_line
             (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id,
              against_voucher_id, narration)
           VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8,$9)`,
          [authorityId, header[0].id, lineNo, accounts[code], debit ?? 0, credit ?? 0,
            partyRef ? parties[partyRef] : null,
            v.settles ? vouchers[v.settles] : null, v.narration],
        )
      }
      // Posted by somebody other than the preparer, which the CHECK constraint requires.
      await db.query('SELECT finance.post_voucher($1, $2)', [header[0].id, poster])
      if (v.reverse) reversals.push([v.no, v.reverse])
    }

    for (const [no, reason] of reversals) {
      await db.query('SELECT finance.reverse_voucher($1, $2, $3, $4)',
        [vouchers[no], preparer, poster, reason])
    }

    // The deferred balance trigger fires here, before COMMIT, so a dataset that did not balance
    // fails loudly in this script rather than quietly at the end of it.
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    await db.query('COMMIT')

    console.log(`\nSeeded the synthetic general ledger into ${dbName}.`)
    await report(db)
    console.log(`\nRemove it again with: node scripts/seed-general-ledger-demo.js --clean`)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
