-- 252: the Department of Roads and Works' registers: wards and council road classes on the road register, wards on the
-- water and asset registers, and a plant register.
--
-- What the registers lacked (audit of 18 November 2026, live database):
--   * all 1,059 roads had no ward, and their classes were OpenStreetMap's (residential, track, service...);
--   * all 142 water points and the 3 council buildings had no ward;
--   * there was no register of the department's plant: the graders, loaders and bowsers were only finance assets.
-- Road surface, road condition and the state of each water point cannot be worked out from the database: they need a
-- field survey (docs/manuals/roads-works-field-survey.md).
--
-- 1. WARDS. council_ops.ward_of(geometry, authority) gives the ward a feature lies in, from the council's current wards
--    (admin.authority_ward): for a line, the ward holding most of its length; for a point or area, the ward it falls in.
--    Every road, water point and council asset without a ward gets one, and a trigger fills it on any new or moved record
--    that has none. A ward a person has typed in is never overwritten.
--
-- 2. COUNCIL ROAD CLASSES. Under the Roads Act [Chapter 13:18] the council is the road authority for the tertiary roads
--    of its area; within them, road_asset.council_class says what kind of council road each one is, mapped from the
--    imported class:
--        tertiary                            -> feeder        (links the area to the secondary and primary roads)
--        residential, unclassified, living_street, road -> access (to homes, schools, clinics, dip tanks)
--        service                             -> service       (into a property, yard or facility)
--        track                               -> track         (an earth track, not formed)
--        path, footway, cycleway, bridleway, steps, pedestrian -> path (not for vehicles)
--        anything else, or none              -> unclassified
--    The imported class is kept in `hierarchy`. A class the Roads and Works officers set is never overwritten.
--
-- 3. THE PLANT REGISTER. council_ops.plant: each item of plant (grader, loader, roller, bowser...), its working status,
--    hour meter, last service and the post that operates it, linked to its finance fixed asset where there is one.
--    council_ops.plant_log: the daily log (hours, fuel, the road or job worked). Seeded from the finance register's plant
--    and equipment category. Both are tenant tables (tenancy.make_tenant).
-- Idempotent.

-- ── 1. Wards ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION council_ops.ward_of(p_geom geometry, p_authority integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT w.ward_code
    FROM admin.authority_ward aw
    JOIN admin.ward w ON w.ward_code = aw.ward_code
   WHERE p_geom IS NOT NULL AND aw.authority_id = p_authority
     AND (aw.valid_to IS NULL OR aw.valid_to >= current_date)
     AND COALESCE(aw.geom, w.geom) IS NOT NULL
     AND ST_Intersects(COALESCE(aw.geom, w.geom), p_geom)
   ORDER BY CASE WHEN ST_Dimension(p_geom) = 1
                 THEN ST_Length(ST_Intersection(COALESCE(aw.geom, w.geom), p_geom)::geography) ELSE 0 END DESC,
            w.ward_code
   LIMIT 1
$$;
COMMENT ON FUNCTION council_ops.ward_of(geometry, integer) IS
  'The council ward a feature lies in: for a line, the ward holding most of its length; for a point or area, the ward it falls in (migration 252).';

CREATE OR REPLACE FUNCTION council_ops.fill_ward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ward IS NULL AND NEW.geom IS NOT NULL THEN
    NEW.ward := council_ops.ward_of(NEW.geom, NEW.authority_id);
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['road_asset', 'wash_asset', 'council_asset'] LOOP
    IF to_regclass('council_ops.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('UPDATE council_ops.%I SET ward = council_ops.ward_of(geom, authority_id) WHERE ward IS NULL AND geom IS NOT NULL', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_ward ON council_ops.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_ward BEFORE INSERT OR UPDATE OF geom ON council_ops.%I FOR EACH ROW EXECUTE FUNCTION council_ops.fill_ward()', t, t);
  END LOOP;
END $$;

-- ── 2. Council road classes ────────────────────────────────────────────────────────────────
ALTER TABLE council_ops.road_asset ADD COLUMN IF NOT EXISTS council_class varchar(24);
ALTER TABLE council_ops.road_asset DROP CONSTRAINT IF EXISTS road_asset_council_class_check;
ALTER TABLE council_ops.road_asset ADD CONSTRAINT road_asset_council_class_check
  CHECK (council_class IS NULL OR council_class IN ('feeder', 'access', 'service', 'track', 'path', 'unclassified'));
COMMENT ON COLUMN council_ops.road_asset.council_class IS
  'What kind of council (tertiary) road this is: feeder, access, service, track, path or unclassified (migration 252). The imported class stays in hierarchy.';

UPDATE council_ops.road_asset SET council_class = CASE
    WHEN hierarchy = 'tertiary' THEN 'feeder'
    WHEN hierarchy IN ('residential', 'unclassified', 'living_street', 'road') THEN 'access'
    WHEN hierarchy = 'service' THEN 'service'
    WHEN hierarchy = 'track' THEN 'track'
    WHEN hierarchy IN ('path', 'footway', 'cycleway', 'bridleway', 'steps', 'pedestrian') THEN 'path'
    ELSE 'unclassified' END
 WHERE council_class IS NULL;

-- ── 3. The plant register ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS council_ops.plant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_no        varchar(32) NOT NULL,
  kind            varchar(24) NOT NULL CHECK (kind IN ('grader', 'loader', 'roller', 'tipper', 'tractor', 'tow_grader', 'bowser', 'excavator', 'other')),
  description     text NOT NULL,
  registration    varchar(32),
  serial_no       varchar(64),
  fixed_asset_id  uuid REFERENCES finance.fixed_asset (id) ON DELETE SET NULL,
  status          varchar(16) NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'under_repair', 'broken_down', 'standby', 'disposed')),
  operator_post_id uuid REFERENCES public.admin_org_position (id) ON DELETE SET NULL,
  location        text,
  hour_meter      numeric(10,1) CHECK (hour_meter IS NULL OR hour_meter >= 0),
  last_service_on date,
  next_service_hours numeric(10,1),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL
);
COMMENT ON TABLE council_ops.plant IS 'The Department of Roads and Works'' plant: each grader, loader, roller, bowser and the like, its status and hours (migration 252).';

