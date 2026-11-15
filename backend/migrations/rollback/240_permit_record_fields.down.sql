-- Rollback of 240. Drops the permit's own fields; what was saved in them is lost.
DROP INDEX IF EXISTS spatial_planning.uq_permit_no_per_authority;
ALTER TABLE spatial_planning.permit_application
  DROP CONSTRAINT IF EXISTS permit_use_class_check,
  DROP CONSTRAINT IF EXISTS permit_implementation_period_check,
  DROP CONSTRAINT IF EXISTS permit_decision_basis_check,
  DROP COLUMN IF EXISTS permit_no, DROP COLUMN IF EXISTS use_class, DROP COLUMN IF EXISTS permitted_description,
  DROP COLUMN IF EXISTS implementation_period_months, DROP COLUMN IF EXISTS annexure7_notes,
  DROP COLUMN IF EXISTS notification_date, DROP COLUMN IF EXISTS decision_basis;
