-- Rollback of 232. Restores the 150/139 definitions of set_plan_status, sign_off_plan, new_plan_version, plan_content_hash and compute_parcel_zoning from migrations 231/150.
-- Revision shapes already copied stay (they are ordinary zone rows); adoption data is dropped.
DROP TRIGGER IF EXISTS trg_zz_freeze_zones ON spatial_planning.zone;
DROP FUNCTION IF EXISTS spatial_planning.zone_freeze_guard();
DROP FUNCTION IF EXISTS public.plan_revision_changes(uuid, uuid);
DROP FUNCTION IF EXISTS public.record_ministerial_approval(uuid, text, date, text, uuid, text);
DROP FUNCTION IF EXISTS public.record_council_adoption(uuid, date, text, uuid, text);
DROP FUNCTION IF EXISTS public.set_plan_identity(uuid, text, date, integer, uuid, text);
DROP FUNCTION IF EXISTS public.plan_signoffs_missing(uuid);
-- Re-run migrations 150 and 231 definitions for set_plan_status / sign_off_plan(5 args) / plan_content_hash / compute_parcel_zoning / new_plan_version after dropping plan_governs.
ALTER TABLE public.plan_signoff DROP COLUMN IF EXISTS signatory_role;
DROP TABLE IF EXISTS public.plan_signatory_role;
ALTER TABLE public.plan_instrument
  DROP COLUMN IF EXISTS revision_label, DROP COLUMN IF EXISTS revision_date, DROP COLUMN IF EXISTS map_scale,
  DROP COLUMN IF EXISTS council_adopted_on, DROP COLUMN IF EXISTS council_resolution_ref,
  DROP COLUMN IF EXISTS ministerial_approval_no, DROP COLUMN IF EXISTS ministerial_approved_on, DROP COLUMN IF EXISTS ministerial_approved_by;
