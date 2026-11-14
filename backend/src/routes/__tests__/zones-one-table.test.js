/**
 * Migration 219: the zones live in one table and the public sees them only through an explicit, reversible switch.
 *
 * Runs in ONE transaction that is rolled back, against the dev database. It needs the council's zones loaded
 * (scripts/load-zones.js); without them the zone-dependent tests say so and pass trivially.
 *
 * What it pins down:
 *   - zones_master (the peri-urban layer) holds the peri-urban zones only; the beyond layer, the old name
 *     vungu_beyond_peri_urban_zones, is a view of the beyond zones only; spatial_planning.zone holds all of them;
 *     so no polygon is drawn twice and none is lost.
 *   - an anonymous reader (the application role, no council in the session) sees no zones of an ungazetted plan, and
 *     sees them when the plan's public_preview is on and not when it is off again.
 *   - the preview switch never changes the plan's status: it is still a draft.
 */
require('dotenv').config()
const { Client } = require('pg')

const BEYOND = 'Beyond the peri-urban area'
let client
let loaded = false
const q = async (sql, params) => (await client.query(sql, params)).rows

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query('BEGIN')
  const [{ n }] = await q('SELECT count(*)::int AS n FROM public.proposed_peri_urban_zones')
  loaded = n > 0
}, 30000)

afterAll(async () => {
  await client.query('ROLLBACK')
  await client.end()
}, 30000)

const asAnonymous = async (sql) => {
  await client.query('SAVEPOINT anon')
  try {
    await client.query('SET LOCAL ROLE vungu_app')
    return await q(sql)
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT anon')
  }
}

describe('one zones table (migration 219)', () => {
  test('the peri-urban layer and the beyond layer partition the table, and spatial_planning.zone holds both', async () => {
    if (!loaded) return
    const [t] = await q(`SELECT count(*)::int AS all_zones, count(*) FILTER (WHERE scale_category = $1)::int AS beyond FROM public.proposed_peri_urban_zones`, [BEYOND])
    const [m] = await q('SELECT count(*)::int AS n FROM public.zones_master')
    const [b] = await q('SELECT count(*)::int AS n FROM public.vungu_beyond_peri_urban_zones')
    const [z] = await q('SELECT count(*)::int AS n FROM spatial_planning.zone')
    expect(b.n).toBe(t.beyond)
    expect(m.n).toBe(t.all_zones - t.beyond)
    expect(z.n).toBe(t.all_zones)
  })

  test('the beyond view keeps the columns its readers use and names the planning zone in settlement', async () => {
    if (!loaded) return
    const rows = await q('SELECT fid, settlement, zone_code, adm3_en, adm2_en FROM public.vungu_beyond_peri_urban_zones')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(Number.isInteger(r.fid)).toBe(true)
      expect(r.settlement).not.toMatch(/^(FLSCF|SSCF)/) // the abbreviations were unpacked
      expect(r.adm2_en).toBeNull() // not held, never invented
    }
  })

  test('an anonymous reader sees no zones of an ungazetted plan, until the preview is switched on', async () => {
    if (!loaded) return
    await client.query(`UPDATE public.plan_instrument SET public_preview = false WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    expect((await asAnonymous('SELECT count(*)::int AS n FROM public.zones_master'))[0].n).toBe(0)
    expect((await asAnonymous('SELECT count(*)::int AS n FROM public.vungu_beyond_peri_urban_zones'))[0].n).toBe(0)

    await client.query(`UPDATE public.plan_instrument SET public_preview = true WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    expect((await asAnonymous('SELECT count(*)::int AS n FROM public.zones_master'))[0].n).toBeGreaterThan(0)
    expect((await asAnonymous('SELECT count(*)::int AS n FROM public.vungu_beyond_peri_urban_zones'))[0].n).toBeGreaterThan(0)

    await client.query(`UPDATE public.plan_instrument SET public_preview = false WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    expect((await asAnonymous('SELECT count(*)::int AS n FROM public.zones_master'))[0].n).toBe(0)
  })

  test('the preview switch leaves the plan a draft', async () => {
    const [p] = await q(`SELECT status, gazette_ref FROM public.plan_instrument WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    await client.query(`UPDATE public.plan_instrument SET public_preview = true WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    const [after] = await q(`SELECT status, gazette_ref FROM public.plan_instrument WHERE title = 'Vungu RDC peri-urban local plan (as mapped)'`)
    expect(after).toEqual(p)
    expect(after.status).not.toBe('gazetted')
  })

  test('public preview is off by default', async () => {
    const [d] = await q(`SELECT column_default FROM information_schema.columns WHERE table_name = 'plan_instrument' AND column_name = 'public_preview'`)
    expect(d.column_default).toBe('false')
  })
})

// Migration 220: the real table has its convention name and the old name is a compatibility view.
describe('spatial_planning.zone is the table (migration 220)', () => {
  const relkind = async (rel) => (await q('SELECT relkind::text AS k FROM pg_class WHERE oid = to_regclass($1)', [rel]))[0]?.k

  test('the zones table is spatial_planning.zone, and the old names are views', async () => {
    expect(await relkind('spatial_planning.zone')).toBe('r')
    for (const view of ['public.proposed_peri_urban_zones', 'public.zones_master', 'public.vungu_beyond_peri_urban_zones']) {
      expect(await relkind(view)).toBe('v')
    }
  })

  test('foreign keys follow the table: parcel_zoning, zone_land_use_controls and stands point at spatial_planning.zone', async () => {
    const rows = await q(`SELECT conrelid::regclass::text AS child FROM pg_constraint WHERE confrelid = 'spatial_planning.zone'::regclass ORDER BY 1`)
    const children = rows.map((r) => r.child)
    for (const t of ['parcel_zoning', 'zone_land_use_controls', 'stands']) expect(children).toContain(t)
  })

  test('a write through the old name lands in the new table, and the plan-sync trigger still fires', async () => {
    await client.query('SAVEPOINT w')
    try {
      await client.query(
        `INSERT INTO public.proposed_peri_urban_zones (zone, geom)
         VALUES ('Jest Zone 220', ST_Multi(ST_MakeEnvelope(10, 50, 10.1, 50.1, 4326)))`)
      const [row] = await q(`SELECT plan_instrument_id, plan_zone_type_id FROM spatial_planning.zone WHERE zone = 'Jest Zone 220'`)
      expect(row).toBeDefined()
      expect(row.plan_instrument_id).not.toBeNull() // filed under the Vungu plan by the trigger
      expect(row.plan_zone_type_id).not.toBeNull() // and given a zone type
      await client.query(`UPDATE public.proposed_peri_urban_zones SET zone_description = 'edited through the old name' WHERE zone = 'Jest Zone 220'`)
      expect((await q(`SELECT zone_description FROM spatial_planning.zone WHERE zone = 'Jest Zone 220'`))[0].zone_description).toBe('edited through the old name')
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT w')
    }
  })

  test('the old name has the same columns, in the same order, as the table', async () => {
    const cols = async (rel) => (await q(`SELECT attname FROM pg_attribute WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped ORDER BY attnum`, [rel])).map((r) => r.attname)
    expect(await cols('public.proposed_peri_urban_zones')).toEqual(await cols('spatial_planning.zone'))
  })
})
