-- 256: the council's register of persons. One record for each person or organisation the council deals with, shared by
-- every department, so the same person is known to be the same person wherever they appear.
--
-- Until now each module typed its own copy of a person's name: the applicant on the application, the objector on the
-- objection, the payer on the receipt, the allottee on the allocation, the customer in Finance. Only a person with an email
-- address could be registered at all, by signing up online. A walk-in applicant, an objector at the counter or a payer at
-- the cash office could not be registered by staff, and Mrs Hlongwane paying, applying and owning a stand was three people.
-- (Review: docs/reports/integration-review-roads-finance-planning-2026-11-19.md, section 4.)
--
--   registry.person              a natural person or an organisation, with how to reach them and whether staff have
--                                seen their identity document (verified_at). Roles (applicant, objector, payer, owner)
--                                are NOT stored on the person: they follow from the links below, so they cannot go stale.
--   registry.person_identifier   how a person is recognised: national ID, passport, company registration. Stored
--                                normalised (upper case, letters and digits only) and unique per council and kind, so one
--                                national ID is one person.
--   registry.receipt_payer       the person who paid a cash-office receipt. A receipt is a fixed fiscal record (its row
--                                cannot be changed, migration 207), so the payer is linked beside it, not on it.
--   links                        spatial_planning.permit_application.applicant_person_id,
--                                spatial_planning.application_objection.objector_person_id, public.users.person_id.
--
-- The text on each record (applicant_name, objector_name, payer_name) stays: it is the record as written on the day, on
-- which the law relies. The link adds identity; it does not replace the record.
--
-- Backfill: a person is created for each distinct, well-formed national ID already on an application, an objection or a
-- user account, and those records are linked to it. Nothing is matched on a name alone: records without an identity
-- number stay unlinked, and registry.v_unlinked lists them for staff to link through the register.
--
-- Personal information (Cyber and Data Protection Act [Chapter 12:07]): the API shows identity numbers masked, except to
-- the posts that register people, and logs every reveal. Tenant tables (tenancy.make_tenant). Idempotent.

