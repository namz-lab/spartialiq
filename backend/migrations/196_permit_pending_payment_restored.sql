-- 196: restore 'pending_payment' to the permit application status CHECK.
--
-- Migration 085 added 'awaiting_eo_decision' and rebuilt the constraint from its own list —
-- a list that no longer carried 'pending_payment', which 077 had added for the online
-- application-fee flow (a permit is created pending_payment, the citizen pays, the payment
-- webhook flips it to registered and stamps fee_paid_at).
--
-- Since 085, every database built from the chain has refused that insert: a citizen paying
-- the application fee online got a 500, and the two payment suites have failed ever since.
-- The status is alive throughout the routes (development-applications, payments,
-- development-management, planning-clerk, inspections) and in the permit lifecycle table
-- (078/081 list it). This restores it alongside every status 085 kept, and adds a guard test
-- comment in scripts/migrate.test.js's pinned list.
--
-- Idempotent: re-adds the constraint with the full set either way.

BEGIN;

ALTER TABLE spatial_planning.permit_application
  DROP CONSTRAINT IF EXISTS permit_application_status_check;

ALTER TABLE spatial_planning.permit_application
  ADD CONSTRAINT permit_application_status_check CHECK (status IN (
    'pending_payment',
    'registered',
    'acknowledged',
    'circulation',
    'objection_period',
    'under_review',
    'awaiting_eo_decision',
    'deferred',
    'approved',
    'approved_with_conditions',
    'refused',
    'withdrawn',
    'appealed'
  ));

COMMIT;
