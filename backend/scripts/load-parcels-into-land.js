#!/usr/bin/env node
/**
 * Load the flat farm-parcel import into the one parcel register, land.parcel, as parcels of kind 'farm' (migrations 162, 164, 227).
 *
 *   node scripts/load-parcels-into-land.js                          dry run: what would be loaded, and what would be left out
 *   node scripts/load-parcels-into-land.js --apply                  load it, in one transaction (safe to repeat)
 *   node scripts/load-parcels-into-land.js --verify                 compare land.parcel with its source: counts, geometry and zoning
 *   node scripts/load-parcels-into-land.js --source <relation>      read another relation (default: scratch.vungu_parcels, else public.vungu_parcels_retired)
 *
 * The source is the raw import, NOT public.vungu_parcels: since migration 227 that name is a compatibility view over land.parcel.
 * A parcel is identified by its source row (source_relation 'public.vungu_parcels', source_key = fid), so a repeat finds the same row
 * whether it was loaded by migration 227 (parcel id P-...) or by this script (VP-<fid>). What it does to each source parcel:
 *   - a new parcel gets id VP-<fid>, stand_no the farm name (name, else name_cfu), parcel_kind 'farm';
 *   - area_m2    computed from the geometry on the ground; the stored text areas (which disagree with the geometry) are not copied;
 *   - ward_code  the ward containing a point inside the parcel, authority_id the authority whose area contains it;
 *   - tenure_class  the source's "status" (Commercial, City, State Land ...), kept apart from the lifecycle status;
 *   - land.parcel_farm  the name, CFU name, province and district;
 *   - accuracy_class D, basis map_digitised, custodian "unconfirmed": nobody has said who the custodian of this extract is.
 * An existing parcel's boundary and stand_no are NEVER changed here (boundaries change only through the Survey Section import);
 * its ward, authority, cadastre ref, tenure class and farm attributes are refreshed. A row an authority has edited (origin = 'authority')
 * is never overwritten. Left out, and reported: parcels with no geometry or an empty one (they have no area, which the model refuses).
 */
const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Pool } = require('pg')

// The provenance label the register and the compatibility view use for these parcels.
const TAG = 'public.vungu_parcels'
const USAGE = 'Usage: [--apply] | --verify  [--source <relation>]'
const KNOWN = new Set(['--apply', '--verify', '--source'])

const selectSql = (src) => `
  WITH area AS MATERIALIZED (SELECT authority_id, geom FROM admin.authority_area),
  src AS (
    SELECT p.fid, COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(p.name_cfu), ''), 'Parcel ' || p.fid) AS stand_no,
           NULLIF(btrim(p.name), '') AS name, NULLIF(btrim(p.name_cfu), '') AS name_cfu,
           NULLIF(btrim(p.province), '') AS province, NULLIF(btrim(p.district), '') AS district,
           NULLIF(btrim(p.map_sheet), '') AS cadastre_ref, NULLIF(btrim(p.status), '') AS tenure_class,
           ST_Multi(ST_MakeValid(p.geom)) AS g
      FROM ${src} p
     WHERE p.geom IS NOT NULL AND NOT ST_IsEmpty(p.geom)
  )
  SELECT s.fid, s.stand_no, s.name, s.name_cfu, s.province, s.district, s.cadastre_ref, s.tenure_class, s.g,
         ROUND(ST_Area(s.g::geography)::numeric, 2) AS area_m2,
         (SELECT w.ward_code FROM admin.ward w WHERE (w.valid_to IS NULL OR w.valid_to >= CURRENT_DATE) AND ST_Intersects(w.geom, ST_PointOnSurface(s.g)) ORDER BY w.ward_code LIMIT 1) AS ward_code,
         (SELECT a.authority_id FROM area a WHERE ST_Intersects(a.geom, ST_PointOnSurface(s.g)) LIMIT 1) AS authority_id
    FROM src s`

