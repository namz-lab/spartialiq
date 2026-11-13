-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 208 — THE TILL SESSION LIFECYCLE: SUSPEND, ABANDON, SUPERVISED COUNT, ASSIGNMENT, CASH SUPERVISOR
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Design: docs/superpowers/specs/2026-11-12-cashier-workspace-design.md §3, §5, §8 (frontend
-- repository). Plan: docs/superpowers/plans/2026-11-12-cash-office-phase-a-sessions.md.
-- Rollback: migrations/rollback/208_cash_session_lifecycle.down.sql.
--
-- THE PROBLEM THIS SOLVES
-- A session could only be ended by its own cashier. A cashier who went home without cashing up
-- held the drawer indefinitely, and nobody had an authorised way to recover it. On 2026-11-12 the
-- council's only cash point was held all day by session CS-0000002.
--
-- THE RULE THIS IS ARRANGED AROUND
-- A DRAWER IS FREED BY A COUNT, NEVER BY A STATUS CHANGE. So:
--   * `suspended` (the cashier stepped away) and `abandoned` (a supervisor's finding) both still
--     HOLD the drawer: the one-session-per-drawer and one-session-per-cashier indexes cover
--     open, suspended and abandoned.
--   * `abandoned` freezes the session and does nothing else. It is not a close.
--   * The only way out of `abandoned` is a supervised count: a supervisor and a witness, neither of
--     them the cashier and not each other, count the drawer. The session is then `closed` and waits
--     for verification by a fourth person who is none of the three (C4, extended).
--   * Nothing here closes, verifies or releases a session automatically, on a timer or otherwise.
--
-- THE AUDIT TRAIL
-- finance.cashier_session_event is append-only. It is written by a trigger on every status change
-- of a session (so a path that bypasses the functions is still recorded), by a trigger on every
-- float recorded, and carries each count as declared at the moment it was declared. UPDATE, DELETE
-- and TRUNCATE are refused by trigger and revoked from the application role. Existing sessions get
-- their history reconstructed from their own timestamps, marked source = 'backfill'.
--
-- BACKWARD COMPATIBILITY
-- Every existing row keeps its meaning: open, closed and verified are unchanged, and every new
-- column is NULL on every existing row. NO EXISTING SESSION, COUNT, RECEIPT, VOUCHER OR LEDGER ROW
-- IS CHANGED: section 0 fingerprints them before and section 12 refuses to commit if any differs.
--
-- POLICY VALUES ARE PROVISIONAL (decision D29, not yet taken by the Council)
--   cash.abandon_after_hours       12      how long before a supervisor may call a session abandoned
--   cash.require_assignment        false   whether a cashier may open only an assigned point
-- Both are written with `"provisional": true` and keep today's behaviour where today had one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0. FINGERPRINT WHAT MUST NOT CHANGE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Only the columns that exist before this migration, so adding columns does not change the hash.
CREATE TEMP TABLE m208_before ON COMMIT DROP AS
SELECT 'cashier_session' AS tbl, count(*) AS n,
       md5(COALESCE(string_agg(concat_ws('|', id, session_no, cash_point_id, cashier_id, financial_year_id,
             business_date, status, opened_at, closed_at, verified_by, verified_at, verify_note,
             returned_by, returned_at, return_reason), '#' ORDER BY id), '')) AS h
  FROM finance.cashier_session
UNION ALL SELECT 'cashier_session_count', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cashier_session_count x
UNION ALL SELECT 'cash_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt x
UNION ALL SELECT 'cash_receipt_line', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt_line x
UNION ALL SELECT 'rates_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.rates_receipt x
UNION ALL SELECT 'bank_deposit', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.bank_deposit x
UNION ALL SELECT 'voucher', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.voucher x
UNION ALL SELECT 'voucher_line', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.voucher_line x
UNION ALL SELECT 'ledger_entry', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.ledger_entry x
UNION ALL SELECT 'document_sequence', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.document_sequence x;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE ROLE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Rebuilt additively, exactly as 207 §1 does, so no role another migration added is dropped.
DO $$
DECLARE
  n text;
  roles text[];
  added text[] := ARRAY['cash_supervisor'];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO roles
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.users'::regclass AND c.conname = 'users_role_check';
  IF roles IS NULL THEN
    RAISE EXCEPTION 'users_role_check is missing; migration 207 must run before 208';
  END IF;
  roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
  ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  EXECUTE format('ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));

  IF to_regclass('public.invites') IS NOT NULL THEN
    SELECT array_agg(DISTINCT m[1]) INTO roles
      FROM pg_constraint c,
           LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
     WHERE c.conrelid = 'public.invites'::regclass AND c.conname = 'invites_role_check';
    IF roles IS NOT NULL THEN
      roles := ARRAY(SELECT DISTINCT unnest(roles || added) ORDER BY 1);
      ALTER TABLE public.invites DROP CONSTRAINT invites_role_check;
      EXECUTE format('ALTER TABLE public.invites ADD CONSTRAINT invites_role_check CHECK (role IN (%s))',
        (SELECT string_agg(quote_literal(r), ', ') FROM unnest(roles) r));
    END IF;
  END IF;
END $$;

-- Same list as 207 plus the new role, so a supervisor is created inside the council.
CREATE OR REPLACE FUNCTION public.users_default_authority() RETURNS trigger AS $fn$
BEGIN
  IF NEW.authority_id IS NULL AND NEW.role IN (
    'admin', 'planner', 'planning_clerk', 'building_inspector', 'eo', 'env_officer',
    'surveyor', 'gis_officer',
    'finance_admin', 'finance_officer', 'budget_officer', 'dept_head',
    'finance_committee', 'publisher', 'auditor',
    'accountant', 'cashier', 'revenue_officer', 'accounting_officer',
    -- migration 208
    'cash_supervisor'
  ) THEN
    SELECT id INTO NEW.authority_id FROM public.local_authorities WHERE code = 'VUNGU';
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. PERMISSIONS AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.cash.session.supervise', 'Supervise the tills', 'cash', false, false, false,
   'See who holds every drawer, find a session abandoned, and count an abandoned drawer with a witness. Never your own session; never releases a drawer without a count.'),
  ('finance.cash.assignment.manage', 'Assign cashiers to cash points', 'cash', false, false, false,
   'Record which cashiers work which cash point, and end an assignment. Ending one never touches a session in progress.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted,
      description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code) VALUES
  -- THE CASH SUPERVISOR (senior cashier). Watches the counters, recovers an abandoned drawer with a
  -- witness, assigns cashiers, and is a second person on a cash-up. Takes no money (no operate,
  -- no receipt), sets nothing up (no cash points, no income codes), and keeps no book (no ledger,
  -- no posting outside verifying a cash-up).
  ('cash_supervisor', 'finance.cash.view'),
  ('cash_supervisor', 'finance.cash.session.supervise'),
  ('cash_supervisor', 'finance.cash.assignment.manage'),
  ('cash_supervisor', 'finance.cash.session.verify'),
  ('cash_supervisor', 'finance.rates.view'),
  -- The Director may stand in for the supervisor, as for the accountant in 207.
  ('finance_admin', 'finance.cash.session.supervise'),
  ('finance_admin', 'finance.cash.assignment.manage')
ON CONFLICT (role_name, permission_code) DO NOTHING;

DO $$
BEGIN
  -- Separation from the accountant: the person who intervenes at the counter is not the default
  -- keeper of the book, and the book-keeper does not intervene at the counter.
  IF EXISTS (SELECT 1 FROM finance.role_permission
              WHERE role_name = 'accountant'
                AND permission_code IN ('finance.cash.session.supervise', 'finance.cash.assignment.manage')) THEN
    RAISE EXCEPTION 'the accountant must not hold till supervision by default (decision K4)';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.role_permission
              WHERE role_name = 'cash_supervisor'
                AND (permission_code IN ('finance.cash.session.operate', 'finance.cash.receipt.record',
                                         'finance.cash.receipt.cancel', 'finance.cash.setup.manage',
                                         'finance.cash.deposit.prepare')
                     OR permission_code LIKE 'finance.ledger.%' OR permission_code LIKE 'finance.budget.%')) THEN
    RAISE EXCEPTION 'the cash supervisor takes no money, sets nothing up and keeps no book';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.role_permission
              WHERE role_name = 'cashier'
                AND permission_code IN ('finance.cash.session.supervise', 'finance.cash.assignment.manage',
                                        'finance.cash.session.verify')) THEN
    RAISE EXCEPTION 'the cashier must not supervise, assign or verify';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE SESSION: TWO NEW STATES, WHO ENDED IT, WHO WITNESSED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE finance.cashier_session
  ADD COLUMN IF NOT EXISTS suspended_at   timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_at   timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_by   uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS abandon_reason text,
  -- NULL: the cashier counted their own drawer. Set: a supervisor counted it (abandoned session).
  ADD COLUMN IF NOT EXISTS closed_by      uuid REFERENCES public.users (id),
  ADD COLUMN IF NOT EXISTS witness_id     uuid REFERENCES public.users (id);

ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_status_known;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_status_known
  CHECK (status IN ('open', 'suspended', 'abandoned', 'closed', 'verified'));

