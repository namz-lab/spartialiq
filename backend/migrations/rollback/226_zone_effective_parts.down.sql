-- ROLLBACK OF 226 — ZONE EFFECTIVE PARTS
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/226_zone_effective_parts.down.sql
-- Drops the effective parts, the overlap view and the statement triggers, restores 225's row trigger and the parcel link's
-- reading of the zones' own polygons. Run scripts/link-parcel-zones.js afterwards to re-cache the parcel shares.
DROP TRIGGER IF EXISTS trg_zone_parcel_link_ins ON spatial_planning.zone;
DROP TRIGGER IF EXISTS trg_zone_parcel_link_upd ON spatial_planning.zone;
DROP TRIGGER IF EXISTS trg_zone_parcel_link_del ON spatial_planning.zone;

CREATE OR REPLACE FUNCTION public.compute_parcel_zoning(p_layer text, p_id text)
RETURNS TABLE (zone_id integer, plan_instrument_id uuid, plan_zone_type_id uuid, zone_name text,
               share_pct numeric, is_governing boolean) AS $$
  WITH g AS (SELECT parcel_geometry(p_layer, p_id) AS geom),
  x AS (
    SELECT z.id, z.plan_instrument_id AS plan, z.plan_zone_type_id AS ztype, z.zone,
           ST_Area(ST_CollectionExtract(ST_Intersection(g.geom, z.geom), 3)::geography) AS a,
           ST_Area(g.geom::geography) AS parcel_area
      FROM g
      JOIN proposed_peri_urban_zones z ON g.geom IS NOT NULL AND ST_Intersects(g.geom, z.geom)
      JOIN plan_instrument i ON i.id = z.plan_instrument_id AND NOT i.is_template)
  SELECT x.id, x.plan, x.ztype, x.zone,
         ROUND((100 * x.a / NULLIF(x.parcel_area, 0))::numeric, 2),
         ROW_NUMBER() OVER (PARTITION BY x.plan ORDER BY x.a DESC, x.id) = 1
    FROM x
   WHERE x.a > 0
   ORDER BY x.plan, x.a DESC, x.id
$$ LANGUAGE sql STABLE;

-- The row-level zone function of 225, and its trigger.
CREATE OR REPLACE FUNCTION public.parcel_zoning_on_zone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p record;
BEGIN
  IF current_setting('lamis.skip_parcel_zoning', true) = 'on' THEN RETURN NULL; END IF;
  FOR p IN
    SELECT DISTINCT x.layer, x.id FROM (
      SELECT 'land.parcel'::text AS layer, parcel_id::text AS id, geom_wgs84 AS geom FROM land.parcel WHERE to_regclass('land.parcel') IS NOT NULL
      UNION ALL SELECT 'vungu_parcels', fid::text, geom FROM public.vungu_parcels WHERE to_regclass('public.vungu_parcels') IS NOT NULL
      UNION ALL SELECT 'stands', id::text, geom FROM public.stands WHERE to_regclass('public.stands') IS NOT NULL) x
     WHERE (TG_OP <> 'DELETE' AND ST_Intersects(x.geom, NEW.geom)) OR (TG_OP <> 'INSERT' AND ST_Intersects(x.geom, OLD.geom))
  LOOP
    PERFORM public.refresh_parcel_zoning(p.layer, p.id);
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.parcel_zoning SET plan_zone_type_id = NEW.plan_zone_type_id
     WHERE zone_id = NEW.id AND method = 'manual' AND plan_zone_type_id IS DISTINCT FROM NEW.plan_zone_type_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom, plan_instrument_id, plan_zone_type_id OR DELETE ON spatial_planning.zone
  FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_zone();

DROP FUNCTION IF EXISTS spatial_planning.refresh_zone_effective(uuid);
DROP TABLE IF EXISTS spatial_planning.zone_effective;
DROP FUNCTION IF EXISTS spatial_planning.safe_difference(geometry, geometry);
DROP VIEW IF EXISTS spatial_planning.v_zone_overlap;
DELETE FROM tenancy.relation_class WHERE relation = 'spatial_planning.zone_effective';
ALTER TABLE public.plan_zone_type DROP COLUMN IF EXISTS is_overlay;
