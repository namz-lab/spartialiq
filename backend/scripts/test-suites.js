/**
 * The test suites that cannot run in a bare `npm test`, and what each one needs.
 *
 * This file is the single source of truth. Three callers read it:
 *   - jest.config.js                  excludes every listed suite from `npm test`
 *   - scripts/prepare-acceptance-db.js  builds the database, runs `integration`
 *   - scripts/run-live-server-tests.js   boots a server, runs `live`
 *
 * Keeping one list means a suite cannot be excluded from `npm test` while some
 * other command forgets to run it -- which is how tests quietly stop being run
 * at all.
 *
 * The split is by *prerequisite*, not by subject matter. A suite earns a place
 * here when `npm test` fails on it for want of something the suite cannot
 * reasonably build for itself.
 */

/**
 * Need seeded data: demo users, the Tsamba township, and the migration chain.
 * These build their app in-process with app.inject, so no listening port is
 * required -- only a prepared database.
 *
 *   finance.acceptance   the finance demo accounts and the migration-188 schema; walks the
 *                        acceptance criteria A1-A10 from the impact note end to end
 *   finance.access-control  the four access-control blockers from the production-readiness audit:
 *                        the public surface under an authenticated council session, separation of
 *                        duties over the effective permission set, document withdrawal, and the
 *                        published_select policy on finance.spatial_allocation
 *   finance.rates        rates billing end to end through the real routes: readiness, the roll,
 *                        a tariff drafted by one officer and approved by another, a run raised
 *                        by the officer and committed by the Director, a receipt, the arrears and
 *                        their reconciliation to the receivable control. Posts to the ledger,
 *                        which is insert-only, so it removes its own rows with the immutability
 *                        trigger disabled -- one more reason it needs a disposable database
 *   finance.cash         the cash office end to end through the real routes: a counter and its
 *                        income list, a till opened and cashed up short, verification by a second
 *                        person, the banking, and what each new role cannot do
 *   finance.cash.lifecycle  migration 208: suspend and resume, a session found abandoned, the
 *                        witnessed supervised count, verification by a fourth person, assignment,
 *                        the session history and the audit trail
 *   finance.security     the adversarial suite: what each caller CANNOT do. Builds a real app and
 *                        writes real rows, so it needs a disposable database like the rest
 *   finance.workflow     the budget cycle end to end through the real routes
 *   finance.map          the ward roll-ups; inserts a financial year of its own
 *   finance.spatial-map  the GIS-finance map surface: the provisional ward register (D11),
 *                        project physical progress (D12), the department scope on the ward map,
 *                        the project map, and the public ward map. Runs migration 201 against
 *                        its own fixture geography and restores the register afterwards
 *   finance-spatial-allocation  the split table and the ward roll-ups (migrations 198-199);
 *                        builds a second fictional authority and finance fixtures of its own
 *   finance-cross-tenant the published_select cross-tenant closure (migration 197); writes a
 *                        published year and a department
 *   geometry-validation  a self-minted user session; asserts the geometry and
 *                        migration 107 topology gates
 *   gms.acceptance       demo users with the GIS roles + the Tsamba township
 *   gms.editing          same
 *   gms.inbound-authority  the inbound ERP authority contract; builds its own
 *                        parcels and a second fictional authority, needs no seed
 *   permit-workflow      demo.planner and demo.admin (statutory chain, EO gate)
 *   soft-delete          a session, and rows of its own to tombstone
 *   stand-allocation     a session; places stands against the topology trigger
 *
 * Run with: npm run test:db
 */
/*
 * MAJOR-7 (production-readiness audit): finance.security, finance.workflow and finance.map were
 * absent from this list, so a bare `npm test` ran them -- and because they build a real app
 * against DATABASE_URL, which .env points at the live development database, they wrote synthetic
 * finance rows into it. One such row reached the public transparency portal in `published` state.
 * They belong here with the other suites that need a prepared, disposable database;
 * test/helpers/buildApp.js now refuses a database whose name is not obviously a test one.
 */
const integration = [
  'src/routes/__tests__/finance.acceptance.test.js',
  'src/routes/__tests__/finance.access-control.test.js',
  'src/routes/__tests__/finance.rates.test.js',
  'src/routes/__tests__/finance.cash.test.js',
  'src/routes/__tests__/finance.cash.lifecycle.test.js',
  'src/routes/__tests__/finance.security.test.js',
  'src/routes/__tests__/finance.workflow.test.js',
  'src/routes/__tests__/finance.map.test.js',
  'src/routes/__tests__/finance.spatial-map.test.js',
  'test/finance-spatial-allocation.test.js',
  'test/finance-cross-tenant.test.js',
  'src/routes/__tests__/geometry-validation.test.js',
  'src/routes/__tests__/gms.acceptance.test.js',
  'src/routes/__tests__/gms.editing.test.js',
  'src/routes/__tests__/gms.inbound-authority.test.js',
  'src/routes/__tests__/permit-workflow.test.js',
  'src/routes/__tests__/soft-delete.test.js',
  'src/routes/__tests__/stand-allocation.test.js',
]

/**
 * Need a server actually listening on PORT -- they drive the real HTTP surface
 * over axios rather than app.inject, so no in-process Fastify instance will do.
 *
 *   permit-applications.citizen  the citizen-facing permit endpoints end to end
 *   surveyor.routes              the surveyor mobile API end to end
 *
 * These fail with ECONNREFUSED, not an assertion, when the server is down --
 * which reads like a broken feature but only means nobody started it.
 *
 * Run with: npm run test:live
 */
const live = [
  'src/routes/__tests__/permit-applications.citizen.test.js',
  'src/routes/__tests__/surveyor.routes.test.js',
]

module.exports = { integration, live }
