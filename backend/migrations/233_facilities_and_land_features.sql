-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 233 — THE FACILITIES AND LAND FEATURES THE PRINTED SHEET SHOWS
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/233_facilities_and_land_features.down.sql. Rows come from scripts/load-reference-layers.js, so each names its source.
--
-- The composite master plan prints schools of every level, police posts, dip tanks, network boosters, quarries and sand workings, irrigation schemes and
-- recreational sites. The database held none of them. Two tables, each categorised by `kind`, rather than a table per symbol:
--   admin.community_facility  points: school, police_post, dip_tank, network_booster
--   admin.land_feature        polygons: quarry, sand_working, irrigation_scheme, recreational_site
-- Source: the Vungu Master Plan Geo Package of 16 October 2024. A value the source does not give stays NULL: nothing is guessed (the package has no business-centre
-- levels, no mines, no proposed new city; those are read off the sheet, not loaded here).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin.community_facility (
  id            serial PRIMARY KEY,
  kind          text NOT NULL CONSTRAINT community_facility_kind_known CHECK (kind IN ('school', 'police_post', 'dip_tank', 'network_booster')),
  name          text,
  -- school: Primary | Secondary | Technical and Vocational; police_post: Post | Station | Prison; network_booster: the operator's name is in `operator`
  subtype       text,
  -- school: the grant class the Ministry gives it (P1, P3, S1 ... S3)
  grade         text,
  school_number text,
  operator      text,
  ward_code     text,
  source        text NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now(),
  geom          geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS community_facility_geom_gix ON admin.community_facility USING gist (geom);
CREATE INDEX IF NOT EXISTS community_facility_kind_idx ON admin.community_facility (kind);

CREATE TABLE IF NOT EXISTS admin.land_feature (
  id        serial PRIMARY KEY,
  kind      text NOT NULL CONSTRAINT land_feature_kind_known CHECK (kind IN ('quarry', 'sand_working', 'irrigation_scheme', 'recreational_site')),
  name      text,
  -- irrigation scheme: Functional | Not functional (as the source says)
  status    text,
  ward_code text,
  source    text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  geom      geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS land_feature_geom_gix ON admin.land_feature USING gist (geom);
CREATE INDEX IF NOT EXISTS land_feature_kind_idx ON admin.land_feature (kind);

COMMENT ON TABLE admin.community_facility IS
  'Schools, police posts, dip tanks and network boosters, from the Vungu Master Plan Geo Package (16 October 2024). Reference data, not a Council act; positions as supplied.';
COMMENT ON TABLE admin.land_feature IS
  'Quarries, sand workings, irrigation schemes and recreational sites, from the Vungu Master Plan Geo Package (16 October 2024). Reference data; outlines as supplied.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin.community_facility', 'admin.land_feature']
  LOOP
    PERFORM tenancy.classify(t, 'national', 'reference layer for the district; not tenant data');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', t);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admin TO vungu_system');
    END IF;
  END LOOP;
END $$;

-- The spatial registry: one canonical source for each.
INSERT INTO public.spatial_concept (code, name, domain, geometry_kind, status, authority_scoped, target_relation, description, note) VALUES
  ('community_facility', 'Community facility', 'infrastructure', 'point',   'partial', FALSE, 'admin.community_facility', 'Schools, police posts, dip tanks and network boosters of Vungu.', 'from the Vungu Master Plan Geo Package, 16 October 2024'),
  ('land_feature',       'Land feature',       'infrastructure', 'polygon', 'partial', FALSE, 'admin.land_feature',       'Quarries, sand workings, irrigation schemes and recreational sites of Vungu.', 'from the Vungu Master Plan Geo Package, 16 October 2024')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('admin.community_facility', 'community_facility', 'canonical', 'schools (with level and grant class), police posts, dip tanks, network boosters'),
  ('admin.land_feature',       'land_feature',       'canonical', 'quarries, sand workings, irrigation schemes, recreational sites')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