async function resolveSource(q, wanted) {
  if (wanted) return wanted
  for (const rel of ['scratch.vungu_parcels', 'public.vungu_parcels_retired']) {
    if ((await q('SELECT to_regclass($1) AS r', [rel]))[0].r) return rel
  }
  throw new Error('No raw farm import to read: neither scratch.vungu_parcels nor public.vungu_parcels_retired exists. Give --source <relation>.')
}

async function main() {
  const args = process.argv.slice(2)
  const bad = args.filter((a) => a.startsWith('--') && !KNOWN.has(a))
  if (bad.length) { console.error(`Unknown option(s): ${bad.join(' ')}\n${USAGE}`); process.exit(2) }
  const apply = args.includes('--apply'), verify = args.includes('--verify')
  const si = args.indexOf('--source')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const q = async (s, a) => (await pool.query(s, a)).rows
  try {
    const SRC = await resolveSource(q, si === -1 ? null : args[si + 1])
    const total = (await q(`SELECT count(*)::int n FROM ${SRC}`))[0].n
    const rows = await q(selectSql(SRC))
    const skipped = total - rows.length
    if (verify) return await check(pool, q, rows, SRC)

    const bad2 = rows.filter((r) => !(Number(r.area_m2) > 0))
    const loadable = rows.filter((r) => Number(r.area_m2) > 0)
    const noWard = loadable.filter((r) => !r.ward_code).length
    const noAuth = loadable.filter((r) => r.authority_id == null).length
    console.log(`${SRC}: ${total} parcels. Loadable: ${loadable.length}. Left out: ${skipped + bad2.length} (${skipped} with no geometry, ${bad2.length} with no area).`)
    console.log(`  ${loadable.length - noWard} fall in a ward, ${loadable.length - noAuth} in an authority's area (${noAuth} in none).`)
    const existing = (await q(`SELECT count(*)::int n, count(*) FILTER (WHERE origin = 'authority')::int edited FROM land.parcel WHERE source_relation = $1`, [TAG]))[0]
    console.log(`  land.parcel already holds ${existing.n} from this source (${existing.edited} edited by an authority, never overwritten).`)
    if (!apply) { console.log('  (dry run: nothing written; add --apply)'); return }

    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const r = await c.query(`
        INSERT INTO land.parcel (parcel_id, stand_no, township_code, ward_code, geom_source, source_srid, geom_wgs84, area_m2, accuracy_class, accuracy_basis,
                                 source, custodian_dept, status, allocation_status, valid_from, parcel_kind, cadastre_ref, tenure_class, authority_id, origin,
                                 source_relation, source_key)
        SELECT 'VP-' || x.fid, x.stand_no, NULL, x.ward_code, x.g, 4326, x.g, x.area_m2, 'D', 'map_digitised',
               'vungu_parcels (GeoPackage import)', 'unconfirmed: see docs/ADMIN-DATA-CUSTODIANS-ZIMBABWE.md', 'current', 'unallocated', CURRENT_DATE, 'farm', x.cadastre_ref, x.tenure_class, x.authority_id, 'custodian',
               $1, x.fid::text
          FROM (${selectSql(SRC)}) x
         WHERE x.area_m2 > 0
        ON CONFLICT (source_relation, source_key) WHERE source_relation IS NOT NULL DO UPDATE
           SET ward_code = EXCLUDED.ward_code, cadastre_ref = EXCLUDED.cadastre_ref, tenure_class = EXCLUDED.tenure_class,
               authority_id = EXCLUDED.authority_id, updated_at = now()
         WHERE land.parcel.origin = 'custodian'`, [TAG])
      const f = await c.query(`
        INSERT INTO land.parcel_farm (parcel_id, name, name_cfu, province, district)
        SELECT l.parcel_id, x.name, x.name_cfu, x.province, x.district
          FROM (${selectSql(SRC)}) x JOIN land.parcel l ON l.source_relation = $1 AND l.source_key = x.fid::text
        ON CONFLICT (parcel_id) DO UPDATE SET name = EXCLUDED.name, name_cfu = EXCLUDED.name_cfu, province = EXCLUDED.province, district = EXCLUDED.district`, [TAG])
      await c.query('COMMIT')
      console.log(`  loaded: ${r.rowCount} parcel(s) inserted or refreshed, ${f.rowCount} farm record(s).`)
    } catch (err) { await c.query('ROLLBACK').catch(() => {}); throw err } finally { c.release() }
  } finally {
    await pool.end()
  }
}

