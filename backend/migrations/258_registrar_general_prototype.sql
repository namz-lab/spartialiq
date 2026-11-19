-- 258: a PROTOTYPE of a Registrar-General identity verification service, for demonstration only.
--
-- NOT FOR THE LIVE DATABASE. Everything in this schema is fictional: the people in its population register do not exist.
-- It stands in for the Registrar-General's Office so the council's side (registry.identity_check, migration 257;
-- src/services/registrarGeneral.js) can be built and shown before a real service exists. The live system runs with the
-- check switched off (RG_MODE=off) until the Registrar-General provides one. scripts/apply-*-to-live.js never applies 258.
--
-- THE DESIGN BEING DEMONSTRATED: verify, do not disclose.
--   * The council sends a document number and the particulars it holds (surname, first names, date of birth).
--   * The service answers, for each particular, whether it AGREES with the register, and the document's status (valid,
--     expired, cancelled, reported lost or stolen, holder deceased), with a reference. It never returns the register's
--     own data: a council that asks about 63-1234567 X 27 does not learn whose ID it is.
--   * Each client (a council, a bank) has its own key, and every question is logged on the Registrar-General's side with
--     who asked, when and for what purpose, so the Registrar-General can audit the use of the register.
--
-- The schema is the Registrar-General's, not the council's: the application's tenant role (vungu_app) is granted nothing
-- here, and the service is reached only through its API (src/routes/registrar-general-prototype.js).
-- Idempotent.

CREATE SCHEMA IF NOT EXISTS rg_prototype;
COMMENT ON SCHEMA rg_prototype IS
  'PROTOTYPE of a Registrar-General identity verification service. Fictional data for demonstration; never on the live system (migration 258).';

-- The population register: one row per national ID issued.
CREATE TABLE IF NOT EXISTS rg_prototype.population_register (
  national_id     text PRIMARY KEY CHECK (national_id ~ '^[0-9]{2}[0-9]{6,7}[A-Z][0-9]{2}$'),
  surname         text NOT NULL,
  first_names     text NOT NULL,
  date_of_birth   date NOT NULL,
  sex             text NOT NULL CHECK (sex IN ('F', 'M')),
  place_of_birth  text,
  issued_on       date NOT NULL,
  status          text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled', 'holder_deceased'))
);

CREATE TABLE IF NOT EXISTS rg_prototype.passport (
  passport_no     text PRIMARY KEY CHECK (passport_no ~ '^[A-Z0-9]{6,12}$'),
  national_id     text NOT NULL REFERENCES rg_prototype.population_register (national_id),
  issued_on       date NOT NULL,
  expires_on      date NOT NULL,
  status          text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled', 'reported_lost_or_stolen'))
);

-- Who may ask. The key itself is never stored, only its SHA-256.
CREATE TABLE IF NOT EXISTS rg_prototype.client (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  key_sha256  text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS rg_prototype.verification_no;
-- Every question asked, on the Registrar-General's side.
CREATE TABLE IF NOT EXISTS rg_prototype.verification (
  reference        text PRIMARY KEY,
  client_id        integer NOT NULL REFERENCES rg_prototype.client (id),
  document_type    text NOT NULL CHECK (document_type IN ('national_id', 'passport')),
  document_number  text NOT NULL,
  particulars_sent text[] NOT NULL DEFAULT '{}',
  outcome          text NOT NULL CHECK (outcome IN ('match', 'partial', 'no_match', 'not_found')),
  document_status  text,
  fields           jsonb NOT NULL DEFAULT '{}'::jsonb,
  purpose          text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rg_verification_client ON rg_prototype.verification (client_id, requested_at DESC);

-- Not the council's data: classified as national reference, and nothing granted to the tenant role.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['rg_prototype.population_register', 'rg_prototype.passport', 'rg_prototype.client', 'rg_prototype.verification'] LOOP
    PERFORM tenancy.classify(r, 'national', 'PROTOTYPE Registrar-General service (migration 258): fictional, reached only through its API');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA rg_prototype FROM vungu_app;
    REVOKE ALL ON SCHEMA rg_prototype FROM vungu_app;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- FICTIONAL PEOPLE, chosen to show each answer the service can give
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO rg_prototype.population_register (national_id, surname, first_names, date_of_birth, sex, place_of_birth, issued_on, status) VALUES
  ('632876543X27', 'PHIRI',     'BERNARD',            '1979-04-12', 'M', 'Gweru',      '1997-06-02', 'valid'),            -- Case 1, the extension
  ('082345678K08', 'HLONGWANE', 'LINDIWE',            '1985-09-03', 'F', 'Bulawayo',   '2003-11-20', 'valid'),            -- Case 2, the tuck shop
  ('633011223Q63', 'KHUMALO',   'JABULANI',           '1962-01-20', 'M', 'Shurugwi',   '1980-03-14', 'valid'),            -- the objector
  ('631234567X63', 'CITIZEN',   'DEMO',               '1990-01-01', 'F', 'Gweru',      '2008-01-15', 'valid'),            -- the demo citizen account
  ('632222333B27', 'MOYO',      'TENDAI',             '1950-07-30', 'M', 'Gweru',      '1968-08-01', 'holder_deceased'),  -- an ID still in a dead man's name
  ('297654321C29', 'NCUBE',     'SIBONGILE THANDEKA', '1993-12-05', 'F', 'Kwekwe',     '2011-02-09', 'valid'),            -- two first names
  ('751112223D75', 'MUTASA',    'FARAI',              '1988-05-17', 'M', 'Harare',     '2006-07-07', 'cancelled')         -- an ID replaced after a correction
ON CONFLICT (national_id) DO NOTHING;

INSERT INTO rg_prototype.passport (passport_no, national_id, issued_on, expires_on, status) VALUES
  ('FN123456', '632876543X27', '2021-03-01', '2031-02-28', 'valid'),
  ('FN654321', '082345678K08', '2014-05-10', '2024-05-09', 'valid'),                    -- expired
  ('FN777888', '297654321C29', '2022-09-15', '2032-09-14', 'reported_lost_or_stolen')
ON CONFLICT (passport_no) DO NOTHING;

-- The council's key for the prototype. A demonstration key; a real service issues its own.
INSERT INTO rg_prototype.client (name, key_sha256)
VALUES ('Vungu Rural District Council', encode(sha256(convert_to('rg-prototype-vungu-demo-key', 'UTF8')), 'hex'))
ON CONFLICT (name) DO NOTHING;
