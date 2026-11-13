-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK OF 208 — THE TILL SESSION LIFECYCLE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Run as the database owner, in one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/208_cash_session_lifecycle.down.sql
--
-- WHAT IT REFUSES
-- It will not roll back over state 207 cannot represent. If any session is suspended or abandoned,
-- or was counted under supervision, or anyone holds the cash_supervisor role, it stops and changes
-- nothing. Resolve those sessions through the application first (or restore the pre-208 backup;
-- see docs/finance/MIGRATION-208-RUNBOOK.md in the frontend repository).
--
-- WHAT IT KEEPS
-- The session history and the assignments are AUDIT RECORDS and are not dropped. They are renamed
-- to finance.cashier_session_event_208_archive and finance.cash_point_assignment_208_archive, still
-- append-only, so a rollback never destroys evidence.
--
-- WHAT IT RESTORES
-- 207's constraints, indexes and function bodies, copied verbatim from 207 below. Every session,
-- count, receipt, voucher and ledger row is untouched; the last block proves it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET search_path = finance, public;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM finance.cashier_session
   WHERE status IN ('suspended', 'abandoned') OR closed_by IS NOT NULL OR abandoned_at IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback refused: % session(s) are suspended, abandoned or were counted under supervision, which 207 cannot represent', n;
  END IF;
  SELECT count(*) INTO n FROM public.users WHERE role = 'cash_supervisor';
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback refused: % user(s) hold the cash_supervisor role; give them another role first', n;
  END IF;
END $$;

CREATE TEMP TABLE m208_down_before ON COMMIT DROP AS
SELECT 'cashier_session' AS tbl, count(*) AS n,
       md5(COALESCE(string_agg(concat_ws('|', id, session_no, cash_point_id, cashier_id, financial_year_id,
             business_date, status, opened_at, closed_at, verified_by, verified_at, verify_note,
             returned_by, returned_at, return_reason), '#' ORDER BY id), '')) AS h
  FROM finance.cashier_session
UNION ALL SELECT 'cash_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt x
UNION ALL SELECT 'cashier_session_count', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cashier_session_count x
UNION ALL SELECT 'ledger_entry', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.ledger_entry x;

-- Triggers and the view first.
DROP TRIGGER IF EXISTS trg_cashier_session_event ON finance.cashier_session;
DROP TRIGGER IF EXISTS trg_cashier_session_transition ON finance.cashier_session;
DROP TRIGGER IF EXISTS trg_cashier_session_point_assigned ON finance.cashier_session;
DROP TRIGGER IF EXISTS trg_cashier_session_float_event ON finance.cashier_session_count;
DROP VIEW IF EXISTS finance.v_cash_drawer;

-- Archive, never drop, the audit records.
ALTER TABLE IF EXISTS finance.cashier_session_event RENAME TO cashier_session_event_208_archive;
ALTER TABLE IF EXISTS finance.cash_point_assignment RENAME TO cash_point_assignment_208_archive;

