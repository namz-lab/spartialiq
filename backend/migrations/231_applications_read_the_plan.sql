-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 231 — APPLICATIONS READ THE PLAN: THE MATRIX VISIBLE AGAIN, THE PARCEL FOUND ONCE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/231_applications_read_the_plan.down.sql.
--
-- Three faults kept the plan out of the application workflow:
--
-- 1. THE MATRIX WAS INVISIBLE. Migration 186 (a hand-applied hotfix for a database that lacked the view) DROPPED the chain's zone_effective_controls and
--    zone_decision_status and installed stubs over an empty table, zone_polygon_decision. Every reader of the zoning matrix (rule_snapshot, the plan lookup,
--    the planning assistant, the inspector's maps, zones.js) therefore saw "not decided" for every use, or failed (rule_snapshot named columns the stub lacks),
--    whatever zone_land_use_controls held. Both views are restored here to their chain definitions (migrations 143 and 161). zone_polygon_decision is left
--    in place, unused.
-- 2. THE PARCEL WAS FOUND TWICE. Since migration 228 a stand is both a row of land.parcel and of the public.stands view, so resolve_stand_parcel found
--    every stand number twice and answered 'ambiguous'. It now reads land.parcel only; with no stand number it takes the SMALLEST current parcel containing
--    the point (a stand before a farm: rural applications are on farm parcels).
-- 3. A DECISION'S AUTHORITY WAS LOST. rule_snapshot() now carries decision_authority and decision_provisional (authority starts 'PROPOSED'), so a
--    best-practice proposal is never read as an Executive Officer decision.
-- relodge_permit_zoning() re-runs the lodgement of an application whose parcel was not found (never over a manual correction by staff), appending a
-- fresh snapshot.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. The matrix views, as the chain defines them ─────────────────────────────────────────
DROP VIEW IF EXISTS public.zone_effective_controls;
CREATE VIEW public.zone_effective_controls WITH (security_invoker = true) AS
SELECT DISTINCT ON (z.id, c.land_use_group_id)
       c.id,
       z.id AS zone_id,
       c.land_use_group_id,
       c.control_type,
       c.authority,
       c.notes,
       c.conditions,
       c.created_at,
       c.updated_at,
       c.deleted_at,
       c.deleted_by,
       CASE WHEN c.zone_id IS NOT NULL THEN 'zone' ELSE 'zone_type' END AS source,
       c.pathway_code
  FROM public.proposed_peri_urban_zones z
  JOIN public.zone_land_use_controls c
    ON c.deleted_at IS NULL
   AND (c.zone_id = z.id
        OR (c.zone_id IS NULL
            AND (c.plan_zone_type_id = z.plan_zone_type_id OR c.zone_type = z.zone_type)))
 ORDER BY z.id, c.land_use_group_id, (c.zone_id IS NULL);
COMMENT ON VIEW public.zone_effective_controls IS
  'What applies to each zone polygon: its own decisions and those of its zone type, the polygon''s own winning. Restored by migration 231 (186 had replaced it with a stub).';

DROP VIEW IF EXISTS public.zone_decision_status;
CREATE VIEW public.zone_decision_status WITH (security_invoker = true) AS
SELECT z.id AS zone_id, i.id AS plan_id, i.title AS plan_title, i.version AS plan_version, i.status AS plan_status,
       public.plan_is_provisional(i.status) AS provisional,
       t.code AS zone_type_code, t.review_status, t.reviewed_by, t.reviewed_at
  FROM public.proposed_peri_urban_zones z
  JOIN public.plan_instrument i ON i.id = z.plan_instrument_id
  LEFT JOIN public.plan_zone_type t ON t.id = z.plan_zone_type_id;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.zone_effective_controls', 'public.zone_decision_status'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_app', v); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN EXECUTE format('GRANT SELECT ON %s TO vungu_system', v); END IF;
  END LOOP;
  PERFORM tenancy.classify('public.zone_effective_controls', 'tenant_view', 'what applies to each zone polygon (migration 231 restores the chain definition)');
  PERFORM tenancy.classify('public.zone_decision_status', 'tenant_view', 'the plan a zone belongs to and whether what it decides is provisional');
END $$;

