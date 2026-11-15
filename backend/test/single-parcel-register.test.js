/**
 * One parcel register (migration 227): farm parcels are rows of land.parcel with kind 'farm', and the old
 * name public.vungu_parcels is a compatibility view over them. Holds on an empty database as well as a loaded one.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = async (sql, args) => (await pool.query(sql, args)).rows
afterAll(() => pool.end())

describe('single parcel register', () => {
  test('vungu_parcels is a view, with the old columns', async () => {
    const [{ relkind }] = await q("SELECT relkind FROM pg_class WHERE oid = to_regclass('public.vungu_parcels')")
    expect(relkind).toBe('v')
    const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vungu_parcels'")).map((r) => r.column_name)
    for (const c of ['fid', 'geom', 'name', 'name_cfu', 'map_sheet', 'province', 'district', 'status', 'area_ha']) expect(cols).toContain(c)
  })

  test('the view shows exactly the register\'s farm parcels', async () => {
    const [{ n: view }] = await q('SELECT count(*)::int AS n FROM public.vungu_parcels')
    const [{ n: farms }] = await q("SELECT count(*)::int AS n FROM land.parcel WHERE parcel_kind = 'farm' AND source_relation = 'public.vungu_parcels' AND status = 'current'")
    expect(view).toBe(farms)
  })

  test('every farm parcel names its source row and has a farm record; no source row is used twice', async () => {
    const [{ n: unlinked }] = await q("SELECT count(*)::int AS n FROM land.parcel WHERE parcel_kind = 'farm' AND (source_relation IS NULL OR source_key IS NULL)")
    expect(unlinked).toBe(0)
    const [{ n: noRecord }] = await q("SELECT count(*)::int AS n FROM land.parcel p LEFT JOIN land.parcel_farm f ON f.parcel_id = p.parcel_id WHERE p.parcel_kind = 'farm' AND f.parcel_id IS NULL")
    expect(noRecord).toBe(0)
    const [{ n: dup }] = await q("SELECT count(*)::int AS n FROM (SELECT source_key FROM land.parcel WHERE source_relation = 'public.vungu_parcels' GROUP BY 1 HAVING count(*) > 1) x")
    expect(dup).toBe(0)
  })

  test('no farm is labelled a stand, and stands keep their township', async () => {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM land.parcel WHERE parcel_kind = 'stand' AND source_relation = 'public.vungu_parcels'")
    expect(n).toBe(0)
    const [{ n: noTownship }] = await q("SELECT count(*)::int AS n FROM land.parcel WHERE parcel_kind = 'stand' AND township_code IS NULL")
    expect(noTownship).toBe(0)
  })

  test('where the retired raw table is kept, each farm parcel has the same geometry, name and province as its source row', async () => {
    const [{ r }] = await q("SELECT to_regclass('public.vungu_parcels_retired') AS r")
    if (!r) return
    const [{ n: geom }] = await q('SELECT count(*)::int AS n FROM public.vungu_parcels v JOIN public.vungu_parcels_retired o USING (fid) WHERE NOT ST_Equals(v.geom, o.geom)')
    expect(geom).toBe(0)
    const [{ n: attrs }] = await q(`SELECT count(*)::int AS n FROM public.vungu_parcels v JOIN public.vungu_parcels_retired o USING (fid)
       WHERE v.name IS DISTINCT FROM NULLIF(btrim(o.name), '') OR v.province IS DISTINCT FROM NULLIF(btrim(o.province), '') OR v.status IS DISTINCT FROM NULLIF(btrim(o.status), '')`)
    expect(attrs).toBe(0)
  })

  test('parcel_zoning caches the register only (and the legacy stands layer until it is retired), and a legacy name still resolves', async () => {
    const layers = (await q('SELECT DISTINCT parcel_layer FROM parcel_zoning')).map((r) => r.parcel_layer)
    expect(layers.filter((l) => !['land.parcel', 'stands'].includes(l))).toEqual([])
    const [farm] = await q("SELECT source_key FROM land.parcel WHERE parcel_kind = 'farm' AND source_relation = 'public.vungu_parcels' LIMIT 1")
    if (!farm) return
    const rows = await q("SELECT zone_id FROM parcel_zoning_for('vungu_parcels', $1)", [farm.source_key])
    const [reg] = await q("SELECT parcel_id FROM land.parcel WHERE source_relation = 'public.vungu_parcels' AND source_key = $1", [farm.source_key])
    const same = await q("SELECT zone_id FROM parcel_zoning_for('land.parcel', $1)", [reg.parcel_id])
    expect(rows.map((r) => r.zone_id).sort()).toEqual(same.map((r) => r.zone_id).sort())
  })
})
