-- ROLLBACK OF 216 — THE EXECUTIVE ARM'S UNITS
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/216_executive_units.down.sql
-- Refuses to run while any user or invite holds one of the two roles (they would violate the restored check).
-- The seeded vacant posts are removed only if nobody holds them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE role IN ('engineer', 'hr_social_officer')) THEN
    RAISE EXCEPTION 'users hold the engineer or hr_social_officer role; reassign them first';
  END IF;
END $$;
DELETE FROM spatial_engine.ward_value WHERE measure_key IN ('road_density', 'premises_certified');
DELETE FROM spatial_engine.measure WHERE measure_key IN ('road_density', 'premises_certified');
DROP FUNCTION IF EXISTS spatial_engine.m_road_density();
DROP FUNCTION IF EXISTS spatial_engine.m_premises_certified();
ALTER TABLE spatial_engine.measure DROP CONSTRAINT IF EXISTS measure_unit_known;
ALTER TABLE spatial_engine.measure DROP COLUMN IF EXISTS unit_key;
DELETE FROM public.admin_org_position WHERE holder_id IS NULL AND system_role IN ('engineer', 'hr_social_officer')
   OR (holder_id IS NULL AND unit_key IN ('finance', 'audit') AND reports_to IS NOT NULL AND department IN ('Finance', 'Internal Audit'));
DROP INDEX IF EXISTS public.idx_org_position_unit;
ALTER TABLE public.admin_org_position DROP CONSTRAINT IF EXISTS admin_org_position_unit_known;
ALTER TABLE public.admin_org_position DROP COLUMN IF EXISTS unit_key;
DO $$
DECLARE roles text[]; n text;
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('engineer', 'hr_social_officer') ORDER BY 1);
  ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
  IF to_regclass('public.invites') IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    IF roles IS NOT NULL THEN
      DELETE FROM public.invites WHERE role IN ('engineer', 'hr_social_officer');
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('engineer', 'hr_social_officer') ORDER BY 1);
      ALTER TABLE public.invites DROP CONSTRAINT invites_role_check;
      EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
        (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
    END IF;
  END IF;
END $$;
DELETE FROM public.schema_migrations WHERE filename = '216_executive_units.sql';
