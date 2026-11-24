-- 259: Housing and Estates. The council's waiting list, offers, allocations, cessions, leases,
-- cooperatives, servicing and housing-standards work, on the same parcels and the same people
-- every other department already uses.
--
-- Why this exists: Planning keeps the cadastre, Finance keeps the rates book, the cash office
-- issues receipts. Housing still ran on paper and a stand-allocation table that never named a
-- person in the register. A receipt at the cash office could not become a file the housing clerk
-- could open, and a stand on the map could be "allocated" twice.
--
-- Law and practice this models (Zimbabwe local authorities):
--   Rural District Councils Act ss.73, 74, 86–87 (estate development, township conditions)
--   Housing Standards Control Act [Chapter 29:08] (repair, demolition, closure, overcrowding)
--   Ministry minimum housing standards; waiting-list, interview, offer letter, agreement of sale,
--   cession, title, cooperatives and pay schemes as used by urban and rural councils.
--
-- Spatial rule: a housing file names land.parcel.parcel_id. The map is the register.
-- Person rule: a housing file names registry.person.id. The name on the day is also stored.
--
-- Rollback: migrations/rollback/259_housing_and_estates.down.sql
-- Idempotent. Tenant tables (tenancy.make_tenant).

CREATE SCHEMA IF NOT EXISTS housing;
COMMENT ON SCHEMA housing IS
  'Housing and Estates: waiting list through title, on land.parcel and registry.person (migration 259).';

