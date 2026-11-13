-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 191 — A document knows its financial year, so the public register can be scoped (audit F-07)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- finance.document stores `subject_kind` + `subject_id` as text because a document can attach to
-- seven different record types. The public register could therefore not be filtered by year without
-- resolving the subject at query time, and it returned up to 500 rows with no pagination.
--
-- The year is derived from the subject, never typed in: a document attached to a budget line,
-- revision, transaction, import batch, publication or financial year gets that record's year. A
-- project is deliberately multi-year (its activity is expressed by allocations and transactions),
-- so a project document has no single year and keeps NULL; it can still be found with the
-- `projects` dataset filter. A report document likewise has no year column to copy.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE finance.document
  ADD COLUMN IF NOT EXISTS financial_year_id uuid REFERENCES finance.financial_year (id);

-- Backfill once, from the subject. Correlated subqueries rather than a cast: `subject_id` is text
-- and may in principle be a non-uuid reference, which must not abort the migration.
UPDATE finance.document d
   SET financial_year_id = CASE d.subject_kind
         WHEN 'financial_year' THEN
           (SELECT fy.id FROM finance.financial_year fy WHERE fy.id::text = d.subject_id)
         WHEN 'budget_line' THEN
           (SELECT l.financial_year_id FROM finance.budget_line l WHERE l.id::text = d.subject_id)
         WHEN 'budget_revision' THEN
           (SELECT l.financial_year_id
              FROM finance.budget_revision r
              JOIN finance.budget_line l ON l.id = r.budget_line_id
             WHERE r.id::text = d.subject_id)
         WHEN 'transaction' THEN
           (SELECT t.financial_year_id FROM finance.transaction t WHERE t.id::text = d.subject_id)
         WHEN 'import_batch' THEN
           (SELECT b.financial_year_id FROM finance.import_batch b WHERE b.id::text = d.subject_id)
         WHEN 'publication' THEN
           (SELECT p.financial_year_id FROM finance.publication p WHERE p.id::text = d.subject_id)
         ELSE NULL
       END
 WHERE d.financial_year_id IS NULL;

CREATE OR REPLACE FUNCTION finance.set_document_year() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.financial_year_id := CASE NEW.subject_kind
    WHEN 'financial_year' THEN
      (SELECT fy.id FROM finance.financial_year fy WHERE fy.id::text = NEW.subject_id)
    WHEN 'budget_line' THEN
      (SELECT l.financial_year_id FROM finance.budget_line l WHERE l.id::text = NEW.subject_id)
    WHEN 'budget_revision' THEN
      (SELECT l.financial_year_id
         FROM finance.budget_revision r
         JOIN finance.budget_line l ON l.id = r.budget_line_id
        WHERE r.id::text = NEW.subject_id)
    WHEN 'transaction' THEN
      (SELECT t.financial_year_id FROM finance.transaction t WHERE t.id::text = NEW.subject_id)
    WHEN 'import_batch' THEN
      (SELECT b.financial_year_id FROM finance.import_batch b WHERE b.id::text = NEW.subject_id)
    WHEN 'publication' THEN
      (SELECT p.financial_year_id FROM finance.publication p WHERE p.id::text = NEW.subject_id)
    ELSE NULL
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_document_year ON finance.document;
CREATE TRIGGER trg_document_year
  BEFORE INSERT OR UPDATE ON finance.document
  FOR EACH ROW EXECUTE FUNCTION finance.set_document_year();

CREATE INDEX IF NOT EXISTS idx_finance_document_year
  ON finance.document (authority_id, financial_year_id, uploaded_at DESC);

COMMENT ON COLUMN finance.document.financial_year_id IS
  'Derived from the subject record by finance.set_document_year(); NULL for deliberately multi-year subjects (project) and for reports (audit F-07).';
