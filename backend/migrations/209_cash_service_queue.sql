-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 209 — THE CASH OFFICE SERVICE QUEUE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Design: docs/superpowers/specs/2026-11-12-cashier-workspace-design.md §12.3 (frontend repository),
-- the Cashier Dashboard's "Service Queue" panel.
-- Rollback: migrations/rollback/209_cash_service_queue.down.sql.
--
-- WHAT IT IS
-- The people waiting at the counter, in the order they arrived, each with what they came to pay.
-- A ticket is numbered per council per business day. A cashier calls the next ticket, takes the
-- payment, and the ticket is marked served with the receipt it ended in; or it is removed with a
-- reason (the customer left, it was entered twice).
--
-- WHAT IT IS NOT
-- It moves no money and touches no ledger, session, receipt or bill row. A ticket only points at
-- the rates account and, once served, at the receipt. Nothing is deleted: a removed ticket keeps
-- its reason and who removed it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET search_path = finance, public;

CREATE TABLE IF NOT EXISTS finance.cash_queue_ticket (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id     integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  business_date    date NOT NULL DEFAULT CURRENT_DATE,
  ticket_no        integer NOT NULL CONSTRAINT cash_queue_ticket_no_positive CHECK (ticket_no > 0),
  customer_name    text NOT NULL CONSTRAINT cash_queue_ticket_name_length
                     CHECK (length(btrim(customer_name)) BETWEEN 2 AND 160),
  rates_account_id uuid REFERENCES finance.rates_account (id),
  service          text CONSTRAINT cash_queue_ticket_service_length CHECK (service IS NULL OR length(service) <= 120),
  status           text NOT NULL DEFAULT 'waiting'
                     CONSTRAINT cash_queue_ticket_status_known CHECK (status IN ('waiting', 'served', 'removed')),
  created_by       uuid NOT NULL REFERENCES public.users (id),
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by        uuid REFERENCES public.users (id),
  closed_at        timestamptz,
  -- A counter receipt is a cash_receipt (sundry) or a rates_receipt (rates), so the number is kept.
  receipt_no       text,
  removed_reason   text,
  CONSTRAINT uq_cash_queue_ticket_no UNIQUE (authority_id, business_date, ticket_no),
  CONSTRAINT cash_queue_ticket_closed_is_signed
    CHECK ((status = 'waiting') = (closed_at IS NULL AND closed_by IS NULL)),
  CONSTRAINT cash_queue_ticket_removal_is_explained
    CHECK (status <> 'removed' OR length(btrim(COALESCE(removed_reason, ''))) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_cash_queue_ticket_waiting
  ON finance.cash_queue_ticket (authority_id, business_date, ticket_no) WHERE status = 'waiting';

COMMENT ON TABLE finance.cash_queue_ticket IS
  'People waiting at the cash office counter, numbered per business day. Served with a receipt, '
  'or removed with a reason. Moves no money.';

-- Numbering under a lock on the council's day, so two counters adding at once cannot share a number.
CREATE OR REPLACE FUNCTION finance.add_cash_queue_ticket(
  p_user_id uuid, p_customer_name text, p_rates_account_id uuid, p_service text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_authority integer := app.authority_id();
  v_no integer;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance.cash_queue_ticket'), COALESCE(v_authority, 0));
  SELECT COALESCE(max(ticket_no), 0) + 1 INTO v_no
    FROM finance.cash_queue_ticket
   WHERE business_date = CURRENT_DATE AND authority_id IS NOT DISTINCT FROM v_authority;
  INSERT INTO finance.cash_queue_ticket (business_date, ticket_no, customer_name, rates_account_id, service, created_by)
  VALUES (CURRENT_DATE, v_no, btrim(p_customer_name), p_rates_account_id, NULLIF(btrim(COALESCE(p_service, '')), ''), p_user_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION finance.close_cash_queue_ticket(
  p_ticket_id uuid, p_user_id uuid, p_status text, p_receipt_no text, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  IF p_status NOT IN ('served', 'removed') THEN
    RAISE EXCEPTION 'a queue ticket is closed as served or removed' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO t FROM finance.cash_queue_ticket WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such queue ticket' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'waiting' THEN
    RAISE EXCEPTION 'queue ticket % is already %', t.ticket_no, t.status USING ERRCODE = '23514';
  END IF;
  UPDATE finance.cash_queue_ticket
     SET status = p_status, closed_by = p_user_id, closed_at = clock_timestamp(),
         receipt_no = CASE WHEN p_status = 'served' THEN NULLIF(btrim(COALESCE(p_receipt_no, '')), '') END,
         removed_reason = CASE WHEN p_status = 'removed' THEN btrim(p_reason) END
   WHERE id = p_ticket_id;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.classify('finance.cash_queue_ticket', 'pending', 'cash office data awaiting the authority it belongs to');
    RETURN;
  END IF;
  PERFORM tenancy.make_tenant('finance.cash_queue_ticket'::regclass, 'VUNGU');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    -- A ticket is closed, never deleted.
    REVOKE DELETE, TRUNCATE ON finance.cash_queue_ticket FROM vungu_app;
  END IF;
END $$;
