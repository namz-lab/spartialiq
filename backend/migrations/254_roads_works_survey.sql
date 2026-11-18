-- 254: the Department of Roads and Works records what its field survey finds.
--
-- Migration 252 issued the survey sheets (docs/manuals/roads-works-field-survey.md), but the registers had no way to take
-- the answers back: no route updated a road, a water point or a council building, and nothing held bridges or culverts
-- except an empty table. This migration gives each register the fields the sheets ask for, fixes the words allowed in
-- them, and keeps a log of every survey entry.
--
--   council_ops.road_asset       + width_m, drainage, surveyed_on; surface and condition limited to the survey's words
--   council_ops.road_structure   + span_m, surveyed_on; condition limited to the same words as a road
--   council_ops.wash_asset       + pump_type, yield_note, last_repaired_on, caretaker, surveyed_on
--   council_ops.council_asset    + surveyed_on; condition limited to good / fair / poor / very_poor
--   council_ops.survey_record    who recorded what, on which record, when, and what it was before (a tenant table)
--
-- A road surveyed for both surface and condition is no longer "unverified": the route marks it "verified" (an
-- authoritative record stays authoritative). The words:
--   surface    earth, gravel, bitumen, concrete, paving
--   condition  good, fair, poor, very_poor, impassable  (a building: good, fair, poor, very_poor)
--   drainage   none, side_drains, lined_drains, blocked
--   pump_type  hand_pump, motorised, solar, none
-- A value already in a register that is not one of these words stops the migration rather than being changed.
--
-- Also: the ward measures owned by the department carried its old name, "Engineering and Works"; they now say
-- "Roads and Works" (migration 251 renamed the department). Idempotent.

-- ── Roads ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE council_ops.road_asset
  ADD COLUMN IF NOT EXISTS width_m      numeric(6,2) CHECK (width_m IS NULL OR (width_m > 0 AND width_m <= 100)),
  ADD COLUMN IF NOT EXISTS drainage     varchar(20),
  ADD COLUMN IF NOT EXISTS surveyed_on  date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'road_asset_surface_words') THEN
    ALTER TABLE council_ops.road_asset ADD CONSTRAINT road_asset_surface_words
      CHECK (surface IS NULL OR surface IN ('earth', 'gravel', 'bitumen', 'concrete', 'paving'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'road_asset_condition_words') THEN
    ALTER TABLE council_ops.road_asset ADD CONSTRAINT road_asset_condition_words
      CHECK (condition IS NULL OR condition IN ('good', 'fair', 'poor', 'very_poor', 'impassable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'road_asset_drainage_words') THEN
    ALTER TABLE council_ops.road_asset ADD CONSTRAINT road_asset_drainage_words
      CHECK (drainage IS NULL OR drainage IN ('none', 'side_drains', 'lined_drains', 'blocked'));
  END IF;
END $$;

-- ── Bridges, culverts and drifts ─────────────────────────────────────────────────────────
ALTER TABLE council_ops.road_structure
  ADD COLUMN IF NOT EXISTS span_m       numeric(7,2) CHECK (span_m IS NULL OR (span_m > 0 AND span_m <= 1000)),
  ADD COLUMN IF NOT EXISTS surveyed_on  date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'road_structure_condition_words') THEN
    ALTER TABLE council_ops.road_structure ADD CONSTRAINT road_structure_condition_words
      CHECK (condition IS NULL OR condition IN ('good', 'fair', 'poor', 'very_poor', 'impassable'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_road_structure_ward ON council_ops.road_structure;
CREATE TRIGGER trg_road_structure_ward BEFORE INSERT OR UPDATE OF geom ON council_ops.road_structure
  FOR EACH ROW EXECUTE FUNCTION council_ops.fill_ward();

-- ── Water points ─────────────────────────────────────────────────────────────────────────
ALTER TABLE council_ops.wash_asset
  ADD COLUMN IF NOT EXISTS pump_type         varchar(20),
  ADD COLUMN IF NOT EXISTS yield_note        text,
  ADD COLUMN IF NOT EXISTS last_repaired_on  date,
  ADD COLUMN IF NOT EXISTS caretaker         text,
  ADD COLUMN IF NOT EXISTS surveyed_on       date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wash_asset_pump_words') THEN
    ALTER TABLE council_ops.wash_asset ADD CONSTRAINT wash_asset_pump_words
      CHECK (pump_type IS NULL OR pump_type IN ('hand_pump', 'motorised', 'solar', 'none'));
  END IF;
END $$;

-- ── Council buildings and assets ─────────────────────────────────────────────────────────
ALTER TABLE council_ops.council_asset ADD COLUMN IF NOT EXISTS surveyed_on date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'council_asset_condition_words') THEN
    ALTER TABLE council_ops.council_asset ADD CONSTRAINT council_asset_condition_words
      CHECK (condition IS NULL OR condition IN ('good', 'fair', 'poor', 'very_poor'));
  END IF;
END $$;

-- ── The survey log ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS council_ops.survey_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register       varchar(20) NOT NULL CHECK (register IN ('road', 'structure', 'water_point', 'council_asset')),
  record_id      uuid NOT NULL,
  surveyed_on    date NOT NULL CHECK (surveyed_on <= current_date + 1),
  before         jsonb NOT NULL DEFAULT '{}'::jsonb,
  after          jsonb NOT NULL DEFAULT '{}'::jsonb,
  photo_ref      varchar(60),
  notes          text,
  recorded_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_role  varchar(40),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_record_record_idx ON council_ops.survey_record (register, record_id, created_at DESC);
COMMENT ON TABLE council_ops.survey_record IS
  'Each Roads and Works survey entry: the register, the record, the day surveyed, the fields before and after, who recorded it (migration 254).';

SELECT tenancy.make_tenant('council_ops.survey_record', 'VUNGU');

-- ── The department's name on its ward measures ───────────────────────────────────────────
UPDATE spatial_engine.measure SET owner_dept = 'Roads and Works'
 WHERE owner_dept = 'Engineering and Works';
