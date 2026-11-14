-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 218 — REFERENCE LAYERS FOR VUNGU, AND A VOTER DENOMINATOR FOR THE SPATIAL ENGINE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/218_vungu_reference_layers.down.sql.
--
-- WHAT IT ADDS (tables only; the rows come from scripts/load-reference-layers.js, from files in
-- data/reference/vungu, so every row names its source)
--   admin.polling_area / admin.polling_station   the Electoral Commission's polling areas and stations
--       (Midlands file of 20 April 2023), each with its registered voters. 115 of Vungu's. The polling
--       areas fall inside the same ward numbers as the council's 19 wards, which corroborates them (it does not
--       confirm them: decision D11 stays open).
--   admin.chiefdom                               the five chiefs' areas of Vungu, by ward number
--   admin.business_centre                        business centres, rural service centres and growth points
--   admin.river                                  river lines; most carry no name or type in the source
--
-- A VOTER DENOMINATOR, NOT A POPULATION
-- Registered voters are adults on the roll in 2023. They are not the population and are never presented as it.
-- The spatial engine's ward_denominator and measure.denominator_kind gain a kind 'registered_voters', and one
-- rate measure uses it: working water points per 10,000 registered voters. The census ward table in the earlier
-- VunGIS databases (zwe_boundaries.census_ward) is NOT used: it is the district total divided among wards, so
-- it is not a ward figure.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. The layers ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin.polling_area (
  polling_code text PRIMARY KEY,
  name         text NOT NULL,
  ward_number  integer NOT NULL CONSTRAINT polling_area_ward_number_positive CHECK (ward_number > 0),
  -- The council ward that holds the area's point on surface, resolved when loaded; NULL if none does.
  ward_code    text,
  voters       integer CONSTRAINT polling_area_voters_nonnegative CHECK (voters IS NULL OR voters >= 0),
  integrity    text,
  old_name     text,
  address      text,
  assembly     text,
  modified     text,
  source       text NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  geom         geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS polling_area_geom_gix ON admin.polling_area USING gist (geom);
CREATE INDEX IF NOT EXISTS polling_area_ward_idx ON admin.polling_area (ward_code);

CREATE TABLE IF NOT EXISTS admin.polling_station (
  polling_code text PRIMARY KEY,
  name         text NOT NULL,
  ward_number  integer NOT NULL CONSTRAINT polling_station_ward_number_positive CHECK (ward_number > 0),
  voters       integer CONSTRAINT polling_station_voters_nonnegative CHECK (voters IS NULL OR voters >= 0),
  integrity    text,
  source       text NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  geom         geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS polling_station_geom_gix ON admin.polling_station USING gist (geom);

CREATE TABLE IF NOT EXISTS admin.chiefdom (
  id              serial PRIMARY KEY,
  chief           text NOT NULL,
  ward_number     integer,
  local_authority text,
  source          text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now(),
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  CONSTRAINT uq_chiefdom_chief UNIQUE (chief, local_authority)
);
CREATE INDEX IF NOT EXISTS chiefdom_geom_gix ON admin.chiefdom USING gist (geom);

CREATE TABLE IF NOT EXISTS admin.business_centre (
  id          serial PRIMARY KEY,
  -- BC business centre, RSC rural service centre, GP growth point (the source's own codes).
  sector      text CONSTRAINT business_centre_sector_known CHECK (sector IS NULL OR sector IN ('BC', 'RSC', 'GP')),
  ward_number integer,
  village     text,
  source      text NOT NULL,
  loaded_at   timestamptz NOT NULL DEFAULT now(),
  geom        geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS business_centre_geom_gix ON admin.business_centre USING gist (geom);

CREATE TABLE IF NOT EXISTS admin.river (
  id         serial PRIMARY KEY,
  name       text,
  river_type text,
  source     text NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  geom       geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS river_geom_gix ON admin.river USING gist (geom);

COMMENT ON TABLE admin.polling_area IS
  'Electoral Commission polling areas (Midlands file, 20 April 2023), Vungu RDC only, with registered voters. Reference data, not a Council act.';
COMMENT ON TABLE admin.river IS
  'River lines from the earlier VunGIS legacy layer. Rivers with no usable geometry in the source were left out; most that remain have no name or type.';

-- ── 2. A voter denominator for the spatial engine ──────────────────────────────────────────
DO $$
DECLARE n text;
BEGIN
  FOR n IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'spatial_engine.ward_denominator'::regclass AND conname = 'ward_denominator_kind_known'
  LOOP EXECUTE format('ALTER TABLE spatial_engine.ward_denominator DROP CONSTRAINT %I', n); END LOOP;
  ALTER TABLE spatial_engine.ward_denominator ADD CONSTRAINT ward_denominator_kind_known
    CHECK (kind IN ('population', 'households', 'registered_voters'));

  FOR n IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'spatial_engine.measure'::regclass AND conname = 'measure_denominator_known'
  LOOP EXECUTE format('ALTER TABLE spatial_engine.measure DROP CONSTRAINT %I', n); END LOOP;
  ALTER TABLE spatial_engine.measure ADD CONSTRAINT measure_denominator_known
    CHECK (denominator_kind IN ('facts', 'area_km2', 'population', 'households', 'registered_voters'));
END $$;

-- Working water points per ward (numerator only; the denominator is the ward's registered voters).
CREATE OR REPLACE FUNCTION spatial_engine.m_water_points_per_voters()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN a.geom IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(a.ward) END AS ward_code,
           a.operational
      FROM council_ops.wash_asset a
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE a.geom IS NOT NULL AND ST_Intersects(w.geom, a.geom) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code, count(*) FILTER (WHERE operational = 'working')::numeric, NULL::numeric, count(*) FROM placed GROUP BY ward_code
$$;

INSERT INTO spatial_engine.measure
  (measure_key, label, description, unit, kind, direction, denominator_kind, min_denominator, value_scale,
   classes, break_method, fixed_breaks, ramp, compute_fn, owner_dept, unit_key, source_note, sort_order)
VALUES
  ('water_points_per_voters', 'Working water points per 10,000 registered voters',
   'Working water points (boreholes, wells, tanks) for every 10,000 adults on the ward''s voters roll. Registered voters are not the population: they are the adults on the 2023 roll.',
   'working points per 10,000 voters', 'rate', 'higher_is_better', 'registered_voters', 1000, 10000, 5, 'quantile', NULL, 'sequential',
   'm_water_points_per_voters', 'Engineering and Works', 'engineering',
   'council_ops.wash_asset over registered voters from the Electoral Commission polling areas (2023). A ward with under 1,000 voters is not classified.', 55)
ON CONFLICT (measure_key) DO NOTHING;

-- ── 3. Tenancy and grants: national reference data, read-only for the application role ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin.polling_area', 'admin.polling_station', 'admin.chiefdom', 'admin.business_centre', 'admin.river']
  LOOP
    PERFORM tenancy.classify(t, 'national', 'reference layer for the district; not tenant data');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
      EXECUTE format('GRANT SELECT ON %s TO vungu_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vungu_system', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA spatial_engine TO vungu_app;
  END IF;
END $$;
