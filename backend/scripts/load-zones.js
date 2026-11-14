#!/usr/bin/env node
/**
 * Loads Vungu RDC's zones from the two files the council's GIS supplied, into ONE table, public.proposed_peri_urban_zones
 * (the canonical zones table: the foreign keys, tiles and the planning assistant read it), filed under the plan
 * "Vungu RDC peri-urban local plan (as mapped)".
 *
 *   node scripts/load-zones.js [--peri data/reference/vungu/zones/peri_urban_zones.geojson]
 *        [--beyond data/reference/vungu/zones/beyond_peri_urban_zones.geojson] [--dry-run] [--replace] [--if-empty]
 *
 *   peri_urban_zones    61 polygons with a zone name (12 names). Loaded as the zone name. The source spells one zone
 *                       "Cemetry"; it is loaded as "Cemetery", the spelling the plan code already uses.
 *   beyond_peri_urban_zones   16 polygons for the area beyond the peri-urban zones. They carry no planning zone: they
 *                       carry a settlement category and a land-use code (lu013 to lu018), the ward and the original admin
 *                       codes. Each settlement category is loaded as the planning zone the council named for it (see
 *                       SETTLEMENT_ZONE: FLSCF is Large Scale Commercial Farms, FLSCF_A2 is Model A2, SSCF is Small Scale
 *                       Commercial Farms, FLSCF_SSCF_A1 is Model A1; Communal and Resettlement Area are unchanged), the
 *                       code as zone_code, the ward number in `ward`, and the category "Beyond the peri-urban area" so
 *                       they can be told apart. The source category and code stay in the description. A category the map
 *                       does not name is refused, not passed through.
 *
 * The database trigger zones_sync_plan_refs files each polygon under the plan and creates a zone type for every new zone
 * name (review_status 'unreviewed'). The beyond areas' settlement categories therefore appear as zone types of the plan:
 * the planners decide whether they are zones, and with what rules (the zoning matrix stays empty).
 *
 * --dry-run does everything in a transaction and rolls it back, and prints the report. Without --replace the script
 * refuses to load into a table that already holds zones; --replace removes the plan's existing zones first (rows that
 * reference them in zone_land_use_controls, parcel_zoning and zone_polygon_decision cascade or block; those are empty today).
 * --if-empty loads only when the table holds no zones and otherwise exits quietly (for demo:setup, which can be re-run).
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)
const dir = path.join(__dirname, '..', 'data', 'reference', 'vungu', 'zones')
const periFile = path.resolve(arg('peri', path.join(dir, 'peri_urban_zones.geojson')))
const beyondFile = path.resolve(arg('beyond', path.join(dir, 'beyond_peri_urban_zones.geojson')))
const dryRun = has('dry-run')
const replace = has('replace')
const ifEmpty = has('if-empty')

const PLAN_TITLE = 'Vungu RDC peri-urban local plan (as mapped)'
const BEYOND = 'Beyond the peri-urban area'
// The planning zone each settlement category of the beyond file becomes (the council's naming, 14 November 2026).
const SETTLEMENT_ZONE = {
  Communal: 'Communal',
  'Resettlement Area': 'Resettlement Area',
  FLSCF: 'Large Scale Commercial Farms',
  FLSCF_A2: 'Model A2',
  SSCF: 'Small Scale Commercial Farms',
  FLSCF_SSCF_A1: 'Model A1',
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).features
const txt = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const GEOM = `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)), 3))`

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const peri = read(periFile)
  const beyond = read(beyondFile)
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const report = { peri: peri.length, beyond: beyond.length }
  try {
    await db.query('BEGIN')
    const { rows: [plan] } = await db.query('SELECT id FROM public.plan_instrument WHERE title = $1', [PLAN_TITLE])
    if (!plan) throw new Error(`The plan "${PLAN_TITLE}" does not exist (migration 139).`)

    const { rows: [existing] } = await db.query('SELECT count(*)::int AS n FROM public.proposed_peri_urban_zones')
    if (existing.n > 0 && ifEmpty && !replace) {
      await db.query('ROLLBACK')
      console.log(`[zones] ${existing.n} zones are already loaded; nothing to do (--if-empty).`)
      return
    }
    if (existing.n > 0 && !replace) throw new Error(`The zones table already holds ${existing.n} zones; use --replace to replace the plan's zones.`)
    if (replace) {
      const { rowCount } = await db.query('DELETE FROM public.proposed_peri_urban_zones WHERE plan_instrument_id = $1', [plan.id])
      report.replaced = rowCount
    }

    let invalid = 0
    const insert = async (feature, row) => {
      const { rows: [v] } = await db.query('SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS ok', [JSON.stringify(feature.geometry)])
      if (!v.ok) invalid++
      await db.query(
        `INSERT INTO public.proposed_peri_urban_zones (zone, zone_code, scale_category, zone_description, is_active, ward, geom)
         VALUES ($2, $3, $4, $5, true, $6, ${GEOM})`,
        [JSON.stringify(feature.geometry), row.zone, row.zone_code, row.scale_category, row.description, row.ward])
    }

    for (const f of peri) {
      const p = f.properties
      const name = txt(p.Zone) === 'Cemetry' ? 'Cemetery' : txt(p.Zone)
      if (!name) throw new Error(`A peri-urban polygon (FID_1 ${p.FID_1}) has no zone name.`)
      await insert(f, { zone: name, zone_code: null, scale_category: null, ward: null,
        description: txt(p.LB) ? `Source label "${txt(p.LB)}"` : null })
    }
    for (const f of beyond) {
      const p = f.properties
      const settlement = txt(p.settlement)
      if (!settlement) throw new Error(`A beyond polygon (fid ${p.fid}) has no settlement category.`)
      const zone = SETTLEMENT_ZONE[settlement]
      if (!zone) throw new Error(`Settlement category "${settlement}" (fid ${p.fid}) has no planning zone in SETTLEMENT_ZONE.`)
      await insert(f, { zone, zone_code: txt(p.zone_code), scale_category: BEYOND, ward: txt(p.ADM3_EN),
        description: `Source settlement category "${settlement}" (not expanded in the file): ward ${txt(p.ADM3_EN)} (${txt(p.ADM3_PCODE)}), settlement "${settlement}", land-use code ${txt(p.zone_code)}, layer ${txt(p.layer)}`.slice(0, 500) })
    }
    report.invalid_repaired = invalid

    // Zone types the trigger made for names that no longer exist (a replaced load) go too, unless something uses them.
    const { rowCount: staleTypes } = await db.query(`
      DELETE FROM public.plan_zone_type t
       WHERE t.plan_instrument_id = $1
         AND NOT EXISTS (SELECT 1 FROM public.proposed_peri_urban_zones z WHERE z.plan_zone_type_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM public.parcel_zoning x WHERE x.plan_zone_type_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM public.plan_zone_standard x WHERE x.plan_zone_type_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM public.plan_zone_type_class x WHERE x.plan_zone_type_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM public.zone_land_use_controls x WHERE x.plan_zone_type_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM public.plan_zone_type x WHERE x.derived_from_id = t.id)`, [plan.id])
    report.stale_zone_types_removed = staleTypes

    const q = async (sql, params) => (await db.query(sql, params)).rows
    const [counts] = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE scale_category = $1)::int AS beyond,
                                     count(plan_instrument_id)::int AS with_plan, count(plan_zone_type_id)::int AS with_type,
                                     round(sum(area_ha) FILTER (WHERE scale_category IS DISTINCT FROM $1))::int AS peri_ha,
                                     round(sum(area_ha) FILTER (WHERE scale_category = $1))::int AS beyond_ha
                                FROM public.proposed_peri_urban_zones`, [BEYOND])
    report.table = counts
    const [types] = await q('SELECT count(*)::int AS n FROM public.plan_zone_type WHERE plan_instrument_id = $1', [plan.id])
    report.zone_types_of_plan = types.n

    // Overlap without polygon overlay (GEOS 3.9 returns empty intersections for some of these polygons): pairs that
    // share area rather than merely touch.
    const [ov] = await q(`
      SELECT count(*) FILTER (WHERE a.scale_category IS NOT DISTINCT FROM b.scale_category)::int AS same_layer,
             count(*) FILTER (WHERE a.scale_category IS DISTINCT FROM b.scale_category)::int AS across_layers
        FROM public.proposed_peri_urban_zones a JOIN public.proposed_peri_urban_zones b ON a.id < b.id
       WHERE ST_Intersects(a.geom, b.geom) AND NOT ST_Touches(a.geom, b.geom)`)
    report.overlapping_pairs = ov

    const [cov] = await q(`
      WITH u AS (SELECT ST_Union(geom) g FROM admin.ward WHERE ward_code LIKE 'ZEC23-VUNGU-%')
      SELECT count(*)::int AS polygons, count(*) FILTER (WHERE ST_Intersects(u.g, ST_PointOnSurface(z.geom)))::int AS inside_vungu_wards
        FROM public.proposed_peri_urban_zones z, u`)
    report.inside_vungu_wards = cov

    report.peri_area_ha_in_file = Math.round(peri.reduce((s, f) => s + (Number(f.properties.Area_ha) || 0), 0))

    if (dryRun) { await db.query('ROLLBACK'); report.dry_run = true } else await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
  console.log('[zones]', JSON.stringify(report, null, 1))
}

main().catch((err) => { console.error('[zones] failed:', err.message); process.exit(1) })
