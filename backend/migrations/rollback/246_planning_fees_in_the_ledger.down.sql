-- Rollback of 246_planning_fees_in_the_ledger.sql.
-- Vouchers already raised for planning fees stay in the ledger (a posted entry is never removed); only
-- the link between them and the applications goes. permit_application.fee_paid_at is left as it is.
DELETE FROM finance.role_permission WHERE permission_code IN ('finance.planning_fees.view', 'finance.planning_fees.prepare');
DELETE FROM finance.permission WHERE code IN ('finance.planning_fees.view', 'finance.planning_fees.prepare');
DROP VIEW IF EXISTS finance.v_planning_fee;
DROP FUNCTION IF EXISTS finance.prepare_online_planning_fee_vouchers(uuid, uuid[]);
DROP FUNCTION IF EXISTS finance.note_online_planning_fee(uuid);
DROP TRIGGER IF EXISTS trg_cash_receipt_planning_fee_cancelled ON finance.cash_receipt;
DROP FUNCTION IF EXISTS finance.planning_fee_receipt_cancelled();
DROP FUNCTION IF EXISTS finance.record_planning_fee_receipt(uuid, uuid, uuid, text, finance.currency_code, text, jsonb, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS finance.sync_planning_application_fee_paid(uuid);
DROP FUNCTION IF EXISTS finance.planning_application_fee_settled(uuid);
DROP TABLE IF EXISTS finance.planning_fee;
DROP FUNCTION IF EXISTS finance.refuse_planning_fee_change();
DROP TABLE IF EXISTS finance.payment_channel;
DROP FUNCTION IF EXISTS finance.assert_payment_channel_account();
DROP INDEX IF EXISTS finance.uq_income_code_planning_fee_kind;
ALTER TABLE finance.income_code DROP CONSTRAINT IF EXISTS income_code_planning_fee_kind_known;
ALTER TABLE finance.income_code DROP COLUMN IF EXISTS planning_fee_kind;
DELETE FROM schema_migrations WHERE filename = '246_planning_fees_in_the_ledger.sql';