-- A session that has not been counted has no closing time. Was: status = 'open' OR closed_at set.
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_closed_is_dated;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_closed_is_dated
  CHECK (status IN ('open', 'suspended', 'abandoned') OR closed_at IS NOT NULL);

ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_suspended_is_dated;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_suspended_is_dated
  CHECK (status <> 'suspended' OR suspended_at IS NOT NULL);

-- An abandonment names who found it and why, all three or none, and is never the cashier's own.
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandon_is_attributed;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_abandon_is_attributed CHECK (
  (abandoned_at IS NULL AND abandoned_by IS NULL AND abandon_reason IS NULL)
  OR (abandoned_at IS NOT NULL AND abandoned_by IS NOT NULL AND length(btrim(abandon_reason)) >= 10));
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandoned_by_another;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_abandoned_by_another
  CHECK (abandoned_by IS NULL OR abandoned_by <> cashier_id);
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_abandoned_is_marked;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_abandoned_is_marked
  CHECK (status <> 'abandoned' OR abandoned_at IS NOT NULL);

-- A supervised count has a supervisor and a witness, three different people with the cashier.
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_supervised_count_is_witnessed;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_supervised_count_is_witnessed CHECK (
  (closed_by IS NULL AND witness_id IS NULL)
  OR (closed_by IS NOT NULL AND witness_id IS NOT NULL
      AND closed_by <> cashier_id AND witness_id <> cashier_id AND witness_id <> closed_by
      AND abandoned_at IS NOT NULL));

