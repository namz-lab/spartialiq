#!/usr/bin/env node
/**
 * Loads ward boundaries and links a council's wards to it, provisionally.
 *
 *   node scripts/load-wards.js --file path/to/wards.gpkg [--layer name] [--parent ZW1704]
 *        [--code-field ADM3_PCODE] [--name-field ADM3_EN] [--parent-field ADM2_PCODE]
 *        [--source "COD-AB"] [--delimitation "pre-2023 (COD-AB)"] [--authority VUNGU]
 *
 * A file with no ward code of its own, only a ward number (the ZEC delimitation files), is loaded by number:
 *
 *   node scripts/load-wards.js --file vungu_wards_zec_2023.geojson --number-field WARDNUMBER \
 *        --code-prefix ZEC23-VUNGU- --parent VUNGU --source "ZEC 2023 delimitation (council-supplied file)" \
 *        --delimitation "ZEC 2023" --instrument "PROVISIONAL-D11-...: ..." --valid-from 2026-11-14
 *
 * The code is the prefix plus the ward number padded to two digits (ZEC23-VUNGU-01), the name is the ward number,
 * and there is no parent filter (the file is the council's wards). The codes name their source on purpose: they
 * are not claimed to belong to a national code scheme.
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
const numberField = arg('number-field')
const codePrefix = arg('code-prefix', '')
// With a number field the parent is a label we give, so it must be named, not defaulted.
const parent = arg('parent', numberField ? null : 'ZW1704')
const codeField = arg('code-field', 'ADM3_PCODE')
const nameGiven = process.argv.includes('--name-field')
const nameField = arg('name-field', 'ADM3_EN')
// A by-number file has no parent column; 'none' says so explicitly for any file.
const parentFieldArg = arg('parent-field', numberField ? 'none' : 'ADM2_PCODE')
const parentField = parentFieldArg === 'none' ? null : parentFieldArg
const instrument = arg('instrument', INSTRUMENT)
const customInstrument = process.argv.includes('--instrument')
const validFrom = arg('valid-from', VALID_FROM)
const source = arg('source', 'COD-AB')
const delimitation = arg('delimitation', 'pre-2023 (COD-AB)')
const authorityCode = arg('authority', 'VUNGU')

if (!file) fail('Usage: node scripts/load-wards.js --file <wards file> [--layer name] [--parent ZW1704] [--authority VUNGU]')
if (!fs.existsSync(file)) fail(`Ward file not found: ${file}`)
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set')
if (!parent) fail('--parent is required with --number-field: the label the wards are filed under (for example VUNGU)')
if (!/^[A-Z0-9]{3,12}$/.test(parent)) fail('--parent must be a district or council code such as ZW1704 or VUNGU')
for (const [name, v] of [['code-field', codeField], ['name-field', nameField], ['parent-field', parentField], ['number-field', numberField]]) {
  if (v !== null && v !== undefined && !/^[A-Za-z0-9_]{1,40}$/.test(v)) fail(`--${name} must be a plain column name`)
}
if (numberField && !/^[A-Za-z0-9_-]{1,20}$/.test(codePrefix)) fail('--code-prefix is required with --number-field (for example ZEC23-VUNGU-)')
if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) fail('--valid-from must be a date, YYYY-MM-DD')
if (customInstrument && !/^PROVISIONAL-D11-/.test(instrument)) fail('--instrument must start with PROVISIONAL-D11-, the handle a confirming migration searches for')
if (!/^[A-Z0-9_]{2,16}$/.test(authorityCode)) fail('--authority must be an authority code such as VUNGU')

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS scratch')
    console.log(`Loading ${file} (wards filed under ${parent}) ...`)
    // ogr2ogr lower-cases column names (LAUNDER), so the filter and the SQL below use lower-case names.
    const how = loadFile(process.env.DATABASE_URL, file, {
      layer, table: 'scratch.ward_import', where: parentField ? `${parentField} = '${parent}'` : undefined,
    })
    console.log(`  read with ${how}`)

    // A file that yields no wards under the parent is a wrong --parent or field name, not an empty district:
    // stop here rather than report success and leave the council with no wards.
    const { rows: [found] } = await client.query('SELECT count(*)::int AS n FROM scratch.ward_import')
    if (found.n === 0) {
      throw new Error(parentField
        ? `No features in the file have ${parentField} = '${parent}'. Check --parent (the district code), --parent-field, and --layer if the file has more than one layer.`
        : 'The file has no features. Check the file and --layer.')
    }
    console.log(`  ${found.n} ward features`)

    // The code, the name and the parent, from the file's columns or, for a by-number file, built from the ward number.
    const n = numberField ? numberField.toLowerCase() : null
    const codeExpr = n ? `$3::text || lpad(btrim(${n}::text), 2, '0')` : `btrim(${codeField.toLowerCase()}::text)`
    const nameExpr = n && !nameGiven ? `btrim(${n}::text)` : `btrim(${nameField.toLowerCase()}::text)`
    const parentExpr = parentField ? `btrim(${parentField.toLowerCase()}::text)` : '$4::text'
    const present = n ?? codeField.toLowerCase()
    await client.query('BEGIN')
    const loaded = await client.query(
      `INSERT INTO admin.ward (ward_code, name, source, parent_pcode, delimitation, geom)
       SELECT ${codeExpr}, ${nameExpr}, $1, ${parentExpr}, $2,
              ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
         FROM scratch.ward_import
        WHERE ${present} IS NOT NULL AND geom IS NOT NULL
       ON CONFLICT (ward_code) DO UPDATE
         SET name = EXCLUDED.name, source = EXCLUDED.source, parent_pcode = EXCLUDED.parent_pcode,
             delimitation = EXCLUDED.delimitation, geom = EXCLUDED.geom`, [source, delimitation, codePrefix, parent])

    const { rows: [auth] } = await client.query('SELECT id FROM public.local_authorities WHERE code = $1', [authorityCode])
    if (!auth) throw new Error(`local authority ${authorityCode} not found; run the migrations first`)
    // Same rule as migration 201: a ward that already has a live membership (to any authority) is left alone.
    const linked = await client.query(
      `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, valid_to, basis, instrument_ref, note)
       SELECT $1, w.ward_code, $2::date, NULL, 'interim', $3,
              $5::text
         FROM admin.ward w
        WHERE w.parent_pcode = $4
          AND NOT EXISTS (SELECT 1 FROM admin.authority_ward aw WHERE aw.ward_code = w.ward_code AND aw.valid_to IS NULL)
       ON CONFLICT (authority_id, ward_code, valid_from) DO NOTHING`,
      [auth.id, validFrom, instrument, parent,
        customInstrument ? `Provisional: ${source}, unconfirmed by Council.` : `Provisional: COD-AB district ${parent} ward list, unconfirmed by Council.`])
    const { rows: [live] } = await client.query(
      'SELECT count(*)::int AS n FROM admin.authority_ward WHERE authority_id = $1 AND valid_to IS NULL', [auth.id])
    await client.query('COMMIT')

    console.log(`\nWards written to admin.ward : ${loaded.rowCount}`)
    console.log(`Newly linked to ${authorityCode}      : ${linked.rowCount} (basis interim, provisional)`)
    console.log(`Live memberships for ${authorityCode}  : ${live.n}`)
    if (live.n !== 19) console.log('Note: Vungu RDC has 19 wards on its website; check the file and --parent if that is not what you expected.')
    if (live.n > loaded.rowCount) console.log('Note: more wards are linked than this file wrote, so an earlier ward list may still be linked. Check with scripts/set-authority-wards.js --list.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((e) => fail(e.message || String(e)))
