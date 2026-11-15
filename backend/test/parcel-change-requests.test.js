/**
 * Stand boundary changes as proposals (migration 229, src/routes/parcel-change-requests.js), through the real routes and the real
 * authentication middleware, against scratch stands far from real data. Nothing here changes a boundary in the register: the proposals are
 * checked, submitted, decided and withdrawn; the survey import that closes them is tested with that import.
 */
require('dotenv').config({ quiet: true })
const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')
const Fastify = require('fastify')
const fastifyPostgres = require('@fastify/postgres')
const fastifyCookie = require('@fastify/cookie')
const { parcelChangeRequestRoutes } = require('../src/routes/parcel-change-requests')
const { createSession } = require('../src/middleware/jwtAuth')
const dbContext = require('../src/lib/dbContext')

const TOWNSHIP = `JT${randomUUID().slice(0, 6).toUpperCase()}`
const ROLES = { drafter: 'planner', other: 'planner', decider: 'gis_data', viewer: 'viewer' }
const people = Object.fromEntries(Object.entries(ROLES).map(([k, role]) => [k, { id: randomUUID(), role }]))
const sessions = []
const sup = new Pool({ connectionString: process.env.DATABASE_URL })
let app
const parcelIds = []
const requestIds = []

// A square of side `d` degrees at (x, y), far from real data (about 1 degree east, 1 degree north of the origin).
const sq = (x, y, d = 0.002) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] })
const half = (x, y, d, left) => {
  const x0 = left ? x : x + d / 2
  const x1 = left ? x + d / 2 : x + d
  return { type: 'Polygon', coordinates: [[[x0, y], [x1, y], [x1, y + d], [x0, y + d], [x0, y]]] }
}
let seq = 0
/** A current stand of the register at (x, y). */
async function mkStand(x, y, d = 0.002, extra = {}) {
  const id = `JEST-CR-${process.pid}-${++seq}`
  await sup.query(
    `INSERT INTO land.parcel (parcel_id, stand_no, township_code, geom_source, source_srid, geom_wgs84, area_m2, source, custodian_dept, status,
                              allocation_status, valid_from, parcel_kind, origin)
     SELECT $1, $2, $3, g, 4326, g, GREATEST(ST_Area(g::geography), 1), 'jest', 'Survey Section', 'current', $5, CURRENT_DATE, 'stand', 'custodian'
       FROM (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)) AS g) x`,
    [id, `CR-${seq}`, TOWNSHIP, JSON.stringify(sq(x, y, d)), extra.allocation || 'unallocated'])
  parcelIds.push(id)
  return id
}
const headers = (who) => ({ authorization: `Bearer ${people[who].token}` })
const post = (url, who, payload) => app.inject({ method: 'POST', url, headers: headers(who), payload })
const draft = async (who, body) => {
  const res = await post('/api/parcel-change-requests', who, body)
  if (res.statusCode === 201) requestIds.push(res.json().data.id)
  return res
}
const split = (parent, x, y, d = 0.002) => ({
  kind: 'split', reason: 'two stands', parent_ids: [parent],
  items: [{ role: 'child', label: 'A', geometry: half(x, y, d, true) }, { role: 'child', label: 'B', geometry: half(x, y, d, false) }],
})

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(fastifyPostgres, { connectionString: process.env.DATABASE_URL })
  dbContext.install(app)
  app.addHook('onRequest', (_q, _r, done) => dbContext.runWithRequest(done))
  await app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET })
  await app.register(parcelChangeRequestRoutes, { prefix: '/api' })
  await app.ready()
  for (const [k, p] of Object.entries(people)) {
    p.email = `jesttest-pcr-${k}-${p.id}@example.test`
    await dbContext.systemOf(app.pg).query(
      `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
       VALUES ($1, $2, 'Jest PCR', 'Jest PCR', $3, true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)
       ON CONFLICT (id) DO NOTHING`, [p.id, p.email, p.role])
    const { accessToken, sid } = await createSession(app, { id: p.id, role: p.role, email: p.email }, null)
    p.token = accessToken
    sessions.push(sid)
  }
}, 60000)

