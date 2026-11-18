-- 250: three engineering staff can sign in: the Civil Technician, the Roads Foreman and the Water and Sanitation Technician.
--
-- Migration 249 put the Engineering and Works posts on the organisation chart for staff who do not sign in. These three
-- are the supervisory and technical posts under the Engineer that run the unit's day-to-day work: the civil technician
-- (design, supervision and inspection of works), the roads foreman (the road gangs and plant), and the water and
-- sanitation technician (water points, boreholes and sanitation). Each now has a system role:
--
--   civil_technician    the Civil Technician post         (reports to the Engineer)
--   roads_foreman       the Roads Foreman post            (reports to the Civil Technician)
--   water_technician    the Water and Sanitation Technician post (reports to the Engineer)
--
-- They are members of the Engineering and Works unit (src/config/units.js): they open the unit's dashboard and no other
-- unit's. Their posts now need an account, so a post with no holder is shown as a vacancy (src/routes/units.js).
-- Idempotent.

-- ── 1. The roles ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n text;
  roles text[];
  added text[] := ARRAY['civil_technician', 'roads_foreman', 'water_technician'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN
    RAISE EXCEPTION 'users_role_check is missing; migration 188 must run before 250';
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

-- ── 2. Their posts carry the roles ─────────────────────────────────────────────────────────
UPDATE public.admin_org_position SET system_role = 'civil_technician', updated_at = now()
 WHERE unit_key = 'engineering' AND title = 'Civil Technician' AND system_role IS NULL;
UPDATE public.admin_org_position SET system_role = 'roads_foreman', updated_at = now()
 WHERE unit_key = 'engineering' AND title = 'Roads Foreman' AND system_role IS NULL;
UPDATE public.admin_org_position SET system_role = 'water_technician', updated_at = now()
 WHERE unit_key = 'engineering' AND title = 'Water and Sanitation Technician' AND system_role IS NULL;
