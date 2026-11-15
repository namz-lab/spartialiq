-- ROLLBACK OF 234
DELETE FROM admin.land_feature WHERE kind IN ('mine', 'proposed_new_city');
ALTER TABLE admin.land_feature DROP CONSTRAINT IF EXISTS land_feature_kind_known;
ALTER TABLE admin.land_feature ADD CONSTRAINT land_feature_kind_known CHECK (kind IN ('quarry', 'sand_working', 'irrigation_scheme', 'recreational_site'));
ALTER TABLE admin.land_feature DROP COLUMN IF EXISTS use;
DELETE FROM public.spatial_concept_source WHERE relation = 'admin.railway_line';
DROP TABLE IF EXISTS admin.railway_line;
DELETE FROM tenancy.relation_class WHERE relation = 'admin.railway_line';
DELETE FROM public.schema_migrations WHERE filename = '234_mines_new_city_railway.sql';
