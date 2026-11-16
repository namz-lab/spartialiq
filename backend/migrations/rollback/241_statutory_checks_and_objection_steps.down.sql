-- Rollback of 241. Drops the statutory-check answers, the referral category and the objection steps; what was recorded in them is lost.
ALTER TABLE spatial_planning.application_objection
  DROP COLUMN IF EXISTS put_to_applicant_on, DROP COLUMN IF EXISTS applicant_comment, DROP COLUMN IF EXISTS applicant_commented_on;
ALTER TABLE spatial_planning.case_referral DROP CONSTRAINT IF EXISTS case_referral_statutory_key_check, DROP COLUMN IF EXISTS statutory_key;
ALTER TABLE spatial_planning.permit_application
  DROP COLUMN IF EXISTS statutory_checks, DROP COLUMN IF EXISTS statutory_checks_at, DROP COLUMN IF EXISTS statutory_checks_by;
