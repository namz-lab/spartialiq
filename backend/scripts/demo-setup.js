#!/usr/bin/env node
/**
 * Builds a working demonstration from an empty PostGIS database, in one command:
 *
 *   npm run demo:setup
 *   npm run demo:setup -- --township-dxf "C:/path/combined hertfordshire.dxf" --township HERTS
 *
 * Steps, each of which can be run on its own:
 *   1. migrations            node scripts/migrate.js            the schema, permissions, finance, tenancy
 *   2. master-plan layers    node scripts/load-master-plan.js   farm cadastre and zones, parcel register
 *   3. demo data             node scripts/seed-all-demo.js      accounts and a populated desk for each role
 *   4. (optional) a township node scripts/import-township-dxf.js + seed-township-owners.js
 *
 * Needs DATABASE_URL (backend/.env) pointing at a PostGIS database, and for step 2 ogr2ogr (native,
 * $OGR2OGR, or the ghcr.io/osgeo/gdal Docker image). --skip-spatial leaves step 2 out.
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

function step(title, script, args = [], env = {}) {
  console.log(`\n── ${title} ──`)
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: 'inherit', env: { ...process.env, DEMO_SEED_ENABLED: 'true', ...env },
  })
  if (r.status !== 0) fail(`\nStopped: "${title}" failed (${script} exited ${r.status}).`)
}

step('1/4 Migrations', 'migrate.js')
if (has('skip-spatial')) console.log('\n── 2/4 Master-plan layers: skipped (--skip-spatial) ──')
else step('2/4 Master-plan layers and parcel register', 'load-master-plan.js')
step('3/4 Demo accounts and data', 'seed-all-demo.js')
if (dxf) {
  step(`4/4 Township ${township}: stands from the DXF`, 'import-township-dxf.js', ['--dxf', dxf, '--township', township,
    '--report', path.join(os.tmpdir(), `${township.toLowerCase()}-import-report.csv`)])
  step(`4/4 Township ${township}: demonstration owners`, 'seed-township-owners.js', ['--township', township])
} else {
  console.log('\n── 4/4 Township: skipped (give --township-dxf <file> --township <CODE> to add one) ──')
}

console.log('\nDone. Start the API (npm start) and the portal (cd ../frontend && npm run dev); sign in with any demo.* account, password demo1234.')