-- C4, extended: nobody who counted or witnessed the drawer agrees the count.
ALTER TABLE finance.cashier_session DROP CONSTRAINT IF EXISTS cashier_session_verified_by_another;
ALTER TABLE finance.cashier_session ADD CONSTRAINT cashier_session_verified_by_another CHECK (
  verified_by IS NULL
  OR (verified_by <> cashier_id
      AND verified_by IS DISTINCT FROM closed_by
      AND verified_by IS DISTINCT FROM witness_id));

-- One drawer, one person — now over every state that still holds the drawer.
DROP INDEX IF EXISTS finance.uq_cashier_session_open_cashier;
CREATE UNIQUE INDEX uq_cashier_session_open_cashier
  ON finance.cashier_session (cashier_id) WHERE status IN ('open', 'suspended', 'abandoned');
DROP INDEX IF EXISTS finance.uq_cashier_session_open_point;
CREATE UNIQUE INDEX uq_cashier_session_open_point
  ON finance.cashier_session (cash_point_id) WHERE status IN ('open', 'suspended', 'abandoned');

-- Only these moves exist. A direct UPDATE that tries any other is refused, so the event log and
-- the state can never tell different stories.
CREATE OR REPLACE FUNCTION finance.assert_cashier_session_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cashier session % is part of the cash record and is never deleted', OLD.session_no
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (
       ('open', 'suspended'), ('suspended', 'open'),
       ('open', 'abandoned'), ('suspended', 'abandoned'),
       ('open', 'closed'), ('abandoned', 'closed'),
       ('closed', 'open'), ('closed', 'abandoned'),
       ('closed', 'verified')) THEN
    RAISE EXCEPTION 'session % cannot go from % to %', OLD.session_no, OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  -- Returned for a recount: a supervised count goes back to the supervisor, not to the cashier who
  -- left, and an own count goes back to the cashier.
  IF OLD.status = 'closed' AND NEW.status = 'open' AND OLD.closed_by IS NOT NULL THEN
    RAISE EXCEPTION 'session % was counted under supervision; a recount is the supervisor''s, so it returns to abandoned', OLD.session_no
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'abandoned' AND OLD.closed_by IS NULL THEN
    RAISE EXCEPTION 'session % was counted by its cashier and returns to them', OLD.session_no USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cashier_session_transition ON finance.cashier_session;
CREATE TRIGGER trg_cashier_session_transition
  BEFORE UPDATE OF status OR DELETE ON finance.cashier_session
  FOR EACH ROW EXECUTE FUNCTION finance.assert_cashier_session_transition();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE EVENT LOG — APPEND ONLY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.cashier_session_event (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  authority_id       integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cashier_session_id uuid NOT NULL REFERENCES finance.cashier_session (id),
  event              text NOT NULL CONSTRAINT cashier_session_event_known CHECK (event IN (
                       'opened', 'float_recorded', 'suspended', 'resumed', 'abandoned',
                       'counted', 'counted_under_supervision', 'returned', 'verified')),
  from_status        text,
  to_status          text,
  actor_id           uuid REFERENCES public.users (id),
  witness_id         uuid REFERENCES public.users (id),
  reason             text,
  -- Each count as declared at that moment: currency, float, expected, declared, variance,
  -- explanation, difference voucher. A later recount appends; it does not overwrite.
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  source             text NOT NULL DEFAULT 'live' CONSTRAINT cashier_session_event_source_known
                       CHECK (source IN ('live', 'backfill'))
);
CREATE INDEX IF NOT EXISTS idx_cashier_session_event_session
  ON finance.cashier_session_event (cashier_session_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_cashier_session_event_actor
  ON finance.cashier_session_event (actor_id, occurred_at);

COMMENT ON TABLE finance.cashier_session_event IS
  'Append-only history of every cashier session: opening, floats, suspension, resumption, '
  'abandonment, each count with its variance as declared, returns and verification. Written by '
  'triggers on finance.cashier_session and finance.cashier_session_count; never updated or deleted.';

CREATE OR REPLACE FUNCTION finance.refuse_session_event_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the cashier session history is append-only and is never % ', lower(TG_OP)
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_cashier_session_event_immutable ON finance.cashier_session_event;
CREATE TRIGGER trg_cashier_session_event_immutable
  BEFORE UPDATE OR DELETE ON finance.cashier_session_event
  FOR EACH ROW EXECUTE FUNCTION finance.refuse_session_event_change();
DROP TRIGGER IF EXISTS trg_cashier_session_event_no_truncate ON finance.cashier_session_event;
CREATE TRIGGER trg_cashier_session_event_no_truncate
  BEFORE TRUNCATE ON finance.cashier_session_event
  FOR EACH STATEMENT EXECUTE FUNCTION finance.refuse_session_event_change();

/** The counts of a session as they stand, for an event's detail. */
CREATE OR REPLACE FUNCTION finance.session_counts_json(p_session_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'currency', currency, 'opening_float', opening_float::text,
           'expected_takings', expected_takings::text, 'declared_total', declared_total::text,
           'variance', variance::text, 'explanation', explanation,
           'difference_voucher_id', difference_voucher_id) ORDER BY currency), '[]'::jsonb)
    FROM finance.cashier_session_count WHERE cashier_session_id = p_session_id
