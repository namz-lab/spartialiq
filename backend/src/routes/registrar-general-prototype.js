/**
 * PROTOTYPE Registrar-General identity verification API (migration 258), for demonstration. Fictional register.
 *
 * The service, as a client (a council, a bank) sees it:
 *   GET  /api/rg-prototype/v1/status                        is the service up, and what it answers (no key needed)
 *   POST /api/rg-prototype/v1/verifications                 verify a document's particulars       header X-RG-Client-Key
 *        { document_type: 'national_id' | 'passport', document_number, surname, first_names?, date_of_birth?, purpose }
 *     -> { reference, checked_at, document_found, document_status, fields: { surname, first_names, date_of_birth }, outcome }
 *        each field: 'match' | 'partial' (first names given by initial or in part) | 'no_match' | 'not_supplied'
 *        outcome: 'match' | 'partial' | 'no_match' | 'not_found'
 *   GET  /api/rg-prototype/v1/verifications/:reference      a client reads back one of its own answers
 *
 * Verify, do not disclose: the answer says whether what was sent agrees, never what the register holds.
 *
 * The Registrar-General's own view, for the demonstration (staff sign-in):
 *   GET  /api/rg-prototype/console                          who asked what, with what outcome; the register's size
 *
 * The service reads its schema through the system connection: it is not the council's data, and no council officer's
 * session can read it.
 */
const { requireRole } = require('../middleware/jwtAuth')
const { systemOf } = require('../lib/dbContext')
const rg = require('../services/rgPrototype')

const CONSOLE_ROLES = ['admin', 'accounting_officer', 'planning_clerk']
const mask = (n) => (n && n.length > 5 ? n.slice(0, 2) + '•'.repeat(n.length - 5) + n.slice(-3) : n)

async function registrarGeneralPrototypeRoutes(fastify) {
  const sys = () => systemOf(fastify.pg)
  const available = async () => (await sys().query(`SELECT to_regclass('rg_prototype.population_register') IS NOT NULL AS ok`)).rows[0].ok

  fastify.get('/rg-prototype/v1/status', async (_request, reply) => {
    const up = await available()
    return reply.code(up ? 200 : 503).send({
      service: 'Registrar-General identity verification (PROTOTYPE)',
      version: '0.1',
      status: up ? 'up' : 'not installed',
      notice: 'A demonstration: the register holds fictional people. The answer says whether particulars agree; it never returns the register\'s data.',
      document_types: rg.DOCUMENT_TYPES,
      purposes: rg.PURPOSES,
      field_answers: ['match', 'partial', 'no_match', 'not_supplied'],
      outcomes: ['match', 'partial', 'no_match', 'not_found'],
      document_statuses: ['valid', 'expired', 'cancelled', 'reported_lost_or_stolen', 'holder_deceased'],
    })
  })

  fastify.post('/rg-prototype/v1/verifications', async (request, reply) => {
    if (!(await available())) return reply.code(503).send({ error: 'not_installed', message: 'The prototype register is not installed on this system.' })
    const client = await rg.clientFor(sys(), request.headers['x-rg-client-key'])
    if (!client) return reply.code(401).send({ error: 'unknown_client', message: 'A client key issued by the Registrar-General is required (header X-RG-Client-Key).' })
    const b = request.body || {}
    const problems = rg.problemsOf(b)
    if (problems.length) return reply.code(400).send({ error: 'bad_request', message: problems.join(' '), problems })
    const answer = await rg.verify(sys(), client, b)
    return reply.code(200).send(answer)
  })

  fastify.get('/rg-prototype/v1/verifications/:reference', async (request, reply) => {
    if (!(await available())) return reply.code(503).send({ error: 'not_installed' })
    const client = await rg.clientFor(sys(), request.headers['x-rg-client-key'])
    if (!client) return reply.code(401).send({ error: 'unknown_client' })
    const { rows } = await sys().query(
      `SELECT reference, requested_at AS checked_at, document_type, document_status, fields, outcome, purpose
         FROM rg_prototype.verification WHERE reference = $1 AND client_id = $2`, [request.params.reference, client.id])
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: 'No verification with that reference was made by this client.' })
    return reply.send(rows[0])
  })

  fastify.get('/rg-prototype/console', { preHandler: requireRole(fastify, CONSOLE_ROLES) }, async (_request, reply) => {
    if (!(await available())) return reply.code(503).send({ success: false, error: 'not_installed', message: 'The prototype register is not installed on this system.' })
    const [register, outcomes, recent] = await Promise.all([
      sys().query(`SELECT (SELECT count(*)::int FROM rg_prototype.population_register) AS national_ids,
                          (SELECT count(*)::int FROM rg_prototype.passport) AS passports,
                          (SELECT count(*)::int FROM rg_prototype.client WHERE active) AS clients`),
      sys().query(`SELECT outcome, count(*)::int AS n FROM rg_prototype.verification GROUP BY outcome`),
      sys().query(`SELECT v.reference, v.requested_at, c.name AS client, v.document_type, v.document_number, v.particulars_sent,
                          v.outcome, v.document_status, v.fields, v.purpose
                     FROM rg_prototype.verification v JOIN rg_prototype.client c ON c.id = v.client_id
                    ORDER BY v.requested_at DESC LIMIT 50`),
    ])
    return reply.send({
      success: true,
      data: {
        register: register.rows[0],
        outcomes: Object.fromEntries(outcomes.rows.map((r) => [r.outcome, r.n])),
        // The console shows the numbers asked about masked: even the demonstration shows the habit.
        recent: recent.rows.map((r) => ({ ...r, document_number: mask(r.document_number) })),
      },
    })
  })
}

module.exports = { registrarGeneralPrototypeRoutes }
