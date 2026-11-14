-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 222 — THE PLANNING BOUNDARY IS THE OUTSIDE FIGURE OF THE AUTHORITY AREA
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/222_authority_area_one_outline.down.sql.
--
-- Before: admin.authority_area was the union of the council's wards, and admin.planning_boundary (migration 221) was a second,
-- slightly different polygon (the same area to 0.1%: ward edges stood outside it, slivers inside it were in no ward).
--
-- Now they are ONE thing. The area of an authority is its planning boundary; its wards are the pieces inside it:
--   * admin.authority_area.geom IS the planning boundary (where the council has one; otherwise the union of its wards, and
--     `outline` says which);
--   * each ward's shape inside the authority is conformed to it: admin.authority_ward.geom is the ward clipped to the boundary
--     with the slivers of the boundary that no ward covers given to the nearest ward, so the wards fill the boundary exactly and
--     do not stand outside it. admin.conform_authority_wards() makes them;
--   * the custodian's ward polygons (admin.ward.geom, the Electoral Commission's) are NOT touched. The council's maps and the
--     spatial engine read the conformed shape (spatial_engine.v_authority_ward); everything else still reads the original.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE admin.authority_ward ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
ALTER TABLE admin.authority_ward ADD COLUMN IF NOT EXISTS conformed_at timestamptz;
COMMENT ON COLUMN admin.authority_ward.geom IS
  'The ward''s shape inside this authority''s area: the custodian''s ward polygon clipped to the planning boundary, with the boundary''s uncovered slivers given to the nearest ward. NULL until admin.conform_authority_wards() has run; then readers use it in place of admin.ward.geom.';

-- ── The conforming function ────────────────────────────────────────────────────────────────
-- Areas are checked in an equal-area projection (EPSG:6933), not on the spheroid: the geography area of a very large polygon is
-- only good to about 1 part in 100,000, which is the size of the differences being checked. Geometries are snapped to a grid of
-- 1e-7 degrees (about 1 cm) first, because GEOS 3.9's overlay is not robust on nearly coincident edges.
CREATE OR REPLACE FUNCTION admin.conform_authority_wards(p_authority integer) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_tol      constant double precision := 1e-7;
  v_area_ha  double precision;
  v_union_ha double precision;
  v_gap_ha   double precision;
  v_gap_n    integer;
  v_wards    integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin.planning_boundary WHERE authority_id = p_authority) THEN
    RAISE NOTICE 'authority % has no planning boundary: its wards are left as they are', p_authority;
    RETURN NULL;
  END IF;

  DROP TABLE IF EXISTS cw, gaps, fin;

  CREATE TEMP TABLE cw ON COMMIT DROP AS
  SELECT aw.ward_code, aw.valid_from,
         ST_CollectionExtract(ST_MakeValid(ST_Intersection(
           ST_MakeValid(ST_ReducePrecision(w.geom, v_tol)),
           ST_MakeValid(ST_ReducePrecision(b.geom, v_tol)))), 3) AS g
    FROM admin.authority_ward aw
    JOIN admin.ward w ON w.ward_code = aw.ward_code AND w.geom IS NOT NULL
    JOIN admin.planning_boundary b ON b.authority_id = aw.authority_id
   WHERE aw.authority_id = p_authority AND aw.valid_from <= CURRENT_DATE AND (aw.valid_to IS NULL OR aw.valid_to > CURRENT_DATE);

  -- A ward that lies wholly outside the boundary has nothing to conform: it keeps no shape here and is reported.
  DELETE FROM cw WHERE g IS NULL OR ST_IsEmpty(g);
  SELECT count(*) INTO v_wards FROM cw;
  IF v_wards = 0 THEN RAISE EXCEPTION 'no ward of authority % lies inside its planning boundary', p_authority; END IF;

  -- The parts of the boundary that no ward covers, each given to the nearest ward (they touch it: slivers along the edge).
  CREATE TEMP TABLE gaps ON COMMIT DROP AS
  SELECT d.geom AS g,
         (SELECT c.ward_code FROM cw c ORDER BY ST_Distance(c.g, d.geom), c.ward_code LIMIT 1) AS ward_code
    FROM (SELECT (ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Difference(
                   ST_MakeValid(ST_ReducePrecision(b.geom, v_tol)), (SELECT ST_UnaryUnion(ST_Collect(g)) FROM cw))), 3))).geom AS geom
            FROM admin.planning_boundary b WHERE b.authority_id = p_authority) d;

  CREATE TEMP TABLE fin ON COMMIT DROP AS
  SELECT c.ward_code, c.valid_from,
         ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(
           ARRAY[c.g] || COALESCE((SELECT array_agg(s.g) FROM gaps s WHERE s.ward_code = c.ward_code), ARRAY[]::geometry[]))), 3)) AS g
    FROM cw c;

  -- The check that makes "the same area" a fact: the wards fill the boundary and do not stand outside it.
  SELECT ST_Area(ST_Transform(ST_ReducePrecision(b.geom, v_tol), 6933)) / 10000,
         ST_Area(ST_Transform((SELECT ST_UnaryUnion(ST_Collect(g)) FROM fin), 6933)) / 10000
    INTO v_area_ha, v_union_ha
    FROM admin.planning_boundary b WHERE b.authority_id = p_authority;
  IF abs(v_union_ha - v_area_ha) > v_area_ha * 1e-5 THEN
    RAISE EXCEPTION 'conformed wards cover % ha but the planning boundary is % ha: nothing was changed', round(v_union_ha::numeric, 2), round(v_area_ha::numeric, 2);
  END IF;

  SELECT count(*), COALESCE(sum(ST_Area(ST_Transform(g, 6933))) / 10000, 0) INTO v_gap_n, v_gap_ha FROM gaps;

  UPDATE admin.authority_ward aw SET geom = f.g, conformed_at = now()
    FROM fin f WHERE aw.authority_id = p_authority AND aw.ward_code = f.ward_code AND aw.valid_from = f.valid_from;

  RETURN jsonb_build_object('authority_id', p_authority, 'wards_conformed', v_wards, 'boundary_ha', round(v_area_ha::numeric, 2),
                            'wards_ha', round(v_union_ha::numeric, 2), 'gap_parts_filled', v_gap_n, 'gap_ha_filled', round(v_gap_ha::numeric, 2));
