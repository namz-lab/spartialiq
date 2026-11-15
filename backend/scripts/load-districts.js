#!/usr/bin/env node
/**
 * Load Zimbabwe's district boundaries (ADM2) into public.districts, from the OCHA COD-AB districts file.
 *
 *   node scripts/load-districts.js --file districts.geojson            dry run: validate and report, write nothing
 *   node scripts/load-districts.js --file districts.geojson --apply    replace the district rows (level 2), in one transaction
 *
 * The file is a GeoJSON FeatureCollection (CRS84) with ADM2_EN (name), ADM2_PCODE and ADM1_PCODE (the province's code). The table
 * is national reference data: the district a point falls in is what the parcel-location lookup and the inspector's maps name.
 * Only level-2 rows are replaced. The file is large (about 16 MB) and is not kept in the repository.
 */
const fs = require('node:fs')
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Client } = require('pg')

const args = process.argv.slice(2)
const KNOWN = new Set(['--file', '--apply'])
const bad = args.filter((a) => a.startsWith('--') && !KNOWN.has(a))
if (bad.length) { console.error(`Unknown option(s): ${bad.join(' ')}\nUsage: --file <districts.geojson> [--apply]`); process.exit(2) }
const fi = args.indexOf('--file')
const file = fi === -1 ? null : args[fi + 1]
if (!file || !fs.existsSync(file)) { console.error('Give --file <districts.geojson> (the file must exist).'); process.exit(2) }
const apply = args.includes('--apply')

async function main() {
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('Not a GeoJSON FeatureCollection.')
  const problems = []
  const rows = fc.features.map((f, i) => {
    const p = f.properties || {}
    if (!p.ADM2_EN || !p.ADM2_PCODE) problems.push(`feature ${i}: ADM2_EN and ADM2_PCODE are required`)
    if (!f.geometry || !/Polygon/.test(f.geometry.type)) problems.push(`feature ${i} (${p.ADM2_EN}): no polygon geometry`)
    return { name: p.ADM2_EN, pcode: p.ADM2_PCODE, parent: p.ADM1_PCODE || null, geometry: JSON.stringify(f.geometry) }
  })
  const pcodes = rows.map((r) => r.pcode)
  if (new Set(pcodes).size !== pcodes.length) problems.push('district codes are not unique')
  if (problems.length) { console.error(problems.slice(0, 10).join('\n')); throw new Error(`${problems.length} problem(s); nothing written`) }
  console.log(`${path.basename(file)}: ${rows.length} districts, ${new Set(rows.map((r) => r.parent)).size} provinces.`)

  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query('SET statement_timeout = 0')
    await db.query('BEGIN')
    const { rowCount: removed } = await db.query('DELETE FROM public.districts WHERE level = 2')
    for (const r of rows) {
      await db.query(
        `INSERT INTO public.districts (geom, pcode, name_en, parent_pcode, level)
         VALUES (ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)), 3)), $2, $3, $4, 2)`,
        [r.geometry, r.pcode, r.name, r.parent])
    }
    const { rows: [chk] } = await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom))::int AS bad,
              (SELECT name_en FROM public.districts WHERE level = 2 AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(29.39, -19.29), 4326)) LIMIT 1) AS at_vungu
         FROM public.districts WHERE level = 2`)
    console.log(`replaced ${removed} rows with ${chk.n}; ${chk.bad} invalid or empty; a point in Vungu RDC falls in: ${chk.at_vungu || 'no district'}`)
    if (chk.bad || chk.n !== rows.length) throw new Error('check failed; nothing written')
    if (apply) { await db.query('COMMIT'); console.log('APPLIED') } else { await db.query('ROLLBACK'); console.log('Dry run: rolled back. Add --apply to keep it.') }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await db.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
