#!/usr/bin/env node
/**
 * Loads ward boundaries and links a council's wards to it, provisionally.
 *
 *   node scripts/load-wards.js --file path/to/wards.gpkg [--layer name] [--parent ZW1704]
 *        [--code-field ADM3_PCODE] [--name-field ADM3_EN] [--parent-field ADM2_PCODE]
 *        [--source "COD-AB"] [--delimitation "pre-2023 (COD-AB)"] [--authority VUNGU]
 *
 * The file is whatever the council supplies: OCHA's COD-AB set, ZIMSTAT's 2022 boundaries, or its own. The
 * field names default to COD-AB's. Wards whose parent code equals --parent (the district) are written to
 * admin.ward, then linked to the authority in admin.authority_ward as basis 'interim', exactly as migration 201
 * does on a database that already has the national register: decision D11 (the Council's official ward list)
 * stays OPEN, the rows are not evidence of a Council act, and every surface that names them says provisional.
 *
 * Needs DATABASE_URL and ogr2ogr (native, $OGR2OGR, or the ghcr.io/osgeo/gdal Docker image). Re-running is
 * safe: a ward is updated in place and an existing live membership is left as it is. Replacing the list with
 * the confirmed one later is a migration (see 201's header); no feature code changes.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const fs = require('node:fs')
const { Client } = require('pg')
const { loadFile } = require('./lib/ogr')

// Must match migration 201 exactly: it is the handle a confirming migration greps for.
const INSTRUMENT = 'PROVISIONAL-D11-2026-11-09: provisional ward list for Vungu RDC, '
  + 'loaded from the COD-AB national register (district ZW1704) on owner '
  + 'direction of 2026-11-09. UNCONFIRMED — pending a Council resolution and '
  + 'the delimitation instrument. Not evidence of a Council act.'
const VALID_FROM = '2026-11-09'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const fail = (msg) => { console.error(msg); process.exit(1) }

const file = arg('file')
const layer = arg('layer')
const parent = arg('parent', 'ZW1704')
const codeField = arg('code-field', 'ADM3_PCODE')
const nameField = arg('name-field', 'ADM3_EN')
const parentField = arg('parent-field', 'ADM2_PCODE')
const source = arg('source', 'COD-AB')
const delimitation = arg('delimitation', 'pre-2023 (COD-AB)')
const authorityCode = arg('authority', 'VUNGU')

if (!file) fail('Usage: node scripts/load-wards.js --file <wards file> [--layer name] [--parent ZW1704] [--authority VUNGU]')
if (!fs.existsSync(file)) fail(`Ward file not found: ${file}`)
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set')
if (!/^[A-Z0-9]{3,12}$/.test(parent)) fail('--parent must be a district code such as ZW1704')
for (const [name, v] of [['code-field', codeField], ['name-field', nameField], ['parent-field', parentField]]) {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(v)) fail(`--${name} must be a plain column name`)
}
if (!/^[A-Z0-9_]{2,16}$/.test(authorityCode)) fail('--authority must be an authority code such as VUNGU')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS scratch')
    console.log(`Loading ${file} (wards under ${parent}) ...`)
    // ogr2ogr lower-cases column names (LAUNDER), so the filter and the SQL below use lower-case names.
    const how = loadFile(process.env.DATABASE_URL, file, {
      layer, table: 'scratch.ward_import', where: `${parentField} = '${parent}'`,
    })
    console.log(`  read with ${how}`)

    // A file that yields no wards under the parent is a wrong --parent or field name, not an empty district:
    // stop here rather than report success and leave the council with no wards.
    const { rows: [found] } = await client.query('SELECT count(*)::int AS n FROM scratch.ward_import')
    if (found.n === 0) {
      throw new Error(`No features in the file have ${parentField} = '${parent}'. Check --parent (the district code), ` +
        '--parent-field, and --layer if the file has more than one layer.')
    }
    console.log(`  ${found.n} ward features under ${parent}`)

    const cols = { code: codeField.toLowerCase(), name: nameField.toLowerCase(), parent: parentField.toLowerCase() }
    await client.query('BEGIN')
    const loaded = await client.query(
      `INSERT INTO admin.ward (ward_code, name, source, parent_pcode, delimitation, geom)
       SELECT btrim(${cols.code}::text), btrim(${cols.name}::text), $1, btrim(${cols.parent}::text), $2,
              ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
         FROM scratch.ward_import
        WHERE ${cols.code} IS NOT NULL AND geom IS NOT NULL
       ON CONFLICT (ward_code) DO UPDATE
         SET name = EXCLUDED.name, source = EXCLUDED.source, parent_pcode = EXCLUDED.parent_pcode,
             delimitation = EXCLUDED.delimitation, geom = EXCLUDED.geom`, [source, delimitation])

    const { rows: [auth] } = await client.query('SELECT id FROM public.local_authorities WHERE code = $1', [authorityCode])
    if (!auth) throw new Error(`local authority ${authorityCode} not found; run the migrations first`)
    // Same rule as migration 201: a ward that already has a live membership (to any authority) is left alone.
    const linked = await client.query(
      `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, valid_to, basis, instrument_ref, note)
       SELECT $1, w.ward_code, $2::date, NULL, 'interim', $3,
              'Provisional: COD-AB district ' || $4 || ' ward list, unconfirmed by Council.'
         FROM admin.ward w
        WHERE w.parent_pcode = $4
          AND NOT EXISTS (SELECT 1 FROM admin.authority_ward aw WHERE aw.ward_code = w.ward_code AND aw.valid_to IS NULL)
       ON CONFLICT (authority_id, ward_code, valid_from) DO NOTHING`, [auth.id, VALID_FROM, INSTRUMENT, parent])
    const { rows: [live] } = await client.query(
      'SELECT count(*)::int AS n FROM admin.authority_ward WHERE authority_id = $1 AND valid_to IS NULL', [auth.id])
    await client.query('COMMIT')

    console.log(`\nWards written to admin.ward : ${loaded.rowCount}`)
    console.log(`Newly linked to ${authorityCode}      : ${linked.rowCount} (basis interim, provisional)`)
    console.log(`Live memberships for ${authorityCode}  : ${live.n}`)
    if (live.n !== 19) console.log('Note: Vungu RDC has 19 wards on its website; check the file and --parent if that is not what you expected.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((e) => fail(e.message || String(e)))
