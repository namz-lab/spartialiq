/**
 * A DATE column is returned as the text "YYYY-MM-DD", the same on every machine. Without this, node-postgres returns a Date at local midnight, and on a
 * server in Harare time (UTC+2) 2026-11-16 reads as "2026-11-15T22:00:00.000Z".
 */
require('dotenv').config()
require('./pgTypes')
const { Pool } = require('pg')

describe('plain dates stay plain dates', () => {
  let pool
  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }) })
  afterAll(async () => { await pool.end() })

  test('a DATE comes back as text, and does not move with the server time zone', async () => {
    const { rows } = await pool.query("SELECT DATE '2026-11-16' AS d, DATE '2027-02-28' AS e")
    expect(rows[0].d).toBe('2026-11-16')
    expect(rows[0].e).toBe('2027-02-28')
  })

  test('a timestamp is still a moment in time', async () => {
    const { rows } = await pool.query("SELECT TIMESTAMPTZ '2026-11-16 00:30:00+02' AS t")
    expect(rows[0].t).toBeInstanceOf(Date)
    expect(rows[0].t.toISOString()).toBe('2026-11-15T22:30:00.000Z')
  })

  test('date arithmetic in SQL is unaffected', async () => {
    const { rows } = await pool.query("SELECT (DATE '2026-11-30' + INTERVAL '3 months')::date AS d")
    expect(rows[0].d).toBe('2027-02-28')
  })
})
