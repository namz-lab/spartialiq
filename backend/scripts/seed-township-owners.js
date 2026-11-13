#!/usr/bin/env node
/**
 * Gives a township's stands fictitious owners and rates accounts, so the demonstration register
 * reads like a real one. Every name is invented and ends in "(demo)"; phone numbers are
 * +263 77 000 xxxx and e-mail addresses are @example.* so none can reach a real person.
 *
 *   DEMO_SEED_ENABLED=true node scripts/seed-township-owners.js --township HERTS [--seed 1] [--arrears 0.3]
 *   node scripts/seed-township-owners.js --township HERTS --remove     take the demo owners back out
 *
 * For each current stand of the township it writes, in one transaction:
 *   spatial_planning.property + parcel_owner     the planning file and who owns it
 *   revenue_link.account_link + billing_status   the account the map draws (current / in arrears)
 *   finance.party + finance.rates_account        the ratepayer of record the finance desk bills
 * About one owner in eight holds more than one stand. The same seed gives the same people, so a
 * rebuilt database looks the same. Refuses to run unless DEMO_SEED_ENABLED=true, and never in production.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { Client } = require('pg')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const township = arg('township')
const seed = Number(arg('seed', 1))
const arrearsShare = Number(arg('arrears', 0.3))
const remove = process.argv.includes('--remove')
if (!township || !/^[A-Z0-9_-]{2,16}$/.test(township)) {
  console.error('Usage: node scripts/seed-township-owners.js --township <CODE> [--seed 1] [--arrears 0.3] [--remove]')
  process.exit(1)
}

// Small deterministic generator, so the same seed always yields the same register.
function rng(s) {
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(seed)
const pick = (a) => a[Math.floor(rand() * a.length)]

const SURNAMES = ['Moyo', 'Ncube', 'Sibanda', 'Dube', 'Ndlovu', 'Nkomo', 'Mpofu', 'Khumalo', 'Mhlanga', 'Tshuma',
  'Masuku', 'Mlambo', 'Mutasa', 'Chigumba', 'Marufu', 'Mapfumo', 'Makoni', 'Zhou', 'Gumbo', 'Chuma', 'Banda',
  'Phiri', 'Mavhunga', 'Zvobgo', 'Chikwanha', 'Mudzingwa', 'Mugabe-Ncube', 'Hove', 'Mahlangu', 'Ndiweni', 'Bhebhe',
  'Sithole', 'Mazarura', 'Chiwenga', 'Mawere', 'Tembo', 'Rusike', 'Chari', 'Mangwende', 'Nyathi']
const GIVEN = ['Tendai', 'Nomsa', 'Farai', 'Thabo', 'Rudo', 'Blessing', 'Sipho', 'Chipo', 'Tatenda', 'Nokuthula',
  'Takudzwa', 'Lindiwe', 'Munyaradzi', 'Precious', 'Kudakwashe', 'Thandiwe', 'Tafadzwa', 'Busisiwe', 'Simba', 'Ruvimbo']
const TRADES = ['Midlands Hardware', 'Gweru Builders', 'Kopje Transport', 'Sunrise Logistics', 'Vungu Agro Supplies',
  'Hertford Properties', 'Chinhoyi Mining Services', 'Lilac Holdings', 'Nehosho Investments', 'Bhubesi Engineering']
const KINDS = ['(Pvt) Ltd', 'Trust', 'Cooperative']
const GROUPS = ['Family Trust', 'Burial Society', 'Housing Cooperative']

function person() {
  const initial = String.fromCharCode(65 + Math.floor(rand() * 26))
  const r = rand()
  const surname = pick(SURNAMES)
  if (r < 0.70) return { kind: 'person', name: `${surname}, ${initial}. (demo)`, short: `${pick(GIVEN)} ${surname}` }
  if (r < 0.85) {
    const i2 = String.fromCharCode(65 + Math.floor(rand() * 26))
    return { kind: 'person', name: `${surname}, ${initial}. and ${i2}. (demo)`, short: `${surname} household` }
  }
  if (r < 0.95) return { kind: 'company', name: `${pick(TRADES)} ${pick(KINDS)} (demo)`, short: 'company' }
  return { kind: 'company', name: `${surname} ${pick(GROUPS)} (demo)`, short: 'society' }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const ref = `DEMO-${township}`
  try {
    const auth = (await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")).rows[0]
    if (!auth) throw new Error('local authority VUNGU not found')
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.authority_id', $1, true)`, [String(auth.id)])

    // Take the earlier demo seed for this township out first, so a re-run is a clean redo.
    const stand = (sn) => `${township}-${sn}`
    await client.query(`DELETE FROM finance.rates_account WHERE account_no LIKE $1`, [`LA-${township}-%`])
    await client.query(`DELETE FROM finance.party WHERE reference LIKE $1`, [`${ref}-%`])
    await client.query(`DELETE FROM revenue_link.billing_status WHERE erp_account_no LIKE $1`, [`VRDC-${township}-%`])
    await client.query(`DELETE FROM revenue_link.account_link WHERE erp_account_no LIKE $1`, [`VRDC-${township}-%`])
    await client.query(`DELETE FROM spatial_planning.property WHERE stand_number LIKE $1`, [`${township}-%`]) // owners cascade
    if (remove) {
      await client.query('COMMIT')
      console.log(`Removed the demo owners and accounts for ${township}.`)
      return
    }
    if (process.env.DEMO_SEED_ENABLED !== 'true') throw new Error('set DEMO_SEED_ENABLED=true to seed demo data')

    const { rows: parcels } = await client.query(
      `SELECT parcel_id, stand_no, area_m2 FROM land.parcel
        WHERE township_code = $1 AND status = 'current' ORDER BY stand_no`, [township])
    if (!parcels.length) throw new Error(`no current stands for township ${township}; run the DXF import first`)

    // Owners: roughly one in eight holds more than one stand.
    const owners = []
    const ownerOf = new Map()
    for (const p of parcels) {
      let o
      if (owners.length && rand() < 0.12) o = owners[Math.floor(rand() * Math.min(owners.length, 400))]
      else { o = { ...person(), idx: owners.length, stands: 0 }; owners.push(o) }
      o.stands++
      ownerOf.set(p.parcel_id, o)
    }

    const partyId = new Map()
    for (const o of owners) {
      const phone = `+263 77 000 ${String(1000 + o.idx).slice(-4)}`
      const email = rand() < 0.35 ? `owner${o.idx}@example.co.zw` : null
      const addr = `P.O. Box ${100 + Math.floor(rand() * 900)}, Gweru`
      o.phone = phone; o.email = email; o.addr = addr
      const { rows } = await client.query(
        `INSERT INTO finance.party (authority_id, party_type, name, reference, contact_phone, contact_email, address_text, status)
         VALUES ($1, 'ratepayer', $2, $3, $4, $5, $6, 'active') RETURNING id`,
        [auth.id, o.name, `${ref}-${String(o.idx + 1).padStart(5, '0')}`, phone, email, addr])
      partyId.set(o.idx, rows[0].id)
    }

    let n = 0, arrears = 0
    for (const p of parcels) {
      const o = ownerOf.get(p.parcel_id)
      const aan = `VRDC-${township}-${p.stand_no}`
      const prop = (await client.query(
        `INSERT INTO spatial_planning.property (stand_number, suburb_ward, area_sqm, aan, street_address)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [stand(p.stand_no), township, p.area_m2, aan, `Stand ${p.stand_no}, ${township}, Gweru`])).rows[0]
      await client.query(
        `INSERT INTO spatial_planning.parcel_owner (property_id, name, role, postal_address, phone, email, since)
         VALUES ($1, $2, 'owner', $3, $4, $5, $6)`,
        [prop.id, o.name, o.addr, o.phone, o.email, `${2004 + Math.floor(rand() * 20)}-0${1 + Math.floor(rand() * 9)}-15`])
      await client.query(
        `INSERT INTO revenue_link.account_link (parcel_id, erp_account_no, link_type, verified_by)
         VALUES ($1, $2, 'rates', 'demo seed (fictitious owner)')`, [p.parcel_id, aan])
      const band = rand() < arrearsShare ? 'in_arrears' : 'current'
      if (band === 'in_arrears') arrears++
      await client.query(
        `INSERT INTO revenue_link.billing_status (erp_account_no, status_band, as_at) VALUES ($1, $2, now())`, [aan, band])
      await client.query(
        `INSERT INTO finance.rates_account (authority_id, account_no, parcel_id, party_id, erp_account_no, status, notes)
         VALUES ($1, $2, $3, $4, $5, 'active', 'demo seed (fictitious owner)')`,
        [auth.id, `LA-${township}-${p.stand_no}`, p.parcel_id, partyId.get(o.idx), aan])
      n++
    }
    await client.query('COMMIT')
    const multi = owners.filter((o) => o.stands > 1).length
    console.log(`Seeded ${owners.length} fictitious owners over ${n} ${township} stands (${multi} hold more than one).`)
    console.log(`Balance band: ${n - arrears} current, ${arrears} in arrears.`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
