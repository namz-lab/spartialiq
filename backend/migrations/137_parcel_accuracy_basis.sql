-- 137: a parcel records how its position was arrived at, separately from whether the Surveyor-General approved it (sg_ref,
-- general_plan_id) and where the record came from (origin).
--
-- Restored: the original 137 file was never committed, so a fresh database failed at 174, which fills this column. Idempotent, so
-- databases that already had it are unchanged.

ALTER TABLE land.parcel ADD COLUMN IF NOT EXISTS accuracy_basis text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcel_accuracy_basis_check' AND conrelid = 'land.parcel'::regclass) THEN
    ALTER TABLE land.parcel ADD CONSTRAINT parcel_accuracy_basis_check
      CHECK (accuracy_basis IS NULL OR accuracy_basis IN ('surveyed', 'general_plan', 'map_digitised', 'estimated', 'unknown'));
  END IF;
END $$;
COMMENT ON COLUMN land.parcel.accuracy_basis IS
  'How the position was arrived at: surveyed | general_plan | map_digitised | estimated | unknown. Not approval (sg_ref, general_plan_id) and not source (origin).';
