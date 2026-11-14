-- Builds stand parcels from a township general-plan DXF that has already been loaded
-- into scratch.township_dxf_raw by import-township-dxf.js (native drawing coordinates,
-- x = easting, y = northing, i.e. -Y/-X of the Lo29 labels on the drawing).
--
-- Placeholders replaced by the script:  :township  :sg_ref  :source  :srid  :tol  :max_stand_m2
--
-- Method (the DXF carries road and block outlines that close, but not every stand
-- dividing line, so two kinds of stand come out):
--   * a closed face holding exactly one stand-number label  -> that face is the stand.
--     accuracy_basis 'general_plan'.
--   * a closed face holding several labels -> the face is cut into one cell per label
--     (Voronoi of the label points, clipped to the face). accuracy_basis 'estimated'.
--     These are positions for a demonstration register, not surveyed boundaries.

SET app.authority_id = '1';

-- land.parcel and land.general_plan take their source CRS from gis_ops.crs_registry.
-- 922029 (Arc 1950 Lo29) is already there; the Hartebeesthoek94 and Cape variants are added
-- when asked for. Which one a drawing uses is settled by overlaying it on the farm cadastre:
-- the Hertfordshire layout falls wholly inside its parent farm under 2053 (about 300 m away
-- from the Arc 1950 position).
INSERT INTO gis_ops.crs_registry (srid, code, name, datum, proj4text, is_survey, transform_method, accuracy_m)
SELECT s.srid, s.code, s.name, s.datum, s.proj4text, true, s.method, s.acc
  FROM (VALUES
    (2053,  'Lo29HBK94', 'Hartebeesthoek94 / Lo29', 'Hartebeesthoek94',
     '+proj=tmerc +lat_0=0 +lon_0=29 +k=1 +x_0=0 +y_0=0 +axis=wsu +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
     'Hartebeesthoek94 -> WGS 84, identity', 1::numeric),
    (22289, 'Lo29CAPE',  'Cape / Lo29', 'Cape',
     '+proj=tmerc +lat_0=0 +lon_0=29 +k=1 +x_0=0 +y_0=0 +axis=wsu +a=6378249.145 +b=6356514.966398753 +towgs84=-136,-108,-292,0,0,0,0 +units=m +no_defs',
     'Cape -> WGS 84, 3-parameter geocentric (-136,-108,-292)', 5::numeric)
  ) AS s(srid, code, name, datum, proj4text, method, acc)
 WHERE s.srid = :srid
ON CONFLICT (srid) DO NOTHING;

DROP TABLE IF EXISTS scratch.td_label;
CREATE TABLE scratch.td_label AS
SELECT row_number() OVER () AS lid, trim(text) AS stand_no, geom
  FROM scratch.township_dxf_raw
 WHERE layer = 'TEXT2' AND geometrytype(geom) = 'POINT' AND trim(text) ~ '^[0-9]+[A-Za-z]?$';

DROP TABLE IF EXISTS scratch.td_face;
CREATE TABLE scratch.td_face AS
WITH u AS (
  SELECT st_unaryunion(st_collect(st_snaptogrid(geom, :tol))) AS g
    FROM scratch.township_dxf_raw
   WHERE geometrytype(geom) = 'LINESTRING'
     AND layer IN ('0', 'PEN1', 'LINE1', 'TEXT2', 'PEN4', 'PEN3', 'PEN2')
), f AS (SELECT (st_dump(st_polygonize(g))).geom AS geom FROM u)
SELECT row_number() OVER () AS fid, geom FROM f;

ALTER TABLE scratch.td_face ADD COLUMN n int;
CREATE INDEX ON scratch.td_face USING gist (geom);
CREATE INDEX ON scratch.td_label USING gist (geom);
UPDATE scratch.td_face f
   SET n = (SELECT count(*) FROM scratch.td_label l WHERE st_contains(f.geom, l.geom));

