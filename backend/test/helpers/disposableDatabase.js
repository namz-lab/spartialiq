/**
 * THE TEST DATABASE GUARD (production-readiness audit, MAJOR-7).
 *
 * WHAT HAPPENED. The finance suites connect to `APP_DATABASE_URL || DATABASE_URL` after
 * `require('dotenv').config()`, and `.env` points `DATABASE_URL` at the live development database
 * `vungu_dev`. Three of them — finance.security, finance.workflow, finance.map — were missing from
 * `scripts/test-suites.js`'s `integration` list, so a bare `npm test` ran them and they wrote real
 * rows through the real routes into the database the running application serves. A `published`
 * budget line of US$150,000 and an approved project are in `vungu_dev` now because of that, and
 * the budget line is being served to the PUBLIC transparency portal as a Vungu RDC figure. The
 * tag-and-remove `afterAll` in each suite cleans only what that run created; an interrupted run
 * leaves its rows behind for good.
 *
 * WHAT THIS DOES. Refuses to let a suite build its connection when the database is not obviously
 * disposable. `vungu_acceptance_test` is the one the finance suites' own headers document. The
 * escape hatch exists because a developer occasionally does mean it, but it has to be typed:
 *
 *     ALLOW_DEV_DB_TESTS=1 npx jest …
 *
 * It fails LOUDLY and early, before a single row is written: a suite that cannot reach a safe
 * database should stop, not quietly write to the live one.
 */
const SAFE_DATABASE_NAME = /(test|acceptance|scratch|tmp)/i

/** The database name in a connection URL, or null if it cannot be read. */
function databaseNameOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || null
  } catch {
    return null
  }
}

/**
 * Throws unless the resolved database is obviously a test one.
 *
 * @param {string} [what] what is connecting, for the message.
 * @returns {string} the connection URL, so a caller can use it directly.
 */
function assertDisposableDatabase(what = 'this test suite') {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      `No APP_DATABASE_URL or DATABASE_URL is set, so ${what} has nothing to connect to. Point it `
      + 'at a disposable database:\n'
      + "  DATABASE_URL='postgresql://postgres:postgres@localhost:5432/vungu_acceptance_test'",
    )
  }
  if (process.env.ALLOW_DEV_DB_TESTS === '1') return url
  const name = databaseNameOf(url)
  if (!name) {
    throw new Error(`The database URL could not be parsed, so it cannot be checked: ${url}`)
  }
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new Error(
      `Refusing to run ${what} against the database "${name}".\n`
      + 'These suites write real rows — financial years, budget lines, transactions, publications, '
      + 'documents — through the real routes, and a PUBLISHED test artefact in a live database is '
      + 'served to the public transparency portal as a council figure.\n'
      + 'Run them against a disposable database:\n'
      + "  DATABASE_URL='postgresql://postgres:postgres@localhost:5432/vungu_acceptance_test' "
      + 'npx jest <suite> --runInBand\n'
      + 'Prepare one with: node scripts/prepare-acceptance-db.js\n'
      + 'If you genuinely mean to write to this database, set ALLOW_DEV_DB_TESTS=1.',
    )
  }
  return url
}

/** True when the resolved database is disposable. For a warning rather than a refusal. */
function isDisposableDatabase() {
  try {
    assertDisposableDatabase()
    return true
  } catch {
    return false
  }
}

module.exports = { assertDisposableDatabase, isDisposableDatabase, databaseNameOf, SAFE_DATABASE_NAME }
