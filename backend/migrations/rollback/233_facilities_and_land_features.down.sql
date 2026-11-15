-- ROLLBACK OF 233 — FACILITIES AND LAND FEATURES (re-loadable with scripts/load-reference-layers.js after re-applying 233)
DELETE FROM public.spatial_concept_source WHERE relation IN ('admin.community_facility', 'admin.land_feature');
DELETE FROM public.spatial_concept WHERE code IN ('community_facility', 'land_feature');
DROP TABLE IF EXISTS admin.community_facility, admin.land_feature;
DELETE FROM tenancy.relation_class WHERE relation IN ('admin.community_facility', 'admin.land_feature');
DELETE FROM public.schema_migrations WHERE filename = '233_facilities_and_land_features.sql';
