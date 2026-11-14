-- ROLLBACK OF 219 — ONE ZONES TABLE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/219_zones_one_table.down.sql
-- Restores the raw beyond table under its old name (if it was kept), the unfiltered zones_master, and removes the
-- compatibility view and the public-preview switch. The 16 beyond polygons stay in proposed_peri_urban_zones.
DROP VIEW IF EXISTS spatial_planning.zone;
DROP VIEW IF EXISTS public.vungu_beyond_peri_urban_zones;
DO $$
BEGIN
  IF to_regclass('public.vungu_beyond_peri_urban_zones_retired') IS NOT NULL THEN
    ALTER TABLE public.vungu_beyond_peri_urban_zones_retired RENAME TO vungu_beyond_peri_urban_zones;
  END IF;
END $$;
CREATE OR REPLACE VIEW public.zones_master WITH (security_invoker = true) AS
SELECT id, zone, zone_code, is_active, display_order, geom, area_ha FROM public.proposed_peri_urban_zones;
DELETE FROM tenancy.relation_class WHERE relation IN ('spatial_planning.zone');
DELETE FROM public.layer_publication WHERE table_name = 'vungu_beyond_peri_urban_zones' AND approved_by = 'migration 219';
ALTER POLICY tenant_select ON public.plan_instrument USING (
  app.is_platform() OR (authority_id IS NULL) OR (status = 'gazetted'::text) OR (authority_id = ANY (app.visible_authorities())));
ALTER TABLE public.plan_instrument DROP COLUMN IF EXISTS public_preview;
DELETE FROM public.schema_migrations WHERE filename = '219_zones_one_table.sql';
