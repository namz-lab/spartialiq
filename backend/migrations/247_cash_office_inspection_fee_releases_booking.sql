-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 247 — AN INSPECTION FEE PAID AT THE CASH OFFICE RELEASES THE INSPECTION BOOKING
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/247_cash_office_inspection_fee_releases_booking.down.sql
--
-- WHAT WAS WRONG
-- Since 246 an inspection fee is receipted at the cash office against the planning application, and
-- it reaches the ledger. But the stage inspection the applicant booked stayed "pending payment": only
-- an online payment (payments.js, purpose inspection_fee) moved a booking to "waitlisted", where the
-- inspector can schedule it. The team guide had to tell inspectors to check the clerk's Fees page.
--
-- WHAT THIS DOES
-- Each STAGE paid for at the cash office (the quantity on the inspection-fee lines of a receipt that
-- names the application, e.g. CASH-BIN at US$25 a stage) releases one booking of that application
-- that is waiting for payment, lowest stage first: status pending_payment -> waitlisted, fee_paid_at
-- set, an inspection_status_events row naming the receipt. It works in either order: a booking made
-- AFTER the fee was paid is released the moment it is made, while paid stages are left over.
-- Cancelling the receipt puts the bookings it released back to "pending payment", unless an inspector
-- has already moved them on (scheduled, inspected): those are left as they are and the cancellation
-- is recorded on them as a note, because undoing an inspection that happened is not the cash
-- office's to do.
--
-- WHICH BOOKINGS ARE THE APPLICATION'S
-- inspection_bookings.application_id is text (063), and the records hold it in more than one form: a
-- development_applications id, a TPD reference, a register number, or the planning application's id.
-- A booking is the application's when its application_id is any of the application's identifiers.
--
-- finance.planning_fee_booking keeps which receipt released which booking, so the count of paid
-- stages and the cancellation are exact. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET search_path = finance, public;

CREATE TABLE IF NOT EXISTS finance.planning_fee_booking (
  booking_id      uuid PRIMARY KEY REFERENCES public.inspection_bookings (id) ON DELETE CASCADE,
  planning_fee_id uuid NOT NULL REFERENCES finance.planning_fee (id),
  authority_id    integer NOT NULL REFERENCES public.local_authorities (id),
  released_at     timestamptz NOT NULL DEFAULT now(),
  released_by     uuid REFERENCES public.users (id)
);
CREATE INDEX IF NOT EXISTS idx_planning_fee_booking_fee ON finance.planning_fee_booking (planning_fee_id);
COMMENT ON TABLE finance.planning_fee_booking IS
  'Which cash-office inspection fee released which inspection booking (migration 247): one paid stage, '
  'one booking. Removed only when the receipt is cancelled and the booking is put back to pending payment.';

-- The bookings that are this application's, by any identifier it is recorded under.
CREATE OR REPLACE FUNCTION finance.application_booking_keys(p_application uuid)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[pa.id::text, pa.tpd_reference, pa.dev_register_no, pa.dev_app_id::text], NULL)
    FROM spatial_planning.permit_application pa WHERE pa.id = p_application
$$;

