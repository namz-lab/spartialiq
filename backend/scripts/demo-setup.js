#!/usr/bin/env node
/**
 * Builds a working demonstration from an empty PostGIS database, in one command:
 *
 *   npm run demo:setup
 *   npm run demo:setup -- --wards "C:/path/vungu wards.gpkg"
 *   npm run demo:setup -- --wards <file> --township-dxf "C:/path/combined hertfordshire.dxf" --township HERTS
 *
 * Steps, each of which can be run on its own:
 *   1. migrations            node scripts/migrate.js                 the schema, permissions, finance, tenancy
 *   2. master-plan layers    node scripts/load-master-plan.js        farm cadastre and zones, parcel register
 *   3. (optional) wards      node scripts/load-wards.js              the council's wards, linked provisionally,
 *                            then scripts/load-reference-layers.js   polling areas (with voters), chiefdoms, centres, rivers
 *   4. demo data             node scripts/seed-all-demo.js           accounts and a populated desk for each role
 *   5. (optional) a township node scripts/import-township-dxf.js + seed-township-owners.js
 *   6. ward measures         node scripts/refresh-spatial-engine.js  the Chief Executive's ward maps
 *
 * Needs DATABASE_URL (backend/.env) pointing at a PostGIS database, and for steps 2 and 3 ogr2ogr (native,
 * $OGR2OGR, or the ghcr.io/osgeo/gdal Docker image). --skip-spatial leaves step 2 out. --wards takes the ward
 * boundary file the council supplies (COD-AB, ZIMSTAT, or its own); --wards-parent names the district code the
 * wards sit under (default ZW1704). Without --wards the ward maps say the wards are not loaded: nothing is drawn.
 * Demo accounts all use the password demo1234 (set DEMO_DEFAULT_PASSWORD to change it).
 *
 * This is demonstration data: it refuses to run in production or against a database that is not on
 * this machine (set ALLOW_REMOTE_DEMO=1 to override the second).
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const has = (name) => process.argv.includes(`--${name}`)
function fail(msg) { console.error(msg); process.exit(1) }

if (process.env.NODE_ENV === 'production') fail('Refusing to build demonstration data in production.')
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set (see backend/.env.example).')
const host = new URL(process.env.DATABASE_URL).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.ALLOW_REMOTE_DEMO !== '1') {
  fail(`Refusing to build demonstration data on ${host}. Set ALLOW_REMOTE_DEMO=1 if that is intended.`)
}

const dxf = arg('township-dxf')
const township = arg('township')
if (dxf && !township) fail('--township-dxf needs --township <CODE> (for example HERTS).')
const wards = arg('wards')
const wardsParent = arg('wards-parent') || 'ZW1704'

function step(title, script, args = [], env = {}) {
  console.log(`\n── ${title} ──`)
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: 'inherit', env: { ...process.env, DEMO_SEED_ENABLED: 'true', ...env },
  })
  if (r.status !== 0) fail(`\nStopped: "${title}" failed (${script} exited ${r.status}).`)
}

step('1/6 Migrations', 'migrate.js')
if (has('skip-spatial')) console.log('\n── 2/6 Master-plan layers: skipped (--skip-spatial) ──')
else {
  step('2/6 Master-plan layers and parcel register', 'load-master-plan.js')
  // The council's zones (peri-urban and beyond) into the one zones table the plan model reads.
  step('2/6 Zones: peri-urban and beyond, under the Vungu plan', 'load-zones.js', ['--if-empty'])
  // A demonstration shows the draft plan's zones on the public map; the plan stays a draft (publish-zones-preview.js --off reverses it).
  step('2/6 Zones: public preview of the draft plan', 'publish-zones-preview.js', ['--on'])
  // Colour the zones by type, from the council GIS's QGIS styles, through the GIS symbology registry.
  step('2/6 Zones: colours by type', 'publish-zone-styles.js')
}
if (wards) {
  step('3/6 Wards, linked provisionally', 'load-wards.js', ['--file', wards, '--parent', wardsParent])
  // Polling areas place into the wards just loaded, and give each its registered voters (a denominator, not population).
  step('3/6 Reference layers: polling areas, chiefdoms, business centres, rivers', 'load-reference-layers.js')
}
else console.log('\n── 3/6 Wards: skipped (give --wards <file> to load the council\'s ward boundaries) ──')
step('4/6 Demo accounts and data', 'seed-all-demo.js')
if (dxf) {
  step(`5/6 Township ${township}: stands from the DXF`, 'import-township-dxf.js', ['--dxf', dxf, '--township', township,
    '--report', path.join(os.tmpdir(), `${township.toLowerCase()}-import-report.csv`)])
  step(`5/6 Township ${township}: demonstration owners`, 'seed-township-owners.js', ['--township', township])
} else {
  console.log('\n── 5/6 Township: skipped (give --township-dxf <file> --township <CODE> to add one) ──')
}
// Last, so the measures see everything above: the parcels, the stands, the water points and the finance lines.
step('6/6 Ward measures for the Chief Executive\'s maps', 'refresh-spatial-engine.js')

console.log('\nDone. Start the API (npm start) and the portal (cd ../frontend && npm run dev); sign in with any demo.* account, password demo1234.')
