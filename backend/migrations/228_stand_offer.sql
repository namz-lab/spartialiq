-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 228 — STAND SALES AS A THIN TABLE OVER THE PARCEL REGISTER; THE DEMO STANDS ARE DROPPED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/228_stand_offer.down.sql (recreates an empty public.stands table; the demo rows are not restored).
--
-- public.stands was a second parcel table: its own geometry, number, ward and zone, plus the council's sales state (price, reserved,
-- allocated). The register already holds the 1,589 real stands, so identity and geometry now come from land.parcel and the sales state
-- is a small table keyed by parcel:
--   land.stand_offer   one row per parcel the council has put on offer: price, use scale, available | reserved | allocated | withdrawn,
--                      reservation and allocation. A parcel with NO row is "not offered", never "available".
--   public.stands      a compatibility view (the old columns, id = the parcel id) over land.parcel + land.stand_offer + the parcel's
--                      governing zone (parcel_zoning), so the readers and the stand tile layer keep working.
--   stand_allocation.stand_id and stand_subunit.parent_stand_id now name a parcel (they were the demo table's uuids; both are empty).
-- A stand's boundary is never edited here: it changes only through the Survey Section import (land.parcel_guard). The overlap trigger
-- and the zone-type cache of the old table go with it; the governing zone comes from parcel_zoning.
-- The 8 demo stands are dropped. A database whose allocations or sub-units are not empty is refused (nothing is dropped).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.stands')) <> 'r' THEN
    RAISE EXCEPTION 'public.stands is not the demo table any more; migration 228 has already run or the database is not as expected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stand_allocation) OR EXISTS (SELECT 1 FROM public.stand_subunit) THEN
    RAISE EXCEPTION 'stand_allocation or stand_subunit holds rows that name the old stands table; nothing was changed';
  END IF;
END $$;

-- ── 1. The sales table ─────────────────────────────────────────────────────────────────────
CREATE TABLE land.stand_offer (
  parcel_id    varchar PRIMARY KEY REFERENCES land.parcel (parcel_id),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  status       varchar NOT NULL DEFAULT 'available'
               CONSTRAINT stand_offer_status_known CHECK (status IN ('available', 'reserved', 'allocated', 'withdrawn')),
  use_scale    varchar,
  price_usd    numeric CONSTRAINT stand_offer_price_nonneg CHECK (price_usd IS NULL OR price_usd >= 0),
  frontage_m   numeric,
  depth_m      numeric,
  description  text,
  reserved_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  reserved_at    timestamptz,
  reserved_until timestamptz,
  allocated_to   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  allocated_at   timestamptz,
  requires_minister_approval boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stand_offer_status ON land.stand_offer (status);
COMMENT ON TABLE land.stand_offer IS
  'The council''s sales state of a stand (price, reserved, allocated). One row per parcel put on offer; no row = not offered. Migration 228.';
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON land.stand_offer FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 2. What names a stand names a parcel ───────────────────────────────────────────────────
DROP VIEW IF EXISTS public.acua_stands_tile_view;
DROP VIEW IF EXISTS public.stands_tile_view;
DROP VIEW IF EXISTS public.v_stands;
DROP POLICY IF EXISTS tenant_select ON public.stand_allocation;
DROP POLICY IF EXISTS tenant_write ON public.stand_allocation;
ALTER TABLE public.stand_allocation DROP CONSTRAINT stand_allocation_stand_id_fkey;
ALTER TABLE public.stand_subunit DROP CONSTRAINT stand_subunit_parent_stand_id_fkey;
ALTER TABLE public.stand_allocation ALTER COLUMN stand_id TYPE varchar USING stand_id::varchar;
ALTER TABLE public.stand_subunit ALTER COLUMN parent_stand_id TYPE varchar USING parent_stand_id::varchar;
ALTER TABLE public.stand_allocation ADD CONSTRAINT stand_allocation_stand_id_fkey
  FOREIGN KEY (stand_id) REFERENCES land.parcel (parcel_id) ON DELETE CASCADE;
ALTER TABLE public.stand_subunit ADD CONSTRAINT stand_subunit_parent_stand_id_fkey
  FOREIGN KEY (parent_stand_id) REFERENCES land.parcel (parcel_id) ON DELETE CASCADE;

-- ── 3. The demo table goes; the old name becomes a view ────────────────────────────────────
DELETE FROM public.parcel_zoning WHERE parcel_layer = 'stands';
DROP TABLE public.stands;

CREATE VIEW public.stands WITH (security_invoker = true) AS
SELECT p.parcel_id::varchar                       AS id,
       p.stand_no::varchar                        AS stand_number,
       w.name::varchar                            AS ward,
       gz.zone_id                                 AS zone_id,
       gz.zone_name::varchar                      AS zone_type,
       o.use_scale                                AS use_scale,
       p.area_m2                                  AS area_sqm,
       o.frontage_m                               AS frontage_m,
       o.depth_m                                  AS depth_m,
       o.price_usd                                AS price_usd,
       COALESCE(o.status, CASE WHEN p.allocation_status = 'allocated' THEN 'allocated' ELSE 'not_offered' END)::varchar AS status,
       o.description                              AS description,
       p.geom_wgs84                               AS geom,
       ST_Centroid(p.geom_wgs84)                  AS centroid,
       o.reserved_by, o.reserved_at, o.reserved_until, o.allocated_to, o.allocated_at,
       o.created_by,
       p.created_at, p.updated_at,
       w.legacy_fid                               AS ward_fid,
       NULL::varchar                              AS use_scale_code,
       COALESCE(o.status, 'not_offered')::varchar AS status_code,
       gz.zone_name::varchar                      AS zone_type_cache,
       NULL::uuid                                 AS statutory_plan_id,
       COALESCE(o.authority_id, p.authority_id)   AS authority_id,
       COALESCE(o.requires_minister_approval, false) AS requires_minister_approval
  FROM land.parcel p
  LEFT JOIN land.stand_offer o ON o.parcel_id = p.parcel_id
  LEFT JOIN admin.ward w ON w.ward_code = p.ward_code
  LEFT JOIN LATERAL (
    SELECT pz.zone_id, COALESCE(t.name, z.zone) AS zone_name
      FROM public.parcel_zoning pz
      JOIN spatial_planning.zone z ON z.id = pz.zone_id
      LEFT JOIN public.plan_zone_type t ON t.id = pz.plan_zone_type_id
     WHERE pz.parcel_layer = 'land.parcel' AND pz.parcel_id = p.parcel_id AND pz.is_governing
     ORDER BY pz.plan_instrument_id LIMIT 1) gz ON true
 WHERE p.parcel_kind = 'stand' AND p.status = 'current';
COMMENT ON VIEW public.stands IS
  'Compatibility view: the register''s stands with their sales state (land.stand_offer) and governing zone, with the old columns; id is the parcel id (migration 228).';

CREATE VIEW public.v_stands AS
SELECT s.id, s.stand_number, s.ward, s.ward_fid, w.name_en AS ward_name, s.zone_id,
       COALESCE(z.zone, s.zone_type_cache::text) AS zone_type, s.use_scale, s.area_sqm, s.frontage_m, s.depth_m, s.price_usd, s.status,
       s.description, s.geom, s.centroid, s.reserved_by, s.reserved_at, s.reserved_until, s.allocated_to, s.allocated_at,
       s.created_by, s.created_at, s.updated_at
  FROM public.stands s
  LEFT JOIN public.wards w ON w.fid = s.ward_fid
  LEFT JOIN spatial_planning.zone z ON z.id = s.zone_id;

CREATE VIEW public.stands_tile_view AS
SELECT (row_number() OVER (ORDER BY created_at, id))::integer AS fid,
       id::text AS stand_id, stand_number, ward, zone_type_cache, use_scale, status,
       COALESCE(round(area_sqm)::integer, 0) AS area_sqm_int,
       COALESCE(round(price_usd * 100)::integer, 0) AS price_usd_cents,
       geom
  FROM public.stands
 WHERE status <> 'withdrawn';

CREATE VIEW public.acua_stands_tile_view AS
SELECT (row_number() OVER (ORDER BY created_at, id))::integer AS fid,
       id::text AS subunit_id, subunit_number, parent_stand_id::text AS parent_stand_id, estate, typology, status,
       COALESCE(round(area_sqm)::integer, round(target_area_sqm)::integer, 0) AS area_sqm_int,
       COALESCE(round(price_usd * 100)::integer, 0) AS price_usd_cents,
       geom
  FROM public.stand_subunit
 WHERE status <> 'withdrawn' AND typology = 'acua_300';

-- ── 4. Row-level security: as the old table had it ─────────────────────────────────────────
SELECT tenancy.make_tenant('land.stand_offer', 'VUNGU');
-- Anyone may see a stand that is on offer; a person sees their own reservation or allocation.
DROP POLICY IF EXISTS tenant_select ON land.stand_offer;
CREATE POLICY tenant_select ON land.stand_offer FOR SELECT USING (
  app.is_platform() OR authority_id = ANY (app.visible_authorities()) OR status = 'available'
  OR reserved_by = app.user_id() OR allocated_to = app.user_id());
-- A signed-in citizen may reserve an available stand, and release their own reservation.
DROP POLICY IF EXISTS citizen_reserve ON land.stand_offer;
CREATE POLICY citizen_reserve ON land.stand_offer FOR UPDATE
  USING (app.user_id() IS NOT NULL AND (status = 'available' OR reserved_by = app.user_id()))
  WITH CHECK (app.user_id() IS NOT NULL AND (reserved_by IS NULL OR reserved_by = app.user_id()));

CREATE POLICY tenant_select ON public.stand_allocation FOR SELECT USING (
  EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id));
CREATE POLICY tenant_write ON public.stand_allocation FOR ALL
  USING (app.is_platform() OR EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id AND p.authority_id = app.authority_id()))
  WITH CHECK (app.is_platform() OR EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id AND p.authority_id = app.authority_id()));