-- Release as many waiting bookings as there are paid, unused stages. SECURITY DEFINER because it is
-- also reached from a citizen's booking (the trigger below), whose session cannot read the finance
-- tables; every row it touches is named by the application and its own council.
CREATE OR REPLACE FUNCTION finance.release_paid_inspections(p_application uuid, p_by uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE
  v_keys text[] := finance.application_booking_keys(p_application);
  v_authority integer;
  f record; b record; v_released integer := 0; v_free numeric;
BEGIN
  IF v_keys IS NULL OR array_length(v_keys, 1) IS NULL THEN RETURN 0; END IF;
  SELECT authority_id INTO v_authority FROM spatial_planning.permit_application WHERE id = p_application;

  FOR f IN
    -- Each standing counter inspection fee of the application, with its stages paid and used.
    SELECT pf.id, cr.receipt_no,
           (SELECT COALESCE(sum(l.quantity), 0) FROM finance.cash_receipt_line l
              JOIN finance.income_code i ON i.id = l.income_code_id
             WHERE l.cash_receipt_id = pf.cash_receipt_id AND i.planning_fee_kind = 'inspection') AS stages,
           (SELECT count(*) FROM finance.planning_fee_booking x WHERE x.planning_fee_id = pf.id) AS used
      FROM finance.planning_fee pf
      JOIN finance.cash_receipt cr ON cr.id = pf.cash_receipt_id
     WHERE pf.permit_application_id = p_application AND pf.source = 'counter'
       AND pf.fee_kind = 'inspection' AND cr.cancelled_at IS NULL
     ORDER BY pf.received_on, pf.created_at
  LOOP
    v_free := floor(f.stages) - f.used;
    CONTINUE WHEN v_free <= 0;
    FOR b IN
      SELECT ib.id, ib.stage_number FROM public.inspection_bookings ib
       WHERE ib.application_id = ANY (v_keys) AND ib.status = 'pending_payment'
         AND NOT EXISTS (SELECT 1 FROM finance.planning_fee_booking x WHERE x.booking_id = ib.id)
       ORDER BY ib.stage_number
       LIMIT v_free
       FOR UPDATE OF ib
    LOOP
      UPDATE public.inspection_bookings
         SET status = 'waitlisted', fee_paid_at = COALESCE(fee_paid_at, now()), updated_at = now()
       WHERE id = b.id;
      INSERT INTO public.inspection_status_events (booking_id, from_status, to_status, actor_id, actor_role, notes)
      VALUES (b.id, 'pending_payment', 'waitlisted', p_by, 'cashier',
              format('Fee paid at the cash office, receipt %s', f.receipt_no));
      INSERT INTO finance.planning_fee_booking (booking_id, planning_fee_id, authority_id, released_by)
      VALUES (b.id, f.id, v_authority, p_by);
      v_released := v_released + 1;
    END LOOP;
  END LOOP;
  RETURN v_released;
END $$;
COMMENT ON FUNCTION finance.release_paid_inspections(uuid, uuid) IS
  'Releases one waiting inspection booking of the application per stage paid at the cash office and '
  'not yet used, lowest stage first: pending_payment -> waitlisted (migration 247).';

-- ── The counter receipt releases at once (246's function, with one line added) ────────────────
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
  -- 247: an inspection fee releases the stages it paid for.
  IF EXISTS (SELECT 1 FROM finance.planning_fee WHERE cash_receipt_id = v_receipt AND fee_kind = 'inspection') THEN
    PERFORM finance.release_paid_inspections(p_permit_application_id, p_cashier_id);
  END IF;
  RETURN v_receipt;
END $$;

-- ── A booking made after the fee was paid is released when it is made ────────────────────────
CREATE OR REPLACE FUNCTION finance.inspection_booking_released_if_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE v_app uuid;
BEGIN
  IF NEW.status <> 'pending_payment' THEN RETURN NULL; END IF;
  SELECT pa.id INTO v_app FROM spatial_planning.permit_application pa
   WHERE NEW.application_id IN (pa.id::text, pa.tpd_reference, pa.dev_register_no, pa.dev_app_id::text)
   LIMIT 1;
  IF v_app IS NOT NULL THEN PERFORM finance.release_paid_inspections(v_app, NULL); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_inspection_booking_released_if_paid ON public.inspection_bookings;
CREATE TRIGGER trg_inspection_booking_released_if_paid
  AFTER INSERT ON public.inspection_bookings
  FOR EACH ROW EXECUTE FUNCTION finance.inspection_booking_released_if_paid();

-- ── Cancelling the receipt (246's trigger function, extended) ─────────────────────────────────
CREATE OR REPLACE FUNCTION finance.planning_fee_receipt_cancelled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = finance, public, pg_temp AS $$
DECLARE r record; b record;
BEGIN
  FOR r IN SELECT DISTINCT permit_application_id FROM finance.planning_fee
            WHERE cash_receipt_id = NEW.id AND fee_kind = 'application' AND permit_application_id IS NOT NULL
  LOOP
    PERFORM finance.sync_planning_application_fee_paid(r.permit_application_id);
  END LOOP;

  -- 247: the bookings this receipt released. Back to pending payment if nothing has happened to them
  -- since; left as they are, with a note, if an inspector has already moved them on.
  FOR b IN
    SELECT x.booking_id, ib.status, pf.permit_application_id
      FROM finance.planning_fee_booking x
      JOIN finance.planning_fee pf ON pf.id = x.planning_fee_id
      JOIN public.inspection_bookings ib ON ib.id = x.booking_id
     WHERE pf.cash_receipt_id = NEW.id
       FOR UPDATE OF ib
  LOOP
    IF b.status = 'waitlisted' THEN
      UPDATE public.inspection_bookings SET status = 'pending_payment', fee_paid_at = NULL, updated_at = now()
       WHERE id = b.booking_id;
      INSERT INTO public.inspection_status_events (booking_id, from_status, to_status, actor_id, actor_role, notes)
      VALUES (b.booking_id, 'waitlisted', 'pending_payment', NEW.cancelled_by, 'cashier',
              format('Receipt %s cancelled: %s', NEW.receipt_no, NEW.cancel_reason));
      DELETE FROM finance.planning_fee_booking WHERE booking_id = b.booking_id;
    ELSE
      INSERT INTO public.inspection_status_events (booking_id, from_status, to_status, actor_id, actor_role, notes)
      VALUES (b.booking_id, b.status, b.status, NEW.cancelled_by, 'cashier',
              format('Receipt %s that paid for this stage was cancelled (%s); the booking had already moved on and was left as it is', NEW.receipt_no, NEW.cancel_reason));
    END IF;
  END LOOP;

  -- Another standing receipt may cover the stages put back.
  FOR r IN SELECT DISTINCT permit_application_id FROM finance.planning_fee
            WHERE cash_receipt_id = NEW.id AND fee_kind = 'inspection' AND permit_application_id IS NOT NULL
  LOOP
    PERFORM finance.release_paid_inspections(r.permit_application_id, NEW.cancelled_by);
  END LOOP;
  RETURN NEW;
END $$;

-- ── Tenancy, grants ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') THEN
    PERFORM tenancy.make_tenant('finance.planning_fee_booking'::regclass, 'VUNGU');
  ELSE
    PERFORM tenancy.classify('finance.planning_fee_booking', 'pending', 'awaiting the authority it belongs to');
  END IF;
END $$;

-- ── Fees already receipted at the cash office: release what they paid for ─────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT permit_application_id FROM finance.planning_fee
            WHERE source = 'counter' AND fee_kind = 'inspection' AND permit_application_id IS NOT NULL
  LOOP
    PERFORM finance.release_paid_inspections(r.permit_application_id, NULL);
  END LOOP;
END $$;
