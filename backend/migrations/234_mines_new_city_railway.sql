-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 234 — MINES, THE PROPOSED NEW CITY AND THE PLAN'S RAILWAY LINES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/234_mines_new_city_railway.down.sql. Rows come from scripts/load-reference-layers.js.
--
-- The council supplied updated files (15 November 2026) for the schools, quarries and sand workings, mines, the new city and the railway lines. They replace the
-- October 2024 package for those layers (the package is out of date). Three changes to the tables of migration 233:
--   admin.land_feature   gains `use` (what the source says is worked: Gold, Quarry, Sand) and two kinds: mine, proposed_new_city
--   admin.railway_line   the railway lines of the plan (the national basemap's railways stay as they are)
-- Nothing is guessed: a mine with no use in the source has none here. Artisanal workings are named as the source names them.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE admin.land_feature ADD COLUMN IF NOT EXISTS use text;
ALTER TABLE admin.land_feature DROP CONSTRAINT IF EXISTS land_feature_kind_known;
ALTER TABLE admin.land_feature ADD CONSTRAINT land_feature_kind_known
  CHECK (kind IN ('quarry', 'sand_working', 'mine', 'irrigation_scheme', 'recreational_site', 'proposed_new_city'));

CREATE TABLE IF NOT EXISTS admin.railway_line (
  id        serial PRIMARY KEY,
  rail_id   text,
  length_km numeric,
  source    text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  geom      geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS railway_line_geom_gix ON admin.railway_line USING gist (geom);
COMMENT ON TABLE admin.railway_line IS 'Railway lines of the composite master plan, as the council supplied them (15 November 2026). Reference data; positions as supplied.';

DO $$
BEGIN
  PERFORM tenancy.classify('admin.railway_line', 'national', 'reference layer for the district; not tenant data');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT ON admin.railway_line TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON admin.railway_line TO vungu_system;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admin TO vungu_system;
  END IF;
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('admin.railway_line', 'railway', 'source', 'the railway lines of the composite master plan, as supplied by the council')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
