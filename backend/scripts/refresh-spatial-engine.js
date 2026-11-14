#!/usr/bin/env node
/**
 * Recomputes the spatial engine's ward measures for one council and prints what it found.
 *
 *   node scripts/refresh-spatial-engine.js [--authority VUNGU]
 *
 * Runs spatial_engine.refresh() (migration 215) with the council set for the session, as every request has it.
 * With no ward register linked it computes nothing and says so; load wards first (scripts/load-wards.js).
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { Client } = require('pg')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const fail = (msg) => { console.error(msg); process.exit(1) }

const authorityCode = arg('authority', 'VUNGU')
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set')
if (!/^[A-Z0-9_]{2,16}$/.test(authorityCode)) fail('--authority must be an authority code such as VUNGU')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows: [auth] } = await client.query('SELECT id FROM public.local_authorities WHERE code = $1', [authorityCode])
    if (!auth) throw new Error(`local authority ${authorityCode} not found`)
    await client.query(`SELECT set_config('app.authority_id', $1, false)`, [String(auth.id)])

    const { rows: [r] } = await client.query('SELECT spatial_engine.refresh() AS run_id')
    const { rows: [run] } = await client.query(
      'SELECT status, wards, ward_register_basis, detail FROM spatial_engine.run WHERE id = $1', [r.run_id])

    if (!run.wards) {
      console.log('No wards are linked to this council, so no ward measure was computed. Load them with scripts/load-wards.js.')
      return
    }
    console.log(`Spatial engine: ${run.status}; ${run.wards} wards (register basis: ${run.ward_register_basis}).`)
    for (const [key, d] of Object.entries(run.detail)) {
      console.log(`  ${key.padEnd(26)} facts ${String(d.facts).padStart(6)}   placed ${String(d.placed).padStart(6)}   unlocated ${String(d.unlocated).padStart(6)}`)
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => fail(e.message || String(e)))
