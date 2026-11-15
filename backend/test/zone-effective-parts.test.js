/**
 * Where zones overlap each piece of land has one zone (migration 226). Reads the loaded Vungu plan, and builds a small scratch
 * plan inside a rolled-back transaction to pin the precedence rule.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let client
beforeAll(async () => { client = await pool.connect() }, 30000)
afterAll(async () => { client.release(); await pool.end() })
beforeEach(async () => { await client.query('BEGIN') })
afterEach(async () => { await client.query('ROLLBACK') })

const BOX = (x0, y0, x1, y1) => `ST_Multi(ST_SetSRID(ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}), 4326))`

/** A scratch plan with the given zones: [{name, box:[x0,y0,x1,y1], overlay?}]. Returns zone ids by name. */
async function scratchPlan(zones) {
  const { rows: [plan] } = await client.query(
    `INSERT INTO plan_instrument (title, status, is_template, profile_id, authority_id, plan_type)
     SELECT 'jest overlap plan', 'draft', false, profile_id, authority_id, plan_type FROM plan_instrument
      WHERE title = 'Vungu RDC peri-urban local plan (as mapped)' RETURNING id`)
  await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
  const ids = {}
  for (const z of zones) {
    const { rows: [r] } = await client.query(
      `INSERT INTO spatial_planning.zone (zone, plan_instrument_id, geom, is_active) VALUES ($1, $2, ${BOX(...z.box)}, true) RETURNING id, plan_zone_type_id`,
      [z.name, plan.id])
    ids[z.name] = r.id
    if (z.overlay) await client.query('UPDATE plan_zone_type SET is_overlay = true WHERE id = $1', [r.plan_zone_type_id])
  }
  await client.query('SELECT spatial_planning.refresh_zone_effective($1)', [plan.id])
  return { plan: plan.id, ids }
}
const effective = async (id) => (await client.query(
  'SELECT area_ha, trimmed_ha, geom IS NULL AS gone FROM spatial_planning.zone_effective WHERE zone_id = $1', [id])).rows[0]

describe('zone effective parts', () => {
  test('the loaded plan has no overlap left, and covers the same land as the supplied polygons', async () => {
    const { rows: [o] } = await client.query(
      `SELECT count(*)::int AS n FROM spatial_planning.zone_effective a JOIN spatial_planning.zone_effective b
         ON a.zone_id < b.zone_id AND a.plan_instrument_id = b.plan_instrument_id AND ST_Intersects(a.geom, b.geom)
        WHERE ST_Area(ST_Intersection(a.geom, b.geom)::geography) > 1`)
    expect(o.n).toBe(0)
    const { rows: [c] } = await client.query(
      `SELECT abs((SELECT ST_Area(ST_UnaryUnion(ST_Collect(geom))::geography) FROM spatial_planning.zone)
                - (SELECT ST_Area(ST_UnaryUnion(ST_Collect(geom))::geography) FROM spatial_planning.zone_effective)) AS diff_m2`)
    expect(Number(c.diff_m2)).toBeLessThan(1000) // m2 of 594,258 ha: rounding at the cut edges
  })

  test('a parcel\'s zone shares never add to more than 100%', async () => {
    const { rows: [s] } = await client.query(
      "SELECT max(s) AS max_sum FROM (SELECT sum(share_pct) AS s FROM parcel_zoning GROUP BY parcel_layer, parcel_id) x")
    expect(Number(s.max_sum)).toBeLessThanOrEqual(100.05)
  })

  test('smaller zone keeps the overlap (the larger loses it)', async () => {
    const { ids } = await scratchPlan([
      { name: 'Big', box: [0, 0, 0.02, 0.02] }, { name: 'Small', box: [0.005, 0.005, 0.01, 0.01] }])
    expect((await effective(ids.Small)).trimmed_ha).toBe('0.00')
    expect(Number((await effective(ids.Big)).trimmed_ha)).toBeGreaterThan(20)
  })

  test('an overlay zone keeps the overlap over the zone beneath, even when larger', async () => {
    const { ids } = await scratchPlan([
      { name: 'Under', box: [0, 0, 0.005, 0.005] }, { name: 'Corridor', box: [0.002, 0, 0.02, 0.02], overlay: true }])
    expect((await effective(ids.Corridor)).trimmed_ha).toBe('0.00')
    expect(Number((await effective(ids.Under)).trimmed_ha)).toBeGreaterThan(0)
  })

  test('a sliver along a shared edge goes to the larger zone', async () => {
    // Two boxes overlapping by 0.000005 degrees (about 0.5 m).
    const { ids } = await scratchPlan([
      { name: 'Large', box: [0, 0, 0.02, 0.02] }, { name: 'Neighbour', box: [0.019995, 0, 0.03, 0.005] }])
    expect((await effective(ids.Large)).trimmed_ha).toBe('0.00')
    expect(Number((await effective(ids.Neighbour)).trimmed_ha)).toBeGreaterThan(0)
  })

  test('v_zone_overlap says who keeps each overlap and why', async () => {
    const { plan } = await scratchPlan([
      { name: 'Big', box: [0, 0, 0.02, 0.02] }, { name: 'Small', box: [0.005, 0.005, 0.01, 0.01] }])
    const { rows } = await client.query('SELECT kind, winner_zone, rule FROM spatial_planning.v_zone_overlap WHERE plan_instrument_id = $1', [plan])
    expect(rows).toEqual([{ kind: 'overlap', winner_zone: 'Small', rule: 'the smaller zone keeps it' }])
  })

  test('the zone triggers keep the parts current when a zone is added or reshaped', async () => {
    const { ids } = await scratchPlan([{ name: 'Big', box: [0, 0, 0.02, 0.02] }])
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'off'")
    const { rows: [r] } = await client.query(
      `INSERT INTO spatial_planning.zone (zone, plan_instrument_id, geom, is_active)
       SELECT 'Small', plan_instrument_id, ${BOX(0.005, 0.005, 0.01, 0.01)}, true FROM spatial_planning.zone WHERE id = $1 RETURNING id`, [ids.Big])
    expect(Number((await effective(ids.Big)).trimmed_ha)).toBeGreaterThan(20)
    await client.query(`UPDATE spatial_planning.zone SET geom = ${BOX(0.5, 0.5, 0.51, 0.51)} WHERE id = $1`, [r.id])
    expect((await effective(ids.Big)).trimmed_ha).toBe('0.00')
  })
})