-- The map refreshes when a stand's sales state changes (src/services/spatialChangeListener.js maps this table to the stands layer).
CREATE TRIGGER trg_notify_spatial_change AFTER INSERT OR UPDATE OR DELETE ON land.stand_offer
  FOR EACH ROW EXECUTE FUNCTION public.notify_spatial_change();

-- ── 5. Grants, classes, registry ───────────────────────────────────────────────────────────
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.stands', 'public.v_stands', 'public.stands_tile_view', 'public.acua_stands_tile_view'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', v); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_system', v); END IF;
  END LOOP;
  PERFORM tenancy.classify('public.stands', 'tenant_view', 'compatibility view over land.parcel + land.stand_offer (migration 228)');
  PERFORM tenancy.classify('public.v_stands', 'tenant_view', 'view over public.stands');
  PERFORM tenancy.classify('public.stands_tile_view', 'tenant_view', 'tile view over public.stands');
  PERFORM tenancy.classify('public.acua_stands_tile_view', 'tenant_view', 'tile view over stand_subunit');
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('public.stands', 'cadastral_parcel', 'derived', 'compatibility view over land.parcel + land.stand_offer (migration 228)'),
  ('land.stand_offer', 'cadastral_parcel', 'derived', 'the council''s sales state of a stand: price, reserved, allocated')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;

-- ── 6. The zone link no longer walks the old stands layer ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_all_parcel_zoning()
RETURNS TABLE (parcel_layer text, parcels bigint, linked bigint, unzoned bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k record; n bigint := 0; z bigint := 0;
BEGIN
  FOR k IN SELECT parcel_id::text AS id FROM land.parcel WHERE geom_wgs84 IS NOT NULL LOOP
    n := n + 1;
    IF public.refresh_parcel_zoning('land.parcel', k.id) = 0
       AND NOT EXISTS (SELECT 1 FROM public.parcel_zoning p WHERE p.parcel_layer = 'land.parcel' AND p.parcel_id = k.id) THEN z := z + 1; END IF;
  END LOOP;
  parcel_layer := 'land.parcel'; parcels := n; unzoned := z; linked := n - z;
  RETURN NEXT;
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
    SELECT parcel_id::text AS id FROM land.parcel x
     WHERE EXISTS (SELECT 1 FROM _zone_changed c WHERE c.geom IS NOT NULL AND ST_Intersects(x.geom_wgs84, c.geom))
  LOOP
    PERFORM public.refresh_parcel_zoning('land.parcel', p.id);
  END LOOP;
  RETURN NULL;
END $$;
