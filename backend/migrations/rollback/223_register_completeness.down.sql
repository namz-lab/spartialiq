-- ROLLBACK OF 223 — AN INCOMPLETE REGISTER DOES NOT SAY "ZERO"
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/223_register_completeness.down.sql
-- Restores spatial_engine.refresh() to migration 215's, then drops the register status table and the measure column.

-- 215's refresh(), which does not read the register status
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

ALTER TABLE spatial_engine.measure DROP COLUMN IF EXISTS register_key;
DROP TABLE IF EXISTS spatial_engine.register_status;
DELETE FROM tenancy.relation_class WHERE relation = 'spatial_engine.register_status';
DELETE FROM public.schema_migrations WHERE filename = '223_register_completeness.sql';
