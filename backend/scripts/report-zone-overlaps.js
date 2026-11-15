#!/usr/bin/env node
/**
 * Write the council's list of zone overlaps (and zones with no area) as CSV, for correcting the zones at source.
 *
 *   node scripts/report-zone-overlaps.js [--plan <part of the title>] [--out <folder>]
 *
 * Reads spatial_planning.v_zone_overlap (migration 226): every overlap between two zones of one plan, with who keeps it and by which
 * rule. The rule is a proposal for the council to confirm. Nothing is written to the database.
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Pool } = require('pg')

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const cell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const csv = (header, rows) => `${header.join(',')}\n${rows.map((r) => header.map((h) => cell(r[h])).join(',')).join('\n')}\n`

async function main() {
  const plan = arg('plan', 'Vungu RDC peri-urban')
  const out = arg('out', path.join(__dirname, '..', 'docs'))
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const { rows: overlaps } = await pool.query(
      `SELECT row_number() OVER (ORDER BY o.overlap_ha DESC, o.zone_a_id) AS no,
              o.kind, o.overlap_ha, o.mean_width_m,
              o.zone_a_id, o.a_zone, o.zone_b_id, o.b_zone,
              o.winner_zone_id AS kept_by_zone_id, o.winner_zone AS kept_by_zone, o.rule,
              round(ST_X(ST_PointOnSurface(ST_Intersection(a.geom, b.geom)))::numeric, 6) AS lon,
              round(ST_Y(ST_PointOnSurface(ST_Intersection(a.geom, b.geom)))::numeric, 6) AS lat
         FROM spatial_planning.v_zone_overlap o
         JOIN public.plan_instrument i ON i.id = o.plan_instrument_id
         JOIN spatial_planning.zone a ON a.id = o.zone_a_id
         JOIN spatial_planning.zone b ON b.id = o.zone_b_id
        WHERE i.title ILIKE $1 ORDER BY o.overlap_ha DESC, o.zone_a_id`, [`%${plan}%`])
    const { rows: empty } = await pool.query(
      `SELECT z.id AS zone_id, z.zone, ST_IsEmpty(z.geom) AS empty_geometry, round((ST_Area(z.geom::geography) / 10000)::numeric, 4) AS area_ha
         FROM spatial_planning.zone z JOIN public.plan_instrument i ON i.id = z.plan_instrument_id
        WHERE i.title ILIKE $1 AND (z.geom IS NULL OR ST_IsEmpty(z.geom) OR ST_Area(z.geom::geography) < 1) ORDER BY z.id`, [`%${plan}%`])

    fs.mkdirSync(out, { recursive: true })
    const f1 = path.join(out, 'zone-overlaps-vungu.csv')
    const f2 = path.join(out, 'zone-empty-polygons-vungu.csv')
    fs.writeFileSync(f1, csv(['no', 'kind', 'overlap_ha', 'mean_width_m', 'zone_a_id', 'a_zone', 'zone_b_id', 'b_zone', 'kept_by_zone_id', 'kept_by_zone', 'rule', 'lon', 'lat'], overlaps))
    fs.writeFileSync(f2, csv(['zone_id', 'zone', 'empty_geometry', 'area_ha'], empty))
    const by = (k) => overlaps.filter((r) => r.kind === k)
    console.log(`${f1}: ${overlaps.length} overlaps (${by('overlap').length} real, ${by('sliver').length} slivers)`)
    console.log(`${f2}: ${empty.length} zone(s) with no area`)
  } finally {
    await pool.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