$$;

CREATE OR REPLACE FUNCTION finance.log_cashier_session_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_event text; v_actor uuid; v_witness uuid; v_reason text; v_detail jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO finance.cashier_session_event
      (authority_id, cashier_session_id, event, from_status, to_status, actor_id, detail)
    VALUES (NEW.authority_id, NEW.id, 'opened', NULL, NEW.status, NEW.cashier_id,
            jsonb_build_object('session_no', NEW.session_no, 'cash_point_id', NEW.cash_point_id,
                               'business_date', NEW.business_date));
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  CASE
    WHEN OLD.status = 'open' AND NEW.status = 'suspended' THEN
      v_event := 'suspended'; v_actor := NEW.cashier_id;
    WHEN OLD.status = 'suspended' AND NEW.status = 'open' THEN
      v_event := 'resumed'; v_actor := NEW.cashier_id;
    WHEN NEW.status = 'abandoned' AND OLD.status IN ('open', 'suspended') THEN
      v_event := 'abandoned'; v_actor := NEW.abandoned_by; v_reason := NEW.abandon_reason;
    WHEN OLD.status = 'open' AND NEW.status = 'closed' THEN
      v_event := 'counted'; v_actor := NEW.cashier_id;
      v_detail := jsonb_build_object('counts', finance.session_counts_json(NEW.id));
    WHEN OLD.status = 'abandoned' AND NEW.status = 'closed' THEN
      v_event := 'counted_under_supervision'; v_actor := NEW.closed_by; v_witness := NEW.witness_id;
      v_detail := jsonb_build_object('counts', finance.session_counts_json(NEW.id));
    WHEN OLD.status = 'closed' AND NEW.status IN ('open', 'abandoned') THEN
      -- The counts are read before the return clears them (the function updates the status first),
      -- so the count that was sent back stays on the record.
      v_event := 'returned'; v_actor := NEW.returned_by; v_reason := NEW.return_reason;
      v_witness := OLD.witness_id;
      v_detail := jsonb_build_object('counts_returned', finance.session_counts_json(NEW.id),
                                     'counted_by', COALESCE(OLD.closed_by, OLD.cashier_id));
    WHEN OLD.status = 'closed' AND NEW.status = 'verified' THEN
      v_event := 'verified'; v_actor := NEW.verified_by; v_reason := NEW.verify_note;
      v_detail := jsonb_build_object('counts', finance.session_counts_json(NEW.id));
  END CASE;

  INSERT INTO finance.cashier_session_event
    (authority_id, cashier_session_id, event, from_status, to_status, actor_id, witness_id, reason, detail)
  VALUES (NEW.authority_id, NEW.id, v_event, OLD.status, NEW.status, v_actor, v_witness, v_reason, v_detail);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cashier_session_event ON finance.cashier_session;
CREATE TRIGGER trg_cashier_session_event
  AFTER INSERT OR UPDATE OF status ON finance.cashier_session
  FOR EACH ROW EXECUTE FUNCTION finance.log_cashier_session_event();

CREATE OR REPLACE FUNCTION finance.log_session_float() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opening_float > 0 THEN
    INSERT INTO finance.cashier_session_event
      (authority_id, cashier_session_id, event, actor_id, detail)
    SELECT NEW.authority_id, NEW.cashier_session_id, 'float_recorded', s.cashier_id,
           jsonb_build_object('currency', NEW.currency, 'opening_float', NEW.opening_float::text)
      FROM finance.cashier_session s WHERE s.id = NEW.cashier_session_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cashier_session_float_event ON finance.cashier_session_count;
CREATE TRIGGER trg_cashier_session_float_event
  AFTER INSERT ON finance.cashier_session_count
  FOR EACH ROW EXECUTE FUNCTION finance.log_session_float();

-- Backfill: the history of sessions that existed before this log, from their own columns. Marked
-- 'backfill' so nobody mistakes a reconstruction for a record made at the time. A count that was
-- sent back before 208 cannot be recovered (207 cleared it) and is not invented.
INSERT INTO finance.cashier_session_event
  (authority_id, cashier_session_id, event, from_status, to_status, actor_id, reason, detail, occurred_at, source)
