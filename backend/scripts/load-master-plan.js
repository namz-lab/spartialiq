#!/usr/bin/env node
/**
 * Loads the Vungu master-plan layers (data/spatial/Vungu_RDC_Master_Plan.gpkg) and fills the parcel
 * register from them. This is the part of scripts/setup-spatial.mjs that a demonstration needs,
 * without the 1.5 GB national basemap and without psql: it needs only Node, DATABASE_URL and
 * ogr2ogr (native, $OGR2OGR, or the ghcr.io/osgeo/gdal Docker image).
 *
 *   node scripts/load-master-plan.js [--gpkg path/to/file.gpkg]
 *
 * It runs after the migrations, and does what the migrations cannot do on their own:
 *   1. imports the six layers into public.vungu_*  (EPSG:4326, the same table names the
 *      migrations and routes expect)
 *   2. gives the API's roles read access to them (they are created after the migrations that
 *      grant on the schema, so nothing else does)
 *   3. runs migration 187 again. On a fresh database it ran before these tables existed and so
 *      filled no farm parcels; it is idempotent and fills them now, with the council set for the
 *      session as the tenancy rules require.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { Client } = require('pg')

const GPKG = (() => {
  const i = process.argv.indexOf('--gpkg')
  return i > -1 ? process.argv[i + 1] : path.join(__dirname, '..', '..', 'data', 'spatial', 'Vungu_RDC_Master_Plan.gpkg')
})()

// source layer -> table, the same list as setup-spatial.mjs
const LAYERS = [
  ['Cemetery', 'vungu_cemeteries'],
  ['Waste management', 'vungu_waste_management'],
  ['Zim_national_farm_cadastre_wgs_84', 'vungu_farm_cadastre'],
  ['parcels', 'vungu_parcels'],
  ['proposed_peri_urban_zones', 'vungu_proposed_peri_urban_zones'],
  ['beyond_peri_urban_zones', 'vungu_beyond_peri_urban_zones'],
]

function fail(msg) { console.error(msg); process.exit(1) }

if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set')
if (!fs.existsSync(GPKG) || fs.statSync(GPKG).size < 1024) {
  fail(`Master-plan GeoPackage not found (or not pulled with git lfs): ${GPKG}`)
}

const db = new URL(process.env.DATABASE_URL)
const nativeOgr = (() => {
  const exe = process.env.OGR2OGR || 'ogr2ogr'
  return spawnSync(exe, ['--version'], { encoding: 'utf8' }).status === 0 ? exe : null
})()

function importLayer(srcLayer, table) {
  const pg = (host) => `PG:host=${host} port=${db.port || 5432} dbname=${db.pathname.slice(1)} ` +
    `user=${decodeURIComponent(db.username)} password=${decodeURIComponent(db.password)}`
  const opts = ['-nln', `public.${table}`, '-lco', 'GEOMETRY_NAME=geom', '-lco', 'FID=fid', '-lco', 'LAUNDER=YES',
    '-nlt', 'PROMOTE_TO_MULTI', '-t_srs', 'EPSG:4326', '-overwrite']
  if (nativeOgr) {
    execFileSync(nativeOgr, ['-f', 'PostgreSQL', pg(db.hostname), GPKG, srcLayer, ...opts], { stdio: 'inherit' })
    return
  }
  // Docker fallback: the container reaches the host's database through host.docker.internal.
  const host = ['localhost', '127.0.0.1', '::1'].includes(db.hostname) ? 'host.docker.internal' : db.hostname
  const dir = path.dirname(path.resolve(GPKG))
  execFileSync('docker', ['run', '--rm', '-v', `${dir}:/in:ro`, 'ghcr.io/osgeo/gdal:alpine-small-latest',
    'ogr2ogr', '-f', 'PostgreSQL', pg(host), `/in/${path.basename(GPKG)}`, srcLayer, ...opts],
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
}

async function main() {
  console.log(`Loading ${LAYERS.length} master-plan layers from ${path.basename(GPKG)} (${nativeOgr ? 'ogr2ogr' : 'ogr2ogr in Docker'}) ...`)
  for (const [src, table] of LAYERS) {
    process.stdout.write(`  ${src} -> ${table}\n`)
    importLayer(src, table)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    // 2. Read access for the roles the API runs as (they exist once migration 168 has run).
    const tables = LAYERS.map(([, t]) => `public.${t}`).join(', ')
    for (const role of ['vungu_app', 'vungu_system', 'vungu_runtime']) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
      if (rowCount) await client.query(`GRANT SELECT ON ${tables} TO ${role}`)
    }

    // 3. Migration 187 again, now that the layers exist, for the pilot council.
    const { rows } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
    if (!rows[0]) throw new Error("local authority 'VUNGU' not found; run the migrations first")
    // Migration 187 opens and commits its own transaction, so the council is set for the session.
    await client.query(`SELECT set_config('app.authority_id', $1, false)`, [String(rows[0].id)])
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '187_fill_parcel_register_and_rates.sql'), 'utf8'))
    const { rows: [n] } = await client.query("SELECT count(*)::int AS n FROM land.parcel WHERE status = 'current'")
    console.log(`Parcel register: ${n.n} current parcels.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => fail(e.message || String(e)))
