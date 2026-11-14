-- ROLLBACK OF 220 — SPATIAL TABLE NAMES
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/220_spatial_table_names.down.sql
-- Moves the four tables back to their old names and schemas (dropping the compatibility views that stood in for them),
-- puts back migration 219's spatial_planning.zone view, un-retires the raw peri-urban copy, and removes the registry rows 220 added.
CREATE FUNCTION pg_temp.move_back(p_old_schema text, p_old text, p_new_schema text, p_new text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  IF to_regclass(format('%I.%I', p_new_schema, p_new)) IS NULL THEN RETURN; END IF;
  EXECUTE format('DROP VIEW IF EXISTS %I.%I', p_old_schema, p_old);
  EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', p_new_schema, p_new, p_old);
  IF p_old_schema <> p_new_schema THEN EXECUTE format('ALTER TABLE %I.%I SET SCHEMA %I', p_new_schema, p_old, p_old_schema); END IF;
  FOR r IN SELECT s.relname FROM pg_class s JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
            WHERE s.relkind = 'S' AND d.refobjid = to_regclass(format('%I.%I', p_old_schema, p_old)) AND position(p_new IN s.relname) > 0
  LOOP EXECUTE format('ALTER SEQUENCE %I.%I RENAME TO %I', p_old_schema, r.relname, replace(r.relname, p_new, p_old)); END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = p_old_schema AND tablename = p_old AND position(p_new IN indexname) > 0
  LOOP EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', p_old_schema, r.indexname, replace(r.indexname, p_new, p_old)); END LOOP;
  DELETE FROM tenancy.relation_class WHERE relation = format('%s.%s', p_old_schema, p_old);  -- the compatibility view's row
  UPDATE tenancy.relation_class SET relation = format('%s.%s', p_old_schema, p_old) WHERE relation = format('%s.%s', p_new_schema, p_new);
END $fn$;

SELECT pg_temp.move_back('public', 'proposed_peri_urban_zones', 'spatial_planning', 'zone');
SELECT pg_temp.move_back('public', 'vungu_cemeteries', 'council_ops', 'cemetery');
SELECT pg_temp.move_back('public', 'vungu_waste_management', 'council_ops', 'waste_facility');
SELECT pg_temp.move_back('public', 'gweru_health_centres', 'council_ops', 'health_facility');

DO $$
BEGIN
  IF to_regclass('public.vungu_proposed_peri_urban_zones_retired') IS NOT NULL THEN
    ALTER TABLE public.vungu_proposed_peri_urban_zones_retired RENAME TO vungu_proposed_peri_urban_zones;
  END IF;
END $$;

-- Migration 219's compatibility view under the convention name.
CREATE OR REPLACE VIEW spatial_planning.zone WITH (security_invoker = true) AS
SELECT z.id, z.plan_instrument_id AS plan_id, z.plan_zone_type_id AS zone_type_id, z.zone AS name, z.zone_code AS code,
       z.scale_category AS category, z.ward, z.zone_description AS description, z.is_active AS active, z.area_ha, z.geom,
       z.created_at, z.updated_at
  FROM public.proposed_peri_urban_zones z;
SELECT tenancy.classify('spatial_planning.zone', 'tenant_view', 'view over the one zones table, under its row-level security');

DELETE FROM public.spatial_concept_source WHERE relation IN (
  'spatial_planning.zone', 'public.vungu_proposed_peri_urban_zones_retired', 'council_ops.cemetery', 'council_ops.waste_facility',
  'council_ops.health_facility', 'admin.chiefdom', 'admin.business_centre', 'admin.river', 'admin.polling_area', 'admin.polling_station',
  'finance.project', 'gis_ops.feature', 'gis_ops.feature_version', 'land.parcel_event', 'public.stand_subunit',
  'public.acua_stands_tile_view', 'spatial_engine.v_authority_ward', 'public.vungu_beyond_peri_urban_zones_retired');
UPDATE public.spatial_concept_source SET role = 'canonical', note = NULL WHERE relation IN ('public.proposed_peri_urban_zones', 'public.vungu_cemeteries', 'public.vungu_waste_management', 'public.gweru_chiefdoms');
UPDATE public.spatial_concept_source SET role = 'source' WHERE relation = 'public.vungu_beyond_peri_urban_zones';
UPDATE public.spatial_concept_source SET role = 'legacy', concept_code = 'point_of_interest' WHERE relation = 'public.gweru_health_centres';
INSERT INTO public.spatial_concept_source (relation, concept_code, role) VALUES ('public.vungu_proposed_peri_urban_zones', 'planning_zone', 'source')
  ON CONFLICT (relation) DO NOTHING;
DELETE FROM public.spatial_concept WHERE code IN ('health_facility', 'polling_area', 'polling_station', 'capital_project');
DELETE FROM public.schema_migrations WHERE filename = '220_spatial_table_names.sql';
