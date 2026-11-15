-- ROLLBACK OF 231 — APPLICATIONS READ THE PLAN
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/231_applications_read_the_plan.down.sql
-- Restores the previous state, INCLUDING its faults: the stub matrix views of migration 186 (which hide every decision from every reader and make rule_snapshot fail),
-- the 146 resolve_stand_parcel (which finds a stand twice since migration 228) and the rule snapshot without a decision's authority.
DROP FUNCTION IF EXISTS spatial_planning.relodge_permit_zoning(uuid);
CREATE OR REPLACE FUNCTION public.resolve_stand_parcel(p_stand text, p_ward text, p_lng double precision, p_lat double precision)
RETURNS TABLE (layer text, id text, match text) AS $$
DECLARE
  cands jsonb := '[]'::jsonb;
  narrowed jsonb;
  n integer;
  r record;
  pt geometry;
BEGIN
  IF p_stand IS NOT NULL AND btrim(p_stand) <> '' THEN
    IF to_regclass('public.stands') IS NOT NULL THEN
      FOR r IN EXECUTE 'SELECT id::text AS pid, ward FROM public.stands WHERE upper(btrim(stand_number)) = upper(btrim($1))' USING p_stand LOOP
        cands := cands || jsonb_build_array(jsonb_build_object('layer', 'stands', 'id', r.pid, 'ward', coalesce(r.ward, '')));
      END LOOP;
    END IF;
    IF to_regclass('land.parcel') IS NOT NULL THEN
      FOR r IN EXECUTE 'SELECT parcel_id AS pid, ward_code AS ward FROM land.parcel WHERE upper(btrim(stand_no)) = upper(btrim($1)) AND valid_to IS NULL' USING p_stand LOOP
        cands := cands || jsonb_build_array(jsonb_build_object('layer', 'land.parcel', 'id', r.pid, 'ward', coalesce(r.ward, '')));
      END LOOP;
    END IF;

    n := jsonb_array_length(cands);
    IF n > 1 AND p_ward IS NOT NULL AND btrim(p_ward) <> '' THEN
      SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO narrowed
        FROM jsonb_array_elements(cands) c WHERE upper(btrim(c->>'ward')) = upper(btrim(p_ward));
      IF jsonb_array_length(narrowed) = 1 THEN cands := narrowed; n := 1; END IF;
    END IF;
    IF n = 1 THEN
      RETURN QUERY SELECT cands->0->>'layer', cands->0->>'id', 'matched'::text; RETURN;
    END IF;
    IF n > 1 THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'ambiguous'::text; RETURN;
    END IF;
  END IF;

  IF p_lng IS NOT NULL AND p_lat IS NOT NULL AND to_regclass('public.stands') IS NOT NULL THEN
    pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
    SELECT count(*) INTO n FROM public.stands s WHERE ST_Intersects(s.geom, pt);
    IF n = 1 THEN
      RETURN QUERY SELECT 'stands'::text, (SELECT s.id::text FROM public.stands s WHERE ST_Intersects(s.geom, pt)), 'by_location'::text;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT NULL::text, NULL::text, 'unmatched'::text;
END $$ LANGUAGE plpgsql STABLE;

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

DROP VIEW IF EXISTS public.zone_effective_controls;
CREATE VIEW public.zone_effective_controls AS
SELECT NULL::uuid AS id, d.zone_id, d.land_use_group_id, d.control_type, 'Vungu RDC'::varchar(100) AS authority, d.notes, NULL::text AS conditions,
       now() AS created_at, now() AS updated_at, NULL::timestamptz AS deleted_at, NULL::uuid AS deleted_by
  FROM public.zone_polygon_decision d;
DROP VIEW IF EXISTS public.zone_decision_status;
CREATE VIEW public.zone_decision_status AS
SELECT z.id AS zone_id, NULL::uuid AS plan_id, 'Vungu working matrix'::text AS plan_title, 1 AS plan_version, 'draft'::text AS plan_status, true AS provisional,
       z.zone_type AS zone_type_code, 'unreviewed'::text AS review_status, NULL::text AS reviewed_by, NULL::timestamptz AS reviewed_at
  FROM public.proposed_peri_urban_zones z;
GRANT SELECT ON public.zone_effective_controls, public.zone_decision_status TO vungu_app;
