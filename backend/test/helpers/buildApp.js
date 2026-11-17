require('dotenv').config()
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { paymentRoutes } = require('../../src/routes/payments')
const { authRoutes } = require('../../src/routes/auth')
const { developmentManagementRoutes } = require('../../src/routes/development-management')
require('../../src/lib/pgTypes')
const { eoWorkflowRoutes } = require('../../src/routes/eo-workflow')
const { inspectorGisRoutes } = require('../../src/routes/inspector-gis')
const { inspectorRoutingRoutes } = require('../../src/routes/inspector-routing')
const { environmentalHealthRoutes } = require('../../src/routes/environmental-health')
const { appealRoutes } = require('../../src/routes/appeals')
const { surveyorRoutes } = require('../../src/routes/surveyor')
const { financeConfigRoutes } = require('../../src/routes/finance-config')
const { financeUsersRoutes } = require('../../src/routes/finance-users')
const { financeBudgetRoutes } = require('../../src/routes/finance-budget')
const { financeImportRoutes } = require('../../src/routes/finance-imports')
const { financeProjectRoutes } = require('../../src/routes/finance-projects')
const { financePublicationRoutes } = require('../../src/routes/finance-publication')
const { financeDocumentRoutes } = require('../../src/routes/finance-documents')
const { financeReportRoutes } = require('../../src/routes/finance-reports')
const { financePublicRoutes } = require('../../src/routes/finance-public')
const { financeSpatialRoutes } = require('../../src/routes/finance-spatial')
const { financeLedgerRoutes } = require('../../src/routes/finance-ledger')
const { financeLedgerReadRoutes } = require('../../src/routes/finance-ledger-reads')
const { financeAccountingRoutes } = require('../../src/routes/finance-accounting')
const { financeRatesRoutes } = require('../../src/routes/finance-rates')
const { financeCashRoutes } = require('../../src/routes/finance-cash')
const { financeMigrationRoutes } = require('../../src/routes/finance-migration')
const { financeBankRoutes } = require('../../src/routes/finance-bank')
const { financePayablesRoutes } = require('../../src/routes/finance-payables')
const { financeAssetsRoutes } = require('../../src/routes/finance-assets')

/**
 * The test-database guard lives in its own helper so the suites that build their own `pg.Pool`
 * (test/finance-spatial-allocation, finance-cross-tenant, finance-roles) share one definition
 * with the ones that build an app. See test/helpers/disposableDatabase.js for why it exists.
 */
const { assertDisposableDatabase, databaseNameOf } = require('./disposableDatabase')

