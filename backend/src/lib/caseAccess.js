/**
 * Who may read a case: its staff, the account that lodged it online, and the PERSON it was lodged for.
 *
 * A planning clerk can lodge an application at the counter for a walk-in applicant and link it to that person in the
 * register (migration 256: permit_application.applicant_person_id). When the same person has an online account
 * (users.person_id, migration 257), the citizen portal shows them that case too, but only once the council is sure who
 * they are: assurance level 1 or above (identity checked online or at the counter). At level 0 a link rests on a name as
 * given, and a mistaken link would show one person's case to another, so it shows nothing.
 *
 * It opens the case for reading, and for adding supporting documents to it (POST /permit-applications/:id/documents),
 * which is what an applicant does. It never lets a citizen change the case itself.
 */

/** The assurance level a person must reach before records linked to them appear in their portal. */
const LINKED_RECORDS_MIN_LEVEL = 1

const { systemOf } = require('./dbContext')

/**
 * The register person this account is linked to (users.person_id), whatever their level, or null. The account row is the
 * system's (the request's own role, vungu_app, cannot read public.users), so this one column is read on the system
 * connection, for the signed-in account only.
 */
async function linkedPersonId(pg, userId) {
  if (!userId) return null
  const { rows: [u] } = await systemOf(pg).query('SELECT person_id FROM public.users WHERE id = $1', [userId])
  return u?.person_id ?? null
}

/**
 * The register person behind this account, when records linked to them may be shown; otherwise null.
 * Memoised on the request, since one page asks for several parts of a case.
 *
 * @param {object} pg fastify.pg (scoped to the person asking; the person row is read through it)
 * @param {object} request the Fastify request (request.user.id)
 * @returns {Promise<string|null>}
 */
async function personOfUser(pg, request) {
  if (request._casePerson !== undefined) return request._casePerson
  let id = null
  const linked = await linkedPersonId(pg, request.user?.id)
  if (linked) {
    const { rows: [row] } = await pg.query(
      `SELECT id FROM registry.person
        WHERE id = $1 AND merged_into IS NULL AND status = 'active' AND assurance_level >= $2`,
      [linked, LINKED_RECORDS_MIN_LEVEL],
    )
    id = row?.id ?? null
  }
  request._casePerson = id
  return id
}

/**
 * Whether a non-staff account may read this case: it lodged it, or the case was lodged for the person behind it.
 *
 * @param {{ created_by?: string|null, applicant_person_id?: string|null }} row the case's owner columns
 * @param {object} request the Fastify request
 * @param {string|null} personId from personOfUser
 */
function ownsCase(row, request, personId) {
  if (!row) return false
  if (row.created_by && row.created_by === request.user?.id) return true
  return Boolean(personId && row.applicant_person_id && row.applicant_person_id === personId)
}

module.exports = { LINKED_RECORDS_MIN_LEVEL, linkedPersonId, personOfUser, ownsCase }
