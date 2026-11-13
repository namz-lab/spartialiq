-- ROLLBACK OF 211 — CUT-OVER FROM THE PREVIOUS ACCOUNTING PACKAGE
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/211_finance_cutover.down.sql
-- Loaded files, the account mapping and the reconciliation are KEPT, renamed with a _211_archive
-- suffix: they are evidence. Opening vouchers already posted stay in the ledger (it is insert-only).
-- finance.voucher.document_date and the `aged_from` column of finance.v_debtor_ageing stay: later
-- migrations read them, and for vouchers without a document date they change nothing.
DELETE FROM finance.role_permission WHERE permission_code LIKE 'finance.migration.%';
DELETE FROM finance.user_permission_override WHERE permission_code LIKE 'finance.migration.%';
DELETE FROM finance.permission WHERE code LIKE 'finance.migration.%';
DROP FUNCTION IF EXISTS finance.sign_off_cutover(uuid, uuid, text);
DROP FUNCTION IF EXISTS finance.cutover_readiness(uuid);
DROP FUNCTION IF EXISTS finance.build_cutover_reconciliation(uuid, uuid);
DROP FUNCTION IF EXISTS finance.refresh_cutover_reconciliation(uuid);
DROP FUNCTION IF EXISTS finance.withdraw_migration_batch(uuid, uuid, text);
DROP FUNCTION IF EXISTS finance.commit_open_items_batch(uuid, uuid);
DROP FUNCTION IF EXISTS finance.commit_opening_balance_batch(uuid, uuid);
DROP FUNCTION IF EXISTS finance.commit_party_batch(uuid, uuid);
DROP FUNCTION IF EXISTS finance.commit_chart_batch(uuid, uuid);
DROP FUNCTION IF EXISTS finance.lock_migration_batch(uuid, text);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cutover_reconciliation_line', 'cutover_reconciliation', 'migration_voucher',
                           'party_source_map', 'account_code_map', 'migration_row', 'migration_batch', 'cutover'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finance.%I', 'trg_' || t || '_cutover_open', t);
    EXECUTE format('ALTER TABLE IF EXISTS finance.%I RENAME TO %I', t, t || '_211_archive');
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS finance.assert_cutover_open();
DELETE FROM public.schema_migrations WHERE filename = '211_finance_cutover.sql';
