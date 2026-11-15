-- ROLLBACK OF 237
DELETE FROM public.spatial_concept_source WHERE relation IN ('admin.targeted_farm', 'admin.retained_zone');
DELETE FROM public.spatial_concept WHERE code IN ('targeted_farm', 'retained_zone');
DROP TABLE IF EXISTS admin.targeted_farm, admin.retained_zone;
DELETE FROM tenancy.relation_class WHERE relation IN ('admin.targeted_farm', 'admin.retained_zone');
DELETE FROM public.schema_migrations WHERE filename = '237_targeted_farms_retained_zones.sql';
