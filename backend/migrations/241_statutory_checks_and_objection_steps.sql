-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 241 — THE STATUTORY CHECKS ON A CASE, AND THE OBJECTION STEPS
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/241_statutory_checks_and_objection_steps.down.sql.
-- Depends on: 239 (case_referral), 089 (public_notice), 070 (application_objection).
-- Read with: docs/workflows/eo-planning-working-workflow.md, sections 4 and 5 (steps 3, 8 and 9).
--
--   permit_application.statutory_checks   the EO's answers to the questions the Act makes the council ask of every application. The software cannot
--                                         know whether a site is within 200 m of a State road or in an aerodrome's obstacle limitation area, so a
--                                         person answers; a decision waits until every question has an answer (yes or no), and each "yes" that
--                                         needs another body has a referral on the log.
--       road_within_200m             s.26(2)(c), s.40(2)(c)  the minister responsible for roads
--       aviation_olz                 s.26(2)(c), s.40(2)(c)  the minister responsible for aviation
--       neighbouring_authority       s.26(4)(b)              the adjoining planning authority
--       agricultural_subdivision     s.40(5)(a)(i)           the minister responsible for agriculture (asked of subdivisions)
--       title_condition_conflict     s.26(3), s.26(9)        public notice; a copy to the Registrar of Deeds
--       adverse_or_nonconforming     s.26(3)                 public notice
--   case_referral.statutory_key          which of those a referral answers (road, aviation, neighbouring, agriculture, registrar, surveyor_general)
--   application_objection                the objector's objection is put to the applicant, who has 14 days to comment (working workflow, step 9)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE spatial_planning.permit_application
  ADD COLUMN IF NOT EXISTS statutory_checks    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS statutory_checks_at timestamptz,
  ADD COLUMN IF NOT EXISTS statutory_checks_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN spatial_planning.permit_application.statutory_checks IS
  'The EO''s yes/no answers to the questions the Act makes the council ask of every application (road, aviation, neighbouring authority, agricultural subdivision, title-condition conflict, adverse or non-conforming use). A missing key is unanswered, which blocks a decision.';

ALTER TABLE spatial_planning.case_referral
  ADD COLUMN IF NOT EXISTS statutory_key text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_referral_statutory_key_check') THEN
    ALTER TABLE spatial_planning.case_referral
      ADD CONSTRAINT case_referral_statutory_key_check
      CHECK (statutory_key IS NULL OR statutory_key IN ('road', 'aviation', 'neighbouring', 'agriculture', 'registrar', 'surveyor_general'));
  END IF;
END $$;

ALTER TABLE spatial_planning.application_objection
  ADD COLUMN IF NOT EXISTS put_to_applicant_on   date,
  ADD COLUMN IF NOT EXISTS applicant_comment     text,
  ADD COLUMN IF NOT EXISTS applicant_commented_on date;

COMMENT ON COLUMN spatial_planning.application_objection.put_to_applicant_on IS
  'The day the objection was put to the applicant. The applicant has 14 days from it to comment; a decision waits for the comment or the end of the 14 days.';
