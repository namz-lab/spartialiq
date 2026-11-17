-- ROLLBACK OF 243 — THE SALARIES JOURNAL
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f migrations/rollback/243_finance_payroll_journal.down.sql
-- Nothing posted is touched. Vouchers numbered SJ- keep their numbers and stay in the ledger; the
-- payroll counter row (if any) stays too, so a later re-apply continues the series where it stopped
-- and never issues a number twice — the same rule 242's rollback keeps for JV-, CN-, WO- and YC-.
-- REFUSED while any payroll voucher exists, draft or posted: the voucher type below stops admitting
-- `payroll`, and a payroll voucher left behind would be of a type no check admits and no screen
-- raises. Post or cancel every draft named, and reverse what is posted, then run this again.
-- The route that raises a salaries journal (src/routes/finance-ledger.js, POST
-- /finance/ledger/salaries-journal) must be rolled back with this file.
DO $$
DECLARE pending text;
BEGIN
  SELECT string_agg(format('%s (%s, authority %s)', v.voucher_no, v.status, v.authority_id),
                    '; ' ORDER BY v.authority_id, v.voucher_no)
    INTO pending
    FROM finance.voucher v
   WHERE v.voucher_type = 'payroll';
  IF pending IS NOT NULL THEN
    RAISE EXCEPTION 'rollback of 243 refused: salaries journals exist: %', pending
      USING HINT = 'Post or cancel every draft, reverse what is posted, then run the rollback again.';
  END IF;
END $$;

ALTER TABLE finance.voucher DROP CONSTRAINT IF EXISTS voucher_type_known;
ALTER TABLE finance.voucher ADD CONSTRAINT voucher_type_known CHECK (voucher_type IN (
  'opening', 'journal', 'rates_bill', 'receipt', 'credit_note', 'write_off', 'closing', 'reversal',
  'supplier_invoice', 'payment', 'depreciation', 'asset_disposal'));

ALTER TABLE finance.document_sequence DROP CONSTRAINT IF EXISTS document_sequence_kind_known;
ALTER TABLE finance.document_sequence ADD CONSTRAINT document_sequence_kind_known
  CHECK (kind IN ('receipt', 'cashier_session', 'bank_deposit', 'opening',
                  'supplier_invoice', 'payment', 'asset', 'depreciation', 'asset_disposal',
                  'journal', 'credit_note', 'write_off', 'closing'));

-- 242's CASE, verbatim: no payroll, no SJ-.
CREATE OR REPLACE FUNCTION finance.next_document_no(p_authority_id integer, p_kind text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_no bigint;
  v_prefix text;
BEGIN
  v_prefix := CASE p_kind WHEN 'receipt' THEN 'RC' WHEN 'cashier_session' THEN 'CS'
                          WHEN 'bank_deposit' THEN 'BD' WHEN 'opening' THEN 'OB'
                          WHEN 'supplier_invoice' THEN 'SI' WHEN 'payment' THEN 'PV'
                          WHEN 'asset' THEN 'FA' WHEN 'depreciation' THEN 'DP'
                          WHEN 'asset_disposal' THEN 'AD'
                          WHEN 'journal' THEN 'JV' WHEN 'credit_note' THEN 'CN'
                          WHEN 'write_off' THEN 'WO' WHEN 'closing' THEN 'YC' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'no document sequence is kept for %', p_kind USING ERRCODE = '23514';
  END IF;
  INSERT INTO finance.document_sequence AS s (authority_id, kind, last_no)
  VALUES (p_authority_id, p_kind, 1)
  ON CONFLICT (authority_id, kind) DO UPDATE SET last_no = s.last_no + 1
  RETURNING s.last_no INTO v_no;
  RETURN v_prefix || '-' || lpad(v_no::text, 7, '0');
END $$;

DELETE FROM public.schema_migrations WHERE filename = '243_finance_payroll_journal.sql';
