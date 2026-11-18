/**
 * A dropped database connection must never stop the server.
 *
 * A hosted database (Neon) closes connections it considers idle, and any database can drop one. node-postgres reports that
 * as an 'error' EVENT, and an 'error' event with no listener is fatal in Node: the process exits ("Unhandled 'error' event
 * ... Connection terminated unexpectedly", 18 Nov 2026). There are two places it can be emitted:
 *
 *   * on the POOL, for a client sitting idle in it: server.js has listened there since the first such crash;
 *   * on the CLIENT, for a client a route or worker has checked out (pool.connect(), a transaction, the email worker's tick).
 *     Nothing listened there, and that is what still brought the server down.
 *
 * guardPool listens in both places. A connection that drops while in use fails the query running on it (the route answers
 * with its usual error), and node-postgres discards the broken client when it is released; the next query gets a new
 * connection. Nothing is retried here: whether to retry is the caller's business.
 */

/**
 * @param {import('pg').Pool} pool
 * @param {{ warn: Function }} [log]
 * @param {string} [name]  which pool, for the log
 * @returns the same pool
 */
function guardPool(pool, log = console, name = 'db') {
  if (!pool || pool.__droppedConnectionGuard) return pool
  pool.on('error', (err) => {
    log.warn({ err: err && err.message, pool: name }, '[db] an idle connection was closed by the server; it will be replaced')
  })
  pool.on('connect', (client) => guardClient(client, log, name))
  // clients the pool opened before it was guarded (pg-pool keeps them in _clients)
  for (const client of pool._clients || []) guardClient(client, log, name)
  Object.defineProperty(pool, '__droppedConnectionGuard', { value: true })
  return pool
}

/** One client: a listener for its whole life, so a dropped connection is logged rather than fatal. */
function guardClient(client, log = console, name = 'db') {
  if (!client || client.__droppedConnectionGuard) return client
  client.on('error', (err) => {
    log.warn({ err: err && err.message, pool: name }, '[db] a connection in use was closed; its query fails and the next one gets a new connection')
  })
  Object.defineProperty(client, '__droppedConnectionGuard', { value: true })
  return client
}

module.exports = { guardPool, guardClient }
