/**
 * Unit dashboards: one page per Executive Arm unit, which the Chief Executive drills into from the overview.
 *
 *   GET /api/units                      accounting_officer (all five) or a unit head (their own)
 *   GET /api/units/:key                 the unit: head, establishment (posts, holders, vacancies), sections, measures
 *   GET /api/units/:key/maps            the unit's own ward measures
 *   GET /api/units/:key/ward-table      the unit's wards as a table, with totals
 *   GET /api/units/:key/maps/:measure   one of them as GeoJSON over the council's wards
 *
 * ACCESS (src/config/units.js `canSeeUnit`): the Chief Executive sees every unit; a unit's head sees only
 * that unit; any other staff role is refused. The server decides; the browser's route guard is a courtesy.
 *
 * The sections are the same readers the Chief Executive's overview uses (src/services/unitSections.js), so a
 * figure on a unit page and the same figure on the overview cannot differ. The same honesty rule applies: a
 * register with nothing in it says so, and a unit with no ward measure (internal audit) says that instead
 * of showing an empty map.
 *
 * The establishment comes from the organisation chart (public.admin_org_position). A post with no holder is
 * a vacancy and is shown as one; the holder's name is shown only if the holder belongs to this council.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const { createUnitSections } = require('../services/unitSections')
const { createWardMaps } = require('../lib/wardMaps')
const { UNIT_ROLES_ALL, unitByKey, canSeeUnit, visibleUnits } = require('../config/units')

async function unitRoutes(fastify) {
  const pg = fastify.pg
  const sections = createUnitSections(pg, fastify.log)
  const maps = createWardMaps(pg)
  const guard = requireRole(fastify, UNIT_ROLES_ALL)

  /** The unit's posts. The org chart is not tenant-scoped, so a holder from another council is shown as a vacancy. */
  async function establishment(unit, authorityId) {
    const { rows } = await systemOf(pg).query(
      `SELECT p.id, p.title, p.system_role,
              CASE WHEN u.id IS NOT NULL AND u.authority_id IS NOT DISTINCT FROM $2
                   THEN COALESCE(u.full_name, u.name) END AS holder_name
         FROM public.admin_org_position p
         LEFT JOIN public.users u ON u.id = p.holder_id AND u.deleted_at IS NULL
        WHERE p.unit_key = $1
        ORDER BY (p.system_role = $3) DESC, p.sort_order, p.title`,
      [unit.key, authorityId, unit.headRole])
    const posts = rows.map((r) => ({
      id: r.id, title: r.title, system_role: r.system_role, holder_name: r.holder_name ?? null,
      vacant: r.holder_name === null, is_head: r.system_role === unit.headRole,
    }))
    return { posts, total: posts.length, vacant: posts.filter((p) => p.vacant).length }
  }

  const summary = (unit) => ({ key: unit.key, label: unit.label, post: unit.post, desks: unit.desks })

  /** Resolve :key and the caller's right to it; replies and returns null when refused. */
  function authorise(request, reply) {
    const unit = unitByKey(request.params.key)
    if (!unit) { reply.code(404).send({ success: false, error: 'not_found', message: 'No such unit.' }); return null }
    if (!canSeeUnit(request.user, unit.key)) {
      reply.code(403).send({ success: false, error: 'forbidden', message: 'This unit is not yours to open.' })
      return null
    }
    return unit
  }

  fastify.get('/units', { preHandler: guard }, async (request, reply) => {
    const out = []
    for (const unit of visibleUnits(request.user)) {
      const est = await establishment(unit, request.user.authority_id ?? null)
      const head = est.posts.find((p) => p.is_head) ?? null
      out.push({ ...summary(unit), head: head && { title: head.title, holder_name: head.holder_name, vacant: head.vacant }, vacancies: est.vacant })
    }
    return reply.send({ success: true, data: out })
  })

  fastify.get('/units/:key', { preHandler: guard }, async (request, reply) => {
    const unit = authorise(request, reply)
    if (!unit) return
    const [est, secs, index] = await Promise.all([
      establishment(unit, request.user.authority_id ?? null),
      Promise.all((unit.sections ?? []).map(async (name) => [name, await sections.read(name)])),
      maps.index(unit.key),
    ])
    return reply.send({
      success: true,
      data: {
        unit: summary(unit),
        as_of: new Date().toISOString(),
        head: est.posts.find((p) => p.is_head) ?? null,
        establishment: est,
        sections: Object.fromEntries(secs),
        // A unit with no ward measure says so; the screen must not draw an empty map for it.
        maps: { ...index, has_measures: index.measures.length > 0 },
      },
    })
  })

  fastify.get('/units/:key/maps', { preHandler: guard }, async (request, reply) => {
    const unit = authorise(request, reply)
    if (!unit) return
    return reply.send({ success: true, data: await maps.index(unit.key) })
  })

  // The unit's wards as a table (its own measures; the planning unit also gets the register counts): the same rules as the Chief Executive's.
  fastify.get('/units/:key/ward-table', { preHandler: guard }, async (request, reply) => {
    const unit = authorise(request, reply)
    if (!unit) return
    const result = await maps.table(unit.key)
    return reply.send({ success: true, data: result.data })
  })

  fastify.get('/units/:key/maps/:measure', { preHandler: guard }, async (request, reply) => {
    const unit = authorise(request, reply)
    if (!unit) return
    const result = await maps.map(request.params.measure, unit.key)
    return result.status
      ? reply.code(result.status).send({ success: false, error: result.error, message: result.message })
      : reply.send({ success: true, data: result.data })
  })
}

module.exports = { unitRoutes }
