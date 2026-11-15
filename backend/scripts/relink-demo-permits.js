#!/usr/bin/env node
/**
 * Link the demonstration applications to real stands of the register, and lodge them under the plan.
 *
 *   node scripts/relink-demo-permits.js            do it (idempotent: an application already linked is left alone)
 *   node scripts/relink-demo-permits.js --list     show what would change, write nothing
 *
 * The demonstration applications were seeded with stand numbers of the demo stands that migration 228 dropped (4521, 1187, ST-0020 ...), so none could be
 * matched to a parcel and none carried a rule snapshot. Each application that was never lodged (parcel_match is null) is pointed at the next stand of the
 * register (the first township's stands, in number order), and spatial_planning.relodge_permit_zoning() links the parcel and records the plan's zones as
 * they stand. No land use is assessed and no decision is touched: the applications keep their status. Applications that were lodged (even unmatched, such as the
 * smoke-test fixtures) are not changed.
 */
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Client } = require('pg')

async function main() {
  const listOnly = process.argv.includes('--list')
  const bad = process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--list')
  if (bad.length) { console.error(`Unknown option(s): ${bad.join(' ')}`); process.exit(2) }
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    const { rows: apps } = await db.query(
      `SELECT id, stand_number, status FROM spatial_planning.permit_application WHERE parcel_match IS NULL ORDER BY created_at, id`)
    const { rows: stands } = await db.query(
      `SELECT p.stand_no, p.township_code AS township
         FROM land.parcel p
        WHERE p.parcel_kind = 'stand' AND p.status = 'current' AND p.valid_to IS NULL
          AND p.township_code = (SELECT township_code FROM land.parcel WHERE parcel_kind = 'stand' AND status = 'current' ORDER BY township_code LIMIT 1)
        ORDER BY (p.stand_no ~ '^[0-9]+$') DESC, CASE WHEN p.stand_no ~ '^[0-9]+$' THEN p.stand_no::int END, p.stand_no
        LIMIT $1`, [Math.max(apps.length, 1)])
    if (!apps.length) { console.log('No application is waiting to be lodged.'); return }
    if (stands.length < apps.length) { console.log(`The register has only ${stands.length} stand(s) for ${apps.length} application(s): nothing changed.`); return }

    let linked = 0
    for (const [i, a] of apps.entries()) {
      const stand = stands[i]
      console.log(`${a.stand_number} (${a.status}) -> stand ${stand.stand_no}`)
      if (listOnly) continue
      await db.query('UPDATE spatial_planning.permit_application SET stand_number = $2, suburb_ward = $3 WHERE id = $1', [a.id, stand.stand_no, stand.township])
      const { rows: [r] } = await db.query('SELECT spatial_planning.relodge_permit_zoning($1) AS match', [a.id])
      if (r.match === 'matched') linked++
    }
    console.log(listOnly ? 'Dry run: nothing written.' : `${linked} of ${apps.length} application(s) linked to a stand and lodged under the plan.`)
  } finally {
    await db.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
