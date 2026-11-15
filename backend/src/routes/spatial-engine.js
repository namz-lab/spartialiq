/**
 * The spatial engine's API: ward measures for the Chief Executive's maps.
 *
 *   GET  /api/executive/maps            accounting_officer   the measures, the ward register's state, the last run
 *   GET  /api/executive/maps/:measure   accounting_officer   one measure as GeoJSON over the council's wards
 *   GET  /api/executive/wards/:code     accounting_officer   one ward across every measure, grouped by unit
 *   GET  /api/executive/ward-table      accounting_officer   every ward as a row, every measure and register count as a column, with totals
 *   POST /api/spatial-engine/refresh    admin, gis_officer, gis_head   recompute every measure
 *
 * A unit head reads their own unit's measures through GET /api/units/:key/maps (src/routes/units.js); both use
 * src/lib/wardMaps.js, which also documents how a map says what its colours stand on.
 *
 * fastify.pg is request-scoped (src/lib/dbContext.js), so row-level security confines every query to the
 * caller's council; the system plane is not used.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { createWardMaps } = require('../lib/wardMaps')
const { EXECUTIVE_ROLES } = require('./executive-overview')

// The GIS Branch is the custodian of the engine; the chief executive reads, and does not run it.
const REFRESH_ROLES = ['admin', 'gis_officer', 'gis_head']

const WARD_CODE = /^[A-Za-z0-9_.\-]{1,64}$/

async function spatialEngineRoutes(fastify) {
  const pg = fastify.pg
  const maps = createWardMaps(pg)

  const send = (reply, result) =>
    result.status
      ? reply.code(result.status).send({ success: false, error: result.error, message: result.message })
      : reply.send({ success: true, data: result.data })

  fastify.get('/executive/maps', { preHandler: requireRole(fastify, EXECUTIVE_ROLES) }, async (_request, reply) =>
    reply.send({ success: true, data: await maps.index() }))

  fastify.get('/executive/maps/:measure', { preHandler: requireRole(fastify, EXECUTIVE_ROLES) }, async (request, reply) =>
    send(reply, await maps.map(request.params.measure)))

  fastify.get('/executive/ward-table', { preHandler: requireRole(fastify, EXECUTIVE_ROLES) }, async (_request, reply) =>
    send(reply, await maps.table()))

  fastify.get('/executive/wards/:code', { preHandler: requireRole(fastify, EXECUTIVE_ROLES) }, async (request, reply) => {
    if (!WARD_CODE.test(request.params.code)) return reply.code(400).send({ success: false, error: 'bad_ward', message: 'Not a ward code.' })
    return send(reply, await maps.wardProfile(request.params.code))
  })

  fastify.post('/spatial-engine/refresh', { preHandler: requireRole(fastify, REFRESH_ROLES) }, async (request, reply) => {
    try {
      const { rows: [r] } = await pg.query('SELECT spatial_engine.refresh() AS run_id')
      const { rows: [run] } = await pg.query(
        'SELECT id, status, wards, ward_register_basis, detail, finished_at FROM spatial_engine.run WHERE id = $1', [r.run_id])
      return reply.send({ success: true, data: run })
    } catch (err) {
      request.log.error({ err }, 'spatial engine refresh failed')
      return reply.code(500).send({ success: false, error: 'refresh_failed', message: 'The spatial engine could not be refreshed.' })
    }
  })
}

module.exports = { spatialEngineRoutes, REFRESH_ROLES }
