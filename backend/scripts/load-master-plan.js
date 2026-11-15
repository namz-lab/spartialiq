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
 *   1. imports the layers (EPSG:4326): the farm cadastre into public.vungu_farm_cadastre, the farm parcels through a staging
 *      table into the parcel register (land.parcel, kind farm; public.vungu_parcels is a view since migration 227), and the council's
 *      cemetery and waste sites through a staging table into council_ops.cemetery / waste_facility (their
 *      convention names, migration 220; the old names are views, which ogr2ogr -overwrite cannot replace).
 *      The zones are not loaded here: scripts/load-zones.js fills spatial_planning.zone from the council's files.
 *   2. gives the API's roles read access to them (they are created after the migrations that
 *      grant on the schema, so nothing else does)
 *   3. runs migration 187 again. On a fresh database it ran before these tables existed and so
 *      filled no farm parcels; it is idempotent and fills them now, with the council set for the
 *      session as the tenancy rules require.
 *   4. loads the staged farm parcels into land.parcel with scripts/load-parcels-into-land.js (repeat-safe: it finds a parcel by its source row).
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

// source layer -> public table, as in setup-spatial.mjs
const LAYERS = [
  ['Zim_national_farm_cadastre_wgs_84', 'vungu_farm_cadastre'],
]

// the farm parcels: staged here, loaded into land.parcel by scripts/load-parcels-into-land.js (public.vungu_parcels is a view over the register)
const FARM_PARCELS = ['parcels', 'scratch.vungu_parcels']

// source layer -> the council_ops table it fills (staged in scratch, then copied: TRUNCATE + INSERT of the shared columns)
const COUNCIL_OPS = [
  ['Cemetery', 'council_ops.cemetery'],
  ['Waste management', 'council_ops.waste_facility'],
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

function importLayer(srcLayer, qualifiedTable) {
  const pg = (host) => `PG:host=${host} port=${db.port || 5432} dbname=${db.pathname.slice(1)} ` +
    `user=${decodeURIComponent(db.username)} password=${decodeURIComponent(db.password)}`
  const opts = ['-nln', qualifiedTable, '-lco', 'GEOMETRY_NAME=geom', '-lco', 'FID=fid', '-lco', 'LAUNDER=YES',
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
  console.log(`Loading ${LAYERS.length + COUNCIL_OPS.length + 1} master-plan layers from ${path.basename(GPKG)} (${nativeOgr ? 'ogr2ogr' : 'ogr2ogr in Docker'}) ...`)
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS scratch')
    for (const [src, table] of LAYERS) {
      process.stdout.write(`  ${src} -> ${table}
`)
      importLayer(src, `public.${table}`)
    }
    process.stdout.write(`  ${FARM_PARCELS[0]} -> ${FARM_PARCELS[1]} (staged; loaded into land.parcel below)
`)
    importLayer(FARM_PARCELS[0], FARM_PARCELS[1])
    for (const [src, target] of COUNCIL_OPS) {
      const staging = `scratch.master_plan_${target.split('.')[1]}`
      process.stdout.write(`  ${src} -> ${target} (via ${staging})
`)
      importLayer(src, staging)
      // Copy the columns both tables have; a target column the file lacks keeps its default.
      const { rows: cols } = await client.query(
        `SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
            AND EXISTS (SELECT 1 FROM pg_attribute b WHERE b.attrelid = $2::regclass AND b.attnum > 0 AND NOT b.attisdropped AND b.attname = a.attname)`,
        [target, staging])
      const list = cols.map((c) => `"${c.attname}"`).join(', ')
      await client.query(`TRUNCATE ${target}`)
      await client.query(`INSERT INTO ${target} (${list}) SELECT ${list} FROM ${staging}`)
      await client.query(`DROP TABLE ${staging}`)
    }

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
    execFileSync(process.execPath, [path.join(__dirname, 'load-parcels-into-land.js'), '--apply', '--source', FARM_PARCELS[1]], { stdio: 'inherit' })
    const { rows: [m] } = await client.query("SELECT count(*)::int AS n FROM land.parcel WHERE status = 'current'")
    console.log(`Parcel register: ${m.n} current parcels.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => fail(e.message || String(e)))
