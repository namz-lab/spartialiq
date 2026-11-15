-- ROLLBACK OF 225 — PARCEL ZONING KEPT CURRENT
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/225_parcel_zoning_kept_current.down.sql
-- Removes the triggers and functions. The rows already in parcel_zoning stay (they are a cache and manual assignments);
-- to empty the cache:  DELETE FROM parcel_zoning WHERE method = 'intersection';
DROP TRIGGER IF EXISTS trg_parcel_zoning ON spatial_planning.zone;
DO $$ BEGIN
  IF to_regclass('land.parcel') IS NOT NULL THEN DROP TRIGGER IF EXISTS trg_parcel_zoning ON land.parcel; END IF;
  IF to_regclass('public.vungu_parcels') IS NOT NULL THEN DROP TRIGGER IF EXISTS trg_parcel_zoning ON public.vungu_parcels; END IF;
  IF to_regclass('public.stands') IS NOT NULL THEN DROP TRIGGER IF EXISTS trg_parcel_zoning ON public.stands; END IF;
END $$;
DROP FUNCTION IF EXISTS public.parcel_zoning_on_zone();
DROP FUNCTION IF EXISTS public.parcel_zoning_on_parcel();
DROP FUNCTION IF EXISTS public.refresh_all_parcel_zoning();
