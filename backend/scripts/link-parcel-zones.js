#!/usr/bin/env node
/**
 * Link every parcel to the zone(s) that govern it (parcel_zoning), for every layer: land.parcel, vungu_parcels, stands.
 *
 *   node scripts/link-parcel-zones.js
 *
 * Migration 225 keeps the link current as parcels and zones change; run this after a bulk load, or once on an existing database.
 * About 20 seconds for 2,300 parcels. Safe to repeat: the intersection rows are re-cached, a person's manual assignment is never
 * touched. A parcel inside no zone polygon is reported as unzoned: it has no row, and is never read as "permitted".
 */
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Pool } = require('pg')

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('SET statement_timeout = 0')
    const started = Date.now()
    const { rows } = await client.query('SELECT * FROM refresh_all_parcel_zoning()')
    for (const r of rows) console.log(`${r.parcel_layer.padEnd(14)} parcels ${String(r.parcels).padStart(5)}  linked ${String(r.linked).padStart(5)}  unzoned ${String(r.unzoned).padStart(4)}`)
    const { rows: [t] } = await client.query(
      "SELECT count(*) AS rows, count(*) FILTER (WHERE method = 'manual') AS manual FROM parcel_zoning")
    console.log(`parcel_zoning: ${t.rows} rows (${t.manual} manual) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  } finally {
    client.release()
    await pool.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
