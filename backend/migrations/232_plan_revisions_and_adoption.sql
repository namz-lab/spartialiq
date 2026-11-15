-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 232 — PLAN REVISIONS THAT KEEP THEIR SHAPES, AND THE ADOPTION RECORD
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/232_plan_revisions_and_adoption.down.sql.
--
-- 1. REVISIONS KEEP THE SHAPES. new_plan_version() copied a plan's rules but not its zone polygons, and set_plan_status('gazetted') MOVED the old plan's polygons to
--    the new version, so the earlier shapes were lost. A revision is now a full copy of the plan, shapes included; when it takes effect the revision it replaces is
--    closed (superseded, effective_to) and keeps its own shapes. The changes between two revisions are worked out by plan_revision_changes().
-- 2. WHICH PLAN GOVERNS. plan_governs(): a plan governs a parcel unless it is a template, is superseded, is a DRAFT or IN-NOTICE REVISION (it has a predecessor), or is
--    outside its effective dates. compute_parcel_zoning() applies it, so the parcel zoning, the rule snapshots and the plan lookup follow. A first plan (no predecessor)
--    governs while a draft, as before (shown as provisional).
-- 3. THE SHAPES ARE FROZEN with the rest of an approved, gazetted or superseded plan (zone_freeze_guard); a change is a new revision. The content hash that sign-offs
--    are checked against now includes the zone shapes.
-- 4. THE ADOPTION RECORD. plan_instrument gains the revision label, date and scale (the printed sheet's "Rev No 005, July 2026, 1:120 000"), the Full Council's adoption
--    (date, resolution reference) and the Minister's approval (number, date, name). plan_signatory_role names who must sign for an authority (the printed sheet: District
--    Planner, District Engineer, CEO, Council Chairman); a sign-off names the signatory role. For an authority WITH signatory roles configured: approval needs the council
--    adoption and every role signed on the current content; gazetting needs the Minister's approval, as well as the gazette reference and effective date it already needs.
--    An authority with none configured behaves exactly as before.
-- Nothing is marked adopted or approved here: no council resolution or ministerial approval number exists in the sources. The council enters them.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. The adoption record ─────────────────────────────────────────────────────────────────
ALTER TABLE public.plan_instrument
  ADD COLUMN IF NOT EXISTS revision_label           text,
  ADD COLUMN IF NOT EXISTS revision_date            date,
  ADD COLUMN IF NOT EXISTS map_scale                integer CHECK (map_scale IS NULL OR map_scale > 0),
  ADD COLUMN IF NOT EXISTS council_adopted_on       date,
  ADD COLUMN IF NOT EXISTS council_resolution_ref   text,
  ADD COLUMN IF NOT EXISTS ministerial_approval_no  text,
  ADD COLUMN IF NOT EXISTS ministerial_approved_on  date,
  ADD COLUMN IF NOT EXISTS ministerial_approved_by  text;

CREATE TABLE IF NOT EXISTS public.plan_signatory_role (
  authority_id  integer NOT NULL REFERENCES public.local_authorities (id) ON DELETE CASCADE,
  code          text NOT NULL,
  label         text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (authority_id, code)
);
COMMENT ON TABLE public.plan_signatory_role IS
  'Who must sign a plan before it is approved, for an authority (migration 232). An authority with no rows is not asked for signatories, council adoption or ministerial approval.';

ALTER TABLE public.plan_signoff ADD COLUMN IF NOT EXISTS signatory_role text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN GRANT SELECT ON public.plan_signatory_role TO vungu_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_signatory_role TO vungu_system; END IF;
  PERFORM tenancy.classify('public.plan_signatory_role', 'reference', 'the roles that must sign a plan, per authority; configuration, read by everyone');
END $$;

