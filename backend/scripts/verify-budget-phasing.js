/**
 * Proof that the budget phasing rules are enforced by the DATABASE, with every route and every
 * application function bypassed.
 *
 * WHY THIS IS A SCRIPT AND NOT A JEST TEST
 * The rule that matters — a phasing profile's percentages total exactly 100 — is a statement about
 * Postgres: a deferred constraint trigger (migration 204). It cannot be demonstrated without a
 * database, and the suites under src/routes/__tests__/ write to the shared vungu_dev development
 * database and change what the running application shows. So this is a standalone, READ-SAFE
 * script instead, in the same shape as scripts/verify-ledger-invariants.js.
 *
 * WHY THE TOTAL HAS TO BE A DATABASE RULE AT ALL
 * ERPNext checks it in `MonthlyDistribution.validate()`
 * (~/Downloads/erpnext-develop/erpnext/accounts/doctype/monthly_distribution/monthly_distribution.py:50),
 * which is model code: a profile written by an import, a script or psql never reaches it. A profile
 * totalling 97 would then under-state the budget of every line it phases by three percent, and
 * nothing on the management account would look wrong — the columns would all be populated, they
 * would simply be three percent too small. That is the class of defect a council discovers at
 * audit. So the proofs below bypass the application entirely and INSERT straight into the tables.
 *
 * NOTHING THIS SCRIPT WRITES SURVIVES IT. Every proof runs inside one transaction that ends in
 * ROLLBACK, including the ones whose point is that COMMIT fails. The counts printed at the end
 * confirm the tables hold exactly as many rows after the run as before it.
 *
 * Run: node scripts/verify-budget-phasing.js
 * Exits non-zero if any check fails.
 */
require('dotenv').config()
const { Client } = require('pg')

let passed = 0
let failed = 0

const ok = (name, detail) => { passed += 1; console.log(`  PASS  ${name}${detail ? `\n          ${detail}` : ''}`) }
const bad = (name, detail) => { failed += 1; console.log(`  FAIL  ${name}\n          ${detail}`) }

/**
 * Attempt something that must be refused, and report what refused it.
 *
 * TWO MECHANISMS, AND THE DIFFERENCE MATTERS.
 *
 * A plain CHECK or UNIQUE fails on the statement. The total-100 rule is a DEFERRED constraint
 * trigger, which by design does not fire until COMMIT — that is what lets a profile be built one
 * period row at a time, eleven of which leave the total below 100. Releasing a savepoint does NOT
 * fire it: the first draft of this script released savepoints and reported six rules "not
 * enforced" that are enforced. `SET CONSTRAINTS ALL IMMEDIATE` is what forces the pending deferred
 * checks to run then and there, and it is exactly what COMMIT would do — the same device
 * scripts/verify-ledger-invariants.js:200 uses for the voucher balance trigger.
 *
 * Both are wrapped in a SAVEPOINT, for the reason that script gives: a raised error aborts the
 * whole transaction, and without the savepoint every later proof would report "current transaction
 * is aborted", which looks like a refusal and is not one.
 */
let savepointSeq = 0
async function expectRefused(client, label, body, matcher) {
  savepointSeq += 1
  const sp = `phz_${savepointSeq}`
  await client.query(`SAVEPOINT ${sp}`)
  try {
    // Back to DEFERRED for the duration of this proof. A previous proof's SET CONSTRAINTS ALL
    // IMMEDIATE otherwise persists for the rest of the transaction, and the trigger would then
    // fire on the profile's own INSERT -- before the period rows that satisfy it exist.
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    await body()
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    bad(label, 'it SUCCEEDED; the rule is not enforced by the database')
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    const message = String(err.message)
    if (matcher && !matcher.test(message)) {
      bad(label, `refused, but with an unexpected message: ${message}`)
      return
    }
    ok(label, `refused: ${message.split('\n')[0]}`)
  }
}

/**
 * Attempt something that must be ACCEPTED. The counterpart proof: the rule is not over-broad, and
 * it refuses a bad profile without also refusing a good one.
 *
 * It forces the deferred checks too, so "accepted" means the database really did pass it rather
 * than merely not having looked yet.
 */
async function expectAccepted(client, label, body) {
  savepointSeq += 1
  const sp = `phz_${savepointSeq}`
  await client.query(`SAVEPOINT ${sp}`)
  try {
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    await body()
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    ok(label)
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    bad(label, `it was refused: ${String(err.message).split('\n')[0]}`)
  }
}

