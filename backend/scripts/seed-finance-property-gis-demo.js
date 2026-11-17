#!/usr/bin/env node
/**
 * GIS-integrated finance demonstration: stands allocated in Planning, discovered by Finance, billed
 * and partly paid — on the REAL Hertfordshire stand register, with DEMONSTRATION money.
 *
 *   DATABASE_URL=<local> node scripts/seed-finance-property-gis-demo.js            seed (idempotent)
 *   DATABASE_URL=<local> node scripts/seed-finance-property-gis-demo.js --report   what is there
 *   options: --api http://127.0.0.1:3011 (default; or API_BASE)
 *
 * Needs the stand register locally first: bash scripts/copy-planning-register-to-local.sh
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real (Planning register, copied from live): the stand boundaries, stand numbers, areas, wards and zoning.
 *   Demonstration (this script, every record tagged FINANCE-GIS-DEMO): the offers, the allottees, the
 *   valuations, the bills and the payments. Allottee names are invented. Nothing here is a council record.
 *
 * HOW, AND AS WHOM — every step goes through the application's own API, as the person who does it:
 *   1. demo.planner offers stands and allocates them (POST /stands/:id/offer, /allocate) — Planning's act.
 *      The allocation dates are then set back to May–July 2026, as the revenue seed re-dates its runs.
 *   2. demo.finance-admin runs the Planning integration (POST /finance/property/integration/run), which
 *      opens a customer and a rates account per allocation; one person allocated two stands stays one customer.
 *   3. demo.revenue values each property (demonstration valuation, source says so) and raises monthly rates
 *      runs GIS-2026-08-USD .. GIS-2026-11-USD; demo.finance-admin commits them (preparer is not poster).
 *   4. demo.revenue records payments by habit (prompt, partial, late, never); demo.accountant posts those
 *      before 12 November, so the latest stay awaiting posting.
 *   5. Three more stands are allocated AFTER the integration ran, so the map shows "allocated, no finance
 *      account" and discovery can be demonstrated live.
 *
 * SAFETY: refuses any DATABASE_URL or API host that is not localhost. Never loads .env.
 */
const { Client } = require('pg')
const crypto = require('node:crypto')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is required (the LOCAL database).'); process.exit(1) }
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(DATABASE_URL).hostname)) {
  console.error('Refusing to run: DATABASE_URL is not a local database.'); process.exit(1)
}
const argv = process.argv.slice(2)
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const API = opt('--api', process.env.API_BASE || 'http://127.0.0.1:3011')
if (!['127.0.0.1', 'localhost'].includes(new URL(API).hostname)) { console.error('Refusing a non-local API.'); process.exit(1) }
const TAG = 'FINANCE-GIS-DEMO'
const PASSWORD = 'demo1234'

function rng(seedText) {
  let h = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0)
  return () => {
    h |= 0; h = (h + 0x6D2B79F5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Invented names. Deliberately ordinary; none is a real allottee.
const FIRST = ['Tendai', 'Rudo', 'Tatenda', 'Nyasha', 'Farai', 'Chipo', 'Tafadzwa', 'Kudzai', 'Rutendo', 'Tinashe',
  'Shamiso', 'Takudzwa', 'Ruvimbo', 'Munyaradzi', 'Vimbai', 'Tapiwa', 'Nokuthula', 'Sipho', 'Thandiwe', 'Blessing',
  'Precious', 'Simbarashe', 'Fadzai', 'Kundai', 'Panashe', 'Tariro', 'Mthokozisi', 'Lindiwe', 'Gift', 'Memory']
const LAST = ['Moyo', 'Ncube', 'Dube', 'Sibanda', 'Mpofu', 'Ndlovu', 'Chikore', 'Mutasa', 'Gumbo', 'Marufu',
  'Mlambo', 'Nyathi', 'Zhou', 'Banda', 'Mapfumo', 'Chirwa', 'Mhlanga', 'Shumba', 'Makoni', 'Hove',
  'Moyo', 'Tshuma', 'Mahlangu', 'Khumalo', 'Chiweshe', 'Masuku', 'Madziva', 'Mukarati', 'Chinembiri', 'Nkomo']
const COMPANIES = ['Herts Hardware (Pvt) Ltd', 'Midlands Fresh Produce (Pvt) Ltd', 'Corridor Motors (Pvt) Ltd',
  'Kwekwe Road Pharmacy (Pvt) Ltd', 'Vungu Builders Supplies (Pvt) Ltd', 'Mkoba Logistics (Pvt) Ltd',
  'Senga Fuel Services (Pvt) Ltd', 'Ascot Supermarket (Pvt) Ltd', 'Gweru Office Solutions (Pvt) Ltd',
  'Riverside Clinic (Pvt) Ltd', 'Hertfordshire Bakery (Pvt) Ltd', 'Midlands Agro-Dealers (Pvt) Ltd']

const sessions = {}
async function login(who) {
  if (sessions[who]) return sessions[who]
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `demo.${who}@vungu.test`, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`login ${who} failed: ${res.status} ${await res.text()}`)
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const at = cookies.find((c) => c.startsWith('vungu_at='))
  if (!at) throw new Error(`login ${who}: no vungu_at cookie`)
  await res.arrayBuffer()
  sessions[who] = at.split(';')[0]
  return sessions[who]
}
async function call(who, method, path, body) {
  const headers = { cookie: await login(who) }
  if (body !== undefined) headers['content-type'] = 'application/json'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${API}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = { raw: text } }
    if (res.status === 401 && attempt === 0) { delete sessions[who]; headers.cookie = await login(who); continue }
    if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue }
    if (res.status >= 400) {
      const err = new Error(`${who} ${method} ${path} -> ${res.status} ${json.error || ''}: ${json.message || text.slice(0, 300)}`)
      err.status = res.status; err.body = json
      throw err
    }
    return json.data !== undefined ? json.data : json
  }
  throw new Error(`${who} ${method} ${path}: gave up`)
}

