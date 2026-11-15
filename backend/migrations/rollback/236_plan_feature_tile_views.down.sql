-- ROLLBACK OF 236
DELETE FROM public.spatial_concept_source WHERE relation IN ('public.vungu_facilities', 'public.vungu_land_features', 'public.vungu_railway');
DROP VIEW IF EXISTS public.vungu_facilities, public.vungu_land_features, public.vungu_railway;
DELETE FROM tenancy.relation_class WHERE relation IN ('public.vungu_facilities', 'public.vungu_land_features', 'public.vungu_railway');
DELETE FROM public.schema_migrations WHERE filename = '236_plan_feature_tile_views.sql';