DROP TABLE IF EXISTS scratch.td_stand;
CREATE TABLE scratch.td_stand AS
-- one label in the face: the face is the stand
SELECT l.stand_no, f.geom, 'general_plan'::text AS basis, f.fid
  FROM scratch.td_face f JOIN scratch.td_label l ON st_contains(f.geom, l.geom)
 WHERE f.n = 1
UNION ALL
-- several labels: one Voronoi cell per label, clipped to the face
SELECT c.stand_no, c.geom, 'estimated', c.fid
  FROM (
    SELECT l.stand_no, f.fid,
           st_multi(st_collectionextract(st_intersection(f.geom, v.cell), 3)) AS geom
      FROM scratch.td_face f
      CROSS JOIN LATERAL (
        SELECT (st_dump(st_voronoipolygons(st_collect(l2.geom), 0, st_expand(f.geom, 50)))).geom AS cell
          FROM scratch.td_label l2 WHERE st_contains(f.geom, l2.geom)
      ) v
      JOIN scratch.td_label l ON st_contains(v.cell, l.geom) AND st_contains(f.geom, l.geom)
     WHERE f.n > 1
  ) c
 WHERE NOT st_isempty(c.geom);

-- Stand numbers must be unique inside one township: keep the first, report the rest.
DROP TABLE IF EXISTS scratch.td_final;
CREATE TABLE scratch.td_final AS
SELECT *, st_area(st_transform(st_setsrid(st_affine(geom, -1,0,0, 0,-1,0, 0,0,1, 0,0,0), :srid), 4326)::geography) AS area_m2,
       row_number() OVER (PARTITION BY stand_no ORDER BY basis, fid) AS dup_rank
  FROM scratch.td_stand;

INSERT INTO land.general_plan (sg_ref, township_code, source_srid, feature_count)
SELECT ':sg_ref', ':township', :srid, (SELECT count(*) FROM scratch.td_final WHERE dup_rank = 1 AND area_m2 BETWEEN 50 AND :max_stand_m2)
 WHERE NOT EXISTS (SELECT 1 FROM land.general_plan WHERE sg_ref = ':sg_ref');

INSERT INTO land.parcel (
  stand_no, township_code, ward_code, geom_source, source_srid, geom_wgs84,
  transform_method, area_m2, sg_ref, general_plan_id, accuracy_class, accuracy_basis,
  source, status, parcel_kind, source_relation, source_key)
SELECT s.stand_no, ':township', aw.ward_code,
       st_multi(st_setsrid(st_affine(s.geom, -1,0,0, 0,-1,0, 0,0,1, 0,0,0), :srid)), :srid,
       st_multi(st_transform(st_setsrid(st_affine(s.geom, -1,0,0, 0,-1,0, 0,0,1, 0,0,0), :srid), 4326)),
       'Lo29 (Hartebeesthoek94, EPSG:2053) to WGS84; drawing x/y are easting/northing, Lo29 axes are westing/southing',
       round(s.area_m2::numeric, 2), ':sg_ref', gp.import_id,
       CASE s.basis WHEN 'general_plan' THEN 'C' ELSE 'D' END, s.basis,
       ':source', 'current', 'stand', 'dxf:' || ':township', s.stand_no
  FROM scratch.td_final s
  JOIN land.general_plan gp ON gp.sg_ref = ':sg_ref'
  LEFT JOIN LATERAL (
    SELECT w.pcode FROM public.wards w
     WHERE w.geom IS NOT NULL
       AND st_intersects(w.geom, st_pointonsurface(st_transform(st_setsrid(st_affine(s.geom, -1,0,0, 0,-1,0, 0,0,1, 0,0,0), :srid), 4326)))
     LIMIT 1) ward ON true
  LEFT JOIN admin.ward aw ON aw.ward_code = ward.pcode
 WHERE s.dup_rank = 1 AND s.area_m2 BETWEEN 50 AND :max_stand_m2
   AND NOT EXISTS (SELECT 1 FROM land.parcel x WHERE x.township_code = ':township' AND x.stand_no = s.stand_no AND x.status = 'current');
