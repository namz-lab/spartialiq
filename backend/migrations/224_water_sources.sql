-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 224 — WATER SOURCES: DAMS AS WATER BODIES, AND WATER-POINT MEASURES THAT DO NOT GUESS A STATE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/224_water_sources.down.sql.
-- Tables only; the rows come from scripts/load-reference-layers.js, from the files in data/reference/vungu.
--
--   basemap.waterbody       surface water as polygons. The council's GIS supplied 138 dams (a name for 14 of them, no use).
--                           Concept `waterbody`. public.water_areas is a compatibility view (the tile layer reads it).
--   council_ops.wash_asset  the water-point register. 149 boreholes were supplied with a position and nothing else: no name,
--                           no depth or yield, and NO working state, so they are recorded as 'unknown', never as working.
--
-- The two water-point measures counted every asset type (a toilet or a pipeline would have been a "water point") and read a point
-- with no recorded state as not working. They now count water sources only (borehole, well, water point, tank), and:
--   water_points_per_voters  "recorded water points per 10,000 registered voters": every recorded source, whatever its state.
--                            It is the access measure; the state of repair is not needed for it.
--   water_points_working     the share that work, among the points whose state IS recorded (working, broken or seasonal). A point
--                            with an unknown state is left out of both the numerator and the base, so unknown is not read as broken.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Surface water ───────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.water_areas')) = 'r' THEN
    ALTER TABLE public.water_areas RENAME TO water_areas_retired;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS basemap.waterbody (
  id        bigserial PRIMARY KEY,
  source    text NOT NULL,
  kind      text NOT NULL CONSTRAINT waterbody_kind_known CHECK (kind IN ('dam')),
  -- The name as supplied; NULL where the source gives none or says "Unknown". A dam's use is not recorded in the source.
  name      text,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  geom      geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS waterbody_geom_gix ON basemap.waterbody USING gist (geom);
COMMENT ON TABLE basemap.waterbody IS
  'Surface water as polygons (dams, from the council''s GIS). Area is computed from the geometry, never stored. Reference data, not a survey.';

CREATE OR REPLACE VIEW public.water_areas WITH (security_invoker = true) AS
SELECT w.id::integer AS fid, w.name, w.kind AS fclass, w.geom FROM basemap.waterbody w;
COMMENT ON VIEW public.water_areas IS
  'Compatibility view over basemap.waterbody with the columns the tile config reads (docs/SPATIAL-NAMING-CONVENTION.md).';

DO $$
DECLARE t text;
BEGIN
  PERFORM tenancy.classify('basemap.waterbody', 'national', 'imported reference data: read only for the application role');
  PERFORM tenancy.classify('public.water_areas', 'national', 'compatibility view over basemap.waterbody');
  PERFORM tenancy.classify('public.water_areas_retired', 'pending', 'retired raw basemap table; safe to drop') WHERE to_regclass('public.water_areas_retired') IS NOT NULL;
  FOREACH t IN ARRAY ARRAY['basemap.waterbody', 'public.water_areas'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', t); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT USAGE ON ALL SEQUENCES IN SCHEMA basemap TO vungu_system; END IF;
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('basemap.waterbody', 'waterbody', 'canonical', 'surface water as polygons: the dams supplied by the council''s GIS'),
  ('public.water_areas', 'waterbody', 'derived',  'compatibility view over basemap.waterbody')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;

-- ── 2. Water-point measures ────────────────────────────────────────────────────────────────
-- The water sources of the register: not toilets, pipelines, treatment works or waste sites.
CREATE OR REPLACE FUNCTION spatial_engine.m_water_points_working()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN a.geom IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(a.ward) END AS ward_code,
           a.operational
      FROM council_ops.wash_asset a
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE a.geom IS NOT NULL AND ST_Intersects(w.geom, a.geom) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE a.asset_type IN ('borehole', 'well', 'water_point', 'tank')
       AND a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code,
         count(*) FILTER (WHERE operational = 'working')::numeric,
         -- the base is the points whose state is recorded; an unknown state is neither working nor broken
         count(*) FILTER (WHERE operational IN ('working', 'broken', 'seasonal'))::numeric,
         count(*)
    FROM placed GROUP BY ward_code
$$;

CREATE OR REPLACE FUNCTION spatial_engine.m_water_points_per_voters()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN a.geom IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(a.ward) END AS ward_code
      FROM council_ops.wash_asset a
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE a.geom IS NOT NULL AND ST_Intersects(w.geom, a.geom) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE a.asset_type IN ('borehole', 'well', 'water_point', 'tank')
       AND a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code, count(*)::numeric, NULL::numeric, count(*) FROM placed GROUP BY ward_code
$$;

UPDATE spatial_engine.measure SET
  label = 'Water points working (where the state is recorded)',
  description = 'Of the water points whose state is recorded as working, broken or seasonal, the share that are working. Points with no recorded state are left out: an unknown state is not read as broken.',
  source_note = 'council_ops.wash_asset (borehole, well, water point, tank), placed by coordinates or the ward number it carries. Base below 3 points with a recorded state is not classified.'
 WHERE measure_key = 'water_points_working';

UPDATE spatial_engine.measure SET
  label = 'Water points recorded per 10,000 registered voters',
  description = 'Water sources in the register (boreholes, wells, tanks) for every 10,000 adults on the ward''s voters roll, whatever their state of repair. Registered voters are not the population: they are the adults on the 2023 roll.',
  unit = 'recorded points per 10,000 voters',
  source_note = 'council_ops.wash_asset (borehole, well, water point, tank) over registered voters from the Electoral Commission polling areas (2023). A ward with under 1,000 voters is not classified.'
 WHERE measure_key = 'water_points_per_voters';

-- The note that goes with the register's status: what is in it now, and what is not known about each point.
UPDATE spatial_engine.register_status SET
  note = 'The register holds only part of the district''s water points (the council''s website lists about 360), and the working state of most recorded points is not known.',
  as_of = current_date
 WHERE register = 'water_points';
