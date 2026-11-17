#!/usr/bin/env node
/**
 * Revenue and Rates + Finance Operations demo: a council five months into its year.
 *
 *   DATABASE_URL=postgres://...@127.0.0.1/... node scripts/seed-finance-revenue-demo.js            seed / top up
 *   DATABASE_URL=... node scripts/seed-finance-revenue-demo.js --report                           what is there
 *   DATABASE_URL=... node scripts/seed-finance-revenue-demo.js --clean                            remove it
 *   options: --api http://127.0.0.1:3011 (default; or API_BASE)  --skip-imports
 *
 * WHAT IT CREATES (everything carries the prefix REV-)
 *  Rates roll, through the real API as the right person:
 *   - property categories REV-RES, REV-COM, REV-AGR, REV-SSF, REV-INS, REV-MIN, and two new
 *     categories with no approved rate yet: REV-TEL (telecommunication base stations), REV-TOU (tourism)
 *   - tariffs drafted by demo.revenue; the six in use approved by demo.treasurer against Council
 *     resolution FC/2026/41; the two new levies left as DRAFTS in the Finance Committee's queue
 *   - ~60 ratepayers (finance.party, reference REV-Pnnn) on 60 real Vungu farm-cadastre parcels
 *     (land.parcel VP-*): commercial farms, small-scale (SSCFA) farms billed in ZWG, commercial plots,
 *     residential smallholdings, schools/clinic/mission, mining claims, base stations, a lodge
 *   - a valuation on the roll for each (General Valuation Roll 2025), three supplementary
 *     revaluations from 1 October, four draft valuations awaiting objection hearings
 *   - one property transfer: the old account closed 30 Sep, the new owner's opened 1 Oct
 *  Billing: monthly runs REV-2026-07-USD .. REV-2026-11-USD raised by demo.revenue and committed by
 *   demo.finance-admin (preparer is not poster); ZWG runs Jul–Oct committed, REV-2026-11-ZWG raised
 *   and NOT committed (the run waiting for the Director). The runs bill every billable property,
 *   which includes the five DEMO-CASH ratepayers for July to September (October and November they
 *   already have, and are refused as already billed).
 *  Collections: rates receipts through POST /finance/rates/receipts (demo.revenue) and posted by
 *   demo.accountant, following a payment habit per ratepayer (prompt, late, part-payer, lapsed,
 *   never paid, one overpayment); the latest few left as drafts awaiting posting, one duplicate
 *   capture cancelled. Collection on these accounts runs at about two thirds, so the arrears and
 *   the ageing have every bucket.
 *  Finance Operations imports (finance-imports.js), as demo.finance-officer: a 1–15 November
 *   stores-issues file from Promun validated with exceptions (old economic line 5150, a date in the
 *   previous year, a missing amount, a renamed vote, a duplicated row), two resolved and four left
 *   open, reconciliation mismatched; and a wrong file cancelled. The committed monthly ledger
 *   exports are the budget seed's (BUD-ACT-*); this seed does not load October again. CSVs are
 *   generated in memory (idempotency keys REV-IMP-*).
 *
 * Timestamps: runs and receipts are created today by the API; the script then sets the run's
 * prepared/committed times and the receipt's created time to the business date they stand for,
 * so the registers read like five months of work. Nothing in the ledger is re-dated.
 *
 * --clean removes what this script made. Posted vouchers are deleted with the ledger immutability
 * trigger disabled for that one transaction, exactly as scripts/seed-general-ledger-demo.js does,
 * and only rows identified by the REV- prefix (or created against REV- accounts) are touched.
 *
 * SAFETY: refuses any DATABASE_URL whose host is not 127.0.0.1 / localhost unless the operator
 * opts in with --allow-remote-db (SEED_ALLOW_REMOTE=1) for a managed database they own.
 * Never loads .env.
 */
const { Client } = require('pg')
const crypto = require('node:crypto')
const { allowRemoteDb, allowRemoteApi } = require('./lib/seed-remote')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is required (the LOCAL database).'); process.exit(1) }
allowRemoteDb(DATABASE_URL, { what: 'seed-finance-revenue-demo.js' })
const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const API = opt('--api', process.env.API_BASE || 'http://127.0.0.1:3011')
allowRemoteApi(API, { what: 'seed-finance-revenue-demo.js' })
const P = 'REV'
const TODAY = '2026-11-17'
const PASSWORD = 'demo1234'

