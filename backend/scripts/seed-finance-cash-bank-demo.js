#!/usr/bin/env node
/**
 * Cash office and banking demo: five months of a working cash office at Vungu RDC, and the bank
 * reconciliations that follow from it.
 *
 *   DATABASE_URL=... node scripts/seed-finance-cash-bank-demo.js              create (idempotent)
 *   DATABASE_URL=... node scripts/seed-finance-cash-bank-demo.js --no-bank    everything but the bank step
 *   DATABASE_URL=... node scripts/seed-finance-cash-bank-demo.js --bank-only  only the bank step
 *   DATABASE_URL=... node scripts/seed-finance-cash-bank-demo.js --report     counts
 *   DATABASE_URL=... node scripts/seed-finance-cash-bank-demo.js --clean      remove it all (local only)
 *
 * WHAT IT CREATES (codes prefixed CASH- / BANK-)
 *  - Ledger accounts: three till (cash) accounts, revenue accounts per service, a cash-difference
 *    account and a bank-charges account.
 *  - Cash points: Vungu head office counter, Lower Gweru sub-office, mobile collection point.
 *  - Income codes: refuse, water, business and hawker licences, building plan and inspection fees,
 *    cemetery, beer-hall levy, hall hire, market stalls, clearance certificates, tenders, sundry.
 *  - Cashier assignments (by demo.supervisor through the API).
 *  - Cashier sessions on every business day 1 Jul – 16 Nov 2026: head office (demo.cashier), Lower
 *    Gweru Tue/Thu and the mobile point on Fridays (demo.cashier2, who relieves head office during
 *    demo.cashier's leave week). Receipts in cash, EcoCash, card swipe and cheque, USD and ZWG,
 *    rates payments against whatever posted rates bills exist. All closed by the cashier and
 *    verified by demo.supervisor through the real database functions. One explained shortage,
 *    one explained surplus, two voided receipts, one session returned for a recount.
 *  - Bankings for every session's cash (prepared by the cashier, posted by demo.accountant through
 *    the API); those for 16 Nov are left as drafts awaiting posting.
 *  - TODAY: demo.cashier2's Lower Gweru session opened, receipted and closed through the API —
 *    awaiting verification. demo.cashier has NO session, so one can be opened live. Three
 *    customers wait in today's queue.
 *  - Bank (GL-1100, CBZ): a cutover statement confirming the opening balances, then July–October
 *    statements per currency imported, fully matched and reconciled (monthly bank charges journalled
 *    as BANK-CHG-*), and November imported and partially matched — bank charges, an unidentified
 *    deposit, the latest EcoCash/POS settlements and a journal-and-its-reversal left to do.
 *
 * WHY HISTORICAL RECEIPTS GO THROUGH pg_temp COPIES
 * finance.cashier_session_for_receipt() refuses a session whose business date has passed, so a
 * July receipt cannot be taken today. The script copies the three receipt functions into pg_temp
 * (its own connection only), with that single test turned round to refuse FUTURE dates instead,
 * and calls them. Every other rule — numbering, costing, ledger lines, separation of duties at
 * verification — is the real code. Nothing shared is altered. Timestamps of the rows it wrote are
 * then moved to the business day (triggers off for that transaction only, its own rows only).
 *
 * SAFETY: refuses any DATABASE_URL whose host is not localhost/127.0.0.1 unless the operator
 * explicitly opts in with --allow-remote-db (SEED_ALLOW_REMOTE=1) — for a managed database
 * they own. On such a database session_replication_role is superuser-only, so the temporary
 * unguarding is done by disabling user triggers as the table owner instead (scripts/lib/seed-remote.js).
 */
const { Client } = require('pg')
const { allowRemoteDb, unguardFinanceTriggers, reguardFinanceTriggers } = require('./lib/seed-remote')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('Set DATABASE_URL to the LOCAL database.'); process.exit(1) }
const dbHost = allowRemoteDb(DATABASE_URL, { what: 'seed-finance-cash-bank-demo.js' })
const API = process.env.API_BASE || 'http://127.0.0.1:3011/api'
const PASSWORD = 'demo1234'
const ARGS = process.argv.slice(2)
const has = (f) => ARGS.includes(f)

// ── Deterministic randomness ────────────────────────────────────────────────────────────────
function rng(seedText) {
  let h = 1779033703 ^ seedText.length
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let r = next() * tot; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0] } return pairs[pairs.length - 1][0] },
  }
}
const money = (cents) => (cents / 100).toFixed(2)
const toCents = (s) => Math.round(Number(s) * 100)

// ── Dates ───────────────────────────────────────────────────────────────────────────────────
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay()
const HOLIDAYS = new Set(['2026-08-10', '2026-08-11'])
const isBusiness = (d) => dow(d) >= 1 && dow(d) <= 5 && !HOLIDAYS.has(d)
const nextBusiness = (d) => { let x = addDays(d, 1); while (!isBusiness(x)) x = addDays(x, 1); return x }
const ts = (d, hh, mm) => `${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+02:00`
const yymmdd = (d) => d.slice(2).replace(/-/g, '')
const LEAVE = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']

// ── Reference data ──────────────────────────────────────────────────────────────────────────
const ACCOUNTS = [
  // code, name, root, type, parent
  ['CASH-1010', 'Cash on hand — Vungu head office till', 'asset', 'cash', 'GL-1000'],
  ['CASH-1020', 'Cash on hand — Lower Gweru sub-office till', 'asset', 'cash', 'GL-1000'],
  ['CASH-1030', 'Cash on hand — mobile collection point till', 'asset', 'cash', 'GL-1000'],
  ['CASH-4310', 'Refuse removal charges', 'revenue', null, 'GL-4000'],
  ['CASH-4320', 'Water charges', 'revenue', null, 'GL-4000'],
  ['CASH-4330', 'Building plan and inspection fees', 'revenue', null, 'GL-4000'],
  ['CASH-4340', 'Cemetery fees', 'revenue', null, 'GL-4000'],
  ['CASH-4350', 'Beer hall levy', 'revenue', null, 'GL-4000'],
  ['CASH-4360', 'Hire of council halls', 'revenue', null, 'GL-4000'],
  ['CASH-4370', 'Market and vendor fees', 'revenue', null, 'GL-4000'],
  ['CASH-4380', 'Sundry income', 'revenue', null, 'GL-4000'],
  ['CASH-5310', 'Cash shortages and surpluses', 'expense', null, 'GL-5000'],
  ['BANK-5320', 'Bank charges', 'expense', null, 'GL-5000'],
]
const POINTS = [
  { code: 'CASH-VHO', name: 'Vungu head office counter', location: 'Council offices, Vungu Growth Point', till: 'CASH-1010', key: 'HO' },
  { code: 'CASH-LGW', name: 'Lower Gweru sub-office', location: 'Lower Gweru business centre, ward 9', till: 'CASH-1020', key: 'LG' },
  { code: 'CASH-MOB', name: 'Mobile collection point', location: 'Rotates: Nyama, Somabhula, Maboleni and Gwesela business centres', till: 'CASH-1030', key: 'MB' },
]
// code, name, account, dept, pricing, usd, zwg
const CODES = [
  ['CASH-RFS', 'Refuse removal (domestic, monthly)', 'CASH-4310', 'DD-HLT', 'fixed', '5.00', '135.00'],
  ['CASH-WTR', 'Water charges', 'CASH-4320', 'DD-ENG', 'variable', null, null],
  ['CASH-BLC', 'Business licence (shop / trading)', 'GL-4200', 'DD-FIN', 'variable', null, null],
  ['CASH-HAW', "Hawker's licence (monthly)", 'GL-4200', 'DD-FIN', 'fixed', '10.00', '270.00'],
  ['CASH-BPF', 'Building plan approval fee', 'CASH-4330', 'DD-ENG', 'variable', null, null],
  ['CASH-BIN', 'Building inspection fee (per stage)', 'CASH-4330', 'DD-ENG', 'fixed', '25.00', '675.00'],
  ['CASH-CEM', 'Cemetery fees (grave site)', 'CASH-4340', 'DD-HLT', 'fixed', '40.00', '1080.00'],
  ['CASH-BHL', 'Beer hall levy', 'CASH-4350', 'DD-SOC', 'variable', null, null],
  ['CASH-HAL', 'Hire of community hall (per day)', 'CASH-4360', 'DD-SOC', 'fixed', '30.00', '810.00'],
  ['CASH-MKT', 'Market stall fee (per day)', 'CASH-4370', 'DD-FIN', 'fixed', '1.00', '27.00'],
  ['CASH-CLR', 'Rates clearance certificate', 'CASH-4380', 'DD-FIN', 'fixed', '15.00', '405.00'],
  ['CASH-TND', 'Tender documents', 'CASH-4380', 'DD-FIN', 'fixed', '20.00', null],
  ['CASH-SND', 'Sundry income', 'CASH-4380', 'DD-FIN', 'variable', null, null],
]
// Variable price ranges, USD cents (ZWG = x27, rounded to whole ZWG).
const RANGES = { 'CASH-WTR': [800, 4500], 'CASH-BLC': [6000, 25000], 'CASH-BPF': [4500, 38000], 'CASH-BHL': [2500, 15000], 'CASH-SND': [500, 3000] }
const PEOPLE = ['Tendai Moyo', 'Rudo Chikomo', 'Farai Sibanda', 'Nyasha Mapfumo', 'Tatenda Ncube', 'Chipo Dube', 'Blessing Mukandatsama',
  'Kudakwashe Shumba', 'Precious Ndlovu', 'Tafadzwa Gumbo', 'Memory Zhou', 'Simbarashe Chirwa', 'Ruvimbo Marufu', 'Takudzwa Chari',
  'Sipho Nkomo', 'Grace Mutasa', 'Lovemore Banda', 'Patience Hove', 'Innocent Mlambo', 'Shingai Mhlanga', 'Thandiwe Khumalo',
  'Never Chidzikwe', 'Esther Mpofu', 'Joseph Mudzingwa', 'Gift Makoni', 'Fungai Chingono', 'Admire Tshuma', 'Rutendo Musonza',
  'Mthokozisi Moyo', 'Loveness Gwatidzo', 'Prosper Nyoni', 'Vimbai Matare']
