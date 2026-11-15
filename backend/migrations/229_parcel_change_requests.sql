-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 229 — STAND BOUNDARY CHANGES AS PROPOSALS TO THE SURVEY SECTION
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/229_parcel_change_requests.down.sql.
--
-- A stand is a parcel of the register, and land.parcel_guard lets a boundary change only under an approved Survey Section import. An officer
-- who wants a new stand, a split, a merge or a boundary correction therefore PROPOSES it:
--   land.parcel_change_request   the proposal: kind, status, reason, who drafted and who decided, the survey task opened for it
--   land.parcel_change_parent    the stands it affects (one open request per stand at a time)
--   land.parcel_change_item      the proposed boundaries: a 'child' (a new parcel) or 'revised' (a parent whose boundary changes in place)
--   land.change_request_problems(id)   what is wrong with a proposal, as short codes with detail; empty = may be submitted
-- Kinds:  split    one parent retired, 2+ children cover it        merge   2+ parents retired, one child is their union
--         new      the parent is revised (shrinks), 1+ children are cut from the rest      reshape  the parent is revised only
-- Status: draft -> submitted -> accepted -> applied (by the survey import); a submitted proposal may be returned (to draft), rejected or withdrawn.
-- The tolerances below are PROPOSALS for the Survey Section to confirm: a drawn sketch is not a survey, so the checks are generous and the
-- survey import re-checks the surveyed boundaries. Nothing here changes a boundary in the register.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE land.parcel_change_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CONSTRAINT parcel_change_request_kind_known CHECK (kind IN ('new', 'split', 'merge', 'reshape')),
  status       text NOT NULL DEFAULT 'draft'
               CONSTRAINT parcel_change_request_status_known CHECK (status IN ('draft', 'submitted', 'accepted', 'returned', 'rejected', 'withdrawn', 'applied')),
  reason       text,
  requested_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  submitted_at timestamptz,
  decided_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  decided_at   timestamptz,
  decision_note text,
  survey_task_id uuid REFERENCES spatial_planning.survey_task (id) ON DELETE SET NULL,
  general_plan_id bigint REFERENCES land.general_plan (import_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_parcel_change_request_status ON land.parcel_change_request (status);
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON land.parcel_change_request FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
COMMENT ON TABLE land.parcel_change_request IS
  'A proposal to change stand boundaries (new, split, merge, reshape), decided by the Survey Section and closed by the survey import (migration 229).';

CREATE TABLE land.parcel_change_parent (
  request_id uuid NOT NULL REFERENCES land.parcel_change_request (id) ON DELETE CASCADE,
  parcel_id  varchar NOT NULL REFERENCES land.parcel (parcel_id),
  PRIMARY KEY (request_id, parcel_id)
);
CREATE INDEX idx_parcel_change_parent_parcel ON land.parcel_change_parent (parcel_id);

CREATE TABLE land.parcel_change_item (
  request_id uuid NOT NULL REFERENCES land.parcel_change_request (id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  role       text NOT NULL CONSTRAINT parcel_change_item_role_known CHECK (role IN ('child', 'revised')),
  label      text,
  -- for a 'revised' item, the parent whose boundary it replaces
  parent_parcel_id varchar REFERENCES land.parcel (parcel_id),
  geom       geometry(MultiPolygon, 4326) NOT NULL,
  -- set by the survey import: the parcel this item became
  matched_parcel_id varchar REFERENCES land.parcel (parcel_id),
  PRIMARY KEY (request_id, seq),
  CONSTRAINT parcel_change_item_revised_names_parent CHECK ((role = 'revised') = (parent_parcel_id IS NOT NULL))
);
CREATE INDEX idx_parcel_change_item_geom ON land.parcel_change_item USING gist (geom);

-- Tenancy: a request belongs to the authority that drafted it; its parents and items follow it.
SELECT tenancy.make_tenant('land.parcel_change_request', 'VUNGU');
SELECT tenancy.make_tenant_child('land.parcel_change_parent', 'land.parcel_change_request', 'request_id');
SELECT tenancy.make_tenant_child('land.parcel_change_item', 'land.parcel_change_request', 'request_id');

INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('land.parcel_change_request', 'cadastral_parcel', 'derived', 'proposals to change stand boundaries, decided by the Survey Section (migration 229)'),
  ('land.parcel_change_parent', 'cadastral_parcel', 'derived', 'the stands a proposal affects'),
  ('land.parcel_change_item', 'cadastral_parcel', 'derived', 'the proposed boundaries of a proposal')
ON CONFLICT (relation) DO UPDATE SET concept_code = EXCLUDED.concept_code, role = EXCLUDED.role, note = EXCLUDED.note;

-- The Survey Section's queue gets the kinds of work a proposal opens.
ALTER TABLE spatial_planning.survey_task DROP CONSTRAINT survey_task_task_type_check;
ALTER TABLE spatial_planning.survey_task ADD CONSTRAINT survey_task_task_type_check CHECK (task_type::text = ANY (ARRAY[
  'verification', 'setting_out', 'pegging', 'layout', 'encroachment', 'beacon_check', 'general',
  'subdivision', 'consolidation', 'boundary_correction', 'new_stand']::text[]));

-- ── What is wrong with a proposal ──────────────────────────────────────────────────────────
-- Tolerances (proposals, see the header): the items of a split/merge/new must agree with the parents' ground within 2% of its area; a reshape
-- must still overlap its parent by half; two items, or an item and another current parcel, may share an edge but not overlap by more than 0.5 m2.
CREATE OR REPLACE FUNCTION land.change_request_problems(p_id uuid) RETURNS TABLE (code text, detail jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r land.parcel_change_request%ROWTYPE;
  n_parents integer; n_child integer; n_revised integer;
  parents_geom geometry; items_geom geometry;
  parent_area numeric; gap numeric; x record;
  COVER_TOLERANCE constant numeric := 0.02;
  OVERLAP_M2 constant numeric := 0.5;
BEGIN
  SELECT * INTO r FROM land.parcel_change_request WHERE id = p_id;
  IF NOT FOUND THEN code := 'not_found'; detail := '{}'; RETURN NEXT; RETURN; END IF;

  SELECT count(*) INTO n_parents FROM land.parcel_change_parent WHERE request_id = p_id;
  SELECT count(*) FILTER (WHERE role = 'child'), count(*) FILTER (WHERE role = 'revised') INTO n_child, n_revised
    FROM land.parcel_change_item WHERE request_id = p_id;

  -- the shape of each kind
  IF (r.kind = 'split'   AND NOT (n_parents = 1 AND n_child >= 2 AND n_revised = 0))
  OR (r.kind = 'merge'   AND NOT (n_parents >= 2 AND n_child = 1 AND n_revised = 0))
  OR (r.kind = 'new'     AND NOT (n_parents = 1 AND n_child >= 1 AND n_revised = 1))
  OR (r.kind = 'reshape' AND NOT (n_parents = 1 AND n_child = 0 AND n_revised = 1)) THEN
    code := 'wrong_shape'; detail := jsonb_build_object('kind', r.kind, 'parents', n_parents, 'children', n_child, 'revised', n_revised);
    RETURN NEXT; RETURN;
  END IF;

  -- the parents: current stands that are not reserved or allocated, and in no other open proposal
  FOR x IN SELECT p.parcel_id, p.stand_no, p.status, p.parcel_kind, p.allocation_status, o.status AS offer_status
             FROM land.parcel_change_parent cp
             JOIN land.parcel p ON p.parcel_id = cp.parcel_id
             LEFT JOIN land.stand_offer o ON o.parcel_id = p.parcel_id
            WHERE cp.request_id = p_id LOOP
    IF x.status <> 'current' THEN code := 'parent_not_current'; detail := jsonb_build_object('parcel_id', x.parcel_id, 'stand_no', x.stand_no); RETURN NEXT; END IF;
    IF x.parcel_kind <> 'stand' THEN code := 'parent_not_a_stand'; detail := jsonb_build_object('parcel_id', x.parcel_id, 'stand_no', x.stand_no); RETURN NEXT; END IF;
    IF x.allocation_status = 'allocated' OR x.offer_status IN ('reserved', 'allocated') THEN
      code := 'parent_reserved_or_allocated'; detail := jsonb_build_object('parcel_id', x.parcel_id, 'stand_no', x.stand_no, 'offer_status', x.offer_status); RETURN NEXT;
    END IF;
  END LOOP;
  FOR x IN SELECT cp.parcel_id, c.id AS other FROM land.parcel_change_parent cp
             JOIN land.parcel_change_parent op ON op.parcel_id = cp.parcel_id AND op.request_id <> p_id
             JOIN land.parcel_change_request c ON c.id = op.request_id AND c.status IN ('submitted', 'accepted')
            WHERE cp.request_id = p_id LOOP
    code := 'parent_in_open_request'; detail := jsonb_build_object('parcel_id', x.parcel_id, 'request_id', x.other); RETURN NEXT;
  END LOOP;

  -- the proposed boundaries
  FOR x IN SELECT seq, label, ST_IsValid(geom) AS ok, ST_IsValidReason(geom) AS why FROM land.parcel_change_item WHERE request_id = p_id AND NOT ST_IsValid(geom) LOOP
    code := 'invalid_geometry'; detail := jsonb_build_object('seq', x.seq, 'label', x.label, 'reason', x.why); RETURN NEXT;
  END LOOP;
  IF EXISTS (SELECT 1 FROM land.parcel_change_item WHERE request_id = p_id AND NOT ST_IsValid(geom)) THEN RETURN; END IF;   -- the checks below need valid geometry

  SELECT ST_UnaryUnion(ST_Collect(p.geom_wgs84)), COALESCE(sum(ST_Area(p.geom_wgs84::geography)), 0)
    INTO parents_geom, parent_area
    FROM land.parcel_change_parent cp JOIN land.parcel p ON p.parcel_id = cp.parcel_id WHERE cp.request_id = p_id;
  SELECT ST_UnaryUnion(ST_Collect(geom)) INTO items_geom FROM land.parcel_change_item WHERE request_id = p_id;

  IF r.kind = 'reshape' THEN
    IF parents_geom IS NOT NULL AND items_geom IS NOT NULL
       AND ST_Area(ST_Intersection(parents_geom, items_geom)::geography) < 0.5 * parent_area THEN
      code := 'reshape_far_from_parent'; detail := '{}'; RETURN NEXT;
    END IF;
  ELSIF parents_geom IS NOT NULL AND items_geom IS NOT NULL THEN
    gap := ST_Area(ST_SymDifference(parents_geom, items_geom)::geography);
    IF gap > GREATEST(OVERLAP_M2, COVER_TOLERANCE * parent_area) THEN
      code := CASE WHEN ST_Area(ST_Difference(items_geom, parents_geom)::geography) > ST_Area(ST_Difference(parents_geom, items_geom)::geography)
                   THEN 'items_outside_parents' ELSE 'parents_not_covered' END;
      detail := jsonb_build_object('mismatch_m2', round(gap, 1), 'parent_area_m2', round(parent_area, 1)); RETURN NEXT;
    END IF;
  END IF;

  -- items against each other
  FOR x IN SELECT a.seq AS a, b.seq AS b, ST_Area(ST_Intersection(a.geom, b.geom)::geography) AS m2
             FROM land.parcel_change_item a JOIN land.parcel_change_item b ON b.request_id = a.request_id AND b.seq > a.seq AND ST_Intersects(a.geom, b.geom)
            WHERE a.request_id = p_id AND ST_Area(ST_Intersection(a.geom, b.geom)::geography) > OVERLAP_M2 LOOP
    code := 'items_overlap'; detail := jsonb_build_object('items', jsonb_build_array(x.a, x.b), 'overlap_m2', round(x.m2::numeric, 1)); RETURN NEXT;
  END LOOP;

  -- items against every other current STAND (stands lie inside farms and plots, so those are not compared)
  FOR x IN SELECT i.seq, p.parcel_id, p.stand_no, ST_Area(ST_Intersection(i.geom, p.geom_wgs84)::geography) AS m2
             FROM land.parcel_change_item i
             JOIN land.parcel p ON p.status = 'current' AND p.parcel_kind = 'stand' AND p.geom_wgs84 && i.geom AND ST_Intersects(i.geom, p.geom_wgs84)
            WHERE i.request_id = p_id
              AND NOT EXISTS (SELECT 1 FROM land.parcel_change_parent cp WHERE cp.request_id = p_id AND cp.parcel_id = p.parcel_id)
              AND ST_Area(ST_Intersection(i.geom, p.geom_wgs84)::geography) > OVERLAP_M2 LOOP
    code := 'overlaps_parcel'; detail := jsonb_build_object('item', x.seq, 'parcel_id', x.parcel_id, 'stand_no', x.stand_no, 'overlap_m2', round(x.m2::numeric, 1)); RETURN NEXT;
  END LOOP;
END $$;
COMMENT ON FUNCTION land.change_request_problems(uuid) IS
  'What is wrong with a stand-change proposal: empty means it may be submitted. Tolerances are proposals for the Survey Section to confirm (migration 229).';