afterAll(async () => {
  const s = dbContext.systemOf(app.pg)
  if (requestIds.length) {
    const { rows } = await sup.query('SELECT survey_task_id FROM land.parcel_change_request WHERE id = ANY($1::uuid[]) AND survey_task_id IS NOT NULL', [requestIds])
    await sup.query('DELETE FROM land.parcel_change_request WHERE id = ANY($1::uuid[])', [requestIds])
    if (rows.length) await sup.query('DELETE FROM spatial_planning.survey_task WHERE id = ANY($1::uuid[])', [rows.map((r) => r.survey_task_id)])
  }
  const c = await sup.connect()
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL gms.purge = 'on'")
    await c.query('DELETE FROM land.parcel WHERE parcel_id = ANY($1::text[])', [parcelIds])
    await c.query('COMMIT')
  } finally { c.release() }
  for (const sid of sessions) await s.query('DELETE FROM public.user_session WHERE id = $1', [sid])
  for (const p of Object.values(people)) await s.query('DELETE FROM users WHERE id = $1', [p.id])
  await sup.end()
  await app.close()
}, 60000)

describe('proposals to change stand boundaries', () => {
  test('a person without a drafting role is refused', async () => {
    const res = await post('/api/parcel-change-requests', 'viewer', {})
    expect(res.statusCode).toBe(403)
  })

  test('a malformed proposal is a 400, a stand that does not exist a 422', async () => {
    expect((await post('/api/parcel-change-requests', 'drafter', { kind: 'carve' })).statusCode).toBe(400)
    const ghost = await post('/api/parcel-change-requests', 'drafter', split('NO-SUCH-STAND', 1, 1))
    expect(ghost.statusCode).toBe(422)
    expect(ghost.json().error).toBe('unknown_stand')
  })

  test('a valid split is drafted with no problems, submitted, and opens a survey task for the Survey Section', async () => {
    const parent = await mkStand(1.0, 1.0)
    const res = await draft('drafter', split(parent, 1.0, 1.0))
    expect(res.statusCode).toBe(201)
    const d = res.json().data
    expect(d.status).toBe('draft')
    expect(d.problems).toEqual([])
    expect(d.items).toHaveLength(2)
    expect(d.parents[0].parcel_id).toBe(parent)

    const sub = await post(`/api/parcel-change-requests/${d.id}/submit`, 'drafter')
    expect(sub.statusCode).toBe(200)
    expect(sub.json().data.status).toBe('submitted')
    const { rows: [task] } = await sup.query('SELECT task_type, status, assigned_to, stand_number FROM spatial_planning.survey_task WHERE id = $1', [sub.json().data.survey_task_id])
    expect(task).toMatchObject({ task_type: 'subdivision', status: 'assigned', assigned_to: null })
    expect(task.stand_number).toMatch(/^CR-/)
  })

  test('a proposal is checked: items outside the parent, overlapping items, the wrong shape, a stand that is not current', async () => {
    const parent = await mkStand(1.1, 1.0)
    const codes = async (body) => {
      const res = await draft('drafter', body)
      return res.json().data.problems.map((p) => p.code)
    }
    // a child drawn beyond the parent
    expect(await codes({ ...split(parent, 1.1, 1.0), items: [
      { role: 'child', geometry: half(1.1, 1.0, 0.002, true) }, { role: 'child', geometry: sq(1.1011, 1.0, 0.003) }] })).toContain('items_outside_parents')
    // two children that overlap
    expect(await codes({ ...split(parent, 1.1, 1.0), items: [
      { role: 'child', geometry: sq(1.1, 1.0, 0.002) }, { role: 'child', geometry: sq(1.1005, 1.0, 0.0015) }] })).toContain('items_overlap')
    // a split with one child
    expect(await codes({ ...split(parent, 1.1, 1.0), items: [{ role: 'child', geometry: sq(1.1, 1.0) }] })).toEqual(['wrong_shape'])
    // a parent that is retired
    const old = await mkStand(1.2, 1.0)
    await sup.query("UPDATE land.parcel SET status = 'retired' WHERE parcel_id = $1", [old])
    expect(await codes(split(old, 1.2, 1.0))).toContain('parent_not_current')
  })

  test('a reshape that runs into a neighbouring stand is reported, and a stand that is allocated cannot be changed', async () => {
    const a = await mkStand(1.3, 1.0)
    await mkStand(1.3021, 1.0)                       // the neighbour, just east of a
    const into = { kind: 'reshape', parent_ids: [a], items: [{ role: 'revised', parent_parcel_id: a, geometry: sq(1.3, 1.0, 0.0035) }] }
    const res = await draft('drafter', into)
    expect(res.json().data.problems.map((p) => p.code)).toContain('overlaps_parcel')

    const sold = await mkStand(1.4, 1.0, 0.002, { allocation: 'allocated' })
    const res2 = await draft('drafter', split(sold, 1.4, 1.0))
    expect(res2.json().data.problems.map((p) => p.code)).toContain('parent_reserved_or_allocated')
    const sub = await post(`/api/parcel-change-requests/${res2.json().data.id}/submit`, 'drafter')
    expect(sub.statusCode).toBe(422)
    expect(sub.json().error).toBe('has_problems')
  })

  test('a stand can be in one open proposal at a time', async () => {
    const parent = await mkStand(1.5, 1.0)
    const first = (await draft('drafter', split(parent, 1.5, 1.0))).json().data
    expect((await post(`/api/parcel-change-requests/${first.id}/submit`, 'drafter')).statusCode).toBe(200)
    const second = (await draft('other', split(parent, 1.5, 1.0))).json().data
    const sub = await post(`/api/parcel-change-requests/${second.id}/submit`, 'other')
    expect(sub.statusCode).toBe(422)
    expect(sub.json().problems.map((p) => p.code)).toContain('parent_in_open_request')
  })

  test('the Survey Section decides, never the drafter; return and reject need a reason; a decided proposal is not decided twice', async () => {
    const parent = await mkStand(1.6, 1.0)
    const d = (await draft('drafter', split(parent, 1.6, 1.0))).json().data
    expect((await post(`/api/parcel-change-requests/${d.id}/accept`, 'decider')).statusCode).toBe(409)       // still a draft
    await post(`/api/parcel-change-requests/${d.id}/submit`, 'drafter')
    expect((await post(`/api/parcel-change-requests/${d.id}/accept`, 'drafter')).statusCode).toBe(403)        // a drafter without the deciding role
    expect((await post(`/api/parcel-change-requests/${d.id}/return`, 'decider', {})).statusCode).toBe(400)    // no reason
    const accepted = await post(`/api/parcel-change-requests/${d.id}/accept`, 'decider')
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data.status).toBe('accepted')
    expect((await post(`/api/parcel-change-requests/${d.id}/accept`, 'decider')).statusCode).toBe(409)
  })

  test('a person who holds both roles cannot decide their own proposal', async () => {
    // The drafter here is the Survey Section user: they may draw, but a proposal they drew is decided by someone else.
    const parent = await mkStand(1.7, 1.0)
    const d = (await draft('decider', split(parent, 1.7, 1.0))).json().data
    await post(`/api/parcel-change-requests/${d.id}/submit`, 'decider')
    const own = await post(`/api/parcel-change-requests/${d.id}/accept`, 'decider')
    expect(own.statusCode).toBe(403)
    expect(own.json().error).toBe('not_the_drafter')
  })

  test('a returned proposal goes back to the drafter and can be changed and sent again; withdrawing cancels the survey task', async () => {
    const parent = await mkStand(1.8, 1.0)
    const d = (await draft('drafter', split(parent, 1.8, 1.0))).json().data
    const sub = (await post(`/api/parcel-change-requests/${d.id}/submit`, 'drafter')).json().data
    const ret = await post(`/api/parcel-change-requests/${d.id}/return`, 'decider', { note: 'Show the access road.' })
    expect(ret.json().data).toMatchObject({ status: 'returned', decision_note: 'Show the access road.' })
    const { rows: [t1] } = await sup.query('SELECT status FROM spatial_planning.survey_task WHERE id = $1', [sub.survey_task_id])
    expect(t1.status).toBe('cancelled')

    // someone else may not change it; the drafter may
    expect((await app.inject({ method: 'PUT', url: `/api/parcel-change-requests/${d.id}`, headers: headers('other'), payload: split(parent, 1.8, 1.0) })).statusCode).toBe(403)
    const put = await app.inject({ method: 'PUT', url: `/api/parcel-change-requests/${d.id}`, headers: headers('drafter'), payload: { ...split(parent, 1.8, 1.0), reason: 'with the road' } })
    expect(put.statusCode).toBe(200)
    expect(put.json().data).toMatchObject({ status: 'draft', reason: 'with the road' })

    const again = (await post(`/api/parcel-change-requests/${d.id}/submit`, 'drafter')).json().data
    expect(again.status).toBe('submitted')
    expect(again.survey_task_id).not.toBe(sub.survey_task_id)
    // a submitted proposal cannot be edited
    expect((await app.inject({ method: 'PUT', url: `/api/parcel-change-requests/${d.id}`, headers: headers('drafter'), payload: split(parent, 1.8, 1.0) })).statusCode).toBe(409)

    const w = await post(`/api/parcel-change-requests/${d.id}/withdraw`, 'drafter')
    expect(w.json().data.status).toBe('withdrawn')
    const { rows: [t2] } = await sup.query('SELECT status FROM spatial_planning.survey_task WHERE id = $1', [again.survey_task_id])
    expect(t2.status).toBe('cancelled')
    expect((await post(`/api/parcel-change-requests/${d.id}/withdraw`, 'drafter')).statusCode).toBe(409)
  })

  test('the list shows mine and the queue by status, with the stands each proposal affects', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/parcel-change-requests?mine=1', headers: headers('drafter') })
    expect(mine.statusCode).toBe(200)
    expect(mine.json().data.length).toBeGreaterThan(0)
    for (const r of mine.json().data) expect(r.requested_by).toBe(people.drafter.id)
    const queue = await app.inject({ method: 'GET', url: '/api/parcel-change-requests?status=submitted,accepted', headers: headers('decider') })
    for (const r of queue.json().data) expect(['submitted', 'accepted']).toContain(r.status)
    expect(queue.json().data.every((r) => Array.isArray(r.stands))).toBe(true)
  })

  test('the geometry helpers cut a stand by a line and join adjoining stands, and say so when they cannot', async () => {
    const stand = sq(1.9, 1.0)
    const cut = await post('/api/parcel-change-requests/helpers/split', 'drafter', { geometry: stand, blade: { type: 'LineString', coordinates: [[1.901, 0.999], [1.901, 1.003]] } })
    expect(cut.statusCode).toBe(200)
    expect(cut.json().data).toHaveLength(2)
    const miss = await post('/api/parcel-change-requests/helpers/split', 'drafter', { geometry: stand, blade: { type: 'LineString', coordinates: [[1.95, 0.999], [1.95, 1.003]] } })
    expect(miss.statusCode).toBe(422)
    expect(miss.json().error).toBe('blade_does_not_cross')

    const joined = await post('/api/parcel-change-requests/helpers/merge', 'drafter', { geometries: [sq(2.0, 1.0), sq(2.002, 1.0)] })
    expect(joined.statusCode).toBe(200)
    expect(joined.json().data.type).toBe('Polygon')
    const apart = await post('/api/parcel-change-requests/helpers/merge', 'drafter', { geometries: [sq(2.0, 1.0), sq(2.01, 1.0)] })
    expect(apart.statusCode).toBe(422)
    expect(apart.json().error).toBe('not_adjacent')
  })
})
