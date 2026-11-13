/**
 * Separation of duties, over the EFFECTIVE permission set.
 *
 * WHAT WENT WRONG (audit BLOCKER-2). Migration 188 §11 asserts, over `finance.role_permission`,
 * that no ROLE holds both an approval permission and a publication permission, and that the
 * technical `admin` holds no approval, publication or restricted-data permission. Both assertions
 * are real and they still hold. What neither covered is `finance.user_permission_override`: the
 * effective set is role defaults PLUS grants MINUS denies, and
 * `PUT /api/finance/users/:id/access` wrote arbitrary grants with no equivalent check. One holder
 * of `finance.users.manage_finance_roles` — by default the technical administrator, the role
 * deliberately designed to hold no financial authority at all — could give a single officer
 * `finance.budget.approve` AND `finance.publication.publish`, and then approve a supplementary
 * allocation and publish it to the public portal unaided. The Permissions screen told that
 * officer it was impossible.
 *
 * WHERE THE RULE LIVES. Not here. The rule is `finance.separation_of_duties_conflict(uuid)`
 * (migration 200), which resolves the effective set with
 * `finance.resolve_effective_permissions()` — the same resolution as
 * `financePermissions.js loadPermissions()` — and applies migration 188's own two tests to it,
 * reading `finance.permission.is_approval / is_publication / is_restricted`. One definition,
 * three callers:
 *
 *   - this module, so the access route can refuse with a 409 that names the colliding pair;
 *   - the DEFERRED CONSTRAINT TRIGGER on `finance.user_permission_override`, so a future route, a
 *     migration or a hand-written UPDATE cannot bypass it;
 *   - any caller added later, which inherits the rule rather than re-stating it.
 *
 * A permission added to the catalogue with `is_publication = true` is covered the moment it is
 * inserted. Nothing in JavaScript enumerates the codes, so there is no list here to fall out of
 * step with the catalogue.
 *
 * WHY THE ROUTE CHECKS AT ALL, GIVEN THE TRIGGER. Two reasons. The trigger fires only on a write
 * to the override table, so a request that changes nothing but `users.role` — moving an officer
 * who already holds a publication grant into an approving role — would not reach it. And a
 * constraint violation at COMMIT is a 500 with a Postgres message; an administrator deserves a
 * 4xx that names the two permissions and says which to remove.
 */

/**
 * The conflicting rule for this person, or null when their effective set is permissible.
 *
 * @param db   anything with `.query(sql, params)` — pass the TRANSACTION CLIENT so the check sees
 *             the uncommitted result of the write it is judging.
 * @param userId  the person whose effective set to resolve.
 * @returns {Promise<null|{rule: string, role_name: string, approval_code: string|null,
 *                         publication_code: string|null, restricted_code: string|null}>}
 */
async function separationOfDutiesConflict(db, userId) {
  const { rows } = await db.query(
    `SELECT rule, role_name, approval_code, publication_code, restricted_code
       FROM finance.separation_of_duties_conflict($1) LIMIT 1`,
    [userId],
  )
  return rows[0] || null
}

/**
 * The refusal an administrator should read: specific about which two permissions collide and what
 * to do about it, rather than "forbidden". 409 rather than 400 because the request is well formed
 * and individually legal — it is the RESULTING STATE that the invariant refuses.
 */
function separationOfDutiesRefusal(conflict) {
  if (conflict.rule === 'approval_and_publication') {
    return {
      status: 409,
      error: 'separation_of_duties',
      message: 'That change would give one person both an approval permission '
        + `(${conflict.approval_code}) and the publication permission `
        + `(${conflict.publication_code}). Whoever approves a dataset must not be whoever `
        + 'publishes it. Remove one of the two, or give the publication permission to someone else.',
      conflict: {
        rule: conflict.rule,
        approval_permission: conflict.approval_code,
        publication_permission: conflict.publication_code,
      },
    }
  }
  const held = conflict.approval_code || conflict.publication_code || conflict.restricted_code
  return {
    status: 409,
    error: 'separation_of_duties',
    message: 'That change would give the technical administrator authority over financial content '
      + `(${held}). The administrator account provisions access and reads the audit trail; it `
      + 'approves nothing, publishes nothing and sees no restricted data. Give this permission to '
      + 'a finance role instead.',
    conflict: {
      rule: conflict.rule,
      role: conflict.role_name,
      approval_permission: conflict.approval_code,
      publication_permission: conflict.publication_code,
      restricted_permission: conflict.restricted_code,
    },
  }
}

/** Thrown inside a transaction so the write rolls back; caught by the route, which replies 409. */
class SeparationOfDutiesError extends Error {
  constructor(conflict) {
    const refusal = separationOfDutiesRefusal(conflict)
    super(refusal.message)
    this.name = 'SeparationOfDutiesError'
    this.refusal = refusal
    this.conflict = conflict
  }
}

module.exports = {
  separationOfDutiesConflict,
  separationOfDutiesRefusal,
  SeparationOfDutiesError,
}
