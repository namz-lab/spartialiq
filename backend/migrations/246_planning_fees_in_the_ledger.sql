-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 246 — PLANNING FEES IN THE LEDGER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/246_planning_fees_in_the_ledger.down.sql
-- Routes: src/routes/finance-cash.js (the counter receipt, the payment channels, the income code's
-- planning fee kind), src/routes/finance-planning-fees.js (the list and "Prepare vouchers"),
-- src/routes/payments.js (an online fee is noted when the provider confirms it),
-- src/routes/planning-clerk.js (the clerk reads the cash office's fees).
--
-- WHAT WAS WRONG
-- Planning fees never reached the general ledger. The planning clerk wrote receipts in a register of
-- their own (spatial_planning.clerk_fee_receipt) and online fees settled in public.payments; neither
-- raised a voucher, so the council's revenue left out planning income and nothing reconciled the
-- clerk's cashbook to the bank. A counter receipt did not even mark the application's fee paid: only
-- an online payment set permit_application.fee_paid_at.
--
-- WHAT THIS DOES (client direction of 2026-11-17)
--   1. COUNTER FEES ARE TAKEN BY THE CASHIER. An income code can be marked as a planning fee of a
--      kind (application, plan scrutiny, public notice, ...). The cashier receipts it in their own
--      session like any other income, naming the application: finance.record_planning_fee_receipt()
--      calls finance.record_cash_receipt() unchanged, so every cash-office control holds (C1 the
--      cashier's own session, C2 the issued number, C3 never edited, C4/C5 a second person verifies
--      the count and that is when the voucher posts, C9 non-cash money to the bank). An application
--      fee receipt marks the application's fee paid; cancelling it unmarks it if nothing else paid.
--   2. ONLINE FEES ARE NOTED AT ONCE AND VOUCHERED BY A PERSON. When the provider confirms a planning
--      fee, finance.note_online_planning_fee() records it as "awaiting a voucher". A revenue officer
--      prepares the vouchers (Dr the bank account set for that provider, Cr the income code's
--      account) and an accountant posts them: a voucher names the person who prepared it and its
--      poster must be someone else (203, voucher_prepared_and_posted_differ), and the system is not
--      a person. Nothing is lost while it waits; the list says why one could not be prepared.
--   3. finance.v_planning_fee: every planning fee, its application, its receipt or payment, its
--      voucher, and where it stands (awaiting a voucher, awaiting posting, posted, cancelled).
--
-- WHAT IS NOT DECIDED HERE (decision D22): which income codes exist and what each charges, and which
-- bank account each online provider pays into. Both are seeded empty. Until a planning fee code and
-- a payment channel exist, online fees wait, and the list says so.
--
-- ONE WRITE INTO A PLANNING TABLE, ON PURPOSE. Paying the application fee is a fact the planning
-- workflow reads (permit_application.fee_paid_at; status pending_payment -> registered). The online
-- route already writes exactly this; the counter receipt now does the same, through one function,
-- finance.sync_planning_application_fee_paid(), and nothing else in Planning is touched.
--
-- The old clerk register is kept, read-only, as history: its receipts stay where they were.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT throughout.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. AN INCOME CODE CAN BE A PLANNING FEE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The kinds are the clerk register's (128), so the two records speak the same language.
ALTER TABLE finance.income_code ADD COLUMN IF NOT EXISTS planning_fee_kind text;
ALTER TABLE finance.income_code DROP CONSTRAINT IF EXISTS income_code_planning_fee_kind_known;
ALTER TABLE finance.income_code ADD CONSTRAINT income_code_planning_fee_kind_known CHECK (
  planning_fee_kind IS NULL OR planning_fee_kind IN (
    'application', 'plan_scrutiny', 'public_notice', 'inspection', 'occupation',
    'appeal', 'search', 'copies', 'other'));
-- One code in use per kind, so an online fee of that kind knows which account it credits.
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_code_planning_fee_kind
  ON finance.income_code (authority_id, planning_fee_kind)
  WHERE planning_fee_kind IS NOT NULL AND deleted_at IS NULL AND status = 'active';
COMMENT ON COLUMN finance.income_code.planning_fee_kind IS
  'Set when this income is a planning fee, and of which kind (migration 246). A receipt for it must '
  'name the planning application; an online fee of the same kind credits this code''s account.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. WHERE AN ONLINE PROVIDER PAYS IN
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS finance.payment_channel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id    integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  -- public.payments.driver (064)
  driver          text NOT NULL CONSTRAINT payment_channel_driver_known
                  CHECK (driver IN ('manual', 'paynow', 'stripe', 'ecocash', 'onemoney')),
  name            text NOT NULL CONSTRAINT payment_channel_named CHECK (length(btrim(name)) >= 2),
  -- The bank (or wallet) account the provider settles into: debited by the online fee's voucher.
  bank_account_id uuid NOT NULL REFERENCES finance.ledger_account (id),
  status          text NOT NULL DEFAULT 'active' CONSTRAINT payment_channel_status_known
                  CHECK (status IN ('active', 'inactive')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.users (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_channel_driver
  ON finance.payment_channel (authority_id, driver) WHERE deleted_at IS NULL;
COMMENT ON TABLE finance.payment_channel IS
  'An online payment provider and the bank account it settles into (migration 246). Seeded empty '
  '(decision D22): until one is set, online fees through that provider wait for a voucher.';

CREATE OR REPLACE FUNCTION finance.assert_payment_channel_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT code, name, account_type, is_postable, status, deleted_at INTO a
    FROM finance.ledger_account WHERE id = NEW.bank_account_id;
  IF a.account_type IS DISTINCT FROM 'bank' THEN
    RAISE EXCEPTION 'account % (%) is not a bank account; an online provider settles into a bank or wallet account', a.code, a.name
      USING ERRCODE = '23514';
  END IF;
  IF NOT a.is_postable OR a.status <> 'active' OR a.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account % (%) cannot be posted to', a.code, a.name USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payment_channel_account ON finance.payment_channel;
CREATE TRIGGER trg_payment_channel_account
  BEFORE INSERT OR UPDATE ON finance.payment_channel
  FOR EACH ROW EXECUTE FUNCTION finance.assert_payment_channel_account();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3. THE PLANNING FEE: WHICH APPLICATION A RECEIPT OR A PAYMENT PAID FOR
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A row of its own, because a cash receipt is never amended (207, C3) and a payment belongs to the
-- payments module. One row per counter receipt and kind, one per online payment.
CREATE TABLE IF NOT EXISTS finance.planning_fee (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id          integer NOT NULL DEFAULT app.authority_id() REFERENCES public.local_authorities (id),
  source                text NOT NULL CONSTRAINT planning_fee_source_known CHECK (source IN ('counter', 'online')),
  fee_kind              text NOT NULL CONSTRAINT planning_fee_kind_known CHECK (fee_kind IN (
                          'application', 'plan_scrutiny', 'public_notice', 'inspection', 'occupation',
                          'appeal', 'search', 'copies', 'other')),
  permit_application_id uuid REFERENCES spatial_planning.permit_application (id),
  cash_receipt_id       uuid REFERENCES finance.cash_receipt (id),
  payment_id            uuid REFERENCES public.payments (id),
  payer_name            text,
  currency              finance.currency_code NOT NULL,
  amount                finance.money NOT NULL CONSTRAINT planning_fee_amount_positive CHECK (amount > 0),
  received_on           date NOT NULL,
  -- The receipt number, or the provider's / payments module's reference.
  reference             text,
  voucher_id            uuid REFERENCES finance.voucher (id),
  prepared_at           timestamptz,
  prepared_by           uuid REFERENCES public.users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planning_fee_source_shape CHECK (
    (source = 'counter' AND cash_receipt_id IS NOT NULL AND payment_id IS NULL AND voucher_id IS NOT NULL)
    OR (source = 'online' AND payment_id IS NOT NULL AND cash_receipt_id IS NULL)),
  CONSTRAINT planning_fee_prepared_is_attributed CHECK (
    source = 'counter' OR (voucher_id IS NULL AND prepared_by IS NULL)
    OR (voucher_id IS NOT NULL AND prepared_by IS NOT NULL AND prepared_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_fee_receipt_kind
  ON finance.planning_fee (cash_receipt_id, fee_kind) WHERE cash_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_fee_payment
  ON finance.planning_fee (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planning_fee_application ON finance.planning_fee (permit_application_id);
CREATE INDEX IF NOT EXISTS idx_planning_fee_awaiting
  ON finance.planning_fee (authority_id, received_on) WHERE source = 'online' AND voucher_id IS NULL;
COMMENT ON TABLE finance.planning_fee IS
  'Every planning fee the council received, at the cash office or online, with the application it '
  'paid for and the voucher that carries it to the ledger (migration 246). Never deleted; an online '
  'fee gains its voucher once, or again only if that voucher was cancelled.';

-- Kept as it was taken: the only change a row accepts is an online fee gaining its voucher (or a
-- new one after its draft was cancelled).
CREATE OR REPLACE FUNCTION finance.refuse_planning_fee_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_old_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a planning fee is never deleted; it stays on the record' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['voucher_id', 'prepared_at', 'prepared_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['voucher_id', 'prepared_at', 'prepared_by']) THEN
    RAISE EXCEPTION 'a planning fee is kept as it was received and cannot be amended' USING ERRCODE = '23514';
  END IF;
  IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id THEN
    IF OLD.source <> 'online' THEN
      RAISE EXCEPTION 'a counter receipt''s voucher is its own and does not change' USING ERRCODE = '23514';
    END IF;
    IF OLD.voucher_id IS NOT NULL THEN
      SELECT status INTO v_old_status FROM finance.voucher WHERE id = OLD.voucher_id;
      IF v_old_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'this online fee already has a voucher (%); it is replaced only if that draft is cancelled', v_old_status
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_planning_fee_kept ON finance.planning_fee;
CREATE TRIGGER trg_planning_fee_kept
  BEFORE UPDATE OR DELETE ON finance.planning_fee
  FOR EACH ROW EXECUTE FUNCTION finance.refuse_planning_fee_change();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4. IS THE APPLICATION FEE PAID? ONE ANSWER, AND THE ONE WRITE INTO PLANNING
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Paid when a counter receipt for the application fee stands (not cancelled), or an online
-- application fee for it is paid (a row here, or a payment confirmed before this migration).
CREATE OR REPLACE FUNCTION finance.planning_application_fee_settled(p_application uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
           SELECT 1 FROM finance.planning_fee pf
             LEFT JOIN finance.cash_receipt cr ON cr.id = pf.cash_receipt_id
             LEFT JOIN public.payments p ON p.id = pf.payment_id
            WHERE pf.permit_application_id = p_application AND pf.fee_kind = 'application'
              AND ((pf.source = 'counter' AND cr.cancelled_at IS NULL)
                OR (pf.source = 'online' AND p.status = 'paid')))
      OR EXISTS (
           SELECT 1 FROM public.payments p
            WHERE p.purpose = 'application_fee' AND p.status = 'paid'
              AND p.related_kind IN ('permit', 'development_application')
              AND p.related_id = p_application::text)
$$;

CREATE OR REPLACE FUNCTION finance.sync_planning_application_fee_paid(p_application uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_settled boolean := finance.planning_application_fee_settled(p_application);
BEGIN
  UPDATE spatial_planning.permit_application
     SET fee_paid_at = CASE WHEN v_settled THEN COALESCE(fee_paid_at, now()) ELSE NULL END,
         status      = CASE WHEN v_settled AND status = 'pending_payment' THEN 'registered' ELSE status END,
         updated_at  = now()
   WHERE id = p_application
     AND (fee_paid_at IS NULL) = v_settled;   -- only when it changes
END $$;
COMMENT ON FUNCTION finance.sync_planning_application_fee_paid(uuid) IS
  'Sets or clears permit_application.fee_paid_at from the fees that stand (migration 246), and moves '
  'an application waiting for payment to registered, as the online payment route does. The only '
  'write Finance makes into a Planning table.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5. A PLANNING FEE TAKEN AT THE CASH OFFICE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance.record_planning_fee_receipt(
  p_session_id uuid, p_cashier_id uuid, p_permit_application_id uuid, p_payer_name text,
  p_currency finance.currency_code, p_method text, p_lines jsonb,
  p_deposit_account_id uuid DEFAULT NULL, p_party_id uuid DEFAULT NULL,
  p_method_reference text DEFAULT NULL, p_narration text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  a record; v_receipt uuid; v_authority integer; v_bad text;
BEGIN
  SELECT pa.id, pa.authority_id, COALESCE(pa.tpd_reference, pa.dev_register_no, 'stand ' || pa.stand_number) AS ref
    INTO a FROM spatial_planning.permit_application pa WHERE pa.id = p_permit_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the planning application is not in this council''s records' USING ERRCODE = '23503';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'a receipt is for at least one thing' USING ERRCODE = '23514';
  END IF;
  SELECT string_agg(COALESCE(i.code, x->>'income_code_id'), ', ') INTO v_bad
    FROM jsonb_array_elements(p_lines) x
    LEFT JOIN finance.income_code i ON i.id = (x->>'income_code_id')::uuid AND i.deleted_at IS NULL
   WHERE i.planning_fee_kind IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a planning fee receipt carries planning fees only; % is not one. Take other income on a receipt of its own', v_bad
      USING ERRCODE = '23514';
  END IF;

  v_receipt := finance.record_cash_receipt(
    p_session_id, p_cashier_id, p_payer_name, p_currency, p_method, p_lines,
    p_deposit_account_id, p_party_id, p_method_reference,
    COALESCE(NULLIF(btrim(p_narration), ''), 'Planning fee, ' || a.ref));

  SELECT authority_id INTO v_authority FROM finance.cash_receipt WHERE id = v_receipt;
  IF a.authority_id IS DISTINCT FROM v_authority THEN
    RAISE EXCEPTION 'the planning application is not in this council''s records' USING ERRCODE = '23503';
  END IF;

  INSERT INTO finance.planning_fee
    (authority_id, source, fee_kind, permit_application_id, cash_receipt_id, payer_name, currency,
     amount, received_on, reference, voucher_id)
  SELECT cr.authority_id, 'counter', i.planning_fee_kind, p_permit_application_id, cr.id, cr.payer_name,
         cr.currency, sum(l.amount), cr.received_on, cr.receipt_no, cr.voucher_id
    FROM finance.cash_receipt cr
    JOIN finance.cash_receipt_line l ON l.cash_receipt_id = cr.id
    JOIN finance.income_code i ON i.id = l.income_code_id
   WHERE cr.id = v_receipt
   GROUP BY cr.authority_id, i.planning_fee_kind, cr.id, cr.payer_name, cr.currency, cr.received_on,
            cr.receipt_no, cr.voucher_id;

  IF EXISTS (SELECT 1 FROM finance.planning_fee WHERE cash_receipt_id = v_receipt AND fee_kind = 'application') THEN
    PERFORM finance.sync_planning_application_fee_paid(p_permit_application_id);
  END IF;
  RETURN v_receipt;
END $$;
COMMENT ON FUNCTION finance.record_planning_fee_receipt(uuid, uuid, uuid, text, finance.currency_code, text, jsonb, uuid, uuid, text, text) IS
  'A planning fee receipted at the cash office (migration 246): finance.record_cash_receipt() with '
  'every control it has, every line a planning fee code, the application named, the fee linked, and '
  'an application fee marking the application paid. Posts nothing: the session''s verifier does.';

-- A cancelled receipt no longer pays the application fee, unless something else does.
CREATE OR REPLACE FUNCTION finance.planning_fee_receipt_cancelled() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT permit_application_id FROM finance.planning_fee
            WHERE cash_receipt_id = NEW.id AND fee_kind = 'application' AND permit_application_id IS NOT NULL
  LOOP
    PERFORM finance.sync_planning_application_fee_paid(r.permit_application_id);
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cash_receipt_planning_fee_cancelled ON finance.cash_receipt;
CREATE TRIGGER trg_cash_receipt_planning_fee_cancelled
  AFTER UPDATE OF cancelled_at ON finance.cash_receipt
  FOR EACH ROW WHEN (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION finance.planning_fee_receipt_cancelled();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 6. A PLANNING FEE PAID ONLINE: NOTED AT ONCE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Called by the payments route in the transaction that marks the payment paid. Returns the planning
-- fee row, or NULL for a payment that is not a planning fee (or not paid, or for nothing).
CREATE OR REPLACE FUNCTION finance.note_online_planning_fee(p_payment_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  p record; v_kind text; v_app uuid; v_authority integer; v_amount numeric; v_payer text; v_id uuid;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND OR p.status <> 'paid' THEN RETURN NULL; END IF;
  v_kind := CASE p.purpose
              WHEN 'application_fee' THEN 'application'
              WHEN 'inspection_fee' THEN 'inspection'
              WHEN 'occupation_certificate' THEN 'occupation'
              WHEN 'permit_fee' THEN 'other'
              WHEN 'property_search' THEN 'search'
            END;
  IF v_kind IS NULL THEN RETURN NULL; END IF;
  v_amount := CASE p.wallet_ccy WHEN 'ZWG' THEN p.amount_zwg ELSE p.amount_usd END;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN NULL; END IF;

  IF p.related_kind IN ('permit', 'development_application')
     AND p.related_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT pa.id, pa.authority_id, pa.applicant_name INTO v_app, v_authority, v_payer
      FROM spatial_planning.permit_application pa WHERE pa.id = p.related_id::uuid;
  END IF;
  v_authority := COALESCE(v_authority, app.authority_id(),
                          (SELECT id FROM public.local_authorities WHERE code = 'VUNGU'));

  INSERT INTO finance.planning_fee
    (authority_id, source, fee_kind, permit_application_id, payment_id, payer_name, currency, amount,
     received_on, reference)
  VALUES (v_authority, 'online', v_kind, v_app, p.id, COALESCE(v_payer, p.payer_email), p.wallet_ccy,
          round(v_amount, 2), (COALESCE(p.paid_at, now()) AT TIME ZONE 'Africa/Harare')::date,
          COALESCE(p.issued_receipt_no, p.provider_ref, p.id::text))
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM finance.planning_fee WHERE payment_id = p.id;
  END IF;
  RETURN v_id;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. "PREPARE VOUCHERS": A PERSON RAISES THE ONLINE FEES' DRAFTS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- For each online fee still without a voucher (or whose draft was cancelled): Dr the provider's bank
-- account, Cr the planning fee income code's account, a DRAFT prepared by p_by. Somebody else posts
-- it (203). A fee that cannot be prepared is left waiting and the reason is returned.
CREATE OR REPLACE FUNCTION finance.prepare_online_planning_fee_vouchers(p_by uuid, p_ids uuid[] DEFAULT NULL)
RETURNS TABLE (planning_fee_id uuid, outcome text, voucher_no text, reason text)
LANGUAGE plpgsql AS $$
DECLARE
  f record; ic record; ch record; y record; v_no text; v_voucher uuid;
  v_label text;
BEGIN
  -- First, any planning fee paid online that was not noted when it was confirmed (the payments route
  -- notes it behind a savepoint, so a confirmation never fails on the books' account).
  PERFORM finance.note_online_planning_fee(p.id)
     FROM public.payments p
    WHERE p.status = 'paid'
      AND p.purpose IN ('application_fee', 'inspection_fee', 'occupation_certificate', 'permit_fee', 'property_search')
      AND NOT EXISTS (SELECT 1 FROM finance.planning_fee pf WHERE pf.payment_id = p.id);

  FOR f IN
    SELECT pf.*, p.driver
      FROM finance.planning_fee pf
      JOIN public.payments p ON p.id = pf.payment_id
      LEFT JOIN finance.voucher v ON v.id = pf.voucher_id
     WHERE pf.source = 'online' AND (pf.voucher_id IS NULL OR v.status = 'cancelled')
       AND (p_ids IS NULL OR pf.id = ANY (p_ids))
     ORDER BY pf.received_on, pf.created_at
       FOR UPDATE OF pf
  LOOP
    planning_fee_id := f.id; voucher_no := NULL; reason := NULL;
    v_label := replace(f.fee_kind, '_', ' ');

    SELECT i.id, i.code, i.name, i.ledger_account_id, i.department_id INTO ic
      FROM finance.income_code i
     WHERE i.authority_id = f.authority_id AND i.planning_fee_kind = f.fee_kind
       AND i.status = 'active' AND i.deleted_at IS NULL;
    IF NOT FOUND THEN
      outcome := 'waiting';
      reason := format('No income code in use is marked as the planning fee "%s". Mark one in the cash office set-up.', v_label);
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT c.bank_account_id, c.name INTO ch
      FROM finance.payment_channel c
     WHERE c.authority_id = f.authority_id AND c.driver = f.driver AND c.status = 'active' AND c.deleted_at IS NULL;
    IF NOT FOUND THEN
      outcome := 'waiting';
      reason := format('No bank account is set for online payments through %s. Set one under payment channels.', f.driver);
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT fy.id INTO y FROM finance.financial_year fy
     WHERE fy.authority_id = f.authority_id AND fy.status = 'open' AND fy.deleted_at IS NULL
       AND f.received_on BETWEEN fy.start_date AND fy.end_date;
    IF NOT FOUND THEN
      outcome := 'waiting';
      reason := format('No open financial year contains %s, the day it was paid.', to_char(f.received_on, 'DD Mon YYYY'));
      RETURN NEXT; CONTINUE;
    END IF;

    v_no := finance.next_document_no(f.authority_id, 'receipt');
    INSERT INTO finance.voucher
      (authority_id, voucher_no, voucher_type, currency, financial_year_id, posting_date,
       narration, reference, status, prepared_by)
    VALUES (f.authority_id, v_no, 'receipt', f.currency, y.id, f.received_on,
            format('Online planning fee (%s), %s', v_label, COALESCE(f.payer_name, 'payer not named')),
            f.reference, 'draft', p_by)
    RETURNING id INTO v_voucher;
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, narration)
    VALUES (f.authority_id, v_voucher, 1, ch.bank_account_id, f.amount, 0,
            format('Paid online through %s, %s', ch.name, f.reference));
    INSERT INTO finance.voucher_line (authority_id, voucher_id, line_no, ledger_account_id, debit, credit, department_id, narration)
    VALUES (f.authority_id, v_voucher, 2, ic.ledger_account_id, 0, f.amount, ic.department_id, ic.name);

    UPDATE finance.planning_fee SET voucher_id = v_voucher, prepared_at = now(), prepared_by = p_by WHERE id = f.id;
    outcome := 'prepared'; voucher_no := v_no;
    RETURN NEXT;
  END LOOP;
END $$;
COMMENT ON FUNCTION finance.prepare_online_planning_fee_vouchers(uuid, uuid[]) IS
  'Raises a DRAFT voucher, prepared by p_by, for each online planning fee still waiting (migration '
  '246): Dr the provider''s bank account / Cr the planning fee income code. Posts nothing; a fee '
  'that cannot be prepared stays waiting, with the reason returned.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 8. THE LIST
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS finance.v_planning_fee;
CREATE VIEW finance.v_planning_fee WITH (security_invoker = true) AS
SELECT pf.id, pf.authority_id, pf.source, pf.fee_kind, pf.permit_application_id,
       pa.tpd_reference, pa.dev_register_no, pa.stand_number, pa.applicant_name,
       pf.payer_name, pf.currency, pf.amount, pf.received_on, pf.reference,
       pf.cash_receipt_id, cr.receipt_no, cr.method, cr.cancelled_at AS receipt_cancelled_at,
       pf.payment_id, p.driver, p.status AS payment_status,
       pf.voucher_id, v.voucher_no, v.status AS voucher_status, v.posted_at,
       pf.prepared_at, pf.prepared_by,
       CASE WHEN cr.cancelled_at IS NOT NULL                    THEN 'cancelled'
            WHEN pf.voucher_id IS NULL OR v.status = 'cancelled' THEN 'awaiting_voucher'
            WHEN v.status = 'draft'                              THEN 'awaiting_posting'
            WHEN v.status = 'posted'                             THEN 'posted'
            ELSE v.status END AS state,
       pf.created_at
  FROM finance.planning_fee pf
  LEFT JOIN spatial_planning.permit_application pa ON pa.id = pf.permit_application_id
  LEFT JOIN finance.cash_receipt cr ON cr.id = pf.cash_receipt_id
  LEFT JOIN public.payments p ON p.id = pf.payment_id
  LEFT JOIN finance.voucher v ON v.id = pf.voucher_id;
COMMENT ON VIEW finance.v_planning_fee IS
  'Every planning fee with its application, receipt or payment, voucher and state: awaiting_voucher '
  '(online, not yet prepared), awaiting_posting (a draft: a cash-up to verify, or a voucher to post), '
  'posted, cancelled (migration 246).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 9. TENANCY, GRANTS, PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    RAISE NOTICE 'no VUNGU authority here: the planning fee tables stay pending until converted by hand';
    FOREACH r IN ARRAY ARRAY['finance.payment_channel', 'finance.planning_fee'] LOOP
      PERFORM tenancy.classify(r, 'pending', 'planning fee data awaiting the authority it belongs to');
    END LOOP;
    RETURN;
  END IF;
  FOREACH r IN ARRAY ARRAY['finance.payment_channel', 'finance.planning_fee'] LOOP
    PERFORM tenancy.make_tenant(r::regclass, 'VUNGU');
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT ON finance.v_planning_fee TO vungu_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
    GRANT SELECT, INSERT ON finance.planning_fee TO vungu_system;
    GRANT SELECT ON finance.v_planning_fee TO vungu_system;
  END IF;
  PERFORM tenancy.classify('finance.v_planning_fee', 'tenant_view',
    'runs as the caller (security_invoker); the underlying policies decide the rows');
END $$;

INSERT INTO finance.permission (code, label, category, is_approval, is_publication, is_restricted, description) VALUES
  ('finance.planning_fees.view', 'View planning fees and their vouchers', 'revenue', false, false, false,
   'See every planning fee received at the cash office or online, the application it paid for and '
   'where its voucher stands. Read only.'),
  ('finance.planning_fees.prepare', 'Prepare vouchers for online planning fees', 'revenue', false, false, false,
   'Raise the draft vouchers for online planning fees. Posting them is a separate permission, held '
   'by somebody else.')
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, is_approval = EXCLUDED.is_approval,
      is_publication = EXCLUDED.is_publication, is_restricted = EXCLUDED.is_restricted,
      description = EXCLUDED.description;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.planning_fees.view'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'accountant', 'accounting_officer', 'revenue_officer',
                    'cashier', 'cash_supervisor', 'auditor', 'budget_officer', 'admin']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

INSERT INTO finance.role_permission (role_name, permission_code)
SELECT r, 'finance.planning_fees.prepare'
  FROM unnest(ARRAY['finance_admin', 'finance_officer', 'accountant', 'revenue_officer']) AS r
ON CONFLICT (role_name, permission_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 10. ONLINE FEES ALREADY PAID
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Planning fees paid online before this migration are noted now, so the revenue officer can raise
-- their vouchers. Counter receipts in the old clerk register are not converted: they were never
-- counted in a cashier session, so they stay in that register as its history.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id FROM public.payments
            WHERE status = 'paid'
              AND purpose IN ('application_fee', 'inspection_fee', 'occupation_certificate', 'permit_fee', 'property_search')
  LOOP
    PERFORM finance.note_online_planning_fee(p.id);
  END LOOP;
END $$;
