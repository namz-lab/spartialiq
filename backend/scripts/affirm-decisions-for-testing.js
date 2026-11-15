#!/usr/bin/env node
/**
 * Treats the EO Planning's and the GIS team's pending decisions as AFFIRMED, FOR TESTING ONLY. They have not been made: the council asked for them to
 * be taken as affirmative so the whole flow can be tried, and to be revisited later.
 *
 *   node scripts/affirm-decisions-for-testing.js            affirm
 *   node scripts/affirm-decisions-for-testing.js --revert   put everything back as it was
 *   node scripts/affirm-decisions-for-testing.js --status   say where things stand
 *
 * WHAT IT CHANGES (the Vungu plan only; the templates are untouched)
 *   - the matrix cells proposed as best practice for the EO's review ("PROPOSED: best practice, for EO review") become
 *     "EO Planning (Vungu matrix; affirmed for testing)": they stop being shown, and gated, as proposals. The 17 combine conflicts of the EO's sheet
 *     stay as resolved in the matrix (the EO's own cells carry no such flag, so nothing changes for them);
 *   - every zone column of the plan is marked reviewed, by "EO Planning (affirmed for testing)";
 *   - a plan event "eo_affirmed_for_testing" records what was done, so the plan's history says plainly that these were not real confirmations.
 * The plan's own status does not change (it stays as it is: nothing is approved or gazetted by this).
 *
 * THE GIS TEAM: the map colours chosen by the developer (the zone colour for Densification Zone [MDR], and the symbols of the facility, land-feature and
 * railway layers) are already published in the symbology registry. This script records the affirmation in the plan's history; it changes no style.
 *
 * --revert restores the proposals (cells named above back to PROPOSED) and marks the zone columns unreviewed again.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { Client } = require('pg')

const PROPOSED = 'PROPOSED: best practice, for EO review'
const AFFIRMED = 'EO Planning (Vungu matrix; affirmed for testing)'
const REVIEWER = 'EO Planning (affirmed for testing)'
const PLAN_TITLE = 'Vungu RDC peri-urban local plan (as mapped)'
const TAG = ' [affirmed for testing]'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const mode = process.argv.includes('--revert') ? 'revert' : process.argv.includes('--status') ? 'status' : 'affirm'
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    const { rows: [plan] } = await db.query('SELECT id FROM plan_instrument WHERE title = $1 AND NOT is_template', [PLAN_TITLE])
    if (!plan) throw new Error(`No plan "${PLAN_TITLE}".`)

    const counts = async () => (await db.query(
      `SELECT count(*) FILTER (WHERE c.authority = $2)::int AS proposed,
              count(*) FILTER (WHERE c.authority = $3)::int AS affirmed
         FROM zone_land_use_controls c WHERE c.plan_instrument_id = $1 AND c.deleted_at IS NULL`, [plan.id, PROPOSED, AFFIRMED])).rows[0]
    const reviews = async () => (await db.query(
      `SELECT count(*) FILTER (WHERE review_status = 'reviewed')::int AS reviewed, count(*)::int AS columns FROM plan_zone_type WHERE plan_instrument_id = $1`, [plan.id])).rows[0]

    if (mode === 'status') { console.log('[affirm]', JSON.stringify({ cells: await counts(), zone_columns: await reviews() })); return }

    await db.query('BEGIN')
    if (mode === 'affirm') {
      // the cells first: editing a decision puts its column back in review, so the review marks come after
      const cells = await db.query(
        `UPDATE zone_land_use_controls SET authority = $2, notes = COALESCE(notes, '') || $3
          WHERE plan_instrument_id = $1 AND authority = $4 AND deleted_at IS NULL`, [plan.id, AFFIRMED, TAG, PROPOSED])
      const { rows: cols } = await db.query('SELECT id FROM plan_zone_type WHERE plan_instrument_id = $1', [plan.id])
      for (const c of cols) await db.query('SELECT set_zone_type_review($1, $2, $3, NULL, $4)', [c.id, 'reviewed', REVIEWER, 'admin'])
      await db.query('SELECT log_plan_event($1, $2, NULL, $3, $4::jsonb)', [plan.id, 'eo_affirmed_for_testing', 'admin',
        JSON.stringify({ cells_affirmed: cells.rowCount, zone_columns_reviewed: cols.length, note: 'Affirmed for testing at the council\'s request; not a real confirmation. To be revisited.' })])
      console.log(`[affirm] ${cells.rowCount} proposed cells affirmed; ${cols.length} zone columns marked reviewed.`)
    } else {
      const cells = await db.query(
        `UPDATE zone_land_use_controls SET authority = $2, notes = replace(COALESCE(notes, ''), $3, '')
          WHERE plan_instrument_id = $1 AND authority = $4 AND deleted_at IS NULL`, [plan.id, PROPOSED, TAG, AFFIRMED])
      const { rows: cols } = await db.query('SELECT id FROM plan_zone_type WHERE plan_instrument_id = $1', [plan.id])
      for (const c of cols) await db.query('SELECT set_zone_type_review($1, $2, NULL, NULL, $3)', [c.id, 'unreviewed', 'admin'])
      await db.query('SELECT log_plan_event($1, $2, NULL, $3, $4::jsonb)', [plan.id, 'eo_affirmation_reverted', 'admin',
        JSON.stringify({ cells_restored_to_proposed: cells.rowCount, zone_columns_unreviewed: cols.length })])
      console.log(`[affirm] reverted: ${cells.rowCount} cells back to proposed; ${cols.length} zone columns unreviewed.`)
    }
    await db.query('COMMIT')
    console.log('[affirm]', JSON.stringify({ cells: await counts(), zone_columns: await reviews() }))
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error('[affirm] failed:', err.message); process.exit(1) })
