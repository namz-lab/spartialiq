/**
 * The Chief Executive's overview: one read-only document that follows the council's Executive Arm
 * (https://vungurdc.org.zw/our-team/): Finance, Planning, Engineering, Social Services, Human
 * Resources and Administration, and Internal Audit.
 *
 *   GET /api/executive/overview     accounting_officer only
 *   GET /api/executive/master-plan  accounting_officer only: the master plan's standing, adoption, zones, coverage and use (src/services/executiveMasterPlan.js)
 *
 * WHAT IT IS NOT
 * It reads nothing the departments do not already own and writes nothing. Finance is not repeated
 * here: the page also calls GET /api/finance/dashboards/executive, which the same role may read.
 *
 * The sections themselves live in src/services/unitSections.js, shared with the unit dashboards
 * (src/routes/units.js), and carry the honesty rule (`loaded`, `note`, `unavailable`).
 *
 * TENANCY
 * fastify.pg is request-scoped (src/lib/dbContext.js): row-level security confines every query to the
 * caller's council. The system plane is deliberately not used.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { createUnitSections } = require('../services/unitSections')
const executiveMasterPlan = require('../services/executiveMasterPlan')

// The chief executive is the accounting officer. The IT administrator is not listed: IT issues the
// accounts and does not read the council's figures.
const EXECUTIVE_ROLES = ['accounting_officer']

async function executiveOverviewRoutes(fastify) {
  const sections = createUnitSections(fastify.pg, fastify.log)

  fastify.get('/executive/overview', {
    preHandler: requireRole(fastify, EXECUTIVE_ROLES),
  }, async (_request, reply) => {
    const [planning, land, engineering, socialServices, hr, audit] = await Promise.all(
      ['planning', 'land', 'engineering', 'social_services', 'hr', 'audit'].map(sections.read))
    return reply.send({
      success: true,
      data: { as_of: new Date().toISOString(), planning, land, engineering, social_services: socialServices, hr, audit },
    })
  })

  // The master plan, for the chief executive: read-only, from the registers the planner and the workbench keep.
  fastify.get('/executive/master-plan', {
    preHandler: requireRole(fastify, EXECUTIVE_ROLES),
  }, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await executiveMasterPlan.read(fastify.pg) })
    } catch (err) {
      request.log.error({ err }, 'executive master plan failed')
      return reply.code(500).send({ success: false, error: 'internal', message: 'The master plan could not be read.' })
    }
  })
}

module.exports = { executiveOverviewRoutes, EXECUTIVE_ROLES }