const BUSINESSES = ['Vungu Growth Point Supermarket', 'Nyama Business Centre Butchery', 'Lower Gweru Bottle Store', 'Takunda Hardware',
  'Somabhula General Dealer', 'Maboleni Grinding Mill', 'Gweru Builders (Pvt) Ltd', 'Midlands Agro-Dealers', 'Gwesela Tuck Shop',
  'Chikomo Agro (Pvt) Ltd', 'Mvuma Road Service Station', 'Shurugwi Road Hair Salon', 'Mkoba Tyre and Exhaust', 'Vungu Farmers Co-operative']
const BUSINESS_CODES = new Set(['CASH-BLC', 'CASH-BHL', 'CASH-TND', 'CASH-BPF'])
const QUEUE = [
  ['Tendai Moyo', 'Refuse removal'], ['Midlands Agro-Dealers', 'Business licence renewal'], ['Grace Mutasa', 'Rates payment'],
]

// ── Database and API helpers ────────────────────────────────────────────────────────────────
const db = new Client({ connectionString: DATABASE_URL })
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tokens = {}
async function login(who) {
  if (tokens[who]) return tokens[who]
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@vungu.test`, password: PASSWORD }) })
    if (res.status === 429) { await sleep(5000); continue }
    if (res.status !== 200) throw new Error(`login ${who}: ${res.status} ${await res.text()}`)
    const cookies = res.headers.getSetCookie()
    await res.arrayBuffer()
    tokens[who] = cookies.find((c) => c.startsWith('vungu_at=')).split(';')[0].slice('vungu_at='.length)
    return tokens[who]
  }
  throw new Error(`login ${who}: rate limited`)
}
async function api(who, method, path, body, { form } = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const headers = { authorization: `Bearer ${await login(who)}` }
    let payload
    if (form) payload = form()
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload })
    const text = await res.text()
    if (res.status === 429) { await sleep(4000); continue }
    if (res.status === 401) { delete tokens[who]; continue }
    let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
    if (res.status >= 400) { const e = new Error(`${who} ${method} ${path} -> ${res.status} ${text.slice(0, 400)}`); e.status = res.status; e.body = json; throw e }
    return json.data
  }
  throw new Error(`${method} ${path}: rate limited`)
}

// ── State loaded once ───────────────────────────────────────────────────────────────────────
const S = {}
async function loadState() {
  const users = await q(`SELECT split_part(email, '@', 1) AS who, id FROM public.users WHERE email LIKE 'demo.%@vungu.test'`)
  S.user = Object.fromEntries(users.map((u) => [u.who, u.id]))
  for (const w of ['demo.cashier', 'demo.cashier2', 'demo.supervisor', 'demo.accountant', 'demo.finance-admin']) {
    if (!S.user[w]) throw new Error(`missing user ${w}; run scripts/seed-demo-users.js`)
  }
  S.year = await one(`SELECT id FROM finance.financial_year WHERE deleted_at IS NULL AND status = 'open' AND start_date = '2026-07-01'`)
  if (!S.year) throw new Error('no open 2026/27 financial year (seed-finance-director-demo.js)')
  S.today = (await one(`SELECT CURRENT_DATE::text AS d`)).d
  await loadAccounts()
}
async function loadAccounts() {
  const rows = await q(`SELECT id, code FROM finance.ledger_account WHERE deleted_at IS NULL`)
  S.acct = Object.fromEntries(rows.map((r) => [r.code, r.id]))
  S.bank = S.acct['GL-1100']
  if (!S.bank) throw new Error('GL-1100 bank account missing (seed-general-ledger-demo.js)')
}

// ── Step 1: set-up through the API ──────────────────────────────────────────────────────────
async function setup() {
  for (const [code, name, root, type, parent] of ACCOUNTS) {
    if (S.acct[code]) continue
    await api('demo.accountant', 'POST', '/finance/ledger/accounts', {
      code, name, root_type: root, ...(type ? { account_type: type } : {}), parent_id: S.acct[parent],
      notes: 'Cash office demo account (seed-finance-cash-bank-demo.js).',
    })
    console.log(`  account ${code}`)
  }
  await loadAccounts()
  const points = Object.fromEntries((await q(`SELECT code, id FROM finance.cash_point WHERE deleted_at IS NULL`)).map((r) => [r.code, r.id]))
  for (const p of POINTS) {
    if (!points[p.code]) {
      const d = await api('demo.accountant', 'POST', '/finance/cash/points', {
        code: p.code, name: p.name, location: p.location, till_account_id: S.acct[p.till],
        difference_account_id: S.acct['CASH-5310'], notes: 'Cash office demo (seed-finance-cash-bank-demo.js).',
      })
      points[p.code] = d.cash_point.id
      console.log(`  cash point ${p.code}`)
    }
    p.id = points[p.code]
  }
  const depts = Object.fromEntries((await q(`SELECT code, id FROM finance.department WHERE deleted_at IS NULL`)).map((r) => [r.code, r.id]))
  const codes = Object.fromEntries((await q(`SELECT code, id FROM finance.income_code WHERE deleted_at IS NULL`)).map((r) => [r.code, r.id]))
  S.codes = {}
  for (const [code, name, account, dept, pricing, usd, zwg] of CODES) {
    if (!codes[code]) {
      const d = await api('demo.accountant', 'POST', '/finance/cash/income-codes', {
        code, name, ledger_account_id: S.acct[account], ...(depts[dept] ? { department_id: depts[dept] } : {}),
        pricing, ...(usd ? { unit_amount_usd: usd } : {}), ...(zwg ? { unit_amount_zwg: zwg } : {}),
        notes: 'Demo tariff (not a Council resolution).',
      })
      codes[code] = d.income_code.id
      console.log(`  income code ${code}`)
    }
    S.codes[code] = { id: codes[code], pricing, usd: usd ? toCents(usd) : null, zwg: zwg ? toCents(zwg) : null }
  }
  // Assignments, made by the supervisor, from the start of the year.
  const live = await q(`SELECT cash_point_id, user_id FROM finance.cash_point_assignment WHERE ended_at IS NULL`)
  const want = [['CASH-VHO', 'demo.cashier', 'Head office counter, permanent.'], ['CASH-LGW', 'demo.cashier2', 'Lower Gweru, Tuesdays and Thursdays.'],
    ['CASH-MOB', 'demo.cashier2', 'Mobile point, Fridays.'], ['CASH-VHO', 'demo.cashier2', 'Relief at head office during leave.'],
    ['CASH-LGW', 'demo.cashier', 'Relief at Lower Gweru.']]
  for (const [pc, who, note] of want) {
    const p = POINTS.find((x) => x.code === pc)
    if (live.some((a) => a.cash_point_id === p.id && a.user_id === S.user[who])) continue
    await api('demo.supervisor', 'POST', '/finance/cash/assignments', { cash_point_id: p.id, user_id: S.user[who], valid_from: '2026-07-01', note })
    console.log(`  assigned ${who} to ${pc}`)
  }
  await db.query(`UPDATE finance.cash_point_assignment SET assigned_at = '2026-06-30T09:00:00+02:00'
                   WHERE cash_point_id = ANY($1) AND assigned_at::date > '2026-07-01'`, [POINTS.map((p) => p.id)]).catch(() => {})
}

// ── Step 2: historical sessions ─────────────────────────────────────────────────────────────
async function installTempFunctions() {
  const defs = await q(`SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'finance' AND p.proname IN ('cashier_session_for_receipt', 'record_cash_receipt', 'record_counter_rates_receipt')`)
  if (defs.length !== 3) throw new Error('expected exactly three receipt functions')
  for (const name of ['cashier_session_for_receipt', 'record_cash_receipt', 'record_counter_rates_receipt']) {
    let def = defs.find((d) => d.proname === name).def
    def = def.replace(`CREATE OR REPLACE FUNCTION finance.${name}(`, `CREATE OR REPLACE FUNCTION pg_temp.${name}(`)
      .replace(/finance\.cashier_session_for_receipt\(/g, 'pg_temp.cashier_session_for_receipt(')
    if (name === 'cashier_session_for_receipt') {
      if (!def.includes('IF s.business_date < CURRENT_DATE THEN')) throw new Error('date guard not found; the function changed')
      def = def.replace('IF s.business_date < CURRENT_DATE THEN', 'IF s.business_date > CURRENT_DATE THEN')
    }
    if (!def.includes(`pg_temp.${name}(`)) throw new Error(`could not retarget ${name}`)
    await db.query(def)
  }
}

function plan() {
  const sessions = []
  for (let d = '2026-07-01'; d < S.today; d = addDays(d, 1)) {
    if (!isBusiness(d)) continue
    const leave = LEAVE.includes(d)
    sessions.push({ date: d, point: 'CASH-VHO', who: leave ? 'demo.cashier2' : 'demo.cashier' })
    if (!leave && (dow(d) === 2 || dow(d) === 4)) sessions.push({ date: d, point: 'CASH-LGW', who: 'demo.cashier2' })
    if (!leave && dow(d) === 5) sessions.push({ date: d, point: 'CASH-MOB', who: 'demo.cashier2' })
  }
  return sessions
}
const SPECIAL = {
  'CASH-VHO|2026-08-19': { void: true },
  'CASH-VHO|2026-11-12': { void: true },
  'CASH-VHO|2026-09-15': { variance: { USD: -200 }, explain: { USD: 'Short USD 2.00: change given twice to a customer paying refuse at the busy lunch hour; customer could not be traced. Reported to supervisor.' } },
  'CASH-LGW|2026-10-08': { variance: { ZWG: 1000 }, explain: { ZWG: 'Over ZWG 10.00: a customer paying water charges left without waiting for change; name not recorded.' } },
  'CASH-VHO|2026-10-27': { recount: true },
}
const MOBILE_SITES = ['Nyama business centre (ward 3)', 'Somabhula business centre (ward 11)', 'Maboleni business centre (ward 6)', 'Gwesela business centre (ward 14)']

function buildReceipt(r, point, date, bills, i) {
  const mobile = point === 'CASH-MOB'
  // Rates payment at the counter, from October when bills exist.
  if (!mobile && bills.length && r.next() < 0.22) {
    const bill = bills.shift()
    const full = bill.open
    // A part-payment is at least $10, but never more than the bill still owes.
    const amount = r.next() < 0.6 ? full : Math.min(full, Math.max(1000, Math.round(full * (0.3 + r.next() * 0.4) / 500) * 500))
    const method = r.weighted([['cash', 70], ['mobile_money', 20], ['cheque', 10]])
    return { kind: 'rates', bill, amount, currency: 'USD', method, payer: bill.payer }
  }
  const currency = r.next() < (mobile ? 0.15 : 0.2) ? 'ZWG' : 'USD'
  const method = mobile ? r.weighted([['cash', 75], ['mobile_money', 25]])
    : r.weighted([['cash', 60], ['mobile_money', 25], ['card', 11], ['cheque', 4]])
  const pool = mobile
    ? [['CASH-MKT', 30], ['CASH-HAW', 18], ['CASH-RFS', 18], ['CASH-WTR', 14], ['CASH-BHL', 8], ['CASH-SND', 4]]
    : [['CASH-RFS', 22], ['CASH-WTR', 18], ['CASH-MKT', 5], ['CASH-BLC', 7], ['CASH-HAW', 6], ['CASH-BPF', 5], ['CASH-BIN', 4],
      ['CASH-CEM', 3], ['CASH-BHL', 5], ['CASH-HAL', 3], ['CASH-CLR', 4], ['CASH-TND', 2], ['CASH-SND', 4]]
  const nLines = r.next() < 0.18 ? 2 : 1
  const lines = []
  let total = 0
  const used = new Set()
  for (let k = 0; k < nLines; k++) {
    let code = r.weighted(pool)
    for (let t = 0; t < 6 && (used.has(code) || (currency === 'ZWG' && S.codes[code].pricing === 'fixed' && !S.codes[code].zwg)); t++) code = r.weighted(pool)
    if (used.has(code) || (currency === 'ZWG' && S.codes[code].pricing === 'fixed' && !S.codes[code].zwg)) continue
    used.add(code)
    const c = S.codes[code]
    if (c.pricing === 'fixed') {
      const qty = code === 'CASH-MKT' ? r.int(1, 6) : code === 'CASH-HAL' ? r.int(1, 2) : 1
      lines.push({ income_code_id: c.id, quantity: String(qty) })
      total += qty * (currency === 'USD' ? c.usd : c.zwg)
    } else {
      const [lo, hi] = RANGES[code]
      let cents = Math.round(r.int(lo, hi) / 50) * 50
      if (currency === 'ZWG') cents = Math.round((cents * 27) / 100) * 100
      lines.push({ income_code_id: c.id, unit_amount: money(cents), ...(mobile ? { narration: `${c_name(code)} — ${MOBILE_SITES[i % 4]}` } : {}) })
      total += cents
    }
  }
  if (!lines.length) { lines.push({ income_code_id: S.codes['CASH-RFS'].id, quantity: '1' }); total = currency === 'USD' ? 500 : 13500 }
  const business = [...used].some((c) => BUSINESS_CODES.has(c))
  const payer = business ? r.pick(BUSINESSES) : r.pick(PEOPLE)
  return { kind: 'sundry', lines, total, currency, method: method === 'cheque' && !business ? 'cash' : method, payer }
}
const c_name = (code) => CODES.find((c) => c[0] === code)[1]
function methodRef(r, method, date, hh, mm) {
  if (method === 'mobile_money') return `MP${yymmdd(date)}.${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}.${String.fromCharCode(65 + r.int(0, 25))}${r.int(10000, 99999)}`
  if (method === 'card') return `POS ${r.int(100000, 999999)} AUTH ${r.int(100000, 999999)}`
  if (method === 'cheque') return `CHQ ${r.int(100100, 109999)}`
  return null
}

async function openBills(date, seed) {
  return q(`SELECT rb.id, rb.rates_account_id, p.name AS payer, finance.rates_bill_unsettled(rb.id)::text AS open
              FROM finance.rates_bill rb
              JOIN finance.voucher v ON v.id = rb.voucher_id AND v.status = 'posted'
              JOIN finance.rates_account ra ON ra.id = rb.rates_account_id
              JOIN finance.party p ON p.id = ra.party_id
             WHERE rb.deleted_at IS NULL AND rb.currency = 'USD' AND v.posting_date <= $1::date
               AND NOT EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = rb.voucher_id)
               AND NOT EXISTS (SELECT 1 FROM finance.voucher_line l JOIN finance.voucher dv ON dv.id = l.voucher_id
                                WHERE l.against_voucher_id = rb.voucher_id AND dv.status = 'draft')
               AND finance.rates_bill_unsettled(rb.id) > 0
             ORDER BY md5(rb.id::text || $2) LIMIT 4`, [date, seed])
    .then((rows) => rows.map((b) => ({ ...b, open: toCents(b.open) })))
}

async function runSession(s) {
  const point = POINTS.find((p) => p.code === s.point)
  const exists = await one(`SELECT id FROM finance.cashier_session WHERE cash_point_id = $1 AND business_date = $2`, [point.id, s.date])
  if (exists) return false
  const key = `${s.point}|${s.date}`
  const special = SPECIAL[key] || {}
  const r = rng(key)
  const cashier = S.user[s.who]
  const supervisor = S.user['demo.supervisor']
  const floats = s.point === 'CASH-VHO' ? [{ currency: 'USD', amount: '50.00' }, { currency: 'ZWG', amount: '500.00' }]
    : s.point === 'CASH-LGW' ? [{ currency: 'USD', amount: '20.00' }, { currency: 'ZWG', amount: '200.00' }] : [{ currency: 'USD', amount: '20.00' }]
  const count = s.point === 'CASH-VHO' ? r.int(6, 12) : s.point === 'CASH-LGW' ? r.int(4, 8) : r.int(8, 14)
  const bills = s.point === 'CASH-MOB' ? [] : await openBills(s.date, key)
  await db.query('BEGIN')
  try {
    const { id } = await one(`SELECT finance.open_cashier_session($1,$2,$3,$4::date,$5::jsonb) AS id`,
      [point.id, cashier, S.year.id, s.date, JSON.stringify(floats)])
    const times = []
    let minute = 8 * 60 + 5
    for (let i = 0; i < count; i++) {
      minute += r.int(12, Math.max(14, Math.floor((15 * 60 + 40 - minute) / Math.max(1, count - i))))
      const hh = Math.min(15, Math.floor(minute / 60)); const mm = hh === 15 ? Math.min(55, minute % 60) : minute % 60
      const rc = buildReceipt(r, s.point, s.date, bills, i)
      const ref = methodRef(r, rc.method, s.date, hh, mm)
      const dep = rc.method === 'cash' || rc.method === 'cheque' ? null : S.bank
      let rid
      let source = 'sundry'
      if (rc.kind === 'rates') {
        source = 'rates'
        rid = (await one(`SELECT pg_temp.record_counter_rates_receipt($1,$2,$3,$4::numeric,'USD',$5,$6::jsonb,$7,$8,NULL,NULL) AS id`,
          [id, cashier, rc.bill.rates_account_id, money(rc.amount), rc.method,
            JSON.stringify([{ rates_bill_id: rc.bill.id, amount: money(rc.amount) }]), dep, ref])).id
      } else {
        rid = (await one(`SELECT pg_temp.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7,NULL,$8,NULL) AS id`,
          [id, cashier, rc.payer, rc.currency, rc.method, JSON.stringify(rc.lines), dep, ref])).id
      }
      times.push({ id: rid, source, at: ts(s.date, hh, mm) })
      if (special.void && i === 2 && source === 'sundry') {
        await db.query(`SELECT finance.cancel_cash_receipt($1,$2,$3)`, [rid, cashier,
          'Wrong income code selected (plan fee keyed instead of inspection fee). Customer still at the counter; receipt reissued.'])
        times[times.length - 1].cancelled = true
        const again = await one(`SELECT pg_temp.record_cash_receipt($1,$2,$3,$4,'cash',$5::jsonb,NULL,NULL,NULL,'Reissue of a cancelled receipt') AS id`,
          [id, cashier, rc.payer, 'USD', JSON.stringify([{ income_code_id: S.codes['CASH-BIN'].id, quantity: '1' }])])
        times.push({ id: again.id, source: 'sundry', at: ts(s.date, hh, Math.min(59, mm + 4)) })
      }
    }
    // The count: what the drawer holds is float + physical takings (+/- the planned variance).
    const physical = await q(`SELECT currency::text, sum(amount)::text AS amount FROM finance.v_cashier_session_receipt
                               WHERE cashier_session_id = $1 AND is_physical AND NOT is_cancelled GROUP BY 1`, [id])
    const counts = []
    for (const cur of ['USD', 'ZWG']) {
      const fl = floats.find((f) => f.currency === cur)
      const exp = toCents((physical.find((p) => p.currency === cur) || { amount: '0' }).amount)
      if (!fl && exp === 0) continue
      const v = (special.variance && special.variance[cur]) || 0
      counts.push({ currency: cur, declared_total: money((fl ? toCents(fl.amount) : 0) + exp + v), ...(v ? { explanation: special.explain[cur] } : {}) })
    }
    const closes = [ts(s.date, 16, 5)]
    if (special.recount) {
      const wrong = counts.map((c) => c.currency === 'USD' ? { ...c, declared_total: money(toCents(c.declared_total) - 500), explanation: 'Short USD 5.00, cannot account for it.' } : c)
      await db.query(`SELECT finance.close_cashier_session($1,$2,$3::jsonb)`, [id, cashier, JSON.stringify(wrong)])
      await db.query(`SELECT finance.return_cashier_session($1,$2,$3)`, [id, supervisor, 'Recount please: the drawer was counted before the cheque tray was emptied. Count again with the supervisor present.'])
      closes.push(ts(s.date, 16, 40))
    }
    await db.query(`SELECT finance.close_cashier_session($1,$2,$3::jsonb)`, [id, cashier, JSON.stringify(counts)])
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    const note = special.variance ? 'Difference explained and accepted; posted to cash shortages and surpluses.'
      : special.recount ? 'Recount agrees with receipts. USD 5.00 note found in cheque tray.' : (r.next() < 0.2 ? 'Count agrees. Slips and EcoCash statement checked.' : null)
    await db.query(`SELECT finance.verify_cashier_session($1,$2,$3)`, [id, supervisor, note])
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    const verifiedAt = ts(s.date, special.recount ? 17 : 16, special.recount ? 5 : 30 + r.int(0, 25))
    await backdateSession(id, ts(s.date, 7, 55), closes, verifiedAt, times)
    await db.query('COMMIT')
    return true
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw new Error(`session ${key}: ${err.message}`)
  }
}

async function backdateSession(id, openedAt, closes, verifiedAt, times) {
  await unguardFinanceTriggers(db)
  await db.query(`UPDATE finance.cashier_session SET opened_at = $2, created_at = $2, closed_at = $3, verified_at = $4,
                         returned_at = CASE WHEN returned_at IS NOT NULL THEN $5::timestamptz END WHERE id = $1`,
  [id, openedAt, closes[closes.length - 1], verifiedAt, closes.length > 1 ? closes[0].replace('16:05', '16:20') : null])
  await db.query(`UPDATE finance.cashier_session_event e SET occurred_at = x.at
                    FROM (SELECT id, CASE WHEN event IN ('opened', 'float_recorded') THEN $2::timestamptz
                                          WHEN event = 'counted' THEN ($3::timestamptz[])[LEAST(row_number() OVER (PARTITION BY event ORDER BY id), cardinality($3::timestamptz[]))::int]
                                          WHEN event = 'returned' THEN $5::timestamptz
                                          WHEN event = 'verified' THEN $4::timestamptz ELSE $4::timestamptz END AS at
                            FROM finance.cashier_session_event WHERE cashier_session_id = $1) x
                   WHERE e.id = x.id`, [id, openedAt, closes, verifiedAt, closes[0].replace('16:05', '16:20')])
  const ids = times.map((t) => t.id); const ats = times.map((t) => t.at)
  await db.query(`UPDATE finance.cash_receipt c SET created_at = x.at,
                         cancelled_at = CASE WHEN c.cancelled_at IS NOT NULL THEN x.at + interval '3 minutes' END
                    FROM unnest($1::uuid[], $2::timestamptz[]) AS x(id, at) WHERE c.id = x.id`, [ids, ats])
  await db.query(`UPDATE finance.rates_receipt c SET created_at = x.at FROM unnest($1::uuid[], $2::timestamptz[]) AS x(id, at) WHERE c.id = x.id`, [ids, ats])
  await db.query(`WITH rv AS (SELECT c.voucher_id, x.at FROM unnest($1::uuid[], $2::timestamptz[]) AS x(id, at)
                               JOIN (SELECT id, voucher_id FROM finance.cash_receipt UNION ALL SELECT id, voucher_id FROM finance.rates_receipt) c ON c.id = x.id
                              UNION ALL
                              SELECT difference_voucher_id, $4::timestamptz FROM finance.cashier_session_count
                               WHERE cashier_session_id = $3 AND difference_voucher_id IS NOT NULL)
                  UPDATE finance.voucher v SET created_at = rv.at, prepared_at = rv.at,
                         posted_at = CASE WHEN v.posted_at IS NOT NULL THEN $5::timestamptz END,
                         cancelled_at = CASE WHEN v.cancelled_at IS NOT NULL THEN rv.at + interval '3 minutes' END
                    FROM rv WHERE v.id = rv.voucher_id`, [ids, ats, id, closes[closes.length - 1], verifiedAt])
  await db.query(`UPDATE finance.voucher_line l SET created_at = v.prepared_at FROM finance.voucher v
                   WHERE v.id = l.voucher_id AND v.id IN (SELECT voucher_id FROM finance.cash_receipt WHERE cashier_session_id = $1
                                                          UNION ALL SELECT voucher_id FROM finance.rates_receipt WHERE cashier_session_id = $1
                                                          UNION ALL SELECT difference_voucher_id FROM finance.cashier_session_count WHERE cashier_session_id = $1)`, [id])
  await db.query(`UPDATE finance.ledger_entry e SET posted_at = $2
                   WHERE e.voucher_id IN (SELECT voucher_id FROM finance.cash_receipt WHERE cashier_session_id = $1
                                          UNION ALL SELECT voucher_id FROM finance.rates_receipt WHERE cashier_session_id = $1
                                          UNION ALL SELECT difference_voucher_id FROM finance.cashier_session_count WHERE cashier_session_id = $1)`, [id, verifiedAt])
  await reguardFinanceTriggers(db)
}

async function history() {
  await installTempFunctions()
  const todo = plan()
  let made = 0
  for (const s of todo) {
    if (await runSession(s)) { made++; if (made % 20 === 0) console.log(`  ${made} sessions… (${s.date})`) }
  }
  console.log(`  sessions created: ${made} (planned ${todo.length})`)
}

// ── Step 3: bankings ────────────────────────────────────────────────────────────────────────
async function deposits() {
  const sessions = await q(`SELECT cs.id, cs.session_no, cs.business_date::text AS d, cp.code AS point, cp.id AS point_id, cp.name AS point_name,
                                   COALESCE(u.email, '') AS email, c.currency::text AS currency,
                                   (c.declared_total - c.opening_float)::text AS amount
                              FROM finance.cashier_session cs
                              JOIN finance.cash_point cp ON cp.id = cs.cash_point_id AND cp.code LIKE 'CASH-%'
                              JOIN public.users u ON u.id = cs.cashier_id
                              JOIN finance.cashier_session_count c ON c.cashier_session_id = cs.id
                             WHERE cs.status = 'verified' AND c.declared_total - c.opening_float > 0
                             ORDER BY cs.business_date, cp.code, c.currency`)
  const have = new Set((await q(`SELECT slip_reference FROM finance.bank_deposit WHERE cancelled_at IS NULL`)).map((r) => r.slip_reference))
  let made = 0; let posted = 0
  for (const s of sessions) {
    const on = nextBusiness(s.d)
    if (on > S.today) continue
    const slip = `CBZ-DS-${yymmdd(s.d)}-${s.point.slice(5)}-${s.currency}`
    if (have.has(slip)) continue
    const who = s.email.split('@')[0]
    const d = await api(who, 'POST', '/finance/cash/deposits', {
      cash_point_id: s.point_id, currency: s.currency, amount: s.amount, bank_account_id: S.bank, financial_year_id: S.year.id,
      deposited_on: on, slip_reference: slip, narration: `Takings of ${s.session_no} (${s.d}) banked at CBZ Gweru from ${s.point_name}`,
    })
    made++
    const created = ts(on, 10, 15)
    let postedAt = null
    if (on < S.today) {
      await api('demo.accountant', 'POST', `/finance/cash/deposits/${d.deposit.id}/post`)
      posted++
      postedAt = ts(on, 14, 30)
    }
    await db.query('BEGIN')
    await unguardFinanceTriggers(db)
    await db.query(`UPDATE finance.bank_deposit SET created_at = $2 WHERE id = $1`, [d.deposit.id, created])
    await db.query(`UPDATE finance.voucher v SET created_at = $2, prepared_at = $2, posted_at = COALESCE($3, v.posted_at)
                     FROM finance.bank_deposit b WHERE b.id = $1 AND v.id = b.voucher_id`, [d.deposit.id, created, postedAt])
    if (postedAt) await db.query(`UPDATE finance.ledger_entry e SET posted_at = $2 FROM finance.bank_deposit b WHERE b.id = $1 AND e.voucher_id = b.voucher_id`, [d.deposit.id, postedAt])
    await reguardFinanceTriggers(db)
    await db.query('COMMIT')
    if (made % 50 === 0) console.log(`  ${made} bankings…`)
  }
  console.log(`  bankings prepared: ${made}, posted: ${posted}`)
}

// ── Step 4: today ───────────────────────────────────────────────────────────────────────────
async function today() {
  const lg = POINTS.find((p) => p.code === 'CASH-LGW')
  const mine = await one(`SELECT id, status FROM finance.cashier_session WHERE cashier_id = $1 AND business_date = CURRENT_DATE`, [S.user['demo.cashier2']])
  // An open session with no receipts is one an earlier run opened and then failed on: resume it.
  const resumable = mine && mine.status === 'open'
    && !(await one(`SELECT 1 FROM finance.cash_receipt WHERE cashier_session_id = $1 LIMIT 1`, [mine.id]))
  if (!mine || resumable) {
    const sess = resumable ? { id: mine.id, session_no: (await one(`SELECT session_no FROM finance.cashier_session WHERE id = $1`, [mine.id])).session_no }
      : (await api('demo.cashier2', 'POST', '/finance/cash/sessions', {
        cash_point_id: lg.id, financial_year_id: S.year.id, floats: [{ currency: 'USD', amount: '20.00' }, { currency: 'ZWG', amount: '200.00' }],
      })).session
    const r = rng(`today|${S.today}`)
    const recs = [
      { payer_name: 'Lower Gweru Bottle Store', currency: 'USD', method: 'cash', lines: [{ income_code_id: S.codes['CASH-BHL'].id, unit_amount: '85.00' }] },
      { payer_name: 'Chipo Dube', currency: 'USD', method: 'cash', lines: [{ income_code_id: S.codes['CASH-RFS'].id, quantity: '2' }] },
      { payer_name: 'Lovemore Banda', currency: 'USD', method: 'mobile_money', method_reference: `MP${yymmdd(S.today)}.0948.K${r.int(10000, 99999)}`, deposit_account_id: S.bank, lines: [{ income_code_id: S.codes['CASH-WTR'].id, unit_amount: '18.50' }] },
      { payer_name: 'Esther Mpofu', currency: 'ZWG', method: 'cash', lines: [{ income_code_id: S.codes['CASH-HAW'].id, quantity: '1' }] },
      { payer_name: 'Gwesela Tuck Shop', currency: 'USD', method: 'cash', lines: [{ income_code_id: S.codes['CASH-BLC'].id, unit_amount: '120.00' }, { income_code_id: S.codes['CASH-RFS'].id, quantity: '1' }] },
      { payer_name: 'Admire Tshuma', currency: 'ZWG', method: 'mobile_money', method_reference: `MP${yymmdd(S.today)}.1120.D${r.int(10000, 99999)}`, deposit_account_id: S.bank, lines: [{ income_code_id: S.codes['CASH-WTR'].id, unit_amount: '540.00' }] },
    ]
    for (const rc of recs) await api('demo.cashier2', 'POST', '/finance/cash/receipts', { session_id: sess.id, ...rc })
    const bills = await openBills(S.today, 'today')
    if (bills.length) {
      const b = bills[0]
      const amount = money(Math.min(b.open, 15000))
      await api('demo.cashier2', 'POST', '/finance/cash/receipts/rates', {
        session_id: sess.id, rates_account_id: b.rates_account_id, amount, currency: 'USD', method: 'cash',
        allocations: [{ rates_bill_id: b.id, amount }],
      })
    }
    const physical = await q(`SELECT currency::text, sum(amount)::text AS amount FROM finance.v_cashier_session_receipt
                               WHERE cashier_session_id = $1 AND is_physical AND NOT is_cancelled GROUP BY 1`, [sess.id])
    const counts = [['USD', 2000], ['ZWG', 20000]].map(([cur, fl]) => ({
      currency: cur, declared_total: money(fl + toCents((physical.find((p) => p.currency === cur) || { amount: '0' }).amount)),
    }))
    await api('demo.cashier2', 'POST', `/finance/cash/sessions/${sess.id}/close`, { counts })
    console.log(`  today: ${sess.session_no} at Lower Gweru closed, awaiting verification`)
  } else console.log(`  today: demo.cashier2 already has a session (${mine.status})`)
  const open = await one(`SELECT session_no FROM finance.cashier_session WHERE cashier_id = $1 AND status IN ('open','suspended','abandoned')`, [S.user['demo.cashier']])
  if (open) console.warn(`  WARNING: demo.cashier holds ${open.session_no}; the live demo needs them free.`)
  const waiting = await q(`SELECT customer_name FROM finance.cash_queue_ticket WHERE business_date = CURRENT_DATE`)
  for (const [name, service] of QUEUE) {
    if (waiting.some((w) => w.customer_name === name)) continue
    await api('demo.cashier', 'POST', '/finance/cash/queue', { customer_name: name, service })
  }
}

// ── Step 5: the bank ────────────────────────────────────────────────────────────────────────
const MONTHS = ['2026-07', '2026-08', '2026-09', '2026-10']
const lastBusinessOf = (m) => { let d = addDays(`${m}-01`, 40).slice(0, 7) + '-01'; d = addDays(d, -1); while (!isBusiness(d)) d = addDays(d, -1); return d }

async function bankCharges() {
  for (const m of MONTHS) {
    for (const cur of ['USD', 'ZWG']) {
      const no = `BANK-CHG-${m.replace('-', '').slice(2)}-${cur}`
      if (await one(`SELECT 1 FROM finance.voucher WHERE voucher_no = $1`, [no])) continue
      const n = (await one(`SELECT count(*)::int AS n FROM finance.bank_deposit WHERE currency = $1 AND to_char(deposited_on, 'YYYY-MM') = $2`, [cur, m])).n
      const cents = cur === 'USD' ? 2500 + n * 50 : 65000 + n * 1500
      const date = lastBusinessOf(m)
      const v = await api('demo.accountant', 'POST', '/finance/ledger/vouchers', {
        voucher_no: no, voucher_type: 'journal', currency: cur, financial_year_id: S.year.id, posting_date: date,
        narration: `CBZ monthly service fee and deposit handling charges, ${m} (per bank statement)`, reference: `CBZ-CHG-${m}`,
        lines: [{ ledger_account_id: S.acct['BANK-5320'], debit: money(cents), narration: 'Bank charges' },
          { ledger_account_id: S.bank, credit: money(cents), narration: 'Bank charges per statement' }],
      })
      const id = v.id || (v.voucher && v.voucher.id)
      await api('demo.finance-admin', 'POST', `/finance/ledger/vouchers/${id}/post`, {})
      console.log(`  journal ${no} ${cur} ${money(cents)}`)
    }
  }
}

async function bankEntries() {
  return q(`SELECT e.id, e.currency::text AS currency, e.posting_date::text AS d, (e.debit - e.credit)::text AS amount,
                   e.voucher_no, e.voucher_type, v.reference, e.narration,
                   COALESCE(cr.method, rr.method) AS method, (cr.id IS NOT NULL OR rr.cashier_session_id IS NOT NULL) AS counter,
                   bd.slip_reference, cp.name AS point_name
              FROM finance.ledger_entry e
              JOIN finance.voucher v ON v.id = e.voucher_id
              LEFT JOIN finance.cash_receipt cr ON cr.voucher_id = e.voucher_id
              LEFT JOIN finance.rates_receipt rr ON rr.voucher_id = e.voucher_id
              LEFT JOIN finance.bank_deposit bd ON bd.voucher_id = e.voucher_id
              LEFT JOIN finance.cash_point cp ON cp.id = bd.cash_point_id
             WHERE e.ledger_account_id = $1
               AND NOT EXISTS (SELECT 1 FROM finance.bank_match_entry x WHERE x.ledger_entry_id = e.id)
             ORDER BY e.posting_date, e.voucher_no`, [S.bank])
}

const clip = (s, n = 60) => String(s || '').replace(/[,"\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).toUpperCase()

/** Turn cashbook entries into what the bank would print, each line remembering its entries. */
function bankLines(entries) {
  const lines = []
  const groups = new Map()
  for (const e of entries) {
    const amt = toCents(e.amount)
    if (amt === 0) continue
    if (e.voucher_type === 'opening') { lines.push({ cutover: true, date: e.d, desc: 'BALANCE CONFIRMED AT SYSTEM CUTOVER (BANK CERTIFICATE)', ref: `CBZ-CERT-${e.currency}`, amt, entries: [e.id], cur: e.currency }); continue }
    if (e.counter && ['mobile_money', 'card'].includes(e.method)) {
      const k = `${e.currency}|${e.d}|${e.method}`
      if (!groups.has(k)) groups.set(k, { cur: e.currency, d: e.d, method: e.method, amt: 0, entries: [] })
      const g = groups.get(k); g.amt += amt; g.entries.push(e.id); continue
    }
    if (e.slip_reference) { lines.push({ date: e.d, desc: `CASH DEPOSIT VUNGU RDC ${clip(e.point_name, 40)}`, ref: e.slip_reference, amt, entries: [e.id], cur: e.currency }); continue }
    if (e.voucher_no.startsWith('BANK-CHG')) { lines.push({ date: e.d, desc: 'SERVICE FEES AND DEPOSIT HANDLING CHARGES', ref: `CBZ-CHG-${e.d.slice(0, 7)}`, amt, entries: [e.id], cur: e.currency }); continue }
    const date = amt < 0 ? (() => { let x = addDays(e.d, 2); while (!isBusiness(x)) x = addDays(x, 1); return x })() : e.d
    const ref = clip(e.reference || e.voucher_no, 40)
    lines.push({ date, desc: `${amt < 0 ? 'PAYMENT' : 'DIRECT CREDIT'} ${ref} ${clip(e.narration, 40)}`, ref, amt, entries: [e.id], cur: e.currency })
  }
  for (const g of groups.values()) {
    const date = nextBusiness(g.d)
    const label = g.method === 'card' ? 'POS CARD SETTLEMENT' : 'ECOCASH MERCHANT SETTLEMENT'
    lines.push({ date, desc: `${label} ${g.entries.length} TXNS ${g.d}`, ref: `${g.method === 'card' ? 'POS' : 'ECO'}-STL-${yymmdd(g.d)}`, amt: g.amt, entries: g.entries, cur: g.cur, batch: true })
  }
  return lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function csv(lines) {
  const rows = ['Date,Description,Reference,Money In,Money Out']
  for (const l of lines) rows.push(`${l.date},${l.desc},${l.ref},${l.amt > 0 ? money(l.amt) : ''},${l.amt < 0 ? money(-l.amt) : ''}`)
  return rows.join('\n') + '\n'
}

async function importStatement(ref, cur, lines, opening, filename) {
  const closing = opening + lines.reduce((s, l) => s + l.amt, 0)
  const body = csv(lines)
  const d = await api('demo.accountant', 'POST', '/finance/bank/statements', undefined, {
    form: () => {
      const f = new FormData()
      f.append('bank_account_id', S.bank); f.append('currency', cur)
      f.append('opening_balance', money(opening)); f.append('closing_balance', money(closing))
      f.append('statement_ref', ref)
      f.append('file', new Blob([body], { type: 'text/csv' }), filename)
      return f
    },
  })
  const stored = await q(`SELECT id, line_no FROM finance.bank_statement_line WHERE statement_id = $1 ORDER BY line_no`, [d.id])
  lines.forEach((l, i) => { l.lineId = stored[i].id })
  return { id: d.id, closing }
}

async function lastClosing(cur) {
  const r = await one(`SELECT closing_balance::text AS c FROM finance.bank_statement WHERE bank_account_id = $1 AND currency = $2 AND status <> 'cancelled'
                        ORDER BY to_date DESC, imported_at DESC LIMIT 1`, [S.bank, cur])
  return r ? toCents(r.c) : null
}

async function backdateStatement(id, importedAt, reconciledAt) {
  await db.query(`UPDATE finance.bank_statement SET imported_at = $2, reconciled_at = CASE WHEN reconciled_at IS NOT NULL THEN $3::timestamptz END WHERE id = $1`, [id, importedAt, reconciledAt])
  await db.query('BEGIN'); await unguardFinanceTriggers(db)
  await db.query(`UPDATE finance.bank_match SET matched_at = $2 WHERE statement_id = $1`, [id, reconciledAt || importedAt])
  await reguardFinanceTriggers(db)
  await db.query('COMMIT')
}

async function bank() {
  await bankCharges()
  for (const cur of ['USD', 'ZWG']) {
    const existing = new Set((await q(`SELECT statement_ref FROM finance.bank_statement WHERE status <> 'cancelled' AND statement_ref LIKE 'BANK-%' AND currency = $1`, [cur])).map((r) => r.statement_ref))
    const all = bankLines((await bankEntries()).filter((e) => e.currency === cur))
    const periods = [{ ref: `BANK-CBZ-${cur}-CUTOVER`, pick: (l) => l.cutover, file: `CBZ_VRDC_${cur}_cutover_certificate.csv`, complete: true, label: '2026-07-01' }]
    for (const m of MONTHS) periods.push({ ref: `BANK-CBZ-${cur}-${m}`, pick: (l) => !l.cutover && l.date.startsWith(m), file: `CBZ_VRDC_${cur}_${m}.csv`, complete: true, label: lastBusinessOf(m) })
    periods.push({ ref: `BANK-CBZ-${cur}-2026-11`, pick: (l) => !l.cutover && l.date.startsWith('2026-11') && l.date < S.today, file: `CBZ_VRDC_${cur}_2026-11_to_16.csv`, complete: false })
    for (const p of periods) {
      if (existing.has(p.ref)) continue
      const lines = all.filter(p.pick)
      if (!p.complete && cur === 'USD') {
        lines.push({ date: '2026-11-12', desc: 'CASH DEPOSIT GWERU BRANCH NO REFERENCE', ref: 'DEP-UNREF', amt: 35000, entries: [] })
        lines.push({ date: addDays(S.today, -1), desc: 'SERVICE FEES AND DEPOSIT HANDLING CHARGES', ref: 'CBZ-CHG-2026-11', amt: -3150, entries: [] })
        lines.push({ date: '2026-11-09', desc: 'RTGS FEE', ref: 'RTGS-FEE', amt: -500, entries: [] })
      }
      if (!p.complete && cur === 'ZWG') lines.push({ date: addDays(S.today, -1), desc: 'SERVICE FEES AND IMTT', ref: 'CBZ-CHG-2026-11', amt: -84000, entries: [] })
      lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      if (!lines.length) { console.log(`  ${p.ref}: no lines`); continue }
      const opening = (await lastClosing(cur)) ?? 0
      const st = await importStatement(p.ref, cur, lines, opening, p.file)
      if (p.complete) {
        for (const l of lines) await api('demo.accountant', 'POST', `/finance/bank/statements/${st.id}/matches`, { line_ids: [l.lineId], entry_ids: l.entries })
        await api('demo.accountant', 'POST', `/finance/bank/statements/${st.id}/complete`)
        const end = p.label
        await backdateStatement(st.id, ts(addDays(end, 3), 9, 10), ts(addDays(end, 5), 15, 40))
        console.log(`  ${p.ref}: ${lines.length} lines, reconciled, closing ${money(st.closing)}`)
      } else {
        const auto = await api('demo.accountant', 'POST', `/finance/bank/statements/${st.id}/auto-match`)
        // The accountant has worked through the EcoCash/POS settlements up to the 9th by hand.
        let manual = 0
        for (const l of lines.filter((x) => x.batch && x.date <= '2026-11-09')) {
          const free = await one(`SELECT match_id FROM finance.bank_statement_line WHERE id = $1`, [l.lineId])
          if (free.match_id) continue
          await api('demo.accountant', 'POST', `/finance/bank/statements/${st.id}/matches`, { line_ids: [l.lineId], entry_ids: l.entries }); manual++
        }
        await backdateStatement(st.id, ts(S.today, 8, 20), null)
        const left = await one(`SELECT count(*)::int AS n FROM finance.bank_statement_line WHERE statement_id = $1 AND match_id IS NULL`, [st.id])
        console.log(`  ${p.ref}: ${lines.length} lines, auto-matched ${auto.matched}, by hand ${manual}, ${left.n} left to do`)
      }
    }
  }
}

// ── Report and clean ────────────────────────────────────────────────────────────────────────
async function report() {
  const rows = await q(`
    WITH cp AS (SELECT id FROM finance.cash_point WHERE code LIKE 'CASH-%'),
         cs AS (SELECT * FROM finance.cashier_session WHERE cash_point_id IN (SELECT id FROM cp))
    SELECT 'ledger accounts' AS what, count(*)::text AS n FROM finance.ledger_account WHERE code LIKE 'CASH-%' OR code LIKE 'BANK-%'
    UNION ALL SELECT 'cash points', count(*)::text FROM cp
    UNION ALL SELECT 'income codes', count(*)::text FROM finance.income_code WHERE code LIKE 'CASH-%'
    UNION ALL SELECT 'assignments (live)', count(*)::text FROM finance.cash_point_assignment WHERE cash_point_id IN (SELECT id FROM cp) AND ended_at IS NULL
    UNION ALL SELECT 'sessions ' || status, count(*)::text FROM cs GROUP BY status
    UNION ALL SELECT 'sundry receipts (' || currency || ', ' || method || ')', count(*)::text FROM finance.cash_receipt WHERE cashier_session_id IN (SELECT id FROM cs) AND cancelled_at IS NULL GROUP BY currency, method
    UNION ALL SELECT 'receipts cancelled', count(*)::text FROM finance.cash_receipt WHERE cashier_session_id IN (SELECT id FROM cs) AND cancelled_at IS NOT NULL
    UNION ALL SELECT 'rates receipts at counter', count(*)::text FROM finance.rates_receipt WHERE cashier_session_id IN (SELECT id FROM cs)
    UNION ALL SELECT 'sessions with a difference', count(DISTINCT cashier_session_id)::text FROM finance.cashier_session_count WHERE cashier_session_id IN (SELECT id FROM cs) AND variance <> 0
    UNION ALL SELECT 'takings ' || r.currency, sum(r.amount)::text FROM finance.v_cashier_session_receipt r WHERE r.cashier_session_id IN (SELECT id FROM cs) AND NOT r.is_cancelled GROUP BY r.currency
    UNION ALL SELECT 'bankings ' || v.status, count(*)::text FROM finance.bank_deposit d JOIN finance.voucher v ON v.id = d.voucher_id WHERE d.cash_point_id IN (SELECT id FROM cp) GROUP BY v.status
    UNION ALL SELECT 'bank statements ' || status, count(*)::text FROM finance.bank_statement WHERE statement_ref LIKE 'BANK-%' GROUP BY status
    UNION ALL SELECT 'bank lines unmatched', count(*)::text FROM finance.bank_statement_line l JOIN finance.bank_statement s ON s.id = l.statement_id WHERE s.statement_ref LIKE 'BANK-%' AND l.match_id IS NULL
    UNION ALL SELECT 'queue waiting today', count(*)::text FROM finance.cash_queue_ticket WHERE business_date = CURRENT_DATE AND status = 'waiting'`)
  for (const r of rows) console.log(`  ${r.what.padEnd(44)} ${r.n}`)
}

async function clean() {
  console.log('Removing the cash/bank demo. Immutability triggers are bypassed (user triggers disabled as the table owner) for this transaction only, on rows this script created.')
  await db.query('BEGIN')
  await unguardFinanceTriggers(db)
  await db.query(`CREATE TEMP TABLE _st ON COMMIT DROP AS SELECT id FROM finance.bank_statement WHERE statement_ref LIKE 'BANK-%'`)
  await db.query(`DELETE FROM finance.bank_match_entry WHERE match_id IN (SELECT id FROM finance.bank_match WHERE statement_id IN (SELECT id FROM _st))`)
  await db.query(`DELETE FROM finance.bank_statement_line WHERE statement_id IN (SELECT id FROM _st)`)
  await db.query(`DELETE FROM finance.bank_match WHERE statement_id IN (SELECT id FROM _st)`)
  await db.query(`DELETE FROM finance.bank_statement WHERE id IN (SELECT id FROM _st)`)
  await db.query(`CREATE TEMP TABLE _cp ON COMMIT DROP AS SELECT id FROM finance.cash_point WHERE code LIKE 'CASH-%'`)
  await db.query(`CREATE TEMP TABLE _cs ON COMMIT DROP AS SELECT id FROM finance.cashier_session WHERE cash_point_id IN (SELECT id FROM _cp)`)
  await db.query(`CREATE TEMP TABLE _v ON COMMIT DROP AS
      SELECT voucher_id AS id FROM finance.cash_receipt WHERE cashier_session_id IN (SELECT id FROM _cs)
      UNION SELECT voucher_id FROM finance.rates_receipt WHERE cashier_session_id IN (SELECT id FROM _cs)
      UNION SELECT difference_voucher_id FROM finance.cashier_session_count WHERE cashier_session_id IN (SELECT id FROM _cs) AND difference_voucher_id IS NOT NULL
      UNION SELECT voucher_id FROM finance.bank_deposit WHERE cash_point_id IN (SELECT id FROM _cp)
      UNION SELECT id FROM finance.voucher WHERE voucher_no LIKE 'BANK-%'`)
  await db.query(`DELETE FROM finance.bank_match_entry WHERE ledger_entry_id IN (SELECT id FROM finance.ledger_entry WHERE voucher_id IN (SELECT id FROM _v))`)
  await db.query(`DELETE FROM finance.ledger_entry WHERE voucher_id IN (SELECT id FROM _v)`)
  await db.query(`DELETE FROM finance.cash_receipt_line WHERE cash_receipt_id IN (SELECT id FROM finance.cash_receipt WHERE cashier_session_id IN (SELECT id FROM _cs))`)
  await db.query(`DELETE FROM finance.cash_receipt WHERE cashier_session_id IN (SELECT id FROM _cs)`)
  await db.query(`DELETE FROM finance.rates_receipt WHERE cashier_session_id IN (SELECT id FROM _cs)`)
  await db.query(`DELETE FROM finance.bank_deposit WHERE cash_point_id IN (SELECT id FROM _cp)`)
  await db.query(`DELETE FROM finance.cashier_session_count WHERE cashier_session_id IN (SELECT id FROM _cs)`)
  await db.query(`DELETE FROM finance.voucher_line WHERE voucher_id IN (SELECT id FROM _v)`)
  await db.query(`DELETE FROM finance.voucher WHERE id IN (SELECT id FROM _v)`)
  await db.query(`DELETE FROM finance.cashier_session_event WHERE cashier_session_id IN (SELECT id FROM _cs)`)
  await db.query(`DELETE FROM finance.cashier_session WHERE id IN (SELECT id FROM _cs)`)
  await db.query(`DELETE FROM finance.cash_queue_ticket WHERE customer_name = ANY($1)`, [QUEUE.map((x) => x[0])])
  await db.query(`DELETE FROM finance.cash_point_assignment WHERE cash_point_id IN (SELECT id FROM _cp)`)
  await db.query(`DELETE FROM finance.cash_point WHERE id IN (SELECT id FROM _cp)`)
  await db.query(`DELETE FROM finance.income_code WHERE code LIKE 'CASH-%'`)
  await db.query(`DELETE FROM finance.ledger_account WHERE code LIKE 'CASH-%' OR code LIKE 'BANK-%'`)
  await reguardFinanceTriggers(db)
  await db.query('COMMIT')
  console.log('Removed. Document numbers issued stay burned, as they would in production.')
}

async function main() {
  await db.connect()
  await db.query('SET statement_timeout = 0')
  try {
    if (has('--report')) return report()
    if (has('--clean') || has('--undo')) return clean()
    await loadState()
    console.log(`Cash/bank demo into ${dbHost}, today ${S.today}`)
    if (!has('--bank-only')) {
      console.log('Set-up'); await setup()
      console.log('Sessions'); await history()
      console.log('Bankings'); await deposits()
      console.log('Today'); await today()
    } else {
      await setup()
    }
    if (!has('--no-bank')) { console.log('Bank'); await bank() }
    console.log('Report'); await report()
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1) })