// ── Deterministic randomness ──────────────────────────────────────────────────────────────────
function rng(seedText) {
  let h = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0)
  return () => {
    h |= 0; h = (h + 0x6D2B79F5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r, lo, hi, step) => Math.round((lo + r() * (hi - lo)) / step) * step

// ── The roll ──────────────────────────────────────────────────────────────────────────────────
const CATEGORIES = {
  RES: { name: 'Residential smallholdings', description: 'Residential plots and smallholdings on the peri-urban fringe of Gweru.', currency: 'USD', rate: '0.00080000', fixed: '5.00', min: null, values: [18000, 46000, 500] },
  COM: { name: 'Commercial and industrial', description: 'Business centres, service stations, depots, mills and retail on the Gweru–Shurugwi and Lower Gweru roads.', currency: 'USD', rate: '0.00120000', fixed: '20.00', min: null, values: [90000, 560000, 5000] },
  AGR: { name: 'Agricultural — commercial farms', description: 'Large-scale commercial farms and ranches, rated on land value.', currency: 'USD', rate: '0.00040000', fixed: '15.00', min: '40.00', values: [180000, 1450000, 10000] },
  SSF: { name: 'Agricultural — small-scale commercial (A1/SSCFA)', description: 'Small-scale commercial farming areas (Vungu and Silobela SSCFA), billed in ZWG.', currency: 'ZWG', rate: '0.00050000', fixed: '150.00', min: null, values: [320000, 1250000, 10000] },
  INS: { name: 'Institutional', description: 'Schools, clinics, missions and community trusts, at the concessionary rate.', currency: 'USD', rate: '0.00020000', fixed: '5.00', min: null, values: [80000, 320000, 5000] },
  MIN: { name: 'Mining claims and plant', description: 'Registered mining claims and processing plant sited on farms in the district.', currency: 'USD', rate: '0.00250000', fixed: '50.00', min: null, values: [140000, 720000, 10000] },
  TEL: { name: 'Telecommunication base stations', description: 'Mast and base-station sites. New category proposed in the 2026/27 mid-year tariff review.', currency: 'USD', rate: '0.00300000', fixed: '100.00', min: null, values: [60000, 90000, 5000], pending: true },
  TOU: { name: 'Tourism and hospitality', description: 'Lodges and safari operations. New category proposed in the 2026/27 mid-year tariff review.', currency: 'USD', rate: '0.00150000', fixed: '40.00', min: null, values: [260000, 260000, 5000], pending: true },
}

// [category, parcel_id, ratepayer, habit, contact, address hint]
// Habits: prompt | late | partial | lapsed | none | overpay
const ROLL = [
  ['AGR', 'VP-174', 'Mlambo Farming Enterprises (Pvt) Ltd', 'prompt'],
  ['AGR', 'VP-157', 'Ncube, Sipho', 'late'],
  ['AGR', 'VP-167', 'Lucky Retreat Farm Trust', 'partial'],
  ['AGR', 'VP-196', 'Chirwa, Tafadzwa and Rudo', 'none'],
  ['AGR', 'VP-191', 'Willow Run Dairies (Pvt) Ltd', 'prompt'],
  ['AGR', 'VP-181', 'Moyo, Bekithemba', 'lapsed'],
  ['AGR', 'VP-179', 'Gumbo Agro Holdings (Pvt) Ltd', 'prompt'],
  ['AGR', 'VP-186', 'Nyathi, Thandiwe', 'late'],
  ['AGR', 'VP-173', 'Happy Valley Citrus (Pvt) Ltd', 'prompt'],
  ['AGR', 'VP-168', 'Mpofu, Lovemore', 'none'],
  ['AGR', 'VP-165', 'Dube Brothers Farming', 'partial'],
  ['AGR', 'VP-163', "St Patrick's Estate (Pvt) Ltd", 'prompt'],
  ['AGR', 'VP-158', 'Sithole, Nomsa', 'lapsed', { transfer: { name: 'Hazeldene Horticulture (Pvt) Ltd', habit: 'prompt' } }],
  ['AGR', 'VP-152', 'Four Streams Poultry (Pvt) Ltd', 'late'],
  ['AGR', 'VP-150', 'Chikore, Farai', 'lapsed'],
  ['AGR', 'VP-147', 'Ripplemead Seed Co-operative', 'partial'],
  ['AGR', 'VP-129', 'Mukwena, Simbarashe', 'none'],
  ['AGR', 'VP-118', 'Ndlovu, Mandla', 'late'],
  ['AGR', 'VP-111', 'Dunlop Ranching (Pvt) Ltd', 'prompt'],
  ['AGR', 'VP-16', 'Staines Estate Tobacco (Pvt) Ltd', 'prompt'],
  ['MIN', 'VP-159', 'Granite Ridge Mining Syndicate', 'prompt'],
  ['MIN', 'VP-171', 'Randfontein Gold Claims (Pvt) Ltd', 'prompt'],
  ['MIN', 'VP-112', 'Dispute Reef Mining Co-operative', 'late'],
  ['MIN', 'VP-117', 'Colorado Chrome Claims (Pvt) Ltd', 'prompt'],
  ['SSF', 'VP-540', 'Khumalo, Jabulani', 'prompt'],
  ['SSF', 'VP-539', 'Mhlanga, Precious', 'late'],
  ['SSF', 'VP-537', 'Zhou, Tinashe', 'partial'],
  ['SSF', 'VP-534', 'Sibanda, Nkosana', 'none'],
  ['SSF', 'VP-533', 'Hlabangana, Ruth', 'prompt'],
  ['SSF', 'VP-532', 'Makoni, Edson', 'lapsed'],
  ['SSF', 'VP-531', 'Tshuma, Sikhumbuzo', 'late'],
  ['SSF', 'VP-530', 'Marufu, Grace', 'prompt'],
  ['SSF', 'VP-521', 'Ndebele, Themba', 'none'],
  ['SSF', 'VP-517', 'Chinembiri, Joseph', 'partial'],
  ['COM', 'VP-676', 'Indiva Siding Grain Depot (Pvt) Ltd', 'prompt'],
  ['COM', 'VP-652', "Raja's Grant Motel and Bottle Store", 'late'],
  ['COM', 'VP-588', 'Guineafowl Business Centre (Pvt) Ltd', 'prompt'],
  ['COM', 'VP-639', 'Vungu Agro-Dealers (Pvt) Ltd', 'overpay'],
  ['COM', 'VP-638', 'Lower Gweru Service Station (Pvt) Ltd', 'prompt'],
  ['COM', 'VP-637', 'Mkoba Road Hardware (Pvt) Ltd', 'partial'],
  ['COM', 'VP-636', 'Senga Milling Company', 'prompt'],
  ['COM', 'VP-635', 'Shurugwi Road Truck Stop', 'lapsed'],
  ['COM', 'VP-634', 'Nehosho Butchery and General Dealer', 'late'],
  ['COM', 'VP-633', 'Maboleni Building Supplies', 'none'],
  ['RES', 'VP-632', 'Mutasa, Chipo', 'prompt'],
  ['RES', 'VP-631', 'Banda, Kelvin', 'partial'],
  ['RES', 'VP-629', 'Phiri, Memory', 'prompt'],
  ['RES', 'VP-628', 'Gwatidzo, Rumbidzai', 'none'],
  ['RES', 'VP-627', 'Ziyambi, Tapiwa', 'lapsed'],
  ['RES', 'VP-626', 'Mapuranga, Ellen', 'prompt'],
  ['RES', 'VP-623', 'Chuma, Blessing', 'partial'],
  ['RES', 'VP-622', 'Tembo, Nyasha', 'none'],
  ['INS', 'VP-617', 'Vungu Secondary School (SDC)', 'late'],
  ['INS', 'VP-616', 'Maboleni Rural Health Centre', 'prompt'],
  ['INS', 'VP-613', 'Lutheran Mission, Lower Gweru', 'none'],
  ['INS', 'VP-612', 'Zvamabande Primary School (SDC)', 'late'],
  ['INS', 'VP-605', 'Vungu Community Hall Trust', 'none'],
  ['TEL', 'VP-621', 'Ecomesh Towers (Pvt) Ltd', 'none'],
  ['TEL', 'VP-620', 'Ecomesh Towers (Pvt) Ltd', 'none'],
  ['TOU', 'VP-653', 'Ngamo Safari Lodge (Pvt) Ltd', 'none'],
  ['MIN', 'VP-153', 'Steinbok Gold Mine (Pvt) Ltd', 'prompt', { value: '660000.00' }],
  ['MIN', 'VP-155', 'Granlaigh Chrome Claims (Pvt) Ltd', 'prompt', { value: '710000.00' }],
  ['COM', 'VP-36', 'Somabula Agro-Industrial Park (Pvt) Ltd', 'prompt', { value: '880000.00' }],
  ['SSF', 'VP-499', 'Mavhunga, Shingirai', 'prompt'],
  ['SSF', 'VP-498', 'Nkomo, Sithembiso', 'prompt'],
]
// Supplementary revaluations from 1 October: [parcel, factor, reason]
const REVALUE = [
  ['VP-676', 1.35, 'New 5,000-tonne silo complex completed (building plan BP/2026/118).'],
  ['VP-171', 1.25, 'Carbon-in-leach plant commissioned on the claims.'],
  ['VP-191', 0.85, 'Value reduced on objection upheld by the Valuation Board, 18 Sep 2026.'],
]
// Draft valuations awaiting objection hearings, no account yet: [parcel, category, value]
const DRAFT_VALUES = [
  ['VP-514', 'SSF', '540000.00'], ['VP-510', 'SSF', '610000.00'],
  ['VP-625', 'COM', '185000.00'], ['VP-619', 'RES', '27500.00'],
]
const MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
const MONTH_NAME = { '07': 'July', '08': 'August', '09': 'September', '10': 'October', '11': 'November' }
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const RESOLUTION = 'Full Council Resolution FC/2026/41 (2026/27 budget and tariffs)'

const INDIVIDUAL = (name) => /, /.test(name) && !/\(Pvt\)|Ltd/.test(name)

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────
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
async function call(who, method, path, body, { form } = {}) {
  const cookie = await login(who)
  const headers = { cookie }
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${API}/api${path}`, { method, headers, body: payload })
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

// ── main ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  try {
    if (flag('--report')) return await report(q)
    if (flag('--clean') || flag('--undo')) return await clean(db, q)

    const year = await one(`SELECT id, label, start_date::text AS start_date FROM finance.financial_year
                             WHERE deleted_at IS NULL AND status = 'open' AND DATE '${TODAY}' BETWEEN start_date AND end_date
                             ORDER BY start_date DESC LIMIT 1`)
    if (!year) throw new Error('no open financial year contains today; run seed-finance-director-demo.js first')
    const acc = async (code) => (await one(`SELECT id FROM finance.ledger_account WHERE code = $1 AND deleted_at IS NULL`, [code]))?.id
    const BANK = await acc('GL-1100'); const RECV = await acc('GL-1200'); const REVENUE = await acc('GL-4100')
    if (!BANK || !RECV || !REVENUE) throw new Error('need GL-1100, GL-1200 and GL-4100; run seed-general-ledger-demo.js first')
    const users = Object.fromEntries((await q(`SELECT split_part(email, '@', 1) AS e, id FROM public.users WHERE email LIKE 'demo.%@vungu.test'`)).map((u) => [u.e.replace('demo.', ''), u.id]))

    // ── 1. Categories ──
    const cats = Object.fromEntries((await q(`SELECT code, id FROM finance.property_category WHERE code LIKE 'REV-%' AND deleted_at IS NULL`)).map((r) => [r.code, r.id]))
    for (const [key, c] of Object.entries(CATEGORIES)) {
      const code = `${P}-${key}`
      if (cats[code]) continue
      const made = await call('revenue', 'POST', '/finance/rates/categories', { code, name: c.name, description: c.description })
      cats[code] = made.id
    }
    console.log(`categories: ${Object.keys(cats).length}`)

    // ── 2. Tariffs ──
    for (const [key, c] of Object.entries(CATEGORIES)) {
      const catId = cats[`${P}-${key}`]
      const existing = await q(`SELECT id, status FROM finance.rates_tariff WHERE property_category_id = $1 AND financial_year_id = $2 AND currency = $3 AND deleted_at IS NULL`, [catId, year.id, c.currency])
      let t = existing[0]
      if (!t) {
        t = await call('revenue', 'POST', '/finance/rates/tariffs', {
          financial_year_id: year.id, property_category_id: catId, currency: c.currency,
          rate_in_dollar: c.rate, fixed_charge: c.fixed, minimum_charge: c.min, revenue_ledger_account_id: REVENUE,
          ...(c.pending
            ? { notes: 'Proposed in the mid-year tariff review; tabled for the Finance Committee meeting of 24 November 2026. Charged monthly on the rateable value.' }
            : { resolution_reference: RESOLUTION, resolution_date: '2026-06-24', notes: 'Monthly charge: rate in the dollar on the rateable value plus the fixed charge.' }),
        })
      }
      if (!c.pending && t.status === 'draft') {
        await call('treasurer', 'POST', `/finance/rates/tariffs/${t.id}/approve`, { resolution_reference: RESOLUTION, resolution_date: '2026-06-24' })
      }
    }
    console.log('tariffs: approved six in use, two new levies left in the committee queue')

    // ── 3. Parties, valuations, accounts ──
    const parcelOk = new Set((await q(`SELECT parcel_id FROM land.parcel WHERE status = 'current' AND parcel_id = ANY($1)`, [ROLL.map((r) => r[1])])).map((r) => r.parcel_id))
    const partyByName = Object.fromEntries((await q(`SELECT name, id FROM finance.party WHERE reference LIKE 'REV-P%' AND deleted_at IS NULL`)).map((r) => [r.name, r.id]))
    let partySeq = (await one(`SELECT COALESCE(max(substring(reference from 6)::int), 0) AS n FROM finance.party WHERE reference ~ '^REV-P[0-9]+$'`)).n
    const ensureParty = async (name, idx) => {
      if (partyByName[name]) return partyByName[name]
      partySeq += 1
      const r = rng(`party:${name}`)
      const indiv = INDIVIDUAL(name)
      const phone = `+263 7${[1, 3, 7, 8][Math.floor(r() * 4)]} ${String(between(r, 100, 999, 1))} ${String(between(r, 1000, 9999, 1))}`
      const slug = name.toLowerCase().replace(/\(pvt\) ltd|[^a-z]+/g, ' ').trim().split(/\s+/).slice(0, 2).join('')
      const made = await call('revenue', 'POST', '/finance/ledger/parties', {
        party_type: 'ratepayer', name, reference: `${P}-P${String(partySeq).padStart(3, '0')}`,
        contact_phone: phone,
        ...(indiv ? {} : { contact_email: `accounts@${slug}.co.zw`, contact_name: ['T. Moyo', 'R. Dube', 'S. Ncube', 'F. Chikore', 'L. Mpofu'][idx % 5] }),
        address_text: idx.address,
      })
      partyByName[name] = made.id
      return made.id
    }
    const parcels = Object.fromEntries((await q(`SELECT parcel_id, stand_no, round(area_m2/10000, 1)::text AS ha FROM land.parcel WHERE parcel_id = ANY($1)`, [ROLL.map((r) => r[1]).concat(DRAFT_VALUES.map((d) => d[0]))])).map((p) => [p.parcel_id, p]))
    const addressOf = (cat, parcel) => {
      const s = parcel.stand_no
      if (cat === 'SSF') return `Farm ${parcel.parcel_id.slice(3)}, ${s}, Vungu`
      if (/^Parcel /.test(s)) return `${s}, Gweru–Shurugwi Road, Vungu`
      return `${s} Farm, ${['Lower Gweru', 'Vungu', 'Maboleni', 'Nyama', 'Gweru'][parseInt(parcel.parcel_id.slice(3), 10) % 5]}`
    }

    const accounts = []   // { id, account_no, parcel, cat, habit, opened, closed }
    let created = { parties: 0, accounts: 0, valuations: 0 }
    for (const [i, row] of ROLL.entries()) {
      const [cat, parcelId, name, habit, extra] = row
      if (!parcelOk.has(parcelId)) { console.warn(`  parcel ${parcelId} missing; skipped`); continue }
      const parcel = parcels[parcelId]
      const c = CATEGORIES[cat]
      const accountNo = `${P}-${String(10001 + i)}`
      // party
      const before = Object.keys(partyByName).length
      const partyId = await ensureParty(name, Object.assign(i, { address: addressOf(cat, parcel) }))
      if (Object.keys(partyByName).length > before) created.parties += 1
      // valuation (General Valuation Roll 2025, in force from the start of the year)
      const val = await one(`SELECT id FROM finance.valuation_roll WHERE parcel_id = $1 AND source_reference = $2 AND deleted_at IS NULL`, [parcelId, `GVR-2025/${parcelId}`])
      if (!val) {
        const r = rng(`value:${parcelId}`)
        const [lo, hi, step] = c.values
        await call('revenue', 'POST', '/finance/rates/valuations', {
          parcel_id: parcelId, property_category_id: cats[`${P}-${cat}`], rateable_value: extra?.value || `${between(r, lo, hi, step)}.00`,
          currency: c.currency, effective_from: '2026-07-01', source: 'Vungu RDC General Valuation Roll 2025',
          source_reference: `GVR-2025/${parcelId}`, valuation_date: '2025-03-31', valuer_name: 'Zvobgo & Partners, Registered Valuers',
          status: 'active',
        })
        created.valuations += 1
      }
      // account
      let a = await one(`SELECT id, status FROM finance.rates_account WHERE account_no = $1 AND deleted_at IS NULL`, [accountNo])
      if (!a) {
        a = await call('revenue', 'POST', '/finance/rates/accounts', {
          account_no: accountNo, parcel_id: parcelId, party_id: partyId, opened_on: '2026-07-01',
          erp_account_no: `PRM/${cat}/${String(400 + i * 7).padStart(5, '0')}`,
          notes: `Migrated from the Promun debtors ledger. ${parcel.ha} ha.`,
        })
        created.accounts += 1
      }
      accounts.push({ id: a.id, account_no: accountNo, parcelId, cat, habit, name, from: '2026-07', to: extra?.transfer ? '2026-09' : null })
      if (extra?.transfer) accounts[accounts.length - 1].transfer = { ...extra.transfer, i }
    }
    console.log(`roll: +${created.parties} parties, +${created.valuations} valuations, +${created.accounts} accounts (${accounts.length} in plan)`)

    // Draft valuations awaiting objection hearings.
    for (const [parcelId, cat, value] of DRAFT_VALUES) {
      const ref = `GVR-2025/OBJ/${parcelId}`
      if (await one(`SELECT 1 FROM finance.valuation_roll WHERE source_reference = $1 AND deleted_at IS NULL`, [ref])) continue
      await call('revenue', 'POST', '/finance/rates/valuations', {
        parcel_id: parcelId, property_category_id: cats[`${P}-${cat}`], rateable_value: value,
        currency: CATEGORIES[cat].currency, effective_from: '2026-07-01', source: 'Vungu RDC General Valuation Roll 2025 — objection pending',
        source_reference: ref, valuer_name: 'Zvobgo & Partners, Registered Valuers', status: 'draft',
        notes: 'Owner lodged an objection; to be heard by the Valuation Board on 2 December 2026. No account until the ratepayer of record is confirmed.',
      })
    }

    // ── 4. Billing, month by month ──
    const runRef = (ym, ccy) => `${P}-${ym}-${ccy}`
    for (const ym of MONTHS) {
      if (ym === '2026-10') await octoberChanges()
      for (const ccy of ['USD', 'ZWG']) {
        const ref = runRef(ym, ccy)
        let run = await one(`SELECT id, status FROM finance.rates_billing_run WHERE run_reference = $1 AND deleted_at IS NULL`, [ref])
        if (!run) {
          const made = await call('revenue', 'POST', '/finance/rates/billing/runs', {
            run_reference: ref, financial_year_id: year.id, period_from: `${ym}-01`, period_to: lastDay(ym),
            posting_date: `${ym}-01`, currency: ccy, receivable_ledger_account_id: RECV, revenue_ledger_account_id: REVENUE,
            due_on: lastDay(ym), narration: `Rates, ${MONTH_NAME[ym.slice(5)]} ${ym.slice(0, 4)}${ccy === 'ZWG' ? ' (ZWG)' : ''}`,
          })
          run = made.run
          console.log(`  ${ref}: raised ${run.bills_raised} bills (${run.total_billed} ${ccy}), ${run.properties_refused} refused`)
        }
        const leaveRaised = ym === '2026-11' && ccy === 'ZWG'
        if (run.status === 'raised' && !leaveRaised) {
          const done = await call('finance-admin', 'POST', `/finance/rates/billing/runs/${run.id}/commit`)
          console.log(`  ${ref}: committed, ${done.bills_posted} posted`)
        }
        // Business dates: raised in the last week of the month before, committed on the 1st.
        const prev = new Date(`${ym}-01T00:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 4)
        await db.query(
          `UPDATE finance.rates_billing_run SET prepared_at = $2::date + time '09:40', created_at = $2::date + time '09:40',
                  committed_at = CASE WHEN status = 'committed' THEN $3::date + time '11:15' END
            WHERE run_reference = $1`,
          [ref, leaveRaised ? '2026-11-14' : prev.toISOString().slice(0, 10), `${ym}-01`])
      }
    }

    async function octoberChanges() {
      // Supplementary revaluations, in force from 1 October.
      for (const [parcelId, factor, reason] of REVALUE) {
        const ref = `SVR-2026-01/${parcelId}`
        if (await one(`SELECT 1 FROM finance.valuation_roll WHERE source_reference = $1 AND deleted_at IS NULL`, [ref])) continue
        const old = await one(`SELECT id, rateable_value::numeric AS v, currency, property_category_id FROM finance.valuation_roll
                                WHERE parcel_id = $1 AND source_reference = $2 AND deleted_at IS NULL`, [parcelId, `GVR-2025/${parcelId}`])
        if (!old) continue
        await call('revenue', 'PATCH', `/finance/rates/valuations/${old.id}`, { effective_to: '2026-09-30', notes: `Replaced by supplementary valuation ${ref}.` })
        await call('revenue', 'POST', '/finance/rates/valuations', {
          parcel_id: parcelId, property_category_id: old.property_category_id,
          rateable_value: `${Math.round((Number(old.v) * factor) / 1000) * 1000}.00`, currency: old.currency,
          effective_from: '2026-10-01', source: 'Supplementary Valuation Roll No. 1 of 2026/27', source_reference: ref,
          valuation_date: '2026-09-15', valuer_name: 'Zvobgo & Partners, Registered Valuers', status: 'active', notes: reason,
        })
      }
      // A transfer of ownership: the old account closes on 30 September, the buyer's opens on 1 October.
      for (const a of accounts.filter((x) => x.transfer)) {
        const cur = await one(`SELECT status FROM finance.rates_account WHERE id = $1`, [a.id])
        if (cur.status === 'active') {
          await call('revenue', 'PATCH', `/finance/rates/accounts/${a.id}`, { status: 'closed', closed_on: '2026-09-30', notes: `Property transferred to ${a.transfer.name} (Deed of Transfer 2214/2026). Arrears remain recoverable from the seller.` })
        }
        const newNo = `${P}-10100`
        let n = await one(`SELECT id FROM finance.rates_account WHERE account_no = $1 AND deleted_at IS NULL`, [newNo])
        if (!n) {
          const partyId = await ensureParty(a.transfer.name, Object.assign(a.transfer.i + 100, { address: 'Hazeldene Farm, Lower Gweru' }))
          n = await call('revenue', 'POST', '/finance/rates/accounts', {
            account_no: newNo, parcel_id: a.parcelId, party_id: partyId, opened_on: '2026-10-01',
            notes: 'Opened on transfer from Sithole, N. (Deed of Transfer 2214/2026). Rates clearance issued against the seller\'s account.',
          })
        }
        if (!accounts.some((x) => x.account_no === newNo)) accounts.push({ id: n.id, account_no: newNo, parcelId: a.parcelId, cat: a.cat, habit: a.transfer.habit, name: a.transfer.name, from: '2026-10', to: null })
      }
    }
    // When October ran in an earlier invocation, still record the new account in the plan.
    if (!accounts.some((x) => x.from === '2026-10')) await octoberChanges()

    // ── 5. Receipts ──
    const bills = await q(
      `SELECT rb.id, rb.bill_no, rb.rates_account_id, rb.currency, rb.amount::numeric AS amount,
              to_char(rb.period_from, 'YYYY-MM') AS ym, v.status
         FROM finance.rates_bill rb JOIN finance.voucher v ON v.id = rb.voucher_id
         JOIN finance.rates_account ra ON ra.id = rb.rates_account_id
        WHERE ra.account_no LIKE 'REV-%' AND rb.deleted_at IS NULL`)
    const billOf = (accountId, ym) => bills.find((b) => b.rates_account_id === accountId && b.ym === ym && b.status === 'posted')
    const plan = []
    for (const a of accounts) {
      const r = rng(`pay:${a.account_no}`)
      const corporate = !INDIVIDUAL(a.name)
      for (const ym of MONTHS) {
        const b = billOf(a.id, ym)
        if (!b) continue
        const amt = Number(b.amount)
        const day = (lo, hi) => String(Math.floor(lo + r() * (hi - lo + 1))).padStart(2, '0')
        const next = (m) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7) }
        const push = (date, amount, extraUnallocated = 0) => { if (date <= '2026-11-16') plan.push({ a, b, date, amount, extraUnallocated, corporate }) }
        switch (a.habit) {
          case 'prompt': push(`${ym}-${day(8, 26)}`, amt); break
          case 'overpay': push(`${ym}-${day(8, 20)}`, amt, ym === '2026-11' ? 500 : 0); break
          case 'late': if (ym !== '2026-11') push(`${next(ym)}-${day(3, 16)}`, amt); break
          case 'partial': if (ym !== '2026-11') push(`${ym}-${day(14, 28)}`, Math.round(amt * (0.45 + r() * 0.2) * 100) / 100); break
          case 'lapsed': if (ym <= '2026-08') push(`${ym}-${day(10, 25)}`, amt); break
          default: break
        }
      }
    }
    plan.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.a.account_no < y.a.account_no ? -1 : 1))
    const draftFrom = '2026-11-12' // the latest receipts wait for the accountant to post them
    let recorded = 0; let posted = 0; let seq = 0
    for (const p of plan) {
      seq += 1
      const receiptNo = `${P}-RR-${p.a.account_no.slice(4)}-${p.b.ym.replace('-', '').slice(2)}`
      let rec = await one(`SELECT rc.id, v.status FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id WHERE rc.receipt_no = $1 AND rc.deleted_at IS NULL`, [receiptNo])
      if (!rec) {
        const r = rng(`m:${receiptNo}`)
        const method = p.corporate ? (r() < 0.8 ? 'bank_transfer' : 'cheque') : (r() < 0.7 ? 'mobile_money' : 'cash')
        const ref = method === 'bank_transfer' ? `RTGS ${['CBZ', 'FBC', 'Stanbic', 'NMB', 'ZB'][Math.floor(r() * 5)]} ${p.date.replace(/-/g, '').slice(2)}${between(r, 1000, 9999, 1)}`
          : method === 'mobile_money' ? `EcoCash MP${p.date.replace(/-/g, '').slice(2)}.${between(r, 1000, 2359, 1)}.R${between(r, 10000, 99999, 1)}`
            : method === 'cheque' ? `Chq ${between(r, 100000, 999999, 1)}` : `Cash, Vungu office counter`
        const total = (p.amount + p.extraUnallocated).toFixed(2)
        const made = await call('revenue', 'POST', '/finance/rates/receipts', {
          receipt_no: receiptNo, rates_account_id: p.a.id, financial_year_id: year.id, amount: total, currency: p.b.currency,
          received_on: p.date, bank_ledger_account_id: BANK, receivable_ledger_account_id: RECV, method, reference: ref,
          narration: `Rates, ${MONTH_NAME[p.b.ym.slice(5)]} ${p.b.ym.slice(0, 4)}${p.extraUnallocated ? ' and advance payment' : ''}`,
          allocations: [{ rates_bill_id: p.b.id, amount: p.amount.toFixed(2) }],
        })
        rec = { id: made.receipt.id, status: 'draft' }
        recorded += 1
      }
      if (rec.status === 'draft' && p.date < draftFrom) {
        await call('accountant', 'POST', `/finance/rates/receipts/${rec.id}/post`)
        posted += 1
      }
      await db.query(`UPDATE finance.rates_receipt SET created_at = $2::date + time '10:00' + ($3 || ' minutes')::interval WHERE id = $1`, [rec.id, p.date, String(seq % 400)])
    }
    // A duplicate capture, cancelled with its reason.
    const dupNo = `${P}-RR-DUP-0001`
    if (!(await one(`SELECT 1 FROM finance.rates_receipt WHERE receipt_no = $1`, [dupNo]))) {
      const target = plan.find((p) => !p.corporate && p.date >= '2026-11-01' && p.date < draftFrom)
      if (target) {
        const made = await call('revenue', 'POST', '/finance/rates/receipts', {
          receipt_no: dupNo, rates_account_id: target.a.id, financial_year_id: year.id, amount: target.amount.toFixed(2), currency: target.b.currency,
          received_on: target.date, bank_ledger_account_id: BANK, receivable_ledger_account_id: RECV, method: 'mobile_money',
          reference: 'EcoCash (captured twice)', narration: 'Rates', allocations: [],
        })
        await call('revenue', 'POST', `/finance/rates/receipts/${made.receipt.id}/cancel`, { reason: 'Duplicate capture of the same EcoCash payment; the original receipt stands.' })
      }
    }
    console.log(`receipts: ${plan.length} planned, +${recorded} recorded, +${posted} posted`)

    if (!flag('--skip-imports')) await imports(year, q, one)
    await report(q)
  } finally {
    await db.end()
  }
}

