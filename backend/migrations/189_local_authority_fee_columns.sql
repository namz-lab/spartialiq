-- Columns the citizen and development-control routes already select.
-- Migration 139 was meant to add them. This database has `code` and not the
-- rest, so GET /api/council returns 500 and the application-fee screen cannot
-- open. Idempotent. The fee is filled from the working tariff when that row
-- exists; Finance can replace the figure later.

BEGIN;

ALTER TABLE local_authorities
  ADD COLUMN IF NOT EXISTS authority_type  text,
  ADD COLUMN IF NOT EXISTS application_fee numeric(12, 2),
  ADD COLUMN IF NOT EXISTS is_active       boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS kind            text,
  ADD COLUMN IF NOT EXISTS province        text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'local_authorities'
       AND column_name = 'authority_id'
  ) THEN
    ALTER TABLE local_authorities
      ADD COLUMN authority_id integer GENERATED ALWAYS AS (id) STORED;
  END IF;
END $$;

UPDATE local_authorities
   SET authority_type = COALESCE(authority_type, 'Rural District Council'),
       kind           = COALESCE(kind, 'rural'),
       province       = COALESCE(province, 'Midlands'),
       is_active      = COALESCE(is_active, TRUE)
 WHERE authority_name = 'Vungu Rural District Council';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'council_fee_tariff'
  ) THEN
    UPDATE local_authorities la
       SET application_fee = t.amount_usd
      FROM council_fee_tariff t
     WHERE t.code = 'application_fee'
       AND t.active
       AND la.application_fee IS NULL;
  END IF;
END $$;

COMMIT;
