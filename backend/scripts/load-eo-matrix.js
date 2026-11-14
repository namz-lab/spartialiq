#!/usr/bin/env node
/**
 * Load the Executive Officer for Planning's development matrix for Vungu into the Vungu plan, together with
 * best-practice PROPOSALS for the zones the EO's matrix does not cover. See docs/vungu-eo-matrix.md.
 *
 *   node scripts/load-eo-matrix.js                     dry run: does everything in a transaction, reports, rolls back
 *   node scripts/load-eo-matrix.js --apply             the same, kept
 *   node scripts/load-eo-matrix.js --write-reference   also rewrite data/reference/vungu/eo-use-mapping.csv and eo-combine-conflicts.csv
 *   --plan <id|part of title>                          default: "Vungu RDC peri-urban local plan (as mapped)"
 *
 * What it does, in one transaction (all or nothing; an approved or gazetted plan is refused by the database):
 *   1. renames the zone type "Light Industry" to "Light and General Industry" (and its polygons);
 *   2. adds the EO's uses we lack as new codes at the end of our list (never renumbers), with a HILUCS class;
 *   3. adds the EO's columns that have no mapped polygon as zone types, so none of the EO's decisions is lost;
 *   4. loads the EO's cells (Light and General Industry combined, most restrictive) and the PROPOSED cells.
 * Re-running changes nothing.
 */
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
const { Pool } = require('pg')
const { parseCsv, planImport } = require('../src/utils/zoningMatrixImport')
const { loadPlanContext, applyCells } = require('../src/services/planMatrixImport')
const eo = require('../src/utils/eoMatrix')

const DATA = path.join(__dirname, '..', 'data', 'reference', 'vungu')
const KNOWN = new Set(['--apply', '--write-reference', '--plan'])
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const csv = (header, rows) => `${header.join(',')}\n${rows.map((r) => header.map((h) => csvCell(r[h] ?? '')).join(',')).join('\n')}\n`

async function main() {
  const unknown = process.argv.slice(2).filter((a) => a.startsWith('--') && !KNOWN.has(a))
  if (unknown.length) { console.error(`Unknown option: ${unknown.join(' ')}`); process.exit(2) }
  const apply = process.argv.includes('--apply')
  const planI = process.argv.indexOf('--plan')
  const planArg = planI === -1 ? 'Vungu RDC peri-urban local plan (as mapped)' : process.argv[planI + 1]

  const { rows: eoRows } = { rows: parseCsv(fs.readFileSync(path.join(DATA, 'eo-matrix.csv'), 'utf8')) }
  const { rows: eoCells, conflicts } = eo.buildEoRows(eoRows)
  const proposed = eo.buildProposedRows(eoCells)

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: plans } = await client.query('SELECT id, title FROM plan_instrument WHERE id::text = $1 OR title ILIKE $2', [planArg, `%${planArg}%`])
    if (plans.length !== 1) throw new Error(`"${planArg}" matches ${plans.length} plans`)
    const planId = plans[0].id
    console.log(`Plan: ${plans[0].title}`)

    // 1. rename
    for (const r of eo.RENAMED_ZONES) {
      const { rowCount } = await client.query(
        'UPDATE plan_zone_type SET code = $3, name = $3 WHERE plan_instrument_id = $1 AND code = $2 AND NOT EXISTS (SELECT 1 FROM plan_zone_type WHERE plan_instrument_id = $1 AND code = $3)',
        [planId, r.from, r.to])
      if (rowCount) {
        const z = await client.query('UPDATE spatial_planning.zone SET zone = $3 WHERE plan_instrument_id = $1 AND zone = $2', [planId, r.from, r.to])
        console.log(`Renamed zone type "${r.from}" -> "${r.to}" (${z.rowCount} polygon(s))`)
      }
    }

    // 2. new use groups
    const { rows: [{ next }] } = await client.query('SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM land_use_groups WHERE plan_instrument_id = $1', [planId])
    let order = Number(next)
    let addedUses = 0
    for (const u of eo.USE_MAP.filter((x) => !x.ours)) {
      const { rows } = await client.query(
        `INSERT INTO land_use_groups (plan_instrument_id, group_code, description, group_category, display_order, notes)
         SELECT $1::uuid, $2::varchar, $3::text, $4::varchar, $5::int, $6::text
          WHERE NOT EXISTS (SELECT 1 FROM land_use_groups WHERE plan_instrument_id = $1::uuid AND group_code = $2::varchar) RETURNING id`,
        [planId, u.code, u.name, u.category, order, `Added from the EO Planning matrix for Vungu (EO's own letter: ${u.eo}).`])
      if (rows.length) {
        order++; addedUses++
        await client.query(
          `INSERT INTO land_use_group_class (land_use_group_id, scheme, code, relation, status) VALUES ($1, 'HILUCS', $2, 'within', 'proposed')`,
          [rows[0].id, u.hilucs])
      }
    }
    console.log(`Land uses added: ${addedUses}`)

    // 3. zone types for EO columns with no polygon
    let addedZones = 0
    for (const name of new Set(Object.values(eo.EO_ZONE_MAP))) {
      const { rowCount } = await client.query(
        `INSERT INTO plan_zone_type (plan_instrument_id, code, name) VALUES ($1, $2, $2) ON CONFLICT (plan_instrument_id, code) DO NOTHING`, [planId, name])
      addedZones += rowCount
    }
    console.log(`Zone types added: ${addedZones}`)

    // 4. decisions
    const ctx = await loadPlanContext(client, planId)
    const result = planImport({ rows: [...eoCells, ...proposed].map((r, i) => ({ ...r, _line: i + 2 })), zones: ctx.zones, zoneTypes: ctx.zoneTypes, groups: ctx.groups, existing: ctx.existing })
    if (result.errors.length) { console.error(result.errors.slice(0, 20).join('\n')); throw new Error(`${result.errors.length} error(s); nothing written`) }
    await applyCells(client, result.cells)
    const by = (rows) => rows.reduce((a, r) => ((a[r.control_type] = (a[r.control_type] || 0) + 1), a), {})
    console.log('EO cells:', eoCells.length, by(eoCells), `| proposed cells: ${proposed.length}`, by(proposed))
    console.log('Importer:', JSON.stringify(result.summary))
    console.log(`Light and General Industry: ${conflicts.length} of ${eo.USE_MAP.length} uses disagree between the two EO columns (most restrictive applied)`)

    if (process.argv.includes('--write-reference')) {
      fs.writeFileSync(path.join(DATA, 'eo-combine-conflicts.csv'), csv(['eo_code', 'our_code', 'use', 'light', 'general', 'chosen'], conflicts))
      fs.writeFileSync(path.join(DATA, 'eo-use-mapping.csv'), csv(['eo_code', 'eo_name', 'our_code', 'match_kind', 'note'], eo.USE_MAP.map((u) => ({
        eo_code: u.eo, eo_name: u.name, our_code: u.ours || u.code, match_kind: u.ours ? 'matched by description' : 'new use added', note: u.note || '' }))))
      console.log('Reference files written')
    }
    if (apply) { await client.query('COMMIT'); console.log('APPLIED') } else { await client.query('ROLLBACK'); console.log('Dry run: rolled back. Use --apply to keep it.') }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}
main()