-- ── 2. The rule snapshot says who decided ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rule_snapshot(p_layer text, p_id text, p_use text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'computed_at',   NOW(),
    'parcel',        jsonb_build_object('layer', p_layer, 'id', p_id),
    'land_use_code', p_use,
    'unzoned',       NOT EXISTS (SELECT 1 FROM parcel_zoning_for(p_layer, p_id)),
    'provisional',   COALESCE((SELECT bool_or(pi.status NOT IN ('approved', 'gazetted'))
                                 FROM parcel_zoning_for(p_layer, p_id) pq JOIN plan_instrument pi ON pi.id = pq.plan_instrument_id), FALSE),
    'results', COALESCE((
      SELECT jsonb_agg(row_json ORDER BY governing DESC, share DESC NULLS LAST, plan_title, zone_id)
        FROM (
          SELECT pz.zone_id, pz.is_governing AS governing, pz.share_pct AS share, i.title AS plan_title,
                 jsonb_build_object(
                   'plan',  jsonb_build_object('id', i.id, 'title', i.title, 'version', i.version,
                                               'status', i.status, 'provisional', (i.status NOT IN ('approved', 'gazetted')), 'authority', a.authority_name,
                                               'gazette_ref', i.gazette_ref),
                   'zone',  jsonb_build_object('id', pz.zone_id, 'name', pz.zone_name, 'type_code', t.code,
                                               'review_status', t.review_status, 'reviewed_by', t.reviewed_by),
                   'share_pct', pz.share_pct,
                   'governing', pz.is_governing,
                   'method',    pz.method,
                   'land_use',  CASE WHEN g.id IS NULL THEN NULL
                                     ELSE jsonb_build_object('code', g.group_code, 'description', g.description) END,
                   'decision',          c.control_type,
                   'decision_source',   c.source,
                   'decision_authority', c.authority,
                   'decision_provisional', COALESCE(c.authority LIKE 'PROPOSED%', FALSE),
                   'conditions',        c.conditions,
                   'notes',             c.notes,
                   'pathway',           CASE WHEN dp.code IS NULL THEN NULL ELSE jsonb_build_object(
                                          'code', dp.code, 'name', dp.name,
                                          'requires_public_notice', dp.requires_public_notice,
                                          'notice_at_applicant_cost', dp.notice_at_applicant_cost,
                                          'adjacent_owners_notified', dp.adjacent_owners_notified,
                                          'objection_days', dp.objection_days,
                                          'decision_body', dp.decision_body,
                                          'statutory_ref', dp.statutory_ref,
                                          'evidence_status', dp.evidence_status) END,
                   'pathway_source',    CASE WHEN dp.code IS NULL THEN NULL
                                             WHEN c.pathway_code IS NOT NULL THEN 'decision' ELSE 'default' END,
                   'standards', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                                'kind', s.kind_code, 'name', k.name, 'unit', k.unit,
                                'min', s.min_value, 'max', s.max_value, 'conditions', s.conditions,
                                'status', s.status, 'source_ref', s.source_ref) ORDER BY s.kind_code)
                         FROM plan_zone_standard s JOIN standard_kind k ON k.code = s.kind_code
                        WHERE s.plan_zone_type_id = pz.plan_zone_type_id
                          AND (s.land_use_group_id IS NULL OR s.land_use_group_id = g.id)), '[]'::jsonb)
                 ) AS row_json
            FROM parcel_zoning_for(p_layer, p_id) pz
            JOIN plan_instrument i ON i.id = pz.plan_instrument_id
            LEFT JOIN local_authorities a ON a.id = i.authority_id
            LEFT JOIN plan_zone_type t ON t.id = pz.plan_zone_type_id
            LEFT JOIN land_use_groups g ON g.plan_instrument_id = pz.plan_instrument_id AND g.group_code = p_use AND g.is_active
            LEFT JOIN zone_effective_controls c ON c.zone_id = pz.zone_id AND c.land_use_group_id = g.id
            LEFT JOIN decision_pathway dp
                   ON dp.code = COALESCE(c.pathway_code,
                                         (SELECT d.code FROM decision_pathway d
                                           WHERE d.is_default_for_decision AND d.decision = c.control_type))
        ) rows), '[]'::jsonb)
  )
$function$;

-- ── 3. The parcel for an application: found once ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_stand_parcel(p_stand text, p_ward text, p_lng double precision, p_lat double precision)
RETURNS TABLE (layer text, id text, match text) AS $$
DECLARE
  cands jsonb := '[]'::jsonb;
  narrowed jsonb;
  wards text[];
  n integer;
  r record;
  pt geometry;
