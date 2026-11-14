-- ROLLBACK OF 222 — THE PLANNING BOUNDARY IS THE OUTSIDE FIGURE OF THE AUTHORITY AREA
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/222_authority_area_one_outline.down.sql
-- Puts admin.authority_area back to the union of the wards, spatial_engine.v_authority_ward back to the custodian's ward
-- polygons, and removes the conforming function and the conformed shapes (re-creatable with 222 and the loader).
-- Drops the two new columns of admin.authority_area, so anything that reads `outline` or `boundary_name` must go first.
DROP VIEW IF EXISTS admin.authority_area;
CREATE VIEW admin.authority_area WITH (security_invoker = true) AS
WITH holders AS (
  SELECT a_1.id AS authority_id, a_1.id AS holder_id FROM public.local_authorities a_1 WHERE a_1.kind <> 'combination'
  UNION ALL
  SELECT m.combination_id, m.member_id FROM public.authority_member m
   WHERE m.valid_from <= CURRENT_DATE AND (m.valid_to IS NULL OR m.valid_to > CURRENT_DATE)
)
SELECT h.authority_id, a.code AS authority_code, count(DISTINCT w.ward_code)::integer AS wards,
       string_agg(DISTINCT aw.basis, ', ' ORDER BY aw.basis) AS basis,
       bool_or(aw.basis = ANY (ARRAY['interim', 'proposed'])) AS provisional,
       ST_Multi(ST_Union(w.geom))::geometry(MultiPolygon, 4326) AS geom
  FROM holders h
  JOIN public.local_authorities a ON a.id = h.authority_id
  JOIN admin.authority_ward aw ON aw.authority_id = h.holder_id AND aw.valid_from <= CURRENT_DATE AND (aw.valid_to IS NULL OR aw.valid_to > CURRENT_DATE)
  JOIN admin.ward w ON w.ward_code = aw.ward_code
 GROUP BY h.authority_id, a.code;
COMMENT ON VIEW admin.authority_area IS
  'The union of an authority''s current wards (a combination''s: of its members''); provisional while any ward is on an interim basis.';

CREATE OR REPLACE VIEW spatial_engine.v_authority_ward WITH (security_invoker = true) AS
SELECT aw.authority_id, w.ward_code, w.name, aw.basis, aw.instrument_ref, w.geom,
       round((ST_Area(w.geom::geography) / 1000000.0)::numeric, 3) AS area_km2
  FROM admin.authority_ward aw JOIN admin.ward w ON w.ward_code = aw.ward_code
 WHERE aw.authority_id = app.authority_id() AND (aw.valid_to IS NULL OR aw.valid_to >= CURRENT_DATE) AND w.geom IS NOT NULL;

DROP FUNCTION IF EXISTS admin.conform_authority_wards(integer);
ALTER TABLE admin.authority_ward DROP COLUMN IF EXISTS geom;
ALTER TABLE admin.authority_ward DROP COLUMN IF EXISTS conformed_at;
COMMENT ON TABLE admin.planning_boundary IS
  'The council''s planning boundary as supplied by its GIS (one per council). Distinct from admin.authority_area, which is the union of the wards.';
DELETE FROM public.spatial_concept_source WHERE relation = 'admin.authority_ward';
DELETE FROM public.schema_migrations WHERE filename = '222_authority_area_one_outline.sql';
