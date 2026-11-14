-- ROLLBACK OF 224 — WATER SOURCES
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/224_water_sources.down.sql
-- Drops basemap.waterbody and its compatibility view (re-loadable with scripts/load-reference-layers.js) and restores the two
-- water-point measures to migration 215's and 218's definitions. The boreholes in council_ops.wash_asset are NOT removed: delete
-- the rows whose source starts "Council GIS boreholes.geojson" if they are to go too.
DROP VIEW IF EXISTS public.water_areas;
DROP TABLE IF EXISTS basemap.waterbody;
DO $$ BEGIN
  IF to_regclass('public.water_areas_retired') IS NOT NULL THEN ALTER TABLE public.water_areas_retired RENAME TO water_areas; END IF;
END $$;
DELETE FROM tenancy.relation_class WHERE relation IN ('basemap.waterbody', 'public.water_areas_retired');
DELETE FROM public.spatial_concept_source WHERE relation = 'basemap.waterbody';
UPDATE public.spatial_concept_source SET role = 'canonical', note = NULL WHERE relation = 'public.water_areas';

CREATE OR REPLACE FUNCTION spatial_engine.m_water_points_working()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN a.geom IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(a.ward) END AS ward_code, a.operational
      FROM council_ops.wash_asset a
      LEFT JOIN LATERAL (SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE a.geom IS NOT NULL AND ST_Intersects(w.geom, a.geom) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code, count(*) FILTER (WHERE operational = 'working')::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;
CREATE OR REPLACE FUNCTION spatial_engine.m_water_points_per_voters()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN a.geom IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(a.ward) END AS ward_code, a.operational
      FROM council_ops.wash_asset a
      LEFT JOIN LATERAL (SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE a.geom IS NOT NULL AND ST_Intersects(w.geom, a.geom) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code, count(*) FILTER (WHERE operational = 'working')::numeric, NULL::numeric, count(*) FROM placed GROUP BY ward_code
$$;
UPDATE spatial_engine.measure SET label = 'Water points working', unit = '% working',
  description = 'The share of the ward''s water points (boreholes, wells, tanks) recorded as working. Decommissioned points are left out.'
 WHERE measure_key = 'water_points_working';
UPDATE spatial_engine.measure SET label = 'Working water points per 10,000 registered voters', unit = 'working points per 10,000 voters'
 WHERE measure_key = 'water_points_per_voters';
DELETE FROM public.schema_migrations WHERE filename = '224_water_sources.sql';
