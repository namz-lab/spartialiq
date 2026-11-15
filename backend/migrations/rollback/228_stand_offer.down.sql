-- ROLLBACK OF 228 — STAND OFFER
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/228_stand_offer.down.sql
-- Recreates an EMPTY public.stands table (the 8 demo stands are not restored), points stand_allocation and stand_subunit back at it,
-- and drops land.stand_offer. Any sales state recorded in land.stand_offer is lost: export it first if it matters.
DROP VIEW IF EXISTS public.acua_stands_tile_view;
DROP VIEW IF EXISTS public.stands_tile_view;
DROP VIEW IF EXISTS public.v_stands;
DROP VIEW IF EXISTS public.stands;
DROP POLICY IF EXISTS tenant_select ON public.stand_allocation;
DROP POLICY IF EXISTS tenant_write ON public.stand_allocation;
ALTER TABLE public.stand_allocation DROP CONSTRAINT IF EXISTS stand_allocation_stand_id_fkey;
ALTER TABLE public.stand_subunit DROP CONSTRAINT IF EXISTS stand_subunit_parent_stand_id_fkey;
DELETE FROM public.stand_allocation;
UPDATE public.stand_subunit SET parent_stand_id = NULL;

CREATE TABLE public.stands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stand_number varchar NOT NULL,
  ward varchar NOT NULL,
  zone_id integer REFERENCES spatial_planning.zone (id) ON DELETE SET NULL,
  zone_type varchar,
  use_scale varchar,
  area_sqm numeric NOT NULL CHECK (area_sqm > 0),
  frontage_m numeric,
  depth_m numeric,
  price_usd numeric CHECK (price_usd IS NULL OR price_usd >= 0),
  status varchar NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'allocated', 'withdrawn')),
  description text,
  geom geometry NOT NULL,
  centroid geometry,
  reserved_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  reserved_at timestamptz,
  reserved_until timestamptz,
  allocated_to uuid REFERENCES public.users (id) ON DELETE SET NULL,
  allocated_at timestamptz,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  ward_fid integer,
  use_scale_code varchar,
  status_code varchar,
  zone_type_cache varchar,
  statutory_plan_id uuid,
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  requires_minister_approval boolean NOT NULL DEFAULT false,
  UNIQUE (ward, stand_number)
);
CREATE INDEX idx_stands_geom ON public.stands USING gist (geom);
ALTER TABLE public.stand_allocation ALTER COLUMN stand_id TYPE uuid USING NULL;
ALTER TABLE public.stand_subunit ALTER COLUMN parent_stand_id TYPE uuid USING NULL;
ALTER TABLE public.stand_allocation ADD CONSTRAINT stand_allocation_stand_id_fkey FOREIGN KEY (stand_id) REFERENCES public.stands (id) ON DELETE CASCADE;
ALTER TABLE public.stand_subunit ADD CONSTRAINT stand_subunit_parent_stand_id_fkey FOREIGN KEY (parent_stand_id) REFERENCES public.stands (id) ON DELETE CASCADE;
SELECT tenancy.make_tenant('public.stands', 'VUNGU');
CREATE POLICY tenant_select ON public.stand_allocation FOR SELECT USING (EXISTS (SELECT 1 FROM public.stands p WHERE p.id = stand_allocation.stand_id));
CREATE POLICY tenant_write ON public.stand_allocation FOR ALL
  USING (app.is_platform() OR EXISTS (SELECT 1 FROM public.stands p WHERE p.id = stand_allocation.stand_id AND p.authority_id = app.authority_id()))
  WITH CHECK (app.is_platform() OR EXISTS (SELECT 1 FROM public.stands p WHERE p.id = stand_allocation.stand_id AND p.authority_id = app.authority_id()));
CREATE TRIGGER trg_notify_spatial_change AFTER INSERT OR UPDATE OR DELETE ON public.stands FOR EACH ROW EXECUTE FUNCTION public.notify_spatial_change();

CREATE VIEW public.v_stands AS
SELECT s.id, s.stand_number, s.ward, s.ward_fid, w.name_en AS ward_name, s.zone_id, COALESCE(z.zone, s.zone_type_cache::text) AS zone_type,
       s.use_scale, s.area_sqm, s.frontage_m, s.depth_m, s.price_usd, s.status, s.description, s.geom, s.centroid, s.reserved_by,
       s.reserved_at, s.reserved_until, s.allocated_to, s.allocated_at, s.created_by, s.created_at, s.updated_at
  FROM public.stands s LEFT JOIN public.wards w ON w.fid = s.ward_fid LEFT JOIN spatial_planning.zone z ON z.id = s.zone_id;
CREATE VIEW public.stands_tile_view AS
SELECT (row_number() OVER (ORDER BY created_at, id))::integer AS fid, id::text AS stand_id, stand_number, ward, zone_type_cache, use_scale, status,
       COALESCE(round(area_sqm)::integer, 0) AS area_sqm_int, COALESCE(round(price_usd * 100)::integer, 0) AS price_usd_cents, geom
  FROM public.stands WHERE status <> 'withdrawn';
CREATE VIEW public.acua_stands_tile_view AS
SELECT (row_number() OVER (ORDER BY created_at, id))::integer AS fid, id::text AS subunit_id, subunit_number, parent_stand_id::text AS parent_stand_id,
       estate, typology, status, COALESCE(round(area_sqm)::integer, round(target_area_sqm)::integer, 0) AS area_sqm_int,
       COALESCE(round(price_usd * 100)::integer, 0) AS price_usd_cents, geom
  FROM public.stand_subunit WHERE status <> 'withdrawn' AND typology = 'acua_300';

DROP TABLE IF EXISTS land.stand_offer;
DELETE FROM tenancy.relation_class WHERE relation = 'land.stand_offer';
DELETE FROM public.spatial_concept_source WHERE relation = 'land.stand_offer';
UPDATE public.spatial_concept_source SET role = 'source', note = NULL WHERE relation = 'public.stands';
-- The zone-link functions of migration 227 (which also walked the stands layer) are not restored: scripts/link-parcel-zones.js covers the register.
