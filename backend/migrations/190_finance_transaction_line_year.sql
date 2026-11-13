-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 190 — A transaction must belong to the same financial year as its budget line (audit F-05)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY YEAR BUT NOT CURRENCY. The audit finding asked for a trigger that rejects a transaction whose
-- budget line is from another year OR another currency. The year half is a straightforward integrity
-- rule: an actual posted against a line from a different year is a misclassification, not a fact the
-- system should preserve. The currency half cannot be a hard rejection without contradicting the
-- specification's own rule (A8 / §6.4): a transaction in a different currency from its budget line is
-- STORED, excluded from that line's totals and counted in `actual_currency_mismatch_rows`, so the
-- fault is visible rather than silently converted or dropped. Import validation already treats it
-- that way and acceptance test A8 asserts it.
--
-- So this migration enforces the part that must never happen (cross-year posting) and leaves the
-- deliberate, reported currency fault to the existing view counters. `finance.v_budget_line_performance`
-- still reports `actual_currency_mismatch_rows`, and the public project view reports the same fault,
-- so neither is silent.
--
-- The trigger also closes the direct-SQL path: the routes already validate this, but a correction
-- script or a future integration adapter writes through the same table and gains nothing by bypassing
-- the route.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Refuse to enable the trigger over data that already violates the rule, and say exactly how many
-- rows need review. A silent enable would leave the bad rows in place and make every later update to
-- them fail with a confusing message.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM finance.transaction t
    JOIN finance.budget_line l ON l.id = t.budget_line_id
   WHERE t.deleted_at IS NULL
     AND t.financial_year_id <> l.financial_year_id;

  IF n > 0 THEN
    RAISE EXCEPTION 'cannot enable transaction/budget-line year enforcement: % live transaction(s) cross years', n
      USING ERRCODE = 'check_violation',
            HINT = 'Review finance.transaction joined to finance.budget_line where financial_year_id differs, correct or retire those rows, then re-run migration 190.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION finance.assert_transaction_line_year() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_year_id   uuid;
  line_year_name text;
  txn_year_name  text;
BEGIN
  -- An unallocated transaction is allowed: not every actual is posted against a budget line.
  IF NEW.budget_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.financial_year_id, fy.label
    INTO line_year_id, line_year_name
    FROM finance.budget_line l
    JOIN finance.financial_year fy ON fy.id = l.financial_year_id
   WHERE l.id = NEW.budget_line_id;

  IF line_year_id IS NULL THEN
    RAISE EXCEPTION 'transaction % references budget line % with no financial year',
      NEW.id, NEW.budget_line_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.financial_year_id IS DISTINCT FROM line_year_id THEN
    SELECT label INTO txn_year_name
      FROM finance.financial_year
     WHERE id = NEW.financial_year_id;

    RAISE EXCEPTION 'transaction is in financial year % but its budget line % belongs to %',
      COALESCE(txn_year_name, NEW.financial_year_id::text), NEW.budget_line_id, line_year_name
      USING ERRCODE = 'check_violation',
            HINT = 'Post the transaction against a budget line in its own financial year, or leave budget_line_id null if it is not yet allocated.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION finance.assert_transaction_line_year() IS
  'Rejects a transaction whose budget_line_id belongs to a different financial year (audit F-05). Currency mismatches are deliberately not rejected: §6.4/A8 require them to be stored and reported as a data fault.';

DROP TRIGGER IF EXISTS trg_transaction_line_year ON finance.transaction;
CREATE TRIGGER trg_transaction_line_year
  BEFORE INSERT OR UPDATE ON finance.transaction
  FOR EACH ROW EXECUTE FUNCTION finance.assert_transaction_line_year();
