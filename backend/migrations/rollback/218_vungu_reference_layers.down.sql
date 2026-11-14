-- ROLLBACK OF 218 — REFERENCE LAYERS FOR VUNGU
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/218_vungu_reference_layers.down.sql
-- Drops the five reference layers (re-loadable with scripts/load-reference-layers.js), the voter-rate measure and any
-- registered-voter denominators, then restores the denominator checks.
DELETE FROM spatial_engine.ward_value WHERE measure_key = 'water_points_per_voters';
DELETE FROM spatial_engine.measure WHERE measure_key = 'water_points_per_voters';
DROP FUNCTION IF EXISTS spatial_engine.m_water_points_per_voters();
DELETE FROM spatial_engine.ward_denominator WHERE kind = 'registered_voters';
ALTER TABLE spatial_engine.ward_denominator DROP CONSTRAINT IF EXISTS ward_denominator_kind_known;
ALTER TABLE spatial_engine.ward_denominator ADD CONSTRAINT ward_denominator_kind_known CHECK (kind IN ('population', 'households'));
ALTER TABLE spatial_engine.measure DROP CONSTRAINT IF EXISTS measure_denominator_known;
ALTER TABLE spatial_engine.measure ADD CONSTRAINT measure_denominator_known CHECK (denominator_kind IN ('facts', 'area_km2', 'population', 'households'));
DROP TABLE IF EXISTS admin.polling_area, admin.polling_station, admin.chiefdom, admin.business_centre, admin.river;
DELETE FROM tenancy.relation_class WHERE relation IN ('admin.polling_area', 'admin.polling_station', 'admin.chiefdom', 'admin.business_centre', 'admin.river');
DELETE FROM public.schema_migrations WHERE filename = '218_vungu_reference_layers.sql';