END $fn$;
COMMENT ON FUNCTION admin.conform_authority_wards(integer) IS
  'Makes an authority''s wards fill its planning boundary exactly (clip to it, give the uncovered slivers to the nearest ward) and stores the result in admin.authority_ward.geom. Raises, changing nothing, if the result does not cover the boundary to 1 part in 100,000. The custodian''s ward polygons are not touched.';

-- ── The views: the council's wards, and the area, from the conformed shapes ────────────────
CREATE OR REPLACE VIEW spatial_engine.v_authority_ward WITH (security_invoker = true) AS
SELECT aw.authority_id, w.ward_code, w.name, aw.basis, aw.instrument_ref,
       COALESCE(aw.geom, w.geom)::geometry(MultiPolygon, 4326) AS geom,
       round((ST_Area(COALESCE(aw.geom, w.geom)::geography) / 1000000.0)::numeric, 3) AS area_km2
  FROM admin.authority_ward aw
  JOIN admin.ward w ON w.ward_code = aw.ward_code
 WHERE aw.authority_id = app.authority_id()
   AND (aw.valid_to IS NULL OR aw.valid_to >= CURRENT_DATE)
   AND w.geom IS NOT NULL;
COMMENT ON VIEW spatial_engine.v_authority_ward IS
  'The calling council''s current wards, with area in km2. The shape is the conformed one (admin.authority_ward.geom) when the council has a planning boundary, otherwise the custodian''s polygon. basis is interim while the Council has not confirmed its list (decision D11).';

-- admin.authority_area: the planning boundary where there is one, else the union of the (conformed) wards. The first columns are
-- unchanged; `outline` and `boundary_name` are new.
CREATE OR REPLACE VIEW admin.authority_area WITH (security_invoker = true) AS
WITH holders AS (
  SELECT a_1.id AS authority_id, a_1.id AS holder_id FROM public.local_authorities a_1 WHERE a_1.kind <> 'combination'
  UNION ALL
  SELECT m.combination_id, m.member_id FROM public.authority_member m
   WHERE m.valid_from <= CURRENT_DATE AND (m.valid_to IS NULL OR m.valid_to > CURRENT_DATE)
)
SELECT h.authority_id,
       a.code AS authority_code,
       count(DISTINCT w.ward_code)::integer AS wards,
       string_agg(DISTINCT aw.basis, ', ' ORDER BY aw.basis) AS basis,
       bool_or(aw.basis = ANY (ARRAY['interim', 'proposed'])) AS provisional,
       COALESCE(pb.geom, ST_Multi(ST_Union(COALESCE(aw.geom, w.geom))))::geometry(MultiPolygon, 4326) AS geom,
       CASE WHEN pb.geom IS NOT NULL THEN 'planning_boundary' ELSE 'ward_union' END AS outline,
       pb.name AS boundary_name
  FROM holders h
  JOIN public.local_authorities a ON a.id = h.authority_id
  JOIN admin.authority_ward aw ON aw.authority_id = h.holder_id AND aw.valid_from <= CURRENT_DATE AND (aw.valid_to IS NULL OR aw.valid_to > CURRENT_DATE)
  JOIN admin.ward w ON w.ward_code = aw.ward_code
  LEFT JOIN admin.planning_boundary pb ON pb.authority_id = h.authority_id AND h.authority_id = h.holder_id
 GROUP BY h.authority_id, a.code, pb.geom, pb.name;
COMMENT ON VIEW admin.authority_area IS
  'The area of an authority: its planning boundary where it has one (outline = planning_boundary), otherwise the union of its wards. Its wards fill it exactly once admin.conform_authority_wards() has run. Provisional while any ward is interim.';

COMMENT ON TABLE admin.planning_boundary IS
  'The outside figure of admin.authority_area: the council''s planning boundary as supplied by its GIS (one per council). The authority area IS this polygon, and the council''s wards are conformed to it.';

UPDATE public.spatial_concept_source SET
  note = 'the outside figure of admin.authority_area (migration 222); the council''s wards are conformed to it'
 WHERE relation = 'admin.planning_boundary';

-- authority_ward now carries a geometry column, so the registry must classify it.
INSERT INTO public.spatial_concept_source (relation, concept_code, role, note) VALUES
  ('admin.authority_ward', 'authority_area', 'source', 'which wards belong to which authority, and each ward''s conformed shape inside the authority''s area')
ON CONFLICT (relation) DO NOTHING;
