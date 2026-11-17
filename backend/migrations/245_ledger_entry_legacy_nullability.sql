-- 245: Make finance.ledger_entry safe on databases that started as the land-rates ledger.
--
-- Migration 203 created finance.ledger_entry fresh on development databases, with only the
-- double-entry columns (voucher, account, debit/credit, posting date, …). Databases restored
-- from the older production dump (the hosted deployment) already had a land-rates
-- finance.ledger_entry, so 203's ADD COLUMN IF NOT EXISTS pass bolted the double-entry columns
-- onto it and left the legacy columns NOT NULL: account_no, entry_date, entry_type, purpose,
-- description, amount_usd, balance_after_usd and created_at.
--
-- Nothing in the double-entry ledger populates those columns, so on such a database every
-- ledger write fails with "null value in column account_no violates not-null constraint" —
-- the hosted site has never been able to post a voucher. Dropping the NOT NULLs aligns the
-- table with what migration 203 builds on a fresh database; legacy rows keep their values and
-- the land-rates code, which still writes them, is unaffected.
ALTER TABLE finance.ledger_entry ALTER COLUMN account_no         DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN entry_date         DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN entry_type         DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN purpose            DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN description        DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN amount_usd         DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN balance_after_usd  DROP NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN created_at         DROP NOT NULL;
