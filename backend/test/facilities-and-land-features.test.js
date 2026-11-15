/**
 * The facilities, land features and railway lines of the printed sheet (migrations 233 and 234), as loaded from the council's files (schools, quarries, mines,
 * the new city, railways: 15 November 2026) and, for the rest, the October 2024 package.
 * Reads the loaded database; run scripts/load-reference-layers.js first.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
afterAll(() => pool.end())
const one = async (sql) => (await pool.query(sql)).rows[0]

describe('community facilities', () => {
  test('are loaded by kind, each naming its source', async () => {
    const { rows } = await pool.query('SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE source IS NULL OR source = \'\')::int AS no_source FROM admin.community_facility GROUP BY kind')
    const by = Object.fromEntries(rows.map((r) => [r.kind, r]))
    expect(by.school.n).toBe(102)
    expect(by.police_post.n).toBe(6)   // Holy Cross prison lies outside the planning boundary
    expect(by.dip_tank.n).toBe(15)
    expect(by.network_booster.n).toBe(16)
    expect(rows.every((r) => r.no_source === 0)).toBe(true)
  })
  test('a school keeps the level and grant class the source gives, and nothing is guessed where it gives none', async () => {
    const r = await one(`SELECT count(*) FILTER (WHERE subtype = 'Primary')::int AS primary_n,
                                count(*) FILTER (WHERE subtype = 'Secondary')::int AS secondary_n,
                                count(*) FILTER (WHERE subtype IS NULL)::int AS no_level,
                                count(*) FILTER (WHERE grade IS NULL)::int AS no_grade
                           FROM admin.community_facility WHERE kind = 'school'`)
    expect(r.primary_n).toBe(69)
    expect(r.secondary_n).toBe(30)
    expect(r.no_level).toBe(1)
    expect(r.no_grade).toBe(6)   // the source gives no grant class to the university, the technical college, one primary, two secondaries and the unnamed point
  })
  test('a dip tank keeps the village the source gives, and a police post its type', async () => {
    const r = await one("SELECT count(*) FILTER (WHERE kind = 'dip_tank' AND village IS NOT NULL)::int AS dip_villages, count(*) FILTER (WHERE kind = 'police_post' AND subtype = 'Prison')::int AS prisons FROM admin.community_facility")
    expect(r).toEqual({ dip_villages: 7, prisons: 1 })
  })
  test('keeps a university and a technical college as the source names them', async () => {
    const { rows } = await pool.query("SELECT name, subtype FROM admin.community_facility WHERE kind = 'school' AND subtype IN ('University', 'Technical and Vocational') ORDER BY name")
    expect(rows).toEqual([{ name: 'Kaguvi', subtype: 'Technical and Vocational' }, { name: 'Midlands State University', subtype: 'University' }])
  })
  test('lie inside the council\'s planning boundary, bar those the report names', async () => {
    const r = await one(`SELECT count(*)::int AS outside FROM admin.community_facility f, admin.planning_boundary b WHERE NOT ST_Intersects(f.geom, b.geom)`)
    expect(r.outside).toBeLessThanOrEqual(1)
  })
})

describe('land features', () => {
  test('quarries and sand workings are told apart by the source\'s own use, and irrigation schemes keep their status', async () => {
    const { rows } = await pool.query('SELECT kind, name, status FROM admin.land_feature ORDER BY kind, name')
    const kinds = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {})
    expect(kinds).toEqual({ quarry: 2, sand_working: 2, mine: 41, proposed_new_city: 1, irrigation_scheme: 6, recreational_site: 9 })
    expect(rows.find((r) => r.name === 'Sino Cement').kind).toBe('sand_working')
    expect(rows.find((r) => r.name === 'Zida').kind).toBe('quarry')
    expect(rows.find((r) => r.name === 'Shagari').status).toBe('Not functional')
  })
  test('a mine keeps the use the source gives, and none where it gives none', async () => {
    const r = await one("SELECT count(*) FILTER (WHERE \"use\" = 'Gold')::int AS gold, count(*) FILTER (WHERE \"use\" IS NULL)::int AS no_use FROM admin.land_feature WHERE kind = 'mine'")
    expect(r).toEqual({ gold: 4, no_use: 37 })
  })
  test('every feature is a valid polygon with a source', async () => {
    const r = await one('SELECT count(*) FILTER (WHERE NOT ST_IsValid(geom))::int AS invalid, count(*) FILTER (WHERE source IS NULL)::int AS no_source FROM admin.land_feature')
    expect(r).toEqual({ invalid: 0, no_source: 0 })
  })
})

describe('railway lines', () => {
  test('the seven lines of the plan are loaded with their source, and are valid', async () => {
    const r = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE source IS NULL)::int AS no_source, count(*) FILTER (WHERE NOT ST_IsValid(geom))::int AS invalid FROM admin.railway_line")
    expect(r).toEqual({ n: 7, no_source: 0, invalid: 0 })
  })
})

describe('business centres', () => {
  test('carry the grade 1 to 3 the council gives each BC, and none for a rural service centre or growth point', async () => {
    const { rows } = await pool.query('SELECT sector, level, count(*)::int AS n FROM admin.business_centre GROUP BY sector, level ORDER BY sector, level')
    expect(rows).toEqual([{ sector: 'BC', level: 1, n: 17 }, { sector: 'BC', level: 2, n: 31 }, { sector: 'BC', level: 3, n: 12 },
      { sector: 'GP', level: null, n: 1 }, { sector: 'RSC', level: null, n: 5 }])
  })
  test('a level belongs only to a BC (the table refuses otherwise)', async () => {
    await expect(pool.query("INSERT INTO admin.business_centre (sector, level, source, geom) VALUES ('RSC', 2, 'x', ST_SetSRID(ST_MakePoint(29.5, -19.3), 4326))")).rejects.toThrow(/business_centre_level_known/)
  })
})

describe('health facilities', () => {
  test('are loaded from the Ministry file with their source; a facility the council added has a name and a position only', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE source IS NULL)::int AS no_source, count(*) FILTER (WHERE typeoffaci IS NULL)::int AS no_type, count(*) FILTER (WHERE nameoffaci IS NULL)::int AS no_name FROM council_ops.health_facility')
    expect(rows[0]).toEqual({ n: 24, no_source: 0, no_type: 6, no_name: 0 })
  })
  test('every facility has a position', async () => {
    const r = await one('SELECT count(*) FILTER (WHERE geom IS NULL)::int AS none FROM council_ops.health_facility')
    expect(r.none).toBe(0)
  })
})

describe('targeted farms', () => {
  test('are the 283 supplied by the council, each naming its source, nearly all linked to a farm parcel of the register', async () => {
    const r = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE source IS NULL)::int AS no_source, count(parcel_id)::int AS linked FROM admin.targeted_farm")
    expect(r).toEqual({ n: 283, no_source: 0, linked: 278 })
  })
  test('a link is to a farm parcel that exists', async () => {
    const r = await one("SELECT count(*)::int AS bad FROM admin.targeted_farm t WHERE t.parcel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM land.parcel p WHERE p.parcel_id = t.parcel_id AND p.parcel_kind = 'farm')")
    expect(r.bad).toBe(0)
  })
  test('keep the status the source gives', async () => {
    const { rows } = await pool.query('SELECT status FROM admin.targeted_farm GROUP BY status ORDER BY status')
    expect(rows.map((r) => r.status)).toEqual(['City', 'Commercial', 'Resettlement', 'State Land', null])
  })
})

describe('retained zones', () => {
  test('are 16 polygons under the zone names of the plan, by ward, replacing nothing', async () => {
    const { rows } = await pool.query('SELECT zone, count(*)::int AS n FROM admin.retained_zone GROUP BY zone ORDER BY zone')
    expect(Object.fromEntries(rows.map((r) => [r.zone, r.n]))).toEqual({ 'Communal': 2, 'Large Scale Commercial Farms': 4, 'Model A1': 1, 'Model A2': 4, 'Resettlement Area': 3, 'Small Scale Commercial Farms': 2 })
    const z = await one("SELECT count(*)::int AS n FROM spatial_planning.zone WHERE zone = 'Communal'")
    expect(z.n).toBe(2)   // the loaded zones are untouched
  })
})