BEGIN
  IF p_stand IS NOT NULL AND btrim(p_stand) <> '' THEN
    FOR r IN SELECT p.parcel_id AS pid, COALESCE(w.name, '') AS wname
               FROM land.parcel p LEFT JOIN admin.ward w ON w.ward_code = p.ward_code
              WHERE p.status = 'current' AND p.valid_to IS NULL AND upper(btrim(p.stand_no)) = upper(btrim(p_stand)) LOOP
      cands := cands || jsonb_build_array(jsonb_build_object('id', r.pid, 'ward', r.wname));
    END LOOP;
    n := jsonb_array_length(cands);
    -- several parcels of that number: the ward on the application may leave exactly one ("Mkoba 6, Ward 12" names wards 6 and 12)
    IF n > 1 AND p_ward IS NOT NULL AND btrim(p_ward) <> '' THEN
      wards := ARRAY(SELECT m[1] FROM regexp_matches(p_ward, '(\d+)', 'g') AS m);
      SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO narrowed
        FROM jsonb_array_elements(cands) c
       WHERE upper(btrim(c->>'ward')) = upper(btrim(p_ward)) OR (c->>'ward') = ANY (wards);
      IF jsonb_array_length(narrowed) = 1 THEN cands := narrowed; n := 1; END IF;
    END IF;
    IF n = 1 THEN
      RETURN QUERY SELECT 'land.parcel'::text, cands->0->>'id', 'matched'::text; RETURN;
    END IF;
    IF n > 1 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'ambiguous'::text; RETURN;
    END IF;
  END IF;

  -- no number (or none matched): the smallest current parcel containing the location, a stand before a farm or plot
  IF p_lng IS NOT NULL AND p_lat IS NOT NULL THEN
    pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
    SELECT p.parcel_id INTO r FROM land.parcel p
     WHERE p.status = 'current' AND p.valid_to IS NULL AND ST_Intersects(p.geom_wgs84, pt)
     ORDER BY (p.parcel_kind <> 'stand'), ST_Area(p.geom_wgs84::geography), p.parcel_id LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'land.parcel'::text, r.parcel_id::text, 'by_location'::text; RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT NULL::text, NULL::text, 'unmatched'::text;
END $$ LANGUAGE plpgsql STABLE;

-- ── 4. Lodge again ─────────────────────────────────────────────────────────────────────────
-- For an application whose parcel was not found (or was found wrongly before): resolve it again and append a fresh lodgement snapshot. A parcel a person
-- set by hand (parcel_match 'manual') is never overwritten.
CREATE OR REPLACE FUNCTION spatial_planning.relodge_permit_zoning(p_permit uuid) RETURNS text AS $$
DECLARE
  p spatial_planning.permit_application%ROWTYPE;
  m record;
  snap jsonb;
  one_plan uuid;
BEGIN
  SELECT * INTO p FROM spatial_planning.permit_application WHERE id = p_permit;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown permit %', p_permit; END IF;
  IF p.parcel_match = 'manual' THEN RETURN p.parcel_match; END IF;

  SELECT * INTO m FROM public.resolve_stand_parcel(
    p.stand_number, p.suburb_ward,
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_X(p.location) END,
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_Y(p.location) END);

  IF m.layer IS NULL THEN
    UPDATE spatial_planning.permit_application SET parcel_layer = NULL, parcel_id = NULL, parcel_match = m.match, plan_instrument_id = NULL WHERE id = p_permit;
    RETURN m.match;
  END IF;

  snap := public.rule_snapshot(m.layer, m.id, NULL);
  SELECT CASE WHEN count(DISTINCT r->'plan'->>'id') = 1 THEN min(r->'plan'->>'id')::uuid END INTO one_plan
    FROM jsonb_array_elements(snap->'results') r WHERE (r->>'governing')::boolean;

  UPDATE spatial_planning.permit_application
     SET parcel_layer = m.layer, parcel_id = m.id, parcel_match = m.match, plan_instrument_id = one_plan
   WHERE id = p_permit;
  INSERT INTO spatial_planning.permit_rule_snapshot (permit_id, kind, plan_instrument_id, snapshot)
  VALUES (p_permit, 'lodgement', one_plan, snap);
  RETURN m.match;
END $$ LANGUAGE plpgsql;
