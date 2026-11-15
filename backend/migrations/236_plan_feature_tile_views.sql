-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 236 — THE PRINTED SHEET'S FEATURES AS MAP TILES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/236_plan_feature_tile_views.down.sql.
--
-- The tile server reads a table or view by name and needs an integer `fid`. Three views, one per geometry, over the tables of migrations 233 to 235:
--   public.vungu_facilities      points    schools, police posts, dip tanks, network boosters, health facilities, business centres
--   public.vungu_land_features   polygons  quarries, sand workings, mines, irrigation schemes, recreational sites, the proposed new city
--   public.vungu_railway         lines     the railway lines of the plan
-- `kind` is what a style colours by. fid is stable: the source id, offset per source table so no two features share one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.vungu_facilities AS
  SELECT f.id::bigint AS fid, f.kind, COALESCE(f.name, f.village) AS name, f.subtype, f.grade, f.geom
    FROM admin.community_facility f
  UNION ALL
  SELECT 1000000 + h.id::bigint, 'health_facility', h.nameoffaci, h.typeoffaci, NULL::text, ST_GeometryN(h.geom, 1)
    FROM council_ops.health_facility h WHERE h.geom IS NOT NULL
  UNION ALL
  SELECT 2000000 + b.id::bigint,
         CASE b.sector WHEN 'BC' THEN 'business_centre' WHEN 'RSC' THEN 'rural_service_centre' ELSE 'growth_point' END,
         b.village,
         CASE WHEN b.level IS NOT NULL THEN 'Level ' || b.level END,
         NULL::text, b.geom
    FROM admin.business_centre b;

CREATE OR REPLACE VIEW public.vungu_land_features AS
  SELECT l.id::bigint AS fid, l.kind, l.name, l.status, l."use" AS worked, l.geom FROM admin.land_feature l;

CREATE OR REPLACE VIEW public.vungu_railway AS
  SELECT r.id::bigint AS fid, r.rail_id, r.length_km, r.geom FROM admin.railway_line r;

COMMENT ON VIEW public.vungu_facilities IS 'Tile view: the facilities and business centres of the printed sheet (migration 236).';
COMMENT ON VIEW public.vungu_land_features IS 'Tile view: the land features of the printed sheet (migration 236).';
COMMENT ON VIEW public.vungu_railway IS 'Tile view: the plan''s railway lines (migration 236).';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.vungu_facilities', 'public.vungu_land_features', 'public.vungu_railway']
  LOOP
    PERFORM tenancy.classify(t, 'national', 'tile view over reference layers; not tenant data');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_system', t); END IF;
  END LOOP;
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('public.vungu_facilities',    'community_facility', 'derived', 'tile view over admin.community_facility, council_ops.health_facility and admin.business_centre'),
  ('public.vungu_land_features', 'land_feature',       'derived', 'tile view over admin.land_feature'),
  ('public.vungu_railway',       'railway',            'derived', 'tile view over admin.railway_line')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
