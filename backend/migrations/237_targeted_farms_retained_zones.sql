-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 237 — THE TARGETED FARMS AND THE RETAINED ZONES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/237_targeted_farms_retained_zones.down.sql. Rows come from scripts/load-reference-layers.js.
--
-- admin.targeted_farm   the council's list of targeted farms (file of 15 November 2026), as supplied, each linked to the farm parcel of the register
--                       it overlaps most (`parcel_id`, NULL where none overlaps by half)
-- admin.retained_zone   the retained zones (file of 15 November 2026): land-tenure zones by ward as the council retains them. Kept as a separate layer:
--                       they differ in extent from the zones loaded in spatial_planning.zone, so they replace nothing and are not on the map
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin.targeted_farm (
  id         serial PRIMARY KEY,
  row_id     text,
  objectid   integer,
  name       text,
  name_cfu   text,
  map_sheet  text,
  district   text,
  -- the source's own status: Resettlement | Commercial | City | State Land
  status     text,
  area_ha    numeric,
  -- the farm parcel of the register this polygon overlaps by at least half of its own area (the one it overlaps most)
  parcel_id  text,
  source     text NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  geom       geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS targeted_farm_geom_gix ON admin.targeted_farm USING gist (geom);
CREATE INDEX IF NOT EXISTS targeted_farm_parcel_idx ON admin.targeted_farm (parcel_id);

CREATE TABLE IF NOT EXISTS admin.retained_zone (
  id           serial PRIMARY KEY,
  -- the plan's name for the zone (Communal, Model A1, Model A2, Large Scale Commercial Farms, Small Scale Commercial Farms, Resettlement Area)
  zone         text NOT NULL,
  -- the code the source used (FLSCF, FLSCF_A2, FLSCF_SSCF_A1, SSCF, Resettlement Area, Communal)
  source_code  text NOT NULL,
  ward_number  integer,
  ward_pcode   text,
  source       text NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  geom         geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS retained_zone_geom_gix ON admin.retained_zone USING gist (geom);

COMMENT ON TABLE admin.targeted_farm IS 'The council''s targeted farms (file of 15 November 2026), linked to the farm parcel of the register where one overlaps by half.';
COMMENT ON TABLE admin.retained_zone IS 'The retained land-tenure zones by ward (file of 15 November 2026). Differs in extent from spatial_planning.zone; replaces nothing.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin.targeted_farm', 'admin.retained_zone']
  LOOP
    PERFORM tenancy.classify(t, 'national', 'reference layer for the district; not tenant data');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', t);
      EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admin TO vungu_system';
    END IF;
  END LOOP;
END $$;

INSERT INTO public.spatial_concept (code, name, domain, geometry_kind, status, authority_scoped, target_relation, description, note) VALUES
  ('targeted_farm', 'Targeted farm', 'infrastructure', 'polygon', 'partial', FALSE, 'admin.targeted_farm', 'Farms the council targets, linked to the farm parcels of the register.', 'from the council file of 15 November 2026'),
  ('retained_zone', 'Retained zone', 'infrastructure', 'polygon', 'partial', FALSE, 'admin.retained_zone', 'Land-tenure zones by ward as the council retains them.', 'differs in extent from the loaded zones; replaces nothing')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('admin.targeted_farm', 'targeted_farm', 'canonical', 'the council''s targeted farms'),
  ('admin.retained_zone', 'retained_zone', 'canonical', 'the retained land-tenure zones by ward')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;
