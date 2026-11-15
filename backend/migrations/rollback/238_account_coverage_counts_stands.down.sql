-- ROLLBACK OF 238: the coverage measure counts every current parcel again. Re-run `node scripts/refresh-spatial-engine.js` afterwards.
CREATE OR REPLACE FUNCTION spatial_engine.m_parcel_account_coverage()
RETURNS TABLE (ward_code text, numerator numeric, denominator numeric, facts bigint)
LANGUAGE sql STABLE AS $$
  WITH placed AS (
    SELECT g.ward_code,
           EXISTS (SELECT 1 FROM revenue_link.account_link a WHERE a.parcel_id = p.parcel_id AND a.authority_id = app.authority_id()) AS has_account
      FROM land.parcel p
      LEFT JOIN LATERAL (
        SELECT w.ward_code FROM spatial_engine.v_authority_ward w
         WHERE ST_Intersects(w.geom, ST_PointOnSurface(p.geom_wgs84)) ORDER BY w.ward_code LIMIT 1) g ON true
     WHERE p.status = 'current'
       AND (g.ward_code IS NOT NULL OR p.authority_id = app.authority_id()))
  SELECT ward_code, count(*) FILTER (WHERE has_account)::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;
UPDATE spatial_engine.measure
   SET label = 'Parcels with a rates account',
       description = 'The share of current parcels in the ward that have a rates account. It says an account exists, not whether it is paid.',
       unit = '% of parcels',
       source_note = 'land.parcel and revenue_link.account_link. Base below 10 parcels is not classified.'
 WHERE measure_key = 'parcel_account_coverage';
DELETE FROM public.schema_migrations WHERE filename = '238_account_coverage_counts_stands.sql';
