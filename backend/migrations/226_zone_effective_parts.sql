-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 226 — WHERE ZONES OVERLAP, EACH PIECE OF LAND HAS ONE ZONE: "EFFECTIVE" PARTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/226_zone_effective_parts.down.sql.
-- Tables only; the rows come from refresh_zone_effective() (run here for every plan, and by the zone triggers).
--
-- The council's zone polygons overlap each other (the Vungu plan: 69 overlapping pairs, 43 of them slivers under 2 m wide along
-- shared boundaries, 26 real, 577 ha). A parcel under two overlapping zones got both shares and they added to over 100%.
-- The supplied polygons are NOT edited (a re-import would bring the overlaps back, and they are the council's boundaries).
-- Instead each zone gets an effective geometry: the zone minus the pieces that a winning zone keeps. Effective parts of one plan
-- never overlap, so parcel shares add to the part of the parcel that lies inside any zone.
--
-- THE PRECEDENCE RULE (a PROPOSAL, for the council to confirm; it is data and one view, easy to change):
--   1. a sliver (an overlap whose mean width is under 2 m) goes to the larger zone: it is a digitising fault along a shared edge;
--   2. otherwise a zone type marked is_overlay (the Economic Corridor, a road-side strip) keeps the overlap over the zone beneath;
--   3. otherwise the smaller, more specific zone keeps it.
-- v_zone_overlap lists every overlap with its winner and the rule applied, so the council can correct the zones at source.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plan_zone_type ADD COLUMN IF NOT EXISTS is_overlay boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.plan_zone_type.is_overlay IS
  'An overlay zone (e.g. a road-side economic corridor) keeps land it overlaps over the underlying zone. PROPOSED for the Vungu plan; the council confirms.';
UPDATE public.plan_zone_type t SET is_overlay = true
  FROM public.plan_instrument i
 WHERE i.id = t.plan_instrument_id AND NOT i.is_template AND i.title = 'Vungu RDC peri-urban local plan (as mapped)'
   AND t.code LIKE 'Economic Corridor%';

-- ── The overlaps, with who keeps each ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW spatial_planning.v_zone_overlap WITH (security_invoker = true) AS
WITH z AS (
  SELECT z.id, z.zone, z.plan_instrument_id AS plan, z.geom, ST_Area(z.geom::geography) AS area, COALESCE(t.is_overlay, false) AS overlay
    FROM spatial_planning.zone z LEFT JOIN public.plan_zone_type t ON t.id = z.plan_zone_type_id
   WHERE z.geom IS NOT NULL),
p AS (
  SELECT a.plan, a.id AS a_id, b.id AS b_id, a.zone AS a_zone, b.zone AS b_zone, a.area AS a_area, b.area AS b_area,
         a.overlay AS a_ov, b.overlay AS b_ov, ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 3) AS i
    FROM z a JOIN z b ON a.plan = b.plan AND a.id < b.id AND ST_Intersects(a.geom, b.geom)),
m AS (
  SELECT p.*, ST_Area(i::geography) AS ia, ST_Area(i::geography) / NULLIF(ST_Perimeter(i::geography), 0) AS thick FROM p),
w AS (
  SELECT m.*,
         CASE WHEN thick < 2 THEN (a_area > b_area OR (a_area = b_area AND a_id < b_id))
              WHEN a_ov <> b_ov THEN a_ov
              ELSE (a_area < b_area OR (a_area = b_area AND a_id < b_id)) END AS a_wins
    FROM m WHERE ia > 1)
SELECT plan AS plan_instrument_id, a_id AS zone_a_id, b_id AS zone_b_id, a_zone, b_zone,
       round((ia / 10000)::numeric, 2) AS overlap_ha,
       round(thick::numeric, 1) AS mean_width_m,
       CASE WHEN thick < 2 THEN 'sliver' ELSE 'overlap' END AS kind,
       CASE WHEN a_wins THEN a_id ELSE b_id END AS winner_zone_id,
       CASE WHEN a_wins THEN b_id ELSE a_id END AS loser_zone_id,
       CASE WHEN a_wins THEN a_zone ELSE b_zone END AS winner_zone,
       CASE WHEN thick < 2 THEN 'sliver: the larger zone keeps it'
            WHEN a_ov <> b_ov THEN 'overlay zone keeps it'
            ELSE 'the smaller zone keeps it' END AS rule
  FROM w;
COMMENT ON VIEW spatial_planning.v_zone_overlap IS
  'Every overlap between two zones of one plan, who keeps it and by which rule (migration 226). For the council to correct the zones at source.';

-- A difference that survives the geometry engine's occasional refusal (GEOS 3.9 on near-coincident edges).
CREATE OR REPLACE FUNCTION spatial_planning.safe_difference(a geometry, b geometry) RETURNS geometry
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN ST_Difference(a, b);
EXCEPTION WHEN others THEN
  BEGIN
    RETURN ST_Difference(ST_Buffer(ST_MakeValid(a), 0), ST_Buffer(ST_MakeValid(b), 0));
  EXCEPTION WHEN others THEN
    RETURN ST_Difference(ST_SnapToGrid(ST_MakeValid(a), 0.000000001), ST_SnapToGrid(ST_MakeValid(b), 0.000000001));
  END;
END $$;

