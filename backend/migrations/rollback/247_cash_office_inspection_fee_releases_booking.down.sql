-- Rollback of 247_cash_office_inspection_fee_releases_booking.sql.
-- Bookings already released stay released (they were paid for); only the automatic release goes.
DROP TRIGGER IF EXISTS trg_inspection_booking_released_if_paid ON public.inspection_bookings;
DROP FUNCTION IF EXISTS finance.inspection_booking_released_if_paid();

-- 246's cancellation trigger function, as it was.
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

-- 246's counter receipt, as it was (without the release). Re-apply 246 to restore it exactly:
-- psql -1 -f migrations/246_planning_fees_in_the_ledger.sql (idempotent).
DROP FUNCTION IF EXISTS finance.release_paid_inspections(uuid, uuid);
DROP FUNCTION IF EXISTS finance.application_booking_keys(uuid);
DROP TABLE IF EXISTS finance.planning_fee_booking;
DELETE FROM schema_migrations WHERE filename = '247_cash_office_inspection_fee_releases_booking.sql';
