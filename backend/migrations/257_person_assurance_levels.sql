-- 257: one register of persons, with four levels of assurance, for counter and online alike.
--
-- 256 made the register for the counter. An online sign-up still lived only on its user account
-- (users.residency_status, migration 115), so a resident verified online was not verified in the register and a person
-- registered at the counter had no account: two sources of truth. From here the register is the record and the account
-- reads it.
--
-- THE FOUR LEVELS (registry.person.assurance_level, computed from the evidence, never typed)
--   0  Recorded             a name as given; nothing checked.
--   1  Identity verified    the identity document was checked: a copy uploaded online and approved by an officer
--                           (identity_method 'copy_approved'), or the original seen at the counter.
--   2  Resident/ratepayer   identity verified, and residence in the district proved by one of the migration 115 proofs
--                           (title deed, certificate of occupation, lodger's permit, offer letter, rates or utility
--                           statement, letter from the councillor, headman or chief), or the deeds registry.
--   3  Original sighted     an officer has handled the ORIGINAL identity document at the counter. What acts of legal or
--                           financial weight need (issuing a permit, allocating or transferring a stand, a refund).
--   Level 3 is about how sure the council is of WHO the person is; it does not mean they live in the district (a developer
--   from Harare can be level 3). Residence is shown on its own as `resident`.
--
-- WHO MAY RAISE A LEVEL: the planning clerk (the council's registrar of record), with the cash supervisor and the system
-- administrator as back-up. Every other desk may register a person, at level 0. Enforced in src/routes/persons.js.
-- Every change of evidence is kept in registry.assurance_event (append-only).
--
-- THE REGISTRAR-GENERAL. registry.identity_check keeps each check of an identity document against the Registrar-General's
-- population register (src/services/registrarGeneral.js): what was sent, the outcome and the RG's reference, never the
-- RG's own data. A check that says the document is not theirs, or not valid, stops it being used to verify identity.
--
-- ONLINE ACCOUNTS. Each citizen account (roles 'registered', 'public') without a person gets one (source 'online'), with
-- its national ID where well formed and not already someone else's. An ID document an officer approved raises it to level
-- 1; a residency already verified on the account is carried across. users.residency_status becomes a mirror of the
-- register, kept by a trigger.
--
-- Tenant tables. Idempotent.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE EVIDENCE ON THE PERSON
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE registry.person
  ADD COLUMN IF NOT EXISTS date_of_birth          date CHECK (date_of_birth IS NULL OR date_of_birth BETWEEN '1900-01-01' AND CURRENT_DATE),
  -- identity: verified_at / verified_by / verified_how (256) say when, who and with which document; identity_method how
  ADD COLUMN IF NOT EXISTS identity_method        text,
  ADD COLUMN IF NOT EXISTS original_sighted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS original_sighted_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residency_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS residency_verified_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residency_method       text,
  ADD COLUMN IF NOT EXISTS residency_evidence     text,
  ADD COLUMN IF NOT EXISTS residency_document_id  uuid;

-- A person verified at the counter under 256 had the original in the officer's hands.
UPDATE registry.person
   SET identity_method = 'original_sighted', original_sighted_at = verified_at, original_sighted_by = verified_by
 WHERE verified_at IS NOT NULL AND identity_method IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_identity_method_known') THEN
    ALTER TABLE registry.person ADD CONSTRAINT person_identity_method_known CHECK (
      (verified_at IS NULL AND identity_method IS NULL)
      OR (verified_at IS NOT NULL AND identity_method IN ('original_sighted', 'copy_approved')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_original_is_identity') THEN
    ALTER TABLE registry.person ADD CONSTRAINT person_original_is_identity CHECK (
      original_sighted_at IS NULL OR (verified_at IS NOT NULL AND identity_method = 'original_sighted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_residency_method_known') THEN
    ALTER TABLE registry.person ADD CONSTRAINT person_residency_method_known CHECK (
      (residency_verified_at IS NULL AND residency_method IS NULL)
      OR (residency_verified_at IS NOT NULL AND residency_method IN ('counter', 'document_review', 'deeds_registry', 'carried_from_account')));
  END IF;
END $$;

ALTER TABLE registry.person
  ADD COLUMN IF NOT EXISTS assurance_level smallint GENERATED ALWAYS AS (
    CASE WHEN original_sighted_at IS NOT NULL THEN 3
         WHEN verified_at IS NOT NULL AND residency_verified_at IS NOT NULL THEN 2
         WHEN verified_at IS NOT NULL THEN 1
         ELSE 0 END) STORED,
  ADD COLUMN IF NOT EXISTS resident boolean GENERATED ALWAYS AS (residency_verified_at IS NOT NULL) STORED;
CREATE INDEX IF NOT EXISTS idx_person_assurance_level ON registry.person (assurance_level);

COMMENT ON COLUMN registry.person.assurance_level IS
  '0 recorded, 1 identity verified, 2 resident or ratepayer (identity verified and residence proved), 3 original identity document sighted at the counter. Computed from the evidence (migration 257).';
COMMENT ON COLUMN registry.person.resident IS
  'Residence in the district proved. Shown on its own: a level-3 person need not be resident (migration 257).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE HISTORY OF THE EVIDENCE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS registry.assurance_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id     uuid NOT NULL REFERENCES registry.person (id) ON DELETE CASCADE,
  event         text NOT NULL CONSTRAINT assurance_event_known CHECK (event IN (
                  'identity_verified', 'original_sighted', 'residency_verified', 'registered', 'carried_from_account')),
  method        text,
  evidence      text,
  document_id   uuid,
  check_id      uuid,
  level_after   smallint NOT NULL CHECK (level_after BETWEEN 0 AND 3),
  recorded_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  recorded_role text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE registry.assurance_event IS
  'Each change in what the council has checked about a person, with who checked it and how (migration 257). Append-only.';
CREATE INDEX IF NOT EXISTS idx_assurance_event_person ON registry.assurance_event (person_id, recorded_at);

CREATE OR REPLACE FUNCTION registry.assurance_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The history of a person''s verification is kept as it was recorded.' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_assurance_event_append_only ON registry.assurance_event;
CREATE TRIGGER trg_assurance_event_append_only BEFORE UPDATE ON registry.assurance_event
  FOR EACH ROW EXECUTE FUNCTION registry.assurance_event_append_only();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. CHECKS WITH THE REGISTRAR-GENERAL
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS registry.identity_check (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid REFERENCES registry.person (id) ON DELETE CASCADE,
  document_type    text NOT NULL CHECK (document_type IN ('national_id', 'passport')),
  document_number  text NOT NULL,
  -- what the council asked about: which particulars it sent (never the RG's own data, which it does not receive)
  sent             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- match: everything sent agrees; partial: the document is theirs but a particular sent differs or was not sent;
  -- no_match: the surname does not agree; not_found: no such document; unavailable: the service did not answer
  outcome          text NOT NULL CHECK (outcome IN ('match', 'partial', 'no_match', 'not_found', 'unavailable')),
  document_status  text CHECK (document_status IS NULL OR document_status IN ('valid', 'expired', 'cancelled', 'reported_lost_or_stolen', 'holder_deceased')),
  fields           jsonb NOT NULL DEFAULT '{}'::jsonb,
  rg_reference     text,
  service          text NOT NULL,          -- 'prototype' (the in-house prototype) or the address of the real service
  requested_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  purpose          text NOT NULL DEFAULT 'registration'
);
COMMENT ON TABLE registry.identity_check IS
  'A check of an identity document against the Registrar-General''s population register: what was sent, the outcome and the RG''s reference (migration 257). Personal information.';
CREATE INDEX IF NOT EXISTS idx_identity_check_person ON registry.identity_check (person_id, requested_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    FOREACH r IN ARRAY ARRAY['registry.assurance_event', 'registry.identity_check'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'register of persons awaiting the authority it belongs to');
    END LOOP;
  ELSE
    FOREACH r IN ARRAY ARRAY['registry.assurance_event', 'registry.identity_check'] LOOP
      PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
    END LOOP;
  END IF;
  FOREACH r IN ARRAY ARRAY['vungu_app', 'vungu_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT ON registry.assurance_event, registry.identity_check TO %I', r);
      EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA registry TO %I', r);
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. THE ACCOUNT READS THE REGISTER: users.residency_status mirrors the person's residence
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION registry.mirror_residency_to_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, registry AS $$
BEGIN
  IF NEW.residency_verified_at IS NOT NULL AND OLD.residency_verified_at IS DISTINCT FROM NEW.residency_verified_at THEN
    UPDATE public.users SET residency_status = 'verified',
                            residency_method = COALESCE(NEW.residency_method, residency_method),
                            residency_verified_at = NEW.residency_verified_at
     WHERE person_id = NEW.id AND residency_status IS DISTINCT FROM 'verified';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_person_residency_to_account ON registry.person;
CREATE TRIGGER trg_person_residency_to_account AFTER UPDATE OF residency_verified_at ON registry.person
  FOR EACH ROW EXECUTE FUNCTION registry.mirror_residency_to_account();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. SPLITTING A NAME AS WRITTEN: a leading title, the last word as surname, the rest as first names
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION registry.name_parts(p_name text, OUT title text, OUT first_names text, OUT surname text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE words text[];
BEGIN
  words := regexp_split_to_array(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')), ' ');
  title := CASE initcap(rtrim(words[1], '.')) WHEN 'Mr' THEN 'Mr' WHEN 'Mrs' THEN 'Mrs' WHEN 'Ms' THEN 'Ms' WHEN 'Miss' THEN 'Miss'
                                              WHEN 'Dr' THEN 'Dr' WHEN 'Prof' THEN 'Prof' WHEN 'Rev' THEN 'Rev' ELSE NULL END;
  IF title IS NOT NULL AND array_length(words, 1) > 1 THEN words := words[2:]; END IF;
  surname := words[array_length(words, 1)];
  first_names := NULLIF(array_to_string(words[1:array_length(words, 1) - 1], ' '), '');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. EVERY ONLINE ACCOUNT INTO THE REGISTER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  u record;
  pid uuid;
  auth int;
  nid text;
  n record;
  officer_doc record;
BEGIN
  SELECT id INTO auth FROM public.local_authorities WHERE code = 'VUNGU';
  IF auth IS NULL THEN RETURN; END IF;
  FOR u IN
    SELECT id, COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(name), ''), split_part(email, '@', 1)) AS person_name,
           phone, email, national_id, physical_address, residency_status, residency_method, residency_verified_at,
           COALESCE(authority_id, auth) AS authority_id, created_at
      FROM public.users
     WHERE role IN ('registered', 'public') AND person_id IS NULL
     ORDER BY created_at, id
  LOOP
    pid := NULL;
    nid := CASE WHEN registry.identifier_well_formed('national_id', u.national_id) THEN registry.normalise_identifier(u.national_id) END;
    -- The ID already names a person (made at the counter or by 256) who has no account: that person, this account.
    IF nid IS NOT NULL THEN
      SELECT i.person_id INTO pid FROM registry.person_identifier i
       WHERE i.authority_id = u.authority_id AND i.kind = 'national_id' AND i.value = nid
         AND NOT EXISTS (SELECT 1 FROM public.users x WHERE x.person_id = i.person_id);
    END IF;
    IF pid IS NULL THEN
      n := registry.name_parts(u.person_name);
      IF length(btrim(COALESCE(n.surname, ''))) < 2 THEN CONTINUE; END IF;
      INSERT INTO registry.person (authority_id, kind, title, surname, first_names, phone, email, physical_address, source, notes)
      VALUES (u.authority_id, 'individual', n.title, n.surname, n.first_names, NULLIF(btrim(u.phone), ''),
              CASE WHEN u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN u.email END, NULLIF(btrim(u.physical_address), ''),
              'online', 'Signed up online; brought into the register by migration 257.')
      RETURNING id INTO pid;
      IF nid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM registry.person_identifier WHERE authority_id = u.authority_id AND kind = 'national_id' AND value = nid) THEN
        INSERT INTO registry.person_identifier (authority_id, person_id, kind, value) VALUES (u.authority_id, pid, 'national_id', nid);
      END IF;
      INSERT INTO registry.assurance_event (authority_id, person_id, event, method, evidence, level_after, recorded_at)
      VALUES (u.authority_id, pid, 'registered', 'online', 'Account signed up online', 0, u.created_at);
    END IF;
    UPDATE public.users SET person_id = pid WHERE id = u.id;

    -- An identity document an officer approved: identity verified from a copy.
    SELECT d.id, d.doc_kind, d.verified_at, d.verified_by INTO officer_doc
      FROM public.citizen_documents d
     WHERE d.user_id = u.id AND d.deleted_at IS NULL AND d.doc_kind IN ('national_id', 'passport')
       AND d.verification_status = 'verified' AND d.verified_by IS NOT NULL
     ORDER BY d.verified_at LIMIT 1;
    IF officer_doc.id IS NOT NULL THEN
      UPDATE registry.person SET verified_at = officer_doc.verified_at, verified_by = officer_doc.verified_by,
                                 verified_how = 'Copy of the ' || replace(officer_doc.doc_kind, '_', ' ') || ' approved online',
                                 identity_method = 'copy_approved'
       WHERE id = pid AND verified_at IS NULL;
      INSERT INTO registry.assurance_event (authority_id, person_id, event, method, document_id, level_after, recorded_by, recorded_at)
      SELECT u.authority_id, pid, 'identity_verified', 'copy_approved', officer_doc.id, p.assurance_level, officer_doc.verified_by, officer_doc.verified_at
        FROM registry.person p WHERE p.id = pid;
    END IF;

    -- Residence already verified on the account is carried across.
    IF u.residency_status = 'verified' THEN
      UPDATE registry.person SET residency_verified_at = COALESCE(u.residency_verified_at, now()),
                                 residency_method = 'carried_from_account',
                                 residency_evidence = 'Verified on the online account (' || COALESCE(u.residency_method, 'method not recorded') || ')'
       WHERE id = pid AND residency_verified_at IS NULL;
      INSERT INTO registry.assurance_event (authority_id, person_id, event, method, evidence, level_after)
      SELECT u.authority_id, pid, 'carried_from_account', COALESCE(u.residency_method, 'not recorded'), 'Residence verified on the online account', p.assurance_level
        FROM registry.person p WHERE p.id = pid;
    END IF;
  END LOOP;
END $$;
