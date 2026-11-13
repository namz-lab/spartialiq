#!/usr/bin/env node
/**
 * Demo ratepayers with posted rates bills, so the Cash Office's Take Payment has something to
 * pay against on a development database.
 *
 *   node scripts/seed-cash-office-demo.js            seed (skips if already seeded)
 *   node scripts/seed-cash-office-demo.js --report   say what is there
 *
 * Everything is labelled "(demo)" and goes through the real machinery: valuations and an approved
 * tariff in the open financial year, then two billing runs (October and November) raised by the
 * revenue officer and committed by the Director of Finance (preparer is not poster). Posted bills
 * are in the ledger and are not removed by this script: a posted voucher is reversed, never
 * deleted. Refuses to run unless DEMO_SEED_ENABLED=true, and never against production.
 */
require('dotenv').config()
const { Client } = require('pg')

const REF = 'DEMO-CASH'
const CUSTOMERS = [
  { key: 'A', name: 'Chikomo Agro (Pvt) Ltd (demo)', phone: '+263 77 000 0001', email: 'accounts@chikomo-agro.example', address: 'Stand 104, Vungu Growth Point', cat: 'COM', value: '1800000.00' },
  { key: 'B', name: 'Moyo, T. (demo)', phone: '+263 77 000 0002', email: null, address: 'Stand 12, Vungu', cat: 'RES', value: '150000.00' },
  { key: 'C', name: 'Sibanda, P. (demo)', phone: '+263 77 000 0003', email: null, address: 'Stand 31, Vungu', cat: 'RES', value: '220000.00' },
  { key: 'D', name: 'Mapfumo, R. (demo)', phone: '+263 77 000 0004', email: null, address: 'Stand 58, Vungu', cat: 'RES', value: '310000.00' },
  { key: 'E', name: 'Vungu Primary School (demo)', phone: '+263 77 000 0005', email: 'office@vungu-primary.example', address: 'School Road, Vungu', cat: 'COM', value: '900000.00' },
]

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows: existing } = await client.query(
      `SELECT count(*)::int AS n FROM finance.party WHERE reference LIKE $1`, [`${REF}-%`])
    if (process.argv.includes('--report')) {
      const { rows } = await client.query(
        `SELECT pt.name, ra.account_no, count(rb.id)::int AS bills
           FROM finance.party pt JOIN finance.rates_account ra ON ra.party_id = pt.id
           LEFT JOIN finance.rates_bill rb ON rb.rates_account_id = ra.id
          WHERE pt.reference LIKE $1 GROUP BY 1, 2 ORDER BY 2`, [`${REF}-%`])
      console.table(rows)
      return
    }
    if (process.env.DEMO_SEED_ENABLED !== 'true') throw new Error('set DEMO_SEED_ENABLED=true to seed demo data')
    if (existing[0].n > 0) { console.log(`Already seeded (${existing[0].n} demo customers). Nothing to do.`); return }

    const one = async (sql, params) => (await client.query(sql, params)).rows[0]
    const auth = await one("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
    const year = await one(
      `SELECT id, start_date FROM finance.financial_year
        WHERE deleted_at IS NULL AND status = 'open' AND CURRENT_DATE BETWEEN start_date AND end_date
        ORDER BY start_date DESC LIMIT 1`)
    if (!year) throw new Error('no open financial year contains today')
    const account = async (type, nameLike) => (await one(
      `SELECT id FROM finance.ledger_account WHERE deleted_at IS NULL AND is_postable AND status = 'active'
          AND ${type} ORDER BY (name ILIKE $1) DESC, code LIMIT 1`, [nameLike]))?.id
    const receivable = await account(`account_type = 'receivable'`, '%rates%')
    const revenue = await account(`root_type = 'revenue'`, '%rates%')
    if (!receivable || !revenue) throw new Error('need a rates receivable and a revenue ledger account')
    const preparer = (await one(`SELECT id FROM public.users WHERE role IN ('revenue_officer', 'finance_officer') AND deleted_at IS NULL ORDER BY role DESC LIMIT 1`))?.id
    const poster = (await one(`SELECT id FROM public.users WHERE role = 'finance_admin' AND deleted_at IS NULL LIMIT 1`))?.id
    if (!preparer || !poster) throw new Error('need a revenue or finance officer and a finance_admin user')

    const { rows: parcels } = await client.query(
      `SELECT p.parcel_id FROM land.parcel p
        WHERE p.status = 'current'
          AND NOT EXISTS (SELECT 1 FROM finance.rates_account ra WHERE ra.parcel_id = p.parcel_id AND ra.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM finance.valuation_roll v WHERE v.parcel_id = p.parcel_id AND v.deleted_at IS NULL)
        ORDER BY p.parcel_id LIMIT $1`, [CUSTOMERS.length])
    if (parcels.length < CUSTOMERS.length) throw new Error('not enough current parcels without a rates account')

    await client.query('BEGIN')
    const categories = {}
    for (const [code, name, rate] of [['COM', 'Commercial (demo)', '0.00300000'], ['RES', 'Residential (demo)', '0.00200000']]) {
      const cat = await one(
        `INSERT INTO finance.property_category (authority_id, code, name, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`, [auth.id, `${REF}-${code}`, name])
      categories[code] = cat.id
      await client.query(
        `INSERT INTO finance.rates_tariff
           (authority_id, financial_year_id, property_category_id, currency, rate_in_dollar, fixed_charge,
            minimum_charge, revenue_ledger_account_id, status, approved_by, approved_at, resolution_reference)
         VALUES ($1, $2, $3, 'USD', $4, '5.00', NULL, $5, 'approved', $6, now(), 'Demo resolution (not a Council minute)')`,
        [auth.id, year.id, cat.id, rate, revenue, poster])
    }
    for (const [i, c] of CUSTOMERS.entries()) {
      const party = await one(
        `INSERT INTO finance.party (authority_id, party_type, name, reference, contact_phone, contact_email, address_text, status)
         VALUES ($1, 'ratepayer', $2, $3, $4, $5, $6, 'active') RETURNING id`,
        [auth.id, c.name, `${REF}-${c.key}`, c.phone, c.email, c.address])
      await client.query(
        `INSERT INTO finance.rates_account (authority_id, account_no, parcel_id, party_id, status)
         VALUES ($1, $2, $3, $4, 'active')`, [auth.id, `LA-DEMO-${String(i + 1).padStart(3, '0')}`, parcels[i].parcel_id, party.id])
      await client.query(
        `INSERT INTO finance.valuation_roll
           (authority_id, parcel_id, property_category_id, rateable_value, currency, effective_from, source, status)
         VALUES ($1, $2, $3, $4, 'USD', $5, 'Demo valuation (not the Council roll)', 'active')`,
        [auth.id, parcels[i].parcel_id, categories[c.cat], c.value, year.start_date])
    }

    // Two months of bills: October (now overdue) and November (current).
    const runs = [
      ['2026-10-01', '2026-10-31', '2026-10-31', 'DEMO-CASH-OCT'],
      ['2026-11-01', '2026-11-30', '2026-11-30', 'DEMO-CASH-NOV'],
    ]
    for (const [from, to, due, ref] of runs) {
      const run = await one(
        // Issued on the first of its month, so October's bill is already past its due date.
        `SELECT finance.raise_rates_billing($1, $2, $3, $2, 'USD', $4, $5, $6, $7, $8, 'Demo billing (not a Council run)') AS id`,
        [year.id, from, to, receivable, revenue, preparer, ref, due])
      // A run bills every property with an account, a value and an approved rate: here, the demo ones.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      const posted = await one('SELECT finance.commit_rates_billing_run($1, $2) AS n', [run.id, poster])
      console.log(`${ref}: ${posted.n} bill(s) posted`)
    }
    await client.query('COMMIT')
    console.log(`Seeded ${CUSTOMERS.length} demo ratepayers with October and November rates bills.`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