-- ── The effective parts ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_planning.zone_effective (
  zone_id            integer PRIMARY KEY REFERENCES spatial_planning.zone (id) ON DELETE CASCADE,
  plan_instrument_id uuid    NOT NULL REFERENCES public.plan_instrument (id) ON DELETE CASCADE,
  -- NULL when every part of the zone is kept by a winning zone.
  geom               geometry(MultiPolygon, 4326),
  area_ha            numeric NOT NULL,
  trimmed_ha         numeric NOT NULL DEFAULT 0,
  computed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_effective_geom_gix ON spatial_planning.zone_effective USING gist (geom);
CREATE INDEX IF NOT EXISTS zone_effective_plan_ix ON spatial_planning.zone_effective (plan_instrument_id);
COMMENT ON TABLE spatial_planning.zone_effective IS
  'Each zone minus the overlaps a winning zone keeps (v_zone_overlap). Non-overlapping within a plan; derived, never edited. Migration 226.';

DO $$
BEGIN
  PERFORM tenancy.make_tenant_child('spatial_planning.zone_effective', 'public.plan_instrument', 'plan_instrument_id');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT ON spatial_planning.zone_effective TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON spatial_planning.zone_effective TO vungu_system; END IF;
END $$;

CREATE OR REPLACE FUNCTION spatial_planning.refresh_zone_effective(p_plan uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, spatial_planning, pg_temp AS $$
DECLARE n integer;
BEGIN
  DROP TABLE IF EXISTS _zone_overlap;
  CREATE TEMP TABLE _zone_overlap ON COMMIT DROP AS SELECT * FROM spatial_planning.v_zone_overlap WHERE plan_instrument_id = p_plan;
  DELETE FROM spatial_planning.zone_effective WHERE plan_instrument_id = p_plan;
  INSERT INTO spatial_planning.zone_effective (zone_id, plan_instrument_id, geom, area_ha, trimmed_ha)
  SELECT z.id, p_plan,
         CASE WHEN e.g IS NULL OR ST_IsEmpty(e.g) THEN NULL ELSE ST_Multi(e.g) END,
         ROUND((ST_Area(z.geom::geography) / 10000)::numeric, 2),
         ROUND(((ST_Area(z.geom::geography) - COALESCE(ST_Area(e.g::geography), 0)) / 10000)::numeric, 2)
    FROM spatial_planning.zone z
    LEFT JOIN LATERAL (
      SELECT CASE WHEN u.g IS NULL THEN z.geom
                  ELSE ST_CollectionExtract(spatial_planning.safe_difference(z.geom, u.g), 3) END AS g
        FROM (SELECT ST_UnaryUnion(ST_Collect(w.geom)) AS g
                FROM _zone_overlap o JOIN spatial_planning.zone w ON w.id = o.winner_zone_id
               WHERE o.loser_zone_id = z.id) u) e ON true
   WHERE z.plan_instrument_id = p_plan AND z.geom IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── The parcel link reads the effective parts ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_parcel_zoning(p_layer text, p_id text)
RETURNS TABLE (zone_id integer, plan_instrument_id uuid, plan_zone_type_id uuid, zone_name text,
               share_pct numeric, is_governing boolean) AS $$
  WITH g AS (SELECT parcel_geometry(p_layer, p_id) AS geom),
  x AS (
    SELECT z.id, z.plan_instrument_id AS plan, z.plan_zone_type_id AS ztype, z.zone,
           ST_Area(ST_CollectionExtract(ST_Intersection(g.geom, COALESCE(e.geom, z.geom)), 3)::geography) AS a,
           ST_Area(g.geom::geography) AS parcel_area
      FROM g
      JOIN proposed_peri_urban_zones z ON g.geom IS NOT NULL AND ST_Intersects(g.geom, z.geom)
      JOIN plan_instrument i ON i.id = z.plan_instrument_id AND NOT i.is_template
      -- a zone with an effective-part row uses it (NULL = wholly kept by another zone); one without uses its own polygon
      LEFT JOIN spatial_planning.zone_effective e ON e.zone_id = z.id
     WHERE e.zone_id IS NULL OR e.geom IS NOT NULL)
  SELECT x.id, x.plan, x.ztype, x.zone,
         ROUND((100 * x.a / NULLIF(x.parcel_area, 0))::numeric, 2),
         ROW_NUMBER() OVER (PARTITION BY x.plan ORDER BY x.a DESC, x.id) = 1
    FROM x
   WHERE x.a > 0
   ORDER BY x.plan, x.a DESC, x.id
$$ LANGUAGE sql STABLE;

-- ── A zone changed: re-derive its plan's parts, then re-link the parcels it touches ────────
-- Statement-level, so a bulk statement does the work once. It runs when a zone is added, removed, reshaped, re-typed or moved
-- to another plan; any other edit is ignored. (Replaces the row triggers of migration 225.)
DROP TRIGGER IF EXISTS trg_parcel_zoning ON spatial_planning.zone;

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
    -- A manual assignment keeps its zone but follows the zone's type if that changed.
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

CREATE TRIGGER trg_zone_parcel_link_ins AFTER INSERT ON spatial_planning.zone
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.parcel_zoning_on_zone();
CREATE TRIGGER trg_zone_parcel_link_upd AFTER UPDATE ON spatial_planning.zone
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.parcel_zoning_on_zone();
CREATE TRIGGER trg_zone_parcel_link_del AFTER DELETE ON spatial_planning.zone
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.parcel_zoning_on_zone();

-- Derive the parts for the plans already loaded.
DO $$
DECLARE pl uuid;
BEGIN
  FOR pl IN SELECT DISTINCT plan_instrument_id FROM spatial_planning.zone WHERE plan_instrument_id IS NOT NULL LOOP
    PERFORM spatial_planning.refresh_zone_effective(pl);
  END LOOP;
END $$;
