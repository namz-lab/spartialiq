-- ROLLBACK OF 214 — FIXED ASSETS
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/214_finance_fixed_assets.down.sql
-- The register and its runs are kept, renamed with a _214_archive suffix. Posted vouchers stay.
DELETE FROM finance.role_permission WHERE permission_code LIKE 'finance.assets.%';
DELETE FROM finance.user_permission_override WHERE permission_code LIKE 'finance.assets.%';
DELETE FROM finance.permission WHERE code LIKE 'finance.assets.%';
DROP TRIGGER IF EXISTS trg_fixed_asset_figures ON finance.fixed_asset;
DROP FUNCTION IF EXISTS finance.guard_fixed_asset_figures();
DROP FUNCTION IF EXISTS finance.withdraw_asset_disposal(uuid);
DROP FUNCTION IF EXISTS finance.dispose_asset(uuid, date, numeric, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS finance.discard_depreciation_run(uuid);
DROP FUNCTION IF EXISTS finance.run_depreciation(uuid, text, uuid);
DROP VIEW IF EXISTS finance.v_asset_register;
ALTER TABLE IF EXISTS finance.depreciation_charge RENAME TO depreciation_charge_214_archive;
ALTER TABLE IF EXISTS finance.depreciation_run RENAME TO depreciation_run_214_archive;
ALTER TABLE IF EXISTS finance.fixed_asset RENAME TO fixed_asset_214_archive;
ALTER TABLE IF EXISTS finance.asset_category RENAME TO asset_category_214_archive;
DELETE FROM public.schema_migrations WHERE filename = '214_finance_fixed_assets.sql';
