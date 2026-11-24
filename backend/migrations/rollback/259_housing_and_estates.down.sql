-- Reverse 259. Refuses if housing files exist.
DO $$
BEGIN
  IF to_regclass('housing.waiting_list') IS NOT NULL
     AND EXISTS (SELECT 1 FROM housing.waiting_list) THEN
    RAISE EXCEPTION 'housing files exist; nothing was dropped';
  END IF;
END $$;

DROP VIEW IF EXISTS housing.v_spatial_stand;
DROP FUNCTION IF EXISTS housing.allocate_stand(uuid, varchar, uuid, text, numeric, numeric);
DROP FUNCTION IF EXISTS housing.score_entry(uuid);
DROP FUNCTION IF EXISTS housing.next_no(text, regclass);
DROP SCHEMA IF EXISTS housing CASCADE;
