-- ROLLBACK OF 213 — CREDITORS
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/213_finance_creditors.down.sql
-- Documents are kept, renamed with a _213_archive suffix. Vouchers already posted stay in the
-- ledger. The wider voucher_type and document_sequence constraints stay: rows may already use them.
DELETE FROM finance.role_permission WHERE permission_code LIKE 'finance.payables.%';
DELETE FROM finance.user_permission_override WHERE permission_code LIKE 'finance.payables.%';
DELETE FROM finance.permission WHERE code LIKE 'finance.payables.%';
DROP TRIGGER IF EXISTS trg_voucher_line_document_guard ON finance.voucher_line;
DROP FUNCTION IF EXISTS finance.guard_document_voucher_lines();
DROP FUNCTION IF EXISTS finance.discard_payables_document(text, uuid);
DROP FUNCTION IF EXISTS finance.create_supplier_payment(uuid, text, uuid, date, uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS finance.create_supplier_invoice(uuid, text, uuid, date, date, date, text, uuid, uuid, text, jsonb, uuid);
DROP VIEW IF EXISTS finance.v_creditor_open;
ALTER TABLE IF EXISTS finance.supplier_payment_allocation RENAME TO supplier_payment_allocation_213_archive;
ALTER TABLE IF EXISTS finance.supplier_payment RENAME TO supplier_payment_213_archive;
ALTER TABLE IF EXISTS finance.supplier_invoice_line RENAME TO supplier_invoice_line_213_archive;
ALTER TABLE IF EXISTS finance.supplier_invoice RENAME TO supplier_invoice_213_archive;
DELETE FROM public.schema_migrations WHERE filename = '213_finance_creditors.sql';
