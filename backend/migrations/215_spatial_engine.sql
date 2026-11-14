-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 215 — THE SPATIAL ENGINE: WARD MEASURES FOR THE CHIEF EXECUTIVE'S MAPS
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Design: the plan "a ward-level spatial engine and choropleth band for the CEO overview".
-- Rollback: migrations/rollback/215_spatial_engine.down.sql.
--
-- WHAT IT IS
-- A small, general engine that turns the council's registers into comparable ward measures. A MEASURE
-- is a row in spatial_engine.measure (what it means, its unit, which direction is good, how it is
-- classified) plus one SQL function m_<key>() that says where its facts sit. refresh() places every
-- fact in a ward, computes numerator / denominator / value, flags small bases, and records a run with
-- what could not be placed. A map is then just a read of spatial_engine.ward_value.
--
-- RULES BAKED INTO THE DATA, NOT LEFT TO THE SCREEN
--   * A ward with no figure is NULL and reliability 'no_data'. It is never 0, and never in a class.
--   * A rate over a base below the measure's minimum is 'small_base' and is not classified.
--   * Facts that cannot be placed are counted in run.detail ("unlocated"), never silently dropped and
--     never spread over the wards.
--   * The ward register is the council's CURRENT wards in admin.authority_ward, with their basis
--     ('interim' while decision D11 is open). The run records that basis, so every map can say it.
--   * No measure here is built from arrears or status bands (decision D13).
--
-- WHAT IT IS NOT
-- It writes nothing to any register it reads and moves no money. It stores only its own results.
-- Population-based measures need ward populations (spatial_engine.ward_denominator), which are empty
-- until the census figures are loaded; no population is invented.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS spatial_engine;

-- ── 1. The measure catalogue (reference data, shared) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_engine.measure (
  measure_key      text PRIMARY KEY CONSTRAINT measure_key_shape CHECK (measure_key ~ '^[a-z][a-z0-9_]{2,60}$'),
  label            text NOT NULL CONSTRAINT measure_label_length CHECK (length(btrim(label)) BETWEEN 3 AND 120),
  description      text NOT NULL,
  unit             text NOT NULL,
  -- share: part of a whole, as a percentage. density: facts per square kilometre.
  -- rate: facts per head of a population (needs ward_denominator).
  kind             text NOT NULL CONSTRAINT measure_kind_known CHECK (kind IN ('share', 'density', 'rate')),
  direction        text NOT NULL DEFAULT 'neutral'
                     CONSTRAINT measure_direction_known CHECK (direction IN ('higher_is_better', 'lower_is_better', 'neutral')),
  -- Where the denominator comes from: the function itself ('facts'), the ward's area, or a loaded denominator.
  denominator_kind text NOT NULL CONSTRAINT measure_denominator_known CHECK (denominator_kind IN ('facts', 'area_km2', 'population', 'households')),
  -- Below this base a ward's value is flagged small_base and left unclassified.
  min_denominator  numeric CONSTRAINT measure_min_denominator_positive CHECK (min_denominator IS NULL OR min_denominator > 0),
  value_scale      numeric NOT NULL DEFAULT 1 CONSTRAINT measure_scale_positive CHECK (value_scale > 0),
  classes          smallint NOT NULL DEFAULT 5 CONSTRAINT measure_classes_range CHECK (classes BETWEEN 3 AND 7),
  break_method     text NOT NULL DEFAULT 'quantile' CONSTRAINT measure_break_method_known CHECK (break_method IN ('quantile', 'fixed')),
  fixed_breaks     numeric[],
  ramp             text NOT NULL DEFAULT 'sequential' CONSTRAINT measure_ramp_known CHECK (ramp IN ('sequential', 'diverging')),
  -- The function in this schema that returns (ward_code, numerator, denominator, facts). Validated by shape.
  compute_fn       text NOT NULL CONSTRAINT measure_compute_fn_shape CHECK (compute_fn ~ '^m_[a-z][a-z0-9_]{2,60}$'),
  owner_dept       text NOT NULL,
  source_note      text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 100,
  enabled          boolean NOT NULL DEFAULT true,
  CONSTRAINT measure_fixed_breaks_present CHECK (break_method <> 'fixed' OR (fixed_breaks IS NOT NULL AND cardinality(fixed_breaks) BETWEEN 2 AND 6))
);

