-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 240 — THE PERMIT'S OWN FIELDS ARE THE COUNCIL'S RECORD, NOT THE BROWSER'S
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/240_permit_record_fields.down.sql.
-- Depends on: 070 (permit_application), 239 (delegation_basis).
--
-- The permit drafting screen said so itself: "the permit number, use class, permitted development, commencement period, decision authority and
-- Annexure 7 notes are held in this browser only ... they will not appear on another machine". A permit is a statutory record; it cannot live on one
-- officer's machine. These columns give those fields a home, and the case route (PATCH /permit-applications/:id/case) saves them.
--
--   permit_no                      the permit's number; unique within an authority, so two permits never share one
--   use_class                      the class of use the permit authorises (I to VI)
--   permitted_description          what the permit permits, in words
--   implementation_period_months   how long the applicant has to start (the permit lapses after it)
--   annexure7_notes                the officer's own notes for Annexure 7 (the statutory clauses are derived from the rule set, never stored)
--   notification_date              when the applicant was formally notified; the appeal window (s.38) runs from it
--   decision_basis                 what the decision rested on: committee_resolution, delegation or admin_override. It is SET by the server
--                                  when the decision is made; "decision authority" is no longer typed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS permit_no                    text,
  ADD COLUMN IF NOT EXISTS use_class                    text,
  ADD COLUMN IF NOT EXISTS permitted_description        text,
  ADD COLUMN IF NOT EXISTS implementation_period_months integer,
  ADD COLUMN IF NOT EXISTS annexure7_notes              text,
  ADD COLUMN IF NOT EXISTS notification_date            date,
  ADD COLUMN IF NOT EXISTS decision_basis               text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_use_class_check') THEN
    ALTER TABLE spatial_planning.permit_application
      ADD CONSTRAINT permit_use_class_check CHECK (use_class IS NULL OR use_class IN ('I', 'II', 'III', 'IV', 'V', 'VI'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_implementation_period_check') THEN
    ALTER TABLE spatial_planning.permit_application
      ADD CONSTRAINT permit_implementation_period_check CHECK (implementation_period_months IS NULL OR implementation_period_months BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permit_decision_basis_check') THEN
    ALTER TABLE spatial_planning.permit_application
      ADD CONSTRAINT permit_decision_basis_check CHECK (decision_basis IS NULL OR decision_basis IN ('committee_resolution', 'delegation', 'admin_override'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_permit_no_per_authority
  ON spatial_planning.permit_application (authority_id, permit_no) WHERE permit_no IS NOT NULL;

COMMENT ON COLUMN spatial_planning.permit_application.permit_no IS 'The permit''s number. Unique within the authority.';
COMMENT ON COLUMN spatial_planning.permit_application.decision_basis IS
  'What the decision rested on, set by the server when it is made: committee_resolution, delegation (delegation_basis says which) or admin_override.';
