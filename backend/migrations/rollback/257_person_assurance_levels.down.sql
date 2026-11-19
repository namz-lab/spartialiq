-- Rollback of 257_person_assurance_levels.sql: the four levels, their history and the Registrar-General checks.
-- The persons 257 made for online accounts stay (they are people in the register), unlinked from nothing; the account
-- links stay. Only the evidence columns, the history and the checks go.
BEGIN;
DROP TRIGGER IF EXISTS trg_person_residency_to_account ON registry.person;
DROP FUNCTION IF EXISTS registry.mirror_residency_to_account();
DROP TABLE IF EXISTS registry.identity_check;
DROP TRIGGER IF EXISTS trg_assurance_event_append_only ON registry.assurance_event;
DROP TABLE IF EXISTS registry.assurance_event;
DROP FUNCTION IF EXISTS registry.assurance_event_append_only();
DROP FUNCTION IF EXISTS registry.name_parts(text);
DROP INDEX IF EXISTS registry.idx_person_assurance_level;
ALTER TABLE registry.person
  DROP COLUMN IF EXISTS assurance_level,
  DROP COLUMN IF EXISTS resident,
  DROP CONSTRAINT IF EXISTS person_identity_method_known,
  DROP CONSTRAINT IF EXISTS person_original_is_identity,
  DROP CONSTRAINT IF EXISTS person_residency_method_known,
  DROP COLUMN IF EXISTS identity_method,
  DROP COLUMN IF EXISTS original_sighted_at,
  DROP COLUMN IF EXISTS original_sighted_by,
  DROP COLUMN IF EXISTS residency_verified_at,
  DROP COLUMN IF EXISTS residency_verified_by,
  DROP COLUMN IF EXISTS residency_method,
  DROP COLUMN IF EXISTS residency_evidence,
  DROP COLUMN IF EXISTS residency_document_id,
  DROP COLUMN IF EXISTS date_of_birth;
DELETE FROM tenancy.relation_class WHERE relation IN ('registry.assurance_event', 'registry.identity_check');
COMMIT;
