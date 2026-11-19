-- Rollback of 258_registrar_general_prototype.sql: removes the PROTOTYPE Registrar-General service and its fictional register.
-- The council's own record of the checks it made (registry.identity_check, 257) stays.
BEGIN;
DROP SCHEMA IF EXISTS rg_prototype CASCADE;
DELETE FROM tenancy.relation_class WHERE relation LIKE 'rg_prototype.%';
COMMIT;
