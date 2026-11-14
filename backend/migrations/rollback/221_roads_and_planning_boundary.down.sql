-- ROLLBACK OF 221 — THE ROAD NETWORK AND THE PLANNING BOUNDARY
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/221_roads_and_planning_boundary.down.sql
-- Drops basemap.road, admin.planning_boundary and their compatibility views (re-loadable with scripts/load-reference-layers.js),
-- gives back a retired raw table of the old name if one was kept, and removes the registry rows. The council's road inventory
-- (council_ops.road_asset) is NOT touched: delete the rows whose source starts "OpenStreetMap" if they are to go too.
DROP VIEW IF EXISTS public.roads;
DROP VIEW IF EXISTS public.gweru_rural_planning_boundary;
DROP TABLE IF EXISTS basemap.road;
DROP TABLE IF EXISTS admin.planning_boundary;
DO $$
BEGIN
  IF to_regclass('public.roads_retired') IS NOT NULL THEN ALTER TABLE public.roads_retired RENAME TO roads; END IF;
  IF to_regclass('public.gweru_rural_planning_boundary_retired') IS NOT NULL THEN
    ALTER TABLE public.gweru_rural_planning_boundary_retired RENAME TO gweru_rural_planning_boundary;
  END IF;
END $$;
DELETE FROM tenancy.relation_class WHERE relation IN ('basemap.road', 'public.roads_retired', 'admin.planning_boundary');
DELETE FROM public.spatial_concept_source WHERE relation IN ('basemap.road', 'admin.planning_boundary');
UPDATE public.spatial_concept_source SET role = 'canonical', note = NULL WHERE relation = 'public.roads';
UPDATE public.spatial_concept_source SET role = 'legacy', note = 'interim boundary: the Gweru district, not Vungu RDC' WHERE relation = 'public.gweru_rural_planning_boundary';
DROP SCHEMA IF EXISTS basemap;  -- only if nothing else lives there
DELETE FROM public.schema_migrations WHERE filename = '221_roads_and_planning_boundary.sql';
