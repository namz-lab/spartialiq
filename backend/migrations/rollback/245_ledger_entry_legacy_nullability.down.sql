-- 245 rollback: restore the legacy NOT NULLs this migration dropped.
-- Refused while any double-entry row (voucher_id IS NOT NULL) would violate them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM finance.ledger_entry WHERE voucher_id IS NOT NULL LIMIT 1) THEN
    RAISE EXCEPTION 'finance.ledger_entry holds double-entry rows; restoring the legacy NOT NULLs would make them invalid.';
  END IF;
END
$$;
ALTER TABLE finance.ledger_entry ALTER COLUMN account_no         SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN entry_date         SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN entry_type         SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN purpose            SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN description        SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN amount_usd         SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN balance_after_usd  SET NOT NULL;
ALTER TABLE finance.ledger_entry ALTER COLUMN created_at         SET NOT NULL;