/**
 * The same proof at a REAL COMMIT, with no savepoint and no SET CONSTRAINTS.
 *
 * `SET CONSTRAINTS ALL IMMEDIATE` is the standard way to force a deferred check, but it is still
 * this script asking for the check. This runs the transaction the way an import or a psql session
 * would — BEGIN, INSERT, COMMIT — and asserts both that COMMIT raised and that the database holds
 * nothing afterwards. It is the proof that the rule binds somebody who never heard of it.
 */
async function expectRefusedAtCommit(client, label, body, matcher) {
  await client.query('BEGIN')
  let raised = null
  try {
    await body()
    await client.query('COMMIT')
  } catch (err) {
    raised = err
    await client.query('ROLLBACK').catch(() => {})
  }
  if (!raised) {
    bad(label, 'COMMIT succeeded; the rule is not enforced at commit')
    return
  }
  if (matcher && !matcher.test(String(raised.message))) {
    bad(label, `refused, but with an unexpected message: ${raised.message}`)
    return
  }
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM finance.budget_distribution')
  if (rows[0].n !== 0) {
    bad(label, `COMMIT was refused but ${rows[0].n} profile row(s) survived`)
    return
  }
  ok(label, `COMMIT refused: ${String(raised.message).split('\n')[0]}`)
}

const AUTHORITY = "(SELECT id FROM public.local_authorities WHERE code = 'VUNGU')"

/**
 * A July-June financial year to hang the profiles on.
 *
 * July-June on purpose: it is the fixture that exposes a period engine bucketing from January. A
 * profile's q1 here is Jul-Sep, and a reader of these proofs should be able to see that.
 */
async function fixtures(client) {
  const { rows } = await client.query(
    `INSERT INTO finance.financial_year
       (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES (${AUTHORITY}, 'PHZ proof year (July-June)', '2026-07-01', '2027-06-30', 'open', 'USD')
     RETURNING id`,
  )
  const yearId = rows[0].id

  const { rows: otherYear } = await client.query(
    `INSERT INTO finance.financial_year
       (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES (${AUTHORITY}, 'PHZ proof year (the next one)', '2027-07-01', '2028-06-30', 'open', 'USD')
     RETURNING id`,
  )

  const { rows: dept } = await client.query(
    `INSERT INTO finance.department (authority_id, code, name)
     VALUES (${AUTHORITY}, 'PHZ-D', 'Phasing proof department') RETURNING id`,
  )
  const { rows: account } = await client.query(
    `INSERT INTO finance.account (authority_id, code, name, kind, expenditure_class)
     VALUES (${AUTHORITY}, 'PHZ-5100', 'Phasing proof account', 'expenditure', 'recurrent')
     RETURNING id`,
  )
  const { rows: line } = await client.query(
    `INSERT INTO finance.budget_line
       (authority_id, financial_year_id, department_id, account_id, code, description,
        currency, original_amount, status)
     VALUES (${AUTHORITY}, $1, $2, $3, 'PHZ-L01', 'Phasing proof line', 'USD', 120000, 'draft')
     RETURNING id`,
    [yearId, dept[0].id, account[0].id],
  )
  return { yearId, otherYearId: otherYear[0].id, lineId: line[0].id }
}

/** Create a profile and its periods. Raw INSERTs: no route, no validation function, no ORM. */
async function profile(client, { yearId, name, periodicity, status, basis = 'council_profile', periods }) {
  // The parent row and its periods are written separately, so the total cannot be right until the
  // last one lands. That is precisely why the rule is DEFERRED, and why this says so explicitly
  // rather than relying on whatever the previous statement left the session in.
  await client.query('SET CONSTRAINTS ALL DEFERRED')
  const { rows } = await client.query(
    `INSERT INTO finance.budget_distribution
       (authority_id, financial_year_id, name, periodicity, basis, status)
     VALUES (${AUTHORITY}, $1, $2, $3, $4, $5) RETURNING id`,
    [yearId, name, periodicity, basis, status],
  )
  const id = rows[0].id
  let ordinal = 0
  for (const [key, percentage] of periods) {
    ordinal += 1
    await client.query(
      `INSERT INTO finance.budget_distribution_period
         (authority_id, distribution_id, period_key, period_ordinal, percentage)
       VALUES (${AUTHORITY}, $1, $2, $3, $4)`,
      [id, key, ordinal, percentage],
    )
  }
  return id
}

const QUARTERS_100 = [['q1', 40], ['q2', 30], ['q3', 20], ['q4', 10]]
const QUARTERS_97 = [['q1', 40], ['q2', 30], ['q3', 20], ['q4', 7]]
const MONTHS_EVEN = [
  ['m01', '8.333333'], ['m02', '8.333333'], ['m03', '8.333333'], ['m04', '8.333333'],
  ['m05', '8.333333'], ['m06', '8.333333'], ['m07', '8.333333'], ['m08', '8.333333'],
  ['m09', '8.333333'], ['m10', '8.333333'], ['m11', '8.333333'], ['m12', '8.333337'],
]

