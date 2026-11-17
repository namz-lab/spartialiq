-- Rollback of 244_finance_property_gis.sql. Planning tables are untouched by 244, so nothing there is undone.
DELETE FROM finance.role_permission WHERE permission_code IN ('finance.property.view', 'finance.property.view_identity', 'finance.property.sync');
DELETE FROM finance.permission WHERE code IN ('finance.property.view', 'finance.property.view_identity', 'finance.property.sync');
DROP VIEW IF EXISTS finance.v_property_finance;
DROP TABLE IF EXISTS finance.party_identity;
DROP TABLE IF EXISTS finance.property_integration_event;
DROP TABLE IF EXISTS finance.property_integration_run;
DELETE FROM schema_migrations WHERE filename = '244_finance_property_gis.sql';
