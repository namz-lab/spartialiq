-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 227 — ONE PARCEL REGISTER: FARM PARCELS ARE KINDS OF land.parcel, vungu_parcels BECOMES A VIEW
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/227_single_parcel_register.down.sql.
-- Tables only; rows that still need loading come from scripts/load-parcels-into-land.js.
--
-- Parcels lived in three tables: land.parcel (the register: finance, buildings, lineage and events point at it), public.vungu_parcels
-- (the raw farm import, the only place a farm's name, province and district were kept) and public.stands (the stand-sales layer, a
-- later step). The 731 farm parcels already in land.parcel (loaded by migration 187) were labelled 'stand', carried no link to their
-- source row, and lost the farm's name.
--   land.parcel_farm   the attributes only a farm has: name, name_cfu, province, district. Core columns stay narrow; one extension table
--                      per kind. The source's map sheet is the parcel's cadastre_ref and its "status" (Commercial, State Land ...) its tenure_class.
--   the 731 rows       matched to their vungu_parcels row by EXACT geometry (ST_Equals, one to one), then labelled 'farm' and linked by
--                      source_relation/source_key. Their ids, stand_no and boundaries are not touched (the boundary guard stays).
--   public.vungu_parcels  a compatibility view with the old columns over land.parcel + land.parcel_farm, so every reader and the tile layer
--                      keep working. The raw table is kept as vungu_parcels_retired.
-- parcel_zoning no longer caches a second set of rows for the farm layer (it duplicated the land.parcel rows); asking for the legacy
-- layer name still works: the zone is worked out live through the view.
-- Two vungu_parcels rows (fid 3 and 678) have no row in land.parcel; scripts/load-parcels-into-land.js --apply adds them.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS land.parcel_farm (
  parcel_id text PRIMARY KEY REFERENCES land.parcel (parcel_id) ON DELETE CASCADE,
  name      text,
  name_cfu  text,
  province  text,
  district  text
);
COMMENT ON TABLE land.parcel_farm IS
  'Attributes of a parcel of kind farm, as supplied with the farm extract (names are as typed in the source; many are blank or a number). Migration 227.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON land.parcel_farm TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON land.parcel_farm TO vungu_system; END IF;
  PERFORM tenancy.classify('land.parcel_farm', 'national', 'extension of land.parcel for farms; the cadastre is national data like the parcel table');
END $$;

