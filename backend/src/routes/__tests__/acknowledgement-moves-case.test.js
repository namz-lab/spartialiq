/**
 * Migration 248: sending the acknowledgement moves a 'registered' case to 'acknowledged', logs it, and touches nothing else.
 *
 * Against the database in DATABASE_URL, inside a transaction that is always rolled back, so it leaves nothing behind.
 * Skipped where migration 248 has not been applied yet (the trigger function does not move the status there).
 */
require('dotenv').config()
const { Client } = require('pg')

let c
let applied = false

beforeAll(async () => {
  c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const { rows } = await c.query(`SELECT prosrc FROM pg_proc WHERE proname = 'clerk_ack_records_date'`)
  applied = rows.some((r) => /status = 'acknowledged'/.test(r.prosrc))
}, 30000)
afterAll(async () => { await c?.end() })
beforeEach(async () => { await c.query('BEGIN') })
afterEach(async () => { await c.query('ROLLBACK') })

const maybe = (name, fn) => test(name, async () => { if (!applied) return console.warn('migration 248 not applied: skipped'); await fn() })

async function newCase(status) {
  const { rows } = await c.query(
    `INSERT INTO spatial_planning.permit_application (applicant_name, development_type, status)
     VALUES ('Jest Applicant', 'extension', $1) RETURNING id, revision`, [status])
  return rows[0]
}
async function letter(permitId, sent) {
  await c.query(
    `INSERT INTO spatial_planning.clerk_acknowledgement (letter_no, permit_application_id, received_at, due_by, recipient, drafted_by_name, sent_at, sent_method)
     VALUES ($1, $2, now(), now() + interval '14 days', 'Jest Applicant', 'Jest Clerk', $3, $4)`,
    ['JEST/' + permitId.slice(0, 8), permitId, sent ? new Date() : null, sent ? 'registered_post' : null])
}
const row = async (id) => (await c.query('SELECT status, revision, acknowledged_at FROM spatial_planning.permit_application WHERE id = $1', [id])).rows[0]
const events = async (id) => (await c.query(`SELECT detail FROM spatial_planning.permit_event WHERE permit_app_id = $1 AND event_type = 'status_changed'`, [id])).rows

describe('migration 248: the sent acknowledgement moves the case on', () => {
  // Once acknowledged, the case is circulated at once by the rules (migration 255) and moves on into 'circulation', so
  // the case is seen there; the acknowledgement is in its date and its own audit entry.
  maybe('a sent letter acknowledges a registered case, with its date, a new revision and an audit entry; it then goes into circulation', async () => {
    const p = await newCase('registered')
    await letter(p.id, true)
    const r = await row(p.id)
    expect(r.status).toBe('circulation')
    expect(r.acknowledged_at).not.toBeNull()
    expect(r.revision).toBeGreaterThan(p.revision)
    const ev = (await events(p.id)).map((e) => e.detail)
    expect(ev).toHaveLength(2)
    expect(ev).toContainEqual(expect.objectContaining({ status: 'acknowledged', from_status: 'registered', automatic: true }))
    expect(ev).toContainEqual(expect.objectContaining({ status: 'circulation', from_status: 'acknowledged', automatic: true }))
  })

  maybe('an unsent draft moves nothing', async () => {
    const p = await newCase('registered')
    await letter(p.id, false)
    expect((await row(p.id)).status).toBe('registered')
    expect(await events(p.id)).toHaveLength(0)
  })

  maybe('marking a draft sent later moves it then', async () => {
    const p = await newCase('registered')
    await letter(p.id, false)
    await c.query(`UPDATE spatial_planning.clerk_acknowledgement SET sent_at = now(), sent_method = 'hand' WHERE permit_application_id = $1`, [p.id])
    const r = await row(p.id)
    expect(r.acknowledged_at).not.toBeNull()
    expect(r.status).toBe('circulation')   // acknowledged, then circulated (migration 255)
  })

  maybe('a case already further on is not moved back', async () => {
    const p = await newCase('under_review')
    await letter(p.id, true)
    expect((await row(p.id)).status).toBe('under_review')
    expect(await events(p.id)).toHaveLength(0)
  })
})