COMMENT ON TABLE spatial_engine.measure IS
  'What each ward measure means and how it is classified. One m_<key>() function in this schema computes it. '
  'Adding a measure is a row here plus that function; no route or screen changes.';

-- ── 2. Denominators loaded from outside (census), per ward ─────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_engine.ward_denominator (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  ward_code    text NOT NULL,
  kind         text NOT NULL CONSTRAINT ward_denominator_kind_known CHECK (kind IN ('population', 'households')),
  as_of_year   smallint NOT NULL CONSTRAINT ward_denominator_year_sane CHECK (as_of_year BETWEEN 1990 AND 2100),
  value        numeric NOT NULL CONSTRAINT ward_denominator_value_positive CHECK (value > 0),
  source       text NOT NULL CONSTRAINT ward_denominator_source_named CHECK (length(btrim(source)) >= 3),
  source_ref   text,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ward_denominator UNIQUE (authority_id, ward_code, kind, as_of_year)
);
COMMENT ON TABLE spatial_engine.ward_denominator IS
  'Ward populations and households from an outside source (the ZIMSTAT census), with the source named. Empty until loaded: nothing is estimated.';

-- ── 3. A run of the engine, and what it found ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_engine.run (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id        integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  started_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at         timestamptz,
  status              text NOT NULL DEFAULT 'running' CONSTRAINT run_status_known CHECK (status IN ('running', 'completed', 'failed')),
  -- How the ward list was established when this ran (admin.authority_ward.basis); 'interim' while D11 is open.
  ward_register_basis text,
  ward_register_ref   text,
  wards               integer,
  -- Per measure: facts considered, placed in a ward, and unlocated.
  detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
  error               text,
  CONSTRAINT run_finished_has_time CHECK (status = 'running' OR finished_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_spatial_engine_run_latest ON spatial_engine.run (authority_id, started_at DESC);

-- ── 4. The ward values a map reads ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spatial_engine.ward_value (
  authority_id integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  measure_key  text NOT NULL REFERENCES spatial_engine.measure (measure_key),
  period       text NOT NULL DEFAULT 'current',
  ward_code    text NOT NULL,
  numerator    numeric,
  denominator  numeric,
  value        numeric,
  reliability  text NOT NULL CONSTRAINT ward_value_reliability_known CHECK (reliability IN ('ok', 'small_base', 'no_data')),
  run_id       uuid NOT NULL REFERENCES spatial_engine.run (id),
  computed_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (authority_id, measure_key, period, ward_code),
  -- No value, no pretence: a ward without a figure is 'no_data', and a figure is never 'no_data'.
  CONSTRAINT ward_value_no_data_is_null CHECK ((reliability = 'no_data') = (value IS NULL))
);

-- ── 5. The authority's current wards, with area ────────────────────────────────────────────
CREATE OR REPLACE VIEW spatial_engine.v_authority_ward WITH (security_invoker = true) AS
SELECT aw.authority_id, w.ward_code, w.name, aw.basis, aw.instrument_ref, w.geom,
       round((ST_Area(w.geom::geography) / 1000000.0)::numeric, 3) AS area_km2
  FROM admin.authority_ward aw
  JOIN admin.ward w ON w.ward_code = aw.ward_code
 WHERE aw.authority_id = app.authority_id()
   AND (aw.valid_to IS NULL OR aw.valid_to >= CURRENT_DATE)
   AND w.geom IS NOT NULL;
COMMENT ON VIEW spatial_engine.v_authority_ward IS
  'The wards of the calling council that are current in admin.authority_ward, with geometry and area in km2. '
  'basis is interim while the Council has not confirmed its list (decision D11).';

-- A ward from a text label (the ward number a register carries when it has no coordinates). NULL when the
-- label names no ward, or names more than one: a fact is unlocated rather than guessed.
CREATE OR REPLACE FUNCTION spatial_engine.ward_of_label(p_label text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(ward_code) END
    FROM spatial_engine.v_authority_ward
   WHERE p_label IS NOT NULL AND btrim(p_label) <> ''
     AND (ward_code = btrim(p_label) OR lower(name) IN (lower(btrim(p_label)), 'ward ' || lower(btrim(p_label))))
$$;

-- ── 6. The measures' functions: (ward_code, numerator, denominator, facts). ward_code NULL = unlocated. ──
-- Each reads only the calling council's rows by an EXPLICIT authority filter as well as row-level security, so the
-- numbers are right on a connection that bypasses RLS (a superuser, a maintenance session) too. Parcels are
-- custodian data with no council of their own: a parcel counts for the council whose wards hold it, and a parcel
-- outside every ward is out of area (not unlocated) unless the council owns it.
-- 6.1 Registered parcels per km2.
CREATE OR REPLACE FUNCTION spatial_engine.m_parcel_density()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT g.ward_code
      FROM land.parcel p
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE ST_Intersects(w.geom, ST_PointOnSurface(p.geom_wgs84)) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE p.status = 'current'
       AND (g.ward_code IS NOT NULL OR p.authority_id = app.authority_id()))
  SELECT ward_code, count(*)::numeric, NULL::numeric, count(*) FROM placed GROUP BY ward_code
$$;

-- 6.2 Share of current parcels that have a rates account. Not arrears: it says an account exists.
CREATE OR REPLACE FUNCTION spatial_engine.m_parcel_account_coverage()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT g.ward_code,
           EXISTS (SELECT 1 FROM revenue_link.account_link a WHERE a.parcel_id = p.parcel_id AND a.authority_id = app.authority_id()) AS has_account
      FROM land.parcel p
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE ST_Intersects(w.geom, ST_PointOnSurface(p.geom_wgs84)) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE p.status = 'current'
       AND (g.ward_code IS NOT NULL OR p.authority_id = app.authority_id()))
  SELECT ward_code, count(*) FILTER (WHERE has_account)::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;

-- 6.3 Share of water points that are working (decommissioned ones are not counted). Placed by coordinates when
-- the register has them, otherwise by the ward number it carries.
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
     WHERE a.operational IS DISTINCT FROM 'decommissioned' AND a.authority_id = app.authority_id())
  SELECT ward_code, count(*) FILTER (WHERE operational = 'working')::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;