-- the printed sheet's signature lines, for Vungu
INSERT INTO public.plan_signatory_role (authority_id, code, label, display_order)
SELECT a.id, v.code, v.label, v.n
  FROM public.local_authorities a
 CROSS JOIN (VALUES ('district_planner', 'District Planner', 1), ('district_engineer', 'District Engineer', 2),
                    ('chief_executive', 'Chief Executive Officer', 3), ('council_chairman', 'Council Chairman', 4)) AS v(code, label, n)
 WHERE a.code = 'VUNGU'
ON CONFLICT DO NOTHING;

-- the facts printed on the sheet: Rev No 005, July 2026, scale 1:120 000
UPDATE public.plan_instrument
   SET revision_label = 'Rev 005', revision_date = DATE '2026-07-01', map_scale = 120000,
       notes = COALESCE(notes || E'\n', '') || 'Revision 005 of the composite master plan (July 2026, scale 1:120 000). Revisions 001 to 004 were paper issues and are not held here.'
 WHERE title = 'Vungu RDC peri-urban local plan (as mapped)' AND revision_label IS NULL AND NOT is_template;

-- ── 2. Which plan governs ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plan_governs(p_plan uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT NOT i.is_template
                      AND i.status <> 'superseded'
                      AND NOT (i.supersedes_id IS NOT NULL AND i.status IN ('draft', 'public_notice'))
                      AND (i.effective_from IS NULL OR i.effective_from <= CURRENT_DATE)
                      AND (i.effective_to IS NULL OR i.effective_to >= CURRENT_DATE)
                     FROM public.plan_instrument i WHERE i.id = p_plan), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.compute_parcel_zoning(p_layer text, p_id text)
RETURNS TABLE (zone_id integer, plan_instrument_id uuid, plan_zone_type_id uuid, zone_name text,
               share_pct numeric, is_governing boolean) AS $$
  WITH g AS (SELECT parcel_geometry(p_layer, p_id) AS geom),
  x AS (
    SELECT z.id, z.plan_instrument_id AS plan, z.plan_zone_type_id AS ztype, z.zone,
           ST_Area(ST_CollectionExtract(ST_Intersection(g.geom, COALESCE(e.geom, z.geom)), 3)::geography) AS a,
           ST_Area(g.geom::geography) AS parcel_area
      FROM g
      JOIN proposed_peri_urban_zones z ON g.geom IS NOT NULL AND ST_Intersects(g.geom, z.geom)
      JOIN plan_instrument i ON i.id = z.plan_instrument_id AND public.plan_governs(i.id)
      LEFT JOIN spatial_planning.zone_effective e ON e.zone_id = z.id
     WHERE e.zone_id IS NULL OR e.geom IS NOT NULL)
  SELECT x.id, x.plan, x.ztype, x.zone,
         ROUND((100 * x.a / NULLIF(x.parcel_area, 0))::numeric, 2),
         ROW_NUMBER() OVER (PARTITION BY x.plan ORDER BY x.a DESC, x.id) = 1
    FROM x
   WHERE x.a > 0
   ORDER BY x.plan, x.a DESC, x.id
$$ LANGUAGE sql STABLE;

-- ── 3. The shapes are frozen with the plan; the content hash includes them ─────────────────
CREATE OR REPLACE FUNCTION spatial_planning.zone_freeze_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE plan uuid; old_plan uuid;
BEGIN
  IF current_setting('lamis.plan_maintenance', true) = 'on' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  plan := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_instrument_id ELSE NEW.plan_instrument_id END;
  IF TG_OP = 'UPDATE' THEN old_plan := OLD.plan_instrument_id; END IF;
  IF public.plan_is_frozen(plan) OR (old_plan IS NOT NULL AND public.plan_is_frozen(old_plan)) THEN
    RAISE EXCEPTION 'this plan is approved and its zones cannot be edited: create a new revision instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_zz_freeze_zones ON spatial_planning.zone;
CREATE TRIGGER trg_zz_freeze_zones BEFORE INSERT OR UPDATE OR DELETE ON spatial_planning.zone
  FOR EACH ROW EXECUTE FUNCTION spatial_planning.zone_freeze_guard();

