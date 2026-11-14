/**
 * Migration 220: the council's point layers have their convention names, the old names are views over them, and every spatial
 * relation in the database is classified in the concept registry (the rule scripts/verify-spatial-registry.js enforces).
 *
 * Read-only, against the dev database.
 */
require('dotenv').config()
const { Client } = require('pg')

let client
const q = async (sql, params) => (await client.query(sql, params)).rows
beforeAll(async () => { client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect() }, 30000)
afterAll(async () => { await client.end() }, 30000)

const PAIRS = [
  ['council_ops.cemetery', 'public.vungu_cemeteries'],
  ['council_ops.waste_facility', 'public.vungu_waste_management'],
  ['council_ops.health_facility', 'public.gweru_health_centres'],
]

describe('council points (migration 220)', () => {
  test.each(PAIRS)('%s is the table and %s is a view over it with the same rows', async (table, view) => {
    const kind = async (rel) => (await q('SELECT relkind::text AS k FROM pg_class WHERE oid = to_regclass($1)', [rel]))[0]?.k
    expect(await kind(table)).toBe('r')
    expect(await kind(view)).toBe('v')
    const [a] = await q(`SELECT count(*)::int AS n FROM ${table}`)
    const [b] = await q(`SELECT count(*)::int AS n FROM ${view}`)
    expect(b.n).toBe(a.n)
  })

  test('the tile config still serves the old names, which exist', async () => {
    const { LAYERS } = require('../../config/spatialLayers')
    // The health centres are not a tile layer; the other two are, and keep serving their old names.
    for (const name of ['vungu_cemeteries', 'vungu_waste_management']) expect(LAYERS.some((l) => l.table === name)).toBe(true)
  })

  test('the live-refresh listener knows the new table names', () => {
    const { resolveLayerIdForTable } = require('../../services/spatialChangeListener')
    expect(resolveLayerIdForTable('cemetery')).toBe('vungu_cemeteries')
    expect(resolveLayerIdForTable('waste_facility')).toBe('vungu_waste_management')
    expect(resolveLayerIdForTable('health_facility')).toBe('gweru_health_centres')
    expect(resolveLayerIdForTable('zone')).toBe('vungu_proposed_peri_urban_zones')
  })
})

describe('the concept registry', () => {
  test('every spatial relation is classified', async () => {
    const rows = await q(`
      SELECT DISTINCT f_table_schema || '.' || f_table_name AS rel FROM geometry_columns
       WHERE f_table_schema NOT IN ('pg_catalog', 'information_schema', 'topology', 'tiger', 'tiger_data', 'scratch')
         AND f_table_schema NOT LIKE 'surveyor\_%' ESCAPE '\'
         AND NOT EXISTS (SELECT 1 FROM public.spatial_concept_source s WHERE s.relation = f_table_schema || '.' || f_table_name)`)
    expect(rows.map((r) => r.rel)).toEqual([])
  })

  test('the convention names are the canonical sources of their concepts', async () => {
    const rows = await q(`SELECT concept_code, relation FROM public.spatial_concept_source WHERE role = 'canonical'
                           AND concept_code IN ('planning_zone', 'cemetery', 'waste_facility', 'health_facility')`)
    expect(Object.fromEntries(rows.map((r) => [r.concept_code, r.relation]))).toEqual({
      planning_zone: 'spatial_planning.zone', cemetery: 'council_ops.cemetery',
      waste_facility: 'council_ops.waste_facility', health_facility: 'council_ops.health_facility',
    })
  })

  test('no concept has two canonical sources', async () => {
    const rows = await q(`SELECT concept_code FROM public.spatial_concept_source WHERE role = 'canonical' GROUP BY 1 HAVING count(*) > 1`)
    expect(rows).toEqual([])
  })
})

describe('the road network and the planning boundary (migration 221)', () => {
  const kind = async (rel) => (await q('SELECT relkind::text AS k FROM pg_class WHERE oid = to_regclass($1)', [rel]))[0]?.k

  test('basemap.road is the table and public.roads a view with the old basemap columns', async () => {
    expect(await kind('basemap.road')).toBe('r')
    expect(await kind('public.roads')).toBe('v')
    const cols = (await q(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.roads'::regclass AND attnum > 0 AND NOT attisdropped`)).map((r) => r.attname)
    for (const c of ['fid', 'osm_id', 'fclass', 'name', 'ref', 'oneway', 'maxspeed', 'bridge', 'tunnel', 'geom']) expect(cols).toContain(c)
  })

  test('the old view reproduces the old codes and the same rows', async () => {
    const [a] = await q('SELECT count(*)::int AS n FROM basemap.road')
    const [b] = await q('SELECT count(*)::int AS n FROM public.roads')
    expect(b.n).toBe(a.n)
    const rows = await q('SELECT DISTINCT oneway, bridge, tunnel FROM public.roads')
    for (const r of rows) for (const v of [r.oneway, r.bridge, r.tunnel]) expect(['B', 'F', 'T']).toContain(v)
  })

  test('an unknown speed is NULL in the table, not 0', async () => {
    const [r] = await q('SELECT count(*)::int AS n FROM basemap.road WHERE max_speed = 0')
    expect(r.n).toBe(0)
  })

  test('the planning boundary is one row per council, and the old name is a view of it', async () => {
    expect(await kind('admin.planning_boundary')).toBe('r')
    expect(await kind('public.gweru_rural_planning_boundary')).toBe('v')
    const [a] = await q('SELECT count(*)::int AS n FROM admin.planning_boundary')
    const [b] = await q('SELECT count(*)::int AS n FROM public.gweru_rural_planning_boundary')
    expect(b.n).toBe(a.n)
    expect(a.n).toBeLessThanOrEqual(1)
  })

  test('the council inventory comes from the roads tagged for the council, flagged unverified and with no invented surface', async () => {
    const [r] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE data_quality <> 'unverified')::int AS verified,
                                count(*) FILTER (WHERE surface IS NOT NULL OR condition IS NOT NULL)::int AS invented
                           FROM council_ops.road_asset WHERE source LIKE 'OpenStreetMap%'`)
    expect(r.verified).toBe(0)
    expect(r.invented).toBe(0)
  })
})