-- 6.4 Spending against budget, in the reporting currency of the open financial year that contains today. Only
-- ward-coded, linked lines; money that has no ward is the finance map's "unlocated" card, not a ward.
CREATE OR REPLACE FUNCTION spatial_engine.m_budget_execution()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  -- A coded ward that is not one of the council's current wards is unlocated here (NULL), not shaded on the map.
  SELECT w.ward_code, p.expenditure_actual, p.expenditure_budget, 1::bigint
    FROM finance.v_ward_performance p
    JOIN finance.financial_year y ON y.id = p.financial_year_id
    LEFT JOIN spatial_engine.v_authority_ward w ON w.ward_code = p.ward_code
   WHERE p.authority_id = app.authority_id() AND y.deleted_at IS NULL AND y.status = 'open' AND CURRENT_DATE BETWEEN y.start_date AND y.end_date
     AND p.currency = y.reporting_currency
     AND p.unlocated_reason IS NULL AND p.ward_code IS NOT NULL
$$;

-- ── 7. Starting measures ───────────────────────────────────────────────────────────────────
-- The class thresholds for the three shares are PROVISIONAL policy defaults: the Council may set its own.
INSERT INTO spatial_engine.measure
  (measure_key, label, description, unit, kind, direction, denominator_kind, min_denominator, value_scale,
   classes, break_method, fixed_breaks, ramp, compute_fn, owner_dept, source_note, sort_order)
