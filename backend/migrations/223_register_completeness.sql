-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 223 — AN INCOMPLETE REGISTER DOES NOT SAY "ZERO"
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/223_register_completeness.down.sql.
--
-- The engine's rule is that a ward with no figure is NULL, never 0. But a ward with no water point in a register that holds 6
-- of about 360 is not a ward with no water point: it is a ward where none is recorded. Read as zero, the map says "no water
-- here" where it should say "not recorded".
--
-- spatial_engine.register_status records, per council and per register, whether the council's register is complete (and what is
-- known about its size). A measure names the register it counts (measure.register_key). When the register is marked
-- incomplete, a ward whose count is zero is stored as no_data, not 0; a ward with something recorded keeps its figure (a lower
-- bound), and the map and the dashboards say the register is incomplete. A register with no status row behaves as before.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS spatial_engine.register_status (
  authority_id   integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  register       text NOT NULL CONSTRAINT register_status_key_shape CHECK (register ~ '^[a-z][a-z0-9_]{2,60}$'),
  complete       boolean NOT NULL DEFAULT false,
  -- How many the register should hold, if anything reliable says so (never a guess), and where that comes from.
  expected_count integer CONSTRAINT register_status_expected_positive CHECK (expected_count IS NULL OR expected_count > 0),
  note           text NOT NULL CONSTRAINT register_status_note_named CHECK (length(btrim(note)) >= 10),
  source         text NOT NULL CONSTRAINT register_status_source_named CHECK (length(btrim(source)) >= 3),
  as_of          date NOT NULL DEFAULT current_date,
  PRIMARY KEY (authority_id, register)
);
COMMENT ON TABLE spatial_engine.register_status IS
  'Whether a council''s register is complete. While it is not, a measure over it reads a ward with nothing recorded as no data, not zero.';

ALTER TABLE spatial_engine.measure ADD COLUMN IF NOT EXISTS register_key text;
COMMENT ON COLUMN spatial_engine.measure.register_key IS
  'The register this measure counts, as named in spatial_engine.register_status. NULL when the measure does not depend on a register that can be partial.';
UPDATE spatial_engine.measure SET register_key = 'water_points' WHERE measure_key IN ('water_points_working', 'water_points_per_voters') AND register_key IS NULL;

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
  v_incomplete boolean;
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
      -- A measure that counts a register the council has said is incomplete cannot read a ward with nothing recorded as zero (a ward with a point recorded, even one that does not work, keeps its figure).
      v_incomplete := m.register_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM spatial_engine.register_status rs
         WHERE rs.authority_id = v_authority AND rs.register = m.register_key AND NOT rs.complete);
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
              WHEN v_incomplete AND COALESCE(f.facts, 0) = 0 THEN NULL
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
  'Recomputes every enabled measure for the calling council and replaces its current ward values. A measure over a register marked incomplete stores a ward with nothing recorded as no_data, not 0. Returns the run id.';


-- ── Tenancy, grants, and the one fact we have ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA spatial_engine TO vungu_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('spatial_engine.register_status', 'pending', 'spatial engine data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('spatial_engine.register_status'::regclass, 'VUNGU');
END $$;

-- Vungu's water-point register: a handful of demonstration points against the district's own count. Not a loaded inventory.
INSERT INTO spatial_engine.register_status (authority_id, register, complete, expected_count, note, source)
SELECT a.id, 'water_points', false, 360,
       'The register holds only a few demonstration points; the council''s website lists about 360 water points in the district.',
       'Vungu RDC website (district facts); not verified against an inventory'
  FROM public.local_authorities a WHERE a.code = 'VUNGU'
ON CONFLICT (authority_id, register) DO NOTHING;