async function check(pool, q, rows, SRC) {
  let failures = 0
  const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) failures++ }
  const loadable = rows.filter((r) => Number(r.area_m2) > 0)
  const inLand = (await q(`SELECT count(*)::int n FROM land.parcel WHERE source_relation = $1`, [TAG]))[0].n
  ok(inLand === loadable.length, `land.parcel holds ${inLand} of the ${loadable.length} loadable parcels`)
  const geom = (await q(`SELECT count(*)::int n FROM land.parcel l JOIN ${SRC} p ON p.fid::text = l.source_key
                          WHERE l.source_relation = $1 AND NOT ST_Equals(l.geom_wgs84, ST_Multi(ST_MakeValid(p.geom)))`, [TAG]))[0].n
  ok(geom === 0, geom ? `${geom} geometries differ from the source` : 'every geometry equals its source')
  const stored = await q(`SELECT p.fid, NULLIF(p.area_ha::text, '')::numeric AS stored_ha, l.area_m2 / 10000.0 AS true_ha
                            FROM land.parcel l JOIN ${SRC} p ON p.fid::text = l.source_key WHERE l.source_relation = $1 AND NULLIF(p.area_ha::text, '') IS NOT NULL`, [TAG])
  const off = stored.filter((s) => Math.abs(Number(s.stored_ha) - Number(s.true_ha)) > Math.max(0.5, 0.05 * Number(s.true_ha)))
  console.log(`  info  the source's stored area_ha is more than 5% (and 0.5 ha) away from the geometry for ${off.length} of ${stored.length} parcels; land.parcel carries the geometry's.`)
  const farm = (await q(`SELECT count(*)::int n FROM land.parcel l LEFT JOIN land.parcel_farm f ON f.parcel_id = l.parcel_id WHERE l.source_relation = $1 AND f.parcel_id IS NULL`, [TAG]))[0].n
  ok(farm === 0, farm ? `${farm} farm parcels have no farm record` : 'every farm parcel has its farm record')
  // the zone each parcel falls in must be the same through the legacy name (the view) and through the register's own id
  const ids = new Map((await q(`SELECT source_key, parcel_id FROM land.parcel WHERE source_relation = $1`, [TAG])).map((x) => [x.source_key, x.parcel_id]))
  const mismatches = []
  for (const r of loadable) {
    const pid = ids.get(String(r.fid))
    if (!pid) { mismatches.push(r.fid); continue }
    const a = (await q(`SELECT zone_id, is_governing FROM parcel_zoning_for('vungu_parcels', $1) ORDER BY is_governing DESC, share_pct DESC NULLS LAST, zone_id`, [String(r.fid)])).map((x) => `${x.zone_id}:${x.is_governing}`).join(',')
    const b = (await q(`SELECT zone_id, is_governing FROM parcel_zoning_for('land.parcel', $1) ORDER BY is_governing DESC, share_pct DESC NULLS LAST, zone_id`, [pid])).map((x) => `${x.zone_id}:${x.is_governing}`).join(',')
    if (a !== b) mismatches.push(r.fid)
  }
  ok(mismatches.length === 0, mismatches.length ? `${mismatches.length} parcels fall in a different zone through land.parcel (e.g. fid ${mismatches.slice(0, 5).join(', ')})` : `all ${loadable.length} parcels fall in the same zone(s) through either name`)
  const dup = (await q(`SELECT count(*)::int n FROM (SELECT parcel_id FROM land.parcel GROUP BY 1 HAVING count(*) > 1) x`))[0].n
  ok(dup === 0, 'no duplicate parcel ids')
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED')
  process.exit(failures ? 1 : 0)
}

main().catch((err) => { console.error(err.message); process.exit(1) })