CREATE SCHEMA IF NOT EXISTS registry;
COMMENT ON SCHEMA registry IS 'The council''s registers shared by every department: persons and organisations (migration 256).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. NORMALISING AN IDENTITY NUMBER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A Zimbabwean national ID is written many ways: 63-123456X27, 63-123456 X 27, 63 123456x27. Kept as letters and digits,
-- upper case: 63123456X27. Its shape is two digits (district of registration), six or seven digits, a check letter and two
-- digits (district of origin).
CREATE OR REPLACE FUNCTION registry.normalise_identifier(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION registry.identifier_well_formed(p_kind text, p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_kind
    WHEN 'national_id' THEN registry.normalise_identifier(p_value) ~ '^[0-9]{2}[0-9]{6,7}[A-Z][0-9]{2}$'
    WHEN 'passport' THEN registry.normalise_identifier(p_value) ~ '^[A-Z0-9]{6,12}$'
    WHEN 'company_registration' THEN registry.normalise_identifier(p_value) ~ '^[A-Z0-9]{3,20}$'
    ELSE false END
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE PERSON
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS registry.person (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL DEFAULT 'individual' CONSTRAINT person_kind_known CHECK (kind IN ('individual', 'organisation')),
  title              text CONSTRAINT person_title_known CHECK (title IS NULL OR title IN ('Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Rev', 'Chief')),
  surname            text,
  first_names        text,
  organisation_name  text,
  display_name       text GENERATED ALWAYS AS (
                       CASE WHEN kind = 'organisation' THEN btrim(organisation_name)
                            ELSE btrim(regexp_replace(COALESCE(title, '') || ' ' || COALESCE(first_names, '') || ' ' || COALESCE(surname, ''),
                                                      '\s+', ' ', 'g')) END) STORED,
  phone              text,
  alt_phone          text,
  email              text,
  physical_address   text,
  postal_address     text,
  ward_no            integer CHECK (ward_no IS NULL OR ward_no BETWEEN 1 AND 99),
  -- How the council's letters and notices reach them: by SMS, email, post, or collected at the office.
  preferred_channel  text NOT NULL DEFAULT 'post' CONSTRAINT person_channel_known CHECK (preferred_channel IN ('sms', 'email', 'post', 'collect')),
  -- 'counter': registered by staff; 'online': signed up themselves; 'backfill': made by migration 256 from older records.
  source             text NOT NULL DEFAULT 'counter' CONSTRAINT person_source_known CHECK (source IN ('counter', 'online', 'backfill', 'import')),
  -- Identity seen: staff sighted the identity document. An unverified person is still a person; the screens say which.
  verified_at        timestamptz,
  verified_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  verified_how       text,
  notes              text,
  -- A duplicate merged into another keeps its row, pointing at the survivor, so old links can be followed.
  merged_into        uuid REFERENCES registry.person (id),
  status             text NOT NULL DEFAULT 'active' CONSTRAINT person_status_known CHECK (status IN ('active', 'merged', 'deceased', 'dissolved')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  CONSTRAINT person_named CHECK (
    (kind = 'individual' AND length(btrim(COALESCE(surname, ''))) >= 2)
    OR (kind = 'organisation' AND length(btrim(COALESCE(organisation_name, ''))) >= 2)),
  CONSTRAINT person_merge_consistent CHECK ((status = 'merged') = (merged_into IS NOT NULL)),
  CONSTRAINT person_not_merged_into_self CHECK (merged_into IS NULL OR merged_into <> id),
  CONSTRAINT person_verified_complete CHECK (verified_at IS NULL OR length(btrim(COALESCE(verified_how, ''))) >= 3),
  CONSTRAINT person_email_shape CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
COMMENT ON TABLE registry.person IS
  'The council''s register of persons and organisations, shared by every department (migration 256). Roles follow from the links: an application''s applicant, an objection''s objector, a receipt''s payer, a user account.';
CREATE INDEX IF NOT EXISTS idx_person_surname ON registry.person (lower(surname));
CREATE INDEX IF NOT EXISTS idx_person_display ON registry.person (lower(display_name));
CREATE INDEX IF NOT EXISTS idx_person_phone ON registry.person (regexp_replace(phone, '[^0-9]', '', 'g'));

CREATE TABLE IF NOT EXISTS registry.person_identifier (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES registry.person (id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT person_identifier_kind_known CHECK (kind IN ('national_id', 'passport', 'company_registration')),
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  CONSTRAINT person_identifier_normalised CHECK (value = registry.normalise_identifier(value)),
  CONSTRAINT person_identifier_well_formed CHECK (registry.identifier_well_formed(kind, value))
);
COMMENT ON TABLE registry.person_identifier IS
  'How a person is recognised: national ID, passport, company registration, kept normalised. One per council, kind and value, so one national ID is one person (migration 256). Personal information: shown masked except to the posts that register people.';
CREATE INDEX IF NOT EXISTS idx_person_identifier_person ON registry.person_identifier (person_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE LINKS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS applicant_person_id uuid REFERENCES registry.person (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_permit_application_applicant_person ON spatial_planning.permit_application (applicant_person_id);
COMMENT ON COLUMN spatial_planning.permit_application.applicant_person_id IS
  'The applicant in the council''s register of persons (migration 256). applicant_name stays as written on the application.';

ALTER TABLE spatial_planning.application_objection
  ADD COLUMN IF NOT EXISTS objector_person_id uuid REFERENCES registry.person (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_application_objection_objector_person ON spatial_planning.application_objection (objector_person_id);
COMMENT ON COLUMN spatial_planning.application_objection.objector_person_id IS
  'The objector in the council''s register of persons (migration 256). objector_name stays as written on the objection.';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES registry.person (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_person ON public.users (person_id) WHERE person_id IS NOT NULL;
COMMENT ON COLUMN public.users.person_id IS
  'The account holder in the council''s register of persons (migration 256): one account per person.';

CREATE TABLE IF NOT EXISTS registry.receipt_payer (
  receipt_id  uuid PRIMARY KEY REFERENCES finance.cash_receipt (id),
  person_id   uuid NOT NULL REFERENCES registry.person (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE registry.receipt_payer IS
  'Who paid a cash-office receipt, in the register of persons (migration 256). Beside the receipt, because a receipt is a fixed record; its payer_name stays as printed.';
CREATE INDEX IF NOT EXISTS idx_receipt_payer_person ON registry.receipt_payer (person_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the register of persons stays pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['registry.person', 'registry.person_identifier', 'registry.receipt_payer'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'register of persons awaiting the authority it belongs to');
    END LOOP;
  ELSE
    FOREACH r IN ARRAY ARRAY['registry.person', 'registry.person_identifier', 'registry.receipt_payer'] LOOP
      PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
    END LOOP;
  END IF;
  FOREACH r IN ARRAY ARRAY['vungu_app', 'vungu_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA registry TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA registry TO %I', r);
      EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA registry TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA registry GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', r);
    END IF;
  END LOOP;
END $$;

-- One identity per council and kind. After make_tenant, so authority_id exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_identifier_value ON registry.person_identifier (authority_id, kind, value);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. RECORDS NOT YET LINKED TO A PERSON
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW registry.v_unlinked WITH (security_invoker = true) AS
  SELECT 'applicant'::text AS role, p.id AS record_id, p.applicant_name AS name_as_written,
         p.applicant_id_number AS id_number_as_written, p.applicant_phone AS phone_as_written,
         COALESCE(p.tpd_reference, p.dev_register_no, 'Stand ' || p.stand_number) AS reference,
         p.created_at AS recorded_at, p.authority_id
    FROM spatial_planning.permit_application p
   WHERE p.applicant_person_id IS NULL
  UNION ALL
  SELECT 'objector', o.id, o.objector_name, o.objector_id_number, NULL,
         COALESCE(p.tpd_reference, p.dev_register_no, 'Stand ' || p.stand_number), o.created_at, p.authority_id
    FROM spatial_planning.application_objection o
    JOIN spatial_planning.permit_application p ON p.id = o.permit_app_id
   WHERE o.objector_person_id IS NULL;
COMMENT ON VIEW registry.v_unlinked IS
  'Applicants and objectors still recorded only as text: the work list for linking them to the register of persons (migration 256).';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT ON registry.v_unlinked TO vungu_app; END IF;
  PERFORM tenancy.classify('registry.v_unlinked', 'tenant_view', 'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. BACKFILL: ONE PERSON PER WELL-FORMED NATIONAL ID ALREADY ON RECORD
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The earliest record with the ID gives the name and contact details. The name is split as written: a leading title, the
-- last word as surname, the rest as first names. Backfilled persons are unverified: staff confirm them at the counter.
DO $$
DECLARE
  rec record;
  pid uuid;
  words text[];
  ttl text;
BEGIN
  FOR rec IN
    WITH found AS (
      SELECT registry.normalise_identifier(applicant_id_number) AS nid, applicant_name AS name, applicant_phone AS phone,
             applicant_email AS email, street_address AS address, authority_id, created_at
        FROM spatial_planning.permit_application
       WHERE registry.identifier_well_formed('national_id', applicant_id_number) AND authority_id IS NOT NULL
      UNION ALL
      SELECT registry.normalise_identifier(o.objector_id_number), o.objector_name, NULL, NULL, o.objector_address, p.authority_id, o.created_at
        FROM spatial_planning.application_objection o JOIN spatial_planning.permit_application p ON p.id = o.permit_app_id
       WHERE registry.identifier_well_formed('national_id', o.objector_id_number) AND p.authority_id IS NOT NULL
      UNION ALL
      SELECT registry.normalise_identifier(national_id), COALESCE(full_name, name), phone, email, physical_address, authority_id, created_at
        FROM public.users
       WHERE registry.identifier_well_formed('national_id', national_id) AND authority_id IS NOT NULL
    )
    SELECT DISTINCT ON (authority_id, nid) * FROM found WHERE length(btrim(COALESCE(name, ''))) >= 2
     ORDER BY authority_id, nid, created_at
  LOOP
    SELECT person_id INTO pid FROM registry.person_identifier
     WHERE authority_id = rec.authority_id AND kind = 'national_id' AND value = rec.nid;
    IF pid IS NULL THEN
      words := regexp_split_to_array(btrim(regexp_replace(rec.name, '\s+', ' ', 'g')), ' ');
      ttl := CASE initcap(rtrim(words[1], '.')) WHEN 'Mr' THEN 'Mr' WHEN 'Mrs' THEN 'Mrs' WHEN 'Ms' THEN 'Ms' WHEN 'Miss' THEN 'Miss'
                                                WHEN 'Dr' THEN 'Dr' WHEN 'Prof' THEN 'Prof' WHEN 'Rev' THEN 'Rev' ELSE NULL END;
      IF ttl IS NOT NULL AND array_length(words, 1) > 1 THEN words := words[2:]; END IF;
      INSERT INTO registry.person (authority_id, kind, title, surname, first_names, phone, email, physical_address, source, notes)
      VALUES (rec.authority_id, 'individual', ttl, words[array_length(words, 1)],
              NULLIF(array_to_string(words[1:array_length(words, 1) - 1], ' '), ''),
              NULLIF(btrim(rec.phone), ''),
              CASE WHEN rec.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN rec.email END,
              NULLIF(btrim(rec.address), ''), 'backfill',
              'Made from the council''s earlier records (migration 256), name as written there. Confirm at the counter.')
      RETURNING id INTO pid;
      INSERT INTO registry.person_identifier (authority_id, person_id, kind, value) VALUES (rec.authority_id, pid, 'national_id', rec.nid);
    END IF;
  END LOOP;

  UPDATE spatial_planning.permit_application p SET applicant_person_id = i.person_id
    FROM registry.person_identifier i
   WHERE p.applicant_person_id IS NULL AND i.kind = 'national_id' AND i.authority_id = p.authority_id
     AND i.value = registry.normalise_identifier(p.applicant_id_number);
  UPDATE spatial_planning.application_objection o SET objector_person_id = i.person_id
    FROM spatial_planning.permit_application p, registry.person_identifier i
   WHERE o.objector_person_id IS NULL AND p.id = o.permit_app_id AND i.kind = 'national_id' AND i.authority_id = p.authority_id
     AND i.value = registry.normalise_identifier(o.objector_id_number);
  -- One account per person: where two accounts carry the same ID, the earliest is linked and the other left for staff.
  UPDATE public.users u SET person_id = m.person_id
    FROM (SELECT DISTINCT ON (i.person_id) i.person_id, x.id AS user_id
            FROM registry.person_identifier i
            JOIN public.users x ON x.authority_id = i.authority_id AND i.kind = 'national_id'
                               AND i.value = registry.normalise_identifier(x.national_id)
           WHERE NOT EXISTS (SELECT 1 FROM public.users y WHERE y.person_id = i.person_id)
           ORDER BY i.person_id, x.created_at, x.id) m
   WHERE u.id = m.user_id AND u.person_id IS NULL;
END $$;