SELECT s.authority_id, s.id, e.event, e.from_status, e.to_status, e.actor_id, e.reason, e.detail, e.at, 'backfill'
  FROM finance.cashier_session s
 CROSS JOIN LATERAL (VALUES
   ('opened', NULL, 'open', s.cashier_id, NULL::text,
     jsonb_build_object('session_no', s.session_no, 'cash_point_id', s.cash_point_id, 'business_date', s.business_date),
     s.opened_at, true),
   ('returned', 'closed', 'open', s.returned_by, s.return_reason, '{"counts_returned": "not recorded before migration 208"}'::jsonb,
     s.returned_at, s.returned_at IS NOT NULL),
   ('counted', 'open', 'closed', s.cashier_id, NULL,
     jsonb_build_object('counts', finance.session_counts_json(s.id)), s.closed_at, s.closed_at IS NOT NULL),
   ('verified', 'closed', 'verified', s.verified_by, s.verify_note,
     jsonb_build_object('counts', finance.session_counts_json(s.id)), s.verified_at, s.verified_at IS NOT NULL)
 ) AS e(event, from_status, to_status, actor_id, reason, detail, at, present)
 WHERE e.present
   AND NOT EXISTS (SELECT 1 FROM finance.cashier_session_event x WHERE x.cashier_session_id = s.id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. ASSIGNMENT — WHO WORKS WHICH CASH POINT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Several cashiers may be assigned to one point (shifts, relief); only one holds it at a time,
-- which the session indexes already enforce. An assignment is never deleted: it is ended, once.
CREATE TABLE IF NOT EXISTS finance.cash_point_assignment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id  integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  cash_point_id uuid NOT NULL REFERENCES finance.cash_point (id),
  user_id       uuid NOT NULL REFERENCES public.users (id),
  valid_from    date NOT NULL DEFAULT CURRENT_DATE,
  valid_to      date,
  note          text,
  assigned_by   uuid NOT NULL REFERENCES public.users (id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  ended_by      uuid REFERENCES public.users (id),
  ended_at      timestamptz,
  end_reason    text,
  CONSTRAINT cash_point_assignment_not_self CHECK (assigned_by <> user_id),
  CONSTRAINT cash_point_assignment_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT cash_point_assignment_end_is_attributed CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND valid_to IS NOT NULL AND length(btrim(end_reason)) >= 5))
);
-- One live assignment per person per point.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_point_assignment_live
  ON finance.cash_point_assignment (cash_point_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_point_assignment_user
  ON finance.cash_point_assignment (user_id, valid_from);

CREATE OR REPLACE FUNCTION finance.guard_cash_point_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an assignment is ended, never deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'that assignment has already ended and is part of the record' USING ERRCODE = '42501';
  END IF;
  IF (NEW.cash_point_id, NEW.user_id, NEW.valid_from, NEW.assigned_by, NEW.assigned_at, NEW.authority_id)
     IS DISTINCT FROM (OLD.cash_point_id, OLD.user_id, OLD.valid_from, OLD.assigned_by, OLD.assigned_at, OLD.authority_id) THEN
    RAISE EXCEPTION 'an assignment is ended and a new one made; it is not edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cash_point_assignment_guard ON finance.cash_point_assignment;
CREATE TRIGGER trg_cash_point_assignment_guard
  BEFORE UPDATE OR DELETE ON finance.cash_point_assignment
  FOR EACH ROW EXECUTE FUNCTION finance.guard_cash_point_assignment();

/** Whether a person may work a point on a date: a live assignment (not ended) whose dates cover it. */
CREATE OR REPLACE FUNCTION finance.is_assigned_to_cash_point(p_user_id uuid, p_cash_point_id uuid, p_on date DEFAULT CURRENT_DATE)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM finance.cash_point_assignment a
                  WHERE a.user_id = p_user_id AND a.cash_point_id = p_cash_point_id
                    AND a.ended_at IS NULL
                    AND a.valid_from <= p_on AND (a.valid_to IS NULL OR a.valid_to >= p_on))
$$;

CREATE OR REPLACE FUNCTION finance.assign_cashier(p_cash_point_id uuid, p_user_id uuid, p_by uuid,
  p_valid_from date DEFAULT CURRENT_DATE, p_valid_to date DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE cp record; v_id uuid;
BEGIN
  SELECT id, authority_id, name, status INTO cp FROM finance.cash_point WHERE id = p_cash_point_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash point % does not exist', p_cash_point_id USING ERRCODE = '23503'; END IF;
  IF cp.status <> 'active' THEN RAISE EXCEPTION 'cash point % is not in use', cp.name USING ERRCODE = '23514'; END IF;
  IF p_by = p_user_id THEN
    RAISE EXCEPTION 'you cannot assign yourself to a cash point' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_user_id)
                  WHERE permission_code = 'finance.cash.session.operate') THEN
    RAISE EXCEPTION 'that person does not operate a till, so cannot be assigned to one' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_by)
                  WHERE permission_code = 'finance.cash.assignment.manage') THEN
    RAISE EXCEPTION 'assigning cashiers needs finance.cash.assignment.manage' USING ERRCODE = '42501';
  END IF;
  INSERT INTO finance.cash_point_assignment (authority_id, cash_point_id, user_id, valid_from, valid_to, note, assigned_by)
  VALUES (cp.authority_id, p_cash_point_id, p_user_id, COALESCE(p_valid_from, CURRENT_DATE), p_valid_to,
          NULLIF(btrim(p_note), ''), p_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Ending an assignment never touches a session: a cashier reassigned mid-shift still holds the
-- drawer until it is counted, by them or under supervision.
CREATE OR REPLACE FUNCTION finance.end_cashier_assignment(p_assignment_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM finance.cash_point_assignment WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment % does not exist', p_assignment_id USING ERRCODE = '23503'; END IF;
  IF a.ended_at IS NOT NULL THEN RAISE EXCEPTION 'that assignment has already ended' USING ERRCODE = '23514'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'ending an assignment needs a reason' USING ERRCODE = '23502';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_by)
                  WHERE permission_code = 'finance.cash.assignment.manage') THEN
    RAISE EXCEPTION 'ending an assignment needs finance.cash.assignment.manage' USING ERRCODE = '42501';
  END IF;
  UPDATE finance.cash_point_assignment
     SET valid_to = GREATEST(valid_from, CURRENT_DATE), ended_by = p_by, ended_at = now(), end_reason = btrim(p_reason)
   WHERE id = p_assignment_id;
