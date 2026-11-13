#!/usr/bin/env node
// Imports stand parcels from a township general-plan DXF drawn in Lo29 coordinates.
//
//   node scripts/import-township-dxf.js --dxf "C:/path/combined hertfordshire.dxf" \
//        --township HERTS [--srid 2053] [--tol 0.1] [--max-stand-m2 20000] [--report out.csv]
//
// Needs DATABASE_URL (from backend/.env) and GDAL's ogr2ogr, found in this order:
//   $OGR2OGR, ogr2ogr on PATH, or the ghcr.io/osgeo/gdal Docker image.
// The database must be PostGIS with the land.* register (migrations 132 and later).
//
// What it does is described at the top of import-township-dxf.sql. In short: block outlines
// are built from the drawing's lines; a block with one stand number is that stand; a block with
// several is cut into one cell per number and marked accuracy_basis 'estimated'.
// Re-running is safe: stands already current under the township code are skipped.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { Client } = require('pg')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const dxf = arg('dxf')
const township = arg('township')
const srid = Number(arg('srid', 2053)) // 2053 = Hartebeesthoek94 / Lo29
const tol = Number(arg('tol', 0.1))
const maxStand = Number(arg('max-stand-m2', 20000))
const report = arg('report', path.join(process.cwd(), `${(township || 'township').toLowerCase()}-import-report.csv`))

if (!dxf || !township) {
  console.error('Usage: node scripts/import-township-dxf.js --dxf <file.dxf> --township <CODE> [--srid 2053] [--tol 0.1] [--max-stand-m2 20000] [--report out.csv]')
  process.exit(1)
}
if (!/^[A-Z0-9_-]{2,16}$/.test(township)) throw new Error('--township must be 2-16 chars of A-Z, 0-9, _ or -')
if (![2053, 22289].includes(srid)) throw new Error('--srid must be 2053 (Hartebeesthoek94 Lo29) or 22289 (Cape Lo29)')
if (!fs.existsSync(dxf)) throw new Error(`DXF not found: ${dxf}`)
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

const dbUrl = new URL(process.env.DATABASE_URL)
const sgRef = `DXF-${township}`
const source = `dxf:${path.basename(dxf)}`

function hasNativeOgr() {
  const exe = process.env.OGR2OGR || 'ogr2ogr'
  const r = spawnSync(exe, ['--version'], { encoding: 'utf8' })
  return r.status === 0 ? exe : null
}

function loadDxf() {
  const pg = `PG:host=${process.env.PGHOST_FOR_OGR || dbUrl.hostname} port=${dbUrl.port || 5432} dbname=${dbUrl.pathname.slice(1)} user=${decodeURIComponent(dbUrl.username)} password=${decodeURIComponent(dbUrl.password)}`
  const common = ['-f', 'PostgreSQL', null, null, '-nln', 'scratch.township_dxf_raw', '-lco', 'GEOMETRY_NAME=geom', '-lco', 'FID=fid', '-overwrite']
  const native = hasNativeOgr()
  if (native) {
    const args = [...common]
    args[2] = pg; args[3] = dxf
    execFileSync(native, args, { stdio: 'inherit' })
    return
  }
  // Docker fallback: the container reaches the host database through host.docker.internal.
  const dir = path.dirname(path.resolve(dxf))
  const args = ['run', '--rm', '-v', `${dir}:/in:ro`, 'ghcr.io/osgeo/gdal:alpine-small-latest', 'ogr2ogr', ...common]
  args[args.indexOf(null)] = pg.replace(/host=(localhost|127\.0\.0\.1)/, 'host=host.docker.internal')
  args[args.indexOf(null)] = `/in/${path.basename(dxf)}`
  execFileSync('docker', args, { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS scratch')
    console.log(`Loading ${dxf} ...`)
    loadDxf()

    console.log('Building blocks and stands ...')
    let sql = fs.readFileSync(path.join(__dirname, 'import-township-dxf.sql'), 'utf8')
    const vals = { township, sg_ref: sgRef, source, srid: String(srid), tol: String(tol), max_stand_m2: String(maxStand) }
    for (const [k, v] of Object.entries(vals)) sql = sql.replace(new RegExp(`(?<!:):${k}\\b`, 'g'), v)
    await client.query(sql)

    const q = async (text) => (await client.query(text)).rows
    const [t] = await q(`SELECT (SELECT count(*) FROM scratch.td_label) labels,
      (SELECT count(DISTINCT stand_no) FROM scratch.td_label) distinct_labels,
      (SELECT count(*) FROM scratch.td_face WHERE n >= 1) faces_with_labels,
      (SELECT count(*) FROM land.parcel WHERE township_code='${township}' AND source='${source}') inserted,
      (SELECT count(*) FROM land.parcel WHERE township_code='${township}' AND source='${source}' AND accuracy_basis='general_plan') closed,
      (SELECT count(*) FROM land.parcel WHERE township_code='${township}' AND source='${source}' AND accuracy_basis='estimated') estimated`)

    const missing = await q(`SELECT l.stand_no, 'no parcel created' AS note FROM scratch.td_label l
       WHERE NOT EXISTS (SELECT 1 FROM land.parcel p WHERE p.township_code='${township}' AND p.stand_no=l.stand_no AND p.status='current')
       ORDER BY 1`)
    const rows = await q(`SELECT stand_no, accuracy_basis, round(area_m2) AS area_m2, ward_code
       FROM land.parcel WHERE township_code='${township}' AND source='${source}' ORDER BY stand_no`)

    const csv = ['stand_no,result,accuracy_basis,area_m2,ward_code',
      ...rows.map(r => `${r.stand_no},imported,${r.accuracy_basis},${r.area_m2},${r.ward_code || ''}`),
      ...missing.map(r => `${r.stand_no},${r.note},,,`)].join('\n')
    fs.writeFileSync(report, csv)

    console.log('\n— Import summary —')
    console.log(`  stand labels in drawing : ${t.labels} (${t.distinct_labels} distinct)`)
    console.log(`  imported stands         : ${t.inserted}`)
    console.log(`    from a closed block   : ${t.closed}   (accuracy_basis general_plan)`)
    console.log(`    cut from a block      : ${t.estimated}   (accuracy_basis estimated)`)
    console.log(`  labels with no parcel   : ${missing.length}`)
    console.log(`  report                  : ${report}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
