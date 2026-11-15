-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 238 — THE RATES-ACCOUNT COVERAGE MEASURE COUNTS STANDS
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/238_account_coverage_counts_stands.down.sql.
--
-- "Parcels with a rates account" counted every current parcel, stands and farms alike. All of the register's stands have a rates account and none of its
-- farm parcels do, so the figure read 68% overall and low in the rural wards, which looked like a gap in the data. It may not be one: whether farm parcels
-- should carry a rates account is the council's to say. The measure now counts STANDS, and the farm parcels are reported apart (the unit sections show
-- "Farm parcels with a rates account: 0 of 731"). The measure key is unchanged so the engine's history and the maps stay wired.
-- After applying, run `node scripts/refresh-spatial-engine.js` to recompute the ward values.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

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
     WHERE p.status = 'current' AND p.parcel_kind = 'stand'
       AND (g.ward_code IS NOT NULL OR p.authority_id = app.authority_id()))
  SELECT ward_code, count(*) FILTER (WHERE has_account)::numeric, count(*)::numeric, count(*) FROM placed GROUP BY ward_code
$$;

UPDATE spatial_engine.measure
   SET label = 'Stands with a rates account',
       description = 'The share of current stands in the ward that have a rates account. It says an account exists, not whether it is paid. Farm parcels are not counted here; they are reported apart.',
       unit = '% of stands',
       source_note = 'land.parcel (stands only) and revenue_link.account_link. Base below 10 stands is not classified. Farm parcels are shown separately.'
 WHERE measure_key = 'parcel_account_coverage';