const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

async function main() {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  try {
    if (argv.includes('--report')) {
      console.table(await q(`SELECT financial_status, count(*)::int FROM finance.v_property_finance WHERE parcel_kind = 'stand' GROUP BY 1 ORDER BY 1`))
      console.table(await q(`SELECT status, count(*)::int FROM finance.property_integration_event GROUP BY 1`))
      return
    }
    const herts = await one(`SELECT count(*)::int AS n FROM land.parcel WHERE township_code = 'HERTS' AND parcel_kind = 'stand'`)
    if (!herts.n) throw new Error('no HERTS stands locally; run scripts/copy-planning-register-to-local.sh first')
    const year = await one(`SELECT id FROM finance.financial_year WHERE deleted_at IS NULL AND status = 'open'
                             AND DATE '2026-11-17' BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1`)
    if (!year) throw new Error('no open financial year contains today; run the finance demo seeds first')
    const acc = async (code) => (await one(`SELECT id FROM finance.ledger_account WHERE code = $1 AND deleted_at IS NULL`, [code]))?.id
    const BANK = await acc('GL-1100'); const RECV = await acc('GL-1200'); const REVENUE = await acc('GL-4100')
    const cats = Object.fromEntries((await q(`SELECT code, id FROM finance.property_category WHERE code IN ('REV-RES', 'REV-COM', 'REV-INS') AND deleted_at IS NULL`)).map((r) => [r.code, r.id]))
    if (!BANK || !RECV || !REVENUE || !cats['REV-RES']) throw new Error('run seed-general-ledger-demo.js and seed-finance-revenue-demo.js first')

    // ── 1. Choose stands: every 11th residential stand, every 5th commercial, the institutional one.
    const stands = await q(`
      SELECT f.parcel_id, f.stand_no, f.area_m2::numeric AS area, f.land_use, f.offer_status,
             row_number() OVER (PARTITION BY f.land_use ORDER BY f.stand_no::int) AS rn
        FROM finance.v_property_finance f
       WHERE f.township_code = 'HERTS' AND f.stand_no ~ '^[0-9]+$' AND f.land_use IS NOT NULL
         AND (f.offer_status IS NULL OR f.allocation_id IS NOT NULL)`)
    const chosen = stands.filter((s) => (/Residential/.test(s.land_use) && s.rn % 11 === 3)
      || (/Economic Corridor/.test(s.land_use) && s.rn % 5 === 2) || /Institutional/.test(s.land_use))
    const holdBack = stands.filter((s) => /Residential/.test(s.land_use) && s.rn % 11 === 8).slice(0, 3)
    console.log(`stands chosen: ${chosen.length} (+${holdBack.length} allocated after discovery)`)

    const classOf = (s) => (/Economic Corridor/.test(s.land_use) ? 'COM' : /Institutional/.test(s.land_use) ? 'INS' : 'RES')
    const allottee = (s, i) => {
      const r = rng(`name:${s.parcel_id}`)
      if (classOf(s) === 'COM') return COMPANIES[Math.floor(r() * COMPANIES.length)]
      if (classOf(s) === 'INS') return 'Hertfordshire Community Church Trust'
      // Every 17th allottee repeats an earlier one: a person who bought two stands is one customer.
      if (i > 0 && i % 17 === 0) return allottee(chosen[i - 7], i - 7)
      return `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`
    }

    // ── 2. Planning: offer and allocate, as the planner.
    const allocate = async (s, i) => {
      const r = rng(`price:${s.parcel_id}`)
      const perM2 = classOf(s) === 'COM' ? 38 + Math.floor(r() * 10) : 14 + Math.floor(r() * 6)
      if (!s.offer_status) {
        await call('planner', 'POST', `/stands/${s.parcel_id}/offer`, {
          useScale: classOf(s) === 'COM' ? 'large_scale' : 'small_scale',
          priceUsd: Math.round((Number(s.area) * perM2) / 100) * 100,
          description: `${TAG} — demonstration offer on a real register stand; the price is not a council price.`,
        }).catch((e) => { if (e.status !== 409) throw e })
      }
      const has = await one(`SELECT 1 FROM public.stand_allocation WHERE stand_id = $1 AND deleted_at IS NULL`, [s.parcel_id])
      if (has) return false
      await call('planner', 'POST', `/stands/${s.parcel_id}/allocate`, {
        allotteeName: allottee(s, i),
        purpose: classOf(s) === 'COM' ? 'commercial' : classOf(s) === 'INS' ? 'institutional' : 'residential',
        conditions: `${TAG} — demonstration allocation. The allottee is invented; this is not a council record.`,
      })
      return true
    }
    let made = 0
    for (const [i, s] of chosen.entries()) if (await allocate(s, i)) made += 1
    // Allocation dates as they would be: spread over May to July 2026 (the API stamps today).
    await db.query(`
      UPDATE public.stand_allocation a
         SET allocated_at = TIMESTAMPTZ '2026-05-04 09:00+02' + ((abs(hashtext(a.stand_id)) % 85) || ' days')::interval,
             created_at = TIMESTAMPTZ '2026-05-04 09:00+02' + ((abs(hashtext(a.stand_id)) % 85) || ' days')::interval
       WHERE a.conditions LIKE $1 AND a.allocated_at > TIMESTAMPTZ '2026-11-01'
         AND a.stand_id = ANY($2)`, [`${TAG}%`, chosen.map((s) => s.parcel_id)])
    await db.query(`UPDATE land.stand_offer o SET allocated_at = a.allocated_at FROM public.stand_allocation a
                     WHERE a.stand_id = o.parcel_id AND a.conditions LIKE $1 AND a.status = 'active'`, [`${TAG}%`])
    console.log(`allocated in Planning: ${made}`)

    // ── 3. Finance discovers them.
    const run = await call('finance-admin', 'POST', '/finance/property/integration/run')
    console.log(`integration run: discovered ${run.run.discovered}, opened ${run.run.processed}, duplicates ${run.run.duplicates}, failed ${run.run.failed}`)

    // ── 4. Valuations (demonstration), then monthly billing runs.
    const accounts = await q(`
      SELECT ra.id, ra.account_no, ra.parcel_id, f.area_m2::numeric AS area, f.land_use
        FROM finance.rates_account ra JOIN finance.v_property_finance f ON f.parcel_id = ra.parcel_id
       WHERE ra.status = 'active' AND ra.deleted_at IS NULL AND ra.notes LIKE 'Opened by the Planning integration%'`)
    let valued = 0
    for (const a of accounts) {
      if (await one(`SELECT 1 FROM finance.valuation_roll WHERE parcel_id = $1 AND deleted_at IS NULL`, [a.parcel_id])) continue
      const cls = classOf(a)
      const r = rng(`value:${a.parcel_id}`)
      const perM2 = cls === 'COM' ? 55 + Math.floor(r() * 25) : cls === 'INS' ? 12 : 16 + Math.floor(r() * 8)
      await call('revenue', 'POST', '/finance/rates/valuations', {
        parcel_id: a.parcel_id, property_category_id: cats[`REV-${cls}`],
        rateable_value: `${Math.round((Number(a.area) * perM2) / 500) * 500}.00`, currency: 'USD',
        effective_from: '2026-07-01', source: `${TAG} demonstration valuation — not the General Valuation Roll`,
        source_reference: `GIS-DEMO/${a.parcel_id}`, valuation_date: '2026-06-30', status: 'active',
      })
      valued += 1
    }
    console.log(`valued: ${valued}`)
    for (const ym of MONTHS) {
      const ref = `GIS-${ym}-USD`
      let r = await one(`SELECT id, status FROM finance.rates_billing_run WHERE run_reference = $1 AND deleted_at IS NULL`, [ref])
      if (!r) {
        const m = await call('revenue', 'POST', '/finance/rates/billing/runs', {
          run_reference: ref, financial_year_id: year.id, period_from: `${ym}-01`, period_to: lastDay(ym),
          posting_date: `${ym}-01`, currency: 'USD', receivable_ledger_account_id: RECV, revenue_ledger_account_id: REVENUE,
          due_on: `${ym}-25`, narration: `Rates, ${ym} — newly allocated Hertfordshire stands (${TAG})`,
        }).catch((e) => { if (e.status === 422 || e.status === 409) { console.log(`  ${ref}: ${e.message}`); return null } throw e })
        r = m && (m.run || m)
      }
      if (r && r.id && r.status !== 'committed') {
        await call('finance-admin', 'POST', `/finance/rates/billing/runs/${r.id}/commit`).catch((e) => console.log(`  commit ${ref}: ${e.message}`))
      }
    }

    // ── 5. Payments by habit. The featured stand (the first residential one) pays Aug and Sep only.
    const bills = await q(`
      SELECT rb.id, rb.rates_account_id, ra.account_no, ra.parcel_id, to_char(rb.period_from, 'YYYY-MM') AS ym,
             rb.amount::numeric AS amount, finance.rates_bill_unsettled(rb.id)::numeric AS open
        FROM finance.rates_bill rb JOIN finance.rates_account ra ON ra.id = rb.rates_account_id
        JOIN finance.voucher v ON v.id = rb.voucher_id AND v.status = 'posted'
       WHERE ra.notes LIKE 'Opened by the Planning integration%' AND rb.deleted_at IS NULL
       ORDER BY ra.account_no, rb.period_from`)
    const featured = accounts.filter((a) => classOf(a) === 'RES').sort((x, y) => x.account_no.localeCompare(y.account_no))[0]
    let receipts = 0; let posted = 0
    for (const b of bills) {
      if (Number(b.open) <= 0) continue
      const r = rng(`habit:${b.parcel_id}`)
      const roll = r()
      const habit = featured && b.parcel_id === featured.parcel_id ? 'featured'
        : roll < 0.42 ? 'prompt' : roll < 0.62 ? 'partial' : roll < 0.8 ? 'late' : 'never'
      let amount = 0; let day = 10 + Math.floor(rng(`d:${b.id}`)() * 15)
      if (habit === 'prompt') amount = Number(b.open)
      if (habit === 'featured' && b.ym <= '2026-09') amount = Number(b.open)
      if (habit === 'partial') amount = Math.round(Number(b.open) * 0.5 * 100) / 100
      if (habit === 'late' && b.ym <= '2026-09') { amount = Number(b.open); day = 27 }
      if (amount <= 0) continue
      const date = `${b.ym}-${String(Math.min(day, 28)).padStart(2, '0')}`
      if (date > '2026-11-16') continue
      const receiptNo = `GIS-RR-${b.account_no}-${b.ym.replace('-', '')}`
      if (await one(`SELECT 1 FROM finance.rates_receipt WHERE receipt_no = $1 AND deleted_at IS NULL`, [receiptNo])) continue
      const m = rng(`m:${receiptNo}`)() < 0.65 ? 'mobile_money' : 'cash'
      const rec = await call('revenue', 'POST', '/finance/rates/receipts', {
        receipt_no: receiptNo, rates_account_id: b.rates_account_id, financial_year_id: year.id, amount: amount.toFixed(2),
        currency: 'USD', received_on: date, bank_ledger_account_id: BANK, receivable_ledger_account_id: RECV, method: m,
        reference: m === 'mobile_money' ? `EcoCash MP${date.replace(/-/g, '').slice(2)}.${String(receipts).padStart(4, '0')}` : 'Cash, Vungu office counter',
        narration: `Rates ${b.ym} (${TAG})`, allocations: [{ rates_bill_id: b.id, amount: amount.toFixed(2) }],
      })
      receipts += 1
      if (date < '2026-11-12') { await call('accountant', 'POST', `/finance/rates/receipts/${rec.receipt.id}/post`); posted += 1 }
    }
    console.log(`receipts: ${receipts} (${posted} posted, the rest awaiting the accountant)`)

    // ── 6. Allocated after discovery: the integration gap the map shows.
    let late = 0
    for (const [i, s] of holdBack.entries()) if (await allocate(s, i + 1000)) late += 1
    console.log(`allocated after discovery (not yet in Finance): ${late}`)

    if (featured) {
      const f = await one(`SELECT stand_no, account_no, party_name, usd_balance::text, financial_status FROM finance.v_property_finance WHERE parcel_id = $1`, [featured.parcel_id])
      console.log(`\nFeatured stand for the walkthrough: HERTS stand ${f.stand_no} (${featured.parcel_id}), account ${f.account_no}, ${f.party_name}, balance USD ${f.usd_balance}, ${f.financial_status}`)
    }
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1) })
