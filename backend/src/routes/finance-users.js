/**
 * Finance access administration.
 *
 * The permission catalogue (migration 188) separates a role's defaults from one person's
 * adjustments. Until this route existed the second half was unreachable: an override or a
 * departmental scope could only be written with SQL, and `finance.users.manage_finance_roles` was
 * decorative. This is the API behind that permission.
 *
 * WHAT IT DOES NOT DO
 * It does not create accounts, reset passwords or suspend people — that is the staff console's
 * job. It does not let anyone edit their own access (a mis-click would lock the last administrator
 * out), and it only assigns the seven finance roles. Moving someone back to a planning or GIS role
 * is a staff-console decision, not a finance one.
 *
 * The permission, role and scope tables are system facts, so they are read and written through
 * `systemOf()`, the same way `financePermissions.js` reads them. The target user must belong to the
 * caller's authority; that is checked explicitly because `systemOf()` bypasses row-level security.
 *
 * WHAT IT REFUSES TO DO
 * It cannot dissolve separation of duties. Migration 188 asserts over role defaults that no role
 * holds both an approval and a publication permission; this route used to be able to produce that
 * combination on one PERSON through grant overrides, which is audit BLOCKER-2. The write is now
 * judged on its RESULT — role defaults plus grants minus denies — against
 * `finance.separation_of_duties_conflict()` (migration 200), inside the transaction, so a refused
 * change leaves the person's access untouched and the refusal is audited. See
 * `src/lib/financeSeparationOfDuties.js`.
 */

const { requirePermission, loadPermissions } = require('../middleware/financePermissions')
const { authenticate } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const {
  separationOfDutiesConflict, SeparationOfDutiesError,
} = require('../lib/financeSeparationOfDuties')
const { FINANCE_ROLES, STAFF_ROLES } = require('../config/permissions')

const MANAGE = 'finance.users.manage_finance_roles'

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

const uuid = { type: 'string', format: 'uuid' }
const override = {
  type: 'object',
  required: ['permission_code', 'effect'],
  additionalProperties: false,
  properties: {
    permission_code: { type: 'string', minLength: 1, maxLength: 120 },
    effect: { type: 'string', enum: ['grant', 'deny'] },
    expires_at: { type: ['string', 'null'], format: 'date-time' },
    reason: { type: ['string', 'null'], maxLength: 1000 },
  },
}

async function readAccess(pg, user) {
  const [defaults, overrides, scopes, permissions] = await Promise.all([
    systemOf(pg).query(
      'SELECT permission_code FROM finance.role_permission WHERE role_name = $1 ORDER BY permission_code',
      [user.role || ''],
    ),
    systemOf(pg).query(
      `SELECT permission_code, effect, reason, granted_by, granted_at, expires_at
         FROM finance.user_permission_override WHERE user_id = $1
        ORDER BY permission_code`,
      [user.id],
    ),
    systemOf(pg).query(
      `SELECT d.id, d.code, d.name
         FROM finance.user_scope s JOIN finance.department d ON d.id = s.department_id
        WHERE s.user_id = $1 AND d.deleted_at IS NULL
        ORDER BY d.code`,
      [user.id],
    ),
    loadPermissions({ pg }, user),
  ])
  return {
    user,
    role_permissions: defaults.rows.map((r) => r.permission_code),
    overrides: overrides.rows,
    department_scope: scopes.rows,
    permissions: [...permissions].sort(),
  }
}

/**
 * What an auditor needs to see changed, without copying the person's email or other account
 * details into the audit trail. The effective permission set is included because that is the
 * thing the decision actually altered.
 */
function accessSummary(access) {
  return {
    role: access.user.role,
    overrides: access.overrides.map((o) => ({
      permission_code: o.permission_code,
      effect: o.effect,
      expires_at: o.expires_at,
    })),
    department_scope: access.department_scope.map((d) => ({ id: d.id, code: d.code })),
    permissions: access.permissions,
  }
}

async function loadTarget(pg, id, authorityId) {
  const { rows } = await systemOf(pg).query(
    `SELECT id, email, COALESCE(full_name, name) AS name, role, department, job_title,
            active, status, authority_id
       FROM public.users
      WHERE id = $1 AND deleted_at IS NULL
        AND ($2::int IS NULL OR authority_id = $2)`,
    [id, authorityId ?? null],
  )
  return rows[0] || null
}

