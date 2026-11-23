/**
 * Circulation is automatic (migration 255): acknowledging a case sends it to the departments its kind of development
 * needs, and moves it into 'circulation'. Roads and Works is consulted on every application, blocking, so a case is not
 * decided until that department has replied.
 *
 * Tests that take a case on to a decision use this to record the replies, as the departments would. It is a fixture,
 * written on the system connection: Roads and Works answers on its own desk (roads-works-referrals.js), with the
 * infrastructure-cost test, which is not what these tests are about.
 */

/**
 * Record a "no objection" from every department the case was circulated to that has not replied.
 *
 * @param {{ query: Function }} sys the system connection (dbContext.systemOf)
 * @param {string} permitId the case
 * @param {{ blockingOnly?: boolean }} [opts] answer only the blocking referrals
 * @returns {Promise<string[]>} the departments answered
 */
async function answerCirculation(sys, permitId, { blockingOnly = false } = {}) {
  const { rows } = await sys.query(
    `UPDATE spatial_planning.application_consultation
        SET response_status = 'no_objection', response_received_at = CURRENT_DATE, task_status = 'responded',
            response_notes = COALESCE(response_notes, 'No objection (test fixture).'), updated_at = now()
      WHERE permit_app_id = $1 AND task_type = 'circulation' AND response_status = 'pending'
        AND task_status <> 'cancelled' AND ($2::boolean IS FALSE OR blocking)
      RETURNING body_name`,
    [permitId, blockingOnly],
  )
  return rows.map((r) => r.body_name)
}

module.exports = { answerCirculation }