CREATE TABLE IF NOT EXISTS council_ops.plant_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id      uuid NOT NULL REFERENCES council_ops.plant (id) ON DELETE CASCADE,
  worked_on     date NOT NULL DEFAULT current_date,
  hours         numeric(5,1) CHECK (hours IS NULL OR (hours >= 0 AND hours <= 24)),
  hour_meter_end numeric(10,1),
  fuel_litres   numeric(8,1) CHECK (fuel_litres IS NULL OR fuel_litres >= 0),
  road_asset_id uuid REFERENCES council_ops.road_asset (id) ON DELETE SET NULL,
  job           text,
  operator_name text,
  recorded_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE council_ops.plant_log IS 'A day''s work by an item of plant: hours, fuel, and the road or job (migration 252).';
CREATE INDEX IF NOT EXISTS idx_plant_log_plant_day ON council_ops.plant_log (plant_id, worked_on DESC);

SELECT tenancy.make_tenant('council_ops.plant', 'VUNGU');
SELECT tenancy.make_tenant_child('council_ops.plant_log', 'council_ops.plant', 'plant_id');

CREATE UNIQUE INDEX IF NOT EXISTS uq_plant_no_per_authority ON council_ops.plant (authority_id, plant_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plant_fixed_asset ON council_ops.plant (fixed_asset_id) WHERE fixed_asset_id IS NOT NULL;

-- Seeded from the finance register's plant and equipment, kind read from the asset's name.
INSERT INTO council_ops.plant (plant_no, kind, description, serial_no, fixed_asset_id, location, authority_id)
SELECT f.asset_no,
       CASE WHEN f.name ~* 'tow(ed)? grader' THEN 'tow_grader'
            WHEN f.name ~* 'grader' THEN 'grader'
            WHEN f.name ~* 'loader|backhoe|tlb' THEN 'loader'
            WHEN f.name ~* 'roller' THEN 'roller'
            WHEN f.name ~* 'tipper|dump' THEN 'tipper'
            WHEN f.name ~* 'tractor' THEN 'tractor'
            WHEN f.name ~* 'bowser|water tank' THEN 'bowser'
            WHEN f.name ~* 'excavator' THEN 'excavator'
            ELSE 'other' END,
       f.name, f.serial_no, f.id, f.location, f.authority_id
  FROM finance.fixed_asset f
  JOIN finance.asset_category c ON c.id = f.category_id
 WHERE c.name ILIKE 'Plant%' AND f.disposed_on IS NULL
   AND NOT EXISTS (SELECT 1 FROM council_ops.plant p WHERE p.fixed_asset_id = f.id);
