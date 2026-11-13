/**
 * Finance authorisation: a permission catalogue, not a role allow-list.
 *
 * WHY THIS IS NOT `requireRole`
 * The rest of this codebase authorises with `requireRole(fastify, ['planner', 'admin', ...])` —
 * one string on `users.role` tested against a list written at the route. That is adequate for
 * planning work, where the roles map cleanly onto the surfaces. It cannot express what a finance
 * module needs:
 *
 *   - Separation of duties. "Whoever approves must not be whoever publishes" is a statement about
 *     two permissions, not about two roles, and it has to hold however the council later rearranges
 *     its roles. It is asserted once, over the data, in migration 188.
 *   - Least privilege for one person. A finance officer who must not see supplier names is an
 *     override on that person, not a new role invented for them
 *     (`finance.user_permission_override`).
 *   - A technical administrator who administers and approves nothing. `admin` is permitted almost
 *     everywhere else in this application; here it holds seven read-and-provision permissions and
 *     nothing that moves money. A role allow-list would have made that invisible — reviewers would
 *     have had to notice `admin` was *missing* from thirty arrays.
 *
 * SO: permissions live in `finance.permission`, the defaults per role in
 * `finance.role_permission`, the per-person adjustments in `finance.user_permission_override`, and
 * routes ask for a permission by name.
 *
 * WHY THE CATALOGUE IS READ WITH systemOf()
 * Who may do what is a system fact, like a session or an audit row. Reading it through the
 * person's own connection would mean the rules that constrain someone were fetched under their own
 * row-level security, and writing it that way would let the application role edit its own
 * permissions. Migration 188 classifies these four tables `system` and revokes the application
 * role's access to them, so this module uses `systemOf(fastify.pg)` and nothing else can.
 *
 * DENIALS ARE AUDITED
 * `authenticate()` runs before the permission test, so `request.user` is set when a 403 is sent.
 * The audit hook (src/middleware/auditLog.js) records any mutating request that is not a 404,
 * which is what makes "attempt to publish without permission; confirm denial and audit event"
 * (specification §13.1) true rather than aspirational.
 */

const { authenticate } = require('./jwtAuth')
const { systemOf } = require('../lib/dbContext')

/**
 * Every permission this person holds, as a Set of codes.
 *
 * Resolution order: the role's defaults, plus any `grant` override, minus any `deny` override.
 * Deny always wins, and an expired override counts for nothing. Computed in SQL in one round trip
 * so a route that asks twice costs one query the first time and nothing after
 * (`request.financePermissions` memoises it for the life of the request).
 */
async function loadPermissions(fastify, user) {
  if (!user?.id) return new Set()
  const { rows } = await systemOf(fastify.pg).query(
    `WITH granted AS (
       SELECT rp.permission_code AS code FROM finance.role_permission rp WHERE rp.role_name = $2
       UNION
       SELECT o.permission_code FROM finance.user_permission_override o
        WHERE o.user_id = $1 AND o.effect = 'grant'
          AND (o.expires_at IS NULL OR o.expires_at > now())
     ), denied AS (
       SELECT o.permission_code AS code FROM finance.user_permission_override o
        WHERE o.user_id = $1 AND o.effect = 'deny'
          AND (o.expires_at IS NULL OR o.expires_at > now())
     )
     SELECT g.code FROM granted g WHERE g.code NOT IN (SELECT code FROM denied)`,
    [user.id, user.role || ''],
  )
  return new Set(rows.map((r) => r.code))
}

/** The permissions for the current request, loaded at most once. */
async function permissionsFor(fastify, request) {
  if (request.financePermissions) return request.financePermissions
  const set = await loadPermissions(fastify, request.user)
  request.financePermissions = set
  return set
}

/**
 * The departments this person's data is confined to, or `null` for "not confined".
 *
 * A departmental head is given rows in `finance.user_scope` and sees only those votes. Everyone
 * else — a finance officer, the committee, an auditor — is council-wide, which is expressed as the
 * absence of any scope row rather than as a row listing every department (one that would go stale
 * the moment a department is added).
 *
 * Returns an array of department ids, or null. Callers must treat null as "no filter" and an EMPTY
 * ARRAY as "no departments", which is why this never returns [].
 */
async function departmentScope(fastify, request) {
  if (request.financeScope !== undefined) return request.financeScope
  let scope = null
  if (request.user?.id) {
    const { rows } = await systemOf(fastify.pg).query(
      'SELECT department_id FROM finance.user_scope WHERE user_id = $1',
      [request.user.id],
    )
    if (rows.length > 0) scope = rows.map((r) => r.department_id)
  }
  request.financeScope = scope
  return scope
}

/** Does this person hold the permission? For branching inside a handler, not for guarding it. */
async function hasPermission(fastify, request, code) {
  const set = await permissionsFor(fastify, request)
  return set.has(code)
}

function denied(reply, code) {
  return reply.code(403).send({
    success: false,
    error: 'forbidden',
    message: 'You do not hold the permission this action requires.',
    required_permission: code,
  })
}

/**
 * Fastify preHandler: authenticated, and holds this permission.
 * Use as: `{ preHandler: requirePermission(fastify, 'finance.budget.approve') }`
 */
function requirePermission(fastify, code) {
  return async (request, reply) => {
    const user = await authenticate(fastify, request, reply)
    if (!user) return
    const set = await permissionsFor(fastify, request)
    if (!set.has(code)) return denied(reply, code)
  }
}

/** Fastify preHandler: holds at least one of these permissions. */
function requireAnyPermission(fastify, codes) {
  return async (request, reply) => {
    const user = await authenticate(fastify, request, reply)
    if (!user) return
    const set = await permissionsFor(fastify, request)
    if (!codes.some((c) => set.has(c))) return denied(reply, codes.join(' | '))
  }
}

/**
 * Does the council require the approver and the publisher to be different people?
 *
 * The specification says to separate duties "where practicable" (§2.3) — a council with one
 * finance officer must be able to publish at all. So this is a setting the council owns
 * (`finance.setting` key `separation_of_duties.publication`, decision D6) and it defaults to
 * TRUE: a missing or unreadable setting separates the duties rather than waiving them.
 */
async function separationOfDutiesRequired(fastify, authorityId) {
  try {
    const { rows } = await systemOf(fastify.pg).query(
      `SELECT value FROM finance.setting
        WHERE authority_id = $1 AND key = 'separation_of_duties.publication'`,
      [authorityId],
    )
    if (rows.length === 0) return true
    return rows[0].value !== false
  } catch (err) {
    fastify.log?.warn({ err }, 'separation-of-duties setting unreadable; separating duties')
    return true
  }
}

/** One finance setting, or the fallback when the council has not set it. */
async function financeSetting(fastify, authorityId, key, fallback = null) {
  try {
    const { rows } = await systemOf(fastify.pg).query(
      'SELECT value FROM finance.setting WHERE authority_id = $1 AND key = $2',
      [authorityId, key],
    )
    return rows.length ? rows[0].value : fallback
  } catch {
    return fallback
  }
}

module.exports = {
  loadPermissions,
  permissionsFor,
  departmentScope,
  hasPermission,
  requirePermission,
  requireAnyPermission,
  separationOfDutiesRequired,
  financeSetting,
}