END $$;

-- When the Council requires assignment (D29), a till opens only at an assigned point. Checked on
-- the row, so any path that opens a session is bound by it.
CREATE OR REPLACE FUNCTION finance.assert_session_point_assigned() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_required boolean; v_name text;
BEGIN
  SELECT (value->>'value')::boolean INTO v_required FROM finance.setting
   WHERE authority_id = NEW.authority_id AND key = 'cash.require_assignment';
  IF COALESCE(v_required, false) AND NOT finance.is_assigned_to_cash_point(NEW.cashier_id, NEW.cash_point_id, NEW.business_date) THEN
    SELECT name INTO v_name FROM finance.cash_point WHERE id = NEW.cash_point_id;
    RAISE EXCEPTION 'you are not assigned to cash point %; a supervisor assigns cashiers to drawers', v_name
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cashier_session_point_assigned ON finance.cashier_session;
CREATE TRIGGER trg_cashier_session_point_assigned
  BEFORE INSERT ON finance.cashier_session
  FOR EACH ROW EXECUTE FUNCTION finance.assert_session_point_assigned();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. PROVISIONAL SETTINGS (D29 — NOT DECIDED BY THE COUNCIL)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
INSERT INTO finance.setting (authority_id, key, value)
SELECT la.id, s.key, s.value
  FROM public.local_authorities la
 CROSS JOIN (VALUES
   ('cash.abandon_after_hours', '{"value": 12, "provisional": true, "decision": "D29"}'::jsonb),
   ('cash.require_assignment',  '{"value": false, "provisional": true, "decision": "D29"}'::jsonb)
 ) AS s(key, value)
 WHERE la.code = 'VUNGU'
ON CONFLICT (authority_id, key) DO NOTHING;