VALUES
  ('parcel_density', 'Registered parcels per km²',
   'How many current parcels the land register holds in each square kilometre of the ward. Farm parcels and township stands count alike.',
   'parcels per km²', 'density', 'neutral', 'area_km2', NULL, 1, 5, 'quantile', NULL, 'sequential',
   'm_parcel_density', 'Planning and Survey', 'land.parcel (current), placed by the parcel''s point on surface; ward area from the ward geometry.', 10),
  ('parcel_account_coverage', 'Parcels with a rates account',
   'The share of current parcels in the ward that have a rates account. It says an account exists, not whether it is paid.',
   '% of parcels', 'share', 'higher_is_better', 'facts', 10, 100, 4, 'fixed', ARRAY[25, 50, 75]::numeric[], 'sequential',
   'm_parcel_account_coverage', 'Finance and Planning', 'land.parcel and revenue_link.account_link. Base below 10 parcels is not classified.', 20),
  ('water_points_working', 'Water points working',
   'The share of the ward''s water points (boreholes, wells, tanks) recorded as working. Decommissioned points are left out.',
   '% working', 'share', 'higher_is_better', 'facts', 3, 100, 4, 'fixed', ARRAY[50, 75, 90]::numeric[], 'sequential',
   'm_water_points_working', 'Engineering and Works', 'council_ops.wash_asset, placed by coordinates or the ward number it carries. Base below 3 points is not classified.', 30),
  ('budget_execution', 'Spending against budget',
   'Expenditure to date as a share of the revised expenditure budget, for budget lines that carry a ward. Money with no ward is not shown here.',
   '% of budget spent', 'share', 'neutral', 'facts', NULL, 100, 4, 'fixed', ARRAY[25, 50, 75]::numeric[], 'sequential',
   'm_budget_execution', 'Finance', 'finance.v_ward_performance, open financial year, reporting currency, linked wards only.', 40)
ON CONFLICT (measure_key) DO NOTHING;

-- ── 8. The refresh ─────────────────────────────────────────────────────────────────────────
-- Recomputes every enabled measure for the calling council and replaces its 'current' values. One run row
-- records when, against which ward list, and what could not be placed. Runs as the caller (row-level security
-- applies), so it needs the council set in the session, as every request has.
CREATE OR REPLACE FUNCTION spatial_engine.refresh() RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_authority integer := app.authority_id();
  v_run       uuid;
  v_basis     text;
  v_ref       text;
  v_wards     integer;
  m           record;
  v_detail    jsonb := '{}'::jsonb;
  v_facts     bigint;
  v_placed    bigint;
