-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 230 — THE SURVEY IMPORT CLOSES A STAND-CHANGE PROPOSAL
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback: migrations/rollback/230_parcel_change_import.down.sql.
-- The Survey Section's import of an approved plan can now carry a proposal (migration 229): scripts and services/gms/parcelImport.js match the
-- surveyed boundaries to the proposal's items, create the new parcels, revise a parcel's boundary in place, retire the stands a split or merge
-- replaces, write parent -> child lineage, and mark the proposal applied, all in the import's one transaction.
--   land.parcel_event   two more events: 'boundary_revised' (a boundary changed in place; previous_geom keeps the old one) and 'retired'
--   land.parcel_change_request   applied_at / applied_by: when and by whom the import applied it
-- Nothing changes for an ordinary import (no proposal named).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE land.parcel_event DROP CONSTRAINT parcel_event_event_check;
ALTER TABLE land.parcel_event ADD CONSTRAINT parcel_event_event_check
  CHECK (event::text = ANY (ARRAY['adopted', 'boundary_revised', 'retired']::text[]));

ALTER TABLE land.parcel_change_request
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN applied_by uuid REFERENCES public.users (id) ON DELETE SET NULL;
