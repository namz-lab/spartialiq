/**
 * guardPool: a dropped database connection is logged, never fatal.
 *
 * The second test reproduces the crash of 18 Nov 2026 for real: a client is checked out, its connection is killed from
 * another connection (pg_terminate_backend), and the process must carry on, with the pool answering the next query.
 * Without a listener on the client, Node would throw "Unhandled 'error' event" and jest would fail the run.
 */
require('dotenv').config()
const { EventEmitter } = require('node:events')
const { Pool } = require('pg')
const { guardPool, guardClient } = require('../pgResilience')

const quietLog = () => ({ warn: jest.fn() })

describe('guardPool, without a database', () => {
  test('listens on the pool and on every client it opens, once', () => {
    const pool = new EventEmitter()
    const log = quietLog()
    guardPool(pool, log, 't')
    guardPool(pool, log, 't')                          // a second call adds nothing
    expect(pool.listenerCount('error')).toBe(1)
    expect(pool.listenerCount('connect')).toBe(1)

    const client = new EventEmitter()
    pool.emit('connect', client)
    expect(client.listenerCount('error')).toBe(1)
    expect(() => client.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow()
    expect(() => pool.emit('error', new Error('idle client closed'))).not.toThrow()
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  test('guards a client the pool opened before it was guarded', () => {
    const early = new EventEmitter()
    const pool = Object.assign(new EventEmitter(), { _clients: [early] })
    guardPool(pool, quietLog())
    expect(early.listenerCount('error')).toBe(1)
    expect(guardClient(early, quietLog())).toBe(early)  // and only once
    expect(early.listenerCount('error')).toBe(1)
  })
})

describe('guardPool, against the database', () => {
  let pool, killer
  beforeAll(() => {
    pool = guardPool(new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }), quietLog(), 'test')
    killer = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  })
  afterAll(async () => { await pool.end(); await killer.end() })

  test('a checked-out connection that is killed is logged, and the pool still answers', async () => {
    const client = await pool.connect()
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const dropped = new Promise((resolve) => client.once('error', resolve))

    await killer.query('SELECT pg_terminate_backend($1)', [pid])
    await dropped                                          // the event fired, and did not end the process
    await expect(client.query('SELECT 1')).rejects.toThrow()
    client.release(true)                                   // a broken client is discarded, not returned to the pool

    const { rows } = await pool.query('SELECT 1 AS ok')
    expect(rows[0].ok).toBe(1)
  }, 30000)
})