-- ── The 731 farm rows: label, link and keep the farm's attributes ──────────────────────────
DO $$
DECLARE n integer;
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.vungu_parcels')) = 'r' THEN
    CREATE TEMP TABLE _farm_match ON COMMIT DROP AS
      SELECT p.parcel_id, v.fid, v.name, v.name_cfu, v.map_sheet, v.province, v.district, v.status
        FROM land.parcel p
        JOIN public.vungu_parcels v ON v.geom IS NOT NULL AND ST_Equals(v.geom, p.geom_wgs84)
       WHERE p.township_code = 'VUNGU' AND p.parcel_kind = 'stand' AND p.source_relation IS NULL;
    -- one source row per parcel and one parcel per source row, or nothing is changed
    IF (SELECT count(*) FROM _farm_match) <> (SELECT count(DISTINCT parcel_id) FROM _farm_match)
       OR (SELECT count(*) FROM _farm_match) <> (SELECT count(DISTINCT fid) FROM _farm_match) THEN
      RAISE EXCEPTION 'farm parcels do not match their source rows one to one; nothing changed';
    END IF;
    UPDATE land.parcel p SET parcel_kind = 'farm', source_relation = 'public.vungu_parcels', source_key = m.fid::text,
           cadastre_ref = COALESCE(p.cadastre_ref, NULLIF(btrim(m.map_sheet), '')),
           tenure_class = COALESCE(p.tenure_class, NULLIF(btrim(m.status), ''))
      FROM _farm_match m WHERE m.parcel_id = p.parcel_id;
    INSERT INTO land.parcel_farm (parcel_id, name, name_cfu, province, district)
    SELECT parcel_id, NULLIF(btrim(name), ''), NULLIF(btrim(name_cfu), ''), NULLIF(btrim(province), ''), NULLIF(btrim(district), '')
      FROM _farm_match ON CONFLICT (parcel_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'farm parcels linked to their source rows: %', n;
  END IF;
END $$;

-- ── The raw table is retired; the old name becomes a view ──────────────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.vungu_parcels')) = 'r' THEN
    DROP TRIGGER IF EXISTS trg_parcel_zoning ON public.vungu_parcels;
    ALTER TABLE public.vungu_parcels RENAME TO vungu_parcels_retired;
    PERFORM tenancy.classify('public.vungu_parcels_retired', 'pending', 'retired raw farm import (migration 227); the register is land.parcel; safe to drop');
  END IF;
END $$;

CREATE OR REPLACE VIEW public.vungu_parcels WITH (security_invoker = true) AS
SELECT p.source_key::integer AS fid,
       p.geom_wgs84 AS geom,
       NULL::integer AS gid,
       NULL::integer AS objectid,
       NULL::varchar AS row_id,
       f.name::varchar AS name,
       f.name_cfu::varchar AS name_cfu,
       p.cadastre_ref::varchar AS map_sheet,
       f.province::varchar AS province,
       f.district::varchar AS district,
       p.tenure_class::varchar AS status,
       (p.area_m2 / 1000000.0)::float8 AS area_km2,
       (p.area_m2 / 10000.0)::float8 AS area_ha,
       (p.area_m2 / 4046.8564224)::float8 AS area_acre,
       NULL::float8 AS area_km,
       NULL::float8 AS shape_leng,
       NULL::float8 AS shape_area
  FROM land.parcel p
  LEFT JOIN land.parcel_farm f ON f.parcel_id = p.parcel_id
 WHERE p.parcel_kind = 'farm' AND p.source_relation = 'public.vungu_parcels' AND p.status = 'current';
COMMENT ON VIEW public.vungu_parcels IS
  'Compatibility view: the farm parcels of land.parcel with the old vungu_parcels columns (docs/SPATIAL-NAMING-CONVENTION.md). Read only; the register is land.parcel.';

DO $$
BEGIN
  PERFORM tenancy.classify('public.vungu_parcels', 'national', 'compatibility view over land.parcel (farm parcels)');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT ON public.vungu_parcels TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT SELECT ON public.vungu_parcels TO vungu_system; END IF;
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('land.parcel', 'cadastral_parcel', 'canonical', 'the one parcel register: stands and farms, told apart by parcel_kind (migration 227)'),
  ('land.parcel_farm', 'cadastral_parcel', 'derived', 'attributes only farm parcels have'),
  ('public.vungu_parcels', 'cadastral_parcel', 'derived', 'compatibility view over land.parcel (farm parcels)'),
  ('public.vungu_parcels_retired', 'cadastral_parcel', 'legacy', 'retired raw farm import')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;

-- ── parcel_zoning: one set of rows per parcel ──────────────────────────────────────────────
-- A manual assignment made against the legacy layer is carried to the register; the cached intersections are dropped (land.parcel has them).
INSERT INTO public.parcel_zoning (parcel_layer, parcel_id, zone_id, plan_instrument_id, plan_zone_type_id, share_pct, method, is_governing, assigned_on, note)
SELECT 'land.parcel', p.parcel_id, z.zone_id, z.plan_instrument_id, z.plan_zone_type_id, z.share_pct, z.method, z.is_governing, z.assigned_on, z.note
  FROM public.parcel_zoning z
  JOIN land.parcel p ON p.source_relation = 'public.vungu_parcels' AND p.source_key = z.parcel_id
 WHERE z.parcel_layer = 'vungu_parcels' AND z.method = 'manual'
ON CONFLICT (parcel_layer, parcel_id, zone_id) DO NOTHING;
DELETE FROM public.parcel_zoning WHERE parcel_layer = 'vungu_parcels';

-- The bulk refresh and the zone trigger no longer walk the farm view (its parcels are the register's own rows).
CREATE OR REPLACE FUNCTION public.refresh_all_parcel_zoning()
RETURNS TABLE (parcel_layer text, parcels bigint, linked bigint, unzoned bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE l record; k record; n bigint; z bigint;
BEGIN
  FOR l IN SELECT * FROM (VALUES
      ('land.parcel', 'SELECT parcel_id::text AS id FROM land.parcel WHERE geom_wgs84 IS NOT NULL'),
      ('stands',      'SELECT id::text AS id FROM public.stands WHERE geom IS NOT NULL')) AS v(layer, ids)
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
      UNION ALL SELECT 'stands', id::text, geom FROM public.stands WHERE to_regclass('public.stands') IS NOT NULL) x
     WHERE EXISTS (SELECT 1 FROM _zone_changed c WHERE c.geom IS NOT NULL AND ST_Intersects(x.geom, c.geom))
  LOOP
    PERFORM public.refresh_parcel_zoning(p.layer, p.id);
  END LOOP;
  RETURN NULL;
END $$;

-- Migration 226 added spatial_planning.zone_effective without registering it as a source of the zone concept.
INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('spatial_planning.zone_effective', 'planning_zone', 'derived', 'each zone minus the overlaps another zone keeps (migration 226); what parcel zoning reads')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
