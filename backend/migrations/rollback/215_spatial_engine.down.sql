-- ROLLBACK OF 215 — THE SPATIAL ENGINE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/215_spatial_engine.down.sql
-- Drops the whole spatial_engine schema: the measure catalogue, the loaded ward denominators, the runs and the
-- computed ward values. The values are derived and can be recomputed, but loaded denominators (census figures)
-- are not: export spatial_engine.ward_denominator first if any have been loaded.
DROP SCHEMA IF EXISTS spatial_engine CASCADE;
DELETE FROM tenancy.relation_class WHERE relation LIKE 'spatial_engine.%';
DELETE FROM public.schema_migrations WHERE filename = '215_spatial_engine.sql';
