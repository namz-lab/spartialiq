/**
 * Load a vector file into PostGIS with ogr2ogr: the native binary if there is one ($OGR2OGR or on PATH),
 * otherwise the ghcr.io/osgeo/gdal Docker image, which reaches a database on this machine through
 * host.docker.internal. Shared by the scripts that import spatial files.
 */
'use strict'
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

function nativeOgr() {
  const exe = process.env.OGR2OGR || 'ogr2ogr'
  return spawnSync(exe, ['--version'], { encoding: 'utf8' }).status === 0 ? exe : null
}

/**
 * @param {string} databaseUrl  postgresql://user:pass@host:port/db
 * @param {string} file         path to the vector file
 * @param {{layer?: string, table: string, where?: string, args?: string[]}} opts
 *        `table` is schema-qualified (scratch.ward_import). `where` is an OGR SQL filter and must be built
 *        from validated values only.
 */
function loadFile(databaseUrl, file, { layer, table, where, args = [] }) {
  const db = new URL(databaseUrl)
  const pg = (host) => `PG:host=${host} port=${db.port || 5432} dbname=${db.pathname.slice(1)} ` +
    `user=${decodeURIComponent(db.username)} password=${decodeURIComponent(db.password)}`
  const opts = ['-nln', table, '-lco', 'GEOMETRY_NAME=geom', '-lco', 'FID=fid', '-lco', 'LAUNDER=YES',
    '-nlt', 'PROMOTE_TO_MULTI', '-t_srs', 'EPSG:4326', '-overwrite', ...args]
  if (where) opts.push('-where', where)
  const tail = layer ? [layer] : []

  const native = nativeOgr()
  if (native) {
    execFileSync(native, ['-f', 'PostgreSQL', pg(db.hostname), file, ...tail, ...opts], { stdio: 'inherit' })
    return 'ogr2ogr'
  }
  const host = ['localhost', '127.0.0.1', '::1'].includes(db.hostname) ? 'host.docker.internal' : db.hostname
  const dir = path.dirname(path.resolve(file))
  execFileSync('docker', ['run', '--rm', '-v', `${dir}:/in:ro`, 'ghcr.io/osgeo/gdal:alpine-small-latest',
    'ogr2ogr', '-f', 'PostgreSQL', pg(host), `/in/${path.basename(file)}`, ...tail, ...opts],
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  return 'ogr2ogr in Docker'
}

module.exports = { loadFile, nativeOgr }