DROP FUNCTION IF EXISTS finance.supervised_close_cashier_session(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS finance.mark_cashier_session_abandoned(uuid, uuid, text);
DROP FUNCTION IF EXISTS finance.resume_cashier_session(uuid, uuid);
DROP FUNCTION IF EXISTS finance.suspend_cashier_session(uuid, uuid);
DROP FUNCTION IF EXISTS finance.assign_cashier(uuid, uuid, uuid, date, date, text);
DROP FUNCTION IF EXISTS finance.end_cashier_assignment(uuid, uuid, text);
DROP FUNCTION IF EXISTS finance.assert_session_point_assigned();
DROP FUNCTION IF EXISTS finance.assert_cashier_session_transition();
DROP FUNCTION IF EXISTS finance.log_cashier_session_event();
DROP FUNCTION IF EXISTS finance.log_session_float();
DROP FUNCTION IF EXISTS finance.cash_abandon_after_hours(integer);
DROP FUNCTION IF EXISTS finance.is_assigned_to_cash_point(uuid, uuid, date);

-- 207's constraints and indexes.
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_supervised_count_is_witnessed;
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandoned_is_marked;
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandoned_by_another;
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandon_is_attributed;
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_suspended_is_dated;
ALTER TABLE finance.cashier_session DROP CONSTRAINT cashier_session_verified_by_another;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_verified_by_another
  CHECK (verified_by IS NULL OR verified_by <> cashier_id);
ALTER TABLE finance.cashier_session DROP CONSTRAINT cashier_session_closed_is_dated;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_closed_is_dated
  CHECK (status = 'open' OR closed_at IS NOT NULL);
ALTER TABLE finance.cashier_session DROP CONSTRAINT cashier_session_status_known;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_status_known
  CHECK (status IN ('open', 'closed', 'verified'));
DROP INDEX finance.uq_cashier_session_open_cashier;
CREATE UNIQUE INDEX uq_cashier_session_open_cashier ON finance.cashier_session (cashier_id) WHERE status = 'open';
DROP INDEX finance.uq_cashier_session_open_point;
CREATE UNIQUE INDEX uq_cashier_session_open_point ON finance.cashier_session (cash_point_id) WHERE status = 'open';

-- 207's function bodies, verbatim (the shared count helper is dropped after close stops using it).

CREATE OR REPLACE FUNCTION public.users_default_authority() RETURNS trigger AS $fn$
BEGIN
  IF NEW.authority_id IS NULL AND NEW.role IN (
    'admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer',
    'surveyor', 'gis_officer',
    'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
    'finance_committee', 'publisher', 'auditor',
    -- migration 207
    'accountant', 'cashier', 'revenue_officer', 'accounting_officer'
  ) THEN
    SELECT id INTO NEW.authority_id FROM public.local_authorities WHERE code = 'VUNGU';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION finance.cashier_session_for_receipt(
  p_session_id uuid, p_cashier_id uuid, p_method text, p_deposit_account_id uuid,
  OUT authority_id integer, OUT financial_year_id uuid, OUT business_date date,
  OUT session_no text, OUT debit_account_id uuid)
LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  SELECT cs.id, cs.authority_id, cs.session_no, cs.cashier_id, cs.status, cs.financial_year_id,
         cs.business_date, cp.till_account_id, cp.name AS point_name
    INTO s
    FROM finance.cashier_session cs JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
   WHERE cs.id = p_session_id
     FOR UPDATE OF cs;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier, and a receipt is taken only in your own session', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is % and takes no more receipts', s.session_no, s.status
      USING ERRCODE = '23514', HINT = 'Open a new session to take this payment.';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'cheque', 'mobile_money', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'a receipt records how it was paid' USING ERRCODE = '23514';
  END IF;

  IF p_method IN ('cash', 'cheque') THEN
    IF p_deposit_account_id IS NOT NULL AND p_deposit_account_id <> s.till_account_id THEN
      RAISE EXCEPTION 'cash and cheques go into the till of %; they cannot be receipted into another account', s.point_name
        USING ERRCODE = '23514';
    END IF;
    debit_account_id := s.till_account_id;
  ELSE
    IF p_deposit_account_id IS NULL THEN
      RAISE EXCEPTION 'a % payment names the bank or wallet account it was paid into', replace(p_method, '_', ' ')
        USING ERRCODE = '23514';
    END IF;
    SELECT la.code, la.name, la.account_type, la.is_postable, la.status, la.deleted_at INTO a
      FROM finance.ledger_account la WHERE la.id = p_deposit_account_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account % does not exist', p_deposit_account_id USING ERRCODE = '23503';
    END IF;
    IF a.account_type IS DISTINCT FROM 'bank' THEN
      RAISE EXCEPTION 'account % (%) is not a bank account; money that is not in the drawer is never receipted into the till', a.code, a.name
        USING ERRCODE = '23514';
    END IF;
    IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
    END IF;
    debit_account_id := p_deposit_account_id;
  END IF;

  authority_id := s.authority_id;
  financial_year_id := s.financial_year_id;
  business_date := s.business_date;
  session_no := s.session_no;
END $$;

CREATE OR REPLACE FUNCTION finance.close_cashier_session(p_session_id uuid, p_cashier_id uuid, p_counts jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record; c record; d record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier; the count is declared by whoever took the money', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is already %', s.session_no, s.status USING ERRCODE = '23514';
  END IF;

  -- Every currency the drawer could hold: one with a float, or one a physical receipt was taken in.
  FOR c IN
    SELECT cur.currency,
           COALESCE((SELECT sc.opening_float FROM finance.cashier_session_count sc
                      WHERE sc.cashier_session_id = p_session_id AND sc.currency = cur.currency), 0) AS opening_float,
           COALESCE((SELECT sum(r.amount) FROM finance.v_cashier_session_receipt r
                      WHERE r.cashier_session_id = p_session_id AND r.currency = cur.currency
                        AND r.is_physical AND NOT r.is_cancelled), 0)::numeric(18,2) AS expected
      FROM (SELECT unnest(ARRAY['USD', 'ZWG'])::finance.currency_code AS currency) cur
  LOOP
    SELECT (x->>'declared_total')::numeric AS declared_total, NULLIF(btrim(x->>'explanation'), '') AS explanation
      INTO d
      FROM jsonb_array_elements(COALESCE(p_counts, '[]'::jsonb)) x
     WHERE x->>'currency' = c.currency::text
     LIMIT 1;
    IF d.declared_total IS NULL THEN
      IF c.opening_float = 0 AND c.expected = 0 THEN CONTINUE; END IF;
      RAISE EXCEPTION 'the % count has not been declared', c.currency
        USING ERRCODE = '23514', HINT = 'Count the drawer in each currency it holds, including the float.';
    END IF;
    IF d.declared_total < 0 THEN
      RAISE EXCEPTION 'a count is nil or more' USING ERRCODE = '23514';
    END IF;
    IF d.declared_total - c.opening_float - c.expected <> 0 AND length(COALESCE(d.explanation, '')) < 5 THEN
      RAISE EXCEPTION 'the % count differs from the receipts by %, and a difference is explained in writing before the session can be closed',
        c.currency, (d.declared_total - c.opening_float - c.expected)::numeric(18,2)
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO finance.cashier_session_count AS sc
      (cashier_session_id, authority_id, currency, opening_float, expected_takings, declared_total, explanation)
    VALUES (p_session_id, s.authority_id, c.currency, c.opening_float, c.expected, d.declared_total, d.explanation)
    ON CONFLICT (cashier_session_id, currency) DO UPDATE
      SET expected_takings = EXCLUDED.expected_takings, declared_total = EXCLUDED.declared_total,
          explanation = EXCLUDED.explanation;
  END LOOP;

  UPDATE finance.cashier_session SET status = 'closed', closed_at = now() WHERE id = p_session_id;
END $$;

CREATE OR REPLACE FUNCTION finance.return_cashier_session(p_session_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.status <> 'closed' THEN
    RAISE EXCEPTION 'session % is % and only a closed, unverified session can be returned', s.session_no, s.status
      USING ERRCODE = '23514';
  END IF;
  IF s.cashier_id = p_by THEN
    RAISE EXCEPTION 'session % is yours; returning a count for recounting is the verifier''s act', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'returning a session needs a reason the cashier can act on' USING ERRCODE = '23502';
  END IF;
  UPDATE finance.cashier_session_count
     SET declared_total = NULL, expected_takings = NULL, explanation = NULL
   WHERE cashier_session_id = p_session_id;
  UPDATE finance.cashier_session
     SET status = 'open', closed_at = NULL, returned_by = p_by, returned_at = now(), return_reason = btrim(p_reason)
   WHERE id = p_session_id;
END $$;

DROP FUNCTION IF EXISTS finance.write_session_count(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS finance.session_counts_json(uuid);
-- The archived log's immutability trigger keeps its own function.

ALTER TABLE finance.cashier_session
  DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS abandoned_at, DROP COLUMN IF EXISTS abandoned_by,
  DROP COLUMN IF EXISTS abandon_reason, DROP COLUMN IF EXISTS closed_by, DROP COLUMN IF EXISTS witness_id;

DELETE FROM finance.setting WHERE key IN ('cash.abandon_after_hours', 'cash.require_assignment');
DELETE FROM finance.role_permission WHERE role_name = 'cash_supervisor'
   OR permission_code IN ('finance.cash.session.supervise', 'finance.cash.assignment.manage');
DELETE FROM finance.user_permission_override
 WHERE permission_code IN ('finance.cash.session.supervise', 'finance.cash.assignment.manage');
DELETE FROM finance.permission WHERE code IN ('finance.cash.session.supervise', 'finance.cash.assignment.manage');

-- The role, removed from the constraint additively (everything else it holds is kept).
DO $$
DECLARE roles text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r <> 'cash_supervisor' ORDER BY 1);
  ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
  IF to_regclass('public.invites') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invites'::regclass AND conname = 'invites_role_check') THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r <> 'cash_supervisor' ORDER BY 1);
    ALTER TABLE public.invites DROP CONSTRAINT invites_role_check;
    EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
      (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
  END IF;
END $$;

-- The application role regains the privileges 207 gave it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    PERFORM tenancy.grant_app('finance.cashier_session'::regclass, 'write');
  END IF;
END $$;

DELETE FROM public.schema_migrations WHERE filename = '208_cash_session_lifecycle.sql';

DO $$
DECLARE diff text;
BEGIN
  SELECT string_agg(b.tbl, ', ') INTO diff
    FROM m208_down_before b JOIN (
      SELECT 'cashier_session' AS tbl, count(*) AS n,
             md5(COALESCE(string_agg(concat_ws('|', id, session_no, cash_point_id, cashier_id, financial_year_id,
                   business_date, status, opened_at, closed_at, verified_by, verified_at, verify_note,
                   returned_by, returned_at, return_reason), '#' ORDER BY id), '')) AS h
        FROM finance.cashier_session
      UNION ALL SELECT 'cash_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt x
      UNION ALL SELECT 'cashier_session_count', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cashier_session_count x
      UNION ALL SELECT 'ledger_entry', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.ledger_entry x
    ) a ON a.tbl = b.tbl
   WHERE (a.n, a.h) IS DISTINCT FROM (b.n, b.h);
  IF diff IS NOT NULL THEN RAISE EXCEPTION 'rollback would change: %; nothing is committed', diff; END IF;
  RAISE NOTICE 'rollback of 208: every session, count, receipt and ledger row is unchanged; history archived';
END $$;
