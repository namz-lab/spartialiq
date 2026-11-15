-- ROLLBACK OF 235
ALTER TABLE admin.business_centre DROP CONSTRAINT IF EXISTS business_centre_level_known;
ALTER TABLE admin.business_centre DROP COLUMN IF EXISTS level;
ALTER TABLE admin.community_facility DROP COLUMN IF EXISTS village;
ALTER TABLE council_ops.health_facility DROP COLUMN IF EXISTS loaded_at, DROP COLUMN IF EXISTS source;
DELETE FROM public.schema_migrations WHERE filename = '235_business_centre_levels_health_source.sql';
