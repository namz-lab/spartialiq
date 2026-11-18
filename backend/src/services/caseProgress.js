/**
 * Moving a case on when the work that defines the next stage is done, so nobody has to move it by hand.
 *
 * Until now an acknowledged case stayed 'registered' (migration 171 records the date, not the status), and no screen moved
 * it on: the EO's determination was then refused ("A case in 'registered' cannot move to 'approved'"). The moves:
 *
 *   acknowledgement sent       registered   -> acknowledged   (the database, migration 248: every path that sends a letter)
 *   circulated to a department acknowledged -> circulation    (POST /permit-applications/:id/consultations)
 *   the Act's questions        acknowledged | circulation -> under_review   (POST /permit-applications/:id/statutory-checks)
 *
 * A move is made only FORWARD, only from the statuses named, and only where config/permitWorkflow.js allows it. A case
 * further on (under review, awaiting the EO, decided, withdrawn) is never moved back, and a case not yet acknowledged
 * is never moved past its acknowledgement: the clock must exist before a case can be assessed.
 *
 * Each move bumps the case's revision (the optimistic lock the screens use) and is logged as 'status_changed' with
 * `automatic: true` and the reason, so the audit trail shows it like a status change made by hand.
 */
const { canTransition } = require('../config/permitWorkflow')

/**
 * @param {{ query: Function }} client  a request-scoped client (tenancy)
 * @param {string} permitId
 * @param {string} to            the status to move to
 * @param {string[]} from        the only statuses it may move from
 * @param {{ request: object, reason: string }} ctx
 * @returns {Promise<{ moved: boolean, from?: string, to?: string }>}
 */
async function advance(client, permitId, to, from, { request, reason }) {
  const { rows } = await client.query(
    `WITH cur AS (
       SELECT id, status FROM spatial_planning.permit_application WHERE id = $1 AND status = ANY($3::text[]) FOR UPDATE
     )
     UPDATE spatial_planning.permit_application p
        SET status = $2, revision = p.revision + 1, updated_at = now()
       FROM cur
      WHERE p.id = cur.id
      RETURNING p.id, cur.status AS old_status`,
    [permitId, to, from.filter((f) => canTransition(f, to))],
  )
  if (!rows[0]) return { moved: false }
  const old = rows[0].old_status
  await client.query(
    `INSERT INTO spatial_planning.permit_event (permit_app_id, event_type, actor_id, actor_role, detail)
     VALUES ($1, 'status_changed', $2, $3, $4::jsonb)`,
    [permitId, request.user?.id || null, request.user?.role || null,
      JSON.stringify({ status: to, from_status: old, automatic: true, reason })],
  ).catch((err) => request.log.error({ err }, 'permit_event insert failed (automatic status change)'))
  return { moved: true, from: old, to }
}

module.exports = { advance }
