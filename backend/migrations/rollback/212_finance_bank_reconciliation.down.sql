-- ROLLBACK OF 212 — BANK RECONCILIATION
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/212_finance_bank_reconciliation.down.sql
-- Statements and matches are kept, renamed with a _212_archive suffix. The ledger is untouched.
DELETE FROM finance.role_permission WHERE permission_code LIKE 'finance.bank.%';
DELETE FROM finance.user_permission_override WHERE permission_code LIKE 'finance.bank.%';
DELETE FROM finance.permission WHERE code LIKE 'finance.bank.%';
DROP FUNCTION IF EXISTS finance.complete_bank_reconciliation(uuid, uuid);
DROP FUNCTION IF EXISTS finance.bank_reconciliation_summary(uuid);
DROP FUNCTION IF EXISTS finance.auto_match_bank_statement(uuid, uuid);
DROP FUNCTION IF EXISTS finance.match_bank_items(uuid, uuid[], uuid[], uuid, text);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_match_entry', 'bank_statement_line', 'bank_match', 'bank_statement'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finance.%I', 'trg_' || t || '_open', t);
    EXECUTE format('ALTER TABLE IF EXISTS finance.%I RENAME TO %I', t, t || '_212_archive');
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS finance.assert_bank_statement_open();
DELETE FROM public.schema_migrations WHERE filename = '212_finance_bank_reconciliation.sql';