CREATE OR REPLACE FUNCTION finance.cash_abandon_after_hours(p_authority_id integer) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT (value->>'value')::numeric FROM finance.setting
                    WHERE authority_id = p_authority_id AND key = 'cash.abandon_after_hours'), 12)
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE COUNT, WRITTEN ONE WAY FOR BOTH CLOSES (C6, C8 unchanged)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The body of 207's close_cashier_session, lifted out so a supervised count follows exactly the
-- same rules: every currency the drawer could hold is declared, and a difference is explained.
CREATE OR REPLACE FUNCTION finance.write_session_count(p_session_id uuid, p_authority_id integer, p_counts jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; d record;
BEGIN
  FOR c IN
    SELECT cur.currency,
           COALESCE((SELECT sc.opening_float FROM finance.cashier_session_count sc
                      WHERE sc.cashier_session_id = p_session_id AND sc.currency = cur.currency), 0) AS opening_float,
           COALESCE((SELECT sum(r.amount) FROM finance.v_cashier_session_receipt r
                      WHERE r.cashier_session_id = p_session_id AND r.currency = cur.currency
                        AND r.is_physical AND NOT r.is_cancelled), 0)::numeric(18,2) AS expected
      FROM (SELECT unnest(ARRAY['USD', 'ZWG'])::finance.currency_code AS currency) cur
  LOOP
    d := NULL;
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
    VALUES (p_session_id, p_authority_id, c.currency, c.opening_float, c.expected, d.declared_total, d.explanation)
    ON CONFLICT (cashier_session_id, currency) DO UPDATE
      SET expected_takings = EXCLUDED.expected_takings, declared_total = EXCLUDED.declared_total,
          explanation = EXCLUDED.explanation;
  END LOOP;
END $$;

-- Same signature and behaviour as 207, now through the shared count. A suspended session is
-- resumed before it is counted, so the cashier is present at their own count.
CREATE OR REPLACE FUNCTION finance.close_cashier_session(p_session_id uuid, p_cashier_id uuid, p_counts jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503';
  END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier; the count is declared by whoever took the money', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF s.status = 'suspended' THEN
    RAISE EXCEPTION 'session % is suspended; resume it before counting the drawer', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status = 'abandoned' THEN
    RAISE EXCEPTION 'session % was found abandoned and is counted under supervision', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is already %', s.session_no, s.status USING ERRCODE = '23514';
  END IF;
  PERFORM finance.write_session_count(p_session_id, s.authority_id, p_counts);
  UPDATE finance.cashier_session SET status = 'closed', closed_at = now() WHERE id = p_session_id;
END $$;

-- 207's return, with the status changed BEFORE the counts are cleared, so the event log keeps the
-- count that was sent back. A supervised count returns to `abandoned` (the supervisor recounts).
CREATE OR REPLACE FUNCTION finance.return_cashier_session(p_session_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record; v_other record;
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
  IF p_by = s.closed_by OR p_by = s.witness_id THEN
    RAISE EXCEPTION 'you counted or witnessed session %; returning that count is somebody else''s act', s.session_no
      USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'returning a session needs a reason the cashier can act on' USING ERRCODE = '23502';
  END IF;
  -- A returned session takes its drawer back. If the drawer has since been opened by somebody else,
  -- two sessions would hold one drawer, so the return is refused; the count is verified as declared
  -- (a difference is posted, never absorbed) or the new session is counted first.
  SELECT o.session_no, COALESCE(u.full_name, u.name) AS holder INTO v_other
    FROM finance.cashier_session o JOIN public.users u ON u.id = o.cashier_id
   WHERE o.cash_point_id = s.cash_point_id AND o.id <> s.id AND o.status IN ('open', 'suspended', 'abandoned');
  IF FOUND THEN
    RAISE EXCEPTION 'session % cannot be returned for recount: its drawer is now held by % (session %)',
      s.session_no, v_other.holder, v_other.session_no
      USING ERRCODE = '23514', HINT = 'Verify the count as declared, or wait until that session is counted.';
  END IF;
  UPDATE finance.cashier_session
     SET status = CASE WHEN s.closed_by IS NULL THEN 'open' ELSE 'abandoned' END,
         closed_at = NULL, closed_by = NULL, witness_id = NULL,
         returned_by = p_by, returned_at = now(), return_reason = btrim(p_reason)
   WHERE id = p_session_id;
  UPDATE finance.cashier_session_count
     SET declared_total = NULL, expected_takings = NULL, explanation = NULL
   WHERE cashier_session_id = p_session_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. SUSPEND, RESUME, ABANDON, SUPERVISED COUNT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance.suspend_cashier_session(p_session_id uuid, p_cashier_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503'; END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier; only its cashier suspends it', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'session % is % and only an open session can be suspended', s.session_no, s.status USING ERRCODE = '23514';
  END IF;
  UPDATE finance.cashier_session SET status = 'suspended', suspended_at = now() WHERE id = p_session_id;
END $$;

CREATE OR REPLACE FUNCTION finance.resume_cashier_session(p_session_id uuid, p_cashier_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503'; END IF;
  IF s.cashier_id IS DISTINCT FROM p_cashier_id THEN
    RAISE EXCEPTION 'session % belongs to another cashier; only its cashier resumes it', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'suspended' THEN
    RAISE EXCEPTION 'session % is % and only a suspended session can be resumed', s.session_no, s.status USING ERRCODE = '23514';
  END IF;
  UPDATE finance.cashier_session SET status = 'open', suspended_at = NULL WHERE id = p_session_id;
END $$;

/**
 * A supervisor's finding that a session has been left: it freezes receipting and puts the drawer in
 * the queue for a supervised count. It does not close the session or free the drawer.
 */
CREATE OR REPLACE FUNCTION finance.mark_cashier_session_abandoned(p_session_id uuid, p_by uuid, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record; v_hours numeric; v_held numeric;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_by)
                  WHERE permission_code = 'finance.cash.session.supervise') THEN
    RAISE EXCEPTION 'finding a session abandoned needs finance.cash.session.supervise' USING ERRCODE = '42501';
  END IF;
  IF s.cashier_id = p_by THEN
    RAISE EXCEPTION 'session % is your own; you cash it up, you do not find it abandoned', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status = 'abandoned' THEN
    RAISE EXCEPTION 'session % is already abandoned', s.session_no USING ERRCODE = '23514';
  END IF;
  IF s.status NOT IN ('open', 'suspended') THEN
    RAISE EXCEPTION 'session % is % and has been counted; it cannot be abandoned', s.session_no, s.status USING ERRCODE = '23514';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'finding a session abandoned needs a reason of at least ten characters' USING ERRCODE = '23502';
  END IF;
  v_hours := finance.cash_abandon_after_hours(s.authority_id);
  v_held := extract(epoch FROM (now() - s.opened_at)) / 3600;
  IF s.business_date >= CURRENT_DATE AND v_held < v_hours THEN
    RAISE EXCEPTION 'session % has been open % hours; a session can be found abandoned after % hours or once its business day has passed',
      s.session_no, round(v_held, 1), v_hours
      USING ERRCODE = '23514', HINT = 'Ask the cashier to suspend or cash up. The threshold is the Council''s (decision D29).';
  END IF;
  UPDATE finance.cashier_session
     SET status = 'abandoned', abandoned_at = now(), abandoned_by = p_by, abandon_reason = btrim(p_reason)
   WHERE id = p_session_id;
END $$;

/**
 * Count an abandoned drawer. A supervisor counts, a witness watches, neither is the cashier and
 * they are not each other. The count follows every rule of a cashier's own (write_session_count).
 * The session is then closed and waits for a fourth person to verify it.
 */
CREATE OR REPLACE FUNCTION finance.supervised_close_cashier_session(
  p_session_id uuid, p_by uuid, p_witness_id uuid, p_counts jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM finance.cashier_session WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier session % does not exist', p_session_id USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_by)
                  WHERE permission_code = 'finance.cash.session.supervise') THEN
    RAISE EXCEPTION 'a supervised count needs finance.cash.session.supervise' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'abandoned' THEN
    RAISE EXCEPTION 'session % is %; only a session found abandoned is counted under supervision', s.session_no, s.status
      USING ERRCODE = '23514', HINT = 'An open session is cashed up by its own cashier.';
  END IF;
  IF s.cashier_id = p_by THEN
    RAISE EXCEPTION 'session % is your own and cannot be counted under your own supervision', s.session_no USING ERRCODE = '23514';
  END IF;
  IF p_witness_id IS NULL THEN
    RAISE EXCEPTION 'a supervised count is witnessed; name the witness' USING ERRCODE = '23502';
  END IF;
  IF p_witness_id = s.cashier_id OR p_witness_id = p_by THEN
    RAISE EXCEPTION 'the witness is somebody other than the cashier and the supervisor counting' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(p_witness_id)
                  WHERE permission_code = 'finance.cash.view') THEN
    RAISE EXCEPTION 'the witness must be a member of staff who may see the cash office' USING ERRCODE = '23514';
  END IF;
  PERFORM finance.write_session_count(p_session_id, s.authority_id, p_counts);
  UPDATE finance.cashier_session
     SET status = 'closed', closed_at = now(), closed_by = p_by, witness_id = p_witness_id
   WHERE id = p_session_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. A RECEIPT BELONGS TO ITS SESSION'S DAY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 207's cashier_session_for_receipt, plus one refusal: a session whose business day has passed
-- takes no more receipts, so money taken today is never dated yesterday. The refusal for a
-- suspended or abandoned session is the existing `status <> 'open'` one.
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
  IF s.business_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'session % belongs to % and takes no more receipts; cash it up and open today''s', s.session_no, s.business_date
      USING ERRCODE = '23514';
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

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. THE DRAWERS VIEW — WHO HOLDS WHAT, FOR THE SUPERVISOR AND THE COUNTER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW finance.v_cash_drawer WITH (security_invoker = true) AS
SELECT cp.id AS cash_point_id, cp.authority_id, cp.code, cp.name, cp.location, cp.status AS point_status,
       s.id AS session_id, s.session_no, s.status AS session_status, s.cashier_id,
       COALESCE(u.full_name, u.name) AS cashier_name, s.opened_at, s.business_date, s.suspended_at,
       s.abandoned_at, s.abandoned_by, COALESCE(ab.full_name, ab.name) AS abandoned_by_name, s.abandon_reason,
       CASE WHEN s.id IS NULL THEN NULL
            ELSE round((extract(epoch FROM (now() - s.opened_at)) / 3600)::numeric, 1) END AS hours_held,
       (s.id IS NOT NULL AND s.status IN ('open', 'suspended')
        AND (s.business_date < CURRENT_DATE
             OR extract(epoch FROM (now() - s.opened_at)) / 3600 >= finance.cash_abandon_after_hours(cp.authority_id))
       ) AS may_be_abandoned,
       (s.id IS NOT NULL AND s.business_date < CURRENT_DATE) AS is_stale
  FROM finance.cash_point cp
  LEFT JOIN finance.cashier_session s
         ON s.cash_point_id = cp.id AND s.status IN ('open', 'suspended', 'abandoned')
  LEFT JOIN public.users u ON u.id = s.cashier_id
  LEFT JOIN public.users ab ON ab.id = s.abandoned_by
 WHERE cp.deleted_at IS NULL;

COMMENT ON VIEW finance.v_cash_drawer IS
  'One row per cash point with the session holding it (open, suspended or abandoned), if any.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 11. TENANCY AND GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('finance.cashier_session_event', 'pending', 'cash office data awaiting the authority it belongs to');
    PERFORM tenancy.classify('finance.cash_point_assignment', 'pending', 'cash office data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('finance.cashier_session_event'::regclass, 'VUNGU');
  PERFORM tenancy.make_tenant('finance.cash_point_assignment'::regclass, 'VUNGU');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    -- The history is appended to and read; never changed by the application.
    REVOKE UPDATE, DELETE, TRUNCATE ON finance.cashier_session_event FROM vungu_app;
    REVOKE DELETE, TRUNCATE ON finance.cash_point_assignment FROM vungu_app;
    REVOKE DELETE, TRUNCATE ON finance.cashier_session FROM vungu_app;
    GRANT SELECT ON finance.v_cash_drawer TO vungu_app;
  END IF;
  PERFORM tenancy.classify('finance.v_cash_drawer', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 12. PROVE NOTHING EXISTING CHANGED
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE diff text;
BEGIN
  SELECT string_agg(b.tbl, ', ') INTO diff
    FROM m208_before b
    JOIN (
      SELECT 'cashier_session' AS tbl, count(*) AS n,
             md5(COALESCE(string_agg(concat_ws('|', id, session_no, cash_point_id, cashier_id, financial_year_id,
                   business_date, status, opened_at, closed_at, verified_by, verified_at, verify_note,
                   returned_by, returned_at, return_reason), '#' ORDER BY id), '')) AS h
        FROM finance.cashier_session
      UNION ALL SELECT 'cashier_session_count', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cashier_session_count x
      UNION ALL SELECT 'cash_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt x
      UNION ALL SELECT 'cash_receipt_line', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.cash_receipt_line x
      UNION ALL SELECT 'rates_receipt', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.rates_receipt x
      UNION ALL SELECT 'bank_deposit', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.bank_deposit x
      UNION ALL SELECT 'voucher', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.voucher x
      UNION ALL SELECT 'voucher_line', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.voucher_line x
      UNION ALL SELECT 'ledger_entry', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.ledger_entry x
      UNION ALL SELECT 'document_sequence', count(*), md5(COALESCE(string_agg(x::text, '#' ORDER BY x::text), '')) FROM finance.document_sequence x
    ) a ON a.tbl = b.tbl
   WHERE (a.n, a.h) IS DISTINCT FROM (b.n, b.h);
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'migration 208 would have changed existing financial records in: %; nothing is committed', diff;
  END IF;
  RAISE NOTICE 'migration 208: every existing session, count, receipt, voucher and ledger row is unchanged';
END $$;