async function financeUsersRoutes(fastify) {
  const pg = fastify.pg
  const canManage = { preHandler: requirePermission(fastify, MANAGE) }

  // Who may be given finance access. All staff are listed, because conferring a finance role starts
  // with finding the person who already has a council account; the seven finance roles are named
  // separately so the screen can offer only those.
  fastify.get('/finance/users', {
    ...canManage,
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { q = '', limit = 100, offset = 0 } = request.query
    const authorityId = request.user.authority_id ?? null
    const term = q.trim() ? `%${q.trim()}%` : null
    const { rows } = await systemOf(pg).query(
      `SELECT u.id, u.email, COALESCE(u.full_name, u.name) AS name, u.role,
              u.department, u.job_title, u.active, u.status,
              (SELECT count(*)::int FROM finance.user_permission_override o
                WHERE o.user_id = u.id) AS override_count,
              (SELECT count(*)::int FROM finance.user_scope s
                WHERE s.user_id = u.id) AS scope_count
         FROM public.users u
        WHERE u.deleted_at IS NULL
          AND ($1::int IS NULL OR u.authority_id = $1)
          AND u.role = ANY($2::text[])
          AND ($3::text IS NULL
               OR u.email ILIKE $3
               OR COALESCE(u.full_name, u.name) ILIKE $3
               OR u.role ILIKE $3)
        ORDER BY COALESCE(u.full_name, u.name), u.email
        LIMIT $4 OFFSET $5`,
      [authorityId, STAFF_ROLES, term, limit, offset],
    )
    const { rows: total } = await systemOf(pg).query(
      `SELECT count(*)::int AS count FROM public.users u
        WHERE u.deleted_at IS NULL
          AND ($1::int IS NULL OR u.authority_id = $1)
          AND u.role = ANY($2::text[])
          AND ($3::text IS NULL
               OR u.email ILIKE $3
               OR COALESCE(u.full_name, u.name) ILIKE $3
               OR u.role ILIKE $3)`,
      [authorityId, STAFF_ROLES, term],
    )
    const { rows: roleDefaults } = await systemOf(pg).query(
      'SELECT role_name, permission_code FROM finance.role_permission ORDER BY role_name, permission_code',
    )
    const roles = FINANCE_ROLES.map((name) => ({
      name,
      permissions: roleDefaults.filter((r) => r.role_name === name).map((r) => r.permission_code),
    }))
    return ok(reply, { users: rows, total: total[0].count, limit, offset, roles })
  })

  fastify.get('/finance/users/:id/access', {
    ...canManage,
    schema: { params: { type: 'object', properties: { id: uuid } } },
  }, async (request, reply) => {
    const target = await loadTarget(pg, request.params.id, request.user.authority_id)
    if (!target) return fail(reply, 404, 'not_found', 'No staff account with that id in this council.')
    return ok(reply, await readAccess(pg, target))
  })

  // Replace this person's role and overrides in one transaction. A missing field is left unchanged;
  // the two arrays, when sent, are the complete new set. That makes a save idempotent and means an
  // omitted permission removes an old override rather than silently leaving it behind.
  fastify.put('/finance/users/:id/access', {
    ...canManage,
    schema: {
      params: { type: 'object', properties: { id: uuid } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', enum: FINANCE_ROLES },
          overrides: { type: 'array', maxItems: 100, items: override },
          department_ids: { type: 'array', maxItems: 100, items: uuid },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body || {}
    if (request.params.id === request.user.id) {
      return fail(reply, 409, 'self_access',
        'You cannot change your own finance access. Ask another administrator.')
    }
    if (!body.reason) {
      return fail(reply, 400, 'reason_required',
        'Record why this access is being changed; the reason is kept in the audit trail.')
    }
    const target = await loadTarget(pg, request.params.id, request.user.authority_id)
    if (!target) return fail(reply, 404, 'not_found', 'No staff account with that id in this council.')

    const codes = [...new Set((body.overrides ?? []).map((o) => o.permission_code))]
    if (codes.length) {
      const { rows } = await systemOf(pg).query(
        'SELECT code FROM finance.permission WHERE code = ANY($1::text[])',
        [codes],
      )
      const known = new Set(rows.map((r) => r.code))
      const unknown = codes.filter((c) => !known.has(c))
      if (unknown.length) {
        return fail(reply, 400, 'unknown_permission',
          `Unknown finance permission: ${unknown.join(', ')}.`)
      }
    }
    const duplicate = (body.overrides ?? []).find(
      (o, i, all) => all.findIndex((x) => x.permission_code === o.permission_code) !== i,
    )
    if (duplicate) {
      return fail(reply, 400, 'duplicate_permission',
        `The permission ${duplicate.permission_code} appears more than once.`)
    }

    const departmentIds = [...new Set(body.department_ids ?? [])]
    if (departmentIds.length) {
      const { rows } = await systemOf(pg).query(
        `SELECT id FROM finance.department
          WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
            AND ($2::int IS NULL OR authority_id = $2)`,
        [departmentIds, request.user.authority_id ?? null],
      )
      if (rows.length !== departmentIds.length) {
        return fail(reply, 400, 'unknown_department',
          'One or more departments do not belong to this council.')
      }
    }

    const status = target.status || (target.active ? 'active' : 'suspended')
    if (status === 'suspended' || target.active === false) {
      return fail(reply, 409, 'account_inactive',
        'That account is suspended. Reactivate it in the staff console before granting finance access.')
    }

    const before = await readAccess(pg, target)

    try {
      await systemOf(pg).transact(async (client) => {
        if (body.role && body.role !== target.role) {
          await client.query('UPDATE public.users SET role = $2 WHERE id = $1', [target.id, body.role])
        }
        if (body.overrides) {
          await client.query('DELETE FROM finance.user_permission_override WHERE user_id = $1', [target.id])
          for (const o of body.overrides) {
            await client.query(
              `INSERT INTO finance.user_permission_override
                 (user_id, permission_code, effect, authority_id, reason, granted_by, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [target.id, o.permission_code, o.effect, request.user.authority_id ?? null,
                o.reason || body.reason, request.user.id, o.expires_at || null],
            )
          }
        }
        if (body.department_ids) {
          await client.query('DELETE FROM finance.user_scope WHERE user_id = $1', [target.id])
          for (const departmentId of departmentIds) {
            await client.query(
              'INSERT INTO finance.user_scope (user_id, department_id, granted_by) VALUES ($1, $2, $3)',
              [target.id, departmentId, request.user.id],
            )
          }
        }

        // SEPARATION OF DUTIES, over the RESULT (audit BLOCKER-2).
        //
        // Judged here, on the transaction's own client, so it sees the uncommitted effect of the
        // role change AND of the whole override set together. Checking each override as it is
        // written would refuse a legitimate save whose later rows deny the permission an earlier
        // row granted; checking the role defaults alone is what left this hole open.
        //
        // The rule is finance.separation_of_duties_conflict() (migration 200) — the same function
        // the deferred constraint trigger on finance.user_permission_override calls, so a future
        // caller cannot route around it. Throwing rolls the transaction back: a refused access
        // change leaves the person's access exactly as it was.
        const conflict = await separationOfDutiesConflict(client, target.id)
        if (conflict) throw new SeparationOfDutiesError(conflict)
      })
    } catch (err) {
      if (err instanceof SeparationOfDutiesError) {
        // Audited as a refusal: the attempt to dissolve the control is itself the thing an auditor
        // needs to see. The onResponse hook records any mutating request that is not a 404.
        request.auditDetails = {
          reason: body.reason,
          refused: err.refusal.error,
          conflict: err.refusal.conflict,
          attempted: {
            role: body.role ?? target.role,
            overrides: (body.overrides ?? []).map((o) => ({
              permission_code: o.permission_code, effect: o.effect,
            })),
          },
          before: accessSummary(before),
        }
        return reply.code(err.refusal.status).send({
          success: false,
          error: err.refusal.error,
          message: err.refusal.message,
          conflict: err.refusal.conflict,
        })
      }
      throw err
    }

    const updated = await loadTarget(pg, target.id, request.user.authority_id)
    const after = await readAccess(pg, updated)
    // The onResponse audit hook reads this. The reason is part of the record because a permission
    // change without a stated reason is not reviewable six months later.
    request.auditDetails = {
      reason: body.reason,
      before: accessSummary(before),
      after: accessSummary(after),
    }
    return ok(reply, after)
  })
}

module.exports = { financeUsersRoutes }
