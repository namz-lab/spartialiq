-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 216 — THE EXECUTIVE ARM'S UNITS: TWO ROLES, THE ESTABLISHMENT, AND UNIT-OWNED WARD MEASURES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/216_executive_units.down.sql.
--
-- WHAT IT ADDS
--   1. Two roles, each released WITH a dashboard to open: `engineer` and `hr_social_officer`.
--      (The other heads of unit already have roles: eo, finance_admin, auditor.)
--   2. admin_org_position.unit_key: which of the five units a post belongs to, and the other
--      Executive Arm posts seeded VACANT under the Chief Executive. A vacancy is a post with no holder.
--   3. spatial_engine.measure.unit_key: which unit owns a ward measure (replaces the free-text
--      owner_dept for access), and two new measures: road_density, premises_certified.
--
-- The five units follow the Council's own Executive Arm (vungurdc.org.zw/our-team): Executive
-- Officer Planner, Executive Officer Finance, Engineer, Human Resources / Social Services /
-- Administration Officer, Internal Auditor. Which Act section prescribes each officer is
-- documented, with what is unverified, in docs/units-and-roles.md.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. The roles ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n text;
  roles text[];
  added text[] := ARRAY['engineer', 'hr_social_officer'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN
    RAISE EXCEPTION 'users_role_check is missing; migration 188 must run before 216';
  END IF;
  roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
  FOR n IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.users'::regclass AND conname LIKE '%role_check%'
  LOOP EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', n); END LOOP;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));

  IF to_regclass('public.invites') IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c,
           LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    IF roles IS NOT NULL THEN
      roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
      ALTER TABLE public.invites DROP CONSTRAINT IF EXISTS invites_role_check;
      EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
        (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
    END IF;
  END IF;
END $$;

-- ── 2. The establishment: which unit each post belongs to ──────────────────────────────────
ALTER TABLE public.admin_org_position ADD COLUMN IF NOT EXISTS unit_key text;
ALTER TABLE public.admin_org_position DROP CONSTRAINT IF EXISTS admin_org_position_unit_known;
ALTER TABLE public.admin_org_position ADD CONSTRAINT admin_org_position_unit_known
  CHECK (unit_key IS NULL OR unit_key IN ('planning', 'finance', 'engineering', 'social_admin', 'audit'));

DO $$
DECLARE
  v_ceo uuid;
BEGIN
  -- The Chief Executive is the accounting officer, and the overview is built for that role.
  UPDATE public.admin_org_position SET system_role = 'accounting_officer', updated_at = now()
   WHERE reports_to IS NULL AND title = 'Chief Executive Officer' AND system_role = 'admin';

  -- The Planning & Environment posts, already seeded by 127/190.
  UPDATE public.admin_org_position SET unit_key = 'planning'
   WHERE unit_key IS NULL AND department = 'Planning & Environment';

  SELECT id INTO v_ceo FROM public.admin_org_position
   WHERE reports_to IS NULL AND title = 'Chief Executive Officer' ORDER BY created_at LIMIT 1;
  IF v_ceo IS NULL THEN
    RETURN;  -- an organisation chart the Council has rebuilt is left alone
  END IF;

  INSERT INTO public.admin_org_position (title, department, system_role, unit_key, reports_to, sort_order)
  SELECT v.title, v.department, v.system_role, v.unit_key, v_ceo, v.sort_order
    FROM (VALUES
      ('Executive Officer — Finance',                          'Finance',                                'finance_admin',     'finance',      1),
      ('Engineer',                                             'Engineering & Works',                    'engineer',          'engineering',  2),
      ('Human Resources, Social Services & Administration Officer', 'Human Resources, Social Services & Administration', 'hr_social_officer', 'social_admin', 3),
      ('Internal Auditor',                                     'Internal Audit',                         'auditor',           'audit',        4)
    ) AS v(title, department, system_role, unit_key, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM public.admin_org_position p WHERE p.unit_key = v.unit_key AND p.reports_to = v_ceo);
END $$;

CREATE INDEX IF NOT EXISTS idx_org_position_unit ON public.admin_org_position (unit_key) WHERE unit_key IS NOT NULL;

-- ── 3. Ward measures belong to a unit ──────────────────────────────────────────────────────
ALTER TABLE spatial_engine.measure ADD COLUMN IF NOT EXISTS unit_key text;
ALTER TABLE spatial_engine.measure DROP CONSTRAINT IF EXISTS measure_unit_known;
ALTER TABLE spatial_engine.measure ADD CONSTRAINT measure_unit_known
  CHECK (unit_key IS NULL OR unit_key IN ('planning', 'finance', 'engineering', 'social_admin', 'audit'));

UPDATE spatial_engine.measure SET unit_key = 'planning'    WHERE measure_key = 'parcel_density'          AND unit_key IS NULL;
UPDATE spatial_engine.measure SET unit_key = 'finance'     WHERE measure_key IN ('parcel_account_coverage', 'budget_execution') AND unit_key IS NULL;
UPDATE spatial_engine.measure SET unit_key = 'engineering' WHERE measure_key = 'water_points_working'    AND unit_key IS NULL;

-- 3.1 Kilometres of active road per km2 of ward. A road is cut at the ward boundary, so a long road is
-- shared between the wards it crosses. Roads with no geometry cannot be placed and are not counted as
-- facts at all, so a register without geometry leaves every ward "no data" rather than 0.
CREATE OR REPLACE FUNCTION spatial_engine.m_road_density()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH roads AS (
    SELECT r.id, r.geom FROM council_ops.road_asset r
     WHERE r.status = 'active' AND r.geom IS NOT NULL AND r.authority_id = app.authority_id()),
  inside AS (
    SELECT w.ward_code, r.id,
           ST_Length(ST_Intersection(r.geom, w.geom)::geography) / 1000.0 AS km
      FROM roads r JOIN spatial_engine.v_authority_ward w ON ST_Intersects(r.geom, w.geom)),
  placed AS (SELECT ward_code, sum(km) AS km, count(DISTINCT id) AS n FROM inside GROUP BY ward_code),
  outside AS (
    SELECT r.id, ST_Length(r.geom::geography) / 1000.0 AS km FROM roads r
     WHERE NOT EXISTS (SELECT 1 FROM inside i WHERE i.id = r.id))
  SELECT ward_code, round(km::numeric, 3), NULL::numeric, n FROM placed
  UNION ALL
  SELECT NULL::text, round(COALESCE(sum(km), 0)::numeric, 3), NULL::numeric, count(*) FROM outside HAVING count(*) > 0
$$;

-- 3.2 Share of health premises holding an unexpired fitness certificate.
CREATE OR REPLACE FUNCTION spatial_engine.m_premises_certified()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT CASE WHEN h.location IS NOT NULL THEN g.ward_code ELSE spatial_engine.ward_of_label(h.suburb_ward) END AS ward_code,
           (h.fitness_certificate_expiry IS NOT NULL AND h.fitness_certificate_expiry >= current_date) AS certified
      FROM spatial_planning.health_premises h
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE h.location IS NOT NULL AND ST_Intersects(w.geom, h.location) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE h.deleted_at IS NULL AND h.authority_id = app.authority_id())
  SELECT ward_code, count(*) FILTER (WHERE certified)::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;

INSERT INTO spatial_engine.measure
  (measure_key, label, description, unit, kind, direction, denominator_kind, min_denominator, value_scale,
   classes, break_method, fixed_breaks, ramp, compute_fn, owner_dept, unit_key, source_note, sort_order)
VALUES
  ('road_density', 'Road length per km²',
   'Kilometres of active council road in each square kilometre of the ward. Roads are cut at the ward boundary. It says how much road there is, not what condition it is in.',
   'km of road per km²', 'density', 'neutral', 'area_km2', NULL, 1, 5, 'quantile', NULL, 'sequential',
   'm_road_density', 'Engineering and Works', 'engineering',
   'council_ops.road_asset (active) with geometry; roads without geometry are not counted. No data until roads carry geometry.', 50),
  ('premises_certified', 'Health premises with a valid fitness certificate',
   'The share of registered health premises (food outlets, schools, lodges and the like) whose fitness certificate has not expired.',
   '% certified', 'share', 'higher_is_better', 'facts', 3, 100, 4, 'fixed', ARRAY[50, 75, 90]::numeric[], 'sequential',
   'm_premises_certified', 'Social Services', 'social_admin',
   'spatial_planning.health_premises, placed by coordinates or the ward it carries. Base below 3 premises is not classified.', 60)
ON CONFLICT (measure_key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA spatial_engine TO vungu_app;
  END IF;
END $$;

-- ── 4. A unit head belongs to the council from the day the account exists ──────────────────
-- Without an authority a signed-in person sees no council rows at all (row-level security), so the two new roles
-- are added to the default-authority trigger, additively: every role 154, 188, 207 and 208 named is still in it.
CREATE OR REPLACE FUNCTION public.users_default_authority() RETURNS trigger AS $fn$
BEGIN
  IF NEW.authority_id IS NULL AND NEW.role IN (
    'admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer',
    'surveyor', 'gis_officer',
    'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
    'finance_committee', 'publisher', 'auditor',
    'accountant', 'cashier', 'revenue_officer', 'accounting_officer',
    'cash_supervisor',
    -- migration 216
    'engineer', 'hr_social_officer'
  ) THEN
    SELECT id INTO NEW.authority_id FROM public.local_authorities WHERE code = 'VUNGU';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- Accounts created with these roles before this trigger knew them.
UPDATE public.users SET authority_id = (SELECT id FROM public.local_authorities WHERE code = 'VUNGU')
 WHERE role IN ('engineer', 'hr_social_officer') AND authority_id IS NULL;