async function main() {
  const client = new Client({ connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL })
  await client.connect()

  const before = await counts(client)
  console.log('Budget phasing: the rules the DATABASE enforces (migration 204)')
  console.log(`Database holds ${before.profiles} profile(s) and ${before.periods} period row(s) before this run.\n`)

  // ── The proof at a real COMMIT, outside the big rolled-back transaction ──────────────────────
  // Its own BEGIN/COMMIT, exactly as an import or a psql session would write it, and nothing is
  // left behind: the COMMIT is refused and the whole transaction goes with it.
  console.log('— The total-100 rule at a real COMMIT, with the application bypassed entirely —')
  await expectRefusedAtCommit(client,
    'BEGIN; INSERT an active profile totalling 97; COMMIT — the COMMIT is refused and nothing persists',
    async () => {
      const { rows } = await client.query(
        `INSERT INTO finance.financial_year
           (authority_id, label, start_date, end_date, status, reporting_currency)
         VALUES (${AUTHORITY}, 'PHZ commit-proof year', '2026-07-01', '2027-06-30', 'open', 'USD')
         RETURNING id`)
      await profile(client, {
        yearId: rows[0].id, name: 'PHZ commit proof', periodicity: 'quarterly',
        status: 'active', periods: QUARTERS_97,
      })
    },
    /total 97\.000000, not 100/)

  console.log('')
  await client.query('BEGIN')
  try {
    const f = await fixtures(client)

    console.log('— The total-100 rule, forced with SET CONSTRAINTS ALL IMMEDIATE —')

    await expectRefused(client,
      'an ACTIVE quarterly profile whose periods total 97 is refused',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ short by three', periodicity: 'quarterly',
        status: 'active', periods: QUARTERS_97,
      }),
      /total 97\.000000, not 100/)

    await expectRefused(client,
      'an ACTIVE profile whose periods total 103 is refused',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ over by three', periodicity: 'quarterly',
        status: 'active', periods: [['q1', 40], ['q2', 30], ['q3', 20], ['q4', 13]],
      }),
      /total 103\.000000, not 100/)

    await expectRefused(client,
      'an ACTIVE profile with no periods at all is refused',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ empty', periodicity: 'quarterly',
        status: 'active', periods: [],
      }),
      /has no periods/)

    await expectAccepted(client,
      'an ACTIVE quarterly profile totalling exactly 100 is accepted',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ 40/30/20/10', periodicity: 'quarterly',
        status: 'active', periods: QUARTERS_100,
      }))

    await expectAccepted(client,
      'an ACTIVE monthly even spread totalling exactly 100 is accepted',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ even months', periodicity: 'monthly',
        status: 'active', basis: 'distribute_equally', periods: MONTHS_EVEN,
      }))

    console.log('\n— A draft is a profile being built, and is not held to the rule —')

    let draftId
    await expectAccepted(client,
      'a DRAFT profile totalling 97 is permitted, because it is not finished',
      async () => {
        draftId = await profile(client, {
          yearId: f.yearId, name: 'PHZ draft', periodicity: 'quarterly',
          status: 'draft', periods: QUARTERS_97,
        })
      })

    await expectRefused(client,
      'ACTIVATING that draft while it still totals 97 is refused',
      () => client.query(
        "UPDATE finance.budget_distribution SET status = 'active' WHERE id = $1", [draftId]),
      /total 97\.000000, not 100/)

    await expectAccepted(client,
      'activating it after the missing three points are added is accepted',
      async () => {
        await client.query(
          "UPDATE finance.budget_distribution_period SET percentage = 10 WHERE distribution_id = $1 AND period_key = 'q4'",
          [draftId])
        await client.query(
          "UPDATE finance.budget_distribution SET status = 'active' WHERE id = $1", [draftId])
      })

    await expectRefused(client,
      'removing a period from a live active profile, leaving it at 90, is refused',
      () => client.query(
        "DELETE FROM finance.budget_distribution_period WHERE distribution_id = $1 AND period_key = 'q4'",
        [draftId]),
      /total 90\.000000, not 100/)

    console.log('\n— The keys must belong to the periodicity the profile declares —')

    await expectRefused(client,
      'an ACTIVE profile declaring quarterly but holding monthly keys is refused',
      () => profile(client, {
        yearId: f.yearId, name: 'PHZ wrong keys', periodicity: 'quarterly',
        status: 'active', periods: [['m01', 50], ['m02', 50]],
      }),
      /do not begin with "q"/)

    await expectRefused(client,
      'a period key that is not one the period engine generates is refused by a CHECK',
      () => client.query(
        `INSERT INTO finance.budget_distribution_period
           (authority_id, distribution_id, period_key, period_ordinal, percentage)
         VALUES (${AUTHORITY}, $1, 'january', 9, 10)`, [draftId]),
      /period_key_check|violates check constraint/)

    await expectRefused(client,
      'a percentage above 100 is refused by a CHECK',
      () => client.query(
        `INSERT INTO finance.budget_distribution_period
           (authority_id, distribution_id, period_key, period_ordinal, percentage)
         VALUES (${AUTHORITY}, $1, 'q9', 9, 101)`, [draftId]),
      /percentage_check|violates check constraint/)

    await expectRefused(client,
      'two rows for the same period of the same profile are refused',
      () => client.query(
        `INSERT INTO finance.budget_distribution_period
           (authority_id, distribution_id, period_key, period_ordinal, percentage)
         VALUES (${AUTHORITY}, $1, 'q1', 9, 0)`, [draftId]),
      /uq_budget_distribution_period_key|duplicate key/)

    console.log('\n— A profile belongs to one financial year, and the key says so —')

    const nextYearProfile = await profile(client, {
      yearId: f.otherYearId, name: 'PHZ next year', periodicity: 'quarterly',
      status: 'active', periods: QUARTERS_100,
    })

    await expectRefused(client,
      "a budget line cannot be attached to another year's profile",
      () => client.query(
        'UPDATE finance.budget_line SET distribution_id = $1 WHERE id = $2',
        [nextYearProfile, f.lineId]),
      /budget_line_distribution_same_year|violates foreign key/)

    const sameYearProfile = await profile(client, {
      yearId: f.yearId, name: 'PHZ same year', periodicity: 'quarterly',
      status: 'active', periods: QUARTERS_100,
    })
    await expectAccepted(client,
      "a budget line attaches to its own year's profile",
      () => client.query(
        'UPDATE finance.budget_line SET distribution_id = $1 WHERE id = $2',
        [sameYearProfile, f.lineId]))

    console.log('\n— The default state: NULL means the phasing was never recorded —')

    await expectAccepted(client,
      'a budget line may have NO profile at all, which is the shipped state',
      () => client.query(
        'UPDATE finance.budget_line SET distribution_id = NULL WHERE id = $1', [f.lineId]))

    const { rows: nulls } = await client.query(
      'SELECT count(*)::int AS n FROM finance.budget_line WHERE distribution_id IS NULL AND deleted_at IS NULL')
    ok('a line with no profile carries NULL, not a zero and not an even twelfth',
      `${nulls[0].n} budget line(s) in this database have no phasing recorded`)

    // The arithmetic the report does, run here against the profile just proved, so the proof and
    // the report cannot disagree about what 40 % of an allocation is. In SQL over NUMERIC.
    const { rows: phased } = await client.query(
      `SELECT dp.period_key,
              (120000 * dp.percentage / 100)::finance.money AS phased_budget
         FROM finance.budget_distribution_period dp
        WHERE dp.distribution_id = $1
        ORDER BY dp.period_ordinal`,
      [sameYearProfile])
    ok('the phased budget is the allocation times the recorded percentage, computed in NUMERIC',
      phased.map((r) => `${r.period_key}=${r.phased_budget}`).join(' '))

    const { rows: total } = await client.query(
      `SELECT sum(120000 * dp.percentage / 100)::finance.money AS total
         FROM finance.budget_distribution_period dp WHERE dp.distribution_id = $1`,
      [sameYearProfile])
    if (String(total[0].total) === '120000.00') {
      ok('the phased periods add back up to the annual allocation', `${total[0].total} of 120000.00`)
    } else {
      bad('the phased periods add back up to the annual allocation', `got ${total[0].total}`)
    }
  } finally {
    await client.query('ROLLBACK')
  }

  const after = await counts(client)
  if (after.profiles === before.profiles && after.periods === before.periods) {
    ok('nothing this script wrote survived it',
      `${after.profiles} profile(s) and ${after.periods} period row(s), unchanged`)
  } else {
    bad('nothing this script wrote survived it',
      `profiles ${before.profiles} -> ${after.profiles}, periods ${before.periods} -> ${after.periods}`)
  }

  await client.end()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

async function counts(client) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*)::int FROM finance.budget_distribution)        AS profiles,
            (SELECT count(*)::int FROM finance.budget_distribution_period) AS periods`)
  return rows[0]
}

main().catch((err) => { console.error(err); process.exit(1) })