async function buildAppForTest() {
  // WARNING, not a refusal — deliberately, and this is the honest limit of the fix.
  //
  // Ten suites outside the finance module build their app here and are not in
  // scripts/test-suites.js's `integration` list, so a bare `npm test` runs them: appeals,
  // committee-gate, environmental-health, inspector-routing, inspector-gis, payments.routes,
  // payments.applicationfee, permit-applications.optimistic-lock,
  // permit-applications.pending-payment and surveyor-launch. They were already writing planning
  // and payment rows into whatever DATABASE_URL names, which for .env is vungu_dev. Refusing here
  // would make `npm test` red for ten suites that are outside this change's remit, and two of
  // them (inspector-gis, inspector-routing) do not currently pass against vungu_acceptance_test,
  // so they cannot simply be moved into `integration` either.
  //
  // So: the finance surface refuses (buildFinanceAppForTest below, and the three direct-pool
  // finance suites), and this one says so. The follow-up is to seed what inspector-gis and
  // inspector-routing need in the acceptance database, move all ten into `integration`, and turn
  // this warning into the same assertDisposableDatabase() call.
  const unsafeDatabase = (() => {
    try { assertDisposableDatabase(); return null } catch { return databaseNameOf(process.env.APP_DATABASE_URL || process.env.DATABASE_URL) }
  })()
  if (unsafeDatabase) {
    // eslint-disable-next-line no-console
    console.warn(
      `[test] building an app against "${unsafeDatabase}", which is not a disposable database. `
      + 'This suite writes real rows. Prefer '
      + "DATABASE_URL='postgresql://…/vungu_acceptance_test'.",
    )
  }
  const app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL })
  // The same connection context as server.js, in whatever TENANCY_MODE says (default strict): run these suites with
  // TENANCY_MODE=strict to prove the write paths too.
  const dbContext = require('../../src/lib/dbContext')
  dbContext.install(app)
  app.addHook('onRequest', (_req, _reply, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  // Same registration as server.js: upload routes (permit documents, stage
  // photos) need request.isMultipart()/request.parts().
  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 50 * 1024 * 1024 },
  })

  // Webhook callbacks arrive as application/x-www-form-urlencoded.
  // Fastify has no built-in parser for this content-type, so we add one
  // here. The raw string is also stored as request.rawBody so the Paynow
  // signature verifier can reconstruct field order.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      req.rawBody = body
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)))
      } catch (err) {
        done(err)
      }
    },
  )
  await app.register(async (scope) => {
    await authRoutes(scope)
    await paymentRoutes(scope)
    await developmentManagementRoutes(scope)
    await eoWorkflowRoutes(scope)
    await inspectorGisRoutes(scope)
    await inspectorRoutingRoutes(scope)
    await environmentalHealthRoutes(scope)
    await appealRoutes(scope)
    await surveyorRoutes(scope)
  }, { prefix: '/api' })
  await app.ready()
  return app
}
/**
 * The finance surface, plus auth so a test can sign in.
 *
 * A separate builder rather than more routes on buildAppForTest: the finance suites assert what
 * each role CANNOT do, and keeping the planning routes out of the instance means a 403 is a 403
 * about finance and not a collision with a planning guard that happens to share a path.
 */
async function buildFinanceAppForTest({ poolMax } = {}) {
  // The finance surface refuses outright. This is the builder whose suites put a published
  // US$150,000 budget line on the public portal of the development instance (audit MAJOR-7).
  assertDisposableDatabase('a finance test suite')
  const app = Fastify({ logger: false })
  await app.register(fastifyPostgres, {
    connectionString: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
    // Tests use the plugin default (10). The load harness passes the production pool size so the
    // measurement describes the deployed configuration rather than the test one.
    ...(poolMax ? { max: poolMax } : {}),
  })
  const dbContext = require('../../src/lib/dbContext')
  dbContext.install(app)
  app.addHook('onRequest', (_req, _reply, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(require('@fastify/multipart'), { limits: { fileSize: 50 * 1024 * 1024 } })
  // The same audit hook server.js installs: the suites assert that a refused publication attempt
  // lands in the trail, which is only true if the hook is actually attached.
  await app.register(require('../../src/middleware/auditLog').auditLogPlugin)
  await app.register(async (scope) => {
    await authRoutes(scope)
    await financeConfigRoutes(scope)
    await financeUsersRoutes(scope)
    await financeBudgetRoutes(scope)
    await financeImportRoutes(scope)
    await financeProjectRoutes(scope)
    await financePublicationRoutes(scope)
    await financeDocumentRoutes(scope)
    await financeReportRoutes(scope)
    await financePublicRoutes(scope)
    await financeSpatialRoutes(scope)
    await financeLedgerRoutes(scope)
    await financeLedgerReadRoutes(scope)
    await financeAccountingRoutes(scope)
    await financeRatesRoutes(scope)
    await financeCashRoutes(scope)
    await financeMigrationRoutes(scope)
    await financeBankRoutes(scope)
    await financePayablesRoutes(scope)
    await financeAssetsRoutes(scope)
  }, { prefix: '/api' })
  await app.ready()
  return app
}

module.exports = { buildAppForTest, buildFinanceAppForTest, assertDisposableDatabase }
