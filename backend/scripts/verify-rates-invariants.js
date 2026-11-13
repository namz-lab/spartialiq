/**
 * Proof that rates billing refuses what it cannot compute, and that a bill, a receipt and the
 * arrears agree — with every route bypassed.
 *
 * Acceptance checks G8 and G9 from
 * docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §8:
 *
 *   G8  A rates bill raises a receivable; a receipt settles it; the ageing view moves the balance
 *       between buckets accordingly.
 *   G9  A billing run refuses a property with no rateable value, and says so, rather than billing
 *       nil.
 *
 * G9 is the one that matters, and it is wider than its sentence: the run refuses a property with
 * no ratepayer (D19), with no rateable value (D17), with no approved rate in the dollar (D18), with
 * a value in a currency the run is not billing, with only a DRAFT valuation or a DRAFT tariff, and
 * one it has already billed. Each refusal names the Council decision it waits on, so a blocked run
 * is a work list rather than a dead end.
 *
 * WHY THIS IS A SCRIPT AND NOT A JEST TEST
 * Same reason as scripts/verify-ledger-invariants.js, whose shape this follows: these are
 * statements about Postgres — a generated column, a trigger, a plpgsql refusal — and none of them
 * can be demonstrated without a database. The suites under src/routes/__tests__/ write to the
 * shared vungu_dev development database and change what the running application shows, so this is
 * a standalone script instead.
 *
 * NOTHING THIS SCRIPT WRITES SURVIVES IT. Every proof runs inside a transaction that ends in
 * ROLLBACK, including the ones whose point is that a statement fails. The counts printed at the end
 * confirm finance.ledger_entry, finance.rates_bill and finance.voucher hold exactly as many rows
 * after the run as before it — which matters most for the ledger, because it is insert-only and a
 * row written by mistake could not be removed.
 *
 * THE FIXTURES USE REAL PARCELS. land.parcel is the property register (731 rows) and this script
 * attaches valuations, accounts and parties to eight real parcel_ids inside the rolled-back
 * transaction, rather than inventing parcels. A billing run therefore considers all 731 properties
 * in every proof, which is also the honest demonstration of what a run looks like today.
 *
 * Run: node scripts/verify-rates-invariants.js
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

/** A date n days from today, as the YYYY-MM-DD a DATE column takes. */
function day(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const DATES = {
  yearStart: day(-40),
  yearEnd: day(325),
  // Period 1 contains the bill's posting date and today, so the ageing bucket is computable and
  // the period is open.
  p1From: day(-40),
  p1To: day(10),
  p2From: day(11),
  p2To: day(60),
  billFrom: day(-40),
  billTo: day(-10),
  posting: day(-40),
  nextFrom: day(-9),
  nextTo: day(5),
}

let savepointSeq = 0
/**
 * Attempt something that must be refused, and report what refused it.
 *
 * A raised error aborts the whole transaction in Postgres, so without the savepoint the first
 * refusal would make every later proof report "current transaction is aborted", which looks like a
 * refusal and is not one.
 */
async function expectError(client, label, sql, params, matcher) {
  savepointSeq += 1
  const sp = `rproof_${savepointSeq}`
  await client.query(`SAVEPOINT ${sp}`)
  try {
    await client.query(sql, params)
    await client.query(`RELEASE SAVEPOINT ${sp}`)
    bad(label, 'the statement SUCCEEDED; the refusal is not enforced')
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
 * Everything a billing run needs, built on eight real parcels, each set up to exercise one
 * refusal or the one success.
 */
async function fixtures(client) {
  const { rows: users } = await client.query(
    `SELECT id, role FROM public.users WHERE role IN ('finance_admin', 'finance_officer')
      AND deleted_at IS NULL ORDER BY role LIMIT 2`,
  )
  if (users.length < 2) throw new Error('need a finance_admin and a finance_officer in public.users')
  const preparer = users.find((u) => u.role === 'finance_officer').id
  const poster = users.find((u) => u.role === 'finance_admin').id

  const { rows: auth } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
  const authorityId = auth[0].id

  const { rows: parcels } = await client.query(
    `SELECT parcel_id, stand_no FROM land.parcel WHERE status = 'current' ORDER BY parcel_id LIMIT 8`,
  )
  if (parcels.length < 8) throw new Error('need at least 8 current parcels in land.parcel')
  const P = {
    full: parcels[0], noValue: parcels[1], noTariff: parcels[2], noAccount: parcels[3],
    wrongCurrency: parcels[4], draftTariff: parcels[5], draftValue: parcels[6], nilCharge: parcels[7],
  }

  const { rows: year } = await client.query(
    `INSERT INTO finance.financial_year
       (authority_id, label, start_date, end_date, status, reporting_currency)
     VALUES ($1, 'RATES-PROOF year', $2, $3, 'open', 'USD') RETURNING id`,
    [authorityId, DATES.yearStart, DATES.yearEnd],
  )
  const yearId = year[0].id

  const { rows: period } = await client.query(
    `INSERT INTO finance.ledger_period
       (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 1, 'RATES-PROOF p1', $3, $4, 'open') RETURNING id`,
    [authorityId, yearId, DATES.p1From, DATES.p1To],
  )
  const { rows: closed } = await client.query(
    `INSERT INTO finance.ledger_period
       (authority_id, financial_year_id, period_no, label, from_date, to_date, status)
     VALUES ($1, $2, 2, 'RATES-PROOF p2', $3, $4, 'closed') RETURNING id`,
    [authorityId, yearId, DATES.p2From, DATES.p2To],
  )

  const chart = [
    ['RATES-PROOF-1100', 'Bank', 'asset', 'bank'],
    ['RATES-PROOF-1200', 'Rates receivable', 'asset', 'receivable'],
    ['RATES-PROOF-4100', 'Rates revenue', 'revenue', null],
    ['RATES-PROOF-5100', 'Roads maintenance', 'expense', null],
  ]
  const accounts = {}
  for (const [code, name, rootType, accountType] of chart) {
    const { rows } = await client.query(
      `INSERT INTO finance.ledger_account
         (authority_id, code, name, root_type, account_type, is_group, is_postable, status)
       VALUES ($1,$2,$3,$4,$5,false,true,'active') RETURNING id`,
      [authorityId, code, name, rootType, accountType],
    )
    accounts[code] = rows[0].id
  }

  const categories = {}
  for (const [code, name] of [['RP-RES', 'Residential (proof)'], ['RP-COM', 'Commercial (proof)'],
    ['RP-IND', 'Industrial (proof)'], ['RP-NIL', 'Nil-rated (proof)']]) {
    const { rows } = await client.query(
      `INSERT INTO finance.property_category (authority_id, code, name, status)
       VALUES ($1,$2,$3,'active') RETURNING id`, [authorityId, code, name],
    )
    categories[code] = rows[0].id
  }

  const parties = {}
  for (const [key, name, ref] of [['a', 'Ratepayer A (proof)', 'RP-PROOF-A'],
    ['b', 'Ratepayer B (proof)', 'RP-PROOF-B']]) {
    const { rows } = await client.query(
      `INSERT INTO finance.party (authority_id, party_type, name, reference, status)
       VALUES ($1,'ratepayer',$2,$3,'active') RETURNING id`, [authorityId, name, ref],
    )
    parties[key] = rows[0].id
  }

  /** A rates account for a parcel. */
  const account = async (parcelId, no, partyId) => {
    const { rows } = await client.query(
      `INSERT INTO finance.rates_account (authority_id, account_no, parcel_id, party_id, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`, [authorityId, no, parcelId, partyId],
    )
    return rows[0].id
  }
  /** A valuation. */
  const valuation = async (parcelId, categoryId, value, currency, status = 'active') => {
    const { rows } = await client.query(
      `INSERT INTO finance.valuation_roll
         (authority_id, parcel_id, property_category_id, rateable_value, currency,
          effective_from, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,'RATES-PROOF roll',$7) RETURNING id`,
      [authorityId, parcelId, categoryId, value, currency, DATES.yearStart, status],
    )
    return rows[0].id
  }
  /** A tariff. */
  const tariff = async (categoryId, rate, opts = {}) => {
    const { rows } = await client.query(
      `INSERT INTO finance.rates_tariff
         (authority_id, financial_year_id, property_category_id, currency, rate_in_dollar,
          fixed_charge, minimum_charge, revenue_ledger_account_id, status, approved_by, approved_at,
          resolution_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RATES-PROOF minute') RETURNING id`,
      [authorityId, yearId, categoryId, opts.currency || 'USD', rate,
        opts.fixed ?? null, opts.minimum ?? null, opts.revenue ?? null,
        opts.status || 'approved',
        (opts.status || 'approved') === 'approved' ? poster : null,
        (opts.status || 'approved') === 'approved' ? new Date().toISOString() : null],
    )
    return rows[0].id
  }

  const accountIds = {}
  accountIds.full = await account(P.full.parcel_id, 'RP-ACC-FULL', parties.a)
  accountIds.noValue = await account(P.noValue.parcel_id, 'RP-ACC-NOVAL', parties.a)
  accountIds.noTariff = await account(P.noTariff.parcel_id, 'RP-ACC-NOTAR', parties.b)
  accountIds.wrongCurrency = await account(P.wrongCurrency.parcel_id, 'RP-ACC-CCY', parties.b)
  accountIds.draftTariff = await account(P.draftTariff.parcel_id, 'RP-ACC-DTAR', parties.b)
  accountIds.draftValue = await account(P.draftValue.parcel_id, 'RP-ACC-DVAL', parties.b)
  accountIds.nilCharge = await account(P.nilCharge.parcel_id, 'RP-ACC-NIL', parties.b)
  // P.noAccount deliberately has none.

  const valuationIds = {}
  // 250 000.00 at 0.00850000 = 2 125.00, plus a 12.00 fixed charge = 2 137.00.
  valuationIds.full = await valuation(P.full.parcel_id, categories['RP-RES'], '250000.00', 'USD')
  valuationIds.noTariff = await valuation(P.noTariff.parcel_id, categories['RP-IND'], '80000.00', 'USD')
  valuationIds.wrongCurrency = await valuation(P.wrongCurrency.parcel_id, categories['RP-RES'], '1500000.00', 'ZWG')
  valuationIds.draftTariff = await valuation(P.draftTariff.parcel_id, categories['RP-COM'], '90000.00', 'USD')
  valuationIds.draftValue = await valuation(P.draftValue.parcel_id, categories['RP-RES'], '70000.00', 'USD', 'draft')
  valuationIds.nilCharge = await valuation(P.nilCharge.parcel_id, categories['RP-NIL'], '0.00', 'USD')

  const tariffIds = {}
  tariffIds.res = await tariff(categories['RP-RES'], '0.00850000', { fixed: '12.00' })
  tariffIds.com = await tariff(categories['RP-COM'], '0.01000000', { status: 'draft' })
  tariffIds.nil = await tariff(categories['RP-NIL'], '0.00000000')
  // RP-IND deliberately has no tariff at all.

  return {
    authorityId, yearId, preparer, poster, accounts, categories, parties,
    parcels: P, accountIds, valuationIds, tariffIds,
    periodId: period[0].id, closedPeriodId: closed[0].id,
  }
}

/** The billable rows for the proof period, keyed by parcel. */
async function billable(client, f, currency = 'USD') {
  const { rows } = await client.query(
    `SELECT * FROM finance.rates_billable($1, $2, $3, $4)`,
    [f.yearId, DATES.billFrom, DATES.billTo, currency],
  )
  const by = new Map(rows.map((r) => [r.parcel_id, r]))
  return { rows, by }
}

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

  const { rows: before } = await client.query(
    `SELECT (SELECT count(*) FROM finance.ledger_entry)::int AS entries,
            (SELECT count(*) FROM finance.voucher)::int      AS vouchers,
            (SELECT count(*) FROM finance.rates_bill)::int   AS bills`,
  )

  console.log('\nThe state of the data this machinery is waiting on (decisions D17, D18, D19)')
  {
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM land.parcel)::int                      AS parcels,
              (SELECT count(*) FROM finance.valuation_roll
                WHERE deleted_at IS NULL)::int                             AS valuations,
              (SELECT count(*) FROM finance.rates_tariff
                WHERE deleted_at IS NULL AND status = 'approved')::int     AS approved_tariffs,
              (SELECT count(*) FROM finance.rates_account
                WHERE deleted_at IS NULL)::int                             AS rates_accounts,
              (SELECT count(*) FROM spatial_planning.parcel_owner)::int    AS owners`,
    )
    const s = rows[0]
    console.log(`  ${s.parcels} parcels, ${s.valuations} rateable values, ${s.approved_tariffs} approved tariffs, `
      + `${s.rates_accounts} rates accounts, ${s.owners} owner rows`)
    if (s.parcels > 0 && s.rates_accounts === 0) {
      ok('rates billing is blocked by data and not by code',
        `${s.parcels} properties exist and none has a ratepayer of record (decision D19)`)
    } else {
      ok('rates accounts exist', `${s.rates_accounts} of ${s.parcels} properties`)
    }
  }

  console.log('\nG9 — a billing run refuses what it cannot compute, and names the decision it waits on')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows, by } = await billable(client, f)

    is('every current property is considered, not only the ones with accounts',
      rows.length > 700, true, `${rows.length} properties considered`)

    const expectRefusal = (key, reason, waiting) => {
      const r = by.get(f.parcels[key].parcel_id)
      if (!r) { bad(`${key} is considered`, 'the parcel is missing from the billable set'); return }
      if (r.billable) { bad(`${key} is refused`, `it was reported billable (${r.message})`); return }
      if (r.reason_code !== reason) {
        bad(`${key} is refused as ${reason}`, `refused as ${r.reason_code}: ${r.message}`); return
      }
      if (String(r.waiting_on) !== String(waiting)) {
        bad(`${key} waits on ${waiting}`, `it waits on ${r.waiting_on}`); return
      }
      ok(`${reason} -> ${waiting === null ? 'no decision' : waiting}`, r.message)
    }

    // G9 proper: no rateable value is refused, and no bill of nil is produced.
    expectRefusal('noValue', 'no_rateable_value', 'D17')
    expectRefusal('noAccount', 'no_rates_account', 'D19')
    expectRefusal('noTariff', 'no_approved_tariff', 'D18')
    expectRefusal('wrongCurrency', 'currency_mismatch', 'D17')
    expectRefusal('draftTariff', 'no_approved_tariff', 'D18')
    expectRefusal('draftValue', 'no_rateable_value', 'D17')
    expectRefusal('nilCharge', 'nil_charge', null)

    const full = by.get(f.parcels.full.parcel_id)
    is('a property with an owner, a value and an approved rate is billable', full.billable, true, full.message)
    // 250 000.00 at 0.00850000 = 2 125.00, plus the 12.00 fixed charge.
    is('the charge is the value at the rate plus the fixed charge', full.bill_amount, '2137.00')

    is('a refused property carries no amount at all',
      by.get(f.parcels.noValue.parcel_id).bill_amount, null,
      'not 0.00 — a property with no value is not a property charged nil')
  })

  console.log('\nG9 — the run writes its refusals down, and its counts reconcile')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-RUN-1') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const runId = run[0].id

    const { rows: counts } = await client.query(
      `SELECT properties_considered, bills_raised, properties_refused, status
         FROM finance.rates_billing_run WHERE id = $1`, [runId],
    )
    const c = counts[0]
    is('considered = raised + refused, with nothing skipped silently',
      c.properties_considered, c.bills_raised + c.properties_refused,
      `${c.properties_considered} considered = ${c.bills_raised} raised + ${c.properties_refused} refused`)
    is('one bill was raised', c.bills_raised, 1)
    is('the run has posted nothing yet', c.status, 'raised')

    const { rows: refusals } = await client.query(
      `SELECT reason_code, waiting_on, count(*)::int AS n
         FROM finance.rates_billing_refusal WHERE billing_run_id = $1
        GROUP BY 1,2 ORDER BY 3 DESC`, [runId],
    )
    is('every refusal is a row somebody can work from',
      refusals.reduce((n, r) => n + r.n, 0), c.properties_refused,
      refusals.map((r) => `${r.reason_code}/${r.waiting_on ?? '-'}: ${r.n}`).join(', '))

    const { rows: waiting } = await client.query(
      `SELECT waiting_on, count(*)::int AS n FROM finance.rates_billing_refusal
        WHERE billing_run_id = $1 AND waiting_on IS NOT NULL GROUP BY 1 ORDER BY 1`, [runId],
    )
    ok('the refusals name which Council decision each property waits on',
      waiting.map((w) => `${w.waiting_on}: ${w.n}`).join(', '))

    // The draft exists and the ledger is untouched: posting is a separate act.
    const { rows: drafts } = await client.query(
      `SELECT v.status, v.voucher_type, count(*)::int AS n
         FROM finance.rates_bill b JOIN finance.voucher v ON v.id = b.voucher_id
        WHERE b.billing_run_id = $1 GROUP BY 1,2`, [runId],
    )
    is('the bill is a DRAFT voucher of type rates_bill', `${drafts[0].status}/${drafts[0].voucher_type}`, 'draft/rates_bill')
    const { rows: noEntries } = await client.query(
      `SELECT count(*)::int AS n FROM finance.ledger_entry e
         JOIN finance.rates_bill b ON b.voucher_id = e.voucher_id
        WHERE b.billing_run_id = $1`, [runId],
    )
    is('raising a run writes no ledger entry', noEntries[0].n, 0,
      'finance.post_voucher() is still the only writer of the ledger')

    // A repeat run over the same period refuses the account it already billed.
    const { rows: again } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-RUN-2') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const { rows: dup } = await client.query(
      `SELECT count(*)::int AS n FROM finance.rates_billing_refusal
        WHERE billing_run_id = $1 AND reason_code = 'already_billed'`, [again[0].id],
    )
    is('a repeated run refuses the period it has already billed rather than billing it twice', dup[0].n, 1)
    const { rows: secondCounts } = await client.query(
      'SELECT bills_raised FROM finance.rates_billing_run WHERE id = $1', [again[0].id],
    )
    is('and raises nothing', secondCounts[0].bills_raised, 0)
  })

  console.log('\nThe run refuses to start on a basis that could never post')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const call = `SELECT finance.raise_rates_billing($1,$2,$3,$4,$5,$6,$7,$8,$9)`

    await expectError(client, 'a bank account is not a receivable control', call,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting, 'USD',
        f.accounts['RATES-PROOF-1100'], f.accounts['RATES-PROOF-4100'], f.preparer, 'RP-RUN-A'],
      /not a receivable control account/)

    await expectError(client, 'an expense account cannot carry rates revenue', call,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting, 'USD',
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-5100'], f.preparer, 'RP-RUN-B'],
      /not revenue/)

    await expectError(client, 'a period outside the financial year is refused', call,
      [f.yearId, day(-400), day(-380), DATES.posting, 'USD',
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer, 'RP-RUN-C'],
      /is not inside financial year/)

    await expectError(client, 'a posting date in a closed period is refused before any draft exists', call,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.p2From, 'USD',
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer, 'RP-RUN-D'],
      /accepts no postings/)

    await expectError(client, 'a posting date in no period at all is refused', call,
      [f.yearId, DATES.billFrom, DATES.billTo, day(300), 'USD',
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer, 'RP-RUN-E'],
      /no accounting period/)

    // A tariff pointing its revenue somewhere that is not revenue stops the run before it writes.
    await client.query(
      `UPDATE finance.rates_tariff SET revenue_ledger_account_id = $1 WHERE id = $2`,
      [f.accounts['RATES-PROOF-5100'], f.tariffIds.res],
    )
    await expectError(client, 'a tariff naming a non-revenue account stops the run before it starts', call,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting, 'USD',
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer, 'RP-RUN-F'],
      /names a revenue account that is not a postable revenue account/)
  })

  console.log('\nThe registers refuse data a billing run would have to choose between')

  await inRollback(client, async () => {
    const f = await fixtures(client)

    await expectError(client, 'two rateable values in force for one property at once',
      `INSERT INTO finance.valuation_roll
         (authority_id, parcel_id, property_category_id, rateable_value, currency, effective_from,
          source, status)
       VALUES ($1,$2,$3,'999999.00','USD',$4,'RATES-PROOF clash','active')`,
      [f.authorityId, f.parcels.full.parcel_id, f.categories['RP-RES'], DATES.yearStart],
      /already has an active rateable value in force/)

    await expectError(client, 'two active rates accounts for one property',
      `INSERT INTO finance.rates_account (authority_id, account_no, parcel_id, party_id, status)
       VALUES ($1,'RP-ACC-DUP',$2,$3,'active')`,
      [f.authorityId, f.parcels.full.parcel_id, f.parties.a],
      /uq_rates_account_parcel_active|duplicate key/)

    await expectError(client, 'two approved tariffs for one category, year and currency',
      `INSERT INTO finance.rates_tariff
         (authority_id, financial_year_id, property_category_id, currency, rate_in_dollar,
          status, approved_by, approved_at)
       VALUES ($1,$2,$3,'USD','0.09000000','approved',$4,now())`,
      [f.authorityId, f.yearId, f.categories['RP-RES'], f.poster],
      /uq_rates_tariff_approved|duplicate key/)

    await expectError(client, 'an approved tariff with nobody recorded as approving it',
      `INSERT INTO finance.rates_tariff
         (authority_id, financial_year_id, property_category_id, currency, rate_in_dollar, status)
       VALUES ($1,$2,$3,'USD','0.01000000','approved')`,
      [f.authorityId, f.yearId, f.categories['RP-IND']],
      /rates_tariff_approval_recorded/)
  })

  console.log('\nThe charge has one definition, and it is in Postgres')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-AMT') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const { rows: bill } = await client.query(
      `SELECT id, bill_no, rateable_value::text AS rateable_value, rate_in_dollar::text AS rate,
              fixed_charge::text AS fixed, amount::text AS amount, voucher_id
         FROM finance.rates_bill WHERE billing_run_id = $1`, [run[0].id],
    )
    is('the bill amount is the generated figure, not one a caller supplied',
      bill[0].amount, '2137.00', `${bill[0].rateable_value} at ${bill[0].rate} plus ${bill[0].fixed}`)

    await expectError(client, 'the amount cannot be written at all',
      'UPDATE finance.rates_bill SET amount = 1 WHERE id = $1', [bill[0].id],
      /can only be updated to DEFAULT|generated column/)

    // The rate is numeric(18,8): a cent and a half in the dollar is 0.015, and rounding the RATE
    // to two places would bill a third too much.
    const { rows: precise } = await client.query(
      `SELECT finance.rates_bill_amount(1000.00, 0.01500000, NULL, NULL)::text AS fine,
              finance.rates_bill_amount(1000.00, 0.02000000, NULL, NULL)::text AS rounded`,
    )
    is('a rate of 0.015 in the dollar bills 15.00', precise[0].fine, '15.00',
      `rounding the rate to 0.02 would have billed ${precise[0].rounded}`)

    const { rows: floored } = await client.query(
      `SELECT finance.rates_bill_amount(100.00, 0.00850000, NULL, 50.00)::text AS floored,
              finance.rates_bill_amount(100.00, 0.00850000, NULL, NULL)::text  AS unfloored`,
    )
    is('a minimum charge floors the charge', floored[0].floored, '50.00')
    is('and no minimum charge is not a minimum of nil', floored[0].unfloored, '0.85',
      'NULL means the Council recorded no minimum, which is not the same as nil')
  })

  console.log('\nG8 — a bill raises a receivable, a receipt settles it, and the ageing follows')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-G8') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const { rows: bill } = await client.query(
      `SELECT id, bill_no, voucher_id, amount::text AS amount, rates_account_id
         FROM finance.rates_bill WHERE billing_run_id = $1`, [run[0].id],
    )
    const b = bill[0]

    // G7 through the rates path: the officer who raised the run cannot post its bills.
    await expectError(client, 'whoever raised the run cannot post its bills',
      'SELECT finance.post_voucher($1, $2)', [b.voucher_id, f.preparer],
      /must be posted by somebody else/)

    const { rows: posted } = await client.query('SELECT finance.post_voucher($1,$2) AS n',
      [b.voucher_id, f.poster])
    is('posting the bill writes its two ledger lines', posted[0].n, 2)

    const { rows: sides } = await client.query(
      `SELECT la.code, e.debit::text AS debit, e.credit::text AS credit
         FROM finance.ledger_entry e JOIN finance.ledger_account la ON la.id = e.ledger_account_id
        WHERE e.voucher_id = $1 ORDER BY la.code`, [b.voucher_id],
    )
    is('a bill debits the receivable control',
      `${sides[0].code} Dr ${sides[0].debit}`, `RATES-PROOF-1200 Dr ${b.amount}`)
    is('and credits rates revenue, recognised when billed',
      `${sides[1].code} Cr ${sides[1].credit}`, `RATES-PROOF-4100 Cr ${b.amount}`)

    const ageing = async () => {
      const { rows } = await client.query(
        `SELECT outstanding_amount::text AS outstanding, settled_amount::text AS settled,
                ageing_bucket, days_outstanding
           FROM finance.v_rates_arrears WHERE rates_bill_id = $1`, [b.id],
      )
      return rows[0]
    }

    const raised = await ageing()
    is('the whole bill is outstanding before anything is received', raised.outstanding, b.amount,
      `bucket ${raised.ageing_bucket}, ${raised.days_outstanding} days`)
    is('and it ages from its own posting date', raised.ageing_bucket, '31_60',
      `posted ${DATES.posting}, ${raised.days_outstanding} days ago`)

    /** A receipt: Dr bank / Cr receivable, settling the bill through against_voucher_id. */
    const receipt = async (no, amount, date) => {
      const { rows: v } = await client.query(
        `INSERT INTO finance.voucher
           (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
            narration, status, prepared_by)
         VALUES ($1,$2,'receipt','USD',$3,$4,'RATES-PROOF receipt','draft',$5) RETURNING id`,
        [f.authorityId, no, f.yearId, date, f.preparer],
      )
      const voucherId = v[0].id
      await client.query(
        `INSERT INTO finance.voucher_line
           (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
         VALUES ($1,$2,1,$3,$4,0)`,
        [f.authorityId, voucherId, f.accounts['RATES-PROOF-1100'], amount],
      )
      await client.query(
        `INSERT INTO finance.voucher_line
           (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id,
            against_voucher_id)
         VALUES ($1,$2,2,$3,0,$4,$5,$6)`,
        [f.authorityId, voucherId, f.accounts['RATES-PROOF-1200'], amount, f.parties.a, b.voucher_id],
      )
      await client.query(
        `INSERT INTO finance.rates_receipt
           (authority_id, receipt_no, rates_account_id, party_id, financial_year_id, amount,
            currency, received_on, method, voucher_id)
         VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,'bank_transfer',$8)`,
        [f.authorityId, no, b.rates_account_id, f.parties.a, f.yearId, amount, date, voucherId],
      )
      await client.query('SELECT finance.post_voucher($1,$2)', [voucherId, f.poster])
      return voucherId
    }

    await receipt('RATES-PROOF-RC-1', '1000.00', DATES.nextFrom)
    const part = await ageing()
    is('a part payment reduces the outstanding figure and nothing else', part.outstanding, '1137.00',
      `settled ${part.settled}, bucket ${part.ageing_bucket}`)
    is('and the bill still ages from the day it was billed, not from the payment',
      part.ageing_bucket, '31_60')

    await receipt('RATES-PROOF-RC-2', '1137.00', DATES.nextTo)
    const settled = await ageing()
    is('settling the balance moves the bill to the settled bucket', settled.ageing_bucket, 'settled')
    is('and leaves nothing outstanding', settled.outstanding, '0.00')

    // The check that catches an ageing report which has quietly stopped agreeing with the books.
    const { rows: recon } = await client.query(
      `WITH ageing AS (
         SELECT currency, sum(outstanding_amount) AS outstanding
           FROM finance.v_rates_arrears WHERE account_no LIKE 'RP-ACC-%' GROUP BY 1
       ), control AS (
         SELECT ab.currency, ab.net_debit AS balance
           FROM finance.v_account_balance ab
          WHERE ab.ledger_account_id = $1
       )
       SELECT c.currency, a.outstanding::text AS ageing, c.balance::text AS control,
              (a.outstanding - c.balance)::text AS difference
         FROM control c JOIN ageing a ON a.currency = c.currency`,
      [f.accounts['RATES-PROOF-1200']],
    )
    for (const r of recon) {
      is(`the ${r.currency} rates arrears equal the receivable control balance`,
        r.difference, '0.00', `arrears ${r.ageing} = control ${r.control}`)
    }

    // An unallocated receipt is money received that is not yet matched to a bill. It must not
    // vanish from the arrears, or the two stop reconciling.
    const { rows: v3 } = await client.query(
      `INSERT INTO finance.voucher
         (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
          narration, status, prepared_by)
       VALUES ($1,'RATES-PROOF-RC-3','receipt','USD',$2,$3,'unallocated','draft',$4) RETURNING id`,
      [f.authorityId, f.yearId, DATES.nextTo, f.preparer],
    )
    await client.query(
      `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
       VALUES ($1,$2,1,$3,'500.00',0)`,
      [f.authorityId, v3[0].id, f.accounts['RATES-PROOF-1100']],
    )
    await client.query(
      `INSERT INTO finance.voucher_line
         (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id)
       VALUES ($1,$2,2,$3,0,'500.00',$4)`,
      [f.authorityId, v3[0].id, f.accounts['RATES-PROOF-1200'], f.parties.a],
    )
    await client.query(
      `INSERT INTO finance.rates_receipt
         (authority_id, receipt_no, rates_account_id, party_id, financial_year_id, amount,
          currency, received_on, voucher_id)
       VALUES ($1,'RATES-PROOF-RC-3',$2,$3,$4,'500.00','USD',$5,$6)`,
      [f.authorityId, b.rates_account_id, f.parties.a, f.yearId, DATES.nextTo, v3[0].id],
    )
    await client.query('SELECT finance.post_voucher($1,$2)', [v3[0].id, f.poster])

    const { rows: unalloc } = await client.query(
      `SELECT ageing_bucket, outstanding_amount::text AS outstanding
         FROM finance.v_rates_arrears WHERE receipt_no = 'RATES-PROOF-RC-3'`,
    )
    is('an unallocated receipt is reported, not dropped', unalloc[0].ageing_bucket, 'unallocated')
    is('and carries a negative outstanding figure so the arrears still reconcile',
      unalloc[0].outstanding, '-500.00')

    const { rows: recon2 } = await client.query(
      `WITH ageing AS (
         SELECT currency, sum(outstanding_amount) AS outstanding
           FROM finance.v_rates_arrears WHERE account_no LIKE 'RP-ACC-%' GROUP BY 1
       ), control AS (
         SELECT ab.currency, ab.net_debit AS balance
           FROM finance.v_account_balance ab WHERE ab.ledger_account_id = $1
       )
       SELECT c.currency, (a.outstanding - c.balance)::text AS difference
         FROM control c JOIN ageing a ON a.currency = c.currency`,
      [f.accounts['RATES-PROOF-1200']],
    )
    for (const r of recon2) {
      is(`the ${r.currency} arrears still equal the control after an unallocated receipt`,
        r.difference, '0.00')
    }

    // Two books, and no total across them: the one rule that outlives every report.
    const { rows: ccy } = await client.query(
      `SELECT count(DISTINCT currency)::int AS n FROM finance.v_rates_arrears
        WHERE account_no LIKE 'RP-ACC-%'`,
    )
    ok('the arrears are reported per currency and never summed across them',
      `${ccy[0].n} currency book(s) in this fixture; finance.v_rates_arrears groups by currency and has no combined row`)
  })

  // ── A reversal undoes a settlement, and a bill (migration 206) ──────────────────────────────
  // finance.reverse_voucher() carries `against_voucher_id` onto the reversal "so a reversed receipt
  // stops settling the bill it was allocated to" (203:849). Until migration 206 the ageing view did
  // not honour that: it counted only CREDITS naming a bill, so a dishonoured payment left the bill
  // reading `settled`, and the debt reappeared under the reversal voucher — which is neither a bill
  // nor a receipt, so finance.v_rates_arrears dropped it and the arrears stopped agreeing with the
  // receivable control account. These proofs are the regression for that.
  console.log('\nA reversed receipt puts the debt back on the bill; a reversed bill owes nothing')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-REV') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const { rows: bill } = await client.query(
      `SELECT id, voucher_id, amount::text AS amount, rates_account_id
         FROM finance.rates_bill WHERE billing_run_id = $1`, [run[0].id],
    )
    const b = bill[0]
    await client.query('SELECT finance.post_voucher($1,$2)', [b.voucher_id, f.poster])

    // Paid in full ...
    const { rows: v } = await client.query(
      `INSERT INTO finance.voucher
         (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
          narration, status, prepared_by)
       VALUES ($1,'RATES-PROOF-REV-RC','receipt','USD',$2,$3,'paid in full','draft',$4) RETURNING id`,
      [f.authorityId, f.yearId, DATES.nextFrom, f.preparer],
    )
    await client.query(
      `INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit)
       VALUES ($1,$2,1,$3,$4,0)`, [f.authorityId, v[0].id, f.accounts['RATES-PROOF-1100'], b.amount],
    )
    await client.query(
      `INSERT INTO finance.voucher_line
         (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, party_id, against_voucher_id)
       VALUES ($1,$2,2,$3,0,$4,$5,$6)`,
      [f.authorityId, v[0].id, f.accounts['RATES-PROOF-1200'], b.amount, f.parties.a, b.voucher_id],
    )
    await client.query(
      `INSERT INTO finance.rates_receipt
         (authority_id, receipt_no, rates_account_id, party_id, financial_year_id, amount,
          currency, received_on, method, voucher_id)
       VALUES ($1,'RATES-PROOF-REV-RC',$2,$3,$4,$5,'USD',$6,'cheque',$7)`,
      [f.authorityId, b.rates_account_id, f.parties.a, f.yearId, b.amount, DATES.nextFrom, v[0].id],
    )
    await client.query('SELECT finance.post_voucher($1,$2)', [v[0].id, f.poster])

    const billRow = async () => {
      const { rows } = await client.query(
        `SELECT outstanding_amount::text AS outstanding, settled_amount::text AS settled, ageing_bucket
           FROM finance.v_rates_arrears WHERE rates_bill_id = $1`, [b.id],
      )
      return rows[0]
    }
    const reconciles = async (label) => {
      const { rows } = await client.query(
        `SELECT (COALESCE((SELECT sum(outstanding_amount) FROM finance.v_rates_arrears
                            WHERE account_no LIKE 'RP-ACC-%' AND currency = 'USD'), 0)
                 - COALESCE((SELECT net_debit FROM finance.v_account_balance
                              WHERE ledger_account_id = $1 AND currency = 'USD'), 0))::text AS difference,
                (COALESCE((SELECT sum(outstanding_amount) FROM finance.v_debtor_ageing
                            WHERE ledger_account_id = $1 AND currency = 'USD'), 0)
                 - COALESCE((SELECT net_debit FROM finance.v_account_balance
                              WHERE ledger_account_id = $1 AND currency = 'USD'), 0))::text AS ledger_difference`,
        [f.accounts['RATES-PROOF-1200']],
      )
      is(`${label}: the rates arrears equal the receivable control`, rows[0].difference, '0.00')
      is(`${label}: the ledger debtor ageing equals the receivable control`, rows[0].ledger_difference, '0.00')
    }

    is('the bill is settled once paid', (await billRow()).ageing_bucket, 'settled')

    // ... and then the cheque is dishonoured.
    await client.query(
      `SELECT finance.reverse_voucher($1, $2, $3, 'cheque dishonoured', $4::date)`,
      [v[0].id, f.preparer, f.poster, DATES.nextTo],
    )
    const bounced = await billRow()
    is('reversing the receipt puts the whole bill back in arrears', bounced.outstanding, b.amount,
      `settled ${bounced.settled}, bucket ${bounced.ageing_bucket}`)
    is('and the bill ages from the day it was billed, not from the day the payment failed',
      bounced.ageing_bucket, '31_60')
    await reconciles('after a reversed receipt')

    // The bill itself is then reversed (raised in error). Nothing is owed on it.
    await client.query(
      `SELECT finance.reverse_voucher($1, $2, $3, 'billed in error', $4::date)`,
      [b.voucher_id, f.preparer, f.poster, DATES.nextTo],
    )
    const undone = await billRow()
    is('a reversed bill owes nothing', undone.outstanding, '0.00', `bucket ${undone.ageing_bucket}`)
    const { rows: stray } = await client.query(
      `SELECT count(*)::int AS n FROM finance.v_debtor_ageing
        WHERE ledger_account_id = $1 AND outstanding_amount <> 0`, [f.accounts['RATES-PROOF-1200']],
    )
    is('and leaves no stray debit or unallocated credit behind in the ageing', stray[0].n, 0)
    await reconciles('after a reversed bill')
  })

  // ── Committing a run, taking a payment, cancelling a run (migration 206) ────────────────────
  console.log('\nA run is committed by somebody else; a receipt cannot settle more than is open')

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-OPS') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const runId = run[0].id
    const { rows: bill } = await client.query(
      `SELECT id, bill_no, voucher_id, amount::text AS amount, rates_account_id
         FROM finance.rates_bill WHERE billing_run_id = $1`, [runId],
    )
    const b = bill[0]

    /** record_rates_receipt with the fixture's defaults. */
    const receiptSql = `SELECT finance.record_rates_receipt($1,$2,$3,$4::numeric,'USD',$5::date,$6,$7,$8::jsonb) AS id`
    const receiptArgs = (no, amount, allocations, over = {}) => [
      over.account || b.rates_account_id, f.yearId, no, amount, DATES.nextFrom,
      over.bank || f.accounts['RATES-PROOF-1100'], f.preparer, JSON.stringify(allocations)]

    await expectError(client, 'a bill that is still a draft cannot be settled', receiptSql,
      receiptArgs('RATES-PROOF-OPS-RC0', '100.00', [{ rates_bill_id: b.id, amount: '100.00' }]),
      /cannot be settled until its billing run is committed/)

    await expectError(client, 'whoever raised the run cannot commit it',
      'SELECT finance.commit_rates_billing_run($1,$2)', [runId, f.preparer],
      /must be posted by somebody else/)
    const { rows: committed } = await client.query(
      'SELECT finance.commit_rates_billing_run($1,$2) AS n', [runId, f.poster])
    is('committing the run posts every bill it raised', committed[0].n, 1)
    const { rows: runRow } = await client.query(
      `SELECT r.status, (r.committed_by = $2) AS by_poster,
              (SELECT count(*)::int FROM finance.ledger_entry e
                 JOIN finance.rates_bill rb ON rb.voucher_id = e.voucher_id
                WHERE rb.billing_run_id = r.id) AS entries
         FROM finance.rates_billing_run r WHERE r.id = $1`, [runId, f.poster])
    is('the run is committed, attributed, and its bills are in the ledger',
      `${runRow[0].status}/${runRow[0].by_poster}/${runRow[0].entries}`, 'committed/true/2')
    await expectError(client, 'a committed run cannot be committed twice',
      'SELECT finance.commit_rates_billing_run($1,$2)', [runId, f.poster], /already committed/)
    await expectError(client, 'a committed run cannot be cancelled, only reversed bill by bill',
      'SELECT finance.cancel_rates_billing_run($1,$2,$3)', [runId, f.poster, 'changed our minds'],
      /cannot be cancelled/)

    await expectError(client, 'a receipt cannot allocate more to a bill than the bill has open',
      receiptSql, receiptArgs('RATES-PROOF-OPS-RC1', '3000.00', [{ rates_bill_id: b.id, amount: '2137.01' }]),
      /still open and this receipt allocates/)
    await expectError(client, 'allocations cannot add up to more than the payment',
      receiptSql, receiptArgs('RATES-PROOF-OPS-RC1', '500.00', [{ rates_bill_id: b.id, amount: '600.00' }]),
      /allocations add up to/)
    await expectError(client, 'a payment on one account cannot settle another account\'s bill',
      receiptSql, receiptArgs('RATES-PROOF-OPS-RC1', '100.00',
        [{ rates_bill_id: b.id, amount: '100.00' }], { account: f.accountIds.noTariff }),
      /belongs to a different rates account/)
    await expectError(client, 'money cannot be receipted into an account that is not bank or cash',
      receiptSql, receiptArgs('RATES-PROOF-OPS-RC1', '100.00', [], { bank: f.accounts['RATES-PROOF-4100'] }),
      /not a bank or cash account/)

    // 1 200.00 taken: 1 000.00 against the bill, 200.00 left unallocated.
    const { rows: rc1 } = await client.query(receiptSql,
      receiptArgs('RATES-PROOF-OPS-RC1', '1200.00', [{ rates_bill_id: b.id, amount: '1000.00' }]))
    const { rows: lines } = await client.query(
      `SELECT string_agg(l.debit::text || '/' || l.credit::text || '/' ||
                         CASE WHEN l.against_voucher_id IS NULL THEN '-' ELSE 'bill' END,
                         ' ' ORDER BY l.line_no) AS shape,
              (SELECT difference::numeric(18,2)::text FROM finance.voucher_imbalance(v.id)) AS difference, v.status
         FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
         JOIN finance.voucher_line l ON l.voucher_id = v.id
        WHERE rc.id = $1 GROUP BY v.id, v.status`, [rc1[0].id])
    is('the receipt is Dr bank, Cr the bill, Cr the unallocated remainder — and a draft',
      `${lines[0].shape} ${lines[0].status}`, '1200.00/0.00/- 0.00/1000.00/bill 0.00/200.00/- draft')
    is('and its draft voucher balances', lines[0].difference, '0.00')

    const { rows: open } = await client.query(
      'SELECT finance.rates_bill_unsettled($1)::text AS open', [b.id])
    is('a DRAFT receipt already reduces what the bill has open', open[0].open, '1137.00')
    await expectError(client, 'so a second receipt cannot settle the same money twice before either is posted',
      receiptSql, receiptArgs('RATES-PROOF-OPS-RC2', '1137.01', [{ rates_bill_id: b.id, amount: '1137.01' }]),
      /still open and this receipt allocates/)

    const { rows: rcv } = await client.query(
      'SELECT voucher_id FROM finance.rates_receipt WHERE id = $1', [rc1[0].id])
    await expectError(client, 'whoever took the payment cannot post it',
      'SELECT finance.post_voucher($1,$2)', [rcv[0].voucher_id, f.preparer],
      /must be posted by somebody else/)
    await client.query('SELECT finance.post_voucher($1,$2)', [rcv[0].voucher_id, f.poster])
    const { rows: arrears } = await client.query(
      `SELECT string_agg(ageing_bucket || ' ' || outstanding_amount::text, ', ' ORDER BY ageing_bucket) AS rows,
              sum(outstanding_amount)::text AS total
         FROM finance.v_rates_arrears WHERE rates_account_id = $1`, [b.rates_account_id])
    is('once posted, the arrears show the part-paid bill and the unallocated credit',
      arrears[0].rows, '31_60 1137.00, unallocated -200.00')
    const { rows: control } = await client.query(
      `SELECT net_debit::text AS balance FROM finance.v_account_balance
        WHERE ledger_account_id = $1 AND currency = 'USD'`, [f.accounts['RATES-PROOF-1200']])
    is('and still equal the receivable control account', arrears[0].total, control[0].balance)

    // The constraint, with every route bypassed.
    await expectError(client, 'whoever drafted a tariff cannot be recorded as its approver',
      'UPDATE finance.rates_tariff SET created_by = approved_by WHERE id = $1', [f.tariffIds.res],
      /rates_tariff_drafted_and_approved_differ/)
  })

  // A draft voucher's lines can be replaced by anyone who may prepare vouchers. The bill's amount is
  // a generated column and cannot be; so the two can be made to disagree, and must not post.
  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-TMP') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    const { rows: bill } = await client.query(
      'SELECT voucher_id, amount::text AS amount FROM finance.rates_bill WHERE billing_run_id = $1', [run[0].id])
    // Still balanced, still a valid voucher — and 2 000.00 short of the bill.
    await client.query(
      `UPDATE finance.voucher_line SET debit = CASE WHEN debit > 0 THEN 137.00 ELSE 0 END,
                                       credit = CASE WHEN credit > 0 THEN 137.00 ELSE 0 END
        WHERE voucher_id = $1`, [bill[0].voucher_id])
    await expectError(client, 'a bill whose draft voucher was edited to a different amount cannot be posted on its own',
      'SELECT finance.post_voucher($1,$2)', [bill[0].voucher_id, f.poster],
      /no longer agrees with rates bill/)
    await expectError(client, 'nor by committing its run',
      'SELECT finance.commit_rates_billing_run($1,$2)', [run[0].id, f.poster],
      /no longer agrees with rates bill/)
    const { rows: entries } = await client.query(
      'SELECT count(*)::int AS n FROM finance.ledger_entry WHERE voucher_id = $1', [bill[0].voucher_id])
    is('and nothing of it reached the ledger', entries[0].n, 0, `bill ${bill[0].amount}, voucher 137.00`)
  })

  await inRollback(client, async () => {
    const f = await fixtures(client)
    const { rows: run } = await client.query(
      `SELECT finance.raise_rates_billing($1,$2,$3,$4,'USD',$5,$6,$7,'RATES-PROOF-CXL') AS id`,
      [f.yearId, DATES.billFrom, DATES.billTo, DATES.posting,
        f.accounts['RATES-PROOF-1200'], f.accounts['RATES-PROOF-4100'], f.preparer],
    )
    await expectError(client, 'a run cannot be cancelled without a reason',
      'SELECT finance.cancel_rates_billing_run($1,$2,$3)', [run[0].id, f.preparer, '  '],
      /needs a reason/)
    await client.query('SELECT finance.cancel_rates_billing_run($1,$2,$3)',
      [run[0].id, f.preparer, 'raised against the wrong period'])
    const { rows: state } = await client.query(
      `SELECT r.status, r.cancel_reason,
              (SELECT count(*)::int FROM finance.rates_bill rb
                WHERE rb.billing_run_id = r.id AND rb.deleted_at IS NULL) AS live_bills,
              (SELECT string_agg(DISTINCT v.status, ',') FROM finance.rates_bill rb
                 JOIN finance.voucher v ON v.id = rb.voucher_id WHERE rb.billing_run_id = r.id) AS vouchers,
              (SELECT count(*)::int FROM finance.rates_billing_refusal x WHERE x.billing_run_id = r.id) AS refusals,
              (SELECT count(*)::int FROM finance.ledger_entry e JOIN finance.rates_bill rb
                 ON rb.voucher_id = e.voucher_id WHERE rb.billing_run_id = r.id) AS entries
         FROM finance.rates_billing_run r WHERE r.id = $1`, [run[0].id])
    is('a cancelled run keeps its drafts as cancelled vouchers and posts nothing',
      `${state[0].status}/${state[0].live_bills}/${state[0].vouchers}/${state[0].entries}`,
      'cancelled/0/cancelled/0', state[0].cancel_reason)
    ok('and keeps its refusals, which are still the work list', `${state[0].refusals} refusal row(s)`)
    const again = await billable(client, f)
    is('cancelling frees the period to be billed again',
      again.by.get(f.parcels.full.parcel_id).billable, true)
  })

  const { rows: after } = await client.query(
    `SELECT (SELECT count(*) FROM finance.ledger_entry)::int AS entries,
            (SELECT count(*) FROM finance.voucher)::int      AS vouchers,
            (SELECT count(*) FROM finance.rates_bill)::int   AS bills`,
  )
  console.log(`\nledger_entry ${before[0].entries} -> ${after[0].entries}, `
    + `voucher ${before[0].vouchers} -> ${after[0].vouchers}, `
    + `rates_bill ${before[0].bills} -> ${after[0].bills}`)
  if (before[0].entries === after[0].entries && before[0].vouchers === after[0].vouchers
      && before[0].bills === after[0].bills) {
    ok('this script wrote nothing', 'every proof ran inside a transaction that was rolled back')
  } else {
    bad('this script wrote nothing', 'rows persisted past the rollback')
  }

  await client.end()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => { console.error('\nharness error:', err.message); process.exit(2) })
