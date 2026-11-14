-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 217 — ROAD DENSITY WITHOUT POLYGON OVERLAY
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: re-run the m_road_density() definition in 216 (no data change).
--
-- 216's m_road_density() cut each road at the ward edge with ST_Intersection. On GEOS 3.9 that returns an
-- EMPTY line for the real ward polygons even when the road lies wholly inside, so every ward read 0 km. The
-- synthetic box wards in the SQL test did not trigger it.
--
-- This version does no overlay. Each road is split into segments of at most 100 m, and each segment is given to
-- the ward that holds its midpoint (a point-in-polygon test, which is robust). A road's length is therefore shared
-- between the wards it crosses to within 100 m. A road whose segments sit in no ward is unlocated (NULL ward).
-- Roads without geometry are still not counted as facts at all, so an unmapped register leaves every ward
-- "no data" rather than 0.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION spatial_engine.m_road_density()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH roads AS (
    SELECT r.id, ST_Segmentize(r.geom::geography, 100)::geometry AS geom
      FROM council_ops.road_asset r
     WHERE r.status = 'active' AND r.geom IS NOT NULL AND r.authority_id = app.authority_id()),
  segs AS (
    SELECT r.id, (ST_DumpSegments(r.geom)).geom AS seg FROM roads r),
  placed AS (
    SELECT s.id, g.ward_code, ST_Length(s.seg::geography) / 1000.0 AS km
      FROM segs s
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE ST_Intersects(w.geom, ST_LineInterpolatePoint(s.seg, 0.5)) ORDER BY w.ward_code LIMIT 1) g ON true),
  by_ward AS (
    SELECT ward_code, sum(km) AS km, count(DISTINCT id) AS n FROM placed WHERE ward_code IS NOT NULL GROUP BY ward_code),
  outside AS (
    SELECT id, sum(km) AS km FROM placed GROUP BY id HAVING bool_and(ward_code IS NULL))
  SELECT ward_code, round(km::numeric, 3), NULL::numeric, n FROM by_ward
  UNION ALL
  SELECT NULL::text, round(COALESCE(sum(km), 0)::numeric, 3), NULL::numeric, count(*) FROM outside HAVING count(*) > 0
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT EXECUTE ON FUNCTION spatial_engine.m_road_density() TO vungu_app;
  END IF;
END $$;
