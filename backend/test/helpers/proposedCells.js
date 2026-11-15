/**
 * The tests that pin the behaviour of a PROPOSED matrix rule need proposed cells to exist. While the EO's pending decisions are affirmed for testing
 * (scripts/affirm-decisions-for-testing.js) there are none, so a test calls suspendAffirmation() first: the affirmed cells go back to proposed for the
 * length of the test file, and the returned function puts the affirmation (and each zone column's review state) back exactly as it was.
 * A no-op when nothing is affirmed.
 */
const PROPOSED = 'PROPOSED: best practice, for EO review'
const AFFIRMED = 'EO Planning (Vungu matrix; affirmed for testing)'
const TAG = ' [affirmed for testing]'

async function suspendAffirmation(sys) {
  const { rows: [{ n }] } = await sys.query('SELECT count(*)::int AS n FROM zone_land_use_controls WHERE authority = $1', [AFFIRMED])
  if (!n) return async () => {}
  const reviews = (await sys.query('SELECT id, review_status, reviewed_by, reviewed_at FROM plan_zone_type')).rows
  await sys.query('UPDATE zone_land_use_controls SET authority = $1, notes = replace(COALESCE(notes, \'\'), $2, \'\') WHERE authority = $3', [PROPOSED, TAG, AFFIRMED])
  return async () => {
    await sys.query('UPDATE zone_land_use_controls SET authority = $1, notes = COALESCE(notes, \'\') || $2 WHERE authority = $3 AND notes NOT LIKE $4', [AFFIRMED, TAG, PROPOSED, '%' + TAG])
    for (const r of reviews) {
      await sys.query('UPDATE plan_zone_type SET review_status = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1', [r.id, r.review_status, r.reviewed_by, r.reviewed_at])
    }
  }
}

module.exports = { suspendAffirmation, PROPOSED, AFFIRMED }