CREATE OR REPLACE FUNCTION public.plan_content_hash(p_plan uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT md5(COALESCE(string_agg(line, E'\n' ORDER BY line), ''))
    FROM (
      SELECT format('D|%s|%s|%s|%s|%s', zt.code, g.group_code, c.control_type,
                    COALESCE(c.conditions, ''), COALESCE(c.pathway_code, '')) AS line
        FROM zone_land_use_controls c
        JOIN plan_zone_type zt ON zt.id = c.plan_zone_type_id
        JOIN land_use_groups g ON g.id = c.land_use_group_id
       WHERE c.plan_instrument_id = p_plan AND c.deleted_at IS NULL
      UNION ALL
      SELECT format('S|%s|%s|%s|%s|%s', zt.code, s.kind_code, COALESCE(g.group_code, ''),
                    COALESCE(s.min_value::text, ''), COALESCE(s.max_value::text, ''))
        FROM plan_zone_standard s
        JOIN plan_zone_type zt ON zt.id = s.plan_zone_type_id
        LEFT JOIN land_use_groups g ON g.id = s.land_use_group_id
       WHERE zt.plan_instrument_id = p_plan
      UNION ALL
      SELECT format('Z|%s|%s', z.zone, md5(ST_AsEWKB(z.geom)))
        FROM spatial_planning.zone z
       WHERE z.plan_instrument_id = p_plan AND z.geom IS NOT NULL
    ) x
$$;

-- ── 4. Sign-offs by role, and what is still missing ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.sign_off_plan(uuid, uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.sign_off_plan(p_plan uuid, p_actor uuid, p_name text, p_role text, p_comment text DEFAULT NULL, p_signatory text DEFAULT NULL)
RETURNS uuid AS $$
DECLARE pl plan_instrument%ROWTYPE; sid uuid;
BEGIN
  SELECT * INTO pl FROM plan_instrument WHERE id = p_plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF pl.is_template THEN RAISE EXCEPTION 'a template is not signed off'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'a sign-off needs the signer''s name'; END IF;
  IF EXISTS (SELECT 1 FROM public.plan_signatory_role WHERE authority_id = pl.authority_id) THEN
    IF p_signatory IS NULL OR NOT EXISTS (SELECT 1 FROM public.plan_signatory_role WHERE authority_id = pl.authority_id AND code = p_signatory) THEN
      RAISE EXCEPTION 'this plan is signed by: %', (SELECT string_agg(code, ', ' ORDER BY display_order) FROM public.plan_signatory_role WHERE authority_id = pl.authority_id)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  INSERT INTO plan_signoff (plan_instrument_id, signed_by, signer_name, signer_role, comment, content_hash, signatory_role)
  VALUES (p_plan, p_actor, btrim(p_name), p_role, p_comment, plan_content_hash(p_plan), p_signatory)
  RETURNING id INTO sid;
  PERFORM log_plan_event(p_plan, 'signed_off', p_actor, p_role, jsonb_build_object('signer', btrim(p_name), 'signatory', p_signatory, 'comment', p_comment));
  RETURN sid;
END $$ LANGUAGE plpgsql;

-- The signatory roles with no sign-off on the plan as it is NOW (an edit makes every earlier sign-off stale). Empty where the authority names none.
CREATE OR REPLACE FUNCTION public.plan_signoffs_missing(p_plan uuid) RETURNS TABLE (code text, label text)
LANGUAGE sql STABLE AS $$
  SELECT r.code, r.label
    FROM public.plan_instrument i
    JOIN public.plan_signatory_role r ON r.authority_id = i.authority_id
   WHERE i.id = p_plan
     AND NOT EXISTS (SELECT 1 FROM public.plan_signoff s
                      WHERE s.plan_instrument_id = p_plan AND s.signatory_role = r.code AND s.content_hash = public.plan_content_hash(p_plan))
   ORDER BY r.display_order
$$;

-- ── 5. The records: identity, council adoption, the Minister's approval ────────────────────
CREATE OR REPLACE FUNCTION public.set_plan_identity(p_plan uuid, p_label text, p_date date, p_scale integer, p_actor uuid, p_role text) RETURNS void AS $$
DECLARE pl plan_instrument%ROWTYPE;
BEGIN
  SELECT * INTO pl FROM plan_instrument WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF pl.status NOT IN ('unknown', 'draft', 'public_notice') THEN RAISE EXCEPTION 'the revision of an approved plan cannot be relabelled' USING ERRCODE = 'check_violation'; END IF;
  UPDATE plan_instrument SET revision_label = NULLIF(btrim(p_label), ''), revision_date = p_date, map_scale = p_scale, updated_at = NOW() WHERE id = p_plan;
  PERFORM log_plan_event(p_plan, 'identity_set', p_actor, p_role, jsonb_build_object('revision_label', p_label, 'revision_date', p_date, 'map_scale', p_scale));
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_council_adoption(p_plan uuid, p_on date, p_resolution text, p_actor uuid, p_role text) RETURNS void AS $$
DECLARE pl plan_instrument%ROWTYPE;
BEGIN
  SELECT * INTO pl FROM plan_instrument WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF pl.status NOT IN ('public_notice') THEN RAISE EXCEPTION 'the council adopts a plan after the public notice (this one is %)', pl.status USING ERRCODE = 'check_violation'; END IF;
  IF p_on IS NULL OR p_resolution IS NULL OR btrim(p_resolution) = '' THEN RAISE EXCEPTION 'the council''s adoption needs its date and the resolution reference' USING ERRCODE = 'check_violation'; END IF;
  UPDATE plan_instrument SET council_adopted_on = p_on, council_resolution_ref = btrim(p_resolution), updated_at = NOW() WHERE id = p_plan;
  PERFORM log_plan_event(p_plan, 'council_adopted', p_actor, p_role, jsonb_build_object('on', p_on, 'resolution', btrim(p_resolution)));
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_ministerial_approval(p_plan uuid, p_no text, p_on date, p_by text, p_actor uuid, p_role text) RETURNS void AS $$
DECLARE pl plan_instrument%ROWTYPE;
BEGIN
  SELECT * INTO pl FROM plan_instrument WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF pl.status <> 'approved' THEN RAISE EXCEPTION 'the Minister''s approval is recorded on an approved plan (this one is %)', pl.status USING ERRCODE = 'check_violation'; END IF;
  IF p_no IS NULL OR btrim(p_no) = '' OR p_on IS NULL THEN RAISE EXCEPTION 'the Minister''s approval needs its number and date' USING ERRCODE = 'check_violation'; END IF;
  UPDATE plan_instrument SET ministerial_approval_no = btrim(p_no), ministerial_approved_on = p_on, ministerial_approved_by = NULLIF(btrim(p_by), ''), updated_at = NOW() WHERE id = p_plan;
  PERFORM log_plan_event(p_plan, 'ministerial_approval', p_actor, p_role, jsonb_build_object('number', btrim(p_no), 'on', p_on, 'by', p_by));
END $$ LANGUAGE plpgsql;

-- ── 6. The status chain, with the adoption gates; a revision keeps its own shapes ──────────
CREATE OR REPLACE FUNCTION public.set_plan_status(
  p_plan uuid, p_to text, p_actor uuid, p_role text,
  p_gazette_ref text DEFAULT NULL, p_effective_from date DEFAULT NULL
) RETURNS text AS $$
DECLARE pl plan_instrument%ROWTYPE; formal boolean; missing text; relinked bigint := 0;
BEGIN
  SELECT * INTO pl FROM plan_instrument WHERE id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF pl.is_template THEN RAISE EXCEPTION 'a template has no status to change'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plan_status_transition WHERE from_status = pl.status AND to_status = p_to) THEN
    RAISE EXCEPTION 'a plan cannot go from % to %', pl.status, p_to USING ERRCODE = 'check_violation';
  END IF;
  formal := EXISTS (SELECT 1 FROM public.plan_signatory_role WHERE authority_id = pl.authority_id);

  IF p_to = 'approved' THEN
    IF formal THEN
      IF pl.council_adopted_on IS NULL OR COALESCE(btrim(pl.council_resolution_ref), '') = '' THEN
        RAISE EXCEPTION 'approval needs the Full Council''s adoption: its date and the resolution reference' USING ERRCODE = 'check_violation';
      END IF;
      SELECT string_agg(label, ', ') INTO missing FROM public.plan_signoffs_missing(p_plan);
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'approval needs every signature on the plan as it is now; missing: %', missing USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NOT plan_signoff_is_current(p_plan) THEN
      RAISE EXCEPTION 'approval needs a current sign-off: the plan has been signed off, and not changed since' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_to = 'gazetted' THEN
    IF formal AND (COALESCE(btrim(pl.ministerial_approval_no), '') = '' OR pl.ministerial_approved_on IS NULL) THEN
      RAISE EXCEPTION 'gazetting needs the Minister''s approval: its number and date' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NULLIF(btrim(COALESCE(p_gazette_ref, pl.gazette_ref, '')), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'gazetting needs a gazette reference' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(p_effective_from, pl.effective_from) IS NULL THEN
      RAISE EXCEPTION 'gazetting needs an effective date' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE plan_instrument
       SET gazette_ref = COALESCE(NULLIF(btrim(p_gazette_ref), ''), gazette_ref),
           effective_from = COALESCE(p_effective_from, effective_from)
     WHERE id = p_plan;
  END IF;

  UPDATE plan_instrument SET status = p_to, updated_at = NOW() WHERE id = p_plan;

  -- A revision in force: the revision it replaces is closed and KEPT, with its own shapes (nothing moves).
  IF p_to = 'gazetted' AND pl.supersedes_id IS NOT NULL THEN
    UPDATE plan_instrument
       SET status = 'superseded', updated_at = NOW(),
           effective_to = CASE WHEN effective_from IS NULL
                                 OR (SELECT effective_from FROM plan_instrument WHERE id = p_plan) > effective_from
                               THEN (SELECT effective_from FROM plan_instrument WHERE id = p_plan) - 1
                               ELSE effective_to END
     WHERE id = pl.supersedes_id;
    PERFORM log_plan_event(pl.supersedes_id, 'superseded', p_actor, p_role, jsonb_build_object('by', p_plan));
    -- parcels are now judged under the new revision
    SELECT COALESCE(sum(r.parcels), 0) INTO relinked FROM public.refresh_all_parcel_zoning() r;
  END IF;

  PERFORM log_plan_event(p_plan, 'status_changed', p_actor, p_role,
    jsonb_build_object('from', pl.status, 'to', p_to, 'gazette_ref', p_gazette_ref, 'effective_from', p_effective_from, 'parcels_relinked', relinked));
  RETURN p_to;
END $$ LANGUAGE plpgsql;

-- ── 7. A new revision copies the shapes too ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.new_plan_version(p_plan uuid, p_actor uuid, p_role text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE src plan_instrument%ROWTYPE; new_id uuid;
BEGIN
  SELECT * INTO src FROM plan_instrument WHERE id = p_plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF src.is_template THEN RAISE EXCEPTION 'a template is not versioned this way'; END IF;
  IF src.status NOT IN ('approved', 'gazetted') THEN
    RAISE EXCEPTION 'only an approved or gazetted plan needs a new version (this one is %: edit it directly)', src.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM plan_instrument WHERE supersedes_id = p_plan AND status <> 'superseded') THEN
    RAISE EXCEPTION 'a newer version of this plan already exists' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO plan_instrument
    (authority_id, profile_id, plan_type, title, version, status, is_template, derived_from_id, supersedes_id, source_document, notes)
  VALUES
    (src.authority_id, src.profile_id, src.plan_type, src.title,
     (SELECT MAX(version) + 1 FROM plan_instrument WHERE authority_id = src.authority_id AND title = src.title),
     'draft', FALSE, src.derived_from_id, src.id, src.source_document,
     format('Version %s of "%s", copied from version %s on %s.', src.version + 1, src.title, src.version, CURRENT_DATE))
  RETURNING id INTO new_id;

  INSERT INTO plan_zone_type (plan_instrument_id, code, name, display_no, category, colour, std_zone_class, derived_from_id)
  SELECT new_id, code, name, display_no, category, colour, std_zone_class, id
    FROM plan_zone_type WHERE plan_instrument_id = src.id;

  INSERT INTO land_use_groups
    (group_code, description, group_category, development_category, use_scale, notes, is_active, display_order, plan_instrument_id, derived_from_id)
  SELECT group_code, description, group_category, development_category, use_scale, notes, TRUE, display_order, new_id, id
    FROM land_use_groups WHERE plan_instrument_id = src.id AND is_active;

  INSERT INTO zone_land_use_controls
    (plan_zone_type_id, land_use_group_id, control_type, authority, conditions, notes, pathway_code, derived_from_id)
  SELECT nz.id, ng.id, c.control_type, c.authority, c.conditions, c.notes, c.pathway_code, c.id
    FROM zone_land_use_controls c
    JOIN plan_zone_type oz ON oz.id = c.plan_zone_type_id
    JOIN plan_zone_type nz ON nz.plan_instrument_id = new_id AND nz.code = oz.code
    JOIN land_use_groups og ON og.id = c.land_use_group_id
    JOIN land_use_groups ng ON ng.plan_instrument_id = new_id AND ng.group_code = og.group_code
   WHERE c.plan_instrument_id = src.id AND c.deleted_at IS NULL;

  INSERT INTO plan_zone_type_class (plan_zone_type_id, scheme, code, relation, status)
  SELECT nz.id, k.scheme, k.code, k.relation, k.status
    FROM plan_zone_type_class k
    JOIN plan_zone_type oz ON oz.id = k.plan_zone_type_id AND oz.plan_instrument_id = src.id
    JOIN plan_zone_type nz ON nz.plan_instrument_id = new_id AND nz.code = oz.code;

  INSERT INTO land_use_group_class (land_use_group_id, scheme, code, relation, status)
  SELECT ng.id, k.scheme, k.code, k.relation, k.status
    FROM land_use_group_class k
    JOIN land_use_groups og ON og.id = k.land_use_group_id AND og.plan_instrument_id = src.id
    JOIN land_use_groups ng ON ng.plan_instrument_id = new_id AND ng.group_code = og.group_code;

  INSERT INTO plan_zone_standard
    (plan_zone_type_id, kind_code, land_use_group_id, min_value, max_value, conditions, source_ref, status, derived_from_id)
  SELECT nz.id, s.kind_code, ng.id, s.min_value, s.max_value, s.conditions, s.source_ref, s.status, s.id
    FROM plan_zone_standard s
    JOIN plan_zone_type oz ON oz.id = s.plan_zone_type_id AND oz.plan_instrument_id = src.id
    JOIN plan_zone_type nz ON nz.plan_instrument_id = new_id AND nz.code = oz.code
    LEFT JOIN land_use_groups og ON og.id = s.land_use_group_id
    LEFT JOIN land_use_groups ng ON ng.plan_instrument_id = new_id AND ng.group_code = og.group_code
   WHERE s.land_use_group_id IS NULL OR ng.id IS NOT NULL;

  -- The zone SHAPES come with the revision (migration 232): the new revision holds its own polygons, edited as a draft, and the revision it replaces
  -- keeps its own. The parcel-link triggers stay off (a draft revision does not govern); the effective parts are derived once for the new revision.
  PERFORM set_config('lamis.skip_parcel_zoning', 'on', true);
  INSERT INTO spatial_planning.zone
    (zone, zone_code, zone_type, scale_category, authority, zone_description, is_active, map_color, display_order, geom, ward, plan_instrument_id, plan_zone_type_id)
  SELECT z.zone, z.zone_code, z.zone_type, z.scale_category, z.authority, z.zone_description, z.is_active, z.map_color, z.display_order, z.geom, z.ward,
         new_id, nz.id
    FROM spatial_planning.zone z
    JOIN plan_zone_type oz ON oz.id = z.plan_zone_type_id AND oz.plan_instrument_id = src.id
    JOIN plan_zone_type nz ON nz.plan_instrument_id = new_id AND nz.code = oz.code;
  PERFORM spatial_planning.refresh_zone_effective(new_id);
  PERFORM set_config('lamis.skip_parcel_zoning', 'off', true);

  PERFORM log_plan_event(new_id, 'version_created', p_actor, p_role, jsonb_build_object('from', src.id, 'version', src.version + 1));
  PERFORM log_plan_event(src.id, 'new_version_started', p_actor, p_role, jsonb_build_object('new', new_id));
  -- a reviewed column stays reviewed in the copy (the copy itself would otherwise mark it for re-review)
  UPDATE plan_zone_type nz
     SET review_status = oz.review_status, reviewed_by = oz.reviewed_by, reviewed_at = oz.reviewed_at
    FROM plan_zone_type oz
   WHERE nz.plan_instrument_id = new_id AND oz.id = nz.derived_from_id AND oz.review_status = 'reviewed';

  RETURN new_id;
END $function$;

-- ── 8. What changed between two revisions ──────────────────────────────────────────────────
-- Decisions (the existing plan_decision_diff) and zone shapes by zone type: added, removed, or reshaped (hectares that differ).
CREATE OR REPLACE FUNCTION public.plan_revision_changes(p_from uuid, p_to uuid)
RETURNS TABLE (kind text, zone_type_code text, land_use_code text, change text, detail jsonb) AS $$
  WITH f AS (SELECT t.code, count(*) AS n, ST_UnaryUnion(ST_Collect(z.geom)) AS g
               FROM spatial_planning.zone z JOIN public.plan_zone_type t ON t.id = z.plan_zone_type_id
              WHERE z.plan_instrument_id = p_from AND z.geom IS NOT NULL GROUP BY t.code),
       t AS (SELECT tt.code, count(*) AS n, ST_UnaryUnion(ST_Collect(z.geom)) AS g
               FROM spatial_planning.zone z JOIN public.plan_zone_type tt ON tt.id = z.plan_zone_type_id
              WHERE z.plan_instrument_id = p_to AND z.geom IS NOT NULL GROUP BY tt.code)
  SELECT 'zone'::text, COALESCE(t.code, f.code), NULL::text,
         CASE WHEN f.code IS NULL THEN 'added' WHEN t.code IS NULL THEN 'removed' ELSE 'reshaped' END,
         jsonb_build_object(
           'polygons_from', f.n, 'polygons_to', t.n,
           'hectares_from', round((ST_Area(f.g::geography) / 10000)::numeric, 2),
           'hectares_to', round((ST_Area(t.g::geography) / 10000)::numeric, 2),
           'hectares_changed', CASE WHEN f.code IS NULL THEN round((ST_Area(t.g::geography) / 10000)::numeric, 2)
                                    WHEN t.code IS NULL THEN round((ST_Area(f.g::geography) / 10000)::numeric, 2)
                                    ELSE round((ST_Area(ST_SymDifference(f.g, t.g)::geography) / 10000)::numeric, 2) END)
    FROM f FULL JOIN t ON t.code = f.code
   WHERE f.code IS NULL OR t.code IS NULL OR ST_Area(ST_SymDifference(f.g, t.g)::geography) / 10000 > 0.01
  UNION ALL
  SELECT 'decision'::text, d.zone_type_code, d.land_use_code, d.change,
         jsonb_build_object('from', d.from_decision, 'to', d.to_decision)
    FROM public.plan_decision_diff(p_from, p_to) d
   ORDER BY 1, 2, 3
$$ LANGUAGE sql STABLE;