-- ── Roles ────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n text;
  roles text[];
  added text[] := ARRAY['housing_officer', 'housing_clerk'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN
    RAISE EXCEPTION 'users_role_check is missing; later role migrations must run before 259';
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

ALTER TABLE public.admin_org_position DROP CONSTRAINT IF EXISTS admin_org_position_unit_known;
ALTER TABLE public.admin_org_position ADD CONSTRAINT admin_org_position_unit_known
  CHECK (unit_key IS NULL OR unit_key IN ('planning', 'finance', 'engineering', 'social_admin', 'audit', 'housing'));

DO $$
DECLARE v_ceo uuid;
BEGIN
  SELECT id INTO v_ceo FROM public.admin_org_position
   WHERE reports_to IS NULL AND title = 'Chief Executive Officer' ORDER BY created_at LIMIT 1;
  IF v_ceo IS NULL THEN RETURN; END IF;
  INSERT INTO public.admin_org_position (title, department, system_role, unit_key, reports_to, sort_order)
  SELECT v.title, v.department, v.system_role, v.unit_key, v_ceo, v.sort_order
    FROM (VALUES
      ('Housing and Estates Officer', 'Housing and Estates', 'housing_officer', 'housing', 5),
      ('Housing Clerk',               'Housing and Estates', 'housing_clerk',   'housing', 6)
    ) AS v(title, department, system_role, unit_key, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM public.admin_org_position p WHERE p.system_role = v.system_role);
END $$;

-- ── Schemes (spatial) ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housing.scheme (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL CONSTRAINT scheme_kind_known CHECK (kind IN (
                    'site_and_service', 'low_cost', 'medium_density', 'high_density',
                    'cooperative', 'pay_scheme', 'staff', 'rural_settlement', 'informal_upgrade')),
  township_code   text,
  description     text,
  geom            geometry(MultiPolygon, 4326),
  area_ha         numeric,
  target_stands   integer,
  services_note   text,
  status          text NOT NULL DEFAULT 'open' CONSTRAINT scheme_status_known CHECK (status IN (
                    'planned', 'open', 'fully_allocated', 'closed')),
  opened_on       date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_scheme_code ON housing.scheme (code);
CREATE INDEX IF NOT EXISTS idx_housing_scheme_geom ON housing.scheme USING gist (geom);

-- ── Waiting list ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housing.waiting_list (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_no            text NOT NULL,
  person_id          uuid REFERENCES registry.person (id),
  applicant_name     text NOT NULL,
  sought             text NOT NULL CONSTRAINT waiting_sought_known CHECK (sought IN (
                       'stand', 'rental', 'staff', 'cooperative', 'pay_scheme')),
  density            text CONSTRAINT waiting_density_known CHECK (density IS NULL OR density IN (
                       'low', 'medium', 'high', 'cluster', 'any')),
  preferred_scheme_id uuid REFERENCES housing.scheme (id) ON DELETE SET NULL,
  preferred_ward     integer CHECK (preferred_ward IS NULL OR preferred_ward BETWEEN 1 AND 99),
  household_size     integer CHECK (household_size IS NULL OR household_size BETWEEN 1 AND 40),
  monthly_income     numeric,
  currency           text NOT NULL DEFAULT 'USD',
  employer           text,
  special_needs      text,
  resident           boolean,
  first_time_seeker  boolean NOT NULL DEFAULT true,
  registered_on      date NOT NULL DEFAULT CURRENT_DATE,
  renewed_on         date,
  lapses_on          date,
  status             text NOT NULL DEFAULT 'active' CONSTRAINT waiting_status_known CHECK (status IN (
                       'draft', 'active', 'invited', 'interviewed', 'recommended',
                       'allocated', 'lapsed', 'withdrawn', 'ineligible')),
  ineligible_reason  text,
  score              numeric,
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_waiting_list_no ON housing.waiting_list (list_no);

CREATE TABLE IF NOT EXISTS housing.interview (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiting_list_id    uuid NOT NULL REFERENCES housing.waiting_list (id) ON DELETE CASCADE,
  invited_on         date,
  held_on            date,
  officer_id         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  capacity_ok        boolean,
  documents_complete boolean,
  dual_ownership     boolean,
  recommendation     text CONSTRAINT interview_reco_known CHECK (recommendation IS NULL OR recommendation IN (
                       'allocate', 'defer', 'disqualify')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Offers, allocations, agreements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS housing.allocation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiting_list_id    uuid REFERENCES housing.waiting_list (id) ON DELETE SET NULL,
  person_id          uuid REFERENCES registry.person (id),
  allottee_name      text NOT NULL,
  parcel_id          varchar(24) NOT NULL REFERENCES land.parcel (parcel_id),
  scheme_id          uuid REFERENCES housing.scheme (id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'reserved' CONSTRAINT allocation_status_known CHECK (status IN (
                       'reserved', 'offered', 'sold', 'occupied', 'leased', 'repossessed', 'cancelled')),
  allocated_on       date NOT NULL DEFAULT CURRENT_DATE,
  committee_minute   text,
  purchase_price     numeric,
  deposit_due        numeric,
  deposit_paid_on    date,
  currency           text NOT NULL DEFAULT 'USD',
  develop_by         date,
  notes              text,
  ended_at           timestamptz,
  ended_reason       text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_allocation_live
  ON housing.allocation (parcel_id) WHERE ended_at IS NULL AND status NOT IN ('cancelled', 'repossessed');

CREATE TABLE IF NOT EXISTS housing.offer (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_no           text NOT NULL,
  allocation_id      uuid NOT NULL REFERENCES housing.allocation (id) ON DELETE CASCADE,
  issued_on          date NOT NULL DEFAULT CURRENT_DATE,
  expires_on         date NOT NULL,
  accepted_on        date,
  declined_on        date,
  withdrawn_on       date,
  withdraw_reason    text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_offer_no ON housing.offer (offer_no);

CREATE TABLE IF NOT EXISTS housing.agreement (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_no       text NOT NULL,
  allocation_id      uuid NOT NULL REFERENCES housing.allocation (id) ON DELETE CASCADE,
  signed_on          date NOT NULL DEFAULT CURRENT_DATE,
  balance_due        numeric,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_agreement_no ON housing.agreement (agreement_no);

CREATE TABLE IF NOT EXISTS housing.cession (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cession_no         text NOT NULL,
  allocation_id      uuid NOT NULL REFERENCES housing.allocation (id),
  kind               text NOT NULL CONSTRAINT cession_kind_known CHECK (kind IN (
                       'ordinary', 'deceased_estate', 'court_order')),
  from_person_id     uuid REFERENCES registry.person (id),
  to_person_id       uuid REFERENCES registry.person (id),
  from_name          text NOT NULL,
  to_name            text NOT NULL,
  to_waiting_list_id uuid REFERENCES housing.waiting_list (id),
  court_ref          text,
  letters_of_admin   text,
  spouse_consent     boolean,
  status             text NOT NULL DEFAULT 'lodged' CONSTRAINT cession_status_known CHECK (status IN (
                       'lodged', 'approved', 'refused', 'completed')),
  lodged_on          date NOT NULL DEFAULT CURRENT_DATE,
  decided_on         date,
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_cession_no ON housing.cession (cession_no);

CREATE TABLE IF NOT EXISTS housing.lease (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_no           text NOT NULL,
  allocation_id      uuid REFERENCES housing.allocation (id),
  parcel_id          varchar(24) NOT NULL REFERENCES land.parcel (parcel_id),
  person_id          uuid REFERENCES registry.person (id),
  tenant_name        text NOT NULL,
  kind               text NOT NULL DEFAULT 'council_rental' CONSTRAINT lease_kind_known CHECK (kind IN (
                       'council_rental', 'staff', 'institutional')),
  rent               numeric,
  currency           text NOT NULL DEFAULT 'USD',
  start_on           date NOT NULL DEFAULT CURRENT_DATE,
  end_on             date,
  status             text NOT NULL DEFAULT 'active' CONSTRAINT lease_status_known CHECK (status IN (
                       'active', 'ended', 'breached')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_lease_no ON housing.lease (lease_no);

CREATE TABLE IF NOT EXISTS housing.cooperative (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  registration_no    text,
  scheme_id          uuid REFERENCES housing.scheme (id),
  contact_name       text,
  members_target     integer,
  status             text NOT NULL DEFAULT 'active' CONSTRAINT coop_status_known CHECK (status IN (
                       'proposed', 'active', 'completed', 'wound_up')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.cooperative_member (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id     uuid NOT NULL REFERENCES housing.cooperative (id) ON DELETE CASCADE,
  person_id          uuid REFERENCES registry.person (id),
  member_name        text NOT NULL,
  waiting_list_id    uuid REFERENCES housing.waiting_list (id),
  joined_on          date NOT NULL DEFAULT CURRENT_DATE,
  status             text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS housing.servicing (
  parcel_id          varchar(24) PRIMARY KEY REFERENCES land.parcel (parcel_id),
  water              boolean NOT NULL DEFAULT false,
  sewer              boolean NOT NULL DEFAULT false,
  road               boolean NOT NULL DEFAULT false,
  electricity        boolean NOT NULL DEFAULT false,
  notes              text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS housing.standard_order (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no           text NOT NULL,
  parcel_id          varchar(24) NOT NULL REFERENCES land.parcel (parcel_id),
  kind               text NOT NULL CONSTRAINT standard_kind_known CHECK (kind IN (
                       'repair', 'demolition', 'closure', 'clearance')),
  reason             text NOT NULL,
  served_on          date NOT NULL DEFAULT CURRENT_DATE,
  comply_by          date,
  status             text NOT NULL DEFAULT 'open' CONSTRAINT standard_status_known CHECK (status IN (
                       'open', 'complied', 'enforced', 'withdrawn')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_standard_order_no ON housing.standard_order (order_no);

CREATE TABLE IF NOT EXISTS housing.overcrowding (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id          varchar(24) NOT NULL REFERENCES land.parcel (parcel_id),
  occupants          integer NOT NULL CHECK (occupants >= 1),
  rooms              integer,
  notice_on          date NOT NULL DEFAULT CURRENT_DATE,
  status             text NOT NULL DEFAULT 'open' CONSTRAINT overcrowding_status_known CHECK (status IN (
                       'open', 'abated', 'referred')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.occupation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_no     text NOT NULL,
  parcel_id          varchar(24) NOT NULL REFERENCES land.parcel (parcel_id),
  allocation_id      uuid REFERENCES housing.allocation (id),
  issued_on          date NOT NULL DEFAULT CURRENT_DATE,
  kind               text NOT NULL DEFAULT 'occupation' CONSTRAINT occ_kind_known CHECK (kind IN (
                       'occupation', 'compliance')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_occupation_no ON housing.occupation (certificate_no);

CREATE TABLE IF NOT EXISTS housing.title_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id      uuid NOT NULL REFERENCES housing.allocation (id),
  lodged_on          date NOT NULL DEFAULT CURRENT_DATE,
  conveyancer        text,
  deed_ref           text,
  status             text NOT NULL DEFAULT 'lodged' CONSTRAINT title_status_known CHECK (status IN (
                       'lodged', 'at_deeds', 'issued', 'refused')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.repossession (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id      uuid NOT NULL REFERENCES housing.allocation (id),
  reason             text NOT NULL CONSTRAINT repo_reason_known CHECK (reason IN (
                       'non_payment', 'non_development', 'fraud', 'other')),
  notice_on          date NOT NULL DEFAULT CURRENT_DATE,
  effective_on       date,
  status             text NOT NULL DEFAULT 'noticed' CONSTRAINT repo_status_known CHECK (status IN (
                       'noticed', 'completed', 'withdrawn')),
  notes              text,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.announcement (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  body               text NOT NULL,
  scheme_id          uuid REFERENCES housing.scheme (id),
  published_on       date NOT NULL DEFAULT CURRENT_DATE,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS housing.event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL,
  subject_id         uuid,
  parcel_id          varchar(24),
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Numbers ──────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS housing.list_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.offer_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.agreement_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.cession_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.lease_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.order_no_seq;
CREATE SEQUENCE IF NOT EXISTS housing.occ_no_seq;

CREATE OR REPLACE FUNCTION housing.next_no(p_prefix text, p_seq regclass)
RETURNS text LANGUAGE sql AS $$
  SELECT p_prefix || lpad(nextval(p_seq)::text, 5, '0')
$$;

-- ── Scoring and allocation rules ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION housing.score_entry(p_id uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE r housing.waiting_list%ROWTYPE; v numeric := 0;
BEGIN
  SELECT * INTO r FROM housing.waiting_list WHERE id = p_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v := GREATEST(0, EXTRACT(year FROM age(CURRENT_DATE, r.registered_on))) * 10;
  IF r.special_needs IS NOT NULL AND btrim(r.special_needs) <> '' THEN v := v + 25; END IF;
  IF COALESCE(r.household_size, 1) >= 5 THEN v := v + 10; END IF;
  IF r.first_time_seeker THEN v := v + 15; END IF;
  IF r.resident THEN v := v + 10; END IF;
  UPDATE housing.waiting_list SET score = v, updated_at = now() WHERE id = p_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION housing.allocate_stand(
  p_waiting_id uuid, p_parcel_id varchar, p_by uuid, p_minute text, p_price numeric, p_deposit numeric)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  w housing.waiting_list%ROWTYPE;
  p record;
  v_id uuid;
  v_live uuid;
BEGIN
  SELECT * INTO w FROM housing.waiting_list WHERE id = p_waiting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'that waiting-list entry is not on the register' USING ERRCODE = '23503'; END IF;
  IF w.status NOT IN ('active', 'interviewed', 'recommended', 'invited') THEN
    RAISE EXCEPTION 'only a current waiting-list entry can be allocated a stand' USING ERRCODE = '23514';
  END IF;
  SELECT parcel_id, township_code, stand_no INTO p FROM land.parcel WHERE parcel_id = p_parcel_id AND status = 'current';
  IF NOT FOUND THEN RAISE EXCEPTION 'that stand is not on the land register' USING ERRCODE = '23503'; END IF;
  SELECT id INTO v_live FROM housing.allocation WHERE parcel_id = p_parcel_id AND ended_at IS NULL
    AND status NOT IN ('cancelled', 'repossessed');
  IF FOUND THEN RAISE EXCEPTION 'that stand is already allocated' USING ERRCODE = '23505'; END IF;

  INSERT INTO housing.allocation
    (waiting_list_id, person_id, allottee_name, parcel_id, scheme_id, status, committee_minute,
     purchase_price, deposit_due, created_by)
  SELECT w.id, w.person_id, w.applicant_name, p.parcel_id, s.id, 'reserved', p_minute, p_price, p_deposit, p_by
    FROM (SELECT 1) x
    LEFT JOIN housing.scheme s ON s.township_code = p.township_code
  RETURNING id INTO v_id;

  UPDATE housing.waiting_list SET status = 'allocated', updated_at = now() WHERE id = w.id;
  INSERT INTO housing.event (kind, subject_id, parcel_id, detail, created_by)
    VALUES ('allocated', v_id, p_parcel_id, jsonb_build_object('waiting_list_id', w.id, 'list_no', w.list_no), p_by);
  RETURN v_id;
END $$;

-- ── Spatial view ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW housing.v_spatial_stand WITH (security_invoker = true) AS
SELECT p.parcel_id, p.stand_no, p.township_code, p.ward_code, p.area_m2,
       ST_X(ST_Centroid(p.geom_wgs84)) AS lon,
       ST_Y(ST_Centroid(p.geom_wgs84)) AS lat,
       p.geom_wgs84,
       s.id AS scheme_id, s.name AS scheme_name, s.kind AS scheme_kind,
       a.id AS allocation_id, a.status AS housing_status, a.allottee_name,
       a.allocated_on, a.develop_by,
       COALESCE(sv.water, false) AS water,
       COALESCE(sv.sewer, false) AS sewer,
       COALESCE(sv.road, false) AS road,
       COALESCE(sv.electricity, false) AS electricity,
       CASE
         WHEN a.id IS NULL THEN 'vacant'
         ELSE a.status
       END AS map_status
  FROM land.parcel p
  LEFT JOIN housing.scheme s ON s.township_code = p.township_code
  LEFT JOIN housing.allocation a ON a.parcel_id = p.parcel_id AND a.ended_at IS NULL
        AND a.status NOT IN ('cancelled', 'repossessed')
  LEFT JOIN housing.servicing sv ON sv.parcel_id = p.parcel_id
 WHERE p.status = 'current';

COMMENT ON VIEW housing.v_spatial_stand IS
  'Every current parcel as Housing sees it: vacant or allocated, with servicing, for the map.';

-- ── Tenancy and grants ───────────────────────────────────────────────────────────────────
DO $$
DECLARE r text;
  tables text[] := ARRAY[
    'housing.scheme', 'housing.waiting_list', 'housing.interview', 'housing.allocation',
    'housing.offer', 'housing.agreement', 'housing.cession', 'housing.lease',
    'housing.cooperative', 'housing.cooperative_member', 'housing.servicing',
    'housing.standard_order', 'housing.overcrowding', 'housing.occupation',
    'housing.title_request', 'housing.repossession', 'housing.announcement', 'housing.event'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY tables LOOP
      PERFORM tenancy.classify(r, 'pending', 'housing awaiting the authority it belongs to');
    END LOOP;
  ELSE
    FOREACH r IN ARRAY tables LOOP
      PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
    END LOOP;
  END IF;
  FOREACH r IN ARRAY ARRAY['vungu_app', 'vungu_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA housing TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA housing TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA housing TO %I', r);
      EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA housing TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA housing GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', r);
    END IF;
  END LOOP;
END $$;

-- Unique list numbers per council once authority_id exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_housing_waiting_list_no_auth
  ON housing.waiting_list (authority_id, list_no);

-- ── Seed schemes from the cadastre ───────────────────────────────────────────────────────
INSERT INTO housing.scheme (code, name, kind, township_code, description, geom, area_ha, target_stands, status, opened_on, authority_id)
SELECT p.township_code,
       CASE p.township_code
         WHEN 'HERTS' THEN 'Hertfordshire site-and-service'
         WHEN 'LAYOUT' THEN 'Layout township'
         ELSE p.township_code
       END,
       CASE p.township_code
         WHEN 'HERTS' THEN 'site_and_service'
         WHEN 'LAYOUT' THEN 'medium_density'
         ELSE 'rural_settlement'
       END,
       p.township_code,
       CASE p.township_code
         WHEN 'HERTS' THEN 'Residential stands from the Hertfordshire general plan, on the Herefordshire farm.'
         WHEN 'LAYOUT' THEN 'The layout township used for rates demonstration stands.'
         ELSE 'Residential stands in this township.'
       END,
       ST_Multi(ST_UnaryUnion(ST_Collect(p.geom_wgs84))),
       (SUM(p.area_m2) / 10000.0),
       count(*)::int,
       'open',
       CURRENT_DATE,
       (SELECT id FROM public.local_authorities WHERE code = 'VUNGU')
  FROM land.parcel p
 WHERE p.status = 'current' AND p.township_code IN ('HERTS', 'LAYOUT')
 GROUP BY p.township_code
ON CONFLICT (code) DO NOTHING;

-- A handful of servicing facts so the map is not a blank overlay.
INSERT INTO housing.servicing (parcel_id, water, sewer, road, electricity, authority_id)
SELECT p.parcel_id, true, (p.stand_no ~ '^[0-9]*[05]$'), true, (p.township_code = 'LAYOUT'),
       (SELECT id FROM public.local_authorities WHERE code = 'VUNGU')
  FROM land.parcel p
 WHERE p.status = 'current' AND p.township_code IN ('HERTS', 'LAYOUT')
ON CONFLICT (parcel_id) DO NOTHING;
