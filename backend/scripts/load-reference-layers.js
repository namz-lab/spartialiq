#!/usr/bin/env node
/**
 * Loads Vungu's reference layers from data/reference/vungu/*.geojson (migration 218's tables), and the wards'
 * registered voters into the spatial engine as a denominator.
 *
 *   node scripts/load-reference-layers.js [--authority VUNGU] [--dir data/reference/vungu]
 *
 * Every row carries its source. Nothing is invented: a feature the file does not name stays NULL. Re-running is safe
 * (each layer is replaced from its file inside one transaction).
 *
 * The files were cut from:
 *   polling_areas, polling_stations  Electoral Commission, Midlands polling areas and stations (20 April 2023),
 *                                    the 115 whose LOCAL AUTH is VUNGU RDC.
 *   chiefdoms, business_centres, rivers  the earlier VunGIS legacy layer (app-backend/data/seed/gweru_legacy.sql),
 *                                    cut to Vungu: all five chiefdoms, business centres inside Vungu's wards, river
 *                                    lines that touch them (rivers with invalid coordinates in the source are left out).
 *
 *   roads, planning_boundary  the council's GIS (roads.geojson, planning_boundary.geojson, supplied 14 November 2026):
 *                                 roads -> basemap.road (all 1,207, with the road authority each is tagged with) and, for the
 *                                 1,059 tagged VUNGU, council_ops.road_asset (unverified: OpenStreetMap geometry, no surface or
 *                                 condition, none invented); planning_boundary -> admin.planning_boundary (as supplied: the
 *                                 Gweru Rural polygon, ZW1704, not the union of the wards).
 *
 * Voters become spatial_engine.ward_denominator rows of kind 'registered_voters' (as of 2023): the sum of the
 * polling areas whose point on surface lies in each of the council's current wards. Registered voters are adults on
 * the roll, not the population, and the source says so. A ward number that disagrees with the ward that holds the area
 * is reported and not loaded as a denominator.
 *
 * Needs the council's wards (scripts/load-wards.js) so polling areas can be placed; without them the layers still load
 * and no denominator is written.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const authorityCode = arg('authority', 'VUNGU')
const dir = path.resolve(arg('dir', path.join(__dirname, '..', 'data', 'reference', 'vungu')))

const ZEC = 'Zimbabwe Electoral Commission, Midlands polling areas and stations, file of 20 April 2023 (Vungu RDC rows)'
const LEGACY = 'Earlier VunGIS legacy layer (gweru_legacy.sql), cut to Vungu'
const ROADS = 'OpenStreetMap road centrelines, council-supplied roads.geojson (14 November 2026)'
const BOUNDARY = 'Council GIS planning_boundary.geojson (14 November 2026), as supplied'

const read = (name) => {
  const file = path.join(dir, `${name}.geojson`)
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8')).features
}
const geomSql = (kind) => ({
  MultiPolygon: 'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($G), 4326))',
  // A layer promoted to multi-geometry on export may hold a one-point MultiPoint: take its point.
  Point: 'ST_SetSRID(ST_GeometryN(ST_Multi(ST_GeomFromGeoJSON($G)), 1), 4326)',
  MultiLineString: 'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($G), 4326))',
})[kind]
const txt = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const int = (v) => (v === null || v === undefined || v === '' ? null : Number.parseInt(v, 10))

async function replaceLayer(db, table, columns, rows, geometry) {
  await db.query(`DELETE FROM ${table}`)
  const cols = [...columns, 'geom']
  const ph = columns.map((_, i) => `$${i + 1}`)
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph.join(', ')}, ${geomSql(geometry).replace('$G', `$${columns.length + 1}`)})`
  for (const r of rows) await db.query(sql, [...r.values, JSON.stringify(r.geometry)])
  return rows.length
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const report = {}
  try {
    const { rows: [auth] } = await db.query('SELECT id FROM public.local_authorities WHERE code = $1', [authorityCode])
    if (!auth) throw new Error(`No local authority ${authorityCode}.`)
    await db.query('BEGIN')
    await db.query(`SELECT set_config('app.authority_id', $1, true)`, [String(auth.id)])

    const feat = (f) => ({ p: f.properties ?? {}, geometry: f.geometry })

    report.chiefdoms = await replaceLayer(db, 'admin.chiefdom', ['chief', 'ward_number', 'local_authority', 'source'],
      read('chiefdoms').map(feat).map(({ p, geometry }) => ({ geometry, values: [txt(p.chief), int(p.ward_number), txt(p.local_authority), LEGACY] })), 'MultiPolygon')

    report.business_centres = await replaceLayer(db, 'admin.business_centre', ['sector', 'ward_number', 'village', 'source'],
      read('business_centres').map(feat).map(({ p, geometry }) => ({ geometry, values: [txt(p.sector), int(p.ward_number), txt(p.village), LEGACY] })), 'Point')

    report.rivers = await replaceLayer(db, 'admin.river', ['name', 'river_type', 'source'],
      read('rivers').map(feat).map(({ p, geometry }) => ({ geometry, values: [txt(p.name), txt(p.river_type), LEGACY] })), 'MultiLineString')

    report.polling_stations = await replaceLayer(db, 'admin.polling_station', ['polling_code', 'name', 'ward_number', 'voters', 'integrity', 'source'],
      read('polling_stations').map(feat).map(({ p, geometry }) => ({ geometry, values: [txt(p.polling_code), txt(p.name), int(p.ward_number), int(p.voters), txt(p.integrity), ZEC] })), 'Point')

    // ── The road network, and the council's own roads in its inventory ──
    const roads = read('roads').map(feat)
    const reverse = roads.filter((r) => r.p.oneway === 'T').length
    if (reverse) throw new Error(`${reverse} roads are one-way in the reverse direction; basemap.road keeps no direction, so nothing was loaded.`)
    await db.query('DELETE FROM basemap.road WHERE source = $1', [ROADS])
    for (const { p, geometry } of roads) {
      await db.query(
        `INSERT INTO basemap.road (source_id, source, class, name, ref, oneway, max_speed, layer, bridge, tunnel, road_authority, geom)
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7::int, 0), $8, $9, $10, $11, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($12), 4326)))`,
        [txt(p.osm_id), ROADS, txt(p.fclass), txt(p.name), txt(p.ref), p.oneway === null || p.oneway === undefined ? null : p.oneway === 'F',
          int(p.maxspeed), int(p.layer), p.bridge === null || p.bridge === undefined ? null : p.bridge === 'T',
          p.tunnel === null || p.tunnel === undefined ? null : p.tunnel === 'T', txt(p.authority), JSON.stringify(geometry)])
    }
    report.roads = roads.length

    // The council's own inventory: only the roads tagged VUNGU. The demonstration roads (DEMO-RD-*) give way to them.
    const { rowCount: demo } = await db.query("DELETE FROM council_ops.road_asset WHERE asset_code LIKE 'DEMO-RD-%'")
    await db.query("DELETE FROM council_ops.road_asset WHERE source = $1", [ROADS])
    const seen = new Map()
    let inventory = 0
    for (const { p, geometry } of roads.filter((r) => r.p.authority === 'VUNGU')) {
      const base = `OSM-${p.osm_id}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      await db.query(
        `INSERT INTO council_ops.road_asset (asset_code, name, hierarchy, authority, length_m, status, data_quality, source, geom)
         SELECT $1, $2, $3, 'Vungu RDC', round((ST_Length(g::geography))::numeric, 2), 'active', 'unverified', $4, g
           FROM (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)) AS g) t`,
        [n === 1 ? base : `${base}-${n}`, txt(p.name), txt(p.fclass), ROADS, JSON.stringify(geometry)])
      inventory++
    }
    report.road_assets = inventory
    if (demo) report.demo_roads_replaced = demo

    // ── The planning boundary, as supplied ──
    const boundary = read('planning_boundary')
    if (boundary.length !== 1) throw new Error(`planning_boundary.geojson holds ${boundary.length} features; one was expected.`)
    const bp = boundary[0].properties ?? {}
    await db.query('DELETE FROM admin.planning_boundary WHERE authority_id = $1', [auth.id])
    await db.query(
      `INSERT INTO admin.planning_boundary (authority_id, name, adm2_pcode, adm1_pcode, source, note, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)))`,
      [auth.id, txt(bp.ADM2_EN) ?? 'Planning boundary', txt(bp.ADM2_PCODE), txt(bp.ADM1_PCODE), BOUNDARY,
        'The polygon as supplied: the Gweru Rural district (ZW1704) with the city of Gweru cut out. Not the union of the wards of the council, and not a Council act.',
        JSON.stringify(boundary[0].geometry)])
    report.planning_boundary = 1

    report.polling_areas = await replaceLayer(db, 'admin.polling_area',
      ['polling_code', 'name', 'ward_number', 'voters', 'integrity', 'old_name', 'address', 'assembly', 'modified', 'source'],
      read('polling_areas').map(feat).map(({ p, geometry }) => ({ geometry, values: [txt(p.polling_code), txt(p.name), int(p.ward_number), int(p.voters), txt(p.integrity), txt(p.old_name), txt(p.address), txt(p.assembly), txt(p.modified), ZEC] })), 'MultiPolygon')

    // Place each polling area in the council ward that holds its point on surface.
    await db.query(`
      UPDATE admin.polling_area pa SET ward_code = g.ward_code
        FROM (SELECT a.polling_code, (SELECT w.ward_code FROM spatial_engine.v_authority_ward w
                                       WHERE ST_Intersects(w.geom, ST_PointOnSurface(a.geom)) ORDER BY w.ward_code LIMIT 1) AS ward_code
                FROM admin.polling_area a) g
       WHERE g.polling_code = pa.polling_code`)

    const { rows: [chk] } = await db.query(`
      SELECT count(*)::int AS areas,
             count(*) FILTER (WHERE ward_code IS NULL)::int AS unplaced,
             count(*) FILTER (WHERE ward_code IS NOT NULL
                                AND ward_code !~ ('-0*' || ward_number::text || '$'))::int AS disagree
        FROM admin.polling_area`)
    report.placement = chk

    // Registered voters per ward, as a denominator, only where every area of the ward is placed and agrees.
    await db.query(`DELETE FROM spatial_engine.ward_denominator WHERE authority_id = $1 AND kind = 'registered_voters'`, [auth.id])
    const { rowCount } = await db.query(`
      INSERT INTO spatial_engine.ward_denominator (authority_id, ward_code, kind, as_of_year, value, source, source_ref)
      SELECT $1, pa.ward_code, 'registered_voters', 2023, sum(pa.voters), $2, 'Midlands_Polling Areas_UTM_35K-20_04_2023.shp'
        FROM admin.polling_area pa
       WHERE pa.ward_code IS NOT NULL AND pa.voters IS NOT NULL
       GROUP BY pa.ward_code
      HAVING sum(pa.voters) > 0`, [auth.id, 'Zimbabwe Electoral Commission polling areas, 20 April 2023: registered voters (adults on the roll), not population'])
    report.voter_denominators = rowCount

    if (chk.disagree > 0) throw new Error(`${chk.disagree} polling areas sit in a ward that does not match their ward number; nothing was loaded.`)
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
  console.log('[reference-layers]', JSON.stringify(report))
  if (!report.voter_denominators) console.log('[reference-layers] no council wards are loaded, so no voter denominator was written (run scripts/load-wards.js first).')
}

main().catch((err) => { console.error('[reference-layers] failed:', err.message); process.exit(1) })