BEGIN
  IF v_authority IS NULL THEN
    RAISE EXCEPTION 'the spatial engine runs for one council: set app.authority_id first' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::int,
         CASE WHEN count(DISTINCT basis) = 1 THEN min(basis) ELSE 'mixed' END,
         CASE WHEN count(DISTINCT instrument_ref) = 1 THEN min(instrument_ref) END
    INTO v_wards, v_basis, v_ref
    FROM spatial_engine.v_authority_ward;

  INSERT INTO spatial_engine.run (ward_register_basis, ward_register_ref, wards)
  VALUES (CASE WHEN v_wards = 0 THEN NULL ELSE v_basis END, v_ref, v_wards)
  RETURNING id INTO v_run;

  BEGIN
    DELETE FROM spatial_engine.ward_value WHERE authority_id = v_authority AND period = 'current';

    FOR m IN SELECT * FROM spatial_engine.measure WHERE enabled ORDER BY sort_order, measure_key LOOP
      CREATE TEMP TABLE IF NOT EXISTS pg_temp.se_facts (ward_code text, numerator numeric, denominator numeric, facts bigint) ON COMMIT DROP;
      TRUNCATE pg_temp.se_facts;
      EXECUTE format('INSERT INTO pg_temp.se_facts SELECT ward_code, numerator, denominator, facts FROM spatial_engine.%I()', m.compute_fn);

      SELECT COALESCE(sum(facts), 0), COALESCE(sum(facts) FILTER (WHERE ward_code IS NOT NULL), 0)
        INTO v_facts, v_placed FROM pg_temp.se_facts;
      v_detail := v_detail || jsonb_build_object(m.measure_key,
        jsonb_build_object('facts', v_facts, 'placed', v_placed, 'unlocated', v_facts - v_placed));

      -- Every current ward gets a row. With no source facts at all every ward is no_data; with facts, a ward the
      -- source did not mention has numerator 0 (a true zero for a count) and a share over nothing is no_data.
      INSERT INTO spatial_engine.ward_value (authority_id, measure_key, ward_code, numerator, denominator, value, reliability, run_id)
      SELECT v_authority, m.measure_key, w.ward_code, c.numerator, c.denominator, c.value,
             CASE WHEN c.value IS NULL THEN 'no_data'
                  WHEN m.min_denominator IS NOT NULL AND c.denominator IS NOT NULL AND c.denominator < m.min_denominator THEN 'small_base'
                  ELSE 'ok' END,
             v_run
        FROM spatial_engine.v_authority_ward w
        LEFT JOIN pg_temp.se_facts f ON f.ward_code = w.ward_code
        LEFT JOIN LATERAL (
          SELECT
            CASE WHEN v_facts = 0 THEN NULL ELSE COALESCE(f.numerator, 0) END AS numerator,
            CASE m.denominator_kind
              WHEN 'area_km2' THEN CASE WHEN v_facts = 0 THEN NULL ELSE w.area_km2 END
              WHEN 'facts' THEN CASE WHEN v_facts = 0 THEN NULL ELSE COALESCE(f.denominator, 0) END
              ELSE (SELECT d.value FROM spatial_engine.ward_denominator d
                     WHERE d.authority_id = v_authority AND d.ward_code = w.ward_code AND d.kind = m.denominator_kind
                     ORDER BY d.as_of_year DESC LIMIT 1)
            END AS denominator,
            CASE
              WHEN v_facts = 0 THEN NULL
              WHEN m.denominator_kind = 'facts' AND COALESCE(f.denominator, 0) = 0 THEN NULL
              WHEN m.denominator_kind = 'area_km2' THEN round(COALESCE(f.numerator, 0) / NULLIF(w.area_km2, 0) * m.value_scale, 4)
              WHEN m.denominator_kind = 'facts' THEN round(COALESCE(f.numerator, 0) / f.denominator * m.value_scale, 4)
              ELSE (SELECT round(COALESCE(f.numerator, 0) / d.value * m.value_scale, 4) FROM spatial_engine.ward_denominator d
                     WHERE d.authority_id = v_authority AND d.ward_code = w.ward_code AND d.kind = m.denominator_kind
                     ORDER BY d.as_of_year DESC LIMIT 1)
            END AS value
        ) c ON true;
    END LOOP;

    UPDATE spatial_engine.run SET status = 'completed', finished_at = clock_timestamp(), detail = v_detail WHERE id = v_run;
  EXCEPTION WHEN OTHERS THEN
    UPDATE spatial_engine.run SET status = 'failed', finished_at = clock_timestamp(), error = left(SQLERRM, 500), detail = v_detail WHERE id = v_run;
    RAISE;
  END;
  RETURN v_run;
END $$;

COMMENT ON FUNCTION spatial_engine.refresh() IS
  'Recomputes every enabled measure for the calling council and replaces its current ward values. Returns the run id.';

-- ── 9. Tenancy, grants ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT USAGE ON SCHEMA spatial_engine TO vungu_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA spatial_engine TO vungu_app;
  END IF;
  PERFORM tenancy.classify('spatial_engine.measure', 'reference', 'shared catalogue of ward measures: read only for the application role');
  PERFORM tenancy.grant_app('spatial_engine.measure'::regclass, 'read');
  PERFORM tenancy.classify('spatial_engine.v_authority_ward', 'tenant_view', 'the calling council''s current wards');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON spatial_engine.v_authority_ward TO vungu_app;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('spatial_engine.ward_denominator', 'pending', 'spatial engine data awaiting the authority it belongs to');
    PERFORM tenancy.classify('spatial_engine.run', 'pending', 'spatial engine data awaiting the authority it belongs to');
    PERFORM tenancy.classify('spatial_engine.ward_value', 'pending', 'spatial engine data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('spatial_engine.ward_denominator'::regclass, 'VUNGU');
  PERFORM tenancy.make_tenant('spatial_engine.run'::regclass, 'VUNGU');
  PERFORM tenancy.make_tenant('spatial_engine.ward_value'::regclass, 'VUNGU');
END $$;
