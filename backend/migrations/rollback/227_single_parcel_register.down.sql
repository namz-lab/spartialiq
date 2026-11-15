-- ROLLBACK OF 227 — ONE PARCEL REGISTER
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/227_single_parcel_register.down.sql
-- Restores public.vungu_parcels as the raw table (from vungu_parcels_retired), labels the farm rows 'stand' again and unlinks them,
-- drops land.parcel_farm, and restores the bulk refresh and zone trigger of 225/226 that also walk vungu_parcels.
-- Farm parcels added by the loader after 227 (parcel_id 'VP-%') are removed with parcel_farm's rows only if you delete them yourself.
-- Run scripts/link-parcel-zones.js afterwards to re-cache parcel_zoning.
DROP VIEW IF EXISTS public.vungu_parcels;
DO $$
BEGIN
  IF to_regclass('public.vungu_parcels_retired') IS NOT NULL THEN
    ALTER TABLE public.vungu_parcels_retired RENAME TO vungu_parcels;
    DELETE FROM tenancy.relation_class WHERE relation = 'public.vungu_parcels_retired';
    CREATE TRIGGER trg_parcel_zoning AFTER INSERT OR UPDATE OF geom OR DELETE ON public.vungu_parcels
      FOR EACH ROW EXECUTE FUNCTION public.parcel_zoning_on_parcel('vungu_parcels', 'fid');
  END IF;
END $$;
UPDATE land.parcel SET parcel_kind = 'stand', source_relation = NULL, source_key = NULL
 WHERE parcel_kind = 'farm' AND source_relation = 'public.vungu_parcels' AND parcel_id NOT LIKE 'VP-%';
DROP TABLE IF EXISTS land.parcel_farm;
DELETE FROM tenancy.relation_class WHERE relation IN ('land.parcel_farm');
DELETE FROM public.spatial_concept_source WHERE relation IN ('land.parcel_farm', 'public.vungu_parcels_retired');
UPDATE public.spatial_concept_source SET role = 'canonical', note = '733 parcels read by the parcel-zoning engine; attributes are text, areas stored four times and disagree with the geometry' WHERE relation = 'public.vungu_parcels';
UPDATE public.spatial_concept_source SET role = 'target', note = 'the designed parcel model, now able to hold farms (migration 164); loaded from vungu_parcels by scripts/load-parcels-into-land.js, consumers not yet switched' WHERE relation = 'land.parcel';

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

CREATE OR REPLACE FUNCTION public.parcel_zoning_on_zone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pl uuid; p record;
BEGIN
  IF current_setting('lamis.skip_parcel_zoning', true) = 'on' THEN RETURN NULL; END IF;
  DROP TABLE IF EXISTS _zone_changed;
  CREATE TEMP TABLE _zone_changed (plan uuid, geom geometry) ON COMMIT DROP;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO _zone_changed SELECT plan_instrument_id, geom FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO _zone_changed SELECT plan_instrument_id, geom FROM old_rows;
  ELSE
    INSERT INTO _zone_changed
      SELECT x.plan_instrument_id, x.geom
        FROM new_rows n JOIN old_rows o ON o.id = n.id
        CROSS JOIN LATERAL (VALUES (n.plan_instrument_id, n.geom), (o.plan_instrument_id, o.geom)) x(plan_instrument_id, geom)
       WHERE n.plan_instrument_id IS DISTINCT FROM o.plan_instrument_id OR n.plan_zone_type_id IS DISTINCT FROM o.plan_zone_type_id
          OR (n.geom IS NULL) <> (o.geom IS NULL) OR NOT ST_OrderingEquals(n.geom, o.geom);
    UPDATE public.parcel_zoning pz SET plan_zone_type_id = n.plan_zone_type_id
      FROM new_rows n WHERE pz.zone_id = n.id AND pz.method = 'manual' AND pz.plan_zone_type_id IS DISTINCT FROM n.plan_zone_type_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _zone_changed) THEN RETURN NULL; END IF;
  FOR pl IN SELECT DISTINCT plan FROM _zone_changed WHERE plan IS NOT NULL LOOP
    PERFORM spatial_planning.refresh_zone_effective(pl);
  END LOOP;
  FOR p IN
    SELECT DISTINCT x.layer, x.id FROM (
      SELECT 'land.parcel'::text AS layer, parcel_id::text AS id, geom_wgs84 AS geom FROM land.parcel WHERE to_regclass('land.parcel') IS NOT NULL
      UNION ALL SELECT 'vungu_parcels', fid::text, geom FROM public.vungu_parcels WHERE to_regclass('public.vungu_parcels') IS NOT NULL
      UNION ALL SELECT 'stands', id::text, geom FROM public.stands WHERE to_regclass('public.stands') IS NOT NULL) x
     WHERE EXISTS (SELECT 1 FROM _zone_changed c WHERE c.geom IS NOT NULL AND ST_Intersects(x.geom, c.geom))
  LOOP
    PERFORM public.refresh_parcel_zoning(p.layer, p.id);
  END LOOP;
  RETURN NULL;
END $$;
DELETE FROM public.spatial_concept_source WHERE relation = 'spatial_planning.zone_effective';
