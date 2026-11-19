-- Rollback of 256_person_register.sql: the council's register of persons.
-- Removes the links first, then the register. The text on applications, objections and receipts was never changed, so
-- nothing written on them is lost; only the identities registered since 256 are.
BEGIN;
DROP VIEW IF EXISTS registry.v_unlinked;
ALTER TABLE spatial_planning.permit_application DROP COLUMN IF EXISTS applicant_person_id;
ALTER TABLE spatial_planning.application_objection DROP COLUMN IF EXISTS objector_person_id;
DROP INDEX IF EXISTS public.uq_users_person;
ALTER TABLE public.users DROP COLUMN IF EXISTS person_id;
DROP TABLE IF EXISTS registry.receipt_payer;
DROP TABLE IF EXISTS registry.person_identifier;
DROP TABLE IF EXISTS registry.person;
DROP FUNCTION IF EXISTS registry.identifier_well_formed(text, text);
DROP FUNCTION IF EXISTS registry.normalise_identifier(text);
DELETE FROM tenancy.relation_class WHERE relation LIKE 'registry.%';
DROP SCHEMA IF EXISTS registry;
COMMIT;
