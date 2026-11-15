-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 225 — EVERY PARCEL KNOWS ITS ZONE, AND KEEPS KNOWING IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/225_parcel_zoning_kept_current.down.sql.
-- Tables only; the rows come from scripts/link-parcel-zones.js (or refresh_all_parcel_zoning()).
--
-- Migration 144 built the machinery (parcel_zoning, compute/refresh_parcel_zoning) but nothing ever filled the table, so a parcel's
-- zone was worked out afresh on every request and no application could carry it. This adds:
--   refresh_all_parcel_zoning()   re-cache every parcel of every layer (stands, vungu_parcels, land.parcel); manual rows are kept.
--   triggers on the three parcel tables  a new or re-shaped parcel is linked, a deleted one is unlinked.
--   triggers on spatial_planning.zone    a new, re-shaped, re-typed or removed zone re-links the parcels it touches.
-- The same rules as 144 apply: the governing zone is the largest share within each plan; a parcel in no zone is unzoned (no rows,
-- never "permitted"); a person's manual assignment always wins and is never overwritten.
--
-- A bulk load can switch the triggers off for its own transaction:  SET LOCAL lamis.skip_parcel_zoning = 'on';  then call
-- refresh_all_parcel_zoning() once. Without that, a statement that inserts many zones links the parcels under each zone in turn.
-- The functions run as their owner (SECURITY DEFINER) because parcel_zoning is row-level-secured and an editor of a parcel or a zone
-- has no business holding write access to the link table.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- The layers and the key column each is named by in parcel_zoning (see parcel_geometry() in 144).
CREATE OR REPLACE FUNCTION public.refresh_all_parcel_zoning()
RETURNS TABLE (parcel_layer text, parcels bigint, linked bigint, unzoned bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l record; k record; n bigint; z bigint;
BEGIN
  FOR l IN SELECT * FROM (VALUES
      ('land.parcel',   'SELECT parcel_id::text AS id FROM land.parcel WHERE geom_wgs84 IS NOT NULL'),
      ('vungu_parcels', 'SELECT fid::text AS id FROM public.vungu_parcels WHERE geom IS NOT NULL'),
      ('stands',        'SELECT id::text AS id FROM public.stands WHERE geom IS NOT NULL')) AS v(layer, ids)
  LOOP
    CONTINUE WHEN to_regclass(CASE l.layer WHEN 'land.parcel' THEN 'land.parcel' ELSE 'public.' || l.layer END) IS NULL;
    n := 0; z := 0;
    FOR k IN EXECUTE l.ids LOOP
      n := n + 1;
      IF public.refresh_parcel_zoning(l.layer, k.id) = 0
         AND NOT EXISTS (SELECT 1 FROM public.parcel_zoning p WHERE p.parcel_layer = l.layer AND p.parcel_id = k.id) THEN z := z + 1; END IF;
    END LOOP;
    parcel_layer := l.layer; parcels := n; unzoned := z; linked := n - z;
    RETURN NEXT;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.refresh_all_parcel_zoning() IS
  'Re-cache the zone(s) of every parcel in every layer. Slow (about 20 s for 2,300 parcels); use it after a bulk load, with the triggers off.';

-- ── A parcel changed ───────────────────────────────────────────────────────────────────────
-- Arguments: the layer name and the parcel table's key column.
CREATE OR REPLACE FUNCTION public.parcel_zoning_on_parcel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE id text;
BEGIN
  IF current_setting('lamis.skip_parcel_zoning', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    id := to_jsonb(OLD) ->> TG_ARGV[1];
    DELETE FROM public.parcel_zoning WHERE parcel_layer = TG_ARGV[0] AND parcel_id = id;
  ELSE
    id := to_jsonb(NEW) ->> TG_ARGV[1];
    PERFORM public.refresh_parcel_zoning(TG_ARGV[0], id);
  END IF;
  RETURN NULL;
END $$;

-- ── A zone changed ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.parcel_zoning_on_zone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g geometry; p record;
BEGIN
  IF current_setting('lamis.skip_parcel_zoning', true) = 'on' THEN RETURN NULL; END IF;
  FOR p IN
    SELECT DISTINCT x.layer, x.id FROM (
      SELECT 'land.parcel'::text AS layer, parcel_id::text AS id, geom_wgs84 AS geom FROM land.parcel WHERE to_regclass('land.parcel') IS NOT NULL
      UNION ALL SELECT 'vungu_parcels', fid::text, geom FROM public.vungu_parcels WHERE to_regclass('public.vungu_parcels') IS NOT NULL
      UNION ALL SELECT 'stands', id::text, geom FROM public.stands WHERE to_regclass('public.stands') IS NOT NULL) x
     WHERE (TG_OP <> 'DELETE' AND ST_Intersects(x.geom, NEW.geom))
        OR (TG_OP <> 'INSERT' AND ST_Intersects(x.geom, OLD.geom))
  LOOP
    PERFORM public.refresh_parcel_zoning(p.layer, p.id);
  END LOOP;
  -- A person's manual assignment keeps its zone but must follow the zone's type if that changed.
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.parcel_zoning SET plan_zone_type_id = NEW.plan_zone_type_id
     WHERE zone_id = NEW.id AND method = 'manual' AND plan_zone_type_id IS DISTINCT FROM NEW.plan_zone_type_id;
  END IF;
  RETURN NULL;
END $$;

-- The triggers sit on the real tables (compatibility views cannot carry row triggers).
DO $$
BEGIN
  IF to_regclass('land.parcel') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_parcel_zoning ON land.parcel;
    CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom_wgs84 OR DELETE ON land.parcel
      FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_parcel('land.parcel', 'parcel_id');
  END IF;
  IF to_regclass('public.vungu_parcels') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_parcel_zoning ON public.vungu_parcels;
    CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom OR DELETE ON public.vungu_parcels
      FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_parcel('vungu_parcels', 'fid');
  END IF;
  IF to_regclass('public.stands') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_parcel_zoning ON public.stands;
    CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom OR DELETE ON public.stands
      FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_parcel('stands', 'id');
  END IF;
  DROP TRIGGER IF EXISTS trg_parcel_zoning ON spatial_planning.zone;
  CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom, plan_instrument_id, plan_zone_type_id OR DELETE ON spatial_planning.zone
    FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_zone();
END $$;
