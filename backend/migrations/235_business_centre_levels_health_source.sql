-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 235 — BUSINESS-CENTRE LEVELS, DIP-TANK VILLAGES, AND A SOURCE FOR THE HEALTH FACILITIES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/235_business_centre_levels_health_source.down.sql. Rows come from scripts/load-reference-layers.js.
--
-- The council's updated business-centre file grades the business centres 1 to 3 (BC 1, BC 2, BC 3), as the printed sheet does: `sector` stays BC / RSC / GP and
-- the new `level` holds the grade of a BC (only a BC has one). The council's dip-tank file names the village of some tanks. The health facilities table
-- (council_ops.health_facility, empty until now) gains `source` and `loaded_at` so each row names where it came from.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE admin.business_centre ADD COLUMN IF NOT EXISTS level smallint;
ALTER TABLE admin.business_centre DROP CONSTRAINT IF EXISTS business_centre_level_known;
ALTER TABLE admin.business_centre ADD CONSTRAINT business_centre_level_known
  CHECK (level IS NULL OR (sector = 'BC' AND level BETWEEN 1 AND 3));

ALTER TABLE admin.community_facility ADD COLUMN IF NOT EXISTS village text;

ALTER TABLE council_ops.health_facility ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE council_ops.health_facility ADD COLUMN IF NOT EXISTS loaded_at timestamptz NOT NULL DEFAULT now();