// ── Finance Operations: imports ───────────────────────────────────────────────────────────────
function csv(rows) { return rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n') + '\r\n' }

async function imports(year, q, one) {
  const HEAD = ['Transaction ID', 'Date', 'Vote', 'Economic Line', 'Description', 'Supplier', 'Voucher No', 'Amount', 'Currency']
  const r = rng('imports')
  // Stores issues charged to votes: what the Promun inventory module sends to the ledger.
  const lines = [
    ['DD-ENG', 'DD-5100', 'Stores issue: diesel for grader, Shurugwi road', 'Main stores, Vungu', [380, 1450]],
    ['DD-ENG', 'DD-5100', 'Stores issue: culvert pipes 600mm, Nyama ward road', 'Main stores, Vungu', [620, 2100]],
    ['DD-HLT', 'DD-5300', 'Stores issue: drugs and sundries, Maboleni RHC', 'Pharmacy store', [240, 980]],
    ['DD-HLT', 'DD-5300', 'Stores issue: dressings and gloves, Vungu clinic', 'Pharmacy store', [90, 360]],
    ['DD-ENG', 'DD-7200', 'Stores issue: borehole casing, Lower Gweru', 'Main stores, Vungu', [450, 1600]],
    ['DD-ENG', 'DD-5100', 'Stores issue: lubricants and filters, TLB', 'Workshop store', [120, 540]],
  ]
  const build = (month, n, startId) => {
    const out = []
    for (let i = 0; i < n; i += 1) {
      const [vote, line, desc, supplier, [lo, hi]] = lines[Math.floor(r() * lines.length)]
      const day = String(1 + Math.floor(r() * (month === '2026-10' ? 31 : 15))).padStart(2, '0')
      const amt = (lo + r() * (hi - lo)).toFixed(2)
      out.push([`PRM-${month.replace('-', '')}-${String(startId + i).padStart(5, '0')}`, `${day}/${month.slice(5)}/${month.slice(0, 4)}`, vote, line, desc, supplier, `PV${String(8800 + startId + i)}`, amt, 'USD'])
    }
    return out
  }
  const upload = async (key, filename, rows, declared) => {
    const existing = await one(`SELECT id, status FROM finance.import_batch WHERE idempotency_key = $1 AND deleted_at IS NULL`, [key])
    if (existing) return { batch: existing, existed: true }
    const content = csv([HEAD, ...rows])
    const form = new FormData()
    form.append('dataset', 'actuals')
    form.append('financial_year_id', year.id)
    form.append('idempotency_key', key)
    if (declared) {
      form.append('declared_control_count', String(declared.count))
      form.append('declared_control_total', declared.total)
      form.append('declared_control_currency', 'USD')
    }
    form.append('file', new Blob([content], { type: 'text/csv' }), filename)
    const made = await call('finance-officer', 'POST', '/finance/imports', undefined, { form })
    return { batch: made.batch, existed: false }
  }
  const sum = (rows) => rows.reduce((s, x) => s + Math.round(Number(x[7]) * 100), 0)

  // The monthly Promun ledger exports (BUD-ACT-*) are loaded and committed by the budget seed; a
  // second October file here would count October twice. This seed adds the officer's open work:
  // a stores-issues interface file with exceptions, and a wrong file that was cancelled.
  void build
  // 1–15 November stores issues: validated with exceptions, two resolved, four open. The control
  // total was declared from the stores ledger and does not match, so it cannot be committed
  // without an explained override.
  const nov = build('2026-11', 24, 101)
  nov[3][3] = '5150'                     // an old Promun economic line not in the new chart
  nov[9][3] = '5150'
  nov[6][1] = '28/06/2026'               // last year's accrual swept into this export
  nov[12][7] = ''                         // amount missing
  nov[15][2] = 'DD-WKS'                   // a vote code renamed in the new structure
  nov[19] = [...nov[18]]                  // the same line exported twice
  const declaredNov = { count: 24, total: (sum(nov.filter((x) => x[7] !== '')) / 100).toFixed(2) }
  const b2 = await upload(`${P}-IMP-2026-11-STORES`, 'Promun_stores_issues_1-15_November_2026.csv', nov, declaredNov)
  if (['uploaded', 'mapped'].includes(b2.batch.status)) await call('finance-officer', 'POST', `/finance/imports/${b2.batch.id}/validate`, { date_order: 'day_first' })
  const open = await q(`SELECT id, error_code, row_number FROM finance.import_exception WHERE batch_id = $1 AND resolved_at IS NULL ORDER BY row_number`, [b2.batch.id])
  const resolvedAlready = await one(`SELECT count(*)::int AS n FROM finance.import_exception WHERE batch_id = $1 AND resolved_at IS NOT NULL`, [b2.batch.id])
  if (resolvedAlready.n === 0) {
    for (const e of open) {
      if (e.error_code === 'DUPLICATE_WITHIN_FILE') {
        await call('finance-officer', 'PATCH', `/finance/imports/${b2.batch.id}/exceptions/${e.id}`, { resolution: 'row_excluded', note: 'Exported twice by Promun (same voucher PV number). The first row stands.' })
      } else if (e.error_code === 'DATE_OUTSIDE_FINANCIAL_YEAR') {
        await call('finance-officer', 'PATCH', `/finance/imports/${b2.batch.id}/exceptions/${e.id}`, { resolution: 'row_excluded', note: '2025/26 accrual; already in last year\'s closing journals. Excluded from this import.' })
      }
    }
  }

  // 3. A wrong file, cancelled.
  const b3 = await upload(`${P}-IMP-2026-11-WRONGFILE`, 'Promun_creditors_age_analysis_Nov_2026.csv', build('2026-11', 6, 201), null)
  if (!['cancelled', 'committed'].includes(b3.batch.status)) {
    await call('finance-officer', 'POST', `/finance/imports/${b3.batch.id}/cancel`, { reason: 'Wrong export: this is the creditors age analysis, not the GL transactions.' })
  }
  const st = await q(`SELECT original_filename, status, rows_total, rows_valid, rows_rejected, reconciliation_status,
                             (SELECT count(*) FROM finance.import_exception e WHERE e.batch_id = b.id AND e.resolved_at IS NULL)::int AS open_exceptions
                        FROM finance.import_batch b WHERE idempotency_key LIKE 'REV-IMP-%' ORDER BY uploaded_at`)
  console.table(st)
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────
async function report(q) {
  console.log('\nREV demo — rates')
  console.table(await q(`SELECT pc.code, t.currency, t.rate_in_dollar::text AS rate, t.fixed_charge::text AS fixed, t.status,
                                (SELECT count(*) FROM finance.valuation_roll v WHERE v.property_category_id = pc.id AND v.deleted_at IS NULL AND v.status = 'active')::int AS valuations
                           FROM finance.property_category pc LEFT JOIN finance.rates_tariff t ON t.property_category_id = pc.id AND t.deleted_at IS NULL
                          WHERE pc.code LIKE 'REV-%' ORDER BY pc.code`))
  console.table(await q(`SELECT r.run_reference, r.status, r.bills_raised, r.properties_refused,
                                (SELECT sum(amount) FROM finance.rates_bill b WHERE b.billing_run_id = r.id)::numeric(18,2)::text AS billed
                           FROM finance.rates_billing_run r WHERE r.run_reference LIKE 'REV-%' ORDER BY r.run_reference`))
  console.table(await q(`SELECT rc.currency, v.status, count(*)::int AS receipts, sum(rc.amount)::numeric(18,2)::text AS amount
                           FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
                          WHERE rc.receipt_no LIKE 'REV-%' GROUP BY 1, 2 ORDER BY 1, 2`))
  console.table(await q(`SELECT b.currency, sum(b.amount)::numeric(18,2)::text AS billed_posted,
                                (SELECT sum(rc.amount) FROM finance.rates_receipt rc JOIN finance.rates_account ra2 ON ra2.id = rc.rates_account_id
                                  WHERE ra2.account_no LIKE 'REV-%' AND rc.deleted_at IS NULL AND rc.currency = b.currency)::numeric(18,2)::text AS received,
                                round(100 * (SELECT sum(rc.amount) FROM finance.rates_receipt rc JOIN finance.rates_account ra2 ON ra2.id = rc.rates_account_id
                                  WHERE ra2.account_no LIKE 'REV-%' AND rc.deleted_at IS NULL AND rc.currency = b.currency) / sum(b.amount), 1)::text AS pct
                           FROM finance.rates_bill b JOIN finance.voucher v ON v.id = b.voucher_id AND v.status = 'posted'
                           JOIN finance.rates_account ra ON ra.id = b.rates_account_id WHERE ra.account_no LIKE 'REV-%' GROUP BY 1`))
  console.table(await q(`SELECT a.currency, a.ageing_bucket, count(*)::int AS items, sum(a.outstanding_amount)::numeric(18,2)::text AS outstanding
                           FROM finance.v_rates_arrears a WHERE a.account_no LIKE 'REV-%' GROUP BY 1, 2 ORDER BY 1, 2`))
}

// ── Clean ─────────────────────────────────────────────────────────────────────────────────────
async function clean(db, q) {
  console.log('Removing REV- demo data. finance.ledger_entry is immutable; its trigger is DISABLED for this one transaction and re-enabled before commit.')
  await db.query('BEGIN')
  try {
    await db.query(`CREATE TEMP TABLE rev_v ON COMMIT DROP AS
      SELECT voucher_id AS id FROM finance.rates_bill WHERE billing_run_id IN (SELECT id FROM finance.rates_billing_run WHERE run_reference LIKE 'REV-%')
      UNION SELECT rc.voucher_id FROM finance.rates_receipt rc JOIN finance.rates_account ra ON ra.id = rc.rates_account_id WHERE ra.account_no LIKE 'REV-%'`)
    await db.query('ALTER TABLE finance.ledger_entry DISABLE TRIGGER trg_ledger_entry_immutable')
    await db.query('DELETE FROM finance.ledger_entry WHERE voucher_id IN (SELECT id FROM rev_v)')
    await db.query('ALTER TABLE finance.ledger_entry ENABLE TRIGGER trg_ledger_entry_immutable')
    await db.query(`DELETE FROM finance.rates_receipt WHERE voucher_id IN (SELECT id FROM rev_v)`)
    await db.query(`DELETE FROM finance.rates_bill WHERE voucher_id IN (SELECT id FROM rev_v)`)
    await db.query('ALTER TABLE finance.voucher_line DISABLE TRIGGER USER')
    await db.query(`DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM rev_v) OR against_voucher_id IN (SELECT id FROM rev_v)`)
    await db.query('ALTER TABLE finance.voucher_line ENABLE TRIGGER USER')
    await db.query(`DELETE FROM finance.voucher WHERE id IN (SELECT id FROM rev_v)`)
    await db.query(`DELETE FROM finance.rates_billing_refusal WHERE billing_run_id IN (SELECT id FROM finance.rates_billing_run WHERE run_reference LIKE 'REV-%')`)
    await db.query(`DELETE FROM finance.rates_billing_run WHERE run_reference LIKE 'REV-%'`)
    await db.query(`DELETE FROM finance.rates_account WHERE account_no LIKE 'REV-%'`)
    await db.query(`DELETE FROM finance.valuation_roll WHERE property_category_id IN (SELECT id FROM finance.property_category WHERE code LIKE 'REV-%')`)
    await db.query(`DELETE FROM finance.rates_tariff WHERE property_category_id IN (SELECT id FROM finance.property_category WHERE code LIKE 'REV-%')`)
    await db.query(`DELETE FROM finance.property_category WHERE code LIKE 'REV-%'`)
    await db.query(`DELETE FROM finance.party WHERE reference LIKE 'REV-P%' AND NOT EXISTS (SELECT 1 FROM finance.voucher_line l WHERE l.party_id = finance.party.id)`)
    await db.query(`DELETE FROM finance.transaction WHERE import_batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE 'REV-IMP-%')`)
    await db.query(`DELETE FROM finance.import_exception WHERE batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE 'REV-IMP-%')`)
    await db.query(`DELETE FROM finance.import_row WHERE batch_id IN (SELECT id FROM finance.import_batch WHERE idempotency_key LIKE 'REV-IMP-%')`)
    await db.query(`DELETE FROM finance.import_batch WHERE idempotency_key LIKE 'REV-IMP-%'`)
    await db.query('COMMIT')
    console.log('Removed.')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1) })
