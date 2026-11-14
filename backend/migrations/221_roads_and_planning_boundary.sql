-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 221 — THE ROAD NETWORK AND THE PLANNING BOUNDARY, UNDER THEIR CONVENTION NAMES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/221_roads_and_planning_boundary.down.sql.
-- Tables only; the rows come from scripts/load-reference-layers.js, from the files in data/reference/vungu.
--
--   basemap.road              the road network (OpenStreetMap centrelines as the council supplied them), with the road
--                             authority each road is tagged with. Concept `road`. The basemap schema is created here; the other
--                             basemap concepts follow it later.
--   public.roads              compatibility view over it with the old basemap columns (fid, osm_id, fclass, oneway 'B'/'F',
--                             maxspeed, bridge 'T'/'F', ...), which the tile config and the QGIS project read.
--   admin.planning_boundary   the council's planning boundary as drawn and supplied (the Gweru Rural polygon, ZW1704), one
--                             row per council, under row-level security. Concept `authority_area`: it is NOT the union of the
--                             wards (admin.authority_area), and says so.
--   public.gweru_rural_planning_boundary   compatibility view over it (the QGIS project's planning-boundary layer).
--
-- The council's own road inventory (council_ops.road_asset) is filled from the roads tagged VUNGU by the same loader, flagged
-- unverified: they are OpenStreetMap geometry, not a surveyed inventory, and carry no surface or condition.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS basemap;
COMMENT ON SCHEMA basemap IS 'Imported reference data (roads, buildings, water, places): docs/SPATIAL-NAMING-CONVENTION.md. Shared, not tenant data.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT USAGE ON SCHEMA basemap TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT USAGE ON SCHEMA basemap TO vungu_system; END IF;
END $$;

-- ── 1. The road network ────────────────────────────────────────────────────────────────────
-- A table of this name that an older database holds (the imported basemap) is kept, renamed, until someone drops it.
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.roads')) = 'r' THEN
    ALTER TABLE public.roads RENAME TO roads_retired;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS basemap.road (
  id             bigserial PRIMARY KEY,
  -- The source's own identifier (an OpenStreetMap way id). Not unique: a way can be split into more than one row.
  source_id      text,
  source         text NOT NULL,
  class          text,
  name           text,
  ref            text,
  -- True for a one-way road. The source's direction code (F forward, T reverse) is not kept: the loader refuses a reverse
  -- one-way rather than lose its direction.
  oneway         boolean,
  -- Posted maximum speed in km/h; NULL where the source says 0 (unknown).
  max_speed      integer CONSTRAINT road_max_speed_positive CHECK (max_speed IS NULL OR max_speed > 0),
  layer          smallint,
  bridge         boolean,
  tunnel         boolean,
  -- Who is responsible for the road, as the source tags it: VUNGU the council, RIDA the Rural Infrastructure Development
  -- Agency, MOTID the Ministry of Transport and Infrastructural Development.
  road_authority text,
  loaded_at      timestamptz NOT NULL DEFAULT now(),
  geom           geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS road_geom_gix ON basemap.road USING gist (geom);
CREATE INDEX IF NOT EXISTS road_class_idx ON basemap.road (class);
COMMENT ON TABLE basemap.road IS
  'The road network (OpenStreetMap centrelines supplied by the council), with the road authority each road is tagged with. Reference data, not a survey.';

CREATE OR REPLACE VIEW public.roads WITH (security_invoker = true) AS
SELECT r.id::integer AS fid,
       r.source_id    AS osm_id,
       r.class        AS fclass,
       r.name,
       r.ref,
       CASE WHEN r.oneway THEN 'F' ELSE 'B' END AS oneway,
       COALESCE(r.max_speed, 0)                  AS maxspeed,
       r.layer,
       CASE WHEN r.bridge THEN 'T' ELSE 'F' END  AS bridge,
       CASE WHEN r.tunnel THEN 'T' ELSE 'F' END  AS tunnel,
       r.road_authority AS authority,
       r.geom
  FROM basemap.road r;
COMMENT ON VIEW public.roads IS
  'Compatibility view over basemap.road with the columns the tile config and QGIS project read (docs/SPATIAL-NAMING-CONVENTION.md).';

-- ── 2. The planning boundary ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.gweru_rural_planning_boundary')) = 'r' THEN
    ALTER TABLE public.gweru_rural_planning_boundary RENAME TO gweru_rural_planning_boundary_retired;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin.planning_boundary (
  id           serial PRIMARY KEY,
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  name         text NOT NULL,
  -- The administrative code the supplied polygon carries (ZW1704 is the Gweru district) and its province's.
  adm2_pcode   text,
  adm1_pcode   text,
  source       text NOT NULL,
  -- What the polygon is, in words, so no screen presents it as more: it is the boundary as supplied, not the union of the
  -- council's wards and not a Council act.
  note         text,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  CONSTRAINT uq_planning_boundary_authority UNIQUE (authority_id)
);
CREATE INDEX IF NOT EXISTS planning_boundary_geom_gix ON admin.planning_boundary USING gist (geom);
COMMENT ON TABLE admin.planning_boundary IS
  'The council''s planning boundary as supplied by its GIS (one per council). Distinct from admin.authority_area, which is the union of the wards.';

CREATE OR REPLACE VIEW public.gweru_rural_planning_boundary WITH (security_invoker = true) AS
SELECT b.id, b.geom, b.name AS adm2_en, b.adm2_pcode, b.adm1_pcode
  FROM admin.planning_boundary b;
COMMENT ON VIEW public.gweru_rural_planning_boundary IS
  'Compatibility view over admin.planning_boundary: the planning-boundary layer of the QGIS project.';

-- ── 3. Tenancy, grants, registry ───────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  PERFORM tenancy.classify('basemap.road', 'national', 'imported reference data: read only for the application role');
  PERFORM tenancy.classify('public.roads', 'national', 'compatibility view over basemap.road');
  PERFORM tenancy.classify('public.roads_retired', 'pending', 'retired raw basemap table; safe to drop')
    WHERE to_regclass('public.roads_retired') IS NOT NULL;
  FOREACH t IN ARRAY ARRAY['basemap.road', 'public.roads'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', t); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA basemap TO vungu_system;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON public.gweru_rural_planning_boundary TO vungu_app;
  END IF;

  PERFORM tenancy.classify('public.gweru_rural_planning_boundary', 'tenant_view', 'compatibility view over admin.planning_boundary');
  IF EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.make_tenant('admin.planning_boundary'::regclass, 'VUNGU');
  ELSE
    PERFORM tenancy.classify('admin.planning_boundary', 'pending', 'authority-owned data awaiting the authority it belongs to');
  END IF;
END $$;

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('basemap.road',                       'road',           'canonical', 'the road network as supplied by the council, with the road authority of each road'),
  ('public.roads',                       'road',           'derived',   'compatibility view over basemap.road'),
  ('admin.planning_boundary',            'authority_area', 'source',    'the planning boundary as supplied (Gweru Rural, ZW1704); the canonical area stays the union of the wards (admin.authority_area)'),
  ('public.gweru_rural_planning_boundary', 'authority_area', 'derived', 'compatibility view over admin.planning_boundary')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
