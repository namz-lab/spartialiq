-- ROLLBACK OF 229 — PARCEL CHANGE REQUESTS
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/229_parcel_change_requests.down.sql
-- Drops the proposals (their items, parents and the checking function) and restores the survey task types. Survey tasks already opened for a
-- proposal with one of the new types are re-typed 'general' first. Nothing in the register changes.
DROP FUNCTION IF EXISTS land.change_request_problems(uuid);
DROP TABLE IF EXISTS land.parcel_change_item;
DROP TABLE IF EXISTS land.parcel_change_parent;
DROP TABLE IF EXISTS land.parcel_change_request;
DELETE FROM tenancy.relation_class WHERE relation IN ('land.parcel_change_request', 'land.parcel_change_parent', 'land.parcel_change_item');
DELETE FROM public.spatial_concept_source WHERE relation IN ('land.parcel_change_request', 'land.parcel_change_parent', 'land.parcel_change_item');
UPDATE spatial_planning.survey_task SET task_type = 'general' WHERE task_type IN ('subdivision', 'consolidation', 'boundary_correction', 'new_stand');
ALTER TABLE spatial_planning.survey_task DROP CONSTRAINT survey_task_task_type_check;
ALTER TABLE spatial_planning.survey_task ADD CONSTRAINT survey_task_task_type_check CHECK (task_type::text = ANY (ARRAY[
  'verification', 'setting_out', 'pegging', 'layout', 'encroachment', 'beacon_check', 'general']::text[]));
