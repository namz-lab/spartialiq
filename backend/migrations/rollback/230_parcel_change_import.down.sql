-- ROLLBACK OF 230 — THE SURVEY IMPORT CLOSES A STAND-CHANGE PROPOSAL
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/230_parcel_change_import.down.sql
-- Events written by an import of a proposal ('boundary_revised', 'retired') are deleted first so the narrower check can be restored; the parcels
-- themselves are not changed back.
ALTER TABLE land.parcel_change_request DROP COLUMN IF EXISTS applied_by, DROP COLUMN IF EXISTS applied_at;
DELETE FROM land.parcel_event WHERE event IN ('boundary_revised', 'retired');
ALTER TABLE land.parcel_event DROP CONSTRAINT parcel_event_event_check;
ALTER TABLE land.parcel_event ADD CONSTRAINT parcel_event_event_check CHECK (event::text = 'adopted');
