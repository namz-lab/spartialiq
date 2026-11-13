-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 192 — The closed-year guard covers project allocations and project links (audit D-04)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- `finance.assert_year_open()` (migration 188) refuses writes to a closed year on budget_line,
-- budget_revision, transaction, commitment and import_batch. Two tables that change what a year's
-- project figures say were not covered:
--
--   * finance.project_allocation — a new or edited allocation changes a project's budget for a year.
--     Since migration 189 it carries `financial_year_id` derived from its budget line, so the guard
--     can read it directly.
--   * finance.project_transaction — a project link changes how much of a transaction counts as project
--     spend. It has no year column of its own; the year is the linked transaction's year, and its
--     `trg_transaction_year_open` already refuses a NEW transaction in a closed year. This closes the
--     remaining path: attaching a project to an ALREADY EXISTING closed-year transaction.
--
-- Trigger order on project_allocation matters. PostgreSQL fires same-timing triggers in name order:
-- `trg_project_allocation_year` (the setter from 189) sorts before `trg_project_allocation_year_open`
-- (created below), so the year is populated before it is checked.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION finance.assert_year_open() RETURNS trigger AS $$
DECLARE
  y_id uuid;
  y_status text;
  y_label text;
BEGIN
  IF TG_TABLE_NAME IN ('budget_revision', 'commitment') THEN
    SELECT financial_year_id INTO y_id FROM finance.budget_line WHERE id = NEW.budget_line_id;
  ELSIF TG_TABLE_NAME = 'project_transaction' THEN
    SELECT financial_year_id INTO y_id FROM finance.transaction WHERE id = NEW.transaction_id;
  ELSE
    y_id := NEW.financial_year_id;
  END IF;
  IF y_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, label INTO y_status, y_label FROM finance.financial_year WHERE id = y_id;
  IF y_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'financial year % is %; it accepts no further financial records', y_label, y_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Recreate the trigger set including the two project tables. Dropping and recreating the existing
-- ones is harmless and keeps the full list visible in one place.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_line', 'budget_revision', 'transaction', 'commitment',
                           'import_batch', 'project_allocation', 'project_transaction'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_year_open ON finance.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_year_open BEFORE INSERT OR UPDATE ON finance.%I
         FOR EACH ROW EXECUTE FUNCTION finance.assert_year_open()', t, t);
  END LOOP;
END $$;

COMMENT ON FUNCTION finance.assert_year_open() IS
  'Refuses writes into a closed or archived financial year on budget lines, revisions, transactions, commitments, import batches, project allocations and project transactions (audit D-04).';
