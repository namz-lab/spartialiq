-- Reverse 260. Does not drop the extra users.role values (those CHECK lists are widened in place).
DROP VIEW IF EXISTS housing.v_cross_file;
DROP FUNCTION IF EXISTS finance.record_housing_fee_receipt(uuid, uuid, uuid, text, finance.currency_code, text, jsonb, uuid, uuid, text, text);
DROP TABLE IF EXISTS finance.housing_fee;
DROP TABLE IF EXISTS housing.committee_item;
DROP TABLE IF EXISTS housing.committee_sitting;
ALTER TABLE finance.income_code DROP CONSTRAINT IF EXISTS income_code_housing_fee_kind_known;
DROP INDEX IF EXISTS finance.uq_income_code_housing_fee_kind;
ALTER TABLE finance.income_code DROP COLUMN IF EXISTS housing_fee_kind;
ALTER TABLE housing.allocation DROP COLUMN IF EXISTS deposit_receipt_id;
ALTER TABLE housing.allocation DROP COLUMN IF EXISTS first_due_on;
ALTER TABLE housing.allocation DROP COLUMN IF EXISTS balance_due_on;
ALTER TABLE housing.allocation DROP COLUMN IF EXISTS waiver_reason;
ALTER TABLE housing.waiting_list DROP COLUMN IF EXISTS seasoning_until;
-- Restore the 259 allocate_stand signature by re-running 259's function if this rollback is used alone;
-- live rollbacks of 260 are expected to restore 259's body from that file.